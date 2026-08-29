/**
 * The two things that decide whether this worker can be trusted to run
 * unattended: what it does when it loses its lease mid-render, and what it does
 * when someone stops it.
 *
 * Both are tested without a single real timer. The lease is expired by moving
 * an injected clock and calling `reapExpired()` -- which is exactly what
 * another worker's startup would do -- and the shutdown is driven by calling
 * `stop()` from inside the fake pipeline, which is where a SIGTERM actually
 * lands: in the middle of somebody's render. The signal handlers themselves are
 * proved against an injected `process`, because a test that sends a real SIGINT
 * to the test runner kills the test runner.
 *
 * The specific failure these tests exist to rule out: a worker that stalls past
 * its lease, gets reaped, wakes up and reports success on a job another process
 * is now rendering. Two writers on one manifest is not recoverable -- `saveJob`
 * writes a single fixed tmp file -- so the only safe behaviour is to stop
 * immediately and write nothing further.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import { createQueue } from '../scripts/queue/queue.mjs';
import {
  createJob, loadJob, saveJob, beginStep, finishStep, completeJob, nextStep, jobPaths,
} from '../scripts/render/job.mjs';
import { createWorker } from '../scripts/worker/worker.mjs';

const T0 = Date.UTC(2026, 7, 20, 14, 45, 0);
const LEASE_MS = 900_000;
const JOB_A = '20260820-144501-a3f19c';
const JOB_B = '20260820-144502-b41e07';

const CFG = Object.freeze({
  provider: { maxInflight: 1, maxAttempts: 4, backoffBaseMs: 1000, pollIntervalMs: 5000, pollTimeoutMs: 900_000 },
});

const PROVIDER = Object.freeze({ id: 'fake', capabilities: {} });

const INPUT = Object.freeze({
  photo: { path: 'input/photo.jpg', sha256: 'a'.repeat(64), width: 1024, height: 768 },
  place: { kind: 'preset', value: 'schrebergarten-august' },
  outfit: { kind: 'preset', value: 'trainingsjacke' },
  stillCount: 3,
  consent: { granted: true, at: new Date(T0).toISOString(), text: 'I agree that this is my face.' },
});

const QUEUE_METHODS = ['claim', 'heartbeat', 'complete', 'fail', 'release', 'reapExpired'];

function makeRig(t, { pipeline, clock = { now: T0 }, ...overrides } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-worker-life-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const nowImpl = () => clock.now;
  const queue = createQueue({
    root: dir, nowImpl, leaseMs: LEASE_MS, maxAttempts: CFG.provider.maxAttempts,
  });

  // The worker gets a recording wrapper; the tests drive the raw queue directly
  // when they are standing in for somebody else's reaper, so `calls` holds only
  // what the worker itself did.
  const calls = [];
  const watched = { ...queue };
  for (const name of QUEUE_METHODS) {
    watched[name] = (...args) => { calls.push(name); return queue[name](...args); };
  }

  const events = [];
  const tickers = [];
  const rig = {
    dir, clock, queue, calls, events, tickers,
    types: () => events.map((e) => e.type),
    of: (type) => events.filter((e) => e.type === type),
    seed(jobId = JOB_A) {
      createJob({ root: dir, jobId, provider: 'fixture', cfg: CFG, nowImpl, input: INPUT });
      queue.enqueue(jobId);
      return jobId;
    },
    load: (jobId = JOB_A) => loadJob({ root: dir, jobId, nowImpl }),
  };

  rig.worker = createWorker({
    root: dir,
    cfg: CFG,
    provider: PROVIDER,
    queue: watched,
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

  return rig;
}

function runStep(job, name, clock, { ms = 1200, onProgress } = {}) {
  beginStep(job, name);
  saveJob(job);
  onProgress?.({ step: name, phase: 'running', pct: 50 });
  clock.now += ms;
  finishStep(job, name, { output: {} });
  saveJob(job);
  onProgress?.({ step: name, phase: 'done' });
}

const transitions = (calls) => calls.filter((c) => ['complete', 'fail', 'release'].includes(c));

// --- the lease outlives the work, or the work stops --------------------------

test('a lease lost mid-render aborts the pipeline and never reports success', async (t) => {
  let abortedInsidePipeline = null;
  const rig = makeRig(t, {
    pipeline: async (job, opts) => {
      beginStep(job, 'still');
      saveJob(job);

      // Sixteen minutes inside a generation call with no heartbeat landing.
      // Another worker starts up, reaps the dead lease, and this job is now
      // somebody else's.
      rig.clock.now += LEASE_MS + 1;
      assert.deepEqual(rig.queue.reapExpired(), [JOB_A]);

      // The next heartbeat is the first moment this process can find out.
      opts.onProgress({ step: 'still', phase: 'running', pct: 60 });
      abortedInsidePipeline = opts.signal.aborted;

      // Even if the work "succeeded", reporting it would overwrite the result
      // of whoever owns the job now. In memory only -- nothing may reach disk.
      completeJob(job, { videoPath: 'timestamp.mp4' });
      return job;
    },
  });
  rig.seed();

  await rig.worker.once();

  assert.equal(abortedInsidePipeline, true, 'the pipeline was told to stop through its AbortSignal');
  assert.equal(rig.of('lease-lost').length, 1);
  assert.deepEqual(transitions(rig.calls), [], 'no complete(), no fail(), no release() on a lease we no longer hold');
  // The job is exactly where the reaper left it: back in pending, one attempt
  // spent, and free for the worker that now owns it.
  assert.deepEqual(rig.queue.stats(), { pending: 1, claimed: 0, done: 0, failed: 0 });
  assert.equal(rig.queue.peek()[0].attempts, 1);
  // Nothing was written after the abort: the manifest still says `running`.
  assert.equal(rig.load().status, 'running');
});

test('the lease is checked once more before a result is reported', async (t) => {
  // The pipeline finishes cleanly but the lease died during the last step and
  // nothing reported progress, so the only chance to notice is the sync the
  // worker does when the pipeline returns. It must take it.
  const rig = makeRig(t, {
    pipeline: async (job) => {
      beginStep(job, 'publish');
      saveJob(job);
      rig.clock.now += LEASE_MS + 1;
      rig.queue.reapExpired();
      finishStep(job, 'publish', {});
      completeJob(job, { videoPath: 'timestamp.mp4' });
      saveJob(job);
      return job;
    },
  });
  rig.seed();

  await rig.worker.once();

  assert.equal(rig.of('lease-lost').length, 1);
  assert.deepEqual(transitions(rig.calls), []);
  assert.equal(rig.queue.stats().done, 0);
});

// --- graceful shutdown -------------------------------------------------------

test('a stop finishes the current step, releases the job and burns no attempt', async (t) => {
  let abortedInsidePipeline = null;
  const rig = makeRig(t, {
    pipeline: async (job, opts) => {
      runStep(job, 'intake', rig.clock, { onProgress: opts.onProgress });

      // SIGTERM lands here, in the middle of the next step.
      void rig.worker.stop({ reason: 'SIGTERM' });

      runStep(job, 'moderate', rig.clock, { onProgress: opts.onProgress });
      abortedInsidePipeline = opts.signal.aborted;
      return job;    // the pipeline stops between steps, as it is specified to
    },
  });
  rig.seed();

  await rig.worker.once();

  assert.equal(abortedInsidePipeline, true, 'the abort arrived at a step boundary, not mid-step');
  assert.deepEqual(transitions(rig.calls), ['release'],
    'release() hands the job back; fail() would burn an attempt a clean restart never earned');
  assert.deepEqual(rig.queue.stats(), { pending: 1, claimed: 0, done: 0, failed: 0 });
  assert.equal(rig.queue.peek()[0].attempts, 0);
  assert.equal(rig.of('released')[0].reason, 'shutdown');

  // And the whole point of finishing the step: the work already done -- which
  // for `still` would mean money already spent -- is on disk and resumes.
  const job = rig.load();
  assert.equal(job.steps.find((s) => s.name === 'intake').status, 'done');
  assert.equal(job.steps.find((s) => s.name === 'moderate').status, 'done');
  assert.equal(nextStep(job), 'expand');
});

test('a stop still lands when the pipeline reports no progress at all', async (t) => {
  // The step boundary is diffed off the job on the heartbeat tick, so shutdown
  // does not depend on the pipeline choosing to call onProgress.
  let abortedInsidePipeline = null;
  const rig = makeRig(t, {
    pipeline: async (job, opts) => {
      runStep(job, 'intake', rig.clock);
      void rig.worker.stop({ reason: 'SIGINT' });
      rig.tickers[0].fn();
      abortedInsidePipeline = opts.signal.aborted;
      return job;
    },
  });
  rig.seed();

  await rig.worker.once();

  assert.equal(abortedInsidePipeline, true);
  assert.deepEqual(transitions(rig.calls), ['release']);
});

test('a job that finishes before the stop is completed, not released', async (t) => {
  const rig = makeRig(t, {
    pipeline: async (job, opts) => {
      runStep(job, 'intake', rig.clock, { onProgress: opts.onProgress });
      void rig.worker.stop({ reason: 'SIGTERM' });
      completeJob(job, { videoPath: 'timestamp.mp4' });
      saveJob(job);
      return job;
    },
  });
  rig.seed();

  await rig.worker.once();

  assert.deepEqual(transitions(rig.calls), ['complete']);
  assert.equal(rig.queue.stats().done, 1);
});

test('once() refuses to claim anything new after a stop', async (t) => {
  const rig = makeRig(t);
  rig.seed();
  await rig.worker.stop();
  assert.equal(await rig.worker.once(), false);
  assert.equal(rig.queue.stats().pending, 1);
});

// --- signals -----------------------------------------------------------------

test('the first signal stops gracefully and the second one exits immediately', async (t) => {
  const fakeProcess = new EventEmitter();
  const exits = [];
  fakeProcess.exit = (code) => exits.push(code);

  let sleeps = 0;
  const rig = makeRig(t, {
    signals: true,
    processImpl: fakeProcess,
    sleepImpl: async () => {
      sleeps += 1;
      // Ctrl-C, then Ctrl-C again because nothing appeared to happen. Someone
      // pressing it twice means it.
      fakeProcess.emit('SIGINT');
      fakeProcess.emit('SIGINT');
    },
  });

  await rig.worker.start();

  assert.equal(sleeps, 1);
  assert.deepEqual(exits, [130], 'the second signal exits without unwinding; the lease is reaped next startup');
  assert.equal(rig.of('signal')[0].reason, 'SIGINT');
  assert.equal(rig.of('forced').length, 1);
  assert.equal(rig.types().at(-1), 'stopped');
  assert.equal(fakeProcess.listenerCount('SIGINT'), 0, 'handlers are removed when the loop exits');
});

// --- the loop ----------------------------------------------------------------

test('start() is once() in a loop, and stops cleanly when there is nothing left', async (t) => {
  const clock = { now: T0 };
  let idlePolls = 0;
  const rig = makeRig(t, {
    clock,
    pipeline: async (job, opts) => {
      runStep(job, 'intake', clock, { onProgress: opts.onProgress });
      completeJob(job, { videoPath: 'timestamp.mp4' });
      saveJob(job);
      return job;
    },
    sleepImpl: async () => { idlePolls += 1; void rig.worker.stop(); },
  });
  rig.seed(JOB_A);
  rig.seed(JOB_B);

  await rig.worker.start();

  assert.equal(rig.queue.stats().done, 2);
  assert.equal(idlePolls, 1, 'the worker only waits when the queue is actually empty');
  assert.equal(rig.types().at(-1), 'stopped');
  assert.equal(rig.worker.running, false);
});

test('reapExpired() runs before the first claim, which is what recovers a crashed run', async (t) => {
  const clock = { now: T0 };
  const rig = makeRig(t, {
    clock,
    pipeline: async (job) => {
      beginStep(job, 'intake');
      finishStep(job, 'intake', {});
      completeJob(job, { videoPath: 'timestamp.mp4' });
      saveJob(job);
      return job;
    },
    sleepImpl: async () => { void rig.worker.stop(); },
  });
  rig.seed();

  // A previous worker claimed this job and was killed. Its lock outlives it --
  // the lock is a file, and the file does not care that the process is gone.
  rig.queue.claim({ workerId: 'a-worker-that-died' });
  clock.now += LEASE_MS + 1;

  await rig.worker.start();

  assert.equal(rig.calls[0], 'reapExpired',
    'without this line the queue looks stuck and nothing says why');
  assert.ok(rig.calls.indexOf('reapExpired') < rig.calls.indexOf('claim'));
  assert.deepEqual(rig.of('reaped')[0].jobIds, [JOB_A]);
  assert.equal(rig.queue.stats().done, 1, 'the stranded job was picked up and finished');
});

test('reap() is not run twice when the CLI has already done it for the banner', async (t) => {
  const rig = makeRig(t, { sleepImpl: async () => { void rig.worker.stop(); } });
  await rig.worker.reap();
  await rig.worker.start();
  assert.equal(rig.calls.filter((c) => c === 'reapExpired').length, 1);
});

/**
 * A JOB REAPED TO DEATH GETS ITS CREDITS BACK.
 *
 * The debit lands at enqueue, in the web process. The only refund trigger was
 * inside `runOne`'s failure path -- but a lease expiring for the last time is
 * made terminal by `reapExpired` itself, in a module that holds no token and
 * knows nothing about accounts. So a job killed by four lease expiries (a
 * worker hard-killed four times, or simply stalled past its lease) left the
 * customer down 21 CR with no provider ever called, no `refunded` event, and no
 * `REFUND MISSED` line either. Silence, which is the one outcome this design
 * says it will not produce.
 *
 * Neither module could see it alone: the queue has no accounts, and the worker
 * was never told which reaped jobs went terminal rather than back to pending.
 */
