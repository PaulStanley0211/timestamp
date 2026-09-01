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

/**
 * The five things a 2003 handheld camcorder can physically do.
 *
 * Adapted from the camera-movement library at https://aicameramovements.com/,
 * which catalogues 46 moves in a four-part shape -- movement, speed, framing,
 * end state. THE OTHER FORTY-ONE ARE EXCLUDED ON PURPOSE. Crane, orbit, FPV,
 * whip-pan, dolly, slider and speed ramp are all things a camera on a tripod,
 * a rig or a drone does, and asking a model for one is asking it to make an
 * advertisement. The illusion this product sells is that somebody's dad was
 * holding the camera, and his shoulder is the only stabiliser in the room.
 *
 * Each string carries movement AND speed. Framing and end state come from the
 * preset's own `framing` clause and from the locks, so the four parts are all
 * present without any of them being written twice.
 */
export const CAMCORDER_MOVES = Object.freeze({
  drift: 'drifts a few centimetres and settles, the operator standing in one place and breathing',
  reframe: "reframes once, overshoots by a hand's width and comes back",
  walk: 'walks slowly forward, the frame rising and falling a little with each step',
  rest: 'sits on a surface and stays there, with only the smallest settle',
  follow: 'turns to follow, half a beat late, and catches up',
});

/**
 * White balance, fixed for the scene, stated in Kelvin.
 *
 * The skill's rule is that a scene has ONE colour temperature and says so --
 * "warm light" is a mood, 3900K is an instruction. This is a first
 * approximation off the preset's `climate`; a preset that needs something
 * else (a tungsten stairwell, a fluorescent swimming hall) sets
 * `whiteBalanceK` and this defers to it.
 */
export const WHITE_BALANCE_K = Object.freeze({ warm: 3900, cold: 6000 });

/**
 * How many shots a runtime earns, from the `seedance-prompt` skill's own table:
 * roughly two to two and a half seconds a shot.
 *
 * PAUL MEASURED THE FAILURE THIS FIXES, and precisely: "the character is
 * placing the bottle on the table, it is taking around five to six seconds ...
 * it is very lagging". One beat stretched over a third of the runtime reads as
 * dead air. A shorter tape gets FEWER beats, never faster ones -- cramming six
 * shots into five seconds is a different failure, not a fix for this one.
 */
export function shotCountFor(seconds) {
  if (seconds <= 5) return 2;
  if (seconds <= 7) return 3;
  if (seconds <= 9) return 4;
  if (seconds <= 13) return 5;
  return 6;
}

/** The only reference to the person, anywhere in this module. */
export const SUBJECT = 'The person in the reference image';

/** The same refusal, in the vocabulary `reference-to-video` understands.
 *
 *  That endpoint refers to its attachments positionally as @Image1..@Image9, so
 *  the marker replaces the phrase rather than joining it. Element 0 of
 *  `references` is the face and element 1, when present, is the place -- the
 *  order is a contract between this prompt and `falReferenceVideoBody`. */
export const REFERENCE_SUBJECT = 'The person in @Image1';

/** Set dressing, not a photographic style -- see the header.
 *
 *  IT NAMES A PERIOD AND NOT A COUNTRY (2026-08-31). This read
 *  "Germany between 1999 and 2005" until today, and it is handed to
 *  composeStillPrompt, composeMotionPrompt and composeReferencePrompt on every
 *  render -- so every tape this product has made was set in Germany whatever
 *  the customer typed. Section 42F de-nationalised the eight place labels and
 *  the three preset prompts that named the country, on Paul's ruling that the
 *  product is the ERA AND THE MEDIUM rather than the place; this constant is
 *  the same ruling one layer down, and it was missed because it reaches the
 *  tape rather than a page.
 *
 *  THE PERIOD ITSELF IS LOAD-BEARING AND STAYS. It is what keeps a flat-screen
 *  or a mobile phone out of a 2003 frame, and the clause below it -- vehicles,
 *  packaging, signage, appliances, the cut of a garment -- is the whole
 *  mechanism by which the decade arrives as objects rather than as a mood. What
 *  came out is only the geography, which the place preset, the customer's own
 *  description and their own uploaded photograph all already supply, and supply
 *  correctly for wherever they actually are. */
export const DEFAULT_ERA = '1999 to 2005';

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
/** The cut prohibitions, ALONE, because the two deliveries no longer agree.
 *
 *  A motion SEGMENT must not cut: it is one piece of a clip that gets joined to
 *  others, and footage that cuts inside itself cannot be used at all. A direct
 *  tape is now built ON cuts -- Paul asked for a vlog, and a 2003 home
 *  recording is full of in-camera cuts because you pressed record and stopped
 *  again. Same words, opposite meaning, so they live apart. */
