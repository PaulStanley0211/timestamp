/**
 * The prompt composer, and specifically the thing it refuses to do.
 *
 * Rule 1 -- a prompt must never describe the person -- is the rule with no
 * visible symptom. Breaking rules 2 and 3 produces a frame that is obviously
 * wrong to anyone who looks at it. Breaking rule 1 produces a perfectly good
 * photograph of somebody who is not quite the user, and the only person who can
 * detect that failure is the user, after paying. There is no automated check
 * downstream that catches it and there never will be, so the check has to be
 * here, on the text, before it is sent.
 *
 * Two of these tests would survive a rewrite of the module and are the ones
 * that matter: the phrase naming the reference image appears exactly once, and
 * no word from the person vocabulary appears at all -- asserted across every
 * one of the 48 shipped combinations, not against a fixture.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOutfit, getPlace, loadCatalog } from '../scripts/catalog/catalog.mjs';
import { scanText } from '../scripts/catalog/schema.mjs';
import { LENS_OVERRIDES, NEUTRAL_PLACE } from '../scripts/expand/local.mjs';
import {
  BASE_NEGATIVES, COMPOSED_BAN_GROUPS, DEFAULT_ERA, MOTION_NEGATIVES, SUBJECT,
  composeMotionPrompt, composeStillPrompt, composeReferencePrompt, REFERENCE_SUBJECT,
} from '../scripts/compose/prompt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = loadCatalog();

const pairs = [];
for (const place of catalog.places.values()) {
  for (const outfit of catalog.outfits.values()) pairs.push({ place, outfit });
}

const place = getPlace(catalog, 'schrebergarten-august');
const outfit = getOutfit(catalog, 'tshirt-jeans');

const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

// ---------------------------------------------------------------------------
// rule 1 -- the refusal that is this module's reason to exist
// ---------------------------------------------------------------------------

test('the person is named exactly once, as the reference image, in every prompt the catalog can produce', () => {
  for (const pair of pairs) {
    const still = composeStillPrompt(pair);
    assert.equal(occurrences(still.prompt, SUBJECT), 1,
      `${pair.place.id}+${pair.outfit.id}: the subject phrase must appear exactly once`);
    const motion = composeMotionPrompt(pair);
    assert.equal(occurrences(motion.prompt, SUBJECT), 1, `${pair.place.id}+${pair.outfit.id}: motion`);
  }
});

test('no composed prompt contains a single word that describes the person', () => {
  const failures = [];
  for (const { place: p, outfit: o } of pairs) {
    const still = composeStillPrompt({ place: p, outfit: o });
    const motion = composeMotionPrompt({ place: p, outfit: o, segment: 2, totalSegments: 3 });
    for (const [label, text] of [['still', still.prompt], ['motion', motion.prompt]]) {
      for (const hit of scanText(text, COMPOSED_BAN_GROUPS.prompt.filter((g) => g === 'person'))) {
        failures.push(`${p.id}+${o.id} ${label}: "${hit.match}"`);
      }
    }
  }
  assert.deepEqual(failures, [],
    'every adjective about a face, build, hair or age is a competing description the model blends toward, ' +
    'and the blend is always plausible and always slightly wrong');
});

test('there is no parameter through which a subject description could arrive', () => {
  // The refusal is structural, not a convention. Anything a caller invents is
  // ignored rather than concatenated, so a future orchestrator cannot bolt a
  // description on without editing this module and its header.
  const clean = composeStillPrompt({ place, outfit });
  const smuggled = composeStillPrompt({
    place, outfit,
    subject: 'a tall blonde woman in her thirties',
    person: 'slim, athletic, short dark hair',
    appearance: 'freckles',
  });
  assert.equal(smuggled.prompt, clean.prompt);
  for (const word of ['tall', 'blonde', 'thirties', 'slim', 'athletic', 'freckles']) {
    assert.ok(!smuggled.prompt.includes(word), `"${word}" must not reach the prompt`);
  }
});

// ---------------------------------------------------------------------------
// rule 3 -- never ask the model for the look, in a prompt or in a negative
// ---------------------------------------------------------------------------

test('no composed prompt or negative asks for the look', () => {
  const failures = [];
  for (const { place: p, outfit: o } of pairs) {
    const still = composeStillPrompt({ place: p, outfit: o });
    const motion = composeMotionPrompt({ place: p, outfit: o });
    const checks = [
      ['still prompt', still.prompt, COMPOSED_BAN_GROUPS.prompt],
      ['still negative', still.negativePrompt, COMPOSED_BAN_GROUPS.negative],
      ['motion prompt', motion.prompt, COMPOSED_BAN_GROUPS.prompt],
      ['motion negative', motion.negativePrompt, COMPOSED_BAN_GROUPS.negative],
    ];
    for (const [label, text, groups] of checks) {
      for (const hit of scanText(text, groups.filter((g) => g === 'look'))) {
        failures.push(`${p.id}+${o.id} ${label}: "${hit.match}"`);
      }
    }
  }
  assert.deepEqual(failures, [],
    'the texture is tapedeck\'s job and it is deterministic; asking a model for it produces a vague ' +
    'nostalgic mood that varies per generation and fights the real chain');
});

test('the era reaches the prompt as set dressing rather than as a photographic style', () => {
  const { prompt } = composeStillPrompt({ place, outfit });
  assert.ok(prompt.includes(DEFAULT_ERA));
  // The clause must constrain the objects in the frame, not the picture.
  assert.match(prompt, /Vehicles, packaging, signage, appliances and the cut of every garment/);
  assert.match(prompt, /nothing visible was manufactured later/);
});

test('the era names a period and not a country', () => {
  // THE PROMPT IS THE ONE PLACE A COUNTRY REACHES THE CUSTOMER'S OWN TAPE.
  // Section 42F de-nationalised the eight place labels and the three preset
  // prompts that named Germany, and it did not touch this constant -- which is
  // handed to composeStillPrompt, composeMotionPrompt AND composeReferencePrompt
  // on every render, so every tape this product has ever made was set in
  // Germany whatever the customer typed. Somebody describing their grandmother's
  // kitchen in Kerala was getting a German one.
  //
  // A PERIOD IS STILL REQUIRED. This is not "drop the era" -- the era is the
  // product, and it is what keeps a mobile phone or a flat-screen out of a 2003
  // frame. What comes out is the COUNTRY, so the clause constrains the decade
  // and leaves the place to the place, which is where the customer's own
  // description and their own photograph already speak.
  assert.doesNotMatch(DEFAULT_ERA, /german|deutsch/i,
    `the default era names a country: ${JSON.stringify(DEFAULT_ERA)}`);
  assert.match(DEFAULT_ERA, /\b(19|20)\d{2}\b/,
    `the default era must still fix a period: ${JSON.stringify(DEFAULT_ERA)}`);

  // And the whole composed prompt, not just the constant -- the era is one of
  // several clauses and any of them could carry the country back in.
  for (const [label, text] of [
    ['still', composeStillPrompt({ place, outfit }).prompt],
    ['motion', composeMotionPrompt({ place, outfit }).prompt],
  ]) {
    assert.doesNotMatch(text, /german|deutsch/i, `the ${label} prompt names a country`);
  }
});

// ---------------------------------------------------------------------------
// composition
// ---------------------------------------------------------------------------

test('the still prompt carries the wardrobe and all five place fragments, and nothing else', () => {
  const { prompt, fragments } = composeStillPrompt({ place, outfit });
  assert.ok(prompt.includes(outfit.wardrobe));
  for (const key of ['scene', 'light', 'lens', 'framing', 'eraProps']) {
    assert.ok(prompt.includes(place.prompt[key]), `the prompt is missing the ${key} fragment`);
  }
  // The fragments are returned so a manifest can say which clause came from
  // which preset without re-splitting the prompt with a parser.
  assert.equal(fragments.placeId, place.id);
  assert.equal(fragments.outfitId, outfit.id);
  assert.ok(prompt.includes('Exactly one person in frame.'));
});

test('negatives combine the shared list with both presets, deduplicated', () => {
  const { negativePrompt } = composeStillPrompt({ place, outfit });
  const parts = negativePrompt.split(', ');
  for (const n of BASE_NEGATIVES) assert.ok(parts.includes(n), `missing base negative "${n}"`);
  for (const n of [...place.negatives, ...outfit.negatives]) assert.ok(parts.includes(n), `missing "${n}"`);
  assert.equal(new Set(parts).size, parts.length, 'a clause repeated by two presets should cost one clause');
});

test('count is recorded and deliberately does not change a single character of the prompt', () => {
  // Five differently worded prompts are five separate gambles, not five takes
  // of one scene -- and the contact sheet exists so a human can compare takes.
  const one = composeStillPrompt({ place, outfit, count: 1 });
  const five = composeStillPrompt({ place, outfit, count: 5 });
  assert.equal(one.prompt, five.prompt);
  assert.equal(one.negativePrompt, five.negativePrompt);
  assert.equal(five.fragments.count, 5);
  assert.throws(() => composeStillPrompt({ place, outfit, count: 0 }), /positive integer/);
  assert.throws(() => composeStillPrompt({ place, outfit, count: 2.5 }), /positive integer/);
});

test('a preset that did not come through loadCatalog is rejected rather than half-composed', () => {
  assert.throws(() => composeStillPrompt({ place: { id: 'x' }, outfit }), /missing "label"/);
  assert.throws(
    () => composeStillPrompt({ place: { ...place, prompt: { ...place.prompt, scene: '' } }, outfit }),
    /missing "prompt.scene"/,
  );
  assert.throws(() => composeStillPrompt({ place, outfit: { id: 'y', label: 'Y' } }), /missing "wardrobe"/);
  assert.throws(() => composeStillPrompt({ place, outfit, era: '' }), /era/);
});

// ---------------------------------------------------------------------------
// motion
// ---------------------------------------------------------------------------

test('the motion prompt uses the place motion hint and forbids a cut', () => {
  const { prompt, negativePrompt } = composeMotionPrompt({ place, outfit });
  assert.ok(prompt.includes(place.motionHint));
  // CHANGED 2026-08-24. Was /No zoom, no cut, one continuous take/. The rule it
  // was protecting is intact -- a cut still breaks the illusion outright and is
  // still forbidden -- but the prohibition now lives ONLY on negativePrompt,
  // which is the channel built for it, and the prose says what should happen
  // instead. Same instruction, one channel, positive form.
  assert.match(prompt, /One continuous take at real speed/);
  assert.match(prompt, /Nothing dramatic happens/);
  for (const n of MOTION_NEGATIVES) assert.ok(negativePrompt.includes(n), `missing motion negative "${n}"`);
});

test('segment 1 starts from the still and every later segment says it is continuing', () => {
  const first = composeMotionPrompt({ place, outfit, segment: 1, totalSegments: 3 });
  assert.match(first.prompt, /Take 1 of 3\. Begin on the supplied frame/);

  const second = composeMotionPrompt({ place, outfit, segment: 2, totalSegments: 3 });
  // Without this clause the model has licence to re-stage the shot between
  // takes, which is exactly what phase-0 criterion 5 is looking for.
  assert.match(second.prompt, /Take 2 of 3\. Continue from the final frame of the previous take/);
  // Same change, same reason: "no cut" became "one unbroken take".
  assert.match(second.prompt, /the same place, the same wardrobe, the same light, one unbroken take/);
});

test('a segment outside the run is a thrown error, not a silently clamped one', () => {
  assert.throws(() => composeMotionPrompt({ place, outfit, segment: 4, totalSegments: 3 }), /1\.\.3/);
  assert.throws(() => composeMotionPrompt({ place, outfit, segment: 0, totalSegments: 3 }), /1\.\.3/);
  assert.throws(() => composeMotionPrompt({ place, outfit, segment: 1, totalSegments: 0 }), /positive integer/);
});

test('hand-held camera movement is content and stays allowed', () => {
  // Operator movement is a thing the video model must render. Transport jitter
  // -- which displaces the finished tape image including its grain and its
  // burnt-in date -- is a different phenomenon and belongs to ffmpeg. Confusing
  // the two would either ban legitimate camera direction or let the look in.
  const { prompt } = composeMotionPrompt({ place, outfit });
  assert.match(prompt, /hand-held/);
  assert.deepEqual(scanText(prompt, ['look']), []);
});

// ---------------------------------------------------------------------------
// purity
// ---------------------------------------------------------------------------

test('the same inputs produce byte-identical output', () => {
  for (const pair of pairs.slice(0, 6)) {
    assert.equal(composeStillPrompt(pair).prompt, composeStillPrompt(pair).prompt);
    assert.equal(composeMotionPrompt(pair).negativePrompt, composeMotionPrompt(pair).negativePrompt);
  }
});

test('prompt.mjs and seed.mjs import nothing and read nothing', () => {
  // Asserted against the source rather than the behaviour, because the failure
  // being prevented is a future edit -- "just read the era from an env var" --
  // and by the time that changes an output it is already in a manifest.
  for (const file of ['scripts/compose/prompt.mjs', 'scripts/compose/seed.mjs']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/^\s*import\s/m.test(code), `${file} must not import anything`);
    for (const forbidden of [/Math\.random/, /Date\.now/, /new Date/, /node:fs/, /fetch\s*\(/, /process\./]) {
      assert.ok(!forbidden.test(code), `${file} must not use ${forbidden}`);
    }
  }
});

// ---------------------------------------------------------------------------
// motion: the craft rules
//
// Extracted from the `seedance-clean` skill (Paul, 2026-08-23) and adapted --
// most of that skill's technical-style vocabulary is REFUSED here, see the
// header of prompt.mjs. What survives is the part about writing the visible.
// ---------------------------------------------------------------------------

test('the motion prompt inherits the lens and framing the still already describes', () => {
  // Both were written for every place preset and BOTH WERE DISCARDED by the
  // motion prompt, which asked only for scene, light and motionHint. The still
  // and the video were being shot on different lenses from the same preset.
  const { prompt } = composeMotionPrompt({ place, outfit });
  assert.ok(prompt.includes(place.prompt.framing), 'framing is carried');
  assert.ok(prompt.includes(place.prompt.lens), 'lens is carried');
});

test('the motion prompt states the target, never the prohibition', () => {
  // The hardest rule in the skill: positive phrasing only. This prompt used to
  // say "No zoom, no cut" IN THE PROMPT TEXT while ALSO listing both in
  // negativePrompt -- the same instruction on two channels, one of them in the
  // form the model handles worst. The negatives channel keeps them; the prose
  // states what should happen instead.
  const { prompt, negativePrompt } = composeMotionPrompt({ place, outfit });
  assert.doesNotMatch(prompt, /\bno (zoom|cut|camera cut|jump cut)\b/i, 'prohibitions leave the prose');
  assert.ok(negativePrompt.includes('camera cut'), 'and stay on the channel built for them');
  assert.ok(negativePrompt.includes('zoom'));
});

test('the camera is described with a field of view, an axis and a white balance', () => {
  // Vague camera direction produces random motion. FOV comes from the skill's
  // discrete anchor table -- 63 degrees is the 28-35mm "observational" step,
  // which is where a consumer camcorder actually sat.
  const { prompt } = composeMotionPrompt({ place, outfit });
  assert.match(prompt, /63°/, 'field of view, from the anchor table');
  assert.match(prompt, /\d{4}K/, 'white balance in Kelvin, fixed for the scene');
});

test('no quality marker ever reaches the motion prompt', () => {
  // THE INVERSION THIS PRODUCT RUNS ON. Every prompt skill wants 8K, photoreal,
  // film grain, cinematic. Asking for those lands model grain at 1080 on top of
  // ffmpeg grain at 576 -- two grain structures at different scales, which is
  // the texture people read as AI. The correct style instruction here is the
  // ABSENCE of style: a clean, plainly-exposed frame that ffmpeg then degrades
  // on purpose.
  const { prompt } = composeMotionPrompt({ place, outfit });
  for (const marker of ['8K', '4K', 'photoreal', 'film grain', 'cinematic', 'filmic', 'Kodak', 'bokeh', 'anamorphic']) {
    assert.ok(!new RegExp(marker, 'i').test(prompt), `"${marker}" must never appear`);
  }
});

// ---------------------------------------------------------------------------
// still: the composition tells
//
// Written 2026-08-24 after Paul looked at the first still that HELD his
// likeness and said it still read as AI generated. Running that same still
// through the real tape chain settled where the problem lives: every TEXTURE
// tell -- waxy skin, hyper-detail, lifted shadows, clinical sharpness -- was
// gone by the graded frame. What survived was composition, and composition is
// content, so it is the prompt's job and not ffmpeg's.
//
// Four things survived, and the prompt was asking for three of them by name.
// ---------------------------------------------------------------------------

test('the still prompt states the framing before the lens and the light', () => {
  // ORDER IS LOAD-BEARING, and this is the second time the project has learned
  // it. `composeMotionPrompt` already carries the ruling in a comment: pushed
  // to the end, a camera direction gets ignored. The still prompt had framing
  // FIFTH of eight lines, and seedream ignored it exactly as predicted --
  // "waist-up, three-quarters" was asked for and full-body front-on came back,
  // which is what made the frame symmetrical enough to read as rendered.
  const { prompt } = composeStillPrompt({ place, outfit });
  const at = (needle) => prompt.indexOf(needle);

  assert.ok(at('Framing:') > -1, 'the still prompt has a framing clause at all');
  assert.ok(at('Framing:') < at('Lens:'), 'framing is stated before the lens');
  assert.ok(at('Framing:') < at('Light:'), 'framing is stated before the light');
});

test('no lens the product can emit asks for everything to be sharp front to back', () => {
  // THE SINGLE BIGGEST AI-IMAGE TELL, and it was house vocabulary. A real
  // consumer camcorder in domestic light does not hold the near table and the
  // far shed at the same sharpness; a diffusion model asked for "deep focus
  // from the table all the way to the shed" renders every leaf, every link of
  // the fence and every spoke equally, which no photograph has ever looked
  // like. Two presets, the authoring template and both free-text fallbacks all
  // asked for it, so a fix confined to the eight shipped places would still
  // have shipped it to anyone who typed their own.
  //
  // The catalog already had the right phrasing in three places -- "the far
  // balconies falling slightly out of focus", "the counter behind going soft",
  // and LENS_OVERRIDES.close. This rule makes that the only phrasing.
  const lenses = [
    ...[...catalog.places.values()].map((p) => [p.id, p.prompt.lens]),
    ['expand:close', LENS_OVERRIDES.close],
    ['expand:wide', LENS_OVERRIDES.wide],
    ['expand:neutral', NEUTRAL_PLACE.prompt.lens],
  ];

  const offenders = lenses
    .filter(([, lens]) => /deep focus|everything (in|is) (sharp|focus)|front to back/i.test(lens))
    .map(([id]) => id);

  assert.deepEqual(offenders, [],
    'These lens clauses ask for edge-to-edge sharpness, which is the tell that '
    + 'survives the tape chain. Say what goes soft instead: ' + offenders.join(', '));
});

test('every composed still prompt asks for a moment rather than a pose', () => {
  // Nothing in the prompt asked for anything to be HAPPENING, so the model did
  // the only sensible thing with a portrait brief and produced a portrait:
  // squared to the camera, arms hanging, waiting to be photographed. A snapshot
  // is somebody caught halfway through something.
  for (const pair of pairs) {
    const { prompt } = composeStillPrompt(pair);
    assert.match(prompt, /^Moment: .+\.$/m,
      `${pair.place.id}+${pair.outfit.id}: no moment clause`);
  }
});

test('a place that writes its own moment has it used verbatim', () => {
  // The generic clause is a floor, not a ceiling. A moment that belongs to its
  // place -- wet hair pushed back at the pool, a cup halfway to the mouth at
  // the kitchen table -- fights the posed default far harder than one written
  // to fit all eight, and the catalog is where that authoring belongs.
  const own = 'still pulling one arm out of a sleeve, half turned away';
  const { prompt } = composeStillPrompt({
    place: { ...place, prompt: { ...place.prompt, moment: own } },
    outfit,
  });
  assert.ok(prompt.includes(`Moment: ${own}.`), 'the authored moment is used as written');
});

test('the still negatives name the composition tells, not only the era ones', () => {
  // BASE_NEGATIVES guards the period and the anatomy and says nothing about
  // composition, so "centred, symmetrical, posed" had no channel at all. These
  // belong on the negatives channel for the same reason the motion
  // prohibitions do -- prose handles targets, negatives handle refusals.
  const { negativePrompt } = composeStillPrompt({ place, outfit });
  for (const tell of ['centered composition', 'symmetrical composition', 'posed portrait']) {
    assert.ok(negativePrompt.includes(tell), `the still negatives must name "${tell}"`);
  }
});

test('the still negatives stay clear of the look vocabulary the motion ones are held to', () => {
  // A negative is still conditioning: "no film grain" puts the words film grain
  // in front of the model. The composition tells are about staging, so none of
  // them may smuggle a texture word in through the back door.
  const { negativePrompt } = composeStillPrompt({ place, outfit });
  for (const marker of ['film grain', 'bokeh', 'cinematic', 'photoreal', '8K', 'anamorphic']) {
    assert.ok(!new RegExp(marker, 'i').test(negativePrompt), `"${marker}" must never appear`);
  }
});

// ---------------------------------------------------------------------------
// reference-to-video: four choices and a tape
//
// Paul's product, restated three times and finally built. Upload a photo, pick
// an outfit, a place and a frame shape, get fifteen seconds. NO generated
// still, nothing to approve, no picture the user ever meets.
//
// The still was never wanted for its own sake -- it existed because
// `animate` is image-to-video and needs a start frame.
// `bytedance/seedance-2.0/reference-to-video` takes the photographs themselves,
// so the stage stops existing rather than being hidden.
// ---------------------------------------------------------------------------

test('the reference prompt points at the photograph and never describes who is in it', () => {
  // RULE 1 SURVIVES THE REWRITE, and it matters more here, not less: on this
  // path there is no still for a human to reject, so a prompt that competes
  // with the photograph over the face is a competing description nobody sees
  // until a whole video has been paid for.
  for (const pair of pairs) {
    const { prompt } = composeReferencePrompt(pair);
    assert.equal(occurrences(prompt, REFERENCE_SUBJECT), 1,
      `${pair.place.id}+${pair.outfit.id}: @Image1 must be named exactly once`);
    assert.deepEqual(scanText(prompt, ['person', 'look']), [],
      `${pair.place.id}+${pair.outfit.id}: no word describing the person`);
  }
});

test('the place photograph becomes @Image2, and is absent when nobody uploaded one', () => {
  // "Your actual childhood garden" is the version of this product no
  // preset-menu competitor can match, and it is the reason the endpoint was
  // recorded in config/models.json on 2026-08-20.
  const withPlace = composeReferencePrompt({ place, outfit, placePhoto: true });
  assert.match(withPlace.prompt, /@Image2/, 'the uploaded place is named');

  const without = composeReferencePrompt({ place, outfit });
  assert.doesNotMatch(without.prompt, /@Image2/,
    'naming a reference that was never attached invites the model to invent one');
});


test('no quality marker reaches the reference prompt either', () => {
  // THE INVERSION THIS PRODUCT RUNS ON, and the seedance-prompt skill Paul
  // installed opens every one of its templates with these exact words. The
  // skill's @Image token structure is used; its style vocabulary is refused,
  // which is the same ruling section 14 recorded for the motion prompt.
  // Word-boundaried, as the catalog-wide sweep below already is: a bare /ARRI/i
  // matches "carried", which the continuity sentence says, and "carriageway",
  // which the car park says twice. The target is the camera brand.
  for (const arc of ['six', 'three']) {
    const { prompt } = composeReferencePrompt({ place, outfit, arc });
    for (const m of ['8K', '4K', 'photoreal', 'film grain', 'cinematic', 'filmic', 'Kodak', 'bokeh', 'anamorphic', 'ARRI']) {
      assert.ok(!new RegExp(`\\b${m}\\b`, 'i').test(prompt), `${arc}: "${m}" must never appear`);
    }
  }
});

test('the reference prompt keeps the anti-slop work the still prompt earned', () => {
  // A moment rather than a pose, and the snapshot rule against centring. Both
  // were paid for earlier on 2026-08-24 and neither is inherited automatically.
  //
  // THIS TEST CHANGED SHAPE WITH THE VLOG REWRITE and it is worth saying why.
  // It used to assert a standalone `Framing:` line before `Light:` -- correct
  // for a single-take prompt, meaningless for a shot list where every shot
  // carries its own size. What it was ever really guarding is that the frame is
  // not composed and that something is HAPPENING, so that is what it asserts
  // now, and both are still checked against the catalog's own text.
  const { prompt } = composeReferencePrompt({ place, outfit });
  assert.match(prompt, /off centre/i, 'the snapshot rule rides along');
  assert.ok(prompt.includes(place.prompt.moment), 'the place own moment is still performed');
  assert.match(prompt, /^Shot \d+: (Wide|Medium|Close)/m, 'and every shot states its size');
});

// ---------------------------------------------------------------------------
// the vlog rewrite (2026-08-24)
//
// Paul watched the first direct tape and said the right thing about it: "there
// is no engagement, no enthusiasm ... the character is placing the bottle on
// the table, it is taking around five to six seconds ... it should be like a
// vlog. If I am on a beach it has to be running toward the streets, the beach
// view, and everything. It should have some content."
//
// THE PROMPT WAS ASKING FOR EXACTLY WHAT HE DID NOT WANT. In its own words:
// "It drifts a few centimetres and settles, the operator standing in one place
// and breathing", and "Nothing dramatic happens. This is an ordinary late
// afternoon and it simply continues for the whole 15 seconds." The model obeyed.
//
// A TEST WAS DELETED TO GET HERE, and it is worth saying out loud: "the
// reference prompt is one continuous take" asserted the old design, which Paul
// has replaced. In-camera cuts are also period-honest -- a 2003 camcorder tape
// is full of them, because you pressed record and stopped again. Seedance does
// multi-shot inside ONE generation, so nothing is stitched by the pipeline and
// the DIRECT_NEEDS_ONE_CALL guard is untouched.
// ---------------------------------------------------------------------------

test('the reference prompt is a numbered shot list, not one long stare', () => {
  for (const arc of ['six', 'three']) {
    const { prompt } = composeReferencePrompt({ place, outfit, arc });
    const shots = [...prompt.matchAll(/^Shot (\d+): /gm)].map((m) => Number(m[1]));
    assert.ok(shots.length >= 3, `${arc}: expected a real shot list, got ${shots.length} shot(s)`);
    assert.deepEqual(shots, shots.map((_, i) => i + 1), `${arc}: numbered from 1, in order, no gaps`);
  }
});

test('the shot count scales with the runtime, off the skill own table', () => {
  // 2 to 2.5 seconds a shot, from the seedance-prompt skill Paul installed.
  // Paul's complaint measured the failure precisely: one action over five or
  // six seconds reads as lag, and this is the number that fixes it.
  // This is the six-beat arc's table; the three-beat arc holds at three and
  // drops to two only under six seconds.
  const shotsFor = (seconds) =>
    [...composeReferencePrompt({ place, outfit, seconds, arc: 'six' }).prompt.matchAll(/^Shot \d+: /gm)].length;
  assert.equal(shotsFor(15), 6, '14-15s is six shots');
  assert.equal(shotsFor(12), 5);
  assert.equal(shotsFor(6), 3);
  assert.ok(shotsFor(15) > shotsFor(6), 'a longer tape earns more beats, not longer ones');
});

test('every shot names a camera move, because without one the model defaults to flat motion', () => {
  // The skill is blunt that camera direction is the highest-impact element in
  // a Seedance prompt, and the first tape is the evidence: the one clause that
  // said what the camera did said it stood still.
  const { prompt } = composeReferencePrompt({ place, outfit });
  const shots = prompt.split('\n').filter((l) => /^Shot \d+: /.test(l));
  for (const shot of shots) {
    assert.match(shot, /camera/i, `no camera direction: ${shot}`);
  }
});

test('the deadeners are gone from the prompt entirely', () => {
  const { prompt } = composeReferencePrompt({ place, outfit });
  assert.doesNotMatch(prompt, /nothing dramatic happens/i);
  assert.doesNotMatch(prompt, /simply continues/i);
  assert.doesNotMatch(prompt, /standing in one place/i);
});

test('cuts are permitted on this path and still forbidden on the single-take one', () => {
  // The negatives channel has to disagree between the two, because the two
  // deliveries are different things now. A vlog that may not cut is the tape
  // Paul rejected; a motion SEGMENT that cuts is footage that cannot be joined.
  const vlog = composeReferencePrompt({ place, outfit });
  assert.ok(!/camera cut|jump cut/i.test(vlog.negativePrompt),
    'the direct path must not forbid the cuts it is built on');

  const segment = composeMotionPrompt({ place, outfit });
  assert.ok(segment.negativePrompt.includes('camera cut'),
    'the still path still delivers one unbroken segment');
});

test('everything that was never about stillness is still refused', () => {
  // Dropping the cut negatives must not drop the rest with them. A speed ramp,
  // a location change or a wardrobe change breaks the tape whatever the pacing.
  const { negativePrompt } = composeReferencePrompt({ place, outfit });
  for (const tell of ['slow motion', 'speed ramp', 'time lapse', 'morphing',
    'the location changing', 'a change of wardrobe']) {
    assert.ok(negativePrompt.includes(tell), `"${tell}" must stay refused`);
  }
});

test('the vlog shows the place, which is the half Paul said was missing', () => {
  // "If I am on a beach it has to be ... the beach view, and everything."
  // A shot list that never leaves the subject is a portrait in six pieces.
  // THE SIX-BEAT VLOG, BY NAME: the prop close-up is its beat, and it is the
  // beat the three-beat arc deliberately dropped -- on the living-room tapes a
  // close-up of the television with the person "just behind it" is exactly
  // what invited the model to paint the person onto the screen.
  const { prompt } = composeReferencePrompt({ place, outfit, arc: 'six' });
  const shots = prompt.split('\n').filter((l) => /^Shot \d+: /.test(l));
  assert.ok(shots.some((s) => /wide/i.test(s)), 'at least one wide shot of the place');
  // Case-insensitive on the first letter only: the prop opens a sentence in the
  // shot list, so it is capitalised there and lower case in the preset.
  const firstProp = place.prompt.eraProps.split(',')[0].trim();
  const anyCase = `[${firstProp[0].toLowerCase()}${firstProp[0].toUpperCase()}]${firstProp.slice(1)}`;
  assert.match(prompt, new RegExp(anyCase), 'and a named object from this place, close');

  // The default still shows the place -- the beach view is folded into the
  // arrival, with the person in it, through the place's own motion hint.
  const plain = composeReferencePrompt({ place, outfit }).prompt;
  const first = plain.split('\n').find((l) => /^Shot 1: /.test(l));
  assert.match(first, /wide/i, 'the default opens wide');
  assert.ok(first.includes(place.motionHint), 'and looks around the place as the preset describes it');
});

test('rule 1 and the look ban survive the rewrite, across the whole catalog', () => {
  // The rules that cost the most to establish are the easiest to lose in a
  // rewrite this size, and they are the ones with no visible symptom.
  for (const pair of pairs) {
    const { prompt } = composeReferencePrompt(pair);
    assert.equal(occurrences(prompt, REFERENCE_SUBJECT), 1, `${pair.place.id}: @Image1 once`);
    assert.deepEqual(scanText(prompt, ['person', 'look']), [], `${pair.place.id}: vocabulary`);
        // Word-boundaried: a bare /ARRI/ matches 'carriageway' and 'barrier', which
    // the autobahn place says twice. The target is the camera brand the skill's
    // opening blocks all carry.
    for (const m of ['8K', 'photoreal', 'film grain', 'cinematic', 'bokeh', String.raw`ARRI`]) {
      assert.ok(!new RegExp(m, 'i').test(prompt), `${pair.place.id}: "${m}"`);
    }
  }
});

test('the tape does not end without the customer in it', () => {
  // MEASURED ON THE TWO REAL TAPES, 2026-09-01 (section 53). Both ended on a
  // frame with nobody in it: the beach tape on a figure fifty metres away, the
  // 720p one on an empty garden. The cause is in the beat itself -- the closing
  // shot said "one last look across the place, camera drifting and settling"
  // and never named the subject, so the model read "settle" as THE CAMERA COMES
  // TO REST ON THE SCENE. That is a fair reading of the word and it is not what
  // somebody who paid for a tape of themselves wants as the final image.
  const { prompt } = composeReferencePrompt({ place, outfit });
  const shots = prompt.split('\n').filter((l) => /^Shot \d+: /.test(l));
  assert.ok(shots.length >= 3, 'no shot list to check');

  const last = shots[shots.length - 1];
  assert.match(last, /\b(them|they|their)\b/i,
    `the closing shot never names the subject, so the tape can end on an empty frame: ${last}`);
});

test('at most one shot in the arc is the place without the person', () => {
  // THE PLACE SHOT IS DELIBERATE AND STAYS. Paul asked for it in as many words
  // -- "it has to be running toward the streets, the beach view, and
  // everything" -- and a shot list that never leaves the subject is a portrait
  // in six pieces. What was never priced is how much of a fifteen-second
  // product it costs: measured, the customer was absent from 27% of the beach
  // tape and 53% of the 720p one. One beat is the view; the rest have them in
  // it.
  for (const seconds of [15, 12, 6]) {
    const { prompt } = composeReferencePrompt({ place, outfit, seconds });
    const shots = prompt.split('\n').filter((l) => /^Shot \d+: /.test(l));
    const empty = shots.filter((s) => !/\b(them|they|their)\b/i.test(s));
    assert.ok(empty.length <= 1,
      `${seconds}s: ${empty.length} shots have no subject in them, which is how half a tape `
      + `ends up without the customer:\n${empty.join('\n')}`);
  }
});

/**
 * THE THREE-BEAT ARC (2026-09-04). The owner watched two tapes from the same
 * evening: one read as an afternoon, the other stood, sat, stood again with
 * nothing carrying across the cuts. Six beats give the model six chances to
 * drop the thread; this arc gives it three, each naming the person, and says
 * in words that it is one continuous moment with the same spot and posture
 * carried across every cut. It is a switch, not the default, until a paid
 * comparison has judged it.
 */
