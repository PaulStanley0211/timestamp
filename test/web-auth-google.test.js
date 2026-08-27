/**
 * The Google round trip. Task 10, spec §3 and §4.2 -- and a fix round,
 * 2026-08-26, after review found the spec itself was narrower than its own
 * threat model.
 *
 * WHY THIS FILE HAS NO HARNESS OF ITS OWN. `test/web-auth-code.test.js` builds
 * a real server against a real `createSupabaseAuth` over a faked HTTPS
 * transport, and everything below reuses that harness verbatim rather than
 * inventing a second one -- `startWithFakeSupabase`, `postForm`, `getPage`
 * and `TEST_EMAIL` are all imported from there.
 *
 * ONE DELIBERATE DIFFERENCE FROM THE TASK BRIEF'S SNIPPET, BEYOND THE ONE
 * `web-auth-code.test.js` ALREADY DOCUMENTS. The brief's own example writes
 * `const { base, startGoogle } = await startWithFakeSupabase({});` as though
 * `startGoogle` were part of the shared harness. It is not -- adding it there
 * would mean editing a file this task's brief does not list for modification,
 * and outside a temporary root nothing in that harness needs to know Google
 * exists. `startGoogle` is a small LOCAL helper below: it POSTs to
 * `/auth/google` with the harness's own csrf pair and pulls the `state`, the
 * `code_challenge`, and the new binding cookie back out of the response --
 * exactly what a browser would carry forward, just without a body to click.
 *
 * THE BINDING COOKIE IS NOT OPTIONAL IN THESE TESTS AND THAT IS THE POINT.
 * Review finding (2026-08-26): the brief's own three tests hit
 * `/auth/callback` with a bare `fetch()` carrying no cookie at all, which is
 * exactly the shape that let a `state`-only store look sufficient when it was
 * not -- an attacker who completes their OWN round trip can hand a victim the
 * resulting `/auth/callback?state=&code=` URL, and a check that only asks
 * "was this state ever issued" says yes. Every test below that expects a
 * SUCCESSFUL round trip now carries the `Set-Cookie` `/auth/google` actually
 * set, via `startGoogle`'s returned `oauthCookie`; the tests that expect a
 * refusal deliberately withhold it, tamper with it, or bind it to a different
 * state, and are the section that proves the fix rather than assuming it.
 *
 * WHAT IS FAKE AND WHAT IS NOT. Same as the parent file: only the Supabase
 * HTTPS transport is faked. `resolveIdentity`, `accounts.mjs`, `session.mjs`,
 * `oauth-store.mjs` and `pkce.mjs` are the real modules running against a
 * temporary root, because this task's whole subject is whether a `state` this
 * server did not issue -- or one presented by the wrong browser -- can ever
 * produce a session, and a faked verifier store would only prove the fake
 * refuses correctly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { OAUTH_FAILED_MESSAGE, AUTH_RATE_LIMITS } from '../scripts/web/server.mjs';
import { OAUTH_STATE_COOKIE } from '../scripts/web/session-middleware.mjs';
import {
  startWithFakeSupabase, postForm, getPage, TEST_EMAIL,
} from './web-auth-code.test.js';
import { putPending, takePending } from '../scripts/auth/pending-signup.mjs';
import { OAUTH_DIR } from '../scripts/auth/oauth-store.mjs';
import { challengeFor } from '../scripts/auth/pkce.mjs';
import { listAccounts, loadAccount } from '../scripts/auth/accounts.mjs';

/** Consent as `pending-signup.mjs` parks it -- same shape the parent file's
 *  own `PARKED_CONSENT` uses, redeclared here rather than imported because the
 *  parent does not export it. */
const PARKED_CONSENT = Object.freeze({
  granted: true, at: '2026-08-26T00:00:00.000Z', text: 'I am in this photo and I agree.',
});

/**
 * A browser clicking "Sign in with Google": POST the form, and hand back
 * everything a browser would carry forward -- the `state` this server
 * minted, the `code_challenge` it sent Supabase, and the `Set-Cookie` that
 * binds this browser to that state.
 *
 * NOT PART OF THE SHARED HARNESS -- see the file header.
 */
