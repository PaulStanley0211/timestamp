import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { putVerifier, takeVerifier, sweepOAuth, OAUTH_DIR } from '../scripts/auth/oauth-store.mjs';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ts-oauth-'));
}

test('a verifier comes back exactly once', () => {
  const root = tmpRoot();
  putVerifier({ root, state: 'st1', verifier: 'v1', next: '/shelf' });
  assert.deepEqual(takeVerifier({ root, state: 'st1' }), { verifier: 'v1', next: '/shelf' });
  assert.equal(takeVerifier({ root, state: 'st1' }), null, 'replay must not succeed');
});

test('an unknown state is null, not an error', () => {
  const root = tmpRoot();
  assert.equal(takeVerifier({ root, state: 'never-issued' }), null);
});

test('an expired verifier is refused and not returned late', () => {
  const root = tmpRoot();
  let now = new Date('2026-08-26T10:00:00.000Z');
  putVerifier({ root, state: 'st2', verifier: 'v2', ttlMs: 60_000, nowImpl: () => now });
  now = new Date('2026-08-26T10:05:00.000Z');
  assert.equal(takeVerifier({ root, state: 'st2', nowImpl: () => now }), null);
});

test('sweep removes expired rows and reports how many', () => {
  const root = tmpRoot();
  let now = new Date('2026-08-26T10:00:00.000Z');
  putVerifier({ root, state: 'a', verifier: 'v', ttlMs: 60_000, nowImpl: () => now });
  putVerifier({ root, state: 'b', verifier: 'v', ttlMs: 3_600_000, nowImpl: () => now });
  now = new Date('2026-08-26T10:05:00.000Z');
  assert.equal(sweepOAuth({ root, nowImpl: () => now }), 1);
  assert.ok(takeVerifier({ root, state: 'b', nowImpl: () => now }));
});

test('a malformed JSON file is deleted when read via takeVerifier', () => {
  const root = tmpRoot();
  const dir = path.join(root, OAUTH_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'garbage.json');
  fs.writeFileSync(file, 'not json at all', 'utf8');
  assert.equal(takeVerifier({ root, state: 'garbage' }), null);
  assert.equal(fs.existsSync(file), false, 'garbage file should be deleted');
});

test('sweepOAuth survives rows disappearing or being unreadable mid-sweep', () => {
  const root = tmpRoot();
  let now = new Date('2026-08-26T10:00:00.000Z');
  putVerifier({ root, state: 'a', verifier: 'v', ttlMs: 1, nowImpl: () => now });
  putVerifier({ root, state: 'b', verifier: 'v', ttlMs: 1, nowImpl: () => now });
  putVerifier({ root, state: 'c', verifier: 'v', ttlMs: 1_000_000, nowImpl: () => now });

  now = new Date('2026-08-26T10:00:01.000Z');

  const dir = path.join(root, OAUTH_DIR);
  // Simulate a concurrent delete of 'a' by removing it before sweep processes it
  fs.unlinkSync(path.join(dir, 'a.json'));

  // sweep should not crash even though 'a' is gone, and should report only 'b' as removed
  const removed = sweepOAuth({ root, nowImpl: () => now });
  assert.equal(removed, 1, 'should count only b as successfully removed, not crash on missing a');
});
