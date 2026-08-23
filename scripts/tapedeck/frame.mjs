/**
 * Geometry. Pure arithmetic -- no I/O, no ffmpeg, no filesystem.
 *
 * The numbers here are the reason this project is PAL rather than NTSC. At
 * 30000/1001, fifteen seconds is 449.55 frames, which is not an integer, so
 * "exactly 15.000 seconds" could only ever be an approximation you argue about.
 * At 25fps it is exactly 375 frames, and "exact" becomes a number a test can
 * assert. That is the whole argument, and it happens to also be historically
 * right for a camcorder tape recorded in Europe.
 *
 * The other subtlety is the anamorphic raster. PAL 4:3 is 720x576 with a
 * non-square pixel: 720 * (16/15) = 768, and 768:576 is 4:3. Modelling that
 * honestly matters because the horizontal unsqueeze on the way out softens the
 * image horizontally more than vertically, which is exactly what the format
 * did. A square-pixel 640x480 round trip gives uniform softness -- subtly, but
 * noticeably, less convincing.
 */

/**
 * Pick the shape. Returns a config whose `tape` and `delivery` are the ones for
 * the requested aspect, so every consumer downstream -- the filtergraph, the
 * burn-in, the geometry functions below -- keeps reading the single pair of
 * keys it has always read and needs no aspect argument of its own.
 *
 * WHY THE DEFAULT SHAPE IS THE BASE AND NOT AN ENTRY IN `aspects`. The 4:3 path
 * is the PAL contract and roughly two hundred tests assert it. If it were one
 * key in a map beside the others it could be edited while adding a new shape
 * and nothing structural would stop it. As the base it cannot move by accident:
 * asking for the default aspect returns the config unchanged, so "4:3 does not
 * move" is a property of the code rather than a promise a test has to police.
 */
/**
 * Every shape the product offers, default first.
 *
 * `_comment` keys are how this repo documents JSON, so they sit beside real
 * entries everywhere. Filtering them here rather than at each call site is what
 * stops a comment from ever being offered to a customer as a fourth option.
 */
export function aspectIds(cfg) {
  const extra = Object.keys(cfg.aspects ?? {}).filter((k) => !k.startsWith('_'));
  return [cfg.defaultAspect, ...extra];
}

export function resolveAspect(cfg, aspect = cfg.defaultAspect) {
  if (aspect === cfg.defaultAspect) return { ...cfg, aspect };

  // Membership is decided by aspectIds, not by a raw lookup: `cfg.aspects` also
  // holds `_comment`, and a raw lookup would hand back the comment STRING as a
  // shape, whose `.tape` is undefined -- a wrong render instead of a refusal.
  const entry = aspectIds(cfg).includes(aspect) ? cfg.aspects?.[aspect] : undefined;
  if (!entry) throw new Error(`unknown aspect ${JSON.stringify(aspect)}`);

  // Replaced wholesale, never merged. A partial entry leaves the missing key
  // undefined so the geometry function throws, rather than quietly rendering
  // the new shape into the default shape's delivery frame.
  return { ...cfg, aspect, tape: entry.tape, delivery: entry.delivery };
}

/** The work raster carries jitter headroom so transport wobble has pixels to
 *  steal from. Without it, a two-pixel horizontal shift exposes a hard edge at
 *  the frame boundary and the illusion dies instantly. */
export function tapeGeometry(cfg) {
  const { width, height, workWidth, workHeight, jitterOriginX, jitterOriginY, sar } = cfg.tape;

  if (workWidth % 4 !== 0 || workHeight % 4 !== 0) {
    throw new Error(
      `work raster ${workWidth}x${workHeight} must be divisible by 4 in both axes -- ` +
      'chroma subsampling operates on 2x2 blocks and an odd raster produces a half-sampled edge column',
    );
  }
  if (workWidth < width || workHeight < height) {
    throw new Error(`work raster ${workWidth}x${workHeight} must be at least the tape raster ${width}x${height}`);
  }

  const headroomX = Math.floor((workWidth - width) / 2);
  const headroomY = Math.floor((workHeight - height) / 2);

  if (jitterOriginX > headroomX || jitterOriginY > headroomY) {
    throw new Error(
      `jitter origin (${jitterOriginX},${jitterOriginY}) exceeds available headroom (${headroomX},${headroomY})`,
    );
  }

  return { width, height, workWidth, workHeight, sar, jitterOriginX, jitterOriginY, headroomX, headroomY };
}

/**
 * Where the 4:3 tape image sits inside the vertical delivery frame.
 *
 * 1080 wide at 4:3 is 1080x810, which centred in 1080x1920 leaves 555 pixels of
 * surround above and below. Those bands are what the tests measure to prove the
 * composite geometry is right without ever comparing a pixel.
 */
export function deliveryGeometry(cfg) {
  const { width, height, tapeDisplayWidth, tapeDisplayHeight, surroundColor } = cfg.delivery;

  // The displayed picture must be the shape that was asked for. This used to be
  // hardcoded to 4:3, which was correct while 4:3 was the only shape; now the
  // aspect comes off the resolved config. A raw cfg that never went through
  // `resolveAspect` has no `aspect`, so it falls back to the default and the
  // original assertion is exactly what it was.
  const wanted = cfg.aspect ?? cfg.defaultAspect ?? '4:3';
  const [aw, ah] = String(wanted).split(':').map(Number);
  if (!(aw > 0 && ah > 0)) throw new Error(`aspect ${JSON.stringify(wanted)} is not a ratio`);

  const ratio = tapeDisplayWidth / tapeDisplayHeight;
  if (Math.abs(ratio - aw / ah) > 0.001) {
    throw new Error(
      `tape display ${tapeDisplayWidth}x${tapeDisplayHeight} is ${ratio.toFixed(4)}:1, not ${wanted} -- ` +
      'the displayed picture must be honestly the shape that was chosen',
    );
  }
  if (tapeDisplayHeight > height) {
    throw new Error(`tape display height ${tapeDisplayHeight} does not fit in delivery height ${height}`);
  }

  const offsetY = Math.round((height - tapeDisplayHeight) / 2);
  const offsetX = Math.round((width - tapeDisplayWidth) / 2);

  return {
    width, height, tapeDisplayWidth, tapeDisplayHeight, surroundColor, offsetX, offsetY,
    /** Regions the ffprobe assertions measure. */
    surroundTop: { x: 0, y: 0, w: width, h: Math.max(0, offsetY - 8) },
    surroundBottom: { x: 0, y: offsetY + tapeDisplayHeight + 8, w: width, h: Math.max(0, offsetY - 8) },
    tapeCentre: {
      x: offsetX + Math.round(tapeDisplayWidth * 0.25),
      y: offsetY + Math.round(tapeDisplayHeight * 0.25),
      w: Math.round(tapeDisplayWidth * 0.5),
      h: Math.round(tapeDisplayHeight * 0.5),
    },
  };
}

/** Exactly 375 at 25fps and 15s. Asserted rather than hoped. */
export function frameCount(cfg) {
  const exact = cfg.durationSeconds * cfg.fps;
  if (!Number.isInteger(exact)) {
    throw new Error(
      `${cfg.durationSeconds}s at ${cfg.fps}fps is ${exact} frames, which is not an integer -- ` +
      'pick a frame rate that divides the duration cleanly, or the exact-duration assertion is meaningless',
    );
  }
  if (cfg.totalFrames !== exact) {
    throw new Error(`config declares totalFrames=${cfg.totalFrames} but ${cfg.durationSeconds}s at ${cfg.fps}fps is ${exact}`);
  }
  return exact;
}
