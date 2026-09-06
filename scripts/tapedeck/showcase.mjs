/**
 * The showcase producer: one job directory in, one web-sized tape and its
 * poster out, into a directory that is NOT the repository.
 *
 *   node scripts/tapedeck/showcase.mjs --job=out/jobs/<id> --slot=hero-16x9 --out=build/showcase
 *   node scripts/tapedeck/showcase.mjs --job=out/jobs/<id> --slot=hero-16x9 --out=build/showcase --sticker=1 --at=12.0
 *   node scripts/tapedeck/showcase.mjs --job=out/jobs/<id> --slot=hero-16x9 --out=build/showcase --sticker=4 --at=14.5 --crop=stamp
 *
 * The delivered tape is never served: at crf 26 and 1080 lines it is 20-37 MB
 * and exists to be downloaded. The landing streams these instead -- 1280x720,
 * 540x960 and 960x720 at crf 28, muted, faststart, a few MB each.
 *
 * THE ART. 50 TAGS MUST SURVIVE, and the script checks rather than hopes:
 * `-map_metadata 0` carries them, ffprobe reads them back, and a file that
 * lost either is deleted and the run fails. The same guard the re-encode on
 * the box carried on 2026-09-05 (CLAUDE.md section 64D).
 *
 * Untested for what it LOOKS like, exactly as wipe-pair.mjs and place-loops.mjs
 * are: the owner judges the frames. What is tested is the raster, the silence,
 * the tags and the refusal.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { runFfmpeg, runFfprobe } from '../ffmpeg/run.mjs';

const CRF = '28';

/** Per slot: the filter that turns the delivered file into the web file. The
 *  4:3 delivery is the 4:3 picture matted inside 1080x1920 -- rows 555..1364
 *  (CLAUDE.md section 31 measured the middle half) -- so it is cropped out
 *  before it is scaled. */
export const SLOTS = Object.freeze({
  'hero-16x9': { vf: 'scale=1280:720', width: 1280, height: 720 },
  'tape-9x16': { vf: 'scale=540:960', width: 540, height: 960 },
  'tape-4x3': { vf: 'crop=1080:810:0:555,scale=960:720', width: 960, height: 720 },
});

/** The bottom-right region a burnt-in stamp sits in, as a fraction of the frame. */
const STAMP_CROP = 'crop=iw*0.34:ih*0.20:iw*0.64:ih*0.78';

async function tagsOf(file) {
  const out = await runFfprobe(['-v', 'error', '-show_entries', 'format_tags=comment,description', '-of', 'json', file]);
  const text = typeof out === 'string' ? out : out.stdout;
  return JSON.parse(text).format?.tags ?? {};
}

function assertProvenance(tags, what) {
  if (!/AI-generated/.test(tags.comment ?? '') || !/trainedAlgorithmicMedia/.test(tags.description ?? '')) {
    throw new Error(`${what} does not carry the provenance tags (comment and description); refusing to publish a tape that does not say what it is`);
  }
}

/**
 * @param {{jobDir: string, slot: keyof SLOTS, outDir: string, sticker?: number, stickerAt?: number, crop?: 'stamp'|null}} o
 * @returns {Promise<string[]>} the files written
 */
export async function produceShowcase({ jobDir, slot, outDir, sticker = null, stickerAt = 0, crop = null }) {
  const spec = SLOTS[slot];
  if (!spec) throw new Error(`unknown slot ${slot}; one of ${Object.keys(SLOTS).join(', ')}`);
  const src = path.join(jobDir, 'timestamp.mp4');
  if (!fs.existsSync(src)) throw new Error(`no delivered tape at ${src}`);
  assertProvenance(await tagsOf(src), src);
  fs.mkdirSync(outDir, { recursive: true });

  if (sticker !== null) {
    const out = path.join(outDir, `sticker-${sticker}.jpg`);
    const vf = [crop === 'stamp' ? STAMP_CROP : spec.vf.startsWith('crop=') ? spec.vf.split(',')[0] : null, 'scale=480:-2'].filter(Boolean).join(',');
    await runFfmpeg(['-y', '-ss', String(stickerAt), '-i', src, '-frames:v', '1', '-vf', vf, '-q:v', '3', out]);
    return [out];
  }

  const video = path.join(outDir, `${slot}.mp4`);
  const poster = path.join(outDir, `${slot}.jpg`);
  const tmp = `${video}.part.mp4`;
  await runFfmpeg([
    '-y', '-i', src, '-map', '0:v:0', '-an', '-vf', spec.vf,
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', CRF, '-preset', 'slow',
    '-movflags', '+faststart', '-map_metadata', '0', tmp,
  ]);
  try {
    assertProvenance(await tagsOf(tmp), tmp);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  fs.renameSync(tmp, video);
  // The poster is the LAST frame of the encoded file, so it matches the loop
  // point exactly and the swap from poster to video is invisible.
  await runFfmpeg(['-y', '-sseof', '-0.08', '-i', video, '-frames:v', '1', '-update', '1', '-q:v', '3', poster]);
  return [video, poster];
}

function parseArgs(argv) {
  const o = {};
  for (const a of argv) {
    const m = /^--([a-z]+)=(.*)$/.exec(a);
    if (!m) throw new Error(`unknown argument ${a}`);
    o[m[1]] = m[2];
  }
  return o;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = parseArgs(process.argv.slice(2));
  const files = await produceShowcase({
    jobDir: a.job, slot: a.slot, outDir: a.out,
    sticker: a.sticker ? Number(a.sticker) : null, stickerAt: a.at ? Number(a.at) : 0, crop: a.crop ?? null,
  });
  for (const f of files) console.log(`${path.basename(f)}  ${Math.round(fs.statSync(f).size / 1024)} kB`);
}
