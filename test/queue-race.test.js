/**
 * The race. Mutual exclusion, demonstrated rather than argued.
 *
 * WHY THIS FILE IS SEPARATE AND WHY IT USES THREADS. `claim()` and
 * `reapExpired()` are synchronous. Calling either twice in a row in one thread
 * proves nothing at all about two workers racing -- the second call simply
 * observes the first one's finished work, which is the ONE interleaving that
 * cannot fail. A queue whose atomicity is tested that way is untested.
 *
 * So the contenders are real `node:worker_threads`: real OS threads making real
 * synchronous filesystem calls against one directory at the same instant.
 * Threads rather than child processes because `scripts/ffmpeg/run.mjs` is the
 * only module in this repo permitted to spawn a process, and a test that
 * quietly builds a second spawn path is a rule that has stopped meaning
 * anything.
 *
 * HOW THE OVERLAP IS FORCED, rather than hoped for. Every thread loads the
 * module, reports ready, and parks on `Atomics.wait` against a shared flag.
 * When the main thread has heard from all of them it sets the flag once and
 * notifies -- one starting gun, and every contender is inside the operation
 * within microseconds. `Atomics.wait` compares before parking, so a thread
 * arriving after the gun reads the new value and proceeds instead of parking
 * forever; there is no lost wakeup and no timer anywhere in this file.
 *
 * HOW THE OVERLAP IS PROVED. Each thread bumps a shared in-flight counter
 * immediately before the operation and drops it after, recording the high-water
 * mark with a compare-exchange loop. If the operations had actually serialised
 * that mark would be 1 and the test says so -- the concurrency is asserted, not
 * assumed.
 *
 * WHAT THIS FILE HAS ALREADY CAUGHT. Two bugs in reapExpired(), neither
 * reachable by any single-threaded test: one job reported reaped by two
 * callers, and -- once the losing reaper started tidying up after itself -- a
 * job deleted from pending while it existed nowhere else, with every count
 * still looking plausible. Both came from picking a winner with `unlinkSync`,
 * which is not exclusive on Windows. See the WINNER SELECTION comment in
 * queue.mjs for the measurements. The invariants below are written to fail
 * loudly on either one, which is why `assertAccountedFor` looks jobs up by name
 * rather than trusting a count.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

const QUEUE_URL = new URL('../scripts/queue/queue.mjs', import.meta.url).href;

/** Enough that the OS interleaves them for real on any machine, few enough that
 *  the whole file stays inside a few seconds. */
const CONTENDERS = 24;

/** Shared Int32Array slots: [0] the starting gun, [1] threads currently inside
 *  the operation, [2] the high-water mark of [1]. */
const GUN = 0;
const IN_FLIGHT = 1;
const PEAK = 2;

/**
 * Runs inside each worker thread. Eval'd worker code is CommonJS, so the ESM
 * queue module comes in through a dynamic import.
 */
const THREAD_SOURCE = `
const { workerData, parentPort } = require('node:worker_threads');
const { moduleUrl, queueDir, index, op, jobId, leaseMs, maxAttempts } = workerData;
const shared = new Int32Array(workerData.shared);

(async () => {
  const { createQueue } = await import(moduleUrl);
  const queue = createQueue({ queueDir, leaseMs, maxAttempts, nowImpl: () => workerData.nowMs });

  // Ready, then park. The main thread fires once, when all of us are here.
  parentPort.postMessage({ ready: true });
  Atomics.wait(shared, ${GUN}, 0);

  const depth = Atomics.add(shared, ${IN_FLIGHT}, 1) + 1;
  let peak = Atomics.load(shared, ${PEAK});
  while (depth > peak) {
    const prev = Atomics.compareExchange(shared, ${PEAK}, peak, depth);
    if (prev === peak) break;
    peak = prev;
  }

  let result;
  try {
    if (op === 'claim') {
      const claim = queue.claim({ workerId: 'contender-' + index });
      result = { index, won: claim ? claim.jobId : null, token: claim ? claim.token : null };
    } else if (op === 'enqueue') {
      const entry = queue.enqueue(jobId);
      result = { index, won: entry.jobId, seq: entry.seq };
    } else if (op === 'reap') {
      result = { index, reaped: queue.reapExpired() };
    } else {
      // What a worker process actually does when it boots: clear the dead
      // leases left by whatever died last, then take a job. Two workers started
      // near each other run this at the same moment, which is why it is not an
      // exotic path.
      const reaped = queue.reapExpired();
      const claim = queue.claim({ workerId: 'starter-' + index });
      result = { index, reaped, won: claim ? claim.jobId : null };
    }
  } catch (err) {
    result = { index, error: err.code || err.message };
  } finally {
    Atomics.sub(shared, ${IN_FLIGHT}, 1);
  }

  parentPort.postMessage({ result });
})().catch((err) => parentPort.postMessage({ result: { index, error: String((err && err.stack) || err) } }));
`;

