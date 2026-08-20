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

  const ratio = tapeDisplayWidth / tapeDisplayHeight;
  if (Math.abs(ratio - 4 / 3) > 0.001) {
    throw new Error(
      `tape display ${tapeDisplayWidth}x${tapeDisplayHeight} is ${ratio.toFixed(4)}:1, not 4:3 -- ` +
      'the whole point of the letterbox is that the tape image stays honestly 4:3',
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
