/**
 * The queue, asserted against a real filesystem and a fake clock.
 *
 * The filesystem is real because the whole module is a claim about what NTFS
 * does -- a mocked `fs` here would only prove that the mock agrees with the
 * code. Every test gets its own temp directory outside the repo, so a run
 * cannot collide with `out/` or with another agent working in the tree.
 *
 * The clock is fake because lease expiry is the one behaviour that is a
 * function of time, and a test that waits fifteen real minutes to prove a lease
 * expired is a test nobody runs. `clock += ...` is the whole mechanism; there
 * is not a `setTimeout` in this file.
 *
 * The concurrency proof lives in test/queue-race.test.js -- mutual exclusion
 * cannot be demonstrated by calling a synchronous function twice in a row.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createQueue, QueueError, queuePaths } from '../scripts/queue/queue.mjs';

/** Realistic ids: `<YYYYMMDD>-<HHMMSS>-<6 hex>`, per docs/interfaces.md §1. */
const JOB_A = '20260820-144501-a3f19c';
const JOB_B = '20260820-144502-b41e07';
const JOB_C = '20260820-144503-c72d55';

const T0 = Date.UTC(2026, 7, 20, 14, 45, 0);

/** A queue in a fresh temp dir with a clock the test drives by hand. */
function makeQueue(t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-queue-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const clock = { now: T0 };
  const queue = createQueue({ queueDir: `${dir}/queue`, nowImpl: () => clock.now, ...opts });
  return { queue, clock, dir: `${dir}/queue`, P: queuePaths(null, { queueDir: `${dir}/queue` }) };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const lockFile = (P, jobId) => `${P.claimed}/${jobId}.lock`;

// --- the shape of what lands on disk ----------------------------------------

test('enqueue writes exactly one small pending entry and nothing else', (t) => {
  const { queue, P } = makeQueue(t);
  const entry = queue.enqueue(JOB_A);

  assert.equal(entry.jobId, JOB_A);
  assert.equal(entry.priority, 0);
  assert.equal(entry.attempts, 0);
  assert.equal(entry.enqueuedAt, new Date(T0).toISOString());

  const files = fs.readdirSync(P.pending);
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{12}-20260820-144501-a3f19c\.json$/);
});

test('a queue entry is a pointer, not a copy of the manifest', (t) => {
  const { queue, P } = makeQueue(t);
  queue.enqueue(JOB_A, { priority: 3 });
  const [name] = fs.readdirSync(P.pending);
  const body = readJson(`${P.pending}/${name}`);

  // If this list ever grows a `status`, a `step` or a `cost`, there are two
  // answers to "what happened to this job" and they will disagree after the
  // first crash. The manifest is the single source of truth.
  assert.deepEqual(Object.keys(body).sort(), ['attempts', 'enqueuedAt', 'jobId', 'priority', 'seq']);
});

test('the lock holds the worker id and the deadline, per docs/interfaces.md §6', (t) => {
  const { queue, clock, P } = makeQueue(t, { leaseMs: 60_000 });
  queue.enqueue(JOB_A);
  const claim = queue.claim({ workerId: 'renderer-1' });

  const lock = readJson(lockFile(P, JOB_A));
  assert.equal(lock.workerId, 'renderer-1');
  assert.equal(lock.deadline, clock.now + 60_000);
  assert.equal(lock.token, claim.token);
  assert.equal(fs.readdirSync(P.pending).length, 0, 'a claimed job is off the pending board');
});

test('a job id that is not a safe filename is refused before it touches the disk', (t) => {
  const { queue } = makeQueue(t);
  for (const bad of ['../../etc/passwd', 'a/b', 'a\\b', 'C:evil', '.hidden', 'NUL', 'UPPER', '', null]) {
    assert.throws(() => queue.enqueue(bad), (err) => err instanceof QueueError && err.code === 'BAD_JOB_ID',
      `expected ${JSON.stringify(bad)} to be refused`);
  }
});

// --- ordering ---------------------------------------------------------------

