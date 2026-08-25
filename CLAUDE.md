# Timestamp

One photo, one place, one outfit — fifteen seconds that look like a camcorder tape from 2003.
Warm, grainy, quiet.

**Engine:** `C:\Users\pauls\Timestamp` · **Stack:** Node 22+, ESM, `node --test`, npm · **Conventions:** mirrored from `C:\Users\pauls\Ad-Regenerator`

---

## START HERE (2026-08-26) — THE SECURITY FIX ORDER IS WORKED, TOP TO BOTTOM

**1284 tests / 1282 pass / 0 fail / 2 skipped.** The skips are the
`*-smoke.test.js` money guards, which self-skip without `TIMESTAMP_LIVE=1`.
Branch `ui-redesign-signed-in-page`, **pushed 2026-08-26** (`6efb0e6..2464b35`);
`origin/main` is still `b6f64a3`, **50 commits behind, nothing merged**.
Opening a PR is Paul's call, not a prerequisite.

**NO CI HAS RUN ON THIS BRANCH AND NONE WILL.** Both workflows trigger on
`push: branches: [main]` and `pull_request` only, so a feature-branch push
runs nothing. **The first CI run happens the moment a PR opens** — and Linux
will be red on the two pre-existing tests in section 4 (one asserts how a
particular ffprobe build spells `EXIF metadata` in side data, the other
asserts ffmpeg's error wording). Neither is a product defect and neither
comes from the security work; they are worth fixing BEFORE opening a PR
rather than explaining afterwards.

**ALL SEVEN ITEMS OF THE REVIEW'S FIX ORDER ARE CLOSED (2026-08-25/26),**
one commit each, strict test-first, on this branch — see section 28. What
remains open is in the review on this machine and nowhere else. **THE
`config/models.json` WARNING STILL STANDS**: one finding that arms on that
edit was NOT in the fix order and is still open — whoever fills in the still
model reads the review's section 3 first.

**This block is a HANDOFF, not a diary.** Everything struck through has moved
into a numbered section. **SECTION 27 IS CLOSED** — the test-mode card payment
was finished at midday with no second payment: the redeliverable event landed
the grant, and resending that same event a second time proved the idempotency
guard against genuine Stripe redelivery, not a synthetic fixture. **What is
next is Paul's — items 1-3 below.** Section 26 is the measured price list; 25
is the checkout; 27 is the closed payment demo.

### The one thing to know

**A model can put Paul in a place recognisably, from one photograph, and hold it
through fifteen seconds of video with no intermediate image at all.** That was
the only question that decided whether this is a product. It is answered — by
`seedream/v4.5/edit` on the still and `seedance-2.0/reference-to-video` on the
tape. **What is NOT answered is whether it holds for anyone who is not Paul.**

**AND IT HOLDS AT 720p, ON PAUL'S OWN VERDICT (2026-08-25).** His words on the
first 720p tape: *"it looks great ... especially the face ... it looks like it
was real ... it doesn't look like AI."* That is the half of the blind check only
he can give, on the tier the product will actually sell. The stranger half is
still owed — item 2 below.

### What the product IS

**Four choices and a tape: photo, outfit, place, frame shape.** No still, no
gate, nothing to approve — section 18. **Fifteen seconds is a SHOT LIST**, six
beats — section 19. **The bed knows where it is** — section 20.

```bash
node --env-file-if-exists=.env scripts/render/render.mjs --photo=assets/test-photos/face.jpg --place=ostsee-strand --outfit=hemd-jeans --consent --provider=fal --direct --video-model=bytedance/seedance-2.0/reference-to-video
```

`--dry-run` prices it for free. `--stop-after=compose` runs every free step and
stops before the money. `--resolution=480p|720p` orders a tier — new today,
section 24.

---

### PICK UP HERE

~~**PICK UP AT SECTION 27: ONE COMMAND FINISHES THE PAYMENT DEMO.**~~ **DONE
2026-08-25** — the payment path is proven end to end: checkout, webhook
signature, grant, and idempotent replay against a genuine Stripe redelivery.
**Read §27's banner before re-running it**: a test-mode event grants nothing
now, on purpose.

~~**THEN: THE SECURITY REVIEW'S FIX ORDER.**~~ **DONE 2026-08-25/26 — §28.**
All seven items, one commit each, test-first, pushed. **Nothing in the fix
order is left.**

**SO WHAT IS ACTUALLY NEXT, in the order it is worth doing:**

1. **Three things are Paul's and nothing else can proceed on two of them** —
   items 1-3 in START HERE: fal's actual cost for the 720p run, the blind
   check, and the UI direction that unblocks rewriting DESIGN.md. **None is
   blocked on code.**
2. **The two Linux CI failures (§4), BEFORE a PR is opened** — they are
   assertions about one ffmpeg/ffprobe build's wording, not product defects,
   and they will be the first thing anybody sees on the PR.
3. **The rest of the review**, which is local only: what the fix order did not
   cover is still open, and **one of it arms on the next `config/models.json`
   edit**. Read the review's §3 before that edit, not after.
4. **The Supabase plan**, then code — the spec exists, 11 questions are Paul's
   (item 8).

**What is left is Paul's, and only Paul's — items 1-3 in START HERE above.**
Record fal's actual cost for the 720p run (item 1's remaining number), send
the blind check (item 2), and settle the UI direction so DESIGN.md can be
rewritten (item 3). None of it is blocked on code.

**The Stripe checkout and webhook are BUILT — section 25.** `POST
/api/billing/checkout` creates a hosted Checkout Session and 303s to Stripe;
`POST /api/stripe/webhook` verifies an HMAC over the raw body and is the only
thing in this application that grants credits. 59 tests, no npm dependency, no
card field anywhere.

**What is left is not code. It is a Stripe Price, and a Price is immutable**, so
§7 of `docs/superpowers/specs/2026-08-24-credit-packs-pricing-design.md` gates
creating one on three things and two of them are Paul's (items 1 and 2 below).
`config/credits.json` carries `stripePriceId: null`; the button renders disabled
and the route answers 503 until it is filled in. **Nothing can be bought today
and that is the designed state, not a gap.**

**PAUL'S, and nobody else can do them:**

1. ~~**METER THE PARKED 720p JOB.**~~ **DONE 2026-08-25 — section 26. THE TIER
   IS REAL.** 960x720 ordered came back **1112x834**, which is 2.20x the pixels
   of the 752x560 both 480p jobs returned. They are not the same product and
   they can be priced separately and honestly. **What is still owed is one
   number:** read fal's usage page for what that run actually cost and record it
   — `npm run ledger -- record 20260824-225641-f34b4f --actual=<usd>`. The
   formula predicts **$4.5646**; confirming it at a second tier is what makes
   the whole price list measured rather than half-measured.
2. **THE BLIND CHECK, still not done.** The packet is built and unsent at
   `out/blind-check/` — five images in `send/`, plus `BRIEF.md` with the exact
   wording, the protocol and the decode key. Two people, separate chats,
   "Who is this?" and nothing else. **Not the friend he primed.** Claude will
   not send these: it is a deception of third parties about Paul's own face.
3. **THE UI IS GOING TO CHANGE AND DESIGN.md DOES NOT KNOW YET.** Paul said on
   2026-08-24 that he **does not want it dark** — he wants something engaging.
   That supersedes the STRUCK world (ink-blue ground, cathode orange, gauze)
   which was chosen the same day and which every converted page now implements.
   **DESIGN.md gets rewritten FIRST and the pages follow**; do not let pages
   drift light one at a time. What "engaging" means is still Paul's to say.
4. **Seedance 2.5 exists and is DELIBERATELY NOT PURSUED.** Paul is building a
   skill for it and will bring it himself. Do not wire it, do not price it, do
   not raise it.

**CLAUDE'S, ready to go:**

5. ~~**Build the checkout redirect and the webhook.**~~ **DONE 2026-08-25,
   section 25.** What is left of it is Paul's: create the Price in Stripe once
   the gates are clear, paste the id into `config/credits.json`, and put
   `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env` (see
   `.env.example`). **Verify with `stripe listen` before anything is live** —
   the Stripe CLI is already on this machine and delivers genuinely-signed
   events to localhost, so the whole path can be proven with no public url.
6. ~~**The estimator cannot tell 480p from 720p.**~~ **DONE 2026-08-25 —
   section 26.** `--dry-run` now quotes **$2.0727 at 480p and $4.5646 at 720p**,
   both the measured invoice to four decimals. It was TWO defects, not one: the
   pricing table had no raster dimension, and `render.mjs` never handed the
   `--resolution` flag to `dryRun()` at all. **§7's second gate is closed.**
7. **The pricing page**: the "YOUR PLAN" pill is a bordered box (a third border
   in a world that permits two), and the three plans do not use the
   struck/ghost grammar at all. Section 23. **Possibly moot** if the UI world
   changes — check item 3 first.
8. ~~**The Supabase spec**, then a plan, then code.~~ **THE SPEC EXISTS AS OF
   2026-08-25** — three documents, written after Paul settled four decisions:
   full migration (accounts, credits AND sessions), Google + email/password
   first, and the shape where **Supabase proves identity but THIS SERVER MINTS
   ITS OWN SESSION**, because a JWT cannot be revoked and this service holds
   their face. `docs/superpowers/specs/2026-08-25-supabase-identity-money-design.md`
   plus its schema and test-runtime companions. **11 open questions are Paul's
   to close, and no plan and no code exist yet.** INSTAGRAM LOGIN IS IMPOSSIBLE
   — not a Supabase provider, and Meta forbids using its Instagram APIs to
   authenticate app users; Facebook is deferred behind App Review and Business
   Verification. **NOTE: a credit PACK does not need any of it** — revenue is
   not blocked behind that migration.
9. ~~**THE FREE TAPE IS STILL THE OLD ONE**~~ **BUILT 2026-08-25.** The
   GLOBAL CEILING §3 calls "the single most important line in this section"
   now exists: `freeTape.globalCeiling` in `config/credits.json`, **default
   100**, a lifetime count across every account ever, enforced inside a global
   file lock in `createAccount`, with `0` supported as a kill switch and an
   8-thread barrier test. Reaching it does NOT fail signup — the account opens
   at zero with an auditable withheld row, because a visible balance the button
   then refuses is what forced free off 16 credits in the first place. The
   free plan is once-ever now, not per period. **THE SIGNUP GRANT IS 21, NOT
   42** — §3's own number, Paul's call the same evening — so the exposure is
   $2.07 a signup and about $207 against the ceiling. **The grant and the
   ceiling do not move together; editing one silently re-prices the other.**
   What the ceiling does NOT bound is availability — see F21.

### THE SECURITY REVIEW'S FIX ORDER IS WORKED — section 28 for what shipped

**`docs/security-review-2026-08-25.md`, on this machine only.** A second review,
three independent auditors, every HIGH re-verified by hand. **IT IS GITIGNORED
AND MUST STAY THAT WAY** -- this repo is PUBLIC and an accurate list of a live
system's open weaknesses is an attack roadmap. That is `.gitignore:16` and its
reasoning is right. **Do not summarise its findings here, in a commit message,
or in a PR description.** Read the file.

**What is safe to say in public, because it is all good news:** `.env` has never
been committed, no secret reaches a log, a manifest, a page or disk, there are
still zero npm dependencies, no cross-tenant path to another user's face exists,
no XSS was found, and four webhook forgeries were all refused.

**All seven items of the review's own fix order were closed 2026-08-25/26** --
the CRITICAL first, then every HIGH, the two customers'-money defects, and the
deployment headers -- each as its own commit with the failing test written
first. Section 28 records what each commit DOES; the review records what each
closed. **What is still open lives only in the review**: a handful of MEDIUMs
and LOWs outside the fix order, including one that **still arms on the next
edit to `config/models.json`** -- whoever fills in the still model reads the
review's section 3 FIRST, same rule as before.

### Two cheap wins nobody has taken

- **A fluorescent buzz and a kitchen clock tick.** The ambience layer makes
  noise only; both want a TONE. The capstan already proves tones work. Section 20.
- **The camera zooming is still a negative.** A punch-in zoom is the most
  characteristic home-recording move there is. Left alone so the vlog run
  measured one change. Section 19.

### Things that will bite you

- **THE PASSWORD FUNCTIONS ARE ASYNC NOW** (2026-08-26). `hashPassword`,
  `verifyPassword`, `authenticate` and `createAccount` all return Promises. A
  forgotten `await` does not throw — it yields a truthy Promise where a boolean
  was expected, which reads as **"every password is correct"**, or an Account
  with no fields. Grep those four names before trusting a call site. §28.
- **A test that posts `/login` or `/signup` must fetch the form FIRST.** Both
  routes need the anti-forgery pair — the `timestamp_csrf` cookie off the GET
  plus the hidden field out of the HTML — or they answer 403 and set no
  session. Every web test file has a `csrfPair`/`signIn` helper; copy it rather
  than posting bare. §28.
- **A third inline `<script>` will not run.** `script-src` names the two
  shipped scripts by hash and nothing else. New scripts go in `views.mjs`
  beside `INLINE_SCRIPT_HASHES` or they are dead in the browser. §28.
- **A test-mode Stripe event grants nothing**, deliberately, so the §27 replay
  demo no longer moves credits. Not a regression.
- **Read the prompt before blaming the model.** Twice the model was doing
  exactly what it was told: `Nothing dramatic happens` produced a tape with
  nothing happening, and `deep focus ... all the way to the shed` produced the
  edge-to-edge sharpness that reads as AI.
- **Backticks in a comment inside a template literal** break `static.mjs` and
  `views.mjs`. **The most repeated mistake in this codebase — it happened again
  on 2026-08-24.** `node --check` after every edit to those files.
- **A fixed shape that projects fields will drop yours.** `entriesOf` in
  `credits.mjs` returns a literal object, so a field written to disk and not
  named there reads back `undefined` forever. Cost an hour today. Section 5.
- **`job-model` and `queue-race` fail under full parallel load on Windows** and
  pass in isolation. Section 12, not a regression. Re-run the file alone.
- **CLAUDE CANNOT RUN PAID COMMANDS.** Paste them and paste the output back.
- **Every price in this repo was a guess until 2026-08-24, and three still are.**
  `image-to-video` has never been called; 720p has never been run.

```bash
npm run web                              # terminal 1
npm run worker -- --provider=fixture     # terminal 2
# sign in as dev@example.com / timestamp-dev-password
```
`paul@example.com` cannot be signed into — scrypt hash, no reset endpoint.

**The repo is PUBLIC: https://github.com/PaulStanley0211/timestamp**
`out/`, `.env` and `assets/test-photos/` are gitignored. Both security-review
docs stay gitignored on purpose — section 2.

---

### 1. WHERE THE THREE BLOCKERS ACTUALLY STAND (two are CLEARED)

1. ~~**`FAL_KEY` in `.env`**~~ **DONE 2026-08-23.** Paul pasted it himself.
   Verified: correct `uuid:hex32` shape, no quotes, no stray whitespace, LF
   endings; **invisible to `npm test`** (bare `node --test`, checked); **never
   staged or committed** (`git log --all -- .env` is empty).
   **`npm run doctor` DOES NOT LOAD `.env`** - the script has no
   `--env-file-if-exists`, unlike `render` and `worker`, so it prints "not set"
   even when the key is right. **The earlier claim in this file that doctor
   confirms the key was WRONG.** Use:
   `node --env-file-if-exists=.env scripts/preflight/doctor.mjs` -> prints
   `present`, never the key. A one-word fix to `package.json` was offered and
   Paul has not answered; do not apply it unasked.
2. ~~**A photo at `assets/test-photos/face.jpg`**~~ **DONE 2026-08-23.** Paul's
   own phone selfie, 3712x1712 with EXIF orientation 8. Verified through the
   REAL intake path: autorotates to 1712x3712, `stripped: true`, and a raw byte
   grep confirms the stored copy carries **zero** Exif/GPS/XMP where the source
   had all three. That is the first time the privacy claim was tested against a
   file that actually had coordinates in it.
3. **The still model is STILL unchosen, and now there is EVIDENCE.** See
   section 8 - `fal-ai/uso` was run for real and FAILED on identity. Two
   candidates remain untested. This is the only blocker left and it is the one
   that decides whether this is a product.

**Phase 0 is part-run.** One still, one model. The blind check has not happened
and does not need two people in a room: **Paul lives alone, and the check is a
text message** - send the generated image to two people who know his face with
the words "Who is this?" and NOTHING else. He primed a friend on the real photo
by saying "it is not AI generated"; **that must not happen on the real check**,
and ideally a different person is used, because that one is now primed.

### 2. DECISIONS TAKEN 2026-08-21/22 - do not re-litigate

- **Retention is 7 days for the photo, 30 for the finished video** - exactly what
  the consent text already promised. Implemented; see section 3.
