# Supabase identity, files underneath — the login-page slice

**Date:** 2026-08-26 · **Status:** written, approved in chat by the owner
2026-08-26, not started. **No implementation code before the plan is written.**

**Scope:** the login page grows a "Sign in with Google" button and a "Forgot
password?" link, and both work, and a new account is confirmed by typing a
six-digit code rather than clicking a link. Identity — password verification, Google
sign-in, password reset — moves to Supabase Auth. **Accounts, credits, sessions
and job ownership stay exactly where they are: files.**

**Parent document, and the rule for reading this one.**
`docs/superpowers/specs/2026-08-25-supabase-identity-money-design.md` owns the
architecture. This document is a **slice of it**, not a replacement and not a
competitor. Where the parent states a rule, this document cites it and does not
restate the reasoning. Where this document differs from the parent, it says so
in the open and says why. Read the parent's §1 before this file's §1; the seam
is the parent's design and it survives verbatim in shape.

---

## 0. What the owner decided on 2026-08-26

Five decisions, taken in conversation, inputs rather than proposals:

1. **Identity slice first.** The parent spec's decision 1 was "full migration —
   accounts, credits AND sessions all move to Postgres". That is now **two
   projects instead of one, sequencing only**. The destination is unchanged. The
   money ledger does not move in this slice and nothing here forecloses moving
   it later.

2. **Both Google AND email/password move to Supabase.** Not Google alone.
   The deciding fact: Supabase cannot mail a reset link for a password it does
   not hold, so leaving passwords local would leave the forgot-password half of
   the request unsolved and still require choosing a mail transport.

3. **The PKCE exchange is hand-rolled over `fetch`. Zero npm dependencies
   survive.** This reverses the parent's §7.3 recommendation to take
   `@supabase/auth-js`, and it is the owner's call on the owner's standing rule.
   CLAUDE.md §2 already named zero-dependency as the thing the
   PostgREST-over-`fetch` choice exists to protect; this keeps that true.
   Parent open question 4 is hereby **closed: hand-rolled**.

4. **Email confirmation is ON, and the free grant moves to first confirmed
   login.** Parent open question 1 is hereby **closed: on**. This is what
   `2026-08-24-credit-packs-pricing-design.md` §3 already asked for — the free
   tape gated behind email verification — and this is the first build that can
   send mail at all. A Google sign-in arrives with `email_verified` already
   true and is never gated by this.

5. **The email is confirmed by a SIX-DIGIT CODE THE PERSON TYPES, not by a link
   they click.** Added 2026-08-26 at the owner's request and confirmed back to
   him before writing. Supabase sends a code instead of a magic link when the
   template carries `{{ .Token }}`; the person enters it on our page, we verify
   it, and they land on an onboarding page already signed in.

   **This is a simplification, not an extra feature.** The link flow sends a
   person out of our tab, through Supabase, and back — and that round trip is
   precisely where the redirect allow-list, the `state` match and the exchange
   can each fail, and where somebody on a phone finishes in a different browser
   than they started in. A typed code has no round trip at all. After this
   decision the redirect allow-list matters **only for Google**, and signup
   confirmation stops touching §4.2's machinery entirely.

**Also settled here, adopting the parent's recommendations without re-arguing
them:** a completed reset destroys every session for the account (parent open
question 9 → **yes**), and the Supabase session is revoked at the door (parent
open question 10 → **yes**; see §5 for the reset-flow interaction the parent
flagged, which is resolved rather than inherited).

---

## 0.1 A correction to CLAUDE.md §2, verified 2026-08-26

CLAUDE.md §2 lists among the costs accepted for choosing Supabase:

> **Deployment moves earlier**, because Google OAuth needs registered redirect
> URLs, so a real domain and TLS — the sign-in flow cannot be fully tested on
> localhost.

**This is wrong, and it is wrong twice.** It should be corrected in CLAUDE.md as
part of this work, because it is load-bearing for sequencing: taken at face
value it says the login page cannot be seen working until the app is deployed.

