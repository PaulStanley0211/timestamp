# Three aspect ratios — the plan

**Asked for:** 4:3, 9:16 and 16:9, with the picture **filling** the frame — no
letterbox bars. Paul, 2026-08-21, stated twice.

**Status:** planned, not started. Gating facts verified below.

---

## 1. The gating fact, checked first

`scripts/providers/fal.mjs` offers only 4:3 rasters:

```js
export const FAL_RESOLUTIONS = Object.freeze({
  '480p': { width: 640, height: 480 },
  '720p': { width: 960, height: 720 },
});
```

That looked like it might be a provider limit, which would have killed this
before it started. **It is not.** Seedance 2.0 on fal takes an `aspect_ratio`
parameter with the enum `auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16`, and resolution
`480p / 720p` on the fast tier. The 4:3-only shape in this repo is a *product*
decision from when the answer was "a camcorder tape is 4:3", and it is ours to
change.

## 2. What was already true, and what was not

**Already true, and it is what makes this tractable:** the tape filtergraph is
**parameterised, not hardcoded.** `scripts/tapedeck/look.mjs` reads
`tape.workWidth`, `tape.workHeight`, `tape.width` and `tape.height` out of
config for every dimension it computes — the jitter crop, the tear bands, the
head-switch strip. Nothing in the graph assumes 720x576.

**Not true, and it is the whole difficulty:** the *tuning* is in absolute
pixels, measured against a 576-high picture.

| Constant | Value | Unit |
|---|---|---|
| `transport.headSwitchHeight` | 14 | px from the bottom |
| `transport.tears[].y / .h` | 150 / 26, 302 / 18 | px within a 576-high frame |
| `osd.size / marginX / marginY` | 20 / 30 / 28 | px |
| `tape.chromaSmear`, `chromaShiftR` | 9, 2 | px |
| `optics.bloomRadius`, `cornerSoftenSigma` | 12, 2.2 | px |
| `optics.vignetteAngle` | `PI/12` | **angle — scales on its own** |

Change the raster's height and every row above except the last is wrong, subtly
and invisibly. That is the failure mode this plan exists to avoid.

## 3. The design: hold the short edge at 576

Every aspect keeps its **short edge at 576 pixels** and varies only the long
edge. That single constraint makes the whole problem go away.

| Aspect | Tape raster | SAR | Displays as | Delivery | Upscale |
|---|---|---|---|---|---|
| **4:3** | 720x576 | 16/15 | 768x576 | 1440x1080 | **1.875x** |
| **16:9** | 1024x576 | 1:1 | 1024x576 | 1920x1080 | **1.875x** |
| **9:16** | 576x1024 | 1:1 | 576x1024 | 1080x1920 | **1.875x** |

Three things fall out of this, and they are the reason to do it this way:

1. **Every pixel constant in the table above stays correct.** A 14px
   head-switch band is 14px of a 576-high picture in all three shapes. The OSD
   is the same size. The tears sit at the same depth. Nothing needs re-tuning
   and there is no second set of numbers to keep in sync.
2. **The upscale factor is identical — 1.875x in all three.** CLAUDE.md's rule
   is *grain before the upscale, never after*, because grain laid at 720x576 and
   scaled up gives clumps larger than a pixel (tape) while the same filter at
   1080 gives per-pixel noise (a modern sensor). Since the short edge always
   goes 576 → 1080, **the grain is not merely similar across aspects, it is
   arithmetically identical.**
3. **The 4:3 path does not move at all.** 720x576 at SAR 16/15 is the existing
   PAL contract, untouched, so the default output and the ~200 tests asserting
   it keep passing unchanged. Only the delivery composite changes.

### The 375-frame assertion is unaffected

It is temporal, not spatial: 25fps x 15s = 375 frames, in every aspect. Nothing
in this plan touches duration, frame rate, or the audio bed.

### What is genuinely lost, and it should be a decision not a side effect

Today the delivery is a 4:3 tape image **matted onto a 1080x1920 `#0B0A09`
canvas**, and `config/render.json` argues for that at length: pure black makes
the image read as a sticker on a void, `#0B0A09` reads as a dark surface the
image sits on, and the final vignette over the whole canvas is what fuses tape
and surround into one photographed object.

**"Picture fills the frame" deletes that.** There is no surround left to fuse
with. The 4:3 option becomes a plain 1440x1080 video. That is exactly what was
asked for, and it is a real loss of the thing that currently makes the output
look like a photographed object rather than a filter. Worth knowing before it
ships, not after.

*Possible reconciliation, if it turns out to matter:* keep the matted 9:16 as a
fourth option — "tape on a surface" — distinct from the three filling ones.
Cheap to keep, since it is the current code path.

## 4. What changes, in dependency order

1. **`config/render.json`** — `tape` and `delivery` become a map keyed by
   aspect, with the table above as its contents. Today they are single objects.
2. **`config/credits.json`** — each resolution row carries `width`/`height`/
   `raster`; these become per-aspect. Note the price question this reopens:
   the 720p estimate was derived at 1280x720 while the product requests 960x720,
   and the row already flags that the difference is unsettled. 16:9 makes
   1024x576 real, which is a third raster and a third price.
3. **`scripts/providers/fal.mjs`** — `FAL_RESOLUTIONS` gains the aspect
   dimension; the request body gains `aspect_ratio`. The existing assertion that
   plan.mjs, credits.json and fal.mjs agree on the raster must be extended
   rather than dropped.
4. **`scripts/animate/plan.mjs`** — `resolutionRaster(id)` becomes
   `resolutionRaster(id, aspect)`.
5. **`scripts/tapedeck/`** — no filtergraph change expected, because it is
   already parameterised. **This is the claim most worth being wrong about**, so
   it gets a purity run per aspect before anything else is believed.
6. **`scripts/render/job.mjs`** — `input.aspect`, defaulted to `4:3` so every
   existing manifest keeps meaning what it meant.
7. **`scripts/web/`** — the Frame row becomes a real control, with the three
   options and their `statehook` radios. The copy that currently says "nothing
   to choose here yet" comes out.
8. **Tests** — the contract assertions become per-aspect. The 4:3 ones should
   pass *unchanged*; if they do not, the design in §3 is wrong and this stops.

## 5. Order of work, and where it can stop

1. Config shape + `job.mjs` field, defaulted to 4:3. **Nothing renders
   differently.** All existing tests must still pass, untouched — that is the
   checkpoint that proves the refactor is inert.
2. `plan.mjs` + `fal.mjs` per-aspect rasters, with the three-way agreement test
   extended.
3. **Render all three through `--provider=fixture` and compare grain.** The
   claim in §3.2 is that grain is arithmetically identical; measure it rather
   than believe it. If it is not, stop here and re-tune before the UI exists.
4. Delivery composite: fill instead of matte.
5. The Frame control in the web layer, and the credit rows for any new price.

Steps 1–3 cost nothing and are reversible. Step 3 is the honest gate: it is
where this either works or turns into three sets of tuning constants.

## 6. Open, needs Paul

- **Does the matted 9:16 survive as a fourth option?** It is the current look
  and the surround argument is a good one.
- **Does 16:9 change the price?** 1024x576 is 590k pixels against 4:3 720p's
  691k, so it is *cheaper* per frame — but the fal estimate was derived at the
  nominal frame, not the raster, and that question is already open in
  `config/credits.json`. One metered run settles both at once.
- **Is 4:3 still the default?** It is the camcorder shape and the product's
  whole premise; 9:16 is what a phone wants.
