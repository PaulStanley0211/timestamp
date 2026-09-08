/**
 * Retention. The deletion this system promises every person who uploads a face.
 *
 * WHY THIS MODULE EXISTS. `scripts/safety/consent.mjs` renders a sentence that
 * every upload must tick: the photo is deleted after `photoDays`, the finished
 * video after `jobDays`, and either can be deleted sooner on request. Until this
 * file existed that sentence was the only consumer of `config/render.json`'s
 * `retention` block -- the promise was generated from a config that nothing
 * enforced. `docs/security-review-2026-08-21.md` F1 is that gap, and it is the
 * highest finding in the report because it is not a bug that might be exploited,
 * it is a written commitment collected from every user and never kept.
 *
 * PLAN AND EXECUTE ARE SEPARATE, AND THAT IS THE WHOLE DESIGN.
 * `docs/interfaces.md` §10 specifies it and the reason is in the same sentence:
 * deleting faces is not a thing that happens by accident. `planPurge` reads and
 * decides and touches nothing; `executePurge` deletes and **defaults to
 * `dryRun: true`**, so the careless call is the safe one. Every operator path --
 * the CLI, the worker sweep -- has to say `dryRun: false` out loud.
 *
 * AGE IS MEASURED FROM `createdAt`, NEVER `updatedAt`.
 * `updatedAt` is restamped by every `saveJob`, so a job that is retried, resumed
 * or merely inspected would push its own deletion date forward -- and a retry
 * loop on a stuck job would push it forward forever. `createdAt` is written once
 * and never moves, which makes the deletion date a property of the upload rather
 * than of how much attention the job has had since. The direction this errs in
 * matters and it is the right one: a job that sat queued for a fortnight before
 * rendering has its video deleted 30 days after the upload rather than 30 days
 * after the render, i.e. sooner than promised rather than later.
 *
 * WHAT SURVIVES A FULL PURGE. `manifest.json` holds no image -- it holds ids,
 * step timings, costs and the consent record -- but at `jobDays` the whole job
 * directory goes, manifest included, because by then nothing needs it: the
 * credit ledger lives on the account record in `out/accounts/`, append-only and
 * never touched by this module, and the receipt for what the person chose and
 * was charged lives in the ownership entry. Neither is derived from the
 * manifest. The ownership entry is removed alongside the directory, because an
 * entry authorising access to a job that no longer exists is a pointer to
 * nothing that would otherwise accumulate forever.
 */

import fs from 'node:fs';
import path from 'node:path';

import { listJobs, jobPaths } from './job.mjs';
import { OWNERS_DIR } from '../auth/accounts.mjs';

const DAY_MS = 86_400_000;
const defaultNow = () => new Date();
const slash = (p) => p.split(path.sep).join('/');

/** Thrown rather than returned, because every caller of this module is either a
 *  CLI that should print and exit or a sweep that should log and carry on, and
 *  both of those want a `code` to switch on. */
export class PurgeError extends Error {
  constructor(message, { code = 'PURGE_FAILED', jobId = null } = {}) {
    super(message);
    this.name = 'PurgeError';
    this.code = code;
    this.jobId = jobId;
  }
}

/**
 * Whole days between `createdAt` and `now`, floored.
 *
 * Floored rather than rounded, so "older than 7 days" is false at 7 days and 23
 * hours minus a second and true the instant the eighth day begins. Rounding
 * would delete a photograph on day six and a half, which is earlier than the
 * sentence the user agreed to and therefore a different promise.
 */
export function ageInDays(createdAt, now) {
  const then = Date.parse(createdAt);
  if (!Number.isFinite(then)) return null;
  return Math.floor((now.getTime() - then) / DAY_MS);
}

/**
 * What would be deleted, and why. Reads only.
 *
 * @param {object}   args
 * @param {string}   args.root          repo root; jobs live under `out/jobs`
 * @param {number}   args.olderThan     age in whole days at which a job is due
 * @param {boolean} [args.photosOnly]   true: only `input/`. false: the directory.
 * @param {Function} [args.nowImpl]     injected clock; retention is a function
 *                                      of age, so a wall-clock default in a test
 *                                      is a test that proves nothing.
 * @returns {{at: string, root: string, olderThan: number, photosOnly: boolean,
 *            scanned: number, entries: Array<object>}}
 */
