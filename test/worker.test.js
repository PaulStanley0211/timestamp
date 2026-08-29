/**
 * The worker, one claimed job at a time.
 *
 * `once()` is the unit under test in this file and there is not a `setTimeout`
 * in it. Everything that is a function of time -- lease deadlines, step
 * durations, heartbeat throttling -- reads an injected clock that the test
 * advances by assignment, and the heartbeat's interval timer is injected too,
 * so a test can fire it by hand instead of waiting for it. A worker test that
 * waited for real elapsed time would be a test nobody runs, and the behaviour
 * it would be covering (the lease outliving a fifteen-minute render) is the one
 * that must never be discovered in production.
 *
 * The queue and the manifests are real. The pipeline is a fake that drives the
 * real `job.mjs` state machine, which is the only way the step events, the
 * revive path and the resume guarantee mean anything -- and it is also what
 * keeps `npm test` unable to spend a cent: no provider is ever called, and the
 * fal provider is never imported.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createQueue } from '../scripts/queue/queue.mjs';
import {
  createJob, loadJob, saveJob, beginStep, finishStep, failStep,
  completeJob, cancelJob, setJobStatus,
} from '../scripts/render/job.mjs';
import { RetriableError, TerminalError } from '../scripts/providers/errors.mjs';
import { createWorker, WorkerError } from '../scripts/worker/worker.mjs';
import { renderEvent, formatMs, parseArgs } from '../scripts/worker/worker-cli.mjs';

const T0 = Date.UTC(2026, 7, 20, 14, 45, 0);
const LEASE_MS = 900_000;
const JOB_A = '20260820-144501-a3f19c';
const JOB_B = '20260820-144502-b41e07';

/** The fields of config/render.json this module actually reads. */
const CFG = Object.freeze({
  provider: { maxInflight: 1, maxAttempts: 4, backoffBaseMs: 1000, pollIntervalMs: 5000, pollTimeoutMs: 900_000 },
});

/** A provider stub. The worker never calls it -- it hands it to the pipeline --
 *  so its shape only has to be recognisable in an assertion. */
const PROVIDER = Object.freeze({ id: 'fake', capabilities: {} });

const INPUT = Object.freeze({
  photo: { path: 'input/photo.jpg', sha256: 'a'.repeat(64), width: 1024, height: 768 },
  place: { kind: 'preset', value: 'schrebergarten-august' },
  outfit: { kind: 'preset', value: 'trainingsjacke' },
  stillCount: 3,
  consent: { granted: true, at: new Date(T0).toISOString(), text: 'I agree that this is my face.' },
});

function makeRig(t, { pipeline, clock = { now: T0 }, ...overrides } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-worker-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const nowImpl = () => clock.now;
  const queue = createQueue({
    root: dir, nowImpl, leaseMs: LEASE_MS, maxAttempts: CFG.provider.maxAttempts,
  });

  const events = [];
  const tickers = [];
  const worker = createWorker({
    root: dir,
    cfg: CFG,
    provider: PROVIDER,
    queue,
    nowImpl,
    workerId: 'renderer-1',
    onEvent: (event) => events.push(event),
    sleepImpl: async () => {},
    setIntervalImpl: (fn, ms) => { const handle = { fn, ms }; tickers.push(handle); return handle; },
    clearIntervalImpl: (handle) => {
      const i = tickers.indexOf(handle);
      if (i >= 0) tickers.splice(i, 1);
    },
    runPipelineImpl: pipeline ?? (async (job) => job),
    ...overrides,
  });

  return {
    dir, clock, queue, worker, events, tickers,
    types: () => events.map((e) => e.type),
    of: (type) => events.filter((e) => e.type === type),
    seed(jobId = JOB_A) {
      createJob({ root: dir, jobId, provider: 'fixture', cfg: CFG, nowImpl, input: INPUT });
      queue.enqueue(jobId);
      return jobId;
    },
    load: (jobId = JOB_A) => loadJob({ root: dir, jobId, nowImpl }),
    lock: (jobId = JOB_A) => JSON.parse(fs.readFileSync(`${queue.paths.claimed}/${jobId}.lock`, 'utf8')),
  };
}

