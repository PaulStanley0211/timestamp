/**
 * The account page, the data export, and account deletion over HTTP -- the web
 * half of docs/superpowers/specs/2026-08-29-account-deletion-export-design.md
 * (§2 export, §3 the page, §4 routes and gates).
 *
 * WHAT IS FAKE AND WHAT IS NOT. The harness is `web-auth-code.test.js`'s,
 * imported as its fourth sibling: only the Supabase HTTPS transport is faked,
 * and `accounts.mjs`, `session.mjs`, `render/job.mjs` and the ownership index
 * are the real modules against a temporary root -- the subject is whether a
 * person's data is actually gone and whether their export actually carries
 * their ledger, and a fake store proves neither. The queue is the web-api
 * fake, because the one 409 in this file is the queue's lease speaking.
 *
 * THE TWO SENTENCES THIS FILE EXISTS TO HOLD. A deletion must be impossible to
 * cause from another site or without typing the account's own address (§4's
 * gate table); and an export must never ship the scrypt hash -- the export is
 * the one route that serialises the account record at a stranger's request,
 * and `JSON.stringify(account)` would ship `password` and look perfectly
 * correct doing it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { startWithFakeSupabase, postForm, getPage } from './web-auth-code.test.js';
import { createAccount, loadAccount, accountPaths, findAccountByEmail } from '../scripts/auth/accounts.mjs';
import { listSessions } from '../scripts/auth/session.mjs';
import { resolveIdentity } from '../scripts/auth/identity.mjs';
import { recordMissedRefund } from '../scripts/web/session-middleware.mjs';
import { createJob, jobPaths, saveJob, setJobStatus, completeJob } from '../scripts/render/job.mjs';

const CFG = JSON.parse(fs.readFileSync(new URL('../config/render.json', import.meta.url), 'utf8'));

const EMAIL = 'me@example.com';
const SB_ID = 'uuid-account-page-1';
const PASSWORD = 'a long enough password';

/** The web-api lease fake: `holdLease` is a worker pretending to render. */
function leaseQueue() {
  let claimed = [];
  const enqueued = [];
  return {
    holdLease(jobId, { expired = false } = {}) {
      claimed = [{ jobId, workerId: 'w1', claimedAt: new Date().toISOString(), expired }];
    },
    releaseAll() { claimed = []; },
    enqueue(jobId) { enqueued.push(jobId); },
    peek({ state = 'pending' } = {}) { return state === 'claimed' ? claimed : enqueued.map((jobId) => ({ jobId })); },
    stats() { return { pending: enqueued.length, claimed: claimed.length, done: 0, failed: 0 }; },
  };
}

/**
 * The harness plus a REAL signed-in account: created through `createAccount`
 * (so the scrypt hash and the free grant are genuinely on disk) and a session
 * minted through the server's own `startSession`, the `web-billing` pattern --
 * deletion must destroy real session records, so a fake would prove nothing.
 */
async function startSignedIn(t, { queue = leaseQueue(), supabaseUserId = SB_ID, ...opts } = {}) {
  const s = await startWithFakeSupabase(t, { queue, ...opts });
  const account = await createAccount({
    root: s.root, email: EMAIL, password: PASSWORD, plan: 'free', supabaseUserId, ceiling: 100,
    consent: { granted: true, text: 'I am in this photo and I agree.' },
  });
  const setCookie = await s.app.sessions.startSession({ headers: {}, socket: {} }, account.accountId);
  const sessionPair = setCookie.split(';')[0];
  return { ...s, queue, account, sessionPair, cookie: `${sessionPair}; ${s.cookie}` };
}

