/**
 * Seed derivation.
 *
 * The reason this has its own file rather than three assertions inside the
 * compose tests: a seed bug is invisible until it has already cost money. Two
 * stages sharing a seed does not throw; a retry reusing a seed returns the
 * identical image and reads as "the provider ignored my request"; a seed that
 * cannot be recomputed from a manifest turns a reproducible render into an
 * anecdote. None of those surface as a red test unless someone writes the test
 * on purpose.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_KINDS, SEED_MAX, deriveSeed } from '../scripts/compose/seed.mjs';

test('the same inputs always produce the same seed', () => {
  assert.equal(deriveSeed('job-2003', 'still', 0), deriveSeed('job-2003', 'still', 0));
  assert.equal(deriveSeed('job-2003', 'motion', 7), deriveSeed('job-2003', 'motion', 7));
  // Recomputable from a manifest a year from now on another machine: the value
  // is a pure function of three recorded strings, so it can be written down.
  assert.equal(typeof deriveSeed('job-2003', 'still', 0), 'number');
});

test('every seed is a non-negative integer inside int32', () => {
  for (let i = 0; i < 500; i += 1) {
    const seed = deriveSeed(`job-${i}`, SEED_KINDS[i % SEED_KINDS.length], i);
    assert.ok(Number.isInteger(seed), `${seed} is not an integer`);
    // ffmpeg's all_seed and fal's seed both reject or mangle a negative, and a
    // signed return would push a Math.abs into every call site -- where the one
    // that forgot would fail remotely, after paying.
    assert.ok(seed >= 0 && seed <= SEED_MAX, `${seed} is outside 0..${SEED_MAX}`);
  }
});

test('kinds never collide with each other at the same index', () => {
  for (let index = 0; index < 200; index += 1) {
    const seeds = SEED_KINDS.map((kind) => deriveSeed('job-abc', kind, index));
    assert.equal(new Set(seeds).size, seeds.length,
      `two stages share a seed at index ${index}: ${JSON.stringify(seeds)}`);
  }
});

test('the delimiter makes the key unambiguous, which no amount of mixing would', () => {
  // ('job-a', 'still') and ('job', 'a-still') produce the same string under the
  // obvious `${jobId}-${kind}` key. That is a genuine collision between two
  // legitimate inputs, not a hash weakness.
  assert.notEqual(deriveSeed('job-a', 'still', 1), deriveSeed('job', 'a-still', 1));
  assert.notEqual(deriveSeed('ab', 'c', 0), deriveSeed('a', 'bc', 0));
  assert.notEqual(deriveSeed('job', 'still', 12), deriveSeed('job', 'still1', 2));
});

test('a full job of seeds contains no duplicate', () => {
  // 20 jobs x 4 kinds x 40 indices. A birthday collision in 3200 draws from
  // 2^31 is about 0.24% expected -- this is asserting the derivation is not
  // structurally degenerate, not that a 31-bit space is collision-free.
  const seen = new Map();
  const duplicates = [];
  for (let job = 0; job < 20; job += 1) {
    for (const kind of SEED_KINDS) {
      for (let index = 0; index < 40; index += 1) {
        const key = `job-${job}/${kind}/${index}`;
        const seed = deriveSeed(`job-${job}`, kind, index);
        if (seen.has(seed)) duplicates.push(`${key} collides with ${seen.get(seed)}`);
        seen.set(seed, key);
      }
    }
  }
  assert.deepEqual(duplicates, []);
});

test('consecutive indices do not produce neighbouring seeds', () => {
  // FNV-1a alone has visibly poor avalanche in the low bits, and every key here
  // shares a prefix. Without the finaliser, still 0 and still 1 land close
  // together and a provider that buckets seeds returns near-identical images.
  const a = deriveSeed('job-2003', 'still', 0);
  const b = deriveSeed('job-2003', 'still', 1);
  assert.ok(Math.abs(a - b) > 1000, `${a} and ${b} are suspiciously close`);
});

test('an unusable key part is rejected at the call rather than hashed anyway', () => {
  assert.throws(() => deriveSeed('', 'still', 0), /jobId/);
  assert.throws(() => deriveSeed('job', '', 0), /kind/);
  assert.throws(() => deriveSeed(null, 'still', 0), /jobId/);
  assert.throws(() => deriveSeed('job', 'still', -1), /non-negative integer/);
  assert.throws(() => deriveSeed('job', 'still', 1.5), /non-negative integer/);
  assert.throws(() => deriveSeed('job\u0000x', 'still', 0), /NUL/);
});

test('index defaults to 0, so a single-shot stage need not invent one', () => {
  assert.equal(deriveSeed('job', 'audio'), deriveSeed('job', 'audio', 0));
});