async function startGoogle(base, csrf, cookie, extra = {}) {
  const res = await postForm(`${base}/auth/google`, { csrf, ...extra }, cookie);
  assert.equal(res.status, 303, 'POST /auth/google did not redirect to Supabase');
  const setCookies = res.headers.getSetCookie();
  await res.text();
  const location = res.headers.get('location');
  const loc = new URL(location);
  const codeChallenge = loc.searchParams.get('code_challenge');
  const redirectTo = loc.searchParams.get('redirect_to');
  assert.ok(redirectTo, 'the authorize url carries no redirect_to');
  const state = new URL(redirectTo).searchParams.get('state');
  assert.ok(state, 'no state was embedded in redirect_to');
  const oauthLine = setCookies.find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`));
  assert.ok(oauthLine, 'POST /auth/google set no oauth-state cookie');
  return { state, codeChallenge, oauthCookie: oauthLine.split(';')[0] };
}

// ---------------------------------------------------------------------------
// the brief's own three tests, reproduced (the first's assertion narrowed --
// see the note beside it)
// ---------------------------------------------------------------------------

test('a callback carrying a state we never issued is refused', async (t) => {
  const { base } = await startWithFakeSupabase(t, {});
  const res = await fetch(`${base}/auth/callback?code=abc&state=never-issued`, { redirect: 'manual' });
  assert.equal(res.status, 400);
  // NARROWED FROM THE BRIEF'S OWN `!res.headers.get('set-cookie')`, and said
  // so rather than done quietly: this response now ALWAYS clears the binding
  // cookie on every exit, so a Set-Cookie header is present here on purpose
  // (see "the binding cookie is cleared on every exit" below). What must
  // still be absent is a SESSION.
  assert.ok(!(res.headers.get('set-cookie') ?? '').includes('timestamp_session='),
    'no session from an unissued state');
});

test('a state cannot be spent twice', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  const { state, oauthCookie } = await startGoogle(base, csrf, cookie);
  const first = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
    headers: { cookie: oauthCookie }, redirect: 'manual',
  });
  assert.equal(first.status, 303);
  await first.text();
  const second = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
    headers: { cookie: oauthCookie }, redirect: 'manual',
  });
  assert.equal(second.status, 400, 'the verifier was single use');
});

test('the authorize redirect carries S256 and never the verifier, and plants an HttpOnly, SameSite=Lax binding cookie', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  const res = await postForm(`${base}/auth/google`, { csrf }, cookie);
  assert.equal(res.status, 303);
  const setCookies = res.headers.getSetCookie();
  await res.text();
  const location = res.headers.get('location');
  assert.match(location, /code_challenge_method=S256/);
  assert.ok(!/code_verifier/.test(location), 'the verifier never leaves this machine');

  const stateCookie = setCookies.find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`));
  assert.ok(stateCookie, 'no oauth-state cookie was set');
  assert.match(stateCookie, /HttpOnly/, 'a script could read the binding cookie');
  // `Lax`, NOT `Strict`: the callback arrives as a cross-site top-level GET
  // from Supabase, and Strict would suppress the cookie on exactly the
  // request it exists to protect.
  assert.match(stateCookie, /SameSite=Lax/);
  assert.ok(!/SameSite=Strict/i.test(stateCookie), 'Strict would break every legitimate sign-in');
});

// ---------------------------------------------------------------------------
// state is not decorative -- the ways it could be bypassed, each closed
// ---------------------------------------------------------------------------

test('an expired state is refused, and the verifier is gone from disk either way', async (t) => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, {});
  const { state, oauthCookie } = await startGoogle(base, csrf, cookie);
  // A REAL state and a REAL binding cookie from a REAL /auth/google POST --
  // only the file's own expiry is pushed into the past, exactly what a real
  // ten minutes would eventually produce. Seeding a fabricated state here
  // instead would test the file store in isolation and say nothing about the
  // cookie check that now runs in front of it.
  const file = path.join(root, ...OAUTH_DIR.split('/'), `${state}.json`);
  const row = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...row, expiresAt: new Date(0).toISOString() }));

  const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
    headers: { cookie: oauthCookie }, redirect: 'manual',
  });
  assert.equal(res.status, 400);
  assert.ok(!(res.headers.get('set-cookie') ?? '').includes('timestamp_session='), 'no session from an expired state');
  assert.ok(!fs.existsSync(file), '`takeVerifier` must delete on the expired exit path too');
});

