/**
 * The error taxonomy, and the retry ladder that reads it.
 *
 * These are pure-function tests: no ffmpeg, no filesystem, no network, so they
 * run in milliseconds and there is no reason for any of them to be skipped or
 * flaky. The one thing under test that is not obvious is the ORDER of the
 * classification table -- 429 and 5xx retriable, everything else terminal --
 * because getting it backwards is invisible until it costs either a user a
 * failed job or Paul four bills for one rejection.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderError,
  CredentialError,
  TerminalError,
  RetriableError,
  TimeoutError,
  CapabilityError,
  ModerationRefusedError,
  classifyHttp,
  isRetriable,
  backoffMs,
  withRetry,
} from '../scripts/providers/errors.mjs';

test('the hierarchy is what docs/interfaces.md says it is', () => {
  assert.ok(new CredentialError('x') instanceof ProviderError);
  assert.ok(new TerminalError('x') instanceof ProviderError);
  assert.ok(new RetriableError('x') instanceof ProviderError);
  assert.ok(new TimeoutError('x') instanceof RetriableError);
  assert.ok(new CapabilityError('x') instanceof TerminalError);
  assert.ok(new ModerationRefusedError('x') instanceof TerminalError);
  // Every one of them is still an Error, so a catch block that only knows
  // about Error does not lose the message.
  assert.ok(new CapabilityError('x') instanceof Error);
});

test('retriable is decided by the class, not by the call site', () => {
  assert.equal(new CredentialError('x').retriable, false);
  assert.equal(new TerminalError('x').retriable, false);
  assert.equal(new CapabilityError('x').retriable, false);
  assert.equal(new ModerationRefusedError('x').retriable, false);
  assert.equal(new RetriableError('x').retriable, true);
  // Inherited through the static chain: TimeoutError never states it.
  assert.equal(new TimeoutError('x').retriable, true);
});

test('a caller cannot talk a terminal error into being retriable', () => {
  // The whole reason retriable is not a constructor option: the call site that
  // gets a boolean argument backwards is the one written at 11pm in a catch
  // block, and the symptom is four bills for one rejection.
  const err = new TerminalError('nope', { retriable: true, provider: 'fal', code: 'bad_request' });
  assert.equal(err.retriable, false);
  assert.equal(isRetriable(err), false);
});

test('an error carries the four fields the manifest records', () => {
  const cause = new Error('socket hang up');
  const err = new RetriableError('upstream fell over', {
    provider: 'fal', code: 'upstream', detail: { status: 503 }, cause,
  });
  assert.equal(err.name, 'RetriableError');
  assert.equal(err.provider, 'fal');
  assert.equal(err.code, 'upstream');
  assert.deepEqual(err.detail, { status: 503 });
  assert.equal(err.cause, cause);
});

test('the fields survive JSON.stringify into a manifest', () => {
  // steps[].error is written into manifest.json, and a prototype getter would
  // serialise to nothing. Own data properties, deliberately.
  const round = JSON.parse(JSON.stringify(new CapabilityError('too long', {
    provider: 'fixture', code: 'clip_too_long', detail: { max: 8 },
  })));
  assert.equal(round.provider, 'fixture');
  assert.equal(round.code, 'clip_too_long');
  assert.equal(round.retriable, false);
  assert.deepEqual(round.detail, { max: 8 });
});

test('classifyHttp maps status to class exactly as specified', () => {
  const cases = [
    [401, CredentialError, 'credential'],
    [403, CredentialError, 'credential'],
    [400, TerminalError, 'bad_request'],
    [422, TerminalError, 'bad_request'],
    [429, RetriableError, 'rate_limited'],
    [500, RetriableError, 'upstream'],
    [502, RetriableError, 'upstream'],
    [503, RetriableError, 'upstream'],
    [599, RetriableError, 'upstream'],
    // "anything else -> Terminal" is the stated rule, and 404/408/409 land
    // there deliberately. Following the spec as written rather than improving
    // it: if the rule should change it changes in docs/interfaces.md first.
    [404, TerminalError, 'unclassified'],
    [408, TerminalError, 'unclassified'],
    [409, TerminalError, 'unclassified'],
    [301, TerminalError, 'unclassified'],
  ];
  for (const [status, Cls, code] of cases) {
    const err = classifyHttp(status, null, { provider: 'fal' });
    assert.ok(err instanceof Cls, `${status} should be ${Cls.name}, got ${err.name}`);
    assert.equal(err.code, code, `${status} code`);
    assert.equal(err.provider, 'fal');
    assert.equal(err.detail.status, status);
  }
});

test('classifyHttp returns an error rather than throwing one', () => {
  // The caller decides whether to throw, wrap, or record it. A classifier that
  // throws cannot be used inside a catch block without a second try.
  const err = classifyHttp(500);
  assert.ok(err instanceof RetriableError);
});

test('retriable and terminal statuses agree with isRetriable', () => {
  assert.equal(isRetriable(classifyHttp(429)), true);
  assert.equal(isRetriable(classifyHttp(503)), true);
  assert.equal(isRetriable(classifyHttp(401)), false);
  assert.equal(isRetriable(classifyHttp(422)), false);
  assert.equal(isRetriable(classifyHttp(404)), false);
});

test('a content refusal is its own class, and still terminal', () => {
  // Terminal either way -- ModerationRefusedError IS a TerminalError, so the
  // stated 400/422 -> Terminal rule holds. The subclass carries the extra fact
  // that the request was understood and declined, which needs a different
  // user-facing message from "the request was malformed".
  const err = classifyHttp(422, { detail: [{ msg: 'NSFW content detected in output' }] }, { provider: 'fal' });
  assert.ok(err instanceof ModerationRefusedError);
  assert.ok(err instanceof TerminalError);
  assert.equal(err.code, 'moderation_refused');
  assert.equal(isRetriable(err), false);
});

test('a plain malformed-request body is not mistaken for a refusal', () => {
  const err = classifyHttp(422, { detail: [{ msg: 'field "seed" must be an integer' }] });
  assert.equal(err.constructor.name, 'TerminalError');
  assert.equal(err.code, 'bad_request');
});

test('classifyHttp survives every shape a body actually arrives in', () => {
  for (const body of [null, undefined, '', 'plain text', { a: 1 }, [1, 2, 3]]) {
    const err = classifyHttp(400, body);
    assert.ok(err instanceof TerminalError);
    assert.equal(typeof err.detail.body, 'string');
  }
  // A body that cannot be stringified must not take the classifier down with
  // it -- the response that produced it is exactly the one worth reporting.
  const circular = {};
  circular.self = circular;
  assert.ok(classifyHttp(500, circular) instanceof RetriableError);
});

test('a huge error body is truncated rather than pasted into the manifest', () => {
  const err = classifyHttp(400, 'x'.repeat(50_000));
  assert.ok(err.detail.body.length < 2100, `body was ${err.detail.body.length} chars`);
});

test('an inline image in an error body is redacted before the body is kept', () => {
  // fal's 422 echoes the request it refused, and the request carries the
  // photograph inline as a base64 data URI. `error.detail` is written to the
  // manifest, which outlives the 7-day photo window and the customer's own
  // delete -- so image bytes must never reach it, whatever surrounds them.
  const image = `data:image/jpeg;base64,${'/9j/4AAQSkZJRgABAQ'.repeat(600)}==`;
  const body = {
    detail: [{ loc: ['body', 'image_urls', 0], msg: `value ${image} was refused`, type: 'value_error' }],
  };
  const err = classifyHttp(422, body, { provider: 'fal' });

  assert.doesNotMatch(err.detail.body, /base64,[A-Za-z0-9+/=]{8,}/, 'no run of image bytes survives');
  assert.match(err.detail.body, /data:image\/jpeg;base64,<redacted>/, 'the field is still recognisable as an image');
  // The redaction runs BEFORE the truncation, so what the provider said AFTER
  // the image is still there to read. A truncation-first order keeps 2000
  // characters of JPEG header and drops the sentence that names the problem.
  assert.match(err.detail.body, /was refused/);
  assert.match(err.detail.body, /value_error/);
  assert.ok(err.detail.body.length < 400, `body was ${err.detail.body.length} chars -- the image should be gone, not capped`);
});

test('the redaction covers every data URI shape a provider might echo', () => {
  for (const uri of [
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
    'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
    'DATA:IMAGE/JPEG;BASE64,/9J/4AAQSKZJRGABAQ',
    'data:application/octet-stream;base64,AAAA',
  ]) {
    const err = classifyHttp(400, `before ${uri} after`);
    assert.doesNotMatch(err.detail.body, /base64,[A-Za-z0-9+/=]{4,}/i, `${uri.slice(0, 30)} leaked`);
    assert.match(err.detail.body, /^before data:.*<redacted> after$/i, `context lost around ${uri.slice(0, 30)}`);
  }
});

test('isRetriable does not guess about errors nobody classified', () => {
  // Deliberate: a raw `fetch` failure arrives as a bare TypeError with the
  // real cause buried, and teaching this function to sniff for that would put
  // the retry decision in the file that knows least about it. Providers wrap
  // their own transport failures.
  assert.equal(isRetriable(new Error('fetch failed')), false);
  assert.equal(isRetriable(new TypeError('x')), false);
  assert.equal(isRetriable(null), false);
  assert.equal(isRetriable(undefined), false);
  assert.equal(isRetriable({ retriable: 'yes' }), false);
});

test('the ladder is 1/2/4/8 seconds, scaled by the configured base', () => {
  assert.deepEqual([1, 2, 3, 4].map((a) => backoffMs(a, 1000)), [1000, 2000, 4000, 8000]);
  assert.deepEqual([1, 2, 3, 4].map((a) => backoffMs(a, 250)), [250, 500, 1000, 2000]);
});

test('backoffMs rejects a zero-based attempt', () => {
  // Off by one here halves every wait, which is exactly the kind of change
  // that looks like it works and quietly stops clearing a throttle window.
  assert.throws(() => backoffMs(0), TypeError);
  assert.throws(() => backoffMs(1.5), TypeError);
});

test('withRetry retries only what may be retried, and waits the ladder', async () => {
  const waits = [];
  let calls = 0;
  const value = await withRetry(async (attempt) => {
    calls += 1;
    if (attempt < 3) throw new RetriableError('later', { code: 'rate_limited' });
    return 'ok';
  }, { maxAttempts: 4, baseMs: 1000, sleepImpl: async (ms) => { waits.push(ms); } });

  assert.equal(value, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test('withRetry does not retry a terminal error, and does not sleep first', async () => {
  let calls = 0;
  let slept = false;
  await assert.rejects(
    withRetry(async () => { calls += 1; throw new CredentialError('no key', { code: 'credential' }); },
      { maxAttempts: 4, sleepImpl: async () => { slept = true; } }),
    (err) => err instanceof CredentialError,
  );
  assert.equal(calls, 1, 'a credential error must cost exactly one attempt');
  assert.equal(slept, false);
});

test('withRetry rethrows the original error rather than a wrapper', async () => {
  // The class IS the diagnosis. Burying it inside "retries exhausted" throws
  // away the only thing the pipeline needed to know.
  const thrown = new TimeoutError('poll never resolved', { code: 'timeout', detail: { waitedMs: 900000 } });
  await assert.rejects(
    withRetry(async () => { throw thrown; }, { maxAttempts: 3, sleepImpl: async () => {} }),
    (err) => {
      assert.equal(err, thrown);
      assert.equal(err.code, 'timeout');
      return true;
    },
  );
});

test('withRetry reports each retry so a caller can log it', async () => {
  const seen = [];
  await assert.rejects(
    withRetry(async () => { throw new RetriableError('503', { code: 'upstream' }); }, {
      maxAttempts: 3,
      baseMs: 100,
      sleepImpl: async () => {},
      onRetry: (e) => seen.push({ attempt: e.attempt, waitMs: e.waitMs }),
    }),
    RetriableError,
  );
  // Two retries for three attempts -- the last failure is not a retry, it is
  // the answer.
  assert.deepEqual(seen, [{ attempt: 1, waitMs: 100 }, { attempt: 2, waitMs: 200 }]);
});
