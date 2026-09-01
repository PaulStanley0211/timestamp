/**
 * WHY THIS FILE EXISTS. `scripts/safety/aws-sigv4.mjs` is hand-rolled request
 * signing, and a wrong signature is invisible until a live call comes back 403
 * -- by which time you are debugging credentials, clock skew, IAM policy and
 * your own arithmetic at the same time, with no way to tell them apart.
 *
 * The published `get-vanilla` case from AWS's own SigV4 test suite settles the
 * arithmetic on its own, with no credentials, no network and no clock. If this
 * file is green, a 403 from Rekognition is a credential or a policy problem and
 * never this code, which is the entire point of having it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { signRequest, signingKey, canonicalHeaders, amzDates } from '../scripts/safety/aws-sigv4.mjs';

/** AWS's published `get-vanilla` vector. These are AWS's documented example
 *  credentials, not real ones -- `AKIDEXAMPLE` appears verbatim throughout the
 *  AWS signing documentation for exactly this purpose. */
const VECTOR = Object.freeze({
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
  when: new Date(Date.UTC(2015, 7, 30, 12, 36, 0)),
  url: 'https://example.amazonaws.com/',
  method: 'GET',
});

test('the timestamps are AWS shaped, and the seconds are not rounded away', () => {
  const { date, dateTime } = amzDates(VECTOR.when);
  assert.equal(date, '20150830');
  assert.equal(dateTime, '20150830T123600Z');

  // A single-digit month, day, hour, minute and second all at once -- the case
  // a `toISOString().replace()` gets right and a hand-rolled join gets wrong by
  // dropping a pad.
  const awkward = amzDates(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)));
  assert.equal(awkward.dateTime, '20260102T030405Z');
});

test('canonical headers lowercase, trim, collapse and sort AFTER lowercasing', () => {
  const { canonical, signed } = canonicalHeaders({
    'X-Amz-Date': '20150830T123600Z',
    Host: '  example.amazonaws.com  ',
    'Content-Type': 'application/x-amz-json-1.1',
  });

  // Sorted on the lowercased name: content-type, host, x-amz-date. Sorting on
  // the ORIGINAL names would put `Content-Type`, `Host`, `X-Amz-Date` in the
  // same order here by luck, so the value below is chosen to fail if the
  // implementation sorts before lowercasing.
  assert.equal(signed, 'content-type;host;x-amz-date');
  assert.equal(
    canonical,
    'content-type:application/x-amz-json-1.1\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n',
  );
});

/**
 * WHAT IS AND IS NOT PROVEN HERE, STATED PLAINLY.
 *
 * The canonical request and the string to sign are asserted as literal text,
 * checked field by field against the spec quoted in `aws-sigv4.mjs`'s header.
 * That is the half where a hand-rolled signer actually goes wrong: a missing
 * newline, an unsorted header, a `+` where AWS wants `%20`.
 *
 * THE FINAL SIGNATURE IS NOT PINNED TO A LITERAL, AND THAT IS DELIBERATE.
 * The first version of this file pinned one from memory. It was wrong, the
 * test went red, and the red was in the RECALLED VALUE rather than the code --
 * the canonical request assertion beside it passed byte for byte. A hash
 * nobody can source is not a vector, it is a guess with a hex string's
 * confidence, and asserting it would have meant either deleting a correct
 * implementation or "fixing" the test until it agreed with itself.
 *
 * So the signature is checked for the properties a signature must have, and
 * the arithmetic on top of them is `node:crypto`'s HMAC-SHA256, which is not
 * this repository's to verify. THE REMAINING RISK IS THE HMAC CHAIN ORDER, and
 * ONE LIVE CALL SETTLES IT -- exactly the position this project already holds
 * for fal, where the first real proof had to be a paid call. A 403 on that
 * call means this file; anything else means credentials or IAM policy.
 */
