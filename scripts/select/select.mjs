/**
 * Choosing which still becomes the video.
 *
 * THIS IS THE REJECTION GATE, and it is the last free moment in the pipeline.
 * Everything before it costs the price of a few images; everything after it
 * costs per second of generated video. `--stop-after=select` exists so that a
 * person sees `review/stills.html` before that line is crossed, and CLAUDE.md
 * states the rule flatly: never spend on a still nobody looked at.
 *
 * WHY THERE IS EXACTLY ONE SCORER AND WHY IT DOES NOT SCORE. Ranking these
 * frames needs a face-similarity metric and there is no embedding model in this
 * repository. Every heuristic that IS computable locally -- sharpness, exposure,
 * contrast, face-box size -- measures photographic quality, and photographic
 * quality is not the question. A crisp, well-lit stranger beats a soft likeness
 * on all of them, so a scorer built from them does not merely fail to help, it
 * actively recommends the wrong frame and does it with the authority of a
 * number. `firstScorer` returns the first still and says nothing else, the
 * `scorer` seam stays open for the day there is a real embedding behind it, and
 * the contact sheet asks a human. See CLAUDE.md, "Common mistakes".
 *
 * INDICES ARE 1-BASED, EVERYWHERE. `stills[].index` starts at 1 and agrees with
 * `still-01.png`; so do `--still=N`, `selection.stillIndex`, the contact sheet
 * and the `/api/jobs/:id/select` body. Array positions are a local detail
 * inside a function body and never leave one. Two numberings meeting here is
 * the worst bug this module could have: the wrong face gets animated at video
 * prices, the manifest agrees with itself, and nothing anywhere reports a
 * fault. There is no assertion that catches it afterwards, which is why it is
 * prevented by convention and pinned by a test.
 */

import { FIRST_INDEX } from '../providers/contract.mjs';

export { contactSheetHtml, writeContactSheet, escapeHtml } from './contact-sheet.mjs';

export class SelectionError extends Error {
  constructor(message, { code = 'SELECTION_ERROR', userMessage = null, detail = null } = {}) {
    super(message);
    this.name = 'SelectionError';
    this.code = code;
    this.userMessage = userMessage ?? message;
    this.detail = detail;
  }
}

/**
 * The only shipped scorer. Returns the 1-based index of the first still.
 *
 * Not `stills[0].index` by accident -- it reads the index the provider assigned
 * rather than assuming it is 1, so a provider that ever numbers differently
 * produces a wrong-but-consistent answer instead of a silently wrong file.
 *
 * @param {Array<{index:number}>} stills
 * @returns {number} a 1-based still index
 */
export function firstScorer(stills) {
  const list = Array.isArray(stills) ? stills : [];
  if (list.length === 0) {
    throw new SelectionError('no stills to choose from', { code: 'NO_STILLS' });
  }
  return list[0].index ?? FIRST_INDEX;
}

/**
 * Resolve a 1-based still index to the entry the provider returned.
 *
 * The lookup is by `index`, never by array position, and a miss is loud. A
 * silent `undefined` here becomes `imagePath: undefined` at the video request,
 * which the provider contract rejects -- but only after the pipeline has
 * already told the manifest which still it chose.
 *
 * @param {Array<{index:number, path:string}>} stills
 * @param {number} stillIndex   1-based
 */
export function stillAt(stills, stillIndex) {
  const list = Array.isArray(stills) ? stills : [];
  if (!Number.isInteger(stillIndex)) {
    throw new SelectionError(
      `stillIndex must be an integer, got ${JSON.stringify(stillIndex)}`,
      { code: 'BAD_SELECTION' },
    );
  }
  const found = list.find((s) => s.index === stillIndex);
  if (!found) {
    const available = list.map((s) => s.index).join(', ') || '(none)';
    throw new SelectionError(
      `no still numbered ${stillIndex} in this job. Available: ${available}. ` +
      'Still numbers are 1-based and match the filenames -- still-01.png is 1.',
      {
        code: 'NO_SUCH_STILL',
        userMessage: `Please choose one of the stills that exists: ${available}.`,
        detail: { stillIndex, available: list.map((s) => s.index) },
      },
    );
  }
  return found;
}

/**
 * Which still a job should animate, and who decided.
 *
 * `chosenBy` is not decoration: it is the only way to tell, six months later,
 * whether a human actually looked at the contact sheet or whether the pipeline
 * ran past it on the default. Phase 0 asks exactly that question about the
 * stills that got animated.
 *
 * @param {object} args
 * @param {Array}  args.stills
 * @param {number|null} [args.requested]  a 1-based index from `--still=` or the web form
 * @param {function} [args.scorer]        the seam; `firstScorer` is the only implementation
 * @returns {{stillIndex:number, chosenBy:'human'|'auto', still:object}}
 */
export function chooseStill({ stills, requested = null, scorer = firstScorer }) {
  const human = requested !== null && requested !== undefined;
  const stillIndex = human ? requested : scorer(stills);
  return { stillIndex, chosenBy: human ? 'human' : 'auto', still: stillAt(stills, stillIndex) };
}
