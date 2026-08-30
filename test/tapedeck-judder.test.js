/**
 * The judder, measured on frames rather than argued about.
 *
 * WHAT IS WRONG. fal delivers 24fps and the contract is 25, so 361 source
 * frames stretched to 375 duplicate 15 of them -- and `fps=fps=25` places those
 * duplicates on a fixed cadence, at frames 12, 37, 62 ... exactly one every 25.
 * Periodic judder is the most visible kind, because the eye locks onto the
 * rhythm rather than the individual hitch. It is in every tape ever made.
 *
 * THE FIX PAUL CHOSE (2026-08-30), of the three in §26: keep the duplicated
 * frames and scatter them, so the metronome becomes tape unsteadiness. It does
 * NOT remove them -- fifteen frames are still repeated. Interpolating them away
 * was the alternative and it invents pixels.
 *
 * WHY THIS IS MEASURED ON THE RAW RETIMING AND NOT ON A FINISHED TAPE. The tape
 * chain adds per-frame temporal grain (`noise=allf=t+u`), so two output frames
 * are never byte-identical even when one is a duplicate of the other. A
 * framehash of the delivered mp4 would report zero duplicates on a tape that is
 * full of them. §26 measured the raw segment for exactly this reason, and so
 * does this file.
 *
 * A SOURCE WITH DISTINCT FRAMES IS THE PROBE. Every frame carries its own index
 * in luma and chroma, so two consecutive identical hashes mean a genuinely
 * duplicated frame and nothing else -- no threshold, no eyeballing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFfmpeg, REPO_ROOT } from '../scripts/ffmpeg/run.mjs';
import { buildVideoFilter, judderExpr, loadLookProfile, CLAMPS } from '../scripts/tapedeck/look.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/render.json'), 'utf8'));
const BASE = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/look/base.json'), 'utf8'));

/** The pid is not decoration -- `node --test` runs files in parallel processes
 *  and two runs sharing an output path are two ffmpegs writing one file. Same
 *  fix and same reason as `tapedeck-geometry.test.js` and `accounts.mjs`. */
const WORK = path.join(REPO_ROOT, 'build', `tapedeck-judder-${process.pid}`);

