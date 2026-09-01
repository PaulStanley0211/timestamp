/**
 * `imageModerateImpl` backed by Amazon Rekognition DetectModerationLabels.
 *
 * This fills the seam `scripts/safety/moderate.mjs` has carried open since it
 * was written: the one part of a job nobody looks at. Intake already refuses
 * anything that is not a decodable JPEG/PNG/WebP inside the size limits, and
 * re-encodes what it keeps to JPEG, so by the time a path reaches here it is
 * always a JPEG under 2048px on the long edge -- which is exactly what this
 * endpoint accepts, and why no format conversion happens in this file.
 *
 * WHAT THIS CANNOT DO, AND IT IS THE THING PEOPLE ASSUME IT DOES.
 * It does not detect CSAM. That is not an opinion, it is AWS's own
 * documentation: "the image and video moderation APIs don't detect whether an
 * image includes illegal content, such as CSAM." Known-CSAM detection is hash
 * matching against a vetted database -- PhotoDNA, Project Arachnid's Shield,
 * Google CSAI Match -- which is a programme you apply to, not an API you buy.
 * Wiring this file and believing that box is ticked is the failure mode.
 *
 * It also cannot tell whether the person in the photograph agreed to be in it.
 * A model has no way to know whose face it is looking at. Someone uploading an
 * ex-partner's photograph passes this cleanly, and the consent checkbox
 * remains the only control on that -- before this file existed and after.
 *
 * IT IS A PAID NETWORK CALL AND IS HELD TO THE SAME RULES AS `fal.mjs`.
 * `fetchImpl` has NO DEFAULT, so a test that forgets to inject one gets a
 * TypeError rather than a bill; the credential goes to exactly one host and
 * the host is derived from the region rather than accepted from a caller.
 * At $0.001 an image the bill is small, but the discipline is not about the
 * size of the bill -- it is about a test being unable to reach the network.
 */

import fs from 'node:fs';

import { requireFetchImpl } from '../providers/contract.mjs';
import { signRequest } from './aws-sigv4.mjs';

export const AWS_MODERATION_SERVICE = 'rekognition';
export const AWS_MODERATION_TARGET = 'RekognitionService.DetectModerationLabels';

/** Inline `Image.Bytes` is capped at 5 MB by the endpoint. Checked before the
 *  request rather than after, so an oversized file is a local refusal instead
 *  of a billed 400. Measured: a real intake photo is ~341 KB at 944x2048. */
export const MAX_INLINE_BYTES = 5_000_000;

/**
 * THE POLICY, AND EVERY LINE OF IT IS A PRODUCT DECISION RATHER THAN A DEFAULT.
 *
 * Rekognition returns a three-level taxonomy. These are the Level 1 names, and
 * the split below is specific to THIS product -- a 2003 camcorder tape of a
 * person in a place. Copying a generic "block everything unsafe" list here
 * would reject the customers this thing exists for.
 *
 * REFUSED. Uncontroversial for a service that renders a real person's face
 * into a video and keeps it for thirty days.
 */
export const REFUSE_CATEGORIES = Object.freeze([
  'Explicit',
  'Non-Explicit Nudity of Intimate parts and Kissing',
  'Violence',
  'Visually Disturbing',
  'Hate Symbols',
]);

/**
 * ALLOWED, ON PURPOSE, WITH THE REASON EACH ONE SURVIVES.
 *
 *   Swimwear or Underwear -- `ostsee-strand` is a shipped preset called "The
 *     beach, out of season". A holiday photograph in swimwear is the customer,
 *     not the abuse case. Refusing this category would break a preset that has
 *     been on the page since launch.
 *   Alcohol -- `wohnzimmer-abend` is a 2003 living room with the television on
 *     and `kuechentisch-fruehstueck` is a kitchen table. A bottle on the table
 *     is period furniture.
 *   Drugs & Tobacco -- this is a NOSTALGIA product set between 1999 and 2005,
 *     and in 2003 people smoked indoors. Refusing a cigarette would reject the
 *     most era-authentic photographs anyone sends us, which is precisely
 *     backwards.
 *   Rude Gestures -- a middle finger in a snapshot is rude, not harmful, and
 *     it is exactly the kind of thing a camcorder caught.
 *   Gambling -- harmless.
 *
 * This list is not consulted by the code; it exists so that the NEXT person to
 * read `REFUSE_CATEGORIES` can tell a deliberate omission from an oversight,
 * and there is a test that fails if a category appears in neither list --
 * which is what makes a new Rekognition taxonomy version visible instead of
 * silently unhandled.
 */
