/**
 * argv builders. Pure: every function here returns an array of strings, and the
 * array is handed to `spawn` verbatim by ffmpeg/run.mjs. Nothing in this file
 * ever concatenates a command line, because a filtergraph contains brackets,
 * quotes, commas and semicolons and there is no escaping scheme that survives
 * cmd.exe, PowerShell and bash alike. Not using a shell is the only fix.
 *
 * Three flags below are load-bearing rather than stylistic:
 *
 *   -filter_complex_threads 1  is the global determinism net. gblur is
 *   slice-threaded and its IIR state at slice boundaries varies with thread
 *   count when a frame is short. Costs about 19% render time; buys a hard
 *   reproducibility guarantee. Do not remove it to speed up a render.
 *
 *   -stream_loop -1 makes a source shorter than fifteen seconds legal. It costs
 *   nothing when the source is long enough, and it means `npm run look` works
 *   against literally any clip in assets/stock rather than only long ones.
 *
 *   -frames:v with the exact count, rather than -t with a duration. 375 frames
 *   at 25fps is exactly 15.000s, and asserting a frame count is exact where
 *   asserting a float duration is an argument about rounding.
 */

/** Build the input portion of the argv. A file gets looped; a synthetic lavfi
 *  source gets its duration from the graph and must not be. */
function inputArgs(input) {
  if (typeof input === 'string') return ['-stream_loop', '-1', '-i', input];
  if (input?.file) return ['-stream_loop', '-1', '-i', input.file];
  if (input?.lavfi) return ['-f', 'lavfi', '-i', input.lavfi];
  throw new Error('input must be a path, {file}, or {lavfi}');
}

/**
 * The main render: clean footage in, tape out.
 *
 * @param {object}   args
 * @param {string|object} args.input     path, {file}, or {lavfi}
 * @param {string}   args.output         destination mp4
 * @param {string}   args.filterComplex  from buildVideoFilter()
 * @param {object}   args.cfg            config/render.json
 * @param {string}   [args.outLabel]     the graph's video out label
 * @param {string[]} [args.audioArgs]    M2 replaces the default -an
 * @param {string[]} [args.metadataArgs] container tags; default NONE, because
 *   this builder also renders real footage (the look CLI takes any clip in
 *   assets/stock) and a tag is a claim about the content. The delivered tape's
 *   AI-provenance tags come in through here from muxedArgs, which is the one
 *   caller whose output is always synthetic.
 */
export function gradeArgs({ input, output, filterComplex, cfg, outLabel = 'vout', audioArgs = ['-an'], metadataArgs = [] }) {
  const { encode } = cfg;
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-filter_complex_threads', String(encode.filterComplexThreads),
    ...inputArgs(input),
    '-filter_complex', filterComplex,
    '-map', `[${outLabel}]`,
    ...audioArgs,
    '-frames:v', String(cfg.totalFrames),
    '-r', String(cfg.fps),
    '-c:v', encode.videoCodec,
    '-profile:v', 'high',
    '-pix_fmt', encode.pixFmt,
    '-crf', String(encode.crf),
    '-preset', encode.preset,
    '-x264-params', encode.x264Params,
    ...metadataArgs,
    '-movflags', '+faststart',
    output,
  ];
}

/**
 * A side-by-side of the same moment, clean on the left and tape on the right.
 *
 * This is the single most useful review artifact in the whole project. Judging
 * a grade in isolation is nearly impossible -- the eye adapts within seconds
 * and everything starts to look normal. Against the original it does not.
 */
