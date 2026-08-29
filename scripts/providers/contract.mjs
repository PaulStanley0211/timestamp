/**
 * The provider contract: typedefs, shape assertions, and the money guard.
 *
 * This file is pure. It never spawns, never reads a file, never touches the
 * network -- same boundary as `tapedeck/` and for the same payoff: every rule
 * in here is assertable in milliseconds, and both providers are held to the
 * identical rule by importing the identical function rather than by two
 * authors independently remembering it.
 *
 * WHAT THIS FILE IS ACTUALLY FOR. `fixture.mjs` and `fal.mjs` are not a stub
 * and a real thing. They are two genuinely different implementations -- one
 * spawns local ffmpeg, one makes paid HTTP calls -- and the only reason to
 * believe the seam between them is an abstraction rather than a wrapper with
 * optimism is that the same conformance test passes against both without the
 * test body being edited. Every assertion below is a clause of that test.
 *
 * THE THREE-LAYER NATIVE-AUDIO RULE, AND WHICH LAYER LIVES HERE. Modern video
 * models emit their own audio by default and it will fight the designed bed in
 * `audio/bed.mjs`. Three layers guard one boolean:
 *
 *   1. `VideoRequest.nativeAudio` is REQUIRED and REQUIRED to be `false`.
 *      Enforced by `assertVideoRequest` below. A missing field is a failure,
 *      not a default -- "forgot to pass it" and "deliberately passed false"
 *      must not produce the same call.
 *   2. The provider shape itself: `capabilities.supportsNativeAudioOff` must
 *      be `true`, and `assertAudioOff` requires every video model in
 *      `config/models.json` to name the parameter that turns it off.
 *      Enforced by `assertProvider` and `assertAudioOff` below.
 *   3. An `ffprobe` check that the file that actually came back has zero audio
 *      streams. That one is NOT here and cannot be: only the pipeline sees the
 *      downloaded file. It lives in `render/pipeline.mjs`, step `assemble`.
 *
 * Three layers for one boolean looks paranoid until a model version bump
 * quietly re-enables it and you ship a week of videos with two ambiences
 * arguing.
 *
 * @typedef {Object} Reference
 * @property {'face'|'place'} role
 * @property {string} path                absolute
 *
 * @typedef {Object} StillRequest
 * @property {string} prompt
 * @property {string} negativePrompt
 * @property {Reference[]} references     >=1, exactly one with role 'face'
 * @property {number} seed                0..2147483647
 * @property {number} count               1..8
 * @property {{width:number,height:number}} size    4:3, e.g. 1024x768
 * @property {string} idempotencyKey
 *
 * @typedef {Object} StillResult
 * @property {Array<{path:string,index:number,seed:number}>} stills
 * @property {{estimated:number,actual:number|null,currency:'USD'}} cost
 * @property {{model:string,requestId:string,latencyMs:number}} meta
 *
 * @typedef {Object} VideoRequest
 * @property {string} prompt
 * @property {string} negativePrompt
 * @property {string} imagePath           the approved still, or prev last frame
 * @property {number} seed
 * @property {number} seconds
 * @property {false} nativeAudio          REQUIRED and REQUIRED to be false
 * @property {string} idempotencyKey
 * @property {number} [index]             1-based segment number; see below
 *
 * @typedef {Object} VideoResult
 * @property {{path:string,seconds:number}} clip
 * @property {{estimated:number,actual:number|null,currency:'USD'}} cost
 * @property {{model:string,requestId:string,latencyMs:number}} meta
 *
 * @typedef {Object} ProviderCtx
 * @property {string} outDir
 * @property {function} [fetchImpl]       NO DEFAULT on a paid provider
 * @property {function} [sleepImpl]
 * @property {AbortSignal} [signal]
 * @property {(e:{phase:string,pct?:number,message?:string})=>void} [onProgress]
 */

import path from 'node:path';
import { SEED_MAX } from '../compose/seed.mjs';
import { TerminalError, CapabilityError } from './errors.mjs';

