# The look

Everything the tape aesthetic does, why it is in that order, and what each knob in `config/look/base.json` actually changes.

**Read the ordering section before you reorder anything.** Several of the swaps that look like tidying are visually catastrophic, and three of them are catastrophic in ways that do not show up as an error — only as output that quietly stops being convincing.

---

## The order is a signal path, not a preference

Every stage sits where its physical counterpart sat in a real camcorder:

```
lens → CCD → camera DSP → character generator → tape encoder → tape → playback transport → display
```

| # | Stage | Filters | Why here |
|---|---|---|---|
| 1 | Source conditioning | `fps`, `select`, `crop`, `scale` to 736×588 | Everything downstream must operate at tape resolution or it is not modelling tape |
| 2 | **Lens — halation** | `curves`, `gblur`, `blend=screen` in **gbrp** | Bloom is optical. It happens in the glass, before any electronics |
| 3 | **Lens — falloff** | `maskedmerge` with a static radial mask, `vignette` | Cheap optics, also before the sensor |
| 4 | **Camera DSP — the grade** | `curves`, `colorbalance`, `eq` | After bloom so lifted blacks are not re-crushed; before tape so the tape degrades a graded image |
| 5 | **The domain boundary** | `format=yuv420p` | See below. Load-bearing |
| 6 | **Character generator** | `drawtext` ×2 | The date was written into the signal *before* the tape |
| 7 | **Tape encoder** | `gblur` luma, `gblur` chroma, `chromashift` | Where bandwidth is thrown away |
| 8 | **The medium** | `noise` | Grain lives on the tape |
| 9 | **Playback transport** | jitter `crop`, tear `overlay`s, head-switch band | Mechanical, and it happens on replay |
| 10 | Display | `setsar`, `scale` to 1080×810, `overlay` on the canvas, final `vignette` | Delivery |

### The four reorderings that break it

**Grain after the upscale instead of before.** Grain laid down at 720×576 and then scaled to 1080 produces clumps larger than a pixel — tape. The identical filter with identical parameters applied at 1080 produces fine per-pixel noise, which is a modern sensor at high ISO. Same code, wrong decade. This is the swap that most obviously destroys the illusion, and it is also the one most likely to be made by someone consolidating filters "for efficiency".

**Bloom after the grade instead of before.** Reversed, you crush the blacks and then add a glow that lifts them again — so the milky-black grade is partially undone, and the bloom keys off graded values rather than scene light.

**The date stamp after the tape stage instead of before.** A crisp, sharp date over a degraded image is the single most common tell of a fake VHS filter. On a real camcorder the character generator wrote the date into the signal before it reached the tape, so the stamp suffered chroma bleed, softness and grain like everything else — but never lens artifacts, because it was added after the glass. Stage 6 is the physically correct position and it is also the one that looks right.

**Chroma smear before the stamp, or after the grain.** Before the stamp and the date stays colour-crisp while everything around it bleeds. After the grain and you are smearing noise into mush rather than smearing chroma that noise then sits on top of.

### The domain boundary (stage 5) — do not remove it

`curves` and `colorbalance` are RGB filters. ffmpeg silently auto-inserts a conversion, so **everything downstream of the grade inherits `rgb24`** unless the format is pinned. That is wrong twice over:

- The tape stage is defined in terms of chroma. `gblur=planes=6` means "planes 1 and 2" — in RGB those are **blue and red**. The signature chroma smear was quietly blurring colour channels instead of chroma, and `chromashift` was a no-op.
- Each transport `overlay` then round-trips through overlay's own `yuv420` working format, and the accumulated range mismatch **crushed mean luma from 133 to 26**. A five-fold darkening, with no error and no warning.

One `format=yuv420p` after `eq` fixes all three. `test/tapedeck-look.test.js` asserts its position.

---

## The knobs

### `optics` — the lens

| Knob | Perceptually |
|---|---|
| `bloomThreshold` | How bright a thing must be before it glows. **Lower** = more of the frame blooms. A night kitchen wants ~0.58 so the one bulb genuinely flares; a bright beach wants ~0.86 so only specular glints do |
| `bloomRadius` | Spread of the glow in pixels. Large reads dreamy, small reads like a tight halo |
| `bloomStrength` | Glow opacity. Above ~0.55 it stops looking like halation and starts looking like fog on the lens |
| `bloomWarmth` | Amber tint of the glow itself |
| `cornerSoftenAmount` | How fast sharpness dies toward the corners |
| `cornerSoftenSigma` | How blurred the corners get at full weight |
| `vignetteAngle` | **Measured, and much stronger than it looks.** `PI/4.3` costs 45% of mean luma, `PI/12` costs 20%, and even `PI/20` still costs 18%. There is no subtle setting. It also runs twice — here and again over the whole canvas — so the losses compound, and `grade.curveMaster` carries the compensation. **Re-measure before raising it** |

