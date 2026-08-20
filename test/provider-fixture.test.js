/**
 * The fixture provider itself -- the properties that are true of THIS
 * implementation and are not part of the shared contract.
 *
 * Three of them are load-bearing for the rest of the repo:
 *
 *   IT COSTS ZERO. Not "approximately nothing", not "whatever pricing.json
 *   says". The fixture never reads config/pricing.json, because a fixture that
 *   could report a non-zero cost is a fixture that can lie about money, and
 *   the ledger would then have a source of fictional dollars in it.
 *
 *   IT IS DETERMINISTIC. Same seed, same bytes. Everything downstream that
 *   asserts on a rendered file -- the tape look, the delivery contract, the
 *   frame count -- is only assertable because the thing it renders does not
 *   move between runs. The purity check here runs FIVE times, not two,
 *   following the house rule from the gblur incident: a 2-run check passed a
 *   bug that failed 6 out of 6.
 *
 *   IT PRODUCES ZERO AUDIO STREAMS. Checked here with ffprobe on the actual
 *   file, which is the same shape of check the pipeline's `assemble` step
 *   makes -- layer 3 of the three-layer native-audio rule, applied early.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { runFfmpeg, runFfprobe, findFfmpeg, probe, REPO_ROOT } from '../scripts/ffmpeg/run.mjs';
import { regionStats } from '../scripts/ffmpeg/assert.mjs';
import {
  createFixtureProvider,
  fixturePalette,
  fixtureStillFilter,
  fixtureVideoFilter,
  fixtureStillArgs,
  fixtureVideoArgs,
  fixtureStillName,
  fixtureClipName,
  fixtureRequestId,
  FIXTURE_CAPABILITIES,
  PROGRESS_CHUNKS,
} from '../scripts/providers/fixture.mjs';

const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'render.json'), 'utf8'));
const SIZE = FIXTURE_CAPABILITIES.stillSizes[0];

async function haveFfmpeg() {
  try {
    await runFfmpeg(['-hide_banner', '-version']);
    return true;
  } catch {
    return false;
  }
}
const HAVE = await haveFfmpeg();
const skip = HAVE ? false : `ffmpeg not found (${findFfmpeg().ffmpeg}) -- fixture pixel tests skipped`;

function workdir(...parts) {
  const dir = path.join(REPO_ROOT, 'build', 'provider-fixture', ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

let refPromise = null;
function reference() {
  refPromise ??= (async () => {
    const file = path.join(workdir('input'), 'face.png');
    await runFfmpeg([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=0x6E5A44:s=512x384:r=1:d=1,format=rgb24',
      '-frames:v', '1', '-update', '1', file,
    ]);
    return file;
  })();
  return refPromise;
}

function stillReq(over = {}) {
  return {
    prompt: 'the person in the reference image, on a balcony, washing on the line',
    negativePrompt: '',
    references: [{ role: 'face', path: over.refPath ?? '' }],
    seed: 1000,
    count: 1,
    size: SIZE,
    idempotencyKey: 'fixture-test-1',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Pure builders -- no ffmpeg, no skip
// ---------------------------------------------------------------------------

test('the palette is a pure function of seed and index', () => {
  assert.deepEqual(fixturePalette(1000, 1), fixturePalette(1000, 1));
  assert.notDeepEqual(fixturePalette(1000, 1), fixturePalette(1000, 2));
  assert.notDeepEqual(fixturePalette(1000, 1), fixturePalette(1001, 1));
  for (const key of ['bg', 'field', 'accent', 'grid', 'ink']) {
    assert.match(fixturePalette(7, 1)[key], /^0x[0-9A-F]{6}$/, key);
  }
});

test('consecutive stills of one job do not land on the same hue', () => {
  // The reason deriveSeed is reused instead of a hand-rolled `seed * 137 % 360`:
  // FNV-1a's low bits correlate for keys sharing a prefix, and every key here
  // shares one. Three near-identical hues in a contact sheet is exactly the
  // failure the palette exists to prevent.
  const hues = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => fixturePalette(1000, i).hue);
  assert.equal(new Set(hues).size, 8, `hues collided: ${hues.join(', ')}`);
  for (let i = 1; i < hues.length; i += 1) {
    const gap = Math.abs(hues[i] - hues[i - 1]);
    assert.ok(Math.min(gap, 360 - gap) > 8, `hue ${hues[i - 1]} and ${hues[i]} are too close to tell apart`);
  }
});

test('the still filtergraph contains nothing that reads entropy or the clock', () => {
  const graph = fixtureStillFilter({ seed: 1000, index: 3, size: SIZE, fontPath: 'assets/fonts/tape-osd.ttf' });

  // `gradients` defaults every colour to random; `anoisesrc` defaults seed=-1;
  // `%{localtime}` and expansion=strftime read the wall clock. All four break
  // "same inputs, same bytes" silently. Anchored to a filter-name boundary,
  // because substring-matching a filter name is its own listed mistake --
  // "avgblur" contains "gblur".
  assert.doesNotMatch(graph, /(^|,)gradients=/);
  assert.doesNotMatch(graph, /(^|,)anoisesrc=/);
  assert.doesNotMatch(graph, /(^|,)testsrc2?=/);
  assert.doesNotMatch(graph, /%\{localtime/);
  assert.doesNotMatch(graph, /expansion=strftime/);
  assert.doesNotMatch(graph, /random/i);

  // And the positive side: the source is a fully-specified colour at the
  // requested size, and the graph ends in a pixel format rather than leaving
  // it to negotiation.
  assert.match(graph, /^color=c=0x[0-9A-F]{6}:s=1024x768:r=1:d=1,/);
  assert.match(graph, /,format=rgb24$/);
});

test('the still filtergraph burns the index and the seed into the picture', () => {
  const graph = fixtureStillFilter({ seed: 123456, index: 3, size: SIZE, fontPath: 'assets/fonts/tape-osd.ttf' });
  assert.match(graph, /drawtext=text='03'/);
  assert.match(graph, /fixture still 03  seed 123456  1024x768/);
  // The relative font path is the supported route: no drive letter means no
  // colon means no fontfile= escaping problem at all.
  assert.match(graph, /fontfile='assets\/fonts\/tape-osd\.ttf'/);
});

test('no font means shape-only rather than a failed render', () => {
  // assets/fonts/tape-osd.ttf is not bundled yet. A fixture that refused to
  // run without it would block the entire application build over a label.
  const graph = fixtureStillFilter({ seed: 1000, index: 3, size: SIZE, fontPath: null });
  assert.doesNotMatch(graph, /drawtext/);
  // The tally bars still count the index, so still 1 and still 3 remain
  // tellable apart on a contact sheet without a single glyph.
  assert.equal((graph.match(/drawbox=/g) ?? []).length, 1 + 3 + 3, 'field box + 3 accents + 3 tally bars');
});

test('the tally counts the still index', () => {
  const boxes = (index) => (fixtureStillFilter({ seed: 1000, index, size: SIZE, fontPath: null }).match(/drawbox=/g) ?? []).length;
  assert.equal(boxes(2) - boxes(1), 1);
  assert.equal(boxes(5) - boxes(1), 4);
});

test('the clip pans with crop/n and steps its bar with a timeline enable', () => {
  const graph = fixtureVideoFilter({ seed: 777, index: 1, seconds: 2, frames: 50, size: SIZE, fontPath: null });
  assert.match(graph, /^\[0:v\]/);
  assert.match(graph, /\[vout\]$/);
  assert.match(graph, /,format=yuv420p\[vout\]$/);
  // Measured: drawbox exposes neither `n` (it errors) nor a timestamp -- its
  // `t` is the box THICKNESS, and with t=fill an animated width silently
  // clamps to full frame. crop exposes `n`; drawbox supports timeline
  // `enable`, whose `t` IS the timestamp. Hence: pan via crop, bar via enable.
  assert.match(graph, /crop=1024:768:x='\(iw-ow\)\/2\+.*sin\(2\*PI\*n\/50/);
  assert.equal((graph.match(/enable='gte\(t,/g) ?? []).length, PROGRESS_CHUNKS);
  assert.match(graph, /drawbox=x=0:y=\d+:w=\d+:h=\d+:c=0x[0-9A-F]{6}@0\.9:t=fill:enable='gte\(t,0\)'/);
  // The last chunk lights just before the end, not at it -- a bar whose final
  // step never appears is a bar that looks stuck at 92%.
  // Rounded to 4 decimals by the same helper audio/bed.mjs uses: trailing
  // float noise in a filtergraph makes golden strings fragile for no benefit.
  const lastGate = Number(((2 * (PROGRESS_CHUNKS - 1)) / PROGRESS_CHUNKS).toFixed(4));
  assert.ok(graph.includes(`enable='gte(t,${lastGate})'`), `no final gate at t=${lastGate} in ${graph}`);
  // The chunks tile the full width with no gap and no overhang.
  const widths = [...graph.matchAll(/drawbox=x=(\d+):y=\d+:w=(\d+):h=\d+:c=0x[0-9A-F]{6}@0\.9/g)];
  assert.equal(widths.length, PROGRESS_CHUNKS);
  assert.equal(Number(widths.at(-1)[1]) + Number(widths.at(-1)[2]), SIZE.width);
  assert.doesNotMatch(graph, /%\{localtime/);
  // No audio source anywhere in the graph. That is the structural half of the
  // zero-audio guarantee -- the same reason audio/bed.mjs has no [0:a] to leak
  // through. `-an` in the argv is the other half.
  assert.doesNotMatch(graph, /anoisesrc|sine=|aevalsrc|amix|\[0:a\]/);
});

test('two segments of one job do not pan in lockstep', () => {
  const a = fixtureVideoFilter({ seed: 777, index: 1, seconds: 2, frames: 50, size: SIZE, fontPath: null });
  const b = fixtureVideoFilter({ seed: 777, index: 2, seconds: 2, frames: 50, size: SIZE, fontPath: null });
  assert.notEqual(a, b);
});

test('the argv builders are argv, and carry -an and an exact frame count', () => {
  const args = fixtureVideoArgs({
    imagePath: 'C:/x/still-01.png',
    filter: '[0:v]null[vout]',
    output: 'C:/x/seg-01.mp4',
    cfg,
    frames: 200,
  });
  assert.ok(Array.isArray(args));
  assert.ok(args.every((a) => typeof a === 'string'), 'every argv element must be a string');
  assert.ok(args.includes('-an'), 'the clip must be muxed with no audio');
  // A frame count, not a duration: 200 frames at 25fps is exactly 8.000s where
  // `-t 8` is an argument about rounding.
  assert.equal(args[args.indexOf('-frames:v') + 1], '200');
  assert.equal(args[args.indexOf('-r') + 1], String(cfg.fps));
  assert.equal(args[args.indexOf('-filter_complex_threads') + 1], String(cfg.encode.filterComplexThreads));
  assert.equal(args.at(-1), 'C:/x/seg-01.mp4');

  const stillArgs = fixtureStillArgs({ filter: 'color=c=0x000000:s=8x6', output: 'C:/x/still-01.png' });
  assert.ok(stillArgs.includes('-update'), '-update 1 keeps image2 from warning about a missing pattern');
  assert.equal(stillArgs.at(-1), 'C:/x/still-01.png');
});

test('filenames match the manifest layout in docs/interfaces.md', () => {
  assert.equal(fixtureStillName(1), 'still-01.png');
  assert.equal(fixtureStillName(12), 'still-12.png');
  assert.equal(fixtureClipName({ index: 1, idempotencyKey: 'k' }), 'seg-01.mp4');
  // VideoRequest carries no index in interfaces.md, so an index-less call falls
  // back to a hash of the idempotency key: collision-free and stable across a
  // retry, which is the property that actually matters.
  const a = fixtureClipName({ idempotencyKey: 'job-a:animate:1' });
  const b = fixtureClipName({ idempotencyKey: 'job-a:animate:2' });
  assert.match(a, /^clip-[0-9a-f]{8}\.mp4$/);
  assert.notEqual(a, b);
  assert.equal(a, fixtureClipName({ idempotencyKey: 'job-a:animate:1' }));
});

test('the request id is a pure function of the idempotency key', () => {
  // A resumed job must recompute the same id rather than mint a second one for
  // the same work -- that is the whole point of the intent record.
  assert.equal(fixtureRequestId('job-a:still'), fixtureRequestId('job-a:still'));
  assert.notEqual(fixtureRequestId('job-a:still'), fixtureRequestId('job-b:still'));
});

test('latencyMs must be a number, and the factory says so immediately', () => {
  assert.throws(() => createFixtureProvider({ latencyMs: 'slow' }), TypeError);
  assert.throws(() => createFixtureProvider({ latencyMs: -1 }), TypeError);
});

// ---------------------------------------------------------------------------
// Latency -- the reason the queue and the polling UI are exercised at all
// ---------------------------------------------------------------------------

test('the simulated latency goes through ctx.sleepImpl', { skip }, async () => {
  // 30 seconds of nominal latency against a budget of 6. The gap is deliberate
  // and it is the whole design of this assertion.
  //
  // The first version asked for 1000ms and asserted `elapsed < 900`, reasoning
  // that with sleep stubbed the only time left is ffmpeg. True, but `npm test`
  // runs test FILES IN PARALLEL, so ffmpeg here competes with every other
  // ffmpeg the suite is running -- it took 1008ms under load and failed, while
  // passing in isolation every time. A timing assertion whose margin is
  // narrower than the machine's own variance does not test the code, it tests
  // how busy the laptop is, and it fails on the day someone is doing something
  // else. Widening the nominal latency instead of loosening the budget keeps
  // the assertion sharp: a genuine bypass burns THIRTY seconds and cannot hide
  // inside any amount of scheduling noise.
  //
  // Note also that `slept` below is the real proof. It is asserted first and it
  // is exact -- a provider reaching for setTimeout directly leaves it empty.
  // The wall-clock check is the backstop for the subtler bug where the injected
  // impl is called AND a real timer is awaited as well.
  const provider = createFixtureProvider({ latencyMs: 30000 });
  const slept = [];
  const started = performance.now();
  await provider.generateStill(stillReq({ refPath: await reference() }), {
    outDir: workdir('sleep'),
    sleepImpl: async (ms) => { slept.push(ms); },
  });
  const elapsed = performance.now() - started;

  assert.deepEqual(slept, [9000, 15000, 6000], 'the round trip is split across submit/queued/download');
  assert.equal(slept.reduce((a, b) => a + b, 0), 30000);
  // Half the nominal latency, as a PROPORTION rather than a fixed number. A
  // fixed 6000ms budget still failed under a fully loaded suite -- ffmpeg here
  // took 9.78s while competing with every other ffmpeg the run had going. The
  // question this asks is "did a real 30-second timer run", and anything below
  // half of it answers that unambiguously however slow the machine is.
  assert.ok(elapsed < 15000, `injected sleepImpl was bypassed: ${Math.round(elapsed)}ms elapsed`);
});

test('the default latency actually takes time', { skip }, async () => {
  // A provider that returns in 3ms lets a queue with a broken lease, a status
  // page that never polls and a worker that never heartbeats all look like
  // they work.
  const provider = createFixtureProvider({ latencyMs: 200 });
  const started = performance.now();
  await provider.generateStill(stillReq({ refPath: await reference() }), { outDir: workdir('slow') });
  assert.ok(performance.now() - started >= 180, 'the fixture returned faster than its configured latency');
});

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

test('the fixture costs exactly zero, and says so as a measurement', { skip }, async () => {
  const provider = createFixtureProvider({ latencyMs: 0 });
  const outDir = workdir('cost');
  const still = await provider.generateStill(stillReq({ refPath: await reference() }), { outDir, sleepImpl: async () => {} });
  assert.deepEqual(still.cost, { estimated: 0, actual: 0, currency: 'USD' });

  const clip = await provider.generateVideo({
    prompt: 'a slow drift', negativePrompt: '', imagePath: still.stills[0].path,
    seed: 42, seconds: 1, nativeAudio: false, index: 1, idempotencyKey: 'fixture-cost',
  }, { outDir, sleepImpl: async () => {} });
  // `actual: 0` rather than null. Null means NOT METERED YET; here we know
  // exactly what local ffmpeg charges.
  assert.deepEqual(clip.cost, { estimated: 0, actual: 0, currency: 'USD' });
});

// ---------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------

test('the same seed produces the same bytes, five runs out of five', { skip }, async () => {
  // Five, not two. The gblur nondeterminism bug passed a 2-run check and then
  // failed 6 out of 6 -- see CLAUDE.md. This graph has no blur in it, but the
  // rule is about how the check is run, not about which filter is suspected.
  const provider = createFixtureProvider({ latencyMs: 0 });
  const refPath = await reference();
  const hashes = [];
  for (let run = 0; run < 5; run += 1) {
    const outDir = workdir('purity', `run-${run}`);
    const res = await provider.generateStill(stillReq({ refPath, seed: 20260820 }), { outDir, sleepImpl: async () => {} });
    hashes.push(sha256(res.stills[0].path));
  }
  assert.equal(new Set(hashes).size, 1, `five runs produced ${new Set(hashes).size} different images: ${hashes.join(' ')}`);
});

test('a different seed produces a different picture', { skip }, async () => {
  const provider = createFixtureProvider({ latencyMs: 0 });
  const refPath = await reference();
  const one = await provider.generateStill(stillReq({ refPath, seed: 1 }), { outDir: workdir('seed', 'a'), sleepImpl: async () => {} });
  const two = await provider.generateStill(stillReq({ refPath, seed: 2 }), { outDir: workdir('seed', 'b'), sleepImpl: async () => {} });
  assert.notEqual(sha256(one.stills[0].path), sha256(two.stills[0].path));
});

test('the shape-only path still renders a real, distinguishable image', { skip }, async () => {
  const provider = createFixtureProvider({ latencyMs: 0, fontPath: null });
  const outDir = workdir('nofont');
  const res = await provider.generateStill(stillReq({ refPath: await reference(), count: 3 }), { outDir, sleepImpl: async () => {} });
  assert.equal(res.stills.length, 3);
  const hashes = res.stills.map((s) => sha256(s.path));
  assert.equal(new Set(hashes).size, 3, 'without a font the stills became indistinguishable');
  for (const s of res.stills) {
    const info = await probe(s.path);
    const v = (info.streams ?? []).find((x) => x.codec_type === 'video');
    assert.equal(v.width, SIZE.width);
    assert.equal(v.height, SIZE.height);
  }
});

test('the clip is exactly seconds x cfg.fps frames, with zero audio streams', { skip }, async () => {
  const provider = createFixtureProvider({ latencyMs: 0 });
  const outDir = workdir('clip');
  const still = await provider.generateStill(stillReq({ refPath: await reference() }), { outDir, sleepImpl: async () => {} });
  const seconds = 2;
  const res = await provider.generateVideo({
    prompt: 'a slow drift', negativePrompt: '', imagePath: still.stills[0].path,
    seed: 777, seconds, nativeAudio: false, index: 1, idempotencyKey: 'fixture-clip',
  }, { outDir, sleepImpl: async () => {} });

  assert.equal(path.basename(res.clip.path), 'seg-01.mp4');

  const info = await probe(res.clip.path, { countFrames: true });
  const streams = info.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  assert.equal(Number(video.nb_read_frames), seconds * cfg.fps);
  assert.equal(video.r_frame_rate, `${cfg.fps}/1`);
  assert.equal(video.width, SIZE.width);
  assert.equal(video.height, SIZE.height);
  assert.equal(streams.filter((s) => s.codec_type === 'audio').length, 0);

  // The same check the pipeline's `assemble` step makes -- layer 3 of the
  // three-layer rule -- run here on the provider's own output, exactly as
  // docs/phase-0-validation.md spells it out. Empty stdout or the model is
  // disqualified.
  const { stdout } = await runFfprobe([
    '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', res.clip.path,
  ]);
  assert.equal(stdout.trim(), '', `ffprobe listed audio streams: ${stdout}`);
});

test('the clip is the approved still in motion, not a fresh invention', { skip }, async () => {
  // The image -> video seam is the one the real provider has to get right, and
  // a fixture that ignored `imagePath` would let a pipeline bug in that wiring
  // pass every test in the repo.
  const provider = createFixtureProvider({ latencyMs: 0 });
  const outDir = workdir('chain');
  const still = await provider.generateStill(stillReq({ refPath: await reference(), count: 2 }), { outDir, sleepImpl: async () => {} });
  const base = {
    prompt: 'a slow drift', negativePrompt: '', seed: 777, seconds: 1,
    nativeAudio: false, idempotencyKey: 'fixture-chain',
  };
  const a = await provider.generateVideo({ ...base, imagePath: still.stills[0].path, index: 1 }, { outDir, sleepImpl: async () => {} });
  const b = await provider.generateVideo({ ...base, imagePath: still.stills[1].path, index: 2 }, { outDir, sleepImpl: async () => {} });
  assert.notEqual(sha256(a.clip.path), sha256(b.clip.path), 'the clip did not depend on its start image');
  assert.equal(path.basename(b.clip.path), 'seg-02.mp4');
});

test('the progress bar actually grows -- it is not a stripe', { skip }, async () => {
  // The regression test for a bug that shipped a silently static bar: a single
  // drawbox with `w='W*t/SEC'` renders full width on every frame, because in a
  // drawbox geometry expression `t` is the box thickness and `t=fill` makes it
  // enormous. No error, no warning, and every structural assertion above still
  // passes. The only thing that catches it is looking at the pixels.
  const provider = createFixtureProvider({ latencyMs: 0 });
  const outDir = workdir('bar');
  const still = await provider.generateStill(stillReq({ refPath: await reference() }), { outDir, sleepImpl: async () => {} });
  const seconds = 2;
  const res = await provider.generateVideo({
    prompt: 'a slow drift', negativePrompt: '', imagePath: still.stills[0].path,
    seed: 777, seconds, nativeAudio: false, index: 3, idempotencyKey: 'fixture-bar',
  }, { outDir, sleepImpl: async () => {} });

  const barH = Math.max(4, Math.round(SIZE.height * 0.018));
  const chunkW = Math.round(SIZE.width / PROGRESS_CHUNKS);
  // The right-most chunk: dark at the start of the clip, lit at the end.
  const region = { x: SIZE.width - chunkW + 4, y: SIZE.height - barH, w: chunkW - 8, h: barH };
  const first = await regionStats(res.clip.path, region, { frame: 1 });
  const last = await regionStats(res.clip.path, region, { frame: seconds * cfg.fps });
  assert.ok(last.YAVG - first.YAVG > 40,
    `the last chunk of the bar is not lit at the end: YAVG ${first.YAVG} -> ${last.YAVG}`);
});
