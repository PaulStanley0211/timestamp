/**
 * `npm run ledger` -- estimated against actual, and the divergence that says a
 * price in config/pricing.json has stopped matching reality.
 *
 * WHY THIS FILE NEEDS NO ffmpeg AND NO NETWORK. Everything here is manifests on
 * disk and arithmetic over them. That is the same property `tapedeck/` has for
 * the look: the moment a money report needs a render to test it, nobody runs
 * the test.
 *
 * WHY THE MANIFESTS ARE BUILT THROUGH `createJob` AND `freezeResolved` RATHER
 * THAN WRITTEN AS LITERAL JSON. The ledger reads the frozen `resolved.estimate`
 * block to learn which model a step was billed against and in what unit. A
 * hand-written manifest would let this file invent a shape the pipeline never
 * produces, which is how a report passes every test and reads nothing on a real
 * job.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createJob, loadJob, saveJob, freezeResolved, beginStep, finishStep, skipStep, meterStep, JobError,
} from '../scripts/render/job.mjs';
import { DIVERGENCE_LIMIT } from '../scripts/providers/pricing.mjs';
import {
  buildLedger, rollupByModel, recordActual, LedgerError, parseArgs,
} from '../scripts/render/ledger-cli.mjs';

const roots = [];
function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-ledger-')).replace(/\\/g, '/');
  roots.push(root);
  return root;
}
test.after(() => {
  for (const root of roots) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* the OS can have it */ }
  }
});

const VIDEO = 'bytedance/seedance-2.0/reference-to-video';
const STILL = 'fal-ai/bytedance/seedream/v4.5/edit';

/** A pricing table in the real shape, injected so this file never depends on
 *  what config/pricing.json happens to say today -- those numbers are guesses
 *  and they are expected to change the moment a real invoice is read. */
const PRICING = {
  currency: 'USD',
  models: {
    [VIDEO]: { usd: 0.3027, unit: 'second', estimate: true, _comment: 'ESTIMATE' },
    [STILL]: { usd: 0.04, unit: 'image', estimate: true, _comment: 'ESTIMATE' },
  },
};

const baseInput = (over = {}) => ({
  photo: { path: 'input/photo.jpg', sha256: 'a'.repeat(64), width: 1200, height: 1600 },
  place: { kind: 'preset', value: 'schrebergarten-august', photoPath: null, photoSha256: null },
  outfit: { kind: 'preset', value: 'trainingsjacke' },
  // 3 even on a direct job, exactly as a real manifest carries it: stillCount is
  // validated 1..8 and simply goes unused when `direct` is true.
  stillCount: 3,
  direct: true,
  consent: {
    granted: true,
    at: '2026-08-24T12:00:00.000Z',
    text: 'I am in this photo and I agree to it being used to make this video.',
  },
  ...over,
});

/** `assert.throws` returns undefined, so a test that wants to READ the error --
 *  its code, the numbers in its message -- has to catch it itself. */
function caught(fn) {
  try { fn(); } catch (err) { return err; }
  throw new assert.AssertionError({ message: 'expected a refusal and nothing was thrown' });
}

let seq = 0;
/**
 * A job whose paid steps are priced the way the pipeline prices them: an
 * estimate line per call in the frozen block, and the same number on the step.
 *
 * `lines` is `[{step, model, usd, quantity, actual?}]`. An `actual` means the
 * step is already metered, which is how the report cases get something to
 * diverge from.
 */
function seedJob(root, { lines = [], skip = [] } = {}) {
  seq += 1;
  const at = new Date(Date.parse('2026-08-24T12:00:00.000Z') + seq * 1000);
  const jobId = `20260824-12${String(seq).padStart(4, '0')}-${String(seq).padStart(6, '0')}`;
  const job = createJob({
    root, jobId, input: baseInput(), provider: 'fal', cfg: { durationSeconds: 15 }, nowImpl: () => at,
  });
  freezeResolved(job, {
    models: { still: STILL, video: VIDEO },
    direct: true,
    estimate: {
      estimated: lines.reduce((n, l) => n + l.usd, 0),
      actual: null,
      currency: 'USD',
      lines: lines.map((l, i) => ({
        step: l.step, model: l.model, index: i + 1, quantity: l.quantity, usd: l.usd,
      })),
    },
  });
  for (const name of skip) skipStep(job, name, 'direct mode');
  for (const line of lines) {
    beginStep(job, line.step);
    finishStep(job, line.step, { cost: { estimated: line.usd, actual: line.actual ?? null } });
  }
  saveJob(job);
  return { job, jobId };
}

