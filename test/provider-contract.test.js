/**
 * THE conformance test. One body, run against every provider.
 *
 * This file is the reason the provider layer is an abstraction and not a
 * wrapper with optimism. `fixture.mjs` spawns local ffmpeg; `fal.mjs` will
 * make paid HTTP calls. They share no code paths worth the name. The only
 * thing that can honestly justify the pipeline calling `provider.generateStill`
 * without knowing which one it holds is that the identical assertions pass
 * against both -- identical result shapes, identical error classes, identical
 * progress phases, identical cost block.
 *
 * SO THE BODY IS PARAMETERISED AND MUST STAY THAT WAY. `runProviderContract`
 * takes a list of cases, and fal landing WAS one entry in that array plus the
 * import above it. The body below was not edited, which is the evidence the
 * whole arrangement exists to produce: if a second provider had required a
 * change here, the change would have been the bug report -- it would mean the
 * two do not actually present the same interface and the pipeline has been
 * branching on provider id somewhere without saying so.
 *
 * THE fal CASE HERE SPENDS NOTHING. Its transport is a fake queue built from
 * the recorded shapes in `test/fixtures/fal/`, its key is injected, and the
 * media it serves is rendered locally by ffmpeg at the size and duration the
 * recorded request asked for -- so the pixel assertions below have something
 * true to assert. `test/fal-smoke.test.js` is the live counterpart and it
 * self-skips unless `TIMESTAMP_LIVE=1`; its header records why it does NOT run
 * this body against the real endpoint (the body builds every video case as
 * `Math.min(2, maxClipSeconds)` seconds and seedance's duration enum starts at
 * 4, so a live run would spend a submit to be told 422 by a documented
 * boundary).
 *
 * A NOTE ON IMPORTING THIS FILE. Importing it registers the fixture cases in
 * the importing file's process as well, so they run twice across a live suite.
 * That is deliberate. The alternative -- guarding self-registration on "am I
 * the entry point" -- fails silently in the wrong direction: if the guard
 * misfires under a future test-runner flag, this file registers ZERO tests and
 * `node --test` reports a green run for the most important file in the
 * package. Running the free tests twice is the cheap mistake.
 *
 * WHY THE PIXEL ASSERTIONS SKIP RATHER THAN FAIL WITHOUT ffmpeg. "You do not
 * have ffmpeg" and "the provider is broken" are different problems and must
 * not produce the same red line. The shape assertions above them need no
 * ffmpeg and never skip.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { runFfmpeg, findFfmpeg, probe, REPO_ROOT } from '../scripts/ffmpeg/run.mjs';
import {
  PROGRESS_PHASES,
  FIRST_INDEX,
  CURRENCY,
  assertProvider,
  assertStillResult,
  assertVideoResult,
  assertVideoRequest,
  assertProgressEvent,
  requireFetchImpl,
} from '../scripts/providers/contract.mjs';
import {
  ProviderError,
  TerminalError,
  CapabilityError,
} from '../scripts/providers/errors.mjs';
import { createProvider, loadModels, modelEntry, PROVIDER_IDS } from '../scripts/providers/index.mjs';
// The fal case, transport fake and all, lives with the rest of fal's tests.
// Importing it here is the ONLY change this file needed to cover a second
// provider -- one import and one array entry, and the shared body below
// untouched. If that ever stops being true, the edit is the bug report.
import { falContractCase } from './provider-fal.test.js';
import { loadPricing, assertPricingTable, estimateStill, estimateVideo, estimateJob, divergence, diverges } from '../scripts/providers/pricing.mjs';

const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'render.json'), 'utf8'));

async function haveFfmpeg() {
  try {
    await runFfmpeg(['-hide_banner', '-version']);
    return true;
  } catch {
    return false;
  }
}
const HAVE = await haveFfmpeg();
const skip = HAVE ? false : `ffmpeg not found (${findFfmpeg().ffmpeg}) -- provider pixel tests skipped`;

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

/** Artifacts land under build/, which is gitignored, and they are deliberately
 *  NOT deleted afterwards: when a still looks wrong the first thing anyone
 *  wants is to open it. */
