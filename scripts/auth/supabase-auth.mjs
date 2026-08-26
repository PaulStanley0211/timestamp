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
      emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at
        || user.user_metadata?.email_verified),
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

    /** Revoke at the door: after this, the only live credential is ours. */
    async revoke({ accessToken }) {
      try { await call('/logout', { accessToken }); } catch { /* best effort */ }
      return { ok: true };
    },
  };
}
