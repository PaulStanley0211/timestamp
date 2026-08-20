/**
 * Sessions. An opaque random id in a signed cookie, and a record on disk that
 * says whose it is.
 *
 * WHY NOT A JWT. A JWT cannot be revoked. It is a signed claim that the holder
 * is somebody, valid until it expires, and the server that issued it has no say
 * in the matter afterwards -- logging out deletes the browser's copy and
 * nothing else, so a token copied out of a shared machine, a screenshot, a
 * proxy log or a browser extension keeps working. For an app whose result page
 * is a video of a real person's face, "log out" has to mean the credential is
 * dead, not that it was politely discarded. A row on disk can be deleted; a
 * signature cannot be un-signed. There is a test that destroys a session and
 * proves it is dead on the very next read.
 *
 * WHY THE COOKIE IS SIGNED WHEN THE ID IS ALREADY UNGUESSABLE. 32 random bytes
 * are not going to be guessed. The HMAC is not there to make the id stronger,
 * it is there so that a request carrying invented rubbish is rejected by a
 * comparison in memory instead of by a filesystem lookup. Without it, anyone
 * can make this process do a `readFileSync` per request forever, and every one
 * of those reads is a path built from a string a stranger sent us. With it, the
 * path is only ever built from a value we ourselves signed.
 *
 * WHY THE SECRET IS A FILE AND WHY IT IS CREATED EXCLUSIVELY. It has to survive
 * a restart or every restart logs everybody out. It must be generated exactly
 * once: if the web process and a worker both start on a fresh install and both
 * "generate a secret if missing", the second write silently invalidates every
 * cookie the first one signed, and the symptom is users being randomly logged
 * out with nothing in any log. An exclusive create is the only thing on Windows
 * that makes "exactly once" true rather than likely -- `rename` REPLACES its
 * destination and `unlink` is not exclusive either, so neither of them can
 * decide a winner; see the WINNER SELECTION comment in scripts/queue/queue.mjs.
 *
 * WHY THE CREATE GOES THROUGH A HARD LINK. Exclusive create alone is not
 * enough, and this file learned that the expensive way. `openSync(path,'wx')`
 * makes the NAME first and the CONTENT after, so between the two there is a
 * file that exists and is empty. A peer scheduled into that gap read it, found
 * nothing usable, concluded "present but corrupt" and DELETED it -- out from
 * under the winner, mid-write -- then generated a second secret of its own. Two
 * processes, two keys, and every cookie the first had already signed became
 * unverifiable: every logged-in user thrown out at once, with nothing in any
 * log. Nor is the window narrow; eight threads with no load at all disagreed in
 * 5 rounds of 30. Writing the secret to a temporary file and hard-linking it
 * into place closes it: `linkSync` fails EEXIST rather than replacing, so it
 * still picks the winner, and it makes the name and the contents appear in the
 * same instant. queue.mjs reached the same conclusion from the same
 * measurements after the identical bug cost it ~3.5% of jobs in a stampede.
 *
 * WHY A ZERO-BYTE SECRET IS NOT AUTOMATICALLY A CORPSE. On a filesystem with no
 * hard links the fallback is `wx` again and the gap comes back, so the reader
 * side carries the second guard: a file of zero bytes whose timestamp is
 * moments old is a peer between its create and its write, and it is waited for,
 * not reaped. Only a file with unusable CONTENTS, or a zero-byte one old enough
 * that nobody is coming, may be removed. "Unreadable" and "dead" are different
 * facts, and collapsing them is precisely what caused the bug above.
 *
 * WHY THE COOKIE FLAGS ARE NOT NEGOTIABLE. `HttpOnly` keeps the id out of
 * `document.cookie`, so one injected script cannot walk off with everyone's
 * login. `SameSite=Lax` means another site cannot cause an authenticated POST
 * from a logged-in browser -- which here would be somebody else's site
 * enqueuing renders against this user's quota. `Path=/` because the id is for
 * the whole app. `Secure` is set when, and only when, the request actually
 * arrived over TLS: hard-coding it on breaks local development over http, and
 * hard-coding it off ships a login cookie that travels in clear text.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path
  .resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  .replace(/\\/g, '/');

export const SCHEMA_VERSION = 1;

export const SESSIONS_DIR = 'out/sessions';

/** Underscore-prefixed, and every listing filters on `.json`, so the secret can
 *  never be mistaken for a session record by a sweep. */