export const ALLOW_CATEGORIES = Object.freeze([
  'Swimwear or Underwear',
  'Alcohol',
  'Drugs & Tobacco',
  'Rude Gestures',
  'Gambling',
]);

/** Confidence at or above which a refusing category actually refuses.
 *
 *  AWS's own guidance is that below 50 gives false positives and above 50 gives
 *  fewer. A false positive here refuses a paying customer's own photograph with
 *  an accusation attached, which is far more expensive than a false negative on
 *  a service where a human sees every tape anyway, so this sits well above the
 *  default. */
export const DEFAULT_MIN_CONFIDENCE = 80;

/** The one host this credential may ever reach, derived from the region and
 *  never accepted from a caller. Same rule as `fal.mjs`'s allow-list, and it
 *  exists for the same reason: a url out of a config file is still data. */
export function rekognitionEndpoint(region) {
  if (!/^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(String(region ?? ''))) {
    throw new TypeError(`aws-moderate: ${JSON.stringify(region)} is not an AWS region id`);
  }
  return `https://${AWS_MODERATION_SERVICE}.${region}.amazonaws.com/`;
}

/** The three variables that turn this on, named the way the vendor names them
 *  -- the same convention `FAL_KEY` and `STRIPE_SECRET_KEY` already follow. */
export const AWS_ENV_KEYS = Object.freeze(['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']);

/**
 * Build a moderator from the environment, or `null` when it is not configured.
 *
 * `null` is the designed off state: `moderate.mjs` then records the
 * `image-unclassified` warning it has always recorded, and nothing about the
 * pipeline changes. That is the `stripePriceId: null` shape -- unconfigured is
 * a state the product is honest about rather than a broken one.
 *
 * A HALF-CONFIGURED ENVIRONMENT THROWS RATHER THAN FALLING BACK TO OFF, and
 * that is the important line in this function. An operator who sets two of the
 * three variables and gets silence has a service they believe is checking
 * photographs and which is not, and the manifest warning that says otherwise is
 * one line in a file nobody reads until something has already gone wrong.
 * Refusing to start is the only version of this that cannot be missed.
 */
export function awsImageModeratorFromEnv(env = {}, options = {}) {
  const present = AWS_ENV_KEYS.filter((k) => String(env[k] ?? '').trim() !== '');
  if (present.length === 0) return null;
  if (present.length !== AWS_ENV_KEYS.length) {
    const missing = AWS_ENV_KEYS.filter((k) => !present.includes(k));
    throw new TypeError(
      `aws-moderate: image moderation is half-configured -- ${present.join(', ')} set, ${missing.join(', ')} missing. ` +
      'Set all three or none. Two of three would silently leave photographs unchecked.',
    );
  }
  return createAwsImageModerator({
    ...options,
    region: env.AWS_REGION,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN ?? null,
  });
}

