/**
 * The code-entry page and its attempt limit. Spec §4.5, task 7.
 *
 * WHY THIS FILE HAS A SHARED HARNESS AND SAYS SO. Tasks 8, 9 and 12 add their
 * own cases here and reuse `startWithFakeSupabase`, `postForm` and `getPage`
 * verbatim rather than building their own. Everything below the harness banner
 * is a test; everything above it is the contract those siblings depend on, and
 * is documented for that reason rather than out of thoroughness.
 *
 * WHAT IS FAKE AND WHAT IS NOT. Only the HTTPS transport is faked -- the tests
 * build the REAL `createSupabaseAuth` over an injected `fetchImpl`, so the
 * request shape, the header choice and the one-sentence error collapse are all
 * exercised as shipped. `scripts/auth/accounts.mjs`, `session.mjs`,
 * `credits.mjs`, `identity.mjs` and `pending-signup.mjs` are the real modules
 * against a temporary root: this task's whole subject is whether a verified
 * code becomes exactly one account with exactly one grant, and a fake account
 * store would only prove the fake counts correctly. CLAUDE.md's rule that no
 * test may reach the network is kept by the transport, which is the one thing
 * between this file and Supabase.
 *
 * WHY THE SESSION SECRET IS SEEDED WITH A FIXED VALUE. `sessionSecret()`
 * generates a random key per root, so two servers on two temporary roots mint
 * two different anti-forgery tokens -- and the token is rendered into the page.
 * The §4.5 test that compares three refusal BODIES byte for byte would then
 * compare three random tokens and fail against a perfectly correct server. In
 * production the person retrying holds one token across all three failures, so
 * pinning it here is what isolates the variable actually under test.
 *
 * ONE DELIBERATE DIFFERENCE FROM THE TASK BRIEF'S SNIPPET.
 * `startWithFakeSupabase` takes the test context `t` as its first argument.
 * This repo cleans temp directories with `t.after(...)`, and a harness that
 * could not register its own cleanup would put a `finally` in every caller --
 * which is exactly the thing a sibling task forgets. Every assertion in the
 * brief is otherwise reproduced unchanged.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createServer, CODE_MAX_ATTEMPTS, CODE_COOLOFF_MS, VERIFY_ATTEMPTS_DIR,
  chargeCodeAttempt, clearCodeAttempts, sweepVerifyAttempts,
} from '../scripts/web/server.mjs';
import { CSRF_COOKIE } from '../scripts/web/session-middleware.mjs';
import { createSupabaseAuth } from '../scripts/auth/supabase-auth.mjs';
import { listAccounts, loadAccount } from '../scripts/auth/accounts.mjs';
import { balanceOf } from '../scripts/auth/credits.mjs';
import { signCookie, SESSIONS_DIR, SECRET_FILE } from '../scripts/auth/session.mjs';
import { putPending, takePending } from '../scripts/auth/pending-signup.mjs';
import { CONSENT_TEXT } from '../scripts/safety/consent.mjs';

const CFG = JSON.parse(fs.readFileSync(new URL('../config/render.json', import.meta.url), 'utf8'));

// ---------------------------------------------------------------------------
// harness -- tasks 8, 9 and 12 use everything in this section as it stands
// ---------------------------------------------------------------------------

/** 64 characters, comfortably past `session.mjs`'s 32-byte floor. */
const FIXED_SESSION_SECRET = 'c0de7a5ec0de7a5ec0de7a5ec0de7a5ec0de7a5ec0de7a5ec0de7a5ec0de7a5e';
const CSRF_VALUE = '0123456789abcdef0123456789abcdef';

/** The address every test signs up, and the identity the fake hands back. */
export const TEST_EMAIL = 'a@b.com';
const TEST_SUPABASE_ID = '11111111-2222-3333-4444-555555555555';

/** Consent as `pending-signup.mjs` parks it -- already recorded, so
 *  `normaliseConsent` takes it as-is rather than re-running the gate. */
const PARKED_CONSENT = Object.freeze({
  granted: true, at: '2026-08-26T00:00:00.000Z', text: 'I am in this photo and I agree.',
});

/** The queue the web layer talks to. Nothing in this file enqueues; it exists
 *  because `createServer` refuses to build without one. */
function fakeQueue() {
  const enqueued = [];
  return {
    enqueued,
    enqueue(jobId) { enqueued.push(jobId); },
    peek({ state = 'pending' } = {}) { return state === 'claimed' ? [] : enqueued.map((jobId) => ({ jobId })); },
    stats() { return { pending: enqueued.length, claimed: 0, done: 0, failed: 0 }; },
  };
}

