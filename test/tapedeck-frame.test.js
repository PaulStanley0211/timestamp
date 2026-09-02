import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tapeGeometry, deliveryGeometry, frameCount, resolveAspect, aspectIds } from '../scripts/tapedeck/frame.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/render.json'), 'utf8'));

test('the shipped config is exactly 375 frames of PAL', () => {
  assert.equal(frameCount(cfg), 375);
  assert.equal(cfg.fps, 25);
  assert.equal(cfg.durationSeconds, 15);
});

test('a frame rate that does not divide the duration is rejected outright', () => {
  // This is the whole reason the project is PAL rather than NTSC: 15s at
  // 30000/1001 is 449.55 frames, so "exactly 15.000 seconds" could only ever be
  // an argument about rounding.
  assert.throws(
    () => frameCount({ ...cfg, fps: 29.97, totalFrames: 449.55 }),
    /not an integer/,
  );
});

test('a totalFrames that disagrees with fps x duration is rejected', () => {
  assert.throws(() => frameCount({ ...cfg, totalFrames: 374 }), /config declares totalFrames=374/);
});

test('PAL 720x576 at SAR 16/15 displays as 4:3', () => {
  const t = tapeGeometry(cfg);
  assert.equal(t.width, 720);
  assert.equal(t.height, 576);
  const [num, den] = t.sar.split('/').map(Number);
  assert.equal((t.width * (num / den)) / t.height, 4 / 3);
});

test('the work raster leaves headroom for transport jitter', () => {
  const t = tapeGeometry(cfg);
  assert.ok(t.workWidth > t.width && t.workHeight > t.height);
  assert.ok(t.jitterOriginX <= t.headroomX, 'jitter must not be able to reach the frame edge');
  assert.ok(t.jitterOriginY <= t.headroomY);
});

test('a work raster not divisible by 4 is rejected', () => {
  // Chroma subsampling works on 2x2 blocks; an odd raster gives a half-sampled
  // edge column that shows up as a coloured seam after the smear.
  assert.throws(
    () => tapeGeometry({ tape: { ...cfg.tape, workWidth: 734 } }),
    /divisible by 4/,
  );
});

test('a work raster smaller than the tape raster is rejected', () => {
  assert.throws(
    () => tapeGeometry({ tape: { ...cfg.tape, workWidth: 700, workHeight: 560 } }),
    /at least the tape raster/,
  );
});

test('the tape image centres in the vertical frame with equal surround', () => {
  const d = deliveryGeometry(cfg);
  assert.equal(d.tapeDisplayWidth, 1080);
  assert.equal(d.tapeDisplayHeight, 810);
  assert.equal(d.offsetY, 555);
  assert.equal(d.offsetX, 0);
  assert.equal(d.offsetY * 2 + d.tapeDisplayHeight, d.height);
});

test('a tape display size that is not 4:3 is rejected', () => {
  assert.throws(
    () => deliveryGeometry({ delivery: { ...cfg.delivery, tapeDisplayHeight: 700 } }),
    /not 4:3/,
  );
});

test('the probe regions land where they claim to', () => {
  const d = deliveryGeometry(cfg);
  // Surround bands must sit entirely outside the tape image.
  assert.ok(d.surroundTop.y + d.surroundTop.h <= d.offsetY);
  assert.ok(d.surroundBottom.y >= d.offsetY + d.tapeDisplayHeight);
  // The centre sample must sit entirely inside it.
  assert.ok(d.tapeCentre.y >= d.offsetY);
  assert.ok(d.tapeCentre.y + d.tapeCentre.h <= d.offsetY + d.tapeDisplayHeight);
  assert.ok(d.tapeCentre.x + d.tapeCentre.w <= d.width);
});

/* --- three aspect ratios ------------------------------------------------ *
 * The design holds the SHORT EDGE at 576 in every aspect and varies only the
 * long edge. That single constraint is what keeps every pixel-tuned constant
 * in the filtergraph correct without a second set of numbers: a 14px
 * head-switch band is 14px of a 576-high picture whichever shape it is in.
 * See docs/aspect-ratios-plan.md §3.
 */

