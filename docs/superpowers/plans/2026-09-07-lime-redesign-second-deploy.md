# Lime Redesign, Second Deploy — Implementation Plan (spec §10 steps 7–10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every page that is still in the lime world with its old layout — the order form, status, result, the shelf, the account page, onboarding, the five credential pages and the sign-in dialog, the three legal pages and the error trio — into the world's own layout (spec §6), pay the debt the first plan deliberately carried (CLAUDE.md §70E), and deploy the whole of it at once as the second deploy.

**Architecture:** The same one server-rendered stylesheet (`static.mjs`) and the same pure view functions (`views.mjs`, `views-auth.mjs`) over the same route table. The structure of every page is unchanged (spec §6: "Structure unchanged from 2026-09-04; world changed"); what changes is the surfaces and the states. Seven shared rules carry most of it — `.panel`, `.headline`, the field rule, `.record`, `.notice`, `.tape .frame` and the seven paper-world alias tokens — so the first task changes them once and every later task inherits the result. Selection stays CSS-only through the hoisted `.statehook` radios and the generated `presetCss` rules; only the generated rule text changes. The last photograph ground (onboarding) is deleted rather than restyled, and the scrim solver that survives for the landing's band is re-solved against the ink the band actually paints.

**Tech Stack:** Node 22+, ESM, `node --test`, zero npm dependencies, Chromium via CDP for the browser tests. No new inline script, no CSP change, no new dependency.

**Spec:** `docs/superpowers/specs/2026-09-06-lime-redesign-design.md` (commits `64aaaa7`, `f8ac48c`) — read §2, §6, §7, §8 and §10 first. `CLAUDE.md` §70 is the record of the first deploy and **§70E is the debt this plan starts from**; §69F is the first plan's record. The first plan, `docs/superpowers/plans/2026-09-06-lime-redesign-first-deploy.md`, is the shape this one follows.

## Global Constraints

Copied from the spec, the first plan, and the rules this repository already enforces. Every task's requirements include this section.

- **Zero npm dependencies.** `package.json` `dependencies` stays absent; `npm test` stays a bare `node --test`; `guards.yml` fails otherwise.
- **The CSP does not change.** `default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; font-src 'self'; script-src <hashes>`. No inline `style` attribute, no inline `<style>` block, anywhere.
- **No new inline script.** The five inline scripts (`HOME_SCRIPT`, `STATUS_SCRIPT`, `BG_SCRIPT`, `SIGNIN_SCRIPT`, `WIPE_SCRIPT`) stay five and their text does not change in this plan, so `INLINE_SCRIPT_HASHES` does not move.
- **Structure unchanged (spec §6).** Every class name a test pins stays in the markup: `panel`, `panel--anchor`, `panel--choice`, `panel--commit`, `panel--archive`, `step-head`, `stepno`, `stepno-k`, `stepno-n`, `drop`, `drop--slim`, `picked`, `pickthumb`, `pickname`, `lookcard`, `placecard`, `placecard--own-pick`, `placecard--own-add`, `thumb`, `badge`, `qualitycard`, `framecard`, `shape`, `tick`, `cr`, `cost`, `why`, `facts`, `record`, `check`, `consent-text`, `reason`, `rail`, `dots`, `dot`, `ownplace`, `phase`, `phase-state`, `reclight`, `dot`, `phase-title`, `phase-note`, `phase-n`, `inputs`, `counter`, `stepdetail`, `label`, `lname`, `lsub`, `ldate`, `meta`, `eyebrow eyebrow--osd`, `subhead subhead--osd`, `result-grid`, `result-tape`, `result-words`, `player`, `earlier`, `shelf`, `tape`, `frame`, `frame--a-16x9`, `frame--a-9x16`, `vplay`, `dl`, `cap`, `what`, `when`, `state`, `empty`, `account-danger`, `record--danger`, `nav`, `who`, `creds`, `notice`, `alert`, `field`, `hint`, `sub`, `headline`, `eyebrow`, `legal-h`, `go`, `quiet`, `linky`, `signin`, `signin-box`, `signin-x`, `signin-t`, `signin-sub`, `signin-way`, `signin-go`, `signin-or`, `signin-form`, `signin-l`, `signin-i`, `signin-alt`, `wrap--narrow`, `stamp`, `actions`. The one class this plan adds to markup is `commit-foot` (Task 2); the one it renames is the legal pages' `panel` to `legal` (Task 7); the ones it deletes are `has-ground` and the onboarding `bgs`/`bg--lit`/`scrim` (Task 5). Ids, `name` attributes, form actions and every sentence of copy are untouched.
- **Palette (spec §2.1, DESIGN.md), unchanged by this plan:** `--ground #161618`, `--card #1F1F22`, `--lime #D9FF00`, `--lime-hover #E9FF5C`, `--ink #F2F2F0`, `--ink-soft #A9A9A6`, `--on-lime #141414`, `--on-lime-soft #3A3A3A`, `--rec #E85545`, `--line rgba(242, 242, 240, 0.14)`, `--on-image #FAF7F2`, `--on-image-soft #CFC7BC`, `--ghost 0.5`. No token value moves. Seven alias NAMES are retired (Task 1); none is added.
- **Lime means chosen, or go.** The chosen text card (outfit, shape, quality) fills lime with `--on-lime` text; the chosen photograph card (a place) keeps its picture and takes a 2px lime ring and a lime badge; the primary button on every page; the wordmark; the display moments. Never a label, a link in prose, a price, a flag, a numeral, a glyph on an unchosen card, a done-phase word.
- **Red means the record light.** The status page's REC light on the phase being filmed is `--rec` and blinks (`tally`); the wordmark's dot is `--rec` and still (CLAUDE.md §70H). There is no alarm red: an error, a stopped phase and the delete-account button are weight and words in `--ink`.
- **Type.** Anton (`--display`) is already what `.headline`, `.title`, `.legal-h`, `.stepno-n`, `.app-h1`, `.record`, `.go` and `.signin-t` name; this plan does not change a face. Display is always uppercase, `line-height` 0.9–0.95, `letter-spacing: 0`, never below 18px; a test in Task 1 pins that no `.headline` rule tracks it or sets it loose. The one exception is stated where it is made (Task 4: an email address is data and stays in the body face). `--osd` (VT323) only for the cassette label's date on the result page; `.eyebrow--osd` and `.subhead--osd` are NAMES for a label role and do not use the OSD face (a test already pins that).
- **Texture.** The speckle only on `.lime` panels, the paper only on `.fact` cards, both already emitted once by `layout()`. Nothing in this plan adds a texture; the dark ground and every dark card stay flat.
- **Borders and shape.** Cards, fields, phase rows, tape labels, banners and shelf tiles: `1px solid var(--line)`, radius `--r` (12px) for a panel and `--r-sm` (10px) for a card inside one; a dropzone is `1px dashed var(--line)`; buttons `--r-btn`. Never a literal colour in a border declaration (the sweep refuses it). `<hr>` stays banned. `:focus-visible` outline 2px offset 2px, `--ink` on dark surfaces and `--on-lime` inside a lime panel, never removed — and a chosen lime CARD needs no special ring, because the positive offset draws the ring on the dark surface outside it (the comment above `:focus-visible` in `static.mjs` already says so).
- **Ghosts.** `--ghost: 0.5` stays, for a photograph not chosen (`.thumb`), a deferred option (`--soon`) and a phase still to come. Text option cards stop being ghosts in Task 2: an unchosen outlined card at half opacity is a 0.14-alpha line at 0.07, which is invisible. The ghost-floor and soft-tier-under-a-ghost tests are unchanged and must stay green.
- **Every number in copy comes from config or a pricing seam.** Nothing typed. This plan changes no copy.
- **No face in the repository.** Nothing in this plan touches the showcase.
- **The six test widths:** 320 / 375 / 414 / 768 / 1024 / 1440 — no horizontal overflow at any.
- **The sweeps that already run over every rendered page** (`renderedPages()` in `test/web-static.test.js`: German, texture, footer retention, still-approval, design-rationale-on-the-wire, the legal outline) must stay green after every task. A page that leaves `renderedPages()` fails `test/web-legal.test.js`'s meta-guard.
- **Test-first, one commit per task, every guard sabotage-verified**, restored from a COPY (`cp`), never `git checkout --`. A first-run pass on a new test is suspect until the sabotage proves it can fail. Print the mutated line before believing a sabotage changed anything (CLAUDE.md §42G, §70F: a sabotage can be a no-op on the current code).
- **Commit messages describe what the change DOES.** Never security-review vocabulary (`guards.yml` greps for it).
- **NOTHING IS PULLED ON THE BOX until Task 8, and then the whole plan at once.** The owner authorised deploys from this machine on 2026-09-07 (CLAUDE.md §70C), so Task 8 runs the deploy — but it STOPS and asks for the go first, and it runs the pull, the build and the checks as three separate remote commands (§70F: the classifier refuses the combined form). Pushing to `origin/supabase-identity-slice` is allowed at any point and does not touch the box; CI does not run on this branch.
- **The backtick trap.** `static.mjs`, `views.mjs` and `views-auth.mjs` are template literals: a backtick or a block-comment terminator inside a comment ends the string. Run `node --check` on all three after every edit to any of them.
- **Escapes.** The Bash heredoc and `node -e` strings eat backslashes on this machine. Write and edit files with the Write/Edit tools.
- **Comments name retired values in words only.** The dead-values test skips a line only when it BEGINS with `*`, `/*` or `//`; this codebase continues comments on plain indented lines, so a retired hex written on a continuation line fails the build. `#EDE7DC` (the old bone) is on that list and is the value Task 5 removes from `SCRIM_BONE`; never write it into a rule or an indented comment line.

## How this plan reads spec §10

| Spec step | Plan task | Commit | Stops for the owner |
|---|---|---|---|
| (the bones every page shares) | Task 1 | one | after: `/login` rendered — the card, the fields, the button, the heading |
| 7. Order form, status, result | Task 2 (order form), Task 3 (status + result) | one each | after each: the page rendered at 375 and 1440 |
| 8. My videos, account, onboarding, the auth five and the dialog | Task 4 (videos + account), Task 5 (onboarding + the ground), Task 6 (auth five + dialog) | one each | after each |
| 9. Legal pages and the error trio | Task 7 | one | after: `/privacy`, `/impressum`, a 404 |
| 10. Second deploy, CLAUDE.md section | Task 8 | the docs commit | before the pull: the go |

Task 1 exists because seven shared rules reach every page: doing them once and showing the owner the simplest page that carries them (`/login`) costs one short stop and saves re-doing every later page if he wants the card fill different. Spec §6's "structure unchanged" is what makes Tasks 2–7 restyles rather than rewrites; the exceptions are named in each task (Task 2 wraps the facts and the button in one row; Task 5 deletes a helper; Task 7 renames one section class).

## File structure

**Created:** nothing. This plan adds no file.

**Modified**

