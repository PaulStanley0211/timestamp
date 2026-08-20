/**
 * What a call is going to cost, before it is made.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: every non-zero number in
 * `config/pricing.json` is an ESTIMATE, and treating it as fact is listed
 * under "Common mistakes" in CLAUDE.md for a reason. A published price page is
 * a marketing document; the number that lands on the invoice depends on the
 * resolution actually delivered, the seconds actually billed, whether a
 * retried submit charged twice, and whatever the vendor changed on Tuesday.
 * `assertPricingTable` refuses to load a table whose entries do not admit
 * this, which is the cheapest way to stop an estimate from quietly becoming
 * "the price" in someone's head three months from now.
 *
 * THE ONE EXEMPTION, AND WHY IT IS SAFE. An entry may declare
 * `"estimate": false` only when its `usd` is exactly `0`. Zero is the single
 * price that cannot drift: the fixture provider spawns local ffmpeg and there
 * is no counterparty to bill anyone. Any non-zero number claiming to be a fact
 * fails the load, by name, with the model id in the message.
 *
 * WHY THE ESTIMATE IS RECORDED ON EVERY STEP EVEN THOUGH IT IS A GUESS. The
 * ledger's job is not to predict the bill, it is to notice when the bill
 * stopped matching the guess. `divergence()` over `DIVERGENCE_LIMIT` is what
 * `npm run ledger` names by job -- and it can only do that if an estimate was
 * written down at the moment of the call, next to the actual that arrives (or
 * does not) later. An estimate nobody recorded cannot be wrong, which is the
 * problem with it.
 *
 * `actual: null` means NOT METERED YET and never zero. A metered zero and an
 * unmetered call are different facts, and collapsing them makes the ledger's
 * divergence column silently optimistic.
 */

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../ffmpeg/run.mjs';
import { TerminalError } from './errors.mjs';
import { CURRENCY } from './contract.mjs';

/** Over this, `npm run ledger` names the job. Matches docs/interfaces.md §10. */
export const DIVERGENCE_LIMIT = 0.15;

/** How a model bills. `call` is a flat per-request price; `second` is the
 *  common video shape; `image` the common still shape. A unit not on this list
 *  is a table someone hand-edited without reading the estimator. */
export const PRICING_UNITS = Object.freeze(['image', 'second', 'call']);

export const PRICING_FILE = 'config/pricing.json';

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

const bad = (code, message, detail = null) => new TerminalError(message, { code, detail, provider: 'pricing' });

/**
 * Validate a pricing table. Throws on the first offence, naming the model.
 *
 * Called by `loadPricing`, so a malformed table fails at load rather than at
 * the moment somebody needed a number.
 */
export function assertPricingTable(pricing) {
  if (!isPlainObject(pricing)) throw bad('invalid_pricing', `pricing must be an object, got ${JSON.stringify(pricing)}`);
  if (pricing.currency !== CURRENCY) {
    throw bad('invalid_pricing', `pricing.currency must be ${CURRENCY}, got ${JSON.stringify(pricing.currency)}`);
  }
  if (!isPlainObject(pricing.models)) throw bad('invalid_pricing', 'pricing.models must be an object');

  for (const [model, entry] of Object.entries(pricing.models)) {
    if (!isPlainObject(entry)) throw bad('invalid_pricing', `pricing.models[${model}] must be an object`);

    // The marking is the point of the file. An entry with no `_comment` is an
    // entry whose provenance nobody wrote down, which is how a scraped number
    // becomes an assumption.
    if (typeof entry._comment !== 'string' || entry._comment.length === 0) {
      throw bad('unmarked_price', `pricing.models[${model}] needs a "_comment" saying where the number came from and that it is an ESTIMATE. See the header of ${PRICING_FILE}.`, { model });
    }
    if (typeof entry.estimate !== 'boolean') {
      throw bad('unmarked_price', `pricing.models[${model}].estimate must be a boolean`, { model });
    }
    if (!Number.isFinite(entry.usd) || entry.usd < 0) {
      throw bad('invalid_pricing', `pricing.models[${model}].usd must be a non-negative number, got ${JSON.stringify(entry.usd)}`, { model });
    }
    // The exemption, and its only safe form.
    if (entry.estimate === false && entry.usd !== 0) {
      throw bad('unmarked_price', `pricing.models[${model}] claims estimate:false with usd=${entry.usd}. Only a zero price may claim to be a fact -- every non-zero number here is an ESTIMATE until a --meter run proves it.`, { model, usd: entry.usd });
    }
    if (!PRICING_UNITS.includes(entry.unit)) {
      throw bad('invalid_pricing', `pricing.models[${model}].unit must be one of ${PRICING_UNITS.join('|')}, got ${JSON.stringify(entry.unit)}`, { model });
    }
  }
  return pricing;
}

