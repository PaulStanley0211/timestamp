# Interfaces — accounts, quota, and the redesign

Companion to `docs/interfaces.md`, which still governs everything below the web
layer and is unchanged. Same rule: **if your code disagrees with this file, this
file wins.**

Decided with Paul, 2026-08-20:

1. **FRAME is a stated fact** (`4:3 · PAL · 25fps · 15.000s`), styled like the
   reference but inert. 16:9 and 9:16 are not offered — a camcorder tape is 4:3,
   and the 375-frame contract is asserted by ~200 tests.
   **QUALITY is a real choice: 480p and 720p. 1080p is deferred, not cancelled.**

### Measured, 2026-08-20: why the resolution ladder stops at 720p

The tape works at **736×588** (720×576 plus jitter headroom). That is the bar a
source has to clear, and it is the whole answer:

| Source | vs 736×588 | Consequence |
|---|---|---|
| 480p (854×480) | height **480 < 588** | **Upscaled vertically.** The only option that genuinely loses detail. |
| 720p (1280×720) | clears both | Downscaled. Nothing lost. The native fit. |
| 1080p (1920×1080) | clears both easily | Downscaled harder. **Nothing gained over 720p.** |

Measured by rendering identical content at all three through the same pipeline:
SSIM of the delivered tapes was **0.949** (480p vs 1080p) and **0.958** (720p vs
1080p), and a 4× zoom on a hard edge shows no visible difference at all. The
reason is structural rather than marginal — **grain is applied at 720×576, before
the upscale**, because grain applied at 1080 reads as a modern sensor at high ISO
instead of tape (see CLAUDE.md). Detail above the raster is not degraded by the
look; it is discarded by it.

So 1080p costs roughly 2.25× for pixels thrown away *and* forces the expensive
standard tier, because fal's fast Seedance tops out at 720p. It stays in
`config/credits.json` as `available: false` with the reasoning attached, so
enabling it later is one field.

**Do not write UI copy implying 720p is "HD" or 480p is "lower quality video".**
The delivered file is 1080×1920 either way. What differs is how much detail
exists before the grade, and we have measured how much that is worth. The honest
framing: 720p is the native fit; 480p is cheaper and slightly softer because it
sits just under the tape's own resolution.

**The untested risk runs the other way from the sharpness finding.** 480p is
below the raster and gets upscaled — invisible on a test pattern, but **untested
on a face**, and likeness is the entire product. A legitimate cheap tier, not a
free lunch. Phase 0 is what settles it.
2. Provider is **fal.ai**. Higgsfield cannot serve a paid app (consumer creator
   subscription, resale outside terms, per-account concurrency caps — RELIO
   §11.6). Which Seedance versions fal actually serves is being verified
   separately; nothing is wired until it is.
3. **Pricing page and a real enforced quota, but no money movement yet.** Plans
   render, accounts work, the limit is real. Card handling never touches our
   code — when it is wired it goes through hosted checkout.
4. Background is **the selected place, live** — full-bleed, scrimmed, drifting,
   with tape grain over it.

---

## A. Accounts, sessions, credits — `scripts/auth/`

Zero dependencies. `node:crypto` has everything needed.

```
out/accounts/<accountId>/account.json
out/accounts/_index/<emailHash>.json     -> { accountId }   email lookup, no scan
out/sessions/<sessionId>.json
```

