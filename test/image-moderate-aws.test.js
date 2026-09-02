/**
 * WHY THIS FILE EXISTS. `image-moderate-aws.mjs` is the second thing in this
 * repository that can spend money and hold a credential, and the first one
 * needed four independent guards to stay safe. It is also the file that decides
 * whether a paying customer's own photograph is refused, which is a product
 * decision wearing a classifier's clothes -- so the policy is tested as
 * carefully as the plumbing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAwsImageModerator,
  rekognitionEndpoint,
  REFUSE_CATEGORIES,
  ALLOW_CATEGORIES,
  MAX_INLINE_BYTES,
  AWS_MODERATION_TARGET,
  awsImageModeratorFromEnv,
} from '../scripts/safety/image-moderate-aws.mjs';

const CREDS = Object.freeze({
  region: 'eu-central-1',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  nowImpl: () => new Date(Date.UTC(2026, 8, 1, 12, 0, 0)),
});

/** A tiny fake photo and an fs that serves it, so no test touches a real file. */
const fakeFs = (bytes = Buffer.from('jpegbytes')) => ({ readFileSync: () => bytes });

/** A fetch that records what it was called with and replays a canned response. */
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

const okWith = (labels, extra = {}) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ ModerationLabels: labels, ModerationModelVersion: '7.0', ...extra }),
});

const label = (name, confidence, parentName = '') => ({
  Name: name, Confidence: confidence, ParentName: parentName, TaxonomyLevel: parentName ? 2 : 1,
});

// ---------------------------------------------------------------------------
// The money guard. This is the reason the file is shaped the way it is.
// ---------------------------------------------------------------------------

test('a moderator with no injected transport is a TypeError, never a request', () => {
  assert.throws(
    () => createAwsImageModerator({ ...CREDS }),
    (err) => err instanceof TypeError && /fetchImpl has NO DEFAULT/.test(err.message),
    'forgetting the transport must fail loudly rather than reach the network',
  );
});

test('the transport is demanded BEFORE the credentials are read', () => {
  // Ordering matters: if credentials were validated first, a test that forgot
  // both would get "accessKeyId required" and the money guard would look like
  // a validation error rather than the thing standing between a test and a bill.
  assert.throws(
    () => createAwsImageModerator({ region: 'eu-central-1' }),
    /fetchImpl has NO DEFAULT/,
  );
});

test('the credential goes to exactly one host, derived from the region', async () => {
  const fetchImpl = recordingFetch(okWith([]));
  const moderate = createAwsImageModerator({ ...CREDS, fetchImpl, fsImpl: fakeFs() });
  await moderate('/tmp/photo.jpg', { field: 'photo' });

  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, 'https://rekognition.eu-central-1.amazonaws.com/');
  const { headers } = fetchImpl.calls[0].init;
  assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-central-1\/rekognition\/aws4_request,/);
  assert.equal(headers['x-amz-target'], AWS_MODERATION_TARGET);
  assert.equal(headers['content-type'], 'application/x-amz-json-1.1');
  assert.equal(headers.host, 'rekognition.eu-central-1.amazonaws.com');
});

test('a region that is not a region is refused rather than turned into a host', () => {
  assert.throws(() => rekognitionEndpoint('evil.example.com'), /is not an AWS region id/);
  assert.throws(() => rekognitionEndpoint(''), /is not an AWS region id/);
  assert.throws(() => rekognitionEndpoint(undefined), /is not an AWS region id/);
  assert.equal(rekognitionEndpoint('eu-central-1'), 'https://rekognition.eu-central-1.amazonaws.com/');
});

test('the body is the documented shape and carries the image, not the path', async () => {
  const fetchImpl = recordingFetch(okWith([]));
  const moderate = createAwsImageModerator({
    ...CREDS, fetchImpl, fsImpl: fakeFs(Buffer.from('PHOTOBYTES')), minConfidence: 80,
  });
  await moderate('/tmp/secret-path.jpg');

  const sent = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(sent.Image.Bytes, Buffer.from('PHOTOBYTES').toString('base64'));
  assert.equal(sent.MinConfidence, 80);
  assert.equal('S3Object' in sent.Image, false, 'inline bytes only -- no bucket is involved');
  assert.equal(fetchImpl.calls[0].init.body.includes('secret-path'), false,
    'the filesystem path must never reach the wire');
});

