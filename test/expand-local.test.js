/**
 * The local expander -- the algorithm, not the API.
 *
 * Two of these tests are the ones that would survive a rewrite of the module.
 *
 * The first is determinism, run five times rather than twice. That number is
 * not decoration: `gblur` was nondeterministic on short frames and produced six
 * different outputs in six runs, and a two-run purity check would have passed
 * it. An expander that varies between runs makes a manifest a lie, because the
 * `resolved` block claims to be a frozen record of what was sent and would
 * instead be a record of one of several things that might have been.
 *
 * The second is the lossless-rejoin property. Clause dropping is the mechanism
 * by which all three prompt rules are applied to a user's sentence, and the way
 * it fails quietly is by mangling text it was supposed to leave alone --
 * swallowing a preposition, doubling a comma, eating the last word. Asserting
 * that a clean sentence comes back byte-identical is what stops that.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../scripts/catalog/catalog.mjs';
import { validatePlace } from '../scripts/catalog/schema.mjs';
import {
  CLIMATE_TERMS, GARMENT_CLASSES, LIGHT_BY_CLIMATE, LIGHT_BY_TIME, LIGHT_BY_WEATHER,
  LIGHT_INDOORS, NEUTRAL_PLACE, PERIOD_CUT_CLAUSE, STRONG_MATCH, canonicalId,
  choosePlaceSkeleton, classifyGarment, inferClimate, inferOutfitClimate,
  inferTimeOfDay, localExpander, stripClauses, subjectFrom,
} from '../scripts/expand/local.mjs';

const catalog = loadCatalog();

const place = (text, seed = 0) => localExpander({ kind: 'place', text, seed, catalog }).draft;
const outfit = (text, seed = 0) => localExpander({ kind: 'outfit', text, seed, catalog }).draft;

/** The six the CLI is exercised against, plus the awkward ones. Used by more
 *  than one test, so a term added here is checked by all of them. */
const SAMPLES = Object.freeze([
  'a beach', "my grandmother's kitchen", 'a car park at night', 'the school gym',
  'a winter market', 'a stairwell', 'the balcony of our old flat', 'a lighthouse in Iceland',
  'the swimming pool in august', 'a bus stop in the rain',
]);

// ---------------------------------------------------------------------------
// determinism -- five runs, not two
// ---------------------------------------------------------------------------

test('the same text and the same seed produce the same bytes, five runs running', () => {
  for (const text of SAMPLES) {
    const runs = Array.from({ length: 5 }, () => JSON.stringify(place(text, 3)));
    assert.equal(new Set(runs).size, 1, `"${text}" expanded differently across five runs`);
  }
  for (const text of ['a hoodie', 'a wedding suit', 'jeans and a t-shirt']) {
    const runs = Array.from({ length: 5 }, () => JSON.stringify(outfit(text, 3)));
    assert.equal(new Set(runs).size, 1, `"${text}" expanded differently across five runs`);
  }
});

test('the seed only ever breaks a tie, so an unambiguous request ignores it', () => {
  const a = JSON.stringify(place('a beach', 0));
  const b = JSON.stringify(place('a beach', 999));
  assert.equal(a, b);
});

test('nothing in the expander reads the clock', () => {
  // Not a source grep -- a behavioural one. Two expansions of the same request
  // with the process clock moved between them must agree, which is the property
  // that actually matters and the one a `new Date()` slipped into a label would
  // break. See CLAUDE.md: nothing new may read the wall clock in a render path.
  const before = place('a beach');
  const realNow = Date.now;
  Date.now = () => 0;
  try {
    assert.deepEqual(place('a beach'), before);
  } finally {
    Date.now = realNow;
  }
});

// ---------------------------------------------------------------------------
// clause dropping -- where the three prompt rules meet the user's sentence
// ---------------------------------------------------------------------------

test('a sentence with nothing to drop comes back byte-identical', () => {
  for (const text of [...SAMPLES, 'a kitchen with brown tiles and a table by the window',
    'the courtyard behind the flats, near the bins']) {
    assert.equal(stripClauses(text, ['person', 'look', 'wardrobe']).cleaned, text);
  }
});

