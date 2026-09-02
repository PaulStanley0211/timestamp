/**
 * Account deletion, whole. The one place that knows the ORDER, built to
 * docs/superpowers/specs/2026-08-29-account-deletion-export-design.md §1.
 *
 * WHY THE ORDER IS THE MODULE. Deletion touches identity, jobs, sessions and
 * the account record, and the correctness rules are all about sequence: the
 * lease check must come before anything irreversible, the Supabase identity
 * must go FIRST (a crash after it leaves cleanable local litter; a crash after
 * a local-first delete leaves a live upstream identity pointing at nothing --
 * the `4f53dc6` rebind trap), and the local record must go LAST because every
 * earlier step needs it to find what else to delete. Two call sites need that
 * sequence -- `POST /account/delete` and `npm run accounts -- delete` -- and
 * two copies of one correctness rule is how one of them drifts.
 *
 * WHAT THE CALLER SUPPLIES AND WHY. `api` is the flat auth surface
 * (`loadAuth()`'s shape): the web route reaches deletion through the same seam
 * as everything else so a test fake without `deleteAccount` makes the route
 * answer 503 instead of crashing -- spec §5 says these functions are
 * feature-detected, never added to `REQUIRED_AUTH`. `isClaimed` is the queue's
 * answer, injected the way `sweepRetention` takes a `skip` set, and it
 * DEFAULTS TO "YES": a caller that cannot say whether a worker is rendering
 * gets a refusal, not a race. The default is the point -- the careless call is
 * the safe one, same rule as `executePurge`'s dry run.
 *
 * WHAT DELETION KEEPS, deliberately (spec §1): the free-tape register (its
 * ceiling counts grants across every account that has EVER existed --
 * decrementing it is the create-delete-create farm), Stripe's own records,
 * and `out/refunds/` (settled ones are audit trail; PENDING ones are money the
 * operator must resolve, so they are returned to the caller rather than
 * vanished). The credit ledger goes with the account record -- spec §1's open
 * question, answered as option (a) delete-everything with Stripe as the
 * financial record; option (b), an anonymised copy under
 * `out/deleted-ledgers/<accountId>.json`, is one extra write here if Paul
 * decides financial-records retention wants it.
 */

import fs from 'node:fs';

import { OWNERS_DIR } from './accounts.mjs';
import { JOB_ID_RE, jobPaths } from '../render/job.mjs';
import { purgeJobMedia } from '../render/purge.mjs';

const defaultNow = () => new Date();

export class DeletionError extends Error {
  constructor(message, { code = 'DELETION_FAILED', jobIds = null, userMessage = null } = {}) {
    super(message);
    this.name = 'DeletionError';
    this.code = code;
    /** Only for JOB_CLAIMED: which tapes are still rendering. */
    this.jobIds = jobIds;
    this.userMessage = userMessage ?? 'We could not delete the account. Please try again.';
  }
}

/** Every job id in the account's ownership index. The index file's existence
 *  is the ownership fact (session-middleware.mjs owns the format); anything in
 *  the directory that is not a job entry is removed with the directory. */
function ownedJobIds(fsImpl, root, accountId) {
  let names;
  try { names = fsImpl.readdirSync(`${root}/${OWNERS_DIR}/${accountId}`); } catch { return []; }
  return names
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .filter((id) => JOB_ID_RE.test(id))
    .sort();
}

/** The pending reconciliation records for these jobs. The path and shape are
 *  owned by `scripts/web/session-middleware.mjs` (`recordMissedRefund`); read
 *  here rather than imported because auth must not depend on the web layer,
 *  and the agreement is pinned by a web-level test that seeds through the real
 *  writer. `settled: null` is the one state that is money rather than trail.
 *  A record that EXISTS but will not parse might be pending money, so it is
 *  reported as unreadable rather than dropped -- the report is the operator's
 *  courtesy copy, and a courtesy that under-reports money is the F2 shape in
 *  miniature. A missing file is the common case and means nothing. */
function pendingRefundsFor(fsImpl, root, jobIds) {
  const pending = [];
  for (const jobId of jobIds) {
    let raw;
    try { raw = fsImpl.readFileSync(`${root}/out/refunds/${jobId}.json`, 'utf8'); } catch { continue; }
    let record;
    try { record = JSON.parse(raw); } catch { pending.push({ jobId, unreadable: true }); continue; }
    if (record && record.settled == null) {
      pending.push({ jobId, credits: record.credits ?? null, reason: record.reason ?? null, at: record.at ?? null });
    }
  }
  return pending;
}

/**
 * Deletes one account everywhere this system can reach, in the spec's order:
 *
 *   0. refuse the WHOLE deletion if any owned job holds a live lease
 *   1. the Supabase identity (external, irreversible -- FIRST)
 *   2. every owned job: cancel sentinel, media purge, directory
 *   3. the ownership index directory
 *   4. every session for the account
 *   5. the local account record, indexes included -- LAST
 *
 * Throws before step 1 on a refusal (nothing has happened); throws AT step 1
 * on an upstream failure (nothing local has happened). From step 2 on,
 * per-file failures are collected into `errors` rather than thrown, because
 * the upstream identity is already gone and stopping halfway helps nobody --
 * but a failure in steps 4-5 still throws, since the retry path is safe
 * (`adminDeleteUser` treats an already-gone user as deleted).
 *
 * @returns {{accountId, email, supabase: object, jobsDeleted: number,
 *            sessionsDestroyed: number, pendingRefunds: Array, errors: Array}}
 */