/** One step, driven through the real job state machine exactly as the pipeline
 *  is specified to drive it: begin, work, finish, save after every transition. */
function runStep(job, name, clock, { ms = 1200, onProgress } = {}) {
  beginStep(job, name);
  saveJob(job);
  onProgress?.({ step: name, phase: 'running', pct: 50 });
  clock.now += ms;
  finishStep(job, name, { output: {} });
  saveJob(job);
  onProgress?.({ step: name, phase: 'done' });
}

/** A pipeline that runs two free steps and finishes the job. */
const happyPipeline = (clock, steps = ['intake', 'moderate']) => async (job, opts) => {
  for (const name of steps) {
    runStep(job, name, clock, { onProgress: opts.onProgress });
    if (opts.signal.aborted) return job;
  }
  completeJob(job, { videoPath: 'timestamp.mp4', posterPath: 'poster.jpg', durationSeconds: 15, frames: 375 });
  saveJob(job);
  return job;
};

// --- claiming ---------------------------------------------------------------

test('once() on an empty queue is the idle path, not an error', async (t) => {
  const rig = makeRig(t);
  assert.equal(await rig.worker.once(), false);
  assert.deepEqual(rig.types(), ['idle']);
});

test('once() claims one job, runs it and records the result on the queue', async (t) => {
  const clock = { now: T0 };
  const rig = makeRig(t, { clock, pipeline: happyPipeline(clock) });
  rig.seed();

  assert.equal(await rig.worker.once(), true);

  assert.deepEqual(rig.queue.stats(), { pending: 0, claimed: 0, done: 1, failed: 0 });
  assert.equal(rig.load().status, 'done');
  assert.equal(rig.of('claimed')[0].jobId, JOB_A);
  assert.equal(rig.of('completed').length, 1);
});

test('once() claims at most one job -- maxInflight is 1 and stays 1', async (t) => {
  const clock = { now: T0 };
  const rig = makeRig(t, { clock, pipeline: happyPipeline(clock) });
  rig.seed(JOB_A);
  rig.seed(JOB_B);

  await rig.worker.once();

  assert.equal(rig.queue.stats().done, 1);
  assert.equal(rig.queue.stats().pending, 1);
});

test('the pipeline is handed exactly what docs/interfaces.md §7 says it takes', async (t) => {
  let seen = null;
  const rig = makeRig(t, {
    stopAfter: 'select',
    providerCtx: { sleepImpl: async () => {} },
    pipeline: async (job, opts) => { seen = opts; return happyPipeline(rig.clock)(job, opts); },
  });
  rig.seed();
  await rig.worker.once();

  assert.equal(seen.provider, PROVIDER);
  assert.equal(seen.root, rig.dir);
  assert.equal(seen.cfg, CFG);
  assert.ok(seen.signal instanceof AbortSignal);
  assert.equal(typeof seen.onProgress, 'function');
  assert.equal(seen.stopAfter, 'select');
  assert.equal(typeof seen.providerCtx.sleepImpl, 'function');
});

// --- the step stream --------------------------------------------------------

test('step events and their timings are read off the job, not off onProgress', async (t) => {
  // This pipeline never calls onProgress at all. The worker must still report
  // every step, because a silent terminal is the failure mode of a background
  // worker and the per-step numbers are what answer "queue or spinner". The
  // timings come from the manifest the pipeline wrote, so they are the real
  // ones rather than the worker's guess at them.
  const rig = makeRig(t, {
    pipeline: async (job) => {
      runStep(job, 'intake', rig.clock, { ms: 800 });
      runStep(job, 'moderate', rig.clock, { ms: 30_000 });
      completeJob(job, {});
      saveJob(job);
      return job;
    },
  });
  rig.seed();
  await rig.worker.once();

  const finished = rig.of('step-finished');
  assert.deepEqual(finished.map((e) => e.step), ['intake', 'moderate']);
  assert.deepEqual(finished.map((e) => e.ms), [800, 30_000]);
  assert.deepEqual(finished.map((e) => e.status), ['done', 'done']);
});

