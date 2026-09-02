/**
 * The last words of a dying process, and the guarantee that it dies.
 *
 * Node's own defaults already exit nonzero on an uncaught exception, and on an
 * unhandled rejection in current versions -- but the wording, the exit path
 * and even the behaviour have moved across node versions and flags, and the
 * stack they print is anonymous. On a box running two containers, "WHICH
 * process died, on what" is the entire question the ops log has to answer at
 * 3am, and the restart policy in the compose file is the recovery path -- it
 * only works if the process reliably exits rather than limping on with
 * half-broken state. So both CLIs install one handler that prints one
 * attributed line and exits 1, by contract rather than by default.
 *
 * The fakes here are an EventEmitter and two counters, because the one thing
 * this test file must never do is crash or exit the process running it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';

import { installCrashHandlers } from '../scripts/ops/crash.mjs';

function harness() {
  const processImpl = new EventEmitter();
  const logged = [];
  const exits = [];
  const uninstall = installCrashHandlers({
    name: 'test-proc',
    processImpl,
    logImpl: (line) => logged.push(line),
    exitImpl: (code) => exits.push(code),
  });
  return { processImpl, logged, exits, uninstall };
}

test('an unhandled rejection is one attributed line and exit 1', () => {
  const { processImpl, logged, exits } = harness();
  processImpl.emit('unhandledRejection', new Error('the seam nobody awaited'));
  assert.equal(exits.length, 1);
  assert.equal(exits[0], 1);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /\[test-proc\] FATAL unhandledRejection:/);
  // The stack, not just the message: the whole point over node's default is
  // that the line says where.
  assert.match(logged[0], /the seam nobody awaited[\s\S]*at /);
});

test('an uncaught exception is the same contract', () => {
  const { processImpl, logged, exits } = harness();
  processImpl.emit('uncaughtException', new Error('sync boom'));
  assert.deepEqual(exits, [1]);
  assert.match(logged[0], /\[test-proc\] FATAL uncaughtException:/);
});

test('a second failure while dying cannot recurse into a second exit', () => {
  // The classic cascade: the exception handler's own logging throws, or both
  // events fire for one failure. One line, one exit, whatever arrives.
  const { processImpl, logged, exits } = harness();
  processImpl.emit('uncaughtException', new Error('first'));
  processImpl.emit('unhandledRejection', new Error('second, during teardown'));
  processImpl.emit('uncaughtException', new Error('third'));
  assert.deepEqual(exits, [1]);
  assert.equal(logged.length, 1);
});

test('a reason that is not an Error still produces a line and an exit', () => {
  // `Promise.reject('a string')` and `throw null` are both legal JavaScript,
  // and a crash handler that assumes .stack exists dies inside itself.
  const { processImpl, logged, exits } = harness();
  processImpl.emit('unhandledRejection', 'just a string');
  assert.deepEqual(exits, [1]);
  assert.match(logged[0], /just a string/);

  const second = harness();
  second.processImpl.emit('uncaughtException', null);
  assert.deepEqual(second.exits, [1]);
});

test('a log sink that throws must not block the exit', () => {
  // Logging is best-effort; dying is the contract. stderr can be a closed
  // pipe on the way down and that must not turn exit-1 into a hang.
  const processImpl = new EventEmitter();
  const exits = [];
  installCrashHandlers({
    name: 'x',
    processImpl,
    logImpl: () => { throw new Error('stderr is gone'); },
    exitImpl: (code) => exits.push(code),
  });
  processImpl.emit('uncaughtException', new Error('boom'));
  assert.deepEqual(exits, [1]);
});

test('uninstall removes both listeners', () => {
  const { processImpl, exits, uninstall } = harness();
  uninstall();
  assert.equal(processImpl.listenerCount('unhandledRejection'), 0);
  assert.equal(processImpl.listenerCount('uncaughtException'), 0);
  processImpl.emit('uncaughtException', new Error('after uninstall'));
  assert.deepEqual(exits, []);
});

// ---------------------------------------------------------------------------
// the wire: both production entry points install the handlers.
// A unit test of installCrashHandlers cannot see the call site that forgot to
// call it -- the same reasoning as the paidTransport source-reading test in
// test/provider-contract.test.js, which is the precedent (CLAUDE.md BUG 1).
// ---------------------------------------------------------------------------

test('both CLIs install the crash handlers at their direct-invocation entry', () => {
  for (const file of ['scripts/web/server-cli.mjs', 'scripts/worker/worker-cli.mjs']) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /installCrashHandlers\(/, `${file} never installs the crash handlers`);
    assert.match(source, /from '\.\.\/ops\/crash\.mjs'/, `${file} does not import the shared module`);
  }
});