| Path | What changes |
|---|---|
| `scripts/web/static.mjs` | Task 1: the `:root` alias block (seven names deleted, every reader re-pointed), `.panel` and its four variants, the field rule, `.notice`, `.record:disabled`, `.tape .frame`, `.label`, the four `.headline` metric overrides, two stale comments. Task 2: `.lookcard`/`.qualitycard`/`.framecard`/`.placecard`/`.badge`/`.drop`/`.dot`, `presetCss`'s chosen-state templates, `.commit-foot`. Task 3: `.status .headline`, `.phase`, `.phase-title`, `.reclight`, `.player`, `.result-words .headline`. Task 4: `.record--danger`, `.account .headline`. Task 5: `.has-ground` block and `.bg--lit` deleted; `SCRIM_BONE` → `SCRIM_INK` (exported). Task 6: `.signin::backdrop`. Task 7: `.legal`, `.page-legal .headline`. |
| `scripts/web/views.mjs` | Task 2: `homePage`'s commit block — the consent moves above a new `<div class="commit-foot">` holding `dl.facts` and the button. Task 5: `singlePlaceGround` deleted. Task 7: the three legal pages' `<section class="panel">` → `<section class="legal">`. |
| `scripts/web/views-auth.mjs` | Task 5: `onboardingPage` loses `ground`, `preBody` and the `has-ground` class; its header comment rewritten. |
| `scripts/web/server.mjs` | Task 5: the `singlePlaceGround` import and the `ground` computation in the onboarding route. |
| `DESIGN.md` | Task 1: the aliases paragraph, a new **Surfaces** section. Task 2: **Ghosts and the floor** rewritten, **Lime means chosen** gains the card language. Task 5: **Text on a photograph** names the band as the only photograph. Task 7: legal pages named in Surfaces. |
| `test/web-static.test.js` | Task 1: one test extended, four added. Task 2: four added. Task 3: two added. Task 4: one added. Task 5: one rewritten (the onboarding ground), one added (the scrim ink and the band's tier), the `singlePlaceGround` import dropped, `SCRIM_INK` imported. Task 6: one added. Task 7: one added. |
| `test/web-api.test.js` | Task 2: two assertions in `every place has an image URL and a gradient underneath it in one declaration` rewritten to the lime-fill grammar. |
| `test/browser-smoke.test.js` | Task 2: one added (lime on exactly one card per row — spec §8). Task 3: `session()` seeds a running job; one added (the record light red and blinking in the cascade). Task 5: the onboarding contrast sweep loses its ground assertions and gains their negation. |
| `build/preview-onboarding.mjs`, `build/preview-pages.mjs` | gitignored scratch; Task 5 and the stops update them so the owner can look. Not committed. |
| `CLAUDE.md` | Task 8: §71 and the START HERE banner. |

## The old-world inventory (measured 2026-09-07 at `f618ca3`, from the three read-only sweeps)

Re-run the command in Task 0; the numbers below are what stood when this plan was written.

```bash
grep -nE 'var\(--(lift|ink-strong|frost|frost-lit|muted|hairline|hairline-firm)\)|has-ground|singlePlaceGround|bg--lit|SCRIM_BONE|backdrop-filter|\.63 floor|letter-spacing: -0\.02em' scripts/web/static.mjs scripts/web/views.mjs scripts/web/views-auth.mjs scripts/web/server.mjs | wc -l
```

Expected at `f618ca3`: **45** lines (39 in `static.mjs`, 2 each in `views.mjs`, `views-auth.mjs`, `server.mjs`). Expected after Task 7: **0**.

**Alias readers in `static.mjs`** (line numbers at `f618ca3`; re-`grep -n` before editing):

| Alias | Uses | Where | Becomes |
|---|---|---|---|
| `--lift` | 7 | 1033 `.notice`, 1312 `.drop--slim`, 1337 `.picked .pickthumb`, 1555 the field rule, 1735 `.record:disabled`, 1784 `.tape .frame`, 2003 `.label` | `--card` on 1033, 1312, 1735, 1784, 2003; `--ground` on 1337, 1555 — the rule: a thing INSIDE a card recesses to the ground, a thing ON the ground lifts to the card |
| `--ink-strong` | 1 | 2170 `.signin-x:hover` | `--ink` |
| `--muted` | 9 | 891, 909, 971 `.sub`, 995 `.lede`, 1569, 1927, 1933, 1936, 2121 | `--ink` (it already points at `--ink`; zero pixel change) |
| `--frost`, `--frost-lit` | 1 + 2 | 1099 `.panel`, 1123 `.panel--anchor`, 1152 `.panel--commit` | the `.panel` rewrite |
| `--hairline` | 0 | — | deleted, dead |
| `--hairline-firm` | 5 | 914, 1505 `.dot`, 1556 the field border, 1572 the file button, 2094 `.quiet` underline | `--line` |

**Other debt named in §70E and where it lands:** the collapsed weight arc → Task 1 (`.panel` planes) and Task 2 (the option cards); `SCRIM_BONE` → Task 5; the `--lift`/`--ink-strong` names → Task 1; the missing dim-tier guard for the band → Task 5; the "lime on exactly one card per row" browser test → Task 2; the favicon → not this plan (the owner's); `sameInEveryShape`'s third state and the disabled Buy on the lime card → not this plan (pricing page, already shipped; both unreachable today and recorded in §70E).

**Tests that pin the CURRENT look of these pages and go red on purpose in this plan** (from the test sweep; everything not listed stays green throughout):

| Test | Task | Fate |
|---|---|---|
| `web-static` "a panel and a card carry the outline, from the token" (~414) | 1 | extended: `.panel` is a card, no `backdrop-filter`, `.panel--choice` is an open outline |
| `web-api` "every place has an image URL and a gradient underneath it in one declaration" (~1079), the two `qualitycard--q-480p` assertions | 2 | rewritten to `background:var(--lime);border-color:var(--lime);` and the on-lime text rule |
| `web-static` "the onboarding page carries a ground when it is given one…" (~1954) | 5 | rewritten: the page never carries one |
| `browser-smoke` "every word on the onboarding page survives the photograph it sits on" (~1143) | 5 | rewritten: the sweep stays, the five ground assertions become their negation |

**Tokens with ZERO assertions anywhere in the suite**, so their retirement cannot go red by accident: `panel--anchor`, `panel--commit`, `--frost`, `--frost-lit`, `--lift`, `--muted`, `SCRIM_BONE`. (`--ink-strong` and `panel--choice` appear only inside comments.)

**What does NOT exist, so nobody looks for it:** there is no `.btn`, `.chip`, `.tile`, `.cassette`, `.spec`, `.auth`, `.auth-panel`, `.google`, `.legal` (until Task 7), `.prose`, `.onboard*` class. The button family is `.record`/`.go`/`.quiet`/`.linky`; the pill family is `.pill`/`.mark`/`.tape .state`/`.flag`; the tile is `.tape`; the cassette label is `.label`; the spec line is `.meta`. `.record--danger` is in the markup and styled by NOTHING (Task 4 fixes it).

## Working rules for every task

**The check after every edit to a template-literal file:**

```bash
node --check scripts/web/static.mjs && node --check scripts/web/views.mjs && node --check scripts/web/views-auth.mjs && echo PARSE-OK
```

**The sabotage discipline.** Before mutating a source file to prove a test can fail: `mkdir -p build/sabotage && cp <file> build/sabotage/<name>`. Mutate with the Edit tool. Run the one test. Print the mutated line (`grep -n` it) and confirm it changed. Restore with `cp build/sabotage/<name> <file>` and `cmp` the two. Never `git checkout -- <file>` while green work is uncommitted (CLAUDE.md §37F). If a sabotage does not turn the test red, treat the TEST as the thing to fix (CLAUDE.md §34F) — unless you can prove the mutation was a no-op on the current code (§70F).

**Running one test file, and one test:**

```bash
node --test test/web-static.test.js
node --test --test-name-pattern="the record button" test/web-static.test.js
```

`node --test`'s reporter marks a failure `✖`, not `not ok`; grep a redirected log for `✖` and read the `ℹ fail` line (CLAUDE.md §70G).

**The full suite, redirected so the exit code is the runner's (never piped):**

```bash
npm test > build/suite.log 2>&1; echo "exit $?"; tail -12 build/suite.log
```

**Do not edit a test file or a source file while the full suite is running** (CLAUDE.md §60C, §60J): the runner picks files up as it reaches them.

**The seven guards, run verbatim and COUNTED (CLAUDE.md §49H).** Each block below is a `run:` step from `.github/workflows/guards.yml`; run them one at a time from the repo root in Git Bash and count seven `PASS` lines by hand.

```bash
script="$(node -p "require('./package.json').scripts.test")"; [ "$script" = "node --test" ] && echo PASS 1 || echo FAIL 1
```
```bash
grep -nE "fetchImpl\s*=\s*(globalThis\.)?fetch" scripts/providers/fal.mjs && echo FAIL 2 || echo PASS 2
```
```bash
node -e "import('./scripts/providers/contract.mjs').then(({ requireFetchImpl }) => { try { requireFetchImpl({}, { provider: 'guard' }); } catch (err) { if (err instanceof TypeError) { console.log('PASS 3'); return; } throw err; } console.log('FAIL 3'); process.exit(1); })"
```
```bash
git ls-files | grep -E 'security-review' && echo FAIL 4 || echo PASS 4
```
```bash
KNOWN='18352f4 190a9ec 6efb0e6'; bad=""; for sha in $(git rev-list origin/main..HEAD); do skip=""; for k in $KNOWN; do case "$sha" in "$k"*) skip=1 ;; esac; done; [ -n "$skip" ] && continue; if git log -1 --format='%B' "$sha" | grep -qiE '[0-9]+ (CRITICAL|HIGH|MEDIUM)\b|\b(ONE|TWO|THREE|FOUR) (CRITICAL|HIGH)\b|enumeration oracle|\bF[0-9]{1,2}\b (is|are|still|arms)'; then bad="$bad $sha"; fi; done; [ -z "$bad" ] && echo PASS 5 || echo "FAIL 5 $bad"
```
```bash
bad="$(git ls-files | grep -E '(^|/)\.env($|\.)|\.(pem|key|p12|pfx)$|^out/|^assets/test-photos/' | grep -vE '^\.env\.example$|^assets/test-photos/README\.md$' || true)"; [ -z "$bad" ] && echo PASS 6 || echo "FAIL 6 $bad"
```
```bash
node -e "const fs=require('node:fs');const cfg=JSON.parse(fs.readFileSync('config/render.json','utf8')).retention;import('./scripts/safety/consent.mjs').then(({consentText})=>{const t=consentText();const ok=t.includes('deleted after '+cfg.photoDays+' days')&&t.includes('video after '+cfg.jobDays+' days');console.log(ok?'PASS 7':'FAIL 7');if(!ok)process.exit(1);});"
```

**Committing a multi-line message** without a heredoc: write the message with the Write tool to `build/commitmsg.txt`, then `git commit -F build/commitmsg.txt`. End every message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

**Showing the owner a page (the stop materials).** The dev server: `npm run web` in a background Bash (it loads `.env`, so Supabase and the owner's real account work locally), then `preview_start` with `{ url: "http://localhost:3000/<path>" }` — NOT `{ name: "web" }` once a server is already up on 3000 (CLAUDE.md §70G). `/login`, `/signup`, `/auth/reset`, `/auth/reset/complete`, `/verify?email=a@b.com`, `/privacy`, `/terms`, `/impressum`, `/nope` (a 404) and the dialog on `/` render signed out. `/`, `/videos`, `/account` need the owner to sign in with his real account in the pane. The job pages and onboarding need a state the local server may not have: render them with `build/preview-pages.mjs` and `build/preview-onboarding.mjs` (gitignored scratch from earlier sessions; Task 5 updates the onboarding one) and serve `build/` with the `preview` launch config (`preview_start { name: "preview" }`, port 3400; the URL is `/build/preview-status-running.html` and so on). After a stylesheet change the pane holds `/styles.css` for five minutes: run `fetch('/styles.css', {cache: 'reload'}).then(() => location.reload())` in the pane's console, or restart the pane. Screenshots at 375 and 1440 (`resize_window` then `computer screenshot`, or `build/shot.mjs`), sent with `SendUserFile`. **Review the task before showing the owner; then show him; apply his answers as small test-first follow-ups, one commit each.**

**Dispatch (subagent-driven).** Sonnet is the floor (Haiku cannot hold the harness); Opus for Tasks 1, 2 and the final review. A fix round is a fresh implementer handed the task, the report file and the findings verbatim. The report file is the memory (CLAUDE.md §70G).

---

### Task 0: Baseline, and the inventory re-run

**Files:** none modified.

- [ ] **Step 1: The suite, whole.**

```bash
npm test > build/baseline.log 2>&1; echo "exit $?"; grep -E "^ℹ (tests|pass|fail|skipped)" build/baseline.log
```

Expected at `f618ca3`: `tests 2149`, `pass 2146`, `fail 0`, `skipped 3` (the two money guards and the Linux-only backup-mode assertion). If the numbers differ, stop and find out why before Task 1: a red baseline means something moved under this plan.

- [ ] **Step 2: The inventory grep** from the section above. Expected `45`. Write the number into `build/baseline.txt` beside the suite counts.

- [ ] **Step 3: Parse check and a clean tree.**

```bash
node --check scripts/web/static.mjs && node --check scripts/web/views.mjs && node --check scripts/web/views-auth.mjs && echo PARSE-OK
git status --short
git log --oneline -1
```

Expected: `PARSE-OK`; only `?? docs/Timestamp-Brand-Guidelines.pdf` untracked (the superseded PDF, deliberately uncommitted); HEAD `f618ca3` or later.

No commit.

---

### Task 1: The shared bones — every panel is a card, fields recess to the ground, seven aliases retired, the display face keeps its metrics (STOPS FOR THE OWNER TO LOOK AT `/login`)

**Files:**
- Modify: `scripts/web/static.mjs` (the `:root` alias block ~543–561; `.panel` block ~1093–1163; `.notice` ~1032; `.drop--slim` ~1312; `.picked .pickthumb` ~1337; the field rule ~1553–1561; `input[type="file"]::file-selector-button` ~1570; `.record:disabled` ~1735; `.tape .frame` ~1775–1785; `.label` ~1998–2008; `.dot` ~1505; `.quiet` ~2094; `.signin-x:hover` ~2170; `.status .headline` ~1864; `.result-words .headline` ~2041; `.videos .headline` ~2062; `.account .headline` ~2071; comments ~1447 and ~1954)
- Modify: `DESIGN.md` (the aliases paragraph; a new Surfaces section)
- Test: `test/web-static.test.js` (one extended, four added)

**Interfaces:**
- Consumes: the tokens as they are.
- Produces: `.panel` = an outlined card on `--card`; `.panel--choice` = the same outline with a transparent fill; the field rule = `--ground` fill + `--line` outline; `.tape .frame` = outlined tile; the alias names `--lift`, `--ink-strong`, `--frost`, `--frost-lit`, `--muted`, `--hairline`, `--hairline-firm` no longer exist. Every later task relies on these.

**Why this is one task.** These rules are shared by every page: `.panel` wraps the order form's four steps, the archive, onboarding, the five credential pages, the legal pages and the error trio; the field rule is every text input in the product; `.record:disabled` is the order form's refusal state and nothing else; `.tape .frame` is every shelf tile on three pages. Changing them page by page would mean the same edit seven times, or seven pages disagreeing in between.

- [ ] **Step 1: The tests (RED).** In `test/web-static.test.js`, replace the test `a panel and a card carry the outline, from the token` with:

```js
test('a panel and a card carry the outline, from the token, and a panel sits on the card plane', () => {
  const { css } = createStylesheet({});
  for (const sel of ['.panel', '.card']) {
    const rule = new RegExp('\\n' + sel.replace('.', '\\.') + '\\s*\\{([^}]*)\\}').exec(css);
    assert.ok(rule, `no ${sel} rule`);
    assert.match(rule[1], /border:\s*1px solid var\(--line\)/, `${sel} is not outlined`);
    assert.match(rule[1], /border-radius:\s*var\(--r\)/, `${sel} does not take the card radius`);
    assert.match(rule[1], /background:\s*var\(--card\)/, `${sel} does not sit on the card plane`);
  }
  // A frosted plate blurs whatever is behind it. Nothing is behind it any more:
  // the photograph left the signed-in page on 2026-08-28 and onboarding loses
  // its own in this plan, so a backdrop-filter is a GPU cost that paints nothing.
  assert.ok(!/backdrop-filter/.test(css), 'a frosted plate survives with nothing behind it to frost');
  // THE WEIGHT ARC, IN THIS WORLD'S VOCABULARY. The photo (step 1) and the tape
  // (step 4) are filled cards; the two menus between them are the same outline
  // with nothing behind it. Heavy, light, light, heavy -- §6a's arc, carried by
  // the fill rather than by a frost tier that no longer exists.
  const choice = /\n\.panel--choice\s*\{([^}]*)\}/.exec(css);
  assert.ok(choice, 'no .panel--choice rule');
  assert.match(choice[1], /background:\s*transparent/, 'a menu panel is not an open outline on the ground');
  assert.ok(!/border:\s*0/.test(choice[1]), 'a menu panel still takes its outline away');
  assert.ok(!/border-radius:\s*0/.test(choice[1]), 'a menu panel still squares its corners');
  const anchor = /\n\.panel--anchor\s*\{([^}]*)\}/.exec(css);
  if (anchor) assert.ok(!/background/.test(anchor[1]), 'the anchor names a plane of its own; it is a card like the commit');
  const commit = /\n\.panel--commit\s*\{([^}]*)\}/.exec(css);
  assert.ok(commit, 'no .panel--commit rule');
  assert.ok(!/background/.test(commit[1]), 'the commit names a plane of its own; it is the card');
  assert.match(css, /\.lime\s*\{[^}]*background:\s*var\(--lime\)/, 'the lime panel is not lime');
  assert.match(css, /\.lime\s*\{[^}]*color:\s*var\(--on-lime\)/, 'text on the lime panel does not take the on-lime ink');
});
```

Add these four tests directly after it:

```js
test('the seven paper-world alias names are gone from the sheet, and nothing reads them', () => {
  // `--lift` and `--ink-strong` were named in CLAUDE.md §70E as debt: legacy
  // names from the paper page that still described what they pointed at. The
  // other five were the same shape -- an alias that resolves to a token every
  // rule could name directly -- and once .panel stopped reading --frost there
  // was nothing left that any of them said. A name that maps to one value is
  // a second place to decide a colour, which is how the sign-in dialog was
  // painted for the wrong ground on 2026-09-05.
  const { css } = createStylesheet(FOCUS_MENU);
  for (const name of ['--lift', '--ink-strong', '--frost', '--frost-lit', '--muted', '--hairline', '--hairline-firm']) {
    // The lookahead keeps --frost from matching --frost-lit and --hairline from
    // matching --hairline-firm, so each name is asserted on its own.
    const re = new RegExp(`${name}(?![\\w-])`);
    assert.ok(!re.test(css), `${name} is still in the sheet -- defined or read`);
  }
  // The aliases that stay, because generated rules and tests name them and
  // they carry no paper-world meaning: --accent, --faint, --alarm, --ghost-hover.
  for (const name of ['--accent', '--faint', '--alarm', '--ghost-hover']) {
    assert.ok(new RegExp(`${name}:`).test(css), `${name} was retired by accident`);
  }
});

test('a field sits on the ground inside a card, outlined from the token; a banner and a refused button are cards too', () => {
  const { css } = createStylesheet({});
  const input = /input\[type="text"\], input\[type="email"\], input\[type="password"\], select\s*\{([^}]*)\}/.exec(css);
  assert.ok(input, 'no shared input rule');
  assert.match(input[1], /background:\s*var\(--ground\)/, 'a field inside a card does not recess to the ground');
  assert.match(input[1], /border:\s*1px solid var\(--line\)/, 'a field is not outlined from the token');
  const notice = /\n\.notice\s*\{([^}]*)\}/.exec(css);
  assert.ok(notice, 'no .notice rule');
  assert.match(notice[1], /background:\s*var\(--card\)/, 'the notice is not a card');
  assert.match(notice[1], /border:\s*1px solid var\(--line\)/, 'the notice is a fill with no outline');
  assert.match(notice[1], /color:\s*var\(--ink\)/, 'the notice is written in the soft tier on a card');
  const disabled = /\.record:disabled\s*\{([^}]*)\}/.exec(css);
  assert.ok(disabled, 'no .record:disabled rule');
  assert.match(disabled[1], /background:\s*var\(--card\)/, 'a refused Record is not the card plane');
  assert.match(disabled[1], /border:\s*1px solid var\(--line\)/, 'a refused Record on a card is invisible without its outline');
  assert.match(disabled[1], /color:\s*var\(--ink-soft\)/, 'a refused Record does not read as refused');
  assert.ok(!/var\(--(lime|accent)\)/.test(disabled[1]), 'a refused button is lime -- lime means go');
  const label = /\n\.label\s*\{([^}]*)\}/.exec(css);
  assert.ok(label, 'no .label rule');
  assert.match(label[1], /background:\s*var\(--card\)/, 'the cassette label is not on the card plane');
});

test('a shelf tile carries the card outline', () => {
  const { css } = createStylesheet({});
  const frame = /\.tape \.frame\s*\{([^}]*)\}/.exec(css);
  assert.ok(frame, 'no .tape .frame rule');
  assert.match(frame[1], /background:\s*var\(--card\)/, 'an unfinished tile has no plate');
  assert.match(frame[1], /border:\s*1px solid var\(--line\)/, 'a tile is not outlined -- spec §2.4 names shelf tiles');
  assert.match(frame[1], /border-radius:\s*var\(--r-sm\)/, 'a tile does not take the small radius');
});

test('the display face is never tracked or set loose, on any page heading', () => {
  // Anton wants 0.9-0.95 leading and no tracking (DESIGN.md, Type). Four
  // per-page .headline rules still carried the SANS-era values -- line-height
  // 1.1 and letter-spacing -0.02em -- from before the display face changed, so
  // every interior heading sat loose and squeezed in a face that is neither.
  // The one legitimate exception names the body face in the same rule (an
  // email address is data, Task 4) and is skipped by that.
  const { css } = createStylesheet({});
  const rules = [...css.matchAll(/([^{}]*\.headline[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 5, `expected the base rule and the per-page sizes, found ${rules.length}`);
  for (const [, sel, body] of rules) {
    if (/font-family:\s*var\(--sans\)/.test(body)) continue;
    const ls = /letter-spacing:\s*([^;]+);/.exec(body);
    if (ls) assert.equal(ls[1].trim(), '0', `"${sel.trim()}" tracks the display face: ${ls[1].trim()}`);
    const lh = /line-height:\s*([0-9.]+)\s*;/.exec(body);
    if (lh) assert.ok(Number(lh[1]) <= 0.95, `"${sel.trim()}" sets the display face loose at ${lh[1]}`);
  }
});
```

Run: `node --test test/web-static.test.js`. Expected: **five red** — the panel test on `background: var(--card)` (`.panel` reads `--frost`), the alias test on `--lift`, the field test on `background: var(--ground)`, the tile test on the border, the metrics test on `.status .headline`'s `-0.02em`.

- [ ] **Step 2: The `:root` alias block.** In `static.mjs`, find the alias block (`grep -n "alias" scripts/web/static.mjs` — the comment at ~543 ends "The paper and oxide names are GONE, not aliased"). Delete these six lines from the block:

```css
  --muted: var(--ink);
  --frost: var(--card);
  --frost-lit: var(--card);
  --lift: var(--card);
  --ink-strong: var(--ink);
  --hairline: var(--line);
  --hairline-firm: var(--line);
```

(seven declarations; `--muted` and `--hairline` may carry trailing comments — delete the whole line). Keep `--accent`, `--accent-bright`, `--accent-deep`, `--faint`, `--alarm`. Replace the block's comment with:

```css
  /* THE ALIASES THAT STAY. Several hundred rules and the generated per-catalog
     block read --accent and --faint, and --alarm names the one decision that
     there is no alarm red; they are re-pointed here once and never rewritten.
     Seven other names were retired on 2026-09-07 -- lift, ink-strong, frost,
     frost-lit, muted, hairline, hairline-firm -- because each resolved to one
     token every rule could name directly, and a name that maps to one value
     is a second place to decide a colour. A test fails if any of them
     reappears. The paper and oxide names are GONE, not aliased. */
```

- [ ] **Step 3: Re-point every reader.** Run each grep and edit every hit with the Edit tool; the file's line numbers will have moved by Step 2, so trust the grep and not this list.

```bash
grep -n "var(--muted)" scripts/web/static.mjs          # 9 hits -> var(--ink)
grep -n "var(--ink-strong)" scripts/web/static.mjs     # 1 hit  -> var(--ink)
grep -n "var(--hairline-firm)" scripts/web/static.mjs  # 5 hits -> var(--line)
grep -n "var(--lift)" scripts/web/static.mjs           # 7 hits, each below
```

The seven `--lift` readers, by rule:

| Rule | Replace the declaration with |
|---|---|
| `.notice` | `background: var(--card); color: var(--ink); border: 1px solid var(--line);` (three declarations replace `background: var(--lift); color: var(--faint);`) |
| `.drop--slim` | `background: var(--card);` |
| `.picked .pickthumb` | `background: var(--ground);` |
| the field rule (`input[type="text"], …, select`) | `background: var(--ground); border: 1px solid var(--line);` (the border line was `--hairline-firm`, already re-pointed above) |
| `.record:disabled` | `background: var(--card); color: var(--ink-soft); border: 1px solid var(--line); cursor: not-allowed;` |
| `.tape .frame` | `background: var(--card); border: 1px solid var(--line); border-radius: var(--r-sm);` and rewrite the comment above it: the plate is the card plane, outlined like every other card in this world, and the poster covers it the moment there is one |
| `.label` | `background: var(--card);` |

- [ ] **Step 4: The `.panel` block.** Replace everything from the `.panel {` rule through `.panel--archive { margin-top: 0; }` (including the "THE PLATE IS GONE" narrative, the `.panel--anchor` rule and its comment, the "THE OPEN PANEL" comment, `.panel--choice` and its inner comment, the "THE COMMIT IS NOT THE ANCHOR" comment and `.panel--commit`) with:

```css
.panel {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: var(--s-5);
  margin: 0 0 var(--s-6);
}

/* THE WEIGHT ARC, IN THIS WORLD'S VOCABULARY (2026-09-07). The 2026-08-22
   arc -- anchor firm, the two choices lightest, commit firm -- was carried by
   a frost tier, and the lime tokens collapsed every frost value to one plane,
   so the four steps read as four identical boxes (CLAUDE.md §70E). The arc is
   the FILL now: the photo and the tape are cards, the two menus between them
   are the same outline with nothing behind it. Heavy, light, light, heavy.
   Both kinds keep the 1px, so the four step numerals sit on one line. */
.panel--choice { background: transparent; }

/* The commit earns more room because it holds six decisions and the money.
   The archive break is carried HERE, on the bottom edge, for the reason every
   other separation is: a margin-top on the archive collapsed to 48px between
   block siblings and summed to 80px between grid items. Measured both ways. */
.panel--commit {
  padding: var(--s-6) var(--s-5);
  margin-bottom: var(--s-7);
}

/* The archive is not a fifth step, and the air that says so is on the commit's
   bottom edge -- see above. Nothing here. */
.panel--archive { margin-top: 0; }
```

There is no `.panel--anchor` rule any more; the `#tape` grid rules that position `.page-home .panel--anchor` (sticky, `grid-row: 1 / span 3`) are untouched and still match the markup's class. Delete the section header comment `/* --- frosted cards --- */` above the block and replace it with `/* --- the step cards ---------------------------------------------------- */`.

- [ ] **Step 5: The heading metrics.** Four rules carry `line-height: 1.1; letter-spacing: -0.02em;`. Edit each:

```css
.status .headline { font-size: var(--t-6); text-wrap: balance; }
.result-words .headline { font-size: var(--t-6); text-wrap: balance; max-inline-size: 18ch; }
.videos .headline { font-size: var(--t-7); max-inline-size: 18ch; margin: 0 0 var(--s-3); }
.account .headline { font-size: var(--t-6); overflow-wrap: anywhere; }
```

(Sizes are unchanged here; Task 3 raises the two job pages to `--t-7` and Task 4 gives the account heading the body face.) Also fix the two stale comments that say the ghost floor is `.63`: `grep -n "\.63" scripts/web/static.mjs` — replace `even at the .63 floor` with `even at the floor` and `on this ground the floor is .63` with `on this ground the ghost sits at the floor`. Both are plain-indented continuation lines, which is why the dead-values test cannot see a hex there and why the sentence should not gain one.

- [ ] **Step 6: Parse check, run the file.**

```bash
node --check scripts/web/static.mjs && echo PARSE-OK
node --test test/web-static.test.js
```

Expected: PARSE-OK, all green including the five from Step 1. If `no value of a superseded world is left in the sheet` goes red, a comment continuation line gained a retired hex; say it in words.

- [ ] **Step 7: DESIGN.md.** Replace the paragraph beginning `**The aliases.**` with:

```markdown
**The aliases.** `--accent`, `--accent-bright`, `--accent-deep`, `--faint`,
`--alarm` and `--ghost-hover` are re-pointed once at `:root` and never
rewritten back; several hundred rules and the generated per-catalog block read
them. Seven names were retired on 2026-09-07 — `--lift`, `--ink-strong`,
`--frost`, `--frost-lit`, `--muted`, `--hairline`, `--hairline-firm` — because
each resolved to one token every rule could name directly, and a name that
maps to one value is a second place to decide a colour. A test fails if any of
the seven reappears. The names of the two retired worlds (`--paper`, `--oxide`,
`--l-*`, `body.is-landing`) do not exist, and a test fails if any of their
values reappears in the sheet.
```

Add a section after **Palette** and before **Ghosts and the floor**:

```markdown
## Surfaces

Two planes and one line. The ground is the page. An outlined card — `--card`,
`1px solid var(--line)`, radius `--r` for a panel and `--r-sm` for a card
inside one — is a thing on it: a step of the order form, a phase of a render, a
shelf tile, a cassette label, a banner, a sign-in panel, the error page. A
field inside a card recesses to the ground; a field on the ground lifts to the
card. A dropzone is the same outline dashed. The order form's weight arc from
2026-08-22 survives in this vocabulary: the photo (step 1) and the tape (step
4) are filled cards, the two menus between them are outlines with nothing
behind them, so the page reads heavy, light, light, heavy. There is no frost,
no blur and no plate: nothing sits behind a card but the ground.
```

- [ ] **Step 8: The full suite, the sabotages, the guards, the commit.**

Sabotages, each from a copy (`cp scripts/web/static.mjs build/sabotage/static-t1.mjs`), each restored and `cmp`'d before the next:
(a) put `-webkit-backdrop-filter: blur(20px);` back into `.panel` → the panel test fails on `backdrop-filter`;
(b) write `background: var(--lift);` into `.drop--slim` → the alias test names `--lift`;
(c) delete `border: 1px solid var(--line);` from `.tape .frame` → the tile test fails;
(d) put `letter-spacing: -0.02em;` back on `.status .headline` → the metrics test names it.

```bash
npm test > build/suite.log 2>&1; echo "exit $?"; tail -12 build/suite.log
```

Expected: `fail 0`, `tests 2153` (baseline + 4). Then the seven guards, counted 7/7. Then:

```bash
git add scripts/web/static.mjs DESIGN.md test/web-static.test.js
git commit -F build/commitmsg.txt
```

Message: `design: the shared bones -- every panel is a card on the card plane, fields recess to the ground, seven paper-world aliases retired, the display face keeps its metrics on every heading`. The body says what changed and names the four DESIGN.md sentences.

- [ ] **Step 9: STOP. Show the owner `/login` at 375 and 1440.** It is the simplest page carrying everything this task changed: one card on the ground, an Anton heading at the right leading, two fields recessed to the ground with the outline, the lime button, the quiet links. Ask one question: is the card fill right, or should the steps be outlines only? Apply the answer before Task 2, because Task 2 builds the option cards on the same decision.

---
### Task 2: The order form — option cards outlined and the chosen one lime, the chosen place ringed and badged, dashed dropzones, Record beside its price (STOPS FOR THE OWNER TO LOOK)

**Files:**
- Modify: `scripts/web/static.mjs` (`.lookcard` base block ~1361–1374 and its `.name`/`.detail`/`.tick`; `.framecard` ~1624–1651; `.qualitycard` ~1668–1696; `.placecard` ~1428–1438, `.placecard .badge` ~1487–1502; `.drop` ~1288–1319; `presetCss` chosen-state templates ~365–440 and the `#pl-own` block ~452–460; a new `.commit-foot` block after `.facts`)
- Modify: `scripts/web/views.mjs` (`homePage`'s commit block: the consent label moves above a new `<div class="commit-foot">` that wraps `dl.facts` and the Record button)
- Modify: `DESIGN.md` (**Ghosts and the floor** rewritten; **Lime means chosen** gains the card language)
- Test: `test/web-static.test.js` (four added), `test/web-api.test.js` (two assertions rewritten), `test/browser-smoke.test.js` (one added)

**Interfaces:**
- Consumes: `.panel` as a card and `.panel--choice` as an open outline (Task 1); `--lime`, `--on-lime`, `--on-lime-soft`, `--line`, `--r-sm`, `--ghost`; the slug helpers `outfitSlug`, `qualitySlug`, `aspectSlug`, `placeSlug` (`static.mjs` ~261–267: `of-<id>`, `q-<id>`, `a-4x3`, `pl-<id>`).
- Produces: the generated chosen-state rule TEXT below, which `test/web-api.test.js` and the new `web-static` test both assert by exact string. Change the text in `presetCss` and in both tests together or not at all.

**The generated rule text after this task** (the only contract another file reads):

```
#<of-slug>:checked~.wrap .lookcard--<of-slug>{background:var(--lime);border-color:var(--lime);}
#<of-slug>:checked~.wrap .lookcard--<of-slug> .name{color:var(--on-lime);}
#<of-slug>:checked~.wrap .lookcard--<of-slug> .detail{color:var(--on-lime-soft);}
#<of-slug>:checked~.wrap .lookcard--<of-slug> .tick{opacity:1;}
#<q-slug>:checked~.wrap .qualitycard--<q-slug>{background:var(--lime);border-color:var(--lime);}
#<q-slug>:checked~.wrap .qualitycard--<q-slug> .name,#<q-slug>:checked~.wrap .qualitycard--<q-slug> .cr,#<q-slug>:checked~.wrap .qualitycard--<q-slug> .flag{color:var(--on-lime);}
#<q-slug>:checked~.wrap .qualitycard--<q-slug> .detail{color:var(--on-lime-soft);}
#<q-slug>:checked~.wrap .qualitycard--<q-slug> .tick{opacity:1;}
#<a-slug>:checked~.wrap .framecard--<a-slug>{background:var(--lime);border-color:var(--lime);}
#<a-slug>:checked~.wrap .framecard--<a-slug> .ratio,#<a-slug>:checked~.wrap .framecard--<a-slug> .detail{color:var(--on-lime);}
#<a-slug>:checked~.wrap .framecard--<a-slug> .shape{border-color:var(--on-lime);}
#<a-slug>:checked~.wrap .framecard--<a-slug> .tick{opacity:1;}
#<pl-slug>:checked~.wrap .placecard--<pl-slug>{transform:scale(1.03);box-shadow:0 0 0 2px var(--lime);}
#pl-own:checked~.wrap .placecard--own{transform:scale(1.03);box-shadow:0 0 0 2px var(--lime);}
```

Everything else `presetCss` emits (the `.thumb--`/`.bg--` image layers, the band's `.bgs`/`.scrim`/`.lopt` rules, the `.thumb{opacity:1;}` and `.badge{opacity:1;}` lifts, the `.dot--` fill, the `.cost--`/`.why--`/`.cr--` switches, `focusRing`) is unchanged.

- [ ] **Step 1: The tests (RED).** In `test/web-api.test.js`, inside `every place has an image URL and a gradient underneath it in one declaration`, replace the two assertions that read `#q-480p:checked~.wrap .qualitycard--q-480p{opacity:1;}` and `... .name{color:var(--accent);` with:

```js
    assert.ok(css.includes('#q-480p:checked~.wrap .qualitycard--q-480p{background:var(--lime);border-color:var(--lime);}'),
      'the selected quality card must fill lime by CSS alone');
    assert.ok(css.includes('#q-480p:checked~.wrap .qualitycard--q-480p .name,#q-480p:checked~.wrap .qualitycard--q-480p .cr,#q-480p:checked~.wrap .qualitycard--q-480p .flag{color:var(--on-lime);}'),
      'and its text must take the ink solved for lime, or the chosen card is unreadable');
```

Update the comment above them: selection is no longer "a strike" (full opacity against a ghost with the name in the accent); it is the card FILLING lime, which is spec §6's grammar and the pricing page's. The rule the test protects did not move: the selection is still carried entirely by CSS with no script involved.

In `test/web-static.test.js`, add after the Task 1 tests:

```js
test('an option card is an outlined card, not a ghost, and the chosen one fills lime', () => {
  // WHY THE GHOST GOES FROM TEXT CARDS AND STAYS ON PHOTOGRAPHS. An unchosen
  // option used to be the same markup at half opacity, and "chosen" was full
  // opacity plus the name in the accent. Spec §6 gives every option card an
  // outline; an outline in --line (0.14 alpha) multiplied by --ghost (0.5) is
  // a 0.07-alpha line, which is invisible, so the two states would be "no card"
  // and "lime card". The outline carries "here is a choice" at full strength
  // and the fill carries "this one". A photograph is different: dimming it is
  // exactly how the world says which picture is lit (see the .thumb comment),
  // so the place card keeps its ghost and takes a ring instead of a fill.
  const { css } = createStylesheet(FOCUS_MENU);
  for (const kind of ['lookcard', 'qualitycard', 'framecard']) {
    const base = new RegExp(`\\n\\.${kind}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(base, `no .${kind} rule`);
    assert.match(base[1], /border:\s*1px solid var\(--line\)/, `.${kind} is not outlined`);
    assert.match(base[1], /border-radius:\s*var\(--r-sm\)/, `.${kind} does not take the small radius`);
    assert.ok(!/opacity:\s*var\(--ghost\)/.test(base[1]), `.${kind} is still a ghost -- its outline is invisible at half opacity`);
    const soon = new RegExp(`\\n\\.${kind}--soon\\s*\\{([^}]*)\\}`).exec(css);
    if (soon) assert.match(soon[1], /opacity:\s*var\(--ghost\)/, `a deferred .${kind} lost its ghost -- "not yet" is still an unlit value`);
  }
  // The FOCUS_MENU's own ids, so the assertion follows the fixture.
  assert.ok(css.includes('#of-tshirt-jeans:checked~.wrap .lookcard--of-tshirt-jeans{background:var(--lime);border-color:var(--lime);}'), 'the chosen outfit does not fill lime');
  assert.ok(css.includes('#of-tshirt-jeans:checked~.wrap .lookcard--of-tshirt-jeans .name{color:var(--on-lime);}'), 'the chosen outfit keeps page ink on lime');
  assert.ok(css.includes('#of-tshirt-jeans:checked~.wrap .lookcard--of-tshirt-jeans .detail{color:var(--on-lime-soft);}'), 'the chosen outfit detail keeps page ink on lime');
  assert.ok(css.includes('#q-480p:checked~.wrap .qualitycard--q-480p{background:var(--lime);border-color:var(--lime);}'), 'the chosen quality does not fill lime');
  assert.ok(css.includes('#a-4x3:checked~.wrap .framecard--a-4x3{background:var(--lime);border-color:var(--lime);}'), 'the chosen shape does not fill lime');
  assert.ok(css.includes('#a-4x3:checked~.wrap .framecard--a-4x3 .shape{border-color:var(--on-lime);}'), 'the glyph on a lime card is not drawn in the on-lime ink');
  // Lime means chosen. Nothing unchosen wears it -- not the glyph, not the mark.
  for (const m of css.matchAll(/([^{}\n]*\.shape[^{}]*)\{([^}]*)\}/g)) {
    if (/:checked/.test(m[1])) continue;
    assert.ok(!/var\(--(accent|accent-deep|lime)\)/.test(m[2]), `an unchosen shape glyph is drawn in lime: "${m[1].trim()}"`);
  }
  for (const m of css.matchAll(/\.(lookcard|qualitycard|framecard) \.tick\s*\{([^}]*)\}/g)) {
    assert.match(m[2], /color:\s*var\(--on-lime\)/, `.${m[1]} .tick only ever shows on a lime card and is not in the on-lime ink`);
  }
  // Hierarchy inside a card is colour again now that nothing multiplies it.
  const detail = /\.lookcard \.detail\s*\{([^}]*)\}/.exec(css);
  assert.match(detail[1], /color:\s*var\(--ink-soft\)/, 'an unchosen card cannot use the soft tier only while it is ghosted; it is not ghosted');
});