/**
 * Load and validate the table.
 *
 * `readImpl` has a real default because reading a JSON file off disk is not
 * spending -- the no-default rule in CLAUDE.md is specifically about
 * `fetchImpl` on a paid provider.
 */
export function loadPricing({ root = REPO_ROOT, file = PRICING_FILE, readImpl = fs.readFileSync } = {}) {
  const full = path.isAbsolute(file) ? file : path.join(root, file);
  const raw = readImpl(full, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw bad('invalid_pricing', `${full} is not valid JSON: ${err.message}`, { file: full });
  }
  return assertPricingTable(parsed);
}

/** One entry, or a terminal error naming what is on the menu. A typo in a
 *  model id must not silently price at zero. */
export function priceEntry(pricing, model) {
  const entry = pricing?.models?.[model];
  if (!isPlainObject(entry)) {
    throw bad('unknown_model', `no price recorded for ${JSON.stringify(model)} in ${PRICING_FILE}. Known: ${Object.keys(pricing?.models ?? {}).join(', ') || '(none)'}`, { model });
  }
  return entry;
}

/** Round to the cent-and-then-some. Four decimals because a per-second video
 *  price of $0.0016 is a real number and rounding it to cents at the line-item
 *  level turns a 15-second clip into $0.00. */
const usd = (n) => Number(n.toFixed(4));

function quantityFor(entry, { count, seconds }, model) {
  switch (entry.unit) {
    case 'image': return count;
    case 'second': return seconds;
    case 'call': return 1;
    default: throw bad('invalid_pricing', `pricing.models[${model}].unit ${JSON.stringify(entry.unit)} has no estimator`, { model });
  }
}

/** Estimated USD for a still request. */
export function estimateStill({ pricing, model, count = 1 }) {
  if (!Number.isInteger(count) || count < 1) {
    throw bad('invalid_request', `estimateStill count must be a positive integer, got ${JSON.stringify(count)}`);
  }
  const entry = priceEntry(pricing, model);
  return usd(entry.usd * quantityFor(entry, { count, seconds: count }, model));
}

/** Estimated USD for one video segment. */
export function estimateVideo({ pricing, model, seconds }) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw bad('invalid_request', `estimateVideo seconds must be a positive number, got ${JSON.stringify(seconds)}`);
  }
  const entry = priceEntry(pricing, model);
  return usd(entry.usd * quantityFor(entry, { count: 1, seconds }, model));
}

/**
 * What a whole job is expected to cost, with the line items kept.
 *
 * The breakdown is not decoration: when the ledger says a job diverged, the
 * next question is always "which half" -- stills or animation -- and a single
 * total cannot answer it.
 *
 * @param {object} args
 * @param {object} args.pricing
 * @param {string} args.stillModel
 * @param {string} args.videoModel
 * @param {number} args.stillCount
 * @param {Array<{seconds:number}>} args.segments
 */
export function estimateJob({ pricing, stillModel, videoModel, stillCount, segments = [] }) {
  const lines = [
    { step: 'still', model: stillModel, quantity: stillCount, usd: estimateStill({ pricing, model: stillModel, count: stillCount }) },
    ...segments.map((seg, i) => ({
      step: 'animate',
      model: videoModel,
      index: i + 1,
      quantity: seg.seconds,
      usd: estimateVideo({ pricing, model: videoModel, seconds: seg.seconds }),
    })),
  ];
  return {
    estimated: usd(lines.reduce((sum, l) => sum + l.usd, 0)),
    actual: null,
    currency: CURRENCY,
    lines,
  };
}

/** The cost block every result and every step carries. `actual` defaults to
 *  null -- NOT METERED YET -- and a caller that means "metered, and it was
 *  free" must pass 0 explicitly. */
export function cost(estimated, actual = null) {
  return { estimated: usd(estimated), actual: actual === null ? null : usd(actual), currency: CURRENCY };
}

/**
 * Signed relative divergence of actual from estimated.
 *
 * Returns `null` when there is nothing to compare: no actual recorded, or an
 * estimate of zero (where a relative divergence is either 0/0 or infinite and
 * neither is a useful thing to print in a ledger column).
 */
export function divergence(estimated, actual) {
  if (actual === null || actual === undefined) return null;
  if (!Number.isFinite(estimated) || !Number.isFinite(actual)) return null;
  if (estimated === 0) return null;
  return (actual - estimated) / estimated;
}

/** True when `npm run ledger` should name this one. Absolute value, because an
 *  estimate that is 40% too HIGH is just as wrong and is the version that
 *  quietly kills a margin calculation. */
export function diverges(estimated, actual, limit = DIVERGENCE_LIMIT) {
  const d = divergence(estimated, actual);
  return d !== null && Math.abs(d) > limit;
}