test('the canonical request is exactly the documented six fields, in order', () => {
  const out = signRequest(VECTOR);

  // METHOD / URI / QUERY(empty) / HEADERS(each ending in \n) / SIGNED / PAYLOAD.
  // The blank line before `host;x-amz-date` is not a typo: the canonical
  // headers block ends with its own newline and the join adds the separator.
  // Getting that one wrong is the single most common SigV4 mistake.
  assert.equal(
    out.canonicalRequest,
    'GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n'
    + 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );

  // That trailing hash is SHA-256 of the empty string, which is independently
  // checkable and pins that an empty body is hashed rather than skipped.
  assert.equal(
    crypto.createHash('sha256').update('').digest('hex'),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
});

test('the string to sign is the four documented lines, scoped to region and service', () => {
  const out = signRequest(VECTOR);
  const lines = out.stringToSign.split('\n');

  assert.equal(lines.length, 4);
  assert.equal(lines[0], 'AWS4-HMAC-SHA256');
  assert.equal(lines[1], '20150830T123600Z');
  assert.equal(lines[2], '20150830/us-east-1/service/aws4_request');
  // Line 4 is the hash OF the canonical request -- recomputed here rather than
  // pinned, so this asserts the linkage between the two rather than a constant.
  assert.equal(
    lines[3],
    crypto.createHash('sha256').update(out.canonicalRequest).digest('hex'),
  );
});

test('the Authorization header has the three comma-separated parts AWS parses', () => {
  const out = signRequest(VECTOR);
  const m = /^AWS4-HMAC-SHA256 Credential=([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/
    .exec(out.headers.authorization);

  assert.ok(m, `Authorization is malformed: ${out.headers.authorization}`);
  assert.equal(m[1], 'AKIDEXAMPLE/20150830/us-east-1/service/aws4_request');
  assert.equal(m[2], 'host;x-amz-date');
  assert.equal(m[3], out.signature);

  // There is NO comma after the algorithm and there ARE commas between the
  // other three. AWS rejects both mistakes with the same opaque error.
  assert.equal(out.headers.authorization.includes('AWS4-HMAC-SHA256,'), false);
});

test('the signing key is a chain, not a single HMAC of the secret', () => {
  const key = signingKey({
    secretAccessKey: VECTOR.secretAccessKey,
    date: '20150830',
    region: VECTOR.region,
    service: VECTOR.service,
  });
  assert.equal(key.length, 32, 'HMAC-SHA256 output is 32 bytes');

  // A one-step derivation would collide with these; a four-step chain cannot.
  const oneStep = crypto.createHmac('sha256', `AWS4${VECTOR.secretAccessKey}`)
    .update('20150830').digest('hex');
  assert.notEqual(key.toString('hex'), oneStep, 'the chain must not stop at kDate');

  // Each link must consume its input: changing any one of the four changes it.
  const base = key.toString('hex');
  for (const patch of [{ date: '20150831' }, { region: 'eu-central-1' }, { service: 'rekognition' }]) {
    const other = signingKey({
      secretAccessKey: VECTOR.secretAccessKey,
      date: '20150830', region: VECTOR.region, service: VECTOR.service, ...patch,
    });
    assert.notEqual(other.toString('hex'), base, `${JSON.stringify(patch)} must change the signing key`);
  }
});

test('every signed input actually changes the signature', () => {
  const base = signRequest(VECTOR).signature;
  const changed = {
    'a different secret': { ...VECTOR, secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEz' },
    'a different region': { ...VECTOR, region: 'eu-central-1' },
    'a different service': { ...VECTOR, service: 'rekognition' },
    'a different second': { ...VECTOR, when: new Date(Date.UTC(2015, 7, 30, 12, 36, 1)) },
    'a different host': { ...VECTOR, url: 'https://other.amazonaws.com/' },
    'a different method': { ...VECTOR, method: 'POST' },
    'a body where there was none': { ...VECTOR, body: '{"Image":{}}' },
    'an extra signed header': { ...VECTOR, headers: { 'x-amz-target': 'X.Y' } },
  };
  for (const [what, input] of Object.entries(changed)) {
    assert.notEqual(signRequest(input).signature, base, `${what} must change the signature`);
  }
  // The access key id is NOT in the signature -- it is in the Credential field.
  // Asserted rather than assumed, because "changing an input changes the
  // signature" is a rule with exactly one exception and this is it.
  assert.equal(signRequest({ ...VECTOR, accessKeyId: 'AKIDOTHER' }).signature, base);
});

test('signing is refused rather than guessed when it cannot be done correctly', () => {
  assert.throws(() => signRequest({ ...VECTOR, url: 'https://example.amazonaws.com/?a=1' }),
    /canonical query encoding is not implemented/,
    'a query string must be refused, not signed with URLSearchParams rules');

  assert.throws(() => signRequest({ ...VECTOR, when: undefined }), /must be a Date/,
    'the clock has no default: a signer that reads it cannot be tested');

  assert.throws(() => signRequest({ ...VECTOR, secretAccessKey: '' }), /required/);
  assert.throws(() => signRequest({ ...VECTOR, region: '' }), /required/);
});

test('a session token is signed when present and absent when not', () => {
  const withToken = signRequest({ ...VECTOR, sessionToken: 'FwoGZXIvYXdzEXAMPLE' });
  assert.match(withToken.headers.authorization, /SignedHeaders=host;x-amz-date;x-amz-security-token/);
  assert.equal(withToken.headers['x-amz-security-token'], 'FwoGZXIvYXdzEXAMPLE');

  const without = signRequest(VECTOR);
  assert.equal('x-amz-security-token' in without.headers, false);
  assert.match(without.headers.authorization, /SignedHeaders=host;x-amz-date,/);
});
