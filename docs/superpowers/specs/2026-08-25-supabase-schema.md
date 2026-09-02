# Supabase schema — profiles, ledger, job_owners, sessions, the free-tape register

**Date:** 2026-08-25 · **Status:** authoritative DDL for the Supabase identity/money
migration · **Scope of this document:** Postgres schema, atomic SQL functions, RLS
policies, and migration DDL only. No application code. No other file was created
or edited to produce this document.

**Sibling document:** `docs/superpowers/specs/2026-08-25-supabase-identity-money-design.md`
carries the architecture — how the Node server, PostgREST and Supabase Auth fit
together. This document is that spec's source of truth for every `CREATE TABLE`,
`CREATE INDEX`, `CREATE FUNCTION` and `CREATE POLICY` statement. Where the two
disagree, this one is right, because this is the file the DDL actually runs from.

**Read against:** `scripts/auth/accounts.mjs`, `scripts/auth/credits.mjs`,
`scripts/auth/session.mjs`, `scripts/web/session-middleware.mjs`,
`config/credits.json`, `test/auth-credits.test.js`, `test/auth-free-tape.test.js`,
`test/auth-session.test.js`, `test/tenant-isolation.test.js`, and
`docs/superpowers/specs/2026-08-21-sqlite-identity-money-design.md`.

---

## 0. What survives from the superseded SQLite spec, and what changes

The 2026-08-21 document (`2026-08-21-sqlite-identity-money-design.md`) was
written for `node:sqlite` on a single VPS and was superseded the same day when
Paul chose Supabase for its identity features, not its database. Its own header
already says what survives a change of backend: the repository-seam approach,
`ledger_once` as a partial unique index, balance derived by `SUM(delta)` and
never stored, expiry as an explicit negative row, and a migration that never
deletes anything with a per-account parity check. This document inherits all of
that and ports the SQL from SQLite syntax to Postgres syntax where they differ
(partial index syntax is the same; `AUTOINCREMENT` becomes `GENERATED ALWAYS AS
IDENTITY`; `PRAGMA foreign_keys` becomes the default).

**What does not survive, and why:**

- **There is no `accounts` table.** Supabase Auth owns identity — `auth.users`
  holds email and password. What used to be `accounts.email`, `.email_hash` and
  `.password` is gone from this schema entirely; `out/accounts/_index/` and its
  Postgres equivalent (`email_hash UNIQUE`) are retired outright, because
  `auth.users.email` is already unique and already the one place an email lives.
  A local `profiles` table hangs off `auth.users.id` for everything Supabase
  Auth does not model — plan, consent, and (during migration only) a pointer
  back to the old 32-hex account id.
- **`rev` is retired.** The file store's optimistic-concurrency counter existed
  because `loadAccount` → mutate → `saveAccount` was three separate operations
  with nothing enforcing atomicity between them, and two callers doing that
  dance at once could silently lose one's edit. Every money-moving operation in
  this schema is now a single SQL statement inside one PL/pgSQL function (see
  §2) — there is no load-mutate-save sequence for `rev` to protect, because
  there is no gap between the read and the write for a second caller to land
  in. `updated_at` still exists (a trigger, see §1.1) because "when did this
  last change" remains a useful fact; it no longer needs a sibling that detects
  a lost update, because Postgres's own row locking is what prevents the loss.
- **Sessions are still NOT JWT-only.** This is a settled decision, restated
  here because it shapes the `sessions` table: the app mints its own opaque,
  revocable, server-side session record exactly as `session.mjs` does today.
  Whatever Supabase Auth issues is a separate concern belonging to the sibling
  architecture doc. This document only specifies the table that makes "log out"
  mean the credential is dead, which is the property a JWT cannot provide on
  its own.

---

## 1. Tables — full DDL

Run in this order; each table after the first references one before it.

### 1.1 `profiles`

```sql
CREATE TABLE profiles (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan               TEXT NOT NULL DEFAULT 'free',
  consent            JSONB,
  -- Set ONLY by the migration in §5. NULL on every account created after
  -- cutover. It is what lets an operator find "out/accounts/<this id>/" on
  -- the old file store while auditing a migrated row, and nothing else reads
  -- it -- it is provenance, not a foreign key anybody joins on.
  legacy_account_id  TEXT UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**No `email` column, deliberately.** `auth.users.email` is already the single
source of truth. Duplicating it into `profiles` recreates the exact problem the
2026-08-21 spec closed with `email_hash UNIQUE` — a second copy of a fact that
can drift from the first. A page that needs "signed in as `x@y.com`" joins
`profiles` to `auth.users` on `id`.

**No `password` column.** `auth.users` holds it, in whatever form GoTrue
stores it, and this repository's principle from `accounts.mjs` — "not one
field, not a placeholder" for anything payment- or credential-shaped that does
not have to live here — applies exactly as much to a password as it did to a
card number.

**`plan` stays a bare `TEXT`, not a foreign key into a plans table.**
`config/credits.json` remains the source of truth for what a plan id means (its
price, its credits per period), matching the existing "every number in the
money path lives in config, not the database" rule. A `CHECK` constraint
against a hardcoded list of plan ids would be a second copy of that file's
keys, wrong the next time a plan is added there.

### 1.2 `ledger`

```sql
CREATE TABLE ledger (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  delta       INTEGER NOT NULL,
  job_id      TEXT CHECK (job_id IS NULL OR btrim(job_id) <> ''),
  reason      TEXT NOT NULL CHECK (btrim(reason) <> ''),
  ref         TEXT CHECK (ref IS NULL OR btrim(ref) <> '')
);

-- Grant idempotency: a webhook redelivery of the same event is a no-op.
CREATE UNIQUE INDEX ledger_grant_ref_once
  ON ledger (account_id, ref) WHERE ref IS NOT NULL;

-- Debit idempotency: a re-enqueue of an already-charged job is a no-op.
-- Keyed on (account_id, job_id) among NEGATIVE rows only -- not `reason`,
-- which is caller-supplied and merely defaults to 'render'. See §2.2 for the
-- defect this corrects: the superseded SQLite spec's ledger_once predicate
-- included `reason`, which was never part of the guarantee credits.mjs
-- actually enforces.
CREATE UNIQUE INDEX ledger_debit_once
  ON ledger (account_id, job_id) WHERE job_id IS NOT NULL AND delta < 0;

-- balanceOf() is SELECT SUM(delta) -- this is the index that query runs on.
CREATE INDEX ledger_by_account ON ledger (account_id, id);

