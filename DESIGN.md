# DESIGN.md — Struck

The visual world for Timestamp. Product truth lives in PRODUCT.md; this file
owns durable visual decisions. Chosen 2026-08-24, replacing the frost-and-amber
world that preceded it.

## The world in one sentence

A cathode readout behind fine bronze gauze: every possible value present at once
as an unlit ghost, one struck forward in glowing orange, on a plane that runs
past every edge with no box, rule or divider anywhere.

## The one rule that makes it this world and not another

**No borders, no rules, no dividers. Anywhere.**

Grouping is depth, gauze density and space — never a line. This is the hardest
constraint in the system and it is the whole identity: the moment a `border` or
an `<hr>` appears to separate two things, the page becomes an ordinary dark UI
with orange accents. Verified mechanically: a pass over every element inside the
page wrapper must return zero elements with a non-zero, non-`none` border.

Two exceptions, both named so they cannot become drift:

1. `outline` for `:focus-visible`. Not decoration, and never to be removed.
2. `.framecard .shape` — the small rectangle drawn at 4:3, 16:9 and 9:16 beside
   each frame option. That is a **glyph depicting an aspect ratio**, not a
   device for separating two things, and "tall" or "wide" reads from it faster
   than from the numbers. Any new border must argue itself into this list or it
   does not ship.

## Texture belongs to the tape, and to nothing else

The interface carries **no** grain, scanlines, noise or vignette. Every trace of
texture on any page exists inside a tape frame. This is PRODUCT.md's
architecture made visible: the model does content, ffmpeg does texture, and the
chrome does neither. A page that wears tape artefacts competes with the artifact
instead of framing it, and reads as an AI tool with a filter — the exact
impression the product exists to avoid.

## Palette

Two hues and their roles. Nothing else gets a colour.

| Token | Value | Role |
|---|---|---|
| `--ground` | `#070A11` | ink-blue black, the plane |
| `--ground-lift` | `#0C111B` | where the plane sits nearer |
| `--cathode` | `#FF8A1E` | struck. The chosen value, and nothing else |
| `--cathode-hot` | `#FFB25C` | the hotter core of a struck value on hover |
| `--bone` | `#EDE7DC` | body prose |
| `--bone-dim` | `#8D8880` | labels — measured 5.63:1, clears the floor |
| `--gauze` | `rgba(190,140,80,.16)` | the anode mesh, 1px on 4px, fixed, over everything |

**Orange means exactly one thing: struck.** It is not used for labels, prices,
flags, hints, links or decoration. The previous world let amber mean ten things
at six sizes, and colour stopped being able to answer "what have I chosen?".
That failure is the reason this rule is written down.

Imported photographs stay **untinted** beneath the gauze veil. They are the
subject; the world does not colour them.

## Type

- **Display:** `TapeOSD` (VT323, SIL OFL 1.1, already committed at
  `assets/fonts/tape-osd.ttf`). A terminal/numeral face that behaves like a
  cathode readout when it glows. Self-hosted; no network font, which the CSP
  and the zero-dependency rule both require.
- **Body prose:** the system sans stack. Prose is not the voice of this world;
  the readout is.
- Display is uppercase with open tracking. Body is never uppercase.

## Ghosts and the accessibility floor

The catalogued grammar for this world puts unlit options at ghost opacity.
Measured literally, a ghost at `.15` gives about **1.4:1** — a control nobody
can read.

**Ghosts sit at `opacity: .5`**, which measures **4.55:1** effective and clears
the floor. They remain plainly unlit against a struck value that is full
opacity, orange and haloed. This is a permanent adaptation of the world, not a
one-off: the distinction is carried by *colour and halo*, not by making text
invisible.

## Motion

- **Values snap.** A struck value has no transition; it is simply on.
- **The old glow decays over one beat** (~420ms, linear) as the new one strikes.
- Motion has mass: where something lands rather than fades, it overshoots
  (`cubic-bezier(.2,1.5,.4,1)`).
- Everything above is cancelled under `prefers-reduced-motion: reduce`.

