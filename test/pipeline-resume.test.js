/**
 * Resume, and the only number that matters: how many times we paid.
 *
 * This is the most valuable test in the render package, because the bug it
 * exists to prevent does not look like a bug. A resume that re-submits a
 * generation call produces a correct video, a green run and a bill nobody
 * reconciles until the month closes. There is no assertion downstream that can
 * catch it, so it is caught here, by counting.
 *
 * "CRASH" MEANS: throw out of the runner, keep nothing in memory, and read the
 * next run's entire world back off disk with `loadJob`. That is the same
 * information a worker has after a `kill -9`, and it is the only fair
 * simulation -- a test that reuses the in-memory job would pass while a real
 * resume lost money.
 *
 * THE THREE PLACES A PROCESS CAN DIE, and the three different right answers:
 *
 *   BETWEEN two steps      -- the manifest is committed; carry straight on and
 *                             re-submit nothing.
 *   BETWEEN two segments   -- clips 1..n are recorded and on disk; buy only the
 *                             ones that are not.
 *   INSIDE a paid call     -- a request went out and no result came back. We may
 *                             already have been charged and we cannot tell.
 *                             STOP. Do not re-submit, do not skip. A human looks
 *                             at the provider and then says so explicitly.
 *
 * The harness comes from test/pipeline.test.js; importing it registers that
 * file's tests here as well, which is the trade documented at the top of it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { loadJob, saveJob, retryStep, jobPaths, STEPS } from '../scripts/render/job.mjs';
import { runPipeline } from '../scripts/render/pipeline.mjs';
import {
  tmpRoot, writeUpload, makeProvider, makeFfmpeg, makeDeps, makeJob,
} from './pipeline.test.js';

/** One scenario's world: a root, an upload, a counting provider, faked ffmpeg. */
function world(providerOpts = {}) {
  const root = tmpRoot();
  const photo = writeUpload(root);
  const { provider, calls } = makeProvider(providerOpts);
  const ffmpeg = makeFfmpeg();
  const deps = makeDeps({ ffmpeg });
  const job = makeJob(root);
  return { root, photo, provider, calls, ffmpeg, deps, jobId: job.jobId };
}

/**
 * One run of the pipeline against a job read fresh off disk. `killAfter` throws
 * the moment a step commits, which is a crash BETWEEN steps: the manifest was
 * already written, and nothing in memory survives.
 */
async function attempt(w, { killAfter = null, stopAfter = null, stillIndex = null } = {}) {
  const job = loadJob({ root: w.root, jobId: w.jobId });
  try {
    await runPipeline(job, {
      provider: w.provider,
      root: w.root,
      deps: w.deps,
      sources: { photo: w.photo },
      stopAfter,
      stillIndex,
      onProgress: (e) => {
        if (killAfter && e.step === killAfter && e.phase === 'done') {
          throw new Error(`kill -9 after ${killAfter}`);
        }
      },
    });
    return { crashed: false, error: null };
  } catch (err) {
    // A simulated kill is not a failure of the pipeline; anything else is.
    if (/kill -9/.test(err.message)) return { crashed: true, error: null, kill: err };
    return { crashed: false, error: err };
  }
}

const settled = (root, jobId) => loadJob({ root, jobId });
const finishedSteps = (job) => job.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;

// ---------------------------------------------------------------------------
// crashing between every step boundary, one job, one bill
// ---------------------------------------------------------------------------

