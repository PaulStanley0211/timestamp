/**
 * The place loops: one seamless, graded, silent clip per place, for the web
 * background to play behind the UI.
 *
 * WHY THIS EXISTS RATHER THAN A PROVIDER CALL. Every input it needs is already
 * on disk -- `assets/places/<id>.jpg` and the tape look the product grades every
 * render with. Generating these through an image-to-video model would cost money
 * per place per revision, and would produce backgrounds whose look drifts away
 * from the tape the moment `config/look/base.json` is edited. Locally graded,
 * they are free, deterministic, and they inherit look changes for nothing.
 *
 * WHY 16:9 AND NOT THE TAPE RASTER. `config/render.json` describes PAL 4:3 at
 * 720x576 with SAR 16/15, which is right for the product's output and wrong for
 * a full-bleed page background: a viewport is wider than it is tall, and CSS
 * `cover` would crop most of a 4:3 frame away and then stretch what survived.
 * So the geometry is overridden here -- square pixels, no surround, no burn-in.
 * The GRADE is untouched: `buildVideoFilter` is the same function the renderer
 * calls, on the same profile.
 *
 * WHY THE DRIFT IS A SINE AND NOT A PAN. The clip has to loop with no visible
 * seam, and a linear pan cannot: it ends somewhere other than where it started,
 * so the wrap is a jump. One full period of a sine over the clip's duration
 * returns the window to its origin exactly, which makes the loop point
 * invisible without the reversal a palindrome would show.
 *
 * Usage:
 *   node scripts/tapedeck/place-loops.mjs                 # every place
 *   node scripts/tapedeck/place-loops.mjs --only=ostsee-strand
 *   node scripts/tapedeck/place-loops.mjs --crf=32 --seconds=8
 *   node scripts/tapedeck/place-loops.mjs --frames        # also dump stills to look at
 *   node scripts/tapedeck/place-loops.mjs --measure       # re-measure the SHIPPED loops, cut nothing
 *   node scripts/tapedeck/place-loops.mjs --measure --dir=build/place-loops
 *
 * `--measure` rewrites a directory's loops.json from the mp4s already in it
 * (assets/places by default) and touches no loop. It exists because the
 * manifest can want a statistic the loops were not cut with: on 2026-09-07
 * the solver gained a highlight beside the mean, and re-cutting seven
 * committed clips to add one number to a JSON file would have been the wrong
 * size of change.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, runFfmpeg, probe } from '../ffmpeg/run.mjs';
import { loadLookProfile, buildVideoFilter } from './look.mjs';

const OUT_DIR = path.join(REPO_ROOT, 'build', 'place-loops');
const SRC_DIR = path.join(REPO_ROOT, 'assets', 'places');

/** The background raster: the 16:9 TAPE raster from CLAUDE.md section 13, not a
 *  size chosen for the web. That section holds every shape's SHORT EDGE at 576
 *  precisely so one set of filtergraph constants stays correct in all of them --
 *  a 14px head-switch band is 14px of a 576-high picture whichever shape it is
 *  in. Picking 960x540 because it is a familiar web number would have scaled the
 *  band and the grain by 0.94 and made these the only pictures in the product
 *  whose tape is a slightly different tape. */
const W = 1024;
const H = 576;
/** Jitter headroom, divisible by 4 in both axes for chroma subsampling. The
 *  +16/+12 is lifted from the 4:3 tape rather than reinvented, so the origins
 *  come out at the same 8/6 the transport wobble has always been tuned against. */
const WORK_W = 1040;
const WORK_H = 588;
/** How far the window may travel from centre, in pixels of the work raster. */
const DRIFT_X = 36;
const DRIFT_Y = 18;

function parseArgs(argv) {
  const args = { flags: new Set() };
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const [key, ...rest] = raw.slice(2).split('=');
    if (rest.length === 0) args.flags.add(key);
    else args[key] = rest.join('=');
  }
  return args;
}

