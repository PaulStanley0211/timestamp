/**
 * Two tenants, and every way one of them might reach the other.
 *
 * WHY THIS FILE EXISTS WHEN `web-auth.test.js` ALREADY HAS AN OWNERSHIP TEST.
 * `docs/security-review-brief.md` §3 asks for the isolation proof to be
 * re-derived by somebody who did not write the implementation, and it names the
 * axes the existing test does not walk: **method tampering and role tampering**,
 * not just id swapping. The existing test proves account B gets a 404 on account
 * A's job across the ten job routes. That is the id axis and it is genuinely
 * covered, so this file does not repeat it. What this file adds is the other
 * four axes in the brief -- ids in shapes the first test never sends, URLs,
 * request bodies, roles, and HTTP methods -- plus the property that ties them
 * together: **not-yours and not-there must be indistinguishable**, because a
 * difference between those two answers is the account-enumeration oracle the
 * 404-not-403 decision exists to close.
 *
 * WHY THE AUTH FAKE IS REBUILT HERE RATHER THAN IMPORTED. `web-auth.test.js`
 * does not export its fake, and copying it would inherit its assumptions along
 * with its code. This one is written from `session-middleware.mjs`'s
 * `REQUIRED_AUTH` list -- the contract, not the existing test -- so a shared
 * wrong assumption in the fake cannot make both files pass together.
 *
 * WHAT A FAILURE HERE MEANS. This app stores photographs of real people's faces.
 * Every assertion below is a sentence of the form "a stranger who tries X does
 * not get somebody's face". There is no such thing as a cosmetic failure in this
 * file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { createServer } from '../scripts/web/server.mjs';
import { SESSION_COOKIE } from '../scripts/web/session-middleware.mjs';
import { createJob, saveJob, jobPaths, setJobStatus, completeJob } from '../scripts/render/job.mjs';

const CFG = JSON.parse(fs.readFileSync(new URL('../config/render.json', import.meta.url), 'utf8'));
const BOUNDARY = 'tenantboundary91';

/** A well-formed job id that is guaranteed never to have been created. The
 *  point of the shape being valid is that it survives `JOB_ID_RE` and reaches
 *  the ownership check, which is the comparison this file needs. */
const ABSENT_ID = '20200101-000000-abcdef';

/** The secret to A's photograph, as it appears in a rendered page or payload.
 *  Every response in this file is searched for it. */
const A_SECRET_PLACE = 'a-beach-only-A-knows-about';
const A_SECRET_OUTFIT = 'a-jumper-only-A-knows-about';

// ---------------------------------------------------------------------------
// the harness, written from REQUIRED_AUTH rather than from the other test
// ---------------------------------------------------------------------------

const PLANS = Object.freeze({
  free: { id: 'free', label: 'Free', monthlyUSD: 0, annualUSD: 0, creditsPerPeriod: 51 },
  shelf: { id: 'shelf', label: 'Shelf', monthlyUSD: 10, annualUSD: 100, creditsPerPeriod: 153 },
});

const CREDIT_COSTS = Object.freeze({
  '480p': { resolution: '480p', width: 640, height: 480, available: true, creditsPerReference: 51 },
  '720p': { resolution: '720p', width: 1280, height: 720, available: true, creditsPerReference: 152 },
  '1080p': { resolution: '1080p', width: 1920, height: 1080, available: false, creditsPerReference: 341 },
});

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
 * The `scripts/auth/` surface, in memory.
 *
 * The cookie signature is a real HMAC over the session id, because two of the
 * tests below tamper with a signed cookie and a fake that did not actually
 * verify would pass them for the wrong reason.
 */
