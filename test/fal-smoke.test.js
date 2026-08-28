/**
 * THE ONLY FILE IN THIS PACKAGE PERMITTED TO SPEND MONEY.
 *
 * It self-skips unless `TIMESTAMP_LIVE=1` AND `FAL_KEY` is present, which is
 * guard 4 of the four in CLAUDE.md: one naming convention -- `*-smoke.test.js`
 * -- and one grep to audit the whole repo. `"test": "node --test"` is bare and
 * does not load `.env`, so a normal `npm test` cannot satisfy the second
 * condition even if somebody exports the first.
 *
 * WHAT IT COSTS WHEN IT RUNS. One four-second 480p generation: the shortest
 * legal clip at the cheap tier, roughly $0.40 against config/credits.json's
 * estimate. That is the smallest real answer money can buy to the questions
 * this file exists to ask, and every one of them is a question NO recorded
 * fixture can answer:
 *
 *   - Is `bytedance/seedance-2.0/image-to-video` really the route?
 *   - Does it accept a `data:` URI for `image_url`, or does it demand a CDN
 *     upload?
 *   - Is `duration` really a STRING enum? Is `seed` really an input -- two of
 *     fal's own pages disagree, and config/models.json records the
 *     disagreement.
 *   - LAYER 3, on a real file: does `generate_audio: false` actually produce
 *     ZERO audio streams? Layers 1 and 2 assert what we ASKED for. Only this
 *     has ever seen what came back, and it is the layer that catches a version
 *     bump quietly re-enabling audio.
 *   - Does `aspect_ratio: '4:3'` deliver a 4:3 raster, or a 16:9 one with the
 *     picture letterboxed inside it?
 *
 * WHY IT DOES NOT RUN `runProviderContract` LIVE, WHICH THE CONFORMANCE FILE'S
 * HEADER ANTICIPATED IT WOULD. Two reasons, and the first is a real finding
 * rather than a convenience. The shared body builds every video case as
 * `Math.min(2, maxClipSeconds)` seconds, and seedance's `duration` enum starts
 * at 4 -- so a live run of that body would spend a submit to be told 422 by a
 * documented boundary. And the still half cannot run at all: every fal still
 * model in config/models.json is an unverified candidate and `modelEntry`
 * refuses to hand one out, which is exactly what it is for. The FREE fal case
 * -- fake transport, recorded shapes, real locally-rendered pixels -- is
 * registered in `test/provider-contract.test.js` and runs on every `npm test`,
 * which is where the conformance guarantee actually lives.
 *
 * WHAT A FAILURE HERE MEANS. Not "the code is broken" but "a documented shape
 * is wrong". Every fixture under `test/fixtures/fal/` carries a `_provenance`
 * line saying whether it was VERIFIED from a schema page or INFERRED, so a red
 * line here should be traceable to one named guess rather than to the whole
 * directory.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { runFfmpeg, probe, REPO_ROOT } from '../scripts/ffmpeg/run.mjs';
import { createProvider, FAL_RESOLUTIONS } from '../scripts/providers/index.mjs';
import { fixtureStillFilter, fixtureStillArgs } from '../scripts/providers/fixture.mjs';

const LIVE = process.env.TIMESTAMP_LIVE === '1';
const HAVE_KEY = typeof process.env.FAL_KEY === 'string' && process.env.FAL_KEY.length > 0;

/** Two conditions, and the message says which one is missing. A smoke test
 *  that skips silently is a smoke test nobody notices has never run. */
const skip = LIVE
  ? (HAVE_KEY ? false : 'TIMESTAMP_LIVE=1 but FAL_KEY is not in the process -- put it in .env and run with --env-file=.env')
  : 'TIMESTAMP_LIVE is not 1 -- this is the only file that can spend money, so it does not run by default';

const SECONDS = 4;
const RESOLUTION = '480p';
// The pid goes on the DIRECTORY -- same fix as `c897845`. This file only runs
// under TIMESTAMP_LIVE=1, so it has never collided in practice; it is fixed
// with the other three because the next person to run two live smokes at once
// should not have to discover it.
const OUT = path.join(REPO_ROOT, 'build', 'fal-smoke', String(process.pid));

