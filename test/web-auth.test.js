/**
 * Accounts, sessions, ownership and credits, at the HTTP boundary.
 *
 * `scripts/auth/` is faked here for the same reason the queue is faked in
 * `web-api.test.js`: it is written against `docs/interfaces-app.md` A in
 * parallel with this layer and has its own tests, and what is under test here is
 * whether the *web* layer uses it correctly -- gates the right routes, refuses
 * somebody else's job, spends credits at enqueue rather than at completion, and
 * puts nothing resembling a payment field on a page.
 *
 * THE TEST THIS FILE EXISTS FOR is `account B gets a 404 on account A's job`. It
 * is written against every job route rather than one, because the failure mode
 * is per-handler: a route that forgets the check is a route that hands a
 * stranger a photograph of somebody's face, and it is exactly the kind of thing
 * that gets added later and gets the check copied in later still.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  createServer, safeNext, AUTH_RATE_LIMITS, IDENTITY_SWEEP_MS,
  VERIFY_ATTEMPTS_DIR, CODE_COOLOFF_MS, chargeCodeAttempt,
} from '../scripts/web/server.mjs';
import { SupabaseAuthError } from '../scripts/auth/supabase-auth.mjs';
import { BAD_CREDENTIALS_MESSAGE, emailHash } from '../scripts/auth/accounts.mjs';
import { putPending, PENDING_DIR } from '../scripts/auth/pending-signup.mjs';
import { putVerifier, OAUTH_DIR } from '../scripts/auth/oauth-store.mjs';
import { DEFAULT_RETENTION_SWEEP_MS } from '../scripts/worker/worker.mjs';
import { supabaseFromEnv } from '../scripts/web/server-cli.mjs';
import { ROUTES, PUBLIC_ROUTES, isPublicRoute } from '../scripts/web/router.mjs';
import {
  createSessions, parseCookies, serializeCookie, isSecureRequest,
  missingAuthFunctions, SESSION_COOKIE, AuthUnavailableError,
} from '../scripts/web/session-middleware.mjs';
import { createJob, saveJob, jobPaths, setJobStatus, completeJob } from '../scripts/render/job.mjs';

const CFG = JSON.parse(fs.readFileSync(new URL('../config/render.json', import.meta.url), 'utf8'));
const BOUNDARY = 'authboundary44';
const SHAPED_ID = '20260820-144501-a3f19c';

function fakeQueue() {
  const calls = { enqueued: [] };
  return {
    calls,
    enqueue(jobId) { calls.enqueued.push(jobId); },
    peek({ state = 'pending' } = {}) { return state === 'claimed' ? [] : calls.enqueued.map((jobId) => ({ jobId })); },
    stats() { return { pending: calls.enqueued.length, claimed: 0, done: 0, failed: 0 }; },
  };
}

const PLANS = Object.freeze({
  free: { id: 'free', label: 'Free', monthlyUSD: 0, annualUSD: 0, creditsPerPeriod: 51 },
  shelf: { id: 'shelf', label: 'Shelf', monthlyUSD: 10, annualUSD: 100, creditsPerPeriod: 153 },
  archive: { id: 'archive', label: 'Archive', monthlyUSD: 12, annualUSD: 120, creditsPerPeriod: 204 },
});

/**
 * `CREDIT_COSTS` as `scripts/auth/credits.mjs` exports it: every row the config
 * knows about, INCLUDING the deferred one, each carrying its own `available`.
 * The deferred row is the point -- the UI has to know 1080p exists in order to
 * render it disabled, and the page must be built from this rather than from a
 * list written into the web layer. The figures are the live ones: 51 CR at
 * 480p, 152 at 720p, 341 at the deferred 1080p.
 */
const CREDIT_COSTS = Object.freeze({
  '480p': { resolution: '480p', width: 854, height: 480, available: true, creditsPerReference: 51 },
  '720p': { resolution: '720p', width: 1280, height: 720, available: true, creditsPerReference: 152 },
  '1080p': { resolution: '1080p', width: 1920, height: 1080, available: false, creditsPerReference: 341 },
});

const TIERS = Object.freeze({ standard: { multiplier: 1 } });

/**
 * `scripts/auth/` as documented in docs/interfaces-app.md A, in memory.
 *
 * Only the surface the web layer is specified to call. `credits` is an opening
 * balance this fake adds so a test can put an account in front of a balance it
 * cannot exhaust by accident.
 */
function fakeAuth() {
  const accounts = new Map();
  const byEmail = new Map();
  const sessions = new Map();
  const SECRET = 'a-secret-that-is-not-a-real-secret';
  let n = 0;

  const sign = (value, secret) => `${value}.${crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 16)}`;

  return {
    PLANS,
    CREDIT_COSTS,
    accounts,
    sessions,

    createAccount({ email, password, plan = 'free', credits = null }) {
      const key = String(email).toLowerCase();
      if (byEmail.has(key)) {
        const err = new Error('email already registered');
        err.code = 'EMAIL_TAKEN';
        err.userMessage = 'That email already has an account.';
        throw err;
      }
      n += 1;
      const account = {
        accountId: `acct-${n}`,
        root: '/fake',
        email,
        plan,
        password,
        credits: credits ?? PLANS[plan].creditsPerPeriod,
        ledger: [],
      };
      accounts.set(account.accountId, account);
      byEmail.set(key, account.accountId);
      return account;
    },
    findAccountByEmail({ email }) {
      const id = byEmail.get(String(email ?? '').toLowerCase());
      return id ? accounts.get(id) : null;
    },
    verifyPassword(account, password) {
      return typeof password === 'string' && password.length > 0 && account.password === password;
    },
    loadAccount({ accountId }) {
      const account = accounts.get(accountId);
      if (!account) throw new Error(`no account ${accountId}`);
      return account;
    },
    saveAccount() {},
    setPlan(account, planId) { account.plan = planId; },

    createSession({ accountId }) {
      n += 1;
      const sessionId = `sess-${n}`;
      sessions.set(sessionId, { sessionId, accountId });
      return { sessionId, expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
    },
    readSession({ sessionId }) { return sessions.get(sessionId) ?? null; },
    destroySession({ sessionId }) { sessions.delete(sessionId); },
    signCookie: sign,
    verifyCookie(signed, secret) {
      const cut = String(signed ?? '').lastIndexOf('.');
      if (cut < 1) return null;
      const value = signed.slice(0, cut);
      return sign(value, secret) === signed ? value : null;
    },
    sessionSecret() { return SECRET; },

    // THROWS ON A DEFERRED RESOLUTION, exactly as the real module does, so that
    // nothing can bill for one size and render another. That is why the quality
    // row is built from CREDIT_COSTS and this is called only for the one the
    // person actually picked.
    creditCost({ resolution = '480p', seconds = 15, tier = 'standard' } = {}) {
      const row = CREDIT_COSTS[resolution];
      if (!row) {
        const err = new Error(`unknown resolution ${resolution}`);
        err.code = 'UNKNOWN_RESOLUTION';
        err.userMessage = 'That output size is not available.';
        throw err;
      }
      if (row.available === false) {
        const err = new Error(`${resolution} is deferred`);
        err.code = 'RESOLUTION_UNAVAILABLE';
        err.userMessage = 'That output size is not available yet.';
        throw err;
      }
      const multiplier = TIERS[tier]?.multiplier;
      if (multiplier === undefined) {
        const err = new Error(`unknown tier ${tier}`);
        err.code = 'UNKNOWN_TIER';
        throw err;
      }
      return Math.ceil((row.creditsPerReference * (seconds / 15)) * multiplier);
    },
    /** One error, one sentence, one duration for both failures. */
    authenticate({ email, password }) {
      const id = byEmail.get(String(email ?? '').toLowerCase());
      const account = id ? accounts.get(id) : null;
      if (!account || account.password !== password || !password) {
        const err = new Error('email not found or password did not verify');
        err.code = 'BAD_CREDENTIALS';
        err.userMessage = 'That email and password do not match an account.';
        throw err;
      }
      return account;
    },
    balanceOf(account) {
      return { credits: account.credits, planId: account.plan, grantedAt: null, expiresAt: null };
    },
    debitCredits(account, { jobId, credits }) {
      // Idempotent by jobId, the way the real module is: a re-enqueue of a job
      // that has already been charged is the same render, not a new one.
      if (account.ledger.some((e) => e.jobId === jobId && e.delta < 0)) return;
      if (account.credits < credits) {
        const err = new Error('insufficient credits');
        err.code = 'INSUFFICIENT_CREDITS';
        err.userMessage = 'Not enough credits for that tape.';
        throw err;
      }
      account.credits -= credits;
      account.ledger.push({ jobId, delta: -credits, at: new Date().toISOString() });
    },
    refundCredits(account, { jobId }) {
      const spent = account.ledger.find((e) => e.jobId === jobId && e.delta < 0);
      if (!spent || account.ledger.some((e) => e.jobId === jobId && e.delta > 0)) return;
      account.credits += -spent.delta;
      account.ledger.push({ jobId, delta: -spent.delta, at: new Date().toISOString() });
    },
    /**
     * Idempotent by `ref`, the way the real module is.
     *
     * ADDED 2026-08-25 with the Stripe webhook, and it is in this fake for one
     * reason: `REQUIRED_AUTH` now names it, so a fake without it is a fake that
     * no longer matches the documented surface -- which is the whole point of
     * the assertion below. The REPLAY behaviour is tested against the real
     * on-disk ledger in test/web-billing.test.js, because a fake that dedupes
     * correctly would only ever prove that the fake dedupes correctly.
     */
    grantCredits(account, { credits, reason, ref = null }) {
      if (ref !== null && account.ledger.some((e) => e.ref === ref)) {
        return { granted: false, credits: 0, ref };
      }
      account.credits += credits;
      account.ledger.push({ jobId: null, delta: credits, reason, ref, at: new Date().toISOString() });
      return { granted: true, credits, ref };
    },
  };
}

/**
 * `signup` (task 8) now asks Supabase before parking anything, so a server
 * built here needs a `supabase` even though this file's own subject is the
 * local `scripts/auth/` surface above, not identity. This is the smallest
 * thing that satisfies `sb.signUp` -- it is not `createSupabaseAuth`, and it
 * never touches a network; that shape is covered end to end, transport and
 * all, in `test/web-auth-code.test.js`.
 *
 * `taken` names addresses this fake treats as already registered, so a test
 * can reproduce the one upstream shape that matters here -- Supabase refusing
 * a taken address -- without standing up the real HTTPS transport for it.
 *
 * TASK 9 ADDS `signInWithPassword` AND `revoke`, for the same reason: `login`
 * now asks Supabase too. `FAKE_SUPABASE_PASSWORD` is the one password this
 * fake accepts, which is already the fixed string nearly every test in this
 * file uses as "the right one" -- so a genuine sign-in through `/login`
 * succeeds exactly where it always did, and anything else (a typo, an
 * unregistered address) is refused the same way Supabase refuses both: one
 * `SupabaseAuthError`, indistinguishable from the caller's side. The identity
 * it hands back is real enough for `resolveIdentity` (task 5) to resolve
 * through the REAL `scripts/auth/identity.mjs` + `accounts.mjs` against this
 * test's own temp root -- deliberately independent of the fake `auth` object
 * above, which is why `signIn()` below no longer goes through this path for
 * its own purposes.
 */
const FAKE_SUPABASE_PASSWORD = 'a long enough password';

function fakeSupabaseIdentity({ taken = new Set() } = {}) {
  const calls = [];
  return {
    calls,
    async signUp({ email, password, clientIp }) {
      calls.push({ email, password, clientIp });
      if (taken.has(String(email).toLowerCase())) {
        throw new SupabaseAuthError('User already registered', { status: 422, code: 'user_already_exists' });
      }
      return { pending: true };
    },
    async signInWithPassword({ email, password, clientIp }) {
      calls.push({ email, password, clientIp, kind: 'signIn' });
      if (password !== FAKE_SUPABASE_PASSWORD) {
        throw new SupabaseAuthError('Invalid login credentials', { status: 400, code: 'invalid_credentials' });
      }
      const address = String(email).toLowerCase();
      return {
        identity: {
          supabaseUserId: `sb-${address.replace(/[^a-z0-9-]/g, '-')}`,
          email: address,
          emailVerified: true,
          provider: 'email',
          accessToken: `fake-access-token-${address}`,
        },
      };
    },
    async revoke({ accessToken }) {
      calls.push({ accessToken, kind: 'revoke' });
      return { ok: true };
    },
  };
}

function multipart(parts) {
  const chunks = [];
  for (const p of parts) {
    const disposition = p.filename === undefined
      ? `form-data; name="${p.name}"`
      : `form-data; name="${p.name}"; filename="${p.filename}"`;
    chunks.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: ${disposition}\r\n\r\n`, 'latin1'));
    chunks.push(Buffer.isBuffer(p.body) ? p.body : Buffer.from(String(p.body), 'utf8'));
    chunks.push(Buffer.from('\r\n', 'latin1'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`, 'latin1'));
  return Buffer.concat(chunks);
}

