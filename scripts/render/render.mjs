/**
 * `npm run render` -- one photo, one place, one outfit, fifteen seconds.
 *
 * This is the command that can spend money, and it is built so that spending is
 * always a deliberate act:
 *
 *   --dry-run          names every call and its projected price and charges
 *                      nothing. No job directory, no provider, no network.
 *   --stop-after=select  parks the job in front of a human with a contact sheet
 *                      BEFORE video prices apply. CLAUDE.md is flat about this:
 *                      never spend on a still nobody looked at.
 *   --resume=<jobId>   continues an interrupted render, re-submitting nothing
 *                      that was already paid for.
 *
 * `--place` and `--outfit` take EITHER a shipped preset id OR free text, and
 * that is the product's whole vision rather than a convenience: anyone types
 * anything and gets a video. A preset id wins if there is one, and anything else
 * falls through to the expand stage, which builds it into the same eight-line
 * shape a hand-written place has and holds it to the same schema.
 *
 * Usage:
 *   npm run render -- --photo=assets/test-photos/face.jpg --place=schrebergarten-august --outfit=trainingsjacke --consent
 *   npm run render -- --photo=face.jpg --place="my grandmother's kitchen" --outfit="an old fleece" --consent
 *   npm run render -- --photo=face.jpg --place-photo=garden.jpg --outfit=strickjacke --consent
 *   npm run render -- --resume=20260820-144501-a3f19c --still=2
 *   npm run render -- --photo=... --place=... --outfit=... --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { REPO_ROOT } from '../ffmpeg/run.mjs';
import { createProvider, paidTransport, PROVIDER_IDS } from '../providers/index.mjs';
import { loadCatalog, listCatalog } from '../catalog/catalog.mjs';
import { STEPS, createJob, loadJob, saveJob, retryStep, jobPaths } from './job.mjs';
import { runPipeline, dryRun, PipelineError } from './pipeline.mjs';
import { resumeSettings, ResumeConflictError } from './resume.mjs';
import { loadPricing, estimateJob } from '../providers/pricing.mjs';
import { aspectIds } from '../tapedeck/frame.mjs';
import { AVAILABLE_RESOLUTIONS, DEFAULT_RESOLUTION } from '../animate/plan.mjs';

/** Which shape, refused rather than defaulted when it is not one we make. */
function cleanAspect(value, cfg) {
  if (value === undefined) return cfg.defaultAspect;
  const known = aspectIds(cfg);
  if (!known.includes(value)) {
    throw new PipelineError(`--aspect must be one of ${known.join(', ')}, got "${value}"`, { code: 'BAD_ARG' });
  }
  return value;
}

/**
 * Which raster to ORDER, refused rather than defaulted when it is not one we
 * sell.
 *
 * WHY THIS FLAG EXISTS AT ALL, ADDED 2026-08-24. `job.input.resolution` has been
 * honoured by the whole pipeline since resolveRaster was written, and nothing
 * could ever set it from a command line -- so every CLI render silently took
 * the provider's cheapest offer and **only 480p had ever been ordered in the
 * life of this project**. That is why the first metered run could not answer
 * whether the tiers are real: a 720p job could not be made. The web app can
 * order one, and the web app cannot spend (section 8).
 *
 * Left as `null` rather than defaulted to 480p, because null already means
 * something here -- "no order behind this render" -- and resolveRaster prints a
 * different line for it. A CLI run with no resolution is not a customer buying
 * the cheap tier.
 */
function cleanResolution(value) {
  if (value === undefined) return null;
  if (!AVAILABLE_RESOLUTIONS.includes(value)) {
    throw new PipelineError(
      `--resolution must be one of ${AVAILABLE_RESOLUTIONS.join(', ')}, got "${value}"` +
      `${value === DEFAULT_RESOLUTION ? '' : ' -- 1080p is deferred, see config/credits.json'}`,
      { code: 'BAD_ARG' },
    );
  }
  return value;
}