export const SECRET_FILE = '_secret';

/** The cookie name. Exported so the web layer and the tests cannot drift into
 *  two spellings of it. */
export const SESSION_COOKIE = 'timestamp_session';

/** 32 bytes, as specified. That is 256 bits of `randomBytes`; the id is the
 *  credential, so it comes from the CSPRNG and never from a counter, a
 *  timestamp or a hash of anything about the user. */
export const SESSION_ID_BYTES = 32;
export const SESSION_ID_RE = /^[0-9a-f]{64}$/;

/** Fourteen days. Long enough that people are not signing in every morning,
 *  short enough that a laptop sold with a browser profile on it stops being a
 *  way into somebody's photographs within a fortnight. */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const SECRET_BYTES = 32;

/** How long a zero-byte secret file may still be believed to be a write in
 *  progress rather than a corpse. It has to cover the gap between the `wx`
 *  create and the write that follows it, and it is only reachable at all on a
 *  filesystem with no hard links -- everywhere else the two commit together.
 *  Two seconds is orders of magnitude more than that gap has ever measured,
 *  and it is paid only by a file that turns out to be genuinely dead. */
const SECRET_NEWBORN_MS = 2_000;
const SECRET_POLL_MS = 5;

const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** A filesystem with no hard links: a network share, or FAT. */
const NO_HARDLINK = new Set(['ENOSYS', 'EXDEV', 'EMLINK', 'ENOTSUP', 'EOPNOTSUPP', 'EINVAL']);

/** Blocks the thread. `sessionSecret` is synchronous by design -- it is called
 *  from the request path, where the caller needs the key in hand -- so waiting
 *  for a peer's contents to land cannot be a promise. */
const pause = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

const defaultNow = () => new Date();
const slash = (p) => p.replace(/\\/g, '/');

export class SessionError extends Error {
  constructor(message, { code = 'SESSION_ERROR', userMessage, detail = null } = {}) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
    // Same split as AuthError: `.message` for a log, `.userMessage` for a
    // stranger. Nothing in here may name a path or a session id.
    this.userMessage = userMessage ?? 'Please sign in again.';
    this.detail = detail;
  }
}

function toDate(value) {
  const d = value instanceof Date ? value : new Date(Number(value));
  if (Number.isNaN(d.getTime())) {
    throw new SessionError(`nowImpl returned ${String(value)}; it must return a Date or epoch milliseconds`, {
      code: 'BAD_CLOCK',
    });
  }
  return d;
}

export function sessionsRoot(root = REPO_ROOT) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new SessionError('root must be a non-empty string', { code: 'BAD_ROOT' });
  }
  const dir = slash(path.resolve(root, SESSIONS_DIR));
  return { dir, secret: `${dir}/${SECRET_FILE}` };
}

/**
 * Validated before it is ever concatenated into a path. A session id arrives in
 * a cookie, which is a string a stranger controls, and the whole class of
 * path-traversal bug is avoided by refusing anything that is not 64 hex
 * characters rather than by trying to sanitise what was sent.
 */
export function isValidSessionId(sessionId) {
  return typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId);
}

export function sessionPath(root, sessionId) {
  const { dir } = sessionsRoot(root);
  if (!isValidSessionId(sessionId)) {
    throw new SessionError(`unusable session id ${JSON.stringify(sessionId)}`, { code: 'BAD_SESSION_ID' });
  }
  return `${dir}/${sessionId}.json`;
}

// ---------------------------------------------------------------------------
// the secret
// ---------------------------------------------------------------------------

/**
 * The HMAC key, generated once and read thereafter.
 *
 * Mode 0o600 is requested and is honoured on POSIX; on Windows the bit is
 * largely decorative and the real protection is NTFS inheritance on the repo
 * directory. Asking anyway costs one argument and means the file is not
 * world-readable the day this runs on a Linux host, which it eventually will.
 *
 * Deliberately not cached in a module variable. The read is a few microseconds
 * against a page-cached 64-byte file, and a cache would mean that rotating the
 * secret -- deleting the file to log everybody out, which is the emergency
 * lever -- appeared to do nothing until every process was restarted.
 */
