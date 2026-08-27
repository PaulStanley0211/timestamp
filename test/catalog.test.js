/**
 * The catalog, asserted without touching presets/.
 *
 * Almost every test here runs against an in-memory menu built from object
 * literals, because a fixtures directory is the standard way a validation suite
 * quietly stops validating: it drifts from the schema it is testing, someone
 * fixes the fixture rather than the code, and the test goes green while meaning
 * nothing. The exception is the last block, which loads the real presets/ --
 * that one is a shipping check, not a unit test, and it belongs here so that a
 * broken preset fails CI rather than a render.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCompatibility, getOutfit, getPlace, listCatalog, loadCatalog } from '../scripts/catalog/catalog.mjs';
import { PresetError } from '../scripts/catalog/schema.mjs';

/** Just enough of a LookProfile for the override paths used below to exist. */
const FAKE_BASE = { grade: { saturation: 0.8, cbRedMid: 0.05 }, tape: { grainStrength: 20 } };

const aPlace = (over = {}) => ({
  id: 'p1',
  label: 'Place one',
  climate: 'mild',
  timeOfDay: 'midday',
  prompt: {
    scene: 'a plain room with a wooden table against the wall',
    light: 'one bulb overhead and grey daylight from a small window',
    lens: 'wide and close, deep focus behind',
    framing: 'waist-up, three-quarters to the camera',
    eraProps: 'a wall clock with hands, a wired telephone, a folded newspaper',
  },
  negatives: ['smartphone'],
  motionHint: 'the curtain moves at the window',
  lookOverride: { tape: { grainStrength: 22 } },
  ...over,
});

const anOutfit = (over = {}) => ({
  id: 'o1',
  label: 'Outfit one',
  climate: ['mild'],
  wardrobe: 'a knitted wool cardigan in burgundy over a collared shirt',
  negatives: ['modern knitwear'],
  ...over,
});

/** A whole catalog with no filesystem behind it. `readImpl` and `listImpl` are
 *  injected exactly the way the CLI does not inject them. */
function fakeCatalog({ places, outfits, baseLook = FAKE_BASE } = {}) {
  const files = new Map();
  const add = (dir, entries) => {
    for (const preset of entries) files.set(`/repo/presets/${dir}/${preset.id}.json`, JSON.stringify(preset, null, 2));
  };
  add('places', places ?? [aPlace()]);
  add('outfits', outfits ?? [anOutfit()]);

  return loadCatalog({
    root: '/repo',
    baseLook,
    readImpl: (file) => {
      if (!files.has(file)) throw new Error(`fake fs: no such file ${file}`);
      return files.get(file);
    },
    listImpl: (dir) => [...files.keys()].filter((f) => f.startsWith(`${dir}/`)).map((f) => f.slice(dir.length + 1)),
  });
}

test('a catalog loads places and outfits into maps keyed by id', () => {
  const catalog = fakeCatalog({
    places: [aPlace(), aPlace({ id: 'p2', label: 'Place two' })],
    outfits: [anOutfit()],
  });
  assert.deepEqual([...catalog.places.keys()].sort(), ['p1', 'p2']);
  assert.deepEqual([...catalog.outfits.keys()], ['o1']);
  assert.deepEqual(catalog.count, { places: 2, outfits: 1, combinations: 2 });
});

test('the id comes from the filename, and a file that disagrees with its name is rejected', () => {
  // Two sources of truth for the id is one too many: the filename is what an
  // operator types on the command line and what a manifest records.
  assert.throws(
    () => loadCatalog({
      root: '/repo',
      baseLook: FAKE_BASE,
      readImpl: () => JSON.stringify({ ...aPlace(), id: 'something-else' }),
      listImpl: () => ['p1.json'],
    }),
    /declares id "something-else" but is named "p1"/,
  );
});

test('an empty preset directory is an error rather than an empty menu', () => {
  assert.throws(
    () => loadCatalog({ root: '/repo', baseLook: FAKE_BASE, readImpl: () => '{}', listImpl: () => [] }),
    /the catalog cannot be empty/,
  );
});

