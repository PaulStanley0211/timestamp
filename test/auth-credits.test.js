/**
 * Credits: the cost of a render, the ledger it is spent from, and the race that
 * is the whole reason the debit happens at enqueue.
 *
 * WHY THE CONCURRENCY TESTS USE THREADS. `debitCredits` is synchronous. Calling
 * it four times in a row in one thread proves nothing about four renders
 * started at once, because each call simply observes the previous one's
 * finished work -- the one interleaving that cannot fail. The bug being
 * defended against is the opposite shape: several callers that all READ the
 * same balance before any of them WRITES, at which point a balance covering
 * three renders funds twelve, and nine of them are real invoices from a real
 * provider.
 *
 * So the contenders are real `node:worker_threads`, they each load the account
 * BEFORE the barrier -- which is what makes every one of them hold a stale
 * balance, exactly as twelve HTTP requests would -- and they are released by one
 * `Atomics.notify`. The overlap is proved rather than hoped for: each thread
 * bumps a shared in-flight counter around the call and records the high-water
 * mark, and the test fails if that mark is 1. This is the harness from
 * test/queue-race.test.js, deliberately, because it is the standard here and its
 * author mutation-tested the result.
 *
 * THE OTHER TEST THAT MATTERS is the replay: a long pseudo-random sequence of
 * grants, debits and refunds, after which the balance must equal the sum of the
 * ledger and the running balance on every line must equal the sum of the lines
 * above it. That is the property that makes this auditable -- a balance which
 * can disagree with its own history has no way to tell you which of the two is
 * wrong, and this is the part of the system where being wrong is somebody's
 * money. The sequence is seeded, because a money test that behaves differently
 * on each run is a money test nobody can debug.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { aspectIds } from '../scripts/tapedeck/frame.mjs';
import {
  PLANS,
  createAccount,
  creditConfig,
  loadAccount,
  setPlan,
  updateAccount,
} from '../scripts/auth/accounts.mjs';
import {
  ALL_RESOLUTIONS,
  CREDIT_COSTS,
  CREDIT_DEFAULTS,
  PAID_STEPS,
  RESOLUTIONS,
  TIERS,
  balanceForId,
  balanceOf,
  creditCost,
  debitCredits,
  estimatedUSD,
  grantCredits,
  grantPlanPeriod,
  ledgerFor,
  providerWasCalled,
  refundCredits,
  refundIfUnspent,
} from '../scripts/auth/credits.mjs';
import {
  createOwnerRefunds, listMissedRefunds, settleMissedRefund,
} from '../scripts/web/session-middleware.mjs';

const ACCOUNTS_URL = new URL('../scripts/auth/accounts.mjs', import.meta.url).href;
const CREDITS_URL = new URL('../scripts/auth/credits.mjs', import.meta.url).href;

const T0 = Date.UTC(2026, 7, 20, 14, 45, 0);
const clock = (ms = T0) => () => new Date(ms);
const iso = (ms) => new Date(ms).toISOString();
const JOB = (n) => `20260820-1445${String(n).padStart(2, '0')}-a3f19c`;

/** The shapes the order form actually offers. Read from the same file the page
 *  reads, so a shape added there joins the free-grant check without an edit. */
const RENDER_CFG = JSON.parse(fs.readFileSync(new URL('../config/render.json', import.meta.url), 'utf8'));

/** One 15-second tape at the default resolution: the unit the whole plan ladder
 *  is built out of. */
const TAPE = creditCost();
/** What a new account opens with. DERIVED, never spelled: this number moved
 *  from 16 to 42 on 2026-08-25 when a metered delivery put a 480p tape at 21
 *  credits, and every test below that had written it as a literal broke. */
const FREE = PLANS.free.creditsPerPeriod;

/** Put an account on an exact balance, with a ledger line saying why. The race
 *  tests below need a balance that covers exactly N renders, and BORROWING one
 *  from a plan couples a concurrency guard to the price list -- which is how
 *  they all failed when the price list was corrected. */
function setBalance(account, target, nowImpl) {
  const delta = target - balanceOf(account).credits;
  if (delta !== 0) grantCredits(account, { credits: delta, reason: 'test:set-balance', nowImpl });
  assert.equal(balanceOf(account).credits, target);
  return account;
}

function makeRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-credits-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir.replace(/\\/g, '/');
}

function signUp(root, { plan = 'free', at = T0, email = 'paul@example.com' } = {}) {
  return createAccount({ root, email, password: 'correct-horse-battery', plan, nowImpl: clock(at) });
}

/** A manifest-shaped job, only as much of one as `providerWasCalled` reads. */
function jobWith(steps, jobId = JOB(1)) {
  return { jobId, steps: steps.map(([name, attempts]) => ({ name, attempts })) };
}

const grab = (fn) => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw and got none');
};

// --------------------------------------------------------------------------
// what a render costs
// --------------------------------------------------------------------------

/**
 * THE ANCHOR SURVIVES; ITS DERIVATION DID NOT.
 *
 * This test used to pin 720p's price to the formula applied to 1280x720 -- a
 * 16:9 frame this product never orders and fal has never sent. It passed for
 * five days because two errors cancelled: the nominal frame was too big and the
 * ignored upscale was too small, and the answer landed within three cents of
 * the truth. On 2026-08-25 the delivered raster was measured at 1112x834 and
 * the real figure is $4.5646, so the coincidence broke by 2.9 cents.
 *
 * What replaces the formula assertion is the one in 'every offered tier is
 * priced from the raster fal actually delivered', which pins the same link to
 * a measurement rather than to a nominal frame. What is kept here is the part
 * that was never about the arithmetic: every number in the money path has to
 * say what KIND of number it is, and the vocabulary now includes MEASURED.
 */
test('every number in the money path says what kind of number it is', async () => {
  const cfg = creditConfig();
  assert.equal(cfg.provider.anchorResolution, '720p');
  for (const id of ALL_RESOLUTIONS) {
    assert.match(cfg.resolutions[id]._comment, /MEASURED|ESTIMATE|DEFERRED/,
      `${id} does not say whether its price was measured or guessed`);
  }
  // And a tier that is actually on sale may not still call itself a guess.
  for (const id of RESOLUTIONS) {
    assert.match(cfg.resolutions[id]._comment, /MEASURED/,
      `${id} is on offer and its price is still a guess`);
  }
});

test('the free grant buys the default shape, and nothing it cannot buy is a surprise', () => {
  // THE OWNER FIXED THIS NUMBER AT 21 ON 2026-08-31 -- "for a free video, make
  // it 21 credits. It's final." It was briefly 42 earlier the same day, for the
  // reason below, and he overruled it. So this test does NOT assert that a free
  // account can afford every shape: it cannot, by his decision. It asserts the
  // two things that must hold WHATEVER the number is.
  //
  // ONE: A NEW ACCOUNT IS NEVER STRANDED. The grant must buy at least the
  // default shape at the cheapest tier. That is section 26 finding 4, which is
  // the whole reason the grant had to move off 16 credits: at 16 an account
  // could "sign up, see a balance, and be refused at the button", with no tape
  // reachable at all. A grant that buys nothing is the one state that is always
  // a bug rather than a pricing choice.
  //
  // TWO: WHAT IT CANNOT BUY IS PRICED, NOT HIDDEN. 21 buys one 480p tape in 4:3
  // and nothing in 16:9 or 9:16, which cost 28 -- a non-4:3 shape is 4/3 the
  // pixels because a resolution label holds the short edge. That is legitimate
  // and it is the shape of the free tier. What would NOT be legitimate is the
  // page showing 21 CR and letting somebody choose the phone shape, upload a
  // photograph, and only then meet a 402. So every shape the order form offers
  // must have a computable price for the warning to quote -- the surfaces that
  // print it are pinned in web-static and web-api, and this is the arithmetic
  // they rest on.
  const free = PLANS.free.creditsPerPeriod;
  const cheapest = creditCost({ resolution: '480p' });

  assert.ok(free >= cheapest,
    `the free grant of ${free} cannot buy even the cheapest tape (${cheapest} CR) -- a balance `
    + 'that buys nothing is section 26 finding 4 all over again');

  for (const aspect of aspectIds(RENDER_CFG)) {
    const cost = creditCost({ resolution: '480p', aspect });
    assert.ok(Number.isFinite(cost) && cost > 0,
      `480p in ${aspect} has no price, so the order page cannot warn about it before the upload`);
  }

  // The free tier is the CHEAP tier on purpose: the free tape proves the
  // likeness at 480p and the paid rungs are what a person buys once they
  // believe it. A grant that reached 720p would be giving the paid tier away.
  const cheapest720 = creditCost({ resolution: '720p' });
  assert.ok(free < cheapest720,
    `the free grant of ${free} reaches a 720p tape (${cheapest720} CR); the free tier is the `
    + 'cheap tier on purpose');
});