export const CUT_NEGATIVES = Object.freeze([
  'cut to another shot', 'camera cut', 'jump cut',
]);

/** Everything that breaks a tape whatever its pacing. Deliberately separate
 *  from the cut prohibitions: dropping those for the vlog path must not drop a
 *  speed ramp or a wardrobe change with them. */
export const PACE_NEGATIVES = Object.freeze([
  'slow motion', 'speed ramp',
  // NOT the bare word `zoom`. Every place preset's lens clause describes a
  // consumer ZOOM lens, and the motion prompt now carries that clause -- a bare
  // negative would contradict the prose on the same generation. The forbidden
  // thing was always the MOVE, so the negative names the move.
  'time lapse', 'the camera zooming', 'morphing', 'the location changing', 'a change of wardrobe',
]);

/** The single-take path: no cuts, and none of the rest either. */
export const MOTION_NEGATIVES = Object.freeze([...CUT_NEGATIVES, ...PACE_NEGATIVES]);

/** The vlog path: cuts are the point, everything else still refused. */
export const VLOG_NEGATIVES = Object.freeze([...PACE_NEGATIVES]);

/** Still-only additions: the composition tells.
 *
 *  These are what SURVIVES the tape chain. Run an AI still through the grade,
 *  the 576-line raster and the grain and every texture tell dies -- but a
 *  subject centred to the pixel, squared to the lens with nothing happening,
 *  under a raking hero light, is still there in the graded frame, because none
 *  of that is texture. It is staging, and staging is the prompt's job.
 *
 *  None of these may carry look vocabulary. A negative is still conditioning:
 *  "no film grain" puts the words film grain in front of the model, which is
 *  why every tell here is named in terms of staging and never of finish.
 */
export const STILL_NEGATIVES = Object.freeze([
  'centered composition', 'symmetrical composition', 'posed portrait',
  'standing to attention', 'staged tableau', 'everything in sharp focus',
  'studio lighting', 'lens flare', 'fashion photograph', 'stock photo',
]);

/** The floor for what is happening in the frame, used when a place has not
 *  authored its own. A brief with no action in it is a portrait brief, and a
 *  model handed one produces a portrait: squared to the camera, arms hanging,
 *  waiting to be photographed. That is the pose that survived the tape chain.
 *
 *  Deliberately free of look, person and wardrobe vocabulary, because a place
 *  preset may override it and a place preset is held to all three. */
export const DEFAULT_MOMENT =
  'halfway through something ordinary, only half turned towards whoever is holding the camera, '
  + 'and not waiting for the picture to be taken';

/** Ridden along with every framing clause. The preset says how much is in frame
 *  and where it stands; this says the frame was not composed. Centring is the
 *  tell no amount of grain removes. */