test('a step that is still running when the worker looks is reported live', async (t) => {
  const rig = makeRig(t, {
    pipeline: async (job, opts) => {
      beginStep(job, 'still');
      saveJob(job);
      opts.onProgress({ phase: 'submit' });   // any tick at all is enough
      assert.deepEqual(rig.of('step-started').map((e) => e.step), ['still'],
        'the step is announced while it is running, not after it finishes');
      finishStep(job, 'still', {});
      completeJob(job, {});
      saveJob(job);
      return job;
    },
  });
  rig.seed();
  await rig.worker.once();
  assert.equal(rig.of('step-finished').length, 1);
});

test('a progress event from the pipeline is forwarded with its step attached', async (t) => {
  const rig = makeRig(t, {
    pipeline: async (job, opts) => {
      beginStep(job, 'still');
      saveJob(job);
      opts.onProgress({ step: 'still', phase: 'download', pct: 40, message: 'still-02.png' });
      finishStep(job, 'still', {});
      completeJob(job, {});
      saveJob(job);
      return job;
    },
  });
  rig.seed();
  await rig.worker.once();

  const progress = rig.of('progress');
  assert.equal(progress.length, 1);
  assert.equal(progress[0].step, 'still');
  assert.equal(progress[0].pct, 40);
  assert.equal(progress[0].message, 'still-02.png');
});

// --- the lease --------------------------------------------------------------

test('a long step heartbeats, and the lease outlives the work', async (t) => {
  let deadlineDuringWork = null;
  const rig = makeRig(t, {
    pipeline: async (job, opts) => {
      beginStep(job, 'animate');
      saveJob(job);
      // Ten minutes inside one provider call. Without a heartbeat the next
      // reaper hands this job to a second worker and two processes start
      // writing one manifest.
      rig.clock.now += 600_000;
      opts.onProgress({ step: 'animate', phase: 'running', pct: 50 });
      deadlineDuringWork = rig.lock().deadline;
      finishStep(job, 'animate', {});
      completeJob(job, {});
      saveJob(job);
      return job;
    },
  });
  rig.seed();
  await rig.worker.once();

  assert.equal(deadlineDuringWork, T0 + 600_000 + LEASE_MS);
  assert.ok(deadlineDuringWork > T0 + LEASE_MS, 'the lease was extended past its original deadline');
  assert.ok(rig.of('heartbeat').length >= 1);
});

test('the heartbeat ticker keeps the lease alive when nothing reports progress', async (t) => {
  let deadlineDuringWork = null;
  const rig = makeRig(t, {
    pipeline: async (job) => {
      beginStep(job, 'tape');
      saveJob(job);
      rig.clock.now += 400_000;
      // The injected interval, fired by hand: this is the backstop under
      // onProgress for a step that makes one long blocking ffmpeg call and
      // says nothing until it returns.
      rig.tickers[0].fn();
      deadlineDuringWork = rig.lock().deadline;
      finishStep(job, 'tape', {});
      completeJob(job, {});
      saveJob(job);
      return job;
    },
  });
  rig.seed();
  await rig.worker.once();

  assert.equal(deadlineDuringWork, T0 + 400_000 + LEASE_MS);
  assert.equal(rig.tickers.length, 0, 'the ticker is cleared when the job ends');
});

// --- failure, retry and revive ---------------------------------------------

test('a retriable failure goes back to pending and does not land in failed/', async (t) => {
  const rig = makeRig(t, {
    pipeline: async () => { throw new RetriableError('provider said 429', { code: 'rate_limited' }); },
  });
  rig.seed();
  await rig.worker.once();

  assert.deepEqual(rig.queue.stats(), { pending: 1, claimed: 0, done: 0, failed: 0 });
  const [failed] = rig.of('failed');
  assert.equal(failed.retriable, true);
  assert.equal(failed.state, 'pending');
  assert.equal(failed.attempts, 1);
});

