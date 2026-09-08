/**
 * "Forgot password?" -- spec §5's recovery half, task 11.
 *
 * WHY THIS FILE REUSES `test/web-auth-code.test.js`'S HARNESS RATHER THAN
 * BUILDING A SECOND ONE. `startWithFakeSupabase`, `postForm`, `getPage` and
 * `shapeOf` are already the contract every code-entry test in this repo is
 * written against, and the task brief is explicit: import or mirror that
 * harness, do not invent a second one. Only the pieces that harness does not
 * export -- the exact upstream JSON a fake identity or a fake failure carries
 * -- are mirrored locally, in the smallest shape each test actually needs.
 *
 * WHAT THIS FILE PROVES, IN ORDER: a reset request cannot be used to learn
 * whether an address has an account; a completed reset destroys every session
 * for that account and only that account; the six-digit code shares its
 * attempt counter with `/verify` rather than getting a second one; consent is
 * handled exactly as `login` handles it, re-park included; and nothing
 * `SupabaseAuthError` or an account error carries ever reaches a page.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CODE_MAX_ATTEMPTS, CODE_REFUSED_MESSAGE, CODE_EXHAUSTED_MESSAGE, AUTH_RATE_LIMITS, RESET_DONE_NOTICE,
} from '../scripts/web/server.mjs';
import {
  startWithFakeSupabase, postForm, getPage, shapeOf, TEST_EMAIL, withoutMarks,
} from './web-auth-code.test.js';
import { findAccountByEmail, createAccount } from '../scripts/auth/accounts.mjs';
import { listSessions } from '../scripts/auth/session.mjs';
import { putPending, takePending } from '../scripts/auth/pending-signup.mjs';

/** A password past the ten-character floor `signup` and `resetComplete` both
 *  enforce, and distinct from anything used elsewhere in this file. */
const NEW_PASSWORD = 'a-brand-new-passphrase';

/** Consent, already recorded -- `pending-signup.mjs`'s own shape. Not
 *  exported by the shared harness (its `PARKED_CONSENT` is module-private),
 *  so mirrored here at the one field shape any of these tests reads. */
const CONSENT = Object.freeze({
  granted: true, at: '2026-08-26T00:00:00.000Z', text: 'I am in this photo and I agree.',
});

/** The shared harness's own default identity, mirrored for the tests below
 *  that need a custom `reply` and therefore lose the harness's built-in one. */
function identityJson({
  email = TEST_EMAIL,
  supabaseUserId = '11111111-2222-3333-4444-555555555555',
  accessToken = 'supabase-access-token-for-this-person',
} = {}) {
  return {
    status: 200,
    json: {
      access_token: accessToken,
      user: { id: supabaseUserId, email, email_confirmed_at: '2026-08-26T09:00:00.000Z' },
    },
  };
}

// ---------------------------------------------------------------------------
// §5's rule: identical for a known and an unknown address
// ---------------------------------------------------------------------------

/** The fixed "known" address every test below treats as one. Whole-branch
 *  review finding 5(c): `startWithFakeSupabase(t, {})` creates NO account --
 *  it only parks a pending SIGNUP consent for `TEST_EMAIL` ('a@b.com'), which
 *  is not an account at all -- so every "known vs unknown" comparison in this
 *  section used to compare one unknown address to another and could never
 *  fail no matter what the code did. `startWithKnownAccount` creates a REAL
 *  account for this address, directly through `createAccount` rather than a
 *  full signup+verify round trip, because what this section proves is
 *  `/auth/reset`'s own indifference to account existence, not the signup flow
 *  that produces one. */
const KNOWN_EMAIL = 'exists@example.com';
async function startWithKnownAccount(t, opts = {}) {
  const started = await startWithFakeSupabase(t, opts);
  await createAccount({ root: started.root, email: KNOWN_EMAIL, password: 'a genuinely long enough password' });
  return started;
}

async function resetRequest(t, email) {
  const { base, csrf, cookie } = await startWithKnownAccount(t);
  const res = await postForm(`${base}/auth/reset`, { email, csrf }, cookie);
  return shapeOf(res);
}

test('a reset request answers identically for a known and an unknown address', async (t) => {
  const known = await resetRequest(t, KNOWN_EMAIL);
  const unknown = await resetRequest(t, 'nobody@example.com');
  assert.equal(known.status, unknown.status);
  assert.equal(known.body, unknown.body);
  assert.equal(known.location, unknown.location);
});

