/**
 * The queue. The seam between the web app process and the render worker process.
 *
 * WHY THIS EXISTS AT ALL. Nothing in this product is request/response. A 15s
 * render is ~30s of ffmpeg *after* generation calls that take minutes, and
 * ffmpeg needs a real machine while the app wants to be a web server. So the
 * app writes a manifest, enqueues a pointer to it and returns 201; a separate
 * long-lived process picks the pointer up. Everything below exists to make that
 * handover survive a power cut.
 *
 * WHY A FILE-BACKED QUEUE. Redis or SQLite would each be correct and each would
 * be a service to install, run, back up and explain before anyone can render a
 * video on this machine. The whole repo has zero npm dependencies on purpose; a
 * queue that is four directories of small JSON files can be inspected with
 * `dir`, repaired with a text editor and reasoned about by anyone who has ever
 * moved a file. `node scripts/queue/queue-cli.mjs stats` exists so nobody has
 * to.
 *
 * WHY AN EXCLUSIVE CREATE IS THE ONLY WAY ANYTHING HERE PICKS A WINNER.
 * Measured on this machine, 16 threads released through one barrier onto one
 * file: exclusive create produced exactly one winner in 120 of 120 rounds;
 * `unlinkSync` produced the wrong number in 120 of 120, usually with ALL
 * SIXTEEN reporting success; `renameSync` in 60 of 60, with all 960 calls
 * returning success. libuv implements the latter two as open-then-act, and
 * setting a delete disposition -- or renaming through a handle you already
 * hold -- is not an error just because somebody else did it first. So every
 * "who won?" decision in this file is an exclusive create and nothing else,
 * and `EEXIST` is not an error path: it is the normal outcome for every
 * caller but one, and it returns `null` rather than throwing.
 *
 * WHY THE CREATE GOES THROUGH A HARD LINK. `openSync(path, 'wx')` creates the
 * NAME first and the CONTENT after, so there is a window where the file
 * exists and is empty. Under load that window is wide enough to be scheduled
 * through, and a reader that treats an unreadable lock as a dead one will
 * then reap a lock born microseconds ago -- which cost about 3.5% of jobs in
 * a stampede. Writing the content to a temporary file and linking it into
 * place makes the name and the contents appear in the same instant;
 * `linkSync` measured exactly as exclusive as `wx` (0 of 120 rounds wrong)
 * with not one observation of a half-written destination.
 *
 * The platform is not incidental to any of this: it runs on Windows/NTFS,
 * where `fs.rename` replaces an existing destination (MoveFileExW with
 * MOVEFILE_REPLACE_EXISTING), so two workers racing to "move the job into my
 * inbox" would both succeed, both believe they had won, and both start paying
 * a provider for the same render.
 *
 * test/queue-race.test.js runs those races for real against 24 concurrent
 * threads rather than arguing that they are safe, and every guard in this
 * file was put there by a measurement and kept by breaking it again to check
 * the tests still notice.
 *
 * WHY THE ENTRIES ARE THIS SMALL. `out/jobs/<jobId>/manifest.json` is the
 * single source of truth. The queue holds job id, enqueue time, priority and
 * attempt count and nothing else, because the moment it also holds status or
 * step or cost there are two answers to "what happened to this job" and they
 * will disagree after the first crash. Delete `out/queue/` entirely and no job
 * is lost -- every one of them is still sitting in `out/jobs/` with its state
 * intact, and re-enqueueing them is a loop over a directory. This module never
 * reads or writes a manifest; that is another module's job and coupling to it
 * would make the queue depend on a schema it has no reason to know.
 *
 * WHY EVERY TRANSITION WRITES THE NEW STATE BEFORE DROPPING THE LOCK. A crash
 * between the two costs a duplicate; the opposite order costs the job. A
 * duplicate pending entry is swept at claim time and a re-run resumes from the
 * manifest, skipping the steps already marked done -- so at-least-once is cheap
 * here and at-most-once is not recoverable at all. That asymmetry is the reason
 * for the ordering inside complete(), fail(), release() and reapExpired().
 *
 * WHY THE SEQUENCE NUMBER IS IN THE FILENAME. FIFO within a priority level has
 * to be a property of the directory listing. Sorting by mtime would work on a
 * filesystem with fine timestamps; NTFS does not have one, and two jobs
 * enqueued in the same tick would tie and then reorder themselves between
 * listings. A zero-padded monotonic counter makes the lexical order the queue
 * order. The counter is derived from the directory as well as from a hint file
 * and is bumped past anything already present, so deleting `seq.txt` costs
 * nothing and deleting the whole queue costs nothing.
 *
 * WHY LEASES. A worker killed mid-render holds no lock the OS will release for
 * it -- the lock is a file, and the file outlives the process. So a claim
 * carries a deadline and `reapExpired()` returns anything past it to pending.
 * The zombie case is the one that matters: a worker that stalls past its lease,
 * gets reaped, then wakes up and reports success on a job somebody else is now
 * rendering. Every mutating call therefore checks that the lock still exists
 * AND still holds the caller's token, and a stale token gets a LEASE_LOST error
 * rather than a silent write over someone else's result.
 *
 * WHY nowImpl. Lease expiry is the one behaviour here that is a function of
 * time, so time is injected and the tests move the clock forward by an
 * assignment instead of by sleeping. A queue test that waits fifteen real
 * minutes does not get run. `Number(nowImpl())` is used deliberately: it accepts
 * both `() => Date.now()` and `() => new Date()`, since the rest of the repo
 * injects the latter shape.
 *
 * WHY EPERM/EBUSY ARE RETRIED. On Windows an antivirus scanner, a search
 * indexer or an open Explorer window can hold a handle on a file for a few
 * milliseconds, and unlink/rename then fails with EPERM or EBUSY rather than
 * with anything that reads like "try again". Untreated, that surfaces as a
 * render failing for no reason on one machine and never on another.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { EOL, hostname } from 'node:os';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path
  .resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  .replace(/\\/g, '/');

/** 15 minutes, and not by coincidence: `config/render.json` sets
 *  `provider.pollTimeoutMs` to the same number, so the default lease is exactly
 *  as long as the longest single legitimate blocking call a worker can be
 *  inside. A shorter default would reap workers that are doing their job. Long
 *  steps are still expected to `heartbeat()`; the lease is the backstop, not
 *  the schedule. */
export const DEFAULT_LEASE_MS = 900_000;

/** Matches `provider.maxAttempts` in config/render.json. Callers that have the
 *  config loaded should pass `cfg.provider.maxAttempts` rather than trust this
 *  copy -- it is a default so the CLI can run without a config, not a second
 *  place to configure retries. */
export const DEFAULT_MAX_ATTEMPTS = 4;

export const STATES = Object.freeze(['pending', 'claimed', 'done', 'failed']);