test('a lease reaped for the last time refunds the customer', async (t) => {
  const refunds = [];
  const rig = makeRig(t, {
    refundImpl: async (job, { reason }) => {
      refunds.push({ jobId: job.jobId, reason });
      return { refunded: true, credits: 21, accountId: 'acct-1' };
    },
  });
  const jobId = rig.seed();

  // Burn every attempt by letting the lease expire, exactly as a worker being
  // killed mid-render does. maxAttempts is 4.
  for (let i = 0; i < CFG.provider.maxAttempts; i += 1) {
    rig.queue.claim({ workerId: `dead-${i}` });
    rig.clock.now += LEASE_MS + 1000;
    await rig.worker.reap();
  }

  assert.equal(rig.queue.stats().failed, 1, 'the job should be terminal after maxAttempts expiries');
  assert.deepEqual(refunds.map((r) => r.jobId), [jobId],
    'the customer was never refunded for a job that never reached a provider');
  assert.match(refunds[0].reason, /lease/, 'the refund reason should name why');
  assert.equal(rig.of('refunded').length, 1, 'the refund was not announced');
});

/** And the announcement must not call a terminal reap "back to pending" -- an
 *  operator then looks for the job in a directory it is not in. */
test('a terminal reap is reported separately from one that goes back to pending', async (t) => {
  const rig = makeRig(t);
  rig.seed();
  rig.queue.claim({ workerId: 'dead' });
  rig.clock.now += LEASE_MS + 1000;
  await rig.worker.reap();

  const [event] = rig.of('reaped');
  assert.deepEqual(event.failed, [], 'attempt 1 of 4 goes back to pending, not to failed');
  assert.deepEqual(event.pending, event.jobIds, 'every job this reap moved went back to pending');
});

