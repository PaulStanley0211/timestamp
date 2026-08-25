/**
 * The fal.ai provider. The one that spends money.
 *
 * WHAT THIS FILE IS HELD TO. `fixture.mjs` spawns local ffmpeg; this makes paid
 * HTTP calls; they share no code path worth the name. The only honest reason
 * the pipeline may call `provider.generateStill` without knowing which one it
 * is holding is that `test/provider-contract.test.js` passes against both with
 * its body unedited. Every shape below exists to make that true -- including
 * the ones that look like they are fighting the transport, `meta.requestId`
 * most of all (see `falRequestId`).
 *
 * THE MONEY GUARDS, AND WHICH ONES LIVE HERE. `npm test` must be unable to
 * spend a cent, enforced four independent ways because the failure mode is a
 * bill rather than a red test:
 *
 *   1. `ctx.fetchImpl` has NO DEFAULT and `requireFetchImpl` is the FIRST line
 *      of both entry points. A test that forgets to inject a transport gets a
 *      plain `TypeError` -- not a ProviderError, because a ProviderError is
 *      something the pipeline catches, records and may retry, and a missing
 *      transport is a wiring bug that should crash.
 *   2. The credential is read at CALL time through `envImpl`, never at
 *      construction, and the read happens after every free check has run --
 *      so a missing key is a `CredentialError` raised before any request is
 *      attempted, and that ORDER is under test in test/provider-fal.test.js.
 *   3. `"test": "node --test"` is bare and does not load `.env`, so `FAL_KEY`
 *      is not in the process during a test run at all.
 *   4. The only file permitted to spend is `test/fal-smoke.test.js`, which
 *      self-skips unless `TIMESTAMP_LIVE=1`.
 *
 * WHY THE CREDENTIAL READ IS AN ACCESSOR AND NOT A VALUE. `--dry-run` builds a
 * provider purely to read `capabilities` and name the calls it would make, and
 * it has to work on a laptop with no key at all. A factory that read `FAL_KEY`
 * would turn "what would this cost?" into "you cannot ask without a
 * credential", which is exactly backwards for the one command that exists to
 * be run before spending. So the factory stores `envImpl` and nothing else.
 *
 * THE THREE-LAYER NATIVE-AUDIO RULE, AND THE FACT THAT LAYER 1 IS NOT ENOUGH
 * HERE. Seedance 2.0's `generate_audio` DEFAULTS TO TRUE. Not sending it means
 * every clip comes back with the model's idea of what a Schrebergarten sounds
 * like, underneath the bed built in `audio/bed.mjs` -- two ambiences arguing,
 * in a product whose entire audio spec is the word "quiet". So:
 *   layer 1  `VideoRequest.nativeAudio` is required and required to be false
 *            (assertVideoRequest), and `videoBody` writes `generate_audio:
 *            false` from it rather than from a constant, so the two cannot
 *            drift apart;
 *   layer 2  `capabilities.supportsNativeAudioOff` plus `assertAudioOff` over
 *            the model entry in config/models.json;
 *   layer 3  the ffprobe check in `render/pipeline.mjs` step `assemble`, on
 *            the file that actually arrived. That is the layer that catches a
 *            version bump quietly re-enabling audio, and it is the reason the
 *            other two are not theatre.
 *
 * ONE CALL, NO SEAM. Seedance takes 4..15 seconds in a single request, so a
 * 15-second tape is ONE generation and there is no last-frame chain and no
 * join to inspect. `animate/plan.mjs` produces a single segment against this
 * provider's `maxClipSeconds: 15` and the multi-segment path stays in the code
 * because it is tested and the next provider may need it. Phase-0 criterion 5
 * -- "is the join visible" -- is simply not asked of this model.
 *
 * ALWAYS 4:3, ALWAYS. `aspect_ratio: '4:3'` is sent on every call because the
 * tape raster is 720x576 at SAR 16/15, i.e. DAR 4:3. Asking for 16:9 and
 * cropping throws away a third of the frame we paid for AND moves the crop
 * decision to whichever downstream filter happens to make it. The resolutions
 * offered here are therefore the 4:3 rasters -- 640x480 and 960x720 -- not the
 * 16:9 shapes those labels usually name. config/credits.json carries the same
 * reasoning next to the money.
 *
 * AND THE ENDPOINT IS NOT WHAT STOPS US, WHICH IS WORTH KNOWING BEFORE THE NEXT
 * PERSON RE-DERIVES IT. Read on both of fal's pages on 2026-08-24: `aspect_ratio`
 * accepts `auto`, `21:9`, `16:9`, `4:3`, `1:1`, `3:4` and `9:16` on image-to-video
 * AND on reference-to-video, so the other two shapes this product sells would be
 * ORDERED natively rather than cropped, and the paragraph above is an argument
 * against cropping rather than an argument against 16:9. What stops it is here
 * and one level up: `FAL_RESOLUTIONS` is a 4:3 table by construction -- the label
 * is the height and 4:3 supplies the width -- `animate/plan.mjs` derives the same
 * rasters from the same rule with a test that they agree, and `resolveRaster`
 * refuses a paid job at any non-default shape. Three things move together, and
 * the fourth is pricing: 16:9 at 1024x576 is FEWER pixels than 4:3 at 720p and
 * every price in this repo is still an unmetered estimate. See the raster
 * question in config/models.json first -- this endpoint has already returned a
 * size nobody ordered.
 *
 * WHAT IS NOT VERIFIED, AND IS MARKED SO. The video endpoints and their
 * parameters come from fal's own documentation. THE STILL MODEL HAS NOT BEEN
 * CHOSEN -- config/models.json lists candidates, all `verified: false`, and
 * `modelEntry` refuses to hand one out, so `generateStill` against the real
 * config fails with `unverified_model` before it can spend. That is the
 * correct behaviour and not an oversight: the still is the identity anchor and
 * the cheap rejection gate, the choice is Paul's, and it is downstream of
 * Phase 0. The request shape written here is the fal image-edit convention
 * (`prompt` + `image_urls` + `aspect_ratio`), which is what the candidates
 * share; it is a GUESS until one of them is opened and read.
 *
 * NO NEGATIVE PROMPT EXISTS ON THESE ENDPOINTS. Seedance 2.0 has no
 * `negative_prompt` parameter and neither do the image-edit candidates.
 * `req.negativePrompt` is therefore NOT sent, and it is deliberately not
 * appended to the prompt either: a model with no negative channel reads "no
 * text, no watermark, no extra people" as a list of things the scene contains,
 * which is the failure it was written to prevent. It stays in the manifest as
 * the record of what we would have asked for.
 */

