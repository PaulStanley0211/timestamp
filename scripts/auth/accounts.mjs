/**
 * Accounts. Who a person is, how we know it is them, and what they are allowed
 * to spend.
 *
 * WHY THE PASSWORD IS scrypt AND NOT A HASH FUNCTION. `sha256(password)` is a
 * primitive designed to be fast, and "fast" is precisely the property an
 * offline cracker wants: a stolen `out/accounts` directory full of sha256
 * digests is a wordlist away from being a list of working logins. scrypt is
 * deliberately slow AND deliberately memory-hard, so the attacker's GPU farm
 * loses most of its advantage. The parameters are stored *inside* the encoded
 * string -- `scrypt$N$r$p$salt$hash` -- so the cost can be raised in five years
 * without invalidating a single existing password: an old record verifies at
 * its own cost, a new one is written at today's. A scheme with the parameters
 * in a constant somewhere else is a scheme that can never be changed.
 *
 * WHY timingSafeEqual AND NEVER `===`. A string compare returns on the first
 * differing byte. Feed it a few thousand guesses and the wall clock tells you
 * how many leading bytes were right, which turns a 64-byte hash into 64
 * independent one-byte searches. `timingSafeEqual` reads both buffers to the
 * end every time. It costs nothing and it is not optional.
 *
 * WHY A WRONG PASSWORD AND AN UNKNOWN EMAIL ARE INDISTINGUISHABLE. If the login
 * form says "no such account" for one and "wrong password" for the other, the
 * form is an account-enumeration oracle: anybody can walk a list of email
 * addresses and learn which of them have uploaded a photograph of their face to
 * this service. That is a disclosure about a person, not about us. So
 * `authenticate` returns one error with one message for both cases, and it
 * burns one scrypt derivation on the unknown-email path too, because a reply
 * that arrives in 0.2ms instead of 70ms answers the question just as loudly as
 * the wording would have.
 *
 * WHY THE EMAIL IS BOTH HASHED AND KEPT IN PLAINTEXT. The hash is the index
 * filename, so `dir out/accounts/_index` is a list of opaque hex rather than a
 * list of everybody's email address -- that is the whole of what it buys, and
 * this comment says so rather than implying more. It is deliberately NOT
 * salted: `account.json` one directory over holds the address in plain text
 * because the app has to show a person which account they are signed in to, so
 * a salt would be defending the index against an attacker who already has the
 * answer next door. What matters far more is the normalisation.
 * `Paul@Example.com ` and `paul@example.com` must not become two accounts, and
 * they will, the first week, if the trim and the lowercase happen anywhere
 * except in one function that everything calls.
 *
 * WHY THERE IS NO PAYMENT CODE IN THIS FILE. Not one field, not a placeholder,
 * not a commented-out payment-instrument field waiting to be uncommented.
 * `plan` is set by the operator CLI or, later, by
 * a webhook from a hosted checkout whose card details this process never sees.
 * A card number that never enters our address space cannot leak out of it, and
 * the cheapest way to guarantee that is for there to be nowhere to put one.
 *
 * WHY EVERY WRITE IS tmp + rename AND EVERY UPDATE HOLDS A LOCK. A half-written
 * `account.json` is a person locked out of the thing they paid for, and the
 * window for it is exactly as wide as `writeFileSync` -- the same reasoning as
 * scripts/render/job.mjs, which is where this pattern comes from. The lock is
 * separate and answers a different question: two callers that both load, both
 * edit and both save silently lose one of the two edits, and the edit most
 * likely to be lost is a credit debit, which is a free render. `rev` makes
 * that loss loud rather than silent even for a caller who forgot the lock.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { assertConsent, recordConsent } from '../safety/consent.mjs';

export const REPO_ROOT = path
  .resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  .replace(/\\/g, '/');

// Declared above everything else in this file on purpose: `PLANS` is evaluated
// at module scope and reaches for all three of them. A `const` or a `class`
// touched before its own declaration is a temporal-dead-zone ReferenceError,
// and the place that would have surfaced is the money path.

const defaultNow = () => new Date();
const slash = (p) => p.replace(/\\/g, '/');

export class AuthError extends Error {
  constructor(message, { code = 'AUTH_ERROR', userMessage, accountId = null, detail = null } = {}) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    // Two messages on purpose. `.message` names the failure for a log;
    // `.userMessage` is the sentence a stranger is allowed to read, and it must
    // never carry a path, a hash, an account id, or the answer to "does this
    // email have an account here".
    this.userMessage = userMessage ?? 'Something went wrong. Please try again.';
    this.accountId = accountId;
    this.detail = detail;
  }
}

/** The one message the login form may show, whatever actually happened.
 *  Exported so the web layer cannot accidentally invent a second, more helpful
 *  one -- helpfulness is the vulnerability here. */
export const BAD_CREDENTIALS_MESSAGE = 'That email and password do not match an account.';

