/**
 * `npm run ledger` -- what we thought it would cost, what it actually cost, and
 * which prices have stopped being true.
 *
 * THIS COMMAND EXISTS BECAUSE EVERY PRICE IN THIS REPO IS A GUESS. CLAUDE.md
 * lists "treating config/pricing.json as fact" as a mistake and says a `--meter`
 * run is what turns an estimate into a number; `pricing.mjs` already carries
 * `divergence`, `diverges` and a 15% limit, and the doc comment on `diverges`
 * says in as many words "true when `npm run ledger` should name this one". All
 * of that was written against a command that did not exist -- `package.json`
 * has had a `ledger` script pointing at this filename since before there was a
 * file here, so `npm run ledger` failed with MODULE_NOT_FOUND. This is that
 * file.
 *
 * WHAT WAS ACTUALLY MISSING WAS NOT THE REPORT. `cost.actual` is `null` on every
 * job ever run, because nothing writes it: `fal.mjs` says "actual: null means
 * NOT METERED YET" and leaves it there, since fal's queue response does not
 * carry a price. So a read-only report would print "not metered" once per job
 * forever. The half that matters is `record`, which puts a number read off a
 * real invoice onto the job it belongs to.
 *
 * THE MANIFEST IS THE SOURCE OF TRUTH AND THIS COMMAND KEEPS IT THAT WAY. The
 * actual goes on the step, in the manifest, next to the estimate it disagrees
 * with -- not into a separate ledger file that could drift from the jobs it
 * describes. `jobs-cli.mjs` reads manifests and nothing else for the same
 * reason, and both survive `out/queue` being deleted.
 *
 * Usage:
 *   npm run ledger
 *   npm run ledger -- --json
 *   npm run ledger -- record 20260824-122201-af8b0d --actual=1.51
 *   npm run ledger -- record 20260824-122201-af8b0d --actual=0.04 --step=still
 */

import process from 'node:process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { REPO_ROOT } from '../ffmpeg/run.mjs';
import { listJobs, loadJob, saveJob, meterStep } from './job.mjs';
import { divergence, diverges, loadPricing, DIVERGENCE_LIMIT } from '../providers/pricing.mjs';

/** Refusals that are this command's own, kept apart from `JobError` so a bad
 *  argument and a broken manifest do not read as the same problem. */
export class LedgerError extends Error {
  constructor(message, { code = 'LEDGER_ERROR', jobId = null, detail = null } = {}) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
    this.jobId = jobId;
    this.detail = detail;
  }
}

/** Same shape as every other CLI in this directory. */
export function parseArgs(argv) {
  const args = { flags: new Set(), rest: [] };
  for (const raw of argv) {
    if (!raw.startsWith('--')) { args.rest.push(raw); continue; }
    const [key, ...value] = raw.slice(2).split('=');
    if (value.length === 0) args.flags.add(key);
    else args[key] = value.join('=');
  }
  return args;
}

/** Four decimals, matching `pricing.mjs`: a per-second video price of $0.0016 is
 *  a real number and rounding it to cents makes a 15-second clip free. */
const usd = (n) => Number(n.toFixed(4));

/**
 * The estimate lines a job froze at compose, keyed by step.
 *
 * The frozen block is where a step's MODEL and UNIT QUANTITY live, and it is the
 * honest record of what was ordered -- reading `resolved.models` instead would
 * report the job's default rather than what the step was actually billed
 * against, which is wrong the moment a run overrides one of them.
 */
function estimateLines(job) {
  const lines = job?.resolved?.estimate?.lines;
  return Array.isArray(lines) ? lines : [];
}

/**
 * Steps an invoice could be about.
 *
 * NOT "has an actual recorded", which is the version this was written as and it
 * was wrong the first time the real command ran: the fixture provider returns
 * `actual: 0` honestly -- a local ffmpeg call IS free -- so twelve fixture jobs
 * were counted as metered and printed above the five that cost money. A zero
 * charged against a zero estimate is not a reconciliation, it is silence.
 *
 * The rule that survives both cases: a non-zero estimate, or a non-zero charge.
 * That keeps the most interesting line the report can print -- $4.54 expected,
 * $0 actually billed -- while dropping the ones with nothing to disagree about.
 */