export function beforeAfterArgs({ original, graded, output, cfg }) {
  const halfW = Math.round(cfg.delivery.width / 2);
  const halfH = Math.round(cfg.delivery.height / 2);
  const filter =
    `[0:v]scale=${halfW}:${halfH}:force_original_aspect_ratio=decrease,` +
    `pad=${halfW}:${halfH}:(ow-iw)/2:(oh-ih)/2:color=0x000000,setsar=1[l];` +
    `[1:v]scale=${halfW}:${halfH}:force_original_aspect_ratio=decrease,` +
    `pad=${halfW}:${halfH}:(ow-iw)/2:(oh-ih)/2:color=0x000000,setsar=1[r];` +
    '[l][r]hstack=inputs=2,format=yuv420p[v]';

  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-filter_complex_threads', String(cfg.encode.filterComplexThreads),
    '-stream_loop', '-1', '-i', original,
    '-i', graded,
    '-filter_complex', filter,
    '-map', '[v]', '-an',
    '-frames:v', String(cfg.totalFrames),
    '-r', String(cfg.fps),
    '-c:v', cfg.encode.videoCodec,
    '-pix_fmt', cfg.encode.pixFmt,
    '-crf', String(cfg.encode.crf),
    '-preset', cfg.encode.preset,
    output,
  ];
}

/** Evenly spaced stills from the graded clip, as a numbered PNG sequence.
 *  Numeric tests cannot see an aesthetic regression; these can. */
export function framesArgs({ input, outputPattern, cfg, count = 8 }) {
  const step = Math.max(1, Math.floor(cfg.totalFrames / count));
  const picks = Array.from({ length: count }, (_, i) => `eq(n\\,${i * step})`).join('+');
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', input,
    '-vf', `select='${picks}'`,
    '-vsync', '0',
    '-frames:v', String(count),
    outputPattern,
  ];
}

/** Region statistics via signalstats, for the assertions in ffmpeg/assert.mjs.
 *  Cropping first is what lets one probe answer "is the surround dark" and
 *  another answer "did the date actually render", with no pixel comparison.
 *
 *  `input` MUST be relative to the spawn cwd. The `movie` source suffers the
 *  same drive-letter problem as `fontfile` -- a colon terminates the option, and
 *  the escaping that survives the filtergraph parser does not survive the filter
 *  option parser as well. A relative path has no colon and needs no escaping,
 *  which is why every caller spawns with cwd set to the repo root. */
export function regionStatsArgs({ input, region, frame = 12 }) {
  const file = String(input).replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(file)) {
    throw new Error(`regionStatsArgs needs a path relative to the repo root, got the absolute "${input}"`);
  }
  const crop = region
    ? `,crop=${region.w}:${region.h}:${region.x}:${region.y}`
    : '';
  return [
    '-v', 'error',
    '-f', 'lavfi',
    '-i', `movie=${file}${crop},signalstats`,
    // NAMED OUTPUT, NOT POSITIONAL, AND THIS WAS A REAL BUG UNTIL 2026-09-02.
    // ffprobe emits frame_tags in SIGNALSTATS' OWN ORDER, not the order they
    // are requested in -- measured: asking for YAVG,YMIN,YMAX,SATAVG returns
    // YMIN,YAVG,YMAX,SATAVG. So the positional read here had YAVG and YMIN
    // SWAPPED from the day it was written, which meant assertTapeGrade's black
    // floor was checking the AVERAGE luma and assertComposite's surround was
    // checking the MINIMUM. Both still passed, on the wrong statistic.
    // A csv row cannot say which number is which; json can.
    '-show_entries', 'frame_tags=lavfi.signalstats.YAVG,lavfi.signalstats.YMIN,lavfi.signalstats.YMAX,lavfi.signalstats.SATAVG,lavfi.signalstats.UAVG,lavfi.signalstats.VAVG',
    '-read_intervals', `%+#${frame}`,
    '-of', 'json',
  ];
}

/** Decoded-frame hashes to stdout. The purity test runs this five times and
 *  asserts they match -- five, because the gblur nondeterminism bug passed a
 *  two-run check and failed six out of six. */
export function frameHashArgs({ input, filterComplex, cfg, outLabel = 'vout' }) {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-filter_complex_threads', String(cfg.encode.filterComplexThreads),
    ...inputArgs(input),
    '-filter_complex', filterComplex,
    '-map', `[${outLabel}]`, '-an',
    '-frames:v', String(Math.min(cfg.totalFrames, 40)),
    '-f', 'framemd5', '-',
  ];
}
