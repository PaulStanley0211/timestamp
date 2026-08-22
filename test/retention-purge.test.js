/**
 * Retention: the deletion every user is promised, and the code that performs it.
 *
 * WHY THIS FILE EXISTS. `docs/security-review-2026-08-21.md` F1 and F2 are the
 * two highest findings in the report and neither is a code bug -- they are a
 * promise with nothing behind it. Every upload requires ticking a sentence that
 * says the photo is deleted after 7 days and the finished video after 30, and
 * that either can be deleted sooner on request. Before this file, `purge.mjs`
 * did not exist, `npm run purge` failed, `config/render.json`'s `retention`
 * block was read by nothing except the code that WRITES the promise, and
 * `DELETE /api/jobs/:id` removed the upload while leaving the generated stills,
 * the video and the poster on disk forever.
 *
 * WHAT A FAILURE HERE MEANS. Every assertion below is a sentence of the form
 * "a face this system said it would delete is actually gone". There is no such
 * thing as a cosmetic failure in this file. A failure in the other direction --
 * something deleted that should have survived -- is a customer losing a tape
 * they paid for, so the survival assertions are as load-bearing as the deletion
 * ones and are written alongside every one of them.
 *
 * THE CLOCK IS ALWAYS INJECTED. Retention is a function of age, so a test that
 * used the wall clock would be a test that passes today and fails in a month,
 * or worse, one that deletes nothing and reports success because every fixture
 * it just wrote is zero days old.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

import { createJob, jobPaths } from '../scripts/render/job.mjs';
import { OWNERS_DIR } from '../scripts/auth/accounts.mjs';
import { consentText, RETENTION_DEFAULTS } from '../scripts/safety/consent.mjs';
import { createSessions } from '../scripts/web/session-middleware.mjs';
import { planPurge, executePurge, purgeJobMedia, sweepRetention } from '../scripts/render/purge.mjs';

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

const roots = [];
function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-purge-')).replace(/\\/g, '/');
  roots.push(root);
  return root;
}
test.after(() => {
  for (const root of roots) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* the OS will get it */ }
  }
});

const AT = '2026-08-21T12:00:00.000Z';
const DAY = 86_400_000;

/** `now` for the sweep: a fixed instant every fixture is aged against. */
const NOW = () => new Date(AT);

const baseInput = (over = {}) => ({
  photo: { path: 'input/photo.jpg', sha256: 'a'.repeat(64), width: 1200, height: 1600 },
  place: { kind: 'preset', value: 'schrebergarten-august', photoPath: null, photoSha256: null },
  outfit: { kind: 'preset', value: 'trainingsjacke' },
  stillCount: 3,
  consent: { granted: true, at: '2026-08-20T14:45:00.000Z', text: 'I am in this photo and I agree to it being used to make this video.' },
  ...over,
});

let seq = 0;
/**
 * A job on disk, `ageDays` old relative to `AT`, with a real photograph in
 * `input/` and -- if `withMedia` -- real bytes in every place a face can end up.
 *
 * The bytes are not empty. A test that writes zero-length files and then asserts
 * they are gone cannot tell deletion from a file that was never written.
 */
function seedJob(root, { ageDays, withMedia = true } = {}) {
  const at = new Date(Date.parse(AT) - ageDays * DAY);
  seq += 1;
  const jobId = `${at.toISOString().slice(0, 10).replace(/-/g, '')}-120000-${String(seq).padStart(6, '0')}`;
  const job = createJob({
    root, jobId, input: baseInput(), provider: 'fixture',
    cfg: { durationSeconds: 15 }, nowImpl: () => at,
  });
  const paths = jobPaths(root, jobId);
  fs.writeFileSync(`${paths.input}/photo.jpg`, Buffer.from('a face, as uploaded'));
  if (withMedia) {
    fs.writeFileSync(`${paths.stills}/still-01.png`, Buffer.from('a generated face'));
    fs.writeFileSync(`${paths.stills}/still-02.png`, Buffer.from('the same face again'));
    fs.writeFileSync(`${paths.segments}/seg-01.mp4`, Buffer.from('a moving face'));
    fs.writeFileSync(`${paths.review}/contact-sheet.png`, Buffer.from('every face at once'));
    fs.writeFileSync(paths.source, Buffer.from('the joined source'));
    fs.writeFileSync(paths.video, Buffer.from('the finished tape'));
    fs.writeFileSync(paths.poster, Buffer.from('a frame of the tape'));
  }
  return { job, jobId, paths };
}

