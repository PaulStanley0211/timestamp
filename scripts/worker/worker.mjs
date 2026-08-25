/**
 * The render worker. The process that claims a job and drives it through the
 * pipeline, and the only process in this system that is allowed to be slow.
 *
 * WHY THIS IS A SEPARATE PROCESS AT ALL. Vercel's serverless runtime has no
 * ffmpeg binary and the entire look of this product lives in ffmpeg, so the app
 * serves HTTP and never renders and this file renders and never serves HTTP.
 * That split is designed in from day one specifically so that it is not a
 * rewrite on the day the app moves off this machine: the two processes already
 * talk through `out/queue` and a manifest, and neither one holds state the
 * other needs.
 *
 * WHY THE LEASE IS THE CENTRAL CONCERN OF THIS FILE. A `tape` step is ~30
 * seconds of ffmpeg; a generation call is minutes. If the lease expires while
 * the work is still running, `reapExpired()` hands the job to another worker
 * and there are now two processes writing one manifest -- which the job model
 * explicitly cannot survive, because `saveJob` writes a single fixed
 * `manifest.json.tmp` and two writers race on it. So the rule is: **the lease
 * outlives the work, or the work stops.** The worker heartbeats during long
 * steps, and the moment `heartbeat` reports LEASE_LOST it aborts the pipeline
 * through the `AbortSignal` and writes nothing further -- not a manifest, not a
 * queue transition. Reporting success on a job somebody else now owns is the
 * worst outcome available here, because nothing downstream would ever look at
 * it again.
 *
 * WHY `once()` IS THE UNIT AND `start()` IS A LOOP AROUND IT. Everything
 * interesting -- claiming, reviving, heartbeating, failing, releasing -- happens
 * inside one job. `once()` claims at most one job, runs it, and returns whether
 * it did any work, which is a function a test can call directly with a fake
 * clock and no timers at all. `start()` adds the poll loop, the startup reap
 * and the signal handlers, and nothing else. A worker whose only testable
 * surface was "run forever" would be tested by sleeping, and tests that sleep
 * do not get run.
 *
 * WHY `release()` AND NOT `fail()` ON SHUTDOWN. `fail` burns an attempt;
 * `release` does not. A graceful restart is not a failure, and charging it an
 * attempt means four ordinary deploys can exhaust the retry budget of a job
 * that never once errored. The two calls look interchangeable at the call site
 * and are not, which is why the shutdown path is written out separately below
 * rather than folded into the error path.
 *
 * WHY THE WORKER REVIVES A FAILED MANIFEST. `queue.fail(..., {retriable:true})`
 * puts the job back in `pending`, but the manifest it points at still says
 * `failed`, and `beginStep` refuses to begin a failed step -- deliberately, so
 * that a resume cannot silently re-run something that already has a recorded
 * charge. Somebody has to make the retry an explicit act, and it is this file:
 * it holds the lease, so it is the manifest's one legitimate writer. This is
 * also what makes the queue's promise true that re-enqueueing something out of
 * `failed/` is how a human resumes a job.
 *
 * WHY STEP EVENTS ARE READ OFF THE JOB AND NOT ONLY OFF `onProgress`. The
 * failure mode of a background worker is a person staring at a silent terminal
 * wondering whether it is working. `onProgress`'s payload shape is the
 * pipeline's business and this file must not depend on it to know what is
 * happening, so the worker diffs `job.steps` -- the same object the pipeline is
 * mutating through `beginStep`/`finishStep` -- and reports transitions from
 * there. A pipeline that never calls `onProgress` at all still produces a
 * readable step-by-step stream, and the per-step timings that stream carries
 * are the input to the "does this need a queue and an email rather than a
 * spinner" question the product still has to answer.
 */

import process from 'node:process';
import { hostname } from 'node:os';
import { loadJob, saveJob, retryStep, setJobStatus } from '../render/job.mjs';
import { sweepRetention as runRetentionSweep } from '../render/purge.mjs';
import { isRetriable } from '../providers/errors.mjs';

/** How long an idle worker waits before asking the queue again. One second is
 *  the documented default (docs/interfaces.md §8); it is a directory listing,
 *  not a network call. */
export const DEFAULT_POLL_MS = 1000;