export function planPurge({ root, olderThan, photosOnly = false, nowImpl = defaultNow }) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new PurgeError('root must be a non-empty string', { code: 'BAD_ROOT' });
  }
  if (!Number.isFinite(olderThan) || olderThan < 0) {
    throw new PurgeError(`olderThan must be a non-negative number of days, got ${olderThan}`, { code: 'BAD_WINDOW' });
  }
  const now = nowImpl();
  const action = photosOnly ? 'photo' : 'job';

  // THE UNREADABLE ONES ARE ASKED FOR, because this function keeps a promise
  // and the ones it cannot read are exactly the ones that would quietly outlive
  // it. `listJobs` swallows a parse failure for the status page, where one bad
  // job must not hide two hundred good ones; here that swallow means a
  // photograph stays on disk past its window with `errors` empty, so nothing is
  // ever printed.
  const rows = listJobs({ root, includeUnreadable: true });
  const unreadable = rows.filter((r) => r.unreadable);
  const entries = [];
  for (const row of rows) {
    if (row.unreadable) continue;
    const ageDays = ageInDays(row.createdAt, now);
    // A manifest with no readable `createdAt` has no age, and a job with no age
    // is not something to delete on a guess. It is reported instead.
    if (ageDays === null || ageDays < olderThan) continue;
    entries.push({
      jobId: row.jobId,
      status: row.status,
      createdAt: row.createdAt,
      ageDays,
      action,
      dir: jobPaths(root, row.jobId).dir,
    });
  }

  return {
    at: now.toISOString(),
    root: slash(path.resolve(root)),
    olderThan,
    photosOnly,
    scanned: rows.length,
    entries,
    // Reported, never deleted on a guess. A job whose manifest will not parse
    // has no readable `createdAt`, so nothing here knows whether its window has
    // passed -- and deleting somebody's photograph on a guess is the one
    // failure this module refuses. The operator gets the id and the reason.
    unreadable,
  };
}

/**
 * Deletes what the plan chose. **Defaults to a dry run.**
 *
 * The default is the point, not a convenience: `docs/interfaces.md` §10 fixes it
 * and the reason is that the failure mode of this function is not an exception,
 * it is a person's photograph being gone. A caller who forgets the flag gets a
 * report of what would have happened; every real deletion path in this repo says
 * `dryRun: false` in so many words.
 *
 * A dry run still READS -- it opens `input/` to count what is there -- because a
 * report that says "1 job" without saying whether that job still holds any bytes
 * is not a report anybody can act on.
 *
 * ONE JOB'S FAILURE DOES NOT STOP THE SWEEP. A directory held open by a virus
 * scanner is a Tuesday on Windows, and a sweep that aborts on the first one
 * leaves every job after it in the list undeleted and unreported. Failures are
 * collected into `errors` and the exit code is the CLI's problem.
 *
 * @param {object}   plan               from `planPurge`
 * @param {object}  [opts]
 * @param {boolean} [opts.dryRun=true]  report only
 * @param {object}  [opts.fsImpl=fs]    test seam
 * @returns {{dryRun: boolean, at: string, photosDeleted: number,
 *            jobsDeleted: number, filesRemoved: number,
 *            removed: Array<object>, errors: Array<object>}}
 */