// ---------------------------------------------------------------------------
// retention: the sweep that keeps the consent promise
// ---------------------------------------------------------------------------

test('the worker sweeps retention at startup, so the promise does not need a cron', async (t) => {
  const rig = makeRig(t, {
    pipeline: async (job) => job,
    retention: { photoDays: 7, jobDays: 30 },
    sleepImpl: async () => { void rig.worker.stop(); },
  });
  // Older than `retention.photoDays`, which is what the consent text quotes.
  const oldId = '20260101-120000-0000aa';
  const stale = createJob({
    root: rig.dir, jobId: oldId, provider: 'fixture', cfg: CFG, input: INPUT,
    nowImpl: () => new Date(T0 - 40 * 86_400_000),
  });
  const paths = jobPaths(rig.dir, stale.jobId);
  fs.writeFileSync(`${paths.input}/photo.jpg`, Buffer.from('a face 40 days old'));

  await rig.worker.start();

  assert.equal(fs.existsSync(paths.dir), false,
    'a job 40 days old is past the job window and the whole directory goes');
  const [purged] = rig.of('purged');
  assert.ok(purged, 'the sweep is observable -- an unreported deletion is not auditable');
  assert.equal(purged.jobsDeleted, 1);
});

test('a fresh job is never swept, and the sweep can be switched off entirely', async (t) => {
  // `cfg` DOES carry a retention block here, so `retention: null` has something
  // real to override. Without that, this test would pass whether or not the
  // switch works.
  const rig = makeRig(t, {
    pipeline: async (job) => job,
    cfg: { ...CFG, retention: { photoDays: 7, jobDays: 30 } },
    retention: null,
    sleepImpl: async () => { void rig.worker.stop(); },
  });
  const stale = createJob({
    root: rig.dir, jobId: '20260101-120000-0000bb', provider: 'fixture', cfg: CFG, input: INPUT,
    nowImpl: () => new Date(T0 - 40 * 86_400_000),
  });
  const young = rig.seed('20260820-120000-0000cc');

  await rig.worker.start();

  assert.ok(fs.existsSync(jobPaths(rig.dir, stale.jobId).dir),
    'retention: null means an operator has taken deletion somewhere else and this worker must not guess');
  assert.ok(fs.existsSync(jobPaths(rig.dir, young).dir));
  assert.equal(rig.of('purged').length, 0);
});

