# The first real round trip — 2026-08-27

**The web app had never been driven by a person in a browser.** One evening of
trying to sign up as a real user found four defects, three of them in code that
1568 passing tests said was fine. This is what they were, how each was proved,
and what is still open.

None of them could have been found by reading the code or by running the suite.
Every one needed a human clicking a button — which is what the identity spec
already said about the OAuth round trip, and it turns out to have been true of
the whole slice.

---

## 1. Every form in the app was refused in a real browser — `0dbc91d`

**Symptom.** Signup, sign-in, verify, resend, password reset and the Google
button all answered *"We could not confirm that came from this site"* to every
real browser, every time. The app could not be signed up to at all.

**Cause.** The anti-forgery gate read `Origin` alone. Every page this server
sends carries `Referrer-Policy: no-referrer` — deliberate, so a `/j/<id>` url
can never ride out in a `Referer`. Chrome answers that policy by sending
`Origin: null` on a form POST, **including a same-origin one**. `new
URL('null')` throws; the catch returned false; the server called its own pages
forgeries.

**How it was proved**, after two wrong guesses (a stale page, then a
`127.0.0.1` vs `localhost` split — both stated before the evidence existed):

- a two-page probe differing in exactly that one header: with
  `Referrer-Policy: no-referrer` Chrome sent `origin="null"
  sec-fetch-site=same-origin`; without it, `origin="http://localhost:3100"`;
- the same token via `fetch` returned 200 while the identical request as a form
  navigation returned 403;
- `curl` with `Origin: null` reproduced the exact page, **without the email
  echo**, which pins it to the origin branch rather than the token branch.

**Fix.** `Sec-Fetch-Site` is asked first. It is a forbidden header name, so page
script cannot forge it, which makes it a better witness than an `Origin` the
referrer policy is entitled to blank. Only `same-origin` passes. When the header
is absent the old `Origin` reasoning stands unchanged.

**Why the suite missed it.** It only ever sent the two values a browser does not
send here: absent (undici's default, accepted) and `https://evil.example`
(refused). Both branches were covered. The value real browsers always produce
was untested, so the suite proved the two cases that never happen and none of
the one that always does.

## 2. Every pre-existing account was permanently unclaimable — `4f53dc6`

**Symptom.** A correct six-digit code, typed correctly, rejected with the same
sentence a wrong code gets. Supabase had verified it; ours failed one call later.

**Cause.** `supabaseUserId` was added to `createAccount` without bumping
`SCHEMA_VERSION` — reasonably, since no existing field changed. A record written
before it still loads as valid and simply has no such key, reading back
`undefined`. `claimAccount`'s guard is spelled `!== null`, which `undefined`
fails, so the account was refused as a takeover of an identity it had never had.

**Scope.** Six records were live in this store — every account that existed
before the identity slice, which is to say every real user the app has ever had.
`/verify` fails closed, correctly, and undiagnosably.

**Fix.** Normalised in `loadAccount`, so `claimAccount`, `identity.mjs` and
anything written later see one shape. Three tests, including one proving a
genuine rebind to a second different id is still refused.

## 3. `/verify/resend` did not resend — `6424f37`

It 303'd back to `/signup`, which only works if Supabase re-sends a confirmation
when signup is repeated for an unconfirmed user — never observed against the
live project. Now uses `POST /auth/v1/resend`. The assumption was removed rather
than tested.

## 4. Supabase was issuing 8-digit codes — dashboard, no commit

**Symptom.** Same as 2 from the outside: correct code, rejected.

**Cause.** *Authentication → Sign In / Providers → Email → Email OTP length* was
**8**. This app is six digits everywhere — both pages' copy, `maxlength="6"`, the
`[0-9]{6}` pattern, and the five-attempt argument in spec §4.5, which reasons
about a six-digit space. The form truncated an 8-digit code to 6 and Supabase
rejected the fragment.

**Trap worth naming: Supabase returns `otp_expired` for an invalid token too.**
So a truncated code reads as an expired one, and the page says "or it has
expired", sending the reader to look at the clock instead of the length.

**Set to 6 on 2026-08-27.** Nothing in the app detects a mismatch, so if that
dashboard field ever changes again this returns silently.

---

## Email sending — how it actually stands

**Custom SMTP is on, via Resend.** It had to be: the Confirm-signup template
editor is locked behind custom SMTP, Pro, or a Send Email hook, so spec §9 step
9 turned out to be a hard prerequisite of step 6 rather than a later scaling
concern. Enabling it also lifted Supabase's cap from 2 to 30 emails/hour.

- sender `onboarding@resend.dev`, host `smtp.resend.com`, port 465, username
  the literal word `resend`, password the `re_` API key;
- the Resend account is on **paulstanleyganganapalli@gmail.com**, and the free
  sandbox delivers **only to that address**;
- the template from `docs/supabase-email-templates/confirm-signup.html` is
  applied and verified end to end: sent, delivered, opened, six digits, no link.

**A verified sending domain is the real unlock.** Without one, mail can reach
nobody but the owner, and `onboarding@resend.dev` is a shared sandbox sender
that Gmail routinely files under Spam or Promotions — which cost an hour of
"the code isn't arriving" when it had arrived twice. `TIMESTAMP_PUBLIC_URL` is
still `localhost:3000`, so a domain is owed for deployment and for the blind
check regardless.

---

## Still open: Google sign-in returns 503, and only in the browser

`POST /auth/google` works. The app builds a correct authorize URL — PKCE
challenge, S256, state, redirect — and 303s to it. Then:

- **from this machine via Node: 302 → accounts.google.com**, every time;
- **from Chrome: 503 from Supabase**, every time, reproducibly.

Supabase reports `google: true` and the client ID is configured
(`108140308419-…apps.googleusercontent.com`), so the provider is not the
problem, and neither is our code.

**Ruled out by test, not by reasoning:** the PKCE parameters; the `?state=` in
`redirect_to`; the missing `apikey` header; `Accept: text/html`; a Chrome
user-agent; and `sec-fetch-site`/`mode`/`dest`. Each was sent from Node and each
still returned 302.

**Not yet ruled out:** cookies the browser holds for `supabase.co`, and anything
at Supabase's edge treating that browser differently. That is where to look next.

Note that until `0dbc91d` the Google button could not work at all — it was one
of the six forms the origin bug refused — so every earlier attempt at this
round trip was testing the wrong failure.

---

## What this says about the suite

Two of the four were invisible to 1568 passing tests, and both for the same
reason: the test exercised a request no browser makes. One measured an `Origin`
that is never sent; the other never wrote an account record in the shape the
disk actually holds. A sibling finding the same week — the scrypt equal-time
test, §4 — was the mirror image: a test measuring the machine instead of the
code. Same disease, opposite symptom.

The cheapest guard against this class is the one that found all four: **drive
the real thing, as a person, before believing the suite.**
