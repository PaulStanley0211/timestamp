import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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

test('user_metadata.email_verified alone does not verify an identity -- only Supabase\'s own confirmation timestamps do', async () => {
  // Whole-branch review finding 3: `user_metadata` is `raw_user_meta_data`,
  // populated from the `data` field on signup and from `PUT /user` -- it is
  // WRITABLE BY THE ACCOUNT ITSELF, and `emailVerified === true` is the whole
  // of spec §4.1 and the account-takeover guards at identity.mjs:30 and :54.
  // A caller that can set `user_metadata.email_verified: true` on signup, with
  // no `email_confirmed_at` or `confirmed_at` from Supabase itself, must not
  // be able to talk this app into treating the address as verified.
  const fetchImpl = fakeFetch(() => json(200, {
    access_token: 'at1',
    user: {
      id: 'uuid-1',
      email: 'attacker@b.com',
      // No email_confirmed_at, no confirmed_at -- ONLY the user-writable field.
      user_metadata: { email_verified: true },
    },
  }));
  const sb = createSupabaseAuth({ ...CFG, fetchImpl });
  const { identity } = await sb.signInWithPassword({ email: 'attacker@b.com', password: 'x'.repeat(10) });
  assert.equal(identity.emailVerified, false,
    'a user-writable field was enough to fake a verified email');
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


// ---------------------------------------------------------------------------
// resendSignupCode -- the way out of the loop the handoff named.
//
// `/verify/resend` used to send the person back to the signup form, because
// this module had no way to ask for a new code and a fresh signup call needs
// the password this service deliberately does not keep. That only ever worked
// if Supabase re-sent the confirmation when signup was repeated for an
// unconfirmed user -- behaviour NOBODY HAS EVER OBSERVED against the live
// project. If it does not hold, somebody whose first code never arrived loops
// /verify -> /signup -> /verify with no way out. `POST /auth/v1/resend` is the
// documented endpoint for exactly this, needs no password, and removes the
// dependency on that guess entirely.
// ---------------------------------------------------------------------------

test('resendSignupCode asks Supabase for a new signup code and carries the end user IP', async () => {
  const fetchImpl = fakeFetch(() => json(200, {}));
  const sb = createSupabaseAuth({ ...CFG, fetchImpl });

  const result = await sb.resendSignupCode({ email: 'a@b.com', clientIp: '203.0.113.7' });

  assert.deepEqual(result, { ok: true });
  assert.equal(fetchImpl.calls.length, 1, 'exactly one upstream call');
  const [call] = fetchImpl.calls;
  assert.equal(call.url, 'https://example.supabase.co/auth/v1/resend');
  assert.equal(call.opts.method, 'POST');
  // `type: 'signup'` is the confirmation flow, the same one `verifyCode` reads
  // back. Any other type re-sends the wrong mail for this page.
  assert.deepEqual(JSON.parse(call.opts.body), { type: 'signup', email: 'a@b.com' });
  assert.equal(call.opts.headers['Sb-Forwarded-For'], '203.0.113.7');
  assert.equal(call.opts.headers.apikey, CFG.secretKey, 'forwarding is only honoured for a secret key');
});

// The same enumeration defence `sendRecovery` carries, and for the same
// reason: a resend must answer identically whether the address exists, is
// already confirmed, is merely being asked for too often (Supabase permits one
// per address per sixty seconds), or cannot be reached at all. If a later edit
// rethrows on one of these, this is the test that catches the oracle it opens.
test('resendSignupCode resolves the identical { ok: true } across success and every failure shape, and never lets an error escape', async () => {
  const outcomes = [];

  const okFetch = fakeFetch(() => json(200, {}));
  outcomes.push(await createSupabaseAuth({ ...CFG, fetchImpl: okFetch }).resendSignupCode({ email: 'known@b.com' }));

  const unknownAddressFetch = fakeFetch(() => json(400, { error_code: 'user_not_found', msg: 'no such user' }));
  outcomes.push(await createSupabaseAuth({ ...CFG, fetchImpl: unknownAddressFetch }).resendSignupCode({ email: 'unknown@b.com' }));

  const alreadyConfirmedFetch = fakeFetch(() => json(422, { error_code: 'user_already_exists', msg: 'already confirmed' }));
  outcomes.push(await createSupabaseAuth({ ...CFG, fetchImpl: alreadyConfirmedFetch }).resendSignupCode({ email: 'known@b.com' }));

  const rateLimitedFetch = fakeFetch(() => json(429, { error_code: 'over_email_send_rate_limit', msg: 'slow down' }));
  outcomes.push(await createSupabaseAuth({ ...CFG, fetchImpl: rateLimitedFetch }).resendSignupCode({ email: 'known@b.com' }));

  const transportFailFetch = async () => { throw new Error('ECONNRESET'); };
  outcomes.push(await createSupabaseAuth({ ...CFG, fetchImpl: transportFailFetch }).resendSignupCode({ email: 'known@b.com' }));

  for (const outcome of outcomes) {
    assert.deepEqual(outcome, { ok: true });
  }
});

test('a refused resend leaves a trace in the log, since nothing else can tell anyone it failed', async () => {
  const logs = [];
  const fetchImpl = fakeFetch(() => json(429, { error_code: 'over_email_send_rate_limit', msg: 'slow down' }));
  const sb = createSupabaseAuth({ ...CFG, fetchImpl, logImpl: (line) => logs.push(line) });
  await sb.resendSignupCode({ email: 'a@b.com' });
  assert.ok(logs.some((line) => line.includes('resend')), 'a failed resend must be diagnosable');
});
// ---------------------------------------------------------------------------
// Task 13 -- `server-cli.mjs` is the one place a REAL transport is handed to
// `createSupabaseAuth`, for the reason CLAUDE.md's Bug 1 exists: a unit test
// of this module passing is worth nothing if production never wires the
// result into `createServer`. This is that wiring under test, not the
// protocol module again -- everything above this line already covers that.
// ---------------------------------------------------------------------------

test('server-cli builds a Supabase client with a real transport', async () => {
  const mod = await import('../scripts/web/server-cli.mjs');
  assert.equal(typeof mod.supabaseFromEnv, 'function');
  const built = mod.supabaseFromEnv({
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    SUPABASE_SECRET_KEY: 'sb_secret_x',
  });
  assert.ok(built, 'production must inject, or the guard fires in production');
  assert.equal(mod.supabaseFromEnv({}), null, 'absent config is null, not a crash');
});

// `supabaseFromEnv` working correctly, on its own, is not the same claim as
// `main()` actually handing its result to `createServer` -- CLAUDE.md's Bug 1
// was precisely a function that worked fine sitting next to a call site that
// never used it. `provider-contract.test.js`'s `every command that can spend
// injects the transport` reads source for the same reason: a unit test of the
// producing function cannot see whether the consuming call site forgot it.
test('main() actually hands supabaseFromEnv() to createServer, not just builds it and drops it', () => {
  const file = new URL('../scripts/web/server-cli.mjs', import.meta.url);
  const source = fs.readFileSync(file, 'utf8');

  const built = source.match(/\bsupabaseFromEnv\(\)/g) ?? [];
  assert.ok(built.length > 0, 'server-cli.mjs never calls supabaseFromEnv() -- main() cannot build a real client');

  // The real call, not the one-line mention of the shape in this file's own
  // comment: the real one opens onto a newline before its first field.
  const callSite = source.match(/createServer\(\{\s*\n[\s\S]*?\n {2}\}\);/);
  assert.ok(callSite, 'could not find the createServer({...}) call in server-cli.mjs -- did it move or get renamed?');
  assert.match(callSite[0], /\bsupabase\b\s*[,:]/,
    'createServer({...}) has no supabase key -- the client is built and never handed to the server that needs it');
});

// RULING, 2026-08-26, OVERTURNING AN EARLIER VERSION OF THIS TEST: absent and
// partial are different shapes -- all three env values missing is an
// ordinary, expected shape (a test build, a fresh checkout) and degrades.
// Two out of three present is what a `.env` looks like when somebody pasted
// a URL and one key and forgot the third. The FIRST version of this task made
// that throw, refusing to boot the whole app -- rendering, billing, the
// shelf, every route -- over one misconfigured identity variable. Coordinator
// overruled it: the blast radius was wrong for a trigger as mundane as a
// secret rotation or non-atomic env propagation leaving an instance
// transiently holding two of three values. It must be LOUD, not FATAL:
// `supabaseFromEnv` degrades to `null` exactly like `absent`, and it is
// `main()`'s startup banner (`supabaseBannerLines`, tested below) that carries
// the loudness.
test('a partial Supabase configuration does not throw -- it degrades to null, same as fully absent', async () => {
  const mod = await import('../scripts/web/server-cli.mjs');
  const partials = [
    { SUPABASE_URL: 'https://x.supabase.co' },
    { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' },
    { SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x', SUPABASE_SECRET_KEY: 'sb_secret_x' },
    { SUPABASE_SECRET_KEY: 'sb_secret_x' },
  ];
  for (const env of partials) {
    assert.doesNotThrow(() => mod.supabaseFromEnv(env), `supabaseFromEnv must not throw for ${JSON.stringify(env)}`);
    assert.equal(mod.supabaseFromEnv(env), null, `expected null (identity disabled) for ${JSON.stringify(env)}`);
  }
});

test('describeSupabaseConfig names what is present and missing, across all three states, never a value', async () => {
  const mod = await import('../scripts/web/server-cli.mjs');
  const secretValue = 'sb_secret_do-not-print-this-anywhere';

  const absent = mod.describeSupabaseConfig({});
  assert.equal(absent.state, 'absent');
  assert.deepEqual(absent.present, []);
  assert.deepEqual(absent.missing.slice().sort(), mod.SUPABASE_ENV_KEYS.slice().sort());

  const partial = mod.describeSupabaseConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: secretValue });
  assert.equal(partial.state, 'partial');
  assert.deepEqual(partial.present.slice().sort(), ['SUPABASE_SECRET_KEY', 'SUPABASE_URL']);
  assert.deepEqual(partial.missing, ['SUPABASE_PUBLISHABLE_KEY']);

  const configured = mod.describeSupabaseConfig({
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    SUPABASE_SECRET_KEY: secretValue,
  });
  assert.equal(configured.state, 'configured');
  assert.deepEqual(configured.missing, []);

  // NEVER A VALUE. Every array entry, across every state, is one of the three
  // env var NAMES and nothing else.
  for (const result of [absent, partial, configured]) {
    for (const name of [...result.present, ...result.missing]) {
      assert.ok(mod.SUPABASE_ENV_KEYS.includes(name), `"${name}" is not an env var name -- a value leaked into the description`);
    }
  }
});

// The banner is what makes `partial` LOUD rather than merely non-fatal --
// tested as a pure function (`supabaseBannerLines`) rather than by running
// `main()` itself, because `main()`'s own shutdown path calls `process.exit`,
// which a test must never trigger on the process running it.
test('supabaseBannerLines is prominent and names the missing variables on a partial config, and never leaks a value', async () => {
  const mod = await import('../scripts/web/server-cli.mjs');
  const secretValue = 'sb_secret_do-not-print-this-either';

  const partialLines = mod.supabaseBannerLines(
    mod.describeSupabaseConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: secretValue }),
  );
  const partialText = partialLines.join('\n');
  assert.match(partialText, /MISCONFIGURED/, 'a partial config must say so, not "identity configured"');
  assert.match(partialText, /DISABLED/i);
  assert.match(partialText, /SUPABASE_PUBLISHABLE_KEY/, 'the missing variable must be named');
  assert.doesNotMatch(partialText, new RegExp(secretValue), 'a present value must never reach the banner');
  assert.doesNotMatch(partialText, /x\.supabase\.co/, 'a present value must never reach the banner');

  const configuredLines = mod.supabaseBannerLines(mod.describeSupabaseConfig({
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    SUPABASE_SECRET_KEY: secretValue,
  }));
  assert.match(configuredLines.join('\n'), /identity configured/);
  assert.doesNotMatch(configuredLines.join('\n'), new RegExp(secretValue));

  const absentLines = mod.supabaseBannerLines(mod.describeSupabaseConfig({}));
  assert.match(absentLines.join('\n'), /NO SUPABASE_\*/);
});
