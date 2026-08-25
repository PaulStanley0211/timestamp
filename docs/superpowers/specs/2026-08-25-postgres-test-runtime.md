# Postgres test runtime, after the Supabase migration — investigation

**Status:** investigation, no decision recorded. Written to cost a decision
Paul has not yet been asked to make: the Supabase/Postgres migration
(`2026-08-21-sqlite-identity-money-design.md`, superseded but its reasoning
carried forward) has never priced what happens to `npm test` once identity and
the credit ledger leave `fs` for a real database. This document prices it.

**Companion documents**, written the same day by sibling investigations: this
file owns only itself and does not merge their content. **This document does
not modify any file, does not install anything, and does not start any
service.** Every number below is either read from the repository, measured by
running the existing hermetic suite, or cited from a dated external source.

---

## 0. The one-sentence finding

**Moving identity and the ledger from `node:sqlite` (the plan when the last
spec was written) to Postgres did not just change a driver — it deleted the
property that made the 191/283-test acceptance gate cheap.** `node:sqlite` is
in Node's core library: a test opens a temp file and gets a real, ACID,
single-process database with zero setup, zero daemon, zero network, zero
Docker. **Postgres has no equivalent embedded mode that also supports
PL/pgSQL, partial unique indexes, row locking and advisory locks** — the four
features the money guarantees in this codebase are built on (see §3). Every
option below is a way of paying for that loss; none of them makes it free
again.

---

## 1. What was measured, on this machine, read-only

| Measurement | Result |
|---|---|
| `docker --version` | Docker Desktop **29.3.1** is installed |
| `docker info` / `docker ps` | **daemon not running** — `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`. Docker Desktop is present on this exact machine and is not currently usable without first launching it. |
| `node --version` | v24.14.1 |
| `node --test` on the three files carrying the barrier tests (`auth-credits`, `auth-free-tape`, `auth-session`) | **62 tests, 0 fail, 5.586s wall / 5322ms reported** |
| Full `npm test` | **~92s wall**, one known pre-existing flake (`empty_download`, CLAUDE.md §4 — unrelated to this investigation) |
| CI matrix (`.github/workflows/test.yml`) | `ubuntu-latest` and `windows-latest` × node 22/24, **no secrets available**, deliberately, so nothing in CI can spend money |

The Docker-not-running result is not incidental. It is the answer to "what
happens on a machine that lacks the dependency" for every Docker-based option
below, obtained by trying it on the actual machine this decision is for.

---

## 2. The surface being migrated, counted directly

Grepping test files for direct imports of the three modules the migration
spec names — `accounts.mjs`, `credits.mjs`, `session.mjs` (plus
`session-middleware.mjs`, which reads sessions) — gives **285 tests across 11
files**:

| File | Tests |
|---|---|
| `web-api.test.js` | 53 |
| `provider-contract.test.js`* | 40 |
| `auth-credits.test.js` | 32 |
| `web-auth.test.js` | 30 |
| `auth-accounts.test.js` | 28 |
| `web-billing.test.js` | 28 |
| `retention-purge.test.js` | 21 |
| `auth-session.test.js` | 17 |
| `tenant-isolation.test.js` | 14 |
| `auth-free-tape.test.js` | 13 |
| `billing-packs.test.js` | 9 |
| **Total** | **285** |

\* `provider-contract.test.js` imports `accounts.mjs` incidentally (a path
constant used in a fixture); its 40 tests are pricing/contract tests, not
identity or ledger tests, and are a reasonable file to exclude, which would
put the count at **245 across 10 files**. Either way this lands within a few
percent of the **283 tests / 12 files** given as the premise of this
investigation — the gap is counting convention (which files count as
"touching the surface"), not a disagreement about the size of the problem.
**Read this section as confirmation of the premise, not a correction to it.**

---

## 3. The six race tests — found seven, all built the same way

Grepping for `worker_threads` + `SharedArrayBuffer` across `test/` finds five
files. Two of them — `job-model.test.js` and `queue-race.test.js` — test the
**file-based job queue**, which the migration spec explicitly keeps on disk
(§7 of the superseded spec: "Jobs, the queue... stay on files"). They are not
part of this migration's surface and are excluded below.

