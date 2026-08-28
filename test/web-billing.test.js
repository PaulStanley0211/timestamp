/**
 * Buying credits, at the HTTP boundary, with the real ledger underneath.
 *
 * WHY `scripts/auth/` IS REAL HERE AND FAKED IN `web-auth.test.js`. The single
 * most important assertion in this file is that **the same Stripe event
 * delivered twice grants credits once**, and a fake `grantCredits` that dedupes
 * on `ref` would be a test of the fake. Stripe redelivering an event is
 * documented behaviour rather than an edge case, so the replay has to run
 * against the real append-only ledger, on disk, reloaded between deliveries --
 * which is the only case a webhook ever has and the exact case that was broken
 * once already (CLAUDE.md, `entriesOf` projecting a fixed shape).
 *
 * WHY NOTHING HERE CAN SPEND MONEY. `createBilling` is constructed with no
 * transport, so `createCheckoutSession` would raise a `TypeError` rather than
 * reach the network -- guard 1. The one test that needs a session back injects
 * a recording transport that returns a canned response and never opens a
 * socket. There is no `STRIPE_SECRET_KEY` in the process either, because
 * `npm test` is bare and does not load `.env`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { createServer } from '../scripts/web/server.mjs';
import { createBilling } from '../scripts/billing/billing.mjs';
import { PACKS, PACK_IDS } from '../scripts/billing/packs.mjs';

const CFG = JSON.parse(fs.readFileSync(new URL('../config/render.json', import.meta.url), 'utf8'));
const WEBHOOK_SECRET = 'whsec_a_test_signing_secret_0000';
const PACK_ID = PACK_IDS[0];
const PACK = PACKS[PACK_ID];

const EMAIL = 'buyer@example.com';
const PASSWORD = 'a long enough password';

function fakeQueue() {
  const enqueued = [];
  return {
    enqueue(jobId) { enqueued.push(jobId); },
    peek() { return []; },
    stats() { return { pending: 0, claimed: 0, done: 0, failed: 0 }; },
  };
}

/**
 * A billing seam with a price on the pack, for the one test that needs
 * checkout to get as far as Stripe. The pack in `config/credits.json` has
 * `stripePriceId: null` on purpose -- a Price is immutable and creating one is
 * gated on section 7 of the spec -- so the priced case cannot be reached
 * through the real config and is reached through the seam instead.
 */
function pricedBilling({ fetchImpl, envImpl }) {
  const real = createBilling({ fetchImpl, envImpl });
  const priced = { ...PACK, stripePriceId: 'price_test_placeholder' };
  return {
    ...real,
    async packs() { return [priced]; },
    async packFor(id) {
      if (id !== priced.id) return real.packFor(id);
      return priced;
    },
  };
}

/**
 * A billing seam with NO price on the pack.
 *
 * This used to be the real config and is now the constructed case. Until
 * 2026-08-25 `stripePriceId` was `null` -- a Price is immutable, so it was
 * deliberately the last thing to exist -- and two tests below leaned on that
 * to exercise "a pack that cannot be bought yet". A test-mode Price now exists,
 * so the unpriced state has to be built rather than borrowed.
 *
 * It is still worth testing: a pack can lose its Price again the moment one is
 * rotated, replaced for going live, or added for a second pack nobody has
 * priced yet, and the answer then must still be 503-and-no-request rather than
 * a call to Stripe with `price: null` in it.
 */
function unpricedBilling({ fetchImpl, envImpl }) {
  const real = createBilling({ fetchImpl, envImpl });
  const unpriced = { ...PACK, stripePriceId: null };
  return {
    ...real,
    async packs() { return [unpriced]; },
    async packFor(id) {
      if (id !== unpriced.id) return real.packFor(id);
      return unpriced;
    },
  };
}

