# Timestamp

One photo, one place, one outfit — fifteen seconds that look like a camcorder tape from 2003.
Warm, grainy, quiet.

**Engine:** `C:\Users\pauls\Timestamp` · **Stack:** Node 22+, ESM, `node --test`, npm · **Conventions:** mirrored from `C:\Users\pauls\Ad-Regenerator`

---

## START HERE (2026-08-22) - public repo, CI live, two specs waiting on you

**991 tests / 989 pass / 0 fail / 2 skipped** (the skips are the `*-smoke.test.js`
money guards, which self-skip without `TIMESTAMP_LIVE=1`).
**Everything is committed and pushed.** `HEAD == origin/main == 50c5752`.

**The repo is PUBLIC: https://github.com/PaulStanley0211/timestamp**
`out/` is gitignored (0 tracked files - no faces, accounts, sessions or ledger),
`.env` is gitignored, and **both security-review docs are gitignored on purpose**
- see section 2. History was audited before the first push: `out/` and `.env`
were never committed at any point.

```bash
npm run web                              # terminal 1
npm run worker -- --provider=fixture     # terminal 2
# sign in as dev@example.com / timestamp-dev-password
```
`paul@example.com` cannot be signed into - scrypt hash, no reset endpoint, no
`set-password` in the CLI. Use the dev account or make another.

---

### 1. THE THREE THINGS BLOCKING EVERYTHING, all needing Paul

1. **`FAL_KEY` in `.env`.** Still does not exist. **$10 is enough.** Paul is
   paying for fal credit and will paste the key into `.env` HIMSELF - never into
   chat. `npm run doctor` confirms it is loaded and prints only the literal
   string `present` (`doctor.mjs:131` is a `Boolean()` check, verified).
2. **A photo at `assets/test-photos/face.jpg`.** Still empty. Front-ish, one
   face, good light, 1024px+ short edge. **Never a stock/AI face or a
   celebrity** - no ground truth in the first case, memorisation flattering the
   result in the second.
3. **The still model is unchosen.** `config/models.json` defaults to
   `fal/UNVERIFIED-identity-still` deliberately, so an unconfigured fal render
   **stops at compose instead of spending**. Three candidates, all
   `verified: false`, all assessed from catalogue pages only: `fal-ai/uso`
   (identity preservation is its advertised job - closest in purpose),
   `fal-ai/bytedance/seedream/v4.5/edit` (~$0.04/edit), and
   `fal-ai/nano-banana-pro/edit`. **Suggested: run one prompt through all three
   - that is cents, and it replaces "the model page says so" with evidence.**

**Phase 0 is still unrun and still the only thing that decides whether this is a
product.** It also needs two people who know Paul for the blind "who is this?"
check. `docs/phase-0-validation.md` is the procedure.

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

### 6. IN FLIGHT, UNFINISHED - the UI redesign

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

### 6a. THE REDESIGN IS DONE - 2026-08-22, uncommitted, 991/989/0

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

1. **Phase 0**, the moment the key and the photo exist. Nothing else answers
   whether this is a product.
2. ~~**The UI redesign**~~ **DONE 2026-08-22, uncommitted - see section 6a.**
3. **The Supabase spec**, then a plan, then code. Not before.
4. **The four sources of CI red** (section 4).
5. **Three aspect ratios** - `docs/aspect-ratios-plan.md`, planned, not started.
6. **The rest of the security report** - local file only.

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
- **Backticks inside a comment that sits inside a JS template literal.** `static.mjs`'s `BASE_CSS` and the HTML blocks in `views.mjs` are template literals, so a comment mentioning `` `style-src 'self'` `` terminates the string and the file stops parsing — or worse, parses as a tagged template and throws `X is not a function` from a line nowhere near the edit. Cost two rounds on 2026-08-21. Use plain quotes inside those comments.
- **A signed shift on a hash.** `hash32` returns `h >>> 0`, so any value above 2^31 makes `h >> 5` **negative**, and a negative left operand makes `%` return a negative remainder — which subtracts from a floor instead of adding to it. It had been quietly desaturating whichever place cards happened to hash high, invisibly, because "muddier than intended" looks exactly like a design decision. Always `>>>` on a hash.

---

## Not in scope

**Billing.** Accounts, credits, Stripe, rate limits. Not until the thing works and Phase 0 has an answer.

~~The web app~~ — **no longer out of scope.** Paul reordered on 2026-08-20: build the app end to end with generation stubbed, *then* uploads, *then* real video APIs. See "Where things stand" at the top.

~~Face detection at intake~~ — **no longer deferrable.** It was deferred for a CLI Paul ran on his own photos. The product takes uploads from strangers, so it is required, along with the consent gate, retention limits and takedown path.

**A second paid provider.** `fixtureProvider` is a genuinely different implementation exercised by the same conformance test, which is what makes the interface an abstraction rather than a wrapper with optimism. Replicate would buy vendor-risk insurance, not interface validation.
