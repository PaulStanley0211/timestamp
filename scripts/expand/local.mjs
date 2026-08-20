/**
 * The deterministic offline expander. No network, no model, no clock, no
 * randomness -- the same text and the same seed produce the same bytes, and
 * test/expand-local.test.js runs it five times to prove it.
 *
 * WHY A LOCAL EXPANDER EXISTS AT ALL, when a Claude call would plainly write
 * better prose. Because the app has to run end to end today for zero dollars,
 * and because an expander that is a network call is an expander that cannot be
 * tested, cannot be reproduced from a manifest a year later, and turns every
 * `npm test` into a question about whether a key is in the environment. This
 * file is the floor, not the ceiling: `expandImpl` in expand.mjs is the seam
 * where a model goes, and the model's output is held to exactly the same
 * schema this one is.
 *
 * THE ALGORITHM, in one paragraph. Clean the user's text by dropping the
 * clauses that break a prompt rule. Score every shipped place against what is
 * left, and take the nearest one as a skeleton. Substitute the user's subject
 * for the skeleton's opening clause and keep the skeleton's remaining PROP
 * clauses, because named props beat adjectives and those props were written by
 * hand by someone who looked at the result. Keep the skeleton's light, lens and
 * era props unless the user's text clearly overrides them -- "at night" against
 * a midday skeleton is an override, "a beach" is not. Infer the climate from an
 * explicit table, because checkCompatibility reads it and a wrong climate is a
 * wrong warning.
 *
 * WHY THE SKELETON'S PROP CLAUSES ARE KEPT RATHER THAN REWRITTEN. This is the
 * single decision that makes mechanical expansion produce a usable prompt. The
 * user gives us a noun; a noun on its own generates a stock photograph. The
 * hand-written clause "a line of roofed wicker beach chairs turned away from
 * the water" is what makes a beach a specific beach in a specific decade, and
 * no keyword algorithm can invent one. Borrowing it is the whole trick, and its
 * cost is stated honestly: the borrowed props are the nearest neighbour's, so a
 * request far from all eight skeletons gets props that are merely plausible
 * rather than right. That is why a request that matches nothing falls to
 * NEUTRAL below instead of inheriting an arbitrary neighbour's set dressing.
 *
 * WHAT THIS FILE MUST NEVER DO. It must never produce text that validatePlace
 * or validateOutfit would reject -- not by loosening the schema, which is not
 * this module's to loosen, but by refusing. Every clause that would trip a ban
 * is dropped here, before assembly, and whatever survives is still run through
 * the real validator by expand.mjs. If nothing survives, that is a refusal with
 * a message naming the rule, which is a strictly better outcome than a prompt
 * that describes the user's face.
 */

import { CLIMATE_SCALE, TIMES_OF_DAY, scanText } from '../catalog/schema.mjs';

// ---------------------------------------------------------------------------
// hand-written material -- the part of this file that is quality rather than code
// ---------------------------------------------------------------------------

/**
 * One light fragment per time of day, in the register of the shipped presets.
 *
 * These exist because a time-of-day override is the one override a user makes
 * constantly ("a car park at night") and the one the skeleton gets most wrong:
 * inheriting "the last blue in the sky" for a scene the user said was at night
 * produces a dusk photograph with a night caption, and the caption is the half
 * nobody sees. Every entry names what the light is coming FROM, because a
 * source is content and "moody" is not.
 */
export const LIGHT_BY_TIME = Object.freeze({
  'early morning': 'thin grey first light with everything still cold, one warm bulb left on from the night before, the two colours plainly not matching',
  morning: 'flat morning light, the shadows still long and the colours cool, nothing warmed through yet',
  midday: 'flat overhead brightness through high cloud, almost no shadow anywhere, every surface pale',
  afternoon: 'even light with the sun behind cloud, mild shadows, nothing bright enough to squint at',
  'late afternoon': 'low sun coming in from one side, long shadows across everything, warm and completely ordinary',
  dusk: 'the last blue draining out of the sky, the first lamps just coming on, the two plainly not matching',
  night: 'dark except for what is switched on, a doorway, a window with the curtains open, a lamp on a post, and the sky above gone to nothing',
});

/**
 * Weather beats time of day, because a user who says "in the rain" has told us
 * something the clock cannot. Each entry describes the light the weather makes,
 * never the picture the weather makes -- "grey light under low cloud" is the
 * scene, "washed out" would be tapedeck's job done badly.
 */
export const LIGHT_BY_WEATHER = Object.freeze({
  rain: 'grey light under low cloud, every surface wet and darker than it should be, standing water holding the reflections',
  snow: 'flat white light coming off the snow, no shadow to speak of, the ground brighter than the sky',
  sun: 'direct sun with a hard edge to every shadow, warm and completely ordinary',
  fog: 'everything close by going pale and everything further off simply not there',
});

/**
 * Indoors, the sky is not a light source and every entry in LIGHT_BY_TIME says
 * it is. "the school gym" inferred `indoor` and then borrowed "even light with
 * the sun behind cloud" from the neutral skeleton, which is a description of
 * being outside attached to a place the machine-readable field says is inside.
 * Two colours that do not match is the German-interior cue the kitchen preset
 * is built on, so both entries keep it.
 */
export const LIGHT_INDOORS = Object.freeze({
  day: 'fluorescent tubes overhead and grey daylight from a window at one end, the two colours plainly not matching',
  night: 'one warm bulb and nothing else, the corners of the room going dark',
});

const WEATHER_TERMS = Object.freeze([
  ['snow', ['snow', 'snowy', 'snowing', 'blizzard', 'sledging', 'sledge']],
  ['rain', ['rain', 'rainy', 'raining', 'drizzle', 'downpour', 'wet', 'puddle', 'puddles', 'storm']],
  ['fog', ['fog', 'foggy', 'mist', 'misty', 'haze']],
  ['sun', ['sunny', 'sunshine', 'bright sun', 'blazing', 'heatwave']],
]);

/**
 * Light by climate, used only when the chosen skeleton's own light has been
 * discarded for contradicting the request -- see the dressing rule in
 * expandPlaceDraft. `cool`, `mild` and `indoor` are deliberately absent: the
 * first two are what LIGHT_BY_TIME already describes, and indoors has its own
 * table below because a sky is not a light source there at all.
 */
export const LIGHT_BY_CLIMATE = Object.freeze({
  warm: 'direct sun with a hard edge to every shadow, warm and completely ordinary',
  cold: 'flat cold light with no warmth in it, the sky and the ground nearly the same grey, hardly any shadow',
});

/** Two lens fragments, for the only two lens intents a short piece of free text
 *  can express unambiguously. Anything subtler is inherited from the skeleton,
 *  because a guessed lens is worse than a borrowed one. */
export const LENS_OVERRIDES = Object.freeze({
  close: 'a consumer zoom pushed in, shallow focus with the far side of the frame going soft, a little barrel bend at the edges',
  wide: 'a consumer zoom at its wide end, deep focus from the front of the frame all the way to the back, a little barrel bend at the edges',
});

