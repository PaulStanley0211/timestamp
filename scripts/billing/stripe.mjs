/**
 * Stripe, in two functions and no dependencies.
 *
 * WHAT THIS MODULE IS ALLOWED TO KNOW. A price id, an account id, and a number
 * of credits. It never sees a card number, a CVV or a bank detail, because the
 * card is entered on Stripe's own domain -- `docs/interfaces-app.md` A, and it
 * is honoured exactly as written rather than reinterpreted. What this file does
 * is create a hosted Checkout Session and then, later, prove that a request
 * claiming to be Stripe really is.
 *
 * WHY THERE IS NO STRIPE SDK. Stripe's API is form-encoded HTTPS, which
 * `fetch` speaks, and webhook signatures are HMAC-SHA256, which `node:crypto`
 * computes. Adding a dependency here would buy a retry policy and an object
 * model this product does not use, against a repo whose zero-dependency
 * property is one of the few things keeping it deployable anywhere with
 * ffmpeg.
 *
 * THE MONEY GUARDS, AND WHICH ONES LIVE HERE. `npm test` must be unable to
 * spend a cent, enforced independently because the failure mode is a bill
 * rather than a red test:
 *
 *   1. `fetchImpl` has NO DEFAULT and `requireFetchImpl` is the first line of
 *      `createCheckoutSession`. A test that forgets to inject a transport gets
 *      a plain `TypeError` -- not a `StripeError`, because a `StripeError` is
 *      something a caller may catch and retry, and a missing transport is a
 *      wiring bug that should crash.
 *   2. `STRIPE_SECRET_KEY` is read at CALL time through `envImpl`, after every
 *      free check has run, so a missing key is refused BEFORE a request exists
 *      -- and that order is under test.
 *   3. `"test": "node --test"` is bare and does not load `.env`, so the key is
 *      not in the process during a test run at all.
 *   4. `createServer` takes its billing seam as an argument and defaults it to
 *      nothing, so a server started by a test has no transport to spend
 *      through even if one were wired.
 *
 * WHY THE DESTINATION IS A CONSTANT AND NOT A PARAMETER. F3 of
 * `docs/security-review-2026-08-21.md` is that `FAL_KEY` is sent to every host
 * on an allow-list rather than only to the one host that should ever see it.
 * The same mistake here would post a live secret key wherever a caller asked.
 * So `STRIPE_API_BASE` is a constant in this file, there is no `baseUrl`
 * option, and the built URL is re-checked against the expected host before the
 * `Authorization` header is attached. A test passes `baseUrl` and `apiBase`
 * anyway and asserts they do nothing.
 *
 * WHY THE VERIFIER TAKES RAW BYTES AND REFUSES ANYTHING ELSE. Stripe signs the
 * exact bytes it sent. Any parse-then-reserialise round trip -- which is what
 * every other body in `server.mjs` goes through -- changes those bytes and
 * breaks every signature. Taking a `Buffer` and refusing an object is how that
 * hazard is caught at the call rather than in production, and there is a test
 * that a re-serialised body FAILS, because that failure is the only proof the
 * raw path is real.
 */

import crypto from 'node:crypto';

import { requireFetchImpl } from '../providers/contract.mjs';

/** The only host a Stripe secret key is ever sent to. Not a parameter. */
export const STRIPE_API_BASE = 'https://api.stripe.com/v1';

/** Where a hosted Checkout Session lives. A `url` in Stripe's response that is
 *  not under this suffix is a compromised or misread response, not a redirect
 *  worth sending a customer to. */
export const CHECKOUT_HOST_SUFFIX = 'stripe.com';

/**
 * Five minutes, from the spec.
 *
 * This is REPLAY protection and it is a different concern from idempotency,
 * which is the ledger's `ref`. The window stops a request captured off the
 * wire and sent again an hour later; the `ref` stops Stripe's own legitimate
 * retries from paying twice. Both are needed and neither substitutes.
 */
export const SIGNATURE_TOLERANCE_S = 300;

/** Anything this module refuses. `code` is the vocabulary the web layer maps
 *  to a status; `status` is Stripe's, when the refusal came from them. */
