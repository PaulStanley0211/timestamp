# Lime Redesign, First Deploy — Implementation Plan (spec §10 steps 1–6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every page into the lime-on-dark world (tokens, fonts, DESIGN.md), build the shared components and the showcase route, rebuild the landing and the pricing page to the approved spec, and stop at the point where the first deploy is the owner's to trigger.

**Architecture:** One server-rendered stylesheet (`static.mjs`) and one set of pure view functions (`views.mjs`, `views-auth.mjs`) over a fixed route table. The world changes by re-pointing the alias tokens once at `:root` and deleting the second ground; the layouts of the two public pages change by rewriting two view functions and adding shared component functions beside them. Faces never enter the repository: the showcase tapes are served by allow-list from a directory named by an environment variable, and every page renders a stated fallback without them.

**Tech Stack:** Node 22+, ESM, `node --test`, zero npm dependencies, ffmpeg 7/8 (producer script only), Python fontTools 4.62 + brotli (font subsetting, once, on this machine), Chromium via CDP for the browser tests.

**Spec:** `docs/superpowers/specs/2026-09-06-lime-redesign-design.md` (commits `64aaaa7`, `f8ac48c`). The plan argues from it; read it first. `CLAUDE.md` §69 is the record of how it was approved.

## Global Constraints

Copied from the spec and from the rules this repository already enforces. Every task's requirements include this section.

- **Zero npm dependencies.** `package.json` `dependencies` stays absent; `npm test` stays a bare `node --test`; `guards.yml` fails otherwise.
- **The CSP does not change.** `default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; font-src 'self'; script-src <hashes>`. No network font ever loads (`fonts.googleapis.com` / `fonts.gstatic.com` appear nowhere under `scripts/`). No inline `style` attribute, no inline `<style>` block, anywhere, including inside inlined SVG.
- **No new inline script.** The five inline scripts stay five. `BG_SCRIPT`'s text changes; `INLINE_SCRIPT_HASHES` follows automatically because it hashes the constants.
- **Palette (spec §2.1), measured on 2026-09-06 with the WCAG formula:** `--ground #161618`, `--card #1F1F22`, `--lime #D9FF00` (15.71:1 on ground, 14.29:1 on card), `--ink #F2F2F0` (16.12:1 / 14.67:1), `--ink-soft #A9A9A6` (7.67:1 / 6.98:1), `--on-lime #141414` (16.01:1 on lime), `--on-lime-soft #3A3A3A` (9.89:1 on lime), `--line rgba(242, 242, 240, 0.14)`. **`--rec` is `#E85545`**, not the spec's floor `#E24B3B`: the spec asks for a red clearing 4.5:1 on the ground, the floor value measures 4.56:1 on the ground and 4.15:1 on `--card`, and the status page's phase rows become cards in step 7; `#E85545` measures 5.01:1 on the ground and 4.55:1 on the card. Record the move in DESIGN.md's table as the spec allows.
- **Lime means chosen, or go.** Selected cards, the primary button, the wordmark, the display moments. Never labels, links in prose, prices, flags, numerals.
- **Red means the record light.** One element on the status page plus the `.rec` dot in the wordmark. There is no alarm red: an error is weight and words in `--ink`.
- **The date stamp inside the tape is untouched.** It is drawn by ffmpeg from `config/look/base.json` (`osd.color`, `0xF6EAC8` — the spec calls it orange; the config says a warm cream, and the config is what ships). The interface never imitates it.
- **Type.** Anton (`--display`) for every heading, the wordmark, card titles, prices, buttons: always uppercase, line-height 0.9–0.92, no tracking, **never below 18px**. Inter (`--sans`) for body, labels, forms, fine print. The 12px label role is Inter 600, tracked, uppercase — the only uppercase body text. VT323 (`--osd`) only for the tape's date stamp, the landing's flip counter and the result page's cassette readout. The `--t-*` scale and the `--d-*` ladder keep their roles and ratio; every `font-size` names a token (a test enforces it).
- **Texture.** The printed speckle only on `.lime` panels; the crumpled paper only on `.fact` cards; both are SVG filters emitted once by `layout()` and applied from the stylesheet by id. The dark ground and every dark card stay flat.
- **Borders and shape.** Cards, fields, FAQ rows and shelf tiles: `1px solid var(--line)`, radius 10–12px; buttons 6–8px. Never a literal colour in a border declaration. `<hr>` stays banned. `:focus-visible` outline 2px, offset 2px, `--ink` on dark surfaces and `--on-lime` on lime ones, never removed.
- **Every number in copy comes from config or a pricing seam.** Retention days from `config/render.json` retention; credits from `PLANS`/`creditCost`/`packs`; shapes and qualities from the rows the server already builds. Nothing typed.
- **No face in the repository.** Showcase media live under `TIMESTAMP_SHOWCASE_DIR`, outside the repo, served by allow-list; every page has a face-free fallback, and that is the state every test runs in.
- **The six test widths:** 320 / 375 / 414 / 768 / 1024 / 1440 — no horizontal overflow at any.
- **Copy sweeps that already run over every page:** no `German`/`Germany` outside `/privacy` and `/impressum`; no pre-approval promise (`approve a still`, `costs you nothing`); no HTML comment reaches the wire; the landing must keep the phrase `run through a real tape chain` (an anti-vacuity anchor).
- **Test-first, one commit per task, every guard sabotage-verified**, restored from a COPY (`cp`), never `git checkout --`. A first-run pass on a new test is treated as suspect until the sabotage proves it can fail.
- **Commit messages describe what the change DOES.** Never security-review vocabulary (`guards.yml` greps for it).
- **DO NOT `git pull` ON THE BOX** until the owner says so. Pushing to `origin/supabase-identity-slice` is allowed and does not touch the box; CI does not run on this branch.
- **The backtick trap.** `static.mjs`, `views.mjs` and `views-auth.mjs` are template literals: a backtick or a block-comment terminator inside a comment ends the string. Run `node --check` on all three after every edit to any of them.
- **Escapes.** The Bash heredoc and `node -e` strings eat backslashes on this machine. Write and edit files with the Write/Edit tools. Print a mutated line before believing a sabotage changed anything.

## How this plan reads spec §10

| Spec step | Plan task | Commit | Stops for the owner |
|---|---|---|---|
| 1. Fonts and tokens, DESIGN.md, §8 guards | Task 1 (fonts) + Task 2 (tokens, DESIGN.md, guards) | two commits, back to back | Task 1 step 1: the go for the download |
| 2. Shared components | Task 3 | one | — |
| 3. Showcase | Task 4 | one | — |
| 4. Landing | Task 5 | one | after: the page rendered, the FAQ copy, the sticker frames, the lime under the speckle |
| 5. Pricing | Task 6 | one | after: the page rendered |
| 6. First deploy | Task 7 | none (push only) | the deploy itself is the owner's, and nothing is pulled on the box until he says |

Spec step 1 lands as two commits rather than one because the font commit is purely additive (files, three `@font-face` rules, a route, a token nothing reads yet) and changes no pixel, which makes the tokens commit reviewable on its own. Nothing is pulled on the box between them or after them; the embargo is Task 7's.

## File structure

**Created**

| Path | Responsibility |
|---|---|
| `assets/fonts/anton.woff2`, `assets/fonts/anton.ttf` | Anton, latin subset, woff2 first and truetype fallback |
| `assets/fonts/inter-400.woff2`, `assets/fonts/inter-600.woff2` | Inter, instanced at 400 and 600, latin subset |
| `assets/fonts/OFL-anton.txt`, `assets/fonts/OFL-inter.txt` | the licences, beside the files (`OFL.txt` stays VT323's) |
| `scripts/tapedeck/showcase.mjs` | the producer: job directory → showcase files, refusing to write one that lost its Art. 50 tags |
| `test/fixtures/showcase/tiny.mp4`, `test/fixtures/showcase/tiny.jpg` | face-free 64x36 media carrying the provenance tags, for the showcase tests |
| `test/showcase-media.test.js` | the producer's tests (self-skipping without ffmpeg) |

**Modified**

| Path | What changes |
|---|---|
| `scripts/web/static.mjs` | `@font-face` x3, the `:root` block, `body.is-landing` and every `--l-*` token deleted, every rule that named a superseded value re-pointed, `.lime`/`.card`/`.fact`/FAQ/footer/landing/pricing rules |
| `scripts/web/views.mjs` | `wordmark()` (live text), `layout()` (`masthead` option, filter defs, `siteFooter()`), `BG_SCRIPT` (showcase videos), new `svgFilters()`, `siteFooter()`, `faq()`, `faqItems()`, `factCards()`, `balanceSentence()`, `landingPage()` rewritten |
| `scripts/web/views-auth.mjs` | `pricingPage()` rewritten; `onboardingPage()` body class renamed; `accountPage()` uses `balanceSentence()` |
| `scripts/web/server.mjs` | `/fonts/:file` and `/showcase/:file` handlers, `showcaseDir` option, `SHOWCASE_FILES`, `publicFacts()`, `landingPricing()` gains `freeCredits`, `sendFile` gains `publicCache` |
| `scripts/web/router.mjs` | two routes, two `PUBLIC_ROUTES` entries |
| `DESIGN.md` | rewritten for the new world |
| `compose.yaml`, `.env.example`, `docs/deploy-runbook.md` | the showcase bind mount, variable and step |
| `test/web-static.test.js`, `test/browser-smoke.test.js`, `test/web-api.test.js`, `test/web-auth.test.js`, `test/web-brand.test.js`, `test/deploy-topology.test.js`, `test/deploy-image.test.js` | per the inventory below |

## The old-world inventory (measured 2026-09-06, every test file)

The command, run from the repo root in Git Bash. Re-run it in Task 0; the table is what it printed on 2026-09-06 at `7e4d837`.

```bash
TERMS='is-landing|--l-(ground|lift|cathode|hot|bone|dim)|l-cathode|l-bone|l-dim|FF8A1E|070A11|--paper|FAF7F2|oxide|A8342A|frost|--ghost|TapeOSD|tape-osd|--osd|VT323|readout|eyebrow|\bbone\b|Struck|\bcream\b|-apple-system|--sans|Cormorant|lmenu|lopt|lidx|lrail|singlePlaceGround|bg--lit|scrim|plan--current|color-scheme|on-image|D98B7A|--lift|ink-strong|ink-soft|--muted|--faint|--accent|--alarm|hairline|wordmark|strike-hint|hero-line|hero-sub|hero-do|\.strike|plain-price|losd|\.bloom|\.gauze|\.grain'
for f in test/*.test.js; do out=$(grep -oE "$TERMS" "$f" | sort | uniq -c | sort -rn | awk '{printf "%s=%s ", $2, $1}'); [ -n "$out" ] && printf "%s: %s\n" "$f" "$out"; done
```

| File | Hits | What each becomes |
|---|---|---|
| `test/web-static.test.js` | eyebrow=10 readout=9 --osd=9 --paper=6 --ghost=6 oxide=4 lrail=4 --lift=4 wordmark=3 lopt=3 is-landing=3 hero-line=3 bone=3 singlePlaceGround=2 scrim=2 lmenu=2 ink-strong=2 ink-soft=2 cream=2 FF8A1E=2 .grain=2 .gauze=2 --faint=2 hero-sub=1 hairline=1 bg--lit=1 Struck=1 070A11=1 --sans=1 --l-ground=1 --l-dim=1 --l-bone=1 | Task 2 rewrites the palette, ghost, cathode, hero, soft-tier and readout-label tests; Task 5 the landing tests; Task 6 the pack tests. `eyebrow`, `.grain`, `.gauze` hits are class names in tests that survive unchanged. |
| `test/browser-smoke.test.js` | scrim=8 is-landing=3 --l-dim=3 ink-strong=2 ink-soft=2 cream=2 bone=2 --ghost=2 on-image=1 lmenu=1 --muted=1 --faint=1 --accent=1 | Task 2 deletes the nav-brightness and dim-tier tests, renames `is-landing` to `has-ground` in the onboarding probe; Task 5 rewrites the landing tests. Hits inside comments are left. |
| `test/web-api.test.js` | wordmark=23 scrim=8 --accent=2 Cormorant=1 | Task 2 rewrites the two wordmark tests (the mark is live text). `scrim` hits are prose in comments. |
| `test/web-auth.test.js` | plan--current=1 | Task 6 rewrites the pricing-page test that pins the old layout (it also pins `Every account starts with 51 credits`). |
| `test/web-brand.test.js` | wordmark=4 | Task 2 rewrites the accessible-name test (the text is the name now). |
| `test/web-auth-code.test.js` | wordmark=1 | a prose mention; unchanged. |
| `test/burn-in.test.js`, `test/deploy-image.test.js`, `test/pipeline.test.js`, `test/provider-fixture.test.js` | tape-osd | the tape's font, unchanged; Task 1 adds the new font files to `deploy-image`'s must-ship list. |
| `test/catalog-schema.test.js`, `test/job-model.test.js`, `test/tapedeck-look.test.js`, `test/expand-local.test.js` | .grain / .bloom | the tape's grain and a prompt word; unrelated; unchanged. |

Files the spec named that the grep confirms as the only ones carrying layout assertions: `web-static` and `browser-smoke`. Files the spec did not name that DO carry old-world assertions: `web-api` (wordmark), `web-brand` (wordmark), `web-auth` (pricing layout), `deploy-image` (font list). All four are in the tasks below.

## Working rules for every task

**The check after every edit to a template-literal file:**

```bash
node --check scripts/web/static.mjs && node --check scripts/web/views.mjs && node --check scripts/web/views-auth.mjs && echo PARSE-OK
```

**The sabotage discipline.** Before mutating a source file to prove a test can fail: `mkdir -p build/sabotage && cp <file> build/sabotage/<name>`. Mutate with the Edit tool. Run the one test. Print the mutated line (`grep -n` it) and confirm it changed. Restore with `cp build/sabotage/<name> <file>`. Never `git checkout -- <file>` while green work is uncommitted (CLAUDE.md §37F).

**Running one test file, and one test:**

```bash
node --test test/web-static.test.js
node --test --test-name-pattern="the hero" test/web-static.test.js
```

**The full suite, redirected so the exit code is the runner's (never piped):**

```bash
npm test > build/suite.log 2>&1; echo "exit $?"; tail -12 build/suite.log
```

**The seven guards, run verbatim and COUNTED (CLAUDE.md §49H: a loop can print a green it never earned).** Each block below is a `run:` step from `.github/workflows/guards.yml`; run them one at a time from the repo root in Git Bash and count seven `PASS` lines by hand.

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

**Showing the owner a page.** The Browser pane's `preview_start` with `{ name: "web" }` starts `npm run web` on port 3000 (`.claude/launch.json` already declares it). `/` and `/pricing` render signed out; for the signed-in pricing state he signs in with his real account (Supabase is configured in the local `.env`). After a stylesheet change: restart the server AND reload the pane with cache bypassed (`fetch('/styles.css', {cache: 'reload'}).then(() => location.reload())` in the pane's console), because `/styles.css` is served `max-age=300`. To see the hero tape locally, set `TIMESTAMP_SHOWCASE_DIR=C:/Users/pauls/Timestamp/build/showcase` in the local `.env` (gitignored) once Task 4's producer has written the hero there.

---

### Task 0: Baseline, and the inventory re-run

**Files:** none modified.

- [ ] **Step 1: Record the suite baseline**

```bash
npm test > build/baseline.log 2>&1; echo "exit $?"; tail -12 build/baseline.log
```

Expected: `exit 0`, `tests 2127`, `pass 2124`, `fail 0`, `skipped 3` (the two money-guard smoke files and, on a machine with no Chromium, the browser file; on this machine the browser file RUNS, so 3 is the floor).

- [ ] **Step 2: Re-run the inventory grep** from "The old-world inventory" above and compare line by line with the table. A file that appears in the output and not in the table is a test this plan has not accounted for: stop and add it to the task that touches its subject before continuing.

- [ ] **Step 3: Confirm the tools**

```bash
node -v && ffmpeg -version | head -1 && python -c "import fontTools, brotli; print('fontTools', fontTools.version, 'brotli ok')"
```

Expected: node v24 (v22 is the floor), ffmpeg 8.x, `fontTools 4.62.1 brotli ok`. If fontTools is missing the fonts still ship: Task 1 says what to do instead.

No commit.

---
### Task 1: The fonts — Anton and Inter, self-hosted, subset, licensed (STOPS FOR THE GO)

**Files:**
- Create: `assets/fonts/anton.woff2`, `assets/fonts/anton.ttf`, `assets/fonts/inter-400.woff2`, `assets/fonts/inter-600.woff2`, `assets/fonts/OFL-anton.txt`, `assets/fonts/OFL-inter.txt`
- Modify: `scripts/web/static.mjs` (the `@font-face` block at the top of `BASE_CSS`, and two tokens in `:root`), `scripts/web/static.mjs` `CONTENT_TYPES`, `scripts/web/server.mjs` (a `FONT_FILES` map and a `fontFile` handler beside `font`), `scripts/web/router.mjs` (one route, one public entry), `test/deploy-image.test.js` (the must-ship list around line 144)
- Test: `test/web-static.test.js` (new test after "the type scale is the only place a size is decided"), `test/web-api.test.js` (new test beside "the landing before/after pair is served")

**Interfaces:**
- Produces: `--display: 'Anton', Impact, 'Arial Narrow', sans-serif;` and `--sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;` in `:root`; four files under `/fonts/<name>` served public, no session, `maxAge` a day. Task 2 is the first consumer of `--display`.

- [ ] **Step 1: STOP and ask the owner for the go.** Send this, verbatim, and wait for a yes. Nothing in this task runs before it.

> The redesign needs two typefaces downloaded once, from Google's font repository on GitHub (both SIL Open Font Licence 1.1, the same licence as the tape's VT323):
>
> | File | Size | From |
> |---|---|---|
> | `Anton-Regular.ttf` | 170,812 bytes | `https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf` |
> | `OFL.txt` (Anton) | 4,484 bytes | `https://raw.githubusercontent.com/google/fonts/main/ofl/anton/OFL.txt` |
> | `Inter[opsz,wght].ttf` | 876,576 bytes | `https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf` |
> | `OFL.txt` (Inter) | 4,377 bytes | `https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt` |
>
> About 1.06 MB in total, into a scratch directory. They are then subset to the Latin range and converted to woff2 with the fontTools already on this machine, and only the subsets are committed: four font files, expected to total well under 200 KB (the exact sizes go in the commit message). The originals are deleted after. Go?

- [ ] **Step 2: Write the failing test for the faces** in `test/web-static.test.js`, directly after the test named `the type scale is the only place a size is decided`:

```js
test('every face the sheet declares is a file under assets/fonts with its licence beside it, and no network font exists', () => {
  // THE CSP IS font-src 'self' AND IT DOES NOT CHANGE. A face named in the
  // sheet that is not on disk is a silent fallback to the system stack in
  // every browser, with no error anywhere; a face fetched from a CDN is a
  // third-party request on a page that has just been handed somebody's
  // photograph. The licence sits beside each file because the OFL asks for it
  // and because the VT323 file has shipped that way since 2026-08-20.
  const { css } = createStylesheet({});
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const family = (face) => /font-family:\s*'([^']+)'/.exec(face)?.[1];
  assert.deepEqual(faces.map(family).sort(), ['Anton', 'Inter', 'Inter', 'TapeOSD'],
    'the sheet declares a different set of faces than the four this world ships');

  const LICENCE = { Anton: 'OFL-anton.txt', Inter: 'OFL-inter.txt', TapeOSD: 'OFL.txt' };
  const fontsDir = new URL('../assets/fonts/', import.meta.url);
  for (const face of faces) {
    const name = family(face);
    const files = [...face.matchAll(/url\('\/(?:fonts\/)?([^']+)'\)/g)].map((m) => m[1]);
    assert.ok(files.length > 0, `${name} names no file at all`);
    for (const file of files) {
      const on = new URL(file, fontsDir);
      assert.ok(fs.existsSync(on) && fs.statSync(on).size > 0, `${name} names /${file}, which is not under assets/fonts/`);
    }
    assert.ok(fs.existsSync(new URL(LICENCE[name], fontsDir)), `${name} ships without ${LICENCE[name]} beside it`);
  }

  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : e.name.endsWith('.mjs') ? [new URL(e.name, dir)] : []
  ));
  const offenders = walk(new URL('../scripts/', import.meta.url))
    .filter((f) => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => f.pathname);
  assert.deepEqual(offenders, [], 'a network font reached scripts/; font-src is self and the CSP does not change');
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
node --test --test-name-pattern="every face the sheet declares" test/web-static.test.js
```

Expected: FAIL on the `deepEqual` — the sheet declares only `TapeOSD`.

- [ ] **Step 4: Write the failing route test** in `test/web-api.test.js`, directly after `the landing before/after pair is served, and to somebody who is not signed in`:

```js
test('the four web fonts are served public, by name, with a day of cache, and nothing else under /fonts/ is', async () => {
  await withServer(async ({ base }) => {
    for (const [file, type] of [
      ['anton.woff2', 'font/woff2'], ['anton.ttf', 'font/ttf'],
      ['inter-400.woff2', 'font/woff2'], ['inter-600.woff2', 'font/woff2'],
    ]) {
      // No cookie, deliberately: a stylesheet that loads while signed out must
      // be able to load its faces while signed out.
      const res = await fetch(`${base}/fonts/${file}`);
      assert.equal(res.status, 200, `/fonts/${file} answered ${res.status}`);
      assert.equal(res.headers.get('content-type'), type);
      assert.match(res.headers.get('cache-control') ?? '', /max-age=86400/, 'a font is revalidated daily, like the brand assets');
      assert.ok((await res.arrayBuffer()).byteLength > 0);
    }
    for (const target of ['/fonts/nope.woff2', '/fonts/..%2f..%2fpackage.json', '/fonts/OFL-anton.txt', '/fonts/tape-osd.ttf']) {
      const res = await fetch(`${base}${target}`);
      assert.ok(res.status === 404 || res.status === 400, `${target} answered ${res.status}, which is neither a refusal nor a miss`);
    }
  });
});
```

Run it: expected FAIL with 404 on `/fonts/anton.woff2` (no route yet).

- [ ] **Step 5: Download, once the go is in.** Into the scratchpad, never into the repo:

```bash
S="$HOME/AppData/Local/Temp/claude/fonts-src"; mkdir -p "$S"
curl -sSL -o "$S/Anton-Regular.ttf" https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf
curl -sSL -o "$S/OFL-anton.txt" https://raw.githubusercontent.com/google/fonts/main/ofl/anton/OFL.txt
curl -sSL -o "$S/Inter-var.ttf" "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf"
curl -sSL -o "$S/OFL-inter.txt" https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt
ls -l "$S"
```

Expected sizes: 170812, 4484, 876576, 4377. A different size means a different file than the one named to the owner: stop and say so.

- [ ] **Step 6: Instance Inter, subset all three, convert to woff2**

```bash
S="$HOME/AppData/Local/Temp/claude/fonts-src"
LATIN="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
python -m fontTools.varLib.instancer "$S/Inter-var.ttf" wght=400 opsz=14 -o "$S/inter-400.ttf"
python -m fontTools.varLib.instancer "$S/Inter-var.ttf" wght=600 opsz=14 -o "$S/inter-600.ttf"
python -m fontTools.subset "$S/inter-400.ttf" --unicodes="$LATIN" --layout-features='*' --flavor=woff2 --output-file=assets/fonts/inter-400.woff2
python -m fontTools.subset "$S/inter-600.ttf" --unicodes="$LATIN" --layout-features='*' --flavor=woff2 --output-file=assets/fonts/inter-600.woff2
python -m fontTools.subset "$S/Anton-Regular.ttf" --unicodes="$LATIN" --layout-features='*' --flavor=woff2 --output-file=assets/fonts/anton.woff2
python -m fontTools.subset "$S/Anton-Regular.ttf" --unicodes="$LATIN" --layout-features='*' --output-file=assets/fonts/anton.ttf
cp "$S/OFL-anton.txt" assets/fonts/OFL-anton.txt
cp "$S/OFL-inter.txt" assets/fonts/OFL-inter.txt
ls -l assets/fonts
python -c "from fontTools.ttLib import TTFont; [print(f, TTFont('assets/fonts/'+f)['name'].getDebugName(1), len(TTFont('assets/fonts/'+f).getGlyphOrder()), 'glyphs') for f in ['anton.woff2','anton.ttf','inter-400.woff2','inter-600.woff2']]"
rm -rf "$S"
```