### `grade` — the camera's own processing

| Knob | Perceptually |
|---|---|
| `curveMaster` | The most important string in the file. Starting at `0/0.06` is the **milky black floor** — consumer tape never reached true black, and crushing it to zero is the fastest way to look like a modern camera wearing a filter. Ending below `1/1` rolls the highlights off |
| `curveRed` / `curveBlue` | Warm the mids, pull blue out of mids and highs. Leave a little blue in the shadows or it goes sepia-postcard |
| `cbRedMid` / `cbBlueMid` | Amber push in the midtones — this is where skin warmth comes from |
| `cbRedShadow` / `cbBlueShadow` | A slight cool in the blacks is what stops the warm grade tipping into nostalgia-filter |
| `saturation` | Below 1 = faded dye. Under about 0.7 it starts reading as nearly black-and-white |
| `contrast` / `gamma` | Fine adjustment. Large moves here fight `curveMaster` — change the curve instead |

### `tape` — the encoder and the medium

| Knob | Perceptually |
|---|---|
| `lumaSoftness` | VHS carried roughly 3 MHz of luma against broadcast's 5.5, so the picture was soft **everywhere**, not merely at the corners. Leaving this at 0 is what makes the chain read as "warm film in a letterbox" rather than as tape — bicubic resampling is far kinder than a helical scan head |
| `chromaSmear` | The star of the chain. VHS chroma bandwidth was about a tenth of its luma bandwidth, which is why colour visibly runs off lips and brake lights. Above ~8 red starts visibly leaving the mouth |
| `chromaShiftR` / `chromaShiftB` | Opposite signs give the directional colour fringe on hard edges |
| `grainStrength` | Applied at 720×576 so it upscales into clumps. Above ~25 reads as a heavily worn tape |

### `transport` — playback mechanics

| Knob | Perceptually |
|---|---|
| `jitterX` / `jitterY` | Horizontal and vertical wobble. This is why the work raster is 736×588 rather than 720×576 — the jitter needs headroom to steal from, or it exposes a hard frame edge |
| `headSwitchHeight` | The constant noise band along the very bottom. **The single most recognisable VHS tell**, and it must never blink off. Set to 0 to disable entirely |
| `headSwitchShift` / `headSwitchNoise` | Offset and harshness of that band |
| `tears` | Sparse dropouts — one or two across the whole 15 seconds. The right sparsity is "noticeable once, then again just as you had forgotten". Constant tearing reads as a broken file, not as a tape |
| `droppedFrames` | Frame indices held an extra frame. A stutter with no change in duration or frame count |

### `osd` and `composite`

The date stamp is a **literal string computed in Node from the seed** — never `%{localtime}`, which reads the wall clock and destroys reproducibility, and never `expansion=strftime`, which is deprecated in this build. The one-pixel shadow is not decoration: after the tape stage has decimated the chroma, grained the glyphs and dragged them through a 1.5× anamorphic upscale, unshadowed text at this size loses its edges entirely.

`composite.finalVignetteAngle` applies to the **whole 1080×1920 canvas**, tape image and surround together. That is what fuses them into one photographed object rather than two stacked layers, and it is the move that actually sells the letterbox.

---

## How to tune

Never by eye on a single render — the eye adapts within seconds and everything starts to look normal. Always by comparison:

```bash
npm run look -- --in=assets/stock/porch.mp4 --name=grain --sweep=tape.grainStrength=8,14,20,28
```

One render per value, one changed variable, viewed together. Then open `before-after.mp4`, which puts the clean source beside the graded result — the only reliable way to see what the grade is actually doing.

Two cautions. **Judge on a real clip with a person and skin tones**, not on `testsrc2`: synthetic colour bars are fully saturated primaries and they hide exactly the failures that matter, because the grade barely moves them. And **judge at least one dark scene and one bright one** — the values that flatter golden hour will look muddy in a kitchen at night, which is precisely why places carry per-preset `LookProfile` overrides.
