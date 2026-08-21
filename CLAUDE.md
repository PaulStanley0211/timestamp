# Timestamp

One photo, one place, one outfit — fifteen seconds that look like a camcorder tape from 2003.
Warm, grainy, quiet.

**Engine:** `C:\Users\pauls\Timestamp` · **Stack:** Node 22+, ESM, `node --test`, npm · **Conventions:** mirrored from `C:\Users\pauls\Ad-Regenerator`

---

## START HERE (2026-08-21) — retention shipped; F1/F2 closed

**981 tests, 979 pass, 0 fail, 2 skipped** (the skips are the `*-smoke.test.js`
money guards, which self-skip without `TIMESTAMP_LIVE=1`). Everything below is
uncommitted work sitting on top of `9bc24ea`.

```bash
npm run web                              # terminal 1
npm run worker -- --provider=fixture     # terminal 2
# sign in as dev@example.com / timestamp-dev-password   (created 2026-08-21, plan: shelf)
```

**`paul@example.com` cannot be signed into.** Its password is a scrypt hash,
there is no reset endpoint and `accounts-cli` has no `set-password`. Use the dev
account above, or make another.

### 1. The security review is finished — `docs/security-review-2026-08-21.md`

Run against the brief in `docs/security-review-brief.md`. **Cross-tenant
isolation holds** — all ten job routes go through one `ownedJob` check in the
order shape → ownership → disk, and not-yours is byte-identical to not-there.
Re-derived independently in `test/tenant-isolation.test.js` (14 tests: method,
role, body, URL/encoding tampering). No gap found.

**F1 and F2 are FIXED (2026-08-21).** Paul confirmed the policy is **7 days for
the photo, 30 for the finished video** — exactly what the consent text already
promised. What shipped:

- **`scripts/render/purge.mjs`** — `planPurge` / `executePurge` to the signature
  `docs/interfaces.md` §10 had already specified, `dryRun: true` by default,
  plus `purgeJobMedia` for the on-request path.
- **`npm run purge` runs.** Prints the plan; deletes nothing without `--apply`.
- **The sweep is scheduled in the worker** — `sweepRetention()` at startup and
  hourly, beside `reapExpired()`, so the promise does not depend on a crontab
  anybody has to remember. `retention: null` disables it; a worker with no
  `cfg.retention` sweeps nothing rather than inventing a policy.
- **`DELETE /api/jobs/:id` deletes the video, stills, contact sheet, segments,
  source and poster**, not just `input/`. The manifest survives as the record.
- **The `202` path is honoured** — the worker performs the purge when it sees
  the cancel sentinel at a step boundary, so `202` means "will be deleted".
- **Two drift guards**, both proved to fail when their target is mutated:
  `consentText()`'s numbers must equal `config/render.json`'s retention block,
  and the web layer must write ownership entries where purge looks for them.

**Age is measured from `createdAt`, never `updatedAt`** — `updatedAt` is
restamped by every `saveJob`, so a retried job would push its own deletion date
forward forever. Documented at the top of `purge.mjs`; do not "improve" it.

**A live lease beats age.** The worker's sweep skips any job with an unexpired
claim. The case that forced it: a job old enough to be due, claimed for the
*first* time today — the unguarded sweep deleted the directory out from under
its own render, and the test that caught it did so on the first run. Deferred,
not spared; the next sweep after the lease is released takes it.

**`npm run ledger` still fails and that is deliberate.** `scripts/render/ledger.mjs`
is *cost reconciliation* (manifest actuals vs `config/pricing.json`), not the
credit ledger, and it is waiting on real spend — every price in the repo is an
estimate today. The credit ledger is built: `npm run accounts -- ledger`.
**The remaining findings are NOT listed in this file, on purpose.** F3 and the
rest of the open items — each with evidence, impact, a fix and a regression test
— live in `docs/security-review-2026-08-21.md`, which is **gitignored and stays
on this machine**. This repo is public, and an accurate list of a system's open
weaknesses is a roadmap the day it goes live. Read the local file; do not copy
its contents back into a tracked one.

### 2. Fixed this session

- **Clicking any card threw the page to the top.** The 17 hoisted `.statehook`
  radios were `position: absolute`, so they sat at document offset -1; clicking
  a `<label for>` focused one and the browser scrolled it into view. Measured
  1641px at step 4, 1062px on the carousel, 449px on the outfits. Now `position:
  fixed` — measured 0px on all six targets. **Do not "tidy" it back**;
  `test/web-static.test.js` exists to stop exactly that.
- **Credits rescaled.** `creditUSD` $0.03 → $0.10, so **480p is 16 CR and 720p
  is 46 CR** (was 51/152). Plans moved in the same edit — free 16, shelf 48,
  archive 64 — so **every plan buys the same number of tapes as before and
  margins are unchanged.** Paul asked for 720p at ~100 CR; that would have sold
  it 52 CR below provider cost, so the unit was scaled instead of the tape
  discounted. **Existing account balances were NOT migrated** and are therefore
  worth 3.19x what they were. Deliberate — dev data.