Expected: family names `Anton`, `Inter` printed; each file a few hundred glyphs; the four font files well under 200 KB together. **If fontTools is unavailable** (Task 0 step 3 said so): ship `Anton-Regular.ttf` unsubset as `assets/fonts/anton.ttf`, omit `anton.woff2` from the `src` list, and use the static woff2 files from the Inter release (`https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip`, 33.7 MB, `web/Inter-Regular.woff2` and `web/Inter-SemiBold.woff2`) — that is a second download and needs a second go.

- [ ] **Step 7: The `@font-face` block and the two tokens** in `scripts/web/static.mjs`. Replace the single `@font-face` at the top of `BASE_CSS` with:

```css
@font-face {
  font-family: 'TapeOSD';
  src: url('/tape-osd.ttf') format('truetype');
  font-display: swap;
}
/* THE WORLD'S TWO FACES, SELF-HOSTED, SUBSET TO LATIN. Fetched once from the
   Google Fonts repository (SIL OFL 1.1, licences beside the files), instanced
   and subset with fontTools, and served from assets/fonts/ under the same
   font-src self as the tape's own face. No network font, ever: the CSP does
   not change and a page that has been handed a photograph makes no third-party
   request. Anton is the display face and is never set below 18px. */
@font-face {
  font-family: 'Anton';
  src: url('/fonts/anton.woff2') format('woff2'), url('/fonts/anton.ttf') format('truetype');
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'Inter';
  src: url('/fonts/inter-400.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'Inter';
  src: url('/fonts/inter-600.woff2') format('woff2');
  font-weight: 600;
  font-display: swap;
}
```

In `:root`, change the `--sans` line and add `--display` beside it:

```css
  --sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --display: 'Anton', Impact, 'Arial Narrow', sans-serif;
  --osd: 'TapeOSD', ui-monospace, 'Courier New', monospace;
```

Add to `CONTENT_TYPES` in the same file: `'.woff2': 'font/woff2'` and `'.ttf': 'font/ttf'` (check whether `.ttf` is already there; add only what is missing).

Run the parse check.

- [ ] **Step 8: The route.** In `scripts/web/router.mjs`, after the `/tape-osd.ttf` row:

```js
  // The world's two faces, by name from a four-entry map in the handler --
  // the placeImage discipline: no byte of the request becomes a path.
  { method: 'GET', pattern: '/fonts/:file', name: 'fontFile' },
```

and add `'fontFile'` to `PUBLIC_ROUTES` beside `'font'`. In `scripts/web/server.mjs`, add `'fontFile'` to `NO_SESSION_ROUTES` beside `'font'`, and beside the `font(req, res)` handler:

```js
    /**
     * The web fonts. A four-entry map rather than a pattern, for placeImage's
     * reason: the request name is looked up, never validated, so nothing a
     * caller sends reaches the filesystem even as a rejected candidate. A day,
     * not a year, for the reason the brand assets give -- these are fixed names.
     */
    fontFile(req, res, { params }) {
      const entry = FONT_FILES[String(params.file ?? '')];
      if (!entry) throw new HttpError(404, 'Not found.', { code: 'NO_FONT' });
      const [file, contentType] = entry;
      if (!sendFile(req, res, { file: `${assetsRoot}/fonts/${file}`, contentType, maxAge: 86_400 })) {
        throw new HttpError(404, 'Not found.', { code: 'NO_FONT' });
      }
    },
```

with, at module scope beside `LANDING_IMAGES`:

```js
/** The web fonts, as a lookup. Which files exist is decided in assets/fonts/;
 *  this is only the set of names the route will answer to. */
const FONT_FILES = Object.freeze({
  'anton.woff2': ['anton.woff2', 'font/woff2'],
  'anton.ttf': ['anton.ttf', 'font/ttf'],
  'inter-400.woff2': ['inter-400.woff2', 'font/woff2'],
  'inter-600.woff2': ['inter-600.woff2', 'font/woff2'],
});
```

- [ ] **Step 9: The image must carry them.** In `test/deploy-image.test.js`, the list around line 144 that names `assets/fonts/tape-osd.ttf` and `assets/fonts/OFL.txt` as files the image must copy: add the six new paths. Run `node --test test/deploy-image.test.js`; expected green (`.dockerignore` excludes only `*.md` in that directory, and `!assets/fonts/OFL.txt` already negates the licence; confirm the new licences are not ignored with `git check-ignore assets/fonts/OFL-anton.txt` printing nothing).

- [ ] **Step 10: Both tests green, then the whole suite**

```bash
node --test --test-name-pattern="every face the sheet declares" test/web-static.test.js
node --test --test-name-pattern="four web fonts" test/web-api.test.js
node --test test/web-router.test.js test/web-auth.test.js
npm test > build/suite.log 2>&1; echo "exit $?"; tail -12 build/suite.log
```

Expected: both new tests pass; `web-router` still passes (the public set is an allow-list and `fontFile` is in it); the suite is baseline + 2.

- [ ] **Step 11: Sabotage.** (a) Rename `assets/fonts/anton.woff2` to `anton.woff2.off` → the faces test fails naming Anton; rename back. (b) Delete the `'anton.ttf'` entry from `FONT_FILES` (copy the file first) → the route test fails on `/fonts/anton.ttf`; restore from the copy. (c) Add the string `fonts.googleapis.com` in a comment in `scripts/web/views.mjs` → the faces test fails on the network-font sweep (this proves comments count, which is the point); restore.

- [ ] **Step 12: Guards 7/7, then commit**

```bash
git add assets/fonts scripts/web/static.mjs scripts/web/server.mjs scripts/web/router.mjs test/web-static.test.js test/web-api.test.js test/deploy-image.test.js
git commit -F build/commitmsg.txt
```

Message: `fonts: Anton and Inter, self-hosted, subset to Latin, licences beside them` with a body naming the four file sizes and the source commit of `google/fonts`. Pixels unchanged: nothing reads `--display` yet.

---
### Task 2: The tokens — one ground, one accent, DESIGN.md rewritten, the §8 guards re-pointed

Every page ends this task in the new world with its old layout. Nothing is pulled on the box.

**Files:**
- Modify: `scripts/web/static.mjs` (`:root`, the `body.is-landing` block deleted, ~60 rules re-pointed by the table below, `focusRing` and three generated rules in `presetCss`), `scripts/web/views.mjs` (`wordmark()`, `layout()`, `landingPage()` body class and bloom, `singlePlaceGround()` bloom), `scripts/web/views-auth.mjs` (`onboardingPage()` body class), `DESIGN.md` (rewritten whole)
- Test: `test/web-static.test.js`, `test/browser-smoke.test.js`, `test/web-api.test.js`, `test/web-brand.test.js`

**Interfaces:**
- Consumes: `--display` from Task 1.
- Produces: the token names every later task reads — `--ground --card --lime --lime-hover --ink --ink-soft --on-lime --on-lime-soft --rec --line --r --r-sm --r-btn --ghost --ghost-hover --display --sans --osd`, the surviving aliases `--accent --accent-bright --accent-deep --muted --faint --alarm --frost --frost-lit --lift --ink-strong --hairline --hairline-firm --on-image --on-image-soft --on-image-accent`, and the body classes `page-landing` and `has-ground`. The names `--paper`, `--oxide`, `--oxide-deep`, `--l-*` and the class `is-landing` no longer exist anywhere.

- [ ] **Step 1: Rewrite the palette test (RED).** In `test/web-static.test.js` replace the test `every colour the identity ships clears its floor on the ground it sits on` with:

```js
test('every colour the world ships clears its floor on the surface it sits on', () => {
  // DESIGN.md's table is the OUTPUT of this calculation, recomputed from the
  // values that actually ship, so the two cannot drift. Text is held to the
  // 4.5:1 body floor on BOTH dark surfaces, because a card is where most of
  // the working pages set their words; the lime pair is held to the floor on
  // lime and on its hover value, because a button is text on lime and a
  // hovered button is still a button.
  const { css } = createStylesheet(FOCUS_MENU);
  const ground = tokenValue(css, '--ground');
  const card = tokenValue(css, '--card');
  const lime = tokenValue(css, '--lime');
  const limeHover = tokenValue(css, '--lime-hover');
  const check = (name, value, surfaceName, surface) => {
    const got = contrastOf(value, surface);
    assert.ok(got >= 4.5, `${name} (${value}) measures ${got.toFixed(2)}:1 on ${surfaceName} (${surface}), under the 4.5:1 floor`);
  };
  for (const name of ['--ink', '--ink-soft', '--lime', '--rec']) {
    const value = tokenValue(css, name);
    check(name, value, '--ground', ground);
    check(name, value, '--card', card);
  }
  for (const name of ['--on-lime', '--on-lime-soft']) {
    const value = tokenValue(css, name);
    check(name, value, '--lime', lime);
    check(name, value, '--lime-hover', limeHover);
  }
  // A card is a surface, not text: it only has to be tellable from the ground.
  assert.ok(contrastOf(card, ground) >= 1.08, `--card (${card}) is indistinguishable from --ground (${ground})`);
});
```

- [ ] **Step 2: Rewrite the ghost test (RED).** Replace `a ghost sits at its ground’s floor, and --ink is what has to survive it` with:

```js
test('a ghost sits at the floor on the ground and on a card, and there is one ground', () => {
  // The rule is unchanged from the paper world: whatever --ghost is set to,
  // --ink composited at that opacity over the surface it sits on clears 4.5:1.
  // What changed is that there is ONE ground now -- body.is-landing and its
  // second --ghost are gone -- and two surfaces the ghost can sit on.
  const { css } = createStylesheet(FOCUS_MENU);
  const m = /:root\s*\{[\s\S]*?--ghost:\s*([\d.]+)/.exec(css);
  assert.ok(m, 'the sheet names no --ghost value');
  const alpha = Number(m[1]);
  const ink = tokenValue(css, '--ink');
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  for (const [name, surface] of [['--ground', tokenValue(css, '--ground')], ['--card', tokenValue(css, '--card')]]) {
    const mixed = '#' + rgb(ink)
      .map((c, i) => Math.round(c * alpha + rgb(surface)[i] * (1 - alpha)).toString(16).padStart(2, '0'))
      .join('');
    const got = contrastOf(mixed, surface);
    assert.ok(got >= 4.5, `a ghost at ${alpha} puts --ink at ${got.toFixed(2)}:1 over ${name}, under the floor`);
  }
  assert.ok(!/body\.is-landing/.test(css), 'a second ground is back in the sheet; this world has one');
});
```

- [ ] **Step 3: Rewrite the cathode test (RED).** Replace `the cathode orange has left the chrome and kept the date stamp` with:

```js
test('no value of a superseded world is left in the sheet, and the tape keeps its own stamp colour', () => {
  // Two worlds were retired on 2026-09-06 -- Struck's ink-blue and cathode
  // orange, and the paper page's cream and oxide. A retired value that
  // survives in one rule is a page that half-changed, and the generated
  // per-catalog rules bake colours in at build time where no token can
  // re-point them, so the whole sheet is scanned, generated rules included.
  // Comment lines are skipped; the house style continues a comment on plain
  // indented lines, so a retired value belongs in a comment only in words.
  const { css } = createStylesheet(FOCUS_MENU);
  const dead = new RegExp([
    '--l-(ground|lift|cathode|hot|bone|dim)', 'var\\(--(paper|oxide|oxide-deep)\\)', 'is-landing',
    '#FF8A1E', '#FFB25C', 'rgba\\(\\s*255\\s*,\\s*138\\s*,\\s*30\\b', 'rgba\\(\\s*255\\s*,\\s*178\\s*,\\s*92\\b',
    '#A8342A', '#8E2A22', 'rgba\\(\\s*168\\s*,\\s*52\\s*,\\s*42\\b', '#D98B7A',
    '#F2EDE4', '#2A211B', '#7A6A5E', 'rgba\\(\\s*42\\s*,\\s*33\\s*,\\s*27\\b',
    '#070A11', '#0C111B', 'rgba\\(\\s*7\\s*,\\s*10\\s*,\\s*17\\b', 'rgba\\(\\s*12\\s*,\\s*17\\s*,\\s*27\\b',
    '#8D8880', '#EDE7DC', '#C8C2B8', '#B9B3A9', '#4E463C', '#17120A',
  ].join('|'), 'i');
  const offenders = css.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => dead.test(l) && !/^\s*(\*|\/\*|\/\/)/.test(l));
  assert.deepEqual(offenders.map(([n, l]) => `${n}: ${l.trim()}`), [],
    'a superseded world is still painting something');

  // The date stamp inside the tape is ffmpeg's and keeps the colour the look
  // was calibrated with; the interface neither imitates nor changes it.
  const look = JSON.parse(fs.readFileSync(new URL('../config/look/base.json', import.meta.url), 'utf8'));
  const osd = JSON.stringify(look).match(/"color":"(0x[0-9A-Fa-f]{6})"/);
  assert.ok(osd, 'the look config no longer names a stamp colour');
  assert.equal(osd[1].toUpperCase(), '0XF6EAC8', 'the burnt-in date stamp changed colour; the interface work must not touch the tape');
});
```

- [ ] **Step 4: Rewrite the hero test (RED).** Replace `the hero is set in the sans face at the hero size, with the proposition beneath it` with:

```js
test('the hero is set in the display face at the hero size', () => {
  const html = landingPage({ places: PLACES_FIXTURE, account: null });
  const css = createStylesheet({ places: PLACES_FIXTURE, outfits: [] }).css;
  assert.match(html, /<h1 class="hero-line">One photograph\. Fifteen seconds of 2003\.<\/h1>/,
    'the hero is one sentence in one face');
  const hero = /\.hero-line\s*\{([^}]*)\}/.exec(css);
  assert.ok(hero, 'no .hero-line rule');
  assert.match(hero[1], /font-family:\s*var\(--display\)/, 'the hero is not in the display face');
  assert.match(hero[1], /font-size:\s*var\(--t-hero\)/, 'the hero is not at the hero size');
  assert.match(hero[1], /text-transform:\s*uppercase/, 'display is always uppercase');
  assert.doesNotMatch(hero[1], /var\(--(osd|sans)\)/, 'the hero is still in a body or readout face');
});
```

- [ ] **Step 5: Four smaller test edits (RED where the sheet changes).**
  - In `nothing in the soft tier is also ghosted`, change the colour regex to `/color:\s*var\((--faint|--ink-soft|--on-lime-soft)\)/`.
  - Replace `a pack states its price in the readout face with the credit count directly beneath it` with:

```js
test('a pack states its price in the display face with the credit count directly beneath it', () => {
  const html = pricingPage(LADDER);
  const { css } = createStylesheet({});
  assert.match(html, /<p class="price">\$12<\/p>\s*<p class="pack-credits">92 credits<\/p>/,
    'the price and its credit count are adjacent, price first');
  assert.match(html, /<p class="price">\$19<\/p>\s*<p class="pack-credits">138 credits<\/p>/);
  assert.match(css, /\.pack \.price\s*\{[^}]*font-family:\s*var\(--display\)/, 'the figure is not in the display face');
  assert.match(css, /\.pack \.price\s*\{[^}]*font-size:\s*var\(--t-8\)/, 'at the top of the type scale');
  const credits = /\.pack \.pack-credits\s*\{([^}]*)\}/.exec(css);
  assert.ok(credits, 'no .pack .pack-credits rule');
  assert.doesNotMatch(credits[1], /var\(--(osd|display)\)/, 'the count is the label role beneath the figure, not a second figure');
  const cards = html.split('<section class="pack').slice(1);
  for (const card of cards) assert.match(card, /Tax is added at checkout\./, 'each pack says tax is added');
});
```

  - In `the account page sections carry readout labels, and the deletion sits in a narrow column`, replace the last assertion with:

```js
  const label = /\.subhead--osd\s*\{([^}]*)\}/.exec(css);
  assert.ok(label, 'no .subhead--osd rule');
  assert.doesNotMatch(label[1], /var\(--osd\)/, 'the readout face belongs to the tape; a section label is the Inter label role');
  assert.match(label[1], /font-weight:\s*600/, 'the label role is Inter 600');
```

  - In `the onboarding page takes the landing world when it is given a ground, and not when it is not`, replace both `is-landing` regexes with `has-ground` (the `assert.match(withGround, /class="[^"]*has-ground/ …)` and `assert.ok(!/has-ground/.test(noGround) …)`) and retitle it `the onboarding page carries a ground when it is given one, and a plain page when it is not`.

- [ ] **Step 6: The browser tests (RED where they read the class).** In `test/browser-smoke.test.js`:
  - Delete the test `the landing nav is as bright as the hero, because it sits on the picture with no plate` and its header comment (the nav sits on lime from Task 5; the contrast sweep covers it).
  - Delete the test `no page sitting on a photograph paints its words in the dim tier` and its header comment (it keyed on `rgb(141, 136, 128)`, a value this world does not have).
  - In `every word on the onboarding page survives the dark ground it now sits on`, change `isLanding: document.body.classList.contains('is-landing')` to `hasGround: document.body.classList.contains('has-ground')`, and the assertion to `assert.ok(r.hasGround, ... 'onboarding is not carrying its ground class')`. Retitle `every word on the onboarding page survives the photograph it sits on`.
  - Retitle `the sign-in dialog on the landing is ink on paper, typed text and foot links included` to `the sign-in dialog's typed text, caret and foot links take the dialog's own ink`; its assertions are relative (input colour equals title colour) and stay.

- [ ] **Step 7: The wordmark tests (RED).** In `test/web-api.test.js` replace `the wordmark is the drawn mark, named, and carries no style of its own` with:

```js
test('the wordmark is live text in the display face, with the record light beside it', async () => {
  await withServer(async ({ base, cookieA }) => {
    const html = await (await get(base, '/', cookieA)).text();
    const from = html.indexOf('class="wordmark"');
    assert.ok(from > -1, 'the wordmark link is gone');
    const wordmark = html.slice(from, html.indexOf('</a>', from));
    // LIVE TEXT, NOT A PICTURE (2026-09-06). The drawn Cormorant mark belonged
    // to the paper world. This world sets the word in Anton, so the accessible
    // name is the word itself and nothing is inlined that the CSP could drop.
    assert.ok(!wordmark.includes('<svg'), 'the wordmark is still the drawn mark');
    assert.match(wordmark, />Timestamp</, 'the wordmark does not read as the word');
    assert.ok(wordmark.includes('class="rec"'), 'the record light lost the class the stylesheet animates');
    assert.ok(!wordmark.includes('<style'), 'the mark carries a <style> the CSP will silently drop');
  });
});
```

  Read the test that follows it (`the masthead draws the word alone -- no monogram beside it`): it slices the same lockup; keep it if it asserts only the absence of `class="mg"`; if it asserts an `<svg`, change that line to assert `>Timestamp<` instead. In `test/web-brand.test.js` replace the body of `the wordmark carries an accessible name, since it is now a picture` with an assertion that the anchor's text is the word — `assert.match(html, /class="wordmark"[^>]*>Timestamp/, 'the wordmark does not read as the word')` — and retitle it `the wordmark reads as the word, because it is the word`.

- [ ] **Step 8: Run the touched files and record the red**