/**
 * The skeleton used when the text resembles none of the eight shipped places.
 *
 * The alternative -- always taking the highest-scoring place even when the top
 * score is zero -- is worse than it looks. A zero-overlap winner is whichever
 * place happens to sort first, and its era props then actively contradict the
 * scene: a lifeguard chair and a locker key in someone's description of a
 * lighthouse. Neutral, non-specific set dressing is a weaker prompt and an
 * honest one.
 */
export const NEUTRAL_PLACE = Object.freeze({
  id: '_neutral',
  label: 'Somewhere ordinary',
  climate: 'mild',
  timeOfDay: 'afternoon',
  prompt: Object.freeze({
    scene: 'somewhere ordinary and lived in, nothing staged, everything exactly where it would actually be',
    light: LIGHT_BY_TIME.afternoon,
    lens: LENS_OVERRIDES.wide,
    framing: 'waist-up, three-quarters to the camera',
    // Every one of these works indoors and outdoors, which is the whole
    // requirement for a fallback: a wall clock was here in the first draft and
    // reads as a room, so it put a clock on a beach the moment the neutral set
    // dressing started being used for climate mismatches as well as for misses.
    eraProps: 'printed signage in a plain sans-serif, a plastic carrier bag, a glass bottle of mineral water with a foil label, a small grey mobile phone with a monochrome screen',
  }),
  negatives: Object.freeze(['smartphone', 'flat-screen television', 'modern signage', 'recent model cars']),
  motionHint: 'the air moves a little and the light shifts, and nothing else happens',
  lookOverride: Object.freeze({}),
});

export const NEUTRAL_OUTFIT = Object.freeze({
  id: '_neutral',
  label: 'Everyday clothes',
  climate: Object.freeze(['mild']),
  wardrobe: '',
  negatives: Object.freeze([]),
});

/**
 * The fallback for a garment that fits no class below. Period detail that is
 * true of ALL clothing in 2003 rather than of one garment: cut looser than now,
 * no brand shouting, worn rather than new.
 *
 * On its own it is a noun plus filler -- "a wedding suit, cut a size looser than
 * a modern one would be" says nothing a suit does not already imply -- which is
 * why GARMENT_CLASSES exists and why this is now the last resort rather than
 * the only answer.
 */
export const PERIOD_CUT_CLAUSE =
  'cut a size looser than a modern one would be, plain fabric with no visible branding, ' +
  'slightly creased from being worn rather than new';

/**
 * Named, dateable detail by garment class.
 *
 * Nearest-neighbour is the wrong mechanism for clothing. Borrowing prose
 * between two garments invents a third one -- splice trainingsjacke's "two
 * white stripes running down each sleeve" onto a wedding suit and the user is
 * wearing something they did not ask for. Borrowing at the level of a CLASS is
 * safe, because every detail here is true of every garment in its class in
 * 2003: a suit of that decade really was single-breasted with squared
 * shoulders, and its tie really was wider than a modern one.
 *
 * Named props beat adjectives applies to wardrobe exactly as it does to a
 * place. "a flower in the buttonhole" dates a frame; "smart period clothing"
 * dates nothing and costs a generation to find that out.
 */
export const GARMENT_CLASSES = Object.freeze({
  formalwear: Object.freeze({
    detail: 'single-breasted with squared shoulders and a slightly long jacket, a tie noticeably wider than a modern one, a flower in the buttonhole',
    terms: Object.freeze(['suit', 'wedding', 'tuxedo', 'dinner jacket', 'shirt and tie', 'waistcoat', 'blazer', 'uniform', 'confirmation']),
  }),
  knitwear: Object.freeze({
    detail: 'a heavy loose weave, ribbed at the cuff and hem, cut two sizes larger than a modern one would be',
    terms: Object.freeze(['hoodie', 'hoody', 'sweatshirt', 'jumper', 'sweater', 'pullover', 'cardigan', 'knit', 'knitted', 'fleece', 'wool', 'polo neck']),
  }),
  outerwear: Object.freeze({
    detail: 'quilted panels with elasticated cuffs and a drawstring hem, a chunky plastic zip pull, a knitted scarf tucked into the collar',
    terms: Object.freeze(['coat', 'jacket', 'parka', 'anorak', 'puffer', 'quilted', 'padded', 'raincoat', 'windbreaker', 'overcoat', 'gilet']),
  }),
  sportswear: Object.freeze({
    detail: 'two contrast stripes down each sleeve, elasticated cuffs, a small woven crest at the chest',
    terms: Object.freeze(['tracksuit', 'trackie', 'sports kit', 'football shirt', 'jersey', 'shell suit', 'gym kit', 'sports top']),
  }),
  dress: Object.freeze({
    detail: 'thin cotton rather than anything synthetic, narrow straps, a hem that falls just below the knee',
    terms: Object.freeze(['dress', 'sundress', 'frock', 'skirt', 'gown', 'pinafore']),
  }),
  casual: Object.freeze({
    detail: 'a straight cut with nothing tapered, stonewashed rather than dark, a plain leather belt with a small buckle',
    terms: Object.freeze(['jeans', 'denim', 'denim jacket', 't-shirt', 'tee', 'shirt', 'trousers', 'chinos', 'shorts', 'cords', 'dungarees']),
  }),
});

const GARMENT_CLASS_TERMS = Object.freeze(
  Object.entries(GARMENT_CLASSES).map(([name, { terms }]) => [name, terms]),
);

/** Longest match wins, which is what makes "tracksuit" sportswear rather than
 *  formalwear and "dinner jacket" formalwear rather than outerwear. */
export function classifyGarment(text) {
  const hit = longestMatch(text, GARMENT_CLASS_TERMS);
  return hit ? { class: hit.value, evidence: hit.term, detail: GARMENT_CLASSES[hit.value].detail } : { class: null, evidence: null, detail: null };
}

/** Applied to every expanded outfit. `sharply tailored` is deliberately NOT in
 *  here: a wedding suit is supposed to be tailored, and a negative that fights
 *  the user's own request is worse than no negative at all. Nor is `modern slim
 *  cut`, which was the first draft of the last entry -- `slim` is banned person
 *  vocabulary, the schema refused the whole outfit over it, and that refusal is
 *  the property this module is built to have. The fix is a different word, never
 *  a shorter ban list. */
export const GENERIC_OUTFIT_NEGATIVES = Object.freeze([
  'designer branding', 'large brand logo', 'technical fabric', 'large printed graphic', 'modern cut',
]);

/** Applied to every expanded place. Short on purpose -- the composer already
 *  contributes BASE_NEGATIVES, and a negative prompt that lists forty things is
 *  a negative prompt the model averages. */
export const GENERIC_PLACE_NEGATIVES = Object.freeze([
  'smartphone', 'flat-screen television', 'modern signage',
]);

/**
 * Which shipped place a keyword points at. Explicit and readable on purpose:
 * this is the table someone will edit when a request lands on the wrong
 * skeleton, and it needs to be obvious at a glance which entry did it.
 *
 * Entries are matched against the whole cleaned text with word boundaries, so
 * multi-word keys work and "car park" cannot be shredded into "park". Keys are
 * only here when they are strongly indicative -- "school" is deliberately
 * absent, because a school is a corridor, a hall, a yard or a car park
 * depending on the sentence, and a coin-flip between two skeletons is worse
 * than falling through to the token overlap below.
 */