export function sessionSecret({ root = REPO_ROOT } = {}) {
  const { dir, secret } = sessionsRoot(root);
  fs.mkdirSync(dir, { recursive: true });

  // Bounded, because every trip round this loop either returns or removes a
  // corpse, and a loop that could spin forever on a filesystem problem is worse
  // than an error that names it.
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const existing = readSecret(secret);
    if (existing !== null) return existing;

    const generated = crypto.randomBytes(SECRET_BYTES).toString('hex');
    const outcome = publishSecret(secret, generated);
    if (outcome === 'created') return generated;
    // A name in delete-pending state answers EPERM to an exclusive create
    // rather than EEXIST. Nothing has been decided either way; look again.
    if (outcome === 'blocked') continue;

    // Somebody else owns the name. Theirs is the one that counts -- the loser
    // of this race adopts the winner's secret rather than overwriting it, or
    // every cookie the winner has already signed dies.
    const after = adoptOrCondemn(secret);
    if (after !== null) return after;

    // Condemned, which is a stronger statement than "did not parse": present,
    // unusable, and provably not a write in progress. An empty or truncated
    // secret is worse than a missing one because it would "work" while being
    // guessable, so removing it is the fix -- and the right to remove it is
    // claimed by exclusive create for the same reason the account lock steals
    // that way, since otherwise every caller deletes it at once and each of
    // them then writes a different secret over the others.
    claimAndRemove(secret);
  }
  throw new SessionError(`could not establish a session secret at ${secret}`, { code: 'NO_SECRET' });
}

/**
 * Put `value` at `file`, or lose the race trying.
 *
 * The create goes through a hard link, for the reason set out in the header:
 * `openSync(file,'wx')` makes the NAME first and the CONTENT after, and a peer
 * scheduled into that gap sees a file that exists and holds nothing. Writing
 * the contents to a temporary file and linking that into place makes the name
 * and the secret appear in the same instant, so there is no gap to be scheduled
 * into. `linkSync` still decides the winner -- it fails EEXIST rather than
 * replacing, which is exactly what `renameSync` does NOT do on NTFS -- and it
 * commits the contents in the same operation.
 *
 * The `wx` fallback is for a filesystem with no hard links. It is exclusive
 * too, so winner selection stays correct there; only the atomicity of the
 * contents is lost, which is why `adoptOrCondemn` separately refuses to condemn
 * a zero-byte file that is young.
 *
 * @returns {'created'} this call, and only this call, brought the file into being
 * @returns {'exists'}  somebody else owns the name
 * @returns {'blocked'} Windows would not let us try; nothing has been decided
 */
function publishSecret(file, value) {
  const data = `${value}\n`;
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    let fd;
    try {
      fd = fs.openSync(tmp, 'wx', 0o600);
    } catch (err) {
      if (TRANSIENT.has(err.code)) return 'blocked';
      throw err;
    }
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.linkSync(tmp, file);
      return 'created';
    } catch (err) {
      if (err.code === 'EEXIST') return 'exists'; // somebody else got there first
      if (TRANSIENT.has(err.code)) return 'blocked';
      if (!NO_HARDLINK.has(err.code)) throw err;
    }
  } finally {
    // A leftover temporary is inert: it is not `_secret`, and every listing in
    // this module filters on `.json`, so nothing can mistake it for a record.
    try { fs.rmSync(tmp, { force: true }); } catch { /* the next call names a new one */ }
  }

  // No hard links on this filesystem. Exclusive still, so the winner is still
  // decided here; the contents just arrive a moment after the name does.
  let fd;
  try {
    fd = fs.openSync(file, 'wx', 0o600);
  } catch (err) {
    if (err.code === 'EEXIST') return 'exists';
    if (TRANSIENT.has(err.code)) return 'blocked';
    throw err;
  }
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return 'created';
}

/**
 * Wait for a peer's secret to land, or establish that nothing is coming.
 *
 * The distinction drawn here is the whole point, and collapsing it is what this
 * file got wrong: a file that exists and does not parse is not thereby dead. A
 * ZERO-BYTE file whose timestamp is moments old is a peer sitting between its
 * create and its write -- newborn, and emphatically alive -- and deleting it
 * destroys the key that peer is about to start signing cookies with. The same
 * file with contents in it is a corpse, because a writer that got as far as
 * writing produced everything it was ever going to produce; and a zero-byte one
 * that is old enough is a corpse too, because nobody is coming for it.
 *
 * THE STAT IS TAKEN BEFORE THE READ, and that order is load-bearing. Taken
 * after, it reports a size that is NEWER than the bytes just read, so a peer
 * whose write lands in between is condemned on the evidence of its own success:
 * the read returns nothing, the stat then says 65 bytes, and "unusable
 * contents" is concluded about contents that are perfectly good and were merely
 * read a microsecond early. Measured under a loaded disk that lost 2 races in
 * 12 -- the same shape of mistake as the bug this function exists to prevent,
 * one level down. Statting first makes `size > 0` mean "it already had contents
 * when we read it", which is the only reading that justifies condemning it.
 *
 * Bounded twice over: by our own elapsed wait, and by the file's age. The first
 * is what stops a clock-skewed network share parking a request forever.
 *
 * @returns {string} the peer's secret, to be adopted
 * @returns {null}   nothing usable at that name, and nothing on its way
 */
