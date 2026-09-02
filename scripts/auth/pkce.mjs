/**
 * PKCE, by hand, because taking a dependency for it was decided against.
 *
 * WHY PKCE AT ALL. Supabase's implicit flow returns the token in the URL
 * FRAGMENT, which a browser never sends to a server. Only client-side
 * JavaScript can read a fragment and this app has none by rule, so the implicit
 * flow is not merely worse here -- it is unreadable. Spec decision 3, §3.
 *
 * WHY THE RFC VECTOR IS IN THE TEST. A challenge derived slightly wrong fails
 * at the token exchange with an error that names the code, not the derivation,
 * and costs an afternoon.
 */
import crypto from 'node:crypto';

const b64url = (buf) => buf.toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 32 random bytes, base64url. RFC 7636 permits 43-128 characters; this is 43. */
export function newVerifier({ rand = crypto } = {}) {
  return b64url(rand.randomBytes(32));
}

/** base64url(SHA-256(verifier)), the `S256` method. Never `plain`. */
export function challengeFor(verifier) {
  if (typeof verifier !== 'string' || verifier.length === 0) {
    throw new TypeError('challengeFor needs a verifier');
  }
  return b64url(crypto.createHash('sha256').update(verifier, 'ascii').digest());
}

/** The CSRF token of the OAuth round trip. Spec §4.2: not decorative. */
export function newState({ rand = crypto } = {}) {
  return b64url(rand.randomBytes(32));
}
