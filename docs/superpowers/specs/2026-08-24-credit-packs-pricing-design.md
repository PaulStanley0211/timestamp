# Credit packs, and what a tape actually costs — design

**Status:** approved 2026-08-24, not started.
**Supersedes:** `2026-08-21-stripe-subscriptions-design.md`, which is kept
because most of it survives verbatim — see §1.

---

## 0. Why this document exists three days after the last one

Two things were learned that the subscription spec could not have known.

**A tape costs $2.08, not $1.51.** The first metered run (CLAUDE.md §22) read
fal's own usage page: it bills **$0.014 per 1000 tokens**, not per second, and it
bills **the raster it returns rather than the one you order**. A 480p order is
delivered at 752x560 and charged for 752x560 — a 37.5% surcharge on every render.
Every plan in the previous spec was sized against a cost **27% below reality**,
which put Shelf at 38% gross and Archive at 31% before Stripe took its cut.

**The usage pattern is bursty, and a subscription is the wrong shape for it.**
This product makes a keepsake out of somebody's own photograph. The natural
behaviour is three tapes in one evening, shown to family, and nothing for six
months. A subscription bills that person monthly for nothing and they churn
annoyed. It also cannot answer the one question that decides whether a
subscription is viable at all: **do people come back and buy again?** Renewal is
inertia, not a choice, so it measures nothing.

**This is a deliberate re-opening of a decision, with new information, and the
information is measured rather than argued.** CLAUDE.md's rule against
re-litigating settled decisions is respected: the settled thing was "how do we
take money", and the answer here is still Stripe Checkout, hosted, no card in
this codebase. What changes is the *object being sold*.

---

## 1. What survives from the subscription spec, unchanged

Do not re-derive any of this. It is correct and it is not affected by the
change from subscriptions to packs.

- **Stripe Checkout is a hosted page on Stripe's domain.** No PAN, no card
  field, no PCI scope. `docs/interfaces-app.md` §A is honoured exactly.
- **Zero npm dependencies.** Stripe's API is plain HTTPS, so `fetch` calls it;
  webhook signatures are HMAC-SHA256, which `node:crypto` computes. No SDK.
- **Prices are server-side, always.** The browser sends *which button was
  clicked*, never a price, an amount or a credit count. The server resolves it
  against `config/credits.json`. A request naming an unknown or unavailable pack
  is a 400. This is the "client-controlled prices" item from the security brief.
- **The raw-body signature trap.** `server.mjs` already parses bodies, and a
  reserialised body breaks every signature. The webhook route must read raw
  bytes before any JSON parsing touches them.
- **Idempotency is a key, not a check.** §5 below extends this to a place the
  old spec did not have to think about.
- **The test suite cannot spend money**, by the same four guards.

---

## 2. The money model

### 2.1 A credit is $0.10 of provider cost

Not a price. A **cost basis**. `config/credits.json` already sets
`creditUSD: 0.10`; what was missing is that credits-per-tape were set by feel
rather than derived from it.

| tape | measured cost | credits | today | |
|---|---|---|---|---|
| 480p | **$2.0785** | **21 CR** | 16 CR | under water |
| 720p | $3.402 *(formula, UNMETERED)* | **35 CR** | 46 CR | over-priced |

Both are wrong today, in opposite directions, which is what happens when a
credit count is chosen rather than computed.

**The 720p row is blocked** — see §7. If a 720p order returns the same 752x560
raster the 480p orders did, then there is **one tier, not two**, and the table
above collapses to a single row.

### 2.2 One price per credit sets every margin at once

**Sell credits at $0.25.** That is 2.5x the cost basis: **60% gross before
Stripe.**

The deciding factor is not the spreadsheet, it is **free retries.** Direct mode
deleted the cheap rejection gate — CLAUDE.md §18 — so a bad likeness now costs a
whole tape instead of four cents, and the customer discovers it *after* the money
is spent. Tapes will be regenerated for free. At one in six, a 50% margin lands
near 40% before storage, egress and the server. $0.25 absorbs a regenerate;
$0.20 does not.

$0.30 is defensible arithmetically and puts the entry pack at $12 for one
fifteen-second clip, which is where a stranger decides it is not worth finding
out. **The entry price is a conversion lever, not a margin lever.**

Because one rate sets every bundle, **tier choice is margin-neutral**: a customer
who spends on 720p and one who spends on 480p earn the same percentage, so no
pack can be gamed into being the unprofitable one.

