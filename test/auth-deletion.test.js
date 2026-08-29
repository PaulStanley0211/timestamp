/**
 * Account deletion, below the web layer. The build against
 * docs/superpowers/specs/2026-08-29-account-deletion-export-design.md §1.
 *
 * WHAT IS FAKE AND WHAT IS NOT. Everything local is real: `accounts.mjs`,
 * `session.mjs` and `render/job.mjs` run against a temporary root, because the
 * subject is whether a person's data is actually gone from disk, and a fake
 * account store would only prove the fake deletes correctly. The two seams are
 * the Supabase client (an object recording calls -- the wire shape is pinned in
 * test/auth-supabase.test.js) and `isClaimed` (the queue's answer, a plain
 * function here for the same reason `sweepRetention` takes a `skip` set: the
 * lease fact belongs to the caller).
 *
 * THE ONE RULE THIS FILE EXISTS TO HOLD: the free-tape register is UNTOUCHED by
 * deletion. Its ceiling counts grants across every account that has EVER
 * existed (config/credits.json says so in capitals), so create-delete-create
 * must burn the ceiling twice rather than farm the grant.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAccount,
  deleteAccount,
  emailHash,
  findAccountByEmail,
  findAccountBySupabaseId,
  freeTapePaths,
  freeTapeState,
  loadAccount,
  accountPaths,
} from '../scripts/auth/accounts.mjs';
import { createSession, destroySessionsForAccount, listSessions } from '../scripts/auth/session.mjs';
import { createJob, jobPaths, saveJob } from '../scripts/render/job.mjs';
import { deleteAccountEverywhere } from '../scripts/auth/deletion.mjs';

const CFG = JSON.parse(fs.readFileSync(new URL('../config/render.json', import.meta.url), 'utf8'));

/** The flat auth surface the web layer's `api()` hands over -- the three
 *  functions the orchestrator is specified to feature-detect. Real modules. */
const api = { loadAccount, deleteAccount, destroySessionsForAccount };

const T0 = '2026-08-29T12:00:00.000Z';
const clock = () => new Date(T0);

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-deletion-')).replace(/\\/g, '/');
  t.after(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* the OS will get it */ }
  });
  return root;
}

/** A signup as `identity.mjs` would perform it, with an explicit ceiling so a
 *  test states the number instead of creating a hundred accounts. A password
 *  of `null` is only legal alongside a supabase id (accounts.mjs treats that
 *  pair as "identity lives upstream"), so an id-less signup gets a password. */
function signUp(root, { email, supabaseUserId = null, password, plan = 'free', ceiling = 100 } = {}) {
  const pw = password !== undefined ? password : (supabaseUserId ? null : 'a long enough password');
  return createAccount({
    root, email, password: pw, plan, supabaseUserId, ceiling, nowImpl: clock,
    consent: { granted: true, text: 'I am in this photo and I agree.' },
  });
}

const emailIndexPath = (root, email) => `${root}/out/accounts/_index/${emailHash(email)}.json`;
const supabaseIndexPath = (root, id) => `${root}/out/accounts/_index-supabase/${id}`;

// ---------------------------------------------------------------------------
// deleteAccount -- the local record, both index entries, the directory
// ---------------------------------------------------------------------------