- **THE ANSWER IS SUPABASE, AND THE REASON IS GOOGLE SIGN-IN.** Paul first chose
  a single VPS with `node:sqlite`, then switched. Asked to justify it, he gave
  the deciding fact: **he wants "sign in with Google" the way other apps have it,
  plus password login, plus password reset.** That is three identity features,
  not a database preference.

  **DO NOT RE-OPEN THIS AS A DATABASE QUESTION.** It was already argued the other
  way and lost on identity, not on data. SQLite was the better *database* answer
  -- smaller change, keeps 45 tested auth tests and the isolation proof, and
  `ledger_once` fixes the lock-file ledger completely. What it cannot do is rent
  identity. Hand-building Google OAuth means the redirect round-trip, a `state`
  parameter against CSRF, verifying Google's ID token against cached JWKS
  (`iss`/`aud`/`exp`/`nonce`), and an account-linking decision where getting it
  wrong is account takeover -- and it still would not provide password reset.

  **Costs accepted deliberately:** 45 tests and the tenant-isolation proof get
  deleted and rewritten against RLS. **Deployment moves earlier**, because Google
  OAuth needs registered redirect URLs, so a real domain and TLS -- the sign-in
  flow cannot be fully tested on localhost. Current position:
  - **Supabase Auth REPLACES login entirely** - `accounts.mjs` and `session.mjs`
    get deleted, users live in `auth.users`, sessions become JWTs, isolation
    becomes RLS. **This costs 45 tests and rewrites the tenant-isolation proof.**
  - **PostgREST over `fetch` + Postgres functions**, NOT `@supabase/supabase-js`.
    This is what keeps **zero npm dependencies** alive. Atomicity comes from SQL
    functions (`debit_credits(...)` as one RPC is atomic by definition).
  - **The service-role key bypasses RLS.** If the Node server holds it and uses
    it for everything, RLS is decorative and isolation is back in app code. For
    RLS to be load-bearing the server must forward the USER's JWT on user-scoped
    reads and reserve service-role for the Stripe webhook, which acts with no
    user present.
- **Stripe: subscriptions on the existing plans**, credits granted only on
  `invoice.paid`, **unused credits expire each period as an explicit negative
  ledger row**. Checkout is hosted, so "card details never touch this codebase"
  stays literally true.
- **The security review and its brief are gitignored** (`docs/security-review-*.md`).
  This repo is public and an accurate list of open weaknesses is a roadmap. Both
  files are on Paul's disk. `docs/security-review-brief.md` was already committed
  in `9bc24ea`, so that commit was amended to drop it. **The vuln list was also
  redacted out of this file** - do not copy it back in.

### 3. WHAT SHIPPED THIS SESSION

**F1/F2 retention - the promise the consent text makes is now performed.**
`scripts/render/purge.mjs` (`planPurge` / `executePurge`, **`dryRun: true` by
default**, plus `purgeJobMedia` and the canonical `sweepRetention`),
`purge-cli.mjs` so `npm run purge` runs and refuses to delete without `--apply`,
a worker sweep at startup and hourly, and `DELETE /api/jobs/:id` now removing the
video, stills, contact sheet, segments, source and poster rather than `input/`
alone. The `202` path is honoured - the worker purges at the cancel sentinel.

**Three rulings from that work worth not rediscovering:**
- **Age is measured from `createdAt`, never `updatedAt`.** `updatedAt` is
  restamped by every `saveJob`, so a retried job would defer its own deletion
  forever.
- **A live lease beats age.** A long-pending job claimed for the *first* time
  today was having its directory deleted out from under its own render.
  Deferred, not spared.
- **Everything that deletes reports what it could not delete.** The first version
  swallowed a refused unlink with `catch { continue }` - an `EBUSY` while
  `getVideo` streams the same file - and answered a flat 200. **That was F2
  recurring inside the fix for F2**, found by a code review, proved with an
  injected `fs` before being fixed.

**CI exists - `.github/workflows/test.yml` and `guards.yml`.** 991 tests on
ubuntu + windows, node 22 + 24. `guards.yml` enforces decisions that are
invisible when they break: the test script must stay a bare `node --test`,
`fal.mjs` must keep having no default `fetchImpl`, no security review may be
tracked, no `.env` or `out/`, and the consent text must still quote the retention
config.

### 4. CI IS RED ON LINUX - two known, pre-existing, NOT product defects

**Windows 991/991 green. Linux 989/991.** The matrix paid for itself on its first
run by catching a Windows-only assumption in the purge CLI tests (a `file:` URL
pathname with its leading slash stripped - valid on Windows, *relative* on
Linux). Fixed in `d15f71c`.

| Test | What is actually wrong |
|---|---|
| `the fixture really does carry EXIF and GPS...` | Asserts `meta.sideData.includes('EXIF metadata')` - a claim about how one **ffprobe build names side_data**, not about the file. **The real strip test passes on Linux, byte-grep and all**, so EXIF stripping genuinely works. Fix: assert the bytes, or accept either spelling. |
| `a broken filtergraph fails loudly...` | Asserts ffmpeg's error *wording*, which differs between the gyan.dev Windows build and Debian's. Fix: assert the failure and that stderr is non-empty, not the text. |

**Plus two pre-existing FLAKY tests** (different problem - these fire only when
`node --test` runs files in parallel and several ffmpegs compete):

| Test | Rate across 8 full runs |
|---|---|
| `[fal] a 720p request downloads a 960x720 clip...` (`empty_download`) | ~3 in 8 |
| `a concurrent reader never sees a truncated or invalid manifest` | ~2 in 8 |

Passing 3/3 in isolation is not evidence they are fine. They need the
publish-your-progress fix, **not a widened timeout** - a test whose timing margin
is narrower than machine variance tests the machine.

**Four sources of red is how a build gets ignored - fixing these is worth doing
early.** They were
deliberately NOT papered over with retries or `continue-on-error`.

### 5. SPECS WRITTEN - one needs rewriting before any code

`docs/superpowers/specs/`:
- **`2026-08-21-sqlite-identity-money-design.md` - SUPERSEDED.** Kept because
  most of its reasoning survives Postgres: the repository-seam approach and its
  **191-test acceptance gate** (counted, not estimated), `ledger_once` as a
  partial unique index, balance derived by `SUM(delta)` and never stored, expiry
  as an explicit negative row, the never-delete-anything migration with a
  per-account parity check, and jobs/queue staying on files.
- **`2026-08-21-stripe-subscriptions-design.md` - SUPERSEDED 2026-08-24** by
  `2026-08-24-credit-packs-pricing-design.md`. Most of it survives and must be
  read before any Stripe code: two guards against double payout, the raw-body
  signature trap (`server.mjs` already parses bodies - a reserialise breaks
  every signature), replay window vs idempotency as separate concerns. What is
  superseded is the OBJECT BEING SOLD.
- **`2026-08-24-credit-packs-pricing-design.md` - current, approved, not
  started.** **$10 for 40 credits, ONE-OFF, one Price.** A credit is $0.10 of
  provider COST, so a 480p tape is **21 CR and not 16** -- the old number was
  set by feel against a cost 27% too low. Credits sell at **$0.25**, which is
  60% gross and is chosen to absorb the FREE RETRIES that direct mode made
  inevitable. **A pack ships on the existing file ledger and does NOT need
  Supabase.** One free tape ever, not monthly, with a global ceiling.
  ~~**AND THE PRECONDITION NOBODY WOULD GUESS: `grantCredits` has no
  idempotency key**~~ **CLOSED 2026-08-24.** Grants take a `ref`, deduped inside
  the existing per-account lock, returning `{granted, credits, ref}` so a
  webhook can tell a payment from a redelivery. **Two traps:** `entriesOf`
  projects a fixed shape and silently dropped the `ref` on read, which is
  idempotent in memory and not idempotent across a reload; and a sequential
  test is not enough, because Stripe retries overlap -- there is an 8-thread
  barrier test.
- **NOT WRITTEN: the Supabase design.** Sub-project 1 needs a fresh spec for
  "Supabase Auth replaces login + PostgREST over fetch". That is the next
  writing task, and **no code should be written before it exists.**

**Still needs Paul before Stripe Prices are created:** `annualUSD: 100` is
flagged in `config/credits.json` as *"ten months for twelve - an interpretation
of Paul's words, NEEDS PAUL"*. **A Stripe Price amount is immutable once
created**, so changing it later means a new Price and migrating subscribers.

### 6. THE UI REDESIGN - DONE, committed to a branch (6a-6c)

Paul installed a third-party skill pack at `~/.claude/skills/` (user-level, NOT
in this repo): `ui-ux-pro-max`, `ui-styling`, `design-system`, `brand`, `design`,
`slides`, `banner-design`. Reviewed before installing - MIT, no injection
patterns, no hidden network calls. **`design` collides in name with a built-in
skill.** **`ui-styling` is Tailwind + shadcn and is incompatible with this
project's zero-dependency, zero-JavaScript rules - do not follow it here.**

**The first `--design-system` query MISROUTED** and was correctly rejected rather
than applied: it returned an ops-telemetry landing pattern, indigo-on-near-white
(this product is Kodak yellow `#FFB700` on `#0B0A09`), Google Fonts over CDN
(the CSP has no external sources and VT323 is bundled for determinism), and a
GSAP snippet (there is no JavaScript). **The skill's own contract says to verify
fit and retry once with a narrower query.**

### 6a. THE REDESIGN IS DONE - 2026-08-22, commit ca2b912, 991/989/0

**The retry happened, and `--design-system` was NOT re-run** - the contract's
narrower path was taken instead, two explicit `--domain ux` queries. Both came
back mostly generic web guidance. **Three results were genuinely applicable and
all three are used**: heading hierarchy, line length 65-75ch, heading line
balance. Everything else in the redesign is reasoning from this repo's own
existing decisions, and it is labelled that way rather than dressed up as a
database match. **Do not re-run `--design-system` on this product hoping for a
better roll** - it has now misrouted once and been declined once on contract.

**The diagnosis was one defect readable two ways.** The page had **no `<h1>` at
all**: it opened on a paragraph and then four sibling `<h2>`s of equal size, so
a screen reader met four headings with nothing above them and an eye met four
boxes with nothing above them. The landing page had already solved exactly this
("one thing is the subject"); the signed-in page never got the same treatment.

**What shipped, in `views.mjs` and `static.mjs`:**
- **A real `<h1>`.** The copy is NOT new - it is the existing lede split at the
  full stop that was already in it. Do not "improve" it into new marketing.
- **A weight arc replacing one `.panel` rule**: `--anchor` (step 01, the photo),
  `--choice` (steps 02/03, borderless and lightest), `--commit` (step 04, firm
  again because that is where credits are spent), `--archive` (full width,
  outside the form). A panel's treatment now states its job.
- **Two columns above 62rem**, `#tape` as a grid: a 320px sticky anchor column
  and a 640px flow column - **measured, exactly 1:2**, where all five panels
  used to be one 44rem width. Sticky is the argument, not a flourish: the
  photograph is the identity anchor for every choice made to the right of it.
- **The step number is now a 44px VT323 numeral** in the header gutter, at
  `accent-deep`, replacing an 11px eyebrow that was the smallest type on the
  page while being the only thing distinguishing one panel from the next.
- **Prose capped at 56-62ch** and headings given a bounded measure.

**Zero JavaScript was added and zero npm dependencies.** But note, because a
stale claim is worse than none: **this page is NOT zero-JavaScript and was not
before.** There is an existing inline `<script>` doing two progressive-
enhancement jobs (chosen filename, clearing the reason under an enabled button).
It was not touched.

**UPDATED 2026-08-26 — the CSP no longer says `'unsafe-inline'` at all.** That
keyword named no scripts and therefore admitted every one of them, including
anything an injection might write. `script-src` now names this product's two
inline scripts BY HASH. **Both live as constants in `views.mjs` beside
`INLINE_SCRIPT_HASHES`** — edit one and its hash follows automatically; add a
third `<script>` anywhere else and the browser refuses to run it, with a test
that hashes what pages actually ship failing first so the refusal is loud
rather than a silently dead feature. See §28.

**Measured, not asserted:** at `scrollY 1200` the anchor's top edge sits at 20px
(its `1.25rem` offset); the 44px numeral contrasts **4.96:1** against its panel,
clearing the 3:1 large-text bar and the 4.5:1 body bar; at 390px wide
`scrollWidth == clientWidth` with the anchor computed back to `static`.

**ONE TEST WAS CHANGED AND THAT IS WORTH SAYING OUT LOUD.**
`test/web-api.test.js` asserted the literal substring `STEP 01`. The steps are
still numbered and still in order, but the word and the number are now separate
elements, so the substring is gone. The assertion was rewritten to check what
the test is *named* for - numbered, in order - via the `.stepno-n` elements. It
compares against `['01','02','03']`, so **it cannot pass vacuously** if the
numbering disappears entirely.

**Two traps this work re-confirmed the hard way, both already in this file:**
backticks inside a comment inside a template literal broke `static.mjs` parsing
(use plain quotes - it cost a restart), and a `&&` chain that short-circuited on
a failed `node --check` left the OLD server holding port 3300 and serving stale
CSS, which is the "editing CSS and expecting to see it" trap wearing a
different hat. **Kill by PID and verify the port is free before restarting.**

**Dead CSS caught in review:** a `.panel--choice:first-of-type` rule never
matched anything, because the first `section` of its type inside the form is the
ANCHOR, not a choice - and had it matched it would have broken the very
alignment it was written to create. Removed, with the reason left in place.

### 6b. THE CONSENT CHECKBOX WAS 16x16 AND IS NOW 24x24

Found by reading the skill's `references/quick-reference.md` §1, which the first
pass had skipped. **WCAG 2.2 AA (SC 2.5.8, target size minimum) asks 24x24 CSS
px**, and `.check input` was `1rem` - the smallest hit area in the product, on
the control that gates **both signing up and spending credits**, and the only
element on the page failing an AA criterion. Now `1.5rem`, with `margin-top`
dropped from `0.35rem` to `0` because that margin was compensating for a box 8px
shorter; measured, the box centre now sits **2px** from the first consent line's
centre. **One rule fixes both gates** - `views.mjs` and `views-auth.mjs` share
`.check`.

