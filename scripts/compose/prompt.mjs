/**
 * Prompt assembly. Pure: no filesystem, no network, no model, no clock, no
 * randomness. Two preset objects and a couple of scalars in, two strings out.
 *
 * THIS FILE IS A SEPARATE MODULE BECAUSE OF WHAT IT REFUSES TO DO.
 *
 * composeStillPrompt accepts no subject description. Not an optional one, not
 * an empty-string one -- there is no parameter for it, and there is no code
 * path that could produce one, because the only sentence in the prompt that
 * refers to the person is a fixed constant that names the reference image and
 * says nothing else. That is the whole design.
 *
 * The reasoning is worth stating in full, because the temptation to add "a
 * woman in her thirties" is enormous and it feels like it should help. An
 * identity-preserving image model receives two conditioning signals: the
 * reference photo and the text. When the text also describes a person, the two
 * are not additive -- the model reconciles them, and reconciling a photograph
 * of a specific face with "a slim young man with short dark hair" produces a
 * face that is a blend of the two. The blend is always plausible and always
 * slightly wrong, and "slightly wrong" is the exact failure this product cannot
 * survive: the user's reaction is not "the model is imperfect", it is "that
 * isn't me, it looks like my cousin". A prompt that says nothing about the
 * person leaves the reference photo as the sole authority on the face, which is
 * the only configuration in which likeness can be as good as the model gets.
 *
 * It gets worse than merely blending, which is why the refusal is total rather
 * than a style guideline. Any demographic adjective in the prompt is also a
 * demographic assumption about whoever uploaded the photo, applied at generation
 * time, by a system that never saw them. There is no wording of that which is
 * acceptable in a product strangers upload their faces to.
 *
 * So the person appears exactly once, as `the person in the reference image`,
 * and every other clause is about the place, the wardrobe, the light, the lens
 * and the framing. test/compose-prompt.test.js asserts both halves of that: the
 * phrase appears exactly once, and no word from the person vocabulary in
 * schema.mjs appears at all.
 *
 * WHY `count` DELIBERATELY DOES NOT CHANGE THE PROMPT. It would be natural to
 * vary the wording across a batch of five stills to get five different results.
 * That is precisely backwards. The batch exists so a human can look at five
 * takes of ONE scene and pick the one where the likeness survived -- that is
 * what `--stop-after=select` and the contact sheet are for. Five differently
 * worded prompts produce five different scenes, which is not a choice between
 * takes, it is five separate gambles, and it makes the rejection gate
 * meaningless because there is nothing to compare. Variation comes from the
 * seed (see seed.mjs), which varies the sample without moving the target. The
 * parameter is validated and reported so a manifest can record the batch size,
 * and a test asserts that count:1 and count:5 produce byte-identical prompts.
 *
 * WHY THE ERA CLAUSE IS PHRASED AS SET DRESSING. "2003" handed to an image model
 * as a bare style cue reliably fetches a degraded-photograph aesthetic, which is
 * the exact thing tapedeck is for and the exact thing a prompt must never ask
 * for. Phrased as a constraint on the objects -- vehicles, packaging, signage,
 * appliances, the cut of a garment -- it does the one job it should: it keeps a
 * 2019 hatchback and a flat-screen out of the frame. Content, not texture.
 *
 * WHY THE CAMERA MAY MOVE. `hand-held` in the motion prompt is not a look
 * request. Operator movement is content the video model has to render, and it
 * is a different physical phenomenon from the transport jitter tapedeck adds --
 * that one displaces the finished tape image including its grain and its burnt-in
 * date, which no generative model can be asked for and none would do the same
 * way twice. Both belong in the pipeline; only one belongs in a prompt.
 */

/** The only reference to the person, anywhere in this module. */
export const SUBJECT = 'The person in the reference image';

/** Set dressing, not a photographic style -- see the header. */
export const DEFAULT_ERA = 'Germany between 1999 and 2005';

/**
 * Content defects, not texture. Every entry names something that must not be in
 * the frame; not one of them names a quality the picture should have, because
 * the picture's qualities are ffmpeg's department.
 *
 * `additional people` earns its place twice over: a second figure wrecks the
 * shot, and it is also the most common way an identity model resolves an
 * ambiguous reference -- by putting both interpretations in.
 */
export const BASE_NEGATIVES = Object.freeze([
  'text', 'letters', 'watermark', 'logo', 'subtitles', 'caption',
  'additional people', 'crowd', 'a second person',
  'smartphone', 'flat-screen television', 'LED lighting', 'modern car', 'modern sportswear',
  'extra fingers', 'warped hands', 'duplicated limbs',
  'illustration', 'painting', 'cartoon', '3d render',
]);

/** Motion-only additions. A cut is the one thing that would break the illusion
 *  outright: the delivery is a single continuous fifteen seconds, and a model
 *  that decides to cut has produced footage that cannot be used at all. */
export const MOTION_NEGATIVES = Object.freeze([
  'cut to another shot', 'camera cut', 'jump cut', 'slow motion', 'speed ramp',
  'time lapse', 'zoom', 'morphing', 'the location changing', 'a change of wardrobe',
]);

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

function requirePreset(preset, kind, fields) {
  if (preset === null || typeof preset !== 'object') {
    throw new TypeError(`composePrompt needs a validated ${kind} object, got ${typeof preset}`);
  }
  for (const field of fields) {
    const value = field.includes('.')
      ? field.split('.').reduce((o, k) => (o == null ? o : o[k]), preset)
      : preset[field];
    if (!isNonEmptyString(value)) {
      throw new TypeError(`${kind} "${preset.id}" is missing "${field}" -- load it through loadCatalog()`);
    }
  }
}