1. Google's own documentation exempts localhost from the HTTPS rule:
   *"Redirect URIs must use the HTTPS scheme, not plain HTTP. Localhost URIs
   (including localhost IP address URIs) are exempt from this rule."*
   (`developers.google.com/identity/protocols/oauth2/web-server`)

2. More decisively, **in this architecture Google never sees our URL at all.**
   The Authorized redirect URI registered in the Google console is *Supabase's*
   callback, `https://<project-ref>.supabase.co/auth/v1/callback`. Supabase then
   redirects to us, and Supabase's own redirect allow-list explicitly supports
   `http://localhost:3000/**` for local development.

The full Google round trip is therefore testable against `127.0.0.1:3000`.
Deployment does not move earlier. **This does not reopen the choice of
Supabase** — it removes one stated cost of a decision already taken.

---

## 1. The seam

Unchanged in signature from the parent's §1, changed in backend:

```
resolveIdentity({ supabaseUserId, email, emailVerified, provider })
  -> { accountId, created }
```

It is the only place in the codebase where a Supabase identity becomes an
application account. Above it is protocol; below it is `accounts.mjs` and the
files it already writes. It lives in a new module, `scripts/auth/identity.mjs`,
so that the Postgres version can later replace its internals without any caller
changing.

**Stored:** `supabaseUserId` on the account record, alongside the fields that
are there today.

**Discarded immediately, and never written anywhere:** the Supabase
`access_token`, `refresh_token`, `provider_token` and `provider_refresh_token`.
Not in a cookie, not in a file, not in a log, not passed on to any other
function. Parent §1.1 owns this reasoning.

### 1.1 Storage, concretely

`account.json` gains one field:

| Field | Type | Notes |
|---|---|---|
| `supabaseUserId` | uuid string or `null` | `null` only for an account that predates this slice and has not yet been claimed |

`password` is **nulled on claim**, not kept. A scrypt hash that no longer gates
anything is a liability with no remaining benefit. `hashPassword`,
`parsePassword` and `verifyPassword` stay in the module for the migration tests
and for the record; nothing in the request path calls them.

A second index directory, `out/accounts/_index-supabase/<supabaseUserId>`,
mapping a Supabase user id to an account id. It exists because **the Supabase
user id is the stable key and the email is not** — a person can change their
address at the provider. The existing `_index` on email hash stays, because the
claim path in §3 needs it and `findAccountByEmail` still has callers.

Both indexes are written under the account lock that `createAccount` already
takes, so a crash cannot leave one index pointing at an account the other does
not know about.

---

## 2. What this slice does NOT do

Stated early and explicitly, because the parent spec's scope is much larger and
the difference is the entire point of slicing:

- `scripts/auth/credits.mjs` — **untouched.** No ledger migration, no PL/pgSQL,
  no `ledger_once` index. Parent §3 does not apply to this slice.
- `scripts/auth/session.mjs` — **untouched.** Sessions stay files. The parent's
  §2.3 rewrite does not happen here. Our session is already "our own session";
  decision 3 of the parent is satisfied by what exists.
- Job ownership, the queue, the render pipeline — untouched, as in the parent.
- RLS, PostgREST, the schema document, the Postgres test runtime — **not
  reached.** Parent open questions 2, 3, 6, 7 stay open and stay the parent's.
- Stripe, plans and pricing — untouched.

**No Postgres is provisioned by this slice.** Supabase is used as an
authentication service and nothing else. The project's database sits unused
until the second slice.

---

## 3. The four flows

Protocol lives in `scripts/auth/supabase-auth.mjs`. Every one of these ends at
`resolveIdentity` and then at `createSession`, which already exists.

**Signup.** `POST /auth/v1/signup`. With confirmation on, Supabase returns a
user and **no session** — there is nobody to sign in and nobody to grant credits
to yet. The local account is **not** created at this moment. See §6 for what is
kept in the meantime and why.

