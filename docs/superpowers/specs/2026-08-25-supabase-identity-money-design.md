# Supabase identity, our own session, Postgres money — design

**Date:** 2026-08-25 · **Status:** written, not approved, not started. **No code
before this is approved** — CLAUDE.md START HERE item 8.

**Scope:** accounts, sessions, job ownership and the credit ledger move from
files to Postgres. Identity — password verification, Google sign-in, password
reset — moves to Supabase Auth. Jobs, the queue and the render pipeline do not
move.

**Companion documents, each owned by somebody else. Reference them; do not
duplicate them.**

| Document | Owns |
|---|---|
| `docs/superpowers/specs/2026-08-25-supabase-schema.md` | Every line of DDL: tables, columns, indexes, constraints, grants, migration files. |
| `docs/superpowers/specs/2026-08-25-postgres-test-runtime.md` | How a Postgres appears for a test run, measured. §7 here states the decision and the recommendation; that file states the numbers. |

**Predecessors, read before this:**

- `docs/superpowers/specs/2026-08-21-sqlite-identity-money-design.md` —
  SUPERSEDED as a deployment choice on the day it was written. Its
  **repository-seam approach**, its **test-count acceptance gate**, `ledger_once`
  **as a partial unique index**, **balance derived and never stored**, **expiry
  as an explicit negative row**, and the **never-delete migration with a
  per-account parity check** all survive verbatim and are not re-derived here.
  §4 corrects exactly one line of it.
- `docs/superpowers/specs/2026-08-24-credit-packs-pricing-design.md` §3 and §4 —
  the free tape, its global ceiling, and the ruling that a credit pack does NOT
  need any of this.

---

## 0. What is settled before this document starts

**THE CHOICE OF SUPABASE IS NOT RE-OPENED HERE AND MUST NOT BE.** CLAUDE.md §2
decided it on identity features and says so explicitly: Paul wants sign-in with
Google the way other apps have it, plus password login, plus password reset.
SQLite was the better *database* answer and lost on identity, not on data. This
document takes that as its floor.

Four further decisions were taken by the owner on 2026-08-25 and are inputs, not
proposals:

1. **Full migration.** Accounts, credits AND sessions all move to Postgres.
2. **Providers, first pass: Google and email/username/password. Nothing else.**
3. **"Supabase identity, our own session."** Supabase Auth verifies identity.
   On success the server resolves or creates a local profile row and **mints its
   own server-side session record**, and the app runs on that cookie from then
   on. The Supabase token is used at the boundary and not relied on afterwards.
   `session.mjs` keeps its public interface and swaps its backend from files to
   Postgres.
4. **The free signup grant is 21 credits**, ceiling `freeTape.globalCeiling`
   default 100.

**Decision 4 is ALREADY BUILT.** `config/credits.json` carries
`plans.free.creditsPerPeriod: 21` and `freeTape.globalCeiling: 100`;
`reserveFreeTape` / `releaseFreeTape` / `freeTapeState` exist in
`accounts.mjs` and there are 13 tests in `test/auth-free-tape.test.js`
including an eight-thread race. This document migrates that mechanism; it does
not introduce it. START HERE item 9 is stale on this point.

### Why decision 3 is the whole shape of this design

A JWT cannot be revoked. `session.mjs` makes the argument in its own header and
the sentence that ends it is the reason this app cannot rent its session layer:

> this service already holds their face.

Logging out has to kill the credential, not politely discard the browser's copy.
A row can be deleted; a signature cannot be un-signed. There is a test that
destroys a session and proves it is dead on the very next read, and it survives
this migration unchanged.

**This is a deliberate divergence from one line of CLAUDE.md §2**, which
recorded the then-current position as "sessions become JWTs, isolation becomes
RLS". Decision 3 supersedes that line, and it is a consequence of a later
decision by the owner rather than a re-litigation of §2's ruling. §5.7 and §9
carry what that divergence costs.

---

## 1. The seam: how a Supabase identity becomes a local session

One function, called from every flow, and it is the only place in the codebase
where a Supabase identity turns into an application account:

```
resolveIdentity({ supabaseUserId, email, emailVerified, provider })
  -> { accountId, created }
```

Everything above it is protocol. Everything below it is our Postgres. Nothing
either side of it holds a Supabase token.

### 1.1 What is stored and what is discarded

**Stored, on the profile row:** `account_id` (ours, 32 lowercase hex),
`supabase_user_id` (uuid, UNIQUE, NULLABLE — see §3.4), `email` (normalised),
`plan`, `consent`, `created_at`, `updated_at`, `rev`.

**Discarded, immediately, and never written anywhere:** the Supabase
`access_token`, the `refresh_token`, the `provider_token` and
`provider_refresh_token` Google returns through Supabase. They are not put in a
cookie, not put in a column, not logged, and not passed to any other function.

**RECOMMENDED, AND IT IS A DECISION RATHER THAN HYGIENE: revoke at the door.**
After the identity is resolved, `POST /auth/v1/logout` with the access token, so
the Supabase session dies at the boundary and the only live credential for this
person is the one we minted. Without it, Supabase holds a refresh token for a
session this app does not use and cannot see, and "log out" stops being true
about every credential that exists. The cost is one extra HTTP round trip on
login. See open question 10 — the interaction with password reset needs
checking, because the reset flow needs the token for one more call.

### 1.2 The four flows

**Email signup.** `POST /auth/v1/signup` with email and password. Supabase
returns a user with an id. Then `resolveIdentity`, then a local session.

**IF EMAIL CONFIRMATION IS ON, THE FREE GRANT MOVES.** With confirmation
required Supabase returns a user and no session, and there is nobody to give
credits to yet. The profile row and its opening ledger entry are then written on
the **first confirmed login**, not at signup. That is a structural change to
where `reserveFreeTape` is called, and it is the right change: §3 of the pricing
spec asks for the free tape to be "gated behind email verification", and this is
the first build that can actually send mail. Open question 1.

**Email login.** `POST /auth/v1/token?grant_type=password`. Then
`resolveIdentity`, then a local session, then §1.1's revoke.

**THE ENUMERATION ORACLE COMES BACK THROUGH A HELPFUL UPSTREAM, AND THIS IS THE
EASIEST THING IN THE WHOLE MIGRATION TO GET WRONG.** `authenticate` today
returns one error, one message and one amount of work for an unknown email and a
wrong password, and burns a scrypt derivation on the unknown-email path so the
wall clock does not answer the question either. Supabase returns
**distinguishable** errors: `invalid_credentials`, `email_not_confirmed`,
`over_request_rate_limit`. Rendering `email_not_confirmed` tells a stranger that
the address they typed has an account here, on a service that stores photographs
of people's faces. **Every Supabase auth failure collapses to
`BAD_CREDENTIALS_MESSAGE` and nothing else reaches a page.** The timing
asymmetry is now Supabase's to leak rather than ours, and it is not fixable from
here; it is named in §9 rather than pretended away.