// ---------------------------------------------------------------------------
// the report
// ---------------------------------------------------------------------------

test('a job that never cost anything is not a ledger row', () => {
  const root = tmpRoot();
  seedJob(root, { lines: [] });
  const { rows } = buildLedger({ root });
  assert.deepEqual(rows, [], 'a free job has nothing to reconcile and printing it buries the ones that do');
});

test('a fixture job priced at zero and metered at zero is not a ledger row either', () => {
  // FOUND BY RUNNING IT. The fixture provider returns `actual: 0` -- honestly,
  // because a local ffmpeg call really is free -- and twelve such jobs on disk
  // were being counted as "12 metered" and printed above the five that cost
  // money. Nobody metered anything. A row belongs here only when there is a
  // disagreement to have: a non-zero estimate, or a non-zero charge.
  const root = tmpRoot();
  seedJob(root, { lines: [{ step: 'animate', model: 'fixture/video-v1', usd: 0, quantity: 15, actual: 0 }] });

  const { rows, totals } = buildLedger({ root });
  assert.deepEqual(rows, []);
  assert.equal(totals.metered, 0, 'a free call reporting its own zero is not a metered invoice');
});

test('a paid call that turned out to be free IS a row, and a loud one', () => {
  // The opposite case and the reason the rule cannot simply be "estimated > 0
  // and actual > 0": $4.54 expected against $0 charged is the most interesting
  // line the report could ever print.
  const root = tmpRoot();
  seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15, actual: 0 }] });

  const { rows } = buildLedger({ root });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actual, 0);
  assert.equal(rows[0].flagged, true);
});

test('an unmetered job is reported as unmetered, never as zero', () => {
  const root = tmpRoot();
  const { jobId } = seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15 }] });

  const { rows, totals } = buildLedger({ root });
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.jobId, jobId);
  assert.equal(row.estimated, 4.5405);
  // The distinction the whole module exists for: null is "nobody has read the
  // invoice", 0 is "it was free". Collapsing them makes every unmetered job
  // look like a 100% divergence.
  assert.equal(row.actual, null);
  assert.equal(row.divergence, null);
  assert.equal(row.flagged, false);
  assert.equal(totals.metered, 0);
  assert.equal(totals.unmetered, 1);
});

test('a metered job carries its divergence and the line that produced it', () => {
  const root = tmpRoot();
  seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15, actual: 1.51 }] });

  const { rows } = buildLedger({ root });
  const [row] = rows;
  assert.equal(row.actual, 1.51);
  assert.ok(row.divergence < -0.6, `4.54 estimated against 1.51 actual is a large negative, got ${row.divergence}`);
  assert.equal(row.flagged, true);
  assert.equal(row.lines.length, 1);
  assert.equal(row.lines[0].model, VIDEO, 'the model comes off the frozen estimate line, not the job default');
  assert.equal(row.lines[0].actual, 1.51);
});

test('the divergence limit is a boundary and it is exclusive', () => {
  assert.equal(DIVERGENCE_LIMIT, 0.15, 'this test is written against 15%');
  const root = tmpRoot();
  // 100 -> 115 is exactly 0.15 and must NOT be named; 100 -> 115.5 must be.
  seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 100, quantity: 15, actual: 115 }] });
  seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 100, quantity: 15, actual: 115.5 }] });

  const { rows } = buildLedger({ root });
  const byActual = Object.fromEntries(rows.map((r) => [r.actual, r]));
  assert.equal(byActual[115].flagged, false, 'exactly at the limit is not over it');
  assert.equal(byActual[115.5].flagged, true);
});

