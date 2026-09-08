/**
 * The face gate, backed by Rekognition DetectFaces.
 *
 * WHY THIS EXISTS, and it is a defect that cost money before it was written.
 * `faceGate` in intake/photo.mjs has been a permissive SEAM since it was
 * written: it checks that the aspect is under 3:1 and the short edge over
 * 256px, and nothing else. On 2026-09-07 a photograph of a WRISTWATCH went
 * through the whole eleven-step pipeline and produced a finished, verified
 * tape of a person who does not exist -- 375 frames, 15s, -27.1 LUFS, every
 * assertion in `verify` green. A customer doing that on the live site spends
 * 21 credits and is handed a stranger's face.
 *
 * The seam was always designed to take a detector: "An injected detector owns
 * the verdict AND the confidence." This is that detector. It follows
 * `image-moderate-aws.mjs` in every structural decision, because it is the
 * same service, the same signer, the same credentials and the same host.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAwsFaceDetector,
  awsFaceDetectorFromEnv,
  AWS_FACE_TARGET,
  FaceDetectionError,
  MAX_INLINE_BYTES,
} from '../scripts/safety/face-detect-aws.mjs';

const CREDS = Object.freeze({
  region: 'eu-central-1',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret',
});

const fakeFs = (bytes = Buffer.from('jpegbytes')) => ({ readFileSync: () => bytes });

function recordingFetch(response) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (typeof response === 'function') return response(url, init);
    return response;
  };
  impl.calls = calls;
  return impl;
}

/** A DetectFaces response. `BoundingBox` values are fractions of the image. */
const okWith = (faces, extra = {}) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ FaceDetails: faces, ...extra }),
});

const face = (w, h, confidence = 99.9) => ({
  BoundingBox: { Width: w, Height: h, Left: 0.1, Top: 0.1 },
  Confidence: confidence,
});

const detector = (response, extra = {}) => createAwsFaceDetector({
  ...CREDS,
  fetchImpl: recordingFetch(response),
  fsImpl: fakeFs(),
  ...extra,
});

// ---------------------------------------------------------------------------
// The money guard. Rekognition is billed per image, so this file inherits the
// rule contract.mjs states for every paid transport.
// ---------------------------------------------------------------------------

test('a face detector with no injected transport is a TypeError, never a request', () => {
  assert.throws(
    () => createAwsFaceDetector({ ...CREDS }),
    (err) => err instanceof TypeError && /fetchImpl has NO DEFAULT/.test(err.message),
    'forgetting the transport must fail loudly rather than reach the network',
  );
});

test('the transport is demanded BEFORE the credentials are read', () => {
  assert.throws(
    () => createAwsFaceDetector({ region: 'eu-central-1' }),
    /fetchImpl has NO DEFAULT/,
  );
});

// ---------------------------------------------------------------------------
// The verdict. This is the defect the file exists to close.
// ---------------------------------------------------------------------------

test('a photograph with no face in it is refused', async () => {
  // THE WATCH. Rekognition looked and found nothing, which is a real answer and
  // not a failure -- so the verdict is a refusal carrying `verified`, and the
  // pipeline turns that into "That photo does not look like a photo of a person."
  const detect = detector(okWith([]));
  assert.deepEqual(await detect('/tmp/watch.jpg'), {
    ok: false,
    reason: 'no-face',
    confidence: 'verified',
    impl: 'aws-rekognition-faces-v1',
    faces: 0,
    largestFaceFraction: 0,
  });
});

test('a photograph with one face passes, and says how much of the frame it fills', async () => {
  // The fraction is recorded rather than enforced. A face too small to hold
  // identity is a real risk -- it is why a full-length photograph is a worse
  // reference than a waist-up one -- but no threshold here would be measured,
  // and refusing a paying customer on an invented number is the worse error.
  const detect = detector(okWith([face(0.4, 0.5)]));
  assert.deepEqual(await detect('/tmp/photo.jpg'), {
    ok: true,
    reason: null,
    confidence: 'verified',
    impl: 'aws-rekognition-faces-v1',
    faces: 1,
    largestFaceFraction: 0.2,
  });
});

test('a photograph with several faces passes, and the count is recorded', async () => {
  // THE OWNER'S RULE, taken 2026-09-07 with the alternative on the table.
  // Refusing a photograph because a friend is in the corner of it is a bad
  // trade against how often a good photograph of somebody has company in it.
  // The count reaches the manifest so the choice can be revisited on evidence.
  const detect = detector(okWith([face(0.2, 0.25), face(0.4, 0.5), face(0.1, 0.1)]));
  const verdict = await detect('/tmp/group.jpg');
  assert.equal(verdict.ok, true);
  assert.equal(verdict.faces, 3);
  assert.equal(verdict.largestFaceFraction, 0.2, 'the LARGEST face is the one measured');
});

