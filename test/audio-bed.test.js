/**
 * The bed, asserted without ffmpeg.
 *
 * Same two-tier split as test/tapedeck-look.test.js, for the same reason. The
 * GOLDEN test runs against a frozen fixture profile, so tuning the audio block
 * in config/look/base.json -- which is what tuning a bed IS -- never turns the
 * suite red. The INVARIANT tests run against the real base.json and assert the
 * handful of things that must hold for any profile whatsoever.
 *
 * The invariants are not stylistic. Each one is a defect that ships silently:
 *
 *   An `amix` without `normalize=0` still renders. It is just 6 dB quieter than
 *   every number in the profile says, and nothing anywhere reports it.
 *
 *   An `anoisesrc` without `seed=` still renders. It is just different noise
 *   every time, so "reproducible" quietly becomes a word rather than a property,
 *   and the failure only surfaces in a purity check nobody runs on audio.
 *
 *   A `loudnorm` in the render path still renders. It just makes the level a
 *   function of the content and the analysis window instead of the seed, and it
 *   breathes on a steady hiss.
 *
 * Golden strings catch all three in milliseconds. The ffmpeg tests in
 * test/audio-output.test.js exist to prove the numbers; these exist to prove the
 * shape, and the shape is what people edit.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAudioFilter, clampAudio, AUDIO_CLAMPS } from '../scripts/audio/bed.mjs';
import {
  joinGraphs, audioMuxArgs, muxedArgs, bedLoudnessArgs, fileLoudnessArgs,
  bedHashArgs, muxedHashArgs, parseIntegratedLufs, lufsVerdict,
} from '../scripts/audio/mix.mjs';
import { loadLookProfile, buildVideoFilter } from '../scripts/tapedeck/look.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/render.json'), 'utf8'));
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/look/base.json'), 'utf8'));

/** Frozen. Nothing tunes this; base.json is where tuning happens. */
const FIXTURE = {
  audioSeed: 7,
  audio: {
    masterGain: 3,
    targetLufs: -27,
    toleranceLufs: 2,
    hiss: { amplitude: 0.2, highpass: 200, lowpass: 8000, volume: 0.35 },
    capstan: {
      tones: [{ hz: 118, volume: 0.05 }, { hz: 237, volume: 0.018 }],
      flutterHz: 7.3, flutterDepth: 0.35, lowpass: 900,
    },
    bus: { highpass: 190, lowpass: 8000, limit: 0.7 },
  },
};

const bedFor = (look = FIXTURE, opts) => buildAudioFilter(look, cfg, opts);
const realBed = () => {
  const { look } = loadLookProfile(base);
  clampAudio(look);
  return buildAudioFilter(look, cfg);
};

test('the fixture audio profile compiles to a stable bed graph', () => {
  // The audio graph is short enough to assert whole, unlike the video one. A
  // full-string golden is the strictest form available and it reads as the bed's
  // signal path when it fails.
  assert.equal(bedFor(), [
    'anoisesrc=c=pink:a=0.2:r=48000:d=15:seed=7,highpass=f=200,lowpass=f=8000,volume=0.35[hiss]',
    'sine=f=118:r=48000:d=15,volume=0.05[cap0]',
    'sine=f=237:r=48000:d=15,volume=0.018[cap1]',
    '[cap0][cap1]amix=inputs=2:normalize=0,tremolo=f=7.3:d=0.35,lowpass=f=900[capstan]',
    '[hiss][capstan]amix=inputs=2:normalize=0,aformat=channel_layouts=mono:sample_rates=48000,' +
      'highpass=f=190,lowpass=f=8000,volume=3,alimiter=limit=0.7:level=disabled[aout]',
  ].join(';'));
});

test('every amix carries normalize=0', () => {
  for (const graph of [bedFor(), realBed()]) {
    const mixes = [...graph.matchAll(/amix=[^,;\]]*/g)].map((m) => m[0]);
    assert.ok(mixes.length >= 1, 'the mix bus should be an amix');
    for (const mix of mixes) {
      assert.match(mix, /(^|:)normalize=0(:|$)/,
        `${mix} would silently divide by its input count and scale away every level in the profile`);
    }
  }
});