test('an address that is not even shaped like one gets the same answer too', async (t) => {
  // Format is not the oracle either -- only account existence is, and this
  // route never varies on it.
  const shaped = await resetRequest(t, KNOWN_EMAIL);
  const garbage = await resetRequest(t, 'not-an-email-at-all');
  assert.equal(shaped.status, garbage.status);
  assert.equal(shaped.body, garbage.body);
  assert.equal(shaped.location, garbage.location);
});

test('the two responses match on every header a client can read, not only the body', async (t) => {
  const shapes = [];
  for (const email of [KNOWN_EMAIL, 'nobody@example.com']) {
    const { base, csrf, cookie } = await startWithKnownAccount(t);
    const res = await postForm(`${base}/auth/reset`, { email, csrf }, cookie);
    const headers = [...res.headers]
      .filter(([k]) => k.toLowerCase() !== 'date')
      .map(([k, v]) => `${k}: ${v}`).sort().join('\n');
    shapes.push(headers);
    await res.text();
  }
  assert.equal(new Set(shapes).size, 1, `a header differs between a known and an unknown address:\n${[...new Set(shapes)].join('\n---\n')}`);
});

test('a shaped address is sent upstream and an unshaped one is not, with no visible difference', async (t) => {
  const { base, csrf, cookie, calls } = await startWithKnownAccount(t);
  const shaped = await postForm(`${base}/auth/reset`, { email: KNOWN_EMAIL, csrf }, cookie);
  await shaped.text();
  const garbage = await postForm(`${base}/auth/reset`, { email: 'not-an-email-at-all', csrf }, cookie);
  await garbage.text();
  const recoveries = calls.filter((c) => c.pathname.endsWith('/auth/v1/recover'));
  assert.equal(recoveries.length, 1, 'exactly one shaped address should have reached Supabase');
});

test('a reset request lands on the same completion page whatever the address was, with no email in the url', async (t) => {
  const { location } = await resetRequest(t, KNOWN_EMAIL);
  assert.equal(location, '/auth/reset/complete');
});

test('a JSON client is told the same next, whichever address it named', async (t) => {
  const shapes = [];
  for (const email of [KNOWN_EMAIL, 'nobody@example.com']) {
    const { base, csrf, cookie } = await startWithKnownAccount(t);
    const res = await postForm(`${base}/auth/reset`, { email, csrf }, cookie, { accept: 'application/json' });
    shapes.push(await shapeOf(res));
  }
  for (const shape of shapes) {
    assert.equal(shape.status, 200);
    assert.deepEqual(JSON.parse(shape.body), { next: '/auth/reset/complete' });
  }
  assert.equal(shapes[0].body, shapes[1].body);
});

// ---------------------------------------------------------------------------
// the request route is gated exactly like every other credential post
// ---------------------------------------------------------------------------

test('a reset request that cannot prove it came from this form spends nothing upstream', async (t) => {
  const { base, cookie, calls } = await startWithFakeSupabase(t, {});
  const res = await postForm(`${base}/auth/reset`, { email: TEST_EMAIL, csrf: 'not-a-token' }, cookie);
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0, 'the credential was looked at before Supabase was');
});