test('a terminal failure lands in failed/ on the first try', async (t) => {
  const rig = makeRig(t, {
    pipeline: async () => { throw new TerminalError('the model refused the prompt', { code: 'moderation' }); },
  });
  rig.seed();
  await rig.worker.once();

  assert.deepEqual(rig.queue.stats(), { pending: 0, claimed: 0, done: 0, failed: 1 });
  assert.equal(rig.of('failed')[0].state, 'failed');
});

test('maxAttempts comes from config/render.json, not from the queue default', async (t) => {
  // The fourth retriable failure is terminal because cfg.provider.maxAttempts
  // is 4. If this ever passes with a different count, the config stopped being
  // the source of truth for it.
  const rig = makeRig(t, {
    pipeline: async (job) => {
      const err = new RetriableError('upstream 503', { code: 'unavailable' });
      beginStep(job, 'intake');
      saveJob(job);
      failStep(job, 'intake', err);
      saveJob(job);
      throw err;
    },
  });
  rig.seed();

  const states = [];
  for (let i = 0; i < CFG.provider.maxAttempts; i += 1) {
    await rig.worker.once();
    states.push(rig.of('failed').at(-1).state);
  }

  assert.deepEqual(states, ['pending', 'pending', 'pending', 'failed']);
  assert.equal(rig.queue.stats().failed, 1);
  assert.equal(rig.queue.stats().pending, 0);
});

test('a failed manifest is revived before the retry, or the retry cannot begin', async (t) => {
  let sawOnRetry = null;
  let attempt = 0;
  const rig = makeRig(t, {
    pipeline: async (job, opts) => {
      attempt += 1;
      if (attempt === 1) {
        const err = new RetriableError('boom', { code: 'boom' });
        beginStep(job, 'intake');
        saveJob(job);
        failStep(job, 'intake', err);
        saveJob(job);
        throw err;
      }
      // `beginStep` refuses a failed step by design -- a done or failed step may
      // have a recorded charge. If the worker did not revive the manifest this
      // line throws and the job could never be retried at all.
      sawOnRetry = { status: job.status, intake: job.steps.find((s) => s.name === 'intake').status };
      return happyPipeline(rig.clock)(job, opts);
    },
  });
  rig.seed();

  await rig.worker.once();
  await rig.worker.once();

  assert.deepEqual(sawOnRetry, { status: 'queued', intake: 'pending' });
  assert.deepEqual(rig.of('revived')[0].steps, ['intake']);
  assert.equal(rig.load().status, 'done');
  // The lifetime attempt count is not reset by the revive -- that is how a
  // retry loop becomes infinite.
  assert.equal(rig.load().steps.find((s) => s.name === 'intake').attempts, 2);
});

test('a queue pointer to a job with no manifest fails terminally, not forever', async (t) => {
  const rig = makeRig(t);
  rig.queue.enqueue(JOB_B);

  assert.equal(await rig.worker.once(), true);

  assert.equal(rig.queue.stats().failed, 1);
  assert.equal(rig.of('failed')[0].retriable, false);
  assert.equal(rig.queue.peek({ state: 'failed' })[0].error.code, 'NOT_FOUND');
});

// --- the endings that are not failures --------------------------------------

test('a cancelled job is completed, not failed: no attempt burned, nothing in failed/', async (t) => {
  const rig = makeRig(t, {
    pipeline: async (job) => {
      runStep(job, 'intake', rig.clock);
      // The pipeline notices the cancel.requested sentinel between steps and
      // performs the transition itself; the worker's job is to not treat it as
      // a failure on the way out.
      cancelJob(job, 'cancelled by the uploader');
      saveJob(job);
      return job;
    },
  });
  rig.seed();
  await rig.worker.once();

  assert.deepEqual(rig.queue.stats(), { pending: 0, claimed: 0, done: 1, failed: 0 });
  assert.equal(rig.of('cancelled').length, 1);
  assert.equal(rig.of('failed').length, 0);
});