test('the sweep takes its windows from cfg.retention, which is what the consent text quotes', async (t) => {
  const rig = makeRig(t, {
    pipeline: async (job) => job,
    cfg: { ...CFG, retention: { photoDays: 7, jobDays: 30 } },
    sleepImpl: async () => { void rig.worker.stop(); },
  });
  const stale = createJob({
    root: rig.dir, jobId: '20260101-120000-0000dd', provider: 'fixture', cfg: CFG, input: INPUT,
    nowImpl: () => new Date(T0 - 10 * 86_400_000),
  });
  const paths = jobPaths(rig.dir, stale.jobId);
  fs.writeFileSync(`${paths.input}/photo.jpg`, Buffer.from('a face 10 days old'));

  await rig.worker.start();

  assert.deepEqual(fs.readdirSync(paths.input), [], 'ten days is past photoDays');
  assert.ok(fs.existsSync(paths.manifest), 'and inside jobDays, so the job itself stays');
  assert.equal(rig.of('purged')[0].photosDeleted, 1);
});

test('a worker with no retention configured anywhere sweeps nothing rather than inventing a policy', async (t) => {
  const rig = makeRig(t, {
    pipeline: async (job) => job,
    sleepImpl: async () => { void rig.worker.stop(); },
  });
  const stale = createJob({
    root: rig.dir, jobId: '20260101-120000-0000ee', provider: 'fixture', cfg: CFG, input: INPUT,
    nowImpl: () => new Date(T0 - 400 * 86_400_000),
  });

  await rig.worker.start();

  assert.ok(fs.existsSync(jobPaths(rig.dir, stale.jobId).dir),
    'CFG carries no retention block; a worker that guessed one would enforce a policy nobody was shown');
});