test('FIFO within a priority level, by sequence and not by timestamp', (t) => {
  const { queue } = makeQueue(t);
  // Same millisecond on the injected clock: if ordering depended on the file
  // time these would tie, which is the whole reason the sequence exists.
  queue.enqueue(JOB_A);
  queue.enqueue(JOB_B);
  queue.enqueue(JOB_C);

  assert.deepEqual(queue.peek().map((e) => e.jobId), [JOB_A, JOB_B, JOB_C]);
  assert.deepEqual(queue.peek().map((e) => e.seq), [1, 2, 3]);
  assert.equal(queue.claim({ workerId: 'w' }).jobId, JOB_A);
  assert.equal(queue.claim({ workerId: 'w' }).jobId, JOB_B);
});

test('higher priority is claimed first, and stays FIFO inside its level', (t) => {
  const { queue } = makeQueue(t);
  queue.enqueue(JOB_A, { priority: 0 });
  queue.enqueue(JOB_B, { priority: 5 });
  queue.enqueue(JOB_C, { priority: 5 });

  assert.deepEqual(queue.peek().map((e) => e.jobId), [JOB_B, JOB_C, JOB_A]);
});

test('the sequence never goes backwards, even after the queue empties', (t) => {
  const { queue } = makeQueue(t);
  queue.enqueue(JOB_A);
  const first = queue.claim({ workerId: 'w' });
  queue.complete(JOB_A, first.token);
  assert.equal(queue.stats().pending, 0);

  // Reusing sequence 1 here would put a brand new job ahead of anything that
  // had been waiting -- which is why the counter is bumped past the hint file
  // and not just past the current listing.
  assert.equal(queue.enqueue(JOB_B).seq, 2);
});

// --- claim ------------------------------------------------------------------

test('claim on an empty queue returns null rather than throwing', (t) => {
  const { queue } = makeQueue(t);
  assert.equal(queue.claim({ workerId: 'w' }), null);
});

test('a lock that already exists means somebody else won: claim returns null', (t) => {
  const { queue, P } = makeQueue(t);
  queue.enqueue(JOB_A);
  // Exactly what a competing worker's `openSync(path, 'wx')` leaves behind.
  fs.writeFileSync(lockFile(P, JOB_A), JSON.stringify({ jobId: JOB_A, workerId: 'other', token: 'x', deadline: T0 + 900_000 }));

  assert.equal(queue.claim({ workerId: 'w' }), null, 'EEXIST is the normal path, not an error');
  assert.equal(queue.stats().pending, 1, 'and the job is left where it was');
});

test('claim skips a locked job and takes the next one', (t) => {
  const { queue, P } = makeQueue(t);
  queue.enqueue(JOB_A);
  queue.enqueue(JOB_B);
  fs.writeFileSync(lockFile(P, JOB_A), JSON.stringify({ jobId: JOB_A, workerId: 'other', token: 'x', deadline: T0 + 900_000 }));

  assert.equal(queue.claim({ workerId: 'w' }).jobId, JOB_B);
});

test('claim reports the attempt count it inherited', (t) => {
  const { queue } = makeQueue(t);
  queue.enqueue(JOB_A);
  const first = queue.claim({ workerId: 'w' });
  queue.fail(JOB_A, first.token, { error: new Error('provider 503'), retriable: true });

  const second = queue.claim({ workerId: 'w' });
  assert.equal(second.attempts, 1);
  assert.notEqual(second.token, first.token, 'a new claim is a new token');
});

// --- complete ---------------------------------------------------------------

test('complete moves the job to done/ and drops the lock', (t) => {
  const { queue, P } = makeQueue(t);
  queue.enqueue(JOB_A);
  const claim = queue.claim({ workerId: 'renderer-1' });
  queue.complete(JOB_A, claim.token);

  assert.deepEqual(queue.stats(), { pending: 0, claimed: 0, done: 1, failed: 0 });
  const record = readJson(`${P.done}/${JOB_A}.json`);
  assert.equal(record.workerId, 'renderer-1');
  assert.equal(record.completedAt, new Date(T0).toISOString());
  assert.equal(fs.existsSync(lockFile(P, JOB_A)), false);
});

test('complete with the wrong token is refused', (t) => {
  const { queue } = makeQueue(t);
  queue.enqueue(JOB_A);
  queue.claim({ workerId: 'w' });

  assert.throws(() => queue.complete(JOB_A, 'not-the-token'),
    (err) => err instanceof QueueError && err.code === 'LEASE_LOST');
  assert.equal(queue.stats().done, 0);
});