/** A finished job on the shelf, owned through the server's own index writer. */
function seedOwnedJob(s, { place = 'a beach', outfit = 'a t-shirt', status = 'done' } = {}) {
  const job = createJob({
    root: s.root,
    input: {
      photo: { path: 'input/upload-photo', sha256: 'x'.repeat(64) },
      place: { kind: 'text', value: place },
      outfit: { kind: 'text', value: outfit },
      stillCount: 3,
      consent: { granted: true, at: new Date().toISOString(), text: 'the wording' },
    },
    provider: 'fixture',
    cfg: CFG,
  });
  if (status !== 'queued') {
    setJobStatus(job, 'running');
    if (status === 'done') completeJob(job, { videoPath: 'timestamp.mp4' });
  }
  saveJob(job);
  const paths = jobPaths(s.root, job.jobId);
  fs.mkdirSync(paths.input, { recursive: true });
  fs.writeFileSync(`${paths.input}/upload-photo`, 'face-bytes');
  s.app.sessions.claimJob({
    accountId: s.account.accountId, jobId: job.jobId,
    at: new Date().toISOString(), resolution: '480p', credits: 51,
  });
  return job;
}

const adminCalls = (s) => s.calls.filter((c) => c.pathname.startsWith('/auth/v1/admin/users/'));

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

test('GET /account shows the signed-in email, the export link, and a deletion form that demands the typed address', async (t) => {
  const s = await startSignedIn(t);
  const res = await getPage(`${s.base}/account`, s.cookie);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes(EMAIL), 'the page must say whose account this is');
  assert.ok(html.includes('href="/api/account/export"'), 'the export link is the Art. 20 half of the page');
  assert.match(html, /action="\/account\/delete"/, 'the deletion form is the Art. 17 half');
  assert.match(html, /name="confirm"/, 'a one-way door gets a typed confirmation, not a checkbox');
  assert.match(html, /name="csrf" value="/, 'the deletion form must carry the anti-forgery pair');
});

test('the signed-in nav gains an Account link; the signed-out nav does not', async (t) => {
  const s = await startSignedIn(t);
  const signedIn = await (await getPage(`${s.base}/`, s.cookie)).text();
  assert.ok(signedIn.includes('href="/account"'), 'the nav must lead to the account page');
  const signedOut = await (await getPage(`${s.base}/login`)).text();
  assert.ok(!signedOut.includes('href="/account"'), 'a stranger has no account to link to');
});

test('GET /account works without a Supabase client -- only deletion needs the upstream half', async (t) => {
  const s = await startSignedIn(t, { withSupabase: false });
  const res = await getPage(`${s.base}/account`, s.cookie);
  assert.equal(res.status, 200);
});

// ---------------------------------------------------------------------------
// the export
// ---------------------------------------------------------------------------