function adoptOrCondemn(file) {
  const deadline = Date.now() + SECRET_NEWBORN_MS;
  for (;;) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return null; // it went away -- the emergency lever, or a peer reaping it
    }

    const value = readSecret(file);
    if (value !== null) return value;
    if (stat.size > 0) return null; // it had contents before we read, and they are unusable

    const now = Date.now();
    if (now >= deadline || now - stat.mtimeMs >= SECRET_NEWBORN_MS) return null;
    pause(SECRET_POLL_MS);
  }
}

/** Exclusive create of a token, then remove the file it names. The only
 *  mutual-exclusion primitive this repo trusts on Windows is `openSync(_,'wx')`
 *  -- see the WINNER SELECTION comment in scripts/queue/queue.mjs.
 *
 *  Only ever called on a file `adoptOrCondemn` has condemned. Reaching it for a
 *  file that is merely young is the bug this module was carrying. */
function claimAndRemove(file) {
  const token = `${file}.replace`;
  let fd;
  try {
    fd = fs.openSync(token, 'wx');
  } catch {
    return false; // somebody else is already replacing it
  }
  fs.closeSync(fd);
  try { fs.rmSync(file, { force: true }); } catch { /* the next attempt sees it */ }
  try { fs.rmSync(token, { force: true }); } catch { /* a leftover token only slows the next replace */ }
  return true;
}

function readSecret(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const value = text.trim();
  // An empty or truncated secret file is worse than a missing one: it would
  // "work", signing every cookie with a key an attacker can guess. Treat it as
  // absent so the caller regenerates, which invalidates existing sessions --
  // the correct trade when the alternative is a forgeable signature.
  return value.length >= SECRET_BYTES ? value : null;
}

// ---------------------------------------------------------------------------
// cookie signing
// ---------------------------------------------------------------------------

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function mac(value, secret) {
  return b64url(crypto.createHmac('sha256', secret).update(value, 'utf8').digest());
}

/** `<value>.<mac>`. The value stays readable on purpose: it is not a secret
 *  from the person holding it, it is a secret from everybody else, and hiding
 *  it would only make debugging harder without making anything safer. */
export function signCookie(value, secret) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SessionError('signCookie needs a non-empty value', { code: 'BAD_COOKIE_VALUE' });
  }
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new SessionError('signCookie needs a secret', { code: 'NO_SECRET' });
  }
  return `${value}.${mac(value, secret)}`;
}

/**
 * The value, or null. Never throws on bad input -- a malformed cookie is the
 * normal state of the internet, not an exceptional one.
 *
 * `timingSafeEqual` again, and for the same reason it is used on passwords: a
 * byte-at-a-time compare of the MAC would let an attacker discover a valid
 * signature for a value of their choosing one byte at a time. The length check
 * before it is not a leak -- the MAC length is a public constant -- but it is
 * required, because `timingSafeEqual` throws on mismatched lengths.
 */
export function verifyCookie(signed, secret) {
  if (typeof signed !== 'string' || typeof secret !== 'string' || secret.length === 0) return null;
  const cut = signed.lastIndexOf('.');
  if (cut <= 0 || cut === signed.length - 1) return null;

  const value = signed.slice(0, cut);
  const presented = Buffer.from(signed.slice(cut + 1), 'utf8');
  const expected = Buffer.from(mac(value, secret), 'utf8');
  if (presented.length !== expected.length) return null;
  return crypto.timingSafeEqual(presented, expected) ? value : null;
}

// ---------------------------------------------------------------------------
// records
// ---------------------------------------------------------------------------