test('a cross-site reset request is refused before the body is read', async (t) => {
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, {});
  const res = await postForm(`${base}/auth/reset`, { email: TEST_EMAIL, csrf }, cookie,
    { headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test('one connection cannot open unlimited reset requests', async (t) => {
  // `AUTH_RATE_LIMITS.reset` exists precisely because Supabase's own mailer
  // sends only two recovery emails an hour, project-wide.
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  let sawLimit = false;
  for (let i = 0; i < AUTH_RATE_LIMITS.reset.max + 3; i += 1) {
    const res = await postForm(`${base}/auth/reset`, { email: `p${i}@b.com`, csrf }, cookie);
    if (res.status === 429) {
      sawLimit = true;
      assert.ok(res.headers.get('retry-after'), 'a 429 with no Retry-After');
      await res.text();
      break;
    }
    await res.text();
  }
  assert.ok(sawLimit, 'the per-connection limiter never fired on /auth/reset');
});

test('a cross-site post does not count against the limiter, so a foreign page cannot lock a visitor out of reset', async (t) => {
  // The limiter is keyed on the client address, and under TRUST_PROXY=1 that
  // is the visitor's real one. With the limiter counting BEFORE the origin
  // check, any web page could auto-submit a handful of hidden forms at
  // `/auth/reset` from the visitor's own browser and spend their budget for
  // them: every one refused 403, every one counted, and the person's own
  // reset request an hour of 429s. A post that fails the origin check costs
  // this server nothing and must not cost the visitor anything either.
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, {});
  for (let i = 0; i < AUTH_RATE_LIMITS.reset.max + 3; i += 1) {
    const res = await postForm(`${base}/auth/reset`, { email: `p${i}@b.com`, csrf }, cookie,
      { headers: { origin: 'https://evil.example' } });
    assert.equal(res.status, 403, `forged post ${i} must be refused as a forgery, not rate-limited`);
    await res.text();
  }
  assert.equal(calls.length, 0, 'nothing reached Supabase');

  const own = await postForm(`${base}/auth/reset`, { email: TEST_EMAIL, csrf }, cookie);
  assert.notEqual(own.status, 429, 'the forged posts must not have spent the visitor\'s own budget');
  await own.text();
});

// ---------------------------------------------------------------------------
// the completion route: the same code shape, the same five guesses
// ---------------------------------------------------------------------------

test('the reset code dies after five wrong answers, and the sixth fails even when correct', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, { correctCode: '123456' });
  for (let i = 0; i < CODE_MAX_ATTEMPTS; i += 1) {
    const res = await postForm(`${base}/auth/reset/complete`,
      { email: TEST_EMAIL, code: '000000', password: NEW_PASSWORD, csrf }, cookie);
    assert.equal(res.status, 401, `attempt ${i + 1} should be refused`);
  }
  const res = await postForm(`${base}/auth/reset/complete`,
    { email: TEST_EMAIL, code: '123456', password: NEW_PASSWORD, csrf }, cookie);
  assert.equal(res.status, 401, 'the limit is a limit, not a message');
});

test('a wrong guess spent against /verify counts against a later reset for the same address', async (t) => {
  // The whole point of reusing `chargeCodeAttempt` / `clearCodeAttempts`
  // rather than writing a second limiter: one counter per address, whichever
  // of the two routes is spending it.
  const { base, csrf, cookie } = await startWithFakeSupabase(t, { correctCode: '123456' });
  for (let i = 0; i < CODE_MAX_ATTEMPTS; i += 1) {
    await postForm(`${base}/verify`, { email: TEST_EMAIL, code: '000000', csrf }, cookie);
  }
  const res = await postForm(`${base}/auth/reset/complete`,
    { email: TEST_EMAIL, code: '123456', password: NEW_PASSWORD, csrf }, cookie);
  assert.equal(res.status, 401, 'the shared per-address counter was already exhausted by /verify');
});

test('wrong, expired, and never-signed-up answer identically on the reset page too', async (t) => {
  const shapes = [];
  for (const kind of ['wrong', 'expired', 'unknown-address']) {
    const { base, csrf, cookie } = await startWithFakeSupabase(t, { failWith: kind });
    const res = await postForm(`${base}/auth/reset/complete`,
      { email: TEST_EMAIL, code: '000000', password: NEW_PASSWORD, csrf }, cookie);
    shapes.push({ status: res.status, body: await res.text() });
  }
  assert.equal(new Set(shapes.map((s) => s.status)).size, 1, 'statuses differ');
  assert.equal(new Set(shapes.map((s) => s.body)).size, 1, 'bodies differ -- that is the oracle');
  assert.equal(shapes[0].status, 401);
});

test('nothing Supabase said about a failed reset reaches the page', async (t) => {
  for (const kind of ['wrong', 'expired', 'unknown-address', 'over_request_rate_limit', 'boom']) {
    const { base, csrf, cookie } = await startWithFakeSupabase(t, { failWith: kind });
    const res = await postForm(`${base}/auth/reset/complete`,
      { email: TEST_EMAIL, code: '000000', password: NEW_PASSWORD, csrf }, cookie);
    assert.equal(res.status, 401, `a refused reset is a 401, whatever ${kind} was upstream`);
    const body = await res.text();
    for (const leak of ['otp_expired', 'invalid_otp', 'user_not_found', 'over_request_rate_limit',
      'error_code', 'SupabaseAuthError', 'supabase']) {
      assert.ok(!body.toLowerCase().includes(leak.toLowerCase()), `${kind} leaked ${leak} onto the page`);
    }
    assert.ok(!/\b(403|422|429|500)\b/.test(withoutMarks(body)), `${kind} leaked an upstream status onto the page`);
  }
});