export function executePurge(plan, { dryRun = true, fsImpl = fs } = {}) {
  if (!plan || !Array.isArray(plan.entries)) {
    throw new PurgeError('executePurge takes a plan from planPurge', { code: 'BAD_PLAN' });
  }

  const removed = [];
  // A JOB THE PLAN COULD NOT READ IS AN ERROR, NOT AN ABSENCE. It is carried
  // into `errors` so it reaches the worker's `purged` event -- which is
  // suppressed entirely when nothing was deleted and `errors` is empty, so
  // without this the operator's only signal that a photograph is stranded past
  // its window is silence.
  const errors = (plan.unreadable ?? []).map((row) => ({
    jobId: row.jobId,
    action: 'read',
    message: `manifest.json will not parse, so this job has no readable age and was not considered: ${row.unreadable?.message ?? 'unknown'}`,
    code: row.unreadable?.code ?? 'CORRUPT',
  }));
  let photosDeleted = 0;
  let jobsDeleted = 0;
  let filesRemoved = 0;

  for (const entry of plan.entries) {
    try {
      const paths = jobPaths(plan.root, entry.jobId);
      if (entry.action === 'photo') {
        const files = listFiles(fsImpl, paths.input);
        if (files.length === 0) continue;
        if (!dryRun) for (const file of files) fsImpl.rmSync(file, { force: true });
        removed.push({ jobId: entry.jobId, action: 'photo', paths: files });
        filesRemoved += files.length;
        photosDeleted += 1;
      } else {
        if (!fsImpl.existsSync(paths.dir)) continue;
        const owners = ownerEntriesFor(fsImpl, plan.root, entry.jobId);
        if (!dryRun) {
          fsImpl.rmSync(paths.dir, { recursive: true, force: true });
          for (const file of owners) fsImpl.rmSync(file, { force: true });
        }
        removed.push({ jobId: entry.jobId, action: 'job', paths: [paths.dir, ...owners] });
        jobsDeleted += 1;
      }
    } catch (err) {
      errors.push({ jobId: entry.jobId, action: entry.action, message: err.message, code: err.code ?? null });
    }
  }

  return { dryRun, at: plan.at, photosDeleted, jobsDeleted, filesRemoved, removed, errors };
}

/**
 * Both retention windows, in the one order that makes the totals honest.
 *
 * WHY THIS EXISTS RATHER THAN LIVING AT THE CALL SITES. This ordering rule --
 * sweep whole jobs first, collect what went, then subtract those from the photo
 * plan -- was written out twice, once in `purge-cli.mjs` and once in the
 * worker's `sweepRetention()`. Two copies of one correctness rule is two places
 * for it to drift, and only one of the two knew about leases. It is a rule about
 * retention, so it belongs in the retention module, and both callers now get the
 * lease guard for free.
 *
 * The order is not cosmetic: a job past `jobDays` is removed whole, so planning
 * the photo pass against it would count one job twice and report a `photosDeleted`
 * that never happened.
 *
 * @param {object}   args
 * @param {string}   args.root
 * @param {{photoDays: number, jobDays: number}} args.retention
 * @param {Function} [args.nowImpl]
 * @param {boolean}  [args.dryRun=true]  the module-wide default: acting is opt-in
 * @param {Set}      [args.skip]         job ids to leave alone this pass -- the
 *   worker passes everything holding a live lease, because age says delete and a
 *   lease says not yet, and the lease wins. Deferred, never spared.
 * @param {object}   [args.fsImpl]
 * @returns {{dryRun: boolean, at: string, retention: object, scanned: number,
 *            jobsDeleted: number, photosDeleted: number, filesRemoved: number,
 *            skipped: number, removed: Array<object>, errors: Array<object>}}
 */