/** Bumped when the record shape changes in a way an older reader cannot handle.
 *  `loadAccount` refuses an unknown version rather than guessing, because
 *  guessing about a credit ledger is guessing about money. */
export const SCHEMA_VERSION = 1;

/** Accounts live under the same `out/` root the jobs and the queue do, so one
 *  `--root` moves a whole installation. */
export const ACCOUNTS_DIR = 'out/accounts';

/**
 * Which account owns which job: `out/owners/<accountId>/<jobId>.json`.
 *
 * WHY THE CONSTANT IS HERE RATHER THAN IN THE WEB LAYER THAT WRITES IT.
 * `scripts/web/session-middleware.mjs` builds these paths and is the only writer,
 * but it is no longer the only reader: `scripts/render/purge.mjs` removes the
 * entry when it removes the job, because an entry authorising access to a job
 * that no longer exists is a pointer to nothing that accumulates forever. Two
 * modules spelling the same directory out by hand is exactly how a purge comes
 * to sweep a path nothing writes to and report success.
 */
export const OWNERS_DIR = 'out/owners';

/** Underscore-prefixed so it can never collide with an account id, which is 32
 *  lowercase hex characters and nothing else. */
export const INDEX_DIR = '_index';

export const ACCOUNT_ID_RE = /^[0-9a-f]{32}$/;

/**
 * Where every number in the money path lives.
 *
 * WHY THE CONFIG IS READ HERE AND NOT IN credits.mjs, WHICH IS WHERE IT
 * BELONGS. `PLANS` is an export of this module by contract, and credits.mjs
 * already imports `loadAccount` and `updateAccount` from here. Reading the file
 * from credits.mjs and importing `PLANS` back would be an import cycle, and a
 * cycle around a `const` evaluated at module scope is a temporal-dead-zone
 * `undefined` rather than an error -- an undefined plan table in the money path,
 * surfacing as a wrong bill. One arrow, in the direction that cannot do that.
 */
export const CREDITS_CONFIG = 'config/credits.json';

let creditConfigCache = null;

/**
 * The credit configuration, memoised.
 *
 * Memoised because this is read on every plan lookup and the file does not
 * change under a running process; `reload: true` exists for the test that
 * proves nothing here is hardcoded. A missing or unparseable file is a hard
 * failure and not a fallback to defaults: a default in the money path is a
 * guess that bills somebody, and the loud version of that is a process that
 * refuses to start.
 */
export function creditConfig({ root = REPO_ROOT, reload = false } = {}) {
  if (creditConfigCache !== null && !reload) return creditConfigCache;
  const file = slash(path.resolve(root, CREDITS_CONFIG));
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new AuthError(`could not read ${file}: ${err.code ?? err.message}`, {
      code: 'NO_CREDIT_CONFIG',
      detail: { file },
    });
  }
  // Every entry in that file has to say it is an estimate, for the same reason
  // config/pricing.json refuses an entry without a `_comment`: an unannotated
  // number in the money path reads as fact to whoever finds it next.
  for (const [id, plan] of Object.entries(parsed?.plans ?? {})) {
    for (const key of ['id', 'label', 'monthlyUSD', 'annualUSD', 'creditsPerPeriod']) {
      if (plan?.[key] === undefined) {
        throw new AuthError(`plan ${id} in ${file} is missing ${key}`, { code: 'BAD_CREDIT_CONFIG' });
      }
    }
    if (typeof plan._comment !== 'string' || plan._comment.length === 0) {
      throw new AuthError(`plan ${id} in ${file} carries no _comment saying whether it is an estimate`, {
        code: 'BAD_CREDIT_CONFIG',
      });
    }
  }
  creditConfigCache = deepFreeze(parsed);
  return creditConfigCache;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

/**
 * The plans, as loaded from config/credits.json.
 *
 * Two rates per plan, monthly and annual, and a credit grant per period rather
 * than a tape count. The tape count was abandoned for a measured reason: with
 * fal's published token formula a 15-second render costs about $2.02 at 480p,
 * $4.54 at 720p and $10.21 at 1080p -- a spread of more than 6x -- so "four
 * tapes a month" on a $12 plan is somewhere between a 33% margin and a $40 loss
 * depending on a dropdown. Credits are what make the price track the cost.
 *
 * `_comment` fields are stripped here so that `PLANS` is the shape the pricing
 * page renders; the reasoning stays in the file, where the numbers are.
 */
export const PLANS = Object.freeze(Object.fromEntries(
  Object.entries(creditConfig().plans).map(([id, plan]) => [id, Object.freeze({
    id: plan.id,
    label: plan.label,
    monthlyUSD: plan.monthlyUSD,
    annualUSD: plan.annualUSD,
    creditsPerPeriod: plan.creditsPerPeriod,
  })]),
));

export const PLAN_IDS = Object.freeze(Object.keys(PLANS));

/** What a signup gets, and what an account with an unrecognisable plan falls
 *  back to. The fallback direction is deliberate: the cheapest plan spends
 *  least, so a corrupted plan field costs a support email rather than a month of
 *  free renders. */