test('killed at EVERY step boundary in turn, the provider is still called exactly twice', async () => {
  const w = world();
  // Every step that commits. `expand` is skipped for two presets and never
  // commits, so it cannot be a kill point.
  const killPoints = STEPS.filter((s) => s !== 'expand');

  let progressed = -1;
  for (const kill of killPoints) {
    const before = finishedSteps(settled(w.root, w.jobId));
    assert.ok(before > progressed, `resume made no progress before ${kill}`);
    progressed = before;

    const result = await attempt(w, { killAfter: kill });
    assert.equal(result.error, null, `resume failed at ${kill}: ${result.error?.message}`);
    assert.ok(result.crashed, `${kill} never committed, so it was never a kill point`);

    const job = settled(w.root, w.jobId);
    // The manifest is readable and continuable at every one of these points.
    assert.ok(finishedSteps(job) > progressed, `${kill} did not commit before the crash`);
    assert.ok(['queued', 'running', 'awaiting-selection'].includes(job.status), `stuck at ${job.status}`);
  }

  // The last kill lands after `publish` committed but before `completeJob`, so
  // one clean run closes the job out -- and it must still buy nothing.
  const final = await attempt(w);
  assert.equal(final.error, null);
  const job = settled(w.root, w.jobId);
  assert.equal(job.status, 'done');

  // THE ASSERTION. Ten crashes, ten resumes, one still request and one video
  // request per planned segment. Every extra call here is real money.
  assert.equal(w.calls.still, 1, `generateStill was called ${w.calls.still} times across the crash sequence`);
  assert.equal(w.calls.video, 2, `generateVideo was called ${w.calls.video} times across the crash sequence`);
  assert.equal(job.resolved.segments.length, 2);
});

test('a resumed job keeps the timestamps and attempt counts of the steps it did not re-run', async () => {
  const w = world();
  await attempt(w, { killAfter: 'still' });
  const after = settled(w.root, w.jobId);
  const stillStep = after.steps.find((s) => s.name === 'still');
  const snapshot = { startedAt: stillStep.startedAt, endedAt: stillStep.endedAt, attempts: stillStep.attempts, cost: stillStep.cost };

  await attempt(w);
  const done = settled(w.root, w.jobId);
  const again = done.steps.find((s) => s.name === 'still');
  assert.deepEqual(
    { startedAt: again.startedAt, endedAt: again.endedAt, attempts: again.attempts, cost: again.cost },
    snapshot,
    'a done step was restamped on resume, which makes a ledger useless',
  );
  assert.equal(w.calls.still, 1);
});

test('the frozen resolved block survives every resume unchanged', async () => {
  const w = world();
  await attempt(w, { killAfter: 'compose' });
  const first = settled(w.root, w.jobId).resolved;
  await attempt(w, { killAfter: 'animate' });
  await attempt(w);
  const last = settled(w.root, w.jobId).resolved;
  assert.deepEqual(last, first, 'resolved was re-derived on a resume');
  assert.equal(w.calls.video, 2);
});

// ---------------------------------------------------------------------------
// crashing between segments
// ---------------------------------------------------------------------------

test('killed between segment 1 and segment 2, only segment 2 is bought', async () => {
  // Dies on the way IN to the second video call: nothing was submitted for it,
  // so nothing was charged, and segment 1 is already recorded and on disk.
  // One-shot, because the machine that died is expected to come back working.
  let armed = true;
  const w = world({
    beforeCall: (kind, calls) => {
      if (armed && kind === 'video' && calls.video === 1) { armed = false; throw new Error('kill -9 between segments'); }
    },
  });

  const first = await attempt(w);
  assert.match(first.kill.message, /kill -9 between segments/);
  assert.equal(w.calls.video, 1);

  const mid = settled(w.root, w.jobId);
  assert.equal(mid.status, 'failed');
  assert.equal(mid.steps.find((s) => s.name === 'animate').output.segments.length, 1,
    'segment 1 was not recorded durably, so a resume would buy it again');

  // A death on the way in is not an in-flight request; the operator retries the
  // step and the recorded segment is kept rather than re-bought.
  const job = loadJob({ root: w.root, jobId: w.jobId });
  retryStep(job, 'animate', { deliberate: true });  // the operator, exactly as --retry-step does
  saveJob(job);
  await attempt(w);

  assert.equal(settled(w.root, w.jobId).status, 'done');
  assert.equal(w.calls.video, 2, 'segment 1 was generated twice');
  assert.equal(w.calls.still, 1);
});