async function withApp(run, { billing, nowImpl } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-billing-'));
  const app = createServer({
    root,
    cfg: CFG,
    queue: fakeQueue(),
    port: 0,
    billing,
    publicUrl: 'https://timestamp.example',
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed',
    logImpl: () => {},
    ...(nowImpl ? { nowImpl } : {}),
  });
  const port = await app.listen();
  try {
    await run({ base: `http://127.0.0.1:${port}`, root, app });
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** The real accounts module, against the temp root the server is using. */
async function authApi() {
  return import('../scripts/auth/accounts.mjs');
}

async function makeAccount(root, { email = EMAIL, password = PASSWORD } = {}) {
  const mod = await authApi();
  return mod.createAccount({ root, email, password });
}

/**
 * Mint a session for `accountId` through the REAL session surface --
 * `app.sessions` is exactly the `auths` object `POST /login` itself calls
 * `startSession` on -- rather than posting to `/login`.
 *
 * TASK 9 CHANGED WHAT `/login` DOES: it now asks Supabase first, and this
 * file's `createServer` call has no `supabase` configured (its subject is
 * the checkout and webhook routes, against the REAL `scripts/auth/accounts.mjs`
 * ledger, not identity), so `POST /login` here now answers 503. Calling
 * `startSession` directly is not a fake standing in for the real mechanism --
 * it IS the real mechanism, minus the Supabase round trip that would otherwise
 * have to be faked for no reason this file cares about. Login mechanics
 * themselves are covered in `test/web-auth-code.test.js` and
 * `test/web-auth.test.js`.
 */
async function signIn(app, accountId) {
  return app.sessions.startSession({ headers: {}, socket: {} }, accountId);
}

async function balanceOf(root, accountId) {
  const mod = await import('../scripts/auth/credits.mjs');
  return mod.balanceForId({ root, accountId });
}

async function ledgerOf(root, accountId) {
  const accounts = await authApi();
  const credits = await import('../scripts/auth/credits.mjs');
  return credits.ledgerFor(accounts.loadAccount({ root, accountId }));
}

/**
 * The rows a webhook wrote, and only those.
 *
 * A NEW ACCOUNT IS NOT EMPTY: `createAccount` grants the free plan's period
 * credits at signup, so an assertion on the total ledger length or on an
 * absolute balance would be an assertion about the signup grant. Every payment
 * row carries the Stripe event id in `ref`, and the signup grant carries none,
 * which makes the filter exact rather than approximate.
 */
async function paymentRows(root, accountId) {
  return (await ledgerOf(root, accountId)).filter((row) => row.ref !== null);
}

/** What the webhook actually moved. */
async function creditsGained(root, accountId, before) {
  return (await balanceOf(root, accountId)).credits - before;
}

// ---------------------------------------------------------------------------
// signing, in the test, independently of the module that verifies
// ---------------------------------------------------------------------------

function stripeSignature(body, { secret = WEBHOOK_SECRET, at = Math.floor(Date.now() / 1000) } = {}) {
  const mac = crypto.createHmac('sha256', secret).update(`${at}.${body}`, 'utf8').digest('hex');
  return `t=${at},v1=${mac}`;
}

function completedSession({
  id = 'evt_1',
  accountId,
  packId = PACK_ID,
  credits = PACK.credits,
  paymentStatus = 'paid',
  type = 'checkout.session.completed',
  // Real Stripe events always say which mode they are in. The fixture defaults
  // to live because that is the only kind of event a deployed server should
  // ever pay out on; the tests that need the other kind say so explicitly.
  livemode = true,
} = {}) {
  return JSON.stringify({
    id,
    type,
    livemode,
    data: {
      object: {
        id: 'cs_test_1',
        object: 'checkout.session',
        payment_status: paymentStatus,
        client_reference_id: accountId,
        metadata: { accountId, pack: packId, credits: String(credits) },
      },
    },
  });
}

async function deliver(base, body, { signature = null, contentType = 'application/json' } = {}) {
  return fetch(`${base}/api/stripe/webhook`, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      ...(signature === null ? {} : { 'stripe-signature': signature }),
    },
    body,
    redirect: 'manual',
  });
}

const configuredBilling = () => createBilling({
  envImpl: () => ({ STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }),
});

// ---------------------------------------------------------------------------
// the webhook: refusals first
// ---------------------------------------------------------------------------

test('an unsigned webhook grants nothing', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const before = (await balanceOf(root, account.accountId)).credits;

    const res = await deliver(base, completedSession({ accountId: account.accountId }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'NO_SIGNATURE');
    assert.equal(await creditsGained(root, account.accountId, before), 0, 'credits moved on an unsigned request');
  }, { billing: configuredBilling() });
});