**Google OAuth round trip. PKCE IS MANDATORY AND THE REASON IS THIS REPO'S
ZERO-JAVASCRIPT RULE.** Supabase's implicit flow returns the token in the URL
**fragment**, which a browser never sends to a server — only client-side
JavaScript can read it, and this app has none by rule. So the flow is:

1. `GET /auth/google` — generate `code_verifier` (32 random bytes), derive
   `code_challenge` = base64url(SHA-256(verifier)), generate `state`, persist
   both server-side against a short TTL, 303 to
   `/auth/v1/authorize?provider=google&code_challenge=...&code_challenge_method=S256&redirect_to=<our callback>`.
2. Google authenticates, redirects to Supabase, Supabase redirects to our
   callback with `?code=` and `?state=`.
3. `GET /auth/callback` — match `state`, look the verifier up, exchange at
   `POST /auth/v1/token?grant_type=pkce`, `resolveIdentity`, mint a session.

The verifier lives in a short-lived server-side row (owned by the schema doc),
not in a cookie, for the same reason the session does: a row can be deleted
after one use and a cookie cannot be made single-use. **`state` is not optional
and is not decorative** — without it the callback accepts a code an attacker
obtained, which logs the victim into the attacker's account.

**Password reset.** `POST /auth/v1/recover` → Supabase mails a link → the link
lands on our callback with a code → exchange → `PUT /auth/v1/user` with the new
password.

**A COMPLETED PASSWORD RESET MUST CALL `destroySessionsForAccount`.** People
reset a password because somebody else has it. Supabase revoking its own tokens
does nothing to ours, and ours are the ones that work. This is a behaviour
change a person will notice — every device signed out — and it is the correct
one. Open question 9.

`POST /auth/v1/recover` must answer the same way for a known and an unknown
address, for §1.2's reason.

### 1.3 The failure modes, named

**Supabase says yes and the local profile write fails.** This is the one that
matters and it is reachable, not theoretical.

**Fail closed.** No session is minted, the request errors, and Supabase is left
holding a user with no profile. That state is **tolerated, not prevented**: the
next login retries `resolveIdentity`, the profile INSERT is keyed on
`supabase_user_id` and is `ON CONFLICT DO NOTHING`, and the retry converges.
Failing open — minting a session that points at nothing — would put a signed-in
person in front of a ledger that does not exist.

**THE FREE GRANT IS WRITTEN IN THE SAME TRANSACTION AS THE PROFILE INSERT, AND
THIS IS WHY.** If the grant were a second statement, the retry path would run it
against a profile that already exists and grant twice. One transaction, one
`ON CONFLICT DO NOTHING`, and a retry that inserts nothing grants nothing.

**The profile write succeeds and the response never reaches the browser.** The
person retries signup; Supabase answers "user already registered". That is an
enumeration oracle in Supabase's response, and Supabase has a project setting to
suppress it. Turning it on is a deployment step, not code, and it belongs in the
runbook.

**Supabase Auth is down and Postgres is up.** GoTrue and Postgres are separate
services inside one project, so this is a real state. **Everyone already signed
in stays signed in**, because their session is a row in our database and nothing
in the request path touches Supabase. Login, signup and reset 503. That is a
genuine benefit of decision 3 and it is worth stating — with the honest
qualification that it is **not** failure-domain independence: they are one
project, one provider, one bill, and a project-level outage takes both.

**The reservation is claimed and the account is not created.** Unchanged from
today, and the direction is already ruled: a crash in the gap leaves the count
one ahead of reality, the ceiling arrives one tape early, headroom is lost and
money is not. The Postgres form keeps that ordering exactly.

---

## 2. What dies, what lives, what changes backend

### 2.1 `scripts/auth/accounts.mjs`

**DIES — Supabase owns it now.** `hashPassword`, `parsePassword`,
`verifyPassword`, `authenticate`, `burnEqualWork`, `badCredentials`, the `SCRYPT`
and `PASSWORD` tables, `emailHash`, `INDEX_DIR`, `indexPath`, and the
`out/accounts/_index/` directory as a concept — a unique column cannot drift from
the record it is on, because it cannot exist without it.

**DIES — the database is the concurrency model now.** `withAccountLock`,
`withFileLock`, `tryExclusiveCreate`, `readLock`, `stealIfStale`,
`atomicWriteJson`, `readJson`, `LOCK_TIMEOUT_MS`, `LOCK_STALE_MS`,
`RENAME_ATTEMPTS`, `TRANSIENT`, `sleepSync`. Deleted, not kept alongside — the
superseded spec's ruling stands: **two concurrency models in one module is worse
than either.**

**LIVES, untouched, because it never had a backend.** `AuthError` and every code
on it (the web layer branches on `INSUFFICIENT_CREDITS`, `EMAIL_TAKEN`,
`BAD_PLAN`; those are the app's vocabulary and Postgres has no opinion about
them), `SCHEMA_VERSION`, `ACCOUNT_ID_RE`, `CREDITS_CONFIG`, `creditConfig`,
`PLANS`, `PLAN_IDS`, `DEFAULT_PLAN_ID`, `assertPlanId`, `planFor`, `setPlan`,
`isFreePlan`, `freeTapeCeiling`, `normaliseConsent`, `OWNERS_DIR` as a name
until §5.6 removes it.

**LIVES, and it matters MORE than it did.** `normaliseEmail`. It stops being the
input to `emailHash` and becomes the thing that reconciles two systems' idea of
an address. Supabase lowercases; this app trims and lowercases and enforces a
254-character bound and a shape. **If the normalisation happens in two places
with two rules, one person gets two accounts and two balances**, which is the
exact failure its own header warns about, now with a network boundary in the
middle. It is also the cheap pre-flight that stops an obviously malformed
address becoming an HTTP round trip.

**LIVES, and this is a decision with a reason.** `newAccountId` — 16 random
bytes, 32 lowercase hex. The alternative is making the Supabase uuid the primary
key. Rejected on three counts:

- `ACCOUNT_ID_RE` guards a value that is about to become a path component under
  `out/owners/`. A uuid has hyphens; widening the regex widens the traversal
  guard, and the widening happens in the check.