test('deleteAccount removes the record, both index entries, and the directory -- and only for that account', async (t) => {
  const root = makeRoot(t);
  const gone = await signUp(root, { email: 'gone@example.com', supabaseUserId: 'uuid-gone-1' });
  const stays = await signUp(root, { email: 'stays@example.com', supabaseUserId: 'uuid-stays-1' });

  // Presence first: an assertion about absence proves nothing against an
  // empty directory.
  assert.ok(fs.existsSync(accountPaths(root, gone.accountId).record), 'the record was never written');
  assert.ok(fs.existsSync(emailIndexPath(root, 'gone@example.com')), 'the email index entry was never written');
  assert.ok(fs.existsSync(supabaseIndexPath(root, 'uuid-gone-1')), 'the supabase index entry was never written');

  const result = deleteAccount({ root, accountId: gone.accountId });
  assert.equal(result.accountId, gone.accountId);
  assert.equal(result.email, 'gone@example.com');

  assert.equal(fs.existsSync(accountPaths(root, gone.accountId).dir), false, 'the account directory survived');
  assert.equal(fs.existsSync(emailIndexPath(root, 'gone@example.com')), false, 'the email index entry survived');
  assert.equal(fs.existsSync(supabaseIndexPath(root, 'uuid-gone-1')), false, 'the supabase index entry survived');
  assert.throws(() => loadAccount({ root, accountId: gone.accountId }), (err) => err.code === 'NO_ACCOUNT');
  assert.equal(findAccountByEmail({ root, email: 'gone@example.com' }), null);
  assert.equal(findAccountBySupabaseId({ root, supabaseUserId: 'uuid-gone-1' }), null);

  // The neighbour is untouched, index entries included.
  assert.equal(findAccountByEmail({ root, email: 'stays@example.com' })?.accountId, stays.accountId);
  assert.equal(findAccountBySupabaseId({ root, supabaseUserId: 'uuid-stays-1' })?.accountId, stays.accountId);
});

test('deleteAccount leaves the free-tape register byte-identical', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { email: 'a@example.com' });
  const register = freeTapePaths(root).record;
  assert.ok(fs.existsSync(register), 'a free signup must have written the register');
  const before = fs.readFileSync(register, 'utf8');

  deleteAccount({ root, accountId: account.accountId });

  assert.equal(fs.readFileSync(register, 'utf8'), before,
    'deletion touched the free-tape register -- create-delete-create can now farm the grant');
});

test('create-delete-create burns the ceiling twice: the second account is NEW and its grant still counts', async (t) => {
  const root = makeRoot(t);
  const first = await signUp(root, { email: 'again@example.com', supabaseUserId: 'uuid-first' });
  assert.equal(freeTapeState({ root, ceiling: 100 }).granted, 1);

  deleteAccount({ root, accountId: first.accountId });

  const second = await signUp(root, { email: 'again@example.com', supabaseUserId: 'uuid-second' });
  assert.notEqual(second.accountId, first.accountId, 'the address was reused but the account must be new');
  assert.equal(second.supabaseUserId, 'uuid-second', 'nothing may rebind the new identity to old state');
  assert.equal(freeTapeState({ root, ceiling: 100 }).granted, 2,
    'the register must count both grants -- a decrement on delete is the farming hole');
});

test('deleteAccount on a missing account throws NO_ACCOUNT rather than reporting a deletion that never happened', (t) => {
  const root = makeRoot(t);
  assert.throws(
    () => deleteAccount({ root, accountId: 'f'.repeat(32) }),
    (err) => err.code === 'NO_ACCOUNT',
  );
});

// ---------------------------------------------------------------------------
// deleteAccountEverywhere -- the whole spec §1 order
// ---------------------------------------------------------------------------

/** A job the account owns, with a face file where the purge looks for one. */
function seedOwnedJob(root, accountId) {
  const job = createJob({
    root,
    input: {
      photo: { path: 'input/upload-photo', sha256: 'x'.repeat(64) },
      place: { kind: 'text', value: 'a beach' },
      outfit: { kind: 'text', value: 'a t-shirt' },
      stillCount: 3,
      consent: { granted: true, at: T0, text: 'the wording' },
    },
    provider: 'fixture',
    cfg: CFG,
  });
  saveJob(job);
  const paths = jobPaths(root, job.jobId);
  fs.mkdirSync(paths.input, { recursive: true });
  fs.writeFileSync(`${paths.input}/upload-photo`, 'face-bytes');
  fs.mkdirSync(`${root}/out/owners/${accountId}`, { recursive: true });
  fs.writeFileSync(`${root}/out/owners/${accountId}/${job.jobId}.json`, JSON.stringify({
    jobId: job.jobId, accountId, at: T0, resolution: '480p', credits: 51,
  }));
  return job;
}