/**
 * Mints a session and writes the record before the caller can hand out the id.
 *
 * Exclusive create rather than a plain write. A collision on 32 random bytes is
 * not going to happen, but if it ever did, the failure mode of a plain write is
 * that one person silently inherits another person's session, and this app's
 * sessions are the difference between a stranger and the person in the
 * photograph. Refusing costs nothing and cannot be wrong.
 */
export function createSession({ root = REPO_ROOT, accountId, ttlMs = SESSION_TTL_MS, nowImpl = defaultNow }) {
  if (typeof accountId !== 'string' || accountId.length === 0) {
    throw new SessionError('createSession needs an accountId', { code: 'BAD_ACCOUNT_ID' });
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new SessionError(`ttlMs must be a positive number, got ${ttlMs}`, { code: 'BAD_CONFIG' });
  }
  const { dir } = sessionsRoot(root);
  fs.mkdirSync(dir, { recursive: true });

  const startedAt = toDate(nowImpl());
  const sessionId = crypto.randomBytes(SESSION_ID_BYTES).toString('hex');
  const expiresAt = new Date(startedAt.getTime() + ttlMs).toISOString();
  const record = {
    schemaVersion: SCHEMA_VERSION,
    sessionId,
    accountId,
    createdAt: startedAt.toISOString(),
    expiresAt,
  };
  // Nothing else is stored. An IP address and a user agent would be a small
  // convenience for support and a permanent record of where a named person was
  // sitting; this service already holds their face.

  const file = sessionPath(root, sessionId);
  let fd;
  try {
    fd = fs.openSync(file, 'wx');
  } catch (err) {
    throw new SessionError(`could not create session record ${file}: ${err.code ?? err.message}`, {
      code: 'WRITE_FAILED',
    });
  }
  try {
    fs.writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return { sessionId, expiresAt, accountId, createdAt: record.createdAt };
}

/**
 * The session, or null.
 *
 * null for missing, null for expired, null for a record this build cannot read.
 * Every one of those means the same thing to the caller -- "this request is not
 * signed in" -- and collapsing them here is what stops a caller from acting on
 * an expired session because it forgot to compare a date.
 */
export function readSession({ root = REPO_ROOT, sessionId, nowImpl = defaultNow }) {
  if (!isValidSessionId(sessionId)) return null;
  let text;
  try {
    text = fs.readFileSync(sessionPath(root, sessionId), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    return null;
  }
  if (record?.schemaVersion !== SCHEMA_VERSION) return null;
  if (record.sessionId !== sessionId) return null;
  const expires = Date.parse(record.expiresAt);
  if (!Number.isFinite(expires) || toDate(nowImpl()).getTime() >= expires) return null;
  return record;
}

/**
 * Deletes the record. This is what makes logout mean something, so it is not
 * allowed to be best-effort: a delete that quietly failed would leave a
 * credential alive that the person believes they have destroyed.
 *
 * Missing is success -- logging out twice is not an error, and neither is
 * logging out of a session that has already been swept.
 */
export function destroySession({ root = REPO_ROOT, sessionId }) {
  if (!isValidSessionId(sessionId)) return false;
  const file = sessionPath(root, sessionId);
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      fs.rmSync(file);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      if (!TRANSIENT.has(err.code) || attempt === 12) {
        throw new SessionError(`could not destroy session: ${err.code ?? err.message}`, {
          code: 'DESTROY_FAILED',
        });
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt);
    }
  }
  return false;
}

/**
 * Every session belonging to one account, destroyed.
 *
 * This is the lever for "somebody else has my password" and for a password
 * change, and it is the reason sessions are server-side records at all. Without
 * it the honest answer to a compromised account is "wait a fortnight".
 */
export function destroySessionsForAccount({ root = REPO_ROOT, accountId }) {
  let killed = 0;
  for (const record of listSessions({ root })) {
    if (record.accountId !== accountId) continue;
    if (destroySession({ root, sessionId: record.sessionId })) killed += 1;
  }
  return killed;
}

/** Every readable session record. Unreadable files are skipped rather than
 *  thrown on: one corrupt record must not be able to break a logout-everywhere
 *  or a sweep. */
export function listSessions({ root = REPO_ROOT } = {}) {
  const { dir } = sessionsRoot(root);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const sessionId = name.slice(0, -5);
    if (!isValidSessionId(sessionId)) continue;
    try {
      const record = JSON.parse(fs.readFileSync(`${dir}/${name}`, 'utf8'));
      if (record?.sessionId === sessionId) out.push(record);
    } catch { /* skipped deliberately */ }
  }
  return out;
}