// ---------------------------------------------------------------------------
// planning: what would be deleted, and why
// ---------------------------------------------------------------------------

test('planPurge marks the photo of a job older than the photo window, and nothing else', () => {
  const root = tmpRoot();
  const { jobId } = seedJob(root, { ageDays: 8 });

  const plan = planPurge({ root, olderThan: 7, photosOnly: true, nowImpl: NOW });

  assert.equal(plan.entries.length, 1, 'the one job in this root is over the window');
  const [entry] = plan.entries;
  assert.equal(entry.jobId, jobId);
  assert.equal(entry.action, 'photo', 'photosOnly must never escalate to removing the job');
  assert.equal(entry.ageDays, 8);
});

test('a job inside the window is not planned, and the boundary is "after N days" exactly', () => {
  const root = tmpRoot();
  seedJob(root, { ageDays: 6 });
  const { jobId: due } = seedJob(root, { ageDays: 7 });

  const plan = planPurge({ root, olderThan: 7, photosOnly: true, nowImpl: NOW });

  assert.deepEqual(plan.entries.map((e) => e.jobId), [due],
    'the consent text says "after 7 days": six is not due, seven is');
  assert.equal(plan.scanned, 2, 'both jobs were looked at; only one was chosen');
});

test('planPurge touches nothing -- it is safe to run against a live root', () => {
  const root = tmpRoot();
  const { paths } = seedJob(root, { ageDays: 400 });

  planPurge({ root, olderThan: 7, photosOnly: false, nowImpl: NOW });

  assert.ok(fs.existsSync(`${paths.input}/photo.jpg`), 'planning is a read');
  assert.ok(fs.existsSync(paths.video));
  assert.ok(fs.existsSync(paths.manifest));
});

// ---------------------------------------------------------------------------
// executing: F1, the scheduled retention path
// ---------------------------------------------------------------------------

test('at the photo window the upload is deleted and everything else survives', () => {
  const root = tmpRoot();
  const { paths } = seedJob(root, { ageDays: 8 });

  const result = executePurge(
    planPurge({ root, olderThan: 7, photosOnly: true, nowImpl: NOW }),
    { dryRun: false },
  );

  assert.equal(fs.readdirSync(paths.input).length, 0, 'the uploaded photograph is gone');
  assert.ok(fs.existsSync(paths.manifest), 'the manifest holds no image and is the record');
  assert.ok(fs.existsSync(paths.video), 'the video has its own, longer window');
  assert.equal(result.dryRun, false);
  assert.equal(result.photosDeleted, 1);
  assert.equal(result.jobsDeleted, 0);
});

test('executePurge defaults to a dry run, because deleting faces is not an accident', () => {
  const root = tmpRoot();
  const { paths } = seedJob(root, { ageDays: 400 });

  const result = executePurge(planPurge({ root, olderThan: 7, photosOnly: true, nowImpl: NOW }));

  assert.equal(result.dryRun, true, 'the default is stated in docs/interfaces.md §10');
  assert.ok(fs.existsSync(`${paths.input}/photo.jpg`), 'a caller who forgot the flag deleted nothing');
  assert.equal(result.photosDeleted, 1, 'it still reports what it WOULD have deleted');
});

test('at the job window the whole directory goes, and the credit ledger does not', () => {
  const root = tmpRoot();
  const { jobId, paths } = seedJob(root, { ageDays: 31 });
  const { paths: young } = seedJob(root, { ageDays: 29 });
  const ledger = `${root}/out/accounts/${'f'.repeat(32)}.json`;
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.writeFileSync(ledger, JSON.stringify({ ledger: [{ delta: -16, jobId }] }));

  const result = executePurge(
    planPurge({ root, olderThan: 30, photosOnly: false, nowImpl: NOW }),
    { dryRun: false },
  );

  assert.equal(fs.existsSync(paths.dir), false, 'the finished video is deleted after 30 days, as promised');
  assert.ok(fs.existsSync(young.video), 'a tape inside its window is untouched');
  assert.ok(fs.existsSync(ledger), 'the ledger is the cost record and purge must never touch it');
  assert.equal(result.jobsDeleted, 1);
  assert.equal(result.photosDeleted, 0, 'a full removal is not also counted as a photo removal');
});