/**
 * Boots `count` threads, waits until every one is parked at the barrier, then
 * releases them all with a single notify.
 */
function stampede({ count, queueDir, op, jobIds = [], leaseMs = 900_000, maxAttempts = 4, nowMs = Date.now() }) {
  const shared = new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT);
  const view = new Int32Array(shared);
  const results = [];
  let ready = 0;

  return new Promise((resolve, reject) => {
    const workers = [];
    const finish = () => {
      Promise.all(workers.map((w) => w.terminate())).then(
        () => resolve({ results, peak: Atomics.load(view, PEAK) }),
        reject,
      );
    };

    for (let index = 0; index < count; index += 1) {
      const worker = new Worker(THREAD_SOURCE, {
        eval: true,
        workerData: {
          moduleUrl: QUEUE_URL, queueDir, index, op, jobId: jobIds[index], leaseMs, maxAttempts, nowMs, shared,
        },
      });
      workers.push(worker);
      worker.on('error', reject);
      worker.on('message', (msg) => {
        if (msg.ready) {
          ready += 1;
          if (ready === count) {
            // One gun for everybody. Threads already parked wake here; threads
            // still arriving see the flag is 1 and never park.
            Atomics.store(view, GUN, 1);
            Atomics.notify(view, GUN);
          }
          return;
        }
        results.push(msg.result);
        if (results.length === count) finish();
      });
    }
  });
}

function makeDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-race-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return `${dir}/queue`;
}

const JOB = (n) => `20260820-1445${String(n).padStart(2, '0')}-a3f19c`;
const noErrors = (results) =>
  assert.deepEqual(results.filter((r) => r.error), [], 'no contender may throw');

const listed = (dir) => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

/**
 * The invariant the vanished-job bug broke. Counting is not enough: that bug
 * produced four counts that all looked plausible while the job was in none of
 * the four states, so this looks the job up by name in every directory.
 */
function statesOf(queueDir, jobId) {
  const where = [];
  if (listed(`${queueDir}/pending`).some((f) => f.endsWith(`-${jobId}.json`))) where.push('pending');
  if (listed(`${queueDir}/claimed`).includes(`${jobId}.lock`)) where.push('claimed');
  if (listed(`${queueDir}/done`).includes(`${jobId}.json`)) where.push('done');
  if (listed(`${queueDir}/failed`).includes(`${jobId}.json`)) where.push('failed');
  return where;
}

function assertAccountedFor(queueDir, jobId) {
  const where = statesOf(queueDir, jobId);
  assert.equal(where.length, 1, `${jobId} must be in exactly one state, found: [${where.join(', ') || 'NONE'}]`);
  return where[0];
}

/** One pending file per job, ever. Two would be one render billed twice. */
function assertNoDuplicatePending(queueDir) {
  const files = listed(`${queueDir}/pending`).filter((f) => f.endsWith('.json'));
  const jobIds = files.map((f) => f.replace(/^\d{12}-/, '').replace(/\.json$/, ''));
  assert.equal(new Set(jobIds).size, jobIds.length, `duplicate pending entries: ${files.join(', ')}`);
}

