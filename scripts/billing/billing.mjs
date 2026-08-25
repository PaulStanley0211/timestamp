/**
 * The seam between the HTTP layer and Stripe.
 *
 * WHY THIS FILE EXISTS RATHER THAN `server.mjs` IMPORTING `stripe.mjs`. Three
 * reasons, and the second is the one that would have bitten.
 *
 *   1. It is where the transport and the credentials are injected, which is
 *      what keeps the money guards intact at the only place they can be: a
 *      server built by a test gets a billing object with no `fetchImpl` and no
 *      `STRIPE_SECRET_KEY`, so there is nothing to spend through even if a
 *      handler tried. `server-cli.mjs` is the one caller that hands over a real
 *      transport, exactly as `render.mjs` and `worker-cli.mjs` are for fal.
 *   2. `packs.mjs` reads `config/credits.json` through `scripts/auth/`, and
 *      `server.mjs` deliberately does NOT depend on `scripts/auth/` at import
 *      time -- a missing accounts module has to degrade to a 503 page rather
 *      than a startup crash, and that property is asserted in
 *      `test/web-auth.test.js`. So the pack table is imported LAZILY here, and
 *      the seam stays importable on its own.
 *   3. The signing secret never leaves this module. The web layer asks for an
 *      event and gets one or an error; it never holds the secret in a variable
 *      it could log.
 *
 * WHAT IS DELIBERATELY NOT HERE. Any notion of a customer, a subscription or a
 * payment method. A one-off pack has no state machine -- section 4 of
 * `docs/superpowers/specs/2026-08-24-credit-packs-pricing-design.md` -- which
 * is exactly why it can ship on the file ledger with no database behind it.
 */

import { createCheckoutSession, constructWebhookEvent, StripeError } from './stripe.mjs';

export { StripeError };

/**
 * @param {object} [opts]
 * @param {function} [opts.fetchImpl]   NO DEFAULT ON PURPOSE. Omitted means a
 *        `TypeError` if anything ever tries to spend, which is what a test
 *        should get and what production must not have.
 * @param {() => object} [opts.envImpl] where the two secrets are read, at CALL
 *        time, so a process started without them still serves every page.
 * @param {() => Promise<object>} [opts.loadPacksImpl] seam for the lazy import
 */
export function createBilling({
  fetchImpl = null,
  envImpl = () => process.env,
  loadPacksImpl = () => import('./packs.mjs'),
} = {}) {
  let packsMod = null;
  let pending = null;

  /** The pack table, or a thrown error the caller degrades on. Not memoised as
   *  a rejection: `scripts/auth/` may appear while the server is running, and a
   *  permanently poisoned promise would require a restart for something that
   *  fixed itself. */
  async function packsApi() {
    if (packsMod) return packsMod;
    if (!pending) {
      pending = loadPacksImpl()
        .then((mod) => { packsMod = mod; return mod; })
        .catch((err) => { pending = null; throw err; });
    }
    return pending;
  }

  return {
    /** Everything on offer, for the page. Includes anything withdrawn, so a
     *  page can render it greyed out rather than having to know it exists. */
    async packs() {
      return (await packsApi()).allPacks();
    },

    /** An id from a request becomes a pack, or a `PackError`. */
    async packFor(id) {
      return (await packsApi()).packFor(id);
    },

    /** What a verified session is worth, in credits. */
    async grantForSession(session) {
      return (await packsApi()).grantForSession(session);
    },

    /** Whether a webhook could be verified at all right now. */
    webhookConfigured() {
      const secret = envImpl()?.STRIPE_WEBHOOK_SECRET;
      return typeof secret === 'string' && secret.trim().length > 0;
    },

    /**
     * Verify a delivery and return the event.
     *
     * The RAW bytes go in. Anything that has been through a JSON parser has
     * been through a re-encode, and the signature is over what Stripe sent.
     */
    constructWebhookEvent({ payload, header, nowImpl }) {
      return constructWebhookEvent({
        payload,
        header,
        secret: envImpl()?.STRIPE_WEBHOOK_SECRET ?? '',
        nowImpl,
      });
    },

    /** One hosted Checkout Session. Throws `StripeError` on anything Stripe
     *  or this repo refuses, and a plain `TypeError` when no transport was
     *  injected -- which is a wiring bug and not something to catch. */
    async createCheckoutSession(args) {
      return createCheckoutSession({ ...args, fetchImpl, envImpl });
    },
  };
}