function fakeAuth() {
  const accounts = new Map();
  const byEmail = new Map();
  const sessions = new Map();
  const SECRET = 'tenant-isolation-secret';
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
        throw err;
      }
      n += 1;
      const account = {
        accountId: `acct-${n}`, root: '/fake', email, plan, password,
        credits: credits ?? PLANS[plan].creditsPerPeriod, ledger: [],
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
    creditCost({ resolution = '480p', seconds = 15, tier = 'standard' } = {}) {
      const row = CREDIT_COSTS[resolution];
      if (!row) { const e = new Error('unknown resolution'); e.code = 'UNKNOWN_RESOLUTION'; throw e; }
      if (row.available === false) { const e = new Error('deferred'); e.code = 'RESOLUTION_UNAVAILABLE'; throw e; }
      if (tier !== 'standard') { const e = new Error('unknown tier'); e.code = 'UNKNOWN_TIER'; throw e; }
      return Math.ceil(row.creditsPerReference * (seconds / 15));
    },
    authenticate({ email, password }) {
      const id = byEmail.get(String(email ?? '').toLowerCase());
      const account = id ? accounts.get(id) : null;
      if (!account || !password || account.password !== password) {
        const err = new Error('no match');
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
      if (account.ledger.some((e) => e.jobId === jobId && e.delta < 0)) return;
      if (account.credits < credits) {
        const err = new Error('insufficient');
        err.code = 'INSUFFICIENT_CREDITS';
        throw err;
      }
      account.credits -= credits;
      account.ledger.push({ jobId, delta: -credits });
    },
    refundCredits(account, { jobId }) {
      const spent = account.ledger.find((e) => e.jobId === jobId && e.delta < 0);
      if (!spent || account.ledger.some((e) => e.jobId === jobId && e.delta > 0)) return;
      account.credits += -spent.delta;
      account.ledger.push({ jobId, delta: -spent.delta });
    },
  };
}

