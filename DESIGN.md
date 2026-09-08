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
   Chosen is a FILL on a text card and a RING on a photograph; the glyph on an
   unchosen shape card and the mark on an unchosen option are ink, never lime.
   Nothing else takes it: not a label, not a link in prose, not a price, not a
   flag, not a numeral. That discipline is what lets colour answer "what have
   I chosen?".
2. **Red means the record light.** One element on the status page, plus the
   dot beside the wordmark. Only the status page's blinks: it sits on the phase
   being filmed, and the wordmark's dot is still so that blink means
   "recording" rather than "the site is live". There is no alarm red; an error
   is carried by weight and by words, in ink.
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

The landing's band is the only photograph left behind text (onboarding lost
its ground on 2026-09-07). Every word in it is `--on-image`, or lime when it
is chosen — the hint included, demoted by size rather than by tier — and
nothing in it is a ghost: the rail's options paint at full opacity plus their
shadow, the §63B footer's treatment, because the ghost floor is solved on the
flat ground and the same 0.5 measured 2.1–4.4:1 beside the strokes over a
picture. A test refuses any other tier inside `.band`, and the solver's inks
are tied to `--on-image` and `--lime` by another.

**The scrim is solved per place, through the paint, on two numbers
(2026-09-07, evening).** The scrim is a linear gradient stacked on a radial
one, multiplied by the layer's opacity, so what lands on the picture is the
layer opacity times the gradients' covering power — at least 0.868 of it, at
the horizontal centre a third of the way down, where the linear stop is
weakest. The stops are constants in `static.mjs`; the sheet paints from them
and the solver divides by their minimum. And the solve holds two numbers from
`assets/places/loops.json`: 8:1 for both inks on the loop's **mean** luma, and
4.5:1 on its **highlight** — the brightest pixel any frame shows after a 2px
blur — because a mean cannot see a neon sign: solved on the mean alone, the
three night places sat at the 0.30 floor and the hint measured 1.57:1 over
Tokyo. The highlight is what binds. Every loop's is 216–238, so the layers
run from 0.60 (the living room) to 0.69 (Amalfi) and land 0.52–0.60 on the
picture; a loop with no measurement is solved as a white photograph (0.87).
The rule keys on the place's radio alone, so a visitor with no loop gets the
same solve: the still under each loop is darker than the loop on the mean
(the tape grade lifts the black floor) and blurred three times as hard.

**Which way the scrim moved, since it moved twice in one day.** The morning
re-solve for `--on-image` LOWERED it — a brighter ink reaches 8:1 at a lighter
scrim: Amalfi 0.62 → 0.56, the night places on the 0.30 floor. The evening
measurement RAISED it, and by more, for two reasons stacked: the paint had
been covering about 0.87 of what the solver assumed, and the highlights the
mean hid need about 0.55 on the picture. The night places are the visible
change — Tokyo went 0.30 → 0.64.

**Measured, not modelled.** `test/browser-smoke.test.js` renders the band
twice per place — every word in sentinel magenta with no shadow, to find the
strokes; then in transparent ink with the shadow painted, to read what sits
beside them — and holds the lightest pixel touching a stroke to 4.5:1 (3:1 for
the title, which is over 24px at every width), at 375 and 1440, with the loop
playing and with the still under a reduced-motion request. 254 runs of text;
the worst is 5.43:1, the chosen lime option over Times Square on a phone. The
shadow is deliberately inside the measurement and deliberately outside the
solve: it is margin the browser can see and the solver cannot. Earlier the
same day a probe that hid the text — shadow and all — read 2.1–4.9:1 and was
not shipped, for the right reason: it measured a page nobody paints.

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

The three legal pages are documents on the ground at 66ch, not cards, because
a policy is read and not framed; the error pages are one card each, because
a sentence and a button are what a card is for.

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
- **An identifier is data, not a heading.** The account page's `<h1>` is the
  signed-in address; it keeps the body face at 600, sentence case, because an
  email address uppercased is a different string. This is the one `.headline`
  that is not Anton, and the metrics test exempts it by the face it names.
- **The scale is unchanged from 2026-08-31:** a minor third on 16px,
  `--t-label` 12px through `--t-8`, `--t-hero clamp(48px, 8vw, 96px)` once per
  site, `--t-mark` for the footer's giant word -- sized off its own column
  (`.foot` is a query container) rather than the viewport, since 2026-09-06
  (later), so it fills whatever width the page gives that column instead of
  clipping on a narrower one. The display ladder `--d-1`
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

Nothing pulses or hurries the reader except the status page's record light,
on the phase being filmed; the wordmark's dot is still. The hero tape
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
and is not committed.

**The browser icon came into this world on 2026-09-08, at the owner's word.**
The `Ts` is knocked out of a `--lime` tile in the `--on-lime` ink, across
`icon.svg`, `favicon.ico` and the three PNGs. `test/web-brand.test.js` reads
both values out of the stylesheet rather than repeating them, so the mark
cannot drift from the palette, and it decodes every raster -- recolouring the
vector and forgetting the four rasters is the whole failure mode, and it is
silent. The letterforms are unchanged: still Cormorant Garamond Italic, still
the head-switch tear, because the rasters were **recoloured pixel by pixel
rather than re-rendered** (`assets/brand/README.md` has the method and the
measured residual). Redrawing the letters in Anton is a further step and has
not been taken.

**Four brand files remain in the cream world's colours and no route serves any
of them**: `wordmark.svg`, `wordmark-inline.svg`, `monogram.svg`,
`monogram-inline.svg`. The masthead is live Anton text, so nothing reaches
them. They are the last cream-world artefacts in the repository, and what
happens to them is the owner's call.
