/**
 * The look. This module builds a filtergraph string and nothing else -- it does
 * not spawn, read, or write. That purity is what lets the entire aesthetic be
 * asserted with golden strings in milliseconds, and it is why `npm run look`
 * can iterate the look for free while the expensive half of the pipeline does
 * not yet exist.
 *
 * THE ORDER IS THE SIGNAL PATH OF A REAL CAMCORDER, and every stage sits where
 * its physical counterpart sat:
 *
 *   lens -> CCD -> camera DSP -> character generator -> tape encoder -> tape
 *        -> playback transport -> display
 *
 * Reordering is not a matter of taste. Three of the swaps are actively
 * destructive and worth naming, because each looks harmless:
 *
 *   Grain after the upscale instead of before. Grain laid down at 720x576 and
 *   then scaled to 1080 produces clumps larger than a pixel -- tape. The very
 *   same filter with the very same parameters applied at 1080 produces fine
 *   per-pixel noise, which is a modern sensor at high ISO. Same code, wrong
 *   decade. This is the reorder that most obviously breaks the illusion.
 *
 *   Bloom after the grade instead of before. Halation is optical: it happens in
 *   the glass, before any electronics. Run it after the grade and you crush the
 *   blacks, then add a glow that lifts them again, so the milky-black grade you
 *   just applied is partially undone and the bloom keys off the wrong values.
 *
 *   The date stamp after the tape stage instead of before. See burn-in.mjs --
 *   a crisp stamp over a degraded image is the signature of a fake.
 *
 * Two performance and correctness landmines are already defused here:
 *
 *   The corner-soften mask is precomputed as ONE static frame via geq and
 *   applied with maskedmerge. The obvious implementation -- a radial
 *   `blend=all_expr=` -- costs 18 of 22 seconds on a 15s render, because the
 *   expression is evaluated per pixel per frame. Static mask plus maskedmerge
 *   is 23x faster for the same result. Note it must NOT be repeated with
 *   `loop`, which floods "non monotonically increasing dts"; one frame plus
 *   framesync repeatlast holds it correctly.
 *
 *   Bloom runs in gbrp, not yuv420p. `blend=all_mode=screen` in YUV screens the
 *   chroma planes too, and since chroma neutral is 128, screen(0.5,0.5)=0.75
 *   pushes neutral grey to 191 -- measured saturation goes UP 16%, which is
 *   backwards, because real halation desaturates blown highlights.
 */

/** Clamp ranges live in code, not in base.json, so that the JSON stays readable
 *  and hand-editable. Out-of-range values are pulled to the edge with a warning
 *  rather than throwing: a look profile is a creative document, and a render
 *  that says "I clipped your grain to 40" is more useful than one that refuses. */
export const CLAMPS = {
  'optics.bloomThreshold': [0.3, 0.98],
  'optics.bloomRadius': [1, 40],
  'optics.bloomStrength': [0, 1],
  'optics.bloomWarmth': [0, 0.5],
  'optics.cornerSoftenAmount': [0, 2],
  'optics.cornerSoftenSigma': [0, 8],
  'grade.cbRedMid': [-0.5, 0.5],
  'grade.cbBlueMid': [-0.5, 0.5],
  'grade.cbRedShadow': [-0.5, 0.5],
  'grade.cbBlueShadow': [-0.5, 0.5],
  'grade.saturation': [0, 2],
  'grade.contrast': [0.5, 2],
  'grade.gamma': [0.5, 2],
  'tape.lumaSoftness': [0, 4],
  'tape.chromaSmear': [0, 20],
  'tape.chromaShiftR': [-8, 8],
  'tape.chromaShiftB': [-8, 8],
  'tape.grainStrength': [0, 60],
  'transport.jitterX': [0, 6],
  'transport.jitterY': [0, 4],
  'transport.headSwitchHeight': [0, 40],
  'transport.headSwitchShift': [-40, 40],
  'transport.headSwitchNoise': [0, 100],
  'osd.size': [8, 96],
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Deep merge that treats arrays as replacements, not concatenations. A preset
 *  overriding `transport.tears` means "these tears instead", never "these as
 *  well as the base ones". */
export function mergeLook(base, ...overrides) {
  const out = structuredClone(base);
  for (const override of overrides) {
    if (!isPlainObject(override)) continue;
    mergeInto(out, override);
  }
  return out;
}

function mergeInto(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('_')) continue; // documentation keys never merge
    if (isPlainObject(value) && isPlainObject(target[key])) mergeInto(target[key], value);
    else target[key] = structuredClone(value);
  }
}