test('a lookup miss names every id that does exist', () => {
  const catalog = fakeCatalog({
    places: [aPlace(), aPlace({ id: 'p2' }), aPlace({ id: 'p3' })],
    outfits: [anOutfit()],
  });
  // The point of the message: an operator who mistyped an id should not have to
  // go and read a directory listing to find out what they meant.
  assert.throws(() => getPlace(catalog, 'p9'), (err) => {
    assert.ok(err instanceof PresetError);
    assert.match(err.message, /no place "p9"/);
    for (const id of ['p1', 'p2', 'p3']) assert.ok(err.message.includes(id), `message should name ${id}`);
    assert.deepEqual(err.detail.available, ['p1', 'p2', 'p3']);
    return true;
  });
  assert.throws(() => getOutfit(catalog, undefined), /no outfit "undefined".*o1/s);
  assert.equal(getPlace(catalog, 'p2').id, 'p2');
  assert.equal(getOutfit(catalog, 'o1').id, 'o1');
});

test('listCatalog returns only what a menu needs, sorted by id', () => {
  const catalog = fakeCatalog({
    places: [aPlace({ id: 'zzz' }), aPlace({ id: 'aaa' })],
    outfits: [anOutfit({ id: 'o2', climate: ['cold', 'cool'] }), anOutfit()],
  });
  const menu = listCatalog(catalog);
  assert.deepEqual(menu.places.map((p) => p.id), ['aaa', 'zzz']);
  assert.deepEqual(Object.keys(menu.places[0]), ['id', 'label', 'climate', 'timeOfDay']);
  assert.deepEqual(menu.outfits.map((o) => o.id), ['o1', 'o2']);
  assert.deepEqual(menu.outfits[1].climate, ['cold', 'cool']);
});

test('the hash is stable across loads and independent of directory order', () => {
  const a = fakeCatalog({ places: [aPlace(), aPlace({ id: 'p2' })], outfits: [anOutfit()] });
  const b = fakeCatalog({ places: [aPlace({ id: 'p2' }), aPlace()], outfits: [anOutfit()] });
  assert.equal(a.hash, b.hash, 'the hash must be a property of the menu, not of the enumeration order');
  assert.match(a.hash, /^[0-9a-f]{16}$/);
});

test('the hash changes when any preset byte changes, including a comment', () => {
  const base = fakeCatalog();
  const edited = fakeCatalog({ places: [aPlace({ motionHint: 'the curtain barely moves at the window' })] });
  assert.notEqual(base.hash, edited.hash);

  // A _comment is documentation, and two catalogs whose documentation differs
  // are not the same catalog -- the comment is how the next author decides what
  // a fragment means. A manifest that could not tell them apart would be
  // claiming a reproducibility it does not have.
  const commented = fakeCatalog({ places: [aPlace({ _comment: 'why this place exists' })] });
  assert.notEqual(base.hash, commented.hash, 'a documentation change is a catalog change');
});

test('the hash does not depend on line endings', () => {
  const preset = JSON.stringify(aPlace(), null, 2);
  const load = (text) => loadCatalog({
    root: '/repo',
    baseLook: FAKE_BASE,
    readImpl: (f) => (f.endsWith('p1.json') ? text : JSON.stringify(anOutfit(), null, 2)),
    listImpl: (dir) => (dir.endsWith('places') ? ['p1.json'] : ['o1.json']),
  }).hash;
  // git autocrlf would otherwise make the hash a property of the machine that
  // checked the repo out rather than of the menu.
  assert.equal(load(preset), load(preset.replace(/\n/g, '\r\n')));
});

test('a deliberately absurd pairing warns and is never refused', () => {
  const beach = aPlace({ id: 'beach', label: 'Baltic beach', climate: 'cold' });
  const dress = anOutfit({ id: 'dress', label: 'Summer dress', climate: ['warm', 'mild'] });
  const catalog = fakeCatalog({ places: [beach], outfits: [dress] });

  const result = checkCompatibility(getPlace(catalog, 'beach'), getOutfit(catalog, 'dress'));
  assert.equal(result.ok, false);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Summer dress.*warm\/mild.*Baltic beach.*cold/);
  assert.match(result.warnings[0], /not a refusal/);
});