/** 12 digits, so the lexical order of the directory listing is the numeric
 *  order of the counter, with room for a trillion jobs before that stops being
 *  true. */
const SEQ_WIDTH = 12;

/** Only the message is kept, and only the first 500 characters of it. The full
 *  error, with its stack and its step, belongs in the manifest. */
const MAX_ERROR_CHARS = 500;

/** How many times claim() will re-read the pending directory when it can see
 *  the directory changing underneath it. Bounded, because the honest answer to
 *  "the queue is a blur of activity" is to go around the poll loop again rather
 *  than to spin here holding nothing. */
const CLAIM_PASSES = 4;

/**
 * A job id becomes a filename, so it is validated before it touches the
 * filesystem. This is the same defence the web layer applies to `:id` and it is
 * repeated here deliberately: this module builds paths out of that string, and
 * a module that builds paths from user-adjacent input owns the check regardless
 * of who else also does it. The pattern is looser than `job.mjs`'s id format on
 * purpose -- it rejects traversal, separators, drive letters and Windows device
 * names without hard-coding another module's naming scheme.
 */
const JOB_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const WINDOWS_DEVICE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export class QueueError extends Error {
  constructor(message, { code = 'QUEUE_ERROR', jobId = null } = {}) {
    super(message);
    this.name = 'QueueError';
    this.code = code;
    this.jobId = jobId;
  }
}

export function assertJobId(jobId) {
  if (typeof jobId !== 'string' || !JOB_ID_RE.test(jobId) || WINDOWS_DEVICE_RE.test(jobId)) {
    throw new QueueError(
      `not a usable job id: ${JSON.stringify(jobId)} -- a job id becomes a filename, so it must be lowercase alphanumerics and hyphens`,
      { code: 'BAD_JOB_ID', jobId: typeof jobId === 'string' ? jobId : null },
    );
  }
  return jobId;
}

/**
 * `root` is the repo root (or a test's temp directory); the queue lives under
 * `<root>/out/queue`, mirroring `out/jobs/<jobId>/`. `queueDir` overrides that
 * outright, which is what the tests and `--queue-dir` use.
 */
export function queuePaths(root = REPO_ROOT, { queueDir } = {}) {
  const dir = String(queueDir ?? `${String(root).replace(/\\/g, '/').replace(/\/+$/, '')}/out/queue`)
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  return {
    dir,
    pending: `${dir}/pending`,
    claimed: `${dir}/claimed`,
    done: `${dir}/done`,
    failed: `${dir}/failed`,
    seqHint: `${dir}/seq.txt`,
  };
}

// --- filesystem helpers -----------------------------------------------------

/** EPERM/EBUSY/EACCES on Windows usually mean "a scanner has this open for
 *  another millisecond", not "you may not do this". Parked with Atomics.wait
 *  rather than a timer so this stays synchronous; 15ms worst case, and it never
 *  runs on the happy path. */
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** A filesystem that cannot hard-link says so in one of these ways. */
const NO_HARDLINK = new Set(['ENOSYS', 'EXDEV', 'EMLINK', 'ENOTSUP', 'EOPNOTSUPP', 'EINVAL']);
const PARK = new Int32Array(new SharedArrayBuffer(4));

/** Total time retryTransient will spend parked before giving up: 1+2+4+...+256.
 *  Measured, not guessed. Under 24 threads released through one barrier onto
 *  one directory, the deepest retry this module actually needed was recorded
 *  and the budget set an order of magnitude above it -- see the note on
 *  Windows' delete-pending state below. */
const TRANSIENT_BUDGET_MS = 511;

/**
 * Windows has two ways of saying "not right now" that look like refusals.
 *
 * An antivirus scanner, a search indexer or an open Explorer window can hold a
 * handle for a few milliseconds, and unlink/rename/open then fails with EPERM
 * or EBUSY rather than with anything that reads like "try again". Untreated,
 * that surfaces as a render failing for no reason on one machine and never on
 * another.
 *
 * The second is structural and much more common under load: DeleteFile only
 * MARKS a file for deletion, and the name survives until the last handle
 * closes. In that window every open of that name -- including a read, and
 * including an exclusive create -- answers EPERM. So a queue busy enough to be
 * deleting entries is a queue that hands out EPERM for names that are, for all
 * practical purposes, already gone.
 *
 * Parked with Atomics.wait rather than a timer, so this stays synchronous and
 * no test has to sleep to exercise it.
 */
function retryTransient(fn) {
  let waitMs = 1;
  let spent = 0;
  for (;;) {
    try {
      return fn();
    } catch (err) {
      if (!TRANSIENT.has(err?.code) || spent >= TRANSIENT_BUDGET_MS) throw err;
      Atomics.wait(PARK, 0, 0, waitMs);
      spent += waitMs;
      waitMs *= 2;
    }
  }
}

