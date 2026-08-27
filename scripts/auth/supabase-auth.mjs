/**
 * Every HTTP call this app makes to Supabase Auth, and the only place that
 * knows what Supabase's replies look like.
 *
 * WHY `fetchImpl` HAS NO DEFAULT. Same guard as `providers/fal.mjs` and
 * `billing/stripe.mjs`: a test that forgets to inject a transport must get a
 * TypeError rather than a live request against a real project. CLAUDE.md
 * records what happened the one time production forgot to inject -- the guard
 * fired in production and read like a test bug. `server-cli.mjs` is the only
 * caller that hands over a real transport.
 *
 * WHY EVERY FAILURE LEAVES HERE AS ONE SENTENCE. Supabase answers
 * `invalid_credentials`, `email_not_confirmed` and `over_request_rate_limit`
 * distinguishably. Rendering `email_not_confirmed` tells a stranger the address
 * they typed has an account on a service that stores photographs of people's
 * faces. The upstream words are logged and never returned. Spec §4.3.
 */
import { requireFetchImpl } from '../providers/contract.mjs';
import { BAD_CREDENTIALS_MESSAGE } from './accounts.mjs';

export class SupabaseAuthError extends Error {
  constructor(detail, { status = 0, code = '' } = {}) {
    super(detail);
    this.name = 'SupabaseAuthError';
    this.status = status;
    this.code = code;
    /** The ONLY thing a page may render. */
    this.userMessage = BAD_CREDENTIALS_MESSAGE;
  }
}

