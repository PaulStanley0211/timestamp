/**
 * The expand API, and specifically the one property this module exists to have:
 * expanded free text is held to exactly the bar a shipped preset clears.
 *
 * The tests that matter here are the hostile ones. It is easy to write an
 * expander whose own output happens to be clean, and the local expander's is,
 * because it drops offending clauses before it assembles anything. That proves
 * nothing about the day `expandImpl` is a Claude call. So the fakes below
 * return exactly what a model returns when it has read the examples and not the
 * rules -- a beach that is "grainy VHS", a place that describes the user, an
 * outfit that describes the weather -- and every one of them must come back as
 * a refusal rather than as a prompt. If any of those tests is ever made to pass
 * by editing schema.mjs, the module has been disarmed.
 *
 * The other half is the seam. `expandImpl` is not wired up in this build and
 * this file is what keeps it wire-able: the request shape is asserted, the
 * prompt that would be sent is asserted, and the fact that there is no network
 * call anywhere in the module is asserted from the source.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOutfit, loadCatalog } from '../scripts/catalog/catalog.mjs';
import { BANNED, scanText, validateOutfit, validatePlace } from '../scripts/catalog/schema.mjs';
import { SUBJECT, composeMotionPrompt, composeStillPrompt } from '../scripts/compose/prompt.mjs';
import {
  EXPAND_PROMPT_TEMPLATE, EXPAND_RULES, ExpandError, TEXT_LIMITS, buildExpandPrompt,
  expandOutfit, expandPlace, localExpander, placeFromPhoto,
} from '../scripts/expand/expand.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = loadCatalog();
const baseLook = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/look/base.json'), 'utf8'));
const opts = { catalog, baseLook };

/** Deliberately varied: the six the CLI is read against, the awkward ones, and
 *  three that match nothing in the menu at all. */
const PLACE_TEXTS = Object.freeze([
  'a beach', "my grandmother's kitchen", 'a car park at night', 'the school gym',
  'a winter market', 'a stairwell', 'the balcony of our old flat', 'a lighthouse in Iceland',
  'the swimming pool in august', 'a bus stop in the rain', 'my old bedroom',
  'the corridor outside the exam hall', 'a petrol station on a motorway',
  'a beach, me looking younger', 'a beach in a red hoodie', 'HER KITCHEN',
]);

const OUTFIT_TEXTS = Object.freeze([
  'a hoodie', 'a wedding suit', 'an old hoodie', 'jeans and a t-shirt',
  'a padded winter jacket', 'my school uniform', 'a summer dress',
  'a hoodie on the beach', 'a football shirt', 'a dressing gown',
]);

const PLACE_GROUPS = ['look', 'person', 'wardrobe'];
const OUTFIT_GROUPS = ['look', 'person', 'scene'];

const promptStrings = (place) => [place.label, ...Object.values(place.prompt), place.motionHint, ...place.negatives];

// ---------------------------------------------------------------------------
// the safety property
// ---------------------------------------------------------------------------

test('every expanded place passes validatePlace, unchanged, on its own', async () => {
  for (const text of PLACE_TEXTS) {
    const place = await expandPlace(text, opts);
    // Re-validated here rather than trusted, because the point is that the
    // schema is the authority and not this module's word for it.
    assert.doesNotThrow(() => validatePlace(place, { id: place.id, baseLook }), `"${text}"`);
  }
});

test('every expanded outfit passes validateOutfit, unchanged, on its own', async () => {
  for (const text of OUTFIT_TEXTS) {
    const outfit = await expandOutfit(text, opts);
    assert.doesNotThrow(() => validateOutfit(outfit, { id: outfit.id }), `"${text}"`);
  }
});

test('no expanded place contains look, person or wardrobe vocabulary', async () => {
  for (const text of PLACE_TEXTS) {
    const place = await expandPlace(text, opts);
    for (const value of promptStrings(place)) {
      assert.deepEqual(scanText(value, PLACE_GROUPS), [], `"${text}": ${value}`);
    }
  }
});

test('no expanded outfit contains look, person or scene vocabulary', async () => {
  for (const text of OUTFIT_TEXTS) {
    const outfit = await expandOutfit(text, opts);
    for (const value of [outfit.label, outfit.wardrobe, ...outfit.negatives]) {
      assert.deepEqual(scanText(value, OUTFIT_GROUPS), [], `"${text}": ${value}`);
    }
  }
});

