/**
 * What is for sale, resolved from config and never from a request.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: **the client chooses a pack, never a
 * price.** The browser POSTs a pack id and nothing else -- no amount, no
 * currency, no credit count -- and this module turns that id into the row in
 * `config/credits.json` that says what it costs and what it grants. An id that
 * is not in the file, or is in it and withdrawn, is a refusal. That is the
 * "client-controlled prices" item from `docs/security-review-brief.md`, and it
 * is a property of where the numbers live rather than of anybody remembering
 * to check them.
 *
 * WHY A WITHDRAWN PACK IS A REFUSAL AND NOT A HIDDEN BUTTON. Removing a card
 * from the pricing page removes it from the page and from nowhere else: the id
 * is still whatever it was, and anybody who wrote it down can still post it.
 * `available: false` has to be enforced where the money is resolved.
 *
 * WHY THIS IS NOT IN `scripts/auth/credits.mjs`. That module's header says, in
 * capitals, that there is no payment code in it -- it counts credits and never
 * sees what they were sold for. A pack is a price with a credit count attached,
 * which is the other side of exactly that line. The two meet in the webhook,
 * where a verified payment becomes a `grantCredits` call, and nowhere else.
 *
 * EVERY NUMBER COMES FROM `config/credits.json` AND NONE IS WRITTEN HERE, for
 * the same reason `credits.mjs` says so about the cost table: one edit has to
 * be able to correct all of it, which is only true if there is exactly one
 * copy.
 */

import { creditConfig } from '../auth/accounts.mjs';

/** Anything this module refuses. `userMessage` is the sentence the web layer
 *  may render; `message` is for the log and may name the id that was tried. */
export class PackError extends Error {
  constructor(message, { code = 'PACK_ERROR', userMessage = null, detail = null } = {}) {
    super(message);
    this.name = 'PackError';
    this.code = code;
    this.userMessage = userMessage;
    this.detail = detail;
  }
}

/** `_comment` keys are documentation, not packs. */
const isPackKey = (key) => !key.startsWith('_');

function rowsOf(config) {
  return Object.entries(config?.packs ?? {}).filter(([key]) => isPackKey(key));
}

/**
 * The packs, as loaded. `_comment` is stripped so this is the shape a page
 * renders; the reasoning stays in the file, where the numbers are.
 *
 * Frozen, and frozen deliberately: a caller that could edit `credits` in
 * memory would be a second source of truth for how much somebody is owed.
 */
export const PACKS = Object.freeze(Object.fromEntries(
  rowsOf(creditConfig()).map(([id, pack]) => [id, Object.freeze({
    id: pack.id ?? id,
    label: pack.label,
    priceUSD: pack.priceUSD,
    credits: pack.credits,
    // Absent means available, matching how `resolutions` reads in
    // session-middleware: a pack added without the field is offered rather
    // than silently swallowed.
    available: pack.available !== false,
    // `null` until the Price exists in Stripe. A pack with no Price still
    // renders -- it is a real offer waiting on one immutable object -- and the
    // checkout route refuses it with a 503 rather than a 400, because the gap
    // is ours and not the customer's.
    stripePriceId: pack.stripePriceId ?? null,
  })]),
));

export const PACK_IDS = Object.freeze(Object.keys(PACKS));

/**
 * An id from a request becomes a pack, or a refusal.
 *
 * @param {string} id
 * @param {{packs?: object}} [opts]  a substitute table, for the test that
 *        exercises a withdrawn pack before one has ever been withdrawn
 * @returns {{id, label, priceUSD, credits, available, stripePriceId}}
 * @throws {PackError}
 */