- Six live accounts, 12 ledger rows, 18 session records and three ownership
  files are keyed by the 32-hex id. Re-keying the money path is a migration for
  a cosmetic gain.
- **The uuid is a foreign identifier.** A schema whose primary key is Supabase's
  uuid has to re-key everything if Supabase is ever replaced. A schema that
  carries it in a unique column drops the column.

**The relationship is one-to-one, enforced by a UNIQUE constraint on
`supabase_user_id`, and the column is NULLABLE for exactly one reason:** the six
existing accounts have no Supabase user until their owner signs in and links.
That null is a real, reachable state and every read path has to handle it.

**ACCOUNT LINKING IS THE ONE PLACE WHERE BEING WRONG IS ACCOUNT TAKEOVER**, and
CLAUDE.md §2 named it before this document existed. The rule:

> A local account may be linked to a Supabase user only when Supabase asserts a
> **verified** email that, after `normaliseEmail`, equals the account's stored
> email exactly. For Google that means `email_verified` is true in the identity
> Supabase returns. Anything else refuses and requires a password reset through
> Supabase, which proves control of the mailbox.

An unverified email from any provider is a claim, not a fact, and linking on a
claim means anyone who can make an identity provider assert an address owns the
account behind it.

**CHANGES BACKEND, same signature.** `createAccount`, `loadAccount`,
`findAccountByEmail`, `saveAccount`, `updateAccount`, `listAccounts`,
`freeTapeState`, `reserveFreeTape`, `releaseFreeTape`.

`createAccount` keeps its name and loses its `password` parameter — the password
is Supabase's and never enters this address space. **The header's rule about
payment code applies verbatim to passwords now:** the cheapest way to guarantee
a secret cannot leak from this process is for there to be nowhere to put one.

### 2.2 `scripts/auth/credits.mjs`

**Nothing in the public surface dies.** That is the point of the seam and it is
what makes §7's acceptance gate mean anything.

**LIVES, untouched — pure arithmetic over `config/credits.json`, no storage in
the path.** `PAID_STEPS`, `CREDIT_COSTS`, `CREDIT_DEFAULTS`, `RESOLUTIONS`,
`ALL_RESOLUTIONS`, `TIERS`, `creditCost`, `estimatedUSD`, `providerWasCalled`,
`assertJobId`, `assertReason`, `assertRef`. **`config/credits.json` does not
move into the database and must not.** Every number in the money path lives in
one file so a metered run corrects all of it in one edit, and a number split
between a file and a table is two numbers.

**CHANGES BACKEND, same signature.** `balanceOf`, `balanceForId`, `ledgerFor`,
`debitCredits`, `refundCredits`, `grantCredits`, `grantPlanPeriod`,
`refundIfUnspent`.

**CHANGES SHAPE, internal.** `entriesOf`, `sum`, `mutableAccount`. §4 is about
`entriesOf` and is the most important section in this document after §3.

### 2.3 `scripts/auth/session.mjs`

**LIVES, unchanged, no backend at all.** `signCookie`, `verifyCookie`,
`parseCookies`, `isSecureRequest`, `sessionCookie`, `clearedSessionCookie`,
`SESSION_COOKIE`, `SESSION_ID_BYTES`, `SESSION_ID_RE`, `SESSION_TTL_MS`,
`isValidSessionId`. These are `node:crypto` and string handling. The reasoning in
the header for why the cookie is signed when the id is already unguessable — so
invented rubbish is rejected by a comparison in memory instead of a lookup —
holds identically when the lookup is a query instead of a `readFileSync`, and is
worth more, because a query costs more than a read.

**LIVES, same signature, Postgres backend.** `createSession`, `readSession`,
`destroySession`, `destroySessionsForAccount`, `listSessions`,
`sweepExpiredSessions`. The record shape is unchanged and the comment on it
stays true: **nothing else is stored — no IP, no user agent.**

**DIES.** `SESSIONS_DIR`, `sessionsRoot`, `sessionPath`, `SECRET_FILE`,
`publishSecret`, `adoptOrCondemn`, `claimAndRemove`, `readSecret`.

**THE LARGEST DELETION IN THE MIGRATION IS THE SECRET'S HARD-LINK APPARATUS, AND
IT SHOULD BE MOURNED PROPERLY BEFORE IT GOES.** `sessionSecret` exists in its
current form because exclusive create makes the NAME first and the CONTENT
after, a peer scheduled into that gap read an empty file, concluded "present but
corrupt", deleted it out from under the winner and generated a second secret —
every logged-in user thrown out at once with nothing in any log, in 5 rounds of
30 with no load at all. The hard link closed it. In Postgres the whole question
is `INSERT ... ON CONFLICT DO NOTHING RETURNING value`, one statement, and the
race is the database's problem. The eight-thread test that proved the hard link
is **replaced, not kept** — it tests a mechanism that no longer exists.

Open question 2: the secret could equally be an environment variable. Simpler,
rotatable, no read at boot; and it stops being something a fresh install
generates for itself, and it becomes a secret that gets pasted into a chat
window. Recommendation: the row, with an env var as an override.

### 2.4 `scripts/web/session-middleware.mjs`

`REQUIRED_AUTH` loses `verifyPassword` and `authenticate` and gains the
identity-seam functions. **`docs/interfaces-app.md` §A must be edited in the same
commit**, because `test/web-auth.test.js` asserts the list matches §A and that
test going red is the mechanism working, not a failure.

`claimJob`, `claimOf`, `ownsJob`, `releaseJob`, `jobIdsFor` move from
`out/owners/` to the `job_owners` table. `ownerDir` dies. `ACCOUNT_ID_RE` stays
as an id validator and stops being a path guard — a strict reduction in what can
go wrong, since a parameterised query cannot traverse a directory.

The `resolution` and `credits` fields `claimJob` carries survive as columns. The
comment explaining why they ride along — `normalizeInput` in `job.mjs` returns a
fixed object literal and silently drops fields it does not know — is §4's bug
class in a second module, and it is still out of scope.

### 2.5 `scripts/web/server.mjs`

`login` swaps `mod.authenticate` for the Supabase password grant, keeping the
one-message rule verbatim and adding §1.2's collapse. `signup` swaps
`mod.createAccount`. `logout` is **unchanged** — it already destroys the
server-side record, which is the whole point.

**Consent is written in the profile INSERT, in the transaction with the grant.**
If Supabase succeeds and the consent write fails there is a user whose face this
service may not process. No session is minted without a consent block.

