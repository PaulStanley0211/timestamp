/**
 * Credits. What a render costs, what an account has, and the append-only record
 * of how it got there.
 *
 * WHY CREDITS AND NOT "FOUR TAPES A MONTH". Because the underlying cost varies
 * by more than 6x with output resolution and a flat allowance cannot survive
 * that. On fal's published token formula a 15-second tape is about $2.02 at
 * 480p, $4.54 at 720p and $10.21 at 1080p. "Four tapes" on a $12 plan is a 33%
 * margin at 480p and a $40 loss at 1080p -- the same plan, the same promise, one
 * dropdown apart. A credit price tracks the cost; a tape count tracks a hope.
 *
 * WHY THE BALANCE IS DERIVED AND NEVER STORED. A stored balance is a second
 * source of truth for a number that is somebody's money, and the moment it
 * disagrees with its own history there is no way to find out which of the two
 * is wrong. Summing an append-only ledger cannot disagree with itself. It also
 * means every credit that ever left an account has a line saying when, for
 * which job, and why -- so "where did my credits go" is a query rather than an
 * apology. Nothing in this module ever edits or removes a ledger entry, and
 * nothing trims the ledger: trimming an audit log is exactly how a balance
 * becomes unexplainable.
 *
 * WHY THE DEBIT HAPPENS AT ENQUEUE. If the balance were checked when a job
 * finishes, a user starts twelve renders in the same second and all twelve pass
 * a check that none of them has paid for yet -- the classic
 * time-of-check/time-of-use hole, except that here every leaked pass is a real
 * invoice from a real provider. Debiting at enqueue makes the check and the
 * spend the same event, and it puts the refusal on the button the person just
 * pressed instead of eleven minutes later on a result page.
 *
 * WHY THE DEBIT RE-READS THE RECORD INSIDE A LOCK. The check is worthless if
 * two callers can both read the same balance before either writes.
 * `debitCredits` ignores the account object it was handed, takes the
 * per-account lock, loads fresh, decides, appends, and only then updates the
 * caller's copy so it stops lying. test/auth-credits.test.js releases twelve
 * real OS threads through one barrier against a balance that covers three and
 * asserts that exactly three get through -- the same harness, and the same
 * reasoning, as test/queue-race.test.js.
 *
 * WHY A DEBIT IS IDEMPOTENT BY jobId. A job is enqueued more than once in
 * normal operation: `POST /api/jobs/:id/select` re-enqueues after the human has
 * picked a still, and a retriable failure returns a job to pending. Charging
 * per enqueue would bill one render three times, and the customer would be
 * right to be angry about it. A jobId that already has a debit is a no-op, at
 * the price it was quoted then -- not a second charge and not an error.
 *
 * WHY refundCredits IS ONLY FOR A JOB THAT DIED BEFORE THE PROVIDER WAS CALLED.
 * A job that fails during intake, moderation, expansion or compose has cost
 * nothing, and keeping the credits for it is taking money for an error of ours.
 * A job that fails after `still` or `animate` has started is a different thing
 * entirely: the money has left. Refunding that means a user can start renders,
 * cancel them, and burn unlimited real dollars for free -- not a leak, a tap.
 * So the refund refuses on a job that reached a paid step, loudly, rather than
 * trusting every future caller to remember the distinction.
 *
 * EVERY NUMBER COMES FROM config/credits.json AND NONE OF THEM IS HARDCODED
 * HERE. They are all estimates until a `--meter` run proves them, third-party
 * sources currently disagree about the 480p rate, and this repo already lists
 * "treating config/pricing.json as fact" as a mistake. One metered run has to
 * be able to correct all of it in one edit, which is only true if there is
 * exactly one copy.
 *
 * THERE IS NO PAYMENT CODE HERE. This module counts credits. It never sees a
 * card, and a grant arrives from the operator CLI or a future hosted-checkout
 * webhook. See the header of scripts/auth/accounts.mjs.
 */

