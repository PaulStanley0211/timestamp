/**
 * A `detectImpl` for `faceGate`, backed by Amazon Rekognition DetectFaces.
 *
 * WHAT IT CLOSES. `faceGate` in intake/photo.mjs has been a permissive seam
 * since it was written -- aspect under 3:1, short edge over 256px, and nothing
 * else -- and its own header says so: "This is a SEAM, not a face detector."
 * On 2026-09-07 a photograph of a WRISTWATCH went through all eleven steps and
 * produced a finished tape of a person who does not exist, with every assertion
 * in `verify` green: 375 frames, 15s, -27.1 LUFS. Nothing in the pipeline can
 * tell a face from a watch strap, and a customer doing that on the live site
 * spends 21 credits to be handed a stranger.
 *
 * WHY REKOGNITION RATHER THAN SOMETHING LOCAL. This repository has no npm
 * dependencies and a CI guard that keeps it that way, and CLAUDE.md lists
 * "reaching for a face detector" among the mistakes for exactly that reason.
 * A local heuristic was considered and rejected on the case that prompted this:
 * the watch photograph is a watch held IN A HAND, so any skin-tone test passes
 * it. The honest options were a real detector or nothing, and section 52
 * already built the signer, the endpoint rule and the disclosure guard for the
 * same service -- so this is a second action on one integration rather than a
 * new one.
 *
 * IT SHIPS OFF. `awsFaceDetectorFromEnv` returns null unless the three AWS
 * variables are set, and REFUSES TO BUILD if they are set without
 * `TIMESTAMP_IMAGE_PROCESSOR`. That is section 52's guard and it applies here
 * unchanged: the photograph reaches AWS either way, and /privacy tells the
 * customer it goes to the generation provider "and to nobody else".
 *
 * @see scripts/safety/image-moderate-aws.mjs -- the sibling this mirrors.
 */

import fs from 'node:fs';

import { requireFetchImpl } from '../providers/contract.mjs';
import { signRequest } from './aws-sigv4.mjs';
// The host rule and the inline cap are DECIDED in the moderator and imported
// here rather than restated. Two copies of "which host may hold this
// credential" is two places for them to drift apart.
import {
  AWS_MODERATION_SERVICE as AWS_FACE_SERVICE,
  MAX_INLINE_BYTES,
  rekognitionEndpoint,
  AWS_ENV_KEYS,
} from './image-moderate-aws.mjs';

export { MAX_INLINE_BYTES, rekognitionEndpoint, AWS_FACE_SERVICE };

/**
 * VERIFIED 2026-09-07 AGAINST AWS'S OWN SOURCES, not inferred from the sibling.
 * That distinction is BUG 3's: `fal-ai/uso` answered 422 on 2026-08-23 because
 * it wanted `input_image_urls` and the field name had been assumed from a
 * neighbour rather than read.
 *
 *   target prefix   `RekognitionService`, jsonVersion `1.1`
 *                   -- botocore/data/rekognition/2016-06-27/service-2.json
 *   request body    `{ Image: { Bytes: <base64> } }`, `Attributes` optional
 *   response        top-level `FaceDetails` array; each entry carries
 *                   `BoundingBox` (Width/Height/Left/Top as ratios of the
 *                   image) and `Confidence`
 *                   -- docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectFaces.html
 *
 * AND THE REASON THE DEFAULT ATTRIBUTE SET IS RIGHT, confirmed on that page:
 * omitting `Attributes` returns BoundingBox, Confidence, Pose, Quality and
 * Landmarks -- and NOT AgeRange, Gender or Emotions, which arrive only with
 * `ALL`. So the privacy argument below is a property of the request rather
 * than a hope about it.
 *
 * STILL NEVER CALLED LIVE. The shape is read; the credential, the IAM policy
 * and the region are not, and only one real call proves those.
 */
export const AWS_FACE_TARGET = 'RekognitionService.DetectFaces';

/** The name that lands in the manifest, so a tape says which gate passed it. */
export const AWS_FACE_IMPL = 'aws-rekognition-faces-v1';