New routes: `GET /auth/google`, `GET /auth/callback`, `POST /auth/reset`,
`GET /auth/reset/callback`, `POST /auth/reset/complete`. All five obey
`safeNext` — `next=https://evil.example` on a login page is the textbook open
redirect and the OAuth callback is a second door onto it.

### 2.6 The operator CLI

`npm run accounts -- list | set-plan | grant | ledger | plans` **all survive**.
They read and write our tables and never touch Supabase. `grant` in particular
must survive: it is how a human corrects a ledger with another line rather than
an edit, and it is the only path that puts credits on an account without a card.

**`create` dies as written**, because it generates and prints a password and
passwords are no longer ours. It is also how `dev@example.com /
timestamp-dev-password` exists, which is the documented local-development login
in CLAUDE.md's START HERE. **THAT LOGIN STOPS WORKING THE DAY THIS LANDS**, and
that is a small, annoying, entirely foreseeable cost that should be planned for
rather than discovered. Recommended replacement: `npm run accounts -- invite
--email=` calling Supabase's admin invite endpoint with the service-role key and
creating the profile row. Open question 5.

---

## 3. The money guarantees as database invariants

**The acceptance gate for this section is the six existing multi-thread race
tests.** They are the only evidence this repo has that the money path is correct
under concurrency, and each of them was written the same way the queue's
16-threads-through-one-barrier measurement was:

| Test | File | Guards |
|---|---|---|
| `8 threads grant the SAME ref at once: it lands once` | `auth-credits` | grant idempotency by `ref` |
| `8 threads debit the SAME jobId at once: it is charged once` | `auth-credits` | debit idempotency by `jobId` |
| `12 threads debit at once against a balance that covers 3: exactly 3 get through` | `auth-credits` | the balance check |
| `16 threads against a balance that covers exactly one render` | `auth-credits` | the balance check, at the boundary |
| `eight simultaneous signups against a ceiling of three grant exactly three tapes` | `auth-free-tape` | the free-tape global ceiling |
| `8 threads generate the secret at once and all of them end up with the same one` | `auth-session` | the session secret |

Five of the six survive with their assertions unchanged and a new backend. The
sixth tests a mechanism that is being deleted (§2.3) and is replaced.

### 3.1 Grant idempotency by `ref` — **CONSTRAINT**

A partial unique index on `(account_id, ref) WHERE ref IS NOT NULL`, and the
write is `INSERT ... ON CONFLICT DO NOTHING RETURNING`. **The check disappears
from the code entirely**: `granted` becomes `rowCount === 1`. The whole
`entries.some(e => e.ref === ref)` scan, and the reload bug it caused (§4), stop
existing rather than being made safer.

`grantCredits` still returns `{ granted, credits, ref }` because the Stripe
webhook has to tell a payment from a redelivery without reading the ledger back,
and that is now the INSERT's own answer rather than a second opinion about it.

### 3.2 Debit idempotency by `jobId` — **CONSTRAINT, and the superseded spec's index is wrong**

The 2026-08-21 spec specifies:

```sql
CREATE UNIQUE INDEX ledger_once
  ON ledger(account_id, job_id, reason) WHERE job_id IS NOT NULL;
```

**That index does not match what the code actually guarantees, and it is the one
line of the superseded spec that must not be carried forward.** `debitCredits`
keys on `(jobId, delta < 0)`:

```js
if (entries.some((entry) => entry.jobId === jobId && entry.delta < 0)) return;
```

`reason` is a caller-supplied string, so the spec's index is wrong in both
directions at once. It **admits** a second debit for one job under a different
reason — `render` then `rerender` both insert, and one render is billed twice.
And it **refuses** a refund whose reason happens to equal the debit's, because a
refund is a positive row carrying the same `job_id`.

The correct predicate names the sign:

```
UNIQUE (account_id, job_id) WHERE job_id IS NOT NULL AND delta < 0
```

Exact DDL in the schema doc. This is what gives "credits debit at ENQUEUE,
idempotent by jobId" teeth: a double-charge for one job becomes an INSERT that
does nothing, rather than a bug a lock was supposed to prevent.

### 3.3 Refund idempotency — **CODE, and it cannot be a constraint**

`refundCredits` gives back `owed = -SUM(delta) for that job` and no-ops when
`owed <= 0`. That is an aggregate over rows that do not yet exist, and no
uniqueness constraint can express it. Two concurrent refunds both compute
`owed > 0` and both insert.

The mechanism is an explicit row lock: `SELECT ... FROM accounts WHERE
account_id = $1 FOR UPDATE` at the top of the transaction, then the SUM, then
the INSERT. **Careful code, stated as careful code**, with the one improvement
that Postgres releases the lock when the transaction ends even if the process
dies — a lock file with a 30-second staleness window does not.

### 3.4 The balance check — **CODE, deliberately**

A `CHECK` constraint cannot see an aggregate. The only way to make the balance a
constraint is to store it in a column with `CHECK (balance >= 0)`, and **a
stored balance is the one thing this codebase forbids by name**: a second source
of truth for somebody's money, with no way to tell which of the two is wrong
when they disagree.

So `debitCredits` is `FOR UPDATE` on the account row, then
`SELECT COALESCE(SUM(delta), 0)`, then the guarded INSERT, in one transaction.

Rejected alternative, named so nobody re-derives it: putting the balance test in
the INSERT's `WHERE` as a subselect. Under `READ COMMITTED` the subselect reads
a snapshot taken before a concurrent insert commits, so it is still racy; under
`SERIALIZABLE` it is correct and the money path acquires a retry loop. The row
lock is the simplest thing that twelve threads through a barrier can prove.

### 3.5 The free-tape global ceiling — **ONE ATOMIC STATEMENT**

The cleanest win in the migration. A global lock file, its staleness window, its
`FREE_TAPES_LOCKED` timeout error and the read-then-write inside it all collapse
to:

```
UPDATE free_tapes SET granted = granted + 1 WHERE granted < $ceiling RETURNING granted
```

`reserved` is `rowCount === 1`. Refusal is `rowCount === 0`, and refusal is still
a return rather than a throw, for the reason already ruled: being full is the
product having given away what it decided to give away, and an exception would
turn "no free credits" into "you cannot create an account".

**Zero as the kill switch still works**, because `granted < 0` is false for every
non-negative `granted`. There is already a test for zero specifically and it
survives.

**THE CEILING STAYS IN `config/credits.json` AND DOES NOT BECOME A COLUMN.** It
has to move in the same edit as `plans.free.creditsPerPeriod` — that coupling is
written into the config's own comment — and a number split between a file and a
table is two numbers that will drift. It is a query parameter.

