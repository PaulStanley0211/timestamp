/**
 * The preset schema. Pure validation -- no filesystem, no network, no ffmpeg.
 *
 * This file exists because the two prompt rules in CLAUDE.md are the kind of
 * rule that a human obeys for about three weeks. They are not enforceable by
 * review, because the thing that breaks them is one adjective added at 11pm to
 * a preset that was "nearly right", and nobody re-reads a JSON file they only
 * touched one line of. So they are enforced here, at load, by grep. A preset
 * that breaks a rule fails CI. It does not fail a render, and it certainly does
 * not fail quietly by producing a slightly worse video that nobody can explain.
 *
 * WHY THE SPLIT IS ENFORCED IN BOTH DIRECTIONS. "Outfits describe only what is
 * on the body, places describe everything else" reads like tidiness and is not.
 * Both fragments are concatenated into one prompt, and a diffusion model has no
 * notion of which clause outranks which. If the outfit says "on an overcast
 * day" and the place says "low late-August sun", the model averages two
 * incompatible lighting descriptions and returns something that looks lit by
 * neither -- the parka-on-a-beach-lit-like-a-beach failure. The only way to
 * guarantee the fragments cannot fight is to make it structurally impossible
 * for them to talk about the same thing, which means banning scene, light,
 * weather and lens vocabulary from OUTFIT files and banning wardrobe vocabulary
 * from PLACE files. One-directional enforcement would leave the other half free
 * to drift, so it is symmetric.
 *
 * WHY THE LOOK VOCABULARY IS BANNED EVERYWHERE, INCLUDING NEGATIVES. Asking a
 * generative model for "VHS" buys a vague nostalgic mood that varies from
 * generation to generation and then fights the deterministic chain in
 * scripts/tapedeck/. The era belongs in a prompt exclusively as CONTENT -- the
 * cut of a garment, a CRT in the corner, the shape of a car -- and the texture
 * belongs in ffmpeg, where it is a number in config/look/base.json that can be
 * swept for free. Negatives are included in the ban because "no film grain" is
 * still the word "film grain" in the conditioning, and because a negative is
 * exactly where a tired author hides the word they were told not to use.
 *
 * THE JUDGEMENT CALLS, so the next person does not re-litigate them:
 *
 *   `filter` is NOT banned, because "a filter coffee machine" is one of the
 *   best 2003 German kitchen props available and "vhs filter" is already caught
 *   by `vhs`. Banning a word for its company rather than its meaning costs real
 *   set dressing.
 *
 *   `faded` and `yellowed` are NOT banned, because "sun-faded plastic chairs"
 *   and "net curtains gone yellow" describe the physical condition of an
 *   object, which is content. `faded colours` and `washed out` ARE banned,
 *   because those describe the picture rather than the thing in it.
 *
 *   `old` is NOT banned -- "an old Opel estate" is the point -- but `elderly`
 *   is, and "an old man" is caught by `man` anyway.
 *
 *   `hand` is NOT banned as a person word. It is not an identity-blending
 *   adjective, "extra fingers, warped hands" is a defect guard every negative
 *   needs, and `hand-held` is legitimate camera-motion content.
 *
 *   Season words (`winter`, `summer`) are NOT banned in outfits. "Padded winter
 *   jacket" is a garment category, not a weather claim; the machine-readable
 *   `climate` array is the channel that actually carries weather intent, and
 *   checkCompatibility reads that rather than the prose.
 *
 * Documentation keys are exempt from every scan. A key beginning with `_` is
 * never sent to a model -- it is a note to the next author -- so `_comment`
 * saying "do not mention lighting here" must not itself trip the lighting ban.
 * mergeInto() in scripts/tapedeck/look.mjs drops `_` keys for the same reason,
 * which is why a lookOverride can be documented in place.
 */

export class PresetError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'PresetError';
    this.detail = detail;
  }
}

/** A five-point scale plus `indoor`, which sits where a heated German interior
 *  sits: at `warm`. Keeping indoor on the same axis rather than off to one side
 *  means checkCompatibility is one subtraction instead of a special case, and a
 *  winter jacket in a living room warns for exactly the same reason a winter
 *  jacket in an allotment garden in August warns. */