export class StripeError extends Error {
  constructor(message, { code = 'STRIPE_ERROR', status = null, detail = null } = {}) {
    super(message);
    this.name = 'StripeError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const defaultNow = () => new Date();

// ---------------------------------------------------------------------------
// webhook signatures
// ---------------------------------------------------------------------------

/**
 * Split a `Stripe-Signature` header into its timestamp and its candidates.
 *
 * MORE THAN ONE `v1=` IS NORMAL TRAFFIC. During a signing-secret rotation
 * Stripe signs each delivery with every secret currently configured for the
 * endpoint and sends them all, so refusing a header with two candidates would
 * break exactly the operation the rotation exists to make safe. One match is a
 * match.
 */
function parseSignatureHeader(header) {
  let timestamp = null;
  const candidates = [];
  for (const part of String(header).split(',')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't' && timestamp === null) timestamp = value;
    else if (key === 'v1') candidates.push(value);
  }
  return { timestamp, candidates };
}

/**
 * Prove that this request came from Stripe, and recently.
 *
 * @param {object} opts
 * @param {Buffer|string} opts.payload  THE RAW BODY. Not an object, ever.
 * @param {string} opts.header          the `Stripe-Signature` header
 * @param {string} opts.secret          the endpoint's signing secret
 * @param {() => Date} [opts.nowImpl]
 * @param {number} [opts.toleranceSeconds]
 * @returns {{timestampSeconds: number}}
 * @throws {StripeError}
 */
export function verifyStripeSignature({
  payload,
  header,
  secret,
  nowImpl = defaultNow,
  toleranceSeconds = SIGNATURE_TOLERANCE_S,
} = {}) {
  // A STRING IS ACCEPTED AND AN OBJECT IS NOT. `Buffer.from(string, 'utf8')` is
  // the identity on anything Node produced by decoding utf8, so a caller that
  // has already read the body as text is not wrong -- but an object has been
  // through a parser, and re-encoding it here would produce bytes Stripe never
  // sent and a signature that can never match. Refusing names the mistake.
  if (!Buffer.isBuffer(payload) && typeof payload !== 'string') {
    throw new StripeError(
      'a webhook signature is computed over the RAW request body; pass the Buffer, not a parsed object',
      { code: 'BAD_PAYLOAD' },
    );
  }
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');

  if (typeof secret !== 'string' || secret.trim().length === 0) {
    throw new StripeError(
      'STRIPE_WEBHOOK_SECRET is not set, so nothing can be verified and nothing may be granted',
      { code: 'NO_WEBHOOK_SECRET' },
    );
  }
  if (typeof header !== 'string' || header.trim().length === 0) {
    throw new StripeError('no Stripe-Signature header', { code: 'NO_SIGNATURE' });
  }

  const { timestamp, candidates } = parseSignatureHeader(header);
  if (timestamp === null || candidates.length === 0) {
    throw new StripeError(
      `Stripe-Signature carries no ${timestamp === null ? 't' : 'v1'} field`,
      { code: 'BAD_SIGNATURE_HEADER' },
    );
  }
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) {
    throw new StripeError(`Stripe-Signature timestamp ${JSON.stringify(timestamp)} is not a number`, {
      code: 'BAD_SIGNATURE_HEADER',
    });
  }

  // SIGNATURE FIRST, THEN THE CLOCK. An unsigned request has told us nothing at
  // all, including nothing about when it was sent, so there is no reason to
  // reason about its timestamp before its authenticity.
  const expected = crypto.createHmac('sha256', secret)
    .update(`${timestamp}.`, 'utf8')
    .update(bytes)
    .digest();

  const matched = candidates.some((candidate) => {
    // `timingSafeEqual` THROWS on buffers of different length, which would turn
    // a wrong-length signature -- the cheapest thing an attacker can send -- into
    // a 500 where a 400 belongs. Length is compared first, in the clear, because
    // the length of a signature is not a secret.
    const given = Buffer.from(candidate, 'hex');
    if (given.length !== expected.length) return false;
    return crypto.timingSafeEqual(given, expected);
  });
  if (!matched) {
    throw new StripeError('the Stripe-Signature does not match this body and secret', {
      code: 'SIGNATURE_MISMATCH',
    });
  }