// ---------------------------------------------------------------------------
// Turning it on, and the half-configured case that must never be silent.
// ---------------------------------------------------------------------------

test('an empty environment yields null, which is the designed off state', () => {
  assert.equal(awsImageModeratorFromEnv({}, { fetchImpl: recordingFetch(okWith([])) }), null);
  // Blank strings count as absent -- an operator who comments a value out by
  // emptying it has not half-configured anything.
  assert.equal(
    awsImageModeratorFromEnv(
      { AWS_REGION: '', AWS_ACCESS_KEY_ID: '  ', AWS_SECRET_ACCESS_KEY: '' },
      { fetchImpl: recordingFetch(okWith([])) },
    ),
    null,
  );
});

test('a HALF-configured environment throws rather than quietly disabling checks', () => {
  const fetchImpl = recordingFetch(okWith([]));
  for (const partial of [
    { AWS_REGION: 'eu-central-1' },
    { AWS_REGION: 'eu-central-1', AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE' },
    { AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_SECRET_ACCESS_KEY: 'x' },
  ]) {
    assert.throws(
      () => awsImageModeratorFromEnv(partial, { fetchImpl }),
      /half-configured/,
      `${JSON.stringify(partial)} must refuse, not fall back to off`,
    );
  }
});

test('a fully configured environment builds a working moderator', async () => {
  const fetchImpl = recordingFetch(okWith([]));
  const moderate = awsImageModeratorFromEnv({
    AWS_REGION: 'eu-central-1',
    AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
    AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    TIMESTAMP_IMAGE_PROCESSOR: 'Amazon Web Services (Rekognition), Frankfurt',
  }, { fetchImpl, fsImpl: fakeFs(), nowImpl: CREDS.nowImpl });

  assert.equal(typeof moderate, 'function');
  assert.deepEqual(await moderate('/tmp/photo.jpg'), { ok: true, categories: [] });
  assert.equal(fetchImpl.calls[0].url, 'https://rekognition.eu-central-1.amazonaws.com/');
});

test('even fully configured, it still cannot invent a transport', () => {
  assert.throws(
    () => awsImageModeratorFromEnv({
      AWS_REGION: 'eu-central-1',
      AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'x',
      TIMESTAMP_IMAGE_PROCESSOR: 'Amazon Web Services (Rekognition), Frankfurt',
    }),
    /fetchImpl has NO DEFAULT/,
    'the env path must not become a way around the money guard',
  );
});

// ---------------------------------------------------------------------------
// The policy. These are the tests that protect shipped presets.
// ---------------------------------------------------------------------------

test('a clean photograph passes', async () => {
  const moderate = createAwsImageModerator({ ...CREDS, fetchImpl: recordingFetch(okWith([])), fsImpl: fakeFs() });
  assert.deepEqual(await moderate('/tmp/photo.jpg'), { ok: true, categories: [] });
});

test('explicit content, violence, gore and hate symbols are refused', async () => {
  for (const name of REFUSE_CATEGORIES) {
    const moderate = createAwsImageModerator({
      ...CREDS, fetchImpl: recordingFetch(okWith([label(name, 99)])), fsImpl: fakeFs(),
    });
    const verdict = await moderate('/tmp/photo.jpg');
    assert.equal(verdict.ok, false, `${name} must refuse`);
    assert.equal(verdict.code, 'image-content-refused');
    assert.deepEqual(verdict.categories, [name]);
    assert.match(verdict.userMessage, /cannot use that photo/);
  }
});

test('SWIMWEAR PASSES, because "The beach, out of season" is a shipped preset', async () => {
  // The single most important assertion in this file. A generic block-list
  // refuses this category, and doing so would reject a holiday photograph --
  // the exact customer `ostsee-strand` exists for.
  const moderate = createAwsImageModerator({
    ...CREDS,
    fetchImpl: recordingFetch(okWith([
      label('Swimwear or Underwear', 99),
      label('Female Swimwear or Underwear', 97, 'Swimwear or Underwear'),
    ])),
    fsImpl: fakeFs(),
  });
  assert.equal((await moderate('/tmp/photo.jpg')).ok, true);
});

test('alcohol and tobacco pass, because this product is set in 2003', async () => {
  const moderate = createAwsImageModerator({
    ...CREDS,
    fetchImpl: recordingFetch(okWith([
      label('Alcohol', 96),
      label('Drugs & Tobacco', 94),
      label('Smoking', 91, 'Drugs & Tobacco Paraphernalia & Use'),
    ])),
    fsImpl: fakeFs(),
  });
  assert.equal((await moderate('/tmp/photo.jpg')).ok, true,
    'a cigarette and a beer are period furniture, not a refusal');
});

test('a refusing category below the confidence threshold does not refuse', async () => {
  const moderate = createAwsImageModerator({
    ...CREDS, minConfidence: 80,
    fetchImpl: recordingFetch(okWith([label('Violence', 62)])),
    fsImpl: fakeFs(),
  });
  assert.equal((await moderate('/tmp/photo.jpg')).ok, true);
});

test('a child label refuses on its PARENT category, not only on its own name', async () => {
  // Rekognition returns L2/L3 rows whose own Name is not in the policy. Matching
  // only on `Name` would let "Exposed Buttocks or Anus" through because the
  // policy names its parent, `Explicit`.
  const moderate = createAwsImageModerator({
    ...CREDS,
    fetchImpl: recordingFetch(okWith([label('Exposed Buttocks or Anus', 98, 'Explicit')])),
    fsImpl: fakeFs(),
  });
  const verdict = await moderate('/tmp/photo.jpg');
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.categories, ['Explicit']);
});