export const CLIMATE_SCALE = Object.freeze({ cold: 0, cool: 1, mild: 2, warm: 3, indoor: 3 });
export const CLIMATES = Object.freeze(Object.keys(CLIMATE_SCALE));

/** A closed set, because "golden hour" and "magic hour" and "late arvo" are the
 *  same value written three ways and a menu cannot group by a free-text field. */
export const TIMES_OF_DAY = Object.freeze([
  'early morning', 'morning', 'midday', 'afternoon', 'late afternoon', 'dusk', 'night',
]);

/** Every vocabulary that is banned somewhere, grouped by the reason it is
 *  banned. The groups are applied to different files -- see PLACE_BANS and
 *  OUTFIT_BANS -- because "kitchen" is the whole point of a place and a
 *  disqualification in an outfit. */
export const BANNED = Object.freeze({
  /** Rule 3. The texture is tapedeck's job and asking for it here is strictly
   *  worse than not asking: non-deterministic, and it fights the real chain. */
  look: Object.freeze([
    'vhs', 's-vhs', 'vcr', 'betamax', 'camcorder', 'handycam', 'video', 'videotape', 'tape',
    'cassette recorder', 'home movie', 'old footage', 'found footage', 'archival footage',
    'grain', 'grainy', 'film grain', 'noise', 'noisy', 'static', 'scanline', 'scan line',
    'interlace', 'interlaced', 'dropout', 'tracking error', 'head switch', 'timecode',
    'chroma bleed', 'colour bleed', 'color bleed', 'chromatic aberration', 'halation',
    'bloom', 'vignette', 'bokeh', 'soft focus', 'blurry', 'low resolution', 'low-res',
    'lowres', '480p', '576i', '240p', 'crushed black', 'washed out', 'desaturated',
    'faded colour', 'faded color', 'muted colour', 'muted color', 'sepia',
    'vintage', 'retro', 'nostalgic', 'nostalgia', 'throwback', 'old school',
    'lo-fi', 'lofi', 'low-fi', '8mm', 'super 8', '16mm', 'analog', 'analogue',
    'degraded', 'degradation', 'artifact', 'artefact', 'glitch', 'distressed',
    'filmic', 'film look', 'cinematic', 'grade', 'colour grade', 'color grade', 'lut',
    'aesthetic', 'dreamy', 'moody', 'melancholy', 'melancholic', 'wistful',
    'ethereal', 'liminal', 'eerie', 'uncanny',
  ]),

  /** Rule 1. The uploaded photo is the identity anchor; every one of these is a
   *  competing description the model blends toward. A preset cannot know who
   *  uploaded the photo, so a preset has no business containing any of them. */
  person: Object.freeze([
    'face', 'facial', 'hair', 'haircut', 'hairstyle', 'skin', 'complexion', 'freckle',
    'wrinkle', 'eye', 'eyebrow', 'eyelash', 'beard', 'moustache', 'mustache', 'stubble',
    'jawline', 'cheekbone', 'nose', 'lip', 'smile', 'smiling', 'grin', 'grinning',
    'young', 'elderly', 'middle-aged', 'teenage', 'teenager', 'toddler',
    'man', 'woman', 'men', 'women', 'boy', 'girl', 'male', 'female', 'guy', 'lady',
    'gentleman', 'slim', 'slender', 'athletic', 'muscular', 'curvy', 'chubby', 'plump',
    'stocky', 'tall', 'petite', 'handsome', 'pretty', 'beautiful', 'gorgeous',
    'attractive', 'ethnicity', 'caucasian', 'asian', 'african', 'blonde', 'blond',
    'brunette', 'redhead', 'build', 'physique', 'figure', 'body', 'age', 'aged',
    'years old', 'twenties', 'thirties', 'forties',
  ]),

  /** Rule 2, outfit half. Scene, light, weather, lens and time of day belong to
   *  the place fragment; an outfit that mentions any of them is a second,
   *  competing description of the same thing. */
  scene: Object.freeze([
    'lighting', 'sunlight', 'daylight', 'backlit', 'lit', 'sunbeam', 'sunset', 'sunrise',
    'golden hour', 'overcast', 'sky', 'cloud', 'shadow', 'rain', 'raining', 'snowing',
    'sleet', 'wind', 'windy', 'breeze', 'weather', 'fog', 'mist', 'horizon',
    'sea', 'beach', 'garden', 'kitchen', 'room', 'hallway', 'stairwell', 'balcony',
    'street', 'road', 'pool', 'indoor', 'outdoor', 'indoors', 'outdoors',
    'background', 'foreground', 'interior', 'exterior', 'wall', 'floor', 'ceiling',
    'window', 'door', 'furniture', 'landscape', 'scene', 'location', 'setting',
    'environment', 'lens', 'camera', 'framing', 'close-up', 'zoom', 'focal',
    'wide angle', 'telephoto', 'depth of field',
    'morning', 'afternoon', 'evening', 'dusk', 'dawn', 'midday', 'noon', 'night',
  ]),

  /** Rule 2, place half. Without this the drift runs the other way: a place
   *  gains "wearing a summer dress", and then every outfit fights it. */
  wardrobe: Object.freeze([
    'wearing', 'dressed', 'outfit', 'wardrobe', 'clothing', 'clothes', 'garment',
    'jacket', 'coat', 'anorak', 'parka', 'shirt', 'blouse', 't-shirt', 'dress', 'skirt',
    'jeans', 'denim', 'trousers', 'shorts', 'sweater', 'jumper', 'pullover', 'fleece',
    'hoodie', 'cardigan', 'tracksuit', 'shoe', 'sneaker', 'trainers', 'boots', 'sandal',
    'sock', 'scarf', 'glove', 'belt', 'collar', 'sleeve', 'cuff', 'hem',
  ]),
});