test('rule 1 -- the clause describing the person is dropped and the place survives', () => {
  const { cleaned, dropped } = stripClauses('a beach, me looking younger', ['person', 'look', 'wardrobe']);
  assert.equal(cleaned, 'a beach');
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].rule, 'person');
});

test('rule 1 -- a first-person clause with no banned adjective in it is still dropped', () => {
  // "me at the beach" contains no word from BANNED.person; the schema could
  // never have needed one, because a preset cannot say "me". The place survives
  // because the preposition is a clause boundary.
  assert.equal(subjectFrom('me at the beach', ['person', 'look', 'wardrobe']).subject, 'the beach');
});

test('rule 1 -- her, his and their are NOT person references, because they introduce places', () => {
  assert.equal(place("her kitchen").prompt.scene.startsWith('a kitchen'), true);
  assert.equal(place('their back garden').prompt.scene.startsWith('a back garden'), true);
});

test('rule 2 -- a place inside an outfit is dropped, and the garment survives', () => {
  const { cleaned, dropped } = stripClauses('a hoodie on the beach', ['person', 'look', 'scene']);
  assert.equal(cleaned, 'a hoodie');
  assert.equal(dropped[0].rule, 'scene');
  assert.equal(dropped[0].match, 'beach');
});

test('rule 2 -- an outfit inside a place is dropped, and the place survives', () => {
  assert.equal(stripClauses('a beach in a red hoodie', ['person', 'look', 'wardrobe']).cleaned, 'a beach');
});

test('rule 3 -- look vocabulary is stripped and whatever it was describing survives', () => {
  // The look list governs what OUR PROMPT says to the model, not what a user is
  // allowed to type. Somebody asking for "grainy VHS beach footage" has asked
  // for a beach and volunteered a texture we were going to apply anyway.
  assert.equal(subjectFrom('grainy VHS beach footage', ['person', 'look', 'wardrobe']).subject, 'a beach');
  assert.equal(stripClauses('a beach, grainy and nostalgic', ['person', 'look', 'wardrobe']).cleaned, 'a beach');
  assert.equal(subjectFrom('a vintage hoodie', ['person', 'look', 'scene']).subject, 'a hoodie');
});

test('a clause that was nothing BUT look vocabulary is dropped, and only then', () => {
  // "nostalgic vintage look" leaves the word `look`, which names the recording
  // rather than the thing recorded. There is nothing describable left.
  assert.equal(stripClauses('nostalgic vintage look', ['person', 'look', 'scene']).cleaned, '');
  // ...but the residue list only fires on a clause a look term was stripped
  // from, so an untouched `film` is left alone -- bare `film` is not banned and
  // "a film set" is a place.
  assert.equal(stripClauses('a film set', ['person', 'look', 'wardrobe']).cleaned, 'a film set');
});

test('a strip records what it took and keeps the rest of the clause verbatim', () => {
  const { cleaned, dropped } = stripClauses('a wet beach, grainy', ['person', 'look', 'wardrobe']);
  assert.equal(cleaned, 'a wet beach');
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].rule, 'look');
  assert.equal(dropped[0].action, 'dropped');
});

test('a leading possessive becomes an article rather than a fact about the user', () => {
  assert.equal(subjectFrom("my grandmother's kitchen", ['person']).subject, "a grandmother's kitchen");
  assert.equal(subjectFrom('my old shed', ['person']).subject, 'an old shed');
  // and a phrase with no possessive slot is left alone, because inserting an
  // article there produces "a jeans and a t-shirt"
  assert.equal(subjectFrom('jeans and a t-shirt', ['person']).subject, 'jeans and a t-shirt');
});

// ---------------------------------------------------------------------------
// inference
// ---------------------------------------------------------------------------