test('a reset post that cannot prove it came from this form spends nothing and asks nothing', async (t) => {
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, { correctCode: '123456' });
  const forged = await postForm(`${base}/auth/reset/complete`,
    { email: TEST_EMAIL, code: '123456', password: NEW_PASSWORD, csrf: 'not-a-token' }, cookie);
  assert.equal(forged.status, 403);
  assert.equal(calls.length, 0, 'the credential was looked at before the token was');

  // And the refusal did not burn one of the five guesses.
  for (let i = 0; i < CODE_MAX_ATTEMPTS; i += 1) {
    const res = await postForm(`${base}/auth/reset/complete`,
      { email: TEST_EMAIL, code: '000000', password: NEW_PASSWORD, csrf }, cookie);
    assert.equal(res.status, 401, `attempt ${i + 1} should still be available`);
  }
});

test('a cross-site reset completion is refused before the body is read', async (t) => {
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, { correctCode: '123456' });
  const res = await postForm(`${base}/auth/reset/complete`,
    { email: TEST_EMAIL, code: '123456', password: NEW_PASSWORD, csrf }, cookie,
    { headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test('a password under ten characters is refused before anything is spent or asked upstream', async (t) => {
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, { correctCode: '123456' });
  const res = await postForm(`${base}/auth/reset/complete`,
    { email: TEST_EMAIL, code: '123456', password: 'short', csrf }, cookie);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /at least ten characters/);
  assert.equal(calls.length, 0, 'a doomed submission must not spend a guess or ask Supabase anything');
});

test('a JSON client gets 401 in its own dialect for a refused code', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, { failWith: 'wrong' });
  const res = await postForm(`${base}/auth/reset/complete`,
    { email: TEST_EMAIL, code: '000000', password: NEW_PASSWORD, csrf }, cookie, { accept: 'application/json' });
  assert.equal(res.status, 401);
  const payload = await res.json();
  assert.equal(payload.error.status, 401);
  assert.equal(payload.error.message, CODE_REFUSED_MESSAGE);
});

// ---------------------------------------------------------------------------
// a completed reset: order, and every device signed out
// ---------------------------------------------------------------------------

/** Two sessions for the same account, the way two devices would each hold
 *  one -- both minted by an ordinary `/login`, which is enough for a session
 *  record even though this "device" concept is just two separate posts. */
async function twoSignedInDevices(t) {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, {});
  const first = await postForm(`${base}/login`, { email: TEST_EMAIL, password: 'whatever the person typed', csrf }, cookie);
  assert.equal(first.status, 303, 'the first device could not sign in');
  await first.text();
  const second = await postForm(`${base}/login`, { email: TEST_EMAIL, password: 'whatever the person typed', csrf }, cookie);
  assert.equal(second.status, 303, 'the second device could not sign in');
  await second.text();

  const accountId = findAccountByEmail({ root, email: TEST_EMAIL })?.accountId;
  assert.ok(accountId, 'the fixture never created an account to test against');
  const sessionsBefore = listSessions({ root }).filter((s) => s.accountId === accountId);
  return { base, csrf, cookie, root, accountId, sessionsBefore };
}

test('a completed reset signs every device out', async (t) => {
  const { base, csrf, cookie, root, accountId, sessionsBefore } = await twoSignedInDevices(t);
  assert.equal(sessionsBefore.length, 2);

  const res = await postForm(`${base}/auth/reset/complete`,
    { email: TEST_EMAIL, code: '123456', password: NEW_PASSWORD, csrf }, cookie);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login?reset=done');
  await res.text();

  assert.equal(listSessions({ root }).filter((s) => s.accountId === accountId).length, 0,
    'people reset because somebody else has it');
});