/**
 * Geometry for a square-pixel 16:9 background with the delivery stage collapsed
 * onto the tape stage, so nothing is pillarboxed and no surround is drawn.
 */
function backgroundCfg(base, { fps, seconds }) {
  return {
    ...base,
    fps,
    durationSeconds: seconds,
    aspect: '16:9',
    tape: {
      ...base.tape,
      width: W,
      height: H,
      sar: '1/1',
      workWidth: WORK_W,
      workHeight: WORK_H,
      jitterOriginX: Math.round((WORK_W - W) / 2),
      jitterOriginY: Math.round((WORK_H - H) / 2),
    },
    delivery: {
      ...base.delivery,
      width: W,
      height: H,
      tapeDisplayWidth: W,
      tapeDisplayHeight: H,
    },
  };
}

/**
 * Still -> a drifting clip at the work raster, as one filter chain ending in
 * `[drifted]`. `force_original_aspect_ratio=increase` guarantees the scaled
 * image covers the work raster on both axes whatever the source shape is, and
 * the amplitudes are clamped to the margin that actually exists so a portrait
 * source cannot drift off its own edge.
 */
function driftChain(seconds) {
  const coverW = WORK_W + DRIFT_X * 2;
  const coverH = WORK_H + DRIFT_Y * 2;
  const ax = `min(${DRIFT_X},(in_w-${WORK_W})/2)`;
  const ay = `min(${DRIFT_Y},(in_h-${WORK_H})/2)`;
  const phase = `(2*PI*t/${seconds})`;
  return (
    `[0:v]scale=${coverW}:${coverH}:force_original_aspect_ratio=increase,`
    + `crop=${WORK_W}:${WORK_H}:`
    + `'(in_w-${WORK_W})/2+${ax}*sin(${phase})':`
    + `'(in_h-${WORK_H})/2+${ay}*sin(${phase}+1.7)',`
    + `format=yuv420p,setsar=1[drifted]`
  );
}

/**
 * Mean and highlight luma of a finished loop, sampled across the drift.
 *
 * `signalstats` prints to stderr as metadata lines, one set per frame, and EVERY
 * frame is averaged rather than a handful sampled. Sampling would be the obvious
 * economy and it is a false one twice over: the crop window travels, so a beach
 * loop is more sky at one end of the sine and more sand at the other and any
 * fixed set of frames is a guess at the middle -- and picking frames means a
 * `select` expression, whose argument separator is a comma that has to survive
 * both JavaScript's escaping and ffmpeg's. A six-second clip is 150 frames and
 * decodes in about a second, so the exact answer is cheaper than the shortcut.
 *
 * THE HIGHLIGHT IS THE BRIGHTEST BLURRED PIXEL ANY FRAME SHOWS. A mean cannot
 * see a neon sign: solved on the mean alone, the three night places sat at the
 * scrim's floor while a browser read the band's hint at 1.57:1 over Tokyo's
 * highlights (2026-09-07). So the manifest carries the maximum luma as well --
 * after a 2px Gaussian blur, which stands in for the blur the page puts on the
 * loop (3 CSS px, about two source pixels on a laptop) and stops one grain
 * speck being the answer. The maximum over frames, not the mean of maxima,
 * because the brightest thing a stroke can sit beside is what the floor is
 * for. Single-threaded: full-frame gblur is deterministic, and a measurement
 * that differed by machine would be a manifest nobody could regenerate.
 */