test('the numbers: 21 credits at 480p, 46 at 720p, measured', async () => {
  // RESCALED 2026-08-21, when creditUSD moved from $0.03 to $0.10 at Paul's
  // direction. The reason was legibility, not economics: 51 and 152 are ugly
  // numbers that read as arbitrary. Every plan's creditsPerPeriod moved in the
  // same edit, so a plan buys exactly the tapes it bought before -- which is
  // why the RATIO assertions below are unchanged and still pass. They are the
  // ones that matter: they encode the cost relationships, and a rescale must
  // not touch them. If a future edit changes a ratio, that is a pricing
  // decision and not a rescale, and it should be argued rather than absorbed.
  assert.equal(creditCost({ resolution: '480p' }), 21);
  assert.equal(creditCost({ resolution: '720p' }), 46);
  assert.equal(TAPE, 21, 'the default is 480p, the cheap tier');

  // A SHAPE THAT IS NOT 4:3 COSTS 4/3, AND THE PRICE SAYS SO.
  //
  // 4:3 is the squarest shape this product ships and a resolution label holds
  // the SHORT edge, so 16:9 and 9:16 are exactly 4/3 the pixels at the same
  // tier -- 854x480 against 640x480. fal bills tokens as pixels x seconds, so
  // that is 4/3 the provider cost, and charging the 4:3 price for it would
  // sell every wide tape a third below cost.
  //
  // THIS IS NOT A HYPOTHETICAL FAILURE MODE. 480p sat at 16 CR against a real
  // 21 for weeks, invisible from both ends, because the button, the ledger and
  // the manifest all agreed on the same wrong number. The only thing that
  // catches it is an assertion tying the price to the pixels.
  // 61 AND NOT 62, AND THE DIFFERENCE IS WHERE THE ROUNDING HAPPENS. The
  // multiplier applies to the DOLLAR figure and the ceiling is taken once, at
  // the end: $4.5646 x 4/3 / $0.10 = 60.86 -> 61. Multiplying the already-
  // rounded 46 CR instead gives 61.33 -> 62, which charges a credit for a
  // rounding step rather than for pixels. Rounding twice always inflates, and
  // `creditsFor` has taken the ceiling once since it was written.
  assert.equal(creditCost({ resolution: '480p', aspect: '16:9' }), 28);
  assert.equal(creditCost({ resolution: '480p', aspect: '9:16' }), 28);
  assert.equal(creditCost({ resolution: '720p', aspect: '16:9' }), 61);
  assert.equal(creditCost({ resolution: '720p', aspect: '9:16' }), 61);
  assert.equal(creditCost({ resolution: '480p', aspect: '4:3' }), 21,
    'naming the default shape must cost the same as not naming it');

  // The two non-default shapes cost the same as each other: a portrait tape and
  // a landscape one are the same pixels turned ninety degrees.
  for (const id of ['480p', '720p']) {
    assert.equal(creditCost({ resolution: id, aspect: '16:9' }), creditCost({ resolution: id, aspect: '9:16' }),
      `${id}: a shape and its rotation are priced differently`);
  }

  // An unknown shape is REFUSED, never quietly charged at the 4:3 price. Same
  // reasoning as an unknown resolution directly below: a silent fallback bills
  // for one thing and renders another.
  // `1:1` is in this list on purpose. It is not a nonsense string -- it is a
  // shape somebody could plausibly add to config/render.json tomorrow -- and it
  // must be refused until it is PRICED, because holding the short edge makes a
  // square tape 0.75x the pixels of 4:3, not 4/3. That is why the multiplier is
  // per shape rather than one number for "not the default".
  for (const bad of ['16x9', 'square', '1:1']) {
    const e = grab(() => creditCost({ resolution: '480p', aspect: bad }));
    assert.equal(e.code, 'UNKNOWN_ASPECT', `${JSON.stringify(bad)} was priced instead of refused`);
  }
  // null means UNSPECIFIED, not malformed, and takes the default -- matching
  // `resolutionRaster`, so a shape cannot be priced by one rule and rendered
  // by another.
  assert.equal(creditCost({ resolution: '480p', aspect: null }), 21);
  assert.deepEqual(CREDIT_DEFAULTS, { resolution: '480p', seconds: 15, tier: 'standard' });

  const cr = (id) => CREDIT_COSTS[id].creditsPerReference;

  // THE RATIO CHANGED, AND THAT IS A FINDING RATHER THAN A RESCALE. This
  // assertion used to require 480p to be about a THIRD of 720p, on the stated
  // theory that pixel count is not the whole rate because fal's fast Seedance
  // tier tops out at 720p and the tiers are priced differently. Three metered
  // deliveries say otherwise: 752x560 costs $2.0727 and 1112x834 costs $4.5646,
  // a ratio of 0.454, which is the PIXEL ratio to three decimal places. fal
  // bills tokens, tokens are pixels x seconds, and there is no separate tier
  // rate hiding in it. The old comment reasoned its way to a third and the
  // invoice says otherwise.
  const px = (id) => {
    const d = creditConfig().resolutions[id].delivered;
    return d.width * d.height;
  };
  assert.ok(
    Math.abs((cr('480p') / cr('720p')) - (px('480p') / px('720p'))) < 0.01,
    `credits are billed by pixels: 480p:720p is ${(cr('480p') / cr('720p')).toFixed(3)} in credits and ${(px('480p') / px('720p')).toFixed(3)} in pixels`,
  );
  assert.ok(Math.abs(cr('1080p') / cr('720p') - 2.25) < 0.05, `1080p:720p is ${(cr('1080p') / cr('720p')).toFixed(3)}`);

  // The consequence, asserted so that nobody quotes a price without meeting it:
  // one 720p tape is very nearly a whole Shelf period, and 1080p is out of
  // reach of every plan there is.
  assert.ok(cr('720p') <= PLANS.shelf.creditsPerPeriod);
  assert.ok(cr('1080p') > PLANS.archive.creditsPerPeriod);

  // AND THE ONE A CUSTOMER MEETS FIRST: the free grant buys 480p tapes and no
  // 720p one. That is the shape of the free tier rather than an oversight --
  // the free tape proves the likeness, and the paid tier is what somebody buys
  // once they believe it.
  assert.ok(FREE >= cr('480p'), 'the free grant does not cover a single tape');
  assert.ok(FREE < cr('720p'), 'the free grant reaches the paid tier');
});

test('480p and 720p ship; 1080p is present, deferred, and refused rather than substituted', async () => {
  assert.deepEqual(ALL_RESOLUTIONS, ['480p', '720p', '1080p'], 'the deferred row stays, with its reasoning');
  assert.deepEqual(RESOLUTIONS, ['480p', '720p'], 'and only these two may be ordered');
  assert.equal(CREDIT_COSTS['1080p'].available, false);
  assert.equal(CREDIT_COSTS['720p'].available, true);

  const err = grab(() => creditCost({ resolution: '1080p' }));
  assert.equal(err.code, 'RESOLUTION_UNAVAILABLE');
  assert.match(err.userMessage, /not available yet/);
  assert.deepEqual(err.detail.available, ['480p', '720p']);
  // A SILENT FALLBACK WOULD BILL FOR ONE THING AND RENDER ANOTHER: the button
  // says one number, the ledger says the same number, and the video is not what
  // was ordered. Nothing the customer can see would reveal it, which is why
  // this throws instead of quietly choosing 720p.
  assert.notEqual(err.code, 'UNKNOWN_RESOLUTION', 'deferred and unknown are different facts');
  assert.equal(grab(() => creditCost({ resolution: '4k' })).code, 'UNKNOWN_RESOLUTION');

  // The reasoning stays attached to the row, so turning it on later is a
  // one-field change rather than an archaeology exercise.
  assert.match(creditConfig().resolutions['1080p']._comment, /736x588/,
    'the measurement that justifies deferring it stays with the entry');
  assert.match(creditConfig().resolutions['480p']._comment, /BELOW the tape raster/,
    '480p is upscaled, and that is the one thing about it that is not obvious');
});

test('cost is linear in seconds and rounds up', async () => {
  // THE PROPERTY, NOT AN EXAMPLE. This test used to assert 31 < 32 at 480p --
  // a genuine consequence of rounding when a tape cost 15.1 credits. At the
  // measured price a tape is exactly 20.727, the two figures come out equal,
  // and the old assertion failed while the behaviour it was defending was
  // completely intact. An example that only holds for one price is a test of
  // that price. So: assert that every quote is the exact cost rounded UP, at
  // every duration, and that splitting a render never costs less than not
  // splitting it.
  //
  // Rounding up is deliberate. Rounding down gives away a fraction of a credit
  // on every render, in the same direction every time, and no line item ever
  // explains it.
  const cfg = creditConfig();
  for (const id of RESOLUTIONS) {
    const per15 = cfg.resolutions[id].estimatedUSDPer15s;
    for (const seconds of [4, 7.5, 15, 30, 61]) {
      const exact = (per15 * (seconds / cfg.referenceSeconds)) / cfg.creditUSD;
      const quoted = creditCost({ resolution: id, seconds });
      assert.equal(quoted, Math.ceil(exact),
        `${id} at ${seconds}s: quoted ${quoted}, exact ${exact.toFixed(4)}`);
      assert.ok(quoted >= exact, `${id} at ${seconds}s rounds DOWN, which gives credits away silently`);
    }
    // Two halves are never cheaper than the whole, whatever the price is.
    assert.ok(creditCost({ resolution: id, seconds: 15 }) * 2
      >= creditCost({ resolution: id, seconds: 30 }));
  }
  assert.equal(CREDIT_COSTS['720p'].creditsPerReference, 46);
  assert.equal(estimatedUSD(16).toFixed(2), '1.60');
});