test('another account keeps its sessions', async (t) => {
  const otherEmail = 'other@example.com';
  const otherId = '99999999-9999-9999-9999-999999999999';
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, {
    pendingConsent: null,
    reply: async ({ pathname, body }) => {
      if (pathname.endsWith('/auth/v1/verify')) {
        if (body?.token !== '123456') return { status: 403, json: { error_code: 'invalid_otp', msg: 'nope' } };
        const email = body?.email ?? TEST_EMAIL;
        const supabaseUserId = email === otherEmail ? otherId : '11111111-2222-3333-4444-555555555555';
        return identityJson({ email, supabaseUserId });
      }
      if (pathname.endsWith('/auth/v1/logout')) return { status: 204, json: {} };
      return { status: 200, json: {} };
    },
  });
  putPending({ root, email: TEST_EMAIL, consent: CONSENT });
  putPending({ root, email: otherEmail, consent: CONSENT });

  const a = await postForm(`${base}/verify`, { email: TEST_EMAIL, code: '123456', csrf }, cookie);
  assert.equal(a.status, 303, 'setting up account A failed');
  await a.text();
  const b = await postForm(`${base}/verify`, { email: otherEmail, code: '123456', csrf }, cookie);
  assert.equal(b.status, 303, 'setting up account B failed');
  await b.text();

  const accountA = findAccountByEmail({ root, email: TEST_EMAIL })?.accountId;
  const accountB = findAccountByEmail({ root, email: otherEmail })?.accountId;
  assert.ok(accountA && accountB && accountA !== accountB, 'the fixture did not create two distinct accounts');
  assert.ok(listSessions({ root }).some((s) => s.accountId === accountB), 'account B started with no session to keep');

  const reset = await postForm(`${base}/auth/reset/complete`,
    { email: TEST_EMAIL, code: '123456', password: NEW_PASSWORD, csrf }, cookie);
  assert.equal(reset.status, 303);
  await reset.text();

  assert.equal(listSessions({ root }).filter((s) => s.accountId === accountA).length, 0,
    'account A should be fully signed out');
  assert.ok(listSessions({ root }).some((s) => s.accountId === accountB),
    'account B lost a session it never asked to give up');
});

test('a completed reset mints no session of its own', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  await postForm(`${base}/login`, { email: TEST_EMAIL, password: 'whatever the person typed', csrf }, cookie);
  const res = await postForm(`${base}/auth/reset/complete`,
    { email: TEST_EMAIL, code: '123456', password: NEW_PASSWORD, csrf }, cookie);
  assert.equal(res.status, 303);
  assert.ok(!(res.headers.get('set-cookie') ?? '').includes('timestamp_session='),
    'a reset must not itself sign anyone in -- /login is the next stop');
  await res.text();
});

test('the password is exchanged, set, and only then revoked -- in that order', async (t) => {
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, {});
  await postForm(`${base}/login`, { email: TEST_EMAIL, password: 'whatever the person typed', csrf }, cookie);
  calls.length = 0; // only the reset's own calls matter here

  const res = await postForm(`${base}/auth/reset/complete`,
    { email: TEST_EMAIL, code: '123456', password: NEW_PASSWORD, csrf }, cookie);
  assert.equal(res.status, 303);
  await res.text();

  const order = calls.map((c) => c.pathname);
  const verifyIdx = order.findIndex((p) => p.endsWith('/auth/v1/verify'));
  const userIdx = order.findIndex((p) => p.endsWith('/auth/v1/user'));
  const logoutIdx = order.findIndex((p) => p.endsWith('/auth/v1/logout'));
  assert.ok(verifyIdx !== -1, 'the code was never exchanged');
  assert.ok(userIdx !== -1, 'the password was never set');
  assert.ok(logoutIdx !== -1, 'the access token was never revoked');
  assert.ok(verifyIdx < userIdx, 'the password was set before the code that authorises it was exchanged');
  assert.ok(userIdx < logoutIdx, 'the token was revoked before the password update that needed it alive');

  const userCall = calls[userIdx];
  assert.equal(userCall.method, 'PUT');
  assert.equal(userCall.body?.password, NEW_PASSWORD);
  assert.equal(userCall.headers.Authorization, 'Bearer supabase-access-token-for-this-person',
    'the password update did not carry the access token the exchange just produced');
});

