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
  //
  // THE SAME RULE, MOVED HERE (coordinator's ruling, beyond the brief and
  // beyond spec §4.1's literal wording, which only named the claim). An
  // unverified create permanently squats the address: the genuine owner
  // arriving later with a verified identity and a different supabaseUserId
  // hits SUPABASE_ID_TAKEN above, sees a generic message, and has no
  // self-service way out. Every real caller already produces
  // emailVerified: true here -- `supabase-auth.mjs`'s identityFrom() derives
  // it from Supabase's own confirmation fields for all three flows this
  // slice has, and the email-code flow (the only one that reaches THIS
  // branch for a fresh signup) confirms the mailbox in the very call that
  // yields the identity -- so this can only ever fire for a caller that is
  // not one of this slice's own designed flows.
  if (emailVerified !== true) {
    throw new AuthError('an unverified identity may not create an account', {
      userMessage: 'That email and password do not match an account.',
    });
  }
  const made = await createAccount({
    root, email: address, password: null, consent, supabaseUserId, nowImpl,
  });
  return { accountId: made.accountId, created: true };
}