import {
  AuthError,
  PLANS,
  creditConfig,
  isFreePlan,
  loadAccount,
  planFor,
  refreshAccount,
  updateAccount,
} from './accounts.mjs';

/**
 * The steps that spend money, from the table in docs/interfaces.md section 7.
 * Everything else in the pipeline is ffmpeg and arithmetic on this machine.
 */
export const PAID_STEPS = Object.freeze(['still', 'animate']);

const defaultNow = () => new Date();

/**
 * The cost table, resolved from config at load. Every resolution appears here,
 * including the deferred one, because a pricing page that wants to show a row
 * greyed out should not have to read the config itself -- and because a row
 * that is present with its reasoning attached is what stops somebody
 * re-deriving the same measurement in six months.
 *
 * `creditsPerReference` is the headline figure a pricing page wants;
 * `creditCost` recomputes for any other duration rather than scaling this, so
 * there is one arithmetic path and not two that round differently.
 */
export const CREDIT_COSTS = Object.freeze(Object.fromEntries(
  Object.entries(creditConfig().resolutions).map(([id, res]) => [id, Object.freeze({
    resolution: id,
    width: res.width,
    height: res.height,
    available: res.available === true,
    estimatedUSDPer15s: res.estimatedUSDPer15s,
    creditsPerReference: creditsFor(res, creditConfig().referenceSeconds, 1),
  })]),
));

/** The `_comment` is stripped: this is the shape the Record button computes
 *  with, and the reasoning stays in the file where the numbers are. */
export const CREDIT_DEFAULTS = Object.freeze({
  resolution: creditConfig().defaults.resolution,
  seconds: creditConfig().defaults.seconds,
  tier: creditConfig().defaults.tier,
});

/** What may actually be ordered today. The pill row and the API validate
 *  against this; `ALL_RESOLUTIONS` is for a page that wants to show what is
 *  coming. */
export const RESOLUTIONS = Object.freeze(
  Object.keys(CREDIT_COSTS).filter((id) => CREDIT_COSTS[id].available),
);
export const ALL_RESOLUTIONS = Object.freeze(Object.keys(CREDIT_COSTS));
export const TIERS = Object.freeze(Object.keys(creditConfig().tiers));

/**
 * The arithmetic, in one place.
 *
 * The engine is the per-reference dollar estimate scaled by duration, NOT the
 * token formula. Pixel count is not the whole rate -- fal's fast Seedance tier
 * tops out at 720p and the tiers are priced differently, so 480p is about a
 * third of 720p rather than the 0.44 its pixel count would suggest. The formula
 * is where the 720p anchor came from and it is kept in config as provenance,
 * with a test asserting the link still holds.
 *
 * ROUNDING IS ALWAYS UP, and that is a decision rather than a detail. Rounding
 * a price down gives away a fraction of a credit on every render, in the same
 * direction every time, invisibly -- which over a few thousand renders is real
 * money that no line item explains. Rounding up is at worst a rounding error in
 * our favour that the customer can see on the button before they press it.
 */
function creditsFor(res, seconds, multiplier) {
  const cfg = creditConfig();
  const usd = res.estimatedUSDPer15s * (seconds / cfg.referenceSeconds);
  return Math.ceil((usd * multiplier) / cfg.creditUSD);
}

/**
 * What this render will cost, in credits. This is the number on the Record
 * button, and it is computed the same way the debit is, because a quote that is
 * computed differently from the charge is a quote that will one day differ from
 * the charge.
 */