import fs from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../ffmpeg/run.mjs';
import { SEED_MAX } from '../compose/seed.mjs';
import {
  CredentialError,
  TerminalError,
  TimeoutError,
  RetriableError,
  CapabilityError,
  classifyHttp,
  withRetry,
} from './errors.mjs';
import { loadPricing, estimateStill, estimateVideo, cost } from './pricing.mjs';
import {
  FIRST_INDEX,
  assertStillRequest,
  assertVideoRequest,
  assertCapableStill,
  assertCapableVideo,
  requireFetchImpl,
} from './contract.mjs';

export const FAL_ID = 'fal';

/** The queue API host. Everything paid goes through here and the credential is
 *  sent to THIS host and no other -- see `assertAllowedHost`. */
export const FAL_QUEUE_BASE = 'https://queue.fal.run';

/**
 * The only aspect ratio this product ever asks for. Named rather than inlined
 * because it appears in both bodies and in the report a reviewer reads.
 */
export const FAL_ASPECT_RATIO = '4:3';

/**
 * The resolutions on offer, as the 4:3 RASTER each label means here.
 *
 * fal's `resolution` enum is a label; what "720p" renders as depends on the
 * aspect ratio requested alongside it. We always request 4:3, so 720p is
 * 960x720 and not 1280x720, and 480p is 640x480 and not 854x480. The rule is
 * one line -- the number in the label is the height, and 4:3 gives the width --
 * and `animate/plan.mjs` derives the same rasters from the same rule for the
 * pipeline. Two derivations of one rule cannot disagree without somebody
 * deliberately editing one of them, and there is a test that they agree.
 *
 * 1080p and 4k appear in fal's enum and are NOT offered here: 1080p is
 * `available: false` in config/credits.json (the tape raster is 736x588, 720p
 * already covers it, and `creditCost` throws rather than quietly billing for
 * pixels that are discarded before the grain goes on).
 */
export const FAL_RESOLUTIONS = Object.freeze({
  '480p': Object.freeze({ width: 640, height: 480 }),
  '720p': Object.freeze({ width: 960, height: 720 }),
});

/** In offer order, cheapest first -- `stillSizes[0]` is what a caller that has
 *  not asked for a resolution gets, and the default in config/credits.json is
 *  480p because the product is credit-conscious. */
export const FAL_SIZES = Object.freeze(Object.values(FAL_RESOLUTIONS));

/** Seedance 2.0 takes 4..15 seconds in ONE call. The 15 is the whole reason
 *  this provider has no segment seam; the 4 is a real floor and a request for
 *  3 seconds is a 422 that costs a round trip to discover. */
export const FAL_MIN_CLIP_SECONDS = 4;
export const FAL_MAX_CLIP_SECONDS = 15;

/**
 * Two: the face, and optionally the place photo. That is what this product
 * sends.
 *
 * `reference-to-video` documents nine and the image-edit candidates claim ten
 * to fourteen, and none of that is verified for the identity behaviour we
 * actually need. A capability number is a promise the provider has to keep, so
 * it records what we know we can do rather than the largest number on a
 * marketing page.
 */
export const FAL_MAX_REFERENCES = 2;

/**
 * The default endpoints, mirroring config/models.json.
 *
 * VERIFIED against fal's own documentation: both routes exist, both take
 * `generate_audio` (default TRUE), `duration` is a STRING enum of `auto` and
 * `4`..`15`, `aspect_ratio` includes `4:3`, and `resolution` includes `480p`
 * and `720p`. `reference-to-video` takes `image_urls` (up to 9) referenced
 * from the prompt as `@Image1`, `@Image2` -- which is the two-reference path,
 * the face photo and the place photo, and it is the thing no preset-menu
 * competitor can match.
 */
export const FAL_ENDPOINTS = Object.freeze({
  imageToVideo: 'bytedance/seedance-2.0/image-to-video',
  referenceToVideo: 'bytedance/seedance-2.0/reference-to-video',
});

/**
 * Hosts we will talk to, by suffix.
 *
 * The queue hands back `status_url`, `response_url` and a CDN url for the
 * finished file, and following a URL out of a response body without looking at
 * it is how a compromised or simply wrong upstream turns into a credential
 * posted somewhere else. The credential goes to the queue host ONLY; the CDN
 * download is unauthenticated on purpose. That rule is enforced where the
 * header is attached, in `call` -- an authorized request to any other host on
 * this list is refused before a socket opens, not merely frowned at here.
 */
const ALLOWED_HOSTS = Object.freeze([
  'queue.fal.run',
  'fal.run',
  'fal.ai',
  'fal.media',
  'storage.googleapis.com',
]);

export const FAL_CAPABILITIES = Object.freeze({
  maxClipSeconds: FAL_MAX_CLIP_SECONDS,
  stillSizes: FAL_SIZES,
  maxReferences: FAL_MAX_REFERENCES,
  supportsNativeAudioOff: true,
  supportsPlaceReference: true,
  /** Not part of `assertProvider`'s shape, and carried anyway: the pipeline has
   *  to turn "the customer paid for 720p" into a raster, and asking the
   *  provider what it offers beats a second copy of the table. */
  resolutions: FAL_RESOLUTIONS,
  minClipSeconds: FAL_MIN_CLIP_SECONDS,
});

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

const fail = (code, message, detail = null) => new TerminalError(message, { provider: FAL_ID, code, detail });

