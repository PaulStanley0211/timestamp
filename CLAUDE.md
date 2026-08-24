# Timestamp

One photo, one place, one outfit — fifteen seconds that look like a camcorder tape from 2003.
Warm, grainy, quiet.

**Engine:** `C:\Users\pauls\Timestamp` · **Stack:** Node 22+, ESM, `node --test`, npm · **Conventions:** mirrored from `C:\Users\pauls\Ad-Regenerator`

---

## START HERE (2026-08-24) - the bake-off is HALF ANSWERED

**1010 tests / 1008 pass / 0 fail / 2 skipped** (the skips are the
`*-smoke.test.js` money guards, which self-skip without `TIMESTAMP_LIVE=1`).

**THE TREE IS CLEAN AND NOTHING IS PUSHED.** `origin/main == b6f64a3`. Branch
`ui-redesign-signed-in-page` is **five commits ahead**:

```
e7e8557  The eight place photographs
db4e3c5  Replace the visual world: STRUCK, on both surfaces
b2f213d  Write the visible: the motion prompt gets the craft rules
3162e19  Three user-selectable frame shapes, and the paid path's first real run
ca2b912  Give the signed-in page a subject and three panel weights
```

**THE ONE LIVE QUESTION: does seedream hold Paul's likeness?** He ran it for
real on 2026-08-24 (job `20260824-093906-d39675`, ~$0.04 estimated, not metered)
and **has not given a verdict yet.** Everything else below is settled.

### What seedream proved, objectively

- **Reference field is `image_urls`** -- accepted with no 422, unlike `uso`
  which demanded `input_image_urls`. Recorded in `config/models.json`.
- **Aspect control HOLDS.** `aspect_ratio: '4:3'` was sent, 2560x1920 came back,
  which is exactly 4:3. **This is the check `uso` failed at 5:4.**
- **The raster is NOT honoured.** 640x480 ordered, 2560x1920 returned -- 16x the
  pixels. Harmless (the tape raster is 736x588, so headroom not waste) but the
  $0.04 may be quoted for a different size. ESTIMATE until a `--meter` run.
- **Scene adherence EXCELLENT** -- every named prop, light direction correct,
  exactly one person, wardrobe down to the chest crest.
- **The framing clause was IGNORED.** "waist-up, three-quarters" was asked for;
  full-body front-on came back. Matters more once the still is hidden, because
  framing then becomes the model's decision alone.
- The two features `uso` dropped -- the beard and the tight curls -- are both
  present. **That is an observation about the image, NOT a verdict on
  resemblance. Only Paul can call that and he has not.**

### The next two moves, in order

1. **Paul's verdict on the face**, then the blind check: text the image to two
   people who know him with "Who is this?" and NOTHING else. **Not the friend he
   primed** by saying it was not AI generated.
2. **Run the third candidate before choosing** -- the repo's own rule is not to
   run five stills on any model until all three have been tried once:

```
node --env-file-if-exists=.env scripts/render/render.mjs --photo=assets/test-photos/face.jpg --place=schrebergarten-august --outfit=trainingsjacke --consent --provider=fal --still-model=fal-ai/nano-banana-pro/edit --allow-unverified-model --stills=1 --stop-after=select
```

**CLAUDE CANNOT RUN PAID COMMANDS.** Paul pastes them and pastes the output back.

### What shipped 2026-08-24 (see sections 13-15)

- **THREE FRAME SHAPES: 4:3, 16:9, 9:16** -- section 13.
- **The motion prompt was rewritten** to craft rules -- section 14.
- **THE VISUAL WORLD WAS REPLACED. It is called STRUCK** -- section 15.
  **`DESIGN.md` and `PRODUCT.md` are NEW, in the repo, and authoritative.**

### Open, and none of it blocking the bake-off

- **19 of 20 keyboard stops have NO visible focus indicator** -- WCAG 2.4.7,
  **Level A**. The hoisted `.statehook` radios are 1x1px with
  `clip-path: inset(50%)`, so the global `:focus-visible` outline paints
  nothing. Section 6b's "0 violations across 12 focusables" UNDERCOUNTED: the
  page has ~34 focusables and the hoisted radios sat outside `.wrap`.