export function creditCost({
  resolution = CREDIT_DEFAULTS.resolution,
  seconds = CREDIT_DEFAULTS.seconds,
  tier = CREDIT_DEFAULTS.tier,
  aspect = null,
} = {}) {
  const cfg = creditConfig();
  const res = cfg.resolutions[resolution];
  if (!res) {
    throw new AuthError(`unknown resolution ${JSON.stringify(resolution)}`, {
      code: 'UNKNOWN_RESOLUTION',
      userMessage: 'That output size is not available.',
      detail: { known: RESOLUTIONS },
    });
  }
  if (res.available !== true) {
    // A silent fallback to another resolution would bill for one thing and
    // render another, and the customer would have no way to see it: the button
    // said one number, the ledger says the same number, and the video is not
    // what was ordered. Refusing is the only honest answer.
    throw new AuthError(`resolution ${resolution} is deferred and cannot be ordered`, {
      code: 'RESOLUTION_UNAVAILABLE',
      userMessage: 'That output size is not available yet.',
      detail: { resolution, available: RESOLUTIONS },
    });
  }
  const tierEntry = cfg.tiers[tier];
  if (!tierEntry) {
    // A tier with an invented multiplier is a guess that bills somebody, so an
    // unknown one is refused rather than defaulted to 1.
    throw new AuthError(`unknown tier ${JSON.stringify(tier)}`, {
      code: 'UNKNOWN_TIER',
      userMessage: 'That quality setting is not available.',
      detail: { known: TIERS },
    });
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new AuthError(`seconds must be a positive number, got ${JSON.stringify(seconds)}`, {
      code: 'BAD_SECONDS',
      userMessage: 'That length is not available.',
    });
  }
  // THE SHAPE IS PART OF THE PRICE, because it is part of the cost.
  //
  // A resolution label names the SHORT edge, so 16:9 and 9:16 are exactly 4/3
  // the pixels of 4:3 at the same tier, and fal bills tokens as pixels x
  // seconds. Charging the 4:3 price for a wide tape sells it a third below
  // cost -- and 9:16 is the phone format on a product that delivers to phones,
  // so that would be the MODAL order, not an edge case.
  //
  // REFUSED RATHER THAN DEFAULTED, exactly like an unknown resolution above. A
  // shape nobody priced must not be quietly charged at the cheapest rate: that
  // is the failure where the button, the ledger and the manifest all agree on
  // a number that is not what the render cost.
  const shape = aspect ?? cfg.defaultAspect;
  const known = [cfg.defaultAspect, ...Object.keys(cfg.aspects ?? {})];
  const aspectMultiplier = shape === cfg.defaultAspect ? 1 : cfg.aspects?.[shape];
  if (!Number.isFinite(aspectMultiplier) || aspectMultiplier <= 0) {
    throw new AuthError(`unknown aspect ${JSON.stringify(aspect)}`, {
      code: 'UNKNOWN_ASPECT',
      userMessage: 'That frame shape is not available.',
      detail: { aspect, known },
    });
  }

  return creditsFor(res, seconds, tierEntry.multiplier * aspectMultiplier);
}

/** The estimated provider spend behind a credit figure. For the ledger CLI and
 *  for `npm run ledger`, never for anything a customer is shown -- what they see
 *  is credits, and the dollars behind them are our problem. */
export function estimatedUSD(credits) {
  return credits * creditConfig().creditUSD;
}

// ---------------------------------------------------------------------------
// the ledger
// ---------------------------------------------------------------------------

function assertJobId(jobId) {
  if (typeof jobId !== 'string' || jobId.trim().length === 0) {
    throw new AuthError(`credits need a jobId, got ${JSON.stringify(jobId)}`, {
      code: 'BAD_JOB_ID',
      userMessage: 'Something went wrong starting that tape. Please try again.',
    });
  }
  return jobId;
}

function assertReason(reason) {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    // Every line has to explain itself. A ledger of unlabelled numbers answers
    // "what is my balance" and not "why", and "why" is the only question anyone
    // ever asks about money.
    throw new AuthError(`every ledger entry needs a reason, got ${JSON.stringify(reason)}`, {
      code: 'NO_REASON',
    });
  }
  return reason.trim();
}

/**
 * An idempotency key, or nothing at all.
 *
 * WHY A BAD REF IS REFUSED RATHER THAN TREATED AS ABSENT. A caller passing an
 * empty string believes it is protected and is not: the entry would be written
 * with no key, and the next redelivery would grant the credits again. Failing
 * loudly at the call is the only version of this that cannot be quietly wrong,
 * and the caller is a webhook handling somebody's money.
 */
