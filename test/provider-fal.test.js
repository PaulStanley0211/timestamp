/**
 * `providers/fal.mjs`, exercised against RECORDED SHAPES and injected fakes.
 *
 * NOTHING IN THIS FILE MAY SPEND A CENT, and it is written so that a mistake
 * cannot make it spend one either. There is no `FAL_KEY` in the process during
 * `npm test`; `ctx.fetchImpl` has no default so a forgotten injection is a
 * `TypeError` rather than a bill; and the fixtures under `test/fixtures/fal/`
 * were copied out of fal's documentation rather than out of a response we paid
 * for. The one file permitted to spend is `test/fal-smoke.test.js`, which
 * self-skips unless `TIMESTAMP_LIVE=1`.
 *
 * WHAT A RECORDED FIXTURE PROVES AND WHAT IT DOES NOT. It proves the provider
 * parses, classifies, retries, polls, downloads and gives up in the shapes the
 * vendor SAYS it returns. It proves nothing about whether the vendor returns
 * them. Every fixture carries a `_provenance` field saying which of the two it
 * is -- VERIFIED from a schema page, or INFERRED -- so that when a live call
 * eventually disagrees, the argument is about one named guess rather than about
 * the whole directory.
 *
 * THE TRANSPORT FAKE IS A REAL QUEUE, not a canned answer. It accepts a
 * submit, hands back a request id, reports IN_QUEUE then IN_PROGRESS then
 * COMPLETED, and serves a media file from a url it minted -- because the
 * behaviour most likely to be wrong in a queue client is the polling, and a
 * fake that returns COMPLETED on the first status call tests none of it.
 *
 * THIS FILE EXPORTS `falContractCase` AND THAT IS THE POINT OF THE WHOLE
 * PROVIDER LAYER. `test/provider-contract.test.js` gained ONE ENTRY in its
 * case array and its body was not edited. Two implementations that share no
 * code path -- one spawns local ffmpeg, one speaks HTTP to a paid queue --
 * passing the identical assertions is the only honest reason the pipeline may
 * call `provider.generateStill` without knowing which one it holds.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { runFfmpeg, findFfmpeg, REPO_ROOT } from '../scripts/ffmpeg/run.mjs';
import {
  createFalProvider,
  FAL_ID,
  FAL_CAPABILITIES,
  FAL_RESOLUTIONS,
  FAL_ENDPOINTS,
  FAL_QUEUE_BASE,
  falStillBody,
  falVideoBody,
  falReferenceVideoBody,
  falRequestId,
  falResolutionFor,
  falMimeType,
  falDataUri,
  falClipName,
  falStillName,
  assertAllowedHost,
} from '../scripts/providers/fal.mjs';
import {
  CredentialError,
  TerminalError,
  RetriableError,
  TimeoutError,
  CapabilityError,
  ModerationRefusedError,
} from '../scripts/providers/errors.mjs';
import { createProvider, loadModels, PROVIDER_IDS } from '../scripts/providers/index.mjs';
import { loadPricing } from '../scripts/providers/pricing.mjs';
import {
  planSegments, resolutionRaster, RESOLUTIONS, AVAILABLE_RESOLUTIONS, DEFAULT_RESOLUTION,
} from '../scripts/animate/plan.mjs';
import { fixtureStillFilter, fixtureStillArgs } from '../scripts/providers/fixture.mjs';
import { createJob } from '../scripts/render/job.mjs';
import { runFake, makeProvider, tmpRoot, writeUpload, CONSENT } from './pipeline.test.js';

const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'render.json'), 'utf8'));

// ---------------------------------------------------------------------------
// fixtures + transport
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.join(REPO_ROOT, 'test', 'fixtures', 'fal');

/** One recorded shape. `_provenance` and `_shape` are documentation and never
 *  reach the wire -- the transport serves `.body` and nothing else. */
export function falFixture(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8'));
  assert.ok(raw._provenance?.length > 0, `${name}.json must say where its shape came from`);
  return raw;
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() { return JSON.stringify(body); },
});

const bytesResponse = (buf) => ({
  ok: true,
  status: 200,
  async text() { return buf.toString('utf8'); },
  async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); },
});

/**
 * A fal queue, faked end to end.
 *
 * @param {object} [opts]
 * @param {number} [opts.pollsBeforeDone]  status calls before COMPLETED
 * @param {(ctx:object) => Promise<Buffer>|Buffer} [opts.media]  the file served
 * @param {Array} [opts.failures]          `[{ times, status, fixture }]` queued
 *                                          up and served before anything else
 */
export function makeFalTransport(opts = {}) {
  const pollsBeforeDone = opts.pollsBeforeDone ?? 2;
  const media = opts.media ?? (() => Buffer.from('fake media bytes, and nobody probed them\n'));
  const failures = [...(opts.failures ?? [])];

  /** Every request, in order. The assertions in this file are mostly about
   *  what was SENT -- a provider that parses a response perfectly while asking
   *  for the wrong resolution is the exact bug this work exists to close. */
  const requests = [];
  const submits = new Map();
  let seq = 0;

  async function fetchImpl(url, init = {}) {
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, method, body, headers: init.headers ?? {} });

    if (failures.length > 0) {
      const next = failures[0];
      next.times -= 1;
      if (next.times <= 0) failures.shift();
      const fx = falFixture(next.fixture);
      return jsonResponse(next.status ?? fx.status, fx.body);
    }

    // -- the media CDN ----------------------------------------------------
    if (url.startsWith('https://v3.fal.media/')) {
      const id = path.basename(url).replace(/\.(png|mp4)$/, '');
      const record = submits.get(id);
      return bytesResponse(await media({ id, ...record }));
    }

    // -- submit -----------------------------------------------------------
    if (method === 'POST') {
      seq += 1;
      const id = `fixture-req-${String(seq).padStart(16, '0')}`;
      const endpoint = url.slice(`${FAL_QUEUE_BASE}/`.length);
      const kind = /video/.test(endpoint) ? 'video' : 'still';
      submits.set(id, { endpoint, kind, body, polls: 0 });
      const fx = falFixture('queue-accepted');
      return jsonResponse(fx.status, {
        ...fx.body,
        request_id: id,
        status_url: `${FAL_QUEUE_BASE}/${endpoint}/requests/${id}/status`,
        response_url: `${FAL_QUEUE_BASE}/${endpoint}/requests/${id}`,
        cancel_url: `${FAL_QUEUE_BASE}/${endpoint}/requests/${id}/cancel`,
      });
    }

    // -- status -----------------------------------------------------------
    const statusMatch = /\/requests\/([^/]+)\/status$/.exec(url);
    if (statusMatch) {
      const id = statusMatch[1];
      const record = submits.get(id);
      record.polls += 1;
      if (record.polls > pollsBeforeDone) {
        const fx = falFixture('status-completed');
        return jsonResponse(fx.status, { ...fx.body, request_id: id });
      }
      const fx = falFixture(record.polls === 1 ? 'status-in-queue' : 'status-in-progress');
      return jsonResponse(fx.status, { ...fx.body, request_id: id });
    }

    // -- result -----------------------------------------------------------
    const resultMatch = /\/requests\/([^/]+)$/.exec(url);
    if (resultMatch) {
      const id = resultMatch[1];
      const record = submits.get(id);
      if (record.kind === 'video') {
        const fx = falFixture('result-video');
        return jsonResponse(fx.status, {
          ...fx.body,
          video: { ...fx.body.video, url: `https://v3.fal.media/files/fixture/${id}.mp4` },
        });
      }
      const fx = falFixture('result-still');
      return jsonResponse(fx.status, {
        ...fx.body,
        images: [{ ...fx.body.images[0], url: `https://v3.fal.media/files/fixture/${id}.png` }],
      });
    }

    throw new Error(`the fake transport was asked for something it does not serve: ${method} ${url}`);
  }

  return {
    fetchImpl,
    requests,
    submits,
    posts: () => requests.filter((r) => r.method === 'POST'),
  };
}