test('an unknown tier or duration is refused rather than defaulted', async () => {
  assert.deepEqual(TIERS, ['standard'], 'a second tier needs a MEASURED multiplier, not an invented one');

  assert.equal(grab(() => creditCost({ tier: 'pro' })).code, 'UNKNOWN_TIER');
  for (const seconds of [0, -1, NaN, 'fifteen', null]) {
    assert.equal(grab(() => creditCost({ seconds })).code, 'BAD_SECONDS');
  }
  // A defaulted multiplier of 1 for an unknown tier would be a guess that bills
  // somebody, which is why it throws instead.
  assert.match(grab(() => creditCost({ tier: 'pro' })).userMessage, /not available/);
});

// --------------------------------------------------------------------------
// the ledger
// --------------------------------------------------------------------------

test('a new account opens with its plan first grant, and the balance is that sum', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { plan: 'shelf' });

  assert.deepEqual(balanceOf(account), {
    credits: PLANS.shelf.creditsPerPeriod,
    grantedAt: iso(T0),
    // null because grant.expiryDays is null: credits do not expire, and nothing
    // in this module removes them without writing a line.
    expiresAt: null,
    planId: 'shelf',
  });
  assert.deepEqual(ledgerFor(account), [
    // `ref: null` since 2026-08-24: grants gained an idempotency key so a
    // redelivered Stripe webhook cannot pay out twice. A signup grant has no
    // event behind it and nothing to key on, so null is the honest value and
    // the row is pinned WITH it rather than loosened to ignore the field.
    { at: iso(T0), delta: 48, jobId: null, reason: 'grant:signup', ref: null, balance: 48 },
  ]);
  assert.equal(balanceForId({ root, accountId: account.accountId }).credits, 48);
});

test('the balance is the sum of the ledger and is never stored as a number', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { plan: 'archive' });
  debitCredits(account, { jobId: JOB(1), credits: TAPE, nowImpl: clock(T0 + 1000) });

  const onDisk = JSON.parse(fs.readFileSync(`${root}/out/accounts/${account.accountId}/account.json`, 'utf8'));
  // A stored balance is a second source of truth for somebody's money, and the
  // moment it disagrees with its own history there is no way to find out which
  // of the two is wrong.
  assert.ok(!Object.hasOwn(onDisk, 'credits'));
  assert.ok(!Object.hasOwn(onDisk, 'balance'));
  assert.deepEqual(Object.keys(onDisk.ledger[1]).sort(), ['at', 'delta', 'jobId', 'reason']);
  assert.equal(onDisk.ledger.reduce((n, e) => n + e.delta, 0), balanceOf(account).credits);
});

test('a malformed ledger entry is refused, not skipped', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  for (const bad of [
    { at: iso(T0), delta: 'ten', jobId: null, reason: 'x' },
    { at: 'whenever', delta: 5, jobId: null, reason: 'x' },
    { at: iso(T0), delta: 5, jobId: null },
    { at: iso(T0), delta: 1.5, jobId: null, reason: 'x' },
  ]) {
    updateAccount({ root, accountId: account.accountId, nowImpl: clock() }, (record) => {
      record.ledger = [record.ledger[0], bad];
    });
    const reloaded = loadAccount({ root, accountId: account.accountId, nowImpl: clock() });
    // Skipping a line silently changes a balance. A balance that is quietly
    // wrong is worse than an account that is loudly stuck.
    const err = grab(() => balanceOf(reloaded));
    assert.equal(err.code, 'LEDGER_CORRUPT');
    assert.ok(!err.userMessage.includes(root));
  }
  const noLedger = grab(() => balanceOf({ accountId: 'x', ledger: undefined }));
  assert.equal(noLedger.code, 'LEDGER_MISSING');
});

// --------------------------------------------------------------------------
// debiting
// --------------------------------------------------------------------------

test('a debit spends credits durably and refreshes the caller copy', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { plan: 'shelf' });

  debitCredits(account, { jobId: JOB(1), credits: TAPE, reason: 'render:480p', nowImpl: clock(T0 + 1000) });

  assert.equal(balanceOf(account).credits, PLANS.shelf.creditsPerPeriod - TAPE);
  assert.deepEqual(account.ledger.at(-1), {
    at: iso(T0 + 1000), delta: -TAPE, jobId: JOB(1), reason: 'render:480p',
  });
  // And another process reading the record sees the same thing. Derived from
  // the plan and the tape rather than written as a literal, so that a rescale
  // of what a credit is worth cannot strand this line while the assertion three
  // rows above it keeps passing.
  assert.equal(balanceForId({ root, accountId: account.accountId }).credits,
    PLANS.shelf.creditsPerPeriod - TAPE);
});

test('a debit larger than the balance is refused, with a shortfall the page can act on', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root); // free: two 480p tapes, and no 720p one

  const err = grab(() => debitCredits(account, {
    jobId: JOB(1), credits: creditCost({ resolution: '720p' }), nowImpl: clock(),
  }));
  assert.equal(err.code, 'INSUFFICIENT_CREDITS');
  assert.deepEqual(err.detail, {
    required: 46, balance: FREE, shortfall: 46 - FREE, planId: 'free',
  });
  assert.match(err.userMessage, /Not enough credits/);
  assert.ok(!err.userMessage.includes(root), 'a user message must never leak a path');

  // A refused debit must not have half-spent anything.
  assert.equal(loadAccount({ root, accountId: account.accountId }).ledger.length, 1);
  assert.equal(balanceOf(account).credits, FREE);
  // And the affordable version still goes through.
  debitCredits(account, { jobId: JOB(1), credits: TAPE, nowImpl: clock() });
  assert.equal(balanceOf(account).credits, FREE - TAPE);
});

test('debiting the same jobId twice charges once, at the price it was quoted', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { plan: 'archive' });

  debitCredits(account, { jobId: JOB(1), credits: TAPE, nowImpl: clock(T0) });
  // POST /api/jobs/:id/select re-enqueues after the human picks a still, and a
  // retriable failure returns a job to pending. Charging per enqueue would bill
  // one render three times.
  debitCredits(account, { jobId: JOB(1), credits: TAPE, nowImpl: clock(T0 + 60_000) });
  // Even a later call quoting a different price is the same render, already
  // paid for -- a re-quote must not become a second charge.
  debitCredits(account, { jobId: JOB(1), credits: 46, nowImpl: clock(T0 + 120_000) });

  assert.equal(balanceOf(account).credits, PLANS.archive.creditsPerPeriod - TAPE);
  assert.equal(loadAccount({ root, accountId: account.accountId }).ledger.length, 2);
});

test('a debit needs a real account, a real jobId and a positive whole number', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);

  for (const jobId of [undefined, null, '', '   ', 42]) {
    assert.equal(grab(() => debitCredits(account, { jobId, credits: 1, nowImpl: clock() })).code, 'BAD_JOB_ID');
  }
  for (const credits of [0, -5, 1.5, '68', NaN, undefined]) {
    assert.equal(grab(() => debitCredits(account, { jobId: JOB(1), credits, nowImpl: clock() })).code, 'BAD_CREDITS');
  }
  assert.equal(grab(() => debitCredits(account, { jobId: JOB(1), credits: 1, reason: '', nowImpl: clock() })).code, 'NO_REASON');

  // A hand-built account object has no root, so it cannot be re-read from disk,
  // and a balance check that trusts an in-memory copy is not a balance check.
  const detached = JSON.parse(JSON.stringify(account));
  assert.equal(grab(() => debitCredits(detached, { jobId: JOB(1), credits: 1 })).code, 'NO_ROOT');
});

// --------------------------------------------------------------------------
// granting
// --------------------------------------------------------------------------

test('a grant is one more line, and a negative grant is a correction', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);

  grantCredits(account, { credits: 200, reason: 'grant:manual', nowImpl: clock(T0 + 1000) });
  assert.equal(balanceOf(account).credits, FREE + 200);
  assert.equal(balanceOf(account).grantedAt, iso(T0 + 1000));

  // The honest way to fix a ledger is another line, never an edit to an
  // existing one.
  grantCredits(account, { credits: -200, reason: 'correction:granted twice', nowImpl: clock(T0 + 2000) });
  assert.equal(balanceOf(account).credits, FREE);
  assert.equal(ledgerFor(account).length, 3);
  assert.deepEqual(ledgerFor(account).map((e) => e.balance), [FREE, FREE + 200, FREE]);

  // A negative balance is a debt this product has no way to collect and no page
  // that could explain it.
  const err = grab(() => grantCredits(account, { credits: -(FREE + 1), reason: 'oops', nowImpl: clock() }));
  assert.equal(err.code, 'GRANT_BELOW_ZERO');
  assert.equal(balanceOf(account).credits, FREE);

  for (const credits of [0, 1.5, '10', undefined]) {
    assert.equal(grab(() => grantCredits(account, { credits, reason: 'x' })).code, 'BAD_CREDITS');
  }
  // Every line has to explain itself: a ledger of unlabelled numbers answers
  // "what is my balance" and not "why".
  assert.equal(grab(() => grantCredits(account, { credits: 10 })).code, 'NO_REASON');
});