test('climate is inferred from an explicit table, longest match first', () => {
  assert.equal(inferClimate('a beach').climate, 'warm');
  assert.equal(inferClimate('a stairwell').climate, 'indoor');
  assert.equal(inferClimate('a winter market').climate, 'cold');
  // the whole reason longest-match exists: both terms are present and the more
  // specific one is the one the user meant
  assert.equal(inferClimate('a beach in winter').climate, 'cold');
});

test('climate is null rather than a guess when the text says nothing about it', () => {
  assert.equal(inferClimate('a lighthouse').climate, null);
});

test('an unrecognisable place with no climate evidence defaults to mild, not to a confident guess', () => {
  const expanded = place('a lighthouse');
  assert.equal(expanded._source.strongMatch, false);
  assert.equal(expanded.climate, 'mild');
  assert.equal(expanded._source.climateFrom, 'default');
});

test('every climate term maps to a value the schema accepts', () => {
  for (const [value] of CLIMATE_TERMS) assert.ok(['cold', 'cool', 'mild', 'warm', 'indoor'].includes(value));
});

test('time of day is inferred, most specific phrase first', () => {
  assert.equal(inferTimeOfDay('a car park at night').timeOfDay, 'night');
  assert.equal(inferTimeOfDay('the garden in the late afternoon').timeOfDay, 'late afternoon');
  assert.equal(inferTimeOfDay('the kitchen, early morning').timeOfDay, 'early morning');
  assert.equal(inferTimeOfDay('a beach').timeOfDay, null);
});

test('an outfit climate is an array, and a winter jacket beats a jacket', () => {
  assert.deepEqual(inferOutfitClimate('a hoodie').climate, ['cool', 'mild']);
  assert.deepEqual(inferOutfitClimate('a winter jacket').climate, ['cold', 'cool']);
  assert.deepEqual(inferOutfitClimate('a wedding suit').climate, ['indoor', 'mild']);
});

// ---------------------------------------------------------------------------
// skeleton choice
// ---------------------------------------------------------------------------

test('the nearest shipped place is the skeleton', () => {
  const expect = {
    // "a beach" is warm (CLIMATE_TERMS says so) and the Amalfi harbour is the
    // one beach on the menu since 2026-09-05, when the owner retired the
    // out-of-season one in its favour. A winter beach still lands on it as
    // the nearest skeleton and loses the summer dressing to neutral -- see
    // the climate tests below.
    'a beach': 'amalfi-afternoon',
    'a beach in winter': 'amalfi-afternoon',
    "my grandmother's kitchen": 'kuechentisch-fruehstueck',
    'times square': 'new-york-times-square',
    'a side street in new york': 'new-york-times-square',
    'a back street in tokyo': 'tokyo-night',
    'the harbour at positano': 'amalfi-afternoon',
    'the space centre': 'space-centre',
    'the living room with the tv on': 'wohnzimmer-abend',
    'my allotment garden': 'schrebergarten-august',
  };
  for (const [text, id] of Object.entries(expect)) {
    assert.equal(choosePlaceSkeleton(text, catalog, 0).skeleton.id, id, `"${text}"`);
  }
});

test('the four retired places fall to neutral dressing rather than to a stranger\'s props', () => {
  // The stairwell, the car park, the swimming pool and the balcony were
  // replaced by famous places on 2026-09-04 (section 60I). A typed stairwell
  // has no near neighbour in the menu now, and the car park's roadside words
  // -- street, road, bus stop, market -- went with it rather than onto New
  // York: borrowing a yellow cab and a hot-dog cart for "the street outside
  // our house" is the confidently-wrong scene the neutral skeleton exists to
  // refuse. Neutral is the honest answer for all four.
  for (const text of ['a car park at night', 'a stairwell', 'the balcony of our old flat', 'the swimming pool', 'the street outside our house']) {
    const draft = place(text);
    assert.equal(draft._source.skeleton, '_neutral', `"${text}" borrowed ${draft._source.skeleton}`);
    assert.equal(draft.prompt.eraProps, NEUTRAL_PLACE.prompt.eraProps, `"${text}"`);
  }
});