/** A refund reconciliation record as the worker seam writes them. */
function seedRefundRecord(root, { jobId, accountId, settled = null, credits = 51 }) {
  fs.mkdirSync(`${root}/out/refunds`, { recursive: true });
  fs.writeFileSync(`${root}/out/refunds/${jobId}.json`, JSON.stringify({
    jobId, accountId, reason: 'refund:worker-failed', kind: 'error',
    credits, error: { code: 'X', message: 'x' }, at: T0, settled,
  }));
}

function fakeSupabase(recordPath) {
  const calls = [];
  return {
    calls,
    async adminDeleteUser({ supabaseUserId }) {
      calls.push({
        supabaseUserId,
        // The order proof: was the local record still on disk when the
        // upstream half ran? Spec §1 says it must be -- upstream FIRST.
        accountStillOnDisk: recordPath ? fs.existsSync(recordPath) : null,
      });
      return { ok: true, missing: false };
    },
  };
}

test('deleteAccountEverywhere: upstream first, then jobs, owners, sessions, account -- and the report says what went', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { email: 'whole@example.com', supabaseUserId: 'uuid-whole-1' });
  const other = await signUp(root, { email: 'other@example.com', supabaseUserId: 'uuid-other-1' });

  const job1 = seedOwnedJob(root, account.accountId);
  const job2 = seedOwnedJob(root, account.accountId);
  seedRefundRecord(root, { jobId: job1.jobId, accountId: account.accountId, settled: null });
  seedRefundRecord(root, { jobId: job2.jobId, accountId: account.accountId, settled: { at: T0, credits: 51 } });
  createSession({ root, accountId: account.accountId });
  createSession({ root, accountId: account.accountId });
  createSession({ root, accountId: other.accountId });

  const supabase = fakeSupabase(accountPaths(root, account.accountId).record);

  // Presence first.
  assert.ok(fs.existsSync(jobPaths(root, job1.jobId).dir));
  assert.ok(fs.existsSync(`${root}/out/owners/${account.accountId}`));

  const result = await deleteAccountEverywhere({
    root, accountId: account.accountId, api, supabase, isClaimed: () => false,
  });

  assert.equal(supabase.calls.length, 1, 'exactly one upstream deletion');
  assert.equal(supabase.calls[0].supabaseUserId, 'uuid-whole-1');
  assert.equal(supabase.calls[0].accountStillOnDisk, true,
    'the upstream half must run FIRST -- a local-first order recreates the rebind trap on crash');

  assert.equal(fs.existsSync(jobPaths(root, job1.jobId).dir), false, 'job 1 survived');
  assert.equal(fs.existsSync(jobPaths(root, job2.jobId).dir), false, 'job 2 survived');
  assert.equal(fs.existsSync(`${root}/out/owners/${account.accountId}`), false, 'the ownership index survived');
  assert.throws(() => loadAccount({ root, accountId: account.accountId }), (err) => err.code === 'NO_ACCOUNT');

  const remaining = listSessions({ root });
  assert.equal(remaining.some((s) => s.accountId === account.accountId), false, 'a session survived deletion');
  assert.equal(remaining.some((s) => s.accountId === other.accountId), true, 'the neighbour lost a session');

  assert.equal(result.jobsDeleted, 2);
  assert.equal(result.sessionsDestroyed, 2);
  assert.deepEqual(result.supabase, { deleted: true, missing: false });
  assert.deepEqual(result.pendingRefunds.map((r) => r.jobId), [job1.jobId],
    'the settled refund is audit trail; only the PENDING one represents money the operator must resolve');
  assert.ok(fs.existsSync(`${root}/out/refunds/${job1.jobId}.json`),
    'refund records are kept -- pending ones ARE money and must not vanish with the account');
  assert.deepEqual(result.errors, []);
});

