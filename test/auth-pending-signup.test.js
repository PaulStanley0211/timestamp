/**
 * `putPending` / `takePending` / `sweepPending` -- where consent waits for the
 * confirmation code to be typed. Task 6.
 *
 * With email confirmation on, `createAccount` (and the consent write it
 * performs) does not run at signup -- it runs when the six-digit code is
 * entered, which may be minutes or days later. The consent box was ticked on
 * the signup form, so something has to hold that agreement across the gap.
 * This is that module, and its shape mirrors oauth-store.mjs on purpose: a
 * tmp+rename write, a read-and-delete take, a TTL, and a sweep that counts
 * only what it actually removed.
 *
 * `CONSENT` is built through the real `recordConsent`, not hand-shaped, per
 * the ruling in the task brief: a fixture with `agreedAt` instead of `at`, or
 * without `granted: true`, is the exact trap an earlier task already hit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { putPending, takePending, sweepPending, PENDING_DIR } from '../scripts/auth/pending-signup.mjs';
import { emailHash } from '../scripts/auth/accounts.mjs';
import { recordConsent } from '../scripts/safety/consent.mjs';

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ts-pending-'));
const CONSENT = recordConsent({ granted: true, text: 'test consent' });

test('consent survives the gap between signup and code entry', (t) => {
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  putPending({ root, email: 'Gap@Example.com ', consent: CONSENT });
  // Normalisation happens inside, so the lookup does not have to match casing.
  assert.deepEqual(takePending({ root, email: 'gap@example.com' }), { consent: CONSENT });
});

test('a consumed pending signup does not come back', (t) => {
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  putPending({ root, email: 'once@example.com', consent: CONSENT });
  takePending({ root, email: 'once@example.com' });
  assert.equal(takePending({ root, email: 'once@example.com' }), null);
});

test('an expired pending signup is null, so the person is asked once instead', (t) => {
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  let now = new Date('2026-08-26T10:00:00.000Z');
  putPending({ root, email: 'stale@example.com', consent: CONSENT, ttlMs: 1000, nowImpl: () => now });
  now = new Date('2026-08-27T10:00:00.000Z');
  assert.equal(takePending({ root, email: 'stale@example.com', nowImpl: () => now }), null);
});

test('an unknown email is null, not an error', (t) => {
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(takePending({ root, email: 'never-signed-up@example.com' }), null);
});

test('sweepPending removes expired rows and reports how many', (t) => {
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  let now = new Date('2026-08-26T10:00:00.000Z');
  putPending({ root, email: 'a@example.com', consent: CONSENT, ttlMs: 60_000, nowImpl: () => now });
  putPending({ root, email: 'b@example.com', consent: CONSENT, ttlMs: 3_600_000, nowImpl: () => now });
  now = new Date('2026-08-26T10:05:00.000Z');
  assert.equal(sweepPending({ root, nowImpl: () => now }), 1);
  assert.ok(takePending({ root, email: 'b@example.com', nowImpl: () => now }));
});

test('sweepPending survives rows disappearing mid-sweep and still counts only real removals', (t) => {
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  let now = new Date('2026-08-26T10:00:00.000Z');
  // 'gone' and 'expired' both expire immediately; 'fresh' does not. Filenames
  // are opaque email hashes rather than readable names, so the row to delete
  // is targeted by computing its hash directly rather than by picking an
  // arbitrary entry out of readdir's unordered listing.
  putPending({ root, email: 'gone@example.com', consent: CONSENT, ttlMs: 1, nowImpl: () => now });
  putPending({ root, email: 'expired@example.com', consent: CONSENT, ttlMs: 1, nowImpl: () => now });
  putPending({ root, email: 'fresh@example.com', consent: CONSENT, ttlMs: 1_000_000, nowImpl: () => now });

  now = new Date('2026-08-26T10:00:01.000Z');

  const dir = path.join(root, PENDING_DIR);
  const goneFile = path.join(dir, `${emailHash('gone@example.com')}.json`);
  assert.ok(fs.existsSync(goneFile), 'precondition: the row exists before it disappears');
  // Simulate a concurrent delete of one expired row before this sweep gets to it.
  fs.unlinkSync(goneFile);

  const removed = sweepPending({ root, nowImpl: () => now });
  assert.equal(removed, 1, '"expired" is the only row this sweep actually removes -- '
    + '"gone" was already gone and must not be double-counted');
  assert.ok(takePending({ root, email: 'fresh@example.com', nowImpl: () => now }),
    'the row that was never expired must survive the sweep');
});

test('a malformed JSON file is deleted when read via takePending', (t) => {
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  putPending({ root, email: 'garbage@example.com', consent: CONSENT });
  const dir = path.join(root, PENDING_DIR);
  const [file] = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  const full = path.join(dir, file);
  fs.writeFileSync(full, 'not json at all', 'utf8');

  assert.equal(takePending({ root, email: 'garbage@example.com' }), null);
  assert.equal(fs.existsSync(full), false, 'garbage file should be deleted');
});

test('consent never carries a Supabase field -- it is a record of an agreement with this service', () => {
  assert.deepEqual(Object.keys(CONSENT).sort(), ['at', 'granted', 'text']);
});
