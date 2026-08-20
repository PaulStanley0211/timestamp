import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tapeGeometry, deliveryGeometry, frameCount } from '../scripts/tapedeck/frame.mjs';

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