### 2.3 One pack, one-off, at launch

**$10 for 40 credits. No renewal.**

| | |
|---|---|
| Price | $10.00 one-off |
| Credits | 40 CR |
| Buys | 1 tape at 480p, with 19 CR left over |
| Worst-case provider cost | $3.40 (one 720p tape, if that tier exists) |
| Margin after Stripe fees | **64%** |

**One Price, not four.** A Stripe Price is immutable: a wrong one-off Price costs
a new Price and nothing else, while a wrong subscription Price costs a
migration. With zero customers and one metered resolution, the cheapest thing to
be wrong about is the correct thing to build.

**A tape costs $2.08, so $10 buys one tape.** That is the honest product. If it
reads as expensive, the answer is a cheaper tape — shorter, smaller, a different
model — and **not a thinner margin.**

### 2.4 Pack credits expire twelve months after purchase

Unexpiring credits are a liability with no end date, and the ledger cannot be
closed on any period while they exist. Twelve months is long enough that no real
customer meets it and short enough to bound the tail.

**Realised as an explicit negative ledger row, never as a silent adjustment** —
`config/credits.json`'s own `grant` comment already makes this ruling, and it
stands. Credits vanishing without a ledger line is exactly the unauditable thing
the ledger exists to prevent.

`grant.expiryDays` is `null` today, which means credits never expire. Setting it
to `365` is the change.

---

## 3. THE FREE TAPE: one, ever, with a global ceiling

The free tape has a real job. This product lives or dies on *"that looks like
me"*, and nobody pays before knowing.

**The usual degraded free tier does not work here.** The fixture provider renders
coloured rectangles — a free fixture tape proves the plumbing and says nothing
about the only thing anyone cares about. For this product the free thing has to
be a **real tape**, or it is pointless.

So:

- **One real tape, ever, per verified account.** Not monthly. A recurring free
  tape is a standing **$2.08/user/month** liability against no revenue and no
  card on file.
- **Gated behind email verification**, so an account costs more than a throwaway
  address.
- **A GLOBAL CEILING, checked before the render.** A hard maximum on free tapes
  across all accounts, in config, refused loudly when reached. The difference
  between a good day and a drained balance is a number nobody set. **This is the
  single most important line in this section** and it is the one most likely to
  be dismissed as paranoia.

`config/credits.json`'s free plan changes from `creditsPerPeriod: 16` granted
every 30 days to a **one-time grant of 21 CR at signup** — exactly one 480p tape.

---

## 4. WHAT IS ALREADY BUILT, AND THE ONE GAP THAT MATTERS

**A pack can ship on the current file-based ledger. It does not need Supabase.**
That is a consequence worth stating loudly: the subscription spec implied a
database, because a subscription has a state machine. A one-off purchase has
none. `scripts/auth/credits.mjs` already provides `grantCredits`,
`debitCredits`, `refundCredits`, `balanceOf` and an append-only ledger, and that
is the whole surface a pack needs. **Revenue is not blocked behind the Supabase
migration.**

### The gap: grants are not idempotent — **CLOSED 2026-08-24**

`debitCredits` is idempotent by `jobId` — the ledger's own header explains why,
because a job can be enqueued more than once. **`grantCredits` has no such key.**
It writes `{ at, delta, jobId: null, reason }`, so nothing stops the same grant
landing twice.

**Stripe will deliver the same webhook event more than once. That is documented
behaviour, not an edge case.** As written, a replayed
`checkout.session.completed` grants the credits again, free, and the ledger has
no way to tell the second row from a legitimate second purchase.

**The fix, and it is a precondition for any webhook code:**

- Ledger entries gain an optional **`ref`** field — an opaque idempotency key.
- `grantCredits` accepts `{ ref }` and, inside the same `updateAccount`
  transaction that already guards the balance, **refuses when an entry with that
  `ref` already exists** — returning the existing entry rather than throwing, so
  a replay is a no-op and not a 500 back to Stripe.
- The webhook passes the **Stripe event id** as `ref`.

This is the file-ledger form of the old spec's "idempotency is a primary key,
not a check", and it must be written and tested **before** the webhook exists,
not alongside it.

