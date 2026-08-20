/**
 * The one stylesheet, and byte-range file serving for the video and the poster.
 *
 * WHY ONE CSS FILE AS A STRING IN A MODULE. There is no build step and there is
 * not going to be one, so the choice is between a string here and a file on disk
 * that a second code path has to locate, cache and content-type. A string is
 * hashed for its ETag at module load, served from memory, and cannot go missing
 * in a deploy that forgot to copy a directory.
 *
 * WHY RANGE REQUESTS ARE IMPLEMENTED AND NOT SKIPPED. `<video>` in Safari will
 * not play a source that answers a range request with 200 and the whole file;
 * iOS specifically requires 206. Since the deliverable is a portrait video meant
 * to be watched on a phone, "it works everywhere except the platform it was
 * designed for" is the failure this thirty lines prevents.
 *
 * WHY THE FONT IS SERVED FROM `assets/fonts/`. `tape-osd.ttf` is VT323 under the
 * SIL OFL 1.1 and the licence is committed beside it, which permits bundling and
 * redistribution inside a product. It is already the font the date stamp is
 * burned in with, so the page and the video are lettered the same -- and the
 * alternative, a webfont CDN, is a third-party request on a page that has just
 * been handed a photograph of somebody's face.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Warm off-white on the delivery surround. `#0B0A09` is not decoration: it is
 *  the colour the finished video is matted onto (config/render.json), and the
 *  page is the same object as the thing it hands you. */