function parseArgs(argv) {
  const args = { flags: new Set(), rest: [] };
  for (const raw of argv) {
    if (!raw.startsWith('--')) { args.rest.push(raw); continue; }
    const [key, ...value] = raw.slice(2).split('=');
    if (value.length === 0) args.flags.add(key);
    else args[key] = value.join('=');
  }
  return args;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const slash = (p) => String(p).replace(/\\/g, '/');

function usage(catalog) {
  const menu = catalog ? listCatalog(catalog) : null;
  const lines = [
    '',
    'usage:',
    '  npm run render -- --photo=<file> --place=<id|text> --outfit=<id|text> --consent',
    '  npm run render -- --resume=<jobId> [--still=N] [--retry-step=<step>]',
    '',
    'options:',
    '  --photo=<file>        the face. Required for a new job.',
    '  --place=<id|text>     a preset id, or anything you like in free text.',
    '  --place-photo=<file>  a photograph of the place, as a second reference image.',
    '  --outfit=<id|text>    a preset id, or free text.',
    `  --provider=<id>       ${PROVIDER_IDS.join(' | ')} (default: fixture)`,
    '  --stills=<n>          how many stills to choose between (1..8, default 3).',
    '  --stop-after=select   write the contact sheet and stop, before video prices apply.',
    '  --still=<n>           which still to animate, 1-based, matching the filenames.',
    '  --direct              NO STILL. The tape is generated from the photographs',
    '                        themselves via reference-to-video: upload a photo,',
    '                        pick an outfit, a place and a shape, get fifteen',
    '                        seconds. Nothing to approve, and no cheap rejection',
    '                        gate either -- a miss costs a whole video.',
    '  --video-model=<id>    override the video model (pair with --direct).',
    '  --still-model=<id>    override the still model for this run (Phase 0 bake-off).',
    '  --allow-unverified-model',
    '                        required alongside --still-model for a candidate that',
    '                        nobody has schema-checked. Two flags on purpose.',
    '  --resolution=<id>     which raster to ORDER: 480p or 720p. Omitted, a CLI',
    '                        render takes the provider first offer and no order is',
    '                        recorded -- which is why only 480p had ever been run.',
    '  --retry-step=<step>   deliberately re-run a step on a resumed job.',
    '  --dry-run             name every call and its projected cost. Charges nothing.',
    '  --consent             confirm the person in the photo agreed to this. Required.',
    '  --root=<dir>          where out/jobs lives (default: the repo root).',
    '',
  ];
  if (menu) {
    lines.push(`  suggested places:  ${menu.places.map((p) => p.id).join(', ')}`);
    lines.push(`  suggested outfits: ${menu.outfits.map((o) => o.id).join(', ')}`);
    lines.push('  ...or type anything else. The suggestions are recommendations, not a menu.');
    lines.push('');
  }
  return lines.join('\n');
}

/** A preset id if the catalog has one, free text otherwise. Preset-first, and
 *  the fall-through is the product rather than a fallback. */
function classify(value, map) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return map.has(value) ? { kind: 'preset', value } : { kind: 'text', value: value.trim() };
}

function positiveInt(value, fallback, name) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new PipelineError(`--${name} must be a positive integer, got "${value}"`, { code: 'BAD_ARG' });
  return n;
}

/** Consent is a gate and not a formality: this system writes a photograph of a
 *  real person's face to disk and sends it to a generation service. The wording
 *  is printed in full rather than summarised, because a consent record that
 *  cannot reproduce what somebody agreed to is not a consent record. */
async function requireConsent(args) {
  const { CONSENT_TEXT, recordConsent } = await import('../safety/consent.mjs');
  if (!args.flags.has('consent')) {
    console.error('\nThis command needs consent before it will touch a photograph of a person.\n');
    console.error(CONSENT_TEXT.split('\n').map((l) => `  ${l}`).join('\n\n'));
    console.error('\nIf that is true, add --consent.\n');
    return null;
  }
  return recordConsent({ granted: true });
}

