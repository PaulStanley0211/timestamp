/**
 * Resume, driven the way scripts/render/pipeline.mjs will drive it.
 *
 * This file deliberately contains a miniature pipeline rather than a list of
 * unit assertions. Resume is not a property of any one function -- it is the
 * property that `loadJob`, `nextStep`, `beginStep`, `recordIntent` and the
 * frozen `resolved` block hold together across a process that died. A test that
 * only pokes them individually would pass while the combination lost money.
 *
 * "Crash" here means: throw out of the runner, keep nothing in memory, and read
 * the next run's entire world back from disk. That is the same information a
 * real worker has after a kill -9, which is the only fair simulation.
 *
 * The two numbers that matter are asserted everywhere: the provider is called
 * exactly once per paid step no matter where the process died, and a step that
 * was already done keeps its original timestamps and its original cost.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  STEPS,
  beginStep,
  completeIntent,
  completeJob,
  createJob,
  failStep,
  finishStep,
  freezeResolved,
  isResumable,
  loadJob,
  nextStep,
  readIntent,
  recordIntent,
  retryStep,
  saveJob,
  skipStep,
  stepStatus,
} from '../scripts/render/job.mjs';

// --------------------------------------------------------------------------
// harness
// --------------------------------------------------------------------------

const roots = [];
function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-resume-')).replace(/\\/g, '/');
  roots.push(root);
  return root;
}
test.after(() => {
  for (const root of roots) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* the OS will get it */ }
  }
});

function clockFrom(iso) {
  let t = Date.parse(iso);
  return { now: () => new Date(t), tick(ms) { t += ms; return this; } };
}

const ID = '20260820-144501-a3f19c';

const input = () => ({
  photo: { path: 'input/photo.jpg', sha256: 'b'.repeat(64), width: 1200, height: 1600 },
  place: { kind: 'preset', value: 'schrebergarten-august', photoPath: null, photoSha256: null },
  outfit: { kind: 'preset', value: 'trainingsjacke' },
  stillCount: 3,
  consent: { granted: true, at: '2026-08-20T14:45:00.000Z', text: 'I agree.' },
});

/** Thrown to simulate the process going away. Nothing after it runs, and the
 *  manifest on disk is whatever the last `saveJob` left there. */
class Crash extends Error {}

/** Thrown when an intent record says a request may already be in flight. The
 *  pipeline surfaces this; it does not resolve it. */
class NeedsDecision extends Error {
  constructor(step, key) {
    super(`${step} has an open intent (${key}) -- a request may already have been submitted`);
    this.step = step;
    this.key = key;
  }
}

const PAID = new Set(['still', 'animate']);

function fakeProvider() {
  const calls = { still: [], animate: [] };
  return {
    calls,
    still(key) {
      calls.still.push(key);
      return {
        output: { stills: [{ path: 'stills/still-01.png', index: 0, seed: 12 }], meta: { requestId: `r${calls.still.length}` } },
        cost: { estimated: 0.12, actual: 0.14 },
      };
    },
    animate(key) {
      calls.animate.push(key);
      return {
        output: { segments: [{ path: 'segments/seg-01.mp4', seconds: 8 }, { path: 'segments/seg-02.mp4', seconds: 7 }] },
        cost: { estimated: 1.2, actual: 1.35 },
      };
    },
  };
}

const resolvedFor = (job) => ({
  catalogHash: '4f2a9c',
  lookHash: '9b1d0e',
  place: { id: job.input.place.value },
  outfit: { id: job.input.outfit.value },
  look: { tape: { grainStrength: 20 } },
  cfg: { durationSeconds: 15, fps: 25, totalFrames: 375 },
  stillPrompt: { prompt: 'the person in the reference image, in an allotment garden', negativePrompt: 'smartphone', fragments: {} },
  motionPrompts: [{ prompt: 'the curtain moves at the window', negativePrompt: '' }],
  segments: [{ index: 1, seconds: 8, seed: 111 }, { index: 2, seconds: 7, seed: 222 }],
  seeds: { still: 111, audio: 333, stamp: 444 },
});