test('the chosen place keeps its photograph and takes a lime ring and a lime badge', () => {
  const { css } = createStylesheet(FOCUS_MENU);
  assert.ok(css.includes('#pl-ostsee-strand:checked~.wrap .placecard--pl-ostsee-strand{transform:scale(1.03);box-shadow:0 0 0 2px var(--lime);}'), 'the chosen place carries no lime ring');
  assert.ok(css.includes('#pl-ostsee-strand:checked~.wrap .placecard--pl-ostsee-strand .thumb{opacity:1;}'), 'the chosen photograph is not lit');
  assert.ok(css.includes('#pl-own:checked~.wrap .placecard--own{transform:scale(1.03);box-shadow:0 0 0 2px var(--lime);}'), 'the own-place card is chosen without the ring');
  const badge = /\.placecard \.badge\s*\{([^}]*)\}/.exec(css);
  assert.ok(badge, 'no .placecard .badge rule');
  assert.match(badge[1], /background:\s*var\(--lime\)/, 'the badge is not a lime pill');
  assert.match(badge[1], /color:\s*var\(--on-lime\)/, 'the badge text is not the on-lime ink');
  assert.match(badge[1], /border-radius:\s*999px/, 'the badge is not a pill');
  assert.ok(!/text-shadow/.test(badge[1]), 'a filled pill needs no shadow to survive a photograph');
  const card = /\n\.placecard\s*\{([^}]*)\}/.exec(css);
  assert.ok(card, 'no .placecard rule');
  assert.match(card[1], /border-radius:\s*var\(--r-sm\)/, 'the place card is squared while every other card is rounded');
  assert.ok(!/box-shadow/.test(card[1]), 'every place card wears the ring');
  const thumb = /\n\.thumb\s*\{([^}]*)\}/.exec(css);
  assert.match(thumb[1], /opacity:\s*var\(--ghost\)/, 'the unlit photograph lost its ghost -- the ghost is what says which picture is lit');
});