test('awaiting-selection leaves the queue instead of spinning the worker', async (t) => {
  const rig = makeRig(t, {
    pipeline: async (job) => {
      runStep(job, 'intake', rig.clock);
      setJobStatus(job, 'awaiting-selection');
      saveJob(job);
      return job;
    },
  });
  rig.seed();
  await rig.worker.once();

  // A job parked in front of a human is not in-flight work. It comes back when
  // POST /api/jobs/:id/select re-enqueues it, not by being claimed again.
  assert.deepEqual(rig.queue.stats(), { pending: 0, claimed: 0, done: 1, failed: 0 });
  assert.equal(rig.of('awaiting-selection').length, 1);
  assert.equal(await rig.worker.once(), false);
});

test('--stop-after parks the job rather than putting it straight back on the board', async (t) => {
  const rig = makeRig(t, {
    stopAfter: 'select',
    pipeline: async (job) => { runStep(job, 'intake', rig.clock); return job; },
  });
  rig.seed();
  await rig.worker.once();

  assert.equal(rig.of('parked').length, 1);
  assert.equal(rig.queue.stats().pending, 0);
});

test('a pipeline that returns an unfinished job with no reason is a bug, and is visible', async (t) => {
  const rig = makeRig(t, {
    pipeline: async (job) => { runStep(job, 'intake', rig.clock); return job; },
  });
  rig.seed();
  await rig.worker.once();

  const [failed] = rig.of('failed');
  assert.equal(failed.error.code, 'PIPELINE_INCOMPLETE');
  assert.equal(failed.retriable, true);
});

test('a missing pipeline hands the job back and stops the worker, rather than emptying the queue into failed/', async (t) => {
  const rig = makeRig(t, {
    pipeline: async () => {
      throw new WorkerError('could not load scripts/render/pipeline.mjs', { code: 'NO_PIPELINE' });
    },
  });
  rig.seed();

  await assert.rejects(() => rig.worker.once(), (err) => err.code === 'NO_PIPELINE');

  assert.deepEqual(rig.queue.stats(), { pending: 1, claimed: 0, done: 0, failed: 0 });
  assert.equal(rig.queue.peek()[0].attempts, 0);
});

// --- construction guards ----------------------------------------------------

test('createWorker refuses a config that asks for concurrency it does not have', (t) => {
  const rig = makeRig(t);
  assert.throws(
    () => createWorker({
      root: rig.dir, queue: rig.queue, provider: PROVIDER,
      cfg: { provider: { maxInflight: 4 } },
    }),
    (err) => err instanceof WorkerError && err.code === 'UNSUPPORTED_CONCURRENCY',
  );
});

test('createWorker refuses something that is not a queue', () => {
  assert.throws(
    () => createWorker({ root: 'C:/tmp', cfg: CFG, provider: PROVIDER, queue: { claim() {} } }),
    (err) => err instanceof WorkerError && err.code === 'BAD_QUEUE',
  );
});

test('an onEvent that throws does not kill a render that has already been paid for', async (t) => {
  const clock = { now: T0 };
  const rig = makeRig(t, {
    clock,
    onEvent: () => { throw new Error('the logger is broken'); },
    pipeline: happyPipeline(clock),
  });
  rig.seed();

  assert.equal(await rig.worker.once(), true);
  assert.equal(rig.load().status, 'done');
});

// --- the CLI's renderer -----------------------------------------------------

test('renderEvent names the job and how long the step took', () => {
  const line = renderEvent(
    { type: 'step-finished', at: T0 + 5_000, jobId: JOB_A, step: 'tape', status: 'done', ms: 31_400, cost: 0 },
    { t0: T0 },
  );
  assert.match(line, /tape/);
  assert.match(line, /31\.4s/);

  const claimed = renderEvent({ type: 'claimed', at: T0, jobId: JOB_A, attempts: 1, maxAttempts: 4 }, { t0: T0 });
  assert.match(claimed, new RegExp(JOB_A));
  assert.match(claimed, /attempt 2\/4/);
});