test.before(() => { fs.mkdirSync(WORK, { recursive: true }); });
test.after(() => { fs.rmSync(WORK, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

/**
 * A clip whose every frame is unique, at a chosen rate.
 *
 * The frame index goes into luma and chroma as a two-digit base-256 number, so
 * no two frames within 65536 share a hash. Tiny raster: this measures WHICH
 * frames arrive, never what they look like.
 */
async function distinctSource(file, { fps, frames }) {
  await runFfmpeg([
    '-y', '-f', 'lavfi',
    '-i', `color=c=black:s=32x32:r=${fps}:d=${frames / fps}`,
    '-vf', "geq=lum='mod(N,256)':cb='mod(floor(N/256),256)':cr=128,format=yuv420p",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0',
    '-frames:v', String(frames),
    file,
  ], { cwd: ROOT });
}

/**
 * Push a source through the retiming head alone and report which output frames
 * are duplicates of the frame before them.
 */
async function retime(tag, { fps, frames, expr }) {
  const src = path.join(WORK, `${tag}-src.mp4`);
  const out = path.join(WORK, `${tag}.txt`);
  await distinctSource(src, { fps, frames });

  const chain = [expr ? `setpts=${expr}` : null, `fps=fps=${cfg.fps}`].filter(Boolean).join(',');
  await runFfmpeg(['-y', '-i', src, '-vf', chain, '-f', 'framehash', out], { cwd: ROOT });

  const hashes = fs.readFileSync(out, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split(',').pop().trim());

  const dups = [];
  for (let i = 1; i < hashes.length; i += 1) if (hashes[i] === hashes[i - 1]) dups.push(i);
  const gaps = dups.slice(1).map((d, i) => d - dups[i]);
  return { total: hashes.length, dups, gaps };
}

/** The look this product actually ships, with a chosen scatter amplitude. */
function shippedLook(judderScatter) {
  return loadLookProfile(BASE, { transport: { judderScatter } }).look;
}

// ---------------------------------------------------------------------------
// the defect, and that this probe can see it
// ---------------------------------------------------------------------------

test('the metronome is real: 24fps into 25fps duplicates a frame every 25, exactly', async () => {
  const r = await retime('baseline', { fps: 24, frames: 361, expr: null });

  // The probe is worth nothing if it cannot find the thing it was built for,
  // so this asserts the DEFECT before anything asserts the fix.
  assert.ok(r.dups.length >= 10, `only ${r.dups.length} duplicates found -- the probe is not seeing the retiming`);
  assert.deepEqual([...new Set(r.gaps)], [25],
    `the duplicate spacing is ${[...new Set(r.gaps)].join(',')}, so this source is not reproducing the periodic judder`);
});

// ---------------------------------------------------------------------------
// the expression
// ---------------------------------------------------------------------------

test('no scatter means no setpts at all, so today\'s graph is unchanged', () => {
  assert.equal(judderExpr({ amplitude: 0, seed: 7 }), null);
  const graph = buildVideoFilter(shippedLook(0), cfg);
  assert.ok(graph.includes(`fps=fps=${cfg.fps}`), 'the retiming head is gone');
  assert.ok(!/setpts=\(N/.test(graph), 'a zero scatter still emitted a judder setpts');
});

test('a scatter is emitted before the retiming, or it changes nothing', () => {
  const graph = buildVideoFilter(shippedLook(0.25), cfg);
  const setpts = graph.indexOf('setpts=(N');
  const fps = graph.indexOf(`fps=fps=${cfg.fps}`);
  assert.ok(setpts >= 0, 'no judder setpts in the graph');
  assert.ok(fps >= 0, 'no retiming in the graph');
  assert.ok(setpts < fps,
    'the scatter is applied AFTER the retiming, where the duplicate positions are already decided');
});

test('the scatter is a pure function of the seed -- never a random()', () => {
  const a = judderExpr({ amplitude: 0.25, seed: 11 });
  const b = judderExpr({ amplitude: 0.25, seed: 11 });
  const c = judderExpr({ amplitude: 0.25, seed: 12 });

  assert.equal(a, b, 'the same seed produced two different expressions -- purity is gone');
  assert.notEqual(a, c, 'two jobs share a scatter phase, so the judder is still identical between tapes');
  // ffmpeg's random() is not stable across builds, and determinism here is the
  // property the whole repo is built on.
  assert.ok(!/random/.test(a), 'the scatter uses random(), which is not reproducible across ffmpeg builds');
});

test('the scatter cannot exceed half a frame, because that is where frames reorder', () => {
  const [min, max] = CLAMPS['transport.judderScatter'];
  assert.equal(min, 0);
  assert.ok(max < 0.5,
    `the scatter clamp is ${max}; at or above 0.5 a frame can overtake its neighbour and ffmpeg refuses the graph with a non-monotonic dts`);

  // Clamped, not refused -- a look profile is a creative document, which is the
  // rule the rest of this table already follows.
  const { look, clamped } = loadLookProfile(BASE, { transport: { judderScatter: 9 } });
  assert.equal(look.transport.judderScatter, max);
  assert.ok(clamped.some((c) => c.path === 'transport.judderScatter'), 'the clamp was silent');
});

/**
 * THE INVARIANT THAT KEEPS THE DELIVERY CONTRACT, pinned here where a change to
 * this expression will trip it.
 *
 * `-frames:v 375` is a CEILING and not a floor -- it stops ffmpeg after 375
 * frames but cannot invent a 375th the graph never produced. A nudge that can
 * pull the LAST frame earlier shortens the span by a slot, and a source with no
 * slack comes out at 374 frames and 14.96s. The first version of this feature
 * did exactly that, and it was caught 56 seconds into another file by
 * `ffmpeg-output.test.js` rather than here.
 *
 * Only ever delaying makes the span monotonically non-decreasing, and the
 * ceiling trims the surplus. So: zero at the first frame, never negative, never
 * past the amplitude.
 */
test('the nudge starts at zero, never goes negative, and never exceeds its amplitude', () => {
  const amplitude = 0.25;
  const expr = judderExpr({ amplitude, seed: 20030714 });
  const m = /^\(N\+([\d.]+)\*\(1-cos\(N\*([\d.]+)\)\)\+([\d.]+)\*\(1-cos\(N\*([\d.]+)\)\)\)\/\(FR\*TB\)$/.exec(expr);
  assert.ok(m, `the expression is not the shape this invariant was proved for: ${expr}`);

  const [a1, r1, a2, r2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  const at = (N) => a1 * (1 - Math.cos(N * r1)) + a2 * (1 - Math.cos(N * r2));

  assert.equal(at(0), 0, 'the first frame is displaced, which moves where the whole output starts');
  let min = Infinity;
  let max = -Infinity;
  for (let N = 0; N <= 2000; N += 1) {
    const v = at(N);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  assert.ok(min >= 0, `the nudge reaches ${min}, and a negative nudge can cost the last frame of the tape`);
  assert.ok(max <= amplitude + 1e-9, `the nudge reaches ${max}, over its amplitude of ${amplitude}`);
});

test('the shipped profile actually turns it on', () => {
  // A fix that exists and is disabled is the failure mode this repository keeps
  // recording -- a correct guard that could never fire, a rule that matched
  // nothing. The tape people receive is rendered from THIS file, so this is the
  // assertion that the defect is actually fixed rather than merely fixable.
  const shipped = loadLookProfile(BASE).look;
  const [, max] = CLAMPS['transport.judderScatter'];
  assert.ok(shipped.transport.judderScatter > 0,
    'config/look/base.json ships judderScatter at 0, so every tape still duplicates a frame every 25');
  assert.ok(shipped.transport.judderScatter <= max);
  assert.ok(judderExpr({ amplitude: shipped.transport.judderScatter, seed: shipped.seed }),
    'the shipped amplitude produces no expression');
});

// ---------------------------------------------------------------------------
// what it does to real frames
// ---------------------------------------------------------------------------

test('the scatter breaks the cadence without losing or inventing a frame', async () => {
  const off = await retime('off', { fps: 24, frames: 361, expr: null });
  const on = await retime('on', { fps: 24, frames: 361, expr: judderExpr({ amplitude: 0.25, seed: 4242 }) });

  assert.equal(on.total, off.total, 'the scatter changed how many frames came out');
  // Fifteen frames are still repeated -- this fix moves them, it does not
  // remove them. A big swing either way means the retiming was disturbed.
  assert.ok(Math.abs(on.dups.length - off.dups.length) <= 1,
    `duplicates went from ${off.dups.length} to ${on.dups.length}; the scatter is meant to move them, not delete them`);

  const spacings = new Set(on.gaps);
  assert.ok(spacings.size > 1,
    `the duplicates are still evenly spaced at ${[...spacings].join(',')} -- the metronome survived`);
});

test('a 25fps source is left completely alone, which is what npm run look renders', async () => {
  // buildVideoFilter also serves the look CLI over REAL footage in
  // assets/stock, where nothing is being retimed and there is no judder to fix.
  // A scatter that started duplicating frames there would be damaging genuine
  // recordings to fix a defect they do not have.
  const on = await retime('native', { fps: cfg.fps, frames: 375, expr: judderExpr({ amplitude: 0.25, seed: 4242 }) });

  assert.equal(on.total, 375, 'the frame count moved on a source that needed no retiming');
  assert.deepEqual(on.dups, [], `the scatter duplicated frames of a ${cfg.fps}fps source at ${on.dups.join(',')}`);
});

test('the same job scatters the same way twice, and two jobs scatter differently', async () => {
  const a = await retime('seed-a', { fps: 24, frames: 361, expr: judderExpr({ amplitude: 0.25, seed: 4242 }) });
  const again = await retime('seed-a2', { fps: 24, frames: 361, expr: judderExpr({ amplitude: 0.25, seed: 4242 }) });
  const b = await retime('seed-b', { fps: 24, frames: 361, expr: judderExpr({ amplitude: 0.25, seed: 99 }) });

  assert.deepEqual(again.dups, a.dups, 'the same seed produced different duplicate positions -- purity is gone');
  assert.notDeepEqual(b.dups, a.dups, 'two different jobs judder identically');
});