test('a job with two paid steps keeps them apart', () => {
  const root = tmpRoot();
  seedJob(root, {
    lines: [
      { step: 'still', model: STILL, usd: 0.12, quantity: 3, actual: 0.12 },
      { step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15, actual: 1.51 },
    ],
  });

  const { rows } = buildLedger({ root });
  const [row] = rows;
  assert.equal(row.lines.length, 2);
  assert.equal(row.actual, 1.63, 'the job total is the sum of its metered steps');
  // "which half" is the question a total cannot answer -- pricing.mjs says so
  // in as many words about the estimate, and it is just as true of the actual.
  assert.deepEqual(row.lines.map((l) => l.step), ['still', 'animate']);
});

// ---------------------------------------------------------------------------
// the rollup -- the half that corrects config/pricing.json
// ---------------------------------------------------------------------------

test('the rollup groups by model and implies the per-unit rate to write down', () => {
  const root = tmpRoot();
  seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15, actual: 1.50 }] });
  seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15, actual: 1.52 }] });
  seedJob(root, { lines: [{ step: 'still', model: STILL, usd: 0.04, quantity: 1, actual: 0.05 }] });

  const { rows } = buildLedger({ root });
  const groups = rollupByModel(rows, { pricing: PRICING });
  const video = groups.find((g) => g.model === VIDEO);
  const still = groups.find((g) => g.model === STILL);

  assert.equal(video.meteredCalls, 2);
  assert.equal(video.quantity, 30, 'two 15-second calls priced by the second');
  assert.equal(video.actual, 3.02);
  // THE NUMBER THAT GOES IN THE CONFIG. $3.02 over 30 seconds is $0.1007/s
  // against the $0.3027 guess -- and the guess is what every estimate and the
  // whole credit table are built on.
  assert.equal(video.impliedUsd, 0.1007);
  assert.equal(video.configuredUsd, 0.3027);
  assert.equal(video.flagged, true);

  assert.equal(still.unit, 'image');
  assert.equal(still.impliedUsd, 0.05);
  assert.equal(still.flagged, true, '0.04 -> 0.05 is 25%');
});

test('the rollup counts unmetered calls without letting them move the rate', () => {
  const root = tmpRoot();
  seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15, actual: 1.50 }] });
  seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15 }] });

  const [video] = rollupByModel(buildLedger({ root }).rows, { pricing: PRICING });
  assert.equal(video.calls, 2);
  assert.equal(video.meteredCalls, 1);
  assert.equal(video.quantity, 15, 'only the metered call contributes quantity to the implied rate');
  assert.equal(video.impliedUsd, 0.1, '1.50 over 15 seconds, and the unmetered call is not a free one');
});

test('a model with nothing metered yet implies no rate at all', () => {
  const root = tmpRoot();
  seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15 }] });

  const [video] = rollupByModel(buildLedger({ root }).rows, { pricing: PRICING });
  assert.equal(video.impliedUsd, null, 'inventing a rate from no invoice is the mistake this whole file exists to stop');
  assert.equal(video.flagged, false);
});

// ---------------------------------------------------------------------------
// recording -- getting a real invoice number onto a real job
// ---------------------------------------------------------------------------

test('recording an actual writes the step and rolls up to the job', () => {
  const root = tmpRoot();
  const { jobId } = seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15 }] });

  const result = recordActual({ root, jobId, actual: 1.51 });
  assert.equal(result.step, 'animate');
  assert.equal(result.previous, null);

  // Re-read from disk: an in-memory mutation that never reached the manifest is
  // exactly the bug this command would be written to avoid.
  const reloaded = loadJob({ root, jobId });
  assert.equal(reloaded.cost.actual, 1.51);
  assert.equal(reloaded.steps.find((s) => s.name === 'animate').cost.actual, 1.51);
  assert.equal(reloaded.cost.estimated, 4.5405, 'recording an actual must not touch the estimate');
});

test('the step is inferred when exactly one was paid for and demanded when more were', () => {
  const root = tmpRoot();
  const one = seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15 }] });
  const two = seedJob(root, {
    lines: [
      { step: 'still', model: STILL, usd: 0.04, quantity: 1 },
      { step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15 },
    ],
  });

  assert.equal(recordActual({ root, jobId: one.jobId, actual: 1.51 }).step, 'animate');

  const err = caught(() => recordActual({ root, jobId: two.jobId, actual: 1.51 }));
  assert.ok(err instanceof LedgerError);
  assert.equal(err.code, 'AMBIGUOUS_STEP');
  assert.match(err.message, /still/);
  assert.match(err.message, /animate/);
  // And naming it works.
  assert.equal(recordActual({ root, jobId: two.jobId, actual: 1.51, step: 'animate' }).step, 'animate');
});