test('complete on a job nobody claimed is refused', (t) => {
  const { queue } = makeQueue(t);
  queue.enqueue(JOB_A);
  assert.throws(() => queue.complete(JOB_A, 'anything'),
    (err) => err instanceof QueueError && err.code === 'LEASE_LOST');
});

// --- heartbeat --------------------------------------------------------------

test('heartbeat pushes the deadline out and keeps the reaper away', (t) => {
  const { queue, clock, P } = makeQueue(t, { leaseMs: 60_000 });
  queue.enqueue(JOB_A);
  const claim = queue.claim({ workerId: 'w' });

  clock.now += 50_000;
  const extended = queue.heartbeat(JOB_A, claim.token);
  assert.equal(extended, clock.now + 60_000);
  assert.equal(readJson(lockFile(P, JOB_A)).deadline, clock.now + 60_000);

  clock.now += 50_000; // past the ORIGINAL deadline, inside the extended one
  assert.deepEqual(queue.reapExpired(), []);
  assert.equal(queue.stats().claimed, 1);
});

test('heartbeat with the wrong token is refused', (t) => {
  const { queue } = makeQueue(t);
  queue.enqueue(JOB_A);
  queue.claim({ workerId: 'w' });
  assert.throws(() => queue.heartbeat(JOB_A, 'nope'),
    (err) => err instanceof QueueError && err.code === 'LEASE_LOST');
});

// --- fail: retriable versus terminal ----------------------------------------

test('a retriable failure goes back to pending with the attempt count raised', (t) => {
  const { queue } = makeQueue(t, { maxAttempts: 4 });
  queue.enqueue(JOB_A);
  const claim = queue.claim({ workerId: 'w' });

  const outcome = queue.fail(JOB_A, claim.token, { error: new Error('429 from provider'), retriable: true });
  assert.deepEqual(outcome, { state: 'pending', attempts: 1 });
  assert.deepEqual(queue.stats(), { pending: 1, claimed: 0, done: 0, failed: 0 });
  assert.equal(queue.peek()[0].attempts, 1);
});

test('a retriable failure keeps its priority and its original enqueue time', (t) => {
  const { queue, clock } = makeQueue(t);
  queue.enqueue(JOB_A, { priority: 7 });
  const claim = queue.claim({ workerId: 'w' });
  clock.now += 120_000;
  queue.fail(JOB_A, claim.token, { error: 'timeout', retriable: true });

  const [entry] = queue.peek();
  assert.equal(entry.priority, 7);
  assert.equal(entry.enqueuedAt, new Date(T0).toISOString(), 'a retry does not become a newer job');
});

test('past maxAttempts a retriable failure is terminal anyway', (t) => {
  const { queue, P } = makeQueue(t, { maxAttempts: 3 });
  queue.enqueue(JOB_A);

  for (let i = 1; i <= 2; i += 1) {
    const claim = queue.claim({ workerId: 'w' });
    const outcome = queue.fail(JOB_A, claim.token, { error: 'still 503', retriable: true });
    assert.deepEqual(outcome, { state: 'pending', attempts: i });
  }

  const last = queue.claim({ workerId: 'w' });
  assert.deepEqual(queue.fail(JOB_A, last.token, { error: 'still 503', retriable: true }),
    { state: 'failed', attempts: 3 });
  assert.deepEqual(queue.stats(), { pending: 0, claimed: 0, done: 0, failed: 1 });
  assert.equal(readJson(`${P.failed}/${JOB_A}.json`).error.message, 'still 503');
});

test('a terminal failure records the error and does not retry', (t) => {
  const { queue, P } = makeQueue(t);
  queue.enqueue(JOB_A);
  const claim = queue.claim({ workerId: 'renderer-1' });

  const err = Object.assign(new Error('the model refused the prompt'), { code: 'MODERATION_REFUSED' });
  assert.deepEqual(queue.fail(JOB_A, claim.token, { error: err, retriable: false }), { state: 'failed', attempts: 1 });

  const record = readJson(`${P.failed}/${JOB_A}.json`);
  assert.deepEqual(record.error, {
    message: 'the model refused the prompt',
    code: 'MODERATION_REFUSED',
    retriable: false,
  });
  // No stack, no provider body: `out/jobs/<jobId>/` is the dead letter you open.
  assert.deepEqual(Object.keys(record.error).sort(), ['code', 'message', 'retriable']);
  assert.equal(queue.stats().pending, 0);
});