export const DEFAULT_PLAN_ID = 'free';

/**
 * Today's cost. N=16384 with r=8 needs 128*N*r = 16 MiB and lands around 50-80ms
 * on this machine: slow enough to make bulk cracking expensive, fast enough that
 * a login does not feel broken. `maxmem` is raised above Node's 32 MiB default
 * so that raising N later fails on the number being wrong rather than on an
 * unrelated allocation cap several months after the change.
 */
export const SCRYPT = Object.freeze({
  N: 16384, r: 8, p: 1, keylen: 64, saltBytes: 16, maxmem: 128 * 1024 * 1024,
});

/**
 * `minChars` is above the usual eight because of what this particular service
 * holds: a photograph of somebody's face and a video made from it. `maxBytes`
 * exists because scrypt is memory-hard by design, and a ten-megabyte password
 * field is a denial-of-service request wearing a login form.
 */
export const PASSWORD = Object.freeze({ minChars: 10, maxBytes: 1024 });

/**
 * The shortest stored hash `verifyPassword` will look at.
 *
 * MEASURED, AND SURPRISING: scrypt finishes with a single-iteration PBKDF2, so
 * its output for a short `keylen` is a PREFIX of its output for a long one.
 * Since `verifyPassword` reads the key length from the stored hash -- which it
 * must, or raising `SCRYPT.keylen` breaks every existing login -- a record whose
 * hash has been truncated to six bytes still verifies against the correct
 * password, and is brute-forceable in seconds. A floor turns a hand-edited or
 * half-written record into a refusal instead of into a weaker password check.
 * 16 bytes is 128 bits and no hash this module writes is anywhere near it.
 */
const MIN_HASH_BYTES = 16;

/** RFC-perfect email validation is famously not worth writing. This rejects the
 *  shapes that are obviously not addresses and nothing else; the address never
 *  becomes part of a path, so its job here is data quality, not safety. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const MAX_EMAIL_CHARS = 254;

/** Windows hands back EPERM/EBUSY when a scanner or an open Explorer window
 *  holds a handle for a few milliseconds. That is "wait a moment", not "lose the
 *  account". Same set as job.mjs, for the same reason. */
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_ATTEMPTS = 12;

/** How long a caller waits for another caller to leave the critical section,
 *  and how old a lock has to be before it is presumed to belong to a process
 *  that died inside it. The gap between the two is wide because the critical
 *  section is one small read and one small write -- microseconds -- so anything
 *  near either number means something is broken rather than busy. */
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

const SLEEP_SLOT = new Int32Array(new SharedArrayBuffer(4));

/** Blocks this thread without a timer. Every mutating path in this module is
 *  synchronous, because the alternative is an async lock that a caller forgets
 *  to await, and a forgotten await on a balance check is a free render. */
function sleepSync(ms) {
  Atomics.wait(SLEEP_SLOT, 0, 0, ms);
}


function toDate(value) {
  const d = value instanceof Date ? value : new Date(Number(value));
  if (Number.isNaN(d.getTime())) {
    throw new AuthError(`nowImpl returned ${String(value)}; it must return a Date or epoch milliseconds`, {
      code: 'BAD_CLOCK',
    });
  }
  return d;
}

// ---------------------------------------------------------------------------
// paths and ids
// ---------------------------------------------------------------------------

export function accountsRoot(root = REPO_ROOT) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new AuthError('root must be a non-empty string', { code: 'BAD_ROOT' });
  }
  const dir = slash(path.resolve(root, ACCOUNTS_DIR));
  return { dir, index: `${dir}/${INDEX_DIR}` };
}

function assertUsableAccountId(accountId) {
  if (typeof accountId !== 'string' || !ACCOUNT_ID_RE.test(accountId)) {
    // The id becomes a directory name, so it is validated before it touches the
    // filesystem, exactly as the web layer validates `:id` against JOB_ID_RE.
    // A module that builds paths out of caller-supplied text owns that check
    // regardless of who else also does it.
    throw new AuthError(`unusable account id ${JSON.stringify(accountId)}`, {
      code: 'BAD_ACCOUNT_ID',
      userMessage: 'We could not find that account.',
    });
  }
  return accountId;
}

export function accountPaths(root, accountId) {
  const { dir } = accountsRoot(root);
  assertUsableAccountId(accountId);
  const accountDir = `${dir}/${accountId}`;
  return {
    dir: accountDir,
    record: `${accountDir}/account.json`,
    // A sibling of the record, not a field inside it. A lock written into the
    // file it protects has to be read through the very write it protects
    // against.
    lock: `${accountDir}/account.lock`,
  };
}

/**
 * 16 random bytes. Not a counter and not derived from the email, because an
 * account id ends up in a path and sooner or later in a URL, and both of those
 * leak: a counter tells a stranger how many customers exist, and an
 * email-derived id tells them whose account they are looking at.
 */
