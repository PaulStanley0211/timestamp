/**
 * The seam between the HTTP layer and `scripts/auth/`.
 *
 * WHY THIS FILE EXISTS AT ALL, RATHER THAN THE SERVER IMPORTING `auth/`
 * DIRECTLY. Three reasons, and the third is the one that mattered while this was
 * being written.
 *
 *   1. Cookies are an HTTP concern and `scripts/auth/` is deliberately not an
 *      HTTP module -- it signs a value and verifies a value, and it should not
 *      have to know what `SameSite` is. The cookie header parsing, the `Secure`
 *      decision and the expiry attributes belong on this side of the seam.
 *   2. Ownership -- which account may see which job -- is a *web* fact. The job
 *      model's `normalizeInput` returns a fixed shape and silently drops fields
 *      it does not know, so an `accountId` written into `job.input` would
 *      vanish on the next `saveJob` and the ownership check would start passing
 *      for everybody. `scripts/render/job.mjs` is out of scope to change, so the
 *      index lives here, beside the layer that enforces it.
 *   3. `scripts/auth/` was being written in parallel with this file and did not
 *      exist yet. So the import is lazy and injectable: the server passes an
 *      `auth` object if it has one, otherwise the modules are imported on first
 *      use, and if they are genuinely absent every gated route answers a plain
 *      503 instead of an unhandled rejection that takes the process down.
 *
 * WHY OWNERSHIP IS AN INDEX AND NOT A SCAN. `out/owners/<accountId>/<jobId>` is
 * a file whose *existence* is the answer, so "may this account see this job" is
 * one `statSync` and "what is on this account's shelf" is one `readdirSync`. The
 * alternative -- reading every manifest under `out/jobs` and comparing an owner
 * field -- gets slower with every job anybody ever made, and the shelf is on the
 * home page.
 *
 * WHY A MISSING INDEX ENTRY MEANS NO. A job with no owner file is a job nobody
 * owns, and nobody can see it. That is the direction a mistake here has to fail
 * in: the alternative default hands one stranger's face to another.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The session cookie.
 *
 * `scripts/auth/session.mjs` owns the name and the `Set-Cookie` builders, and
 * this layer defers to them when they are there -- two modules writing two
 * cookie names is a bug that only shows up as "logging in does nothing". This
 * constant is the fallback used when the auth module is not loaded yet, and the
 * name is deliberately the same one it exports.
 */
export const SESSION_COOKIE = 'timestamp_session';

/** Thirty days, matching a session record that `createSession` is expected to
 *  expire on its own. The cookie `Max-Age` is a hint to the browser; the
 *  server-side record is what actually decides, which is the entire reason
 *  sessions are opaque ids and not JWTs. */
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

/** Account ids come out of a session record we wrote, but they are about to
 *  become a path component, and "it came from us" is how directory traversal
 *  gets written every time. */
export const ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The anti-forgery cookie for the two routes that ESTABLISH a session.
 *
 * `SameSite=Lax` on the session cookie stops a foreign page acting AS a
 * session; it does nothing to stop a foreign page CREATING one, because the
 * login post needs no cookie at all. So `/login` and `/signup` demand a signed
 * value that arrives twice -- once in this cookie, which a foreign origin
 * cannot set, and once in a hidden field, which a foreign origin cannot read.
 * A page that auto-submits somebody's credentials can supply neither half.
 */
export const CSRF_COOKIE = 'timestamp_csrf';

export class AuthUnavailableError extends Error {
  constructor(cause) {
    super('the accounts module is not available');
    this.name = 'AuthUnavailableError';
    this.code = 'AUTH_UNAVAILABLE';
    this.cause = cause ?? null;
  }
}

// ---------------------------------------------------------------------------
// cookies
// ---------------------------------------------------------------------------

/**
 * Parse a `Cookie:` header.
 *
 * Tolerant on purpose: a browser will happily send a cookie set by something
 * else on the same host with a value we cannot decode, and throwing on it would
 * log everybody out because of an unrelated cookie.
 */
export function parseCookies(header) {
  const out = Object.create(null);
  if (typeof header !== 'string' || header.length === 0) return out;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 1) continue;
    const name = pair.slice(0, eq).trim();
    if (!name) continue;
    const raw = pair.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