test('resolveAspect leaves the 4:3 tape raster exactly where it was', () => {
  // The inertness checkpoint. If this moves, the refactor is not a refactor.
  const c = resolveAspect(cfg, '4:3');
  const t = tapeGeometry(c);
  assert.equal(t.width, 720);
  assert.equal(t.height, 576);
  assert.equal(t.sar, '16/15');
  assert.equal(t.workWidth, 736);
  assert.equal(t.workHeight, 588);
});

test('16:9 is 1024x576 with square pixels', () => {
  const t = tapeGeometry(resolveAspect(cfg, '16:9'));
  assert.equal(t.width, 1024);
  assert.equal(t.height, 576);
  assert.equal(t.sar, '1/1', 'only the PAL 4:3 raster is anamorphic; the others are square-pixel');
  assert.equal(t.width / t.height, 16 / 9);
});

test('9:16 is 576x1024, the same raster stood on its end', () => {
  const t = tapeGeometry(resolveAspect(cfg, '9:16'));
  assert.equal(t.width, 576);
  assert.equal(t.height, 1024);
  assert.equal(t.sar, '1/1');
  assert.equal(t.width / t.height, 9 / 16);
});

test('there are exactly three shapes, and the default is first', () => {
  // Paul, 2026-08-23: "it should only contain three options. That's it."
  // The default leads because it is the camcorder shape and the product's premise.
  assert.deepEqual(aspectIds(cfg), ['4:3', '16:9', '9:16']);
});

test('every shape holds its short edge at 576', () => {
  // THIS IS THE DESIGN. The whole reason there is one set of tuning constants
  // and not three is that the short edge never moves: a 14px head-switch band
  // is 14px of a 576-high picture in every shape, and the short edge always
  // scales 576 -> 1080 on delivery, so the grain is arithmetically identical.
  // Break this and every pixel constant in the filtergraph is quietly wrong.
  for (const id of aspectIds(cfg)) {
    const t = tapeGeometry(resolveAspect(cfg, id));
    assert.equal(Math.min(t.width, t.height), 576, `${id} short edge`);
  }
});

test('a shape nobody defined is refused rather than silently defaulted', () => {
  assert.throws(() => resolveAspect(cfg, '21:9'), /unknown aspect "21:9"/);
  assert.throws(() => resolveAspect(cfg, '_comment'), /unknown aspect/);
});

test('16:9 delivers a landscape file with the picture edge to edge', () => {
  // The reason this shape exists: the file goes to YouTube. A 16:9 picture
  // matted into a portrait canvas would be useless there, so the DELIVERY
  // dimensions have to be the shape that was chosen.
  const d = deliveryGeometry(resolveAspect(cfg, '16:9'));
  assert.equal(d.width, 1920);
  assert.equal(d.height, 1080);
  assert.equal(d.tapeDisplayWidth, 1920);
  assert.equal(d.tapeDisplayHeight, 1080);
  assert.equal(d.offsetX, 0);
  assert.equal(d.offsetY, 0);
  assert.equal(d.surroundTop.h, 0, 'there is no surround to measure');
  assert.equal(d.surroundBottom.h, 0);
});

test('9:16 delivers a full-bleed portrait file, which is what a reel wants', () => {
  const d = deliveryGeometry(resolveAspect(cfg, '9:16'));
  assert.equal(d.width, 1080);
  assert.equal(d.height, 1920);
  assert.equal(d.tapeDisplayWidth, 1080);
  assert.equal(d.tapeDisplayHeight, 1920);
  assert.equal(d.surroundTop.h, 0);
});

test('4:3 still sits matted on the dark surface, exactly as it always has', () => {
  const d = deliveryGeometry(resolveAspect(cfg, '4:3'));
  assert.equal(d.width, 1080);
  assert.equal(d.height, 1920);
  assert.equal(d.tapeDisplayWidth, 1080);
  assert.equal(d.tapeDisplayHeight, 810);
  assert.ok(d.surroundTop.h > 0, 'the surround is the point of this one');
});