/**
 * Supabase's HTTPS transport, replaced by a function.
 *
 * `reply({ pathname, body, headers })` returns `{ status, json }`. Every call
 * is recorded on `calls` with its url, method, headers and parsed body, which
 * is how a test asserts that the sixth attempt never left the building and
 * that `Sb-Forwarded-For` carries the end user's address rather than ours.
 *
 * @returns {{calls: Array, fetchImpl: Function}}
 */
export function fakeSupabaseTransport(reply) {
  const calls = [];
  async function fetchImpl(url, init = {}) {
    let body = null;
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    const parsed = new URL(String(url));
    const call = {
      url: String(url),
      pathname: parsed.pathname,
      search: parsed.search,
      method: init.method ?? 'GET',
      headers: { ...(init.headers ?? {}) },
      body,
    };
    calls.push(call);
    const answer = (await reply(call)) ?? { status: 200, json: {} };
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      async json() { return answer.json ?? {}; },
    };
  }
  return { calls, fetchImpl };
}

/**
 * The three ways a code entry fails upstream, each with a DIFFERENT status and
 * a different `error_code`. That difference is the point: if any of it reached
 * a page, the §4.5 indistinguishability test would see three shapes instead of
 * one.
 */
const UPSTREAM_REFUSALS = Object.freeze({
  wrong: { status: 403, json: { error_code: 'invalid_otp', msg: 'Token is invalid' } },
  expired: { status: 403, json: { error_code: 'otp_expired', msg: 'Token has expired or is invalid' } },
  'unknown-address': { status: 400, json: { error_code: 'user_not_found', msg: 'User not found' } },
  invalid_credentials: { status: 400, json: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' } },
  email_not_confirmed: { status: 400, json: { error_code: 'email_not_confirmed', msg: 'Email not confirmed' } },
  over_request_rate_limit: { status: 429, json: { error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' } },
  'user-already-registered': { status: 422, json: { error_code: 'user_already_exists', msg: 'User already registered' } },
  boom: { status: 500, json: { msg: 'internal error' } },
});

/** What Supabase answers with when a code is right. */
function identityReply({ email = TEST_EMAIL, supabaseUserId = TEST_SUPABASE_ID } = {}) {
  return {
    status: 200,
    json: {
      access_token: 'supabase-access-token-for-this-person',
      refresh_token: 'supabase-refresh-token',
      user: {
        id: supabaseUserId,
        email,
        email_confirmed_at: '2026-08-26T09:00:00.000Z',
      },
    },
  };
}

/**
 * Start a server whose only fake is the Supabase transport.
 *
 * @param {object} t                 the node:test context, for cleanup
 * @param {object} [opts]
 * @param {string} [opts.correctCode]  the code `POST /verify` accepts
 * @param {string} [opts.failWith]     a key of `UPSTREAM_REFUSALS`; every code
 *                                     entry fails that way, whatever was typed
 * @param {Function} [opts.reply]      full override of the transport's answers
 * @param {boolean} [opts.withSupabase] false builds the server with `supabase: null`
 * @param {boolean} [opts.trustProxy]  whether `x-forwarded-for` is believed
 * @param {object|null} [opts.pendingConsent] consent to park for `email` first
 * @param {string} [opts.email]        the address the fake identity carries
 * @returns {Promise<{base,root,app,csrf,cookie,calls,transport,supabase}>}
 */
export async function startWithFakeSupabase(t, {
  correctCode = '123456',
  failWith = null,
  reply = null,
  withSupabase = true,
  trustProxy = false,
  pendingConsent = PARKED_CONSENT,
  email = TEST_EMAIL,
  supabaseUserId = TEST_SUPABASE_ID,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-code-'));

  // Seeded before anything reads it, so every server in a test signs the same
  // anti-forgery token -- see the file header.
  const secretDir = path.join(root, ...SESSIONS_DIR.split('/'));
  fs.mkdirSync(secretDir, { recursive: true });
  fs.writeFileSync(path.join(secretDir, SECRET_FILE), FIXED_SESSION_SECRET, 'utf8');

  if (pendingConsent) putPending({ root, email, consent: pendingConsent });

  const answer = reply ?? (async ({ pathname, body }) => {
    if (pathname.endsWith('/auth/v1/verify')) {
      if (failWith) return UPSTREAM_REFUSALS[failWith];
      if (body?.token !== correctCode) return UPSTREAM_REFUSALS.wrong;
      return identityReply({ email: body?.email ?? email, supabaseUserId });
    }
    if (pathname.endsWith('/auth/v1/signup')) {
      if (failWith) return UPSTREAM_REFUSALS[failWith];
      return { status: 200, json: { user: { id: supabaseUserId, email } } };
    }
    if (pathname.endsWith('/auth/v1/token')) {
      if (failWith) return UPSTREAM_REFUSALS[failWith];
      return identityReply({ email, supabaseUserId });
    }
    if (pathname.endsWith('/auth/v1/logout')) return { status: 204, json: {} };
    return { status: 200, json: {} };
  });

  const transport = fakeSupabaseTransport(answer);
  const supabase = withSupabase
    ? createSupabaseAuth({
      url: 'https://project-ref.supabase.co',
      publishableKey: 'sb_publishable_test',
      secretKey: 'sb_secret_test',
      fetchImpl: transport.fetchImpl,
    })
    : null;

  const app = createServer({
    root,
    cfg: CFG,
    queue: fakeQueue(),
    port: 0,
    supabase,
    trustProxy,
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed',
    logImpl: () => {},
  });
  const port = await app.listen();

  t.after(async () => {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  return {
    base: `http://127.0.0.1:${port}`,
    root,
    app,
    supabase,
    transport,
    calls: transport.calls,
    csrf: signCookie(CSRF_VALUE, FIXED_SESSION_SECRET),
    cookie: `${CSRF_COOKIE}=${signCookie(CSRF_VALUE, FIXED_SESSION_SECRET)}`,
  };
}

/** A browser's form POST: url-encoded, cookie attached, redirects not followed. */
export function postForm(url, fields, cookie = '', { accept = 'text/html', headers = {} } = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept, cookie, ...headers },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });
}

/** A browser's GET. */
export function getPage(url, cookie = '', { accept = 'text/html', headers = {} } = {}) {
  return fetch(url, { headers: { accept, cookie, ...headers }, redirect: 'manual' });
}

/** Status, body, and the two headers these tests keep asking about, read once
 *  so a caller can compare whole shapes instead of four fields by hand. */
export async function shapeOf(res) {
  return {
    status: res.status,
    body: await res.text(),
    location: res.headers.get('location'),
    setCookie: res.headers.getSetCookie().join('\n') || null,
    contentType: res.headers.get('content-type'),
  };
}

// ---------------------------------------------------------------------------
// the counter itself, without a socket in the way
// ---------------------------------------------------------------------------

const HASH_A = 'a'.repeat(64);
const tmpRoot = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-attempts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test('a counter allows exactly five and then nothing', (t) => {
  const root = tmpRoot(t);
  const at = new Date('2026-08-26T10:00:00.000Z');
  for (let i = 1; i <= CODE_MAX_ATTEMPTS; i += 1) {
    const spent = chargeCodeAttempt({ root, hash: HASH_A, nowImpl: () => at });
    assert.deepEqual(spent, { allowed: true, attempts: i });
  }
  assert.deepEqual(chargeCodeAttempt({ root, hash: HASH_A, nowImpl: () => at }),
    { allowed: false, attempts: CODE_MAX_ATTEMPTS });
});

test('the window is anchored at the first attempt and is never extended by a refusal', (t) => {
  // Extending it on every knock would let anybody keep a stranger's address
  // locked out of confirmation forever simply by continuing to knock.
  const root = tmpRoot(t);
  const start = Date.parse('2026-08-26T10:00:00.000Z');
  for (let i = 0; i < CODE_MAX_ATTEMPTS; i += 1) {
    chargeCodeAttempt({ root, hash: HASH_A, nowImpl: () => new Date(start) });
  }
  // Hammering all the way to the edge of the window.
  for (let ms = 1000; ms < CODE_COOLOFF_MS; ms += CODE_COOLOFF_MS / 8) {
    assert.equal(chargeCodeAttempt({ root, hash: HASH_A, nowImpl: () => new Date(start + ms) }).allowed, false);
  }
  assert.equal(chargeCodeAttempt({ root, hash: HASH_A, nowImpl: () => new Date(start + CODE_COOLOFF_MS) }).allowed,
    true, 'the address never recovers');
});

test('a counter that cannot be read fails closed and heals itself after the cool-off', (t) => {
  // A torn write that reads back as "no attempts yet" is five free guesses,
  // which is the wrong direction to fail in.
  const root = tmpRoot(t);
  const dir = path.join(root, ...VERIFY_ATTEMPTS_DIR.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${HASH_A}.json`), '{"attempts":2,"first', 'utf8');
  const start = Date.parse('2026-08-26T10:00:00.000Z');
  assert.equal(chargeCodeAttempt({ root, hash: HASH_A, nowImpl: () => new Date(start) }).allowed, false);
  assert.equal(chargeCodeAttempt({ root, hash: HASH_A, nowImpl: () => new Date(start + CODE_COOLOFF_MS) }).allowed,
    true, 'a corrupt file locked the address out permanently');
});

test('a key that is not an email hash is refused rather than waved through', (t) => {
  const root = tmpRoot(t);
  for (const hash of ['', null, '../../etc/passwd', 'A'.repeat(64), 'a'.repeat(63)]) {
    assert.equal(chargeCodeAttempt({ root, hash }).allowed, false, `${hash} bought an uncounted lane`);
  }
});

test('the sweeper removes counters whose cool-off has passed and leaves live ones', (t) => {
  const root = tmpRoot(t);
  const start = Date.parse('2026-08-26T10:00:00.000Z');
  chargeCodeAttempt({ root, hash: HASH_A, nowImpl: () => new Date(start) });
  chargeCodeAttempt({ root, hash: 'b'.repeat(64), nowImpl: () => new Date(start + CODE_COOLOFF_MS) });
  assert.equal(sweepVerifyAttempts({ root, nowImpl: () => new Date(start + CODE_COOLOFF_MS + 1) }), 1);
  assert.deepEqual(fs.readdirSync(path.join(root, ...VERIFY_ATTEMPTS_DIR.split('/'))), [`${'b'.repeat(64)}.json`]);
  assert.equal(sweepVerifyAttempts({ root: path.join(root, 'nothing-here') }), 0, 'a missing directory is not an error');
});

test('clearing is idempotent and never throws on an address with no counter', (t) => {
  const root = tmpRoot(t);
  clearCodeAttempts({ root, hash: HASH_A });
  chargeCodeAttempt({ root, hash: HASH_A });
  clearCodeAttempts({ root, hash: HASH_A });
  clearCodeAttempts({ root, hash: HASH_A });
  assert.deepEqual(chargeCodeAttempt({ root, hash: HASH_A }), { allowed: true, attempts: 1 });
});

// ---------------------------------------------------------------------------
// §4.5 -- the attempt limit IS the feature
// ---------------------------------------------------------------------------

test('the code dies after five wrong answers, and the sixth fails even when correct', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, { correctCode: '123456' });
  for (let i = 0; i < 5; i += 1) {
    const res = await postForm(`${base}/verify`, { email: 'a@b.com', code: '000000', csrf }, cookie);
    assert.equal(res.status, 401, `attempt ${i + 1} should be refused`);
  }
  const res = await postForm(`${base}/verify`, { email: 'a@b.com', code: '123456', csrf }, cookie);
  assert.equal(res.status, 401, 'the limit is a limit, not a message');
  assert.ok(!res.headers.get('set-cookie'), 'and no session is minted');
});

test('the sixth attempt never reaches Supabase at all', async (t) => {
  // Counting BEFORE the call is what makes this true: a limit enforced on the
  // way back is a limit a crash resets, and one that still spends an upstream
  // request is a limit an attacker can use as a free relay.
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, { correctCode: '123456' });
  for (let i = 0; i < 6; i += 1) {
    await postForm(`${base}/verify`, { email: 'a@b.com', code: '000000', csrf }, cookie);
  }
  const verifies = calls.filter((c) => c.pathname.endsWith('/auth/v1/verify'));
  assert.equal(verifies.length, CODE_MAX_ATTEMPTS,
    'the dead code must be refused here, not asked about upstream');
});

test('wrong, expired, and never-signed-up answer identically', async (t) => {
  const shapes = [];
  for (const kind of ['wrong', 'expired', 'unknown-address']) {
    const { base, csrf, cookie } = await startWithFakeSupabase(t, { failWith: kind });
    const res = await postForm(`${base}/verify`, { email: 'a@b.com', code: '000000', csrf }, cookie);
    shapes.push({ status: res.status, body: await res.text() });
  }
  assert.equal(new Set(shapes.map((s) => s.status)).size, 1, 'statuses differ');
  assert.equal(new Set(shapes.map((s) => s.body)).size, 1, 'bodies differ — that is the oracle');
  // Three 404s are also identical. Pinning the status is what stops this
  // passing against a route that does not exist.
  assert.equal(shapes[0].status, 401, 'a refused code is a 401');
});

test('the three refusals match on every header a client can read, not only on the body', async (t) => {
  const shapes = [];
  for (const kind of ['wrong', 'expired', 'unknown-address']) {
    const { base, csrf, cookie } = await startWithFakeSupabase(t, { failWith: kind });
    const res = await postForm(`${base}/verify`, { email: 'a@b.com', code: '000000', csrf }, cookie);
    assert.equal(res.status, 401, 'a refused code is a 401');
    // `Date` moves with the wall clock and discloses nothing about the address;
    // comparing it would make this test fail whenever a second ticked between
    // two of the three requests, which is a flake and not a finding.
    const headers = [...res.headers]
      .filter(([k]) => k.toLowerCase() !== 'date')
      .map(([k, v]) => `${k}: ${v}`).sort().join('\n');
    shapes.push(headers);
    await res.text();
  }
  assert.equal(new Set(shapes).size, 1, `a header differs between the three failures:\n${[...new Set(shapes)].join('\n---\n')}`);
});

test('nothing Supabase said about the failure reaches the page', async (t) => {
  for (const kind of ['wrong', 'expired', 'unknown-address', 'over_request_rate_limit', 'boom']) {
    const { base, csrf, cookie } = await startWithFakeSupabase(t, { failWith: kind });
    const res = await postForm(`${base}/verify`, { email: 'a@b.com', code: '000000', csrf }, cookie);
    assert.equal(res.status, 401, `a refused code is a 401, whatever ${kind} was upstream`);
    const body = await res.text();
    for (const leak of ['otp_expired', 'invalid_otp', 'user_not_found', 'over_request_rate_limit',
      'error_code', 'SupabaseAuthError', 'supabase']) {
      assert.ok(!body.toLowerCase().includes(leak.toLowerCase()),
        `${kind} leaked ${leak} onto the page`);
    }
    assert.ok(!/\b(403|422|429|500)\b/.test(body), `${kind} leaked an upstream status onto the page`);
  }
});

test('a correct code signs the person in and lands them on onboarding', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, { correctCode: '123456' });
  const res = await postForm(`${base}/verify`, { email: 'a@b.com', code: '123456', csrf }, cookie);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/onboarding');
  assert.match(res.headers.get('set-cookie') ?? '', /timestamp_session=/);
});

test('a consumed code cannot be replayed into a second account or a second grant', async (t) => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, { correctCode: '123456' });
  await postForm(`${base}/verify`, { email: 'a@b.com', code: '123456', csrf }, cookie);
  const before = listAccounts({ root }).length;
  const credited = balanceOf(loadAccount({ root, accountId: listAccounts({ root })[0].accountId })).credits;
  await postForm(`${base}/verify`, { email: 'a@b.com', code: '123456', csrf }, cookie);
  assert.equal(listAccounts({ root }).length, before, 'no second account');
  assert.equal(
    balanceOf(loadAccount({ root, accountId: listAccounts({ root })[0].accountId })).credits,
    credited,
    'and no second grant',
  );
});

test('the code that opened the account carried the consent parked at signup', async (t) => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, { correctCode: '123456' });
  await postForm(`${base}/verify`, { email: 'a@b.com', code: '123456', csrf }, cookie);
  const account = loadAccount({ root, accountId: listAccounts({ root })[0].accountId });
  assert.equal(account.consent?.granted, true, 'the account was created without a consent record');
  assert.equal(account.consent?.text, PARKED_CONSENT.text);
});

test('a success clears the counter, so a person who fumbled four times is not punished later', async (t) => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, { correctCode: '123456' });
  for (let i = 0; i < 4; i += 1) {
    await postForm(`${base}/verify`, { email: 'a@b.com', code: '000000', csrf }, cookie);
  }
  const ok = await postForm(`${base}/verify`, { email: 'a@b.com', code: '123456', csrf }, cookie);
  assert.equal(ok.status, 303);
  const attempts = path.join(root, 'out', 'verify-attempts');
  assert.deepEqual(fs.existsSync(attempts) ? fs.readdirSync(attempts) : [], [],
    'the attempt record survived a successful confirmation');
});

// ---------------------------------------------------------------------------
// the ways the counter could be bypassed, each closed on purpose
// ---------------------------------------------------------------------------

test('a different casing of the same address spends the same five attempts', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, { correctCode: '123456' });
  const spellings = ['a@b.com', 'A@B.com', ' a@B.COM ', 'A@b.COM', 'a@B.com'];
  for (const [i, spelling] of spellings.entries()) {
    const res = await postForm(`${base}/verify`, { email: spelling, code: '000000', csrf }, cookie);
    assert.equal(res.status, 401, `attempt ${i + 1} should be refused`);
  }
  const res = await postForm(`${base}/verify`, { email: 'A@B.COM', code: '123456', csrf }, cookie);
  assert.equal(res.status, 401, 'changing the casing bought five more guesses');
});

test('asking for a new code does not hand back the five guesses already spent', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, { correctCode: '123456' });
  for (let i = 0; i < 5; i += 1) {
    await postForm(`${base}/verify`, { email: 'a@b.com', code: '000000', csrf }, cookie);
  }
  const resend = await postForm(`${base}/verify/resend`, { email: 'a@b.com', csrf }, cookie);
  assert.ok([200, 303].includes(resend.status), `resend answered ${resend.status}`);
  const res = await postForm(`${base}/verify`, { email: 'a@b.com', code: '123456', csrf }, cookie);
  assert.equal(res.status, 401, 'a resend reset the attempt counter, which is the whole bypass');
});

test('a post that cannot prove it came from this form spends nothing and asks nothing', async (t) => {
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, { correctCode: '123456' });
  const forged = await postForm(`${base}/verify`, { email: 'a@b.com', code: '123456', csrf: 'not-a-token' }, cookie);
  assert.equal(forged.status, 403);
  assert.equal(calls.length, 0, 'the credential was looked at before the token was');

  // And the refusal did not burn one of the five.
  for (let i = 0; i < 5; i += 1) {
    const res = await postForm(`${base}/verify`, { email: 'a@b.com', code: '000000', csrf }, cookie);
    assert.equal(res.status, 401, `attempt ${i + 1} should still be available`);
  }
});

test('a cross-site post is refused before the body is read', async (t) => {
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, { correctCode: '123456' });
  const res = await postForm(`${base}/verify`, { email: 'a@b.com', code: '123456', csrf }, cookie,
    { headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test('one address cannot be walked from one connection past the per-IP bound', async (t) => {
  // The per-IP limiter is the third of §4.5's three bounds and is the one that
  // stops an attacker cycling addresses rather than codes.
  const { base, csrf, cookie } = await startWithFakeSupabase(t, { correctCode: '123456' });
  let sawLimit = false;
  for (let i = 0; i < 40; i += 1) {
    const res = await postForm(`${base}/verify`, { email: `p${i}@b.com`, code: '000000', csrf }, cookie);
    if (res.status === 429) { sawLimit = true; await res.text(); break; }
    await res.text();
  }
  assert.ok(sawLimit, 'the per-IP limiter never fired on /verify');
});

// ---------------------------------------------------------------------------
// the page, and the address that reaches it
// ---------------------------------------------------------------------------

test('the code page is reachable with no session and takes the address in the query', async (t) => {
  const { base } = await startWithFakeSupabase(t, {});
  const res = await getPage(`${base}/verify?email=${encodeURIComponent('a@b.com')}`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(body.includes('a@b.com'), 'the page does not say where the code went');
  assert.match(body, /name="code"/);
  assert.match(body, /inputmode="numeric"/);
  assert.match(body, /autocomplete="one-time-code"/);
  assert.match(body, /maxlength="6"/);
  assert.match(body, /name="csrf"/);
  assert.match(body, /60 seconds|a minute/i, 'the resend control does not state the rule');
});

test('an address the account store refuses is refused the same way a wrong code is', async (t) => {
  // `a@b..com` passes the web layer's shape test and fails `normaliseEmail`,
  // which THROWS. Uncaught that is a 500, which is a different answer for a
  // different input -- the enumeration oracle arriving through a crash.
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, { correctCode: '123456' });
  const odd = await postForm(`${base}/verify`, { email: 'a@b..com', code: '123456', csrf }, cookie);
  const ordinary = await postForm(`${base}/verify`, { email: 'a@b.com', code: '000000', csrf }, cookie);
  assert.equal(odd.status, 401);
  assert.equal(ordinary.status, 401);
  assert.equal(calls.filter((c) => c.pathname.endsWith('/auth/v1/verify')).length, 1,
    'an unusable address was still sent upstream');
});

test('an address in the query cannot write markup into the page', async (t) => {
  const { base } = await startWithFakeSupabase(t, {});
  const res = await getPage(`${base}/verify?email=${encodeURIComponent('"><script>alert(1)</script>')}`);
  assert.equal(res.status, 200, 'the page must exist for this check to mean anything');
  const body = await res.text();
  assert.ok(!body.includes('<script>alert(1)</script>'), 'the address was rendered as markup');
  assert.ok(body.includes('&lt;script&gt;'), 'the address was dropped rather than escaped');
});

// ---------------------------------------------------------------------------
// the end user's address, and whose it is
// ---------------------------------------------------------------------------

test('Supabase is told the end user address, and never one a caller typed', async (t) => {
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, { correctCode: '999999' });
  await postForm(`${base}/verify`, { email: 'a@b.com', code: '000000', csrf }, cookie,
    { headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.4' } });
  const call = calls.find((c) => c.pathname.endsWith('/auth/v1/verify'));
  assert.ok(call, 'no upstream call was made');
  assert.ok(call.headers['Sb-Forwarded-For'], 'the per-user rate-limit header was not sent');
  assert.notEqual(call.headers['Sb-Forwarded-For'], '203.0.113.9',
    'a header the client typed decided who Supabase rate-limits');
});

test('behind a proxy this deployment actually has, the forwarded address is believed', async (t) => {
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t,
    { correctCode: '999999', trustProxy: true });
  await postForm(`${base}/verify`, { email: 'a@b.com', code: '000000', csrf }, cookie,
    { headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.4' } });
  const call = calls.find((c) => c.pathname.endsWith('/auth/v1/verify'));
  assert.equal(call.headers['Sb-Forwarded-For'], '203.0.113.9',
    'the leftmost forwarded address is the client');
});

// ---------------------------------------------------------------------------
// no Supabase configured -- the app still boots and still serves
// ---------------------------------------------------------------------------

test('a server with no Supabase boots, 503s the identity routes, and serves the rest', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, { withSupabase: false });

  const page = await getPage(`${base}/verify?email=a%40b.com`);
  assert.equal(page.status, 503);
  await page.text();

  const posted = await postForm(`${base}/verify`, { email: 'a@b.com', code: '123456', csrf }, cookie);
  assert.equal(posted.status, 503);
  assert.ok(!posted.headers.get('set-cookie'), 'a 503 must not mint anything');
  await posted.text();

  const css = await getPage(`${base}/styles.css`, '', { accept: 'text/css' });
  assert.equal(css.status, 200, 'the rest of the app stopped serving');
  await css.text();
});

test('a JSON client is told the same thing in its own dialect', async (t) => {
  const { base } = await startWithFakeSupabase(t, { withSupabase: false });
  const res = await getPage(`${base}/verify?email=a%40b.com`, '', { accept: 'application/json' });
  assert.equal(res.status, 503);
  const payload = await res.json();
  assert.equal(payload.error.status, 503);
  assert.equal(typeof payload.error.message, 'string');
});

// ---------------------------------------------------------------------------
// task 8 -- signup goes to Supabase, and stops confirming who exists
// ---------------------------------------------------------------------------

/**
 * `startWithFakeSupabase` defaults to a pending consent already parked for
 * `TEST_EMAIL` -- correct for the `/verify` tests above, which start midway
 * through the flow, and wrong here: signup is what does the parking, so a
 * test of signup must start with nothing parked or it cannot tell its own
 * write from the fixture's.
 *
 * `password` is a fixed 24 characters, comfortably past the 10-character
 * floor `signup` still enforces unchanged.
 */
async function signupThrough(t, { upstream = 'ok', email = TEST_EMAIL, password = 'a genuinely long password' } = {}) {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {
    pendingConsent: null,
    failWith: upstream === 'ok' ? null : upstream,
  });
  const res = await postForm(`${base}/signup`, { email, password, consent: 'on', csrf }, cookie);
  return shapeOf(res);
}

test('signup for an address that already exists is indistinguishable from a new one', async (t) => {
  // Supabase answers `user_already_exists` / 422 for a taken address unless
  // BOTH email and phone confirmation are on; this project has phone off
  // (verified against the live project 2026-08-26), so it takes the leaking
  // path. Closing it by adopting SMS would mean paying Twilio to hide a
  // string, so this handler renders the same page either way -- and this is
  // the test that proves it does.
  const fresh = await signupThrough(t, { upstream: 'ok' });
  const taken = await signupThrough(t, { upstream: 'user-already-registered' });
  assert.equal(fresh.status, taken.status);
  assert.equal(fresh.location, taken.location);
  assert.equal(fresh.body, taken.body, 'Supabase leaks it; we must not pass it on');
  assert.equal(fresh.contentType, taken.contentType);
});

test('signup parks the consent and mints no session', async (t) => {
  const res = await signupThrough(t, { upstream: 'ok' });
  assert.equal(res.status, 303);
  assert.match(res.location, /^\/verify\?email=/);
  assert.ok(!res.setCookie, 'nobody is signed in until the mailbox is proved');
});

test('the parked consent is exactly what takePending later hands to resolveIdentity', async (t) => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, { pendingConsent: null });
  const res = await postForm(`${base}/signup`, { email: TEST_EMAIL, password: 'a genuinely long password', consent: 'on', csrf }, cookie);
  assert.equal(res.status, 303);
  const parked = takePending({ root, email: TEST_EMAIL });
  assert.ok(parked, 'signup did not park a consent record for /verify to find');
  assert.equal(parked.consent.granted, true);
  assert.equal(parked.consent.text, CONSENT_TEXT);
});

test('nothing SupabaseAuthError carries reaches the signup response, upstream failure or not', async (t) => {
  for (const kind of ['user-already-registered', 'over_request_rate_limit', 'boom']) {
    const res = await signupThrough(t, { upstream: kind });
    assert.equal(res.status, 303, `signup must answer the same way whatever ${kind} was upstream`);
    for (const leak of ['user_already_exists', 'over_request_rate_limit', 'error_code', 'SupabaseAuthError', 'supabase']) {
      assert.ok(!res.body.toLowerCase().includes(leak.toLowerCase()), `${kind} leaked ${leak} onto the page`);
    }
    assert.ok(!/\b(422|429|500)\b/.test(res.body), `${kind} leaked an upstream status onto the page`);
  }
});

test('a signup post that cannot prove it came from this form is refused, and Supabase is never asked', async (t) => {
  const { base, cookie, calls } = await startWithFakeSupabase(t, { pendingConsent: null });
  const res = await postForm(`${base}/signup`, {
    email: TEST_EMAIL, password: 'a genuinely long password', consent: 'on', csrf: 'not-a-token',
  }, cookie);
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0, 'the credential was looked at before Supabase was');
});

test('a JSON client is told 202 and the same next, whichever branch Supabase took', async (t) => {
  const shapes = [];
  for (const upstream of ['ok', 'user-already-registered']) {
    const { base, csrf, cookie } = await startWithFakeSupabase(t, {
      pendingConsent: null,
      failWith: upstream === 'ok' ? null : upstream,
    });
    const res = await postForm(`${base}/signup`,
      { email: TEST_EMAIL, password: 'a genuinely long password', consent: 'on', csrf }, cookie,
      { accept: 'application/json' });
    shapes.push(await shapeOf(res));
  }
  for (const shape of shapes) {
    assert.equal(shape.status, 202);
    assert.deepEqual(JSON.parse(shape.body), { next: `/verify?email=${encodeURIComponent(TEST_EMAIL)}` });
  }
  assert.equal(shapes[0].body, shapes[1].body);
});

// ---------------------------------------------------------------------------
// task 9 -- login goes to Supabase: exchange -> resolve -> use -> revoke
// ---------------------------------------------------------------------------

/**
 * `startWithFakeSupabase`'s default parked consent and `/auth/v1/token`
 * handling are both already shaped for this: a password grant answers with
 * the same `identityReply()` a code confirmation does, so the harness needs
 * no changes for login to reuse it.
 */
async function loginThrough(t, { upstream = 'ok', email = TEST_EMAIL, password = 'whatever the person typed' } = {}) {
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, {
    failWith: upstream === 'ok' ? null : upstream,
  });
  const res = await postForm(`${base}/login`, { email, password, csrf }, cookie);
  return { ...(await shapeOf(res)), calls };
}

test('every upstream login failure renders one sentence', async (t) => {
  for (const kind of ['invalid_credentials', 'email_not_confirmed', 'over_request_rate_limit']) {
    const res = await loginThrough(t, { upstream: kind });
    assert.equal(res.status, 401);
    assert.match(res.body, /do not match an account/);
    assert.ok(!/confirm/i.test(res.body), `leaked confirmation state for ${kind}`);
  }
});

test('a good login mints our session and revokes theirs', async (t) => {
  const res = await loginThrough(t, { upstream: 'ok' });
  assert.match(res.setCookie ?? '', /timestamp_session=/);
  assert.ok(res.calls.some((c) => c.url.includes('/logout')), 'revoke at the door');
});

/**
 * Nothing `SupabaseAuthError` carries -- `.code`, `.status`, `.message` -- may
 * reach the page, whatever upstream said. Same shape as the equivalent check
 * on `/verify` and `/signup`.
 */
test('nothing Supabase said about a login failure reaches the page', async (t) => {
  for (const kind of ['invalid_credentials', 'email_not_confirmed', 'over_request_rate_limit', 'boom']) {
    const res = await loginThrough(t, { upstream: kind });
    assert.equal(res.status, 401, `a refused login is a 401, whatever ${kind} was upstream`);
    for (const leak of ['invalid_credentials', 'email_not_confirmed', 'over_request_rate_limit',
      'error_code', 'SupabaseAuthError', 'supabase']) {
      assert.ok(!res.body.toLowerCase().includes(leak.toLowerCase()), `${kind} leaked ${leak} onto the page`);
    }
    assert.ok(!/\b(400|403|429|500)\b/.test(res.body), `${kind} leaked an upstream status onto the page`);
  }
});

test('a login post that cannot prove it came from this form is refused, and Supabase is never asked', async (t) => {
  const { base, cookie, calls } = await startWithFakeSupabase(t, {});
  const res = await postForm(`${base}/login`, { email: TEST_EMAIL, password: 'whatever', csrf: 'not-a-token' }, cookie);
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0, 'the credential was looked at before Supabase was');
});

test('a server with no Supabase 503s /login too, and mints no session', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, { withSupabase: false });
  const posted = await postForm(`${base}/login`, { email: TEST_EMAIL, password: 'whatever', csrf }, cookie);
  assert.equal(posted.status, 503);
  assert.ok(!posted.headers.get('set-cookie'), 'a 503 must not mint anything');
});