/** Stills are 1-BASED, because `docs/interfaces.md` writes the first planned
 *  segment as `{ "index": 1, ... }` and names provider output `still-01.png`
 *  and `seg-01.mp4`. One numbering scheme across the manifest, the filenames
 *  and the result arrays; the alternative is an off-by-one that only shows up
 *  as the wrong still being animated, which is a silent, expensive bug. */
export const FIRST_INDEX = 1;

/** `count` is capped at 8 by the StillRequest typedef. Named here so the
 *  provider, the web form and the test all cite the same number. */
export const MAX_STILL_COUNT = 8;

/** The phases a provider may report through `ctx.onProgress`. Frozen and
 *  closed: the status page renders a label per phase, and a provider inventing
 *  a phase name would render as a blank step rather than an error. */
export const PROGRESS_PHASES = Object.freeze(['submit', 'queued', 'running', 'download', 'done']);

/** The only currency in the system. Kept as a constant so a provider returning
 *  EUR fails a shape assertion instead of silently being summed with dollars
 *  in the ledger. */
export const CURRENCY = 'USD';

/**
 * Which provider ids spend money, as a plain list.
 *
 * WHY THIS IS DUPLICATED FROM THE PROVIDERS THEMSELVES, WHICH IS NORMALLY THE
 * WRONG ANSWER. The web layer needs it -- it renders a menu of frame shapes
 * and only some of them are renderable on a paid path, so a page that does not
 * know is a page that offers a choice the renderer will refuse. But it must
 * not ASK a provider: `providers/index.mjs` statically imports `fal.mjs`, and
 * keeping that module out of the web process is what three of the four money
 * guards are for. `server-cli.mjs` already goes to the trouble of a lazy
 * import for exactly this reason.
 *
 * This file is a leaf -- node builtins, `seed.mjs` and `errors.mjs` -- so
 * importing it costs nothing and pulls in no provider.
 *
 * THE DRIFT IS CLOSED BY A TEST, not by hoping. `provider-contract.test.js`
 * builds every real provider and compares this list against its own `paid`
 * flag, so a provider added later that nobody lists here goes red rather than
 * being quietly treated as free.
 */
export const PAID_PROVIDER_IDS = Object.freeze(['fal']);

/** Whether a provider id spends money, by name alone. */
export const isPaidProviderId = (id) => PAID_PROVIDER_IDS.includes(String(id));

const bad = (code, message, detail = null) => new TerminalError(message, { code, detail, provider: 'contract' });

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

function requireString(obj, key, where, { allowEmpty = false } = {}) {
  const v = obj?.[key];
  if (typeof v !== 'string' || (!allowEmpty && v.length === 0)) {
    throw bad('invalid_request', `${where}.${key} must be a${allowEmpty ? '' : ' non-empty'} string, got ${JSON.stringify(v)}`, { key });
  }
  return v;
}

function requireSeed(obj, where) {
  const v = obj?.seed;
  if (!Number.isInteger(v) || v < 0 || v > SEED_MAX) {
    throw bad('invalid_request', `${where}.seed must be an integer in 0..${SEED_MAX}, got ${JSON.stringify(v)} -- see compose/seed.mjs`, { seed: v });
  }
  return v;
}

/** An absolute path, checked as a string only. Deliberately no `existsSync`:
 *  this module is pure, and "the file is missing" is a different failure with a
 *  different owner (the provider raises it, because the provider is the one
 *  that was about to upload it). */
function requireAbsolutePath(obj, key, where) {
  const v = requireString(obj, key, where);
  if (!path.isAbsolute(v)) {
    throw bad('invalid_request', `${where}.${key} must be absolute, got ${JSON.stringify(v)}`, { key, value: v });
  }
  return v;
}

/**
 * The shapes the tape stage has geometry for.
 *
 * THIS USED TO BE THE SINGLE VALUE 4:3, and its reasoning -- "the tape raster
 * is 720x576 with SAR 16/15, i.e. DAR 4:3" -- was true when it was written and
 * stopped being true when section 13 gave every shape its own tape raster:
 * 720x576, 1024x576 and 576x1024, each holding the short edge at 576. The
 * check was right and its premise went stale.
 *
 * WHAT IT IS STILL FOR, unchanged: a still that arrives at an aspect nobody
 * planned gets cropped or pillared somewhere downstream without anyone
 * deciding where. So the rule is not "4:3" and it is not "anything" -- it is
 * "a shape this product has a tape frame for", and a test cross-checks this
 * list against `config/render.json`, which is the authority.
 */