function paidSteps(job) {
  return job.steps.filter((s) => (s.cost?.estimated ?? 0) > 0 || (s.cost?.actual ?? 0) > 0);
}

/**
 * One row per job that ever cost anything, plus what the whole set adds up to.
 *
 * A job with no paid step is left out rather than listed at zero. Every fixture
 * render is such a job, and there are more of them than real ones -- a report
 * that lists them buries the four jobs this is actually about.
 */
export function buildLedger({ root = REPO_ROOT, limit = null } = {}) {
  const rows = [];
  for (const { jobId } of listJobs({ root })) {
    let job;
    try {
      job = loadJob({ root, jobId });
    } catch {
      // One unreadable manifest must not hide the rest, the same ruling
      // `listJobs` already makes. `npm run jobs -- show <id>` says what is wrong.
      continue;
    }
    const steps = paidSteps(job);
    if (steps.length === 0) continue;

    const byStep = new Map(estimateLines(job).map((l) => [l.step, l]));
    const lines = steps.map((step) => {
      const frozen = byStep.get(step.name) ?? null;
      return {
        step: step.name,
        status: step.status,
        model: frozen?.model ?? null,
        quantity: frozen?.quantity ?? null,
        estimated: step.cost?.estimated ?? 0,
        actual: step.cost?.actual ?? null,
      };
    });

    rows.push({
      jobId,
      status: job.status,
      createdAt: job.createdAt,
      provider: job.provider,
      estimated: job.cost.estimated,
      actual: job.cost.actual,
      divergence: divergence(job.cost.estimated, job.cost.actual),
      flagged: diverges(job.cost.estimated, job.cost.actual),
      lines,
    });
  }

  const kept = limit === null ? rows : rows.slice(-limit);
  const totals = {
    jobs: kept.length,
    // `actual !== null` is the right test here and only here: by this point the
    // free-and-silent jobs are already gone, so a recorded number means somebody
    // read an invoice.
    metered: kept.filter((r) => r.actual !== null).length,
    unmetered: kept.filter((r) => r.actual === null).length,
    estimated: usd(kept.reduce((n, r) => n + r.estimated, 0)),
    // Only the metered ones. Summing an unmetered job as zero would report a
    // total spend far below the real one and read like good news.
    actual: kept.some((r) => r.actual !== null)
      ? usd(kept.reduce((n, r) => n + (r.actual ?? 0), 0))
      : null,
  };
  return { rows: kept, totals };
}

/**
 * Per model, because `config/pricing.json` is keyed by model and that is what a
 * correction edits.
 *
 * `impliedUsd` is the whole point: actual dollars divided by the units actually
 * billed, in the same unit the config uses, so it is the number to type into the
 * entry. It is `null` when nothing under that model has been metered -- deriving
 * a rate from no invoice is the exact mistake this command was written to end.
 */