  const nowSeconds = Math.floor(new Date(nowImpl()).getTime() / 1000);
  if (!Number.isFinite(nowSeconds)) {
    throw new StripeError('nowImpl did not return a usable Date', { code: 'BAD_CLOCK' });
  }
  // TWO-SIDED, because a captured request replayed with the clock moved forward
  // is the same attack as one replayed an hour late and a one-sided window
  // catches only half of it.
  if (Math.abs(nowSeconds - seconds) > toleranceSeconds) {
    throw new StripeError(
      `the signature is timestamped ${Math.abs(nowSeconds - seconds)}s away from now, outside the ${toleranceSeconds}s window`,
      { code: 'TIMESTAMP_OUTSIDE_TOLERANCE', detail: { timestampSeconds: seconds, nowSeconds } },
    );
  }

  return { timestampSeconds: seconds };
}

/**
 * Verify, then parse. In that order and never the other one.
 *
 * The event's `id` is required rather than optional because it is the
 * idempotency key the ledger dedupes grants on -- an event without one cannot
 * be made idempotent, and granting it once per delivery is exactly the bug the
 * key exists to prevent.
 */
export function constructWebhookEvent(opts = {}) {
  const { timestampSeconds } = verifyStripeSignature(opts);
  const text = Buffer.isBuffer(opts.payload) ? opts.payload.toString('utf8') : String(opts.payload);
  let event;
  try {
    event = JSON.parse(text);
  } catch {
    throw new StripeError('the webhook body verified but is not JSON', { code: 'BAD_EVENT_JSON' });
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new StripeError('the webhook body verified but is not a JSON object', { code: 'BAD_EVENT_JSON' });
  }
  if (typeof event.id !== 'string' || event.id.trim().length === 0) {
    throw new StripeError('a webhook event with no id cannot be made idempotent', { code: 'BAD_EVENT_SHAPE' });
  }
  if (typeof event.type !== 'string' || event.type.trim().length === 0) {
    throw new StripeError('a webhook event with no type cannot be routed', { code: 'BAD_EVENT_SHAPE' });
  }
  return { ...event, receivedTimestampSeconds: timestampSeconds };
}

// ---------------------------------------------------------------------------
// checkout
// ---------------------------------------------------------------------------

/** Somewhere Stripe can send a person back to. Absolute, and http(s) only:
 *  Stripe will navigate a browser to whatever is passed, so a `javascript:` or
 *  a relative string is a bug with a customer at the end of it. */
function assertRedirectUrl(value, what) {
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    throw new StripeError(`${what} must be an absolute http(s) url, got ${JSON.stringify(value)}`, {
      code: 'BAD_REDIRECT_URL',
    });
  }
  return parsed.toString();
}

/**
 * Create a hosted Checkout Session for one credit pack.
 *
 * THE BROWSER SENDS A PACK ID AND NOTHING ELSE. Everything priced here comes
 * from the server: `priceId` is resolved from `config/credits.json`, and no
 * amount, currency or `price_data` is sent at all, so there is no field in this
 * request a client could have influenced into charging less. That is the
 * "client-controlled prices" item from `docs/security-review-brief.md`, and the
 * absence of those fields is asserted by a test rather than described here.
 *
 * @param {object} opts
 * @param {function} opts.fetchImpl     REQUIRED. No default -- see the header.
 * @param {() => object} [opts.envImpl] where STRIPE_SECRET_KEY is read, at call time
 * @param {string} opts.priceId
 * @param {string} opts.accountId       becomes `client_reference_id`
 * @param {string} opts.packId
 * @param {number} opts.credits         written into metadata as the promise
 * @param {string} opts.successUrl
 * @param {string} opts.cancelUrl
 * @returns {Promise<{id: string, url: string}>}
 */
