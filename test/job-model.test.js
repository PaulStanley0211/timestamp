/**
 * The job model, asserted against a real filesystem.
 *
 * This one uses a temp directory rather than an injected fs, on purpose. Every
 * property this module actually has to hold -- rename is atomic, a frozen block
 * survives a round trip through JSON, a manifest killed mid-write is never
 * truncated, EPERM on a Windows rename is transient rather than fatal -- is a
 * property of the filesystem underneath. A fake fs would let all four pass while
 * the real thing lost a paid job.
 *
 * The illegal transitions get as much space as the legal ones. A legal path that
 * breaks fails loudly the first time anyone runs the pipeline; an illegal move
 * that is quietly permitted shows up months later as a job that reported success
 * after failing, or as a second charge on a step that was already done.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  JOBS_DIR,
  JOB_ID_RE,
  JobError,
  SCHEMA_VERSION,
  STATUSES,
  STEPS,
  STEP_STATUSES,
  beginStep,
  cancelJob,
  completeIntent,
  completeJob,
  createJob,
  failStep,
  finishStep,
  freezeResolved,
  fromJobRelative,
  isResumable,
  isValidJobId,
  jobPaths,
  listJobs,
  loadJob,
  newJobId,
  nextStep,
  readIntent,
  recordIntent,
  retryStep,
  saveJob,
  setJobStatus,
  setSelection,
  skipStep,
  stepStatus,
  toJobRelative,
} from '../scripts/render/job.mjs';

// --------------------------------------------------------------------------
// harness
// --------------------------------------------------------------------------

const roots = [];
function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-job-')).replace(/\\/g, '/');
  roots.push(root);
  return root;
}
test.after(() => {
  for (const root of roots) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* the OS will get it */ }
  }
});

/** A clock that only moves when a test moves it. Every timestamp in a manifest
 *  has to come from here, which is the only way to prove that a resumed job kept
 *  its original times instead of quietly restamping them. */
function clockFrom(iso) {
  let t = Date.parse(iso);
  return {
    now: () => new Date(t),
    tick(ms) { t += ms; return this; },
    iso: () => new Date(t).toISOString(),
  };
}

const ID = '20260820-144501-a3f19c';

const baseInput = (over = {}) => ({
  photo: { path: 'input/photo.jpg', sha256: 'a'.repeat(64), width: 1200, height: 1600 },
  place: { kind: 'preset', value: 'schrebergarten-august', photoPath: null, photoSha256: null },
  outfit: { kind: 'preset', value: 'trainingsjacke' },
  stillCount: 3,
  consent: { granted: true, at: '2026-08-20T14:45:00.000Z', text: 'I am in this photo and I agree to it being used to make this video.' },
  ...over,
});

function makeJob({ root = tmpRoot(), jobId = ID, input = baseInput(), clock = clockFrom('2026-08-20T14:45:01.000Z') } = {}) {
  const job = createJob({ root, jobId, input, provider: 'fixture', cfg: { durationSeconds: 15 }, nowImpl: clock.now });
  return { job, root, clock };
}

// --------------------------------------------------------------------------
// ids
// --------------------------------------------------------------------------

test('a job id is <YYYYMMDD>-<HHMMSS>-<6 hex>, lowercase, and sorts chronologically', () => {
  const rand = { randomBytes: () => Buffer.from([0xa3, 0xf1, 0x9c]) };
  const early = newJobId({ now: () => new Date('2026-08-20T14:45:01.000Z'), rand });
  const late = newJobId({ now: () => new Date('2026-12-01T02:03:04.000Z'), rand });

  assert.equal(early, '20260820-144501-a3f19c');
  assert.equal(late, '20261201-020304-a3f19c');
  assert.match(early, JOB_ID_RE);
  assert.ok(early < late, 'string sort must be chronological sort');
  assert.equal(early, early.toLowerCase());
});

test('the id stamp is UTC, so a DST fall-back cannot reorder two jobs', () => {
  const rand = { randomBytes: () => Buffer.from([0x00, 0x00, 0x01]) };
  // 00:30 UTC on the 26th is the previous evening in most western zones; a
  // local-time stamp would date this job to the 25th.
  const id = newJobId({ now: () => new Date('2026-10-26T00:30:00.000Z'), rand });
  assert.equal(id, '20261026-003000-000001');
});

test('two jobs created in the same second get different ids', () => {
  const now = () => new Date('2026-08-20T14:45:01.000Z');
  const ids = new Set();
  for (let i = 0; i < 200; i += 1) ids.add(newJobId({ now }));
  assert.equal(ids.size, 200, 'a collision here means one job overwrites another job directory');
});

test('newJobId accepts an epoch-ms clock as well as a Date', () => {
  const rand = { randomBytes: () => Buffer.from([1, 2, 3]) };
  assert.equal(
    newJobId({ now: () => Date.parse('2026-08-20T14:45:01.000Z'), rand }),
    newJobId({ now: () => new Date('2026-08-20T14:45:01.000Z'), rand }),
  );
});

