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

import { createServer, safeNext, AUTH_RATE_LIMITS } from '../scripts/web/server.mjs';
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

async function signIn(base, email, password) {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password }),
    redirect: 'manual',
  });
  if (res.status !== 200) return null;
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

async function withApp(run, { auth = fakeAuth(), queue = fakeQueue(), sessions = null, nowImpl = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-auth-'));
  const app = createServer({
    root, cfg: CFG, queue, port: 0, auth: sessions ? null : auth, sessions,
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed',
    logImpl: () => {},
    ...(nowImpl ? { nowImpl } : {}),
  });
  const port = await app.listen();
  try {
    await run({ base: `http://127.0.0.1:${port}`, root, app, auth, queue });
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
    const cookie = await signIn(base, 'a@example.com', 'a long enough password');
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

test('a browser is sent back where it was going after signing in', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const res = await fetch(`${base}/j/${SHAPED_ID}`, { headers: { accept: 'text/html' }, redirect: 'manual' });
    assert.equal(res.headers.get('location'), `/login?next=${encodeURIComponent(`/j/${SHAPED_ID}`)}`);

    const login = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
      body: new URLSearchParams({ email: 'a@example.com', password: 'a long enough password', next: `/j/${SHAPED_ID}` }),
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

  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
      body: new URLSearchParams({ email: 'a@example.com', password: 'a long enough password', next: 'https://evil.example' }),
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

test('signing up creates the account, starts a session and lands on the shelf', async () => {
  await withApp(async ({ base, auth }) => {
    const res = await fetch(`${base}/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
      body: new URLSearchParams({ email: 'new@example.com', password: 'ten or more chars', consent: 'yes' }),
      redirect: 'manual',
    });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/');
    assert.ok(auth.findAccountByEmail({ email: 'new@example.com' }), 'the account was not created');

    const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const home = await fetch(`${base}/`, { headers: { cookie } });
    assert.equal(home.status, 200);
  });
});

test('sign-up refuses a bad address, a short password and a missing consent', async () => {
  await withApp(async ({ base, auth }) => {
    const cases = [
      { email: 'not-an-address', password: 'ten or more chars', consent: 'yes' },
      { email: 'ok@example.com', password: 'short', consent: 'yes' },
      { email: 'ok@example.com', password: 'ten or more chars' },
    ];
    for (const body of cases) {
      const res = await fetch(`${base}/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
      });
      assert.equal(res.status, 400, `${JSON.stringify(body)} was accepted`);
    }
    assert.equal(auth.findAccountByEmail({ email: 'ok@example.com' }), null);
  });
});

test('a duplicate email is refused in the words of the auth module', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'taken@example.com', password: 'a long enough password' });
    const res = await fetch(`${base}/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
      body: new URLSearchParams({ email: 'taken@example.com', password: 'another long one', consent: 'yes' }),
    });
    assert.equal(res.status, 400);
    assert.ok((await res.text()).includes('That email already has an account.'));
  });
});

/**
 * ONE MESSAGE FOR BOTH FAILURES. "No such account" and "wrong password" are
 * different facts and must be the same answer, or the login form is a free
 * account-enumeration oracle on a site that stores photographs of faces.
 */
test('a wrong password and an unknown email are the same 401 and the same sentence', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });

    const wrong = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
      body: new URLSearchParams({ email: 'a@example.com', password: 'nope' }),
    });
    const unknown = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
      body: new URLSearchParams({ email: 'nobody@example.com', password: 'nope' }),
    });

    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    const a = await wrong.text();
    const b = await unknown.text();
    assert.ok(a.includes('That email and password do not match an account.'));
    assert.ok(b.includes('That email and password do not match an account.'));
    assert.ok(!b.includes('no such account'));
  });
});

// ---------------------------------------------------------------------------
// the limiter
// ---------------------------------------------------------------------------

const login = (base, { email = 'a@example.com', password = 'nope', accept = 'application/json' } = {}) =>
  fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept },
    body: new URLSearchParams({ email, password }),
    redirect: 'manual',
  });

const signup = (base, email, { accept = 'application/json' } = {}) =>
  fetch(`${base}/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept },
    body: new URLSearchParams({ email, password: 'a long enough password', consent: 'yes' }),
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

    for (let i = 0; i < AUTH_RATE_LIMITS.login.max; i += 1) {
      assert.equal((await login(base)).status, 401, `attempt ${i + 1} is an ordinary refusal`);
    }
    const over = await login(base);
    assert.equal(over.status, 429);
    assert.match(over.headers.get('retry-after') ?? '', /^[0-9]+$/, 'a 429 without Retry-After is a puzzle, not an answer');
    const body = await over.json();
    assert.equal(body.error.status, 429);
    assert.ok(!body.error.message.includes('a@example.com'));

    const right = await login(base, { password: 'a long enough password' });
    assert.equal(right.status, 429, 'the limit must hold before credentials are examined, or it can be probed around');

    // The browser form gets a page with the sentence on it, same as every other
    // refusal on these routes.
    const html = await login(base, { accept: 'text/html' });
    assert.equal(html.status, 429);
    assert.ok((await html.text()).includes('Too many'));
  });
});