test('a failed password update refuses the same way a wrong code does, and destroys no sessions', async (t) => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, {
    reply: async ({ pathname, body }) => {
      if (pathname.endsWith('/auth/v1/verify')) {
        if (body?.token !== '123456') return { status: 403, json: { error_code: 'invalid_otp', msg: 'nope' } };
        return identityJson({});
      }
      if (pathname.endsWith('/auth/v1/token')) return identityJson({});
      if (pathname.endsWith('/auth/v1/user')) return { status: 422, json: { error_code: 'weak_password', msg: 'nope' } };
      return { status: 200, json: {} };
    },
  });
  await postForm(`${base}/login`, { email: TEST_EMAIL, password: 'whatever the person typed', csrf }, cookie);
  const accountId = findAccountByEmail({ root, email: TEST_EMAIL })?.accountId;
  const before = listSessions({ root }).filter((s) => s.accountId === accountId).length;
  assert.equal(before, 1);

  const res = await postForm(`${base}/auth/reset/complete`,
    { email: TEST_EMAIL, code: '123456', password: NEW_PASSWORD, csrf }, cookie);
  assert.equal(res.status, 401);
  assert.ok((await res.text()).includes(CODE_REFUSED_MESSAGE));
  assert.equal(listSessions({ root }).filter((s) => s.accountId === accountId).length, before,
    'sessions must survive a reset that never actually completed');
});

test('a revoke that throws still leaves the reset completed', async (t) => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, {
    reply: async ({ pathname, body }) => {
      if (pathname.endsWith('/auth/v1/verify')) {
        if (body?.token !== '123456') return { status: 403, json: { error_code: 'invalid_otp', msg: 'nope' } };
        return identityJson({});
      }
      if (pathname.endsWith('/auth/v1/token')) return identityJson({});
      if (pathname.endsWith('/auth/v1/logout')) return { status: 500, json: { msg: 'boom' } };
      return { status: 200, json: {} };
    },
  });
  await postForm(`${base}/login`, { email: TEST_EMAIL, password: 'whatever the person typed', csrf }, cookie);
  const accountId = findAccountByEmail({ root, email: TEST_EMAIL })?.accountId;

  const res = await postForm(`${base}/auth/reset/complete`,
    { email: TEST_EMAIL, code: '123456', password: NEW_PASSWORD, csrf }, cookie);
  assert.equal(res.status, 303, 'a failed revoke must not turn a completed reset into a failure');
  assert.equal(res.headers.get('location'), '/login?reset=done');
  await res.text();
  assert.equal(listSessions({ root }).filter((s) => s.accountId === accountId).length, 0,
    'sessions must still be destroyed even though the best-effort revoke failed');
});

test('a success clears the shared counter, so a person who fumbled earlier is not punished later', async (t) => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, { correctCode: '123456' });
  for (let i = 0; i < 4; i += 1) {
    await postForm(`${base}/auth/reset/complete`,
      { email: TEST_EMAIL, code: '000000', password: NEW_PASSWORD, csrf }, cookie);
  }
  const ok = await postForm(`${base}/auth/reset/complete`,
    { email: TEST_EMAIL, code: '123456', password: NEW_PASSWORD, csrf }, cookie);
  assert.equal(ok.status, 303);
  await ok.text();
  // A fresh code for the same address now gets its full five again.
  const wrong = await postForm(`${base}/verify`, { email: TEST_EMAIL, code: '000000', csrf }, cookie);
  assert.equal(wrong.status, 401, 'still a wrong code, just not an exhausted address');
  const attempts = [];
  for (let i = 0; i < CODE_MAX_ATTEMPTS - 1; i += 1) {
    const r = await postForm(`${base}/verify`, { email: TEST_EMAIL, code: '000000', csrf }, cookie);
    attempts.push(r.status);
  }
  assert.ok(attempts.every((s) => s === 401), 'the address should not already be exhausted after one success');
});

// ---------------------------------------------------------------------------
// consent, handled exactly as `login` handles it -- re-park included
// ---------------------------------------------------------------------------

