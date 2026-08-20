/**
 * Provider errors. Every one of them exists to answer one question that the
 * pipeline and the queue both have to ask and neither can guess: do we try
 * again, or do we stop and tell a human?
 *
 * WHY `retriable` IS A PROPERTY OF THE CLASS AND NOT A CONSTRUCTOR OPTION.
 * The obvious design is `new ProviderError(msg, { retriable: true })`, and it
 * is wrong for the same reason a boolean argument is usually wrong: the call
 * site that gets it backwards is the one written at 11pm inside a catch block,
 * and the symptom is either a job that gives up on a 429 (a user-visible
 * failure that would have succeeded three seconds later) or a job that retries
 * a 400 four times (four times the bill for four identical rejections). Here
 * the answer is carried by the class, `new.target` reads it off the class that
 * was actually constructed, and there is no argument to get backwards. The
 * value is copied onto the instance rather than left as a prototype getter so
 * it survives `JSON.stringify` into a manifest's `steps[].error`.
 *
 * WHY `classifyHttp` IS A TABLE AND NOT A HEURISTIC. `docs/interfaces.md` fixes
 * the mapping -- 401/403 credential, 400/422 terminal, 429 and 5xx retriable,
 * everything else terminal -- and the fixed part matters more than the clever
 * part. A provider that classifies by reading the message body invents a new
 * rule every time an upstream changes its wording, and the failure is silent:
 * the ladder either stops retrying something it should or keeps paying for
 * something it should not. Note that 408 and 409 land in "terminal" under the
 * stated rule. That is the rule as written, deliberately followed rather than
 * improved; if it should change, it changes in interfaces.md first.
 *
 * WHY THE LADDER LIVES HERE. `backoffMs` and `withRetry` are the 1/2/4/8
 * ladder from Ad-Regenerator's `scripts/ingest/meta-adapter.mjs`, lifted so
 * that `fal.mjs` cannot quietly invent a second one. Spacing matters for the
 * reason it mattered there: a per-account throttle window has to actually roll
 * over before the next attempt, and a tight loop of retries is
 * indistinguishable from the traffic that got you throttled.
 */

/** The single error taxonomy every provider raises. Nothing else may be thrown
 *  out of `generateStill`/`generateVideo` except a `TypeError` from the
 *  fetchImpl money guard -- see contract.mjs `requireFetchImpl`. */
export class ProviderError extends Error {
  /** Read through `new.target` by the constructor. Static fields are inherited
   *  down the class chain, so TimeoutError picks up RetriableError's `true`. */
  static retriable = false;