```js
// scripts/auth/accounts.mjs
export class AuthError extends Error {}      // .code .userMessage
export const PLANS;                          // frozen, see below

// ASYNC SINCE 2026-08-26, AND THE FOUR BELOW MUST BE AWAITED. Every scrypt
// derivation now runs on the libuv threadpool instead of the event loop. A
// derivation is ~30ms of deliberate CPU and 16 MiB of deliberate memory --
// that is scrypt doing its job -- and done synchronously it froze the whole
// process for its duration, including the status poll and the Stripe webhook.
// A forgotten `await` here yields a Promise where a boolean or an Account is
// expected, which reads as "login always succeeds" or "the account has no
// fields". Grep for these four before assuming a call site is fine.
export async function createAccount({ root, email, password, plan?, consent?, ceiling?, nowImpl?, rand? }): Promise<Account>
export async function verifyPassword(account, password): Promise<boolean>
export async function hashPassword(password, { params?, rand? }): Promise<string>
export async function authenticate({ root, email, password, nowImpl? }): Promise<Account>  // throws BAD_CREDENTIALS

export function findAccountByEmail({ root, email }): Account | null
export function loadAccount({ root, accountId }): Account
export function saveAccount(account): void
export function setPlan(account, planId): void

// scripts/auth/session.mjs
export function createSession({ root, accountId, nowImpl? }): { sessionId, expiresAt }
export function readSession({ root, sessionId }): Session | null
export function destroySession({ root, sessionId }): void
export function signCookie(value, secret): string
export function verifyCookie(signed, secret): string | null
export function sessionSecret({ root }): string     // generated once, stored 0600-ish

// scripts/auth/credits.mjs
// RENAMED FROM quota.mjs ON 2026-08-20 and this block was never updated --
// corrected 2026-08-26. A flat "N tapes a month" quota stopped being honest
// the moment a tape had two prices: a 720p tape costs ~2.2x a 480p one, so
// the same allowance is three tapes or one depending on a choice made after
// the plan was bought. The unit a person spends is a CREDIT, and the price of
// a tape is computed from the resolution it is rendered at.
export function creditCost({ resolution?, seconds?, tier? }): number   // throws RESOLUTION_UNAVAILABLE
export function balanceOf(account): { credits, planId, grantedAt, expiresAt }
export function balanceForId({ root, accountId, nowImpl? }): { credits, ... }
export function ledgerFor(account): Entry[]                 // append-only; balance is SUM(delta), never stored
export function debitCredits(account, { jobId, credits, reason?, nowImpl? }): void  // idempotent by jobId
export function refundCredits(account, { jobId, reason?, spent?, nowImpl? }): void  // throws on spent:true
export function grantCredits(account, { credits, reason, ref?, nowImpl? }): { granted, credits, ref }
export function grantPlanPeriod(account, { planId?, nowImpl? }): void
export function providerWasCalled(job): boolean             // reads job.steps; over-reports on purpose
export function refundIfUnspent(account, job, { reason?, nowImpl? }): boolean
```

**`refundIfUnspent` is the form worth copying, not a bare `refundCredits`.** It
reads the manifest's steps and decides for itself whether a provider was ever
asked for anything, so the rule lives in one place instead of being re-derived
at every call site that thinks it knows. Both refund call sites — the web
create handler's catch, the web cancel handler — and the worker's failure and
cancellation paths go through it. `CLAUDE.md` §28 records where each call site
is and how the worker reaches an account from a job id.

**Password storage: `scrypt`, per-account 16-byte salt, stored as
`scrypt$N$r$p$<salt b64>$<hash b64>`.** Compare with `timingSafeEqual`, never
`===` — a string compare leaks the hash a byte at a time. Node's `scrypt` is in
`node:crypto`; do not add a dependency for this and do not invent a scheme.

**EVERY REFUSAL COSTS THE SAME TIME, whatever the input.** An unknown address
burns an equal derivation, and so does a password too long to be hashed at all
— the two branches must not diverge in either direction. If they do, the wall
clock answers "does this address have an account here", which for this product
means "has this named person uploaded their face to a face-video service".
`test/auth-accounts.test.js` pins the full four-cell matrix (known/unknown ×
ordinary/oversized) as a proportion, never a wall-clock budget.

**Sessions are opaque random ids in a cookie, not JWTs.** 32 bytes from
`randomBytes`, `HttpOnly`, `SameSite=Lax`, `Path=/`. The cookie is HMAC-signed
with `sessionSecret` so a forged id is rejected before any filesystem lookup.
Server-side session records are what makes logout actually log out; a JWT
cannot be revoked and this app can hand someone else's face to whoever holds
the token.

