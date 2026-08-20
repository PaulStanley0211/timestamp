/**
 * The pipeline. Eleven steps from an uploaded photograph to `timestamp.mp4`.
 *
 * RESUME IS THE POINT, AND IT IS NOT A FEATURE BOLTED ON AT THE END. This
 * function executes `STEPS` in order and skips any already `done`; that is the
 * whole of resume, and everything else in this file exists to make that
 * sentence safe. Two of these steps spend money on a remote service that takes
 * minutes, on a machine somebody will close the lid of, so the process dying
 * mid-render is an ordinary event rather than an exception. After it dies, the
 * manifest on disk must be enough to carry on with ZERO re-submissions of
 * anything already paid for -- which means `saveJob` after every transition, an
 * intent record written before every paid call, and a segment loop that records
 * each clip as it lands rather than all of them at the end.
 *
 * WHAT HAPPENS WHEN WE MIGHT HAVE PAID AND CANNOT TELL. `recordIntent` reports
 * `existing: true` when a request was recorded and no result ever came back.
 * That is the "we may have submitted and crashed" case and it is the one case
 * this file refuses to guess about: resubmitting risks paying twice, skipping
 * risks a job that claims a still it never received. So the step fails with
 * `INTENT_IN_FLIGHT`, names the intent file and its timestamp, and prints the
 * exact command that resubmits deliberately. A human decides, because only a
 * human can go and look at the provider's dashboard.
 *
 * WHAT `wasRunning` IS FOR. A step left `running` is a crashed step; a step
 * `pending` is either fresh or one somebody deliberately retried. The two need
 * opposite behaviour -- the first should adopt whatever landed before the
 * crash, the second must not adopt anything or `retryStep` would be a no-op --
 * and the step's own status is the only honest way to tell them apart. It is
 * read BEFORE `beginStep`, because `beginStep` erases the distinction.
 *
 * THE THREE-LAYER AUDIO RULE, LAYER 3. Layers 1 and 2 live in the provider
 * package: `nativeAudio: false` is a required request field and
 * `supportsNativeAudioOff` is a provider-shape assertion. Neither of them has
 * ever seen the file that came back. `assemble` ffprobes every returned clip
 * and refuses one with an audio stream, which is the layer that catches a model
 * version bump quietly re-enabling its own audio -- the symptom of which is a
 * week of shipped videos with two ambiences arguing.
 *
 * WHY STEP 9 CALLS THE SAME FIVE FUNCTIONS `look-cli.mjs` DOES. `burnInFilters`
 * -> `buildVideoFilter` -> `buildAudioFilter` -> `joinGraphs` -> `muxedArgs` is
 * the look, and there is exactly one path to it. A second path that assembled
 * the same filters in its own order would drift from the tuned one silently,
 * and the tuning is the product. Video and audio also join in ONE ffmpeg
 * invocation, because two passes is a re-encode of a look whose entire subject
 * is generation loss.
 *
 * THE RESOLUTION IS FROZEN AT compose AND NOWHERE ELSE. `job.input.resolution`
 * is what the customer was charged for; `resolved.resolution` is the 4:3 raster
 * that answer means, and `still` and `animate` both read it from there. Before
 * this, both read `provider.capabilities.stillSizes[0]` and a job paid for at
 * 720p rendered at whatever the provider listed first -- with the button, the
 * ledger and the manifest all agreeing on a number that was not what arrived.
 * See `resolveRaster`.
 *
 * NOTHING HERE READS THE WALL CLOCK. Timestamps come from `job.nowImpl` through
 * `job.mjs`; seeds come from `deriveSeed(jobId, kind, index)`; the tape's date
 * comes from `deriveStamp(seed)`. Two runs of the same job id produce the same
 * bytes, which is the only version of "reproducible" worth the word.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  STEPS,
  beginStep, finishStep, failStep, skipStep, stepStatus, nextStep, isResumable,
  saveJob, jobPaths, toJobRelative, fromJobRelative, freezeResolved,
  setJobStatus, setSelection, completeJob, cancelJob,
  recordIntent, readIntent, completeIntent,
} from './job.mjs';

import { runFfmpeg, probe, REPO_ROOT } from '../ffmpeg/run.mjs';
import {
  assertDeliveryContract, assertComposite, assertTapeGrade, assertBurnIn,
} from '../ffmpeg/assert.mjs';
import { tapeGeometry, deliveryGeometry, frameCount } from '../tapedeck/frame.mjs';
import { loadLookProfile, buildVideoFilter } from '../tapedeck/look.mjs';
import { burnInFilters, burnInProbeRegion, deriveStamp } from '../tapedeck/burn-in.mjs';
import { buildAudioFilter, clampAudio } from '../audio/bed.mjs';
import {
  muxedArgs, joinGraphs, fileLoudnessArgs, parseIntegratedLufs, lufsVerdict,
} from '../audio/mix.mjs';
import { composeStillPrompt, composeMotionPrompt, DEFAULT_ERA } from '../compose/prompt.mjs';
import { deriveSeed } from '../compose/seed.mjs';
import { loadCatalog, getPlace, getOutfit, checkCompatibility } from '../catalog/catalog.mjs';
import { resolveFont } from '../preflight/doctor.mjs';
import {
  planSegments, describePlan, resolutionRaster, DEFAULT_RESOLUTION,
} from '../animate/plan.mjs';
import { lastFrameArgs, lastFrameName } from '../animate/lastframe.mjs';
import { firstScorer, chooseStill } from '../select/select.mjs';
import { writeContactSheet } from '../select/contact-sheet.mjs';
import { loadPricing, estimateJob } from '../providers/pricing.mjs';
import { loadModels, defaultModels, modelEntry } from '../providers/index.mjs';
import { withRetry } from '../providers/errors.mjs';
import { assertProvider, assertStillResult, assertVideoResult } from '../providers/contract.mjs';

// ---------------------------------------------------------------------------
// errors, constants, small helpers
// ---------------------------------------------------------------------------

export class PipelineError extends Error {
  constructor(message, { code = 'PIPELINE_ERROR', step = null, userMessage = null, retriable = false, detail = null } = {}) {
    super(message);
    this.name = 'PipelineError';
    this.code = code;
    this.step = step;
    /** Safe to show a stranger. The technical message is for the log. */
    this.userMessage = userMessage;
    this.retriable = retriable;
    this.detail = detail;
  }
}

/** The poster is frame 60 -- 2.4 seconds in at 25fps. Not frame 0: the first
 *  frame of a generated clip is the still itself, so a poster taken there shows
 *  the image the video was made FROM rather than the video. */
export const POSTER_FRAME = 60;

/** `config/` and `presets/` are repo files, not job files. They are read once,
 *  at compose, and frozen into the manifest; nothing downstream reads them
 *  again. See job.mjs, "WHY THE `resolved` BLOCK IS FROZEN". */
const CONFIG_RENDER = 'config/render.json';
const CONFIG_BASE_LOOK = 'config/look/base.json';

const slash = (p) => String(p).replace(/\\/g, '/');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const noop = () => {};

/** Deterministic key material, so two payloads that differ only in key order
 *  compare equal. Same reasoning as job.mjs' private copy; six lines is cheaper
 *  than widening that module's export surface. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

const shortHash = (value, bytes = 8) =>
  crypto.createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, bytes * 2);

const stepOutput = (job, name) => job.steps.find((s) => s.name === name)?.output ?? {};

/**
 * The raster every provider request in this job will use.
 *
 * THE BUG THIS FUNCTION IS. `job.input.resolution` reaches the manifest -- the
 * web form collects it, `creditCost` charges for it, `normalizeInput` stores
 * it -- and until now NOTHING READ IT AGAIN. A customer paid 152 credits for
 * 720p and the pipeline asked the provider for `stillSizes[0]`, whatever that
 * happened to be. The button, the ledger and the manifest all agreed on a
 * number, the video was a different thing, and there was no error anywhere.
 * That is a billing bug wearing a rendering bug's clothes, and it is invisible
 * from both ends -- which is why the fix is an assertion (test/provider-fal.
 * test.js: a job created at 720p produces a provider request for 960x720) and
 * the code is just how the number gets there.
 *
 * WHAT A PROVIDER THAT DOES NOT OFFER THE RASTER GETS. A PAID one gets
 * refused, loudly, before it spends: billing for 720p and rendering 1024x768
 * is precisely the failure above with an extra step. A FREE one substitutes
 * its own size and says so in the log -- the fixture offers exactly 1024x768,
 * every pipeline test in this repo runs through it, and there is no invoice
 * behind a local ffmpeg call to be wrong about.
 */
