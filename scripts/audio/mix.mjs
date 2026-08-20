/**
 * Where the picture and the bed become one command.
 *
 * ONE INVOCATION IS THE WHOLE POINT OF THIS FILE. The obvious shape -- render
 * the tape, render the bed, then `ffmpeg -i tape.mp4 -i bed.wav -c:v copy` --
 * looks harmless because the third pass says `copy`. It is not harmless: it
 * costs a temp file, a second process, an error path that can leave a half
 * product on disk, and a build step whose two halves can drift out of sync
 * (change the frame count in one place and the mux silently truncates). And the
 * moment anyone "tidies" that third pass by dropping the `copy`, the picture is
 * encoded twice -- real, measurable generation loss stacked on top of a look
 * whose entire subject is generation loss. Splicing two pure filtergraph strings
 * with a semicolon costs one function and removes all of it.
 *
 * THE MODEL'S AUDIO IS EXCLUDED STRUCTURALLY, NOT BY `-an`.
 *
 * A modern generation model emits its own audio by default (CLAUDE.md, "Set the
 * video model's native audio OFF"), and if it reaches the mux the video has two
 * ambiences arguing. `-an` would suppress it -- but `-an` is a flag you can
 * forget, and it fights the audio we DO want, so the moment the bed is wired up
 * the temptation is to delete it and let ffmpeg's default stream selection pick
 * something. Default stream selection picks the input's audio. Instead every
 * output stream is named: `-map [vout] -map [aout]`, both of them filter outputs,
 * neither of them an input stream. Input 0's audio is not excluded by a flag; it
 * is excluded because nothing in the command refers to it. audio/bed.mjs holds
 * up the other end -- its graph has no input pads at all.
 *
 * MEASURING IS NOT THE SAME AS REACHING. `ebur128` appears in this file twice
 * and in the render path zero times. The bed's level is decided in base.json and
 * asserted afterwards; nothing in the render listens to the signal and reacts to
 * it. That distinction is the whole reason `loudnorm` is banned -- see the
 * header of audio/bed.mjs.
 *
 * AND A GOTCHA THAT COSTS AN HOUR IF YOU MEET IT COLD: you cannot combine `-af`
 * with a `-filter_complex` output for the same stream. ffmpeg refuses with
 * "Simple and complex filtering cannot be used together for the same stream."
 * So the meter goes INSIDE the complex graph -- `[aout]ebur128[ebur]` and then
 * `-map [ebur]` -- rather than being bolted on after it. Both probe builders
 * below do it that way even when measuring a finished file, so there is one
 * shape to remember rather than two.
 *
 * Pure, like everything else outside ffmpeg/run.mjs: strings and argv arrays.
 */

import { gradeArgs } from '../tapedeck/grade.mjs';

/** Splice filtergraph fragments. Blanks are dropped so that `--with-audio` off
 *  produces the video graph byte-for-byte unchanged -- a flag that is off must
 *  not perturb the render it is not part of, or every golden string in the video
 *  suite becomes a function of an audio feature. */
export function joinGraphs(...graphs) {
  return graphs.filter((g) => typeof g === 'string' && g.length > 0).join(';');
}

/**
 * The `audioArgs` payload for gradeArgs, which defaults to `['-an']`. That
 * parameter is the seam the whole milestone hangs off: the video argv builder
 * did not need to learn anything about audio, it only needed one hole.
 *
 * `-ar` and `-ac` restate what `aformat` already pinned inside the graph. That
 * is deliberate belt-and-braces on the one property named in the delivery
 * contract: if a future layer negotiates itself to stereo, this is where it gets
 * folded back to mono instead of shipping.
 */
export function audioMuxArgs(cfg, { outLabel = 'aout' } = {}) {
  const { encode } = cfg;
  return [
    '-map', `[${outLabel}]`,
    '-c:a', encode.audioCodec,
    '-b:a', encode.audioBitrate,
    '-ar', String(encode.audioSampleRate),
    '-ac', String(encode.audioChannels),
  ];
}

