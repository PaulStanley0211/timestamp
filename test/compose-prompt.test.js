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
import {
  BASE_NEGATIVES, COMPOSED_BAN_GROUPS, DEFAULT_ERA, MOTION_NEGATIVES, SUBJECT,
  composeMotionPrompt, composeStillPrompt,
} from '../scripts/compose/prompt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = loadCatalog();

const pairs = [];
for (const place of catalog.places.values()) {
  for (const outfit of catalog.outfits.values()) pairs.push({ place, outfit });
}

const place = getPlace(catalog, 'schrebergarten-august');
const outfit = getOutfit(catalog, 'sommerkleid');

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