function workdir(...parts) {
  const dir = path.join(REPO_ROOT, 'build', 'provider-contract', ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function isPng(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, 0);
    return head.equals(PNG_MAGIC);
  } finally {
    fs.closeSync(fd);
  }
}

/** A stand-in for the uploaded photo. Every provider needs one on disk, and
 *  none of them may look at what is in it. */
async function makeReferenceImage(dir) {
  const file = path.join(dir, 'face.png');
  if (fs.existsSync(file)) return file;
  await runFfmpeg([
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x6E5A44:s=512x384:r=1:d=1,drawbox=x=180:y=90:w=150:h=200:c=0xD8C3A5@1:t=fill,format=rgb24',
    '-frames:v', '1', '-update', '1', file,
  ]);
  return file;
}

/** Both providers get the identical request. Everything that varies between
 *  them lives in `makeCtx`, which is the whole design: the REQUEST is the
 *  contract, the CONTEXT is the plumbing. */
function stillRequestFor(provider, { refPath, count = 3, seed = 4242, key = 'contract-still-1' }) {
  return {
    prompt: 'the person in the reference image, standing by a garden fence, low late-afternoon sun',
    negativePrompt: 'text, watermark, extra people, warped hands',
    references: [{ role: 'face', path: refPath }],
    seed,
    count,
    size: provider.capabilities.stillSizes[0],
    idempotencyKey: key,
  };
}

function videoRequestFor(provider, { imagePath, seconds, seed = 777, index = FIRST_INDEX, key = 'contract-video-1' }) {
  return {
    prompt: 'a slow handheld drift, the person stays where they are',
    negativePrompt: 'cuts, zooms, camera shake',
    imagePath,
    seed,
    seconds: seconds ?? Math.min(2, provider.capabilities.maxClipSeconds),
    // Layer 1 of the three-layer rule, stated at every call site on purpose.
    nativeAudio: false,
    index,
    idempotencyKey: key,
  };
}

/**
 * Replace the global fetch with something that throws a NON-TypeError for the
 * duration of `fn`.
 *
 * This is what makes the no-default assertion safe to run against a paid
 * provider. If the provider correctly has no default, it throws a `TypeError`
 * and the assertion passes. If it quietly fell back to `globalThis.fetch`, it
 * gets this Error instead -- which fails the `TypeError` assertion loudly and,
 * more to the point, never reaches the network. The test cannot spend money
 * even while proving that it cannot spend money.
 */