export function newAccountId({ rand = crypto } = {}) {
  return rand.randomBytes(16).toString('hex');
}

// ---------------------------------------------------------------------------
// email
// ---------------------------------------------------------------------------

/**
 * The single place a trim and a lowercase happen. Everything that hashes,
 * stores, compares or looks up an address comes through here, because the
 * moment two call sites normalise slightly differently, `Paul@Example.com` gets
 * its own account and its own credits and cannot sign in with the address it was
 * typed with.
 */
export function normaliseEmail(email) {
  if (typeof email !== 'string') {
    throw new AuthError(`email must be a string, got ${typeof email}`, {
      code: 'BAD_EMAIL',
      userMessage: 'Please enter an email address.',
    });
  }
  const cleaned = email.trim().toLowerCase();
  if (cleaned.length === 0 || cleaned.length > MAX_EMAIL_CHARS || !EMAIL_RE.test(cleaned)) {
    throw new AuthError(`email ${JSON.stringify(email)} is not a usable address`, {
      code: 'BAD_EMAIL',
      userMessage: 'That does not look like an email address.',
    });
  }
  return cleaned;
}

/** The index filename. See the header for what unsalted does and does not buy
 *  here. */
export function emailHash(email) {
  return crypto.createHash('sha256').update(normaliseEmail(email), 'utf8').digest('hex');
}

function indexPath(root, hash) {
  const { index } = accountsRoot(root);
  return `${index}/${hash}.json`;
}

// ---------------------------------------------------------------------------
// passwords
// ---------------------------------------------------------------------------

function assertUsablePassword(password) {
  if (typeof password !== 'string') {
    throw new AuthError(`password must be a string, got ${typeof password}`, {
      code: 'BAD_PASSWORD',
      userMessage: 'Please choose a password.',
    });
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD.maxBytes) {
    throw new AuthError(`password exceeds ${PASSWORD.maxBytes} bytes`, {
      code: 'BAD_PASSWORD',
      userMessage: 'That password is too long.',
    });
  }
  // Codepoints, not UTF-16 units, so an emoji counts as one character rather
  // than two. A rule that counts differently from the way its sentence reads is
  // a rule people cannot satisfy.
  if ([...password].length < PASSWORD.minChars) {
    throw new AuthError(`password shorter than ${PASSWORD.minChars} characters`, {
      code: 'BAD_PASSWORD',
      userMessage: `Please use at least ${PASSWORD.minChars} characters.`,
    });
  }
  return password;
}

/**
 * `scrypt$N$r$p$<salt b64>$<hash b64>`.
 *
 * Everything needed to verify is inside the string, which is what makes the
 * cost raisable later. The salt is per account and 16 bytes: without it, two
 * people who chose the same password have the same digest, and one precomputed
 * table opens every account on the service at once.
 */
export function hashPassword(password, { params = SCRYPT, rand = crypto } = {}) {
  assertUsablePassword(password);
  const salt = rand.randomBytes(params.saltBytes ?? SCRYPT.saltBytes);
  const { N, r, p, keylen, maxmem } = { ...SCRYPT, ...params };
  const hash = crypto.scryptSync(password, salt, keylen, { N, r, p, maxmem });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** null rather than a throw for anything malformed. The only writer of this
 *  field is `hashPassword`, so a string that does not parse means the file was
 *  hand-edited, and the right answer to a login against a hand-edited record is
 *  "no", not a stack trace on a public form. */
export function parsePassword(encoded) {
  if (typeof encoded !== 'string') return null;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, N, r, p, saltB64, hashB64] = parts;
  const params = { N: Number(N), r: Number(r), p: Number(p) };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) return null;
  if (params.N < 2 || params.r < 1 || params.p < 1) return null;
  const salt = Buffer.from(saltB64, 'base64');
  const hash = Buffer.from(hashB64, 'base64');
  if (salt.length === 0 || hash.length < MIN_HASH_BYTES) return null;
  return { ...params, salt, hash };
}

/**
 * Constant-time verification against the parameters the record was written
 * with.
 *
 * `keylen` comes from the stored hash's own length rather than from today's
 * constant, so raising `SCRYPT.keylen` does not turn every existing password
 * into a length mismatch. `timingSafeEqual` throws on unequal lengths, so that
 * mistake would be a crash on the login path for every account created before
 * the change -- a total outage produced by a one-line tuning edit.
 */
export function verifyPassword(account, password) {
  const encoded = typeof account === 'string' ? account : account?.password;
  const parsed = parsePassword(encoded);
  if (parsed === null) return false;
  if (typeof password !== 'string') return false;
  if (Buffer.byteLength(password, 'utf8') > PASSWORD.maxBytes) return false;

  let candidate;
  try {
    candidate = crypto.scryptSync(password, parsed.salt, parsed.hash.length, {
      N: parsed.N, r: parsed.r, p: parsed.p, maxmem: SCRYPT.maxmem,
    });
  } catch {
    // Parameters recorded on a machine with more memory than this one. Not a
    // wrong password, but the only safe answer is still no.
    return false;
  }
  return crypto.timingSafeEqual(candidate, parsed.hash);
}