/**
 * A models table whose STILL model is verified, so the still path can be
 * exercised at all.
 *
 * Built from the REAL `config/models.json` and then extended, deliberately:
 * the video half of every test below runs against the real, verified seedance
 * entry, its real `generate_audio` audio-off parameter and its real price. Only
 * the still model is stubbed, because there is not a verified one to stub with
 * -- that is Paul's decision and it is downstream of Phase 0.
 */
export function testModels() {
  const models = loadModels();
  models.models['test/identity-still'] = {
    _comment: 'TEST ONLY. Stands in for whichever identity-preserving image model is chosen, so that generateStill has a verified entry to resolve. It is not in config/models.json and it never renders anything.',
    verified: true,
    provider: FAL_ID,
    kind: 'still',
    endpoint: 'test-ai/identity-still',
    capabilities: { stillSizes: [...FAL_CAPABILITIES.stillSizes], maxReferences: 2, supportsPlaceReference: true },
  };
  models.defaults[FAL_ID] = { still: 'test/identity-still', video: models.defaults[FAL_ID].video };
  return models;
}

export function testPricing() {
  const pricing = loadPricing();
  pricing.models['test/identity-still'] = {
    _comment: 'TEST ONLY. ESTIMATE. A non-zero number, because the conformance test asserts that a PAID provider does not report an estimate of zero -- a paid provider estimating $0 is not estimating.',
    estimate: true,
    unit: 'image',
    usd: 0.05,
    source: 'test stand-in',
  };
  return pricing;
}

const FAKE_ENV = () => ({ FAL_KEY: 'test-key-that-reaches-no-network' });

/** A provider wired to fakes: fake transport, fake key, no sleeping, no clock
 *  drift. Everything that could reach the network or the wall is injected. */
export function falUnderTest({ transport = makeFalTransport(), models = testModels(), pricing = testPricing(), ...rest } = {}) {
  const provider = createFalProvider({
    cfg, models, pricing, envImpl: FAKE_ENV, ...rest,
  });
  const ctx = (extra = {}) => ({
    outDir: extra.outDir ?? tmpDir('ctx'),
    fetchImpl: transport.fetchImpl,
    sleepImpl: async () => {},
    ...extra,
  });
  return { provider, transport, ctx };
}

let dirSeq = 0;
/**
 * A directory this process alone writes to.
 *
 * THE PID IS NOT DECORATION. `dirSeq` counts per process while the path it
 * builds is shared, and `node --test` runs test FILES in parallel processes --
 * `provider-contract.test.js` imports `falContractCase` from this file, so two
 * processes run this module at once, both start the counter at zero and both
 * walk the same `build/provider-fal/<label>-<n>` names. `mkdirSync` with
 * `recursive` does not complain when the name is already there, so the
 * collision is silent, and when the two processes reach the same media key at
 * the same moment they are two ffmpegs writing one path: whoever reads between
 * the truncate and the first byte gets zero bytes and the provider raises
 * `empty_download`. That is the 720p pixel test failing about three runs in
 * eight while passing every time in isolation (CLAUDE.md section 4) -- it is a
 * collision between two test processes and never a defect in the provider.
 *
 * Same fix and same reason as the tmp name in `scripts/auth/accounts.mjs`,
 * which carries a pid for the same class of shared-path race.
 */
function tmpDir(label) {
  dirSeq += 1;
  const dir = path.join(REPO_ROOT, 'build', 'provider-fal', `${label}-${process.pid}-${dirSeq}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A file on disk to stand in for a photograph. The provider never looks
 *  inside one; it checks it exists and base64s it. */
function writeImage(dir, name = 'face.png') {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  // A real PNG signature, so the mime sniffer has something true to find.
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('not a real image body, and nothing here decodes it\n'),
  ]));
  return file;
}

function stillRequest(overrides = {}) {
  return {
    prompt: 'the person in the reference image, standing by a garden fence, low late-afternoon sun',
    negativePrompt: 'text, watermark, extra people',
    references: [{ role: 'face', path: writeImage(tmpDir('ref')) }],
    seed: 4242,
    count: 1,
    size: FAL_RESOLUTIONS['480p'],
    idempotencyKey: 'fal-still-1',
    ...overrides,
  };
}

function videoRequest(overrides = {}) {
  return {
    prompt: 'a slow handheld drift, the person stays where they are',
    negativePrompt: 'cuts, zooms',
    imagePath: writeImage(tmpDir('start'), 'still-01.png'),
    seed: 777,
    seconds: 15,
    nativeAudio: false,
    index: 1,
    size: FAL_RESOLUTIONS['480p'],
    idempotencyKey: 'fal-video-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The case the conformance suite runs. ONE ENTRY IN ONE ARRAY.
// ---------------------------------------------------------------------------

/**
 * The fal entry for `runProviderContract`.
 *
 * The transport is fake and the media it serves is REAL: each still and clip is
 * rendered locally by the fixture provider's own pure builders, at the size and
 * duration the recorded request asked for. That is what lets the conformance
 * body's pixel assertions -- correct raster, distinguishable stills, zero audio
 * streams, frame count matching the claimed duration -- mean something against
 * a provider that cannot be allowed to generate anything.
 */
export function falContractCase() {
  const transport = makeFalTransport({ media: renderMedia });

  return {
    name: FAL_ID,
    create: () => createFalProvider({
      cfg,
      models: testModels(),
      pricing: testPricing(),
      envImpl: FAKE_ENV,
    }),
    makeCtx: (base) => ({ ...base, sleepImpl: async () => {}, fetchImpl: transport.fetchImpl }),
    transport,
  };
}

/**
 * The bytes the fake CDN serves, rendered locally and CACHED BY CONTENT.
 *
 * TWO DELIBERATE ECONOMIES, and both of them are about the suite rather than
 * about fal. `npm test` runs test FILES in parallel, so every ffmpeg inside a
 * test competes with every other ffmpeg in the suite -- CLAUDE.md records two
 * tests that failed under full load while passing in isolation. So: the cache
 * is keyed on what the media IS, not on the request id, which turns the
 * conformance body's "the same request twice" from six encodes into three; and
 * the clip is a single lavfi source at `ultrafast`, not the fixture provider's
 * tuned graph, because nothing here asserts on how a clip LOOKS -- only that it
 * is the right raster, the right number of frames, and carries no audio.
 *
 * The stills keep the fixture's real filtergraph, because "the stills are
 * visually distinguishable from one another" IS asserted, for the reason that
 * test gives: three identical images render, click and pass every other
 * assertion while showing a human the same picture three times.
 */
const mediaCache = new Map();
async function renderMedia({ kind, body }) {
  const size = kind === 'video'
    ? falRasterOf(body.resolution)
    : (body.image_size ?? FAL_RESOLUTIONS['480p']);
  const seconds = kind === 'video' ? Number(body.duration) : 0;
  const key = `${kind}|${body.seed}|${size.width}x${size.height}|${seconds}`;
  if (mediaCache.has(key)) return mediaCache.get(key);

  const out = path.join(tmpDir('media'), `${key.replace(/[|:]/g, '-')}.${kind === 'video' ? 'mp4' : 'png'}`);
  if (kind === 'video') {
    await runFfmpeg([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=0x384A5E:s=${size.width}x${size.height}:r=${cfg.fps}`,
      '-frames:v', String(Math.round(seconds * cfg.fps)),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-pix_fmt', 'yuv420p',
      // There is no audio source in the graph either; -an is the belt to that
      // braces, and it is what the zero-audio-streams assertion reads.
      '-an', out,
    ]);
  } else {
    await runFfmpeg(fixtureStillArgs({
      filter: fixtureStillFilter({ seed: body.seed, index: (body.seed % 8) + 1, size, fontPath: null }),
      output: out,
    }));
  }
  const bytes = fs.readFileSync(out);
  mediaCache.set(key, bytes);
  return bytes;
}

