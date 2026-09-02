/**
 * The free tape, and the global ceiling on how many of them exist.
 *
 * WHY THIS FILE IS SEPARATE FROM test/auth-accounts.test.js. Everything else in
 * the account store is per-account: one directory, one lock, one record, and a
 * race is two writers on one file. This is the only piece of state in the
 * product that is GLOBAL -- one number for the whole installation -- and the
 * race it has to survive is two writers who have never heard of each other,
 * signing up with different email addresses, on different threads. That is a
 * different property and it gets its own file.
 *
 * WHAT THE CEILING IS FOR, because it will read as paranoia to whoever finds it
 * next. Section 3 of docs/superpowers/specs/2026-08-24-credit-packs-pricing-design.md
 * calls it "the single most important line in this section". A free signup
 * grants 42 credits, which is two 480p tapes, which is $4.15 of measured
 * provider spend against no revenue and no card on file. Nothing else in this
 * codebase bounds how many times that can happen. Without this number, the
 * difference between a good day and a drained fal balance is the difference
 * between a hundred signups and ten thousand, and nobody chose which.
 *
 * THE TESTS THAT MATTER MOST HERE ARE THE ONES ABOUT ZERO AND ABOUT THREADS.
 * A ceiling that is off by one costs $4.15. A ceiling that does not hold under
 * concurrency does not cost $4.15, it costs however much arrives before someone
 * notices, and the arrival pattern of a link that got shared is precisely the
 * one that defeats a check written outside a lock.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  PLANS,
  accountsRoot,
  createAccount,
  creditConfig,
  freeTapeCeiling,
  freeTapePaths,
  freeTapeState,
  loadAccount,
  reserveFreeTape,
} from '../scripts/auth/accounts.mjs';
import { balanceOf, grantPlanPeriod, ledgerFor } from '../scripts/auth/credits.mjs';

// --------------------------------------------------------------------------
// harness
// --------------------------------------------------------------------------

const ACCOUNTS_URL = new URL('../scripts/auth/accounts.mjs', import.meta.url).href;

function makeRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-freetape-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir.replace(/\\/g, '/');
}

const T0 = Date.UTC(2026, 7, 25, 9, 0, 0);
const clock = (ms = T0) => () => new Date(ms);

const PW = 'correct-horse-battery';

/** A signup, on the free plan unless told otherwise. `ceiling` is injected the
 *  way `nowImpl` is: so a test can state the number it is testing instead of
 *  creating a hundred accounts to reach the real one. */
function signUp(root, { email, plan = 'free', ceiling, at = T0 } = {}) {
  return createAccount({ root, email, password: PW, plan, ceiling, nowImpl: clock(at) });
}

function grab(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

// --------------------------------------------------------------------------
// the number itself
// --------------------------------------------------------------------------

test('the ceiling is config, not a constant in the code', async () => {
  // The point of the whole exercise is that somebody can CHANGE this number
  // without reading any JavaScript. If it were a literal in accounts.mjs it
  // would be a number nobody set, which is the exact thing section 3 objects to.
  const fromFile = creditConfig().freeTape.globalCeiling;
  assert.equal(freeTapeCeiling(), fromFile);
  assert.ok(Number.isInteger(fromFile) && fromFile >= 0, 'a ceiling must be a non-negative whole number of tapes');
});

test('a fresh installation has granted nothing and has the whole ceiling left', async (t) => {
  const root = makeRoot(t);
  const state = freeTapeState({ root });
  assert.equal(state.granted, 0);
  assert.equal(state.ceiling, freeTapeCeiling());
  assert.equal(state.remaining, freeTapeCeiling());
  assert.equal(state.exhausted, false);
  // Nothing is written until something is reserved: reading a counter must not
  // create one, or a `list` command would leave state behind it.
  assert.equal(fs.existsSync(freeTapePaths(root).record), false);
});

// --------------------------------------------------------------------------
// granting, and withholding
// --------------------------------------------------------------------------

test('a free signup takes one off the ceiling and opens the ledger with the grant', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { email: 'one@example.com' });

  assert.equal(balanceOf(account).credits, PLANS.free.creditsPerPeriod);
  assert.deepEqual(ledgerFor(account).map((e) => [e.delta, e.reason]), [
    [PLANS.free.creditsPerPeriod, 'grant:signup'],
  ]);
  assert.equal(freeTapeState({ root }).granted, 1);
});