test('a single-layer bus still gets an explicit normalize=0', () => {
  // The one-input case is where "amix is pointless here, drop the options" is a
  // tempting edit, and it is the case that then teaches the wrong habit.
  const graph = bedFor({ ...FIXTURE, audio: { ...FIXTURE.audio, capstan: { ...FIXTURE.audio.capstan, tones: [] } } });
  assert.match(graph, /\[hiss\]amix=inputs=1:normalize=0,/);
  assert.ok(!graph.includes('sine='), 'no tones means no capstan branch at all');
});

test('every noise source is seeded', () => {
  for (const graph of [bedFor(), realBed()]) {
    const sources = [...graph.matchAll(/anoisesrc=[^,;\]]*/g)].map((m) => m[0]);
    assert.ok(sources.length >= 1, 'the hiss layer should be an anoisesrc');
    for (const src of sources) {
      assert.match(src, /(^|:)seed=\d+(:|$)/,
        `${src} falls back to seed=-1, which is random, and an unseeded bed is a different bed every run`);
    }
  }
});

test('an unusable audioSeed is refused rather than defaulted', () => {
  assert.throws(() => bedFor({ ...FIXTURE, audioSeed: undefined }), /audioSeed/);
  assert.throws(() => bedFor({ ...FIXTURE, audioSeed: 'later' }), /audioSeed/);
  assert.throws(() => buildAudioFilter({ audioSeed: 1 }, cfg), /audio/);
});

test('no dynamic gain of any kind reaches the render path', () => {
  // loudnorm, dynaudnorm, compand, speechnorm and acompressor all move the level
  // in response to the signal. Every one of them destroys the a-priori-known
  // level that is the whole reason the bed is synthesised rather than sampled.
  const forbidden = /(^|[,;[\]])(loudnorm|dynaudnorm|speechnorm|compand|acompressor|agate)[=,;]/;
  for (const graph of [bedFor(), realBed()]) {
    assert.ok(!forbidden.test(graph), `a content-dependent gain filter appeared in the bed: ${graph}`);
  }
  // Read the source too: a builder that emits loudnorm only on some branch would
  // slip past a graph built from one profile.
  const source = fs.readFileSync(path.join(ROOT, 'scripts/audio/bed.mjs'), 'utf8');
  const codeStart = source.indexOf('export const AUDIO_CLAMPS');
  // A missing marker would make `slice` pass vacuously, which is the one way a
  // grep-the-source test can quietly stop testing anything.
  assert.ok(codeStart > 0, 'could not find where the header ends and the code begins');
  assert.ok(!/loudnorm/.test(source.slice(codeStart)),
    'loudnorm must not appear anywhere in the bed builder -- the header may discuss it, the code may not');
});

