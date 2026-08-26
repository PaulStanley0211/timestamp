import test from 'node:test';
import assert from 'node:assert/strict';

import { createSupabaseAuth } from '../scripts/auth/supabase-auth.mjs';
import { BAD_CREDENTIALS_MESSAGE } from '../scripts/auth/accounts.mjs';

const CFG = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_x', secretKey: 'sb_secret_x' };

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return handler({ url: String(url), opts, calls });
  };
  impl.calls = calls;
  return impl;
}

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

test('omitting fetchImpl throws rather than reaching the network', () => {
  assert.throws(() => createSupabaseAuth({ ...CFG }), TypeError);
});

test('a password sign-in returns an identity and never the token to callers who did not ask', async () => {
  const fetchImpl = fakeFetch(() => json(200, {
    access_token: 'at1',
    user: { id: 'uuid-1', email: 'a@b.com', email_confirmed_at: '2026-08-26T00:00:00Z' },
  }));
  const sb = createSupabaseAuth({ ...CFG, fetchImpl });
  const { identity } = await sb.signInWithPassword({ email: 'a@b.com', password: 'x'.repeat(10) });
  assert.equal(identity.supabaseUserId, 'uuid-1');
  assert.equal(identity.email, 'a@b.com');
  assert.equal(identity.emailVerified, true);
  assert.equal(identity.accessToken, 'at1');
});

test('every distinguishable upstream failure collapses to one sentence', async () => {
  for (const upstream of [
    { status: 400, body: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' } },
    { status: 400, body: { error_code: 'email_not_confirmed', msg: 'Email not confirmed' } },
    { status: 429, body: { error_code: 'over_request_rate_limit', msg: 'Too many requests' } },
    { status: 500, body: { msg: 'internal' } },
  ]) {
    const fetchImpl = fakeFetch(() => json(upstream.status, upstream.body));
    const sb = createSupabaseAuth({ ...CFG, fetchImpl });
    await assert.rejects(
      () => sb.signInWithPassword({ email: 'a@b.com', password: 'x'.repeat(10) }),
      (err) => {
        assert.equal(err.userMessage, BAD_CREDENTIALS_MESSAGE, `leaked for ${upstream.body.error_code}`);
        assert.ok(!String(err.userMessage).includes('confirm'), 'must not hint at confirmation state');
        return true;
      },
    );
  }
});

test('the end user IP rides on Sb-Forwarded-For with the secret key', async () => {
  const fetchImpl = fakeFetch(() => json(200, { access_token: 'at', user: { id: 'u', email: 'a@b.com' } }));
  const sb = createSupabaseAuth({ ...CFG, fetchImpl });
  await sb.signInWithPassword({ email: 'a@b.com', password: 'x'.repeat(10), clientIp: '203.0.113.7' });
  const headers = fetchImpl.calls[0].opts.headers;
  assert.equal(headers['Sb-Forwarded-For'], '203.0.113.7');
  assert.equal(headers.apikey, CFG.secretKey, 'forwarding is only honoured for a secret key');
});
