/**
 * The Stripe seam: a signature verifier and one POST, both offline.
 *
 * WHY THE FAILURE CASES COME FIRST IN THIS FILE, AND IT IS NOT TIDINESS. A
 * verifier that returns `true` unconditionally passes every success test ever
 * written for it. The only tests that can distinguish a real HMAC from
 * `return true` are the ones that hand it a wrong secret, a tampered body and a
 * stale timestamp, so those are written first and read first. The approved spec
 * (docs/superpowers/specs/2026-08-24-credit-packs-pricing-design.md section 8)
 * says the same thing in one line: "signature verification is tested for
 * failure first".
 *
 * WHY THERE IS A GOLDEN VECTOR. Every other test in this file computes the
 * expected signature with `node:crypto` the same way the module under test
 * does, so the two agree even if both are wrong -- if the module forgot the
 * `{timestamp}.` prefix and the test forgot it too, the pair is self-consistent
 * and useless. `GOLDEN` is one signature computed once, by hand, at a known
 * timestamp over a known body, and pasted in. It is the only assertion here
 * that fails when the formula itself changes.
 *
 * THIS FILE CANNOT SPEND MONEY. It never injects a real transport and there is
 * no default one to fall back on -- guard 1 in CLAUDE.md, "Money discipline",
 * and it is asserted directly rather than assumed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  StripeError,
  STRIPE_API_BASE,
  SIGNATURE_TOLERANCE_S,
  verifyStripeSignature,
  constructWebhookEvent,
  createCheckoutSession,
} from '../scripts/billing/stripe.mjs';

const SECRET = 'whsec_a_test_signing_secret_0000';

/** The header Stripe sends, built here rather than imported, so that the
 *  production signer and this one are two independent implementations of the
 *  same sentence from Stripe's documentation. */
function sign(payload, { secret = SECRET, at = 1_756_000_000, scheme = 'v1', extra = '' } = {}) {
  const mac = crypto.createHmac('sha256', secret)
    .update(`${at}.${Buffer.isBuffer(payload) ? payload.toString('utf8') : payload}`, 'utf8')
    .digest('hex');
  return `t=${at},${scheme}=${mac}${extra}`;
}

const at = (seconds) => () => new Date(seconds * 1000);

const EVENT = {
  id: 'evt_1',
  type: 'checkout.session.completed',
  data: { object: { payment_status: 'paid', client_reference_id: 'acct_1' } },
};
const BODY = Buffer.from(JSON.stringify(EVENT), 'utf8');
const NOW = at(1_756_000_010);

function refusal(fn, code) {
  let err = null;
  try {
    fn();
  } catch (caught) {
    err = caught;
  }
  assert.ok(err, `expected a ${code} refusal and nothing was thrown`);
  assert.ok(err instanceof StripeError, `expected a StripeError, got ${err?.name}: ${err?.message}`);
  assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
  return err;
}

// ---------------------------------------------------------------------------
// the signature, refused
// ---------------------------------------------------------------------------

test('a signature made with the wrong secret is refused', () => {
  const header = sign(BODY, { secret: 'whsec_not_the_one' });
  refusal(
    () => verifyStripeSignature({ payload: BODY, header, secret: SECRET, nowImpl: NOW }),
    'SIGNATURE_MISMATCH',
  );
});

/**
 * THE TEST THIS FILE EXISTS FOR.
 *
 * Stripe signs the exact bytes it sent. `JSON.parse` then `JSON.stringify` of
 * the same event is the same *object* and different *bytes* -- key order
 * survives, but whitespace does not, and neither does any escape Stripe chose
 * differently. A route that reads its body through the JSON parser everything
 * else in `server.mjs` uses would fail here, which is the only reason anybody
 * would notice before it was live.
 */
test('a re-serialised body fails, which is what proves the raw path is real', () => {
  const header = sign(BODY);
  const reserialised = Buffer.from(JSON.stringify(JSON.parse(BODY.toString('utf8')), null, 2), 'utf8');
  refusal(
    () => verifyStripeSignature({ payload: reserialised, header, secret: SECRET, nowImpl: NOW }),
    'SIGNATURE_MISMATCH',
  );
});

test('a body with one byte changed is refused', () => {
  const header = sign(BODY);
  const tampered = Buffer.from(BODY.toString('utf8').replace('acct_1', 'acct_2'), 'utf8');
  refusal(
    () => verifyStripeSignature({ payload: tampered, header, secret: SECRET, nowImpl: NOW }),
    'SIGNATURE_MISMATCH',
  );
});