test('removing a job releases the ownership entry that pointed at it', () => {
  const root = tmpRoot();
  const { jobId } = seedJob(root, { ageDays: 31 });
  const { jobId: keep } = seedJob(root, { ageDays: 1 });
  const accountId = 'ab12'.repeat(8);
  const owners = `${root}/${OWNERS_DIR}/${accountId}`;
  fs.mkdirSync(owners, { recursive: true });
  fs.writeFileSync(`${owners}/${jobId}.json`, JSON.stringify({ jobId, accountId, credits: 16 }));
  fs.writeFileSync(`${owners}/${keep}.json`, JSON.stringify({ jobId: keep, accountId, credits: 16 }));

  executePurge(planPurge({ root, olderThan: 30, nowImpl: NOW }), { dryRun: false });

  assert.equal(fs.existsSync(`${owners}/${jobId}.json`), false,
    'an entry authorising access to a job that no longer exists is a pointer to nothing');
  assert.ok(fs.existsSync(`${owners}/${keep}.json`), 'the other tape on the shelf is untouched');
});

// ---------------------------------------------------------------------------
// drift guards: the promise, the config, and the enforcement must agree
// ---------------------------------------------------------------------------

test('the consent text promises exactly the windows config/render.json holds', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../config/render.json', import.meta.url), 'utf8'));

  assert.equal(RETENTION_DEFAULTS.photoDays, cfg.retention.photoDays);
  assert.equal(RETENTION_DEFAULTS.jobDays, cfg.retention.jobDays);

  const text = consentText();
  assert.match(text, new RegExp(`deleted after ${cfg.retention.photoDays} days`),
    'the sentence a user ticks must name the window purge actually enforces');
  assert.match(text, new RegExp(`video after ${cfg.retention.jobDays} days`));
});

test('the web layer writes ownership entries where purge looks for them', () => {
  const root = tmpRoot();
  const written = [];
  const recordingFs = {
    ...fs,
    mkdirSync: () => {},
    writeFileSync: (file) => { written.push(String(file).split('\\').join('/')); },
  };
  const sessions = createSessions({ root, auth: {}, fsImpl: recordingFs });

  sessions.claimJob({ accountId: 'cd34'.repeat(8), jobId: '20260821-120000-000abc' });

  assert.equal(written.length, 1);
  assert.ok(
    written[0].endsWith(`/${OWNERS_DIR}/${'cd34'.repeat(8)}/20260821-120000-000abc.json`),
    `session-middleware writes ${written[0]}, which purge must be able to find under ${OWNERS_DIR}`,
  );
});

// ---------------------------------------------------------------------------
// F2: the "sooner" half of the sentence -- what a delete request removes
// ---------------------------------------------------------------------------

test('purgeJobMedia removes every place a face can be and keeps the record', () => {
  const root = tmpRoot();
  const { paths } = seedJob(root, { ageDays: 0 });
  fs.writeFileSync(`${paths.logs}/ffmpeg.log`, Buffer.from('stderr, no image'));
  fs.writeFileSync(`${paths.intent}/still.json`, Buffer.from('{"provider":"fixture"}'));
  fs.writeFileSync(paths.cancelRequest, Buffer.from('cancel'));

  const result = purgeJobMedia(paths);

  for (const dir of [paths.input, paths.stills, paths.segments, paths.review]) {
    assert.deepEqual(fs.readdirSync(dir), [], `${dir} still holds bytes`);
  }
  assert.equal(fs.existsSync(paths.source), false);
  assert.equal(fs.existsSync(paths.video), false);
  assert.equal(fs.existsSync(paths.poster), false);

  assert.ok(fs.existsSync(paths.manifest), 'the record of what happened, and no image');
  assert.ok(fs.existsSync(`${paths.logs}/ffmpeg.log`), 'ffmpeg stderr is operational, not personal');
  assert.ok(fs.existsSync(`${paths.intent}/still.json`), 'intent records are prompts and ids, not pixels');
  assert.ok(fs.existsSync(paths.cancelRequest),
    'removing the sentinel would let a worker mid-step render back into the directory just emptied');

  assert.equal(result.photosDeleted, 1, 'one upload');
  assert.equal(result.filesDeleted, 8, 'photo + 2 stills + segment + contact sheet + source + video + poster');
});

