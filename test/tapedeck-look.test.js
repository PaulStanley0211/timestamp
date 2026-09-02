/**
 * The look, asserted without ffmpeg.
 *
 * There are two kinds of test here and the split is deliberate. The GOLDEN test
 * runs against a frozen fixture profile, so tuning config/look/base.json -- which
 * is expected to happen constantly -- never turns the suite red. The INVARIANT
 * tests run against the real base.json and assert the things that must be true
 * of any profile: the stages appear in the physical order of a camcorder's
 * signal path, the RGB/YUV domain boundary exists, and every source of
 * randomness is seeded. Those are what actually break the product when someone
 * reorders a chain to "clean it up".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVideoFilter, loadLookProfile, mergeLook, dropFrameExpr, get, set, CLAMPS } from '../scripts/tapedeck/look.mjs';
import { resolveAspect } from '../scripts/tapedeck/frame.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/render.json'), 'utf8'));
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/look/base.json'), 'utf8'));

/** A frozen, deliberately minimal profile. Nothing tunes this. */
const FIXTURE = {
  version: 1, seed: 1234, seed2: 99, audioSeed: 7,
  optics: {
    bloomThreshold: 0.7, bloomRadius: 10, bloomStrength: 0.4, bloomWarmth: 0.1,
    cornerSoftenAmount: 0.5, cornerSoftenSigma: 2, vignetteAngle: 'PI/12',
  },
  grade: {
    curveMaster: '0/0.05 1/0.95', curveRed: '0/0 1/1', curveBlue: '0/0 1/1',
    cbRedMid: 0.05, cbBlueMid: -0.05, cbRedShadow: 0, cbBlueShadow: 0,
    saturation: 0.8, contrast: 1, gamma: 1,
  },
  osd: { enabled: false },
  tape: { lumaSoftness: 1, chromaSmear: 8, chromaShiftR: 2, chromaShiftB: -1, grainStrength: 15 },
  transport: {
    jitterX: 2, jitterY: 1, headSwitchHeight: 12, headSwitchShift: -9, headSwitchNoise: 40,
    tears: [{ start: 4, end: 4.2, y: 150, h: 26, shift: -22 }],
    droppedFrames: [201, 202],
  },
  composite: { finalVignetteAngle: 'PI/20' },
};

const graphFor = (look, burnIn = []) => buildVideoFilter(look, cfg, { burnIn });

/** Split on a delimiter, ignoring any that sit inside single quotes. Filtergraph
 *  expressions are full of commas -- `between(t,4,4.2)` -- so a naive split
 *  bisects them and the failure looks like a product bug rather than a test bug. */
function splitOutsideQuotes(s, delimiter) {
  const parts = [];
  let buf = '';
  let quoted = false;
  for (const ch of s) {
    if (ch === "'") quoted = !quoted;
    if (ch === delimiter && !quoted) { parts.push(buf); buf = ''; continue; }
    buf += ch;
  }
  parts.push(buf);
  return parts;
}

/** The first filter of each chain, labels stripped -- the graph's ordered spine. */
const spineOf = (graph) => splitOutsideQuotes(graph, ';')
  .map((chain) => splitOutsideQuotes(chain.replace(/\[[^\]]+\]/g, ''), ',')[0])
  .filter(Boolean);

test('the fixture profile compiles to a stable filtergraph', () => {
  const graph = graphFor(FIXTURE);
  // Structural golden: the ordered spine of the graph. Asserting the exact full
  // string would break on every whitespace change for no extra safety.
  const spine = spineOf(graph);
  assert.deepEqual(spine, [
    'color=c=black:s=736x588:d=1:r=25',
    'fps=fps=25',
    "curves=all='0/0 0.7/0 1/1'",
    'blend=all_mode=screen:all_opacity=0.4',
    'gblur=sigma=2',
    'maskedmerge',
    'crop=w=720:h=26:x=0:y=150',
    'overlay=x=-22:y=150:enable=\'between(t,4,4.2)\'',
    'crop=w=720:h=12:x=0:y=564',
    'overlay=x=-9:y=564',
    'setsar=16/15',
    'color=c=0x0B0A09:s=1080x1920:r=25',
    'overlay=x=(W-w)/2:y=(H-h)/2:shortest=1',
  ]);
});

