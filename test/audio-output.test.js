/**
 * The bed, with ffmpeg actually running.
 *
 * On by default rather than behind a flag, for the same reason as
 * test/ffmpeg-output.test.js: ffmpeg is local and free, and there is no argument
 * for making the only tests that touch real samples opt-in. If ffmpeg is missing
 * the suite skips honestly, because "you do not have ffmpeg" and "the bed is
 * broken" are different problems and must not produce the same red line.
 *
 * These tests assert four things that the golden-string tests structurally
 * cannot, and each one is a defect that ships silently:
 *
 *   THE LEVEL. The bed is synthesised precisely so its loudness is knowable in
 *   advance, which is what lets the render use fixed gains and skip loudnorm
 *   entirely. That argument is only worth anything if somebody checks the number
 *   -- so ebur128 runs HERE, asserting -27 LUFS, and nowhere in the render path
 *   reaching for it. -27 is thirteen decibels below what platforms normalise to.
 *   It is meant to be room tone under whatever else is happening, and "quiet" in
 *   "warm, grainy, quiet" is a spec with a number, not an adjective.
 *
 *   THE SHAPE. Exactly one audio stream, mono, 48 kHz, and exactly 375 video
 *   frames still. That last one is the interesting half: an audio stream that
 *   runs even slightly long changes the container duration, and 375 frames at
 *   25fps being exactly 15.000s is the assertion the entire PAL decision was
 *   made to buy.
 *
 *   THE ISOLATION. A generation model emits its own audio by default, and if it
 *   ever reaches the mux the video has two ambiences arguing. The bed graph has
 *   no input pads and the render maps `[vout]` and `[aout]` by name, so input
 *   audio is excluded structurally rather than by an `-an` somebody can delete.
 *   Proving that needs a source that is genuinely screaming, and the test below
 *   asserts the source really is loud before concluding anything from silence --
 *   otherwise the day the fixture goes quiet, the test passes for the wrong
 *   reason and keeps passing.
 *
 *   THE PURITY, FIVE TIMES. Not two. The gblur-on-short-frames bug passed a
 *   two-run check and then failed six times out of six; a slice-threaded filter
 *   is perfectly capable of agreeing with itself twice. anoisesrc adds a second
 *   way to lose reproducibility -- its seed defaults to -1, which is random --
 *   and that failure looks identical from the outside.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFfmpeg, runFfprobe, findFfmpeg, probe, REPO_ROOT } from '../scripts/ffmpeg/run.mjs';
import { assertDeliveryContract } from '../scripts/ffmpeg/assert.mjs';
import { deliveryGeometry, tapeGeometry } from '../scripts/tapedeck/frame.mjs';
import { loadLookProfile, buildVideoFilter } from '../scripts/tapedeck/look.mjs';
import { burnInFilters } from '../scripts/tapedeck/burn-in.mjs';
import { buildAudioFilter, clampAudio } from '../scripts/audio/bed.mjs';
import {
  muxedArgs, bedLoudnessArgs, fileLoudnessArgs, bedHashArgs, muxedHashArgs,
  parseIntegratedLufs, lufsVerdict,
} from '../scripts/audio/mix.mjs';
import { resolveFont } from '../scripts/preflight/doctor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/render.json'), 'utf8'));
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/look/base.json'), 'utf8'));
const delivery = deliveryGeometry(cfg);
const tape = tapeGeometry(cfg);

async function haveFfmpeg() {
  try {
    await runFfmpeg(['-hide_banner', '-version']);
    return true;
  } catch {
    return false;
  }
}

const HAVE = await haveFfmpeg();
const skip = HAVE ? false : `ffmpeg not found (${findFfmpeg().ffmpeg}) -- audio tests skipped`;

// THE PID IS NOT DECORATION: it is what stops a second concurrent
// `node --test` on this checkout from writing these same fixed filenames.
// Inside one run nothing here collides -- across two runs every mp4 below is
// the same path, and the reader gets a file truncated mid-write, which is
// reported as a decode failure against whichever test was reading.
// `test/ffmpeg-output.test.js` carries the full account at the same line;
// the precedent is `c897845` and the tmp name in `scripts/auth/accounts.mjs`.
const outDir = path.join(REPO_ROOT, 'build', 'test', String(process.pid));
if (HAVE) fs.mkdirSync(outDir, { recursive: true });

const SOURCE = { lavfi: `testsrc2=size=1280x720:rate=${cfg.fps}:duration=${cfg.durationSeconds}` };

const font = resolveFont();
const osd = { ...base.osd, enabled: Boolean(font.path), fontRelPath: font.path ?? base.osd.fontRelPath };

/** The shipped profile, clamped exactly the way the CLI clamps it. */
function profile() {
  const { look } = loadLookProfile(base);
  clampAudio(look);
  return look;
}