test('purgeJobMedia is idempotent -- a person who clicks delete twice is not an error', () => {
  const root = tmpRoot();
  const { paths } = seedJob(root, { ageDays: 0 });

  const first = purgeJobMedia(paths);
  const second = purgeJobMedia(paths);

  assert.equal(first.filesDeleted, 8);
  assert.equal(second.filesDeleted, 0, 'nothing left, and it says so rather than throwing');
  assert.ok(fs.existsSync(paths.manifest));
});

// ---------------------------------------------------------------------------
// the CLI: `npm run purge`, which F1 recorded as failing outright
// ---------------------------------------------------------------------------

/** The CLI in a child process, against a temp root carrying its own config. */
function runCli(root, args = []) {
  fs.mkdirSync(`${root}/config`, { recursive: true });
  fs.writeFileSync(`${root}/config/render.json`,
    JSON.stringify({ retention: { photoDays: 7, jobDays: 30 } }));
  const cli = new URL('../scripts/render/purge-cli.mjs', import.meta.url);
  return spawnSync(process.execPath, [cli.pathname.replace(/^\//, ''), `--root=${root}`, ...args], {
    encoding: 'utf8',
  });
}

test('npm run purge reports what is due and deletes nothing without --apply', () => {
  const root = tmpRoot();
  const { paths } = seedJob(root, { ageDays: 400 });

  const run = runCli(root);

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /would delete/);
  assert.match(run.stdout, /Re-run with --apply/);
  assert.ok(fs.existsSync(paths.dir), 'a bare `npm run purge` must never delete a face');
});

test('npm run purge -- --apply keeps the promise, both windows in one command', () => {
  const root = tmpRoot();
  const { paths: old } = seedJob(root, { ageDays: 400 });
  const { paths: middling } = seedJob(root, { ageDays: 10 });
  const { paths: fresh } = seedJob(root, { ageDays: 1 });

  const run = runCli(root, ['--apply']);

  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.existsSync(old.dir), false, 'past jobDays: the whole job');
  assert.deepEqual(fs.readdirSync(middling.input), [], 'past photoDays: the upload');
  assert.ok(fs.existsSync(middling.video), 'and not the video, which has longer');
  assert.ok(fs.existsSync(`${fresh.input}/photo.jpg`), 'inside both windows: untouched');
});

test('--execute is honoured too, because that is what the operator guide called it', () => {
  const root = tmpRoot();
  const { paths } = seedJob(root, { ageDays: 400 });

  const run = runCli(root, ['--execute']);

  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.existsSync(paths.dir), false);
});

