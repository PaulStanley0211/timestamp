/**
 * `npm run worker -- --provider=fixture [--once] [--verbose]` -- the render
 * worker as a command.
 *
 * WHY THE BANNER AND THE EVENT LINES ARE PART OF THE PRODUCT. The failure mode
 * of a background worker is a person staring at a silent terminal wondering
 * whether it is working, and the two questions they have are always the same:
 * is there anything to do, and how long is it taking. So the banner names the
 * provider, the queue depth and whether the startup reap recovered anything --
 * a reap that moved three jobs is the difference between "the queue is stuck"
 * and "a previous run was killed" -- and every step prints how long it took.
 * Those per-step numbers are not decoration either: they are the input to the
 * "does this need a queue and an email rather than a spinner" question the
 * product still has to answer, and the only way to have them is to print them
 * from the first run.
 *
 * WHY THE PROVIDER IS IMPORTED LAZILY. `scripts/providers/index.mjs` pulls in
 * the fixture provider and ffmpeg behind it. Nothing in this file's argument
 * parsing or event rendering needs either, and a test that imports
 * `renderEvent` to check the output format must not load a provider to do it.
 *
 * Usage:
 *   npm run worker -- --provider=fixture
 *   npm run worker -- --provider=fixture --once
 *   npm run worker -- --provider=fixture --verbose
 *
 * Options: --root=<dir> --queue-dir=<dir> --poll-ms=<n> --stop-after=<step>
 *          --concurrency=1 --json --help
 */

import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostname } from 'node:os';
import { createQueue, REPO_ROOT } from '../queue/queue.mjs';
import { createWorker, WorkerError } from './worker.mjs';

export function parseArgs(argv) {
  const flags = new Set();
  const values = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    if (rest.length === 0) flags.add(key);
    else values[key] = rest.join('=');
  }
  return { flags, values };
}

/** Humans read "1.2s", not "1234". Sub-second steps are the free ones and they
 *  are worth distinguishing from the paid ones at a glance. */
export function formatMs(ms) {
  if (!Number.isFinite(ms)) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  return `${mins}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`;
}

const money = (n) => (Number.isFinite(n) && n > 0 ? ` $${n.toFixed(2)}` : '');

/**
 * One event -> one line, or null for events this verbosity does not print.
 * Pure, so the format is testable without running a worker.
 *
 * @param {object} event                from the worker's onEvent
 * @param {{verbose?: boolean, t0?: number|null}} [opts]
 * @returns {string|null}
 */