export const PLACE_AFFINITY = Object.freeze({
  'ostsee-strand': Object.freeze([
    'beach', 'seaside', 'sea', 'coast', 'shore', 'sand', 'dune', 'dunes', 'ocean',
    'pier', 'promenade', 'harbour', 'harbor', 'lake', 'riverbank', 'waterfront', 'cliff',
  ]),
  'schrebergarten-august': Object.freeze([
    'garden', 'allotment', 'lawn', 'hedge', 'greenhouse', 'orchard', 'meadow',
    'vegetable patch', 'back yard', 'campsite', 'picnic', 'field',
  ]),
  'kuechentisch-fruehstueck': Object.freeze([
    'kitchen', 'breakfast', 'dining room', 'dining table', 'kitchen table',
    'cafe', 'canteen', 'bakery', 'diner',
  ]),
  'wohnzimmer-abend': Object.freeze([
    'living room', 'sitting room', 'front room', 'sofa', 'television', 'lounge',
    'bedroom', 'hotel room', 'pub', 'bar', 'waiting room',
  ]),
  'balkon-waesche': Object.freeze([
    'balcony', 'washing line', 'laundry', 'courtyard', 'rooftop', 'veranda',
    'window ledge', 'terrace',
  ]),
  'plattenbau-treppenhaus': Object.freeze([
    'stairwell', 'stairs', 'staircase', 'corridor', 'hallway', 'landing', 'lobby',
    'entrance hall', 'basement', 'cellar', 'underpass', 'tunnel', 'block of flats',
  ]),
  // Water only. `gym`, `sports hall` and `arena` were here in the first draft
  // and produced "the school gym, pale blue tiles, lane ropes across the water,
  // a lifeguard chair at the side" -- a prompt that generates a swimming pool
  // when the user asked for a gym. A dry sports hall has no near neighbour in
  // this menu, and the neutral skeleton's honest vagueness beats a confident
  // wrong scene every time.
  'hallenbad-nachmittag': Object.freeze([
    'swimming pool', 'pool', 'swimming', 'baths', 'leisure centre', 'sauna', 'lido',
    'changing room', 'lane ropes',
  ]),
  'autobahn-raststaette': Object.freeze([
    'car park', 'carpark', 'parking', 'motorway', 'autobahn', 'petrol station',
    'service station', 'forecourt', 'layby', 'bus stop', 'train station', 'platform',
    'kiosk', 'roundabout', 'junction', 'street', 'road', 'market',
  ]),
});

/** Same idea for the six outfits. `suit`, `wedding` and `tie` are deliberately
 *  absent: nothing in the menu is formalwear, and pointing a suit at the
 *  cardigan would inherit "modern knitwear" as a negative and call it a match. */
export const OUTFIT_AFFINITY = Object.freeze({
  fleecepulli: Object.freeze(['fleece', 'hoodie', 'hoody', 'sweatshirt', 'jumper', 'pullover', 'sweater', 'half-zip']),
  trainingsjacke: Object.freeze(['tracksuit', 'trackie', 'sports top', 'zip-up', 'bomber', 'windbreaker', 'football shirt']),
  'hemd-jeans': Object.freeze(['jeans', 'denim', 'checked shirt', 'flannel', 'trousers', 'chinos', 'shirt']),
  sommerkleid: Object.freeze(['sundress', 'summer dress', 'dress', 'skirt', 'floral', 'linen']),
  strickjacke: Object.freeze(['cardigan', 'knit', 'knitted', 'wool', 'blouse', 'waistcoat', 'blazer']),
  winterjacke: Object.freeze(['coat', 'parka', 'anorak', 'padded jacket', 'puffer', 'quilted', 'scarf', 'gloves', 'snow boots']),
});

/**
 * Climate, inferred from an explicit table because checkCompatibility reads the
 * field and a confident wrong guess produces a confident wrong warning.
 *
 * Longest match wins, which is what makes "a beach in winter" cold and "a beach"
 * warm without a rule about precedence. `indoor` sits at the same point on the
 * scale as `warm` (see CLIMATE_SCALE) -- that is the schema's decision, not
 * ours, and it is why a heated kitchen and an August garden warn about the same
 * outfits.
 */
export const CLIMATE_TERMS = Object.freeze([
  ['indoor', Object.freeze([
    'indoors', 'inside', 'kitchen', 'living room', 'sitting room', 'front room', 'bedroom',
    'bathroom', 'hallway', 'corridor', 'stairwell', 'staircase', 'landing', 'lobby',
    'basement', 'cellar', 'attic', 'garage', 'office', 'classroom', 'gym', 'sports hall',
    'swimming pool', 'shop', 'supermarket', 'cafe', 'canteen', 'pub', 'bar', 'church',
    'museum', 'library', 'cinema', 'restaurant', 'hotel room', 'waiting room', 'lift',
    'laundrette', 'arcade', 'sauna', 'changing room', 'bowling alley',
  ])],
  ['cold', Object.freeze([
    'snow', 'snowy', 'winter', 'ice', 'icy', 'frost', 'frosty', 'frozen', 'freezing',
    'january', 'february', 'december', 'christmas', 'sledging', 'skiing', 'ski slope',
    'blizzard', 'hail', 'arctic',
  ])],
  ['warm', Object.freeze([
    'beach', 'seaside', 'summer', 'june', 'july', 'august', 'heat', 'heatwave', 'sunny',
    'sunshine', 'holiday', 'barbecue', 'tropical', 'desert', 'lido', 'sunbathing',
    'paddling pool', 'ice cream',
  ])],
  ['cool', Object.freeze([
    'autumn', 'october', 'november', 'march', 'early spring', 'drizzle', 'rain', 'rainy',
    'windy', 'chilly', 'fog', 'foggy', 'mist', 'grey day',
  ])],
  ['mild', Object.freeze(['spring', 'may', 'september', 'overcast', 'mild'])],
]);

/** Garment to climate array. Longest match wins, so "winter jacket" is cold
 *  before "jacket" is cool. */
export const OUTFIT_CLIMATE_TERMS = Object.freeze([
  [Object.freeze(['cold', 'cool']), Object.freeze([
    'winter jacket', 'winter coat', 'padded jacket', 'puffer', 'parka', 'anorak', 'overcoat',
    'duffel', 'ski jacket', 'coat', 'scarf', 'gloves', 'woolly hat', 'thermal', 'snow boots',
  ])],
  [Object.freeze(['cool', 'mild']), Object.freeze([
    'hoodie', 'hoody', 'sweatshirt', 'fleece', 'jumper', 'sweater', 'pullover', 'tracksuit',
    'cardigan', 'denim jacket', 'bomber jacket', 'jacket', 'long sleeves', 'raincoat',
  ])],
  [Object.freeze(['warm', 'mild']), Object.freeze([
    't-shirt', 'tee', 'shorts', 'sundress', 'summer dress', 'vest', 'swimsuit',
    'swimming trunks', 'bikini', 'sandals', 'flip flops', 'linen', 'sleeveless',
  ])],
  [Object.freeze(['indoor', 'mild']), Object.freeze([
    'suit', 'wedding', 'tie', 'uniform', 'pyjamas', 'dressing gown', 'apron', 'waistcoat',
    'blouse', 'skirt', 'dress shirt', 'nightdress', 'slippers',
  ])],
]);