test('every category in the published taxonomy is decided, one way or the other', () => {
  // The Level 1 names from the Rekognition moderation taxonomy, read from AWS's
  // documentation on 2026-09-01. If AWS adds a category, this fails -- which is
  // the point. An unhandled category silently defaults to "allowed", and a
  // policy that grows holes as the vendor grows labels is worse than no policy.
  const TAXONOMY_L1 = [
    'Explicit',
    'Non-Explicit Nudity of Intimate parts and Kissing',
    'Swimwear or Underwear',
    'Violence',
    'Visually Disturbing',
    'Drugs & Tobacco',
    'Alcohol',
    'Rude Gestures',
    'Gambling',
    'Hate Symbols',
  ];

  const decided = new Set([...REFUSE_CATEGORIES, ...ALLOW_CATEGORIES]);
  const undecided = TAXONOMY_L1.filter((c) => !decided.has(c));
  assert.deepEqual(undecided, [], 'these categories are in neither list and would silently pass');

  const overlap = REFUSE_CATEGORIES.filter((c) => ALLOW_CATEGORIES.includes(c));
  assert.deepEqual(overlap, [], 'a category cannot be both refused and allowed');

  const unknown = [...decided].filter((c) => !TAXONOMY_L1.includes(c));
  assert.deepEqual(unknown, [], 'the policy names a category the taxonomy does not have');
});

// ---------------------------------------------------------------------------
// Failure. Every one of these must THROW, because a silent pass is
// indistinguishable from a clean result a year later.
// ---------------------------------------------------------------------------

test('a transport failure throws rather than passing the photo', async () => {
  const moderate = createAwsImageModerator({
    ...CREDS, fsImpl: fakeFs(),
    fetchImpl: async () => { throw new Error('ECONNRESET'); },
  });
  await assert.rejects(() => moderate('/tmp/photo.jpg'), /could not be checked/);
});

test('an HTTP error throws, and the service body does not reach the customer', async () => {
  const moderate = createAwsImageModerator({
    ...CREDS, fsImpl: fakeFs(),
    fetchImpl: recordingFetch({
      ok: false, status: 400,
      text: async () => JSON.stringify({ __type: 'InvalidSignatureException', message: 'nope' }),
    }),
  });
  await assert.rejects(() => moderate('/tmp/photo.jpg'), (err) => {
    assert.equal(err.code, 'image-moderation-refused-service');
    assert.match(err.message, /HTTP 400/);
    assert.equal(err.userMessage, undefined, 'a service error is not customer copy');
    return true;
  });
});

test('a response with no ModerationLabels array throws instead of reading as clean', async () => {
  // The dangerous case: a shape change that yields `undefined`, which every
  // `.filter()` in the world happily turns into "nothing found".
  const moderate = createAwsImageModerator({
    ...CREDS, fsImpl: fakeFs(),
    fetchImpl: recordingFetch({ ok: true, status: 200, text: async () => JSON.stringify({ Something: 'else' }) }),
  });
  await assert.rejects(() => moderate('/tmp/photo.jpg'), /carried no ModerationLabels array/);
});