function graphs(overrideCfg = cfg) {
  const look = profile();
  return {
    look,
    videoFilter: buildVideoFilter({ ...look, osd }, overrideCfg, { burnIn: burnInFilters(osd, { tape, delivery }) }),
    audioFilter: buildAudioFilter(look, overrideCfg),
  };
}

/** One full-length muxed render, shared. Rendering it per-test would triple the
 *  wall time of the suite for no additional coverage. */
let rendered = null;
async function fullRender() {
  if (rendered) return rendered;
  const { videoFilter, audioFilter } = graphs();
  const output = path.join(outDir, 'audio-contract.mp4');
  await runFfmpeg(muxedArgs({ input: SOURCE, output, videoFilter, audioFilter, cfg }));
  rendered = output;
  return output;
}

/**
 * A source that is genuinely shouting, standing in for a generation model that
 * returned its own audio.
 *
 * `volume=8` is not decoration. ffmpeg's `sine` has no amplitude option and does
 * NOT emit full scale -- it writes s16 at a fixed 4096/32768, so its intrinsic
 * peak is 0.125, or -18 dBFS, and a bare `sine` measures -21 LUFS. That is
 * quiet enough that a leak might land inside the +/-2 LU window and pass. Times
 * eight it is full scale and about -3 LUFS, which no window forgives.
 */