- **Colour.** Accent `#C8A15A` → **`#FFB700`** (Kodak yellow). The eight places
  now span the whole hue wheel (26° to 294°) instead of a 28° wedge of brown,
  via `PLACE_HUES` in `static.mjs`; saturation floor 24-36% → 46-61%. This is
  the change that answers "it looks generic".
- **A real bug found on the way:** `hash32` returns unsigned, but `placeGradient`
  shifted it with `>>` (signed). Any place hashing above 2^31 got a negative
  remainder, which *subtracts* from the saturation floor — `balkon-waesche` was
  rendering at 37% against a floor of 46%. Fixed with `>>>`.
- **The place-photo upload was already built and unreachable.** `.ownplace` is
  `display:none`, revealed only by a card at the far end of a scrolling rail.
  Added a visible signpost (`.escape` / `.linky`) that reveals it, CSS-only.
- **A credit meter** — a ring that empties as credits are spent, with three
  states (ok / low / spent). The fraction rides on `stroke-dasharray`, an SVG
  presentation attribute, **because `style-src 'self'` has no `'unsafe-inline'`
  and must not gain one for a progress ring.**
- **Step 4 copy.** "Frames to choose from" → "How many looks to choose from",
  and the four unclickable `4:3 / PAL / 25 fps / 15.000s` chips are gone — they
  sat above the quality cards, which *are* clickable and look nearly identical.
- **A landing page, and `/` is now public.** It used to 303 a stranger to
  `/login`, so the whole product was a password box with nowhere to say what it
  is. `homePage` branches on the session: signed out it renders
  `landingPage()`, built from the preset catalog and nothing else. **Two tests
  used to assert `homePage` must never be public; they were replaced with a
  stronger assertion** — that the landing page carries no shelf, no balance, no
  upload form and no `CR` figure. The old guarantee was a redirect; the new one
  checks the output.

### 3. Next, in the order it is worth doing

1. **`FAL_KEY` in `.env`** — the only thing blocking. `$10 is enough`; every
   price in the repo is an estimate and the first real calls are what settle
   them. Unblocks the **eight place photographs**, which are the single biggest
   visual gap — the carousel and landing shelf render gradients today because
   `assets/places/` is empty. **Higgsfield cannot be used for these** (see the
   ruling below); fal is the licensed path.
2. **Three aspect ratios — `docs/aspect-ratios-plan.md`.** Paul asked twice for
   4:3, 9:16 and 16:9 with the picture *filling* the frame. Verified: Seedance
   2.0 takes `aspect_ratio` (`21:9, 16:9, 4:3, 1:1, 3:4, 9:16`), so the 4:3-only
   `FAL_RESOLUTIONS` is our product choice, not a provider limit. The design
   holds the **short edge at 576** in every shape, which keeps every pixel
   constant correct and makes the upscale exactly 1.875x in all three, so grain
   is arithmetically identical. **The 4:3 path does not move at all.** Not
   started. Step 3 of that plan is the honest gate.
3. **The app layout.** Four panels of identical width and weight behind the
   login — that is the remaining half of "it looks generic", and colour did not
   touch it.
4. ~~**F1/F2 retention.**~~ **DONE 2026-08-21** — see the top of this file.
5. **The rest of the security report** — `docs/security-review-2026-08-21.md`,
   local only. Four items worth doing before anything is deployed; each carries
   its evidence, its fix and its regression test in that file.

### 4. Open, needs Paul

- **`FAL_KEY`.** `.env` does not exist yet.
- **Does the matted 9:16 survive as a fourth option?** "Picture fills the frame"
  deletes the `#0B0A09` surround, and the surround plus the final vignette is
  what currently fuses tape and background into one photographed object.
- ~~**Is 7/30 days the intended retention?**~~ **ANSWERED 2026-08-21: yes, 7/30
  as promised.** Implemented against `config/render.json`, so changing it is a
  config edit — and the drift guard fails if the consent text stops agreeing.
- **The logo.** Paul is handling it. The existing `● TIMESTAMP` wordmark in
  VT323 is already good and a drawn mark risks a second visual language
  arguing with the tape.

### 5. Two pre-existing flaky tests, neither caused by this session's work

Both only fire when `node --test` runs files in parallel and several ffmpegs
compete — the shape CLAUDE.md already documents under "a test whose timing
margin is narrower than the machine's variance".

| Test | Rate across 8 full runs |
|---|---|
| `[fal] a 720p request downloads a 960x720 clip…` (`empty_download`) | ~3 in 8 |
| `a concurrent reader never sees a truncated or invalid manifest` | ~2 in 8 |

Passing 3/3 in isolation is not evidence they are fine; they need the
publish-your-progress fix, not a widened timeout.

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