test('the grade runs in RGB and the tape stage runs in YUV', () => {
  const graph = graphFor(FIXTURE);
  const main = graph.split(';').find((c) => c.includes('maskedmerge'));

  // curves and colorbalance are RGB filters; ffmpeg auto-converts to rgb24 and
  // everything downstream inherits it unless we say otherwise. Without this pin
  // `gblur=planes=6` blurs blue and red rather than chroma, chromashift becomes
  // a no-op, and the overlay round-trips crush mean luma roughly five-fold.
  const pin = main.indexOf('format=yuv420p');
  assert.ok(pin > 0, 'the RGB->YUV domain boundary is missing after the grade');
  assert.ok(main.indexOf('eq=saturation') < pin, 'the boundary must come after the grade');
  assert.ok(pin < main.indexOf('planes=6'), 'the boundary must come before the chroma smear');
});

test('grain is applied at tape resolution, never after the upscale', () => {
  const graph = graphFor(FIXTURE);
  const noiseAt = graph.indexOf('noise=alls=15');
  const upscaleAt = graph.indexOf('scale=1080:810');
  assert.ok(noiseAt > 0 && upscaleAt > noiseAt,
    'grain must precede the 1080 upscale or it reads as a modern high-ISO sensor');
});

test('the date stamp is recorded before the tape degrades it', () => {
  const graph = graphFor({ ...FIXTURE, osd: { enabled: true } }, ["drawtext=text='X'"]);
  const stamp = graph.indexOf('drawtext');
  assert.ok(stamp > graph.indexOf('eq=saturation'), 'the stamp must come after the grade');
  assert.ok(stamp < graph.indexOf('planes=6'), 'the stamp must be degraded by the tape stage, not sit crisply on top');
});

test('every source of randomness is seeded', () => {
  const graph = graphFor(FIXTURE);
  for (const m of graph.matchAll(/noise=[^,;\]]*/g)) {
    assert.match(m[0], /all_seed=\d+/, `unseeded noise breaks reproducibility: ${m[0]}`);
  }
  assert.ok(!/localtime|strftime|gradients/.test(graph), 'no wall-clock or random-colour source may appear');
});

test('the head-switch band uses avgblur, because gblur is nondeterministic on short frames', () => {
  const graph = graphFor(FIXTURE);
  const hs = splitOutsideQuotes(graph, ';').find((c) => c.includes('crop=w=720:h=12'));
  assert.match(hs, /avgblur=/);
  // 'avgblur' contains the substring 'gblur', so anchor to a filter boundary.
  assert.ok(!/(^|,)gblur=/.test(hs), 'gblur on a 12-row strip produced six different outputs in six runs');
});

test('disabling the transport features removes their branches entirely', () => {
  const graph = graphFor({
    ...FIXTURE,
    transport: { ...FIXTURE.transport, tears: [], headSwitchHeight: 0 },
  });
  assert.match(graph, /split=1\[m\]/);
  assert.ok(!graph.includes('overlay=x=-9'), 'head-switch overlay should be gone');
});

test('dropped frames collapse into ranges', () => {
  assert.equal(dropFrameExpr([201, 202]), 'between(n,201,202)');
  assert.equal(dropFrameExpr([5]), 'eq(n,5)');
  assert.equal(dropFrameExpr([201, 202, 400]), 'between(n,201,202)+eq(n,400)');
  assert.equal(dropFrameExpr([400, 202, 201]), 'between(n,201,202)+eq(n,400)');
  assert.equal(dropFrameExpr([]), null);
  assert.equal(dropFrameExpr(undefined), null);
});

test('out-of-range values are clamped and reported rather than thrown', () => {
  const { look, clamped } = loadLookProfile(base, { tape: { grainStrength: 900 } });
  assert.equal(look.tape.grainStrength, CLAMPS['tape.grainStrength'][1]);
  assert.equal(clamped.length, 1);
  assert.equal(clamped[0].path, 'tape.grainStrength');
  assert.equal(clamped[0].from, 900);
});

test('overrides replace arrays instead of concatenating them', () => {
  const merged = mergeLook(FIXTURE, { transport: { tears: [] } });
  assert.deepEqual(merged.transport.tears, [], 'a preset saying "these tears" must not inherit the base ones');
  assert.equal(merged.transport.headSwitchHeight, 12, 'unrelated keys survive the merge');
});