// ---------------------------------------------------------------------------
// Everything that must not read as a pass.
// ---------------------------------------------------------------------------

test('a response with no FaceDetails array is an error, never a pass', async () => {
  // An empty array means "looked, found nothing" and is a refusal. A MISSING
  // array means the response shape changed, and that must never resolve to a
  // verdict at all. Same rule the moderator states for ModerationLabels.
  const detect = detector({ ok: true, status: 200, text: async () => JSON.stringify({ Something: 'else' }) });
  await assert.rejects(detect('/tmp/photo.jpg'), (err) => err instanceof FaceDetectionError
    && err.code === 'face-detection-bad-response');
});

test('an HTTP failure throws rather than letting the photograph through', async () => {
  const detect = detector({
    ok: false,
    status: 403,
    text: async () => JSON.stringify({ __type: 'InvalidSignatureException', message: 'nope' }),
  });
  await assert.rejects(detect('/tmp/photo.jpg'), (err) => err instanceof FaceDetectionError
    && err.code === 'face-detection-refused-service');
});

test('an unreachable service throws rather than letting the photograph through', async () => {
  const detect = detector(() => { throw new Error('ECONNREFUSED'); });
  await assert.rejects(detect('/tmp/photo.jpg'), (err) => err instanceof FaceDetectionError
    && err.code === 'face-detection-unreachable');
});

test('an oversized image is refused locally, before it is billed', async () => {
  const fetchImpl = recordingFetch(okWith([face(0.4, 0.5)]));
  const detect = createAwsFaceDetector({
    ...CREDS, fetchImpl, fsImpl: fakeFs(Buffer.alloc(MAX_INLINE_BYTES + 1)),
  });
  await assert.rejects(detect('/tmp/huge.jpg'), (err) => err.code === 'image-too-large-to-check');
  assert.equal(fetchImpl.calls.length, 0, 'an oversized image must not reach the network at all');
});

// ---------------------------------------------------------------------------
// Where the request goes, and what it carries.
// ---------------------------------------------------------------------------

test('the credential goes to the region host and names the DetectFaces action', async () => {
  const fetchImpl = recordingFetch(okWith([face(0.4, 0.5)]));
  const detect = createAwsFaceDetector({ ...CREDS, fetchImpl, fsImpl: fakeFs() });
  await detect('/tmp/photo.jpg');

  const [call] = fetchImpl.calls;
  assert.equal(call.url, 'https://rekognition.eu-central-1.amazonaws.com/');
  assert.equal(call.init.headers['x-amz-target'], AWS_FACE_TARGET);
  assert.match(call.init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/);
});

test('a region that is not a region id is refused before any request', () => {
  assert.throws(
    () => createAwsFaceDetector({ ...CREDS, region: 'evil.example.com', fetchImpl: recordingFetch(okWith([])) }),
    /is not an AWS region id/,
  );
});

// ---------------------------------------------------------------------------
// Configuration. The privacy guard §52 built, applied to the second action on
// the same service -- the photograph reaches AWS either way.
// ---------------------------------------------------------------------------

test('no AWS variables means no detector, and nothing changes', () => {
  assert.equal(awsFaceDetectorFromEnv({}, { fetchImpl: recordingFetch(okWith([])) }), null);
});

test('a half-configured environment refuses to build', () => {
  assert.throws(
    () => awsFaceDetectorFromEnv({ AWS_REGION: 'eu-central-1' }, { fetchImpl: recordingFetch(okWith([])) }),
    /half-configured/,
  );
});

test('credentials without the disclosure refuse to build', () => {
  // The same guard as the moderator, and for the same reason: the photograph
  // goes to AWS, and /privacy says it goes to the generation provider and to
  // nobody else. A face check does not get an exemption from that sentence.
  assert.throws(
    () => awsFaceDetectorFromEnv({
      AWS_REGION: 'eu-central-1',
      AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'secret',
    }, { fetchImpl: recordingFetch(okWith([])) }),
    /undisclosed/,
  );
});

test('a declared processor with credentials builds a working detector', async () => {
  const detect = awsFaceDetectorFromEnv({
    AWS_REGION: 'eu-central-1',
    AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
    AWS_SECRET_ACCESS_KEY: 'secret',
    TIMESTAMP_IMAGE_PROCESSOR: 'Amazon Web Services (Rekognition), Frankfurt',
  }, { fetchImpl: recordingFetch(okWith([face(0.4, 0.5)])), fsImpl: fakeFs() });

  assert.equal(typeof detect, 'function');
  assert.equal((await detect('/tmp/photo.jpg')).ok, true);
});
