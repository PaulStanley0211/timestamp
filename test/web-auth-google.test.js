/**
 * The Google round trip. Task 10, spec §3 and §4.2.
 *
 * WHY THIS FILE HAS NO HARNESS OF ITS OWN. `test/web-auth-code.test.js` builds
 * a real server against a real `createSupabaseAuth` over a faked HTTPS
 * transport, and everything below reuses that harness verbatim rather than
 * inventing a second one -- `startWithFakeSupabase`, `postForm`, `getPage`,
 * `shapeOf` and `TEST_EMAIL` are all imported from there.
 *
 * ONE DELIBERATE DIFFERENCE FROM THE TASK BRIEF'S SNIPPET, BEYOND THE ONE
 * `web-auth-code.test.js` ALREADY DOCUMENTS. The brief's own example writes
 * `const { base, startGoogle } = await startWithFakeSupabase({});` as though
 * `startGoogle` were part of the shared harness. It is not -- adding it there
 * would mean editing a file this task's brief does not list for modification,
 * and outside a temporary root nothing in that harness needs to know Google
 * exists. `startGoogle` is a small LOCAL helper below: it POSTs to
 * `/auth/google` with the harness's own csrf pair and pulls the `state` back
 * out of the `redirect_to` query string embedded in the `Location` header --
 * exactly what a browser would do, just without a body to click.
 *
 * WHAT IS FAKE AND WHAT IS NOT. Same as the parent file: only the Supabase
 * HTTPS transport is faked. `resolveIdentity`, `accounts.mjs`, `session.mjs`,
 * `oauth-store.mjs` and `pkce.mjs` are the real modules running against a
 * temporary root, because this task's whole subject is whether a `state` this
 * server did not issue can ever produce a session, and a faked verifier store
 * would only prove the fake refuses correctly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { OAUTH_FAILED_MESSAGE } from '../scripts/web/server.mjs';
import {
  startWithFakeSupabase, postForm, getPage, shapeOf, TEST_EMAIL,
} from './web-auth-code.test.js';
import { putPending, takePending } from '../scripts/auth/pending-signup.mjs';
import { putVerifier, OAUTH_DIR } from '../scripts/auth/oauth-store.mjs';
import { listAccounts, loadAccount } from '../scripts/auth/accounts.mjs';

/** Consent as `pending-signup.mjs` parks it -- same shape the parent file's
 *  own `PARKED_CONSENT` uses, redeclared here rather than imported because the
 *  parent does not export it. */
const PARKED_CONSENT = Object.freeze({
  granted: true, at: '2026-08-26T00:00:00.000Z', text: 'I am in this photo and I agree.',
});

/**
 * A browser clicking "Sign in with Google": POST the form, and hand back the
 * `state` this server minted, read out of the `redirect_to` Supabase was
 * asked to bounce the browser back to.
 *
 * NOT PART OF THE SHARED HARNESS -- see the file header.
 */
async function startGoogle(base, csrf, cookie, extra = {}) {
  const res = await postForm(`${base}/auth/google`, { csrf, ...extra }, cookie);
  assert.equal(res.status, 303, 'POST /auth/google did not redirect to Supabase');
  await res.text();
  const location = res.headers.get('location');
  const redirectTo = new URL(location).searchParams.get('redirect_to');
  assert.ok(redirectTo, 'the authorize url carries no redirect_to');
  const state = new URL(redirectTo).searchParams.get('state');
  assert.ok(state, 'no state was embedded in redirect_to');
  return state;
}

// ---------------------------------------------------------------------------
// the brief's own three tests, reproduced
// ---------------------------------------------------------------------------

test('a callback carrying a state we never issued is refused', async (t) => {
  const { base } = await startWithFakeSupabase(t, {});
  const res = await fetch(`${base}/auth/callback?code=abc&state=never-issued`, { redirect: 'manual' });
  assert.equal(res.status, 400);
  assert.ok(!res.headers.get('set-cookie'), 'no session from an unissued state');
});

test('a state cannot be spent twice', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  const state = await startGoogle(base, csrf, cookie);
  const first = await fetch(`${base}/auth/callback?code=abc&state=${state}`, { redirect: 'manual' });
  assert.equal(first.status, 303);
  await first.text();
  const second = await fetch(`${base}/auth/callback?code=abc&state=${state}`, { redirect: 'manual' });
  assert.equal(second.status, 400, 'the verifier was single use');
});

test('the authorize redirect carries S256 and never the verifier', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  const res = await postForm(`${base}/auth/google`, { csrf }, cookie);
  assert.equal(res.status, 303);
  await res.text();
  const location = res.headers.get('location');
  assert.match(location, /code_challenge_method=S256/);
  assert.ok(!/code_verifier/.test(location), 'the verifier never leaves this machine');
});