/** How often a long-lived worker re-runs the retention sweep. Retention is
 *  measured in whole days, so hourly is far more often than it needs to be --
 *  which is the point: the cost is one `readdir` plus a manifest read per job,
 *  and the alternative is a promise that is only kept when somebody restarts
 *  the worker. */
export const DEFAULT_RETENTION_SWEEP_MS = 3_600_000;

/** Every event type `onEvent` can emit. Exported so the CLI's renderer and a
 *  future web `/api/health` read from one list rather than two that drift. */
export const EVENTS = Object.freeze([
  'reaped',            // startup recovery: dead leases returned to pending
  'purged',            // retention: photos and jobs past their promised windows
  'claimed',           // this worker owns a job
  'revived',           // a failed manifest was reset so it can be resumed
  'step-started',
  'step-finished',
  'progress',          // whatever the pipeline passed to onProgress
  'heartbeat',         // the lease was extended
  'completed',
  'awaiting-selection',// parked in front of a human; the web layer re-enqueues
  'parked',            // --stop-after reached
  'cancelled',         // NOT a failure: no attempt burned, nothing in failed/
  'failed',
  'released',          // handed back without burning an attempt
  'lease-lost',        // somebody else owns this job now; we stopped
  'idle',
  'signal',            // SIGINT/SIGTERM received
  'stopping',
  'stopped',
  'forced',            // second signal: exiting without unwinding
]);

export class WorkerError extends Error {
  constructor(message, { code = 'WORKER_ERROR', jobId = null, detail = null } = {}) {
    super(message);
    this.name = 'WorkerError';
    this.code = code;
    this.jobId = jobId;
    this.detail = detail;
  }
}

const STEP_NAMES = new Set(['intake', 'moderate', 'expand', 'compose', 'still',
  'select', 'animate', 'assemble', 'tape', 'verify', 'publish']);

/** Terminal step statuses, in the job model's vocabulary. `skipped` is not
 *  `done` and the ledger cares about the difference, so the event carries the
 *  status rather than flattening both to "finished". */
const STEP_ENDED = new Set(['done', 'skipped', 'failed']);

/**
 * The pipeline is imported lazily and by path, not statically, for two
 * reasons that both matter. It is being written concurrently against
 * docs/interfaces.md §7 and may not exist yet; and a static import would drag
 * ffmpeg and a real provider into every test that ever constructs a worker.
 * The tests inject a fake and this function is never reached by them.
 */
let pipelineModule = null;
async function defaultRunPipeline(job, opts) {
  if (pipelineModule === null) {
    try {
      pipelineModule = await import('../render/pipeline.mjs');
    } catch (err) {
      throw new WorkerError(
        `could not load scripts/render/pipeline.mjs: ${err.message}. The worker claims jobs and ` +
        'drives them; the pipeline is what a job actually is. Nothing can render until it exists.',
        { code: 'NO_PIPELINE', jobId: job?.jobId ?? null },
      );
    }
    if (typeof pipelineModule.runPipeline !== 'function') {
      throw new WorkerError('scripts/render/pipeline.mjs does not export runPipeline()', {
        code: 'NO_PIPELINE', jobId: job?.jobId ?? null,
      });
    }
  }
  return pipelineModule.runPipeline(job, opts);
}

/** Interruptible, so a Ctrl-C during the idle poll does not sit out the rest of
 *  a second before anything happens. */
function defaultSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    let timer = null;
    const done = () => {
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener?.('abort', done);
      resolve();
    };
    timer = setTimeout(done, ms);
    signal?.addEventListener?.('abort', done, { once: true });
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

/** ISO string -> epoch ms, or null. The manifest stores ISO because a manifest
 *  is read by humans; elapsed time is arithmetic and needs a number. */
