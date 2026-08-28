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
texture on any page exists inside a tape frame. **The anode gauze was the one
exception this file made against itself, and on 2026-08-28 it was deleted rather
than kept** -- see the palette section above for why a 1px-on-4px mesh over the
viewport could not coexist with this sentence. This is PRODUCT.md's
architecture made visible: the model does content, ffmpeg does texture, and the
chrome does neither. A page that wears tape artefacts competes with the artifact
instead of framing it, and reads as an AI tool with a filter — the exact
impression the product exists to avoid.

## Palette — STRUCK, and since 2026-08-28 the landing page only

Two hues and their roles. Nothing else gets a colour. Ratios are against
`--ground`.

| Token | Value | Role | Contrast |
|---|---|---|---|
| `--ground` | `#070A11` | ink-blue black, the plane | -- |
| `--ground-lift` | `#0C111B` | where the plane sits nearer | -- |
| `--cathode` | `#FF8A1E` | struck. The chosen value, and nothing else | 8.40:1 |
| `--cathode-hot` | `#FFB25C` | the hotter core of a struck value on hover | 11.10:1 |
| `--bone` | `#EDE7DC` | body prose | 16.09:1 |
| `--bone-dim` | `#8D8880` | labels | 5.63:1 |

**WHY THIS WORLD SURVIVES ON EXACTLY ONE PAGE.** The landing's central mechanic
is that picking a place turns the whole page into that place -- a full-bleed
photograph, scrimmed until bone prose clears 8:1 over it. That scrim is what
makes the ground dark; a light scrim over a dark 2003 interior does not exist.
Moving the landing to paper would not have been a recolour, it would have deleted
the demo. So the app is an album page and the landing is the thing the album is
full of. Every other page is `--paper`.

**It is implemented as tokens and never as rules.** `body.is-landing` re-points
eleven aliases at the values above and every rule in the sheet follows without
knowing which world it is in. A rule scoped to the landing is how the two worlds
start diverging in layout as well as colour.

**`--gauze` IS DELETED, and it resolved a contradiction this file was carrying.**
The row used to read "the anode mesh, 1px on 4px, fixed, over everything". Four
sections below, this same file says the interface carries "no grain, scanlines,
noise or vignette" and that every trace of texture lives inside a tape frame. A
1px-on-4px repeating gradient across the whole viewport *is* scanlines. The two
could not both be followed; the texture rule is the stronger one, because it is
what keeps the chrome from competing with the artifact. The mesh is gone from the
sheet, not suppressed in it.

**Orange means exactly one thing: struck.** It is not used for labels, prices,
flags, hints, links or decoration. The previous world let amber mean ten things
at six sizes, and colour stopped being able to answer "what have I chosen?".
That failure is the reason this rule is written down.

**Orange did not come to the light world and was not deleted.** It keeps the
burnt-in date stamp inside the tape, where it was always right. On `--paper` it
measures 2.21:1.

Imported photographs stay **untinted**. They are the subject; the world does not
colour them.

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

**A ghost sits at the floor and no lower.** The distinction is carried by
*colour and position in the palette*, never by making text invisible. That is
the rule, and it is permanent.

**THE VALUE OF THE FLOOR IS A PROPERTY OF THE GROUND, AND THIS IS THE ONE NUMBER
THE MOVE TO PAPER ACTUALLY BROKE.** This section read "ghosts sit at
`opacity: .5`, which measures 4.55:1" -- true, and measured with bone on
`#070A11`. On `--paper`, `--ink` at `.5` measures **3.11:1**: a real AA failure
on every unlit option in the product, and one that fails *quietly*, because a
ghost is supposed to look faint and so nothing looks wrong.

Re-solved against paper, **`.63` is the least opacity that clears 4.5:1** -- and
it lands on **4.55:1**, the same number this file recorded for the dark ground.
So the floor is a token, `--ghost`, and each ground names its own value, exactly
as it names `--rec`.

| Ground | `--ghost` | measured | hover `--ghost-hover` |
|---|---|---|---|
| `--paper` | `.63` | `--ink` **4.55:1** | `.82` -> 8.44:1 |
| `--l-ground` (the landing) | `.5` | `--l-bone` **4.53:1** | `.82` |

**WHAT DOES NOT FIT UNDER A GHOST ON PAPER, and this is what it costs.**
`--ink-soft` needs `.97` to clear 4.5:1 and `--oxide` needs `.84`. Neither is a
ghost. So **nothing inside a ghosted control is written in the soft tier any
more**: the hierarchy inside a card is carried by SIZE, which survives being
multiplied by an opacity, and not by colour, which does not.

**AND THE GHOST MOVED OFF THE PLACE CARD ONTO ITS PHOTOGRAPH.** A place card
carries its name and date on the image, over a scrim solved for FULL opacity;
ghosting the whole card multiplies that scrim too, and even at the floor the name
lands at 4.36:1 and the date at 3.32:1. The unlit half of the menu would have
been the half nobody can read, on the control where reading the label *is* the
choice. **The world decides which picture is lit. It does not dim the menu.** So
the opacity sits on `.thumb` and the caption stays at full strength.

