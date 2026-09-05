/**
 * The judder, measured on frames rather than argued about.
 *
 * THIS FILE USED TO TEST A FIX AND NOW TESTS A CONDITION. From 2026-08-30 to
 * 2026-09-05 the tape chain carried a `setpts` in front of its `fps` filter,
 * nudging each source frame's timing by a fraction of a frame so that the
 * frames the retiming duplicated stopped arriving on a metronome. Ten tests
 * here pinned that expression: its shape, its seed, its clamp, and that it
 * never pulled the first frame earlier.
 *
 * IT WENT BECAUSE THE DEFECT WENT. It existed for SEEDANCE, which delivered
 * 24fps against a 25fps contract: 361 source frames stretched to 375 held one
 * frame in every 25 for two, at 12, 37, 62 and so on. The product moved to
 * `alibaba/wan-3.0/reference-to-video` on 2026-09-02 and Wan delivers 30fps, so
 * the retiming DECIMATES -- 450 frames down to 375, dropping 75 -- and there is
 * nothing to scatter. Measured on the real segments before the removal, with a
 * Seedance tape as the control: 24fps gave 376 frames and 15 duplicates, 30fps
 * gave 375 frames and 0 duplicates, on two separate jobs.
 *
 * WHAT IS KEPT, AND WHY IT IS NOT DEAD WEIGHT. One test, and it measures the
 * CONDITION rather than the fix: what the shipped retiming does to a source
 * below the contract rate. That is the thing that would bring the judder back,
 * and nothing else in the suite would notice if it did -- `assembleFrameWarnings`
 * asks whether there is enough TIME to fill the contract and is deliberately
 * silent when the duration holds and only the rate differs, which is exactly
 * the 24fps case (see its own note: a warning that cries wolf is how the real
 * one stops being read). So this file is the standing record of the trade: the
 * scatter is gone, a sub-25fps source reintroduces a duplicate every 25 frames,
 * and the expression is in git history at 2026-09-05 if it is ever needed.
 *
 * WHY THIS IS MEASURED ON THE RAW RETIMING AND NOT ON A FINISHED TAPE. The tape
 * chain adds per-frame temporal grain (`noise=allf=t+u`), so two output frames
 * are never byte-identical even when one is a duplicate of the other. A
 * framehash of the delivered mp4 would report zero duplicates on a tape that is
 * full of them. Section 26 measured the raw segment for exactly this reason,
 * and so does this file.
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
import { buildVideoFilter, loadLookProfile, CLAMPS } from '../scripts/tapedeck/look.mjs';

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
async function retime(tag, { fps, frames }) {
  const src = path.join(WORK, `${tag}-src.mp4`);
  const out = path.join(WORK, `${tag}.txt`);
  await distinctSource(src, { fps, frames });

  await runFfmpeg(['-y', '-i', src, '-vf', `fps=fps=${cfg.fps}`, '-f', 'framehash', out], { cwd: ROOT });

  const hashes = fs.readFileSync(out, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split(',').pop().trim());

  const dups = [];
  for (let i = 1; i < hashes.length; i += 1) if (hashes[i] === hashes[i - 1]) dups.push(i);
  const gaps = dups.slice(1).map((d, i) => d - dups[i]);
  return { total: hashes.length, dups, gaps };
}

test('a source below the contract rate still judders, and nothing scatters it now', async () => {
  // THE CONDITION THAT REVERSES THE 2026-09-05 REMOVAL, stated as a
  // measurement so it is a fact rather than a memory.
  const slow = await retime('slow', { fps: 24, frames: 361 });
  assert.ok(slow.dups.length > 0, '24fps into 25fps no longer duplicates, which would be new physics');
  assert.deepEqual([...new Set(slow.gaps)], [25],
    `24fps into 25fps must duplicate on a flat 25-frame cadence; saw gaps ${[...new Set(slow.gaps)].join(',')}`);

  // AND THE SHIPPED SOURCE RATE DOES NOT. Wan delivers 30fps, so the retiming
  // decimates and the metronome has nothing to beat. Asserted beside the
  // failing case so this file cannot pass by measuring nothing.
  const fast = await retime('fast', { fps: 30, frames: 450 });
  assert.deepEqual(fast.dups, [],
    'a 30fps source produced duplicate frames, so the retiming is not decimating as expected');
  assert.equal(fast.total, cfg.totalFrames,
    `a 30fps source must fill the contract exactly; got ${fast.total} of ${cfg.totalFrames}`);
});

test('the tape chain no longer retimes anything before the fps filter', () => {
  // A GUARD AGAINST THE SCATTER COMING BACK BY ACCIDENT rather than by
  // decision. `setpts` in front of `fps` is what the removed expression was;
  // anything reintroducing one changes which frames survive the retiming, and
  // it must be a deliberate edit with this file's header read first.
  const { look } = loadLookProfile(BASE);
  const graph = buildVideoFilter(look, cfg, { burnIn: [] });

  assert.ok(graph.includes(`fps=fps=${cfg.fps}`),
    'the retiming is gone entirely, which is not the change that was made');

  // THE SOURCE CHAIN MUST OPEN ON THE RETIMING. Scoped to the head of the input
  // chain rather than to the whole graph, because there is a legitimate
  // `setpts=PTS-STARTPTS` in the corner-soften mask -- a one-frame still that
  // has nothing to do with the transport. A bare `!/setpts=/` over the graph
  // would fail on that and read as this guard working.
  const head = graph.slice(graph.indexOf('[0:v]') + '[0:v]'.length);
  assert.match(head, new RegExp(`^fps=fps=${cfg.fps},`),
    'something runs before the retiming again -- if it is a setpts, read this file\'s header first');

  // And the removed expression by its own signature, wherever it might reappear.
  assert.ok(!graph.includes('FR*TB'),
    'the judder expression is back in the shipped chain; it was removed on 2026-09-05');

  // The clamp went with the value it bounded; a stray entry for a setting that
  // no longer exists is how a dead knob looks alive to the next reader.
  assert.ok(!Object.keys(CLAMPS).some((k) => /judder/i.test(k)),
    'CLAMPS still bounds a judder setting that nothing reads');
  assert.ok(!('judderScatter' in (BASE.transport ?? {})),
    'config/look/base.json still carries judderScatter, which nothing reads');
});
