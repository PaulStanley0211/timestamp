/**
 * The segment plan: how fifteen seconds are cut into calls a model will accept.
 *
 * WHY THE SUM IS AN ASSERTION AND NOT AN INTENTION. 25fps x 15s is exactly 375
 * frames -- config/render.json explains why PAL was chosen for precisely that
 * -- and `assertDeliveryContract` checks that number against the finished file.
 * A plan that sums to 16 seconds pays a real provider for a second that gets
 * trimmed away on every single render. A plan that sums to 14 is worse: the
 * tape stage runs with `-stream_loop -1`, so a short source is silently looped
 * and the video ships with a visible repeat and no error anywhere. Both
 * failures are invisible in the code and obvious on screen, so the sum is
 * checked here, in the one place that decides it.
 *
 * A 15-SECOND-CAPABLE PROVIDER TAKES THE SINGLE-CALL PATH, AND THAT IS THE
 * WHOLE POINT OF ASKING THE PROVIDER RATHER THAN HARDCODING A SPLIT. Seedance
 * 2.0 generates 4..15 seconds in ONE request, so `maxClipSeconds: 15` makes
 * `count` exactly 1: one 15-second segment, `startsFrom: 'still'`, no last
 * frame extracted, no chain, no seam -- and phase-0 criterion 5, "is the join
 * visible", simply is not asked. The multi-segment code below stays because it
 * is tested and because the next provider may cap at 8 again; it is not dead
 * code, it is the branch a different capability takes.
 *
 * WHY 8 + 7 AND NOT 8 + 8 TRIMMED. Filling every segment to the cap and cutting
 * the overflow is the obvious implementation and it buys nothing: the frames
 * past 375 are discarded, and on a per-second video price the discard is money.
 * Splitting evenly also keeps the two takes the same length, which matters for
 * the join -- a model given 8 seconds and a model given 7 drift by roughly the
 * same amount, and phase-0 criterion 5 is about whether that join is visible.
 *
 * WHY THE SPLIT IS IN WHOLE SECONDS. Providers bill and validate in seconds,
 * not frames, and `assertCapableVideo` compares `req.seconds` against
 * `maxClipSeconds`. Planning in frames and converting back would produce 7.52s
 * requests that are arithmetically perfect and read, on an invoice, as somebody
 * having made a mistake. Whole seconds x an integer fps is an integer frame
 * count, which is the property that actually has to hold.
 */

import { deriveSeed } from '../compose/seed.mjs';

export { lastFrameArgs, lastFrameName, extractLastFrame } from './lastframe.mjs';

/**
 * The resolutions a job may be ordered at, and the RASTER each label means.
 *
 * THE RULE, NOT A TABLE: the number in the label is the height, and this
 * product always requests 4:3, so the width is `height * 4 / 3`. 480p is
 * 640x480 and 720p is 960x720 -- NOT the 854x480 and 1280x720 the same labels
 * name in a 16:9 world. That is not a detail. The tape raster is 720x576 at
 * SAR 16/15, i.e. DAR 4:3, so a 16:9 frame is a third of a picture we paid for
 * being thrown away by whichever downstream filter happens to crop it, and the
 * crop is chosen by nobody. `providers/fal.mjs` derives the same two rasters
 * from the same rule for its own `resolution` enum, and there is a test that
 * the two agree.
 *
 * WHY THIS LIVES HERE. `plan.mjs` is the module that turns the delivery
 * contract into the requests a provider is actually sent -- how many calls,
 * how long each one is, and now at what size. Putting it in the provider would
 * make the pipeline import a vendor to find out what "720p" means; putting it
 * in the billing layer would make `render/job.mjs` import the thing it
 * deliberately does not (see its `resolution` field's comment).
 *
 * 1080p IS DEFERRED, not cancelled. `config/credits.json` records the
 * reasoning -- 2.25x the cost of 720p for pixels discarded before the grain
 * goes on, and it forces the expensive standard tier because fal's fast
 * Seedance tops out at 720p -- and `creditCost` throws rather than quietly
 * rendering something else. It is listed here with `available: false` so that
 * turning it on is one field rather than an archaeology exercise.
 */
export const RESOLUTIONS = Object.freeze({
  '480p': Object.freeze({ id: '480p', width: 640, height: 480, available: true }),
  '720p': Object.freeze({ id: '720p', width: 960, height: 720, available: true }),
  '1080p': Object.freeze({ id: '1080p', width: 1440, height: 1080, available: false }),
});

/** What may be ordered today, cheapest first. */
export const AVAILABLE_RESOLUTIONS = Object.freeze(
  Object.values(RESOLUTIONS).filter((r) => r.available).map((r) => r.id),
);

/** The default when a job names none, matching `config/credits.json` defaults:
 *  480p is the cheap tier and this product is credit-conscious. */
export const DEFAULT_RESOLUTION = '480p';

/**
 * The 4:3 raster for a resolution label.
 *
 * Throws rather than falling back, and the deferred row gets its own message:
 * a silent substitution would bill for one thing and render another, with the
 * button, the ledger and the manifest all agreeing on a number that is not
 * what arrived. That is the one failure the customer cannot see.
 *
 * @param {string} id
 * @returns {{id:string,width:number,height:number}}
 */
