/**
 * Geometry, asserted on PIXELS rather than on a filtergraph string.
 *
 * WHY THIS FILE EXISTS. Every other check on a finished tape measures something
 * that anamorphic distortion does not move: frame count, duration, LUFS, edge
 * luma, file dimensions. A 9:16 tape that has been cropped to 4:3 and stretched
 * back out has exactly the right number of frames, exactly the right duration,
 * exactly the right delivery raster, and a picture two and a half times too
 * tall. The end-to-end 9:16 check that shipped the frame-shape feature measured
 * all four of those and passed.
 *
 * A CIRCLE IS THE PROBE, because a circle is the one shape whose distortion is
 * unambiguous and measurable: squeeze either axis and the bounding box stops
 * being square, and the ratio IS the distortion factor. No golden string, no
 * reference frame, no eyeballing.
 *
 * WHAT IT CAUGHT. The source crop was a hardcoded `4/3` sitting one line above a
 * scale target that read `cfg.tape`, so the ratio did not follow the shape.
 * Measured against this test before the fix:
 *
 *   4:3    497x497   roundness 1.000   (unaffected -- it was always the default)
 *   16:9   878x662   roundness 1.326   stretched horizontally
 *   9:16   667x1551  roundness 0.430   stretched 2.33x vertically
 *
 * The source rasters below are what fal actually RETURNS, not what is ordered.
 * The endpoint upscales and picks its own size, and the crop operates on what
 * arrives -- so testing at the ordered raster would miss the whole defect.
 *
 * SLOW BY THE STANDARDS OF THIS SUITE, and worth it: three one-frame renders
 * through the real graph. Everything else about the look is asserted for free
 * as a golden string in `tapedeck-look.test.js`; this is the one property a
 * string cannot carry.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFfmpeg, probe, REPO_ROOT } from '../scripts/ffmpeg/run.mjs';
import { resolveAspect } from '../scripts/tapedeck/frame.mjs';
import { buildVideoFilter, loadLookProfile } from '../scripts/tapedeck/look.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/render.json'), 'utf8'));
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/look/base.json'), 'utf8'));

/**
 * THE PID IS NOT DECORATION. `node --test` runs test FILES in parallel
 * processes, and two runs sharing one output path are two ffmpegs writing one
 * file: whoever reads between the truncate and the first byte gets a short
 * frame. Same fix and same reason as the tmp names in `provider-fal.test.js`
 * and `accounts.mjs`.
 */
const WORK = path.join(REPO_ROOT, 'build', `tapedeck-geometry-${process.pid}`);

/** What fal delivers for each ordered shape at 720p. The short edge is held and
 *  the long edge follows the shape, then the endpoint upscales ~1.16x. */
const SOURCES = {
  '4:3': [1112, 834],
  '16:9': [1484, 834],
  '9:16': [834, 1484],
};

/** A perfect circle, bright on dark, at a given raster. Drawn with geq so the
 *  edge is exact rather than a codec's idea of one. */
async function circleSource(file, w, h) {
  const r = Math.round(Math.min(w, h) * 0.3);
  await runFfmpeg([
    '-y', '-f', 'lavfi',
    '-i', `color=c=black:s=${w}x${h}:d=1:r=25`,
    '-vf', `geq=lum='if(lte(hypot(X-${Math.round(w / 2)}\\,Y-${Math.round(h / 2)}),${r}),235,16)':cb=128:cr=128,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12',
    file,
  ], { cwd: ROOT });
}

/** The bounding box of the bright region, measured on a raw gray frame. */
async function boundingBox(file, tag) {
  const raw = path.join(WORK, `${tag}.gray`);
  await runFfmpeg(['-y', '-i', file, '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', raw], { cwd: ROOT });

  const info = await probe(file);
  const v = (info.streams ?? []).find((s) => s.codec_type === 'video');
  assert.ok(v, `no video stream in ${file}`);
  const W = Number(v.width);
  const H = Number(v.height);
  // A non-square SAR would make a pixel measurement mean something else. The
  // delivery raster is square-pixel in every shape; assert it rather than
  // assume it, because the TAPE raster is not (4:3 carries SAR 16/15).
  assert.equal(String(v.sample_aspect_ratio ?? '1:1'), '1:1',
    'the delivered frame is not square-pixel, so a pixel bounding box is not a shape');

  const buf = fs.readFileSync(raw);
  assert.ok(buf.length >= W * H, `short raw frame: ${buf.length} < ${W * H}`);

  const TH = 140; // well above the graded black floor and below the disc
  let minX = W; let maxX = -1; let minY = H; let maxY = -1;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (buf[y * W + x] >= TH) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  assert.ok(maxX >= 0, `no bright region found in ${file} -- the probe never reached the output`);
  return { W, H, width: maxX - minX + 1, height: maxY - minY + 1 };
}

test('a circle stays a circle in every shape the product sells', async (t) => {
  fs.mkdirSync(WORK, { recursive: true });
  t.after(() => fs.rmSync(WORK, { recursive: true, force: true }));

  const { look } = loadLookProfile(base);
  const profile = { ...look, osd: { ...look.osd, enabled: false } };

  for (const [aspect, [sw, sh]] of Object.entries(SOURCES)) {
    const tag = aspect.replace(':', 'x');
    const src = path.join(WORK, `src-${tag}.mp4`);
    const out = path.join(WORK, `tape-${tag}.mp4`);

    await circleSource(src, sw, sh);
    const graph = buildVideoFilter(profile, resolveAspect(cfg, aspect), { burnIn: [] });
    await runFfmpeg([
      '-y', '-i', src,
      '-filter_complex', graph,
      '-map', '[vout]', '-frames:v', '1',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p',
      out,
    ], { cwd: ROOT });

    const box = await boundingBox(out, `m-${tag}`);
    const roundness = box.width / box.height;

    // 5% covers grain and the corner-soften blur nibbling at the bounding box.
    // The defect this catches was 33% and 133% out, so the margin is not close
    // to the signal -- and a margin narrower than the grain would make this a
    // test of the grain.
    assert.ok(Math.abs(roundness - 1) < 0.05,
      `${aspect}: the circle came out ${box.width}x${box.height} (roundness ${roundness.toFixed(4)}) ` +
      `in a ${box.W}x${box.H} frame. The picture is being cropped to one shape and stretched into another.`);
  }
});