function assertRef(ref) {
  if (ref === undefined || ref === null) return null;
  if (typeof ref !== 'string' || ref.trim().length === 0) {
    throw new AuthError(`a ledger ref must be a non-empty string or absent, got ${JSON.stringify(ref)}`, {
      code: 'BAD_REF',
    });
  }
  return ref.trim();
}

/**
 * Reads the stored ledger, refusing anything malformed.
 *
 * A skip-the-bad-entry policy would be wrong here in a way it is not wrong for
 * a job listing: skipping a ledger line silently changes a balance, and a
 * balance that is quietly wrong is worse than an account that is loudly stuck.
 * Only this module writes these entries, so a malformed one means the file was
 * edited by hand.
 */
function entriesOf(account) {
  const raw = account?.ledger;
  if (!Array.isArray(raw)) {
    throw new AuthError(`account ${account?.accountId ?? '?'} has no credit ledger`, {
      code: 'LEDGER_MISSING',
      accountId: account?.accountId ?? null,
      userMessage: 'We could not read your credit balance. Please contact support.',
    });
  }
  return raw.map((entry, i) => {
    const delta = Number(entry?.delta);
    const at = Date.parse(entry?.at);
    const ok = Number.isInteger(delta)
      && Number.isFinite(at)
      && typeof entry?.reason === 'string' && entry.reason.length > 0
      && (entry.jobId === null || (typeof entry.jobId === 'string' && entry.jobId.length > 0))
      // `ref` is optional, and EVERY ENTRY WRITTEN BEFORE 2026-08-24 LACKS IT
      // ENTIRELY, so absent is as valid as null. Present but unusable as a key
      // is corruption, and reading it as absent would silently disarm the
      // grant dedupe on exactly the account whose file was damaged.
      && (entry.ref === undefined || entry.ref === null
        || (typeof entry.ref === 'string' && entry.ref.length > 0));
    if (!ok) {
      throw new AuthError(
        `ledger entry ${i} of account ${account?.accountId ?? '?'} is malformed: ${JSON.stringify(entry)}`,
        {
          code: 'LEDGER_CORRUPT',
          accountId: account?.accountId ?? null,
          userMessage: 'We could not read your credit balance. Please contact support.',
          detail: { index: i },
        },
      );
    }
    // THE PROJECTION IS A FIXED SHAPE AND DROPS WHATEVER IT DOES NOT NAME.
    // `ref` was written to disk correctly and left off this line during
    // implementation, and the result was a grant dedupe comparing every stored
    // entry against `undefined` -- idempotent in memory, not idempotent at all
    // across a reload, which is the only case that matters for a webhook. The
    // round-trip test in test/auth-credits.test.js exists because of it.
    return { at: entry.at, delta, jobId: entry.jobId ?? null, reason: entry.reason, ref: entry.ref ?? null };
  });
}

/** The sum. There is no other definition of the balance anywhere in this repo,
 *  and there must not be one. */
function sum(entries) {
  return entries.reduce((total, entry) => total + entry.delta, 0);
}

/**
 * The ledger with a running balance on each line, oldest first. What the
 * account page and `npm run accounts -- ledger` render.
 *
 * The running balance is computed here rather than stored on the entry for the
 * same reason the balance itself is not stored: a number written next to a
 * delta can disagree with the sum of the deltas above it, and then there are
 * two answers.
 */
export function ledgerFor(account) {
  let balance = 0;
  return entriesOf(account).map((entry) => {
    balance += entry.delta;
    return { ...entry, balance };
  });
}

/**
 * The balance and the shape of the current period.
 *
 * `expiresAt` IS NOT A DELETION DATE and the name is the spec's rather than a
 * description. Nothing in this module ever removes credits without writing a
 * ledger line, so credits do not silently vanish on that date; it is when the
 * plan's next grant is due, computed from `grant.expiryDays` in
 * config/credits.json. That field is null today, which means credits roll over.
 * If Paul decides they should not, the expiry must be realised as an explicit
 * negative entry written by whatever grants the next period -- because credits
 * disappearing without a line is precisely the unauditable thing the ledger
 * exists to prevent.
 */
