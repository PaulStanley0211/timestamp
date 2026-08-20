/**
 * The segment plan, and the frame that joins one segment to the next.
 *
 * The assertion this file exists for is the sum. 25fps x 15s is 375 frames, and
 * "exactly 15.000 seconds" is checked against the finished file by
 * `assertDeliveryContract` -- so a plan that sums to anything else is either
 * paid-for footage thrown away (too long) or a visible loop (too short, because
 * the tape stage runs `-stream_loop -1`). Neither shows up as an error, which
 * is why the sum is asserted for EVERY plausible clip cap rather than for the
 * one the fixture happens to declare.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { planSegments, describePlan, PlanError } from '../scripts/animate/plan.mjs';
import { lastFrameArgs, lastFrameName } from '../scripts/animate/lastframe.mjs';
import { deriveSeed } from '../scripts/compose/seed.mjs';

const cfg = { durationSeconds: 15, fps: 25, totalFrames: 375, encode: { filterComplexThreads: 1 } };
const caps = (maxClipSeconds) => ({ maxClipSeconds });
const JOB = '20260820-144501-a3f19c';

// ---------------------------------------------------------------------------
// the sum
// ---------------------------------------------------------------------------

test('planSegments sums to exactly durationSeconds for every clip cap 3..15', () => {
  for (let max = 3; max <= 15; max += 1) {
    const segments = planSegments({ cfg, capabilities: caps(max), jobId: JOB });
    const sum = segments.reduce((n, s) => n + s.seconds, 0);
    assert.equal(sum, cfg.durationSeconds, `maxClipSeconds=${max} summed to ${sum}s`);
    assert.ok(segments.every((s) => s.seconds <= max), `maxClipSeconds=${max} produced an over-long segment`);
    assert.ok(segments.every((s) => s.seconds >= 1), `maxClipSeconds=${max} produced an empty segment`);
  }
});

test('the frame counts sum to totalFrames, which is the number actually asserted', () => {
  for (let max = 3; max <= 15; max += 1) {
    const segments = planSegments({ cfg, capabilities: caps(max), jobId: JOB });
    assert.equal(segments.reduce((n, s) => n + s.frames, 0), cfg.totalFrames);
  }
});

test('a cap of 8 is 8 + 7, not 8 + 8 trimmed', () => {
  const segments = planSegments({ cfg, capabilities: caps(8), jobId: JOB });
  assert.deepEqual(segments.map((s) => s.seconds), [8, 7]);
});

test('the remainder is spread one second at a time, never dumped on one segment', () => {
  // 15 over a cap of 4 is four calls. 4+4+4+3 keeps every take within a second
  // of every other; 4+4+4+2+1 would buy a one-second clip nobody can use.
  assert.deepEqual(planSegments({ cfg, capabilities: caps(4), jobId: JOB }).map((s) => s.seconds), [4, 4, 4, 3]);
  assert.deepEqual(planSegments({ cfg, capabilities: caps(6), jobId: JOB }).map((s) => s.seconds), [5, 5, 5]);
  assert.deepEqual(planSegments({ cfg, capabilities: caps(3), jobId: JOB }).map((s) => s.seconds), [3, 3, 3, 3, 3]);
});

test('a cap at or above the whole duration is one call', () => {
  for (const max of [15, 16, 30]) {
    const segments = planSegments({ cfg, capabilities: caps(max), jobId: JOB });
    assert.equal(segments.length, 1);
    assert.equal(segments[0].seconds, 15);
  }
});

test('a fractional cap floors rather than rounds -- 7.5 means seven whole seconds are safe', () => {
  const segments = planSegments({ cfg, capabilities: caps(7.5), jobId: JOB });
  assert.ok(segments.every((s) => s.seconds <= 7), 'floored the cap upward, which fails at the provider');
  assert.equal(segments.reduce((n, s) => n + s.seconds, 0), 15);
});

// ---------------------------------------------------------------------------
// indices, seeds and the join
// ---------------------------------------------------------------------------

test('indices are 1-based and contiguous, matching seg-01.mp4', () => {
  const segments = planSegments({ cfg, capabilities: caps(4), jobId: JOB });
  assert.deepEqual(segments.map((s) => s.index), [1, 2, 3, 4]);
});

test('seeds come from deriveSeed(jobId, motion, i) and nowhere else', () => {
  const segments = planSegments({ cfg, capabilities: caps(8), jobId: JOB });
  assert.equal(segments[0].seed, deriveSeed(JOB, 'motion', 0));
  assert.equal(segments[1].seed, deriveSeed(JOB, 'motion', 1));
  // Same job id, same plan, forever. Two calls a millisecond apart must agree,
  // which is the whole reason nothing here reads a clock.
  assert.deepEqual(planSegments({ cfg, capabilities: caps(8), jobId: JOB }), segments);
});

test('two different jobs get different seeds, because they are different renders', () => {
  const a = planSegments({ cfg, capabilities: caps(8), jobId: JOB });
  const b = planSegments({ cfg, capabilities: caps(8), jobId: '20260820-144502-000000' });
  assert.notEqual(a[0].seed, b[0].seed);
});

test('without a job id the seeds are null, so a preview can never be mistaken for a plan', () => {
  const segments = planSegments({ cfg, capabilities: caps(8) });
  assert.ok(segments.every((s) => s.seed === null));
});

test('continuous mode starts segment 1 from the still and every later one from the last frame', () => {
  const segments = planSegments({ cfg, capabilities: caps(4), jobId: JOB });
  assert.deepEqual(segments.map((s) => s.startsFrom), ['still', 'lastFrame', 'lastFrame', 'lastFrame']);
});

test('cut mode is the one branch, and it starts every segment from the still', () => {
  const segments = planSegments({ cfg, capabilities: caps(4), jobId: JOB, mode: 'cut' });
  assert.deepEqual(segments.map((s) => s.startsFrom), ['still', 'still', 'still', 'still']);
});

// ---------------------------------------------------------------------------
// refusals
// ---------------------------------------------------------------------------

test('a cap that floors to zero is refused rather than looped forever', () => {
  assert.throws(() => planSegments({ cfg, capabilities: caps(0.5), jobId: JOB }), (err) => {
    assert.ok(err instanceof PlanError);
    assert.equal(err.code, 'CLIP_TOO_SHORT');
    return true;
  });
});

test('a missing or nonsense capability is refused by name', () => {
  for (const bad of [undefined, null, 0, -3, 'eight']) {
    assert.throws(() => planSegments({ cfg, capabilities: { maxClipSeconds: bad }, jobId: JOB }), /maxClipSeconds/);
  }
});

test('a fractional duration is refused, because the split is in whole seconds', () => {
  assert.throws(
    () => planSegments({ cfg: { ...cfg, durationSeconds: 15.5 }, capabilities: caps(8), jobId: JOB }),
    /durationSeconds/,
  );
});

test('an unknown mode is refused', () => {
  assert.throws(() => planSegments({ cfg, capabilities: caps(8), jobId: JOB, mode: 'montage' }), /mode must be/);
});

test('describePlan reads as an operator would say it', () => {
  assert.equal(describePlan(planSegments({ cfg, capabilities: caps(8), jobId: JOB })), '2 segment(s): 8s + 7s = 15s');
});

// ---------------------------------------------------------------------------
// the last frame
// ---------------------------------------------------------------------------

test('lastFrameArgs takes the LAST frame of the tail, not the first', () => {
  const args = lastFrameArgs({ input: 'seg-01.mp4', output: 'seg-01-last.png', cfg });
  assert.ok(args.includes('-sseof'), 'no tail seek: the whole clip would be decoded');
  assert.ok(args.includes('-update'), 'without -update every frame writes its own file');
  // -frames:v 1 after a seek takes the first frame of the tail, which is the
  // classic wrong answer here and would join the segments at the wrong moment.
  assert.ok(!args.includes('-frames:v'), '-frames:v after a seek takes the first frame, not the last');
  assert.equal(args.at(-1), 'seg-01-last.png');
  assert.ok(args.includes('-y'), 'a resumed extraction must overwrite its own previous output');
});

test('lastFrameArgs pins filter threads, like every other spawn in this repo', () => {
  const args = lastFrameArgs({ input: 'a.mp4', output: 'b.png', cfg });
  const at = args.indexOf('-filter_complex_threads');
  assert.ok(at >= 0);
  assert.equal(args[at + 1], '1');
});

test('lastFrameArgs refuses a nonsense tail rather than seeking to nowhere', () => {
  assert.throws(() => lastFrameArgs({ input: 'a.mp4', output: 'b.png', cfg, tailSeconds: 0 }), /tailSeconds/);
  assert.throws(() => lastFrameArgs({ input: '', output: 'b.png', cfg }), /input/);
});

test('the extracted frame is named beside the clip it came from', () => {
  assert.equal(lastFrameName(1), 'seg-01-last.png');
  assert.equal(lastFrameName(12), 'seg-12-last.png');
});
