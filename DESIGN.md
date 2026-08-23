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

## Superseded

The frost-and-amber world (`--frost`, `--frost-lit`, `--hairline`, `#FFB700`,
the four-tier panel weight arc) is replaced. Do not reintroduce its panel boxes:
they are the borders this world forbids.