/** Expired records are already dead to `readSession`; this is the housekeeping
 *  that stops the directory growing forever. Returns how many were removed so a
 *  CLI can say something true. */
export function sweepExpiredSessions({ root = REPO_ROOT, nowImpl = defaultNow } = {}) {
  const now = toDate(nowImpl()).getTime();
  let swept = 0;
  for (const record of listSessions({ root })) {
    const expires = Date.parse(record.expiresAt);
    if (Number.isFinite(expires) && now < expires) continue;
    if (destroySession({ root, sessionId: record.sessionId })) swept += 1;
  }
  return swept;
}

// ---------------------------------------------------------------------------
// the HTTP edge
// ---------------------------------------------------------------------------

/**
 * `Cookie:` header to an object. Written here rather than in the web layer so
 * that the parsing of the one header that carries a credential has exactly one
 * implementation.
 *
 * Later values do not overwrite earlier ones. A browser sends the most specific
 * cookie first, and an attacker who can set a cookie on a wider path or a
 * parent domain would otherwise be able to shadow the real session by appending
 * a second one with the same name.
 */
export function parseCookies(header) {
  const out = Object.create(null);
  if (typeof header !== 'string' || header.length === 0) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name.length === 0 || Object.hasOwn(out, name)) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value; // a cookie we did not write; keep the bytes as sent
    }
  }
  return out;
}

/**
 * Whether this request actually arrived over TLS.
 *
 * `x-forwarded-proto` is a header, which means it is whatever the client typed
 * unless something trusted rewrote it. Believing it by default would let anyone
 * turn `Secure` on or off by asking, so `trustProxy` is opt-in and belongs to
 * whoever configured the deployment, not to the request.
 */
export function isSecureRequest(req, { trustProxy = false } = {}) {
  if (req?.socket?.encrypted === true) return true;
  if (!trustProxy) return false;
  const header = req?.headers?.['x-forwarded-proto'];
  const first = String(Array.isArray(header) ? header[0] : header ?? '').split(',')[0].trim().toLowerCase();
  return first === 'https';
}

/**
 * The `Set-Cookie` value for a fresh login.
 *
 * `Max-Age` is derived from the session's own `expiresAt` rather than passed
 * separately, so the browser's copy and the server's record cannot disagree
 * about when this ends. The browser's expiry is a courtesy anyway: the record
 * is the authority, and a cookie that outlives its record simply stops working.
 */
export function sessionCookie({ sessionId, secret, expiresAt, secure = false, sameSite = 'Lax', nowImpl = defaultNow }) {
  if (!isValidSessionId(sessionId)) {
    throw new SessionError('sessionCookie needs a valid session id', { code: 'BAD_SESSION_ID' });
  }
  const signed = signCookie(sessionId, secret);
  const attrs = [`${SESSION_COOKIE}=${signed}`, 'Path=/', 'HttpOnly', `SameSite=${sameSite}`];
  if (expiresAt) {
    const ms = Date.parse(expiresAt) - toDate(nowImpl()).getTime();
    attrs.push(`Max-Age=${Math.max(0, Math.floor(ms / 1000))}`);
  }
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

/** The `Set-Cookie` value for a logout. The attributes must match the ones the
 *  cookie was set with or the browser keeps the original alongside this one and
 *  the user stays signed in -- which, given `destroySession` has already run,
 *  would look like a broken app rather than the security hole it is not. */
export function clearedSessionCookie({ secure = false, sameSite = 'Lax' } = {}) {
  const attrs = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', `SameSite=${sameSite}`, 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

/**
 * The whole read path in one call, and the order inside it is the point.
 *
 * Signature first, filesystem second. A request carrying an invented cookie is
 * rejected by one HMAC in memory, and the path passed to `readFileSync` is only
 * ever a string this server signed. Any caller that reverses these two lines
 * has given a stranger a filesystem lookup per request, so this exists to make
 * "verify then load" a single function rather than a convention.
 */
export function readSessionFromCookie({
  root = REPO_ROOT, cookieHeader, secret, nowImpl = defaultNow,
}) {
  const key = secret ?? sessionSecret({ root });
  const raw = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const sessionId = verifyCookie(raw, key);
  if (sessionId === null) return null;
  return readSession({ root, sessionId, nowImpl });
}
