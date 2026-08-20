/**
 * The frame that joins one segment to the next.
 *
 * Segment 1 starts from the approved still. Every later segment starts from the
 * previous clip's FINAL frame, which is the whole mechanism behind "one
 * continuous take": the model is handed the exact pixels it just produced and
 * asked to carry on, rather than being asked twice for the same scene and
 * hoping the two agree. `composeMotionPrompt` says so in words as well, because
 * a prompt that does not name the continuation gives the model licence to
 * re-stage the shot between takes.
 *
 * WHETHER THE JOIN IS ACTUALLY INVISIBLE IS AN OPEN QUESTION -- it is phase-0
 * criterion 5 and nobody has run it. So the extracted frame is written to disk
 * next to the segments and kept, rather than being piped through a temp file:
 * when the seam turns out to be visible, the last frame of seg-01 and the first
 * frame of seg-02 are two PNGs somebody can open side by side. Hiding the seam
 * would be cheaper and would make the question unanswerable.
 *
 * WHY `-sseof` AND `-update 1` RATHER THAN A FRAME NUMBER. Selecting the last
 * frame by index needs the frame count, which needs a `-count_frames` probe of
 * the whole file first -- two decodes to get one frame. `-sseof -1` decodes
 * only the final second and `-update 1` overwrites the same output file for
 * every frame in it, so what is left on disk when ffmpeg exits is the last
 * frame, exactly, with no arithmetic and no second pass. `-frames:v 1` would be
 * wrong here and is the mistake worth naming: after a seek it takes the FIRST
 * frame of the tail, not the last.
 */

import { runFfmpeg } from '../ffmpeg/run.mjs';

const pad2 = (n) => String(n).padStart(2, '0');

/** `seg-01-last.png`, sitting beside `seg-01.mp4` so the seam is one directory
 *  listing rather than a hunt through a temp folder. */
export function lastFrameName(index) {
  return `seg-${pad2(index)}-last.png`;
}

/**
 * Pure argv builder, like everything in `tapedeck/` and `audio/`.
 *
 * @param {object} args
 * @param {string} args.input          the clip to take the final frame of
 * @param {string} args.output         a .png path
 * @param {object} args.cfg            config/render.json
 * @param {number} [args.tailSeconds]  how much of the end to decode
 */
export function lastFrameArgs({ input, output, cfg, tailSeconds = 1 }) {
  if (typeof input !== 'string' || !input) throw new TypeError('lastFrameArgs needs an input path');
  if (typeof output !== 'string' || !output) throw new TypeError('lastFrameArgs needs an output path');
  if (!Number.isFinite(tailSeconds) || tailSeconds <= 0) {
    throw new TypeError(`tailSeconds must be a positive number, got ${JSON.stringify(tailSeconds)}`);
  }
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-filter_complex_threads', String(cfg.encode.filterComplexThreads),
    // Input-side seek, so only the tail is decoded. A clip shorter than the
    // tail clamps to its own start, which is correct rather than an error.
    '-sseof', `-${Number(tailSeconds)}`,
    '-i', input,
    // Every frame of the tail is muxed over the same file; the survivor is the
    // last one. No -frames:v -- see the header.
    '-update', '1',
    '-f', 'image2',
    output,
  ];
}

/**
 * Extract it. The one impure function in this file, and it spawns nothing
 * itself -- `ffmpeg/run.mjs` is the only module in the repo allowed to do that.
 *
 * @param {object} args
 * @param {function} [args.runFfmpegImpl]  injected so the pipeline's tests need no ffmpeg
 * @returns {Promise<string>} the output path
 */
export async function extractLastFrame({ input, output, cfg, tailSeconds = 1, runFfmpegImpl = runFfmpeg }) {
  await runFfmpegImpl(lastFrameArgs({ input, output, cfg, tailSeconds }));
  return output;
}
