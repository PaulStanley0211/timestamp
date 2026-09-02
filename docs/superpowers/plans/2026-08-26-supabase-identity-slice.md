# Supabase Identity Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The login page gets a working "Sign in with Google" button and a working "Forgot password?" link, and a new account is confirmed by typing a six-digit code that arrives by email.

**Architecture:** Supabase Auth verifies identity over HTTP; a single seam, `resolveIdentity`, turns a Supabase identity into a local file-backed account; the app then mints and runs on its own session exactly as it does today. Accounts, credits and sessions stay in files — no Postgres, no ORM, no schema. Every Supabase call goes through one protocol module with an injected `fetchImpl` that has no default.

**Tech Stack:** Node 20+ ESM, `node:test`, `node:crypto`, `fetch`. **Zero npm dependencies** — nothing is installed by this plan.

**Spec:** `docs/superpowers/specs/2026-08-26-supabase-identity-slice-design.md` (read it before Task 1; the parent architecture is `docs/superpowers/specs/2026-08-25-supabase-identity-money-design.md`)

**Branch:** `supabase-identity-slice`

## Global Constraints

Every task's requirements implicitly include all of these.

- **Zero npm dependencies.** Do not run `npm install`. Do not add anything to `package.json` `dependencies`. Spec decision 3.
- **No test may reach the network.** Every Supabase call in a test uses an injected fake `fetchImpl`. A test that forgets must fail with `TypeError`, never with a live request.
- **`fetchImpl` has no default** in `scripts/auth/supabase-auth.mjs`. Spec §5. Copy the idiom from `scripts/billing/stripe.mjs` (`requireFetchImpl` from `scripts/providers/contract.mjs`).
- **One error sentence.** Every Supabase auth failure renders `BAD_CREDENTIALS_MESSAGE` from `scripts/auth/accounts.mjs`. Never render an upstream message, code, or status. Spec §4.3, §4.4, §4.5.
- **`node --check` after every edit** to `scripts/web/server.mjs`, `scripts/auth/accounts.mjs` and `scripts/auth/session.mjs`. CLAUDE.md records a failed parse leaving a stale server holding the port.
- **Test command:** whole suite `npm test`; one file `node --test test/<file>.test.js`; one case `node --test --test-name-pattern "<name>" test/<file>.test.js`.
- **Commit message style:** this repo writes a sentence that says what changed and why, not `feat:` prefixes. Match `git log`.
- **Do not touch** `scripts/auth/credits.mjs`, `scripts/auth/session.mjs`, the queue, or the render pipeline. Spec §2.
- **Config values:** `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`. Already present in `.env` and verified 2026-08-26. Never log or render any of them.
- **Windows note:** `job-model` and `queue-race` fail under full parallel load and pass in isolation. Not a regression; re-run the file alone.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `scripts/auth/pkce.mjs` | PKCE verifier/challenge/state generation. Pure crypto, no I/O, no network. |
| `scripts/auth/oauth-store.mjs` | Single-use, TTL'd server-side storage of `{state → verifier}` under `out/oauth/`. |
| `scripts/auth/supabase-auth.mjs` | Every HTTP call to Supabase Auth. Injected `fetchImpl`, no default. Collapses all failures to one error. |
| `scripts/auth/identity.mjs` | `resolveIdentity` — the only place a Supabase identity becomes a local account. |
| `scripts/auth/pending-signup.mjs` | Parks the consent record between signup and code entry. |
| `test/auth-pkce.test.js` | RFC 7636 vector, state uniqueness. |
| `test/auth-oauth-store.test.js` | Single use, expiry, sweep. |
| `test/auth-supabase.test.js` | Protocol shape, transport guard, error collapsing. |
| `test/auth-identity.test.js` | Create, claim, refuse-unverified, ledger preservation. |
| `test/web-auth-code.test.js` | `/verify` — attempt limit, indistinguishable failures, replay. |
| `test/web-auth-google.test.js` | `state` mismatch, single-use verifier, end-to-end callback. |
| `test/web-auth-reset.test.js` | Identical answers, session destruction. |

**Modified**

| File | Change |
|---|---|
| `scripts/auth/accounts.mjs` | `supabaseUserId` field, `_index-supabase` index, `findAccountBySupabaseId`, `claimAccount`. |
| `scripts/web/views-auth.mjs` | Google button, forgot link, `verifyPage`, `resetRequestPage`, `resetCompletePage`, `onboardingPage`. |
| `scripts/web/server.mjs` | Rewired `login`/`signup`; new routes `/verify`, `/auth/google`, `/auth/callback`, `/auth/reset`, `/auth/reset/callback`, `/auth/reset/complete`, `/onboarding`. |
| `scripts/web/server-cli.mjs` | Injects the Supabase transport. The only place. |
| `scripts/preflight/doctor.mjs` | Reports the three config values as present/not-set. |
| `CLAUDE.md` | §2 deployment correction; START HERE dev-login replacement. |

---

## Task 1: PKCE primitives

**Files:**
- Create: `scripts/auth/pkce.mjs`
- Test: `test/auth-pkce.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `newVerifier({ rand = crypto }) -> string`, `challengeFor(verifier) -> string`, `newState({ rand = crypto }) -> string`. All return base64url strings with no padding.

- [ ] **Step 1: Write the failing test**

`test/auth-pkce.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { newVerifier, challengeFor, newState } from '../scripts/auth/pkce.mjs';