test('a time of day or a season is not lexical evidence for a skeleton', () => {
  // "Tokyo, at night" carries the word night in its label, its id and its
  // scene, which is 25 points of overlap for every request that says "at
  // night" -- so "our street at night" would have borrowed paper lanterns.
  // The clock and the season have their own inference tables and their own
  // bonus in the score; as tokens they are noise, and they are excluded.
  // `square` joined `centre` the day the New York card became Times Square:
  // "the town square" and "the market square" are about the word before it.
  for (const text of ['our street at night', 'the yard at dusk', 'the pool in august', 'the park in autumn', 'the town centre', 'the market square']) {
    const choice = choosePlaceSkeleton(text, catalog, 0);
    assert.equal(choice.strong, false, `"${text}" matched ${choice.skeleton.id} on ${choice.reasons.join(', ')}`);
  }
  // and the same words still reach the skeleton they name
  assert.equal(choosePlaceSkeleton('tokyo at night', catalog, 0).skeleton.id, 'tokyo-night');
  assert.equal(choosePlaceSkeleton('times square at night', catalog, 0).skeleton.id, 'new-york-times-square');
});

test('a request that resembles nothing gets neutral set dressing rather than a stranger\'s props', () => {
  // A dry sports hall has no near neighbour in an eight-place menu. Borrowing
  // the indoor pool would put lane ropes and a lifeguard chair in a gym, and a
  // confidently wrong scene is worse than an honestly vague one.
  const gym = place('the school gym');
  assert.equal(gym._source.skeleton, '_neutral');
  assert.equal(gym.prompt.eraProps, NEUTRAL_PLACE.prompt.eraProps);
  assert.ok(!/lifeguard|lane rope/.test(gym.prompt.scene));
});

test('climate agreement is a tie-breaker and never a qualifier', () => {
  // Two indoor places share a climate with this and neither is a match; if the
  // climate bonus could clear STRONG_MATCH on its own, one of them would be
  // handing over its era props.
  const scored = choosePlaceSkeleton('a dentist waiting room', catalog, 0);
  assert.ok(scored.lexical < STRONG_MATCH || scored.skeleton.id === 'wohnzimmer-abend');
});

// ---------------------------------------------------------------------------
// what is inherited, and what an override takes back
// ---------------------------------------------------------------------------

test('light, lens and era props are inherited from the skeleton when nothing overrides them', () => {
  // "in summer" agrees with the harbour's own climate, so everything the
  // preset wrote by hand is lent to the request.
  const beach = place('a beach in summer');
  const amalfi = catalog.places.get('amalfi-afternoon');
  assert.equal(beach._source.skeleton, 'amalfi-afternoon');
  assert.equal(beach.prompt.light, amalfi.prompt.light);
  assert.equal(beach.prompt.lens, amalfi.prompt.lens);
  assert.equal(beach.prompt.eraProps, amalfi.prompt.eraProps);
  assert.equal(beach.motionHint, amalfi.motionHint);
});

test('a stated time of day overrides the skeleton\'s light, which is the whole point of stating it', () => {
  // Times Square is a night preset, so the override that proves the rule is
  // the other way round: the same square asked for at midday.
  const square = place('times square at midday');
  assert.equal(square._source.skeleton, 'new-york-times-square', 'the request must land on a real skeleton for the override to mean anything');
  assert.equal(square.timeOfDay, 'midday');
  assert.equal(square.prompt.light, LIGHT_BY_TIME.midday);
  assert.notEqual(square.prompt.light, catalog.places.get('new-york-times-square').prompt.light);
});

test('stated weather beats a stated time of day', () => {
  const wet = place('a car park at night in the rain');
  assert.equal(wet.prompt.light, LIGHT_BY_WEATHER.rain);
});

test('indoors beats both, because a sky cannot be the light source in a stairwell', () => {
  const gym = place('the school gym');
  assert.equal(gym.climate, 'indoor');
  assert.equal(gym.prompt.light, LIGHT_INDOORS.day);
  assert.equal(place('a stairwell at night').prompt.light, LIGHT_INDOORS.night);
});

