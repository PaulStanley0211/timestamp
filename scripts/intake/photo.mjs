/**
 * Photo intake. Everything a stranger's upload has to survive before any other
 * module is allowed to look at it.
 *
 * WHY THIS FILE RE-ENCODES INSTEAD OF COPYING. A JPEG straight off a phone
 * carries an EXIF block, and an EXIF block carries GPS. Someone uploading a
 * photograph of their childhood garden is handing over its coordinates to six
 * decimal places, plus the camera serial number and the second it was taken.
 * None of that is needed to make a video and all of it is a disclosure waiting
 * to happen, so it never reaches disk in a job directory. `-map_metadata -1`
 * during the re-encode drops every container-level metadata block, and the
 * re-encode itself is what applies EXIF autorotation -- ffmpeg does that by
 * default -- so one pass fixes the orientation and destroys the location
 * together. That is why this is a re-encode and not a copy, and why it is
 * described in CLAUDE.md as load-bearing rather than hygiene.
 *
 * WHY THE OUTPUT IS ALWAYS JPEG, EVEN IF THE CALLER NAMES A .png. Measured on
 * ffmpeg 8.1.1: `-map_metadata -1` strips container metadata but does NOT strip
 * frame side data, and the PNG encoder writes an `eXIf` chunk back out from
 * that side data. A PNG produced by the "stripping" path came back out of
 * ffprobe still carrying GPSLatitude. The mjpeg encoder does not re-emit it.
 * So the encoder is pinned with `-c:v mjpeg` rather than inferred from the
 * destination extension, because inferring it makes the privacy property depend
 * on a filename. The manifest wants `input/photo.jpg` anyway.
 *
 * WHY THERE IS NO IMAGE LIBRARY HERE. ffmpeg is already a hard dependency and
 * already does dimensions, format sniffing, rotation and re-encode. Adding
 * `sharp` would buy nothing and cost this repository its zero-native-dependency
 * property. See CLAUDE.md, "Common mistakes".
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runFfmpeg, runFfprobe } from '../ffmpeg/run.mjs';

/**
 * Errors from this module are shown to strangers, so they carry two messages.
 * `.message` is for a log and may name a path; `.userMessage` is for a web page
 * and may not. Keeping them as separate fields rather than trusting whoever
 * renders the page to pick the right one is the only version of this that
 * survives a hurried template.
 */
export class IntakeError extends Error {
  constructor(message, { code, userMessage, detail } = {}) {
    super(message);
    this.name = 'IntakeError';
    this.code = code;
    this.userMessage = userMessage ?? 'We could not use that photo. Please try a different one.';
    this.detail = detail;
  }
}

/**
 * `maxEdge` is generous rather than tight: a 2026 phone shoots around 8000px on
 * the long edge and refusing the camera most uploads come from would be a
 * refusal of the product. `maxBytes` is the real cap and it is the one a web
 * upload is streamed against.
 */
export const LIMITS = Object.freeze({
  maxBytes: 12_000_000,
  minEdge: 256,
  maxEdge: 8000,
  /**
   * THE LONGEST EDGE THAT MAY LEAVE THIS MACHINE, and it is a REFUSAL FROM A
   * REAL ENDPOINT rather than a guess. fal-ai/uso answered a 3712px-tall
   * reference with HTTP 422 `image_too_large`: "Maximum dimensions are
   * 2048x2048 pixels" (2026-08-23, job 20260823-185647-a08774).
   *
   * It is enforced at INTAKE rather than in the provider for two reasons. The
   * photograph a phone takes is 3000-4000px on the long edge, so this is not an
   * edge case, it is EVERY REAL UPLOAD -- and the largest still this product
   * ever generates is 960x720, so a 2048px reference is already oversampled
   * more than twice over. And the reference travels as a base64 data URI, which
   * inflates it by a third: capping here cut this photo's request from about
   * 8.5MB to well under a megabyte, which is latency and failure surface on
   * every single call, not just the ones that would have been refused.
   */
  maxReferenceEdge: 2048,
  accept: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
});