test('grantPlanPeriod grants exactly what the plan says, by name', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  setPlan(account, 'archive');

  assert.equal(grantPlanPeriod(account, { planId: 'archive', nowImpl: clock(T0 + 1000) }), 64);
  assert.equal(balanceOf(account).credits, FREE + 64);
  assert.equal(account.ledger.at(-1).reason, 'grant:period:archive');
  assert.equal(grab(() => grantPlanPeriod(account, { planId: 'gold' })).code, 'BAD_PLAN');
});

// --------------------------------------------------------------------------
// refunds
// --------------------------------------------------------------------------

test('a job that died before the provider was called gets exactly what it paid', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { plan: 'shelf' });
  debitCredits(account, { jobId: JOB(1), credits: TAPE, nowImpl: clock(T0) });

  // intake, moderate, expand and compose are free. A job that fails in one of
  // them cost nothing, and keeping its credits is taking money for an error of
  // ours.
  refundCredits(account, { jobId: JOB(1), reason: 'refund:intake-failed', spent: false, nowImpl: clock(T0 + 5000) });

  assert.equal(balanceOf(account).credits, PLANS.shelf.creditsPerPeriod);
  assert.deepEqual(account.ledger.at(-1), {
    at: iso(T0 + 5000), delta: TAPE, jobId: JOB(1), reason: 'refund:intake-failed',
  });
  // Nothing was edited: the debit is still there, and the ledger explains itself.
  assert.equal(account.ledger.length, 3);
  assert.deepEqual(ledgerFor(account).map((e) => e.delta),
    [PLANS.shelf.creditsPerPeriod, -TAPE, TAPE]);
});

test('a job that failed AFTER the provider was called is refused a refund, loudly', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { plan: 'shelf' });
  debitCredits(account, { jobId: JOB(1), credits: TAPE, nowImpl: clock() });

  const err = grab(() => refundCredits(account, { jobId: JOB(1), spent: true }));
  assert.equal(err.code, 'REFUND_AFTER_SPEND');
  assert.match(err.message, /the money is gone/);
  assert.match(err.userMessage, /already started/);

  // The credits stay spent. Refunding here means a user can start renders,
  // cancel them, and burn unlimited real dollars for free -- not a leak, a tap.
  assert.equal(balanceOf(account).credits, PLANS.shelf.creditsPerPeriod - TAPE);
  assert.equal(loadAccount({ root, accountId: account.accountId }).ledger.length, 2);
});

test('a refund gives back what was charged, not what it would cost today', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { plan: 'archive' });
  // Charged at the 480p price.
  debitCredits(account, { jobId: JOB(1), credits: 16, nowImpl: clock() });
  refundCredits(account, { jobId: JOB(1), spent: false, nowImpl: clock(T0 + 1000) });
  // Refunding today's quote for yesterday's charge is how a ledger stops adding
  // up, so the refund is the exact amount taken.
  assert.equal(account.ledger.at(-1).delta, 16);
  assert.equal(balanceOf(account).credits, PLANS.archive.creditsPerPeriod);

  // A second refund gives back nothing: there is nothing left to give back.
  refundCredits(account, { jobId: JOB(1), spent: false, nowImpl: clock(T0 + 2000) });
  refundCredits(account, { jobId: JOB(9), spent: false, nowImpl: clock(T0 + 3000) });
  assert.equal(balanceOf(account).credits, PLANS.archive.creditsPerPeriod);
  assert.equal(account.ledger.length, 3, 'a no-op refund writes no line at all');
});

test('providerWasCalled is the line between the two, and it errs towards not refunding', async () => {
  assert.deepEqual(PAID_STEPS, ['still', 'animate']);

  assert.equal(providerWasCalled(jobWith([['intake', 1], ['moderate', 1], ['compose', 3], ['still', 0]])), false);
  assert.equal(providerWasCalled(jobWith([])), false);
  assert.equal(providerWasCalled({}), false);

  // `attempts > 0` deliberately over-reports: a step that began and crashed one
  // line before the request went out cost nothing and is still treated as
  // spent. Over-reporting costs one customer one render and a support email;
  // under-reporting hands out unlimited free provider calls, and the only place
  // that shows up is the invoice.
  assert.equal(providerWasCalled(jobWith([['intake', 1], ['still', 1]])), true);
  assert.equal(providerWasCalled(jobWith([['still', 3], ['animate', 0]])), true);
  assert.equal(providerWasCalled(jobWith([['animate', 2]])), true);
});

test('refundIfUnspent applies the rule instead of restating it', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { plan: 'archive' });
  debitCredits(account, { jobId: JOB(1), credits: TAPE, nowImpl: clock() });
  debitCredits(account, { jobId: JOB(2), credits: TAPE, nowImpl: clock() });

  const free = jobWith([['intake', 1], ['still', 0]], JOB(1));
  const paid = jobWith([['still', 1]], JOB(2));

  assert.equal(refundIfUnspent(account, free, { nowImpl: clock(T0 + 1000) }), true);
  // Declining a refund is a normal outcome, not an error -- it must not throw.
  assert.equal(refundIfUnspent(account, paid, { nowImpl: clock(T0 + 1000) }), false);
  assert.equal(balanceOf(account).credits, PLANS.archive.creditsPerPeriod - TAPE);
});

// --------------------------------------------------------------------------
// the replay
// --------------------------------------------------------------------------

/** xorshift32, seeded. A money test that behaves differently on every run is a
 *  money test nobody can debug -- see the determinism table in CLAUDE.md. */
function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0x1_0000_0000;
  };
}

test('replaying a long random sequence: the balance always equals the sum of the ledger', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { plan: 'archive' });
  const next = rng(0xC0FFEE);

  // An independent model of the balance, computed by a completely different
  // route from the one under test. If the two ever disagree, one of them is
  // lying about somebody's money.
  let expected = PLANS.archive.creditsPerPeriod;
  const outstanding = new Map();   // jobId -> credits currently charged
  let jobs = 0;
  const applied = [];

  for (let step = 0; step < 120; step += 1) {
    const at = T0 + step * 60_000;
    const roll = next();

    if (roll < 0.25) {
      const credits = 1 + Math.floor(next() * 400);
      grantCredits(account, { credits, reason: `grant:step-${step}`, nowImpl: clock(at) });
      expected += credits;
      applied.push(`+${credits}`);
    } else if (roll < 0.75) {
      jobs += 1;
      const jobId = JOB(jobs % 100);
      const resolution = RESOLUTIONS[Math.floor(next() * RESOLUTIONS.length)];
      const credits = creditCost({ resolution });
      if (outstanding.has(jobId)) {
        // Already charged: idempotent, so nothing may change.
        debitCredits(account, { jobId, credits, nowImpl: clock(at) });
        applied.push(`=${jobId}`);
      } else if (expected >= credits) {
        debitCredits(account, { jobId, credits, nowImpl: clock(at) });
        expected -= credits;
        outstanding.set(jobId, credits);
        applied.push(`-${credits}`);
      } else {
        assert.equal(grab(() => debitCredits(account, { jobId, credits, nowImpl: clock(at) })).code,
          'INSUFFICIENT_CREDITS', `step ${step}: ${credits} against ${expected}`);
        applied.push(`x${credits}`);
      }
    } else {
      const [jobId, credits] = [...outstanding.entries()][Math.floor(next() * outstanding.size)] ?? [];
      if (jobId === undefined) continue;
      refundCredits(account, { jobId, spent: false, reason: `refund:step-${step}`, nowImpl: clock(at) });
      expected += credits;
      outstanding.delete(jobId);
      applied.push(`r${credits}`);
    }

    // Every single step, not just at the end: a divergence that heals itself by
    // step 120 is still a moment at which somebody was told the wrong balance.
    const balance = balanceOf(account).credits;
    assert.equal(balance, expected, `step ${step} (${applied.at(-1)}): balance ${balance}, expected ${expected}`);
    assert.ok(balance >= 0, `step ${step}: a balance may never go negative`);
  }

  // And the whole thing survives a round trip through the filesystem, replayed
  // from the bytes rather than from the object that has been mutated all along.
  const reloaded = loadAccount({ root, accountId: account.accountId, nowImpl: clock() });
  const lines = ledgerFor(reloaded);
  assert.equal(balanceOf(reloaded).credits, expected);
  assert.equal(lines.at(-1).balance, expected);
  assert.equal(lines.reduce((n, e) => n + e.delta, 0), expected);

  // The running balance on every line is the sum of the lines above it. This is
  // the property that makes the ledger auditable rather than merely long.
  let running = 0;
  for (const [i, line] of lines.entries()) {
    running += line.delta;
    assert.equal(line.balance, running, `line ${i} claims a balance of ${line.balance}, the sum says ${running}`);
    assert.ok(Number.isInteger(line.delta) && line.reason.length > 0);
  }
  t.diagnostic(`${lines.length} ledger lines, final balance ${expected} credits (~$${estimatedUSD(expected).toFixed(2)} of provider spend)`);
});

