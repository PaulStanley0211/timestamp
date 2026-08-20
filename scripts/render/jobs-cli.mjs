/**
 * `npm run jobs` -- what is on disk, what it cost, and what to do about it.
 *
 * The manifest is the source of truth and the queue only holds pointers, so
 * this command reads manifests and nothing else. Delete `out/queue` entirely
 * and every job here is still listed, still explicable and still resumable --
 * which is the property that reading the queue instead would quietly destroy.
 *
 * `show` is written for the two questions that actually get asked at three in
 * the morning: "where did it stop, and did we pay for anything?" So it prints
 * the step ledger with attempt counts, and it prints any intent record that was
 * opened and never closed -- the "a request went out and no result came back"
 * case -- by name, with its key, because that is the one thing nobody should
 * have to go and grep for.
 *
 * Usage:
 *   npm run jobs
 *   npm run jobs -- show 20260820-144501-a3f19c
 *   npm run jobs -- resume 20260820-144501-a3f19c [--still=2] [--retry-step=animate]
 *   npm run jobs -- --json
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { REPO_ROOT } from '../ffmpeg/run.mjs';
import { createProvider } from '../providers/index.mjs';
import {
  STEPS, listJobs, loadJob, saveJob, retryStep, jobPaths, nextStep, isResumable,
} from './job.mjs';
import { runPipeline } from './pipeline.mjs';

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
const pad = (s, n) => String(s ?? '').padEnd(n);

/** Where a job stopped, in one word, without making the reader work it out from
 *  eleven step objects. */
function position(job) {
  const next = nextStep(job);
  if (job.status === 'done') return 'complete';
  if (job.status === 'failed') return `failed at ${job.error?.step ?? next ?? '?'}`;
  if (job.status === 'cancelled') return 'cancelled';
  if (job.status === 'awaiting-selection') return 'waiting for a human at select';
  return next ? `next: ${next}` : 'nothing left to do';
}

function list(root, asJson) {
  const rows = listJobs({ root }).map((entry) => {
    let job;
    try { job = loadJob({ root, jobId: entry.jobId }); } catch { return { ...entry, unreadable: true }; }
    return {
      jobId: job.jobId,
      status: job.status,
      position: position(job),
      steps: `${job.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length}/${STEPS.length}`,
      estimated: job.cost.estimated,
      actual: job.cost.actual,
      updatedAt: job.updatedAt,
    };
  });

  if (asJson) { console.log(JSON.stringify(rows, null, 2)); return; }
  if (rows.length === 0) {
    console.log(`\nno jobs under ${slash(path.join(root, 'out/jobs'))}\n`);
    return;
  }
  console.log(`\n${rows.length} job(s) under ${slash(path.join(root, 'out/jobs'))}\n`);
  console.log(`  ${pad('job', 24)}${pad('status', 20)}${pad('steps', 8)}${pad('cost', 20)}where`);
  for (const r of rows) {
    if (r.unreadable) { console.log(`  ${pad(r.jobId, 24)}(manifest unreadable)`); continue; }
    const cost = `$${r.estimated}${r.actual === null ? '' : ` / $${r.actual}`}`;
    console.log(`  ${pad(r.jobId, 24)}${pad(r.status, 20)}${pad(r.steps, 8)}${pad(cost, 20)}${r.position}`);
  }
  console.log('');
}