  constructor(message, { provider = 'unknown', code = 'provider_error', detail = null, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.provider = provider;
    this.code = code;
    this.detail = detail;
    this.retriable = new.target.retriable === true;
  }
}

/** No key, wrong key, expired key. Retrying cannot fix it and every attempt is
 *  another line in someone's abuse log. */
export class CredentialError extends ProviderError {
  static retriable = false;
}

/** The request is wrong, or the answer is no. Same request, same outcome. */
export class TerminalError extends ProviderError {
  static retriable = false;
}

/** The request was fine and the far end was not. Try again, spaced out. */
export class RetriableError extends ProviderError {
  static retriable = true;
}

/** A poll that never resolved, or a submit that never answered. Retriable
 *  because "it took too long once" is a statement about a moment, not about
 *  the request -- but note that a timeout on a *submit* may have created work
 *  on the far side, which is why the pipeline writes an intent record before
 *  the request rather than trusting this class to be harmless. */
export class TimeoutError extends RetriableError {}

/** We asked for something this provider cannot do -- a clip longer than
 *  `maxClipSeconds`, a still size it does not offer, a second reference image
 *  it will not accept. Terminal, and the message must name the capability,
 *  because the fix is a config change and not a retry. */
export class CapabilityError extends TerminalError {}

/** The provider refused on content grounds. Terminal, and deliberately its own
 *  class rather than a plain 422: the user-facing message for "we cannot make
 *  this image" is nothing like the one for "the request was malformed", and a
 *  product that takes uploads from strangers will hit this often enough that
 *  the distinction has to survive all the way to the status page. */
export class ModerationRefusedError extends TerminalError {}

/** Words that mean "we will not make that" rather than "you sent that wrong".
 *  Kept narrow on purpose: a false positive here mislabels a genuine schema
 *  error as a content refusal and sends the user a message about their photo
 *  when the bug is ours. */
const REFUSAL = /\b(nsfw|content[ _-]?polic|moderation|safety[ _-]?(check|filter|system)|prohibited|not[ _-]?allowed|flagged|blocked[ _-]?by)/i;

/** Bodies arrive as parsed JSON, as a string, or as nothing at all depending
 *  on how far the response got. Flatten to something greppable without caring
 *  which. */
function bodyText(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

/**
 * HTTP status -> the one error class the pipeline should see.
 *
 * @param {number} status
 * @param {*} [body]                    parsed JSON, a string, or null
 * @param {object} [opts]
 * @param {string} [opts.provider]      goes onto `.provider`
 * @returns {ProviderError}             returned, not thrown -- the caller decides
 */
export function classifyHttp(status, body = null, { provider = 'unknown' } = {}) {
  const text = bodyText(body);
  const detail = { status, body: text.length > 2000 ? `${text.slice(0, 2000)}...` : text };
  const say = (what) => `${provider}: HTTP ${status} ${what}`;

  if (status === 401 || status === 403) {
    return new CredentialError(say('-- the credential was rejected'), {
      provider, code: 'credential', detail,
    });
  }

  if (status === 400 || status === 422) {
    // Still terminal either way; ModerationRefusedError IS a TerminalError, so
    // the stated 400/422 -> Terminal rule holds. The subclass only carries the
    // extra fact that the request was understood and declined.
    if (REFUSAL.test(text)) {
      return new ModerationRefusedError(say('-- the provider refused on content grounds'), {
        provider, code: 'moderation_refused', detail,
      });
    }
    return new TerminalError(say('-- the request was rejected'), {
      provider, code: 'bad_request', detail,
    });
  }

  if (status === 429) {
    return new RetriableError(say('-- rate limited'), { provider, code: 'rate_limited', detail });
  }

  if (status >= 500 && status <= 599) {
    return new RetriableError(say('-- the provider failed'), { provider, code: 'upstream', detail });
  }

  return new TerminalError(say('-- unclassified, treated as terminal'), {
    provider, code: 'unclassified', detail,
  });
}

/**
 * The only question the queue asks about an error.
 *
 * Deliberately NOT a guess about raw network errors. A `fetch` that dies with
 * ECONNRESET arrives as a plain `TypeError` with the real cause buried, and
 * teaching this function to sniff for that would put the retry decision in the
 * wrong file: the provider knows it was making a network call, this function
 * does not. Providers wrap their own transport failures in `RetriableError`.
 * An unwrapped error is, correctly, not retried -- an unknown failure repeated
 * four times is four unknown failures.
 */
export function isRetriable(err) {
  return err?.retriable === true;
}

/** The ladder, as one expression, so nobody has to read a loop to know what it
 *  is. `attempt` is 1-based: 1s, 2s, 4s, 8s at the default 1000ms base. */
export function backoffMs(attempt, baseMs = 1000) {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new TypeError(`attempt must be a 1-based integer, got ${JSON.stringify(attempt)}`);
  }
  return 2 ** (attempt - 1) * baseMs;
}

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Run `fn`, retrying only what `isRetriable` says may be retried.
 *
 * `sleepImpl` gets a real default because sleeping is not spending -- the house
 * rule that forbids a default is specifically about `fetchImpl` on a paid
 * provider. A test that wants the ladder without the wall time injects
 * `sleepImpl: async () => {}` and asserts against `onRetry`.
 *
 * @param {(attempt:number)=>Promise<*>} fn
 * @param {object} opts
 * @param {number} [opts.maxAttempts]   cfg.provider.maxAttempts
 * @param {number} [opts.baseMs]        cfg.provider.backoffBaseMs
 * @param {(ms:number)=>Promise<void>} [opts.sleepImpl]
 * @param {(e:{attempt:number,waitMs:number,error:Error})=>void} [opts.onRetry]
 */
export async function withRetry(fn, {
  maxAttempts = 4,
  baseMs = 1000,
  sleepImpl = defaultSleep,
  onRetry,
} = {}) {
  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      last = err;
      // Two ways to stop: the error says no, or we are out of attempts. Both
      // rethrow the original rather than a wrapper, because the class IS the
      // diagnosis and burying it inside "retries exhausted" throws that away.
      if (!isRetriable(err) || attempt === maxAttempts) throw err;
      const waitMs = backoffMs(attempt, baseMs);
      onRetry?.({ attempt, waitMs, error: err });
      await sleepImpl(waitMs);
    }
  }
  throw last;
}
