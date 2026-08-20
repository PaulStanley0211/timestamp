/**
 * The one import point for the provider layer.
 *
 * Everything downstream -- pipeline, worker, CLI -- asks for a provider by id
 * and gets an object that has already passed `assertProvider`. Nothing
 * downstream imports `fixture.mjs` directly, and when `fal.mjs` lands nothing
 * downstream will import that either. That is not tidiness: it is the reason
 * `--provider=fal` can be a string in an argv rather than a branch in the
 * pipeline.
 *
 * WHY THE REGISTRY REFUSES RATHER THAN GUESSES. An unknown id throws a terminal
 * error naming what exists. The tempting alternative -- fall back to the
 * fixture when the requested provider is missing -- would mean a production run
 * silently rendering coloured rectangles instead of a person, and the failure
 * would surface as "the video looks wrong" rather than as an error. A missing
 * provider is a configuration mistake and it should read like one.
 *
 * `fal` IS REGISTERED AND STILL CANNOT SPEND BY ACCIDENT. Building it takes no
 * credential -- `--dry-run` has to work on a laptop with no key -- and the
 * credential is read inside `generateStill`/`generateVideo`, after every free
 * check. `modelEntry` below is the other half: every fal STILL model in
 * config/models.json is a candidate marked `verified: false`, so the still step
 * refuses by name until somebody opens a schema page and edits the file.
 *
 * WHY MODEL LOADING LIVES HERE AND THE ASSERTIONS LIVE IN contract.mjs. This
 * file reads a JSON file off disk; contract.mjs is pure and stays that way.
 * `loadModels` validates through `assertAudioOff` on the way out, so a video
 * model with no recorded audio-off parameter cannot be handed to a caller at
 * all -- see the three-layer rule in contract.mjs's header.
 */

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../ffmpeg/run.mjs';
import { TerminalError } from './errors.mjs';
import { assertProvider, assertAudioOff } from './contract.mjs';
import { createFixtureProvider, FIXTURE_ID } from './fixture.mjs';
import { createFalProvider, FAL_ID } from './fal.mjs';

export const MODELS_FILE = 'config/models.json';

/** Every provider that can be named on a command line today. `fal` joining
 *  this array WAS the whole change -- test/provider-contract.test.js gained one
 *  entry in its case table and its body stayed byte-identical, which is the
 *  only honest evidence that this seam is an abstraction and not a wrapper
 *  with optimism. */
export const PROVIDER_IDS = Object.freeze([FIXTURE_ID, FAL_ID]);

const FACTORIES = Object.freeze({
  [FIXTURE_ID]: createFixtureProvider,
  [FAL_ID]: createFalProvider,
});

const bad = (code, message, detail = null) => new TerminalError(message, { code, detail, provider: 'registry' });

/**
 * Build a provider by id, shape-checked before it is handed out.
 *
 * @param {string} id
 * @param {object} [opts]  passed through to the factory
 */
export function createProvider(id, opts = {}) {
  const factory = FACTORIES[id];
  if (!factory) {
    throw bad(
      'unknown_provider',
      `no provider named ${JSON.stringify(id)}. Known: ${PROVIDER_IDS.join(', ')}.`,
      { id, known: PROVIDER_IDS },
    );
  }
  const provider = factory(opts);
  // Asserted here rather than trusting the factory, because this is the last
  // point at which a malformed provider is cheap to reject: after this it is
  // inside the pipeline holding a job.
  assertProvider(provider);
  return provider;
}

/**
 * Load `config/models.json` and validate the layer-2 audio rule on the way
 * through.
 *
 * `readImpl` has a real default -- reading a JSON file is not spending, and
 * the no-default rule in CLAUDE.md is specifically about `fetchImpl` on a paid
 * provider.
 */
export function loadModels({ root = REPO_ROOT, file = MODELS_FILE, readImpl = fs.readFileSync } = {}) {
  const full = path.isAbsolute(file) ? file : path.join(root, file);
  let parsed;
  try {
    parsed = JSON.parse(readImpl(full, 'utf8'));
  } catch (err) {
    throw bad('invalid_models', `${full} is not valid JSON: ${err.message}`, { file: full });
  }
  if (typeof parsed?.models !== 'object' || parsed.models === null) {
    throw bad('invalid_models', `${full} must have a "models" object`, { file: full });
  }
  return parsed;
}

/**
 * One model entry, or a terminal error naming what is on the menu.
 *
 * `requireVerified` defaults to true and that is deliberate: every `fal/` entry
 * in config/models.json today is an UNVERIFIED placeholder written from memory,
 * and the one thing that must not happen is a paid run against an endpoint id
 * somebody guessed. Pass `false` only to inspect the table.
 */
export function modelEntry(models, id, { requireVerified = true } = {}) {
  const entry = models?.models?.[id];
  if (!entry) {
    throw bad('unknown_model', `no model ${JSON.stringify(id)} in ${MODELS_FILE}. Known: ${Object.keys(models?.models ?? {}).join(', ') || '(none)'}`, { id });
  }
  if (requireVerified && entry.verified !== true) {
    throw bad(
      'unverified_model',
      `model ${id} is marked UNVERIFIED in ${MODELS_FILE}. Nobody has opened its schema page and confirmed the endpoint id, the parameter names, or the clip length. Verify it, edit the entry, then use it.`,
      { id },
    );
  }
  // Layer 2 of the three-layer native-audio rule, applied at the moment a
  // model is handed out rather than at the moment it is used -- so a video
  // model with no recorded audio-off parameter cannot reach a request at all.
  assertAudioOff(entry, { model: id });
  return entry;
}

/** The still/video model pair a provider uses by default. */
export function defaultModels(models, providerId) {
  const d = models?.defaults?.[providerId];
  if (!d) {
    throw bad('unknown_provider', `no default models recorded for ${JSON.stringify(providerId)} in ${MODELS_FILE}`, { providerId });
  }
  return d;
}

export {
  ProviderError,
  CredentialError,
  TerminalError,
  RetriableError,
  TimeoutError,
  CapabilityError,
  ModerationRefusedError,
  classifyHttp,
  isRetriable,
  backoffMs,
  withRetry,
} from './errors.mjs';

export {
  FIRST_INDEX,
  MAX_STILL_COUNT,
  PROGRESS_PHASES,
  CURRENCY,
  assertStillRequest,
  assertVideoRequest,
  assertStillResult,
  assertVideoResult,
  assertProvider,
  assertProgressEvent,
  assertCapableStill,
  assertCapableVideo,
  assertAudioOff,
  requireFetchImpl,
} from './contract.mjs';

export {
  DIVERGENCE_LIMIT,
  loadPricing,
  assertPricingTable,
  estimateStill,
  estimateVideo,
  estimateJob,
  cost,
  divergence,
  diverges,
} from './pricing.mjs';

export { createFixtureProvider, FIXTURE_ID } from './fixture.mjs';

export {
  createFalProvider,
  FAL_ID,
  FAL_CAPABILITIES,
  FAL_RESOLUTIONS,
  FAL_ENDPOINTS,
  FAL_QUEUE_BASE,
  falRequestId,
  falResolutionFor,
} from './fal.mjs';
