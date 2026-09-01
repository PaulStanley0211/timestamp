/**
 * AWS Signature Version 4, by hand, over `node:crypto`.
 *
 * WHY THIS FILE EXISTS AT ALL. The alternative is `@aws-sdk/client-rekognition`,
 * which is ~40 transitive packages, and this repository has ZERO dependencies
 * and a CI guard that fails the build if that stops being true. The whole of
 * SigV4 that a JSON-protocol service needs is four HMACs and a SHA-256, and
 * `scripts/billing/stripe.mjs` already establishes that hand-rolling a
 * provider's signature scheme is the house answer rather than a stunt.
 *
 * THIS FILE IS PURE. It does not read the clock, does not read the environment,
 * does not touch the filesystem and does not make a request. It takes a
 * description of a request and returns headers. That is what makes it testable
 * against a published vector with no network and no credentials -- and a
 * signature you cannot test is a signature you find out about in production.
 *
 * WHAT IT DELIBERATELY DOES NOT IMPLEMENT:
 *   - SigV4a (ECDSA). Rekognition does not need it and it is a different
 *     algorithm, not a flag.
 *   - Query-string signing. Only the Authorization header form, which is what
 *     a JSON-protocol POST uses.
 *   - S3's `UNSIGNED-PAYLOAD` special case. We sign the body we send.
 * Adding any of them is a new function, not a parameter on this one.
 *
 * Spec followed: "Create a signed AWS API request", AWS IAM User Guide, read
 * 2026-09-01. The four-step key derivation and the canonical-request field
 * order below are quoted from it directly.
 */

import crypto from 'node:crypto';

const ALGORITHM = 'AWS4-HMAC-SHA256';

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();

/**
 * `YYYYMMDDTHHMMSSZ` and `YYYYMMDD` from a Date.
 *
 * Written by hand rather than through `toISOString().replace(/[-:]/g, '')`
 * because the replace form also has to strip the milliseconds, and a `.slice`
 * that is one character out produces a string AWS rejects with a signature
 * error that says nothing about the date. Two explicit joins cannot drift.
 */
export function amzDates(when) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const date = `${when.getUTCFullYear()}${p(when.getUTCMonth() + 1)}${p(when.getUTCDate())}`;
  const time = `${p(when.getUTCHours())}${p(when.getUTCMinutes())}${p(when.getUTCSeconds())}`;
  return { date, dateTime: `${date}T${time}Z` };
}

/**
 * The signing key: four chained HMACs, secret first, `aws4_request` last.
 *
 * Exported so a test can pin the CHAIN rather than only the final signature.
 * If the final signature is wrong, this tells you whether the derivation or
 * the string-to-sign is at fault, which is the difference between a five
 * minute fix and an afternoon.
 */
export function signingKey({ secretAccessKey, date, region, service }) {
  const kDate = hmac(`AWS4${secretAccessKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * Canonical headers and the signed-header list, from a header object.
 *
 * Names lowercased, values trimmed with internal runs collapsed, sorted by
 * name. The sort is on the LOWERCASED name, which matters: `Host` and
 * `x-amz-date` sort differently before and after lowercasing, and AWS signs
 * the after.
 */
export function canonicalHeaders(headers) {
  const rows = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    canonical: `${rows.map(([n, v]) => `${n}:${v}`).join('\n')}\n`,
    signed: rows.map(([n]) => n).join(';'),
  };
}

/**
 * Sign one request and return the headers to send.
 *
 * `body` is a string or Buffer and is hashed as-is: the bytes signed and the
 * bytes sent must be the same object, which is the same rule
 * `scripts/billing/stripe.mjs` records for the Stripe webhook in the other
 * direction. Pass what you will send, not something that serialises to it.
 *
 * `when` is injected with no default. A signature is a function of the clock,
 * so a signer that reads `new Date()` itself cannot be tested against a fixed
 * vector -- and this repository's determinism rules already forbid a hidden
 * clock in anything reproducible.
 *
 * @returns {{authorization:string, headers:Record<string,string>,
 *            canonicalRequest:string, stringToSign:string, signature:string}}
 *   The extra fields past `headers` are returned for tests and for a failure
 *   log; nothing in the request path needs them.
 */
export function signRequest({
  method,
  url,
  headers = {},
  body = '',
  accessKeyId,
  secretAccessKey,
  sessionToken = null,
  region,
  service,
  when,
  // OFF BY DEFAULT, AND THAT IS WHAT MAKES THIS FILE TESTABLE. `x-amz-content-sha256`
  // is REQUIRED by S3 and merely permitted elsewhere; Rekognition does not want
  // it. Signing it unconditionally would be harmless on the wire -- it is signed
  // and sent consistently -- but it changes SignedHeaders, so the signature
  // would no longer match AWS's published `get-vanilla` vector and there would
  // be nothing left to check this implementation against without credentials.
  // A correctness property that can only be verified in production is not one.
  contentSha256Header = false,
}) {
  if (!accessKeyId || !secretAccessKey) {
    throw new TypeError('aws-sigv4: accessKeyId and secretAccessKey are required');
  }
  if (!region || !service) throw new TypeError('aws-sigv4: region and service are required');
  if (!(when instanceof Date) || Number.isNaN(when.getTime())) {
    throw new TypeError('aws-sigv4: `when` must be a Date and has no default -- a signature is a function of the clock');
  }

  const target = new URL(url);
  const { date, dateTime } = amzDates(when);

  // The host header is signed, and it comes from the URL rather than from the
  // caller's header object: a caller that could set `host` independently of
  // where the request actually goes could sign for one host and post to
  // another, which is the shape of the credential-scoping bug this project
  // already fixed once in the fal adapter.
  const payloadHash = sha256Hex(body);
  const signedSet = {
    ...headers,
    host: target.host,
    'x-amz-date': dateTime,
    ...(contentSha256Header ? { 'x-amz-content-sha256': payloadHash } : {}),
    ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
  };

  const { canonical, signed } = canonicalHeaders(signedSet);
  // CANONICAL QUERY IS `searchParams.toString()` AND THAT IS ONLY CORRECT
  // BECAUSE NOTHING HERE SENDS A QUERY STRING. AWS wants each name and value
  // URI-encoded to its own rules and then sorted by encoded name, and
  // `URLSearchParams` sorts nothing and encodes a space as `+` where AWS
  // demands `%20`. The single caller posts to a bare `/`, so the value is the
  // empty string and the difference cannot arise. Anyone adding a query
  // parameter has to write the encoder first, so a query string is REFUSED
  // here rather than silently signed with the wrong rules -- a signature that
  // is wrong only for some inputs is worse than one that is always wrong,
  // because it ships.
  if (target.search) {
    throw new TypeError(
      `aws-sigv4: refusing to sign ${target.pathname}${target.search} -- canonical query encoding is not implemented. ` +
      'AWS requires per-parameter URI encoding and a sort by encoded name; URLSearchParams does neither. ' +
      'Write that encoder before signing a request with a query string.',
    );
  }
  const canonicalRequest = [
    method.toUpperCase(),
    target.pathname || '/',
    target.searchParams.toString(),
    canonical,
    signed,
    payloadHash,
  ].join('\n');

  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [ALGORITHM, dateTime, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto
    .createHmac('sha256', signingKey({ secretAccessKey, date, region, service }))
    .update(stringToSign, 'utf8')
    .digest('hex');

  const authorization =
    `${ALGORITHM} Credential=${accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;

  return {
    authorization,
    signature,
    canonicalRequest,
    stringToSign,
    headers: { ...signedSet, authorization },
  };
}