test('a webhook signed with the wrong secret grants nothing', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const before = (await balanceOf(root, account.accountId)).credits;
    const body = completedSession({ accountId: account.accountId });

    const res = await deliver(base, body, { signature: stripeSignature(body, { secret: 'whsec_wrong' }) });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'SIGNATURE_MISMATCH');
    assert.equal(await creditsGained(root, account.accountId, before), 0);
  }, { billing: configuredBilling() });
});

/**
 * THE RAW-BODY TRAP, ASSERTED THROUGH HTTP RATHER THAN IN A UNIT TEST.
 *
 * `server.mjs` reads every other body through `readBody` -> `parseSmallBody`,
 * and a webhook route that did the same would reserialise the bytes Stripe
 * signed. This test signs one byte sequence and sends a different one that
 * parses to the identical object. It passes only if the handler hashed what
 * arrived on the socket.
 */
test('a webhook whose body was re-serialised is refused, which proves the route reads raw bytes', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const signed = completedSession({ accountId: account.accountId });
    const reserialised = JSON.stringify(JSON.parse(signed), null, 2);
    assert.notEqual(signed, reserialised, 'the two bodies must differ as bytes');
    assert.deepEqual(JSON.parse(signed), JSON.parse(reserialised), 'and must be the same object');

    const res = await deliver(base, reserialised, { signature: stripeSignature(signed) });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'SIGNATURE_MISMATCH');
    assert.deepEqual(await paymentRows(root, account.accountId), []);
  }, { billing: configuredBilling() });
});

test('a correctly signed webhook outside the replay window is refused', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const body = completedSession({ accountId: account.accountId });
    const stale = stripeSignature(body, { at: Math.floor(Date.now() / 1000) - 600 });

    const res = await deliver(base, body, { signature: stale });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'TIMESTAMP_OUTSIDE_TOLERANCE');
    assert.deepEqual(await paymentRows(root, account.accountId), []);
  }, { billing: configuredBilling() });
});

/**
 * A 503 rather than a 200. Answering 200 would tell Stripe the event was
 * handled and stop the retries, and the event would be gone -- money taken and
 * no credits, with nothing left to replay. A non-2xx keeps it in Stripe's
 * retry queue and puts it on the dashboard where somebody can see it.
 */
test('a webhook arriving before the signing secret is configured is a 503, not a 200', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const body = completedSession({ accountId: account.accountId });

    const res = await deliver(base, body, { signature: stripeSignature(body) });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, 'NO_WEBHOOK_SECRET');
    assert.deepEqual(await paymentRows(root, account.accountId), []);
  }, { billing: createBilling({ envImpl: () => ({}) }) });
});

// ---------------------------------------------------------------------------
// the webhook: the grant
// ---------------------------------------------------------------------------

test('a paid checkout session grants the pack, and the ledger says which event did it', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const opening = (await balanceOf(root, account.accountId)).credits;
    const body = completedSession({ id: 'evt_paid_1', accountId: account.accountId });

    const res = await deliver(base, body, { signature: stripeSignature(body) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, granted: true, credits: PACK.credits });

    assert.equal(await creditsGained(root, account.accountId, opening), PACK.credits);
    const rows = await paymentRows(root, account.accountId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].delta, PACK.credits);
    assert.equal(rows[0].ref, 'evt_paid_1', 'the Stripe event id is the idempotency key');
    assert.match(rows[0].reason, /^grant:pack:/);
  }, { billing: configuredBilling() });
});

/**
 * THE TEST THIS FILE EXISTS FOR.
 *
 * Stripe delivers the same event more than once. That is documented behaviour,
 * not an edge case, and as written before 2026-08-24 a redelivery granted the
 * credits again for free. The assertion is on the LEDGER ROW COUNT as well as
 * the balance, because a compensating pair of rows would leave the balance
 * right and the audit log a lie.
 */
test('the same event delivered twice grants exactly once', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const opening = (await balanceOf(root, account.accountId)).credits;
    const body = completedSession({ id: 'evt_replayed', accountId: account.accountId });
    const signature = stripeSignature(body);

    const first = await deliver(base, body, { signature });
    const second = await deliver(base, body, { signature: stripeSignature(body) });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200, 'a redelivery must be a 200, or Stripe retries the one thing that worked');
    assert.equal((await first.json()).granted, true);
    assert.equal((await second.json()).granted, false, 'the second delivery reported itself as a payment');

    assert.equal(await creditsGained(root, account.accountId, opening), PACK.credits);
    assert.equal((await paymentRows(root, account.accountId)).length, 1, 'the ledger grew twice for one payment');
  }, { billing: configuredBilling() });
});