The remaining three files contain **seven** tests built on the same pattern:
spawn N real OS threads via `node:worker_threads`, release them simultaneously
through a `SharedArrayBuffer` + `Atomics.wait`/`Atomics.notify` barrier, then
assert on the *outcome* of genuine concurrent execution against shared mutable
state.

| # | File : line | Test | What it proves |
|---|---|---|---|
| 1 | `auth-credits.test.js:811` | `8 threads grant the SAME ref at once: it lands once` | Idempotent grant under real concurrency |
| 2 | `auth-credits.test.js:832` | `12 threads debit at once against a balance that covers 3: exactly 3 get through` | No overdraft under contention |
| 3 | `auth-credits.test.js:871` | `8 threads debit the SAME jobId at once: it is charged once` | No double-charge under real concurrency |
| 4 | `auth-credits.test.js:889` | `16 threads against a balance that covers exactly one render` | Exactly-one-winner under a tight race |
| 5 | `auth-free-tape.test.js:309` | `eight simultaneous signups against a ceiling of three grant exactly three tapes` | Global ceiling holds under concurrent signup |
| 6 | `auth-session.test.js:295` | `8 threads generate the secret at once and all of them end up with the same one` | Session-secret generation is race-free |
| 7 | `auth-session.test.js:379` | `a peer that arrives mid-write adopts the secret instead of deleting it` | No lost-update on the secret file |

Tests 1–5 are unambiguously about money — grants, debits, a spend ceiling.
Tests 6–7 guard the session-secret file that gates every money-spending
endpoint but is not itself a monetary value. **Whichever five or six or seven
the reader means by "the six race tests," the same architectural question
applies to all seven identically**, and the finding below is uniform across
them: nothing about *which* shared resource is being raced changes what kind
of test runtime can host the race.

Today, all seven pass because the resource under contention is a **real
file on a real filesystem**, and Windows' actual locking behavior is exactly
what CLAUDE.md's own "Rulings" section (the `openSync(path,'wx')` measurement,
120/120 rounds) was derived from. **These are not mocked concurrency tests.
They are measurements of what really happens when N real threads hit one real
resource at once.** That is the property any replacement runtime has to
preserve, and it is the property that turns out to be expensive.

---

## 4. Can a fake prove what these seven tests prove? — No, and here is why precisely

The task that produced this document asked this to be answered plainly rather
than hedged, so: **no in-process JS fake, run under `node:worker_threads`, can
host these seven tests and produce evidence of the same kind they produce
today.** Two paths exist and both fail, for different reasons:

**Path A — the fake lives behind `postMessage`, funneled through one arbiter
thread.** `worker_threads` spawns **separate V8 isolates**; a plain JS
`Map`-based ledger created in the main thread is invisible to a worker unless
explicitly shared. The only way to share a JS-object fake across real OS
threads is to route every read/write through message-passing to a single
thread that owns the data. That thread processes messages **one at a time**.
The eight "simultaneous" debits are no longer simultaneous by the time they
reach the code under test — they are a queue, and the queue is what makes the
test pass. **A test that cannot fail by construction proves nothing about the
property it names.** This is the exact shape of the failure the queue's own
history in this repo warns about: `reapExpired()` "was always right" *until*
it was measured against genuine Windows concurrency, and "probably correct" is
the standard the credit ledger was moved off files specifically to stop
tolerating (superseded spec §1: *"‘probably correct’ is a different standard
from the one the rest of this repo holds itself to, and it is the standard
being applied to the only subsystem that handles money"*). A serialized fake
reintroduces that exact standard one layer up.

**Path B — the fake is rebuilt on a `SharedArrayBuffer` with real
`Atomics`-based locking, to genuinely support concurrent access from multiple
isolates.** This is possible in principle. It is also, at that point, **not a
fake of Postgres — it is a hand-written reimplementation of Postgres's MVCC
and row-locking**, in JavaScript, for one project. A test passing against it
proves the hand-written reimplementation is internally consistent with
itself. It proves nothing about whether `ledger_once` (a partial unique
index), `SELECT ... FOR UPDATE`, or `pg_advisory_lock` behave correctly in
**actual Postgres**, which is the thing shipping to production. This is
circular in the way a test suite that mocks the function it is testing is
circular.

**The project already reached this conclusion once, for a different backend,
and it is worth restating rather than rediscovering.** The superseded SQLite
spec explicitly rejected an in-memory substitute for exactly this reason (§5):
*"Tests get a file-backed temp database per test, not `:memory:`, because the
behaviour under test is multi-process locking."* That reasoning transfers to
Postgres unchanged. What does **not** transfer is the cost: a file-backed
`node:sqlite` temp database costs nothing to stand up (§0). A file-backed real
Postgres costs a running Postgres server.

**Conclusion, stated plainly: the seven race tests can only keep proving what
they prove today by running against a real, unmodified Postgres server with a
real second connection genuinely contending for the same row.** No fake, no
matter how carefully built, satisfies that. This is not a footnote to the
options below — it is the constraint that eliminates two of the five outright
and determines the shape of the other three.

---

## 5. Option 3 first, because it is the one with a definitive disqualifying answer

### pg-mem (`pg-mem` on npm, currently 3.0.14, last commit to master
2026-02-26)