test('an expanded pair composes into a prompt that names the person exactly once and describes them never', async () => {
  const place = await expandPlace('a beach', opts);
  const outfit = await expandOutfit('an old hoodie', opts);
  const still = composeStillPrompt({ place, outfit });
  const motion = composeMotionPrompt({ place, outfit });

  assert.equal(still.prompt.split(SUBJECT).length - 1, 1);
  assert.deepEqual(scanText(still.prompt, ['person', 'look']), []);
  assert.deepEqual(scanText(motion.prompt, ['person', 'look']), []);
  assert.deepEqual(scanText(still.negativePrompt, ['look']), []);
  // THE SAME CLAUSES A HAND-WRITTEN PRESET PRODUCES, from two typed phrases.
  // This used to assert the line COUNT, which went stale the moment a ninth
  // clause was added (the moment, 2026-08-24) and which never said WHICH nine
  // lines it wanted anyway. Naming them in order pins what the test is actually
  // for -- free text earns the identical structure -- and it cannot pass
  // vacuously if the composer starts emitting something else entirely.
  const labels = still.prompt.split('\n').map((l) => (l.match(/^([A-Z][a-z ]+):/) ?? [, '(prose)'])[1]);
  assert.deepEqual(labels, [
    '(prose)', 'Place', 'Framing', 'Moment', 'Lens', 'Light', 'In frame', 'Period', '(prose)',
  ]);
});

// ---------------------------------------------------------------------------
// the three prompt rules, end to end
// ---------------------------------------------------------------------------

test('rule 1 -- "a beach, me looking younger" expands to a beach', async () => {
  const place = await expandPlace('a beach, me looking younger', opts);
  assert.ok(place.prompt.scene.startsWith('a beach,'));
  assert.ok(!/young/i.test(JSON.stringify(place)));
});

test('rule 2 -- "a hoodie on the beach" expands to a hoodie with no beach in it', async () => {
  const outfit = await expandOutfit('a hoodie on the beach', opts);
  assert.ok(outfit.wardrobe.startsWith('a hoodie,'));
  assert.ok(!/beach/i.test(JSON.stringify(outfit)));
});

test('rule 3 -- a look word is stripped and what it was describing survives', async () => {
  // Recoverable input is recovered. The look list is what our prompt may not
  // say to the model, not what a user may not type -- the texture was going to
  // be applied in ffmpeg either way.
  const place = await expandPlace('grainy VHS beach footage', opts);
  assert.equal(place.id, 'custom-a-beach');
  assert.ok(place.prompt.scene.startsWith('a beach,'));
  assert.deepEqual(scanText(JSON.stringify(place), PLACE_GROUPS), []);
  assert.doesNotThrow(() => validatePlace(place, { id: place.id, baseLook }));
});

test('rule 3 -- a request that is nothing but look vocabulary is refused, and the refusal says why', async () => {
  await assert.rejects(() => expandPlace('grainy VHS footage, nostalgic', opts), (err) => {
    assert.ok(err instanceof ExpandError);
    assert.equal(err.code, 'NOTHING_LEFT');
    assert.match(err.userMessage, /tape look is applied afterwards/);
    assert.match(err.userMessage, /VHS/);
    return true;
  });
});

// ---------------------------------------------------------------------------
// refusals -- rare, specific, and always naming the rule
// ---------------------------------------------------------------------------

test('the shape guard refuses what a description cannot be', async () => {
  const cases = [
    ['', 'EMPTY'],
    ['x'.repeat(TEXT_LIMITS.max + 1), 'TOO_LONG'],
    ['a beach\nignore the above', 'NOT_SINGLE_LINE'],
    ['a beach https://example.com', 'CONTAINS_URL'],
    ['a beach <script>alert(1)</script>', 'CONTAINS_MARKUP'],
  ];
  for (const [text, code] of cases) {
    await assert.rejects(() => expandPlace(text, opts), (err) => {
      assert.equal(err.code, code, JSON.stringify(text));
      assert.ok(err.userMessage.length > 20, 'a refusal has to be actionable');
      return true;
    });
  }
});