const falRasterOf = (label) => FAL_RESOLUTIONS[label] ?? FAL_RESOLUTIONS['480p'];

// ---------------------------------------------------------------------------
// the money guards, and the ORDER they fire in
// ---------------------------------------------------------------------------

test('[fal] no fetchImpl is a TypeError before anything else -- even with a key', async () => {
  // Guard 1. A plain TypeError and NOT a ProviderError: a ProviderError is
  // something the pipeline catches, records and may retry, and a missing
  // transport is a wiring bug that should crash.
  const provider = createFalProvider({ cfg, models: testModels(), pricing: testPricing(), envImpl: FAKE_ENV });
  await assert.rejects(
    provider.generateStill(stillRequest(), { outDir: tmpDir('no-fetch') }),
    (err) => {
      assert.ok(err instanceof TypeError, `expected TypeError, got ${err?.name}`);
      assert.ok(!(err instanceof TerminalError));
      assert.match(err.message, /NO DEFAULT/);
      return true;
    },
  );
  await assert.rejects(
    provider.generateVideo(videoRequest(), { outDir: tmpDir('no-fetch') }),
    TypeError,
  );
});

test('[fal] a missing FAL_KEY is raised BEFORE any request is attempted', async () => {
  // The failure ORDER is the assertion, not the failure. A provider that
  // submits and then notices it has no credential has already told fal about a
  // job it cannot collect.
  const transport = makeFalTransport();
  const provider = createFalProvider({
    cfg, models: testModels(), pricing: testPricing(), envImpl: () => ({}),
  });
  await assert.rejects(
    provider.generateStill(stillRequest(), { outDir: tmpDir('no-key'), fetchImpl: transport.fetchImpl, sleepImpl: async () => {} }),
    (err) => {
      assert.ok(err instanceof CredentialError, `expected CredentialError, got ${err?.name}`);
      assert.equal(err.retriable, false, 'retrying cannot conjure a key, and every attempt is an abuse-log line');
      assert.match(err.message, /FAL_KEY/);
      return true;
    },
  );
  assert.equal(transport.requests.length, 0, 'a request was made without a credential');
});

test('[fal] the factory reads no credential, so --dry-run works with no key', () => {
  // `--dry-run` exists to answer "what would this cost" before spending, and a
  // factory that read FAL_KEY would make that question require a credential.
  const before = process.env.FAL_KEY;
  assert.equal(before, undefined, 'guard 3: npm test does not load .env');
  const provider = createProvider(FAL_ID);
  assert.equal(provider.id, FAL_ID);
  assert.equal(provider.paid, true);
  assert.equal(provider.capabilities.maxClipSeconds, 15);
  assert.deepEqual(PROVIDER_IDS, ['fixture', 'fal']);
});

test('[fal] an UNVERIFIED still model is refused before a request exists', async () => {
  // The real config: every fal still model is a candidate nobody has read the
  // schema page for. The one thing that must not happen is a paid call against
  // an endpoint id somebody guessed.
  const transport = makeFalTransport();
  const provider = createFalProvider({ cfg, envImpl: FAKE_ENV });
  await assert.rejects(
    provider.generateStill(stillRequest(), { outDir: tmpDir('unverified'), fetchImpl: transport.fetchImpl, sleepImpl: async () => {} }),
    (err) => {
      assert.equal(err.code, 'unverified_model');
      assert.match(err.message, /fal\/UNVERIFIED-identity-still/);
      return true;
    },
  );
  assert.equal(transport.requests.length, 0);
});

test('[fal] the VIDEO model in the real config is verified and names its audio-off parameter', async () => {
  const transport = makeFalTransport();
  const provider = createFalProvider({ cfg, envImpl: FAKE_ENV, pricing: testPricing() });
  const res = await provider.generateVideo(videoRequest(), {
    outDir: tmpDir('real-video'), fetchImpl: transport.fetchImpl, sleepImpl: async () => {},
  });
  assert.equal(res.meta.model, 'bytedance/seedance-2.0/image-to-video');
  assert.equal(transport.posts()[0].body.generate_audio, false);
});

// ---------------------------------------------------------------------------
// the wire: what is actually sent
// ---------------------------------------------------------------------------

test('[fal] generate_audio is FALSE on the wire, and it defaults to true at the vendor', () => {
  // Layer 1 reaching the transport. The default at fal is TRUE, so an omitted
  // field ships every video with the model's own ambience under our bed.
  const body = falVideoBody({
    prompt: 'p', imagePath: 'x', seconds: 15, seed: 1,
    size: FAL_RESOLUTIONS['720p'], nativeAudio: false,
    dataUriImpl: () => 'data:image/png;base64,AA==',
  });
  assert.equal(body.generate_audio, false);
  assert.ok(Object.hasOwn(body, 'generate_audio'), 'omitted is not the same as false here');
});

test('[fal] duration is a STRING enum and the aspect ratio is always 4:3', () => {
  const body = falVideoBody({
    prompt: 'p', imagePath: 'x', seconds: 15, seed: 1,
    size: FAL_RESOLUTIONS['480p'], nativeAudio: false,
    dataUriImpl: () => 'data:image/png;base64,AA==',
  });
  // "15", not 15. fal's schema spells the enum out as string literals and an
  // integer is a 422 that costs a round trip to discover.
  assert.equal(body.duration, '15');
  assert.equal(typeof body.duration, 'string');
  assert.equal(body.aspect_ratio, '4:3');
  assert.equal(body.resolution, '480p');
});

test('[fal] the resolution the customer paid for is the resolution on the wire', () => {
  assert.equal(falResolutionFor({ width: 640, height: 480 }), '480p');
  assert.equal(falResolutionFor({ width: 960, height: 720 }), '720p');
  // No nearest-match: substituting 480p for a 720p order bills for one thing
  // and renders another, and nobody downstream can see it.
  assert.throws(() => falResolutionFor({ width: 1280, height: 720 }), (err) => {
    assert.ok(err instanceof CapabilityError);
    assert.equal(err.code, 'unsupported_size');
    return true;
  });
});

test('[fal] the still body carries the references, the seed and the raster', () => {
  const body = falStillBody({
    prompt: 'a person by a fence',
    references: [{ role: 'face', path: 'a' }, { role: 'place', path: 'b' }],
    seed: 99,
    size: FAL_RESOLUTIONS['720p'],
    dataUriImpl: (p) => `data:image/png;base64,${p}`,
  });
  assert.deepEqual(body.image_urls, ['data:image/png;base64,a', 'data:image/png;base64,b']);
  assert.equal(body.seed, 99);
  assert.equal(body.aspect_ratio, '4:3');
  assert.deepEqual(body.image_size, { width: 960, height: 720 });
  assert.equal(body.num_images, 1, 'one image per call, one seed per image -- see the header of fal.mjs');
  // There is no negative_prompt parameter on any of these endpoints, and it is
  // deliberately NOT appended to the prompt: a model with no negative channel
  // reads "no watermark" as a thing the scene contains.
  assert.equal(body.negative_prompt, undefined);
  assert.ok(!/watermark/.test(body.prompt));
});