function resolveRaster({ resolution, provider, log = noop }) {
  const id = resolution ?? null;
  // A CLI render has no order behind it and no account to charge, so it takes
  // the provider's first offer -- the same shape this file had before there
  // was a resolution to honour.
  if (id === null) {
    const size = provider.capabilities.stillSizes[0];
    return { id: null, size: { width: size.width, height: size.height }, honoured: true };
  }

  const raster = resolutionRaster(id);
  const offered = provider.capabilities.stillSizes
    .some((s) => s.width === raster.width && s.height === raster.height);
  if (offered) {
    return { id, size: { width: raster.width, height: raster.height }, honoured: true };
  }

  const offers = provider.capabilities.stillSizes.map((s) => `${s.width}x${s.height}`).join(', ');
  if (provider.paid) {
    throw new PipelineError(
      `this job was ordered at ${id} (${raster.width}x${raster.height}, 4:3) and ${provider.id} offers ${offers}.\n` +
      '  Refusing rather than substituting: a paid render that bills for one size and delivers another is\n' +
      '  invisible to the customer and to the ledger, which is the one failure neither of them can catch.',
      {
        code: 'RESOLUTION_UNAVAILABLE',
        step: 'compose',
        userMessage: 'That output size is not available from this renderer.',
        detail: { resolution: id, requested: raster, offered: provider.capabilities.stillSizes },
      },
    );
  }
  const size = provider.capabilities.stillSizes[0];
  log(`  ${provider.id} does not offer ${raster.width}x${raster.height} (${id}); using ${size.width}x${size.height} -- free provider, nothing is billed`);
  return { id, size: { width: size.width, height: size.height }, honoured: false };
}

// ---------------------------------------------------------------------------
// dependencies
// ---------------------------------------------------------------------------

/**
 * The modules written alongside this one, imported the moment they are first
 * needed and not before.
 *
 * A static `import` of a file that does not exist yet is a module-load error,
 * which would mean this file could not even be parsed -- and therefore could
 * not be tested -- until every other workstream had landed. A dynamic import
 * inside the step that uses it costs one `await` and lets the orchestrator and
 * its tests exist first. It also means a missing module fails at the step that
 * needed it, naming the step, rather than at import time naming nothing.
 */
const LAZY = Object.freeze({
  ingestPhoto: async () => (await import('../intake/photo.mjs')).ingestPhoto,
  faceGate: async () => (await import('../intake/photo.mjs')).faceGate,
  moderateJob: async () => (await import('../safety/moderate.mjs')).moderateJob,
  expandPlace: async () => (await import('../expand/expand.mjs')).expandPlace,
  expandOutfit: async () => (await import('../expand/expand.mjs')).expandOutfit,
  placeFromPhoto: async () => (await import('../expand/expand.mjs')).placeFromPhoto,
});

/** Everything already built. Listed rather than imported at each call site so a
 *  test can replace any single one of them without a module mock. */
const STATIC = Object.freeze({
  runFfmpeg, probe,
  assertDeliveryContract, assertComposite, assertTapeGrade, assertBurnIn,
  loadCatalog, resolveFont, loadPricing, loadModels,
  writeContactSheet,
  scorer: firstScorer,
  /** No image classifier exists in this repo. `moderateJob` records a warning
   *  saying so rather than a silent pass; see safety/moderate.mjs. */
  imageModerateImpl: null,
});

function makeResolver(overrides = {}) {
  const cache = new Map();
  return async function dep(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (cache.has(name)) return cache.get(name);
    if (Object.hasOwn(STATIC, name)) return STATIC[name];
    const loader = LAZY[name];
    if (!loader) throw new PipelineError(`no dependency named "${name}"`, { code: 'BAD_DEP' });
    let value;
    try {
      value = await loader();
    } catch (err) {
      throw new PipelineError(
        `could not load the module providing "${name}": ${err.message}`,
        { code: 'MODULE_MISSING', detail: { name, cause: err.message } },
      );
    }
    if (typeof value !== 'function') {
      throw new PipelineError(
        `the module providing "${name}" does not export it`,
        { code: 'MODULE_MISSING', detail: { name } },
      );
    }
    cache.set(name, value);
    return value;
  };
}

// ---------------------------------------------------------------------------
// argv builders (pure, like everything outside ffmpeg/run.mjs)
// ---------------------------------------------------------------------------

/**
 * Join the segments with no re-encode at all.
 *
 * Every segment came from the same provider, at the same size and frame rate,
 * so their streams are compatible and `-c copy` is correct -- and it is worth
 * insisting on, because the tape stage is about to re-encode this file once and
 * a second encode here would be real generation loss stacked under a look whose
 * whole subject is generation loss. `concatFilterArgs` is the fallback for the
 * day a provider returns segments that genuinely differ.
 */
export function concatArgs({ listFile, output }) {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    // -safe 0 because the list holds plain filenames resolved relative to the
    // list file itself, which is the form that survives a Windows path.
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c', 'copy', '-an',
    '-movflags', '+faststart',
    output,
  ];
}

/** The fallback: decode and re-encode. Costs one generation of quality and is
 *  logged loudly when it happens, because it means the provider's segments
 *  disagreed with each other and somebody should know. */
export function concatFilterArgs({ inputs, output, cfg }) {
  const labels = inputs.map((_, i) => `[${i}:v]setsar=1[v${i}]`).join(';');
  const chain = `${inputs.map((_, i) => `[v${i}]`).join('')}concat=n=${inputs.length}:v=1:a=0[vout]`;
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-filter_complex_threads', String(cfg.encode.filterComplexThreads),
    ...inputs.flatMap((f) => ['-i', f]),
    '-filter_complex', `${labels};${chain}`,
    '-map', '[vout]', '-an',
    '-r', String(cfg.fps),
    '-c:v', cfg.encode.videoCodec,
    '-pix_fmt', cfg.encode.pixFmt,
    '-crf', String(cfg.encode.crf),
    '-preset', cfg.encode.preset,
    '-x264-params', cfg.encode.x264Params,
    '-movflags', '+faststart',
    output,
  ];
}

/** One frame, by number rather than by timestamp: `-ss 2.4` lands on whatever
 *  frame the seek happens to reach, which is a different frame on a different
 *  ffmpeg build, and the poster is a published artifact. */
export function posterArgs({ input, output, frame = POSTER_FRAME }) {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', input,
    '-vf', `select='eq(n\\,${frame})'`,
    '-vsync', '0',
    '-frames:v', '1',
    '-q:v', '2',
    output,
  ];
}

// ---------------------------------------------------------------------------
// staging the upload
// ---------------------------------------------------------------------------

/**
 * The raw upload is copied INTO the job directory before it is ingested.
 *
 * Without this, resuming an interrupted `intake` would need the original file
 * to still be where the command line said it was -- on a queue-driven worker,
 * days later, that is a temp file somebody's OS has already deleted. With it,
 * the job directory is self-sufficient from the first step onward.
 *
 * The staged copy is deleted the moment intake commits, and that deletion is
 * load-bearing rather than tidiness: the staged file is the only thing in the
 * job directory that still carries EXIF, and a photograph of a place carries
 * its coordinates. `ingestPhoto` strips them from the copy it writes; this
 * removes the original they came in on.
 */
const STAGED_PREFIX = 'upload-';

/**
 * Find a staged upload, with or without an extension.
 *
 * Both spellings are legitimate and they come from different callers, which is
 * why this matcher has to accept both rather than picking a winner:
 *
 * - The CLI stages `upload-photo.jpg`, keeping the extension off a path the
 *   operator typed. That is safe, because the operator is not an attacker, and
 *   it keeps the staged file recognisable in a job directory.
 * - The web app stages `upload-photo`, with NO extension, deliberately. A
 *   client filename is attacker-controlled text and nothing should build a path
 *   out of it. Its comment says so.
 *
 * The first version of this matched `startsWith('upload-photo.')` -- with the
 * dot -- so the web app's extension-less file was invisible to it and every
 * browser upload failed at intake with "no photograph to ingest", while the
 * file sat right there in the directory. Both sides were individually correct
 * and both sides' tests passed; the bug lived only in the gap between them.
 *
 * Dropping the extension costs nothing downstream: `ingestPhoto` hands the file
 * to ffmpeg, which probes content rather than trusting a suffix.
 */
function findStaged(paths, kind) {
  if (!fs.existsSync(paths.input)) return null;
  const stem = `${STAGED_PREFIX}${kind}`;
  const hit = fs.readdirSync(paths.input)
    .find((f) => f === stem || f.startsWith(`${stem}.`));
  return hit ? `${paths.input}/${hit}` : null;
}

function stageUpload(paths, kind, absSource) {
  const ext = path.extname(absSource).toLowerCase() || '.bin';
  const dest = `${paths.input}/${STAGED_PREFIX}${kind}${ext}`;
  fs.mkdirSync(paths.input, { recursive: true });
  fs.copyFileSync(absSource, dest);
  return dest;
}