test('a correctly signed event older than the tolerance is refused', () => {
  const header = sign(BODY, { at: 1_756_000_000 });
  refusal(
    () => verifyStripeSignature({
      payload: BODY, header, secret: SECRET, nowImpl: at(1_756_000_000 + SIGNATURE_TOLERANCE_S + 1),
    }),
    'TIMESTAMP_OUTSIDE_TOLERANCE',
  );
});

/** A clock skewed the other way is the same attack with the timestamp moved
 *  forward, and a one-sided window does not stop it. */
test('a correctly signed event dated in the future is refused', () => {
  const header = sign(BODY, { at: 1_756_000_000 });
  refusal(
    () => verifyStripeSignature({
      payload: BODY, header, secret: SECRET, nowImpl: at(1_756_000_000 - SIGNATURE_TOLERANCE_S - 1),
    }),
    'TIMESTAMP_OUTSIDE_TOLERANCE',
  );
});

test('a header with no v1 scheme is refused, and so is one with no timestamp', () => {
  refusal(
    () => verifyStripeSignature({ payload: BODY, header: 't=1756000000,v0=abc', secret: SECRET, nowImpl: NOW }),
    'BAD_SIGNATURE_HEADER',
  );
  const mac = sign(BODY).split('v1=')[1];
  refusal(
    () => verifyStripeSignature({ payload: BODY, header: `v1=${mac}`, secret: SECRET, nowImpl: NOW }),
    'BAD_SIGNATURE_HEADER',
  );
});

test('a missing header and a missing secret are named differently', () => {
  refusal(
    () => verifyStripeSignature({ payload: BODY, header: '', secret: SECRET, nowImpl: NOW }),
    'NO_SIGNATURE',
  );
  refusal(
    () => verifyStripeSignature({ payload: BODY, header: sign(BODY), secret: '', nowImpl: NOW }),
    'NO_WEBHOOK_SECRET',
  );
});

/** A verifier handed a string that Node re-encoded is a verifier that will
 *  disagree with Stripe about any payload containing a character JSON did not
 *  have to escape. The type is refused rather than coerced. */
test('a payload that is not raw bytes is refused rather than coerced', () => {
  refusal(
    () => verifyStripeSignature({ payload: EVENT, header: sign(BODY), secret: SECRET, nowImpl: NOW }),
    'BAD_PAYLOAD',
  );
});

// ---------------------------------------------------------------------------
// the signature, accepted
// ---------------------------------------------------------------------------

test('a genuine signature verifies', () => {
  const result = verifyStripeSignature({ payload: BODY, header: sign(BODY), secret: SECRET, nowImpl: NOW });
  assert.equal(result.timestampSeconds, 1_756_000_000);
});

/**
 * The one assertion in this file that does not agree with itself.
 *
 * Computed once, by hand, over a fixed body at a fixed timestamp with a fixed
 * secret. If the HMAC formula in the module changes -- a dropped prefix, a
 * different separator, base64 instead of hex -- every other test here changes
 * with it and this one does not.
 */
test('the golden vector still verifies', () => {
  const payload = Buffer.from('{"id":"evt_golden","type":"checkout.session.completed"}', 'utf8');
  const header = 't=1756000000,v1=ff956686b55c33a4c6c40c04243585b9d3f9aa323f94a241451ac4ef4c976072';
  const result = verifyStripeSignature({ payload, header, secret: SECRET, nowImpl: NOW });
  assert.equal(result.timestampSeconds, 1_756_000_000);
});

/** Stripe sends every signature it holds for the endpoint during a secret
 *  rotation, so more than one `v1=` is normal traffic and not an attack. One
 *  match is a match. */
test('one valid v1 among several verifies', () => {
  const good = sign(BODY).split(',')[1];
  const header = `t=1756000000,v1=${'0'.repeat(64)},${good}`;
  assert.equal(
    verifyStripeSignature({ payload: BODY, header, secret: SECRET, nowImpl: NOW }).timestampSeconds,
    1_756_000_000,
  );
});

/** A candidate of the wrong length must not reach `timingSafeEqual`, which
 *  throws on unequal buffers -- a 500 where a 400 belongs. */
test('a v1 of the wrong length is a mismatch, not a crash', () => {
  refusal(
    () => verifyStripeSignature({ payload: BODY, header: 't=1756000000,v1=abcd', secret: SECRET, nowImpl: NOW }),
    'SIGNATURE_MISMATCH',
  );
  refusal(
    () => verifyStripeSignature({ payload: BODY, header: 't=1756000000,v1=zz', secret: SECRET, nowImpl: NOW }),
    'SIGNATURE_MISMATCH',
  );
});