const photoBytes = (salt = 'x') => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  crypto.createHash('sha512').update(salt).digest(),
]);

const uploadParts = (salt = 'x', resolution = '480p') => ([
  { name: 'photo', filename: 'me.png', body: photoBytes(salt) },
  { name: 'place', body: 'ostsee-strand' },
  { name: 'outfit', body: 'fleecepulli' },
  { name: 'resolution', body: resolution },
  { name: 'consent', body: 'yes' },
]);

/** GET the form first, the way a browser does: the anti-forgery pair -- the
 *  cookie off the response and the hidden field out of the HTML -- is required
 *  to post credentials at all. */
async function csrfPair(base, path = '/login') {
  const res = await fetch(`${base}${path}`, { headers: { accept: 'text/html' } });
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const csrf = (await res.text()).match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
  return { cookie, csrf };
}

/**
 * Mint a session directly against the FAKE local `scripts/auth/` surface,
 * rather than posting to `/login`.
 *
 * TASK 9 CHANGED WHAT `/login` DOES. It now asks Supabase and resolves the
 * identity through the REAL `scripts/auth/identity.mjs` + `accounts.mjs`
 * (`identityApi()` in `server.mjs` always imports those for real, whatever
 * `auth` fake this file injects for every other route) -- so a session minted
 * that way carries a real on-disk account id the fake `auth.loadAccount`
 * below has never heard of, and every gated route in this file would 500 on
 * it. This file's own subject is NOT login -- it is job ownership, credits
 * and session mechanics against a controllable fake -- so the dozens of
 * tests below that only need "a signed-in account" mint one directly against
 * the same fake primitives `startSession` would have used, and stay exactly
 * as they were. The login mechanics themselves -- Supabase exchange, CSRF,
 * the rate limit, the one-sentence refusal -- are covered on their own terms
 * further down this file (via the real `/login` route and
 * `fakeSupabaseIdentity().signInWithPassword`) and end to end, transport and
 * all, in `test/web-auth-code.test.js`.
 */
function signIn(auth, email, password) {
  const account = auth.findAccountByEmail({ email });
  if (!account || !auth.verifyPassword(account, password)) return null;
  const { sessionId } = auth.createSession({ accountId: account.accountId });
  return `${SESSION_COOKIE}=${auth.signCookie(sessionId, auth.sessionSecret())}`;
}

async function withApp(run, {
  auth = fakeAuth(), queue = fakeQueue(), sessions = null, nowImpl = null, trustProxy = undefined,
  supabase = fakeSupabaseIdentity(), logImpl = () => {},
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-auth-'));
  const app = createServer({
    root, cfg: CFG, queue, port: 0, auth: sessions ? null : auth, sessions, supabase,
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed',
    logImpl,
    ...(nowImpl ? { nowImpl } : {}),
    ...(trustProxy === undefined ? {} : { trustProxy }),
  });
  const port = await app.listen();
  try {
    await run({ base: `http://127.0.0.1:${port}`, root, app, auth, queue, supabase });
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function seedJob(app, root, owner, { status = 'queued' } = {}) {
  const job = createJob({
    root,
    input: {
      photo: { path: 'input/upload-photo', sha256: 'x'.repeat(64) },
      place: { kind: 'text', value: 'a beach' },
      outfit: { kind: 'text', value: 'a t-shirt' },
      stillCount: 3,
      consent: { granted: true, at: new Date().toISOString(), text: 'the wording' },
    },
    provider: 'fixture',
    cfg: CFG,
  });
  if (status !== 'queued') {
    setJobStatus(job, 'running');
    if (status === 'done') completeJob(job, { videoPath: 'timestamp.mp4', posterPath: 'poster.jpg' });
    else if (status !== 'running') setJobStatus(job, status);
  }
  saveJob(job);
  app.sessions.claimJob({ accountId: owner.accountId, jobId: job.jobId });
  return job;
}

// ---------------------------------------------------------------------------
// the gate
// ---------------------------------------------------------------------------

test('the public surface is exactly the allow-list, and nothing else', () => {
  // A deny-list would fail open. This asserts the shape of the decision, not
  // just its current contents: every route is classified, one way or the other.
  for (const route of ROUTES) {
    assert.equal(typeof isPublicRoute(route.name), 'boolean');
  }
  for (const name of PUBLIC_ROUTES) {
    assert.ok(ROUTES.some((r) => r.name === name), `${name} is public but is not a route`);
  }
  for (const name of ['statusPage', 'selectPage', 'resultPage',
    'createJob', 'getJob', 'cancelJob', 'listStills', 'getStill', 'select', 'getVideo', 'getPoster']) {
    assert.equal(isPublicRoute(name), false, `${name} must require an account`);
  }
});

/**
 * `homePage` left the gated list on 2026-08-21, when `/` gained a landing page.
 *
 * WHY THAT IS NOT A WEAKENING, AND WHAT REPLACED IT. The old guarantee was
 * structural -- the root path 303'd anybody without a session -- and it was
 * doing a job it was never the right tool for. The property that actually
 * matters is that **no account data reaches an anonymous request**, and a
 * redirect only enforced that as a side effect of refusing to render anything
 * at all. Now the route renders two different pages, so the property has to be
 * asserted on the OUTPUT rather than inferred from a status code. This test is
 * that assertion, and it is strictly stronger than the one it replaces: a
 * future edit that renders a shelf or a balance into the landing page fails
 * here, where the redirect check would have passed it.
 */
test('the landing page carries nothing that belongs to an account', async () => {
  await withApp(async ({ base, root, app, auth }) => {
    const a = auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    seedJob(app, root, a, { status: 'done' });

    const res = await fetch(`${base}/`, { headers: { accept: 'text/html' }, redirect: 'manual' });
    assert.equal(res.status, 200, 'the root path must render for a stranger, not redirect');
    const html = await res.text();

    // It is the landing page, not the app.
    assert.ok(html.includes('ordinary'), 'the headline is missing');
    assert.ok(html.includes('Make a tape'), 'the call to action is missing');

    // And it is ONLY the landing page.
    assert.ok(!html.includes('a beach'), 'a job belonging to an account leaked onto the public page');
    assert.ok(!html.includes('form="tape"'), 'the upload form is rendered to a stranger');
    assert.ok(!html.includes('name="photo"'), 'the file input is rendered to a stranger');
    assert.ok(!html.includes('class="creds'), 'a credit balance is rendered to a stranger');
    assert.ok(!/\bCR\b/.test(html), 'a credit figure reached a signed-out visitor');
    assert.ok(!html.includes('Sign out'), 'the signed-in nav is rendered to a stranger');
  });
});

test('the same path signed in is the app, not the landing page', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password', credits: 500 });
    const cookie = await signIn(auth, 'a@example.com', 'a long enough password');
    const html = await (await fetch(`${base}/`, { headers: { cookie, accept: 'text/html' } })).text();
    assert.ok(html.includes('form="tape"'), 'the signed-in page lost the upload form');
    assert.ok(!html.includes('Make a tape'), 'the landing call to action leaked into the app');
  });
});

test('every gated route refuses an anonymous request', async () => {
  await withApp(async ({ base }) => {
    const gated = ROUTES.filter((r) => !isPublicRoute(r.name));
    assert.ok(gated.length >= 11, 'the gated set should not have shrunk');

    for (const route of gated) {
      const target = route.pattern.replace(':id', SHAPED_ID).replace(':index', '1');
      // JSON clients get a status code they can branch on.
      const api = await fetch(`${base}${target}`, { method: route.method, redirect: 'manual' });
      assert.equal(api.status, 401, `${route.method} ${target} answered ${api.status} to an anonymous JSON client`);
      assert.equal((await api.json()).error.code, 'NOT_SIGNED_IN');

      // Browsers get sent to the sign-in page instead.
      const browser = await fetch(`${base}${target}`, {
        method: route.method, headers: { accept: 'text/html' }, redirect: 'manual',
      });
      assert.equal(browser.status, 303, `${route.method} ${target} did not redirect a browser`);
      assert.match(browser.headers.get('location'), /^\/login/);
    }
  });
});

