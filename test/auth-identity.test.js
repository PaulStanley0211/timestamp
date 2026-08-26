/**
 * `resolveIdentity` -- the seam where a Supabase identity becomes an
 * application account. Task 5.
 *
 * Two of this file's fixtures deliberately differ from the literal snippet in
 * the task brief, and both differences are load-bearing, not style:
 *
 * 1. `balanceOf(account)` returns `{ credits, grantedAt, expiresAt, planId }`,
 *    never a bare number -- see scripts/auth/credits.mjs, and every other
 *    caller in this repo reads `.credits` off it. `assert.ok(balanceOf(x) > 0)`
 *    would compare an object to a number (`NaN > 0`, always false) and
 *    `assert.equal(balanceOf(a), balanceOf(b))` would compare two distinct
 *    object references with `==` (always false) -- so the brief's literal
 *    calls would fail even against a correct `resolveIdentity`. Both spots
 *    below read `.credits`.
 * 2. `CONSENT` in the brief was `{ agreedAt, text }`. `accounts.mjs`'s
 *    `normaliseConsent` only treats a block as "already recorded" when it
 *    carries a string `.at` (not `.agreedAt`); anything else is routed through
 *    `recordConsent`, which throws unless `.granted === true`. The brief's
 *    shape has neither, so it would throw a ConsentError out of the very
 *    first test's create branch. Fixed here to `{ granted: true, at, text }`,
 *    the shape `test/auth-accounts.test.js` already uses for a pre-recorded
 *    block.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveIdentity } from '../scripts/auth/identity.mjs';
import { createAccount, loadAccount } from '../scripts/auth/accounts.mjs';
import { balanceOf } from '../scripts/auth/credits.mjs';

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ts-ident-'));
const CONSENT = { granted: true, at: '2026-08-26T00:00:00.000Z', text: 'test consent' };

const identity = (over = {}) => ({
  supabaseUserId: 'uuid-a', email: 'new@example.com',
  emailVerified: true, provider: 'email', ...over,
});

test('a brand new identity creates an account and grants once', async () => {
  const root = tmpRoot();
  const first = await resolveIdentity({ root, identity: identity(), consent: CONSENT });
  assert.equal(first.created, true);
  const account = loadAccount({ root, accountId: first.accountId });
  const granted = balanceOf(account).credits;
  assert.ok(granted > 0, 'the free grant fires at first confirmed login');

  const second = await resolveIdentity({ root, identity: identity(), consent: CONSENT });
  assert.equal(second.created, false, 'a second resolve is not a second account');
  assert.equal(second.accountId, first.accountId);
  assert.equal(balanceOf(loadAccount({ root, accountId: first.accountId })).credits, granted,
    'and not a second grant');
});

test('an UNVERIFIED identity may not claim an existing account', async () => {
  const root = tmpRoot();
  await createAccount({ root, email: 'victim@example.com', password: 'correct-horse-battery' });
  await assert.rejects(
    () => resolveIdentity({
      root,
      identity: identity({ email: 'victim@example.com', emailVerified: false, supabaseUserId: 'uuid-attacker' }),
      consent: CONSENT,
    }),
    /verified/i,
    'this is the test that would have caught the takeover',
  );
});

test('a VERIFIED identity claims the existing account and keeps its ledger', async () => {
  const root = tmpRoot();
  const made = await createAccount({ root, email: 'old@example.com', password: 'correct-horse-battery' });
  const before = balanceOf(made).credits;

  const out = await resolveIdentity({
    root,
    identity: identity({ email: 'old@example.com', supabaseUserId: 'uuid-old' }),
    consent: CONSENT,
  });

  assert.equal(out.created, false, 'a claim is not a creation, so no grant fires');
  assert.equal(out.accountId, made.accountId);
  const after = loadAccount({ root, accountId: made.accountId });
  assert.equal(balanceOf(after).credits, before, 'the ledger survives the migration');
  assert.equal(after.supabaseUserId, 'uuid-old');
  assert.equal(after.password, null);
});