// ---------------------------------------------------------------------------
// idempotency: the three cases, in one place
// ---------------------------------------------------------------------------

/**
 * Decide what to do about the intent record before a paid call.
 *
 * @returns {{action:'adopt', result:object} | {action:'call'}}
 * @throws  {PipelineError} INTENT_IN_FLIGHT -- we may have paid and cannot tell
 */
function decideIntent({ job, step, payload, wasRunning, matches, log }) {
  const prior = readIntent(job, step);

  // CASE 1 -- crash re-entry with a completed record. The call finished, the
  // result was written, and the process died before the manifest caught up.
  // Adopting is free and correct; calling again is a second charge for bytes
  // already on disk.
  if (wasRunning && prior?.result && matches(prior)) {
    log(`  ${step}: adopting the result already recorded under intent ${prior.key} -- not re-submitting`);
    return { action: 'adopt', result: prior.result };
  }

  // CASE 2 -- crash re-entry with an OPEN record. A request went out and no
  // result ever came back. This function refuses to guess; see the file header.
  if (wasRunning && prior && prior.result === null) {
    throw new PipelineError(
      `${step}: an intent was recorded at ${prior.recordedAt} under key ${prior.key} and no result was ever written.\n` +
      `  A paid request may already have gone out. This pipeline will not silently re-submit it and will not silently skip it.\n` +
      `  Look at intent/${step}.json and at the provider's own record of ${prior.key}, then either:\n` +
      `    npm run render -- --resume=${job.jobId} --retry-step=${step}    (submit again, deliberately)\n` +
      `    npm run jobs -- show ${job.jobId}                               (read what is on disk first)`,
      {
        code: 'INTENT_IN_FLIGHT',
        step,
        userMessage: 'This render was interrupted while it was generating. Someone needs to check it before it continues.',
        detail: { key: prior.key, recordedAt: prior.recordedAt, attempt: prior.attempt },
      },
    );
  }

  // CASE 3 -- a deliberate act: the step is `pending`, so somebody called
  // `retryStep`. An open record from the previous attempt is closed as
  // UNRESOLVED rather than deleted -- deleting it would erase the evidence that
  // a request went out -- and closing it is what lets `recordIntent` rotate it
  // into the receipts and mint a fresh key.
  if (!wasRunning && prior && prior.result === null) {
    log(`  ${step}: superseding the open intent ${prior.key} -- it is being resubmitted deliberately`);
    completeIntent(job, step, {
      unresolved: true,
      note: 'a request was recorded and no result was ever seen; superseded by a deliberate retry',
      supersededKey: prior.key,
    });
  }

  return { action: 'call' };
}

// ---------------------------------------------------------------------------
// the steps
// ---------------------------------------------------------------------------

/** 1. intake -- ingest both photographs, strip their metadata, hash them. */
async function stepIntake(ctx) {
  const { job, paths, sources, dep, log } = ctx;
  const ingestPhoto = await dep('ingestPhoto');
  const faceGate = await dep('faceGate');

  const staged = findStaged(paths, 'photo')
    ?? (sources.photo ? stageUpload(paths, 'photo', path.resolve(sources.photo)) : null);
  if (!staged) {
    throw new PipelineError(
      `no photograph to ingest: nothing staged in ${slash(paths.input)} and no --photo given`,
      {
        code: 'NO_PHOTO',
        step: 'intake',
        userMessage: 'We could not find the photo for this job. Please upload it again.',
      },
    );
  }

  const photo = await ingestPhoto(staged, `${paths.input}/photo.jpg`);
  const gate = await faceGate(photo.path);
  if (!gate.ok) {
    throw new PipelineError(
      `the face gate refused ${slash(photo.path)}: ${gate.reason} (impl ${gate.impl})`,
      {
        code: `face-gate-${gate.reason}`,
        step: 'intake',
        userMessage: 'That photo does not look like a photo of a person. Please choose one where a face is clearly visible.',
        detail: gate,
      },
    );
  }

  // The manifest records what we HOLD, which is the stripped copy.
  job.input.photo = {
    path: toJobRelative(job, photo.path),
    sha256: photo.sha256,
    width: photo.width,
    height: photo.height,
  };

  const output = {
    photo: { ...job.input.photo, rotated: photo.rotated, stripped: photo.stripped },
    // Recorded by name so that every job rendered before a real detector exists
    // says honestly, in its own manifest, that no face was ever verified.
    faceGate: { ok: gate.ok, reason: gate.reason, confidence: gate.confidence, impl: gate.impl },
    place: null,
  };

  const stagedPlace = findStaged(paths, 'place')
    ?? (sources.placePhoto ? stageUpload(paths, 'place', path.resolve(sources.placePhoto)) : null);
  if (stagedPlace) {
    const place = await ingestPhoto(stagedPlace, `${paths.input}/place.jpg`);
    job.input.place = {
      ...job.input.place,
      kind: 'photo',
      photoPath: toJobRelative(job, place.path),
      photoSha256: place.sha256,
    };
    output.place = { path: job.input.place.photoPath, sha256: place.sha256, width: place.width, height: place.height };
  }

  return {
    output,
    // Only after the manifest has recorded the stripped copies. A crash before
    // this leaves the staged originals in place, which is exactly what a resume
    // needs; `purge` owns them from here on.
    afterCommit: () => {
      for (const file of [staged, stagedPlace]) {
        if (file) { try { fs.rmSync(file, { force: true }); } catch { /* purge will get it */ } }
      }
      log('  intake: staged originals removed -- only the EXIF-stripped copies remain');
    },
  };
}

/** 2. moderate -- the free text and the photographs, against the same bar a
 *  shipped preset clears. */
async function stepModerate(ctx) {
  const { job, dep } = ctx;
  const moderateJob = await dep('moderateJob');
  const imageModerateImpl = await dep('imageModerateImpl');

  // The safety module takes real paths so an injected image classifier can open
  // them; the manifest keeps the relative ones.
  const abs = (rel) => (rel ? fromJobRelative(job, rel) : null);
  const verdict = await moderateJob({
    ...job.input,
    photo: { ...job.input.photo, path: abs(job.input.photo.path) },
    place: { ...job.input.place, photoPath: abs(job.input.place.photoPath) },
  }, { imageModerateImpl });

  if (!verdict.ok) {
    const first = verdict.refusals[0];
    throw new PipelineError(
      `refused at moderation: ${verdict.refusals.map((r) => r.message).join('; ')}`,
      {
        code: first?.code ?? 'refused',
        step: 'moderate',
        userMessage: verdict.refusals.map((r) => r.userMessage).filter(Boolean).join(' '),
        detail: { refusals: verdict.refusals.map((r) => ({ code: r.code, field: r.field, userMessage: r.userMessage })) },
      },
    );
  }

  return {
    output: {
      ok: true,
      // The injection-stripped text, kept separately rather than overwriting
      // `input`. What the person typed is evidence and stays; what we send is
      // what survived the strip, and `expand` reads THIS.
      cleaned: verdict.cleaned,
      // `detail` is kept, not summarised: the injection warning carries the
      // exact strings that were removed, and "what did we silently drop out of
      // this person's description" is the question a complaint starts with.
      warnings: verdict.warnings.map((w) => ({
        field: w.field, code: w.code, userMessage: w.userMessage ?? null, detail: w.detail ?? null,
      })),
    },
  };
}

/** 3. expand -- free text or a photograph becomes the same eight-line shape a
 *  hand-written place has, held to the same schema. */
async function stepExpand(ctx) {
  const { job, dep, baseLook } = ctx;
  const catalog = await ctx.catalog();
  const cleaned = stepOutput(job, 'moderate').cleaned ?? {};

  const placeSpec = job.input.place;
  const outfitSpec = job.input.outfit;
  const placeText = cleaned.place ?? placeSpec.value ?? '';
  const outfitText = cleaned.outfit ?? outfitSpec.value ?? '';

  let place;
  if (placeSpec.kind === 'preset') {
    place = getPlace(catalog, placeSpec.value);
  } else if (placeSpec.kind === 'photo') {
    const placeFromPhoto = await dep('placeFromPhoto');
    place = await placeFromPhoto(fromJobRelative(job, placeSpec.photoPath), {
      catalog, baseLook, text: placeText, seed: deriveSeed(job.jobId, 'expand-place', 0),
    });
  } else {
    const expandPlace = await dep('expandPlace');
    place = await expandPlace(placeText, { catalog, baseLook, seed: deriveSeed(job.jobId, 'expand-place', 0) });
  }

  let outfit;
  if (outfitSpec.kind === 'preset') {
    outfit = getOutfit(catalog, outfitSpec.value);
  } else {
    const expandOutfit = await dep('expandOutfit');
    outfit = await expandOutfit(outfitText, { catalog, baseLook, seed: deriveSeed(job.jobId, 'expand-outfit', 0) });
  }

  // Stored whole, not summarised. `compose` reads them from here on a resume,
  // which is what stops a resumed job from expanding the text a second time and
  // getting a different answer out of an edited preset menu.
  return { output: { place, outfit, from: { place: placeSpec.kind, outfit: outfitSpec.kind } } };
}

