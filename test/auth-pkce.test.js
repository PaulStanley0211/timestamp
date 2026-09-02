import test from 'node:test';
import assert from 'node:assert/strict';

import { newVerifier, challengeFor, newState } from '../scripts/auth/pkce.mjs';

// RFC 7636 Appendix B. If this vector fails, the challenge is wrong and every
// Google sign-in fails at the exchange with an error that blames the code.
test('challengeFor matches the RFC 7636 appendix B vector', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(challengeFor(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('a verifier is base64url, unpadded, and long enough to matter', () => {
  const v = newVerifier();
  assert.match(v, /^[A-Za-z0-9_-]+$/);
  assert.ok(v.length >= 43, `verifier too short: ${v.length}`);
});

test('two states are never equal', () => {
  assert.notEqual(newState(), newState());
});
