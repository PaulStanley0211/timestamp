/**
 * The job model. Durable state for one render, and the only thing in this
 * system that survives a kill -9.
 *
 * WHY THE MANIFEST IS THE SOURCE OF TRUTH AND THE QUEUE IS NOT. The queue holds
 * pointers. Delete `out/queue` and every job is still recoverable by reading its
 * manifest; delete a manifest and the job is gone no matter what the queue says.
 * Any state that exists only in the queue -- or worse, only in the worker's
 * memory -- is state that a crash deletes, and this pipeline is *expected* to
 * crash: it makes paid remote calls that take minutes, on a machine someone will
 * close the lid of.
 *
 * WHY THE `resolved` BLOCK IS FROZEN. `resolved` is written exactly once, by
 * `compose`, and after that no code in this repo may re-derive it -- not on
 * resume, not on retry, not ever. Presets and config are text files that WILL be
 * edited; that is the point of keeping them in JSON. The moment a resumed job
 * re-reads `presets/` it is rendering something the first half of the job never
 * agreed to, and the video that comes out is reproducible only by accident. So
 * `freezeResolved` throws on a second write and `loadJob` deep-freezes what it
 * reads, which turns "please don't re-derive this" from a comment into a
 * TypeError at the assignment.
 *
 * WHY THE INTENT RECORD IS WRITTEN BEFORE THE REQUEST. The failure this file
 * exists to prevent is: submit a paid generation, crash before the response
 * lands, resume, submit it again, pay twice, and have no way to know it
 * happened. Writing `intent/<step>.json` *before* the HTTP call costs four
 * lines and converts that into a named, timestamped fact on disk. Note what
 * `recordIntent` deliberately does NOT do: it does not resubmit and it does not
 * skip. Both would be a guess. It reports `existing: true` -- "a request went
 * out and no result came back" -- and the pipeline decides, because only the
 * pipeline knows whether the provider can be asked what happened.
 *
 * WHY EVERY WRITE IS tmp + rename. `fs.writeFileSync` over a live manifest has a
 * window in which the file on disk is truncated, and a process killed inside
 * that window leaves a job that cannot be loaded, cannot be resumed, and has
 * already been paid for. Write a temp file, fsync it, rename it over the target:
 * rename is atomic on NTFS and on POSIX, so a reader sees either the whole old
 * manifest or the whole new one and never half of either. On Windows the rename
 * can still fail with EPERM/EBUSY if a reader has the target open, which is a
 * transient condition and is retried here rather than pushed onto callers.
 *
 * WHY PATHS IN THE MANIFEST ARE RELATIVE. A manifest full of `C:\Users\pauls\...`
 * is readable on exactly one machine. Jobs get copied off a worker to be looked
 * at, moved between drives when one fills up, and read by a web process with a
 * different working directory. Every path stored here is relative to the job
 * directory with forward slashes, and `saveJob` refuses to write anything else --
 * a portability bug that surfaces as a red test today is worth a hundred that
 * surface as a broken result page in three months.
 *
 * WHY THE ONLY CLOCK IS INJECTED. `newJobId` reads the wall clock because a job
 * id is an identity, not a render input. Everything else takes `nowImpl`, so a
 * test can prove that a resumed job kept its original timestamps rather than
 * quietly restamping them -- which is the exact bug that makes a ledger useless.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Bumped when the manifest shape changes in a way older readers cannot handle.
 *  `loadJob` refuses an unknown version rather than guessing at a half-understood
 *  manifest, because guessing here means re-running a paid step. */
export const SCHEMA_VERSION = 1;

/** Jobs live under the same root the queue does, so one `--root` moves both. */
export const JOBS_DIR = 'out/jobs';

/** The canonical id shape. The web layer validates `:id` against this before it
 *  touches the filesystem (docs/interfaces.md §9); it is exported so there is
 *  one regex and not two that drift. */
export const JOB_ID_RE = /^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/;

/** What `jobPaths` will actually build a path from. Deliberately wider than
 *  JOB_ID_RE -- other modules' tests use readable ids like `resume-drill` -- but
 *  narrow enough that no separator, no `..` and no drive letter can get through,
 *  which is the property that matters when the id came from a stranger's HTTP
 *  request. */
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * The pipeline, in order. This array IS the state machine's spine: `nextStep`
 * walks it, resume is "skip the ones already done", and a step that is not in
 * here cannot be begun. Steps 5 and 7 spend money; everything else is free,
 * which is why `select` sits between them.
 */
export const STEPS = Object.freeze([
  'intake',    // ingest + hash both photos, face gate
  'moderate',  // free text and photos through safety
  'expand',    // free text -> validated place/outfit; skipped when both are presets
  'compose',   // prompts, seeds, segment plan, and the one write of `resolved`
  'still',     // PAID
  'select',    // contact sheet; may park the job at awaiting-selection
  'animate',   // PAID
  'assemble',  // concat segments -> source.mp4, assert zero audio streams
  'tape',      // the look, one ffmpeg call
  'verify',    // delivery contract, grade, composite, burn-in, LUFS
  'publish',   // timestamp.mp4, poster, review/summary.md
]);

/** Job-level status. `awaiting-selection` is a first-class state rather than a
 *  flag because a job parked in front of a human is not "running" and must not
 *  be counted as in-flight work by the queue. */