// ---------------------------------------------------------------------------
// the event
// ---------------------------------------------------------------------------

test('a verified event is parsed, and an unverified one is never parsed at all', () => {
  const event = constructWebhookEvent({ payload: BODY, header: sign(BODY), secret: SECRET, nowImpl: NOW });
  assert.equal(event.id, 'evt_1');
  assert.equal(event.type, 'checkout.session.completed');

  refusal(
    () => constructWebhookEvent({ payload: BODY, header: sign(BODY, { secret: 'nope' }), secret: SECRET, nowImpl: NOW }),
    'SIGNATURE_MISMATCH',
  );
});

test('a signed body that is not a JSON object is refused', () => {
  const payload = Buffer.from('not json at all', 'utf8');
  refusal(
    () => constructWebhookEvent({ payload, header: sign(payload), secret: SECRET, nowImpl: NOW }),
    'BAD_EVENT_JSON',
  );
  const list = Buffer.from('[1,2,3]', 'utf8');
  refusal(
    () => constructWebhookEvent({ payload: list, header: sign(list), secret: SECRET, nowImpl: NOW }),
    'BAD_EVENT_JSON',
  );
});

/** `event.id` is the idempotency key the ledger dedupes on. An event without
 *  one cannot be made idempotent, so it is refused rather than granted once
 *  per delivery. */
test('a signed event with no id is refused, because the id is the idempotency key', () => {
  const payload = Buffer.from(JSON.stringify({ type: 'checkout.session.completed' }), 'utf8');
  refusal(
    () => constructWebhookEvent({ payload, header: sign(payload), secret: SECRET, nowImpl: NOW }),
    'BAD_EVENT_SHAPE',
  );
});

// ---------------------------------------------------------------------------
// the checkout session
// ---------------------------------------------------------------------------

const SESSION = {
  priceId: 'price_test_placeholder',
  accountId: '0123456789abcdef0123456789abcdef',
  packId: 'starter',
  credits: 40,
  successUrl: 'https://timestamp.example/pricing?checkout=done',
  cancelUrl: 'https://timestamp.example/pricing?checkout=cancelled',
};

/** Guard 1, asserted rather than assumed: a `TypeError` and not a
 *  `StripeError`, because a missing transport is a wiring bug that should
 *  crash and not something a caller catches and retries. */
