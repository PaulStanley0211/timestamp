/**
 * The fixture provider. A REAL implementation, not a stub.
 *
 * WHY THIS FILE IS NOT TWENTY LINES THAT RETURN FAKE PATHS. A stub provider
 * makes every downstream test a test of the stub. The pipeline would "pass"
 * against paths that do not exist, `assemble` would concat nothing, the
 * zero-audio-stream assertion would have no file to assert against, the
 * contact sheet would show broken images, and the queue would exercise a
 * provider that returns instantly -- which is the one behaviour a real
 * provider never has. Every one of those is a bug that would then be
 * discovered for the first time on a paid call.
 *
 * So this writes real PNGs and real mp4s by spawning ffmpeg through
 * `ffmpeg/run.mjs` (the only module in the repo permitted to spawn), at the
 * requested size, at `cfg.fps`, with zero audio streams, deterministic from
 * the seed, and slow on purpose. That is what makes the whole application
 * runnable and assertable for $0 -- which is also why M1 came before M5.
 *
 * VISUALLY DISTINGUISHABLE IS A REQUIREMENT, NOT A NICETY. `select` shows a
 * human a contact sheet of N stills and asks them to pick one. If the fixture
 * emits N identical grey rectangles, the contact sheet renders, the click
 * works, the test passes, and nobody notices that the page is showing still 1
 * three times until a paid run does the same thing for a different reason.
 * Each still therefore gets its own palette, its own box layout, a tally of
 * solid bars along the top that counts the index, and -- when a font resolves
 * -- the index and seed burned in with drawtext.
 *
 * THE FONT IS A SOFT DEPENDENCY HERE AND A HARD ONE IN tapedeck/. `assets/
 * fonts/tape-osd.ttf` is not bundled yet, so `resolveFont()` may return null.
 * The date stamp on the finished tape must never silently vanish -- that is
 * what `assertBurnIn` is for -- but a fixture that refuses to run because a
 * font is missing would block the entire application build over a cosmetic
 * label. So no font means shape-only: the tally bars and the seeded palette
 * still tell still 1 from still 3, they just do it without words.
 *
 * WHAT IS BANNED FROM THIS FILTERGRAPH, and why the bans are not theoretical:
 *
 *   `gradients` -- every colour option defaults to `random`. A fixture built
 *   on it would produce different bytes every run and quietly destroy the one
 *   property this provider exists to give the rest of the repo.
 *
 *   `anoisesrc` without `seed=` -- defaults to -1, which is entropy. Not used
 *   here at all, because this provider emits no audio whatsoever.
 *
 *   `%{localtime}` / `expansion=strftime` -- reads the wall clock. Every
 *   string that reaches drawtext below is computed in Node from the seed and
 *   passed as a literal, exactly as tapedeck/burn-in.mjs does it.
 *
 *   `testsrc2` -- deterministic, but its pattern is identical for every seed,
 *   so it fails the "tell still 1 from still 3" requirement that is half the
 *   point. Everything here is built from `color=` plus fully-specified
 *   drawbox/drawgrid/drawtext, where there is no default left to be random.
 *
 * TWO MEASURED SURPRISES ABOUT ANIMATING A drawbox, so nobody re-derives them.
 *
 *   `drawbox` does NOT expose `n` (frame number) in its geometry expressions
 *   in this build. It fails loudly -- "Undefined constant or missing '(' in
 *   'n/49'" -- which is the good kind of failure.
 *
 *   `drawbox` DOES accept `t` in those expressions, and `t` there is the box
 *   THICKNESS, not the timestamp. That is the bad kind: with `t=fill` the
 *   thickness is a huge sentinel, so `w='W*t/2'` evaluates enormous, clamps to
 *   the frame width, and the "progress bar" renders full-width on every frame
 *   with no error at all. Measured: identical luma in the bar's right-hand
 *   third at frames 0, 24 and 49 of a 50-frame clip. It looked like a bar. It
 *   was a stripe.
 *
 * `crop` exposes `n` and `drawbox` supports timeline `enable=`, whose `t` IS
 * the timestamp. So the pan uses crop with `n`, and the bar is a row of static
 * chunks each gated by `enable='gte(t,...)'` -- verified dark at frame 0 and
 * lit at frame 49. Both are functions of the frame index and the fixed fps, so
 * the clip is byte-identical across repeated runs.
 *
 * THE SIMULATED LATENCY IS LOAD-BEARING. A provider that returns in 3ms lets
 * a queue with a broken lease, a status page that never polls, and a worker
 * that never heartbeats all look like they work. `latencyMs` defaults to 250,
 * is split across the phases a real provider actually has (submit, queued,
 * running, download), and goes through `ctx.sleepImpl` so a test can collapse
 * it to zero without pretending the phases do not exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import { runFfmpeg, probe, REPO_ROOT } from '../ffmpeg/run.mjs';
import { ffFontPath, ffEscapeText } from '../tapedeck/burn-in.mjs';
import { resolveFont } from '../preflight/doctor.mjs';
import { deriveSeed, SEED_MAX } from '../compose/seed.mjs';
import { TerminalError, CapabilityError } from './errors.mjs';
import { cost } from './pricing.mjs';
import {
  FIRST_INDEX,
  assertStillRequest,
  assertVideoRequest,
  assertCapableStill,
  assertCapableVideo,
} from './contract.mjs';

export const FIXTURE_ID = 'fixture';
export const STILL_MODEL = 'fixture/still-v1';
export const VIDEO_MODEL = 'fixture/video-v1';

/** Matches config/models.json. 8 seconds because that is the number
 *  docs/interfaces.md uses in its own example segment plan, and because a
 *  fixture that claimed 15 would let the pipeline skip the segment-chaining
 *  path entirely -- the path most likely to be wrong on the real provider. */