let noisySource = null;
async function noisySourceFile() {
  if (noisySource) return noisySource;
  const file = path.join(outDir, 'audio-noisy-source.mp4');
  await runFfmpeg([
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=${cfg.fps}:duration=${cfg.durationSeconds}`,
    '-f', 'lavfi', '-i', `sine=f=1000:r=48000:d=${cfg.durationSeconds},volume=8`,
    '-c:v', 'libx264', '-pix_fmt', cfg.encode.pixFmt, '-crf', '18', '-preset', 'veryfast',
    '-c:a', 'aac', '-b:a', '192k', '-shortest',
    file,
  ]);
  noisySource = file;
  return file;
}

async function measureFile(file) {
  const { stderr } = await runFfmpeg(fileLoudnessArgs({ input: file }));
  return parseIntegratedLufs(stderr);
}

const hashesOf = (stdout) => stdout.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
const audioHashes = (stdout) => hashesOf(stdout).filter((l) => l.startsWith('1,'));

test('the muxed output carries exactly one mono 48 kHz audio stream', { skip }, async () => {
  const file = await fullRender();
  const info = await assertDeliveryContract(file, cfg, { expectAudio: true });

  const audio = info.streams.filter((s) => s.codec_type === 'audio');
  assert.equal(audio.length, 1, `expected exactly 1 audio stream, got ${audio.length}`);
  assert.equal(audio[0].channels, 1);
  assert.equal(Number(audio[0].sample_rate), 48000);
  assert.equal(audio[0].codec_name, 'aac');
});

test('the finished file carries AI-provenance tags a scanner can read back', { skip }, async () => {
  // The argv test in audio-bed.test.js proves the flags are SENT; this proves
  // the mp4 muxer actually kept them under keys ffprobe reports -- mov drops
  // metadata keys it does not map, silently, so sending is not shipping.
  const file = await fullRender();
  const { stdout } = await runFfprobe([
    '-v', 'error', '-show_entries', 'format_tags', '-of', 'json', file,
  ]);
  const raw = JSON.parse(stdout).format?.tags ?? {};
  const tags = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
  assert.match(tags.comment ?? '', /AI-generated/,
    `the delivered file must carry the human-readable disclosure; format tags were ${JSON.stringify(raw)}`);
  assert.match(tags.description ?? '', /trainedAlgorithmicMedia/,
    'the delivered file must carry the machine-readable digital-source-type marker');
});

test('adding the bed does not move a single video frame', { skip }, async () => {
  const info = await probe(await fullRender(), { countFrames: true });
  const video = info.streams.find((s) => s.codec_type === 'video');
  // The assertion PAL was chosen for, restated here because audio is a new way
  // to lose it: an audio stream that runs long stretches the container.
  assert.equal(Number(video.nb_read_frames), 375);
  assert.equal(Number(video.nb_read_frames) / cfg.fps, 15);
  assert.ok(Math.abs(Number(info.format.duration) - 15) < 0.05,
    `container duration ${info.format.duration}s drifted from 15.000s`);
});

test('the bed is quiet: -27 LUFS integrated, before and after the encoder', { skip }, async () => {
  const { look, audioFilter } = graphs();

  // Straight out of the graph, with no encode and no file involved. This is the
  // number base.json is calibrated against.
  const { stderr } = await runFfmpeg(bedLoudnessArgs({ audioFilter, cfg }));
  const bed = parseIntegratedLufs(stderr);
  const bedVerdict = lufsVerdict(bed, look.audio);
  assert.ok(bedVerdict.ok, `synthesised bed: ${bedVerdict.message}`);
  assert.ok(bed >= -29 && bed <= -25, `bed integrated loudness ${bed} LUFS is outside [-29, -25]`);

  // And again through AAC at 128k mono, which is what actually ships.
  const shipped = await measureFile(await fullRender());
  assert.ok(shipped >= -29 && shipped <= -25,
    `delivered audio ${shipped} LUFS is outside [-29, -25]`);
  assert.ok(Math.abs(shipped - bed) < 1,
    `the encoder moved the level by ${(shipped - bed).toFixed(2)} LU, which it should not`);
});

test('the model\'s own audio never reaches the output', { skip }, async () => {
  const noisy = await noisySourceFile();

  // Guard against a vacuous pass first. If the fixture ever stops being loud,
  // every assertion below still passes and proves nothing.
  const sourceLufs = await measureFile(noisy);
  assert.ok(sourceLufs > -8,
    `the fixture source measures ${sourceLufs} LUFS -- it is not loud enough for its absence to prove anything`);

  const { videoFilter, audioFilter } = graphs();
  const from = async (input) => audioHashes(
    (await runFfmpeg(muxedHashArgs({ input, videoFilter, audioFilter, cfg }))).stdout,
  );

  const clean = await from(SOURCE);
  const loud = await from({ file: noisy });
  assert.ok(clean.length > 0, 'the audio stream should have produced hashes');
  assert.deepEqual(loud, clean,
    'the bed differs depending on the source, so input audio is reaching it -- ' +
    'check that the graph has no [0:a] pad and that the render maps [vout] and [aout] by name');

  // And the same source through the real render path: one audio stream, still
  // at bed level rather than at tone level. Two seconds is plenty for an
  // integrated measurement of steady-state hiss.
  const shortCfg = { ...cfg, totalFrames: cfg.fps * 2, durationSeconds: 2 };
  const short = graphs(shortCfg);
  const output = path.join(outDir, 'audio-from-noisy-source.mp4');
  await runFfmpeg(muxedArgs({
    input: { file: noisy }, output, videoFilter: short.videoFilter, audioFilter: short.audioFilter, cfg: shortCfg,
  }));

  const info = await probe(output);
  assert.equal(info.streams.filter((s) => s.codec_type === 'audio').length, 1);
  const lufs = await measureFile(output);
  assert.ok(lufs >= -29 && lufs <= -25,
    `rendering from a ${sourceLufs} LUFS source produced ${lufs} LUFS -- the source audio leaked into the mix`);
});

test('the muxed render is bit-identical across five runs (purity)', { skip }, async () => {
  // Five, not two. A slice-threaded filter is perfectly capable of agreeing with
  // itself twice: the gblur-on-short-frames bug passed a two-run check and then
  // failed six out of six. Both streams are hashed, because joining the graphs
  // puts the picture into a scheduler it was not sharing before.
  const { videoFilter, audioFilter } = graphs();
  const runs = [];
  for (let i = 0; i < 5; i += 1) {
    const { stdout } = await runFfmpeg(muxedHashArgs({ input: SOURCE, videoFilter, audioFilter, cfg }));
    const lines = hashesOf(stdout);
    assert.ok(lines.some((l) => l.startsWith('0,')) && lines.some((l) => l.startsWith('1,')),
      'both streams must be present in the hash, or the check only covers half the render');
    runs.push(lines.join('\n'));
  }
  const unique = new Set(runs);
  assert.equal(unique.size, 1,
    `${unique.size} distinct outputs across 5 runs -- something is nondeterministic. ` +
    'Suspect an anoisesrc that lost its seed, a slice-threaded filter on a short frame, or a wall-clock read.');
});

test('the bed is identical regardless of filter thread count', { skip }, async () => {
  // The video graph already has this test. The bed is new surface and gets its
  // own, cheaply: -filter_complex_threads 1 is the repo-wide safety net and a
  // test that only passes because of it hides which filter actually needs it.
  const { audioFilter } = graphs();
  const hashes = [];
  for (const threads of ['1', '2', '4', '8']) {
    const { stdout } = await runFfmpeg(bedHashArgs({
      audioFilter, cfg: { ...cfg, encode: { ...cfg.encode, filterComplexThreads: threads } },
    }));
    hashes.push(hashesOf(stdout).join('\n'));
  }
  assert.equal(new Set(hashes).size, 1, 'thread count must not change the bed');
});

test('a changed audioSeed changes the bed, and only the bed', { skip }, async () => {
  // The other half of "seeded": a seed nothing responds to is decoration, and a
  // graph that ignores it would pass every purity check in this file.
  const { audioFilter } = graphs();
  const look = profile();
  const other = buildAudioFilter({ ...look, audioSeed: look.audioSeed + 1 }, cfg);

  const hash = async (filter) => hashesOf((await runFfmpeg(bedHashArgs({ audioFilter: filter, cfg }))).stdout).join('\n');
  assert.notEqual(await hash(other), await hash(audioFilter), 'audioSeed does not reach the noise source');

  const lufs = parseIntegratedLufs((await runFfmpeg(bedLoudnessArgs({ audioFilter: other, cfg }))).stderr);
  assert.ok(lufs >= -29 && lufs <= -25, `a different seed changed the level to ${lufs} LUFS; it should only change the noise`);
});

test('without --with-audio the output has no audio stream at all', { skip }, async () => {
  // Not a silent track: none. `muxedArgs` with no bed must fall through to the
  // -an that gradeArgs has always defaulted to, so the M1 contract is unchanged
  // by M2 existing.
  const shortCfg = { ...cfg, totalFrames: cfg.fps, durationSeconds: 1 };
  const { videoFilter } = graphs(shortCfg);
  const output = path.join(outDir, 'audio-absent.mp4');
  await runFfmpeg(muxedArgs({ input: SOURCE, output, videoFilter, cfg: shortCfg }));

  const info = await probe(output);
  assert.equal(info.streams.filter((s) => s.codec_type === 'audio').length, 0);
});

// ---------------------------------------------------------------------------
// the two cheap wins -- a fluorescent buzz, a kitchen clock tick
//
// The golden-string tests in test/audio-bed.test.js prove the SHAPE of the two
// new tones; this proves the NUMBER, the same division of labour section 20
// already drew for ambience. "Quiet" is a spec with a figure attached to it,
// not an adjective, so the only real proof that a tone "sits in the bed" is
// ebur128 measuring the WHOLE thing -- hiss, capstan, ambience noise and tone
// together -- and finding it still where the output contract says it must be.
// ---------------------------------------------------------------------------

function withPlaceOverride(id) {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'presets/places', `${id}.json`), 'utf8'));
  const { look } = loadLookProfile(base, raw.lookOverride);
  clampAudio(look);
  return buildAudioFilter(look, cfg);
}

test('every shipped place, ambience and all, is inside the loudness contract', { skip }, async () => {
  // Section 20 measured each place's bed by hand when ambience landed (-26.4
  // to -27.1 LUFS across the menu) and never pinned it; the one per-place
  // loudness test was the stairwell's buzz, and the stairwell was retired on
  // 2026-09-04. This is the general form: a place added tomorrow with an
  // ambience block loud enough to break "quiet" fails here rather than on a
  // customer's tape. Read from the preset files, so it cannot go vacuous when
  // the menu changes.
  const dir = path.join(ROOT, 'presets/places');
  const ids = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length));
  assert.ok(ids.length >= 7, `expected the shipped menu, found ${ids.length} place(s)`);
  for (const id of ids) {
    const audioFilter = withPlaceOverride(id);
    // Two noise sources: the hiss, and the place's own ambience. A preset with
    // no ambience block would measure the bare bed, which is the number the
    // base profile already proves, and this test would be saying nothing.
    assert.ok((audioFilter.match(/anoisesrc/g) ?? []).length >= 2,
      `${id}: this test proves nothing if the place's ambience never made it into the graph`);
    const lufs = parseIntegratedLufs((await runFfmpeg(bedLoudnessArgs({ audioFilter, cfg }))).stderr);
    assert.ok(lufs >= -29 && lufs <= -25,
      `the ${id} bed measured ${lufs} LUFS, outside [-29, -25]`);
  }
});