test('isValidJobId only accepts the canonical shape', () => {
  assert.equal(isValidJobId(ID), true);
  for (const bad of ['../etc', 'job-1', '20260820-144501-A3F19C', '20260820-144501-a3f19', '', null]) {
    assert.equal(isValidJobId(bad), false, `${bad} must not pass as a job id`);
  }
});

// --------------------------------------------------------------------------
// paths
// --------------------------------------------------------------------------

test('jobPaths lays the directory out as documented, with forward slashes', () => {
  const root = tmpRoot();
  const p = jobPaths(root, ID);
  assert.equal(p.dir, `${root}/${JOBS_DIR}/${ID}`);
  assert.equal(p.manifest, `${p.dir}/manifest.json`);
  assert.equal(p.intent, `${p.dir}/intent`);
  assert.equal(p.input, `${p.dir}/input`);
  assert.equal(p.stills, `${p.dir}/stills`);
  assert.equal(p.segments, `${p.dir}/segments`);
  assert.equal(p.review, `${p.dir}/review`);
  assert.equal(p.logs, `${p.dir}/logs`);
  assert.equal(p.video, `${p.dir}/timestamp.mp4`);
  assert.equal(p.poster, `${p.dir}/poster.jpg`);
  for (const value of Object.values(p)) assert.ok(!value.includes('\\'), `${value} has a backslash`);
});

test('jobPaths refuses an id that could walk out of out/jobs', () => {
  const root = tmpRoot();
  for (const bad of ['..', '../../etc', 'a/b', 'a\\b', 'C:/windows', '', '.hidden']) {
    assert.throws(() => jobPaths(root, bad), { code: 'BAD_JOB_ID' }, `${bad} must be refused`);
  }
});

test('toJobRelative and fromJobRelative round-trip, and refuse to leave the job directory', () => {
  const { job } = makeJob();
  const abs = `${job.paths.stills}/still-01.png`;
  assert.equal(toJobRelative(job, abs), 'stills/still-01.png');
  assert.equal(fromJobRelative(job, 'stills/still-01.png'), abs);
  assert.throws(() => toJobRelative(job, path.resolve(job.paths.dir, '..', 'other.png')), { code: 'OUTSIDE_JOB_DIR' });
  assert.throws(() => fromJobRelative(job, '../../secrets.json'), { code: 'OUTSIDE_JOB_DIR' });
});

// --------------------------------------------------------------------------
// create / save / load
// --------------------------------------------------------------------------

test('createJob writes the manifest and the whole directory layout immediately', () => {
  const { job, root } = makeJob();
  const p = jobPaths(root, ID);
  for (const dir of [p.dir, p.intent, p.input, p.stills, p.segments, p.review, p.logs]) {
    assert.ok(fs.statSync(dir).isDirectory(), `${dir} was not created`);
  }
  // The queue is about to hold a pointer to this job; a pointer to a job with no
  // manifest is the one state that cannot be recovered.
  assert.ok(fs.existsSync(p.manifest));
  assert.equal(job.schemaVersion, SCHEMA_VERSION);
  assert.equal(job.status, 'queued');
  assert.equal(job.provider, 'fixture');
  assert.equal(job.resolved, null, 'nothing is frozen before compose');
  assert.deepEqual(job.steps.map((s) => s.name), [...STEPS]);
  assert.ok(job.steps.every((s) => s.status === 'pending' && s.attempts === 0));
  assert.deepEqual(job.cost, { estimated: 0, actual: null, currency: 'USD' });
  assert.deepEqual(job.selection, { stillIndex: null, chosenBy: null });
});

test('createJob refuses to land on top of an existing job', () => {
  const { root } = makeJob();
  assert.throws(
    () => createJob({ root, jobId: ID, input: baseInput(), provider: 'fixture' }),
    { code: 'JOB_EXISTS' },
    'a second job in the same directory would destroy the first one, which may already be paid for',
  );
});

test('createJob validates the input block rather than storing nonsense', () => {
  const root = tmpRoot();
  const mk = (input, jobId) => () => createJob({ root, jobId, input, provider: 'fixture' });
  assert.throws(mk(baseInput({ place: { kind: 'vibes', value: 'x' } }), '20260820-000001-000001'), { code: 'BAD_INPUT' });
  assert.throws(mk(baseInput({ outfit: { kind: 'photo', value: 'x' } }), '20260820-000002-000001'), { code: 'BAD_INPUT' });
  assert.throws(mk(baseInput({ stillCount: 12 }), '20260820-000003-000001'), { code: 'BAD_INPUT' });
  assert.throws(mk(baseInput({ stillCount: 0 }), '20260820-000004-000001'), { code: 'BAD_INPUT' });
  assert.throws(mk(null, '20260820-000005-000001'), { code: 'BAD_INPUT' });
  assert.throws(() => createJob({ root, jobId: '20260820-000006-000001', input: baseInput(), provider: '' }), { code: 'BAD_PROVIDER' });
});