/** 4. compose -- prompts, seeds, the segment plan, and the ONE write of
 *  `resolved`. Nothing after this reads `presets/` or `config/` again. */
async function stepCompose(ctx) {
  const { job, provider, cfg, baseLook, dep, log, segmentMode } = ctx;
  const catalog = await ctx.catalog();
  const resolveFontImpl = await dep('resolveFont');

  // 375 frames or an exception. Checked here, before anything is frozen,
  // because every assertion in `verify` is downstream of it.
  frameCount(cfg);

  const expanded = stepOutput(job, 'expand');
  const place = expanded.place ?? getPlace(catalog, job.input.place.value);
  const outfit = expanded.outfit ?? getOutfit(catalog, job.input.outfit.value);

  const compatibility = checkCompatibility(place, outfit);
  for (const w of compatibility.warnings) log(`  note: ${w}`);

  const seeds = {
    still: deriveSeed(job.jobId, 'still', 0),
    audio: deriveSeed(job.jobId, 'audio', 0),
    // Seeds the tape's noise as well as its date, exactly as `npm run look
    // --seed` does: a different seed is a different tape, and a different tape
    // was recorded on a different day.
    stamp: deriveSeed(job.jobId, 'stamp', 0),
  };

  const font = resolveFontImpl();
  if (!font.bundled) {
    throw new PipelineError(
      `no bundled font at ${slash(path.join(REPO_ROOT, 'assets/fonts/tape-osd.ttf'))}.\n` +
      '  The date stamp is the single most recognisable tape cue and drawtext fails SILENTLY when\n' +
      '  fontfile cannot be resolved -- ffmpeg exits 0 and every other assertion still passes.\n' +
      '  A system font would render but would not reproduce on another machine. Run `npm run doctor`.',
      { code: 'NO_BUNDLED_FONT', step: 'compose' },
    );
  }

  const { look, clamped } = loadLookProfile(baseLook, place.lookOverride ?? {}, {
    seed: seeds.stamp,
    seed2: deriveSeed(job.jobId, 'stamp', 1),
    audioSeed: seeds.audio,
    osd: { ...deriveStamp(seeds.stamp), enabled: true, fontRelPath: font.path },
  });
  const { clamped: audioClamped } = clampAudio(look);
  for (const c of [...clamped, ...audioClamped]) {
    log(`  clamped ${c.path}: ${c.from} -> ${c.to} (allowed ${c.min}..${c.max})`);
  }

  // FROZEN HERE, WITH EVERYTHING ELSE. `job.input.resolution` is what was
  // ordered and charged for; this is the raster that answer means. It goes into
  // `resolved` so that nothing downstream re-derives it from a config file, a
  // default or a provider that may all have moved on by the time a job resumes.
  const resolution = resolveRaster({ resolution: job.input.resolution, provider, log });
  log(`  ${resolution.id ?? 'no resolution ordered'} -> ${resolution.size.width}x${resolution.size.height} (4:3)`);

  const segments = planSegments({
    cfg, capabilities: provider.capabilities, jobId: job.jobId, mode: segmentMode, size: resolution.size,
  });
  log(`  ${describePlan(segments)}`);

  const stillPrompt = composeStillPrompt({ place, outfit, era: DEFAULT_ERA, count: job.input.stillCount });
  const motionPrompts = segments.map((seg) => composeMotionPrompt({
    place, outfit, segment: seg.index, totalSegments: segments.length,
  }));

  // Held to `verified: true` and to the layer-2 audio rule HERE, before a
  // request exists -- a model nobody has checked must not reach a paid call.
  const modelsFile = await (await dep('loadModels'))();
  const models = defaultModels(modelsFile, provider.id);
  modelEntry(modelsFile, models.still);
  modelEntry(modelsFile, models.video);

  const pricing = await (await dep('loadPricing'))();
  const estimate = estimateJob({
    pricing,
    stillModel: models.still,
    videoModel: models.video,
    stillCount: job.input.stillCount,
    segments,
  });

  freezeResolved(job, {
    catalogHash: catalog.hash,
    lookHash: shortHash(look),
    place,
    outfit,
    look,
    cfg,
    era: DEFAULT_ERA,
    resolution,
    stillPrompt,
    motionPrompts,
    segments,
    seeds,
    models,
    estimate,
    compatibility,
  });

  return {
    output: {
      catalogHash: catalog.hash,
      lookHash: job.resolved.lookHash,
      placeId: place.id,
      outfitId: outfit.id,
      resolution: resolution.id,
      size: `${resolution.size.width}x${resolution.size.height}`,
      resolutionHonoured: resolution.honoured,
      segments: segments.length,
      estimatedUsd: estimate.estimated,
      clamped: [...clamped, ...audioClamped].map((c) => `${c.path}: ${c.from} -> ${c.to}`),
      compatibilityWarnings: compatibility.warnings,
    },
  };
}

/** 5. still -- PAID. The identity anchor and the rejection gate. */
async function stepStill(ctx) {
  const { job, provider, log, wasRunning } = ctx;
  const r = job.resolved;
  // The raster the customer ordered, frozen at compose. NOT
  // `provider.capabilities.stillSizes[0]`, which is what this line used to be
  // and is the whole of the bug: it asked for whatever the provider happened to
  // list first, on a job that had already been charged for something specific.
  // `?? stillSizes[0]` covers a manifest frozen before this field existed --
  // an old job must still resume, and it resumes to the behaviour it was
  // started with.
  const size = r.resolution?.size ?? provider.capabilities.stillSizes[0];

  const references = [{ role: 'face', path: fromJobRelative(job, job.input.photo.path) }];
  if (job.input.place.photoPath) {
    if (provider.capabilities.supportsPlaceReference) {
      references.push({ role: 'place', path: fromJobRelative(job, job.input.place.photoPath) });
    } else {
      log(`  ${provider.id} does not accept a place reference image -- the uploaded place photo is not being sent`);
    }
  }

  // Job-relative inside the payload, so the idempotency key is a property of
  // the request and not of which machine ran it.
  const payload = {
    model: r.models.still,
    prompt: r.stillPrompt.prompt,
    negativePrompt: r.stillPrompt.negativePrompt,
    seed: r.seeds.still,
    count: job.input.stillCount,
    size,
    references: references.map((ref) => ({ role: ref.role, path: toJobRelative(job, ref.path) })),
  };

  const decision = decideIntent({
    job, step: 'still', payload, wasRunning, log,
    matches: (prior) => Array.isArray(prior.result?.stills)
      && stableStringify(prior.payload) === stableStringify(payload)
      && prior.result.stills.every((s) => fs.existsSync(fromJobRelative(job, s.path))),
  });

  const estimated = r.estimate.lines.find((l) => l.step === 'still')?.usd ?? 0;

  if (decision.action === 'adopt') {
    const adopted = decision.result;
    return {
      output: { ...adopted, adopted: true },
      cost: { estimated, actual: adopted.cost?.actual ?? null, currency: 'USD' },
    };
  }

  const { key } = recordIntent(job, 'still', payload);
  const req = {
    prompt: payload.prompt,
    negativePrompt: payload.negativePrompt,
    references,
    seed: payload.seed,
    count: payload.count,
    size,
    idempotencyKey: key,
  };

  ctx.emit({ phase: 'submit', message: `${req.count} still(s) from ${provider.id}` });
  const res = await ctx.callProvider(() => provider.generateStill(req, ctx.providerCtx));
  assertStillResult(res);

  // THE TRAP THIS LINE EXISTS FOR: the provider hands back absolute paths and
  // `saveJob` throws PATH_NOT_RELATIVE on anything absolute in a manifest.
  const stills = res.stills.map((s) => ({ index: s.index, path: toJobRelative(job, s.path), seed: s.seed }));
  const result = { stills, cost: res.cost, meta: res.meta };
  completeIntent(job, 'still', result);

  return {
    output: { stills, model: res.meta.model, requestId: res.meta.requestId, latencyMs: res.meta.latencyMs },
    cost: { estimated, actual: res.cost.actual, currency: 'USD' },
  };
}