function msOf(iso) {
  if (typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** What goes in an event and in `queue.fail`: the code, the message and the
 *  retry verdict. The stack, the step and the provider response live in the
 *  manifest -- duplicating them here would give two accounts of one failure. */
function brief(err) {
  if (err == null) return { code: null, message: 'unspecified failure', retriable: false };
  if (typeof err === 'string') return { code: null, message: err, retriable: false };
  return {
    code: err.code ?? null,
    message: String(err.message ?? err),
    retriable: err.retriable === true,
  };
}

const isAbortError = (err) => err?.name === 'AbortError' || err?.code === 'ABORT_ERR';

/**
 * @param {object}   opts
 * @param {string}   opts.root                repo root (or a test's temp dir)
 * @param {object}   opts.cfg                 config/render.json as loaded
 * @param {object}   opts.provider            a provider from scripts/providers/index.mjs
 * @param {object}   opts.queue               a queue from scripts/queue/queue.mjs
 * @param {number}   [opts.pollMs]            idle poll interval
 * @param {string}   [opts.workerId]          identifies the lease holder
 * @param {Function} [opts.onEvent]           structured observability
 * @param {string}   [opts.stopAfter]         pipeline stop point, e.g. 'select'
 * @param {object}   [opts.providerCtx]       passed through to the pipeline
 * @param {Function} [opts.nowImpl]           () => epoch ms (a Date is accepted)
 * @param {Function} [opts.sleepImpl]         (ms, signal) => Promise
 * @param {Function} [opts.runPipelineImpl]   injected in tests; never spends
 * @param {Function} [opts.refundImpl]        async (job, {reason}) => {refunded, credits?, accountId?};
 *                                            consulted when a job ends with no tape -- terminal failure
 *                                            or cancellation. Null means this worker cannot refund
 *                                            (no accounts wired), which is every test rig and the
 *                                            direct-CLI render.
 * @param {Function} [opts.loadJobImpl]
 * @param {Function} [opts.saveJobImpl]
 * @param {Function} [opts.setIntervalImpl]
 * @param {Function} [opts.clearIntervalImpl]
 * @param {number}   [opts.heartbeatMs]       lease extension cadence
 * @param {object|null} [opts.retention]     `{photoDays, jobDays}`; defaults to
 *                                          `cfg.retention`. `null` disables the
 *                                          sweep entirely.
 * @param {number}   [opts.retentionSweepMs]  cadence of the repeat sweep
 * @param {boolean}  [opts.signals]           install SIGINT/SIGTERM handlers
 * @param {object}   [opts.processImpl]       the process to listen on and exit
 */
export function createWorker({
  root,
  cfg,
  provider,
  queue,
  pollMs = DEFAULT_POLL_MS,
  workerId = `${hostname()}-${process.pid}`,
  onEvent = null,
  stopAfter = null,
  providerCtx = {},
  nowImpl = () => Date.now(),
  sleepImpl = defaultSleep,
  runPipelineImpl = defaultRunPipeline,
  refundImpl = null,
  loadJobImpl = loadJob,
  saveJobImpl = saveJob,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  heartbeatMs,
  retention,
  retentionSweepMs = DEFAULT_RETENTION_SWEEP_MS,
  signals = false,
  processImpl = process,
} = {}) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new WorkerError('root must be a non-empty string', { code: 'BAD_ROOT' });
  }
  for (const method of ['claim', 'heartbeat', 'complete', 'fail', 'release', 'reapExpired']) {
    if (typeof queue?.[method] !== 'function') {
      throw new WorkerError(`queue must be a queue from scripts/queue/queue.mjs -- no ${method}()`, {
        code: 'BAD_QUEUE',
      });
    }
  }

  /**
   * One job, one call at a time, and the number lives in config/render.json so
   * that raising it on the day a web app fans out is a one-line change here
   * rather than a refactor. It is read rather than assumed, and a config that
   * says something else is refused rather than quietly ignored: a worker that
   * prints "maxInflight: 4" and renders one job at a time is worse than one
   * that says it cannot do that yet.
   */
  /**
   * The retention windows, or null.
   *
   * `retention` is read from `cfg` rather than defaulted here, because the
   * numbers in `config/render.json` are the ones `scripts/safety/consent.mjs`
   * quotes to the user -- inventing a fallback would mean a worker enforcing a
   * policy nobody was shown. An explicit `null` disables the sweep, for an
   * operator who runs `npm run purge` from a scheduler instead.
   */
  const windows = (() => {
    // `null` is the one way to say "not here" and it has to be said out loud.
    if (retention === null) return null;
    const source = retention ?? cfg?.retention ?? null;
    // Nothing configured anywhere is not a misconfiguration -- it is a worker
    // that was never asked to sweep, e.g. every test rig that predates this.
    if (source == null) return null;

    const photoDays = Number(source.photoDays);
    const jobDays = Number(source.jobDays);
    if (!Number.isFinite(photoDays) || !Number.isFinite(jobDays)) {
      // REFUSED AT CONSTRUCTION, exactly as `cfg.provider.maxInflight` is a few
      // lines below. Returning null here instead would mean a typo in the
      // retention block silently disables the deletion this system promises
      // every user -- the promise going quietly unkept, which is the finding
      // `scripts/render/purge.mjs` exists to close. `purge-cli.mjs` refuses the
      // same input loudly; the scheduled path must not be the lenient one.
      throw new WorkerError(
        `retention must be {photoDays, jobDays} as numbers, got ${JSON.stringify(source)}. `
        + 'Pass retention: null to switch the sweep off deliberately.',
        { code: 'BAD_RETENTION', detail: { retention: source } },
      );
    }
    return { photoDays, jobDays };
  })();

  const maxInflight = cfg?.provider?.maxInflight ?? 1;
  if (maxInflight !== 1) {
    throw new WorkerError(
      `cfg.provider.maxInflight is ${maxInflight}; this worker runs exactly one job at a time. ` +
      'Concurrency is a pool that has not been built and was not asked for -- run more worker ' +
      'processes, or set maxInflight back to 1.',
      { code: 'UNSUPPORTED_CONCURRENCY', detail: { maxInflight } },
    );
  }

  const now = () => {
    const t = Number(nowImpl());
    if (!Number.isFinite(t)) {
      throw new WorkerError(`nowImpl returned ${t}; it must return epoch milliseconds`, { code: 'BAD_CLOCK' });
    }
    return t;
  };

  /**
   * Fast enough that a lease cannot expire between two beats, slow enough that
   * it is not writing the lock file in a loop. `pollIntervalMs` is the config's
   * own answer to "how often do we check on a long remote call", and a third of
   * the lease is the backstop for a configuration that makes them disagree.
   */
  const leaseMs = Number(queue.leaseMs) || 900_000;
  const beatEvery = heartbeatMs ?? Math.max(
    1000,
    Math.min(Number(cfg?.provider?.pollIntervalMs) || 5000, Math.floor(leaseMs / 3)),
  );

  let running = false;
  let stopping = false;          // the loop should not claim again
  let stopRequested = false;     // an in-flight job should stop at the next step boundary
  let forced = false;
  let hasReaped = false;
  let inFlight = null;
  let stopped = null;            // resolves when start()'s loop has exited
  let stopSignal = new AbortController();
  let removeSignalHandlers = null;

  function emit(type, data = {}) {
    if (typeof onEvent !== 'function') return;
    try {
      onEvent({ type, at: now(), workerId, ...data });
    } catch {
      // A logger that throws must not kill a render that has already been paid
      // for. Observability is not allowed to be load-bearing.
    }
  }

  /**
   * Runs one claimed job to a queue transition. Everything that can go wrong
   * with a lease is handled in here, because this is the only scope that holds
   * a token.
   */
  async function runOne(claim) {
    const { jobId, token } = claim;
    const jobStartedAt = now();
    const controller = new AbortController();

    let leaseLost = false;
    let shutdownAborted = false;
    let openStep = null;
    let openStepAt = jobStartedAt;
    let lastBeatAt = jobStartedAt;
    const seenStatus = new Map();

    const loseLease = (err) => {
      if (leaseLost) return;
      leaseLost = true;
      emit('lease-lost', { jobId, step: openStep, error: brief(err) });
      // A reaper took this job and another worker may already be rendering it.
      // Stop now: two processes writing one manifest is precisely what the
      // lease exists to prevent, and finishing politely would be worse than
      // stopping rudely.
      controller.abort(new WorkerError(`lease lost on ${jobId}`, { code: 'LEASE_LOST', jobId }));
    };

    const beat = (force = false) => {
      if (leaseLost) return;
      const t = now();
      if (!force && t - lastBeatAt < beatEvery) return;
      lastBeatAt = t;
      try {
        const deadline = queue.heartbeat(jobId, token);
        emit('heartbeat', { jobId, step: openStep, deadline });
      } catch (err) {
        if (err?.code === 'LEASE_LOST') { loseLease(err); return; }
        // Anything else -- a scanner holding the lock file open for a
        // millisecond, a disk hiccup -- is not a reason to abandon a render
        // that may already have been paid for. The next beat retries, and if
        // none of them ever land the reaper takes the job, which is the
        // designed backstop rather than a surprise.
        emit('heartbeat', { jobId, step: openStep, deadline: null, error: brief(err) });
      }
    };

    /** The one place a graceful shutdown is allowed to interrupt: a step has
     *  just finished writing its state, so the manifest on disk resumes without
     *  paying for anything twice. */
    const stopAtBoundary = () => {
      if (!stopRequested || shutdownAborted || leaseLost) return;
      shutdownAborted = true;
      emit('stopping', { jobId, step: openStep, reason: 'signal' });
      controller.abort(new WorkerError(`shutting down during ${jobId}`, { code: 'SHUTDOWN', jobId }));
    };

    /**
     * Step events are diffed off the job the pipeline is mutating rather than
     * taken from `onProgress`, so the stream is correct whatever the pipeline
     * chooses to report. Called on every progress tick, on every heartbeat
     * tick, and once more after the pipeline returns -- so a step can be
     * reported late, but never not at all.
     */
    const syncSteps = (job) => {
      if (!Array.isArray(job?.steps)) return;
      let boundary = false;
      for (const step of job.steps) {
        const previous = seenStatus.get(step.name);
        if (previous === step.status) continue;
        seenStatus.set(step.name, step.status);
        if (previous === undefined && step.status === 'pending') continue;

        if (step.status === 'running') {
          openStep = step.name;
          openStepAt = msOf(step.startedAt) ?? now();
          emit('step-started', { jobId, step: step.name, attempt: step.attempts ?? 1 });
        } else if (STEP_ENDED.has(step.status)) {
          const startedAt = openStep === step.name ? openStepAt : msOf(step.startedAt);
          const endedAt = msOf(step.endedAt) ?? now();
          if (openStep === step.name) openStep = null;
          emit('step-finished', {
            jobId,
            step: step.name,
            status: step.status,
            ms: startedAt === null ? null : Math.max(0, endedAt - startedAt),
            cost: step.cost?.estimated ?? 0,
            error: step.error ? brief(step.error) : null,
          });
          boundary = true;
        }
      }
      if (boundary) { beat(true); stopAtBoundary(); }
    };

    let job = null;
    const onProgress = (event) => {
      syncSteps(job);
      if (event && (event.pct != null || event.message != null || event.phase != null)) {
        const step = STEP_NAMES.has(event.step) ? event.step : openStep;
        emit('progress', {
          jobId,
          step,
          phase: event.phase ?? null,
          pct: event.pct ?? null,
          message: event.message ?? null,
        });
      }
      // The lease keeper during a long step. Throttled, because a provider that
      // reports download percentage would otherwise rewrite the lock file a
      // hundred times a second.
      beat(false);
    };

    const completeOnQueue = (type, extra = {}) => {
      try {
        queue.complete(jobId, token);
        emit(type, { jobId, ms: now() - jobStartedAt, ...extra });
      } catch (err) {
        if (err?.code === 'LEASE_LOST') { loseLease(err); return; }
        throw err;
      }
    };

    /**
     * The customer's money, decided at the moment a job ends without a tape.
     *
     * The debit landed at enqueue, in the web process; the worker is where a
     * job can die AFTER that, so the worker is where the case for giving the
     * credits back gets raised. The seam reads the manifest's steps and
     * declines on its own when a paid step was ever attempted -- this side
     * only decides WHEN to ask: a terminal failure or a cancellation, never a
     * retry the queue still owes an attempt. A refund that cannot be recorded
     * is emitted rather than thrown, because the queue transition it rides on
     * has already happened and must stand -- but it is emitted LOUDLY, since
     * a missed refund is a person's money and somebody has to credit it by
     * hand.
     */
    const tryRefund = async (jobArg, reason) => {
      if (!refundImpl || !jobArg) return;
      try {
        const result = await refundImpl(jobArg, { reason });
        if (result?.refunded) {
          emit('refunded', {
            jobId, reason, credits: result.credits ?? null, accountId: result.accountId ?? null,
          });
        }
      } catch (err) {
        emit('refund-failed', { jobId, reason, error: brief(err) });
      }
    };

    const failOnQueue = async (err, retriable, step) => {
      try {
        const result = queue.fail(jobId, token, { error: err, retriable });
        emit('failed', {
          jobId,
          step,
          retriable,
          state: result?.state ?? null,
          attempts: result?.attempts ?? null,
          maxAttempts: queue.maxAttempts ?? null,
          ms: now() - jobStartedAt,
          error: brief(err),
        });
        // Only once the queue has said this was the LAST attempt. A refund
        // while a retry is still owed pays the customer back for a tape they
        // may yet receive.
        if (result?.state === 'failed') await tryRefund(job, 'refund:failed-before-provider');
      } catch (queueErr) {
        if (queueErr?.code === 'LEASE_LOST') { loseLease(queueErr); return; }
        throw queueErr;
      }
    };

    const releaseOnQueue = (reason) => {
      try {
        queue.release(jobId, token);
        emit('released', { jobId, reason, step: openStep, ms: now() - jobStartedAt });
      } catch (err) {
        if (err?.code === 'LEASE_LOST') { loseLease(err); return; }
        throw err;
      }
    };

    // The backstop under `onProgress`: a step that makes one long blocking call
    // and reports nothing still gets its lease extended. Unref'd so an idle
    // timer can never be the reason a process refuses to exit.
    const ticker = setIntervalImpl(() => {
      try { syncSteps(job); beat(false); } catch { /* a heartbeat is not worth an uncaught exception */ }
    }, beatEvery);
    ticker?.unref?.();

    try {
      try {
        job = loadJobImpl({ root, jobId, nowImpl, cfg });
      } catch (err) {
        // A queue pointer to a job with no readable manifest is the one state
        // this system cannot recover from -- there is nothing to resume and
        // retrying cannot make the file appear. Terminal, by name, in failed/.
        await failOnQueue(err, false, null);
        return;
      }

      for (const step of job.steps ?? []) {
        seenStatus.set(step.name, step.status);
        // A step left `running` by a killed process is the crash re-entry: the
        // pipeline will begin it again without changing its status, so there is
        // no transition to diff. Adopt it as the open step and time it from
        // here, rather than from a `startedAt` that belongs to a previous run.
        if (step.status === 'running') { openStep = step.name; openStepAt = jobStartedAt; }
      }

      if (job.status === 'cancelled') {
        // A cancellation is not a failure. It must not burn a retry and it must
        // not land in failed/, or every cancelled job looks like a bug.
        completeOnQueue('cancelled', { reason: job.error?.message ?? null });
        if (!leaseLost) await tryRefund(job, 'refund:cancelled-before-provider');
        return;
      }
      if (job.status === 'done') {
        completeOnQueue('completed', { alreadyDone: true, cost: job.cost ?? null });
        return;
      }
      if (job.status === 'failed') {
        const revived = [];
        for (const step of job.steps) {
          if (step.status !== 'failed') continue;
          retryStep(job, step.name);
          seenStatus.set(step.name, step.status);
          revived.push(step.name);
        }
        if (job.status === 'failed') setJobStatus(job, 'queued');
        saveJobImpl(job);
        emit('revived', { jobId, steps: revived });
      }

      let finished;
      try {
        finished = await runPipelineImpl(job, {
          provider,
          root,
          cfg,
          signal: controller.signal,
          onProgress,
          stopAfter,
          providerCtx,
        });
      } catch (err) {
        syncSteps(job);
        if (leaseLost) return;
        if (shutdownAborted || isAbortError(err)) { releaseOnQueue('shutdown'); return; }
        if (err?.code === 'NO_PIPELINE') {
          // Not this job's fault and not something a retry can fix. Hand it
          // back untouched and let the process die loudly, rather than feeding
          // the whole queue into failed/ one job at a time because a module is
          // missing.
          releaseOnQueue('no-pipeline');
          throw err;
        }
        await failOnQueue(err, isRetriable(err), job.error?.step ?? openStep);
        return;
      }

      const final = finished ?? job;
      syncSteps(final);
      if (leaseLost) return;

      switch (final.status) {
        case 'done':
          completeOnQueue('completed', { cost: final.cost ?? null, result: final.result ?? null });
          return;
        case 'cancelled':
          completeOnQueue('cancelled', { reason: final.error?.message ?? null });
          if (!leaseLost) await tryRefund(final, 'refund:cancelled-before-provider');
          return;
        case 'awaiting-selection':
          // Parked in front of a human, and deliberately taken off the queue:
          // a job waiting for a click is not in-flight work, and leaving it
          // claimable would spin the loop re-running a pipeline that has
          // nothing left to do. `POST /api/jobs/:id/select` re-enqueues it.
          completeOnQueue('awaiting-selection', { stillCount: final.input?.stillCount ?? null });
          return;
        case 'failed':
          await failOnQueue(final.error ?? new Error('pipeline reported a failed job'),
            final.error?.retriable === true, final.error?.step ?? null);
          return;
        default:
          if (shutdownAborted) { releaseOnQueue('shutdown'); return; }
          if (stopAfter) { completeOnQueue('parked', { stopAfter, status: final.status }); return; }
          // Neither terminal nor stopped: the pipeline returned a job it has
          // not finished and nobody asked it to stop. Releasing would put it
          // straight back on the board and spin; failing retriably makes the
          // bug visible in `queue-cli peek --state=failed` after maxAttempts
          // instead of burning a CPU all night.
          await failOnQueue(
            new WorkerError(
              `pipeline returned ${jobId} as ${final.status} with no stopAfter and no shutdown`,
              { code: 'PIPELINE_INCOMPLETE', jobId, detail: { status: final.status } },
            ),
            true,
            openStep,
          );
          return;
      }
    } finally {
      clearIntervalImpl(ticker);
    }
  }

  const worker = {
    workerId,
    pollMs,
    heartbeatMs: beatEvery,
    get running() { return running; },

    /**
     * Dead leases back to pending. Called before the first claim, because that
     * is what recovers jobs stranded by a previous crash -- and its absence
     * looks exactly like "the queue is stuck".
     */
    reap() {
      hasReaped = true;
      const jobIds = queue.reapExpired();
      emit('reaped', { jobIds, count: jobIds.length });
      return jobIds;
    },

    /**
     * The retention promise, kept.
     *
     * WHY THE WORKER AND NOT A CRON. `docs/security-review-2026-08-21.md` F1 is
     * that the consent text promises a deletion nothing performs. A promise
     * whose enforcement lives in a crontab somebody has to remember to install
     * is the same finding one deployment later, so it runs here -- beside
     * `reap()`, on the process that is already long-lived and already sweeping
     * the queue on exactly this argument.
     *
     * `dryRun: false` is spelled out because `executePurge` defaults the other
     * way, and this is one of the two places in the repo entitled to say it.
     *
     * Never throws. A sweep that cannot delete something must not take the
     * worker down with it -- the renders are what the customer is waiting for --
     * so the failure is emitted and the loop carries on. The `errors` array
     * reaching an operator is the point; silence is what this whole finding was.
     */
    sweepRetention() {
      if (!windows) return null;

      // AGE SAYS DELETE; A LIVE LEASE SAYS NOT YET, AND THE LEASE WINS.
      // The nasty case is a job enqueued long ago and claimed for the FIRST time
      // today: `createdAt` is past every window, so an unguarded sweep removes
      // the directory out from under the worker rendering it and the customer
      // loses a tape they paid for. It comes back on the next sweep, once
      // whoever holds it has let go. `peek` covers the other workers, not just
      // this one -- and if the queue cannot answer, the safe reading of
      // "unknown" is "somebody might", so nothing is swept THIS pass.
      //
      // THE CLOCK IS THE WORKER'S, NOT THE WALL'S. `nowImpl` is injected exactly
      // so that time is a parameter here.
      let leased;
      try {
        leased = new Set(
          (typeof queue.peek === 'function' ? queue.peek({ state: 'claimed' }) : [])
            .filter((row) => !row.expired)
            .map((row) => row.jobId),
        );
      } catch (err) {
        // SAID OUT LOUD, NOT RETURNED SILENTLY. A queue that cannot answer stops
        // retention running, and a retention sweep that stops running without
        // saying so is the finding this whole module exists to close, wearing a
        // different hat.
        const { code, message } = brief(err);
        emit('purged', {
          jobsDeleted: 0, photosDeleted: 0, skipped: 0, retention: windows,
          errors: [{ code, message: `queue.peek failed, nothing swept this pass: ${message}` }],
        });
        return null;
      }
      if (inFlight?.jobId) leased.add(inFlight.jobId);

      try {
        const summary = runRetentionSweep({
          root, retention: windows, nowImpl: () => new Date(now()),
          dryRun: false, skip: leased,
        });
        // Only when something happened. An hourly "deleted nothing" line would
        // bury the one that matters.
        if (summary.jobsDeleted || summary.photosDeleted || summary.errors.length) {
          emit('purged', summary);
        }
        return summary;
      } catch (err) {
        emit('purged', {
          jobsDeleted: 0, photosDeleted: 0, skipped: 0, retention: windows,
          errors: [brief(err)],
        });
        return null;
      }
    },

    /**
     * Claim at most one job and run it.
     * @returns {Promise<boolean>} whether there was any work to do
     */
    async once() {
      if (stopping) return false;
      const claim = queue.claim({ workerId });
      if (!claim) {
        emit('idle', {});
        return false;
      }
      emit('claimed', {
        jobId: claim.jobId,
        attempts: claim.attempts ?? 0,
        maxAttempts: queue.maxAttempts ?? null,
        priority: claim.priority ?? 0,
        deadline: claim.deadline ?? null,
      });
      inFlight = claim;
      try {
        await runOne(claim);
      } finally {
        inFlight = null;
      }
      return true;
    },

    /** `once()` in a loop. Resolves when the loop has stopped. */
    async start() {
      if (running) {
        throw new WorkerError('this worker is already started', { code: 'ALREADY_STARTED' });
      }
      running = true;
      stopping = false;
      stopRequested = false;
      stopSignal = new AbortController();
      stopped = deferred();

      if (!hasReaped) this.reap();
      this.sweepRetention();
      // Unref'd where the runtime supports it: a retention timer must never be
      // the reason a worker asked to stop is still alive.
      const sweeper = windows
        ? setIntervalImpl(() => { try { this.sweepRetention(); } catch { /* never fatal */ } }, retentionSweepMs)
        : null;
      if (typeof sweeper?.unref === 'function') sweeper.unref();
      if (signals) installSignalHandlers();

      try {
        while (!stopping) {
          const worked = await this.once();
          if (stopping) break;
          if (!worked) await sleepImpl(pollMs, stopSignal.signal);
        }
      } finally {
        running = false;
        if (sweeper) clearIntervalImpl(sweeper);
        if (removeSignalHandlers) { removeSignalHandlers(); removeSignalHandlers = null; }
        emit('stopped', { jobId: inFlight?.jobId ?? null });
        stopped.resolve();
        stopped = null;
      }
    },

    /**
     * Graceful stop. An in-flight job finishes its current step, is released
     * without burning an attempt, and is immediately claimable again.
     */
    async stop({ reason = 'stop' } = {}) {
      if (!stopping) {
        stopping = true;
        stopRequested = true;
        emit('signal', { reason, jobId: inFlight?.jobId ?? null });
        stopSignal.abort();
      }
      return stopped ? stopped.promise : Promise.resolve();
    },
  };

  /**
   * Signal handling lives behind an option and an injected `process` because a
   * library that installs global handlers on import cannot be tested and cannot
   * be embedded. `worker-cli.mjs` opts in; a test passes an emitter and proves
   * the behaviour without touching the real process.
   */
  function installSignalHandlers() {
    const handler = (signalName) => {
      if (forced) return;
      if (stopping) {
        forced = true;
        emit('forced', { signal: signalName, jobId: inFlight?.jobId ?? null });
        // Someone pressed Ctrl-C twice, which means they meant it. The lease is
        // left held on purpose: `reapExpired()` on the next startup returns the
        // job to pending, which is exactly what a lease is for. 130 is the
        // conventional 128+SIGINT, and it is not a clean shutdown.
        processImpl.exit(130);
        return;
      }
      void worker.stop({ reason: signalName });
    };
    const handlers = [['SIGINT', () => handler('SIGINT')], ['SIGTERM', () => handler('SIGTERM')]];
    for (const [name, fn] of handlers) processImpl.on(name, fn);
    removeSignalHandlers = () => {
      for (const [name, fn] of handlers) processImpl.off?.(name, fn);
    };
  }

  return worker;
}