test('documentation keys never leak into a merged profile', () => {
  const merged = mergeLook(FIXTURE, { _comment: 'nope', tape: { _comment: 'nope', grainStrength: 3 } });
  assert.ok(!('_comment' in merged));
  assert.ok(!('_comment' in merged.tape));
  assert.equal(merged.tape.grainStrength, 3);
});

test('dotted get and set address nested values', () => {
  const o = {};
  set(o, 'a.b.c', 5);
  assert.equal(get(o, 'a.b.c'), 5);
  assert.equal(get(o, 'a.missing.c'), undefined);
});

/**
 * The crop that squares the source must follow the SHAPE, not a literal.
 *
 * It was `4/3` hardcoded while only the `scale` target followed `cfg.tape`, so
 * every 16:9 and 9:16 render cropped its source to 4:3 and then let `scale`
 * stretch it back out. Measured against the raster fal actually returns, a 9:16
 * tape discarded 58% of the frame and stretched what was left 2.33x vertically,
 * and the customer paid the 4/3 shape premium for the privilege.
 *
 * NOTHING EXISTING COULD SEE IT. The golden and invariant tests above build the
 * graph for 4:3 only; every pipeline test runs the fixture, whose source is
 * 1024x768 -- itself 4:3, so the crop is a no-op there and only the (correct)
 * SAR squeeze remains. The end-to-end 9:16 check measured frames, duration,
 * LUFS and edge luma, and anamorphic distortion moves none of those.
 *
 * DISPLAY aspect, not pixel aspect: the source has square pixels and the 4:3
 * tape does not (SAR 16/15), so cropping on `width/height` would be 1.25 and
 * would break the one shape that was always right.
 */
test('the source crop follows the tape shape, in every shape', () => {
  const { look } = loadLookProfile(base);
  const profile = { ...look, osd: { ...look.osd, enabled: false } };

  // display aspect = (width * sar) / height, reduced
  const expected = {
    '4:3': [4, 3],     // 720 * 16/15 / 576 -- unchanged, which is the point
    '16:9': [16, 9],   // 1024 * 1/1  / 576
    '9:16': [9, 16],   // 576  * 1/1  / 1024
  };

  for (const [aspect, [w, h]] of Object.entries(expected)) {
    const acfg = resolveAspect(cfg, aspect);
    const graph = buildVideoFilter(profile, acfg, { burnIn: [] });
    assert.ok(
      graph.includes(`crop=w='min(iw,ih*${w}/${h})':h='min(ih,iw*${h}/${w})'`),
      `${aspect}: the crop must square the source to ${w}:${h}, not to a hardcoded 4:3. ` +
      `Graph carried: ${graph.match(/crop=[^,]+,[^,]+/)?.[0] ?? '(no crop)'}`,
    );
  }
});

/** The shapes must not all crop the same way -- the assertion above would pass
 *  vacuously if `resolveAspect` ever stopped varying the tape block. */
test('the three shapes really do produce three different crops', () => {
  const { look } = loadLookProfile(base);
  const profile = { ...look, osd: { ...look.osd, enabled: false } };
  const crops = new Set(
    ['4:3', '16:9', '9:16'].map((a) => (
      buildVideoFilter(profile, resolveAspect(cfg, a), { burnIn: [] }).match(/crop=[^,]+,[^,]+/)?.[0]
    )),
  );
  assert.equal(crops.size, 3, 'each shape needs its own crop expression');
});

test('the shipped base profile satisfies every invariant', () => {
  const { look, clamped } = loadLookProfile(base);
  assert.deepEqual(clamped, [], 'base.json should never ship values outside their own clamp ranges');
  const graph = buildVideoFilter({ ...look, osd: { ...look.osd, enabled: false } }, cfg, { burnIn: [] });
  assert.match(graph, /format=yuv420p,(drawtext|gblur=sigma=[\d.]+:planes=1|gblur=sigma=[\d.]+:sigmaV=0)/);
  assert.match(graph, new RegExp(`all_seed=${look.seed}`));
  assert.match(graph, /\[vout\]$/);
});