test('the user\'s subject appears in the scene AND the framing', () => {
  const beach = place('a beach');
  assert.ok(beach.prompt.scene.startsWith('a beach,'));
  assert.ok(beach.prompt.framing.includes('the beach behind'));
  // and the framing carries the noun phrase without the circumstance -- "the
  // car park behind", never "the car park at night behind"
  assert.ok(place('a car park at night').prompt.framing.endsWith('the car park behind'));
});

test('the skeleton\'s prop clauses are carried over, including detail behind a "with"', () => {
  const kitchen = place("my grandmother's kitchen");
  assert.ok(kitchen.prompt.scene.includes('brown wall tiles half way up the wall'));
  assert.ok(kitchen.prompt.scene.includes('a filter coffee machine and a radio on the counter'));
  // and the skeleton's own opening clause is gone, because the user just named
  // the place themselves
  assert.ok(!kitchen.prompt.scene.includes('a small German kitchen'));
});

test('a borrowed clause that repeats the user\'s own noun phrase is dropped', () => {
  // The Amalfi skeleton's second clause opens "a pebble beach with rows of
  // striped umbrellas"; a request for the pebble beach must not get it twice.
  const pebbles = place('the pebble beach in summer');
  assert.equal(pebbles._source.skeleton, 'amalfi-afternoon', 'the request must land on the skeleton whose clause repeats it');
  assert.equal(pebbles.prompt.scene.match(/pebble beach/g).length, 1);
  // the WHOLE clause goes, umbrellas and all -- a clause is the unit, and half
  // a clause reads as a typo
  assert.ok(!pebbles.prompt.scene.includes('striped umbrellas'), 'half of the duplicate clause survived');
  assert.ok(pebbles.prompt.scene.includes('lemon trees'), 'the clauses that do not repeat the phrase are still borrowed');
  // the one-word case is deliberately NOT dropped: it would throw away the best
  // clause in the beach preset. On the out-of-season beach that clause was
  // "roofed wicker beach chairs", then "stacked plastic beach loungers" after
  // the de-nationalisation; on the Amalfi harbour, the only beach since
  // 2026-09-05, it is the pebble beach with its umbrellas and loungers.
  assert.ok(place('a beach in summer').prompt.scene.includes('wooden loungers'));
});

test('a skeleton whose climate contradicts the request keeps its lens and loses its dressing', () => {
  // "a garden in january" is cold and schrebergarten-august is a warm late
  // summer. The prose it would lend is internally coherent, which is what
  // makes this the bad kind of wrong: nothing downstream catches it, and the
  // `cold` field then suppresses the compatibility warning a tablecloth in
  // January would deserve. (This was "a beach" against the out-of-season beach
  // until 2026-09-04, when the Amalfi coast gave a warm beach a warm skeleton
  // to land on -- the right outcome, and no longer this test's subject. A
  // month rather than "snow", because stated weather owns the light outright
  // and the climate light is what this test is about.)
  const snow = place('a garden in january');
  assert.equal(snow._source.skeleton, 'schrebergarten-august');
  assert.equal(snow.climate, 'cold');
  assert.match(snow._source.dressingFrom, /^neutral/);

  assert.equal(snow.prompt.light, LIGHT_BY_CLIMATE.cold);
  assert.equal(snow.prompt.eraProps, NEUTRAL_PLACE.prompt.eraProps);
  assert.equal(snow.motionHint, NEUTRAL_PLACE.motionHint);
  assert.deepEqual(snow.lookOverride, {});
  // "manicured lawn" is one of the garden's negatives; a lawn under snow is
  // not the frame it was written against
  assert.ok(!snow.negatives.includes('manicured lawn'));
  // Named against the dressing the preset ACTUALLY carries -- proved PRESENT
  // in the agreeing expansion first, so this cannot go vacuous the way the
  // `wicker|groyne|marram` version of this assertion once did.
  assert.match(place('a garden in august').prompt.scene, /tablecloth|watering can|shed/);
  assert.ok(!/tablecloth|watering can|shed/.test(snow.prompt.scene));

  // the lens is not dressing -- a focal length has no season
  assert.equal(snow.prompt.lens, catalog.places.get('schrebergarten-august').prompt.lens);
});

