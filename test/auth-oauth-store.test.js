import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { putVerifier, takeVerifier, sweepOAuth } from '../scripts/auth/oauth-store.mjs';

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