export function balanceOf(account) {
  const entries = entriesOf(account);
  const plan = planFor(account);
  const lastGrant = [...entries].reverse().find((entry) => entry.delta > 0 && entry.reason.startsWith('grant'));
  const { expiryDays } = creditConfig().grant;
  const grantedAt = lastGrant?.at ?? null;
  // `expiryDays === null` means credits do not expire, and it has to be tested
  // for explicitly: `Number(null)` is 0, not NaN, so a `Number.isFinite` guard
  // alone reports an expiry equal to the grant time -- every account, from the
  // instant it is created, showing credits that expired the moment they
  // arrived.
  const expires = expiryDays === null || expiryDays === undefined ? null : Number(expiryDays);
  return {
    credits: sum(entries),
    grantedAt,
    expiresAt: grantedAt !== null && Number.isFinite(expires) && expires > 0
      ? new Date(Date.parse(grantedAt) + expires * 86_400_000).toISOString()
      : null,
    planId: plan.id,
  };
}

/** `balanceOf` for a caller that has an id rather than a record -- the status
 *  page and the CLI both want this and neither should be reaching for
 *  `loadAccount` to get it. */
export function balanceForId({ root, accountId, nowImpl = defaultNow }) {
  return balanceOf(loadAccount({ root, accountId, nowImpl }));
}

function mutableAccount(account, fn) {
  const root = account?.root;
  const accountId = account?.accountId;
  if (!root || !accountId) {
    throw new AuthError(
      `${fn} needs an account loaded by loadAccount/createAccount -- it re-reads the ledger from disk`,
      { code: 'NO_ROOT', accountId: accountId ?? null },
    );
  }
  return { root, accountId };
}

/**
 * Spends credits, durably, or throws.
 *
 * Called by whatever enqueues a job, BEFORE the queue entry is written. The
 * ordering matters in that direction: a crash between debiting and enqueuing
 * costs the customer credits they did not get, which is a support email and a
 * refund; the other order costs a render nobody paid for, repeatable at will.
 *
 * The account object handed in is a hint, never the truth. The record on disk
 * inside the lock is the truth, and the caller's copy is refreshed from it on
 * the way out.
 */
export function debitCredits(account, { jobId, credits, reason = 'render', nowImpl } = {}) {
  assertJobId(jobId);
  assertReason(reason);
  if (!Number.isInteger(credits) || credits <= 0) {
    throw new AuthError(`credits must be a positive integer, got ${JSON.stringify(credits)}`, {
      code: 'BAD_CREDITS',
      userMessage: 'Something went wrong pricing that tape. Please try again.',
    });
  }
  const { root, accountId } = mutableAccount(account, 'debitCredits');
  const clock = nowImpl ?? account?.nowImpl ?? defaultNow;

  const { account: fresh } = updateAccount({ root, accountId, nowImpl: clock }, (record) => {
    const entries = entriesOf(record);

    // Idempotent by jobId, at the price it was quoted then. A re-enqueue of a
    // job that has already been charged is the same render, not a new one.
    if (entries.some((entry) => entry.jobId === jobId && entry.delta < 0)) return;

    const balance = sum(entries);
    if (balance < credits) {
      throw new AuthError(
        `account ${accountId} has ${balance} credits and the render costs ${credits}`,
        {
          code: 'INSUFFICIENT_CREDITS',
          accountId,
          userMessage: 'Not enough credits for this tape. Choose a smaller size, or top up.',
          detail: {
            required: credits, balance, shortfall: credits - balance, planId: planFor(record).id,
          },
        },
      );
    }
    record.ledger = [
      ...record.ledger,
      { at: toIso(clock), delta: -credits, jobId, reason },
    ];
  });

  refreshAccount(account, fresh);
}