function reportJob(job, root) {
  const paths = jobPaths(root, job.jobId);
  console.log('');
  console.log(`  job      ${job.jobId}   ${job.status}`);
  if (job.status === 'done') {
    console.log(`  video    ${slash(paths.video)}`);
    console.log(`  poster   ${slash(paths.poster)}`);
    console.log(`  measured ${job.result.frames} frames · ${job.result.durationSeconds}s · ${job.result.lufs} LUFS`);
  }
  console.log(`  cost     estimated $${job.cost.estimated}` +
    (job.cost.actual === null ? ' · actual not metered' : ` · actual $${job.cost.actual}`));
  console.log(`  manifest ${slash(paths.manifest)}`);
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root ? path.resolve(args.root) : REPO_ROOT;
  const cfg = readJson(path.join(REPO_ROOT, 'config', 'render.json'));
  const providerId = args.provider ?? 'fixture';

  if (args.flags.has('help') || (!args.photo && !args.resume)) {
    console.log(usage(safeCatalog()));
    process.exitCode = args.flags.has('help') ? 0 : 1;
    return;
  }

  const stopAfter = args['stop-after'] ?? null;
  if (stopAfter && !STEPS.includes(stopAfter)) {
    console.error(`\n--stop-after must be one of: ${STEPS.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  // Phase 0's bake-off. See runPipeline's signature for why the gate needs two
  // flags rather than one. Refused early and by name here, rather than letting
  // `--allow-unverified-model` sit on a command line doing nothing visible.
  //
  // Parsed BEFORE createProvider because the fal provider resolves its own
  // model at construction time -- `resolveModel` in fal.mjs reads
  // `opts.stillModel`, independently of anything the pipeline froze. Threading
  // the override only into the pipeline moved the failure from compose to
  // still and looked like a fix; the provider is the second place that has to
  // be told.
  // DIRECT MODE: no still, no gate, the tape straight from the photographs.
  // `--video-model` exists for the same reason `--still-model` does -- the
  // provider resolves its own model at construction time, so telling only the
  // pipeline would move the failure rather than fix it.
  const direct = args.flags.has('direct');
  const videoModelOverride = args['video-model'] ?? null;

  const stillModelOverride = args['still-model'] ?? null;
  const allowUnverifiedModel = args.flags.has('allow-unverified-model');
  if (allowUnverifiedModel && !stillModelOverride && !videoModelOverride) {
    console.error('\n--allow-unverified-model does nothing on its own. It lowers the verified gate for'
      + '\nthe model named by --still-model or --video-model, and neither is here.\n');
    process.exitCode = 1;
    return;
  }
  if (direct && stillModelOverride) {
    // A contradiction, not a preference: --direct is the mode with no still in
    // it, so there is no still model for --still-model to name.
    console.error('\n--direct generates the tape from the photographs and makes no still at all,'
      + '\nso --still-model has nothing to name. Drop one of the two.\n');
    process.exitCode = 1;
    return;
  }

  const stillIndex = args.still === undefined ? null : positiveInt(args.still, null, 'still');

  // ---- resume --------------------------------------------------------------
  if (args.resume) {
    const job = loadJob({ root, jobId: args.resume });

    // THE MANIFEST DECIDES, NOT THE DEFAULTS. Building the provider before this
    // point is what resumed a fal job against fixture and posted a
    // reference-to-video body to the image-to-video endpoint, twice in one
    // hour on 2026-08-25. See scripts/render/resume.mjs for both.
    let settings;
    try {
      settings = resumeSettings(job, {
        provider: args.provider ?? null,
        videoModel: videoModelOverride,
        stillModel: stillModelOverride,
      });
    } catch (err) {
      if (!(err instanceof ResumeConflictError)) throw err;
      console.error(`\n${err.message}\n`);
      process.exitCode = 1;
      return;
    }

    const resumedProvider = createProvider(settings.providerId, {
      cfg,
      stillModel: settings.stillModel,
      videoModel: settings.videoModel,
      allowUnverifiedModel,
    });

    console.log(`\ntimestamp render · resuming ${job.jobId} · provider ${settings.providerId}`);
    if (settings.videoModel) console.log(`  video model  ${settings.videoModel}`);
    if (settings.restored.length > 0) {
      // Said out loud. An operator who typed nothing should be told what they
      // got, rather than inferring it from a 422 twenty seconds later.
      console.log(`  restored from the manifest: ${settings.restored.join(', ')}`);
    }

    // ---- a dry run on a resume, which used to be silently ignored ----------
    //
    // The flag whose entire promise is "charges nothing" fell through this
    // branch and ran the job FOR REAL, because `--resume` returns before the
    // dry-run block further down is ever reached. With --provider=fal that is a
    // paid call made by somebody who believed they were pricing it. It is
    // answered here, from the frozen block, before anything is mutated --
    // `--retry-step` below writes to the manifest, so this must come first.
    if (args.flags.has('dry-run')) {
      const remaining = (job.steps ?? [])
        .filter((s) => s.status !== 'done' && s.status !== 'skipped')
        .map((s) => s.name);
      const paid = remaining.filter((name) => name === 'still' || name === 'animate');
      const segments = job.resolved?.segments ?? [];
      console.log('  nothing below is submitted and nothing is charged\n');
      console.log(`  status     ${job.status}`);
      console.log(`  remaining  ${remaining.join(', ') || 'nothing -- this job is finished'}`);
      console.log(`  resolution ${job.resolved?.resolution?.id ?? '(none ordered)'} -> ${
        segments[0]?.size ? `${segments[0].size.width}x${segments[0].size.height}` : '?'}`);
      if (paid.length === 0) {
        console.log('\n  no paid step remains, so resuming this job costs nothing.\n');
        return;
      }
      // Priced from the FROZEN segments, so this is what the resume will
      // actually order rather than what a fresh job would.
      const est = estimateJob({
        pricing: loadPricing(),
        stillModel: settings.stillModel,
        videoModel: settings.videoModel,
        stillCount: job.resolved?.direct === true ? 0 : (job.input?.stillCount ?? 0),
        segments,
      });
      for (const line of est.lines) {
        console.log(`  ${line.step.padEnd(10)} ${line.model} · $${line.usd.toFixed(4)}${
          line.measured === false ? '  (forecast: this raster has never been metered)' : ''}`);
      }
      console.log(`\n  PROJECTED TOTAL  $${est.estimated.toFixed(4)} USD\n`);
      return;
    }

    if (args['retry-step']) {
      retryStep(job, args['retry-step']);
      saveJob(job);
      console.log(`  ${args['retry-step']} put back to pending -- it will be run again, deliberately.`);
    }
    await runPipeline(job, {
      provider: resumedProvider, root, cfg, stopAfter, stillIndex,
      stillModelOverride: settings.stillModel,
      videoModelOverride: settings.videoModel,
      allowUnverifiedModel,
      providerCtx: paidTransport(resumedProvider),
      log: console.log,
    });
    reportJob(job, root);
    return;
  }

  // A NEW job builds its provider from the command line, because there is no
  // manifest to disagree with yet.
  const provider = createProvider(providerId, {
    cfg, stillModel: stillModelOverride, videoModel: videoModelOverride, allowUnverifiedModel,
  });

  // ---- a new job -----------------------------------------------------------
  const photo = path.resolve(args.photo);
  if (!fs.existsSync(photo)) {
    console.error(`\nno such photo: ${slash(photo)}\n`);
    process.exitCode = 1;
    return;
  }
  const placePhoto = args['place-photo'] ? path.resolve(args['place-photo']) : null;
  if (placePhoto && !fs.existsSync(placePhoto)) {
    console.error(`\nno such place photo: ${slash(placePhoto)}\n`);
    process.exitCode = 1;
    return;
  }

  const catalog = loadCatalog();
  const place = placePhoto
    ? { kind: 'photo', value: args.place?.trim() || null }
    : classify(args.place, catalog.places);
  const outfit = classify(args.outfit, catalog.outfits);
  if (!place || !outfit) {
    console.error('\n--place and --outfit are both required (a preset id, or free text).');
    console.error(usage(catalog));
    process.exitCode = 1;
    return;
  }

  const stillCount = positiveInt(args.stills, 3, 'stills');

  // ---- dry run -------------------------------------------------------------
  if (args.flags.has('dry-run')) {
    const plan = await dryRun({
      provider, cfg,
      // THE RESOLUTION TRAVELS, and its absence here was half of the defect
      // CLAUDE.md section 24 recorded. `dryRun` has always read
      // `input.resolution` and always resolved the raster from it; this object
      // simply never carried it, so every tier was priced at the provider's
      // first offer. The other half was the pricing table having no raster
      // dimension at all. Fixing either one alone leaves --dry-run quoting one
      // number for two orders that differ by 2.2x.
      input: {
        place: { ...place, photoPath: placePhoto },
        outfit,
        stillCount,
        direct,
        resolution: cleanResolution(args.resolution),
      },
      stillModelOverride, videoModelOverride, allowUnverifiedModel,
    });
    console.log(`\ntimestamp render · DRY RUN · provider ${plan.provider}`);
    console.log('  nothing below is submitted and nothing is charged\n');
    console.log(`  place   ${plan.place.label} (${plan.place.id})`);
    console.log(`  outfit  ${plan.outfit.label} (${plan.outfit.id})`);
    for (const w of plan.compatibility.warnings) console.log(`  note    ${w}`);
    console.log(`  plan    ${plan.plan}\n`);
    console.log('  calls that would be made:');
    for (const call of plan.calls) {
      console.log(`    [${call.step}] ${call.description}`);
      console.log(`             ${call.model} · projected $${call.usd}`);
    }
    console.log(`\n  free steps (no provider involved): ${plan.freeSteps.join(', ')}`);
    console.log(`\n  PROJECTED TOTAL  $${plan.estimate.estimated} ${plan.estimate.currency}`);
    console.log('  Every non-zero price in config/pricing.json is an ESTIMATE until a --meter run proves it.\n');
    return;
  }

  const consent = await requireConsent(args);
  if (!consent) { process.exitCode = 1; return; }

  const job = createJob({
    root,
    provider: providerId,
    cfg,
    input: {
      // The destination, not the source: `intake` stages the upload into the job
      // directory and writes the stripped copy here.
      photo: { path: 'input/photo.jpg' },
      direct,
      place: { kind: place.kind, value: place.value, photoPath: placePhoto ? 'input/place.jpg' : null },
      outfit,
      stillCount,
      // Validated here rather than left to the job model, which deliberately
      // records what it is given without consulting the catalog. A typo that
      // reaches the pipeline costs a render; caught here it costs a line.
      aspect: cleanAspect(args.aspect, cfg),
      resolution: cleanResolution(args.resolution),
      consent,
    },
  });

  console.log(`\ntimestamp render · ${job.jobId} · provider ${providerId}`);
  console.log(`  ${place.kind} place "${place.value ?? '(from the photo)'}" · ${outfit.kind} outfit "${outfit.value}"`);
  if (!stopAfter) {
    console.log('  note: --stop-after=select would write a contact sheet before any video is generated.');
  }

  await runPipeline(job, {
    provider, root, cfg, stopAfter, stillIndex,
    stillModelOverride, videoModelOverride, allowUnverifiedModel,
    providerCtx: paidTransport(provider),
    sources: { photo, placePhoto },
    log: console.log,
  });
  reportJob(job, root);
}

/** The catalog is only needed to print the suggestions; a broken preset must
 *  not stop `--help` from working. */
function safeCatalog() {
  try { return loadCatalog(); } catch { return null; }
}

try {
  await main();
} catch (err) {
  console.error(`\n${err.name ?? 'error'}: ${err.message}`);
  if (err.userMessage) console.error(`\n  what to tell the person who uploaded it:\n    ${err.userMessage}`);
  if (err.detail) console.error(`\n  detail: ${JSON.stringify(err.detail, null, 2).split('\n').join('\n  ')}`);
  console.error('');
  process.exitCode = 1;
}