const pad2 = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------------
// Pure builders. Everything down to createFalProvider() returns strings and
// plain objects and touches nothing except, where noted, reading a file it was
// handed -- same boundary as tapedeck/, and for the same payoff: the request
// bodies are assertable with golden objects and no network at all.
// ---------------------------------------------------------------------------

/** `stills/still-01.png`, matching the manifest layout in docs/interfaces.md
 *  section 1. The provider names the file because the provider is what writes
 *  it, and `assemble` reads these names back. */
export function falStillName(index) {
  return `still-${pad2(index)}.png`;
}

/** `segments/seg-01.mp4` when the caller passed an index, and a stable hash of
 *  the idempotency key when it did not. VideoRequest carries no index in
 *  interfaces.md, but the manifest layout names the file, so something has to
 *  supply the number; the pipeline does. */
export function falClipName({ index, idempotencyKey }) {
  if (Number.isInteger(index)) return `seg-${pad2(index)}.mp4`;
  return `clip-${hash32(String(idempotencyKey))}.mp4`;
}

/** FNV-1a, 32-bit, hex. Local and tiny: this names a file and derives a
 *  request id, neither of which is a render input, so `compose/seed.mjs` --
 *  which is about reproducible PIXELS -- is not the right dependency. */
function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * OUR id for a request, derived from the idempotency key.
 *
 * THE CONFORMANCE TEST REQUIRES `meta.requestId` TO BE A FUNCTION OF THE
 * IDEMPOTENCY KEY -- "the same request twice lands on the same paths" asserts
 * exactly that -- and fal's `request_id` cannot be, because a second submit is
 * a second job on their side and gets a new one. The two facts are both worth
 * keeping and they are different facts, so they get different fields: this one
 * is stable across a retry and is what the manifest correlates on, and fal's
 * own id rides along in `meta.falRequestId`, which is what you paste into
 * their dashboard when a job needs explaining.
 */
export function falRequestId(idempotencyKey) {
  return `fal-${hash32(String(idempotencyKey))}`;
}

/** The `resolution` label for a raster, or a CapabilityError naming what is on
 *  offer. Exact match only: "nearest" would silently render 480p for a 720p
 *  order, which is a billing bug wearing a rendering bug's clothes. */
export function falResolutionFor(size) {
  const hit = Object.entries(FAL_RESOLUTIONS)
    .find(([, r]) => r.width === size?.width && r.height === size?.height);
  if (!hit) {
    throw new CapabilityError(
      `${FAL_ID}: no resolution renders ${size?.width}x${size?.height} at ${FAL_ASPECT_RATIO}. ` +
      `Offers: ${Object.entries(FAL_RESOLUTIONS).map(([id, r]) => `${id} (${r.width}x${r.height})`).join(', ')}`,
      { provider: FAL_ID, code: 'unsupported_size', detail: { requested: size ?? null, offered: FAL_RESOLUTIONS } },
    );
  }
  return hit[0];
}

/** Magic bytes first, extension second. The staged upload is deliberately
 *  extension-less (docs/interfaces.md section 4 -- a client filename is
 *  attacker-controlled text and no path is built from it), so trusting a
 *  suffix is trusting the one thing we decided not to trust. */
export function falMimeType(bytes, file = '') {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  throw fail(
    'unsupported_image',
    `${FAL_ID}: ${file} is not a PNG, JPEG or WebP -- fal accepts those three and nothing here re-encodes`,
    { path: file },
  );
}

/** fal's documented per-file ceiling. Checked locally because discovering it
 *  remotely costs a round trip and, on a submit, possibly a charge. */
export const FAL_MAX_UPLOAD_BYTES = 30_000_000;

/**
 * A local file as a `data:` URI.
 *
 * WHY NOT THE CDN UPLOAD. fal documents both, and a data URI keeps this
 * provider to ONE HTTP surface -- no second API to authenticate against, no
 * multipart client, no upload id to reconcile when a submit is retried. The
 * cost is a request roughly 4/3 the size of the file, which for a 1MP still is
 * about 1.5MB and is nothing next to a 15-second generation. fal's own
 * guidance calls data URIs slow for LARGE files, and if a still ever grows
 * past a few megabytes the CDN upload is the fix -- it is a change to this one
 * function and nothing else.
 */
export function falDataUri(file, { readImpl = fs.readFileSync } = {}) {
  let bytes;
  try {
    bytes = readImpl(file);
  } catch (err) {
    throw fail('missing_reference', `${FAL_ID}: cannot read ${file}: ${err.message}`, { path: file });
  }
  if (bytes.length > FAL_MAX_UPLOAD_BYTES) {
    throw new CapabilityError(
      `${FAL_ID}: ${file} is ${bytes.length} bytes and fal accepts at most ${FAL_MAX_UPLOAD_BYTES}`,
      { provider: FAL_ID, code: 'image_too_large', detail: { path: file, bytes: bytes.length } },
    );
  }
  return `data:${falMimeType(bytes, file)};base64,${bytes.toString('base64')}`;
}

/**
 * The still request body.
 *
 * UNVERIFIED SHAPE, and the header says so in as many words. This is the fal
 * image-edit convention that the candidates in config/models.json share --
 * `prompt`, `image_urls`, `aspect_ratio`, `num_images` -- and the moment one of
 * them is actually chosen, this function is what gets checked against its
 * schema page. `modelEntry` refuses an unverified model, so nothing here can
 * reach a paid call before that happens.
 *
 * ONE IMAGE PER CALL, and that is a decision. `num_images` would be one call
 * and cheaper IF the endpoint supports it AND returns a seed per image, and
 * neither is verified. N calls with N seeds is the version that is honest
 * against a schema nobody has read, and it is what makes `stills[].seed`
 * distinct -- which the contact sheet depends on, because three stills that
 * silently share a seed are three copies of one picture and a human clicking
 * "this one" for no reason.
 */