test('fail with the wrong token is refused and changes nothing', (t) => {
  const { queue } = makeQueue(t);
  queue.enqueue(JOB_A);
  queue.claim({ workerId: 'w' });
  assert.throws(() => queue.fail(JOB_A, 'nope', { error: 'x', retriable: true }),
    (err) => err instanceof QueueError && err.code === 'LEASE_LOST');
  assert.deepEqual(queue.stats(), { pending: 0, claimed: 1, done: 0, failed: 0 });
});

// --- release ----------------------------------------------------------------

test('release hands the job back without burning an attempt', (t) => {
  const { queue } = makeQueue(t);
  queue.enqueue(JOB_A);
  const first = queue.claim({ workerId: 'w' });
  queue.fail(JOB_A, first.token, { error: 'blip', retriable: true });

  const second = queue.claim({ workerId: 'w' });
  assert.equal(second.attempts, 1);
  queue.release(JOB_A, second.token); // SIGTERM: shutting down cleanly is not a failure

  assert.deepEqual(queue.stats(), { pending: 1, claimed: 0, done: 0, failed: 0 });
  assert.equal(queue.peek()[0].attempts, 1, 'still 1, not 2');
});

// --- leases and reaping -----------------------------------------------------

test('a live lease is not reaped', (t) => {
  const { queue, clock } = makeQueue(t, { leaseMs: 900_000 });
  queue.enqueue(JOB_A);
  queue.claim({ workerId: 'w' });

  clock.now += 899_999;
  assert.deepEqual(queue.reapExpired(), []);
  assert.equal(queue.claim({ workerId: 'other' }), null, 'and nobody else can take it');
});

test('a dead lease goes back to pending and the zombie can no longer complete it', (t) => {
  const { queue, clock } = makeQueue(t, { leaseMs: 900_000 });
  queue.enqueue(JOB_A);
  const dead = queue.claim({ workerId: 'renderer-crashed' });

  clock.now += 900_001;
  assert.deepEqual(queue.reapExpired(), [JOB_A], 'reap reports what it moved');
  assert.deepEqual(queue.stats(), { pending: 1, claimed: 0, done: 0, failed: 0 });

  const fresh = queue.claim({ workerId: 'renderer-2' });
  assert.equal(fresh.jobId, JOB_A);
  assert.equal(fresh.attempts, 1, 'a reap costs an attempt, or a job that kills workers loops forever');

  // The zombie wakes up. It must not be able to mark done a job that
  // renderer-2 is rendering right now.
  assert.throws(() => queue.complete(JOB_A, dead.token),
    (err) => err instanceof QueueError && err.code === 'LEASE_LOST');
  assert.throws(() => queue.heartbeat(JOB_A, dead.token),
    (err) => err instanceof QueueError && err.code === 'LEASE_LOST');
  assert.throws(() => queue.fail(JOB_A, dead.token, { error: 'x', retriable: true }),
    (err) => err instanceof QueueError && err.code === 'LEASE_LOST');
  assert.equal(queue.stats().done, 0, 'nothing the zombie did was recorded');

  // And the live holder still owns it.
  queue.complete(JOB_A, fresh.token);
  assert.deepEqual(queue.stats(), { pending: 0, claimed: 0, done: 1, failed: 0 });
});

test('a job that expires its lease maxAttempts times ends in failed/, not in a loop', (t) => {
  const { queue, clock, P } = makeQueue(t, { leaseMs: 1000, maxAttempts: 3 });
  queue.enqueue(JOB_A);

  for (let i = 1; i <= 3; i += 1) {
    assert.equal(queue.claim({ workerId: `w${i}` }).jobId, JOB_A);
    clock.now += 1001;
    assert.deepEqual(queue.reapExpired(), [JOB_A]);
  }

  assert.deepEqual(queue.stats(), { pending: 0, claimed: 0, done: 0, failed: 1 });
  const record = readJson(`${P.failed}/${JOB_A}.json`);
  assert.equal(record.error.code, 'LEASE_EXPIRED');
  assert.equal(record.attempts, 3);
});

