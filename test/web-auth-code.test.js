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
 * @param {object} [opts.queue]        a queue with more opinions than the
 *                                     do-nothing default -- the account-deletion
 *                                     tests hand one whose `peek` can hold a lease
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
  queue = null,
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
    queue: queue ?? fakeQueue(),
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

/**
 * The page with every drawn mark removed.
 *
 * The leak checks below scan the WHOLE body for a bare upstream status code,
 * which was exactly right while the wordmark was the literal text "TIMESTAMP".
 * It is now drawn letterforms -- thousands of path coordinates -- so a token
 * like 500 turning up somewhere among them is certain, constant, and means
 * nothing at all.
 *
 * Stripping only <svg> keeps the check as strict as it ever was for every part
 * of the page that can actually carry a sentence to a person, rather than
 * relaxing the pattern and losing the guarantee to save a line.
 */
export const withoutMarks = (html) => String(html).replace(/<svg[\s\S]*?<\/svg>/gi, '');

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
    assert.ok(!/\b(403|422|429|500)\b/.test(withoutMarks(body)), `${kind} leaked an upstream status onto the page`);
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

// ---------------------------------------------------------------------------
// the resend itself -- the one gap in this slice that could strand a real
// person. `/verify/resend` used to 303 back to /signup, on the assumption that
// repeating a signup makes Supabase re-send the confirmation to an unconfirmed
// address. That behaviour was never observed against the live project, and if
// it does not hold, somebody whose code never arrived loops /verify ->
// /signup -> /verify forever. These three tests pin the documented endpoint
// instead, so nothing here depends on the guess.
// ---------------------------------------------------------------------------

test('asking for a new code asks Supabase to send one, and leaves the person on the page that takes it', async (t) => {
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, { correctCode: '123456' });

  const res = await postForm(`${base}/verify/resend`, { email: 'a@b.com', csrf }, cookie);
  assert.equal(res.status, 200);
  const body = await res.text();

  const sent = calls.filter((c) => c.pathname.endsWith('/auth/v1/resend'));
  assert.equal(sent.length, 1, 'nothing was asked of Supabase, so no new code exists');
  assert.deepEqual(sent[0].body, { type: 'signup', email: 'a@b.com' });

  // The whole point of the change: the person stays here with the field in
  // front of them, instead of being sent back to re-type a password to get a
  // code they already asked for.
  assert.match(body, /name="code"/, 'the person was moved off the page that takes the code');
  assert.ok(body.includes('a@b.com'), 'the page no longer says where the code went');
  assert.match(body, /class="notice"/, 'nothing on the page says a code was asked for');
  assert.match(body, /on its way/i);
});

test('a resend answers identically whether Supabase sends the code, refuses it, or cannot be reached', async (t) => {
  // Same contract as `/verify` itself: "that address is not waiting to be
  // confirmed" tells a stranger which addresses have accounts on a service
  // that stores photographs of faces. Four upstream outcomes, one answer.
  const upstream = [
    async () => ({ status: 200, json: {} }),
    async () => ({ status: 400, json: { error_code: 'user_not_found', msg: 'User not found' } }),
    async () => ({ status: 429, json: { error_code: 'over_email_send_rate_limit', msg: 'slow down' } }),
    async () => { throw new Error('ECONNRESET'); },
  ];
  const shapes = [];
  for (const reply of upstream) {
    const { base, csrf, cookie } = await startWithFakeSupabase(t, { reply });
    const res = await postForm(`${base}/verify/resend`, { email: 'a@b.com', csrf }, cookie);
    shapes.push(await shapeOf(res));
  }
  for (const [i, shape] of shapes.slice(1).entries()) {
    assert.deepEqual(shape, shapes[0], `upstream outcome ${i + 1} is distinguishable from a success`);
  }
});

test('a resend for something that is not an address is answered the same way and never reaches Supabase', async (t) => {
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, {});
  const res = await postForm(`${base}/verify/resend`, { email: 'not-an-address', csrf }, cookie);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /on its way/i, 'a malformed address is distinguishable from a real one');
  assert.equal(calls.filter((c) => c.pathname.endsWith('/auth/v1/resend')).length, 0,
    'an unusable address was still sent upstream');
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

