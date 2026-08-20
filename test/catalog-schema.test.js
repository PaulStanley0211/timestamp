/**
 * The schema, which is where the two prompt rules in CLAUDE.md stop being
 * documentation and start being enforcement.
 *
 * The rules are the kind a human obeys for about three weeks. What breaks them
 * is one adjective added at 11pm to a preset that was nearly right, and nobody
 * re-reads a JSON file they only touched one line of. So these tests are not
 * really about validation logic -- they are the mechanism by which "outfits do
 * not describe the weather" and "never ask the model for the look" remain true
 * in six months.
 *
 * Two of the blocks below deliberately duplicate work the loader already does.
 * The shipped-preset greps re-derive the answer from the raw files rather than
 * from loadCatalog, so that weakening the loader does not silently disarm the
 * ban -- if someone deletes a vocabulary group from schema.mjs, the loader
 * stops complaining and these still do.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BANNED, CLIMATES, PLACE_FRAGMENTS, PresetError, TIMES_OF_DAY,
  lookOverridePaths, scanText, validateOutfit, validatePlace,
} from '../scripts/catalog/schema.mjs';
import { loadLookProfile, mergeLook } from '../scripts/tapedeck/look.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/look/base.json'), 'utf8'));

const readPresets = (dir) => fs.readdirSync(path.join(ROOT, 'presets', dir))
  .filter((f) => f.endsWith('.json'))
  .map((file) => ({
    id: file.slice(0, -5),
    file: `presets/${dir}/${file}`,
    raw: JSON.parse(fs.readFileSync(path.join(ROOT, 'presets', dir, file), 'utf8')),
  }));

const PLACES = readPresets('places');
const OUTFITS = readPresets('outfits');

/** `over.prompt` is merged into the default fragments rather than replacing
 *  them, so a test can change one fragment without restating the other four. */
const aPlace = (over = {}) => ({
  id: 'p1',
  label: 'Place one',
  climate: 'mild',
  timeOfDay: 'midday',
  negatives: ['smartphone'],
  motionHint: 'the curtain moves at the window',
  lookOverride: {},
  ...over,
  prompt: {
    scene: 'a plain room with a wooden table against the wall',
    light: 'one bulb overhead and grey daylight from a small window',
    lens: 'wide and close, deep focus behind',
    framing: 'waist-up, three-quarters to the camera',
    eraProps: 'a wall clock with hands, a wired telephone, a folded newspaper',
    ...(over.prompt ?? {}),
  },
});

const anOutfit = (over = {}) => ({
  id: 'o1',
  label: 'Outfit one',
  climate: ['mild'],
  wardrobe: 'a knitted wool cardigan in burgundy over a collared shirt',
  negatives: ['modern knitwear'],
  ...over,
});

/** Every string a model could ever see, from one raw preset file.
 *  Documentation keys and the two closed enumerations are excluded -- see
 *  UNSCANNED in schema.mjs for why that exclusion is load-bearing rather than
 *  a convenience. */
function* promptStrings(value, at = '') {
  if (typeof value === 'string') { yield [at, value]; return; }
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) yield* promptStrings(v, `${at}[${i}]`);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('_') || k === 'lookOverride' || k === 'climate' || k === 'timeOfDay') continue;
      yield* promptStrings(v, at ? `${at}.${k}` : k);
    }
  }
}

// ---------------------------------------------------------------------------
// rule 3 -- never ask the model for the look
// ---------------------------------------------------------------------------

test('every shipped preset is free of look vocabulary', () => {
  const failures = [];
  for (const { file, raw } of [...PLACES, ...OUTFITS]) {
    for (const [at, text] of promptStrings(raw)) {
      for (const hit of scanText(text, ['look'])) failures.push(`${file} ${at}: "${hit.match}"`);
    }
  }
  assert.deepEqual(failures, [],
    'the look is applied deterministically in ffmpeg by scripts/tapedeck/. Asking a model for it buys a ' +
    'vague nostalgic mood that varies per generation and then fights the real chain.');
});

test('the words the brief names by hand are all rejected, in a place and in an outfit', () => {
  const named = ['VHS', 'grainy', 'vintage', 'film grain', 'camcorder footage', 'retro', 'old video', '8mm', 'lo-fi'];
  for (const word of named) {
    assert.throws(
      () => validatePlace(aPlace({ prompt: { scene: `a room, ${word}, with a table` } }), { id: 'p1' }),
      PresetError, `place should reject "${word}"`,
    );
    assert.throws(
      () => validateOutfit(anOutfit({ wardrobe: `a wool cardigan, ${word}` }), { id: 'o1' }),
      PresetError, `outfit should reject "${word}"`,
    );
  }
});