**Code entry — where the account is actually born.** Signup redirects to
`GET /verify?email=…`, a page whose only content is a six-digit field and the
address the code went to. `POST /verify` calls
`POST /auth/v1/verify` with `{ type: 'signup', email, token }`. On success
Supabase returns the identity, `resolveIdentity` creates the account, **the
21-credit free grant is issued here**, our session is minted, and the person is
redirected to `/onboarding` already signed in. This is the structural change
decision 4 buys: the grant sits behind a verified mailbox.

The page needs a **resend** control, because a code that never arrives is the
single most common way this flow strands somebody. Supabase permits one request
per address per 60 seconds; the button says so rather than failing silently.
Codes expire after one hour by default.

**A person who closes the tab is not lost.** `GET /verify` is reachable without
a session — it takes the address as a parameter and is safe to bookmark, because
possession of the code, not possession of the URL, is what proves anything.

**Email login.** `POST /auth/v1/token?grant_type=password` → `resolveIdentity` →
our session → revoke Supabase's.

**Google.** `POST /auth/google` (a plain form carrying the existing CSRF token,
matching server.mjs's rule that these are plain forms) →
generate `code_verifier` (32 random bytes), `code_challenge` =
base64url(SHA-256(verifier)), and `state` → persist both server-side against a
short TTL → 303 to Supabase's
`/auth/v1/authorize?provider=google&code_challenge=…&code_challenge_method=S256`
→ Google → Supabase → `GET /auth/callback?code=&state=` → match `state`, look up
the verifier, `POST /auth/v1/token?grant_type=pkce` → `resolveIdentity` → our
session.

**PKCE is mandatory and the reason is this repo's zero-JavaScript rule.**
Supabase's implicit flow returns the token in the URL *fragment*, which a
browser never sends to a server. Only client-side JavaScript can read a
fragment, and this app has none by rule. Parent §1.2 owns this argument.

**Reset.** `POST /auth/reset` → `POST /auth/v1/recover` → Supabase mails a link →
`GET /auth/reset/callback` exchanges the code → a set-password form →
`POST /auth/reset/complete` → `PUT /auth/v1/user` with the new password →
**`destroySessionsForAccount`**.

### 3.1 The claim path — how the six existing accounts survive

There are six accounts today. Their scrypt passwords **cannot** be imported:
Supabase accepts bcrypt and argon2, not this repo's `scrypt$N$r$p$salt$hash`
encoding. Parent §5.4 asserted this and flagged it unverified; this slice does
not depend on the assertion being right, because it never attempts an import.

They migrate by signing up with the same address. Supabase has no user for that
address, so signup succeeds; confirmation is on, so the mail proves the mailbox;
at first confirmed login `resolveIdentity` finds the existing account through
the email-hash index, stamps `supabaseUserId` onto it, nulls `password`, and
**does not grant credits** — `created` is false, so the free grant does not fire
and the existing ledger, plan and history are preserved untouched.

`dev@example.com` cannot travel this path: the domain is not real and no mail
can arrive. See §7.

---

## 4. The two rules that are account takeover if they are wrong

**4.1 Claiming an existing account by email REQUIRES `emailVerified === true`.**
If `resolveIdentity` matches an existing account by email hash without that
check, then anyone who can get Supabase to hand us an unverified identity for an
address inherits the account at that address — its credits, its plan, its
rendered tapes. Verified email is the proof of mailbox control and it is the
whole basis on which a claim is allowed. An unverified identity whose email
matches an existing account **refuses**; it does not create a second account and
it does not claim the first. Parent §2.1 states the same rule.

**4.2 `state` is not optional and is not decorative.** The callback must reject
any `code` that does not arrive with a `state` this server issued and has not
yet consumed. Without it the callback accepts a code an attacker obtained
elsewhere, and the victim is signed into the **attacker's** account — which
means the victim's next upload lands in an account the attacker can read.

The verifier and state live in a short-lived, **single-use** server-side file
(`out/oauth/<state>.json`, deleted on use, TTL measured in minutes), for the
same reason sessions are files rather than self-contained cookies: a file can be
deleted after one use and a cookie cannot be made single-use. A sweeper runs
alongside the existing `sweepExpiredSessions`.

**4.3 The enumeration oracle comes back through a helpful upstream.**

`authenticate` today returns one error, one message and one amount of work for
an unknown email and a wrong password, and burns a scrypt derivation on the
unknown-email path so the wall clock does not answer the question either.

Supabase returns **distinguishable** errors: `invalid_credentials`,
`email_not_confirmed`, `over_request_rate_limit`. Rendering `email_not_confirmed`
tells a stranger that the address they typed has an account on a service that
stores photographs of people's faces. That is a disclosure about a person.

**Every Supabase auth failure collapses to `BAD_CREDENTIALS_MESSAGE` and nothing
else reaches a page.** `POST /auth/reset` answers identically for a known and an
unknown address. The timing asymmetry becomes Supabase's to leak rather than
ours and is not fixable from here; it is named in §10 rather than pretended away.

The `over_request_rate_limit` case must not become a silent dead end for a
legitimate person, so it is logged server-side with enough detail to diagnose
while the page still says only the one sentence. The existing per-IP limiter in
`scripts/web/rate-limit.mjs` still fronts these routes; Supabase's limit is a
backstop, not the first line.

**4.4 Signup leaks "User already registered", and it is OUR job to swallow it.**
Added 2026-08-26 after checking the behaviour rather than assuming it.

Supabase returns an obfuscated, fake user object for a signup against an
existing address **only when email confirmation AND phone confirmation are both
enabled**. With either one off it returns the error "User already registered".
The live project reports `"phone": false`, so **this project takes the leaking
path**, and turning phone confirmation on to fix it would mean adopting SMS,
Twilio and a per-message cost to close a hole we can close in our own handler
for nothing.

So the signup route **must not surface Supabase's signup error at all**. A
successful signup and a signup against an existing address render the identical
page — the same "check your email" sentence, the same status, the same headers.
The person who genuinely owns that address still receives mail from the earlier
account and can reset; the stranger probing addresses learns nothing.

This is the same oracle as §4.3 arriving through a different door, and it is
worth stating separately because the fix is in a different handler and a test
that covers login says nothing about signup.

**4.5 A six-digit code with unguarded attempts is not a control, it is
decoration.** Decision 5 introduces a secret with **one million possible
values** and a one-hour life. A script making a few hundred guesses a second
walks the whole space inside that window. Everything that makes this safe is
the attempt limit, so the limit is part of the feature and not an enhancement
to it.

Three bounds, all of them ours and none of them delegated upstream:

- **Per code.** A small fixed number of wrong answers — five — and the code is
  dead. Not throttled, dead: the person requests a new one. An attacker who can
  keep retrying at any rate has a million-guess budget, and a slow million is
  still a million.
- **Per address.** Repeated failures against one address across successive codes
  are the shape of an attack, not of somebody misreading their phone. The
  address stops accepting attempts for a cool-off period.
- **Per IP.** `scripts/web/rate-limit.mjs` already exists and already fronts the
  auth routes. `/verify` joins them.

**A wrong code and an expired code and a code for an address that never signed
up must all answer identically**, for §4.3's reason. "That code has expired"
tells a stranger the address is real.

Supabase applies limits of its own. **They are not the control here.** They are
upstream defaults that can change without notice and are shared across every
route in the project; a design that leans on them cannot state what its own
guarantee is. Ours are testable and ours are asserted.

---

## 5. The transport, and the bug this repo has already paid for once

`supabase-auth.mjs` takes an injected `fetchImpl` and **has no default**, for
exactly the reason `providers/fal.mjs` and `billing/stripe.mjs` have none: a
test that forgets to inject one must get a `TypeError` rather than reach the
network.

**That guard only works if production actually injects it somewhere.** CLAUDE.md
records what happened the last time it did not — the paid path could not reach
the network at all and failed with the money guard's own error, which read like
a test bug and was a missing wire, and the same hole existed in the worker for a
day after it was fixed in the renderer. So: **the injection goes in
`scripts/web/server-cli.mjs`**, the file that already injects the Stripe
transport and already loads `.env`, and it is the only place that does it. No
other command in this repo needs to authenticate a person.

**Configuration is three values**, corrected 2026-08-26 against the current
docs and verified against the live project:

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

**Two corrections to what this section said when it was first written.**

**The key names changed.** New projects issue `sb_publishable_…` and
`sb_secret_…`; the legacy `anon` / `service_role` JWT keys still work but are
not what a project created today presents. Any instruction naming
`SUPABASE_ANON_KEY` is describing a project older than this one.

**A secret key IS required, and the earlier claim that none was needed was
wrong.** Supabase Auth rate-limits **per IP address**, token bucket, 30 requests
to a bucket. A server-side app calling the auth endpoints for everybody presents
**one IP**, so every person's sign-in would draw on a single shared bucket and
one determined user would lock out the rest. The documented remedy is the
`Sb-Forwarded-For` header carrying the end user's real IP — **and that header is
only honoured when the request is made with a secret key.** Per-user rate
limiting is not optional for a login page, so the secret key is not optional
either.

That costs the property this section originally claimed. The secret key confers
admin over the auth service — it can create and delete users. It sits in `.env`
beside `FAL_KEY` and `STRIPE_SECRET_KEY`, never reaches a browser (this app has
no client JavaScript by rule), and is used only by `server-cli.mjs`. **It must
never be logged and never rendered.** The publishable key is kept for the calls
that do not need elevation, so that the secret key's blast radius stays as small
as the design allows.

**Verified against the live project on 2026-08-26** (`wtwldjflvmpwoxblqect`):
`GET /auth/v1/settings` with the publishable key returns 200 with
`"google": true`, `"email": true` and `"mailer_autoconfirm": false`; the secret
key returns 200 on `/auth/v1/admin/users` and the publishable key returns 401 on
the same endpoint. Provider, password login and email confirmation are on, and
the two keys carry the privileges this design assumes.

`npm run doctor` should report both as present/not-set without printing them.
Note the known gap recorded in CLAUDE.md: `doctor` has no
`--env-file-if-exists`, so it reports "not set" for a correctly configured `.env`
unless invoked as
`node --env-file-if-exists=.env scripts/preflight/doctor.mjs`.

**The reset-flow interaction the parent flagged (open question 10) resolves
cleanly:** revoke-at-the-door happens *after* the identity is resolved and,
in the reset flow, *after* `PUT /auth/v1/user` has used the token for its one
remaining call. The order is: exchange → resolve → use → revoke. There is no
conflict, only an ordering constraint, and it is stated here so the
implementation does not discover it.

---

## 6. Consent across a confirmation gap

`createAccount` records consent, and `assertConsent` requires it. With
confirmation on, the account is not created until the person clicks a link that
may arrive minutes or days after they ticked the box on our form.

**The signup form writes a pending-signup file** keyed by email hash, holding
the consent record produced by `recordConsent` and a TTL of 24 hours. First
confirmed login consumes it and passes it into `createAccount`. If it has
expired, the person is asked once, at first login, before the account is
created — a rare path, and correct rather than convenient.

**Consent text never goes to Supabase.** It is a legal record about an agreement
with this service and it stays in this service's files.

An unconfirmed signup therefore leaves a pending file and a Supabase user, and
**no local account and no credits**. The pending files sweep on the same timer
as the OAuth state files.

---

## 7. What breaks, and what does not

**`dev@example.com / timestamp-dev-password` stops working.** The domain is not
real, so no confirmation mail can arrive, so the account cannot be claimed. This
login is documented in CLAUDE.md's START HERE block and in the two-terminal
recipe. Local development signs in with a real address the owner controls
(`plstnly06@gmail.com` already exists as an account and claims cleanly).
CLAUDE.md, START HERE and the docs are updated in the same change — a documented
credential that does not work is worse than no documented credential.

The owner was offered a gated local bypass and **declined it**. There is
therefore no development back door, deliberately.

**The test suite is mostly unaffected, and this is the payoff of the slice.**
The 1284 tests create accounts through `createAccount` and sessions through
`createSession`, both of which still exist and still behave identically. Only
tests that drive the login *form* touch Supabase, and they take the fake
transport. No test in this repo may reach the network.

**`npm run accounts -- create` loses its meaning.** It can no longer mint a
password anybody can sign in with. Parent open question 5 applies unchanged and
is **still open**: it becomes an inspector, or it becomes `invite`, or it goes.
This slice does not need it and must not silently leave a command that appears
to create a working login and does not.

---

## 8. Testing

Test-driven, per the repo's rule, one failing test per commit.

The cases that carry the design:

1. **PKCE derivation against the RFC 7636 test vector.** A published vector is
   available and there is no excuse for deriving the challenge wrong.
2. **A callback with a `state` this server never issued is refused** — no
   session, no account touched.
3. **A verifier cannot be replayed.** Second use of the same `state` fails.
4. **Expired state is refused** rather than accepted late.
5. **Every distinguishable upstream error renders one message.** Parameterised
   over `invalid_credentials`, `email_not_confirmed`, `over_request_rate_limit`
   and an unexpected 500.
6. **`POST /auth/reset` answers identically** for a known and an unknown address,
   asserted on status, body and headers.
7. **A claim with `emailVerified: false` refuses** — the §4.1 rule, and the test
   that would have caught the takeover.
8. **A claim preserves the ledger.** Balance, plan and history identical before
   and after; `created` is false; no grant fires.
9. **A genuinely new account gets exactly one 21-credit grant**, at first
   confirmed login and not at signup, and a repeated callback does not grant
   twice.
10. **A completed reset destroys every session for the account** and leaves other
    accounts' sessions alone.
11. **Omitting `fetchImpl` throws `TypeError`** rather than reaching the network.
12. **`server-cli.mjs` injects the transport** — the test that Bug 1 did not have.
    Assert on the wiring, not on the protocol module in isolation, because a unit
    test of the protocol module passes while production is unwired.
13. **Signup against an existing address renders exactly what a new signup
    renders** — §4.4. Same status, same body, same headers, asserted on all
    three, with the upstream faked as "User already registered".
14. **`Sb-Forwarded-For` carries the end user's IP, not the server's** — §5.
    Without this the rate limiter buckets every user together, and the symptom
    is a login page that works for one person at a time.
15. **The code dies after five wrong answers** — §4.5. Assert the sixth attempt
    fails even when it carries the CORRECT code. This is the test that proves
    the limit is a limit and not a message.
16. **A wrong code, an expired code and a code for an unknown address are
    indistinguishable** — status, body and headers asserted equal.
17. **A correct code grants exactly once.** Replaying a consumed code creates no
    second account, mints no second session and issues no second grant.
18. **A verified code lands on `/onboarding` with a live session**, not on a
    page that asks the person to sign in again — the end-to-end assertion for
    decision 5.

Failure modes inherited from parent §1.3 and re-tested here in file terms: an
identity resolved but the account write failing must **fail closed** — no
session minted, the request errors, and the next login retries and converges.
A session minted against an account that does not exist would put a signed-in
person in front of a ledger that is not there.

---

## 9. Operator setup — the owner's click-list

None of this can be done from here; it needs consoles and an account.

1. Create a Supabase project. Note the project ref.
2. Google Cloud console → new OAuth 2.0 Client ID, type **Web application**.
   Authorized redirect URI: **`https://<project-ref>.supabase.co/auth/v1/callback`**
   — Supabase's callback, not ours.
3. Supabase → Authentication → Providers → Google → enable, paste the Google
   client id and secret.
4. Supabase → Authentication → URL Configuration → add
   `http://127.0.0.1:3000/**` to the redirect allow-list. (Localhost is
   permitted; see §0.1.)
5. Supabase → Authentication → enable **Confirm email**.
6. **Authentication → Email Templates → Confirm signup: put `{{ .Token }}` in
   the body.** Without this the template sends a magic link and decision 5 does
   not happen — the person receives a link where the page is asking them for a
   code, and nothing in the app can detect that the template is wrong. It is one
   edit in the dashboard and it is the whole of what makes the code flow real.
   Rewrite the wording around it too: the default copy says "confirm your mail"
   and points at a button that will no longer be there.
7. **There is no dashboard setting that suppresses "user already registered".**
   This step said there was, and that was wrong. The obfuscated response needs
   email *and* phone confirmation both on. §4.4 handles it in our own signup
   handler instead, which costs nothing and adopts no SMS provider.
8. Put `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` in
   `.env`. See §5 for why the secret key is needed and what it costs.
9. **Custom SMTP, and sooner than "before real volume".** Supabase's built-in
   mailer sends **2 recovery emails per hour for the whole project**, and
   confirmation mail shares the same constrained sender. With confirmation on,
   that number is the ceiling on signups and on password resets combined. It is
   adequate for one developer testing and it is not adequate for a third
   concurrent user. Treat it as a prerequisite for anyone but the owner using
   this, not as a launch-day nicety.
10. **Free projects pause after a week of inactivity.** A paused project means
   nobody can sign in, sign up or reset. Sessions already minted survive,
   because they are files here — which is decision 3 paying off, and not a
   reason to leave the project paused.

**Steps 1–5 and 8 were completed and verified on 2026-08-26.** Project ref
`wtwldjflvmpwoxblqect`. **Step 6 — the `{{ .Token }}` template edit — is NOT
done**, and until it is, Supabase mails a link to a person the app is asking for
a code. It is the one console step decision 5 added and the one step whose
omission the app cannot detect. What the verification could NOT prove is listed
in §10.

---

## 10. Open questions this slice leaves open

Deliberately, with the reason:

1. **What the 2026-08-26 verification could NOT prove.** `GET /auth/v1/settings`
   reports `"google": true` **whether or not the Google client id and secret are
   correct** — it reports that a provider is switched on, not that it works. Nor
   can it see the redirect allow-list or the Google console's test-user list.
   Parent §7 already ruled on this: the only evidence that settles the OAuth
   round trip is one real round trip. It cannot happen before the code exists,
   and it is the first thing to run once it does. Six causes share the one
   symptom "sign in with Google does not work"; expect to bisect them.
2. **~~Does a Google sign-in also get a code?~~ CLOSED 2026-08-26: NO.** The
   owner confirmed it after the trade-off was put to him in plain terms. Kept
   here with its reasoning because it is the kind of decision somebody re-opens
   in six months without knowing it was ever weighed. Google returns `email_verified: true`; a code after Google proves
   nothing that has not already been proven, so it would be friction sold as
   verification. It is also built differently — no signup is pending, so it
   would use `POST /auth/v1/otp` rather than the signup confirmation, and it
   would double the mail volume that §9.8 already calls the binding constraint.
   If the owner wants it, it is a genuine second factor and should be described
   as one.

3. **What the onboarding page IS. Defaulted to a stub.** Decision 5 names
   `/onboarding` as the destination and this app has no such page. The flow
   redirects there and the page says something true and minimal. What it should
   actually do — collect a name, explain the free tape, show the first upload —
   is a product question nobody has answered, and inventing an answer here would
   be inventing scope.

4. **What `npm run accounts -- create` becomes.** §7. Not needed to ship the
   login page; needed before the command misleads somebody.
5. **The login timing asymmetry is now Supabase's.** §4.3. Our own equal-time
   refusal was built deliberately and is measured by a test; once Supabase
   answers, the wall clock is outside our control. Named, not fixed, and not
   pretended away.
6. **Whether a Supabase project-level outage should degrade to anything better
   than a 503 on login.** Parent §1.3 notes everybody already signed in stays
   signed in, because sessions are ours. That property holds here for free.
   Whether the signed-out experience deserves more than an error page is a
   product question, not a security one.
7. **Account deletion.** Deleting a local account now leaves a Supabase user
   behind. Out of scope for the slice and it must not be forgotten — it is a
   privacy commitment in the consent text, which promises deletion.
8. **Everything in the parent's §9 that this slice does not reach:** questions
   2, 3, 6, 7 and 8 remain the parent's and remain unanswered. Question 11 —
   whether the scrypt import was genuinely impossible — is now **moot for this
   slice**, which never attempts an import.