export function sweepRetention({
  root, retention, nowImpl = defaultNow, dryRun = true, skip = null, fsImpl = fs,
} = {}) {
  const photoDays = Number(retention?.photoDays);
  const jobDays = Number(retention?.jobDays);
  if (!Number.isFinite(photoDays) || !Number.isFinite(jobDays)) {
    throw new PurgeError(
      `retention must be {photoDays, jobDays} as numbers, got ${JSON.stringify(retention)} -- `
      + 'purge will not invent a policy nobody was shown',
      { code: 'BAD_RETENTION' },
    );
  }

  // DISTINCT job ids, not a per-pass tally. A job past BOTH windows appears in
  // both plans, so incrementing a counter in each pass reports one deferred job
  // as two -- which is the same class of lie the job-first ordering exists to
  // prevent.
  const deferred = new Set();
  const spare = (plan) => {
    if (skip?.size) {
      plan.entries = plan.entries.filter((e) => {
        if (!skip.has(e.jobId)) return true;
        deferred.add(e.jobId);
        return false;
      });
    }
    return plan;
  };

  const jobs = executePurge(
    spare(planPurge({ root, olderThan: jobDays, photosOnly: false, nowImpl })),
    { dryRun, fsImpl },
  );

  const gone = new Set(jobs.removed.map((r) => r.jobId));
  const photoPlan = spare(planPurge({ root, olderThan: photoDays, photosOnly: true, nowImpl }));
  photoPlan.entries = photoPlan.entries.filter((e) => !gone.has(e.jobId));
  const photos = executePurge(photoPlan, { dryRun, fsImpl });

  return {
    dryRun,
    at: jobs.at,
    root: photoPlan.root,
    retention: { photoDays, jobDays },
    scanned: photoPlan.scanned,
    jobsDeleted: jobs.jobsDeleted,
    photosDeleted: photos.photosDeleted,
    filesRemoved: jobs.filesRemoved + photos.filesRemoved,
    skipped: deferred.size,
    removed: [...jobs.removed, ...photos.removed],
    errors: [...jobs.errors, ...photos.errors],
  };
}

/** `true` for the one failure that means "already gone". Everything else --
 *  EACCES, EIO, EMFILE, ENOTDIR on a path that should be a directory -- means
 *  the question was not answered, and an unanswered question about a
 *  directory full of faces must never read as an empty one. */
const isAbsent = (err) => err?.code === 'ENOENT';

/** Absolute paths of the plain files directly inside `dir`, or `[]`. A missing
 *  directory is not an error here: a job cancelled before its photo landed has
 *  no `input/`, and that is the state purge exists to arrive at.
 *
 *  ABSENT MEANS ENOENT AND NOTHING ELSE. The first version swallowed every
 *  failure, so a directory that exists but cannot be READ -- a root-owned
 *  `input/` of the §34B/§54E class, an EIO from the disk, EMFILE on a busy
 *  worker -- was indistinguishable from one that is empty: the sweep deleted
 *  nothing and said nothing, and the per-job delete answered a person that
 *  their photograph was gone while it sat on disk. That is the F2 shape one
 *  layer up from where it was last closed. Anything but absence throws, and
 *  every caller here already reports what it could not do. */
function listFiles(fsImpl, dir) {
  let names;
  try {
    names = fsImpl.readdirSync(dir);
  } catch (err) {
    if (isAbsent(err)) return [];
    throw err;
  }
  return names.map((name) => `${dir}/${name}`);
}

/**
 * Every ownership entry pointing at this job, across all accounts.
 *
 * Scanned rather than looked up, because purge starts from a job id and the
 * index is keyed the other way -- `out/owners/<accountId>/<jobId>.json`. There
 * is normally exactly one, and the loop exists so that a job somehow claimed
 * twice does not leave the second entry behind pointing at a deleted directory.
 */
function ownerEntriesFor(fsImpl, root, jobId) {
  const base = `${slash(path.resolve(root))}/${OWNERS_DIR}`;
  let accounts;
  try {
    accounts = fsImpl.readdirSync(base);
  } catch (err) {
    if (isAbsent(err)) return []; // nobody has ever claimed anything
    throw err;
  }
  const found = [];
  for (const accountId of accounts) {
    const file = `${base}/${accountId}/${jobId}.json`;
    try {
      if (fsImpl.statSync(file).isFile()) found.push(file);
    } catch (err) {
      // Not this account's job -- or an account entry that is a stray file,
      // which the sweep's own test seeds. Any other answer is a real failure.
      if (isAbsent(err) || err?.code === 'ENOTDIR') continue;
      throw err;
    }
  }
  return found;
}

