/**
 * A per-key request limiter for the two public credential routes.
 *
 * WHY IT EXISTS. Login and signup are the only routes a stranger can make this
 * process do real work on demand: a password check is a deliberate ~30ms
 * derivation, and a signup opens an account that the free grant is spent on.
 * Neither cost can be removed -- the slowness of scrypt is its entire point --
 * so the only lever left is how often one address gets to ask.
 *
 * WHY A FIXED WINDOW AND NOT A TOKEN BUCKET. The requirement is "a script
 * cannot run these routes hot", not fairness engineering. A fixed window is a
 * counter and a timestamp per key; its worst case -- a burst at a window edge
 * letting through 2x the limit -- still reduces an unbounded loop to a number
 * with a ceiling on it, and the code stays small enough to be obviously right.
 *
 * WHY IN MEMORY. The counters protect this process's event loop and this
 * deployment's giveaway budget; they do not need to survive a restart to do
 * that, and a restart that forgets them costs one extra window of exposure,
 * not money. A durable store would be a dependency in a repo that has none.
 *
 * WHY THE MAP IS BOUNDED. The keys arrive from the network, so an unbounded
 * map is a memory lease anyone can extend. When the table passes `maxKeys`,
 * expired windows are swept; live ones are kept, because evicting a live
 * counter is evicting exactly the entry doing its job.
 */

const defaultNow = () => new Date();

export function createRateLimiter({ max, windowMs, nowImpl = defaultNow, maxKeys = 10_000 } = {}) {
  if (!Number.isInteger(max) || max < 1) throw new TypeError(`max must be a positive integer, got ${max}`);
  if (!Number.isInteger(windowMs) || windowMs < 1) throw new TypeError(`windowMs must be a positive integer, got ${windowMs}`);

  /** key -> { count, windowStart } */
  const windows = new Map();

  function sweep(nowMs) {
    for (const [key, entry] of windows) {
      if (nowMs - entry.windowStart >= windowMs) windows.delete(key);
    }
  }

  return {
    /**
     * Record one attempt and answer whether it may proceed.
     *
     * Counting happens BEFORE the allow/refuse decision, so a refused attempt
     * still counts: a client that keeps hammering a closed window keeps it
     * closed rather than probing it open.
     *
     * @returns {{allowed: boolean, retryAfterS: number}} `retryAfterS` is how
     *   long until the window reopens, for the `Retry-After` header -- an
     *   honest number, because a 429 with no time on it is a puzzle.
     */
    check(key) {
      const nowMs = nowImpl().getTime();
      let entry = windows.get(key);
      if (!entry || nowMs - entry.windowStart >= windowMs) {
        if (!entry && windows.size >= maxKeys) sweep(nowMs);
        entry = { count: 0, windowStart: nowMs };
        windows.set(key, entry);
      }
      entry.count += 1;
      if (entry.count > max) {
        return { allowed: false, retryAfterS: Math.max(1, Math.ceil((entry.windowStart + windowMs - nowMs) / 1000)) };
      }
      return { allowed: true, retryAfterS: 0 };
    },
  };
}