/**
 * Build a `Set-Cookie` value.
 *
 * `HttpOnly` because a script has no business reading this: an XSS that can read
 * the session cookie can be somebody else for a month. `SameSite=Lax` because
 * the app has exactly one cross-site entry point that matters -- a link someone
 * pastes -- and `Strict` would log them out of it. `Secure` only when the
 * request actually arrived over TLS, because setting it on plain HTTP means the
 * browser silently discards the cookie and local development stops working with
 * no error anywhere.
 */
export function serializeCookie(name, value, { maxAge = null, secure = false, expires = null } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  if (maxAge !== null) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (expires) parts.push(`Expires=${expires}`);
  return parts.join('; ');
}

/** Did this request arrive over TLS? Behind a proxy the socket is plain, so the
 *  forwarded header is the only evidence -- and it is only believed for the
 *  literal value `https`, never for anything that merely contains it. */
export function isSecureRequest(req) {
  if (req?.socket?.encrypted) return true;
  const proto = String(req?.headers?.['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

// ---------------------------------------------------------------------------
// the auth modules
// ---------------------------------------------------------------------------

/**
 * The shape this file needs from `scripts/auth/`, mirrored from
 * `docs/interfaces-app.md` §A. Listed rather than assumed, so that a partially
 * written module fails with the name of the function it is missing instead of
 * `undefined is not a function` three frames down.
 */
export const REQUIRED_AUTH = Object.freeze([
  'createAccount', 'findAccountByEmail', 'verifyPassword', 'loadAccount', 'saveAccount',
  'createSession', 'readSession', 'destroySession', 'signCookie', 'verifyCookie', 'sessionSecret',
  // Credits, not a tape quota. `scripts/auth/quota.mjs` was renamed to
  // `credits.mjs` on 2026-08-20 when the flat "N tapes a month" model was
  // dropped: a plan priced on a 6x cost spread between resolutions is a guess
  // with a price tag on it, so the unit the user spends is a credit and the
  // price of a tape is computed from the resolution it is rendered at.
  'creditCost', 'balanceOf', 'debitCredits', 'refundCredits',
  // ADDED 2026-08-25 WITH THE STRIPE WEBHOOK. It is in this list rather than
  // called optimistically because the caller is the one route in the app that
  // is holding somebody's money: a `grantCredits` that is missing must fail as
  // "the accounts module is not available", which Stripe retries, and never as
  // `undefined is not a function` inside a handler that has already answered.
  'grantCredits',
  // `authenticate` returns the SAME error and the same message for an unknown
  // email and a wrong password, and burns equal work either way. The web layer
  // renders what it is given rather than deciding for itself, because the two
  // cases being distinguishable is an account-enumeration oracle.
  'authenticate',
]);

/** Constants, checked separately from functions because `typeof` differs. The
 *  quality row is built out of `CREDIT_COSTS` and the plans page out of
 *  `PLANS`; neither can be a function call. */
export const REQUIRED_AUTH_VALUES = Object.freeze(['PLANS', 'CREDIT_COSTS']);

/**
 * Import the three auth modules and flatten them into one object.
 *
 * Lazy and memoised. `scripts/auth/` may not exist when this module is loaded --
 * it is being written against §A in parallel -- and a top-level import of a
 * missing file is a startup crash rather than a degraded feature.
 */
export async function loadAuth({ base = '../auth' } = {}) {
  const [accounts, session, credits] = await Promise.all([
    import(`${base}/accounts.mjs`),
    import(`${base}/session.mjs`),
    import(`${base}/credits.mjs`),
  ]);
  return { ...accounts, ...session, ...credits };
}

/** Which of the documented functions this object is actually missing. */
export function missingAuthFunctions(auth) {
  if (!auth || typeof auth !== 'object') return [...REQUIRED_AUTH, ...REQUIRED_AUTH_VALUES];
  return [
    ...REQUIRED_AUTH.filter((name) => typeof auth[name] !== 'function'),
    ...REQUIRED_AUTH_VALUES.filter((name) => auth[name] === undefined || auth[name] === null),
  ];
}

// ---------------------------------------------------------------------------
// the middleware
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.root         data root; `out/sessions` and `out/owners` live under it
 * @param {object} [opts.auth]       an injected auth object; omit to import `scripts/auth/`
 * @param {Function} [opts.loadAuthImpl]  seam for tests that want to prove the lazy path
 */
export function createSessions({ root, auth = null, loadAuthImpl = loadAuth, fsImpl = fs } = {}) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('createSessions needs a root');
  }

  let cached = auth;
  let pending = null;

  /** The auth object, or a thrown `AuthUnavailableError` that the server turns
   *  into a 503 with a sentence a person can act on. */
  async function api() {
    if (cached) return cached;
    if (!pending) {
      pending = loadAuthImpl()
        .then((mod) => {
          const missing = missingAuthFunctions(mod);
          if (missing.length) throw new AuthUnavailableError(new Error(`missing: ${missing.join(', ')}`));
          cached = mod;
          return mod;
        })
        .catch((err) => {
          // Not memoised as a rejection: the module may appear while the server
          // is running, and a permanently poisoned promise would mean a restart
          // is required for something that fixed itself.
          pending = null;
          throw err instanceof AuthUnavailableError ? err : new AuthUnavailableError(err);
        });
    }
    return pending;
  }

  let secretCache = null;
  async function secret() {
    if (secretCache) return secretCache;
    secretCache = (await api()).sessionSecret({ root });
    return secretCache;
  }

  // -------------------------------------------------------------------------
  // who is asking
  // -------------------------------------------------------------------------

  /**
   * Resolve a request to an account, or null.
   *
   * THE SIGNATURE IS CHECKED BEFORE THE FILESYSTEM IS TOUCHED. A forged session
   * id is rejected by `verifyCookie` -- an HMAC comparison against a secret the
   * client does not have -- so a stream of guessed ids never becomes a stream of
   * `statSync` calls on paths built out of them.
   */
  async function currentAccount(req) {
    // `api()` FIRST, before the cookie is even looked at, and it is memoised so
    // this is a property read after the first call. The point is that "there is
    // no accounts module" is discovered on an anonymous request too: otherwise a
    // signed-out visitor is quietly shown a sign-in form that cannot possibly
    // work, and the 503 only appears once they have typed a password into it.
    const mod = await api();
    const raw = parseCookies(req?.headers?.cookie)[SESSION_COOKIE];
    if (!raw) return null;
    const sessionId = mod.verifyCookie(raw, await secret());
    if (!sessionId) return null;
    let session;
    try {
      session = mod.readSession({ root, sessionId });
    } catch {
      return null;
    }
    if (!session || !session.accountId) return null;
    try {
      return mod.loadAccount({ root, accountId: session.accountId }) ?? null;
    } catch {
      // A session pointing at an account that is gone is a dead session, not a
      // server fault. Treating it as "logged out" is the honest answer and the
      // safe one.
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // logging in and out
  // -------------------------------------------------------------------------

  /** @returns {Promise<string>} the `Set-Cookie` value to send */
  async function startSession(req, accountId) {
    const mod = await api();
    const { sessionId } = mod.createSession({ root, accountId });
    return serializeCookie(SESSION_COOKIE, mod.signCookie(sessionId, await secret()), {
      maxAge: SESSION_MAX_AGE_S,
      secure: isSecureRequest(req),
    });
  }

  /**
   * Destroy the server-side record *and* clear the cookie.
   *
   * Both halves, always. Clearing only the cookie leaves a session id that is
   * still valid to anybody who copied it; destroying only the record leaves the
   * browser sending a dead cookie on every request forever.
   */
  async function endSession(req) {
    const raw = parseCookies(req?.headers?.cookie)[SESSION_COOKIE];
    if (raw) {
      try {
        const mod = await api();
        const sessionId = mod.verifyCookie(raw, await secret());
        if (sessionId) mod.destroySession({ root, sessionId });
      } catch { /* the cookie is being cleared regardless */ }
    }
    return serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: isSecureRequest(req) });
  }

  // -------------------------------------------------------------------------
  // proving a credential post came from this site's own form
  // -------------------------------------------------------------------------

  /**
   * The pair for a form about to be rendered: the value for the hidden field,
   * and the `Set-Cookie` that plants its twin -- or `setCookie: null` when the
   * request already carries a valid one, which is what keeps a form opened in
   * a second tab submittable after the first tab rendered a newer page.
   */
  async function csrfIssue(req) {
    const mod = await api();
    const sec = await secret();
    const raw = parseCookies(req?.headers?.cookie)[CSRF_COOKIE];
    if (typeof raw === 'string' && raw.length > 0 && mod.verifyCookie(raw, sec)) {
      return { token: raw, setCookie: null };
    }
    const token = mod.signCookie(crypto.randomBytes(16).toString('hex'), sec);
    return {
      token,
      setCookie: serializeCookie(CSRF_COOKIE, token, { secure: isSecureRequest(req) }),
    };
  }

  /**
   * Both halves present, the cookie half provably ours, and the two equal in
   * constant time. The signature check comes first: an attacker who can plant
   * arbitrary cookies from a sibling context still has to plant one WE minted,
   * and the comparison after it leaks nothing about how close a guess came.
   */
  async function csrfCheck(req, token) {
    if (typeof token !== 'string' || token.length === 0) return false;
    const mod = await api();
    const raw = parseCookies(req?.headers?.cookie)[CSRF_COOKIE];
    if (typeof raw !== 'string' || raw.length === 0) return false;
    if (!mod.verifyCookie(raw, await secret())) return false;
    const ours = Buffer.from(raw, 'utf8');
    const theirs = Buffer.from(token, 'utf8');
    if (ours.length !== theirs.length) return false;
    return crypto.timingSafeEqual(ours, theirs);
  }

  // -------------------------------------------------------------------------
  // credits
  // -------------------------------------------------------------------------

  /** `{credits, planId, grantedAt, expiresAt}`. */
  async function balance(account) {
    return (await api()).balanceOf(account);
  }

  /** What one tape costs, in credits. Computed the same way the debit is,
   *  because a quote computed differently from the charge is a quote that will
   *  one day differ from the charge. */
  async function cost({ resolution, seconds, tier } = {}) {
    return (await api()).creditCost({ resolution, seconds, tier });
  }

  /**
   * The resolution row, straight out of `config/credits.json`.
   *
   * READ FROM `CREDIT_COSTS`, NOT BY CALLING `creditCost` PER ROW. `creditCost`
   * throws `RESOLUTION_UNAVAILABLE` on a deferred resolution, deliberately, so
   * that nothing can bill for one size and render another -- which means asking
   * it to price 1080p in order to display 1080p as unavailable would throw the
   * whole settings panel away. `CREDIT_COSTS` carries every row including the
   * deferred ones, with `available` on each, which is exactly what a UI needs:
   * it has to know 1080p exists in order to show it greyed out.
   *
   * NOT A HARDCODED LIST, and that is the requirement rather than a preference:
   * 1080p is off today because the config says `available: false`, with the
   * measurement attached, and turning it on later has to be that field and
   * nothing else.
   */
  async function resolutions() {
    const mod = await api();
    return Object.values(mod.CREDIT_COSTS ?? {}).map((row) => ({
      id: row.resolution,
      width: row.width,
      height: row.height,
      // Absent means available: a resolution added without the field is offered
      // rather than silently swallowed.
      available: row.available !== false,
      credits: row.creditsPerReference,
    }));
  }

  /**
   * Add credits, from a payment that has already been verified.
   *
   * NOT REACHABLE FROM A FORM. `credits.mjs` makes this rule in capitals and
   * this seam does not soften it: the only caller is the Stripe webhook, after
   * an HMAC over the raw request body has proved Stripe sent it, and the
   * `ref` it passes is the Stripe event id so a redelivery is a no-op rather
   * than a second payout.
   *
   * Returns `{granted, credits, ref}` -- `granted: false` means this exact
   * event has already been honoured, which is a 200 and not an error.
   */
  async function grant(account, { credits, reason, ref }) {
    return (await api()).grantCredits(account, { credits, reason, ref });
  }

  /**
   * An account by id, for a request that has no session to resolve.
   *
   * The id is checked against `ACCOUNT_ID_RE` first for the same reason
   * `ownerDir` checks it: it came from a webhook payload and it is about to
   * become a path component, and "it came from Stripe" is how directory
   * traversal gets written the second time.
   */
  async function accountById(accountId) {
    if (!ACCOUNT_ID_RE.test(String(accountId ?? ''))) return null;
    const mod = await api();
    try {
      return mod.loadAccount({ root, accountId }) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Spend the credits for one tape.
   *
   * Called at ENQUEUE, never at completion. A user who starts twelve renders in
   * parallel would otherwise have every one of them check a balance that none of
   * them has spent yet. `debitCredits` is idempotent by `jobId`, so a re-enqueue
   * of a job that has already been charged is the same render and not a new one.
   */
  async function debit(account, { jobId, credits }) {
    (await api()).debitCredits(account, { jobId, credits });
  }

  /**
   * Only for a job that failed before the provider was ever called. A job that
   * failed *after* spending is not refunded, because the money is gone.
   *
   * `refundIfUnspent` is preferred over a bare `refundCredits` because it reads
   * `job.steps` and decides for itself whether a provider was ever asked for
   * anything -- so the rule lives in one place instead of being re-derived at
   * every call site that thinks it knows.
   */
  async function refund(account, { jobId, job = null, reason = 'refund:never-enqueued' }) {
    try {
      const mod = await api();
      if (job && typeof mod.refundIfUnspent === 'function') {
        mod.refundIfUnspent(account, job, { reason });
        return;
      }
      mod.refundCredits(account, { jobId, reason, spent: false });
    } catch { /* a refund that cannot be recorded must not mask the real error */ }
  }

  // -------------------------------------------------------------------------
  // ownership
  // -------------------------------------------------------------------------

  const ownerDir = (accountId) => {
    if (!ACCOUNT_ID_RE.test(String(accountId ?? ''))) {
      throw new TypeError(`account id ${JSON.stringify(accountId)} is not a path-safe id`);
    }
    return path.resolve(root, 'out', 'owners', accountId).split(path.sep).join('/');
  };

  /** `jobId` is validated by the caller against `JOB_ID_RE` before it gets here;
   *  this is the second check, and it costs a regex. */
  const OWNED_ID_RE = /^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/;

  /**
   * Record that this account owns this job, and what it was quoted.
   *
   * `resolution` and `credits` ride along because THE MANIFEST CANNOT CARRY
   * THEM. `normalizeInput` in `scripts/render/job.mjs` returns a fixed object
   * literal and silently drops fields it does not know, so a resolution written
   * into `job.input` disappears on the worker's first `saveJob` -- and that file
   * is out of scope for this change. This record is therefore the web layer's
   * receipt for what the person chose and what they were charged, sitting beside
   * the fact that authorises them to see it. The pipeline still needs the
   * resolution before fal is wired; closing that seam is a `job.mjs` change and
   * it is flagged rather than smuggled in here.
   */
  function claimJob({ accountId, jobId, at = new Date().toISOString(), resolution = null, credits = null }) {
    if (!OWNED_ID_RE.test(String(jobId ?? ''))) throw new TypeError(`not a job id: ${jobId}`);
    const dir = ownerDir(accountId);
    fsImpl.mkdirSync(dir, { recursive: true });
    fsImpl.writeFileSync(`${dir}/${jobId}.json`, JSON.stringify({
      jobId, accountId, at, resolution, credits,
    }));
  }

  /** What `claimJob` recorded, or null. */
  function claimOf({ accountId, jobId }) {
    if (!ownsJob({ accountId, jobId })) return null;
    try {
      return JSON.parse(fsImpl.readFileSync(`${ownerDir(accountId)}/${jobId}.json`, 'utf8'));
    } catch {
      return null;
    }
  }

  function ownsJob({ accountId, jobId }) {
    if (!OWNED_ID_RE.test(String(jobId ?? ''))) return false;
    if (!ACCOUNT_ID_RE.test(String(accountId ?? ''))) return false;
    try {
      return fsImpl.statSync(`${ownerDir(accountId)}/${jobId}.json`).isFile();
    } catch {
      return false;
    }
  }

  function releaseJob({ accountId, jobId }) {
    if (!ownsJob({ accountId, jobId })) return false;
    try {
      fsImpl.rmSync(`${ownerDir(accountId)}/${jobId}.json`, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  /** Newest first -- job ids sort chronologically, so a string sort reversed is
   *  the chronological sort, and the shelf wants the most recent tape first. */
  function jobIdsFor(accountId) {
    let names;
    try {
      names = fsImpl.readdirSync(ownerDir(accountId));
    } catch {
      return [];
    }
    return names
      .filter((n) => n.endsWith('.json'))
      .map((n) => n.slice(0, -'.json'.length))
      .filter((id) => OWNED_ID_RE.test(id))
      .sort()
      .reverse();
  }

  return {
    root,
    api,
    currentAccount,
    startSession,
    endSession,
    csrfIssue,
    csrfCheck,
    balance,
    cost,
    resolutions,
    grant,
    accountById,
    debit,
    refund,
    claimJob,
    claimOf,
    ownsJob,
    releaseJob,
    jobIdsFor,
    /** Test seam: swap the auth object at runtime. */
    setAuth(next) { cached = next; pending = null; secretCache = null; },
  };
}