async function withNetworkPoisoned(fn) {
  const real = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('TEST GUARD: a provider reached for globalThis.fetch. npm test must not be able to spend money.');
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

/** Frames per second as a number, from ffprobe's "25/1". */
function fpsOf(stream) {
  const [n, d] = String(stream.r_frame_rate ?? '0/1').split('/').map(Number);
  return d ? n / d : 0;
}

// ---------------------------------------------------------------------------
// The shared body
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ProviderCase
 * @property {string} name
 * @property {() => object} create        build the provider under test
 * @property {(base:object) => object} makeCtx   add transport/plumbing to a ctx
 * @property {boolean} [expectFree]       assert cost.estimated === 0
 */

/**
 * Register the conformance suite for every case given.
 *
 * Exported so a future `test/fal-smoke.test.js` can call it with a fal case
 * and a real `fetchImpl` WITHOUT this body being edited. That constraint is
 * the point of the file; see the header.
 *
 * @param {ProviderCase[]} cases
 */
export function runProviderContract(cases) {
  for (const c of cases) {
    const label = (what) => `[${c.name}] ${what}`;

    // One generation per case, shared by the assertions below. Generating per
    // test would triple the ffmpeg time for no extra coverage.
    let onceStill = null;
    async function stills() {
      if (onceStill) return onceStill;
      const provider = c.create();
      const refDir = workdir(c.name, 'input');
      const outDir = workdir(c.name, 'stills');
      const refPath = await makeReferenceImage(refDir);
      const req = stillRequestFor(provider, { refPath });
      const events = [];
      const ctx = c.makeCtx({ outDir, onProgress: (e) => events.push(e) });
      const res = await provider.generateStill(req, ctx);
      onceStill = { provider, req, res, events, outDir, refPath };
      return onceStill;
    }

    let onceVideo = null;
    async function video() {
      if (onceVideo) return onceVideo;
      const { provider, res: stillRes } = await stills();
      const outDir = workdir(c.name, 'segments');
      const req = videoRequestFor(provider, { imagePath: stillRes.stills[0].path });
      const events = [];
      const ctx = c.makeCtx({ outDir, onProgress: (e) => events.push(e) });
      const res = await provider.generateVideo(req, ctx);
      onceVideo = { provider, req, res, events, outDir };
      return onceVideo;
    }

    // -- shape, no ffmpeg needed ------------------------------------------

    test(label('the provider object has the contracted shape'), () => {
      const p = c.create();
      assertProvider(p);
      assert.equal(p.id, c.name);
      assert.equal(typeof p.paid, 'boolean');
      // Layer 2 of the three-layer native-audio rule. `true` and not merely a
      // boolean: a model that cannot be told to stop generating its own audio
      // is disqualified under docs/phase-0-validation.md criterion 4.
      assert.equal(p.capabilities.supportsNativeAudioOff, true);
    });

    test(label('a paid provider has NO DEFAULT for ctx.fetchImpl'), async () => {
      const p = c.create();
      if (!p.paid) {
        // A free provider legitimately never fetches. The guard still has to
        // exist and still has to throw a TypeError, so assert it directly --
        // that is the function fal.mjs will call on its first line.
        assert.throws(() => requireFetchImpl({ outDir: workdir(c.name, 'stills') }, { provider: p.id }), TypeError);
        assert.equal(requireFetchImpl({ fetchImpl: globalThis.fetch }, { provider: p.id }), globalThis.fetch);
        return;
      }
      // Paid: prove that a ctx with no transport cannot reach the network. The
      // global fetch is poisoned with a non-TypeError for the duration, so a
      // provider that quietly defaulted fails this assertion instead of
      // billing someone.
      const refPath = path.join(workdir(c.name, 'input'), 'face.png');
      const req = stillRequestFor(p, { refPath });
      await withNetworkPoisoned(async () => {
        await assert.rejects(
          p.generateStill(req, { outDir: workdir(c.name, 'stills') }),
          TypeError,
          'a paid provider must throw a TypeError, not make a request, when fetchImpl is missing',
        );
      });
    });

    test(label('nativeAudio is required and required to be false'), async () => {
      const p = c.create();
      const req = videoRequestFor(p, { imagePath: path.join(REPO_ROOT, 'build', 'nonexistent.png') });
      const outDir = workdir(c.name, 'segments');

      for (const [what, mutate] of [
        ['missing', (r) => { delete r.nativeAudio; }],
        ['true', (r) => { r.nativeAudio = true; }],
        ['truthy string', (r) => { r.nativeAudio = 'false'; }],
        ['undefined', (r) => { r.nativeAudio = undefined; }],
      ]) {
        const broken = { ...req };
        mutate(broken);
        await assert.rejects(
          p.generateVideo(broken, c.makeCtx({ outDir })),
          (err) => {
            assert.ok(err instanceof TerminalError, `${what}: expected TerminalError, got ${err?.name}`);
            assert.equal(err.code, 'native_audio', what);
            assert.equal(err.retriable, false);
            return true;
          },
          `nativeAudio ${what} must be refused`,
        );
      }
    });

    test(label('asking beyond capabilities raises CapabilityError'), async () => {
      const p = c.create();
      const outDir = workdir(c.name, 'segments');
      const refPath = path.join(workdir(c.name, 'input'), 'face.png');

      await assert.rejects(
        p.generateVideo(videoRequestFor(p, {
          imagePath: path.join(REPO_ROOT, 'build', 'nonexistent.png'),
          seconds: p.capabilities.maxClipSeconds + 1,
        }), c.makeCtx({ outDir })),
        (err) => {
          assert.ok(err instanceof CapabilityError, `expected CapabilityError, got ${err?.name}`);
          assert.equal(err.code, 'clip_too_long');
          assert.equal(err.retriable, false);
          return true;
        },
      );

      const wrongSize = stillRequestFor(p, { refPath });
      // Still 4:3, so it clears the request shape check and lands on the
      // capability gate rather than on a validation error -- which is the
      // distinction being tested.
      wrongSize.size = { width: 400, height: 300 };
      await assert.rejects(
        p.generateStill(wrongSize, c.makeCtx({ outDir: workdir(c.name, 'stills') })),
        (err) => {
          assert.ok(err instanceof CapabilityError, `expected CapabilityError, got ${err?.name}`);
          assert.equal(err.code, 'unsupported_size');
          return true;
        },
      );
    });

    test(label('a malformed request is a TerminalError, never a bare throw'), async () => {
      const p = c.create();
      const outDir = workdir(c.name, 'stills');
      const refPath = path.join(workdir(c.name, 'input'), 'face.png');
      const base = stillRequestFor(p, { refPath });

      const broken = [
        ['no face reference', { ...base, references: [{ role: 'place', path: refPath }] }],
        ['two faces', { ...base, references: [{ role: 'face', path: refPath }, { role: 'face', path: refPath }] }],
        ['relative reference path', { ...base, references: [{ role: 'face', path: 'input/photo.jpg' }] }],
        ['count 0', { ...base, count: 0 }],
        ['count 9', { ...base, count: 9 }],
        ['negative seed', { ...base, seed: -1 }],
        ['float seed', { ...base, seed: 1.5 }],
        ['16:9 size', { ...base, size: { width: 1024, height: 576 } }],
        ['no idempotency key', { ...base, idempotencyKey: '' }],
      ];
      for (const [what, req] of broken) {
        await assert.rejects(
          p.generateStill(req, c.makeCtx({ outDir })),
          (err) => {
            assert.ok(err instanceof ProviderError, `${what}: expected a ProviderError, got ${err?.name}: ${err?.message}`);
            assert.equal(err.retriable, false, what);
            return true;
          },
          `${what} must be refused`,
        );
      }
    });

    test(label('a reference image that is not on disk fails before any work'), async () => {
      const p = c.create();
      const req = stillRequestFor(p, { refPath: path.join(REPO_ROOT, 'build', 'definitely-not-here.png') });
      await assert.rejects(
        p.generateStill(req, c.makeCtx({ outDir: workdir(c.name, 'stills') })),
        (err) => {
          assert.ok(err instanceof TerminalError, `expected TerminalError, got ${err?.name}`);
          assert.equal(err.code, 'missing_reference');
          return true;
        },
      );
    });

    test(label('an aborted signal stops the call, terminally'), async () => {
      const p = c.create();
      const refPath = await (HAVE ? makeReferenceImage(workdir(c.name, 'input')) : Promise.resolve(path.join(workdir(c.name, 'input'), 'face.png')));
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        p.generateStill(stillRequestFor(p, { refPath }), c.makeCtx({ outDir: workdir(c.name, 'stills'), signal: controller.signal })),
        (err) => {
          // A cancel is a decision, not a fault. Retrying it would restart work
          // the user just asked to stop.
          assert.equal(err.retriable, false, 'a cancelled call must never be retried');
          return true;
        },
      );
    });

    // -- generation, needs ffmpeg -----------------------------------------

    test(label('generateStill returns a conforming StillResult'), { skip }, async () => {
      const { req, res } = await stills();
      assertStillResult(res);
      assert.equal(res.stills.length, req.count);
      assert.deepEqual(res.stills.map((s) => s.index), [1, 2, 3], 'stills are 1-based and contiguous');
      assert.equal(res.cost.currency, CURRENCY);
      assert.ok(Number.isFinite(res.cost.estimated) && res.cost.estimated >= 0);
      assert.ok(res.cost.actual === null || res.cost.actual >= 0);
      assert.ok(res.meta.model.length > 0);
      assert.ok(res.meta.requestId.length > 0);
      assert.ok(res.meta.latencyMs >= 0);
    });

    test(label('a free provider costs exactly zero'), { skip }, async () => {
      const { provider, res } = await stills();
      if (provider.paid) {
        assert.ok(res.cost.estimated > 0, 'a paid provider that estimates $0 is not estimating');
        return;
      }
      assert.equal(res.cost.estimated, 0);
      assert.equal(res.cost.actual, 0, 'a free provider knows what it cost -- 0 metered, not null');
    });

    test(label('every still is a real image at the requested size'), { skip }, async () => {
      const { req, res } = await stills();
      for (const still of res.stills) {
        assert.ok(fs.existsSync(still.path), `${still.path} does not exist`);
        assert.ok(fs.statSync(still.path).size > 1000, `${still.path} is suspiciously small`);
        assert.ok(isPng(still.path), `${still.path} is not a PNG`);
        const info = await probe(still.path);
        const v = (info.streams ?? []).find((s) => s.codec_type === 'video');
        assert.equal(v.width, req.size.width, `${still.path} width`);
        assert.equal(v.height, req.size.height, `${still.path} height`);
      }
    });

    test(label('the stills are visually distinguishable from one another'), { skip }, async () => {
      // Not pedantry. `select` shows a human a contact sheet and asks them to
      // pick. N identical images render, click and pass every other assertion
      // in this file while showing the same picture three times.
      const { res } = await stills();
      const hashes = res.stills.map((s) => sha256(s.path));
      assert.equal(new Set(hashes).size, hashes.length, 'two stills are byte-identical');
      const seeds = res.stills.map((s) => s.seed);
      assert.equal(new Set(seeds).size, seeds.length, 'two stills share a seed');
    });

    test(label('progress is reported through the contracted phases'), { skip }, async () => {
      const { events } = await stills();
      assert.ok(events.length > 0, 'no progress reported -- the status page would sit at 0%');
      for (const e of events) assertProgressEvent(e);
      for (const e of events) assert.ok(PROGRESS_PHASES.includes(e.phase), `unknown phase ${e.phase}`);
      const pcts = events.map((e) => e.pct).filter((p) => p !== undefined);
      for (let i = 1; i < pcts.length; i += 1) {
        assert.ok(pcts[i] >= pcts[i - 1], `progress went backwards: ${pcts[i - 1]} -> ${pcts[i]}`);
      }
      assert.equal(events.at(-1).phase, 'done');
      assert.equal(events.at(-1).pct, 100);
    });

    test(label('generateVideo returns a conforming VideoResult'), { skip }, async () => {
      const { req, res } = await video();
      assertVideoResult(res);
      assert.ok(fs.existsSync(res.clip.path), `${res.clip.path} does not exist`);
      assert.ok(fs.statSync(res.clip.path).size > 1000);
      assert.ok(Math.abs(res.clip.seconds - req.seconds) < 0.5, `asked for ${req.seconds}s, got ${res.clip.seconds}s`);
      assert.equal(res.cost.currency, CURRENCY);
      assert.ok(res.meta.latencyMs >= 0);
    });

    test(label('the returned clip has ZERO audio streams'), { skip }, async () => {
      // Layer 3 of the three-layer rule lives in the pipeline, on the file it
      // downloads. This is the same check applied to the provider's own
      // output, because a provider that returns audio has already broken the
      // contract and should not get as far as `assemble` to find out.
      const { res } = await video();
      const info = await probe(res.clip.path, { countFrames: true });
      const streams = info.streams ?? [];
      const audio = streams.filter((s) => s.codec_type === 'audio');
      assert.equal(audio.length, 0, `expected no audio streams, found ${audio.length}: ${JSON.stringify(audio)}`);

      const v = streams.find((s) => s.codec_type === 'video');
      assert.ok(v, 'no video stream');
      const fps = fpsOf(v);
      assert.ok(fps > 0, `unreadable frame rate ${v.r_frame_rate}`);
      const seconds = Number(v.nb_read_frames) / fps;
      assert.ok(Math.abs(seconds - res.clip.seconds) < 0.1,
        `the file is ${seconds}s (${v.nb_read_frames} frames at ${fps}fps) but the result claims ${res.clip.seconds}s`);
    });

    test(label('the same request twice lands on the same paths'), { skip }, async () => {
      // Idempotency at the filesystem level: a resumed job re-running a step
      // must overwrite its own output rather than accumulate a second copy
      // beside it, or `still-01.png` and `still-01 (1).png` both end up in a
      // contact sheet and nobody knows which was chosen.
      const { provider, req, res, outDir } = await stills();
      const again = await provider.generateStill(req, c.makeCtx({ outDir }));
      assert.deepEqual(again.stills.map((s) => s.path), res.stills.map((s) => s.path));
      assert.deepEqual(again.stills.map((s) => s.seed), res.stills.map((s) => s.seed));
      assert.equal(again.meta.requestId, res.meta.requestId, 'the request id must be a function of the idempotency key');
    });
  }
}