/**
 * The full render: clean footage in, tape with a bed out, one process.
 *
 * @param {object}   args
 * @param {string|object} args.input          path, {file}, or {lavfi}
 * @param {string}   args.output              destination mp4
 * @param {string}   args.videoFilter         from buildVideoFilter()
 * @param {string}   [args.audioFilter]       from buildAudioFilter(); omit for a silent render
 * @param {object}   args.cfg                 config/render.json
 * @param {string}   [args.outLabel]          video out label, default 'vout'
 * @param {string}   [args.audioOutLabel]     audio out label, default 'aout'
 */
export function muxedArgs({
  input, output, videoFilter, audioFilter = '', cfg,
  outLabel = 'vout', audioOutLabel = 'aout',
}) {
  return gradeArgs({
    input,
    output,
    filterComplex: joinGraphs(videoFilter, audioFilter),
    cfg,
    outLabel,
    // No audioFilter means no [aout] to map, so fall through to gradeArgs' own
    // `-an` default rather than emitting a map for a label that does not exist.
    ...(audioFilter ? { audioArgs: audioMuxArgs(cfg, { outLabel: audioOutLabel }) } : {}),
  });
}

/**
 * Meter the synthesised bed with no encode and no file, straight out of the
 * graph. This is what a calibration sweep runs: it is the bed exactly as the
 * render will build it, before AAC has an opinion about it.
 *
 * Note the absence of any `-i`. ffmpeg is perfectly happy with a filter_complex
 * made only of source filters, and having no input at all is the strongest
 * possible statement that the bed does not depend on one.
 *
 * `-loglevel` is left at its default: ebur128 prints its summary at info, so
 * quieting the log the way every other builder here does would throw away the
 * only thing this command produces.
 */
export function bedLoudnessArgs({ audioFilter, cfg, outLabel = 'aout' }) {
  return [
    '-hide_banner', '-nostats',
    '-filter_complex_threads', String(cfg.encode.filterComplexThreads),
    '-filter_complex', `${audioFilter};[${outLabel}]ebur128=peak=true[ebur]`,
    '-map', '[ebur]',
    '-f', 'null', '-',
  ];
}

/** Meter the audio of a finished file. Same shape as above -- meter inside the
 *  complex graph -- so there is one form to remember and no chance of meeting
 *  the "simple and complex filtering" refusal by reflex-reaching for `-af`. */
export function fileLoudnessArgs({ input }) {
  return [
    '-hide_banner', '-nostats',
    '-i', input,
    '-filter_complex', '[0:a]ebur128=peak=true[ebur]',
    '-map', '[ebur]',
    '-f', 'null', '-',
  ];
}

/** A plain, non-looping input. Deliberately not grade.mjs' `inputArgs`: that one
 *  applies `-stream_loop -1` so a short clip can fill fifteen seconds, which is
 *  right for a render and wrong here. The probes below want the source present
 *  precisely so its audio has the chance to leak, and looping it would only add
 *  work to a hash that must not depend on it in the first place. */
function plainInputArgs(input) {
  if (input == null) return [];
  if (typeof input === 'string') return ['-i', input];
  if (input.file) return ['-i', input.file];
  if (input.lavfi) return ['-f', 'lavfi', '-i', input.lavfi];
  throw new Error('input must be a path, {file}, {lavfi}, or omitted');
}

/** The render's input semantics: a file gets looped so a source shorter than
 *  fifteen seconds is still legal, a synthetic lavfi source gets its duration
 *  from the graph and must not be. Same rule as grade.mjs' private `inputArgs`;
 *  restated rather than exported from there because widening grade.mjs' surface
 *  for one hash builder is a worse trade than five lines. */
function renderInputArgs(input) {
  if (typeof input === 'object' && input?.lavfi) return ['-f', 'lavfi', '-i', input.lavfi];
  const file = typeof input === 'string' ? input : input?.file;
  if (!file) throw new Error('input must be a path, {file}, or {lavfi}');
  return ['-stream_loop', '-1', '-i', file];
}