/**
 * The miniature pipeline. Executes STEPS in order, skipping any already done --
 * that is the whole of resume -- and saving after every transition.
 *
 * `crashAt` is `{ step, when }` where `when` is one of:
 *   before-begin   the classic crash between two steps
 *   after-begin    the step is marked running and nothing else happened
 *   after-intent   the intent is on disk and the request has NOT gone out
 *   after-call     the request went out and no result has been recorded
 */
function runPipeline(job, { provider, clock, crashAt = null, onExisting = 'stop', counters }) {
  const crash = (step, when) => {
    if (crashAt && crashAt.step === step && crashAt.when === when) throw new Crash(`${step}:${when}`);
  };

  while (isResumable(job)) {
    const name = nextStep(job);
    crash(name, 'before-begin');

    beginStep(job, name);
    saveJob(job);
    crash(name, 'after-begin');
    clock.tick(1000);

    if (name === 'expand' && job.input.place.kind === 'preset' && job.input.outfit.kind === 'preset') {
      skipStep(job, name, 'both place and outfit are presets');
      saveJob(job);
      continue;
    }

    if (name === 'compose') {
      counters.compose += 1;
      // Throws if anything ever tries to compose twice, which is exactly what a
      // resume that re-derived `resolved` would do.
      freezeResolved(job, resolvedFor(job));
    }

    if (PAID.has(name)) {
      const payload = { prompt: job.resolved.stillPrompt.prompt, seed: job.resolved.seeds.still, step: name };
      const { key, existing } = recordIntent(job, name, payload);
      if (existing) {
        // The pipeline SEES the case and decides. It does not resubmit silently
        // and it does not skip silently -- both are guesses about money.
        if (onExisting === 'stop') throw new NeedsDecision(name, key);
        completeIntent(job, name, { reconciled: true });
        finishStep(job, name, { output: { reconciled: true }, cost: { estimated: 0, actual: 0 } });
        saveJob(job);
        continue;
      }
      crash(name, 'after-intent');
      const result = provider[name](key);
      crash(name, 'after-call');
      completeIntent(job, name, result.output.meta ?? { ok: true });
      finishStep(job, name, { output: result.output, cost: result.cost });
      saveJob(job);
      continue;
    }

    finishStep(job, name, { output: { ran: name } });
    saveJob(job);
  }

  if (nextStep(job) === null) {
    completeJob(job, { videoPath: 'timestamp.mp4', posterPath: 'poster.jpg', durationSeconds: 15, frames: 375, lufs: -27 });
    saveJob(job);
  }
  return job;
}

function freshJob({ root = tmpRoot(), clock = clockFrom('2026-08-20T14:45:01.000Z') } = {}) {
  const job = createJob({ root, jobId: ID, input: input(), provider: 'fixture', cfg: {}, nowImpl: clock.now });
  return { job, root, clock };
}

// --------------------------------------------------------------------------
// the drill
// --------------------------------------------------------------------------

test('create, run three steps, crash, load, continue from step four', () => {
  const clock = clockFrom('2026-08-20T14:45:01.000Z');
  const { root } = freshJob({ clock });

  // Three steps, by hand, exactly as the pipeline would: begin, work, finish,
  // save after every transition.
  {
    const job = loadJob({ root, jobId: ID, nowImpl: clock.now });
    for (const [name, cost] of [['intake', 0], ['moderate', 0], ['expand', 0.002]]) {
      beginStep(job, name); saveJob(job);
      clock.tick(2000);
      finishStep(job, name, { output: { ran: name }, cost: { estimated: cost, actual: cost } });
      saveJob(job);
      clock.tick(500);
    }
  }
  // -- the process dies here. Nothing above is in memory any more. --

  const before = JSON.parse(fs.readFileSync(`${root}/out/jobs/${ID}/manifest.json`, 'utf8'));
  clock.tick(3_600_000);                       // an hour later, a different worker
  const resumed = loadJob({ root, jobId: ID, nowImpl: clock.now });

  assert.equal(nextStep(resumed), 'compose', 'resume is nextStep and nothing else');
  assert.equal(isResumable(resumed), true);
  assert.equal(resumed.status, 'running');

  for (const name of ['intake', 'moderate', 'expand']) {
    const step = resumed.steps.find((s) => s.name === name);
    const original = before.steps.find((s) => s.name === name);
    assert.equal(step.status, 'done');
    assert.deepEqual(step, original,
      `${name} was restamped or re-priced on resume -- a ledger built on that is fiction`);
  }
  assert.equal(resumed.cost.actual, 0.002, 'the job total survived the crash');
  assert.equal(resumed.steps.slice(3).every((s) => s.status === 'pending'), true);
});