test(`${CONTENDERS} threads race for one pending job: exactly one wins, the rest get null`, async (t) => {
  const queueDir = makeDir(t);
  const { createQueue } = await import(QUEUE_URL);
  const queue = createQueue({ queueDir });
  queue.enqueue(JOB(1));

  const { results, peak } = await stampede({ count: CONTENDERS, queueDir, op: 'claim' });

  assert.equal(results.length, CONTENDERS);
  noErrors(results); // EEXIST is the normal path, not an error

  const winners = results.filter((r) => r.won !== null);
  assert.equal(winners.length, 1, `exactly one winner, got ${winners.length}`);
  assert.equal(winners[0].won, JOB(1));
  assert.equal(results.filter((r) => r.won === null).length, CONTENDERS - 1, 'everybody else got null');

  // Tokens are per-claim, so one winner means one token was ever issued.
  assert.equal(new Set(results.map((r) => r.token).filter(Boolean)).size, 1);

  assert.equal(assertAccountedFor(queueDir, JOB(1)), 'claimed');
  assert.deepEqual(queue.stats(), { pending: 0, claimed: 1, done: 0, failed: 0 });

  assert.ok(peak >= 2, `the contenders must genuinely overlap; peak concurrent claims was ${peak}`);
  t.diagnostic(`peak concurrent claim() calls: ${peak} of ${CONTENDERS}`);
});

test(`${CONTENDERS} threads against 6 pending jobs: every job goes to exactly one worker`, async (t) => {
  const queueDir = makeDir(t);
  const { createQueue } = await import(QUEUE_URL);
  const queue = createQueue({ queueDir });
  const jobs = [1, 2, 3, 4, 5, 6].map(JOB);
  for (const jobId of jobs) queue.enqueue(jobId);

  const { results, peak } = await stampede({ count: CONTENDERS, queueDir, op: 'claim' });
  noErrors(results);

  const won = results.map((r) => r.won).filter(Boolean);
  assert.equal(won.length, 6, `six jobs, six winners, got ${won.length}`);
  assert.equal(new Set(won).size, 6, 'no job handed to two workers');
  assert.deepEqual([...won].sort(), [...jobs].sort());
  for (const jobId of jobs) assert.equal(assertAccountedFor(queueDir, jobId), 'claimed');
  assert.ok(peak >= 2, `peak concurrent claims was ${peak}`);
});

test('16 threads enqueue 16 different jobs at once: no entry is lost or duplicated', async (t) => {
  const queueDir = makeDir(t);
  const { createQueue } = await import(QUEUE_URL);
  const queue = createQueue({ queueDir });
  const jobIds = Array.from({ length: 16 }, (_, i) => JOB(10 + i));

  const { results, peak } = await stampede({ count: 16, queueDir, op: 'enqueue', jobIds });
  noErrors(results);

  assert.equal(queue.stats().pending, 16);
  assert.deepEqual(queue.peek().map((e) => e.jobId).sort(), [...jobIds].sort(), 'every enqueue survived');
  // A shared sequence number between two simultaneous enqueues is tolerable --
  // there is no true arrival order between them and the jobId tiebreak makes
  // claim order total anyway -- but two entries for one job would be a render
  // billed twice.
  assertNoDuplicatePending(queueDir);
  assert.ok(peak >= 2, `peak concurrent enqueues was ${peak}`);
});

test(`${CONTENDERS} threads reap the same dead lease at once: it comes back exactly once`, async (t) => {
  const queueDir = makeDir(t);
  const { createQueue } = await import(QUEUE_URL);
  const t0 = Date.UTC(2026, 7, 20, 14, 45, 0);
  const queue = createQueue({ queueDir, leaseMs: 1000, nowImpl: () => t0 });
  queue.enqueue(JOB(1));
  const dead = queue.claim({ workerId: 'renderer-crashed' });

  // Every reaper shares one frozen clock well past the deadline, so all of them
  // see the same expired lease and go for it together.
  const { results, peak } = await stampede({
    count: CONTENDERS, queueDir, op: 'reap', leaseMs: 1000, nowMs: t0 + 60_000,
  });
  noErrors(results);

  const reported = results.flatMap((r) => r.reaped ?? []);
  assert.equal(reported.length, 1, `only the reaper that moved the job may report it, got ${reported.length}`);
  assert.equal(reported[0], JOB(1));

  // The bug this replaced left the job in NO state while still reporting
  // success, so check where it actually is, not just how many things there are.
  assert.equal(assertAccountedFor(queueDir, JOB(1)), 'pending');
  assertNoDuplicatePending(queueDir);

  const later = createQueue({ queueDir, leaseMs: 1000, nowImpl: () => t0 + 60_000 });
  assert.deepEqual(later.stats(), { pending: 1, claimed: 0, done: 0, failed: 0 }, 'one pending entry, not many');
  assert.equal(later.peek()[0].attempts, 1);
  assert.equal(later.peek()[0].jobId, JOB(1));

  // And the crashed worker's token is worthless now.
  assert.throws(() => later.complete(JOB(1), dead.token), /LEASE_LOST|holds no lease/);
  assert.ok(peak >= 2, `peak concurrent reaps was ${peak}`);
  t.diagnostic(`peak concurrent reapExpired() calls: ${peak} of ${CONTENDERS}`);
});