test('a negative is scanned too, because that is where the banned word gets hidden', () => {
  assert.throws(
    () => validatePlace(aPlace({ negatives: ['smartphone', 'film grain'] }), { id: 'p1' }),
    /negatives\[1\].*film grain/s,
  );
  assert.throws(
    () => validateOutfit(anOutfit({ negatives: ['a distressed finish'] }), { id: 'o1' }),
    /distressed/,
  );
});

test('era vocabulary that describes an object rather than the picture stays legal', () => {
  // The distinction the ban is actually drawing. "A CRT in the corner" is
  // content; "VHS" is texture. Get this wrong in either direction and the
  // schema either blocks good set dressing or lets the look through.
  const legal = [
    'a CRT television with a rounded screen in the corner',
    'a filter coffee machine with a glass jug on the counter',
    'four white plastic chairs faded by the sun',
    'net curtains gone yellow at the window',
    'an old Opel estate with a roof box',
  ];
  for (const scene of legal) {
    assert.doesNotThrow(() => validatePlace(aPlace({ prompt: { scene } }), { id: 'p1' }), `should allow: ${scene}`);
  }
});

// ---------------------------------------------------------------------------
// rule 2 -- outfits describe the body, places describe everything else
// ---------------------------------------------------------------------------

test('an outfit that describes the scene, the light or the weather is rejected at load', () => {
  const trespasses = [
    'a wool cardigan on an overcast day',
    'a wool cardigan in warm afternoon lighting',
    'a wool cardigan, backlit by the sun',
    'a wool cardigan worn in the kitchen',
    'a wool cardigan against a blurred background',
    'a wool cardigan, shot on a wide angle lens',
    'a wool cardigan in the evening',
  ];
  for (const wardrobe of trespasses) {
    assert.throws(
      () => validateOutfit(anOutfit({ wardrobe }), { id: 'o1' }),
      (err) => {
        assert.ok(err instanceof PresetError);
        assert.match(err.message, /only what is on the body/);
        return true;
      },
      `outfit should reject: ${wardrobe}`,
    );
  }
});

test('a place that dresses the person is rejected at load', () => {
  const trespasses = [
    'a kitchen, the person wearing a summer dress',
    'a garden with a folding table, a denim jacket over the chair',
    'a stairwell, a scarf hanging on the rail',
  ];
  for (const scene of trespasses) {
    assert.throws(
      () => validatePlace(aPlace({ prompt: { scene } }), { id: 'p1' }),
      /wardrobe belongs to the outfit/,
      `place should reject: ${scene}`,
    );
  }
});

test('the split is enforced one way only, so each half keeps its own vocabulary', () => {
  // A place MAY say kitchen, overcast, evening, lens. An outfit MAY say jacket,
  // collar, sleeve, hem. Enforcing both lists on both files would leave nothing
  // sayable at all, which is the obvious wrong fix for the obvious complaint.
  assert.doesNotThrow(() => validatePlace(aPlace({
    prompt: { scene: 'a tiled kitchen', light: 'flat overcast with no shadow', lens: 'a wide angle near the subject' },
  }), { id: 'p1' }));
  assert.doesNotThrow(() => validateOutfit(anOutfit({
    wardrobe: 'a quilted jacket with elasticated cuffs, the collar turned up over a knitted scarf',
  }), { id: 'o1' }));
});

test('every shipped outfit is free of scene vocabulary and every shipped place is free of wardrobe vocabulary', () => {
  const failures = [];
  for (const { file, raw } of OUTFITS) {
    for (const [at, text] of promptStrings(raw)) {
      for (const hit of scanText(text, ['scene'])) failures.push(`${file} ${at}: "${hit.match}"`);
    }
  }
  for (const { file, raw } of PLACES) {
    for (const [at, text] of promptStrings(raw)) {
      for (const hit of scanText(text, ['wardrobe'])) failures.push(`${file} ${at}: "${hit.match}"`);
    }
  }
  assert.deepEqual(failures, [],
    'the two fragments are concatenated into one prompt and a model has no notion of which clause outranks which');
});

// ---------------------------------------------------------------------------
// rule 1 -- no preset may describe the person either
// ---------------------------------------------------------------------------

test('no shipped preset describes the person', () => {
  const failures = [];
  for (const { file, raw } of [...PLACES, ...OUTFITS]) {
    for (const [at, text] of promptStrings(raw)) {
      for (const hit of scanText(text, ['person'])) failures.push(`${file} ${at}: "${hit.match}"`);
    }
  }
  assert.deepEqual(failures, [], 'the uploaded photo is the identity anchor; a preset never saw it');
});