test('a call with no transport injected is a TypeError, not a request', async () => {
  await assert.rejects(
    () => createCheckoutSession({ ...SESSION, envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x' }) }),
    (err) => err instanceof TypeError && !(err instanceof StripeError),
  );
});

/**
 * Guard 2, and the ORDER is the assertion. A missing key must be discovered
 * before a request is built, not after one has been sent -- so the transport
 * here records every call and the test asserts it recorded none.
 */
test('a missing STRIPE_SECRET_KEY is refused before any request is attempted', async () => {
  const calls = [];
  const fetchImpl = async (...args) => { calls.push(args); throw new Error('this must not run'); };
  await assert.rejects(
    () => createCheckoutSession({ ...SESSION, fetchImpl, envImpl: () => ({}) }),
    (err) => err instanceof StripeError && err.code === 'NO_API_KEY',
  );
  assert.deepEqual(calls, [], 'a request was attempted without a credential');
});

test('a pack with no Stripe price id cannot be checked out', async () => {
  const calls = [];
  const fetchImpl = async (...args) => { calls.push(args); throw new Error('this must not run'); };
  await assert.rejects(
    () => createCheckoutSession({
      ...SESSION, priceId: null, fetchImpl, envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x' }),
    }),
    (err) => err instanceof StripeError && err.code === 'NO_PRICE_ID',
  );
  assert.deepEqual(calls, [], 'a request was attempted with no price');
});

/**
 * F3 of the security review, which is that `FAL_KEY` is sent to every host on
 * an allow-list rather than only the intended one. The fix there and the rule
 * here are the same: the destination is a constant in this module and there is
 * no parameter that can move it, so a caller cannot post the secret key
 * anywhere else. This test asserts the absence of that parameter by trying to
 * pass one.
 */
test('the secret key goes to api.stripe.com and there is no parameter that moves it', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  await createCheckoutSession({
    ...SESSION,
    fetchImpl,
    envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x' }),
    // Not a parameter. If one is ever added, this test fails loudly rather
    // than the key quietly going somewhere else.
    apiBase: 'https://evil.example/v1',
    baseUrl: 'https://evil.example/v1',
  });
  assert.equal(seen.length, 1);
  assert.ok(seen[0].url.startsWith(`${STRIPE_API_BASE}/checkout/sessions`), `posted to ${seen[0].url}`);
  assert.equal(new URL(seen[0].url).host, 'api.stripe.com');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer sk_test_x');
});

test('the session carries the account id, the price, and the pack as metadata', async () => {
  let body = null;
  const fetchImpl = async (url, init) => {
    body = new URLSearchParams(init.body);
    return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  const session = await createCheckoutSession({
    ...SESSION, fetchImpl, envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x' }),
  });

  assert.equal(session.id, 'cs_1');
  assert.equal(session.url, 'https://checkout.stripe.com/c/pay/cs_1');

  assert.equal(body.get('mode'), 'payment', 'a pack is a one-off, not a subscription');
  assert.equal(body.get('line_items[0][price]'), 'price_test_placeholder');
  assert.equal(body.get('line_items[0][quantity]'), '1');
  assert.equal(body.get('client_reference_id'), SESSION.accountId);
  assert.equal(body.get('metadata[accountId]'), SESSION.accountId);
  assert.equal(body.get('metadata[pack]'), 'starter');
  // The number of credits the customer was promised at the moment they paid,
  // written down here so the webhook can honour it even if the pack is
  // repriced between the click and the payment.
  assert.equal(body.get('metadata[credits]'), '40');
  assert.equal(body.get('success_url'), SESSION.successUrl);
  assert.equal(body.get('cancel_url'), SESSION.cancelUrl);

  // No amount, no currency, no credit count that Stripe could be told to
  // charge. The Price is the only thing that sets what is paid.
  assert.equal(body.get('line_items[0][price_data][unit_amount]'), null);
  assert.equal(body.get('amount'), null);
});

test('the session names its payment methods, so a completed session is always a paid one', async () => {
  // The webhook grants on `checkout.session.completed` and reads
  // `payment_status` off it. A card (and the wallets that ride on the card
  // rail) settles before that event fires, so `completed` always means `paid`.
  // Left unnamed, the Dashboard's own method list applies -- and a method that
  // settles days later fires `completed` with `payment_status: unpaid`,
  // followed by an event this product is not subscribed to. Naming the method
  // here is what keeps the one event the webhook listens for sufficient.
  let body = null;
  const fetchImpl = async (url, init) => {
    body = new URLSearchParams(init.body);
    return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  await createCheckoutSession({
    ...SESSION, fetchImpl, envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x' }),
  });

  assert.deepEqual(body.getAll('payment_method_types[0]'), ['card']);
  assert.equal(body.get('payment_method_types[1]'), null, 'exactly one method, and it is the immediate one');
});

test('the redirect urls must be absolute http(s), because Stripe will send somebody to them', async () => {
  const fetchImpl = async () => { throw new Error('this must not run'); };
  for (const successUrl of ['/pricing', 'javascript:alert(1)', '', 'ftp://x/y']) {
    await assert.rejects(
      () => createCheckoutSession({
        ...SESSION, successUrl, fetchImpl, envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x' }),
      }),
      (err) => err instanceof StripeError && err.code === 'BAD_REDIRECT_URL',
      `${JSON.stringify(successUrl)} was accepted as a success url`,
    );
  }
});

test('a Stripe error response becomes a StripeError carrying the status', async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({ error: { message: 'No such price: price_test_placeholder', type: 'invalid_request_error' } }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  );
  const err = await createCheckoutSession({
    ...SESSION, fetchImpl, envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x' }),
  }).then(() => null, (e) => e);
  assert.ok(err instanceof StripeError, `got ${err}`);
  assert.equal(err.code, 'STRIPE_REQUEST_FAILED');
  assert.equal(err.status, 400);
  assert.match(err.message, /No such price/);
});

/** A 200 that is not a session is a broken integration, and treating it as one
 *  would redirect somebody to `undefined`. */
test('a 200 with no url is refused', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ id: 'cs_1' }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  await assert.rejects(
    () => createCheckoutSession({ ...SESSION, fetchImpl, envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x' }) }),
    (err) => err instanceof StripeError && err.code === 'BAD_SESSION_RESPONSE',
  );
});

/** Whatever Stripe returns becomes a `Location:` header, so it is checked here
 *  as well as at the redirect. A checkout url that is not Stripe's is a
 *  compromised response, not a redirect worth following. */
test('a session url that is not on stripe.com is refused', async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({ id: 'cs_1', url: 'https://evil.example/c/pay/cs_1' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
  await assert.rejects(
    () => createCheckoutSession({ ...SESSION, fetchImpl, envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x' }) }),
    (err) => err instanceof StripeError && err.code === 'BAD_SESSION_RESPONSE',
  );
});