export function createSupabaseAuth({ url, publishableKey, secretKey, fetchImpl, logImpl = () => {} }) {
  const doFetch = requireFetchImpl({ fetchImpl }, { provider: 'supabase' });
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new TypeError('createSupabaseAuth needs an https url');
  }
  const base = url.replace(/\/+$/, '');

  // The secret key is used for the calls that carry Sb-Forwarded-For, which
  // Supabase only honours for an elevated key. Spec §5.
  async function call(path, { method = 'POST', body = null, accessToken = null, clientIp = null } = {}) {
    const key = clientIp ? secretKey : publishableKey;
    const headers = { apikey: key, 'Content-Type': 'application/json' };
    headers.Authorization = `Bearer ${accessToken ?? key}`;
    if (clientIp) headers['Sb-Forwarded-For'] = clientIp;
    const res = await doFetch(`${base}/auth/v1${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    let payload = null;
    try { payload = await res.json(); } catch { payload = null; }
    if (!res.ok) {
      const code = payload?.error_code ?? payload?.error ?? '';
      logImpl(`[supabase] ${path} ${res.status} ${code}`);
      throw new SupabaseAuthError(`${path} ${res.status} ${code}`, { status: res.status, code });
    }
    return payload ?? {};
  }

  const identityFrom = (payload, provider) => {
    const user = payload?.user ?? payload;
    if (!user?.id) throw new SupabaseAuthError('no user in reply');
    return {
      supabaseUserId: user.id,
      email: String(user.email ?? '').trim().toLowerCase(),
      // NEVER read `user_metadata` (or any field derived from it) here.
      // Whole-branch review finding 3: `user_metadata` is `raw_user_meta_data`
      // -- populated from the `data` field on signup and from `PUT /user` --
      // so it is WRITABLE BY THE ACCOUNT ITSELF, and Supabase's own docs say
      // it must not be used for authorization decisions. `emailVerified ===
      // true` is the whole of spec §4.1 and the account-takeover guards this
      // whole slice rests on (`identity.mjs:30` and `:54`); a caller that can
      // set `user_metadata.email_verified: true` at signup would be able to
      // talk this app into treating an unconfirmed address as verified. The
      // two remaining branches already cover every flow this slice has,
      // Google included -- Supabase sets `email_confirmed_at` on an OAuth
      // identity too.
      emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
      provider,
      accessToken: payload?.access_token ?? null,
    };
  };

  return {
    /** Returns `{ pending: true }` -- with confirmation on there is no session
     *  and no identity to resolve yet. Spec §3. */
    async signUp({ email, password, clientIp = null }) {
      await call('/signup', { body: { email, password }, clientIp });
      return { pending: true };
    },

    /**
     * "Send me a new code."
     *
     * WHY THIS EXISTS RATHER THAN A SECOND `signUp`. Supabase also re-sends a
     * confirmation when signup is repeated for an unconfirmed user, but that
     * needs the password, which this service deliberately keeps nowhere -- and
     * the behaviour has never been observed against the live project. Relying
     * on it meant somebody whose first code never arrived could loop /verify
     * -> /signup -> /verify with no way out. `/resend` is the documented
     * endpoint, needs no password, and removes the guess.
     *
     * Answers the same way for a known and an unknown address, by contract --
     * the same enumeration defence as `sendRecovery`. Logged like `revoke`'s
     * refusal rather than swallowed silently: a resend that fails leaves no
     * other trace anywhere, because the page cannot say so either.
     */
    async resendSignupCode({ email, clientIp = null }) {
      // STILL NEVER THROWS -- the contract the caller relies on is unchanged,
      // and `ok` is still unconditionally true so no branch upstream can start
      // treating one address differently from another.
      //
      // `mailerBroken` is the one thing added, and it is ONE BIT ON PURPOSE.
      // Returning the raw status was tried first and is wrong: `user_not_found`
      // (400) and `user_already_exists` (422) would then come back as different
      // values, which is precisely the oracle the test above this one exists to
      // prevent -- a caller could ask "does this address have an account?" and
      // read the answer off the return. Every 4xx is a fact ABOUT THE ADDRESS
      // and collapses to `false`, identical to success. Only a 5xx flips it,
      // because that is a fact about OUR relay and true of every address at
      // once.
      try {
        await call('/resend', { body: { type: 'signup', email }, clientIp });
      } catch (err) {
        logImpl(`[supabase] resend refused: ${err.message}`);
        return { ok: true, mailerBroken: Number(err?.status) >= 500 };
      }
      return { ok: true, mailerBroken: false };
    },

    /** The six-digit code. `type: 'signup'` is the confirmation flow. */
    async verifyCode({ email, token, type = 'signup', clientIp = null }) {
      const payload = await call('/verify', { body: { email, token, type }, clientIp });
      return { ok: true, identity: identityFrom(payload, 'email') };
    },

    async signInWithPassword({ email, password, clientIp = null }) {
      const payload = await call('/token?grant_type=password', { body: { email, password }, clientIp });
      return { ok: true, identity: identityFrom(payload, 'email') };
    },

    /** Where the browser is sent to start the Google round trip. */
    authorizeUrl({ codeChallenge, redirectTo }) {
      const q = new URLSearchParams({
        provider: 'google',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        redirect_to: redirectTo,
      });
      return `${base}/auth/v1/authorize?${q}`;
    },

    async exchangeCode({ authCode, codeVerifier, clientIp = null }) {
      const payload = await call('/token?grant_type=pkce', {
        body: { auth_code: authCode, code_verifier: codeVerifier }, clientIp,
      });
      return { ok: true, identity: identityFrom(payload, 'google') };
    },

    /** Answers the same way for a known and an unknown address, by contract. */
    async sendRecovery({ email, clientIp = null }) {
      try {
        await call('/recover', { body: { email }, clientIp });
      } catch (err) {
        logImpl(`[supabase] recover refused: ${err.message}`);
      }
      return { ok: true };
    },

    async updatePassword({ accessToken, password }) {
      await call('/user', { method: 'PUT', body: { password }, accessToken });
      return { ok: true };
    },

    /** Revoke at the door: after this, the only live credential is ours. A
     *  failed revoke must never turn a successful sign-in into a failure, so
     *  it is swallowed the same way `sendRecovery`'s is -- but logged, unlike
     *  that one, because a logout that fails without leaving any trace is
     *  undiagnosable. */
    async revoke({ accessToken }) {
      try {
        await call('/logout', { accessToken });
      } catch (err) {
        logImpl(`[supabase] revoke refused: ${err.message}`);
      }
      return { ok: true };
    },
  };
}