test('a lock that cannot be read is treated as dead rather than left forever', (t) => {
  const { queue, P } = makeQueue(t);
  queue.enqueue(JOB_A);
  queue.claim({ workerId: 'w' });
  fs.writeFileSync(lockFile(P, JOB_A), 'this is not json');

  assert.deepEqual(queue.reapExpired(), [JOB_A]);
  assert.equal(queue.stats().pending, 1);
});

test('reapExpired is idempotent and reports nothing on a healthy queue', (t) => {
  const { queue, clock } = makeQueue(t, { leaseMs: 1000 });
  queue.enqueue(JOB_A);
  queue.claim({ workerId: 'w' });
  clock.now += 2000;

  assert.deepEqual(queue.reapExpired(), [JOB_A]);
  assert.deepEqual(queue.reapExpired(), [], 'a second pass has nothing to do');
  assert.equal(queue.stats().pending, 1, 'and did not duplicate the entry');
});

test('a crash between "write the new state" and "drop the lock" heals on the next reap', (t) => {
  const { queue, clock, P } = makeQueue(t, { leaseMs: 1000 });
  queue.enqueue(JOB_A);
  const claim = queue.claim({ workerId: 'w' });

  // Exactly the on-disk state a kill -9 between those two writes leaves: the
  // job is back in pending AND the lock is still there.
  fs.writeFileSync(`${P.pending}/${'2'.padStart(12, '0')}-${JOB_A}.json`,
    JSON.stringify({ jobId: JOB_A, seq: 2, priority: 0, enqueuedAt: new Date(T0).toISOString(), attempts: 1 }));
  assert.equal(fs.existsSync(lockFile(P, JOB_A)), true);

  clock.now += 2000;
  queue.reapExpired();
  assert.equal(queue.stats().claimed, 0, 'the orphan lock is gone');

  const got = queue.claim({ workerId: 'w2' });
  assert.equal(got.jobId, JOB_A);
  assert.equal(queue.stats().pending, 0, 'and the duplicate entry was swept, so it is not claimed twice');
  assert.notEqual(got.token, claim.token);
});

// --- enqueue idempotence and resume -----------------------------------------

test('enqueueing a job that is already pending returns the existing entry', (t) => {
  const { queue } = makeQueue(t);
  const first = queue.enqueue(JOB_A, { priority: 2 });
  const second = queue.enqueue(JOB_A, { priority: 9 });

  assert.deepEqual(second, first, 'a retried POST must not put the same render on the board twice');
  assert.equal(queue.stats().pending, 1);
});

test('enqueueing a job someone is rendering right now is refused', (t) => {
  const { queue } = makeQueue(t);
  queue.enqueue(JOB_A);
  queue.claim({ workerId: 'renderer-1' });

  assert.throws(() => queue.enqueue(JOB_A),
    (err) => err instanceof QueueError && err.code === 'ALREADY_CLAIMED');
});

test('a failed job can be enqueued again -- failed/ IS the dead letter', (t) => {
  const { queue, P } = makeQueue(t);
  queue.enqueue(JOB_A);
  const claim = queue.claim({ workerId: 'w' });
  queue.fail(JOB_A, claim.token, { error: 'bad prompt', retriable: false });
  assert.equal(queue.stats().failed, 1);

  const again = queue.enqueue(JOB_A);
  assert.equal(again.attempts, 0, 'a human asking for another go means attempt zero');
  assert.deepEqual(queue.stats(), { pending: 1, claimed: 0, done: 0, failed: 0 });
  assert.equal(fs.existsSync(`${P.failed}/${JOB_A}.json`), false, 'the stale failure record is cleared');
});

test('a done job can be enqueued again -- this is the select-then-resume path', (t) => {
  const { queue } = makeQueue(t);
  queue.enqueue(JOB_A);
  const claim = queue.claim({ workerId: 'w' });
  queue.complete(JOB_A, claim.token); // stopped at `select`, awaiting a human

  queue.enqueue(JOB_A, { priority: 1 }); // POST /api/jobs/:id/select re-enqueues
  assert.deepEqual(queue.stats(), { pending: 1, claimed: 0, done: 0, failed: 0 });
  assert.equal(queue.peek()[0].priority, 1);
});