test('a refusal is an ExpandError with a message safe to show the person who typed it', async () => {
  await assert.rejects(() => expandOutfit('nostalgic vintage vibes', opts), (err) => {
    assert.equal(err.name, 'ExpandError');
    assert.ok(typeof err.userMessage === 'string');
    assert.ok(!err.userMessage.includes('undefined'));
    assert.match(err.userMessage, /Describe what is on the body/);
    return true;
  });
});

test('expand needs a catalog, because the shipped presets ARE the few-shot skeletons', async () => {
  await assert.rejects(() => expandPlace('a beach', {}), TypeError);
  await assert.rejects(() => expandPlace('a beach', { catalog, seed: -1 }), TypeError);
  await assert.rejects(() => expandPlace('a beach', { catalog, seed: 1.5 }), TypeError);
});

// ---------------------------------------------------------------------------
// the expandImpl seam -- driven with fakes, never wired to anything
// ---------------------------------------------------------------------------

const draftFor = (over = {}) => ({
  draft: {
    id: 'ignored-by-design',
    label: 'A beach hut',
    climate: 'warm',
    timeOfDay: 'afternoon',
    prompt: {
      scene: 'a row of painted wooden beach huts above the tide line, a folding chair outside one of them',
      light: 'low sun from the side, long shadows across the sand',
      lens: 'a consumer zoom near its wide end, deep focus, a little barrel bend at the edges',
      framing: 'waist-up, three-quarters to the camera, the huts behind',
      eraProps: 'a metal thermos flask, a striped canvas wind-break, a transistor radio',
      ...(over.prompt ?? {}),
    },
    negatives: ['modern beach bar'],
    motionHint: 'the canvas of the wind-break snaps and the sand moves in low streaks',
    lookOverride: {},
    ...over,
  },
  dropped: [],
  reason: null,
});

test('expandImpl is handed a request with everything a model call would need', async () => {
  let seen = null;
  await expandPlace('a beach hut', {
    ...opts,
    seed: 42,
    expandImpl: (request) => { seen = request; return draftFor(); },
  });

  assert.equal(seen.kind, 'place');
  assert.equal(seen.text, 'a beach hut');
  assert.equal(seen.seed, 42);
  assert.equal(seen.photoPath, null);
  assert.equal(seen.catalog, catalog);
  assert.equal(seen.id, 'custom-a-beach-hut');
  assert.ok(seen.prompt.includes('a beach hut'), 'the prompt carries the request');
  assert.ok(seen.prompt.includes('schrebergarten-august'), 'the shipped presets are the few-shot examples');
});

test('an async expandImpl is awaited, and its draft is what comes out', async () => {
  const place = await expandPlace('a beach hut', {
    ...opts,
    expandImpl: async (request) => { assert.ok(request); return draftFor(); },
  });
  assert.equal(place.label, 'A beach hut');
  assert.ok(place.prompt.scene.includes('painted wooden beach huts'));
});

test('the id is ours, not the impl\'s -- a model does not get to name a manifest key', async () => {
  const place = await expandPlace('a beach hut', { ...opts, expandImpl: () => draftFor() });
  assert.equal(place.id, 'custom-a-beach-hut');
});

test('an impl that returns a frozen draft still works', async () => {
  const place = await expandPlace('a beach hut', {
    ...opts,
    expandImpl: () => Object.freeze(draftFor()),
  });
  assert.equal(place.id, 'custom-a-beach-hut');
});

test('the default impl is the local expander', async () => {
  const viaDefault = await expandPlace('a beach', opts);
  const viaExplicit = await expandPlace('a beach', { ...opts, expandImpl: localExpander });
  assert.deepEqual(viaDefault, viaExplicit);
});

// ---------------------------------------------------------------------------
// the hostile fakes. A model is not trusted more than a user is.
// ---------------------------------------------------------------------------

test('an impl that asks for the look is refused, not passed through', async () => {
  await assert.rejects(
    () => expandPlace('a beach hut', {
      ...opts,
      expandImpl: () => draftFor({ prompt: { scene: 'a row of beach huts, grainy VHS footage, washed out colour' } }),
    }),
    (err) => {
      assert.equal(err.code, 'SCHEMA_REJECTED');
      assert.match(err.userMessage, /banned look vocabulary/);
      return true;
    },
  );
});