/** The work an unknown email must also do, so "no such account" and "wrong
 *  password" take the same wall-clock time. It derives against a throwaway salt
 *  at today's default cost, which is what a freshly created account pays. */
function burnEqualWork(password) {
  const text = typeof password === 'string' && Buffer.byteLength(password, 'utf8') <= PASSWORD.maxBytes
    ? password
    : 'x';
  try {
    crypto.scryptSync(text, crypto.randomBytes(SCRYPT.saltBytes), SCRYPT.keylen, {
      N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem,
    });
  } catch { /* the point is the time spent, not the digest */ }
}

// ---------------------------------------------------------------------------
// durable I/O
// ---------------------------------------------------------------------------

function atomicWriteJson(file, value, accountId) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // A unique tmp name, unlike job.mjs's fixed one, because a job has exactly one
  // legitimate writer -- whoever holds the queue lease -- and an account does
  // not: the web process, the worker and the operator CLI all write here. Two
  // of them sharing one tmp filename would interleave their bytes and then
  // rename the result over a real account.
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const text = `${JSON.stringify(value, null, 2)}\n`;

  // fsync before the rename, or a power cut can leave an atomic rename onto a
  // file whose bytes never left the page cache -- the exact failure the rename
  // was there to rule out.
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
        throw new AuthError(`could not replace ${file}: ${err.code ?? err.message}`, {
          code: 'WRITE_FAILED', accountId, detail: { file, cause: err.code ?? null },
        });
      }
      sleepSync(delay);
      delay = Math.min(delay * 2, 32);
    }
  }
}

function readJson(file, { missingOk = false } = {}) {
  let delay = 1;
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt += 1) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT' && missingOk) return null;
      if (!TRANSIENT.has(err.code) || attempt === RENAME_ATTEMPTS) throw err;
      sleepSync(delay);
      delay = Math.min(delay * 2, 32);
      continue;
    }
    // A parse failure is never retried: the bytes are wrong, not momentarily
    // unavailable, and spinning on it hides the corruption behind a timeout.
    return JSON.parse(text);
  }
  return null;
}

// ---------------------------------------------------------------------------
// the lock
// ---------------------------------------------------------------------------

/**
 * Exclusive create is the only mutual-exclusion primitive this repo trusts on
 * Windows, and that is a measurement rather than a preference: 16 threads
 * through one barrier, `openSync(path,'wx')` produced exactly one winner in 120
 * of 120 rounds, while `unlinkSync` and `renameSync` produced the wrong number
 * in every round with nearly every caller reporting success. See the WINNER
 * SELECTION comment in scripts/queue/queue.mjs for the full measurement.
 */