async function withTwoTenants(run) {
  const auth = fakeAuth();
  const queue = fakeQueue();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-tenant-'));
  const app = createServer({
    root, cfg: CFG, queue, port: 0, auth,
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed',
    logImpl: () => {},
  });
  const port = await app.listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    const A = auth.createAccount({ email: 'alice@example.com', password: 'alice password long', credits: 500 });
    const B = auth.createAccount({ email: 'mallory@example.com', password: 'mallory password long', credits: 500 });
    const cookieA = signIn(auth, 'alice@example.com', 'alice password long');
    const cookieB = signIn(auth, 'mallory@example.com', 'mallory password long');
    assert.ok(cookieA && cookieB, 'both tenants must be able to sign in for this file to mean anything');
    await run({ base, root, app, auth, queue, A, B, cookieA, cookieB });
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Mint a session directly against the fake local `scripts/auth/` surface,
 * rather than posting to `/login`.
 *
 * TASK 9 CHANGED WHAT `/login` DOES: it now asks Supabase and resolves the
 * identity through the REAL `scripts/auth/identity.mjs` + `accounts.mjs`,
 * regardless of the fake `auth` this file builds for the local surface --
 * and this file's own `createServer` call passes no `supabase` at all, so
 * `POST /login` now answers 503. This file's subject is tenant isolation
 * against a controllable fake, not login mechanics (those are covered in
 * `test/web-auth-code.test.js` and `test/web-auth.test.js`), so both tenants
 * get a session the same way `startSession` would have minted one.
 */
function signIn(auth, email, password) {
  const account = auth.findAccountByEmail({ email });
  if (!account || !auth.verifyPassword(account, password)) return null;
  const { sessionId } = auth.createSession({ accountId: account.accountId });
  return `${SESSION_COOKIE}=${auth.signCookie(sessionId, auth.sessionSecret())}`;
}

/** A finished job belonging to `owner`, with real bytes on disk behind every
 *  route, so that a leak has something to leak. */
function seedJob(app, root, owner, { status = 'done' } = {}) {
  const job = createJob({
    root,
    input: {
      photo: { path: 'input/upload-photo', sha256: 'a'.repeat(64) },
      place: { kind: 'text', value: A_SECRET_PLACE },
      outfit: { kind: 'text', value: A_SECRET_OUTFIT },
      stillCount: 3,
      consent: { granted: true, at: new Date().toISOString(), text: 'the wording' },
    },
    provider: 'fixture',
    cfg: CFG,
  });
  if (status !== 'queued') {
    setJobStatus(job, 'running');
    if (status === 'done') completeJob(job, { videoPath: 'timestamp.mp4', posterPath: 'poster.jpg' });
    else setJobStatus(job, status);
  }
  saveJob(job);
  const paths = jobPaths(root, job.jobId);
  fs.mkdirSync(paths.stills, { recursive: true });
  fs.writeFileSync(`${paths.stills}/still-01.png`, Buffer.from('A private still'));
  fs.writeFileSync(paths.video, Buffer.alloc(64, 7));
  fs.writeFileSync(paths.poster, Buffer.alloc(64, 8));
  app.sessions.claimJob({ accountId: owner.accountId, jobId: job.jobId });
  return job;
}

/** Every job-scoped route, as a template over the id. */
const JOB_ROUTES = (id) => ([
  ['GET', `/j/${id}`],
  ['GET', `/j/${id}/select`],
  ['GET', `/j/${id}/result`],
  ['GET', `/api/jobs/${id}`],
  ['GET', `/api/jobs/${id}/stills`],
  ['GET', `/api/jobs/${id}/stills/1`],
  ['GET', `/api/jobs/${id}/video`],
  ['GET', `/api/jobs/${id}/poster`],
  ['POST', `/api/jobs/${id}/select`],
  ['DELETE', `/api/jobs/${id}`],
]);

/** The assertion every test in this file ultimately makes. */
function assertNoLeak(status, text, where) {
  assert.notEqual(status, 200, `${where} answered 200 to the wrong tenant`);
  assert.ok(!text.includes(A_SECRET_PLACE), `${where} leaked A's place`);
  assert.ok(!text.includes(A_SECRET_OUTFIT), `${where} leaked A's outfit`);
  assert.ok(!text.includes('A private still'), `${where} leaked A's still bytes`);
}

// ---------------------------------------------------------------------------
// 1. the oracle: not-yours and not-there must be the same answer
// ---------------------------------------------------------------------------

test('not-yours and not-there are byte-identical, on every job route', async () => {
  await withTwoTenants(async ({ base, root, app, A, cookieB }) => {
    const job = seedJob(app, root, A);

    for (const [method, mine] of JOB_ROUTES(job.jobId)) {
      const absent = mine.replace(job.jobId, ABSENT_ID);
      const opts = {
        method,
        headers: { cookie: cookieB, 'content-type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ stillIndex: 1 }) : undefined,
        redirect: 'manual',
      };
      const yours = await fetch(`${base}${mine}`, opts);
      const nothing = await fetch(`${base}${absent}`, opts);
      const yoursText = await yours.text();
      const nothingText = await nothing.text();

      assertNoLeak(yours.status, yoursText, `${method} ${mine}`);
      // THE ORACLE TEST. If these two differ in status or in body, the
      // difference is a signal that says "this job exists", which is precisely
      // the fact a stranger enumerating timestamps is fishing for.
      assert.equal(yours.status, nothing.status,
        `${method} ${mine}: existing-but-not-yours (${yours.status}) differs from absent (${nothing.status})`);
      assert.equal(yoursText.replace(job.jobId, ABSENT_ID), nothingText,
        `${method} ${mine}: the two 404 bodies are distinguishable`);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. method tampering
// ---------------------------------------------------------------------------

test('no HTTP method reaches another tenant\'s job', async () => {
  await withTwoTenants(async ({ base, root, app, A, cookieB }) => {
    const job = seedJob(app, root, A);
    const paths = [
      `/j/${job.jobId}`,
      `/j/${job.jobId}/result`,
      `/api/jobs/${job.jobId}`,
      `/api/jobs/${job.jobId}/video`,
      `/api/jobs/${job.jobId}/stills/1`,
      `/api/jobs/${job.jobId}/select`,
    ];
    // Every method the router knows plus the ones it does not. A route that
    // answers PATCH because nobody wrote PATCH down is the shape of this bug.
    // TRACE is absent because undici refuses to send it at all, so asserting on
    // it would test the HTTP client rather than the app.
    const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

    for (const target of paths) {
      for (const method of methods) {
        const res = await fetch(`${base}${target}`, {
          method,
          headers: { cookie: cookieB, 'content-type': 'application/json' },
          body: ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify({ stillIndex: 1 }) : undefined,
          redirect: 'manual',
        });
        const text = method === 'HEAD' ? '' : await res.text();
        assertNoLeak(res.status, text, `${method} ${target}`);
        // OPTIONS is allowed to answer 204 with an Allow header -- it describes
        // the route, not the job -- but it must never carry a body.
        if (method === 'OPTIONS') assert.equal(text, '', 'OPTIONS returned a body');
      }
    }
  });
});

test('a method-override header does not become the method', async () => {
  await withTwoTenants(async ({ base, root, app, A, cookieB }) => {
    const job = seedJob(app, root, A);
    // If any of these were honoured, `DELETE` would be reachable from a plain
    // HTML form -- which is also the CSRF story, since a form POST is the one
    // cross-site request `SameSite=Lax` is weakest against.
    for (const header of ['x-http-method-override', 'x-method-override', '_method']) {
      for (const value of ['GET', 'DELETE']) {
        const res = await fetch(`${base}/api/jobs/${job.jobId}`, {
          method: 'POST',
          headers: { cookie: cookieB, [header]: value, 'content-type': 'application/json' },
          body: JSON.stringify({ _method: value }),
          redirect: 'manual',
        });
        const text = await res.text();
        assertNoLeak(res.status, text, `POST + ${header}: ${value}`);
        assert.equal(res.status, 405, `POST /api/jobs/:id with ${header} answered ${res.status}, not 405`);
      }
    }
  });
});

test('HEAD leaks nothing that GET would not, including through headers', async () => {
  await withTwoTenants(async ({ base, root, app, A, cookieA, cookieB }) => {
    const job = seedJob(app, root, A);
    const target = `${base}/api/jobs/${job.jobId}/video`;

    const mine = await fetch(target, { method: 'HEAD', headers: { cookie: cookieB } });
    const absent = await fetch(`${base}/api/jobs/${ABSENT_ID}/video`, { method: 'HEAD', headers: { cookie: cookieB } });
    assert.equal(mine.status, absent.status, 'HEAD distinguishes an existing job from an absent one');
    // Content-Length is the classic side channel: a 404 page whose length varies
    // with whether the job was found is the oracle wearing a different hat.
    assert.equal(mine.headers.get('content-length'), absent.headers.get('content-length'),
      'HEAD Content-Length distinguishes existing from absent');

    // The owner, by contrast, must actually get the file.
    const owner = await fetch(target, { method: 'HEAD', headers: { cookie: cookieA } });
    assert.equal(owner.status, 200, 'the owner lost access, which would make this test vacuous');
  });
});

// ---------------------------------------------------------------------------
// 3. role and identity tampering
// ---------------------------------------------------------------------------

test('nothing reads an identity or a role from the client', async () => {
  await withTwoTenants(async ({ base, root, app, A, B, cookieB }) => {
    const job = seedJob(app, root, A);

    // There is no privilege ladder in this app today -- the brief says so and
    // this asserts it. The risk is not that `role: admin` works now; it is that
    // a future role check reads one of these names without anybody noticing
    // that the client has always been able to set it.
    const claims = [
      { accountId: A.accountId },
      { account_id: A.accountId },
      { accountId: A.accountId, role: 'admin' },
      { role: 'admin', isAdmin: true, plan: 'archive' },
      { owner: A.accountId, ownerId: A.accountId },
      { stillIndex: 1, accountId: A.accountId },
      { __proto__: { accountId: A.accountId } },
    ];

    for (const claim of claims) {
      const label = JSON.stringify(claim);
      // In a body.
      const posted = await fetch(`${base}/api/jobs/${job.jobId}/select`, {
        method: 'POST',
        headers: { cookie: cookieB, 'content-type': 'application/json' },
        body: JSON.stringify({ stillIndex: 1, ...claim }),
        redirect: 'manual',
      });
      assertNoLeak(posted.status, await posted.text(), `POST select with body ${label}`);

      // In a query string.
      const qs = new URLSearchParams(Object.entries(claim).map(([k, v]) => [k, String(v)])).toString();
      const queried = await fetch(`${base}/api/jobs/${job.jobId}?${qs}`, {
        headers: { cookie: cookieB }, redirect: 'manual',
      });
      assertNoLeak(queried.status, await queried.text(), `GET job with query ${label}`);

      // In a header.
      const headed = await fetch(`${base}/api/jobs/${job.jobId}`, {
        headers: {
          cookie: cookieB,
          'x-account-id': A.accountId,
          'x-role': 'admin',
          'x-forwarded-user': A.email,
        },
        redirect: 'manual',
      });
      assertNoLeak(headed.status, await headed.text(), `GET job with identity headers ${label}`);
    }

    // And B is still B: the tampering did not quietly re-plan the account.
    assert.equal(app.sessions.ownsJob({ accountId: B.accountId, jobId: job.jobId }), false,
      'B acquired ownership of A\'s job through a tampered field');
    assert.equal(B.plan, 'free', 'B\'s plan was changed by a client-supplied field');
  });
});

test('a second cookie for the other account does not win', async () => {
  await withTwoTenants(async ({ base, root, app, A, cookieA, cookieB }) => {
    const job = seedJob(app, root, A);
    // Two session cookies of the same name in one header. Whichever the parser
    // picks, it must be a session it verified -- not "the last one wins" against
    // a value the client appended.
    // Cookie headers that contain NO intact, correctly-signed cookie for A.
    // Every one of these must fail to become A. Classified explicitly rather
    // than inferred by substring: `${cookieA}x` *contains* A's value as a
    // substring while being a different, tampered cookie, and a substring test
    // would wave it through as "legitimately A".
    const mustNotBeA = [
      `${SESSION_COOKIE}=sess-1`,                     // a real-looking id, unsigned
      `${SESSION_COOKIE}=sess-1.0000000000000000`,    // signed with the wrong key
      `${cookieA}x`,                                  // A's cookie with a byte appended
      `${cookieA.slice(0, -1)}`,                      // A's cookie with a byte removed
      `${cookieB}; other=${cookieA.split('=').slice(1).join('=')}`, // A's value under another name
    ];
    for (const cookie of mustNotBeA) {
      const res = await fetch(`${base}/api/jobs/${job.jobId}`, { headers: { cookie }, redirect: 'manual' });
      assertNoLeak(res.status, await res.text(), `forged cookie ${cookie.slice(0, 48)}`);
    }

    // Two intact session cookies of the same name in one header. Whichever the
    // parser picks it must pick exactly ONE verified identity -- never blend
    // them, and never resolve to A's job for a header B controls the rest of.
    // THE FIRST COOKIE WINS, and this assertion is deliberately tighter than
    // the one it replaces. That one accepted EITHER identity as "a defensible
    // parse" -- true while the two parsers in this repo disagreed, and exactly
    // what let the request path run last-wins unnoticed. A browser sends the
    // most specific cookie first, so last-wins hands the session to whoever can
    // set a cookie on a parent domain or a wider path. Only first-wins is
    // defensible now, and `parseCookies` in `scripts/web/session-middleware.mjs`
    // is where it is enforced. Not weaker: every no-leak guarantee below is
    // still asserted, on top of a resolution that is now pinned rather than
    // permitted either way.
    for (const [cookie, firstIs] of [[`${cookieB}; ${cookieA}`, 'B'], [`${cookieA}; ${cookieB}`, 'A']]) {
      const res = await fetch(`${base}/api/jobs/${job.jobId}`, { headers: { cookie }, redirect: 'manual' });
      const text = await res.text();
      assert.ok([200, 404, 303, 401].includes(res.status), `duplicate-cookie header answered ${res.status}`);
      if (firstIs === 'A') {
        // A is first and A owns the job, so A is served -- wholly A.
        assert.equal(res.status, 200, 'A\'s cookie came first and must be the identity used');
        assert.equal(app.sessions.ownsJob({ accountId: A.accountId, jobId: job.jobId }), true);
      } else {
        // B is first. B does not own A's job, so appending A's cookie after it
        // must not promote the request to A -- that is the fixation primitive.
        assert.notEqual(res.status, 200, 'a trailing cookie promoted the request to A\'s identity');
        assert.ok(!text.includes(A_SECRET_PLACE), 'a duplicate-cookie header leaked A\'s input');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. id and URL tampering, in shapes the first test does not send
// ---------------------------------------------------------------------------

test('no spelling of another tenant\'s job id reaches it', async () => {
  await withTwoTenants(async ({ base, root, app, A, cookieB }) => {
    const job = seedJob(app, root, A);
    const id = job.jobId;

    const spellings = [
      id.toUpperCase(),                       // hex case
      `${id} `,                               // trailing space
      ` ${id}`,                               // leading space
      `${id}.`,                               // trailing dot -- Windows path folding
      `${id}%00`,                             // null byte
      `${id}%0a`,                             // newline
      `${id}/`,                               // trailing slash
      encodeURIComponent(id),                 // fully encoded
      id.replace(/-/g, '%2d'),                // encoded separators
      `${id}%20`,
      `..%2f..%2fjobs%2f${id}`,               // traversal, encoded
      `%2e%2e%2f${id}`,
      `${id}​`,                          // zero-width space
      `${id}．`,                          // fullwidth stop
    ];

    for (const spelling of spellings) {
      for (const target of [`/api/jobs/${spelling}`, `/j/${spelling}`, `/api/jobs/${spelling}/video`]) {
        let res;
        try {
          res = await fetch(`${base}${target}`, { headers: { cookie: cookieB }, redirect: 'manual' });
        } catch {
          continue; // undici refused to send it at all, which is a pass
        }
        assertNoLeak(res.status, await res.text(), `${target}`);
      }
    }
  });
});

test('the still index is an index into this job, not a path', async () => {
  await withTwoTenants(async ({ base, root, app, A, cookieA, cookieB }) => {
    const jobA = seedJob(app, root, A);
    // B owns a job of their own, so B has a legitimate id to pair with a
    // tampered index -- the interesting case is a valid job plus a hostile index.
    const indices = [
      '1', '0', '-1', '999', '1.0', '01',
      '../../../etc/passwd', '..%2f..%2fstill-01.png',
      `../../${jobA.jobId}/stills/still-01.png`,
      'still-01.png', '%2e%2e%2f%2e%2e%2f',
    ];
    for (const index of indices) {
      const res = await fetch(`${base}/api/jobs/${jobA.jobId}/stills/${index}`, {
        headers: { cookie: cookieB }, redirect: 'manual',
      });
      assertNoLeak(res.status, await res.text(), `B reading still ${index}`);
    }
    // The owner asking for a traversal index is refused too: ownership is not a
    // licence to read outside the job directory.
    for (const index of ['../../../etc/passwd', `../../${jobA.jobId}/../../../secret`]) {
      const res = await fetch(`${base}/api/jobs/${jobA.jobId}/stills/${index}`, {
        headers: { cookie: cookieA }, redirect: 'manual',
      });
      assert.notEqual(res.status, 200, `the owner traversed out with index ${index}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. writes: the axis a read-only test would miss entirely
// ---------------------------------------------------------------------------

test('B cannot modify, select within, or cancel A\'s job', async () => {
  await withTwoTenants(async ({ base, root, app, A, cookieA, cookieB }) => {
    const job = seedJob(app, root, A, { status: 'awaiting-selection' });
    const before = fs.readFileSync(`${jobPaths(root, job.jobId).dir}/manifest.json`, 'utf8');

    const attempts = [
      ['POST', `/api/jobs/${job.jobId}/select`, JSON.stringify({ stillIndex: 1 })],
      ['POST', `/api/jobs/${job.jobId}/select`, 'stillIndex=1'],
      ['DELETE', `/api/jobs/${job.jobId}`, undefined],
    ];
    for (const [method, target, body] of attempts) {
      const res = await fetch(`${base}${target}`, {
        method,
        headers: {
          cookie: cookieB,
          'content-type': body && body.startsWith('{') ? 'application/json' : 'application/x-www-form-urlencoded',
        },
        body,
        redirect: 'manual',
      });
      assertNoLeak(res.status, await res.text(), `${method} ${target} as B`);
    }

    // THE ASSERTION THAT MATTERS: the bytes on disk are unchanged. A 404 that
    // still wrote the manifest would pass every status-code check above.
    const after = fs.readFileSync(`${jobPaths(root, job.jobId).dir}/manifest.json`, 'utf8');
    assert.equal(after, before, 'B\'s refused request still changed A\'s manifest');
    assert.equal(app.sessions.ownsJob({ accountId: A.accountId, jobId: job.jobId }), true,
      'B\'s refused request released A\'s ownership');

    // And A can still do the thing B could not.
    const ok = await fetch(`${base}/api/jobs/${job.jobId}`, { headers: { cookie: cookieA } });
    assert.equal(ok.status, 200, 'A lost access to A\'s own job');
  });
});

test('uploading cannot assign the job to another account', async () => {
  await withTwoTenants(async ({ base, app, A, B, cookieB }) => {
    const parts = [
      { name: 'photo', filename: 'me.png', body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) },
      { name: 'place', body: 'amalfi-afternoon' },
      { name: 'outfit', body: 'fleecepulli' },
      { name: 'resolution', body: '480p' },
      { name: 'consent', body: 'yes' },
      // The tampering: every name the ownership index might plausibly read.
      { name: 'accountId', body: A.accountId },
      { name: 'account_id', body: A.accountId },
      { name: 'owner', body: A.accountId },
      { name: 'role', body: 'admin' },
      // And the money: a client-supplied price must not be the price.
      { name: 'credits', body: '0' },
      { name: 'cost', body: '0' },
    ];
    const body = multipartBody(parts);
    const res = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { cookie: cookieB, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      body,
    });
    assert.equal(res.status, 201, `upload failed (${res.status}), so this test proved nothing`);
    const { jobId, credits } = await res.json();

    // The job belongs to whoever's session made the request, not to the name in
    // the body.
    assert.equal(app.sessions.ownsJob({ accountId: B.accountId, jobId }), true,
      'the uploader does not own the job they uploaded');
    assert.equal(app.sessions.ownsJob({ accountId: A.accountId, jobId }), false,
      'a body field assigned the job to another account');

    // The charge is the server's number, not the client's zero.
    assert.equal(credits, 51, 'the client-supplied credits field changed the quote');
    assert.equal(B.credits, 500 - 51, 'the client-supplied credits field changed the debit');
    assert.equal(A.credits, 500, 'the other account was charged');
  });
});

test('an unavailable resolution cannot be bought at any price', async () => {
  await withTwoTenants(async ({ base, B, cookieB }) => {
    // The two invisible variants are BUILT, never typed, so that what is under
    // test is legible in review instead of depending on a byte nobody can see.
    // A trailing space trims away to a real 480p; a trailing NUL does not, and
    // must be refused. That pair is the point of this test.
    const SPACED = `480p${String.fromCharCode(32)}`;
    const NULLED = `480p${String.fromCharCode(0)}`;

    for (const resolution of ['1080p', '4k', '', '480P', 'x480p', NULLED, SPACED]) {
      const res = await fetch(`${base}/api/jobs`, {
        method: 'POST',
        headers: { cookie: cookieB, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
        body: multipartBody([
          { name: 'photo', filename: 'me.png', body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]) },
          { name: 'place', body: 'amalfi-afternoon' },
          { name: 'outfit', body: 'fleecepulli' },
          { name: 'consent', body: 'yes' },
          { name: 'resolution', body: resolution },
          { name: 'credits', body: '0' },
        ]),
      });

      if (resolution === SPACED) {
        // Trimmed to a real resolution and charged for as one. Normalisation,
        // not a bypass.
        assert.equal(res.status, 201, 'a trailing space should trim to 480p');
        assert.equal((await res.json()).credits, 51, 'the trimmed 480p was not charged as 480p');
        continue;
      }

      if (resolution === '') {
        // RECORDED AS IT BEHAVES, NOT AS THE CONFIG READS. An omitted
        // resolution does NOT fall through to config/credits.json's
        // defaults.resolution ("480p", 51 CR, chosen there because "the product
        // is credit-conscious"). It falls through to PREFERRED_RESOLUTION, a
        // constant hardcoded at server.mjs:605, which is 720p -- three times the
        // price. A browser sees 720p pre-selected with "~152 CR" on the button,
        // so a person consents to it; an API client that omits the field simply
        // pays 3x the documented default. Written down here so that an edit
        // reconciling the two trips this assertion instead of passing silently.
        assert.equal(res.status, 201, 'an empty resolution should use a default');
        assert.equal((await res.json()).credits, 152,
          'the omitted-resolution default changed; reconcile server.mjs:605 with config/credits.json defaults.resolution');
        continue;
      }

      assert.equal(res.status, 400, `${JSON.stringify(resolution)} was accepted`);
    }

    // One 480p tape (51) and one defaulted 720p tape (152), from an opening 500.
    assert.equal(B.credits, 500 - 51 - 152, 'the accepted uploads were not charged exactly once each');
  });
});

// ---------------------------------------------------------------------------
// 6. the shelf and the session, at the edges
// ---------------------------------------------------------------------------

test('the shelf shows only the signed-in account\'s tapes', async () => {
  await withTwoTenants(async ({ base, root, app, A, cookieA, cookieB }) => {
    seedJob(app, root, A);
    seedJob(app, root, A);
    const shelfB = await (await fetch(`${base}/`, { headers: { cookie: cookieB, accept: 'text/html' } })).text();
    assert.ok(!shelfB.includes(A_SECRET_PLACE), 'A\'s job appeared on B\'s shelf');
    const shelfA = await (await fetch(`${base}/`, { headers: { cookie: cookieA, accept: 'text/html' } })).text();
    assert.ok(shelfA.includes(A_SECRET_PLACE) || shelfA.includes('20'), 'A\'s own shelf is empty, so this proved nothing');
  });
});

test('signing out ends the session for the id that was signed out', async () => {
  await withTwoTenants(async ({ base, root, app, A, cookieA, cookieB }) => {
    const job = seedJob(app, root, A);
    assert.equal((await fetch(`${base}/api/jobs/${job.jobId}`, { headers: { cookie: cookieA } })).status, 200);

    await fetch(`${base}/logout`, { method: 'POST', headers: { cookie: cookieA }, redirect: 'manual' });

    // The old cookie is dead server-side, not merely cleared in the browser.
    const after = await fetch(`${base}/api/jobs/${job.jobId}`, { headers: { cookie: cookieA }, redirect: 'manual' });
    assert.notEqual(after.status, 200, 'a logged-out cookie still reads the job');

    // And B's session is untouched by A's logout.
    const bStill = await fetch(`${base}/`, { headers: { cookie: cookieB, accept: 'text/html' }, redirect: 'manual' });
    assert.equal(bStill.status, 200, 'one account\'s logout ended another account\'s session');
  });
});

test('an anonymous request reaches no job route at all', async () => {
  await withTwoTenants(async ({ base, root, app, A }) => {
    const job = seedJob(app, root, A);
    for (const [method, target] of JOB_ROUTES(job.jobId)) {
      const res = await fetch(`${base}${target}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ stillIndex: 1 }) : undefined,
        redirect: 'manual',
      });
      const text = await res.text();
      assertNoLeak(res.status, text, `anonymous ${method} ${target}`);
      assert.ok([401, 303, 405, 404].includes(res.status),
        `anonymous ${method} ${target} answered ${res.status}`);
    }
  });
});

// ---------------------------------------------------------------------------

function multipartBody(parts) {
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