test('a google post that cannot prove it came from this form writes nothing to disk and sets no oauth-state cookie', async (t) => {
  const { base, root, cookie } = await startWithFakeSupabase(t, {});
  const res = await postForm(`${base}/auth/google`, { csrf: 'not-a-token' }, cookie);
  assert.equal(res.status, 403);
  assert.ok(!(res.headers.get('set-cookie') ?? '').includes(`${OAUTH_STATE_COOKIE}=`));
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
  assert.ok(!(res.headers.get('set-cookie') ?? '').includes(`${OAUTH_STATE_COOKIE}=`));
  const dir = path.join(root, ...OAUTH_DIR.split('/'));
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  assert.deepEqual(files, [], 'a cross-site post still minted a verifier');
});

// ---------------------------------------------------------------------------
// THE FIX ROUND -- state IS bound to the browser that requested it
// ---------------------------------------------------------------------------

test('redeeming a valid state with no cookie fails, and the row survives for whoever actually holds it', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  const { state, oauthCookie } = await startGoogle(base, csrf, cookie);

  // This is the attack, reproduced: a request holding a genuinely-issued
  // `state` and no relationship to the browser that requested it.
  const bare = await fetch(`${base}/auth/callback?code=abc&state=${state}`, { redirect: 'manual' });
  assert.equal(bare.status, 400);
  assert.ok(!(bare.headers.get('set-cookie') ?? '').includes('timestamp_session='),
    'a request carrying no cookie at all minted a session');
  await bare.text();

  // AND THE ROW MUST STILL BE THERE. The cookie check runs BEFORE
  // takeVerifier precisely so a decoy request cannot burn the legitimate
  // browser's one shot at its own state.
  const legit = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
    headers: { cookie: oauthCookie }, redirect: 'manual',
  });
  assert.equal(legit.status, 303, 'a cookie-less request consumed the row a legitimate browser still needed');
});

test('redeeming with a cookie bound to a DIFFERENT state fails', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  const mine = await startGoogle(base, csrf, cookie);
  const someoneElses = await startGoogle(base, csrf, cookie);

  // A genuine, correctly-signed cookie -- just not for THIS state.
  const res = await fetch(`${base}/auth/callback?code=abc&state=${someoneElses.state}`, {
    headers: { cookie: mine.oauthCookie }, redirect: 'manual',
  });
  assert.equal(res.status, 400);
  assert.ok(!(res.headers.get('set-cookie') ?? '').includes('timestamp_session='));
});

test('a tampered oauth-state cookie fails', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  const { state, oauthCookie } = await startGoogle(base, csrf, cookie);
  const tampered = `${oauthCookie}x`; // flips the signed value, so the MAC no longer matches
  const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
    headers: { cookie: tampered }, redirect: 'manual',
  });
  assert.equal(res.status, 400);
  assert.ok(!(res.headers.get('set-cookie') ?? '').includes('timestamp_session='));
});

test('an unsigned oauth-state cookie -- the bare state, no signature at all -- fails', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  const { state } = await startGoogle(base, csrf, cookie);
  const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
    headers: { cookie: `${OAUTH_STATE_COOKIE}=${state}` }, redirect: 'manual',
  });
  assert.equal(res.status, 400);
  assert.ok(!(res.headers.get('set-cookie') ?? '').includes('timestamp_session='));
});

// ---------------------------------------------------------------------------
// the happy path, WITH the cookie, and what it must and must not do
// ---------------------------------------------------------------------------