test('a crash between any two steps resubmits nothing that was already paid for', () => {
  for (const killBefore of STEPS) {
    const clock = clockFrom('2026-08-20T14:45:01.000Z');
    const { root } = freshJob({ clock });
    const provider = fakeProvider();
    const counters = { compose: 0 };

    assert.throws(
      () => runPipeline(loadJob({ root, jobId: ID, nowImpl: clock.now }), {
        provider, clock, counters, crashAt: { step: killBefore, when: 'before-begin' },
      }),
      Crash,
      `the run was supposed to die before ${killBefore}`,
    );

    const resumed = runPipeline(loadJob({ root, jobId: ID, nowImpl: clock.now }), { provider, clock, counters });

    assert.equal(resumed.status, 'done', `job did not finish after a crash before ${killBefore}`);
    assert.equal(nextStep(resumed), null);
    assert.equal(provider.calls.still.length, 1, `still was submitted twice across a crash before ${killBefore}`);
    assert.equal(provider.calls.animate.length, 1, `animate was submitted twice across a crash before ${killBefore}`);
    assert.equal(counters.compose, 1, `compose ran twice across a crash before ${killBefore}`);
    assert.equal(resumed.cost.actual, 1.49);
    assert.equal(stepStatus(resumed, 'expand'), 'skipped');
    assert.equal(resumed.steps.filter((s) => s.status === 'done').length, STEPS.length - 1);
  }
});

test('the frozen resolved block is never re-derived, however many times a job resumes', () => {
  const clock = clockFrom('2026-08-20T14:45:01.000Z');
  const { root } = freshJob({ clock });
  const provider = fakeProvider();
  const counters = { compose: 0 };

  // Die after compose, twice in a row, then finish.
  assert.throws(() => runPipeline(loadJob({ root, jobId: ID, nowImpl: clock.now }), {
    provider, clock, counters, crashAt: { step: 'still', when: 'before-begin' },
  }), Crash);

  const midway = loadJob({ root, jobId: ID, nowImpl: clock.now });
  const frozen = JSON.parse(JSON.stringify(midway.resolved));
  assert.equal(midway.resolved.catalogHash, '4f2a9c');
  assert.throws(() => { midway.resolved.cfg.fps = 30; }, TypeError,
    'a resumed job must not be able to edit the block that defines what it is rendering');

  assert.throws(() => runPipeline(loadJob({ root, jobId: ID, nowImpl: clock.now }), {
    provider, clock, counters, crashAt: { step: 'animate', when: 'before-begin' },
  }), Crash);

  const done = runPipeline(loadJob({ root, jobId: ID, nowImpl: clock.now }), { provider, clock, counters });
  assert.equal(counters.compose, 1, 'compose ran again on resume, so the render was redefined halfway through');
  assert.deepEqual(done.resolved, frozen);
  assert.equal(done.status, 'done');
});

// --------------------------------------------------------------------------
// the intent record
// --------------------------------------------------------------------------