test('a PAID plan does not touch the ceiling, because paid credits are not free spend', async (t) => {
  const root = makeRoot(t);
  // The ceiling bounds what this product gives away. An account that arrived
  // with a plan attached is not giving anything away, and counting it would
  // exhaust the free allowance on people who are not using it.
  const account = await signUp(root, { email: 'paid@example.com', plan: 'shelf' });

  assert.equal(balanceOf(account).credits, PLANS.shelf.creditsPerPeriod);
  assert.equal(freeTapeState({ root }).granted, 0);
});

test('at the ceiling the signup still works and the grant is withheld, loudly, in the ledger', async (t) => {
  const root = makeRoot(t);
  await signUp(root, { email: 'first@example.com', ceiling: 1 });

  // SIGNUP MUST NOT FAIL. A person who cannot create an account cannot ever
  // become a customer, and the ceiling is about spend rather than about
  // registration. What they do not get is the free credits.
  const second = await signUp(root, { email: 'second@example.com', ceiling: 1 });

  assert.equal(balanceOf(second).credits, 0);
  assert.equal(freeTapeState({ root, ceiling: 1 }).exhausted, true);

  // AN ACCOUNT THAT EXISTS WITH NO LEDGER LINE IS AN ACCOUNT WHOSE BALANCE IS
  // ZERO FOR A REASON NOTHING RECORDED -- createAccount's own comment. A
  // withheld grant is still an event, so it is a row with a delta of zero and a
  // reason that says what happened, not an empty array.
  assert.deepEqual(ledgerFor(second).map((e) => [e.delta, e.reason, e.balance]), [
    [0, 'grant:signup:withheld-global-ceiling', 0],
  ]);
});

test('a ceiling of zero is the kill switch, and it works on the very first signup', async (t) => {
  const root = makeRoot(t);
  // The reason this case gets its own test: a bound implemented as `granted >
  // ceiling` instead of `granted >= ceiling` is correct for every number except
  // zero, and zero is the one somebody sets at 2am when the balance is
  // draining. Off-by-one here means the kill switch does not kill anything.
  const account = await signUp(root, { email: 'nobody@example.com', ceiling: 0 });

  assert.equal(balanceOf(account).credits, 0);
  assert.equal(freeTapeState({ root, ceiling: 0 }).granted, 0);
  assert.equal(freeTapeState({ root, ceiling: 0 }).exhausted, true);
});

test('the count is read back off disk, not remembered in the process', async (t) => {
  const root = makeRoot(t);
  await signUp(root, { email: 'a@example.com' });
  await signUp(root, { email: 'b@example.com' });

  // THE ENTRIES-OF TRAP, IN ITS OTHER FORM. The `ref` dedupe was written to
  // disk correctly, left off a projection, and was therefore idempotent in
  // memory and not idempotent at all across a reload -- which is the only case
  // that matters. A counter cached in a module-scope variable would pass every
  // test above and reset to zero on the next deploy, which is a ceiling that
  // silently refills. The state is asserted through a fresh read of the file.
  const onDisk = JSON.parse(fs.readFileSync(freeTapePaths(root).record, 'utf8'));
  assert.equal(onDisk.granted, 2);
  assert.equal(freeTapeState({ root }).granted, 2);
});

test('the register lives beside the account index and cannot collide with an account id', async (t) => {
  const root = makeRoot(t);
  const { dir } = accountsRoot(root);
  const paths = freeTapePaths(root);
  assert.equal(path.dirname(paths.record).replace(/\\/g, '/'), dir);
  // An account id is 32 lowercase hex characters and nothing else, so an
  // underscore prefix is collision-proof by construction -- the same trick, for
  // the same reason, as `_index`.
  assert.match(path.basename(paths.record), /^_/);
});

// --------------------------------------------------------------------------
// reserving directly
// --------------------------------------------------------------------------

test('reserveFreeTape hands out exactly the ceiling and then refuses forever', async (t) => {
  const root = makeRoot(t);
  const taken = [];
  for (let i = 0; i < 5; i += 1) taken.push(reserveFreeTape({ root, ceiling: 3, nowImpl: clock() }).reserved);
  assert.deepEqual(taken, [true, true, true, false, false]);
  assert.equal(freeTapeState({ root, ceiling: 3 }).granted, 3, 'a refusal must not increment');
});

