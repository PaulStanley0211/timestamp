/**
 * The credit pack, and the rule that a customer never names a price.
 *
 * WHAT IS ACTUALLY UNDER TEST HERE. Not "does $10 buy 40 credits" -- that is a
 * number in a config file and it will move. It is that **every** number comes
 * from `config/credits.json` and none of them is written into code, that an id
 * a browser sends is resolved rather than trusted, and that a pack which is not
 * on offer cannot be bought by asking for it anyway. The figures are asserted
 * against the config file itself, so editing the file is the whole change and
 * this file does not need touching for it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PACKS, PACK_IDS, packFor, PackError } from '../scripts/billing/packs.mjs';
import { creditConfig } from '../scripts/auth/accounts.mjs';

const CONFIG = JSON.parse(fs.readFileSync(new URL('../config/credits.json', import.meta.url), 'utf8'));

/** `assert.throws` returns undefined, so the error has to be caught to be
 *  inspected. Asserting on the CODE rather than on the message is what stops a
 *  reworded sentence from failing a test about behaviour. */
function refusal(fn, code) {
  let err = null;
  try {
    fn();
  } catch (caught) {
    err = caught;
  }
  assert.ok(err, `expected a ${code} refusal and nothing was thrown`);
  assert.ok(err instanceof PackError, `expected a PackError, got ${err?.name}: ${err?.message}`);
  assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
  return err;
}

test('the packs are the ones in config/credits.json, and not a list written in code', () => {
  const fromConfig = Object.keys(CONFIG.packs).filter((k) => !k.startsWith('_'));
  assert.deepEqual([...PACK_IDS].sort(), fromConfig.sort());
  assert.ok(fromConfig.length >= 1, 'there is no pack to sell');

  for (const id of fromConfig) {
    const row = CONFIG.packs[id];
    assert.equal(PACKS[id].priceUSD, row.priceUSD, `${id} priced differently from the config`);
    assert.equal(PACKS[id].credits, row.credits, `${id} grants differently from the config`);
    assert.equal(PACKS[id].label, row.label);
  }
});

/** The reasoning has to travel with the number. `creditConfig` refuses a plan
 *  with no `_comment` for this reason and a pack is money in exactly the same
 *  way -- an unannotated figure in this file reads as fact to whoever finds it
 *  next. */
test('every pack carries a _comment saying where its number came from', () => {
  for (const id of PACK_IDS) {
    assert.equal(typeof CONFIG.packs[id]._comment, 'string');
    assert.ok(CONFIG.packs[id]._comment.length > 0, `${id} has an empty _comment`);
  }
});

test('a pack the config does not name cannot be resolved', () => {
  const err = refusal(() => packFor('a-pack-that-is-not-real'), 'UNKNOWN_PACK');
  assert.ok(err.userMessage, 'a refusal a person may read needs a sentence for them');
});

test('a pack id that is not a string is refused rather than coerced', () => {
  for (const bad of [null, undefined, 42, {}, ['starter'], '']) {
    refusal(() => packFor(bad), 'UNKNOWN_PACK');
  }
});

/**
 * `available: false` is how a pack is withdrawn, and it has to be a refusal
 * rather than a hidden button. A button that is merely absent from the page is
 * still reachable by anybody who kept the id, which is the whole reason prices
 * are resolved on the server in the first place.
 */
test('a withdrawn pack is refused even when its id is guessed correctly', () => {
  const withdrawn = Object.entries(PACKS).find(([, p]) => p.available === false);
  if (!withdrawn) {
    // Nothing is withdrawn today. Prove the mechanism against a synthetic row
    // rather than skipping, because the interesting case is the one that has
    // never happened yet.
    refusal(
      () => packFor('starter', { packs: { starter: { ...PACKS.starter, available: false } } }),
      'PACK_UNAVAILABLE',
    );
    return;
  }
  refusal(() => packFor(withdrawn[0]), 'PACK_UNAVAILABLE');
});

test('a resolved pack carries everything the checkout needs and nothing a browser sent', () => {
  const pack = packFor(PACK_IDS[0]);
  assert.equal(pack.id, PACK_IDS[0]);
  assert.equal(typeof pack.label, 'string');
  assert.ok(Number.isInteger(pack.credits) && pack.credits > 0);
  assert.ok(Number.isFinite(pack.priceUSD) && pack.priceUSD > 0);
  assert.equal(pack.available, true);
  // `null` until Paul creates the Price in Stripe. A Price is immutable, so it
  // is deliberately the last thing to exist -- see section 7 of the spec.
  assert.ok(pack.stripePriceId === null || typeof pack.stripePriceId === 'string');
});

/** The frozen shape is the point: a caller cannot edit a pack's credit count
 *  in memory and have the next reader see it. */