export function falStillBody({
  prompt, references, seed, size, dataUriImpl = falDataUri,
  // The field that carries the reference images, because IT IS NOT THE SAME ON
  // EVERY CANDIDATE. `image_urls` is the fal image-edit convention and it is
  // still the default, but fal-ai/uso rejected it 422 with
  // {"loc":["body","input_image_urls"],"msg":"Field required"} on
  // 2026-08-23 -- the endpoint's own schema, which is a better source than any
  // docs page. Per-model rather than renamed outright: the three Phase 0
  // candidates are three different vendors and there is no reason to think
  // they agree. The name lives in config/models.json next to the endpoint id.
  referencesParam = 'image_urls',
}) {
  const urls = references.map((ref) => dataUriImpl(ref.path));
  return {
    // @Image1 is the face and @Image2, when present, is the place. The prompt
    // itself never describes the person -- CLAUDE.md, "Prompt rules" -- so the
    // reference marker is the only thing that points at them.
    prompt,
    [referencesParam]: urls,
    aspect_ratio: FAL_ASPECT_RATIO,
    num_images: 1,
    seed,
    // PNG because `select` writes a contact sheet a human looks at and then
    // animates the chosen frame: one generation loss is enough, and the tape
    // stage adds all the degradation this product wants on purpose.
    output_format: 'png',
    // Belt to the aspect ratio's braces, and the reason `req.size` is asserted
    // rather than assumed: `aspect_ratio` alone leaves the raster to the model,
    // and a 1024x768 still where a 960x720 one was ordered is a rescale nobody
    // decided on. Whether the chosen model takes `image_size` as an object is
    // UNVERIFIED, like the rest of this body.
    ...(size ? { image_size: { width: size.width, height: size.height } } : {}),
  };
}

/**
 * The video request body. Verified against fal's schema.
 *
 * `generate_audio` is written from `req.nativeAudio` rather than from the
 * constant `false`, so layer 1 and the wire cannot drift: if the request ever
 * carried something other than `false`, `assertVideoRequest` has already
 * refused it and this line never runs.
 */
export function falVideoBody({ prompt, imagePath, seconds, seed, size, nativeAudio, dataUriImpl = falDataUri }) {
  return {
    prompt,
    image_url: dataUriImpl(imagePath),
    resolution: falResolutionFor(size),
    aspect_ratio: FAL_ASPECT_RATIO,
    // A STRING enum -- "15", not 15. fal's schema page spells the values out
    // as string literals and an integer here is a 422 that costs a round trip.
    duration: String(Math.round(seconds)),
    // LAYER 1 ON THE WIRE. The default is TRUE. Not sending it ships every
    // video with the model's own ambience underneath ours.
    generate_audio: nativeAudio === true,
    seed,
  };
}

/**
 * The reference-to-video request body: the path with no still in it.
 *
 * WHY THIS EXISTS AT ALL. `animate` has always started from an approved still,
 * which made the still stage structural rather than optional. Paul's product is
 * four choices and a tape -- upload a photo, pick an outfit, a place and a
 * frame shape -- and a picture the user has to look at and approve is not in
 * that list. `bytedance/seedance-2.0/reference-to-video` takes the photographs
 * THEMSELVES, up to nine of them, so the still stops existing rather than being
 * hidden behind a spinner.
 *
 * WHAT IT COSTS, STATED ONCE. The still was also the cheap rejection gate: a
 * likeness that missed cost $0.04 and the user saw it before paying. On this
 * path the same miss costs a finished video. That trade was put to Paul three
 * times and taken three times; it is a product decision, not an oversight.
 *
 * THE ORDER OF `references` IS A CONTRACT. The prompt names them @Image1 and
 * @Image2, so element 0 is the face and element 1, when present, is the place.
 * The prompt still never describes the person -- CLAUDE.md, "Prompt rules" --
 * which makes the reference marker the only thing pointing at them.
 */
export function falReferenceVideoBody({
  prompt, references, seconds, seed, size, nativeAudio,
  // Per model, for the reason falStillBody carries the same parameter: on
  // 2026-08-23 `fal-ai/uso` answered 422 because the field it wanted was
  // `input_image_urls`. Three vendors, no reason to assume they agree.
  referencesParam = 'image_urls',
  dataUriImpl = falDataUri,
}) {
  if (!Array.isArray(references) || references.length === 0) {
    // The face IS the product. An empty array is a paid call that cannot
    // return the right person, and it would read as a model failure rather
    // than the caller bug it is.
    throw new TypeError('a reference video request needs at least one reference image');
  }
  return {
    prompt,
    [referencesParam]: references.map((ref) => dataUriImpl(ref.path)),
    resolution: falResolutionFor(size),
    aspect_ratio: FAL_ASPECT_RATIO,
    // A STRING enum here exactly as on image-to-video.
    duration: String(Math.round(seconds)),
    // LAYER 1 ON THE WIRE. config/models.json records this endpoint as having
    // "the same parameter with the same TRUE default", so omitting it ships
    // the model's own ambience underneath a bed whose entire spec is "quiet".
    generate_audio: nativeAudio === true,
    seed,
  };
}

/** `https://queue.fal.run/<endpoint>`. Sub-paths are part of the model id and
 *  the queue appends `/requests/...` to the whole thing. */
export function falSubmitUrl(endpoint, { base = FAL_QUEUE_BASE } = {}) {
  return `${base}/${String(endpoint).replace(/^\/+/, '')}`;
}

/** The fallback status/result routes, used only when the submit response did
 *  not hand back usable ones. */
export function falStatusUrl(endpoint, requestId, { base = FAL_QUEUE_BASE } = {}) {
  return `${falSubmitUrl(endpoint, { base })}/requests/${encodeURIComponent(requestId)}/status`;
}
export function falResultUrl(endpoint, requestId, { base = FAL_QUEUE_BASE } = {}) {
  return `${falSubmitUrl(endpoint, { base })}/requests/${encodeURIComponent(requestId)}`;
}

/**
 * A URL from a response body, checked before it is followed.
 *
 * Returns the string when it is https on a host we deal with, and throws
 * otherwise. The failure mode this closes is small and real: a queue response
 * is data, and code that follows whatever a `response_url` field says is code
 * that will one day GET something on a host nobody chose.
 */
