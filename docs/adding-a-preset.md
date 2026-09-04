# Adding a preset

A preset is fourteen lines of JSON and about twenty minutes. The schema will
reject roughly half of a first draft, on purpose — this page is mostly about
why, because the rejections are the part that looks arbitrary until you have hit
one.

```bash
cp presets/_template/place.json presets/places/my-place.json
# edit it
npm run presets                                     # loads and validates the whole menu
npm run compose -- --place=my-place --outfit=trainingsjacke
node --test test/catalog-schema.test.js
```

`presets/_template/place.json` and `presets/_template/outfit.json` are working
presets, not sketches — a test validates them exactly as it validates a shipped
one, so the example you start from is guaranteed legal. Every field is
documented by the `_<field>` key immediately above it, the same
documentation-inside-the-JSON convention `config/render.json` uses. Any key
beginning with `_` is documentation: it is stripped before any merge and skipped
by every vocabulary scan, so a `_comment` may safely name the words its value
must not use.

---

## The world

**1999–2005, on a camcorder. Warm and ordinary, wherever it is.**

The product is the era and the medium, not a country (CLAUDE.md §42F). Not
liminal-empty-mall melancholy either. The register is someone's actual home
video: a garden in late summer, a kitchen at breakfast, a grey beach out of
season. Nothing dramatic is happening. The feeling is "this was a normal
afternoon and it is gone".

Half the menu is ordinary and half is famous (§60I): a garden, a kitchen table,
a living room and a beach beside a New York side street, a Tokyo back street,
the Amalfi coast and a space centre. **A famous place is a street or a
shoreline, never a sign.** `BASE_NEGATIVES` forbid text and logos because a
model invents lettering that reads as generated, so New York is a brownstone
block with a cab at the end of it rather than Times Square. The era still comes
from named objects: CRT televisions, wired phones, payphones, disposable
cameras, flip phones, estate cars with roof boxes, plastic garden furniture.

If a preset needs something to happen in it, it is the wrong preset.

---

## The three rules, and what they cost you

### 1. Never describe the person

No face, hair, skin, age, build or gender words, anywhere, in either kind of
preset. The uploaded photo is the identity anchor.

An identity-preserving model receives two conditioning signals: the reference
photo and the text. They are not additive — the model reconciles them, and
reconciling a photograph of a specific face with "a slim young man with short
dark hair" produces a face that is a blend. The blend is always plausible and
always slightly wrong, and the user's reaction to slightly wrong is not "the
model is imperfect", it is *"that isn't me, it looks like my cousin"*.

It is also a demographic assumption about someone the system never saw, applied
at generation time. There is no wording of that which is acceptable.

`composeStillPrompt` has no parameter for a subject description, and a test
asserts that anything a caller invents is ignored rather than concatenated.

### 2. Outfits describe the body. Places describe everything else

Enforced in both directions:

| File | May not contain |
|---|---|
| `presets/outfits/*.json` | scene, light, weather, lens, time-of-day vocabulary |
| `presets/places/*.json` | wardrobe vocabulary |

This is not tidiness. Both fragments are concatenated into one prompt and a
model has no notion of which clause outranks which. An outfit saying "on an
overcast day" and a place saying "low late-August sun" average into a frame lit
by neither — the parka-on-a-beach-lit-like-a-beach failure. The only way to
guarantee the fragments cannot fight is to make it structurally impossible for
them to talk about the same thing.

**Weather intent goes in `climate`, not in prose.** That is what the field is
for, it is what `checkCompatibility` reads, and it is why season words
(`winter`, `summer`) are *allowed* in an outfit: "padded winter jacket" is a
garment category, not a claim about the frame.

### 3. Never ask the model for the look

No `VHS`, `grain`, `grainy`, `vintage`, `film grain`, `camcorder`, `retro`, `old
video`, `8mm`, `lo-fi`, `analogue`, `cinematic`, `degraded`, `washed out` — in a
prompt **or in a negative**.

The texture is applied deterministically in ffmpeg by `scripts/tapedeck/`, where
it is a number in `config/look/base.json` that can be swept for free. Asking a
model for it buys a vague nostalgic mood that varies from generation to
generation and then fights the real chain. Negatives are included because "no
film grain" is still the words *film grain* in the conditioning, and because a
negative is exactly where a tired author hides the word they were told not to
use.

**The era belongs in a preset as CONTENT.** The cut of a garment, a CRT in the
corner, the shape of a car, the label on a bottle. Name the object, never the
texture.