/**
 * Gives back exactly what was taken for one job, as a new positive line.
 *
 * `spent` is the whole safety property. Pass `spent: providerWasCalled(job)`
 * and the distinction cannot be forgotten; `refundIfUnspent` below is the form
 * worth copying. The refund is the exact amount previously debited rather than
 * a recomputed price, because the price may have changed since -- refunding
 * today's quote for yesterday's charge is how a ledger stops adding up.
 *
 * Refunding a job that was never charged, or was already refunded, is a no-op
 * rather than an error: a double refund, a refund for a cancelled job that
 * never got as far as a debit, and a refund after another one all mean the same
 * thing -- there is nothing to give back.
 */
export function refundCredits(account, { jobId, reason = 'refund:failed-before-provider', spent = false, nowImpl } = {}) {
  assertJobId(jobId);
  assertReason(reason);
  if (spent === true) {
    throw new AuthError(
      `refusing to refund ${jobId}: a paid step had already started, so the money is gone`,
      {
        code: 'REFUND_AFTER_SPEND',
        accountId: account?.accountId ?? null,
        userMessage: 'That render had already started, so its credits still count.',
        detail: { jobId },
      },
    );
  }
  const { root, accountId } = mutableAccount(account, 'refundCredits');
  const clock = nowImpl ?? account?.nowImpl ?? defaultNow;

  const { account: fresh } = updateAccount({ root, accountId, nowImpl: clock }, (record) => {
    const entries = entriesOf(record);
    const forJob = entries.filter((entry) => entry.jobId === jobId);
    const owed = -sum(forJob);
    if (owed <= 0) return; // never charged, or already given back
    record.ledger = [
      ...record.ledger,
      { at: toIso(clock), delta: owed, jobId, reason },
    ];
  });

  refreshAccount(account, fresh);
}

/**
 * Adds credits. Called by the operator CLI or, later, by a webhook from a
 * hosted checkout that this process never sees the card details of.
 *
 * NOT REACHABLE FROM A FORM, and that is the money rule rather than an
 * implementation detail: there is no path from an HTTP request body to this
 * function and there must not be one, because the only thing between "buy
 * credits" and "give yourself credits" would be somebody remembering to check.
 *
 * A negative `credits` is a correction -- an operator undoing their own
 * mistake -- and it is allowed because the honest way to fix a ledger is
 * another line, never an edit to an existing one. It may not take the balance
 * below zero: a negative balance is a debt this product has no way to collect
 * and no page that could explain it.
 */
export function grantCredits(account, { credits, reason, ref: rawRef, nowImpl } = {}) {
  assertReason(reason);
  const ref = assertRef(rawRef);
  if (!Number.isInteger(credits) || credits === 0) {
    throw new AuthError(`grant must be a non-zero integer, got ${JSON.stringify(credits)}`, {
      code: 'BAD_CREDITS',
    });
  }
  const { root, accountId } = mutableAccount(account, 'grantCredits');
  const clock = nowImpl ?? account?.nowImpl ?? defaultNow;

  const { account: fresh, outcome } = updateAccount({ root, accountId, nowImpl: clock }, (record) => {
    const entries = entriesOf(record);

    // IDEMPOTENT BY ref, AND THE CHECK IS INSIDE THE LOCK FOR THE SAME REASON
    // THE DEBIT'S BALANCE CHECK IS. Stripe redelivers events -- documented
    // behaviour, not an edge case -- and a redelivery can arrive while the
    // first delivery is still inside this function. A check that read before
    // `updateAccount` took the per-account lock would let both through and
    // grant twice. There is an 8-thread barrier test for exactly that.
    //
    // A replay RETURNS rather than throws: the webhook must be able to answer
    // Stripe 200, and a 500 on a duplicate would make Stripe retry the one
    // thing that already succeeded.
    if (ref !== null && entries.some((entry) => entry.ref === ref)) return { granted: false };

    const balance = sum(entries);
    if (balance + credits < 0) {
      throw new AuthError(
        `a grant of ${credits} would take account ${accountId} from ${balance} to ${balance + credits}`,
        {
          code: 'GRANT_BELOW_ZERO',
          accountId,
          detail: { balance, credits },
        },
      );
    }
    record.ledger = [
      ...record.ledger,
      { at: toIso(clock), delta: credits, jobId: null, reason, ref },
    ];
    return { granted: true };
  });

  refreshAccount(account, fresh);
  // Returned rather than void, because the one caller that matters -- the
  // Stripe webhook -- has to be able to tell a payment from a redelivery, and
  // reading it back off the ledger would be a second source of truth.
  return { granted: outcome.granted, credits: outcome.granted ? credits : 0, ref };
}

