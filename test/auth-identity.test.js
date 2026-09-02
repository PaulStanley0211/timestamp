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
import {
  accountsRoot, claimAccount, createAccount, findAccountByEmail, listAccounts, loadAccount,
  SUPABASE_INDEX_DIR,
} from '../scripts/auth/accounts.mjs';
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

// Review round 2, finding 1: pin the SUPABASE_ID_TAKEN branch at identity.mjs:35.
// It is correct today because it is unconditional and lets claimAccount's own
// conflict check fire -- but nothing in this file stops a future edit from
// wrapping that call in a try/catch that "helpfully" falls through to
// createAccount on any rejection, which would mint a SECOND account for an
// address already owned, and every existing test above would still pass.
test('an email already bound to a DIFFERENT supabase id is refused, not silently reassigned to a new account', async () => {
  const root = tmpRoot();
  const made = await createAccount({ root, email: 'claimed@example.com', password: 'correct-horse-battery' });
  await claimAccount({ root, accountId: made.accountId, supabaseUserId: 'uuid-one' });

  await assert.rejects(
    () => resolveIdentity({
      root,
      identity: identity({ email: 'claimed@example.com', supabaseUserId: 'uuid-two' }),
      consent: CONSENT,
    }),
    (err) => {
      assert.equal(err.code, 'SUPABASE_ID_TAKEN');
      assert.ok(
        !String(err.userMessage).toLowerCase().includes('claimed@example.com'),
        'the refusal must not name the address -- that is an enumeration oracle',
      );
      return true;
    },
  );

  // No second account exists anywhere, for the address or for uuid-two.
  assert.equal(listAccounts({ root }).length, 1, 'the refusal must not have created a second account');
  assert.equal(findAccountByEmail({ root, email: 'claimed@example.com' }).accountId, made.accountId,
    'the address still resolves to the one real account');
});

// Review round 2, finding 2: pin the SAME-id repair path in the actual crash
// state it exists for -- the account record already carries the incoming id
// (createAccount writes it at creation) but the supabase index entry is
// missing (simulating the gap between createAccount's two index writes).
// Nothing today fails if a future edit adds an early return like
// `if (existing.supabaseUserId === supabaseUserId) return { accountId, created: false }`
// at the top of branch 2 -- that would look like a harmless optimisation and
// would skip the very claimAccount call this repair depends on.
test('re-resolving the same identity after its supabase index entry goes missing repairs the index rather than skipping the repair', async () => {
  const root = tmpRoot();
  const first = await resolveIdentity({ root, identity: identity(), consent: CONSENT });

  // Simulate the crash gap: the record already says 'uuid-a' (createAccount
  // wrote it), but the index file is gone. Pattern from
  // test/auth-accounts.test.js:887 ("a second claim with the same id succeeds
  // and repairs a missing index entry").
  const indexFile = `${accountsRoot(root).dir}/${SUPABASE_INDEX_DIR}/uuid-a`;
  fs.rmSync(indexFile, { force: true });
  assert.equal(fs.existsSync(indexFile), false, 'precondition: the index entry is gone');

  const second = await resolveIdentity({ root, identity: identity(), consent: CONSENT });
  assert.equal(second.created, false, 'a repair is not a second account');
  assert.equal(second.accountId, first.accountId);
  assert.equal(fs.existsSync(indexFile), true, 'the missing index entry must be restored');
  assert.equal(fs.readFileSync(indexFile, 'utf8').trim(), first.accountId);
});

// Coordinator's ruling: the create branch must also require
// emailVerified === true. An unverified create would permanently squat the
// address -- the genuine owner arriving later with a verified identity and a
// different supabaseUserId would hit SUPABASE_ID_TAKEN with no self-service
// way out. Verified against the real callers before this test was written:
// scripts/auth/supabase-auth.mjs's identityFrom() derives emailVerified from
// Supabase's own email_confirmed_at/confirmed_at for all three flows this
// slice has (email-code verification, password sign-in, Google's PKCE
// exchange), so no designed flow ever reaches this branch unverified.
test('an UNVERIFIED identity for an address with no existing account creates nothing and grants nothing', async () => {
  const root = tmpRoot();
  await assert.rejects(
    () => resolveIdentity({
      root,
      identity: identity({ email: 'nobody@example.com', emailVerified: false, supabaseUserId: 'uuid-nobody' }),
      consent: CONSENT,
    }),
    /verified/i,
  );
  assert.equal(listAccounts({ root }).length, 0, 'nothing was created for an unverified identity');
  assert.equal(findAccountByEmail({ root, email: 'nobody@example.com' }), null);
});