function requireCount(count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new TypeError(`count must be a positive integer, got ${JSON.stringify(count)}`);
  }
  return count;
}

/** Order-preserving dedup. Two presets both worrying about smartphones should
 *  cost one clause, not two, and the order is the order an author reads. */
const dedupe = (parts) => [...new Set(parts.map((p) => p.trim()).filter(Boolean))];

function buildNegative(place, outfit, extra = []) {
  return dedupe([...BASE_NEGATIVES, ...extra, ...place.negatives, ...outfit.negatives]).join(', ');
}

/**
 * One still. The identity anchor and, just as importantly, the rejection gate --
 * nothing in this pipeline should spend video money on a face a human has not
 * approved.
 *
 * @param {object} args
 * @param {object} args.place    a validated place preset
 * @param {object} args.outfit   a validated outfit preset
 * @param {string} [args.era]    set-dressing constraint, not a style
 * @param {number} [args.count]  batch size; recorded, never woven into the text
 * @returns {{prompt: string, negativePrompt: string, fragments: object}}
 */
export function composeStillPrompt({ place, outfit, era = DEFAULT_ERA, count = 1 } = {}) {
  requirePreset(place, 'place', ['id', 'label', ...['scene', 'light', 'lens', 'framing', 'eraProps'].map((f) => `prompt.${f}`)]);
  requirePreset(outfit, 'outfit', ['id', 'label', 'wardrobe']);
  requireCount(count);
  if (!isNonEmptyString(era)) throw new TypeError('era must be a non-empty string');

  const fragments = {
    subject: `${SUBJECT}, wearing ${outfit.wardrobe}.`,
    place: `Place: ${place.prompt.scene}.`,
    light: `Light: ${place.prompt.light}.`,
    lens: `Lens: ${place.prompt.lens}.`,
    framing: `Framing: ${place.prompt.framing}.`,
    props: `In frame: ${place.prompt.eraProps}.`,
    era: `Period: ${era}. Vehicles, packaging, signage, appliances and the cut of every garment are ` +
      'consistent with it, and nothing visible was manufactured later.',
    only: 'Exactly one person in frame.',
  };

  return {
    prompt: Object.values(fragments).join('\n'),
    negativePrompt: buildNegative(place, outfit),
    // The fragments are returned rather than kept private so a manifest can
    // record which clause came from which preset. When a render is wrong six
    // months later, "the light clause came from ostsee-strand" is the question
    // being asked, and reconstructing it by re-splitting the prompt is a parser
    // nobody should have to write twice.
    fragments: { ...fragments, placeId: place.id, outfitId: outfit.id, era, count },
  };
}

/**
 * One motion segment.
 *
 * `segment` is 1-based, because it is printed and because "take 0 of 3" is a
 * sentence no operator should have to translate. Segment 1 starts from the
 * approved still; every later segment starts from the previous segment's final
 * frame, and its prompt says so explicitly -- phase-0 criterion 5 is precisely
 * about whether that join is invisible, and a prompt that does not name the
 * continuation gives the model licence to re-stage the shot between takes.
 *
 * @returns {{prompt: string, negativePrompt: string}}
 */
export function composeMotionPrompt({ place, outfit, segment = 1, totalSegments = 1 } = {}) {
  requirePreset(place, 'place', ['id', 'label', 'timeOfDay', 'motionHint', 'prompt.scene', 'prompt.light']);
  requirePreset(outfit, 'outfit', ['id', 'label', 'wardrobe']);
  if (!Number.isInteger(totalSegments) || totalSegments < 1) {
    throw new TypeError(`totalSegments must be a positive integer, got ${JSON.stringify(totalSegments)}`);
  }
  if (!Number.isInteger(segment) || segment < 1 || segment > totalSegments) {
    throw new TypeError(`segment must be an integer in 1..${totalSegments}, got ${JSON.stringify(segment)}`);
  }

  const continuity = segment === 1
    ? `Take 1 of ${totalSegments}. Begin on the supplied frame and carry straight on from it.`
    : `Take ${segment} of ${totalSegments}. Continue from the final frame of the previous take: ` +
      'the same place, the same wardrobe, the same light, no cut.';

  const lines = [
    `${SUBJECT}, wearing ${outfit.wardrobe}.`,
    `Place: ${place.prompt.scene}.`,
    `Light: ${place.prompt.light}.`,
    `Motion: ${place.motionHint}.`,
    'Camera: hand-held, a slow drift and one small correction. No zoom, no cut, one continuous take.',
    `Nothing dramatic happens. This is an ordinary ${place.timeOfDay} and it simply continues.`,
    continuity,
    'Exactly one person in frame.',
  ];

  return {
    prompt: lines.join('\n'),
    negativePrompt: buildNegative(place, outfit, MOTION_NEGATIVES),
  };
}

/** Exported so the tests can hold composed output to the same vocabulary rules
 *  as the presets it was composed from. A banned word cannot enter through a
 *  preset -- schema.mjs rejects that at load -- so the only way it reaches a
 *  model is if someone types it into a template string in THIS file, which is
 *  the case this guard exists for. */
export const COMPOSED_BAN_GROUPS = Object.freeze({
  prompt: ['look', 'person'],
  // Negatives are checked for look vocabulary only. "no film grain" is still
  // the words "film grain" in the conditioning and stays banned; "extra
  // fingers, warped hands" is a defect guard, not a description of the person,
  // and every negative prompt in this class of model needs one.
  negative: ['look'],
});