function tryExclusiveCreate(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(file, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    // A name in delete-pending state answers EPERM to an exclusive create
    // rather than EEXIST. "Look again shortly" is the honest reading, and a
    // create that did not happen must never be reported as one.
    if (TRANSIENT.has(err.code)) return false;
    throw err;
  }
  try {
    fs.writeFileSync(fd, `${JSON.stringify(body)}\n`);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

/**
 * The lock body, tolerantly. `null` means absent, `undefined` means present but
 * not readable as JSON. Those are different facts and `stealIfStale` treats
 * them differently, so they do not get collapsed -- the same distinction, for
 * the same reason, as the lock reader in scripts/queue/queue.mjs.
 */
function readLock(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Reclaims a lock left behind by a process that died inside the critical
 * section.
 *
 * WHY THE STEAL IS ITSELF EXCLUSIVE. Without this, every waiter decides the
 * lock is stale in the same instant, they all remove it, and they all proceed
 * -- which is the exact bug the lock exists to prevent, arriving through the
 * recovery path. So the right to remove one particular stale lock is claimed by
 * exclusively creating a token named after that lock's own timestamp: exactly
 * one caller creates it, and a second round of staleness gets a different name.
 */
function stealIfStale(file, nowMs) {
  const held = readLock(file);
  if (held === null) return false; // nothing there to steal

  // MEASURED, AND IT COST A RED TEST: a lock is visible and EMPTY for the
  // microsecond between its exclusive create and its first write, so under a
  // real stampede other waiters routinely read zero bytes from it. Parsing that
  // strictly threw `Unexpected end of JSON input` out of a caller that was
  // doing nothing wrong. An unreadable lock is therefore not evidence of
  // anything on its own -- it is either a lock being born or the remains of one
  // whose writer died -- and `mtime` is what tells those two apart without
  // needing the body to be valid.
  let at = Number(held?.at);
  if (!Number.isFinite(at)) {
    try {
      at = fs.statSync(file).mtimeMs;
    } catch {
      return false; // it went away underneath us; somebody else finished
    }
  }
  if (nowMs - at < LOCK_STALE_MS) return false;

  const token = `${file}.steal.${Math.round(at)}`;
  if (!tryExclusiveCreate(token, { at: nowMs, pid: process.pid })) return false;
  try { fs.rmSync(file, { force: true }); } catch { /* the next acquire sees it and tries again */ }
  try { fs.rmSync(token, { force: true }); } catch { /* a leftover token only slows the next steal */ }
  return true;
}

/**
 * Runs `fn` with nobody else inside an update of this account.
 *
 * WHY THIS EXISTS. Without it, load-edit-save from two callers loses one of the
 * two edits, and the one that gets lost is whichever finished first. The edit
 * that matters is `debitCredits`: twelve renders started in the same second each
 * read the same balance, each subtract their own cost from it, and eleven of
 * them are spending credits nobody had. test/auth-credits.test.js fires that
 * race through real OS threads rather than arguing that it is safe.
 *
 * The clock here is the wall clock on purpose. This is a timeout, not a render
 * input, and a test that freezes `nowImpl` must not be able to freeze a waiter
 * into an infinite loop.
 */
export function withAccountLock({ root = REPO_ROOT, accountId }, fn) {
  const paths = accountPaths(root, accountId);
  fs.mkdirSync(paths.dir, { recursive: true });
  const started = Date.now();
  let delay = 0;

  for (;;) {
    if (tryExclusiveCreate(paths.lock, { pid: process.pid, at: Date.now() })) {
      try {
        return fn();
      } finally {
        try { fs.rmSync(paths.lock, { force: true }); } catch { /* stealIfStale will clear it */ }
      }
    }
    stealIfStale(paths.lock, Date.now());
    if (Date.now() - started > LOCK_TIMEOUT_MS) {
      throw new AuthError(`timed out waiting for the lock on account ${accountId}`, {
        code: 'ACCOUNT_LOCKED',
        accountId,
        userMessage: 'We are still finishing your last request. Please try again in a moment.',
      });
    }
    sleepSync(delay);
    delay = Math.min(delay === 0 ? 1 : delay * 2, 16);
  }
}

// ---------------------------------------------------------------------------
// records
// ---------------------------------------------------------------------------

function attach(account, { root, nowImpl }) {
  // Non-enumerable, so `JSON.stringify(account)` is exactly the record on disk
  // and a test can deepEqual a loaded account against a saved one without
  // stripping fields first. Same trick, same reason, as job.mjs.
  const hidden = {
    root: slash(path.resolve(root)),
    paths: accountPaths(root, account.accountId),
    nowImpl: nowImpl ?? defaultNow,
  };
  for (const [key, value] of Object.entries(hidden)) {
    Object.defineProperty(account, key, { value, enumerable: false, writable: true, configurable: true });
  }
  return account;
}

function rootOf(account) {
  if (account?.root) return account.root;
  throw new AuthError(
    'account has no root -- it was built by hand or spread into a plain object; reload it with loadAccount',
    { code: 'NO_ROOT', accountId: account?.accountId ?? null },
  );
}

/**
 * Creates the account.
 *
 * ORDER MATTERS. The record is written first, into a directory named by 16
 * random bytes that nothing can collide with, and the email index entry is
 * claimed second by exclusive create. A crash between the two leaves an orphan
 * record that no login can reach and that `npm run accounts -- list` shows --
 * harmless, and visible. The other order leaves an index entry pointing at
 * nothing, which makes that email address permanently unusable by the person
 * who owns it and looks, from outside, exactly like "your account exists but is
 * broken".
 *
 * `consent` is optional in the signature because docs/interfaces-app.md defines
 * it that way, but the signup page is expected to pass it: this account is about
 * to be used to upload a photograph of somebody's face, and the wording they
 * agreed to is stored verbatim for the reason scripts/safety/consent.mjs
 * explains. A block that IS passed and is not granted is a refusal, not a shrug.
 */
export function createAccount({
  root = REPO_ROOT,
  email,
  password,
  plan = DEFAULT_PLAN_ID,
  consent = null,
  nowImpl = defaultNow,
  rand = crypto,
}) {
  const address = normaliseEmail(email);
  assertUsablePassword(password);
  const planId = assertPlanId(plan);
  const hash = emailHash(address);

  // Cheap pre-check, so the ordinary "already registered" case does not cost an
  // account directory and a scrypt derivation. It is a courtesy, not the
  // guarantee; the exclusive create below is the guarantee.
  if (fs.existsSync(indexPath(root, hash))) throw emailTaken(address);

  const consentBlock = normaliseConsent(consent, nowImpl);
  const at = toDate(nowImpl()).toISOString();
  const accountId = newAccountId({ rand });

  const account = attach({
    schemaVersion: SCHEMA_VERSION,
    accountId,
    email: address,
    emailHash: hash,
    password: hashPassword(password, { rand }),
    plan: planId,
    createdAt: at,
    updatedAt: at,
    // How many times this record has been written. `saveAccount` refuses a write
    // whose `rev` is not the one on disk, which turns a lost update into a loud
    // error even for a caller who forgot `withAccountLock`.
    rev: 0,
    consent: consentBlock,
    // The credit ledger: append-only, and the balance is the sum of its deltas
    // rather than a number stored alongside it. See the header of
    // scripts/auth/credits.mjs for why that is not a stylistic preference.
    //
    // The opening entry is the plan's first grant, written here rather than
    // left to a later call, because an account that exists with no ledger line
    // is an account whose balance is zero for a reason nothing recorded.
    ledger: [{
      at,
      delta: PLANS[planId].creditsPerPeriod,
      jobId: null,
      reason: 'grant:signup',
    }],
  }, { root, nowImpl });

  fs.mkdirSync(account.paths.dir, { recursive: true });
  atomicWriteJson(account.paths.record, account, accountId);

  if (!tryExclusiveCreate(indexPath(root, hash), { accountId })) {
    // Somebody registered this address between the pre-check and here. Remove
    // the record just written: it is unreachable, and its directory name is 16
    // random bytes, so nothing else can possibly be pointing at it.
    try { fs.rmSync(account.paths.dir, { recursive: true, force: true }); } catch { /* orphan, not a leak */ }
    throw emailTaken(address);
  }
  return account;
}

function emailTaken(address) {
  // RESIDUAL, STATED RATHER THAN PAPERED OVER: signup is an enumeration oracle
  // in a way login is not, and the only real fix is a verification email, which
  // this build has no way to send. The wording is kept flat so it reads as "use
  // the other form" rather than as a confirmation. Do not make it more helpful.
  return new AuthError(`an account already exists for ${address}`, {
    code: 'EMAIL_TAKEN',
    userMessage: 'We could not create an account with that email. If you already have one, sign in instead.',
  });
}

function normaliseConsent(consent, nowImpl) {
  if (consent === null || consent === undefined) return null;
  // A block carrying `at` was already recorded by whoever showed the form; one
  // without is a raw `{granted, text}` and goes through `recordConsent`, which
  // is the only thing in this repo allowed to decide what consent looks like.
  // Reused, never reimplemented -- a second consent gate is a second thing to
  // get wrong, in the one place where being wrong is a legal problem.
  if (typeof consent === 'object' && typeof consent.at === 'string') return assertConsent(consent);
  return recordConsent({ granted: consent?.granted, text: consent?.text, nowImpl });
}

export function assertPlanId(planId) {
  if (typeof planId !== 'string' || !Object.hasOwn(PLANS, planId)) {
    throw new AuthError(`unknown plan ${JSON.stringify(planId)}`, {
      code: 'BAD_PLAN',
      userMessage: 'That plan does not exist.',
      detail: { known: PLAN_IDS },
    });
  }
  return planId;
}

export function loadAccount({ root = REPO_ROOT, accountId, nowImpl = defaultNow }) {
  const paths = accountPaths(root, accountId);
  let record;
  try {
    record = readJson(paths.record);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new AuthError(`no account ${accountId} under ${paths.dir}`, {
        code: 'NO_ACCOUNT', accountId, userMessage: 'We could not find that account.',
      });
    }
    throw err;
  }
  if (record.schemaVersion !== SCHEMA_VERSION) {
    throw new AuthError(
      `account ${accountId} has schemaVersion ${record.schemaVersion}, not ${SCHEMA_VERSION}; refusing to guess`,
      { code: 'SCHEMA_VERSION', accountId },
    );
  }
  if (record.accountId !== accountId) {
    // A copied directory with a stale record inside it would otherwise let one
    // person's session read another person's balance.
    throw new AuthError(`record in ${paths.dir} says accountId ${record.accountId}`, {
      code: 'ACCOUNT_ID_MISMATCH', accountId,
    });
  }
  return attach(record, { root, nowImpl });
}

/**
 * Index lookup, then record load. Returns null for "no such account" and throws
 * only for things that are genuinely broken -- a caller on the login path must
 * not be able to tell those two apart, and `authenticate` is what guarantees it
 * cannot.
 */
export function findAccountByEmail({ root = REPO_ROOT, email, nowImpl = defaultNow }) {
  let hash;
  try {
    hash = emailHash(email);
  } catch {
    // An unparseable address cannot have an account, and answering "that is not
    // an email" here would be one more bit than the login form may give away.
    return null;
  }
  const entry = readJson(indexPath(root, hash), { missingOk: true });
  if (!entry || typeof entry.accountId !== 'string') return null;
  try {
    return loadAccount({ root, accountId: entry.accountId, nowImpl });
  } catch (err) {
    // A dangling index entry is the crashed-signup orphan, inverted. Not a
    // login failure worth a stack trace on a public form.
    if (err.code === 'NO_ACCOUNT' || err.code === 'BAD_ACCOUNT_ID') return null;
    throw err;
  }
}

/**
 * Atomic save with an optimistic-concurrency check.
 *
 * The `rev` comparison is what makes a lost update loud. Without it, an operator
 * running `set-plan` while the web process is debiting credits writes a record
 * whose `ledger` is however many seconds old their shell is, and the render the
 * customer just started becomes free. Nothing about that failure is visible
 * afterwards, which is why it is checked rather than commented.
 */
export function saveAccount(account, { root } = {}) {
  if (!account || typeof account !== 'object') {
    throw new AuthError('saveAccount needs an account', { code: 'BAD_ACCOUNT' });
  }
  if (root) attach(account, { root, nowImpl: account.nowImpl });
  const paths = accountPaths(rootOf(account), account.accountId);

  const onDisk = readJson(paths.record, { missingOk: true });
  if (onDisk && onDisk.rev !== account.rev) {
    throw new AuthError(
      `account ${account.accountId} changed underneath this write (disk rev ${onDisk.rev}, held rev ${account.rev})`,
      {
        code: 'STALE_WRITE', accountId: account.accountId,
        userMessage: 'Your account was updated somewhere else. Please try again.',
      },
    );
  }

  account.rev = (account.rev ?? 0) + 1;
  account.updatedAt = toDate((account.nowImpl ?? defaultNow)()).toISOString();
  atomicWriteJson(paths.record, account, account.accountId);
  return account;
}

/**
 * Load, mutate, save, with the lock held across all three.
 *
 * Every mutation in this module and in credits.mjs comes through here. The mutator
 * is handed a FRESHLY LOADED account rather than the caller's copy on purpose:
 * the caller's copy may be seconds old, and "seconds old" is the whole of the
 * bug.
 */
export function updateAccount({ root = REPO_ROOT, accountId, nowImpl = defaultNow }, mutator) {
  return withAccountLock({ root, accountId }, () => {
    const fresh = loadAccount({ root, accountId, nowImpl });
    const outcome = mutator(fresh);
    saveAccount(fresh);
    return { account: fresh, outcome };
  });
}

/** Copies the persisted fields of `fresh` onto `stale`, so a caller still
 *  holding the old object does not go on lying about a balance it no longer has.
 *  Hidden fields (`root`, `paths`, `nowImpl`) are left alone: they belong to
 *  this process, not to the record. */
export function refreshAccount(stale, fresh) {
  if (!stale || !fresh || stale === fresh) return stale;
  for (const key of Object.keys(stale)) if (!Object.hasOwn(fresh, key)) delete stale[key];
  Object.assign(stale, JSON.parse(JSON.stringify(fresh)));
  return stale;
}

/**
 * Sets the plan in memory. The caller saves, exactly as the job model's step
 * mutators leave `saveJob` to the caller.
 *
 * NOT REACHABLE FROM A FORM, and that is the money rule rather than an
 * implementation detail: a plan is changed by the operator CLI or, later, by a
 * webhook from a hosted checkout. There is no path from an HTTP request body to
 * this function and there must not be one, because the only thing standing
 * between "choose your plan" and "give yourself the paid plan" would be
 * somebody remembering to check.
 */
export function setPlan(account, planId) {
  account.plan = assertPlanId(planId);
  return account;
}

/** The plan object, falling back to free for a record whose plan id this build
 *  does not recognise. Falling back downward is deliberate; see
 *  DEFAULT_PLAN_ID. */
export function planFor(account) {
  const id = account?.plan;
  return Object.hasOwn(PLANS, id) ? PLANS[id] : PLANS[DEFAULT_PLAN_ID];
}

/**
 * Every account under `root`, oldest first.
 *
 * A directory whose record cannot be read is skipped rather than thrown on: one
 * corrupt account must not be able to hide the other two hundred from the
 * operator, and `loadAccount` on that id still says exactly what is wrong.
 */
export function listAccounts({ root = REPO_ROOT, nowImpl = defaultNow } = {}) {
  const { dir } = accountsRoot(root);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !ACCOUNT_ID_RE.test(entry.name)) continue;
    try {
      out.push(loadAccount({ root, accountId: entry.name, nowImpl }));
    } catch { /* skipped deliberately -- see the comment above */ }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/**
 * The login path. One error, one message, one cost, whatever went wrong.
 *
 * The two branches below must stay the same shape. If somebody later adds an
 * early return on the unknown-email path to "save a pointless scrypt call",
 * they will have reintroduced the enumeration oracle, and the test that catches
 * it is the one asserting both branches take comparable time.
 */
export function authenticate({ root = REPO_ROOT, email, password, nowImpl = defaultNow }) {
  const account = findAccountByEmail({ root, email, nowImpl });
  if (account === null) {
    burnEqualWork(password);
    throw badCredentials();
  }
  if (!verifyPassword(account, password)) throw badCredentials();
  return account;
}

function badCredentials() {
  return new AuthError('email not found or password did not verify', {
    code: 'BAD_CREDENTIALS',
    userMessage: BAD_CREDENTIALS_MESSAGE,
  });
}