export const SHIPPED_ASPECTS = Object.freeze(['4:3', '16:9', '9:16']);

const RATIOS = SHIPPED_ASPECTS.map((a) => {
  const [w, h] = a.split(':').map(Number);
  return { aspect: a, w, h };
});

/**
 * The shape id for a raster, or null when it is not one this product ships.
 *
 * WHY THIS IS A TOLERANCE AND NOT AN EXACT CROSS-MULTIPLICATION, which was the
 * first attempt and was wrong. There is NO integer width that makes 16:9 exact
 * at a height of 480 -- 480 is not divisible by 9 -- which is precisely why
 * 854x480 is the industry-standard 480p widescreen raster and is itself 0.08%
 * off. Demanding exactness would reject the only raster anybody actually uses.
 * yuv420p forces both edges even on top of that, so the rounding is not
 * optional either.
 *
 * 1% is safe rather than arbitrary: the shapes this product ships are 1.333,
 * 1.778 and 0.5625, and the closest pair is 33% apart. The widest real error is
 * 854x480 at 0.078%, so there is more than two orders of magnitude of headroom
 * before two shapes could be confused.
 */
const ASPECT_TOLERANCE = 0.01;

export function aspectOf(size) {
  if (!Number.isFinite(size?.width) || !Number.isFinite(size?.height) || size.height <= 0) return null;
  const actual = size.width / size.height;
  const hit = RATIOS.find(({ w, h }) => Math.abs(actual - w / h) / (w / h) <= ASPECT_TOLERANCE);
  return hit ? hit.aspect : null;
}

function requireShippedAspect(size, where) {
  if (!isPlainObject(size)) {
    throw bad('invalid_request', `${where}.size must be {width,height}, got ${JSON.stringify(size)}`);
  }
  const { width, height } = size;
  for (const [k, v] of [['width', width], ['height', height]]) {
    if (!Number.isInteger(v) || v <= 0) {
      throw bad('invalid_request', `${where}.size.${k} must be a positive integer, got ${JSON.stringify(v)}`, { size });
    }
  }
  // yuv420p subsamples chroma by two, so an odd edge is a filtergraph failure
  // at the far end of a paid render rather than a rejected request here.
  for (const [k, v] of [['width', width], ['height', height]]) {
    if (v % 2 !== 0) {
      throw bad('invalid_request', `${where}.size.${k} must be even -- yuv420p subsamples chroma by two -- got ${v}`, { size });
    }
  }
  if (aspectOf(size) === null) {
    throw bad(
      'invalid_request',
      `${where}.size must be one of ${SHIPPED_ASPECTS.join(', ')} -- the tape stage has no frame for anything else -- got ${width}x${height}`,
      { size, shipped: SHIPPED_ASPECTS },
    );
  }
  return size;
}

function requireCost(cost, where) {
  if (!isPlainObject(cost)) throw bad('invalid_result', `${where}.cost must be an object, got ${JSON.stringify(cost)}`);
  if (!Number.isFinite(cost.estimated) || cost.estimated < 0) {
    throw bad('invalid_result', `${where}.cost.estimated must be a non-negative number, got ${JSON.stringify(cost.estimated)}`, { cost });
  }
  if (!(cost.actual === null || (Number.isFinite(cost.actual) && cost.actual >= 0))) {
    throw bad('invalid_result', `${where}.cost.actual must be null or a non-negative number, got ${JSON.stringify(cost.actual)} -- null means "not metered yet", never 0`, { cost });
  }
  if (cost.currency !== CURRENCY) {
    throw bad('invalid_result', `${where}.cost.currency must be ${CURRENCY}, got ${JSON.stringify(cost.currency)}`, { cost });
  }
}