/**
 * The plan's period grant, by name, so the CLI and a future webhook cannot
 * drift into two ideas of what a plan is worth.
 *
 * THE FREE PLAN HAS NO PERIOD, AND ASKING FOR ONE IS AN ERROR RATHER THAN A
 * NO-OP. Section 3 of the credit-packs spec: "One real tape, ever, per verified
 * account. Not monthly. A recurring free tape is a standing $2.08/user/month
 * liability against no revenue and no card on file." The signup grant in
 * `createAccount` is the whole of the free tape, it is claimed against the
 * global ceiling there, and this is the only other automated path that could
 * ever hand out the same credits a second time -- `npm run accounts -- grant
 * --period` reaches it directly.
 *
 * IT REFUSES INSTEAD OF QUIETLY GRANTING ZERO because the caller is an operator
 * at a terminal who has just typed a command meaning "top this person up", and
 * silence would read as success. An operator who genuinely intends to give a
 * free account more credits still can -- `grant <id> 42 --reason ...` goes
 * through `grantCredits` and writes a row saying a human decided it -- and that
 * is the difference worth preserving: a deliberate gift is auditable, a
 * recurring one is a liability nobody chose.
 */
export function grantPlanPeriod(account, { planId = account?.plan, nowImpl } = {}) {
  const plan = PLANS[planId];
  if (!plan) {
    throw new AuthError(`unknown plan ${JSON.stringify(planId)}`, { code: 'BAD_PLAN' });
  }
  if (isFreePlan(plan.id)) {
    throw new AuthError(
      `the ${plan.id} plan grants one tape ever, at signup, and has no period to grant`,
      {
        code: 'FREE_TAPE_IS_ONCE_EVER',
        detail: { planId: plan.id },
        userMessage: 'The free tape is a one-time grant and cannot be renewed.',
      },
    );
  }
  grantCredits(account, { credits: plan.creditsPerPeriod, reason: `grant:period:${plan.id}`, nowImpl });
  return plan.creditsPerPeriod;
}