/** ffmpeg codec name -> mime type. The mapping is deliberately one-way and
 *  content-derived: an upload named `.jpg` that is really a GIF is refused as a
 *  GIF, because the extension is attacker-controlled and the codec name is not. */
const CODEC_MIME = Object.freeze({
  mjpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

/**
 * EXIF orientation, reconstructed from ffmpeg's display matrix.
 *
 * ffmpeg's JPEG decoder consumes the Orientation tag and re-expresses it as a
 * 3x3 display matrix, so the original 1..8 value is not available as a tag --
 * only as the matrix. `rotation` alone cannot tell the eight cases apart:
 * orientations 2 and 3 both report -180, and 1 and 4 both report 0, because a
 * mirror is not a rotation. The four signed entries are unique per orientation,
 * so the table is keyed on those. Values measured against all eight, not
 * inferred from the spec.
 */
const MATRIX_TO_ORIENTATION = new Map([
  ['1,0,0,1', 1], ['-1,0,0,1', 2], ['-1,0,0,-1', 3], ['1,0,0,-1', 4],
  ['0,1,1,0', 5], ['0,1,-1,0', 6], ['0,-1,-1,0', 7], ['0,-1,1,0', 8],
]);

function orientationFromDisplayMatrix(text) {
  // "\n00000000:  0  65536  0\n00000001: -65536  0  0\n..." -- 16.16 fixed point.
  const nums = String(text).split(/\s+/).filter((t) => /^-?\d+$/.test(t)).map(Number);
  if (nums.length < 5) return 1;
  const [a, b, , c, d] = nums;
  const sign = (v) => (v === 0 ? 0 : v > 0 ? 1 : -1);
  return MATRIX_TO_ORIENTATION.get([a, b, c, d].map(sign).join(',')) ?? 1;
}

function sha256File(file, fsImpl) {
  return crypto.createHash('sha256').update(fsImpl.readFileSync(file)).digest('hex');
}

/**
 * THE LOCAL FILE, AND NO OTHER PROTOCOL. These bytes came from a stranger,
 * and ffmpeg's demuxers include several that follow references to other
 * inputs -- a playlist, a concat script, a URL inside a container. A stock
 * build already refuses network protocols for file-origin input; stating the
 * whitelist makes that a property of this code rather than of whichever
 * build is installed, and it must precede the input it governs or it does
 * not apply to it. Shared by the probes and the re-encode so the three
 * cannot disagree.
 */
const PROTOCOL_WHITELIST = ['-protocol_whitelist', 'file'];

/** ffprobe args for the STREAM HEADER alone: codec and declared size, no
 *  frame decoded. This is what the pixel cap reads, because decoding is where
 *  an attacker-shaped file does its work -- a declared 9000x9000 frame is a
 *  243 MB allocation, and the cap has to be consulted before that happens,
 *  not after. */
function headerArgs(file) {
  return [
    '-v', 'error',
    ...PROTOCOL_WHITELIST,
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height',
    '-of', 'json',
    file,
  ];
}

/** ffprobe args for the first FRAME, asked only of a file already inside
 *  every limit. `-read_intervals` caps an animated WebP at its first frame so
 *  a 300-frame sticker does not become a 300-frame probe; the frame is where
 *  the EXIF and the real pixel size live, and a header can lie about both. */
function probeArgs(file) {
  return [
    '-v', 'error',
    ...PROTOCOL_WHITELIST,
    '-select_streams', 'v:0',
    '-read_intervals', '%+#1',
    '-show_entries', 'stream=codec_name,width,height',
    '-show_frames',
    '-of', 'json',
    file,
  ];
}

/** ffprobe emits `frames` normally and `packets_and_frames` when packet output
 *  is also enabled. Reading both means an ffprobe upgrade that changes which one
 *  it picks does not silently turn EXIF detection into "no EXIF found". */
function firstFrame(parsed) {
  const list = parsed.frames ?? parsed.packets_and_frames ?? [];
  return list.find((f) => (f.type ?? 'frame') === 'frame') ?? {};
}

/** The two edge limits, applied to a size -- the declared one first, then
 *  the decoded one. One function so the two checks cannot drift apart. */
function refuseOutsideEdges(srcPath, width, height, limits) {
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  if (shortEdge < limits.minEdge) {
    throw new IntakeError(`"${srcPath}" is ${width}x${height}, under the ${limits.minEdge}px minimum edge`, {
      code: 'too-small',
      userMessage: `That photo is ${width} by ${height} pixels. We need at least ${limits.minEdge} pixels on the shorter side, or the face is too small to work from.`,
      detail: { width, height, minEdge: limits.minEdge },
    });
  }
  if (longEdge > limits.maxEdge) {
    throw new IntakeError(`"${srcPath}" is ${width}x${height}, over the ${limits.maxEdge}px maximum edge`, {
      code: 'too-large',
      userMessage: `That photo is ${width} by ${height} pixels, which is bigger than we can handle. Please export it at ${limits.maxEdge} pixels or less on the longest side.`,
      detail: { width, height, maxEdge: limits.maxEdge },
    });
  }
}

/**
 * Read the facts about an upload, and refuse it if any of them disqualify it.
 *
 * Inspection and validation are one call rather than two because a split
 * invites a caller to inspect, forget to validate, and hand an 80 megabyte TIFF
 * to the rest of the pipeline. There is no `{ validate: false }` escape hatch
 * for the same reason.
 *
 * @returns {Promise<{width, height, format, bytes, sha256, hasExif, orientation}>}
 */
export async function inspectPhoto(srcPath, {
  ffprobeImpl = runFfprobe,
  fsImpl = fs,
  limits = LIMITS,
} = {}) {
  let stat;
  try {
    stat = fsImpl.statSync(srcPath);
  } catch (err) {
    throw new IntakeError(`cannot stat "${srcPath}": ${err.message}`, {
      code: 'unreadable',
      userMessage: 'We could not read that file. Please try uploading the photo again.',
    });
  }

  if (!stat.isFile() || stat.size === 0) {
    throw new IntakeError(`"${srcPath}" is empty or not a file`, {
      code: 'empty',
      userMessage: 'That file was empty. Please choose a photo and try again.',
    });
  }

  // The byte check comes before ffprobe because it is free and because it is the
  // only one of these limits that also protects the machine doing the probing.
  if (stat.size > limits.maxBytes) {
    const mb = (limits.maxBytes / 1_000_000).toFixed(0);
    throw new IntakeError(`"${srcPath}" is ${stat.size} bytes, over the ${limits.maxBytes} limit`, {
      code: 'too-large',
      userMessage: `That photo is larger than ${mb} MB. Please choose a smaller one, or export it at a lower quality.`,
      detail: { bytes: stat.size, maxBytes: limits.maxBytes },
    });
  }

  const undecodable = (err) => new IntakeError(`ffprobe could not decode "${srcPath}": ${err.message}`, {
    code: 'undecodable',
    userMessage: 'We could not open that file as an image. JPEG, PNG and WebP all work.',
  });

  // PHASE 1: THE HEADER, AND NOTHING DECODED. The codec and the declared
  // size are enough to refuse a format this product does not take and a
  // picture over the pixel cap -- and the cap has to be consulted BEFORE a
  // frame is asked for, because decoding is where an attacker-shaped file
  // does its work. A header can under-declare, which is why the frame's own
  // size is checked again below; it cannot make the cap miss a picture that
  // honestly declares itself enormous.
  let header;
  try {
    header = JSON.parse((await ffprobeImpl(headerArgs(srcPath))).stdout);
  } catch (err) {
    throw undecodable(err);
  }

  const stream = header.streams?.[0];
  const format = CODEC_MIME[stream?.codec_name];
  if (!format || !limits.accept.includes(format)) {
    throw new IntakeError(
      `"${srcPath}" decoded as codec "${stream?.codec_name ?? 'none'}", which is not an accepted photo format`,
      {
        code: 'unsupported-format',
        userMessage: 'That file is not a JPEG, PNG or WebP. Please save the photo in one of those formats and try again.',
        detail: { codec: stream?.codec_name ?? null },
      },
    );
  }
  const declaredWidth = Number(stream.width ?? 0);
  const declaredHeight = Number(stream.height ?? 0);
  if (declaredWidth && declaredHeight) refuseOutsideEdges(srcPath, declaredWidth, declaredHeight, limits);

  // PHASE 2: THE FIRST FRAME, from a file already inside every limit. This is
  // where the EXIF and the real pixel size live.
  let parsed;
  try {
    parsed = JSON.parse((await ffprobeImpl(probeArgs(srcPath))).stdout);
  } catch (err) {
    throw undecodable(err);
  }

  const frame = firstFrame(parsed);
  const width = Number(frame.width ?? stream.width ?? 0);
  const height = Number(frame.height ?? stream.height ?? 0);
  if (!width || !height) {
    throw new IntakeError(`"${srcPath}" has no usable dimensions`, {
      code: 'undecodable',
      userMessage: 'We could not open that file as an image. JPEG, PNG and WebP all work.',
    });
  }
  refuseOutsideEdges(srcPath, width, height, limits);

  const sideData = frame.side_data_list ?? [];
  const matrix = sideData.find((s) => s.side_data_type === '3x3 displaymatrix');
  const hasExif = sideData.some((s) => s.side_data_type === 'EXIF metadata')
    || Boolean(matrix)
    || Object.keys(frame.tags ?? {}).length > 0;

  return {
    width,
    height,
    format,
    bytes: stat.size,
    sha256: sha256File(srcPath, fsImpl),
    hasExif,
    orientation: matrix ? orientationFromDisplayMatrix(matrix.displaymatrix) : 1,
  };
}

/**
 * Copy an upload into a job directory as a stripped, upright JPEG.
 *
 * The returned `sha256` is of the DESTINATION, not the source. The manifest
 * records what we hold, and what we hold is the stripped copy; hashing the
 * original would produce a manifest entry that matches a file nobody can
 * produce from the job directory.
 *
 * @returns {Promise<{path, sha256, width, height, stripped: true, rotated: boolean}>}
 */
export async function ingestPhoto(srcPath, destPath, {
  ffmpegImpl = runFfmpeg,
  ffprobeImpl = runFfprobe,
  fsImpl = fs,
  limits = LIMITS,
  quality = 3,
} = {}) {
  const source = await inspectPhoto(srcPath, { ffprobeImpl, fsImpl, limits });

  fsImpl.mkdirSync(path.dirname(destPath), { recursive: true });

  try {
    await ffmpegImpl([
      '-hide_banner', '-nostdin', '-y',
      // Before `-i`, or it does not govern the input. See PROTOCOL_WHITELIST.
      ...PROTOCOL_WHITELIST,
      '-i', srcPath,
      // Container metadata, both global and per-stream. The per-stream form is
      // not redundant: a stream-level tag block survives the global one.
      '-map_metadata', '-1',
      '-map_metadata:s:v', '-1',
      '-frames:v', '1',
      // Downscale to fit inside maxReferenceEdge, and NEVER upscale: the box is
      // min(iw, cap) x min(ih, cap), so an image already inside it is scaled by
      // exactly 1. Expressed as a FILTER rather than computed in Node on
      // purpose -- see the note below about not reimplementing the orientation
      // table. iw/ih here are post-autorotation, which is the only place the
      // real delivered dimensions exist. The second scale rounds to even
      // dimensions, which yuvj420p requires and which the first scale does not
      // guarantee.
      '-vf', [
        `scale=w='min(iw,${limits.maxReferenceEdge})':h='min(ih,${limits.maxReferenceEdge})'`
          + ':force_original_aspect_ratio=decrease:flags=lanczos',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      ].join(','),
      // Pinned rather than inferred from destPath -- see the header note about
      // the PNG encoder writing an eXIf chunk back out of frame side data.
      '-c:v', 'mjpeg',
      '-q:v', String(quality),
      '-f', 'image2',
      destPath,
    ]);
  } catch (err) {
    throw new IntakeError(`ffmpeg could not re-encode "${srcPath}": ${err.message}`, {
      code: 'reencode-failed',
      userMessage: 'Something went wrong while preparing that photo. Please try again, or try a different photo.',
    });
  }

  // Probed rather than computed, because autorotation happens inside ffmpeg and
  // predicting its output dimensions in Node would be a second implementation of
  // the orientation table that could disagree with the first one.
  const written = await inspectPhoto(destPath, { ffprobeImpl, fsImpl, limits });

  return {
    path: destPath,
    sha256: written.sha256,
    width: written.width,
    height: written.height,
    stripped: true,
    // True whenever autorotation moved pixels, which includes the mirrored
    // orientations 2, 4, 5 and 7 -- "rotated" here means "the file on disk is
    // not laid out the way the upload was", not "a multiple of 90 was applied".
    rotated: source.orientation !== 1,
  };
}

/**
 * The face gate. This is a SEAM, not a face detector.
 *
 * There is no face detector in this repository and one is not being added --
 * every option is either a native dependency or a network call, and both are
 * things this repository has deliberately spent effort not having. So the
 * default implementation checks only what is cheaply checkable and then says
 * `confidence: 'unverified'` and means it.
 *
 * The value is not the check. The value is that `impl` goes into the manifest,
 * so on the day a real gate exists it is one injection, and every job rendered
 * before that day says truthfully in its own manifest that no face was ever
 * verified. A fabricated confidence number would have destroyed that: it would
 * be indistinguishable, six months later, from a real one.
 *
 * @returns {Promise<{ok, reason, confidence, impl}>}
 */
export const PERMISSIVE_FACE_GATE = 'permissive-v1';

/** Wider than this is a panorama, a screenshot or a banner, and none of those
 *  is a photograph of somebody. Deliberately loose: 3:1 still admits a bad
 *  crop, and admitting a bad crop is cheaper than refusing a real upload. */
const MAX_FACE_ASPECT = 3;

export async function faceGate(srcPath, {
  detectImpl = null,
  inspectImpl = inspectPhoto,
  limits = LIMITS,
  maxAspect = MAX_FACE_ASPECT,
} = {}) {
  let info;
  try {
    info = await inspectImpl(srcPath, { limits });
  } catch (err) {
    return {
      ok: false,
      reason: err.code === 'undecodable' ? 'did-not-decode' : (err.code ?? 'unreadable'),
      confidence: 'unverified',
      impl: detectImpl ? (detectImpl.implId ?? 'injected') : PERMISSIVE_FACE_GATE,
    };
  }

  // An injected detector owns the verdict AND the confidence. This module does
  // not average its own guess into a real measurement.
  if (detectImpl) {
    const verdict = await detectImpl(srcPath, info);
    return { impl: detectImpl.implId ?? 'injected', ...verdict };
  }

  const aspect = Math.max(info.width / info.height, info.height / info.width);
  const reason = aspect > maxAspect
    ? 'implausible-aspect'
    : Math.min(info.width, info.height) < limits.minEdge
      ? 'too-small'
      : null;

  return {
    ok: reason === null,
    reason,
    confidence: 'unverified',
    impl: PERMISSIVE_FACE_GATE,
  };
}