Read directly from the maintainer, not inferred:

> *"Given that pg-mem does not support concurrent transactions, supporting
> `select for update` has no meaning. (if two transactions run in parallel,
> the last one to commit will fail.) pg-mem does not intend to reimplement a
> full-blown pg instance, only what's sufficient to write tests. So it could
> make sense to implement `select for update`, but only to ignore it and
> implement it as a regular `select`."*
> — oguimbal (pg-mem maintainer), [github.com/oguimbal/pg-mem/issues/117](https://github.com/oguimbal/pg-mem/issues/117#issuecomment-843785372), 2021-05-19. **Issue is still open.**

This is not a missing feature that a later release might add. It is a
statement about the architecture: **pg-mem has no concurrent-transaction
model at all.** It is a single-connection, single-threaded, synchronous
in-memory SQL emulator. There is nothing for `SELECT ... FOR UPDATE` or an
advisory lock to *do* in that model — there is never a second transaction to
block against. A search of the repository's issue tracker for "advisory"
returns zero results tied to `pg_advisory_lock`; the feature is undocumented
and, consistent with the FAQ's own admission that pg-mem implements "kind
of..." PL/pgSQL support and no Postgres extensions, there is no evidence it
exists.

**Partial unique indexes — the mechanism `ledger_once` depends on — are worse
than absent: they are half-implemented and known-buggy.**
[Issue #89](https://github.com/oguimbal/pg-mem/issues/89), "Support Partial
Indexes," was closed 2021-10-03, meaning the `WHERE` clause on `CREATE UNIQUE
INDEX` now parses. But two issues are open against the result: **#363,
"Partial constraints not working,"** and **#458, "Pg-Mem returns incomplete
data when index has a where clause that doesn't capture it."** The exact
guarantee `ledger_once` needs — a `UNIQUE(account_id, job_id, reason) WHERE
job_id IS NOT NULL` that rejects a second insert honestly — is precisely the
kind of case those two open issues describe as broken.

**This is the disqualifying finding the investigation asked for, stated
without hedging: pg-mem cannot host the seven race tests, and it cannot be
trusted to enforce the constraint the other ~278 tests rely on to prove
`debitCredits` idempotency even in the sequential case.** It is not merely
weaker evidence than real Postgres — for the concurrency tests specifically it
produces **false positives**: a `SELECT ... FOR UPDATE` against pg-mem
executes, returns success, and blocks nothing, because nothing is contending.
A test written to prove "the second debit blocks until the first commits,
then sees the correct balance" would pass against pg-mem for a reason that has
nothing to do with whether that property holds. **A green suite that proves a
false thing is more dangerous than a red one that cannot run at all**, because
nobody re-checks a green suite.

Where pg-mem *is* legitimately useful: fast, zero-dependency, zero-Docker unit
tests of ordinary SQL — a `SELECT` that should return one row, an `INSERT`
that should violate a plain (non-partial) constraint, schema shape assertions.
That is a real subset of the 285 tests. It is not the seven that matter most.

---

## 6. The four remaining options, evaluated against §1's numbers

### Option 1 — Supabase CLI local stack (`supabase start`, Docker Desktop)

| | |
|---|---|
| **Setup cost** | Docker Desktop must be installed (it is, on this machine) **and running** (it is not, right now, on this machine — measured in §1). `supabase start` then pulls **7 containers** — Postgres, GoTrue (Auth), PostgREST, Storage, Realtime, Kong (API gateway), and a Studio/Mailpit dev-tooling set — [supabase.com/docs/guides/local-development](https://supabase.com/docs/guides/local-development), fetched 2026-08-25. Docker Desktop's own minimum is 4GB RAM (8GB "recommended"), 6GB free disk, hardware virtualization — [usedocker.com/system-requirements](https://usedocker.com/system-requirements), 2026. |
| **Per-run time cost** | First pull: **2–3 minutes**, reported on GitHub Actions' Linux runners in [github.com/supabase/cli/issues/2724](https://github.com/supabase/cli/issues/2724) (opened 2024-10-02, images pulled sequentially — "excluded realtime and it still downloaded it"). That is the *fast* case; a Windows-with-WSL2 first pull is realistically slower and was not directly measured here. Warm start (images cached): reported as achievable "in under 60 seconds." Every `npm test` invocation either pays this warm-start cost or requires the stack to be left running persistently between sessions. |
| **Idle resource cost** | Docker Desktop's WSL2 VM idles around 1.5–2.5GB RAM before any container starts; a full 7-container Compose stack adds meaningfully more — [oneuptime.com](https://oneuptime.com/blog/post/2026-02-08-how-to-configure-docker-desktop-memory-and-cpu-limits-on-windows/view), 2026-02-08. That is RAM committed for the whole dev session, not just during `npm test`. |
| **Do the seven race tests still prove what they prove today?** | **Yes, fully** — this is real Postgres underneath. GoTrue and PostgREST add nothing to the concurrency guarantee (that lives in Postgres itself) but add the ability to test against real `auth.users` and real RLS, which is the actual reason the project chose Supabase in the first place (CLAUDE.md §2: *"he wants sign in with Google... plus password login, plus password reset"*). |
| **Works offline?** | No, for the first pull (image download). Once images are cached, `supabase start` works fully offline. |
| **Could CI run it?** | On the `ubuntu-latest` leg of this repo's matrix: yes, this is the standard supported path (`supabase/setup-cli` + `supabase start`, documented for Linux). **On the `windows-latest` leg: no.** GitHub Actions service containers and Docker container actions "only work on Linux runners" — confirmed by multiple issues against `actions/runner` and GitHub's own hosted-runner docs, e.g. [github.com/actions/runner/issues/1866](https://github.com/actions/runner/issues/1866). This repo's Windows CI leg exists *specifically* to catch libuv-on-Windows bugs (CLAUDE.md: *"this repository's most expensive rulings were measured on Windows and only on Windows"*) — a Postgres dependency that cannot run there is a real, not theoretical, loss of exactly the coverage that leg was added for. |
| **Failure on a machine without Docker running** | Measured directly, §1: loud and immediate — `supabase start` shells out to the Docker CLI and would surface the identical `failed to connect to the docker API` error this investigation reproduced on this exact machine just now. Not silent. |

### Option 2 — Plain Postgres in Docker, no Supabase stack

| | |
|---|---|
| **Setup cost** | One container: `postgres:16-alpine`, compressed image **~90MB** ([Docker Hub layer data, 16.0-alpine3.18](https://hub.docker.com/_/postgres), cross-checked against several patch tags), against 7 images and hundreds of MB for the full Supabase stack. Same Docker Desktop prerequisite as Option 1 — same "not running right now" failure mode. |
| **Per-run time cost** | One image pull (seconds after the first time, cached), one container start with a healthcheck (a few seconds to accept connections), schema/migration apply, then the tests. No Kong, no GoTrue, no Realtime, no Storage sitting idle. Materially cheaper per run and at idle than Option 1. |
| **Do the seven race tests still prove what they prove today?** | **Yes, fully** — same underlying Postgres engine, same PL/pgSQL, same partial unique indexes, same row locks, same advisory locks. Nothing about `ledger_once`, `debitCredits`'s idempotency, or the free-tape ceiling depends on GoTrue or PostgREST; those guarantees are enforced by Postgres itself. |
| **What it does NOT give you** | `auth.users` and GoTrue. Any test that needs a *real* Supabase-issued session/JWT, or the actual Google-OAuth-to-`auth.users` linking flow (CLAUDE.md §2's stated reason for choosing Supabase at all), cannot be exercised here. Those become either Option 1's problem for a *much smaller* set of true end-to-end auth-flow tests, or are accepted as tested only against a real (non-local) Supabase project occasionally rather than on every run. |
| **Works offline?** | Same as Option 1: no for first pull, yes once cached. |
| **Could CI run it?** | `ubuntu-latest`: yes, trivially — a plain `services: postgres:` block is the textbook GitHub Actions pattern and does not need the Supabase CLI at all. `windows-latest`: no, same Linux-runner-only limitation as Option 1. |
| **Failure on a machine without Docker running** | Same shape as Option 1 — a connection to `localhost:5432` from a `pg`-driver-based test would fail loudly with `ECONNREFUSED`, immediately, not silently. |
| **A friction worth naming** | This repo's stated architecture is PostgREST-over-`fetch`, deliberately **not** `@supabase/supabase-js`, specifically to keep zero npm runtime dependencies (CLAUDE.md §2). A bare Postgres container has no PostgREST layer, so tests exercising the actual HTTP-facing seam would need either PostgREST added back in front of plain Postgres (partially re-deriving Option 1) or a direct SQL-level test harness using a `pg`-family client as a **devDependency only** — which does not violate the runtime-zero-dependency rule but is a decision worth stating explicitly rather than discovering by accident. |

### Option 4 — Repository seam with a fake (the superseded-spec approach), for everything *except* the concurrency proofs

| | |
|---|---|
| **Setup cost** | None beyond code: `accounts.mjs`, `credits.mjs`, `session.mjs` keep their exact exported signatures (the superseded spec's own §2 already establishes this pattern), with an in-memory or file-backed fake behind them for the default test run. |
| **Per-run time cost** | Effectively the same as today — in-process, no network, no Docker. This is the only option that preserves `npm test`'s current ~92s / zero-dependency character for the ~278 non-race tests. |
| **Do the seven race tests still prove what they prove today?** | **No — established in §4, and this is the load-bearing answer to the investigation's central question.** A fake, run any way that keeps it a fake, cannot host these seven tests and produce the same kind of evidence. This is true regardless of how well the rest of the seam is built. |
| **What it buys** | The other ~278 tests — validation, edge cases, error messages, the shape of `entriesOf`, refund logic, the whole non-concurrent surface — get to stay fast and hermetic. That is most of the test count and a real, non-trivial win. |
| **What it stops proving, named plainly** | Anything about **genuine simultaneous access** to the ledger, the free-tape ceiling, or the session secret. If the seven race tests are simply deleted or downgraded to sequential assertions against the fake (call `debitCredits` twice in a `for` loop instead of from eight real threads), the suite goes green while the actual question — "does the real database's constraint stop a real race?" — goes untested by anything that runs regularly. That is a strictly worse position than today's file-based tests, which do prove it, however awkwardly. |
| **Works offline / CI** | Trivially yes, for the fake-backed portion. Says nothing about the race tests, which this option cannot host at all. |
| **Honest framing** | This option is not a competitor to Options 1/2 — it is a **complement**. It answers "how do I keep 278 tests cheap," not "how do I keep 7 tests true." Any real recommendation combines this with a real-Postgres option for the tests it cannot cover. |

### Option 5 — Split suites, gated behind a flag (e.g. `TIMESTAMP_DB=1`)

| | |
|---|---|
| **Setup cost** | Low — this is an organizational pattern, not a new dependency. The precedent already exists in this exact repo: `*-smoke.test.js` self-skips without `TIMESTAMP_LIVE=1` (CLAUDE.md, Money discipline, guard 4). |
| **Per-run time cost** | Zero for `npm test` itself — gated tests are skipped, not run, exactly like the fal smoke tests today. All the cost of Options 1/2 lands only on whoever/whatever sets the flag. |
| **Do the seven race tests still prove what they prove today?** | **Only as well as whatever backend sits behind the flag.** This option is orthogonal to the concurrency question — it decides *when* the real-Postgres tests run, not *whether* they can prove anything. Paired with Option 2 (plain Postgres), the answer is yes, fully, whenever the flag is set. Paired with Option 3 (pg-mem) behind a flag, the answer is still no — a flag does not fix an architectural absence of concurrent transactions. |
| **Works offline** | Yes, in the sense that the default `npm test` needs nothing. No, in the sense that setting the flag inherits whatever backend is chosen. |
| **Could CI run it?** | Yes on `ubuntu-latest` if the flag is set in that job only; the `windows-latest` job would either not set it (accepting the coverage gap named in Option 1/2) or would need its own working Docker path, which per the citations above it does not have. |
| **The honesty cost, stated as asked** | This repo has direct, recent, first-hand evidence of what "usually does not run" costs. CLAUDE.md §4 records **two genuinely flaky tests that fire only under full parallel load** and were *not* papered over precisely because "four sources of red is how a build gets ignored." §12 records a test that "passes 3/3 in isolation" and fails under load, with an explicit warning to re-run before believing a red result. A flag-gated Postgres suite is a **third category of tests nobody runs by habit** — worse than a flaky test (which at least runs and sometimes fails loudly) because it can go stale silently: a schema drifts, an import breaks, a constraint name changes, and the flag-gated suite would not know until someone remembers to set the flag, which on a solo project with no forcing function is exactly the failure mode `guards.yml` was built to catch for other invariants. **The mitigation this repo already uses for its other gated category — CI enforcement so the gate cannot rot unnoticed — is available here too**, but only on the Linux CI leg (per Options 1/2's CI row), so the mitigation itself has a gap. |
| **Ergonomic cost** | A solo developer, iterating locally, gets the same fast feedback loop as today for the 278 tests and pays the Docker/Postgres startup cost only when explicitly running the gated suite — the least disruptive of the five options to daily workflow. |

---

## 7. Ranked recommendation

1. **Option 2 (plain Postgres in Docker) + Option 5 (flag-gated) + Option 4
   (fake seam) for the non-race majority — used together, not any one alone.**
   The fake seam keeps the ~278 non-concurrency tests exactly as cheap as
   today; a plain `postgres:16-alpine` container, gated behind a flag
   analogous to `TIMESTAMP_LIVE=1`, is the cheapest real-Postgres runtime that
   can host the seven race tests without lying about what it proves. It skips
   the Supabase-stack weight (7 containers, GoTrue, Kong, Realtime, Storage)
   that the money-correctness tests do not need. Enforce it in CI on the
   `ubuntu-latest` leg specifically so the gate cannot silently rot — this
   repo already knows, from its own flaky-test history, what an unenforced
   "usually doesn't run" category costs.
2. **Option 1 (full Supabase CLI stack), reserved for a small, separate suite
   of true auth-flow tests** — the ones that actually need `auth.users` and
   GoTrue (Google OAuth linking, password reset), which is the actual reason
   Supabase was chosen over a self-hosted database (CLAUDE.md §2). Do not use
   it as the runtime for the money/race tests — it is strictly heavier than
   Option 2 for a guarantee (Postgres's own concurrency control) that does not
   need GoTrue at all.
3. **Option 3 (pg-mem) is disqualified for the race tests and should not be
   used for them at all**, on the maintainer's own words plus two open bug
   reports against the exact constraint mechanism `ledger_once` depends on. It
   may still be worth adopting narrowly for the cheapest, most mechanical
   sequential SQL-shape tests, if that saves meaningfully over the fake seam
   for that subset — a judgment call outside this investigation's scope, and
   a minor one next to the disqualification above.
4. **Option 4 alone, or Option 5 alone, is not a real option** — §4 and the
   individual option rows above establish that a fake cannot host the race
   tests under any construction, and a flag by itself is neutral on backend
   choice. Both are necessary ingredients of the recommendation, neither is
   sufficient by itself.

---

## 8. Direct answer to the investigation's closing question

**Does ANY option preserve the seven race tests' current proving power?**

**Yes — but only the two options that put a real, unmodified Postgres server
behind them (Option 1 or Option 2), and only for as long as the tests
actually run against it.** Wrapping either in Option 5's flag preserves the
proving power *conditionally* — true whenever the flag is set, silent and
unverified whenever it is not, which on a solo project with no CI enforcement
on the platform that matters (Windows, per the citations in §6) is a real and
named gap, not a hypothetical one.

**No option makes this free the way `node:sqlite` was free.** That is the
actual cost of the Supabase pivot that nobody has priced until now: the
project traded a database that could be embedded in the test process at zero
setup cost for one that gives Paul Google sign-in and password reset, and the
seven tests that prove money is safe under real concurrency are the specific
line item that bill lands on. Every option above is a way of paying it —
Docker-in-CI-and-locally is the honest price, a flag defers when it is paid,
and a fake is the option that looks like it avoids paying but actually just
stops proving the thing the tests exist to prove.