test('an impl that describes the person is refused, not passed through', async () => {
  await assert.rejects(
    () => expandPlace('a beach hut', {
      ...opts,
      expandImpl: () => draftFor({ prompt: { framing: 'waist-up, a young woman with dark hair, three-quarters to the camera' } }),
    }),
    (err) => {
      assert.equal(err.code, 'SCHEMA_REJECTED');
      assert.match(err.userMessage, /banned person vocabulary/);
      return true;
    },
  );
});

test('an impl that hides the look in the negatives is refused too', async () => {
  // "no film grain" is still the words "film grain" in the conditioning, and a
  // negative is exactly where a tired author -- or a model -- hides the word
  // they were told not to use.
  await assert.rejects(
    () => expandPlace('a beach hut', { ...opts, expandImpl: () => draftFor({ negatives: ['film grain', 'sharp modern video'] }) }),
    (err) => { assert.equal(err.code, 'SCHEMA_REJECTED'); return true; },
  );
});

test('an impl that puts wardrobe in a place, or weather in an outfit, is refused', async () => {
  await assert.rejects(
    () => expandPlace('a beach hut', { ...opts, expandImpl: () => draftFor({ prompt: { scene: 'a beach hut, someone wearing a parka beside it' } }) }),
    (err) => { assert.equal(err.code, 'SCHEMA_REJECTED'); return true; },
  );
  await assert.rejects(
    () => expandOutfit('a raincoat', {
      ...opts,
      expandImpl: () => ({ draft: { id: 'x', label: 'A raincoat', climate: ['cool'], wardrobe: 'a yellow raincoat, for an overcast day by the sea', negatives: [] }, dropped: [], reason: null }),
    }),
    (err) => { assert.equal(err.code, 'SCHEMA_REJECTED'); return true; },
  );
});

test('an impl that returns nonsense is a named refusal rather than a stack trace', async () => {
  for (const bad of [null, undefined, 'a beach', 42, { dropped: [] }, { draft: [], dropped: [] }]) {
    await assert.rejects(() => expandPlace('a beach hut', { ...opts, expandImpl: () => bad }), (err) => {
      assert.ok(err instanceof ExpandError, `${JSON.stringify(bad)} produced ${err.name}`);
      return true;
    });
  }
});

