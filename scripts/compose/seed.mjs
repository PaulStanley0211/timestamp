/**
 * Seeds. One pure function, no imports, no state.
 *
 * A seed is the only thing in this pipeline that makes a paid, non-deterministic
 * remote call reproducible, so the requirement is not "some number" -- it is a
 * number that can be recomputed from the manifest a year later on a different
 * machine with a different Node version. That rules out Math.random (obviously),
 * Date.now (obviously), and also a counter held in a job object (less obviously:
 * a retry, a resumed job, or a second still requested after the first batch was
 * reviewed all restart the counter and silently reuse a seed, so the retry
 * returns the identical image and looks like the provider ignored it).
 *
 * Deriving instead of storing makes the seed a pure function of three things
 * that are already recorded: which job, which stage, which index.
 *
 * WHY THE KIND IS PART OF THE KEY. Still 1 and motion segment 1 of the same job
 * must not share a seed. They go to different models so a collision is not
 * fatal, but it is the kind of coincidence that produces an hour of debugging
 * when two stages of one job return suspiciously similar framing, and it costs
 * one string to remove entirely.
 *
 * WHY THE DELIMITER IS NUL. The naive key `${jobId}-${kind}-${index}` is
 * ambiguous: ('job-a', 'still', 1) and ('job', 'a-still', 1) produce the same
 * string and therefore the same seed. That is a real collision between two
 * legitimate inputs, not a hash weakness, and no amount of avalanche fixes it.
 * A NUL byte cannot appear in a job id or a kind -- both are validated here --
 * so the encoding is unambiguous by construction. There is a test for exactly
 * this pair.
 *
 * WHY FNV-1a PLUS A FINALISER, RATHER THAN node:crypto. Not for speed. FNV-1a
 * alone has visibly poor avalanche in the low bits, and the low bits are what a
 * `% n` in some future caller would take; the MurmurHash3 finaliser fixes that
 * for four lines. Choosing it over sha256 keeps this module import-free, which
 * is what lets the purity test assert that the file contains no `import`
 * statement at all rather than reasoning about whether a dependency is pure.
 *
 * WHY THE RESULT IS NON-NEGATIVE. "int32" in the sense that matters downstream:
 * every consumer -- ffmpeg's `all_seed`, fal's `seed` -- takes a non-negative
 * integer and either rejects or silently mangles a negative one. Returning a
 * signed value would push a `Math.abs` into every call site, and the one call
 * site that forgot would fail at the provider, remotely, after paying.
 */

/** 2^31 - 1. The top of the range every downstream consumer accepts. */
export const SEED_MAX = 2147483647;

/** The one character that cannot appear in a job id or a stage name, which is
 *  the entire reason it can separate them unambiguously. */
const DELIMITER = '\u0000';

/** The stages that derive seeds today. Not enforced -- a later milestone adding
 *  a kind should not have to edit this file -- but exported so the CLI and the
 *  tests agree on the spelling, which is the actual failure mode. */
export const SEED_KINDS = Object.freeze(['still', 'motion', 'audio', 'stamp']);

function requireKeyPart(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  if (value.includes(DELIMITER)) {
    throw new TypeError(`${name} must not contain a NUL byte -- it is the key delimiter`);
  }
  return value;
}

/**
 * @param {string} jobId  the job directory name; already unique per run
 * @param {string} kind   'still' | 'motion' | 'audio' | 'stamp' | ...
 * @param {number} index  0-based within the kind
 * @returns {number} an integer in 0..2147483647
 */
export function deriveSeed(jobId, kind, index = 0) {
  requireKeyPart(jobId, 'jobId');
  requireKeyPart(kind, 'kind');
  if (!Number.isInteger(index) || index < 0) {
    throw new TypeError(`index must be a non-negative integer, got ${JSON.stringify(index)}`);
  }

  const key = [jobId, kind, index].join(DELIMITER);

  // FNV-1a, 32-bit. Math.imul keeps the multiply in int32 instead of drifting
  // into float territory above 2^53, which is where a hand-rolled `h * 16777619`
  // quietly stops being FNV at all.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }

  // MurmurHash3 fmix32. FNV-1a's low bits correlate strongly for keys that
  // share a prefix -- which every key here does, since they all start with the
  // same jobId -- and this is what decorrelates them.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;

  // >>> 1 rather than a modulo: it takes the top 31 bits, which the finaliser
  // has already mixed, and introduces no modulo bias.
  return (h >>> 0) >>> 1;
}