- **The Higgsfield licence question is STILL unanswered** and
  `assets/places/` is now COMMITTED (Paul said "commit everything" twice after
  being told twice). **Nothing is pushed, and the push is the irreversible line,
  not the commit.** Settle it before this branch goes up. Section 10.
- **The worker still cannot spend** -- `worker-cli.mjs` passes no transport, so
  the web app's renderer cannot reach the network. CLI only. Section 8, bug 1.
- **The paid path renders 4:3 ONLY** and refuses the other two shapes loudly --
  section 13.
- **Login, signup, status, result and pricing still wear the superseded
  frost-and-amber world** and now clash with the landing and app pages.

```bash
npm run web                              # terminal 1
npm run worker -- --provider=fixture     # terminal 2
# sign in as dev@example.com / timestamp-dev-password
```
`paul@example.com` cannot be signed into - scrypt hash, no reset endpoint.

**The repo is PUBLIC: https://github.com/PaulStanley0211/timestamp**
`out/`, `.env` and `assets/test-photos/` are gitignored. Both security-review
docs stay gitignored on purpose - section 2.

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
- **`2026-08-21-stripe-subscriptions-design.md` - current, approved, not
  started.** Two guards against double payout, the raw-body signature trap
  (`server.mjs` already parses bodies - a reserialise breaks every signature),
  replay window vs idempotency as separate concerns.
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
It was not touched. **That makes the security note describing `script-src
'unsafe-inline'` as sitting "in an app with zero scripts" STALE**, which changes
how that finding should be judged when the rest of the report is worked through.

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
4. **Commit and push.** One branch plus a dirty tree; see START HERE.
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
**THE WORKER HAS THE SAME HOLE AND IT IS NOT FIXED** - `worker.mjs` accepts
`providerCtx` but `worker-cli.mjs` passes no transport, so the web app's renderer
cannot spend either. Fix it the same way before the app goes live.

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

**A LICENCE QUESTION WAS RAISED AND NOT ANSWERED.** This file's own ruling says
Higgsfield is "personal experiments and nothing else", because reselling its
output through a paid app is outside consumer terms. That ruling was written
about **per-user generation**; static brand assets are a different question it
does not cleanly cover. **But these ship inside a commercial product and are
committed to a PUBLIC repo.** Paul was told and has not come back on it. **Do not
treat this as settled.**

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
16:9 at 1024x576 is FEWER pixels than 4:3 720p.

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

---
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

**Higgsfield cannot serve a public Timestamp.** The access is a *consumer creator subscription*; reselling its output through a paid app is outside consumer terms, and its concurrency caps are per-account, not per-user. This is RELIO §11.6 (`C:\Users\pauls\RELIO\Reelio_Master_Document_v2.md`). It is why the provider is fal.ai. Higgsfield stays available for personal experiments and for nothing else.

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
- **Treating `config/pricing.json` as fact.** Every entry is an ESTIMATE until a `--meter` run proves it. If actual diverges from estimated by more than 15%, `npm run ledger` would say so by name — except **`scripts/render/ledger-cli.mjs` does not exist**, so that command fails. Building it matters the moment real spending starts.
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

## Not in scope

**Billing.** Accounts, credits, Stripe, rate limits. Not until the thing works and Phase 0 has an answer.

~~The web app~~ — **no longer out of scope.** Paul reordered on 2026-08-20: build the app end to end with generation stubbed, *then* uploads, *then* real video APIs. See "Where things stand" at the top.

~~Face detection at intake~~ — **no longer deferrable.** It was deferred for a CLI Paul ran on his own photos. The product takes uploads from strangers, so it is required, along with the consent gate, retention limits and takedown path.

**A second paid provider.** `fixtureProvider` is a genuinely different implementation exercised by the same conformance test, which is what makes the interface an abstraction rather than a wrapper with optimism. Replicate would buy vendor-risk insurance, not interface validation.
