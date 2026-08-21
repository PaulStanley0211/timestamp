# Stripe subscriptions and the webhook — design

**Date:** 2026-08-21 · **Status:** approved in chat, not started
**Depends on:** the Supabase migration (sub-project 1), whose spec needs
rewriting — `2026-08-21-sqlite-identity-money-design.md` was superseded when the
deployment decision changed.

**Decisions this is built on, all taken 2026-08-21:**

| Decision | Value |
|---|---|
| What sells | Subscriptions on the existing plans: Shelf, Archive, monthly and annual |
| Credit expiry | Unused credits expire each period, as an explicit negative ledger row |
| Identity | Supabase Auth replaces `accounts.mjs` and `session.mjs` entirely |
| Client | PostgREST over `fetch` plus Postgres functions — **zero npm dependencies** |
| Hosting | Supabase for auth and data; a machine with ffmpeg for the worker |

---

## 1. What this must not break

Two locked decisions from `CLAUDE.md` constrain the whole design, and both
survive it.

**"No payment code anywhere. Card details never touch this codebase."** Stripe
**Checkout** is a hosted page on Stripe's domain. The card is entered there, not
here. This repository never sees a PAN, never handles a card field, and stays out
of PCI scope. The decision is honoured exactly as written, not reinterpreted.

**"Zero npm dependencies."** Stripe's API is plain HTTPS, so `fetch` calls it.
Webhook signatures are HMAC-SHA256, which `node:crypto` computes. **No Stripe SDK
is required and none will be added.**

A third, from `docs/security-review-brief.md`, is the security spine of this
document — Paul's own list of what to get right: *"client-controlled prices,
webhook signature verification, replay handling, subscription entitlements."*
Each gets a section below.

---

## 2. The money model

Four Prices in Stripe, created once by hand, their ids recorded in
`config/credits.json` beside the plans they belong to:

| Plan | Monthly | Annual | Credits per period |
|---|---|---|---|
| Shelf | $10 | $100 | 48 |
| Archive | $12 | $120 | 64 |

**Free never touches Stripe.** It is granted at signup and needs no customer, no
subscription and no webhook.

**`annualUSD` is flagged in `config/credits.json` as "ten months for twelve — an
interpretation of Paul's words, NEEDS PAUL".** An agent chose that number. It is
carried here unchanged so the spec matches the code, and it should be confirmed
or replaced before the Prices are created in Stripe, because a Price's amount is
immutable once it exists — changing it means creating a new Price and migrating
subscribers.

### Prices are server-side, always

The browser never sends a price, a plan id, an amount or a credit count. It sends
at most *which plan button was clicked*, and the server resolves that against
`config/credits.json` before creating the Checkout Session. A request naming a
plan that does not exist, or a plan marked unavailable, is a 400.

This is the "client-controlled prices" item from the brief. The rule is: **the
client chooses a plan, never a price.**

---

## 3. Schema additions

```sql
create table billing_customers (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at         timestamptz not null default now()
);

create table subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  stripe_subscription_id text not null unique,
  plan                   text not null,
  status                 text not null,   -- Stripe's own vocabulary, not ours
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  updated_at             timestamptz not null default now()
);

-- Every webhook event this system has ever accepted. The primary key IS the
-- idempotency mechanism; see section 5.
create table stripe_events (
  event_id     text primary key,
  type         text not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);
```

The `ledger` table carries over from the superseded spec, including
**`ledger_once`** — a partial unique index on `(user_id, job_id, reason)` where
`job_id is not null`. Postgres supports partial unique indexes, so the constraint
that made double-charging structurally impossible survives the change of backend.
For grants, the equivalent uniqueness rides on the Stripe event id (section 5).

**RLS on all three.** A user may `select` their own `subscriptions` row and
nothing else. `billing_customers` and `stripe_events` are **service-role only** —
no user-facing read path at all. `stripe_customer_id` is not secret, but there is
no reason for a browser to ever hold one.

---

## 4. The purchase flow

1. Signed-in user clicks a plan. `POST /api/billing/checkout` with `{plan, cadence}`.
2. Server resolves the plan against `config/credits.json`. Unknown or
   unavailable → 400.
3. Server finds or creates the Stripe Customer for `auth.users.id`, recording it
   in `billing_customers`.
4. Server creates a Checkout Session with the resolved Price, and sets
   `client_reference_id` **and** customer metadata to the `user_id`.
5. Browser is redirected to Stripe. **The card is entered on Stripe's domain.**
6. Stripe redirects back to `/account?checkout=done`.

**The redirect grants nothing.** That page is a courtesy message. It is
attacker-controllable — anyone can visit it — so entitlement comes only from a
signature-verified webhook. A user who closes the tab before the redirect still
gets their credits; a user who forges the redirect gets nothing.

---

## 5. The webhook

`POST /api/stripe/webhook`. Unauthenticated by session, authenticated by
signature.

### Signature verification, and the trap in it

Stripe signs the **exact raw request body**. Verification is HMAC-SHA256 over
`"{timestamp}.{raw body}"` keyed by the endpoint's signing secret, compared to
the `v1` scheme in the `Stripe-Signature` header.