test('one step apart is silent, because a checker that fires on a third of the menu is ignored', () => {
  const cold = aPlace({ climate: 'cold' });
  const cool = anOutfit({ climate: ['cool'] });
  assert.deepEqual(checkCompatibility(cold, cool), { ok: true, warnings: [] });

  // indoor sits at the same point on the scale as warm, because a heated German
  // interior does -- so an indoor cardigan indoors is silent and a padded
  // jacket indoors is not.
  const room = aPlace({ climate: 'indoor', label: 'A room' });
  assert.equal(checkCompatibility(room, anOutfit({ climate: ['indoor'] })).ok, true);
  assert.equal(checkCompatibility(room, anOutfit({ climate: ['cold', 'cool'] })).ok, false);
});

test('the shipped catalog loads, and every combination is composable', () => {
  const catalog = loadCatalog();
  assert.equal(catalog.count.places, 8);
  assert.equal(catalog.count.outfits, 6);
  assert.equal(catalog.count.combinations, 48);
  assert.match(catalog.hash, /^[0-9a-f]{16}$/);

  for (const place of catalog.places.values()) {
    for (const outfit of catalog.outfits.values()) {
      const { ok, warnings } = checkCompatibility(place, outfit);
      assert.equal(typeof ok, 'boolean');
      assert.ok(Array.isArray(warnings), 'checkCompatibility must never throw on a shipped pairing');
    }
  }
});

test('the tracksuit refuses the three-stripe mark, not just a logo', () => {
  // THIS IS A RISK CONTROL, NOT TASTE, which is why it is pinned rather than
  // left to whoever next tidies the preset.
  //
  // Measured twice, on two paid renders a fortnight apart: the wardrobe line
  // asks for TWO white stripes and seedream drew THREE both times. Three
  // stripes on a navy tracksuit is not a generic sportswear cue, it is adidas's
  // registered trade dress, and it is among the more aggressively enforced
  // marks in the EU -- which is exactly where every place in this catalog is
  // set. `large brand logo` does not catch it, because three stripes is not a
  // logo applied to the garment; it IS the garment.
  //
  // The product generates commercial images of real people wearing whatever
  // this line asks for, so the exposure is not hypothetical and not the user's.
  // Two stripes carries the period on its own -- that is the preset's own
  // comment, and it is why the number was two in the first place.
  const outfit = getOutfit(loadCatalog(), 'trainingsjacke');
  const negatives = outfit.negatives.join(' | ').toLowerCase();
  const wardrobe = outfit.wardrobe.toLowerCase();

  // ASKING FOR TWO WAS TRIED AND IT DOES NOT WORK. Three renders, three times
  // three stripes -- with the count written as "exactly two", the pair named
  // again on the leg, and two negatives aimed at three. Every one ignored.
  //
  // The pattern across those runs is that this model honours PRESENCE and
  // ignores COUNT: the crest came off, the jacket zipped, the collar and the
  // trousers arrived, all first time. So the fix is a garment with no number in
  // it. One stripe is a thing to draw or not draw, which is the instruction
  // seedream has never once disobeyed here.
  assert.match(wardrobe, /single broad white stripe/,
    'the wardrobe line stopped asking for one stripe');
  assert.doesNotMatch(wardrobe, /two|three|pair/,
    'the wardrobe line reintroduced a count, which is the thing the model overrides');
  assert.match(negatives, /three[- ]stripe/,
    'nothing in the tracksuit negatives pushes back on the three-stripe mark');
  assert.match(negatives, /parallel stripes/,
    'nothing guards against the sleeve becoming multi-striped again');

  // And the four that keep it in its decade must not be traded away for it.
  for (const guard of ['modern performance wear', 'technical fabric', 'sharply tailored cut']) {
    assert.ok(negatives.includes(guard), `the tracksuit lost its period guard: ${guard}`);
  }
});