/**
 * `auth.createAccount` above is the FAKE `scripts/auth/` this file injects for
 * every gated route -- but `/login` resolves identity through the REAL
 * `identity.mjs` + `accounts.mjs` against this test's own temp `root`
 * (see the big comment on `fakeSupabaseIdentity`, above), so it is a
 * SEPARATE, genuinely new account with no relation to the fake one and,
 * absent this park, no consent on file. Since task 12, `login` routes such
 * an account to `/onboarding` rather than `next` -- correctly, that is the
 * whole point of this test file's own fix -- so a test of the `next`
 * mechanic itself has to park a consent first, exactly as a real signup
 * would have, or it is testing the consent redirect by accident. */
function parkConsentFor(root, email) {
  putPending({ root, email, consent: { granted: true, text: 'the wording' } });
}

test('a browser is sent back where it was going after signing in', async () => {
  await withApp(async ({ base, auth, root }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    parkConsentFor(root, 'a@example.com');
    const res = await fetch(`${base}/j/${SHAPED_ID}`, { headers: { accept: 'text/html' }, redirect: 'manual' });
    assert.equal(res.headers.get('location'), `/login?next=${encodeURIComponent(`/j/${SHAPED_ID}`)}`);

    const pair = await csrfPair(base);
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html', cookie: pair.cookie },
      body: new URLSearchParams({ email: 'a@example.com', password: 'a long enough password', next: `/j/${SHAPED_ID}`, csrf: pair.csrf }),
      redirect: 'manual',
    });
    assert.equal(login.status, 303);
    assert.equal(login.headers.get('location'), `/j/${SHAPED_ID}`);
  });
});

/**
 * `next=https://evil.example` on a login page is the textbook open redirect: the
 * link is ours, the login is ours, and the landing page is not.
 */
test('next is only ever a same-origin absolute path', async () => {
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'evil', '', null, '/x'.repeat(400)]) {
    assert.equal(safeNext(bad), '', `${JSON.stringify(bad)} was accepted as a next`);
  }
  assert.equal(safeNext('/j/abc'), '/j/abc');

  await withApp(async ({ base, auth, root }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    parkConsentFor(root, 'a@example.com');
    const pair = await csrfPair(base);
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html', cookie: pair.cookie },
      body: new URLSearchParams({ email: 'a@example.com', password: 'a long enough password', next: 'https://evil.example', csrf: pair.csrf }),
      redirect: 'manual',
    });
    assert.equal(login.headers.get('location'), '/', 'an off-site next must be dropped, not followed');
  });
});

test('the public pages answer without a session', async () => {
  await withApp(async ({ base }) => {
    for (const target of ['/login', '/signup', '/pricing', '/styles.css', '/api/health', '/favicon.ico']) {
      const res = await fetch(`${base}${target}`);
      assert.ok(res.status === 200 || res.status === 204, `${target} -> ${res.status}`);
    }
  });
});

// ---------------------------------------------------------------------------
// sign up, sign in, sign out
// ---------------------------------------------------------------------------

/**
 * Task 8 (2026-08-26): signup no longer creates a local account or a session.
 * It asks Supabase to create the user, parks the consent record, and sends
 * the person to `/verify` to type the code that proves the mailbox -- that is
 * where the account is actually born (task 7). This test used to assert the
 * account existed and a session cookie came back at this step; both are now
 * wrong, on purpose, and are replaced below with the contract that succeeded
 * it.
 */
test('signing up asks Supabase, parks the consent, and sends the person to verify -- no account and no session yet', async () => {
  await withApp(async ({ base, auth, supabase }) => {
    const pair = await csrfPair(base, '/signup');
    const res = await fetch(`${base}/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html', cookie: pair.cookie },
      body: new URLSearchParams({ email: 'new@example.com', password: 'ten or more chars', consent: 'yes', csrf: pair.csrf }),
      redirect: 'manual',
    });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/verify?email=new%40example.com');
    assert.deepEqual(res.headers.getSetCookie(), [], 'nobody is signed in until the mailbox is proved');
    assert.equal(auth.findAccountByEmail({ email: 'new@example.com' }), null,
      'an account must not exist before the code is confirmed');
    assert.equal(supabase.calls.length, 1, 'Supabase was never asked to create the user');
    assert.equal(supabase.calls[0].email, 'new@example.com');
  });
});

test('sign-up refuses a bad address, a short password and a missing consent', async () => {
  await withApp(async ({ base, auth }) => {
    const cases = [
      { email: 'not-an-address', password: 'ten or more chars', consent: 'yes' },
      { email: 'ok@example.com', password: 'short', consent: 'yes' },
      { email: 'ok@example.com', password: 'ten or more chars' },
    ];
    const pair = await csrfPair(base, '/signup');
    for (const body of cases) {
      const res = await fetch(`${base}/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: pair.cookie },
        body: new URLSearchParams({ ...body, csrf: pair.csrf }),
      });
      assert.equal(res.status, 400, `${JSON.stringify(body)} was accepted`);
    }
    assert.equal(auth.findAccountByEmail({ email: 'ok@example.com' }), null);
  });
});

/**
 * Task 8, replacing the test above: a taken address used to be refused here,
 * in these words, at 400 -- and that was the oracle. Supabase answers
 * `user_already_exists` for a taken address unless phone confirmation is also
 * on (it is not, on this project), so passing that refusal on would let
 * anybody test an address for an existing account. Now both branches render
 * the same page; the byte-identical version of this test, against the real
 * `createSupabaseAuth` transport, lives in `test/web-auth-code.test.js`. This
 * one keeps the local-`scripts/auth/`-shaped angle: no wording about an
 * existing account ever reaches the response, and no local account is
 * created by the taken-address attempt either.
 */
test('an address Supabase already has answers exactly like a fresh one -- no wording, no 400', async () => {
  const supabase = fakeSupabaseIdentity({ taken: new Set(['taken@example.com']) });
  await withApp(async ({ base, auth }) => {
    const pair = await csrfPair(base, '/signup');
    const res = await fetch(`${base}/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html', cookie: pair.cookie },
      body: new URLSearchParams({ email: 'taken@example.com', password: 'another long one', consent: 'yes', csrf: pair.csrf }),
      redirect: 'manual',
    });
    assert.equal(res.status, 303, 'a taken address must not be a 400 any more');
    assert.equal(res.headers.get('location'), '/verify?email=taken%40example.com');
    const body = await res.text();
    assert.ok(!body.toLowerCase().includes('already'), 'the old wording leaked back in');
    assert.equal(auth.accounts.size, 0, 'signup must not create a local account, taken address or not');
  }, { supabase });
});

/**
 * ONE MESSAGE FOR BOTH FAILURES. "No such account" and "wrong password" are
 * different facts and must be the same answer, or the login form is a free
 * account-enumeration oracle on a site that stores photographs of faces.
 *
 * RE-POINTED FOR TASK 9. `login` no longer asks the fake local `auth` at
 * all -- there is no `auth.createAccount` call here any more, on purpose, and
 * its former presence would now be misleading rather than merely unused. Both
 * requests are refused by `fakeSupabaseIdentity().signInWithPassword`, which
 * only accepts `FAKE_SUPABASE_PASSWORD`: a wrong password for a real-looking
 * address and a password for an address Supabase has never heard of collapse
 * into the identical upstream refusal, exactly the way `invalid_credentials`
 * does for both cases against the real API. The page also echoes back
 * whatever address was typed (not a leak -- it is the caller's own input),
 * so the two responses cannot be byte-identical the way the signup pair
 * above are; the message is what must match, and does.
 */
test('a wrong password and an unknown email are the same 401 and the same sentence', async () => {
  await withApp(async ({ base }) => {
    const pair = await csrfPair(base);
    const wrong = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html', cookie: pair.cookie },
      body: new URLSearchParams({ email: 'a@example.com', password: 'nope', csrf: pair.csrf }),
    });
    const unknown = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html', cookie: pair.cookie },
      body: new URLSearchParams({ email: 'nobody@example.com', password: 'nope', csrf: pair.csrf }),
    });

    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    const a = await wrong.text();
    const b = await unknown.text();
    assert.ok(a.includes(BAD_CREDENTIALS_MESSAGE));
    assert.ok(b.includes(BAD_CREDENTIALS_MESSAGE));
    assert.ok(!b.includes('no such account'));
  });
});

// ---------------------------------------------------------------------------
// the limiter
// ---------------------------------------------------------------------------

const login = (base, { email = 'a@example.com', password = 'nope', accept = 'application/json', pair = { cookie: '', csrf: '' } } = {}) =>
  fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept, cookie: pair.cookie },
    body: new URLSearchParams({ email, password, csrf: pair.csrf }),
    redirect: 'manual',
  });

const signup = (base, email, { accept = 'application/json', pair = { cookie: '', csrf: '' } } = {}) =>
  fetch(`${base}/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept, cookie: pair.cookie },
    body: new URLSearchParams({ email, password: 'a long enough password', consent: 'yes', csrf: pair.csrf }),
    redirect: 'manual',
  });

/**
 * The guessing has to stop being free. Password checks are deliberately
 * expensive, both routes are public, and a script does not get tired -- so
 * after enough attempts from one address inside one window, the only answer
 * is 429, before any account work happens. The right password is refused too:
 * the decision is made per address before credentials are looked at, which is
 * what makes the refusal say nothing about any account.
 */
test('repeated login attempts from one address are refused, right password included', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const pair = await csrfPair(base);

    for (let i = 0; i < AUTH_RATE_LIMITS.login.max; i += 1) {
      assert.equal((await login(base, { pair })).status, 401, `attempt ${i + 1} is an ordinary refusal`);
    }
    const over = await login(base, { pair });
    assert.equal(over.status, 429);
    assert.match(over.headers.get('retry-after') ?? '', /^[0-9]+$/, 'a 429 without Retry-After is a puzzle, not an answer');
    const body = await over.json();
    assert.equal(body.error.status, 429);
    assert.ok(!body.error.message.includes('a@example.com'));

    const right = await login(base, { password: 'a long enough password', pair });
    assert.equal(right.status, 429, 'the limit must hold before credentials are examined, or it can be probed around');

    // The browser form gets a page with the sentence on it, same as every other
    // refusal on these routes.
    const html = await login(base, { accept: 'text/html', pair });
    assert.equal(html.status, 429);
    assert.ok((await html.text()).includes('Too many'));
  });
});

