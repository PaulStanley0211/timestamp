# PRODUCT.md — Timestamp

Durable product truth. Visual decisions live in DESIGN.md; this file is what any
design must stay true to.

## The product in one sentence

Upload one photograph of your own face, choose a place and an outfit, and get
back fifteen seconds of video that looks like it was found on a camcorder tape
from 2003.

## The mechanism, which is the whole architecture

**The model does content; ffmpeg does texture.** A generation model produces a
plausible person in a plausible place wearing plausible clothes. Every tape
artefact — chroma bleed, grain, the head-switch band at the bottom of the
frame, the burnt-in date stamp, transport jitter — is applied deterministically
in ffmpeg afterwards.

This is not an implementation detail. Ask a video model for "VHS 2003" and it
returns a nostalgic *mood*; it does not return tape artefacts. Because the look
is deterministic it is free to tune, identical every run, and it is the
product's actual differentiator. **The interface must never imitate it.** Tape
texture in the chrome competes with the artifact instead of framing it.

## Audience

**Anyone who wants a made memory** — not a German-nostalgia audience. The place
presets are German by name (Schrebergarten, Plattenbau stairwell, Ostsee beach,
Autobahn services) but they are *set dressing chosen for their ordinariness*,
not a cultural target. The proposition is "you, somewhere ordinary, in a decade
that looks warmer than now."

Consequence for design: a German institutional visual world would read as
arbitrary theming to most buyers. The world must come from objects the
pre-digital family archive shares across countries.

## The obstacle the first surface must overcome

**"Will it actually look real?"** The buyer's doubt is that this produces AI
slop with a filter over it. Not safety, not desire — credibility of the
artifact.

Consequence for design: **the tape leads from the first viewport.** The artifact
plays before any control is offered, and the interface recedes to a frame around
it. A landing page that explains before it shows has already lost the argument.

## What the visitor actually does

1. Upload one photograph of their face (the only irreversible act)
2. Choose an outfit from six presets, or describe one
3. Choose a place from eight presets, upload a photo of one, or describe one
4. Choose a frame shape (4:3, 16:9, 9:16), a quality, and how many stills to
   choose from; consent; record
5. Pick the still where their likeness survived, before any video is paid for
6. Receive the tape; it appears on an archive shelf

## Product truths that constrain any design

- **Fifteen seconds exactly.** 25fps × 15s = 375 frames, asserted by ~200 tests.
- **Three frame shapes.** 4:3 is the camcorder shape and the default; 9:16 is
  full-bleed for Reels and TikTok; 16:9 is landscape for YouTube. The delivered
  file IS the shape chosen.
- **The still is a rejection gate, not a feature.** A likeness the visitor
  dislikes costs cents; a tape costs dollars. The gate exists so a bad face
  never becomes a paid tape.
- **The prompt says nothing about the person.** Only "the person in the
  reference image". Any demographic adjective blends with the photograph and
  produces "that isn't me, it looks like my cousin" — and it is a demographic
  assumption about a stranger who uploaded their face.
- **Photographs are stripped and expire.** EXIF and GPS removed on intake;
  photo deleted after 7 days, video after 30. This is promised in the consent
  text and implemented.
- **Credits, not subscriptions in code.** The app contains no payment code at
  all. Pricing is described, never sold.

## Hard technical constraints on any interface

- **Zero npm dependencies.** Node 22+, ESM, `node --test`. The web layer is
  `node:http`, not Next.js. No React, no Tailwind, no CSS framework, no build
  step.
- **No inline styles anywhere.** The CSP is `style-src 'self'` with no
  `unsafe-inline`. Every value must be in the generated stylesheet.
- **Selection is CSS-only.** Radio inputs are hoisted to the top of `<body>` and
  drive `:checked ~ .wrap` rules. They must stay `position: fixed`;
  `position: absolute` reintroduced a measured 1641px scroll jump.
- **Server-rendered HTML.** One inline progressive-enhancement script exists;
  the app is otherwise scriptless and must keep working without it.

## Assumptions, labelled

- That the landing page is where the new world proves itself first was chosen by
  the owner; the signed-in app page is the harder test and still has to inherit
  it.
- Pricing figures throughout the app are ESTIMATES until one metered run.