export function resolutionRaster(id) {
  const row = RESOLUTIONS[id];
  if (!row) {
    throw new PlanError(
      `unknown resolution ${JSON.stringify(id)} -- known: ${Object.keys(RESOLUTIONS).join(', ')}`,
      { code: 'UNKNOWN_RESOLUTION', detail: { id, known: Object.keys(RESOLUTIONS) } },
    );
  }
  if (!row.available) {
    throw new PlanError(
      `resolution ${id} is deferred and cannot be ordered -- see config/credits.json, which explains why, ` +
      'and scripts/auth/credits.mjs, which refuses to price it',
      { code: 'RESOLUTION_UNAVAILABLE', detail: { id, available: AVAILABLE_RESOLUTIONS } },
    );
  }
  return { id: row.id, width: row.width, height: row.height };
}

/**
 * `continuous` is the v1 intent and the only mode anything calls: one take,
 * each segment started from the previous segment's final frame. `cut` is one
 * field and one branch -- every segment starts from the approved still, which
 * reads as a montage rather than a take -- and it stays unused until somebody
 * decides a montage is a product. Keeping the branch costs three lines; adding
 * it later costs a redesign of how `animate` sources its start frames.
 */
export const MODES = Object.freeze(['continuous', 'cut']);

export class PlanError extends Error {
  constructor(message, { code = 'PLAN_ERROR', detail = null } = {}) {
    super(message);
    this.name = 'PlanError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * @param {object} args
 * @param {object} args.cfg            config/render.json (or `job.resolved.cfg`)
 * @param {object} args.capabilities   provider.capabilities
 * @param {string} [args.jobId]        omit for a preview; see the seed note below
 * @param {string} [args.mode]         'continuous' | 'cut'
 * @param {{width:number,height:number}} [args.size]   the ordered 4:3 raster
 * @returns {Array<{index:number, seconds:number, frames:number, seed:number|null,
 *                  startsFrom:string, size:{width:number,height:number}|null}>}
 *
 * `jobId` is optional and `seed` is null without it. That is not laziness: the
 * `--dry-run` path has to name every call and its price BEFORE a job exists,
 * and the alternative -- inventing a job id to throw away -- would put a seed
 * in a printed plan that no render will ever use. The pipeline passes a real id
 * at compose and refuses a segment whose seed is null before it spends.
 */
export function planSegments({ cfg, capabilities, jobId = null, mode = 'continuous', size = null } = {}) {
  if (!MODES.includes(mode)) {
    throw new PlanError(`mode must be one of ${MODES.join('|')}, got ${JSON.stringify(mode)}`, { code: 'BAD_MODE' });
  }

  const total = cfg?.durationSeconds;
  const fps = cfg?.fps;
  if (!Number.isInteger(total) || total < 1) {
    throw new PlanError(
      `cfg.durationSeconds must be a positive whole number of seconds, got ${JSON.stringify(total)} -- ` +
      'the plan splits in whole seconds because that is the unit providers bill and validate in',
      { code: 'BAD_DURATION' },
    );
  }
  if (!Number.isInteger(fps) || fps < 1) {
    throw new PlanError(`cfg.fps must be a positive integer, got ${JSON.stringify(fps)}`, { code: 'BAD_FPS' });
  }

  const declared = capabilities?.maxClipSeconds;
  if (!Number.isFinite(declared) || declared <= 0) {
    throw new PlanError(
      `provider.capabilities.maxClipSeconds must be a positive number, got ${JSON.stringify(declared)}`,
      { code: 'BAD_CAPABILITY' },
    );
  }
  // Floored, because a cap of 7.5 means seven whole seconds are safe and eight
  // are a CapabilityError raised remotely, after the request was accepted.
  const max = Math.floor(declared);
  if (max < 1) {
    throw new PlanError(
      `provider.capabilities.maxClipSeconds is ${declared}, which floors to ${max} whole seconds -- ` +
      'a provider that cannot produce one whole second cannot produce this video',
      { code: 'CLIP_TOO_SHORT', detail: { maxClipSeconds: declared } },
    );
  }

  const count = Math.ceil(total / max);
  const base = Math.floor(total / count);
  // The remainder is spread one second at a time over the leading segments, so
  // no two segments ever differ by more than a second. 15 over 4 is 4+4+4+3,
  // never 4+4+4+2+1.
  const remainder = total - base * count;

  const segments = [];
  for (let i = 0; i < count; i += 1) {
    const seconds = base + (i < remainder ? 1 : 0);
    segments.push({
      index: i + 1,
      seconds,
      // Carried because the provider and the assembler both think in frames and
      // recomputing `seconds * fps` at each of them is two chances to disagree.
      frames: seconds * fps,
      seed: jobId === null ? null : deriveSeed(jobId, 'motion', i),
      // The one branch `mode` buys.
      startsFrom: mode === 'cut' || i === 0 ? 'still' : 'lastFrame',
      // The raster this segment is BOUGHT at, carried on the segment rather
      // than re-derived at `animate`. It is frozen into the manifest with
      // everything else `compose` resolves, so a resumed job asks for the size
      // the customer paid for even if the config, the default or the provider
      // changed underneath it. Null for a plan built without one -- `--dry-run`
      // has no job and therefore no order behind it.
      size: size ? { width: size.width, height: size.height } : null,
    });
  }

  const sum = segments.reduce((n, s) => n + s.seconds, 0);
  if (sum !== total) {
    /* c8 ignore next 4 -- unreachable with the guards above, and that is the point */
    throw new PlanError(
      `segment plan sums to ${sum}s but the contract is ${total}s exactly`,
      { code: 'PLAN_SUM', detail: { segments, total } },
    );
  }
  return segments;
}

/** The plan as one line, for a log or a dry run. */
export function describePlan(segments) {
  return `${segments.length} segment(s): ${segments.map((s) => `${s.seconds}s`).join(' + ')} = ` +
    `${segments.reduce((n, s) => n + s.seconds, 0)}s`;
}