```bash
node --test test/web-static.test.js test/web-api.test.js test/web-brand.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

Expected: the palette, ghost, dead-values, hero, pack-price, account-label, onboarding, and two wordmark tests fail; nothing else new.

- [ ] **Step 9: The `:root` block.** In `scripts/web/static.mjs`, replace everything from `:root {` through the closing `}` of `body.is-landing { … }` (the block ends just before `* { box-sizing: border-box; }`) with the block below. Keep the spacing scale, the type scale and the display ladder EXACTLY as they are today (copy them out of the old block into the marked slot); the ladder was checked against the hero mockup — the mockup sets the hero at 92px in a 900px-wide frame, which is 8vw, and the existing `clamp(48px, 8vw, 96px)` reproduces it — so its values do not move.

```css
:root {
  /* THE WORLD: A LIME POSTER ON A DARK GROUND (DESIGN.md, 2026-09-06). One
     ground, one accent, one light. Every ratio is measured with the WCAG
     formula and recomputed by test/web-static.test.js from the values below,
     so the table in DESIGN.md is an output and cannot drift. */
  --ground: #161618;       /* the page, everywhere                               */
  --card: #1F1F22;         /* an outlined card on the ground        1.10:1 surface */
  --lime: #D9FF00;         /* chosen, go, display    15.71:1 ground, 14.29:1 card  */
  --lime-hover: #E9FF5C;   /* the same lime pressed, on hover                     */
  --ink: #F2F2F0;          /* body prose             16.12:1 ground, 14.67:1 card  */
  --ink-soft: #A9A9A6;     /* labels, hints, fine     7.67:1 ground,  6.98:1 card  */
  --on-lime: #141414;      /* headings, buttons, body on lime      16.01:1 on lime */
  --on-lime-soft: #3A3A3A; /* fine print on lime                    9.89:1 on lime */
  /* THE RECORD LIGHT, and nothing else is red. The spec's floor value clears
     4.5:1 on the ground and not on a card (4.15:1), and the status page's
     phase rows are cards; this value clears both -- 5.01:1 and 4.55:1. */
  --rec: #E85545;
  --line: rgba(242, 242, 240, 0.14);  /* the 1px outline on cards and fields  */

  /* TEXT ON A PHOTOGRAPH IS STILL TEXT ON A PHOTOGRAPH. Measured in the paper
     world against a pure white picture under the caption scrim; the picture
     is the same picture, so these did not move. Struck on an image is lime. */
  --on-image: #FAF7F2;
  --on-image-soft: #CFC7BC;
  --on-image-accent: var(--lime);

  /* THE ALIASES THE RULES READ, RE-POINTED ONCE. Several hundred rules name
     these; none of them had to be rewritten to change world, and none may be
     rewritten back. --lift and --ink-strong are legacy names from the paper
     page that still describe what they point at (the nearer plane is the
     card; strong ink is ink) and are retired page by page as each page is
     rebuilt. The paper and oxide names are GONE, not aliased: a rule that
     says paper on a dark ground is a rule that has not been read. */
  --accent: var(--lime);
  --accent-bright: var(--lime-hover);
  --accent-deep: var(--lime);
  --muted: var(--ink);
  --faint: var(--ink-soft);
  --alarm: var(--ink);          /* there is no alarm red: weight and words */
  --frost: var(--card);
  --frost-lit: var(--card);
  --lift: var(--card);
  --ink-strong: var(--ink);
  --hairline: var(--line);
  --hairline-firm: var(--line);

  /* SHAPE. Cards and fields 10-12px, buttons 6-8px (DESIGN.md). */
  --r: 12px;
  --r-sm: 10px;
  --r-btn: 7px;

  /* THE GHOST FLOOR ON THIS GROUND. --ink at .5 over --ground measures
     4.83:1 and over --card 4.70:1; .48 is the least that clears the card and
     .5 is the round number above it. The rule is the paper world's: a ghost
     sits at the floor and no lower, and nothing inside a ghosted control is
     written in the soft tier. */
  --ghost: 0.5;
  --ghost-hover: 0.82;

  /* [ the spacing scale --s-1 .. --s-8, copied unchanged ] */
  /* [ the type scale --t-label .. --t-hero, copied unchanged ] */
  /* [ the display ladder --d-1 .. --d-4, copied unchanged; --d-1 and --d-2
       are now sizes for the label role and the smallest Anton, --d-3 and
       --d-4 are Anton card titles and section headings ] */

  /* THE THREE FACES. Anton for display, never below 18px; Inter for
     everything read; VT323 only where the interface depicts the tape. */
  --sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --display: 'Anton', Impact, 'Arial Narrow', sans-serif;
  --osd: 'TapeOSD', ui-monospace, 'Courier New', monospace;
}
```

Delete the comment block that introduced `body.is-landing` ("THE LANDING IS THE ONE PAGE STILL SPEAKING STRUCK…") along with the block. Leave the exported `PALETTE` object at the top of the file alone: it is JavaScript, not the sheet, and a test elsewhere reads it.

- [ ] **Step 10: Re-point every rule that named a superseded value.** Work down `scripts/web/static.mjs` with the Edit tool. Each row is "selector: what changes"; declarations not named are unchanged. Where a comment beside the rule explains the OLD value, cut the comment to one line saying what the rule does now. A comment may not spell a retired hex, a retired token name or the class `is-landing` (say "the landing's old alias block"): the dead-values test skips lines that begin with `*`, `/*` or `//` and nothing else, and this file's comments continue on plain indented lines.

| Selector | Change |
|---|---|
| `.wordmark` | replace the whole rule with `display: inline-flex; align-items: center; gap: 0.35em; font-family: var(--display); font-size: var(--t-4); line-height: 1; letter-spacing: 0.01em; text-transform: uppercase; color: var(--ink); text-decoration: none;` |
| `.wordmark svg` | delete the rule; add `.wordmark .rec { display: inline-block; width: 0.32em; height: 0.32em; border-radius: 50%; background: var(--rec); }` (the `.rec` blink rule below it stays) |
| `.nav a, .nav button` | add `font-weight: 600;` (the label role) |
| `.nav a:hover, .nav button:hover` | `color: var(--ink);` |
| `.creds--low .ring-fill`, `.creds--low .creds-n` | `stroke`/`color: var(--ink);` (low credits are not "chosen") |
| `.eyebrow` | add `font-weight: 600;` |
| `.headline` | `font-family: var(--display); font-size: var(--t-5); line-height: 0.92; letter-spacing: 0; text-transform: uppercase; font-weight: 400; margin: 0 0 var(--s-3);` |
| `.title` | `font-family: var(--display); font-size: var(--t-4); line-height: 0.95; letter-spacing: 0; text-transform: uppercase; font-weight: 400; margin: 0 0 var(--s-2);` |
| `.app-h1` | `font-family: var(--display); font-size: var(--t-7); line-height: 0.92; letter-spacing: 0; text-transform: uppercase; font-weight: 400; max-inline-size: 18ch; text-wrap: balance; margin: 0 0 var(--s-3);` |
| `.legal-h` | `font-family: var(--display); font-size: var(--t-4); text-transform: uppercase; letter-spacing: 0; font-weight: 400; color: var(--ink); margin: var(--s-7) 0 var(--s-3);` |
| `.stamp` | `color: var(--ink-soft);` |
| `.alert` | `background: var(--card); color: var(--ink); font-weight: 600; border: 1px solid var(--line);` (drop the rgba wash) |
| `.stepno-n` | `font-family: var(--display); line-height: 0.9; color: var(--ink);` |
| `.stepno-n--mark` | `color: var(--ink);` |
| `.placecard--own .thumb` | `background: repeating-linear-gradient(135deg, var(--card) 0 8px, var(--ground) 8px 16px);` |
| `.linky:hover` | `color: var(--ink-soft);` |
| `#pl-own:focus-visible ~ .wrap .linky` | `outline: 2px solid var(--ink); outline-offset: 2px;` |
| `input[type="file"]::file-selector-button` | `background: var(--card);` |
| `:focus-visible` | `outline: 2px solid var(--ink); outline-offset: 2px;` and add directly beneath: `.lime :focus-visible, .record:focus-visible, .go:focus-visible { outline-color: var(--on-lime); }` |
| `.pill` | `color: var(--ink); background: var(--card); border: 1px solid var(--line);` |
| `.framecard .ratio` | drop `font-family: var(--osd);`, add `font-weight: 600;` |
| `.qualitycard .name` | `font-family: var(--display); font-size: var(--t-3); letter-spacing: 0; text-transform: uppercase; line-height: 1;` |
| `.facts dd` | drop `font-family: var(--osd);`, add `font-weight: 600;` |
| `.record` | `color: var(--on-lime); border-radius: var(--r-btn); font-family: var(--display); font-size: var(--d-2); text-transform: uppercase; letter-spacing: 0.02em; font-weight: 400;` |
| `.record--way` | `background: var(--card); color: var(--ink); border: 1px solid var(--line);` and its hover `color: var(--ink); background: var(--card);` |
| `.tape .when` | drop `font-family: var(--osd);`, add `font-weight: 600; font-size: var(--t-label); text-transform: uppercase;` |
| the rule near line 1882 with `color: var(--oxide)` | `color: var(--ink);` |
| `.empty` | `background: var(--card); border: 1px solid var(--line); border-radius: var(--r);` |
| `.counter`, `.phase-state`, `.phase-n`, `.meta`, `.page-result .meta`, `.eyebrow--osd`, `.subhead--osd`, `.still-n` (the rule at ~2030) | drop `font-family: var(--osd);` from each; add `font-weight: 600;` to each |
| `.label` | add `border: 1px solid var(--line);` (its `background: var(--lift)` is the card via the alias); `.label .ldate` keeps `var(--osd)` and `color: var(--accent)` — the cassette readout is one of the three places VT323 stays |
| `.go` | `color: var(--on-lime); border-radius: var(--r-btn); font-family: var(--display); font-size: var(--d-2); text-transform: uppercase; font-weight: 400; letter-spacing: 0.02em;` |
| `.quiet:hover` | `color: var(--ink);` |
| `.signin-box` (the FIRST rule, the eleven-alias restatement) | delete the whole rule and the comment above it |
| `.signin::backdrop` | `background: rgba(22, 22, 24, 0.72);` |
| `.signin-box` (the second rule) | `background: var(--card); border: 1px solid var(--line);` |
| `.signin-t` | `font-family: var(--display); letter-spacing: 0; line-height: 0.92; color: var(--ink);` |
| `.signin-way` | `background: var(--ground); color: var(--ink); border: 1px solid var(--line); border-radius: var(--r-btn);` and its hover `background: var(--card);` |
| `.signin-go` | `background: var(--lime); color: var(--on-lime); border-radius: var(--r-btn);` and its hover `background: var(--lime-hover);` |
| `.signin-or::before, .signin-or::after` | `background: var(--line);` (a 1px fill, not a border) |
| `.signin-i` | `background: var(--ground); color: var(--ink); border: 1px solid var(--line);` |
| `.pack .mark`, `.plan .mark` | `color: var(--ink); background: var(--card); border: 1px solid var(--line);` (a flag is not chosen) |
| `.pack .price`, `.plan .price` | `font-family: var(--display); letter-spacing: 0; line-height: 0.9; text-transform: uppercase;` |
| `.pack .pack-credits` | drop `font-family: var(--osd);`, add `font-weight: 600;` |
| `body.is-landing .record` | delete |
| `.bloom` | delete the rule and its comment |
| `.is-landing .wrap`, `.is-landing .masthead`, `.is-landing .how > div, .is-landing .plain`, `.is-landing .fine`, `.is-landing .foot { margin-top: 0 }` | rename the prefix to `.page-landing` |
| `.is-landing .nav a, .is-landing .nav button` and its hover | `.page-landing .nav a, .page-landing .nav button { color: var(--ink); text-shadow: 0 1px 14px rgba(22, 22, 24, 0.7); }` hover `color: var(--lime);` |
| `.is-landing .foot, .is-landing .foot .fine, .is-landing .foot .quiet` and hover | `.page-landing .foot, .page-landing .foot .fine, .page-landing .foot .quiet, .has-ground .foot, .has-ground .foot .fine, .has-ground .foot .quiet { color: var(--ink); text-shadow: 0 1px 14px rgba(22, 22, 24, 0.7); }` hover `color: var(--lime);` |
| `.is-landing .panel` | delete (a panel is a card now, on every page) |
| `.is-landing .bg`, `.is-landing .scrim` | `.page-landing .bg, .has-ground .bg` and `.page-landing .scrim, .has-ground .scrim` |
| `.lmenu` and `.page-landing .how > div, .page-landing .plain` | `background: rgba(22, 22, 24, 0.62);` |
| `.hero-line` | `font-family: var(--display); font-size: var(--t-hero); line-height: 0.9; letter-spacing: 0; text-transform: uppercase; font-weight: 400; color: var(--ink); margin: 0 0 var(--s-5); max-inline-size: 12ch; text-wrap: balance;` |
| `.hero-sub` | `color: var(--ink);` |
| `.lopt` | `font-family: var(--display); font-size: var(--d-3); line-height: 1; letter-spacing: 0; text-transform: uppercase; color: var(--ink); opacity: var(--ghost);` |
| `.lopt .lidx` | `color: var(--ink);` |
| `.strike-hint` | drop `font-family: var(--osd);`, `color: var(--ink-soft); font-weight: 600;` |
| `.losd` | `color: var(--ink); text-shadow: none;` (keeps `var(--osd)`; the element goes in Task 5) |
| `.plain .plain-price` | `color: var(--on-image-soft);` |
| `.plain-price .linky` | `color: var(--ink);` |
| `.is-landing .cta` and hover | `.page-landing .cta { … font-family: var(--display); font-size: var(--d-4); letter-spacing: 0; text-transform: uppercase; color: var(--lime); text-shadow: none; }` hover `color: var(--lime-hover); text-shadow: none;` |
| `.is-landing .cta--quiet` and hover | `.page-landing .cta--quiet { … color: var(--ink-soft); }` hover `color: var(--ink);` |
| `.show-t`, `.how-t` | `font-family: var(--display); letter-spacing: 0; line-height: 0.92; color: var(--ink);` |
| `.how-d`, `.plain p` | `color: var(--on-image-soft);` |
| `.wipe` | `background: var(--ground);` |
| `.wipe-line` | `background: var(--ink); box-shadow: 0 0 12px rgba(22, 22, 24, 0.55);` |
| `.wipe--live .wipe-grip` | `background: var(--ink); color: var(--ground); box-shadow: 0 2px 18px rgba(22, 22, 24, 0.5);` |
| `.wipe-cap` | drop `font-family: var(--osd);`, add `font-weight: 600;`, `text-shadow: 0 1px 10px rgba(22, 22, 24, 0.85);` |
| `.wipe--live:has(.wipe-range:focus-visible) .wipe-grip` | `outline: 3px solid var(--lime); outline-offset: 3px;` (the grip is ink, so the ring is the go colour) |

In `presetCss` and `focusRing` (the generated rules):

```js
// focusRing: the ring is --ink on the dark card, offset 2px
return `#${slug}:focus-visible~.wrap .${kind}--${slug}{opacity:1;outline:2px solid var(--ink);outline-offset:2px;}${lift}`;
// the three landing-rail rules per place
`#${slug}:checked~.wrap .lopt--${slug}{opacity:1;color:var(--lime);}`,
`#${slug}:checked~.wrap .lopt--${slug} .lidx{color:var(--lime);}`,
`#${slug}:focus-visible~.wrap .lopt--${slug}{opacity:1;text-decoration:underline;text-underline-offset:6px;text-decoration-color:var(--lime);}`,
```

- [ ] **Step 11: The sweeps that must come back empty**

```bash
grep -nE "var\(--(paper|oxide|oxide-deep|l-[a-z]+)\)|body\.is-landing|\.is-landing|--l-(ground|lift|cathode|hot|bone|dim):" scripts/web/static.mjs
grep -nE "#FF8A1E|#FFB25C|255, ?138, ?30|255, ?178, ?92|#A8342A|#8E2A22|168, ?52, ?42|#F2EDE4|#070A11|#0C111B|7, ?10, ?17|12, ?17, ?27|#8D8880|#EDE7DC|#C8C2B8|#B9B3A9|#D98B7A|#2A211B|#7A6A5E|42, ?33, ?27|#4E463C|#17120A" scripts/web/static.mjs
grep -rnE "is-landing|WORDMARK_SVG|wordmark-inline" scripts/web/*.mjs
```

All three print nothing (after Step 12 for the third). Then the parse check.

- [ ] **Step 12: The views.** In `scripts/web/views.mjs`:
  - Delete the `WORDMARK_SVG` constant, its `readFileSync`, and the comment block above it. If `fs` is then imported and unused, delete the import.
  - Replace `wordmark()`'s return with `return `<a class="wordmark" href="/">Timestamp<span class="rec" aria-hidden="true"></span></a>`;` and cut its comment to: the word is live text in the display face, the record light is the one thing beside it wearing red, and it is a span animated from the sheet because an inline style anywhere is refused by the CSP.
  - In `layout()`, `<meta name="color-scheme" content="dark">` unconditionally.
  - In `landingPage()`: `bodyClass: 'page-landing'`, and delete the `<div class="bloom" aria-hidden="true"></div>` line from `preBody`.
  - In `singlePlaceGround()`: delete the bloom line from the returned markup.
  - In `scripts/web/views-auth.mjs` `onboardingPage()`: `bodyClass: ground ? 'has-ground page-onboarding' : 'page-onboarding'`.

Parse check, then:

```bash
node --test test/web-static.test.js test/web-api.test.js test/web-brand.test.js test/browser-smoke.test.js 2>&1 | grep -E "^not ok|^# (pass|fail|skipped)"
```

Expected: 0 fail.

- [ ] **Step 13: Rewrite `DESIGN.md`.** Replace the whole file with the text below (the section "The brand identity" and everything under it goes; the icon's fate is stated in the last section).

```markdown
# DESIGN.md — the lime poster

The visual world for Timestamp. Product truth lives in PRODUCT.md; this file
owns durable visual decisions. Chosen 2026-09-06 from a Dribbble reference
(a video-editing product called MAXS), approved section by section, and it
replaces the two worlds before it: Struck (2026-08-24) and the cream album
page (2026-08-28). The record of the decision is
`docs/superpowers/specs/2026-09-06-lime-redesign-design.md` and CLAUDE.md §69.

## The world in one sentence

A lime poster on a dark ground; the tape is the biggest thing on every page
that has one.

## The three rules

1. **Lime means chosen, or go.** The selected place, outfit, shape and quality;
   the primary button on every page; the wordmark; the big display moments.
   Nothing else takes it: not a label, not a link in prose, not a price, not a
   flag, not a numeral. That discipline is what lets colour answer "what have
   I chosen?".
2. **Red means the record light.** One element on the status page, plus the
   dot beside the wordmark. There is no alarm red; an error is carried by
   weight and by words, in ink.
3. **The tape's texture is the tape's.** The interface never imitates it: no
   grain, no scanlines, no vignette, no cathode orange anywhere the ground is
   dark. The date stamp burnt into a tape is ffmpeg's (`config/look/base.json`,
   `osd.color`) and the interface does not touch it.

## Palette — one ground, one accent, one light

Measured with the WCAG formula and recomputed by `test/web-static.test.js`
from the values in `static.mjs`, so this table is an output.

| Token | Value | Role | on ground | on card |
|---|---|---|---|---|
| `--ground` | `#161618` | the page, everywhere | — | — |
| `--card` | `#1F1F22` | an outlined card on the ground | 1.10:1 (surface) | — |
| `--lime` | `#D9FF00` | chosen, go, display | **15.71:1** | 14.29:1 |
| `--lime-hover` | `#E9FF5C` | the same lime, pressed | — | — |
| `--ink` | `#F2F2F0` | body prose | **16.12:1** | 14.67:1 |
| `--ink-soft` | `#A9A9A6` | labels, hints, fine print | **7.67:1** | 6.98:1 |
| `--rec` | `#E85545` | the record light | **5.01:1** | 4.55:1 |
| `--line` | `rgba(242, 242, 240, 0.14)` | the 1px outline | — | — |

| Token | Value | Role | on lime | on lime-hover |
|---|---|---|---|---|
| `--on-lime` | `#141414` | headings, buttons, body on a lime panel | **16.01:1** | 17.2:1 |
| `--on-lime-soft` | `#3A3A3A` | fine print on a lime panel | **9.89:1** | 10.6:1 |

**`--rec` moved off the spec's floor value.** `#E24B3B` clears the ground at
4.56:1 and fails a card at 4.15:1; the status page's phase rows are cards.

**Text on a photograph is still text on a photograph.** `--on-image`
`#FAF7F2`, `--on-image-soft` `#CFC7BC`, and struck-on-an-image is lime. They
were measured against a pure white picture under the caption scrim and the
picture did not change when the ground did.

**The aliases.** Several hundred rules read `--accent`, `--muted`, `--faint`,
`--alarm`, `--frost`, `--frost-lit`, `--lift`, `--ink-strong`, `--hairline`;
they are re-pointed once at `:root` and never rewritten back. The names of the
two retired worlds (`--paper`, `--oxide`, `--l-*`, `body.is-landing`) do not
exist, and a test fails if any of their values reappears in the sheet.

## Ghosts and the floor

Unlit options sit at `--ghost: 0.5`. `--ink` at that opacity measures 4.83:1
over the ground and 4.70:1 over a card; .48 is the least that clears the card.
A ghost sits at the floor and no lower, and nothing inside a ghosted control
is written in the soft tier: hierarchy inside a card is carried by size, which
survives being multiplied by an opacity, and not by colour, which does not.
Both are tests.

## Type — Anton for display, Inter for everything else

| Face | File | Where |
|---|---|---|
| Anton | `assets/fonts/anton.woff2` (+ `.ttf`) | every heading, the wordmark, card titles, prices, buttons |
| Inter 400 / 600 | `assets/fonts/inter-400.woff2`, `inter-600.woff2` | body, labels, forms, fine print |
| VT323 | `assets/fonts/tape-osd.ttf` | the date stamp inside the tape; the flip counter on the landing; the cassette label's readout on the result page. Nothing else. |

All three are SIL OFL 1.1, self-hosted from `assets/fonts/` with the licence
beside each file, under `font-src 'self'`. No network font is ever loaded.

- **Display is always uppercase**, line-height 0.9–0.92, no tracking.
- **Anton is never set below 18px.** Anything smaller that wants to read as a
  label is the label role: Inter 600, 12px (`--t-label`), tracked, uppercase.
  That is the only uppercase body text.
- **The scale is unchanged from 2026-08-31:** a minor third on 16px,
  `--t-label` 12px through `--t-8`, `--t-hero clamp(48px, 8vw, 96px)` once per
  site, `--t-mark` for the footer's giant word. The display ladder `--d-1`
  15px … `--d-4` fluid 32px keeps its steps; `--d-3` and `--d-4` are Anton,
  `--d-1` and `--d-2` are label-role sizes and the smallest Anton. Checked
  against the hero mockup: 92px in a 900px frame is 8vw, which the hero clamp
  already gives. A test fails if any rule sets a size instead of naming one.

## Texture — speckle on lime, paper on the fact cards, nothing else

- **Lime panels** carry the printed speckle: an SVG `feTurbulence` at 0.85
  base frequency, desaturated, `multiply`, opacity 0.32, on a `::before`
  layer. Defined once in the page (`layout()` emits the `<svg>` block) and
  applied from the sheet by id (`.lime::before`). It reads as ink on paper,
  not as video noise.
- **The three fact cards** on the landing carry the crumpled paper (0.018
  base frequency lit by `feDiffuseLighting`), `.fact::before`.
- **The dark ground and every dark card stay flat.** A test fails if either
  filter is applied anywhere else, or if a page carries the old gauze or grain.

## Borders and shape — allowed now

The one rule of the two old worlds ("no borders anywhere") is inverted:

- Cards, fields, FAQ rows and shelf tiles carry `1px solid var(--line)` and a
  10–12px radius (`--r`, `--r-sm`). Buttons are 6–8px (`--r-btn`).
- The outline is always the token. A border with a literal colour is still
  refused by the sweep; `<hr>` is still banned; separation is space and the
  outline of the thing itself, never a rule between things.
- `:focus-visible` is 2px, offset 2px, **`--ink` on dark surfaces and
  `--on-lime` on lime ones**, and is never removed. A lime ring on a chosen
  lime card would be invisible, and a chosen card is where focus sits after a
  selection.

## Motion

Nothing pulses or hurries the reader except the record light. The hero tape
and the place loops play muted, poster first, only when `BG_SCRIPT` finds
motion permitted and the codec playable; reduced motion, save-data, a missing
file or a refused `play()` each leave the poster standing.

## Spacing

The 4px scale, `--s-1` 4px to `--s-8` 64px, unchanged. Tight within a group,
generous between groups.

## The tape on the dark ground

A finished tape is delivered matted in 4:3 and full-bleed in the wide shapes.
Shelf tiles crop to the picture of the shape they hold (4:3 to 9/8, 16:9 and
9:16 to their own ratio, measured 2026-09-01) and carry the card outline.
Nothing is drawn over a photograph; a caption sits below it on the ground.

## What this world inherits unchanged

- CSS-only selection through hoisted `.statehook` radios at `position: fixed`.
- The 4px spacing scale and the 2026-08-31 type scale.
- Zero npm dependencies, no inline styles, server-rendered HTML, five inline
  scripts named by hash.

## Do and do not

- **Do** put the tape first on any page that has one; **do not** frame it.
- **Do** set every heading in Anton, uppercase; **do not** track it or set it
  under 18px.
- **Do** use lime for the chosen card and the primary action; **do not** use it
  for a label, a price, a flag or a link in prose.
- **Do** outline a card with `--line`; **do not** draw a rule between two
  things.
- **Do** put the speckle on lime; **do not** put any texture on the ground.
- **Do** derive every number in copy from config or a seam; **do not** type one.
- **Do** measure a contrast before shipping a colour; **do not** assert it.

## Superseded

Struck (`#070A11`, cathode `#FF8A1E`, the gauze, the bloom, the ghost rail on
a photograph) and the cream album page (`#FAF7F2`, oxide `#A8342A`, the
no-borders rule, the drawn Cormorant wordmark with the head-switch tear) are
replaced. The brand-guidelines PDF of September 2026 describes the cream world
and is not committed. **The browser icon (`Ts` knocked out of an oxide tile,
`assets/brand/icon*.png`, `favicon.ico`, `icon.svg`) is the last artefact of
the cream world still shipping**; regenerating it in this world is a separate
decision for the owner, because a changed favicon reads as a different site.
```

- [ ] **Step 14: Full suite, then sabotage.**

```bash
npm test > build/suite.log 2>&1; echo "exit $?"; tail -12 build/suite.log
```

Expected: 0 fail; the count is the Task 1 count minus 2 (two browser tests deleted).

Sabotages, one at a time, each restored from a copy: (a) add `--l-cathode: #FF8A1E;` back into `:root` → the dead-values test names the line; (b) `--ghost: 0.4;` → the ghost test fails on `--card`; (c) `--ink-soft: #707070;` → the palette test fails at about 3.7:1; (d) `.hero-line { font-family: var(--sans); …}` → the hero test fails; (e) put `<svg></svg>` inside the wordmark anchor → the web-api wordmark test fails. Print each mutated line before running.

- [ ] **Step 15: Guards 7/7, commit.**

```bash
git add scripts/web/static.mjs scripts/web/views.mjs scripts/web/views-auth.mjs DESIGN.md test/web-static.test.js test/browser-smoke.test.js test/web-api.test.js test/web-brand.test.js
git commit -F build/commitmsg.txt
```

Message: `design: one ground, one accent -- the lime world's tokens, DESIGN.md rewritten, the guards re-pointed`, with a body that names the two browser tests deleted and why (the nav sits on lime from the landing rebuild; the dim value no longer exists), the wordmark's move to live text, and `--rec`'s move off the spec's floor with both measurements. Every page is in the new world with its old layout; nothing is pulled on the box.

---
### Task 3: Shared components — the filters, the lime panel, the outlined card, the FAQ, the footer

**Files:**
- Modify: `scripts/web/views.mjs` (new exports `svgFilters`, `faq`, `siteFooter`, `factCards`, `balanceSentence`; `layout()` emits the filters and calls `siteFooter()`; `accountPage` in `views-auth.mjs` calls `balanceSentence`), `scripts/web/static.mjs` (`.vh-svg`, `.lime`, `.card`, `.fact`, `.faq*`, `.foot*`, `.panel` outline, `--t-mark` token)
- Test: `test/web-static.test.js` (texture test rewritten; new tests for the filters, the panel outline, `faq()`, `siteFooter()`, the footer's retention numbers, `balanceSentence()`), `test/web-legal.test.js` (its footer test still passes; run it)

**Interfaces:**
- Produces:
  - `svgFilters()` → the `<svg>` defs block with `id="speckle"` and `id="paper"`; emitted once per page by `layout()`.
  - `faq(items)` where `items` is `Array<{ q: string, a: string }>` → a `<section class="faq">` of `<details class="faq-row">`.
  - `faqItems({ freeCredits, photoDays, jobDays, imageProcessor, qualities, shapes, sameInEveryShape })` → the six `{q, a}` items; every number comes from its argument; no dollar figure (the landing prices nothing in dollars).
  - `inWords(n)` → `'fifteen'` for 15, digits above twenty.
  - `factCards({ frames, fps, shapes, photoDays, jobDays })` → three `<figure class="fact">` cards, the first `fact--lime`, the other two `fact--white`.
  - `siteFooter({ account })` → `<footer class="foot">` with two link columns, the giant word, the retention line and the fine print.
  - `balanceSentence({ credits, cheapest })` → `"43 credits left. Enough for 2 more tapes at 480p."` (the exact strings `accountPage` prints today; the account test pins them).
  - CSS classes: `.lime`, `.card`, `.fact`, `.fact--lime`, `.fact--white`, `.faq`, `.faq-row`, `.faq-glyph`, `.foot-cols`, `.foot-col`, `.foot-h`, `.foot-mark`; token `--t-mark`.
  - `layout()` gains `masthead = true` (Task 5 renders its own inside the lime hero).

- [ ] **Step 1: Rewrite the texture test (RED).** In `test/web-static.test.js` replace `no page the app can render wears a texture of its own` with:

```js
test('the speckle sits on lime panels only, the paper on fact cards only, and the ground carries neither', () => {
  // DESIGN.md: the dark ground and every dark card stay flat. The two textures
  // are SVG filters emitted once per page and applied from the sheet by id,
  // so "where is a texture applied" is a question the sheet can answer.
  const { css } = createStylesheet(FOCUS_MENU);
  // Comments are stripped first: a rule's text otherwise begins with whatever
  // comment preceded it, and the selector check below anchors on the start.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = bare.match(/[^{}]+\{[^{}]*\}/g) ?? [];
  const uses = rules.filter((r) => /url\(#/.test(r)).map((r) => r.replace(/\s+/g, ' ').trim());
  assert.ok(uses.some((r) => /url\(#speckle\)/.test(r)), 'the speckle is not applied anywhere');
  assert.ok(uses.some((r) => /url\(#paper\)/.test(r)), 'the paper is not applied anywhere');
  for (const r of uses) {
    assert.match(r, /^(\.lime::before|\.fact::before) \{/,
      `a texture is applied off its one permitted surface: ${r.slice(0, 100)}`);
  }
  assert.ok(uses.filter((r) => /url\(#speckle\)/.test(r)).every((r) => r.startsWith('.lime::before')), 'the speckle strayed');
  assert.ok(uses.filter((r) => /url\(#paper\)/.test(r)).every((r) => r.startsWith('.fact::before')), 'the paper strayed');

  for (const [name, html] of renderedPages()) {
    assert.ok(!/class="[^"]*\bgauze\b/.test(html), `${name} still renders the anode gauze`);
    assert.ok(!/class="[^"]*\bgrain\b/.test(html), `${name} still renders the grain plate`);
    // The defs ride once per page, whether or not the page has a lime panel:
    // a page that emits them twice has two ids and the second is ignored, a
    // page that emits none has textureless lime the day it grows a panel.
    assert.equal((html.match(/<filter id="speckle"/g) ?? []).length, 1, `${name} carries the speckle filter ${(html.match(/<filter id="speckle"/g) ?? []).length} times`);
    assert.equal((html.match(/<filter id="paper"/g) ?? []).length, 1, `${name} carries the paper filter the wrong number of times`);
  }
});
```

- [ ] **Step 2: The component tests (RED).** Add after it:

```js
test('the FAQ is native details rows, no script, one row per question', () => {
  const html = faq([{ q: 'Is it free?', a: 'Yes <to start>.' }, { q: 'Two', a: 'B' }]);
  assert.equal((html.match(/<details class="faq-row">/g) ?? []).length, 2);
  assert.equal((html.match(/<summary>/g) ?? []).length, 2);
  assert.match(html, /Yes &lt;to start&gt;\./, 'answers are escaped like every other string');
  assert.ok(!/<script/.test(html), 'the FAQ needs no script');
  const { css } = createStylesheet({});
  assert.match(css, /\.faq-row\s*\{[^}]*border:\s*1px solid var\(--line\)/, 'a row is outlined from the token');
  assert.match(css, /details\[open\]\s*>\s*summary \.faq-glyph::before\s*\{[^}]*content/, 'the plus does not turn to a minus on open');
});

test('the footer is two link columns, the giant word once, and the legal links every page has always had', () => {
  const out = siteFooter({ account: null });
  const inn = siteFooter({ account: { email: 'a@b.com' } });
  for (const href of ['/privacy', '/terms', '/impressum', '/pricing', '/#places', 'mailto:support@timestamptapes.com']) {
    assert.match(out, new RegExp(`href="${href.replace(/[.#?]/g, '\\$&')}"`), `the footer lost ${href}`);
  }
  assert.match(out, /href="\/signup">Make a tape</, 'signed out, Make a tape leads to signup');
  assert.match(inn, /href="\/">Make a tape</, 'signed in, Make a tape leads to the order form');
  assert.doesNotMatch(out, /href="\/videos"/, 'a stranger is offered a page that turns them away');
  assert.match(inn, /href="\/videos">My videos</, 'the shelf is not in the signed-in footer');
  assert.equal((out.match(/class="foot-mark"/g) ?? []).length, 1, 'the giant word appears once');
  assert.match(out, /class="foot-mark" aria-hidden="true">Timestamp\.</, 'the giant word is decoration and says so');
  assert.equal((out.match(/<div class="foot-col">/g) ?? []).length, 2, 'two columns, Product and Legal');
  assert.match(out, /Anton and Inter/, 'the fine print no longer credits the faces it ships');
  const { css } = createStylesheet({});
  assert.match(css, /\.foot-mark\s*\{[^}]*font-family:\s*var\(--display\)/, 'the giant word is not in the display face');
  assert.match(css, /\.foot-mark\s*\{[^}]*color:\s*var\(--lime\)/, 'the giant word is not lime');
  assert.match(css, /\.foot-mark\s*\{[^}]*font-size:\s*var\(--t-mark\)/, 'the giant word sets a size instead of naming one');
});

test('the footer promises the retention config/render.json enforces, on every page', () => {
  // The old layout typed "7 days" and "30"; guards.yml checks the consent text
  // against the config and nothing checked the footer. Same rule, same source.
  const cfg = JSON.parse(fs.readFileSync(new URL('../config/render.json', import.meta.url), 'utf8')).retention;
  for (const [name, html] of renderedPages()) {
    if (!/<footer class="foot">/.test(html)) continue;
    assert.match(html, new RegExp(`deleted after ${cfg.photoDays} days and the video after ${cfg.jobDays} days`),
      `${name}'s footer promises a retention the purge does not enforce`);
  }
});

test('the balance sentence is one function, and the account page speaks it', () => {
  assert.equal(balanceSentence({ credits: 43, cheapest: { id: '480p', credits: 21 } }), '43 credits left. Enough for 2 more tapes at 480p.');
  assert.equal(balanceSentence({ credits: 21, cheapest: { id: '480p', credits: 21 } }), '21 credits left. Enough for 1 more tape at 480p.');
  assert.equal(balanceSentence({ credits: 5, cheapest: { id: '480p', credits: 21 } }), '5 credits left. Not enough for another tape at 480p.');
  assert.equal(balanceSentence({ credits: 43 }), '43 credits left.');
  assert.equal(balanceSentence({ credits: NaN }), '');
});

test('a panel and a card carry the outline, from the token', () => {
  const { css } = createStylesheet({});
  for (const sel of ['.panel', '.card']) {
    const rule = new RegExp(sel.replace('.', '\\.') + '\\s*\\{([^}]*)\\}').exec(css);
    assert.ok(rule, `no ${sel} rule`);
    assert.match(rule[1], /border:\s*1px solid var\(--line\)/, `${sel} is not outlined`);
    assert.match(rule[1], /border-radius:\s*var\(--r\)/, `${sel} does not take the card radius`);
  }
  assert.match(css, /\.lime\s*\{[^}]*background:\s*var\(--lime\)/, 'the lime panel is not lime');
  assert.match(css, /\.lime\s*\{[^}]*color:\s*var\(--on-lime\)/, 'text on the lime panel does not take the on-lime ink');
});
```

Add `faq, siteFooter, balanceSentence` to the `views.mjs` import at the top of the test file. Run the file: expected FAIL (the exports do not exist).

- [ ] **Step 3: The components, in `scripts/web/views.mjs`.** Add near `wordmark()`:

```js
import { RETENTION_DEFAULTS } from '../safety/consent.mjs';

/**
 * The two textures, defined once per page and applied from the sheet by id.
 * style-src 'self' refuses inline style attributes and inline <style> blocks,
 * so a filter has to live in markup and be named from the stylesheet; an
 * <svg> of zero size is the one place that is both allowed and shared. The
 * numbers are the ones chosen on the mockups on 2026-09-06.
 */