/** Time of day, most specific phrase first -- "late afternoon" must beat
 *  "afternoon", and "early morning" must beat "morning". */
export const TIME_TERMS = Object.freeze([
  ['late afternoon', Object.freeze(['late afternoon', 'golden hour', 'teatime', 'early evening'])],
  ['early morning', Object.freeze(['early morning', 'first thing', 'dawn', 'sunrise', 'breakfast', 'crack of dawn'])],
  ['night', Object.freeze(['night', 'midnight', 'after dark', 'in the dark', 'nighttime'])],
  ['dusk', Object.freeze(['dusk', 'sunset', 'twilight', 'nightfall', 'evening'])],
  ['midday', Object.freeze(['midday', 'noon', 'lunchtime', 'lunch'])],
  ['morning', Object.freeze(['morning'])],
  ['afternoon', Object.freeze(['afternoon'])],
]);

// ---------------------------------------------------------------------------
// text cleaning -- where the three prompt rules are applied to the user's words
// ---------------------------------------------------------------------------

/**
 * The two ways a prompt rule is applied to a user's sentence, and they are not
 * the same operation.
 *
 * `look` and `person` are STRIPPED, word by word, and the rest of the clause
 * survives. Those two lists govern what OUR PROMPT says to the model, not what
 * a user is allowed to type. The whole architecture is that the model does
 * content and ffmpeg does texture, so somebody typing "grainy VHS beach
 * footage" has not asked for something forbidden -- they have asked for a beach
 * and volunteered a texture we were going to apply anyway. Refusing them was
 * refusing recoverable input, which is the opposite of "refuse a category,
 * never a vibe".
 *
 * `wardrobe` (in a place) and `scene` (in an outfit) DROP the whole clause,
 * because those are not adjectives on the subject, they are a second subject.
 * "a hoodie on the beach" is a garment and a location, and the location has its
 * own box on the form. Stripping the word "beach" out of that clause would
 * leave "a hoodie on the", which is worse than either keeping or moving it.
 */
const PLACE_DROP_GROUPS = Object.freeze(['person', 'look', 'wardrobe']);
const OUTFIT_DROP_GROUPS = Object.freeze(['person', 'look', 'scene']);
const STRIPPED_GROUPS = new Set(['look', 'person']);

/**
 * Person references the schema's `person` group does not catch, because a
 * preset could never contain them and so it never needed to.
 *
 * "a beach, me looking younger" is not caught by anything in BANNED -- `young`
 * does not match "younger" -- and it is the more common phrasing. The list is
 * deliberately short and first-person only: `her`, `him` and `their` are NOT
 * here, because "her kitchen" is a place and dropping it would refuse a
 * perfectly good request.
 */
const SELF_REFERENCE = /\b(?:me|myself|i|people|persons?|somebody|someone|everyone|crowd)\b/i;

/**
 * Words that name the recording rather than the thing recorded.
 *
 * This is NOT a second ban list and it refuses nothing. It fires only on a
 * clause a `look` term was already stripped from, and only to clear the residue
 * that stripping leaves behind: "grainy VHS beach footage" would otherwise
 * become "beach footage" and "nostalgic vintage look" would become "look". In
 * both cases the leftover noun is the medium the banned adjective was
 * modifying. `filter` is deliberately absent for the same reason schema.mjs
 * exempts it -- a filter coffee machine is one of the best 2003 German kitchen
 * props there is, and banning a word for its company costs real set dressing.
 */
const MEDIUM_RESIDUE = Object.freeze([
  'footage', 'clip', 'recording', 'film', 'movie', 'shot', 'style', 'look', 'vibe', 'effect', 'quality', 'feel',
]);

/** Clause boundaries. Commas and semicolons are obvious; the prepositions and
 *  conjunctions matter because "a hoodie on the beach" is one comma-free string
 *  containing two different fragments' worth of intent, and the place half has
 *  to come out of the outfit without taking the hoodie with it. */
const BOUNDARY = /(,\s*|;\s*|\s+(?=(?:and|but|plus|on|in|at|by|with|near|under|over|beside|behind|inside|outside|during|while|whilst|wearing|dressed)\b))/i;

const LEADING_JOINER = /^(?:and|but|plus|on|in|at|by|with|near|under|over|beside|behind|inside|outside|during|while|whilst|wearing|dressed)\s+/i;

const LEADING_POSSESSIVE = /^(?:my|our|his|her|their|its)\s+/i;

/** Words that are safe to lowercase at the start of a fragment. Anything else
 *  keeps the case the user typed, because "Berlin" is not "berlin" and a
 *  blanket toLowerCase would quietly demote every proper noun in the product. */
const SAFE_TO_LOWERCASE = new Set([
  'a', 'an', 'the', 'my', 'our', 'their', 'his', 'her', 'some', 'one', 'two',
  'old', 'new', 'big', 'small', 'in', 'on', 'at', 'inside', 'outside',
]);

/** Split into clauses, keeping the separator that preceded each one so that a
 *  text with nothing stripped rejoins to exactly what the user typed. */
function toClauses(text) {
  const parts = text.split(BOUNDARY);
  const clauses = [];
  let sep = '';
  for (const [i, part] of parts.entries()) {
    if (i % 2 === 1) { sep = /^,/.test(part) ? ', ' : ' '; continue; }
    const body = part.trim();
    if (body) clauses.push({ sep: clauses.length === 0 ? '' : sep, text: body });
  }
  return clauses;
}

/** Remove every match of every banned term in the given groups, one at a time,
 *  reporting each. scanText hands back the matched substring, so what is
 *  removed is exactly what the schema would have objected to and nothing else. */
function stripTerms(text, groups) {
  let out = text;
  const removed = [];
  for (let pass = 0; pass < 20; pass += 1) {
    const hits = scanText(out, groups);
    if (!hits.length) break;
    for (const hit of hits) {
      const before = out;
      out = out.replace(hit.match, ' ');
      if (out !== before) removed.push({ text: hit.match, rule: hit.group, term: hit.term, match: hit.match, action: 'stripped' });
    }
  }
  for (let pass = 0; pass < 5; pass += 1) {
    const self = SELF_REFERENCE.exec(out);
    if (!self) break;
    out = out.replace(self[0], ' ');
    removed.push({ text: self[0], rule: 'person', term: self[0].toLowerCase(), match: self[0], action: 'stripped' });
  }
  if (removed.some((r) => r.rule === 'look')) {
    for (const word of MEDIUM_RESIDUE) {
      const found = boundaryRe(word).exec(out);
      if (found) {
        out = out.replace(found[0], ' ');
        removed.push({ text: found[0], rule: 'look', term: word, match: found[0], action: 'stripped' });
      }
    }
  }
  return { text: out, removed };
}