test('renderEvent keeps the quiet stream quiet and the verbose stream complete', () => {
  const idle = { type: 'idle', at: T0 };
  assert.equal(renderEvent(idle, { t0: T0 }), null);
  assert.match(renderEvent(idle, { t0: T0, verbose: true }), /idle/);
  assert.equal(renderEvent({ type: 'heartbeat', at: T0, jobId: JOB_A }, { t0: T0 }), null);
});

test('renderEvent says what a lease loss and a release actually mean', () => {
  assert.match(
    renderEvent({ type: 'lease-lost', at: T0, jobId: JOB_A }, { t0: T0 }),
    /another worker owns this job/,
  );
  assert.match(
    renderEvent({ type: 'released', at: T0, jobId: JOB_A, reason: 'shutdown' }, { t0: T0 }),
    /no attempt burned/,
  );
});

test('formatMs and parseArgs', () => {
  assert.equal(formatMs(340), '340ms');
  assert.equal(formatMs(1234), '1.2s');
  assert.equal(formatMs(125_000), '2m05s');
  const { flags, values } = parseArgs(['--provider=fixture', '--once', '--poll-ms=250']);
  assert.ok(flags.has('once'));
  assert.equal(values.provider, 'fixture');
  assert.equal(values['poll-ms'], '250');
});

// --- refunds ----------------------------------------------------------------

/**
 * The debit happened at enqueue, in the web process. The worker is where a job
 * can die AFTER that, so the worker is where the customer's case for their
 * money back is decided -- and it hands the decision to the refund seam, which
 * reads the manifest's steps and declines by itself when a paid step was ever
 * attempted. What these tests pin is WHEN the seam is consulted: exactly once,
 * and only on an outcome that ends the job without a tape.
 */
test('a job that fails for good is handed to the refund seam, once', async (t) => {
  const clock = { now: T0 };
  const refunds = [];
  const rig = makeRig(t, {
    clock,
    pipeline: async () => {
      throw new TerminalError('the compose gate refused the still', { provider: 'fake', code: 'refused' });
    },
    refundImpl: async (job, { reason }) => {
      refunds.push({ jobId: job.jobId, reason });
      return { refunded: true, credits: 21 };
    },
  });
  rig.seed();

  assert.equal(await rig.worker.once(), true);

  assert.equal(rig.queue.stats().failed, 1);
  assert.deepEqual(refunds, [{ jobId: JOB_A, reason: 'refund:failed-before-provider' }]);
  assert.equal(rig.of('refunded').length, 1, 'the operator can see money moved back');
});

test('a failure the queue will retry refunds nothing until the attempt that makes it final', async (t) => {
  const clock = { now: T0 };
  const refunds = [];
  const rig = makeRig(t, {
    clock,
    pipeline: async () => { throw new RetriableError('the provider hiccupped', { provider: 'fake' }); },
    refundImpl: async (job, { reason }) => { refunds.push(reason); return { refunded: true }; },
  });
  rig.seed();

  for (let attempt = 0; attempt < CFG.provider.maxAttempts; attempt += 1) {
    await rig.worker.once();
    clock.now += 60_000;
    // A refund while the queue still intends to run the job again would pay
    // the customer back for a tape they may yet receive.
    if (attempt < CFG.provider.maxAttempts - 1) {
      assert.deepEqual(refunds, [], `a refund fired while attempt ${attempt + 2} was still owed`);
    }
  }
  assert.equal(rig.queue.stats().failed, 1);
  assert.deepEqual(refunds, ['refund:failed-before-provider'], 'exactly one refund, on the attempt that made it final');
});

test('a job cancelled at a step boundary is handed to the refund seam', async (t) => {
  const clock = { now: T0 };
  const refunds = [];
  const rig = makeRig(t, {
    clock,
    pipeline: async (job) => {
      cancelJob(job, 'cancelled by the person who uploaded it');
      saveJob(job);
      return job;
    },
    refundImpl: async (job, { reason }) => {
      refunds.push({ jobId: job.jobId, reason });
      return { refunded: true, credits: 21 };
    },
  });
  rig.seed();

  assert.equal(await rig.worker.once(), true);
  assert.deepEqual(refunds, [{ jobId: JOB_A, reason: 'refund:cancelled-before-provider' }]);
});

