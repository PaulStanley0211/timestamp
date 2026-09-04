# PRODUCT.md — Timestamp

Durable product truth. Visual decisions live in DESIGN.md; this file is what any
design must stay true to.

## The product in one sentence

Upload one photograph of your own face, choose a place and an outfit, and get
back fifteen seconds of video that looks like it was found on a camcorder tape
from 2003.

**A NOTE ON "WARM, GRAINY, QUIET", which is how this product described itself
until 2026-08-24.** The picture is no longer quiet: it cuts six times in fifteen
seconds and the camera walks. That was a deliberate change of direction by the
owner, not drift. **The TEXTURE is still warm, grainy and quiet** -- the bed
sits at -27 LUFS and every tape artefact is unchanged. What moved is the
content: the tape is now somebody's vlog rather than somebody's held breath.

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

**Anyone who wants a made memory** — not a German-nostalgia audience. Four of
the place presets are ordinary (a garden, a kitchen table, a living room, a
beach out of season) and four are famous (a New York side street, a Tokyo back
street, the Amalfi coast, a space centre); the ordinary ones are *set dressing
chosen for their ordinariness*, not a cultural target, and the famous ones are
streets and shorelines rather than signs. The proposition is "you, somewhere
you remember or somewhere everybody knows, in a decade that looks warmer than
now."

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

**FOUR CHOICES AND A TAPE. Restated by the owner four times on 2026-08-24 and
built the same day:**

1. Upload one photograph of their face (the only irreversible act)
2. Choose an outfit from six presets, or describe one
3. Choose a place from eight presets, upload a photo of one, or describe one
4. Choose a frame shape (4:3, 16:9, 9:16) and a quality; consent; record
5. Receive the tape; it appears on an archive shelf

**There is no still to approve, and no picture the visitor ever meets.** The
owner's words: *"I don't understand why are you generating the pictures."*

The still was never wanted for its own sake -- it existed because `animate` is
image-to-video and needs a start frame, which made it structural rather than a
feature. `bytedance/seedance-2.0/reference-to-video` takes the photographs
themselves, so the stage stops existing rather than being hidden.

**The old path still works and is still the CLI default**, because whether that
endpoint holds a likeness as well as the still endpoint does has been proven
exactly once. Direct mode is `--direct`.

## Product truths that constrain any design

- **Fifteen seconds exactly.** 25fps × 15s = 375 frames, asserted by ~200 tests.
- **Three frame shapes.** 4:3 is the camcorder shape and the default; 9:16 is
  full-bleed for Reels and TikTok; 16:9 is landscape for YouTube. The delivered
  file IS the shape chosen.
- ~~**The still is a rejection gate, not a feature.**~~ **SUPERSEDED
  2026-08-24, deliberately and with the cost stated.** The gate meant a likeness
  the visitor disliked cost cents instead of dollars. It is gone because four
  choices and a tape is the product, and a picture to approve is not one of the
  four. **The consequence is real and was accepted knowingly: a miss now costs a
  whole video (~$4.54 estimated) instead of $0.04, and the visitor finds out
  afterwards.** The order that made this safe was always "solve identity first,
  then hide everything" -- and identity was confirmed on the still endpoint the
  same morning.
- **Fifteen seconds is a SHOT LIST, not one continuous take.** Six beats off the
  seedance-prompt skill's own table -- arrive, look around, notice a thing, do
  the thing, react, settle. The owner rejected the first single-take tape for
  pacing: *"no engagement, no enthusiasm ... placing the bottle is taking five
  to six seconds."* In-camera cuts are period-honest anyway; a 2003 tape is full
  of them because you pressed record and stopped again.
- **The bed knows where it is.** Every place carries its own synthesised
  ambience -- surf, motorway rumble, a tiled echo, a fridge -- on top of the
  hiss and the capstan. Measured at -26.4 to -27.1 LUFS against a -27 target, so
  the place is felt rather than heard.
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