test('the export carries the account, the ledger rows, and per-job metadata -- and never the scrypt hash', async (t) => {
  const s = await startSignedIn(t);
  const job = seedOwnedJob(s, { place: 'my grandmother s kitchen', outfit: 'a green anorak' });

  const res = await fetch(`${s.base}/api/account/export`, {
    headers: { cookie: s.cookie, accept: 'application/json' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="timestamp-export.json"');
  const text = await res.text();
  const doc = JSON.parse(text);

  assert.equal(doc.account.email, EMAIL);
  assert.equal(doc.account.accountId, s.account.accountId);
  assert.equal(doc.account.plan, 'free');
  assert.ok(doc.account.createdAt, 'the record\'s own timestamps belong to the person');

  assert.ok(Array.isArray(doc.ledger) && doc.ledger.length >= 1, 'the free grant is a ledger row and must ship');
  assert.ok(doc.ledger.every((row) => typeof row.delta === 'number' && typeof row.reason === 'string'));
  assert.ok(doc.ledger.some((row) => typeof row.balance === 'number'), 'rows carry the running balance, ledgerFor\'s shape');

  assert.equal(doc.jobs.length, 1);
  const exported = doc.jobs[0];
  assert.equal(exported.jobId, job.jobId);
  assert.equal(exported.place, 'my grandmother s kitchen');
  assert.equal(exported.outfit, 'a green anorak');
  assert.equal(exported.status, 'done');
  assert.equal(exported.resolution, '480p');
  assert.equal(exported.credits, 51);
  assert.ok(exported.createdAt);

  // The one sentence this file exists to hold, in its strongest form: the
  // whole response body, not a field, because a rename would pass a field
  // check and still ship the hash.
  assert.ok(!text.includes('scrypt'), 'the scrypt hash reached the export');
  assert.equal(doc.account.password, undefined);
  assert.equal(doc.account.rev, undefined, 'rev is an internal optimistic-concurrency counter, not the person\'s data');
  assert.equal(doc.account.emailHash, undefined, 'the index filename stem is internal');
});

test('the export is gated: no session, no document', async (t) => {
  const s = await startSignedIn(t);
  const res = await fetch(`${s.base}/api/account/export`, { headers: { accept: 'application/json' } });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, 'NOT_SIGNED_IN');
});

// ---------------------------------------------------------------------------
// deletion -- the refusals, each proving nothing was deleted
// ---------------------------------------------------------------------------

/** The account, its jobs, and its session are all still standing. */
async function assertNothingDeleted(s, jobs = []) {
  assert.ok(loadAccount({ root: s.root, accountId: s.account.accountId }), 'the account was deleted by a refusal');
  for (const job of jobs) {
    assert.ok(fs.existsSync(jobPaths(s.root, job.jobId).dir), `job ${job.jobId} was deleted by a refusal`);
  }
  assert.equal(adminCalls(s).length, 0, 'a refusal must not have deleted the upstream identity');
  const still = await getPage(`${s.base}/account`, s.cookie);
  assert.equal(still.status, 200, 'a refusal must not sign the person out');
}

test('a foreign-origin post cannot delete an account', async (t) => {
  const s = await startSignedIn(t);
  const job = seedOwnedJob(s);
  const res = await postForm(`${s.base}/account/delete`, { confirm: EMAIL, csrf: s.csrf }, s.cookie, {
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(res.status, 403);
  await assertNothingDeleted(s, [job]);
});

test('a post without the anti-forgery pair cannot delete an account', async (t) => {
  const s = await startSignedIn(t);
  const res = await postForm(`${s.base}/account/delete`, { confirm: EMAIL, csrf: 'not-the-token' }, s.cookie);
  assert.equal(res.status, 403);
  await assertNothingDeleted(s);
});

test('deletion is refused without the typed address, and a wrong address is a refusal, not a near-miss', async (t) => {
  const s = await startSignedIn(t);
  for (const confirm of [undefined, '', 'someone-else@example.com']) {
    const fields = confirm === undefined ? { csrf: s.csrf } : { confirm, csrf: s.csrf };
    const res = await postForm(`${s.base}/account/delete`, fields, s.cookie);
    assert.equal(res.status, 400, `${JSON.stringify(confirm ?? null)} must be refused`);
    const html = await res.text();
    assert.match(html, /name="confirm"/, 'the refusal re-renders the form so the person can retype');
  }
  await assertNothingDeleted(s);
});

test('a live lease refuses the whole deletion with 409 -- minutes of delay, not a denial', async (t) => {
  const s = await startSignedIn(t);
  const idle = seedOwnedJob(s);
  const rendering = seedOwnedJob(s, { status: 'queued' });
  s.queue.holdLease(rendering.jobId);

  const res = await postForm(`${s.base}/account/delete`, { confirm: EMAIL, csrf: s.csrf }, s.cookie);
  assert.equal(res.status, 409);
  assert.match(await res.text(), /rendering/i, 'the page must say a tape is still rendering');
  await assertNothingDeleted(s, [idle, rendering]);
});

test('an expired lease is not a claim, exactly as DELETE /api/jobs/:id already rules', async (t) => {
  const s = await startSignedIn(t);
  const job = seedOwnedJob(s, { status: 'queued' });
  s.queue.holdLease(job.jobId, { expired: true });

  const res = await postForm(`${s.base}/account/delete`, { confirm: EMAIL, csrf: s.csrf }, s.cookie);
  assert.equal(res.status, 303, 'a dead worker must not hold an account hostage');
});

test('with no Supabase client, deletion answers 503 like the other identity routes', async (t) => {
  const s = await startSignedIn(t, { withSupabase: false });
  const res = await postForm(`${s.base}/account/delete`, { confirm: EMAIL, csrf: s.csrf }, s.cookie, {
    accept: 'application/json',
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error.code, 'IDENTITY_UNAVAILABLE',
    'a deletion that silently skips the upstream half is worse than one that says not right now');
  assert.ok(loadAccount({ root: s.root, accountId: s.account.accountId }));
});

// ---------------------------------------------------------------------------
// deletion -- the one-way door, opened properly
// ---------------------------------------------------------------------------

test('a confirmed deletion removes the upstream identity FIRST, then everything local, and kills the session cookie', async (t) => {
  const s = await startSignedIn(t);
  const job1 = seedOwnedJob(s);
  const job2 = seedOwnedJob(s, { status: 'queued' });
  // Seeded through the REAL writer, so this test also pins that deletion and
  // the web layer agree on where reconciliation records live.
  recordMissedRefund({
    root: s.root, jobId: job1.jobId, accountId: s.account.accountId,
    reason: 'refund:worker-failed', credits: 51, error: { code: 'X', message: 'x' },
  });

  // Presence first.
  assert.ok(fs.existsSync(jobPaths(s.root, job1.jobId).dir));
  assert.ok(fs.existsSync(`${s.root}/out/owners/${s.account.accountId}`));

  const res = await postForm(`${s.base}/account/delete`, { confirm: EMAIL, csrf: s.csrf }, s.cookie);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/', 'nothing identifying is left to redirect to');
  const cleared = res.headers.getSetCookie().find((c) => c.startsWith('timestamp_session='));
  assert.ok(cleared && /Max-Age=0/i.test(cleared), 'the session cookie must die with the account');

  const admin = adminCalls(s);
  assert.equal(admin.length, 1, 'exactly one upstream deletion');
  assert.equal(admin[0].method, 'DELETE');
  assert.equal(admin[0].pathname, `/auth/v1/admin/users/${SB_ID}`);
  assert.equal(admin[0].headers.apikey, 'sb_secret_test', 'admin endpoints only answer to the secret key');

  assert.equal(fs.existsSync(jobPaths(s.root, job1.jobId).dir), false, 'a job survived');
  assert.equal(fs.existsSync(jobPaths(s.root, job2.jobId).dir), false, 'a job survived');
  assert.equal(fs.existsSync(`${s.root}/out/owners/${s.account.accountId}`), false, 'the ownership index survived');
  assert.throws(() => loadAccount({ root: s.root, accountId: s.account.accountId }), (err) => err.code === 'NO_ACCOUNT');
  assert.equal(listSessions({ root: s.root }).some((x) => x.accountId === s.account.accountId), false,
    'a session record survived');
  assert.ok(fs.existsSync(`${s.root}/out/refunds/${job1.jobId}.json`),
    'the pending refund is money the operator must resolve; it must not vanish with the account');

  // The dead cookie: an API caller gets the 401, a browser gets the login door.
  const api = await fetch(`${s.base}/account`, { headers: { cookie: s.cookie, accept: 'application/json' } });
  assert.equal(api.status, 401);
  assert.equal((await api.json()).error.code, 'NOT_SIGNED_IN');
  const page = await getPage(`${s.base}/account`, s.cookie);
  assert.equal(page.status, 303);
  assert.match(page.headers.get('location'), /^\/login/);
});

test('the typed address is the system\'s idea of the address: case and padding do not block a deletion', async (t) => {
  const s = await startSignedIn(t);
  const res = await postForm(`${s.base}/account/delete`, { confirm: `  ${EMAIL.toUpperCase()}  `, csrf: s.csrf }, s.cookie);
  assert.equal(res.status, 303,
    'ME@EXAMPLE.COM is the same address me@example.com is -- normaliseEmail already says so');
});

test('after deletion, the same address signs up as a NEW account with nothing rebound', async (t) => {
  const s = await startSignedIn(t);
  const oldId = s.account.accountId;
  const res = await postForm(`${s.base}/account/delete`, { confirm: EMAIL, csrf: s.csrf }, s.cookie);
  assert.equal(res.status, 303);

  const { accountId, created } = await resolveIdentity({
    root: s.root,
    identity: { supabaseUserId: 'uuid-second-life', email: EMAIL, emailVerified: true },
    consent: { granted: true, text: 'I am in this photo and I agree.' },
  });
  assert.equal(created, true, 'the address must resolve to a genuinely new account, not a claim of old state');
  assert.notEqual(accountId, oldId);
  assert.equal(findAccountByEmail({ root: s.root, email: EMAIL })?.accountId, accountId);
});
