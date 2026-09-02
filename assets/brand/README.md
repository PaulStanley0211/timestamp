# Brand assets

Generated, not hand-drawn. This file is how to regenerate them; `DESIGN.md`
is why they look the way they do.

| File | What it is |
|---|---|
| `wordmark-inline.svg` | Inlined into the page header. **No `<style>` element** — `style-src 'self'` blocks an inline `<style>` wherever it appears, an inlined SVG included. The record light carries `class="rec"` and the stylesheet animates it. |
| `wordmark.svg` | The same mark as a **file** — an `<img>`, a README, a press kit. Self-contained: an SVG loaded as an image cannot see the page's stylesheet, so this one carries its own animation. |
| `monogram.svg` | The `Ts`, bare, on transparent, `currentColor`. |
| `monogram-inline.svg` | The same mark prepared for the masthead lockup: **no `width`/`height`** so CSS sizes it, `class="mg"` for the stylesheet, and `aria-hidden` because it draws the letters the word beside it already spells — named, it is announced as a second "Timestamp" before the first. Generated from `monogram.svg`; do not hand-edit. |
| `icon.svg` | The `Ts` knocked out of an oxide tile. What the browser tab paints. |
| `favicon.ico` | 16/32/48 in one file, so the browser picks rather than downscaling badly. |
| `icon-180.png` | apple-touch-icon. The one with **no fallback** — unlinked, iOS screenshots the page instead. |
| `icon-192.png`, `icon-512.png` | Android / PWA sizes. |

## Provenance

- **Face:** Cormorant Garamond, Italic, variable `wght` axis instanced at
  **600**. OFL 1.1, from
  `https://github.com/google/fonts/tree/main/ofl/cormorantgaramond`
  (`CormorantGaramond-Italic[wght].ttf`).
- **Kerning** is read out of the font's `GPOS` `kern` feature directly, because
  there is no HarfBuzz on the machine these were built on. Only `m→e` (+6)
  actually applies to an adjacent pair in "Timestamp"; the face is otherwise
  well fitted at this size.
- **Coordinates** are rounded to one decimal. That is about 0.06px at the
  largest size these are ever drawn and it takes the wordmark from 23kB to
  under 10.
- **The font is not redistributed here.** These files are outlines — a
  document set in the face, not font software.

## The two numbers that define the mark

    seam   0.72   fraction of the ink height where the tear falls
    shift  46     displacement of the lower band, in font units (em = 1000)

The seam sits **low, through the feet of the letters**, which is where a head
switch actually lands on a frame. Put it at mid-height and it stops reading as
a tape artefact and becomes a generic glitch logo.

`shift` was chosen against two neighbours: at 22 the tear is invisible unless
pointed out, and at 88 the letters stop reading as torn and start reading as
doubled — the word becomes work to read and the `i` detaches from its dot.

**The wordmark's tear and the monogram's do NOT line up, and must not be made
to.** `seam` is a fraction of *ink height*, and the two marks have different
ink: `Timestamp` carries the descender of `p`, `Ts` carries none. So 0.72 lands
*below* the wordmark's baseline — through the feet, which is where a head
switch falls — and *above* the monogram's, at 74.9% of its ink. That is
correct: put the monogram's tear on its own baseline and there is nothing
beneath the cut to displace, so the tear vanishes and the mark is a plain serif
`Ts`, which is the one thing it exists not to be.

The consequence for the masthead lockup is that you may align the baselines or
the tears, never both. The baselines win — see `.wordmark .mg` in
`scripts/web/static.mjs`, which carries the measured numbers.

## Regenerating

Every contour of a glyph must end up in **one** `<path>`. Emitting each contour
as its own path destroys the nonzero winding that cuts the counters, and the
bowl of the `a` fills in solid. The record light is the only contour that may
live apart, and it can, because it does not overlap the stem it belongs to.

The rasters are rendered at **8×** and downsampled. A 16px icon drawn directly
loses this face's thin strokes entirely, and the tear — under a pixel wide at
that scale — goes with them. The tear is also floored at one *final* pixel, not
one supersampled one, or it vanishes in the downsample and leaves a plain serif
`T`, which is the one thing this mark exists not to be.