/** Tidy the wreckage a strip leaves. Applied ONLY to a clause something was
 *  actually removed from -- run over untouched text it would turn "a bus stop
 *  in the rain" into "a bus stop the rain", because collapsing a run of
 *  function words is only ever correct where a word has just been taken out
 *  from between them. */
function tidyResidue(text) {
  return text
    .replace(/\s*'s\b/g, '')
    .replace(/\b(?:a|an|the|of|and|with|in|on|at|by)\s+(?=(?:a|an|the|of|and|with|in|on|at|by)\b)/gi, '')
    .replace(/\s+([,;])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '')
    .trim();
}

/** Does anything describable survive? Only consulted for a clause that WAS
 *  stripped, so the participle exclusion cannot eat "the corner" or "a shower"
 *  -- those are never touched in the first place. */
const PARTICIPLE = /(?:ing|ed|er|est|ly)$/;
function hasContent(text) {
  return text.toLowerCase().split(/[^a-z0-9']+/)
    .some((w) => w.length >= 3 && !STOPWORDS.has(w) && !PARTICIPLE.test(w));
}

/**
 * Apply the prompt rules to a user's sentence: strip what is ours to apply,
 * drop what belongs in the other box, and keep everything else verbatim.
 *
 * A clause nothing was removed from is returned untouched, which is what makes
 * the rejoin lossless and what stops this quietly rewriting text it had no
 * objection to in the first place.
 */
export function stripClauses(text, groups) {
  const stripGroups = groups.filter((g) => STRIPPED_GROUPS.has(g));
  const dropGroups = groups.filter((g) => !STRIPPED_GROUPS.has(g));
  const kept = [];
  const dropped = [];

  for (const clause of toClauses(text)) {
    const belongsElsewhere = scanText(clause.text, dropGroups);
    if (belongsElsewhere.length) {
      const [hit] = belongsElsewhere;
      dropped.push({ text: clause.text, rule: hit.group, term: hit.term, match: hit.match, action: 'dropped' });
      continue;
    }

    const { text: stripped, removed } = stripTerms(clause.text, stripGroups);
    if (!removed.length) { kept.push(clause); continue; }

    const tidied = tidyResidue(stripped);
    if (!hasContent(tidied)) {
      // The banned words WERE the clause -- "me looking younger" has no place
      // left in it once the person is gone. Recorded as one drop rather than as
      // three strips, because the user's next move is to rewrite that phrase.
      dropped.push({ text: clause.text, rule: removed[0].rule, term: removed[0].term, match: removed[0].match, action: 'dropped' });
      continue;
    }
    dropped.push(...removed);
    kept.push({ ...clause, text: tidied });
  }

  const joined = kept.map((c, i) => (i === 0 ? c.text : c.sep + c.text)).join('');
  return { cleaned: joined.replace(LEADING_JOINER, '').trim(), dropped };
}

/** `my grandmother's kitchen` -> `a grandmother's kitchen`. A leading possessive
 *  is a fact about the user, not about the place, and the article slot it
 *  vacates is the one place an article can safely be inserted -- doing it
 *  unconditionally would produce "a jeans and a t-shirt". */
function normaliseDeterminer(phrase) {
  if (!LEADING_POSSESSIVE.test(phrase)) return phrase;
  const rest = phrase.replace(LEADING_POSSESSIVE, '');
  const article = /^[aeiou]/i.test(rest) ? 'an' : 'a';
  return `${article} ${rest}`;
}

function lowercaseLeadIn(phrase) {
  const [first] = phrase.split(/\s+/);
  if (!first || !SAFE_TO_LOWERCASE.has(first.toLowerCase())) return phrase;
  return phrase[0].toLowerCase() + phrase.slice(1);
}

/** The user's words, cleaned of everything the three rules forbid and tidied
 *  into something that reads as the opening clause of a preset fragment. */
export function subjectFrom(text, groups) {
  const { cleaned, dropped } = stripClauses(text, groups);
  const trimmed = cleaned.replace(/[.,;:!?\s]+$/, '').trim();
  if (!trimmed) return { subject: '', dropped };
  // A strip can take the determiner slot with it -- "grainy VHS beach footage"
  // reduces to "beach", and a scene fragment that opens on a bare singular noun
  // reads as a label rather than as a description. Only ever done when
  // something WAS removed, for the same reason normaliseDeterminer is: that is
  // when we know the slot is vacant rather than absent.
  const restored = dropped.some((d) => d.action === 'stripped') ? withArticle(trimmed) : trimmed;
  return { subject: lowercaseLeadIn(normaliseDeterminer(restored)), dropped };
}

/** Prepend an article, unless there already is a determiner or the head noun
 *  looks plural -- "a jeans and a t-shirt" is worse than "jeans and a t-shirt". */
function withArticle(phrase) {
  const [first] = phrase.split(/\s+/);
  if (!first) return phrase;
  const lower = first.toLowerCase();
  if (SAFE_TO_LOWERCASE.has(lower) || LEADING_POSSESSIVE.test(phrase) || LEADING_JOINER.test(phrase)) return phrase;
  if (lower.endsWith('s') && !lower.endsWith('ss')) return phrase;
  return `${/^[aeiou]/i.test(first) ? 'an' : 'a'} ${phrase}`;
}

// ---------------------------------------------------------------------------
// inference -- explicit tables, longest match wins, `mild` when genuinely unsure
// ---------------------------------------------------------------------------

/** Word-boundary match for one table entry, built the way schema.mjs builds a
 *  banned term: internal whitespace and hyphens both become `[\s-]+`, so one
 *  entry covers "car park" and "car-park", and a `(?:e?s)?` tail covers the
 *  plural without a second table. Matching the schema's own matcher matters --
 *  a residue word the ban would have caught in the plural but this one misses
 *  is a word that survives into the prompt. */
const boundaryRe = (term) => new RegExp(
  `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]+')}(?:e?s)?\\b`, 'i');

/** Longest matching term across a table of [value, terms] pairs. Longest rather
 *  than first because "a beach in winter" contains both `beach` and `winter`,
 *  and the more specific phrase is the one the user meant. */
function longestMatch(text, table) {
  let best = null;
  for (const [value, terms] of table) {
    for (const term of terms) {
      if (term.length > (best?.term.length ?? 0) && boundaryRe(term).test(text)) best = { value, term };
    }
  }
  return best;
}

/** @returns {{climate: string|null, evidence: string|null}} `null` means "no
 *  evidence in the text", which is a different thing from "mild" and is handled
 *  differently by the caller -- see the fallback chain in expandPlaceDraft. */
export function inferClimate(text) {
  const hit = longestMatch(text, CLIMATE_TERMS);
  return hit ? { climate: hit.value, evidence: hit.term } : { climate: null, evidence: null };
}

export function inferTimeOfDay(text) {
  const hit = longestMatch(text, TIME_TERMS);
  return hit ? { timeOfDay: hit.value, evidence: hit.term } : { timeOfDay: null, evidence: null };
}

export function inferWeather(text) {
  const hit = longestMatch(text, WEATHER_TERMS);
  return hit ? { weather: hit.value, evidence: hit.term } : { weather: null, evidence: null };
}

export function inferOutfitClimate(text) {
  const hit = longestMatch(text, OUTFIT_CLIMATE_TERMS);
  return hit ? { climate: [...hit.value], evidence: hit.term } : { climate: null, evidence: null };
}

// ---------------------------------------------------------------------------
// skeleton choice
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'and', 'or', 'with', 'my', 'our', 'their',
  'his', 'her', 'its', 'to', 'from', 'by', 'for', 'is', 'was', 'it', 'this', 'that',
  'some', 'very', 'really', 'me', 'i', 'we', 'us', 'near', 'about', 'like', 'just',
]);

/** Crude singularisation, on purpose. A real stemmer is a dependency and this
 *  only has to make "dunes" match "dune"; getting "buses" wrong costs one
 *  point of overlap on one skeleton. */
const stem = (word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);

export function tokenise(text) {
  return [...new Set(
    text.toLowerCase().split(/[^a-z0-9']+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
      .map(stem),
  )];
}

/** Above this, the match is trusted enough to inherit the skeleton's era props
 *  and negatives. One keyword in a label clears it; a lone climate agreement
 *  does not, which is why the threshold is applied to the LEXICAL score and the
 *  climate and time bonuses only break ties between real matches. */
export const STRONG_MATCH = 10;

function lexicalScore(text, tokens, weights, affinity) {
  let score = 0;
  const reasons = [];
  for (const term of affinity ?? []) {
    if (boundaryRe(term).test(text)) { score += 100; reasons.push(`"${term}"`); }
  }
  for (const [field, weight] of weights) {
    const fieldTokens = new Set(tokenise(field.text));
    for (const token of tokens) {
      if (fieldTokens.has(token)) { score += weight; reasons.push(`${field.name}:${token}`); }
    }
  }
  return { score, reasons };
}

/**
 * Score every shipped place and take the nearest.
 *
 * The seed only ever breaks a tie, and it earns its place in the signature by
 * doing so: with two equally plausible skeletons there is no right answer, and
 * deriving the choice from the seed keeps it reproducible from the manifest
 * instead of depending on Map iteration order.
 */
export function choosePlaceSkeleton(text, catalog, seed = 0) {
  const tokens = tokenise(text);
  const scored = [...catalog.places.values()].map((place) => {
    const { score, reasons } = lexicalScore(text, tokens, [
      [{ name: 'label', text: place.label }, 12],
      [{ name: 'id', text: place.id }, 8],
      [{ name: 'scene', text: place.prompt.scene }, 5],
      [{ name: 'props', text: `${place.prompt.eraProps} ${place.prompt.lens} ${place.prompt.framing} ${place.prompt.light}` }, 2],
    ], PLACE_AFFINITY[place.id]);

    // Climate is a real term in the score and not a decoration, because a warm
    // request landing on a cold skeleton is how "a beach" ended up inheriting
    // an out-of-season Baltic: wicker chairs turned away from the water, a
    // wind-break, and "sunshine" in the negatives. The penalty is what makes a
    // warm request PREFER a warm skeleton and fall to a mismatched one only
    // when nothing better exists.
    //
    // It stays out of `lexical` on purpose. A place that shares nothing but a
    // climate with the request is not a match, and letting agreement push it
    // over STRONG_MATCH would hand it the era props on the strength of one
    // enum field.
    const climate = inferClimate(text).climate;
    const time = inferTimeOfDay(text).timeOfDay;
    let bonus = 0;
    if (climate) {
      const distance = Math.abs(CLIMATE_SCALE[climate] - CLIMATE_SCALE[place.climate]);
      bonus += distance === 0 ? 25 : distance === 1 ? 10 : -25;
    }
    if (time && time === place.timeOfDay) bonus += 4;
    return { skeleton: place, lexical: score, total: score + bonus, reasons };
  });

  return pickBest(scored, seed, NEUTRAL_PLACE);
}

export function chooseOutfitSkeleton(text, catalog, seed = 0) {
  const tokens = tokenise(text);
  const scored = [...catalog.outfits.values()].map((outfit) => {
    const { score, reasons } = lexicalScore(text, tokens, [
      [{ name: 'label', text: outfit.label }, 12],
      [{ name: 'wardrobe', text: outfit.wardrobe }, 5],
    ], OUTFIT_AFFINITY[outfit.id]);
    return { skeleton: outfit, lexical: score, total: score, reasons };
  });
  return pickBest(scored, seed, NEUTRAL_OUTFIT);
}

function pickBest(scored, seed, neutral) {
  const usable = scored.filter((s) => s.lexical >= STRONG_MATCH);
  if (usable.length === 0) {
    return { skeleton: neutral, lexical: 0, total: 0, reasons: [], strong: false, tied: 0 };
  }
  const top = Math.max(...usable.map((s) => s.total));
  // Sorted by id before the seed indexes into it, so the tie-break is a
  // property of the request rather than of the order a Map was built in.
  const tied = usable.filter((s) => s.total === top).sort((a, b) => a.skeleton.id.localeCompare(b.skeleton.id));
  return { ...tied[seed % tied.length], strong: true, tied: tied.length };
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

const TIME_INDEX = new Map(TIMES_OF_DAY.map((t, i) => [t, i]));

/** Split a preset scene into its clauses and hand back everything except the
 *  opening one -- the props, which is the part worth borrowing. The opening
 *  clause names the place, and the user has just named the place themselves.
 *  If that opening clause carries detail behind a "with", the detail is kept:
 *  "a small German kitchen with brown wall tiles half way up the wall" is two
 *  facts, and only the first of them is the user's to replace. */
function propClauses(scene, subject = '') {
  const [head, ...rest] = scene.split(/,\s*/);
  const withIndex = head.toLowerCase().indexOf(' with ');
  const carried = withIndex === -1 ? [] : [head.slice(withIndex + ' with '.length).trim()];

  // Drop a borrowed clause that repeats the user's own noun phrase, or you get
  // "a car park at night, a half-empty car park of estate cars". Only phrases of
  // two words or more, and deliberately so: a one-word test on "a beach" would
  // throw away "a line of roofed wicker beach chairs turned away from the
  // water", which is the single best clause in that preset.
  const phrase = headPhrase(subject);
  const duplicates = phrase.split(/\s+/).length >= 2 ? boundaryRe(phrase) : null;

  return [...carried, ...rest].filter((c) => c && !(duplicates && duplicates.test(c)));
}

/** The user's noun phrase, without the article and without the trailing
 *  circumstance: "a car park at night" is a car park that happens to be at
 *  night, and only the car park is the thing standing behind them. */
function headPhrase(subject) {
  const first = toClauses(subject)[0]?.text ?? subject;
  return first.replace(LEADING_JOINER, '').replace(/^(?:a|an|the)\s+/i, '').trim();
}

const wordCount = (s) => s.trim().split(/\s+/).length;

/** requireString rejects a fragment over 90 words, and it is right to: past
 *  that the model starts dropping clauses and the clause it drops is not the
 *  one you would choose. Dropping borrowed props from the tail is a better
 *  answer than a refusal, because the tail is the least specific part. */
function fitWords(head, tail, max = 88) {
  const clauses = [...tail];
  while (clauses.length && wordCount([head, ...clauses].join(', ')) > max) clauses.pop();
  return [head, ...clauses].join(', ');
}

const shotSizeOf = (framing) => (/chest-up/i.test(framing) ? 'chest-up' : 'waist-up');

/** A borrowed lookOverride arrives with the borrowed preset's `_comment`, and
 *  that comment argues for a decision made about a DIFFERENT scene -- "the
 *  coldest and flattest thing in the menu" attached to a warm beach. The values
 *  are still right (see the one-step rule below); the argument for them is not,
 *  and a manifest that quotes it would mislead whoever reads it next. */
const withoutDocs = (override) =>
  Object.fromEntries(Object.entries(override).filter(([k]) => !k.startsWith('_')));

/** `a beach` -> `the beach`, for the clause that says what is behind the
 *  person. The framing fragment is the second place the user's own words have
 *  to appear, because a borrowed framing puts them at the end of somebody
 *  else's table. */
const definiteForm = (phrase) => `the ${headPhrase(phrase)}`;

function placeLabel(subject) {
  const words = subject.split(/\s+/).slice(0, 10).join(' ');
  return words[0].toUpperCase() + words.slice(1);
}

export function slugFrom(subject) {
  // Apostrophes are removed rather than collapsed, so that "my grandmother's
  // kitchen" reads as `custom-a-grandmothers-kitchen` in a manifest instead of
  // `custom-a-grandmother-s-kitchen`.
  const slug = subject.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  return `custom-${slug || 'place'}`;
}

/**
 * The id an expansion gets, derived from the user's cleaned text rather than
 * from the expander's output.
 *
 * An id lands in a manifest and in `fragments.placeId`, which is what someone
 * reads six months later when a render is wrong. Letting the expander name it
 * means a model chooses that identifier, and a model asked for a slug will
 * eventually return one with a space, a slash or a banned word in it. Deriving
 * it here makes it a property of the request -- the same request always
 * produces the same id, whichever impl answered.
 */
export function canonicalId(kind, text) {
  if (kind === 'place-from-photo') return 'photo-place';
  const groups = kind === 'outfit' ? OUTFIT_DROP_GROUPS : PLACE_DROP_GROUPS;
  const { subject } = subjectFrom(text ?? '', groups);
  return subject ? slugFrom(subject) : 'custom';
}

const lensOverrideFor = (text) => {
  if (/\b(?:close[\s-]?up|closeup|tight|portrait)\b/i.test(text)) return { lens: LENS_OVERRIDES.close, from: 'close-up' };
  if (/\b(?:wide|far away|distant|from a distance)\b/i.test(text)) return { lens: LENS_OVERRIDES.wide, from: 'wide' };
  return null;
};

/**
 * The place expansion. Returns a DRAFT -- preset-shaped JSON that has not been
 * validated yet. expand.mjs runs it through validatePlace, and a draft that
 * fails is a refusal, never a patch.
 */
function expandPlaceDraft({ text, seed, catalog }) {
  const { subject, dropped } = subjectFrom(text, PLACE_DROP_GROUPS);
  if (!subject) return { draft: null, dropped, reason: 'everything the text said was about the person, the look, or the wardrobe' };

  const choice = choosePlaceSkeleton(subject, catalog, seed);
  const { skeleton } = choice;

  const climateHit = inferClimate(subject);
  // The fallback chain, stated once: what the text says, then what the skeleton
  // we chose because it resembles the request says, then `mild`. The last rung
  // is reached only when nothing in the text carried a climate AND nothing in
  // the menu resembled the request, which is exactly the "genuinely unsure"
  // case, and `mild` is the value that produces no compatibility warning in
  // either direction.
  const climate = climateHit.climate ?? (choice.strong ? skeleton.climate : 'mild');

  const timeHit = inferTimeOfDay(subject);
  const timeOfDay = timeHit.timeOfDay ?? skeleton.timeOfDay;

  /**
   * Whether the skeleton's SET DRESSING is inherited -- its scene props, its
   * era props, its negatives, its motion hint and its look override.
   *
   * Two steps apart on the climate scale means the borrowed dressing describes
   * different weather from the one the user asked for, and the failure is
   * silent: the prose stays internally coherent, so nothing downstream catches
   * it, and the climate field then suppresses the compatibility warning the
   * frame would have deserved. Silent and wrong is the bad quadrant. Neutral
   * dressing is a weaker prompt and an honest one -- the same judgement the
   * neutral skeleton exists to apply, reached from the other direction.
   *
   * The lens and the shot size are NOT dressing and are kept: a focal length
   * has no season.
   */
  const climateGap = Math.abs(CLIMATE_SCALE[climate] - CLIMATE_SCALE[skeleton.climate]);
  const dressing = choice.strong && climateGap < 2;

  const weatherHit = inferWeather(subject);
  let light = dressing ? skeleton.prompt.light : (LIGHT_BY_CLIMATE[climate] ?? LIGHT_BY_TIME[timeOfDay]);
  let lightFrom = dressing ? `skeleton:${skeleton.id}`
    : (LIGHT_BY_CLIMATE[climate] ? `climate:${climate}` : `time:${timeOfDay}`);
  if (timeHit.timeOfDay && !(dressing && timeHit.timeOfDay === skeleton.timeOfDay)) {
    light = LIGHT_BY_TIME[timeHit.timeOfDay];
    lightFrom = `time:${timeHit.evidence}`;
  }
  if (weatherHit.weather) {
    light = LIGHT_BY_WEATHER[weatherHit.weather];
    lightFrom = `weather:${weatherHit.evidence}`;
  }

  // Indoors wins over both, because it is the one claim that contradicts the
  // others outright rather than merely differing from them: a sky cannot be the
  // light source in a stairwell, whatever the clock or the weather says.
  if (climate === 'indoor' && !(lightFrom.startsWith('skeleton:') && skeleton.climate === 'indoor')) {
    light = LIGHT_INDOORS[timeOfDay === 'night' || timeOfDay === 'dusk' ? 'night' : 'day'];
    lightFrom = `indoors:${timeOfDay}`;
  }

  const lensHit = lensOverrideFor(subject);
  const lens = lensHit?.lens ?? skeleton.prompt.lens;

  // A lookOverride is a grade tuned for one specific light. Carried one step
  // along the time axis it is still roughly right -- sodium lamps at dusk are
  // sodium lamps at night -- and carried four steps it is plainly wrong, so
  // the base profile wins instead. Silently inheriting a midday override onto a
  // night scene is the version of this bug nobody would ever find.
  const step = Math.abs(TIME_INDEX.get(timeOfDay) - TIME_INDEX.get(skeleton.timeOfDay));
  const keepsLook = dressing && step <= 1 && !weatherHit.weather;

  const draft = {
    _source: {
      expander: 'local',
      skeleton: skeleton.id,
      lexicalScore: choice.lexical,
      strongMatch: choice.strong,
      tiedCandidates: choice.tied,
      matchedOn: choice.reasons,
      subject,
      dropped,
      climateFrom: climateHit.evidence ? `text:${climateHit.evidence}` : (choice.strong ? `skeleton:${skeleton.id}` : 'default'),
      timeFrom: timeHit.evidence ? `text:${timeHit.evidence}` : `skeleton:${skeleton.id}`,
      lightFrom,
      lensFrom: lensHit ? `text:${lensHit.from}` : `skeleton:${skeleton.id}`,
      dressingFrom: dressing ? `skeleton:${skeleton.id}`
        : (choice.strong ? `neutral (skeleton is ${skeleton.climate}, the request is ${climate})` : 'neutral (nothing matched)'),
      lookOverrideFrom: keepsLook ? `skeleton:${skeleton.id}` : 'base profile',
    },
    id: slugFrom(subject),
    label: placeLabel(subject),
    climate,
    timeOfDay,
    prompt: {
      scene: fitWords(subject, propClauses(dressing ? skeleton.prompt.scene : NEUTRAL_PLACE.prompt.scene, subject)),
      light,
      lens,
      framing: `${shotSizeOf(skeleton.prompt.framing)}, three-quarters to the camera, ${definiteForm(subject)} behind`,
      eraProps: dressing ? skeleton.prompt.eraProps : NEUTRAL_PLACE.prompt.eraProps,
    },
    negatives: [...new Set([...(dressing ? skeleton.negatives : NEUTRAL_PLACE.negatives), ...GENERIC_PLACE_NEGATIVES])],
    motionHint: dressing ? skeleton.motionHint : NEUTRAL_PLACE.motionHint,
    lookOverride: keepsLook ? withoutDocs(skeleton.lookOverride) : {},
  };
  return { draft, dropped, reason: null };
}

function expandOutfitDraft({ text, seed, catalog }) {
  const { subject, dropped } = subjectFrom(text, OUTFIT_DROP_GROUPS);
  if (!subject) return { draft: null, dropped, reason: 'everything the text said was about the person, the look, or the place' };

  const choice = chooseOutfitSkeleton(subject, catalog, seed);
  const climateHit = inferOutfitClimate(subject);
  const climate = climateHit.climate ?? (choice.strong ? [...choice.skeleton.climate] : ['mild']);

  // The class supplies the period detail; the skeleton supplies only the
  // negatives and the climate fallback, which is the part of nearest-neighbour
  // that genuinely works for clothing.
  const garment = classifyGarment(subject);

  const draft = {
    _source: {
      expander: 'local',
      skeleton: choice.skeleton.id,
      lexicalScore: choice.lexical,
      strongMatch: choice.strong,
      tiedCandidates: choice.tied,
      matchedOn: choice.reasons,
      subject,
      dropped,
      climateFrom: climateHit.evidence ? `text:${climateHit.evidence}` : (choice.strong ? `skeleton:${choice.skeleton.id}` : 'default'),
      garmentClass: garment.class,
      garmentClassFrom: garment.evidence ? `text:"${garment.evidence}"` : 'unclassified',
      // Stated so it is never mistaken for cleverness: the skeleton contributes
      // its negatives and its climate, and NOT its prose. Splicing "two white
      // stripes running down each sleeve" onto a garment the user did not
      // describe that way is how an expander invents clothing.
      wardrobeFrom: garment.class ? `the user, plus the ${garment.class} class detail` : 'the user, plus the period-cut clause',
    },
    id: slugFrom(subject),
    label: placeLabel(subject),
    climate,
    wardrobe: garment.detail
      ? fitWords(subject, [garment.detail, 'slightly creased from being worn rather than new'])
      : fitWords(subject, [PERIOD_CUT_CLAUSE]),
    negatives: [...new Set([...(choice.strong ? choice.skeleton.negatives : []), ...GENERIC_OUTFIT_NEGATIVES])],
  };
  return { draft, dropped, reason: null };
}

/**
 * The reference-image path, and the one place in this module where saying LESS
 * is the whole design.
 *
 * A photograph of the user's actual childhood garden is the strongest thing
 * this product does, and the fastest way to ruin it is to describe a place we
 * cannot see. Every invented detail -- a shed, a hedge, a particular light --
 * is a clause the model must reconcile against the reference, and reconciling
 * invention with evidence produces a garden that is neither. So the prose says
 * what the reference image is FOR, keeps the era and lens clauses that the
 * image cannot carry on its own, and stops.
 *
 * climate defaults to `mild` and timeOfDay to `afternoon` because we genuinely
 * cannot see either, and both are the value that produces no warning and no
 * confident claim. An optional `text` hint is honoured when the user typed one
 * alongside the upload.
 */
function placeFromPhotoDraft({ text, photoPath }) {
  const hint = typeof text === 'string' ? text : '';
  const climateHit = inferClimate(hint);
  const timeHit = inferTimeOfDay(hint);
  return {
    draft: {
      _source: {
        expander: 'local',
        skeleton: null,
        photoPath,
        subject: 'the reference photograph',
        climateFrom: climateHit.evidence ? `text:${climateHit.evidence}` : 'default (the photograph cannot be read)',
        timeFrom: timeHit.evidence ? `text:${timeHit.evidence}` : 'default (the photograph cannot be read)',
      },
      id: 'photo-place',
      label: 'The place in the photograph',
      climate: climateHit.climate ?? 'mild',
      timeOfDay: timeHit.timeOfDay ?? 'afternoon',
      prompt: {
        scene: 'the place shown in the second reference image, unchanged: its own surfaces, its own objects, its own proportions, exactly as they appear there',
        light: 'the light the second reference image already has, matched rather than replaced',
        lens: 'a consumer zoom near its wide end, deep focus from the front of the frame to the back, a little barrel bend at the edges',
        framing: 'waist-up, three-quarters to the camera, standing in the place the second reference image shows',
        eraProps: 'only what the second reference image already contains, and nothing added that was manufactured later than the period',
      },
      negatives: ['a different place', 'invented architecture', 'added furniture', 'rearranged objects', 'smartphone', 'modern signage'],
      motionHint: 'the air moves a little and the light shifts, and nothing else in the place changes',
      lookOverride: {},
    },
    dropped: [],
    reason: null,
  };
}

/**
 * The default `expandImpl`. Deterministic, offline, and the same shape a Claude
 * call will have: one request in, one preset-shaped draft out, validated by the
 * caller either way.
 *
 * @param {import('./expand.mjs').ExpandRequest} request
 * @returns {{draft: object|null, dropped: object[], reason: string|null}}
 */
export function localExpander(request) {
  switch (request.kind) {
    case 'place': return expandPlaceDraft(request);
    case 'outfit': return expandOutfitDraft(request);
    case 'place-from-photo': return placeFromPhotoDraft(request);
    default: throw new TypeError(`localExpander: unknown kind "${request.kind}"`);
  }
}