**A refused option sits at the floor as well.** `--soon` states were at `.26`,
which is `--ink` at **1.70:1**. Opacity cannot carry "not yet" on paper without
going under the floor, so the flag carries it in words -- which is the only
version a screen reader ever had.

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

Measured, not asserted. **The pages followed the identity onto `--paper` on
2026-08-28.** The line that used to close this paragraph -- "the pages still
implement Struck and follow later" -- is spent. Every ratio below was re-derived
against the cream ground on that date; none of the Struck numbers carried over,
because all of them were measured against `#070A11`.

| Token | Value | Role | on `--paper` | on `--lift` |
|---|---|---|---|---|
| `--paper` | `#FAF7F2` | ground -- warm white, an album page | -- | -- |
| `--lift` | `#FFFFFF` | the plane sitting nearer | 1.07:1 | -- |
| `--ink` | `#2A211B` | body, wordmark | **14.76:1** | 15.77:1 |
| `--ink-soft` | `#7A6A5E` | labels, hints | **4.85:1** | 5.18:1 |
| `--oxide` | `#A8342A` | the single accent | **6.16:1** | 6.58:1 |
| `--oxide-deep` | `#8E2A22` | struck, on hover | **7.85:1** | 8.39:1 |

`--paper` on `--oxide` is **6.16:1** -- the same pair, because contrast is
symmetric -- which is what lets a filled oxide button carry a paper label.

**`--lift` GOES TO WHITE, NOT TO A DEEPER CREAM, and this is a finding rather
than a preference.** The obvious "warmer paper" plate, `#F2EDE4`, puts
`--ink-soft` at **4.45:1** and fails the floor. The dark world's lift was also
*lighter* than its ground (`#0C111B` over `#070A11`), so "nearer is lighter"
survives the move intact; it just points at white here.

**`--oxide-deep` IS DEEPER, NOT BRIGHTER.** `--accent-bright` was a *lighter*
orange because light is what glows on black. Struck on paper is the same ink
pressed harder, so hover goes down the scale rather than up.

**TWO TEXT TIERS, NOT THREE.** `--ink-soft` clears the floor by 0.35, so there
is no room for a tier between it and `--ink`: anything in that gap either fails
or is indistinguishable from `--ink`. The third dim colour the pages carried is
gone, and secondary prose is simply prose -- it was only ever dimmed because
bone on near-black glares, which cream does not.

**THERE IS NO SECOND RED.** On the dark ground alarm red and cathode orange were
different hues and told an error from a notice at a glance. Oxide *is* a brick
red, so any distinct alarm lands in the same hue and the two banners stop being
tellable apart. The alert takes the accent; the notice gives its accent up
entirely and is quiet ink on a plain lift. One red, and the error is carried by
weight and by words -- which also survives greyscale, as the old pair did not.

### Text on a photograph is not text on the ground

A place card's caption and a tape's status sit on the IMAGE, over a scrim of the
tape's own matte. They never touched `--paper` and they never will, so they must
not follow it: `--ink` over that scrim measures **1.06:1**. Three tokens belong
to the photograph instead, and the landing does not override them -- the image is
the same image on either ground.

| Token | Value | Role | Contrast |
|---|---|---|---|
| `--on-image` | `#FAF7F2` | captions on an image | 13.94:1 |
| `--on-image-soft` | `#CFC7BC` | their labels and dates | 8.90:1 |
| `--on-image-accent` | `#D98B7A` | struck, on an image | 5.62:1 |

Measured against the worst case the caption scrim can produce, which is a **pure
white** photograph under `rgba(11,10,9,.88)` -> `#282727`. Every real photograph
is darker than that, so these are floors and not averages.

### The tape on the cream ground

**A tape is dark 2003 camcorder footage, and this file had removed the three
tools anybody would reach for.** Decided deliberately on 2026-08-28, from three
options rendered against real posters: a paper mat inside each tile, the tape's
own black bled to the tile edge, or a warm tint over the still.

**The tint was refused on this file's own terms** -- imported photographs stay
untinted, "they are the subject; the world does not colour them", and the chrome
does neither content nor texture. A tint is the chrome grading the artifact.

**The choice is the bleed: nothing is drawn and nothing is softened.** The still
fills the tile, the dark is owned, and the caption sits below it on the paper.

**AND THE REAL DARK RECTANGLE WAS NOT THE FOOTAGE.** Measured on a 16-row sample
of a real render, rows 1-4 and 13-16 are luma `0`: the delivered 9:16 file is the
4:3 picture matted inside it, so **exactly half of every poster is letterbox**.
On `#070A11` those bars *were* the ground and nobody could see them, which is why
this went unnoticed until the pages moved. On paper they were 50% of every tile
and they were what made the shelf read as a wall of black slabs. The tile is
`aspect-ratio: 9 / 8` -- that middle half -- against the `object-fit: cover` it
already had. One declaration, no new markup, no reprocessing, and the burnt-in
date stamp survives because it sits inside the content band.

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