export async function createCheckoutSession({
  fetchImpl,
  envImpl = () => process.env,
  priceId,
  accountId,
  packId,
  credits,
  successUrl,
  cancelUrl,
} = {}) {
  // FIRST LINE. A test that forgets the transport gets this TypeError rather
  // than a bill.
  const doFetch = requireFetchImpl({ fetchImpl }, { provider: 'stripe' });

  // Every free check runs before the credential is read, so that "you have no
  // key" is never the error that hides "you have no price".
  if (typeof priceId !== 'string' || priceId.trim().length === 0) {
    throw new StripeError(
      'this pack has no Stripe Price id yet, so it cannot be bought. Set `stripePriceId` in config/credits.json.',
      { code: 'NO_PRICE_ID' },
    );
  }
  if (typeof accountId !== 'string' || accountId.trim().length === 0) {
    throw new StripeError('a checkout session must name the account it is for', { code: 'NO_ACCOUNT_ID' });
  }
  if (typeof packId !== 'string' || packId.trim().length === 0) {
    throw new StripeError('a checkout session must name the pack it is for', { code: 'NO_PACK_ID' });
  }
  if (!Number.isInteger(credits) || credits <= 0) {
    throw new StripeError(`a pack must be a positive whole number of credits, got ${JSON.stringify(credits)}`, {
      code: 'BAD_CREDITS',
    });
  }
  const success = assertRedirectUrl(successUrl, 'success_url');
  const cancel = assertRedirectUrl(cancelUrl, 'cancel_url');

  const key = envImpl()?.STRIPE_SECRET_KEY;
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new StripeError(
      'STRIPE_SECRET_KEY is not set. Put it in .env -- `npm run web` loads it with --env-file-if-exists, '
      + 'and `npm test` deliberately does not.',
      { code: 'NO_API_KEY', detail: { env: 'STRIPE_SECRET_KEY' } },
    );
  }

  const body = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    // THE LINK BETWEEN A PAYMENT AND AN ACCOUNT, and the only one. Stripe hands
    // it back on the completed session, and the webhook reads it there.
    client_reference_id: accountId,
    'metadata[accountId]': accountId,
    'metadata[pack]': packId,
    // WHAT THE CUSTOMER WAS PROMISED, AT THE MOMENT THEY WERE PROMISED IT. The
    // pack's credit count in config can change between the click and the
    // payment; this rides along so the webhook can honour the offer that was
    // actually on screen rather than today's.
    'metadata[credits]': String(credits),
    success_url: success,
    cancel_url: cancel,
  });

  // The URL is built from the constant and then re-checked, because the check
  // is what makes "the key goes to one host" a property of the code rather
  // than of whoever edits the line above next.
  const url = `${STRIPE_API_BASE}/checkout/sessions`;
  if (new URL(url).host !== 'api.stripe.com' || new URL(url).protocol !== 'https:') {
    throw new StripeError(`refusing to send a Stripe secret key to ${url}`, { code: 'BAD_API_HOST' });
  }

  const res = await doFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch { /* Stripe answers JSON; a body that is not JSON is reported as-is below */ }

  if (!res.ok) {
    const message = parsed?.error?.message ?? `Stripe answered ${res.status}`;
    throw new StripeError(`stripe: ${message}`, {
      code: 'STRIPE_REQUEST_FAILED',
      status: res.status,
      detail: { type: parsed?.error?.type ?? null, param: parsed?.error?.param ?? null },
    });
  }

  const sessionUrl = typeof parsed?.url === 'string' ? parsed.url : null;
  if (typeof parsed?.id !== 'string' || !sessionUrl) {
    throw new StripeError('Stripe returned 200 without a session id and url', {
      code: 'BAD_SESSION_RESPONSE',
    });
  }
  // This string becomes a `Location:` header on a response to a signed-in
  // customer. Checking it here means a compromised or misread response cannot
  // turn our checkout button into somebody else's landing page.
  let host = null;
  try {
    const u = new URL(sessionUrl);
    host = u.protocol === 'https:' ? u.host : null;
  } catch { host = null; }
  if (!host || !(host === CHECKOUT_HOST_SUFFIX || host.endsWith(`.${CHECKOUT_HOST_SUFFIX}`))) {
    throw new StripeError(`Stripe returned a checkout url that is not on ${CHECKOUT_HOST_SUFFIX}: ${sessionUrl}`, {
      code: 'BAD_SESSION_RESPONSE',
    });
  }

  return { id: parsed.id, url: sessionUrl };
}