function show(root, jobId, asJson) {
  const job = loadJob({ root, jobId });
  const paths = jobPaths(root, jobId);
  if (asJson) { console.log(JSON.stringify(job, null, 2)); return; }

  console.log(`\n${job.jobId} · ${job.status} · provider ${job.provider}`);
  console.log(`  created ${job.createdAt} · updated ${job.updatedAt}`);
  console.log(`  ${position(job)}`);
  if (job.resolved) {
    console.log(`  place ${job.resolved.place?.label} · outfit ${job.resolved.outfit?.label}`);
    console.log(`  catalog ${job.resolved.catalogHash} · look ${job.resolved.lookHash} · ` +
      `seeds still ${job.resolved.seeds?.still} audio ${job.resolved.seeds?.audio} stamp ${job.resolved.seeds?.stamp}`);
    console.log(`  segments ${(job.resolved.segments ?? []).map((s) => `${s.seconds}s`).join(' + ')}`);
  } else {
    console.log('  resolved: not frozen yet -- this job has not reached compose');
  }

  console.log('\n  steps');
  for (const step of job.steps) {
    const cost = step.cost.estimated || step.cost.actual !== null
      ? `  $${step.cost.estimated}${step.cost.actual === null ? '' : ` / $${step.cost.actual}`}`
      : '';
    const note = step.error ? `  ${step.error.code}: ${step.error.message.split('\n')[0]}`
      : step.skipReason ? `  ${step.skipReason}` : '';
    console.log(`    ${pad(step.name, 12)}${pad(step.status, 10)}${pad(step.attempts ? `${step.attempts} attempt(s)` : '', 14)}${cost}${note}`);
  }

  // The question that costs money. An intent with no result means a request may
  // have gone out and nothing came back, and the pipeline deliberately refuses
  // to guess about it -- so it has to be visible here rather than grepped for.
  const open = [];
  for (const name of STEPS) {
    const file = `${paths.intent}/${name}.json`;
    if (!fs.existsSync(file)) continue;
    const record = readJson(file);
    if (record.result === null) open.push({ name, record });
  }
  if (open.length) {
    console.log('\n  OPEN INTENTS -- a request was recorded and no result was ever written:');
    for (const { name, record } of open) {
      console.log(`    ${name}: key ${record.key} · attempt ${record.attempt} · recorded ${record.recordedAt}`);
    }
    console.log('    A paid request may already have gone out. Check the provider before resubmitting:');
    console.log(`      npm run render -- --resume=${jobId} --retry-step=${open[0].name}`);
  }

  if (job.selection?.stillIndex !== null && job.selection?.stillIndex !== undefined) {
    console.log(`\n  selection: still ${job.selection.stillIndex} (${job.selection.chosenBy})`);
  }
  if (job.status === 'done') {
    console.log(`\n  video    ${slash(paths.video)}`);
    console.log(`  measured ${job.result.frames} frames · ${job.result.durationSeconds}s · ${job.result.lufs} LUFS`);
  }
  if (job.error) {
    console.log(`\n  error    ${job.error.code} at ${job.error.step ?? '?'}`);
    console.log(`           ${job.error.message.split('\n').join('\n           ')}`);
  }
  console.log(`\n  ${slash(paths.dir)}\n`);
}

async function resume(root, jobId, args) {
  const cfg = readJson(path.join(REPO_ROOT, 'config', 'render.json'));
  const job = loadJob({ root, jobId });
  const provider = createProvider(args.provider ?? job.provider, { cfg });

  if (args['retry-step']) {
    retryStep(job, args['retry-step']);
    saveJob(job);
    console.log(`  ${args['retry-step']} put back to pending -- it will be run again, deliberately.`);
  }
  if (!isResumable(job)) {
    console.error(`\n${jobId} is ${job.status}. ${position(job)}.`);
    console.error('A failed job is recoverable, not resumable -- retry the step that failed:');
    console.error(`  npm run jobs -- resume ${jobId} --retry-step=${job.error?.step ?? '<step>'}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nresuming ${jobId} · provider ${provider.id}`);
  await runPipeline(job, {
    provider, root, cfg,
    stopAfter: args['stop-after'] ?? null,
    stillIndex: args.still === undefined ? null : Number(args.still),
    log: console.log,
  });
  console.log(`\n  ${jobId} is now ${job.status}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root ? path.resolve(args.root) : REPO_ROOT;
  const asJson = args.flags.has('json');
  const [command, target] = args.rest;

  if (!command || command === 'list') { list(root, asJson); return; }
  if (command === 'show') {
    if (!target) { console.error('\nusage: npm run jobs -- show <jobId>\n'); process.exitCode = 1; return; }
    show(root, target, asJson);
    return;
  }
  if (command === 'resume') {
    if (!target) { console.error('\nusage: npm run jobs -- resume <jobId>\n'); process.exitCode = 1; return; }
    await resume(root, target, args);
    return;
  }
  // A bare job id is the thing people actually type.
  show(root, command, asJson);
}

try {
  await main();
} catch (err) {
  console.error(`\n${err.name ?? 'error'}: ${err.message}\n`);
  process.exitCode = 1;
}
