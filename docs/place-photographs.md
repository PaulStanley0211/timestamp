# The place photographs, and how to make another one

Every place on the menu ships one photograph, `assets/places/<id>.jpg`, and one
six-second graded loop cut from it, `assets/places/<id>.mp4`. The photograph is
the card on the order form and the ground behind the landing page. **It never
reaches a model** -- the reference the tape is made from is always the
customer's own upload -- so it can be whatever picture best sells the place.

The owner generates them in **Higgsfield Soul Cinema** (his choice, tested and
free to him; section 10 of CLAUDE.md records why the terms allow it and why the
same terms forbid using Higgsfield as the product's backend). The first eight
prompts were never written down. These are the four from 2026-09-04, kept so
the next one is written the same way.

## The rules a prompt follows

- **16:9, 2048x1152.** The card and the loop are both `cover` over a 16:9
  frame; a portrait picture loses two thirds of its width (section 10).
- **Nobody in frame.** The person is the customer, and they are not in the
  picture until the tape is made.
- **No readable text, signs or logos.** `BASE_NEGATIVES` forbid lettering on
  the tape for a reason -- a model invents unreadable words that read as
  generated -- and the card should match the tape. This is also why a famous
  place is a street or a shoreline and never a sign.
- **No tape words.** No VHS, grain, film, retro, nostalgic. The loop is graded
  through the real tape chain (`scripts/tapedeck/place-loops.mjs`), so a
  photograph that already carries a look gets it twice.
- **Written off the preset.** Scene, light, lens and era props come from
  `presets/places/<id>.json`, so the card and the tape describe the same
  afternoon.

## The four prompts, 2026-09-04

**A rule that bent, and how far.** The first drafts of New York and Tokyo were
a brownstone side street and a lantern-lit back street, on the argument that a
famous place is a street and not a sign. The owner asked for Times Square and
a lit crossing -- the places as everybody knows them -- and he was right that
those are the pictures people forward. The rule survives one layer down: the
tape prompt still forbids readable words and brand logos, so on the tape the
billboards are lit colour panels rather than adverts, and each preset's
negatives say so twice. On the CARD, Higgsfield invents lettering whatever the
prompt says; it took three tries for Times Square and the best of them still
carries gibberish on the billboards, which is invisible at card size and
accepted at full bleed. Every prompt below ends with the line that finally
emptied the pavements.

### `new-york-times-square`

> Photorealistic photograph, Times Square in New York at night in 2003, the
> wedge of tall buildings above 42nd Street stacked with towering illuminated
> billboards and glowing video screens in red and blue and white, yellow cabs
> with roof lights lined up at the lights and a police kiosk on the traffic
> island, wet pavement and crosswalk stripes reflecting every screen, the
> whole square lit from above by the billboards with cold white spill from the
> screens and warm sodium from the street lamps, a hot-dog cart under a
> striped umbrella and a payphone bank and a newspaper vending box on the
> corner, electric overwhelming turn-of-the-millennium big-city energy, wide
> from the pavement looking up the square with the far end going soft, slight
> barrel bend at the edges, natural colour, no people, billboards as abstract
> colour panels with no readable words or brand logos, no modern cars or LED
> wraparound screens or smartphones, landscape 16:9, the hot-dog cart standing
> alone with no vendor, every billboard and screen a plain colour panel or
> abstract picture with no lettering, words, numbers or faces of any kind

### `tokyo-night`

> Photorealistic photograph, the Shibuya scramble crossing in Tokyo at night
> in 2003, the wide five-way intersection ringed by tall buildings faced with
> glowing video screens and vertical illuminated signboards in white and red
> and blue, taxis with roof lights waiting at the lights and a train bridge
> crossing the far side, wet asphalt and white crosswalk stripes reflecting
> every screen, the whole crossing lit from above by the screens with cold
> white light and warm spill from the shopfronts below, a lit drinks vending
> machine and a payphone booth and a bicycle with a front basket at the
> corner, dense electric turn-of-the-millennium Tokyo energy, wide from the
> pavement looking across the empty crossing with the far buildings going
> soft, slight barrel bend at the edges, natural colour, no people, screens
> and signboards as abstract colour panels with no readable characters or
> brand logos, no modern cars or smartphones, landscape 16:9, nobody anywhere
> in the picture, every sign or panel a plain colour with no lettering, words,
> numbers or faces of any kind

### `amalfi-afternoon`

> A photograph of a small harbour on the Amalfi coast in the afternoon. Pastel
> houses stacked up the cliff behind it, a pebble beach with rows of striped
> umbrellas and wooden loungers, wooden fishing boats pulled up on the stones,
> lemon trees along a terrace wall, the sea flat and deep blue. Hard afternoon
> sun coming off the water, the white houses almost blown out, deep shadow
> under the umbrellas and inside the arches, moving light off the sea on the
> boat hulls. A scooter with a chrome mirror parked on the harbour wall, a
> paper cone of fried fish and a paper cup of gelato with a flat wooden spoon
> left on the wall. Shot wide with a lot of sea and cliff in it, the near
> boats sharp and the cliff going soft, the far houses shimmering a little in
> the heat. Nobody in the picture. No readable text or signs, no modern
> yachts, no crowds, no aerial view. Landscape 16:9.

### `space-centre`

> A photograph of the visitor grounds of a space centre on a clear day at
> midday. A white rocket standing upright on its display stand across a wide
> lawn, a low rope barrier and a chain-link fence in front of it, a concrete
> path, a row of floodlight masts, a souvenir kiosk with a striped canopy, a
> coach park glinting beyond with a 1990s coach with a curved windscreen and a
> roof-mounted air conditioner. Hard sun straight down, the white rocket
> almost blown out against a deep blue sky, short shadows, the concrete apron
> bright. On a bench by the path a disposable camera, a folded visitor map, a
> drink carton with a straw, a souvenir model rocket in a cardboard box. Shot
> wide and low with the rocket filling the frame, the sky one big flat block,
> slight bend at the edges. Nobody in the picture. No astronauts, no launch,
> no readable text or flags, no smartphones, no modern electric vehicles.
> Landscape 16:9.

## After the photograph lands

Higgsfield hands back a PNG at 1696x960 with a generated filename. Convert it
to a metadata-free JPEG under the preset's id (the first eight were 2048x1152;
1696x960 is plenty for a 272px card and a 1024x576 loop):

```bash
ffmpeg -i ~/Downloads/hf_<whatever>.png -map_metadata -1 -q:v 3 assets/places/<id>.jpg
cp assets/places/loops.json build/place-loops/loops.json   # the cutter merges into the BUILD copy
node scripts/tapedeck/place-loops.mjs --only=<id>          # cuts the loop, measures its luma
cp build/place-loops/<id>.mp4 build/place-loops/loops.json assets/places/
```

The second line matters: the cutter reads and writes `build/place-loops/loops.json`,
not the shipped one, so without seeding it from `assets/places/loops.json` a
`--only` run merges into whatever stale manifest the build directory holds.

`loops.json` carries each loop's mean luma, which the page reads to solve a
per-place scrim (section 30). A place with no entry gets the full-strength
scrim, which is a supported state and a worse-looking one. The generator
merges rather than overwrites, so `--only` never drops the other places.

A retired place is never deleted from `RETIRED_PLACE_LABELS` in
`scripts/catalog/catalog.mjs`, and its id is never reused: a tape somebody
made there keeps its caption.