// ---------------------------------------------------------------------------
// Today's case table. `fal` is one more entry here (or in a *-smoke.test.js
// that imports runProviderContract) and NOTHING above changes.
// ---------------------------------------------------------------------------

runProviderContract([
  {
    name: 'fixture',
    // latencyMs 0 plus a no-op sleepImpl: the latency behaviour itself is
    // exercised in test/provider-fixture.test.js, where the wall time is the
    // subject rather than the tax.
    create: () => createProvider('fixture', { latencyMs: 0 }),
    makeCtx: (base) => ({ ...base, sleepImpl: async () => {} }),
  },
  // fal, against a fake queue built from the recorded shapes in
  // test/fixtures/fal/. It spends nothing: the transport is injected, the key
  // is injected, and the media it serves is rendered locally by ffmpeg at the
  // size and duration the recorded request asked for -- which is what lets the
  // pixel assertions above mean something. The LIVE version of this case is in
  // test/fal-smoke.test.js and self-skips unless TIMESTAMP_LIVE=1.
  falContractCase(),
]);

// ---------------------------------------------------------------------------
// Money guards. Not parameterised: these are properties of the package, not of
// any one provider, and each of them is one of the four independent guards in
// CLAUDE.md's "Money discipline".
// ---------------------------------------------------------------------------

