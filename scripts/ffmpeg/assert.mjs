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
  // BY NAME, NEVER BY POSITION. ffprobe returns frame_tags in signalstats' own
  // order rather than the requested one, so the csv row this used to split had
  // YAVG and YMIN the wrong way round -- silently, on two live assertions,
  // from the day it was written. Named lookup cannot drift when a key is added.
  let frames;
  try {
    ({ frames } = JSON.parse(stdout));
  } catch {
    throw new ContractError(`signalstats for ${input} was not readable json`, { region });
  }
  const tags = Array.isArray(frames) ? frames.filter((f) => f?.tags).pop()?.tags : null;
  if (!tags) throw new ContractError(`no signalstats returned for ${input}`, { region });

  const num = (key) => {
    const raw = tags[`lavfi.signalstats.${key}`];
    return raw === undefined ? undefined : Number(raw);
  };
  return {
    YAVG: num('YAVG'), YMIN: num('YMIN'), YMAX: num('YMAX'),
    SATAVG: num('SATAVG'), UAVG: num('UAVG'), VAVG: num('VAVG'),
  };
}

/**
 * THE PICTURE HAS COLOUR IN IT, AND THE COLOUR IS NOT ONE FLAT CAST.
 *
 * On 2026-09-02 the first tape ever rendered inside the deployed image came
 * out ENTIRELY GREEN, and every assertion in this file passed: the luma plane
 * was correct, so the black floor, the highlight roll-off, the composite and
 * the date stamp were all exactly right. 375 frames, 15.000 seconds, -26.5
 * LUFS. Nothing here had ever read a chroma plane.
 *
 * IT MEASURES THE CHROMA MEANS AND NOT SATURATION, and that was decided by
 * measurement rather than taste. A saturation ceiling was written first and
 * removed: the graded picture measures SATAVG 4.7..10.4 across 9 finished
 * tapes, which looks like a wide margin against the fault's 72.9 -- but the
 * synthetic source this file's own contract render uses measures 62.2, because
 * saturation is a property of the CONTENT and a colourful scene is not a
 * defect. A ceiling that cannot tell a bright picture from a broken one would
 * reject real tapes on the paid path, so it is not a check.
 *
 * THE MEANS DISCRIMINATE CLEANLY AND ARE CONTENT-INDEPENDENT. Averaged over
 * the whole tape region, real footage sits near neutral whatever is in it:
 * 124.1/130.9 on a finished tape, 129.3/125.3 on the saturated synthetic. Even
 * a frame filled with one colour pulls the planes in OPPOSITE directions --
 * blue is U up and V down, orange the reverse. The fault pulled BOTH planes
 * ~52 the same way (76.1 and 77.3), which is what luma rendered as green
 * looks like, and nothing photographic does that.
 *
 * +/-25 leaves roughly 3x headroom over the widest legitimate reading measured
 * and still catches the fault by 2x.
 */
export async function assertTapeColour(file, geometry, {
  maxChromaOffset = 25,
  neutral = 128,
  ...opts
} = {}) {
  const s = await regionStats(file, geometry.tapeCentre, opts);
  const failures = [];

  for (const [plane, value] of [['U', s.UAVG], ['V', s.VAVG]]) {
    if (!Number.isFinite(value)) {
      failures.push(`${plane}AVG is missing from signalstats -- regionStatsArgs no longer requests it`);
      continue;
    }
    const off = Math.abs(value - neutral);
    if (!(off <= maxChromaOffset)) {
      failures.push(
        `${plane}AVG=${value} is ${off.toFixed(1)} from neutral ${neutral}, over ${maxChromaOffset} -- ` +
        'both planes pulled the same way is the signature of a format negotiated wrongly at the grade/tape boundary',
      );
    }
  }

  if (failures.length) {
    throw new ContractError(
      `${file} has a colour fault the luma checks cannot see:\n  - ${failures.join('\n  - ')}\n` +
      '  Check the ffmpeg major version -- 5.1 renders this graph green where 7.x and 8.x do not.',
      { stats: s },
    );
  }
  return s;
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
/**
 * THE THRESHOLD MOVED ON 2026-09-02 AND IT WAS A CORRECTION, NOT A RELAXATION.
 *
 * `regionStats` returned YAVG and YMIN the wrong way round until that date --
 * ffprobe emits frame_tags in signalstats' order, not the requested one -- so
 * this check has always compared the surround's MINIMUM against 24 while its
 * message said average. Reading the real average, four finished tapes measure
 * 24.38, 24.39, 24.41 and 24.43: a variance of 0.05, because the surround is a
 * flat #0B0A09 with grain on it. The old 24 sat just underneath that.
 *
 * 32 is 30% above the measured constant and still far below any picture
 * content, which is what this check is actually for: if the geometry were
 * wrong the surround region would contain the tape image, and even a night
 * scene averages well clear of this.
 */
export async function assertComposite(file, geometry, { maxSurroundLuma = 32, ...opts } = {}) {
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