// --------------------------------------------------------------------------
// the race
// --------------------------------------------------------------------------

const GUN = 0;
const IN_FLIGHT = 1;
const PEAK = 2;

/**
 * Runs inside each contender. Eval'd worker code is CommonJS, so the ESM
 * modules come in through a dynamic import.
 *
 * `loadAccount` happens BEFORE the barrier on purpose. That is what gives every
 * thread a stale balance at the instant the gun fires, which is exactly the
 * state twelve simultaneous HTTP requests would be in, and it is the state a
 * naive implementation gets wrong.
 */
const THREAD_SOURCE = `
const { workerData, parentPort } = require('node:worker_threads');
const { accountsUrl, creditsUrl, root, accountId, jobId, credits, index, nowMs, shared, op, ref } = workerData;
const flags = new Int32Array(shared);

(async () => {
  const { loadAccount } = await import(accountsUrl);
  const { debitCredits, grantCredits } = await import(creditsUrl);
  const nowImpl = () => new Date(nowMs);
  const account = loadAccount({ root, accountId, nowImpl });

  parentPort.postMessage({ ready: true });
  Atomics.wait(flags, ${GUN}, 0);

  const depth = Atomics.add(flags, ${IN_FLIGHT}, 1) + 1;
  let peak = Atomics.load(flags, ${PEAK});
  while (depth > peak) {
    const prev = Atomics.compareExchange(flags, ${PEAK}, peak, depth);
    if (prev === peak) break;
    peak = prev;
  }

  let result;
  try {
    // A GRANT RACES EXACTLY AS A DEBIT DOES, and it is the shape Stripe
    // actually produces: a redelivered webhook can arrive while the first
    // delivery is still inside the handler.
    const out = op === 'grant'
      ? grantCredits(account, { credits, reason: 'grant:pack:test', ref, nowImpl })
      : debitCredits(account, { jobId, credits, nowImpl });
    result = { index, jobId, ok: true, code: null, granted: out ? out.granted : null };
  } catch (err) {
    result = { index, jobId, ok: false, code: err.code || err.message };
  } finally {
    Atomics.sub(flags, ${IN_FLIGHT}, 1);
  }
  parentPort.postMessage({ result });
})().catch((err) => parentPort.postMessage({ result: { index, ok: false, code: String((err && err.stack) || err) } }));
`;

/** Boots `count` threads, waits until every one is parked at the barrier, then
 *  releases them all with a single notify. One starting gun, and every
 *  contender is inside the operation within microseconds. */
