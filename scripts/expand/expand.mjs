/**
 * Expand. Turns `"a beach"` into the same eight-line shape a hand-written place
 * has, and holds the result to exactly the bar a shipped preset clears.
 *
 * WHY THIS MODULE EXISTS. The scope change of 2026-08-20 made free input the
 * norm: anyone types a location and an outfit and gets a video. The eight
 * places and six outfits stopped being the menu and became two things at once
 * -- the recommendations, and the quality template that free text is expanded
 * into. Without the second of those, a text box is a promise the pipeline
 * cannot keep: a free-text place produces a prompt with no era props, no motion
 * hint and the base look profile, which is a materially worse video the user
 * will nonetheless blame on the product.
 *
 * THE SAFETY PROPERTY, and it is the only one that matters here. Whatever comes
 * out of an expander -- this one, a Claude call, anything -- is run through
 * `validatePlace` / `validateOutfit` UNCHANGED. Same schema, same banned
 * vocabulary, same place/outfit split, same word limits. Expansion is therefore
 * incapable of producing a prompt that a preset could not have contained, which
 * is what makes free text tractable at all. When expansion produces something
 * the schema rejects, this module refuses with a message naming the rule. It
 * does not patch the output and it does not relax the schema, because both of
 * those turn one validator into two and the second one is always weaker.
 *
 * The three prompt rules apply to expanded text exactly as they do to a shipped
 * preset, and each is enforced twice -- once by dropping the offending clause
 * in local.mjs before assembly, and once by the schema at the end:
 *
 *   1. Never describe the person. "a beach, me looking younger" expands to a
 *      beach. The photo is the identity anchor and every adjective about face,
 *      build, hair or age is a competing description the model blends toward.
 *   2. Outfits describe only what is on the body; places describe everything
 *      else. "a hoodie on the beach" expands to a hoodie, because an outfit
 *      that carries a place is a second, competing description of the scene.
 *   3. Never ask the model for the look. "grainy VHS beach" expands to a beach.
 *      The texture is deterministic in ffmpeg and asking a model for it is
 *      strictly worse than not asking.
 *
 * WHY `expandImpl` IS A SEAM AND NOT A CALL. There is no fetch in this file, no
 * API key, no dependency, and no default that could reach the network. The
 * local expander is the default because the app has to run end to end today for
 * zero dollars, because `npm test` must stay unable to spend money, and because
 * a manifest has to be reproducible a year later on a machine with no
 * credentials. EXPAND_PROMPT_TEMPLATE below is the exact prompt a Claude impl
 * would send, written out and testable, so the model version is one injection
 * rather than a rewrite. Note what it is NOT: an escape hatch. A model's output
 * goes through the same validator, and test/expand.test.js drives a deliberately
 * hostile fake impl to prove that a model asking for "grainy VHS" is refused
 * rather than passed through.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO. It does not moderate. Length,
 * shape and injection stripping belong to `scripts/safety/moderate.mjs`, which
 * runs at step 2 of the pipeline, before expand at step 3. The shape guard
 * below is a backstop for direct callers (the CLI, a test), not a second
 * implementation -- and per interfaces.md §4 rule 4 there is exactly one banned
 * word list in this repo, in schema.mjs, and this module reuses it.
 */

import { PresetError, validateOutfit, validatePlace } from '../catalog/schema.mjs';
import { canonicalId, localExpander } from './local.mjs';

export { localExpander };

/**
 * A refusal. `.userMessage` is safe to show to whoever typed the text; it names
 * the rule and, where there is one, the exact word that tripped it, because
 * "that isn't allowed" makes a person guess and "the word 'grainy' describes
 * the picture rather than the place" makes them rewrite.
 */
export class ExpandError extends Error {
  constructor(code, userMessage, detail = {}) {
    super(`${code}: ${userMessage}`);
    this.name = 'ExpandError';
    this.code = code;
    this.userMessage = userMessage;
    this.detail = detail;
  }
}