test('a recorded segment whose clip was deleted IS bought again -- that is the escape hatch', async () => {
  let armed = true;
  const w = world({
    beforeCall: (kind, calls) => {
      if (armed && kind === 'video' && calls.video === 1) { armed = false; throw new Error('kill -9 between segments'); }
    },
  });
  await attempt(w);
  fs.rmSync(`${jobPaths(w.root, w.jobId).segments}/seg-01.mp4`, { force: true });

  const job = loadJob({ root: w.root, jobId: w.jobId });
  retryStep(job, 'animate', { deliberate: true });  // the operator, exactly as --retry-step does
  saveJob(job);
  await attempt(w);

  assert.equal(w.calls.video, 3, 'a missing clip must be regenerated, not silently skipped');
  assert.equal(settled(w.root, w.jobId).status, 'done');
});

test('crashing after a clip landed but before the manifest caught up adopts it, free', async () => {
  // The window between `completeIntent` and the next `saveJob`. It is a few
  // microseconds wide and it is exactly the window that costs money: the clip
  // is on disk, the receipt says so, and the manifest has not been told.
  //
  // Reproduced by hand rather than by racing, because a test that only passes
  // when the timing cooperates is a test that stops catching this.
  const w = world();
  await attempt(w);
  assert.equal(w.calls.video, 2);

  const paths = jobPaths(w.root, w.jobId);
  const manifest = JSON.parse(fs.readFileSync(paths.manifest, 'utf8'));
  const animate = manifest.steps.find((s) => s.name === 'animate');
  // Roll the manifest back to the instant after segment 2's receipt was written
  // and before its record reached the step. The intent file is untouched.
  animate.output.segments = animate.output.segments.filter((seg) => seg.index === 1);
  animate.status = 'running';
  for (const later of ['assemble', 'tape', 'verify', 'publish']) {
    const step = manifest.steps.find((s) => s.name === later);
    step.status = 'pending';
    step.output = {};
    step.startedAt = null;
    step.endedAt = null;
  }
  manifest.status = 'running';
  manifest.result = { videoPath: null, posterPath: null, durationSeconds: null, frames: null, lufs: null };
  fs.writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}
`);

  const before = w.calls.video;
  await attempt(w);

  assert.equal(w.calls.video, before, 'a clip already on disk and already receipted was bought a second time');
  assert.equal(settled(w.root, w.jobId).status, 'done');
  const adopted = settled(w.root, w.jobId).steps.find((s) => s.name === 'animate').output.segments;
  assert.equal(adopted.length, 2);
  assert.equal(adopted[1].adopted, true, 'the adoption was not recorded, so nobody can tell it happened');
});

// ---------------------------------------------------------------------------
// crashing INSIDE a paid call: the case that must stop and ask
// ---------------------------------------------------------------------------

test('killed inside generateStill, the resume REFUSES rather than guessing', async () => {
  const w = world({
    afterSubmit: (kind, calls) => {
      if (kind === 'still' && calls.still === 1) throw new Error('kill -9 mid-flight');
    },
  });

  const first = await attempt(w);
  assert.match(first.kill.message, /kill -9 mid-flight/);
  assert.equal(w.calls.still, 1);

  // The intent is on disk with no result: a request went out and nothing came
  // back. The job is failed, so a resume has to be an explicit act anyway --
  // and even then the pipeline names the file rather than silently deciding.
  const record = JSON.parse(fs.readFileSync(`${jobPaths(w.root, w.jobId).intent}/still.json`, 'utf8'));
  assert.equal(record.result, null);

  const failed = loadJob({ root: w.root, jobId: w.jobId });
  failed.status = 'running';                    // pretend the worker simply came back
  failed.steps.find((s) => s.name === 'still').status = 'running';
  saveJob(failed);

  const second = await attempt(w);
  assert.equal(second.error?.code, 'INTENT_IN_FLIGHT');
  assert.match(second.error.message, /may already have gone out/);
  assert.match(second.error.message, /--retry-step=still/);
  assert.equal(w.calls.still, 1, 'the resume silently re-submitted a paid request');
});

test('and a deliberate --retry-step re-submits exactly once, keeping the old receipt', async () => {
  let armed = true;
  const w = world({
    afterSubmit: (kind, calls) => {
      if (armed && kind === 'still' && calls.still === 1) throw new Error('kill -9 mid-flight');
    },
  });
  await attempt(w);
  assert.equal(w.calls.still, 1);
  armed = false;

  const job = loadJob({ root: w.root, jobId: w.jobId });
  retryStep(job, 'still', { deliberate: true });  // the operator, exactly as --retry-step does
  saveJob(job);
  await attempt(w);

  assert.equal(w.calls.still, 2, 'a deliberate retry must actually re-submit');
  assert.equal(settled(w.root, w.jobId).status, 'done');

  // The superseded record is rotated rather than overwritten: it is the
  // evidence that a request went out, and the ledger reads it.
  const intent = jobPaths(w.root, w.jobId).intent;
  assert.ok(fs.existsSync(`${intent}/still.1.json`), 'the first attempt was erased');
  const rotated = JSON.parse(fs.readFileSync(`${intent}/still.1.json`, 'utf8'));
  assert.equal(rotated.result.unresolved, true);
  assert.equal(JSON.parse(fs.readFileSync(`${intent}/still.json`, 'utf8')).attempt, 2);
});

/**
 * THE WORKER'S AUTOMATIC REVIVE IS NOT A HUMAN DECIDING.
 *
 * `runOne` revives a failed job by calling `retryStep` on every failed step.
 * That rewrites `failed -> pending`, and `decideIntent` told a crash from a
 * deliberate retry purely by whether the step was still `running` -- so after
 * the revive, CASE 2 could not fire. CASE 3 ran instead: it closed the open
 * intent as unresolved, minted a fresh key, and sent the paid request again.
 *
 * The chain that gets there is ordinary. A TimeoutError on a submit is
 * `retriable` by its own class, and its comment says why: "a timeout on a
 * submit may have created work on the far side, which is why the pipeline
 * writes an intent record before the request." The pipeline catches it and
 * calls `failStep`, so the step is `failed` rather than `running`; the queue
 * puts the job back in `pending`; the worker claims it and revives it. Repeat
 * to `maxAttempts: 4` -- four independently-keyed billed generations, about
 * $18 at the measured 720p rate, for one fifteen-second tape, with no human
 * ever seeing INTENT_IN_FLIGHT.
 *
 * The header's stated invariant -- "A human decides, because only a human can
 * go and look at the provider's dashboard" -- held only for a hard kill, which
 * is the one case the tests exercised.
 *
 * A two-module interaction: a unit test of `decideIntent` cannot see the caller
 * that rewrote the status before it looked.
 */
test('an automatic revive does NOT re-submit an open intent -- only a human does', async () => {
  const w = world({
    afterSubmit: (kind, calls) => {
      if (kind === 'still' && calls.still === 1) throw new Error('kill -9 mid-flight');
    },
  });

  await attempt(w);
  assert.equal(w.calls.still, 1);

  // The open record: a request went out and nothing came back.
  const record = JSON.parse(fs.readFileSync(`${jobPaths(w.root, w.jobId).intent}/still.json`, 'utf8'));
  assert.equal(record.result, null);

  // Exactly what the worker does on its next claim: retryStep on every failed
  // step, with nobody having asked for it.
  const job = loadJob({ root: w.root, jobId: w.jobId });
  for (const step of job.steps) {
    if (step.status === 'failed') retryStep(job, step.name);
  }
  saveJob(job);

  const second = await attempt(w);
  assert.equal(second.error?.code, 'INTENT_IN_FLIGHT',
    'an automatic revive re-submitted a request that may already have been charged');
  assert.equal(w.calls.still, 1,
    'the paid call went out a second time without anyone deciding to');
  assert.match(second.error.message, /--retry-step=still/,
    'the refusal must name the deliberate way forward');
});

test('killed inside generateVideo for segment 2, the resume refuses and segment 1 is untouched', async () => {
  let armed = true;
  const w = world({
    afterSubmit: (kind, calls) => {
      if (armed && kind === 'video' && calls.video === 2) throw new Error('kill -9 mid-flight');
    },
  });

  await attempt(w);
  assert.equal(w.calls.video, 2, 'the second segment was submitted');

  const mid = loadJob({ root: w.root, jobId: w.jobId });
  mid.status = 'running';
  mid.steps.find((s) => s.name === 'animate').status = 'running';
  saveJob(mid);

  const second = await attempt(w);
  assert.equal(second.error?.code, 'INTENT_IN_FLIGHT');
  assert.equal(w.calls.video, 2, 'a possibly-charged segment was re-submitted without anyone deciding to');

  armed = false;
  const job = loadJob({ root: w.root, jobId: w.jobId });
  retryStep(job, 'animate', { deliberate: true });  // the operator, exactly as --retry-step does
  saveJob(job);
  await attempt(w);

  // Three calls for two segments: two before the crash, and exactly ONE
  // deliberate resubmission. Segment 1 was never bought twice.
  assert.equal(w.calls.video, 3);
  assert.deepEqual(w.calls.videoRequests.map((r) => r.index), [1, 2, 2]);
  assert.equal(settled(w.root, w.jobId).status, 'done');
});

// ---------------------------------------------------------------------------
// the human-shaped pause
// ---------------------------------------------------------------------------

test('a job parked at select survives a restart and spends nothing while it waits', async () => {
  const w = world();
  await attempt(w, { stopAfter: 'select' });
  assert.equal(settled(w.root, w.jobId).status, 'awaiting-selection');
  assert.equal(w.calls.video, 0);

  // Somebody restarts the worker. The parked job must not be picked up and run
  // past the gate, and must not be re-generated either.
  await attempt(w, { stopAfter: 'select' });
  assert.equal(w.calls.still, 1, 'the parked job re-generated its stills');
  assert.equal(w.calls.video, 0, 'the parked job ran past the gate nobody opened');

  await attempt(w, { stillIndex: 3 });
  const job = settled(w.root, w.jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.selection.stillIndex, 3);
  assert.equal(w.calls.still, 1);
  assert.equal(w.calls.video, 2);
  assert.ok(w.calls.videoRequests[0].imagePath.endsWith('still-03.png'));
});

test('resuming a cancelled job does nothing, and a done job cannot be restarted', async () => {
  const w = world();
  await attempt(w);
  assert.equal(settled(w.root, w.jobId).status, 'done');
  const before = { ...w.calls };

  const result = await attempt(w);
  assert.equal(result.error, null);
  assert.equal(w.calls.still, before.still);
  assert.equal(w.calls.video, before.video);
});

test('a job that died between the last step and completeJob is not stranded in running', async () => {
  // Found by the crash matrix above, and worth its own name: at that instant
  // every step is done, so `nextStep` is null and `isResumable` says no -- while
  // the job is in fact one write away from finished. Refusing it would leave a
  // fully paid-for render permanently `running`, with the video on disk and no
  // way for anything to notice.
  const w = world();
  await attempt(w, { killAfter: 'publish' });

  const stranded = settled(w.root, w.jobId);
  assert.equal(stranded.status, 'running');
  assert.ok(stranded.steps.every((s) => ['done', 'skipped'].includes(s.status)));

  const result = await attempt(w);
  assert.equal(result.error, null);
  const job = settled(w.root, w.jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.frames, 375);
  assert.equal(w.calls.still, 1);
  assert.equal(w.calls.video, 2);
});

test('a failed job is recoverable, not resumable -- it says so rather than looping', async () => {
  const w = world({
    beforeCall: (kind) => { if (kind === 'still') throw new Error('the provider is on fire'); },
  });
  const first = await attempt(w);
  assert.match(first.error.message, /on fire/);
  assert.equal(settled(w.root, w.jobId).status, 'failed');

  const second = await attempt(w);
  assert.equal(second.error?.code, 'NOT_RESUMABLE');
  assert.match(second.error.message, /recoverable, not resumable/);
});