test('the login window closes, and a genuine sign-in works again', async () => {
  let nowMs = Date.UTC(2026, 7, 25, 12, 0, 0);
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const pair = await csrfPair(base);

    for (let i = 0; i < AUTH_RATE_LIMITS.login.max; i += 1) await login(base, { pair });
    assert.equal((await login(base, { pair })).status, 429);

    nowMs += AUTH_RATE_LIMITS.login.windowMs + 1000;
    const after = await login(base, { password: 'a long enough password', pair });
    assert.equal(after.status, 200, 'a closed window must not keep refusing a genuine sign-in');
  }, { nowImpl: () => new Date(nowMs) });
});

/** A login attempt wearing a forwarded-for identity, for the proxy tests. */
const loginAs = (base, pair, xff) =>
  fetch(`${base}/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      cookie: pair.cookie,
      'x-forwarded-for': xff,
    },
    body: new URLSearchParams({ email: 'a@example.com', password: 'wrong', csrf: pair.csrf }),
    redirect: 'manual',
  });

test('behind the proxy this deployment will have, the limiter tells visitors apart', async () => {
  // Every connection behind a TLS-terminating proxy arrives on the proxy's
  // own socket, so a limiter keyed on the socket address collapses the whole
  // internet into ONE bucket: ten sign-ins a minute for everybody, and any
  // single visitor can lock out every other one. The same trust switch that
  // already governs `x-forwarded-proto` and the Supabase attribution header
  // governs this: with TIMESTAMP_TRUST_PROXY=1 the operator is asserting the
  // proxy overwrites `x-forwarded-for`, so the limiter may key on it.
  await withApp(async ({ base }) => {
    const pair = await csrfPair(base);
    for (let i = 0; i < AUTH_RATE_LIMITS.login.max; i += 1) {
      assert.equal((await loginAs(base, pair, '203.0.113.9')).status, 401, `attempt ${i + 1} is ordinary`);
    }
    assert.equal((await loginAs(base, pair, '203.0.113.9')).status, 429,
      'the exhausted visitor is refused');
    assert.equal((await loginAs(base, pair, '198.51.100.7')).status, 401,
      'a DIFFERENT visitor behind the same proxy socket must not inherit the refusal');
  }, { trustProxy: true });
});

test('without the trust switch, the forwarded header buys nobody a fresh bucket', async () => {
  // The other half, and the half that keeps this from being a bypass: with no
  // trusted proxy, `x-forwarded-for` is whatever the client typed, and typing
  // a new one per request must not hand a script its own unlimited lane.
  await withApp(async ({ base }) => {
    const pair = await csrfPair(base);
    for (let i = 0; i < AUTH_RATE_LIMITS.login.max; i += 1) {
      await loginAs(base, pair, `203.0.113.${i}`);
    }
    assert.equal((await loginAs(base, pair, '198.51.100.200')).status, 429,
      'a typed header must not open a fresh bucket when no proxy is trusted');
  });
});

/**
 * Since task 8, signup never creates a local account at all -- the account is
 * born at `/verify`, minutes or days later. What "the refusal happens before
 * the handler runs" means now is that Supabase is never even ASKED past the
 * bound, which is why the assertion moved from `auth.accounts.size` (always
 * zero here) to the fake Supabase's own call count.
 */
test('signup attempts from one address are bounded, and Supabase is never asked past the bound', async () => {
  await withApp(async ({ base, auth, supabase }) => {
    const pair = await csrfPair(base, '/signup');
    for (let i = 0; i < AUTH_RATE_LIMITS.signup.max; i += 1) {
      assert.equal((await signup(base, `fresh-${i}@example.com`, { pair })).status, 202, `signup ${i + 1} is ordinary`);
    }
    const over = await signup(base, 'one-too-many@example.com', { pair });
    assert.equal(over.status, 429);
    assert.match(over.headers.get('retry-after') ?? '', /^[0-9]+$/);
    assert.equal(supabase.calls.length, AUTH_RATE_LIMITS.signup.max, 'Supabase was asked past the refusal');
    assert.equal(auth.accounts.size, 0, 'signup must never create a local account directly');
  });
});

// ---------------------------------------------------------------------------
// signing in is something only this site's own form can do
// ---------------------------------------------------------------------------

/** The sign-in form as a browser would receive it: the anti-forgery cookie from
 *  the response and the matching hidden field out of the HTML. */
async function loginForm(base, path = '/login') {
  const res = await fetch(`${base}${path}`, { headers: { accept: 'text/html' } });
  assert.equal(res.status, 200);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const match = (await res.text()).match(/name="csrf" value="([^"]+)"/);
  assert.ok(match, `the ${path} form carries no csrf field`);
  return { cookie, csrf: match[1] };
}

/**
 * `SameSite=Lax` stops a foreign page acting AS somebody's session; it does
 * nothing to stop a foreign page CREATING one. A page that auto-submits a
 * login form with the attacker's own credentials signs the victim in as the
 * attacker, and the next photograph they upload lands on the attacker's
 * shelf. So establishing a session takes proof the post came from this
 * site's own form: a signed value that arrives twice, once as a cookie only
 * this origin can set and once as a field only this origin's page carries.
 */
test('a login posted without the form is refused, and no session comes back', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });

    // Right credentials, no form: exactly what a cross-site auto-submitting
    // form delivers, since a foreign page can neither read our form nor set
    // our cookie.
    const bare = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'a@example.com', password: 'a long enough password' }),
      redirect: 'manual',
    });
    assert.equal(bare.status, 403);
    assert.deepEqual(bare.headers.getSetCookie().filter((c) => c.startsWith(SESSION_COOKIE)), [],
      'a session cookie was minted for a post that proved nothing');

    // A harvested field without its cookie: an attacker can fetch our form
    // themselves and copy the value out, but they cannot plant the matching
    // cookie in the victim's browser.
    const { csrf } = await loginForm(base);
    const fieldOnly = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'a@example.com', password: 'a long enough password', csrf }),
      redirect: 'manual',
    });
    assert.equal(fieldOnly.status, 403);
  });
});

test('the form flow signs in: cookie plus matching field plus credentials', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const { cookie, csrf } = await loginForm(base);
    const res = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ email: 'a@example.com', password: 'a long enough password', csrf }),
      redirect: 'manual',
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.getSetCookie().some((c) => c.startsWith(SESSION_COOKIE)), 'no session came back from the genuine flow');
  });
});

/**
 * `login` relies on `sb.revoke` being best-effort, and the real
 * `createSupabaseAuth` already swallows its own errors -- but that is a
 * contract asserted only in prose, on a module this task could not modify.
 * A `sb` whose `revoke` throws must not turn an already-completed sign-in
 * into a failure: the session is live and the cookie is already computed by
 * the time revoke is even attempted.
 */
test('a revoke that throws still leaves the person signed in, cookie and all', async () => {
  await withApp(async ({ base, auth, supabase }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    supabase.revoke = async () => { throw new Error('supabase is unreachable'); };
    const { cookie, csrf } = await loginForm(base);
    const res = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ email: 'a@example.com', password: 'a long enough password', csrf }),
      redirect: 'manual',
    });
    assert.equal(res.status, 200, 'a throwing revoke turned a completed sign-in into a failure');
    assert.ok(res.headers.getSetCookie().some((c) => c.startsWith(SESSION_COOKIE)), 'a throwing revoke ate the cookie too');
  });
});

/** The cheap second layer: a browser names where a post came from, and a post
 *  that names somewhere else is refused before anything else is looked at. */
test('a login or signup posted from another origin is refused whatever it carries', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const { cookie, csrf } = await loginForm(base);
    for (const path of ['/login', '/signup']) {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, origin: 'https://third-party.example' },
        body: new URLSearchParams({ email: 'a@example.com', password: 'a long enough password', consent: 'yes', csrf }),
        redirect: 'manual',
      });
      assert.equal(res.status, 403, `${path} accepted a post that said it came from another site`);
      assert.deepEqual(res.headers.getSetCookie().filter((c) => c.startsWith(SESSION_COOKIE)), []);
    }
  });
});

test('a signup posted without the form is refused and creates nothing', async () => {
  await withApp(async ({ base, auth }) => {
    const res = await fetch(`${base}/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'new@example.com', password: 'a long enough password', consent: 'yes' }),
      redirect: 'manual',
    });
    assert.equal(res.status, 403);
    assert.equal(auth.accounts.size, 0, 'an account was created for a post that proved nothing');
  });
});

/**
 * The other half of the same defence, and it is one line of HTML: the nav says
 * WHOSE account this is. A takeover that signs the victim into somebody else's
 * account is silent precisely when no page ever names the account -- with the
 * email in the chrome, it is visible on every page instead.
 */
test('every signed-in page names the account it belongs to', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password', credits: 500 });
    const cookie = await signIn(auth, 'a@example.com', 'a long enough password');
    for (const path of ['/', '/pricing']) {
      const html = await (await fetch(`${base}${path}`, { headers: { cookie, accept: 'text/html' } })).text();
      assert.ok(html.includes('a@example.com'), `${path} does not say whose account is signed in`);
    }
    // And never to a stranger.
    const anon = await (await fetch(`${base}/`, { headers: { accept: 'text/html' } })).text();
    assert.ok(!anon.includes('a@example.com'));
  });
});

test('the session cookie is HttpOnly, SameSite=Lax and not Secure over plain HTTP', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const pair = await csrfPair(base);
    const res = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: pair.cookie },
      body: new URLSearchParams({ email: 'a@example.com', password: 'a long enough password', csrf: pair.csrf }),
    });
    const [cookie] = res.headers.getSetCookie();
    assert.ok(cookie.startsWith(`${SESSION_COOKIE}=`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    // Secure on a plain-HTTP response means the browser silently discards it and
    // local development stops working with no error anywhere.
    assert.ok(!/Secure/.test(cookie), 'Secure must only be set when the request arrived over TLS');
  });
});