// ---------------------------------------------------------------------------
// state is not decorative -- the ways it could be bypassed, each closed
// ---------------------------------------------------------------------------

test('an expired state is refused, and the verifier is gone from disk either way', async (t) => {
  const { base, root } = await startWithFakeSupabase(t, {});
  // Simulated rather than waited for: `putVerifier` with a negative TTL
  // freezes an `expiresAt` already in the past, exactly what a real ten
  // minutes would eventually produce.
  putVerifier({
    root, state: 'already-stale', verifier: 'whatever-verifier', next: '', ttlMs: -1,
  });
  const file = path.join(root, ...OAUTH_DIR.split('/'), 'already-stale.json');
  assert.ok(fs.existsSync(file), 'the test did not actually seed a row');

  const res = await fetch(`${base}/auth/callback?code=abc&state=already-stale`, { redirect: 'manual' });
  assert.equal(res.status, 400);
  assert.ok(!res.headers.get('set-cookie'), 'no session from an expired state');
  assert.ok(!fs.existsSync(file), '`takeVerifier` must delete on the expired exit path too');
});

test('a google post that cannot prove it came from this form writes nothing to disk', async (t) => {
  const { base, root, cookie } = await startWithFakeSupabase(t, {});
  const res = await postForm(`${base}/auth/google`, { csrf: 'not-a-token' }, cookie);
  assert.equal(res.status, 403);
  assert.ok(!res.headers.get('set-cookie'));
  const dir = path.join(root, ...OAUTH_DIR.split('/'));
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  assert.deepEqual(files, [], 'a forged post still minted a verifier');
});

test('a cross-site post to /auth/google is refused before anything is written', async (t) => {
  const { base, root, csrf, cookie } = await startWithFakeSupabase(t, {});
  const res = await postForm(`${base}/auth/google`, { csrf }, cookie, {
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(res.status, 403);
  const dir = path.join(root, ...OAUTH_DIR.split('/'));
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  assert.deepEqual(files, [], 'a cross-site post still minted a verifier');
});

// ---------------------------------------------------------------------------
// the happy path, and what it must and must not do
// ---------------------------------------------------------------------------

test('a completed round trip signs somebody in and revokes Supabase\'s own session', async (t) => {
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, {});
  const state = await startGoogle(base, csrf, cookie);
  const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`, { redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/onboarding');
  assert.match(res.headers.get('set-cookie') ?? '', /timestamp_session=/);
  await res.text();
  assert.ok(calls.some((c) => c.url.includes('/logout')), 'revoke at the door never happened');
});

test('a Google sign-in never reaches the six-digit code flow', async (t) => {
  // Nothing here posts to /verify at all -- the assertion is that the round
  // trip above lands a session directly, which it does. Restated as its own
  // test so a future change routing Google through /verify fails a NAMED
  // test rather than merely this file's other assertions.
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, {});
  const state = await startGoogle(base, csrf, cookie);
  await (await fetch(`${base}/auth/callback?code=abc&state=${state}`, { redirect: 'manual' })).text();
  assert.ok(!calls.some((c) => c.pathname.endsWith('/auth/v1/verify')), 'a code was requested for a Google identity');
});

test('a round trip honours next, the same way login does', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  const state = await startGoogle(base, csrf, cookie, { next: '/pricing' });
  const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`, { redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/pricing');
});

test('a round trip that creates an account consumes the parked consent, like login', async (t) => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, {});
  const state = await startGoogle(base, csrf, cookie);
  const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`, { redirect: 'manual' });
  assert.equal(res.status, 303);
  await res.text();
  const account = loadAccount({ root, accountId: listAccounts({ root })[0].accountId });
  assert.equal(account.consent?.granted, true, 'the account was created with no record of the agreement');
  assert.equal(account.consent?.text, PARKED_CONSENT.text);
});

test('a round trip with nothing parked still succeeds, and records no consent', async (t) => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, { pendingConsent: null });
  const state = await startGoogle(base, csrf, cookie);
  const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`, { redirect: 'manual' });
  assert.equal(res.status, 303);
  await res.text();
  const account = loadAccount({ root, accountId: listAccounts({ root })[0].accountId });
  assert.equal(account.consent, null, 'nothing was parked, so nothing should have been invented');
});

// ---------------------------------------------------------------------------
// nothing SupabaseAuthError or resolveIdentity carries reaches the page
// ---------------------------------------------------------------------------