test('[fal LIVE] one 4-second 480p clip: the shapes, and layer 3 on a real file', { skip }, async (t) => {
  fs.mkdirSync(OUT, { recursive: true });
  const size = FAL_RESOLUTIONS[RESOLUTION];

  // The start frame is generated locally by the fixture provider's own
  // builders, for $0. Spending on a still to test a video would double the
  // bill to answer none of the questions above -- and the still model has not
  // been chosen anyway.
  const start = path.join(OUT, 'start.png');
  await runFfmpeg(fixtureStillArgs({
    filter: fixtureStillFilter({ seed: 20260820, index: 1, size, fontPath: null }),
    output: start,
  }));

  const provider = createProvider('fal');
  const events = [];
  const startedAt = Date.now();

  const res = await provider.generateVideo({
    prompt: 'a slow handheld drift across a quiet suburban garden in late afternoon light, the person stays where they are',
    negativePrompt: '',
    imagePath: start,
    seed: 20260820,
    seconds: SECONDS,
    size,
    nativeAudio: false,
    index: 1,
    idempotencyKey: `smoke-${startedAt}`,
  }, {
    outDir: OUT,
    // THE MONEY GUARD, INVERTED ON PURPOSE. This is the one place in the
    // package where a real transport is handed in, and it is one line, in a
    // file whose name says what it does.
    fetchImpl: globalThis.fetch,
    onProgress: (e) => { events.push(e); t.diagnostic(`${e.phase} ${e.pct ?? ''} ${e.message ?? ''}`.trim()); },
  });

  t.diagnostic(`request ${res.meta.falRequestId} -- ${res.meta.latencyMs}ms -- estimated $${res.cost.estimated}`);
  t.diagnostic(`provider seed: ${res.meta.providerSeed} (we sent 20260820)`);

  assert.ok(fs.existsSync(res.clip.path), 'nothing was downloaded');
  assert.ok(fs.statSync(res.clip.path).size > 10_000, 'the download is suspiciously small');

  const info = await probe(res.clip.path, { countFrames: true });
  const streams = info.streams ?? [];

  // LAYER 3. The only assertion in this repo that has ever seen what a paid
  // model actually returned.
  const audio = streams.filter((s) => s.codec_type === 'audio');
  assert.equal(audio.length, 0,
    `generate_audio: false was sent and ${audio.length} audio stream(s) came back (${audio.map((a) => a.codec_name).join(', ')}). ` +
    'The model is generating audio anyway -- see CLAUDE.md, "Set the video model\'s native audio OFF".');

  const video = streams.find((s) => s.codec_type === 'video');
  assert.ok(video, 'no video stream');
  t.diagnostic(`delivered ${video.width}x${video.height}, ${video.nb_read_frames} frames, ${video.r_frame_rate}`);

  // 4:3, because aspect_ratio: '4:3' was requested and the tape raster is DAR
  // 4:3. A 16:9 frame with the picture letterboxed inside it would pass a
  // naive "did we get a video" check and quietly cost a third of every frame.
  assert.equal(video.width * 3, video.height * 4,
    `asked for 4:3 and got ${video.width}x${video.height} -- if this is 16:9 the aspect_ratio parameter is not doing what the schema says`);

  // Not asserted as an equality: what the delivered duration is, is one of the
  // open questions in config/models.json, and the answer belongs in the log
  // where somebody will read it rather than in a red line.
  const [num, den] = String(video.r_frame_rate ?? '0/1').split('/').map(Number);
  const fps = den ? num / den : 0;
  t.diagnostic(`~${(Number(video.nb_read_frames) / fps).toFixed(3)}s delivered against ${SECONDS}s requested`);

  assert.equal(events.at(-1).phase, 'done');
});

test('[fal LIVE] the still model is still unchosen, and refuses rather than spending', { skip }, async () => {
  // Deliberately live and deliberately free: it asserts that the ONE guard
  // standing between a paid run and an endpoint id somebody guessed is still
  // standing, with a real key in the process.
  const provider = createProvider('fal');
  await assert.rejects(
    provider.generateStill({
      prompt: 'the person in the reference image',
      negativePrompt: '',
      references: [{ role: 'face', path: path.join(OUT, 'start.png') }],
      seed: 1,
      count: 1,
      size: FAL_RESOLUTIONS[RESOLUTION],
      idempotencyKey: 'smoke-still',
    }, { outDir: OUT, fetchImpl: globalThis.fetch }),
    (err) => {
      assert.equal(err.code, 'unverified_model');
      return true;
    },
  );
});