### 3.6 `rev` optimistic concurrency — **CONSTRAINT, kept although redundant**

`UPDATE accounts SET ... WHERE account_id = $1 AND rev = $2`, and `rowCount === 0`
is `STALE_WRITE`.

**Honest statement of what it is worth.** Inside a `FOR UPDATE` transaction
`rev` is redundant. It is kept because its stated purpose is to make a lost
update loud **for a caller who forgot the lock**, and that caller is exactly the
one it defends against. It costs one integer column and one clause. Deleting it
because the happy path no longer needs it removes the guard from the path that
does.

### 3.7 One owner per job — **CONSTRAINT**

`job_owners.job_id` as PRIMARY KEY. A job claimed by two accounts becomes
impossible instead of unlikely, `ownsJob` becomes one indexed lookup, and the
tenant-isolation property stops being a filesystem convention. Unchanged from
the superseded spec.

### 3.8 Append-only — **THE ONE GENUINELY NEW GUARANTEE**

The file store could only assert that nothing in `credits.mjs` edits or removes
an entry. Postgres can enforce it: `REVOKE UPDATE, DELETE ON ledger` from the
application role, leaving those rights with the migration role alone. The
ledger's own header says trimming an audit log is exactly how a balance becomes
unexplainable; this is the first time that is a permission rather than a
promise. Exact grants in the schema doc.

### 3.9 What does not change

`balanceOf` is `SELECT COALESCE(SUM(delta), 0)`. **The balance stays derived and
never stored.** Credit expiry is still realised as an explicit negative row,
never a silent adjustment. `grant.expiryDays` is still `null` and must stay null
until something writes that row.

---

## 4. The `entriesOf` trap, generalised

**The bug.** `entriesOf` in `credits.mjs` returns a fixed object literal.
`grantCredits`' `ref` was written to disk correctly and left off that
projection, so the dedupe compared every stored entry against `undefined`:
**idempotent in memory, and not idempotent at all across a reload — which is the
only case a webhook has.** It cost an hour and it is listed in CLAUDE.md's
"Things that will bite you".

**The class.** A hand-maintained projection between the stored shape and the
in-memory shape, whose failure mode is a missing field reading as `undefined`
rather than raising. It is invisible to any test that does not reload. The same
shape lives in `normalizeInput` in `job.mjs`, which is why `claimJob` carries a
resolution the manifest cannot.

Postgres does not remove this bug class. It gives it three new front doors, and
saying it goes away would be the dishonest version.

**Door 1 — the SQL column list.** `SELECT at, delta, job_id, reason FROM ledger`
is `entriesOf` written in SQL, with the identical failure: add `ref`, forget the
SELECT, read `undefined`.

**Door 2 — PostgREST's `select=`.** The same list, one layer further out. Mildly
better, in that a misspelt column is a 400 rather than a silent `undefined` —
but an *omitted* column is still silent.

**Door 3 — snake_case to camelCase.** `job_id` arrives and the code wants
`jobId`. **The rename table IS the projection.** It is the same bug wearing a
different hat, and it is the one most likely to be written by hand because it
looks like formatting rather than logic.

### How the Postgres read path avoids reproducing it

Three mechanisms, in order of how much they buy.

**1. THE IDEMPOTENCY DECISIONS LEAVE THE READ PATH ENTIRELY.** §3.1 and §3.2
move grant and debit dedupe into the INSERT's conflict clause, where the
database compares stored bytes against stored bytes and no projection is in the
path at all. **This is the real fix.** The original bug was a *decision* made
from a projected object; the class survives, but the money decisions stop being
exposed to it.

**2. A test that asks the database what the columns are.** One test reads
`information_schema.columns` for `ledger`, `accounts`, `sessions` and
`job_owners`, and fails if the reader does not name every column it finds. **A
new column added without a reader is then a red test rather than an
`undefined`.** This is the test the file store could not write, because a JSON
blob has no schema to interrogate, and it is the single concrete thing Postgres
buys against this bug class.

**3. A round-trip property test per table, on a fresh connection.** Write a row
with every nullable field populated, read it back through the production read
path, assert deep equality. **On a fresh connection, because the in-memory case
is the one that passes** — that is the entire lesson of the original bug, and a
test that reuses a warm object proves nothing.

One rule to go with them: **the row mapper is one function per table, in one
place, used by every reader.** Two mappers is two projections and the second one
is always the stale one.

---

## 5. Migration

`npm run migrate` → `scripts/auth/migrate-cli.mjs`. **Its defining property is
that it never deletes anything.** It reads `out/accounts`, `out/sessions` and
`out/owners`, writes rows, and leaves the file store exactly where it is as a
cold backup until the operator removes it. Re-running is a no-op, not a
duplicate.

**It is an OFFLINE migration and that is a requirement, not a convenience.**
§5.3 derives a number by scanning every account, and `accounts.mjs`' own header
states that a scan cannot be atomic with a grant. With six accounts it is
seconds.

### 5.1 What is actually there, measured 2026-08-25

| | Count |
|---|---|
| Accounts | 6 |
| Ledger rows, all accounts | 12 |
| `_index` entries | 6 |
| Session records | 18 |
| Ownership directories / files | 1 / 3 |
| `_free-tapes.json` register | **does not exist** |

Balances: 42, 16, 498, 153, 82, 51. Two accounts are on `shelf`, four on `free`.
One account (`5edf4c8b…`) carries six rows including three renders and two
operator grants, and it is the only one whose `rev` is not 0 or small — it is the
account that will actually exercise the parity check.

### 5.2 The six accounts and their ledgers

Row-for-row, in order. `account_id` unchanged. `supabase_user_id` **NULL** for
all six — the migration does not create Supabase users (§5.4). `rev` carried
across so the optimistic-concurrency check is continuous rather than reset.

### 5.3 The free-tape counter — **THE FINDING THAT MATTERS**

`out/accounts/_free-tapes.json` does not exist. The register reads zero, and all
six accounts already carry a positive `grant:signup` row.

**Seeding the counter as zero would give away 100 free tapes when six have
already gone.** At the measured 480p cost that is about $12 of provider spend the
ceiling would not know about — small in absolute terms, wrong in principle, and
only cheap to fix now.

The migration **derives** it: count accounts whose ledger contains a
`grant:signup*` row with `delta > 0`. Measured today that is **6**. Rows written
as `grant:signup:withheld-global-ceiling` carry `delta: 0` and must not count,
because a withheld grant consumed no reservation.