const SNAPSHOT_RULE =
  'Set off centre rather than in the middle of the frame, and not quite level -- '
  + 'a snapshot somebody took in passing, not a photograph that was composed';

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

  // ORDER IS LOAD-BEARING, and this is the second time the project has paid to
  // learn it -- composeMotionPrompt below carries the same ruling. Framing sat
  // FIFTH here, and seedream ignored it outright on 2026-08-24: "waist-up,
  // three-quarters" was asked for and full-body front-on came back, which is
  // what made the frame symmetrical enough to read as rendered. It now sits
  // third, immediately after who and where, exactly as the camera clause does
  // in the motion prompt. The moment follows it because what is happening and
  // how much is in frame are one decision, not two.
  const fragments = {
    subject: `${SUBJECT}, wearing ${outfit.wardrobe}.`,
    place: `Place: ${place.prompt.scene}.`,
    framing: `Framing: ${place.prompt.framing}. ${SNAPSHOT_RULE}.`,
    moment: `Moment: ${place.prompt.moment ?? DEFAULT_MOMENT}.`,
    lens: `Lens: ${place.prompt.lens}.`,
    light: `Light: ${place.prompt.light}.`,
    props: `In frame: ${place.prompt.eraProps}.`,
    era: `Period: ${era}. Vehicles, packaging, signage, appliances and the cut of every garment are ` +
      'consistent with it, and nothing visible was manufactured later.',
    only: 'Exactly one person in frame.',
  };

  return {
    prompt: Object.values(fragments).join('\n'),
    negativePrompt: buildNegative(place, outfit, STILL_NEGATIVES),
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
export function composeMotionPrompt({ place, outfit, segment = 1, totalSegments = 1, cameraMove = null } = {}) {
  requirePreset(place, 'place', ['id', 'label', 'timeOfDay', 'motionHint', 'prompt.scene', 'prompt.light']);
  requirePreset(outfit, 'outfit', ['id', 'label', 'wardrobe']);
  if (!Number.isInteger(totalSegments) || totalSegments < 1) {
    throw new TypeError(`totalSegments must be a positive integer, got ${JSON.stringify(totalSegments)}`);
  }
  if (!Number.isInteger(segment) || segment < 1 || segment > totalSegments) {
    throw new TypeError(`segment must be an integer in 1..${totalSegments}, got ${JSON.stringify(segment)}`);
  }

  const move = CAMCORDER_MOVES[cameraMove ?? place.cameraMove] ?? CAMCORDER_MOVES.drift;
  const kelvin = Number.isFinite(place.whiteBalanceK)
    ? place.whiteBalanceK
    : (WHITE_BALANCE_K[place.climate] ?? WHITE_BALANCE_K.warm);

  const continuity = segment === 1
    ? `Take 1 of ${totalSegments}. Begin on the supplied frame and carry straight on from it.`
    : `Take ${segment} of ${totalSegments}. Continue from the final frame of the previous take: ` +
      'the same place, the same wardrobe, the same light, one unbroken take.';

  // ORDER IS LOAD-BEARING. The camera sits third, immediately after who and
  // where: pushed to the end its direction gets ignored, pulled to the front it
  // argues with the reference image over identity. Subject motion and camera
  // motion are stated in separate clauses so neither is read as the other.
  const lines = [
    `${SUBJECT}, wearing ${outfit.wardrobe}.`,
    `Place: ${place.prompt.scene}.`,
    `Camera: hand-held at 63°, chest height, the operator standing on the shadow side. ` +
      `It ${move}. One continuous take at real speed, first frame to last.`,
    `Lens: ${place.prompt.lens}.`,
    `Framing: ${place.prompt.framing}.`,
    `Light: ${place.prompt.light}. White balance ${kelvin}K, fixed for the whole take.`,
    `Motion: ${place.motionHint}.`,
    `Nothing dramatic happens. This is an ordinary ${place.timeOfDay} and it simply continues.`,
    continuity,
    'Exactly one person in frame. The place, the wardrobe and the light hold exactly as described ' +
      'from the first frame to the last.',
  ];

  return {
    prompt: lines.join('\n'),
    negativePrompt: buildNegative(place, outfit, MOTION_NEGATIVES),
  };
}

/**
 * Fifteen seconds from the photographs themselves. No still, and nothing for a
 * human to approve on the way past.
 *
 * WHY THIS FUNCTION EXISTS. `composeMotionPrompt` writes for image-to-video: it
 * opens on "begin on the supplied frame", because `animate` has always started
 * from a still somebody chose. That made the still structural. Paul's product
 * is four choices and a tape -- a photo, an outfit, a place, a frame shape --
 * and a picture the user has to look at is not one of them. This writes for
 * `bytedance/seedance-2.0/reference-to-video`, which takes the photographs and
 * needs no start frame, so the stage stops existing instead of being hidden.
 *
 * WHAT IS DELIBERATELY CARRIED OVER. Every ruling the other two prompts paid
 * for: rule 1 (the photograph is the only authority on the face), order (the
 * camera third, framing before light), the moment rather than a pose, the
 * snapshot rule against centring, prohibitions on the negatives channel and
 * never in the prose, and the absence of any quality marker. None of it is
 * inherited automatically -- a new function loses the lot in silence.
 *
 * WHAT IS DELIBERATELY NOT CARRIED OVER: the `seedance-prompt` skill's opening
 * aesthetic block. Every template in it starts "cinematic, 35mm film quality,
 * professional color grading, film grain, ARRI ALEXA aesthetic", and asking for
 * those lands model grain at 1080 underneath ffmpeg grain at 576. The skill's
 * @Image token structure is used; its style vocabulary is refused, which is the
 * ruling section 14 already recorded for the motion prompt.
 *
 * @param {object} args
 * @param {object} args.place        a validated place preset
 * @param {object} args.outfit       a validated outfit preset
 * @param {boolean} [args.placePhoto] true when the user attached a photo of the
 *                                    place, which then becomes @Image2
 * @param {string} [args.era]
 * @param {number} [args.seconds]    the whole tape in one call; 15 by default
 * @returns {{prompt: string, negativePrompt: string}}
 */
export function composeReferencePrompt({
  place, outfit, placePhoto = false, era = DEFAULT_ERA, seconds = 15, cameraMove = null,
} = {}) {
  requirePreset(place, 'place', ['id', 'label', 'timeOfDay', 'motionHint',
    ...['scene', 'light', 'lens', 'framing'].map((f) => `prompt.${f}`)]);
  requirePreset(outfit, 'outfit', ['id', 'label', 'wardrobe']);
  if (!isNonEmptyString(era)) throw new TypeError('era must be a non-empty string');

  const move = CAMCORDER_MOVES[cameraMove ?? place.cameraMove] ?? CAMCORDER_MOVES.drift;
  const kelvin = Number.isFinite(place.whiteBalanceK)
    ? place.whiteBalanceK
    : (WHITE_BALANCE_K[place.climate] ?? WHITE_BALANCE_K.warm);

  // @Image2 is named ONLY when something is actually attached to it. Naming a
  // reference nobody supplied invites the model to invent one, which is the
  // opposite of what an uploaded place is for.
  const scene = placePhoto
    ? 'the place in @Image2, unchanged: its own surfaces, its own objects, its own '
      + 'proportions, exactly as they appear there'
    : place.prompt.scene;

  const shotCount = shotCountFor(seconds);
  // The first named object in this place, close. A shot list that never leaves
  // the subject is a portrait in six pieces, and "the beach view, and
  // everything" is exactly the half Paul said was missing.
  const prop = String(place.prompt.eraProps).split(',')[0].trim();
  const propSentence = prop.charAt(0).toUpperCase() + prop.slice(1);

  // SIX BEATS, IN THE ORDER A HOME RECORDING ACTUALLY GOES: arrive, look
  // around, notice a thing, do the thing, react, settle. A shorter runtime
  // drops the middle and keeps the ends, so every length still opens on
  // arriving and closes on settling.
  // EXACTLY ONE BEAT IS THE PLACE WITHOUT THE PERSON, AND IT IS THE SECOND.
  // Four of the six used to be: the arrival, the pan, the prop and the close
  // all described the camera and the scene without ever naming the subject, so
  // the model left them out of all four. Measured on the two real tapes
  // (section 53), the customer was absent from 27% of the beach tape and 53%
  // of the 720p one, and BOTH ENDED ON A FRAME WITH NOBODY IN IT -- the closing
  // beat said "settle" without a subject, and "the camera comes to rest on the
  // scene" is a fair reading of that word.
  //
  // The wide of the place stays, because Paul asked for it in as many words and
  // a shot list that never leaves the subject is a portrait in six pieces. What
  // changes is that it is now the ONLY one, and that the tape ends on the
  // person who paid for it.
  const beats = [
    'Wide. Walking in at the near edge, camera following a step behind and swinging round to catch up with them.',
    `Wide. The whole place, camera panning slowly across it -- ${place.motionHint} -- and holding at the far side.`,
    `Close. ${propSentence}, with them just behind it in the same frame, camera pushing in and steadying.`,
    `Medium. ${place.prompt.moment ?? DEFAULT_MOMENT}, camera moving round to keep them in frame.`,
    'Medium close. Turning back toward the lens mid-gesture, camera lifting to meet them.',
    'Wide. One last look across the place with them still standing in it, camera drifting and settling on them.',
  ];
  const chosen = shotCount >= beats.length
    ? beats
    : [beats[0], ...beats.slice(1, shotCount - 1), beats[beats.length - 1]];

  const lines = [
    `${REFERENCE_SUBJECT}, wearing ${outfit.wardrobe}.`,
    `Place: ${scene}.`,
    // THE CAMERA IS A PERSON HERE, NOT A POSITION. That is the biggest single
    // change from the first direct run, whose camera clause said the operator
    // stood in one place and breathed -- and the model obeyed it exactly.
    'Somebody came along with a camera and is walking with them: hand-held at 63°, chest height, '
      + `${shotCount} shots cut in camera, real speed throughout. ${SNAPSHOT_RULE}.`,
    `Lens: ${place.prompt.lens}.`,
    `Light: ${place.prompt.light}. White balance ${kelvin}K, held across every shot.`,
    '',
    ...chosen.map((beat, i) => `Shot ${i + 1}: ${beat}`),
    '',
    `Period: ${era}. Vehicles, packaging, signage, appliances and the cut of every garment are `
      + 'consistent with it, and nothing visible was manufactured later.',
    'Exactly one person in frame, and it is the same place, the same wardrobe and the same light '
      + 'in every shot.',
  ];

  return {
    prompt: lines.join('\n'),
    // The still negatives ride along too: this path renders the composition
    // directly, so centring and a posed stance are exactly as available to it
    // as they were to the still, and there is no longer a frame to reject.
    negativePrompt: buildNegative(place, outfit, [...VLOG_NEGATIVES, ...STILL_NEGATIVES]),
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