export function svgFilters() {
  return `<svg class="vh-svg" width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="speckle" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" stitchTiles="stitch"></feTurbulence>
    <feColorMatrix type="saturate" values="0"></feColorMatrix>
    <feComponentTransfer><feFuncA type="linear" slope="0.55"></feFuncA></feComponentTransfer>
  </filter>
  <filter id="paper" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="5" seed="3" stitchTiles="stitch" result="n"></feTurbulence>
    <feDiffuseLighting in="n" lighting-color="#ffffff" surfaceScale="4" diffuseConstant="1.1" result="l"><feDistantLight azimuth="50" elevation="58"></feDistantLight></feDiffuseLighting>
    <feComponentTransfer in="l"><feFuncR type="gamma" exponent="0.9"></feFuncR><feFuncG type="gamma" exponent="0.9"></feFuncG><feFuncB type="gamma" exponent="0.9"></feFuncB></feComponentTransfer>
  </filter>
</svg>`;
}

/** Native details rows. No script: the browser opens and closes them, the
 *  keyboard works, and the glyph is a CSS pseudo-element switched on [open]. */
export function faq(items) {
  return `<section class="faq" aria-labelledby="faq-t">
  <h2 class="faq-t" id="faq-t">Questions</h2>
  ${items.map(({ q, a }) => `<details class="faq-row"><summary>${h(q)}<span class="faq-glyph" aria-hidden="true"></span></summary><p>${h(a)}</p></details>`).join('\n  ')}
</section>`;
}

/**
 * The six questions, with every number handed in. The processors list is the
 * same derivation /privacy uses, so an added classifier appears here the day
 * it appears there. `sameInEveryShape` is read off the pricing rows rather
 * than assumed: it was false until 2026-09-05.
 */
export function faqItems({
  freeCredits = null,
  photoDays = RETENTION_DEFAULTS.photoDays, jobDays = RETENTION_DEFAULTS.jobDays,
  imageProcessor = null, qualities = [], shapes = [], sameInEveryShape = true,
} = {}) {
  const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const free = freeCredits ? `A new account comes with ${freeCredits} credits, which is one tape at 480p in any shape, and there is no card to enter.` : 'A new account comes with enough credits for one tape, and there is no card to enter.';
  // No pack price here: the landing prices nothing in dollars (spec §8); the
  // pricing page carries the packs.
  const packs = ' After that, credits come in packs; the pricing page says what they cost.';
  // The processor sentence mirrors /privacy word for word, so an added
  // classifier appears here the day it appears there.
  const classifier = imageProcessor ? `, and to ${imageProcessor}, which checks it for illegal or abusive content before anything is generated` : '';
  return [
    { q: 'Is it free?', a: `To start, yes. ${free}${packs}` },
    { q: 'What happens to my photograph?', a: `It is sent to fal.ai, the AI provider that generates the tape${classifier}, and to nobody else. Location and camera data are stripped the moment it arrives. It is deleted after ${photoDays} days and the finished tape after ${jobDays} days, and you can delete either sooner from your account page.` },
    { q: 'How long does a tape take?', a: 'A few minutes. The status page shows the three phases as they happen, and the tape is still there if you close the tab and come back.' },
    { q: 'Does it look real?', a: 'The picture is generated by a model; the tape is built in ffmpeg. Grain, chroma bleed, the head-switch band and the date stamp go on the way a 2003 camcorder put them there, and nothing about the look is asked of the model. Every file is marked as AI-generated in its metadata.' },
    { q: 'Which shapes and qualities?', a: `${list(shapes)} at ${list(qualities)}. The file is the shape you choose, edge to edge in the wide shapes, and ${sameInEveryShape ? 'a tape costs the same in every shape' : 'the shape is part of the price, which the order form shows before you press Record'}.` },
    { q: 'Can I delete everything?', a: 'Yes. Your account page deletes the account, the photograph, the tapes and the credit history together, immediately. Export first if you want a copy.' },
  ];
}

/** The three fact cards, in the markup a quotation would use so real quotes
 *  can drop into the same three cards later without a layout change. */
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
/** 7 -> "seven", 15 -> "fifteen"; anything else falls back to digits. Copy is
 *  derived from config, and config counts in digits. */
export function inWords(n) { return NUMBER_WORDS[n] ?? String(n); }

export function factCards({ frames = 375, fps = 25, shapes = [], photoDays = RETENTION_DEFAULTS.photoDays, jobDays = RETENTION_DEFAULTS.jobDays } = {}) {
  const seconds = frames / fps;
  const cards = [
    ['fact--lime', `Exactly ${Number.isInteger(seconds) ? inWords(seconds) : seconds.toFixed(2)} seconds.`, `${frames} frames at ${fps} a second, PAL, because a 2003 tape was.`],
    ['fact--white', 'The shape you choose.', `${shapes.join(', ')}. The file is the shape; nothing is matted into a phone frame that did not ask for one.`],
    ['fact--white', `Deleted after ${photoDays} days.`, `The photograph. The tape after ${jobDays}. You can ask for either sooner.`],
  ];
  return `<section class="facts3" aria-label="Three facts">
  ${cards.map(([cls, head, body]) => `<figure class="fact ${cls}"><blockquote><p>${h(head)}</p></blockquote><figcaption>${h(body)}</figcaption></figure>`).join('\n  ')}
</section>`;
}

/** "43 credits left. Enough for 2 more tapes at 480p." -- one function, two pages. */
export function balanceSentence({ credits, cheapest = null } = {}) {
  const n = Number(credits);
  if (!Number.isFinite(n)) return '';
  const per = Number(cheapest?.credits);
  if (!cheapest || !Number.isFinite(per) || per <= 0) return `${n} credits left.`;
  const k = Math.floor(n / per);
  const tail = k === 0 ? ` Not enough for another tape at ${cheapest.id}.` : ` Enough for ${k} more ${k === 1 ? 'tape' : 'tapes'} at ${cheapest.id}.`;
  return `${n} credits left.${tail}`;
}

/**
 * The footer, on every page. Two link columns, the giant word (decoration,
 * and it says so), the retention promise from the same defaults the consent
 * text is written against (a test holds them equal to config/render.json),
 * and the fine print naming the three faces and their licence.
 */
export function siteFooter({ account = null } = {}) {
  const product = [
    [account ? '/' : '/signup', 'Make a tape'], ['/#places', 'Places'], ['/pricing', 'Pricing'],
    ...(account ? [['/videos', 'My videos']] : []),
  ];
  const legal = [['/privacy', 'Privacy'], ['/terms', 'Terms'], ['/impressum', 'Legal notice'], ['mailto:support@timestamptapes.com', 'support@timestamptapes.com']];
  const col = (title, links) => `<div class="foot-col"><p class="foot-h">${title}</p><ul>${links.map(([href, text]) => `<li><a class="quiet" href="${h(href)}">${h(text)}</a></li>`).join('')}</ul></div>`;
  return `<footer class="foot">
  <div class="foot-cols">${col('Product', product)}${col('Legal', legal)}</div>
  <p class="foot-mark" aria-hidden="true">Timestamp.</p>
  <p class="fine">Your photo is deleted after ${RETENTION_DEFAULTS.photoDays} days and the video after ${RETENTION_DEFAULTS.jobDays} days. You can ask for either sooner.</p>
  <p class="fine">&copy; 2026 Timestamp. Every tape is AI-generated and its file says so. Set in Anton and Inter; the date stamp is VT323 by Peter Hull. All three under the SIL Open Font Licence 1.1.</p>
</footer>`;
}
```

In `layout()`: add the option `masthead = true`; emit `${svgFilters()}` as the first thing after `<body class="…">`; wrap the `<header class="masthead">…</header>` in `${masthead ? … : ''}`; replace the literal `<footer class="foot">…</footer>` with `${siteFooter({ account })}`. In `views-auth.mjs` `accountPage()`, replace the `creditLine` computation with `const creditLine = balanceSentence({ credits: balance ? Number(balance.credits) : NaN, cheapest });` (import it from `./views.mjs`).

- [ ] **Step 4: The rules, in `scripts/web/static.mjs`.** Add `--t-mark: clamp(64px, 18vw, 240px);   /* the footer's giant word, once per site */` to the type scale in `:root` (before `--d-1`). Add to `.panel`: `border: 1px solid var(--line); border-radius: var(--r);` (replacing its `border: 0; border-radius: 0;`); `.panel--choice` keeps `border: 0; border-radius: 0` (the open panel). Add a new section before `/* --- foot --- */`:

```css
/* --- the world's primitives (2026-09-06) --------------------------------- */

.vh-svg { position: absolute; width: 0; height: 0; overflow: hidden; }

/* A LIME PANEL. The speckle is a white layer under multiply, so it darkens the
   lime by a hair where the noise is dark and leaves it alone elsewhere: ink on
   paper, not video noise. Children sit above the layer. */
.lime { position: relative; overflow: hidden; background: var(--lime); color: var(--on-lime); border-radius: var(--r); }
.lime > * { position: relative; z-index: 1; }
.lime::before { content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none; background: #FFFFFF; filter: url(#speckle); mix-blend-mode: multiply; opacity: 0.32; }

/* AN OUTLINED CARD ON THE GROUND. Flat: no texture, ever. */
.card { background: var(--card); border: 1px solid var(--line); border-radius: var(--r); }

/* THE FACT CARDS: crumpled paper, and only here. */
.fact { position: relative; overflow: hidden; margin: 0; border-radius: var(--r); padding: var(--s-6) var(--s-5); min-height: 14rem; }
.fact > * { position: relative; z-index: 1; }
.fact::before { content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none; background: #FFFFFF; filter: url(#paper); mix-blend-mode: multiply; opacity: 0.55; }
.fact--lime { background: var(--lime); color: var(--on-lime); }
.fact--white { background: #FFFFFF; color: var(--on-lime); }
.fact blockquote { margin: 0; }
.fact blockquote p { margin: 0; font-family: var(--display); text-transform: uppercase; font-size: var(--d-4); line-height: 0.92; letter-spacing: 0; }
.fact figcaption { margin: var(--s-4) 0 0; font-size: var(--t-1); color: var(--on-lime-soft); }

/* THE FAQ: native rows, outlined, the glyph switched by [open]. */
.faq { max-width: 52rem; margin: 0 auto var(--s-8); }
.faq-t { font-family: var(--display); text-transform: uppercase; font-size: var(--d-4); line-height: 0.92; letter-spacing: 0; font-weight: 400; margin: 0 0 var(--s-5); }
.faq-row { border: 1px solid var(--line); border-radius: var(--r-sm); margin: 0 0 var(--s-3); padding: 0 var(--s-5); }
.faq-row > summary { display: flex; justify-content: space-between; align-items: center; gap: var(--s-4); cursor: pointer; list-style: none; padding: var(--s-4) 0; font-weight: 600; }
.faq-row > summary::-webkit-details-marker { display: none; }
.faq-glyph::before { content: '+'; font-family: var(--display); font-size: var(--t-4); line-height: 1; color: var(--ink-soft); }
details[open] > summary .faq-glyph::before { content: '−'; }
.faq-row > p { margin: 0 0 var(--s-5); color: var(--ink-soft); max-width: 66ch; }

/* THE FOOTER: two columns, the giant word, the fine print. */
.foot-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-6); max-width: 32rem; margin: 0 0 var(--s-7); }
.foot-h { font-size: var(--t-label); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); margin: 0 0 var(--s-3); }
.foot-col ul { list-style: none; margin: 0; padding: 0; }
.foot-col li { margin: 0 0 var(--s-2); }
.foot-col .quiet { text-decoration: none; color: var(--ink); font-size: var(--t-2); }
.foot-col .quiet:hover { color: var(--lime); }
.foot-mark { font-family: var(--display); text-transform: uppercase; font-size: var(--t-mark); line-height: 0.85; letter-spacing: 0; color: var(--lime); margin: 0 0 var(--s-5); white-space: nowrap; overflow: hidden; }
@media (max-width: 30rem) { .foot-cols { grid-template-columns: 1fr; } }
```

Change `.foot { margin-top: var(--s-8); … }` to keep its margin and add `border-top: 0;` only if not present (it is). Parse check, then run `test/web-static.test.js`, `test/web-legal.test.js`, `test/web-api.test.js`, `test/web-auth.test.js`: expected green. Note the `.fact--white` literal `#FFFFFF` and the two texture layers are the only `#FFFFFF` in the sheet; the dead-values test does not list it.

- [ ] **Step 5: Full suite, sabotage, commit.** Sabotages: (a) change `.lime::before` to `.card::before` → the texture test names the rule; (b) delete `${svgFilters()}` from `layout()` → the texture test says every page carries the filter 0 times; (c) in `faq()` replace `<details class="faq-row">` with `<div class="faq-row">` → the FAQ test fails on the count; (d) change the footer's `RETENTION_DEFAULTS.photoDays` to the literal `8` → the retention test fails on every page. Restore each from its copy.

```bash
npm test > build/suite.log 2>&1; echo "exit $?"; tail -12 build/suite.log
git add scripts/web/views.mjs scripts/web/views-auth.mjs scripts/web/static.mjs test/web-static.test.js
git commit -F build/commitmsg.txt
```

Message: `components: the lime panel, the outlined card, the two textures, the FAQ rows and the footer, shared by every page`.

---

### Task 4: The showcase — faces served from outside the repository, or an honest fallback

**Files:**
- Create: `scripts/tapedeck/showcase.mjs`, `test/showcase-media.test.js`, `test/fixtures/showcase/tiny.mp4`, `test/fixtures/showcase/tiny.jpg`
- Modify: `scripts/web/server.mjs` (`SHOWCASE_FILES`, `SHOWCASE_SLOTS`, `showcaseDir` option, `showcaseFor()`, `showcaseFile` handler, `NO_SESSION_ROUTES`), `scripts/web/static.mjs` (`sendFile` gains `publicCache`), `scripts/web/router.mjs` (route + public entry), `compose.yaml`, `.env.example`, `docs/deploy-runbook.md`
- Test: `test/web-api.test.js` (route tests), `test/deploy-topology.test.js` (the bind mount), `test/showcase-media.test.js` (the producer)

**Interfaces:**
- Produces: `createServer({ showcaseDir })`; `app.showcase()` returning `{ hero, tall, fourThree, stickers }` where each of the first three is `{ video: '/showcase/<name>.mp4', poster: '/showcase/<name>.jpg', caption }` or `null`, and `stickers` is an array of up to four `/showcase/sticker-N.jpg` urls (empty when absent); `GET /showcase/:file` public, no session, `Cache-Control: public, max-age=86400`, range requests honoured; `produceShowcase({ jobDir, slot, outDir, stickerAt })` exported from the producer.

- [ ] **Step 1: The fixtures.** Face-free, tiny, carrying the provenance tags so the producer's own guard is exercised:

```bash
mkdir -p test/fixtures/showcase
ffmpeg -y -f lavfi -i "color=c=0x1F1F22:s=64x36:d=0.4:r=25" -f lavfi -i "anullsrc=r=48000:cl=mono" -t 0.4 -c:v libx264 -pix_fmt yuv420p -crf 40 -c:a aac -b:a 16k -movflags +faststart -metadata "comment=AI-generated video. Made with Timestamp (https://timestamptapes.com): a generative AI model built this scene from a photograph. The events shown did not happen." -metadata "description=digitalsourcetype=trainedAlgorithmicMedia (http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia); generator=Timestamp" test/fixtures/showcase/tiny.mp4
ffmpeg -y -f lavfi -i "color=c=0x1F1F22:s=64x36:d=1" -frames:v 1 -q:v 5 test/fixtures/showcase/tiny.jpg
ls -l test/fixtures/showcase; ffprobe -v error -show_entries format_tags=comment,description -of json test/fixtures/showcase/tiny.mp4
```

Expected: two files of a few KB, both tags present. (The audio track is there so the fixture is shaped like a real delivery; the producer strips it.)

- [ ] **Step 2: The route tests (RED).** In `test/web-api.test.js`, after the font test:

```js
test('the showcase serves an allow-listed name public, with range support and a day of shared cache, and nothing else', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-showcase-'));
  fs.copyFileSync(new URL('./fixtures/showcase/tiny.mp4', import.meta.url), path.join(dir, 'hero-16x9.mp4'));
  fs.copyFileSync(new URL('./fixtures/showcase/tiny.jpg', import.meta.url), path.join(dir, 'hero-16x9.jpg'));
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'not on the list');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-web-'));
  const app = createServer({ root, cfg: CFG, queue: fakeQueue(), port: 0, auth: fakeAuth(), showcaseDir: dir });
  const port = await app.listen();
  try {
    const video = await fetch(`http://127.0.0.1:${port}/showcase/hero-16x9.mp4`, { headers: { range: 'bytes=0-99' } });
    assert.equal(video.status, 206, 'a range request is what a <video> element sends');
    assert.equal(video.headers.get('content-type'), 'video/mp4');
    assert.match(video.headers.get('content-range') ?? '', /^bytes 0-99\//);
    assert.equal(video.headers.get('cache-control'), 'public, max-age=86400', 'the showcase is nobody\'s face to hide and everybody\'s to cache');
    assert.equal(video.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(video.headers.get('x-robots-tag'), 'noindex, nofollow');

    const poster = await fetch(`http://127.0.0.1:${port}/showcase/hero-16x9.jpg`);
    assert.equal(poster.status, 200);
    assert.equal(poster.headers.get('content-type'), 'image/jpeg');

    for (const target of ['/showcase/secret.txt', '/showcase/tape-9x16.mp4', '/showcase/..%2fsecret.txt', '/showcase/hero-16x9.MP4']) {
      const res = await fetch(`http://127.0.0.1:${port}${target}`);
      assert.ok(res.status === 404 || res.status === 400, `${target} answered ${res.status}: a name off the list, or on it but absent, is a miss`);
    }

    const s = app.showcase();
    assert.deepEqual(s.hero, { video: '/showcase/hero-16x9.mp4', poster: '/showcase/hero-16x9.jpg', caption: s.hero.caption });
    assert.equal(s.tall, null, 'a slot whose files are absent is null, never a broken url');
    assert.equal(s.fourThree, null);
    assert.deepEqual(s.stickers, []);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('with no showcase directory every name is a 404 and every slot is null', async () => {
  await withServer(async ({ base, app }) => {
    const res = await fetch(`${base}/showcase/hero-16x9.mp4`);
    assert.equal(res.status, 404);
    assert.deepEqual(app.showcase(), { hero: null, tall: null, fourThree: null, stickers: [] });
  });
});
```

Run: expected FAIL (no route; `app.showcase` is not a function).

- [ ] **Step 3: `sendFile` learns `publicCache`.** In `scripts/web/static.mjs`, add `publicCache = false` to the destructured options and change the cache line to:

```js
  const cacheControl = noStore ? 'no-store'
    : (maxAge > 0 ? `${publicCache ? 'public' : 'private'}, max-age=${maxAge}` : 'no-cache');
```

Update the function's doc comment: `private` is the default because most files served here are somebody's, and the showcase is the one caller that says otherwise.

- [ ] **Step 4: The server.** At module scope in `scripts/web/server.mjs`, beside `LANDING_IMAGES`:

```js
/**
 * THE SHOWCASE: the owner's own tapes, served from a directory OUTSIDE the
 * repository. Three tapes and four stills carry a real face; the repository
 * is public and its history is permanent, so none of them is committed.
 * TIMESTAMP_SHOWCASE_DIR names the directory; an allow-listed name under it
 * is served through sendFile like a place photograph, and any other name --
 * or any name whose file is absent -- is a 404. There is no listing.
 *
 * The captions live here, beside the names they describe: a file regenerated
 * from a different tape is a caption to change in the same edit.
 */
export const SHOWCASE_FILES = Object.freeze({
  'hero-16x9.mp4': 'video/mp4', 'hero-16x9.jpg': 'image/jpeg',
  'tape-9x16.mp4': 'video/mp4', 'tape-9x16.jpg': 'image/jpeg',
  'tape-4x3.mp4': 'video/mp4', 'tape-4x3.jpg': 'image/jpeg',
  'sticker-1.jpg': 'image/jpeg', 'sticker-2.jpg': 'image/jpeg',
  'sticker-3.jpg': 'image/jpeg', 'sticker-4.jpg': 'image/jpeg',
});
export const SHOWCASE_SLOTS = Object.freeze({
  hero: { base: 'hero-16x9', caption: 'Times Square · 2003 · 16:9 · made from one photograph' },
  tall: { base: 'tape-9x16', caption: 'Times Square · 2003 · 9:16' },
  fourThree: { base: 'tape-4x3', caption: 'The space centre · 2003 · 4:3' },
});
```

In `createServer`'s options add `showcaseDir = process.env.TIMESTAMP_SHOWCASE_DIR || null,` with a comment that a file copied in after boot needs a restart and a deploy is one. Inside `createServer`:

```js
  // Checked once, at construction. The runbook copies the files before
  // `docker compose up`, and a restart is what a deploy already is.
  const showcasePresent = new Set(showcaseDir
    ? Object.keys(SHOWCASE_FILES).filter((name) => { try { return fs.statSync(path.join(showcaseDir, name)).isFile(); } catch { return false; } })
    : []);
  function showcaseFor() {
    const url = (name) => (showcasePresent.has(name) ? `/showcase/${name}` : null);
    const slot = ({ base, caption }) => (url(`${base}.mp4`) && url(`${base}.jpg`)
      ? { video: url(`${base}.mp4`), poster: url(`${base}.jpg`), caption }
      : null);
    return {
      hero: slot(SHOWCASE_SLOTS.hero),
      tall: slot(SHOWCASE_SLOTS.tall),
      fourThree: slot(SHOWCASE_SLOTS.fourThree),
      stickers: [1, 2, 3, 4].map((n) => url(`sticker-${n}.jpg`)).filter(Boolean),
    };
  }
```

Add the handler beside `landingImage`:

```js
    showcaseFile(req, res, { params }) {
      const name = String(params.file ?? '');
      const type = Object.hasOwn(SHOWCASE_FILES, name) ? SHOWCASE_FILES[name] : null;
      if (!type || !showcaseDir) throw new HttpError(404, 'Not found.', { code: 'NO_SHOWCASE' });
      if (!sendFile(req, res, { file: path.join(showcaseDir, name), contentType: type, maxAge: 86_400, publicCache: true })) {
        throw new HttpError(404, 'Not found.', { code: 'NO_SHOWCASE' });
      }
    },
```

Expose `showcase: showcaseFor` on the object `createServer` returns (beside `listen`/`close`). Add `'showcaseFile'` to `NO_SESSION_ROUTES`. In `router.mjs`, after `/landing/:file`: `{ method: 'GET', pattern: '/showcase/:file', name: 'showcaseFile' },` with a two-line comment (the owner's tapes, from outside the repository, by allow-list), and `'showcaseFile'` in `PUBLIC_ROUTES` beside `'landingImage'`. Run the two tests: expected green; then `test/web-router.test.js`, `test/web-auth.test.js`.

- [ ] **Step 5: The producer's test (RED).** Create `test/showcase-media.test.js`:

```js
/**
 * The showcase producer: a job directory in, web-sized tapes and stills out,
 * and a refusal to write a file that lost its Art. 50 tags on the way.
 * Self-skipping without ffmpeg, like the audio tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runFfmpeg, runFfprobe, findFfmpeg } from '../scripts/ffmpeg/run.mjs';
import { produceShowcase } from '../scripts/tapedeck/showcase.mjs';

async function haveFfmpeg() { try { await runFfmpeg(['-hide_banner', '-version']); return true; } catch { return false; } }
const HAVE = await haveFfmpeg();
const skip = HAVE ? false : `ffmpeg not found (${findFfmpeg().ffmpeg}) -- showcase producer tests skipped`;

const TAGS = [
  '-metadata', 'comment=AI-generated video. Made with Timestamp (https://timestamptapes.com): a generative AI model built this scene from a photograph. The events shown did not happen.',
  '-metadata', 'description=digitalsourcetype=trainedAlgorithmicMedia (http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia); generator=Timestamp',
];

/** A fake delivered tape: the delivery raster, 1 second, the provenance tags. */
async function fakeJob(dir, { width, height, tagged = true }) {
  fs.mkdirSync(dir, { recursive: true });
  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}:d=1:r=25`,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '35', '-c:a', 'aac', '-movflags', '+faststart',
    ...(tagged ? TAGS : []), path.join(dir, 'timestamp.mp4'),
  ]);
  return dir;
}

async function probeOf(file) {
  const out = await runFfprobe(['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format_tags=comment,description', '-of', 'json', file]);
  return JSON.parse(out.stdout ?? out);
}

test('the three slots come out at the web rasters, muted, tagged, with a poster each', { skip }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-showcase-src-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-showcase-out-'));
  try {
    const wide = await fakeJob(path.join(tmp, 'wide'), { width: 1920, height: 1080 });
    const tall = await fakeJob(path.join(tmp, 'tall'), { width: 1080, height: 1920 });
    for (const [slot, jobDir, w, hgt] of [['hero-16x9', wide, 1280, 720], ['tape-9x16', tall, 540, 960], ['tape-4x3', tall, 960, 720]]) {
      const written = await produceShowcase({ jobDir, slot, outDir: out });
      assert.deepEqual(written.map((p) => path.basename(p)).sort(), [`${slot}.jpg`, `${slot}.mp4`]);
      const p = await probeOf(path.join(out, `${slot}.mp4`));
      const v = p.streams.find((s) => s.codec_type === 'video');
      assert.equal(`${v.width}x${v.height}`, `${w}x${hgt}`, `${slot} raster`);
      assert.ok(!p.streams.some((s) => s.codec_type === 'audio'), `${slot} still carries an audio stream; the showcase is muted`);
      assert.match(p.format.tags.comment ?? '', /AI-generated/, `${slot} lost the Art. 50 sentence`);
      assert.match(p.format.tags.description ?? '', /trainedAlgorithmicMedia/, `${slot} lost the IPTC marker`);
      assert.ok(fs.statSync(path.join(out, `${slot}.jpg`)).size > 0, `${slot} has no poster`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('a source without the provenance tags is refused, and nothing is left behind', { skip }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-showcase-src-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-showcase-out-'));
  try {
    const bare = await fakeJob(path.join(tmp, 'bare'), { width: 1920, height: 1080, tagged: false });
    await assert.rejects(() => produceShowcase({ jobDir: bare, slot: 'hero-16x9', outDir: out }), /provenance/i);
    assert.deepEqual(fs.readdirSync(out), [], 'a refused encode left files in the output directory');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('a sticker is one frame at 480 wide, from the slot it names', { skip }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-showcase-src-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-showcase-out-'));
  try {
    const wide = await fakeJob(path.join(tmp, 'wide'), { width: 1920, height: 1080 });
    const [file] = await produceShowcase({ jobDir: wide, slot: 'hero-16x9', outDir: out, sticker: 1, stickerAt: 0.5 });
    assert.equal(path.basename(file), 'sticker-1.jpg');
    const p = await probeOf(file);
    assert.equal(p.streams[0].width, 480);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});
```

Check `runFfprobe`'s return shape in `scripts/ffmpeg/run.mjs` (line 137) and adjust `probeOf` to whatever it returns (`{ stdout }` or a string) before running. Expected: FAIL, module not found.

- [ ] **Step 6: The producer.** Create `scripts/tapedeck/showcase.mjs`:

```js
/**
 * The showcase producer: one job directory in, one web-sized tape and its
 * poster out, into a directory that is NOT the repository.
 *
 *   node scripts/tapedeck/showcase.mjs --job=out/jobs/<id> --slot=hero-16x9 --out=build/showcase
 *   node scripts/tapedeck/showcase.mjs --job=out/jobs/<id> --slot=hero-16x9 --out=build/showcase --sticker=1 --at=12.0
 *   node scripts/tapedeck/showcase.mjs --job=out/jobs/<id> --slot=hero-16x9 --out=build/showcase --sticker=4 --at=14.5 --crop=stamp
 *
 * The delivered tape is never served: at crf 26 and 1080 lines it is 20-37 MB
 * and exists to be downloaded. The landing streams these instead -- 1280x720,
 * 540x960 and 960x720 at crf 28, muted, faststart, a few MB each.
 *
 * THE ART. 50 TAGS MUST SURVIVE, and the script checks rather than hopes:
 * `-map_metadata 0` carries them, ffprobe reads them back, and a file that
 * lost either is deleted and the run fails. The same guard the re-encode on
 * the box carried on 2026-09-05 (CLAUDE.md section 64D).
 *
 * Untested for what it LOOKS like, exactly as wipe-pair.mjs and place-loops.mjs
 * are: the owner judges the frames. What is tested is the raster, the silence,
 * the tags and the refusal.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { runFfmpeg, runFfprobe } from '../ffmpeg/run.mjs';

const CRF = '28';

/** Per slot: the filter that turns the delivered file into the web file. The
 *  4:3 delivery is the 4:3 picture matted inside 1080x1920 -- rows 555..1364
 *  (CLAUDE.md section 31 measured the middle half) -- so it is cropped out
 *  before it is scaled. */
export const SLOTS = Object.freeze({
  'hero-16x9': { vf: 'scale=1280:720', width: 1280, height: 720 },
  'tape-9x16': { vf: 'scale=540:960', width: 540, height: 960 },
  'tape-4x3': { vf: 'crop=1080:810:0:555,scale=960:720', width: 960, height: 720 },
});

/** The bottom-right region a burnt-in stamp sits in, as a fraction of the frame. */
const STAMP_CROP = 'crop=iw*0.34:ih*0.20:iw*0.64:ih*0.78';

async function tagsOf(file) {
  const out = await runFfprobe(['-v', 'error', '-show_entries', 'format_tags=comment,description', '-of', 'json', file]);
  const text = typeof out === 'string' ? out : out.stdout;
  return JSON.parse(text).format?.tags ?? {};
}

function assertProvenance(tags, what) {
  if (!/AI-generated/.test(tags.comment ?? '') || !/trainedAlgorithmicMedia/.test(tags.description ?? '')) {
    throw new Error(`${what} does not carry the provenance tags (comment and description); refusing to publish a tape that does not say what it is`);
  }
}

/**
 * @param {{jobDir: string, slot: keyof SLOTS, outDir: string, sticker?: number, stickerAt?: number, crop?: 'stamp'|null}} o
 * @returns {Promise<string[]>} the files written
 */
export async function produceShowcase({ jobDir, slot, outDir, sticker = null, stickerAt = 0, crop = null }) {
  const spec = SLOTS[slot];
  if (!spec) throw new Error(`unknown slot ${slot}; one of ${Object.keys(SLOTS).join(', ')}`);
  const src = path.join(jobDir, 'timestamp.mp4');
  if (!fs.existsSync(src)) throw new Error(`no delivered tape at ${src}`);
  assertProvenance(await tagsOf(src), src);
  fs.mkdirSync(outDir, { recursive: true });

  if (sticker !== null) {
    const out = path.join(outDir, `sticker-${sticker}.jpg`);
    const vf = [crop === 'stamp' ? STAMP_CROP : spec.vf.startsWith('crop=') ? spec.vf.split(',')[0] : null, 'scale=480:-2'].filter(Boolean).join(',');
    await runFfmpeg(['-y', '-ss', String(stickerAt), '-i', src, '-frames:v', '1', '-vf', vf, '-q:v', '3', out]);
    return [out];
  }

  const video = path.join(outDir, `${slot}.mp4`);
  const poster = path.join(outDir, `${slot}.jpg`);
  const tmp = `${video}.part.mp4`;
  await runFfmpeg([
    '-y', '-i', src, '-map', '0:v:0', '-an', '-vf', spec.vf,
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', CRF, '-preset', 'slow',
    '-movflags', '+faststart', '-map_metadata', '0', tmp,
  ]);
  try {
    assertProvenance(await tagsOf(tmp), tmp);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  fs.renameSync(tmp, video);
  // The poster is the LAST frame of the encoded file, so it matches the loop
  // point exactly and the swap from poster to video is invisible.
  await runFfmpeg(['-y', '-sseof', '-0.08', '-i', video, '-frames:v', '1', '-update', '1', '-q:v', '3', poster]);
  return [video, poster];
}

function parseArgs(argv) {
  const o = {};
  for (const a of argv) {
    const m = /^--([a-z]+)=(.*)$/.exec(a);
    if (!m) throw new Error(`unknown argument ${a}`);
    o[m[1]] = m[2];
  }
  return o;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = parseArgs(process.argv.slice(2));
  const files = await produceShowcase({
    jobDir: a.job, slot: a.slot, outDir: a.out,
    sticker: a.sticker ? Number(a.sticker) : null, stickerAt: a.at ? Number(a.at) : 0, crop: a.crop ?? null,
  });
  for (const f of files) console.log(`${path.basename(f)}  ${Math.round(fs.statSync(f).size / 1024)} kB`);
}
```

Run `node --test test/showcase-media.test.js`: expected green. If `-update 1` is refused by the ffmpeg in use, drop it (it silences a single-image warning on ffmpeg 6+).

- [ ] **Step 7: The topology test (RED), then compose, env, runbook.** In `test/deploy-topology.test.js` add:

```js
test('the showcase directory is mounted read-only into web, and into nothing else', () => {
  // The owner's face is on that disk. web serves it by allow-list; the worker
  // and caddy have no business reading it, and neither may write it.
  const compose = read('compose.yaml');
  const service = (name) => new RegExp(`^  ${name}:$([\\s\\S]*?)(?=^  \\w|^volumes:)`, 'm').exec(compose)?.[1] ?? '';
  assert.match(service('web'), /^\s*- \/opt\/timestamp\/showcase:\/showcase:ro$/m, 'web does not mount the showcase read-only');
  assert.equal(/showcase/.test(service('worker')), false, 'the worker mounts the showcase');
  assert.equal(/showcase/.test(service('caddy')), false, 'caddy mounts the showcase');
  assert.match(read('.env.example'), /TIMESTAMP_SHOWCASE_DIR/, '.env.example does not document the variable');
  assert.match(read('docs/deploy-runbook.md'), /showcase\.mjs/, 'the runbook does not say how the files are made');
});
```

Then in `compose.yaml` under `web:` `volumes:` add `      - /opt/timestamp/showcase:/showcase:ro` with a comment: the owner's tapes, produced on the box by the producer script into a directory outside the repository, read-only, web only. In `.env.example`, after the `TIMESTAMP_INDEXABLE` block:

```
# Where the landing's showcase tapes live -- the owner's own face, which must
# never enter this public repository. Produced once by
# scripts/tapedeck/showcase.mjs from a finished job directory; the web process
# serves an allow-listed set of names from here under /showcase/ and answers
# 404 to everything else. Unset means no showcase: the landing shows a place
# photograph in the tape's slot and says so, and that is the state every test
# runs in. On the box this is /showcase inside the container (compose mounts
# /opt/timestamp/showcase there, read-only). Put it in .env.web: only web
# reads it.
# TIMESTAMP_SHOWCASE_DIR=/showcase
```

In `docs/deploy-runbook.md`: a new subsection in §1 after step 4, "5. The showcase":

```markdown
5. **The showcase.** The landing plays three of the owner's tapes; they live in
   `/opt/timestamp/showcase`, outside the repository, and are produced ON THE
   BOX from the finished jobs so no face travels:

   ```bash
   install -d -m 755 /opt/timestamp/showcase
   cd /opt/timestamp
   # the 9:16 Times Square tape and the 4:3 space-centre tape are already on the volume
   docker compose run --rm -v /opt/timestamp/showcase:/showcase web node scripts/tapedeck/showcase.mjs --job=/data/jobs/20260905-125257-3a448b --slot=tape-9x16 --out=/showcase
   docker compose run --rm -v /opt/timestamp/showcase:/showcase web node scripts/tapedeck/showcase.mjs --job=/data/jobs/20260905-200239-931272 --slot=tape-4x3 --out=/showcase
   ls -l /opt/timestamp/showcase
   ```

   The 16:9 hero (`20260905-221822-a32b2a`) was rendered on the development
   machine, so `hero-16x9.mp4`, `hero-16x9.jpg` and the four `sticker-N.jpg`
   are produced there and copied up with `scp` into the same directory. Then
   `TIMESTAMP_SHOWCASE_DIR=/showcase` in `.env.web`, and `docker compose up -d`
   (the files are checked at boot). A missing file is not an error: the page
   falls back to a place photograph in that slot.
```

And in §4's smoke list a new step 9: `https://timestamptapes.com/showcase/hero-16x9.mp4` with a `Range: bytes=0-99` header answers 206 and `Cache-Control: public, max-age=86400`; the landing's hero plays muted; `/showcase/anything-else` is 404. Run `node --test test/deploy-topology.test.js`: green.

- [ ] **Step 8: Produce the hero locally (no commit of the output).**

```bash
node scripts/tapedeck/showcase.mjs --job=out/jobs/20260905-221822-a32b2a --slot=hero-16x9 --out=build/showcase
ls -l build/showcase
```

Expected: `hero-16x9.mp4` about 2.5–4 MB (the mockup's crf-30 encode was 2.5 MB), `hero-16x9.jpg` under 300 KB. `build/` is gitignored; `git status` must not show them. Set `TIMESTAMP_SHOWCASE_DIR=C:/Users/pauls/Timestamp/build/showcase` in the local `.env` for the owner's review in Task 5.

- [ ] **Step 9: Sabotage, suite, commit.** (a) Remove the `Object.hasOwn` check in `showcaseFile` (serve any name under the dir) → the route test fails on `/showcase/secret.txt`; (b) drop `-map_metadata 0` from the encode → the producer's first test fails on the tags AND the refusal test passes for the wrong reason, which is why the first exists; (c) drop `:ro` from the compose mount → the topology test fails. Restore each from its copy.

```bash
npm test > build/suite.log 2>&1; echo "exit $?"; tail -12 build/suite.log
git add scripts/tapedeck/showcase.mjs scripts/web/server.mjs scripts/web/static.mjs scripts/web/router.mjs compose.yaml .env.example docs/deploy-runbook.md test/showcase-media.test.js test/web-api.test.js test/deploy-topology.test.js test/fixtures/showcase
git commit -F build/commitmsg.txt
```

Message: `showcase: the owner's tapes served by allow-list from outside the repository, with a producer that refuses to drop the provenance tags`. Confirm before committing that `git status` shows nothing under `build/` and nothing under `out/`.

---
### Task 5: The landing — eight sections, the tape first (STOPS FOR THE OWNER TO LOOK)

**Files:**
- Modify: `scripts/web/views.mjs` (`landingPage()` rewritten; `BG_SCRIPT` rewritten), `scripts/web/static.mjs` (the landing section rewritten; two generated rules in `presetCss` re-targeted; the `losd` rule deleted), `scripts/web/server.mjs` (`landingPricing()` gains `freeCredits` and `sameInEveryShape`; new `publicFacts()`; the signed-out `homePage` branch passes `showcase` and `facts`)
- Test: `test/web-static.test.js` (the four landing tests rewritten as five), `test/web-auth.test.js` (two assertions), `test/browser-smoke.test.js` (the shared session mounts a showcase; three tests rewritten or added)

**Interfaces:**
- Consumes: `svgFilters`, `faq`, `faqItems`, `factCards`, `siteFooter`, `layout({ masthead })` from Task 3; `app.showcase()`'s shape from Task 4; `--display`, `--lime`, `--on-lime`, `.lime`, `.card`, `.fact` from Tasks 2–3.
- Produces: `landingPage({ places, account, pricing, csrf, showcase, facts })` where `pricing` is `{ fromCredits, packUSD, packCredits, freeCredits, sameInEveryShape } | null` and `facts` is `{ photoDays, jobDays, imageProcessor, qualities, shapes, frames, fps }`; `publicFacts()` in the server (Task 6 reuses it); `BG_SCRIPT` that also starts every `video[data-src]`; the section classes `hero`, `manifesto`, `how2`, `band`, `facts3`, `demo`, `faq`.

- [ ] **Step 1: Confirm the component contracts this page reads.** `faqItems()` takes `{ freeCredits, photoDays, jobDays, imageProcessor, qualities, shapes, sameInEveryShape }` and prices nothing in dollars; `factCards()` heads its first card `Exactly fifteen seconds.` through `inWords()`; both are Task 3's. `grep -n "export function \(faqItems\|factCards\|inWords\)" scripts/web/views.mjs` prints three lines. (Do not add a second `inWords`.)

- [ ] **Step 2: The landing tests (RED).** In `test/web-static.test.js` delete `the landing plays the place full-bleed instead of framing it in a panel`, `the price sits with the claim, and the hero carries one action` and `the landing list is a rail that snaps, and its menu is a plate`, and add:

```js
test('the landing is eight sections in order, the tape slot in the hero and the place ground in the band', () => {
  const html = landingPage({ places: PLACES_FIXTURE, account: null });
  const order = ['<header class="lime hero">', 'class="manifesto', 'class="how2', 'class="band" id="places"', 'class="facts3"', 'class="demo', 'class="faq"', '<footer class="foot">'];
  let at = -1;
  for (const marker of order) {
    const i = html.indexOf(marker, at + 1);
    assert.ok(i > at, `${marker} is missing, or out of order`);
    at = i;
  }
  // ONE loop video, inert, inside the band; the hero's tape is its own figure.
  assert.equal((html.match(/<video class="bgv"/g) ?? []).length, 1, 'the band should carry one loop video');
  const band = html.slice(html.indexOf('class="band"'), html.indexOf('class="facts3"'));
  assert.match(band, /class="bgs"/, 'the place ground is not inside the band');
  assert.match(band, /class="bg bg--pl-ostsee-strand"/, 'the still fallback layer is missing');
  assert.match(band, /class="scrim"/, 'the band has a photograph and no scrim');
  assert.match(band, /<ul class="lrail">/, 'the rail is not inside the band');
  assert.match(band, /Baltic beach/, 'the rail lost its place names');
  assert.ok(!/class="(lmenu|strike|losds|losd|bloom|veils|plain|how-lead)"/.test(html), 'a piece of the old landing survives');
  for (const tag of html.match(/<video[^>]*>/g) ?? []) {
    assert.ok(!/\ssrc=/.test(tag) && !/\sautoplay/.test(tag), `a video loads before any check has run: ${tag}`);
    assert.ok(/\smuted/.test(tag) && /\splaysinline/.test(tag) && /\sloop/.test(tag), `a video without muted+playsinline+loop: ${tag}`);
  }
  assert.doesNotMatch(landingPage({ places: [], account: null }), /undefined/, 'an empty catalog leaks undefined into the page');
});

test('the hero carries one action and the free-grant sentence, and the landing prices nothing in dollars', () => {
  const pricing = { fromCredits: 21, packUSD: 12, packCredits: 92, freeCredits: 21, sameInEveryShape: true };
  const html = landingPage({ places: PLACES_FIXTURE, account: null, pricing });
  const hero = /<header class="lime hero">([\s\S]*?)<\/header>/.exec(html);
  assert.ok(hero, 'no lime hero');
  assert.equal((hero[1].match(/class="hero-cta"/g) ?? []).length, 1, 'the hero carries exactly one action');
  assert.match(hero[1], /21 free credits with a new account\. One tape, no card\./, 'the free-grant line is missing or typed differently');
  assert.match(hero[1], /Upload one photo of your face, choose a place and an outfit, and get back a tape that looks like it was found in a drawer\./);
  assert.match(hero[1], /class="ruler"[\s\S]*>REC<[\s\S]*>00:15</, 'the counter ruler is missing or does not run to fifteen');
  assert.match(hero[1], /<nav class="hero-nav"[\s\S]*href="#places">Places<[\s\S]*href="\/pricing">Pricing<[\s\S]*data-signin>Sign in<[\s\S]*class="navpill"/, 'the nav is not inside the hero, or lost a link');
  assert.doesNotMatch(html, /\$\d/, 'a dollar price reached the landing; the pack prices live on the pricing page');
  assert.doesNotMatch(landingPage({ places: PLACES_FIXTURE, account: null }), /free credits with a new account/, 'a grant sentence was invented with no seam behind it');
});

test('the showcase fills the hero, the stickers and the demo when present, and each slot falls back to a place when absent', () => {
  const showcase = {
    hero: { video: '/showcase/hero-16x9.mp4', poster: '/showcase/hero-16x9.jpg', caption: 'Times Square · 2003 · 16:9 · made from one photograph' },
    tall: { video: '/showcase/tape-9x16.mp4', poster: '/showcase/tape-9x16.jpg', caption: 'Times Square · 2003 · 9:16' },
    fourThree: null,
    stickers: ['/showcase/sticker-1.jpg', '/showcase/sticker-2.jpg'],
  };
  const full = landingPage({ places: PLACES_FIXTURE, account: null, showcase });
  const heroTape = /<figure class="hero-tape">([\s\S]*?)<\/figure>/.exec(full);
  assert.ok(heroTape, 'no hero tape figure');
  assert.match(heroTape[1], /<video class="tape-media tape-media--hero" muted playsinline loop preload="none" poster="\/showcase\/hero-16x9\.jpg" data-src="\/showcase\/hero-16x9\.mp4">/);
  assert.match(heroTape[1], /<figcaption class="tape-cap">Times Square · 2003 · 16:9 · made from one photograph<\/figcaption>/);
  assert.equal((full.match(/class="sticker sticker--/g) ?? []).length, 2, 'one sticker per file present, and no more');
  const demo = /<section class="demo inner">([\s\S]*?)<\/section>/.exec(full);
  assert.ok(demo, 'no demo band');
  assert.match(demo[1], /data-src="\/showcase\/tape-9x16\.mp4"/, 'the tall tape is missing from the demo');
  assert.match(demo[1], /<img class="tape-media tape-media--four" src="\/places\/wohnzimmer-abend\.jpg"/, 'an absent 4:3 tape does not fall back to a place photograph');

  const none = landingPage({ places: PLACES_FIXTURE, account: null, showcase: null });
  assert.ok(!/\/showcase\//.test(none), 'a page with no showcase names a showcase url');
  assert.ok(!/data-src=/.test(none), 'a page with no showcase ships a video it cannot fill');
  const fallback = /<figure class="hero-tape">([\s\S]*?)<\/figure>/.exec(none);
  assert.match(fallback[1], /<img class="tape-media tape-media--hero" src="\/places\/ostsee-strand\.jpg"/, 'the hero slot does not fall back to the first place');
  assert.match(fallback[1], /<figcaption class="tape-cap">Baltic beach<\/figcaption>/, 'the fallback is captioned with the place, never with the tape');
  assert.doesNotMatch(none, /class="sticker /, 'a sticker was invented');
});

test('the landing asks six questions, states three facts as quotations, reads a date, and ends on the giant word once', () => {
  const html = landingPage({
    places: PLACES_FIXTURE, account: null,
    pricing: { fromCredits: 21, packUSD: 12, packCredits: 92, freeCredits: 21, sameInEveryShape: true },
    facts: { photoDays: 7, jobDays: 30, imageProcessor: null, qualities: ['480p', '720p'], shapes: ['4:3', '16:9', '9:16'], frames: 375, fps: 25 },
  });
  assert.equal((html.match(/<details class="faq-row">/g) ?? []).length, 6, 'six questions');
  assert.match(html, /sent to fal\.ai, the AI provider that generates the tape, and to nobody else/);
  assert.match(html, /deleted after 7 days and the finished tape after 30 days/);
  assert.match(html, /4:3, 16:9 and 9:16 at 480p and 720p/);
  assert.match(html, /a tape costs the same in every shape/);
  assert.equal((html.match(/<figure class="fact /g) ?? []).length, 3, 'three fact cards');
  assert.match(html, /<figure class="fact fact--lime"><blockquote><p>Exactly fifteen seconds\.<\/p><\/blockquote><figcaption>375 frames at 25 a second, PAL/);
  assert.match(html, /<figure class="fact fact--white"><blockquote><p>Deleted after 7 days\.<\/p>/);
  assert.match(html, /<p class="flip" aria-label="14 08 2003">/, 'the flip counter does not read the date the product is named for');
  assert.equal((html.match(/class="foot-mark"/g) ?? []).length, 1, 'the giant word appears once');
  assert.match(html, /run through a real tape chain/, 'the grade card lost the sentence the still-approval sweep anchors on');
  assert.match(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), /You, somewhere in 2003, on a tape that looks found in a drawer\./, 'the manifesto sentence is broken by its stickers');
  // With a classifier declared the FAQ names it, the way /privacy does.
  const two = landingPage({ places: PLACES_FIXTURE, account: null, facts: { imageProcessor: 'Amazon Web Services (Rekognition), Frankfurt' } });
  assert.match(two, /and to Amazon Web Services \(Rekognition\), Frankfurt, which checks it/);
});

test('the place rail snaps inside the band, over the photograph it lights', () => {
  const html = landingPage({ places: PLACES_FIXTURE, account: null });
  const css = createStylesheet({ places: PLACES_FIXTURE, outfits: [] }).css;
  assert.ok(/<ul class="lrail">/.test(html), 'the place options are not a rail');
  assert.ok(/<li>.*lopt--pl-ostsee-strand/s.test(html), 'the rail dropped its list items');
  const rail = /\.lrail\s*\{([^}]*)\}/.exec(css);
  assert.ok(rail, 'no .lrail rule');
  assert.ok(/scroll-snap-type:\s*x mandatory/.test(rail[1]), 'the rail does not snap');
  assert.ok(/overflow-x:\s*auto/.test(rail[1]), 'the rail does not scroll');
  assert.ok(/\.lrail\s+li\s*\{[^}]*scroll-snap-align/.test(css), 'the items have no snap point');
  // The generated rules reach a ground that now lives INSIDE the band.
  assert.match(css, /#pl-ostsee-strand:checked~\.wrap \.bgs \.bg--pl-ostsee-strand\{opacity:1;\}/, 'the still-layer rule cannot reach a ground inside the band');
  assert.match(css, /#pl-ostsee-strand:checked~\.wrap \.lopt--pl-ostsee-strand\{opacity:1;color:var\(--lime\);\}/, 'the chosen place is not lime');
  assert.ok(!/\.lmenu\s*\{/.test(css), 'the plate rule survives its element');
  assert.match(css, /\.band \.scrim\s*\{/, 'the band has no scrim rule of its own');
  assert.doesNotMatch(css, /\.losd\b/, 'the OSD readout rule survives its element');
});
```

In `test/web-auth.test.js`: in `the landing page carries nothing that belongs to an account` change `html.includes('ordinary')` to `html.includes('Fifteen seconds of 2003')`; in `the same path signed in is the app, not the landing page` change `!html.includes('Make a tape')` to `!html.includes('class="lime hero"')` (the footer now says Make a tape on every page, so the hero is the landing's marker). Run both files: expected FAIL on the five new tests.

- [ ] **Step 3: `BG_SCRIPT`.** Replace the constant's text with:

```js
const BG_SCRIPT = `
(function () {
  var probe = document.createElement('video');
  if (!probe.canPlayType || !probe.canPlayType('video/mp4')) return;

  // A moving picture is the largest animation this page could make, so it is
  // the first thing a request for reduced motion should cost.
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce && reduce.matches) return;

  // And on a metered connection a decorative megabyte is not worth spending.
  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && conn.saveData) return;

  // THE SHOWCASE TAPES. The poster is in the markup and the source is only
  // here, so no script, reduced motion, save-data, an unplayable codec or a
  // missing file each leave the poster standing.
  var tapes = document.querySelectorAll('video[data-src]');
  for (var t = 0; t < tapes.length; t += 1) {
    (function (v) {
      v.src = v.getAttribute('data-src');
      var p = v.play();
      if (p && p.catch) p.catch(function () { /* autoplay refused; the poster stands */ });
    }(tapes[t]));
  }

  var video = document.querySelector('.bgv');
  if (!video) return;
  var bgs = video.parentNode;
  var current = null;

  // "is-live" means video works on this page and decides the per-place scrim;
  // "is-showing" means this clip has a frame to paint. Two classes, because
  // driving both from one made the scrim flinch on every click.
  function show(id) {
    if (id === current) return;
    current = id;
    bgs.classList.remove('is-showing');
    if (!id) { video.removeAttribute('src'); video.load(); return; }
    video.src = '/places/' + encodeURIComponent(id) + '.mp4';
    var started = video.play();
    if (started && started.catch) started.catch(function () { /* autoplay refused; the still stands */ });
  }

  video.addEventListener('playing', function () {
    bgs.classList.add('is-live');
    bgs.classList.add('is-showing');
  });
  video.addEventListener('error', function () {
    bgs.classList.remove('is-showing');
    bgs.classList.remove('is-live');
  });

  var SELECTOR = 'input[name="place"]:checked, input[name="lplace"]:checked';
  document.addEventListener('change', function (e) {
    if (e.target && (e.target.name === 'place' || e.target.name === 'lplace')) show(e.target.value);
  });
  var checked = document.querySelector(SELECTOR);
  if (checked) show(checked.value);
}());
`;
```

The doc comment above it keeps its reasoning and gains one paragraph: the showcase videos ride the same three gates as the loop, because they are the same decision.

- [ ] **Step 4: `landingPage()`.** Replace the whole function with:

```js
// inWords() is Task 3's, beside factCards(); only the capitaliser is new here.
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The landing (2026-09-06): the eight slots of the reference, filled with this
 * product's own content. The nav sits inside the lime hero, so layout() is
 * told not to draw the masthead. Every number on the page arrives in `pricing`
 * or `facts`; nothing is typed here except the sentence the product is about.
 *
 * THE SHOWCASE IS OPTIONAL AND THE PAGE IS COMPLETE WITHOUT IT. Each tape slot
 * takes a place photograph captioned with that place's own name when its file
 * is absent -- never the tape's caption, which would then be untrue -- and the
 * manifesto renders without stickers. That is the state every test runs in.
 */
export function landingPage({
  places = [], account = null, pricing = null, csrf = '',
  showcase = null, facts = {},
} = {}) {
  const first = places[0] ?? null;
  const second = places[1] ?? first;
  const third = places[2] ?? second;
  const { photoDays = RETENTION_DEFAULTS.photoDays, jobDays = RETENTION_DEFAULTS.jobDays, imageProcessor = null,
    qualities = [], shapes = [], frames = 375, fps = 25 } = facts;

  // The hoisted radios stay siblings of .wrap so the generated rules can
  // reach both the rail and the ground; the ground itself lives in the band.
  const hooks = places.map((p) => (
    `<input class="lstate" type="radio" name="lplace" id="${h(placeSlug(p.id))}" value="${h(p.id)}"${p.id === first?.id ? ' checked' : ''}>`
  )).join('\n');
  const layers = places.map((p) => `<div class="bg bg--${h(placeSlug(p.id))}"></div>`).join('\n');
  const rail = places.map((p, i) => `
      <li><label class="lopt lopt--${h(placeSlug(p.id))}" for="${h(placeSlug(p.id))}"><span class="lidx">${String(i + 1).padStart(2, '0')}</span>${h(p.label)}</label></li>`).join('');

  // A tape slot: the showcase file when present, a place photograph when not.
  const tapeSlot = (slot, kind, place) => {
    const figure = kind === 'hero' ? 'hero-tape' : 'demo-tape';
    if (slot) {
      return `<figure class="${figure}"><video class="tape-media tape-media--${kind}" muted playsinline loop preload="none" poster="${h(slot.poster)}" data-src="${h(slot.video)}"></video><figcaption class="tape-cap">${h(slot.caption)}</figcaption></figure>`;
    }
    if (!place) return '';
    return `<figure class="${figure}"><img class="tape-media tape-media--${kind}" src="/places/${h(place.id)}.jpg" alt="${h(place.label)}" loading="lazy" decoding="async"><figcaption class="tape-cap">${h(place.label)}</figcaption></figure>`;
  };
  const sticker = (i) => (showcase?.stickers?.[i]
    ? `<img class="sticker sticker--${i + 1}" src="${h(showcase.stickers[i])}" alt="" loading="lazy" decoding="async">`
    : '');

  const seconds = Math.round(frames / fps);
  const ticks = [1, 2, 3, 4, 5].map((k) => `00:${String(Math.round((k * seconds) / 5)).padStart(2, '0')}`);
  const free = pricing?.freeCredits
    ? `<p class="hero-fine">${h(`${pricing.freeCredits} free credits with a new account. One tape, no card.`)}</p>`
    : '';

  const body = `
<header class="lime hero">
  <nav class="hero-nav" aria-label="Primary">
    ${wordmark()}
    <div class="hero-links">
      <a href="#places">Places</a>
      <a href="/pricing">Pricing</a>
      <a href="/login" data-signin>Sign in</a>
    </div>
    <a class="navpill" href="/signup" data-signin>Make a tape</a>
  </nav>
  <div class="hero-body">
    <h1 class="hero-line">One photograph. Fifteen seconds of 2003.</h1>
    <p class="hero-sub">Upload one photo of your face, choose a place and an outfit, and get back a tape that looks like it was found in a drawer.</p>
    <a class="hero-cta" href="/signup" data-signin>Make a tape</a>
    ${free}
  </div>
  <div class="ruler" aria-hidden="true"><span>REC</span>${ticks.map((t) => `<span>${t}</span>`).join('')}</div>
</header>
${tapeSlot(showcase?.hero ?? null, 'hero', first)}

<section class="manifesto inner">
  <p class="manifesto-line"><span class="lit">You,</span> somewhere ${sticker(0)} <span class="lit">in 2003,</span> on a tape ${sticker(1)} that looks <span class="lit">found</span> ${sticker(2)} in a drawer. ${sticker(3)}</p>
</section>

<section class="how2 inner">
  <article class="card how-card">
    <h2 class="card-t">The grade</h2>
    <figure class="wipe">
      <img class="wipe-under" src="/landing/tape.jpg" alt="Times Square at night as a 2003 camcorder tape: softened, grain over everything, colour bleeding off the neon." width="1024" height="576" decoding="async">
      <div class="wipe-clip">
        <img src="/landing/photo.jpg" alt="Times Square at night, photographed sharp and clean." width="1024" height="576" decoding="async">
      </div>
      <div class="wipe-line" aria-hidden="true"><span class="wipe-grip"><svg viewBox="0 0 24 16" width="24" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3 4 8l5 5"></path><path d="M15 3l5 5-5 5"></path></svg></span></div>
      <figcaption class="wipe-cap"><span>Photograph</span><span>Tape</span></figcaption>
    </figure>
    <p class="card-d">It is not a filter. The picture is generated, then run through a real tape chain in ffmpeg: the grain goes on before the upscale, the date stamp degrades with the image, and the frame is matted the way a camcorder frame actually sat. Drag the line.</p>
  </article>
  <article class="card how-card">
    <h2 class="card-t">Your own place</h2>
    <div class="own-pair">${second ? `<img src="/places/${h(second.id)}.jpg" alt="${h(second.label)}" loading="lazy" decoding="async">` : ''}<img src="/landing/tape.jpg" alt="A place, as a tape frame." loading="lazy" decoding="async"></div>
    <p class="card-d">${places.length ? `${capital(inWords(places.length))} places are on the menu, and yours can be the next: ` : 'Your own place can be the one: '}upload a photograph of your garden, your kitchen or the street you grew up on, and the tape is set there.</p>
  </article>
</section>

<section class="band" id="places">
  <div class="bgs" aria-hidden="true">
${layers}
<video class="bgv" muted playsinline loop preload="none"></video>
  </div>
  <div class="scrim" aria-hidden="true"></div>
  <div class="inner band-in">
    <h2 class="band-t">${h(places.length ? `${capital(inWords(places.length))} places, or your own.` : 'Your own place.')}</h2>
    <ul class="lrail">${rail}
    </ul>
    <p class="band-hint">Pick one and the picture behind it changes. On the order form you can upload your own instead.</p>
  </div>
</section>

<div class="inner">
${factCards({ frames, fps, shapes, photoDays, jobDays })}
</div>

<section class="demo inner">
  <h2 class="demo-t">Any shape. Any place.</h2>
  <div class="demo-tapes">
    ${tapeSlot(showcase?.tall ?? null, 'tall', second)}
    ${tapeSlot(showcase?.fourThree ?? null, 'four', third)}
  </div>
  <a class="hero-cta demo-cta" href="/signup" data-signin>Make a tape</a>
  <p class="flip" aria-label="14 08 2003"><span>1</span><span>4</span><span class="gap"></span><span>0</span><span>8</span><span class="gap"></span><span>2</span><span>0</span><span>0</span><span>3</span></p>
</section>

<div class="inner">
${faq(faqItems({ freeCredits: pricing?.freeCredits ?? null, photoDays, jobDays, imageProcessor, qualities, shapes, sameInEveryShape: pricing?.sameInEveryShape ?? true }))}
</div>

  <dialog id="signin" class="signin" aria-labelledby="signin-t">
    ${/* the dialog markup, UNCHANGED from today's landingPage: the close button, the heading, the Google form, the "or", the password form, the two foot links -- copy it verbatim */''}
  </dialog>

<script>${BG_SCRIPT}</script>
<script>${SIGNIN_SCRIPT}</script>
<script>${WIPE_SCRIPT}</script>`;

  return layout({
    title: 'Timestamp — one photograph, fifteen seconds of 2003',
    body,
    preBody: hooks,
    bodyClass: 'page-landing',
    account,
    chrome: false,
    masthead: false,
  });
}
```

Copy today's `<dialog>` block verbatim into the slot (its rationale comments stay in interpolation slots). Move the old function's design-rationale comments that still apply (the wipe's, the dialog's) with it; delete the rest with the markup they explained.

- [ ] **Step 5: The server.** In `landingPricing()` return `{ fromCredits: cheapestTape, packUSD: pack.priceUSD, packCredits: pack.credits, freeCredits, sameInEveryShape }` where `freeCredits` is `(await auths.api()).PLANS?.free?.creditsPerPeriod ?? null` (inside the existing try) and `sameInEveryShape` is `offered.every((r) => new Set(Object.values(r.creditsByAspect ?? {})).size <= 1)`. Add beside it:

```js
  /** The product facts the public pages state, every one read from config or
   *  a seam. Task 6's pricing page reads the same object. */
  async function publicFacts() {
    let qualities = [];
    try { qualities = (await resolutionRows()).filter((r) => r.available).map((r) => r.id); } catch { qualities = []; }
    return {
      photoDays: cfg?.retention?.photoDays ?? RETENTION_DEFAULTS.photoDays,
      jobDays: cfg?.retention?.jobDays ?? RETENTION_DEFAULTS.jobDays,
      imageProcessor,
      qualities,
      shapes: aspectRows().filter((a) => a.available !== false).map((a) => a.id),
      frames: Math.round((cfg?.durationSeconds ?? 15) * (cfg?.fps ?? 25)),
      fps: cfg?.fps ?? 25,
    };
  }
```

(import `RETENTION_DEFAULTS` from `../safety/consent.mjs`; check how `aspectRows()` shapes its rows at line ~1673 and adjust the `available` test to its field). In the signed-out branch of `homePage`, pass `showcase: showcaseFor(), facts: await publicFacts()` beside `pricing`. In `presetCss`, change the two rules that reach the ground so they pass through `.wrap`:

```js
`#${slug}:checked~.wrap .bgs .bg--${slug}{opacity:1;}`,
// …
`#${slug}:checked~.wrap .bgs.is-live~.scrim{opacity:${scrimOpacity(LOOP_LUMA[place.id].yavg)};}`,
```

and delete the `losd` rule (`#${slug}:checked~.wrap .losd--${slug}{opacity:1;}`).

- [ ] **Step 6: The stylesheet.** In `scripts/web/static.mjs` replace everything from `/* --- the landing page: STRUCK --- */` to just before `/* --- the world's primitives --- */` with the block below. Rules that die with their markup: `.strike`, `.lmenu`, `.strike-hint`, `.losds`, `.losd`, `.hero-do`, `.plain*`, `.plain-price*`, `.how`, `.how-lead*`, `.how-rest`, `.how-t*`, `.how-d`, `.show`, `.show-t`, the `.page-landing .how > div, .page-landing .plain` plate, the `.page-landing .cta*` rules, the `.page-landing .nav` rules, `.page-landing .masthead`, the landing halves of the `.page-landing .foot`/`.bg`/`.scrim` rules (the `.has-ground` halves stay), the `@media (max-width: 60rem)` blocks for `.strike` and `.how`. The `.wipe*` rules stay exactly as Task 2 left them; `.lstate`, `.lrail`, `.lrail li`, `.lrail .lopt`, `.lopt`, `.lopt .lidx`, `.lopt:hover` stay.

```css
/* --- the landing (2026-09-06): the lime poster, the tape first ------------ */

/* The page owns its own gutters: the hero is a panel with a margin, the band
   runs edge to edge, and everything else sits in a 76rem column. No 100vw
   anywhere -- a viewport unit includes the scrollbar and is how a full-bleed
   band buys a horizontal scrollbar. */
body.page-landing { padding: 0 0 var(--s-8); }
.page-landing .wrap { max-width: none; }
.page-landing .inner { max-width: 76rem; margin: 0 auto; padding: 0 1.15rem; }
.page-landing .foot { max-width: 76rem; margin: var(--s-8) auto 0; padding: 0 1.15rem; }

/* THE HERO. A lime panel with room at the foot for the tape to break out of. */
.hero { margin: var(--s-4) var(--s-4) 0; padding: 0 0 12rem; }
.hero-nav { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); flex-wrap: wrap; padding: var(--s-5) var(--s-6) 0; }
.hero-nav .wordmark { color: var(--on-lime); }
.hero-links { display: flex; gap: var(--s-5); }
.hero-links a { font-size: var(--t-label); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-lime); text-decoration: none; }
.hero-links a:hover { text-decoration: underline; text-underline-offset: 4px; }
.navpill, .hero-cta { display: inline-block; font-family: var(--display); text-transform: uppercase; letter-spacing: 0.02em; background: var(--on-lime); color: var(--lime); border-radius: var(--r-btn); text-decoration: none; }
.navpill { font-size: var(--d-2); padding: 0.5rem 0.9rem; }
.hero-cta { font-size: var(--d-2); padding: 0.8rem 1.6rem; }
.navpill:hover, .hero-cta:hover { color: var(--lime-hover); }
.hero-body { text-align: center; max-width: 48rem; margin: 0 auto; padding: var(--s-8) var(--s-5) var(--s-6); }
/* The one --t-hero on the site. Task 2's rule moves here with its colour
   changed: the hero sits on lime now. */
.hero-line { font-family: var(--display); font-size: var(--t-hero); line-height: 0.9; letter-spacing: 0; text-transform: uppercase; font-weight: 400; color: var(--on-lime); margin: 0 auto var(--s-5); max-inline-size: 12ch; text-wrap: balance; }
.hero-sub { color: var(--on-lime-soft); font-size: var(--t-3); line-height: 1.5; max-width: 46ch; margin: 0 auto var(--s-5); }
.hero-fine { font-size: var(--t-1); color: var(--on-lime-soft); margin: var(--s-3) 0 0; }
/* THE COUNTER RULER: tick marks along the panel's foot, the readout in the
   label role. A repeating gradient is a fill, not a border. */
.ruler { display: flex; justify-content: space-between; align-items: flex-end; height: 1.75rem; margin-top: var(--s-6); padding: 0 var(--s-6); font-size: var(--t-label); font-weight: 600; letter-spacing: 0.08em; color: var(--on-lime-soft); background-image: repeating-linear-gradient(to right, var(--on-lime) 0 1px, transparent 1px 12px); background-size: 100% 8px; background-repeat: no-repeat; background-position: 0 100%; }
.ruler span { background: var(--lime); padding: 0 3px; }
/* THE TAPE BREAKS OUT OF THE PANEL onto the dark ground -- the reference's
   move, and what makes the tape the largest thing on the first screen. */
.hero-tape { position: relative; z-index: 2; width: 82%; max-width: 76rem; margin: -10rem auto 0; }
.tape-media { display: block; width: 100%; aspect-ratio: 16 / 9; background: var(--card); border-radius: 8px; object-fit: cover; }
.tape-media--tall { aspect-ratio: 9 / 16; }
.tape-media--four { aspect-ratio: 4 / 3; }
.tape-cap { font-size: var(--t-label); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft); margin: var(--s-3) 0 0; }
.hero-tape .tape-cap, .demo-tape .tape-cap { text-align: left; }
@media (max-width: 48rem) {
  .hero { margin: var(--s-3) var(--s-3) 0; padding-bottom: 5rem; }
  .hero-nav { padding: var(--s-4) var(--s-4) 0; }
  .hero-links { order: 3; width: 100%; }
  .hero-body { padding: var(--s-7) var(--s-3) var(--s-5); }
  .hero-tape { width: calc(100% - 2.3rem); margin-top: -3.5rem; }
}

/* THE MANIFESTO: the giant sentence, lime and ink alternating by phrase, the
   stickers inline and tilted. */
.manifesto { padding: var(--s-8) 1.15rem; text-align: center; }
.manifesto-line { font-family: var(--display); text-transform: uppercase; font-size: var(--t-8); line-height: 1.05; letter-spacing: 0; margin: 0; color: var(--ink); text-wrap: balance; }
.manifesto-line .lit { color: var(--lime); }
.sticker { display: inline-block; height: 1em; width: auto; vertical-align: -0.15em; border-radius: 4px; margin: 0 0.1em; transform: rotate(-4deg); }
.sticker--2 { transform: rotate(3deg); }
.sticker--3 { transform: rotate(-2deg); }
.sticker--4 { transform: rotate(5deg); }

/* THE TWO CARDS. */
.how2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-5); padding-bottom: var(--s-8); }
.how-card { padding: var(--s-5); }
.card-t { font-family: var(--display); text-transform: uppercase; font-size: var(--d-3); line-height: 0.92; letter-spacing: 0; font-weight: 400; margin: 0 0 var(--s-4); color: var(--ink); }
.card-d { color: var(--ink-soft); margin: var(--s-4) 0 0; max-width: 46ch; }
.own-pair { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-2); }
.own-pair img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; }
@media (max-width: 48rem) { .how2 { grid-template-columns: 1fr; } }

/* THE BAND: the place photograph across the whole width, the rail over it.
   The ground and the scrim are positioned inside the band rather than fixed
   to the viewport, which is the only change to a mechanism that is otherwise
   the 2026-08-27 landing's: the same hoisted radios, the same generated
   layers, the same script swapping the loop, the same per-place scrim. */
.band { position: relative; overflow: hidden; padding: var(--s-8) 0; color: var(--on-image); }
.band .bgs { position: absolute; inset: 0; z-index: 0; }
.band .bg { position: absolute; inset: -6%; filter: blur(10px) saturate(0.8); }
.band .scrim { position: absolute; inset: 0; z-index: 1; opacity: 0.5; }
.band-in { position: relative; z-index: 2; }
.band-t { font-family: var(--display); text-transform: uppercase; font-size: var(--d-4); line-height: 0.92; letter-spacing: 0; font-weight: 400; margin: 0 0 var(--s-5); color: var(--on-image); text-shadow: 0 1px 14px rgba(22, 22, 24, 0.7); }
.band .lopt { color: var(--on-image); text-shadow: 0 1px 14px rgba(22, 22, 24, 0.7); }
.band .lopt .lidx { color: var(--on-image); }
.band-hint { font-size: var(--t-1); color: var(--on-image-soft); margin: var(--s-3) 0 0; text-shadow: 0 1px 10px rgba(22, 22, 24, 0.85); }

/* THE FACTS: three cards; Task 3 owns .fact. */
.facts3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-5); padding: var(--s-8) 0; }
@media (max-width: 48rem) { .facts3 { grid-template-columns: 1fr; } }

/* THE DEMO: the two other shapes standing on the ground, the button, and the
   flip counter in the tape's own readout face -- one of the three places it
   is allowed in the chrome. Static digits; nothing animates. */
.demo { text-align: center; padding: 0 1.15rem var(--s-8); }
.demo-t { font-family: var(--display); text-transform: uppercase; font-size: var(--t-8); line-height: 0.92; letter-spacing: 0; font-weight: 400; margin: 0 0 var(--s-6); color: var(--ink); }
.demo-tapes { display: grid; grid-template-columns: minmax(0, 9fr) minmax(0, 16fr); gap: var(--s-5); align-items: end; max-width: 56rem; margin: 0 auto var(--s-6); text-align: left; }
.demo-tape { margin: 0; }
.demo-cta { margin: 0 auto; }
.flip { display: inline-flex; gap: 0.3em; font-family: var(--osd); font-size: var(--t-8); color: var(--ink); margin: var(--s-6) auto 0; letter-spacing: 0.04em; }
.flip span { display: inline-block; background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 0.1em 0.3em; min-width: 1.1em; line-height: 1.1; }
.flip .gap { background: none; border: 0; min-width: 0.3em; padding: 0; }
@media (max-width: 48rem) { .demo-tapes { grid-template-columns: 1fr; } }
```

Parse check. Run `test/web-static.test.js`, `test/web-api.test.js`, `test/web-auth.test.js`: expected green.

- [ ] **Step 7: The browser tests.** In `test/browser-smoke.test.js`:
  - In `session()`, before `createServer`: build a showcase dir from the fixtures and pass it —

```js
  const showcase = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-showcase-'));
  fs.copyFileSync(new URL('./fixtures/showcase/tiny.mp4', import.meta.url), path.join(showcase, 'hero-16x9.mp4'));
  fs.copyFileSync(new URL('./fixtures/showcase/tiny.jpg', import.meta.url), path.join(showcase, 'hero-16x9.jpg'));
  // … createServer({ …, showcaseDir: showcase })
```
  and remove the directory in `test.after`.
  - Replace `the landing page fits a phone and a laptop with nothing off screen` with the six-width version:

```js
test('the landing fits every one of the six widths with nothing off screen', { skip }, async () => {
  const s = await session();
  await s.signOut();
  for (const width of [320, 375, 414, 768, 1024, 1440]) {
    const page = await visit('/', { width, height: 900, mobile: width < 768 });
    assert.deepEqual(page.errors, [], `at ${width}px: ${page.errors.join('; ')}`);
    assert.ok(page.layout.overflowX <= 0, `the landing scrolls sideways by ${page.layout.overflowX}px at ${width}px`);
    assert.ok(page.layout.title.length > 0);
  }
});
```
  - Add:

```js
test('the hero tape plays muted once the page has loaded, when a showcase file is present', { skip }, async () => {
  const s = await session();
  await s.signOut();
  const page = await visit('/', LAPTOP, { settleMs: 1500 });
  assert.deepEqual(page.errors, [], page.errors.join('; '));
  const r = await page.evaluate(`(() => {
    const v = document.querySelector('video.tape-media--hero');
    if (!v) return { missing: true };
    return { muted: v.muted, loop: v.loop, src: v.currentSrc, paused: v.paused, ready: v.readyState };
  })()`);
  assert.ok(!r.missing, 'no hero video: the shared session mounts a showcase, so a fallback image here is a defect');
  assert.ok(r.muted && r.loop, 'the hero must be muted and looping');
  assert.match(r.src, /\/showcase\/hero-16x9\.mp4$/, `the hero is playing ${r.src}`);
  assert.ok(r.ready >= 2, `the hero never decoded a frame (readyState ${r.ready})`);
  assert.equal(r.paused, false, 'the hero is not playing');
});

test('a FAQ row opens on click and on Enter', { skip }, async () => {
  const s = await session();
  await s.signOut();
  const page = await visit('/', LAPTOP);
  const clicks = await page.evaluate(`(() => {
    const d = document.querySelector('details.faq-row');
    const sum = d.querySelector('summary');
    const before = d.open; sum.click(); const afterClick = d.open; sum.click();
    return { before, afterClick, closedAgain: !d.open };
  })()`);
  assert.deepEqual(clicks, { before: false, afterClick: true, closedAgain: true });
  await page.evaluate(`document.querySelector('details.faq-row summary').focus()`);
  await s.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await s.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.equal(await page.evaluate(`document.querySelector('details.faq-row').open`), true, 'Enter on a focused summary does not open the row');
});
```

Run `node --test test/browser-smoke.test.js`: expected green, including the untouched wipe and dialog tests (the wipe is inside a card now; the dialog is unchanged).

- [ ] **Step 8: Full suite, sabotage, commit.** Sabotages: (a) put `src` instead of `data-src` on the hero video → the markup test names the tag; (b) leave `~.bgs .bg--` in `presetCss` (the old selector) → the rail test fails on the generated rule AND the band's picture stops changing in the browser (check it by eye once); (c) make `tapeSlot` caption the fallback with `slot?.caption ?? place.label` and pass a caption through — the fallback test fails on `Baltic beach`; (d) delete the `.hero-tape` width rule → the six-width test does not fail (it is a design value), which is why the owner looks at it in Step 9. Restore each from its copy.

```bash
npm test > build/suite.log 2>&1; echo "exit $?"; tail -12 build/suite.log
git add scripts/web/views.mjs scripts/web/static.mjs scripts/web/server.mjs test/web-static.test.js test/web-auth.test.js test/browser-smoke.test.js
git commit -F build/commitmsg.txt
```

Message: `landing: the lime poster -- the tape first, the manifesto, two cards, the place band, three facts, the demo, six questions`, naming the three landing tests deleted and the five that replace them.

- [ ] **Step 9: STOP. Show the owner, and ask four things.** Start the dev server (`preview_start` `web`), make sure `TIMESTAMP_SHOWCASE_DIR` in the local `.env` points at `build/showcase` so the hero plays, open `/` at 375 and 1440, screenshot both, and send them with:

1. **The page.** Does the hero read as the reference? Does the lime read right under the speckle (spec §11: if it reads wrong, name a hex and it is re-measured)?
2. **The FAQ copy**, pasted verbatim (the six answers from `faqItems`, rendered with the real numbers). One read; he says what changes.
3. **The stickers.** Propose, with the commands ready: sticker 1 from the hero at 12.0 s (facing the lens), sticker 2 from the 4:3 space-centre tape at 3.0 s, sticker 3 from the 9:16 Times Square tape at 7.0 s, sticker 4 the burnt-in date cropped from the hero's last second (`--crop=stamp --at=14.5`). Only the hero can be produced on this machine; the other two run on the box (runbook §1 step 5). He picks the frames.
4. **Anything else on the page**, before pricing starts.

Do not start Task 6 until he answers. Apply his answers as small test-first follow-ups on the same branch (a copy change is a test change and a view change, one commit).

---
### Task 6: The pricing page — credits, not subscriptions; three cards; 480p against 720p (STOPS FOR THE OWNER TO LOOK)

**Files:**
- Modify: `scripts/web/views-auth.mjs` (`pricingPage()` rewritten), `scripts/web/static.mjs` (the pricing section rewritten), `scripts/web/server.mjs` (`publicFacts()` gains `deliveryShortEdge` and `lufs`; the pricing route passes `facts`)
- Test: `test/web-static.test.js` (the three pack tests rewritten; one rung test's summary assertion re-pointed; two new tests), `test/web-auth.test.js` (the pricing-page test rewritten), `test/web-billing.test.js` and `test/web-legal.test.js` (run; their contracts are kept)

**Interfaces:**
- Consumes: `faq`, `faqItems`, `balanceSentence`, `siteFooter` (Task 3); `publicFacts()` (Task 5); `.lime`, `.card` and the tokens.
- Produces: `pricingPage({ plans, resolutions, packs, currentPlan, account, balance, checkout, retentionDays, facts })`; the markup contracts the money tests already pin are unchanged: the buy form carries exactly `pack` (hidden) and `withdrawal` (required checkbox), the button says `Buy <label>` or `Not open yet` disabled with the `Nothing is charged here.` hint, every paid card says `Tax is added at checkout.`, and the foot paragraph says VAT or sales tax is added at checkout.

- [ ] **Step 1: The tests (RED).** In `test/web-static.test.js` delete `a pack states its price in the display face with the credit count directly beneath it` (Task 2's interim version; its three properties -- figure in the display face, credits beneath, tax on every paid card -- are asserted again below against the new markup), and replace `the two packs stand side by side, and the larger one is lifted and recommended` and `the free grant opens the page as a sentence, not as a third card with no button` with:

```js
test('the pricing page is three cards -- Free with a sign-up action, Starter, and Standard lifted, lime and recommended', () => {
  const html = pricingPage(LADDER);
  const { css } = createStylesheet({});
  const cards = html.match(/<section class="(?:card|lime) tier[^"]*"/g) ?? [];
  assert.equal(cards.length, 3, `three cards, found ${cards.length}: ${cards.join(' ')}`);
  assert.match(cards[0], /tier--free/, 'Free leads');
  assert.match(cards[1], /class="card tier tier--paid"/, 'Starter is a dark card');
  assert.match(cards[2], /class="lime tier tier--paid tier--lime"/, 'Standard is the lime card');

  const between = (a, b) => html.slice(html.indexOf(a), b ? html.indexOf(b) : undefined);
  const free = between('tier--free', 'tier--paid');
  assert.match(free, /<p class="price">21 credits<\/p>\s*<p class="per">when you sign up<\/p>/, 'the free figure is the credit count');
  assert.match(free, /<li>1 tape at 480p \(none in 16:9 or 9:16\)<\/li><li>any shape<\/li><li>no card<\/li>/, 'the free checks');
  assert.match(free, /<a class="record" href="\/signup">Start free<\/a>/, 'signed out, Free carries the sign-up action');

  const standard = between('tier--lime');
  assert.match(standard, /Standard/); assert.match(standard, /Recommended/, 'and it says so in words');
  assert.match(standard, /<p class="price">\$19<\/p>\s*<p class="per">138 credits<\/p>/, 'price first, credits beneath');
  assert.match(standard, /<li>6 tapes at 480p \(4 in 16:9 or 9:16\), or 3 tapes at 720p \(2 in 16:9 or 9:16\)<\/li><li>any shape<\/li><li>yours to download and keep<\/li><li>photograph deleted after 7 days<\/li>/);

  assert.match(css, /\.tiers\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, 'three equal columns');
  assert.match(css, /\.tier--lime\s*\{[^}]*transform:\s*translateY\(/, 'the recommended card is not lifted');
  assert.match(css, /\.tier \.price\s*\{[^}]*font-family:\s*var\(--display\)/, 'the figure is not in the display face');
  assert.doesNotMatch(css, /\.tier \.per\s*\{[^}]*var\(--(display|osd)\)/, 'the credit count is the label beneath the figure');
  // Tax sits beside each button, where the decision is made.
  for (const paid of html.split('tier--paid').slice(1)) assert.match(paid, /Tax is added at checkout\./, 'a paid card does not say tax is added');
  // The acknowledgement stays, word for word, on every paid form.
  assert.equal((html.match(/name="withdrawal"/g) ?? []).length, 2, 'every paid form carries the acknowledgement');

  // Signed in: the Free card is absent, the band carries the balance in tapes.
  const mine = pricingPage({ ...LADDER, account: { email: 'a@b.com' }, balance: { credits: 43 } });
  assert.equal((mine.match(/<section class="(?:card|lime) tier[^"]*"/g) ?? []).length, 2, 'signed in, the Free card is absent');
  assert.doesNotMatch(mine, /tier--free|Start free/);
  assert.match(mine, /class="tiers tiers--two"/, 'two cards share a two-column row');
  assert.match(mine, /<p class="balance">43 credits left\. Enough for 2 more tapes at 480p\.<\/p>/, 'the band does not carry the balance in tapes');
  assert.doesNotMatch(html, /credits left/, 'a stranger is told a balance');
});

test('the comparison has exactly two quality columns, its numbers come from the seam, and the recommended column is lit', () => {
  const facts = { frames: 375, fps: 25, shapes: ['4:3', '16:9', '9:16'], lufs: -27, deliveryShortEdge: 1080, photoDays: 7, jobDays: 30, qualities: ['480p', '720p'] };
  const html = pricingPage({ ...LADDER, facts });
  const q = /<table class="compare-q">([\s\S]*?)<\/table>/.exec(html);
  assert.ok(q, 'no quality comparison table');
  assert.equal((q[1].match(/<th scope="col"/g) ?? []).length, 2, 'exactly two quality columns');
  assert.match(q[1], /<th scope="col">480p<\/th>\s*<th scope="col" class="lit">720p<\/th>/, 'the second quality is the recommended column');
  assert.match(q[1], /<th scope="row">Credits per tape<\/th>\s*<td>21<\/td>\s*<td class="lit">46<\/td>/);
  assert.match(q[1], /<th scope="row">Source detail<\/th>\s*<td>480 lines<\/td>\s*<td class="lit">720 lines<\/td>/);
  assert.match(q[1], /<th scope="row">Delivered file<\/th>\s*<td>1080 lines/, 'the delivered file is stated from config');
  assert.match(q[1], /<th scope="row">The grain<\/th>\s*<td>identical, by design<\/td>\s*<td class="lit">identical, by design<\/td>/);
  assert.match(q[1], /<th scope="row">What a pack buys<\/th>\s*<td>Starter: 4 tapes · Standard: 6 tapes<\/td>\s*<td class="lit">Starter: 2 tapes · Standard: 3 tapes<\/td>/);
  assert.ok(!/1112|752x|960x720|640x480|1280x720/.test(html), 'a raster the model is ordered at, or delivers, must not be printed');
  const f = /<table class="compare-f">([\s\S]*?)<\/table>/.exec(html);
  assert.ok(f, 'no "what comes back" table');
  assert.match(f[1], /<th scope="row">Length<\/th>\s*<td>Fifteen seconds exactly, 375 frames<\/td>/);
  assert.match(f[1], /<th scope="row">Shapes<\/th>\s*<td>Three: 4:3, 16:9 and 9:16<\/td>/);
  assert.match(f[1], /<th scope="row">Sound<\/th>\s*<td>A mono tape bed at -27 LUFS<\/td>/);
  assert.match(f[1], /<th scope="row">Disclosure<\/th>\s*<td>Marked AI-generated in the file/);
  // The lime band opens the page and the FAQ closes it.
  assert.match(html, /<section class="lime pricing-hero">\s*<h1 class="pricing-t">Credits, not subscriptions\.<\/h1>/);
  assert.equal((html.match(/<details class="faq-row">/g) ?? []).length, 6, 'the same six questions as the landing');
});
```

In `a rung says nothing about shape when every shape costs the same`, replace the two summary-line assertions (`480p — ~21 CR` and `~21-21 CR`) with `assert.match(html, /<th scope="row">Credits per tape<\/th>\s*<td>21<\/td>\s*<td class="lit">46<\/td>/, 'the comparison row does not quote the price');`. The other two rung tests (`counts tapes in every shape it sells`, `no per-shape prices states the plain count`) match substrings the new checks still print; leave them.

In `test/web-auth.test.js`, rewrite the assertions of the pricing test at ~line 1355 to the new page (the fixture PLANS in that file ship two priced plans, which render as plan cards after the packs; keep `plan--current`):

```js
    for (const label of ['Shelf', 'Archive']) assert.ok(anonHtml.includes(label), `${label} is missing`);
    assert.match(anonHtml, /<p class="price">51 credits<\/p>\s*<p class="per">when you sign up<\/p>/, 'the free grant is the first card');
    assert.ok(anonHtml.includes('$10') && anonHtml.includes('$12'));
    assert.ok(!anonHtml.includes('Your plan'), 'nothing is marked for a signed-out visitor');
    assert.ok(anonHtml.includes('153 credits'));
    assert.ok(!/credits a month/.test(anonHtml) && !/per month/.test(anonHtml), 'nothing on this page may claim to recur');
    assert.ok(anonHtml.includes('3 tapes at 480p'), 'shelf is three 480p tapes');
    assert.ok(anonHtml.includes('1 tape at 720p'), 'and one 720p tape, singular');
    assert.ok(!anonHtml.includes('1 tapes'), 'and nothing reads like a placeholder');
    assert.match(anonHtml, /<th scope="row">Credits per tape<\/th>\s*<td>51<\/td>\s*<td class="lit">152<\/td>/, 'the comparison quotes the two qualities');
    assert.ok(!anonHtml.includes('1080p'), 'a deferred size is not priced on the plans page');
    const mine = await (await fetch(`${base}/pricing`, { headers: { cookie } })).text();
    assert.ok(mine.includes('Your plan'));
    assert.ok(/plan--current[\s\S]{0,300}Shelf/.test(mine), 'the Shelf plan is the one marked');
```

(The old `not enough for a 720p tape` assertion goes: the Free card states what the grant buys, and the 720p price is on the comparison row.) Run the two files: expected FAIL on the rewritten tests.

- [ ] **Step 2: `pricingPage()`.** Replace the function in `scripts/web/views-auth.mjs` (imports: add `faq, faqItems, balanceSentence, inWords` from `./views.mjs`; keep `tapeCounts` and `tapeLines` exactly as they are today, comments included):

```js
export function pricingPage({
  plans = [], resolutions = [], packs = [], currentPlan = null, account = null,
  balance = null, checkout = null, retentionDays = null, facts = {},
} = {}) {
  const offered = resolutions.filter((r) => r.available && r.credits > 0);
  const { photoDays = 7, jobDays = retentionDays ?? 30, imageProcessor = null, qualities = offered.map((r) => r.id),
    shapes = [], frames = 375, fps = 25, lufs = null, deliveryShortEdge = null } = facts;

  const tapeCounts = (credits) => offered.map((r) => { /* unchanged from today */ });
  const tapeLines = (credits) => tapeCounts(credits).map((t) => `<li>${h(t)}</li>`).join('');
  // What a pool buys, as ONE check-mark: "4 tapes at 480p, or 2 tapes at 720p".
  // A quality the pool cannot fund is left out of the line rather than stated
  // as a negative on a card whose job is to say what you get.
  const buysLine = (credits) => {
    const counts = tapeCounts(credits).filter((t) => !/^not enough/.test(t));
    return counts.length ? counts.join(', or ') : 'not enough for a tape';
  };

  const cheapest = offered.length ? offered.reduce((a, b) => (a.credits <= b.credits ? a : b)) : null;
  const grants = plans.filter((plan) => plan.monthlyUSD === 0);
  const tiers = plans.filter((plan) => plan.monthlyUSD !== 0);
  const free = grants[0] ?? null;
  const most = packs.length > 1 ? Math.max(...packs.map((pack) => pack.credits)) : null;

  const checks = (items) => `<ul class="checks">${items.map((c) => `<li>${h(c)}</li>`).join('')}</ul>`;
  const buyForm = (pack, recommended) => `
      <form method="post" action="/api/billing/checkout">
        <input type="hidden" name="pack" value="${h(pack.id)}">
        <label class="check check--buy">
          <input type="checkbox" name="withdrawal" value="yes" required>
          <span class="consent-text"><span>I want my credits straight away. I understand they are
          added to my account the moment I pay, and that I cannot then cancel them for a
          refund.</span></span>
        </label>
        <button type="submit" class="record${recommended ? '' : ' record--way'}"${pack.buyable ? '' : ' disabled'}>
          ${h(pack.buyable ? `Buy ${pack.label}` : 'Not open yet')}
        </button>
      </form>
      ${pack.buyable ? '' : '<p class="hint">Checkout opens once the price is set. Nothing is charged here.</p>'}
      <p class="hint">Tax is added at checkout.</p>`;

  const freeCard = free && !account ? `
    <section class="card tier tier--free">
      <p class="tier-name">${h(free.label)}</p>
      <p class="price">${h(`${free.creditsPerPeriod} credits`)}</p>
      <p class="per">when you sign up</p>
      ${checks([buysLine(free.creditsPerPeriod), 'any shape', 'no card'])}
      <a class="record" href="/signup">Start free</a>
    </section>` : '';

  const packCards = packs.map((pack) => {
    const recommended = most !== null && pack.credits === most;
    return `
    <section class="${recommended ? 'lime' : 'card'} tier tier--paid${recommended ? ' tier--lime' : ''}">
      <p class="tier-name">${h(pack.label)}${recommended ? ' <span class="mark">Recommended</span>' : ''}</p>
      <p class="price">${h(`$${pack.priceUSD}`)}</p>
      <p class="per">${h(`${pack.credits} credits`)}</p>
      ${checks([buysLine(pack.credits), 'any shape', 'yours to download and keep', `photograph deleted after ${photoDays} days`])}
      ${buyForm(pack, recommended)}
    </section>`;
  }).join('');

  // Priced plans exist only in test fixtures today (the shipped config has one
  // grant and no paid plan); they keep the struck/ghost grammar for whoever
  // turns subscriptions back on.
  const planCards = tiers.map((plan) => {
    const current = plan.id === currentPlan;
    return `
    <section class="card tier plan${current ? ' plan--current' : ''}">
      ${current ? '<span class="mark">Your plan</span>' : ''}
      <p class="tier-name">${h(plan.label)}</p>
      <p class="price">${h(`$${plan.monthlyUSD}`)}</p>
      <p class="per">on sign-up</p>
      <ul class="checks"><li>${h(`${plan.creditsPerPeriod} credits`)}</li>${tapeLines(plan.creditsPerPeriod)}</ul>
    </section>`;
  }).join('');

  const columns = (freeCard ? 1 : 0) + packs.length;
  const balanceLine = account && balance ? balanceSentence({ credits: Number(balance.credits), cheapest }) : '';
  const RETURNED = Object.freeze({
    done: 'Thank you. Your credits will appear on your balance shortly, once the payment clears.',
    cancelled: 'Nothing was charged. The bundle is still here whenever you want it.',
  });
  const key = String(checkout ?? '');
  const returned = Object.hasOwn(RETURNED, key) ? RETURNED[key] : null;

  // 480p against 720p: one product, two qualities. Source detail is the
  // label's own number and never the raster the model is ordered at -- the
  // supplier does not always deliver what is ordered, and a printed raster
  // invites "that is not what I got".
  const lines = (r) => `${parseInt(r.id, 10)} lines`;
  const packBuys = (r) => packs.map((p) => { const n = Math.floor(p.credits / (r.creditsByAspect?.['4:3'] ?? r.credits)); return `${p.label}: ${n} ${n === 1 ? 'tape' : 'tapes'}`; }).join(' · ');
  const cell = (r, i, inner) => (i === 1 ? `<td class="lit">${inner}</td>` : `<td>${inner}</td>`);
  const row = (head, f) => `<tr><th scope="row">${h(head)}</th>${offered.slice(0, 2).map((r, i) => cell(r, i, h(f(r)))).join('')}</tr>`;
  const delivered = deliveryShortEdge ? `${deliveryShortEdge} lines; edge to edge in the wide shapes, matted in 4:3` : 'edge to edge in the wide shapes, matted in 4:3';
  const compareQ = offered.length >= 2 ? `
  <section class="compare">
    <h2 class="compare-t">480p against 720p</h2>
    <div class="compare-scroll"><table class="compare-q">
      <thead><tr><th scope="row" class="blank"></th>${offered.slice(0, 2).map((r, i) => (i === 1 ? `<th scope="col" class="lit">${h(r.id)}</th>` : `<th scope="col">${h(r.id)}</th>`)).join('')}</tr></thead>
      <tbody>
        ${row('Credits per tape', (r) => String(r.creditsByAspect?.['4:3'] ?? r.credits))}
        ${row('Source detail', lines)}
        ${row('Delivered file', () => delivered)}
        ${row('The grain', () => 'identical, by design')}
        ${packs.length ? row('What a pack buys', packBuys) : ''}
      </tbody>
    </table></div>
  </section>` : '';

  const compareF = `
  <section class="compare">
    <h2 class="compare-t">What comes back</h2>
    <div class="compare-scroll"><table class="compare-f"><tbody>
      <tr><th scope="row">Length</th><td>${h(`${inWords(Math.round(frames / fps)).replace(/^./, (c) => c.toUpperCase())} seconds exactly, ${frames} frames`)}</td></tr>
      ${shapes.length ? `<tr><th scope="row">Shapes</th><td>${h(`${inWords(shapes.length).replace(/^./, (c) => c.toUpperCase())}: ${shapes.slice(0, -1).join(', ')} and ${shapes[shapes.length - 1]}`)}</td></tr>` : ''}
      ${Number.isFinite(lufs) ? `<tr><th scope="row">Sound</th><td>${h(`A mono tape bed at ${lufs} LUFS`)}</td></tr>` : ''}
      <tr><th scope="row">Disclosure</th><td>Marked AI-generated in the file, in machine-readable metadata.</td></tr>
    </tbody></table></div>
  </section>`;

  const body = `
<main class="pricing">
  <section class="lime pricing-hero">
    <h1 class="pricing-t">Credits, not subscriptions.</h1>
    <p class="lede">A tape costs credits, credits come in packs, and tax is added at checkout.</p>
    ${balanceLine ? `<p class="balance">${h(balanceLine)}</p>` : ''}
    ${returned ? `<p class="notice">${h(returned)}</p>` : ''}
  </section>

  <div class="tiers${columns === 2 ? ' tiers--two' : ''}">${freeCard}${packCards}${planCards}</div>

  ${compareQ}
  ${compareF}

  ${faq(faqItems({ freeCredits: free?.creditsPerPeriod ?? null, photoDays, jobDays, imageProcessor, qualities, shapes, sameInEveryShape: offered.every((r) => new Set(Object.values(r.creditsByAspect ?? {})).size <= 1) }))}

  <section class="pricing-foot">
    <p class="hint">Prices are before tax. VAT or sales tax is added at checkout where it
    applies, at the rate for the country you are in, and the total is shown to you before
    you pay.</p>
    <p class="hint">There is no payment form here and there is not one anywhere else either.
    Checkout is hosted by the payment provider on their own domain, and this application
    never sees a card number.</p>
    <p class="hint">Nothing here renews and nothing is a subscription. When you want more
    tapes you buy another bundle, including a second one the same size.</p>
  </section>
</main>
`;
  return layout({ title: 'Timestamp - pricing', body, bodyClass: 'page-pricing', account, balance });
}
```

Keep the function's existing header comment (the one-ladder history) and add a paragraph dated 2026-09-06: three cards, the free rung a card when signed out and absent when signed in, the comparison of qualities. In `server.mjs` the pricing route passes `facts: await publicFacts()`, and `publicFacts()` gains `deliveryShortEdge: Math.min(cfg?.delivery?.width ?? 1080, cfg?.delivery?.height ?? 1920)` and `lufs: TARGET_LUFS`, where at module scope:

```js
// The bed's loudness target, read from the look config so the pricing page
// states the number the renderer asserts rather than a typed one.
const TARGET_LUFS = (function find(o) {
  if (!o || typeof o !== 'object') return null;
  if (Number.isFinite(o.targetLufs)) return o.targetLufs;
  for (const v of Object.values(o)) { const r = find(v); if (r !== null) return r; }
  return null;
}(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'look', 'base.json'), 'utf8'))));
```

- [ ] **Step 3: The stylesheet.** Replace the pricing section of `static.mjs` (from `/* --- pricing --- */` through the `.plan .mark { … }` rule) with:

```css
/* --- pricing (2026-09-06): the lime band, three cards, the comparison ---- */

.pricing-hero { padding: var(--s-7) var(--s-6); text-align: center; margin: 0 0 var(--s-7); }
.pricing-t { font-family: var(--display); text-transform: uppercase; font-size: var(--t-8); line-height: 0.9; letter-spacing: 0; font-weight: 400; margin: 0 0 var(--s-4); color: var(--on-lime); }
.pricing-hero .lede { color: var(--on-lime-soft); max-width: 46ch; margin: 0 auto; }
.pricing-hero .balance { font-weight: 600; color: var(--on-lime); margin: var(--s-4) 0 0; }
.pricing-hero .notice { margin: var(--s-4) auto 0; max-width: 40ch; }

/* THREE EQUAL COLUMNS: a pricing comparison is the one place parallel things
   at parallel size is the honest layout. Two when the Free card is absent. */
.tiers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-5); align-items: start; margin: 0 0 var(--s-8); }
.tiers--two { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 52rem; margin-inline: auto; }
.tier { padding: var(--s-6) var(--s-5); position: relative; }
.tier--lime { transform: translateY(-0.75rem); }
.tier-name { display: flex; justify-content: space-between; align-items: center; gap: var(--s-3); font-size: var(--t-label); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 var(--s-4); }
.tier .price { font-family: var(--display); text-transform: uppercase; font-size: var(--t-8); line-height: 0.9; letter-spacing: 0; margin: 0 0 var(--s-1); }
.tier .per { font-size: var(--t-1); margin: 0 0 var(--s-5); color: var(--ink-soft); }
.tier--lime .per, .tier--lime .checks, .tier--lime .check--buy span, .tier--lime .hint { color: var(--on-lime-soft); }
.checks { list-style: none; padding: 0; margin: 0 0 var(--s-5); font-size: var(--t-1); color: var(--ink-soft); }
.checks li { position: relative; padding: 0.35rem 0 0.35rem 1.4rem; }
.checks li::before { content: '✓'; position: absolute; left: 0; font-weight: 600; }
.tier .mark { font-size: var(--t-label); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; background: var(--on-lime); color: var(--lime); border-radius: 999px; padding: 0.15rem 0.6rem; }
.plan .mark { position: absolute; top: -0.65rem; left: 1.4rem; background: var(--card); color: var(--ink); border: 1px solid var(--line); }
/* The button on the lime card inverts: black on lime, the way the hero's does. */
.tier--lime .record { background: var(--on-lime); color: var(--lime); }
.tier--lime .record:hover { color: var(--lime-hover); }
.tier--lime .check--buy input { accent-color: var(--on-lime); }
.tier .record { margin-top: 0; }
.tier > .hint { margin: var(--s-3) 0 0; text-align: center; }
/* Priced plans (fixtures only today) keep the struck/ghost grammar. */
.tiers:has(.plan--current) .plan { opacity: var(--ghost); }
.tiers:has(.plan--current) .plan--current { opacity: 1; }
@media (max-width: 48rem) { .tiers, .tiers--two { grid-template-columns: 1fr; } .tier--lime { transform: none; } }

/* THE COMPARISON. An outlined table, the recommended column lit. */
.compare { max-width: 52rem; margin: 0 auto var(--s-8); }
.compare-t { font-family: var(--display); text-transform: uppercase; font-size: var(--d-4); line-height: 0.92; letter-spacing: 0; font-weight: 400; margin: 0 0 var(--s-5); }
.compare-scroll { overflow-x: auto; }
.compare table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; font-size: var(--t-1); }
.compare th, .compare td { padding: var(--s-3) var(--s-4); text-align: left; vertical-align: top; }
.compare thead th { font-size: var(--t-label); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); }
.compare tbody th { font-weight: 600; color: var(--ink); }
.compare td { color: var(--ink-soft); }
.compare .lit { background: var(--lime); color: var(--on-lime); }
.compare tbody tr + tr th, .compare tbody tr + tr td { border-top: 1px solid var(--line); }
.pricing-foot { max-width: 44rem; margin: 0 auto; }
```

`.record--way` (Task 2) stays for the plainer pack's button. Parse check; run `web-static`, `web-auth`, `web-billing`, `web-legal`: expected green.

- [ ] **Step 4: Full suite, sabotage, commit.** Sabotages: (a) render the Free card when signed in too → the three-cards test fails on the signed-in count; (b) put `class="lit"` on the FIRST quality column → the comparison test fails; (c) print `r.width`x`r.height` in the source-detail row → the raster assertion fails; (d) add a hidden `credits` input to the buy form → `test/web-auth.test.js`'s checkout allow-list fails (this one proves the money guard still binds after the rewrite). Restore each from its copy.

```bash
npm test > build/suite.log 2>&1; echo "exit $?"; tail -12 build/suite.log
git add scripts/web/views-auth.mjs scripts/web/static.mjs scripts/web/server.mjs test/web-static.test.js test/web-auth.test.js
git commit -F build/commitmsg.txt
```

Message: `pricing: credits not subscriptions -- three cards, the free rung a card when signed out, and 480p against 720p in one table`.

- [ ] **Step 5: STOP. Show the owner.** `/pricing` signed out at 375 and 1440, then signed in with his real account (the Free card gone, his balance in the band). Screenshots of all three. Ask whether anything moves before the deploy. Apply answers as small test-first follow-ups, one commit each.

---

### Task 7: Push, and hand the first deploy to the owner (NOTHING IS PULLED ON THE BOX)

**Files:** none modified until Step 5.

- [ ] **Step 1: The whole suite one last time, and the count against baseline.**

```bash
npm test > build/final.log 2>&1; echo "exit $?"; tail -12 build/final.log
```

Expected: 0 fail; the total is the Task 0 baseline plus the new tests minus the five deleted (two browser tests in Task 2, three web-static landing tests in Task 5, replaced by five). Write the numbers down for the commit-log message and CLAUDE.md.

- [ ] **Step 2: The seven guards, verbatim, counted 7/7.** Then `node --check` on the three template files once more, and:

```bash
git status --short
git log --oneline origin/supabase-identity-slice..HEAD
grep -rnE "is-landing|--l-(cathode|bone|dim|ground)|#FF8A1E|var\(--(paper|oxide)\)" scripts || echo CLEAN
git ls-files | grep -E "^build/|^out/|showcase.*\.(mp4|jpg)$" | grep -v "^test/fixtures/showcase/" || echo "no media tracked"
```

Expected: a clean tree; six to eight commits ahead (Tasks 1–6 plus the owner's follow-ups); `CLEAN` (only `scripts/` is swept -- `DESIGN.md`'s Superseded section and a few test comments name the old values as history, deliberately); `no media tracked`.

- [ ] **Step 3: Push.**

```bash
git push origin supabase-identity-slice
git ls-remote origin supabase-identity-slice
```

Pushing does not touch the box (`/opt/timestamp` only changes on `git pull`) and runs no CI on this branch. Confirm the remote SHA equals `git rev-parse HEAD`.

- [ ] **Step 4: Produce the hero stickers the owner chose, and stage the upload.** With his frame choices from Task 5:

```bash
node scripts/tapedeck/showcase.mjs --job=out/jobs/20260905-221822-a32b2a --slot=hero-16x9 --out=build/showcase --sticker=1 --at=12.0
node scripts/tapedeck/showcase.mjs --job=out/jobs/20260905-221822-a32b2a --slot=hero-16x9 --out=build/showcase --sticker=4 --at=14.5 --crop=stamp
ls -l build/showcase
```

(Stickers 2 and 3 come from tapes that exist only on the box; the runbook step produces them there.) Nothing under `build/` is committed.

- [ ] **Step 5: STOP. Hand the deploy to the owner as a message**, and do not run any of it. The message, in full:

> The lime world is pushed at `<sha>` on `supabase-identity-slice`; the box is still at `52e7889` and I have not touched it. When you want the first deploy, this is the order, and the first four steps put no new page live:
>
> 1. On the box, produce the two showcase tapes from the jobs already there (runbook §1 step 5, the two `docker compose run … showcase.mjs` lines), into `/opt/timestamp/showcase`.
> 2. From this machine: `scp build/showcase/hero-16x9.mp4 build/showcase/hero-16x9.jpg build/showcase/sticker-*.jpg root@178.105.77.16:/opt/timestamp/showcase/` (the stickers from the other two tapes are produced on the box in step 1 with `--sticker=2 --at=3.0` on the 4:3 job and `--sticker=3 --at=7.0` on the 9:16 job).
> 3. On the box: `echo 'TIMESTAMP_SHOWCASE_DIR=/showcase' >> /opt/timestamp/.env.web`.
> 4. `ls -l /opt/timestamp/showcase` should list ten files.
> 5. `cd /opt/timestamp && git pull && docker compose up -d --build` — this is the line that changes the live site, and it changes it to the landing AND the pricing page together.
> 6. From outside: `curl -s https://timestamptapes.com/api/health` is `{"ok":true,"degraded":[]}`; `curl -s https://timestamptapes.com/ | grep -c 'class="lime hero"'` is 1; `curl -sI -H 'Range: bytes=0-99' https://timestamptapes.com/showcase/hero-16x9.mp4` is 206 with `cache-control: public, max-age=86400`; `curl -sI https://timestamptapes.com/fonts/anton.woff2` is 200 `font/woff2`; `curl -sI https://timestamptapes.com/ | grep -i content-security-policy` is unchanged from before the deploy; `curl -sI https://timestamptapes.com/ | grep -i x-robots-tag` is still `noindex, nofollow`; open `/` and `/pricing` in a phone browser.
> 7. The order form, status, result, shelf, account, sign-in pages and the legal pages are in the new world with their old layouts until the second plan lands; that is the state the spec's §10 step 6 describes.
>
> Say the word and I will walk you through it live, or wait until the second half is built and deploy once. Either way I do not pull on the box.

- [ ] **Step 6: After the owner's deploy is verified from outside, record it.** Add a `### 70.` section to `CLAUDE.md` in the house register: what shipped in the six commits, the suite count, the two corrections this work made to the spec (`--rec` off the floor, the stamp is `0xF6EAC8` not orange), the two test deletions and why, the showcase's producer-on-the-box design, the facts that stay in the old layout, and the pages still to do (spec §10 steps 7–10). Replace the START HERE banner's "DO NOT `git pull` ON THE BOX until the landing and pricing are both done" with the deploy's date and SHA. Commit as `docs: section 70, the lime world's first deploy`, and push. Do not write it before the deploy is real.

---

## Self-review

**Spec coverage, section by section.**

| Spec | Where |
|---|---|
| §2.1 palette, aliases, one ground, on-image tokens | Task 2 step 9; the palette test |
| §2.1 `--rec` | Task 2 (moved to `#E85545`, recorded in DESIGN.md) |
| §2.1 date stamp untouched | Task 2 step 3 (pins `osd.color` = `0xF6EAC8`); corrected from "orange" |
| §2.2 fonts, self-hosted, OFL beside, no network font, Anton ≥ 18px, label role, ladder re-measured | Tasks 1–2; DESIGN.md |
| §2.3 speckle on `.lime`, paper on `.fact`, flat ground, filters in markup | Task 3 |
| §2.4 outlines from the token, radii, `<hr>` banned, focus ring colours | Task 2 (`:focus-visible`, `.lime :focus-visible`), Task 3 (`.panel`, `.card`, `.faq-row`) |
| §2.5 motion | Task 5's `BG_SCRIPT` (same three gates for showcase videos) |
| §3.1 hero, nav, headline, sentence, button, free line from the seam, ruler, breakout tape, caption, no stars | Task 5 |
| §3.2 manifesto with stickers, sentence alone without | Task 5 |
| §3.3 two cards, wipe unchanged, own-place card | Task 5 |
| §3.4 the band: rail, `.bg--<id>` layers, `BG_SCRIPT`, per-place scrim | Task 5 (generated rules re-targeted through `.wrap`) |
| §3.5 three fact cards, quotation markup, retention from config | Task 3 `factCards`, Task 5 |
| §3.6 demo band, two shapes, button, flip counter static | Task 5 |
| §3.7 FAQ, six `<details>`, numbers from seams, processors derived, sweeps | Task 3 `faqItems`, Task 5 |
| §3.8 footer columns, giant word, retention + disclosure lines | Task 3 `siteFooter` |
| §3.9 six widths, no overflow, stacking | Task 5 CSS + the six-width browser test |
| §3.10 dropped | nothing built for them; the "no dollar on the landing" assertion pins the dropped compare table |
| §4 showcase dir, allow-list, `sendFile`, `public, max-age=86400`, producer, tags survive, fallbacks | Task 4; fallbacks tested in Task 5 |
| §5.1–5.4 pricing band, three cards, acknowledgement kept, comparison, what comes back, FAQ, footer | Task 6 |
| §7 one stylesheet, no new script, shared functions, CSP unchanged, zero deps | throughout; the hash test and the faces test |
| §8 every named test | Task 2 (rewrites), Task 3 (texture), Task 4 (topology, showcase), Task 5 (landing), Task 6 (pricing); browser: hero plays, FAQ opens on click and Enter, six widths |
| §9 DESIGN.md, PDF untracked, runbook, CLAUDE.md | Task 2, Task 4, Task 7 |
| §10 steps 1–6, the embargo | the task order; Task 7 |
| §11 the go, the FAQ read, the frames, the lime | Task 1 step 1, Task 5 step 9 |

**Named in §8 and deferred to the second plan, on purpose:** the browser test "lime appears on exactly one card per option row after a selection" belongs to the order form (step 7); the `singlePlaceGround()` and `--frost-lit` deletions belong to onboarding (step 8) — `has-ground` is the temporary name that keeps that page working until then; the auth five and the dialog restyle (step 8); the result, status, shelf, account and legal pages (steps 7–9). Also deferred: retiring the `--lift` and `--ink-strong` aliases page by page, and the favicon (the last cream-world artefact, the owner's call).

**Placeholder scan.** No "TBD", no "similar to Task N". Two places tell the implementer to copy existing text verbatim rather than restating it: the spacing/type/display tokens in Task 2 step 9 (they do not change) and the sign-in dialog markup in Task 5 step 4 (it does not change; step 8 of the spec restyles it). Both name exactly what to copy and from where.

**Type consistency, checked:** `landingPage`'s `facts` keys (`photoDays, jobDays, imageProcessor, qualities, shapes, frames, fps`) match `publicFacts()` (Task 5) plus the two Task 6 adds (`deliveryShortEdge, lufs`); `faqItems`'s parameters match every caller after Task 5 step 1; `app.showcase()`'s shape (`hero, tall, fourThree, stickers`) matches the landing's reads and the Task 4 test; `balanceSentence`'s output matches the account test's strings; `tapeSlot` class names (`tape-media--hero|tall|four`) match the Task 5 tests and the browser probe.

**Two risks to know before starting.** (1) Every verification here is on Windows; the box is Linux and CI does not run on this branch. The browser tests use the same Chrome build CI does; the producer is ffmpeg 8 here and 7.1.5 in the image, and `-sseof`/`-update` exist in both. (2) The headless hero-plays test depends on Chrome starting a muted `play()` without a gesture, which the place loop already relies on in the same file; if it flakes, the assertion to keep is `readyState >= 2` and `currentSrc`, and the `paused` check moves behind a second settle.