**DONE 2026-08-24.** `grantCredits` takes `ref`, dedupes inside the existing
`updateAccount` lock, and returns `{ granted, credits, ref }` so the webhook can
tell a payment from a redelivery without reading the ledger back. A bad `ref` --
empty, blank, not a string -- is refused with `BAD_REF` rather than treated as
absent, because a caller passing `''` believes it is protected and is not.

**Two traps this hit, both worth knowing before touching that module again:**

1. **`entriesOf` projects a fixed shape and drops what it does not name.** The
   `ref` was written to disk correctly and left off the projection, so the
   dedupe compared every stored entry against `undefined` -- **idempotent in
   memory, and not idempotent at all across a reload**, which is the only case a
   webhook has. There is now a round-trip test that reloads the account from
   disk before asserting.
2. **A sequential test is not enough.** Stripe retries can overlap, so the check
   has to be inside the per-account lock. There is an **8-thread barrier test**
   -- the same harness the debit race uses -- asserting all eight calls succeed,
   exactly one reports `granted: true`, and the balance moves once.

---

## 5. The purchase flow

1. Signed-in customer clicks the pack. The browser POSTs **the pack id and
   nothing else**.
2. The server resolves the pack against `config/credits.json`, refuses an
   unknown or unavailable id with a 400, and creates a Stripe **Checkout
   Session** with `client_reference_id` set to the account id.
3. Redirect to Stripe's hosted page. The card is entered there.
4. Stripe redirects back to a success page that **grants nothing**. The success
   page is a UI event, not a money event — it is reachable by anyone who can
   read a URL.
5. **The webhook grants the credits.** It is the only thing that does.

---

## 6. The webhook

**Route:** `POST /api/stripe/webhook`, raw body, no session required.

- **Verify the signature first**, over the raw bytes, HMAC-SHA256 with
  `node:crypto.timingSafeEqual`. An unverified request is a 400 and nothing
  else happens.
- **Reject a timestamp outside a five-minute window** — replay protection is a
  separate concern from idempotency and both are needed.
- **Event handled: `checkout.session.completed`** with `payment_status: 'paid'`.
  One event, because one pack. Ignore everything else with a 200, so Stripe
  stops retrying events this product does not care about.
- **Grant with `ref = event.id`** per §4.
- **Return 200 only after the ledger write has landed.** A 200 before the write
  tells Stripe to stop retrying the one thing that matters.

---

## 7. GATES — what must be true before a Stripe Price is created

A Price is immutable. These are not preferences, they are preconditions.

1. **Meter the parked 720p job** — `20260824-225641-f34b4f`, one paid call. If
   it returns 752x560, there is one tier and §2.1 collapses to a single row.
   **Pricing two tiers that are one product is a claim on a public page that
   is not true.**
2. **Fix the estimator** to price video by fal's token formula rather than per
   second. `--dry-run` currently quotes the **identical $2.079 at both tiers**
   (CLAUDE.md §24), so the command whose entire purpose is authorising a spend
   cannot tell them apart.
3. **The blind check.** If the likeness does not hold for strangers there is no
   product to price, and every number here is arithmetic about nothing.

---

## 8. Testing, and how it cannot spend money

The existing four guards are untouched. Additionally:

- **No test calls Stripe.** The webhook is a pure function of
  `(rawBody, signature, secret, clock)` and is tested with fixtures.
- **Signature verification is tested for failure first** — wrong secret,
  tampered body, stale timestamp — before any success case.
- **The replay case is a first-class test**, not an afterthought: the same event
  delivered twice must produce exactly one ledger row, asserted on the row count
  and the balance.
- **A grant below zero and a grant with a duplicate `ref`** both have named
  tests, because both are silent when they go wrong.

---

## 9. Open, and needing Paul

- **`annualUSD: 100`** is now moot at launch — there is no annual plan in a
  one-off pack model. The flag in `config/credits.json` stays until subscriptions
  return.
- **The twelve-month expiry** (§2.4) is a recommendation, not a measurement.
- **Whether a second pack ships at launch.** This spec says no.

---

## 10. Out of scope

- **Subscriptions.** Deferred until repurchase rate says people want them. The
  superseded spec is the starting point when they return; its schema, its two
  guards against double payout and its event table all survive.
- **Refunds through Stripe.** `refundCredits` already handles the product-side
  case — a job that failed before the provider was called. A card refund is a
  dashboard action by a human until there is volume to justify otherwise.
- **Anything requiring Supabase.** §4 — a pack does not need it.