/** How many steps the clip's progress bar grows in. Twelve reads as motion in
 *  a thumbnail without turning the graph into a wall of drawbox calls. */
export const PROGRESS_CHUNKS = 12;

export const FIXTURE_CAPABILITIES = Object.freeze({
  maxClipSeconds: 8,
  stillSizes: Object.freeze([Object.freeze({ width: 1024, height: 768 })]),
  maxReferences: 2,
  supportsNativeAudioOff: true,
  supportsPlaceReference: true,
});

// ---------------------------------------------------------------------------
// Pure builders. Everything below this line down to createFixtureProvider()
// returns strings and argv arrays and touches nothing -- same boundary as
// tapedeck/, and for the same reason: it makes most of this file assertable
// with golden strings and no ffmpeg at all.
// ---------------------------------------------------------------------------

/** Round to an even number. yuv420p subsamples chroma 2x2 and rejects an odd
 *  dimension outright, so the pan's oversized intermediate has to be even. */
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

const pad2 = (n) => String(n).padStart(2, '0');

/** A number safe to drop into a filtergraph: no float noise, which is what
 *  makes golden-string tests stable. Same trick as audio/bed.mjs. */
const num = (v, digits = 4) => String(Number(Number(v).toFixed(digits)));

/**
 * HSV to `0xRRGGBB`. Written out rather than pulled from a palette table
 * because a hue is what makes N stills differ at a glance -- a table would
 * repeat every N entries and two stills in one contact sheet would collide.
 */
function hsvToHex(h, s, v) {
  const hp = ((((h % 360) + 360) % 360)) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = v - c;
  const rgb = hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
      : hp < 3 ? [0, c, x]
        : hp < 4 ? [0, x, c]
          : hp < 5 ? [x, 0, c]
            : [c, 0, x];
  const hex = rgb.map((n2) => Math.round((n2 + m) * 255).toString(16).padStart(2, '0').toUpperCase()).join('');
  return `0x${hex}`;
}