export class FaceDetectionError extends Error {
  constructor(message, { code = 'face-detection-failed', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'FaceDetectionError';
    this.code = code;
  }
}

/**
 * Build a detector from the environment, or `null` when it is not configured.
 *
 * Null is the designed off state: `faceGate` falls back to the permissive
 * check it has always run, and records `confidence: 'unverified'` in the
 * manifest, so a tape made before this was switched on says truthfully that no
 * face was ever verified.
 */
export function awsFaceDetectorFromEnv(env = {}, options = {}) {
  const present = AWS_ENV_KEYS.filter((k) => String(env[k] ?? '').trim() !== '');
  if (present.length === 0) return null;
  if (present.length !== AWS_ENV_KEYS.length) {
    const missing = AWS_ENV_KEYS.filter((k) => !present.includes(k));
    throw new TypeError(
      `aws-faces: face detection is half-configured -- ${present.join(', ')} set, ${missing.join(', ')} missing. `
      + 'Set all three or none. Two of three would silently leave photographs unchecked.',
    );
  }
  if (String(env.TIMESTAMP_IMAGE_PROCESSOR ?? '').trim() === '') {
    throw new TypeError(
      'aws-faces: face detection is configured but undisclosed. /privacy tells customers their '
      + 'photograph goes to the generation provider "and to nobody else", which these credentials '
      + 'make untrue. Set TIMESTAMP_IMAGE_PROCESSOR in .env.common to the processor as it should '
      + 'appear on that page -- and sign the processing agreement before you do.',
    );
  }

  return createAwsFaceDetector({
    ...options,
    region: env.AWS_REGION,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN ?? null,
  });
}

export function createAwsFaceDetector({
  fetchImpl,
  region,
  accessKeyId,
  secretAccessKey,
  sessionToken = null,
  nowImpl = () => new Date(),
  fsImpl = fs,
} = {}) {
  // FIRST, before credentials are read and before anything else can throw and
  // hide it. Same ordering rule contract.mjs documents for paid providers.
  const doFetch = requireFetchImpl({ fetchImpl }, { provider: 'aws-rekognition-faces' });

  if (!accessKeyId || !secretAccessKey) {
    throw new TypeError('aws-faces: accessKeyId and secretAccessKey are required');
  }
  const endpoint = rekognitionEndpoint(region);

  return async function detectFaces(photoPath, { field = 'photo' } = {}) {
    const bytes = fsImpl.readFileSync(photoPath);
    if (bytes.length > MAX_INLINE_BYTES) {
      throw new FaceDetectionError(
        `aws-faces: ${field} is ${bytes.length} bytes, over the ${MAX_INLINE_BYTES} inline limit`,
        { code: 'image-too-large-to-check' },
      );
    }

    // DEFAULT attributes, not ALL. The default set answers the only question
    // asked here -- is there a face, and how big is it -- while ALL returns
    // age, gender, emotion and more besides. A product that renders somebody's
    // likeness has no business collecting an inferred age or gender it will
    // never use, and every field requested is a field that has to be explained.
    const body = JSON.stringify({ Image: { Bytes: bytes.toString('base64') } });

    const signed = signRequest({
      method: 'POST',
      url: endpoint,
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': AWS_FACE_TARGET,
      },
      body,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      region,
      service: AWS_FACE_SERVICE,
      when: nowImpl(),
    });

    let res;
    try {
      res = await doFetch(endpoint, { method: 'POST', headers: signed.headers, body });
    } catch (err) {
      throw new FaceDetectionError(
        `aws-faces: ${field} could not be checked -- ${err?.message ?? err}`,
        { code: 'face-detection-unreachable', cause: err },
      );
    }

    const text = await res.text();
    if (!res.ok) {
      // The body carries `__type` and a message. Neither is echoed to the
      // customer; it reaches the operator through the thrown error.
      throw new FaceDetectionError(
        `aws-faces: ${field} check failed with HTTP ${res.status}: ${text.slice(0, 300)}`,
        { code: 'face-detection-refused-service' },
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new FaceDetectionError('aws-faces: response was not JSON', {
        code: 'face-detection-bad-response', cause: err,
      });
    }

    const details = Array.isArray(parsed?.FaceDetails) ? parsed.FaceDetails : null;
    if (!details) {
      // An empty array means "looked, found nothing" and is a REFUSAL. A
      // missing array means the shape changed, and that must never resolve to
      // a verdict of any kind -- least of all a pass.
      throw new FaceDetectionError('aws-faces: response carried no FaceDetails array', {
        code: 'face-detection-bad-response',
      });
    }

    // The bounding box is expressed as fractions of the image, so width x
    // height is the share of the frame the face occupies. Recorded, never
    // enforced: a face too small to carry identity is a real failure, but no
    // threshold available today is measured, and refusing a paying customer on
    // an invented number is the worse of the two errors.
    const fraction = (f) => {
      const b = f?.BoundingBox;
      const w = Number(b?.Width);
      const h = Number(b?.Height);
      return Number.isFinite(w) && Number.isFinite(h) ? w * h : 0;
    };
    const largest = details.reduce((max, f) => Math.max(max, fraction(f)), 0);

    return {
      ok: details.length > 0,
      reason: details.length > 0 ? null : 'no-face',
      // The seam's own contract: an injected detector owns the verdict AND the
      // confidence. This one looked, so it says so.
      confidence: 'verified',
      impl: AWS_FACE_IMPL,
      faces: details.length,
      // Rounded because a float from a model is not a measurement to nine
      // places, and the manifest is read by people.
      largestFaceFraction: Math.round(largest * 1000) / 1000,
    };
  };
}