export class ImageModerationError extends Error {
  constructor(message, { code = 'image-moderation-failed', cause } = {}) {
    super(message);
    this.name = 'ImageModerationError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/**
 * Build an `imageModerateImpl`.
 *
 * @returns {(photoPath: string, ctx?: {field?: string}) =>
 *   Promise<{ok: boolean, code?: string, userMessage?: string, categories?: string[]}>}
 *
 * ON FAILURE THIS THROWS RATHER THAN PASSING, and that is the whole reason the
 * seam was left null instead of stubbed. `moderate.mjs` says it in its own
 * header: a silent pass reads, a year later, exactly like a clean result from a
 * classifier that was running. So a network error, a 500, a throttle or a
 * malformed body all raise -- the moderate step fails, the job fails loudly,
 * and the credits are refunded by the path that already handles a failed step.
 * An AWS outage therefore stops renders. That is the correct trade for a
 * service that puts a stranger's face in a video, and it is a decision rather
 * than an accident.
 */
export function createAwsImageModerator({
  fetchImpl,
  region,
  accessKeyId,
  secretAccessKey,
  sessionToken = null,
  minConfidence = DEFAULT_MIN_CONFIDENCE,
  refuseCategories = REFUSE_CATEGORIES,
  nowImpl = () => new Date(),
  fsImpl = fs,
} = {}) {
  // FIRST, before credentials are read and before anything else can throw and
  // hide it. Same ordering rule `contract.mjs` documents for paid providers.
  const doFetch = requireFetchImpl({ fetchImpl }, { provider: 'aws-rekognition' });

  if (!accessKeyId || !secretAccessKey) {
    throw new TypeError('aws-moderate: accessKeyId and secretAccessKey are required');
  }
  const endpoint = rekognitionEndpoint(region);
  const refusing = new Set(refuseCategories);

  return async function moderateImage(photoPath, { field = 'photo' } = {}) {
    const bytes = fsImpl.readFileSync(photoPath);
    if (bytes.length > MAX_INLINE_BYTES) {
      throw new ImageModerationError(
        `aws-moderate: ${field} is ${bytes.length} bytes, over the ${MAX_INLINE_BYTES} inline limit`,
        { code: 'image-too-large-to-check' },
      );
    }

    const body = JSON.stringify({
      Image: { Bytes: bytes.toString('base64') },
      MinConfidence: minConfidence,
    });

    const signed = signRequest({
      method: 'POST',
      url: endpoint,
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': AWS_MODERATION_TARGET,
      },
      body,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      region,
      service: AWS_MODERATION_SERVICE,
      when: nowImpl(),
    });

    let res;
    try {
      res = await doFetch(endpoint, { method: 'POST', headers: signed.headers, body });
    } catch (err) {
      throw new ImageModerationError(
        `aws-moderate: ${field} could not be checked -- ${err?.message ?? err}`,
        { code: 'image-moderation-unreachable', cause: err },
      );
    }

    const text = await res.text();
    if (!res.ok) {
      // The body carries `__type` and a message. Neither is echoed to the
      // customer; it goes to the operator's log through the thrown error.
      throw new ImageModerationError(
        `aws-moderate: ${field} check failed with HTTP ${res.status}: ${text.slice(0, 300)}`,
        { code: 'image-moderation-refused-service' },
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new ImageModerationError('aws-moderate: response was not JSON', {
        code: 'image-moderation-bad-response', cause: err,
      });
    }

    const labels = Array.isArray(parsed?.ModerationLabels) ? parsed.ModerationLabels : null;
    if (!labels) {
      // An empty array means "looked, found nothing" and is a pass. A MISSING
      // array means the shape changed, which must never read as a pass.
      throw new ImageModerationError('aws-moderate: response carried no ModerationLabels array', {
        code: 'image-moderation-bad-response',
      });
    }

    // A label refuses on its TOP-LEVEL name, which for an L1 row is `Name` and
    // for an L2/L3 row is `ParentName`. Checking both is what makes the policy
    // a statement about categories rather than about taxonomy depth.
    const hits = labels.filter((l) => {
      if (Number(l?.Confidence ?? 0) < minConfidence) return false;
      return refusing.has(l?.Name) || refusing.has(l?.ParentName);
    });

    if (hits.length === 0) return { ok: true, categories: [] };

    return {
      ok: false,
      code: 'image-content-refused',
      userMessage: 'We cannot use that photo. Please choose a different one.',
      categories: [...new Set(hits.map((l) => l.ParentName || l.Name))].sort(),
    };
  };
}