test('the same request with the agreeing season inherits everything, and the contradicting one does not', () => {
  const summer = place('a beach in summer');
  assert.equal(summer.climate, 'warm');
  assert.equal(summer._source.dressingFrom, 'skeleton:amalfi-afternoon');
  assert.ok(summer.negatives.includes('modern yachts'));

  // A winter beach is three steps from the harbour's climate: the skeleton is
  // still the nearest thing on the menu, and its striped umbrellas are not
  // lent to a request they would contradict.
  const winter = place('a beach in winter');
  assert.equal(winter._source.skeleton, 'amalfi-afternoon');
  assert.equal(winter.climate, 'cold');
  assert.match(winter._source.dressingFrom, /^neutral/);
  assert.ok(!winter.negatives.includes('modern yachts'));
  assert.ok(!/umbrellas|lemon trees|fishing boats/.test(winter.prompt.scene));
});

test('climate is a term in the score, so a warm request prefers a warm skeleton', () => {
  const warm = choosePlaceSkeleton('a summer garden', catalog, 0);
  assert.equal(warm.skeleton.id, 'schrebergarten-august');
  // the penalty is real: the same lexical match scores lower against a skeleton
  // whose climate contradicts the request
  const agreeing = choosePlaceSkeleton('a garden in august', catalog, 0);
  const disagreeing = choosePlaceSkeleton('a garden in the snow', catalog, 0);
  assert.equal(agreeing.skeleton.id, disagreeing.skeleton.id);
  assert.ok(agreeing.total > disagreeing.total);
});

test('a lookOverride tuned for one light is carried one step along the time axis and no further', () => {
  // night -> dusk is the same billboards coming on; night -> midday is not.
  //
  // THE AUDIO BLOCK JOINED THIS EXPECTATION on 2026-08-24 and it belongs here:
  // Times Square at dusk borrowing the preset's traffic is the same one-step
  // rule the grade follows, applied to the other half of the tape. The
  // `_comment` arguing for those numbers is stripped at every depth -- see
  // the test below. (This was the car park until 2026-09-04.)
  assert.deepEqual(place('times square at dusk').lookOverride, {
    grade: { cbRedMid: 0.05, cbBlueMid: -0.04, saturation: 0.88 },
    optics: { bloomStrength: 0.58 },
    tape: { grainStrength: 25 },
    audio: {
      ambience: {
        amplitude: 0.34, color: 'brown', highpass: 200, lowpass: 900,
        volume: 0.22, swellHz: 0.3, swellDepth: 0.35, echoDelayMs: 110, echoDecay: 0.3,
      },
    },
  });
  assert.deepEqual(place('times square at midday').lookOverride, {});
  assert.deepEqual(place('a stairwell at night').lookOverride, {});
});

test('a borrowed lookOverride leaves the borrowed preset\'s argument behind', () => {
  // The values still apply; the `_comment` arguing for them describes a
  // different scene, and a manifest quoting it would mislead the next reader.
  for (const text of SAMPLES) {
    for (const key of Object.keys(place(text).lookOverride)) assert.ok(!key.startsWith('_'), `${text}: ${key}`);
  }
});

// ---------------------------------------------------------------------------
// outfits
// ---------------------------------------------------------------------------

test('an outfit is the user\'s words plus its garment class, and never the skeleton\'s prose', () => {
  const hoodie = outfit('a hoodie');
  assert.equal(hoodie._source.garmentClass, 'knitwear');
  assert.ok(hoodie.wardrobe.startsWith('a hoodie, '));
  assert.ok(hoodie.wardrobe.includes(GARMENT_CLASSES.knitwear.detail));
  // splicing "two white stripes running down each sleeve" onto a garment the
  // user did not describe that way is how an expander invents clothing
  assert.ok(!hoodie.wardrobe.includes('white stripes'));
});