---

## Judgement calls already made

Re-litigating these costs an afternoon each. They are argued at length in the
header of `scripts/catalog/schema.mjs`.

| Word | Status | Why |
|---|---|---|
| `filter` | **allowed** | "a filter coffee machine" is one of the best 2003 German kitchen props available. "vhs filter" is caught by `vhs`. |
| `faded`, `yellowed` | **allowed** | "sun-faded plastic chairs", "net curtains gone yellow" describe an object's physical condition. `faded colours` and `washed out` are banned — those describe the picture. |
| `old` | **allowed** | "an old Opel estate" is the point. `elderly` is banned, and "an old man" is caught by `man`. |
| `hand` | **allowed** | Not an identity-blending adjective. `extra fingers, warped hands` is a defect guard every negative needs, and `hand-held` is legitimate camera direction. |
| `winter`, `summer` | **allowed in outfits** | Garment categories. `climate` carries the weather intent. |
| `tall` | **banned** | Person height. Write "a high hedge", "long grass". |
| `evening` | **banned in outfits** | If you need "evening dress", call it a formal dress — an outfit must not imply a time of day. |

Word boundaries are respected, so `German`, `chairs`, `sundress`,
`windbreaker`, `stonewashed` and `packaged` are not false positives. There is a
test that says so, and if you hit one that *is* a false positive, fix the
matcher in `schema.mjs` rather than rewording around it.

---

## The two fields that are not prose

### `motionHint` — for the animate stage

Every place implies its own motion, and the animate stage has nothing else to go
on. Laundry lifting on a line, traffic passing behind, a water surface, a
fluorescent tube flickering, steam off a cup.

Ambient and repeating, never an event. Nothing dramatic happens in this product,
and a motion hint that stages something is the fastest way to lose that.

### `lookOverride` — for `tapedeck`

A **partial** LookProfile, deep-merged over `config/look/base.json` by
`mergeLook()`. A night interior wants markedly more grain and more amber than an
overcast beach; that difference is the entire reason the field exists.

Three things will bite you:

1. **Every path you name must already exist in `base.json`.** The schema checks,
   because `mergeLook` is a schema-free deep merge: `tape: { grainStrengh: 30 }`
   does not throw, it adds a key nothing reads. The render succeeds, the grain is
   unchanged, and you conclude the override "doesn't do much".
2. **Values must sit inside `CLAMPS` in `scripts/tapedeck/look.mjs`**, or
   `loadLookProfile` pulls them to the edge and prints that it did. A test
   asserts no shipped preset is clamped.
3. **Watch the sign on `colorbalance`.** `bm` *negative* adds **yellow**. Raising
   `cbBlueMid` towards zero makes a scene **cooler**, not warmer. This is
   counter-intuitive and it is why `plattenbau-treppenhaus` and `ostsee-strand`
   both carry a note about it.

An empty `{}` is a perfectly good answer for a scene the base profile suits.

---

## Compatibility is a note, never a refusal

`checkCompatibility` compares the place's single `climate` against the outfit's
`climate[]` on a five-point scale — `cold 0, cool 1, mild 2, warm 3, indoor 3` —
and warns only at a distance of two or more.

One step apart is silent on purpose: a tracksuit jacket on a cold beach is a
normal thing a person does, and a checker that fires on a third of the menu is a
checker everyone learns to ignore, at which point it is worse than nothing.

It never refuses, because a padded winter jacket in a heated living room at
night is a person who just got home, and that is a better video than either
sensible option. Ten of the current forty-eight combinations carry a note.

---

## Before you commit

```bash
npm run presets                       # the menu loads and prints
npm run compose -- --all              # every combination, read it through
node --test test/catalog.test.js test/catalog-schema.test.js test/compose-prompt.test.js test/seed.test.js
```

Read the `--all` output. Judging one prompt in isolation is nearly impossible;
forty-eight side by side make a fragment that reads oddly in half the menu
obvious in about a minute. This is the same argument as `npm run look --sweep`,
and it costs nothing — no command on this page contacts a provider.

**Editing a preset changes the catalog hash**, including editing a `_comment`.
That is deliberate: the hash is what a render manifest records to prove which
version of the menu produced a given video, and two catalogs whose documentation
differs are not the same catalog. Old renders stay reproducible only through the
manifest's frozen `resolved` block — never strip it to tidy a manifest.