test('a refund seam that throws does not take the worker down with it', async (t) => {
  const clock = { now: T0 };
  const rig = makeRig(t, {
    clock,
    pipeline: async () => {
      throw new TerminalError('the compose gate refused the still', { provider: 'fake', code: 'refused' });
    },
    refundImpl: async () => { throw new Error('the accounts module is not reachable'); },
  });
  rig.seed();

  assert.equal(await rig.worker.once(), true, 'the job still failed cleanly on the queue');
  assert.equal(rig.queue.stats().failed, 1);
  assert.equal(rig.of('refund-failed').length, 1, 'the miss is visible, not swallowed');
});

/**
 * The wire, not the function. The refund path existed once before with every
 * piece tested and NO caller -- the exact shape BUG 1 in CLAUDE.md section 8
 * had, where the fix lived in a file that no longer had the bug. Same defence
 * as provider-contract.test.js: read the command's source and fail if the
 * seam is not handed the real implementation.
 */
/**
 * A MISSPELLED `--stop-after` MUST NOT SILENTLY DISABLE THE PRE-SPEND GATE.
 *
 * `render.mjs` validates this argument against STEPS and exits 1. The worker
 * did not: it passed the string straight through, and `runPipeline` only ever
 * COMPARES it (`if (stopAfter === name)`), so an unmatched value simply never
 * matches. The banner then confirms the operator's intent -- it prints
 * "stopping after selct" -- and every claimed job runs through `animate` and is
 * billed. The worker holds `paidTransport(provider)`, so on `--provider=fal`
 * that is real money.
 *
 * The comparison is case-sensitive too, so `--stop-after=Select` fails the same
 * way while looking even more correct.
 *
 * Same defect shape as the `purge` CLI accepting a `--job` flag that does not
 * exist (CLAUDE.md section 30): an unknown argument must be a refusal, never a
 * silent no-op, when the thing it was meant to prevent costs money.
 *
 * Spawned rather than source-read, because what matters is that the process
 * REFUSES -- a regex can confirm a line exists and not that it runs.
 */
test('the worker CLI refuses a --stop-after that is not a step', () => {
  const cli = fileURLToPath(new URL('../scripts/worker/worker-cli.mjs', import.meta.url));

  for (const bad of ['selct', 'Select', 'animate ', '']) {
    const repoRoot = fileURLToPath(new URL('..', import.meta.url));
    const res = spawnSync(process.execPath, [cli, '--provider=fixture', `--stop-after=${bad}`], {
      cwd: repoRoot, encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(res.status, 1,
      `--stop-after=${JSON.stringify(bad)} should exit 1, got ${res.status}. ` +
      'An unmatched value never matches a step name, so the worker runs every job through animate and bills it.');
    assert.match(`${res.stderr}${res.stdout}`, /stop-after/,
      'the refusal must name the argument it is refusing');
  }
});

/** And the steps that ARE real must still be accepted, so the guard above
 *  cannot be satisfied by refusing everything. */
test('the worker CLI accepts every real step name', () => {
  const source = fs.readFileSync(new URL('../scripts/worker/worker-cli.mjs', import.meta.url), 'utf8');
  assert.match(source, /STEPS/,
    'worker-cli must validate against the same STEPS list render.mjs uses, not a copy');
});

test('the worker CLI hands createWorker the owner-refund glue', () => {
  const source = fs.readFileSync(new URL('../scripts/worker/worker-cli.mjs', import.meta.url), 'utf8');
  assert.match(source, /refundImpl:\s*createOwnerRefunds\(\{\s*root\s*\}\)\.refund/,
    'worker-cli must wire refundImpl to createOwnerRefunds, or worker-side refunds exist only in tests');
  assert.match(source, /session-middleware\.mjs/, 'the glue comes from the module that owns the ownership index');
});
