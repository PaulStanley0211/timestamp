/**
 * The contact sheet: the page a human looks at before video prices apply.
 *
 * WHY IT IS ONE SELF-CONTAINED FILE. This page is opened by double-clicking it
 * out of a job directory, on a machine that may have no server running and no
 * network at all -- and, later, copied to somebody else to look at. A stylesheet
 * link, a CDN font or an absolute image path each turn that into a blank page
 * with no error, which for a review gate means "approve, I suppose". So the CSS
 * is inline, the images are referenced relative to this file, and the whole
 * thing is one `fs.writeFileSync`.
 *
 * WHY EVERY INTERPOLATION IS ESCAPED. A place is free text typed by a stranger
 * (CLAUDE.md, "the menu is no longer a gate"). `scripts/safety/moderate.mjs`
 * already refuses markup, but a review page that renders unescaped user text is
 * exactly the kind of second line of defence that costs four lines and is worth
 * having anyway -- especially since this same HTML is what the web app serves
 * at `/j/:id/select`.
 *
 * WHY THERE IS NO SCORE COLUMN. See `firstScorer` in select.mjs, and CLAUDE.md
 * under "Common mistakes". Ordering the stills by any locally computable
 * heuristic would put a sharp, well-lit stranger above a soft likeness, and a
 * page that ranks them is a page people trust instead of looking.
 */

import fs from 'node:fs';
import path from 'node:path';
import { FIRST_INDEX } from '../providers/contract.mjs';

const ESCAPES = Object.freeze({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
});

/** Escapes for both text and quoted attribute values, so there is one function
 *  and no chance of picking the wrong one at a call site. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** `stills/still-01.png` (relative to the job directory) as seen from
 *  `review/stills.html`. Forward slashes, because this is a URL and not a path,
 *  even when it is being read off an NTFS disk. */
function srcFromReview(jobRelativePath) {
  return path.posix.relative('review', String(jobRelativePath).replace(/\\/g, '/'));
}

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2rem 1.5rem 4rem;
  background: #0B0A09; color: #E8E2D6;
  font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