function readText(file) {
  try {
    return retryTransient(() => fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    // Still EPERM after the whole budget: this is a name in delete-pending
    // state, which answers EPERM to every open right up until it stops
    // existing. Not readable and not going to exist is what "absent" means
    // here, and callers already handle absent.
    if (TRANSIENT.has(err.code)) return null;
    throw err;
  }
}

function listDir(dir) {
  try {
    return retryTransient(() => fs.readdirSync(dir));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return [];
    // Deliberately NOT swallowed the way readText swallows it. A single file
    // caught mid-delete is routine; a queue directory that cannot be listed at
    // all is a permissions problem, and turning that into an empty list would
    // make a broken install look like an idle queue for ever.
    throw err;
  }
}

/** @returns {boolean} true if this call is the one that removed the file. */
function unlinkIfPresent(file) {
  try {
    retryTransient(() => fs.unlinkSync(file));
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

const serialise = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

/**
 * Create a file exclusively, with its contents already in it.
 *
 * WHY NOT JUST `openSync(file, 'wx')`. That is exclusive, but it creates the
 * NAME first and the CONTENT afterwards, so there is a window in which the file
 * exists and is zero bytes. Under load that window is wide enough to be
 * scheduled through: a reader sees an empty lock, cannot parse it, and -- since
 * reapExpired treats a lock it cannot read as a dead one -- reaps a lock that
 * was born microseconds ago. The worker that had just won that job then has its
 * claim deleted out from under it, and because the claimer's own duplicate
 * sweep removes the entry the reaper wrote, the job ends up in no state at all.
 * Measured at roughly 3.5% of jobs with 8 threads on a loaded machine.
 *
 * Writing the content into a temporary file and hard-linking it into place
 * closes the window: the name and the full contents appear in the same
 * instant. Measured with the same 16-thread barrier used for the other
 * primitives, `linkSync` gave exactly one winner in 120 of 120 rounds and not
 * one observation of a partially written destination.
 *
 * The `wx` fallback is for a filesystem with no hard links -- a network share,
 * or FAT. It is exclusive too, so correctness of the winner-selection holds;
 * only the atomicity of the contents is lost, which is why readLock separately
 * treats a zero-byte lock as newborn rather than as dead.
 */
function writeJsonExclusive(file, obj) {
  const data = serialise(obj);
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
  } catch (err) {
    unlinkIfPresent(tmp);
    throw err;
  }
  try {
    retryTransient(() => fs.linkSync(tmp, file));
    return;
  } catch (err) {
    if (err.code === 'EEXIST') throw err; // somebody else got there first
    if (!NO_HARDLINK.has(err.code)) throw err;
  } finally {
    unlinkIfPresent(tmp);
  }
  // No hard links here. Exclusive, but the contents arrive a moment after the
  // name does.
  const fd = retryTransient(() => fs.openSync(file, 'wx'));
  try {
    fs.writeFileSync(fd, data);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The exclusive create, reported as the three outcomes it really has. This is
 * the ONLY winner-selection primitive in this module, because on Windows it is
 * the only one that is exclusive -- see the WINNER SELECTION comment in
 * reapExpired() for the measurements that establish that.
 *
 * 'created' means this call, and only this call, brought the file into being.
 * 'exists' means somebody else owns it. 'blocked' means Windows would not let
 * us try -- a name in delete-pending state answers EPERM to an exclusive
 * create rather than EEXIST -- and the caller should look again shortly rather
 * than conclude anything.
 *
 * The important property: a create that did not happen is never reported as
 * 'created'. This can lose a race it might have won; it cannot invent a winner.
 *
 * @returns {'created'|'exists'|'blocked'}
 */
function tryExclusiveCreate(file, obj) {
  try {
    writeJsonExclusive(file, obj);
    return 'created';
  } catch (err) {
    if (err.code === 'EEXIST') return 'exists';
    if (TRANSIENT.has(err.code)) return 'blocked';
    throw err;
  }
}

/** tmp + rename, so a reader never sees half a heartbeat. A torn lock would be
 *  indistinguishable from a corrupt one, and reapExpired treats corrupt as
 *  dead. */
function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, serialise(obj));
  try {
    retryTransient(() => fs.renameSync(tmp, file));
  } catch (err) {
    unlinkIfPresent(tmp);
    throw err;
  }
}

/** null: absent. undefined: present but unreadable. Those are different facts
 *  and reapExpired treats them differently, so they do not get collapsed. */
function parseJson(text) {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// --- entry naming -----------------------------------------------------------

const pendingName = (seq, jobId) => `${String(seq).padStart(SEQ_WIDTH, '0')}-${jobId}.json`;

/** A file we did not write is not a job. Returning null for anything that does
 *  not parse means a stray editor swapfile or a half-copied backup cannot stop
 *  the worker from claiming everything else. */
function parsePendingName(name) {
  if (!name.endsWith('.json')) return null;
  const m = /^(\d{12})-(.+)$/.exec(name.slice(0, -'.json'.length));
  if (!m) return null;
  const jobId = m[2];
  if (!JOB_ID_RE.test(jobId) || WINDOWS_DEVICE_RE.test(jobId)) return null;
  return { seq: Number(m[1]), jobId };
}

/**
 * Claim order: highest priority first, then lowest sequence.
 *
 * The jobId tiebreak only ever fires when two enqueues raced hard enough to
 * allocate the same sequence number -- and two entries created simultaneously
 * have no true arrival order to preserve, so a deterministic tiebreak is more
 * useful than an arbitrary one. Every non-simultaneous pair is still strict
 * FIFO within its priority.
 */
function byClaimOrder(a, b) {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0;
}

/**
 * @param {object}   [opts]
 * @param {string}   [opts.root]         repo root; the queue lives at `<root>/out/queue`
 * @param {string}   [opts.queueDir]     overrides the derived directory outright
 * @param {Function} [opts.nowImpl]      () => epoch ms (a Date is accepted too)
 * @param {number}   [opts.leaseMs]      how long a claim is good for
 * @param {number}   [opts.maxAttempts]  attempts before a retriable failure is terminal
 */
export function createQueue({
  root = REPO_ROOT,
  queueDir,
  nowImpl = () => Date.now(),
  leaseMs = DEFAULT_LEASE_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
} = {}) {
  const P = queuePaths(root, { queueDir });

  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new QueueError(`leaseMs must be a positive number, got ${leaseMs}`, { code: 'BAD_CONFIG' });
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new QueueError(`maxAttempts must be a positive integer, got ${maxAttempts}`, { code: 'BAD_CONFIG' });
  }

  const now = () => {
    const t = Number(nowImpl());
    if (!Number.isFinite(t)) {
      throw new QueueError(`nowImpl returned ${t}; it must return epoch milliseconds`, { code: 'BAD_CLOCK' });
    }
    return t;
  };
  const iso = (ms) => new Date(ms).toISOString();

  /** Called before every write rather than once at construction, so deleting
   *  `out/queue` while the worker is running heals on the next operation
   *  instead of crashing it. */
  function ensureDirs() {
    for (const d of [P.pending, P.claimed, P.done, P.failed]) fs.mkdirSync(d, { recursive: true });
  }
  ensureDirs();

  const lockPath = (jobId) => `${P.claimed}/${jobId}.lock`;
  const donePath = (jobId) => `${P.done}/${jobId}.json`;
  const failedPath = (jobId) => `${P.failed}/${jobId}.json`;

  /**
   * One mark per lease that has been reaped. It lives beside the lock it
   * replaced and is named after that lock, so it can never be confused with a
   * later lease on the same job. Nothing reads `claimed/` except by the
   * `.lock` suffix, so marks are invisible to stats(), peek() and reapExpired.
   *
   * A generation is a 32-character hex token, or the word `newborn` or
   * `corrupt` -- all safe in a filename, none able to collide with another.
   */
  const reapMarkPath = (jobId, generation) => `${P.claimed}/${jobId}.${generation}.reaped`;

  /** Marks are swept when the job's life in the queue ends: it finished, it
   *  failed for good, or somebody enqueued it afresh. Until then they are
   *  bounded by maxAttempts, which is how many leases a job can burn. */
  function sweepReapMarks(jobId) {
    const prefix = `${jobId}.`;
    for (const name of listDir(P.claimed)) {
      if (name.startsWith(prefix) && name.endsWith('.reaped')) unlinkIfPresent(`${P.claimed}/${name}`);
    }
  }

  /**
   * @returns {{entries: object[], raced: number}} `raced` counts entries whose
   * filename was a job but whose body could not be read -- vanished between the
   * listing and the read, or caught mid-write. That is not the same as "there
   * is nothing to claim", and claim() uses the distinction: see below.
   */
  function listPending() {
    const out = [];
    let raced = 0;
    for (const name of listDir(P.pending)) {
      const parsed = parsePendingName(name);
      if (!parsed) continue;
      const body = parseJson(readText(`${P.pending}/${name}`));
      if (!body) {
        // undefined = present but unreadable (mid-write); null = already gone.
        // Either way the board is moving under us right now.
        raced += 1;
        continue;
      }
      out.push({
        jobId: parsed.jobId,
        seq: Number.isFinite(body.seq) ? body.seq : parsed.seq,
        priority: Number.isFinite(body.priority) ? body.priority : 0,
        enqueuedAt: body.enqueuedAt ?? null,
        attempts: Number.isFinite(body.attempts) ? body.attempts : 0,
        file: `${P.pending}/${name}`,
      });
    }
    return { entries: out.sort(byClaimOrder), raced };
  }

  const findPending = (jobId) => listPending().entries.filter((e) => e.jobId === jobId);

  /**
   * @returns {null} no lock at all
   * @returns {{newborn: true}} the name exists but the contents have not landed
   *   yet -- only possible on the `wx` fallback path in writeJsonExclusive. A
   *   newborn lock is the youngest possible claim, so it is emphatically alive.
   * @returns {{corrupt: true}} there are contents and they are not readable
   * @returns {object} the lock
   */
  function readLock(jobId) {
    const file = lockPath(jobId);
    const text = readText(file);
    if (text === null) return null;
    if (text.trim() === '') return { jobId, file, newborn: true, corrupt: false };
    const body = parseJson(text);
    if (body === undefined) return { jobId, file, newborn: false, corrupt: true };
    return { ...body, jobId, file, newborn: false, corrupt: false };
  }

  /**
   * The zombie guard. A worker that reappears after its lease was reaped finds
   * either no lock at all or a lock belonging to whoever is rendering the job
   * now, and gets LEASE_LOST instead of overwriting their result.
   */
  function requireHolder(jobId, token) {
    assertJobId(jobId);
    const lock = readLock(jobId);
    if (!lock) {
      throw new QueueError(`${jobId} holds no lease -- it was reaped, released or already finished`, {
        code: 'LEASE_LOST',
        jobId,
      });
    }
    if (lock.corrupt || typeof token !== 'string' || lock.token !== token) {
      throw new QueueError(`${jobId} is held by ${lock.workerId ?? 'an unreadable lease'}, not by this token`, {
        code: 'LEASE_LOST',
        jobId,
      });
    }
    return lock;
  }

  /**
   * The counter is bumped past anything already on disk as well as past the
   * hint file, so a deleted `seq.txt` -- or a deleted queue directory -- costs
   * ordering and nothing else. The `wx` write below is what actually decides
   * the name; this only picks where to start looking.
   */
  function allocateSeq() {
    let high = 0;
    const hint = Number.parseInt(String(readText(P.seqHint) ?? '').trim(), 10);
    if (Number.isFinite(hint) && hint > high) high = hint;
    const taken = new Set();
    for (const name of listDir(P.pending)) {
      const parsed = parsePendingName(name);
      if (!parsed) continue;
      taken.add(parsed.seq);
      if (parsed.seq > high) high = parsed.seq;
    }
    let seq = high + 1;
    while (taken.has(seq)) seq += 1;
    return seq;
  }

  function writePendingEntry({ jobId, priority, enqueuedAt, attempts }) {
    ensureDirs();
    let seq = allocateSeq();
    for (let i = 0; i < 64; i += 1) {
      const entry = { jobId, seq, priority, enqueuedAt, attempts };
      const file = `${P.pending}/${pendingName(seq, jobId)}`;
      if (tryExclusiveCreate(file, entry) === 'created') {
        // Best effort. The hint is an optimisation and allocateSeq is correct
        // without it, which is why a failed write here is swallowed.
        try {
          fs.writeFileSync(P.seqHint, seq + EOL);
        } catch {
          /* the directory listing is the real counter */
        }
        return { ...entry, file };
      }
      // Taken, or a name still evaporating. Either way this enqueue only
      // needs *a* free sequence, so move on rather than wait for that one.
      seq += 1;
    }
    throw new QueueError(`could not allocate a queue sequence for ${jobId} after 64 tries`, {
      code: 'SEQ_EXHAUSTED',
      jobId,
    });
  }

  /**
   * Which lease this is, as a comparable value. A claim mints a fresh random
   * token, so two observations that agree on the token are two observations of
   * the same lease -- and two that disagree are separated by a claim, which is
   * the only thing that can happen in between.
   */
  const lockFingerprint = (l) => {
    // A token is 32 hex characters, so neither word can ever collide with one.
    if (l.newborn) return 'newborn';
    if (l.corrupt) return 'corrupt';
    return String(l.token);
  };

  /**
   * Remove a file only if it still holds exactly the bytes we wrote into it.
   *
   * This is how a voided reap takes back its own work without ever being able
   * to delete somebody else's. Anything that has been rewritten, or replaced,
   * or consumed and recreated by another writer, fails the comparison and is
   * left alone. Byte comparison rather than a nonce field, because a nonce
   * would have to live in the entry, and the entry is deliberately five keys
   * that mean something to a human reading the directory.
   */
  function undoIfUnchanged(file, body) {
    if (readText(file) !== serialise(body)) return false;
    return unlinkIfPresent(file);
  }

  /**
   * Remove a lock only if it is still the same lock we read.
   *
   * The fingerprint comparison narrows the window; it cannot close it, because
   * the check and the unlink are two calls and the unlink is aimed at a name.
   * What closes it is that only one caller per lease is ever allowed here --
   * the mark holder, or its lease-aged successor; see WHO MAY UNLINK THE LOCK
   * in reapExpired(). A version that let every reaper drop the dead lock had a
   * descheduled loser wake up and unlink the LIVE lock a worker had since
   * taken on the same job, and the job got claimed twice.
   */
  function dropLockIfUnchanged(lock) {
    const current = readLock(lock.jobId);
    if (!current) return false;
    if (lockFingerprint(current) !== lockFingerprint(lock)) return false;
    return unlinkIfPresent(lock.file);
  }

  /**
   * The sanction to unlink a lease's lock: this lease's reap mark. Exactly one
   * caller can create the mark, and holding it is what licenses
   * dropLockIfUnchanged -- the full argument is at WHO MAY UNLINK THE LOCK in
   * reapExpired(). Both callers that clear dead leases go through here:
   * reapExpired(), and enqueue() when it clears an expired lease to resume a
   * job.
   *
   * A caller that finds the mark already taken may inherit the drop only once
   * the mark is a full lease old: its taker has had leaseMs to run two
   * syscalls, and past that it is presumed dead by the same rule leases
   * presume workers dead. A mark that is present but not yet readable is being
   * taken this instant, and its taker will do the dropping. A readable mark
   * with no usable reapedAt can only be a hand-made repair, and refusing it
   * would strand the job forever.
   *
   * @returns {{mine: boolean, mayDropLock: boolean}} `mine` is whether this
   *   call took the mark -- the reap is its to report; `mayDropLock` is
   *   whether this call may clear the lease's lock.
   */
  function acquireDropSanction(jobId, generation, t, markBody) {
    const mine = tryExclusiveCreate(reapMarkPath(jobId, generation), markBody) === 'created';
    let mayDropLock = mine;
    if (!mine) {
      const mark = parseJson(readText(reapMarkPath(jobId, generation)));
      if (mark) {
        const reapedAt = Date.parse(mark.reapedAt);
        mayDropLock = !Number.isFinite(reapedAt) || t - reapedAt > leaseMs;
      }
    }
    return { mine, mayDropLock };
  }

  /** Idempotent: an entry already sitting in pending is left exactly as it is,
   *  because a second one for the same job is a job that gets rendered twice. */
  function ensurePending({ jobId, priority, enqueuedAt, attempts }) {
    const existing = findPending(jobId);
    if (existing.length > 0) return existing[0];
    return writePendingEntry({ jobId, priority, enqueuedAt, attempts });
  }

  const publicEntry = (e) => ({
    jobId: e.jobId,
    seq: e.seq,
    priority: e.priority,
    enqueuedAt: e.enqueuedAt,
    attempts: e.attempts,
  });

  function normaliseError(error) {
    let message;
    let code = null;
    if (error == null) message = 'unspecified failure';
    else if (typeof error === 'string') message = error;
    else {
      message = String(error.message ?? error);
      if (error.code != null) code = String(error.code);
    }
    return { message: message.slice(0, MAX_ERROR_CHARS), code };
  }

  function writeTerminal(file, body) {
    ensureDirs();
    // Atomic, not exclusive: a job can legitimately land in done/ or failed/
    // more than once over its life (re-enqueued after a fix, re-run after a
    // selection), and the newest record is the true one.
    writeJsonAtomic(file, body);
  }

  return {
    paths: P,
    leaseMs,
    maxAttempts,

    /**
     * @param {string} jobId
     * @param {{priority?: number}} [opts] higher priority is claimed first
     * @returns {{jobId, seq, priority, enqueuedAt, attempts}}
     */
    enqueue(jobId, { priority = 0 } = {}) {
      assertJobId(jobId);
      if (!Number.isFinite(priority)) {
        throw new QueueError(`priority must be a number, got ${priority}`, { code: 'BAD_PRIORITY', jobId });
      }
      ensureDirs();
      const t = now();

      // Idempotent. `POST /api/jobs` retried by an impatient browser must not
      // put the same render on the board twice.
      const already = findPending(jobId);
      if (already.length > 0) return publicEntry(already[0]);

      const lock = readLock(jobId);
      if (lock) {
        if (lock.newborn || (!lock.corrupt && Number(lock.deadline) > t)) {
          throw new QueueError(
            `${jobId} is being rendered right now by ${lock.workerId} -- enqueueing it again would render it twice`,
            { code: 'ALREADY_CLAIMED', jobId },
          );
        }
        // An expired lease is not a claim. Clearing it here rather than making
        // the caller run reapExpired() first is the difference between "resume
        // this job" working and needing a runbook.
        //
        // But clearing it is an unlink of the shared lock name, and every one
        // of those must hold this lease's mark first -- an enqueue parked
        // over an unsanctioned unlink stole a successor's live lock exactly
        // the way a parked reaper did; see WHO MAY UNLINK THE LOCK in
        // reapExpired(). The mark mirrors what a reap of this lease would
        // write, so an enqueue that dies right here leaves a record the net
        // can rescue the job from. If the mark belongs to a reaper mid-drop,
        // the lock is theirs and will be gone in microseconds; the fresh
        // entry below is valid either way, and claim() sweeps the duplicate
        // the reaper's repair may add alongside it.
        const generation = lockFingerprint(lock);
        const { mayDropLock } = acquireDropSanction(jobId, generation, t, {
          jobId,
          generation,
          seq: Number.isFinite(lock.seq) ? lock.seq : 0,
          priority: Number.isFinite(lock.priority) ? lock.priority : 0,
          enqueuedAt: lock.enqueuedAt ?? iso(t),
          attempts: (Number.isFinite(lock.attempts) ? lock.attempts : 0) + 1,
          reapedAt: iso(t),
        });
        if (mayDropLock) dropLockIfUnchanged(lock);
      }

      // A previous terminal record is not a reason to refuse. `failed/` IS the
      // dead letter: re-enqueueing what is in it is how a human resumes a job,
      // and a human asking for another go means attempt zero.
      unlinkIfPresent(donePath(jobId));
      unlinkIfPresent(failedPath(jobId));
      sweepReapMarks(jobId);

      return publicEntry(writePendingEntry({ jobId, priority, enqueuedAt: iso(t), attempts: 0 }));
    },

    /**
     * Atomic. Exactly one caller can win a given job.
     * @returns {{jobId, token, workerId, attempts, priority, seq, enqueuedAt, deadline}|null}
     */
    claim({ workerId = `${hostname()}-${process.pid}` } = {}) {
      ensureDirs();

      for (let pass = 0; pass < CLAIM_PASSES; pass += 1) {
        const t = now();
        const listing = listPending();
        let raced = listing.raced > 0;

        for (const candidate of listing.entries) {
          const { jobId } = candidate;
          const token = randomBytes(16).toString('hex');
          const lock = {
            jobId,
            workerId: String(workerId),
            token,
            seq: candidate.seq,
            priority: candidate.priority,
            enqueuedAt: candidate.enqueuedAt,
            attempts: candidate.attempts,
            claimedAt: iso(t),
            // Epoch milliseconds, deliberately. It is the one field the code
            // does arithmetic on, and comparing parsed ISO strings is exactly
            // where a timezone bug would hide.
            deadline: t + leaseMs,
            leaseMs,
          };

          const outcome = tryExclusiveCreate(lockPath(jobId), lock);
          // EEXIST is the normal outcome for every worker but one. Not an
          // error, not a log line -- just somebody else's job.
          if (outcome === 'exists') continue;
          if (outcome === 'blocked') {
            // A previous lock on this job is still evaporating, so Windows will
            // not let us even try. We cannot know yet whether the job is ours;
            // treat it like any other sign that the board is moving and look
            // again, rather than reporting an idle queue.
            raced = true;
            continue;
          }

          // The lock is won; now take the pending entry off the board.
          //
          // If the entry has already gone, we still hold the only lock on this
          // job, so nobody else can be running it and it exists in no other
          // state. Handing it back would mean deleting our lock, and a reaper
          // voiding its own spurious entry at the same moment would then leave
          // the job in nothing at all -- measured once in 1600 jobs when this
          // branch used to release. Keeping it is safe for exactly the reason
          // the lock is: it is ours.
          unlinkIfPresent(candidate.file);

          // Sweep any duplicate pending entry for this job. Duplicates can only
          // come from two enqueues or two reaps racing; collapsing them at the
          // one point where it matters is cheaper and more reliable than making
          // every writer globally exclusive.
          for (const dup of findPending(jobId)) unlinkIfPresent(dup.file);

          return {
            jobId,
            token,
            workerId: lock.workerId,
            attempts: lock.attempts,
            priority: lock.priority,
            seq: lock.seq,
            enqueuedAt: lock.enqueuedAt,
            deadline: lock.deadline,
          };
        }

        // Nothing taken. If the board was visibly moving while we read it -- a
        // pending file that vanished, or one caught mid-write -- then "there is
        // no work" may be an artefact of the instant we looked rather than the
        // truth, and reporting it would park an idle worker for a whole poll
        // interval next to a job that is sitting right there. Look again. If
        // the listing was stable, the answer is simply no.
        if (!raced) return null;
      }

      return null;
    },

    /** Extends the lease. Allowed even once the deadline has passed, as long as
     *  the lock is still ours: nobody has reaped it, so nobody else can be
     *  rendering the job, and refusing would strand work that is going fine. */
    heartbeat(jobId, token) {
      const lock = requireHolder(jobId, token);
      const t = now();
      const next = t + leaseMs;
      const { file, corrupt, ...body } = lock;
      writeJsonAtomic(file, { ...body, heartbeatAt: iso(t), deadline: next });
      return next;
    },

    complete(jobId, token) {
      const lock = requireHolder(jobId, token);
      const t = now();
      writeTerminal(donePath(jobId), {
        jobId,
        seq: lock.seq,
        priority: lock.priority,
        enqueuedAt: lock.enqueuedAt,
        attempts: lock.attempts,
        workerId: lock.workerId,
        completedAt: iso(t),
      });
      unlinkIfPresent(lock.file);
      sweepReapMarks(jobId);
      for (const dup of findPending(jobId)) unlinkIfPresent(dup.file);
    },

    /**
     * @param {string} jobId
     * @param {string} token
     * @param {{error?: Error|string|object, retriable?: boolean}} [opts]
     * @returns {{state: 'pending'|'failed', attempts: number}}
     */
    fail(jobId, token, { error, retriable = false } = {}) {
      const lock = requireHolder(jobId, token);
      const t = now();
      const attempts = (Number.isFinite(lock.attempts) ? lock.attempts : 0) + 1;
      const detail = normaliseError(error);

      // Past maxAttempts it is terminal whatever the caller said. A provider
      // that returns a retriable error forever is exactly how a queue spins on
      // one job and renders nothing else all night.
      if (retriable && attempts < maxAttempts) {
        const entry = ensurePending({
          jobId,
          priority: lock.priority ?? 0,
          enqueuedAt: lock.enqueuedAt ?? iso(t),
          attempts,
        });
        unlinkIfPresent(lock.file);
        return { state: 'pending', attempts: entry.attempts };
      }

      writeTerminal(failedPath(jobId), {
        jobId,
        seq: lock.seq,
        priority: lock.priority,
        enqueuedAt: lock.enqueuedAt,
        attempts,
        workerId: lock.workerId,
        failedAt: iso(t),
        // The message and the code, nothing else. The stack, the step and the
        // provider response live in the manifest; duplicating them here would
        // give two accounts of one failure. `out/jobs/<jobId>/` is the dead
        // letter you open, which is why there is no dead-letter queue.
        error: { ...detail, retriable: Boolean(retriable) },
      });
      unlinkIfPresent(lock.file);
      sweepReapMarks(jobId);
      for (const dup of findPending(jobId)) unlinkIfPresent(dup.file);
      return { state: 'failed', attempts };
    },

    /** Hand the job back without burning an attempt. This is the SIGTERM path:
     *  a worker shutting down cleanly did not fail, and charging it an attempt
     *  would mean a few restarts could exhaust a job that never once errored. */
    release(jobId, token) {
      const lock = requireHolder(jobId, token);
      const t = now();
      ensurePending({
        jobId,
        priority: lock.priority ?? 0,
        enqueuedAt: lock.enqueuedAt ?? iso(t),
        attempts: Number.isFinite(lock.attempts) ? lock.attempts : 0,
      });
      unlinkIfPresent(lock.file);
    },

    /**
     * Dead leases back to pending. The worker calls this on startup, because
     * the machine it just rebooted may hold locks for jobs whose worker no
     * longer exists.
     *
     * A lease that cannot be read is treated as expired. That is deliberate: an
     * unreadable lock cannot be shown to be alive, stranding a job forever is
     * worse than reaping a claim early, and reaping early is safe anyway
     * because the reaped worker's token stops working the moment its lock is
     * gone.
     *
     * Reaping counts as an attempt. A job that hard-kills its worker every time
     * would otherwise loop between claimed and pending until someone noticed;
     * instead it lands in `failed/` after maxAttempts with LEASE_EXPIRED, which
     * is a thing you can read in `queue-cli peek --state=failed`.
     *
     * @returns {string[]} the job ids this call moved
     */
    /**
     * @param {{onTerminal?: (jobId: string) => void}} [opts]
     *   `onTerminal` is called for each job this reap sent to `failed/` for
     *   good, rather than back to `pending`.
     *
     *   ADDITIVE ON PURPOSE. The return value is unchanged -- a flat array of
     *   every job moved -- because thirty-odd assertions and a race test depend
     *   on that shape, and this module's atomicity properties are the last
     *   place to introduce churn for a signature.
     *
     *   IT EXISTS BECAUSE A REAPED-TO-DEATH JOB WAS NEVER REFUNDED. The debit
     *   lands at enqueue, and the only refund trigger is inside the worker's
     *   own failure path. This function writes the terminal record itself, in a
     *   module that holds no token and knows nothing about accounts, so a job
     *   killed by four lease expiries left the customer down 21 CR with no
     *   provider ever called, no `refunded` event, and no `REFUND MISSED` line
     *   either -- the one witness the design relies on. Total silence.
     */
    reapExpired({ onTerminal = null } = {}) {
      ensureDirs();
      const t = now();
      const moved = [];

      for (const name of listDir(P.claimed)) {
        if (!name.endsWith('.lock')) continue;
        const jobId = name.slice(0, -'.lock'.length);
        if (!JOB_ID_RE.test(jobId) || WINDOWS_DEVICE_RE.test(jobId)) continue;

        const lock = readLock(jobId);
        if (!lock) continue;
        // A lock whose contents have not landed yet belongs to a worker that is
        // claiming this job at this instant. Reaping it deletes a live claim, and
        // the claimer then sweeps away the entry we wrote as a duplicate -- which
        // is exactly how a job ends up in no state at all.
        if (lock.newborn) continue;
        if (!lock.corrupt && Number(lock.deadline) > t) continue;

        const attempts = (Number.isFinite(lock.attempts) ? lock.attempts : 0) + 1;
        const priority = Number.isFinite(lock.priority) ? lock.priority : 0;
        const enqueuedAt = lock.enqueuedAt ?? iso(t);

        // The reaped job goes back at the sequence it was claimed from, NOT at
        // a fresh one. That is not a fairness decision, it is what makes the
        // create below exclusive: every reaper looking at this lease computes
        // the same destination filename, so exactly one of them can create it.
        // The fairness happens to come out right too -- a worker dying is not
        // the job's fault, so it keeps its place, where fail() deliberately
        // sends a job that errored to the back of its priority level.
        //
        // A lock too corrupt to read gives us no sequence at all. Sequence 0 is
        // the deterministic answer: allocateSeq() starts at 1 and never issues
        // it, so it cannot collide, and it sorts to the front, which is where a
        // job nobody can account for belongs.
        const seq = Number.isFinite(lock.seq) ? lock.seq : 0;

        // WINNER SELECTION. Exclusive create of the destination, and nothing
        // else, because on Windows nothing else is exclusive. Measured on this
        // machine, 16 threads released through one barrier onto one file:
        // `openSync(..., 'wx')` produced exactly one winner in 120 of 120
        // rounds; `unlinkSync` produced the wrong number in 120 of 120, usually
        // with ALL SIXTEEN reporting success; `renameSync` in 60 of 60, with
        // all 960 calls returning success. libuv implements both of those as
        // open-then-act, and setting a delete disposition -- or renaming
        // through a handle you already hold -- is not an error just because
        // someone else did it first.
        //
        // An earlier version of this function picked its winner by whoever's
        // unlink returned true. It reported one job twice, and worse: the loser
        // then deleted the pending entry it had written, as a "duplicate", when
        // it was the only one. The job vanished from pending, claimed, done and
        // failed simultaneously while every count still looked plausible.
        //
        // Writing the destination IS the durable state, so there is no marker
        // to orphan and no instant where the job exists nowhere: it is claimed,
        // then claimed AND pending, then pending. Nothing in this function ever
        // deletes a pending entry, which is what makes losing a job
        // structurally impossible rather than merely unlikely.
        const terminal = attempts >= maxAttempts;
        const dest = terminal
          ? failedPath(jobId)
          : `${P.pending}/${pendingName(seq, jobId)}`;
        const body = terminal
          ? {
            jobId,
            seq: Number.isFinite(lock.seq) ? lock.seq : null,
            priority,
            enqueuedAt,
            attempts,
            workerId: lock.workerId ?? null,
            failedAt: iso(t),
            error: {
              message: `lease expired ${attempts} times without completing -- the worker is dying on this job`,
              code: 'LEASE_EXPIRED',
              retriable: false,
            },
          }
          : { jobId, seq, priority, enqueuedAt, attempts };

        // WHO REAPED THIS LEASE. Winning the destination create cannot answer
        // that, and the trace that proves it looks like this: two reapers of
        // the SAME lease both created the same pending file a millisecond
        // apart, because in between a worker claimed the job and consumed the
        // entry, freeing the filename again. An exclusive create is exclusive
        // at an instant, not across a lifetime.
        //
        // The lock cannot answer it either. The second reaper's post-check saw
        // no lock at all -- which is exactly what a fresh, legitimate reap also
        // looks like, since the winner drops the lock as its last act. "I
        // reaped this" and "this was already reaped and has moved on" are
        // indistinguishable from the live state alone.
        //
        // So the reap leaves a record that outlives the entry, named after the
        // lease it consumed. Taking that mark IS the reap: one lease, one mark,
        // one reporter, decided by the one primitive on this platform that is
        // actually exclusive. A later lease on the same job mints a fresh token
        // and so gets a fresh name, and is reported again as it should be.
        //
        // WHO MAY UNLINK THE LOCK. One caller per lease, and it is the mark
        // holder. An unlink is aimed at a NAME, not at the bytes that were
        // checked: with every reaper allowed to drop the dead lock, a reaper
        // descheduled between "the lock is still the dead lease" and "unlink
        // it" wakes up and unlinks whatever is at that name NOW -- and by then
        // it can be the LIVE lock of the worker that claimed the job in the
        // gap. The stolen claim's job gets resurrected and claimed a second
        // time: one render, two workers, both paying a provider. CI caught
        // exactly that on Linux (7 wins over 6 jobs, run 33258055925), and
        // test/queue-race.test.js replays it deterministically with a reaper
        // parked over its own unlink. Serialising the drop on the mark closes
        // it: a second lock at this name can only exist after the one
        // sanctioned unlink has already happened. enqueue() clears expired
        // leases under the same sanction, because the argument is about the
        // name, not about who is unlinking it.
        //
        // A mark holder that died between taking the mark and dropping the
        // lock must not strand the job, so acquireDropSanction lets the drop
        // be taken over -- but only once the mark is a full lease old, the
        // same backstop workers themselves get.
        const generation = lockFingerprint(lock);
        const { mine, mayDropLock } = acquireDropSanction(jobId, generation, t, {
          jobId, generation, seq, priority, enqueuedAt, attempts, reapedAt: iso(t),
        });

        // A reaper that took the mark and then died would strand the job for
        // ever if nobody else were allowed to finish: the mark can never be
        // taken again, so the entry would never be written. Anyone may finish
        // it -- but only while this lease is still the one on disk. Writing
        // behind a worker that has since claimed the job is how an entry ends
        // up beside a live lock, and how one render gets run twice.
        const still = readLock(jobId);
        const current = Boolean(still) && lockFingerprint(still) === generation;

        if (current) {
          // Write the destination before releasing the lock, always. A crash
          // between the two costs a duplicate that claim() sweeps; the other
          // order costs the job.
          //
          // And "write" has to mean landed. An exclusive create has a third
          // answer besides won and lost -- Windows can refuse the attempt
          // outright -- and treating that as done would drop the lock with
          // nothing written, which is the one way this function can lose a job.
          const outcome = tryExclusiveCreate(dest, body);
          if (outcome === 'blocked') {
            // Nothing written, so nothing to release and nothing to report.
            // Give the mark back if it is ours, so the next pass gets a clean
            // run at this lease instead of finding it marked and unfinished.
            if (mine) unlinkIfPresent(reapMarkPath(jobId, generation));
            continue;
          }

          const after = readLock(jobId);
          if (outcome === 'created' && after && lockFingerprint(after) !== generation) {
            // Superseded in the breath between the check and the write. Take
            // back our own exact bytes and nothing else -- and only while
            // somebody demonstrably holds the job, because if the lock has
            // gone this entry may be its only home.
            const holder = readLock(jobId);
            if (holder && lockFingerprint(holder) !== generation) undoIfUnchanged(dest, body);
          }
          if (mayDropLock) dropLockIfUnchanged(lock);
        }

        // The mark holder reports even when somebody else did the writing, and
        // even when the lease has since moved on. Taking the mark is what
        // reaped this lease; who happened to run the syscalls is not the
        // question `reapExpired` answers.
        if (mine) {
          moved.push(jobId);
          // Only the mark holder reports, so a job cannot be refunded twice by
          // two workers reaping the same lease -- the same rule the line above
          // already follows for the return value.
          if (terminal && onTerminal) onTerminal(jobId);
        }
      }

      // THE NET. Everything above is written so that a job is always in at
      // least one of the four states -- the new state is created before the
      // old one is released, everywhere, without exception. That argument is
      // only as good as the reasoning behind it, and under a 8-thread
      // stampede on a loaded machine roughly one job in two thousand still
      // came out of it in no state at all. Every hypothesis for it was
      // measured and killed: no lock drop ever removed a live claim, no lock
      // was ever read unparseable, the undo was ruled out by removing it, and
      // the window closes whenever it is instrumented.
      //
      // So rather than argue the window shut, close it with evidence that is
      // already on disk. A reap mark is a durable record that this job was in
      // flight, and marks are swept the moment a job legitimately leaves the
      // queue -- completed, failed for good, or enqueued afresh. A mark whose
      // job is in none of the four states therefore means exactly one thing,
      // and it is recoverable: put the job back where the mark says it was.
      for (const name of listDir(P.claimed)) {
        if (!name.endsWith('.reaped')) continue;
        const mark = parseJson(readText(`${P.claimed}/${name}`));
        if (!mark || typeof mark.jobId !== 'string') continue;
        const { jobId } = mark;
        if (!JOB_ID_RE.test(jobId) || WINDOWS_DEVICE_RE.test(jobId)) continue;

        if (readLock(jobId)) continue;
        if (findPending(jobId).length > 0) continue;
        if (readText(donePath(jobId)) !== null) continue;
        if (readText(failedPath(jobId)) !== null) continue;

        const seq = Number.isFinite(mark.seq) ? mark.seq : 0;
        const file = `${P.pending}/${pendingName(seq, jobId)}`;
        const entry = {
          jobId,
          seq,
          priority: Number.isFinite(mark.priority) ? mark.priority : 0,
          enqueuedAt: mark.enqueuedAt ?? iso(t),
          attempts: Number.isFinite(mark.attempts) ? mark.attempts : 0,
        };
        if (tryExclusiveCreate(file, entry) !== 'created') continue;

        // Look again. The four checks above are four separate reads, and a
        // worker can claim the job in the gaps between them -- in which case
        // it was never lost and this entry is a duplicate that would get the
        // render run twice. Anything that appeared means put it back the way
        // it was; only our own exact bytes are ever removed.
        if (readLock(jobId) || readText(donePath(jobId)) !== null || readText(failedPath(jobId)) !== null) {
          undoIfUnchanged(file, entry);
          continue;
        }
        // Deliberately NOT reported. reapExpired names the leases it reaped,
        // and this job was already named when its lease was reaped -- saying it
        // again is precisely the "one job reported twice" that this whole
        // mechanism exists to prevent. The rescue is a repair, not a reap.
      }

      return moved;
    },

    /** Counted the same way claim() counts, so `stats().pending` and
     *  `peek().length` can never disagree -- a number in the CLI that is bigger
     *  than the list underneath it sends someone hunting for a job that was
     *  never claimable.
     *  @returns {{pending:number, claimed:number, done:number, failed:number}} */
    stats() {
      const count = (dir, suffix) => listDir(dir).filter((f) => f.endsWith(suffix)).length;
      return {
        pending: listPending().entries.length,
        claimed: count(P.claimed, '.lock'),
        done: count(P.done, '.json'),
        failed: count(P.failed, '.json'),
      };
    },

    /**
     * Read-only. `peek()` with no argument is the pending queue in the exact
     * order claim() will hand it out; the `state` option is what the CLI uses
     * to show the other three directories.
     *
     * @param {{state?: 'pending'|'claimed'|'done'|'failed', limit?: number}} [opts]
     */
    peek({ state = 'pending', limit = Infinity } = {}) {
      if (!STATES.includes(state)) {
        throw new QueueError(`unknown queue state ${JSON.stringify(state)}; expected one of ${STATES.join(', ')}`, {
          code: 'BAD_STATE',
        });
      }

      if (state === 'pending') return listPending().entries.slice(0, limit).map(publicEntry);

      if (state === 'claimed') {
        const t = now();
        const rows = [];
        for (const name of listDir(P.claimed)) {
          if (!name.endsWith('.lock')) continue;
          const jobId = name.slice(0, -'.lock'.length);
          const lock = readLock(jobId);
          if (!lock) continue;
          rows.push({
            jobId,
            workerId: lock.workerId ?? null,
            attempts: lock.attempts ?? 0,
            priority: lock.priority ?? 0,
            claimedAt: lock.claimedAt ?? null,
            deadline: Number(lock.deadline) || null,
            expired: !lock.newborn && (Boolean(lock.corrupt) || !(Number(lock.deadline) > t)),
          });
        }
        return rows.sort((a, b) => (a.deadline ?? 0) - (b.deadline ?? 0)).slice(0, limit);
      }

      const dir = state === 'done' ? P.done : P.failed;
      const key = state === 'done' ? 'completedAt' : 'failedAt';
      const rows = [];
      for (const name of listDir(dir)) {
        if (!name.endsWith('.json')) continue;
        const body = parseJson(readText(`${dir}/${name}`));
        if (!body) continue;
        rows.push(body);
      }
      // Newest first: the interesting failure is the one that just happened.
      return rows.sort((a, b) => String(b[key] ?? '').localeCompare(String(a[key] ?? ''))).slice(0, limit);
    },

    /**
     * Operator-facing, and NOT part of the module contract in
     * docs/interfaces.md §6 -- it is additive, and it exists so that
     * `queue-cli drain` has somewhere honest to live.
     *
     * Drain takes pending work off the board and records it in `failed/`, which
     * makes it reversible: every drained job is still a directory you can open
     * and a jobId you can enqueue again. It deliberately does not touch claimed
     * jobs; a render that is already running is not drained by deleting its
     * queue entry, it is stopped by stopping the worker.
     *
     * @returns {string[]} the job ids taken out of pending
     */
    drain({ reason = 'drained by operator' } = {}) {
      ensureDirs();
      const t = now();
      const drained = [];
      for (const entry of listPending().entries) {
        writeTerminal(failedPath(entry.jobId), {
          jobId: entry.jobId,
          seq: entry.seq,
          priority: entry.priority,
          enqueuedAt: entry.enqueuedAt,
          attempts: entry.attempts,
          workerId: null,
          failedAt: iso(t),
          error: { message: String(reason).slice(0, MAX_ERROR_CHARS), code: 'DRAINED', retriable: true },
        });
        if (unlinkIfPresent(entry.file)) drained.push(entry.jobId);
      }
      return drained;
    },
  };
}