export const STATUSES = Object.freeze([
  'queued', 'running', 'awaiting-selection', 'done', 'failed', 'cancelled',
]);

/** Step-level status. `skipped` is not `done`: a skipped step produced nothing
 *  and cost nothing, and the ledger must be able to tell the difference. */
export const STEP_STATUSES = Object.freeze([
  'pending', 'running', 'done', 'failed', 'skipped',
]);

/**
 * The legal step moves, written out rather than implied by whichever `if`
 * happened to run first. Everything not in here is refused with a JobError.
 *
 * `running -> running` is legal and is the crash re-entry: a process killed
 * mid-step leaves the step marked `running`, and resume must be able to begin it
 * again. That is also why `beginStep` increments `attempts` rather than setting
 * it -- attempts is a lifetime count, and the second attempt is precisely when
 * `recordIntent` earns its keep.
 *
 * `done -> running` is refused. A done step has a recorded output and, if it was
 * step 5 or 7, a recorded charge; letting it silently restart is how a resume
 * turns into a second bill. `retryStep` exists to make that an explicit act.
 */
export const STEP_TRANSITIONS = Object.freeze({
  begin:  Object.freeze({ pending: 'running', running: 'running' }),
  finish: Object.freeze({ running: 'done' }),
  fail:   Object.freeze({ running: 'failed' }),
  skip:   Object.freeze({ pending: 'skipped', running: 'skipped' }),
  retry:  Object.freeze({ done: 'pending', failed: 'pending', skipped: 'pending' }),
});

/**
 * The legal job moves. `done` and `cancelled` are terminal, and `failed` may
 * only go back to `queued` -- never straight to `done`. A job that reports
 * success after failing is the single worst bug this module could have, because
 * nothing downstream would ever look at it again.
 *
 * A self-transition (`running -> running`) is always allowed and is a no-op;
 * resume re-entering a step should not have to know what the status already was.
 */
export const JOB_TRANSITIONS = Object.freeze({
  'queued':             Object.freeze(['running', 'failed', 'cancelled']),
  'running':            Object.freeze(['awaiting-selection', 'done', 'failed', 'cancelled']),
  'awaiting-selection': Object.freeze(['running', 'failed', 'cancelled']),
  'done':               Object.freeze([]),
  'failed':             Object.freeze(['queued', 'cancelled']),
  'cancelled':          Object.freeze([]),
});

export class JobError extends Error {
  constructor(message, { code = 'JOB_ERROR', jobId = null, detail = null } = {}) {
    super(message);
    this.name = 'JobError';
    this.code = code;
    this.jobId = jobId;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// small pure helpers
// ---------------------------------------------------------------------------

const slash = (p) => String(p).replace(/\\/g, '/');

const defaultNow = () => new Date();

/** `nowImpl` is normalised rather than specified, because the queue counts
 *  leases in milliseconds and this file writes ISO strings, and a cross-module
 *  disagreement about which one `nowImpl` returns would show up as an
 *  `Invalid Date` inside a manifest six steps later. */
function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new JobError(
    `nowImpl must return a Date, an epoch-ms number or an ISO string, got ${JSON.stringify(value)}`,
    { code: 'BAD_NOW' },
  );
}

function isoNow(job) {
  return toDate((job?.nowImpl ?? defaultNow)()).toISOString();
}

/** Money is summed, so it must not accumulate float dust: 0.1 + 0.2 in a ledger
 *  reads as a divergence that is really an artefact of binary fractions. */
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** Deterministic key material. `JSON.stringify` alone is not: two payloads that
 *  differ only in key order would hash differently and produce two idempotency
 *  keys for one request, which defeats the entire point. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** Blocking sleep with no dependency and no timer. Used only for the handful of
 *  millisecond retries around a Windows rename -- everything else in this file
 *  is straight-line synchronous, which is what makes "the manifest on disk is
 *  the truth" checkable in a test. */
const SLEEP_SLOT = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) {
  Atomics.wait(SLEEP_SLOT, 0, 0, ms);
}

/** A frozen `resolved` block is only frozen if its children are. `Object.freeze`
 *  is shallow, and `job.resolved.look.tape.grainStrength = 22` would otherwise
 *  succeed and silently redefine a past render. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

// ---------------------------------------------------------------------------
// the portability guard
// ---------------------------------------------------------------------------

const ABSOLUTE_PATH_RE = /^(?:[A-Za-z]:[\\/]|[\\/])/;
const isPathKey = (key) => {
  const k = String(key).toLowerCase();
  return k === 'path' || k.endsWith('path') || k.endsWith('paths');
};

/**
 * Refuses an absolute path, or a path with backslashes, anywhere a manifest
 * stores one. Checked at `saveJob` because that is the choke point: nothing
 * reaches disk without passing through it, so there is no "but I set it
 * directly" hole. Backslashes are refused as well as drive letters, because
 * `input\photo.jpg` is portable right up until the day something reads it on a
 * machine that is not Windows.
 */
function assertRelativePaths(value, where, jobId) {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, i) => assertRelativePaths(entry, `${where}[${i}]`, jobId));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const at = `${where}.${key}`;
    if (typeof entry === 'string' && isPathKey(key)) {
      if (ABSOLUTE_PATH_RE.test(entry)) {
        throw new JobError(
          `${at} is an absolute path (${entry}); manifest paths are relative to the job directory`,
          { code: 'PATH_NOT_RELATIVE', jobId, detail: { at, value: entry } },
        );
      }
      if (entry.includes('\\')) {
        throw new JobError(
          `${at} contains a backslash (${entry}); manifest paths use forward slashes`,
          { code: 'PATH_NOT_RELATIVE', jobId, detail: { at, value: entry } },
        );
      }
    } else if (entry && typeof entry === 'object') {
      assertRelativePaths(entry, at, jobId);
    }
  }
}