test('[fal] the credential goes to the queue host and never to the CDN', async () => {
  const { provider, transport, ctx } = falUnderTest();
  await provider.generateVideo(videoRequest(), ctx({ outDir: tmpDir('auth') }));
  const queueCalls = transport.requests.filter((r) => r.url.startsWith(FAL_QUEUE_BASE));
  const cdnCalls = transport.requests.filter((r) => r.url.startsWith('https://v3.fal.media/'));
  assert.ok(queueCalls.length >= 3, 'submit, at least one poll, and the result');
  for (const call of queueCalls) assert.match(call.headers.Authorization, /^Key /);
  assert.equal(cdnCalls.length, 1);
  assert.equal(cdnCalls[0].headers.Authorization, undefined, 'the CDN does not want our key and must never see it');
});

/**
 * The queue's answer names where to poll, and that answer is data. The
 * allow-list already stops a wholly foreign host; this pins the tighter rule
 * the ALLOWED_HOSTS comment states: hosts we merely download from are not
 * hosts we authenticate to. A `status_url` steered at any of them -- here the
 * multi-tenant storage host, where anyone can own a bucket -- must be refused
 * outright, and above all must never be sent the key.
 */
test('[fal] a status url steered off the queue host is refused and never sees the credential', async () => {
  const transport = makeFalTransport();
  const hijacked = {
    ...transport,
    async fetchImpl(url, init = {}) {
      const res = await transport.fetchImpl(url, init);
      if ((init.method ?? 'GET').toUpperCase() !== 'POST') return res;
      const body = { ...JSON.parse(await res.text()), status_url: 'https://storage.googleapis.com/somebody-elses-bucket/status' };
      return { ...res, async text() { return JSON.stringify(body); } };
    },
  };
  const { provider, ctx } = falUnderTest({ transport: hijacked });

  await assert.rejects(
    () => provider.generateVideo(videoRequest(), ctx({ outDir: tmpDir('hijack') })),
    (err) => {
      assert.equal(err.code, 'credential_scope', `refused for the wrong reason: ${err.code} -- ${err.message}`);
      return true;
    },
  );
  const offQueue = transport.requests.filter((r) => !r.url.startsWith(FAL_QUEUE_BASE));
  for (const call of offQueue) {
    assert.equal(call.headers.Authorization, undefined, `${call.url} was sent the credential`);
  }
});

/**
 * The allow-list gates the URL we DIAL. Until this test it did not gate where
 * that URL sent us next.
 *
 * `assertAllowedHost` runs once, before the request. Node's global fetch
 * defaults to `redirect: 'follow'` and will chase up to twenty hops, so an
 * allowlisted host answering `302 Location: http://169.254.169.254/…` was
 * followed without the list being consulted again. That address is the cloud
 * instance metadata service on every major provider -- which this project is
 * about to have one of -- and it serves instance credentials to anything that
 * can make it a request.
 *
 * WHY THE FAKE HONOURS `init.redirect` INSTEAD OF JUST ASSERTING ON IT. A fake
 * transport does not follow redirects by itself, so a test that hands one back
 * proves nothing about the real bug: the defect is in what this code ASKS the
 * platform to do. So the fake behaves as the platform does -- it follows when
 * asked to follow, and hands the 3xx back when asked not to -- and the
 * assertion is the outcome that matters: no request ever reaches a host that
 * is not on the list. That fails before the fix for the right reason, because
 * the fake really does make the metadata request.
 *
 * The Authorization header is stripped by the fetch spec on a cross-origin
 * redirect, so `FAL_KEY` was never the thing at risk here. The request itself
 * is.
 */
test('[fal] a redirect off the allow-list is refused, not followed', async () => {
  const METADATA = 'http://169.254.169.254/latest/meta-data/iam/security-credentials/';
  const base = makeFalTransport();
  const seen = [];

  const platformish = async (url, init = {}) => {
    seen.push(String(url));
    // The media CDN answers with a redirect that leaves the allow-list.
    if (String(url).startsWith('https://v3.fal.media/')) {
      const hop = {
        ok: false, status: 302, redirected: false,
        headers: { get: (h) => (h.toLowerCase() === 'location' ? METADATA : null) },
        async text() { return ''; },
        async arrayBuffer() { return new ArrayBuffer(0); },
      };
      // This is what Node does when `redirect` is unset or 'follow'.
      if ((init.redirect ?? 'follow') === 'follow') return platformish(METADATA, { ...init, redirect: 'follow' });
      return hop;
    }
    if (String(url) === METADATA) {
      return {
        ok: true, status: 200,
        headers: { get: () => null },
        async text() { return 'AccessKeyId=AKIA-STOLEN'; },
        async arrayBuffer() { return new TextEncoder().encode('AccessKeyId=AKIA-STOLEN').buffer; },
      };
    }
    return base.fetchImpl(url, init);
  };

  const { provider, ctx } = falUnderTest({ transport: { ...base, fetchImpl: platformish } });

  await assert.rejects(
    () => provider.generateVideo(videoRequest(), ctx({ outDir: tmpDir('redirect') })),
    (err) => {
      assert.ok(err, 'the redirect was followed and the render succeeded');
      return true;
    },
  );

  const offList = seen.filter((u) => {
    try { return !/(^|\.)(fal\.run|fal\.media|storage\.googleapis\.com)$/.test(new URL(u).hostname); }
    catch { return true; }
  });
  assert.deepEqual(offList, [],
    `a redirect took a request to ${offList.join(', ')} -- the allow-list was consulted once and then bypassed`);
});

test('[fal] a redirect that stays on the allow-list is still followed', async () => {
  // The refusal above must not become a refusal to redirect at all: fal's CDN
  // legitimately 302s between its own hosts, and a fix that broke downloads
  // would be caught here rather than on the first paid render.
  const base = makeFalTransport();
  const FINAL = 'https://storage.googleapis.com/fal-bucket/final.mp4';
  let servedFinal = false;

  const platformish = async (url, init = {}) => {
    if (String(url).startsWith('https://v3.fal.media/')) {
      const hop = {
        ok: false, status: 302, redirected: false,
        headers: { get: (h) => (h.toLowerCase() === 'location' ? FINAL : null) },
        async text() { return ''; },
        async arrayBuffer() { return new ArrayBuffer(0); },
      };
      if ((init.redirect ?? 'follow') === 'follow') return platformish(FINAL, { ...init, redirect: 'follow' });
      return hop;
    }
    if (String(url) === FINAL) {
      servedFinal = true;
      const buf = Buffer.from('fake media bytes, and nobody probed them\n');
      return {
        ok: true, status: 200,
        headers: { get: () => null },
        async text() { return buf.toString('utf8'); },
        async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); },
      };
    }
    return base.fetchImpl(url, init);
  };

  const { provider, ctx } = falUnderTest({ transport: { ...base, fetchImpl: platformish } });
  await provider.generateVideo(videoRequest(), ctx({ outDir: tmpDir('redirect-ok') }));
  assert.equal(servedFinal, true, 'a legitimate redirect within the allow-list was not followed');
});