test('a consent record that was not granted is refused, not stored', () => {
  const root = tmpRoot();
  assert.throws(
    () => createJob({
      root, jobId: ID, provider: 'fixture',
      input: baseInput({ consent: { granted: false, at: null, text: 'no' } }),
    }),
    { code: 'CONSENT_REQUIRED' },
  );
});

test('loadJob round-trips the manifest exactly', () => {
  const { job, root } = makeJob();
  const loaded = loadJob({ root, jobId: ID });
  assert.deepEqual(JSON.parse(JSON.stringify(loaded)), JSON.parse(JSON.stringify(job)));
  assert.equal(loaded.jobId, ID);
});

test('loadJob refuses a manifest it does not understand instead of guessing', () => {
  const { root } = makeJob();
  const p = jobPaths(root, ID);

  const manifest = JSON.parse(fs.readFileSync(p.manifest, 'utf8'));
  fs.writeFileSync(p.manifest, JSON.stringify({ ...manifest, schemaVersion: 99 }));
  assert.throws(() => loadJob({ root, jobId: ID }), { code: 'SCHEMA_VERSION' });

  fs.writeFileSync(p.manifest, JSON.stringify({ ...manifest, jobId: '20260101-000000-aaaaaa' }));
  assert.throws(() => loadJob({ root, jobId: ID }), { code: 'JOB_ID_MISMATCH' },
    'a copied directory with a stale manifest would write its results into another job');

  fs.writeFileSync(p.manifest, '{"schemaVersion": 1, "job');
  assert.throws(() => loadJob({ root, jobId: ID }), { code: 'CORRUPT' });

  fs.rmSync(p.manifest);
  assert.throws(() => loadJob({ root, jobId: ID }), { code: 'NOT_FOUND' });
});

test('saveJob leaves no tmp file behind and stamps updatedAt from the injected clock', () => {
  const clock = clockFrom('2026-08-20T14:45:01.000Z');
  const { job, root } = makeJob({ clock });
  assert.equal(job.createdAt, '2026-08-20T14:45:01.000Z');
  assert.equal(job.updatedAt, '2026-08-20T14:45:01.000Z');

  clock.tick(90_000);
  saveJob(job);
  assert.equal(job.updatedAt, '2026-08-20T14:46:31.000Z');
  assert.equal(loadJob({ root, jobId: ID }).updatedAt, '2026-08-20T14:46:31.000Z');
  assert.equal(job.createdAt, '2026-08-20T14:45:01.000Z', 'createdAt is not a moving target');
  assert.ok(!fs.existsSync(`${job.paths.manifest}.tmp`), 'the tmp file must be renamed away, not left');
});

test('saveJob refuses a job it cannot locate rather than writing somewhere arbitrary', () => {
  const { job } = makeJob();
  const spread = { ...job };            // the classic: spread drops the hidden root
  assert.throws(() => saveJob(spread), { code: 'NO_ROOT' });
  assert.doesNotThrow(() => saveJob(spread, { root: job.root }));
});

// --------------------------------------------------------------------------
// portability
// --------------------------------------------------------------------------

test('an absolute path anywhere in the manifest is refused', () => {
  const { job } = makeJob();
  beginStep(job, 'intake');

  assert.throws(
    () => finishStep(job, 'intake', { output: { photoPath: 'C:/Users/pauls/Timestamp/out/jobs/x/input/photo.jpg' } }),
    { code: 'PATH_NOT_RELATIVE' },
    'a manifest full of C:\\Users is readable on exactly one machine',
  );
  assert.throws(() => finishStep(job, 'intake', { output: { photoPath: '/var/data/photo.jpg' } }), { code: 'PATH_NOT_RELATIVE' });
  assert.throws(() => finishStep(job, 'intake', { output: { photoPath: 'input\\photo.jpg' } }), { code: 'PATH_NOT_RELATIVE' });
  assert.throws(() => finishStep(job, 'intake', { output: { refs: [{ path: 'C:/x.png' }] } }), { code: 'PATH_NOT_RELATIVE' });

  finishStep(job, 'intake', { output: { photoPath: 'input/photo.jpg' } });
  assert.equal(job.steps[0].output.photoPath, 'input/photo.jpg');
});

test('saveJob is the choke point: a path set directly still cannot reach disk', () => {
  const { job } = makeJob();
  job.result.videoPath = `${job.paths.dir}/timestamp.mp4`;
  assert.throws(() => saveJob(job), { code: 'PATH_NOT_RELATIVE' });
  job.result.videoPath = 'timestamp.mp4';
  assert.doesNotThrow(() => saveJob(job));
});

// --------------------------------------------------------------------------
// the frozen resolved block
// --------------------------------------------------------------------------