/** Free text is short on purpose. Two hundred characters is longer than any
 *  shipped fragment's opening clause and short enough that a whole paragraph of
 *  instructions cannot hide in it. */
export const TEXT_LIMITS = Object.freeze({ min: 2, max: 200 });

/**
 * @typedef {Object} ExpandRequest
 * @property {'place'|'outfit'|'place-from-photo'} kind
 * @property {string} text          the user's words, verbatim; '' for a bare photo
 * @property {string|null} photoPath absolute path, set only for place-from-photo
 * @property {number} seed          derived, never random -- see compose/seed.mjs
 * @property {object} catalog       loadCatalog() result; the few-shot corpus
 * @property {string} prompt        the exact prompt an LLM impl should send
 *
 * @typedef {Object} ExpandResponse
 * @property {object|null} draft    preset-shaped JSON, NOT yet validated
 * @property {Array<{text:string,rule:string,term:string}>} dropped
 * @property {string|null} reason   why draft is null, in a sentence
 *
 * An expandImpl is `(request: ExpandRequest) => ExpandResponse | Promise<ExpandResponse>`.
 * It may do anything it likes, including nothing useful; its output is not
 * trusted and is validated by the caller.
 */

// ---------------------------------------------------------------------------
// the prompt a Claude impl would send. Not wired up. Written out so that
// wiring it up is one injection and so that its rules are under test.
// ---------------------------------------------------------------------------

/** The three rules, in the words they are argued in. Exported because the
 *  prompt and the tests must not be able to drift apart from each other. */
export const EXPAND_RULES = Object.freeze([
  'Never describe the person. The uploaded photograph is the only authority on who is in the frame. ' +
  'No face, build, hair, age, gender or ethnicity, not even implied. If the request describes the person, ' +
  'drop that part and expand the rest.',

  'A place describes the scene, the light, the lens, the framing and the era props, and nothing that is worn. ' +
  'An outfit describes only what is on the body, and never the scene, the light, the weather, the time of day or the lens. ' +
  'The two fragments are concatenated into one prompt and a model has no notion of which clause outranks which, ' +
  'so if both describe the light you get a frame lit by neither.',

  'Never ask for the look. No grain, no VHS, no tape, no vintage, no nostalgic, no film, no washed out, ' +
  'no muted colour, no cinematic, no moody -- in the prose OR in the negatives. The texture is applied ' +
  'deterministically in ffmpeg afterwards. Name the object, not the texture: "a CRT in the corner", never "VHS".',
]);

/**
 * The exact prompt. `{{...}}` placeholders are filled by buildExpandPrompt.
 *
 * The fourteen shipped presets go in as few-shot examples in full, because the
 * thing being taught is not the JSON shape -- that is one line -- it is the
 * register: named props beat adjectives, a light fragment names what the light
 * comes FROM, an era prop is an object rather than a decade, and a scene is a
 * list of specific things rather than a mood. That is learnable from examples
 * and close to unstateable as a rule.
 */
export const EXPAND_PROMPT_TEMPLATE = `You are expanding one short phrase from a user into a single {{KIND}} fragment
for a 2003 German camcorder-tape video. The user's photograph supplies the person; you supply
everything else about {{SCOPE}}.

THE THREE RULES. Breaking any of them makes the output unusable, and it is checked mechanically
after you answer -- a violation is refused, not corrected.

{{RULES}}

REGISTER. Named props beat adjectives. "a glass bottle of mineral water with a foil label" places the
decade on its own; "nostalgic summer atmosphere" places nothing. Everything visible was manufactured
before 2005. Nothing dramatic is happening: this is an ordinary afternoon that simply continues.

OUTPUT. Return one JSON object and nothing else -- no prose, no code fence.
{{SHAPE}}

Every prose field is at most 80 words. Use British English. Write in the register of the examples.

EXAMPLES. These are the shipped presets. Match their level of specificity, not their subject matter.

{{EXAMPLES}}

THE REQUEST: {{REQUEST}}`;