export function assertAllowedHost(url, { what = 'url' } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw fail('bad_url', `${FAL_ID}: ${what} is not a URL: ${JSON.stringify(url)}`, { url });
  }
  if (parsed.protocol !== 'https:') {
    throw fail('bad_url', `${FAL_ID}: ${what} is not https: ${parsed.href}`, { url: parsed.href });
  }
  const host = parsed.hostname.toLowerCase();
  const ok = ALLOWED_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (!ok) {
    throw fail(
      'bad_url',
      `${FAL_ID}: ${what} points at ${host}, which is not one of ${ALLOWED_HOSTS.join(', ')}. ` +
      'A url out of a response body is data, not an instruction.',
      { url: parsed.href, host },
    );
  }
  return parsed.href;
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function loadRenderCfg({ root = REPO_ROOT, readImpl = fs.readFileSync } = {}) {
  return JSON.parse(readImpl(path.join(root, 'config', 'render.json'), 'utf8'));
}

/**
 * `loadModels`/`modelEntry`/`defaultModels` live in `index.mjs`, which imports
 * THIS file to register the provider. A static import back would be a module
 * cycle; a dynamic one, resolved on first use and memoised, is evaluated long
 * after both modules are ready. The alternative -- a second copy of the
 * verified check and the layer-2 audio assertion, living here -- is exactly the
 * kind of duplicated money guard that drifts, and CLAUDE.md's rule about not
 * writing a second backoff ladder is the same rule.
 */
let registryPromise = null;
const registry = () => {
  registryPromise ??= import('./index.mjs');
  return registryPromise;
};

/** A cancel is a decision, not a fault: terminal, never retried, and checked
 *  between phases rather than only at the top -- otherwise a cancelled job
 *  still pays for the work already in flight. */
function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw fail('aborted', `${FAL_ID}: cancelled via ctx.signal`, { reason: String(signal.reason ?? 'aborted') });
  }
}

function requireOutDir(ctx) {
  const outDir = ctx?.outDir;
  if (typeof outDir !== 'string' || !path.isAbsolute(outDir)) {
    throw fail('invalid_ctx', `ctx.outDir must be an absolute path, got ${JSON.stringify(outDir)}`);
  }
  return outDir;
}

/** Bodies arrive as JSON, as text, or as nothing, depending on how far the
 *  response got. `classifyHttp` greps whatever comes out, so flatten without
 *  caring which. */
async function readBody(res) {
  try {
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  } catch {
    return null;
  }
}

/**
 * Build a fal provider.
 *
 * @param {object} [opts]
 * @param {object} [opts.cfg]           config/render.json; loaded if absent
 * @param {string} [opts.root]          repo root, for cfg
 * @param {() => object} [opts.envImpl] where FAL_KEY is read from, at CALL time
 * @param {object} [opts.models]        parsed config/models.json; loaded lazily
 * @param {object} [opts.pricing]       parsed config/pricing.json; loaded lazily
 * @param {string} [opts.stillModel]    overrides defaults.fal.still
 * @param {string} [opts.videoModel]    overrides defaults.fal.video
 * @param {string} [opts.base]          queue host, for a recorded-fixture test
 * @param {() => number} [opts.nowImpl] a monotonic clock, for latency + timeout
 */