test('[fal] an idempotency key is sent with the submit', async () => {
  // fal does not document the header. Sending it costs nothing and is the
  // honest attempt; the guarantee that actually holds is the intent record
  // render/job.mjs writes BEFORE the call.
  const { provider, transport, ctx } = falUnderTest();
  await provider.generateVideo(videoRequest({ idempotencyKey: 'seg-1-key' }), ctx({ outDir: tmpDir('idem') }));
  assert.equal(transport.posts()[0].headers['Idempotency-Key'], 'seg-1-key');
});

test('[fal] a url out of a response body is data, not an instruction', () => {
  assert.equal(assertAllowedHost('https://v3.fal.media/files/x.mp4'), 'https://v3.fal.media/files/x.mp4');
  assert.equal(assertAllowedHost(`${FAL_QUEUE_BASE}/x`), `${FAL_QUEUE_BASE}/x`);
  for (const bad of ['http://queue.fal.run/x', 'https://evil.example.com/x', 'https://falmedia.example/x', 'not a url']) {
    assert.throws(() => assertAllowedHost(bad), (err) => {
      assert.equal(err.code, 'bad_url', bad);
      return true;
    }, `${bad} must not be followed`);
  }
});

test('[fal] the mime type is sniffed, because the staged upload has no extension', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  assert.equal(falMimeType(png, 'upload-photo'), 'image/png');
  assert.equal(falMimeType(jpeg, 'upload-photo'), 'image/jpeg');
  // A client filename is attacker-controlled text; the bytes are not.
  assert.equal(falMimeType(png, 'anything.jpg'), 'image/png');
  assert.throws(() => falMimeType(Buffer.from('GIF89a...'), 'x.gif'), (err) => {
    assert.equal(err.code, 'unsupported_image');
    return true;
  });
});

test('[fal] a data uri is what gets uploaded, and it is capped', () => {
  const file = writeImage(tmpDir('datauri'));
  assert.match(falDataUri(file), /^data:image\/png;base64,/);
  assert.throws(
    () => falDataUri(file, { readImpl: () => Buffer.alloc(40_000_000) }),
    (err) => {
      assert.ok(err instanceof CapabilityError);
      assert.equal(err.code, 'image_too_large');
      return true;
    },
  );
});

test('[fal] file names match the manifest layout in docs/interfaces.md', () => {
  assert.equal(falStillName(1), 'still-01.png');
  assert.equal(falStillName(12), 'still-12.png');
  assert.equal(falClipName({ index: 1 }), 'seg-01.mp4');
  // No index: a hash of the key. Collision-free and stable across a retry,
  // which is the property that matters even though it is not the documented
  // name -- so the pipeline passes an index.
  assert.match(falClipName({ idempotencyKey: 'k' }), /^clip-[0-9a-f]{8}\.mp4$/);
});

test('[fal] the request id is a function of the idempotency key, and fal\'s own id rides along', async () => {
  assert.equal(falRequestId('k'), falRequestId('k'));
  assert.notEqual(falRequestId('k'), falRequestId('k2'));
  const { provider, ctx } = falUnderTest();
  const outDir = tmpDir('ids');
  const req = videoRequest();
  const a = await provider.generateVideo(req, ctx({ outDir }));
  const b = await provider.generateVideo(req, ctx({ outDir }));
  assert.equal(a.meta.requestId, b.meta.requestId, 'ours is stable, which is what a manifest correlates on');
  assert.notEqual(a.meta.falRequestId, b.meta.falRequestId, "fal's is not, because a second submit is a second job");
});

// ---------------------------------------------------------------------------
// the queue: polling, cancelling, giving up
// ---------------------------------------------------------------------------

test('[fal] it polls until COMPLETED and reports the phases in order', async () => {
  const { provider, transport, ctx } = falUnderTest({ transport: makeFalTransport({ pollsBeforeDone: 3 }) });
  const events = [];
  const res = await provider.generateVideo(videoRequest(), ctx({ outDir: tmpDir('poll'), onProgress: (e) => events.push(e) }));

  const statusCalls = transport.requests.filter((r) => r.url.endsWith('/status'));
  assert.equal(statusCalls.length, 4, 'three not-done polls and the one that says COMPLETED');
  assert.ok(events.some((e) => e.phase === 'queued'));
  assert.ok(events.some((e) => e.phase === 'running'));
  assert.equal(events.at(-1).phase, 'done');
  assert.equal(events.at(-1).pct, 100);
  const pcts = events.map((e) => e.pct).filter((p) => p !== undefined);
  for (let i = 1; i < pcts.length; i += 1) {
    assert.ok(pcts[i] >= pcts[i - 1], `progress went backwards: ${pcts[i - 1]} -> ${pcts[i]}`);
  }
  assert.equal(res.clip.seconds, 15);
});

test('[fal] the poll honours cfg.provider.pollIntervalMs through the injected sleep', async () => {
  const waits = [];
  const { provider, ctx } = falUnderTest({ transport: makeFalTransport({ pollsBeforeDone: 2 }) });
  await provider.generateVideo(videoRequest(), ctx({
    outDir: tmpDir('interval'),
    sleepImpl: async (ms) => { waits.push(ms); },
  }));
  assert.deepEqual(waits, [cfg.provider.pollIntervalMs, cfg.provider.pollIntervalMs]);
});

test('[fal] a poll that never resolves is a TimeoutError, and it is retriable', async () => {
  // Retriable, and note what that means: the WORK may still be running on
  // fal's side, which is why the intent record -- not this class -- is what
  // stops a resume from paying twice.
  let clock = 0;
  const { provider, ctx } = falUnderTest({
    transport: makeFalTransport({ pollsBeforeDone: Number.MAX_SAFE_INTEGER }),
    nowImpl: () => { clock += 60_000; return clock; },
  });
  await assert.rejects(
    provider.generateVideo(videoRequest(), ctx({ outDir: tmpDir('timeout') })),
    (err) => {
      assert.ok(err instanceof TimeoutError, `expected TimeoutError, got ${err?.name}`);
      assert.equal(err.code, 'poll_timeout');
      assert.equal(err.retriable, true);
      assert.match(err.message, /pollTimeoutMs/);
      return true;
    },
  );
});

test('[fal] an abort between polls stops the call, terminally', async () => {
  const controller = new AbortController();
  const transport = makeFalTransport({ pollsBeforeDone: Number.MAX_SAFE_INTEGER });
  const { provider, ctx } = falUnderTest({ transport });
  await assert.rejects(
    provider.generateVideo(videoRequest(), ctx({
      outDir: tmpDir('abort'),
      signal: controller.signal,
      // Cancelled while waiting for the next poll, which is where a real cancel
      // lands: a 15-second generation spends minutes in exactly this state.
      sleepImpl: async () => { controller.abort(); },
    })),
    (err) => {
      assert.equal(err.code, 'aborted');
      assert.equal(err.retriable, false, 'a cancelled call must never be retried');
      return true;
    },
  );
});

test('[fal] a failed generation is terminal, not retried', async () => {
  const { provider, transport, ctx } = falUnderTest({
    transport: makeFalTransport({ failures: [{ times: 99, status: 200, fixture: 'status-failed' }] }),
  });
  await assert.rejects(
    provider.generateVideo(videoRequest(), ctx({ outDir: tmpDir('failed') })),
    (err) => {
      assert.ok(err instanceof TerminalError, `expected TerminalError, got ${err?.name}`);
      assert.equal(err.retriable, false);
      return true;
    },
  );
  // The submit, then one status. Not four -- the same request fails the same
  // way and on some plans every attempt is billable.
  assert.equal(transport.requests.filter((r) => r.url.endsWith('/status')).length, 1);
});