function requireMeta(meta, where) {
  if (!isPlainObject(meta)) throw bad('invalid_result', `${where}.meta must be an object, got ${JSON.stringify(meta)}`);
  requireString(meta, 'model', `${where}.meta`);
  requireString(meta, 'requestId', `${where}.meta`);
  if (!Number.isFinite(meta.latencyMs) || meta.latencyMs < 0) {
    throw bad('invalid_result', `${where}.meta.latencyMs must be a non-negative number, got ${JSON.stringify(meta.latencyMs)}`, { meta });
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** @param {StillRequest} req */
export function assertStillRequest(req) {
  if (!isPlainObject(req)) throw bad('invalid_request', `StillRequest must be an object, got ${JSON.stringify(req)}`);
  requireString(req, 'prompt', 'StillRequest');
  requireString(req, 'negativePrompt', 'StillRequest', { allowEmpty: true });
  requireSeed(req, 'StillRequest');
  requireString(req, 'idempotencyKey', 'StillRequest');
  requireShippedAspect(req.size, 'StillRequest');

  if (!Number.isInteger(req.count) || req.count < 1 || req.count > MAX_STILL_COUNT) {
    throw bad('invalid_request', `StillRequest.count must be an integer in 1..${MAX_STILL_COUNT}, got ${JSON.stringify(req.count)}`, { count: req.count });
  }

  requireReferences(req.references, 'StillRequest');
}

/**
 * The reference images, wherever they are attached.
 *
 * Shared between the still request and the video request rather than written
 * twice: `reference-to-video` takes exactly the same photographs the still
 * stage used to, so a rule that held for one and not the other would be an
 * accident. Extracted when the direct path landed, 2026-08-24.
 */
function requireReferences(references, what) {
  if (!Array.isArray(references) || references.length === 0) {
    throw bad('invalid_request', `${what}.references must be a non-empty array`, { references });
  }
  references.forEach((ref, i) => {
    if (!isPlainObject(ref)) throw bad('invalid_request', `${what}.references[${i}] must be an object`, { ref });
    if (ref.role !== 'face' && ref.role !== 'place') {
      throw bad('invalid_request', `${what}.references[${i}].role must be 'face' or 'place', got ${JSON.stringify(ref.role)}`, { ref });
    }
    requireAbsolutePath(ref, 'path', `${what}.references[${i}]`);
  });

  // Exactly one face, and it is the whole product. The photo is the identity
  // anchor; two faces is an averaging instruction and zero faces is a stock
  // photo generator. Neither is a thing anyone asked for.
  const faces = references.filter((r) => r.role === 'face').length;
  if (faces !== 1) {
    throw bad('invalid_request', `${what}.references must contain exactly one reference with role 'face', found ${faces}`, { faces });
  }
}

/** @param {VideoRequest} req */
export function assertVideoRequest(req) {
  if (!isPlainObject(req)) throw bad('invalid_request', `VideoRequest must be an object, got ${JSON.stringify(req)}`);
  requireString(req, 'prompt', 'VideoRequest');
  requireString(req, 'negativePrompt', 'VideoRequest', { allowEmpty: true });
  // EXACTLY ONE OF THE TWO, and never both.
  //
  // `imagePath` is image-to-video's start frame: the still a human approved.
  // `references` is `reference-to-video`, which has no start frame at all and
  // generates the whole take from the photographs -- the path with no still in
  // it, which is the product Paul actually described.
  //
  // Both together is refused rather than resolved by precedence, because which
  // one a model honours would differ per vendor, and discovering that costs a
  // paid call. The same ambiguity is refused again in falReferenceVideoBody.
  const hasReferences = req.references !== undefined;
  const hasImage = req.imagePath !== undefined;
  if (hasReferences && hasImage) {
    throw bad('invalid_request',
      'VideoRequest carries both imagePath and references; exactly one is allowed',
      { imagePath: req.imagePath });
  }
  if (!hasReferences && !hasImage) {
    throw bad('invalid_request',
      'VideoRequest needs either imagePath (a start frame) or references (the photographs)', {});
  }
  if (hasReferences) requireReferences(req.references, 'VideoRequest');
  else requireAbsolutePath(req, 'imagePath', 'VideoRequest');
  requireSeed(req, 'VideoRequest');
  requireString(req, 'idempotencyKey', 'VideoRequest');

  if (!Number.isFinite(req.seconds) || req.seconds <= 0) {
    throw bad('invalid_request', `VideoRequest.seconds must be a positive number, got ${JSON.stringify(req.seconds)}`, { seconds: req.seconds });
  }

  // `index` is an interpretation, not a field interfaces.md names. The manifest
  // layout says provider output lands at `segments/seg-01.mp4`, and nothing
  // else in VideoRequest tells a provider which segment it is building. It is
  // optional; a provider without it names from a hash of the idempotency key,
  // which is collision-free but does not match the documented filename.
  if (req.index !== undefined && (!Number.isInteger(req.index) || req.index < FIRST_INDEX)) {
    throw bad('invalid_request', `VideoRequest.index, when present, must be an integer >= ${FIRST_INDEX}, got ${JSON.stringify(req.index)}`, { index: req.index });
  }

  // Layer 1 of the three-layer native-audio rule. Missing is a failure and not
  // a default: `undefined !== false` is true either way, but the message has
  // to say which mistake was made or the next person adds `?? false` and
  // deletes the guard by accident.
  if (!Object.hasOwn(req, 'nativeAudio')) {
    throw bad('native_audio', 'VideoRequest.nativeAudio is REQUIRED and must be false -- a model that generates its own audio fights the bed built in audio/bed.mjs. See CLAUDE.md, "Set the video model\'s native audio OFF".', { nativeAudio: undefined });
  }
  if (req.nativeAudio !== false) {
    throw bad('native_audio', `VideoRequest.nativeAudio must be exactly false, got ${JSON.stringify(req.nativeAudio)}`, { nativeAudio: req.nativeAudio });
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** @param {StillResult} res */
export function assertStillResult(res) {
  if (!isPlainObject(res)) throw bad('invalid_result', `StillResult must be an object, got ${JSON.stringify(res)}`);
  if (!Array.isArray(res.stills) || res.stills.length === 0) {
    throw bad('invalid_result', 'StillResult.stills must be a non-empty array', { stills: res.stills });
  }
  res.stills.forEach((s, i) => {
    if (!isPlainObject(s)) throw bad('invalid_result', `StillResult.stills[${i}] must be an object`, { still: s });
    requireAbsolutePath(s, 'path', `StillResult.stills[${i}]`);
    if (s.index !== i + FIRST_INDEX) {
      throw bad('invalid_result', `StillResult.stills[${i}].index must be ${i + FIRST_INDEX} -- stills are ${FIRST_INDEX}-based and contiguous, in array order -- got ${JSON.stringify(s.index)}`, { still: s });
    }
    if (!Number.isInteger(s.seed) || s.seed < 0 || s.seed > SEED_MAX) {
      throw bad('invalid_result', `StillResult.stills[${i}].seed must be an integer in 0..${SEED_MAX}, got ${JSON.stringify(s.seed)}`, { still: s });
    }
  });
  requireCost(res.cost, 'StillResult');
  requireMeta(res.meta, 'StillResult');
}

/** @param {VideoResult} res */
export function assertVideoResult(res) {
  if (!isPlainObject(res)) throw bad('invalid_result', `VideoResult must be an object, got ${JSON.stringify(res)}`);
  if (!isPlainObject(res.clip)) throw bad('invalid_result', `VideoResult.clip must be an object, got ${JSON.stringify(res.clip)}`);
  requireAbsolutePath(res.clip, 'path', 'VideoResult.clip');
  if (!Number.isFinite(res.clip.seconds) || res.clip.seconds <= 0) {
    throw bad('invalid_result', `VideoResult.clip.seconds must be a positive number, got ${JSON.stringify(res.clip.seconds)}`, { clip: res.clip });
  }
  requireCost(res.cost, 'VideoResult');
  requireMeta(res.meta, 'VideoResult');
}

// ---------------------------------------------------------------------------
// The provider object
// ---------------------------------------------------------------------------

/**
 * The shape of the object itself.
 *
 * `paid` is an interpretation: interfaces.md's provider literal does not list
 * it, but the money guard below has to know which providers are allowed to
 * default `fetchImpl` and which must not, and inferring that from the id is
 * exactly the kind of implicit rule that stops being true the day a second
 * free provider appears. A boolean that has to be written down is cheaper than
 * a registry of names that has to be maintained.
 *
 * @param {object} p
 */
export function assertProvider(p) {
  if (!isPlainObject(p)) throw bad('invalid_provider', `provider must be an object, got ${JSON.stringify(p)}`);
  requireString(p, 'id', 'provider');
  if (typeof p.paid !== 'boolean') {
    throw bad('invalid_provider', `provider.paid must be a boolean -- it decides whether ctx.fetchImpl may have a default -- got ${JSON.stringify(p.paid)}`, { id: p.id });
  }
  for (const fn of ['generateStill', 'generateVideo']) {
    if (typeof p[fn] !== 'function') {
      throw bad('invalid_provider', `provider.${fn} must be a function, got ${typeof p[fn]}`, { id: p.id });
    }
  }

  const c = p.capabilities;
  if (!isPlainObject(c)) throw bad('invalid_provider', `provider.capabilities must be an object, got ${JSON.stringify(c)}`, { id: p.id });

  if (!Number.isFinite(c.maxClipSeconds) || c.maxClipSeconds <= 0) {
    throw bad('invalid_provider', `provider.capabilities.maxClipSeconds must be a positive number, got ${JSON.stringify(c.maxClipSeconds)}`, { id: p.id });
  }
  if (!Number.isInteger(c.maxReferences) || c.maxReferences < 1) {
    throw bad('invalid_provider', `provider.capabilities.maxReferences must be an integer >= 1, got ${JSON.stringify(c.maxReferences)}`, { id: p.id });
  }
  if (!Array.isArray(c.stillSizes) || c.stillSizes.length === 0) {
    throw bad('invalid_provider', 'provider.capabilities.stillSizes must be a non-empty array', { id: p.id });
  }
  c.stillSizes.forEach((s, i) => requireShippedAspect(s, `provider.capabilities.stillSizes[${i}]`));

  if (typeof c.supportsPlaceReference !== 'boolean') {
    throw bad('invalid_provider', `provider.capabilities.supportsPlaceReference must be a boolean, got ${JSON.stringify(c.supportsPlaceReference)}`, { id: p.id });
  }

  // Layer 2 of the three-layer native-audio rule. `true` and not merely a
  // boolean: phase-0 criterion 4 disqualifies a model that cannot be told to
  // shut up. Paul has flagged that criterion as possibly too strict for
  // Timestamp -- we never map the model's audio stream, so its audio wastes
  // generation cost rather than reaching the output. If he relaxes it, THIS is
  // the line that changes, and it changes in docs/interfaces.md first.
  if (c.supportsNativeAudioOff !== true) {
    throw bad('invalid_provider', `provider.capabilities.supportsNativeAudioOff must be true, got ${JSON.stringify(c.supportsNativeAudioOff)} -- a model with no audio-off parameter is disqualified under docs/phase-0-validation.md criterion 4`, { id: p.id });
  }
}

/**
 * THE MONEY GUARD. A paid provider has no default for `fetchImpl`.
 *
 * `npm test` must be unable to spend money, and one guard is not enough
 * because the failure mode is a bill rather than a red test. This is guard 1
 * of the four in CLAUDE.md: a test that forgets to inject a transport gets a
 * `TypeError` -- a plain `TypeError`, not a ProviderError, because a
 * ProviderError is something the pipeline catches, records and possibly
 * retries, and this must be none of those things. It is a wiring bug and it
 * should crash.
 *
 * Call it FIRST in a paid provider's entry points, before reading credentials,
 * before validating the request, before anything that could throw something
 * else and hide it.
 */
export function requireFetchImpl(ctx, { provider = 'unknown' } = {}) {
  if (typeof ctx?.fetchImpl !== 'function') {
    throw new TypeError(
      `${provider}: ctx.fetchImpl has NO DEFAULT on a paid provider and must be injected. ` +
      'This is deliberate -- a test that forgets it must get this TypeError rather than a bill. ' +
      'See CLAUDE.md, "Money discipline".',
    );
  }
  return ctx.fetchImpl;
}

// ---------------------------------------------------------------------------
// Capability gates -- shared so both providers raise the identical error
// ---------------------------------------------------------------------------

const sameSize = (a, b) => a.width === b.width && a.height === b.height;

/** Ask-for-what-it-cannot-do, checked locally, before a request exists. Both
 *  providers import this rather than each writing their own check, which is
 *  the only way "identical error classes" survives contact with two authors. */
export function assertCapableStill(provider, req) {
  const c = provider.capabilities;
  if (!c.stillSizes.some((s) => sameSize(s, req.size))) {
    throw new CapabilityError(
      `${provider.id}: does not offer ${req.size.width}x${req.size.height}. Offers: ${c.stillSizes.map((s) => `${s.width}x${s.height}`).join(', ')}`,
      { provider: provider.id, code: 'unsupported_size', detail: { requested: req.size, offered: c.stillSizes } },
    );
  }
  if (req.references.length > c.maxReferences) {
    throw new CapabilityError(
      `${provider.id}: accepts at most ${c.maxReferences} reference image(s), got ${req.references.length}`,
      { provider: provider.id, code: 'too_many_references', detail: { max: c.maxReferences, got: req.references.length } },
    );
  }
  if (!c.supportsPlaceReference && req.references.some((r) => r.role === 'place')) {
    throw new CapabilityError(
      `${provider.id}: does not accept a 'place' reference image`,
      { provider: provider.id, code: 'no_place_reference', detail: {} },
    );
  }
}

export function assertCapableVideo(provider, req) {
  const c = provider.capabilities;
  if (req.seconds > c.maxClipSeconds) {
    throw new CapabilityError(
      `${provider.id}: maxClipSeconds is ${c.maxClipSeconds}, asked for ${req.seconds}. Split the take into segments -- see animate/plan.mjs.`,
      { provider: provider.id, code: 'clip_too_long', detail: { max: c.maxClipSeconds, got: req.seconds } },
    );
  }
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/** @param {{phase:string,pct?:number,message?:string}} e */
export function assertProgressEvent(e) {
  if (!isPlainObject(e)) throw bad('invalid_progress', `progress event must be an object, got ${JSON.stringify(e)}`);
  if (!PROGRESS_PHASES.includes(e.phase)) {
    throw bad('invalid_progress', `progress phase must be one of ${PROGRESS_PHASES.join('|')}, got ${JSON.stringify(e.phase)}`, { event: e });
  }
  if (e.pct !== undefined && (!Number.isFinite(e.pct) || e.pct < 0 || e.pct > 100)) {
    throw bad('invalid_progress', `progress pct must be 0..100, got ${JSON.stringify(e.pct)}`, { event: e });
  }
  if (e.message !== undefined && !isNonEmptyString(e.message)) {
    throw bad('invalid_progress', `progress message, when present, must be a non-empty string, got ${JSON.stringify(e.message)}`, { event: e });
  }
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/**
 * Layer 2's other half: a video model entry from `config/models.json` must
 * name the parameter that turns its audio off.
 *
 * A `null` audioOffParam is not a shrug. Under phase-0 criterion 4 it means
 * the model is disqualified until somebody reads the schema and writes the
 * parameter down, and `CapabilityError` is exactly right for that -- terminal,
 * fixable by config, never retried.
 */
export function assertAudioOff(entry, { model = 'unknown' } = {}) {
  if (!isPlainObject(entry)) {
    throw new CapabilityError(`model ${model} is not in config/models.json`, { code: 'unknown_model', detail: { model } });
  }
  if (entry.kind !== 'video') return;

  if (entry.nativeAudio !== false) {
    throw new CapabilityError(
      `model ${model}: nativeAudio must be recorded as false in config/models.json, got ${JSON.stringify(entry.nativeAudio)}`,
      { code: 'native_audio', detail: { model, entry } },
    );
  }
  const p = entry.audioOffParam;
  if (!isPlainObject(p) || !isNonEmptyString(p.name) || !Object.hasOwn(p, 'value')) {
    throw new CapabilityError(
      `model ${model}: no audio-off parameter recorded in config/models.json. A video model that cannot be told to stop generating audio is disqualified under docs/phase-0-validation.md criterion 4 -- find the parameter, record its name and value, then use the model.`,
      { code: 'no_audio_off_param', detail: { model, audioOffParam: p ?? null } },
    );
  }
  return p;
}