test('a crash after the request went out is visible as existing:true, not papered over', () => {
  const clock = clockFrom('2026-08-20T14:45:01.000Z');
  const { root } = freshJob({ clock });
  const provider = fakeProvider();
  const counters = { compose: 0 };

  // The nightmare: the still was submitted and charged, and the process died
  // before the result was written down.
  assert.throws(() => runPipeline(loadJob({ root, jobId: ID, nowImpl: clock.now }), {
    provider, clock, counters, crashAt: { step: 'still', when: 'after-call' },
  }), Crash);
  assert.equal(provider.calls.still.length, 1);

  const crashed = loadJob({ root, jobId: ID, nowImpl: clock.now });
  assert.equal(stepStatus(crashed, 'still'), 'running', 'the step is mid-flight, not failed and not done');
  const record = readIntent(crashed, 'still');
  assert.ok(record, 'the intent was written BEFORE the request; that is the whole point');
  assert.equal(record.result, null);
  assert.equal(record.completedAt, null);

  // Resume must surface it rather than blindly resubmit.
  const err = assert.throws(
    () => runPipeline(loadJob({ root, jobId: ID, nowImpl: clock.now }), { provider, clock, counters }),
    NeedsDecision,
  ) ?? null;
  assert.equal(provider.calls.still.length, 1, 'resume resubmitted a call that may already have been charged');

  // And the same is true a hundred resumes later: the state is sticky until
  // something decides what happened.
  for (let i = 0; i < 5; i += 1) {
    assert.throws(() => runPipeline(loadJob({ root, jobId: ID, nowImpl: clock.now }), { provider, clock, counters }), NeedsDecision);
  }
  assert.equal(provider.calls.still.length, 1);
  assert.equal(recordIntent(loadJob({ root, jobId: ID, nowImpl: clock.now }), 'still', { anything: true }).existing, true,
    'existing stays true for any payload while the recorded request has no result');
});

test('once the pipeline decides, the job finishes without a second submission', () => {
  const clock = clockFrom('2026-08-20T14:45:01.000Z');
  const { root } = freshJob({ clock });
  const provider = fakeProvider();
  const counters = { compose: 0 };

  assert.throws(() => runPipeline(loadJob({ root, jobId: ID, nowImpl: clock.now }), {
    provider, clock, counters, crashAt: { step: 'still', when: 'after-call' },
  }), Crash);

  const done = runPipeline(loadJob({ root, jobId: ID, nowImpl: clock.now }), {
    provider, clock, counters, onExisting: 'reconcile',
  });

  assert.equal(done.status, 'done');
  assert.equal(provider.calls.still.length, 1, 'the reconciled result was never re-requested');
  assert.equal(provider.calls.animate.length, 1);
  assert.equal(readIntent(done, 'still').result.reconciled, true);
});

test('a crash between writing the intent and sending the request looks the same from disk', () => {
  const clock = clockFrom('2026-08-20T14:45:01.000Z');
  const { root } = freshJob({ clock });
  const provider = fakeProvider();
  const counters = { compose: 0 };

  assert.throws(() => runPipeline(loadJob({ root, jobId: ID, nowImpl: clock.now }), {
    provider, clock, counters, crashAt: { step: 'still', when: 'after-intent' },
  }), Crash);

  // Nothing was submitted -- but the manifest cannot know that, and neither can
  // we. Reporting "existing" and letting the pipeline ask the provider is the
  // only honest behaviour; guessing "it never went out" is how you skip a paid
  // still, and guessing "resend it" is how you pay twice.
  assert.equal(provider.calls.still.length, 0);
  assert.equal(recordIntent(loadJob({ root, jobId: ID, nowImpl: clock.now }), 'still', { seed: 1 }).existing, true);
});

// --------------------------------------------------------------------------
// crash inside a step
// --------------------------------------------------------------------------

test('a step left running is re-entered on resume, keeping its original startedAt', () => {
  const clock = clockFrom('2026-08-20T14:45:01.000Z');
  const { root } = freshJob({ clock });

  const first = loadJob({ root, jobId: ID, nowImpl: clock.now });
  beginStep(first, 'intake');
  saveJob(first);
  const startedAt = first.steps[0].startedAt;
  // -- killed here, halfway through intake --

  clock.tick(600_000);
  const second = loadJob({ root, jobId: ID, nowImpl: clock.now });
  assert.equal(stepStatus(second, 'intake'), 'running');
  assert.equal(nextStep(second), 'intake', 'a running step is still the next step');

  beginStep(second, 'intake');
  assert.equal(second.steps[0].attempts, 2, 'attempt 2 is exactly when the intent record earns its keep');
  assert.equal(second.steps[0].startedAt, startedAt,
    'startedAt is the first begin -- restamping it erases how long the job has really been alive');

  finishStep(second, 'intake', { output: { ran: 'intake' } });
  saveJob(second);
  assert.equal(loadJob({ root, jobId: ID }).steps[0].attempts, 2);
});