export function rollupByModel(rows, { pricing }) {
  const groups = new Map();
  for (const row of rows) {
    for (const line of row.lines) {
      if (!line.model) continue;
      if (!groups.has(line.model)) {
        groups.set(line.model, {
          model: line.model, unit: null, calls: 0, meteredCalls: 0,
          quantity: 0, estimated: 0, actual: 0, meteredLines: [],
        });
      }
      const g = groups.get(line.model);
      g.calls += 1;
      g.estimated += line.estimated;
      if (line.actual === null) continue;
      g.meteredCalls += 1;
      g.actual += line.actual;
      // Quantity is accumulated ONLY from metered lines, because it is the
      // denominator of the implied rate. Counting an unmetered call's seconds
      // would divide real dollars by imagined ones and report a rate lower than
      // anything anybody was charged.
      g.quantity += line.quantity ?? 0;
      g.meteredLines.push(line);
    }
  }

  return [...groups.values()].map((g) => {
    let entry = null;
    try {
      entry = pricing?.models?.[g.model] ?? null;
    } catch { entry = null; }
    const configuredUsd = entry?.usd ?? null;
    // A QUANTITY THAT CANNOT REPRODUCE ITS OWN ESTIMATE IS NOT A DENOMINATOR.
    // `estimateJob` froze `quantity: seg.seconds` for a model billed per TOKEN.
    // The estimate was right -- its USD came from the token count -- so nothing
    // upstream looked wrong, and this function divided a real invoice by the
    // seconds and labelled the answer with the CONFIG's unit, which the
    // quantity never had to agree with. $8.73 over 45 seconds implied
    // $0.1941/token against $0.000014 configured and printed an instruction to
    // edit config/pricing.json by a factor of about 13,825.
    //
    // The freeze is fixed, but every manifest already on disk still holds
    // seconds, so the guard has to be here as well as there.
    //
    // TWO CHECKS, BECAUSE LEGACY LINES DO NOT NAME THEIR UNIT. A line that
    // names one is checked against the config directly. A line that does not is
    // asked whether the configured rate times its quantity reproduces the
    // estimate it was frozen with; if it cannot, then whatever the two sides
    // call their units, dividing an invoice by that quantity means nothing.
    //
    // The second check has a known false positive: a line frozen under a rate
    // that has since been edited will not reproduce either, and its rate is
    // refused although its unit was fine. That is the safe direction -- this
    // number exists to be typed into config/pricing.json, so refusing to print
    // one is a delay, and printing a wrong one is a four-order-of-magnitude
    // mispricing. Lines carrying their unit are exact, and they age in.
    const reconcilable = (line) => {
      if (configuredUsd === null || !(line.quantity > 0)) return false;
      if (line.unit) return line.unit === entry?.unit;
      return Math.abs(configuredUsd * line.quantity - line.estimated) < 0.0001;
    };
    const denominatorIsHonest = g.meteredLines.length > 0 && g.meteredLines.every(reconcilable);
    const impliedUsd = denominatorIsHonest && g.meteredCalls > 0 && g.quantity > 0
      ? usd(g.actual / g.quantity)
      : null;
    // WHICH REFUSAL IT IS, because "3/3 call(s) metered - nothing metered" is a
    // sentence that argues with itself. No invoice at all is a waiting game;
    // an invoice whose frozen quantity cannot be divided by is a repairable
    // data problem, and an operator can only repair what the report names.
    const impliedReason = impliedUsd !== null
      ? null
      : (g.meteredCalls === 0 ? 'nothing-metered' : 'unreconcilable');
    return {
      ...g,
      unit: entry?.unit ?? null,
      impliedReason,
      estimated: usd(g.estimated),
      actual: g.meteredCalls > 0 ? usd(g.actual) : null,
      configuredUsd,
      impliedUsd,
      divergence: impliedUsd === null ? null : divergence(configuredUsd, impliedUsd),
      flagged: impliedUsd === null ? false : diverges(configuredUsd, impliedUsd),
    };
  });
}

/**
 * Write one real number onto one real job.
 *
 * @param {object} args
 * @param {string} args.root
 * @param {string} args.jobId
 * @param {number} args.actual         dollars, off the invoice
 * @param {string|null} [args.step]    inferred when the job has exactly one paid step
 * @param {boolean} [args.force]       overwrite a number already recorded
 * @param {boolean} [args.actuallyZero] this call really was free
 */