test('purge refuses to invent a retention policy when config has none', () => {
  const root = tmpRoot();
  seedJob(root, { ageDays: 400 });
  fs.mkdirSync(`${root}/config`, { recursive: true });
  fs.writeFileSync(`${root}/config/render.json`, JSON.stringify({ retention: {} }));
  const cli = new URL('../scripts/render/purge-cli.mjs', import.meta.url);

  const run = spawnSync(process.execPath,
    [cli.pathname.replace(/^\//, ''), `--root=${root}`, '--apply'], { encoding: 'utf8' });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /will not invent one/);
});

test('purgeJobMedia reports a deletion it could not perform, rather than counting it as done', () => {
  const root = tmpRoot();
  const { paths } = seedJob(root, { ageDays: 0 });

  // On Windows this is not exotic: the browser is streaming the tape from
  // `getVideo` at the moment its owner clicks delete, so the unlink is refused.
  // Before this test, the failure was swallowed by `catch { continue; }`, the
  // handler returned 200, and the person was told a face was deleted that was
  // still on disk -- F2 recurring inside the fix for F2.
  const locked = {
    ...fs,
    rmSync(file, opts) {
      if (String(file).endsWith('timestamp.mp4')) {
        const err = new Error('EBUSY: resource busy or locked'); err.code = 'EBUSY'; throw err;
      }
      return fs.rmSync(file, opts);
    },
  };

  const result = purgeJobMedia(paths, { fsImpl: locked });

  assert.equal(result.errors.length, 1, 'the one file that survived is reported');
  assert.equal(result.errors[0].code, 'EBUSY');
  assert.match(result.errors[0].path, /timestamp\.mp4$/);
  assert.ok(fs.existsSync(paths.video), 'and it really is still there');
  assert.ok(!result.removed.includes(paths.video), 'a file that survived is not listed as removed');
  assert.equal(result.filesDeleted, 7, 'eight files, one refused');
});

test('a clean purge reports no errors, so the field is a signal rather than noise', () => {
  const root = tmpRoot();
  const { paths } = seedJob(root, { ageDays: 0 });

  const result = purgeJobMedia(paths);

  assert.deepEqual(result.errors, []);
  assert.equal(result.filesDeleted, 8);
});

// ---------------------------------------------------------------------------
// the canonical sweep: one ordering rule, used by both the CLI and the worker
// ---------------------------------------------------------------------------

test('sweepRetention runs both windows in the documented order and reports both', () => {
  const root = tmpRoot();
  const { paths: old } = seedJob(root, { ageDays: 400 });
  const { paths: middling } = seedJob(root, { ageDays: 10 });
  const { paths: fresh } = seedJob(root, { ageDays: 1 });

  const result = sweepRetention({
    root, retention: { photoDays: 7, jobDays: 30 }, nowImpl: NOW, dryRun: false,
  });

  assert.equal(fs.existsSync(old.dir), false, 'past jobDays: the whole job');
  assert.deepEqual(fs.readdirSync(middling.input), [], 'past photoDays: the upload');
  assert.ok(fs.existsSync(middling.video), 'and not the video, which has longer');
  assert.ok(fs.existsSync(`${fresh.input}/photo.jpg`), 'inside both windows: untouched');
  assert.equal(result.jobsDeleted, 1);
  assert.equal(result.photosDeleted, 1);
  assert.deepEqual(result.errors, []);
});

test('a job removed whole is not also counted as a photo removal -- the totals must not lie', () => {
  const root = tmpRoot();
  seedJob(root, { ageDays: 400 });   // past BOTH windows

  const result = sweepRetention({
    root, retention: { photoDays: 7, jobDays: 30 }, nowImpl: NOW, dryRun: false,
  });

  assert.equal(result.jobsDeleted, 1);
  assert.equal(result.photosDeleted, 0,
    'this is the ordering rule that used to live in two places and could drift apart');
});

test('sweepRetention skips what the caller says is off limits', () => {
  const root = tmpRoot();
  const { jobId, paths } = seedJob(root, { ageDays: 400 });

  const result = sweepRetention({
    root, retention: { photoDays: 7, jobDays: 30 }, nowImpl: NOW, dryRun: false,
    skip: new Set([jobId]),
  });

  assert.ok(fs.existsSync(paths.dir), 'the worker passes its leased jobs here');
  assert.equal(result.jobsDeleted, 0);
  assert.equal(result.skipped, 1, 'and a deferral is reported rather than looking like nothing was due');
});

test('sweepRetention honours dryRun, so the CLI and the worker share one destructive path', () => {
  const root = tmpRoot();
  const { paths } = seedJob(root, { ageDays: 400 });

  const result = sweepRetention({
    root, retention: { photoDays: 7, jobDays: 30 }, nowImpl: NOW, dryRun: true,
  });

  assert.ok(fs.existsSync(paths.dir), 'nothing deleted');
  assert.equal(result.jobsDeleted, 1, 'but it still reports what would go');
  assert.equal(result.dryRun, true);
});