export async function measureLuma(file) {
  const stats = async (filter, extra = []) => {
    const { stderr } = await runFfmpeg([
      '-v', 'info', ...extra, '-i', file,
      '-vf', `${filter}signalstats,metadata=print`,
      '-f', 'null', '-',
    ]);
    return stderr;
  };
  const plain = await stats('');
  const avgs = [...plain.matchAll(/YAVG=([0-9.]+)/g)].map((m) => Number(m[1]));
  if (avgs.length === 0) throw new Error(`signalstats printed no YAVG for ${file}`);
  const yavg = Number((avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(1));

  const blurred = await stats('gblur=sigma=2,', ['-filter_threads', '1']);
  const maxes = [...blurred.matchAll(/YMAX=([0-9.]+)/g)].map((m) => Number(m[1]));
  if (maxes.length === 0) throw new Error(`signalstats printed no YMAX for ${file}`);
  const yhigh = Math.max(...maxes);
  return { yavg, yhigh };
}

async function renderLoop({ id, src, cfg, look, seconds, crf, frames }) {
  const out = path.join(OUT_DIR, `${id}.mp4`);
  // burnIn is empty on purpose: the date stamp belongs to a tape the user made,
  // not to the wallpaper behind the menu they are making it with.
  const video = buildVideoFilter(look, cfg, { inLabel: 'drifted', outLabel: 'vout', burnIn: [] });
  const filterComplex = `${driftChain(seconds)};${video}`;

  const started = Date.now();
  await runFfmpeg([
    '-y',
    '-loop', '1', '-framerate', String(cfg.fps), '-t', String(seconds), '-i', src,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-an',
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-crf', String(crf), '-preset', 'slower',
    '-g', String(cfg.fps * seconds), '-keyint_min', String(cfg.fps),
    '-movflags', '+faststart',
    '-r', String(cfg.fps),
    out,
  ]);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const kb = Math.round(fs.statSync(out).size / 1024);

  // How bright the finished loop actually is. Sampled across the drift rather
  // than from one frame, because the window moves and a beach can be sky at 0s
  // and sand at 3s. The page needs this: a single scrim opacity cannot serve a
  // mean luma of 49 and one of 164, and guessing it per place by eye is how a
  // background ends up either invisible or fighting the text.
  const { yavg, yhigh } = await measureLuma(out);

  if (frames) {
    const frameDir = path.join(OUT_DIR, 'frames');
    fs.mkdirSync(frameDir, { recursive: true });
    for (const at of [0, seconds / 2]) {
      await runFfmpeg([
        '-y', '-ss', String(at), '-i', out, '-frames:v', '1',
        path.join(frameDir, `${id}-${String(at).replace('.', 'p')}s.png`),
      ]);
    }
  }
  return { id, kb, elapsed, yavg, yhigh };
}

/**
 * The manifest, MERGED into whatever the directory already holds. `--only=x`
 * is the normal way to re-cut one place after a look change, and a manifest
 * rebuilt from just that run would silently drop the other places -- which the
 * page reads as "no measurement" and answers with the white-photograph scrim,
 * so every other background would quietly go heavy while the one being worked
 * on looked right.
 */
/** The manifest already in a directory, or an empty one; unreadable is empty and says so. */
function readManifest(dir) {
  const manifestFile = path.join(dir, 'loops.json');
  if (!fs.existsSync(manifestFile)) return { loops: {}, raster: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    return { loops: parsed.loops ?? {}, raster: typeof parsed.raster === 'string' ? parsed.raster : null };
  } catch {
    console.log('  (existing loops.json was unreadable; rebuilding it from this run alone)');
    return { loops: {}, raster: null };
  }
}

/** The video raster of a loop on disk, as the manifest spells it. */
async function rasterOf(file) {
  const { streams = [] } = await probe(file);
  const v = streams.find((s) => s.codec_type === 'video');
  if (!v?.width || !v?.height) throw new Error(`ffprobe found no video stream in ${file}`);
  return `${v.width}x${v.height}`;
}

// `raster` is what the CALLER knows: the cutter cut at it, and --measure --
// which cuts nothing -- passes the manifest's own value, or the first loop's
// probed size when there was no manifest. The module constant is never stamped
// over a directory this run did not cut at it.
function writeManifest(dir, results, raster) {
  const manifestFile = path.join(dir, 'loops.json');
  const { loops } = readManifest(dir);
  for (const r of results) loops[r.id] = { yavg: r.yavg, yhigh: r.yhigh };

  const ordered = {};
  for (const id of Object.keys(loops).sort()) ordered[id] = loops[id];
  fs.writeFileSync(manifestFile, `${JSON.stringify({
    _comment: 'Per loop: yavg is the mean luma 0-255 averaged over every frame; yhigh is the highlight -- the brightest luma any frame shows after a 2px blur. The page solves each place\'s scrim from both: 8:1 for the band\'s ink on the mean, 4.5:1 on the highlight. Regenerate with: node scripts/tapedeck/place-loops.mjs (cuts and measures) or --measure (measures the loops on disk, cuts nothing)',
    raster,
    loops: ordered,
  }, null, 2)}\n`);
  console.log(`loops.json now describes ${Object.keys(ordered).length} loop(s)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.has('measure')) {
    const dir = args.dir ? path.resolve(REPO_ROOT, args.dir) : SRC_DIR;
    const ids = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.mp4'))
      .map((f) => f.slice(0, -4))
      .filter((id) => !args.only || id === args.only);
    if (ids.length === 0) {
      console.error(`no loops matched${args.only ? ` --only=${args.only}` : ''} in ${dir}`);
      process.exitCode = 1;
      return;
    }
    console.log(`measuring ${ids.length} loop(s) in ${dir}, cutting nothing`);
    const results = [];
    for (const id of ids) {
      process.stdout.write(`  ${id.padEnd(28)}`);
      const { yavg, yhigh } = await measureLuma(path.join(dir, `${id}.mp4`));
      results.push({ id, yavg, yhigh });
      console.log(`luma ${yavg}   highlight ${yhigh}`);
    }
    const raster = readManifest(dir).raster ?? await rasterOf(path.join(dir, `${ids[0]}.mp4`));
    writeManifest(dir, results, raster);
    return;
  }

  const seconds = Number(args.seconds ?? 6);
  const crf = Number(args.crf ?? 30);
  const frames = args.flags.has('frames');

  const base = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'render.json'), 'utf8'));
  const lookBase = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'look', 'base.json'), 'utf8'));
  const { look, clamped } = loadLookProfile(lookBase);
  if (clamped?.length) for (const c of clamped) console.log(`  clamped ${c.path}: ${c.from} -> ${c.to}`);
  const cfg = backgroundCfg(base, { fps: base.fps, seconds });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ids = fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.jpg'))
    .map((f) => f.slice(0, -4))
    .filter((id) => !args.only || id === args.only);

  if (ids.length === 0) {
    console.error(`no place stills matched${args.only ? ` --only=${args.only}` : ''} in ${SRC_DIR}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${ids.length} place(s) -> ${W}x${H} @ ${cfg.fps}fps, ${seconds}s, crf ${crf}`);
  const results = [];
  for (const id of ids) {
    const src = path.join(SRC_DIR, `${id}.jpg`);
    process.stdout.write(`  ${id.padEnd(28)}`);
    const r = await renderLoop({ id, src, cfg, look, seconds, crf, frames });
    results.push(r);
    console.log(`${String(r.kb).padStart(5)} kB   ${r.elapsed}s   luma ${r.yavg}   highlight ${r.yhigh}`);
  }
  const total = results.reduce((n, r) => n + r.kb, 0);
  console.log(`\ntotal ${total} kB across ${results.length} loop(s) -> ${OUT_DIR}`);

  // The measurement travels WITH the loops, because the page needs it and
  // nothing else can recover it: by the time a stylesheet is being generated the
  // mp4 is a byte range on a disk, and re-deriving it would mean running ffmpeg
  // inside a web request.
  writeManifest(OUT_DIR, results, `${W}x${H}`);
}

// Only when run as the command: a test imports measureLuma, and an import that
// cut seven loops would be a test that took minutes and rewrote build/.
// The comparison mirrors how node itself derives the main module's URL --
// resolve, realpath, then a file URL -- so a symlinked or differently-cased
// invocation matches exactly when node would have made this the main module,
// rather than a platform path-string compare that can miss and exit 0 having
// done nothing.
const invokedAs = process.argv[1] ? pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href : null;
if (invokedAs === import.meta.url) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exitCode = 1;
  });
}
