# SQLite for identity and money — design

**Date:** 2026-08-21 · **Status:** SUPERSEDED the same day — Paul chose Supabase
over a self-hosted VPS after this was written. Kept because most of its reasoning
survives the change of backend and the successor spec builds on it.

**What still applies under Postgres:** the repository-seam approach and its
191-test acceptance gate; `ledger_once` as a partial unique index (Postgres
supports them); balance derived by `SUM(delta)` and never stored; expiry as an
explicit negative row; the migration's never-delete-anything property and its
per-account parity check; jobs and the queue staying on files.

**What does not:** `node:sqlite` and the zero-npm-dependency argument for it, the
single-VPS premise, WAL and busy-timeout configuration, the two-processes-one-file
analysis, and the backup discussion — a managed database changes all of those.
**Scope:** accounts, sessions, ownership and the credit ledger move from files to
`node:sqlite`. Jobs, the queue and the render pipeline do not move.

This is sub-project 1 of 2. Sub-project 2 is Stripe subscriptions and its
webhook, which is designed separately and built on top of this one.

---

## 1. Why

Four things drove this, and only the last two are urgent.

**The credit ledger guards money with an advisory lock.** `mutableAccount` takes
a lock file with a 5-second timeout and a 30-second staleness window, then does
read-modify-write on a JSON array. `debitCredits` is idempotent by `jobId`
because it reads the ledger, checks for an existing entry, and writes if absent.
That is a read-then-write race with a lock in front of it. The lock is careful
and it is probably correct; "probably correct" is a different standard from the
one the rest of this repo holds itself to, and it is the standard being applied
to the only subsystem that handles money.

**The email index is a second copy of a fact.** `out/accounts/_index/<sha256 of
email>.json` points at an account directory. Nothing structurally prevents the
index and the record from disagreeing.

**Sessions cost a `readFileSync` per request.** `session.mjs` says so in its own
header comment.

**Stripe is next, and it makes all three worse.** Webhooks arrive concurrently,
retry on any non-2xx, and can deliver out of order. Granting credits from a
webhook against a lock-file ledger is the shape of a double-grant.

### Why not Postgres

Deployment is one VPS running both the web app and the worker, because ffmpeg is
the product and it needs a real machine with a real filesystem. On one box,
`node:sqlite` is a real ACID database that **preserves the zero-npm-dependency
rule** — it is in the Node core library. Postgres would mean a driver from npm,
and state split across two systems for no benefit at this size.

Verified on this machine: Node v24.14.1, `node:sqlite` present and working.

### Why not move everything

Two subsystems stay on files, deliberately.

**Job manifests.** `jobs-cli.mjs` states the property: delete `out/queue`
entirely and every job is still listed, still explicable and still resumable.
The manifest is the source of truth and the queue holds pointers. Moving jobs
into a table destroys that.

**The queue.** Its exclusive-claim logic was established by measurement — 16
threads through one barrier, 120 rounds, which is how `unlinkSync` and
`renameSync` were both found to be non-exclusive on Windows — and validated by a
10,800-job stress run. It works. Rewriting it buys nothing this sub-project
needs.

---

## 2. Approach: a repository seam

`accounts.mjs`, `credits.mjs` and `session.mjs` keep their **exact export
signatures**. Only their internals change from `fs` to `node:sqlite`.

The point is the evidence this produces. **191 tests** are written against those
signatures, counted on 2026-08-21:

| Suite | Tests |
|---|---|
| `web-api` | 51 |
| `web-auth` | 30 |
| `auth-accounts` | 28 |
| `auth-credits` | 23 |
| `web-router` | 21 |
| `auth-session` | 17 |
| `tenant-isolation` | 14 |
| `web-static` | 7 |
| **total** | **191** |

**If every one of them passes untouched against a SQLite backend, the migration
is proven rather than argued.** A rewrite that changed the callers would invalidate every one of them
as evidence, and would mean rewriting the tests and the code at the same time —
which is how a money path acquires a silent bug.

The lock-file machinery inside the seam — `LOCK_TIMEOUT_MS`, `LOCK_STALE_MS`,
`RENAME_ATTEMPTS`, `TRANSIENT` — is **deleted**, not kept alongside. Two
concurrency models in one module is worse than either.

---

## 3. Schema

```sql
CREATE TABLE accounts (
  account_id   TEXT PRIMARY KEY,          -- 32 lowercase hex, unchanged
  email        TEXT NOT NULL,
  email_hash   TEXT NOT NULL UNIQUE,      -- replaces out/accounts/_index/
  password     TEXT NOT NULL,             -- scrypt$N$r$p$salt$hash, unchanged
  plan         TEXT NOT NULL,
  consent      TEXT,                      -- JSON, nullable
  created_at   TEXT NOT NULL,             -- ISO 8601
  updated_at   TEXT NOT NULL,
  rev          INTEGER NOT NULL
);

CREATE TABLE ledger (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,   -- append-only order, explicit
  account_id   TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  at           TEXT NOT NULL,
  delta        INTEGER NOT NULL,
  job_id       TEXT,
  reason       TEXT NOT NULL
);
CREATE UNIQUE INDEX ledger_once
  ON ledger(account_id, job_id, reason) WHERE job_id IS NOT NULL;
CREATE INDEX ledger_by_account ON ledger(account_id, id);

CREATE TABLE sessions (
  session_id   TEXT PRIMARY KEY,          -- 64 lowercase hex
  account_id   TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE job_owners (
  job_id       TEXT PRIMARY KEY,          -- one owner per job, enforced
  account_id   TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  at           TEXT NOT NULL,
  resolution   TEXT,
  credits      INTEGER
);
CREATE INDEX job_owners_by_account ON job_owners(account_id, job_id DESC);
```

`PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, and a busy timeout.
Database file: `out/timestamp.db`, beside the rest of the state so one `--root`
still moves a whole installation.

### What each constraint is for

**`ledger_once` is the most important line in this document.** It converts
`debitCredits`' idempotency from a property maintained by careful code under a
lock into an invariant the database enforces. A double-charge for one job stops
being a bug the lock was supposed to prevent and becomes an `INSERT` that fails.
"Credits debit at ENQUEUE, idempotent by jobId" acquires teeth.

**`email_hash UNIQUE`** deletes `_index/` as a concept. The index cannot drift
from the record because it cannot exist without it.

**`job_owners.job_id` as PRIMARY KEY** makes a job claimed by two accounts
impossible. `ownsJob` becomes one indexed lookup, so the tenant-isolation
property stops being a filesystem convention and becomes a foreign key.

**`sessions_expiry`** makes expiry a cheap indexed sweep.

### What does not change

`balanceOf` is `SELECT SUM(delta)`. The balance stays **derived and never
stored** — the locked decision holds exactly as written. Credit expiry is still
realised as an explicit negative row, never a silent adjustment. The ledger is
still append-only: no `UPDATE`, no `DELETE`, except the `ON DELETE CASCADE` that
follows an account being erased.

---

## 4. Migration

`npm run migrate` → `scripts/auth/migrate-cli.mjs`.

**Its defining property is that it never deletes anything.** It reads
`out/accounts`, `out/sessions` and `out/owners` and writes rows into
`out/timestamp.db`. The file store stays exactly where it is as a cold backup
until the operator decides to remove it.

Idempotent: re-running is a no-op, not a duplicate.

**What rollback actually means, precisely.** The seam is not a runtime toggle and
there is no `STORAGE=files|sqlite` switch — two live storage backends is two code
paths to keep correct, which is the thing this design is trying to stop doing.
Rollback is: revert the commit, and the untouched file store is still there and
still current, because nothing ever wrote to the database that was not also
already in the files at migration time. The window in which that stops being true
opens the moment the first new write lands in SQLite after cutover, and closing
that window is what the parity check plus a dated `out/accounts` backup is for.

**It refuses to report success without a parity check.** After writing:

1. every `_index` entry resolves to the same `account_id` it did on disk
2. for every account, `SELECT SUM(delta)` equals the sum of the JSON ledger,
   entry for entry — not just the total
3. account, session and ownership row counts match the file counts

A migration that moves money and merely *says* it worked is not good enough. It
proves the balances survived, per account, or it exits non-zero and changes
nothing.

---

## 5. Testing

**The acceptance gate: all 191 existing tests pass untouched.** That is what
makes this a migration and not a rewrite. Any test that needs editing to pass is
a signal the seam leaked and gets investigated, not edited.

Four new things the file store could not be tested for:

1. **Migration fidelity** — seed a file store, migrate, assert parity per account
2. **`ledger_once` bites** — a second debit for one `jobId` fails at the
   database, with an injected clock proving it is not a timing artifact
3. **Concurrent debit** — N parallel debits for one job produce exactly one row.
   This is the direct analogue of the 16-thread queue measurement, and it is the
   test that retires the lock file honestly rather than by assertion
4. **Constraints hold** — duplicate email rejected, double-claimed job rejected

Tests get a file-backed temp database per test, not `:memory:`, because the
behaviour under test is multi-process locking.

---

## 6. Risks

**`node:sqlite` prints `ExperimentalWarning` and is not marked stable.** This is
the module that will hold the money. The mitigation is the seam: if it bites,
swapping the backend touches one file and the 191 tests re-prove the
replacement. Named here rather than discovered later.

**Backups get harder, not easier.** A live WAL database cannot be `cp`'d and
trusted; it needs `VACUUM INTO` or the backup API. Today `out/` is a directory
that could be rsynced. This is F15 of the security review — *"`out/` is
unencrypted and backups have never been designed"* — becoming specific, and the
answer is written as part of this work rather than deferred again.

**Two processes share one file.** Web and worker both open the database. WAL
plus a busy timeout handles it, but a long write transaction in one blocks the
other, so money-path transactions stay small and short.

**Development is Windows, deployment is Linux.** SQLite's file locking is not
identical on both, and this repo has already been bitten once by exactly that
class of difference.

---

## 7. Out of scope

Jobs, the queue, the render pipeline, the tape look, and the retention sweep —
except one change: `purge.mjs` swaps its `out/owners` directory scan for a
`DELETE` in the same transaction as the job removal. Strictly better, but it
means `ownerEntriesFor` and its test are rewritten rather than extended.

Stripe is sub-project 2 and has its own design.