// ---------------------------------------------------------------------------
// THE ORIGIN CHECK, AGAINST WHAT A REAL BROWSER ACTUALLY SENDS
//
// Every page this app serves carries `Referrer-Policy: no-referrer`. Chrome
// answers that by sending `Origin: null` on a form POST -- INCLUDING a
// same-origin one. Measured 2026-08-27 with a two-page probe differing in that
// one header: with it, `origin="null" sec-fetch-site=same-origin`; without it,
// `origin="http://localhost:3100"`. `new URL('null')` throws, so the old check
// read its own pages as forgeries and REFUSED EVERY FORM IN THE APP -- signup,
// sign-in, verify, resend, reset and the Google button alike.
//
// The suite did not catch it because it only ever exercised the two origins a
// browser does not send here: absent (undici's default, accepted) and
// `https://evil.example` (refused). The value real browsers produce was
// untested, so 1568 tests passed against an app nobody could sign up to.
//
// `Sec-Fetch-Site` is the browser's own account of the request. Page script
// cannot set it -- it is a forbidden header name -- so it is a better witness
// than `Origin`, which the referrer policy is entitled to blank.
// ---------------------------------------------------------------------------

test('a form post from this app\'s own page is accepted even though the browser blanked the Origin', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  const res = await postForm(`${base}/verify/resend`, { email: 'a@b.com', csrf }, cookie, {
    headers: { origin: 'null', 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(res.status, 200, 'the app refuses the only kind of form post a real browser makes');
});

test('an opaque origin the browser itself calls cross-site is still refused', async (t) => {
  // The sandboxed-iframe case the old `catch { return false }` was written for.
  // It is still refused -- now on the browser's word rather than on a parse
  // failure that could not tell the two apart.
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  const res = await postForm(`${base}/verify/resend`, { email: 'a@b.com', csrf }, cookie, {
    headers: { origin: 'null', 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(res.status, 403);
});

test('same-site is not same-origin, and a sibling subdomain is refused', async (t) => {
  // `same-site` means the registrable domain matches, not the origin. A
  // subdomain an attacker controls is same-site and must not be same-origin.
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  const res = await postForm(`${base}/verify/resend`, { email: 'a@b.com', csrf }, cookie, {
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'same-site' },
  });
  assert.equal(res.status, 403);
});

test('the browser\'s account of the request beats an Origin header that agrees with Host', async (t) => {
  // A matching `Origin` is only as trustworthy as whoever set it. When the
  // browser says the request came from somewhere else, that wins.
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  const res = await postForm(`${base}/verify/resend`, { email: 'a@b.com', csrf }, cookie, {
    headers: { origin: base, 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(res.status, 403);
});

test('a client that sends no Sec-Fetch-Site still falls back to the Origin check, both ways', async (t) => {
  // curl, a server-to-server caller, and every test above this line. The old
  // behaviour has to survive exactly as it was for them.
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  const absent = await postForm(`${base}/verify/resend`, { email: 'a@b.com', csrf }, cookie);
  assert.equal(absent.status, 200, 'no Origin and no Sec-Fetch-Site must still be allowed');
  const foreign = await postForm(`${base}/verify/resend`, { email: 'a@b.com', csrf }, cookie, {
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(foreign.status, 403, 'a foreign Origin with no Sec-Fetch-Site must still be refused');
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

test('the resend control does not promise a password prompt that no longer happens', async (t) => {
  // The old route sent the person back to /signup, so the hint warned them
  // they would have to type the password again. `/verify/resend` now asks
  // Supabase directly and never leaves this page. A hint describing the old
  // route is worse than no hint: it tells somebody who is already waiting for
  // a code that pressing the button means starting over, which is the reason
  // they would not press it.
  const { base } = await startWithFakeSupabase(t, {});
  const res = await getPage(`${base}/verify?email=${encodeURIComponent('a@b.com')}`);
  const body = await res.text();
  assert.doesNotMatch(body, /asked for your password again/i);
  assert.match(body, /60 seconds|a minute/i, 'the resend control still has to state the rule');
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
  // CORRECTED for whole-branch review finding 4: this used to assert the
  // garbage was rendered ESCAPED (`&lt;script&gt;`) rather than dropped, which
  // is not an XSS hole but is still an oracle for rendering arbitrary
  // attacker-chosen text on this app's own origin. `signupPage`'s own prefill
  // guards this with `isAddressShaped(prefill) ? prefill : ''`; `verifyPage`
  // now applies the identical guard, so non-address-shaped text is dropped
  // rather than escaped and shown.
  assert.ok(!body.includes('&lt;script&gt;'), 'non-address-shaped text was rendered rather than dropped');
});

test('a non-address query value is dropped from the page rather than rendered, escaped or not', async (t) => {
  // Whole-branch review finding 4, the concrete path named in the review:
  // `/verify?email=Your account is suspended, call 555-0100` used to render
  // that sentence in bold, under this app's own branding, on a page that
  // already says "check your email" -- a ready-made phishing premise, and
  // escaping alone does not fix it because there is no markup to escape.
  const { base } = await startWithFakeSupabase(t, {});
  const phishing = 'Your account is suspended, call 555-0100';
  const res = await getPage(`${base}/verify?email=${encodeURIComponent(phishing)}`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(!body.includes(phishing), 'attacker-chosen text reached the page');
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
async function signupThrough(t, {
  upstream = 'ok', email = TEST_EMAIL, password = 'a genuinely long password', accept = 'text/html',
} = {}) {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {
    pendingConsent: null,
    failWith: upstream === 'ok' ? null : upstream,
  });
  const res = await postForm(`${base}/signup`, { email, password, consent: 'on', csrf }, cookie, { accept });
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

  // WHOLE-BRANCH REVIEW FINDING 5(a): the html dialect's whole body is an
  // empty redirect -- `redirect()` calls `res.end()` with no argument
  // (server.mjs's `redirect` helper) -- so comparing `fresh.body` to
  // `taken.body` (both `''`) and `fresh.contentType` to `taken.contentType`
  // (both `null`) can never fail regardless of whether the two outcomes
  // actually agree. The property IS proved above, by status and Location.
  // The JSON dialect is where the response genuinely carries content, so
  // that is exercised here instead of decorating the html comparison with
  // assertions that cannot fail.
  const freshJson = await signupThrough(t, { upstream: 'ok', accept: 'application/json' });
  const takenJson = await signupThrough(t, { upstream: 'user-already-registered', accept: 'application/json' });
  assert.equal(freshJson.status, takenJson.status);
  assert.ok(freshJson.body.length > 2, 'the JSON body must carry real content for this comparison to mean anything');
  assert.equal(freshJson.body, takenJson.body, 'Supabase leaks it; we must not pass it on');
  assert.equal(freshJson.contentType, takenJson.contentType);
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

    // WHOLE-BRANCH REVIEW FINDING 5(b): the html dialect's body is always
    // empty (`redirect()` calls `res.end()` with no argument), so a leak
    // check against `res.body` can never fail -- it is decoration, not proof.
    // The JSON dialect actually carries content, so that is where the leak
    // check has to run for it to mean anything.
    const json = await signupThrough(t, { upstream: kind, accept: 'application/json' });
    assert.equal(json.status, 202, `the JSON dialect must answer the same way whatever ${kind} was upstream`);
    assert.ok(json.body.length > 2, 'the JSON body must carry real content for a leak check to mean anything');
    for (const leak of ['user_already_exists', 'over_request_rate_limit', 'error_code', 'SupabaseAuthError', 'supabase']) {
      assert.ok(!json.body.toLowerCase().includes(leak.toLowerCase()), `${kind} leaked ${leak} onto the page`);
    }
    assert.ok(!/\b(422|429|500)\b/.test(withoutMarks(json.body)), `${kind} leaked an upstream status onto the page`);
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

test('an address that is shaped enough to fool isAddressShaped but not emailHash refuses cleanly, not a 500', async (t) => {
  // Whole-branch review finding 2: `isAddressShaped` is a cheap shape test,
  // but `putPending` calls `emailHash`, which runs `normaliseEmail` --
  // STRICTER, and `a@b..com` is the concrete address that passes the first
  // and throws on the second (verified directly against both regexes). Every
  // other address-taking handler (`verifyCode`, `resetComplete`) wraps this;
  // `signup` did not, so this shape reached `ident.putPending` uncaught and
  // turned into a third response shape -- a 500 -- on the one route whose
  // §4.4 contract is "two outcomes, one page".
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, { pendingConsent: null });
  const res = await postForm(`${base}/signup`,
    { email: 'a@b..com', password: 'a genuinely long password', consent: 'on', csrf }, cookie);
  assert.equal(res.status, 400, 'a shape Supabase would also refuse must render the ordinary refusal page, not crash');
  assert.equal(calls.length, 0, 'an address normaliseEmail refuses must never reach Supabase');
  const body = await res.text();
  assert.ok(body.includes('email address'), 'the ordinary shape-refusal page did not render');
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
 * Spec §6: the consent parked at signup is consumed on FIRST CONFIRMED LOGIN,
 * not only at `/verify`. This is not hypothetical -- the `{{ .Token }}`
 * Supabase email-template edit is not done, so today Supabase mails a
 * confirmation LINK rather than a code, and a person who signs up here
 * (consent parked), clicks that link, then signs in with their password
 * reaches exactly this branch: the first time this identity resolves.
 * `startWithFakeSupabase`'s default parks `PARKED_CONSENT` for `TEST_EMAIL`,
 * which is precisely that setup.
 */
test('a login that creates the account consumes the parked consent and stores it', async (t) => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, {});
  const res = await postForm(`${base}/login`, { email: TEST_EMAIL, password: 'whatever the person typed', csrf }, cookie);
  assert.equal(res.status, 303);
  // Consent was already on file the moment the account was created, so this
  // login is not diverted through /onboarding -- see the review-fix section
  // below for the case where it must be.
  assert.equal(res.headers.get('location'), '/', 'a login with consent already on file was diverted through onboarding');
  const account = loadAccount({ root, accountId: listAccounts({ root })[0].accountId });
  assert.equal(account.consent?.granted, true, 'the account was created with no record of the agreement');
  assert.equal(account.consent?.text, PARKED_CONSENT.text);
});

/** The other half: most logins resolve a RETURNING account with nothing
 *  parked at all, and that ordinary path must not start failing. */
test('a login that creates an account with nothing parked still succeeds, and records no consent', async (t) => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, { pendingConsent: null });
  const res = await postForm(`${base}/login`, { email: TEST_EMAIL, password: 'whatever the person typed', csrf }, cookie);
  assert.equal(res.status, 303, 'a login with nothing parked must still succeed');
  const account = loadAccount({ root, accountId: listAccounts({ root })[0].accountId });
  assert.equal(account.consent, null, 'nothing was parked, so nothing should have been invented');
});

// ---------------------------------------------------------------------------
// task 12 review fix -- `login` never routed a `consent: null` account
// through `/onboarding` at all, which is the one route the whole obligation
// exists to close. Pinned here, through the real `/login` route, rather than
// only through `/verify` where it already worked.
// ---------------------------------------------------------------------------

test('a login that opens an account with no consent parked lands it on /onboarding, not home', async (t) => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, { pendingConsent: null });
  const res = await postForm(`${base}/login`, { email: TEST_EMAIL, password: 'whatever the person typed', csrf }, cookie);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/onboarding',
    'an account opened with consent: null must be routed to the one place that repairs it');
  const account = loadAccount({ root, accountId: listAccounts({ root })[0].accountId });
  assert.equal(account.consent, null);
});

/**
 * The gating rule is keyed on the account's OWN `consent` field, read back
 * after `resolveIdentity` returns -- not on its `created` flag. This is the
 * case that distinguishing them was FOR: by the second login, `resolveIdentity`
 * takes the "known identity" branch and `created` is false, yet the account
 * still carries `consent: null` from the first login (nothing was parked
 * either time). A rule keyed on `created` alone would divert the first login
 * and wave the second one through home -- an account sitting with no consent
 * record and no route left that ever asks it. This is a real account this
 * repository can produce today, not a hypothetical: it is exactly what a
 * login that creates an account, with nothing parked, looked like before this
 * fix -- the account above never had anywhere else to go.
 */
test('a second login on that same account still lands on /onboarding -- consent is still missing, "created" is not', async (t) => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, { pendingConsent: null });
  const first = await postForm(`${base}/login`, { email: TEST_EMAIL, password: 'whatever the person typed', csrf }, cookie);
  assert.equal(first.status, 303);
  await first.text();
  const accountId = listAccounts({ root })[0].accountId;
  assert.equal(loadAccount({ root, accountId }).consent, null, 'setup: consent should still be unset after the first login');

  const second = await postForm(`${base}/login`, { email: TEST_EMAIL, password: 'whatever the person typed', csrf }, cookie);
  assert.equal(second.status, 303);
  assert.equal(second.headers.get('location'), '/onboarding',
    'a returning login on an account still missing consent must still be routed to /onboarding');
  await second.text();
  assert.equal(listAccounts({ root }).length, 1, 'the second login must resolve the SAME account, not create another');
});

/**
 * `next` is honoured exactly as before once consent is on file -- a returning
 * sign-in that was headed somewhere specific still gets there. But while
 * consent is missing, `next` is NOT honoured: the whole point of this fix is
 * that the account passes through the one repair point, and a `next` that
 * skipped it would reopen the gap by a different door.
 */
test('next is honoured once consent is on file, and overridden by /onboarding while it is missing', async (t) => {
  const withConsent = await startWithFakeSupabase(t, {});
  const ok = await postForm(`${withConsent.base}/login`,
    { email: TEST_EMAIL, password: 'whatever the person typed', next: '/pricing', csrf: withConsent.csrf }, withConsent.cookie);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/pricing', 'a returning login with consent on file must still honour next');
  await ok.text();

  const withoutConsent = await startWithFakeSupabase(t, { pendingConsent: null });
  const diverted = await postForm(`${withoutConsent.base}/login`,
    { email: TEST_EMAIL, password: 'whatever the person typed', next: '/pricing', csrf: withoutConsent.csrf }, withoutConsent.cookie);
  assert.equal(diverted.status, 303);
  assert.equal(diverted.headers.get('location'), '/onboarding', 'next must not be a way to skip the repair while consent is missing');
  await diverted.text();
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
    assert.ok(!/\b(400|403|429|500)\b/.test(withoutMarks(res.body)), `${kind} leaked an upstream status onto the page`);
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

// ---------------------------------------------------------------------------
// task 12 -- /onboarding: the stub, and the one repair only it can make
// ---------------------------------------------------------------------------

/**
 * Sign in for real, through `/verify`, and hand back a cookie carrying BOTH
 * halves `/onboarding`'s routes check: the signed csrf pair
 * `startWithFakeSupabase` seeded, and the session `/verify` just minted.
 *
 * `consent` controls what is parked before the code is typed. `null`
 * reproduces exactly the gap task 7's review carried forward to this task: a
 * code confirmed with nothing parked (the park has a 24-hour TTL, and this is
 * what a late confirmation looks like) opens an account with `consent: null`
 * and signs the person in anyway -- `verifyCode` logs it and proceeds rather
 * than stranding someone who has already proved their mailbox. Nothing but
 * `/onboarding` ever asks again.
 *
 * The returned `csrf` is the same stateless token used to sign in; `/verify`
 * mints no CSRF cookie of its own, so it is still good for a fresh POST to
 * `/onboarding` without fetching that page first -- reused rather than
 * re-derived so the "already agreed" tests below can post with no HTML to
 * scrape a token out of in the first place, since that state renders no form.
 */
async function signedIn(t, { consent = PARKED_CONSENT } = {}) {
  const { base, csrf, cookie: csrfCookie, root } = await startWithFakeSupabase(t, {
    correctCode: '123456', pendingConsent: consent,
  });
  const res = await postForm(`${base}/verify`, { email: TEST_EMAIL, code: '123456', csrf }, csrfCookie);
  assert.equal(res.status, 303, 'setup: signing in through /verify failed');
  const sessionCookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.match(sessionCookie, /timestamp_session=/, 'setup: no session was minted');
  await res.text();
  const accountId = listAccounts({ root })[0].accountId;
  return { base, root, csrf, accountId, cookie: [csrfCookie, sessionCookie].join('; ') };
}

test('onboarding needs a session and does not ask a signed-in person to sign in', async (t) => {
  const { base, cookie } = await signedIn(t);
  // A browser is what gets sent to sign in -- `wantsHtml` is the same switch
  // every other gated page answers through, and `test/web-auth.test.js`'s
  // "every gated route" check pins the JSON half of this split (a bare client
  // with no accept header gets a 401 it can branch on, not a redirect). This
  // test is about the browser half, so it sends the header a browser sends.
  const anon = await fetch(`${base}/onboarding`, { headers: { accept: 'text/html' }, redirect: 'manual' });
  assert.equal(anon.status, 303);
  assert.equal(anon.headers.get('location'), '/login?next=%2Fonboarding');
  await anon.text();
  const mine = await fetch(`${base}/onboarding`, { headers: { accept: 'text/html', cookie }, redirect: 'manual' });
  // 303 TO THE SHELF, NOT 200. `signedIn` parks consent, so this account has
  // nothing left to be asked. What this test is about is that a signed-in
  // visitor is not sent to `/login`; where an already-agreed one lands is the
  // next test's business.
  assert.equal(mine.status, 303);
  assert.equal(mine.headers.get('location'), '/', 'a signed-in visitor was sent somewhere other than the shelf');
  await mine.text();
});

test('an account with no consent on file is asked, not waved through', async (t) => {
  const { base, cookie, root, accountId } = await signedIn(t, { consent: null });
  assert.equal(loadAccount({ root, accountId }).consent, null, 'setup: consent should start unset');

  const res = await getPage(`${base}/onboarding`, cookie);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /name="consent"/, 'the consent checkbox is missing from the page');
  assert.match(body, /name="csrf"/, 'the form carries no anti-forgery token');
  assert.ok(!body.includes('Upload a photo'), 'the ordinary content rendered ahead of consent');
});

test('an account that already has consent is sent to the shelf, not shown a dead end', async (t) => {
  // THIS ROUTE HAS ONE JOB AND IT IS THE CONSENT REPAIR. It used to answer an
  // already-agreed account with a page whose entire content was a headline and
  // a link to `/` -- no form, no decision, nothing to read twice -- so the
  // person who had just ticked the box was bounced here and made to click once
  // more to reach the thing they came for. There is nothing to render when
  // there is nothing to ask, so it redirects.
  const { base, cookie } = await signedIn(t, { consent: PARKED_CONSENT });
  const res = await getPage(`${base}/onboarding`, cookie);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/');
  const body = await res.text();
  assert.ok(!body.includes('name="consent"'), 'an already-agreed account was asked again');
});

test('agreeing writes consent onto the account record, not merely past a gate', async (t) => {
  const { base, cookie, csrf, root, accountId } = await signedIn(t, { consent: null });
  const res = await postForm(`${base}/onboarding`, { consent: 'yes', csrf }, cookie);
  assert.equal(res.status, 303);
  // STRAIGHT TO THE SHELF. Redirecting back here was Post/Redirect/Get done
  // literally, and it cost a bounce through a page that had nothing to say.
  assert.equal(res.headers.get('location'), '/', 'agreeing bounces through /onboarding instead of landing');
  await res.text();

  const account = loadAccount({ root, accountId });
  assert.equal(account.consent?.granted, true, 'the account record was never updated');
  assert.equal(account.consent?.text, CONSENT_TEXT, 'the wording stored is not what the server actually shows');

  // And asking again does not happen: the ordinary page renders now.
  const after = await getPage(`${base}/onboarding`, cookie);
  const afterBody = await after.text();
  assert.ok(!afterBody.includes('name="consent"'), 'still asking after it was just given');
});

test('a post with the box left unticked is refused, and nothing is written', async (t) => {
  const { base, cookie, csrf, root, accountId } = await signedIn(t, { consent: null });
  // No `consent` field at all -- an unchecked HTML checkbox posts nothing.
  const res = await postForm(`${base}/onboarding`, { csrf }, cookie);
  assert.equal(res.status, 400);
  await res.text();
  assert.equal(loadAccount({ root, accountId }).consent, null, 'consent was recorded with the box left unticked');
});

test('a post that cannot prove it came from this form is refused, and nothing is written', async (t) => {
  const { base, cookie, root, accountId } = await signedIn(t, { consent: null });
  const res = await postForm(`${base}/onboarding`, { consent: 'yes', csrf: 'not-a-token' }, cookie);
  assert.equal(res.status, 403);
  await res.text();
  assert.equal(loadAccount({ root, accountId }).consent, null);
});

test('a cross-site post to /onboarding is refused, and nothing is written', async (t) => {
  const { base, cookie, csrf, root, accountId } = await signedIn(t, { consent: null });
  const res = await postForm(`${base}/onboarding`, { consent: 'yes', csrf }, cookie,
    { headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  await res.text();
  assert.equal(loadAccount({ root, accountId }).consent, null);
});

test('reposting once consent is already on file changes nothing and still succeeds', async (t) => {
  const { base, cookie, csrf, root, accountId } = await signedIn(t, { consent: PARKED_CONSENT });
  const before = loadAccount({ root, accountId });

  const res = await postForm(`${base}/onboarding`, { consent: 'yes', csrf }, cookie);
  assert.equal(res.status, 303, 'a repost must not strand someone who already agreed');
  await res.text();

  const after = loadAccount({ root, accountId });
  assert.equal(after.consent?.at, before.consent?.at, 'a second post overwrote the first consent record');
  assert.equal(after.consent?.text, before.consent?.text);
});

test('a JSON client asking to agree gets its own dialect, not an HTML page', async (t) => {
  const { base, cookie, csrf } = await signedIn(t, { consent: null });
  const res = await postForm(`${base}/onboarding`, { consent: 'yes', csrf }, cookie, { accept: 'application/json' });
  assert.equal(res.status, 200);
  const payload = await res.json();
  // The same destination the browser now gets, in the JSON dialect: a client
  // that agreed has no more business here either.
  assert.equal(payload.next, '/');
});