const SHAPES = Object.freeze({
  place: `{
  "id": "<given to you below; copy it exactly>",
  "label": "<at most 10 words>",
  "climate": "<one of: cold, cool, mild, warm, indoor>",
  "timeOfDay": "<one of: early morning, morning, midday, afternoon, late afternoon, dusk, night>",
  "prompt": {
    "scene": "<what is there: a list of specific objects and surfaces>",
    "light": "<what the light comes from and what it does>",
    "lens": "<focal length feel, focus depth, edge behaviour>",
    "framing": "<where the person stands and what is behind them>",
    "eraProps": "<four or five named objects that date the frame>"
  },
  "negatives": ["<things that must not be in frame>"],
  "motionHint": "<what moves, slowly, without anyone doing anything>",
  "lookOverride": {}
}`,
  outfit: `{
  "id": "<given to you below; copy it exactly>",
  "label": "<at most 10 words>",
  "climate": ["<one or more of: cold, cool, mild, warm, indoor>"],
  "wardrobe": "<the garments, their material, colour, cut and one period detail>",
  "negatives": ["<cuts, fabrics and branding that would date it wrongly>"]
}`,
  'place-from-photo': `{
  "id": "<given to you below; copy it exactly>",
  "label": "<at most 10 words>",
  "climate": "<one of: cold, cool, mild, warm, indoor>",
  "timeOfDay": "<one of: early morning, morning, midday, afternoon, late afternoon, dusk, night>",
  "prompt": {
    "scene": "<say that the second reference image IS the place; describe nothing you cannot see>",
    "light": "<say that the reference image's own light is matched, not replaced>",
    "lens": "<focal length feel, focus depth, edge behaviour>",
    "framing": "<where the person stands in the place the reference image shows>",
    "eraProps": "<only what the reference image already contains>"
  },
  "negatives": ["<a different place, invented architecture, added furniture>"],
  "motionHint": "<what moves, slowly, without anyone doing anything>",
  "lookOverride": {}
}`,
});

const SCOPES = Object.freeze({
  place: 'the place, the light, the lens, the framing and the era props',
  outfit: 'what is on the body, and nothing else',
  'place-from-photo': 'how the second reference image is used, and nothing it does not already show',
});

const exampleJson = (preset) => JSON.stringify(preset, null, 2);

/**
 * The prompt for one request, few-shots and all. Pure -- no network, no clock.
 *
 * Always built, even for the local expander, and handed to the impl in the
 * request. That is deliberate: it costs nothing, and it means the prompt cannot
 * quietly rot while nobody is using it. The CLI prints it under `--prompt`, so
 * a human can read what a model would be asked before anyone pays for one.
 */