/** Two genuinely different purchases are two grants. The dedupe is on the
 *  event id, so a customer who buys twice must not be refused the second one. */
test('two different events grant twice', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const opening = (await balanceOf(root, account.accountId)).credits;
    for (const id of ['evt_a', 'evt_b']) {
      const body = completedSession({ id, accountId: account.accountId });
      const res = await deliver(base, body, { signature: stripeSignature(body) });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).granted, true);
    }
    assert.equal(await creditsGained(root, account.accountId, opening), PACK.credits * 2);
    assert.equal((await paymentRows(root, account.accountId)).length, 2);
  }, { billing: configuredBilling() });
});

test('an unpaid session grants nothing and is not retried', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const body = completedSession({ accountId: account.accountId, paymentStatus: 'unpaid' });

    const res = await deliver(base, body, { signature: stripeSignature(body) });
    assert.equal(res.status, 200, 'a non-2xx would make Stripe retry an event we do not want');
    assert.equal((await res.json()).granted, false);
    assert.deepEqual(await paymentRows(root, account.accountId), []);
  }, { billing: configuredBilling() });
});

/**
 * A test-mode event is signed exactly as honestly as a live one -- the
 * signature proves who sent it, not that money moved. A test card costs its
 * holder nothing, and credits buy real renders at real provider cost, so a
 * paid-out test event would be free credits for anyone once the app is
 * deployed. Acknowledged with a 200 because Stripe did nothing wrong and must
 * not retry it; granted nothing because nothing was paid.
 */
test('a test-mode session grants nothing and is not retried', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const body = completedSession({ accountId: account.accountId, livemode: false });

    const res = await deliver(base, body, { signature: stripeSignature(body) });
    assert.equal(res.status, 200, 'a non-2xx would make Stripe retry an event we will never honour');
    assert.deepEqual(await res.json(), { ok: true, granted: false, ignored: 'testmode' });
    assert.deepEqual(await paymentRows(root, account.accountId), []);
  }, { billing: configuredBilling() });
});

/** Absence is not a yes. An event that does not say which mode it is in is
 *  treated exactly like a test one, because the safe reading of a missing
 *  field is the one that grants nothing. */
test('a session that does not say which mode it is in grants nothing', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const raw = JSON.parse(completedSession({ accountId: account.accountId }));
    delete raw.livemode;
    const body = JSON.stringify(raw);

    const res = await deliver(base, body, { signature: stripeSignature(body) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, granted: false, ignored: 'testmode' });
    assert.deepEqual(await paymentRows(root, account.accountId), []);
  }, { billing: configuredBilling() });
});

/** One event is handled, because there is one pack. Everything else is
 *  acknowledged so Stripe stops retrying events this product does not care
 *  about. */
test('an event this product does not handle is acknowledged and does nothing', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const body = completedSession({ accountId: account.accountId, type: 'invoice.paid' });

    const res = await deliver(base, body, { signature: stripeSignature(body) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).granted, false);
    assert.deepEqual(await paymentRows(root, account.accountId), []);
  }, { billing: configuredBilling() });
});

/**
 * A verified payment naming an account that is not there is money taken with
 * nowhere to put it. A 200 would make it disappear; a 5xx keeps it in Stripe's
 * retry queue and on the failed-events list, which is where a human can find
 * it.
 */
test('a paid session for an account that does not exist is not quietly acknowledged', async () => {
  await withApp(async ({ base }) => {
    const body = completedSession({ accountId: '0'.repeat(32) });
    const res = await deliver(base, body, { signature: stripeSignature(body) });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error.code, 'NO_SUCH_ACCOUNT');
  }, { billing: configuredBilling() });
});

test('a paid session with no account on it grants nothing', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const body = completedSession({ accountId: undefined });
    const res = await deliver(base, body, { signature: stripeSignature(body) });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error.code, 'NO_ACCOUNT_ON_SESSION');
    assert.deepEqual(await paymentRows(root, account.accountId), []);
  }, { billing: configuredBilling() });
});