test('a completed round trip signs somebody in, revokes Supabase\'s own session, and clears the binding cookie', async (t) => {
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, {});
  const { state, oauthCookie } = await startGoogle(base, csrf, cookie);
  const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
    headers: { cookie: oauthCookie }, redirect: 'manual',
  });
  assert.equal(res.status, 303);
  // CORRECTED for finding 1 of the whole-branch review: this assertion used
  // to read '/onboarding' unconditionally, which was true only by accident --
  // the old code fell back to '/onboarding' whenever `next` was absent,
  // whatever the account's consent looked like. `startWithFakeSupabase`
  // defaults to a consent already PARKED for this address, so the account
  // this round trip resolves does not need the repair `/onboarding` exists
  // for, and with no `next` supplied the correct landing -- `login`'s own
  // rule, now applied here too -- is home.
  assert.equal(res.headers.get('location'), '/');
  const setCookies = res.headers.getSetCookie();
  assert.ok(setCookies.some((c) => /timestamp_session=/.test(c)), 'no session cookie was minted');
  const clearedState = setCookies.find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`));
  assert.ok(clearedState, 'the binding cookie was not cleared on a successful round trip');
  assert.match(clearedState, /Max-Age=0/, 'the binding cookie was not actually cleared');
  await res.text();
  assert.ok(calls.some((c) => c.url.includes('/logout')), 'revoke at the door never happened');
});

test('a Google sign-in never reaches the six-digit code flow', async (t) => {
  // Nothing here posts to /verify at all -- the assertion is that the round
  // trip above lands a session directly, which it does. Restated as its own
  // test so a future change routing Google through /verify fails a NAMED
  // test rather than merely this file's other assertions.
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, {});
  const { state, oauthCookie } = await startGoogle(base, csrf, cookie);
  await (await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
    headers: { cookie: oauthCookie }, redirect: 'manual',
  })).text();
  assert.ok(!calls.some((c) => c.pathname.endsWith('/auth/v1/verify')), 'a code was requested for a Google identity');
});

test('a round trip honours next, the same way login does', async (t) => {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  const { state, oauthCookie } = await startGoogle(base, csrf, cookie, { next: '/pricing' });
  const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
    headers: { cookie: oauthCookie }, redirect: 'manual',
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/pricing');
});

test('a round trip that opens an account with no consent parked honours the consent repair over next, like login', async (t) => {
  // Finding 1 of the whole-branch review: `login` was deliberately fixed NOT
  // to honour `next` when consent is missing, because the whole point of the
  // repair is that every such account passes through `/onboarding` -- a
  // `next` that skipped it would reopen the gap that fix closed. This is the
  // concrete path the review named: a signed-out visitor hits a gated page,
  // is sent to `/login?next=...`, and completes a BRAND NEW Google account
  // with nothing parked (`pendingConsent: null`) -- exactly `login`'s repair
  // case, reached through the other route that can open an account.
  const { base, csrf, cookie } = await startWithFakeSupabase(t, { pendingConsent: null });
  const { state, oauthCookie } = await startGoogle(base, csrf, cookie, { next: '/pricing' });
  const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
    headers: { cookie: oauthCookie }, redirect: 'manual',
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/onboarding',
    'a next that skipped the consent repair reopened the gap login was fixed to close');
  await res.text();
});

test('a round trip that creates an account consumes the parked consent, like login', async (t) => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, {});
  const { state, oauthCookie } = await startGoogle(base, csrf, cookie);
  const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
    headers: { cookie: oauthCookie }, redirect: 'manual',
  });
  assert.equal(res.status, 303);
  await res.text();
  const account = loadAccount({ root, accountId: listAccounts({ root })[0].accountId });
  assert.equal(account.consent?.granted, true, 'the account was created with no record of the agreement');
  assert.equal(account.consent?.text, PARKED_CONSENT.text);
});

test('a round trip with nothing parked still succeeds, and records no consent', async (t) => {
  const { base, csrf, cookie, root } = await startWithFakeSupabase(t, { pendingConsent: null });
  const { state, oauthCookie } = await startGoogle(base, csrf, cookie);
  const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
    headers: { cookie: oauthCookie }, redirect: 'manual',
  });
  assert.equal(res.status, 303);
  await res.text();
  const account = loadAccount({ root, accountId: listAccounts({ root })[0].accountId });
  assert.equal(account.consent, null, 'nothing was parked, so nothing should have been invented');
});

// ---------------------------------------------------------------------------
// closing the PKCE loop end to end -- not just "an exchange happened"
// ---------------------------------------------------------------------------

test('the token exchange sends exactly the code the callback received, and a verifier that hashes to the challenge that was sent', async (t) => {
  const { base, csrf, cookie, calls } = await startWithFakeSupabase(t, {});
  const { state, oauthCookie, codeChallenge } = await startGoogle(base, csrf, cookie);
  const res = await fetch(`${base}/auth/callback?code=THE-REAL-AUTH-CODE&state=${state}`, {
    headers: { cookie: oauthCookie }, redirect: 'manual',
  });
  assert.equal(res.status, 303);
  await res.text();

  const tokenCall = calls.find((c) => c.pathname.endsWith('/auth/v1/token') && c.search.includes('grant_type=pkce'));
  assert.ok(tokenCall, 'no pkce token exchange was recorded');
  // A wiring bug that swapped or dropped either value would still pass every
  // OTHER test in this file, because the fake transport accepts any body at
  // `/auth/v1/token`. This is the assertion that actually reads what was sent.
  assert.equal(tokenCall.body.auth_code, 'THE-REAL-AUTH-CODE',
    'the exchange sent a different code than the one the callback received');
  assert.equal(challengeFor(tokenCall.body.code_verifier), codeChallenge,
    'the verifier sent to Supabase does not hash to the challenge that was sent to it earlier');
});

// ---------------------------------------------------------------------------
// nothing SupabaseAuthError or resolveIdentity carries reaches the page
// ---------------------------------------------------------------------------

test('nothing Supabase said about a failed exchange reaches the callback page', async (t) => {
  for (const kind of ['invalid_credentials', 'over_request_rate_limit', 'boom']) {
    // `failWith` makes EVERY upstream call fail that way, including the
    // `/auth/v1/token?grant_type=pkce` exchange -- but not `/auth/google`
    // itself, which never talks to Supabase at all, so a state (and a
    // binding cookie) can still be minted normally before the exchange
    // refuses it.
    const { base, csrf, cookie } = await startWithFakeSupabase(t, { failWith: kind });
    const { state, oauthCookie } = await startGoogle(base, csrf, cookie);
    const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
      headers: { cookie: oauthCookie }, redirect: 'manual',
    });
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

  const { state, oauthCookie } = await startGoogle(base, csrf, cookie);
  const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
    headers: { cookie: oauthCookie }, redirect: 'manual',
  });
  assert.equal(res.status, 400);
  assert.ok(!(res.headers.get('set-cookie') ?? '').includes('timestamp_session='), 'no session from an unverified identity');
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
// POST /auth/google is rate-limited, like every other credential route here
// ---------------------------------------------------------------------------

test('one connection cannot open unlimited Google round trips', async (t) => {
  // Review finding: the CSRF pair that gates this route is a stateless,
  // unexpiring double-submit value, so one GET /login buys an unbounded
  // number of these posts without a limiter -- and each one writes a file
  // under out/oauth/ that nothing sweeps yet.
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {});
  let sawLimit = false;
  for (let i = 0; i < AUTH_RATE_LIMITS.google.max + 3; i += 1) {
    const res = await postForm(`${base}/auth/google`, { csrf }, cookie);
    if (res.status === 429) {
      sawLimit = true;
      assert.ok(res.headers.get('retry-after'), 'a 429 with no Retry-After');
      await res.text();
      break;
    }
    assert.equal(res.status, 303, `attempt ${i + 1} should still be allowed`);
    await res.text();
  }
  assert.ok(sawLimit, 'the per-connection limiter never fired on /auth/google');
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
  // THE CHAIN IS TWO HOPS, NOT ONE, AND THE SECOND IS THE ONE THAT WAS MISSING.
  // Chrome checks `form-action` against EVERY target in a form submission's
  // redirect chain, not just the first. This POST goes to this origin, 303s to
  // Supabase's `/auth/v1/authorize`, and Supabase then 302s to Google's own
  // consent screen -- so `accounts.google.com` is as load-bearing as the
  // Supabase origin above, and its absence has exactly the same symptom the
  // comment above predicts: the navigation is cancelled before any request
  // leaves and the button appears dead.
  //
  // MEASURED 2026-08-27 against the real project, because this was misread for
  // a day: hop 1 answered 303, hop 2 answered `302 -> accounts.google.com`, and
  // Chrome refused the submission naming `form-action` in the console. Node
  // enforces no CSP at all, which is why every earlier probe from Node saw a
  // healthy 302 and the failure was attributed to a 503 from Supabase that
  // this endpoint never sent.
  assert.match(csp, /form-action[^;]*https:\/\/accounts\.google\.com/,
    'form-action has no Google origin -- Supabase\'s 302 to the consent screen would be blocked silently');
});
