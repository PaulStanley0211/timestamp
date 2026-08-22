/**
 * `npm run purge` -- the retention promise, performed.
 *
 * Every person who uploads a photograph to this system ticks a sentence saying
 * it is deleted after `retention.photoDays` and the finished video after
 * `retention.jobDays`. This command is what makes that true. Until it existed,
 * `npm run purge` failed with "module not found" and the two numbers in
 * `config/render.json` were read only by the code that WRITES the promise --
 * `docs/security-review-2026-08-21.md` F1.
 *
 * IT PRINTS AND EXITS WITHOUT DELETING UNLESS TOLD TWICE. Everything in
 * `purge.mjs` defaults to a dry run and this command does not override that
 * default; an operator has to pass `--apply`. The asymmetry is deliberate and it
 * is the house rule from `docs/interfaces.md` §10: deleting faces is not a thing
 * that happens because somebody hit up-arrow and return.
 *
 * The windows come from `config/render.json` and are not flags by default,
 * because a flag that overrides retention is a flag that quietly makes the app
 * keep photographs longer than it told people it would. `--photo-days` and
 * `--job-days` exist for a one-off clear-out and both are echoed in the header
 * when they differ from config, so the transcript records that they were used.
 *
 * Usage:
 *   npm run purge                          # what is due, deleting nothing
 *   npm run purge -- --apply               # actually delete it
 *   npm run purge -- --json                # the same, machine-readable
 *   npm run purge -- --photo-days=1 --apply
 */

import fs from 'node:fs';
import process from 'node:process';

import { REPO_ROOT } from '../ffmpeg/run.mjs';
import { sweepRetention } from './purge.mjs';

function parseArgs(argv) {
  const args = { flags: new Set() };
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const [key, ...value] = raw.slice(2).split('=');
    if (value.length === 0) args.flags.add(key);
    else args[key] = value.join('=');
  }
  return args;
}

function usage() {
  console.log(`
usage: npm run purge [-- --apply] [--json] [--root=<dir>]
                     [--photo-days=<n>] [--job-days=<n>]

  Deletes what the consent text promises to delete: the uploaded photograph
  after photoDays, the whole job after jobDays.

  Without --apply nothing is deleted and the plan is printed. That is the
  default on purpose.
`);
}

/** Config's numbers, which are the ones the consent text quotes. A missing or
 *  malformed `retention` block is refused rather than defaulted, because the
 *  default this command would have to invent is a retention policy nobody
 *  agreed to. */
function retentionFrom(root) {
  const file = `${root}/config/render.json`;
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`could not read ${file}: ${err.message}`);
  }
  const { photoDays, jobDays } = cfg.retention ?? {};
  if (!Number.isFinite(photoDays) || !Number.isFinite(jobDays)) {
    throw new Error(`${file} has no usable retention block -- purge will not invent one`);
  }
  return { photoDays, jobDays };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has('help') || args.flags.has('h')) { usage(); return 0; }

  const root = args.root ?? REPO_ROOT;
  const configured = retentionFrom(root);
  const photoDays = args['photo-days'] !== undefined ? Number(args['photo-days']) : configured.photoDays;
  const jobDays = args['job-days'] !== undefined ? Number(args['job-days']) : configured.jobDays;
  // `--execute` is the spelling `docs/running-the-app.md` used before this
  // command existed. Both are accepted rather than one being made wrong,
  // because the operator guide is where somebody looks at three in the morning.
  const apply = args.flags.has('apply') || args.flags.has('execute');
  const asJson = args.flags.has('json');

  if (!Number.isFinite(photoDays) || !Number.isFinite(jobDays) || photoDays < 0 || jobDays < 0) {
    console.error('\n  --photo-days and --job-days must be non-negative numbers\n');
    return 2;
  }

  // The ordering rule -- whole jobs first, then photos minus whatever just went --
  // lives in `sweepRetention` rather than here. It used to be written out in this
  // file AND in the worker, which is two places for one correctness rule to drift
  // apart, and only one of the two knew about leases.
  //
  // THIS COMMAND HAS NO QUEUE, so it passes no `skip` set and cannot defer a job
  // somebody is rendering. That is why the worker is the scheduled path and this
  // is the manual one: run `--apply` by hand while a render is in flight and you
  // can pull a directory out from under it.
  const swept = sweepRetention({ root, retention: { photoDays, jobDays }, dryRun: !apply });

  const report = {
    at: swept.at,
    root: swept.root,
    applied: apply,
    retention: swept.retention,
    fromConfig: photoDays === configured.photoDays && jobDays === configured.jobDays,
    scanned: swept.scanned,
    jobsDeleted: swept.jobsDeleted,
    photosDeleted: swept.photosDeleted,
    filesRemoved: swept.filesRemoved,
    errors: swept.errors,
    removed: swept.removed,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const verb = apply ? 'deleted' : 'would delete';
    console.log(`\n  ${apply ? 'purge' : 'purge --dry-run'} at ${report.at}`);
    console.log(`  ${report.scanned} job(s) on disk; keeping photos ${photoDays} day(s), jobs ${jobDays} day(s)`
      + `${report.fromConfig ? ' (config/render.json)' : ' (OVERRIDDEN ON THE COMMAND LINE)'}\n`);
    for (const row of report.removed) {
      console.log(`    ${row.action === 'job' ? 'job  ' : 'photo'}  ${row.jobId}  ${verb} ${row.paths.length} path(s)`);
    }
    if (report.removed.length === 0) console.log('    nothing is due\n');
    else {
      console.log(`\n  ${verb}: ${report.jobsDeleted} job(s), ${report.photosDeleted} photo(s)`);
      if (!apply) console.log('  Nothing was deleted. Re-run with --apply.\n');
      else console.log('');
    }
    for (const err of report.errors) {
      console.error(`    ! ${err.jobId}: ${err.message}`);
    }
  }

  // A sweep that could not delete something has NOT kept the promise, and an
  // operator scripting this needs to find out from the exit code rather than by
  // reading the transcript.
  return report.errors.length > 0 ? 1 : 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error(`\n  purge failed: ${err.message}\n`);
    process.exitCode = 1;
  });
