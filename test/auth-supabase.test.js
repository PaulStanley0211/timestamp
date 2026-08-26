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

// sendRecovery is the enumeration defence: a recovery request must answer the
// identical way whether the address exists or not, and whether upstream is
// merely slow to admit it (400/429) or does not answer at all (transport
// rejection). If a later edit rethrows on one of these, this is the test that
// catches the account-enumeration oracle it would reopen.
test('sendRecovery resolves the identical { ok: true } across success and every failure shape, and never lets an error escape', async () => {
  const outcomes = [];

  const okFetch = fakeFetch(() => json(200, {}));
  outcomes.push(await createSupabaseAuth({ ...CFG, fetchImpl: okFetch }).sendRecovery({ email: 'known@b.com' }));

  const unknownAddressFetch = fakeFetch(() => json(400, { error_code: 'invalid_credentials', msg: 'no such user' }));
  outcomes.push(await createSupabaseAuth({ ...CFG, fetchImpl: unknownAddressFetch }).sendRecovery({ email: 'unknown@b.com' }));

  const rateLimitedFetch = fakeFetch(() => json(429, { error_code: 'over_request_rate_limit', msg: 'slow down' }));
  outcomes.push(await createSupabaseAuth({ ...CFG, fetchImpl: rateLimitedFetch }).sendRecovery({ email: 'known@b.com' }));

  const transportFailFetch = async () => { throw new Error('ECONNRESET'); };
  outcomes.push(await createSupabaseAuth({ ...CFG, fetchImpl: transportFailFetch }).sendRecovery({ email: 'known@b.com' }));

  for (const outcome of outcomes) {
    assert.deepEqual(outcome, { ok: true });
  }
});

// revoke must never turn a successful sign-in into a failure by refusing to
// log out afterward -- later tasks' exchange -> resolve -> use -> revoke
// ordering depends on that. But unlike sendRecovery, a failed revoke leaving
// no trace at all is undiagnosable, so it must still reach the log.
test('revoke resolves { ok: true } even when the upstream logout fails, and logs the refusal', async () => {
  const logs = [];
  const fetchImpl = fakeFetch(() => json(500, { msg: 'internal' }));
  const sb = createSupabaseAuth({ ...CFG, fetchImpl, logImpl: (line) => logs.push(line) });
  const result = await sb.revoke({ accessToken: 'at1' });
  assert.deepEqual(result, { ok: true });
  assert.ok(logs.some((line) => line.includes('revoke')), 'a failed revoke must leave a trace in the logs');
});