export function recordActual({ root = REPO_ROOT, jobId, actual, step = null, force = false, actuallyZero = false }) {
  if (typeof actual !== 'number' || !Number.isFinite(actual) || actual < 0) {
    throw new LedgerError(`--actual must be a non-negative number of dollars, got ${JSON.stringify(actual)}`,
      { code: 'BAD_ACTUAL', jobId });
  }
  // ZERO IS NOT "NOT METERED" AND THE WHOLE MODULE DEPENDS ON THE DIFFERENCE.
  // `contract.mjs` refuses a result whose actual is zero-by-accident for the
  // same reason: `null` means nobody has read the invoice, `0` means the call
  // was free, and a mistyped empty argument arriving as the second one would
  // quietly prove that fal is giving videos away.
  if (actual === 0 && !actuallyZero) {
    throw new LedgerError(
      'refusing to record $0. In this repo `null` means NOT METERED YET and `0` means the call was free -- '
      + 'they are different claims. If it really cost nothing, pass --actually-zero.',
      { code: 'ZERO_ACTUAL', jobId },
    );
  }

  let job;
  try {
    job = loadJob({ root, jobId });
  } catch (err) {
    throw new LedgerError(`no readable job ${jobId} under ${slash(root)}: ${err.message}`,
      { code: 'NO_SUCH_JOB', jobId, detail: { cause: err.code ?? null } });
  }

  const candidates = paidSteps(job);
  let name = step;
  if (name === null) {
    if (candidates.length === 0) {
      throw new LedgerError(`job ${jobId} has no paid step -- there is nothing an invoice could be about`,
        { code: 'NO_PAID_STEP', jobId });
    }
    if (candidates.length > 1) {
      // Guessing here would put a video's price on a still, and the per-model
      // rollup -- the reason any of this exists -- would then be wrong in a way
      // no total could reveal.
      throw new LedgerError(
        `job ${jobId} was billed for more than one step (${candidates.map((s) => s.name).join(', ')}). `
        + 'Say which with --step=<name>; putting a video price on a still would corrupt the per-model rate.',
        { code: 'AMBIGUOUS_STEP', jobId, detail: { steps: candidates.map((s) => s.name) } },
      );
    }
    name = candidates[0].name;
  }

  // `meterStep` raises UNKNOWN_STEP for a name this job does not have and
  // STEP_NOT_BILLABLE for one that never ran -- both are the job model's
  // judgements and are not second-guessed here.
  const existing = job.steps.find((s) => s.name === name)?.cost?.actual ?? null;
  if (existing !== null && !force) {
    throw new LedgerError(
      `step ${name} of ${jobId} is already metered at $${existing} and you passed $${actual}. `
      + 'A metered number is evidence somebody paid to obtain; pass --force to replace it.',
      { code: 'ALREADY_METERED', jobId, detail: { step: name, existing, incoming: actual } },
    );
  }

  const priced = meterStep(job, name, actual);
  saveJob(job);
  return { jobId, step: name, actual: priced.cost.actual, previous: existing, job };
}

const slash = (p) => String(p).replace(/\\/g, '/');
const money = (n) => (n === null ? '        --' : `$${n.toFixed(4)}`.padStart(10));
const pct = (d) => (d === null ? '      --' : `${(d * 100 >= 0 ? '+' : '')}${(d * 100).toFixed(1)}%`.padStart(8));