test('an impl that gives up returns a refusal carrying the reason', async () => {
  await assert.rejects(
    () => expandPlace('a beach hut', { ...opts, expandImpl: () => ({ draft: null, dropped: [], reason: 'the model would not answer' }) }),
    (err) => {
      assert.equal(err.code, 'NOTHING_LEFT');
      assert.match(err.userMessage, /the model would not answer/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// the prompt that would be sent
// ---------------------------------------------------------------------------

test('the prompt template states all three rules', () => {
  const prompt = buildExpandPrompt({ kind: 'place', text: 'a beach', catalog, id: 'custom-a-beach' });
  for (const rule of EXPAND_RULES) assert.ok(prompt.includes(rule));
  assert.ok(EXPAND_RULES.length === 3);
  assert.match(prompt, /Never describe the person/);
  assert.match(prompt, /never the scene, the light, the weather/);
  assert.match(prompt, /Never ask for the look/);
  assert.match(prompt, /Named props beat adjectives/);
});

test('the few-shot examples are the shipped presets, all of them, and the right ones', () => {
  const forPlace = buildExpandPrompt({ kind: 'place', text: 'a beach', catalog, id: 'x' });
  for (const id of catalog.places.keys()) assert.ok(forPlace.includes(id), id);

  const forOutfit = buildExpandPrompt({ kind: 'outfit', text: 'a hoodie', catalog, id: 'x' });
  for (const id of catalog.outfits.keys()) assert.ok(forOutfit.includes(id), id);
  // an outfit prompt must not carry eight places' worth of scene description --
  // that is the rule-2 failure demonstrated rather than stated
  for (const id of catalog.places.keys()) assert.ok(!forOutfit.includes(id), id);
});

test('every placeholder in the template is filled', () => {
  for (const kind of ['place', 'outfit', 'place-from-photo']) {
    const prompt = buildExpandPrompt({ kind, text: 'a beach', photoPath: '/tmp/place.jpg', catalog, id: 'x' });
    assert.ok(!/\{\{[A-Z]+\}\}/.test(prompt), `${kind} left a placeholder unfilled`);
  }
  assert.match(EXPAND_PROMPT_TEMPLATE, /\{\{EXAMPLES\}\}/);
});

// ---------------------------------------------------------------------------
// the reference-image path
// ---------------------------------------------------------------------------

test('a place from a photograph validates, and describes nothing it cannot see', async () => {
  const place = await placeFromPhoto('/jobs/x/input/place.jpg', opts);
  assert.doesNotThrow(() => validatePlace(place, { id: place.id, baseLook }));
  assert.equal(place.id, 'photo-place');

  // Every fragment defers to the image rather than inventing a place. Inventing
  // one is worse than saying little: the model has to reconcile the invention
  // with the reference, and the result is a garden that is neither.
  for (const key of ['scene', 'light', 'framing', 'eraProps']) {
    assert.match(place.prompt[key], /reference image/, key);
  }
  assert.ok(place.prompt.scene.split(/\s+/).length < 40, 'the photograph carries the scene, not the prose');
  assert.ok(place.negatives.includes('invented architecture'));
});

test('a place from a photograph keeps the era and lens clauses, because the image cannot carry those', async () => {
  const place = await placeFromPhoto('/jobs/x/input/place.jpg', opts);
  assert.match(place.prompt.lens, /consumer zoom/);
  assert.match(place.prompt.eraProps, /manufactured later than the period/);
});

test('a photograph we cannot read gets mild and afternoon, not a confident guess', async () => {
  const bare = await placeFromPhoto('/jobs/x/input/place.jpg', opts);
  assert.equal(bare.climate, 'mild');
  assert.equal(bare.timeOfDay, 'afternoon');
  // ...unless the user typed a hint alongside the upload
  const hinted = await placeFromPhoto('/jobs/x/input/place.jpg', { ...opts, text: 'the kitchen at night' });
  assert.equal(hinted.climate, 'indoor');
  assert.equal(hinted.timeOfDay, 'night');
});

test('no photograph is a refusal that offers the other route', async () => {
  await assert.rejects(() => placeFromPhoto('', opts), (err) => {
    assert.equal(err.code, 'NO_PHOTO');
    assert.match(err.userMessage, /type the place instead/);
    return true;
  });
});

// ---------------------------------------------------------------------------
// the module cannot spend money or reach the network, asserted from the source
// ---------------------------------------------------------------------------

test('nothing in expand/ imports anything but the catalog and itself', () => {
  for (const file of ['expand.mjs', 'local.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/expand', file), 'utf8');
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const spec of imports) {
      assert.match(spec, /^\.\.?\/(catalog|expand)?\/?[a-z.]*\.mjs$/, `${file} imports ${spec}`);
    }
    assert.ok(!/\bfetch\s*\(/.test(src), `${file} contains a fetch call`);
    assert.ok(!/process\.env/.test(src), `${file} reads the environment`);
    assert.ok(!/\bDate\b|\bperformance\.now\b/.test(src), `${file} reads the clock`);
  }
});

test('an expansion is a drop-in for a shipped preset -- same shape, same keys', async () => {
  const shipped = catalog.places.get('ostsee-strand');
  const expanded = await expandPlace('a beach', opts);
  assert.deepEqual(Object.keys(expanded).sort(), Object.keys(shipped).sort());

  const shippedOutfit = getOutfit(catalog, 'fleecepulli');
  const expandedOutfit = await expandOutfit('a hoodie', opts);
  assert.deepEqual(Object.keys(expandedOutfit).sort(), Object.keys(shippedOutfit).sort());
  assert.ok(Object.isFrozen(expanded) && Object.isFrozen(expandedOutfit));
});

test('BANNED is read from schema.mjs and nowhere else -- there is one word list in this repo', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/expand/local.mjs'), 'utf8');
  for (const group of Object.keys(BANNED)) {
    // the group names are referenced; the terms themselves are not re-typed
    assert.ok(!src.includes(`'${BANNED[group][0]}', '${BANNED[group][1]}'`), `${group} looks copied into local.mjs`);
  }
});
