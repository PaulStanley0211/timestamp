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
export const PRICING_UNITS = Object.freeze(['image', 'second', 'call', 'token']);

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
    // The exemption, and its only safe forms. There are two.
    //
    // ZERO is a fact because it cannot drift: a local ffmpeg call costs nothing
    // and no invoice will ever say otherwise.
    //
    // A MEASURED PRICE is a fact too -- but only if it says WHERE it was
    // measured. This clause used to refuse every non-zero `estimate: false`
    // outright, and its own message said why: "until a --meter run proves it".
    // On 2026-08-24 a run finally proved two of them, and an entry forced to
    // keep calling itself an ESTIMATE while carrying an invoiced number is a
    // lie in the other direction. The principle was never "everything is a
    // guess" -- it was "a number may not claim to be a fact without saying
    // why". So the evidence is the price of the claim: an ISO date and a
    // provenance string, both non-empty, or the refusal stands.
    if (entry.estimate === false && entry.usd !== 0) {
      const missing = [];
      if (typeof entry.meteredOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.meteredOn)) missing.push('meteredOn (YYYY-MM-DD)');
      if (typeof entry.meteredFrom !== 'string' || entry.meteredFrom.length === 0) missing.push('meteredFrom (where the number was read)');
      if (missing.length > 0) {
        throw bad('unmarked_price', `pricing.models[${model}] claims estimate:false with usd=${entry.usd} and is missing ${missing.join(' and ')}. A non-zero price may only stop being an ESTIMATE by naming the invoice that proved it.`, { model, usd: entry.usd, missing });
      }
    }
    if (!PRICING_UNITS.includes(entry.unit)) {
      throw bad('invalid_pricing', `pricing.models[${model}].unit must be one of ${PRICING_UNITS.join('|')}, got ${JSON.stringify(entry.unit)}`, { model });
    }
    // A TOKEN PRICE IS THREE NUMBERS, NOT ONE, and a partial one is worse than
    // a per-second rate: it would quote something plausible from an incomplete
    // formula. `usd` is per token; the other two turn a raster and a duration
    // into a token count. Checked here so the failure is "this file is wrong"
    // at load, rather than NaN in a quote.
    if (entry.unit === 'token') {
      for (const field of ['tokensPerPixelSecond', 'tokenDivisor']) {
        if (!Number.isFinite(entry[field]) || entry[field] <= 0) {
          throw bad('invalid_pricing', `pricing.models[${model}] is billed per token and needs a positive ${field}, got ${JSON.stringify(entry[field])}`, { model });
        }
      }
      // The fallback is what prices a raster nobody has metered. Absent, an
      // unmetered size would be quoted at the raster we ORDER -- and fal has
      // never once delivered the raster it was asked for.
      if (entry.deliveredUpscaleFallback !== undefined
        && (!Number.isFinite(entry.deliveredUpscaleFallback) || entry.deliveredUpscaleFallback < 1)) {
        throw bad('invalid_pricing', `pricing.models[${model}].deliveredUpscaleFallback must be >= 1, got ${JSON.stringify(entry.deliveredUpscaleFallback)}`, { model });
      }
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

/**
 * What fal actually renders for a given order, and therefore what it bills.
 *
 * A LOOKUP AND NOT A COEFFICIENT, because the two measured upscales are not
 * the same number: 640x480 came back 752x560 (1.175 x 1.167) and 960x720 came
 * back 1112x834 (1.1583 on both axes). A single factor cannot reproduce both,
 * and a price that is nearly right in the money path is a price that is wrong.
 *
 * An ordered raster with no measurement gets `deliveredUpscaleFallback` -- the
 * LARGEST upscale seen so far -- so an unmetered size is quoted high rather
 * than low. Overstating cost understates margin, which is the safe direction;
 * the other way round is an invoice nobody forecast.
 *
 * @returns {{width, height, measured: boolean}}
 */
export function deliveredRaster(entry, size) {
  const key = `${size.width}x${size.height}`;
  const hit = entry.delivered?.[key];
  if (hit) return { width: hit.width, height: hit.height, measured: true };
  const up = entry.deliveredUpscaleFallback ?? 1;
  return {
    width: Math.round(size.width * up),
    height: Math.round(size.height * up),
    measured: false,
  };
}

function quantityFor(entry, { count, seconds, size }, model) {
  switch (entry.unit) {
    case 'image': return count;
    case 'second': return seconds;
    case 'call': return 1;
    // TOKENS ARE PIXELS x FRAMES, which is how fal actually bills video. The
    // raster is REQUIRED rather than defaulted: an estimate that does not know
    // the size cannot price a token-billed model, and falling back to a
    // per-second guess is exactly the flattening that had --dry-run quoting the
    // identical figure at two tiers that differ by 2.2x.
    case 'token': {
      if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) {
        throw bad('invalid_request',
          `pricing.models[${model}] is billed per token, so it needs the raster size -- got ${JSON.stringify(size)}`,
          { model });
      }
      const out = deliveredRaster(entry, size);
      return (out.width * out.height * seconds * entry.tokensPerPixelSecond) / entry.tokenDivisor;
    }
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
export function estimateVideo({ pricing, model, seconds, size = null }) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw bad('invalid_request', `estimateVideo seconds must be a positive number, got ${JSON.stringify(seconds)}`);
  }
  const entry = priceEntry(pricing, model);
  return usd(entry.usd * quantityFor(entry, { count: 1, seconds, size }, model));
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
    // NO STILL LINE WHEN THERE IS NO STILL STAGE. `stillCount: 0` is the direct
    // path -- the tape is generated from the photographs and no image is ever
    // bought -- and quoting a line for it would overstate the price of every
    // direct render. An estimate that names a call nobody will be billed for is
    // worse than no estimate: --dry-run exists so a spend can be authorised
    // against real numbers.
    ...(stillCount > 0
      ? [{ step: 'still', model: stillModel, quantity: stillCount, usd: estimateStill({ pricing, model: stillModel, count: stillCount }) }]
      : []),
    ...segments.map((seg, i) => {
      const entry = priceEntry(pricing, videoModel);
      // THE RASTER TRAVELS WITH THE SEGMENT. `planSegments` already resolves it
      // -- the same size the renderer will order -- so the estimate is priced
      // against what will actually be requested rather than against a default.
      const out = entry.unit === 'token' && seg.size ? deliveredRaster(entry, seg.size) : null;
      return {
        step: 'animate',
        model: videoModel,
        index: i + 1,
        quantity: seg.seconds,
        usd: estimateVideo({ pricing, model: videoModel, seconds: seg.seconds, size: seg.size ?? null }),
        // What fal is expected to send back, and whether that is a measurement
        // or a forecast. A line the operator can see is a forecast is a line
        // they can decide about; one that looks measured and is not, is not.
        ...(out ? { ordered: seg.size, delivered: out, measured: out.measured } : {}),
      };
    }),
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