export function buildExpandPrompt({ kind, text, photoPath, catalog, id }) {
  const examples = kind === 'outfit'
    ? [...catalog.outfits.values()]
    : [...catalog.places.values()];

  const request = kind === 'place-from-photo'
    ? `the user uploaded a photograph of the place (${photoPath ?? 'reference image'})` +
      `${text ? ` and typed "${text}"` : ' and typed nothing'}. id: "${id}"`
    : `"${text}". id: "${id}"`;

  return EXPAND_PROMPT_TEMPLATE
    .replace('{{KIND}}', kind === 'outfit' ? 'outfit' : 'place')
    .replace('{{SCOPE}}', SCOPES[kind])
    .replace('{{RULES}}', EXPAND_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n\n'))
    .replace('{{SHAPE}}', SHAPES[kind])
    .replace('{{EXAMPLES}}', examples.map(exampleJson).join('\n\n'))
    .replace('{{REQUEST}}', request);
}

// ---------------------------------------------------------------------------
// the shared path: guard, expand, validate, refuse
// ---------------------------------------------------------------------------

/** Shape only. See the header: moderation is moderate.mjs's job and this is the
 *  backstop for a caller that reached expand directly. */
function guardText(text, kind) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new ExpandError('EMPTY', `Type a ${kind} -- a few words is enough, like "a beach" or "an old hoodie".`, { kind });
  }
  const trimmed = text.trim();
  if (trimmed.length < TEXT_LIMITS.min) {
    throw new ExpandError('TOO_SHORT', `"${trimmed}" is too short to expand. Two characters is the minimum, a few words is better.`, { kind });
  }
  if (trimmed.length > TEXT_LIMITS.max) {
    throw new ExpandError('TOO_LONG',
      `That is ${trimmed.length} characters and the limit is ${TEXT_LIMITS.max}. ` +
      'A fragment past roughly ninety words starts losing clauses inside the model, and not the ones you would choose.',
      { kind, length: trimmed.length });
  }
  if (/[\r\n]/.test(text)) {
    throw new ExpandError('NOT_SINGLE_LINE', 'Keep it to one line -- this is a description of a thing, not a set of instructions.', { kind });
  }
  if (/https?:\/\/|www\./i.test(trimmed)) {
    throw new ExpandError('CONTAINS_URL', 'Links cannot be part of a description. Say what is there instead.', { kind });
  }
  if (/```|<[a-z/][^>]*>/i.test(trimmed)) {
    throw new ExpandError('CONTAINS_MARKUP', 'Plain words only -- no code fences and no markup.', { kind });
  }
  return trimmed;
}

/** The refusal when every clause broke a rule. It quotes what was dropped and
 *  names the rule, because the user's next move is to rewrite and they can only
 *  do that if they know which half of their sentence was the problem. */
function refuseEmpty(kind, text, response) {
  const named = response.dropped.map((d) => `"${d.match ?? d.term}" (${RULE_NAMES[d.rule] ?? d.rule})`);
  throw new ExpandError('NOTHING_LEFT',
    `Nothing in "${text}" describes a ${kind === 'outfit' ? 'garment' : 'place'} -- ${response.reason}. ` +
    (named.length ? `Dropped: ${named.join(', ')}. ` : '') +
    (kind === 'outfit'
      ? 'Describe what is on the body; the place goes in the other box.'
      : 'Describe what is there; the tape look is added afterwards and the photograph supplies the person.'),
    { kind, text, dropped: response.dropped });
}

const RULE_NAMES = Object.freeze({
  person: 'the photograph is what says who is in the frame',
  look: 'the tape look is applied afterwards, in ffmpeg',
  scene: 'the place belongs in the place box',
  wardrobe: 'wardrobe belongs in the outfit box',
});

function requireResponse(response, kind) {
  if (response === null || typeof response !== 'object') {
    throw new ExpandError('IMPL_SHAPE', `The ${kind} expander returned ${typeof response} instead of a draft.`, { kind });
  }
  if (!Array.isArray(response.dropped)) {
    throw new ExpandError('IMPL_SHAPE', `The ${kind} expander returned no "dropped" list.`, { kind });
  }
  if (response.draft !== null && (typeof response.draft !== 'object' || Array.isArray(response.draft))) {
    throw new ExpandError('IMPL_SHAPE', `The ${kind} expander returned a draft that is not an object.`, { kind });
  }
  return response;
}

function requireSeed(seed) {
  if (seed === undefined) return 0;
  if (!Number.isInteger(seed) || seed < 0) {
    throw new TypeError(`seed must be a non-negative integer, got ${JSON.stringify(seed)}`);
  }
  return seed;
}

function requireCatalog(catalog) {
  if (!catalog?.places?.size || !catalog?.outfits?.size) {
    throw new TypeError('expand needs a loadCatalog() result -- the shipped presets are the few-shot skeletons');
  }
  return catalog;
}

/**
 * Validate, and turn a schema rejection into a refusal a person can act on.
 *
 * This is the hinge of the whole module. `validatePlace` is called with exactly
 * the arguments loadCatalog calls it with, on a draft that came from anywhere,
 * and nothing here catches a specific rule in order to work around it. A
 * PresetError becomes an ExpandError with the schema's own explanation attached,
 * because the schema's message already names the field, the term and the reason.
 */
function validateOrRefuse(draft, { kind, id, baseLook, source }) {
  try {
    return kind === 'outfit'
      ? validateOutfit(draft, { id })
      : validatePlace(draft, { id, baseLook });
  } catch (err) {
    if (!(err instanceof PresetError)) throw err;
    throw new ExpandError('SCHEMA_REJECTED',
      `That could not be expanded into a usable ${kind}: ${err.message}`,
      { kind, id, source, detail: err.detail });
  }
}

async function expandThrough(kind, { text, photoPath, catalog, seed, expandImpl, baseLook }) {
  requireCatalog(catalog);
  const impl = expandImpl ?? localExpander;
  const id = canonicalId(kind, text ?? '');

  const request = Object.freeze({
    kind,
    text: text ?? '',
    photoPath: photoPath ?? null,
    seed: requireSeed(seed),
    catalog,
    id,
    prompt: buildExpandPrompt({ kind, text: text ?? '', photoPath, catalog, id }),
  });

  const response = requireResponse(await impl(request), kind);
  if (!response.draft) refuseEmpty(kind, text ?? '', response);

  // The id is ours to assign, not the expander's -- see canonicalId. Copying
  // the draft rather than mutating it keeps a caller's fake impl honest: an
  // impl that hands back a frozen object still works.
  const draft = { ...response.draft, id };
  return validateOrRefuse(draft, { kind, id, baseLook, source: response.draft._source ?? null });
}

/**
 * `"a beach"` -> a validated place object, identical in shape to a shipped one.
 *
 * @param {string} text
 * @param {object} opts
 * @param {object} opts.catalog          loadCatalog() result
 * @param {number} [opts.seed]           breaks ties between equally near skeletons
 * @param {Function} [opts.expandImpl]   the seam; defaults to localExpander
 * @param {object} [opts.baseLook]       config/look/base.json, for lookOverride paths
 * @returns {Promise<object>} frozen, exactly what validatePlace returns
 *
 * `async` rather than a plain function returning a promise, so that a refusal
 * on the shape guard arrives as a rejection like every other refusal. A mixed
 * API -- throws synchronously here, rejects there -- is the kind of thing one
 * caller handles and the next one does not.
 */
export async function expandPlace(text, { catalog, seed, expandImpl, baseLook } = {}) {
  const cleaned = guardText(text, 'place');
  return expandThrough('place', { text: cleaned, catalog, seed, expandImpl, baseLook });
}

/**
 * `"an old hoodie"` -> a validated outfit object.
 *
 * @returns {Promise<object>} frozen, exactly what validateOutfit returns
 */
export async function expandOutfit(text, { catalog, seed, expandImpl, baseLook } = {}) {
  const cleaned = guardText(text, 'outfit');
  return expandThrough('outfit', { text: cleaned, catalog, seed, expandImpl, baseLook });
}

/**
 * The reference-image path: the user uploaded a photograph of the place.
 *
 * This is the emotionally strongest version of the product -- your actual
 * childhood garden, which no preset menu can offer -- and the expansion is
 * deliberately minimal because of it. The photograph carries the scene; the
 * prose says what the photograph is for, keeps the era and lens clauses the
 * image cannot carry on its own, and stops. Inventing a detail that contradicts
 * the reference is worse than saying little, because the model has to reconcile
 * the two and the result is a garden that is neither.
 *
 * @param {string} photoPath
 * @param {object} opts
 * @param {string} [opts.text]   an optional typed hint alongside the upload
 */
export async function placeFromPhoto(photoPath, { catalog, seed, expandImpl, baseLook, text = '' } = {}) {
  if (typeof photoPath !== 'string' || !photoPath.trim()) {
    throw new ExpandError('NO_PHOTO', 'A place photograph is needed for this path -- or type the place instead.', {});
  }
  const hint = text ? guardText(text, 'place') : '';
  return expandThrough('place-from-photo', { text: hint, photoPath, catalog, seed, expandImpl, baseLook });
}