export function packFor(id, { packs = PACKS } = {}) {
  const wanted = typeof id === 'string' ? id.trim() : '';
  const pack = wanted.length > 0 ? packs[wanted] : undefined;
  if (!pack) {
    // The same answer for "no such pack" and "not a string", because the
    // difference is only ever interesting to somebody probing the endpoint.
    throw new PackError(`no pack ${JSON.stringify(id)}`, {
      code: 'UNKNOWN_PACK',
      userMessage: 'That is not something we sell.',
      detail: { known: Object.keys(packs).filter(isPackKey) },
    });
  }
  if (pack.available === false) {
    throw new PackError(`pack ${wanted} is withdrawn and cannot be bought`, {
      code: 'PACK_UNAVAILABLE',
      userMessage: 'That is not on sale at the moment.',
      detail: { pack: wanted },
    });
  }
  return pack;
}

/** What a pricing page renders: every pack, including any that is withdrawn,
 *  so a page can show one greyed out rather than having to know it exists. */
export function allPacks() {
  return PACK_IDS.map((id) => PACKS[id]);
}

/**
 * A bound on anything this repo will grant from one webhook.
 *
 * Not a business rule -- a blast radius. Everything below is reached only
 * after a signature has proved Stripe sent it, so this is not defending
 * against a forged request; it is defending against our own metadata being
 * wrong, a Price being edited in the dashboard, or a decimal point moving in
 * config. A grant that is obviously absurd should stop rather than land.
 */
export const MAX_PACK_CREDITS = 10_000;

/**
 * What a completed Checkout Session is worth, in credits.
 *
 * TWO SOURCES, AND THE ORDER BETWEEN THEM IS A DECISION. `metadata.credits` is
 * what the customer was quoted at the moment they paid, written into the
 * session when it was created; `config` is what that pack means today. They
 * differ only if the pack was repriced between the click and the payment, and
 * in that case THE PROMISE WINS -- a person paid for a number that was on the
 * screen, and honouring today's smaller one because a config file moved is a
 * quiet way of shortchanging them. Config is the fallback for a session that
 * carries no promise at all: one created by hand in the Stripe dashboard, or
 * one from before this field existed.
 *
 * TRUSTING METADATA IS NOT TRUSTING A CLIENT. This function runs only after
 * `constructWebhookEvent` has proved the bytes came from Stripe with our
 * signing secret. The browser's entire contribution to this path is a pack id
 * posted to `/api/billing/checkout`, and it was resolved against config there.
 *
 * @param {object} session  `event.data.object`
 * @returns {{credits: number, packId: string|null, source: 'metadata'|'config', mismatch: boolean}}
 * @throws {PackError} when neither source names a number
 */
export function grantForSession(session, { packs = PACKS } = {}) {
  const packId = typeof session?.metadata?.pack === 'string' && session.metadata.pack.trim().length > 0
    ? session.metadata.pack.trim()
    : null;
  const configured = packId !== null && packs[packId] ? packs[packId].credits : null;

  const raw = session?.metadata?.credits;
  const promised = raw === undefined || raw === null || String(raw).trim() === '' ? null : Number(raw);
  const promisedOk = promised !== null
    && Number.isInteger(promised) && promised > 0 && promised <= MAX_PACK_CREDITS;

  if (promised !== null && !promisedOk) {
    // A metadata field that is present and unusable is corruption, not
    // absence. Falling back would grant a different number than the one on the
    // receipt, silently.
    throw new PackError(
      `session metadata names ${JSON.stringify(raw)} credits, which is not a sane whole number`,
      { code: 'BAD_SESSION_CREDITS', detail: { pack: packId, credits: raw } },
    );
  }

  if (promisedOk) {
    return {
      credits: promised,
      packId,
      source: 'metadata',
      mismatch: configured !== null && configured !== promised,
    };
  }
  if (configured !== null) {
    return { credits: configured, packId, source: 'config', mismatch: false };
  }
  throw new PackError(
    `session names pack ${JSON.stringify(packId)}, which is not in config, and promises no credit count`,
    {
      code: 'NO_CREDITS_FOR_SESSION',
      detail: { pack: packId, known: PACK_IDS },
    },
  );
}