test('the registry refuses an unknown provider rather than falling back', () => {
  // Falling back to the fixture would mean a production run silently rendering
  // coloured rectangles instead of a person, surfacing as "the video looks
  // wrong" rather than as an error.
  assert.throws(() => createProvider('replicate'), (err) => {
    assert.ok(err instanceof TerminalError);
    assert.equal(err.code, 'unknown_provider');
    assert.match(err.message, /fixture/);
    assert.match(err.message, /fal/);
    return true;
  });
  assert.deepEqual(PROVIDER_IDS, ['fixture', 'fal']);
});

test('requireFetchImpl is a TypeError, not a ProviderError', () => {
  // Deliberate: a ProviderError is something the pipeline catches, records and
  // may retry. A missing transport is a wiring bug and it should crash.
  let thrown;
  try { requireFetchImpl({}, { provider: 'fal' }); } catch (e) { thrown = e; }
  assert.ok(thrown instanceof TypeError);
  assert.ok(!(thrown instanceof ProviderError));
  assert.match(thrown.message, /NO DEFAULT/);
});

test('FAL_KEY is not in the process during a test run', () => {
  // Guard 3 of four: `"test": "node --test"` is bare and does NOT load .env.
  // If this ever fails, someone added --env-file to the test script and the
  // other three guards just became the only three.
  assert.equal(process.env.FAL_KEY, undefined);
});