test('a preset that describes the person is rejected in either kind', () => {
  assert.throws(() => validatePlace(aPlace({ prompt: { framing: 'waist-up, a tall woman at the table' } }), { id: 'p1' }), /person/);
  assert.throws(() => validateOutfit(anOutfit({ negatives: ['a slim tailored cut'] }), { id: 'o1' }), /person/);
});

// ---------------------------------------------------------------------------
// the matcher itself
// ---------------------------------------------------------------------------

test('word boundaries hold, so ordinary German set dressing is not a false positive', () => {
  // Every one of these would be rejected by a substring match, and every
  // rejection would be blamed on the preset rather than on the matcher.
  const innocent = [
    ['German suburb', 'person'],        // "man"
    ['four plastic chairs', 'person'],  // "hair"
    ['a hose reel', 'person'],          // "nose"
    ['a brick building', 'person'],     // "build"
    ['a packaged loaf', 'person'],      // "aged"
    ['a windbreaker', 'scene'],         // "wind"
    ['a cotton sundress', 'scene'],     // "sun"
    ['a nightgown', 'scene'],           // "night"
    ['stonewashed jeans', 'look'],      // "washed out"
    ['a wallet on the shelf', 'scene'], // "wall"
    ['visible seams', 'scene'],         // "sea"
  ];
  for (const [text, group] of innocent) {
    assert.deepEqual(scanText(text, [group]), [], `"${text}" must not trip the ${group} ban`);
  }
});

test('hyphenation and pluralisation do not get round a ban', () => {
  assert.equal(scanText('an old-school look', ['look']).length, 1);
  assert.equal(scanText('an old school look', ['look']).length, 1);
  assert.equal(scanText('visible grains of it', ['look'])[0].term, 'grain');
  assert.equal(scanText('two summer dresses', ['wardrobe'])[0].term, 'dress');
});

test('a scan reports every hit, so one CI run fixes the whole file', () => {
  const hits = scanText('a grainy vintage camcorder shot', ['look']);
  assert.ok(hits.length >= 3, `expected several hits, got ${JSON.stringify(hits)}`);
});

// ---------------------------------------------------------------------------
// closed vocabularies and required fields
// ---------------------------------------------------------------------------

test('climate and time-of-day are closed sets', () => {
  assert.throws(() => validatePlace(aPlace({ climate: 'temperate' }), { id: 'p1' }), /not one of/);
  assert.throws(() => validatePlace(aPlace({ timeOfDay: 'golden hour' }), { id: 'p1' }), /not one of/);
  assert.throws(() => validateOutfit(anOutfit({ climate: [] }), { id: 'o1' }), /non-empty array/);
  assert.throws(() => validateOutfit(anOutfit({ climate: ['balmy'] }), { id: 'o1' }), /non-empty array/);

  for (const { id, raw } of PLACES) {
    assert.ok(CLIMATES.includes(raw.climate), `${id} climate`);
    assert.ok(TIMES_OF_DAY.includes(raw.timeOfDay), `${id} timeOfDay`);
  }
  for (const { id, raw } of OUTFITS) {
    for (const c of raw.climate) assert.ok(CLIMATES.includes(c), `${id} climate ${c}`);
  }
});

test('a place carries all five prompt fragments and a motion hint', () => {
  for (const fragment of PLACE_FRAGMENTS) {
    const prompt = { ...aPlace().prompt };
    delete prompt[fragment];
    assert.throws(
      () => validatePlace({ ...aPlace(), prompt }, { id: 'p1' }),
      new RegExp(`missing a non-empty string field "${fragment}"`),
    );
  }
  assert.throws(() => validatePlace({ ...aPlace(), motionHint: '' }, { id: 'p1' }), /motionHint/);

  for (const { id, raw } of PLACES) {
    for (const fragment of PLACE_FRAGMENTS) {
      assert.ok(raw.prompt[fragment]?.trim(), `${id} is missing prompt.${fragment}`);
    }
    // Every place implies its own motion -- laundry on a line, traffic behind,
    // a water surface -- and the animate stage has nothing else to go on.
    assert.ok(raw.motionHint?.trim(), `${id} is missing motionHint`);
  }
});

test('a runaway fragment is rejected before a model silently drops half of it', () => {
  const long = new Array(120).fill('table').join(' ');
  assert.throws(() => validatePlace(aPlace({ prompt: { scene: long } }), { id: 'p1' }), /120 words/);
});

// ---------------------------------------------------------------------------
// the look override -- the half of a preset that talks to tapedeck
// ---------------------------------------------------------------------------

test('a lookOverride path that does not exist in base.json is rejected', () => {
  // The whole point. mergeLook is a schema-free deep merge, so a typo does not
  // throw -- it adds a key nothing reads, the render succeeds, the grain is
  // unchanged, and the author concludes the override "doesn't do much".
  assert.throws(
    () => validatePlace(aPlace({ lookOverride: { tape: { grainStrengh: 30 } } }), { id: 'p1', baseLook: base }),
    /tape\.grainStrengh/,
  );
  assert.throws(
    () => validatePlace(aPlace({ lookOverride: { colour: { warmth: 1 } } }), { id: 'p1', baseLook: base }),
    /colour\.warmth/,
  );
});