/**
 * A per-still palette, derived from (seed, index) through the repo's own hash.
 *
 * `deriveSeed` is reused rather than a second hash being written here, for the
 * reason its own header gives: FNV-1a's low bits correlate for keys sharing a
 * prefix, and every key here shares one. A hand-rolled `seed * 137 % 360` would
 * put stills 1..3 of the same job at nearly the same hue, which is exactly the
 * failure this palette exists to prevent.
 */
export function fixturePalette(seed, index) {
  const hue = deriveSeed(String(seed), 'fixture-palette', index) % 360;
  return {
    hue,
    bg: hsvToHex(hue + 205, 0.38, 0.16),
    field: hsvToHex(hue, 0.52, 0.66),
    accent: hsvToHex(hue + 38, 0.78, 0.94),
    grid: hsvToHex(hue + 180, 0.22, 0.72),
    ink: hsvToHex(hue, 0.06, 0.97),
  };
}

/** Three accent rectangles whose positions and sizes come off the same hash.
 *  Deterministic, and different enough per index that the silhouette of a
 *  still is recognisable in a contact sheet thumbnail. */
function accentBoxes(seed, index, { width, height }) {
  return [0, 1, 2].map((i) => {
    const h = deriveSeed(String(seed), `fixture-box-${i}`, index);
    const w = Math.round(width * (0.10 + ((h >>> 3) % 23) / 100));
    const ht = Math.round(height * (0.08 + ((h >>> 9) % 27) / 100));
    return {
      w,
      h: ht,
      x: Math.round((h % Math.max(1, width - w))),
      y: Math.round(((h >>> 5) % Math.max(1, height - ht))),
    };
  });
}

/**
 * The still filtergraph, as one lavfi source string.
 *
 * @param {object} a
 * @param {number} a.seed
 * @param {number} a.index                 1-based
 * @param {{width:number,height:number}} a.size
 * @param {string|null} [a.fontPath]       null => shape-only, no drawtext
 * @returns {string}
 */
export function fixtureStillFilter({ seed, index, size, fontPath = null }) {
  const { width, height } = size;
  const p = fixturePalette(seed, index);
  const m = Math.round(width * 0.035);

  const parts = [
    // A flat, fully-specified colour. Nothing here has a default that could be
    // `random` -- see the header's list of banned sources.
    `color=c=${p.bg}:s=${width}x${height}:r=1:d=1`,
    `drawgrid=w=${Math.round(width / 16)}:h=${Math.round(height / 12)}:t=1:c=${p.grid}@0.16`,
  ];

  // The "subject" block, offset off-centre so the frame has a composition
  // rather than a target.
  const fw = Math.round(width * 0.46);
  const fh = Math.round(height * 0.52);
  parts.push(`drawbox=x=${Math.round(width * 0.30)}:y=${Math.round(height * 0.26)}:w=${fw}:h=${fh}:c=${p.field}@1:t=fill`);

  for (const b of accentBoxes(seed, index, size)) {
    parts.push(`drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:c=${p.accent}@0.82:t=fill`);
  }

  // The tally. This is the index cue that survives a missing font, and it is
  // deliberately large enough to read in a 160px contact-sheet thumbnail.
  // tallyW/tallyH rather than tw/th on purpose: `tw` and `th` are drawtext's
  // OWN variables for text width and height, and they appear literally in the
  // y= expression a few lines below. Same-named JS locals here would read as
  // if the two were related, and they are not.
  const tallyW = Math.round(width * 0.045);
  const tallyH = Math.round(height * 0.085);
  const gap = Math.round(width * 0.022);
  for (let i = 0; i < index; i += 1) {
    parts.push(`drawbox=x=${m + i * (tallyW + gap)}:y=${m}:w=${tallyW}:h=${tallyH}:c=${p.ink}@1:t=fill`);
  }

  if (fontPath) {
    const font = ffFontPath(fontPath);
    const big = Math.round(height * 0.17);
    const small = Math.max(10, Math.round(height * 0.034));
    const common = `fontfile=${font}:fontcolor=${p.ink}:shadowcolor=0x120E0A:shadowx=2:shadowy=2`;
    parts.push(`drawtext=text='${ffEscapeText(pad2(index))}':${common}:fontsize=${big}:x=${m}:y=${m + tallyH + Math.round(height * 0.03)}`);
    // Seed and size in the picture, not just in the manifest: when a contact
    // sheet looks wrong the first question is always "which seed produced
    // that", and a filename does not survive a screenshot pasted into chat.
    // `th` in this expression is DRAWTEXT's text height, evaluated by ffmpeg --
    // the same idiom tapedeck/burn-in.mjs uses to sit a stamp against an edge.
    parts.push(`drawtext=text='${ffEscapeText(`fixture still ${pad2(index)}  seed ${seed}  ${width}x${height}`)}':${common}:fontsize=${small}:x=${m}:y=h-th-${m}`);
  }

  parts.push('format=rgb24');
  return parts.join(',');
}