test('every price in config/pricing.json is marked as an estimate', () => {
  const pricing = loadPricing();
  for (const [model, entry] of Object.entries(pricing.models)) {
    assert.ok(entry._comment?.length > 0, `${model} has no _comment saying where the number came from`);
    assert.equal(typeof entry.estimate, 'boolean', `${model}.estimate`);
    if (entry.usd !== 0) {
      assert.equal(entry.estimate, true, `${model} is non-zero and must be marked as an ESTIMATE`);
      assert.match(entry._comment, /ESTIMATE/, `${model}'s _comment must say ESTIMATE in as many words`);
    }
  }
});

test('a non-zero price may not claim to be a fact', () => {
  // Zero is the only price that cannot drift. Everything else is an estimate
  // until a --meter run proves it -- see CLAUDE.md, "Common mistakes".
  assert.throws(() => assertPricingTable({
    currency: 'USD',
    models: { 'fal/x': { _comment: 'measured, honest', estimate: false, unit: 'image', usd: 0.04 } },
  }), (err) => {
    assert.equal(err.code, 'unmarked_price');
    return true;
  });

  assert.throws(() => assertPricingTable({
    currency: 'USD',
    models: { 'fal/x': { estimate: true, unit: 'image', usd: 0.04 } },
  }), (err) => {
    assert.equal(err.code, 'unmarked_price');
    return true;
  });
});

