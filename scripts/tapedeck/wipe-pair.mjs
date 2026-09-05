/**
 * The landing page's before/after pair, built from a place photograph.
 *
 *   node scripts/tapedeck/wipe-pair.mjs new-york-times-square
 *
 * Writes assets/landing/photo.jpg and tape.jpg. Untested, exactly as
 * place-loops.mjs beside it is untested: both produce committed ARTEFACTS that
 * a person looks at, and what would be asserted about the output is the thing
 * the eye is there to judge. What IS pinned, in test/browser-smoke.test.js, is
 * the property the wipe depends on -- that the two halves are the same size.
 *
 * The shipped `<id>.mp4` loop DRIFTS (place-loops.mjs, one full sine period with
 * a 1.7 phase offset on the Y axis), so no frame of it is ever centre-cropped
 * and no frame can be aligned against the source jpg. This mirrors that module's
 * geometry exactly with the sine removed, so both halves come from the identical
 * crop and the wipe has nothing to misregister.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { REPO_ROOT, runFfmpeg } from '../ffmpeg/run.mjs';
import { loadLookProfile, buildVideoFilter } from './look.mjs';

const W = 1024, H = 576, WORK_W = 1040, WORK_H = 588, DRIFT_X = 36, DRIFT_Y = 18;
const id = process.argv[2] ?? 'new-york-times-square';
const outDir = path.join(REPO_ROOT, 'assets', 'landing');

const base = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'render.json'), 'utf8'));
const lookBase = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'look', 'base.json'), 'utf8'));
const { look } = loadLookProfile(lookBase);

const cfg = {
  ...base,
  fps: base.fps,
  durationSeconds: 1,
  aspect: '16:9',
  tape: {
    ...base.tape,
    width: W, height: H, sar: '1/1',
    workWidth: WORK_W, workHeight: WORK_H,
    jitterOriginX: Math.round((WORK_W - W) / 2),
    jitterOriginY: Math.round((WORK_H - H) / 2),
  },
  delivery: {
    ...base.delivery,
    width: W, height: H, tapeDisplayWidth: W, tapeDisplayHeight: H,
  },
};

// The drift chain with the sine taken out: same scale, same crop size, centred.
const coverW = WORK_W + DRIFT_X * 2;
const coverH = WORK_H + DRIFT_Y * 2;
const still = `[0:v]scale=${coverW}:${coverH}:force_original_aspect_ratio=increase,`
  + `crop=${WORK_W}:${WORK_H},format=yuv420p,setsar=1[drifted]`;

const src = path.join(REPO_ROOT, 'assets', 'places', `${id}.jpg`);
fs.mkdirSync(outDir, { recursive: true });

// AFTER -- the renderer's own grade, burnIn empty: the date stamp belongs to a
// tape somebody made, not to a demonstration of the grade.
const video = buildVideoFilter(look, cfg, { inLabel: 'drifted', outLabel: 'vout', burnIn: [] });
await runFfmpeg([
  '-y', '-loop', '1', '-framerate', String(cfg.fps), '-t', '1', '-i', src,
  '-filter_complex', `${still};${video}`, '-map', '[vout]',
  '-frames:v', '1', '-q:v', '4', path.join(outDir, 'tape.jpg'),
]);

// BEFORE -- the same crop at the tape stage's nominal jitter origin (8,6), no grade.
await runFfmpeg([
  '-y', '-loop', '1', '-framerate', String(cfg.fps), '-t', '1', '-i', src,
  '-filter_complex', `${still};[drifted]crop=${W}:${H}:${cfg.tape.jitterOriginX}:${cfg.tape.jitterOriginY}[vout]`,
  '-map', '[vout]', '-frames:v', '1', '-q:v', '4', path.join(outDir, 'photo.jpg'),
]);

for (const f of ['photo.jpg', 'tape.jpg']) {
  const p = path.join(outDir, f);
  console.log(`${f}  ${Math.round(fs.statSync(p).size / 1024)} kB`);
}