test('the kitchen preset, clock tick and all, is still inside the loudness contract', { skip }, async () => {
  const audioFilter = withPlaceOverride('kuechentisch-fruehstueck');
  assert.ok(audioFilter.includes('[tone]'), 'this test proves nothing if the tick never made it into the graph');
  const lufs = parseIntegratedLufs((await runFfmpeg(bedLoudnessArgs({ audioFilter, cfg }))).stderr);
  assert.ok(lufs >= -29 && lufs <= -25,
    `the kitchen bed with its clock tick measured ${lufs} LUFS, outside [-29, -25]`);
});

test('the clock tick is heard as a click train, not as a second layer of hiss', { skip }, async () => {
  // The tick's whole point is silence between beats. If it measured anywhere
  // near the bed's own level it would not read as a clock, it would read as a
  // second, slightly different, hiss -- so its OWN loudness, isolated from
  // hiss and capstan, has to sit well under the bed's -27 LUFS floor even
  // though its instantaneous peak (2% duty cycle) is much louder than that.
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'presets/places/kuechentisch-fruehstueck.json'), 'utf8'));
  const { look } = loadLookProfile(base, raw.lookOverride);
  clampAudio(look);
  // hiss.amplitude 0 leaves the [hiss] chain in the graph but genuinely silent
  // (anoisesrc at amplitude 0 emits nothing); capstan.tones=[] and
  // ambience.amplitude 0 omit their chains entirely, the same way a place with
  // neither configured already does. What is left contributing anything at all
  // is the tick.
  const toneOnly = buildAudioFilter(
    {
      ...look,
      audio: {
        ...look.audio,
        hiss: { ...look.audio.hiss, amplitude: 0 },
        capstan: { ...look.audio.capstan, tones: [] },
        ambience: { ...look.audio.ambience, amplitude: 0 },
      },
    },
    cfg,
  );
  const lufs = parseIntegratedLufs((await runFfmpeg(bedLoudnessArgs({ audioFilter: toneOnly, cfg }))).stderr);
  assert.ok(lufs < -32, `the tick alone measured ${lufs} LUFS -- too loud to sit quietly under the bed`);
});