test('an unverified recovery identity refuses and re-parks the consent it took', async (t) => {
  // A recovery code cannot ordinarily reach `resolveIdentity`'s create branch
  // -- the address already has an account, or the code would never have
  // been issued -- but it is the one branch that function refuses by name,
  // and the re-park is an obligation this handler owes exactly as `login`
  // and the Google callback both already do. Nothing forces it without a
  // test that fails when it is missing.
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, {
    pendingConsent: null,
    reply: async ({ pathname }) => {
      if (pathname.endsWith('/auth/v1/verify')) {
        // No email_confirmed_at, no confirmed_at: emailVerified comes out false.
        return { status: 200, json: { access_token: 'tok', user: { id: 'unverified-id', email: TEST_EMAIL } } };
      }
      return { status: 200, json: {} };
    },
  });
  putPending({ root, email: TEST_EMAIL, consent: CONSENT });

  const res = await postForm(`${base}/auth/reset/complete`,
    { email: TEST_EMAIL, code: '123456', password: NEW_PASSWORD, csrf }, cookie);
  assert.equal(res.status, 401);
  const body = await res.text();
  assert.ok(body.includes(CODE_REFUSED_MESSAGE));
  assert.ok(!(res.headers.get('set-cookie') ?? '').includes('timestamp_session='));

  const parked = takePending({ root, email: TEST_EMAIL });
  assert.ok(parked, 'the parked consent was lost on a failed resolve, not returned');
  assert.equal(parked.consent.granted, true);
  assert.equal(parked.consent.text, CONSENT.text);
});

// ---------------------------------------------------------------------------
// the pages
// ---------------------------------------------------------------------------

test('the reset request page carries the address field and a csrf token', async (t) => {
  const { base } = await startWithFakeSupabase(t, {});
  const res = await getPage(`${base}/auth/reset`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /name="email"/);
  assert.match(body, /name="csrf"/);
  assert.match(body, /action="\/auth\/reset"/);
});

test('the reset completion page carries the code, the new password, and a csrf token', async (t) => {
  const { base } = await startWithFakeSupabase(t, {});
  const res = await getPage(`${base}/auth/reset/complete`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /name="email"/);
  assert.match(body, /name="code"/);
  assert.match(body, /inputmode="numeric"/);
  assert.match(body, /maxlength="6"/);
  assert.match(body, /name="password"/);
  assert.match(body, /name="csrf"/);
  assert.match(body, /action="\/auth\/reset\/complete"/);
});

test('the login page links to the reset flow', async (t) => {
  const { base } = await startWithFakeSupabase(t, {});
  const res = await getPage(`${base}/login`);
  const body = await res.text();
  assert.match(body, /href="\/auth\/reset"/);
});

test('the login page states the notice only when a reset actually just completed', async (t) => {
  const { base } = await startWithFakeSupabase(t, {});
  const plain = await getPage(`${base}/login`);
  assert.ok(!(await plain.text()).includes(RESET_DONE_NOTICE));

  const afterReset = await getPage(`${base}/login?reset=done`);
  assert.ok((await afterReset.text()).includes(RESET_DONE_NOTICE));
});

// ---------------------------------------------------------------------------
// no Supabase configured -- the whole flow 503s, and mints nothing
// ---------------------------------------------------------------------------

test('a server with no Supabase 503s the whole reset flow, and mints nothing', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, { withSupabase: false });

  const getReset = await getPage(`${base}/auth/reset`);
  assert.equal(getReset.status, 503);
  await getReset.text();

  const postReset = await postForm(`${base}/auth/reset`, { email: TEST_EMAIL, csrf }, cookie);
  assert.equal(postReset.status, 503);
  assert.ok(!postReset.headers.get('set-cookie'));
  await postReset.text();

  const getComplete = await getPage(`${base}/auth/reset/complete`);
  assert.equal(getComplete.status, 503);
  await getComplete.text();

  const postComplete = await postForm(`${base}/auth/reset/complete`,
    { email: TEST_EMAIL, code: '123456', password: NEW_PASSWORD, csrf }, cookie);
  assert.equal(postComplete.status, 503);
  assert.ok(!postComplete.headers.get('set-cookie'));
  await postComplete.text();
});

test('a JSON client is told the same 503 in its own dialect', async (t) => {
  const { base } = await startWithFakeSupabase(t, { withSupabase: false });
  const res = await getPage(`${base}/auth/reset/complete`, '', { accept: 'application/json' });
  assert.equal(res.status, 503);
  const payload = await res.json();
  assert.equal(payload.error.status, 503);
  assert.equal(typeof payload.error.message, 'string');
});