/** argv for one still. Handed to spawn verbatim; never concatenated into a
 *  shell string -- a filtergraph is dense with the characters cmd.exe,
 *  PowerShell and bash each mangle differently. */
export function fixtureStillArgs({ filter, output, threads = 1 }) {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-filter_complex_threads', String(threads),
    '-f', 'lavfi', '-i', filter,
    '-frames:v', '1',
    // -update 1 tells the image2 muxer this is one file and not a numbered
    // sequence. Without it ffmpeg warns about a missing pattern on every call.
    '-update', '1',
    output,
  ];
}

/**
 * The clip filtergraph: the approved still, panned, with a progress bar that
 * makes motion obvious at a glance and makes the last frame of segment N
 * visibly different from its first -- which is the thing the segment-chaining
 * path has to get right.
 *
 * @param {object} a
 * @param {number} a.seed
 * @param {number} a.index                 1-based segment number
 * @param {number} a.seconds
 * @param {number} a.frames
 * @param {{width:number,height:number}} a.size
 * @param {string|null} [a.fontPath]
 * @param {string} [a.inLabel]
 * @param {string} [a.outLabel]
 */
export function fixtureVideoFilter({
  seed, index, seconds, frames, size, fontPath = null, inLabel = '0:v', outLabel = 'vout',
}) {
  const { width, height } = size;
  const p = fixturePalette(seed, index);
  // Phase off the seed so two segments of one job do not pan in lockstep.
  const phase = num((deriveSeed(String(seed), 'fixture-pan', index) % 628) / 100);
  const sw = even(width * 1.08);
  const sh = even(height * 1.08);
  // A full cycle over the clip. `n` is the frame index -- deterministic, and
  // available in crop's expressions (it is NOT available in drawbox's; see the
  // header).
  const period = Math.max(1, frames);

  const chain = [
    `scale=${sw}:${sh}:flags=bicubic`,
    `crop=${width}:${height}:` +
      `x='(iw-ow)/2+((iw-ow)/2)*sin(2*PI*n/${period}+${phase})':` +
      `y='(ih-oh)/2+((ih-oh)/2)*cos(2*PI*n/${period}+${phase})'`,
  ];

  // The progress bar, as PROGRESS_CHUNKS static rectangles each switched on by
  // a timeline `enable`. A single box with an animated width is the obvious
  // implementation and it silently does not work -- see the header. Chunky is
  // also easier to read in a thumbnail than a smooth sweep.
  const barH = Math.max(4, Math.round(height * 0.018));
  for (let i = 0; i < PROGRESS_CHUNKS; i += 1) {
    const x0 = Math.round((i * width) / PROGRESS_CHUNKS);
    const x1 = Math.round(((i + 1) * width) / PROGRESS_CHUNKS);
    chain.push(
      `drawbox=x=${x0}:y=${height - barH}:w=${x1 - x0}:h=${barH}:c=${p.accent}@0.9:t=fill:` +
      `enable='gte(t,${num((i * seconds) / PROGRESS_CHUNKS)})'`,
    );
  }

  if (fontPath) {
    const small = Math.max(10, Math.round(height * 0.034));
    chain.push(
      `drawtext=text='${ffEscapeText(`fixture seg ${pad2(index)}  seed ${seed}  ${num(seconds)}s`)}':` +
      `fontfile=${ffFontPath(fontPath)}:fontcolor=${p.ink}:shadowcolor=0x120E0A:shadowx=2:shadowy=2:` +
      `fontsize=${small}:x=${Math.round(width * 0.035)}:y=${height - barH - small - Math.round(height * 0.02)}`,
    );
  }

  chain.push('format=yuv420p');
  return `[${inLabel}]${chain.join(',')}[${outLabel}]`;
}