const PLACE_BANS = Object.freeze(['look', 'person', 'wardrobe']);
const OUTFIT_BANS = Object.freeze(['look', 'person', 'scene']);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Compile one banned term into a regular expression.
 *
 * Two details do real work. Internal whitespace and hyphens both become
 * `[\s-]+`, so one entry covers "old school" and "old-school" and "close up"
 * and "close-up" -- an author who hyphenates around the ban is not being clever
 * enough. And a plural tail of `(?:e?s)?` catches "grains" and "dresses"
 * without a second list.
 *
 * The `\b` anchors are the part that has to be right. Substring matching would
 * reject "German" for containing "man", "chairs" for "hair", "sundress" for
 * "sun", "windbreaker" for "wind" and "packaged" for "aged" -- five false
 * positives from five different lists, every one of which would be blamed on
 * the preset rather than on the matcher.
 */
function termToRegExp(term) {
  const tokens = term.trim().split(/[\s-]+/).map(escapeRe);
  const lead = /^\w/.test(term) ? '\\b' : '';
  const tail = /[A-Za-z]$/.test(term) ? '(?:e?s)?\\b' : /\w$/.test(term) ? '\\b' : '';
  return new RegExp(`${lead}${tokens.join('[\\s-]+')}${tail}`, 'i');
}

const COMPILED = new Map(
  Object.entries(BANNED).map(([group, terms]) => [group, terms.map((t) => [t, termToRegExp(t)])]),
);

/**
 * Scan a string against the named ban groups.
 *
 * Returns every hit rather than the first, because a preset with four problems
 * should cost one CI run to fix, not four.
 *
 * @param {string} text
 * @param {string[]} groups  keys of BANNED
 * @returns {{group: string, term: string, match: string}[]}
 */
export function scanText(text, groups) {
  if (typeof text !== 'string' || !text) return [];
  const hits = [];
  for (const group of groups) {
    for (const [term, re] of COMPILED.get(group) ?? []) {
      const m = re.exec(text);
      if (m) hits.push({ group, term, match: m[0] });
    }
  }
  return hits;
}

/**
 * Fields the vocabulary scan does not read, and why each one is exempt.
 *
 * `lookOverride` is ffmpeg parameters -- `PI/12`, a curve string -- and is never
 * shown to a model, so scanning it would only produce nonsense failures.
 *
 * `climate` and `timeOfDay` are closed enumerations, validated by membership a
 * few lines further down, and they are the designated machine-readable channel
 * for exactly the intent the prose is forbidden to carry. Scanning them would
 * reject `"climate": ["indoor", "mild"]` on an outfit for containing the scene
 * word "indoor" -- which is not merely a false positive, it would break the one
 * mechanism the ban exists to protect.
 */
const UNSCANNED = new Set(['lookOverride', 'climate', 'timeOfDay']);

/** Walk every string value in a preset, skipping documentation keys and the
 *  exempt fields above. */