test('a ceiling that is not a whole non-negative number is refused rather than defaulted', async () => {
  // A DEFAULT IN THE MONEY PATH IS A GUESS THAT BILLS SOMEBODY. A ceiling that
  // falls back to Infinity because the config was mistyped is worse than no
  // ceiling at all, because the file says there is one.
  for (const bad of [-1, 1.5, '10', null, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(grab(() => reserveFreeTape({ root: '/tmp', ceiling: bad }))?.code, 'BAD_FREE_TAPE_CEILING', `ceiling ${String(bad)}`);
  }
});

// --------------------------------------------------------------------------
// once ever, not once a period
// --------------------------------------------------------------------------

test('grantPlanPeriod refuses the free plan, because the free tape is once ever', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { email: 'repeat@example.com' });
  const before = balanceOf(account).credits;

  // Section 3: "One real tape, ever, per verified account. Not monthly. A
  // recurring free tape is a standing $2.08/user/month liability against no
  // revenue and no card on file." `grant --period` is the only automated path
  // that could ever re-grant it, so that is where it is stopped.
  assert.equal(grab(() => grantPlanPeriod(account, { planId: 'free' }))?.code, 'FREE_TAPE_IS_ONCE_EVER');
  assert.equal(balanceOf(loadAccount({ root, accountId: account.accountId })).credits, before);
});

test('a paid plan still grants its period, because that is what was paid for', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { email: 'shelf@example.com', plan: 'shelf' });
  assert.equal(grantPlanPeriod(account, { planId: 'shelf', nowImpl: clock(T0 + 1000) }), PLANS.shelf.creditsPerPeriod);
});

// --------------------------------------------------------------------------
// the race, through real threads
// --------------------------------------------------------------------------

const GUN = 0;

/**
 * One signup per thread, every one with a different email address, all released
 * through a single barrier.
 *
 * This is the shape that defeats a check written outside a lock: N threads each
 * read `granted`, each see the same number, each decide there is room, and each
 * write N-of-the-same-value back. The count ends at 1 and the ceiling has been
 * blown by N-1 tapes with every caller reporting success.
 */
const THREAD_SOURCE = `
const { workerData, parentPort } = require('node:worker_threads');
const { accountsUrl, root, index, ceiling, nowMs, shared } = workerData;
const flags = new Int32Array(shared);

(async () => {
  const { createAccount } = await import(accountsUrl);
  const nowImpl = () => new Date(nowMs);

  parentPort.postMessage({ ready: true });
  Atomics.wait(flags, ${GUN}, 0);

  let result;
  try {
    const account = await createAccount({
      root, email: 'racer' + index + '@example.com', password: ${JSON.stringify(PW)},
      plan: 'free', ceiling, nowImpl,
    });
    const delta = account.ledger[0].delta;
    result = { index, ok: true, delta };
  } catch (err) {
    result = { index, ok: false, code: err.code || String(err.message) };
  }
  parentPort.postMessage({ result });
})().catch((err) => parentPort.postMessage({ result: { index, ok: false, code: String((err && err.stack) || err) } }));
`;

function stampede({ count, root, ceiling, nowMs = T0 }) {
  const shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const view = new Int32Array(shared);
  const results = [];
  let ready = 0;

  return new Promise((resolve, reject) => {
    const workers = [];
    for (let index = 0; index < count; index += 1) {
      const worker = new Worker(THREAD_SOURCE, {
        eval: true,
        workerData: { accountsUrl: ACCOUNTS_URL, root, index, ceiling, nowMs, shared },
      });
      workers.push(worker);
      worker.on('error', reject);
      worker.on('message', (msg) => {
        if (msg.ready) {
          ready += 1;
          if (ready === count) { Atomics.store(view, GUN, 1); Atomics.notify(view, GUN); }
          return;
        }
        results.push(msg.result);
        if (results.length === count) {
          Promise.all(workers.map((w) => w.terminate())).then(() => resolve(results), reject);
        }
      });
    }
  });
}

test('eight simultaneous signups against a ceiling of three grant exactly three tapes', async (t) => {
  const root = makeRoot(t);
  const results = await stampede({ count: 8, root, ceiling: 3 });

  const failed = results.filter((r) => !r.ok);
  assert.deepEqual(failed, [], 'every signup must succeed; the ceiling withholds credits, it does not refuse accounts');

  const granted = results.filter((r) => r.delta > 0);
  assert.equal(granted.length, 3, 'exactly the ceiling, no matter how they interleaved');
  assert.equal(results.filter((r) => r.delta === 0).length, 5);
  assert.equal(freeTapeState({ root, ceiling: 3 }).granted, 3, 'the register agrees with the ledgers');

  // The money statement, and the only one that matters: the total handed out
  // across every account is bounded by the number in the config file.
  const spent = results.reduce((total, r) => total + r.delta, 0);
  assert.equal(spent, 3 * PLANS.free.creditsPerPeriod);
});
