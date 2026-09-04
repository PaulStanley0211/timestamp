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

### `new-york-autumn`

> A photograph of a quiet Manhattan side street in autumn, late afternoon.
> Brownstone stoops with black iron railings, a fire escape zigzagging up old
> brick, plane trees dropping yellow leaves onto parked cars from around 2003,
> steam rising from a grating in the road. A yellow cab with a roof light
> passing at the far end of the block. Low sun coming down the cross street
> from one side, long shadows across the pavement, the far end already in
> shade with a few windows lit. On the corner a payphone in a steel hood, a
> newspaper vending box, a hot-dog cart under a striped umbrella. Shot on a
> consumer zoom at its wide end, the far cab going soft, slight bend at the
> edges. Nobody in the picture. No readable text, signs or logos, no modern
> cars, no glass skyscrapers, no digital billboards. Landscape 16:9.

### `tokyo-night`

> A photograph of a narrow back street in Tokyo at night. Red and white paper
> lanterns hung along the eaves of low wooden-fronted eateries, a tangle of
> power lines overhead, a lit drinks vending machine on the corner, wet
> asphalt holding every light, a bicycle with a front basket leaning on a
> pole, a plastic umbrella hooked on its handlebar. The lanterns are the main
> light, warm red and orange from just above head height, a cold white spill
> from the vending machine cutting across it, everything above the wires going
> to black. Shot wide and close in the narrow street, the far end lost behind
> the lanterns, every light a hard point, slight bend at the edges. Nobody in
> the picture. No readable text or lettering on the lanterns or the machine,
> no neon signboards, no LED screens, no skyscrapers, no daylight. Landscape
> 16:9.

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

```bash
node scripts/tapedeck/place-loops.mjs --only=<id>   # cuts the loop, measures its luma
cp build/place-loops/<id>.mp4 assets/places/
cp build/place-loops/loops.json assets/places/
```

`loops.json` carries each loop's mean luma, which the page reads to solve a
per-place scrim (section 30). A place with no entry gets the full-strength
scrim, which is a supported state and a worse-looking one. The generator
merges rather than overwrites, so `--only` never drops the other places.

A retired place is never deleted from `RETIRED_PLACE_LABELS` in
`scripts/catalog/catalog.mjs`, and its id is never reused: a tape somebody
made there keeps its caption.