test('the estimator prices stills per image and video per second', () => {
  const pricing = loadPricing();
  assert.equal(estimateStill({ pricing, model: 'fixture/still-v1', count: 3 }), 0);
  assert.equal(estimateVideo({ pricing, model: 'fixture/video-v1', seconds: 15 }), 0);
  assert.equal(estimateStill({ pricing, model: 'fal/still-UNVERIFIED', count: 3 }), 0.15);
  assert.equal(estimateVideo({ pricing, model: 'fal/video-UNVERIFIED', seconds: 15 }), 3);
});

test('divergence is null until an actual is recorded, and 15% is the line', () => {
  assert.equal(divergence(1, null), null);
  assert.equal(divergence(0, 5), null, 'a relative divergence from zero is not a number worth printing');
  assert.equal(divergence(1, 1.2), 0.19999999999999996);
  assert.equal(diverges(1, 1.1), false);
  assert.equal(diverges(1, 1.2), true);
  // An estimate 40% too HIGH is just as wrong, and is the version that quietly
  // kills a margin calculation.
  assert.equal(diverges(1, 0.6), true);
});

test('config/models.json records an audio-off parameter for every usable video model', () => {
  const models = loadModels();
  // The fixture pair is verified and usable.
  assert.equal(modelEntry(models, 'fixture/still-v1').kind, 'still');
  const fixtureVideo = modelEntry(models, 'fixture/video-v1');
  assert.equal(fixtureVideo.nativeAudio, false);
  assert.equal(fixtureVideo.audioOffParam.name, '-an');
});

