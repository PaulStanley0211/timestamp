/**
 * `node scripts/queue/queue-cli.mjs [stats|peek|reap|drain]` -- see what the
 * queue is doing without opening files.
 *
 * WHY THIS IS A SHIPPED SCRIPT AND NOT A DEBUGGING HABIT. The queue is four
 * directories of JSON, which is legible by design, but "legible" only helps
 * someone who already knows that a `.lock` in `claimed/` with a deadline in the
 * past is a dead worker rather than a running render. This prints that in
 * words. When the app says a job is queued and nothing is happening, this is
 * the first command to run, and it costs nothing and spends nothing.
 *
 * `reap` is safe to run at any time: it only moves leases that are already past
 * their deadline, which is what the worker does on startup anyway. `drain`
 * requires `--yes` because it takes work off the board -- reversibly (every
 * drained job lands in `failed/` and can be enqueued again) but not silently.
 *
 * Usage:
 *   node scripts/queue/queue-cli.mjs stats
 *   node scripts/queue/queue-cli.mjs peek [--state=pending|claimed|done|failed] [--limit=20]
 *   node scripts/queue/queue-cli.mjs reap
 *   node scripts/queue/queue-cli.mjs drain --yes
 *
 * Options: --json  --root=<dir>  --queue-dir=<dir>  --lease-ms=<n>  --max-attempts=<n>
 */

import process from 'node:process';
import { createQueue, QueueError, REPO_ROOT, STATES } from './queue.mjs';

const COMMANDS = ['stats', 'peek', 'reap', 'drain'];

function parseArgs(argv) {
  const opts = { command: null, flags: new Set(), values: {} };
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      if (rest.length === 0) opts.flags.add(key);
      else opts.values[key] = rest.join('=');
    } else if (opts.command === null) {
      opts.command = arg;
    }
  }
  return opts;
}

const pad = (s, w) => String(s).padEnd(w);

function table(rows, columns) {
  if (rows.length === 0) return '  (none)';
  const widths = columns.map(({ key, head }) =>
    Math.max(head.length, ...rows.map((r) => String(r[key] ?? '').length)));
  const line = (cells) => `  ${cells.map((c, i) => pad(c, widths[i])).join('  ')}`.trimEnd();
  return [
    line(columns.map((c) => c.head.toUpperCase())),
    ...rows.map((r) => line(columns.map((c) => (r[c.key] ?? '')))),
  ].join('\n');
}

/** Deadlines are stored as epoch ms because that is what the code compares.
 *  A human wants to know whether it is in the future, and by how much. */
function relative(ms, from) {
  if (!Number.isFinite(ms)) return '-';
  const delta = ms - from;
  const mins = Math.round(Math.abs(delta) / 60000);
  const text = mins >= 120 ? `${Math.round(mins / 60)}h` : `${mins}m`;
  return delta >= 0 ? `in ${text}` : `${text} ago`;
}

