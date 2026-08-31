# Premium redesign — every page but the auth five (2026-08-31)

**Status:** approved in chat, building.
**Thesis:** the artifact. **Depth:** structure plus one signature moment per key page.
**Out of scope:** `login`, `signup`, `verify`, `reset`, `reset-complete` — the owner
is bringing his own reference. They get the new type scale and spacing so they do
not look stranded, and no layout change.

---

## 0. Why this exists

The brief was three words: premium, good-looking, **not AI slop**. The last is the
operative one, and it is a structural property rather than a visual one. §17 already
proved that on the image side — the still read as AI because of composition, not
texture, and the fix was the prompt rather than the grade. The same is true here: a
symmetric grid is slop at any level of typographic polish.

One instance is already diagnosed and unfixed. §33's design review found the
landing's `CONTENT / TEXTURE / CONSENT` block is `repeat(3, minmax(0,1fr))` — the
canonical AI-generated landing layout, and *"the only section on that page that
reads templated."* That block is the worked example for everything below.

## 1. The thesis: the artifact, not the instrument

The tape is a physical object you keep. The chrome is paper, the photography is
real, the type behaves like print. Premium comes from **materiality**.

**The argument against the obvious alternative.** Every competitor in this category
looks like an *instrument*: Pika is a "cream diptych meets cinema void", Runway a
"monochrome research studio", Morphic a "dark cinema canvas". Timestamp adopting
that language would read as a clone of a category. Consumer premium is materiality
— Leica, Moleskine, and `artifactuprising.com`, which DESIGN.md already locks as
the reference.

**The instrument survives where it belongs:** inside the tape frame and the OSD.
VT323 stays the readout, never the furniture. That is DESIGN.md's own rule — *"prose
is not the voice of this world; the readout is"* — so this sharpens it rather than
reversing it.

Nothing about the identity moves. Palette, ghost floor, wordmark, the no-borders
rule, the `--on-image` tier and the locked reference all stand.

## 2. The three system moves

### 2.1 A type scale (there is none today)

Measured across `static.mjs`, the sizes are ad hoc: `clamp(29px,4.4vw,40px)`,
`clamp(44px,7.4vw,104px)`, `clamp(20px,2.4vw,29px)`, `clamp(26px,3.6vw,44px)`, then
bare `15px`, `25px`, `16px`. No ratio, no named steps, no relationship between them.

§15 did exactly this for **spacing** — 34 distinct rem values, 18 of them inside a
14.4px span, collapsed onto eight steps — and it is why the pages feel ordered. Type
never got the pass. It is the largest single lever here and the most invisible.

**Minor third, 1.2, base 16px.** The restrained ratio, chosen because restraint is
the thesis; a major third grows too fast and starts shouting by the third step.

| Token | Value | Role |
|---|---|---|
| `--t-1` | 13px | fine print, legal, captions |
| `--t-2` | **16px** | body prose — the base |
| `--t-3` | 19px | lede |
| `--t-4` | 23px | h3 |
| `--t-5` | `clamp(23px, 2.2vw, 28px)` | h2 |
| `--t-6` | `clamp(28px, 3.2vw, 33px)` | h1, interior pages |
| `--t-7` | `clamp(33px, 4.4vw, 40px)` | h1, app page |
| `--t-8` | `clamp(40px, 6vw, 48px)` | display, sub-hero |
| `--t-hero` | `clamp(48px, 8vw, 96px)` | the landing hero, once per site |

**BODY GOES 15px → 16px, AND THAT IS A FIX RATHER THAN A PREFERENCE.** §6c found it
and deliberately left it: *"changing it reflows every page in the product.
Typography, not layout — not done unasked."* This is the pass where typography is
the subject, so it is done now. It also removes iOS input auto-zoom, which fires
below 16px and silently breaks every form on the site.

The display ladder (VT323) keeps its own steps because the face reads smaller than
the system sans at the same pixel size; it is scaled off the same ratio.

### 2.2 Density that varies

The spacing scale exists and is applied *evenly*, which reads as ordered but not as
composed. DESIGN.md already states the rule — *"tight within a group, generous
between groups"* — and the pages under-apply it.

Sections take an explicit weight. `--s-8` (64px) is the ordinary gap between groups;
a section boundary that carries an argument gets more, and material inside a thought
gets `--s-3`/`--s-4`. The gaps stop being interchangeable.

### 2.3 No equal-column content grid