test('zero is refused unless it is meant, because null already means "not metered"', () => {
  const root = tmpRoot();
  const { jobId } = seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15 }] });

  const err = caught(() => recordActual({ root, jobId, actual: 0 }));
  assert.ok(err instanceof LedgerError);
  assert.equal(err.code, 'ZERO_ACTUAL');

  // Nothing was written by the refusal.
  assert.equal(loadJob({ root, jobId }).cost.actual, null);

  // And a call that really was free can still be recorded, deliberately.
  recordActual({ root, jobId, actual: 0, actuallyZero: true });
  assert.equal(loadJob({ root, jobId }).cost.actual, 0);
});

test('an existing number is not overwritten by accident, and both are named', () => {
  const root = tmpRoot();
  const { jobId } = seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15 }] });
  recordActual({ root, jobId, actual: 1.51 });

  const err = caught(() => recordActual({ root, jobId, actual: 1.62 }));
  assert.ok(err instanceof LedgerError);
  assert.equal(err.code, 'ALREADY_METERED');
  assert.match(err.message, /1\.51/, 'the number being lost must be in the message');
  assert.match(err.message, /1\.62/);
  assert.equal(loadJob({ root, jobId }).cost.actual, 1.51, 'the refusal wrote nothing');

  const forced = recordActual({ root, jobId, actual: 1.62, force: true });
  assert.equal(forced.previous, 1.51);
  assert.equal(loadJob({ root, jobId }).cost.actual, 1.62);
});

test('a step that never ran cannot be metered', () => {
  const root = tmpRoot();
  // Direct mode: `still` and `select` are skipped, and skipped is not done.
  const { jobId } = seedJob(root, {
    skip: ['still', 'select'],
    lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15 }],
  });

  // A JobError, NOT a LedgerError, and deliberately so: "can this step have
  // been billed" is the job model's judgement, and `recordActual` delegating it
  // rather than re-deciding is what stops two answers to one question existing.
  const err = caught(() => recordActual({ root, jobId, actual: 0.04, step: 'still' }));
  assert.ok(err instanceof JobError);
  assert.equal(err.code, 'STEP_NOT_BILLABLE');
  assert.match(err.message, /skipped/);
});

test('an unknown job and an unknown step are refused by name', () => {
  const root = tmpRoot();
  const { jobId } = seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15 }] });

  assert.throws(() => recordActual({ root, jobId: '20260101-000000-abcdef', actual: 1 }), LedgerError);
  assert.throws(() => recordActual({ root, jobId, actual: 1, step: 'nosuchstep' }), JobError);
});

// ---------------------------------------------------------------------------
// meterStep, the seam in the job model
// ---------------------------------------------------------------------------

test('meterStep prices a done step without moving it', () => {
  const root = tmpRoot();
  const { jobId } = seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15 }] });
  const job = loadJob({ root, jobId });

  const step = meterStep(job, 'animate', 2.5);
  assert.equal(step.status, 'done', 'metering is bookkeeping, not a state transition');
  assert.equal(step.cost.actual, 2.5);
  assert.equal(job.cost.actual, 2.5, 'the roll-up stays in the one place that owns it');
  assert.equal(step.endedAt !== null, true, 'the original timestamps survive');
});

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

test('parseArgs separates the sub-command from its options', () => {
  const args = parseArgs(['record', '20260824-122201-af8b0d', '--actual=1.51', '--force']);
  assert.deepEqual(args.rest, ['record', '20260824-122201-af8b0d']);
  assert.equal(args.actual, '1.51');
  assert.equal(args.flags.has('force'), true);
  assert.equal(args.flags.has('json'), false);
});

// ---------------------------------------------------------------------------
// a quantity that cannot reproduce its own estimate is not a denominator
// ---------------------------------------------------------------------------

