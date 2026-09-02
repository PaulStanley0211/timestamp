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
import { fileURLToPath } from 'node:url';

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
/**
 * `from` EXISTS BECAUSE THE CLI TESTS CANNOT FREEZE THE CLOCK.
 *
 * Everything in-process is handed `nowImpl` and measured against the fixed AT,
 * which is what makes those tests read as arithmetic rather than as luck. The
 * three tests that spawn `purge-cli.mjs` cannot do that: it is a separate
 * process reading the real wall clock, and no flag lets a caller override it.
 *
 * Seeding those against AT was therefore a bug with a fuse on it. A job seeded
 * at `ageDays: 1` relative to AT is dated the 20th of August; it stayed inside
 * the seven-day photo window until the real date reached the 27th, and then
 * `purge` began deleting it -- correctly -- and the test that asserted it
 * survived began failing, six days after anyone wrote it. Measured today: real
 * now is 2026-08-27, AT is 2026-08-21, and the "one day old" photo is seven.
 *
 * So a CLI test seeds from real now, and its ages mean what they say.
 */
function seedJob(root, { ageDays, withMedia = true, from = Date.parse(AT) } = {}) {
  const at = new Date(from - ageDays * DAY);
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
  return spawnSync(process.execPath, [fileURLToPath(cli), `--root=${root}`, ...args], {
    encoding: 'utf8',
  });
}

test('npm run purge reports what is due and deletes nothing without --apply', () => {
  const root = tmpRoot();
  const { paths } = seedJob(root, { ageDays: 400, from: Date.now() });

  const run = runCli(root);

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /would delete/);
  assert.match(run.stdout, /Re-run with --apply/);
  assert.ok(fs.existsSync(paths.dir), 'a bare `npm run purge` must never delete a face');
});

test('npm run purge -- --apply keeps the promise, both windows in one command', () => {
  const root = tmpRoot();
  const { paths: old } = seedJob(root, { ageDays: 400, from: Date.now() });
  const { paths: middling } = seedJob(root, { ageDays: 10, from: Date.now() });
  const { paths: fresh } = seedJob(root, { ageDays: 1, from: Date.now() });

  const run = runCli(root, ['--apply']);

  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.existsSync(old.dir), false, 'past jobDays: the whole job');
  assert.deepEqual(fs.readdirSync(middling.input), [], 'past photoDays: the upload');
  assert.ok(fs.existsSync(middling.video), 'and not the video, which has longer');
  assert.ok(fs.existsSync(`${fresh.input}/photo.jpg`), 'inside both windows: untouched');
});