/** argv for one clip. `-an` is belt to the graph's braces: there is no audio
 *  source in the filtergraph and no audio stream in the input, so zero audio
 *  streams is structural. `-an` is the flag layer 3 will verify anyway. */
export function fixtureVideoArgs({ imagePath, filter, output, cfg, frames, outLabel = 'vout' }) {
  const { encode } = cfg;
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-filter_complex_threads', String(encode.filterComplexThreads),
    '-framerate', String(cfg.fps),
    '-loop', '1', '-i', imagePath,
    '-filter_complex', filter,
    '-map', `[${outLabel}]`,
    '-an',
    // A frame count, not a duration. Same reasoning as tapedeck/grade.mjs:
    // asserting an integer frame count is exact where asserting a float
    // duration is an argument about rounding.
    '-frames:v', String(frames),
    '-r', String(cfg.fps),
    '-c:v', encode.videoCodec,
    '-profile:v', 'high',
    '-pix_fmt', encode.pixFmt,
    '-crf', String(encode.crf),
    '-preset', encode.preset,
    '-x264-params', encode.x264Params,
    '-movflags', '+faststart',
    output,
  ];
}

/** `stills/still-01.png`, matching the manifest layout in
 *  docs/interfaces.md section 1 exactly. */
export function fixtureStillName(index) {
  return `still-${pad2(index)}.png`;
}

/**
 * `segments/seg-01.mp4` when the caller passed an index, and a hash of the
 * idempotency key when it did not.
 *
 * VideoRequest carries no index in interfaces.md, but the manifest layout
 * names provider output `segments/seg-01.mp4`, so something has to supply the
 * number. The hash fallback is collision-free and stable across a retry, which
 * is the property that actually matters -- it just does not match the
 * documented filename, so the pipeline should pass `index`.
 */
export function fixtureClipName({ index, idempotencyKey }) {
  if (Number.isInteger(index)) return `seg-${pad2(index)}.mp4`;
  return `clip-${deriveSeed(idempotencyKey, 'fixture-clip', 0).toString(16).padStart(8, '0')}.mp4`;
}

/** A request id that is a pure function of the idempotency key. A real
 *  provider's id comes back from the far end; ours has to come from somewhere,
 *  and deriving it means a resumed job recomputes the same id instead of
 *  minting a second one for the same work. */
export function fixtureRequestId(idempotencyKey) {
  return `fixture-${deriveSeed(idempotencyKey, 'fixture-request', 0).toString(16).padStart(8, '0')}`;
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function loadRenderCfg({ root = REPO_ROOT, readImpl = fs.readFileSync } = {}) {
  return JSON.parse(readImpl(path.join(root, 'config', 'render.json'), 'utf8'));
}

const fail = (code, message, detail = null) => new TerminalError(message, { provider: FIXTURE_ID, code, detail });

function requireOutDir(ctx) {
  const outDir = ctx?.outDir;
  if (typeof outDir !== 'string' || !path.isAbsolute(outDir)) {
    throw fail('invalid_ctx', `ctx.outDir must be an absolute path, got ${JSON.stringify(outDir)}`);
  }
  return outDir;
}

/** A cancel is a decision, not a fault: terminal, never retried, and it must
 *  be checked between phases rather than only at the top, or a cancelled job
 *  still pays for the work already in flight. */
function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw fail('aborted', `${FIXTURE_ID}: cancelled via ctx.signal`, { reason: String(signal.reason ?? 'aborted') });
  }
}