export function get(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

export function set(obj, dotted, value) {
  const keys = dotted.split('.');
  const last = keys.pop();
  const parent = keys.reduce((o, k) => (o[k] ??= {}), obj);
  parent[last] = value;
  return obj;
}

/** Merge, clamp, and report. Returns the profile plus the list of what was
 *  pulled into range, so the CLI can print it rather than silently altering
 *  what the operator asked for. */
export function loadLookProfile(base, ...overrides) {
  const look = mergeLook(base, ...overrides);
  const clamped = [];
  for (const [dotted, [min, max]] of Object.entries(CLAMPS)) {
    const value = get(look, dotted);
    if (typeof value !== 'number' || Number.isNaN(value)) continue;
    const next = Math.min(max, Math.max(min, value));
    if (next !== value) {
      clamped.push({ path: dotted, from: value, to: next, min, max });
      set(look, dotted, next);
    }
  }
  return { look, clamped };
}

/** ffmpeg wants integers for pixel offsets and short decimals elsewhere.
 *  Trailing float noise in a filtergraph makes golden-string tests fragile for
 *  no benefit. */
const n = (v, digits = 4) => {
  const num = Number(v);
  if (!Number.isFinite(num)) throw new Error(`expected a finite number, got ${JSON.stringify(v)}`);
  return String(Number(num.toFixed(digits)));
};

/** Turn [201,202,400] into "between(n,201,202)+eq(n,400)" -- consecutive runs
 *  collapse, so the expression stays short enough to read in a failure. */
export function dropFrameExpr(frames = []) {
  const sorted = [...new Set(frames.map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  if (!sorted.length) return null;

  const terms = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const f of sorted.slice(1)) {
    if (f === prev + 1) { prev = f; continue; }
    terms.push(start === prev ? `eq(n,${start})` : `between(n,${start},${prev})`);
    start = f; prev = f;
  }
  terms.push(start === prev ? `eq(n,${start})` : `between(n,${start},${prev})`);
  return terms.join('+');
}

/** The radial falloff, evaluated once into a static frame. 0 at centre (keep
 *  sharp), 255 at the corners (take the blurred copy). */
/**
 * The tape's DISPLAY aspect as a reduced integer pair.
 *
 * Integers rather than a decimal so the filtergraph stays exact and golden:
 * `4/3` is a repeating decimal, and a rounded one would make the emitted graph
 * differ from the frozen string for the default shape.
 *
 * `sar` is the anamorphic squeeze the 4:3 tape carries (16/15 on 720x576, which
 * is what PAL 4:3 actually was) and 1/1 on the square-pixel shapes.
 */
export function tapeDisplayRatio(tape) {
  const [sarN, sarD] = String(tape.sar ?? '1/1').split('/').map(Number);
  if (!Number.isFinite(sarN) || !Number.isFinite(sarD) || sarN <= 0 || sarD <= 0) {
    throw new Error(`tape.sar must be a positive "n/d" ratio, got ${JSON.stringify(tape.sar)}`);
  }
  const w = tape.width * sarN;
  const h = tape.height * sarD;
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h);
  return [w / g, h / g];
}

function cornerMaskExpr(amount) {
  return `clip(255*min(1,${n(amount)}*(pow((X-W/2)/(W/2),2)+pow((Y-H/2)/(H/2),2))),0,255)`;
}

/**
 * Build the complete video filtergraph.
 *
 * @param {object} look       a loaded LookProfile
 * @param {object} cfg        config/render.json
 * @param {object} [opts]
 * @param {string} [opts.inLabel]   defaults to '0:v'
 * @param {string} [opts.outLabel]  defaults to 'vout'
 * @param {string[]} [opts.burnIn]  drawtext fragments from burn-in.mjs
 * @returns {string} a filter_complex graph
 */
export function buildVideoFilter(look, cfg, { inLabel = '0:v', outLabel = 'vout', burnIn = [] } = {}) {
  const { tape, delivery, fps } = { ...cfg, fps: cfg.fps };
  const workW = tape.workWidth;
  const workH = tape.workHeight;
  const chains = [];

  // ---- static corner-soften mask -------------------------------------------
  // One frame, held by framesync repeatlast. Never `loop`.
  chains.push(
    `color=c=black:s=${workW}x${workH}:d=1:r=${fps},` +
    'trim=end_frame=1,setpts=PTS-STARTPTS,format=yuv420p,' +
    `geq=lum='${cornerMaskExpr(look.optics.cornerSoftenAmount)}'` +
    `:cb='${cornerMaskExpr(look.optics.cornerSoftenAmount)}'` +
    `:cr='${cornerMaskExpr(look.optics.cornerSoftenAmount)}'[cmask]`,
  );

  // ---- source conditioning --------------------------------------------------
  // fps locks the grid; select drops the chosen frames; the second fps refills
  // the gap by duplicating the previous frame. Net effect is a visible hitch
  // with no change in duration or frame count -- a tape stutter, not a jump cut.
  const drop = dropFrameExpr(look.transport.droppedFrames);
  // THE CROP FOLLOWS THE SHAPE, because the scale target already does.
  //
  // This was the literal `4/3` sitting one line above a `scale` that reads
  // cfg.tape, so a 16:9 or 9:16 render cropped its source square to 4:3 and
  // then let scale stretch it back out. Measured against the raster fal
  // returns: 9:16 threw away 58% of the frame and stretched the rest 2.33x
  // vertically, on the shape the customer pays a 4/3 premium for.
  //
  // DISPLAY aspect, not pixel aspect. The source has square pixels; the 4:3
  // tape does not (SAR 16/15), so cropping on width/height would be 1.25 and
  // would break the one shape that was never wrong. Reduced, 4:3 comes out as
  // exactly `4/3`, so this emits a byte-identical graph for the default shape.
  const [cropW, cropH] = tapeDisplayRatio(tape);
  const source = [
    `fps=fps=${fps}`,
    ...(drop ? [`select='if(${drop},0,1)'`, `fps=fps=${fps}`] : []),
    `crop=w='min(iw,ih*${cropW}/${cropH})':h='min(ih,iw*${cropH}/${cropW})'`,
    `scale=${workW}:${workH}:flags=bicubic`,
    'setsar=1',
    'format=gbrp',
    'split=2[opt][hl]',
  ].join(',');
  chains.push(`[${inLabel}]${source}`);

  // ---- lens: halation, in RGB ----------------------------------------------
  chains.push(
    `[hl]curves=all='0/0 ${n(look.optics.bloomThreshold)}/0 1/1',` +
    `gblur=sigma=${n(look.optics.bloomRadius)}:steps=3,` +
    `colorbalance=rm=${n(look.optics.bloomWarmth)}:bm=-${n(look.optics.bloomWarmth)}[bloom]`,
  );
  chains.push(
    `[opt][bloom]blend=all_mode=screen:all_opacity=${n(look.optics.bloomStrength)},` +
    'format=yuv420p,split=2[sharp][soft]',
  );
  chains.push(`[soft]gblur=sigma=${n(look.optics.cornerSoftenSigma)}[softb]`);

  // ---- lens falloff -> camera DSP -> character generator -> tape encoder ----
  const tears = Array.isArray(look.transport.tears) ? look.transport.tears : [];
  const hasHeadSwitch = look.transport.headSwitchHeight > 0;
  const branches = ['m', ...tears.map((_, i) => `t${i + 1}`), ...(hasHeadSwitch ? ['hs'] : [])];

  const jitterX =
    `${tape.jitterOriginX}+round(${n(look.transport.jitterX)}*sin(n*2.399)` +
    `+${n(look.transport.jitterX * 0.55)}*sin(n*7.13))`;
  const jitterY = `${tape.jitterOriginY}+round(${n(look.transport.jitterY)}*sin(n*1.77))`;

  chains.push([
    '[sharp][softb][cmask]maskedmerge',
    `vignette=angle=${look.optics.vignetteAngle}:eval=init`,
    `curves=master='${look.grade.curveMaster}':r='${look.grade.curveRed}':b='${look.grade.curveBlue}'`,
    `colorbalance=rm=${n(look.grade.cbRedMid)}:bm=${n(look.grade.cbBlueMid)}` +
      `:rs=${n(look.grade.cbRedShadow)}:bs=${n(look.grade.cbBlueShadow)}`,
    `eq=saturation=${n(look.grade.saturation)}:contrast=${n(look.grade.contrast)}:gamma=${n(look.grade.gamma)}`,
    // THE DOMAIN BOUNDARY. Do not remove this, and do not move it.
    //
    // curves and colorbalance are RGB filters, so ffmpeg silently auto-inserts
    // a conversion and everything downstream of the grade inherits rgb24 (full
    // range) rather than yuv420p. That is wrong twice over. First, the entire
    // tape stage below is defined in terms of chroma: `gblur=planes=6` means
    // "planes 1 and 2", which in RGB are blue and red, so the signature chroma
    // smear was quietly blurring colour channels instead of chroma, and
    // chromashift was doing nothing meaningful at all. Second, the transport
    // overlays then each round-trip through overlay's own yuv420 working
    // format, and the accumulated range mismatch crushed mean luma from 133 to
    // 26 -- a five-fold darkening with no error and no warning.
    //
    // Pinning the format here makes the graph say what it means instead of
    // depending on negotiation: RGB above for the optics and the grade, YUV
    // below for the character generator, the tape encoder and the transport.
    'format=yuv420p',
    // The stamp is recorded onto the tape, so it degrades with everything below.
    ...burnIn,
    // Tape encoder, luma side. VHS carried roughly 3 MHz of luma against
    // broadcast's 5.5, so the picture was soft EVERYWHERE, not merely at the
    // corners. Leaving this out is what makes a chain like this read as "warm
    // film in a letterbox" rather than as tape: the scale round-trip alone does
    // not destroy nearly enough detail, because bicubic resampling is far
    // kinder than a helical scan head. planes=1 is luma only.
    ...(look.tape.lumaSoftness > 0
      ? [`gblur=sigma=${n(look.tape.lumaSoftness)}:planes=1`]
      : []),
    // Tape encoder, chroma side. sigmaV=0 makes this horizontal-only,
    // planes=6 makes it chroma-only (U=2 | V=4). One filter, correct artifact.
    `gblur=sigma=${n(look.tape.chromaSmear)}:sigmaV=0:planes=6`,
    `chromashift=crh=${n(look.tape.chromaShiftR)}:cbh=${n(look.tape.chromaShiftB)}`,
    // Grain here, at tape resolution, so it upscales into clumps.
    `noise=alls=${n(look.tape.grainStrength)}:allf=t+u:all_seed=${look.seed}`,
    `crop=w=${tape.width}:h=${tape.height}:x='${jitterX}':y='${jitterY}'`,
    `split=${branches.length}${branches.map((b) => `[${b}]`).join('')}`,
  ].join(','));

  // ---- playback transport: sparse tearing ----------------------------------
  // A band of the frame re-overlaid at a horizontal offset. Because overlay
  // clips at the frame edge, the vacated pixels reveal the untouched image
  // beneath -- a genuine torn seam rather than a smear. `enable` gates each
  // event to a few frames.
  let current = 'm';
  tears.forEach((tear, i) => {
    const band = `t${i + 1}`;
    const next = `tr${i + 1}`;
    chains.push(`[${band}]crop=w=${tape.width}:h=${tear.h}:x=0:y=${tear.y}[b${i + 1}]`);
    chains.push(
      `[${current}][b${i + 1}]overlay=x=${tear.shift}:y=${tear.y}` +
      `:enable='between(t,${n(tear.start, 3)},${n(tear.end, 3)})'[${next}]`,
    );
    current = next;
  });

  // ---- playback transport: the head-switching band -------------------------
  // Constant, every frame, along the very bottom. The single most recognisable
  // VHS tell, and it must never blink off. avgblur rather than gblur here on
  // purpose: gblur is slice-threaded and goes nondeterministic on a strip this
  // short -- measured, six different outputs in six runs at 12 rows.
  if (hasHeadSwitch) {
    const h = look.transport.headSwitchHeight;
    chains.push(
      `[hs]crop=w=${tape.width}:h=${h}:x=0:y=${tape.height - h},` +
      `noise=alls=${n(look.transport.headSwitchNoise)}:allf=t+u:all_seed=${look.seed2},` +
      'avgblur=sizeX=5:sizeY=1,' +
      'eq=brightness=0.05:saturation=0.2[hsb]',
    );
    chains.push(
      `[${current}][hsb]overlay=x=${look.transport.headSwitchShift}:y=${tape.height - h}[tapehs]`,
    );
    current = 'tapehs';
  }

  // ---- display: unsqueeze, then composite into the vertical frame ----------
  chains.push(
    `[${current}]setsar=${tape.sar},` +
    `scale=${delivery.tapeDisplayWidth}:${delivery.tapeDisplayHeight}:flags=bicubic,setsar=1[tapebig]`,
  );
  chains.push(`color=c=${delivery.surroundColor}:s=${delivery.width}x${delivery.height}:r=${fps}[bg]`);
  chains.push(
    `[bg][tapebig]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1,` +
    // Applied to the WHOLE canvas, tape and surround together. This is what
    // fuses them into one photographed object instead of two stacked layers.
    `vignette=angle=${look.composite.finalVignetteAngle}:eval=init,` +
    `format=yuv420p[${outLabel}]`,
  );

  return chains.join(';');
}