-- refund_credits() sums delta for one (account_id, job_id) across every
-- reason that ever touched that job (the debit AND its own refund).
CREATE INDEX ledger_by_job ON ledger (account_id, job_id) WHERE job_id IS NOT NULL;
```

**`delta` may be zero.** `createAccount`'s withheld-signup-grant path writes a
row with `delta: 0` and `reason: 'grant:signup:withheld-global-ceiling'` on
purpose — "a withheld grant is still an event," per `accounts.mjs`'s own
comment, and a row with no financial effect is still audit trail. No `CHECK
(delta <> 0)` exists here for that reason.

**`job_id` is NOT a foreign key to `job_owners.job_id`, and that omission is a
decision, not an oversight.** `job_owners` rows are deleted by the retention
purge (`purge.mjs` removes the owner entry when it removes the job); `ledger`
rows are never deleted, by design (§1.2's whole point). A foreign key here
would force a choice between two wrong answers: cascade the purge into deleting
money history, or block every purge on financial residue that outlives the job
by design. `ledger.job_id` is a plain, unconstrained `TEXT` — a receipt that
outlives the file, and now the row, it was written about. This mirrors the file
store today: `refundCredits` and `balanceOf` already read a `jobId` off a
ledger entry with no promise that a manifest for it still exists.

**Ledger rows carry `ref` as OPTIONAL, and this is the schema's most important
compatibility fact.** Every row written before 2026-08-24 has no `ref` at all.
`ledger_grant_ref_once` is declared `WHERE ref IS NOT NULL` for exactly that
reason: a partial unique index does not index — and therefore does not
constrain — rows where the indexed column is `NULL`. Two rows with `ref IS
NULL` can coexist freely, which is required (`test/auth-credits.test.js`, "a
grant with no ref is not deduplicated, and that is deliberate" — the signup
grant and an operator's hand grant have no event to key on, and collapsing two
deliberate hand grants into one would be a different bug). Migrated rows from
before 2026-08-24 insert with `ref = NULL` and need no special handling at all.

### 1.3 `job_owners`

```sql
CREATE TABLE job_owners (
  -- ONE OWNER PER JOB, ENFORCED. This is the whole point of this table: the
  -- filesystem convention out/owners/<accountId>/<jobId>.json relied on
  -- "a file either exists under this account's directory or it does not" —
  -- nothing stopped two directories from both holding a file for the same
  -- jobId, because nothing ever checked. A PRIMARY KEY on job_id makes a
  -- second claim of the same job a constraint violation instead of a
  -- silently-possible state nobody ever tests for.
  job_id      TEXT PRIMARY KEY CHECK (job_id ~ '^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$'),
  account_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Both ride along for the same reason session-middleware.mjs's claimJob()
  -- comment gives: normalizeInput() in job.mjs returns a fixed shape and
  -- drops fields it does not know, so this table is the only durable record
  -- of what the person chose and what they were charged.
  resolution  TEXT,
  credits     INTEGER
);

CREATE INDEX job_owners_by_account ON job_owners (account_id, job_id DESC);
```

`ON DELETE CASCADE` here is consistent with the table's own operational
lifecycle: `job_owners` rows are already deleted routinely, by the retention
purge, when the job they index is removed. Cascading on account deletion is
the same kind of housekeeping, not a violation of "never delete" — that
invariant belongs to `ledger`, not to an ownership index.

### 1.4 `sessions`

```sql
CREATE TABLE sessions (
  -- 64 lowercase hex, unchanged from session.mjs's SESSION_ID_BYTES=32. Stored
  -- as issued, matching the file store: the credential's disclosure risk is
  -- the same whether it sits in a filename or a primary key. Hashing it
  -- (storing sha256(session_id) and looking up by that) would be a strictly
  -- stronger design and is NOT done here, because it is a change in shape
  -- from what session.mjs does today and this document preserves shapes
  -- rather than upgrading them. Flagged for whoever writes the sibling doc's
  -- session-issuance section.
  session_id  TEXT PRIMARY KEY CHECK (session_id ~ '^[0-9a-f]{64}$'),
  account_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
  -- Nothing else. session.mjs's own comment: "An IP address and a user agent
  -- would be a small convenience for support and a permanent record of where
  -- a named person was sitting; this service already holds their face."
  -- That reasoning does not change because the table moved.
);