/**
 * The credit count is the one the customer was quoted when they paid, written
 * into the session's metadata at checkout, and it is trusted BECAUSE the
 * signature has already proved Stripe sent it. A number a browser could have
 * chosen never reaches this path -- the browser posts a pack id and nothing
 * else.
 */
test('the grant honours the credits promised at checkout, not a number in a request', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const opening = (await balanceOf(root, account.accountId)).credits;
    const body = completedSession({ id: 'evt_promise', accountId: account.accountId, credits: 7 });

    const res = await deliver(base, body, { signature: stripeSignature(body) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).credits, 7);
    assert.equal(await creditsGained(root, account.accountId, opening), 7);
  }, { billing: configuredBilling() });
});

test('a session whose metadata names no credits falls back to the pack in config', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const opening = (await balanceOf(root, account.accountId)).credits;
    const raw = JSON.parse(completedSession({ id: 'evt_nometa', accountId: account.accountId }));
    delete raw.data.object.metadata.credits;
    const body = JSON.stringify(raw);

    const res = await deliver(base, body, { signature: stripeSignature(body) });
    assert.equal(res.status, 200);
    assert.equal(await creditsGained(root, account.accountId, opening), PACK.credits);
  }, { billing: configuredBilling() });
});

test('a session that names neither a known pack nor a credit count is not guessed at', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const raw = JSON.parse(completedSession({ id: 'evt_junk', accountId: account.accountId }));
    raw.data.object.metadata = { accountId: account.accountId, pack: 'a-pack-that-was-deleted' };
    const body = JSON.stringify(raw);

    const res = await deliver(base, body, { signature: stripeSignature(body) });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error.code, 'NO_CREDITS_FOR_SESSION');
    assert.deepEqual(await paymentRows(root, account.accountId), []);
  }, { billing: configuredBilling() });
});

test('the webhook needs no session and sets no cookie', async () => {
  await withApp(async ({ base, root }) => {
    const account = await makeAccount(root);
    const body = completedSession({ id: 'evt_nocookie', accountId: account.accountId });
    const res = await deliver(base, body, { signature: stripeSignature(body) });
    assert.equal(res.status, 200);
    assert.deepEqual(res.headers.getSetCookie(), []);
  }, { billing: configuredBilling() });
});

// ---------------------------------------------------------------------------
// checkout
// ---------------------------------------------------------------------------