// --- inspection -------------------------------------------------------------

test('stats counts every state', (t) => {
  const { queue } = makeQueue(t);
  queue.enqueue(JOB_A);
  queue.enqueue(JOB_B);
  queue.enqueue(JOB_C);

  const a = queue.claim({ workerId: 'w' });
  queue.complete(JOB_A, a.token);
  const b = queue.claim({ workerId: 'w' });
  queue.fail(JOB_B, b.token, { error: 'no', retriable: false });
  queue.claim({ workerId: 'w' });

  assert.deepEqual(queue.stats(), { pending: 0, claimed: 1, done: 1, failed: 1 });
});

test('peek shows the other states, and flags a lease that has run out', (t) => {
  const { queue, clock } = makeQueue(t, { leaseMs: 1000 });
  queue.enqueue(JOB_A);
  queue.claim({ workerId: 'renderer-1' });

  let [row] = queue.peek({ state: 'claimed' });
  assert.equal(row.workerId, 'renderer-1');
  assert.equal(row.expired, false);

  clock.now += 2000;
  [row] = queue.peek({ state: 'claimed' });
  assert.equal(row.expired, true, 'this is what queue-cli stats warns about');

  assert.throws(() => queue.peek({ state: 'nonsense' }),
    (err) => err instanceof QueueError && err.code === 'BAD_STATE');
});

test('peek honours a limit and never mutates', (t) => {
  const { queue } = makeQueue(t);
  queue.enqueue(JOB_A);
  queue.enqueue(JOB_B);
  assert.equal(queue.peek({ limit: 1 }).length, 1);
  assert.deepEqual(queue.stats(), { pending: 2, claimed: 0, done: 0, failed: 0 });
});

test('drain takes pending work off the board reversibly and leaves renders running', (t) => {
  const { queue, P } = makeQueue(t);
  queue.enqueue(JOB_A);
  queue.enqueue(JOB_B);
  queue.claim({ workerId: 'renderer-1' }); // JOB_A is now in flight

  assert.deepEqual(queue.drain({ reason: 'maintenance' }), [JOB_B]);
  assert.deepEqual(queue.stats(), { pending: 0, claimed: 1, done: 0, failed: 1 });
  assert.equal(readJson(`${P.failed}/${JOB_B}.json`).error.code, 'DRAINED');

  queue.enqueue(JOB_B); // reversible: the id is all you need
  assert.equal(queue.stats().pending, 1);
});

// --- durability -------------------------------------------------------------

test('deleting out/queue mid-flight heals instead of crashing the worker', (t) => {
  const { queue, dir } = makeQueue(t);
  queue.enqueue(JOB_A);
  fs.rmSync(dir, { recursive: true, force: true });

  // The manifests in out/jobs/ are untouched, so nothing is actually lost --
  // this only proves the module does not need its own directories to exist.
  assert.deepEqual(queue.stats(), { pending: 0, claimed: 0, done: 0, failed: 0 });
  assert.equal(queue.claim({ workerId: 'w' }), null);
  assert.equal(queue.enqueue(JOB_A).jobId, JOB_A);
  assert.equal(queue.stats().pending, 1);
});

test('a stray file in pending/ is ignored rather than fatal', (t) => {
  const { queue, P } = makeQueue(t);
  queue.enqueue(JOB_A);
  fs.writeFileSync(`${P.pending}/notes.txt`, 'someone left this here');
  fs.writeFileSync(`${P.pending}/000000000009-not a job id.json`, '{}');
  fs.writeFileSync(`${P.pending}/000000000010-20260820-144502-b41e07.json`, 'half-written {');

  assert.equal(queue.stats().pending, 1);
  assert.equal(queue.peek().length, 1, 'stats and peek must never disagree');
  assert.equal(queue.claim({ workerId: 'w' }).jobId, JOB_A);
});

test('nowImpl is the only clock, and a Date-returning impl works too', (t) => {
  const { queue: dateQueue } = makeQueue(t, { nowImpl: () => new Date(T0) });
  const entry = dateQueue.enqueue(JOB_A);
  assert.equal(entry.enqueuedAt, new Date(T0).toISOString());

  const { queue: broken } = makeQueue(t, { nowImpl: () => 'half past four' });
  assert.throws(() => broken.enqueue(JOB_B), (err) => err instanceof QueueError && err.code === 'BAD_CLOCK');
});

