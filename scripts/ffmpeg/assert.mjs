/**
 * Assertions about a finished file.
 *
 * The governing idea is that you never assert on pixels. Pixel equality is
 * brittle across ffmpeg builds and tells you nothing useful when it breaks --
 * "17,432 pixels differ" is not a diagnosis. Instead these assert structural
 * facts (resolution, frame count, stream shape) and directional deltas
 * (saturation went down, the black floor went up), which are exactly the
 * properties the look is supposed to have and which fail with a readable
 * message when it does not.
 *
 * The burn-in check earns its place specifically: if `fontfile` fails to
 * resolve, drawtext silently renders nothing, ffmpeg exits 0, and every other
 * assertion here still passes. Measuring peak luma inside the stamp's box is
 * the only cheap way to catch a hundred videos shipping with no date on them.
 */

import path from 'node:path';
import { probe, runFfprobe, REPO_ROOT } from './run.mjs';
import { regionStatsArgs } from '../tapedeck/grade.mjs';

/** The `movie` lavfi source cannot take a Windows absolute path (see
 *  regionStatsArgs). Everything runs with cwd at the repo root, so relative is
 *  both correct and escaping-free. */
const repoRelative = (file) => path.relative(REPO_ROOT, path.resolve(REPO_ROOT, file)).replace(/\\/g, '/');

export class ContractError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'ContractError';
    this.detail = detail;
  }
}

/** Parse one signalstats CSV row into numbers. */
export async function regionStats(input, region, { frame = 12, ...opts } = {}) {
  const { stdout } = await runFfprobe(regionStatsArgs({ input: repoRelative(input), region, frame }), opts);
  const row = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
  if (!row) throw new ContractError(`no signalstats returned for ${input}`, { region });
  const [YAVG, YMIN, YMAX, SATAVG] = row.split(',').map(Number);
  return { YAVG, YMIN, YMAX, SATAVG };
}

/**
 * The output contract from config/render.json, checked against the real file.
 * Every failure names the expected and actual value, because the whole point of
 * a contract test is that it tells you what changed.
 */
export async function assertDeliveryContract(file, cfg, { expectAudio = false, ...opts } = {}) {
  const info = await probe(file, { countFrames: true, ...opts });
  const streams = info.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const failures = [];

  const want = (label, actual, expected) => {
    if (String(actual) !== String(expected)) failures.push(`${label}: expected ${expected}, got ${actual}`);
  };

  if (!video) failures.push('no video stream');
  else {
    want('width', video.width, cfg.delivery.width);
    want('height', video.height, cfg.delivery.height);
    want('pix_fmt', video.pix_fmt, cfg.encode.pixFmt);
    want('r_frame_rate', video.r_frame_rate, `${cfg.fps}/1`);
    want('frame count', video.nb_read_frames, cfg.totalFrames);
    // 375 frames at 25fps IS 15.000s. This is the assertion PAL was chosen for.
    const duration = Number(video.nb_read_frames) / cfg.fps;
    if (Math.abs(duration - cfg.durationSeconds) > 0.0005) {
      failures.push(`duration: expected ${cfg.durationSeconds}s, got ${duration}s`);
    }
  }

  const videoCount = streams.filter((s) => s.codec_type === 'video').length;
  if (videoCount !== 1) failures.push(`expected exactly 1 video stream, got ${videoCount}`);

  if (expectAudio) {
    if (!audio) failures.push('expected an audio stream, found none');
    else {
      want('audio channels', audio.channels, cfg.encode.audioChannels);
      want('audio sample rate', audio.sample_rate, cfg.encode.audioSampleRate);
    }
  } else if (audio) {
    failures.push('expected no audio stream at this stage, found one');
  }

  if (failures.length) {
    throw new ContractError(`${file} violates the delivery contract:\n  - ${failures.join('\n  - ')}`, { failures, info });
  }
  return info;
}

/**
 * The grade moved the image in the direction a tape moves it.
 *
 * YMIN is the sharper of the two tests. Mean luma barely moves under a tape
 * grade, but the black floor lifting off zero is unmistakable and is the single
 * most characteristic thing consumer tape did -- it never reached true black.
 */
export async function assertTapeGrade(file, geometry, { minBlackFloor = 10, maxHighlight = 252, ...opts } = {}) {
  const stats = await regionStats(file, geometry.tapeCentre, opts);
  const failures = [];

  if (!(stats.YMIN >= minBlackFloor)) {
    failures.push(
      `black floor YMIN=${stats.YMIN} is below ${minBlackFloor} -- blacks are crushed, ` +
      'which reads as a modern camera with a filter rather than tape',
    );
  }
  if (!(stats.YMAX <= maxHighlight)) {
    failures.push(`highlights YMAX=${stats.YMAX} exceed ${maxHighlight} -- the roll-off is not being applied`);
  }
  if (failures.length) throw new ContractError(`${file} does not look graded:\n  - ${failures.join('\n  - ')}`, { stats });
  return stats;
}

/** The 4:3 image really is floating on a dark surround, and there really is
 *  something inside it. Proves the composite geometry without a pixel compare. */
export async function assertComposite(file, geometry, { maxSurroundLuma = 24, ...opts } = {}) {
  const failures = [];

  for (const [label, region] of [['top', geometry.surroundTop], ['bottom', geometry.surroundBottom]]) {
    if (region.h <= 0) continue;
    const s = await regionStats(file, region, opts);
    if (!(s.YAVG <= maxSurroundLuma)) {
      failures.push(`${label} surround YAVG=${s.YAVG} exceeds ${maxSurroundLuma} -- the tape image is not centred where the geometry says`);
    }
  }

  const centre = await regionStats(file, geometry.tapeCentre, opts);
  if (!(centre.YAVG > 24 && centre.YAVG < 232)) {
    failures.push(`tape centre YAVG=${centre.YAVG} is not plausible picture content (expected 24..232)`);
  }

  if (failures.length) throw new ContractError(`${file} composite is wrong:\n  - ${failures.join('\n  - ')}`, { failures });
  return true;
}

/** Glyphs are present in the stamp box. Catches the silent drawtext no-op. */
export async function assertBurnIn(file, region, { minPeak = 150, ...opts } = {}) {
  const s = await regionStats(file, region, opts);
  if (!(s.YMAX >= minPeak)) {
    throw new ContractError(
      `no date stamp found in ${region.w}x${region.h} at (${region.x},${region.y}): peak luma ${s.YMAX} < ${minPeak}.\n` +
      '  drawtext fails silently when fontfile cannot be resolved -- check assets/fonts/ and run `npm run doctor`.',
      { region, stats: s },
    );
  }
  return s;
}