**The body must reach the verifier as raw bytes, un-parsed.** This is a real
hazard in this codebase, not a theoretical one: `server.mjs` already routes
bodies through JSON and multipart handling, and any parse-then-reserialise round
trip changes the bytes and breaks every signature. The webhook route must be
registered so it receives the raw buffer before any body handling, and there will
be a test that a re-serialised body **fails** verification — the failure is what
proves the raw path is real.

Comparison uses `crypto.timingSafeEqual`, on buffers of asserted equal length.

**Replay window.** Reject events whose signature timestamp is more than five
minutes old. This is the "replay handling" item from the brief, and it is
separate from idempotency: the tolerance stops a captured-and-replayed request,
idempotency stops Stripe's own legitimate retries from paying twice.

### Idempotency is a primary key, not a check

Stripe retries any non-2xx for up to three days, and does not guarantee ordering.
So processing is:

1. `insert into stripe_events(event_id, type)` — **first, before any work**
2. A unique-violation means this event was already accepted → return **200**
   immediately, do nothing else
3. Otherwise process, then set `processed_at`
4. On failure, record `error` and return 500 so Stripe retries

Returning 200 on a duplicate is deliberate: a duplicate is not an error, and a
non-2xx would make Stripe retry an event already handled. The whole mechanism is
one primary key doing the work that a read-check-write would do incorrectly under
concurrency.

### Events handled, and what each does

| Event | Effect |
|---|---|
| `checkout.session.completed` | Link `stripe_customer_id` to `user_id` if not already linked. Grants nothing. |
| `invoice.paid` | **Grant the period's credits.** Set plan and status. |
| `customer.subscription.updated` | Update plan, status, `current_period_end`, `cancel_at_period_end`. |
| `customer.subscription.deleted` | Downgrade to free. Expire remaining credits as an explicit negative row. |
| anything else | Record it, return 200, do nothing. |

**`invoice.paid` is the only event that grants credits**, and it covers the first
payment and every renewal through one code path. Granting on
`checkout.session.completed` would mean two code paths — one for the first
payment, one for renewals — and the first-payment path would be the one nobody
tests after month one.

### Granting is one Postgres function

```sql
grant_period(p_user_id uuid, p_plan text, p_credits int, p_stripe_event_id text)
```

Atomic by definition — a single function call is a single transaction — which is
what buys back the multi-statement transactions PostgREST does not offer. Inside
one transaction it: expires the previous period's unused balance as an explicit
negative row, inserts the grant, and updates the plan. Uniqueness on
`p_stripe_event_id` means a double-grant is impossible even if idempotency at the
HTTP layer somehow failed — **two independent mechanisms, because this one pays
out money.**

Expiry is realised as a **negative ledger row and never a silent adjustment.**
Credits vanishing without a line is precisely the unauditable thing the
append-only ledger exists to prevent, and that rule does not bend for billing.
`balance` remains `sum(delta)`: derived, never stored.

---

## 6. Testing, and how it cannot spend money

`npm test` must never call Stripe. The same four-guard pattern the fal adapter
already uses applies, for the same reason — the failure mode is a bill, not a red
test:

1. No default `fetchImpl` in the Stripe client. A test that forgets to inject one
   gets a `TypeError`, not a charge.
2. A test asserts the missing-credential error is raised **before** any request is
   attempted — the failure *order* is under test.
3. `"test": "node --test"` stays bare and does not load `.env`.
4. Anything that can spend is named `*-smoke.test.js` and self-skips without
   `TIMESTAMP_LIVE=1`.

**Signature verification is tested offline** with synthetic payloads and a known
secret — no network needed to prove the HMAC. Specifically:

- a correct signature verifies
- a re-serialised (parsed-then-stringified) body **fails** — proves the raw path
- a signature older than the tolerance fails
- a wrong secret fails
- a duplicate `event_id` returns 200 and grants nothing
- `invoice.paid` twice for one event grants exactly one period

**Live verification uses the Stripe CLI**, already installed on the build machine
(v1.50.0): `stripe listen --forward-to localhost:3000/api/stripe/webhook`
delivers genuinely-signed events to a local server, and `stripe trigger` fires
specific ones. This is what lets the entire payment path be **built and proven
before any public URL exists** — only going live needs the deployed endpoint.

---

## 7. Secrets

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` go in `.env`, which is gitignored
and verified absent from the public repository. Test-mode keys first. They are
loaded exactly like `FAL_KEY` — via `--env-file-if-exists=.env` on the scripts
that need them, and never during `npm test`.

**F3 of the security review applies here directly.** That finding is that
`FAL_KEY` is sent to every host on an allow-list rather than only the intended
one. The Stripe client must not repeat it: the secret key goes to `api.stripe.com`
and nowhere else, enforced in code rather than stated in a comment — which is
exactly the distinction that made F3 a finding.

---

## 8. Out of scope

Refunds, proration, dunning and failed-payment recovery, tax, invoicing UI,
multiple currencies, and one-off credit top-ups. Cancellation is handled only as
"downgrade at period end", via Stripe's own customer portal rather than a
self-built settings page.

The render pipeline, the queue, job manifests, the tape look and the retention
sweep are untouched.