test('a garment class carries named, dateable detail rather than an adjective', () => {
  const expect = {
    'a wedding suit': 'formalwear',
    'a hoodie': 'knitwear',
    'a padded winter jacket': 'outerwear',
    'a tracksuit': 'sportswear',
    'a summer dress': 'dress',
    'jeans and a t-shirt': 'casual',
  };
  for (const [text, cls] of Object.entries(expect)) {
    assert.equal(classifyGarment(text).class, cls, `"${text}"`);
  }
  // longest match, so a tracksuit is sportswear and not formalwear
  assert.equal(classifyGarment('a shell suit').class, 'sportswear');
  // and the detail is objects, not vibes
  assert.match(GARMENT_CLASSES.formalwear.detail, /a tie noticeably wider than a modern one/);
});

test('a garment no class recognises still gets the period-cut clause', () => {
  const odd = outfit('a beekeeping smock');
  assert.equal(odd._source.garmentClass, null);
  assert.equal(odd.wardrobe, `a beekeeping smock, ${PERIOD_CUT_CLAUSE}`);
});

test('an outfit that matches nothing in the menu does not inherit a stranger\'s negatives', () => {
  const suit = outfit('a wedding suit');
  assert.equal(suit._source.skeleton, '_neutral');
  assert.ok(!suit.negatives.includes('modern knitwear'));
  // and nothing in the generic set fights the user's own request: a wedding
  // suit is supposed to be tailored
  assert.ok(!suit.negatives.some((n) => /tailored/.test(n)));
});

// ---------------------------------------------------------------------------
// the shape the schema will insist on
// ---------------------------------------------------------------------------

test('no fragment is over ninety words, even from a maximum-length input', () => {
  const long = `a ${'very old wooden fence post beside a gravel track '.repeat(4)}`.slice(0, 200).trim();
  const expanded = place(long);
  for (const [key, value] of Object.entries(expanded.prompt)) {
    assert.ok(value.trim().split(/\s+/).length <= 90, `${key} is too long`);
  }
  assert.doesNotThrow(() => validatePlace({ ...expanded, id: expanded.id }, { id: expanded.id }));
});

test('the id is derived from the request, not from the expander', () => {
  assert.equal(canonicalId('place', 'a beach'), 'custom-a-beach');
  assert.equal(canonicalId('place', 'a beach, me looking younger'), 'custom-a-beach');
  assert.equal(canonicalId('place-from-photo', ''), 'photo-place');
  // filesystem-safe and manifest-legible, whatever was typed
  assert.match(canonicalId('place', "my grandmother's kitchen!!"), /^[a-z0-9-]+$/);
});

test('an unknown kind is a programmer error, not a silent default', () => {
  assert.throws(() => localExpander({ kind: 'weather', text: 'a beach', seed: 0, catalog }), TypeError);
});

test('a borrowed lookOverride leaves the argument behind at EVERY depth', () => {
  // `withoutDocs` filtered the top level only, which was enough while every
  // lookOverride was two levels deep -- `grade.saturation`, `optics.bloom`.
  // Place ambience (2026-08-24) is three: `audio.ambience._comment`, and that
  // comment argues about a specific place. Borrowed onto somebody's typed text
  // it becomes a manifest quoting "motorway rumble from behind the kiosk" over
  // a scene with no kiosk in it -- exactly the misleading record this function
  // exists to prevent, one level down where it was not looking.
  const nested = (obj, hits = []) => {
    for (const [k, v] of Object.entries(obj ?? {})) {
      if (k.startsWith('_')) hits.push(k);
      if (v && typeof v === 'object' && !Array.isArray(v)) nested(v, hits);
    }
    return hits;
  };
  for (const text of SAMPLES) {
    assert.deepEqual(nested(place(text).lookOverride), [], `${text} carried a comment through`);
  }
});