/**
 * A FOREIGN PAGE CANNOT SIGN SOMEBODY OUT.
 *
 * `/logout` was the one state-changing route with neither the same-origin check
 * nor the anti-forgery pair. Every sibling form-backed POST opens with both.
 *
 * It is NOT a session-integrity break, and saying so is the point: `SameSite=Lax`
 * withholds the cookie on a cross-site POST, so `endSession` finds nothing and
 * no server-side record dies. But the 303 still carries the `Max-Age=0` clearing
 * cookie, and a browser applies that on a top-level navigation to this origin --
 * so the victim is signed out at a moment the attacker picks. Mid-upload on a
 * 12 MB multipart POST, or as a ready-made phishing premise, which is worse here
 * because `/login` already renders an unauthenticated notice a forged link can
 * trigger -- the comment beside that notice names the premise explicitly.
 *
 * `sameOriginPost` rather than the full CSRF pair, deliberately: the nav form
 * has no token to give it, threading one into every page render is a much larger
 * change, and `Sec-Fetch-Site` is sent by every browser that can mount this
 * attack. The token buys nothing extra against a request that must come from a
 * browser to work at all.
 */
test('a cross-site POST cannot sign anybody out', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const cookie = await signIn(auth, 'a@example.com', 'a long enough password');
    assert.equal(auth.sessions.size, 1);

    for (const headers of [
      { cookie, 'sec-fetch-site': 'cross-site' },
      { cookie, 'sec-fetch-site': 'same-site' },
      { cookie, origin: 'https://evil.example' },
    ]) {
      const res = await fetch(`${base}/logout`, { method: 'POST', headers, redirect: 'manual' });
      assert.equal(res.status, 403, `a POST with ${JSON.stringify(headers)} was accepted`);
      // THE CLEARING COOKIE IS THE PAYLOAD. A 403 that still sets it would
      // sign the victim out anyway, which is the whole exploit.
      const setCookie = res.headers.get('set-cookie') ?? '';
      assert.ok(!/timestamp_session=;|timestamp_session=\s*;/.test(setCookie),
        `the refusal still cleared the session cookie: ${setCookie}`);
    }

    assert.equal(auth.sessions.size, 1, 'a cross-site post destroyed the session record');
  });
});

/** The server-side record is what makes logout actually log out. A JWT cannot be
 *  revoked, and this app can hand somebody else's face to whoever holds one. */
test('signing out destroys the record, so the old cookie stops working', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const cookie = await signIn(auth, 'a@example.com', 'a long enough password');
    assert.equal((await fetch(`${base}/`, { headers: { cookie } })).status, 200);
    assert.equal(auth.sessions.size, 1);

    const out = await fetch(`${base}/logout`, { method: 'POST', headers: { cookie } });
    assert.equal(out.status, 200);
    assert.equal(auth.sessions.size, 0, 'the server-side session record survived a logout');

    // PROBED BY WHAT IS RENDERED, NOT BY A REDIRECT. Since 2026-08-21 the root
    // path answers a stranger with the landing page rather than a 303, so
    // "is this cookie still a session?" is no longer a status code -- it is
    // whether the upload form came back. That is the more direct question
    // anyway: the redirect was only ever a proxy for it.
    const after = await fetch(`${base}/`, { headers: { cookie, accept: 'text/html' }, redirect: 'manual' });
    assert.equal(after.status, 200);
    assert.ok(!(await after.text()).includes('form="tape"'),
      'the cookie still worked after signing out');
  });
});

test('signing out lands on the landing page, not on a sign-in form', async () => {
  // REPORTED BY THE OWNER, 2026-08-31: signing out dropped him on /login.
  //
  // It is a small thing that says the wrong thing. Answering "I am leaving"
  // with a password field reads as "sign back in", and for the one visitor who
  // has just deliberately ended a session that is the least useful page in the
  // product. /login also renders an unauthenticated notice, so somebody who
  // signed out on purpose could be met by what looks like a failure.
  //
  // The landing is the honest destination: it is where a signed-out person
  // belongs, it is the only page that sells, and its masthead already carries a
  // Sign in link for anybody who did want to swap accounts.
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const cookie = await signIn(auth, 'a@example.com', 'a long enough password');

    const out = await fetch(`${base}/logout`, {
      method: 'POST',
      headers: { cookie, accept: 'text/html' },
      redirect: 'manual',
    });
    assert.equal(out.status, 303);
    assert.equal(out.headers.get('location'), '/',
      'signing out still sends the customer to a sign-in form');
    // The clearing cookie is the point of the response and must survive the
    // change of destination -- a redirect that forgets it signs nobody out.
    assert.match(out.headers.get('set-cookie') ?? '', /timestamp_session=/,
      'the logout stopped clearing the session cookie');
  });
});

test('a forged or tampered cookie is rejected before any filesystem lookup', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const real = await signIn(auth, 'a@example.com', 'a long enough password');
    const forged = [
      `${SESSION_COOKIE}=sess-1`,
      `${SESSION_COOKIE}=sess-1.deadbeefdeadbeef`,
      `${SESSION_COOKIE}=${encodeURIComponent('../../etc/passwd.aaaa')}`,
      real.replace(/.$/, 'z'),
    ];
    for (const cookie of forged) {
      const res = await fetch(`${base}/api/health`, { headers: { cookie } });
      assert.equal(res.status, 200, 'a bad cookie must not break an unrelated route');
      const gated = await fetch(`${base}/`, { headers: { cookie, accept: 'text/html' }, redirect: 'manual' });
      assert.equal(gated.status, 200);
      assert.ok(!(await gated.text()).includes('form="tape"'),
        `${cookie} was accepted as a session`);
    }
  });
});

// ---------------------------------------------------------------------------
// ownership -- the one that matters
// ---------------------------------------------------------------------------

test('account B gets a 404 on account A\'s job, on every job route', async () => {
  await withApp(async ({ base, root, app, auth }) => {
    const a = auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    auth.createAccount({ email: 'b@example.com', password: 'a different password' });
    const cookieB = await signIn(auth, 'b@example.com', 'a different password');
    const cookieA = await signIn(auth, 'a@example.com', 'a long enough password');

    const job = seedJob(app, root, a, { status: 'done' });
    fs.writeFileSync(jobPaths(root, job.jobId).video, Buffer.alloc(64, 3));
    fs.writeFileSync(jobPaths(root, job.jobId).poster, Buffer.alloc(64, 4));
    fs.mkdirSync(jobPaths(root, job.jobId).stills, { recursive: true });
    fs.writeFileSync(`${jobPaths(root, job.jobId).stills}/still-01.png`, Buffer.from('still 1'));

    const targets = [
      ['GET', `/j/${job.jobId}`],
      ['GET', `/j/${job.jobId}/select`],
      ['GET', `/j/${job.jobId}/result`],
      ['GET', `/api/jobs/${job.jobId}`],
      ['GET', `/api/jobs/${job.jobId}/stills`],
      ['GET', `/api/jobs/${job.jobId}/stills/1`],
      ['GET', `/api/jobs/${job.jobId}/video`],
      ['GET', `/api/jobs/${job.jobId}/poster`],
      ['POST', `/api/jobs/${job.jobId}/select`],
      ['DELETE', `/api/jobs/${job.jobId}`],
    ];

    for (const [method, target] of targets) {
      const res = await fetch(`${base}${target}`, {
        method,
        headers: { cookie: cookieB, 'content-type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ stillIndex: 1 }) : undefined,
        redirect: 'manual',
      });
      // 404, NOT 403. A 403 confirms the job exists, which is the fact an
      // enumerator is fishing for.
      assert.equal(res.status, 404, `${method} ${target} answered ${res.status} to the wrong account`);
      const text = await res.text();
      assert.ok(!text.includes('a beach'), `${method} ${target} leaked the other account's input`);
    }

    // And the owner still gets everything.
    assert.equal((await fetch(`${base}/api/jobs/${job.jobId}`, { headers: { cookie: cookieA } })).status, 200);
    assert.equal((await fetch(`${base}/api/jobs/${job.jobId}/video`, { headers: { cookie: cookieA } })).status, 200);

    // The job is not on B's shelf either.
    const shelf = await (await fetch(`${base}/`, { headers: { cookie: cookieB } })).text();
    assert.ok(shelf.includes('The shelf is empty'), 'the other account\'s job appeared on this shelf');
  });
});

test('a job with no owner is nobody\'s job', async () => {
  await withApp(async ({ base, root, app, auth }) => {
    const a = auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const cookie = await signIn(auth, 'a@example.com', 'a long enough password');
    const job = seedJob(app, root, a);
    // Take the ownership entry away: a manifest with no index entry must not be
    // readable by the account that used to own it, let alone by anybody else.
    app.sessions.releaseJob({ accountId: a.accountId, jobId: job.jobId });
    assert.equal((await fetch(`${base}/api/jobs/${job.jobId}`, { headers: { cookie } })).status, 404);
  });
});

test('uploading claims the job for the account that uploaded it', async () => {
  await withApp(async ({ base, app, auth }) => {
    const a = auth.createAccount({ email: 'a@example.com', password: 'a long enough password', credits: 500 });
    const cookie = await signIn(auth, 'a@example.com', 'a long enough password');
    const res = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, cookie },
      body: multipart(uploadParts()),
    });
    assert.equal(res.status, 201);
    const { jobId } = await res.json();
    assert.ok(app.sessions.ownsJob({ accountId: a.accountId, jobId }));
    assert.deepEqual(app.sessions.jobIdsFor(a.accountId), [jobId]);
  });
});

// ---------------------------------------------------------------------------
// quota
// ---------------------------------------------------------------------------

/**
 * SPENT AT ENQUEUE, NOT AT COMPLETION. Charging when a render finishes lets
 * somebody start twelve jobs in parallel, each of which checks a balance none of
 * them has spent yet.
 */
test('credits are spent when the job is enqueued, and the next one is refused', async () => {
  await withApp(async ({ base, root, auth, queue }) => {
    // The free plan grants exactly one 480p tape.
    const a = auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const cookie = await signIn(auth, 'a@example.com', 'a long enough password');

    assert.equal(auth.balanceOf(a).credits, 51);
    const first = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, cookie },
      body: multipart(uploadParts('one')),
    });
    assert.equal(first.status, 201);
    const { jobId, credits } = await first.json();
    assert.equal(credits, 51);

    // Spent at enqueue: the job is still `queued` and the credits are gone.
    assert.equal(auth.balanceOf(a).credits, 0);
    assert.deepEqual(a.ledger.map((e) => e.jobId), [jobId]);
    assert.deepEqual(queue.calls.enqueued, [jobId]);

    const second = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, cookie },
      body: multipart(uploadParts('two')),
    });
    assert.equal(second.status, 402);
    assert.equal((await second.json()).error.status, 402);

    // Nothing half-made: one job directory, one queue entry, one tape paid for.
    assert.equal(fs.readdirSync(path.join(root, 'out', 'jobs')).length, 1);
    assert.deepEqual(queue.calls.enqueued, [jobId]);
  });
});