test('an empty array is a pass and a missing one is not -- they must not be confused', async () => {
  const moderate = createAwsImageModerator({
    ...CREDS, fsImpl: fakeFs(), fetchImpl: recordingFetch(okWith([])),
  });
  assert.equal((await moderate('/tmp/photo.jpg')).ok, true);
});

test('a body that is not JSON throws', async () => {
  const moderate = createAwsImageModerator({
    ...CREDS, fsImpl: fakeFs(),
    fetchImpl: recordingFetch({ ok: true, status: 200, text: async () => '<html>502</html>' }),
  });
  await assert.rejects(() => moderate('/tmp/photo.jpg'), /response was not JSON/);
});

test('an oversized image is refused locally, before it is billed', async () => {
  const fetchImpl = recordingFetch(okWith([]));
  const moderate = createAwsImageModerator({
    ...CREDS, fetchImpl, fsImpl: fakeFs(Buffer.alloc(MAX_INLINE_BYTES + 1)),
  });
  await assert.rejects(() => moderate('/tmp/huge.jpg'), /over the 5000000 inline limit/);
  assert.equal(fetchImpl.calls.length, 0, 'an oversized image must not reach the network at all');
});

// ---------------------------------------------------------------------------
// the disclosure, and why the worker enforces it
// ---------------------------------------------------------------------------

/**
 * A CLASSIFIER THIS PRODUCT HAS NOT DISCLOSED MUST NOT BE ABLE TO RUN.
 *
 * `/privacy` tells a customer their photograph goes to fal.ai "and to nobody
 * else". Setting the three AWS variables makes that false, and §52B could only
 * ask whoever set them to remember to change the page -- "nothing in the code
 * can notice" were its words.
 *
 * Something can notice now, and it is this process rather than the web one.
 * §51E split the environment so each container holds only the secrets it reads:
 * the AWS keys are the worker's, and `/privacy` is rendered by web, which never
 * sees them. So web cannot derive the truth -- it reads
 * `TIMESTAMP_IMAGE_PROCESSOR`, a non-secret declaration in `.env.common`, and
 * the worker refuses to start when it holds keys that declaration does not
 * account for.
 *
 * The result is that the disclosure cannot lag the deployment: a box configured
 * to classify photographs without saying so does not render tapes at all, which
 * is a failure somebody notices in minutes rather than in a subject access
 * request.
 */
test('a classifier with no public disclosure refuses to start', () => {
  const env = {
    AWS_REGION: 'eu-central-1',
    AWS_ACCESS_KEY_ID: 'AKIA_TEST',
    AWS_SECRET_ACCESS_KEY: 'secret',
  };

  assert.throws(
    () => awsImageModeratorFromEnv(env, { fetchImpl: async () => ({}) }),
    (err) => {
      assert.match(err.message, /TIMESTAMP_IMAGE_PROCESSOR/,
        'the refusal must name the variable that fixes it');
      assert.match(err.message, /privacy/i,
        'the refusal must say why -- the page is the thing being protected');
      return true;
    },
    'a configured classifier with no disclosure started anyway',
  );
});

test('a declared classifier starts normally', () => {
  const env = {
    AWS_REGION: 'eu-central-1',
    AWS_ACCESS_KEY_ID: 'AKIA_TEST',
    AWS_SECRET_ACCESS_KEY: 'secret',
    TIMESTAMP_IMAGE_PROCESSOR: 'Amazon Web Services (Rekognition), Frankfurt',
  };
  const m = awsImageModeratorFromEnv(env, { fetchImpl: async () => ({}) });
  assert.equal(typeof m, 'function', 'a declared, fully-configured classifier must build');
});

test('the declaration alone turns nothing on', () => {
  // Somebody who writes the disclosure first and the keys later has an honest
  // page and no classifier, which is the safe order and must not throw. The
  // page says what the deployment does; the deployment is still off.
  const m = awsImageModeratorFromEnv(
    { TIMESTAMP_IMAGE_PROCESSOR: 'Amazon Web Services (Rekognition), Frankfurt' },
    { fetchImpl: async () => ({}) },
  );
  assert.equal(m, null, 'a declaration with no credentials must stay off, not throw');
});