async function buy(base, cookie, body, { accept = 'application/json' } = {}) {
  return fetch(`${base}/api/billing/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept, cookie },
    body: new URLSearchParams(body),
    redirect: 'manual',
  });
}

/**
 * PRESSING BUY WHILE SIGNED OUT HAS TO END SOMEWHERE A PERSON CAN STAND.
 *
 * The gate used to carry the pathname of whatever was blocked, which is right
 * for a GET and wrong for a POST: a visitor who pressed Buy on /pricing went to
 * `/login?next=/api/billing/checkout`, signed in, and was redirected onto a
 * route that only answers POST -- a 405 at the end of the one path this page
 * exists to open. The checkout form cannot carry its own return field (the test
 * below holds it to exactly one input), so the Referer is the only thing left
 * that knows where the person was.
 */
test('pressing Buy while signed out returns to the page it was pressed on', async () => {
  await withApp(async ({ base }) => {
    const res = await fetch(`${base}/api/billing/checkout`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        accept: 'text/html',
        referer: `${base}/pricing`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'pack=starter',
    });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/login?next=%2Fpricing');
  }, { billing: configuredBilling() });
});

/**
 * AND A REFERER IS A HEADER A CLIENT CHOOSES. It is read for convenience and
 * trusted for nothing: a cross-origin one is dropped rather than followed, so
 * the worst a forged header buys is the plain login page. A JSON caller still
 * gets a status code it can branch on instead of an HTML form.
 */
test('a forged or absent Referer falls back to the plain login page', async () => {
  await withApp(async ({ base }) => {
    const post = (headers) => fetch(`${base}/api/billing/checkout`, {
      method: 'POST', redirect: 'manual', body: 'pack=starter',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    });

    const forged = await post({ accept: 'text/html', referer: 'https://evil.example/attack' });
    assert.equal(forged.status, 303);
    assert.equal(forged.headers.get('location'), '/login', 'a cross-origin Referer was followed');

    const bare = await post({ accept: 'text/html' });
    assert.equal(bare.headers.get('location'), '/login');

    const json = await post({});
    assert.equal(json.status, 401, 'a JSON client must get a code, not a redirect');
    assert.equal((await json.json()).error.code, 'NOT_SIGNED_IN');
  }, { billing: configuredBilling() });
});

test('checkout refuses a pack the config does not name', async () => {
  await withApp(async ({ base, root, app }) => {
    const account = await makeAccount(root);
    const cookie = await signIn(app, account.accountId);
    const res = await buy(base, cookie, { pack: 'unlimited-everything' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'UNKNOWN_PACK');
  }, { billing: configuredBilling() });
});

/**
 * A pack whose Price does not exist is a 503 AND NOT A 400, because the gap is
 * ours: the customer asked for something real and the immutable object it needs
 * has not been created. It must also not reach Stripe -- a checkout request
 * carrying `price: null` is a round trip to be told what we already knew.
 */
test('a pack with no Stripe Price cannot be bought, and no request is attempted', async () => {
  const calls = [];
  const fetchImpl = async (...args) => { calls.push(args); throw new Error('this must not run'); };
  await withApp(async ({ base, root, app }) => {
    const account = await makeAccount(root);
    const cookie = await signIn(app, account.accountId);
    const res = await buy(base, cookie, { pack: PACK_ID });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, 'CHECKOUT_NOT_OPEN');
    assert.deepEqual(calls, [], 'a Stripe request was attempted for a pack with no price');
  }, {
    billing: unpricedBilling({
      fetchImpl,
      envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }),
    }),
  });
});

test('a priced pack sends the account id to Stripe and nothing a browser chose', async () => {
  let sent = null;
  const fetchImpl = async (url, init) => {
    sent = { url: String(url), body: new URLSearchParams(init.body) };
    return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  await withApp(async ({ base, root, app }) => {
    const account = await makeAccount(root);
    const cookie = await signIn(app, account.accountId);

    // The extra fields are what a tampered form would carry. None of them may
    // reach Stripe.
    const res = await buy(base, cookie, {
      pack: PACK_ID, credits: '99999', amount: '1', priceUSD: '0.01', price: 'price_free',
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { url: 'https://checkout.stripe.com/c/pay/cs_1', sessionId: 'cs_1' });

    assert.ok(sent, 'no request was made');
    assert.equal(sent.body.get('client_reference_id'), account.accountId);
    assert.equal(sent.body.get('line_items[0][price]'), 'price_test_placeholder');
    assert.equal(sent.body.get('metadata[credits]'), String(PACK.credits));
    assert.equal(sent.body.get('amount'), null);
    assert.equal(sent.body.get('priceUSD'), null);
    assert.equal(sent.body.get('success_url'), 'https://timestamp.example/pricing?checkout=done');
    assert.equal(sent.body.get('cancel_url'), 'https://timestamp.example/pricing?checkout=cancelled');
  }, {
    billing: pricedBilling({
      fetchImpl,
      envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }),
    }),
  });
});

test('a browser is redirected to the hosted page rather than shown a JSON body', async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
  await withApp(async ({ base, root, app }) => {
    const account = await makeAccount(root);
    const cookie = await signIn(app, account.accountId);
    const res = await buy(base, cookie, { pack: PACK_ID }, { accept: 'text/html' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), 'https://checkout.stripe.com/c/pay/cs_1');
  }, {
    billing: pricedBilling({
      fetchImpl,
      envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }),
    }),
  });
});

/** The redirect is the one thing on this path that leaves our origin, so the
 *  destination is checked rather than trusted. A checkout url that is not
 *  Stripe's is a compromised response. */
test('a checkout url that is not Stripe is never redirected to', async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({ id: 'cs_1', url: 'https://evil.example/c/pay/cs_1' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
  await withApp(async ({ base, root, app }) => {
    const account = await makeAccount(root);
    const cookie = await signIn(app, account.accountId);
    const res = await buy(base, cookie, { pack: PACK_ID }, { accept: 'text/html' });
    assert.equal(res.status, 502);
    assert.equal(res.headers.get('location'), null);
  }, {
    billing: pricedBilling({
      fetchImpl,
      envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }),
    }),
  });
});

test('checkout grants nothing on its own -- only the webhook does', async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
  await withApp(async ({ base, root, app }) => {
    const account = await makeAccount(root);
    const cookie = await signIn(app, account.accountId);
    await buy(base, cookie, { pack: PACK_ID });
    assert.deepEqual(await paymentRows(root, account.accountId), []);

    // Nor does landing on the success page, which anybody can visit.
    const done = await fetch(`${base}/pricing?checkout=done`, { headers: { cookie, accept: 'text/html' } });
    assert.equal(done.status, 200);
    assert.deepEqual(await paymentRows(root, account.accountId), []);
  }, {
    billing: pricedBilling({
      fetchImpl,
      envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }),
    }),
  });
});

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

test('the pricing page offers the pack, and never a payment field', async () => {
  await withApp(async ({ base }) => {
    const html = await (await fetch(`${base}/pricing`, { headers: { accept: 'text/html' } })).text();
    assert.ok(html.includes(PACK.label), 'the pack is not on the pricing page');
    assert.ok(html.includes(`${PACK.priceUSD}`), 'the price is not on the pricing page');
    // THE RULE THE WHOLE DESIGN IS BUILT AROUND, and it holds whether or not
    // the pack can currently be bought. The card is entered on Stripe's domain
    // and there is nowhere on this page to type one.
    assert.ok(!/name="(card|cvv|cvc|number|pan)"/i.test(html), 'a payment field reached the pricing page');
    assert.match(html, /action="\/api\/billing\/checkout"/, 'the buy form is missing');
  }, { billing: configuredBilling() });
});

/** A pack with a Price is buyable, and the button says so. */
test('a priced pack renders a live buy button', async () => {
  await withApp(async ({ base }) => {
    const html = await (await fetch(`${base}/pricing`, { headers: { accept: 'text/html' } })).text();
    // The button names the rung it buys -- "Buy Starter", not "Buy credits" --
    // because since 2026-08-27 there is more than one rung on the page and a
    // row of identical buttons is the thing that made the old ladder
    // unchoosable in the first place.
    assert.match(html, /Buy \w+/, 'the button does not offer to sell anything');
    assert.ok(!/<button[^>]*\sdisabled/.test(html), 'the buy button is disabled while a Price exists');
  }, {
    billing: pricedBilling({
      fetchImpl: async () => { throw new Error('the page must not call Stripe'); },
      envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }),
    }),
  });
});

/**
 * And a pack WITHOUT one renders disabled, with a sentence rather than a dead
 * button. This is the state the repo shipped in from 2026-08-25 morning until a
 * test Price existed, and it is the state it returns to whenever a Price is
 * rotated or a new pack is added before anybody prices it.
 */
test('an unpriced pack renders disabled and says why', async () => {
  await withApp(async ({ base }) => {
    const html = await (await fetch(`${base}/pricing`, { headers: { accept: 'text/html' } })).text();
    assert.match(html, /<button[^>]*\sdisabled/, 'the buy button is live while there is no Stripe Price');
    assert.match(html, /Not open yet/, 'the disabled button does not say what is wrong');
    assert.match(html, /Nothing is charged here/i, 'the page does not reassure that nothing is charged');
  }, {
    billing: unpricedBilling({
      fetchImpl: async () => { throw new Error('the page must not call Stripe'); },
      envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }),
    }),
  });
});

test('the success page thanks without claiming the credits have landed', async () => {
  await withApp(async ({ base }) => {
    const html = await (await fetch(`${base}/pricing?checkout=done`, { headers: { accept: 'text/html' } })).text();
    assert.match(html, /moment|shortly|soon/i, 'the success page asserts a grant it cannot know about');
  }, { billing: configuredBilling() });
});

test('an over-cap body gets a readable 413, not a connection reset', async () => {
  // `readRawBody` called `req.destroy()` and only then rejected, so the catch
  // that writes the refusal was writing onto a socket that no longer existed.
  // Every over-cap body therefore presented as a transport error rather than
  // an answer -- on /login, /signup, /api/billing/checkout, the still-select
  // route and this one.
  //
  // The multipart parser two files over goes to documented lengths to avoid
  // exactly this and says why in its own comment: "a refusal nobody can read
  // is indistinguishable from a broken server". It uses `pause()`. This path
  // did not.
  //
  // The webhook is the route under test because it takes the largest body and
  // needs no anti-forgery pair, so the size refusal is the only thing in the
  // way. Stripe is the caller that would have seen this: a delivery too large
  // got a reset, which its dashboard reports as an endpoint failure with no
  // status at all.
  await withApp(async ({ base }) => {
    const res = await fetch(`${base}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
      body: 'x'.repeat(256 * 1024),
    });
    assert.equal(res.status, 413, 'the over-cap body did not get a status');
    const text = await res.text();
    assert.match(text, /large/i, `the 413 carried no readable reason: ${text.slice(0, 120)}`);
  }, { billing: configuredBilling() });
});