## Spacing

The 4px scale from `--s-1: 4px` to `--s-8: 64px`, already in the stylesheet.
Structural rhythm uses these and nothing else. Tight within a group, generous
between groups — the contrast is what carries grouping in a world with no lines
to do it.

## What this world inherits unchanged

- CSS-only selection through hoisted `.statehook` radios, `position: fixed`.
  The world's central mechanic — all options present, one struck — **is** this
  technique, which is why it fits the codebase rather than fighting it.
- The 4px spacing scale.
- Zero npm dependencies, no inline styles, server-rendered HTML.

## The brand identity (2026-08-27)

The chrome and the mark are not the same problem, and this section is the mark.

**The brand is a keepsake; the artifact is a tape.** The identity is quiet,
warm and elegant precisely so the grainy 2003 thing inside it reads as precious
rather than as a filter. That is this file's own rule about texture, followed
one step further: if the chrome may not wear the tape, neither may the logo.

### The wordmark

**Cormorant Garamond Italic 600, outlined to paths.** Calligraphic by descent --
Garamond derives from chancery hands -- so it reads as calligraphy without
becoming wedding stationery on a word as technical as "Timestamp". Weight 600
because this face runs very light and disappears below about 24px.

**The font does not ship.** Nine letters are not worth a font request, and
outlines render identically everywhere with no CSP question. The paths live in
`assets/brand/`; `assets/brand/README.md` records exactly how to regenerate
them.

**One head-switch tear, and only one.** The bottom of the letterforms is
displaced sideways below a seam at 0.72 of the ink height -- the band at the
bottom of a VHS frame where the tape head changes, which is stage 5 of
`docs/the-look.md`. It is DRAWN, as a clipped displacement, not filtered: it
therefore survives at 16px and at any resolution, which a texture would not.

The tear is the whole distinctiveness argument. Cormorant Italic on its own is
one of the most-used faces on the internet and the wordmark without it is
elegant and anonymous. The VHS cliche is chroma bleed AND scanlines AND noise;
doing exactly one thing, precisely, is what separates this from a filter.

**The record light is the dot of the i.** In the accent, keeping the 1.6s
`steps(1, end)` rhythm the standalone dot had. It is the one piece of the
tape's idiom allowed into the chrome, because at that size it reads as
punctuation rather than pastiche. **It pulses to .45 and does not vanish**: the
standalone dot bottomed out at .12, which is right for a record light, but this
one is also a letter, and at .12 the word reads as a rendering fault for half
of every cycle.

### The palette

Measured, not asserted. The identity is built for a light ground; the pages
still implement Struck and follow later.

| Token | Value | Role | Contrast |
|---|---|---|---|
| `--paper` | `#FAF7F2` | ground -- warm white, an album page | -- |
| `--ink` | `#2A211B` | body, wordmark | 14.76:1 |
| `--ink-soft` | `#7A6A5E` | labels, hints | 4.85:1 |
| `--oxide` | `#A8342A` | the single accent | 6.16:1 |

**The accent needs two values, and this is the finding worth keeping.**
`#A8342A` measures 2.86:1 on a dark ground -- an accent that is one hex across
both grounds is a wish, not a colour. On dark it lifts to `#D98B7A`, the same
hue raised until it clears the floor (measured 7.47:1 against today's
`--ground`). The mark therefore takes its record light from a `--rec` token
rather than a literal, and the ground names the value.

**The cathode orange does not come to the light world.** `#FF8A1E` measures
1.95-2.21:1 on every candidate light ground and fails at every size. It was
chosen to glow on ink-blue and it does that well. It is not deleted, it is
relocated: it keeps the burnt-in date stamp inside the tape, where it was
always right, and it leaves the chrome.

### The reference (locked 2026-08-28)

**`artifactuprising.com`.** Paul chose it after looking at three candidates in a
browser and measuring them. It is the reference for the pages when they follow
the identity onto `--paper`.