/**
 * Everything in a job that can hold a face, removed. The record kept.
 *
 * THIS IS THE "SOONER" HALF OF THE CONSENT SENTENCE. The scheduled sweep above
 * is the "after 7/30 days" half; this is what runs when a person exercises the
 * right the same sentence grants them -- "and that I can ask for either to be
 * deleted sooner". `docs/security-review-2026-08-21.md` F2 is that it did not:
 * `DELETE /api/jobs/:id` emptied `input/` and left the generated stills, the
 * contact sheet, the video and the poster on disk permanently, so a user who
 * asked for their face to be deleted kept a face in four other places.
 *
 * WHAT IS KEPT, AND WHY EACH ONE.
 * - `manifest.json` -- ids, timings, cost, the consent record. No image. It is
 *   what makes the deletion auditable, and deleting the audit trail along with
 *   the data is the wrong instinct.
 * - `logs/` -- ffmpeg stderr. Operational, no image.
 * - `intent/` -- provider request/response records for idempotent resume. These
 *   hold prompt text and job ids, not pixels.
 * - `cancel.requested` -- the sentinel. Deleting it would let a worker that has
 *   not yet reached a step boundary carry on rendering the job that was just
 *   purged, and write new stills into the directory we emptied.
 *
 * Idempotent. A second call removes nothing and says so, because a person who
 * clicks delete twice has not made an error worth a 500.
 *
 * @param {object}   paths            from `jobPaths`
 * @param {object}  [opts]
 * @param {boolean} [opts.dryRun=false]  unlike `executePurge`, this defaults to
 *   acting: it is only ever called by a handler that has already established
 *   the caller owns the job and asked for exactly this.
 * @param {object}  [opts.fsImpl=fs]
 * @returns {{filesDeleted: number, photosDeleted: number, removed: string[]}}
 */
export function purgeJobMedia(paths, { dryRun = false, fsImpl = fs } = {}) {
  if (!paths?.dir) throw new PurgeError('purgeJobMedia takes a jobPaths object', { code: 'BAD_PATHS' });

  const removed = [];
  const errors = [];
  let photosDeleted = 0;

  /**
   * A FILE THAT WOULD NOT DELETE IS REPORTED, NEVER SWALLOWED.
   *
   * The first version of this swallowed the failure with `catch { continue }`,
   * so a refused unlink was indistinguishable from a file that was not there --
   * the handler answered 200 and a person was told a face had been deleted that
   * was still on disk. That is the shape of the very finding this module exists
   * to close, recurring inside the fix for it.
   *
   * The trigger is not exotic on Windows: `getVideo` streams `timestamp.mp4` to
   * the browser, and an unlink of a file another handle is reading is refused
   * with EBUSY. Watch your tape, click delete.
   */
  const remove = (file) => {
    if (dryRun) { removed.push(file); return; }
    try {
      fsImpl.rmSync(file, { force: true });
      removed.push(file);
    } catch (err) {
      errors.push({ path: file, message: err.message, code: err.code ?? null });
    }
  };

  for (const dir of [paths.input, paths.stills, paths.segments, paths.review]) {
    // A DIRECTORY THAT WOULD NOT LIST IS REPORTED, NEVER TREATED AS EMPTY --
    // the same rule as `remove` above, one level up. It is reported under the
    // directory's own path, and the loop carries on to the next one: an
    // unreadable `input/` does not excuse the stills, the segments and the
    // tape. `mediaDeleted` upstream is derived from `errors`, so this is what
    // turns a "your photo is gone" into an honest "not yet".
    let files;
    try {
      files = listFiles(fsImpl, dir);
    } catch (err) {
      errors.push({ path: dir, message: err.message, code: err.code ?? null });
      continue;
    }
    for (const file of files) {
      const before = removed.length;
      remove(file);
      if (dir === paths.input && removed.length > before) photosDeleted += 1;
    }
  }
  for (const file of [paths.source, paths.video, paths.poster]) {
    if (!fsImpl.existsSync(file)) continue;
    remove(file);
  }

  return { filesDeleted: removed.length, photosDeleted, removed, errors };
}