test('only the two notices this app wrote can be put on the billing page', async () => {
  // `?checkout=` is a value a stranger types, and the notice it selects is
  // looked up in an object literal. A bare `LOOKUP[key]` reaches the prototype
  // as well as the literal, so `?checkout=constructor` renders the source text
  // of `function Object()` inside a `<p class="notice">` -- on the one page in
  // this product that handles money, which is where attacker-chosen content in
  // a trusted-looking element is worth the least.
  //
  // NOT XSS: `h()` escapes it, and that was verified rather than assumed. The
  // objection is that a page which is supposed to be able to say exactly two
  // things can be made to say something else at all.
  //
  // The unknown key is asserted alongside the prototype ones so this cannot
  // pass by making the page refuse everything.
  await withApp(async ({ base }) => {
    const notice = async (q) => {
      const html = await (await fetch(`${base}/pricing?checkout=${q}`, { headers: { accept: 'text/html' } })).text();
      return html.match(/<p class="notice">([\s\S]*?)<\/p>/)?.[1] ?? null;
    };

    assert.ok((await notice('done'))?.length, 'the real success notice stopped rendering');
    assert.ok((await notice('cancelled'))?.length, 'the real cancelled notice stopped rendering');

    for (const key of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'nonsense']) {
      assert.equal(await notice(key), null,
        `?checkout=${key} put content on the billing page that this app never wrote`);
    }
  }, { billing: configuredBilling() });
});