/** 6. select -- the contact sheet, and the last free moment. */
async function stepSelect(ctx) {
  const { job, paths, dep, log, stopAfter, stillIndex } = ctx;
  const write = await dep('writeContactSheet');
  const scorer = await dep('scorer');

  const stills = stepOutput(job, 'still').stills ?? [];
  if (stills.length === 0) {
    throw new PipelineError('the still step recorded no stills', { code: 'NO_STILLS', step: 'select' });
  }

  const autoStill = scorer(stills);
  const sheet = write(job, paths, { stills, autoStill });
  const contactSheetPath = toJobRelative(job, sheet);

  // Either an explicit `--still=N`, or a selection somebody already wrote into
  // the manifest through the web app. Both are a human having looked.
  const requested = Number.isInteger(stillIndex) ? stillIndex
    : (Number.isInteger(job.selection?.stillIndex) ? job.selection.stillIndex : null);

  if (stopAfter === 'select' && requested === null) {
    // Parked, not finished: nobody has chosen, so the step is not done and a
    // resume must come back to it. The output is written onto the running step
    // directly -- that is progress, not a transition -- so the review page is
    // findable in the manifest while the job waits.
    const step = job.steps.find((s) => s.name === 'select');
    step.output = { contactSheetPath, stills, autoStill };
    setJobStatus(job, 'awaiting-selection');
    log('');
    log(`  ${stills.length} still(s) waiting for a human: ${slash(sheet)}`);
    log('  NOTHING PAID FOR HAS HAPPENED SINCE. Video generation is the expensive half and it starts');
    log('  from exactly one of these frames. Open the sheet, then continue with:');
    log('');
    log(`    npm run render -- --resume=${job.jobId} --still=${autoStill}`);
    log('');
    return { parked: true };
  }

  const chosen = chooseStill({ stills, requested, scorer });
  setSelection(job, { stillIndex: chosen.stillIndex, chosenBy: chosen.chosenBy });
  if (chosen.chosenBy === 'auto') {
    log(`  no --stop-after=select and nobody chose: taking still ${chosen.stillIndex} (${slash(chosen.still.path)})`);
  }

  return {
    output: {
      contactSheetPath,
      stills,
      autoStill,
      stillIndex: chosen.stillIndex,
      chosenBy: chosen.chosenBy,
      // The file that will actually be animated, recorded by name. This is the
      // manifest line that makes an off-by-one visible instead of invisible.
      chosenPath: chosen.still.path,
    },
  };
}

/** 7. animate -- PAID, once per segment, each started from the previous
 *  segment's final frame. */
async function stepAnimate(ctx) {
  const { job, paths, provider, cfg, dep, log, wasRunning } = ctx;
  const r = job.resolved;
  const runFfmpegImpl = await dep('runFfmpeg');
  const step = job.steps.find((s) => s.name === 'animate');

  const chosenPath = stepOutput(job, 'select').chosenPath;
  if (!chosenPath) {
    throw new PipelineError('no still was selected', { code: 'NO_SELECTION', step: 'animate' });
  }

  // A segment that is recorded AND still on disk is never bought twice -- not on
  // a crash resume and not on a deliberate `retryStep`. This is where `animate`
  // differs from `still` on purpose: `still` is one call, so retrying it means
  // resubmitting it, whereas retrying `animate` after a failure at segment 4
  // would otherwise re-buy three clips that are sitting in the job directory.
  // The physical escape hatch is the honest one: delete the clip and it is
  // generated again.
  const recorded = Array.isArray(step.output?.segments) ? step.output.segments : [];
  const done = recorded.filter((d) => {
    try { return fs.existsSync(fromJobRelative(job, d.clipPath)); } catch { return false; }
  });
  const output = { segments: done, model: r.models.video, startedFrom: chosenPath };
  step.output = output;

  let estimated = 0;
  let actual = 0;
  let metered = true;

  for (const seg of r.segments) {
    ctx.checkCancelled();
    const line = r.estimate.lines.find((l) => l.step === 'animate' && l.index === seg.index);
    estimated += line?.usd ?? 0;

    const already = done.find((d) => d.index === seg.index);
    if (already) {
      log(`  segment ${seg.index}/${r.segments.length}: already at ${already.clipPath}, not re-submitting ` +
        '(delete that file to force a new one)');
      if (typeof already.actualUsd === 'number') actual += already.actualUsd; else metered = false;
      continue;
    }

    if (!Number.isInteger(seg.seed)) {
      throw new PipelineError(
        `segment ${seg.index} has no seed -- a plan built without a job id reached a paid call`,
        { code: 'NO_SEED', step: 'animate' },
      );
    }

    // Segment 1 starts from the approved still; every later one starts from the
    // previous clip's final frame, and that frame is KEPT so the join can be
    // inspected. Phase-0 criterion 5 is exactly the question of whether it is
    // visible, and hiding it would make the question unanswerable.
    let startPath;
    let lastFramePath = null;
    if (seg.startsFrom === 'still') {
      startPath = fromJobRelative(job, chosenPath);
    } else {
      const prev = done.find((d) => d.index === seg.index - 1);
      if (!prev) {
        throw new PipelineError(
          `segment ${seg.index} continues from segment ${seg.index - 1}, which is not recorded`,
          { code: 'NO_PREVIOUS_SEGMENT', step: 'animate' },
        );
      }
      const frameFile = `${paths.segments}/${lastFrameName(prev.index)}`;
      if (!fs.existsSync(frameFile)) {
        await runFfmpegImpl(lastFrameArgs({
          input: fromJobRelative(job, prev.clipPath), output: frameFile, cfg,
        }));
      }
      startPath = frameFile;
      lastFramePath = toJobRelative(job, frameFile);
    }

    const prompt = r.motionPrompts[seg.index - 1];
    // Carried on the segment by `planSegments`, and falling back to the frozen
    // job-level raster for a manifest written before segments had one. It is
    // part of the PAYLOAD, not just the request, so the idempotency key moves
    // when the size does: a clip bought at 480p must never be adopted by a
    // resume of a job that is now asking for 720p.
    const size = seg.size ?? r.resolution?.size ?? null;
    const payload = {
      model: r.models.video,
      index: seg.index,
      prompt: prompt.prompt,
      negativePrompt: prompt.negativePrompt,
      seed: seg.seed,
      seconds: seg.seconds,
      size,
      imagePath: toJobRelative(job, startPath),
    };

    const decision = decideIntent({
      job, step: 'animate', payload, wasRunning, log,
      matches: (prior) => prior.payload?.index === seg.index
        && stableStringify(prior.payload) === stableStringify(payload)
        && typeof prior.result?.clip?.path === 'string'
        && fs.existsSync(fromJobRelative(job, prior.result.clip.path)),
    });

    let record;
    if (decision.action === 'adopt') {
      record = {
        index: seg.index,
        seconds: decision.result.clip.seconds,
        seed: seg.seed,
        clipPath: decision.result.clip.path,
        lastFramePath,
        actualUsd: decision.result.cost?.actual ?? null,
        adopted: true,
      };
    } else {
      const { key } = recordIntent(job, 'animate', payload);
      const req = {
        prompt: payload.prompt,
        negativePrompt: payload.negativePrompt,
        imagePath: startPath,
        seed: payload.seed,
        seconds: payload.seconds,
        // The raster the customer paid for. Like `index`, this is not a field
        // interfaces.md's VideoRequest names -- it is an interpretation, and
        // the alternative is a provider guessing at a resolution on a job that
        // was billed for a specific one. A provider that does not want it
        // ignores it; the fixture does exactly that and probes the start image.
        ...(payload.size ? { size: payload.size } : {}),
        // Layer 1 of the three-layer rule, and required rather than defaulted.
        nativeAudio: false,
        // Not decoration: with it the clip is written as the documented
        // `segments/seg-01.mp4`, which is the name `assemble` reads. Without it
        // the provider falls back to a hash of the key -- collision-free, but
        // not the name this manifest layout promises.
        index: seg.index,
        idempotencyKey: key,
      };

      ctx.emit({ phase: 'submit', message: `segment ${seg.index}/${r.segments.length}, ${seg.seconds}s` });
      const res = await ctx.callProvider(() => provider.generateVideo(req, ctx.providerCtx));
      assertVideoResult(res);

      const clipPath = toJobRelative(job, res.clip.path);
      completeIntent(job, 'animate', { clip: { path: clipPath, seconds: res.clip.seconds }, cost: res.cost, meta: res.meta });
      record = {
        index: seg.index,
        seconds: res.clip.seconds,
        seed: seg.seed,
        clipPath,
        lastFramePath,
        actualUsd: res.cost.actual,
      };
    }

    if (typeof record.actualUsd === 'number') actual += record.actualUsd; else metered = false;
    done.push(record);
    // Durability per segment, not per step: a crash after segment 3 of 4 must
    // cost three clips' worth of nothing on resume.
    output.segments = done;
    saveJob(job);
    log(`  segment ${seg.index}/${r.segments.length}: ${slash(record.clipPath)} (${record.seconds}s)`);
  }

  return {
    output,
    cost: { estimated, actual: metered ? actual : null, currency: 'USD' },
  };
}