function* strings(value, path = '', { skip = () => false } = {}) {
  if (typeof value === 'string') { yield [path, value]; return; }
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) yield* strings(v, `${path}[${i}]`, { skip });
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('_')) continue;
      const next = path ? `${path}.${k}` : k;
      if (skip(next)) continue;
      yield* strings(v, next, { skip });
    }
  }
}

function assertClean(raw, groups, { kind, id }) {
  const failures = [];
  for (const [path, text] of strings(raw, '', { skip: (p) => UNSCANNED.has(p) })) {
    for (const hit of scanText(text, groups)) {
      failures.push(`${path}: "${hit.match}" (banned ${hit.group} vocabulary: "${hit.term}")`);
    }
  }
  if (failures.length) {
    throw new PresetError(
      `${kind} "${id}" uses vocabulary the schema forbids:\n  ${failures.join('\n  ')}\n` +
      explain(groups),
      { kind, id, failures },
    );
  }
}

function explain(groups) {
  const lines = [];
  if (groups.includes('look')) {
    lines.push('  the look is applied deterministically in ffmpeg by scripts/tapedeck/ -- ' +
      'name the object, not the texture ("a CRT in the corner", not "VHS")');
  }
  if (groups.includes('person')) {
    lines.push('  the uploaded photo is the identity anchor -- a preset must never describe the person');
  }
  if (groups.includes('scene')) {
    lines.push('  an outfit describes only what is on the body -- scene, light, weather and lens belong to the place');
  }
  if (groups.includes('wardrobe')) {
    lines.push('  a place describes everything except the body -- wardrobe belongs to the outfit');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// field helpers
// ---------------------------------------------------------------------------

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function requireString(raw, key, { kind, id, maxWords = 90 }) {
  const value = raw[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new PresetError(`${kind} "${id}" is missing a non-empty string field "${key}"`, { kind, id, key });
  }
  const words = value.trim().split(/\s+/).length;
  if (words > maxWords) {
    throw new PresetError(
      `${kind} "${id}" field "${key}" is ${words} words. Fragments are concatenated into one prompt; ` +
      'past roughly 90 words per fragment the model starts dropping clauses, and the clause it drops is not the one you would choose.',
      { kind, id, key, words },
    );
  }
  return value.trim();
}

function requireStringArray(raw, key, { kind, id }) {
  const value = raw[key] ?? [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) {
    throw new PresetError(`${kind} "${id}" field "${key}" must be an array of non-empty strings`, { kind, id, key });
  }
  return value.map((v) => v.trim());
}

/** Every dotted leaf path in a partial LookProfile override. Arrays are leaves,
 *  because mergeLook() replaces an array wholesale rather than merging into it
 *  -- a preset saying "these tears" means instead of, never as well as. */
export function lookOverridePaths(override, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(override ?? {})) {
    if (key.startsWith('_')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) out.push(...lookOverridePaths(value, path));
    else out.push(path);
  }
  return out;
}

const getPath = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

/**
 * A lookOverride may only name paths that already exist in config/look/base.json.
 *
 * This catches the single most likely preset bug and the one with the worst
 * symptom. mergeLook() is a deep merge with no schema, so `tape: { grainStrengh: 30 }`
 * does not throw -- it quietly adds a new key that nothing reads, the render
 * succeeds, the grain is unchanged, and the author concludes the override
 * "doesn't do much" and doubles a different number to compensate. Checking the
 * path against the base profile turns a silent no-op into a named CI failure.
 */
export function assertLookOverride(override, baseLook, { kind, id }) {
  if (!isPlainObject(override)) {
    throw new PresetError(`${kind} "${id}" field "lookOverride" must be an object`, { kind, id });
  }
  if (!baseLook) return override;
  const missing = lookOverridePaths(override).filter((p) => getPath(baseLook, p) === undefined);
  if (missing.length) {
    throw new PresetError(
      `${kind} "${id}" lookOverride names ${missing.length} path(s) that do not exist in config/look/base.json:\n  ` +
      `${missing.join('\n  ')}\n` +
      '  a path that does not exist merges in silently and is read by nothing -- the render succeeds and the look does not change',
      { kind, id, missing },
    );
  }
  return override;
}

// ---------------------------------------------------------------------------
// the two validators
// ---------------------------------------------------------------------------

/** The prompt fragments a place owns. The names are the argument: a place is
 *  responsible for the scene, the light, the lens, the framing and the era
 *  props, and an outfit is responsible for none of them. */
export const PLACE_FRAGMENTS = Object.freeze(['scene', 'light', 'lens', 'framing', 'eraProps']);

/** Fragments a place MAY own. Optional rather than required because
 *  `composeStillPrompt` carries a generic floor for each of them, so adding one
 *  here breaks no shipped preset and a place typed as free text still gets the
 *  clause. They are validated exactly as the required ones are when present --
 *  an optional field that skips the vocabulary rules is a hole in rule 1.
 *
 *  `moment`: what is HAPPENING, as opposed to what is in frame. A brief with no
 *  action in it is a portrait brief, and the model answers it with a portrait. */
export const PLACE_OPTIONAL_FRAGMENTS = Object.freeze(['moment']);

/**
 * @param {object} raw    parsed JSON
 * @param {object} opts
 * @param {string} opts.id        expected id, normally the filename stem
 * @param {object} [opts.baseLook] config/look/base.json, injected so this file stays pure
 */
export function validatePlace(raw, { id, baseLook } = {}) {
  const kind = 'place';
  if (!isPlainObject(raw)) throw new PresetError(`${kind} "${id}" is not a JSON object`, { kind, id });
  if (raw.id !== id) {
    throw new PresetError(
      `${kind} file declares id "${raw.id}" but is named "${id}". The filename is the id used on the ` +
      'command line and in a manifest; two sources of truth for it is one too many.',
      { kind, id, declared: raw.id },
    );
  }

  const climate = raw.climate;
  if (!CLIMATES.includes(climate)) {
    throw new PresetError(
      `${kind} "${id}" climate "${climate}" is not one of ${CLIMATES.join(', ')}`, { kind, id },
    );
  }
  const timeOfDay = raw.timeOfDay;
  if (!TIMES_OF_DAY.includes(timeOfDay)) {
    throw new PresetError(
      `${kind} "${id}" timeOfDay "${timeOfDay}" is not one of ${TIMES_OF_DAY.join(', ')}`, { kind, id },
    );
  }
  if (!isPlainObject(raw.prompt)) {
    throw new PresetError(`${kind} "${id}" is missing the "prompt" object`, { kind, id });
  }

  assertClean(raw, PLACE_BANS, { kind, id });

  const prompt = {};
  for (const key of PLACE_FRAGMENTS) prompt[key] = requireString(raw.prompt, key, { kind, id });
  for (const key of PLACE_OPTIONAL_FRAGMENTS) {
    if (raw.prompt[key] === undefined) continue;
    prompt[key] = requireString(raw.prompt, key, { kind, id });
  }

  const place = {
    id,
    label: requireString(raw, 'label', { kind, id, maxWords: 10 }),
    climate,
    timeOfDay,
    prompt,
    negatives: requireStringArray(raw, 'negatives', { kind, id }),
    motionHint: requireString(raw, 'motionHint', { kind, id }),
    lookOverride: assertLookOverride(raw.lookOverride ?? {}, baseLook, { kind, id }),
  };
  return Object.freeze(place);
}

export function validateOutfit(raw, { id } = {}) {
  const kind = 'outfit';
  if (!isPlainObject(raw)) throw new PresetError(`${kind} "${id}" is not a JSON object`, { kind, id });
  if (raw.id !== id) {
    throw new PresetError(
      `${kind} file declares id "${raw.id}" but is named "${id}"`, { kind, id, declared: raw.id },
    );
  }

  const climate = raw.climate;
  if (!Array.isArray(climate) || climate.length === 0 || climate.some((c) => !CLIMATES.includes(c))) {
    throw new PresetError(
      `${kind} "${id}" climate must be a non-empty array drawn from ${CLIMATES.join(', ')}`, { kind, id },
    );
  }

  assertClean(raw, OUTFIT_BANS, { kind, id });

  const outfit = {
    id,
    label: requireString(raw, 'label', { kind, id, maxWords: 10 }),
    climate: [...new Set(climate)],
    wardrobe: requireString(raw, 'wardrobe', { kind, id }),
    negatives: requireStringArray(raw, 'negatives', { kind, id }),
  };
  return Object.freeze(outfit);
}