test('the bed is band-limited at both ends, twice', () => {
  for (const graph of [bedFor(), realBed()]) {
    const highs = [...graph.matchAll(/highpass=f=(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    const lows = [...graph.matchAll(/lowpass=f=(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    assert.ok(highs.length >= 2, 'the hiss layer and the mix bus should each cut the bottom');
    assert.ok(lows.length >= 2, 'the hiss layer and the mix bus should each cut the top');
    // The delivery contract says 190 Hz - 8 kHz. The bus is the last word on it,
    // so it is the pair at the end of the graph that has to be right.
    const bus = graph.split(';').at(-1);
    assert.match(bus, /highpass=f=190,lowpass=f=8000/,
      'the mix bus must enforce the 190 Hz - 8 kHz band named in the output contract');
  }
});

test('mono at 48 kHz is pinned in the graph, not left to negotiation', () => {
  for (const graph of [bedFor(), realBed()]) {
    assert.match(graph, /aformat=channel_layouts=mono:sample_rates=48000/);
  }
  const args = audioMuxArgs(cfg);
  // And restated at the encoder, because mono is a contract term.
  assert.deepEqual(args.slice(-4), ['-ar', '48000', '-ac', '1']);
});

test('the bed graph never refers to an input stream', () => {
  // This is the structural half of "the model's own audio is never mapped".
  // There is no [0:a] in the graph to leak through, so excluding it is not a
  // flag anyone can forget.
  for (const graph of [bedFor(), realBed()]) {
    assert.ok(!/\[?\d+:[av]\]?/.test(graph), `the bed must be entirely synthesised, found an input reference in: ${graph}`);
  }
});

test('the render maps both outputs by name and never falls back to -an', () => {
  const videoFilter = '[0:v]null[vout]';
  const args = muxedArgs({ input: 'in.mp4', output: 'out.mp4', videoFilter, audioFilter: bedFor(), cfg });

  const vAt = args.indexOf('-map');
  assert.equal(args[vAt + 1], '[vout]');
  assert.equal(args[vAt + 2], '-map');
  assert.equal(args[vAt + 3], '[aout]');
  assert.ok(!args.includes('-an'), 'audio is excluded by naming the outputs, not by -an');
  assert.ok(!args.some((a) => /^0:a$/.test(a)), "input 0's audio must never be mapped");

  // One invocation: one -filter_complex holding both halves.
  assert.equal(args.filter((a) => a === '-filter_complex').length, 1);
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.ok(graph.includes('[vout]') && graph.includes('[aout]'));

  // Determinism net, inherited from gradeArgs and asserted here too because the
  // audio path is a new way to lose it.
  assert.equal(args[args.indexOf('-filter_complex_threads') + 1], '1');
});

test('omitting the bed leaves the silent render byte-for-byte unchanged', () => {
  const videoFilter = '[0:v]null[vout]';
  const withAudio = muxedArgs({ input: 'in.mp4', output: 'out.mp4', videoFilter, audioFilter: '', cfg });
  assert.ok(withAudio.includes('-an'), 'no bed means the existing -an default still applies');
  assert.equal(withAudio[withAudio.indexOf('-filter_complex') + 1], videoFilter,
    'a flag that is off must not perturb the graph it is not part of');
});

test('graphs splice with a semicolon and blanks disappear', () => {
  assert.equal(joinGraphs('a[v]', 'b[a]'), 'a[v];b[a]');
  assert.equal(joinGraphs('a[v]', ''), 'a[v]');
  assert.equal(joinGraphs('', 'b[a]'), 'b[a]');
  assert.equal(joinGraphs(undefined, null, 'b[a]'), 'b[a]');
});

test('the meter lives inside the complex graph, never as -af', () => {
  // "Simple and complex filtering cannot be used together for the same stream."
  // Both probe builders have to reach ebur128 through -filter_complex or ffmpeg
  // refuses outright.
  for (const args of [bedLoudnessArgs({ audioFilter: bedFor(), cfg }), fileLoudnessArgs({ input: 'out.mp4' })]) {
    assert.ok(args.includes('-filter_complex'));
    assert.ok(!args.includes('-af'));
    assert.match(args[args.indexOf('-filter_complex') + 1], /ebur128/);
    assert.equal(args[args.indexOf('-map') + 1], '[ebur]');
  }
  // And nowhere near the render.
  const render = muxedArgs({ input: 'in.mp4', output: 'out.mp4', videoFilter: '[0:v]null[vout]', audioFilter: bedFor(), cfg });
  assert.ok(!render.join(' ').includes('ebur128'), 'the render must not measure itself');
});

test('the loudness probe needs no input at all', () => {
  const args = bedLoudnessArgs({ audioFilter: bedFor(), cfg });
  assert.ok(!args.includes('-i'), 'a bed that depends on an input is not a synthesised bed');
});

test('the hash builders map only what they are hashing', () => {
  const bed = bedFor();
  const audioOnly = bedHashArgs({ input: { lavfi: 'sine=f=1000' }, audioFilter: bed, cfg });
  assert.deepEqual(audioOnly.filter((a, i) => audioOnly[i - 1] === '-map'), ['[aout]']);
  assert.ok(!audioOnly.includes('-stream_loop'), 'a probe input is present to be ignored, not to be looped');
  assert.ok(audioOnly.includes('pcm_f32le'), '16-bit would hide a nondeterminism below -90 dBFS');

  const muxed = muxedHashArgs({ input: { lavfi: 'testsrc2' }, videoFilter: '[0:v]null[vout]', audioFilter: bed, cfg });
  assert.deepEqual(muxed.filter((a, i) => muxed[i - 1] === '-map'), ['[vout]', '[aout]']);
  assert.equal(muxed[muxed.indexOf('-frames:v') + 1], '40');
});

test('integrated loudness is read from the summary, not from a progress line', () => {
  // ebur128 prints `I: -27.0 LUFS` mid-line on every progress row and again, at
  // the start of a line, in the summary. They usually agree -- which is exactly
  // why picking the wrong one hides until the once they do not.
  const stderr = [
    '[Parsed_ebur128_0 @ 0] t: 14.9  TARGET:-23 LUFS    M: -26.9 S: -27.0     I: -99.9 LUFS       LRA: 0.1 LU',
    'Summary:',
    '',
    '  Integrated loudness:',
    '    I:         -27.0 LUFS',
    '    Threshold: -37.0 LUFS',
  ].join('\n');
  assert.equal(parseIntegratedLufs(stderr), -27);
  assert.equal(parseIntegratedLufs('    I:         -inf LUFS'), -Infinity);
  assert.equal(parseIntegratedLufs('nothing here'), null);
});

test('the loudness verdict names the two things that actually moved the number', () => {
  const spec = { targetLufs: -27, toleranceLufs: 2 };
  assert.equal(lufsVerdict(-27.0, spec).ok, true);
  assert.equal(lufsVerdict(-25.0, spec).ok, true);
  assert.equal(lufsVerdict(-29.0, spec).ok, true);
  assert.equal(lufsVerdict(-33.0, spec).ok, false);
  assert.match(lufsVerdict(-33.0, spec).message, /normalize=0/);
  assert.match(lufsVerdict(-33.0, spec).message, /limit/);
  assert.equal(lufsVerdict(null, spec).ok, false);
  assert.equal(lufsVerdict(-Infinity, spec).ok, false);
});

test('out-of-range audio values are clamped and reported rather than thrown', () => {
  const { look } = loadLookProfile(base, { audio: { bus: { limit: 4 }, masterGain: -1 } });
  const { clamped } = clampAudio(look);
  assert.equal(look.audio.bus.limit, AUDIO_CLAMPS['audio.bus.limit'][1]);
  assert.equal(look.audio.masterGain, 0);
  assert.deepEqual(clamped.map((c) => c.path).sort(), ['audio.bus.limit', 'audio.masterGain']);
  // alimiter rejects limit outside 0.0625..1 with a hard error, so clamping here
  // is the difference between a nudged bed and a failed render.
  assert.equal(AUDIO_CLAMPS['audio.bus.limit'][0], 0.0625);
});

test('the shipped base profile satisfies every invariant', () => {
  const { look } = loadLookProfile(base);
  const { clamped } = clampAudio(look);
  assert.deepEqual(clamped, [], 'base.json should never ship audio values outside their own clamp ranges');
  assert.equal(look.audio.targetLufs, -27, 'the output contract in CLAUDE.md says -27 LUFS');
  assert.equal(cfg.encode.audioChannels, 1);
  assert.equal(cfg.encode.audioSampleRate, 48000);

  const graph = buildAudioFilter(look, cfg);
  assert.match(graph, new RegExp(`seed=${look.audioSeed}(:|,)`));
  assert.match(graph, /\[aout\]$/);

  // And the joined graph is still one legal filter_complex with two named ends.
  const video = buildVideoFilter({ ...look, osd: { ...look.osd, enabled: false } }, cfg, { burnIn: [] });
  const joined = joinGraphs(video, graph);
  assert.equal(joined, `${video};${graph}`);
  assert.match(joined, /\[vout\];/);
  assert.match(joined, /\[aout\]$/);
});

test('the limiter never acts as a gain stage', () => {
  // alimiter's `level` option defaults to TRUE, which scales output by 1/limit.
  // Without level=disabled, `bus.limit` silently doubles as a makeup gain and
  // lowering it to "leave more headroom" makes the bed LOUDER -- measured at
  // -29.6 LUFS with no limiter, -26.5 with limit=0.7 auto-level, and -29.6
  // again with level=disabled: exactly 20*log10(1/0.7) = 3.1 dB of gain, with
  // not one sample limited. Disabling it leaves `limit` meaning a ceiling and
  // leaves masterGain the single control of loudness.
  const graph = buildAudioFilter(FIXTURE, cfg);
  assert.match(graph, /alimiter=limit=[\d.]+:level=disabled/);
});

test('loudness responds only to masterGain, not to the ceiling', () => {
  // The behavioural statement of the rule above: changing the ceiling must not
  // change a single character of the level chain that precedes it.
  const levelChainOf = (g) => g.slice(g.lastIndexOf('aformat'), g.indexOf('alimiter'));
  const loose = buildAudioFilter({ ...FIXTURE, audio: { ...FIXTURE.audio, bus: { ...FIXTURE.audio.bus, limit: 0.95 } } }, cfg);
  const tight = buildAudioFilter({ ...FIXTURE, audio: { ...FIXTURE.audio, bus: { ...FIXTURE.audio.bus, limit: 0.25 } } }, cfg);
  assert.equal(levelChainOf(loose), levelChainOf(tight));
  assert.ok(loose.includes('limit=0.95') && tight.includes('limit=0.25'));
});

// ---------------------------------------------------------------------------
// place ambience
//
// The bed built the sound of the MACHINE -- hiss and capstan -- and nothing of
// the PLACE, so a Baltic beach and a concrete stairwell came out sounding
// identical. Paul asked for sound "according to the video" on 2026-08-24.
//
// SYNTHESISED, for exactly the reasons the header already gives for the hiss:
// no sample means no licence to reason about and no normalisation pass, because
// a generated layer's loudness is known before it is rendered. Every place's
// ambience is filtered noise, optionally swelling, optionally in a room.
// ---------------------------------------------------------------------------

const withAmbience = (over) => {
  const { look } = loadLookProfile(base, { audio: { ambience: over } });
  return buildAudioFilter(look, cfg);
};

test('a place with no ambience configured changes the graph not at all', () => {
  // The default is silence, so every existing calibration -- and the still
  // path, which has no place at all -- is untouched by this feature existing.
  const { look } = loadLookProfile(base);
  const graph = buildAudioFilter(look, cfg);
  assert.ok(!graph.includes('[amb]'), 'no ambience chain');
  assert.match(graph, /amix=inputs=2:normalize=0,\s*aformat/,
    'the bus still mixes exactly the two machine layers');
});

test('ambience is a separate noise source and joins the bus', () => {
  const graph = withAmbience({ amplitude: 0.3 });
  assert.ok(graph.includes('[amb]'), 'the chain is emitted');
  assert.match(graph, /\[hiss\]\[capstan\]\[amb\]amix=inputs=3:normalize=0/,
    'and is mixed, with normalize=0 like every other amix here');
});

test('ambience does NOT share the hiss seed, which would make it louder hiss', () => {
  // Two `anoisesrc` on the same seed generate the SAME noise. Summed, that is
  // not two layers -- it is one layer 6 dB louder, perfectly correlated, and it
  // would sound like the hiss had simply been turned up. The bug would be
  // invisible in the graph and obvious only by ear.
  const graph = withAmbience({ amplitude: 0.3 });
  const seeds = [...graph.matchAll(/anoisesrc=[^,[]*seed=(-?\d+)/g)].map((m) => m[1]);
  assert.equal(seeds.length, 2, 'two noise sources');
  assert.notEqual(seeds[0], seeds[1], 'on different seeds');
});

test('the swell is optional, and off means absent rather than zero', () => {
  // `tremolo` refuses f below 0.1 with an ffmpeg error, so a swellHz of 0 must
  // not reach the graph as `tremolo=f=0` -- that is a failed render, not a
  // still bed.
  assert.ok(!withAmbience({ amplitude: 0.3, swellHz: 0 }).includes('tremolo=f=0'),
    'no zero-frequency tremolo anywhere');
  const swelling = withAmbience({ amplitude: 0.3, swellHz: 0.2, swellDepth: 0.7 });
  assert.match(swelling, /tremolo=f=0\.2:d=0\.7/, 'and a real one when asked for');
});

test('a room is optional too, and only the places that have one get it', () => {
  assert.ok(!withAmbience({ amplitude: 0.3, echoDelayMs: 0 }).includes('aecho'),
    'a beach is not a room');
  assert.match(withAmbience({ amplitude: 0.3, echoDelayMs: 180, echoDecay: 0.4 }),
    /aecho=[\d.]+:[\d.]+:180:0\.4/, 'a tiled swimming hall is');
});

test('every shipped place that names an ambience names a real path', () => {
  // `assertLookOverride` already refuses a path that is not in base.json, so
  // this asserts the other half: that the block exists to be overridden at all.
  assert.ok(base.audio.ambience, 'base.json carries an ambience block');
  assert.equal(base.audio.ambience.amplitude, 0, 'and it is silent by default');
});