test('a failed job survives the crash as failed, and needs an explicit retry to move', () => {
  const clock = clockFrom('2026-08-20T14:45:01.000Z');
  const { root } = freshJob({ clock });

  const job = loadJob({ root, jobId: ID, nowImpl: clock.now });
  beginStep(job, 'intake');
  failStep(job, 'intake', Object.assign(new Error('the upload is not a photograph'), { code: 'BAD_PHOTO', retriable: false }));
  saveJob(job);

  const resumed = loadJob({ root, jobId: ID, nowImpl: clock.now });
  assert.equal(resumed.status, 'failed');
  assert.equal(isResumable(resumed), false, 'a worker looping on a failed job re-runs the failure forever');
  assert.equal(resumed.error.code, 'BAD_PHOTO');
  assert.equal(resumed.error.step, 'intake');

  retryStep(resumed, 'intake');
  saveJob(resumed);
  const retried = loadJob({ root, jobId: ID, nowImpl: clock.now });
  assert.equal(retried.status, 'queued');
  assert.equal(stepStatus(retried, 'intake'), 'pending');
  assert.equal(retried.steps[0].attempts, 1, 'the failed attempt is still counted');
  assert.equal(retried.error, null);
  assert.equal(isResumable(retried), true);
});

test('the queue can be deleted and every job is still recoverable from its manifest', () => {
  const clock = clockFrom('2026-08-20T14:45:01.000Z');
  const { root } = freshJob({ clock });
  const provider = fakeProvider();
  const counters = { compose: 0 };

  assert.throws(() => runPipeline(loadJob({ root, jobId: ID, nowImpl: clock.now }), {
    provider, clock, counters, crashAt: { step: 'tape', when: 'before-begin' },
  }), Crash);

  // The queue holds pointers. Losing it must cost nothing but the pointers.
  fs.rmSync(`${root}/out/queue`, { recursive: true, force: true });

  const recovered = loadJob({ root, jobId: ID, nowImpl: clock.now });
  assert.equal(nextStep(recovered), 'tape');
  assert.equal(runPipeline(recovered, { provider, clock, counters }).status, 'done');
  assert.equal(provider.calls.still.length, 1);
  assert.equal(provider.calls.animate.length, 1);
});

// --------------------------------------------------------------------------
// timing, which is data the product makes decisions with
// --------------------------------------------------------------------------

test('a retried step is timed from the retry, not from the attempt that failed', () => {
  // Found in integration, not in a unit test: a job failed at `intake`, sat in
  // `failed/` for about a minute while a human looked at it, was re-enqueued,
  // and then ran `intake` in 366ms -- and reported `1m09s`, because `startedAt`
  // still belonged to the failed attempt.
  //
  // These per-step numbers are written into `review/summary.md` and they are the
  // evidence for whether this product needs a queue and an email rather than a
  // spinner. A duration inflated by however long a job waited in the dead letter
  // argues for infrastructure the render does not actually need.
  const clock = clockFrom('2026-08-20T14:45:01.000Z');
  const { root } = freshJob({ clock });

  const first = loadJob({ root, jobId: ID, nowImpl: clock.now });
  beginStep(first, 'intake');
  clock.tick(400);
  failStep(first, 'intake', new Error('no photograph to ingest'));
  saveJob(first);

  // Parked in failed/ for a minute, which is a human noticing, not work.
  clock.tick(69_000);

  const revived = loadJob({ root, jobId: ID, nowImpl: clock.now });
  retryStep(revived, 'intake');
  beginStep(revived, 'intake');
  clock.tick(366);
  finishStep(revived, 'intake', { output: {} });
  saveJob(revived);

  const step = loadJob({ root, jobId: ID, nowImpl: clock.now }).steps.find((s) => s.name === 'intake');
  const ms = Date.parse(step.endedAt) - Date.parse(step.startedAt);

  assert.equal(ms, 366, `the retry should be timed at 366ms, got ${ms}ms`);
  assert.equal(step.attempts, 2, 'the retry is still visible in attempts');
  // And the thing that genuinely knows how long the job has been alive is
  // untouched, so nothing was lost by re-stamping the step.
  assert.equal(
    loadJob({ root, jobId: ID, nowImpl: clock.now }).createdAt,
    '2026-08-20T14:45:01.000Z',
  );
});