Open question 8 confirms the number with the owner before it is written, because
a ceiling seeded wrong is a spend bound that is wrong.

### 5.4 What the migration does NOT do

**It does not create Supabase users.** All six land with `supabase_user_id` NULL
and acquire one the first time their owner signs in, through §2.1's
verified-email link rule.

**Consequence, and it must be said plainly: this migration logs everybody out of
their password.** `verifyPassword` is deleted, so the six stored scrypt digests
become unusable the moment it lands, and every account reaches its new identity
through a Supabase password reset.

The obvious alternative — importing the scrypt digests into Supabase so nobody
resets — is probably not available. Supabase's password import accepts bcrypt and
argon2 digests; this repo's `scrypt$N$r$p$salt$hash` encoding is not one of them.
**NOT VERIFIED FROM THIS MACHINE. Check it before accepting the reset.** If it
turns out to be possible the migration gains a step and everybody keeps their
password, which is strictly better.

In practice the blast radius is small: `paul@example.com` already cannot be
signed into (no reset endpoint, CLAUDE.md START HERE), `dev@example.com` is a
development convenience, and `ps6475961@gmail.com` is the account the payment
demo ran against.

### 5.5 The session secret migrates, or eighteen sessions die

`out/sessions/_secret` becomes the row. Without it, every one of the 18 migrated
session records verifies against a secret that no longer exists and every signed
cookie is rejected on the next request. One line, and it is the difference
between a silent migration and everybody being thrown out — which is exactly the
failure `session.mjs`' header describes happening for a different reason.

Sessions migrate **wholesale, expired ones included**, and `sweepExpiredSessions`
runs afterwards. A filter in the migration would be a second definition of
"expired", and `readSession` already has the only one.

### 5.6 The parity check — it refuses to report success without one

After writing, and before exiting zero:

1. Every `_index` entry resolves to the same `account_id` it did on disk.
2. Per account, `SELECT SUM(delta)` equals the JSON ledger sum, **entry for
   entry and not just the total** — and **every field of every entry round-trips,
   `ref` included.** §4's lesson applied to the migration itself: a total that
   matches while a field is missing is exactly the shape of the original bug.
3. Row counts match the file counts: 6 accounts, 12 ledger rows, 18 sessions, 3
   ownership records.
4. The free-tape register equals the derived count (§5.3).
5. The session secret round-trips byte for byte.

**A migration that moves money and merely says it worked is not good enough.** It
proves the balances survived, per account, or it exits non-zero and changes
nothing.

`purge.mjs` swaps its `out/owners` directory scan for a `DELETE` in the same
transaction as the job removal — strictly better, and it means `ownerEntriesFor`
and its test are rewritten rather than extended.

### 5.7 Rollback, and why it is weaker than it was

The seam is not a runtime toggle. There is no `STORAGE=files|postgres` switch,
because two live storage backends is two code paths to keep correct in the money
path, which is the thing this design exists to stop doing.

Rollback is: revert the commit, and the untouched file store is still there and
still current. That window closes the moment the first write lands in Postgres
that is not also in the files.

**Under Supabase there is a second irreversible thing that SQLite did not have.**
A user created in `auth.users` cannot be undone by `git revert`. Somebody who
signs up during the window exists in Supabase, has no file-store account, and a
rollback loses them entirely — including their free grant, which the register
will have counted.

Mitigations, and none of them makes this as clean as the SQLite rollback was:
the migration is offline and short; the rollback procedure **exports
`auth.users` before reverting**; and the cutover happens when nobody is signing
up, which at six accounts is any time at all. Stated rather than smoothed over.

---

## 6. Test strategy

**This is the hardest section in the document and the one most likely to be
wrong.**

### 6.1 What is true today

`npm test` is a bare `node --test`. CLAUDE.md records **1219 tests / 1217 pass /
0 fail / 2 skipped**, the two skips being the `*-smoke.test.js` money guards that
self-skip without `TIMESTAMP_LIVE=1`. It is hermetic: no network, no `.env`, no
external service. **That is not a convenience, it is money guard #3** — a bare
`node --test` does not load `.env`, so `FAL_KEY` is not in the process during a
test run, and `guards.yml` enforces that the test script stays exactly that.

**Postgres-backed money code cannot be hermetic in that sense.** That is the
whole problem.

### 6.2 The four options, and why three lose

**(A) A real Postgres, started by the test run.** Genuine `FOR UPDATE`, genuine
partial unique indexes, genuine MVCC. Costs a machine dependency and a CI
service container, and changes what `npm test` is — which `guards.yml` protects
as a decision.

**(B) An in-process fake (`pg-mem` or similar).** Zero infrastructure. **Reject,
and the reason is decisive rather than aesthetic:** it does not implement
`FOR UPDATE` or real MVCC, so all seven race tests would pass against a thing that
is incapable of failing the way the real one fails. **A race test against a fake
is a test that proves nothing**, and these seven race tests are the entire
evidentiary basis for the money path.

**(C) Split the suite.** `npm test` stays hermetic and bare, covering everything
that is not storage — which is most of the 1219, since the render pipeline
dominates. A second script needs Postgres and runs the money and identity
suites.

**(D) A repository interface with an in-memory implementation for the fast suite
and the real database for the slow one.** Reject on the superseded spec's own
grounds: the in-memory implementation is a second money-path implementation, and
two concurrency models in one module is worse than either.

### 6.3 Recommendation: **(C), with (A) inside it**

- `npm test` **stays a bare `node --test` and stays hermetic.** The guard is
  preserved rather than amended. The money guard it enforces is about spending
  at fal, and Postgres does not spend at fal.
- `npm run test:db` is a separate script requiring `DATABASE_URL`, and **it
  FAILS LOUDLY when that is unset rather than skipping.** The `*-smoke.test.js`
  self-skip is right for a test that costs money and wrong for a test that
  proves a constraint: **a race test that silently skips is a race test that is
  not running, and nobody will notice for weeks.**
- The seven race tests live in `test:db`. So does every constraint test, the
  `information_schema` test from §4, and the migration-fidelity test.
- CI runs both as separate jobs. `test:db` gets a Postgres service container.
  CLAUDE.md §4 already records that four sources of red is how a build gets
  ignored — a fifth needs to be worth it, and this one is.

**`docs/superpowers/specs/2026-08-25-postgres-test-runtime.md` owns the measured
detail** — Docker versus a local install versus a Supabase branch, startup cost,
Windows behaviour, and whether one database or one schema per test file. That
investigation is running separately and its conclusion may change the shape of
this recommendation. If it finds that no runtime can be made to work on Paul's
Windows machine at acceptable cost, the fallback is CI-only `test:db`, and that
is materially worse: it means the money path's race tests do not run on the
machine where the money path is written.