test('a dropzone says so with a dashed outline, from the token', () => {
  const { css } = createStylesheet({});
  const drop = /\n\.drop\s*\{([^}]*)\}/.exec(css);
  assert.ok(drop, 'no .drop rule');
  assert.match(drop[1], /border:\s*1px dashed var\(--line\)/, 'the dropzone is not dashed -- spec §6 says a dashed --line outline');
  assert.match(drop[1], /background:\s*var\(--ground\)/, 'the photo well is not recessed to the ground inside its card');
  const hover = /\.drop:hover\s*\{([^}]*)\}/.exec(css);
  assert.ok(hover, 'no .drop:hover rule');
  assert.match(hover[1], /border-color:\s*var\(--ink-soft\)/, 'hover does not brighten the outline');
  assert.ok(!/background/.test(hover[1]), 'hover still lifts the fill, which was the recess idiom');
  const slim = /\.drop--slim\s*\{([^}]*)\}/.exec(css);
  assert.ok(slim, 'no .drop--slim rule');
  assert.match(slim[1], /background:\s*var\(--card\)/, 'the place dropzone sits on an open panel; on the ground it needs the card plane to read as a well');
});

test('the record button stands beside the price, after the consent, not under a list', () => {
  const html = homePage({ ...FOCUS_MENU, consentText: 'I agree' });
  const commit = html.slice(html.indexOf('panel--commit'), html.indexOf('panel--archive'));
  const check = commit.indexOf('<label class="check">');
  const foot = commit.indexOf('<div class="commit-foot">');
  assert.ok(check > -1, 'no consent on the commit panel');
  assert.ok(foot > check, 'the consent does not come before the price and the button');
  const inside = commit.slice(foot, commit.indexOf('</div>', foot));
  assert.match(inside, /<dl class="facts">/, 'the facts are not in the row with the button');
  assert.match(inside, /<button type="submit" class="record" id="record"/, 'the button is not in the row with the facts');
  // The three facts are still the three facts, in the same words the tests
  // elsewhere read.
  assert.match(inside, /<dt>Length<\/dt><dd>15 SEC<\/dd>/);
  assert.match(inside, /<dt>Estimated cost<\/dt>/);
  assert.match(inside, /<dt>Credits<\/dt>/);
  const { css } = createStylesheet(FOCUS_MENU);
  assert.match(css, /\.commit-foot\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/, 'the row is not facts-then-button');
  assert.match(css, /\.commit-foot \.record\s*\{[^}]*width:\s*auto/, 'the button still spans the card instead of standing beside the price');
  assert.match(css, /@media \(max-width: 30rem\)\s*\{[^}]*\.commit-foot\s*\{[^}]*grid-template-columns:\s*1fr/, 'the row does not stack on a phone');
});
```

In `test/browser-smoke.test.js`, add after `the own-place card in the rail is a live control in both states`:

```js
test('after a selection, lime is on exactly one card in each option row, and it is the one chosen', { skip }, async () => {
  // Spec §8's named browser test. The stylesheet-text tests above prove the
  // generated rule exists; only a cascade can prove that exactly ONE card in a
  // row resolves to lime after a click -- a selector typo that matched every
  // card, or a later rule of equal specificity, passes every text assertion.
  const s = await session();
  await s.signIn();
  const page = await visit('/', LAPTOP);
  assert.deepEqual(page.errors, [], page.errors.join('; '));
  const r = await page.evaluate(`(() => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--lime)';
    document.body.appendChild(probe);
    const lime = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const rows = { look: '.looks label.lookcard', quality: '.quality label.qualitycard', frame: '.frames label.framecard' };
    const out = { lime };
    for (const [row, sel] of Object.entries(rows)) {
      const cards = [...document.querySelectorAll(sel)];
      const target = cards[cards.length - 1];
      target.click();
      const lit = cards.filter((c) => getComputedStyle(c).backgroundColor === lime);
      out[row] = { cards: cards.length, lit: lit.length, litIsTarget: lit.length === 1 && lit[0] === target,
        inkOnLime: getComputedStyle(target.querySelector('.name, .ratio')).color };
    }
    const places = [...document.querySelectorAll('.rail label.placecard:not(.placecard--own)')];
    places[1].click();
    const ringed = places.filter((p) => getComputedStyle(p).boxShadow.includes(lime));
    out.place = { cards: places.length, ringed: ringed.length, ringedIsTarget: ringed.length === 1 && ringed[0] === places[1],
      badge: getComputedStyle(places[1].querySelector('.badge')).backgroundColor };
    return out;
  })()`);
  for (const row of ['look', 'quality', 'frame']) {
    assert.ok(r[row].cards >= 2, `${row}: fewer than two cards to choose between`);
    assert.equal(r[row].lit, 1, `${row}: ${r[row].lit} cards are lime after one choice`);
    assert.ok(r[row].litIsTarget, `${row}: the lime card is not the one that was clicked`);
    assert.notEqual(r[row].inkOnLime, r.lime, `${row}: the chosen card's text is lime on lime`);
  }
  assert.equal(r.place.ringed, 1, `${r.place.ringed} place cards carry the lime ring after one choice`);
  assert.ok(r.place.ringedIsTarget, 'the ringed place is not the one that was clicked');
  assert.equal(r.place.badge, r.lime, 'the chosen place badge is not a lime pill');
});
```

Run the three files (`web-api` takes a while; run it whole). Expected: the two `web-api` assertions red (the sheet still emits `opacity:1`), the four `web-static` tests red, the browser test red on `look: 0 cards are lime`.

- [ ] **Step 2: The option cards.** In `static.mjs`, replace the `.lookcard` base block (from `.lookcard {` through `.lookcard .detail { … }`, keeping the two comments about the marks and the grid rule that follow) with:

```css
.lookcard {
  position: relative;
  padding: var(--s-3) var(--s-4);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: transparent;
  cursor: pointer;
  /* VALUES SNAP. The outline brightens on hover; the fill does not ease. */
  transition: border-color 140ms;
}
.lookcard:hover { border-color: var(--ink-soft); }
.lookcard .name { display: block; font-size: var(--t-2); color: var(--ink); }
/* HIERARCHY INSIDE A CARD IS COLOUR AGAIN. The rule that forbade the soft tier
   inside these cards was about GHOSTS -- --ink-soft under a 0.5 opacity is
   2.45:1 -- and the card is not a ghost any more. Unchosen it is an outline on
   the ground with page ink inside it; chosen it fills lime and the generated
   rule re-inks name and detail for the lime. */
.lookcard .detail { display: block; font-size: var(--t-1); color: var(--ink-soft); margin-top: 0.15rem; }
```

Change `.lookcard .tick { … color: var(--accent); … }` to `color: var(--on-lime);` (the mark only ever shows on a lime card). Replace the comment above the `.lookcard .tick` grid rules' "struck it sits on the name's baseline" with "chosen it sits on the name's baseline".

Replace the `.framecard` base block (from `.framecard {` through `.framecard .tick::before`) with:

```css
.framecard {
  position: relative; display: flex; align-items: center; gap: 0.6rem;
  padding: var(--s-2) var(--s-3);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: transparent;
  cursor: pointer;
  transition: border-color 140ms;
}
.framecard:hover { border-color: var(--ink-soft); }
.framecard .ratio { font-size: var(--t-2); font-weight: 600; letter-spacing: 0.08em; color: var(--ink); }
.framecard .detail { font-size: var(--t-label); color: var(--ink-soft); }
.framecard .tick { color: var(--on-lime); font-size: var(--t-label); opacity: 0; transition: opacity 140ms; }
.framecard .tick::before { content: "●"; }
```

Change `.framecard .shape { display: block; border: 1px solid var(--accent-deep); … }` to `border: 1px solid var(--ink);` and rewrite its comment: the glyph is drawn in ink because lime means chosen and an unchosen glyph in lime would say every shape is; the generated rule re-draws it in the on-lime ink on the chosen card. `.framecard--soon .shape { border-color: var(--faint); }` stays. `.framecard--soon { cursor: default; opacity: var(--ghost); }` and its hover stay (a deferred value is still unlit); rewrite its comment's "Opacity cannot carry this distinction on paper" to "Opacity cannot carry this distinction below the floor".

Replace the `.qualitycard` base block (from `.qualitycard {` through `.qualitycard .flag { … }`, before the grid-gutter comment) with:

```css
.qualitycard {
  position: relative; display: block;
  padding: var(--s-3) var(--s-4);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: transparent;
  cursor: pointer;
  transition: border-color 140ms;
}
.qualitycard:hover { border-color: var(--ink-soft); }
.qualitycard .name { display: block; font-family: var(--display); font-size: var(--t-3); letter-spacing: 0; text-transform: uppercase; line-height: 1; color: var(--ink); }
/* One price per shape, hidden until the frame row says which shape. Painting
   them all at once would list three numbers on one card; painting the un-shaped
   one quotes the 4:3 price for a shape charged 4/3 of it. The deferred tier is
   the exception and says so in its own class -- it has no per-shape quote to
   switch to, because creditCost refuses it outright. */
.qualitycard .cr { display: none; font-size: var(--t-label); letter-spacing: 0.14em; color: var(--ink); margin-top: 0.1rem; }
.qualitycard .cr--soon { display: block; }
.qualitycard .detail { display: block; font-size: var(--t-1); color: var(--ink-soft); margin-top: 0.35rem; }
.qualitycard .flag { display: inline-block; font-size: var(--t-label); letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink); margin-top: 0.4rem; }
```

Change `.qualitycard .tick { … color: var(--accent); … }` to `color: var(--on-lime);`. `.qualitycard--soon { cursor: default; opacity: var(--ghost); }` and its hover stay; rewrite the comment above them ("A refused value stays unlit rather than outlined: this world has no lines") — this world has lines now; a deferred value is outlined like its siblings AND ghosted, because "not yet" is still an unlit value and the flag says so in words.

- [ ] **Step 3: The place card, the badge, the dots.** In `.placecard {` change `border-radius: 0;` to `border-radius: var(--r-sm);`. Replace the `.placecard .badge` rule with:

```css
/* CHOSEN, ON THE IMAGE: a lime pill, the same object as the pricing page's
   Recommended mark, sitting on the picture it marks. Filled rather than
   text-with-a-shadow because a fill survives any photograph without a halo,
   and a halo on a photograph reads as a filter. Top-left, where the
   selection mark sits in every other row (§60G). */
.placecard .badge {
  position: absolute; top: 0.6rem; left: 0.6rem;
  font-size: var(--t-label); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--on-lime);
  background: var(--lime);
  border: 0; border-radius: 999px;
  padding: 0.15rem 0.55rem;
  opacity: 0;
  transition: opacity 160ms;
}
```

`.dot { … background: var(--line); }` is already the token after Task 1; leave it.

- [ ] **Step 4: The dropzones.** In `.drop {` change `border: 0;` to `border: 1px dashed var(--line);` and rewrite the "DEPTH, NOT A DASHED BOX" comment: the well AND a dashed outline, because spec §6 names the dash and a recess alone read as a heading on the open step-3 panel. Replace `.drop:hover { background: var(--card); }` and the two comments above it with:

```css
/* Hover brightens the outline rather than lifting the fill: the fill is what
   says "well", the dash is what says "drop here", and only the second should
   answer the pointer. */
.drop:hover { border-color: var(--ink-soft); }
```

`.drop--slim { … background: var(--card); }` is right after Task 1 (it sits on the transparent choice panel, so the card plane is what makes it a well there); keep it and its comment.

- [ ] **Step 5: The generated rules.** In `presetCss`, edit these template strings exactly as listed under Interfaces:

```js
      // was: `#${slug}:checked~.wrap .placecard--${slug}{transform:scale(1.03);}`
      `#${slug}:checked~.wrap .placecard--${slug}{transform:scale(1.03);box-shadow:0 0 0 2px var(--lime);}`,
```

```js
    // the outfit block, replacing the three `.lookcard--` lines and the NO HALO comment
      // CHOSEN FILLS LIME. The card's outline and fill become the accent and its
      // text takes the ink solved for lime; the mark lights. No halo, no ghost.
      `#${slug}:checked~.wrap .lookcard--${slug}{background:var(--lime);border-color:var(--lime);}`,
      `#${slug}:checked~.wrap .lookcard--${slug} .name{color:var(--on-lime);}`,
      `#${slug}:checked~.wrap .lookcard--${slug} .detail{color:var(--on-lime-soft);}`,
      `#${slug}:checked~.wrap .lookcard--${slug} .tick{opacity:1;}`,
```

```js
    // the resolution block, replacing the three `.qualitycard--` lines
      `#${slug}:checked~.wrap .qualitycard--${slug}{background:var(--lime);border-color:var(--lime);}`,
      `#${slug}:checked~.wrap .qualitycard--${slug} .name,#${slug}:checked~.wrap .qualitycard--${slug} .cr,#${slug}:checked~.wrap .qualitycard--${slug} .flag{color:var(--on-lime);}`,
      `#${slug}:checked~.wrap .qualitycard--${slug} .detail{color:var(--on-lime-soft);}`,
      `#${slug}:checked~.wrap .qualitycard--${slug} .tick{opacity:1;}`,
```

```js
    // the aspect block, replacing the four `.framecard--` lines (the `.cr--` line stays)
      `#${slug}:checked~.wrap .framecard--${slug}{background:var(--lime);border-color:var(--lime);}`,
      `#${slug}:checked~.wrap .framecard--${slug} .ratio,#${slug}:checked~.wrap .framecard--${slug} .detail{color:var(--on-lime);}`,
      `#${slug}:checked~.wrap .framecard--${slug} .shape{border-color:var(--on-lime);}`,
      `#${slug}:checked~.wrap .framecard--${slug} .tick{opacity:1;}`,
```

```js
    // the own-place block
    `#pl-own:checked~.wrap .placecard--own{transform:scale(1.03);box-shadow:0 0 0 2px var(--lime);}`,
```

Rewrite the "STRUCK LIGHTS THE PHOTOGRAPH" comment to "CHOSEN LIGHTS THE PHOTOGRAPH AND RINGS THE CARD": the ghost lives on `.thumb`, so the rule that lifts it names that element; the ring is a box-shadow rather than a border so the card's box does not move by two pixels when chosen. `focusRing` is unchanged: its `outline:2px solid var(--ink)` is drawn with a positive offset OUTSIDE the card, on the dark surface, so it is right on a lime card too.

- [ ] **Step 6: The commit row.** In `views.mjs`, in `homePage`'s `panel--commit` section, move the `<label class="check">…</label>` block ABOVE the `<dl class="facts">`, and wrap the `dl` and the button:

```html
    <label class="check">
      …unchanged…
    </label>

    ${''/* THE PRICE STANDS BESIDE THE BUTTON (2026-09-07, spec §6: "the Record
          button lime with the price beside it"). The three facts and the button
          used to stack with the consent between them, so the number a person
          was agreeing to sat two blocks above the thing that spent it. One row
          now: agree, then read the price, then press -- and on a phone the row
          stacks with the price above the button. The facts keep their words;
          tests elsewhere read them. */}
    <div class="commit-foot">
    <dl class="facts">
      <dt>Length</dt><dd>15 SEC</dd>
      <dt>Estimated cost</dt><dd>${costLines}</dd>
      <dt>Credits</dt><dd>${h(`${balance.credits} CR`)}</dd>
    </dl>
    <button type="submit" class="record" id="record"${brokeEntirely ? ' disabled' : ''}>&#10685; Record the tape</button>
    </div>
    ${brokeEntirely …unchanged reasons… }
```

In `static.mjs`, after the `.facts dd` rule add:

```css
/* THE PRICE BESIDE THE BUTTON. Two columns, the facts filling and the button
   sized to its own label, aligned on the bottom edge so the button stands
   level with the credits line. Below 30rem -- the width where the nav wraps
   too -- the row stacks and the button takes the full width again. */
.commit-foot { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: var(--s-5); align-items: end; margin: var(--s-5) 0 0; }
.commit-foot .facts { margin: 0; }
.commit-foot .record { width: auto; margin-top: 0; padding: 0.85rem 1.6rem; }
@media (max-width: 30rem) {
  .commit-foot { grid-template-columns: 1fr; row-gap: var(--s-4); }
  .commit-foot .record { width: 100%; }
}
```

- [ ] **Step 7: Parse check, run the three files.**

```bash
node --check scripts/web/static.mjs && node --check scripts/web/views.mjs && echo PARSE-OK
node --test test/web-static.test.js
node --test test/web-api.test.js
node --test test/browser-smoke.test.js
```

Expected: all green. If `every hoisted radio marks its visible label when it takes focus` fails, a class name changed in a card template; it must not. If `the selection mark sits at the left of its card, in every row` fails, the added horizontal padding moved the mark and the name unequally; both are in the grid and should move together.

- [ ] **Step 8: DESIGN.md.** Replace the **Ghosts and the floor** section with:

```markdown
## Ghosts and the floor

A ghost is an unlit PHOTOGRAPH, a deferred option and a phase still to come,
at `--ghost: 0.5`. `--ink` at that opacity measures 4.83:1 over the ground and
4.70:1 over a card; .48 is the least that clears the card. A ghost sits at the
floor and no lower, and nothing inside a ghosted control is written in the
soft tier, because colour is what an opacity multiplies away. Both are tests.

A text option card is not a ghost (since 2026-09-07). Unchosen it is an
outlined card on the ground with page ink inside it — name in `--ink`, detail
in `--ink-soft`, which the outline at full strength allows; chosen it fills
lime, its text takes `--on-lime` and `--on-lime-soft`, and its mark lights. A
chosen photograph keeps its picture, lifts it out of the ghost, and takes a
2px lime ring and a lime badge. A browser test clicks every row and counts
exactly one lime card in each.
```

In **The three rules**, rule 1, after "the big display moments." add: "Chosen is a FILL on a text card and a RING on a photograph; the glyph on an unchosen shape card and the mark on an unchosen option are ink, never lime."

- [ ] **Step 9: The full suite, the sabotages, the guards, the commit.** Sabotages from copies:
(a) change the outfit template's `background:var(--lime);border-color:var(--lime);` to `opacity:1;` → the `web-api` assertion and the option-card test fail on the exact string;
(b) change `.framecard .shape`'s `var(--ink)` back to `var(--accent-deep)` → the option-card test names the unchosen glyph;
(c) delete `background: var(--lime);` from `.placecard .badge` → the place test fails, and the browser test's `badge` assertion fails;
(d) change `.drop`'s `dashed` to `solid` → the dropzone test fails;
(e) change the quality template's selector to `.qualitycard{` (dropping `--${slug}`) so every quality card lights → the browser test reports `quality: 2 cards are lime`; this one proves the browser test binds where the text tests cannot.

```bash
npm test > build/suite.log 2>&1; echo "exit $?"; tail -12 build/suite.log
```

Expected: `fail 0`, `tests 2158` (Task 1 + 5). Seven guards, 7/7.

```bash
git add scripts/web/static.mjs scripts/web/views.mjs DESIGN.md test/web-static.test.js test/web-api.test.js test/browser-smoke.test.js
git commit -F build/commitmsg.txt
```

Message: `order form: option cards are outlined and the chosen one fills lime; the chosen place keeps its picture and takes a ring and a badge; dropzones are dashed; Record stands beside its price`.

- [ ] **Step 10: STOP. Show the owner `/` signed in**, at 375 and 1440, with a place, an outfit, a shape and a quality chosen, and once with the balance too low so the refused button shows. Also regenerate `build/preview-home.mjs`'s output (it renders the real catalog with the real generated sheet) for the version he can open offline. Questions: the fill-versus-outline of the four steps (Task 1's answer applied), and whether the chosen lime card is what he expected. Apply answers as small test-first follow-ups.

---

### Task 3: Status and result — the phases are cards with a red record light; the tape sits in the card outline (STOPS FOR THE OWNER TO LOOK)

**Files:**
- Modify: `scripts/web/static.mjs` (`.status .headline` ~1864; `.phases`/`.phase`/`.phase-title` ~1866–1874; `.reclight` and `.reclight .dot` ~1894–1895; `.player` ~1980–1985; `.result-words .headline` ~2041)
- Test: `test/web-static.test.js` (two added), `test/browser-smoke.test.js` (`session()` seeds a running job; one added)

**Interfaces:**
- Consumes: `.panel`/card language (Task 1), `--rec`, `--card`, `--line`, `--r-sm`, `--d-3`, the `tally` keyframes (unchanged).
- Produces: `.phase` = an outlined card; `.reclight` and `.reclight .dot` in `--rec`; `s.running` on the browser session (a job in status `running` owned by the test account) for any later test that needs the record light.

**Decision taken here, the owner can overrule at the stop:** phase titles ("Arrive", "The scene", "The tape") are set in Anton at `--d-3`, the size DESIGN.md gives card titles, because the phase rows are cards now and the pricing cards title themselves the same way. The phase NOTE stays in Inter at `--t-1`.

- [ ] **Step 1: The tests (RED).** In `test/web-static.test.js`:

```js
test('the phase rows are outlined cards, titled in the display face, and the record light is red', () => {
  // A LIME REC LIGHT IS NOT A REC LIGHT (spec §2.1). The status page's light
  // took --accent when the accent was cathode orange and kept the name when
  // the accent became lime, so the one element the palette reserves red for
  // was the one element painted in the colour that means "chosen". The
  // wordmark's dot is --rec and still; this one is --rec and blinks.
  const { css } = createStylesheet({});
  const phase = /\n\.phase\s*\{([^}]*)\}/.exec(css);
  assert.ok(phase, 'no .phase rule');
  assert.match(phase[1], /background:\s*var\(--card\)/, 'a phase row is not on the card plane');
  assert.match(phase[1], /border:\s*1px solid var\(--line\)/, 'a phase row is not outlined');
  assert.match(phase[1], /border-radius:\s*var\(--r-sm\)/, 'a phase row does not take the small radius');
  const title = /\.phase-title\s*\{([^}]*)\}/.exec(css);
  assert.ok(title, 'no .phase-title rule');
  assert.match(title[1], /font-family:\s*var\(--display\)/, 'a card title is set in the body face');
  assert.match(title[1], /font-size:\s*var\(--d-3\)/, 'a card title is not at the card-title size');
  assert.match(title[1], /text-transform:\s*uppercase/, 'the display face is not uppercase');
  const light = /\n\.reclight\s*\{([^}]*)\}/.exec(css);
  assert.ok(light, 'no .reclight rule');
  assert.match(light[1], /color:\s*var\(--rec\)/, 'REC is not red');
  const dot = /\.reclight \.dot\s*\{([^}]*)\}/.exec(css);
  assert.ok(dot, 'no .reclight .dot rule');
  assert.match(dot[1], /background:\s*var\(--rec\)/, 'the lamp is not red');
  assert.match(dot[1], /animation:\s*tally/, 'the lamp stopped blinking -- it is the one thing on the site that may');
  for (const m of css.matchAll(/(\.reclight[^{}]*)\{([^}]*)\}/g)) {
    assert.ok(!/var\(--(accent|accent-deep|lime)\)/.test(m[2]), `"${m[1].trim()}" paints the record light in the accent`);
  }
  assert.match(css, /\.status \.headline\s*\{[^}]*font-size:\s*var\(--t-7\)/, 'the status heading is not at the page-title size');
});

