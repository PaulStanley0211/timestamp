/**
 * The last words of a dying process, and the guarantee that it dies.
 *
 * Node's defaults already exit nonzero on an uncaught exception, and on an
 * unhandled rejection in current versions -- but the behaviour has moved
 * across versions and flags, and the stack they print names no process. This
 * deployment is two containers sharing one log stream, and the question an
 * operator asks a crash line is "which process, doing what, and did it come
 * back". So both CLIs install this: ONE attributed line to the log, then exit
 * 1, unconditionally. The compose file's restart policy is the recovery path,
 * and it only works if a broken process reliably dies instead of limping on
 * with half-initialised state -- a web server that swallowed an unhandled
 * rejection is a web server whose next bug is invisible.
 *
 * Everything here is deliberately paranoid about its own failure:
 * - one exit, however many events arrive, so a cascade cannot recurse;
 * - a reason with no .stack (throw null, reject('string')) still prints;
 * - a log sink that throws (stderr can be a closed pipe on the way down)
 *   must not stand between the process and its exit.
 *
 * Injectable seams for the same reason every other module here has them: the
 * one thing the test file must never do is crash or exit the process running
 * the tests.
 */

export function installCrashHandlers({
  name,
  processImpl = process,
  logImpl = (line) => { processImpl.stderr.write(`${line}\n`); },
  exitImpl = (code) => { processImpl.exit(code); },
}) {
  let dying = false;

  const die = (kind) => (reason) => {
    if (dying) return;
    dying = true;
    let detail;
    try {
      detail = reason?.stack ?? String(reason);
    } catch {
      detail = 'a failure that could not be printed';
    }
    try {
      logImpl(`[${name}] FATAL ${kind}: ${detail}`);
    } catch {
      /* logging is best-effort; dying is the contract */
    }
    exitImpl(1);
  };

  const onRejection = die('unhandledRejection');
  const onException = die('uncaughtException');
  processImpl.on('unhandledRejection', onRejection);
  processImpl.on('uncaughtException', onException);

  return function uninstall() {
    processImpl.off('unhandledRejection', onRejection);
    processImpl.off('uncaughtException', onException);
  };
}
