/**
 * The consent gate: the exact wording shown to a person, and the block the
 * manifest keeps to prove it was shown.
 *
 * WHY THE MANIFEST STORES THE TEXT AND NOT A VERSION NUMBER. Consent to wording
 * that has since been edited is not consent. A manifest saying
 * `consentVersion: 2` is only as good as somebody's ability, eighteen months
 * later during an argument, to reconstruct what version 2 said -- and the file
 * that would tell them is the one that got edited. Storing the rendered string
 * costs about three hundred bytes per job and turns "we believe they agreed to
 * something like this" into a quotation. `at` is a wall-clock timestamp, which
 * is allowed here because it is metadata and never reaches a filtergraph; see
 * the house rules in docs/interfaces.md.
 *
 * WHY THE RETENTION NUMBERS ARE ARGUMENTS. The text promises deletion after a
 * number of days, and scripts/render/purge.mjs is what actually deletes. If the
 * promise were a string literal here and the schedule a number there, the two
 * would drift, and the direction they would drift in is the one where we told
 * people seven days and kept the photographs for thirty.
 */

/** Defaults mirror `retention` in docs/interfaces.md section 10. */
export const RETENTION_DEFAULTS = Object.freeze({ photoDays: 7, jobDays: 30 });

export class ConsentError extends Error {
  constructor(message, { code, userMessage } = {}) {
    super(message);
    this.name = 'ConsentError';
    this.code = code;
    this.userMessage = userMessage ?? 'Please confirm the consent statement before continuing.';
  }
}

/**
 * The wording, rendered. One paragraph about who is in the photo and one about
 * what happens to it, because those are the two things a person is actually
 * agreeing to and a wall of clauses gets clicked through unread.
 *
 * Kept as a single normalised string -- no leading indentation, single spaces,
 * newline between paragraphs -- so that a stored consent block compares equal to
 * a freshly rendered one without anybody having to guess how the template was
 * indented on the day.
 */
export function consentText({
  photoDays = RETENTION_DEFAULTS.photoDays,
  jobDays = RETENTION_DEFAULTS.jobDays,
} = {}) {
  return [
    'I confirm that the person in this photo is me, or is an adult who has '
    + 'agreed to appear in a video made from it. I will not upload a photo of '
    + 'anyone who has not agreed, and I will not upload a photo of a child.',
    'I understand that this photo is sent to an AI service to generate the '
    + `video, that its location and camera information are removed first, that `
    + `the photo is deleted after ${photoDays} days and the finished video after `
    + `${jobDays} days, and that I can ask for either to be deleted sooner.`,
  ].join('\n');
}

/** The wording currently in force. Shown by the upload page, compared against by
 *  `consentIsCurrent`, and copied verbatim into every new manifest. */
export const CONSENT_TEXT = consentText();

/**
 * Build the `{granted, at, text}` block the manifest stores.
 *
 * `granted` is compared against `true` rather than tested for truthiness, and
 * that is the whole of the gate. An HTML checkbox posts the string `"on"`; a
 * JSON client that stringifies a boolean posts `"false"`. Both are truthy, and
 * a truthiness test would record consent for a person who ticked nothing and
 * consent for a person who explicitly declined. A consent gate that fails open
 * on the two most common wire encodings of "no" is not a gate.
 */
export function recordConsent({
  granted,
  text = CONSENT_TEXT,
  nowImpl = () => new Date(),
} = {}) {
  if (granted !== true) {
    throw new ConsentError(`consent not granted (received ${JSON.stringify(granted)})`, {
      code: 'not-granted',
      userMessage: 'Please tick the box to confirm you have permission to use this photo.',
    });
  }
  if (typeof text !== 'string' || !text.trim()) {
    throw new ConsentError('consent text is empty -- there is nothing to have agreed to', {
      code: 'no-text',
      userMessage: 'Something went wrong showing the consent statement. Please reload and try again.',
    });
  }
  return Object.freeze({ granted: true, at: nowImpl().toISOString(), text });
}

/** Shape check for a block read back off disk. Separate from `recordConsent`
 *  because a manifest written by an older build is a different failure from a
 *  form post with the box unticked, and they deserve different messages. */
export function assertConsent(block) {
  if (block === null || typeof block !== 'object') {
    throw new ConsentError('manifest has no consent block', {
      code: 'missing',
      userMessage: 'We could not confirm consent for this job, so it was not started.',
    });
  }
  if (block.granted !== true) {
    throw new ConsentError('manifest consent block is not granted', { code: 'not-granted' });
  }
  if (typeof block.text !== 'string' || !block.text.trim()) {
    throw new ConsentError('manifest consent block records no wording', {
      code: 'no-text',
      userMessage: 'We could not confirm consent for this job, so it was not started.',
    });
  }
  if (typeof block.at !== 'string' || Number.isNaN(Date.parse(block.at))) {
    throw new ConsentError('manifest consent block has no usable timestamp', { code: 'no-timestamp' });
  }
  return block;
}

/**
 * Whether a stored consent was given to the wording in force today.
 *
 * `false` is not an error and must not be treated as one -- a past job whose
 * consent predates a reworded statement is still validly consented, to the
 * wording it stored. This exists so that a re-run, a re-share, or anything that
 * would put the photo to a NEW use can tell the difference and ask again.
 */
export function consentIsCurrent(block, { text = CONSENT_TEXT } = {}) {
  return Boolean(block) && block.granted === true && block.text === text;
}