function stampede({ count, root, accountId, jobIdFor, credits, nowMs = T0, op = 'debit', ref = null }) {
  const shared = new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT);
  const view = new Int32Array(shared);
  const results = [];
  let ready = 0;

  return new Promise((resolve, reject) => {
    const workers = [];
    for (let index = 0; index < count; index += 1) {
      const worker = new Worker(THREAD_SOURCE, {
        eval: true,
        workerData: {
          accountsUrl: ACCOUNTS_URL, creditsUrl: CREDITS_URL,
          root, accountId, index, jobId: jobIdFor(index), credits, nowMs, shared, op, ref,
        },
      });
      workers.push(worker);
      worker.on('error', reject);
      worker.on('message', (msg) => {
        if (msg.ready) {
          ready += 1;
          // Atomics.wait compares before parking, so a thread arriving after the
          // gun reads the new value and proceeds instead of parking forever. No
          // lost wakeup, and no timer anywhere in this file.
          if (ready === count) { Atomics.store(view, GUN, 1); Atomics.notify(view, GUN); }
          return;
        }
        results.push(msg.result);
        if (results.length === count) {
          Promise.all(workers.map((w) => w.terminate()))
            .then(() => resolve({ results, peak: Atomics.load(view, PEAK) }), reject);
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// grants are idempotent by `ref` -- the webhook's whole safety net
// ---------------------------------------------------------------------------

test('a grant with a ref already in the ledger is a no-op, not a second grant', async (t) => {
  // STRIPE REDELIVERS EVENTS. That is documented behaviour, not an edge case,
  // and until 2026-08-24 `grantCredits` had no key of any kind -- debits are
  // idempotent by jobId, grants wrote `jobId: null` -- so a replayed
  // checkout.session.completed granted the credits a second time, free.
  const root = makeRoot(t);
  const account = await signUp(root);
  const before = balanceOf(account).credits;

  const first = grantCredits(account, { credits: 40, reason: 'grant:pack:40', ref: 'evt_1', nowImpl: clock() });
  const second = grantCredits(account, { credits: 40, reason: 'grant:pack:40', ref: 'evt_1', nowImpl: clock() });

  assert.equal(first.granted, true);
  assert.equal(second.granted, false, 'the replay must report that it granted nothing');
  assert.equal(balanceOf(account).credits, before + 40, 'the balance moved once');
  const refs = ledgerFor(account).filter((e) => e.ref === 'evt_1');
  assert.equal(refs.length, 1, 'exactly one row carries the ref');
});

test('two different refs both land, because they are two different payments', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  const before = balanceOf(account).credits;

  grantCredits(account, { credits: 40, reason: 'grant:pack:40', ref: 'evt_1', nowImpl: clock() });
  grantCredits(account, { credits: 40, reason: 'grant:pack:40', ref: 'evt_2', nowImpl: clock() });

  assert.equal(balanceOf(account).credits, before + 80, 'somebody buying twice is not a replay');
});

test('a grant with no ref is not deduplicated, and that is deliberate', async (t) => {
  // The signup grant and `npm run accounts -- grant` have no event behind them
  // and nothing to key on. Silently collapsing two identical hand grants would
  // be a different bug: an operator granting twice on purpose gets one.
  const root = makeRoot(t);
  const account = await signUp(root);
  const before = balanceOf(account).credits;

  grantCredits(account, { credits: 5, reason: 'grant:goodwill', nowImpl: clock() });
  grantCredits(account, { credits: 5, reason: 'grant:goodwill', nowImpl: clock() });

  assert.equal(balanceOf(account).credits, before + 10);
});

test('the ref survives the round trip through the ledger file', async (t) => {
  // THE TRAP THIS TEST EXISTS FOR. `entriesOf` projects a fixed shape and drops
  // everything it does not name, so a ref written to disk and not read back
  // would leave the dedupe check looking at undefined forever -- an
  // implementation that passes an in-memory test and is not idempotent at all.
  const root = makeRoot(t);
  const account = await signUp(root);
  grantCredits(account, { credits: 40, reason: 'grant:pack:40', ref: 'evt_round_trip', nowImpl: clock() });

  const reloaded = loadAccount({ root, accountId: account.accountId, nowImpl: clock() });
  assert.ok(ledgerFor(reloaded).some((e) => e.ref === 'evt_round_trip'),
    'the ref must come back off disk or the dedupe reads nothing');

  // And a second grant against the RELOADED account is still refused.
  const again = grantCredits(reloaded, { credits: 40, reason: 'grant:pack:40', ref: 'evt_round_trip', nowImpl: clock() });
  assert.equal(again.granted, false);
});

test('a ref that is not a usable key is refused rather than ignored', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  for (const bad of ['', '   ', 42, {}]) {
    const err = grab(() => grantCredits(account, { credits: 40, reason: 'grant:pack:40', ref: bad, nowImpl: clock() }));
    assert.equal(err?.code, 'BAD_REF', `ref ${JSON.stringify(bad)} should be refused, not silently dropped`);
  }
});

test('8 threads grant the SAME ref at once: it lands once', async (t) => {
  // The sequential test above is not enough. Stripe retries can OVERLAP -- a
  // redelivery arriving while the first delivery is still inside the handler --
  // and a check that reads before the lock would let both through. This is the
  // same barrier harness the debit race uses, for the same reason.
  const root = makeRoot(t);
  const account = await signUp(root);
  const before = balanceOf(account).credits;

  const { results } = await stampede({
    count: 8, root, accountId: account.accountId, jobIdFor: () => JOB(1),
    credits: 40, op: 'grant', ref: 'evt_stampede',
  });

  assert.equal(results.filter((r) => r.ok).length, 8, 'every thread should succeed -- a replay is a no-op, not an error');
  assert.equal(results.filter((r) => r.granted === true).length, 1, 'exactly one thread actually granted');

  const reloaded = loadAccount({ root, accountId: account.accountId, nowImpl: clock() });
  assert.equal(balanceOf(reloaded).credits, before + 40, 'the balance moved exactly once');
});

test('12 threads debit at once against a balance that covers 3: exactly 3 get through', async (t) => {
  const root = makeRoot(t);
  // THE BALANCE IS CONSTRUCTED, NOT BORROWED. This used to lean on Shelf
  // granting exactly three tapes' worth, which stopped being true the moment
  // the tape price was corrected -- and a concurrency guard that fails because
  // a PRICE moved is a guard nobody trusts. Three renders' worth, set here, and
  // it stays three whatever a tape costs.
  const account = setBalance(await signUp(root, { plan: 'shelf' }), TAPE * 3, clock());

  const { results, peak } = await stampede({
    count: 12, root, accountId: account.accountId, credits: TAPE, jobIdFor: (i) => JOB(20 + i),
  });

  const winners = results.filter((r) => r.ok);
  const refused = results.filter((r) => !r.ok);

  assert.equal(results.length, 12);
  assert.equal(winners.length, 3,
    `exactly 3 of 12 simultaneous renders may pass a balance of ${TAPE * 3}, got ${winners.length}`);
  assert.deepEqual([...new Set(refused.map((r) => r.code))], ['INSUFFICIENT_CREDITS'],
    `every loser must be refused for the right reason: ${JSON.stringify(refused.map((r) => r.code))}`);

  // The ledger is the authority and it must agree with what the callers were
  // told. A balance that says 0 while the ledger says -612 is the same bug
  // wearing a different hat.
  const after = loadAccount({ root, accountId: account.accountId, nowImpl: clock() });
  assert.equal(balanceOf(after).credits, 0);
  const debits = after.ledger.filter((e) => e.delta < 0);
  assert.equal(debits.length, 3);
  assert.deepEqual(
    debits.map((e) => e.jobId).sort(),
    winners.map((w) => w.jobId).sort(),
    'the debits on the ledger are exactly the ones whose callers were told yes',
  );

  assert.ok(peak >= 2, `the contenders must genuinely overlap; peak concurrent debitCredits() calls was ${peak}`);
  t.diagnostic(`peak concurrent debitCredits() calls: ${peak} of 12 · ${winners.length} allowed, ${refused.length} refused`);
});

test('8 threads debit the SAME jobId at once: it is charged once', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { plan: 'archive' });

  // A double-submitted form, or a select POST arriving twice. Idempotency that
  // holds single-threaded and not under a race is idempotency that fails on the
  // one day it matters.
  const { results, peak } = await stampede({
    count: 8, root, accountId: account.accountId, credits: TAPE, jobIdFor: () => JOB(1),
  });

  assert.deepEqual(results.filter((r) => !r.ok), [], 'the same job must never be refused for being itself');
  const after = loadAccount({ root, accountId: account.accountId, nowImpl: clock() });
  assert.equal(after.ledger.filter((e) => e.delta < 0).length, 1);
  assert.equal(balanceOf(after).credits, PLANS.archive.creditsPerPeriod - TAPE);
  assert.ok(peak >= 2, `peak concurrent debitCredits() calls was ${peak}`);
});

test('16 threads against a balance that covers exactly one render', async (t) => {
  const root = makeRoot(t);
  // The narrowest balance is the one a bad lock is most likely to leak through,
  // and the free plan -- one 480p tape -- is the plan with the most accounts on
  // it.
  const account = setBalance(await signUp(root), TAPE, clock());

  const { results, peak } = await stampede({
    count: 16, root, accountId: account.accountId, credits: TAPE, jobIdFor: (i) => JOB(40 + i),
  });

  assert.equal(results.filter((r) => r.ok).length, 1, 'one tape of credits means one render');
  const after = loadAccount({ root, accountId: account.accountId, nowImpl: clock() });
  assert.equal(balanceOf(after).credits, 0);
  // DEBITS FOR A RENDER, not every negative line: `setBalance` above writes a
  // negative correction to put this account on an exact one-tape balance, and
  // counting that as a charge would make the guard fail on its own setup.
  assert.equal(after.ledger.filter((e) => e.delta < 0 && e.jobId !== null).length, 1);
  assert.ok(peak >= 2, `peak concurrent debitCredits() calls was ${peak}`);
  t.diagnostic(`peak concurrent debitCredits() calls: ${peak} of 16`);
});

// ---------------------------------------------------------------------------
// what the tiers actually cost -- MEASURED 2026-08-25
// ---------------------------------------------------------------------------

/**
 * THE PRICE IS DERIVED FROM THE RASTER FAL RETURNS, NOT THE ONE WE ORDER.
 *
 * Three metered jobs settled this. Two ordered 640x480 and were delivered --
 * and billed for -- 752x560; one ordered 960x720 and was delivered 1112x834.
 * fal upscales by about 1.16 on each axis and bills what it sends, so a price
 * computed from the raster we ASK for understates the invoice by roughly a
 * third, in the unsafe direction.
 *
 * This test pins each offered tier to the formula applied to its DELIVERED
 * raster. It replaces the old "720p anchor" assertion, which pinned the figure
 * to 1280x720 -- a 16:9 frame this product never orders and fal never sent.
 * That the old number happened to land within three cents of the truth was a
 * coincidence of two errors cancelling, and a coincidence is not a derivation.
 */
test('every offered tier is priced from the raster fal actually delivered', async () => {
  const cfg = creditConfig();
  const rate = cfg.provider.usdPerThousandTokens / 1000;
  const tokens = (w, h) => (w * h * cfg.referenceSeconds * cfg.provider.tokensPerPixelSecond)
    / cfg.provider.tokenDivisor;

  for (const id of RESOLUTIONS) {
    const res = cfg.resolutions[id];
    assert.ok(res.delivered, `${id} is on offer and nothing records what fal delivered for it`);
    assert.ok(Number.isInteger(res.delivered.width) && Number.isInteger(res.delivered.height),
      `${id} delivered raster is not a pair of whole pixels`);

    const usd = tokens(res.delivered.width, res.delivered.height) * rate;
    assert.ok(
      Math.abs(usd - res.estimatedUSDPer15s) < 0.01,
      `${id}: the delivered raster ${res.delivered.width}x${res.delivered.height} costs $${usd.toFixed(4)}, config says $${res.estimatedUSDPer15s}`,
    );

    // A tier that is sold cannot still call itself a guess.
    assert.equal(res.estimate, false, `${id} is on offer and still marked an estimate`);
    assert.match(res._comment, /MEASURED/, `${id} is on offer and its comment does not say it was measured`);
  }
});

/** The customer-facing number, pinned to the measurement rather than to a
 *  figure somebody chose. If a tape's cost moves, this is what has to move with
 *  it -- and a credit price that no longer covers the invoice fails here rather
 *  than on an invoice. */
test('a tape is priced at or above what it costs to serve', async () => {
  const cfg = creditConfig();
  for (const id of RESOLUTIONS) {
    const charged = creditCost({ resolution: id, seconds: 15 }) * cfg.creditUSD;
    const costs = cfg.resolutions[id].estimatedUSDPer15s;
    assert.ok(charged >= costs,
      `${id} charges ${(charged / cfg.creditUSD)} CR ($${charged.toFixed(2)}) against a measured cost of $${costs.toFixed(4)}`);
  }
});

/**
 * 720p IS A DIFFERENT PRODUCT FROM 480p, and that is a claim on a public page
 * so it is asserted rather than assumed. It was genuinely open until
 * 2026-08-25: both 480p jobs came back at 752x560, and if a 720p order had
 * come back at 752x560 too there would have been one tier and not two --
 * pricing them separately would have been charging for a difference that does
 * not exist.
 */
test('the two offered tiers deliver visibly different rasters', async () => {
  const cfg = creditConfig();
  const a = cfg.resolutions['480p'].delivered;
  const b = cfg.resolutions['720p'].delivered;
  const ratio = (b.width * b.height) / (a.width * a.height);
  assert.ok(ratio > 1.5,
    `720p delivers ${(ratio).toFixed(2)}x the pixels of 480p -- too close to sell as separate tiers`);
});

// --------------------------------------------------------------------------
// the owner-refund glue: what the worker hands a job that ended with no tape
// --------------------------------------------------------------------------

/** The web layer's ownership receipt, written the way `claimJob` writes it:
 *  the file's existence at out/owners/<accountId>/<jobId>.json IS the fact. */
function claimOnDisk(root, accountId, jobId) {
  const dir = path.join(root, 'out', 'owners', accountId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${jobId}.json`), JSON.stringify({ jobId, accountId }));
}

test('the worker refund glue finds the owner and gives back what the steps never spent', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  const jobId = JOB(1);
  debitCredits(account, { jobId, credits: TAPE, nowImpl: clock() });
  assert.equal(balanceOf(account).credits, FREE - TAPE);
  claimOnDisk(root, account.accountId, jobId);

  const refunds = createOwnerRefunds({ root });
  const result = await refunds.refund(jobWith([['intake', 1]], jobId), { reason: 'refund:failed-before-provider' });

  assert.equal(result.refunded, true);
  assert.equal(result.accountId, account.accountId);
  const fresh = loadAccount({ root, accountId: account.accountId });
  assert.equal(balanceOf(fresh).credits, FREE, 'the debit came back');
  const rows = ledgerFor(fresh).filter((e) => e.jobId === jobId);
  assert.equal(rows.length, 2, 'the refund is its own ledger line, never an erased debit');
});

test('the glue declines a job whose steps show a paid attempt, and money stays gone', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  const jobId = JOB(2);
  debitCredits(account, { jobId, credits: TAPE, nowImpl: clock() });
  claimOnDisk(root, account.accountId, jobId);

  const refunds = createOwnerRefunds({ root });
  const result = await refunds.refund(jobWith([[PAID_STEPS[0], 1]], jobId), { reason: 'refund:failed-before-provider' });

  assert.equal(result.refunded, false);
  assert.equal(balanceOf(loadAccount({ root, accountId: account.accountId })).credits, FREE - TAPE,
    'a provider was asked for something, so the money is gone and stays gone');
});

/** A job nobody owns is every direct-CLI render. Declining quietly is the
 *  correct answer -- there is no ledger to give anything back to. */
test('the glue answers a job with no owner by refunding nothing, not by throwing', async (t) => {
  const root = makeRoot(t);
  const refunds = createOwnerRefunds({ root });
  const result = await refunds.refund(jobWith([['intake', 1]], JOB(3)), { reason: 'refund:failed-before-provider' });
  assert.equal(result.refunded, false);
  assert.deepEqual(listMissedRefunds({ root }), [],
    'a job that was never charged is not a reconciliation item');
});

/** An owners directory that cannot be LISTED is not "nobody has ever claimed
 *  anything". Before this test, an EACCES or EIO at the moment a terminal
 *  failure was processed took the quiet no-owner branch -- outside the try
 *  whose catch writes the reconciliation record -- and the customer was down
 *  a tape's worth of credits with no witness anywhere: `npm run refunds`
 *  listed nothing, and the worker printed nothing. The miss must throw, so
 *  the worker's REFUND MISSED line fires, and must be RECORDED, so a person
 *  can find it after the line has scrolled away. */
test('the glue records a refund it could not attribute, when the owners index cannot be listed', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  const jobId = JOB(5);
  debitCredits(account, { jobId, credits: TAPE, nowImpl: clock() });
  claimOnDisk(root, account.accountId, jobId);

  const ownersRoot = `${root}/out/owners`;
  const fsImpl = {
    ...fs,
    readdirSync(dir, opts) {
      if (String(dir).split(path.sep).join('/') === ownersRoot) {
        const err = new Error(`EACCES: permission denied, scandir '${dir}'`); err.code = 'EACCES'; throw err;
      }
      return fs.readdirSync(dir, opts);
    },
  };
  const refunds = createOwnerRefunds({ root, fsImpl });

  await assert.rejects(
    () => refunds.refund(jobWith([['intake', 1]], jobId), { reason: 'refund:failed-before-provider' }),
    (err) => err.code === 'EACCES',
  );
  const records = listMissedRefunds({ root });
  assert.equal(records.length, 1, `one record for the miss: ${JSON.stringify(records)}`);
  assert.equal(records[0].jobId, jobId);
  assert.equal(records[0].kind, 'error');
  assert.equal(records[0].settled, null, 'it is pending money, not trail');
  assert.equal(balanceOf(loadAccount({ root, accountId: account.accountId })).credits, FREE - TAPE,
    'nothing was refunded -- the record is what says a person must');
});

// --------------------------------------------------------------------------
// the reconciliation ledger: a missed refund is a record, never only a line
// --------------------------------------------------------------------------

/**
 * The most likely launch-day failure joined up: a fal outage trips
 * `providerWasCalled` (attempts increment before the request leaves), the
 * refund is declined -- correctly, because nothing on disk can distinguish a
 * pre-flight crash from an in-flight loss, and guessing wrong hands out free
 * provider calls -- and until this existed the decline was SILENT: the worker
 * emits only on success or on a throw. The operator, who can read fal's
 * dashboard and knows whether the call was actually billed, had nothing to
 * reconcile from. Now every declined-as-spent refund with a real owner leaves
 * a durable record under out/refunds/, naming the job, the account and the
 * credits, until a human settles it.
 */
test('a declined refund leaves a durable reconciliation record naming the money', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  const jobId = JOB(4);
  debitCredits(account, { jobId, credits: TAPE, nowImpl: clock() });
  claimOnDisk(root, account.accountId, jobId);

  const refunds = createOwnerRefunds({ root });
  const result = await refunds.refund(jobWith([[PAID_STEPS[0], 1]], jobId), { reason: 'refund:failed-before-provider' });
  assert.equal(result.refunded, false);

  const pending = listMissedRefunds({ root });
  assert.equal(pending.length, 1, 'the decline must be recorded, not only declined');
  assert.equal(pending[0].jobId, jobId);
  assert.equal(pending[0].accountId, account.accountId);
  assert.equal(pending[0].credits, TAPE, 'the record names the money the ledger is still holding');
  assert.equal(pending[0].kind, 'declined-spent');
  assert.equal(pending[0].settled, null);
});

test('a refund that lands clears the record an earlier decline left behind', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  const jobId = JOB(5);
  debitCredits(account, { jobId, credits: TAPE, nowImpl: clock() });
  claimOnDisk(root, account.accountId, jobId);

  const refunds = createOwnerRefunds({ root });
  await refunds.refund(jobWith([[PAID_STEPS[0], 1]], jobId), { reason: 'refund:failed-before-provider' });
  assert.equal(listMissedRefunds({ root }).length, 1);

  // The same job asked again with steps showing no paid attempt -- the shape a
  // revive-and-retry leaves. The refund lands and the reconciliation item goes.
  const again = await refunds.refund(jobWith([['intake', 1]], jobId), { reason: 'refund:failed-before-provider' });
  assert.equal(again.refunded, true);
  assert.deepEqual(listMissedRefunds({ root }), [],
    'money that came back must not stay on the reconciliation list');
});

test('a glue that cannot even reach the ledger records the miss and still throws', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  const jobId = JOB(6);
  claimOnDisk(root, account.accountId, jobId);

  const refunds = createOwnerRefunds({
    root,
    loadAuthImpl: async () => { throw new Error('auth module unreadable'); },
  });
  await assert.rejects(
    refunds.refund(jobWith([['intake', 1]], jobId), { reason: 'refund:failed-before-provider' }),
    /auth module unreadable/,
    'the throw still travels: the worker line and the record are two witnesses, not one',
  );
  const pending = listMissedRefunds({ root });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].kind, 'error');
  assert.equal(pending[0].credits, null, 'an unreachable ledger cannot name a number, and must not invent one');
});

test('settling a missed refund gives the money back once, and twice settles nothing more', async (t) => {
  // The human's half: the operator has read fal's dashboard and knows the call
  // was never billed, so the conservative decline is overridden BY A PERSON.
  // `refundCredits` computes the owed amount from the ledger itself and is
  // idempotent per job, so a double settle -- two terminals, one nervous
  // operator -- is a no-op rather than a second grant.
  const root = makeRoot(t);
  const account = await signUp(root);
  const jobId = JOB(7);
  debitCredits(account, { jobId, credits: TAPE, nowImpl: clock() });
  claimOnDisk(root, account.accountId, jobId);

  const refunds = createOwnerRefunds({ root });
  await refunds.refund(jobWith([[PAID_STEPS[0], 1]], jobId), { reason: 'refund:failed-before-provider' });
  assert.equal(balanceOf(loadAccount({ root, accountId: account.accountId })).credits, FREE - TAPE);

  const settled = await settleMissedRefund({ root, jobId, nowImpl: clock() });
  assert.equal(settled.credits, TAPE);
  assert.equal(balanceOf(loadAccount({ root, accountId: account.accountId })).credits, FREE,
    'the settle is the refund the decline was holding');

  const again = await settleMissedRefund({ root, jobId, nowImpl: clock() });
  assert.equal(again.credits, 0, 'a second settle must move nothing');
  assert.equal(balanceOf(loadAccount({ root, accountId: account.accountId })).credits, FREE);

  assert.deepEqual(listMissedRefunds({ root }), [],
    'a settled record leaves the pending list');
  const rows = ledgerFor(loadAccount({ root, accountId: account.accountId })).filter((e) => e.jobId === jobId);
  assert.equal(rows.length, 2, 'the settle is its own ledger line against the job, never an edit');
});

test('the refunds CLI lists the queue with the money named, and settles by job id', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  const jobId = JOB(8);
  debitCredits(account, { jobId, credits: TAPE, nowImpl: clock() });
  claimOnDisk(root, account.accountId, jobId);
  await createOwnerRefunds({ root }).refund(jobWith([[PAID_STEPS[0], 1]], jobId), { reason: 'refund:failed-before-provider' });

  const { main } = await import('../scripts/auth/refunds-cli.mjs');

  const listed = [];
  assert.equal(await main(['list', `--root=${root}`], { log: (s) => listed.push(s), error: () => {} }), 0);
  assert.ok(listed.some((l) => l.includes(jobId)), 'the pending job must be on the list');
  assert.ok(listed.some((l) => l.includes(`${TAPE} CR`)), 'the list must name the money, or the operator reads ledgers by hand');

  const settled = [];
  assert.equal(await main(['settle', jobId, `--root=${root}`], { log: (s) => settled.push(s), error: () => {} }), 0);
  assert.equal(balanceOf(loadAccount({ root, accountId: account.accountId })).credits, FREE,
    'the settle through the CLI is the same refund as the function');

  const after = [];
  assert.equal(await main(['list', `--root=${root}`], { log: (s) => after.push(s), error: () => {} }), 0);
  assert.ok(after.some((l) => l.includes('nothing pending')), 'a settled queue must say it is empty');
});

test('the refunds CLI refuses what it does not recognise, touching nothing', async (t) => {
  // The purge accepted `--job` in silence once and swept six uploads
  // (CLAUDE.md section 30 item 1). Money gets at least the same whitelist:
  // a near-miss command or flag is exit 2 and no ledger moves.
  const root = makeRoot(t);
  const account = await signUp(root);
  const jobId = JOB(9);
  debitCredits(account, { jobId, credits: TAPE, nowImpl: clock() });
  claimOnDisk(root, account.accountId, jobId);
  await createOwnerRefunds({ root }).refund(jobWith([[PAID_STEPS[0], 1]], jobId), { reason: 'refund:failed-before-provider' });

  const { main } = await import('../scripts/auth/refunds-cli.mjs');
  const silent = { log: () => {}, error: () => {} };

  assert.equal(await main(['settel', jobId, `--root=${root}`], silent), 2, 'a misspelled command must refuse');
  assert.equal(await main(['settle', jobId, '--force', `--root=${root}`], silent), 2, 'an unknown flag must refuse');
  assert.equal(balanceOf(loadAccount({ root, accountId: account.accountId })).credits, FREE - TAPE,
    'a refusal must move no money');
  assert.equal(listMissedRefunds({ root }).length, 1, 'a refusal must not touch the record either');
});

// ---------------------------------------------------------------------------
// the refusal that costs nothing, and used to cost a customer everything
// ---------------------------------------------------------------------------

/**
 * MEASURED ON THE FIRST REAL PAID ORDER, 2026-09-02. Job
 * 20260902-141334-34a7e4 reached `animate`, and fal answered HTTP 422 on
 * content grounds 55 seconds later. `providerWasCalled` saw attempts > 0 on a
 * paid step, declined the refund, and the owner's balance went 21 -> 0 for a
 * render that never ran.
 *
 * THE GENERAL RULE IS RIGHT AND THIS IS THE CASE IT NEVER CONSIDERED. §37E
 * chose to over-report deliberately -- "nothing on disk can distinguish a
 * pre-flight crash from an in-flight loss", and under-reporting hands out free
 * provider calls. Both halves still hold. What it did not consider is the
 * outcome that is not ambiguous at all: a 4xx REFUSAL is the provider saying it
 * understood the request and declined to run it. No generation happened, and
 * CLAUDE.md §8 records the same fact from the uso experiment -- "a 422 is not
 * billed".
 *
 * So the narrowing is exactly one shape: every paid attempt ended in a 4xx
 * refusal. Anything ambiguous -- a 5xx, a timeout, a lost connection, a crash
 * with no error recorded -- keeps the conservative answer, because those are
 * the cases where the request may well have been served and billed.
 */
const failedPaidJob = (error, { attempts = 1, jobId = JOB(41) } = {}) => ({
  jobId,
  steps: [
    { name: 'intake', status: 'done', attempts: 1 },
    { name: 'still', status: 'skipped', attempts: 0 },
    { name: 'animate', status: 'failed', attempts, error },
  ],
});

test('a provider refusal gives the credits back, because nothing was generated', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  setBalance(account, 21, clock());

  const job = failedPaidJob({
    code: 'moderation_refused',
    message: 'fal: HTTP 422 -- the provider refused on content grounds',
  });
  debitCredits(account, { jobId: job.jobId, credits: 21, reason: 'render', nowImpl: clock() });
  assert.equal(balanceOf(account).credits, 0, 'the debit must land first');

  const gave = refundIfUnspent(account, job, { reason: 'refund:provider-refused', nowImpl: clock() });
  assert.equal(gave, true, 'a 4xx refusal must refund -- the provider did no work to bill for');
  assert.equal(balanceOf(account).credits, 21, 'the customer is whole again');
});

test('the ledger labels a refusal from what the manifest says, not from what the caller guessed', async (t) => {
  // The worker asks for a refund with the one reason it knows at that point
  // -- the job failed -- and cannot know whether a provider was reached until
  // the seam reads the steps. So the label must come from the FACT the seam
  // established. Before this test the caller's guess won every time, and the
  // one line the rule's own comment says must never appear -- "failed before
  // provider" on a job that plainly called fal -- was written for every
  // refused job, while the `provider-refused` label was dead code.
  const root = makeRoot(t);
  const account = await signUp(root);
  setBalance(account, 21, clock());
  const job = failedPaidJob({ code: 'moderation_refused', message: 'refused' }, { jobId: JOB(45) });
  debitCredits(account, { jobId: job.jobId, credits: 21, reason: 'render', nowImpl: clock() });

  assert.equal(refundIfUnspent(account, job, { reason: 'refund:failed-before-provider', nowImpl: clock() }), true);
  const refund = ledgerFor(account).filter((e) => e.jobId === job.jobId && e.delta > 0);
  assert.equal(refund.length, 1);
  assert.equal(refund[0].reason, 'refund:provider-refused',
    'a job that reached the provider and was turned away must say so on the ledger');

  // And a job that genuinely never reached one keeps the caller's label,
  // because there the caller's reason IS the fact.
  const never = { jobId: JOB(46), steps: [{ name: 'intake', status: 'failed', attempts: 1 }] };
  debitCredits(account, { jobId: never.jobId, credits: 21, reason: 'render', nowImpl: clock() });
  assert.equal(refundIfUnspent(account, never, { reason: 'refund:cancelled-before-provider', nowImpl: clock() }), true);
  const cancelled = ledgerFor(account).filter((e) => e.jobId === never.jobId && e.delta > 0);
  assert.equal(cancelled[0].reason, 'refund:cancelled-before-provider');
});

test('a rejected request refunds too, and so does a rejected credential', async (t) => {
  // Both are 4xx: the request never became a generation. A customer must not
  // pay for our malformed request, nor for our expired key.
  for (const code of ['bad_request', 'credential']) {
    const root = makeRoot(t);
    const account = await signUp(root);
    setBalance(account, 21, clock());
    const job = failedPaidJob({ code, message: `fal: ${code}` }, { jobId: JOB(42) });
    debitCredits(account, { jobId: job.jobId, credits: 21, reason: 'render', nowImpl: clock() });

    assert.equal(refundIfUnspent(account, job, { nowImpl: clock() }), true, `${code} must refund`);
    assert.equal(balanceOf(account).credits, 21, `${code} left the customer short`);
  }
});

test('an ambiguous failure still keeps the conservative answer', async (t) => {
  // THE HALF THAT MUST NOT MOVE. A 5xx, a timeout or a dropped connection all
  // mean the request may have been served and billed, and §37E's reasoning
  // applies to every one: under-reporting hands out an unlimited supply of free
  // provider calls, and the only place that shows up is the invoice.
  for (const error of [
    { code: 'upstream', message: 'fal: HTTP 503 -- the provider failed' },
    { code: 'rate_limited', message: 'fal: HTTP 429' },
    { code: 'timeout', message: 'no answer' },
    // ACCEPTED, THEN FAILED. The queue handed back a request_id and the work
    // ran before it failed -- fal's own status shape says so, and its
    // documentation says each such attempt is billable on some plans. That
    // the failure reads as a content refusal underneath changes nothing: a
    // refusal of the OUTPUT is a generation that happened. This is the
    // ambiguous case again, wearing a 4xx, and it goes to out/refunds/ for a
    // person with the usage page open.
    { code: 'generation_failed', message: 'fal: the generation failed after acceptance', detail: { refused: 'moderation_refused' } },
    null,
  ]) {
    const root = makeRoot(t);
    const account = await signUp(root);
    setBalance(account, 21, clock());
    const job = failedPaidJob(error, { jobId: JOB(43) });
    debitCredits(account, { jobId: job.jobId, credits: 21, reason: 'render', nowImpl: clock() });

    assert.equal(refundIfUnspent(account, job, { nowImpl: clock() }), false,
      `${error?.code ?? 'no error recorded'} must NOT refund -- it may have been billed`);
    assert.equal(balanceOf(account).credits, 0, 'an ambiguous failure keeps the charge');
  }
});

test('a refusal after a retry does not excuse the attempt before it', async (t) => {
  // A step tried twice -- served once, then refused -- is not a clean refusal,
  // and only the recorded error of the LAST attempt survives on the manifest.
  // attempts > 1 is the cheapest honest signal that an earlier one may have run.
  const root = makeRoot(t);
  const account = await signUp(root);
  setBalance(account, 21, clock());
  const job = failedPaidJob(
    { code: 'moderation_refused', message: 'refused' },
    { attempts: 2, jobId: JOB(44) },
  );
  debitCredits(account, { jobId: job.jobId, credits: 21, reason: 'render', nowImpl: clock() });

  assert.equal(refundIfUnspent(account, job, { nowImpl: clock() }), false,
    'a second attempt means an earlier one may have run and been billed');
  assert.equal(balanceOf(account).credits, 0);
});

test('providerWasCalled itself is unchanged -- it answers a different question', () => {
  // It reports whether a paid step was ever ATTEMPTED, which is still true of a
  // refused job and is still what the worker's own logging wants to know. The
  // refund decision is what learned to be more precise; this did not move.
  const job = failedPaidJob({ code: 'moderation_refused', message: 'refused' });
  assert.equal(providerWasCalled(job), true,
    'a refused job did reach the provider, and this function still says so');
});