/**
 * Build a fixture provider.
 *
 * @param {object} [opts]
 * @param {object} [opts.cfg]              config/render.json; loaded if absent
 * @param {number} [opts.latencyMs]        simulated round trip, default 250
 * @param {string|null} [opts.fontPath]    pass null to force the shape-only path
 * @param {function} [opts.runFfmpegImpl]
 * @param {function} [opts.existsImpl]
 */
export function createFixtureProvider(opts = {}) {
  const cfg = opts.cfg ?? loadRenderCfg();
  const latencyMs = opts.latencyMs ?? 250;
  // `undefined` means "resolve one"; an explicit `null` means "there is no
  // font, take the shape-only path" -- which a test needs to be able to say on
  // a machine that happens to have consola.ttf.
  const fontPath = Object.hasOwn(opts, 'fontPath') ? opts.fontPath : resolveFont().path;
  const runFfmpegImpl = opts.runFfmpegImpl ?? runFfmpeg;
  const existsImpl = opts.existsImpl ?? fs.existsSync;

  if (!Number.isFinite(latencyMs) || latencyMs < 0) {
    throw new TypeError(`latencyMs must be a non-negative number, got ${JSON.stringify(latencyMs)}`);
  }

  /** Emit a progress event, guarding the phase name so a typo here fails the
   *  contract test rather than rendering as a blank step on the status page. */
  function progress(ctx, phase, pct, message) {
    ctx?.onProgress?.({ phase, pct, ...(message ? { message } : {}) });
  }

  /** The simulated round trip, split across the phases a real provider has.
   *  `sleepImpl(ms)` matches Ad-Regenerator's meta-adapter signature so a test
   *  collapses it with `async () => {}`. */
  async function phaseSleep(ctx, fraction) {
    const sleep = ctx?.sleepImpl ?? defaultSleep;
    await sleep(Math.round(latencyMs * fraction));
    throwIfAborted(ctx?.signal);
  }

  const provider = {
    id: FIXTURE_ID,
    /** False, and that is the whole point of this provider: it makes the
     *  application runnable end to end without a credential in the process. */
    paid: false,
    capabilities: FIXTURE_CAPABILITIES,

    async generateStill(req, ctx = {}) {
      const startedAt = performance.now();
      assertStillRequest(req);
      assertCapableStill(provider, req);
      const outDir = requireOutDir(ctx);
      throwIfAborted(ctx.signal);

      // The fixture never reads a reference image, but it checks that one is
      // there. A real provider uploads it and would discover the missing file
      // remotely, after the request was accepted and possibly billed; finding
      // it here costs nothing and is the same class of error either way.
      for (const ref of req.references) {
        if (!existsImpl(ref.path)) {
          throw fail('missing_reference', `${FIXTURE_ID}: reference image not found: ${ref.path}`, { role: ref.role, path: ref.path });
        }
      }

      fs.mkdirSync(outDir, { recursive: true });

      progress(ctx, 'submit', 0, `${req.count} still(s)`);
      await phaseSleep(ctx, 0.3);
      progress(ctx, 'queued', 10);
      await phaseSleep(ctx, 0.5);

      const stills = [];
      for (let i = 0; i < req.count; i += 1) {
        const index = i + FIRST_INDEX;
        // One request carries one seed and asks for N images, so the provider
        // fans out. Sequential rather than hashed because a manifest reader
        // should be able to see at a glance that still 3 of seed 1000 is 1002
        // -- and because it is what remote image APIs do, so the fixture is
        // not teaching the pipeline a habit fal will not honour.
        const seed = (req.seed + i) % (SEED_MAX + 1);
        const output = path.join(outDir, fixtureStillName(index));
        const filter = fixtureStillFilter({ seed, index, size: req.size, fontPath });
        await runFfmpegImpl(fixtureStillArgs({
          filter,
          output,
          threads: cfg.encode.filterComplexThreads,
        }));
        stills.push({ path: output, index, seed });
        progress(ctx, 'running', Math.round(10 + (70 * (i + 1)) / req.count));
        throwIfAborted(ctx.signal);
      }

      progress(ctx, 'download', 90);
      await phaseSleep(ctx, 0.2);
      progress(ctx, 'done', 100);

      return {
        stills,
        // Always zero, and `actual` is a metered zero rather than the usual
        // null: "not metered yet" would be a lie here, because we know exactly
        // what local ffmpeg charges. The fixture deliberately does NOT read
        // config/pricing.json -- a fixture that could ever report a non-zero
        // cost is a fixture that can lie about money.
        cost: cost(0, 0),
        meta: {
          model: STILL_MODEL,
          requestId: fixtureRequestId(req.idempotencyKey),
          latencyMs: Math.round(performance.now() - startedAt),
        },
      };
    },

    async generateVideo(req, ctx = {}) {
      const startedAt = performance.now();
      assertVideoRequest(req);
      assertCapableVideo(provider, req);
      const outDir = requireOutDir(ctx);
      throwIfAborted(ctx.signal);

      if (!existsImpl(req.imagePath)) {
        throw fail('missing_image', `${FIXTURE_ID}: start image not found: ${req.imagePath}`, { path: req.imagePath });
      }

      const frames = Math.round(req.seconds * cfg.fps);
      if (frames < 1) {
        throw new CapabilityError(
          `${FIXTURE_ID}: ${req.seconds}s at ${cfg.fps}fps rounds to ${frames} frames`,
          { provider: FIXTURE_ID, code: 'clip_too_short', detail: { seconds: req.seconds, fps: cfg.fps } },
        );
      }

      fs.mkdirSync(outDir, { recursive: true });

      progress(ctx, 'submit', 0, `${req.seconds}s at ${cfg.fps}fps`);
      await phaseSleep(ctx, 0.3);
      progress(ctx, 'queued', 15);
      await phaseSleep(ctx, 0.5);
      progress(ctx, 'running', 40);

      // The clip is literally the approved still in motion, which is the point:
      // it exercises the image -> video seam, and the last frame of segment N
      // is a real frame that segment N+1 can be started from.
      const size = await stillSize(req.imagePath, { probeImpl: opts.probeImpl });
      const output = path.join(outDir, fixtureClipName(req));
      const filter = fixtureVideoFilter({
        seed: req.seed,
        index: Number.isInteger(req.index) ? req.index : FIRST_INDEX,
        seconds: req.seconds,
        frames,
        size,
        fontPath,
      });
      await runFfmpegImpl(fixtureVideoArgs({ imagePath: req.imagePath, filter, output, cfg, frames }));
      throwIfAborted(ctx.signal);

      progress(ctx, 'download', 90);
      await phaseSleep(ctx, 0.2);
      progress(ctx, 'done', 100);

      return {
        clip: { path: output, seconds: frames / cfg.fps },
        cost: cost(0, 0),
        meta: {
          model: VIDEO_MODEL,
          requestId: fixtureRequestId(req.idempotencyKey),
          latencyMs: Math.round(performance.now() - startedAt),
        },
      };
    },
  };

  return provider;
}

/**
 * The start image's dimensions, without importing an image library.
 *
 * ffprobe is already a hard dependency and `ffmpeg/run.mjs` is the only module
 * allowed to spawn, so this goes through `probe` rather than reaching for
 * `sharp` -- see CLAUDE.md, "Common mistakes". Falls back to the single
 * declared still size if the probe cannot answer: a clip rendered at the
 * contracted size is recoverable, a step that failed because ffprobe was
 * unhappy about a PNG is not worth the outage.
 */
async function stillSize(imagePath, { probeImpl = probe } = {}) {
  try {
    const info = await probeImpl(imagePath);
    const v = (info.streams ?? []).find((s) => s.codec_type === 'video');
    if (v?.width > 0 && v?.height > 0) return { width: even(v.width), height: even(v.height) };
  } catch {
    /* fall through to the declared size */
  }
  return { ...FIXTURE_CAPABILITIES.stillSizes[0] };
}