test(`${CONTENDERS} threads reap 8 dead leases at once: each reported once, none lost`, async (t) => {
  const queueDir = makeDir(t);
  const { createQueue } = await import(QUEUE_URL);
  const t0 = Date.UTC(2026, 7, 20, 14, 45, 0);
  const queue = createQueue({ queueDir, leaseMs: 1000, nowImpl: () => t0 });
  const jobs = [1, 2, 3, 4, 5, 6, 7, 8].map(JOB);
  for (const jobId of jobs) {
    queue.enqueue(jobId);
    queue.claim({ workerId: `renderer-${jobId}` });
  }

  // Eight locks widens every window the single-job case has, and it is the
  // shape a machine that lost power mid-batch actually leaves behind.
  const { results, peak } = await stampede({
    count: CONTENDERS, queueDir, op: 'reap', leaseMs: 1000, nowMs: t0 + 60_000,
  });
  noErrors(results);

  const reported = results.flatMap((r) => r.reaped ?? []);
  assert.deepEqual([...reported].sort(), [...jobs].sort(),
    `each of the 8 must be reported exactly once, got ${reported.length} report(s)`);

  for (const jobId of jobs) assert.equal(assertAccountedFor(queueDir, jobId), 'pending');
  assertNoDuplicatePending(queueDir);

  const later = createQueue({ queueDir, nowImpl: () => t0 + 60_000 });
  assert.deepEqual(later.stats(), { pending: 8, claimed: 0, done: 0, failed: 0 });
  assert.ok(peak >= 2, `peak concurrent reaps was ${peak}`);
});

test(`${CONTENDERS} workers start at once -- reap then claim -- and nothing is lost or doubled`, async (t) => {
  const queueDir = makeDir(t);
  const { createQueue } = await import(QUEUE_URL);
  const t0 = Date.UTC(2026, 7, 20, 14, 45, 0);
  const queue = createQueue({ queueDir, leaseMs: 1000, nowImpl: () => t0 });

  // Four jobs abandoned by a worker that died, plus two that were only ever
  // queued. This is the state a machine is in after a power cut, and
  // reapExpired() runs on EVERY worker startup, so several workers coming back
  // together hit it simultaneously.
  const abandoned = [1, 2, 3, 4].map(JOB);
  const waiting = [5, 6].map(JOB);
  for (const jobId of abandoned) {
    queue.enqueue(jobId);
    queue.claim({ workerId: 'renderer-that-died' });
  }
  for (const jobId of waiting) queue.enqueue(jobId);

  const { results, peak } = await stampede({
    count: CONTENDERS, queueDir, op: 'startup', leaseMs: 1000, nowMs: t0 + 60_000,
  });
  noErrors(results);

  const reported = results.flatMap((r) => r.reaped ?? []);
  assert.deepEqual([...reported].sort(), [...abandoned].sort(),
    'every abandoned lease reaped exactly once, by exactly one starting worker');

  const won = results.map((r) => r.won).filter(Boolean);
  assert.equal(new Set(won).size, won.length, `a job was claimed by two workers: ${won.join(', ')}`);

  // Every job, reaped or not, claimed or not, is somewhere findable.
  for (const jobId of [...abandoned, ...waiting]) assertAccountedFor(queueDir, jobId);
  assertNoDuplicatePending(queueDir);

  const later = createQueue({ queueDir, nowImpl: () => t0 + 60_000 });
  const s = later.stats();
  assert.equal(s.pending + s.claimed, 6, `all six jobs still accounted for, saw ${JSON.stringify(s)}`);
  assert.equal(s.claimed, won.length, 'one lock per winner');
  assert.ok(peak >= 2, `peak concurrent startups was ${peak}`);
  t.diagnostic(`${won.length} of 6 jobs claimed on startup; ${reported.length} leases reaped`);
});