test('nothing Supabase said about a failed exchange reaches the callback page', async (t) => {
  for (const kind of ['invalid_credentials', 'over_request_rate_limit', 'boom']) {
    // `failWith` makes EVERY upstream call fail that way, including the
    // `/auth/v1/token?grant_type=pkce` exchange -- but not `/auth/google`
    // itself, which never talks to Supabase at all, so a state can still be
    // minted normally before the exchange refuses it.
    const { base, csrf, cookie } = await startWithFakeSupabase(t, { failWith: kind });
    const state = await startGoogle(base, csrf, cookie);
    const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`, { redirect: 'manual' });
    assert.equal(res.status, 400, `a refused exchange is a 400, whatever ${kind} was upstream`);
    const body = await res.text();
    assert.ok(body.includes(OAUTH_FAILED_MESSAGE), `${kind} did not render the fixed sentence`);
    for (const leak of ['invalid_credentials', 'over_request_rate_limit', 'error_code',
      'SupabaseAuthError', 'supabase', 'internal error']) {
      assert.ok(!body.toLowerCase().includes(leak.toLowerCase()), `${kind} leaked ${leak} onto the page`);
    }
    assert.ok(!/\b(401|403|422|429|500)\b/.test(body), `${kind} leaked an upstream status onto the page`);
  }
});

test('an unverified Google identity refuses and re-parks the consent it took', async (t) => {
  // Google always confirms an address -- `identityFrom` reads
  // `email_confirmed_at` off the reply -- so this can only happen through a
  // caller that is not this slice's own designed flow. It is exercised here
  // anyway because it is the one branch `resolveIdentity` refuses by name,
  // and the re-park is an obligation this handler owes exactly as `login`
  // does; nothing forces either without a test that fails when it is missing.
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, {
    pendingConsent: null,
    reply: async ({ pathname }) => {
      if (pathname.endsWith('/auth/v1/token')) {
        // No email_confirmed_at, no confirmed_at: emailVerified comes out false.
        return { status: 200, json: { access_token: 'tok', user: { id: 'unverified-id', email: TEST_EMAIL } } };
      }
      return { status: 200, json: {} };
    },
  });
  putPending({ root, email: TEST_EMAIL, consent: PARKED_CONSENT });

  const state = await startGoogle(base, csrf, cookie);
  const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`, { redirect: 'manual' });
  assert.equal(res.status, 400);
  assert.ok(!res.headers.get('set-cookie'), 'no session from an unverified identity');
  await res.text();

  assert.equal(listAccounts({ root }).length, 0, 'an unverified identity must not create an account');

  const parked = takePending({ root, email: TEST_EMAIL });
  assert.ok(parked, 'the parked consent was lost on a failed resolve, not returned');
  assert.equal(parked.consent.granted, true);
  assert.equal(parked.consent.text, PARKED_CONSENT.text);
});

// ---------------------------------------------------------------------------
// no Supabase configured -- both routes 503, and mint nothing
// ---------------------------------------------------------------------------

test('a server with no Supabase 503s both routes, and mints no session', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, { withSupabase: false });

  const posted = await postForm(`${base}/auth/google`, { csrf }, cookie);
  assert.equal(posted.status, 503);
  assert.ok(!posted.headers.get('set-cookie'));
  await posted.text();

  const called = await fetch(`${base}/auth/callback?code=abc&state=whatever`, { redirect: 'manual' });
  assert.equal(called.status, 503);
  assert.ok(!called.headers.get('set-cookie'));
  await called.text();
});

// ---------------------------------------------------------------------------
// the button, and the header that keeps its redirect from being silently blocked
// ---------------------------------------------------------------------------

test('the Google button is on both the login and the signup page, as a plain form carrying the csrf pair', async (t) => {
  const { base } = await startWithFakeSupabase(t, {});
  for (const path_ of ['/login', '/signup']) {
    const res = await getPage(`${base}${path_}`);
    const body = await res.text();
    assert.match(body, /<form method="post" action="\/auth\/google">/, `${path_} has no Google form`);
    assert.match(body, /Sign in with Google/, `${path_} has no Google button`);
    // The same form-then-csrf shape every other credential form in this app
    // uses -- proof there is no <script> anywhere driving this button.
    assert.match(body, /name="csrf" value="[^"]+"/, `${path_}'s Google form carries no csrf token`);
  }
});

test('the CSP lets the Google redirect through, or the button would silently do nothing', async (t) => {
  const { base } = await startWithFakeSupabase(t, {});
  const res = await getPage(`${base}/login`);
  await res.text();
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /form-action[^;]*https:\/\/\*\.supabase\.co/,
    'form-action has no Supabase origin -- POST /auth/google\'s 303 would be blocked silently');
});
