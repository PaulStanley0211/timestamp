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

## A. Accounts, sessions, quota — `scripts/auth/`

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
export function createAccount({ root, email, password, plan?, nowImpl? }): Account
export function findAccountByEmail({ root, email }): Account | null
export function verifyPassword(account, password): boolean
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

// scripts/auth/quota.mjs
export function quotaFor(account, { nowImpl? }): { limit, used, remaining, resetsAt, planId }
export function consumeQuota(account, { jobId, nowImpl? }): void   // throws QUOTA_EXCEEDED
export function refundQuota(account, { jobId }): void
```

**Password storage: `scrypt`, per-account 16-byte salt, stored as
`scrypt$N$r$p$<salt b64>$<hash b64>`.** Compare with `timingSafeEqual`, never
`===` — a string compare leaks the hash a byte at a time. Node's `scrypt` is in
`node:crypto`; do not add a dependency for this and do not invent a scheme.

**Sessions are opaque random ids in a cookie, not JWTs.** 32 bytes from
`randomBytes`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when the request
arrived over TLS. The cookie is HMAC-signed with `sessionSecret` so a forged id
is rejected before any filesystem lookup. Server-side session records are what
makes logout actually log out; a JWT cannot be revoked and this app can hand
someone else's face to whoever holds the token.

**Quota is a rolling window on the account record**, `usage: [{jobId, at}]`.
`consumeQuota` is called **when a job is enqueued**, not when it finishes —
otherwise a user starts twelve renders in parallel and every one of them checks
a limit none of them has consumed yet. `refundQuota` exists for the case where a
job fails terminally before the provider was ever called; a job that failed
*after* spending is not refunded, because the money is gone.

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
There is no payment code here at all. The pricing page describes plans and links
to a hosted checkout that does not exist yet; `plan` is set by an operator or a
future webhook, never by a form the user fills in.

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
