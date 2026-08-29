#!/usr/bin/env node
/**
 * `npm run backup -- --to=<dir> [--keep=<n>]`.
 *
 * The thin shell over scripts/ops/backup.mjs, in the purge-cli's mould: an
 * unknown flag is exit 2 with nothing touched, because `--kep=3` silently
 * ignored is a cron job that fills the disk it was meant to protect.
 *
 * On the deployed box this runs from cron against the /data volume -- see
 * docs/deploy-runbook.md for the line and for the restore procedure. There
 * is deliberately no restore command; see backup.mjs's header.
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseArgs, runBackup } from './backup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 2;
  }
  if (opts.help) {
    process.stdout.write('  npm run backup -- --to=<dir> [--keep=<n>] [--root=<dir>]\n');
    return 0;
  }
  const root = opts.root ?? REPO_ROOT;
  try {
    runBackup({ root, to: opts.to, keep: opts.keep });
    return 0;
  } catch (err) {
    process.stderr.write(`backup failed: ${err.message}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then((code) => { process.exitCode = code; });
}