function printReport({ rows, totals, groups }) {
  console.log('');
  if (rows.length === 0) {
    console.log('  no job on disk has ever cost anything. Nothing to reconcile.\n');
    return;
  }

  console.log('  job                     status              estimated     actual   diverge');
  for (const row of rows) {
    console.log(`  ${row.jobId}  ${String(row.status).padEnd(18)}${money(row.estimated)} ${money(row.actual)}  ${pct(row.divergence)}${row.flagged ? '  <-- OVER' : ''}`);
  }

  console.log('');
  console.log(`  ${totals.jobs} job(s) that cost something · ${totals.metered} metered · ${totals.unmetered} NOT METERED`);
  console.log(`  estimated ${money(totals.estimated).trim()} · actual ${totals.actual === null ? 'nothing metered yet' : money(totals.actual).trim()}`);

  console.log('');
  console.log('  by model -- this is what config/pricing.json is keyed on');
  for (const g of groups) {
    const rate = g.impliedUsd === null
      ? (g.impliedReason === 'unreconcilable'
        ? `NO RATE -- the frozen quantity cannot reproduce its own estimate at $${g.configuredUsd}/${g.unit ?? 'unit'}, so an invoice divided by it would mean nothing`
        : 'nothing metered')
      : `$${g.impliedUsd}/${g.unit ?? 'unit'} against $${g.configuredUsd}/${g.unit ?? 'unit'} configured`;
    console.log(`  ${g.model}`);
    console.log(`    ${g.meteredCalls}/${g.calls} call(s) metered · ${rate}${g.flagged ? `  <-- OVER ${DIVERGENCE_LIMIT * 100}%` : ''}`);
  }

  const over = groups.filter((g) => g.flagged);
  if (over.length > 0) {
    console.log('');
    console.log('  EDIT THESE BY HAND. This command does not write config/pricing.json:');
    console.log('  every entry there carries a _comment saying where the number came from and');
    console.log('  the literal word ESTIMATE, which a test enforces. A number replaced by a');
    console.log('  script would lose the provenance that makes the file worth reading.');
    for (const g of over) {
      console.log(`    models[${JSON.stringify(g.model)}].usd: ${g.configuredUsd} -> ${g.impliedUsd}`);
    }
  }
  console.log('');
}

function usage() {
  console.log(`
usage: npm run ledger [-- record <jobId> --actual=<usd>]

  (no arguments)          every job that cost something, estimated against actual,
                          then a per-model rollup with the implied rate
  record <jobId>          write a real invoice number onto a job
    --actual=<usd>          the number off the billing page
    --step=<name>           required when the job was billed for more than one step
    --force                 replace a number already recorded (it prints both)
    --actually-zero         yes, this call really cost nothing
  --root=<dir>            where out/jobs lives
  --json                  the report as JSON instead of columns

  Divergence over ${DIVERGENCE_LIMIT * 100}% is named. Nothing here spends money or reaches the
  network: it reads manifests and writes one number back.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has('help') || args.flags.has('h')) { usage(); return 0; }

  const root = args.root ? path.resolve(args.root) : REPO_ROOT;
  const [command, jobId] = args.rest;

  if (command === 'record') {
    if (!jobId) {
      console.error('\nrecord needs a job id: npm run ledger -- record <jobId> --actual=1.51\n');
      return 1;
    }
    if (args.actual === undefined) {
      console.error('\nrecord needs --actual=<usd>, the number off the billing page.\n');
      return 1;
    }
    const result = recordActual({
      root,
      jobId,
      actual: Number(args.actual),
      step: args.step ?? null,
      force: args.flags.has('force'),
      actuallyZero: args.flags.has('actually-zero'),
    });
    console.log(`\n  ${result.jobId} · ${result.step} · actual $${result.actual}`
      + `${result.previous === null ? '' : ` (was $${result.previous})`}`);
    console.log('  run `npm run ledger` to see what it does to the rate.\n');
    return 0;
  }

  if (command !== undefined) {
    console.error(`\nunknown command ${JSON.stringify(command)}. Try: npm run ledger -- --help\n`);
    return 1;
  }

  const { rows, totals } = buildLedger({ root });
  const groups = rollupByModel(rows, { pricing: loadPricing() });
  if (args.flags.has('json')) {
    console.log(JSON.stringify({ rows, totals, groups }, null, 2));
    return 0;
  }
  printReport({ rows, totals, groups });
  return 0;
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  main()
    .then((code) => { process.exitCode = code ?? 0; })
    .catch((err) => {
      console.error(`\n${err.name ?? 'error'}: ${err.message}`);
      if (err.detail) console.error(`\n  detail: ${JSON.stringify(err.detail)}`);
      console.error('');
      process.exitCode = 1;
    });
}