test('the payoff page frames the tape in the card outline and heads it at the page-title size', () => {
  const { css } = createStylesheet({});
  const player = /\n\.player\s*\{([^}]*)\}/.exec(css);
  assert.ok(player, 'no .player rule');
  assert.match(player[1], /border:\s*1px solid var\(--line\)/, 'the tape is not in the card outline');
  assert.match(player[1], /border-radius:\s*var\(--r\)/, 'the tape does not take the card radius');
  // The colour behind the picture is the tape's own matte, not the interface's
  // card: PALETTE.ground is what the renderer mattes a 4:3 tape onto, and it
  // must stay whatever the interface is painted.
  assert.match(player[1], /background:\s*#0B0A09/i, "the player's ground is not the tape's matte");
  assert.match(css, /\.result-words \.headline\s*\{[^}]*font-size:\s*var\(--t-7\)/, 'the result heading is not at the page-title size');
});
```

In `test/browser-smoke.test.js`, in `session()`, after `const finished = seedJob(…)` add `const running = seedJob(app, root, { status: 'running', owner: account });` and add `running` to the `shared` object beside `queued, finished`. (`seedJob` already handles `'running'`: any status other than `queued` calls `setJobStatus(job, 'running')`, and only `'done'` goes on to complete it. `phaseState` in `views.mjs` puts the record light on the current phase whenever the job's status is `running`, whatever the steps say.) Then add after `the status page runs its poller under the CSP the server really sends`:

```js
test('the record light on the phase being filmed is red and blinking, in a real cascade', { skip }, async () => {
  const s = await session();
  await s.signIn();
  const page = await visit(`/j/${s.running.jobId}`, PHONE);
  assert.deepEqual(page.errors, [], page.errors.join('; '));
  const r = await page.evaluate(`(() => {
    const dot = document.querySelector('.reclight .dot');
    if (!dot) return { found: false };
    const probe = document.createElement('div');
    probe.style.background = 'var(--rec)';
    document.body.appendChild(probe);
    const rec = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const cs = getComputedStyle(dot);
    const phase = dot.closest('.phase');
    const pcs = getComputedStyle(phase);
    return {
      found: true, rec,
      background: cs.backgroundColor, animation: cs.animationName,
      border: pcs.borderTopWidth + ' ' + pcs.borderTopStyle,
      phases: document.querySelectorAll('.phase').length,
      lights: document.querySelectorAll('.reclight').length,
    };
  })()`);
  assert.ok(r.found, 'a running job shows no record light');
  assert.equal(r.background, r.rec, `the lamp is ${r.background}, not the record-light red ${r.rec}`);
  assert.equal(r.animation, 'tally', `the lamp is not blinking (animation "${r.animation}")`);
  assert.equal(r.border, '1px solid', `the phase row is not an outlined card (${r.border})`);
  assert.equal(r.phases, 3);
  assert.equal(r.lights, 1, 'more than one phase carries the record light');
});
```

Run `web-static` and `browser-smoke`. Expected: the two `web-static` tests red (`.phase` has no background; `.reclight` is `var(--accent)`), the browser test red on the lamp's colour.

- [ ] **Step 2: The status rules.** In `static.mjs`:

```css
.status .headline { font-size: var(--t-7); text-wrap: balance; }
.counter { …unchanged… }
.phases { list-style: none; padding: 0; margin: 0 0 var(--s-6); display: grid; gap: var(--s-3); }
/* EACH PHASE IS A CARD (2026-09-07, spec §6). The row grid is unchanged
   inside it: state, body, number. The card is what makes three rows read as
   three things a render does rather than three lines of a list. */