test('an UNVERIFIED fal model cannot be handed out', () => {
  // The VIDEO model has been verified against fal's schema page; the STILL
  // model has not been chosen and the fast video tier has not been read. The
  // one thing that must not happen is a paid run against an endpoint id
  // somebody guessed, so both are refused by name.
  const models = loadModels();
  for (const id of ['fal/UNVERIFIED-identity-still', 'bytedance/seedance-2.0/fast/image-to-video']) {
    assert.throws(() => modelEntry(models, id), (err) => {
      assert.equal(err.code, 'unverified_model', id);
      return true;
    });
  }
  // And even with verification waived, the fast tier is refused for the second
  // reason: nobody has recorded what its audio-off parameter is called.
  assert.throws(() => modelEntry(models, 'bytedance/seedance-2.0/fast/image-to-video', { requireVerified: false }), (err) => {
    assert.ok(err instanceof CapabilityError);
    assert.equal(err.code, 'no_audio_off_param');
    return true;
  });
  // The video model that WAS verified names its parameter, and the name is the
  // whole of layer 2: `generate_audio` defaults to TRUE at the vendor.
  const video = modelEntry(models, 'bytedance/seedance-2.0/image-to-video');
  assert.equal(video.nativeAudio, false);
  assert.equal(video.audioOffParam.name, 'generate_audio');
  assert.equal(video.audioOffParam.value, false);
  assert.equal(video.capabilities.maxClipSeconds, 15, 'fifteen seconds in one call is why there is no seam');
});

// ---------------------------------------------------------------------------
// a video request with no start frame
//
// `reference-to-video` has no start frame at all: it takes the photographs and
// generates the whole take from them. So `imagePath` -- which has always meant
// "the still somebody approved" -- stops being the only way to describe a video
// request, and EXACTLY ONE of the two must be present.
// ---------------------------------------------------------------------------

const aVideoReq = (over = {}) => ({
  prompt: 'p',
  negativePrompt: '',
  imagePath: path.resolve('still-01.png'),
  seconds: 15,
  seed: 1,
  nativeAudio: false,
  idempotencyKey: 'k',
  ...over,
});

test('a video request may carry references instead of a start frame', () => {
  const req = aVideoReq({
    imagePath: undefined,
    references: [{ role: 'face', path: path.resolve('face.jpg') }],
  });
  assert.doesNotThrow(() => assertVideoRequest(req),
    'the direct path has no still, so imagePath cannot be mandatory');
});

test('a video request with neither a start frame nor references is refused', () => {
  // Not a default and not a guess: a request that names no picture at all
  // cannot produce the right person, and it must fail before it is billed.
  assert.throws(() => assertVideoRequest(aVideoReq({ imagePath: undefined })),
    /imagePath|references/i);
});

test('a video request carrying BOTH a start frame and references is refused', () => {
  // The two describe different endpoints. Sending both leaves which one the
  // model honours up to the model, and the answer would differ per vendor --
  // exactly the class of ambiguity that cost a 422 and a round trip in BUG 3.
  assert.throws(
    () => assertVideoRequest(aVideoReq({ references: [{ role: 'face', path: path.resolve('f.jpg') }] })),
    /both|exactly one/i);
});

test('references on a video request are held to the same shape as on a still', () => {
  assert.throws(() => assertVideoRequest(aVideoReq({ imagePath: undefined, references: [] })),
    /at least one|references/i);
  assert.throws(
    () => assertVideoRequest(aVideoReq({ imagePath: undefined, references: [{ role: 'face', path: 'relative.jpg' }] })),
    /absolute/i);
});

test('a job with no still stage is estimated without a still line', () => {
  // DIRECT MODE. Quoting a still line on a job that will never make one
  // overstates the price of every direct render, and an estimate that names a
  // call nobody will be billed for is worse than no estimate at all -- the
  // whole point of `--dry-run` is authorising a spend against real numbers.
  const pricing = loadPricing();
  const segments = [{ index: 1, seconds: 15, startsFrom: 'references' }];
  const est = estimateJob({
    pricing,
    videoModel: 'bytedance/seedance-2.0/reference-to-video',
    stillCount: 0,
    segments,
  });

  assert.equal(est.lines.filter((l) => l.step === 'still').length, 0, 'no still line at all');
  assert.equal(est.lines.length, 1, 'one call, and it is the video');
  assert.equal(est.estimated, est.lines[0].usd, 'the total is the video and nothing else');
});