const aResolved = (over = {}) => ({
  catalogHash: '4f2a9c',
  lookHash: '9b1d0e',
  place: { id: 'schrebergarten-august', prompt: { scene: 'an allotment garden in August' } },
  outfit: { id: 'trainingsjacke' },
  look: { tape: { grainStrength: 20 } },
  cfg: { durationSeconds: 15, fps: 25 },
  stillPrompt: { prompt: 'the person in the reference image', negativePrompt: 'smartphone', fragments: {} },
  motionPrompts: [{ prompt: 'the curtain moves', negativePrompt: '' }],
  segments: [{ index: 1, seconds: 8, seed: 12 }, { index: 2, seconds: 7, seed: 34 }],
  seeds: { still: 1, audio: 2, stamp: 3 },
  ...over,
});

test('freezeResolved writes once and refuses a second write', () => {
  const { job } = makeJob();
  freezeResolved(job, aResolved());
  assert.equal(job.resolved.catalogHash, '4f2a9c');

  assert.throws(
    () => freezeResolved(job, aResolved({ catalogHash: 'edited-preset' })),
    { code: 'RESOLVED_ALREADY_FROZEN' },
    'an edited preset must not be able to silently redefine a render that already happened',
  );
  assert.equal(job.resolved.catalogHash, '4f2a9c');
});

test('the frozen block is frozen all the way down, not one level deep', () => {
  const { job } = makeJob();
  freezeResolved(job, aResolved());
  // ESM is strict mode, so these are TypeErrors rather than silent no-ops --
  // which is the entire difference between a guard and a comment.
  assert.throws(() => { job.resolved.catalogHash = 'x'; }, TypeError);
  assert.throws(() => { job.resolved.look.tape.grainStrength = 22; }, TypeError);
  assert.throws(() => { job.resolved.segments[0].seed = 999; }, TypeError);
  assert.throws(() => { job.resolved.segments.push({ index: 3 }); }, TypeError);
  assert.throws(() => { job.resolved.cfg.fps = 30; }, TypeError);
});

test('a resolved block survives the round trip through disk still frozen', () => {
  const { job, root } = makeJob();
  freezeResolved(job, aResolved());
  saveJob(job);

  const resumed = loadJob({ root, jobId: ID });
  assert.deepEqual(resumed.resolved, JSON.parse(JSON.stringify(aResolved())));
  assert.throws(() => { resumed.resolved.look.tape.grainStrength = 22; }, TypeError);
  assert.throws(
    () => freezeResolved(resumed, aResolved({ catalogHash: 'recomputed-on-resume' })),
    { code: 'RESOLVED_ALREADY_FROZEN' },
    'resume must never re-derive resolved -- that is what makes reproducible a property',
  );
});

test('freezeResolved stores what will actually be on disk, not the caller object', () => {
  const { job, root } = makeJob();
  const live = aResolved();
  freezeResolved(job, live);
  live.catalogHash = 'mutated after freezing';       // the caller keeps their copy
  saveJob(job);
  assert.equal(loadJob({ root, jobId: ID }).resolved.catalogHash, '4f2a9c');
  assert.throws(() => freezeResolved(job, null), { code: 'BAD_RESOLVED' });
});

// --------------------------------------------------------------------------
// legal transitions
// --------------------------------------------------------------------------

test('STEPS and STATUSES are frozen and in the documented order', () => {
  assert.ok(Object.isFrozen(STEPS) && Object.isFrozen(STATUSES) && Object.isFrozen(STEP_STATUSES));
  assert.deepEqual([...STEPS], [
    'intake', 'moderate', 'expand', 'compose', 'still',
    'select', 'animate', 'assemble', 'tape', 'verify', 'publish',
  ]);
  assert.deepEqual([...STATUSES], ['queued', 'running', 'awaiting-selection', 'done', 'failed', 'cancelled']);
  assert.deepEqual([...STEP_STATUSES], ['pending', 'running', 'done', 'failed', 'skipped']);
  assert.throws(() => { STEPS.push('billing'); }, TypeError);
});

test('begin -> finish is the happy path and it moves the job to running', () => {
  const clock = clockFrom('2026-08-20T14:45:01.000Z');
  const { job } = makeJob({ clock });

  clock.tick(1000);
  beginStep(job, 'intake');
  assert.equal(job.status, 'running');
  assert.equal(stepStatus(job, 'intake'), 'running');
  assert.equal(job.steps[0].attempts, 1);
  assert.equal(job.steps[0].startedAt, '2026-08-20T14:45:02.000Z');

  clock.tick(4000);
  finishStep(job, 'intake', { output: { photoPath: 'input/photo.jpg' }, cost: { estimated: 0 } });
  assert.equal(stepStatus(job, 'intake'), 'done');
  assert.equal(job.steps[0].endedAt, '2026-08-20T14:45:06.000Z');
  assert.equal(job.steps[0].error, null);
});