`repeat(3, minmax(0,1fr))` is the tell, and the fix is refusing the shape, not
restyling it.

**The answer is already in the codebase.** The signed-in page's `#tape` is a 320px
sticky anchor beside a 640px flow column — measured, exactly 1:2 (§6a). It is the
best layout decision in the product and it exists on exactly one page. It becomes
the house rule: content grids are deliberately uneven, and a lead element carries
more weight than its neighbours.

A test enforces it, in the same spirit as the existing border and texture sweeps.

## 3. Per page

### 3.1 Landing — signature moment: **the tape, as an object**

- **The hero keeps the loop and sheds weight.** It currently stacks an h1, a
  sub-paragraph, the eight-place rail, a "Strike one" hint, **two CTAs** and the OSD
  readouts over a moving photograph. `I have an account` moves to the masthead where
  signed-out nav belongs, leaving **one** call to action. Competing CTAs of near-equal
  weight is a slop tell and a two-line fix.
- **A tape plays, presented once, large.** There is no tape anywhere on the landing
  today, which is the biggest gap on the site: the product is a fifteen-second
  artifact and the page selling it never shows one. Under the artifact thesis it is
  an object rather than a background — matted 4:3, at rest on the dark ground, the
  date burnt into the corner.
  **BLOCKED ON THE OWNER:** this needs one genuinely good finished tape, which is a
  paid render. The component ships with a placeholder and a documented slot.
- **The three-column block dies, its copy survives.** `Content / Texture / Consent`
  is good writing in a template's clothes. It goes asymmetric with **Texture
  leading** — the only one of the three that is genuinely Timestamp's, and the
  paragraph with chroma bleed and the head-switch band in it — and the other two
  subordinate. Same words, no equal columns.
- **A price, once.** No price appears on the landing today. One honest line, not a
  table, and it says tax is added at checkout (§46B).

### 3.2 Home — signature moment: **the four choices as one instrument**

The two-column `#tape` grid stays; it is the reference the rest of the site now
copies. The step panels get the density treatment, and step 3's bare native
`Choose File` — §43D, left as an owner decision — is finally brought in line with
step 1's dropzone, since this pass is exactly the script-plus-restyle change §43D
said it needed.

### 3.3 Pricing — signature moment: **the ladder is legible at a glance**

The struck/ghost grammar already landed (§31). What is missing is that the three
rungs are still three equal columns, and the credit costs (21/28/46/61) are the most
useful thing on the page and the least visible. The rungs go uneven, and what a
credit buys is stated in tapes rather than only in numbers.

### 3.4 Result — signature moment: **the tape is the page**

The delivered tape is the product and currently shares the page with chrome. It
becomes the subject: large, centred on its own ground, the AI-disclosure line (§38B)
kept and given proper type rather than fine print, download and share subordinate.

### 3.5 Status, select, onboarding ×2

Status gets the density pass and keeps its poller untouched. Select is an operator
surface since §37 and is treated as one — plain, honest, not customer-polished.
Onboarding gets type and rhythm only.

### 3.6 Legal ×3 and the error trio

`privacy`, `terms`, `impressum` are long-form prose and are the easiest premium win
on the site: a measure, a scale, and real rhythm. They currently inherit app
spacing. `error`, `auth-unavailable`, `identity-unavailable` get type consistency.

## 4. What must not break

Every one of these is an existing test, and this pass keeps them green rather than
editing them:

- no page wears a texture of its own; the gauze and grain plate stay out of the sheet
- no border draws a line of its own colour; no page emits an `<hr>`
- nothing takes a focus outline away; every hoisted radio marks its visible label
- the landing plays its place full-bleed and its list is a snapping rail
- the palette and the ghost floor clear 4.5:1, recomputed from the shipped values
- cathode orange appears nowhere on the paper side
- the four inline scripts stay hashed in `INLINE_SCRIPT_HASHES` — **a fifth is dead
  in the browser, silently**

New tests: the type scale is used rather than bypassed (no bare `font-size` in px
outside the token block), and no content grid is equal-column.

## 5. Risks

- **The 15px → 16px body reflows every page.** It is the right fix and it is also
  the change most likely to surface a layout that was only holding together at 15px.
  Every page is re-measured at 320/375/414/768/1024/1440 afterwards.
- **The landing centrepiece is blocked on a paid render.** Placeholder until then.
- **Backticks inside a comment inside a template literal** break `static.mjs` and
  `views.mjs`. `node --check` after every edit to both — the most repeated mistake in
  this codebase.