test('lookOverridePaths treats arrays as leaves, matching mergeLook', () => {
  assert.deepEqual(
    lookOverridePaths({ tape: { grainStrength: 1 }, transport: { tears: [{ start: 1 }] }, _comment: 'x' }).sort(),
    ['tape.grainStrength', 'transport.tears'],
  );
  // "these tears instead", never "these as well as the base ones".
  assert.deepEqual(mergeLook(base, { transport: { tears: [] } }).transport.tears, []);
});

test('every shipped place override names a real path and merges without being clamped', () => {
  for (const { id, raw } of PLACES) {
    const override = raw.lookOverride ?? {};
    for (const dotted of lookOverridePaths(override)) {
      const exists = dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), base);
      assert.notEqual(exists, undefined, `${id}: lookOverride path "${dotted}" does not exist in config/look/base.json`);
    }
    const { look, clamped } = loadLookProfile(base, override);
    assert.deepEqual(clamped, [], `${id}: lookOverride sits outside the CLAMPS in scripts/tapedeck/look.mjs`);
    for (const dotted of lookOverridePaths(override)) {
      const wanted = dotted.split('.').reduce((o, k) => o[k], override);
      const got = dotted.split('.').reduce((o, k) => o[k], look);
      assert.deepEqual(got, wanted, `${id}: ${dotted} did not survive the merge`);
    }
  }
});

test('the night interior really does ask for more grain and more amber than the overcast beach', () => {
  // Not a style assertion -- an assertion that the mechanism is wired up. If
  // every override merged to the same numbers, every one of them would be
  // decoration and nobody would notice for months.
  const night = loadLookProfile(base, PLACES.find((p) => p.id === 'wohnzimmer-abend').raw.lookOverride).look;
  const beach = loadLookProfile(base, PLACES.find((p) => p.id === 'ostsee-strand').raw.lookOverride).look;
  assert.ok(night.tape.grainStrength > beach.tape.grainStrength,
    'a CCD at full gain in a room lit by a television grains far harder than an overcast beach');
  assert.ok(night.grade.cbRedMid > beach.grade.cbRedMid, 'the night interior is the warmer of the two');
});

test('a documented lookOverride merges its values and not its documentation', () => {
  // Every shipped place documents its override in place, which only works
  // because mergeInto() drops `_` keys from the incoming object. (That base.json
  // keeps its own `_comment` is expected and is asserted in tapedeck-look.test.js.)
  const merged = mergeLook(base, { _comment: 'why', tape: { _comment: 'why', grainStrength: 30 } });
  assert.equal(merged.tape.grainStrength, 30);
  assert.equal(merged.tape._comment, base.tape._comment, 'an incoming _comment must not overwrite the base one');
  assert.equal(merged._comment, base._comment);
});

// ---------------------------------------------------------------------------
// the templates
// ---------------------------------------------------------------------------

test('both templates are working presets, not sketches', () => {
  // The documented starting point must be legal, or the first thing a new
  // author does is debug the example.
  const place = JSON.parse(fs.readFileSync(path.join(ROOT, 'presets/_template/place.json'), 'utf8'));
  const outfit = JSON.parse(fs.readFileSync(path.join(ROOT, 'presets/_template/outfit.json'), 'utf8'));
  assert.doesNotThrow(() => validatePlace(place, { id: place.id, baseLook: base }));
  assert.doesNotThrow(() => validateOutfit(outfit, { id: outfit.id }));
});

test('every field in a template is documented next to itself', () => {
  const documented = (obj, at, failures) => {
    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith('_')) continue;
      if (!(`_${key}` in obj)) failures.push(`${at}${key} has no _${key} documentation key`);
      if (value && typeof value === 'object' && !Array.isArray(value) && key !== 'lookOverride') {
        documented(value, `${at}${key}.`, failures);
      }
    }
    return failures;
  };
  for (const file of ['place', 'outfit']) {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, `presets/_template/${file}.json`), 'utf8'));
    assert.deepEqual(documented(raw, '', []), [], `presets/_template/${file}.json`);
  }
});

test('the ban lists are not silently empty', () => {
  // A refactor that renamed a group would otherwise turn every grep above into
  // a test that asserts nothing at all and passes forever.
  for (const [group, terms] of Object.entries(BANNED)) {
    assert.ok(terms.length > 10, `BANNED.${group} has collapsed to ${terms.length} terms`);
  }
});