test('skipStep records the reason, because a skip is a decision and not an absence', () => {
  const { job } = makeJob();
  skipStep(job, 'expand', 'both place and outfit are presets');
  assert.equal(stepStatus(job, 'expand'), 'skipped');
  assert.equal(job.steps[2].skipReason, 'both place and outfit are presets');
  assert.equal(job.steps[2].error, null, 'a skip is not an error and the ledger keys off error');
});

test('failStep moves the step and the job together', () => {
  const { job } = makeJob();
  beginStep(job, 'still');
  failStep(job, 'still', Object.assign(new Error('429 from the provider'), { code: 'RATE_LIMIT', retriable: true }));

  assert.equal(stepStatus(job, 'still'), 'failed');
  assert.equal(job.status, 'failed');
  assert.equal(job.error.code, 'RATE_LIMIT');
  assert.equal(job.error.step, 'still');
  assert.equal(job.error.retriable, true);
  assert.equal(job.steps[4].error.message, '429 from the provider');
});

test('select can park the job in front of a human and then take it back', () => {
  const { job } = makeJob();
  beginStep(job, 'select');
  setJobStatus(job, 'awaiting-selection');
  assert.equal(isResumable(job), true, 'a parked job is still resumable -- it is waiting, not broken');

  setSelection(job, { stillIndex: 2, chosenBy: 'user' });
  assert.deepEqual(job.selection, { stillIndex: 2, chosenBy: 'user' });
  finishStep(job, 'select', { output: { stillIndex: 2 } });
  assert.throws(() => setSelection(job, { stillIndex: -1 }), { code: 'BAD_SELECTION' });
  assert.throws(() => setSelection(job, { stillIndex: 1.5 }), { code: 'BAD_SELECTION' });
});

// --------------------------------------------------------------------------
// illegal transitions -- the half that matters
// --------------------------------------------------------------------------

test('a done step cannot go back to running without an explicit retryStep', () => {
  const { job } = makeJob();
  beginStep(job, 'still');
  finishStep(job, 'still', { output: { stills: [{ path: 'stills/still-01.png' }] }, cost: { estimated: 0.12, actual: 0.14 } });

  assert.throws(() => beginStep(job, 'still'), { code: 'ILLEGAL_STEP_TRANSITION' },
    'silently restarting a done paid step is how a resume becomes a second bill');
  assert.equal(stepStatus(job, 'still'), 'done');

  retryStep(job, 'still');
  assert.equal(stepStatus(job, 'still'), 'pending');
  beginStep(job, 'still');
  assert.equal(job.steps[4].attempts, 2, 'attempts is a lifetime count; resetting it makes a retry loop infinite');
});

test('a step that never ran cannot be finished', () => {
  const { job } = makeJob();
  assert.throws(() => finishStep(job, 'intake', { output: {} }), { code: 'ILLEGAL_STEP_TRANSITION' },
    'finishing a pending step is how a job reports work it never did');
  assert.throws(() => failStep(job, 'intake', new Error('x')), { code: 'ILLEGAL_STEP_TRANSITION' });
});

test('done and skipped steps refuse every move except an explicit retry', () => {
  const { job } = makeJob();
  beginStep(job, 'intake');
  finishStep(job, 'intake', { output: {} });
  skipStep(job, 'expand', 'both presets');

  assert.throws(() => finishStep(job, 'intake', { output: {} }), { code: 'ILLEGAL_STEP_TRANSITION' });
  assert.throws(() => failStep(job, 'intake', new Error('x')), { code: 'ILLEGAL_STEP_TRANSITION' });
  assert.throws(() => skipStep(job, 'intake', 'changed my mind'), { code: 'ILLEGAL_STEP_TRANSITION' });
  assert.throws(() => beginStep(job, 'expand'), { code: 'ILLEGAL_STEP_TRANSITION' });
  assert.throws(() => finishStep(job, 'expand', { output: {} }), { code: 'ILLEGAL_STEP_TRANSITION' });
});

test('a running step cannot be retried -- that is how you submit twice', () => {
  const { job } = makeJob();
  beginStep(job, 'animate');
  assert.throws(() => retryStep(job, 'animate'), { code: 'ILLEGAL_STEP_TRANSITION' });
  assert.throws(() => retryStep(job, 'tape'), { code: 'ILLEGAL_STEP_TRANSITION' }, 'a pending step has nothing to retry');
});

test('a failed job can never be marked done', () => {
  const { job } = makeJob();
  beginStep(job, 'animate');
  failStep(job, 'animate', Object.assign(new Error('moderation refused'), { code: 'MODERATION', retriable: false }));

  assert.throws(() => setJobStatus(job, 'done'), { code: 'ILLEGAL_JOB_TRANSITION' },
    'a job that reports success after failing is the worst bug this module could have');
  assert.throws(() => completeJob(job, { videoPath: 'timestamp.mp4' }), { code: 'ILLEGAL_JOB_TRANSITION' });
  assert.throws(() => setJobStatus(job, 'running'), { code: 'ILLEGAL_JOB_TRANSITION' },
    'a failed job goes back through queued, so something explicit has to put it there');
  assert.equal(job.status, 'failed');
});

