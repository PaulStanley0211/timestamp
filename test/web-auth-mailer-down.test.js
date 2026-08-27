/**
 * WHEN THE MAILER IS BROKEN, THE PAGE MUST NOT CLAIM IT SENT A CODE.
 *
 * `signup` throws its upstream answer away on purpose -- spec §4.4, and the
 * comment in `server.mjs` explains why: an address that already exists and one
 * that does not must reach the same page, or the form becomes a membership
 * oracle for a service that stores photographs of people's faces. That ruling
 * is not in question here and none of it changes.
 *
 * What it did NOT anticipate is the mailer being down. Supabase answers
 * `500 unexpected_failure / "Error sending confirmation email"` when its SMTP
 * relay refuses, the catch swallowed that with everything else, and `/verify`
 * then told the person "We sent a six-digit code to <address>. It lasts an
 * hour." -- a sentence the server already knew to be false. Measured
 * 2026-08-27 against the live project: a free Resend sandbox delivers only to
 * the address that owns the Resend account and 500s for every other one, so
 * this was not a rare transient. It cost a day of looking in spam folders for
 * mail that had never been sent.
 *
 * THE SIGNAL IS SERVICE-WIDE, AND THAT IS THE WHOLE DESIGN. A per-address
 * error would leak precisely what §4.4 hides: with a broken relay a NEW
 * address 500s (a send was attempted and failed) while an EXISTING one gets
 * Supabase's masked 200 (no send attempted at all), so showing the failure
 * only to the address that caused it would answer "does this address have an
 * account?" out loud. The flag below is therefore a property of THIS SERVER's
 * mail delivery, shown to everybody for a few minutes after any failure, for
 * any address. It reveals that our mailer is broken -- which is our fault and
 * not a fact about the person reading it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  startWithFakeSupabase, postForm, getPage, TEST_EMAIL,
} from './web-auth-code.test.js';

/** Exactly what the live project answers when its SMTP relay refuses. */
const MAIL_REFUSED = {
  status: 500,
  json: { code: 500, error_code: 'unexpected_failure', msg: 'Error sending confirmation email' },
};

/** Signs up once through a Supabase whose `/signup` fails the given way, and
 *  returns the `/verify` page a browser lands on straight afterwards. */
async function signupThenVerifyPage(t, { mailWorks }) {
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {
    pendingConsent: null,
    reply: async ({ pathname }) => {
      if (pathname.endsWith('/auth/v1/signup')) {
        return mailWorks ? { status: 200, json: { user: { id: 'u1', email: TEST_EMAIL } } } : MAIL_REFUSED;
      }
      return { status: 200, json: {} };
    },
  });
  const posted = await postForm(
    `${base}/signup`,
    { email: TEST_EMAIL, password: 'a genuinely long password', consent: 'on', csrf },
    cookie,
  );
  const landed = await getPage(`${base}/verify?email=${encodeURIComponent(TEST_EMAIL)}`, cookie);
  return { posted, body: await landed.text(), status: landed.status };
}

test('a mailer that refused the send does not leave /verify claiming a code was sent', async (t) => {
  const { body } = await signupThenVerifyPage(t, { mailWorks: false });

  assert.doesNotMatch(body, /We sent a six-digit code/,
    'the page still claims a code was sent, which the server already knew was false');
  assert.match(body, /could not send/i,
    'the page does not say the send failed, so the reader has nothing to act on');
});

test('a healthy mailer raises no alarm -- the ordinary page is unchanged', async (t) => {
  const { body, status } = await signupThenVerifyPage(t, { mailWorks: true });

  assert.equal(status, 200);
  assert.match(body, /We sent a six-digit code/, 'the ordinary sentence went missing');
  assert.doesNotMatch(body, /could not send/i,
    'a working mailer must not show a delivery warning, or the warning means nothing');
});

test('the signup response itself is unchanged, so the address is still not an oracle', async (t) => {
  // THE GUARANTEE §4.4 BUYS, RE-PROVED. Whether the mail left or not, the POST
  // answers with the same status and the same destination -- the difference is
  // visible only on a page every visitor sees identically, never in the reply
  // to the address that was typed.
  const broken = await signupThenVerifyPage(t, { mailWorks: false });
  const working = await signupThenVerifyPage(t, { mailWorks: true });

  assert.equal(broken.posted.status, working.posted.status,
    'a failed send answers with a different status, which distinguishes the address');
  assert.equal(broken.posted.headers.get('location'), working.posted.headers.get('location'),
    'a failed send lands somewhere else, which distinguishes the address');
});

test('a resend the mailer refused does not answer "on its way"', async (t) => {
  // THE SAME LIE, THROUGH THE OTHER DOOR. `resendSignupCode` swallows its own
  // upstream error by contract and returns `{ ok: true }`, so before this the
  // page answered `RESEND_SENT_MESSAGE` whether or not anything was sent --
  // and this is the button a person presses precisely BECAUSE no code arrived.
  // Leaving one of the two mail paths quietly reassuring would have set up the
  // identical hunt a second time.
  const { base, csrf, cookie } = await startWithFakeSupabase(t, {
    pendingConsent: null,
    reply: async ({ pathname }) => (pathname.endsWith('/auth/v1/resend')
      ? MAIL_REFUSED
      : { status: 200, json: {} }),
  });

  const res = await postForm(`${base}/verify/resend`, { email: TEST_EMAIL, csrf }, cookie);
  const body = await res.text();

  assert.equal(res.status, 200, 'the answer shape must not change -- see the oracle test above');
  assert.doesNotMatch(body, /on its way/i, 'the page promises a code the mailer refused to send');
  assert.match(body, /could not send/i, 'the reader is told nothing about why no code is coming');
});