test('the login window closes, and a genuine sign-in works again', async () => {
  let nowMs = Date.UTC(2026, 7, 25, 12, 0, 0);
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });

    for (let i = 0; i < AUTH_RATE_LIMITS.login.max; i += 1) await login(base);
    assert.equal((await login(base)).status, 429);

    nowMs += AUTH_RATE_LIMITS.login.windowMs + 1000;
    const after = await login(base, { password: 'a long enough password' });
    assert.equal(after.status, 200, 'a closed window must not keep refusing a genuine sign-in');
  }, { nowImpl: () => new Date(nowMs) });
});

/** Accounts are what the free grant is spent on, so creating them from a script
 *  must cost something. The refusal happens before the handler runs: nothing is
 *  written, and the account count proves it. */
test('signup attempts from one address are bounded, and no account is created past the bound', async () => {
  await withApp(async ({ base, auth }) => {
    for (let i = 0; i < AUTH_RATE_LIMITS.signup.max; i += 1) {
      assert.equal((await signup(base, `fresh-${i}@example.com`)).status, 201, `signup ${i + 1} is ordinary`);
    }
    const over = await signup(base, 'one-too-many@example.com');
    assert.equal(over.status, 429);
    assert.match(over.headers.get('retry-after') ?? '', /^[0-9]+$/);
    assert.equal(auth.accounts.size, AUTH_RATE_LIMITS.signup.max, 'an account was created past the refusal');
  });
});

test('the session cookie is HttpOnly, SameSite=Lax and not Secure over plain HTTP', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const res = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'a@example.com', password: 'a long enough password' }),
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

/** The server-side record is what makes logout actually log out. A JWT cannot be
 *  revoked, and this app can hand somebody else's face to whoever holds one. */
test('signing out destroys the record, so the old cookie stops working', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const cookie = await signIn(base, 'a@example.com', 'a long enough password');
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

test('a forged or tampered cookie is rejected before any filesystem lookup', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password' });
    const real = await signIn(base, 'a@example.com', 'a long enough password');
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
    const cookieB = await signIn(base, 'b@example.com', 'a different password');
    const cookieA = await signIn(base, 'a@example.com', 'a long enough password');

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
    const cookie = await signIn(base, 'a@example.com', 'a long enough password');
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
    const cookie = await signIn(base, 'a@example.com', 'a long enough password');
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
    const cookie = await signIn(base, 'a@example.com', 'a long enough password');

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

test('a balance that covers 480p but not 720p refuses only the 720p tape', async () => {
  await withApp(async ({ base, auth }) => {
    auth.createAccount({ email: 'a@example.com', password: 'a long enough password', credits: 100 });
    const cookie = await signIn(base, 'a@example.com', 'a long enough password');

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
    const cookie = await signIn(base, 'a@example.com', 'a long enough password');

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
    const cookie = await signIn(base, 'a@example.com', 'a long enough password');

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
    const cookie = await signIn(base, 'a@example.com', 'a long enough password');

    const anon = await fetch(`${base}/pricing`);
    assert.equal(anon.status, 200);
    const anonHtml = await anon.text();
    for (const label of ['Free', 'Shelf', 'Archive']) assert.ok(anonHtml.includes(label), `${label} is missing`);
    assert.ok(anonHtml.includes('$10') && anonHtml.includes('$12'));
    assert.ok(!anonHtml.includes('Your plan'), 'nothing is marked for a signed-out visitor');

    // Credits are the honest unit -- "N tapes a month" stopped being true the
    // moment a tape had two prices -- but the translation is shown as well,
    // because "153 credits" on its own tells a first-time reader nothing.
    assert.ok(anonHtml.includes('153 credits a month'));
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
    const cookie = await signIn(base, 'a@example.com', 'a long enough password');

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
        const fields = form.match(/<input\b[^>]*>/gi) ?? [];
        assert.equal(fields.length, 1, `the checkout form on ${target} carries more than a pack id`);
        assert.match(fields[0], /name="pack"/, `the checkout form on ${target} sends something other than a pack id`);
        assert.match(fields[0], /type="hidden"/, 'the pack id must not be typeable');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// degrading when scripts/auth/ is not there
// ---------------------------------------------------------------------------

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

  const set = serializeCookie('n', 'v alue', { maxAge: 60, secure: true });
  assert.match(set, /^n=v%20alue;/);
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Lax/);
  assert.match(set, /Secure/);
  assert.match(set, /Max-Age=60/);
});

test('Secure follows the actual protocol, and a forwarded header is believed exactly', () => {
  assert.equal(isSecureRequest({ socket: { encrypted: true }, headers: {} }), true);
  assert.equal(isSecureRequest({ socket: {}, headers: { 'x-forwarded-proto': 'https' } }), true);
  assert.equal(isSecureRequest({ socket: {}, headers: { 'x-forwarded-proto': 'https, http' } }), true);
  assert.equal(isSecureRequest({ socket: {}, headers: { 'x-forwarded-proto': 'http' } }), false);
  assert.equal(isSecureRequest({ socket: {}, headers: { 'x-forwarded-proto': 'nothttps' } }), false);
  assert.equal(isSecureRequest({ socket: {}, headers: {} }), false);
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