### 6.4 The seam that makes the Supabase half testable at all

**`fetchImpl`, with no default, copied from `scripts/providers/fal.mjs` and for
the identical reason.** A test that forgets to inject one gets a `TypeError`, not
a request to Supabase. That is money guard #1 applied to identity, and
`guards.yml` should enforce it the same way it already enforces fal's — the
guards file exists for decisions that are invisible when they break, and "the
identity module has no default fetch" is exactly that shape.

What this seam **cannot** test is that the redirect URL registered in Google's
console matches the one the code sends. That is a deployment fact, not a test,
and CLAUDE.md §2 already accepted that deployment moves earlier because of it.

### 6.5 The auth surface: measured, and what happens to it

**282 tests, counted by running each file on 2026-08-25.** (The brief said 283;
the measured breakdown is below and it comes to 282. The superseded spec's 191
was counted on 2026-08-21 and 91 tests have been added since, mostly billing.)

| Suite | Tests | Expectation |
|---|---|---|
| `web-api` | 53 | survive; they go through an injected auth object |
| `auth-credits` | 32 | survive; 4 race tests move to `test:db` unchanged |
| `web-auth` | 30 | ~18 survive, ~12 rewrite against an injected `fetchImpl` |
| `auth-accounts` | 28 | ~14 survive, ~4 rewrite, ~10 delete with scrypt |
| `web-billing` | 28 | survive |
| `billing-stripe` | 24 | survive; the webhook is a pure function of its inputs |
| `web-router` | 21 | survive |
| `auth-session` | 17 | ~10 survive, ~1 rewrite, ~6 delete with the secret file |
| `tenant-isolation` | 14 | **survive unchanged** — see below |
| `auth-free-tape` | 13 | ~12 survive, 1 race test moves and is rewritten |
| `web-static` | 13 | survive |
| `billing-packs` | 9 | survive |
| **total** | **282** | |

**Estimate: ~215 survive unchanged, ~45 rewrite, ~22 delete.** Those three
numbers are estimates and are labelled as such; only the 282 is measured. **Any
test that needs editing to pass is a signal the seam leaked and gets
investigated, not edited** — the superseded spec's rule, and it is what makes
this a migration rather than a rewrite.

**The 14 tenant-isolation tests survive, and CLAUDE.md §2 says they do not.** §2
recorded "isolation becomes RLS. This costs 45 tests and rewrites the
tenant-isolation proof" — on the premise that sessions become JWTs. Decision 3
says they do not. The server resolves the account from its own session and
isolation is enforced by `job_owners.job_id` PRIMARY KEY plus `WHERE account_id
= $1`, which is what those 14 tests already assert through the web layer. **They
are the isolation proof and they do not need rewriting.** §9 open question 3 is
what to do about RLS instead.

### 6.6 New tests the file store could not have

1. **Migration fidelity** — seed a file store, migrate, assert parity per
   account, per entry, per field.
2. **`ledger_once` bites** — a second debit for one `jobId` fails at the
   database, with an injected clock proving it is not a timing artifact.
3. **A refund and a debit for one job coexist** — the direct test of §3.2's
   correction, and it fails against the superseded spec's index.
4. **The schema-drift test** — §4 mechanism 2.
5. **Round-trip per table, on a fresh connection** — §4 mechanism 3.
6. **Account linking refuses an unverified email** — §2.1. The takeover test.
7. **Every Supabase auth failure renders one sentence** — §1.2. The enumeration
   test, and it should enumerate Supabase's error codes explicitly so a new one
   added upstream shows up as a red test rather than a leak.

---

## 7. The dependency decision, costed both ways

CLAUDE.md §2 settled the data layer: **PostgREST over `fetch` plus Postgres
functions, not `@supabase/supabase-js`**, and the reason is the zero-npm-
dependency rule. That is sound for data access and this document keeps it. **The
OAuth code exchange is a different question and it is not settled by that
sentence.**

### 7.1 Hand-rolled over `fetch`

**What it costs, honestly.** PostgREST cannot express a multi-statement
transaction, and §3.4's `FOR UPDATE`-then-SUM-then-INSERT is three statements. So
each money operation becomes **one Postgres function**, called by RPC, atomic by
definition — which is what §2 says, and it is a good design.

But **that is not zero dependencies. It is a dependency written in a second
language**, deployed separately from the code that calls it, versioned in
migration files, and unreachable by `node --test` without a database. The rule is
preserved on paper and the complexity moves into PL/pgSQL. Whether that is a win
is genuine: for atomicity, yes. It is not free and this document will not
pretend it is.

**Where hand-rolling is genuinely fine.** Signup, password grant, recover,
update-user, logout, admin invite. Each is a POST with a JSON body and an
`apikey` header, and each **fails loudly** the first time anybody tries it — a
401, a 400, a 404. Loud failure is the property that makes hand-rolling safe, and
it is the same property `guards.yml` relies on.

**Where hand-rolling is dangerous.** The PKCE exchange. Not because it is hard —
it is `randomBytes`, one SHA-256, one base64url, one POST — but because of its
**failure mode**. A subtly wrong exchange fails at Supabase with a 400 and a
short message, and the observable symptom is *"sign in with Google does
nothing"*, which is also the symptom of a wrong redirect URL, an unregistered
origin, a dropped `state`, an expired verifier, a cookie the browser refused, and
a misconfigured Google console. Six causes, one symptom.

**And there is no measurement that can settle it.** Every other hard ruling in
this repo was established by counting: 16 threads through one barrier, 120 of 120
rounds, 5 runs of the purity check, two metered fal jobs. **There is no barrier
you can release sixteen threads through that answers "did I get the OAuth flow
right".** The evidence has to come from a real round trip through Google against
a real registered URL, which needs a deployment.

### 7.2 `@supabase/supabase-js` + `@supabase/ssr`

**What it buys.** `exchangeCodeForSession`. One function, exercised by a very
large number of applications, which is a different and better kind of evidence
than "I read the RFC carefully".

**What it costs.** The zero-npm-dependency rule, which is not decorative: it is
why this repo has no lockfile churn, no `npm audit` ritual, and no supply-chain
surface. `@supabase/supabase-js` pulls `auth-js`, `postgrest-js`, `realtime-js`,
`storage-js` and `functions-js`. **A transitive dependency tree inside the
process that holds the credit ledger is a supply-chain surface on the money
path.** `guards.yml` would need editing.