export async function deleteAccountEverywhere({
  root,
  accountId,
  api,
  supabase = null,
  isClaimed = () => true,
  fsImpl = fs,
  nowImpl = defaultNow,
}) {
  for (const name of ['loadAccount', 'deleteAccount', 'destroySessionsForAccount']) {
    if (typeof api?.[name] !== 'function') {
      throw new TypeError(`deleteAccountEverywhere needs api.${name} -- callers feature-detect before calling`);
    }
  }

  const account = api.loadAccount({ root, accountId });
  const jobIds = ownedJobIds(fsImpl, root, accountId);

  // 0. The lease check, before anything irreversible. A live lease is minutes
  // of delay, not a denial -- and it keeps this from racing a renderer that is
  // writing into the directory being removed (the retention sweep's rule).
  const rendering = jobIds.filter((jobId) => isClaimed(jobId));
  if (rendering.length > 0) {
    throw new DeletionError(`${rendering.length} job(s) hold a live lease: ${rendering.join(', ')}`, {
      code: 'JOB_CLAIMED',
      jobIds: rendering,
      userMessage: 'A tape is still rendering. Cancel it first, then delete the account.',
    });
  }

  const pendingRefunds = pendingRefundsFor(fsImpl, root, jobIds);

  // 1. The upstream identity. An account with none skips the call; an account
  // WITH one refuses to proceed without a client, because a deletion that
  // silently skips the upstream half is worse than one that says "not right
  // now" (spec §4).
  let upstream = { skipped: 'no-supabase-user' };
  if (account.supabaseUserId !== null) {
    if (typeof supabase?.adminDeleteUser !== 'function') {
      throw new DeletionError('the account has a Supabase identity and no client is configured to delete it', {
        code: 'IDENTITY_UNAVAILABLE',
        userMessage: 'Account deletion is not available right now.',
      });
    }
    const { missing } = await supabase.adminDeleteUser({ supabaseUserId: account.supabaseUserId });
    upstream = { deleted: true, missing: Boolean(missing) };
  }

  // 2. The jobs. Same deletion `DELETE /api/jobs/:id` performs -- sentinel so
  // a worker that claims in the race window stops at its next step boundary,
  // then the media purge with its per-file failure reporting -- and then the
  // whole directory, which the API route keeps and deletion does not.
  //
  // TWO ACCEPTED TRADE-OFFS, stated rather than discovered (review,
  // 2026-08-29). First: the lease check above ran before the upstream await,
  // so a worker can claim a pending job during that round trip; the sentinel
  // written here stops it at its next step boundary, and a file it still
  // holds open surfaces in `errors` and waits for the retention sweep.
  // Writing sentinels BEFORE the upstream call would narrow that window, at
  // the price that an upstream refusal leaves the person's queued tapes
  // cancelled -- a deletion that failed must change nothing, and that rule
  // wins. Second: a queued job's pending queue entry outlives its directory;
  // the worker that later claims it takes the terminal missing-manifest path
  // loudly and refunds nothing (there is no ledger left to refund into), and
  // that one spurious failed/ entry per deleted-while-queued job is accepted
  // noise, not a leak.
  const errors = [];
  let jobsDeleted = 0;
  for (const jobId of jobIds) {
    const paths = jobPaths(root, jobId);
    try {
      fsImpl.writeFileSync(paths.cancelRequest, JSON.stringify({
        requestedAt: nowImpl().toISOString(), by: 'account-deletion',
      }));
    } catch { /* the directory is about to go; the sentinel is a race-narrower, not a record */ }
    const purge = purgeJobMedia(paths, { fsImpl });
    for (const err of purge.errors) errors.push({ jobId, ...err });
    try {
      fsImpl.rmSync(paths.dir, { recursive: true, force: true });
      jobsDeleted += 1;
    } catch (err) {
      errors.push({ jobId, path: paths.dir, message: err.message, code: err.code ?? null });
    }
  }

  // 3. The ownership index directory.
  try {
    fsImpl.rmSync(`${root}/${OWNERS_DIR}/${accountId}`, { recursive: true, force: true });
  } catch (err) {
    errors.push({ path: `${root}/${OWNERS_DIR}/${accountId}`, message: err.message, code: err.code ?? null });
  }

  // 4. Every session, then 5. the record -- the two steps whose failure
  // throws, because retrying the whole deletion is safe and cheap.
  const sessionsDestroyed = api.destroySessionsForAccount({ root, accountId });
  api.deleteAccount({ root, accountId });

  return {
    accountId,
    email: account.email,
    supabase: upstream,
    jobsDeleted,
    sessionsDestroyed,
    pendingRefunds,
    errors,
  };
}