**`Secure` follows the socket, not a header.** `x-forwarded-proto` is whatever
the client typed unless a proxy this deployment actually has rewrote it, so it
is believed only when `TIMESTAMP_TRUST_PROXY=1` says an operator vouched for
one. Default is socket TLS alone. Setting `Secure` off a client-typed header
lets any request turn it on or off by asking.

**`POST /login` and `POST /signup` need a signed double-submit pair.**
`SameSite=Lax` stops a foreign page acting AS a session; it does nothing to
stop one CREATING a session, because the login post needs no cookie at all —
and a visitor silently signed in as somebody else uploads their face onto that
somebody's shelf. So both routes require the `timestamp_csrf` cookie and a
matching hidden `csrf` field, compared in constant time, plus a same-origin
check when `Origin` is present. **A client — including a test — must GET the
form first and carry both halves.** The pair is minted and verified by
`csrfIssue`/`csrfCheck` in `scripts/web/session-middleware.mjs`.

**Both routes are rate limited per client address**: 10 sign-in attempts a
minute, 10 new accounts an hour (`AUTH_RATE_LIMITS`, exported from
`server.mjs`). Keyed on the socket address and never on a header a client can
type, checked before the body is read, answered `429` with `Retry-After`. A
person mistypes a password four times; only a script needs eleven tries in a
minute, and every try costs this process a deliberate derivation.

**Credits are spent when a job is ENQUEUED**, not when it finishes — otherwise
a user starts twelve renders in parallel and every one of them checks a balance
none of them has spent yet. `debitCredits` is idempotent by `jobId`, so a
re-enqueue of the same job is the same render rather than a second charge. A
job that ends **without a tape** — a terminal failure, or a cancellation — is
handed to `refundIfUnspent`, which gives back what the steps never spent; a job
that failed *after* spending is not refunded, because the money is gone.

```js
PLANS = {
  free:    { id:'free',    label:'Free',    priceUSD: 0,  tapesPerMonth: 1  },
  shelf:   { id:'shelf',   label:'Shelf',   priceUSD: 10, tapesPerMonth: 3  },
  archive: { id:'archive', label:'Archive', priceUSD: 12, tapesPerMonth: 4  },
}
```

Paul specified $10 and $12 with a 3–4 tape limit. **Two paid tiers eleven
dollars apart is a weak ladder** — the difference between them has to read as
obviously worth two dollars or it just looks like indecision. Build it as
specified; flagged as worth revisiting once real render costs are metered,
because `config/pricing.json` is still all estimates and a plan priced above an
unmeasured cost is a guess with a price tag on it.

**Nothing in this module may touch a card number, a CVV, or a bank detail.**
There is no payment code here at all, and that survived the checkout being
built. `plan` is set by an operator, never by a form the user fills in.

**The hosted checkout exists as of 2026-08-25**, and it is deliberately outside
this module: `scripts/billing/` creates a Stripe Checkout Session over plain
`fetch` and the web layer answers `303` to Stripe's own domain, where the card
is entered. Two rules make that safe and both are asserted rather than stated:

- **The browser sends a pack id and nothing else.** No amount, no currency, no
  credit count. The id is resolved against `config/credits.json` on the server,
  and an id that is unknown or withdrawn is a `400`.
- **Credits are granted by a signature-verified webhook and by nothing else.**
  Not by the checkout call, and not by the page Stripe redirects back to —
  that page is reachable by anybody who can read a url. The Stripe event id is
  the ledger's idempotency `ref`, so a redelivery is a no-op rather than a
  second payout.

The design is `docs/superpowers/specs/2026-08-24-credit-packs-pricing-design.md`.

---

## B. The redesign — `scripts/web/`

Reference screenshots are Paul's own portfolio work. Match the **layout and
register**, not the specific content.

### The shape