test('createQueue refuses a lease or an attempt budget that cannot work', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-queue-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => createQueue({ queueDir: dir, leaseMs: 0 }),
    (err) => err instanceof QueueError && err.code === 'BAD_CONFIG');
  assert.throws(() => createQueue({ queueDir: dir, maxAttempts: 0 }),
    (err) => err instanceof QueueError && err.code === 'BAD_CONFIG');
});

test('queuePaths puts the queue beside out/jobs, and queueDir overrides it', () => {
  assert.equal(queuePaths('C:/repo').dir, 'C:/repo/out/queue');
  assert.equal(queuePaths('C:/repo/').pending, 'C:/repo/out/queue/pending');
  assert.equal(queuePaths('C:/repo', { queueDir: 'D:/tmp/q' }).claimed, 'D:/tmp/q/claimed');
});

// --- reap: the paths that only a second reaper can reach ---------------------

test('a reap whose destination already exists repairs the lock without reporting it', (t) => {
  const { queue, clock, P } = makeQueue(t, { leaseMs: 1000 });
  queue.enqueue(JOB_A);
  const claim = queue.claim({ workerId: 'renderer-crashed' });
  clock.now += 2000;

  // Exactly what a reaper that died between its create and its unlink leaves:
  // the entry is already back at the sequence the lock was claimed from, and
  // the dead lock is still sitting there.
  fs.writeFileSync(`${P.pending}/${String(claim.seq).padStart(12, '0')}-${JOB_A}.json`,
    JSON.stringify({ jobId: JOB_A, seq: claim.seq, priority: 0, enqueuedAt: new Date(T0).toISOString(), attempts: 1 }));

  assert.deepEqual(queue.reapExpired(), [],
    'this call moved nothing, so it must not claim to have moved anything');
  assert.equal(fs.existsSync(lockFile(P, JOB_A)), false, 'but it still finishes the repair');
  assert.deepEqual(queue.stats(), { pending: 1, claimed: 0, done: 0, failed: 0 });
  assert.equal(queue.claim({ workerId: 'w' }).jobId, JOB_A, 'and the job runs again');
});

test('a reaped job keeps its place in the queue, where a failed one goes to the back', (t) => {
  const { queue, clock } = makeQueue(t, { leaseMs: 1000 });
  queue.enqueue(JOB_A);
  queue.enqueue(JOB_B);
  const first = queue.claim({ workerId: 'renderer-crashed' });
  assert.equal(first.jobId, JOB_A);
  assert.equal(first.seq, 1);

  clock.now += 2000;
  assert.deepEqual(queue.reapExpired(), [JOB_A]);

  // Reusing the claimed sequence is what makes the reap's destination
  // deterministic, and therefore what makes exactly one reaper able to create
  // it. The fairness falls out of that and happens to be right: a worker dying
  // is not the job's fault.
  assert.deepEqual(queue.peek().map((e) => [e.jobId, e.seq]), [[JOB_A, 1], [JOB_B, 2]]);

  // A job that errored is different -- it yields its place, so one poisonous
  // job cannot hold up everything behind it.
  const b = queue.claim({ workerId: 'w' });
  assert.equal(b.jobId, JOB_A);
  queue.fail(JOB_A, b.token, { error: 'provider 503', retriable: true });
  assert.deepEqual(queue.peek().map((e) => e.jobId), [JOB_B, JOB_A]);
});

test('a corrupt lock reaps to the front, at a sequence allocateSeq never issues', (t) => {
  const { queue, P } = makeQueue(t);
  queue.enqueue(JOB_A);
  queue.claim({ workerId: 'w' });
  queue.enqueue(JOB_B);
  fs.writeFileSync(lockFile(P, JOB_A), 'not json, and no sequence to recover');

  assert.deepEqual(queue.reapExpired(), [JOB_A]);
  // Sequence 0 is deterministic -- so two reapers still agree on one filename
  // and only one of them can create it -- and it cannot collide, because
  // allocateSeq starts at 1.
  assert.deepEqual(queue.peek().map((e) => [e.jobId, e.seq]), [[JOB_A, 0], [JOB_B, 2]]);
});
