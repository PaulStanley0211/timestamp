/**
 * THE TRANSPORT, INJECTED AT THE PLACES THAT ARE ALLOWED TO SPEND.
 *
 * `requireFetchImpl` gives a paid provider NO DEFAULT for `fetchImpl` -- guard
 * 1 of the four in CLAUDE.md -- so that a test which forgets to inject one gets
 * a TypeError instead of a bill. That guard was doing its job perfectly and
 * nothing was doing the other half: **no production caller injected a transport
 * either**, so `--provider=fal` could not reach the network at all. It failed
 * at step 5 of 11 with the money guard's own TypeError, which reads like a test
 * bug and was in fact a missing wire. Found on 2026-08-23, the first time
 * anybody ran the paid path.
 *
 * WHY THIS IS A MODULE AND NOT A FUNCTION INSIDE `render.mjs`. It was one, and
 * that is exactly how the worker kept the hole for a day after the CLI lost it:
 * `worker.mjs` has always accepted `providerCtx` and `worker-cli.mjs` passed
 * none, so the web app's renderer could not spend either and nobody could see
 * it from the fixed file. A wire that has to exist at every entry point that
 * can spend belongs where every one of them can import it, and the two callers
 * are now the two commands that can charge Paul money: `render.mjs` and
 * `worker-cli.mjs`.
 *
 * Injecting it HERE, and only for `provider.paid`, keeps all four guards
 * intact: fal.mjs still has no default, `npm test` still never runs either
 * CLI's `main()`, the bare `node --test` still keeps `FAL_KEY` out of the
 * process, and the smoke-test convention is untouched. What changes is only
 * that the commands whose entire design is "spending is a deliberate act" now
 * actually carry the thing that lets them spend.
 */

import { TerminalError } from './errors.mjs';

/**
 * The `providerCtx` fragment a paid provider needs, and nothing at all for a
 * free one.
 *
 * `globalFetch` is a parameter rather than a direct read of `globalThis.fetch`
 * for one reason: the no-fetch branch below is otherwise testable only by
 * deleting `globalThis.fetch` out from under a running process. It is never
 * passed in production, and passing one does not weaken the money guard --
 * the guard is that `fal.mjs` has no default of its own, which is untouched.
 *
 * @param {{paid?: boolean, id?: string}} provider
 * @param {{globalFetch?: function}} [opts]
 * @returns {{fetchImpl?: function}}  merged into the pipeline's providerCtx
 */
export function paidTransport(provider, { globalFetch = globalThis.fetch } = {}) {
  if (!provider?.paid) return {};
  if (typeof globalFetch !== 'function') {
    throw new TerminalError(
      'this Node build has no global fetch, and a paid provider needs one. Node 18+ has it built in.',
      { code: 'no_fetch', provider: provider.id ?? 'unknown' },
    );
  }
  // Bound, because `fetch` detached from `globalThis` throws "Illegal invocation"
  // in some runtimes and the symptom would surface deep inside a retry loop.
  return { fetchImpl: globalFetch.bind(globalThis) };
}
