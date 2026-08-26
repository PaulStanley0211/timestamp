/**
 * The one place a Supabase identity becomes an application account.
 *
 * Above this function is protocol; below it is `accounts.mjs` and the files it
 * already writes. Nothing on either side holds a Supabase token. When the money
 * ledger later moves to Postgres, this function's internals change and no
 * caller does. Spec §1.
 */
import {
  findAccountBySupabaseId, findAccountByEmail, claimAccount, createAccount,
  normaliseEmail, AuthError,
} from './accounts.mjs';

const defaultNow = () => new Date();

export async function resolveIdentity({ root, identity, consent = null, nowImpl = defaultNow }) {
  const { supabaseUserId, email, emailVerified } = identity ?? {};
  if (!supabaseUserId) throw new TypeError('resolveIdentity needs a supabaseUserId');
  const address = normaliseEmail(email);

  // 1. Known identity. The stable key, checked first.
  const known = findAccountBySupabaseId({ root, supabaseUserId, nowImpl });
  if (known) return { accountId: known.accountId, created: false };

  // 2. An account at this address that predates the slice.
  const existing = findAccountByEmail({ root, email: address, nowImpl });
  if (existing) {
    // THE RULE. Without it, an unverified identity for an address inherits the
    // account at that address -- its credits, its plan, its tapes. Spec §4.1.
    if (emailVerified !== true) {
      throw new AuthError('unverified identity may not claim an existing account', {
        userMessage: 'That email and password do not match an account.',
      });
    }
    const claimed = await claimAccount({ root, accountId: existing.accountId, supabaseUserId });
    return { accountId: claimed.accountId, created: false };
  }

  // 3. Genuinely new. `createAccount` issues the free grant; this is the only
  //    branch that reaches it, which is why a claim never grants twice.
  const made = await createAccount({
    root, email: address, password: null, consent, supabaseUserId, nowImpl,
  });
  return { accountId: made.accountId, created: true };
}