export const CSS = `
@font-face {
  font-family: 'TapeOSD';
  src: url('/tape-osd.ttf') format('truetype');
  font-display: swap;
}

:root {
  --ground: #0B0A09;
  --panel: #131110;
  --raise: #191614;
  --edge: #2A2420;
  --ink: #E7DFD3;
  --dim: #948A7C;
  --faint: #6A6155;
  --stamp: #D89A3F;
  --stamp-deep: #8A6428;
  --alarm: #C2603F;
  --radius: 3px;
  --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

* { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.55;
  letter-spacing: 0.005em;
  padding: 0 1.15rem 4rem;
}

/* A single static grain plate over everything, very low. The product is about
   texture; a flat page under it would be a different product's page. */
.grain {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9;
  opacity: 0.055;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

.wrap { max-width: 34rem; margin: 0 auto; position: relative; z-index: 1; }

/* --- masthead ---------------------------------------------------------- */

.masthead { padding: 3.25rem 0 2.5rem; text-align: center; }

.wordmark {
  font-family: 'TapeOSD', ui-monospace, 'Courier New', monospace;
  font-size: 2rem;
  letter-spacing: 0.34em;
  text-indent: 0.34em;
  color: var(--stamp);
  text-decoration: none;
  display: inline-block;
  text-shadow: 0 0 14px rgba(216, 154, 63, 0.16);
}

.tagline { margin: 0.5rem 0 0; color: var(--faint); font-size: 0.8rem; letter-spacing: 0.08em; }

/* --- type -------------------------------------------------------------- */

.lede { color: var(--dim); margin: 0 0 2rem; }

.headline { font-size: 1.45rem; font-weight: 500; margin: 0 0 0.35rem; letter-spacing: -0.01em; }

.sub { color: var(--dim); margin: 0 0 1.75rem; font-size: 0.95rem; }

.hint { color: var(--faint); font-size: 0.82rem; margin: 0 0 0.7rem; line-height: 1.5; }

.stamp {
  font-family: 'TapeOSD', ui-monospace, 'Courier New', monospace;
  color: var(--stamp-deep);
  letter-spacing: 0.16em;
  font-size: 0.95rem;
  margin: 0 0 1.1rem;
}

.alert {
  border-left: 2px solid var(--alarm);
  background: rgba(194, 96, 63, 0.07);
  color: #E8BCAC;
  padding: 0.75rem 0.95rem;
  margin: 0 0 1.5rem;
  font-size: 0.9rem;
  border-radius: 0 var(--radius) var(--radius) 0;
}

/* --- the form ---------------------------------------------------------- */

.card {
  background: var(--panel);
  border: 1px solid var(--edge);
  border-radius: var(--radius);
  padding: 0.35rem 1.35rem 1.6rem;
}

.field { border: 0; border-top: 1px solid var(--edge); margin: 0; padding: 1.5rem 0 0.35rem; }
.field:first-of-type { border-top: 0; padding-top: 1.6rem; }

legend, .field > legend label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--stamp);
  padding: 0;
  margin-bottom: 0.55rem;
}

input[type="text"], select {
  width: 100%;
  background: var(--ground);
  border: 1px solid var(--edge);
  border-radius: var(--radius);
  color: var(--ink);
  font: inherit;
  padding: 0.7rem 0.8rem;
}

input[type="text"]::placeholder { color: #574F45; }

select { width: auto; min-width: 6rem; }

input[type="file"] {
  width: 100%;
  color: var(--dim);
  font-size: 0.85rem;
  padding: 0.55rem 0;
}

input[type="file"]::file-selector-button {
  background: var(--raise);
  border: 1px solid var(--edge);
  border-radius: var(--radius);
  color: var(--ink);
  font: inherit;
  font-size: 0.85rem;
  padding: 0.45rem 0.85rem;
  margin-right: 0.85rem;
  cursor: pointer;
}

:focus-visible { outline: 2px solid var(--stamp); outline-offset: 2px; }

/* --- recommendations --------------------------------------------------- */

.chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.7rem; }

.chip {
  background: transparent;
  border: 1px solid var(--edge);
  border-radius: 999px;
  color: var(--dim);
  font: inherit;
  font-size: 0.78rem;
  padding: 0.28rem 0.75rem;
  cursor: pointer;
  transition: color 120ms, border-color 120ms;
}

.chip:hover { color: var(--stamp); border-color: var(--stamp-deep); }

.aside { margin-top: 1rem; }
.aside summary { color: var(--dim); font-size: 0.85rem; cursor: pointer; }
.aside summary:hover { color: var(--stamp); }
.aside[open] summary { margin-bottom: 0.7rem; }

/* --- consent ----------------------------------------------------------- */

.consent .check { display: flex; gap: 0.8rem; align-items: flex-start; cursor: pointer; }
.consent input { margin-top: 0.35rem; accent-color: var(--stamp); flex: 0 0 auto; width: 1rem; height: 1rem; }
.consent-text span { display: block; color: var(--dim); font-size: 0.82rem; line-height: 1.55; }
.consent-text span + span { margin-top: 0.55rem; }

/* --- buttons ----------------------------------------------------------- */

.go {
  display: inline-block;
  width: 100%;
  margin-top: 1.9rem;
  background: var(--stamp);
  border: 0;
  border-radius: var(--radius);
  color: #17120A;
  font: inherit;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 0.8rem 1rem;
  cursor: pointer;
  text-align: center;
  text-decoration: none;
}

.go:hover { background: #E7A94B; }

.actions { margin-top: 2.25rem; display: flex; gap: 1.25rem; align-items: center; flex-wrap: wrap; }
.actions .go { width: auto; margin-top: 0; }

.quiet {
  background: none;
  border: 0;
  color: var(--faint);
  font: inherit;
  font-size: 0.85rem;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: var(--edge);
}

.quiet:hover { color: var(--stamp); }

/* --- progress ---------------------------------------------------------- */

.bar { display: flex; gap: 3px; list-style: none; padding: 0; margin: 0 0 0.6rem; }

.seg { flex: 1; height: 4px; border-radius: 1px; background: #221E1A; }
.seg-done { background: var(--stamp-deep); }
.seg-skipped { background: #221E1A; box-shadow: inset 0 0 0 1px var(--stamp-deep); }
.seg-running { background: var(--stamp); animation: breathe 1.9s ease-in-out infinite; }
.seg-failed { background: var(--alarm); }

@keyframes breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

@media (prefers-reduced-motion: reduce) {
  .seg-running { animation: none; }
}

.counter {
  font-family: 'TapeOSD', ui-monospace, monospace;
  color: var(--faint);
  letter-spacing: 0.12em;
  font-size: 0.9rem;
  margin: 0 0 2rem;
}

.steps { list-style: none; padding: 0; margin: 0 0 2rem; }

.step {
  display: grid;
  grid-template-columns: 1rem 1fr;
  grid-template-areas: 'mark name' '. note';
  gap: 0 0.75rem;
  padding: 0.5rem 0;
  border-top: 1px solid #1A1614;
  color: var(--faint);
}

.step-mark {
  grid-area: mark;
  width: 6px; height: 6px;
  margin-top: 0.55rem;
  border-radius: 50%;
  background: #2A2420;
}

.step-name { grid-area: name; font-size: 0.92rem; }
.step-note { grid-area: note; font-size: 0.78rem; color: #4E463C; }

.step-done { color: var(--dim); }
.step-done .step-mark { background: var(--stamp-deep); }
.step-skipped .step-mark { box-shadow: inset 0 0 0 1px var(--stamp-deep); background: transparent; }
.step-failed .step-mark { background: var(--alarm); }
.step-current { color: var(--ink); }
.step-current .step-mark { background: var(--stamp); }
.step-current .step-note { color: var(--dim); }

.inputs { font-size: 0.85rem; color: var(--dim); line-height: 1.9; }
.inputs .k {
  display: inline-block;
  min-width: 4.5rem;
  color: var(--faint);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}
.inputs .v { overflow-wrap: anywhere; }

/* --- contact sheet ----------------------------------------------------- */

.sheet { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.7rem; }

.still {
  position: relative;
  display: block;
  padding: 0;
  background: var(--panel);
  border: 1px solid var(--edge);
  border-radius: var(--radius);
  cursor: pointer;
  overflow: hidden;
  line-height: 0;
}

.still img { width: 100%; height: auto; display: block; }
.still:hover { border-color: var(--stamp); }
.still.chosen { border-color: var(--stamp); box-shadow: 0 0 0 1px var(--stamp); }

.still-n {
  position: absolute;
  left: 0.4rem; bottom: 0.35rem;
  font-family: 'TapeOSD', ui-monospace, monospace;
  color: var(--stamp);
  font-size: 1rem;
  line-height: 1;
  text-shadow: 0 1px 3px #000;
}

/* --- the video --------------------------------------------------------- */

.player {
  background: var(--ground);
  border: 1px solid var(--edge);
  border-radius: var(--radius);
  overflow: hidden;
  line-height: 0;
}

.player video { width: 100%; height: auto; display: block; background: var(--ground); }

.meta {
  font-family: 'TapeOSD', ui-monospace, monospace;
  color: var(--faint);
  letter-spacing: 0.12em;
  font-size: 0.9rem;
  margin: 0.8rem 0 1.75rem;
}

/* --- foot -------------------------------------------------------------- */

.foot { margin-top: 4rem; padding-top: 1.5rem; border-top: 1px solid #17130F; color: var(--faint); font-size: 0.78rem; }
.foot p { margin: 0 0 0.4rem; }
.fine { color: #453E36; }
`.trim();