export function renderEvent(event, { verbose = false, t0 = null } = {}) {
  const e = event ?? {};
  const stamp = t0 === null || !Number.isFinite(e.at)
    ? ''
    : `[${String(formatMs(e.at - t0)).padStart(7)}] `;
  const line = (text) => `${stamp}${text}`;
  const job = e.jobId ?? '';

  switch (e.type) {
    case 'reaped':
      if (e.count === 0) return verbose ? line('reaped     nothing -- every claimed job is inside its lease') : null;
      return line(`reaped     ${e.count} dead lease(s) back to pending: ${(e.jobIds ?? []).join(', ')}`);

    case 'claimed':
      return line(`claimed    ${job}  attempt ${(e.attempts ?? 0) + 1}/${e.maxAttempts ?? '?'}`);

    case 'revived':
      return line(`revived    ${job}  reset failed step(s): ${(e.steps ?? []).join(', ') || '(none)'}`);

    case 'step-started':
      return line(`  run      ${e.step}${(e.attempt ?? 1) > 1 ? `  (attempt ${e.attempt})` : ''}`);

    case 'step-finished': {
      const mark = e.status === 'done' ? '  ok     ' : e.status === 'skipped' ? '  skip   ' : '  FAIL   ';
      const why = e.error ? `  ${e.error.code ?? 'ERROR'}: ${e.error.message}` : '';
      return line(`${mark}  ${e.step}  ${formatMs(e.ms)}${money(e.cost)}${why}`);
    }

    case 'progress':
      if (!verbose) return null;
      return line(`           ${e.step ?? ''} ${e.phase ?? ''}${e.pct == null ? '' : ` ${Math.round(e.pct)}%`}` +
        `${e.message ? ` ${e.message}` : ''}`);

    case 'heartbeat':
      if (!verbose) return null;
      return line(e.error
        ? `           lease NOT extended: ${e.error.message}`
        : `           lease extended${e.step ? ` during ${e.step}` : ''}`);

    case 'completed':
      return line(`done       ${job}  ${formatMs(e.ms)}` +
        `${money(e.cost?.actual ?? e.cost?.estimated)}${e.alreadyDone ? '  (already finished)' : ''}`);

    case 'awaiting-selection':
      return line(`selection  ${job}  ${formatMs(e.ms)}  waiting for a human -- open /j/${job}/select`);

    case 'parked':
      return line(`parked     ${job}  ${formatMs(e.ms)}  stopped after --stop-after=${e.stopAfter}`);

    case 'cancelled':
      return line(`cancelled  ${job}  ${formatMs(e.ms)}  no attempt burned, nothing in failed/`);

    case 'failed':
      return line(`FAILED     ${job}  ${formatMs(e.ms)}  [${e.error?.code ?? 'ERROR'}] ${e.error?.message}` +
        `  -> ${e.state}${e.state === 'pending' ? ` (attempt ${e.attempts}/${e.maxAttempts ?? '?'}, will retry)` : ''}`);

    case 'released':
      return line(`released   ${job}  handed back after ${e.reason} -- no attempt burned, claimable now`);

    case 'lease-lost':
      return line(`LEASE LOST ${job}  another worker owns this job now; stopped without writing`);

    case 'idle':
      return verbose ? line('idle       nothing to claim') : null;

    case 'signal':
      return line(`${e.reason} received -- finishing the current step, then stopping. Again to force.`);

    case 'stopping':
      return line(`stopping   ${job}${e.step ? ` after ${e.step}` : ''}`);

    case 'stopped':
      return line('stopped');

    case 'forced':
      return line(`forced exit -- ${e.jobId ? `${e.jobId}'s lease stays held; ` : ''}the next startup reaps it`);

    default:
      return verbose ? line(`${e.type}     ${JSON.stringify({ ...e, type: undefined })}`) : null;
  }
}

function usage() {
  console.log(`
usage: npm run worker -- --provider=fixture [--once] [--verbose]

  --provider=<id>     which provider to render with (required)
  --once              claim one job, run it, exit
  --verbose           also print progress, heartbeats and idle polls
  --stop-after=<step> stop the pipeline after a step, e.g. --stop-after=select
  --root=<dir>        repo root; jobs and queue live under it
  --queue-dir=<dir>   override the queue directory outright
  --poll-ms=<n>       how long to wait when there is nothing to claim
  --concurrency=1     accepted for symmetry; maxInflight lives in config/render.json
  --json              print events as JSON lines instead of readable ones

  The worker never serves HTTP and the app never renders. Start this next to
  the app; without it, jobs sit in the queue forever.
`);
}

async function main() {
  const { flags, values } = parseArgs(process.argv.slice(2));
  if (flags.has('help') || flags.has('h')) { usage(); return 0; }

  const providerId = values.provider;
  if (!providerId) {
    console.error('\n--provider is required. Try: npm run worker -- --provider=fixture\n');
    return 1;
  }

  // `--root` moves the data -- `out/jobs` and `out/queue` -- and nothing else.
  // The config ships with the code, so it is read from the repo the way every
  // other CLI in here reads it; a `--root` pointing at a scratch directory must
  // not silently render against a different contract.
  const root = values.root ?? REPO_ROOT;
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'render.json'), 'utf8'));
  const verbose = flags.has('verbose');
  const json = flags.has('json');

  if (values.concurrency !== undefined && Number(values.concurrency) !== cfg.provider.maxInflight) {
    console.error(`\n--concurrency=${values.concurrency} disagrees with cfg.provider.maxInflight ` +
      `(${cfg.provider.maxInflight}). That number lives in config/render.json so there is one answer; ` +
      'run more worker processes if you want more throughput today.\n');
    return 1;
  }

  const queue = createQueue({
    root,
    queueDir: values['queue-dir'],
    // Both of these come from the config rather than from the queue's own
    // defaults, because the config file is the source of truth for them and a
    // worker that retried a different number of times than `render.json` says
    // would be a bug nobody could see. The lease is deliberately the same
    // number as the longest single blocking call a worker can be inside.
    maxAttempts: cfg.provider.maxAttempts,
    leaseMs: cfg.provider.pollTimeoutMs,
  });

  const { createProvider } = await import('../providers/index.mjs');
  const provider = createProvider(providerId, { cfg, root });

  const t0 = Date.now();
  let lastLine = null;
  const worker = createWorker({
    root,
    cfg,
    provider,
    queue,
    pollMs: values['poll-ms'] ? Number(values['poll-ms']) : undefined,
    stopAfter: values['stop-after'] ?? null,
    workerId: `${hostname()}-${process.pid}`,
    signals: true,
    onEvent(event) {
      if (json) { console.log(JSON.stringify(event)); return; }
      const text = renderEvent(event, { verbose, t0 });
      // Consecutive identical lines are the idle poll printing itself once a
      // second; one is informative, sixty are noise that hides the next real
      // event.
      if (text === null || text === lastLine) return;
      lastLine = text;
      console.log(text);
    },
  });

  const reaped = worker.reap();
  const stats = queue.stats();

  if (!json) {
    console.log(`\ntimestamp worker · ${worker.workerId}\n`);
    console.log(`  provider   ${provider.id}`);
    console.log(`  queue      ${queue.paths.dir}`);
    console.log(`  waiting    ${stats.pending} pending · ${stats.claimed} claimed · ` +
      `${stats.done} done · ${stats.failed} failed`);
    console.log(`  reaped     ${reaped.length === 0 ? 'nothing (no dead leases)' : `${reaped.length}: ${reaped.join(', ')}`}`);
    console.log(`  mode       ${flags.has('once') ? 'one job, then exit' : `loop, polling every ${worker.pollMs}ms`}` +
      `${values['stop-after'] ? ` · stopping after ${values['stop-after']}` : ''}`);
    console.log('');
  }

  if (flags.has('once')) {
    const worked = await worker.once();
    if (!worked && !json) console.log('nothing to claim. The queue is empty.\n');
    return 0;
  }

  await worker.start();
  return 0;
}

const invokedDirectly = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  main()
    .then((code) => { process.exitCode = code ?? 0; })
    .catch((err) => {
      if (err instanceof WorkerError) console.error(`\nworker error [${err.code}]: ${err.message}\n`);
      else console.error(`\nworker error: ${err?.stack ?? err}\n`);
      process.exitCode = 1;
    });
}