/**
 * The debit lands at enqueue, so a cancel BEFORE any worker claimed the job is
 * a purchase of nothing: the queue says no lease was ever held, the manifest's
 * steps say no provider was ever asked, and the person is entitled to their
 * credits back. Wrong photo, immediate cancel, full price was the shape of the
 * loss.
 */
test('cancelling a job the queue never claimed gives the credits back', async () => {
  await withApp(async ({ base, auth }) => {
    const a = auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const cookie = await signIn(auth, 'a@example.com', 'a long enough password');
    assert.equal(auth.balanceOf(a).credits, 51);

    const made = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, cookie },
      body: multipart(uploadParts()),
    });
    assert.equal(made.status, 201);
    const { jobId } = await made.json();
    assert.equal(auth.balanceOf(a).credits, 0, 'the tape was paid for at enqueue');

    const cancelled = await fetch(`${base}/api/jobs/${jobId}`, { method: 'DELETE', headers: { cookie } });
    assert.equal(cancelled.status, 200);
    assert.equal(auth.balanceOf(a).credits, 51, 'a cancel before any render kept the money');
    // As a new positive line, never an erased debit -- the ledger records both
    // the charge and the return.
    const rows = a.ledger.filter((e) => e.jobId === jobId);
    assert.equal(rows.length, 2, 'the refund is a ledger line of its own');
  });
});

test('a balance that covers 480p but not 720p refuses only the 720p tape', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password', credits: 100 });
    const cookie = await signIn(auth, 'a@example.com', 'a long enough password');

    const dear = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, cookie },
      body: multipart(uploadParts('dear', '720p')),
    });
    assert.equal(dear.status, 402);
    const message = (await dear.json()).error.message;
    assert.match(message, /720p/, 'the refusal names the size that was asked for');
    assert.match(message, /152 CR/);
    assert.match(message, /100 CR/, 'and the balance, so the arithmetic is visible');

    const cheap = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, cookie },
      body: multipart(uploadParts('cheap', '480p')),
    });
    assert.equal(cheap.status, 201);
  });
});

test('a debit refusal at enqueue leaves no directory, no claim and no charge', async () => {
  // `debitCredits` refuses after the manifest has been written and the job
  // claimed. All three have to come back off disk.
  const auth = fakeAuth();
  await withApp(async ({ base, root, app }) => {
    const a = auth.createAccount({ email: 'a@example.com', password: 'a long enough password', credits: 500 });
    const cookie = await signIn(auth, 'a@example.com', 'a long enough password');

    // Report a balance, then refuse to spend it -- the exact race the
    // enqueue-time debit exists to close.
    auth.debitCredits = () => { const e = new Error('gone'); e.code = 'INSUFFICIENT_CREDITS'; throw e; };

    const res = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, cookie },
      body: multipart(uploadParts()),
    });
    assert.equal(res.status, 402);

    let dirs = [];
    try { dirs = fs.readdirSync(path.join(root, 'out', 'jobs')); } catch { dirs = []; }
    assert.deepEqual(dirs, [], 'a photograph was left on disk for a job that was never enqueued');
    assert.deepEqual(app.sessions.jobIdsFor(a.accountId), [], 'the ownership entry was not unwound');
    assert.equal(a.credits, 500, 'nothing was charged');
  }, { auth });
});

/**
 * The debit lands and then the enqueue throws. The job never reached the queue,
 * so no provider was ever called, so the refund is legitimate -- and it must
 * happen, or the person is out of credits for a render that does not exist.
 */
test('a failure after the debit refunds it, because nothing was ever rendered', async () => {
  const auth = fakeAuth();
  const queue = {
    calls: { enqueued: [] },
    enqueue() { throw new Error('the queue directory is gone'); },
    peek() { return []; },
    stats() { return { pending: 0, claimed: 0, done: 0, failed: 0 }; },
  };
  await withApp(async ({ base, root, app }) => {
    const a = auth.createAccount({ email: 'a@example.com', password: 'a long enough password', credits: 500 });
    const cookie = await signIn(auth, 'a@example.com', 'a long enough password');

    const res = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, cookie },
      body: multipart(uploadParts()),
    });
    assert.equal(res.status, 500);
    assert.equal(a.credits, 500, 'the debit was not refunded');

    let dirs = [];
    try { dirs = fs.readdirSync(path.join(root, 'out', 'jobs')); } catch { dirs = []; }
    assert.deepEqual(dirs, []);
    assert.deepEqual(app.sessions.jobIdsFor(a.accountId), []);
  }, { auth, queue });
});

// ---------------------------------------------------------------------------
// pricing -- and the absence of a payment form
// ---------------------------------------------------------------------------

test('the pricing page lists the plans in credits and marks the current one', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password', plan: 'shelf' });
    const cookie = await signIn(auth, 'a@example.com', 'a long enough password');

    const anon = await fetch(`${base}/pricing`);
    assert.equal(anon.status, 200);
    const anonHtml = await anon.text();
    // THE GRANT IS A SENTENCE, NOT A CARD (2026-09-04). A rung with no price
    // and no button sat beside two purchases and read as a third one the
    // visitor had somehow failed to make. It opens the page in words now and
    // the paid plans keep their cards, so 'Free' is no longer a label here.
    for (const label of ['Shelf', 'Archive']) assert.ok(anonHtml.includes(label), `${label} is missing`);
    assert.match(anonHtml, /Every account starts with 51 credits/, 'the grant is stated as a sentence');
    assert.ok(anonHtml.includes('$10') && anonHtml.includes('$12'));
    assert.ok(!anonHtml.includes('Your plan'), 'nothing is marked for a signed-out visitor');

    // Credits are the honest unit -- "N tapes a month" stopped being true the
    // moment a tape had two prices -- but the translation is shown as well,
    // because "153 credits" on its own tells a first-time reader nothing.
    //
    // "a month" IS GONE AND MUST STAY GONE. Nothing on this page recurs: the
    // rungs are one-off bundles bought through Stripe in `mode: payment`, and
    // there is no code anywhere in scripts/billing/ that could charge a second
    // time. A page that says "a month" next to a Buy button is describing a
    // subscription this application cannot sell.
    assert.ok(anonHtml.includes('153 credits'));
    assert.ok(!/credits a month/.test(anonHtml), 'nothing on this page may claim to recur');
    assert.ok(!/per month/.test(anonHtml), 'nothing on this page may claim to recur');
    assert.ok(anonHtml.includes('3 tapes at 480p'), 'shelf is three 480p tapes');
    assert.ok(anonHtml.includes('1 tape at 720p'), 'and one 720p tape, singular');
    assert.ok(!anonHtml.includes('1 tapes'), 'and nothing reads like a placeholder');
    // A plan that cannot fund a 720p tape says so in words rather than "0 tapes".
    assert.ok(anonHtml.includes('not enough for a 720p tape'));
    assert.ok(anonHtml.includes('480p — ~51 CR'));
    assert.ok(anonHtml.includes('720p — ~152 CR'));
    assert.ok(!anonHtml.includes('1080p'), 'a deferred size is not priced on the plans page');

    const mine = await (await fetch(`${base}/pricing`, { headers: { cookie } })).text();
    assert.ok(mine.includes('Your plan'));
    assert.ok(/plan--current[\s\S]{0,200}Shelf/.test(mine), 'the Shelf plan is the one marked');
  });
});

/**
 * NO PAYMENT FORM ANYWHERE. Not a card field, not a CVV field, not a mockup. A
 * "mockup" card input is the same risk as a real one: it is a text box on a
 * public page asking for a card number, and whether the bytes are stored is a
 * detail the person typing them cannot see.
 */