.phase {
  display: grid; grid-template-columns: 5rem minmax(0, 1fr) auto; column-gap: var(--s-4); align-items: baseline;
  padding: var(--s-4) var(--s-5);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
```

`.phase-title { display: block; font-family: var(--display); font-size: var(--d-3); line-height: 0.92; letter-spacing: 0; text-transform: uppercase; font-weight: 400; color: var(--ink); }` replaces the Inter rule. Then the light:

```css
/* THE RECORD LIGHT IS RED. It took --accent when the accent was cathode
   orange and kept the name through two palettes, so in the lime world the one
   element the palette reserves red for was the one painted in the colour
   that means "chosen". A lime REC light is not a REC light (spec §2.1). */
.reclight { color: var(--rec); }
.reclight .dot { display: inline-block; background: var(--rec); animation: tally 1.6s steps(1, end) infinite; }
```

Keep the rest of the `.reclight` comment (the `.rec` collision and the steps() reasoning), the `tally` keyframes and the reduced-motion line as they are. `.phase-done .phase-state` stays lime: done is "go".

- [ ] **Step 3: The result rules.** `.player { background: ${PALETTE.ground}; border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; line-height: 0; }` — rewrite its comment's last sentence: the outline is the card's, the colour behind the picture is the tape's. `.result-words .headline { font-size: var(--t-7); text-wrap: balance; max-inline-size: 18ch; }`.

- [ ] **Step 4: Parse check, run the files, then the full suite, the sabotages, the guards, the commit.** Sabotages: (a) `.reclight .dot` back to `var(--accent)` → both new tests red; (b) delete `.phase`'s `border:` → the text test and the browser `border` assertion red; (c) `.phase-title` back to Inter → the text test red.

Expected: `fail 0`, `tests 2161` (Task 2 + 3).

```bash
git add scripts/web/static.mjs test/web-static.test.js test/browser-smoke.test.js
git commit -F build/commitmsg.txt
```

Message: `status and result: the phases are outlined cards titled in the display face with a red record light, and the tape sits in the card outline`.

- [ ] **Step 5: STOP. Show the owner** the status page in its running and failed states and the result page with a finished tape, rendered by `build/preview-pages.mjs` (regenerate it; it inlines the current sheet) and served on the `preview` launch config, at 375 and 1440. If a finished job of his own exists locally under `out/owners/`, the live `/j/<id>/result` is better. Questions: the phase titles in Anton, and the red.

---
### Task 4: My videos and the account page — the one-way door is an outlined button, and the address stays an address (STOPS FOR THE OWNER TO LOOK)

**Files:**
- Modify: `scripts/web/static.mjs` (a new `.record--danger` rule after `.record:disabled`; `.account .headline` ~2071)
- Modify: `DESIGN.md` (**Type**: the one exception)
- Test: `test/web-static.test.js` (one added)

**Interfaces:**
- Consumes: `.tape .frame` outlined (Task 1); `.headline` metrics (Task 1); `--card`, `--line`, `--ink`, `--sans`, `--t-5`.
- Produces: `.record--danger` = an outlined card button in ink; `.account .headline` = the address in the body face. Nothing later depends on either.

**What spec §6 asks of these two pages** ("Shelf tiles with the outline; the balance sentence") is already true after Task 1: the tiles are outlined, the sentence is `balanceSentence()`. What is left is what the sweep found: `.record--danger` is in the markup and styled by NOTHING, so the delete-account button renders as the lime Record button — "go" on the one control that is the opposite of go — and the account heading sets an email address in the poster face, uppercased.

**Decision taken here, the owner can overrule at the stop:** the address is data, not a heading. `.headline` is Anton and uppercase everywhere else because a heading is a display moment; an email address uppercased is a different string (the local part is case-sensitive by the standard), and in a condensed poster face it reads as shouting. It stays the page's `<h1>` (the test and the markup are unchanged) and takes the body face at 600 weight, `--t-5`, sentence case.

- [ ] **Step 1: The test (RED).** In `test/web-static.test.js`:

```js
test('the one-way door is an outlined button in ink, and the account heading is the address in the body face', () => {
  // THE DELETE BUTTON WAS LIME. `.record--danger` was written into the markup
  // on 2026-08-29 and no rule ever named it, so the cascade gave it .record's
  // lime -- "go" -- on the one control whose whole meaning is the opposite.
  // There is no alarm red in this world (DESIGN.md rule 2), so danger is weight
  // and words: the same outlined card every other secondary control is, its
  // label in ink, and the sentence above it saying there is no undo.
  const { css } = createStylesheet({});
  const danger = /\.record--danger\s*\{([^}]*)\}/.exec(css);
  assert.ok(danger, 'no .record--danger rule -- the class is in the markup and styled by nothing, so the button is lime');
  assert.match(danger[1], /background:\s*var\(--card\)/, 'the one-way door is not on the card plane');
  assert.match(danger[1], /border:\s*1px solid var\(--line\)/, 'the one-way door is not outlined');
  assert.match(danger[1], /color:\s*var\(--ink\)/, 'the one-way door is not written in ink');
  assert.ok(!/var\(--(rec|lime|accent|accent-bright)\)/.test(danger[1]), 'the one-way door is lime or red -- it is neither go nor the record light');
  const hover = /\.record--danger:hover\s*\{([^}]*)\}/.exec(css);
  assert.ok(hover, 'no hover for the one-way door');
  assert.ok(!/var\(--(lime|accent|accent-bright)\)/.test(hover[1]), 'hovering the one-way door turns it lime');
  // The address is data.
  const head = /\.account \.headline\s*\{([^}]*)\}/.exec(css);
  assert.ok(head, 'no .account .headline rule');
  assert.match(head[1], /font-family:\s*var\(--sans\)/, 'an email address is set in the poster face');
  assert.match(head[1], /text-transform:\s*none/, 'an email address is uppercased, which makes it a different string');
  assert.match(head[1], /overflow-wrap:\s*anywhere/, 'a long address cannot break');
  // And the page still says what it said.
  const html = accountPage({ account: { email: 'paul@example.com' }, balance: { credits: 43 }, csrf: 't', cheapest: { id: '480p', credits: 21 } });
  assert.match(html, /<h1 class="headline">paul@example.com<\/h1>/, 'the heading is no longer the address');
  assert.match(html, /<button type="submit" class="record record--danger">Delete my account<\/button>/, 'the one-way door lost its class or its words');
});
```

Run: expected red on `no .record--danger rule`.

- [ ] **Step 2: The rules.** In `static.mjs`, after `.record:disabled { … }` add:

```css
/* THE ONE-WAY DOOR IS NOT GO. `.record--danger` was in the markup from
   2026-08-29 and styled by nothing, so it rendered as the lime Record button.
   There is no alarm red in this world; danger is weight and words -- the
   sentence above the form says there is no undo -- and the control itself is
   the same outlined card every secondary control is, in ink. Hover brightens
   the outline and never the fill. */
.record--danger { background: var(--card); color: var(--ink); border: 1px solid var(--line); }
.record--danger:hover { background: var(--card); border-color: var(--ink); }
```

Replace `.account .headline { font-size: var(--t-6); overflow-wrap: anywhere; }` with:

```css
/* THE ADDRESS IS DATA, NOT A HEADING. Every other .headline is the display
   face, uppercase; an email address uppercased is a different string and in a
   condensed poster face it shouts. It stays the page's h1 -- the markup and the
   accessible outline are unchanged -- and takes the body face at 600. The
   display-metrics test skips a rule that names --sans for exactly this. */
.account .headline { font-family: var(--sans); font-weight: 600; font-size: var(--t-5); line-height: 1.2; letter-spacing: 0; text-transform: none; overflow-wrap: anywhere; }
```

- [ ] **Step 3: DESIGN.md.** In **Type**, after the bullet "Anton is never set below 18px…", add:

```markdown
- **An identifier is data, not a heading.** The account page's `<h1>` is the
  signed-in address; it keeps the body face at 600, sentence case, because an
  email address uppercased is a different string. This is the one `.headline`
  that is not Anton, and the metrics test exempts it by the face it names.
```

- [ ] **Step 4: Parse check, `web-static`, then the full suite, the sabotages, the guards, the commit.** Sabotages: (a) delete the `.record--danger` rule → red on its first line; (b) put `text-transform: uppercase` on `.account .headline` → red. Expected: `fail 0`, `tests 2162`.

```bash
git add scripts/web/static.mjs DESIGN.md test/web-static.test.js
git commit -F build/commitmsg.txt
```

Message: `videos and account: the one-way door is an outlined button in ink, and the address stays an address in the body face`.

- [ ] **Step 5: STOP. Show the owner `/videos` and `/account`** signed in, at 375 and 1440 — `/videos` empty and with tapes if his local account has any. Questions: the address in the body face, and the delete button as an outlined card.

---

### Task 5: Onboarding — the last photograph ground goes, and the scrim is solved for the ink the band actually paints (STOPS FOR THE OWNER TO LOOK)

**Files:**
- Modify: `scripts/web/views.mjs` (`singlePlaceGround` and its comment, ~1100–1117, deleted)
- Modify: `scripts/web/server.mjs` (the `singlePlaceGround` import ~107; the onboarding route's `ground` comment and constant ~3366–3373)
- Modify: `scripts/web/views-auth.mjs` (`onboardingPage` ~350–403: the header comment, the `ground` parameter, `preBody`, `bodyClass`)
- Modify: `scripts/web/static.mjs` (the `.has-ground` block ~2367–2391 deleted; `.bg--lit` and its comment ~731–735 deleted; `SCRIM_BONE` → `export const SCRIM_INK` ~210 with the solver comment ~183–208 rewritten)
- Modify: `DESIGN.md` (**Text on a photograph**)
- Modify (scratch, not committed): `build/preview-onboarding.mjs` drops `singlePlaceGround`
- Test: `test/web-static.test.js` (one rewritten, one added; the import list changes), `test/browser-smoke.test.js` (the onboarding sweep rewritten)

**Interfaces:**
- Consumes: `.panel` as a card (Task 1). The landing band's `.bgs`/`.bg`/`.scrim`/`.bgv` base rules and the generated `.bg--<slug>` layers, which stay because the band is what they are for.
- Produces: `onboardingPage({ account, consentText, csrf, error })` — no `ground`; `export const SCRIM_INK = [0xFA, 0xF7, 0xF2]` from `static.mjs`; no `singlePlaceGround` export from `views.mjs`; the class `has-ground` and the rule `.bg--lit` exist nowhere.

**Why delete rather than restyle.** Spec §6: "Its dark ground is now every page's ground, so `singlePlaceGround()` and the `--frost-lit` plate rule for it are deleted rather than kept." §63 put the photograph behind onboarding so the cream did not begin until the work started; there is no cream now, and a photograph behind the one page whose job is a four-second consent form is the one photograph left behind text that is not the band. The band keeps the mechanism.

**Why `SCRIM_BONE` changes.** `scrimOpacity()` solves, per place, the least scrim that lets the body text clear 8:1 over that place's loop — and it solves for `[0xED, 0xE7, 0xDC]`, the cream world's bone, a colour nothing paints any more (CLAUDE.md §70E). The only text over a scrim today is the band's, in `--on-image #FAF7F2`. Solving for the ink that is actually painted moves the per-place scrims by a step or two in the SAFE direction (a brighter ink needs a slightly heavier scrim), and a test ties the constant to the `--on-image` token so the two cannot drift apart again. The soft-label tier is still deliberately outside the solve: a second test refuses any `--ink-soft`/`--faint` colour inside `.band`, which is the successor to §63C's deleted dim-tier-needs-a-plate rule (spec §8 deleted the plate rule; §70B named the gap).

- [ ] **Step 1: The tests (RED).** In `test/web-static.test.js`, change the two import lines: drop `singlePlaceGround` from the `views.mjs` import, and make the `static.mjs` import `import { createStylesheet, SCRIM_INK } from '../scripts/web/static.mjs';`. Replace the test `the onboarding page carries a ground when it is given one, and a plain page when it is not` with:

```js
test('the onboarding page is a card on the ground, with no photograph behind it', async () => {
  // §63 put a place photograph behind this page so the cream did not begin
  // until the work started. There is no cream now: the ground is every page's
  // ground (spec §6), and a photograph behind a four-second consent form is
  // the one photograph left behind text that is not the landing's band. The
  // band keeps the mechanism -- .bgs, .bg, .scrim, the generated layers -- and
  // this page keeps none of it.
  const html = onboardingPage({ account: { email: 'a@b.com', consent: null }, consentText: 'I confirm.', csrf: 't' });
  assert.ok(!/has-ground/.test(html), 'onboarding still claims a ground');
  assert.ok(!/class="bgs"/.test(html), 'onboarding still emits background layers');
  assert.ok(!/class="scrim"/.test(html), 'onboarding still emits a scrim');
  assert.ok(!/bg--lit/.test(html), 'onboarding still lights a layer');
  assert.ok(!/<video/.test(html), 'onboarding ships a video it has no script to drive');
  assert.match(html, /<section class="panel">/, 'the consent card is gone');
  assert.match(html, /Agree and continue/, 'the consent form is gone');
  assert.match(html, /class="wrap wrap--narrow"/, 'the narrow column is gone');
  // The helper is deleted, not left dormant: a function that emits a ground
  // nobody renders is the next person's "why is this here".
  const views = await import('../scripts/web/views.mjs');
  assert.equal(views.singlePlaceGround, undefined, 'singlePlaceGround is still exported -- delete it');
  const { css } = createStylesheet(FOCUS_MENU);
  assert.ok(!/has-ground/.test(css), 'the sheet still carries rules for a ground no page has');
  assert.ok(!/\.bg--lit/.test(css), 'the sheet still lights a layer by class; the band lights by radio');
  assert.match(css, /\.band \.bgs\s*\{/, "the band's ground is what the shared layers are still for, and it is gone");
});

test("the band's scrim is solved for the ink the band paints, and no dim tier sits over its photograph", () => {
  // THE SOLVER PROTECTED A COLOUR NOBODY PAINTS. scrimOpacity() finds, per
  // place, the least scrim that lets the body text clear 8:1 over that
  // place's loop -- and it solved for the cream world's bone, a value the
  // dead-values test forbids in the sheet and that survived only because it
  // was written as bytes in JS. The only text over a scrim is the band's, in
  // --on-image. Tying the constant to the token means the two cannot drift.
  const { css } = createStylesheet(FOCUS_MENU);
  const onImage = /--on-image:\s*#([0-9A-Fa-f]{6})/.exec(css);
  assert.ok(onImage, 'no --on-image literal in the sheet');
  const bytes = [0, 2, 4].map((i) => parseInt(onImage[1].slice(i, i + 2), 16));
  assert.deepEqual(SCRIM_INK, bytes, 'the scrim solver protects a colour the band does not paint');
  // THE SUCCESSOR TO §63C's PLATE RULE. That rule said: on a page sitting on a
  // photograph, the dim tier does not appear without a plate under it. The
  // plate went with the cream; the band has no plate; so the rule becomes: in
  // the band, every colour is an on-image tier. The soft tier is deliberately
  // outside the scrim solve (it would drag every place above 0.59), which is
  // exactly why it may not be painted there.
  const bandRules = [...css.matchAll(/\n(\.band[^{}]*)\{([^}]*)\}/g)];
  assert.ok(bandRules.length >= 4, `the band has ${bandRules.length} rules -- the probe is not reading it`);
  for (const [, sel, body] of bandRules) {
    const color = /(^|;|\s)color:\s*([^;]+);/.exec(body);
    if (!color) continue;
    assert.match(color[2], /^var\(--on-image(-soft|-accent)?\)$/, `"${sel.trim()}" paints ${color[2].trim()} over the photograph -- the dim tier has no plate here`);
  }
});
```

In `test/browser-smoke.test.js`, rename `every word on the onboarding page survives the photograph it sits on` to `every word on the onboarding page clears the floor on the flat ground, and no photograph is behind it`, delete the `layer`/`lcs` lines and the `litOpacity`/`litImage` keys from the probe, and replace the five ground assertions (`r.hasGround`, `r.ground`, `r.scrim`, `r.litOpacity`, `r.litImage`) with:

```js
    assert.ok(!r.hasGround, `at ${viewport.width}px onboarding still carries the ground class`);
    assert.ok(!r.ground, `at ${viewport.width}px a photograph is back behind the onboarding page`);
    assert.ok(!r.scrim, `at ${viewport.width}px a scrim is back on the onboarding page`);
```

Keep the contrast sweep and its `items.length >= 4` and `failed` assertions exactly; update the comment ("THE GROUND HAS TO BE VISIBLE…") to say the page has no ground and the sweep now measures text on the flat ground, which is the same probe the palette test does by arithmetic. Run `web-static` and `browser-smoke`: expected red — the onboarding test on `has-ground`, the scrim test on `SCRIM_INK` (not exported: `undefined`), the browser test on `hasGround`.

- [ ] **Step 2: Delete the ground.** In `views.mjs`, delete `singlePlaceGround` and the comment block above it (from `/** ONE LAYER …` or whatever heads it — `grep -n "singlePlaceGround" scripts/web/views.mjs` gives the function line; the comment is the block immediately above). In `server.mjs`, remove `singlePlaceGround` from the import at ~107 and in the onboarding route replace the six-line "THE SAME GROUND THEY JUST CAME FROM" comment, the `const ground = …` line and the call with:

```js
        return sendHtml(req, res, 200, onboardingPage({ account, consentText, csrf: token }),
          setCookie ? { 'Set-Cookie': setCookie } : {});
```

In `views-auth.mjs`, `onboardingPage({ account = null, consentText = '', csrf = '', error = null } = {})`, and the `layout` call loses `preBody: ground,` and takes `bodyClass: 'page-onboarding',`. Replace the header comment with:

```js
/**
 * ONBOARDING IS A CARD ON THE GROUND (2026-09-07), like every other page.
 *
 * From 2026-09-05 to 2026-09-07 it carried the landing's place photograph
 * behind it (§63), so the cream world did not begin until the work started.
 * There is no cream now: spec §6 makes the dark ground every page's ground,
 * and a photograph behind a four-second consent form was the one photograph
 * left behind text that was not the landing's band. The band keeps the
 * mechanism; this page keeps the form. The browser sweep still measures every
 * word here against the ground it sits on.
 */
```

In `static.mjs`, delete the block from `/* ONBOARDING IS THE ONE PAGE LEFT WITH A PHOTOGRAPH …` through `.has-ground .scrim { opacity: 0.5; }` (four rules and their comments). Delete `.bg--lit { opacity: 1; }` and the "ONE LAYER, LIT BY A CLASS INSTEAD OF BY A RADIO" comment above it. Leave `.bgs`, `.bg`, `.bgv`, `.bgs.is-showing .bgv`, `.scrim`, `@keyframes drift` and the reduced-motion `.bg` rule: the band reads them.

- [ ] **Step 3: The solver.** In `static.mjs`, replace `const SCRIM_BONE = [0xED, 0xE7, 0xDC];` with `export const SCRIM_INK = [0xFA, 0xF7, 0xF2];` and `contrast(SCRIM_BONE, over)` with `contrast(SCRIM_INK, over)`. Rewrite the solver's comment paragraph "SOLVED AGAINST THE TEXT RATHER THAN BY EYE. The bone body colour must clear 8:1 …" to name the on-image ink the band paints (`--on-image`, the same bytes; a test pins the two together), and its last sentence — "They earn their contrast from the panel plate they sit on instead, which is what `.panel` is now for" — to: the soft tier is not painted over the photograph at all; a test refuses it inside `.band`. Say the old bone value in words only ("the cream world's bone"), never as a hex: the dead-values test forbids those bytes on any line that does not begin as a comment.

- [ ] **Step 4: The scratch preview.** `build/preview-onboarding.mjs` imports `singlePlaceGround`; remove the import and the `ground:` argument so the owner can still render the page. Not committed.

- [ ] **Step 5: Parse check, run `web-static`, `web-api`, `browser-smoke`.** `web-api`'s `every place has an image URL…` still asserts `#pl-x:checked~.wrap .bgs .bg--pl-x{opacity:1;}` — the band's rule, still emitted. If a landing test moved because a per-place scrim value changed, read it: the values move by a step in the heavier direction and no test should pin one.

- [ ] **Step 6: DESIGN.md.** Append to the **Text on a photograph is still text on a photograph** paragraph:

```markdown
The landing's band is the only photograph left behind text (onboarding lost
its ground on 2026-09-07), and its per-place scrim is solved so `--on-image`
clears 8:1 over that place's loop; the constant the solver protects is tied to
the token by a test, and a second test refuses any dim-tier colour inside
`.band`, because the soft tier is outside the solve on purpose.
```

- [ ] **Step 7: The full suite, the sabotages, the guards, the commit.** Sabotages: (a) `SCRIM_INK` back to `[0xED, 0xE7, 0xDC]` → the scrim test names it (and note: the sheet itself stays clean, which is exactly why the constant needed its own test); (b) add `.band-hint { color: var(--ink-soft); }` at the end of the band block → the scrim test names `.band-hint`; (c) `bodyClass: 'has-ground page-onboarding'` back in `onboardingPage` → the onboarding test and the browser test both red. Expected: `fail 0`, `tests 2163` (one rewritten, one added).

```bash
git add scripts/web/views.mjs scripts/web/views-auth.mjs scripts/web/server.mjs scripts/web/static.mjs DESIGN.md test/web-static.test.js test/browser-smoke.test.js
git commit -F build/commitmsg.txt
```

Message: `onboarding: the last photograph ground goes, and the band's scrim is solved for the on-image ink it paints`.

- [ ] **Step 8: STOP. Show the owner `/onboarding`** via `build/preview-onboarding.mjs` on the `preview` server, at 375 and 1440. One question: the card on the flat ground, where the photograph was.

---

### Task 6: The five credential pages and the sign-in dialog — one card each, Google first, the backdrop from the token (STOPS FOR THE OWNER TO LOOK)

**Files:**
- Modify: `scripts/web/static.mjs` (`.signin::backdrop` ~2152)
- Test: `test/web-static.test.js` (one added)

**Interfaces:**
- Consumes: `.panel` as a card, the field rule, `.record` lime, `.notice` as a card (Task 1).
- Produces: nothing later depends on this task.

**What spec §6 asks** — "One outlined panel on the ground, heading in Anton, Google first, fields outlined, button lime. Forms untouched. The dialog's eleven-alias restatement (§60K) goes" — is almost entirely delivered by Task 1 and by the first plan: `.panel` is the card, `.headline` is Anton, both login and signup already render the Google form before the password form, the field rule is outlined, `.record` is lime, and the dialog's alias block was deleted by the first plan's tokens commit (`static.mjs` says so above `.signin`). Spec §8's "deleted with the rule" items for this page (the `--frost-lit` plate assertions, the nav-brightness browser test) were deleted in the first plan too. What is left is one literal — the dialog backdrop hard-codes the ground's bytes as `rgba(22, 22, 24, 0.72)` — and the absence of a test that pins the shape the spec describes, so a later change could put the password form first or wrap a page in two cards without anything going red.

- [ ] **Step 1: The test (RED).** In `test/web-static.test.js`:

```js
test('the five credential pages are one card each, Google first, form only; the dialog backdrop is the ground from the token', () => {
  const pages = {
    login: loginPage({ csrf: 't' }),
    signup: signupPage({ csrf: 't', consentText: 'I am in this photo.' }),
    verify: verifyPage({ email: 'a@b.com', csrf: 't' }),
    reset: resetPage({ csrf: 't' }),
    'reset-complete': resetCompletePage({ email: 'a@b.com', csrf: 't' }),
  };
  for (const [name, html] of Object.entries(pages)) {
    assert.equal((html.match(/<section class="panel">/g) ?? []).length, 1, `${name} is not exactly one card`);
    assert.match(html, /class="wrap wrap--narrow"/, `${name} is not in the narrow column`);
    assert.ok(!/class="nav"/.test(html), `${name} carries the app nav -- the auth five are form only (§48)`);
    assert.match(html, /<h1 class="headline">/, `${name} has no heading`);
    assert.match(html, /class="record"/, `${name} has no lime button`);
  }
  for (const name of ['login', 'signup']) {
    const html = pages[name];
    const google = html.indexOf('action="/auth/google"');
    const password = html.indexOf(name === 'login' ? 'action="/login"' : 'action="/signup"');
    assert.ok(google > -1, `${name}: no Google door`);
    assert.ok(password > google, `${name}: Google is not the first door`);
  }
  const { css } = createStylesheet({});
  const backdrop = /\.signin::backdrop\s*\{([^}]*)\}/.exec(css);
  assert.ok(backdrop, 'no dialog backdrop rule');
  assert.match(backdrop[1], /background:\s*color-mix\(in srgb, var\(--ground\) 72%, transparent\)/, 'the backdrop is a literal copy of the ground rather than the token');
  assert.ok(!/rgba\(/.test(backdrop[1]), 'the backdrop still carries the ground as bytes');
});
```

Run: expected red on the backdrop's `color-mix`.

- [ ] **Step 2: The backdrop.** `.signin::backdrop { background: color-mix(in srgb, var(--ground) 72%, transparent); }` — the same `color-mix` idiom the credit meter's spent state already uses, so the backdrop follows the ground token instead of copying its bytes. Parse check; run `web-static` and `browser-smoke` (the dialog test at ~570 reads the cascade and must stay green).

- [ ] **Step 3: The full suite, the sabotages, the guards, the commit.** Sabotages: (a) swap the two forms in `loginPage` (password form first) → red on `login: Google is not the first door`; (b) the literal `rgba(22, 22, 24, 0.72)` back → red. Expected: `fail 0`, `tests 2164`.

```bash
git add scripts/web/static.mjs test/web-static.test.js
git commit -F build/commitmsg.txt
```

Message: `auth: the five credential pages are pinned as one card each with Google first, and the dialog's backdrop takes the ground from the token`.

- [ ] **Step 4: STOP. Show the owner** `/login`, `/signup`, `/verify?email=a@b.com`, `/auth/reset`, `/auth/reset/complete` and the dialog on `/` (open it), at 375. These are the pages he carved out in §48 as "form only" and has not seen in the card language except `/login` in Task 1. One question: anything to move.

---
### Task 7: The legal pages and the error trio — three documents on the ground at reading measure; the error page stays a card (STOPS FOR THE OWNER TO LOOK)

**Files:**
- Modify: `scripts/web/views.mjs` (`privacyPage`, `termsPage`, `impressumPage`: the opening `<section class="panel">` becomes `<section class="legal">`; the closing tag is unchanged)
- Modify: `scripts/web/static.mjs` (`.legal` and `.page-legal .headline` added beside `.legal-h`)
- Modify: `DESIGN.md` (**Surfaces**: the legal pages)
- Test: `test/web-static.test.js` (one added)

**Interfaces:**
- Consumes: `.panel` as a card (Task 1), `.legal-h` (already Anton at `--t-4`), `.sub` at 66ch.
- Produces: `section.legal` on the three legal pages. `errorPage`, `identityUnavailablePage` and `authUnavailablePage` keep `section.panel`.