function main() {
  const { command, flags, values } = parseArgs(process.argv.slice(2));
  const json = flags.has('json');

  if (command === null || flags.has('help') || flags.has('h')) {
    console.log(`\nusage: node scripts/queue/queue-cli.mjs <${COMMANDS.join('|')}> [options]\n`);
    console.log('  stats                     how many jobs are in each state');
    console.log('  peek [--state=pending]    what is in one state, in claim order');
    console.log('  reap                      return dead leases to pending (safe any time)');
    console.log('  drain --yes               take pending work off the board, reversibly\n');
    console.log('  --json  --root=<dir>  --queue-dir=<dir>  --lease-ms=<n>  --max-attempts=<n>\n');
    process.exitCode = command === null ? 1 : 0;
    return;
  }

  if (!COMMANDS.includes(command)) {
    console.error(`\nunknown command ${JSON.stringify(command)}; expected one of ${COMMANDS.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  const queue = createQueue({
    root: values.root ?? REPO_ROOT,
    queueDir: values['queue-dir'],
    ...(values['lease-ms'] ? { leaseMs: Number(values['lease-ms']) } : {}),
    ...(values['max-attempts'] ? { maxAttempts: Number(values['max-attempts']) } : {}),
  });
  const now = Date.now();

  if (command === 'stats') {
    const s = queue.stats();
    if (json) {
      console.log(JSON.stringify({ dir: queue.paths.dir, ...s }, null, 2));
      return;
    }
    console.log(`\ntimestamp queue · ${queue.paths.dir}\n`);
    console.log(`  pending  ${s.pending}`);
    console.log(`  claimed  ${s.claimed}`);
    console.log(`  done     ${s.done}`);
    console.log(`  failed   ${s.failed}\n`);
    // The one number that is a problem rather than a statistic.
    const stale = queue.peek({ state: 'claimed' }).filter((r) => r.expired).length;
    if (stale > 0) {
      console.log(`  ${stale} lease(s) past their deadline -- run \`queue-cli reap\`, or start the worker, which reaps on startup.\n`);
    }
    return;
  }

  if (command === 'peek') {
    const state = values.state ?? 'pending';
    if (!STATES.includes(state)) {
      console.error(`\nunknown --state=${state}; expected one of ${STATES.join(', ')}\n`);
      process.exitCode = 1;
      return;
    }
    const limit = values.limit ? Number(values.limit) : 20;
    const rows = queue.peek({ state, limit });

    if (json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    console.log(`\ntimestamp queue · ${state} · ${rows.length} shown\n`);
    if (state === 'pending') {
      console.log(table(rows, [
        { key: 'seq', head: 'seq' },
        { key: 'jobId', head: 'job' },
        { key: 'priority', head: 'prio' },
        { key: 'attempts', head: 'tries' },
        { key: 'enqueuedAt', head: 'enqueued' },
      ]));
      console.log('\n  claim order is top-down: highest priority first, then oldest sequence.\n');
    } else if (state === 'claimed') {
      console.log(table(rows.map((r) => ({ ...r, lease: r.expired ? 'EXPIRED' : relative(r.deadline, now) })), [
        { key: 'jobId', head: 'job' },
        { key: 'workerId', head: 'worker' },
        { key: 'attempts', head: 'tries' },
        { key: 'claimedAt', head: 'claimed' },
        { key: 'lease', head: 'lease' },
      ]));
      console.log('');
    } else if (state === 'done') {
      console.log(table(rows, [
        { key: 'jobId', head: 'job' },
        { key: 'attempts', head: 'tries' },
        { key: 'workerId', head: 'worker' },
        { key: 'completedAt', head: 'completed' },
      ]));
      console.log('');
    } else {
      console.log(table(rows.map((r) => ({ ...r, why: r.error?.code ?? '', message: r.error?.message ?? '' })), [
        { key: 'jobId', head: 'job' },
        { key: 'attempts', head: 'tries' },
        { key: 'failedAt', head: 'failed' },
        { key: 'why', head: 'code' },
        { key: 'message', head: 'message' },
      ]));
      console.log('\n  failed/ is the dead letter. The job directory is still in out/jobs/ -- open it,');
      console.log('  fix what broke, and enqueue the same id again to resume from the manifest.\n');
    }
    return;
  }

  if (command === 'reap') {
    const moved = queue.reapExpired();
    if (json) {
      console.log(JSON.stringify({ reaped: moved }, null, 2));
      return;
    }
    if (moved.length === 0) {
      console.log('\nno dead leases. Every claimed job is held by a worker that is still inside its lease.\n');
      return;
    }
    console.log(`\nreaped ${moved.length} dead lease(s):\n`);
    for (const jobId of moved) console.log(`  ${jobId}`);
    console.log('\n  Each one is back in pending (or in failed/, if it had already used every attempt).\n');
    return;
  }

  // drain
  if (!flags.has('yes')) {
    const s = queue.stats();
    console.error(`\ndrain would take ${s.pending} pending job(s) off the board and record them in failed/.`);
    console.error('Claimed jobs are not touched -- stop the worker to stop a render that is already running.');
    console.error('Nothing is deleted and every drained job can be enqueued again by id.');
    console.error('\nRe-run with --yes if that is what you want.\n');
    process.exitCode = 1;
    return;
  }
  const drained = queue.drain({ reason: values.reason ?? 'drained by operator' });
  if (json) {
    console.log(JSON.stringify({ drained }, null, 2));
    return;
  }
  console.log(`\ndrained ${drained.length} job(s) to failed/:\n`);
  for (const jobId of drained) console.log(`  ${jobId}`);
  console.log('');
}

try {
  main();
} catch (err) {
  if (!(err instanceof QueueError)) throw err;
  console.error(`\nqueue error [${err.code}]: ${err.message}\n`);
  process.exitCode = 1;
}