test('a failed job cannot be begun again until a step is retried', () => {
  const { job } = makeJob();
  beginStep(job, 'still');
  failStep(job, 'still', new Error('boom'));
  assert.equal(isResumable(job), false, 'a worker that treats failed as resumable re-runs the failure forever');

  assert.throws(() => beginStep(job, 'still'), { code: 'ILLEGAL_JOB_TRANSITION' });
  retryStep(job, 'still');
  assert.equal(job.status, 'queued');
  assert.equal(job.error, null);
  assert.equal(isResumable(job), true);
  beginStep(job, 'still');
  assert.equal(job.status, 'running');
});

test('done and cancelled are terminal', () => {
  const { job } = makeJob();
  for (const name of STEPS) { beginStep(job, name); finishStep(job, name, { output: {} }); }
  completeJob(job, { videoPath: 'timestamp.mp4', posterPath: 'poster.jpg', durationSeconds: 15, frames: 375, lufs: -27 });

  assert.equal(job.status, 'done');
  assert.equal(nextStep(job), null);
  assert.equal(isResumable(job), false);
  assert.throws(() => setJobStatus(job, 'running'), { code: 'ILLEGAL_JOB_TRANSITION' });
  assert.throws(() => setJobStatus(job, 'failed'), { code: 'ILLEGAL_JOB_TRANSITION' });
  assert.throws(() => retryStep(job, 'publish'), { code: 'ILLEGAL_JOB_TRANSITION' });

  const other = makeJob({ jobId: '20260820-144502-000002' }).job;
  cancelJob(other, 'user deleted it');
  assert.equal(other.status, 'cancelled');
  assert.equal(isResumable(other), false);
  assert.throws(() => setJobStatus(other, 'running'), { code: 'ILLEGAL_JOB_TRANSITION' });
  assert.throws(() => beginStep(other, 'intake'), { code: 'ILLEGAL_JOB_TRANSITION' });
});

test('an unknown step name throws instead of returning undefined', () => {
  const { job } = makeJob();
  for (const call of [
    () => beginStep(job, 'stills'),
    () => finishStep(job, 'Intake', { output: {} }),
    () => stepStatus(job, 'billing'),
    () => recordIntent(job, 'stlil', {}),
  ]) assert.throws(call, { code: 'UNKNOWN_STEP' });
});

test('an unknown status is refused', () => {
  const { job } = makeJob();
  assert.throws(() => setJobStatus(job, 'finished'), { code: 'UNKNOWN_STATUS' });
});

// --------------------------------------------------------------------------
// nextStep / cost
// --------------------------------------------------------------------------

test('nextStep returns the first step that is neither done nor skipped', () => {
  const { job } = makeJob();
  assert.equal(nextStep(job), 'intake');

  beginStep(job, 'intake'); finishStep(job, 'intake', { output: {} });
  assert.equal(nextStep(job), 'moderate');

  beginStep(job, 'moderate'); finishStep(job, 'moderate', { output: {} });
  skipStep(job, 'expand', 'both presets');
  assert.equal(nextStep(job), 'compose', 'a skipped step is behind us; a failed one is not');

  beginStep(job, 'compose');
  assert.equal(nextStep(job), 'compose', 'a running step is still the next step -- that is crash re-entry');

  failStep(job, 'compose', new Error('bad preset'));
  assert.equal(nextStep(job), 'compose');
});

test('the job cost is the sum of the step costs and never double counts', () => {
  const { job } = makeJob();
  beginStep(job, 'still');
  finishStep(job, 'still', { cost: { estimated: 0.12, actual: 0.14 } });
  beginStep(job, 'animate');
  finishStep(job, 'animate', { cost: { estimated: 1.2, actual: 1.35 } });

  assert.equal(job.cost.estimated, 1.32);
  assert.equal(job.cost.actual, 1.49);

  // The dangerous case: a step re-run after an explicit retry must replace its
  // own price, not add a second copy of it.
  retryStep(job, 'animate');
  beginStep(job, 'animate');
  finishStep(job, 'animate', { cost: { estimated: 1.2, actual: 1.4 } });
  assert.equal(job.cost.estimated, 1.32);
  assert.equal(job.cost.actual, 1.54);
});