**Why the legal pages leave the card.** Spec §6: "Dark ground, Anton heading, Inter body at reading measure, no lime panel." A privacy policy is several hundred words somebody reads top to bottom; boxing that in an outlined card makes a document look like a dialog and puts a 12px radius around a thing that has no edges. The three pages sit on the ground at 66ch, which `.sub` already imposes on their paragraphs. The error trio is one sentence and one button, which is exactly what a card is for, so it stays one. Nothing about the legal pages' content, headings, outline, entity block or processor list changes; `test/web-legal.test.js` is not touched and its meta-guard (which greps `web-static` for the three function names) is satisfied because they stay in `renderedPages()`.

- [ ] **Step 1: The test (RED).** In `test/web-static.test.js`:

```js
test('the legal pages are documents on the ground, not cards, and the error page is still a card', () => {
  const legal = {
    privacy: privacyPage({ entity: null, retention: { photoDays: 7, jobDays: 30 } }),
    terms: termsPage({ entity: null }),
    impressum: impressumPage({ entity: null }),
  };
  for (const [name, html] of Object.entries(legal)) {
    assert.match(html, /<main>\s*<section class="legal">/, `${name} does not open as a document section`);
    assert.ok(!/class="panel"/.test(html), `${name} is boxed in a card -- a document is read, not framed`);
    assert.match(html, /<h1 class="headline">/, `${name} lost its heading`);
    assert.match(html, /<h2 class="eyebrow legal-h">/, `${name} lost its section headings`);
  }
  for (const [name, html] of Object.entries({
    error: errorPage({ status: 404, title: 'Not found' }),
    'auth-unavailable': authUnavailablePage(),
    'identity-unavailable': identityUnavailablePage(),
  })) {
    assert.match(html, /<section class="panel">/, `${name}: a short message belongs on a card`);
  }
  assert.match(errorPage({ status: 404, title: 'Not found' }), /<a class="go" href="\/">Start again<\/a>/, 'the error page lost its way home');
  const { css } = createStylesheet({});
  const doc = /\n\.legal\s*\{([^}]*)\}/.exec(css);
  assert.ok(doc, 'no .legal rule');
  assert.match(doc[1], /max-width:\s*66ch/, 'a legal document is not at reading measure');
  assert.ok(!/border|background/.test(doc[1]), 'a legal document draws a card around itself');
  assert.match(css, /\.page-legal \.headline\s*\{[^}]*font-size:\s*var\(--t-7\)/, 'the document title is not at the page-title size');
});
```

Run: expected red on `privacy does not open as a document section`.

- [ ] **Step 2: The markup.** In `views.mjs`, in each of `privacyPage`, `termsPage` and `impressumPage`, change the line `  <section class="panel">` directly under `<main>` to `  <section class="legal">`. Three edits, nothing else in those functions. `errorPage` is untouched.

- [ ] **Step 3: The rules.** In `static.mjs`, directly after the `.legal-h { … }` rule:

```css
/* THE LEGAL PAGES ARE DOCUMENTS, NOT CARDS (2026-09-07, spec §6: "Dark ground,
   Anton heading, Inter body at reading measure, no lime panel"). Several
   hundred words read top to bottom have no edges to box; they sit on the
   ground at the 66ch measure .sub already imposes on their paragraphs, under
   a title at the page size. The error trio -- one sentence and a button -- is
   exactly what a card is for and keeps .panel. */
.legal { max-width: 66ch; }
.page-legal .headline { font-size: var(--t-7); text-wrap: balance; }
```

Parse check; run `web-static` and `web-legal`. Expected: green, including the legal outline test (`a legal page is a document, with a document outline`) and the six `renderedPages()` sweeps.

- [ ] **Step 4: DESIGN.md.** In **Surfaces** (Task 1's section), append: "The three legal pages are documents on the ground at 66ch, not cards, because a policy is read and not framed; the error pages are one card each, because a sentence and a button are what a card is for."

- [ ] **Step 5: The full suite, the sabotages, the guards, the commit.** Sabotages: (a) `class="panel"` back on `privacyPage` → red; (b) delete the `.legal` rule → red. Expected: `fail 0`, `tests 2165`.

```bash
git add scripts/web/views.mjs scripts/web/static.mjs DESIGN.md test/web-static.test.js
git commit -F build/commitmsg.txt
```

Message: `legal: the three documents sit on the ground at reading measure; the error page stays a card`.

- [ ] **Step 6: STOP. Show the owner** `/privacy` and `/impressum` at 375 and 1440, and `/nope` (the 404). One question: the documents unframed.

---

### Task 8: The suite, the guards, the push, the second deploy, and CLAUDE.md §71

**Files:** `CLAUDE.md` (Step 8 only). Nothing else modified.

- [ ] **Step 1: The whole suite one last time, and the count against baseline.**

```bash
npm test > build/final.log 2>&1; echo "exit $?"; grep -E "^ℹ (tests|pass|fail|skipped)" build/final.log
```

Expected: `fail 0`, `skipped 3`, `tests 2165` = the Task 0 baseline 2149 plus the sixteen tests this plan adds (Task 1: 4, Task 2: 5, Task 3: 3, Task 4: 1, Task 5: 1, Task 6: 1, Task 7: 1) with two rewritten in place, plus the owner's follow-ups. Write the numbers down for the commit message and CLAUDE.md.

- [ ] **Step 2: The inventory grep, the guards, the tree.**

```bash
grep -nE 'var\(--(lift|ink-strong|frost|frost-lit|muted|hairline|hairline-firm)\)|has-ground|singlePlaceGround|bg--lit|SCRIM_BONE|backdrop-filter|\.63 floor|letter-spacing: -0\.02em' scripts/web/static.mjs scripts/web/views.mjs scripts/web/views-auth.mjs scripts/web/server.mjs | wc -l
node --check scripts/web/static.mjs && node --check scripts/web/views.mjs && node --check scripts/web/views-auth.mjs && echo PARSE-OK
git status --short
git log --oneline origin/supabase-identity-slice..HEAD
```

Expected: `0`; `PARSE-OK`; a clean tree but for the untracked PDF; seven to twelve commits ahead (Tasks 1–7 plus the owner's follow-ups). Then the seven guards, verbatim, counted 7/7.

- [ ] **Step 3: Push.**

```bash
git push origin supabase-identity-slice
git ls-remote origin supabase-identity-slice
```

Confirm the remote SHA equals `git rev-parse HEAD`. Pushing does not touch the box and runs no CI on this branch.

- [ ] **Step 4: STOP. Ask the owner for the go.** The message, in full, with the SHA filled in:

> The second plan is pushed at `<sha>`. Every page is now in the lime world's own layout: the order form, status, result, the shelf, the account page, onboarding, the five sign-in pages and the dialog, the legal pages and the error pages. The box is still at `69d51a9`. The deploy is one pull and one rebuild and changes every page at once, which is the point of doing it whole. Say go and I run it, or wait.

Do not pull until he answers.

- [ ] **Step 5: The deploy, as three separate remote commands** (CLAUDE.md §70F: the classifier refuses a combined pull-and-build; §70C: the order is pull, build, swap).

```bash
ssh -o BatchMode=yes root@178.105.77.16 'cd /opt/timestamp && echo "before: $(git rev-parse --short HEAD)" && git pull -q && echo "after:  $(git rev-parse --short HEAD)"'
```
```bash
ssh -o BatchMode=yes root@178.105.77.16 'cd /opt/timestamp && docker compose up -d --build 2>&1 | tail -n 12 && docker compose ps --format "table {{.Service}}\t{{.Status}}"'
```
```bash
ssh -o BatchMode=yes root@178.105.77.16 'cd /opt/timestamp && docker compose ps --format "table {{.Service}}\t{{.Status}}" && echo "FATAL since restart: $(docker compose logs --since 5m web worker 2>&1 | grep -c FATAL || true)"'
```

Expected: `after:` equals the pushed SHA; `web Built`, `worker Built`, both containers `Recreated` and `Started`; a minute later `web … (healthy)`, `worker Up`, `FATAL since restart: 0`.

- [ ] **Step 6: Verify from outside, not from the container.**

```bash
curl -s https://timestamptapes.com/api/health
curl -s https://timestamptapes.com/login | grep -c 'class="panel"'
curl -s https://timestamptapes.com/privacy | grep -c 'class="legal"'
curl -s https://timestamptapes.com/privacy | grep -c 'class="panel"'
curl -s -o /dev/null -w "%{http_code}\n" -H "Accept: text/html" https://timestamptapes.com/onboarding
curl -s https://timestamptapes.com/styles.css | grep -cE 'var\(--(lift|frost|frost-lit|muted|ink-strong)\)|has-ground|backdrop-filter'
curl -s https://timestamptapes.com/styles.css | grep -c '\.commit-foot'
curl -s https://timestamptapes.com/styles.css | grep -c '\.reclight { color: var(--rec)'
curl -s https://timestamptapes.com/ | grep -c 'class="lime hero"'
curl -sI https://timestamptapes.com/ | grep -i content-security-policy
curl -sI https://timestamptapes.com/ | grep -i x-robots-tag
```

Expected: `{"ok":true,"degraded":[]}`; `1`; `1`; `0`; `303` (onboarding is gated); `0`; `1`; `1`; `1`; the CSP header byte-identical to the one before the deploy (copy it out beforehand); `noindex, nofollow`. Then open `/` signed in on a phone and choose a place, an outfit, a shape and a quality: one lime card per row, one ringed place. A probe with the wrong `Accept` header lies (CLAUDE.md §50D), which is why the onboarding line sends `text/html`.

- [ ] **Step 7: The stylesheet is cached five minutes.** `/styles.css` is served `max-age=300`; anybody who loaded the site in the five minutes before the swap holds the old sheet for up to five minutes. Say so in the message to the owner, as §70H's deploy did.

- [ ] **Step 8: Record it.** Add `### 71.` to `CLAUDE.md` in the house register: what shipped, commit by commit, with the suite trajectory; the decisions taken during execution that the owner can still overrule (the four steps' fill arc, the text cards losing their ghost, the phase titles in Anton, the address in the body face, the legal pages leaving the card) and the ones he took at the stops; the debt from §70E and where each item landed; what §70E's debt this plan did NOT take (the favicon, the pricing page's `sameInEveryShape` third state and disabled Buy); the test count and the deleted/rewritten tests by name; the deploy and its verification. Replace the START HERE banner's "THE NEXT THING IS THE SECOND PLAN" paragraph with the deploy's date and SHA and the sentence that every page is in the world now. Update the memory file `lime-redesign-execution-state.md` and its `MEMORY.md` line. Commit as `docs: section 71, the lime world's second deploy`, and push. Do not write it before the deploy is real.

---

## Self-review

**Spec coverage, section by section.**

| Spec | Where |
|---|---|
| §2.1 palette unchanged; lime means chosen (fill on text cards, ring on a photograph); red means the record light | Global Constraints; Task 2 (fill and ring), Task 3 (`.reclight` in `--rec`) |
| §2.1 "two grounds become one", aliases re-pointed once | Task 1 retires seven names; the rest stay re-pointed; DESIGN.md |
| §2.2 Anton for every heading, uppercase, 0.9–0.95, no tracking; VT323 only for the cassette readout | Task 1 (the metrics test and the four overrides), Task 3 (`.phase-title`), Task 4 (the one stated exception, exempted by the face it names) |
| §2.3 no texture on the ground or a dark card | nothing added; the texture sweep runs on every page after every task |
| §2.4 outlines from the token, radii, dashed dropzones, `<hr>` banned, focus ring colours | Task 1 (`.panel`, fields, `.notice`, `.record:disabled`, `.tape .frame`), Task 2 (option cards, `.drop`), Task 3 (`.phase`, `.player`); the border sweep and the outline-removal guard are unchanged and run throughout |
| §2.5 motion: only the status light blinks | Task 3 keeps `tally`; §70H's still wordmark dot is unchanged and its two guards run |
| §6 order form: four step cards outlined, Anton step numbers, option cards outlined, chosen text card lime, chosen place ringed and badged, dashed dropzones, Record lime with the price beside it, archive beneath, same steps/controls/scripts | Task 1 (steps), Task 2 (everything else; the step numbers were already Anton) |
| §6 status: Anton heading, phase rows as outlined cards, red record light | Task 3 |
| §6 result: tape beside its label, VT323 readout kept, lime download, shelf beneath | Task 1 (`.label` on the card plane), Task 3 (`.player` outline, heading size); the readout, `.go` and the shelf were already so |
| §6 videos, account: outlined tiles, the balance sentence | Task 1 (tiles), Task 4 (the delete button, the address) |
| §6 auth five and the dialog: one outlined panel, Anton heading, Google first, fields outlined, button lime, forms untouched, alias restatement gone | Task 1 (panel, fields), Task 6 (pinned; backdrop from the token); the restatement went in the first plan |
| §6 onboarding: same panel, `singlePlaceGround()` and its plate rules deleted | Task 5 |
| §6 legal pages and the error trio: ground, Anton heading, reading measure, no lime panel | Task 7 |
| §7 one stylesheet, no new inline script, CSP unchanged, zero deps | throughout; no script text changes so the hashes do not move |
| §8 "lime appears on exactly one card per option row after a selection" | Task 2's browser test |
| §8 the dim-tier-needs-a-plate rule (deleted) — its successor | Task 5's band-tier test |
| §8 kept unchanged: the border sweep, `<hr>`, focus outlines, the type-scale test, the German sweep, the still-approval sweep, the rationale guard, every CSP hash test, the order-form and status-page structure tests | none is touched; every task runs the whole suite |
| §9 DESIGN.md kept the authority | Tasks 1, 2, 4, 5, 7 each edit the sentence their change makes true |
| §10 steps 7–10; deploy whole | the task order; Task 8 |
| §70E debt: the weight arc, `SCRIM_BONE`, `--lift`/`--ink-strong`, the band's missing guard, the per-row browser test | Tasks 1 + 2, 5, 1, 5, 2. Not taken, on purpose: the favicon (the owner's), the pricing page's `sameInEveryShape` third state and the disabled-Buy look (unreachable while both packs are buyable; recorded in §70E) |

**Placeholder scan.** No "TBD", no "similar to Task N". Every test and every rule is written out. Three places tell the implementer to `grep -n` for a line because Step 2 of Task 1 moves every number after it; each names the string to grep for.

**Type consistency, checked.** The generated rule strings in Task 2's Interfaces block, its `presetCss` edits, the `web-static` option-card test and the `web-api` rewrite are the same characters. `onboardingPage`'s signature after Task 5 (`{ account, consentText, csrf, error }`) matches the server call and both tests. `SCRIM_INK` is exported in Task 5 and imported by the test in the same task. `s.running` is added to `session()` and read by the Task 3 browser test. `.commit-foot` is the one new class and appears in the markup, the sheet and the test with the same name. The slugs the tests spell (`of-tshirt-jeans`, `q-480p`, `a-4x3`, `pl-ostsee-strand`) are what `outfitSlug`, `qualitySlug`, `aspectSlug` and `placeSlug` produce for the `FOCUS_MENU` ids (the existing `web-api` tests spell them the same way).

**Two risks to know before starting.** (1) Every verification is on Windows; the box is Linux and CI does not run on this branch — the same risk the first plan carried, and the browser tests use the Chrome build CI does. (2) Task 1's Step 2 renumbers every line in `static.mjs` after ~561; the plan gives `grep -n` strings for each later edit rather than line numbers, and the implementer must use them. A `String.replace` on a line number is how a comment gets edited instead of the rule (CLAUDE.md §34F).