/** 8. assemble -- concat to `source.mp4`, and LAYER 3 of the native-audio
 *  rule: the file that actually came back has zero audio streams. */
async function stepAssemble(ctx) {
  const { job, paths, cfg, dep, log } = ctx;
  const probeImpl = await dep('probe');
  const runFfmpegImpl = await dep('runFfmpeg');

  const segments = stepOutput(job, 'animate').segments ?? [];
  if (segments.length === 0) {
    throw new PipelineError('no segments to assemble', { code: 'NO_SEGMENTS', step: 'assemble' });
  }
  const ordered = [...segments].sort((a, b) => a.index - b.index);
  const files = ordered.map((s) => fromJobRelative(job, s.clipPath));

  // LAYER 3. Layers 1 and 2 assert what we ASKED for; this is the only one that
  // has seen the file. A model version bump that quietly re-enables its own
  // audio passes both of the others and is caught here.
  for (const [i, file] of files.entries()) {
    const info = await probeImpl(file);
    const audio = (info.streams ?? []).filter((s) => s.codec_type === 'audio');
    if (audio.length > 0) {
      throw new PipelineError(
        `segment ${ordered[i].index} came back with ${audio.length} audio stream(s) (${audio.map((a) => a.codec_name).join(', ')}).\n` +
        '  VideoRequest.nativeAudio was false and the provider accepted it, so the model is generating audio anyway.\n' +
        '  Shipping this would put the model\'s idea of the scene underneath the bed in audio/bed.mjs -- two ambiences arguing.\n' +
        '  See CLAUDE.md, "Set the video model\'s native audio OFF", and config/models.json.',
        {
          code: 'NATIVE_AUDIO_PRESENT',
          step: 'assemble',
          detail: { segment: ordered[i].index, streams: audio.map((a) => a.codec_name) },
        },
      );
    }
  }

  const output = paths.source;
  if (files.length === 1) {
    // One segment, no join, and therefore no encode at all -- the tape stage is
    // the only generation this file will suffer.
    fs.copyFileSync(files[0], output);
  } else {
    const listFile = `${paths.segments}/concat.txt`;
    // Plain filenames: the concat demuxer resolves them relative to the list
    // file, which sidesteps drive letters and quoting entirely.
    fs.writeFileSync(listFile, `${files.map((f) => `file '${path.basename(f)}'`).join('\n')}\n`, 'utf8');
    try {
      await runFfmpegImpl(concatArgs({ listFile, output }));
    } catch (err) {
      log(`  concat -c copy failed (${err.message.split('\n')[0]}) -- falling back to a re-encode.`);
      log('  That costs one generation of quality and means the provider\'s segments do not agree with each other.');
      await runFfmpegImpl(concatFilterArgs({ inputs: files, output, cfg }));
    }
  }

  const info = await probeImpl(output, { countFrames: true });
  const audio = (info.streams ?? []).filter((s) => s.codec_type === 'audio');
  if (audio.length > 0) {
    throw new PipelineError(
      `${slash(output)} has ${audio.length} audio stream(s) after assembly -- the bed is built in the tape step and must be the only one`,
      { code: 'NATIVE_AUDIO_PRESENT', step: 'assemble' },
    );
  }

  const video = (info.streams ?? []).find((s) => s.codec_type === 'video') ?? {};
  const frames = Number(video.nb_read_frames);
  const warnings = [];
  if (Number.isFinite(frames) && frames !== cfg.totalFrames) {
    // Not fatal: the tape stage runs with `-stream_loop -1` and `-frames:v`, so
    // it will fill or truncate. Worth recording, because a short source is
    // filled by LOOPING and the repeat is visible.
    warnings.push(
      `assembled ${frames} frames, contract is ${cfg.totalFrames}. ` +
      (frames < cfg.totalFrames
        ? 'The tape stage will loop the source to reach 15s and the repeat may be visible.'
        : 'The tail will be truncated.'),
    );
    log(`  warning: ${warnings[0]}`);
  }

  return {
    output: {
      sourcePath: toJobRelative(job, output),
      segments: ordered.length,
      frames: Number.isFinite(frames) ? frames : null,
      audioStreams: 0,
      warnings,
    },
  };
}

/** 9. tape -- THE LOOK. One ffmpeg call, video and bed together, built by the
 *  same five functions `look-cli.mjs:renderOne` uses and in the same order. */
async function stepTape(ctx) {
  const { job, paths, dep, log } = ctx;
  const r = job.resolved;
  const cfg = r.cfg;
  const runFfmpegImpl = await dep('runFfmpeg');

  const tape = tapeGeometry(cfg);
  const delivery = deliveryGeometry(cfg);

  // The profile was merged, clamped and frozen at compose. Re-merging it from
  // `config/` and the preset here would let an edited preset redefine a render
  // that is already half paid for.
  const osd = r.look.osd;
  const burnIn = burnInFilters(osd, { tape, delivery });
  const videoFilter = buildVideoFilter({ ...r.look, osd }, cfg, { burnIn });
  const audioFilter = buildAudioFilter(r.look, cfg);
  const filterComplex = joinGraphs(videoFilter, audioFilter);

  await runFfmpegImpl(muxedArgs({
    input: paths.source,
    output: paths.video,
    videoFilter,
    audioFilter,
    cfg,
  }));

  // The exact graph, saved next to the render. When one job out of twenty is
  // the good one, this is what makes it explicable.
  const graphFile = `${paths.logs}/tape.filtergraph.txt`;
  fs.mkdirSync(paths.logs, { recursive: true });
  fs.writeFileSync(graphFile, `${filterComplex.split(';').join(';\n')}\n`, 'utf8');
  log(`  tape: ${slash(paths.video)}`);

  return {
    output: {
      videoPath: toJobRelative(job, paths.video),
      filtergraphPath: toJobRelative(job, graphFile),
      burnIn: burnIn.length > 0,
      audio: true,
    },
  };
}

/**
 * 10. verify -- run the contract assertions, and record the numbers.
 *
 * A pipeline that prints "success" over a video that is 14.96 seconds long, or
 * whose date stamp silently failed to render, is worse than one that fails:
 * nothing downstream will ever look at it again. So these are the real
 * assertions from `ffmpeg/assert.mjs` and the real loudness measurement, and
 * what they measured goes into `job.result` -- evidence rather than a claim.
 *
 * NOTE ON PATHS: the region assertions run through the `movie` lavfi source,
 * which cannot take a Windows drive letter, so they need the job to sit under
 * the repo root (they resolve relative to it). A `--root` on another drive
 * fails here with an explicit message from `regionStatsArgs` rather than a
 * mysterious filter error.
 */
async function stepVerify(ctx) {
  const { job, paths, dep, log } = ctx;
  const r = job.resolved;
  const cfg = r.cfg;
  const delivery = deliveryGeometry(cfg);
  const tape = tapeGeometry(cfg);

  const deliveryContract = await dep('assertDeliveryContract');
  const composite = await dep('assertComposite');
  const grade = await dep('assertTapeGrade');
  const burnIn = await dep('assertBurnIn');
  const runFfmpegImpl = await dep('runFfmpeg');

  const checks = [];
  const info = await deliveryContract(paths.video, cfg, { expectAudio: true });
  checks.push('delivery');

  await composite(paths.video, delivery);
  checks.push('composite');

  await grade(paths.video, delivery);
  checks.push('grade');

  if (r.look.osd?.enabled) {
    await burnIn(paths.video, burnInProbeRegion(r.look.osd, delivery, tape));
    checks.push('burn-in');
  }

  // Measured, never reached for: there is no loudnorm anywhere in the render
  // path, so this asserts a number decided in base.json rather than correcting
  // one. See audio/bed.mjs for why that distinction is the whole design.
  const { stderr } = await runFfmpegImpl(fileLoudnessArgs({ input: paths.video }));
  const lufs = parseIntegratedLufs(stderr);
  const verdict = lufsVerdict(lufs, r.look.audio);
  if (!verdict.ok) {
    throw new PipelineError(`the bed is not quiet: ${verdict.message}`, { code: 'LOUDNESS', step: 'verify', detail: verdict });
  }
  checks.push('bed');

  const video = (info.streams ?? []).find((s) => s.codec_type === 'video') ?? {};
  const frames = Number(video.nb_read_frames);
  const measured = {
    frames: Number.isFinite(frames) ? frames : null,
    durationSeconds: Number.isFinite(frames) ? frames / cfg.fps : null,
    lufs,
    lufsTarget: r.look.audio.targetLufs,
    lufsToleranceDb: r.look.audio.toleranceLufs,
  };
  log(`  verify: ${checks.join(', ')} · ${measured.frames} frames · ${measured.durationSeconds}s · ${lufs} LUFS`);

  return { output: { checks, measured } };
}