/**
 * Decoded-sample hashes of the bed alone, to stdout.
 *
 * Two jobs, one command. Run it five times with the same input and the hashes
 * prove determinism. Run it once with a silent source and once with a source
 * screaming a tone and the hashes prove the source cannot reach the bed -- which
 * is a far sharper instrument than "the loudness did not change much", because
 * it fails on a single differing sample.
 *
 * pcm_f32le rather than pcm_s16le on purpose: 16-bit quantisation would hide a
 * nondeterminism smaller than -90 dBFS, and the point of a purity check is to
 * catch the small one before it grows.
 */
export function bedHashArgs({ input = null, audioFilter, cfg, outLabel = 'aout' }) {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-filter_complex_threads', String(cfg.encode.filterComplexThreads),
    ...plainInputArgs(input),
    '-filter_complex', audioFilter,
    '-map', `[${outLabel}]`,
    '-c:a', 'pcm_f32le',
    '-f', 'framemd5', '-',
  ];
}

/**
 * Decoded hashes of BOTH streams of the muxed render. The video half already has
 * its own purity test; this one exists because joining the graphs is itself a
 * change to the video path -- a shared `-filter_complex` is one graph, one
 * scheduler, one thread pool -- and "the video is still bit-identical once audio
 * is in the same graph" is a different claim from "the video is bit-identical".
 *
 * `frames:v` is capped the way grade.mjs caps it. The audio runs its full length
 * regardless, which is what we want: the tail of an amix is exactly where a
 * dropout transition would show up.
 */
export function muxedHashArgs({
  input, videoFilter, audioFilter, cfg, outLabel = 'vout', audioOutLabel = 'aout',
}) {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-filter_complex_threads', String(cfg.encode.filterComplexThreads),
    ...renderInputArgs(input),
    '-filter_complex', joinGraphs(videoFilter, audioFilter),
    '-map', `[${outLabel}]`,
    '-map', `[${audioOutLabel}]`,
    '-frames:v', String(Math.min(cfg.totalFrames, 40)),
    '-c:a', 'pcm_f32le',
    '-f', 'framemd5', '-',
  ];
}

/**
 * Pull the integrated loudness out of ebur128's stderr.
 *
 * Anchoring `I:` to the start of a line is what makes this work: ebur128 also
 * emits a per-frame progress line that contains `I: -27.0 LUFS` mid-string, and
 * a naive search finds the last progress line rather than the summary. They
 * usually agree, which is worse than if they disagreed -- it means the bug hides
 * until the one time they do not.
 *
 * Returns null rather than throwing when there is no summary, so a caller can
 * report "could not measure" separately from "measured the wrong number".
 */
export function parseIntegratedLufs(stderr = '') {
  const matches = [...String(stderr).matchAll(/^\s*I:\s*(-?(?:\d+(?:\.\d+)?|inf))\s+LUFS\s*$/gm)];
  if (!matches.length) return null;
  const raw = matches.at(-1)[1];
  return raw === '-inf' ? -Infinity : Number(raw);
}

/**
 * Is the bed at the level the profile claims?
 *
 * Pure, so the CLI and the tests share one verdict and one sentence. The failure
 * message names the two mistakes that actually produce a wrong number, because
 * a bare "expected -27, got -33" sends you looking at masterGain, which is
 * almost never what moved.
 */
export function lufsVerdict(measured, { targetLufs, toleranceLufs }) {
  if (measured == null || !Number.isFinite(measured)) {
    return { ok: false, measured, message: `no integrated loudness could be measured (got ${measured})` };
  }
  const delta = measured - targetLufs;
  if (Math.abs(delta) <= toleranceLufs) {
    return { ok: true, measured, delta, message: `${measured.toFixed(1)} LUFS (target ${targetLufs} +/- ${toleranceLufs})` };
  }
  return {
    ok: false,
    measured,
    delta,
    message:
      `integrated loudness ${measured.toFixed(1)} LUFS is outside ${targetLufs} +/- ${toleranceLufs}. ` +
      'Before reaching for masterGain, check the two things that move this number without looking like they do: ' +
      'an amix that lost normalize=0 (costs about 6 dB), and audio.bus.limit, which is a makeup gain in disguise ' +
      'because alimiter auto-levels by 1/limit (0.7 is worth +3.1 dB).',
  };
}