// ---------------------------------------------------------------------------
// errors, classified by the shared table
// ---------------------------------------------------------------------------

test('[fal] HTTP failures land on the classes the pipeline branches on', async () => {
  const cases = [
    ['error-401-credential', CredentialError, false],
    ['error-422-validation', TerminalError, false],
    ['error-422-moderation', ModerationRefusedError, false],
  ];
  for (const [fixture, Klass, retriable] of cases) {
    const { provider, ctx } = falUnderTest({
      transport: makeFalTransport({ failures: [{ times: 99, fixture }] }),
    });
    await assert.rejects(
      provider.generateVideo(videoRequest(), ctx({ outDir: tmpDir('http') })),
      (err) => {
        assert.ok(err instanceof Klass, `${fixture}: expected ${Klass.name}, got ${err?.name}`);
        assert.equal(err.retriable, retriable, fixture);
        return true;
      },
    );
  }
});

test('[fal] a 429 climbs the SHARED 1/2/4/8 ladder and then gives up', async () => {
  // The shared one. A second backoff written inside this provider would
  // eventually retry a CredentialError four times and call it resilience.
  const waits = [];
  const { provider, transport, ctx } = falUnderTest({
    transport: makeFalTransport({ failures: [{ times: 99, fixture: 'error-429-rate-limited' }] }),
  });
  await assert.rejects(
    provider.generateVideo(videoRequest(), ctx({
      outDir: tmpDir('429'),
      sleepImpl: async (ms) => { waits.push(ms); },
    })),
    (err) => {
      assert.ok(err instanceof RetriableError);
      assert.equal(err.code, 'rate_limited');
      return true;
    },
  );
  assert.deepEqual(waits, [1000, 2000, 4000], 'three waits for four attempts, at cfg.provider.backoffBaseMs');
  assert.equal(transport.requests.length, cfg.provider.maxAttempts);
});

test('[fal] a 429 that clears is not a failure', async () => {
  const { provider, ctx } = falUnderTest({
    transport: makeFalTransport({ failures: [{ times: 2, fixture: 'error-429-rate-limited' }] }),
  });
  const res = await provider.generateVideo(videoRequest(), ctx({ outDir: tmpDir('429-ok') }));
  assert.equal(res.clip.seconds, 15);
});

// ---------------------------------------------------------------------------
// cost
// ---------------------------------------------------------------------------

test('[fal] a paid provider estimates, and reports actual as null -- NOT METERED YET', async () => {
  const { provider, ctx } = falUnderTest();
  const res = await provider.generateVideo(videoRequest(), ctx({ outDir: tmpDir('cost') }));
  assert.ok(res.cost.estimated > 0, 'a paid provider that estimates $0 is not estimating');
  assert.equal(res.cost.actual, null, 'the queue response carries no price; a metered zero would be a lie');
  assert.equal(res.cost.currency, 'USD');
  // 15s at the conservative per-second estimate in config/pricing.json.
  assert.equal(res.cost.estimated, 4.5405);
});

// ---------------------------------------------------------------------------
// the segment plan, and the resolution rasters
// ---------------------------------------------------------------------------

test('a 15-second-capable provider gets ONE call and no seam', () => {
  const segments = planSegments({ cfg, capabilities: FAL_CAPABILITIES, jobId: '20260820-144501-a3f19c' });
  assert.equal(segments.length, 1, 'seedance takes 4..15 seconds in one request');
  assert.equal(segments[0].seconds, 15);
  assert.equal(segments[0].frames, 375);
  assert.equal(segments[0].startsFrom, 'still', 'nothing to chain from, so nothing is chained');
  assert.equal(segments[0].index, 1);
  assert.ok(Number.isInteger(segments[0].seed));
});

test('the multi-segment path is kept, not deleted, for the next provider', () => {
  // A cap of 8 still splits 15 into 8 + 7, and that code is why a provider
  // that caps lower is a capability number rather than a rewrite.
  const segments = planSegments({ cfg, capabilities: { maxClipSeconds: 8 }, jobId: '20260820-144501-a3f19c' });
  assert.deepEqual(segments.map((s) => s.seconds), [8, 7]);
  assert.deepEqual(segments.map((s) => s.startsFrom), ['still', 'lastFrame']);
});

test('every segment carries the raster it is bought at', () => {
  const size = { width: 960, height: 720 };
  const segments = planSegments({ cfg, capabilities: { maxClipSeconds: 4 }, jobId: '20260820-144501-a3f19c', size });
  for (const seg of segments) assert.deepEqual(seg.size, size);
  // Null without one: `--dry-run` has no job and therefore no order behind it.
  assert.equal(planSegments({ cfg, capabilities: FAL_CAPABILITIES })[0].size, null);
});

test('a resolution label means its 4:3 raster, everywhere it is written down', () => {
  // Three files derive these numbers -- animate/plan.mjs from the label,
  // providers/fal.mjs for its own enum, config/credits.json for the price --
  // and this is the assertion that stops them drifting apart.
  assert.deepEqual(resolutionRaster('480p'), { id: '480p', width: 640, height: 480 });
  assert.deepEqual(resolutionRaster('720p'), { id: '720p', width: 960, height: 720 });
  for (const id of AVAILABLE_RESOLUTIONS) {
    const raster = resolutionRaster(id);
    assert.deepEqual(
      { width: FAL_RESOLUTIONS[id].width, height: FAL_RESOLUTIONS[id].height },
      { width: raster.width, height: raster.height },
      `${id}: plan.mjs and fal.mjs disagree about what the label means`,
    );
    assert.equal(raster.width * 3, raster.height * 4, `${id} is not 4:3`);
  }
  const credits = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'credits.json'), 'utf8'));
  for (const id of Object.keys(RESOLUTIONS)) {
    assert.deepEqual(
      credits.resolutions[id].raster,
      { width: RESOLUTIONS[id].width, height: RESOLUTIONS[id].height },
      `${id}: config/credits.json records a different raster from the one the renderer requests`,
    );
    // The web form offers what credits.mjs says is available and the pipeline
    // renders what plan.mjs says is available. If those two ever disagree, a
    // customer is charged for a size the renderer refuses -- or, worse, offered
    // one nobody priced.
    assert.equal(
      RESOLUTIONS[id].available,
      credits.resolutions[id].available === true,
      `${id}: the renderer and the price list disagree about whether it can be ordered`,
    );
  }
  assert.deepEqual(Object.keys(RESOLUTIONS), Object.keys(credits.resolutions));
  assert.equal(DEFAULT_RESOLUTION, credits.defaults.resolution);
});