test('actual stays null until something records one, and currencies never mix', () => {
  const { job } = makeJob();
  beginStep(job, 'still');
  finishStep(job, 'still', { cost: { estimated: 0.12 } });
  assert.equal(job.cost.estimated, 0.12);
  assert.equal(job.cost.actual, null, 'a null actual is honest; a zero actual reads as free');

  beginStep(job, 'animate');
  assert.throws(() => finishStep(job, 'animate', { cost: { estimated: 1, currency: 'EUR' } }), { code: 'CURRENCY_MISMATCH' },
    'summing two currencies produces a number that means nothing and looks like money');
  // A refused finish must not have moved the step first: a step marked done
  // with a price nobody accepted is worse than either state either side of it.
  assert.equal(stepStatus(job, 'animate'), 'running');
  assert.throws(() => finishStep(job, 'animate', { cost: { estimated: -1 } }), { code: 'BAD_COST' });
  assert.throws(() => finishStep(job, 'animate', { cost: { actual: 'free' } }), { code: 'BAD_COST' });
  assert.equal(stepStatus(job, 'animate'), 'running');
  assert.deepEqual(job.steps[6].cost, { estimated: 0, actual: null, currency: 'USD' });
});

// --------------------------------------------------------------------------
// intent records
// --------------------------------------------------------------------------

test('recordIntent writes the record before the request and reports a second sighting', () => {
  const clock = clockFrom('2026-08-20T14:45:01.000Z');
  const { job } = makeJob({ clock });
  beginStep(job, 'still');

  const payload = { prompt: 'the person in the reference image', seed: 12, count: 3 };
  const first = recordIntent(job, 'still', payload);
  assert.equal(first.existing, false);
  assert.deepEqual(Object.keys(first).sort(), ['existing', 'key']);
  assert.ok(first.key.startsWith(`${ID}-still-1-`));

  const record = readIntent(job, 'still');
  assert.equal(record.result, null);
  assert.equal(record.completedAt, null);
  assert.equal(record.recordedAt, '2026-08-20T14:45:01.000Z');
  assert.deepEqual(record.payload, payload);

  // The crash case: the record is on disk, no result was ever written.
  clock.tick(60_000);
  const second = recordIntent(job, 'still', payload);
  assert.equal(second.existing, true, 'this is the "we may have submitted and crashed" case');
  assert.equal(second.key, first.key, 'the key must not change, or the provider treats it as a new request');
  assert.equal(readIntent(job, 'still').recordedAt, '2026-08-20T14:45:01.000Z',
    'the original record is the evidence and must not be restamped');
});

test('the key is a pure function of job, step, attempt and payload', () => {
  const { job } = makeJob();
  const a = recordIntent(job, 'still', { seed: 12, count: 3 });
  const { job: twin } = makeJob({ jobId: '20260820-144502-000003' });
  const b = recordIntent(twin, 'still', { count: 3, seed: 12 });   // same payload, different key order

  assert.notEqual(a.key, b.key, 'two jobs are two renders and must never share an idempotency key');
  assert.equal(
    b.key.split('-').pop(),
    recordIntent(twin, 'still', { seed: 12, count: 3 }).key.split('-').pop(),
    'key order in the payload must not change the digest',
  );
});

test('completing an intent lets a deliberate retry mint a fresh key without losing the receipt', () => {
  const { job } = makeJob();
  beginStep(job, 'still');
  const first = recordIntent(job, 'still', { seed: 12 });
  completeIntent(job, 'still', { requestId: 'req-1', stills: 3 });

  const done = readIntent(job, 'still');
  assert.deepEqual(done.result, { requestId: 'req-1', stills: 3 });
  assert.ok(done.completedAt);

  const second = recordIntent(job, 'still', { seed: 12 });
  assert.equal(second.existing, false, 'the previous request finished; this is a new one');
  assert.notEqual(second.key, first.key, 'reusing the key would return the provider\'s cached first result');
  assert.equal(readIntent(job, 'still').attempt, 2);

  // The receipt for the call that was actually paid for is rotated, not erased.
  const archived = JSON.parse(fs.readFileSync(`${job.paths.intent}/still.1.json`, 'utf8'));
  assert.equal(archived.key, first.key);
  assert.deepEqual(archived.result, { requestId: 'req-1', stills: 3 });
});

test('readIntent is null when nothing was recorded, and completeIntent refuses to invent one', () => {
  const { job } = makeJob();
  assert.equal(readIntent(job, 'animate'), null);
  assert.throws(() => completeIntent(job, 'animate', { ok: true }), { code: 'NO_INTENT' });
});

test('retryStep leaves the intent record alone', () => {
  const { job } = makeJob();
  beginStep(job, 'still');
  const { key } = recordIntent(job, 'still', { seed: 12 });
  failStep(job, 'still', new Error('timeout'));
  retryStep(job, 'still');

  const record = readIntent(job, 'still');
  assert.equal(record.key, key,
    'clearing the intent on retry is the one edit that turns a retry into a silent second charge');
  assert.equal(recordIntent(job, 'still', { seed: 12 }).existing, true);
});

// --------------------------------------------------------------------------
// listJobs
// --------------------------------------------------------------------------