test('a pack cannot be edited after it is resolved', () => {
  const pack = packFor(PACK_IDS[0]);
  assert.throws(() => { pack.credits = 9999; }, TypeError);
  assert.equal(packFor(PACK_IDS[0]).credits, PACKS[PACK_IDS[0]].credits);
});

/**
 * The pack is priced in dollars and granted in credits, and the two must not
 * be able to drift into a bundle that is sold below what it costs to serve.
 * This is an assertion about the CONFIG, not about the code: it fails when
 * somebody edits a number rather than when somebody edits a function.
 */
/**
 * THE DEFECT THAT PROMPTED THE 2026-08-27 LADDER, WRITTEN DOWN SO IT CANNOT
 * COME BACK.
 *
 * The old paid plans were $10/48 CR and $12/64 CR. Against a 46-credit 720p
 * tape both floor to ONE, so /pricing printed "1 tape at 720p" on both cards
 * and two dollars bought a single extra 480p tape. Two rungs, two prices, one
 * offer -- and nothing anywhere went red, because every individual number was
 * defensible. The page was the only place the collision was visible, and by
 * then it was in front of a customer.
 *
 * A rung has to be DISTINGUISHABLE FROM EVERY OTHER RUNG in what it actually
 * buys, not merely in what it costs. This asserts the thing a reader compares:
 * the tuple of tape counts across every size on sale. Two rungs that buy the
 * same tapes are one product with two prices, whatever the credit figures say.
 */
test('no two packs buy the same tapes, at every size on sale', () => {
  const sizes = Object.entries(CONFIG.resolutions)
    .filter(([id, r]) => !id.startsWith('_') && r.available)
    .map(([id, r]) => [id, Math.round(r.estimatedUSDPer15s / CONFIG.creditUSD)]);

  assert.ok(sizes.length > 0, 'no resolution is on sale, so this proves nothing');

  const seen = new Map();
  for (const id of PACK_IDS) {
    const tapes = sizes.map(([size, cost]) => `${size}:${Math.floor(PACKS[id].credits / cost)}`).join(' ');
    const clash = seen.get(tapes);
    assert.equal(clash, undefined,
      `packs ${clash} and ${id} both buy ${tapes} -- two prices for one offer, which is the `
      + 'defect the shelf/archive tiers shipped with');
    seen.set(tapes, id);
  }
});

test('a pack sells credits for more than they cost to serve', () => {
  const costBasis = CONFIG.creditUSD;
  for (const id of PACK_IDS) {
    const pack = PACKS[id];
    const perCredit = pack.priceUSD / pack.credits;
    assert.ok(
      perCredit > costBasis,
      `${id} sells a credit at $${perCredit.toFixed(4)} against a cost basis of $${costBasis} -- that is a loss on every pack`,
    );
  }
});

// ---------------------------------------------------------------------------
// the config gate
// ---------------------------------------------------------------------------

/**
 * `creditConfig` already refuses a PLAN with a missing field or no `_comment`,
 * and a pack is money in exactly the same way -- more so, because a plan is
 * granted by an operator and a pack is granted by a webhook nobody is watching.
 * A pack whose `credits` field went missing in an edit would resolve to
 * `undefined`, reach `grantCredits`, and be refused there as a bad integer --
 * AFTER the customer's card had been charged. The config has to refuse it while
 * it is still a file.
 */
test('a pack with a missing field or no reasoning stops the config loading at all', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-packs-'));
  const write = (packs) => {
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'config', 'credits.json'),
      JSON.stringify({ ...CONFIG, packs }),
    );
  };
  const load = () => creditConfig({ root: dir, reload: true });
  const refused = () => {
    try { load(); } catch (err) { return err; }
    return null;
  };

  try {
    write({ starter: { ...CONFIG.packs.starter } });
    assert.ok(load(), 'a well-formed pack should load');

    for (const missing of ['id', 'label', 'priceUSD', 'credits', 'available', 'stripePriceId']) {
      const pack = { ...CONFIG.packs.starter };
      delete pack[missing];
      write({ starter: pack });
      const err = refused();
      assert.ok(err, `a pack with no ${missing} was accepted`);
      assert.equal(err.code, 'BAD_CREDIT_CONFIG', `a pack with no ${missing} was accepted`);
      assert.match(err.message, new RegExp(missing));
    }

    const unexplained = { ...CONFIG.packs.starter };
    delete unexplained._comment;
    write({ starter: unexplained });
    const err = refused();
    assert.ok(err, 'a pack with no _comment was accepted');
    assert.equal(err.code, 'BAD_CREDIT_CONFIG');
    assert.match(err.message, /_comment|reasoning|estimate/);
  } finally {
    // The module-level cache now holds the temp config. Put the real one back
    // before another test in this file reads it.
    creditConfig({ reload: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