test('--execute is honoured too, because that is what the operator guide called it', () => {
  const root = tmpRoot();
  const { paths } = seedJob(root, { ageDays: 400, from: Date.now() });

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
    [fileURLToPath(cli), `--root=${root}`, '--apply'], { encoding: 'utf8' });

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

/** A directory that cannot be LISTED is not a directory that is empty. The
 *  existing test injects a refusing `rmSync`; this one refuses one level up,
 *  at `readdirSync`, which is the read every deletion here starts from. Before
 *  it, an EACCES on `input/` produced `errors: []`, `photosDeleted: 0` and a
 *  200 telling a person their photograph was gone. */
test('purgeJobMedia reports a directory it could not list, rather than treating it as empty', () => {
  const root = tmpRoot();
  const { paths } = seedJob(root, { ageDays: 0 });

  const refused = {
    ...fs,
    readdirSync(dir, opts) {
      if (String(dir) === paths.input) {
        const err = new Error(`EACCES: permission denied, scandir '${dir}'`); err.code = 'EACCES'; throw err;
      }
      return fs.readdirSync(dir, opts);
    },
  };

  const result = purgeJobMedia(paths, { fsImpl: refused });

  assert.equal(result.photosDeleted, 0, 'nothing under input/ was touched');
  assert.ok(fs.existsSync(`${paths.input}/photo.jpg`), 'and the photograph really is still there');
  const listing = result.errors.filter((e) => e.path === paths.input);
  assert.equal(listing.length, 1, `the unlistable directory is reported once: ${JSON.stringify(result.errors)}`);
  assert.equal(listing[0].code, 'EACCES');
  // The rest of the job was still purged: one unreadable directory does not
  // excuse the stills, the segments and the tape.
  assert.equal(fs.existsSync(paths.video), false, 'the tape was still deleted');
  assert.equal(fs.existsSync(`${paths.stills}/still-01.png`), false, 'the stills were still deleted');
});

test('a directory that is simply absent is still the goal state, not an error', () => {
  const root = tmpRoot();
  const { paths } = seedJob(root, { ageDays: 0 });
  fs.rmSync(paths.input, { recursive: true, force: true });

  const result = purgeJobMedia(paths);

  assert.deepEqual(result.errors, [], 'ENOENT is the one code that means "already gone"');
  assert.equal(result.photosDeleted, 0);
});

test('the retention sweep names a photo directory it could not list, instead of skipping it in silence', () => {
  const root = tmpRoot();
  const { jobId, paths } = seedJob(root, { ageDays: 10 });

  const refused = {
    ...fs,
    readdirSync(dir, opts) {
      if (String(dir) === paths.input) {
        const err = new Error(`EIO: i/o error, scandir '${dir}'`); err.code = 'EIO'; throw err;
      }
      return fs.readdirSync(dir, opts);
    },
  };

  const result = sweepRetention({
    root, retention: { photoDays: 7, jobDays: 30 }, nowImpl: NOW, dryRun: false, fsImpl: refused,
  });

  assert.equal(result.photosDeleted, 0);
  assert.ok(fs.existsSync(`${paths.input}/photo.jpg`), 'the photograph is still there');
  const mine = result.errors.filter((e) => e.jobId === jobId);
  assert.equal(mine.length, 1, `the sweep must say so: ${JSON.stringify(result.errors)}`);
  assert.equal(mine[0].code, 'EIO');
  assert.equal(mine[0].action, 'photo');
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

test('an unknown flag stops the sweep instead of being ignored', () => {
  const root = tmpRoot();
  const { paths } = seedJob(root, { ageDays: 400, from: Date.now() });

  // `--job=<id>` DOES NOT EXIST, and on 2026-08-27 it was typed on a real
  // machine alongside --apply. It was accepted in silence and the full
  // retention sweep ran: the operator believed they were deleting one job and
  // deleted every photograph past its window across twenty-six of them.
  //
  // Nothing was lost that was not already due -- which is exactly why this is
  // worth a test rather than a shrug. The window is the only thing standing
  // between "correct" and "deleted somebody's face six days early", and this is
  // the one command in the product whose entire purpose is destroying data. An
  // argument it does not understand is not a request it may reinterpret.
  const run = runCli(root, ['--job=20260827-154509-4c79c6', '--apply']);

  assert.notEqual(run.status, 0, 'an unknown flag was accepted');
  assert.match(run.stderr, /--job/, 'the refusal does not say WHICH argument was wrong');
  assert.ok(fs.existsSync(paths.dir), 'the sweep ran anyway');
  assert.ok(fs.existsSync(`${paths.input}/photo.jpg`), 'a photograph was deleted by a refused command');
});

test('a typo in a real flag is refused rather than silently defaulted', () => {
  const root = tmpRoot();
  const { paths } = seedJob(root, { ageDays: 400, from: Date.now() });

  // The dangerous shape is not an invented flag, it is a NEAR MISS: --photodays
  // reads as --photo-days and is not, so the sweep would fall back to the
  // configured window while the operator believed they had widened it.
  const run = runCli(root, ['--photodays=999', '--apply']);

  assert.notEqual(run.status, 0, 'a near-miss flag was accepted');
  assert.ok(fs.existsSync(paths.dir), 'the sweep ran on the configured window, not the asked-for one');
});

test('the flags the command really has are all still accepted', () => {
  const root = tmpRoot();
  seedJob(root, { ageDays: 400, from: Date.now() });

  // The guard must not become a second place the flag list can drift from.
  const run = runCli(root, ['--photo-days=7', '--job-days=30', '--json', '--apply']);
  assert.equal(run.status, 0, run.stderr);
});

/**
 * A JOB WHOSE MANIFEST WILL NOT PARSE IS REPORTED, NOT INVISIBLE.
 *
 * `listJobs` swallows a parse failure with `catch { continue }`. That is right
 * for the status page -- its own comment says one unreadable job must not hide
 * the other two hundred -- and wrong for the module that keeps a deletion
 * promise, which enumerates jobs through the same function.
 *
 * The consequence: the job is absent from the plan on every pass, forever, so
 * `input/photo.jpg` outlives both the seven-day and thirty-day promises
 * indefinitely. And because `errors` stays empty the worker suppresses its
 * `purged` event entirely, so no operator line is ever printed. A silent
 * unkept promise is exactly what this module exists to prevent.
 *
 * It is not hypothetical: the queue's own header advertises that these files
 * are repaired with a text editor, and a half-copied backup or a disk fault
 * produces the same thing.
 *
 * REPORTED, NEVER DELETED ON A GUESS. An unparseable manifest has no readable
 * createdAt, so nothing knows whether its window has passed, and deleting
 * somebody's photograph on a guess is the one failure this module refuses.
 */
test('a corrupt manifest is surfaced by the sweep instead of hiding a photograph', () => {
  const root = tmpRoot();
  const { jobId: healthy } = seedJob(root, { ageDays: 8 });
  const { jobId: broken } = seedJob(root, { ageDays: 8 });

  // A half-written manifest, which is what a killed copy or a bad sector leaves.
  fs.writeFileSync(`${jobPaths(root, broken).dir}/manifest.json`, '{"jobId":"' + broken + '","stat');

  const plan = planPurge({ root, olderThan: 7, photosOnly: true, nowImpl: NOW });

  assert.deepEqual(plan.entries.map((e) => e.jobId), [healthy],
    'the readable job is still planned exactly as before');
  assert.deepEqual(plan.unreadable.map((r) => r.jobId), [broken],
    'the corrupt job vanished from the plan instead of being reported');

  const result = executePurge(plan, { dryRun: false });
  const reported = result.errors.filter((e) => e.jobId === broken);
  assert.equal(reported.length, 1,
    'the sweep reported no error, so the worker prints nothing and the photograph is stranded silently');
  assert.match(reported[0].message, /will not parse/);

  // And the promise is still kept for the job that could be read.
  assert.equal(result.photosDeleted, 1);
  // The corrupt job's photograph is deliberately still there: it was reported,
  // not guessed at.
  assert.ok(fs.existsSync(jobPaths(root, broken).input),
    'a job with no readable age must not be deleted on a guess');
});

test('the sweep tolerates an owners directory vanishing mid-scan -- account deletion now runs beside it', () => {
  // Deletion spec §5's last bullet, verified rather than assumed: an account
  // deletion removes `out/owners/<accountId>` whole while a sweep may be
  // between its readdir of `out/owners` and its stat of the entry inside.
  // The overlay stages exactly that: the directory is still listed, and every
  // later touch of anything under it answers ENOENT.
  const root = tmpRoot();
  const { jobId, paths } = seedJob(root, { ageDays: 31 });
  const accountId = 'a'.repeat(32);
  fs.mkdirSync(`${root}/${OWNERS_DIR}/${accountId}`, { recursive: true });
  fs.writeFileSync(`${root}/${OWNERS_DIR}/${accountId}/${jobId}.json`, JSON.stringify({ jobId, accountId }));

  const vanished = `${path.resolve(root).split(path.sep).join('/')}/${OWNERS_DIR}/${accountId}`;
  const enoent = (p) => {
    const err = new Error(`ENOENT: no such file or directory, stat '${p}'`);
    err.code = 'ENOENT';
    throw err;
  };
  const under = (p) => String(p).split(path.sep).join('/').startsWith(vanished);
  const fsImpl = {
    ...fs,
    statSync: (p, ...rest) => (under(p) ? enoent(p) : fs.statSync(p, ...rest)),
    rmSync: (p, ...rest) => (under(p) ? enoent(p) : fs.rmSync(p, ...rest)),
  };

  const result = sweepRetention({
    root, retention: { photoDays: 7, jobDays: 30 }, nowImpl: NOW, dryRun: false, fsImpl,
  });

  assert.equal(result.jobsDeleted, 1, 'a vanished ownership index must not stop the job deletion');
  assert.equal(fs.existsSync(paths.dir), false, 'the job directory must still be deleted');
  assert.deepEqual(result.errors, [], 'a directory that is already gone is the goal state, not a failure');
});
