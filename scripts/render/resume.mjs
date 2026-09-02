/**
 * What a resumed job runs against, and why the command line does not get to
 * decide it.
 *
 * THE MANIFEST IS THE TRUTH AND THE FLAGS ARE A HINT. A job's `resolved` block
 * is frozen at compose and everything after it reads from there -- that is what
 * makes "reproducible" a property of this repo rather than a word. The provider
 * and the models are part of that: a render resumed against a different model
 * is not the same render, and a manifest that names a model which was never
 * called is a manifest nobody can trust.
 *
 * THREE FAILURES ON 2026-08-25 SAY WHY THIS FILE EXISTS, and all three are the
 * same shape -- a value that exists, is correct, and is simply not handed on.
 *
 *   1. `--resume` rebuilt the provider from the CLI default, so a job whose
 *      manifest said `fal` was resumed against `fixture`. It died on a
 *      capability check, and the pipeline recorded that as a real step failure
 *      -- so a job parked for a metered run was marked `failed` by a command
 *      that was meant to cost nothing.
 *   2. The same for the video model, and this one reached the network. The
 *      manifest froze `reference-to-video`; the CLI default is
 *      `image-to-video`. The pipeline built a reference-to-video BODY from the
 *      frozen references (`image_urls`, plural) and posted it to the
 *      image-to-video ENDPOINT, which requires `image_url`, singular. fal
 *      answered 422 and nothing was charged -- BY LUCK. The two shapes happened
 *      to be incompatible. Had they agreed, the resume would have rendered with
 *      a model the manifest does not name, billed for it, and left the frozen
 *      block lying.
 *   3. `--dry-run` was ignored on a resume entirely, because the resume branch
 *      returns before the dry-run branch is reached. The flag whose whole
 *      promise is "charges nothing" ran the job for real.
 *
 * WHY A CONTRADICTION IS A REFUSAL AND NOT A PRECEDENCE RULE. Either answer --
 * flag wins, or manifest wins -- is silently wrong half the time, and the
 * half where the flag wins is the half that spends money on the wrong thing.
 * An operator who names a model that disagrees with the job has either made a
 * typo or wants a different render, and both of those are worth two seconds of
 * their attention. Naming a model the job ALREADY froze stays legal: that is
 * how the successful metered run on 2026-08-25 was finally made, once the
 * defect was understood.
 */

/** A command line that disagrees with the job it is resuming. */
export class ResumeConflictError extends Error {
  constructor(message, { field = null, frozen = null, asked = null } = {}) {
    super(message);
    this.name = 'ResumeConflictError';
    this.code = 'RESUME_CONFLICT';
    this.field = field;
    this.frozen = frozen;
    this.asked = asked;
  }
}

/**
 * The free provider. A job with nothing frozen and nothing asked for must not
 * quietly become a paid render -- the direction a mistake here has to fail in.
 */
export const DEFAULT_PROVIDER = 'fixture';

function reconcile({ field, frozen, asked, jobId }) {
  if (frozen === null || frozen === undefined) {
    // A job from before this was frozen. The command line is the only source of
    // truth for it, and refusing would make every old job unresumable.
    return { value: asked ?? null, restored: false };
  }
  if (asked === null || asked === undefined) return { value: frozen, restored: true };
  if (asked === frozen) return { value: frozen, restored: false };
  throw new ResumeConflictError(
    `${jobId ?? 'this job'} froze ${field} ${JSON.stringify(frozen)} and the command line asks for ${JSON.stringify(asked)}. `
    + `A resumed render must be the render the manifest describes, or the frozen block stops meaning anything. `
    + `Run it again without the flag to use what the job froze, or start a new job if you meant a different ${field}.`,
    { field, frozen, asked },
  );
}

/**
 * Reconcile a resumed job's frozen settings with the flags on the command line.
 *
 * @param {object} job              the loaded manifest
 * @param {object} [cli]
 * @param {string|null} [cli.provider]
 * @param {string|null} [cli.videoModel]
 * @param {string|null} [cli.stillModel]
 * @returns {{providerId: string, videoModel: string|null, stillModel: string|null, restored: string[]}}
 * @throws {ResumeConflictError}
 */
export function resumeSettings(job, cli = {}) {
  const jobId = job?.jobId ?? null;
  const models = job?.resolved?.models ?? {};

  const provider = reconcile({
    field: 'provider', frozen: job?.provider ?? null, asked: cli.provider ?? null, jobId,
  });
  const video = reconcile({
    field: 'video model', frozen: models.video ?? null, asked: cli.videoModel ?? null, jobId,
  });
  const still = reconcile({
    field: 'still model', frozen: models.still ?? null, asked: cli.stillModel ?? null, jobId,
  });

  return {
    providerId: provider.value ?? DEFAULT_PROVIDER,
    videoModel: video.value,
    stillModel: still.value,
    // What the operator got without asking for it. Printed rather than kept,
    // because "the provider it actually used" is the first thing anybody wants
    // to know when a resume behaves unexpectedly -- and inferring it from a 422
    // twenty seconds later is how this morning went.
    restored: [
      ...(provider.restored ? ['provider'] : []),
      ...(video.restored ? ['video model'] : []),
      ...(still.restored ? ['still model'] : []),
    ],
  };
}