test('the sweep never deletes a job somebody holds a live lease on', async (t) => {
  // The nasty case is the HOURLY sweep, not the startup one: a job old enough to
  // be due that another worker has already claimed. Age says delete; the lease
  // says not yet, and the lease wins -- otherwise the directory disappears from
  // under a live render and the customer loses a tape they paid for. It is not
  // kept forever, just until whoever holds it lets go.
  const rig = makeRig(t, { retention: { photoDays: 7, jobDays: 30 } });
  const oldId = '20260101-120000-0000ff';
  createJob({
    root: rig.dir, jobId: oldId, provider: 'fixture', cfg: CFG, input: INPUT,
    nowImpl: () => new Date(T0 - 400 * 86_400_000),
  });
  rig.queue.enqueue(oldId);
  const claim = rig.queue.claim({ workerId: 'another-worker-mid-render' });
  assert.equal(claim.jobId, oldId);

  const held = rig.worker.sweepRetention();

  assert.ok(fs.existsSync(jobPaths(rig.dir, oldId).manifest),
    'a claimed job survives its own retention sweep');
  assert.equal(held.jobsDeleted, 0);

  // And it is not immune forever -- the next sweep after the lease is gone takes it.
  rig.queue.release(oldId, claim.token);
  const freed = rig.worker.sweepRetention();

  assert.equal(fs.existsSync(jobPaths(rig.dir, oldId).dir), false,
    'once nobody holds it, the promise applies again');
  assert.equal(freed.jobsDeleted, 1);
});