/** Hashed once at load. An ETag derived from the content means a redeploy that
 *  changed nothing does not bust anybody's cache, and one that changed a colour
 *  does -- which is the opposite of what a version-number ETag gets you. */
const CSS_ETAG = `"${createHash('sha256').update(CSS).digest('hex').slice(0, 16)}"`;

export const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.ttf': 'font/ttf',
});

export function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** @param {import('node:http').ServerResponse} res */
export function sendCss(req, res) {
  if (req.headers['if-none-match'] === CSS_ETAG) {
    res.writeHead(304, { ETag: CSS_ETAG });
    res.end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES['.css'],
    'Content-Length': Buffer.byteLength(CSS),
    ETag: CSS_ETAG,
    'Cache-Control': 'public, max-age=300',
  });
  res.end(req.method === 'HEAD' ? undefined : CSS);
}

/**
 * Parse a `Range` header for a resource of `size` bytes.
 *
 * Deliberately single-range only. Multipart/byteranges is a spec corner no
 * browser's media element uses, and implementing it half-heartedly is worse than
 * declining it: returning 200 with the whole body is a legal answer to a range
 * request and every client copes.
 *
 * @returns {{start:number,end:number}|null|'unsatisfiable'}
 */
export function parseRange(header, size) {
  if (typeof header !== 'string') return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;

  let start;
  let end;
  if (rawStart === '') {
    // `bytes=-500` is the LAST 500 bytes, not the first. Getting this backwards
    // serves a valid 206 containing the wrong bytes, which no client reports.
    const wanted = Number(rawEnd);
    if (wanted === 0) return 'unsatisfiable';
    start = Math.max(0, size - wanted);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

/**
 * Stream a file, honouring `Range`.
 *
 * @param {object} opts
 * @param {string} opts.file        absolute path, already validated by the caller
 * @param {number} [opts.maxAge]    seconds; job output is immutable once written
 */
export function sendFile(req, res, { file, contentType, maxAge = 0, download = null, fsImpl = fs } = {}) {
  let stat;
  try {
    stat = fsImpl.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const type = contentType ?? contentTypeFor(file);
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': maxAge > 0 ? `private, max-age=${maxAge}` : 'no-cache',
  };
  if (download) headers['Content-Disposition'] = `attachment; filename="${download.replace(/["\\]/g, '')}"`;

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return true;
  }

  const range = parseRange(req.headers.range, stat.size);
  if (range === 'unsatisfiable') {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, 'Accept-Ranges': 'bytes' });
    res.end();
    return true;
  }

  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
      'Content-Length': length,
    });
    if (req.method === 'HEAD') { res.end(); return true; }
    fsImpl.createReadStream(file, { start: range.start, end: range.end }).pipe(res);
    return true;
  }

  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') { res.end(); return true; }
  fsImpl.createReadStream(file).pipe(res);
  return true;
}