**The page now has ZERO SC 2.5.8 failures, verified rather than assumed.** Six
targets are still under 24px and all six pass legitimately: two `.linky` labels
are inline in a sentence (the criterion's inline exemption), and the rest clear
the **spacing exception** - nearest centre-to-centre distance measured at
**63px** against the 24px the criterion requires. Do not "fix" those six.

**Also verified, because the redesign introduced a sticky element:**
`focus-not-obscured` (SC 2.4.11 AA) - sticky UI must not hide the keyboard-
focused control. **0 violations across 12 focusables.** The anchor is its own
grid track, so it cannot overlap the flow column; that is geometry, not luck,
but it had been assumed rather than measured until now.

### 6c. THE LAYOUT, RE-DERIVED FROM THE SKILL ALONE - and what that proved

Paul asked for the layout to be designed using **only** `ui-ux-pro-max`. Doing
that properly meant stopping guessing at queries and reading the dataset.

**THE MISROUTE IS THE DATASET, NOT THE QUERY. `--design-system` was re-run with
a completely different query ("consumer creative video tool") and returned the
IDENTICAL wrong answer as last session:** Real-Time / Operations Landing pattern,
indigo `#6366F1`, Inter / Playfair Display, Google Fonts CDN. **Two unrelated
queries, one output. Stop re-rolling it.**

**The root cause, found by enumerating the data rather than guessing:**
- `data/landing.csv` - **34 patterns, every one a marketing LANDING page**
  (Hero + Features + CTA, Pricing Page, Waitlist, Bento Grid...). There is **no
  application-screen pattern in the file at all.** The signed-in page is a
  multi-step creation form behind a login, so the nearest match is always wrong.
- `data/app-interface.csv` - **32 rows, every one `iOS/Android/React Native`**,
  and it has no layout category. Its own header says it is not for web.

**So the skill has no layout PATTERN for this page and cannot have one.** That
is structural, not a bad search. What it does have is `ux-guidelines.csv`:
**9 Layout rules + 8 Responsive rules**, stack-agnostic and genuinely applicable.
The layout was audited against all 17. **Three real divergences, all fixed:**

| Rule | Was | Now |
|---|---|---|
| **Breakpoint Testing** ("test at 320 375 414 768 1024 1440") | broke at `62rem`/992px - on no device list and no scale | **`64rem` = exactly 1024** |
| **Viewport Units** ("use dvh, not 100vh") | `body { min-height: 100vh }` | **`100dvh`** (pre-existing bug) |
| **Container Width** ("65-75ch for text") | lede at `62ch`, just under the band | **`66ch`** |

**Verified at all six of the rule's own widths** - 320 / 375 / 414 / 768 / 1024 /
1440: **no horizontal overflow at any**, single column below the break, two
columns at and above. The 1:2 column ratio is exact at 1440 and **1:1.94 at
1024**, where the wrap is viewport-constrained rather than at its 62rem max.

**Two rules deliberately NOT actioned, both needing Paul:**
- **Readable Font Size** wants **16px minimum body on mobile; this app is 15px.**
  Real (it is also what triggers iOS input auto-zoom), but changing it reflows
  every page in the product. **Typography, not layout - not done unasked.**
- **Z-Index Management** wants a defined scale (10/20/30/50); the repo uses
  `-2/-1/1/9`. Those four values are load-bearing for the background layer, the
  scrim and the grain plate. **Rewriting them to satisfy a style rule risks the
  full-bleed background for no user-visible gain.** Left alone on purpose.

**A ruling about this repo's own trap, now confirmed twice in one session:**
backticks inside a CSS comment inside `BASE_CSS` break parsing. It is already in
the Common Mistakes list and it still caught two edits. **Run `node --check
scripts/web/static.mjs` after every edit to that file** - and never chain it as
`node --check X && kill-the-server`, because a failed check short-circuits the
kill and leaves the OLD server serving stale CSS, which then looks like the edit
did nothing.

### 7. NEXT, in the order it is worth doing

1. **Finish the bake-off.** Two commands, ~10 cents, section 8a. This is the only
   question that decides whether the product exists.
2. ~~**The UI redesign**~~ **DONE 2026-08-22, committed to a branch - section 6a.**
3. ~~**The eight place photographs**~~ **DONE 2026-08-23 - section 10.**
4. ~~**Commit and push.**~~ **PUSHED 2026-08-26.** The licence question that was
   holding it was answered on 2026-08-24 (section 10). `origin/main` is still
   `b6f64a3` and nothing is merged; **opening a PR remains Paul's call.**
5. **The Supabase spec**, then a plan, then code. Not before.
6. **The four sources of CI red** (section 4).
7. **Three aspect ratios** - `docs/aspect-ratios-plan.md`. **Paul restated this
   on 2026-08-23 as a USER-FACING CHOICE**, see section 9.
8. **The rest of the security report** - local file only.

### 8. THE PAID PATH RAN, 2026-08-23 - four bugs and one real result

**Nothing had ever called fal. The first attempt found a bug in about a minute,
and each fix uncovered the next.** All four are recorded because every one would
have cost the next person the same hour.

**BUG 1 - the transport was NEVER injected in production.** `requireFetchImpl`
gives a paid provider **no default** for `fetchImpl` (money guard 1 of 4), so a
test that forgets it gets a TypeError instead of a bill. That guard worked
perfectly. What nothing did was inject a transport **on the real path** - so
`--provider=fal` could not reach the network AT ALL and died at step 5 of 11 with
the money guard's own TypeError, which reads exactly like a test bug.
Fixed by `paidTransport(provider)` in `render.mjs`, injecting
`globalThis.fetch.bind(globalThis)` **only when `provider.paid`**. All four
guards survive: fal.mjs still has no default, `npm test` never runs `main()`, the
bare `node --test` still keeps FAL_KEY out of the process.
~~**THE WORKER HAS THE SAME HOLE AND IT IS NOT FIXED**~~ **FIXED 2026-08-24,
and the shape of the fix is the lesson.** `worker.mjs` always accepted
`providerCtx`; `worker-cli.mjs` passed none, so the web app's renderer could not
spend either. It stayed broken for a day **because the fix lived inside the file
that no longer had the bug** - a private function in `render.mjs`. It is now
`scripts/providers/transport.mjs`, imported by both commands that can spend, and
`worker-cli.mjs` takes it through the SAME lazy import as `createProvider` so
this file's own rule about not loading a provider to test `renderEvent` still
holds. All four money guards are untouched: fal.mjs still has no default,
`npm test` still never runs either `main()`, the bare `node --test` still keeps
FAL_KEY out of the process, and `guards.yml` still greps fal.mjs.

**A UNIT TEST OF `paidTransport` WOULD NOT HAVE CAUGHT THIS AND DID NOT NEED TO.**
The bug was a missing wire, so `provider-contract.test.js` now reads both CLIs'
source and fails if any `providerCtx:` call site is handed anything other than
`paidTransport(provider)` - including one nobody has written yet. Verified by
deleting the line and watching it go red, then putting it back.

**THE BROWSER STILL CANNOT FINISH A PAID RENDER, and the reason is now a
decision rather than a defect.** `npm run worker -- --provider=fal` loads `.env`
and reaches the network, but a web job takes the fal STILL default, which is
`fal/UNVERIFIED-identity-still` and refuses at compose exactly as designed. The
web form sets no `direct` and carries no model override, so it cannot take the
direct path either. **Those are section 9's questions, not this one's.**

**BUG 2 - the model is resolved in TWO places.** Threading `--still-model` into
the pipeline made compose use the right model while step 5 still used the
default, because `fal.mjs` has its own `resolveModel` reading `opts.stillModel`
from **provider construction**. The failure moved from step 4 to step 5 and
looked identical. Both are now fed:
`createProvider(id, { cfg, stillModel, allowUnverifiedModel })`.

**BUG 3 - the reference field name is NOT the same on every candidate.**
`falStillBody` sent `image_urls`, the fal image-edit convention. `fal-ai/uso`
answered **HTTP 422, loc body/input_image_urls, "Field required"**. Recorded per
model as `stillParams.references` in `config/models.json` rather than renamed
globally - **seedream and nano-banana-pro have not been called and their field
name is still unknown.** Expect another 422 from each; that is data, not a
setback, and a 422 is not billed.

**BUG 4 - and this one would have hit EVERY REAL USER.** fal refused the
reference with `image_too_large`: **max 2048x2048**. The photo was 1712x3712, and
every phone shoots 3000-4000px on the long edge. Fixed at intake:
`LIMITS.maxReferenceEdge = 2048` with an ffmpeg `scale` that fits inside the box
and **never upscales**. Measured on the real file: **1712x3712 to 944x2048,
6.4MB to 341KB**. The size matters as much as the refusal - references travel as
base64, which inflates by a third, so the request went from ~8.5MB to under a
megabyte on **every** call. Written as a FILTER, not computed in Node, because
iw/ih inside the graph are post-autorotation and the file's own comment forbids
reimplementing the orientation table.

**THE RESULT: `fal-ai/uso` FAILED, and Paul confirmed it unprompted.**
Job `20260823-190639-21c4cd`, one still, ~$0.05.

- **Scene adherence EXCELLENT** - hedge, folding table, patterned cloth, four
  white chairs, watering can, coiled hose, bicycle on the fence, raking light,
  exactly one person. **That validates `composeStillPrompt` and the expand
  stage**, not the model.
- **Identity FAILED.** The beard and the tight curls - the subject's two most
  distinctive features - were BOTH dropped, skin tone lighter, face shape wrong.
  Paul's own words: "it doesn't give any kind of face resemblance".
- **Raster FAILED separately.** Ordered 640x480 with `aspect_ratio: '4:3'` sent;
  got **640x512, which is 5:4**. A 5:4 still pillarboxed into a 4:3 tape is a
  visible mistake, so this disqualifies the candidate at this raster **even if
  identity had held**.
- This is the candidate whose **advertised purpose** is identity preservation,
  which makes the result more informative, not less.

### 8a. THE BAKE-OFF SEAM, and why it is two flags

`--still-model=<id>` names a model; `--allow-unverified-model` is a SEPARATE
opt-in that lowers the verified gate. Two, not one, so an unverified endpoint can
never be reached by a caller who only meant to pick a model. **Both defaults are
the refusal that existed before.** The alternative was editing
`config/models.json` to claim `verified: true` - and in this repo that word means
somebody opened the schema page. Faking it to run an experiment would poison the
one signal that stops blind spending.

The two remaining commands, unchanged from the one that worked:

```
node --env-file-if-exists=.env scripts/render/render.mjs --photo=assets/test-photos/face.jpg --place=schrebergarten-august --outfit=trainingsjacke --consent --provider=fal --still-model=fal-ai/bytedance/seedream/v4.5/edit --allow-unverified-model --stills=1 --stop-after=select
node --env-file-if-exists=.env scripts/render/render.mjs --photo=assets/test-photos/face.jpg --place=schrebergarten-august --outfit=trainingsjacke --consent --provider=fal --still-model=fal-ai/nano-banana-pro/edit --allow-unverified-model --stills=1 --stop-after=select
```

**CLAUDE CANNOT RUN THESE.** The auto-mode classifier blocks commands that spend
money - it let exactly one through and refused every attempt after. **Do not try
to work around it.** Ask Paul to paste them and paste the output back; Claude can
then read `out/jobs/` and the manifests directly.

**Do not run five stills on any model before all three have been tried once.**

`config/pricing.json` now carries all three candidates. Only seedream has any
published figure (~$0.04/edit, **a marketing page, never invoiced**); the other
two are labelled as placeholders with no vendor quote read. **Every `_comment` in
that file must contain the literal word ESTIMATE** - `provider-contract.test.js`
enforces it, and it caught these three entries on the first try.

### 9. PAUL'S PRODUCT DIRECTION, restated 2026-08-23 - THE STILL IS INTERNAL

Paul described the flow he wants, and it is not what the app does today:

> **upload a photo, choose an outfit, choose a location (a scrollable list of
> defaults OR describe your own), choose the frame (4:3 / 9:16 / 16:9), get the
> tape.**

**No still picker. Four choices, then a video.** His words: *"I don't understand
why are you generating the pictures"* - the still is plumbing and the user should
never meet it.

**THE STILL CANNOT BE DELETED, ONLY HIDDEN.** Seedance 2.0 is image-to-video: it
animates a starting frame and cannot take "a face plus the word garden". What is
a genuine choice is whether the user ever sees it.

**What to change once identity is solved, and NOT before:** the app page's
*"How many looks to choose from - 1/3/5"* control (`stillCount`) comes out,
stills is forced to 1, and select auto-continues.

**The cost of hiding it, stated once so the decision is informed:** a bad
likeness currently costs **$0.05** and the user sees it before paying. Hidden,
the same failure ships a finished tape at **$1.51** (480p) or **$4.54** (720p),
and that customer wants a refund. **This is not an argument against Paul's design
- simplicity IS the product and he has been consistent about that from the start.
It is the reason the likeness must be reliable BEFORE the gate is hidden.**
Order matters: solve identity, then hide everything.

If all three candidates fail there is a real alternative:
`bytedance/seedance-2.0/reference-to-video` (verified, **not wired in**) takes up
to 9 references and could take the face directly, deleting the still stage
outright. Its own entry warns **a yes is not automatically good news** - it also
deletes the cheap rejection gate.

### 10. THE EIGHT PLACE PHOTOGRAPHS - DONE 2026-08-23

`assets/places/` is **no longer empty** and the eight 404s are gone. Paul
generated all eight in **Higgsfield Soul Cinema** (his choice - tested, and free
to him); Claude wrote the prompts from each preset's own scene/light/eraProps
fields. Period-accurate, **no people**, and deliberately **no VHS/grain
/"nostalgic"** in the prompts - era comes from named props and the tape look is
ffmpeg's job.

**THE LICENCE QUESTION IS ANSWERED, 2026-08-24, and the old ruling was right
about a different thing.** Section 10 asked whether eight static assets, shipped
in a commercial product and committed to a public repo, are covered. Read on
Higgsfield's own pages -- the Terms of Use Agreement and the help-centre article
"Who Owns Your Higgsfield Generations", last updated 3 August 2026:

- Higgsfield **"does not claim ownership of any of your Inputs or Outputs"**
  and **"nor does it restrict your commercial use of Outputs"**.
- **"The Terms of Use do not tie commercial use rights to a specific plan"**,
  and there is **"no separate commercial license to purchase"**. That retires
  the "consumer creator subscription" half of the old ruling outright.
- **"You may transfer or sublicense your rights in Outputs to your clients or
  other third parties"**, and those rights **"survive cancellation of your
  subscription or deletion or termination of your Account"**.

**WHAT IS FORBIDDEN IS THE SERVICE, NOT THE OUTPUT**, and that is the line the
old ruling was reaching for without the words: you may not "license, resell,
rent, transfer, assign, reproduce, distribute, host, or otherwise commercially
exploit the Service", and you may not "act as a pass-through or service bureau".
**That is per-user generation to a description -- a customer types a place and
Higgsfield renders it -- and it stays forbidden.** It is why the provider is
fal.ai and that decision does not move. Eight photographs Paul generated once
and committed are Outputs, and Outputs are his.

**CHECKED IN THE CODE RATHER THAN ASSUMED: the shipped place photographs never
reach a model.** `assets/places/<id>.jpg` is served by `server.mjs` as the
placecard thumbnail and the background layer and nothing else; the `placePhoto`
that becomes @Image2 in a reference prompt is always the USER's upload
(`input/upload-place`). That matters because the terms also forbid using
outputs "to train, fine-tune, or improve any AI or machine-learning model" --
inference is not training, but the question does not even arise here.

**WHAT IS STILL PAUL'S CALL, and it is not a licence question.** A public repo
means anyone can take the eight files. That is a business decision about giving
away assets, not a permission problem. **And the ruling rests on a document
that changes** -- Higgsfield updated these terms recently -- so the sensible
hygiene is to keep a dated note of what they said when the decision was made,
which is what the quotes above are. **None of this is legal advice; it is what
the published terms say, read on 2026-08-24.**

**THE CARDS ARE NOW 16:9 AND THAT IS LOAD-BEARING.** One file is BOTH the
`.placecard` thumbnail AND the full-bleed `.bg--<id>` layer, both `cover`. The
card was 11x14rem - portrait - against 16:9 photographs, so it threw away about
**two thirds of the width**: measured, the Autobahn card lost its striped kiosk
entirely and kept an empty picnic table, and the balcony lost the washing line
that is the whole subject. Now `17rem x 9.5rem`, i.e. 272x152 against a 2048x1152
source - **a 0.6% crop instead of 65%**. **If these ever go portrait again the
photographs must be re-shot to match - do not just change the numbers back.**

Checked and NOT a problem: the darker images carry no baked-in letterboxing. Edge
luma measures 17-19, not 0 - that is the Soul Cinema vignette, not a black bar.

### 11. THREE TESTS WERE CHANGED, and all three for a good reason

Saying this out loud rather than burying it. **None was weakened; all three were
pinning an incidental fact rather than a contract.**

- `web-api.test.js` "the step flow is three numbered steps" asserted the literal
  string `STEP 01`, which the redesign split into two elements. It now asserts
  numbering and order via `.stepno-n`, comparing against a three-element array,
  so it **cannot pass vacuously**.
- `web-api.test.js` "a missing place photograph is a 404" borrowed the repo's
  empty `assets/places/`. It now **builds its own empty `assetsRoot`** in a temp
  dir, so the same behaviour is pinned without depending on an asset being
  absent.
- `web-auth.test.js` "the assets still serve" asserted `404`; its real point is
  that the place route is **not gated behind the accounts module**. It now
  asserts **not-503** and accepts 200 or 404. A 200 proves the point better than
  the 404 ever did.

The last two went red **because the eight photographs landed** - the missing
asset they documented had been supplied.

### 12. KNOWN FLAKE, not a regression

`job-model.test.js` "a concurrent reader never sees a truncated or invalid
manifest" fails intermittently under **full-suite parallel load** on Windows with
`EPERM` from `atomicWriteJson`. **Verified 2026-08-23: passes 3/3 in isolation**,
fails perhaps 1 run in 4 under load. Nothing in the 2026-08-23 changes touches
`job.mjs`. This is the class this file already warns about - a test whose timing
margin is narrower than the machine's variance. If it goes red, re-run that file
alone before believing it.

### 13. THREE FRAME SHAPES SHIP - 4:3, 16:9, 9:16 (2026-08-24)

**The design is one constraint: every shape holds its SHORT EDGE at 576 and
varies only the long edge.** That is what keeps ONE set of filtergraph tuning
constants correct in all three -- a 14px head-switch band is 14px of a 576-high
picture whichever shape it is in -- and the short edge always scales 576 -> 1080,
so the grain is not merely similar across shapes, it is arithmetically identical.

| Shape | Tape raster | SAR | Delivery |
|---|---|---|---|
| 4:3 | 720x576 | 16/15 | 1080x1920, **matted, UNCHANGED** |
| 16:9 | 1024x576 | 1:1 | 1920x1080 full-bleed |
| 9:16 | 576x1024 | 1:1 | 1080x1920 full-bleed |

**THE FILE IS THE SHAPE YOU CHOSE.** Paul's reasoning, and it decided the
delivery question: a 16:9 picture matted into a portrait file is useless on
YouTube, and bands are what make a reel look amateur. **4:3 is untouched** --
still matted on the dark surface, because that surround and the vignette over it
are what make the tape read as a photographed object rather than a filter.

**4:3 stays the BASE, not an entry in the `aspects` map**, so the PAL contract
cannot move while somebody adds a shape. Verified by rendering all three and
probing the files: edge luma 79-84 on the new shapes (picture) against 24 on
4:3 (surround).

**THE PAID PATH REFUSES THE NEW SHAPES, DELIBERATELY.** `fal.mjs` still sends a
hardcoded `aspect_ratio`, so a paid 9:16 render would fetch a 4:3 source and
build a 9:16 frame around it -- and every check downstream would agree, because
they all read the same resolved config. `resolveRaster` now throws
`ASPECT_UNSUPPORTED` for a paid provider on any non-default aspect. **Fixture
does all three; paid does 4:3 and refuses the rest.** Lift it when
`FAL_RESOLUTIONS` gains the aspect dimension -- which reopens pricing, because
16:9 at 1024x576 is FEWER pixels than 4:3 720p. **2026-08-24: fal's enum was
read and it accepts 16:9 and 9:16 on both video endpoints**, so the only thing
in the way is this repo. Section 18's closing paragraph carries the full cost.

### 14. THE MOTION PROMPT WAS REWRITTEN (2026-08-24)

Adapted from a Seedance prompt-engineering skill Paul supplied, with most of its
technical-style vocabulary REFUSED.

**The biggest win cost nothing to find: every place preset already carried a
`lens` and a `framing` clause and `composeMotionPrompt` DISCARDED BOTH.** The
still and the video were being shot on different lenses from the same preset.

- **Positive phrasing only.** "No zoom, no cut" was in the prompt text while
  ALSO in `negativePrompt` -- the same instruction on two channels, one of them
  in the form a model handles worst. Prohibitions stay on the negatives channel.
- **A collision the negatives had all along:** `MOTION_NEGATIVES` contained the
  bare word `zoom` while every lens clause describes a consumer ZOOM lens. The
  forbidden thing was always the MOVE; it now reads `the camera zooming`.
- **`CAMCORDER_MOVES` is a whitelist of five** -- drift, reframe, walk, rest,
  follow. The source library has 46; the other 41 are excluded in a comment
  saying why. Credit to https://aicameramovements.com/ is in the file.
- **63 degrees** is the 28-35mm "observational" step from the skill's own anchor
  table, which is where a consumer camcorder sat. White balance in Kelvin off
  the preset's `climate`, with a `whiteBalanceK` override.

**A TEST NOW FAILS if 8K, photoreal, film grain, cinematic, filmic, Kodak, bokeh
or anamorphic reaches the motion prompt.** Asking for those lands model grain at
1080 on top of ffmpeg grain at 576 -- two grain structures at different scales,
which is the texture people read as AI. This is the split at the top of this
file, finally enforced rather than remembered.

### 15. THE VISUAL WORLD WAS REPLACED - it is called STRUCK (2026-08-24)

**`DESIGN.md` and `PRODUCT.md` are new, in the repo, and authoritative. Read
them before touching any UI.** The frost-and-amber world is SUPERSEDED, not
polished.

**ITS ONE RULE: no borders, no rules, no dividers, anywhere.** Grouping is
depth, gauze density and space. Verified mechanically on both pages: zero
elements with a visible border. **Two exceptions are NAMED in DESIGN.md so they
cannot become drift** -- focus outlines, and the small rectangle depicting each
aspect ratio, which is a glyph and not a device for separating two things.

**ORANGE MEANS EXACTLY ONE THING: STRUCK.** It was previously labels, prices,
links, flags, the credit ring, an eyebrow and a 24px divider -- ten jobs at six
sizes, which is precisely why colour could not answer "what have I chosen?".
The old tokens now POINT AT the new values rather than being renamed across 300
rules, so there is one place a colour is decided.

Every option sits unlit at **0.5 opacity**; the chosen one burns cathode orange
and haloes. **Ghosts do NOT go dimmer than 0.5** -- the catalogued grammar wanted
far darker and that measures ~1.4:1, a control nobody can read. At 0.5 it is
4.55:1. That adaptation is permanent and is written into DESIGN.md.

**A spacing scale landed first and made the rest possible.** The page used 34
distinct rem values, 18 inside a 14.4px span, seven stepping by 0.8px. Panel
gaps ran 26/32/54 on a laptop and 18/26/26/35 on a phone; both now measure
32/32/32/48. Separation is `margin-bottom` ONLY, because margins collapse
between block siblings and do not between grid items -- the same declarations
were producing different rhythm either side of the breakpoint.

**VT323 is the display face** -- already committed and licensed, behaves like a
cathode readout when it glows, and means no network font, which the CSP and the
zero-dependency rule both require.

**Only the landing and app pages are converted.** Login, signup, status, result
and pricing still wear the superseded world.

### 16. THE KEYBOARD FOCUS INDICATOR (2026-08-24)

**WCAG 2.4.7 Focus Visible is Level A and the signed-in page was failing it on
19 of its 20 hoisted radios.** `.statehook` is 1x1px with
`clip-path: inset(50%)` -- deliberate, and what keeps the CSS-only selection in
the tab order -- so the global `:focus-visible` outline matched, painted, and
was invisible. The visible control is the `<label>` further down the page, so
the indicator had to be drawn there. `presetCss` now emits one `focusRing()`
rule per catalog entry for **placecard, lookcard, qualitycard and framecard**.
`pl-own` already had one on `.linky` and was the twentieth.

**TWO RULES WERE DELETED, AND THEY WERE THE WRONG INSTINCT WRITTEN DOWN TWICE:**
`.statehook:focus-visible ~ .wrap .placecard { outline: none }` appeared at two
places in the sheet. DESIGN.md names `outline` for `:focus-visible` as the
first of exactly two permitted borders and says it is **never to be removed**.

**THE FIRST VERSION OF THE TEST PASSED WHILE THE PAGE WAS STILL BROKEN, and
that is the part worth remembering.** Asserting only that `#pl-x:focus-visible`
appeared somewhere in a focus selector went green off the LANDING page's
`.lopt--pl-x` rule -- a class that does not exist on the signed-in page at all.
The assertion now requires the rule's target class to be one the page actually
renders. **A focus test that does not tie the rule to the page it is tabbing
through is not testing anything.**

**Measured in a real browser, not asserted** -- a `focusin` probe over a real
Tab sweep of the whole signed-in page:

| | Before | After |
|---|---|---|
| Keyboard stops | 37 | 37 |
| Stops with no visible indicator | 19 | **0** |
| Ring against the ground | -- | **8.4:1** (1.4.11 asks 3:1) |

**The ring also lifts the ghost to full opacity**, because `opacity` applies to
an element's outline too -- a ring on a 0.5 ghost is drawn at half strength on
exactly the controls that most need it.

**A TRAP THIS COST TIME ON: the Browser pane reports `visibilityState: hidden`,
and a hidden tab does not tick CSS transitions.** `.lookcard` has
`transition: opacity 160ms`, so `getComputedStyle` kept returning the 0.5 the
transition started from and the fix looked broken for three rounds of
measurement. Setting `transition: none` on the element before reading resolves
the cascade instead of the animation. **Screenshots need the pane displayed;
measurement does not.**

**Also checked while in there, and it holds:** the only visibly-bordered
elements inside `.wrap` are the three `.shape` glyphs, which is DESIGN.md's
second named exception. The ten `<hr class="rule">` that used to sit in
`views.mjs` and `views-auth.mjs` are **gone**, along with the `.rule` block
that hid them. They were `display: none`, so the mechanical border check
always passed -- which is precisely what let dead markup from the superseded
world survive review, one stale comment away from being switched back on.
`test/web-static.test.js` now fails if an `<hr>` reappears in either file, and
it reads the module source rather than a rendered page so that dividers hiding
in error and notice branches are covered too.

### 17. THE AI-SLOP FIX (2026-08-24) - and where the slop actually lived

**Paul said the still looked like him AND still read as AI generated. Those are
two different problems and only one of them was ffmpeg's.**

**THE DIAGNOSIS COST NOTHING AND SHOULD ALWAYS BE RUN FIRST.** The still was
looped to 375 frames and pushed through the real tape chain with `npm run look`
-- no new generation, no money. Every TEXTURE tell died in the grade: waxy skin,
hyper-detail on the hose reel and the chain-link, lifted shadows, clinical
sharpness. **That half of the architecture works.** What came out the other side
was: dead-centre symmetry, a posed stance with nothing happening, golden-hour
hero light through the hedge, and a too-clean tableau.

**ALL FOUR ARE COMPOSITION, AND COMPOSITION IS CONTENT.** Grain does not move a
subject off the centre line. So the fix is the prompt, and the prompt was asking
for three of the four by name.

| Change | Where | Why |
|---|---|---|
| Framing moved to **third** | `composeStillPrompt` | It sat FIFTH and seedream ignored it outright. `composeMotionPrompt` already carried this exact ruling in a comment. Second time paid for. |
| **`Moment:` clause**, optional per place | `prompt.mjs` + schema + all 8 presets | A brief with no action is a portrait brief, and the model answers it with a portrait. `DEFAULT_MOMENT` is the floor; a place may author its own. |
| **Snapshot rule** rides with framing | `prompt.mjs` | "Set off centre, not quite level." Centring is the tell no amount of grain removes. |
| **`STILL_NEGATIVES`** | `prompt.mjs` | centred / symmetrical / posed portrait / staged tableau / stock photo. BASE_NEGATIVES guarded the period and the anatomy and said nothing about staging. |
| **"deep focus" deleted everywhere** | 2 presets, `_template`, both `local.mjs` fallbacks | **The single biggest AI-image tell, and it was house vocabulary.** A frame where the near table and the far shed are equally sharp is not a photograph. |

**THE CATALOG ALREADY KNEW BETTER IN THREE PLACES** -- "the far balconies
falling slightly out of focus", "the counter behind going soft",
`LENS_OVERRIDES.close`. The fix made that the only phrasing rather than
inventing a new one. Note `soft focus`, `blurry` and `bokeh` are all BANNED look
vocabulary, so falloff has to be described without naming it.

**A COINCIDENCE WORTH KNOWING: `schrebergarten-august` was one of the two worst
presets in the catalog on this axis** -- it had "deep focus ... all the way to
the shed" AND a framing clause with no action in it. `balkon-waesche` and
`kuechentisch-fruehstueck` already had candid framing. **Some of what Paul saw
is preset-specific, not systemic**, so do not read the re-run as a verdict on
all eight.

**NOT CHANGED, DELIBERATELY: the light.** The golden-hour hero light is
per-preset prose across eight files and it is third-order next to framing and
focus. Rewriting the catalog's lighting on a hunch, in the same change as four
other levers, would make the re-run unreadable. **If slop survives this fix, the
light is the next lever.**

**THE RE-RUN IS NOT SEED-MATCHED.** `deriveSeed(jobId, ...)` takes the job id, so
a new job is a new seed and there is no `--seed` flag. Same model, same place,
same outfit, different noise. **It is a prompt comparison, not a controlled
single-variable test**, and a difference could be the seed.

```
node --env-file-if-exists=.env scripts/render/render.mjs --photo=assets/test-photos/face.jpg --place=schrebergarten-august --outfit=trainingsjacke --consent --provider=fal --still-model=fal-ai/bytedance/seedream/v4.5/edit --allow-unverified-model --stills=1 --stop-after=select
```

### 18. DIRECT MODE -- THE STILL IS GONE, NOT HIDDEN (2026-08-24)

**Paul, for the third time and then a fourth: "I don't understand why are you
generating the pictures."** Upload a photo, pick an outfit, a place and a frame
shape, get a tape. Section 9 recorded this as "the still cannot be deleted, only
hidden" and that was WRONG -- it was true of `image-to-video` and of nothing
else. `bytedance/seedance-2.0/reference-to-video` was **verified on 2026-08-20,
recorded in config/models.json, and never wired in.** It takes the photographs.

```bash
node --env-file-if-exists=.env scripts/render/render.mjs --photo=assets/test-photos/face.jpg --place=schrebergarten-august --outfit=trainingsjacke --consent --provider=fal --direct --video-model=bytedance/seedance-2.0/reference-to-video
```

**`--dry-run` on that command works today and charges nothing.**

| Piece | Where |
|---|---|
| `falReferenceVideoBody` | `image_urls`, never `image_url`; `referencesParam` per model, same lesson as BUG 3 |
| `composeReferencePrompt` | @Image1 = face, @Image2 = uploaded place. Carries every ruling the other two prompts paid for |
| `assertVideoRequest` | **exactly one** of `imagePath` / `references`, never both |
| `SKIP_CHECKS.still` / `.select` | `skipped`, which is not `done` -- the ledger can tell the difference |
| `input.direct` | on the INPUT, because the manifest is the only channel to the worker |
| `estimateJob` | no still line at `stillCount: 0`, so a direct render is not over-quoted |

**DIRECT MODE IS ONE CALL OR IT IS REFUSED, and that guard is the point rather
than a detail.** On the still path a chain is continuous -- segment N+1 starts on
segment N's last frame. On this path there is no frame to continue from, so a
second segment would be an INDEPENDENT generation from the same photographs,
joined by a jump cut between takes that never shared a frame. That is exactly
what Paul described not wanting. `stepCompose` throws `DIRECT_NEEDS_ONE_CALL`
naming both numbers.

**A CONSEQUENCE WORTH KNOWING: `--provider=fixture --direct` REFUSES.** The
fixture caps at 8s deliberately -- its own comment says a fixture claiming 15
would let the pipeline skip segment chaining -- so 15s needs two calls and the
guard fires. **Direct mode cannot be smoke-tested for free through the fixture.**
It is covered end to end by `test/pipeline.test.js` against a 15s fake, and the
first real proof has to be a paid call. Do not "fix" this by raising the
fixture's cap; that trades a real guard for a convenience.

**IT RAN, END TO END, 2026-08-24. Job `20260824-122201-af8b0d`, ~$4.54
estimated, not metered.** Photograph in, finished tape out, and the still stage
never happened: steps 5 and 6 both printed `skipped`. **375 frames, 15s,
-27.4 LUFS, every contract assertion green.** The direct path is real.

**@Image1 DOES CARRY A FACE.** The open question in `config/models.json` since
2026-08-20 has an answer: the beard, the curls and the features arrive, and the
person in the clip is recognisably the person in the earlier seedream still. The
Moment clause landed too -- he reaches across for the bottle, then turns back.
**Paul's own verdict on THIS clip is still owed; the observation above is about
the image, not a judgement of resemblance, and only he can make that call.**

**WHAT THE MODEL ACTUALLY RETURNED: 752x560 at 24fps, 361 frames, 15.04s.**
- The **raster is not honoured**, exactly as on the still endpoint: 640x480 was
  ordered. 752x560 is also 47:35, marginally wider than 4:3. Harmless -- the
  tape stage scales -- but the price may be quoted for a different size.
- **24fps, where the whole contract is 25.** ffmpeg retimes it; nothing is lost.

**A FALSE WARNING THAT WAS WORTH FIXING PROPERLY.** `assemble` compared frame
COUNT against 375 and announced *"the tape stage will loop the source to reach
15s and the repeat may be visible"*. **Untrue here**: 15.04s is MORE than fifteen
seconds of material, and the delivered tape ends on the last frame of the action
-- checked frame by frame on the file, not assumed. The check now asks whether
there is enough TIME to fill the contract (`assembleFrameWarnings`, exported and
tested), so a frame-rate difference is silent while a genuinely short source
still warns about the loop by name. **A warning that cries wolf is how the real
one stops being read**, and the real one matters because `-stream_loop -1` does
repeat a short source visibly.

**TWO BUGS PAUL'S FIRST REAL RUN FOUND, both at compose, neither billed:**

1. **`stepCompose` held the STILL model to `verified: true` unconditionally**,
   so a direct job died naming `fal/UNVERIFIED-identity-still` -- an entry that
   is unverified ON PURPOSE so an unconfigured fal render stops before it
   spends. The gate is right; it was being asked about a stage that no longer
   runs. **The test suite missed it because the harness maps `defaults.fake` to
   the FIXTURE defaults, whose still model IS verified.** There is now a test
   that points it at the real unverified entry, and a second one asserting the
   ordinary path still refuses -- the fix must not become a hole in the guard.
2. **`videoModelOverride` was never threaded into `runPipeline`.** The provider
   was built with the override and the manifest froze the DEFAULT, so it would
   have recorded image-to-video while calling reference-to-video. Same reasoning
   the still override already carried; the video half simply never got it.

**`--stop-after=compose` PROVES THE WHOLE FREE HALF FOR $0** and is the right
check before any direct run: it writes a manifest showing `direct: true`, the
frozen video model, `1 segment = 15s`, an estimate carrying only an `animate`
line, `stillPrompt: null` and a `referencePrompt`. Verified 2026-08-24.

**WHAT THIS COSTS, AND IT IS THE WHOLE RISK.** The still was also the cheap
rejection gate: a likeness that missed cost **$0.04** and the user saw it before
paying. Here the same miss costs a whole video -- **~$4.54 estimated at the flat
per-second rate**, which is itself derived from a 720p figure nobody has ever
been invoiced for. The trade was put to Paul four times and taken four times.
**It is a product decision, not an oversight, and section 9's cost analysis
still stands: solve identity first, then hide everything.** Identity IS solved
as of this morning -- seedream held the likeness -- but on the STILL endpoint,
and `config/models.json` still carries the open question in its own words:

> "Does @Image1 hold a FACE as well as image-to-video holds a start frame? ...
> a yes is not automatically good news."

**That question is unanswered and only a paid call answers it.** The old path is
untouched and still the default precisely because of that.

**ASPECT RATIOS: THE ENDPOINT SAYS YES, WE STILL SAY NO (checked 2026-08-24).**
Both of fal's pages give the same enum for `aspect_ratio` — `auto, 21:9, 16:9,
4:3, 1:1, 3:4, 9:16` — on reference-to-video and on image-to-video. **So 16:9
and 9:16 would be ORDERED natively, not cropped**, and section 13's refusal is
this repo's, not the vendor's. `config/models.json` still records
`aspectRatios: ["4:3"]` because that field says what the PRODUCT offers, the
way `resolutions` already does; the enum is recorded in that entry's comment.

**What lifting it actually costs**, so nobody starts it thinking it is a config
edit: `FAL_RESOLUTIONS` is a 4:3 table by construction — the label is the height
and 4:3 supplies the width — `animate/plan.mjs` derives the same rasters from the
same rule and there is a test that the two agree, `fal.mjs` sends the
`FAL_ASPECT_RATIO` constant on every call, and `resolveRaster` throws
`ASPECT_UNSUPPORTED`. Four places, one rule. **And it reopens pricing**: 16:9 at
1024x576 is fewer pixels than 4:3 at 720p, and every price in this repo is still
an unmetered estimate, which is why METER A RUN is item 1 and this is item 4.

**The harder half is not the enum, and as of 2026-08-24 it has a price.** This
endpoint ordered at 640x480 and returned **752x560** — a size nobody asked for,
**and fal bills the size it sends**: 37.5% more than the 480p tier implies, on
every direct render. Section 22. `resolveRaster` refuses a
non-default shape on a paid provider precisely because a render that delivers
something other than what was ordered is invisible to the customer AND the
ledger; a model that picks its own raster is that failure already, and whoever
lifts the guard has to say what the tape stage does with it.

### 19. THE VLOG REWRITE (2026-08-24) -- the direct tape has beats now

**Paul watched the first direct tape and diagnosed it exactly:** *"there is no
engagement, no enthusiasm ... the character is placing the bottle on the table,
it is taking around five to six seconds ... it should be like a vlog. If I am on
a beach it has to be running toward the streets, the beach view, and everything.
It should have some content."*

**THE PROMPT WAS ASKING FOR PRECISELY WHAT HE DID NOT WANT.** In its own words:
`It drifts a few centimetres and settles, the operator standing in one place and
breathing`, and `Nothing dramatic happens ... it simply continues for the whole
15 seconds`. The model obeyed both perfectly. **Read the prompt before blaming
the model** -- that is now the second time on this project.

**`composeReferencePrompt` IS NOW A NUMBERED SHOT LIST**, six beats for 15s off
the `seedance-prompt` skill's own 2-2.5s-per-shot table (`shotCountFor`). The
arc is the order a home recording actually goes: **arrive, look around, notice a
thing, do the thing, react, settle.** Shot 2 pans the whole place and shot 3
pushes in on a named prop -- that is "the beach view, and everything", the half
Paul said was missing. A shorter runtime drops the middle and keeps the ends.

**CUTS ARE NOW ALLOWED ON THIS PATH AND STILL FORBIDDEN ON THE OTHER**, which is
why `MOTION_NEGATIVES` was split into `CUT_NEGATIVES` + `PACE_NEGATIVES`:
- A motion SEGMENT must not cut -- it gets joined to others, and footage that
  cuts inside itself cannot be used at all.
- A direct tape is BUILT on cuts. Seedance does multi-shot inside ONE
  generation, so nothing is stitched by the pipeline and
  `DIRECT_NEEDS_ONE_CALL` is untouched. **In-camera cuts are also period-honest:
  a 2003 tape is full of them because you pressed record and stopped again.**
- Everything that was never about stillness -- slow motion, speed ramps, time
  lapse, morphing, location and wardrobe changes -- stays refused on both.

**A TEST WAS DELETED AND ANOTHER CHANGED SHAPE, both deliberately.** "the
reference prompt is one continuous take" asserted the design Paul replaced. "the
reference prompt keeps the anti-slop work" asserted a standalone `Framing:` line
before `Light:` -- correct for a single-take prompt, meaningless for a shot list
where every shot states its own size; it now asserts what it was ever really
guarding, that the frame is uncomposed and something is happening.

**TWO FALSE POSITIVES IN THE NEW TESTS, both mine, both worth knowing:** a bare
`/ARRI/` matches **carriageway** and **barrier**, which the autobahn place says
twice -- word-boundary it. And asserting a prop appears verbatim broke the
moment the shot list capitalised it to open a sentence.

**NOT CHANGED, AND THE OBVIOUS NEXT LEVER: `the camera zooming` is still a
negative.** A punch-in zoom is the most characteristic home-recording move there
is and it would add real energy. It was left alone so this run measures one
change, not two.

**THE PRODUCT IDENTITY MOVED, AND IT WAS SAID OUT LOUD BEFORE BUILDING.**
PRODUCT.md opens on "Warm, grainy, quiet" and the entire look was designed
around stillness. **A vlog is the opposite of quiet.** Paul chose it knowingly;
if the docs are not updated to match, the next person will read a product
description that no longer describes the product.

### 20. PLACE AMBIENCE (2026-08-24) -- the bed now knows where it is

**The bed was the sound of the MACHINE and nothing of the PLACE**, so a Baltic
beach and a concrete stairwell came out sounding identical: hiss plus capstan,
every time. Paul asked for sound "according to the video".

**`audio.ambience` is a fourth layer, SILENT BY DEFAULT.** `amplitude: 0` emits
no chain at all, so a job with no place override is bit-identical to the bed
before this existed -- which is what keeps the still path and every existing
calibration untouched. All eight places set their own in
`lookOverride.audio.ambience`.

**One vocabulary covers the whole catalog: filtered noise, optionally swelling,
optionally in a room.** Surf and wind are a slow swell over brown noise; traffic
is the same without the swell; a swimming hall or a stairwell is the same again
with `aecho` on it. **Synthesised, for the reasons the module header already
gives for the hiss** -- no sample means no licence and no normalisation pass,
because a generator's loudness is known before it renders.

**MEASURED, NOT ASSUMED. Every place, ebur128, integrated:**

| | LUFS | | LUFS |
|---|---|---|---|
| (no place, before) | -27.2 | Autobahn | **-26.4** |
| Beach | -26.7 | Living room | -26.9 |
| Balcony / pool / stairwell | -27.0 | Kitchen / allotment | -27.1 |

Target -27, tolerance 2. **The loudest place moves the bed 0.8 dB.** The place
is felt rather than heard, which is the level Paul chose.

**THE SEED IS `audioSeed + 1`, AND THAT IS NOT COSMETIC.** Two `anoisesrc` on
one seed emit IDENTICAL noise; summing that is not two layers, it is one layer
6 dB louder and perfectly correlated. It would sound exactly like the hiss being
turned up, and nothing in the graph would look wrong. There is a test.

**A REAL BUG THIS EXPOSED, one level down from where anyone was looking.**
`withoutDocs` in `expand/local.mjs` strips a borrowed preset's `_comment` so a
manifest cannot quote an argument about a different scene -- **and it filtered
the TOP LEVEL ONLY.** That was sufficient while every lookOverride was two deep
(`grade.saturation`); ambience is three (`audio.ambience._comment`), so a typed
place could have carried "motorway rumble from behind the kiosk" into a scene
with no kiosk in it. Now recursive, with a test that walks every depth. **The
same two-level assumption was in `test/pipeline.test.js`'s frozen-look check**,
where it compared an object against an object by identity and failed for the
wrong reason.

**NOT DONE, and both want a TONE rather than noise:** the fluorescent buzz the
stairwell preset names, and the kitchen clock tick. This layer only makes noise;
the capstan already proves tones work, so it is a small extension rather than a
new idea. **Also not done: audible cuts.** Now the vlog has six shots, a real
recording's sound would JUMP at each one -- the strongest remaining authenticity
detail, and it needs shot-boundary detection on the finished clip.

### 21. `npm run ledger` EXISTS (2026-08-24) -- and what was missing was not the report

`package.json` has pointed a `ledger` script at `scripts/render/ledger-cli.mjs`
since before there was a file there, so the command failed with
MODULE_NOT_FOUND. `pricing.mjs` already carried `divergence`, `diverges` and the
15% limit, and the doc comment on `diverges` said in as many words *"true when
`npm run ledger` should name this one"*. All of it was written against a command
nobody had built.

**THE READ-ONLY HALF WOULD HAVE BEEN USELESS ON ITS OWN.** `cost.actual` is
`null` on every job ever run, because nothing writes it -- fal's queue response
carries no price, and `fal.mjs` says so: *"actual: null means NOT METERED YET"*.
A report over that prints "not metered" once per job forever. So the command has
two halves and `record` is the one that matters:

```bash
npm run ledger                                                  # the report
npm run ledger -- record 20260824-122201-af8b0d --actual=1.51   # the invoice
```

**Today it prints five jobs, $9.2110 estimated, nothing metered.** Record one
number and the next run says, for that model, the implied per-unit rate against
the configured one -- e.g. `$0.1007/second against $0.3027/second` -- and names
the `config/pricing.json` line to change.

**IT DOES NOT EDIT `config/pricing.json`, DELIBERATELY.** Every entry there
carries a `_comment` saying where the number came from and the literal word
ESTIMATE, which `provider-contract.test.js` enforces. A script rewriting those
would erase the provenance that makes the file worth reading, and could turn an
ESTIMATE into an unmarked fact. It prints the edit; a human makes it.

**THREE REFUSALS, EACH FOR A REASON THIS REPO ALREADY HELD:**
- **`--actual=0` is refused** unless `--actually-zero` is passed. `null` means
  not metered and `0` means free; `contract.mjs` already refuses a zero-by-
  accident for the same reason. A mistyped empty argument must not prove that
  fal gives videos away.
- **A job billed for more than one step demands `--step=`.** Guessing would put
  a video's price on a still, and the per-model rollup -- the entire point --
  would be wrong in a way no total could reveal.
- **An already-recorded number needs `--force`**, and both numbers are printed.
  A metered figure is evidence somebody paid to obtain it.

**`meterStep(job, name, actual)` IS NEW IN `job.mjs` AND IT DOES NOT MOVE THE
STEP.** `finishStep` is the only other way to price a step and it is a
`running -> done` transition; metering happens days later on a step that is
already `done`. Routing it through `finishStep` would have meant relaxing the
transition table for a bookkeeping entry, and that table is what stops a resume
becoming a second bill. It refuses `pending` and `skipped` -- a skipped step
produced nothing and cost nothing -- and allows `failed`, because a request that
went out and never came back is billable, which is why `recordIntent` exists.

**A BUG THE TESTS MISSED AND RUNNING IT FOUND IN ONE LOOK.** The first version
selected rows by "has an actual recorded". The fixture provider returns
`actual: 0` honestly -- a local ffmpeg call IS free -- so the first real run
printed **twelve fixture jobs above the five that cost money and announced "12
metered"** when nobody had metered anything. The rule is now "a non-zero
estimate, or a non-zero charge", which still keeps the most interesting line the
report could print: $4.54 expected, $0 actually billed. **There is a test for
each half.** Run the thing you built against real data before believing the
green.

### 22. THE FIRST METERED RUN (2026-08-24) -- fal bills tokens, and it bills what it SENDS

**Read off fal's own usage page, recorded with `npm run ledger -- record`, and
the ledger totals $4.3369 against fal's $4.34.** Five jobs, three endpoints.

| Endpoint | fal charged | Estimate said | Verdict |
|---|---|---|---|
| `bytedance/seedance-2.0/reference-to-video` | **$4.156908** / 296.92k tokens (2 jobs) | $9.081 | **2.18x too high** |
| `fal-ai/uso` | **$0.10** / 1.00 Megapixel | $0.05 | **half the real price** |
| `fal-ai/bytedance/seedream/v4.5/edit` | **$0.08** / 2.00 Images | $0.08 | **exactly right** |

**THE FORMULA WAS NEVER WRONG. THE FLATTENING OF IT WAS.** `config/credits.json`
already recorded fal's token formula -- `tokens = w * h * seconds * 24 / 1024`
at `$0.014` per 1000 -- and it reproduces the invoice to **seven figures**:
two clips at 752x560 x 15.04s come to 296.92k tokens and **$4.156915** against
fal's **$4.156908**. What was wrong is that `config/pricing.json` has no token
dimension, so somebody wrote the 720p per-second rate into it. **A 15-second
video costs $2.08, not $4.54.**

**AND THE RASTER IS NOT COSMETIC ANY MORE.** Section 18 recorded that the model
returns 752x560 when 640x480 is ordered and called it harmless because the tape
stage rescales. **It is not harmless: fal bills the raster it RETURNS.**

- ordered 640x480 x 15s = 108000 tokens = **$1.5120**
- delivered 752x560 x 15.04s = 148461 tokens = **$2.0785**
- **a 37.5% surcharge, on every direct render, for pixels nobody asked for**

That answers the open question `config/credits.json`'s 720p entry has carried
since it was written -- *"whether the provider bills the raster it returns"* --
and it makes the aspect-ratio work in item 4 worth money rather than just
worth tidiness.

**`config/credits.json` WAS NOT REPRICED, DELIBERATELY.** `estimatedUSDPer15s`
feeds `creditCost`, so changing it changes what a customer pays, and that is
Paul's decision. It is annotated instead: the 480p figure of $1.51 is now KNOWN
to understate real cost by about a third, which is the direction that file's own
header calls unsafe. **Either the raster gets honoured or that number goes up.**

**A GUARD LEARNED A THIRD STATE, and it had been asking for it in its own error
message.** `assertPricingTable` refused every non-zero `estimate: false` with the
words *"until a --meter run proves it"*. A run has now proved two, and an entry
forced to keep calling an invoiced number an ESTIMATE is a lie in the other
direction. The rule was never "everything is a guess", it was **"a number may
not claim to be a fact without saying why"** -- so a measured price may now set
`estimate: false` **if and only if** it carries `meteredOn` (an ISO date) and
`meteredFrom` (where it was read). Half the evidence is refused, and a date that
is not a date is refused.

**STILL UNMETERED, and do not assume these follow:** `image-to-video` has
**never been called** and keeps the suspect $0.3027/s -- probably wrong the same
way, deliberately NOT copied across, because guessing one endpoint's price from
another's invoice is how the bad number arrived. **720p has never been run at
all.** And `fal-ai/uso` bills per MEGAPIXEL with an apparent 1MP floor: the
640x480 this repo orders is ~0.31MP and was billed as 1.00.

**One receipt, $12.00 of credits bought on 2026-08-23, $4.34 spent, $7.66 left.**

### 23. THE FIVE UNCONVERTED PAGES (2026-08-24) -- measured, and the plan was half wrong

**"They clash" is not a defect anybody can fix.** The pages were rendered and
probed in a real browser instead, and the difference turned out to be mechanical:

| | landing / app (converted) | login, signup, pricing, status, result |
|---|---|---|
| `.grain` -- fractal noise, fixed, over the whole viewport | `display: none` | **live** |
| `.gauze` -- the anode mesh | present | **absent** |
| visible borders | 0 | 0, except **15 on pricing** |

**The five wore the one texture DESIGN.md bans and lacked the one it requires**,
and in both cases because the thing was a page-by-page opt-in. `.gauze` was
emitted through `preBody` by exactly two callers; `.grain` was switched off by a
rule naming exactly two pages. **Every page nobody remembered to add to those
lists came out wrong** -- a structure problem wearing a taste problem's clothes.

Both are structural now: **the grain plate is DELETED** rather than suppressed,
and **the gauze lives in `layout()`** so a new page cannot forget it. The two
literal-colour borders -- `.step` on the status page and `.plan li` on pricing,
fifteen of them -- are gone, and the lists group on space.

**THREE TESTS KEEP IT THAT WAY, and they read the RENDERED pages**: every page
the app can produce carries the gauze and none carries grain; `.grain` appears
nowhere in the sheet; and no border declaration anywhere uses a literal colour.
That last shape is the useful one -- borders written against `var(--hairline)`
are already transparent, which is how the two converted pages went borderless
without rewriting 300 rules, but a literal colour is a line no token can turn
off. `renderedPages()` is a hand-written LIST rather than a loop over exports,
because a page missing from it is invisible to all three checks, and being
invisible to the last check is exactly how five pages stayed wrong.

**TWO ITEMS OF THE PLAN WERE WITHDRAWN AFTER MEASURING, recorded so nobody
re-proposes them.** The plan said headings on those pages should take the
display face and `.eyebrow` should retire. Both came from comparing against the
LANDING page, whose `h1` is TapeOSD at 94px -- the wrong neighbour. The
signed-in app page is the one these sit beside, its own `.app-h1` is system sans
at clamp(29-40px), and it uses `.eyebrow` too. Forcing the display face onto
interior headings would have matched the hero and clashed with the neighbour,
and DESIGN.md's own rule is that **body is never uppercase**. The remaining
heading difference is 28px against 29-40px, which is not a clash.

**WHAT IS STILL WRONG, AND IT IS THE INTERESTING PART.** On `/pricing` the
current plan is marked with a **bordered pill** -- `border: 1px solid
var(--accent-deep)` on `.plan .mark`. DESIGN.md permits exactly two borders,
names both, and says any new one "must argue itself into this list or it does
not ship". This one never argued. Worse, the three plans are otherwise
**identical**: no ghost, no strike, no halo. The world's whole mechanic is
"every value present as an unlit ghost, one struck forward in glowing orange",
and the page that answers "which plan am I on?" is the one page not using it.
**That is precisely the failure the palette rule was written against** -- colour
losing the ability to answer "what have I chosen?". The fix is to strike the
current plan, ghost the others at `.5`, and delete the pill.

### 24. ONLY 480p HAD EVER BEEN ORDERED, AND NOW A TIER CAN BE (2026-08-24)

**`render.mjs` had no `--resolution` flag.** `job.input.resolution` has been
honoured by the whole pipeline since `resolveRaster` was written, the web app's
quality picker sets it, and **nothing could set it from a command line** -- so
every CLI render silently took the provider's cheapest offer. That is why the
first metered run could not answer the question that decides the price list:
**a 720p job could not be made.** The web app can order one and the web app
cannot spend (section 8).

`--resolution=480p|720p` now exists, validated against `AVAILABLE_RESOLUTIONS`
so a typo costs a line rather than a render. It is left `null` when omitted
rather than defaulted to 480p, because null already means something here -- "no
order behind this render" -- and `resolveRaster` prints a different line for it.

**A JOB IS PARKED AND UNPAID AT `20260824-225641-f34b4f`.** Every free step ran;
`--stop-after=compose` stopped it before the money. It froze
`720p -> 960x720 (4:3)`, one 15s segment, reference-to-video. Resume it and the
only remaining step is the paid one:

```bash
npm run render -- --resume=20260824-225641-f34b4f
```

**WHAT THAT RUN ANSWERS, and it is the whole price list.** Both metered jobs
ordered 480p and were delivered 752x560. If a 720p order also comes back
752x560, then **480p and 720p are the same product** and a customer paying 46 CR
receives the identical file as one paying 16 CR. The forecast if the raster IS
honoured is 243000 tokens, **$3.40**. The 480p order delivered 148461 tokens,
$2.08. Those two numbers being equal is the finding.

**A DEFECT THE DRY RUN EXPOSED AND THIS DID NOT FIX.** `--dry-run` quotes the
**identical $2.079 at both tiers**. Section 22 corrected the RATE in
config/pricing.json; it did not give that table a resolution dimension, and
`estimateVideo` still prices per second and nothing else. So the command whose
entire job is authorising a spend cannot tell a 480p order from a 720p one --
and by the formula those differ by 2.25x. **The real fix is to price video by
the token formula rather than per second**, since fal bills tokens and
config/credits.json already carries the formula and it is confirmed correct to
seven figures. Not done; it changes `estimateVideo`'s signature and every
caller.

---

### 25. THE CHECKOUT AND THE WEBHOOK (2026-08-25) — money can be taken, and is not

**§5 and §6 of the credit-packs spec are built.** Four new files, two new routes,
59 new tests, and **zero npm dependencies** — Stripe's API is form-encoded HTTPS
and its signatures are HMAC-SHA256, so `fetch` and `node:crypto` are the whole
client.

```
scripts/billing/stripe.mjs   the protocol: one POST, one signature verifier
scripts/billing/packs.mjs    what is for sale, resolved from config/credits.json
scripts/billing/billing.mjs  the seam: where the transport and the secrets go in
config/credits.json          a new `packs` block -- $10, 40 CR, stripePriceId null
```

**NOTHING CAN BE BOUGHT TODAY AND THAT IS DELIBERATE.** `stripePriceId` is
`null`, so the button on `/pricing` renders disabled and `POST
/api/billing/checkout` answers **503 CHECKOUT_NOT_OPEN** without attempting a
call. A Stripe Price is immutable — creating the wrong one costs a new Price —
so it is the last thing to exist, gated on §7: meter the parked 720p job, fix the
estimator, run the blind check.

#### The five properties worth not breaking

1. **The browser sends a pack id and nothing else.** No amount, no currency, no
   credit count, and no `price_data` in the request to Stripe — the Price
   object is the only thing that sets what is charged. A test posts
   `credits=99999&amount=1&priceUSD=0.01` and asserts none of it reaches Stripe.
2. **The webhook reads RAW BYTES.** `server.mjs` now has `readRawBody` as the
   primitive and `readBody` as a `toString('utf8')` wrapper over it, rather
   than the other way round. **The test that matters signs one byte sequence and
   sends a different one that parses to the same object**; it passes only
   because the handler hashed what arrived on the socket.
3. **The event id is the ledger's `ref`.** A redelivery finds it and is a no-op.
   Asserted against the REAL on-disk ledger — a fake that dedupes correctly
   would only prove the fake dedupes correctly — on the row count as well as the
   balance, because a compensating pair of rows leaves a balance right and an
   audit log lying.
4. **The status code is a message to Stripe and to nobody else.** 2xx means
   "stop retrying". So an event this product ignores gets a **200**, and a
   payment that could not be credited — no such account, no way to price it —
   gets a **5xx**, which keeps it in the retry queue and then on the
   failed-events list where a person can find it. A 200 on a payment we failed
   to credit is money taken with the evidence thrown away.
5. **The secret key goes to `api.stripe.com` and there is no parameter that
   moves it.** That is finding F3 of the security review — `FAL_KEY` going to
   every host on an allow-list — fixed in advance rather than repeated. A test
   passes `baseUrl` and `apiBase` anyway and asserts they do nothing.

#### Three things that will bite

- **`form-action 'self'` blocks the redirect, not the form.** The buy button
  posts same-origin and the handler 303s to `checkout.stripe.com`; Chrome
  checks a form submission's REDIRECT target against `form-action`, so without
  `https://checkout.stripe.com` in the directive the button silently does
  nothing and there is no error anywhere. It is in the CSP in `sendHtml`.
- **A new account is not empty.** `createAccount` grants the free plan's period
  credits at signup, so any test asserting an absolute balance after a webhook
  is really asserting the signup grant. Assert the DELTA, and filter the ledger
  to rows carrying a `ref` — payments have one and the signup grant does not.
- **`npm run web` now loads `.env`.** It has to, because that is where the two
  Stripe secrets live. `npm test` is still a bare `node --test` and still does
  not, which is guard 3 — and the server's billing seam is defaulted to one with
  **no transport and no credentials**, so a test that somehow reached checkout
  gets a `TypeError` rather than a bill. That is a fifth guard and it is
  structural.

#### What was deliberately NOT changed, and why each is a decision

- **The tape price.** §2.1 wants 21 CR at 480p against today's 16; editing
  `estimatedUSDPer15s` changes what a customer is charged and the config file
  says in its own words that this is Paul's call. So **40 CR buys two 480p tapes
  today and the spec sizes it at one** — safe, because nothing can be sold, and
  written into the pack's `_comment` because the two numbers have to move in the
  same edit.
- **`grant.expiryDays` is still `null`.** §2.4 recommends 365 and §9 lists it as
  open. Setting it today would show customers an expiry date that **no code
  enforces** — nothing writes the negative ledger row that would realise it —
  and a date the system does not honour is worse than no date.
- **The free tape.** §3 in full, ceiling included. Not touched; item 9 above.
- **The pricing page's visual grammar.** Item 3 of PICK UP HERE says DESIGN.md
  gets rewritten first and the pages follow. The pack card reuses the existing
  `.panel`/`.plan`/`.record` classes and adds no CSS, so it moves with whatever
  replaces STRUCK instead of having to be undone.

#### Proving it without a public url

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
stripe trigger checkout.session.completed
```

The Stripe CLI (v1.50.0, already installed) delivers genuinely-signed events to
a local server, so **the entire payment path can be proven before any public URL
exists.** Only going live needs the deployed endpoint. Note that a `stripe
trigger` event carries no `client_reference_id`, so it will land as a 500
`NO_ACCOUNT_ON_SESSION` — which is the correct behaviour and is what that test
asserts; a real purchase carries one.

---

### 26. THE 720p TIER IS REAL, AND THREE THINGS WERE NOT HANDED ON (2026-08-25)

**The parked job ran. 960x720 ordered, 1112x834 delivered.** That was the
question that decided the price list and the answer is the good one.

| tier | ordered | delivered | tokens | cost | CR @ $0.10 |
|---|---|---|---|---|---|
| 480p (x2 jobs) | 640x480 | **752x560** | 148,050 | **$2.0727** | 21 |
| 720p | 960x720 | **1112x834** | 326,042 | **$4.5646** | 46 |
| 1080p | — | never run | — | ~$10.27? | ~103? |

**720p IS 2.20x THE PIXELS OF 480p.** Had it come back 752x560 there would have
been one product and not two, and selling a tier would have been a claim on a
public page that is not true. It can be sold. **Paul watched it and the likeness
held** — see The one thing to know.

#### Four findings from one measurement

1. **480p WAS BEING SOLD BELOW COST.** $1.51 was the formula applied to the
   raster we ASK for, and fal has never once delivered the raster it was asked
   for. Real cost $2.0727, so **16 CR -> 21 CR**. Every 480p tape sold before
   this lost 5 CR of cost basis.
2. **720p WAS RIGHT BY ACCIDENT.** $4.54 came from 1280x720 — a 16:9 frame this
   product never orders and fal has never sent — and landed within three cents
   of the truth because two errors cancelled. **The spec's §2.1 wanted to LOWER
   it to 35 CR** against a $3.40 forecast that assumed the raster was honoured.
   Following the spec would have sold every 720p tape below cost. The gate held.
3. **THE RATIO WAS WRONG, NOT JUST THE PRICE.** 480p was assumed to be about a
   THIRD of 720p, on the stated theory that fal's fast tier is priced
   differently. Measured, it is **0.454 — the pixel ratio to three decimals.**
   fal bills tokens, tokens are pixels x seconds, and there is no separate tier
   rate. The theory was reasoned and the invoice disagrees.
4. **THE FREE PLAN HAD TO MOVE OR IT WOULD HAVE SILENTLY BROKEN.** 16 CR was
   exactly one 480p tape and now buys nothing — an account could sign up, see a
   balance and be refused at the button. It is **42: two 480p tapes**, at Paul's
   direction, and still short of a 720p one. That is **$4.15 of provider spend
   per signup** against no revenue, and **the global ceiling §3 asks for still
   does not exist.**

**AND THE $10 PACK CANNOT BUY A 720p TAPE.** 40 CR against 46. A customer buying
one pack gets 480p only. That may be the ladder Paul wants; it is a product
decision that only became visible once the tiers were measured.

#### THREE PASS-THROUGH DEFECTS IN ONE MORNING, and they are one bug wearing three hats

Every one is **a value that exists, is correct, and is simply not handed on** —
and no unit test of the function that RECEIVES it can see the call site that
forgot to pass it.

| What was dropped | Where | What it did |
|---|---|---|
| `provider` | `--resume` | Resumed a `fal` job against `fixture`; the capability error was recorded as a real step failure, so **a job parked for a metered run was marked `failed` by a command meant to cost nothing** |
| `--video-model` | `--resume` | Built a reference-to-video BODY (`image_urls`) and posted it to the image-to-video ENDPOINT (`image_url`). **fal answered 422** |
| `--resolution` | `--dry-run` | Priced **every tier as 480p**. `dryRun()` had read `input.resolution` correctly the whole time |

**NOTHING WAS CHARGED, BY LUCK.** The 422 happened because the two shapes were
incompatible. **Had they agreed, the resume would have rendered with a model the
manifest does not name, billed for it, and left the frozen block lying** — which
is exactly the reproducibility that block exists to guarantee.

**AND A FOURTH, WHICH IS THE ONE THAT NEARLY COST MONEY: `--dry-run` WAS
IGNORED ENTIRELY ON A RESUME.** The `--resume` branch returns before the dry-run
branch is ever reached, so the flag whose whole promise is *charges nothing* ran
the job for real. It was caught only because the provider had ALSO defaulted
wrong and died on a capability check first. **With `--provider=fal` typed on
that same line — which is the correct command for the job — it would have been a
paid call made by somebody who believed they were pricing it.**

**THE FIX: the manifest wins, and a command line that CONTRADICTS it is refused
by name.** `scripts/render/resume.mjs`, nine tests. Agreeing stays legal — naming
the model a job already froze is how the metered run was finally made. A job that
froze nothing falls back to the CLI and then to `fixture`, **never to a paid
provider.**

```
20260824-225641-f34b4f froze video model "…/reference-to-video" and the command
line asks for "…/image-to-video". A resumed render must be the render the
manifest describes, or the frozen block stops meaning anything. Run it again
without the flag to use what the job froze, or start a new job if you meant a
different video model.
```

#### The estimator now prices by tokens

`unit: "token"` on reference-to-video, and `delivered` is a measured **LOOKUP
keyed by the ordered raster, not a coefficient** — the two upscales are not the
same number (1.175 x 1.167 at 480p, 1.1583 on both axes at 720p) and a single
factor cannot reproduce both. An unmetered raster is priced through
`deliveredUpscaleFallback`, the LARGEST upscale seen, because **overstating cost
understates margin and that is the safe direction.** A token-billed model
**refuses to quote without a raster** rather than falling back to a per-second
guess — that fallback is precisely the flattening being removed.

**config/pricing.json and config/credits.json now have a cross-file test.** One
prices what a render costs us, the other what a customer is charged; they are two
files answering two questions from ONE measurement, so a future metering that
corrects one and not the other goes red rather than leaving the estimator and the
invoice quietly disagreeing.

#### A defect in the tape that Paul found by watching it

**A frozen frame once per second, every second, in every tape ever made.** fal
delivers **24fps** and the contract is **25** — 361 source frames stretched to
375 duplicates 15 of them, and `ffmpeg`'s `fps` filter places them at frames 12,
37, 62, 87 … **exactly one every 25.** Periodic judder is the most visible kind,
because the eye locks onto the rhythm.

**Measured, not inferred:** `ffmpeg -vf fps=25 -f framehash` on the raw segment,
counting consecutive identical hashes. It is separate from the DELIBERATE tape
stutter at `droppedFrames: [201, 202]` — 8.04 seconds in — which is working
exactly as designed.

**fal's `duration` caps at 15**, so we cannot buy 15.625s of 24fps footage to
fill 375 frames. The three ways out are: interpolate to 25fps and let the
tapedeck add stutter where it WANTS it (the content/texture split this repo is
built on); scatter the duplicates pseudo-randomly from the job seed so the
metronome becomes tape unsteadiness; or leave it. **PAUL'S CALL, NOT TAKEN YET.**

#### Two things fal's schema told us that this repo did not know

- **The endpoint's `resolution` enum is `480p, 720p, 1080p, 4k`.** Config has
  1080p off and no 4k at all.
- **1080p's deferral is now SUSPECT.** "It buys nothing over 720p" rested on SSIM
  0.958 against a **720p source measured back when nothing could actually ORDER
  720p** — every render silently took the provider default. An ordered 720p just
  turned out to be a genuine step up. One metered 1080p run settles it, and Paul
  has said he wants to sell the tier.

---

### 27. A CARD WAS CHARGED — ~~AND THE CREDITS HAVE NOT LANDED~~ **THEY HAVE. CLOSED 2026-08-25, MIDDAY.**

**A real test-mode payment succeeded end to end on Stripe's side.** `4242` card,
`$10.00`, on the test Price created the same day. **The webhook could not
reach this machine at first**, so nothing was granted — a two-word
configuration fault, not a defect in any code this repo owns. **It is fixed
and the demo is finished; see below.**

#### ~~FINISH IT WITH THIS — DO NOT PAY AGAIN~~ **FINISHED, NO SECOND PAYMENT**

> **THIS RECORD IS HISTORY AND THE COMMANDS NO LONGER BEHAVE THIS WAY.**
> Since 2026-08-26 the webhook grants credits only on an event that says it is
> live, and `evt_1U8IWT0WJAHtsKz6p8dOUVen` is a **test-mode** event — so
> replaying it today is answered `200` with `granted: false, ignored:
> 'testmode'` and moves nothing. **That is correct and deliberate**, not a
> regression: a test card costs its holder nothing while the credits it minted
> would buy real fal renders at real cost. The path below was genuinely proven
> when it ran; what proves it now is the test suite. See §28.

Three terminals, exactly as prescribed:

```bash
stripe listen --forward-to 127.0.0.1:3000/api/stripe/webhook   # terminal 1
npm run web                                                     # terminal 2
stripe events resend evt_1U8IWT0WJAHtsKz6p8dOUVen                # terminal 3
```

The startup banner printed the correct IPv4 forward command, exactly as the
fix below intended, and `.env`'s `STRIPE_WEBHOOK_SECRET` was hash-compared
against `stripe listen --print-secret` before starting anything: match.

**First delivery: the listener logged `[200]`.** `ps6475961@gmail.com`
(`e9eb3f5999235f3a7074b01766bdb9db`) went **42 → 82 credits**, with a new
ledger row `grant:pack:starter`, `ref: evt_1U8IWT0WJAHtsKz6p8dOUVen`.
Signature verification passed against a genuinely Stripe-signed delivery —
**the inbound half this section once called unproven is now proven.**

**Second resend of the SAME event: `[200]` again, and nothing moved** — no
new row, no credit change, balance held at 82, still 2 rows. **Idempotency is
proven against real Stripe redelivery**, not a synthetic fixture, which is
the one thing the test suite could not do for itself — the guard is at
`scripts/auth/credits.mjs:515`, inside the per-account lock.

**One thing worth a sentence so nobody misreads it later:** a replay still
REWRITES the account record. `updateAccount` (`scripts/auth/accounts.mjs:936`)
bumps `rev`/`updatedAt` unconditionally even when the ledger does not change,
so the file's hash changes on a no-op resend. Harmless today — recorded so a
changed hash is never mistaken for a double grant.

```bash
npm run accounts -- ledger e9eb3f5999235f3a7074b01766bdb9db
```

#### THE BUG: this server binds IPv4 and the Stripe CLI dials IPv6

```
--> checkout.session.completed [evt_1U8IWT0WJAHtsKz6p8dOUVen]
    [ERROR] Failed to POST: dial tcp [::1]:3000: connectex:
            No connection could be made because the target machine actively refused it.
```

`server-cli.mjs` defaults to `host: '127.0.0.1'`, so `server.listen` binds **IPv4
only**. On Windows the Stripe CLI resolves `localhost` to **`::1`** and does not
fall back to IPv4. **A browser on the same machine reaches the identical URL
perfectly**, which is what makes this so confusing: the checkout page worked, the
payment worked, and only the callback silently could not connect.

**Fixed by making it impossible to guess:** when a webhook secret is configured,
the startup banner now prints the exact command using the address the process
actually bound to.

```
  forward webhooks here (IPv4, NOT localhost -- the CLI resolves that to ::1):
    stripe listen --forward-to 127.0.0.1:3000/api/stripe/webhook
```

**`TIMESTAMP_PUBLIC_URL` stays `http://localhost:3000`** and that is not a
contradiction. It is where STRIPE SENDS THE BROWSER BACK TO, and the browser must
return to the same host it signed in on or the session cookie does not travel --
`localhost` and `127.0.0.1` are different hosts to a cookie jar. So: the browser
uses `localhost`, the CLI forwards to `127.0.0.1`, and both are right.

#### WHAT THE PAYMENT PROVED, and now it is the whole path

Everything this repo puts on a Checkout Session arrived at Stripe correctly.
Read back off the live event with `stripe events retrieve`:

| field | value |
|---|---|
| `payment_status` | **paid** |
| `amount_total` | `1000` USD |
| `mode` | `payment` — one-off, not a subscription |
| `client_reference_id` | `e9eb3f5999235f3a7074b01766bdb9db` |
| `metadata` | `{accountId, credits: "40", pack: "starter"}` |
| `livemode` | **false** |

So the outbound half is proven against the real API: the key authenticates, the
Price resolves, the account id rides on `client_reference_id`, and the credit
count the customer was promised is on the session where the webhook expects it.
**The inbound half is proven too, now** -- signature verification against a
genuinely Stripe-signed delivery, and the grant landing, both confirmed by the
resend above. Checkout, webhook signature, grant, and idempotent replay: the
whole path is proven end to end.

#### Two things noticed in passing

- **`adaptive_pricing: { enabled: true }`** is on the session. That is Stripe
  showing international customers a local currency, which means `amount_total`
  is not always USD and the ledger's credit count must never be derived from it.
  It is not: the count comes from `metadata.credits`. Worth knowing before
  anybody "improves" that.
- **The free grant of 42 credits is landing.** Both accounts created today --
  `plstnly06@gmail.com` and `ps6475961@gmail.com` -- opened on exactly 42, which
  is two 480p tapes at the measured price. Signup works.

#### The setup, for whoever does this next

`.env` needs three values and **none of them has to be typed by hand.** The
Stripe CLI already holds a `sk_test_` key from `stripe login`, and
`stripe listen --print-secret` yields the signing secret, so a script can move
both into `.env` without either ever appearing on a screen. One was written to
the scratchpad on 2026-08-25; **the resolver detail worth keeping is that on
Windows the CLI is an npm shim** -- `stripe.cmd`, no `.exe` -- so
`execFileSync('stripe')` fails with `ENOENT` on a machine where typing `stripe`
works. Resolve the real file and pass `shell: true` for a `.cmd`.

**The test Price is `price_1U8I1t0WJAHtsKz673YZyToR` on
`prod_V8ZAgOINl0TIkL`, `livemode: false`. It must not go live** -- section 25.

---

## Where things stand (2026-08-20, later the same day)

**The application is built end to end and it runs.** M1 the tape look, M2 the audio bed, M3 the preset catalog, and now the whole pipeline, the queue, the worker and the web app. ~500 tests. A photograph uploaded in a browser comes back as a finished 15-second tape without anything being typed at a terminal.

Verified by running it, not by reading it: **375 frames, 15.000000s, 1080x1920, yuv420p, mono AAC, -27.4 LUFS**, and the stored copy of the photograph contains zero EXIF/GPS bytes.

```bash
npm run web                              # terminal 1
npm run worker -- --provider=fixture     # terminal 2
```

`docs/running-the-app.md` is the operator guide; `docs/interfaces.md` is the module contract everything was built against and is the file to read before changing a signature.

**What is real and what is not.** The queue, the manifest, resume, moderation, intake, expansion, the look, the contract assertions and the web app are all real. `--provider=fixture` renders genuine stills and clips through ffmpeg for $0, so the *plumbing* is proven. **It says nothing about whether a model can put a specific person in a specific place recognisably from one photograph.** That is Phase 0, it is still unanswered, and it is the only question that decides whether this is a product. Keep the two claims apart.

**Since then (commits `cbc47c2`, `95c9227`): accounts, credits, the redesign, and the fal adapter.** 932 tests. Login, an append-only credit ledger, and a front end rebuilt to Paul's own portfolio layout — numbered steps, a place-photo carousel, an archive shelf, live cost, and **zero JavaScript** (CSS-only selection and background cross-fade). Seedance 2.0 is wired and verified off fal's schema pages; `generate_audio: false` is always sent, and **15 seconds arrives in ONE call**, so the last-frame seam that phase-0 criterion 5 worried about does not exist for this model.

~~**Next: the security review.**~~ **DONE 2026-08-21** — see START HERE at the top of this file, and the findings in `docs/security-review-2026-08-21.md`. The brief it was run against is still in `docs/security-review-brief.md` and is worth reading for its scope notes: there is no database, no SQL, no payment code, no npm dependencies and no client bundle, so several standard headings needed translating rather than answering.

**Then:** the still model (`fal/UNVERIFIED-identity-still` is deliberately the default so an unconfigured fal render stops at compose), place photographs, deployment, payments.

**Phase 0 remains the only thing that decides whether this is a product**, and it is still unrun.

**Two things that must be designed in from the first line or they become a rewrite:**
- **Nothing is request/response.** A 15s render is ~30s of ffmpeg *after* generation calls that take minutes. Job queue with durable state, status polling, result page — from the start. (RELIO §11.3 calls this the single most likely reason a 6-week build becomes 14.)
- **ffmpeg needs a real machine.** Vercel's serverless runtime has no ffmpeg binary and the entire look lives in ffmpeg. App and renderer are two processes talking through the queue, on day one.

**Still open, needs Paul:**
- **Phase 0 has not been run.** One still generated so far (scene adherence good — 15 of 17 elements). Needs five at rung 3 plus the two-person blind identity check. See `docs/phase-0-validation.md`.
- **Criterion 4** — Claude flagged twice that "model generates its own audio → disqualified" is too strict for Timestamp (we build our own bed and never map model audio). **Not changed without Paul's word.**
- ~~**No bundled font.**~~ **RESOLVED 2026-08-20.** Paul approved the download. `assets/fonts/tape-osd.ttf` is **VT323** (Peter Hull, SIL OFL 1.1, licence committed alongside at `assets/fonts/OFL.txt`). OFL permits bundling and redistribution inside a commercial product, so this is clean for a public app. `doctor` is green and renders reproduce across machines. Verified visually: the stamp draws and degrades *with* the image, which is the point.

---

## The split that is the whole architecture

"Looks like a tape" is two problems, and they are solved in two different places.

| Problem | Solved by | Why there |
|---|---|---|
| **Content** — a plausible person, place, outfit, motion | the generation provider | Models are good at this. |
| **Texture** — chroma bleed, grain, head-switch band, date stamp | `scripts/tapedeck/`, in ffmpeg | Models are *not* good at this. Ask one for "VHS 2003" and you get clean footage with a nostalgic mood, not tape artifacts. |

**Never ask the model for the look.** Every era cue in a prompt describes *content* — the cut of a jacket, a CRT in the corner, a car in the driveway. The moment a prompt says "grainy", "VHS", "old footage" or "film grain", it is doing `tapedeck`'s job badly and non-deterministically.

The payoff: **the look can be built and tuned for zero dollars**, against any clip, before a single paid call. That is why M1 comes before M5.

---

## Workflow

```bash
npm run doctor
npm run look -- --in=assets/stock/porch.mp4 --name=porch
npm run look -- --in=assets/stock/porch.mp4 --name=grain --sweep=tape.grainStrength=4,9,14,20
npm test
```

`npm run doctor` is a hard gate — run it before anything that spends. `npm run look` costs nothing and works on any clip.

---

## Money discipline

**`npm test` cannot spend money, and that is enforced four independent ways.** One guard is not enough, because the failure mode is a bill rather than a red test.

1. `providers/fal.mjs` has **no default** for `fetchImpl`. A test that forgets to inject one gets a `TypeError`, not a charge.
2. A test asserts the credential error is raised *before* any request is attempted. The failure **order** is itself under test.
3. `"test": "node --test"` is bare — it does **not** load `.env`. `FAL_KEY` is not in the process during a test run.
4. The only file permitted to spend is named `*-smoke.test.js` and self-skips unless `TIMESTAMP_LIVE=1`. One naming convention, one grep to audit.

**Never spend on a still you have not looked at.** The still is the identity anchor *and* the rejection gate. `--stop-after=select` exists so a human sees the contact sheet before video prices apply.

---

## Rulings that cost real time to establish

Each of these was measured, not assumed. Re-deriving one is pure waste.

**Higgsfield cannot serve a public Timestamp -- and the reason is narrower than this ruling first said.** The terms were read on 2026-08-24 (section 10). What they forbid is acting as a "pass-through or service bureau" and commercially exploiting **the Service**: one account rendering on behalf of many customers, with concurrency caps that are per-account rather than per-user. That is the generation BACKEND, and it is why the provider is fal.ai. What the same terms explicitly permit is **commercial use of Outputs, on any plan, sublicensable onward** -- so "personal experiments and nothing else" was too broad, and section 10 records the quotes. **The backend is closed; assets Paul generates himself are open.** Original reasoning: RELIO §11.6 (`C:\Users\pauls\RELIO\Reelio_Master_Document_v2.md`).

**Set the video model's native audio OFF.** Modern video models emit their own audio by default and it will fight the designed bed. Enforced in three layers — a required `nativeAudio: false` field, a provider-shape assertion, and an `ffprobe` check that the returned file has zero audio streams. Three layers for one boolean looks paranoid until a model version bump quietly re-enables it and you ship a week of videos with two ambiences arguing.

**The grade runs in RGB and the tape stage runs in YUV, and the boundary between them must be stated.** `curves` and `colorbalance` are RGB filters, so ffmpeg silently auto-inserts a conversion and *everything downstream of the grade inherits `rgb24`* unless you pin it. That is wrong twice over. The tape stage is defined in terms of chroma — `gblur=planes=6` means "planes 1 and 2", which in RGB are **blue and red**, so the signature chroma smear was quietly blurring colour channels instead of chroma and `chromashift` was a no-op. Then each transport `overlay` round-tripped through overlay's own `yuv420` working format and the accumulated range mismatch **crushed mean luma from 133 to 26** — a five-fold darkening, with no error and no warning. The single `format=yuv420p` after `eq` is what makes the graph say what it means instead of depending on negotiation. There is a test that asserts its position; do not remove it.

**On Windows, `openSync(path,'wx')` is the ONLY exclusive filesystem primitive. `unlink` and `rename` are not, and they look like they are.** Measured on this machine, 16 threads released through one barrier onto one file: exclusive create produced exactly one winner in **120 of 120** rounds; `unlinkSync` produced the wrong number in **120 of 120**, usually with *all sixteen* reporting success; `renameSync` in **60 of 60**, with all 960 calls returning success. libuv implements both as open-then-act, and setting a delete disposition — or renaming through a handle you already hold — is not an error just because someone else did it first. Any "who won?" decision must be an exclusive create of the destination. The queue's `claim()` was always right; `reapExpired()` was not, and picking its winner by whose `unlink` returned true reported one job twice **and lost another entirely** — the loser deleted the pending entry it had written as a "duplicate" when it was the only one, and the job vanished from pending, claimed, done and failed at once while every count still looked plausible. `reapExpired()` runs on every worker startup, so this is not an exotic path.

**A test whose timing margin is narrower than the machine's variance tests the machine, not the code.** `npm test` runs test *files* in parallel, so any ffmpeg inside a test competes with every other ffmpeg in the suite. Two tests were written with fixed wall-clock budgets and both failed under full load while passing in isolation — one measured 1008ms against a 900ms budget, then 9.78s against a widened 6s one. Fixes that hold: assert a **proportion** of the nominal value rather than an absolute (`elapsed < latencyMs/2`), and where a test needs a background thread to have done work, have that thread **publish its progress** so the foreground can wait for it instead of assuming it was scheduled. Related failure shape: a concurrent-reader test reported `reads: 0` — the reader was never scheduled at all, so its real assertion could not fail, and the run looked like a defect when it proved nothing.

**`vignette` is far stronger than its angle suggests, and it is applied twice.** Measured against a mid-grey source: `PI/4.3` costs **45%** of mean luma, `PI/12` costs 20%, and even `PI/20` still costs 18% — there is no "subtle" setting. It runs once as lens falloff and once over the whole canvas as the unifier, so the losses compound. `grade.curveMaster` carries the compensation. **Re-measure before raising either angle**, or the picture goes muddy and the grade gets blamed.

**`gblur` is nondeterministic on short frames.** Measured on this machine: applied to a 12-row strip it produced 6 different outputs in 6 runs. It is slice-threaded, and when frame height approaches the core count the IIR state at slice boundaries varies per run. Use **`avgblur`** on the head-switch band, and pass **`-filter_complex_threads 1`** globally. Full-frame `gblur` is safe and thread-count independent. A 2-run purity check would have passed this bug — **the purity test runs 5 times minimum.**

**Bloom happens in `gbrp`, never `yuv420p`.** `blend=all_mode=screen` in YUV screens the chroma planes too; neutral 128 becomes 191, so saturation goes **up** 16% — backwards, since real halation *desaturates* blown highlights. Measured `SATAVG`: 142.0 in YUV, 126.9 in RGB, identical luma.

**The date stamp must degrade with the image.** A real camcorder's character generator wrote the date into the signal *before* the tape, so the stamp suffered chroma bleed, grain and softness like everything else — but never lens artifacts, because it was added after the glass. `drawtext` therefore goes **after** the grade and **before** the tape stage. A crisp 1080p date over a degraded image is the single most common tell of a fake VHS filter.

**Grain before the upscale, never after.** Grain at 720x576 then scaled to 1080 gives coarse clumps larger than a pixel — tape. The same filter with the same parameters applied at 1080 gives fine per-pixel noise — a modern sensor at high ISO, the wrong decade entirely.

**No per-pixel `blend` expressions.** A radial `blend=all_expr=` cost 18.0s of a 22s render — 82% of the time in one filter. Precompute the mask as one static frame with `geq` + `maskedmerge`: 23x faster, same result. Do **not** use `loop` to repeat the mask; it floods `non monotonically increasing dts`. Emit one frame and let framesync `repeatlast` hold it.

---

## Determinism is a property, not an intention

**Same inputs must produce the same bytes.** Everything below breaks that, silently.

| Trap | Reality |
|---|---|
| `%{localtime}` / `expansion=strftime` in `drawtext` | Reads the wall clock. Also deprecated in this ffmpeg build. Compute the string in Node from the seed and pass a literal. |
| `anoisesrc` without `seed=` | Defaults to `-1`, which is random. Must always be set. |
| `gradients` filter | Every colour defaults to `random`. One reason the surround is a flat `color=c=0x0B0A09`. |
| `amix` without `normalize=0` | Default `1` divides by input count and silently scales away every level you set. |
| `loudnorm` at render time | Single-pass applies *dynamic*, content-dependent gain. The bed is synthesised, so its level is known a priori — use fixed gains and let `ebur128` **assert** the target rather than reach it. |
| A system font path | Machine-dependent. The bundled `assets/fonts/tape-osd.ttf` is what makes purity hold across machines. |

Verify with the real test, not by eye — and note it runs **five times, not two**:

```bash
npm test -- --test-name-pattern=purity
```

---

## ffmpeg rules

**Never build the command as a shell string.** Filtergraphs contain brackets, quotes, commas and semicolons — every one mangled differently by cmd.exe and PowerShell. Always `spawn(bin, argsArray)`. `scripts/ffmpeg/run.mjs` is the **only** module in this repo permitted to spawn a process.

**Spawn with `cwd` set to the repo root and keep the font path relative** with forward slashes. No drive letter means no colon means no `fontfile=` escaping problem at all. `ffFontPath()` handles the absolute-path fallback, but the bundled relative path is the supported route.

**`tapedeck/` and `audio/` are pure builders.** They return filtergraph strings and argv arrays and they never touch the filesystem or spawn anything. This is the highest-leverage boundary in the codebase: it makes ~90% of the look unit-testable with golden strings and no ffmpeg at all, and it lets video and audio join in **one** invocation instead of two. Two passes means a double encode — real generation loss on top of a look that is already about degradation.

---

## The output contract

PAL, because a 2003 camcorder tape in Germany was PAL, and because the arithmetic is honest.

| Property | Value | Why |
|---|---|---|
| Tape raster | 720x576, SAR 16/15 → DAR 4:3 | What the format actually was |
| Frame rate | 25 fps | 25 x 15 = **exactly 375 frames**. At 29.97 it is 449.55 — not an integer, so "15.000s" would be a rounding argument instead of an assertion. |
| Duration | exactly 15.000 s / 375 frames | Asserted, not hoped |
| Delivery | 1080x1920, tape image 1080x810 centred on `#0B0A09` | Honest 4:3 optics, native for phones. **Paul asked on 2026-08-21 for 4:3, 9:16 and 16:9 with the picture FILLING the frame, which deletes the surround. Planned, not built: `docs/aspect-ratios-plan.md`.** |
| Audio | mono, 190 Hz - 8 kHz, **-27 LUFS** | Deliberately far below the -14 platforms normalise to. This bed is texture, not dialogue. "Quiet" is a literal spec. |

**Not pure black for the surround.** `#000000` makes the tape look like a sticker on a void, and on an OLED phone it vanishes entirely so the 4:3 framing reads as a cropping accident rather than a choice. `#0B0A09` reads as a dark surface the image sits on. The final `vignette` over the *whole* 1080x1920 canvas is what fuses tape and surround into one photographed object instead of two layers.

---

## Prompt rules

**A prompt must never describe the person.** The photo is the identity anchor. Every adjective about face, build, hair or age is a competing description the model blends toward, and blending is exactly the failure mode — "it looks like my cousin". `composeStillPrompt` takes no subject description at all; it says "the person in the reference image" once and then talks only about place, wardrobe, light, lens and era.

**Outfits describe only what is on the body. Places describe everything else** — scene, light, lens, era props, weather. Without that split the two fragments fight and you get a parka on a beach lit like a beach. The schema enforces it; a preset that breaks it fails CI, not a render.

### Scope change, 2026-08-20 — the menu is no longer a gate

Paul's stated vision: **anyone uploads any photo, gives a location and an outfit, and gets a video.** The simplicity is the product. That supersedes the earlier "curated presets only" decision, and it changes three things:

- **The 8 places and 6 outfits become recommendations**, not the whole menu. Free input is the norm; we refuse as rarely as possible.
- **Users may upload a photo of the place** as a second reference image alongside their face — not just type it. "Your actual childhood garden" is the strongest version of this product and no preset-menu competitor can match it.
- **M3's hand-written fragments are not wasted.** They become the recommendations *and* the quality template that free text is expanded into. A new `expand` stage turns "a beach" into the same eight-line shape — scene, light, lens, framing, props, era — that a hand-written place has. The three prompt rules above survive intact and apply to expanded text exactly as they do to a shipped preset; that is what keeps this tractable.

**Consequently these stop being deferrable:** input moderation (free text plus a place photo, producing an image of a real person's face, is this product's highest-risk surface — including prompt injection, since user text lands inside our prompt), the face gate at intake, a consent gate, retention limits, and a takedown path.

**EXIF/GPS stripping moves from hygiene to load-bearing.** A photo of a place carries its exact coordinates. Someone uploading their childhood garden is handing over its location.

---

## Common mistakes

- **Editing a preset and expecting old renders to still reproduce.** They will not, unless the manifest's frozen `resolved` block is intact. That block is why "reproducible" is a property rather than a word. Never strip it to tidy up a manifest.
- **Adding a still scorer.** Ranking without a face-similarity metric optimises for the wrong thing — a sharp, well-lit stranger beats a soft likeness on every heuristic computable locally. The `scorer` seam exists; `firstScorer` is the only shipped implementation until there is a real embedding model behind it.
- **Retrying a generation without an idempotency key.** The `intent` record is written *before* the HTTP request for exactly this reason. It is four lines and it is the whole difference between "we might have double-charged, who knows" and a named step with a timestamp.
- **Treating `config/pricing.json` as fact.** Every entry is an ESTIMATE until a real invoice proves it. If actual diverges from estimated by more than 15%, `npm run ledger` says so by name — and as of 2026-08-24 **that command exists and works** (section 21). What it cannot do is invent the number: `cost.actual` is still `null` on every job ever run, because fal's queue response carries no price. Somebody has to read the billing page and type it in.
- **Reaching for `sharp` or a face detector.** ffmpeg is already a hard dependency and autorotates from EXIF by default. This repo ships with essentially zero native dependencies and that is worth protecting.
- **Reading ffmpeg's failure from the last line of stderr.** The last line is usually a generic trailer (`Error : Invalid argument`); the line that says what actually happened sits several lines above it. `lastMeaningfulLine()` prefers the specific one. Related: Windows reports negative exit codes as their unsigned wrap, so `-22` arrives as `4294967274` — `normalizeExitCode()` undoes that.
- **Substring-matching filter names.** `"avgblur"` contains `"gblur"`. A test asserting `!/gblur=/` on the head-switch chain fails against the very `avgblur` that fixes the determinism bug. Anchor filter-name checks to a boundary: `/(^|,)gblur=/`.
- **`-map_metadata -1` does not strip EXIF from a PNG.** It clears container metadata but not frame side data, and the PNG encoder writes an `eXIf` chunk straight back out of it — measured: a "stripped" PNG came back out of `ffprobe` still carrying `GPSLatitude`. `intake/photo.mjs` pins `-c:v mjpeg` rather than letting the destination extension pick the encoder. Related: **a JPEG's EXIF is not in `format_tags` or `stream_tags`**, so asserting on those two sections passes against a completely untouched file. Check frame tags and side data too, plus a raw byte-grep for `Exif`/`GPS`.
- **Assuming the same word list should have the same consequence everywhere.** `BANNED` is shared between presets and user text on purpose, but a hit means different things: a preset *is* prompt text, so a hit is an authoring bug and CI should fail; user free text is an *input to expansion* that never reaches the model verbatim, so a hit is a warning and the words get stripped. Refusing on user text rejected "my old school playground" and "jumpers for goalposts" — 3% of a realistic corpus, concentrated entirely on the memories the product exists to serve.
- **Piping `npm test` into `tail` or `head` reports the pipe's exit code, not the runner's.** A suite with a failing test exits `0` and the summary lines still say what you hoped. Redirect to a file and check `$?`.
- **Reading a job's chosen still from `intent/animate.json`.** That is the *last* segment's receipt, and every segment after the first starts from the previous clip's final frame, so it never names a still. The chosen still is in the rotated receipt for segment 1 — `intent/animate.1.json`.
- **Editing CSS and expecting to see it.** The stylesheet is memoised in `sheetCache` at `server.mjs` AND served `Cache-Control: public, max-age=300`. A CSS change needs a **server restart and a hard refresh**; without both you will be looking at the old bytes and debugging the wrong thing. Cost 20 minutes on 2026-08-21.
- **`taskkill /F /IM node.exe` to stop the server.** Claude Code is a node process. Kill by PID: `netstat -ano | grep ":3000.*LISTENING"`. Related: stopping an `npm run web` background task kills the npm wrapper and **leaves the node child holding the port**, so the restart fails `EADDRINUSE` and the old code keeps serving.
- **Backticks inside a comment that sits inside a JS template literal.** `static.mjs`'s `BASE_CSS` and the HTML blocks in `views.mjs` are template literals, so a comment mentioning `` `style-src 'self'` `` terminates the string and the file stops parsing — or worse, parses as a tagged template and throws `X is not a function` from a line nowhere near the edit. Cost two rounds on 2026-08-21 and **THREE MORE on 2026-08-23** — it is the single most repeated mistake in this codebase. Use plain quotes inside those comments, and **run `node --check scripts/web/static.mjs` after every edit to that file**. Never chain it as "check && kill-the-server": a failed check short-circuits the kill, the OLD server keeps the port and keeps serving stale CSS, and the next thing you measure will be the old bytes. That compounds with the cache trap two bullets down — a CSS change needs a server restart AND a browser hard refresh, and on 2026-08-23 the measured card size was still the old one for exactly that reason.
- **A signed shift on a hash.** `hash32` returns `h >>> 0`, so any value above 2^31 makes `h >> 5` **negative**, and a negative left operand makes `%` return a negative remainder — which subtracts from a floor instead of adding to it. It had been quietly desaturating whichever place cards happened to hash high, invisibly, because "muddier than intended" looks exactly like a design decision. Always `>>>` on a hash.

---

### 28. THE FIX ORDER, WORKED 2026-08-25/26 — eight commits, what each DOES

The review's own section 3 order, one commit each, strict test-first: every
change began as a failing test that failed for the stated reason. This section
says what the code now does; the WHY of each lives in the review, on this
machine, and is not restated here. **The findings the fix order did not cover
are still open — including one that arms on the next `config/models.json`
edit.**

**PUSHED 2026-08-26 to `origin/ui-redesign-signed-in-page`** (`6efb0e6..2464b35`,
plus `2464b35..HEAD` for the documentation pass). Before the push: all five
`guards.yml` checks were run locally and pass, and every outgoing commit
message and added line was grepped for finding identifiers — zero hits, because
a fix is described here by what it does and never by the hole it closed. **The
push is the irreversible line on a public repo; run those checks before the
next one.**

1. **`2305e81` — only a live-mode Stripe event grants credits.** The webhook
   checks the event's own mode immediately after signature verification;
   absence counts as not-live. A test-mode event is answered 200,
   `ignored: 'testmode'`, and grants nothing — which means **local `stripe
   listen` demos no longer land credits**; the grant path is proven by the
   test suite instead.
2. **`7245279` — password work is async, and knocking is metered.** Every
   scrypt derivation now runs on the threadpool: `hashPassword`,
   `verifyPassword`, `authenticate`, `createAccount` are **async — await
   them**. And `/login` and `/signup` are limited per client address (10
   attempts/minute and 10 accounts/hour — `AUTH_RATE_LIMITS`, exported from
   `server.mjs`; the limiter is `scripts/web/rate-limit.mjs`), keyed on the
   socket address and never a header, answered 429 + `Retry-After`.
3. **`5dae6d5` — every password costs the same time to refuse**, whatever its
   length, on both the known- and unknown-address branches. The four-cell
   matrix test in `auth-accounts.test.js` pins it as a proportion with
   interleaved samples.
4. **`51aafa5` — signing in takes this site's own form.** `POST /login` and
   `/signup` demand a signed double-submit pair (cookie `timestamp_csrf` +
   hidden `csrf` field, minted in `session-middleware.mjs`), refuse posts
   naming a foreign `Origin`, and the nav names the signed-in email on every
   page. **ANY TEST THAT POSTS CREDENTIALS MUST FETCH THE FORM FIRST** — every
   web test file has a `csrfPair`/`signIn` helper that does the GET-then-POST
   dance; copy it, do not post bare.
5. **`4e80fe8` — the fal credential is scoped to the queue host, enforced.**
   An authorized request whose target is any other allow-listed host is
   refused before a socket opens, whatever a response body's `status_url`
   said.
6. **`a1fc67f` — a job that ends without a tape gives back what it never
   spent.** The worker consults a refund seam on the attempt that makes a
   failure final and on cancellation; the glue (`createOwnerRefunds`,
   `session-middleware.mjs`) walks `out/owners` back to the payer and
   `refundIfUnspent` decides from the manifest's steps. The web cancel
   handler's direct path refunds the same way. A missed refund prints
   `REFUND MISSED ... credit it by hand` in the worker terminal. The CLI
   wiring is pinned by a source-reading test.
7. **`9e52e14` — the deployment headers.** `script-src` names the two shipped
   inline scripts BY HASH — they live as constants in `views.mjs` next to
   `INLINE_SCRIPT_HASHES`, so **a third `<script>` added anywhere else is
   killed by the CSP and by the test that hashes what pages actually ship**.
   `sendFile` (the path serving user-influenced bytes) sends nosniff +
   `default-src 'none'`. Everything sends `Referrer-Policy: no-referrer`
   (a `/j/<id>` url must never ride out in a Referer), same-origin CORP, and
   HSTS; pages add COOP and a Permissions-Policy that renounces the camera.
8. **`becb112` — `x-forwarded-proto` is believed only when the operator says
   so.** `TIMESTAMP_TRUST_PROXY=1` (documented in `.env.example`) is Paul's
   chosen design (2026-08-26): default never, opt in the day a
   TLS-terminating proxy actually exists. One test was changed deliberately
   with his sign-off — it pinned the old header-trusting behaviour by name.

---

## Not in scope

~~**Billing.** Accounts, credits, Stripe, rate limits.~~ **ALL FOUR ARE BUILT
and this line is kept only so nobody cites it.** Accounts and the credit ledger
shipped 2026-08-20, Stripe checkout and the webhook 2026-08-25 (§25, §27), and
per-address rate limiting on the two credential routes 2026-08-26 (§28). What
is still true is the spirit: **nothing here takes a card number**, and checkout
is hosted on the provider's own domain.

~~The web app~~ — **no longer out of scope.** Paul reordered on 2026-08-20: build the app end to end with generation stubbed, *then* uploads, *then* real video APIs. See "Where things stand" at the top.

~~Face detection at intake~~ — **no longer deferrable.** It was deferred for a CLI Paul ran on his own photos. The product takes uploads from strangers, so it is required, along with the consent gate, retention limits and takedown path.

**A second paid provider.** `fixtureProvider` is a genuinely different implementation exercised by the same conformance test, which is what makes the interface an abstraction rather than a wrapper with optimism. Replicate would buy vendor-risk insurance, not interface validation.