test('a queue that cannot answer stops the sweep LOUDLY, not silently', async (t) => {
  // The first version returned null here with no event. A queue that throws
  // every time would have stopped retention running forever, and nothing
  // anywhere would have said so -- which is F1 wearing a different hat: a
  // promise with nothing enforcing it and no signal that it stopped.
  const rig = makeRig(t, { retention: { photoDays: 7, jobDays: 30 } });
  rig.worker.queueForTest = null;
  const broken = { ...rig.queue, peek() { throw new Error('queue index unreadable'); } };
  const worker = createWorker({
    root: rig.dir, cfg: CFG, provider: PROVIDER, queue: broken,
    retention: { photoDays: 7, jobDays: 30 },
    nowImpl: () => rig.clock.now, onEvent: (e) => rig.events.push(e),
    runPipelineImpl: async (job) => job,
  });
  createJob({
    root: rig.dir, jobId: '20260101-120000-00aa11', provider: 'fixture', cfg: CFG, input: INPUT,
    nowImpl: () => new Date(T0 - 400 * 86_400_000),
  });

  const result = worker.sweepRetention();

  assert.equal(result, null, 'nothing was swept, because "unknown" reads as "somebody might"');
  const [purged] = rig.of('purged');
  assert.ok(purged, 'but it is REPORTED -- silence here is the bug');
  assert.match(purged.errors[0].message, /queue index unreadable/);
  assert.ok(fs.existsSync(jobPaths(rig.dir, '20260101-120000-00aa11').dir),
    'and the 400-day-old job survives this pass rather than being swept blind');
});

test('a malformed retention block is refused at construction, not silently ignored', () => {
  // `purge-cli.mjs` refuses loudly -- "will not invent one". The worker is the
  // path that actually runs on a schedule, so it must not be the lenient one:
  // a typo in cfg.retention that silently disables retention is the promise
  // quietly going unkept, which is exactly F1.
  assert.throws(
    () => createWorker({
      root: 'C:/tmp/nope', cfg: CFG, provider: PROVIDER, queue: makeQueueStub(),
      retention: { photoDays: 7 },
    }),
    { code: 'BAD_RETENTION' },
    'half a retention policy is not a retention policy',
  );

  assert.throws(
    () => createWorker({
      root: 'C:/tmp/nope', cfg: { ...CFG, retention: { photoDays: 'seven', jobDays: 30 } },
      provider: PROVIDER, queue: makeQueueStub(),
    }),
    { code: 'BAD_RETENTION' },
  );
});

test('retention: null is still an explicit, allowed way to switch the sweep off', () => {
  const worker = createWorker({
    root: 'C:/tmp/nope', cfg: { ...CFG, retention: { photoDays: 7, jobDays: 30 } },
    provider: PROVIDER, queue: makeQueueStub(), retention: null,
  });
  assert.equal(worker.sweepRetention(), null, 'off on purpose is not the same as misconfigured');
});

/** The six methods createWorker asserts on a queue, and nothing else. */
function makeQueueStub() {
  const noop = () => {};
  return {
    claim: () => null, heartbeat: noop, complete: noop,
    fail: noop, release: noop, reapExpired: () => [],
  };
}