/** 11. publish -- the poster frame and the human-readable record. */
async function stepPublish(ctx) {
  const { job, paths, dep, log } = ctx;
  const runFfmpegImpl = await dep('runFfmpeg');

  await runFfmpegImpl(posterArgs({ input: paths.video, output: paths.poster }));

  const summaryFile = `${paths.review}/summary.md`;
  fs.mkdirSync(paths.review, { recursive: true });
  fs.writeFileSync(summaryFile, renderSummary(job), 'utf8');
  log(`  published: ${slash(paths.video)}`);

  return {
    output: {
      videoPath: toJobRelative(job, paths.video),
      posterPath: toJobRelative(job, paths.poster),
      summaryPath: toJobRelative(job, summaryFile),
    },
  };
}

/** The job, as prose. Written for the person who opens the directory in six
 *  months and needs to know what was decided and what was measured. */
export function renderSummary(job) {
  const r = job.resolved ?? {};
  const verify = stepOutput(job, 'verify');
  const select = stepOutput(job, 'select');
  const animate = stepOutput(job, 'animate');
  const m = verify.measured ?? {};

  const lines = [
    `# ${job.jobId}`,
    '',
    `provider **${job.provider}** · catalog \`${r.catalogHash ?? '?'}\` · look \`${r.lookHash ?? '?'}\``,
    '',
    '## What was asked for',
    '',
    `- place: **${r.place?.label ?? job.input.place.value}** (\`${job.input.place.kind}\`${r.place?.id ? `, id \`${r.place.id}\`` : ''})`,
    `- outfit: **${r.outfit?.label ?? job.input.outfit.value}** (\`${job.input.outfit.kind}\`${r.outfit?.id ? `, id \`${r.outfit.id}\`` : ''})`,
    `- stills requested: ${job.input.stillCount}`,
    `- consent recorded: ${job.input.consent?.granted ? `yes, at ${job.input.consent.at}` : 'NO'}`,
    '',
    '## What was decided',
    '',
    `- seeds: still ${r.seeds?.still}, audio ${r.seeds?.audio}, stamp ${r.seeds?.stamp}`,
    `- tape date: ${r.look?.osd?.dateText} ${r.look?.osd?.timeText}`,
    `- segments: ${(r.segments ?? []).map((s) => `${s.seconds}s`).join(' + ')} = ${(r.segments ?? []).reduce((n, s) => n + s.seconds, 0)}s`,
    `- still chosen: ${select.stillIndex ?? '?'} (${select.chosenBy ?? '?'}) -> \`${select.chosenPath ?? '?'}\``,
    '',
    '## What was measured',
    '',
    `- frames: ${m.frames ?? '?'} (contract ${r.cfg?.totalFrames ?? '?'})`,
    `- duration: ${m.durationSeconds ?? '?'}s (contract ${r.cfg?.durationSeconds ?? '?'}s)`,
    `- integrated loudness: ${m.lufs ?? '?'} LUFS (target ${m.lufsTarget ?? '?'} ±${m.lufsToleranceDb ?? '?'})`,
    `- contract checks passed: ${(verify.checks ?? []).join(', ') || 'none'}`,
    '',
    '## What it cost',
    '',
    `- estimated: $${job.cost.estimated} · actual: ${job.cost.actual === null ? 'not metered' : `$${job.cost.actual}`}`,
    '',
    '> Every non-zero price in `config/pricing.json` is an ESTIMATE until a `--meter` run proves it.',
    '> `npm run ledger` names a job whose actual diverges from its estimate by more than 15%.',
    '',
    '## Steps',
    '',
    ...job.steps.map((s) => `- \`${s.name}\` — ${s.status}${s.skipReason ? ` (${s.skipReason})` : ''}${s.attempts > 1 ? ` after ${s.attempts} attempts` : ''}`),
    '',
    ...(animate.segments?.length
      ? ['## Segment joins', '',
        'Segment 1 starts from the approved still; every later segment starts from the previous clip\'s final frame.',
        'Those frames are kept next to the clips so the join can be inspected — phase-0 criterion 5.', '',
        ...animate.segments.map((s) => `- seg ${s.index}: \`${s.clipPath}\`${s.lastFramePath ? ` from \`${s.lastFramePath}\`` : ' from the still'}`),
        '']
      : []),
  ];
  return `${lines.join('\n')}\n`;
}

const HANDLERS = Object.freeze({
  intake: stepIntake,
  moderate: stepModerate,
  expand: stepExpand,
  compose: stepCompose,
  still: stepStill,
  select: stepSelect,
  animate: stepAnimate,
  assemble: stepAssemble,
  tape: stepTape,
  verify: stepVerify,
  publish: stepPublish,
});

/** The only step with a skip condition, and it is a decision with a reason
 *  rather than an absence: two shipped presets have already been through
 *  `validatePlace`/`validateOutfit` in CI, which is a strictly harder bar than
 *  expansion, and expanding them would only create a way for the two to
 *  disagree. */
const SKIP_CHECKS = Object.freeze({
  expand: (job) => (job.input.place.kind === 'preset' && job.input.outfit.kind === 'preset'
    ? 'both place and outfit are shipped presets; there is nothing to expand'
    : null),
});

// ---------------------------------------------------------------------------
// the pipeline
// ---------------------------------------------------------------------------

/**
 * @param {object} job                    from `createJob` or `loadJob`
 * @param {object} opts
 * @param {object} opts.provider          a provider object; see providers/contract.mjs
 * @param {string} [opts.root]            only needed if `job` was not attached to one
 * @param {object} [opts.cfg]             config/render.json; `job.resolved.cfg` wins after compose
 * @param {AbortSignal} [opts.signal]
 * @param {function} [opts.onProgress]    `{phase, step, pct, message}`; phase is the closed provider set
 * @param {string|null} [opts.stopAfter]  `'select'` parks the job in front of a human
 * @param {object} [opts.providerCtx]     merged into the ctx handed to the provider
 * @param {object} [opts.deps]            every external function, overridable
 * @param {object} [opts.sources]         `{photo, placePhoto}` absolute paths, first run only
 * @param {number} [opts.stillIndex]      1-based; a human's answer to the contact sheet
 * @param {function} [opts.log]           defaults to silence; the CLIs pass console.log
 * @returns {Promise<object>} the job
 */
export async function runPipeline(job, {
  provider,
  root,
  cfg,
  signal,
  onProgress,
  stopAfter = null,
  providerCtx = {},
  deps = {},
  sources = {},
  stillIndex = null,
  segmentMode = 'continuous',
  log = noop,
} = {}) {
  if (!job || typeof job !== 'object') throw new PipelineError('runPipeline needs a job', { code: 'BAD_JOB' });
  if (!provider) throw new PipelineError('runPipeline needs a provider', { code: 'NO_PROVIDER' });
  // Shape-checked before the job directory is touched. It is also the assertion
  // that keeps a test's fake provider honest: if the pipeline only ever uses the
  // contract, a fake that satisfies `assertProvider` is a fair stand-in, and one
  // that does not was never testing the real path.
  assertProvider(provider);
  if (root && !job.root) saveJob(job, { root });

  const paths = job.paths ?? jobPaths(job.root ?? root, job.jobId);
  const dep = makeResolver(deps);

  if (job.status === 'done') { log(`  ${job.jobId} is already done`); return job; }
  if (job.status === 'cancelled') { log(`  ${job.jobId} was cancelled`); return job; }
  // Deliberately NOT `isResumable`, and the difference is a state a crash really
  // produces: a job whose eleven steps are all done but which died between
  // `publish` committing and `completeJob` writing. `isResumable` says no --
  // there is no next step -- yet that job is one write away from finished and
  // must never be stranded in `running` forever. What is genuinely refused is a
  // FAILED job: a worker that treats failure as "carry on" re-runs the step that
  // failed, forever, on a schedule.
  if (!['queued', 'running', 'awaiting-selection'].includes(job.status)) {
    throw new PipelineError(
      `${job.jobId} is ${job.status} and cannot be continued as it stands. ` +
      'A failed job is recoverable, not resumable: retry the step that failed, deliberately.',
      { code: 'NOT_RESUMABLE', detail: { status: job.status, nextStep: nextStep(job), resumable: isResumable(job) } },
    );
  }

  const renderCfg = cfg ?? readJson(path.join(REPO_ROOT, CONFIG_RENDER));
  const baseLook = deps.baseLook ?? readJson(path.join(REPO_ROOT, CONFIG_BASE_LOOK));

  // Loaded once, lazily, and shared by expand and compose. Neither of them is
  // allowed to read it again after `resolved` is frozen.
  let catalogCache = null;
  const catalog = async () => {
    if (!catalogCache) catalogCache = (await (await dep('loadCatalog'))({ baseLook }));
    return catalogCache;
  };

  const checkCancelled = () => {
    if (signal?.aborted) {
      throw new PipelineError('cancelled via signal', { code: 'ABORTED', retriable: false });
    }
  };

  /** The web process drops `cancel.requested` because it does NOT hold the
   *  queue lease and must not write the manifest. Whoever holds the lease --
   *  this function -- is the legitimate writer, and notices between steps. */
  const cancelRequested = () => fs.existsSync(paths.cancelRequest);

  const done = () => job.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;

  for (const name of STEPS) {
    const status = stepStatus(job, name);
    if (status === 'done' || status === 'skipped') continue;

    if (cancelRequested()) {
      log(`  cancel requested before ${name}`);
      cancelJob(job, `cancelled before ${name}`);
      saveJob(job);
      return job;
    }
    checkCancelled();

    const skipReason = SKIP_CHECKS[name]?.(job);
    if (skipReason) {
      log(`
[${done() + 1}/${STEPS.length}] ${name}: skipped -- ${skipReason}`);
      skipStep(job, name, skipReason);
      saveJob(job);
      continue;
    }

    // Read BEFORE beginStep, which erases the distinction between a crashed
    // step and a deliberately retried one. Everything idempotent hangs off it.
    const wasRunning = status === 'running';

    const emit = (event) => {
      onProgress?.({ step: name, pct: Math.round((done() / STEPS.length) * 100), ...event });
    };

    const ctx = {
      job, paths, root: job.root ?? root, cfg: job.resolved?.cfg ?? renderCfg, baseLook,
      provider, dep, log, sources, stopAfter, stillIndex, signal, segmentMode,
      catalog, wasRunning, step: name, emit, checkCancelled,
      providerCtx: { ...providerCtx, outDir: name === 'still' ? paths.stills : paths.segments, signal,
        onProgress: (e) => onProgress?.({ step: name, ...e }) },
      /** The 1/2/4/8 ladder from providers/errors.mjs. Not a second one written
       *  here: a retry loop that does not share `isRetriable` will eventually
       *  retry a CredentialError four times and call it resilience. */
      callProvider: (fn) => withRetry(fn, {
        maxAttempts: renderCfg.provider.maxAttempts,
        baseMs: renderCfg.provider.backoffBaseMs,
        sleepImpl: providerCtx.sleepImpl,
        onRetry: ({ attempt, waitMs, error }) =>
          log(`  ${name}: attempt ${attempt} failed (${error.code ?? error.name}); retrying in ${waitMs}ms`),
      }),
    };

    beginStep(job, name);
    saveJob(job);
    emit({ phase: 'running' });
    log(`\n[${done() + 1}/${STEPS.length}] ${name}`);

    let result;
    try {
      result = (await HANDLERS[name](ctx)) ?? {};
    } catch (err) {
      failStep(job, name, err);
      // `failStep` records code, message and retriable. The user-facing wording
      // is the one thing it has nowhere to put, and the web app needs it.
      if (err?.userMessage) job.error.userMessage = err.userMessage;
      saveJob(job);
      throw err;
    }

    if (result.parked) {
      saveJob(job);
      return job;
    }

    finishStep(job, name, { output: result.output, cost: result.cost });
    saveJob(job);
    result.afterCommit?.();
    emit({ phase: 'done' });

    if (stopAfter === name) {
      log(`\n  stopping after ${name} as asked. Continue with:\n    npm run render -- --resume=${job.jobId}\n`);
      return job;
    }
  }

  if (nextStep(job) === null && job.status !== 'done') {
    const verify = stepOutput(job, 'verify').measured ?? {};
    const publish = stepOutput(job, 'publish');
    completeJob(job, {
      videoPath: publish.videoPath ?? null,
      posterPath: publish.posterPath ?? null,
      durationSeconds: verify.durationSeconds ?? null,
      frames: verify.frames ?? null,
      lufs: verify.lufs ?? null,
    });
    saveJob(job);
    // Rewritten now that the job really is done. `publish` wrote it while
    // `publish` was still running, so the first copy honestly said so -- and a
    // published record that describes the job as unfinished is a published
    // record nobody trusts. Three lines, and the artifact tells the truth.
    const summaryPath = stepOutput(job, 'publish').summaryPath;
    if (summaryPath) fs.writeFileSync(fromJobRelative(job, summaryPath), renderSummary(job), 'utf8');
    onProgress?.({ step: 'publish', phase: 'done', pct: 100 });
  }

  return job;
}

// ---------------------------------------------------------------------------
// --dry-run
// ---------------------------------------------------------------------------

/**
 * Name every call and its projected price, and charge nothing.
 *
 * Genuinely free: no job directory, no provider, no network. It resolves the
 * place and outfit exactly as `expand` and `compose` would -- which is the
 * point, because the failure this catches is a preset id that does not exist or
 * free text the schema will refuse, and finding that out after the photo has
 * been ingested is finding it out too late.
 *
 * The seeds it prints are NOT the seeds the real render will use: those derive
 * from a job id, and there is deliberately no job here to derive them from.
 */
export async function dryRun({ provider, input, cfg, deps = {}, segmentMode = 'continuous' } = {}) {
  const dep = makeResolver(deps);
  const renderCfg = cfg ?? readJson(path.join(REPO_ROOT, CONFIG_RENDER));
  const baseLook = deps.baseLook ?? readJson(path.join(REPO_ROOT, CONFIG_BASE_LOOK));
  const catalog = await (await dep('loadCatalog'))({ baseLook });

  const place = input.place.kind === 'preset'
    ? getPlace(catalog, input.place.value)
    : input.place.kind === 'photo'
      ? await (await dep('placeFromPhoto'))(path.resolve(input.place.photoPath), { catalog, baseLook, text: input.place.value ?? '', seed: 0 })
      : await (await dep('expandPlace'))(input.place.value, { catalog, baseLook, seed: 0 });
  const outfit = input.outfit.kind === 'preset'
    ? getOutfit(catalog, input.outfit.value)
    : await (await dep('expandOutfit'))(input.outfit.value, { catalog, baseLook, seed: 0 });

  // The same raster resolution the real run will freeze, so `--dry-run` names
  // the size it would actually buy rather than the provider's first offer.
  const resolution = resolveRaster({ resolution: input.resolution ?? null, provider });
  const segments = planSegments({
    cfg: renderCfg, capabilities: provider.capabilities, mode: segmentMode, size: resolution.size,
  });
  const modelsFile = await (await dep('loadModels'))();
  const models = defaultModels(modelsFile, provider.id);
  modelEntry(modelsFile, models.still);
  modelEntry(modelsFile, models.video);
  const pricing = await (await dep('loadPricing'))();
  const estimate = estimateJob({
    pricing, stillModel: models.still, videoModel: models.video,
    stillCount: input.stillCount ?? 3, segments,
  });

  const calls = [
    {
      step: 'still',
      model: models.still,
      description: `generateStill x1 asking for ${input.stillCount ?? 3} image(s) at ${resolution.size.width}x${resolution.size.height}`,
      usd: estimate.lines.find((l) => l.step === 'still')?.usd ?? 0,
    },
    ...segments.map((seg) => ({
      step: 'animate',
      model: models.video,
      description: `generateVideo segment ${seg.index}/${segments.length}, ${seg.seconds}s, starting from ${seg.startsFrom === 'still' ? 'the approved still' : `the last frame of segment ${seg.index - 1}`}`,
      usd: estimate.lines.find((l) => l.step === 'animate' && l.index === seg.index)?.usd ?? 0,
    })),
  ];

  return {
    provider: provider.id,
    resolution,
    place: { id: place.id, label: place.label },
    outfit: { id: outfit.id, label: outfit.label },
    compatibility: checkCompatibility(place, outfit),
    segments,
    plan: describePlan(segments),
    stillPrompt: composeStillPrompt({ place, outfit, era: DEFAULT_ERA, count: input.stillCount ?? 3 }),
    motionPrompts: segments.map((seg) => composeMotionPrompt({ place, outfit, segment: seg.index, totalSegments: segments.length })),
    calls,
    estimate,
    freeSteps: STEPS.filter((s) => s !== 'still' && s !== 'animate'),
  };
}
