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
import { createProvider, PROVIDER_IDS } from '../providers/index.mjs';
import { loadCatalog, listCatalog } from '../catalog/catalog.mjs';
import { STEPS, createJob, loadJob, saveJob, retryStep, jobPaths } from './job.mjs';
import { runPipeline, dryRun, PipelineError } from './pipeline.mjs';

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

  const provider = createProvider(providerId, { cfg });
  const stillIndex = args.still === undefined ? null : positiveInt(args.still, null, 'still');

  // ---- resume --------------------------------------------------------------
  if (args.resume) {
    const job = loadJob({ root, jobId: args.resume });
    if (args['retry-step']) {
      retryStep(job, args['retry-step']);
      saveJob(job);
      console.log(`\n  ${args['retry-step']} put back to pending -- it will be run again, deliberately.`);
    }
    console.log(`\ntimestamp render · resuming ${job.jobId} · provider ${providerId}`);
    await runPipeline(job, { provider, root, cfg, stopAfter, stillIndex, log: console.log });
    reportJob(job, root);
    return;
  }

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
      input: { place: { ...place, photoPath: placePhoto }, outfit, stillCount },
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
      place: { kind: place.kind, value: place.value, photoPath: placePhoto ? 'input/place.jpg' : null },
      outfit,
      stillCount,
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