**WHY THAT ONE, AND THE REASON IS NOT TASTE.** It is the same product. Somebody's
photographs go in and a keepsake comes out, which is the sentence at the top of
this section. Borrowing from it is borrowing a solved version of our own problem
rather than translating one from another category. Two things follow for free:

- **Its type is our type's cousin.** They set Crimson Text; the wordmark is
  Cormorant Garamond. Both are Garamond-descended serifs, so the mark already
  belongs on a page built this way.
- **Its product grid IS the shelf.** Image, then name, then price, sitting
  directly on the paper -- no box around the image, no border, no shadow,
  nothing between one tile and the next except space. That is `Your tapes`,
  finished, and it is a grid that obeys this file's one rule already.

**WHAT NOT TO TAKE FROM IT.** Its secondary buttons are 1px-bordered boxes. They
would fail the border sweep at the top of this file on the first render.

**MEASURED, SO THE NUMBERS ARE NOT A VIBE.** A second candidate, `aesop.com`,
was kept only as proof that this discipline survives at commercial scale: ground
`#FFFEF2` against our `--paper #FAF7F2`, text `#333333` against our `--ink`, and
**two** bordered elements in the first four hundred. Its typography is Suisse
Intl throughout and must not be copied -- sans everywhere fights the serif mark.
A third, `vsco.co`, was REJECTED on sight: it has rebranded to black-on-white
with a rainbow gradient banner, and the muted-film aesthetic it was suggested
for is gone.

**THE ONE PROBLEM NEITHER REFERENCE SOLVES, and it is ours to solve.** Both sites
put light, warm photography on warm paper, so their images dissolve into the
ground. **A tape is dark 2003 camcorder footage.** On `--paper` every thumbnail
becomes a hard dark rectangle, and this file has removed the three tools most
people would reach for -- there is no border, no rule and no shadow to soften it
with. Decide it deliberately: a paper mat inside each tile, the tape's own black
bars bled to the tile edge, or a warm tint over the still. Do not discover it.

### The icon -- `Ts`

**A capital T with a lowercase s**, from the wordmark's own face, torn the same
way and knocked out of an oxide rounded square.

**The s is not scaled.** It is 407 units against the T's 653 -- 62% straight
out of the font, which is the proportion the face itself chose and it needs no
help. Scaled up the two drift back into being a pair of letters; scaled down
the s reads as a subscript. Both glyphs also sit on the same baseline in font
space, so the s stays seated at every size with nothing nudged by hand.

**It reads as Time / Stamp**, which two capitals did not: `TS` is an
abbreviation, `Ts` is the word. The s is tucked deep enough under the T's arm
that the two overlap, and the mark is drawn as ONE path -- under nonzero
winding the overlap unions into a single solid, which is what a monogram is.
Two paths would look joined until the day one took a different fill.

**The icon is optically sized, and this is the part worth keeping.** A fixed
ratio is right for a poster and wrong for a favicon: at 16px the padding that
flatters a 512px icon is most of the pixels, and what is left for two letters
is a smudge. The mark therefore grows as the square shrinks -- 0.60 of the box
at 16, 0.54 at 32, 0.50 at 48, 0.46 above. Each `.ico` frame is drawn at its own
size rather than downscaled from one master, which is the whole reason to ship
a multi-resolution icon at all.

**Two letters cannot be legible at 16px and that is accepted.** A single `T`
was clearer there; `Ts` is the better mark everywhere else, and a 16px favicon
works by colour and silhouette rather than by reading.

### Rules

- **Clearspace:** the cap-height of the `T` on all four sides.
- **Minimum sizes:** wordmark 96px wide, icon 16px. Below 96px the wordmark is
  replaced by the icon, never shrunk.
- **Greyscale:** every mark must survive with no colour at all. Checked.
- **Never re-colour the letterforms.** They are `currentColor` so one file
  serves every ground; the record light is the only part with a colour of its
  own.

## Superseded

The frost-and-amber world (`--frost`, `--frost-lit`, `--hairline`, `#FFB700`,
the four-tier panel weight arc) is replaced. Do not reintroduce its panel boxes:
they are the borders this world forbids.