test('no page in this app contains anything that collects payment details', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const cookie = await signIn(auth, 'a@example.com', 'a long enough password');

    // Asserted against FORM CONTROLS, not against prose. The pricing page says
    // out loud that this application never sees a card number, and a test that
    // banned the words would forbid saying so. What must not exist is somewhere
    // to type one.
    const banned = /\b(cc-(number|exp|csc|name)|cvv|cvc|card ?number|cardnumber|iban|sort ?code|expiry|postal-code|billing)\b/i;
    const controls = /<(input|select|textarea)\b[^>]*>/gi;

    for (const target of ['/', '/pricing', '/login', '/signup']) {
      const html = await (await fetch(`${base}${target}`, { headers: { cookie, accept: 'text/html' } })).text();
      for (const tag of html.match(controls) ?? []) {
        assert.ok(!banned.test(tag), `${target} has a control that collects payment details: ${tag}`);
      }
      // A CHECKOUT FORM IS ALLOWED AND ITS CONTENTS ARE NOT.
      //
      // This assertion used to ban any form whose action mentioned checkout,
      // billing or a card, and it was a proxy for "there is no way to pay from
      // here" written while there was no way to pay from anywhere. Since
      // 2026-08-25 there is one, by design: /pricing posts a pack id to
      // /api/billing/checkout and the server answers 303 to Stripe's own
      // domain, where the card is entered. Banning the form would ban the
      // approved design.
      //
      // What replaces it is STRICTLY STRONGER than what it replaces. Rather
      // than trusting a url not to sound like payment, this reads the form
      // that exists and asserts it carries exactly one field, that the field
      // is a pack id, and that the id is one the server sells. A future edit
      // that adds an amount, a credit count or a price to that form fails
      // here -- which the old regex, matching only on the action attribute,
      // would have passed without a word.
      for (const form of html.match(/<form\b[\s\S]*?<\/form>/gi) ?? []) {
        if (!/action="[^"]*(checkout|pay|billing|card)/i.test(form)) continue;
        assert.match(form, /action="\/api\/billing\/checkout"/,
          `${target} posts at a payment-ish path that is not the checkout route: ${form}`);
        // THE RULE IS "NOTHING HERE CAN CHANGE WHAT IS CHARGED", NOT "EXACTLY
        // ONE FIELD" (2026-08-30). This asserted a field COUNT of one, which
        // was a proxy for the real property and stopped being one the day the
        // form gained the immediate-supply acknowledgement -- a checkbox that
        // carries no amount, no credit count and no price, and gates the
        // purchase on this server rather than telling Stripe anything.
        //
        // Stated directly, the guard is STRONGER than the count it replaces: an
        // allow-list of field names, so a future edit adding `amount`,
        // `credits`, `price` or anything else unnamed fails here exactly as it
        // did before -- and a second hidden field called `pack2` would have
        // sailed through a count of one only if it replaced something.
        const fields = form.match(/<input\b[^>]*>/gi) ?? [];
        const named = fields.map((f) => (/name="([^"]*)"/.exec(f) ?? [])[1]);
        assert.deepEqual(named.slice().sort(), ['pack', 'withdrawal'],
          `the checkout form on ${target} carries fields that are not the pack id and the acknowledgement: ${named.join(',')}`);

        const pack = fields[named.indexOf('pack')];
        assert.match(pack, /type="hidden"/, 'the pack id must not be typeable');
        assert.match(pack, /value="[a-z0-9-]+"/i, 'the pack id is not a plain id');

        const withdrawal = fields[named.indexOf('withdrawal')];
        assert.match(withdrawal, /type="checkbox"/, 'the acknowledgement must be a real checkbox');
        assert.match(withdrawal, /\brequired\b/, 'the acknowledgement must be required');

        // The property the count was standing in for, asserted on its own terms.
        for (const field of fields) {
          assert.doesNotMatch(field, /name="(amount|credits|price|priceUSD|currency|quantity)"/i,
            `the checkout form on ${target} carries something that could change what is charged: ${field}`);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// degrading when scripts/auth/ is not there
// ---------------------------------------------------------------------------

test('the 500 log line names the path and never the query string', async () => {
  // `/verify?email=` carries an address and `/auth/callback?code=&state=` a
  // live sign-in code. Both are query strings, and the one handler that logs
  // a request in full is the one for a failure nobody planned -- so the log
  // it writes must hold the pathname and nothing after the question mark.
  const auth = fakeAuth();
  const lines = [];
  await withApp(async ({ base }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password', credits: 500 });
    const cookie = await signIn(auth, 'a@example.com', 'a long enough password');
    // A failure nobody planned: the ledger dies mid-request, inside a handler.
    auth.ledgerFor = () => { throw new Error('EIO: i/o error, read /var/lib/somewhere/ledger.json'); };

    const res = await fetch(`${base}/api/account/export?email=secret%40example.com&code=123456`,
      { headers: { cookie } });
    assert.equal(res.status, 500);
    await res.text();
  }, { auth, logImpl: (line) => lines.push(String(line)) });

  const witness = lines.filter((l) => /-> 500/.test(l));
  assert.equal(witness.length, 1, `one 500 line: ${JSON.stringify(lines)}`);
  assert.match(witness[0], /GET \/api\/account\/export /, 'the path is there');
  assert.doesNotMatch(witness[0], /secret|example\.com|123456|\?/, 'the query string is not');
});

test('a missing scripts/auth/ is a 503 with a sentence, and the assets still serve', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-auth-'));
  const sessions = createSessions({
    root,
    loadAuthImpl: async () => { throw Object.assign(new Error('Cannot find module'), { code: 'ERR_MODULE_NOT_FOUND' }); },
  });
  const app = createServer({ root, cfg: CFG, queue: fakeQueue(), port: 0, sessions, logImpl: () => {} });
  const port = await app.listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    // THE LANDING PAGE IS PUBLIC PROSE AND SURVIVES A BROKEN ACCOUNTS MODULE,
    // for exactly the reason the plans page already does: 503-ing the page that
    // explains what this product is, because an unrelated module will not load,
    // loses every visitor who has never heard of it in order to report a fault
    // they cannot act on. It is built from the preset catalog alone, so there is
    // nothing on it that needs `scripts/auth/` to render.
    //
    // Before 2026-08-21 this asserted 503, because `/` was a redirect to the
    // sign-in form and a sign-in form that cannot work should say so. That is
    // still true, and it is still asserted below for `/login` itself.
    const home = await fetch(`${base}/`, { headers: { accept: 'text/html' } });
    assert.equal(home.status, 200, 'the landing page must survive a missing accounts module');
    const homeHtml = await home.text();
    assert.ok(homeHtml.includes('Make a tape'), 'it is the landing page');
    assert.ok(!homeHtml.includes('form="tape"'), 'and not the app');

    const api = await fetch(`${base}/api/jobs/${SHAPED_ID}`);
    assert.equal(api.status, 503);
    assert.equal((await api.json()).error.code, 'AUTH_UNAVAILABLE');

    // A sign-in form that cannot possibly work says so BEFORE somebody types a
    // password into it.
    assert.equal((await fetch(`${base}/login`, { headers: { accept: 'text/html' } })).status, 503);

    // The parts that do not need an account keep working.
    assert.equal((await fetch(`${base}/styles.css`)).status, 200);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    // NOT 503 is the assertion, and the status itself is deliberately not
    // pinned. What this line exists to prove is that the place-photo route is
    // not gated behind the accounts module -- it asserted 404 only because
    // `assets/places/` happened to be empty, and it went red on 2026-08-23 when
    // the eight photographs landed and it started answering 200. A 200 proves
    // the point better than a 404 did; a 503 would be the actual regression.
    const placeRes = await fetch(`${base}/places/ostsee-strand.jpg`);
    assert.notEqual(placeRes.status, 503, 'the place route must not need the accounts module');
    assert.ok([200, 404].includes(placeRes.status), `unexpected ${placeRes.status} from the place route`);

    // And the plans are public prose: 503-ing a marketing page because an
    // unrelated module will not load is a worse answer than showing it.
    const plans = await fetch(`${base}/pricing`, { headers: { accept: 'text/html' } });
    assert.equal(plans.status, 200);
    assert.ok((await plans.text()).includes('What a tape costs'));
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the auth surface this layer depends on is the one A documents', () => {
  assert.deepEqual(missingAuthFunctions(fakeAuth()), [], 'the fake is missing a documented function');
  assert.ok(missingAuthFunctions(null).includes('createSession'));
  assert.ok(missingAuthFunctions({ createAccount: () => {} }).includes('verifyPassword'));
});

// ---------------------------------------------------------------------------
// the middleware, on its own
// ---------------------------------------------------------------------------

test('cookies parse tolerantly and serialize strictly', () => {
  assert.deepEqual({ ...parseCookies('a=1; b=two') }, { a: '1', b: 'two' });
  assert.deepEqual({ ...parseCookies('') }, {});
  assert.deepEqual({ ...parseCookies(undefined) }, {});
  // A cookie somebody else set, with an undecodable value, must not throw --
  // that would log everybody out because of an unrelated cookie.
  assert.equal(parseCookies('junk=%E0%A4%A; ts_session=v').ts_session, 'v');

  // FIRST VALUE WINS, and this is the parser that is actually on the request
  // path -- `currentAccount` and every CSRF/OAuth read below call THIS one, not
  // the careful duplicate in `session.mjs`. A browser sends the most specific
  // cookie first, so an attacker who can set a cookie on a wider path or a
  // parent domain gets to append a second value with the same name. Under
  // last-wins theirs is the one that is read, which is a session-fixation
  // primitive. `session.mjs:606` has always had this guard and a comment
  // explaining it; the copy on the request path did not, which is the whole
  // finding -- the careful implementation existing is not the same as it being
  // the one that runs.
  assert.equal(parseCookies('ts_session=real; ts_session=forged').ts_session, 'real');
  assert.equal(parseCookies('a=first; b=x; a=second').a, 'first');

  const set = serializeCookie('n', 'v alue', { maxAge: 60, secure: true });
  assert.match(set, /^n=v%20alue;/);
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Lax/);
  assert.match(set, /Secure/);
  assert.match(set, /Max-Age=60/);
});

/**
 * CHANGED DELIBERATELY, 2026-08-26, with Paul's sign-off. The old test pinned
 * "a forwarded header is believed exactly" -- but a header is whatever the
 * client typed unless something trusted rewrote it, so believing it by
 * default let any request turn `Secure` on or off by asking. The decision now
 * belongs to whoever configured the deployment: `trustProxy` is opt-in
 * (TIMESTAMP_TRUST_PROXY=1 for a deployment behind a TLS-terminating proxy),
 * and only then is the header believed, exactly as before. Same rule, same
 * words, as the twin in scripts/auth/session.mjs.
 */
test('Secure follows the actual protocol; a forwarded header is believed only when the deployment says so', () => {
  assert.equal(isSecureRequest({ socket: { encrypted: true }, headers: {} }), true);
  // Default: the header is client-typed bytes and is never believed.
  assert.equal(isSecureRequest({ socket: {}, headers: { 'x-forwarded-proto': 'https' } }), false);
  // Opted in, it is believed for the literal value https and nothing else.
  assert.equal(isSecureRequest({ socket: {}, headers: { 'x-forwarded-proto': 'https' } }, { trustProxy: true }), true);
  assert.equal(isSecureRequest({ socket: {}, headers: { 'x-forwarded-proto': 'https, http' } }, { trustProxy: true }), true);
  assert.equal(isSecureRequest({ socket: {}, headers: { 'x-forwarded-proto': 'http' } }, { trustProxy: true }), false);
  assert.equal(isSecureRequest({ socket: {}, headers: { 'x-forwarded-proto': 'nothttps' } }, { trustProxy: true }), false);
  assert.equal(isSecureRequest({ socket: {}, headers: {} }, { trustProxy: true }), false);
});

/** The same rule at the HTTP boundary, where it actually decides a cookie. */
test('a client-typed forwarded header cannot mark the session cookie Secure unless the deployment opted in', async () => {
  const attempt = async (base) => {
    const form = await fetch(`${base}/login`, { headers: { accept: 'text/html', 'x-forwarded-proto': 'https' } });
    const formCookie = form.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const csrf = (await form.text()).match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
    return fetch(`${base}/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: formCookie,
        'x-forwarded-proto': 'https',
      },
      body: new URLSearchParams({ email: 'a@example.com', password: 'a long enough password', csrf }),
      redirect: 'manual',
    });
  };

  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const res = await attempt(base);
    assert.equal(res.status, 200);
    const [cookie] = res.headers.getSetCookie();
    assert.ok(!/Secure/.test(cookie),
      'a header any client can type turned Secure on, which silently breaks login for a plain-HTTP deployment');
  });

  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const res = await attempt(base);
    assert.equal(res.status, 200);
    const [cookie] = res.headers.getSetCookie();
    assert.match(cookie, /Secure/, 'behind a proxy the operator vouched for, the header is believed');
  }, { trustProxy: true });
});

test('the ownership index refuses ids that are not path-safe', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-own-'));
  try {
    const s = createSessions({ root, auth: fakeAuth() });
    assert.throws(() => s.claimJob({ accountId: '../escape', jobId: SHAPED_ID }), /path-safe/);
    assert.throws(() => s.claimJob({ accountId: 'acct-1', jobId: '../../etc/passwd' }), /not a job id/);
    assert.equal(s.ownsJob({ accountId: '../escape', jobId: SHAPED_ID }), false);
    assert.equal(s.ownsJob({ accountId: 'acct-1', jobId: 'nope' }), false);

    s.claimJob({ accountId: 'acct-1', jobId: SHAPED_ID });
    assert.equal(s.ownsJob({ accountId: 'acct-1', jobId: SHAPED_ID }), true);
    assert.equal(s.ownsJob({ accountId: 'acct-2', jobId: SHAPED_ID }), false);
    assert.deepEqual(s.jobIdsFor('acct-1'), [SHAPED_ID]);
    assert.deepEqual(s.jobIdsFor('acct-2'), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the shelf is newest first', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-own-'));
  try {
    const s = createSessions({ root, auth: fakeAuth() });
    const ids = ['20260101-100000-aaaaaa', '20260820-090000-bbbbbb', '20260819-235959-cccccc'];
    for (const jobId of ids) s.claimJob({ accountId: 'acct-1', jobId });
    assert.deepEqual(s.jobIdsFor('acct-1'), [
      '20260820-090000-bbbbbb', '20260819-235959-cccccc', '20260101-100000-aaaaaa',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a missing auth module surfaces as AuthUnavailableError, and can recover', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-own-'));
  try {
    let present = false;
    const s = createSessions({
      root,
      loadAuthImpl: async () => {
        if (!present) throw new Error('ENOENT');
        return fakeAuth();
      },
    });
    await assert.rejects(() => s.currentAccount({ headers: { cookie: 'ts_session=x' } }), AuthUnavailableError);
    // The module can appear while the server is running; a permanently poisoned
    // promise would mean a restart for something that fixed itself.
    present = true;
    assert.equal(await s.currentAccount({ headers: { cookie: 'ts_session=x' } }), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 13 -- the three identity sweeps are wired into the server's OWN
// lifecycle. `sweepOAuth`, `sweepPending` and `sweepVerifyAttempts` are each
// unit-tested on their own terms elsewhere (`test/auth-oauth-store.test.js`,
// `test/auth-pending-signup.test.js`, `test/web-auth-code.test.js`) -- expiry
// logic, surviving a row that disappears mid-sweep, and so on. None of that
// is retested here. What is under test in this section is the wiring itself:
// whether `createServer` actually CALLS the three, on `listen()` and on a
// repeat, cancels that repeat on `close()`, and cannot be brought down by a
// sweep that fails.
// ---------------------------------------------------------------------------

test('listen() sweeps out/oauth, out/pending-signups and out/verify-attempts once, before anything else happens', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-sweep-'));
  // Well past every one of the three stores' own TTL (10 min, 24h, 1h), so
  // whichever `nowImpl` the real sweep uses -- the server's own default,
  // real wall-clock time -- finds all three already expired.
  const longAgo = () => new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const hash = 'a'.repeat(64);

  putVerifier({ root, state: 'expired-state', verifier: 'v', nowImpl: longAgo });
  putPending({
    root, email: 'stale@example.com',
    consent: { granted: true, at: new Date().toISOString(), text: 'x' },
    nowImpl: longAgo,
  });
  chargeCodeAttempt({ root, hash, nowImpl: longAgo });

  const oauthFile = path.join(root, ...OAUTH_DIR.split('/'), 'expired-state.json');
  const pendingFile = path.join(root, ...PENDING_DIR.split('/'), `${emailHash('stale@example.com')}.json`);
  const verifyFile = path.join(root, ...VERIFY_ATTEMPTS_DIR.split('/'), `${hash}.json`);
  // The seed must exist before the sweep can prove anything about removing it.
  assert.ok(fs.existsSync(oauthFile));
  assert.ok(fs.existsSync(pendingFile));
  assert.ok(fs.existsSync(verifyFile));

  const app = createServer({
    root, cfg: CFG, queue: fakeQueue(), port: 0, auth: fakeAuth(), supabase: null,
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed', logImpl: () => {},
  });
  try {
    await app.listen();
    assert.ok(!fs.existsSync(oauthFile), 'sweepOAuth was not called from listen()');
    assert.ok(!fs.existsSync(pendingFile), 'sweepPending was not called from listen()');
    assert.ok(!fs.existsSync(verifyFile), 'sweepVerifyAttempts was not called from listen()');
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the identity sweep repeats on the SAME cadence as the worker retention sweep, and close() cancels the repeat', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-sweep-'));
  const calls = { set: [], clear: [] };
  const fakeSetInterval = (fn, ms) => {
    const token = { fn, ms };
    calls.set.push(token);
    return token;
  };
  const fakeClearInterval = (token) => { calls.clear.push(token); };

  // Pinned to the worker's own constant rather than to a duplicated literal --
  // a future edit to either number without the other is exactly the drift
  // this assertion exists to catch.
  assert.equal(IDENTITY_SWEEP_MS, DEFAULT_RETENTION_SWEEP_MS,
    'a second cadence here would be a second answer to a question CLAUDE.md already settled');

  const app = createServer({
    root, cfg: CFG, queue: fakeQueue(), port: 0, auth: fakeAuth(), supabase: null,
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed', logImpl: () => {},
    setIntervalImpl: fakeSetInterval, clearIntervalImpl: fakeClearInterval,
  });
  try {
    await app.listen();
    assert.equal(calls.set.length, 1, 'exactly one repeat is scheduled');
    assert.equal(calls.set[0].ms, IDENTITY_SWEEP_MS);
    await app.close();
    assert.deepEqual(calls.clear, [calls.set[0]],
      'close() must cancel the exact timer listen() started, or the repeat outlives the server');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a sweep that cannot even create its own directory does not take listen() down with it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-sweep-'));
  fs.mkdirSync(path.join(root, 'out'), { recursive: true });
  // A plain FILE sitting exactly where `oauth-store.mjs` and
  // `pending-signup.mjs` each want a directory. Both modules' `dirFor()` is
  // an unconditional `mkdirSync(dir, { recursive: true })` with no try/catch
  // of its own -- both files are out of scope for this task -- so this is
  // what makes each of them throw, proving the server's OWN wrapping is what
  // keeps that throw from reaching `listen()`.
  fs.writeFileSync(path.join(root, 'out', 'oauth'), 'not a directory');
  fs.writeFileSync(path.join(root, 'out', 'pending-signups'), 'not a directory');

  const logs = [];
  const app = createServer({
    root, cfg: CFG, queue: fakeQueue(), port: 0, auth: fakeAuth(), supabase: null,
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed', logImpl: (line) => logs.push(line),
  });
  try {
    await assert.doesNotReject(
      () => app.listen(),
      'a sweep that cannot create its own directory must not crash the server that hosts it',
    );
    assert.ok(logs.some((l) => l.includes('sweepOAuth failed')), 'the failure must reach the log, not vanish');
    assert.ok(logs.some((l) => l.includes('sweepPending failed')), 'the failure must reach the log, not vanish');
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Review finding, 2026-08-26: the test above proves a sweep TARGET failure is
// contained, but its `logImpl` is `(line) => logs.push(line)`, which cannot
// itself throw -- so it never exercised the RECOVERY path at all. The first
// version of `sweepIdentityLitter` called `logImpl` directly from inside each
// catch block, with nothing above it to catch a second throw; a `logImpl`
// that itself threw escaped the function entirely, which the reviewer
// reproduced as `listen()` rejecting outright (the port never binds) and,
// worse, as an unhandled rejection on a later interval tick -- this codebase
// installs no `process.on('unhandledRejection')` anywhere, so that crashes
// the whole process, not just the sweep. This test uses a `logImpl` that
// actually throws, and forces a real sweep-target failure so that `logImpl`
// is genuinely invoked rather than merely present.
test('a logImpl that itself throws while reporting a sweep failure cannot crash listen(), the repeating tick, or the process', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-sweep-'));
  fs.mkdirSync(path.join(root, 'out'), { recursive: true });
  // Force sweepOAuth to actually fail, so its catch block's logImpl call is
  // exercised rather than this test proving nothing.
  fs.writeFileSync(path.join(root, 'out', 'oauth'), 'not a directory');

  let tick;
  const fakeSetInterval = (fn) => {
    tick = fn;
    return { unref() {} };
  };
  const fakeClearInterval = () => {};

  const app = createServer({
    root, cfg: CFG, queue: fakeQueue(), port: 0, auth: fakeAuth(), supabase: null,
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed',
    logImpl: () => { throw new Error('the logger itself is broken'); },
    setIntervalImpl: fakeSetInterval, clearIntervalImpl: fakeClearInterval,
  });

  const unhandled = [];
  const onUnhandledRejection = (err) => unhandled.push(err);
  process.on('unhandledRejection', onUnhandledRejection);
  try {
    await assert.doesNotReject(
      () => app.listen(),
      'sweepIdentityLitter must not throw even when its OWN error-reporting throws',
    );
    assert.equal(typeof tick, 'function', 'the repeating sweep was never scheduled');
    // Invoke the interval callback directly, exactly as the real timer would
    // on the next hour -- proving the REPEAT is guarded too, not just the
    // first pass inside listen().
    tick();
    // Let any rejection surface as `unhandledRejection` before asserting none did.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, [], 'a broken logger must never produce an unhandled rejection on a later tick');
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Coordinator ruling, 2026-08-26: a partial Supabase config must boot and
// must keep serving everything that is not identity -- rendering, billing,
// the shelf, every route. `supabaseFromEnv` degrading to `null` is only half
// the proof; this is the other half, built the same way `createServer` is
// built with `supabase: null` everywhere else in this file, except the null
// here comes from a genuinely partial env rather than an absent one.
test('a server built from a PARTIAL Supabase config still boots and still serves a non-identity route', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-partial-'));
  const partialEnv = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_x' };
  const supabase = supabaseFromEnv(partialEnv);
  assert.equal(supabase, null, 'a partial config must hand createServer null, not a half-built client');

  const app = createServer({
    root, cfg: CFG, queue: fakeQueue(), port: 0, auth: fakeAuth(), supabase,
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed', logImpl: () => {},
  });
  const port = await app.listen();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { accept: 'text/html' } });
    assert.equal(res.status, 200, 'the landing page must still serve when identity is misconfigured, not merely absent');
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