test('a resolution label holds the SHORT edge, so a shape changes the long one', () => {
  // THE RULE IS SECTION 13'S, APPLIED ONE LAYER DOWN. The tape rasters already
  // hold their short edge at 576 and vary only the long edge, which is what
  // keeps ONE set of filtergraph constants correct in all three shapes -- a
  // 14px head-switch band is 14px of a 576-high picture whichever shape it is
  // in. The SOURCE raster ordered from the provider now follows the same rule,
  // so "480p" means "the short edge is 480" rather than "640x480".
  //
  // Called with no aspect it still means 4:3, because every existing caller
  // and the whole of config/credits.json depend on that.
  assert.deepEqual(resolutionRaster('480p'), { id: '480p', width: 640, height: 480 });

  const EXPECTED = {
    '480p': { '4:3': [640, 480], '16:9': [854, 480], '9:16': [480, 854] },
    '720p': { '4:3': [960, 720], '16:9': [1280, 720], '9:16': [720, 1280] },
  };
  for (const [id, shapes] of Object.entries(EXPECTED)) {
    for (const [aspect, [width, height]] of Object.entries(shapes)) {
      assert.deepEqual(resolutionRaster(id, aspect), { id, width, height },
        `${id} at ${aspect}`);
      // yuv420p subsamples chroma by two; an odd edge is a filtergraph error
      // at the far end of a paid render.
      assert.equal(width % 2, 0, `${id} ${aspect} width is odd`);
      assert.equal(height % 2, 0, `${id} ${aspect} height is odd`);
      assert.equal(Math.min(width, height), Math.min(...EXPECTED[id]['4:3']),
        `${id} ${aspect} does not hold the short edge`);
    }
  }

  // AN UNKNOWN SHAPE IS REFUSED, NEVER DEFAULTED. This assertion was missing
  // on the first pass and a deliberate sabotage -- making a malformed aspect
  // fall back to 4:3 -- went completely undetected, which is the failure this
  // whole area exists to prevent: a render that quietly delivers a different
  // thing from the one ordered, with the button, the ledger and the manifest
  // all agreeing on the wrong answer.
  // `undefined` is NOT in this list and must not be: a default parameter cannot
  // tell "not passed" from "passed undefined", and a bare call has to keep
  // meaning 4:3 for every existing caller. `null` is in the list, because that
  // is somebody passing a value they failed to compute.
  for (const bad of ['16x9', 'square', '', null, '0:1', '4:0', '16:9:1']) {
    assert.throws(() => resolutionRaster('480p', bad), (err) => {
      assert.equal(err.code, 'UNKNOWN_ASPECT', `${JSON.stringify(bad)} was not refused as an aspect`);
      return true;
    }, `${JSON.stringify(bad)} should not be renderable`);
  }
});

test('a wide or tall shape is exactly 4/3 the pixels of a 4:3 one', () => {
  // THE NUMBER THE PRICING DECISION RESTS ON, PINNED SO IT CANNOT DRIFT.
  //
  // 4:3 is the squarest shape this product ships, so holding the short edge
  // makes every other shape exactly 4/3 the pixels. fal bills tokens as
  // pixels x seconds -- config/credits.json carries the formula and it
  // reproduces the invoice to seven figures -- so 4/3 the pixels is 4/3 the
  // cost, at every tier, for both non-default shapes.
  //
  // This is the arithmetic the price rests on. What charges for it lives in
  // `creditCost`, and `auth-credits.test.js` holds it to this same number.
  for (const id of AVAILABLE_RESOLUTIONS) {
    const base = resolutionRaster(id, '4:3');
    const basePx = base.width * base.height;
    for (const aspect of ['16:9', '9:16']) {
      const r = resolutionRaster(id, aspect);
      const ratio = (r.width * r.height) / basePx;
      assert.ok(Math.abs(ratio - 4 / 3) < 0.005,
        `${id} ${aspect} is ${ratio.toFixed(3)}x the pixels of 4:3, not 4/3`);
    }
  }
});

test('the endpoints named in fal.mjs are the ones recorded as VERIFIED in config/models.json', () => {
  // fal.mjs's header documents FAL_ENDPOINTS as mirroring the config. Two
  // copies of a route id is exactly the drift that produces an afternoon of
  // debugging a 404, so the mirror is asserted rather than trusted.
  const models = loadModels();
  for (const endpoint of Object.values(FAL_ENDPOINTS)) {
    const entry = models.models[endpoint];
    assert.ok(entry, `${endpoint} is named in fal.mjs but not in config/models.json`);
    assert.equal(entry.endpoint, endpoint);
    assert.equal(entry.verified, true, `${endpoint} must be verified before it is named as a default route`);
    assert.equal(entry.audioOffParam.name, 'generate_audio');
  }
  assert.equal(loadModels().defaults.fal.video, FAL_ENDPOINTS.imageToVideo);
});

test('1080p is deferred and refuses rather than quietly rendering something else', () => {
  assert.throws(() => resolutionRaster('1080p'), (err) => {
    assert.equal(err.code, 'RESOLUTION_UNAVAILABLE');
    return true;
  });
  assert.throws(() => resolutionRaster('4k'), (err) => {
    assert.equal(err.code, 'UNKNOWN_RESOLUTION');
    return true;
  });
});

// ---------------------------------------------------------------------------
// THE FIX: the resolution reaches the provider
// ---------------------------------------------------------------------------

/** A fake with fal's capabilities: the two 4:3 rasters and a 15-second cap. */
function falShapedProvider({ paid = false, stillSizes = [...FAL_CAPABILITIES.stillSizes] } = {}) {
  const pair = makeProvider();
  pair.provider.paid = paid;
  pair.provider.capabilities = {
    maxClipSeconds: 15,
    stillSizes,
    maxReferences: 2,
    supportsNativeAudioOff: true,
    supportsPlaceReference: true,
  };
  return pair;
}

function jobAt(root, resolution) {
  return createJob({
    root,
    provider: 'fake',
    input: {
      photo: { path: 'input/photo.jpg' },
      place: { kind: 'preset', value: 'schrebergarten-august' },
      outfit: { kind: 'preset', value: 'trainingsjacke' },
      stillCount: 3,
      resolution,
      consent: CONSENT,
    },
  });
}

test('a job ordered at 720p asks the provider for 960x720', async () => {
  // THE ASSERTION THAT IS THE FIX. `job.input.resolution` reached the manifest
  // and nothing read it again, so a customer who paid 152 credits for 720p got
  // whatever `stillSizes[0]` happened to be -- with the button, the ledger and
  // the manifest all agreeing on a number that was not what arrived.
  const root = tmpRoot();
  const photo = writeUpload(root);
  const pair = falShapedProvider();
  const { job, calls } = await runFake({ root, photo, job: jobAt(root, '720p'), providerPair: pair });

  assert.deepEqual(calls.stillRequests[0].size, { width: 960, height: 720 });
  assert.deepEqual(calls.videoRequests[0].size, { width: 960, height: 720 });
  assert.deepEqual(job.resolved.resolution, { id: '720p', size: { width: 960, height: 720 }, honoured: true });
  assert.equal(job.status, 'done');
});

test('a job ordered at 480p asks for 640x480, and it is one 15-second call', async () => {
  const root = tmpRoot();
  const photo = writeUpload(root);
  const { job, calls } = await runFake({ root, photo, job: jobAt(root, '480p'), providerPair: falShapedProvider() });

  assert.deepEqual(calls.stillRequests[0].size, { width: 640, height: 480 });
  assert.equal(calls.video, 1, 'a 15-second cap is one generation, not two');
  assert.equal(calls.videoRequests[0].seconds, 15);
  assert.equal(calls.videoRequests[0].nativeAudio, false);
  assert.deepEqual(job.resolved.segments.map((s) => s.size), [{ width: 640, height: 480 }]);
});

test('the frozen raster survives a resume, and a re-planned segment cannot change it', async () => {
  const root = tmpRoot();
  const photo = writeUpload(root);
  const { job } = await runFake({ root, photo, job: jobAt(root, '720p'), providerPair: falShapedProvider(), stopAfter: 'compose' });
  // `resolved` is deep-frozen by job.mjs, which turns "please do not re-derive
  // this" from a comment into a TypeError at the assignment.
  assert.throws(() => { job.resolved.resolution.size.width = 1; }, TypeError);
});