// ---------------------------------------------------------------------------
// ids and paths
// ---------------------------------------------------------------------------

function randomHex(rand, bytes) {
  if (rand && typeof rand.randomBytes === 'function') {
    return Buffer.from(rand.randomBytes(bytes)).toString('hex');
  }
  if (rand && typeof rand.getRandomValues === 'function') {
    const buf = new Uint8Array(bytes);
    rand.getRandomValues(buf);
    return Buffer.from(buf).toString('hex');
  }
  throw new JobError('rand must expose randomBytes() or getRandomValues()', { code: 'BAD_RAND' });
}

/**
 * `<YYYYMMDD>-<HHMMSS>-<6 hex>`, lowercase, filesystem-safe, sorts
 * chronologically as a plain string.
 *
 * UTC, not local time. Under a DST fall-back the local hour repeats, so two jobs
 * an hour apart can produce ids that sort in the wrong order -- and "sorts
 * chronologically" is the only ordering `listJobs` and the ledger have.
 *
 * The 6 hex bytes are not decoration: two uploads inside the same second are
 * ordinary under any concurrency at all, and a collision here means one job
 * overwrites another's directory.
 */
export function newJobId({ now = defaultNow, rand = crypto } = {}) {
  const d = toDate(now());
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  const stamp =
    `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  const id = `${stamp}-${randomHex(rand, 3).toLowerCase()}`;
  if (!JOB_ID_RE.test(id)) {
    throw new JobError(`generated job id ${id} does not match JOB_ID_RE`, { code: 'BAD_JOB_ID' });
  }
  return id;
}

export function isValidJobId(jobId) {
  return typeof jobId === 'string' && JOB_ID_RE.test(jobId);
}

function assertUsableId(jobId) {
  if (typeof jobId !== 'string' || !SAFE_ID_RE.test(jobId)) {
    throw new JobError(
      `unusable job id ${JSON.stringify(jobId)} -- no separators, no '..', no drive letters`,
      { code: 'BAD_JOB_ID', jobId: typeof jobId === 'string' ? jobId : null },
    );
  }
  return jobId;
}

/**
 * Absolute paths for one job, forward-slashed. These are for *use*; what goes
 * into the manifest is the relative form (`toJobRelative`).
 */
export function jobPaths(root, jobId) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new JobError('root must be a non-empty string', { code: 'BAD_ROOT' });
  }
  assertUsableId(jobId);
  const dir = slash(path.resolve(root, JOBS_DIR, jobId));
  return {
    dir,
    manifest: `${dir}/manifest.json`,
    intent: `${dir}/intent`,
    input: `${dir}/input`,
    stills: `${dir}/stills`,
    segments: `${dir}/segments`,
    review: `${dir}/review`,
    logs: `${dir}/logs`,
    // The segments joined, before the look is applied. `assemble` writes it and
    // `tape` reads it, so it is a shared name between two steps and belongs
    // here rather than being spelled out at both call sites.
    source: `${dir}/source.mp4`,
    video: `${dir}/timestamp.mp4`,
    poster: `${dir}/poster.jpg`,
    // A sentinel, not a state change, and that distinction is the whole point.
    // The manifest has exactly one writer -- whoever holds the queue lease --
    // because `saveJob` writes a single fixed `manifest.json.tmp` and two
    // writers racing on it is a corrupted job. But a cancel arrives from the
    // web process, which does NOT hold the lease and must not call
    // `cancelJob`. So the web layer drops this file and the worker, which is
    // the legitimate writer, notices it between steps and performs the actual
    // transition. Cancelling an unclaimed job is the one case the web layer
    // may transition directly, because there is no other writer to race.
    cancelRequest: `${dir}/cancel.requested`,
  };
}

function pathsOf(job) {
  if (job?.paths) return job.paths;
  if (job?.root) return jobPaths(job.root, job.jobId);
  throw new JobError(
    'job has no root -- it was constructed by hand or spread into a plain object; pass saveJob(job, { root })',
    { code: 'NO_ROOT', jobId: job?.jobId ?? null },
  );
}

/** Manifest form of an absolute path: relative to the job directory, forward
 *  slashes, and refused outright if it points outside the job directory. */
export function toJobRelative(job, p) {
  const { dir } = pathsOf(job);
  const rel = slash(path.relative(dir, path.resolve(p)));
  if (rel === '' || rel.startsWith('../') || path.isAbsolute(rel)) {
    throw new JobError(`${p} is not inside the job directory ${dir}`, {
      code: 'OUTSIDE_JOB_DIR', jobId: job?.jobId ?? null,
    });
  }
  return rel;
}

/** The inverse. Rejects traversal, because a manifest is a file and a file can
 *  be edited by whoever can reach the disk. */
export function fromJobRelative(job, rel) {
  const { dir } = pathsOf(job);
  if (typeof rel !== 'string' || rel.length === 0) {
    throw new JobError(`${JSON.stringify(rel)} is not a relative path`, { code: 'BAD_PATH' });
  }
  const abs = slash(path.resolve(dir, rel));
  if (abs !== dir && !abs.startsWith(`${dir}/`)) {
    throw new JobError(`${rel} escapes the job directory`, {
      code: 'OUTSIDE_JOB_DIR', jobId: job?.jobId ?? null,
    });
  }
  return abs;
}

// ---------------------------------------------------------------------------
// durable I/O
// ---------------------------------------------------------------------------

/** Windows hands back EPERM/EBUSY when another handle has the target open, and
 *  the honest answer to that is "wait a moment", not "lose the manifest". */
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOENT', 'EEXIST']);
const RENAME_ATTEMPTS = 12;

function atomicWriteJson(file, value, jobId) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  // One fixed tmp name per target, as specified. That is safe because exactly
  // one worker holds a job at a time -- the queue's exclusive-create lease is
  // what guarantees it. Two writers on one job would race on this file, and the
  // fix for that is the lease, not a unique suffix here.
  const tmp = `${file}.tmp`;
  const text = `${JSON.stringify(value, null, 2)}\n`;

  // fsync before the rename. Without it the rename can land while the tmp file's
  // bytes are still in the page cache, which on a power cut gives you an atomic
  // rename onto an empty file -- the exact failure the rename was supposed to
  // rule out.
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  let delay = 1;
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt += 1) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (!TRANSIENT.has(err.code) || attempt === RENAME_ATTEMPTS) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* the rename failure is the real error */ }
        throw new JobError(`could not replace ${file}: ${err.code ?? err.message}`, {
          code: 'WRITE_FAILED', jobId, detail: { file, cause: err.code ?? null },
        });
      }
      sleepSync(delay);
      delay = Math.min(delay * 2, 32);
    }
  }
}

/** The read side of the same Windows problem: a read issued in the instant a
 *  rename is replacing the file can fail transiently. Retrying is correct; what
 *  is NOT correct is retrying a parse error, because a parse error means the
 *  bytes are wrong rather than momentarily unavailable. */
function readJsonWithRetry(file, jobId, { missingOk = false } = {}) {
  let delay = 1;
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt += 1) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT' && missingOk) return null;
      if (!TRANSIENT.has(err.code) || attempt === RENAME_ATTEMPTS) {
        if (err.code === 'ENOENT') {
          if (missingOk) return null;
          throw new JobError(`${file} does not exist`, { code: 'NOT_FOUND', jobId, detail: { file } });
        }
        throw new JobError(`could not read ${file}: ${err.code ?? err.message}`, {
          code: 'READ_FAILED', jobId, detail: { file, cause: err.code ?? null },
        });
      }
      sleepSync(delay);
      delay = Math.min(delay * 2, 32);
      continue;
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new JobError(`${file} is not valid JSON: ${err.message}`, {
        code: 'CORRUPT', jobId, detail: { file, bytes: text.length },
      });
    }
  }
  /* c8 ignore next */
  throw new JobError(`could not read ${file}`, { code: 'READ_FAILED', jobId });
}

// ---------------------------------------------------------------------------
// the manifest
// ---------------------------------------------------------------------------

function newStep(name) {
  return {
    name,
    status: 'pending',
    startedAt: null,
    endedAt: null,
    attempts: 0,
    output: {},
    error: null,
    // Not in docs/interfaces.md's schema block, but `skipStep(job, name, reason)`
    // takes a reason and the schema gives it nowhere to live. It is not an
    // `error` -- a skip is a decision, and the UI and ledger key off `error`
    // being null.
    skipReason: null,
    cost: { estimated: 0, actual: null, currency: 'USD' },
  };
}

const PLACE_KINDS = new Set(['preset', 'text', 'photo']);
const OUTFIT_KINDS = new Set(['preset', 'text']);

function normalizeInput(input, jobId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new JobError('input must be an object', { code: 'BAD_INPUT', jobId });
  }
  const place = input.place ?? {};
  const outfit = input.outfit ?? {};
  if (place.kind != null && !PLACE_KINDS.has(place.kind)) {
    throw new JobError(`input.place.kind must be preset|text|photo, got ${JSON.stringify(place.kind)}`,
      { code: 'BAD_INPUT', jobId });
  }
  if (outfit.kind != null && !OUTFIT_KINDS.has(outfit.kind)) {
    throw new JobError(`input.outfit.kind must be preset|text, got ${JSON.stringify(outfit.kind)}`,
      { code: 'BAD_INPUT', jobId });
  }

  const stillCount = input.stillCount ?? 3;
  // 1..8 is the provider contract's `count` range (docs/interfaces.md §2). A
  // manifest asking for 12 stills is a bill that fails at the provider after the
  // first eight have already been generated.
  if (!Number.isInteger(stillCount) || stillCount < 1 || stillCount > 8) {
    throw new JobError(`input.stillCount must be an integer 1..8, got ${JSON.stringify(stillCount)}`,
      { code: 'BAD_INPUT', jobId });
  }

  let consent = null;
  if (input.consent != null) {
    if (input.consent.granted !== true) {
      // Recording a withheld consent as if it were a job is worse than refusing
      // it: the photograph would already be on disk.
      throw new JobError('input.consent.granted must be true when consent is present',
        { code: 'CONSENT_REQUIRED', jobId });
    }
    consent = {
      granted: true,
      at: input.consent.at ?? null,
      // The exact wording shown, not a version number. A consent record that
      // cannot reproduce what the person actually read is not a consent record.
      text: input.consent.text ?? null,
    };
  }

  return {
    photo: {
      path: input.photo?.path ?? null,
      sha256: input.photo?.sha256 ?? null,
      width: input.photo?.width ?? 0,
      height: input.photo?.height ?? 0,
    },
    place: {
      kind: place.kind ?? null,
      value: place.value ?? null,
      photoPath: place.photoPath ?? null,
      photoSha256: place.photoSha256 ?? null,
    },
    outfit: {
      kind: outfit.kind ?? null,
      value: outfit.value ?? null,
    },
    stillCount,
    consent,
  };
}

function attach(job, { root, nowImpl, cfg }) {
  // Non-enumerable, so `JSON.stringify(job)` is exactly the manifest and a test
  // can deepEqual a loaded job against a saved one without stripping fields.
  const hidden = {
    root: slash(path.resolve(root)),
    paths: jobPaths(root, job.jobId),
    nowImpl: nowImpl ?? defaultNow,
    cfg: cfg ?? null,
  };
  for (const [key, value] of Object.entries(hidden)) {
    Object.defineProperty(job, key, { value, enumerable: false, writable: true, configurable: true });
  }
  return job;
}

/**
 * Creates the job directory, writes the first manifest, returns the job.
 *
 * The manifest is written here rather than left for the caller because the queue
 * is about to hold a pointer to it, and a pointer to a job with no manifest is
 * the one state this system cannot recover from.
 *
 * `cfg` is accepted and deliberately NOT stored. Config belongs in the manifest
 * exactly once, inside the frozen `resolved` block that `compose` writes; a
 * second copy written at create time would be the copy that drifts.
 */
export function createJob({ root, jobId, input, provider, cfg, nowImpl = defaultNow }) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new JobError('root must be a non-empty string', { code: 'BAD_ROOT' });
  }
  if (typeof provider !== 'string' || provider.length === 0) {
    throw new JobError('provider must be a non-empty string id', { code: 'BAD_PROVIDER' });
  }
  const id = jobId ?? newJobId({ now: nowImpl });
  assertUsableId(id);

  const paths = jobPaths(root, id);
  if (fs.existsSync(paths.manifest)) {
    // Two jobs sharing a directory means one of them loses its stills, and the
    // one that loses them has already been paid for.
    throw new JobError(`job ${id} already exists at ${paths.dir}`, { code: 'JOB_EXISTS', jobId: id });
  }

  const at = toDate(nowImpl()).toISOString();
  const job = {
    schemaVersion: SCHEMA_VERSION,
    jobId: id,
    createdAt: at,
    updatedAt: at,
    status: 'queued',
    provider,
    input: normalizeInput(input, id),
    // null until compose freezes it. The documented schema shows the block
    // populated; before compose there is nothing honest to put there, and an
    // empty object would be indistinguishable from a frozen-but-empty one.
    resolved: null,
    steps: STEPS.map(newStep),
    selection: { stillIndex: null, chosenBy: null },
    cost: { estimated: 0, actual: null, currency: 'USD' },
    result: { videoPath: null, posterPath: null, durationSeconds: null, frames: null, lufs: null },
    error: null,
  };
  attach(job, { root, nowImpl, cfg });

  for (const dir of [paths.dir, paths.intent, paths.input, paths.stills, paths.segments, paths.review, paths.logs]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  saveJob(job);
  return job;
}

/**
 * Reads a manifest back. The `resolved` block comes back deep-frozen, which is
 * what stops a resumed run from "fixing" it.
 */
export function loadJob({ root, jobId, nowImpl = defaultNow, cfg }) {
  const paths = jobPaths(root, jobId);
  const manifest = readJsonWithRetry(paths.manifest, jobId);
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new JobError(
      `manifest schemaVersion ${manifest.schemaVersion} is not ${SCHEMA_VERSION}; refusing to guess`,
      { code: 'SCHEMA_VERSION', jobId },
    );
  }
  if (manifest.jobId !== jobId) {
    // A copied directory with a stale manifest inside it would otherwise write
    // its results into someone else's job.
    throw new JobError(`manifest in ${paths.dir} says jobId ${manifest.jobId}`, {
      code: 'JOB_ID_MISMATCH', jobId,
    });
  }
  deepFreeze(manifest.resolved);
  return attach(manifest, { root, nowImpl, cfg });
}

/**
 * Atomic save. Called after every single transition -- that is what makes a
 * crash between two steps recoverable rather than merely unlikely.
 */
export function saveJob(job, { root } = {}) {
  if (!job || typeof job !== 'object') {
    throw new JobError('saveJob needs a job', { code: 'BAD_JOB' });
  }
  if (root) attach(job, { root, nowImpl: job.nowImpl, cfg: job.cfg });
  const paths = pathsOf(job);

  assertRelativePaths(job.input, 'input', job.jobId);
  assertRelativePaths(job.resolved, 'resolved', job.jobId);
  assertRelativePaths(job.result, 'result', job.jobId);
  job.steps.forEach((step) => assertRelativePaths(step.output, `steps.${step.name}.output`, job.jobId));

  job.updatedAt = isoNow(job);
  atomicWriteJson(paths.manifest, job, job.jobId);
}

/**
 * Every job under `root`, oldest first -- job ids sort chronologically, so a
 * string sort is the chronological sort.
 *
 * A directory whose manifest cannot be read is skipped rather than thrown on.
 * One unreadable job must not be able to hide the other two hundred from the
 * status page; `loadJob` on that id still reports exactly what is wrong.
 */
export function listJobs({ root }) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new JobError('root must be a non-empty string', { code: 'BAD_ROOT' });
  }
  const dir = slash(path.resolve(root, JOBS_DIR));
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new JobError(`could not list ${dir}: ${err.code ?? err.message}`, { code: 'READ_FAILED' });
  }

  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SAFE_ID_RE.test(entry.name)) continue;
    let manifest;
    try {
      manifest = readJsonWithRetry(`${dir}/${entry.name}/manifest.json`, entry.name, { missingOk: true });
    } catch {
      continue;
    }
    if (!manifest) continue;
    out.push({
      jobId: manifest.jobId ?? entry.name,
      status: manifest.status ?? null,
      createdAt: manifest.createdAt ?? null,
      updatedAt: manifest.updatedAt ?? null,
    });
  }
  return out.sort((a, b) => (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0));
}

// ---------------------------------------------------------------------------
// the frozen block
// ---------------------------------------------------------------------------

/**
 * Writes `resolved` once. A second call throws.
 *
 * This is the function that makes "reproducible" a property. Everything
 * downstream of compose reads `manifest.resolved` and never `presets/` or
 * `config/` again, so the only way an edited preset can redefine a finished
 * render is if something overwrites this block -- and it cannot, because the
 * write is refused and the stored copy is deep-frozen.
 *
 * It stores a JSON round-trip rather than the caller's object, so what is frozen
 * in memory is byte-identical to what will be on disk: a `resolved` holding a
 * Map or an `undefined` would otherwise pass every in-memory assertion and come
 * back from `loadJob` as something else.
 */
export function freezeResolved(job, resolved) {
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
    throw new JobError('resolved must be an object', { code: 'BAD_RESOLVED', jobId: job?.jobId ?? null });
  }
  if (job.resolved != null) {
    throw new JobError(
      `resolved is already frozen for ${job.jobId} -- it is written once, by compose, and never re-derived`,
      { code: 'RESOLVED_ALREADY_FROZEN', jobId: job.jobId },
    );
  }
  const stored = JSON.parse(JSON.stringify(resolved));
  assertRelativePaths(stored, 'resolved', job.jobId);
  job.resolved = deepFreeze(stored);
  return job.resolved;
}

export function isResolved(job) {
  return job?.resolved != null;
}

// ---------------------------------------------------------------------------
// the state machine
// ---------------------------------------------------------------------------

function stepOf(job, name) {
  const step = job?.steps?.find((s) => s.name === name);
  if (!step) {
    // A typo'd step name that returned undefined would be a step silently never
    // run, and a job that reports success having skipped it.
    throw new JobError(`unknown step ${JSON.stringify(name)}`, {
      code: 'UNKNOWN_STEP', jobId: job?.jobId ?? null, detail: { known: job?.steps?.map((s) => s.name) },
    });
  }
  return step;
}

function moveStep(job, step, move) {
  const next = STEP_TRANSITIONS[move][step.status];
  if (!next) {
    throw new JobError(
      `illegal step transition: ${step.name} is ${step.status}, cannot ${move}` +
      (move === 'begin' && step.status === 'done'
        ? ' -- a done step has a recorded output and possibly a recorded charge; call retryStep first'
        : ''),
      { code: 'ILLEGAL_STEP_TRANSITION', jobId: job.jobId, detail: { step: step.name, from: step.status, move } },
    );
  }
  step.status = next;
  return next;
}

/** Job status moves go through here so that no code path can set a status the
 *  table forbids -- most importantly `failed -> done`. */
export function setJobStatus(job, status) {
  if (!STATUSES.includes(status)) {
    throw new JobError(`unknown job status ${JSON.stringify(status)}`, {
      code: 'UNKNOWN_STATUS', jobId: job?.jobId ?? null,
    });
  }
  if (job.status === status) return status;
  const allowed = JOB_TRANSITIONS[job.status] ?? [];
  if (!allowed.includes(status)) {
    throw new JobError(
      `illegal job transition ${job.status} -> ${status}` +
      (job.status === 'failed' && status === 'done'
        ? ' -- a failed job is never done; retry it back to queued or leave it failed'
        : ''),
      { code: 'ILLEGAL_JOB_TRANSITION', jobId: job.jobId, detail: { from: job.status, to: status } },
    );
  }
  job.status = status;
  return status;
}

/**
 * Marks a step running. Legal from `pending` and from `running` -- the second is
 * the crash re-entry, and it increments `attempts` rather than resetting it,
 * because attempt 2 of a paid step is exactly when the intent record has to be
 * consulted.
 */
export function beginStep(job, name) {
  const step = stepOf(job, name);
  if (job.status === 'queued' || job.status === 'awaiting-selection') setJobStatus(job, 'running');
  if (job.status !== 'running') {
    throw new JobError(`cannot begin ${name} while the job is ${job.status}`, {
      code: 'ILLEGAL_JOB_TRANSITION', jobId: job.jobId, detail: { from: job.status, step: name },
    });
  }
  // Captured before the transition, because the answer depends on where the
  // step is coming FROM and `moveStep` is about to overwrite that.
  const wasRunning = step.status === 'running';

  moveStep(job, step, 'begin');
  step.attempts += 1;
  step.error = null;
  step.endedAt = null;

  // Two different events reach this line and they want opposite things.
  //
  // A CRASH RE-ENTRY (`running` -> `running`) keeps its original `startedAt`.
  // The step genuinely has been running since then -- the process died without
  // getting to write an end -- so overwriting it would erase real elapsed time.
  //
  // A RETRY (`pending` -> `running`, which is where `retryStep` puts a failed
  // step) is a fresh attempt and must be stamped fresh. Keeping the old value
  // measures from the START OF THE FAILED ATTEMPT, so the step's duration
  // silently swallows however long the job sat in `failed/` waiting for someone
  // to look at it. Measured here: an `intake` that ran in 366ms reported
  // `1m09s`, because the job had been parked for about a minute.
  //
  // That is not cosmetic. These per-step timings are the input to the open
  // question of whether this product needs a queue and an email rather than a
  // spinner, they are written into `review/summary.md`, and a number inflated
  // by retry latency argues for infrastructure the render does not need.
  // Nothing is lost by re-stamping: `job.createdAt` is where "how long has this
  // job really been alive" is recorded, and `attempts` says it took more than
  // one go.
  if (step.startedAt === null || !wasRunning) step.startedAt = isoNow(job);
  return step;
}

/**
 * Marks a step done and rolls its cost into the job total.
 *
 * The job total is recomputed from the steps every time rather than accumulated.
 * Accumulating means a resumed job that re-finishes a step adds its price twice,
 * and a cost that drifts upward on every resume is a ledger that cannot be
 * believed.
 */
export function finishStep(job, name, { output = {}, cost } = {}) {
  const step = stepOf(job, name);
  // Everything that can throw runs BEFORE the transition. A refused finish that
  // had already flipped the step to `done` would leave a step marked complete
  // with a price nobody accepted -- a half-moved state machine is worse than
  // either of the states it sits between.
  assertRelativePaths(output, `steps.${name}.output`, job.jobId);
  const priced = cost ? priceStep(job, step, cost) : null;
  moveStep(job, step, 'finish');
  step.output = output;
  step.error = null;
  step.endedAt = isoNow(job);
  if (priced) step.cost = priced;
  recomputeCost(job);
  return step;
}

/** Pure: validates and returns the new cost block, mutating nothing. */
function priceStep(job, step, cost) {
  const currency = cost.currency ?? step.cost.currency ?? 'USD';
  if (currency !== job.cost.currency) {
    // Summing two currencies produces a number that means nothing and looks
    // like money.
    throw new JobError(`step ${step.name} is priced in ${currency}, job is in ${job.cost.currency}`, {
      code: 'CURRENCY_MISMATCH', jobId: job.jobId,
    });
  }
  const estimated = cost.estimated ?? step.cost.estimated ?? 0;
  const actual = cost.actual === undefined ? step.cost.actual : cost.actual;
  for (const [key, value] of Object.entries({ estimated, actual })) {
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      throw new JobError(`cost.${key} must be a non-negative number or null, got ${JSON.stringify(value)}`, {
        code: 'BAD_COST', jobId: job.jobId,
      });
    }
  }
  return { estimated: round6(estimated), actual: actual === null ? null : round6(actual), currency };
}

function recomputeCost(job) {
  let estimated = 0;
  let actual = null;
  for (const step of job.steps) {
    estimated += step.cost?.estimated ?? 0;
    const a = step.cost?.actual;
    if (typeof a === 'number' && Number.isFinite(a)) actual = (actual ?? 0) + a;
  }
  job.cost.estimated = round6(estimated);
  job.cost.actual = actual === null ? null : round6(actual);
  return job.cost;
}

/** Records the failure on the step AND on the job. The two always move together,
 *  so there is no state in which a job looks runnable while the step it died on
 *  is failed. */
export function failStep(job, name, error) {
  const step = stepOf(job, name);
  moveStep(job, step, 'fail');
  const at = isoNow(job);
  const record = {
    code: error?.code ?? 'ERROR',
    message: error?.message ?? String(error ?? 'unknown error'),
    retriable: error?.retriable ?? null,
    step: name,
    at,
  };
  step.error = record;
  step.endedAt = at;
  job.error = record;
  setJobStatus(job, 'failed');
  return step;
}

/** A skip is a decision with a reason, not an absence. `expand` is skipped when
 *  both inputs are presets, and the manifest has to be able to say so. */
export function skipStep(job, name, reason) {
  const step = stepOf(job, name);
  moveStep(job, step, 'skip');
  step.skipReason = reason ?? null;
  step.endedAt = isoNow(job);
  if (step.startedAt === null) step.startedAt = step.endedAt;
  return step;
}

/**
 * The explicit act. Puts a done, failed or skipped step back to `pending` and,
 * if the job had failed, back into the queue.
 *
 * `attempts` is deliberately not reset: it is the lifetime count, and resetting
 * it is how a retry loop becomes infinite. The intent record is deliberately not
 * cleared either -- it is the evidence that a request went out, and clearing it
 * is the one edit that could turn a retry into a silent second charge. The next
 * `recordIntent` rotates it and mints a fresh key, which is what a *deliberate*
 * resubmission should look like.
 */
export function retryStep(job, name) {
  const step = stepOf(job, name);
  if (job.status === 'done' || job.status === 'cancelled') {
    throw new JobError(`cannot retry ${name} on a ${job.status} job`, {
      code: 'ILLEGAL_JOB_TRANSITION', jobId: job.jobId, detail: { from: job.status },
    });
  }
  moveStep(job, step, 'retry');
  step.error = null;
  step.skipReason = null;
  step.endedAt = null;
  if (job.status === 'failed') {
    setJobStatus(job, 'queued');
    job.error = null;
  }
  return step;
}

export function stepStatus(job, name) {
  return stepOf(job, name).status;
}

/** The first step that is not done and not skipped. Resume is this function and
 *  nothing else. */
export function nextStep(job) {
  for (const step of job.steps) {
    if (step.status !== 'done' && step.status !== 'skipped') return step.name;
  }
  return null;
}

/**
 * Can this job be picked up and continued as it stands?
 *
 * A failed job is NOT resumable. It is recoverable -- via `retryStep`, which is
 * a decision someone makes -- but a worker that treats "failed" as "carry on"
 * will re-run the step that failed, forever, on a schedule.
 */
export function isResumable(job) {
  if (nextStep(job) === null) return false;
  return job.status === 'queued' || job.status === 'running' || job.status === 'awaiting-selection';
}

/** The contact sheet's answer. `chosenBy` distinguishes `firstScorer` picking 0
 *  from a human picking 2, which is the only way to tell later whether anyone
 *  actually looked. */
export function setSelection(job, { stillIndex, chosenBy = 'auto' }) {
  if (!Number.isInteger(stillIndex) || stillIndex < 0) {
    throw new JobError(`stillIndex must be a non-negative integer, got ${JSON.stringify(stillIndex)}`, {
      code: 'BAD_SELECTION', jobId: job.jobId,
    });
  }
  job.selection = { stillIndex, chosenBy };
  return job.selection;
}

/** The last transition. Refused on a failed job by the table above, which is the
 *  point. */
export function completeJob(job, result = {}) {
  assertRelativePaths(result, 'result', job.jobId);
  job.result = { ...job.result, ...result };
  setJobStatus(job, 'done');
  job.error = null;
  return job;
}

export function cancelJob(job, reason = null) {
  setJobStatus(job, 'cancelled');
  if (reason) job.error = { code: 'CANCELLED', message: reason, retriable: false, step: null, at: isoNow(job) };
  return job;
}

// ---------------------------------------------------------------------------
// idempotency
// ---------------------------------------------------------------------------

function intentPath(job, step, attempt = null) {
  const { intent } = pathsOf(job);
  return attempt === null ? `${intent}/${step}.json` : `${intent}/${step}.${attempt}.json`;
}

function intentKey(job, step, attempt, payload) {
  const digest = crypto.createHash('sha256')
    .update([job.jobId, step, String(attempt), stableStringify(payload)].join('\u0000'))
    .digest('hex');
  // Legible on a provider dashboard, and short enough for any API's key field.
  return `${job.jobId}-${step}-${attempt}-${digest.slice(0, 12)}`;
}

/**
 * Writes the intent record BEFORE the provider request.
 *
 * Returns `{ key, existing }`. `existing: true` means: a record is on disk, no
 * result was ever written against it, and therefore a request may have gone out
 * and we may already have been charged for it. The file is left exactly as it
 * was, because its `recordedAt` is the evidence.
 *
 * What this function must never do is decide. Auto-resubmitting risks paying
 * twice; auto-skipping risks a job that reports a still it never received. Both
 * are guesses, and only the pipeline knows whether the provider can be asked
 * what actually happened.
 */
export function recordIntent(job, step, payload) {
  stepOf(job, step);
  const file = intentPath(job, step);
  const existing = readJsonWithRetry(file, job.jobId, { missingOk: true });

  if (existing && existing.result === null) {
    return { key: existing.key, existing: true };
  }

  // A completed record is rotated rather than overwritten: it is the receipt for
  // a call that was actually paid for, and the ledger reads it.
  let attempt = 1;
  if (existing) {
    attempt = (existing.attempt ?? 1) + 1;
    atomicWriteJson(intentPath(job, step, existing.attempt ?? 1), existing, job.jobId);
  }

  const key = intentKey(job, step, attempt, payload ?? null);
  atomicWriteJson(file, {
    schemaVersion: SCHEMA_VERSION,
    jobId: job.jobId,
    step,
    key,
    attempt,
    recordedAt: isoNow(job),
    payload: payload ?? null,
    result: null,
    completedAt: null,
  }, job.jobId);

  return { key, existing: false };
}

export function readIntent(job, step) {
  stepOf(job, step);
  return readJsonWithRetry(intentPath(job, step), job.jobId, { missingOk: true });
}

/** Closes the loop: this key produced this result. Until this is called, the
 *  record reads as "in flight" and every resume will say so. */
export function completeIntent(job, step, result) {
  stepOf(job, step);
  const file = intentPath(job, step);
  const record = readJsonWithRetry(file, job.jobId, { missingOk: true });
  if (!record) {
    throw new JobError(
      `no intent recorded for ${step} -- completeIntent means "this request finished", and there is no request`,
      { code: 'NO_INTENT', jobId: job.jobId, detail: { step } },
    );
  }
  record.result = result ?? null;
  record.completedAt = isoNow(job);
  atomicWriteJson(file, record, job.jobId);
  return record;
}