function toIso(clock) {
  const value = clock();
  const d = value instanceof Date ? value : new Date(Number(value));
  if (Number.isNaN(d.getTime())) {
    throw new AuthError(`nowImpl returned ${String(value)}; it must return a Date or epoch milliseconds`, {
      code: 'BAD_CLOCK',
    });
  }
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// the refund rule
// ---------------------------------------------------------------------------

/**
 * Whether this job ever got as far as asking a provider for something.
 *
 * Reads only `job.steps`, which is a plain array in the manifest, so this stays
 * decoupled from the job model rather than importing it. `attempts > 0` on a
 * paid step is the test, and it deliberately OVER-reports: a step that began
 * and crashed one line before the request went out cost nothing and is still
 * treated as spent. That direction is chosen on purpose. Over-reporting costs
 * one customer one render and a support email; under-reporting hands out an
 * unlimited supply of free provider calls, and the only place that shows up is
 * the invoice.
 */
export function providerWasCalled(job) {
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  return steps.some((step) => PAID_STEPS.includes(step?.name) && Number(step?.attempts ?? 0) > 0);
}

/**
 * The 4xx outcomes that mean the provider did no work there is anything to
 * bill for: it read the request, understood it, and declined.
 *
 * `moderation_refused` and `bad_request` are the two shapes `classifyHttp`
 * gives a 400 or 422; `credential` is a 401 or 403, where the request was
 * never even authorised. None of them produces a generation, and CLAUDE.md §8
 * records the same fact measured against fal directly: a 422 is not billed.
 *
 * DELIBERATELY NOT HERE: `upstream` (5xx), `rate_limited`, `timeout`, and the
 * absence of any recorded error. Every one of those is a case where the
 * request may have been served and billed while the answer was lost, which is
 * exactly the ambiguity §37E refused to guess at.
 *
 * AND NOT `generation_failed`, which is the code fal's adapter gives any
 * terminal failure that arrives AFTER the queue accepted the request -- a
 * status that comes back FAILED, or a result URL that answers 4xx. Those are
 * 4xx by shape and not by meaning: the work was queued and ran, and fal's own
 * documentation says a failed generation is billable on some plans. The
 * provider's underlying classification is kept in `error.detail.refused` for
 * the status page; it is not consulted here, on purpose. A refusal of the
 * OUTPUT is a generation that happened.
 */
const UNBILLED_REFUSALS = Object.freeze(['moderation_refused', 'bad_request', 'credential']);

/**
 * Whether every paid attempt this job made ended in a provider refusal.
 *
 * THE CASE §37E DID NOT CONSIDER. Its reasoning was that nothing on disk can
 * distinguish a pre-flight crash from an in-flight loss, so a paid step that
 * was attempted must be assumed billed. That is right about ambiguity and this
 * is the outcome that carries none: a 4xx refusal is a recorded answer FROM the
 * provider saying it declined to run.
 *
 * Measured 2026-09-02 on the first real paid order: job 20260902-141334-34a7e4
 * was refused on content grounds and the owner's balance went 21 to 0 for a
 * tape that was never generated. On the free tier that is a customer's entire
 * grant, spent on nothing.
 *
 * `attempts === 1` IS PART OF THE TEST AND NOT A DETAIL. Only the last
 * attempt's error survives on the manifest, so a step tried twice could have
 * been served once and refused once, and its recorded error would look
 * identical to a clean refusal. One attempt is the only case where the recorded
 * error describes everything that happened.
 */
function providerRefusedWithoutCharge(job) {
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const paid = steps.filter(
    (step) => PAID_STEPS.includes(step?.name) && Number(step?.attempts ?? 0) > 0,
  );
  if (paid.length === 0) return false;
  return paid.every((step) => (
    Number(step.attempts) === 1
    && step.status === 'failed'
    && UNBILLED_REFUSALS.includes(step?.error?.code)
  ));
}

/** The form worth copying: the rule applied rather than restated. Returns
 *  whether anything was given back, and never throws for the spent case --
 *  declining a refund is a normal outcome, not an error. */
export function refundIfUnspent(account, job, { reason, nowImpl } = {}) {
  const refused = providerRefusedWithoutCharge(job);
  if (providerWasCalled(job) && !refused) return false;
  refundCredits(account, {
    jobId: job.jobId,
    // The two cases are different facts and the ledger says which: one never
    // reached a provider, the other reached one and was turned away. A refund
    // labelled "failed-before-provider" for a job that plainly did call fal is
    // the kind of line that makes an audit trail stop being trusted.
    //
    // THE FACT WINS OVER THE CALLER'S GUESS. The worker asks with the one
    // reason it knows -- the job failed -- and cannot know whether a provider
    // was reached until the steps are read, which happens here. With the
    // caller's reason taking precedence, the refused label was dead code and
    // the line above was written for every refused job. A caller's reason
    // still stands for a job that never reached a provider, because there it
    // IS the fact: cancelled, reaped, never enqueued.
    reason: refused ? 'refund:provider-refused' : (reason ?? 'refund:failed-before-provider'),
    spent: false,
    nowImpl,
  });
  return true;
}

/** Re-exported so a caller does not have to import two modules to render a
 *  pricing table next to a balance. */
export { PLANS };