test('a live lease refuses the WHOLE deletion and deletes nothing, upstream included', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { email: 'leased@example.com', supabaseUserId: 'uuid-leased-1' });
  const idle = seedOwnedJob(root, account.accountId);
  const rendering = seedOwnedJob(root, account.accountId);
  createSession({ root, accountId: account.accountId });
  const supabase = fakeSupabase(null);

  await assert.rejects(
    () => deleteAccountEverywhere({
      root, accountId: account.accountId, api, supabase,
      isClaimed: (jobId) => jobId === rendering.jobId,
    }),
    (err) => {
      assert.equal(err.code, 'JOB_CLAIMED');
      assert.deepEqual(err.jobIds, [rendering.jobId], 'the refusal must name the rendering tape');
      return true;
    },
  );

  assert.equal(supabase.calls.length, 0, 'a refused deletion must not have deleted the upstream identity');
  assert.ok(loadAccount({ root, accountId: account.accountId }), 'the account must survive a refusal');
  assert.ok(fs.existsSync(jobPaths(root, idle.jobId).dir), 'the idle job was deleted by a refused deletion');
  assert.ok(fs.existsSync(jobPaths(root, rendering.jobId).dir));
  assert.equal(listSessions({ root }).some((s) => s.accountId === account.accountId), true,
    'a refused deletion must not sign the person out');
});

test('with no isClaimed answer the deletion fails closed, like the careless call being the safe one everywhere else', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { email: 'closed@example.com', supabaseUserId: 'uuid-closed-1' });
  seedOwnedJob(root, account.accountId);
  const supabase = fakeSupabase(null);

  await assert.rejects(
    () => deleteAccountEverywhere({ root, accountId: account.accountId, api, supabase }),
    (err) => err.code === 'JOB_CLAIMED',
  );
  assert.equal(supabase.calls.length, 0);
  assert.ok(loadAccount({ root, accountId: account.accountId }));
});

test('an account with no upstream identity deletes locally and never asks Supabase', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { email: 'local@example.com' });
  const supabase = fakeSupabase(null);

  const result = await deleteAccountEverywhere({
    root, accountId: account.accountId, api, supabase,
    isClaimed: () => { throw new Error('no jobs exist, so the queue must not be asked'); },
  });

  assert.equal(supabase.calls.length, 0);
  assert.deepEqual(result.supabase, { skipped: 'no-supabase-user' });
  assert.throws(() => loadAccount({ root, accountId: account.accountId }), (err) => err.code === 'NO_ACCOUNT');
});

test('an upstream refusal aborts before any local deletion', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { email: 'refused@example.com', supabaseUserId: 'uuid-refused-1' });
  const job = seedOwnedJob(root, account.accountId);
  createSession({ root, accountId: account.accountId });

  await assert.rejects(
    () => deleteAccountEverywhere({
      root, accountId: account.accountId, api, isClaimed: () => false,
      supabase: { async adminDeleteUser() { throw new Error('/admin/users 500'); } },
    }),
    /admin\/users 500/,
  );

  assert.ok(loadAccount({ root, accountId: account.accountId }), 'local deletion ran beside a live upstream identity');
  assert.ok(fs.existsSync(jobPaths(root, job.jobId).dir));
  assert.equal(listSessions({ root }).some((s) => s.accountId === account.accountId), true);
});

test('an account WITH an upstream identity refuses to delete when no Supabase client is configured', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { email: 'nosb@example.com', supabaseUserId: 'uuid-nosb-1' });

  await assert.rejects(
    () => deleteAccountEverywhere({ root, accountId: account.accountId, api, supabase: null, isClaimed: () => false }),
    (err) => err.code === 'IDENTITY_UNAVAILABLE',
  );
  assert.ok(loadAccount({ root, accountId: account.accountId }),
    'a deletion that silently skips the upstream half is worse than one that says not right now');
});