// ---------------------------------------------------------------------------
// the command line
// ---------------------------------------------------------------------------

/**
 * The public url exists for exactly one reason: Stripe navigates a real browser
 * to whatever this app puts in `success_url`, and deriving that from the
 * request's `Host` header would let a caller choose it. So it is a flag and an
 * environment variable, and neither is read from a request. An unrecognised
 * flag throws rather than being ignored, which is what stops `--public_url`
 * from silently doing nothing.
 */
test('the web command takes a public url, and refuses one it does not know', async () => {
  const { parseArgs } = await import('../scripts/web/server-cli.mjs');
  assert.equal(parseArgs(['--public-url=https://timestamp.example']).publicUrl, 'https://timestamp.example');
  assert.equal(parseArgs([]).publicUrl, process.env.TIMESTAMP_PUBLIC_URL || null);
  assert.throws(() => parseArgs(['--public_url=https://timestamp.example']), /unknown option/);
});

/** A trailing slash on the configured base would produce `//pricing`, which is
 *  a protocol-relative url the moment anything strips the scheme. */
test('a public url with a trailing slash does not become a double slash', async () => {
  let sent = null;
  const fetchImpl = async (url, init) => {
    sent = new URLSearchParams(init.body);
    return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-billing-'));
  const app = createServer({
    root,
    cfg: CFG,
    queue: fakeQueue(),
    port: 0,
    publicUrl: 'https://timestamp.example///',
    billing: pricedBilling({
      fetchImpl,
      envImpl: () => ({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }),
    }),
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed',
    logImpl: () => {},
  });
  const port = await app.listen();
  try {
    const base = `http://127.0.0.1:${port}`;
    const account = await makeAccount(root);
    const cookie = await signIn(app, account.accountId);
    await buy(base, cookie, { pack: PACK_ID });
    assert.equal(sent.get('success_url'), 'https://timestamp.example/pricing?checkout=done');
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