CREATE INDEX sessions_by_account ON sessions (account_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);
```

### 1.5 The free-tape register

```sql
CREATE TABLE free_tape_register (
  -- THE SINGLETON-ROW TRICK. A boolean primary key that is CHECKed to be
  -- true admits exactly one row, ever: a second INSERT with singleton=true
  -- collides with the primary key, and singleton=false is refused by the
  -- CHECK before it can even attempt that collision. "How many free tapes
  -- have been given away, across every account that has ever existed" is a
  -- single number for the whole installation -- config/credits.json's own
  -- freeTape._comment calls it "the only piece of global state in the
  -- account store" -- and this table shape makes that true structurally
  -- rather than by convention.
  singleton   BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  granted     INTEGER NOT NULL DEFAULT 0 CHECK (granted >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO free_tape_register (singleton, granted) VALUES (true, 0);
```

The ceiling itself (`freeTape.globalCeiling`) is **not** a column here and
stays in `config/credits.json`, read at call time and passed as an argument to
`reserve_free_tape()` (§2). This is deliberate, for the same reason `plan` is
a bare `TEXT`: the ceiling is Paul's editable number, and the whole design of
`freeTapeCeiling()` today is that raising it is "one edit and it is meant to
be — the whole design is that changing it requires reading no JavaScript."
Baking it into the database would mean raising it requires a migration
instead of an edit to a file already under that exact promise.

---

## 2. Atomic SQL functions

**Isolation level: Postgres's default, `READ COMMITTED`, on purpose — not
`SERIALIZABLE`.** Every function below opens with either a `SELECT ... FOR
UPDATE` on the account's own `profiles` row, or (for the free-tape register) a
bare `UPDATE ... WHERE ... RETURNING`. Under `READ COMMITTED`, a second
transaction that tries to lock or update the same row **blocks** until the
first commits, and then **re-reads the just-committed row** rather than
erroring — the blocked statement's `WHERE` clause is re-evaluated against
current data. That is exactly the "read the balance inside a lock, then
decide, then write" sequence `withAccountLock` used to provide with a file
lock, reproduced by Postgres's own row-level locking with no application code
in the loop. It is also why `SERIALIZABLE` would be the wrong choice here: at
that isolation level the SAME concurrent pattern raises a `40001` serialization
error instead of transparently blocking-then-proceeding, and neither the
Stripe webhook handler nor the render-enqueue path has (or should need) retry
logic for that. `READ COMMITTED` gives "one winner, everyone else gets a clean
no-op or a clean refusal" as a first-class outcome rather than an error a
caller has to catch and retry.

**Every function is `SECURITY DEFINER` with `search_path` pinned.** These
functions are the only permitted way to write `ledger` (see the `REVOKE` in
§4) — that only holds if they run with the definer's privileges regardless of
caller, which is what `SECURITY DEFINER` means, and `SET search_path = public,
pg_temp` closes the well-known search-path-hijack hole where an attacker-
controlled `search_path` on the calling session could redirect an unqualified
table reference inside a definer-rights function to a table they control.

### 2.1 `grant_credits`

```sql
CREATE OR REPLACE FUNCTION grant_credits(
  p_account_id UUID,
  p_credits    INTEGER,
  p_reason     TEXT,
  p_ref        TEXT DEFAULT NULL
) RETURNS TABLE (granted BOOLEAN, credits INTEGER, ref TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance BIGINT;
  v_id      BIGINT;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'NO_REASON: every ledger entry needs a reason';
  END IF;
  IF p_ref IS NOT NULL AND btrim(p_ref) = '' THEN
    RAISE EXCEPTION 'BAD_REF: a ledger ref must be a non-empty string or absent';
  END IF;
  IF p_credits IS NULL OR p_credits = 0 THEN
    RAISE EXCEPTION 'BAD_CREDITS: grant must be a non-zero integer, got %', p_credits;
  END IF;

  -- THE LOCK. Every money function on this account serializes here first, so
  -- a debit and a grant racing on the same account cannot both read a
  -- balance the other is about to invalidate. Replaces withAccountLock: one
  -- row, one lock, taken by whichever caller reaches it first; every other
  -- caller for THIS account blocks until this transaction commits, then
  -- reads what actually landed instead of what was true a moment ago.
  PERFORM 1 FROM profiles WHERE id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_ACCOUNT: % has no profile row', p_account_id;
  END IF;

  -- IDEMPOTENT BY ref, CHECKED INSIDE THE LOCK -- a redelivered Stripe
  -- webhook can arrive while the first delivery is still inside this
  -- function. granted:false is RETURNED, not raised: the caller (the webhook
  -- handler) must be able to answer Stripe 200 on a replay, and a 500 on the
  -- one thing that already succeeded would make Stripe retry forever.
  IF p_ref IS NOT NULL AND EXISTS (
    SELECT 1 FROM ledger WHERE account_id = p_account_id AND ref = p_ref
  ) THEN
    RETURN QUERY SELECT FALSE, 0, p_ref;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(delta), 0) INTO v_balance FROM ledger WHERE account_id = p_account_id;
  IF v_balance + p_credits < 0 THEN
    RAISE EXCEPTION 'GRANT_BELOW_ZERO: a grant of % would take % from % to %',
      p_credits, p_account_id, v_balance, v_balance + p_credits;
  END IF;

  -- THE BACKSTOP. ledger_grant_ref_once makes a double grant impossible even
  -- for a caller that bypasses this function entirely or holds no lock at
  -- all. The EXISTS check above is what makes the REPLY graceful
  -- (granted:false, not an error); the unique index is what makes the
  -- GUARANTEE unconditional.
  INSERT INTO ledger (account_id, delta, job_id, reason, ref)
  VALUES (p_account_id, p_credits, NULL, p_reason, p_ref)
  ON CONFLICT (account_id, ref) WHERE ref IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, p_ref;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, p_credits, p_ref;
END;
$$;
```

### 2.2 `debit_credits`

```sql
CREATE OR REPLACE FUNCTION debit_credits(
  p_account_id UUID,
  p_job_id     TEXT,
  p_credits    INTEGER,
  p_reason     TEXT DEFAULT 'render'
) RETURNS TABLE (charged BOOLEAN, balance INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance BIGINT;
  v_id      BIGINT;
BEGIN
  IF p_job_id IS NULL OR btrim(p_job_id) = '' THEN
    RAISE EXCEPTION 'BAD_JOB_ID: credits need a jobId';
  END IF;
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RAISE EXCEPTION 'BAD_CREDITS: credits must be a positive integer, got %', p_credits;
  END IF;

  PERFORM 1 FROM profiles WHERE id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_ACCOUNT: % has no profile row', p_account_id;
  END IF;

  -- IDEMPOTENT BY jobId. A re-enqueue of a job already charged (a re-POST to
  -- /api/jobs/:id/select, or a retried failure returning to pending) is a
  -- no-op at the price it was quoted then, not a second charge. This checks
  -- ANY existing negative row for the job, matching credits.mjs's own rule
  -- exactly -- ledger_debit_once now enforces the identical key, so this
  -- pre-check and the index cannot drift apart. It still has to run BEFORE
  -- the balance check below, and that ordering is why it exists at all: a
  -- job charged minutes ago, re-enqueued after OTHER renders have since
  -- drawn the balance down, must still succeed as a no-op rather than be
  -- refused INSUFFICIENT_CREDITS for money it does not need to spend again.
  IF EXISTS (
    SELECT 1 FROM ledger WHERE account_id = p_account_id AND job_id = p_job_id AND delta < 0
  ) THEN
    SELECT COALESCE(SUM(delta), 0) INTO v_balance FROM ledger WHERE account_id = p_account_id;
    RETURN QUERY SELECT TRUE, v_balance::INTEGER;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(delta), 0) INTO v_balance FROM ledger WHERE account_id = p_account_id;
  IF v_balance < p_credits THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS: account % has % credits, this render costs %',
      p_account_id, v_balance, p_credits;
  END IF;

  INSERT INTO ledger (account_id, delta, job_id, reason)
  VALUES (p_account_id, -p_credits, p_job_id, p_reason)
  ON CONFLICT (account_id, job_id) WHERE job_id IS NOT NULL AND delta < 0 DO NOTHING
  RETURNING id INTO v_id;

  SELECT COALESCE(SUM(delta), 0) INTO v_balance FROM ledger WHERE account_id = p_account_id;
  RETURN QUERY SELECT TRUE, v_balance::INTEGER;
END;
$$;
```

**A defect found in the superseded SQLite spec, and fixed here rather than
carried forward.** That spec's `ledger_once` (`docs/superpowers/specs/
2026-08-21-sqlite-identity-money-design.md` §3) keyed debit idempotency on
`(account_id, job_id, reason)`, and an earlier draft of this document ported
that predicate verbatim. It is wrong, in both directions at once, because
`reason` was never part of the guarantee `credits.mjs` actually enforces.
Read the real rule at `scripts/auth/credits.mjs:407`:

```js
if (entries.some((entry) => entry.jobId === jobId && entry.delta < 0)) return;
```

This matches on `jobId` and a **negative `delta`**, full stop. `reason` is a
caller-supplied string that merely *defaults* to `'render'` — it is not, and
was never meant to be, part of the key. A `(account_id, job_id, reason)`
index gets this wrong twice:

- **It ADMITS a double charge.** A retried debit that happens to pass a
  different `reason` string for the same job — `'render'` the first attempt,
  `'render:retry-1'` the second — is a DIFFERENT key under the old index, so
  both `INSERT`s succeed. One render, billed twice, and the unique index that
  was supposed to be the structural backstop against exactly that never
  fires.
- **It REFUSES a legitimate refund.** The old index carried no `delta`
  predicate at all, so it constrained *any* two rows sharing
  `(account_id, job_id, reason)` — including a debit and its own refund, if
  the refund's `reason` string ever happened to match the debit's. A refund
  that should always succeed for a job that was genuinely charged and never
  spent could be rejected by a uniqueness violation that has nothing to do
  with idempotency.

`ledger_debit_once` now reads `UNIQUE (account_id, job_id) WHERE job_id IS
NOT NULL AND delta < 0` — the literal translation of the code above, with no
`reason` in it at all. This closes both holes at once: a retried debit under
any `reason` string collides on the SAME key regardless of wording, and a
refund (always a positive `delta`) is structurally outside the index's
predicate and can never collide with it. The guarantee no longer depends on
every future caller remembering to pass a constant `reason` — it holds for
any caller, with any `reason`, because `reason` is no longer part of what is
being protected.

### 2.3 `refund_credits`

```sql
CREATE OR REPLACE FUNCTION refund_credits(
  p_account_id UUID,
  p_job_id     TEXT,
  p_reason     TEXT DEFAULT 'refund:failed-before-provider',
  p_spent      BOOLEAN DEFAULT FALSE
) RETURNS TABLE (refunded BOOLEAN, credits INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owed BIGINT;
BEGIN
  IF p_job_id IS NULL OR btrim(p_job_id) = '' THEN
    RAISE EXCEPTION 'BAD_JOB_ID: credits need a jobId';
  END IF;
  IF p_spent THEN
    -- A paid step already ran; the money is gone. Refusing rather than
    -- silently declining, exactly as refundCredits does today -- a caller
    -- passing spent:true and getting a quiet no-op instead of a loud refusal
    -- is how "cancel after paying, get your credits back anyway" ships.
    RAISE EXCEPTION 'REFUND_AFTER_SPEND: % had already reached a paid step, its credits still count', p_job_id;
  END IF;

  PERFORM 1 FROM profiles WHERE id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_ACCOUNT: % has no profile row', p_account_id;
  END IF;

  SELECT COALESCE(-SUM(delta), 0) INTO v_owed
  FROM ledger WHERE account_id = p_account_id AND job_id = p_job_id;

  IF v_owed <= 0 THEN
    RETURN QUERY SELECT FALSE, 0; -- never charged, or already given back
    RETURN;
  END IF;

  -- No ON CONFLICT needed: after this INSERT, SUM(delta) for this job is
  -- zero, so a repeat call recomputes v_owed as 0 and returns above without
  -- attempting a second insert. The row lock is what makes that recomputation
  -- see this transaction's own commit rather than a stale snapshot.
  INSERT INTO ledger (account_id, delta, job_id, reason)
  VALUES (p_account_id, v_owed, p_job_id, p_reason);

  RETURN QUERY SELECT TRUE, v_owed::INTEGER;
END;
$$;
```

### 2.4 `reserve_free_tape` (and its inverse, `release_free_tape`)

```sql
CREATE OR REPLACE FUNCTION reserve_free_tape(p_ceiling INTEGER)
RETURNS TABLE (reserved BOOLEAN, granted INTEGER, ceiling INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_granted INTEGER;
BEGIN
  IF p_ceiling IS NULL OR p_ceiling < 0 THEN
    RAISE EXCEPTION 'BAD_FREE_TAPE_CEILING: ceiling must be a whole number of tapes, zero or more, got %', p_ceiling;
  END IF;

  -- THE WHOLE FUNCTION IS ONE STATEMENT, and that is the entire mechanism.
  -- Postgres locks this row the instant one transaction starts updating it;
  -- a second, concurrent UPDATE against the SAME row blocks until the first
  -- commits, and then -- under READ COMMITTED, Postgres's and Supabase's
  -- default -- re-evaluates its WHERE clause against what was actually
  -- committed, not a snapshot taken before the block. That is the entire
  -- "read the count inside a lock, then decide, then write" property the
  -- file version needed a separate lock file, a steal-if-stale routine and a
  -- measured Windows-exclusive-create primitive to achieve. Here it is one
  -- UPDATE. `>=` becomes `<` in the WHERE clause and the ceiling-of-zero kill
  -- switch (freeTapeCeiling=0 withholds every future grant immediately)
  -- falls out for free, because 0 < 0 is false on the very first attempt.
  UPDATE free_tape_register
  SET granted = granted + 1, updated_at = now()
  WHERE singleton AND granted < p_ceiling
  RETURNING granted INTO v_granted;

  IF v_granted IS NULL THEN
    SELECT granted INTO v_granted FROM free_tape_register WHERE singleton;
    RETURN QUERY SELECT FALSE, v_granted, p_ceiling;
  ELSE
    RETURN QUERY SELECT TRUE, v_granted, p_ceiling;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION release_free_tape()
RETURNS TABLE (granted INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_granted INTEGER;
BEGIN
  -- For the one caller that may call it: a signup that reserved a tape and
  -- then lost the race for its own email address, so the reservation is
  -- PROVABLY unused. Never called on a generic error path -- see
  -- accounts.mjs's own comment on releaseFreeTape for why that asymmetry is
  -- deliberate (losing a reservation to a crash costs headroom; releasing one
  -- that was actually used costs real money).
  UPDATE free_tape_register
  SET granted = GREATEST(granted - 1, 0), updated_at = now()
  WHERE singleton
  RETURNING granted INTO v_granted;
  RETURN QUERY SELECT v_granted;
END;
$$;
```

Not one of the four functions this document was briefed to deliver, but its
absence would leave `reserve_free_tape` with no way back — included for the
same reason `accounts.mjs` ships both halves.

---

## 3. THE PROOF SECTION

Seven real multi-thread barrier tests currently prove correctness against the
file store. For each: what it asserts, which constraint or function above
reproduces the guarantee, and whether Postgres now enforces it **structurally**
(true regardless of which code calls it, or even if nothing does) or the
guarantee still **depends on the code calling the right function** (true only
because the SQL function above happens to be written correctly, and only for
callers that go through it). Both answers appear below. Naming the second kind
honestly is the point of this section.

### 3.1 `test/auth-credits.test.js` — "8 threads grant the SAME ref at once: it lands once"

> `assert.equal(results.filter((r) => r.ok).length, 8, 'every thread should
> succeed -- a replay is a no-op, not an error');`
> `assert.equal(results.filter((r) => r.granted === true).length, 1, 'exactly
> one thread actually granted');`
> `assert.equal(balanceOf(reloaded).credits, before + 40, 'the balance moved
> exactly once');`

**Reproduced by `ledger_grant_ref_once` — `UNIQUE (account_id, ref) WHERE ref
IS NOT NULL`.**

**STRUCTURAL, and the strongest guarantee in this document.** A Postgres
unique index enforces "at most one row per key" through the index's own
B-tree insertion, independent of any lock the calling function does or does
not take. `INSERT ... ON CONFLICT (account_id, ref) DO NOTHING` is Postgres's
built-in atomic upsert-or-skip: eight concurrent sessions racing an `INSERT`
against the same `(account_id, ref)` produce exactly one winner and seven
no-ops, **even if `grant_credits()` did not take the `profiles` row lock at
all**, and even if a caller bypassed the function entirely and issued a raw
`INSERT INTO ledger`. The lock in §2.1 is what makes `GRANT_BELOW_ZERO` correct
and what makes the reply graceful (`granted: false` rather than a constraint-
violation error bubbling to the webhook handler); the *cannot-double-grant*
guarantee itself needs neither.

### 3.2 `test/auth-credits.test.js` — "12 threads debit at once against a balance that covers 3: exactly 3 get through"

> `assert.equal(winners.length, 3, 'exactly 3 of 12 simultaneous renders may
> pass a balance of ${TAPE * 3}, got ${winners.length}');`
> `assert.deepEqual([...new Set(refused.map((r) => r.code))],
> ['INSUFFICIENT_CREDITS'], ...)`
> `assert.equal(balanceOf(after).credits, 0);`

**Reproduced by `SELECT 1 FROM profiles WHERE id = p_account_id FOR UPDATE` in
`debit_credits()`, plus `SUM(delta)` re-read after the lock is held.**

**HALF STRUCTURAL, and this is the honest finding this section exists for.**
There is no uniqueness key across "the 4th debit past a balance" — insufficient
balance is a business rule about a derived sum, not a fact about one row, and
Postgres has no cross-row `CHECK` constraint that could enforce "this account's
`SUM(delta)` never goes negative" the way `ledger_grant_ref_once` enforces
uniqueness. The row lock inside `debit_credits()` is what serializes the 12
callers into a queue and makes each one see the previous one's committed
result before deciding — but that correctness lives **inside one PL/pgSQL
function's own logic**, which is exactly the kind of thing the file store's
`mutableAccount` lock-then-read-then-write sequence was, just relocated from
application JavaScript into database-resident SQL. A caller with direct
`INSERT` privilege on `ledger` who bypasses `debit_credits()` entirely could
still write an arbitrary negative `delta` and push a balance below zero;
nothing in the table DDL alone stops that.

**This is closed, not left open, by §4's `REVOKE`:** `INSERT` on `ledger` is
revoked from every role except the functions' own `SECURITY DEFINER` owner, so
after §4 is applied, `debit_credits()` (and its two siblings) are **the only
way any caller — including `service_role` — can write a ledger row at all.**
That upgrades the guarantee from "the file-lock discipline moved into
JavaScript" to "the file-lock discipline moved into 40 lines of SQL that only
a schema migration can change" — a materially smaller and more auditable
trusted surface, but still, honestly, **code whose correctness this document
is asserting rather than a constraint the database enforces independent of any
code at all.**

### 3.3 `test/auth-credits.test.js` — "8 threads debit the SAME jobId at once: it is charged once"

> `assert.deepEqual(results.filter((r) => !r.ok), [], 'the same job must
> never be refused for being itself');`
> `assert.equal(after.ledger.filter((e) => e.delta < 0).length, 1);`

**Reproduced by `ledger_debit_once` (structural, and now exact) plus the
pre-check and lock in `debit_credits()` (why nobody is refused).**

**FULLY STRUCTURAL for "never double-charged" — no caveat left.** With the
corrected index (§2.2's fix), `UNIQUE (account_id, job_id) WHERE job_id IS
NOT NULL AND delta < 0` is the exact key `credits.mjs:407` checks, with
nothing narrower about it. A bypass attempt — any caller, any `reason`, with
or without the row lock — gets a constraint-violation error, never a silent
double charge. This no longer depends on every debit call site agreeing on a
`reason` string; it holds unconditionally, which is what "structural" is
supposed to mean.

**Still CODE-DEPENDENT, but for a narrower and more precise reason than
before.** The test asserts a second thing: **all eight callers report
success**, none see an error. `ledger_debit_once` alone does not provide
that — `ON CONFLICT ... DO NOTHING` inside `debit_credits()` already turns a
would-be constraint violation into a silent skip, so the index's own backstop
is enough to prevent an ugly error surfacing from a raw duplicate `INSERT`.
What the index cannot provide is the pre-check's *real* job: skipping the
**balance check** for a job that was already charged, so that a re-enqueue
of an old job still succeeds even if the account's balance has since been
drawn down by other, unrelated renders. Remove the pre-check and keep only
the lock and the `INSERT ... ON CONFLICT`, and a re-enqueued job would hit
`IF v_balance < p_credits THEN RAISE EXCEPTION INSUFFICIENT_CREDITS` before
ever reaching the `INSERT` that would have told it "you already paid for
this." That ordering — check idempotency before checking money — is
`debit_credits()`'s own logic, not a constraint, and it is the one piece of
this test's guarantee this schema cannot make structural.

### 3.4 `test/auth-credits.test.js` — "16 threads against a balance that covers exactly one render"

> `assert.equal(results.filter((r) => r.ok).length, 1, 'one tape of credits
> means one render');`
> `assert.equal(balanceOf(after).credits, 0);`

Same mechanism, same verdict as §3.2: the row lock plus the re-read `SUM(delta)`
inside `debit_credits()`, HALF STRUCTURAL for the same reason — this is simply
§3.2's balance-covers-3 test narrowed to a balance-covers-1 edge case, and it
is the narrowest balance a bad lock is most likely to leak through, per the
test's own comment. Nothing about a ceiling of one changes which half of the
guarantee is structural and which is code.

### 3.5 `test/auth-free-tape.test.js` — "eight simultaneous signups against a ceiling of three grant exactly three tapes"

> `assert.equal(granted.length, 3, 'exactly the ceiling, no matter how they
> interleaved');`
> `assert.equal(freeTapeState({ root, ceiling: 3 }).granted, 3, 'the register
> agrees with the ledgers');`

**Reproduced by the single `UPDATE free_tape_register SET granted = granted +
1 WHERE granted < p_ceiling RETURNING granted` in `reserve_free_tape()`.**

**STRUCTURAL, and the cleanest of the six.** Unlike §3.2 and §3.4, there is no
separate "lock, then check, then write" sequence in application logic at all —
the atomicity lives entirely inside **one SQL statement**, whose `WHERE`
clause Postgres re-evaluates per contender against the row version that
transaction actually committed. A caller that ran this exact `UPDATE`
statement directly, outside any function, with no surrounding transaction
discipline whatsoever, gets the identical correctness. This is a genuinely
stronger position than the file store's own `withFileLock` needed 300 lines
and a measured, Windows-specific exclusive-create primitive to reach.

**One thing this test's guarantee does NOT cover, worth naming precisely.**
The test only exercises `reserve_free_tape()` in isolation. The real call
site — `createAccount` — has to do two things across two different systems:
mint the login (`auth.users`, via GoTrue, a separate service with its own
commit) and reserve the tape plus insert the `profiles`/opening-`ledger` rows
(this database, one transaction). Those cannot be one atomic unit, because
GoTrue's commit is outside Postgres's transaction control. A crash between
"GoTrue created the login" and "Postgres reserved the tape and wrote the
profile" leaves an `auth.users` row with no `profiles` row — the exact same
shape of orphan `createAccount`'s own comment describes for the file store
("a crash between the two leaves an orphan record that no login can reach"),
just relocated to a new seam between two systems instead of eliminated by
moving to one. This document's `reserve_free_tape()` is correct; the
multi-system ordering around it is the sibling architecture doc's problem to
solve, and it should not be assumed solved by this schema alone.

### 3.6 `test/auth-session.test.js` — "8 threads generate the secret at once and all of them end up with the same one"

> `assert.equal(secrets.size, 1, 'all 8 threads must agree on one secret,
> got ${secrets.size}');`

**NOT REPRODUCED BY THIS SCHEMA AS SPECIFIED, HONESTLY, BECAUSE IT IS NOT A
DATABASE CONCERN.** This test is about the plaintext HMAC secret
`session.mjs` uses to sign the session cookie — a single value generated once
per installation, not a row in the `sessions` table. Nothing in §1.4's
`sessions` DDL touches how that secret is generated, stored or raced over.
The sibling architecture doc keeps this app's own signed, revocable cookies
(§0) rather than moving to Supabase-issued JWTs, which means the signing
secret remains **this schema's problem to solve, not a solved one it can
inherit for free.** "Generate exactly once across N racing processes" is
unchanged by the migration unless the secret's storage moves too.

**RECOMMENDATION: move the secret into Postgres, in a `session_secrets`
singleton table shaped exactly like `free_tape_register` in §1.5.** Not
offered as a sketch this time — this is what the schema should do, because
it makes both this test's guarantee and §3.7's *structurally* true rather
than dependent on a filesystem trick this document would otherwise have to
re-derive from scratch.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_bytes()

CREATE TABLE session_secrets (
  singleton   BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  secret      BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE session_secrets ENABLE ROW LEVEL SECURITY;
-- No policies, matching free_tape_register and sessions in §4: default-deny,
-- service_role only. A signing secret readable through a user's own identity
-- is not a session table, it is a key-disclosure bug with a schema in front
-- of it.

CREATE OR REPLACE FUNCTION ensure_session_secret()
RETURNS BYTEA
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_secret BYTEA;
BEGIN
  -- ONE STATEMENT, and that is the whole mechanism. gen_random_bytes(32) is
  -- computed and the row is written by the SAME INSERT, so there is no
  -- instant at which this row's KEY exists and its VALUE does not -- Postgres
  -- makes a row visible to any other transaction only at COMMIT, complete
  -- with every column's final value, never mid-write and never as a
  -- placeholder. ON CONFLICT DO NOTHING is what decides the single winner
  -- among any number of racing callers, the same primitive grant_credits()
  -- and reserve_free_tape() already rely on.
  INSERT INTO session_secrets (singleton, secret)
  VALUES (true, gen_random_bytes(32))
  ON CONFLICT (singleton) DO NOTHING
  RETURNING secret INTO v_secret;

  IF v_secret IS NOT NULL THEN RETURN v_secret; END IF;

  -- Somebody else's INSERT won and has already committed. Under READ
  -- COMMITTED this SELECT sees that committed row, complete, or it does not
  -- see it at all -- there is no third state where the row is visible but
  -- unfinished.
  SELECT secret INTO v_secret FROM session_secrets WHERE singleton;
  RETURN v_secret;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_session_secret() TO service_role;
```

With this table in place, §3.6's guarantee becomes **STRUCTURAL**: eight
concurrent callers of `ensure_session_secret()` produce one row and eight
identical return values, because the table's own primary key admits exactly
one, exactly as `free_tape_register` already proves for the ceiling in §3.5.

### 3.7 `test/auth-session.test.js:379` — "a peer that arrives mid-write adopts the secret instead of deleting it"

> `assert.equal(result.error, undefined, 'a peer inside the window must not
> fail');`
> `assert.equal(result.secret, WINNER, 'the peer must adopt the winner
> secret, not mint a second one');`
> `assert.equal(fs.readFileSync(file, 'utf8').trim(), WINNER, 'and it must
> not have deleted the file the winner was writing');`

This is the deterministic sibling of §3.6, and it is the more important of
the two — it does not wait for a race to happen, it **forces the exact
interleaving** that broke an earlier version of `session.mjs` in production
terms: *"every logged-in user thrown out at once, with nothing in any log."*
The test's own docblock names the window precisely: `openSync(secret,'wx')`
creates the file's NAME before its CONTENT exists, so a peer scheduled into
that gap sees a file that is present, empty, and easy to misread as
corrupt — the version that read it that way deleted it and minted a second
secret, silently invalidating every cookie the first secret had already
signed. `session.mjs`'s fix is a write-to-temp-plus-`linkSync` dance
specifically because plain exclusive-create was MEASURED insufficient
against this exact window.

**NOT REPRODUCED BY THIS SCHEMA AS SPECIFIED, for the same reason as §3.6 —
it is the identical secret, the identical out-of-scope storage question.**

**But this is the test where the recommended fix is not just an upgrade, it
is a categorical difference, and worth stating precisely.** `session.mjs`
needed a hard-link trick because a POSIX `open(path, 'wx')` genuinely has two
separate moments — the name is created, then the content is written — and
anything scheduled between them observes a real, physical, present-but-empty
file. **Postgres's row visibility has no equivalent middle state.** Under
`ensure_session_secret()` above, `INSERT INTO session_secrets (...) VALUES
(true, gen_random_bytes(32))` computes the random bytes and writes the row in
one statement; no other transaction can see that row until this one commits,
at which point it sees the complete row, secret included, never a row with a
key and no value. There is no "adopt or condemn" branch to write, no
newborn-file wait window, no age threshold distinguishing "peer mid-write"
from "corpse" — because the failure mode those branches exist to handle
literally cannot occur under MVCC. Once the secret lives in Postgres, this
test's guarantee is not merely reproduced, the entire CLASS of bug it exists
to catch becomes structurally unreachable.

### Summary table

| Test | Mechanism | Verdict |
|---|---|---|
| 8 threads grant same `ref` | `ledger_grant_ref_once` unique index | **Structural** |
| 12 threads debit, balance covers 3 | `FOR UPDATE` lock + re-read `SUM` in `debit_credits()` | **Half structural** — no-overspend depends on the function; closed to "index + one trusted function" once §4's `REVOKE` lands |
| 8 threads debit same `jobId` | `ledger_debit_once` unique index (corrected, now exact) + function pre-check (skips the balance check, not just the error) | **Structural** for never-double-charged, **code-dependent** for "an old debit still succeeds against a drained balance" |
| 16 threads, balance covers 1 | same as row 2, narrower balance | **Half structural**, same reasoning |
| 8 signups, ceiling of 3 | single `UPDATE ... WHERE ... RETURNING` on `free_tape_register` | **Structural** |
| 8 threads generate session secret | — | **Not reproduced as specified** — out of scope for a `sessions` table; **recommended fix given**: a `session_secrets` singleton table (§3.6, full DDL) makes it **structural** |
| peer arrives mid-write, adopts not deletes | — | **Not reproduced as specified**, same scope boundary as above; with `session_secrets` adopted, the entire bug CLASS is structurally unreachable (§3.7) — Postgres row visibility has no present-but-empty state for a peer to misread |

---

## 4. Row Level Security

```sql
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger             ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_owners         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE free_tape_register ENABLE ROW LEVEL SECURITY;

-- Tenant reads: exactly the three tables that hold per-account data a signed
-- in user is entitled to see. This is what replaces the filesystem-existence
-- checks (statSync on out/owners/<accountId>/<jobId>.json, readdirSync for
-- the shelf) that test/tenant-isolation.test.js's 14 tests currently prove
-- by walking every id shape, method, header and body field a stranger might
-- try. A SELECT under these policies returns zero rows for anything not
-- owned by auth.uid() NO MATTER WHAT the query asks for -- the isolation
-- becomes a property of the row, not of the WHERE clause the caller
-- remembered to write.
CREATE POLICY profiles_select_own    ON profiles    FOR SELECT USING (id = auth.uid());
CREATE POLICY ledger_select_own      ON ledger      FOR SELECT USING (account_id = auth.uid());
CREATE POLICY job_owners_select_own  ON job_owners  FOR SELECT USING (account_id = auth.uid());

-- sessions and free_tape_register get NO policies at all. RLS enabled with
-- zero policies is default-deny: nobody without BYPASSRLS (i.e. nobody but
-- service_role and the table owner) can see a row, full stop. Neither table
-- is meant to be readable through a user's own identity -- a session record
-- is a bearer credential's metadata, not something its own holder needs to
-- query, and the free-tape count is global state with no per-account
-- meaning to scope a policy to.

-- Money and ownership WRITES never go through PostgREST/RLS at all -- they
-- go through the four functions in §2, called with service_role, which is
-- what SECURITY DEFINER means: those functions run with the DEFINER's
-- privileges, not the CALLER's, so RLS on the tables they touch is not
-- consulted for their internal statements regardless of policies above.
GRANT SELECT ON profiles, ledger, job_owners TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON ledger      FROM authenticated, anon, service_role;
REVOKE ALL                    ON sessions            FROM authenticated, anon;
REVOKE ALL                    ON free_tape_register  FROM authenticated, anon;

GRANT EXECUTE ON FUNCTION
  grant_credits(UUID, INTEGER, TEXT, TEXT),
  debit_credits(UUID, TEXT, INTEGER, TEXT),
  refund_credits(UUID, TEXT, TEXT, BOOLEAN),
  reserve_free_tape(INTEGER),
  release_free_tape()
TO service_role;
```

**Only `ledger`'s `INSERT`/`UPDATE`/`DELETE` are revoked from `service_role`
too, and that is deliberate, not a typo.** Every other table (`profiles`,
`job_owners`, `sessions`, `free_tape_register`) needs ordinary `service_role`
writes for operations that have no natural home in one of the four functions —
job claiming (`job_owners`, a single `INSERT` whose one-owner-per-job property
is already enforced by the primary key, needing no function around it),
session issuance and destruction, and operator plan changes. `ledger` is the
one table where "the only door in is these four functions" is worth paying for
everywhere, including from the Node server's own trusted role, because it is
the one table §3 depends on staying append-only and idempotency-correct no
matter who is asking.

### Which operations must forward the user's identity, and which legitimately need `service_role`

| Operation | Caller identity | Why |
|---|---|---|
| View balance / ledger history (account page) | forwarded user JWT, `authenticated` | Genuinely tenant data; RLS scoping to `auth.uid()` is the whole point of moving this off files |
| View job list / "the shelf" | forwarded user JWT, `authenticated` | Same |
| `grant_credits` — Stripe webhook | `service_role` | No user session exists on a webhook request; the account is resolved from `client_reference_id` in the event payload, not a cookie |
| `grant_credits` — operator CLI | `service_role` | An operator at a terminal, not a browser session |
| `debit_credits` — render enqueue | `service_role`, called by the Node server **after** it has already verified the requesting session owns the request | See warning below |
| `refund_credits` — job failure | `service_role`, same caveat | Same |
| `reserve_free_tape` — signup | `service_role` | The register has no `account_id` column and no per-user meaning; it is not tenant data at all |
| Claim job ownership (`INSERT INTO job_owners`) | `service_role`, from the Node server at the moment an upload is accepted | The claim IS the authorization record being created — nothing to scope it against yet |

**The warning this document was explicitly asked to state clearly: `service_role`
bypasses RLS entirely, and `SECURITY DEFINER` functions do not consult RLS on
the tables they touch regardless of who calls them.** The four money functions
and the job-claim `INSERT` are, by design, an RLS bypass surface — that is
what lets a Stripe webhook (which has no `auth.uid()` at all) write a ledger
row. Nothing in this schema stops `debit_credits()` from being called with an
`account_id` that does not belong to the session making the HTTP request; that
argument is exactly what the Node server's own ownership check — today,
`ownsJob()` against `out/owners/`; after migration, a `SELECT ... FROM
job_owners WHERE job_id = $1 AND account_id = $2` the server runs before
calling `debit_credits` — must keep getting right. **Moving accounts into
Postgres does not remove this dependency on application code; it relocates it
from "does this file exist" to "did the server pass the right UUID."** If the
Node server ever uses `service_role` for every read as well as every write —
convenient, and the wrong default — RLS becomes decorative and isolation is
back in application code exactly as `CLAUDE.md`'s own architecture notes
already warn: *"If the Node server holds [the service-role key] and uses it
for everything, RLS is decorative and isolation is back in app code."* The
table above is the line: reads that are genuinely about "what does this
signed-in person own" must forward that person's own identity; writes that no
end user should ever be trusted to call directly, and that have already been
authorized by application logic before they reach Postgres, legitimately use
`service_role`.

**One more limitation, named rather than assumed away.** RLS on `job_owners`
protects the *ownership row* — a client with only the anon key cannot
enumerate who owns which job by querying the table directly. It does **not**
protect the job's actual files (`out/jobs/<jobId>/manifest.json`, the finished
video), because those stay on the filesystem exactly as `2026-08-21`'s "why
not move everything" section decided and nothing in this document changes.
Serving those bytes is still an HTTP route handler's decision, and that
handler still has to check `job_owners` (now a fast indexed Postgres lookup
instead of a `statSync`) before streaming a file. The database makes the
*fact* of ownership structurally trustworthy; it does not, and cannot,
automatically gate a `sendFile` call the Node layer forgot to guard.

---

## 5. Migration DDL

**Its defining property, inherited unchanged from the superseded spec: it
never deletes anything.** `out/accounts`, `out/sessions` and `out/owners`
stay exactly where they are as a cold backup after this runs. Re-running is a
no-op, not a duplicate, because every INSERT below is guarded by the mapping
table's own primary key.

**Run this as a role with direct table privileges (e.g. `postgres`, via the
Supabase SQL editor or a migration tool) — NOT as `service_role`.** §4
deliberately revokes `INSERT` on `ledger` from `service_role` to force
ordinary runtime traffic through the three money functions. That same
`REVOKE` blocks a `service_role`-authenticated migration script from bulk-
loading historical rows. This is not a bug to route around by re-granting; it
is the same guard doing its job against a different caller.

### 5.1 What is outside SQL, and must happen first

**Creating the six `auth.users` rows is not a SQL statement in this document,
and cannot honestly be presented as one.** Supabase Auth's password storage is
not scrypt-compatible — there is no transform from `scrypt$16384$8$1$<salt>$
<hash>` (what `out/accounts/<id>/account.json` holds) into whatever GoTrue
stores, so **no migrated account's existing password can be carried over.**
For each of the six accounts, call the Supabase Admin API
(`auth.admin.createUser`) with the account's `email` and `email_confirm:
true`, leave the password unset or throwaway, and record the UUID it returns.
**Every migrated account needs a password-reset email before it can sign in
again.** This is a one-time, human-visible cost of the migration, not a schema
gap, and it belongs in the runbook, said plainly, rather than discovered by
the first person who tries to log in afterward.

### 5.2 The mapping table

```sql
-- Populated by the loader (whatever reads out/accounts/*/account.json) with
-- one row per account: the auth.users UUID from §5.1, and three facts read
-- INDEPENDENTLY from the JSON before this transaction touches anything, so
-- step 5.4's parity check has something to compare the inserted rows
-- AGAINST rather than recomputing from itself.
--
-- file_free_tape EXISTS BECAUSE out/accounts/_free-tapes.json DOES NOT. The
-- global-ceiling register postdates every account that currently exists, so
-- there is no file for §5.3 to carry a seed over from. The free-tape count
-- has to be DERIVED, per account, from whether that account's OWN ledger
-- already carries a positive `grant:signup` row. Measured across the six
-- live accounts: all six do, so the derived seed is 6 -- not 0. Seeding at
-- 0, this table's own fresh-install default (§1.5), would hand out 100 MORE
-- free tapes on top of the six the product has already given away.
CREATE TEMP TABLE migration_account_map (
  legacy_account_id  TEXT PRIMARY KEY,          -- the old 32-hex out/accounts/<id>
  new_account_id     UUID NOT NULL UNIQUE,       -- from auth.admin.createUser, §5.1
  file_balance        INTEGER NOT NULL,          -- SUM(delta) computed from account.json
  file_ledger_rows     INTEGER NOT NULL,          -- length of account.json's ledger array
  file_free_tape       BOOLEAN NOT NULL           -- ledger has a grant:signup row with delta > 0
) ON COMMIT DROP;

-- One row per account, e.g.:
-- INSERT INTO migration_account_map VALUES
--   ('a1b2c3...(32 hex)', 'e9eb3f59-...(uuid from admin API)', 82, 2, true);
```

### 5.3 The transaction

```sql
BEGIN;

INSERT INTO profiles (id, plan, consent, legacy_account_id, created_at, updated_at)
SELECT
  m.new_account_id,
  -- plan, consent, created_at, updated_at come from each account.json; shown
  -- here as the shape, not a literal cross-database SELECT -- migration_account_map
  -- carries only what parity needs to verify, not the full record.
  a.plan, a.consent::jsonb, m.legacy_account_id, a.created_at::timestamptz, a.updated_at::timestamptz
FROM migration_account_map m
JOIN /* the loader's staged copy of each account.json */ a ON a.account_id = m.legacy_account_id;

-- Ledger rows, IN THE FILE'S OWN ORDER, so the IDENTITY column preserves the
-- append order the running-balance proof depends on. `ref` is simply absent
-- (NULL) on every row written before 2026-08-24 -- no special casing needed,
-- because ledger_grant_ref_once is a partial index and NULL is not indexed.
INSERT INTO ledger (account_id, at, delta, job_id, reason, ref)
SELECT m.new_account_id, e.at::timestamptz, e.delta, e.job_id, e.reason, e.ref
FROM migration_account_map m
JOIN /* each account's staged ledger array, exploded to rows, in array order */ e
  ON e.account_id = m.legacy_account_id;

INSERT INTO sessions (session_id, account_id, created_at, expires_at)
SELECT s.session_id, m.new_account_id, s.created_at::timestamptz, s.expires_at::timestamptz
FROM migration_account_map m
JOIN /* out/sessions/*.json, one row per valid record */ s
  ON s.account_id = m.legacy_account_id;

INSERT INTO job_owners (job_id, account_id, claimed_at, resolution, credits)
SELECT o.job_id, m.new_account_id, o.at::timestamptz, o.resolution, o.credits
FROM migration_account_map m
JOIN /* out/owners/<accountId>/*.json, one row per file */ o
  ON o.account_id = m.legacy_account_id;

-- The free-tape register: DERIVED FROM DATA, because
-- out/accounts/_free-tapes.json DOES NOT EXIST -- the ceiling code postdates
-- every account that currently exists. Seeding this at 0, the schema's own
-- fresh-install default (§1.5), would be wrong in the unsafe direction: six
-- live accounts already carry a positive grant:signup row, so the true count
-- is 6, and starting the register at 0 would hand out 100 MORE free tapes on
-- top of the six the product already gave away. The seed comes from
-- migration_account_map.file_free_tape -- read from each account.json BEFORE
-- this transaction touched anything -- and §5.4 checks it against an
-- INDEPENDENT recount of the ledger rows this transaction just inserted.
-- Those two numbers agreeing, computed two different ways at two different
-- times, is the actual proof; either alone would only prove the loader
-- agrees with itself.
UPDATE free_tape_register
SET granted = (SELECT count(*) FROM migration_account_map WHERE file_free_tape),
    updated_at = now()
WHERE singleton;

-- §5.4's parity checks run here, inside this same transaction, before COMMIT.
```

### 5.4 The parity check — fails loudly, changes nothing

**Run inside the same transaction as every INSERT above, not as a separate
script afterward.** A `RAISE EXCEPTION` inside an open transaction rolls back
every write this migration made; the tables end up exactly as they were
before the migration ran, which is the cleanest possible reading of "never
deleting anything" applied to a migration that could itself go wrong. This is
stronger than the superseded spec's own version, which described a script
that "exits non-zero and changes nothing" as a property to maintain by
discipline — here it is a property of the transaction, not of the script
around it.

```sql
DO $$
DECLARE
  v_expected_accounts CONSTANT INTEGER := 6;
  v_actual_accounts   INTEGER;
  v_bad_account        UUID;
  v_expected_sessions  INTEGER := /* count of valid *.json under out/sessions */;
  v_actual_sessions    INTEGER;
  v_expected_owners    INTEGER := /* count of valid *.json under out/owners/*\/ */;
  v_actual_owners      INTEGER;
  v_recount            INTEGER;
BEGIN
  -- 1. Account count.
  SELECT count(*) INTO v_actual_accounts FROM profiles WHERE legacy_account_id IS NOT NULL;
  IF v_actual_accounts <> v_expected_accounts THEN
    RAISE EXCEPTION 'PARITY_FAILED: migrated % profiles, file store had %', v_actual_accounts, v_expected_accounts;
  END IF;

  -- 2. Per-account balance AND row count parity, entry for entry -- not just
  -- the total, per the superseded spec's own standard, carried forward.
  FOR v_bad_account IN
    SELECT m.new_account_id
    FROM migration_account_map m
    WHERE (SELECT COALESCE(SUM(l.delta), 0)::INTEGER FROM ledger l WHERE l.account_id = m.new_account_id) <> m.file_balance
       OR (SELECT count(*)::INTEGER FROM ledger l WHERE l.account_id = m.new_account_id) <> m.file_ledger_rows
  LOOP
    RAISE EXCEPTION 'PARITY_FAILED: account % disagrees with its file ledger (balance or row count)', v_bad_account;
  END LOOP;

  -- 3. Session and job-owner row counts match the file counts.
  SELECT count(*) INTO v_actual_sessions FROM sessions;
  IF v_actual_sessions <> v_expected_sessions THEN
    RAISE EXCEPTION 'PARITY_FAILED: migrated % sessions, file store had %', v_actual_sessions, v_expected_sessions;
  END IF;

  SELECT count(*) INTO v_actual_owners FROM job_owners;
  IF v_actual_owners <> v_expected_owners THEN
    RAISE EXCEPTION 'PARITY_FAILED: migrated % job_owners rows, file store had %', v_actual_owners, v_expected_owners;
  END IF;

  -- 4. The free-tape register: the DERIVED seed (migration_account_map's
  -- file_free_tape, read from each account's JSON before this transaction
  -- started) must equal an INDEPENDENT recount of the ledger rows this
  -- transaction just inserted into Postgres. These are two different
  -- computations, from two different sources, at two different times, over
  -- the same underlying fact -- so agreement is real evidence. Disagreement
  -- means the loader's per-account flag and the ledger rows it actually
  -- produced do not match: an insertion bug, not a pre-existing file
  -- inconsistency -- there is no separate _free-tapes.json for the two to
  -- have disagreed WITH before this migration ever ran.
  SELECT count(*) INTO v_recount
  FROM ledger WHERE reason LIKE 'grant:signup%' AND delta > 0;
  IF v_recount <> (SELECT granted FROM free_tape_register WHERE singleton) THEN
    RAISE EXCEPTION 'PARITY_FAILED: free-tape register says %, ledger recount says %',
      (SELECT granted FROM free_tape_register WHERE singleton), v_recount;
  END IF;
END $$;

COMMIT;
```

### 5.5 What rollback actually means here, precisely

If §5.4 raises, `COMMIT` is never reached and the whole transaction — every
`profiles`, `ledger`, `sessions`, `job_owners` row and the `free_tape_register`
update — unwinds. The file store is untouched throughout, exactly as before.
**The one thing that does NOT roll back is §5.1** — the six `auth.users` rows
already exist in GoTrue's own store, committed by a separate HTTP call before
this transaction ever opened, because Postgres has no transactional control
over a different service. A failed §5.4 leaves six logins with no `profiles`
row behind them; the runbook step after a failed migration is to delete those
`auth.users` rows via the Admin API before diagnosing and re-running, or the
next attempt's §5.1 fails on "email already registered" for accounts that, as
far as this database is concerned, do not exist yet.

---

## Summary

**File:** `docs/superpowers/specs/2026-08-25-supabase-schema.md`

**Tables:** `profiles`, `ledger`, `job_owners`, `sessions`, `free_tape_register`
(and the *retired* `accounts` / `email_hash` index from the superseded spec —
gone, not ported, because `auth.users` already is that table). Plus one
**recommended** table beyond the five briefed: `session_secrets` (§3.6), which
closes both session-secret proof-section gaps structurally if adopted.

**Functions:** `grant_credits`, `debit_credits`, `refund_credits`,
`reserve_free_tape`, `release_free_tape` (the fifth, an inverse the four
requested functions need but the brief did not separately name), plus the
recommended `ensure_session_secret` (§3.6).

**Guarantees from the proof section that could NOT be reproduced structurally
by the five tables this document was asked to specify:** both session-secret
tests (`test/auth-session.test.js`, the 8-thread race and the deterministic
mid-write test at line 379). Neither is a concern of the five tables/register
as briefed — the HMAC signing secret is a single installation-wide value
outside all of them — so this schema cannot claim to reproduce either as
specified. **A concrete fix is given rather than left as a gap**: §3.6 now
includes full DDL for a `session_secrets` singleton table, shaped like
`free_tape_register`, plus an `ensure_session_secret()` function. Adopting it
makes both guarantees structural — and for the mid-write test specifically,
makes the entire bug class it defends against (a row visible with a key and
no value) structurally unreachable under Postgres's MVCC, not merely
guarded against by a smarter lock. This is additional scope beyond the
literal five-table brief, offered because the sibling architecture doc keeps
this app's own signed cookies rather than moving to Supabase-issued JWTs,
which means the secret's storage is a decision that schema still has to make.

**Also flagged, not hidden:** the debit-idempotency index was itself found to
carry a defect during review — the superseded SQLite spec's `ledger_once`
predicate included `reason`, which both admitted a double charge under a
varied retry reason and could refuse a legitimate refund; it is now `UNIQUE
(account_id, job_id) WHERE job_id IS NOT NULL AND delta < 0`, the exact key
`credits.mjs:407` checks, with no caveat left (§2.2, §3.3). The "no overspend"
and "no over-grant" guarantees are structural only after §4's `REVOKE` forces
every write through the four functions, and even then remain a property of
those 40-odd lines of trusted SQL rather than a constraint independent of all
code (§3.2); RLS on `job_owners` protects the ownership fact but not the job
files themselves, which stay on disk and stay an application-code decision
(§4); the free-tape migration seed is DERIVED from each account's own ledger
data rather than carried over from a file that does not exist, because
`out/accounts/_free-tapes.json` postdates every live account — seeding at 0
would hand out 100 more free tapes on top of the six already spent (§5.2–5.4);
and no migrated account's password survives the move to Supabase Auth — every
one needs a reset email, stated in the runbook rather than discovered by a
locked-out user (§5.1).