**`@supabase/ssr` should not be considered at all**, and the reason is
architectural rather than about size: its entire purpose is keeping a *Supabase*
session alive across requests via cookies. **Decision 3 says this app does not
have one.** Recommending `@supabase/ssr` would be recommending a library for the
architecture that was rejected.

### 7.3 Recommendation

**Hand-roll the data layer. Keep §2's ruling. Take one dependency, for one
flow.**

- Data access: PostgREST over `fetch`, money operations as Postgres functions.
  Unchanged from §2.
- Identity boundary — signup, password grant, recover, update-user, logout,
  invite: hand-rolled over `fetch`, with no default `fetchImpl`.
- **The OAuth PKCE exchange: take `@supabase/auth-js`.** Not
  `@supabase/supabase-js` — `auth-js` is the auth client that `supabase-js` wraps,
  and it is the smaller surface for the one function that is wanted. **NOT
  VERIFIED FROM THIS MACHINE:** nothing has been installed, so the claim that
  `auth-js` is meaningfully smaller than `supabase-js` is an expectation, and it
  should be checked with `npm view` before it is acted on.
- **Confine it mechanically, not by discipline.** A library in `package.json` is
  a library any file can import. Add to `guards.yml`: only
  `scripts/auth/supabase-identity.mjs` may import `@supabase/auth-js`, and
  nothing may import `@supabase/ssr`. That is the same move `guards.yml` already
  makes for three other decisions that are invisible when they break.

**The honest counter-argument, because the owner may reasonably take it.** This
is the first npm dependency in this repo and it will not be the last — that is
how dependency rules die, one justified exception at a time. If the rule is worth
keeping absolutely, the fallback is hand-rolled PKCE **with a named acceptance
test**: one real round trip through Google against a deployed URL, its request
and response captured as a fixture, replayed in CI forever after. **That is the
only thing that turns "probably right" into evidence for this flow**, and it
costs a deployment before the code can be trusted — which §2 already accepted
when it said deployment moves earlier.

Open question 4.

---

## 8. Explicitly out of scope

**Facebook — DEFERRED to its own later project, and this is recorded so nobody
re-asks.** Meta App Review plus Business Verification takes weeks and requires a
live privacy policy and a working data-deletion callback. It is a project, not a
provider toggle.

**Instagram — IMPOSSIBLE, verified, and this is recorded so nobody re-asks.** It
is not a Supabase provider. Meta's own documentation forbids using Instagram
APIs to authenticate application users. The Basic Display API, which was the last
route anyone used for this, was shut down on **2024-12-04**. There is no version
of this that works.

**The login page's visual design.** Blocked on START HERE item 3: Paul said on
2026-08-24 he does not want it dark, DESIGN.md gets rewritten first and the pages
follow, and letting one page drift light on its own is the thing that ruling
exists to prevent. This spec covers routes and behaviour; the look is somebody
else's document.

**The render pipeline, and anything touching it.** Jobs and the queue stay on
files — the superseded spec's reasoning stands unchanged: the manifest is the
source of truth and the queue holds pointers, and the queue's exclusive-claim
logic was established by measurement and validated by a 10,800-job stress run.

**Also out:** `config/credits.json`'s numbers, Stripe (the pack ships on whatever
ledger exists — pricing spec §4, and revenue is not blocked behind this),
subscriptions, and RLS as the primary isolation mechanism (§9.3).

---

## 9. Open questions — each is a decision the owner has to make

1. **Is email confirmation on?** On means the free tape is gated as pricing-spec
   §3 asks, and the profile row and its grant move from signup to first confirmed
   login (§1.2). Off means the free tape is one throwaway address away from
   unbounded, bounded only by `freeTape.globalCeiling`.

2. **Session secret: a row in Postgres, or an environment variable?** The row
   keeps "a fresh install generates its own" true. The env var is simpler and
   rotatable, and it becomes a secret that gets pasted into a chat window.
   Recommendation: the row, with an env override.

3. **What happens to RLS?** CLAUDE.md §2 made RLS load-bearing by having the
   server forward the USER's JWT on user-scoped reads. **Decision 3 discards the
   JWT**, so under this architecture the server holds only the service-role key —
   and §2 itself says that makes RLS decorative and puts isolation back in app
   code. The options are: **(a)** RLS off, isolation from `job_owners.job_id`
   PRIMARY KEY plus `WHERE account_id = $1`, which the 14 tenant-isolation tests
   already prove; or **(b)** RLS on, with the server setting a transaction-local
   claim from OUR session's account id, which gives RLS teeth without a Supabase
   token. Recommendation: (b) as the target, (a) as what ships first. **This is
   the largest unresolved collision between §2 and decision 3 and it should be
   answered before any code.**

4. **`@supabase/auth-js` for the OAuth exchange, or hand-rolled with a recorded
   round-trip fixture?** §7.3. This is a decision about the zero-dependency rule,
   not about OAuth.

5. **Does `npm run accounts -- create` become `invite`, or is it deleted?** It is
   how `dev@example.com / timestamp-dev-password` exists, and that login stops
   working either way.

6. **Do the money operations become PL/pgSQL functions?** §2 settled PostgREST,
   and PostgREST plus a multi-statement transaction forces this. What is not
   settled is who owns testing them and how they are versioned. §7.1.

7. **Which Postgres runtime backs `npm run test:db`?** Owned by
   `docs/superpowers/specs/2026-08-25-postgres-test-runtime.md`; the choice is
   the owner's. If the answer is "none that works on Windows", §6.3's fallback is
   CI-only, which means the money path's race tests do not run on the machine
   where the money path is written.

8. **Confirm the free-tape seed is 6.** §5.3. Derived by scanning for
   `grant:signup*` rows with `delta > 0`, measured today. A ceiling seeded wrong
   is a spend bound that is wrong.

9. **Does a completed password reset destroy every session for that account?**
   Recommendation: yes — people reset because somebody else has it. It signs
   every device out and a person will notice.

10. **Is the Supabase session revoked at the door?** §1.1. Recommendation: yes,
    so the only live credential is ours. **Needs checking against the reset flow**,
    which needs the access token for one more call after the identity is
    resolved.

11. **Was the scrypt import genuinely impossible?** §5.4 asserts Supabase accepts
    bcrypt and argon2 and not this repo's encoding, and that assertion is **NOT
    VERIFIED**. If it is wrong, the six accounts keep their passwords and §5.4's
    cost disappears.