test('the three-beat arc is one continuous moment with the person in every shot', () => {
  const { prompt } = composeReferencePrompt({ place, outfit, arc: 'three' });
  const shots = prompt.split('\n').filter((l) => /^Shot \d+: /.test(l));
  assert.equal(shots.length, 3, 'three beats at fifteen seconds');
  for (const shot of shots) {
    assert.match(shot, /\b(them|they|their)\b/i, `a beat without the person: ${shot}`);
    assert.match(shot, /camera/i, `no camera direction: ${shot}`);
  }
  assert.match(prompt, /One continuous moment/, 'the continuity is not said in words');
  assert.match(prompt, /same spot/, 'and it does not say what must carry across the cut');
  // The last beat ends on the person, which is the ruling section 53 earned.
  assert.match(shots[2], /settling on them/);
  // A shorter tape keeps the ends and drops the middle.
  const short = composeReferencePrompt({ place, outfit, arc: 'three', seconds: 5 }).prompt;
  assert.equal(short.split('\n').filter((l) => /^Shot \d+: /.test(l)).length, 2, 'five seconds is two beats');
});

test('the three-beat arc is the default, and six is still there by name', () => {
  // JUDGED 2026-09-04, SAME PHOTO, SAME ROOM, SAME OUTFIT. Two seeds of the
  // three-beat arc were one continuous moment each: walk in, look, cross to
  // the sofa, sit, watch, turn to the lens. The six-beat seed lost the person
  // for two seconds, put his face on the television twice, and jumped from
  // the sofa to standing -- the same defects as the 2 September tape. The
  // web app orders whatever the default is, so the default is the arc that
  // connects; six stays reachable for the comparison that decided this.
  const plain = composeReferencePrompt({ place, outfit }).prompt;
  const three = composeReferencePrompt({ place, outfit, arc: 'three' }).prompt;
  assert.equal(plain, three);
  assert.equal(plain.split('\n').filter((l) => /^Shot \d+: /.test(l)).length, 3);
  const six = composeReferencePrompt({ place, outfit, arc: 'six' }).prompt;
  assert.equal(six.split('\n').filter((l) => /^Shot \d+: /.test(l)).length, 6);
});

test('an arc this file has not written is refused, never defaulted', () => {
  assert.throws(() => composeReferencePrompt({ place, outfit, arc: 'nine' }), TypeError);
});

test('the person appears only in the flesh, never on a screen, in a mirror or in a picture', () => {
  // On the living-room tape the model painted the reference photograph onto
  // the television, in a different shirt: it treats "the person" as something
  // it may draw anywhere a face fits. Said in words, on both arcs.
  for (const arc of ['six', 'three']) {
    const { prompt } = composeReferencePrompt({ place, outfit, arc });
    assert.match(prompt, /never on a television screen, in a mirror, in a photograph or on a poster/,
      `${arc}: the prompt does not keep the person off the props`);
  }
});