export function createFalProvider(opts = {}) {
  const cfg = opts.cfg ?? loadRenderCfg({ root: opts.root ?? REPO_ROOT });
  // An ACCESSOR, never a value. Reading `process.env.FAL_KEY` here would make
  // `--dry-run` require a credential to answer "what would this cost".
  const envImpl = opts.envImpl ?? (() => process.env);
  const base = opts.base ?? FAL_QUEUE_BASE;
  // The one host the credential may ever be sent to -- see ALLOWED_HOSTS,
  // whose comment states this rule and whose enforcement lives in `call`.
  const queueHost = new URL(base).hostname.toLowerCase();
  const nowImpl = opts.nowImpl ?? (() => performance.now());
  const existsImpl = opts.existsImpl ?? fs.existsSync;
  const writeImpl = opts.writeImpl ?? fs.writeFileSync;
  const dataUriImpl = opts.dataUriImpl ?? falDataUri;

  const poll = {
    intervalMs: cfg?.provider?.pollIntervalMs ?? 5000,
    timeoutMs: cfg?.provider?.pollTimeoutMs ?? 900_000,
  };
  const retry = {
    maxAttempts: cfg?.provider?.maxAttempts ?? 4,
    baseMs: cfg?.provider?.backoffBaseMs ?? 1000,
  };

  /** Loaded once, lazily, and NOT in the factory: `loadModels` reads a file,
   *  which is cheap, but `modelEntry` throws on an unverified model, and a
   *  factory that threw would break `--dry-run` for the one provider whose
   *  price anybody wants to know before spending. */
  let modelsCache = opts.models ?? null;
  async function models() {
    if (!modelsCache) modelsCache = (await registry()).loadModels();
    return modelsCache;
  }
  let pricingCache = opts.pricing ?? null;
  function pricing() {
    pricingCache ??= loadPricing();
    return pricingCache;
  }

  /**
   * The model id and its endpoint, held to `verified: true` and -- for a video
   * model -- to the layer-2 audio rule, at CALL time.
   *
   * Every fal still model in config/models.json today is a candidate nobody
   * has opened the schema page for, so this is where `generateStill` stops. It
   * is the right place to stop: before a request exists, with a message naming
   * the file to edit.
   */
  async function resolveModel(kind) {
    const table = await models();
    const { modelEntry, defaultModels } = await registry();
    const override = kind === 'still' ? opts.stillModel : opts.videoModel;
    const id = override ?? defaultModels(table, FAL_ID)[kind];
    // `allowUnverifiedModel` lowers the verified gate for a NAMED override and
    // nothing else -- Phase 0's bake-off needs to call candidates whose schema
    // pages nobody has read yet, and the alternative was editing
    // config/models.json to claim `verified: true`, which in this repo means
    // "somebody read the schema". Faking that to run an experiment would poison
    // the one signal that stops blind spending. Defaults to false, so every
    // path that does not deliberately opt in still gets the refusal.
    const entry = modelEntry(table, id, { requireVerified: !opts.allowUnverifiedModel });
    const endpoint = entry.endpoint;
    if (!isNonEmptyString(endpoint)) {
      throw new CapabilityError(
        `${FAL_ID}: model ${id} has no endpoint recorded in config/models.json`,
        { provider: FAL_ID, code: 'no_endpoint', detail: { id } },
      );
    }
    return { id, entry, endpoint };
  }

  function credential() {
    const key = envImpl()?.FAL_KEY;
    if (!isNonEmptyString(key)) {
      // Raised AFTER every free check and BEFORE any request -- the order is
      // under test. Not retriable: another attempt is another line in
      // somebody's abuse log and the key will still not be there.
      throw new CredentialError(
        `${FAL_ID}: FAL_KEY is not set. Put it in .env -- \`npm run render\` and \`npm run worker\` load it ` +
        'with --env-file-if-exists, and `npm test` deliberately does not.',
        { provider: FAL_ID, code: 'credential', detail: { env: 'FAL_KEY' } },
      );
    }
    return key;
  }

  /** Monotonic by construction: the status page renders a bar, and a bar that
   *  goes backwards reads as a failure that has not been reported yet. */
  function progressReporter(ctx) {
    let last = -1;
    return (phase, pct, message) => {
      const clamped = pct === undefined ? undefined : Math.max(last, Math.min(100, Math.round(pct)));
      if (clamped !== undefined) last = clamped;
      ctx?.onProgress?.({ phase, ...(clamped === undefined ? {} : { pct: clamped }), ...(message ? { message } : {}) });
    };
  }

  /**
   * One HTTP round trip, with the shared 1/2/4/8 ladder around it.
   *
   * `withRetry` and `classifyHttp` come from errors.mjs on purpose: a second
   * backoff ladder written here would eventually retry a CredentialError four
   * times and call it resilience, and a second classifier would invent a new
   * rule every time fal changed its wording.
   */
  function makeCall(ctx, { fetchImpl, key, sleepImpl, onRetry }) {
    return async function call(url, { method = 'GET', body = null, idempotencyKey = null, authorize = true, expect = 'json' } = {}) {
      const checked = assertAllowedHost(url, { what: `${method} target` });
      // The credential goes to the queue host and nowhere else -- ENFORCED,
      // not merely stated. The allow-list above admits hosts we download from,
      // and one of them is multi-tenant storage anyone can own a bucket under;
      // an authorized call steered at any of them by a url out of a response
      // body is refused outright, before a socket opens. Terminal, because the
      // same poisoned url would fail the same way on every retry.
      if (authorize && new URL(checked).hostname.toLowerCase() !== queueHost) {
        throw fail('credential_scope',
          `${FAL_ID}: refusing to authorize a ${method} to ${new URL(checked).hostname} -- the credential goes to ${queueHost} and nowhere else`,
          { url: checked, queueHost });
      }
      return withRetry(async () => {
        throwIfAborted(ctx?.signal);
        const headers = { Accept: expect === 'json' ? 'application/json' : '*/*' };
        if (authorize) headers.Authorization = `Key ${key}`;
        if (body !== null) headers['Content-Type'] = 'application/json';
        // fal does not document an idempotency header. Sending one costs
        // nothing and is the honest attempt; the guarantee that actually holds
        // is the intent record `render/job.mjs` writes BEFORE this call.
        if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

        let res;
        try {
          res = await fetchImpl(checked, {
            method,
            headers,
            ...(body === null ? {} : { body: JSON.stringify(body) }),
            ...(ctx?.signal ? { signal: ctx.signal } : {}),
          });
        } catch (err) {
          // A transport failure arrives as a bare TypeError with the real
          // cause buried, and `isRetriable` deliberately does not sniff for
          // that -- providers wrap their own. An aborted fetch is a decision
          // and must not be retried.
          throwIfAborted(ctx?.signal);
          throw new RetriableError(`${FAL_ID}: ${method} failed before a response: ${err?.message ?? err}`, {
            provider: FAL_ID, code: 'transport', detail: { url: checked }, cause: err,
          });
        }

        if (!res?.ok) {
          throw classifyHttp(res?.status ?? 0, await readBody(res), { provider: FAL_ID });
        }
        if (expect === 'json') {
          const parsed = await readBody(res);
          if (!isPlainObject(parsed)) {
            throw fail('bad_response', `${FAL_ID}: ${method} ${checked} returned no JSON object`, { body: parsed });
          }
          return parsed;
        }
        return Buffer.from(await res.arrayBuffer());
      }, { maxAttempts: retry.maxAttempts, baseMs: retry.baseMs, sleepImpl, onRetry });
    };
  }

  /**
   * Submit, poll to COMPLETED, fetch the result.
   *
   * The status and result routes come from the submit response when it hands
   * usable ones back, because they are the vendor's own answer to "where is
   * this", and constructing them from the model id is the part most likely to
   * be wrong for an endpoint with a sub-path. `falStatusUrl`/`falResultUrl`
   * are the fallback, and they are a documented guess.
   */
  async function runQueued({ ctx, call, endpoint, body, idempotencyKey, report, span }) {
    report('submit', span.start, `${endpoint}`);
    const accepted = await call(falSubmitUrl(endpoint, { base }), {
      method: 'POST', body, idempotencyKey,
    });

    const requestId = accepted.request_id ?? accepted.requestId ?? null;
    if (!isNonEmptyString(requestId)) {
      throw fail('bad_response', `${FAL_ID}: the queue accepted the request without a request_id`, { accepted });
    }
    const statusUrl = pickUrl(accepted.status_url, () => falStatusUrl(endpoint, requestId, { base }), 'status_url');
    const resultUrl = pickUrl(accepted.response_url, () => falResultUrl(endpoint, requestId, { base }), 'response_url');

    const startedAt = nowImpl();
    let polls = 0;
    for (;;) {
      throwIfAborted(ctx?.signal);
      const status = await call(statusUrl);
      const state = String(status.status ?? '').toUpperCase();

      if (state === 'COMPLETED') break;

      // `error`/`error_type` are documented as present only on failure, and a
      // failed generation is terminal: the same request will fail the same way
      // and each attempt is billable on some plans.
      if (status.error || state === 'FAILED' || state === 'ERROR') {
        throw classifyHttp(422, status, { provider: FAL_ID });
      }

      const elapsed = nowImpl() - startedAt;
      if (elapsed > poll.timeoutMs) {
        // Retriable, and note what that means here: a timeout on a POLL is
        // safe to retry, but the WORK may still be running on fal's side, so
        // the intent record is what stops a resume from paying twice.
        throw new TimeoutError(
          `${FAL_ID}: ${requestId} was still ${state || 'unknown'} after ${Math.round(elapsed / 1000)}s ` +
          `(cfg.provider.pollTimeoutMs is ${poll.timeoutMs})`,
          { provider: FAL_ID, code: 'poll_timeout', detail: { requestId, state, elapsed } },
        );
      }

      polls += 1;
      const phase = state === 'IN_QUEUE' ? 'queued' : 'running';
      const message = state === 'IN_QUEUE' && Number.isFinite(status.queue_position)
        ? `queue position ${status.queue_position}`
        : undefined;
      // Creeps rather than claims: nothing in the status response is a
      // percentage, and inventing one that jumps to 90 and sits there is worse
      // than a bar that moves slowly.
      report(phase, Math.min(span.working, span.queued + polls * 2), message);

      await (ctx?.sleepImpl ?? defaultSleep)(poll.intervalMs);
    }

    const result = await call(resultUrl);
    return { requestId, result };
  }

  /** A vendor-supplied URL if it survives the host check, else our own. The
   *  fallback is deliberate: a malformed `status_url` should not fail a job
   *  that is already running and already paid for. */
  function pickUrl(candidate, fallback, what) {
    if (!isNonEmptyString(candidate)) return fallback();
    try {
      return assertAllowedHost(candidate, { what });
    } catch {
      return fallback();
    }
  }

  async function download({ call, url, dest, what }) {
    const checked = assertAllowedHost(url, { what });
    // Unauthenticated on purpose: the CDN does not want our key and should
    // never see it.
    const bytes = await call(checked, { authorize: false, expect: 'bytes' });
    if (!bytes?.length) {
      throw fail('empty_download', `${FAL_ID}: ${what} downloaded zero bytes from ${checked}`, { url: checked });
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    writeImpl(dest, bytes);
    return dest;
  }

  const provider = {
    id: FAL_ID,
    /** True, and it is what tells `assertProvider` and the conformance test to
     *  hold this file to the no-default-fetchImpl rule. */
    paid: true,
    capabilities: FAL_CAPABILITIES,

    async generateStill(req, ctx = {}) {
      const startedAt = nowImpl();
      // GUARD 1, FIRST LINE, BEFORE ANYTHING THAT COULD THROW SOMETHING ELSE
      // AND HIDE IT. A test that forgot to inject a transport gets a TypeError
      // here rather than a bill.
      const fetchImpl = requireFetchImpl(ctx, { provider: FAL_ID });

      assertStillRequest(req);
      assertCapableStill(provider, req);
      const outDir = requireOutDir(ctx);
      throwIfAborted(ctx.signal);

      // Checked here, before the credential and long before a request: a
      // missing reference discovered remotely is discovered after the submit
      // was accepted and possibly billed.
      for (const ref of req.references) {
        if (!existsImpl(ref.path)) {
          throw fail('missing_reference', `${FAL_ID}: reference image not found: ${ref.path}`, { role: ref.role, path: ref.path });
        }
      }

      const { id: model, endpoint, entry: stillEntry } = await resolveModel('still');
      const key = credential();

      const report = progressReporter(ctx);
      const sleepImpl = ctx.sleepImpl ?? defaultSleep;
      const call = makeCall(ctx, {
        fetchImpl,
        key,
        sleepImpl,
        onRetry: ({ attempt, waitMs, error }) => report('running', undefined, `attempt ${attempt} failed (${error.code}); retrying in ${waitMs}ms`),
      });

      fs.mkdirSync(outDir, { recursive: true });
      report('submit', 0, `${req.count} still(s) from ${model}`);

      const stills = [];
      const requestIds = [];
      for (let i = 0; i < req.count; i += 1) {
        throwIfAborted(ctx.signal);
        const index = i + FIRST_INDEX;
        // Sequential from the request's seed, exactly as the fixture fans out,
        // so a manifest reader can see at a glance that still 3 of seed 1000
        // is 1002 -- and so the pipeline is not taught a habit fal will not
        // honour.
        // Wrapped, exactly as the fixture wraps: a request seeded near the
        // top of the range would otherwise fan out past SEED_MAX and
        // assertStillResult would reject a result we had already paid for.
        const seed = (req.seed + i) % (SEED_MAX + 1);
        // Each image gets its own slice of the bar, so three stills do not
        // look like one still that stalled.
        const width = 80 / req.count;
        const span = { start: 5 + i * width, queued: 5 + i * width, working: 5 + (i + 0.8) * width };

        const body = falStillBody({
          prompt: req.prompt,
          references: req.references,
          seed,
          size: req.size,
          dataUriImpl,
          referencesParam: stillEntry?.stillParams?.references ?? 'image_urls',
        });

        const { requestId, result } = await runQueued({
          ctx, call, endpoint, body, idempotencyKey: `${req.idempotencyKey}:${index}`, report, span,
        });
        requestIds.push(requestId);

        const image = firstImage(result);
        report('download', 5 + (i + 0.9) * width);
        const dest = path.join(outDir, falStillName(index));
        await download({ call, url: image.url, dest, what: `still ${index}` });

        stills.push({ path: dest, index, seed });
      }

      report('done', 100);

      return {
        stills,
        // `actual: null` means NOT METERED YET and never zero: the queue
        // response carries no price, and phase-0 criterion 6 measures the real
        // number as balance-before minus balance-after. A metered zero and an
        // unmetered call are different facts and the ledger's divergence
        // column goes quietly optimistic if they are collapsed.
        cost: cost(estimateStill({ pricing: pricing(), model, count: req.count }), null),
        meta: {
          model,
          // OURS, derived from the idempotency key -- see `falRequestId`.
          requestId: falRequestId(req.idempotencyKey),
          latencyMs: Math.round(nowImpl() - startedAt),
          // fal's own ids, which is what you paste into their dashboard.
          falRequestIds: requestIds,
        },
      };
    },

    async generateVideo(req, ctx = {}) {
      const startedAt = nowImpl();
      const fetchImpl = requireFetchImpl(ctx, { provider: FAL_ID });

      assertVideoRequest(req);
      assertCapableVideo(provider, req);
      // NO LOCAL FLOOR, AND IT IS A DECISION RATHER THAN AN OVERSIGHT.
      // `capabilities.minClipSeconds` records fal's real 4-second floor, and
      // `duration` is an enum whose smallest value is "4", so a 2-second
      // request is a 422. It is not refused HERE because the shared
      // conformance body -- which is the whole reason this provider and the
      // fixture can be believed to present one interface -- builds every
      // video case as `Math.min(2, maxClipSeconds)`, and a local refusal would
      // mean fal could never be held to that suite at all. Nothing in the
      // pipeline can produce a sub-4s request: `planSegments` against
      // `maxClipSeconds: 15` returns exactly one 15-second segment.
      // The raster the customer paid for. Absent, it is the cheap tier -- the
      // same default config/credits.json records -- and never "whatever the
      // vendor felt like", which is the bug this field exists to close.
      const size = req.size ?? FAL_SIZES[0];
      falResolutionFor(size);

      const outDir = requireOutDir(ctx);
      throwIfAborted(ctx.signal);

      // TWO SHAPES, and the request already said which. `assertVideoRequest`
      // has refused anything carrying both, so this is a branch and not a
      // precedence rule.
      const direct = req.references !== undefined;

      for (const missing of direct
        ? req.references.filter((r) => !existsImpl(r.path)).map((r) => r.path)
        : (existsImpl(req.imagePath) ? [] : [req.imagePath])) {
        throw fail('missing_image', `${FAL_ID}: ${direct ? 'reference' : 'start'} image not found: ${missing}`, { path: missing });
      }

      const { id: model, endpoint, entry: videoEntry } = await resolveModel('video');
      const key = credential();

      const report = progressReporter(ctx);
      const sleepImpl = ctx.sleepImpl ?? defaultSleep;
      const call = makeCall(ctx, {
        fetchImpl,
        key,
        sleepImpl,
        onRetry: ({ attempt, waitMs, error }) => report('running', undefined, `attempt ${attempt} failed (${error.code}); retrying in ${waitMs}ms`),
      });

      fs.mkdirSync(outDir, { recursive: true });

      const body = direct
        ? falReferenceVideoBody({
          prompt: req.prompt,
          references: req.references,
          seconds: req.seconds,
          seed: req.seed,
          size,
          nativeAudio: req.nativeAudio,
          // Per model, for the reason the still path carries the same lookup:
          // `fal-ai/uso` answered 422 in 2026-08-23 because its field was
          // called `input_image_urls`. Absent means the fal convention.
          referencesParam: videoEntry?.videoParams?.references ?? 'image_urls',
          dataUriImpl,
        })
        : falVideoBody({
          prompt: req.prompt,
          imagePath: req.imagePath,
          seconds: req.seconds,
          seed: req.seed,
          size,
          nativeAudio: req.nativeAudio,
          dataUriImpl,
        });

      const { requestId, result } = await runQueued({
        ctx,
        call,
        endpoint,
        body,
        idempotencyKey: req.idempotencyKey,
        report,
        span: { start: 0, queued: 15, working: 85 },
      });

      const url = result?.video?.url;
      if (!isNonEmptyString(url)) {
        throw fail('bad_response', `${FAL_ID}: the result carried no video.url`, { result });
      }
      report('download', 90);
      const dest = path.join(outDir, falClipName(req));
      await download({ call, url, dest, what: `segment ${req.index ?? FIRST_INDEX}` });

      report('done', 100);

      return {
        // The seconds we ASKED for and were billed for. Not a probe of the
        // file: a network provider spawning ffprobe to describe its own
        // download is a second opinion nobody asked for, and a real mismatch
        // is caught downstream where it matters -- `verify` asserts 375 frames
        // against the finished tape, exactly.
        clip: { path: dest, seconds: req.seconds },
        cost: cost(estimateVideo({ pricing: pricing(), model, seconds: req.seconds }), null),
        meta: {
          model,
          requestId: falRequestId(req.idempotencyKey),
          latencyMs: Math.round(nowImpl() - startedAt),
          falRequestId: requestId,
          // What the model says it used. There is no guarantee it is the seed
          // we sent -- see the openQuestions in config/models.json -- so it is
          // recorded rather than assumed.
          providerSeed: Number.isFinite(result?.seed) ? result.seed : null,
          resolution: falResolutionFor(size),
        },
      };
    },
  };

  return provider;
}

/**
 * The first image out of a result body, whatever the endpoint called the field.
 *
 * UNVERIFIED, like the rest of the still path: `images: [{url}]` is the fal
 * image convention and `image: {url}` is the other one seen in the wild.
 * Accepting both is not indecision -- it is the difference between a still
 * model swap being a config edit and being a code change, and neither shape
 * has been confirmed for the model Paul has not chosen yet.
 */
function firstImage(result) {
  const candidate = Array.isArray(result?.images) ? result.images[0] : result?.image;
  const url = candidate?.url ?? (typeof candidate === 'string' ? candidate : null);
  if (!isNonEmptyString(url)) {
    throw fail('bad_response', `${FAL_ID}: the result carried no image url`, { result });
  }
  return { url, width: candidate?.width ?? null, height: candidate?.height ?? null };
}