// RFC 7636 Appendix B. If this vector fails, the challenge is wrong and every
// Google sign-in fails at the exchange with an error that blames the code.
test('challengeFor matches the RFC 7636 appendix B vector', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(challengeFor(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('a verifier is base64url, unpadded, and long enough to matter', () => {
  const v = newVerifier();
  assert.match(v, /^[A-Za-z0-9_-]+$/);
  assert.ok(v.length >= 43, `verifier too short: ${v.length}`);
});

test('two states are never equal', () => {
  assert.notEqual(newState(), newState());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth-pkce.test.js`
Expected: FAIL — `Cannot find module '../scripts/auth/pkce.mjs'`

- [ ] **Step 3: Write minimal implementation**

`scripts/auth/pkce.mjs`:

```js
/**
 * PKCE, by hand, because taking a dependency for it was decided against.
 *
 * WHY PKCE AT ALL. Supabase's implicit flow returns the token in the URL
 * FRAGMENT, which a browser never sends to a server. Only client-side
 * JavaScript can read a fragment and this app has none by rule, so the implicit
 * flow is not merely worse here -- it is unreadable. Spec decision 3, §3.
 *
 * WHY THE RFC VECTOR IS IN THE TEST. A challenge derived slightly wrong fails
 * at the token exchange with an error that names the code, not the derivation,
 * and costs an afternoon.
 */
import crypto from 'node:crypto';

const b64url = (buf) => buf.toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 32 random bytes, base64url. RFC 7636 permits 43-128 characters; this is 43. */
export function newVerifier({ rand = crypto } = {}) {
  return b64url(rand.randomBytes(32));
}

/** base64url(SHA-256(verifier)), the `S256` method. Never `plain`. */
export function challengeFor(verifier) {
  if (typeof verifier !== 'string' || verifier.length === 0) {
    throw new TypeError('challengeFor needs a verifier');
  }
  return b64url(crypto.createHash('sha256').update(verifier, 'ascii').digest());
}

/** The CSRF token of the OAuth round trip. Spec §4.2: not decorative. */
export function newState({ rand = crypto } = {}) {
  return b64url(rand.randomBytes(32));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/auth-pkce.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/auth/pkce.mjs test/auth-pkce.test.js
git commit -m "PKCE by hand, checked against the RFC vector rather than against itself"
```

---

## Task 2: The OAuth state store

**Files:**
- Create: `scripts/auth/oauth-store.mjs`
- Test: `test/auth-oauth-store.test.js`

**Interfaces:**
- Consumes: `newState` (Task 1).
- Produces: `putVerifier({ root, state, verifier, next, ttlMs, nowImpl }) -> void`, `takeVerifier({ root, state, nowImpl }) -> { verifier, next } | null` (deletes on read), `sweepOAuth({ root, nowImpl }) -> number`.

**Why a file and not a cookie:** a file can be deleted after one use; a cookie cannot be made single-use. Same reasoning as sessions. Spec §4.2.

- [ ] **Step 1: Write the failing test**

`test/auth-oauth-store.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { putVerifier, takeVerifier, sweepOAuth } from '../scripts/auth/oauth-store.mjs';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ts-oauth-'));
}

test('a verifier comes back exactly once', () => {
  const root = tmpRoot();
  putVerifier({ root, state: 'st1', verifier: 'v1', next: '/shelf' });
  assert.deepEqual(takeVerifier({ root, state: 'st1' }), { verifier: 'v1', next: '/shelf' });
  assert.equal(takeVerifier({ root, state: 'st1' }), null, 'replay must not succeed');
});

test('an unknown state is null, not an error', () => {
  const root = tmpRoot();
  assert.equal(takeVerifier({ root, state: 'never-issued' }), null);
});

test('an expired verifier is refused and not returned late', () => {
  const root = tmpRoot();
  let now = new Date('2026-08-26T10:00:00.000Z');
  putVerifier({ root, state: 'st2', verifier: 'v2', ttlMs: 60_000, nowImpl: () => now });
  now = new Date('2026-08-26T10:05:00.000Z');
  assert.equal(takeVerifier({ root, state: 'st2', nowImpl: () => now }), null);
});

test('sweep removes expired rows and reports how many', () => {
  const root = tmpRoot();
  let now = new Date('2026-08-26T10:00:00.000Z');
  putVerifier({ root, state: 'a', verifier: 'v', ttlMs: 60_000, nowImpl: () => now });
  putVerifier({ root, state: 'b', verifier: 'v', ttlMs: 3_600_000, nowImpl: () => now });
  now = new Date('2026-08-26T10:05:00.000Z');
  assert.equal(sweepOAuth({ root, nowImpl: () => now }), 1);
  assert.ok(takeVerifier({ root, state: 'b', nowImpl: () => now }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth-oauth-store.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`scripts/auth/oauth-store.mjs`:

```js
/**
 * Where the PKCE verifier waits while the person is at Google.
 *
 * WHY A FILE AND NOT A COOKIE. A row can be deleted after one use; a cookie
 * cannot be made single-use, and a replayable verifier is a replayable login.
 * Same argument as sessions, spec §4.2.
 *
 * WHY THE STATE IS THE FILENAME. The callback arrives holding a state and
 * nothing else we trust. Looking it up by name means an unknown state costs one
 * failed stat rather than a directory scan.
 */
import fs from 'node:fs';
import path from 'node:path';

export const OAUTH_DIR = 'out/oauth';
export const OAUTH_TTL_MS = 10 * 60 * 1000;
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const defaultNow = () => new Date();

function dirFor(root) {
  const dir = path.join(root, OAUTH_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Refuses a state that could escape the directory. The regex is the guard. */
function fileFor(root, state) {
  if (!STATE_RE.test(String(state ?? ''))) return null;
  return path.join(dirFor(root), `${state}.json`);
}

export function putVerifier({ root, state, verifier, next = '', ttlMs = OAUTH_TTL_MS, nowImpl = defaultNow }) {
  const file = fileFor(root, state);
  if (!file) throw new TypeError('putVerifier needs a well-formed state');
  const expiresAt = new Date(nowImpl().getTime() + ttlMs).toISOString();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ verifier, next, expiresAt }), 'utf8');
  fs.renameSync(tmp, file);
}

/** Reads and DELETES. The delete happens whether or not the row was still
 *  valid, so an expired state cannot be retried until it is guessed right. */
export function takeVerifier({ root, state, nowImpl = defaultNow }) {
  const file = fileFor(root, state);
  if (!file) return null;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try { fs.unlinkSync(file); } catch { /* already gone; the read is what counts */ }
  let row;
  try { row = JSON.parse(raw); } catch { return null; }
  if (!row || typeof row.verifier !== 'string') return null;
  if (new Date(row.expiresAt).getTime() <= nowImpl().getTime()) return null;
  return { verifier: row.verifier, next: typeof row.next === 'string' ? row.next : '' };
}

export function sweepOAuth({ root, nowImpl = defaultNow }) {
  const dir = dirFor(root);
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    try {
      const row = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (new Date(row.expiresAt).getTime() <= nowImpl().getTime()) {
        fs.unlinkSync(file);
        removed += 1;
      }
    } catch {
      fs.unlinkSync(file);
      removed += 1;
    }
  }
  return removed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/auth-oauth-store.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/auth/oauth-store.mjs test/auth-oauth-store.test.js
git commit -m "The verifier waits in a row that can be deleted, because a cookie cannot be spent"
```

---

## Task 3: The Supabase protocol module

**Files:**
- Create: `scripts/auth/supabase-auth.mjs`
- Test: `test/auth-supabase.test.js`

**Interfaces:**
- Consumes: `requireFetchImpl` from `scripts/providers/contract.mjs`.
- Produces: `createSupabaseAuth({ url, publishableKey, secretKey, fetchImpl }) -> { signUp, verifyCode, signInWithPassword, exchangeCode, sendRecovery, updatePassword, revoke, authorizeUrl }`. Every method resolves `{ ok: true, identity }` or throws `SupabaseAuthError` whose `.userMessage` is always `BAD_CREDENTIALS_MESSAGE`. `identity` is `{ supabaseUserId, email, emailVerified, provider, accessToken }`.

**The rule this module exists to enforce:** upstream distinguishes `invalid_credentials`, `email_not_confirmed` and `over_request_rate_limit`. None of those words leaves this file. Spec §4.3.

- [ ] **Step 1: Write the failing test**

`test/auth-supabase.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createSupabaseAuth } from '../scripts/auth/supabase-auth.mjs';
import { BAD_CREDENTIALS_MESSAGE } from '../scripts/auth/accounts.mjs';

const CFG = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_x', secretKey: 'sb_secret_x' };

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return handler({ url: String(url), opts, calls });
  };
  impl.calls = calls;
  return impl;
}

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

test('omitting fetchImpl throws rather than reaching the network', () => {
  assert.throws(() => createSupabaseAuth({ ...CFG }), TypeError);
});

test('a password sign-in returns an identity and never the token to callers who did not ask', async () => {
  const fetchImpl = fakeFetch(() => json(200, {
    access_token: 'at1',
    user: { id: 'uuid-1', email: 'a@b.com', email_confirmed_at: '2026-08-26T00:00:00Z' },
  }));
  const sb = createSupabaseAuth({ ...CFG, fetchImpl });
  const { identity } = await sb.signInWithPassword({ email: 'a@b.com', password: 'x'.repeat(10) });
  assert.equal(identity.supabaseUserId, 'uuid-1');
  assert.equal(identity.email, 'a@b.com');
  assert.equal(identity.emailVerified, true);
  assert.equal(identity.accessToken, 'at1');
});

test('every distinguishable upstream failure collapses to one sentence', async () => {
  for (const upstream of [
    { status: 400, body: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' } },
    { status: 400, body: { error_code: 'email_not_confirmed', msg: 'Email not confirmed' } },
    { status: 429, body: { error_code: 'over_request_rate_limit', msg: 'Too many requests' } },
    { status: 500, body: { msg: 'internal' } },
  ]) {
    const fetchImpl = fakeFetch(() => json(upstream.status, upstream.body));
    const sb = createSupabaseAuth({ ...CFG, fetchImpl });
    await assert.rejects(
      () => sb.signInWithPassword({ email: 'a@b.com', password: 'x'.repeat(10) }),
      (err) => {
        assert.equal(err.userMessage, BAD_CREDENTIALS_MESSAGE, `leaked for ${upstream.body.error_code}`);
        assert.ok(!String(err.userMessage).includes('confirm'), 'must not hint at confirmation state');
        return true;
      },
    );
  }
});

test('the end user IP rides on Sb-Forwarded-For with the secret key', async () => {
  const fetchImpl = fakeFetch(() => json(200, { access_token: 'at', user: { id: 'u', email: 'a@b.com' } }));
  const sb = createSupabaseAuth({ ...CFG, fetchImpl });
  await sb.signInWithPassword({ email: 'a@b.com', password: 'x'.repeat(10), clientIp: '203.0.113.7' });
  const headers = fetchImpl.calls[0].opts.headers;
  assert.equal(headers['Sb-Forwarded-For'], '203.0.113.7');
  assert.equal(headers.apikey, CFG.secretKey, 'forwarding is only honoured for a secret key');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth-supabase.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`scripts/auth/supabase-auth.mjs`. Key points the implementer must not soften:

```js
/**
 * Every HTTP call this app makes to Supabase Auth, and the only place that
 * knows what Supabase's replies look like.
 *
 * WHY `fetchImpl` HAS NO DEFAULT. Same guard as `providers/fal.mjs` and
 * `billing/stripe.mjs`: a test that forgets to inject a transport must get a
 * TypeError rather than a live request against a real project. CLAUDE.md
 * records what happened the one time production forgot to inject -- the guard
 * fired in production and read like a test bug. `server-cli.mjs` is the only
 * caller that hands over a real transport.
 *
 * WHY EVERY FAILURE LEAVES HERE AS ONE SENTENCE. Supabase answers
 * `invalid_credentials`, `email_not_confirmed` and `over_request_rate_limit`
 * distinguishably. Rendering `email_not_confirmed` tells a stranger the address
 * they typed has an account on a service that stores photographs of people's
 * faces. The upstream words are logged and never returned. Spec §4.3.
 */
import { requireFetchImpl } from '../providers/contract.mjs';
import { BAD_CREDENTIALS_MESSAGE } from './accounts.mjs';

export class SupabaseAuthError extends Error {
  constructor(detail, { status = 0, code = '' } = {}) {
    super(detail);
    this.name = 'SupabaseAuthError';
    this.status = status;
    this.code = code;
    /** The ONLY thing a page may render. */
    this.userMessage = BAD_CREDENTIALS_MESSAGE;
  }
}

export function createSupabaseAuth({ url, publishableKey, secretKey, fetchImpl, logImpl = () => {} }) {
  const doFetch = requireFetchImpl({ fetchImpl }, { provider: 'supabase' });
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new TypeError('createSupabaseAuth needs an https url');
  }
  const base = url.replace(/\/+$/, '');

  // The secret key is used for the calls that carry Sb-Forwarded-For, which
  // Supabase only honours for an elevated key. Spec §5.
  async function call(path, { method = 'POST', body = null, accessToken = null, clientIp = null } = {}) {
    const key = clientIp ? secretKey : publishableKey;
    const headers = { apikey: key, 'Content-Type': 'application/json' };
    headers.Authorization = `Bearer ${accessToken ?? key}`;
    if (clientIp) headers['Sb-Forwarded-For'] = clientIp;
    const res = await doFetch(`${base}/auth/v1${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    let payload = null;
    try { payload = await res.json(); } catch { payload = null; }
    if (!res.ok) {
      const code = payload?.error_code ?? payload?.error ?? '';
      logImpl(`[supabase] ${path} ${res.status} ${code}`);
      throw new SupabaseAuthError(`${path} ${res.status} ${code}`, { status: res.status, code });
    }
    return payload ?? {};
  }

  const identityFrom = (payload, provider) => {
    const user = payload?.user ?? payload;
    if (!user?.id) throw new SupabaseAuthError('no user in reply');
    return {
      supabaseUserId: user.id,
      email: String(user.email ?? '').trim().toLowerCase(),
      emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at
        || user.user_metadata?.email_verified),
      provider,
      accessToken: payload?.access_token ?? null,
    };
  };

  return {
    /** Returns `{ pending: true }` -- with confirmation on there is no session
     *  and no identity to resolve yet. Spec §3. */
    async signUp({ email, password, clientIp = null }) {
      await call('/signup', { body: { email, password }, clientIp });
      return { pending: true };
    },

    /** The six-digit code. `type: 'signup'` is the confirmation flow. */
    async verifyCode({ email, token, type = 'signup', clientIp = null }) {
      const payload = await call('/verify', { body: { email, token, type }, clientIp });
      return { ok: true, identity: identityFrom(payload, 'email') };
    },

    async signInWithPassword({ email, password, clientIp = null }) {
      const payload = await call('/token?grant_type=password', { body: { email, password }, clientIp });
      return { ok: true, identity: identityFrom(payload, 'email') };
    },

    /** Where the browser is sent to start the Google round trip. */
    authorizeUrl({ codeChallenge, redirectTo }) {
      const q = new URLSearchParams({
        provider: 'google',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        redirect_to: redirectTo,
      });
      return `${base}/auth/v1/authorize?${q}`;
    },

    async exchangeCode({ authCode, codeVerifier, clientIp = null }) {
      const payload = await call('/token?grant_type=pkce', {
        body: { auth_code: authCode, code_verifier: codeVerifier }, clientIp,
      });
      return { ok: true, identity: identityFrom(payload, 'google') };
    },

    /** Answers the same way for a known and an unknown address, by contract. */
    async sendRecovery({ email, clientIp = null }) {
      try {
        await call('/recover', { body: { email }, clientIp });
      } catch (err) {
        logImpl(`[supabase] recover refused: ${err.message}`);
      }
      return { ok: true };
    },

    async updatePassword({ accessToken, password }) {
      await call('/user', { method: 'PUT', body: { password }, accessToken });
      return { ok: true };
    },

    /** Revoke at the door: after this, the only live credential is ours. */
    async revoke({ accessToken }) {
      try { await call('/logout', { accessToken }); } catch { /* best effort */ }
      return { ok: true };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/auth-supabase.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/auth/supabase-auth.mjs test/auth-supabase.test.js
git commit -m "One module holds every Supabase reply, and one sentence is all that leaves it"
```

---

## Task 4: `supabaseUserId` on the account, and its index

**Files:**
- Modify: `scripts/auth/accounts.mjs`
- Test: `test/auth-accounts.test.js` (add cases; do not rewrite the file)

**Interfaces:**
- Consumes: existing `createAccount`, `loadAccount`, `saveAccount`, `updateAccount`, `withAccountLock`, `emailHash`, `normaliseEmail`.
- Produces: `SUPABASE_INDEX_DIR = '_index-supabase'`, `findAccountBySupabaseId({ root, supabaseUserId }) -> account | null`, `claimAccount({ root, accountId, supabaseUserId }) -> account` (stamps the id, nulls `password`, writes the index).

- [ ] **Step 1: Write the failing test**

Append to `test/auth-accounts.test.js`:

```js
test('an account can be claimed by a supabase id, and the password dies with the claim', async () => {
  const root = tmpRoot();
  const made = await createAccount({ root, email: 'claim@example.com', password: 'correct-horse-battery' });
  assert.ok(made.password, 'precondition: a local hash exists');

  const claimed = await claimAccount({ root, accountId: made.accountId, supabaseUserId: 'uuid-claim' });
  assert.equal(claimed.supabaseUserId, 'uuid-claim');
  assert.equal(claimed.password, null, 'a hash that gates nothing is a liability');

  const found = findAccountBySupabaseId({ root, supabaseUserId: 'uuid-claim' });
  assert.equal(found.accountId, made.accountId);
});

test('claiming preserves the ledger exactly', async () => {
  const root = tmpRoot();
  const made = await createAccount({ root, email: 'ledger@example.com', password: 'correct-horse-battery' });
  const before = JSON.stringify(made.ledger);
  const claimed = await claimAccount({ root, accountId: made.accountId, supabaseUserId: 'uuid-led' });
  assert.equal(JSON.stringify(claimed.ledger), before, 'a claim is not a new account');
  assert.equal(claimed.plan, made.plan);
});

test('an unknown supabase id is null, not a throw', () => {
  const root = tmpRoot();
  assert.equal(findAccountBySupabaseId({ root, supabaseUserId: 'nope' }), null);
});
```

Add `claimAccount, findAccountBySupabaseId` to the existing import at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth-accounts.test.js`
Expected: FAIL — `claimAccount is not a function`

- [ ] **Step 3: Write minimal implementation**

In `scripts/auth/accounts.mjs`, beside `INDEX_DIR`:

```js
/**
 * The second index, and why the email index is not enough.
 *
 * The Supabase user id is the STABLE key; an email is not, because a person can
 * change their address at the provider and arrive with the same identity and a
 * different mailbox. Spec §1.1.
 */
export const SUPABASE_INDEX_DIR = '_index-supabase';
const SUPABASE_ID_RE = /^[0-9a-fA-F-]{8,64}$/;

function supabaseIndexPath(root, supabaseUserId) {
  if (!SUPABASE_ID_RE.test(String(supabaseUserId ?? ''))) return null;
  return path.join(accountsRoot(root), SUPABASE_INDEX_DIR, String(supabaseUserId));
}

export function findAccountBySupabaseId({ root = REPO_ROOT, supabaseUserId, nowImpl = defaultNow }) {
  const file = supabaseIndexPath(root, supabaseUserId);
  if (!file) return null;
  let accountId;
  try { accountId = fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
  if (!ACCOUNT_ID_RE.test(accountId)) return null;
  try { return loadAccount({ root, accountId, nowImpl }); } catch { return null; }
}

/**
 * Stamps a Supabase identity onto an account that already exists, and nulls the
 * scrypt hash in the same write.
 *
 * WHY THE PASSWORD IS NULLED RATHER THAN KEPT. After this slice nothing in the
 * request path calls `verifyPassword`. A hash that gates nothing is a liability
 * with no remaining benefit -- it can only ever be stolen. Spec §1.1.
 */
export async function claimAccount({ root = REPO_ROOT, accountId, supabaseUserId }) {
  const file = supabaseIndexPath(root, supabaseUserId);
  if (!file) throw new TypeError('claimAccount needs a well-formed supabaseUserId');
  const updated = updateAccount({ root, accountId }, (account) => {
    account.supabaseUserId = String(supabaseUserId);
    account.password = null;
    return account;
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, updated.accountId, 'utf8');
  fs.renameSync(tmp, file);
  return updated;
}
```

Also add `supabaseUserId: null` to the object literal `createAccount` writes, **and** to `entriesOf`'s field list if that function names fields — CLAUDE.md records that a field not named in `entriesOf` reads back `undefined` forever and cost an hour.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/auth-accounts.test.js` then `node --check scripts/auth/accounts.mjs`
Expected: PASS, all existing cases still green

- [ ] **Step 5: Commit**

```bash
git add scripts/auth/accounts.mjs test/auth-accounts.test.js
git commit -m "An account learns its Supabase identity, and forgets a password that now gates nothing"
```

---

## Task 5: `resolveIdentity` — the seam

**Files:**
- Create: `scripts/auth/identity.mjs`
- Test: `test/auth-identity.test.js`

**Interfaces:**
- Consumes: `findAccountBySupabaseId`, `claimAccount`, `findAccountByEmail`, `createAccount` (Task 4).
- Produces: `resolveIdentity({ root, identity, consent, nowImpl }) -> { accountId, created }`.

**The rule that is account takeover if it is wrong:** claiming an existing account by email requires `emailVerified === true`. Spec §4.1.

- [ ] **Step 1: Write the failing test**

`test/auth-identity.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveIdentity } from '../scripts/auth/identity.mjs';
import { createAccount, loadAccount } from '../scripts/auth/accounts.mjs';
import { balanceOf } from '../scripts/auth/credits.mjs';

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ts-ident-'));
const CONSENT = { agreedAt: '2026-08-26T00:00:00.000Z', text: 'test consent' };

const identity = (over = {}) => ({
  supabaseUserId: 'uuid-a', email: 'new@example.com',
  emailVerified: true, provider: 'email', ...over,
});

test('a brand new identity creates an account and grants once', async () => {
  const root = tmpRoot();
  const first = await resolveIdentity({ root, identity: identity(), consent: CONSENT });
  assert.equal(first.created, true);
  const account = loadAccount({ root, accountId: first.accountId });
  const granted = balanceOf(account);
  assert.ok(granted > 0, 'the free grant fires at first confirmed login');

  const second = await resolveIdentity({ root, identity: identity(), consent: CONSENT });
  assert.equal(second.created, false, 'a second resolve is not a second account');
  assert.equal(second.accountId, first.accountId);
  assert.equal(balanceOf(loadAccount({ root, accountId: first.accountId })), granted,
    'and not a second grant');
});

test('an UNVERIFIED identity may not claim an existing account', async () => {
  const root = tmpRoot();
  await createAccount({ root, email: 'victim@example.com', password: 'correct-horse-battery' });
  await assert.rejects(
    () => resolveIdentity({
      root,
      identity: identity({ email: 'victim@example.com', emailVerified: false, supabaseUserId: 'uuid-attacker' }),
      consent: CONSENT,
    }),
    /verified/i,
    'this is the test that would have caught the takeover',
  );
});

test('a VERIFIED identity claims the existing account and keeps its ledger', async () => {
  const root = tmpRoot();
  const made = await createAccount({ root, email: 'old@example.com', password: 'correct-horse-battery' });
  const before = balanceOf(made);

  const out = await resolveIdentity({
    root,
    identity: identity({ email: 'old@example.com', supabaseUserId: 'uuid-old' }),
    consent: CONSENT,
  });

  assert.equal(out.created, false, 'a claim is not a creation, so no grant fires');
  assert.equal(out.accountId, made.accountId);
  const after = loadAccount({ root, accountId: made.accountId });
  assert.equal(balanceOf(after), before, 'the ledger survives the migration');
  assert.equal(after.supabaseUserId, 'uuid-old');
  assert.equal(after.password, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth-identity.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`scripts/auth/identity.mjs`:

```js
/**
 * The one place a Supabase identity becomes an application account.
 *
 * Above this function is protocol; below it is `accounts.mjs` and the files it
 * already writes. Nothing on either side holds a Supabase token. When the money
 * ledger later moves to Postgres, this function's internals change and no
 * caller does. Spec §1.
 */
import {
  findAccountBySupabaseId, findAccountByEmail, claimAccount, createAccount,
  normaliseEmail, AuthError,
} from './accounts.mjs';

const defaultNow = () => new Date();

export async function resolveIdentity({ root, identity, consent = null, nowImpl = defaultNow }) {
  const { supabaseUserId, email, emailVerified } = identity ?? {};
  if (!supabaseUserId) throw new TypeError('resolveIdentity needs a supabaseUserId');
  const address = normaliseEmail(email);

  // 1. Known identity. The stable key, checked first.
  const known = findAccountBySupabaseId({ root, supabaseUserId, nowImpl });
  if (known) return { accountId: known.accountId, created: false };

  // 2. An account at this address that predates the slice.
  const existing = findAccountByEmail({ root, email: address, nowImpl });
  if (existing) {
    // THE RULE. Without it, an unverified identity for an address inherits the
    // account at that address -- its credits, its plan, its tapes. Spec §4.1.
    if (emailVerified !== true) {
      throw new AuthError('unverified identity may not claim an existing account', {
        userMessage: 'That email and password do not match an account.',
      });
    }
    const claimed = await claimAccount({ root, accountId: existing.accountId, supabaseUserId });
    return { accountId: claimed.accountId, created: false };
  }

  // 3. Genuinely new. `createAccount` issues the free grant; this is the only
  //    branch that reaches it, which is why a claim never grants twice.
  const made = await createAccount({
    root, email: address, password: null, consent, supabaseUserId, nowImpl,
  });
  return { accountId: made.accountId, created: true };
}
```

`createAccount` currently calls `assertUsablePassword(password)`. Change it to skip that assertion when `password === null` **and** `supabaseUserId` is present, and to write `supabaseUserId` plus the index. Add a test in `test/auth-accounts.test.js` asserting a passwordless create is refused when no `supabaseUserId` is given, so the relaxation cannot be used by accident.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/auth-identity.test.js test/auth-accounts.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/auth/identity.mjs scripts/auth/accounts.mjs test/auth-identity.test.js test/auth-accounts.test.js
git commit -m "One seam turns an identity into an account, and refuses to hand one over unverified"
```

---

## Task 6: Parking consent across the confirmation gap

**Files:**
- Create: `scripts/auth/pending-signup.mjs`
- Test: `test/auth-identity.test.js` (add cases)

**Interfaces:**
- Consumes: `emailHash` from `accounts.mjs`, `recordConsent` from `scripts/safety/consent.mjs`.
- Produces: `putPending({ root, email, consent, ttlMs, nowImpl })`, `takePending({ root, email, nowImpl }) -> { consent } | null`, `sweepPending({ root, nowImpl }) -> number`.

**Why it exists:** `createAccount` records consent, but with confirmation on the account is not created until the code is typed — minutes or days after the box was ticked. Spec §6.

- [ ] **Step 1: Write the failing test**

```js
test('consent survives the gap between signup and code entry', () => {
  const root = tmpRoot();
  putPending({ root, email: 'Gap@Example.com ', consent: CONSENT });
  // Normalisation happens inside, so the lookup does not have to match casing.
  assert.deepEqual(takePending({ root, email: 'gap@example.com' }), { consent: CONSENT });
});

test('a consumed pending signup does not come back', () => {
  const root = tmpRoot();
  putPending({ root, email: 'once@example.com', consent: CONSENT });
  takePending({ root, email: 'once@example.com' });
  assert.equal(takePending({ root, email: 'once@example.com' }), null);
});

test('an expired pending signup is null, so the person is asked once instead', () => {
  const root = tmpRoot();
  let now = new Date('2026-08-26T10:00:00.000Z');
  putPending({ root, email: 'stale@example.com', consent: CONSENT, ttlMs: 1000, nowImpl: () => now });
  now = new Date('2026-08-27T10:00:00.000Z');
  assert.equal(takePending({ root, email: 'stale@example.com', nowImpl: () => now }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth-identity.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`scripts/auth/pending-signup.mjs` — same shape as `oauth-store.mjs` (tmp+rename write, read-and-delete take, sweep), keyed on `emailHash(normaliseEmail(email))`, stored under `out/pending-signups/`, default TTL 24 hours. **Consent text never goes to Supabase**: it is a record of an agreement with this service and stays in this service's files.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/auth-identity.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/auth/pending-signup.mjs test/auth-identity.test.js
git commit -m "Consent waits here while the person goes to fetch the code, and never travels to Supabase"
```

---

## Task 7: The code-entry page and its attempt limit

**Files:**
- Modify: `scripts/web/views-auth.mjs`, `scripts/web/server.mjs`
- Create: `test/web-auth-code.test.js`

**Interfaces:**
- Consumes: `createSupabaseAuth` (Task 3), `resolveIdentity` (Task 5), `takePending` (Task 6), `createRateLimiter` from `scripts/web/rate-limit.mjs`.
- Produces: routes `GET /verify`, `POST /verify`, `POST /verify/resend`; `verifyPage({ email, error, csrf, notice })` in `views-auth.mjs`.

**Spec §4.5 is the whole of this task.** A six-digit code is one million values with an hour to live. The attempt limit *is* the feature.

- [ ] **Step 1: Write the failing test**

`test/web-auth-code.test.js` (reuse `test/web-api.test.js`'s harness style — real listener on port 0, fake queue, fake Supabase transport):

```js
test('the code dies after five wrong answers, and the sixth fails even when correct', async () => {
  const { base, csrf, cookie } = await startWithFakeSupabase({ correctCode: '123456' });
  for (let i = 0; i < 5; i += 1) {
    const res = await postForm(`${base}/verify`, { email: 'a@b.com', code: '000000', csrf }, cookie);
    assert.equal(res.status, 401, `attempt ${i + 1} should be refused`);
  }
  const res = await postForm(`${base}/verify`, { email: 'a@b.com', code: '123456', csrf }, cookie);
  assert.equal(res.status, 401, 'the limit is a limit, not a message');
  assert.ok(!res.headers.get('set-cookie'), 'and no session is minted');
});

test('wrong, expired, and never-signed-up answer identically', async () => {
  const shapes = [];
  for (const kind of ['wrong', 'expired', 'unknown-address']) {
    const { base, csrf, cookie } = await startWithFakeSupabase({ failWith: kind });
    const res = await postForm(`${base}/verify`, { email: 'a@b.com', code: '000000', csrf }, cookie);
    shapes.push({ status: res.status, body: await res.text() });
  }
  assert.equal(new Set(shapes.map((s) => s.status)).size, 1, 'statuses differ');
  assert.equal(new Set(shapes.map((s) => s.body)).size, 1, 'bodies differ — that is the oracle');
});

test('a correct code signs the person in and lands them on onboarding', async () => {
  const { base, csrf, cookie } = await startWithFakeSupabase({ correctCode: '123456' });
  const res = await postForm(`${base}/verify`, { email: 'a@b.com', code: '123456', csrf }, cookie);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/onboarding');
  assert.match(res.headers.get('set-cookie') ?? '', /timestamp_session=/);
});

test('a consumed code cannot be replayed into a second account or a second grant', async () => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase({ correctCode: '123456' });
  await postForm(`${base}/verify`, { email: 'a@b.com', code: '123456', csrf }, cookie);
  const before = listAccounts({ root }).length;
  await postForm(`${base}/verify`, { email: 'a@b.com', code: '123456', csrf }, cookie);
  assert.equal(listAccounts({ root }).length, before, 'no second account');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/web-auth-code.test.js`
Expected: FAIL — 404 on `/verify`

- [ ] **Step 3: Write minimal implementation**

Add to `AUTH_RATE_LIMITS` in `server.mjs`:

```js
export const AUTH_RATE_LIMITS = Object.freeze({
  login: Object.freeze({ max: 10, windowMs: 60_000 }),
  signup: Object.freeze({ max: 10, windowMs: 3_600_000 }),
  // Spec §4.5. Per IP; the per-code and per-address bounds are separate and
  // stricter, because an IP is cheap and a code must die at five.
  verify: Object.freeze({ max: 20, windowMs: 3_600_000 }),
  reset: Object.freeze({ max: 5, windowMs: 3_600_000 }),
});

/** Wrong answers before a code is dead rather than throttled. Spec §4.5. */
export const CODE_MAX_ATTEMPTS = 5;
```

Attempts are counted in a file keyed on `emailHash(email)` under `out/verify-attempts/`, incremented **before** the upstream call and cleared on success. Counting after the call lets a crash reset the count.

`verifyPage` in `views-auth.mjs`: one six-digit field (`inputmode="numeric"`, `autocomplete="one-time-code"`, `maxlength="6"`), the address the code went to, a CSRF hidden field, and a resend button that states the 60-second rule rather than failing silently.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/web-auth-code.test.js` then `node --check scripts/web/server.mjs`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/web/views-auth.mjs scripts/web/server.mjs test/web-auth-code.test.js
git commit -m "Six digits is a million guesses, so the attempt limit is the feature and not a garnish"
```

---

## Task 8: Signup goes to Supabase, and stops confirming who exists

**Files:**
- Modify: `scripts/web/server.mjs` (the `signup` handler read at 1091-1140)
- Test: `test/web-auth-code.test.js` (add cases)

**Interfaces:**
- Consumes: `signUp` (Task 3), `putPending` (Task 6).
- Produces: `POST /signup` now returns 303 to `/verify?email=…` instead of minting a session.

- [ ] **Step 1: Write the failing test**

```js
test('signup for an address that already exists is indistinguishable from a new one', async () => {
  const fresh = await signupThrough({ upstream: 'ok' });
  const taken = await signupThrough({ upstream: 'user-already-registered' });
  assert.equal(fresh.status, taken.status);
  assert.equal(fresh.location, taken.location);
  assert.equal(fresh.body, taken.body, 'Supabase leaks it; we must not pass it on');
});

test('signup parks the consent and mints no session', async () => {
  const res = await signupThrough({ upstream: 'ok' });
  assert.equal(res.status, 303);
  assert.match(res.location, /^\/verify\?email=/);
  assert.ok(!res.setCookie, 'nobody is signed in until the mailbox is proved');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/web-auth-code.test.js`
Expected: FAIL — signup still returns 201 with a session cookie

- [ ] **Step 3: Write minimal implementation**

Keep every existing pre-check (shape, password length, consent, CSRF, `sameOriginPost`, rate limit) exactly as it is. Replace only the `createAccount` call and what follows:

```js
      // Supabase returns "User already registered" for a taken address unless
      // BOTH email and phone confirmation are on. This project has phone off
      // (verified 2026-08-26), so it takes the leaking path -- and closing it
      // by adopting SMS would be paying Twilio to hide a string. We render the
      // same page either way. Spec §4.4.
      try {
        await sb.signUp({ email, password, clientIp: clientIpOf(req) });
      } catch (err) {
        logImpl(`[web] signup upstream: ${err?.message ?? err}`);
      }
      putPending({ root, email, consent: recordConsent({ text: consentText }) });
      if (wantsHtml(req)) return redirect(res, `/verify?email=${encodeURIComponent(email)}`, 303);
      return sendJson(req, res, 202, { next: `/verify?email=${encodeURIComponent(email)}` });
```

The `catch` that swallows is deliberate and must carry that comment, or a later reader will "fix" it into an oracle.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/web-auth-code.test.js` then `node --check scripts/web/server.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/web/server.mjs test/web-auth-code.test.js
git commit -m "Signup says the same sentence whether or not that address was already here"
```

---

## Task 9: Login goes to Supabase

**Files:**
- Modify: `scripts/web/server.mjs` (the `login` handler at 1050-1089)
- Test: `test/web-auth-code.test.js` (add cases)

- [ ] **Step 1: Write the failing test**

```js
test('every upstream login failure renders one sentence', async () => {
  for (const kind of ['invalid_credentials', 'email_not_confirmed', 'over_request_rate_limit']) {
    const res = await loginThrough({ upstream: kind });
    assert.equal(res.status, 401);
    assert.match(res.body, /do not match an account/);
    assert.ok(!/confirm/i.test(res.body), `leaked confirmation state for ${kind}`);
  }
});

test('a good login mints our session and revokes theirs', async () => {
  const res = await loginThrough({ upstream: 'ok' });
  assert.match(res.setCookie ?? '', /timestamp_session=/);
  assert.ok(res.calls.some((c) => c.url.includes('/logout')), 'revoke at the door');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/web-auth-code.test.js`
Expected: FAIL — still calling `mod.authenticate`

- [ ] **Step 3: Write minimal implementation**

Replace the `mod.authenticate` call with `sb.signInWithPassword(...)` → `resolveIdentity(...)` → `auths.startSession(...)` → `sb.revoke({ accessToken })`. Order matters and is stated in spec §5: **exchange → resolve → use → revoke.** Render `err.userMessage` (always the one sentence) on any failure.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/web-auth-code.test.js && node --check scripts/web/server.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/web/server.mjs test/web-auth-code.test.js
git commit -m "Login asks Supabase, mints our own session, and closes theirs on the way out"
```

---

## Task 10: The Google round trip

**Files:**
- Modify: `scripts/web/server.mjs`, `scripts/web/views-auth.mjs`
- Create: `test/web-auth-google.test.js`

**Interfaces:**
- Consumes: Tasks 1, 2, 3, 5.
- Produces: `POST /auth/google` (CSRF-carrying form → 303 to Supabase), `GET /auth/callback`.

- [ ] **Step 1: Write the failing test**

```js
test('a callback carrying a state we never issued is refused', async () => {
  const { base } = await startWithFakeSupabase({});
  const res = await fetch(`${base}/auth/callback?code=abc&state=never-issued`, { redirect: 'manual' });
  assert.equal(res.status, 400);
  assert.ok(!res.headers.get('set-cookie'), 'no session from an unissued state');
});

test('a state cannot be spent twice', async () => {
  const { base, startGoogle } = await startWithFakeSupabase({});
  const state = await startGoogle();
  const first = await fetch(`${base}/auth/callback?code=abc&state=${state}`, { redirect: 'manual' });
  assert.equal(first.status, 303);
  const second = await fetch(`${base}/auth/callback?code=abc&state=${state}`, { redirect: 'manual' });
  assert.equal(second.status, 400, 'the verifier was single use');
});

test('the authorize redirect carries S256 and never the verifier', async () => {
  const { base, csrf, cookie } = await startWithFakeSupabase({});
  const res = await postForm(`${base}/auth/google`, { csrf }, cookie);
  const location = res.headers.get('location');
  assert.match(location, /code_challenge_method=S256/);
  assert.ok(!/code_verifier/.test(location), 'the verifier never leaves this machine');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/web-auth-google.test.js`
Expected: FAIL — 404

- [ ] **Step 3: Write minimal implementation**

`POST /auth/google`: check CSRF and same-origin → `newVerifier`/`challengeFor`/`newState` → `putVerifier` → 303 to `sb.authorizeUrl({ codeChallenge, redirectTo: publicUrl + '/auth/callback' })`.

`GET /auth/callback`: `takeVerifier({ root, state })`; **null → 400 and stop** → `sb.exchangeCode` → `resolveIdentity` → `startSession` → `sb.revoke` → 303 to `next` or `/onboarding`.

Add the button to `loginPage` and `signupPage` as a plain form posting to `/auth/google` carrying the CSRF token — no JavaScript.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/web-auth-google.test.js && node --check scripts/web/server.mjs`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/web/server.mjs scripts/web/views-auth.mjs test/web-auth-google.test.js
git commit -m "The button exists, and the callback refuses a code it did not send somebody to fetch"
```

---

## Task 11: Password reset

**Files:**
- Modify: `scripts/web/server.mjs`, `scripts/web/views-auth.mjs`
- Create: `test/web-auth-reset.test.js`

**Interfaces:**
- Consumes: `sendRecovery`, `verifyCode` with `type: 'recovery'`, `updatePassword` (Task 3); `destroySessionsForAccount` from `session.mjs`.
- Produces: `GET|POST /auth/reset`, `GET|POST /auth/reset/complete`.

- [ ] **Step 1: Write the failing test**

```js
test('a reset request answers identically for a known and an unknown address', async () => {
  const known = await resetRequest('exists@example.com');
  const unknown = await resetRequest('nobody@example.com');
  assert.equal(known.status, unknown.status);
  assert.equal(known.body, unknown.body);
  assert.equal(known.location, unknown.location);
});

test('a completed reset signs every device out', async () => {
  const { root, accountId, sessionsBefore } = await twoSignedInDevices();
  assert.equal(sessionsBefore.length, 2);
  await completeReset({ accountId, newPassword: 'a-brand-new-passphrase' });
  assert.equal(listSessions({ root }).filter((s) => s.accountId === accountId).length, 0,
    'people reset because somebody else has it');
});

test('another account keeps its sessions', async () => {
  const { root, otherAccountId } = await twoAccountsOneReset();
  assert.ok(listSessions({ root }).some((s) => s.accountId === otherAccountId));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/web-auth-reset.test.js`
Expected: FAIL — 404

- [ ] **Step 3: Write minimal implementation**

Reset uses the same six-digit code shape as signup (`type: 'recovery'`) so a person meets one mechanism, not two. Ordering per spec §5: exchange → resolve → **`updatePassword` while the token is still alive** → `destroySessionsForAccount` → revoke. Add the "Forgot password?" link to `loginPage`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/web-auth-reset.test.js && node --check scripts/web/server.mjs`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/web/server.mjs scripts/web/views-auth.mjs test/web-auth-reset.test.js
git commit -m "A way back in, and every device signed out when somebody takes it"
```

---

## Task 12: The onboarding stub

**Files:**
- Modify: `scripts/web/server.mjs`, `scripts/web/views-auth.mjs`

**Interfaces:** `GET /onboarding`, session required, otherwise 303 to `/login`.

- [ ] **Step 1: Write the failing test**

```js
test('onboarding needs a session and does not ask a signed-in person to sign in', async () => {
  const { base, cookie } = await signedIn();
  const anon = await fetch(`${base}/onboarding`, { redirect: 'manual' });
  assert.equal(anon.status, 303);
  const mine = await fetch(`${base}/onboarding`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(mine.status, 200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/web-auth-code.test.js`
Expected: FAIL — 404

- [ ] **Step 3: Write minimal implementation**

A page that says something true and minimal — the account exists, the free tape is waiting, here is the way to the first upload. **Do not invent onboarding scope**; spec §10 records that what belongs here is unanswered.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/web-auth-code.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/web/server.mjs scripts/web/views-auth.mjs
git commit -m "Somewhere to land, deliberately saying little until somebody decides what it is for"
```

---

## Task 13: Wiring the transport in the one place that may

**Files:**
- Modify: `scripts/web/server-cli.mjs`, `scripts/preflight/doctor.mjs`
- Test: `test/auth-supabase.test.js` (add case)

**This is the task CLAUDE.md's Bug 1 exists to make unskippable.** A unit test of the protocol module passes while production is unwired.

- [ ] **Step 1: Write the failing test**

```js
test('server-cli builds a Supabase client with a real transport', async () => {
  const mod = await import('../scripts/web/server-cli.mjs');
  assert.equal(typeof mod.supabaseFromEnv, 'function');
  const built = mod.supabaseFromEnv({
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    SUPABASE_SECRET_KEY: 'sb_secret_x',
  });
  assert.ok(built, 'production must inject, or the guard fires in production');
  assert.equal(mod.supabaseFromEnv({}), null, 'absent config is null, not a crash');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth-supabase.test.js`
Expected: FAIL — `supabaseFromEnv is not a function`

- [ ] **Step 3: Write minimal implementation**

Export `supabaseFromEnv(env = process.env)` from `server-cli.mjs`, returning `null` when the three values are absent (so the app boots and the auth routes 503 with a sentence, rather than the process dying), and otherwise `createSupabaseAuth({ ..., fetchImpl: globalThis.fetch.bind(globalThis) })`. Pass it into `createServer({ supabase })`. Print `supabase   identity configured` in the existing startup banner beside `checkout   stripe key set`.

In `doctor.mjs`, report all three as present/not-set, **never the values**.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/auth-supabase.test.js` then `node --env-file-if-exists=.env scripts/preflight/doctor.mjs`
Expected: PASS; doctor prints three `present` lines

- [ ] **Step 5: Commit**

```bash
git add scripts/web/server-cli.mjs scripts/preflight/doctor.mjs test/auth-supabase.test.js
git commit -m "The transport is injected where it can be, and a test says so this time"
```

---

## Task 14: The documentation catches up

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Correct §2's deployment claim**

Replace the "Deployment moves earlier" bullet with the corrected text from spec §0.1, including the Google quotation and the fact that the registered redirect is Supabase's callback.

- [ ] **Step 2: Replace the dev login**

`dev@example.com / timestamp-dev-password` no longer works — the domain is not real, so no code can arrive. Update the START HERE two-terminal recipe to sign in with a real address. **A documented credential that does not work is worse than no documented credential.**

- [ ] **Step 3: Record what `npm run accounts -- create` now is**

It can no longer mint a usable password. Say so where it is documented; spec §10 keeps the decision about its future open.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS. `job-model` and `queue-race` may fail under parallel load on Windows — re-run each alone before believing it.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "The handoff stops promising a login that no longer exists, and a cost that never did"
```

---

## Self-Review

**Spec coverage.** §0 decisions 1-5 → Tasks 3-11. §0.1 → Task 14. §1 seam → Task 5. §1.1 storage → Task 4. §3 flows → Tasks 7-11. §3.1 claim path → Task 5. §4.1 → Task 5. §4.2 → Tasks 2, 10. §4.3 → Tasks 3, 9. §4.4 → Task 8. §4.5 → Task 7. §5 transport → Tasks 3, 13. §6 consent → Task 6. §7 breakage → Task 14. §8 tests 1-18 → distributed; **§8 test 14 (`Sb-Forwarded-For`) is covered in Task 3, not in a web test** — the header is set in the protocol module and asserted there. §9 operator steps → owner's, not this plan's, except step 6 which is called out below. §10 stays open.

**Gap deliberately left, and it is not a code task.** Spec §9 step 6 — `{{ .Token }}` in the **Confirm signup** email template — is a dashboard edit only the owner can make, and **nothing in this plan can detect its absence**. Without it Supabase mails a link while `/verify` asks for a code. Do not begin Task 7 without confirming it is done, or the first manual test will fail in a way that looks like a bug in this code and is not.

**Placeholder scan.** No TBD, no "handle errors appropriately", no "similar to Task N". Tasks 6, 8, 9, 11, 12 describe implementations in prose plus exact call ordering rather than full listings, because each is an edit inside an existing handler whose surrounding code the plan cites by line number.

**Type consistency.** `resolveIdentity` returns `{ accountId, created }` in Tasks 5, 8, 9, 10, 11. `identity` is `{ supabaseUserId, email, emailVerified, provider, accessToken }` in Tasks 3 and 5. `takeVerifier` returns `{ verifier, next } | null` in Tasks 2 and 10. `claimAccount`/`findAccountBySupabaseId` named identically in Tasks 4 and 5.