```
/login          logo, email + password, "create one" link.       Unauthenticated.
/signup         same chrome, plus the consent block.
/               the four steps + settings panel + the shelf.     Authenticated.
/pricing        three plans, current one marked.
/j/:id          status (unchanged behaviour, new skin)
/j/:id/select   contact sheet (new skin)
/j/:id/result   the tape (new skin)
```

### The step flow, top to bottom on one page

- **STEP 01 · Your photo** — a tall portrait dropzone, `+ Add photo`. Copy:
  *"Uploaded once, kept in your library — the person in every tape."*
- **STEP 02 · The look** — a **two-column grid** of cards, each a name plus one
  line of detail. Selected card gets a warm 1px border. These are the six
  outfits from `presets/outfits/`, rendered from their `label` and a short form
  of `wardrobe` — **do not hardcode a second copy of the menu.**
- **STEP 03 · The place** — a **horizontal scroll-snap carousel** of photo
  cards. Selected card is larger and carries a `● SELECTED` badge. Dot
  pagination under it. Last card in the rail is **"Use my own place"**, which
  opens the second-reference upload — the backend already supports a place
  photo and it is the strongest version of this product.
- **Tape settings** — the pill row as **facts**: `4:3` / `PAL` / `25 fps`
  active-styled but inert, with the caption *"4:3 is the true camcorder frame."*
  Then `Length 15 SEC`, `Tapes left N of M`. Primary button `⦿ Record the tape`,
  disabled with a plain reason under it (`Upload a photo first`,
  `No tapes left this month`).
- **ARCHIVE · Your tapes** — *"Every recording stays on the shelf."* Grid of
  posters. Empty state is a dashed-border panel: *"The shelf is empty / Pick a
  photo, a look, and a place above — your first tape lands here."*

### The look of it

- Full-bleed background = **the selected place photograph**, `filter: blur(…)`
  plus a heavy dark scrim, cross-fading on selection. Before a place is chosen,
  the warm near-black `#0B0A09` with CSS grain. A `prefers-reduced-motion` user
  gets no drift and no cross-fade.
- Cards are frosted: `background: rgba(…)`, `backdrop-filter: blur(20px)`,
  ~20px radius, 1px translucent hairline border.
- Accent is a **warm amber** (`#C8A15A` family) used sparingly: the `STEP 01`
  eyebrow label, a short 24px rule under each section subtitle, selected borders.
- Type: one system stack. Eyebrow labels are ~11px uppercase with heavy letter
  spacing; headlines ~28px; body muted grey.
- **`#0B0A09` is the delivery surround colour** and it is the right ground for
  the whole app — the same reason it is not pure black in the render.

### The logo

A wordmark, not an illustration: `TIMESTAMP` in the OSD font already bundled
(`assets/fonts/tape-osd.ttf`, VT323) with a small blinking `●` before it, the
way a camcorder shows it is recording. It is already in the repo, already
licensed, and it is the product's own typeface — that is a better logo than
anything drawn.

### Place card imagery

`assets/places/<placeId>.jpg`, served at `/places/<id>.jpg`. **These do not exist
yet and must not block the build.** When the file is missing, render a designed
CSS fallback — a warm gradient keyed deterministically off the place id, the
label, and the `timeOfDay`. Ship the fallback so the page is complete on a fresh
clone; Paul supplies real images later and they appear with no code change.

### Rules that do not move

- **Zero npm dependencies.** No framework, no client bundle, no CDN, no icon
  pack. Inline SVG only.
- **Escape every interpolated value.** Place and outfit text is user-supplied and
  rendered back.
- Validate `:id` with `JOB_ID_RE` before touching the filesystem.
- **The contact sheet must work without JavaScript.** It is the one screen with a
  human decision on it and it gates real spend.
- The JSON API in `docs/interfaces.md` §9 keeps its shapes. This is a reskin plus
  auth, not a protocol change.
- Nothing may become request/response. `POST /api/jobs` still returns 201 at once.