test('listJobs is chronological and survives the junk that ends up in a jobs directory', () => {
  const root = tmpRoot();
  for (const id of ['20260820-144503-000003', '20260820-144501-000001', '20260820-144502-000002']) {
    createJob({ root, jobId: id, input: baseInput(), provider: 'fixture' });
  }
  // One job with an unreadable manifest, one stray directory, one stray file.
  const broken = createJob({ root, jobId: '20260820-144504-000004', input: baseInput(), provider: 'fixture' });
  fs.writeFileSync(broken.paths.manifest, '{"schemaVersion":1,"jo');
  fs.mkdirSync(`${root}/${JOBS_DIR}/not-a-job`, { recursive: true });
  fs.writeFileSync(`${root}/${JOBS_DIR}/README.txt`, 'hello');

  const listed = listJobs({ root });
  assert.deepEqual(listed.map((j) => j.jobId), [
    '20260820-144501-000001', '20260820-144502-000002', '20260820-144503-000003',
  ], 'one unreadable job must not hide the other three from the status page');
  assert.deepEqual(Object.keys(listed[0]).sort(), ['createdAt', 'jobId', 'status', 'updatedAt']);
  assert.equal(listed[0].status, 'queued');
  assert.deepEqual(listJobs({ root: tmpRoot() }), [], 'no jobs directory yet is an empty list, not a throw');
});

// --------------------------------------------------------------------------
// atomicity, against a genuinely concurrent reader
// --------------------------------------------------------------------------

test('a concurrent reader never sees a truncated or invalid manifest', async () => {
  const { job, root } = makeJob();
  const readerFile = `${root}/reader.mjs`;
  // A worker thread, not a child process: a same-thread "reader" could never
  // observe a partial write, because saveJob is synchronous -- it would be a
  // test that cannot fail. This one races the write for real.
  fs.writeFileSync(readerFile, `
import fs from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
const { file, stop, progress } = workerData;
const report = { reads: 0, parsed: 0, transient: 0, invalid: [] };
while (Atomics.load(stop, 0) === 0) {
  // Published so the writer can see this thread is actually running. Under a
  // loaded machine it may not be scheduled at all before the writer finishes.
  Atomics.store(progress, 0, report.parsed);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    report.transient += 1;                       // EPERM/EBUSY mid-rename: expected on Windows
    continue;
  }
  report.reads += 1;
  try {
    const manifest = JSON.parse(text);
    if (typeof manifest.jobId !== 'string' || !Array.isArray(manifest.steps) || manifest.steps.length !== ${STEPS.length}) {
      report.invalid.push('parsed but incomplete: ' + text.slice(0, 120));
    } else {
      report.parsed += 1;
    }
  } catch (err) {
    report.invalid.push(err.message + ' [' + text.length + ' bytes] ' + text.slice(0, 120));
  }
}
parentPort.postMessage(report);
`);

  const stop = new Int32Array(new SharedArrayBuffer(4));
  const progress = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(readerFile, { workerData: { file: job.paths.manifest, stop, progress } });
  const report = new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
  });

  try {
    // Keep writing until the reader has demonstrably observed some of it.
    //
    // The first version wrote a fixed 400 times and then set `stop`. That is a
    // race the test can lose: `npm test` runs test files in parallel, and on a
    // machine with every core busy the reader thread was not scheduled ONCE
    // before the writer finished -- `reads: 0`, so there was no evidence either
    // way and the guard assertion failed. Note what did NOT fail: `invalid` was
    // empty, because a reader that never read cannot see a torn write. A test
    // that can only fail by proving nothing is worse than useless, because the
    // failure looks like a real defect and sends someone hunting for one.
    //
    // So the writer now keeps going until the reader reports real parses, with
    // a wall-clock stop so a genuinely broken reader fails the assertion below
    // instead of hanging the suite.
    const deadline = Date.now() + 10_000;
    for (let i = 0; ; i += 1) {
      // Vary the size so a truncated write would be visible rather than
      // coincidentally the same length as the last good one.
      job.steps[0].output = { i, padding: 'x'.repeat((i % 40) * 64) };
      saveJob(job);
      if (i >= 400 && Atomics.load(progress, 0) >= 5) break;
      if (Date.now() > deadline) break;
    }
  } finally {
    Atomics.store(stop, 0, 1);
  }

  const result = await Promise.race([
    report,
    new Promise((_, reject) => setTimeout(() => reject(new Error('reader worker did not report back')), 15_000).unref?.()),
  ]);
  await worker.terminate();

  assert.deepEqual(result.invalid, [],
    'a half-written manifest is an unrecoverable job, and this system gets killed mid-run on purpose');
  assert.ok(result.parsed > 0, `the reader never managed a read (${JSON.stringify(result)})`);
});

test('JobError carries the code and the job id', () => {
  const err = new JobError('nope', { code: 'X', jobId: ID, detail: { a: 1 } });
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'JobError');
  assert.equal(err.code, 'X');
  assert.equal(err.jobId, ID);
  assert.deepEqual(err.detail, { a: 1 });
});