test('a job with no resolution -- a CLI render -- takes the provider\'s first offer', async () => {
  const root = tmpRoot();
  const photo = writeUpload(root);
  const { job, calls } = await runFake({ root, photo, job: jobAt(root, undefined), providerPair: falShapedProvider() });
  assert.deepEqual(calls.stillRequests[0].size, { width: 640, height: 480 });
  assert.deepEqual(job.resolved.resolution, { id: null, size: { width: 640, height: 480 }, honoured: true });
});

test('a PAID provider that cannot render the ordered raster is refused, not substituted', async () => {
  // Billing for 720p and delivering 1024x768 is the original bug with an extra
  // step. A free provider may substitute -- there is no invoice behind local
  // ffmpeg to be wrong about -- and this asserts both halves.
  const root = tmpRoot();
  const photo = writeUpload(root);
  await assert.rejects(
    runFake({
      root,
      photo,
      job: jobAt(root, '720p'),
      providerPair: falShapedProvider({ paid: true, stillSizes: [{ width: 1024, height: 768 }] }),
    }),
    (err) => {
      assert.equal(err.code, 'RESOLUTION_UNAVAILABLE');
      assert.equal(err.step, 'compose');
      assert.match(err.message, /1024x768/);
      return true;
    },
  );

  const root2 = tmpRoot();
  const { job, calls } = await runFake({
    root: root2,
    photo: writeUpload(root2),
    job: jobAt(root2, '720p'),
    providerPair: falShapedProvider({ paid: false, stillSizes: [{ width: 1024, height: 768 }] }),
  });
  assert.deepEqual(calls.stillRequests[0].size, { width: 1024, height: 768 });
  assert.equal(job.resolved.resolution.honoured, false, 'and the manifest says the order was not honoured');
});

// ---------------------------------------------------------------------------
// end to end against the fake queue, with real pixels
// ---------------------------------------------------------------------------

async function haveFfmpeg() {
  try { await runFfmpeg(['-hide_banner', '-version']); return true; } catch { return false; }
}
const HAVE = await haveFfmpeg();
const skip = HAVE ? false : `ffmpeg not found (${findFfmpeg().ffmpeg}) -- fal pixel test skipped`;

test('[fal] a 720p request downloads a 960x720 clip from the url the queue named', { skip }, async () => {
  const kase = falContractCase();
  const provider = kase.create();
  const outDir = tmpDir('e2e');
  const res = await provider.generateVideo(
    videoRequest({ size: FAL_RESOLUTIONS['720p'], seconds: 2 }),
    kase.makeCtx({ outDir }),
  );
  assert.equal(kase.transport.posts()[0].body.resolution, '720p');
  assert.equal(res.clip.path, path.join(outDir, 'seg-01.mp4'));
  assert.ok(fs.statSync(res.clip.path).size > 1000);
  assert.equal(res.meta.resolution, '720p');
});

// ---------------------------------------------------------------------------
// reference-to-video: the path with no still in it
//
// Paul's product direction, restated three times and finally built: upload a
// photo, pick an outfit, a place and a frame shape, get a tape. No generated
// still, nothing to choose from, no picture the user ever meets.
//
// `bytedance/seedance-2.0/reference-to-video` was VERIFIED on 2026-08-20 and
// never wired in, because `animate` started from the approved still. It takes
// up to 9 reference images as `image_urls` and refers to them from the prompt
// as @Image1, @Image2 -- so the face photo goes in directly and the still stage
// stops existing rather than being hidden.
// ---------------------------------------------------------------------------

test('[fal] the reference video body carries the photos, not a start frame', () => {
  const body = falReferenceVideoBody({
    prompt: 'p', references: [{ role: 'face', path: 'face.jpg' }],
    seconds: 15, seed: 7, size: FAL_RESOLUTIONS['480p'], nativeAudio: false,
    dataUriImpl: (f) => `data:image/jpeg;base64,${f}`,
  });

  assert.deepEqual(body.image_urls, ['data:image/jpeg;base64,face.jpg']);
  // SENDING BOTH WOULD BE AMBIGUOUS. `image_url` is image-to-video's start
  // frame; this endpoint has no start frame at all, and a body carrying both
  // invites the model to pick one.
  assert.ok(!Object.hasOwn(body, 'image_url'), 'no singular start frame on this endpoint');
});

test('[fal] a second reference is the place, and it rides in the same array', () => {
  // The strongest version of this product -- "your actual childhood garden" --
  // and the reason the endpoint was recorded in the first place.
  const body = falReferenceVideoBody({
    prompt: 'p',
    references: [{ role: 'face', path: 'f.jpg' }, { role: 'place', path: 'p.jpg' }],
    seconds: 15, seed: 7, size: FAL_RESOLUTIONS['480p'], nativeAudio: false,
    dataUriImpl: (f) => `data:x;base64,${f}`,
  });
  assert.deepEqual(body.image_urls, ['data:x;base64,f.jpg', 'data:x;base64,p.jpg'],
    'order is the @Image1/@Image2 contract the prompt refers to');
});

test('[fal] the reference field name is per-model, exactly as it is for stills', () => {
  // BUG 3, 2026-08-23: `fal-ai/uso` answered 422 because the field was called
  // `input_image_urls`. Three vendors, no reason to assume they agree, and a
  // 422 costs a round trip to discover. The name lives in config/models.json.
  const body = falReferenceVideoBody({
    prompt: 'p', references: [{ role: 'face', path: 'f.jpg' }],
    seconds: 15, seed: 7, size: FAL_RESOLUTIONS['480p'], nativeAudio: false,
    referencesParam: 'input_image_urls',
    dataUriImpl: () => 'data:x;base64,AA==',
  });
  assert.deepEqual(body.input_image_urls, ['data:x;base64,AA==']);
  assert.ok(!Object.hasOwn(body, 'image_urls'), 'one field, never both');
});

test('[fal] the reference video body keeps every guard the image path already had', () => {
  const body = falReferenceVideoBody({
    prompt: 'p', references: [{ role: 'face', path: 'f.jpg' }],
    seconds: 15, seed: 7, size: FAL_RESOLUTIONS['720p'], nativeAudio: false,
    dataUriImpl: () => 'data:x;base64,AA==',
  });
  // Layer 1 on the wire. `generate_audio` DEFAULTS TO TRUE on this endpoint too
  // -- the config's own note says "the same parameter with the same TRUE
  // default" -- so omitting it ships the model's ambience under our bed.
  assert.equal(body.generate_audio, false);
  assert.ok(Object.hasOwn(body, 'generate_audio'), 'omitted is not the same as false');
  assert.equal(body.duration, '15', 'a STRING enum, not a number');
  assert.equal(typeof body.duration, 'string');
  assert.equal(body.resolution, '720p');
  assert.equal(body.seed, 7);
});

test('[fal] a reference video request with no references is refused before it is sent', () => {
  // The face IS the product. A body with an empty array is a paid call that
  // cannot possibly return the right person, and it would look like a model
  // failure rather than a caller bug.
  assert.throws(
    () => falReferenceVideoBody({
      prompt: 'p', references: [], seconds: 15, seed: 1,
      size: FAL_RESOLUTIONS['480p'], nativeAudio: false,
    }),
    /at least one reference/i);
});
