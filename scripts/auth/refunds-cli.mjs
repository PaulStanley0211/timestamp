/**
 * `npm run refunds -- [list|settle <jobId>]` -- the reconciliation queue for
 * money that did not make its way back on its own.
 *
 * WHY THIS EXISTS. `refundIfUnspent` declines whenever a paid step has
 * attempts, and it is right to: attempts increment BEFORE the request leaves,
 * so nothing on disk can tell a pre-flight crash from an in-flight loss, and
 * guessing wrong hands out free provider calls. The cost of that correctness
 * is a queue of maybes -- jobs where a customer was charged and the provider
 * may or may not have billed us. The ONE authority that can resolve a maybe
 * is a person reading the provider's own dashboard, and this command is that
 * person's tool: `list` shows what is waiting, `settle` gives the money back
 * once the human has checked.
 *
 * WHY settle TAKES NO AMOUNT. The owed number comes off the account's own
 * ledger inside `refundCredits`, which is idempotent per job -- so a double
 * settle moves nothing, and no number ever travels through a shell history.
 *
 * An unknown command or flag is exit 2 with nothing touched: `--settel` and
 * `--rooot` are the near-misses that cost this repo a full retention sweep
 * once (CLAUDE.md section 30 item 1), and money deserves at least the same
 * whitelist the purge got.
 *
 * Usage:
 *   npm run refunds                      the pending queue
 *   npm run refunds -- list [--json]
 *   npm run refunds -- settle <jobId>
 *
 * Options: --root=<dir> --json
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { listMissedRefunds, settleMissedRefund } from '../web/session-middleware.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const KNOWN_FLAGS = new Set(['--json']);

function parse(argv) {
  const args = { command: 'list', jobId: null, root: REPO_ROOT, json: false, bad: null };
  const positional = [];
  for (const raw of argv) {
    if (raw.startsWith('--root=')) { args.root = raw.slice('--root='.length); continue; }
    if (raw === '--json') { args.json = true; continue; }
    if (raw.startsWith('--')) { args.bad = raw; return args; }
    positional.push(raw);
  }
  if (positional.length === 0) return args;
  const [command, ...rest] = positional;
  if (command === 'list' && rest.length === 0) return args;
  if (command === 'settle' && rest.length === 1) {
    args.command = 'settle';
    [args.jobId] = rest;
    return args;
  }
  args.bad = positional.join(' ');
  return args;
}

function usage(error) {
  error('usage: npm run refunds -- [list [--json]|settle <jobId>] [--root=<dir>]');
  error('An unknown command or flag settles nothing and touches nothing.');
}

export async function main(argv = [], { log = console.log, error = console.error } = {}) {
  const args = parse(argv);
  if (args.bad !== null) {
    error(`refunds: unrecognised argument ${JSON.stringify(args.bad)}${KNOWN_FLAGS.has(args.bad) ? '' : ' -- not on the whitelist'}`);
    usage(error);
    return 2;
  }

  if (args.command === 'list') {
    const pending = listMissedRefunds({ root: args.root });
    if (args.json) {
      log(JSON.stringify(pending, null, 2));
      return 0;
    }
    if (pending.length === 0) {
      log('nothing pending -- every refund either landed or was settled');
      return 0;
    }
    log(`${pending.length} refund(s) waiting on a human:`);
    for (const r of pending) {
      const money = r.credits === null ? 'credits unknown (read the ledger)' : `${r.credits} CR`;
      log(`  ${r.jobId}  ${r.accountId ?? '(owner unknown)'}  ${money}  ${r.kind}  ${r.at ?? ''}`);
      if (r.error) log(`      ${r.error.code ?? 'ERROR'}: ${r.error.message}`);
    }
    log('');
    log('Check the provider\'s own billing page for each job. If the call was never');
    log('billed, settle it: npm run refunds -- settle <jobId>');
    return 0;
  }

  // settle
  try {
    const result = await settleMissedRefund({ root: args.root, jobId: args.jobId });
    if (result.credits > 0) {
      log(`settled ${result.jobId}: ${result.credits} CR returned to ${result.accountId}`);
    } else {
      log(`${result.jobId}: nothing owed -- already settled or already refunded; the ledger moved nothing`);
    }
    return 0;
  } catch (err) {
    error(`refunds: could not settle ${args.jobId}: ${err?.message ?? err}`);
    return 1;
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  process.exitCode = await main(process.argv.slice(2));
}