header { max-width: 78rem; margin: 0 auto 2rem; }
h1 { font-size: 1.35rem; font-weight: 600; margin: 0 0 .35rem; letter-spacing: .01em; }
.sub { color: #9A9184; font-size: .85rem; margin: 0 0 .2rem; }
.sub b { color: #E8E2D6; font-weight: 600; }
.note {
  max-width: 78rem; margin: 0 auto 2rem; padding: .9rem 1rem;
  border: 1px solid #33302B; border-radius: 6px; background: #14120F; color: #C9C1B4; font-size: .88rem;
}
.grid {
  max-width: 78rem; margin: 0 auto;
  display: grid; gap: 1.25rem;
  grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
}
figure { margin: 0; background: #14120F; border: 1px solid #33302B; border-radius: 6px; overflow: hidden; }
figure.auto { border-color: #6E6350; }
img { display: block; width: 100%; height: auto; background: #000; }
figcaption { padding: .7rem .85rem .85rem; font-size: .82rem; color: #9A9184; }
figcaption .n { color: #E8E2D6; font-weight: 600; font-size: .95rem; }
figcaption .tag {
  display: inline-block; margin-left: .5rem; padding: .05rem .4rem;
  border: 1px solid #6E6350; border-radius: 3px; color: #C9B98F; font-size: .7rem; letter-spacing: .04em;
}
code {
  display: block; margin-top: .45rem; padding: .45rem .55rem;
  background: #0B0A09; border: 1px solid #33302B; border-radius: 4px;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
  color: #C9C1B4; overflow-x: auto; white-space: pre;
}
footer { max-width: 78rem; margin: 2.5rem auto 0; color: #6E6350; font-size: .78rem; }
`.trim();

/**
 * @param {object} job     the manifest
 * @param {Array<{index:number, path:string, seed:number}>} stills  job-relative paths
 * @param {object} [opts]
 * @param {number} [opts.autoStill]  the 1-based still index `firstScorer` would pick
 * @returns {string} a complete HTML document
 */
export function contactSheetHtml(job, stills, { autoStill = FIRST_INDEX } = {}) {
  const list = Array.isArray(stills) ? stills : [];
  const place = job?.resolved?.place?.label ?? job?.input?.place?.value ?? '(unknown place)';
  const outfit = job?.resolved?.outfit?.label ?? job?.input?.outfit?.value ?? '(unknown outfit)';
  const chosen = job?.selection?.stillIndex;

  const cards = list.map((still) => {
    // ONE NUMBERING, EVERYWHERE. The number on the card is `still.index`, which
    // is 1-based, is what `still-01.png` is called, is what the provider
    // returned, is what `--still=` takes and is what lands in
    // `selection.stillIndex`. Array positions never appear on this page and
    // never reach a manifest: two numberings meeting in `select/` animates the
    // wrong face at video prices and reports no fault at all.
    const isAuto = still.index === autoStill;
    const isChosen = Number.isInteger(chosen) && chosen === still.index;
    const tags = [
      ...(isChosen ? ['chosen'] : []),
      ...(isAuto && !isChosen ? ['auto-pick'] : []),
    ].map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
    return [
      `  <figure${isAuto || isChosen ? ' class="auto"' : ''}>`,
      `    <img src="${escapeHtml(srcFromReview(still.path))}" alt="still ${escapeHtml(still.index)}" loading="lazy">`,
      '    <figcaption>',
      `      <span class="n">still ${escapeHtml(still.index)}</span>${tags}<br>`,
      `      seed ${escapeHtml(still.seed)} · ${escapeHtml(path.posix.basename(String(still.path)))}`,
      `      <code>npm run render -- --resume=${escapeHtml(job?.jobId)} --still=${escapeHtml(still.index)}</code>`,
      '    </figcaption>',
      '  </figure>',
    ].join('\n');
  }).join('\n');

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>timestamp · stills · ${escapeHtml(job?.jobId)}</title>`,
    `<style>\n${STYLE}\n</style>`,
    '</head>',
    '<body>',
    '<header>',
    `  <h1>Pick the face</h1>`,
    `  <p class="sub"><b>${escapeHtml(place)}</b> · ${escapeHtml(outfit)}</p>`,
    `  <p class="sub">job ${escapeHtml(job?.jobId)} · provider ${escapeHtml(job?.provider)} · ${escapeHtml(list.length)} still(s)</p>`,
    '</header>',
    '<p class="note">',
    '  Video generation is the expensive half of this render and it starts from exactly one of these',
    '  frames. Look at all of them, decide which one is <em>you</em>, and resume with that number.',
    '  Sharpness and lighting are not the question — likeness is, and no software here can measure it.',
    '</p>',
    '<div class="grid">',
    cards,
    '</div>',
    '<footer>',
    `  written by scripts/select/contact-sheet.mjs · nothing on this page contacts a network`,
    '</footer>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * Write it to `review/stills.html` and return the absolute path.
 *
 * Absolute, because the caller spawns and links against real paths; the
 * manifest form is the caller's job (`toJobRelative`), and doing that
 * conversion here would give this function two return types depending on who
 * asked.
 *
 * @param {object} job
 * @param {object} paths   `jobPaths(root, jobId)`
 * @param {object} [opts]
 * @param {Array}  [opts.stills]     defaults to the `still` step's recorded output
 * @param {number} [opts.autoStill]  1-based, like every other index in this system
 * @param {object} [opts.fsImpl]
 */
export function writeContactSheet(job, paths, { stills, autoStill, fsImpl = fs } = {}) {
  const list = stills ?? job?.steps?.find((s) => s.name === 'still')?.output?.stills ?? [];
  const file = `${paths.review}/stills.html`;
  fsImpl.mkdirSync(paths.review, { recursive: true });
  fsImpl.writeFileSync(file, contactSheetHtml(job, list, {
    autoStill: autoStill ?? list[0]?.index ?? FIRST_INDEX,
  }), 'utf8');
  return file;
}