/**
 * THE DEFECT THIS CLOSES, and it printed real, catastrophic advice.
 *
 * `estimateJob` froze `quantity: seg.seconds` for a model billed per TOKEN.
 * The estimate was right -- the USD beside it came from the token count -- so
 * nothing upstream looked wrong. This command then divided a REAL INVOICE by
 * that seconds figure and labelled the answer with the CONFIG's unit, so the
 * two never had to agree: $8.73 over 45 seconds implied $0.1941/token against
 * $0.000014 configured, flagged it OVER, and printed
 *
 *   models["bytedance/seedance-2.0/reference-to-video"].usd: 0.000014 -> 0.1941
 *
 * which is wrong by a factor of about 13,825 and would have priced a 480p tape
 * at roughly $28,700. The upstream freeze is fixed, but EVERY MANIFEST ALREADY
 * ON DISK still carries seconds, so the guard has to live here too.
 *
 * The check is unit-agnostic on purpose: rather than comparing unit strings --
 * which legacy lines do not carry at all -- it asks whether the frozen
 * quantity, at the configured rate, reproduces the frozen estimate. If it
 * cannot, then dividing an invoice by it means nothing, whatever either side
 * calls its unit. A rate this command cannot honestly imply is one it must
 * refuse to print, because the whole purpose of the number is to be typed into
 * config/pricing.json.
 */
test('a line whose quantity cannot reproduce its own estimate implies no rate', () => {
  const root = tmpRoot();
  // 15 "seconds" frozen against a $4.5646 estimate that was really priced from
  // 326,042 tokens: 0.3027 x 15 = $4.54, nowhere near it.
  seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5646, quantity: 15, actual: 4.5773 }] });

  const [video] = rollupByModel(buildLedger({ root }).rows, { pricing: PRICING });

  assert.equal(video.meteredCalls, 1, 'the invoice is still real and still counted');
  assert.equal(video.actual, 4.5773, 'and the dollars are still reported');
  assert.equal(video.impliedUsd, null, 'but the rate is refused rather than guessed');
  assert.equal(video.flagged, false, 'and nothing is flagged OVER on the strength of a number that does not exist');
});

/** The honest case still works: a quantity that reproduces its estimate is a
 *  denominator you can divide an invoice by. */
test('a line whose quantity does reproduce its estimate still implies a rate', () => {
  const root = tmpRoot();
  // 0.3027 x 15 = 4.5405 exactly, so seconds really are what this was priced on.
  seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15, actual: 1.50 }] });

  const [video] = rollupByModel(buildLedger({ root }).rows, { pricing: PRICING });
  assert.equal(video.impliedUsd, 0.1, '1.50 over 15 seconds');
});

/**
 * "3/3 call(s) metered · nothing metered" is a sentence that argues with
 * itself, and it is what the guard above printed the moment it started
 * refusing. A refusal has to say WHICH refusal it is: there were no invoices,
 * or there were invoices and the frozen quantity beside them cannot be divided
 * by. The second is a repairable data problem and the operator can only repair
 * what the report names.
 */
test('a refused rate says which refusal it is', () => {
  const root = tmpRoot();
  seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5646, quantity: 15, actual: 4.5773 }] });
  seedJob(root, { lines: [{ step: 'still', model: STILL, usd: 0.04, quantity: 1 }] });

  const groups = rollupByModel(buildLedger({ root }).rows, { pricing: PRICING });
  const video = groups.find((g) => g.model === VIDEO);
  const still = groups.find((g) => g.model === STILL);

  assert.equal(video.impliedUsd, null);
  assert.equal(video.impliedReason, 'unreconcilable', 'invoices exist; the denominator is what failed');
  assert.equal(still.impliedUsd, null);
  assert.equal(still.impliedReason, 'nothing-metered', 'no invoice has arrived at all');
});

/** A rate that IS implied has nothing to explain. */
test('an implied rate carries no refusal reason', () => {
  const root = tmpRoot();
  seedJob(root, { lines: [{ step: 'animate', model: VIDEO, usd: 4.5405, quantity: 15, actual: 1.50 }] });

  const [video] = rollupByModel(buildLedger({ root }).rows, { pricing: PRICING });
  assert.equal(video.impliedUsd, 0.1);
  assert.equal(video.impliedReason, null);
});
