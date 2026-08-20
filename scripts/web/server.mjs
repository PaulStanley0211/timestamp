/**
 * The HTTP layer. Four pages and a JSON API over the job model and the queue.
 *
 * WHY NOTHING HERE AWAITS A RENDER, AND WHY THAT IS THE WHOLE DESIGN.
 * `POST /api/jobs` writes a manifest, puts a pointer on the queue and returns
 * 201. It does not call a provider, it does not run ffmpeg, and there is no code
 * path in this file that can wait on either. A 15-second render is ~30 seconds
 * of ffmpeg *after* generation calls that take minutes; a request/response
 * shaping of that is, per RELIO 11.3 and CLAUDE.md, the single most likely
 * reason a six-week build becomes fourteen. If a future edit puts an `await` on
 * a pipeline inside a handler, everything below stops being true at once: the
 * socket times out, the browser retries, the retry enqueues a second render, and
 * the user is charged twice for a video they never see.
 *
 * WHY THE WEB PROCESS IS NOT ALLOWED TO WRITE MOST MANIFESTS. The manifest has
 * exactly one writer -- whoever holds the queue lease -- because `saveJob`
 * writes a single fixed `manifest.json.tmp` and two writers racing on it is a
 * corrupted job. This process never holds a lease. So it writes a manifest in
 * precisely two places, both of which are provably unraced:
 *
 *   - `POST /api/jobs` creates the job BEFORE enqueueing it. Nothing can have
 *     claimed a job that is not yet on the board.
 *   - `POST /api/jobs/:id/select` writes only when the job is parked at
 *     `awaiting-selection` AND holds no live lease -- which together mean no
 *     worker is in it -- and it enqueues only AFTER the save has landed, so the
 *     window in which a worker could claim it does not overlap the write.
 *
 * Cancellation gets neither of those guarantees, so it does not write the
 * manifest at all in the general case: it drops the `cancel.requested` sentinel
 * and lets the worker, the legitimate writer, perform the transition between
 * steps. See `handlers.cancelJob`.
 *
 * WHY EVERY `:id` IS CHECKED TWICE. `router.mjs` refuses traversal shapes in the
 * path; this file then checks the surviving string against `JOB_ID_RE` -- the
 * strict one exported by `job.mjs`, not the laxer internal `SAFE_ID_RE` that
 * exists so other modules' tests can use readable ids -- before any of it
 * reaches `jobPaths`. Path traversal is not theoretical when strangers can hit
 * this endpoint, and the second check costs a regex.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  JOB_ID_RE,
  createJob, loadJob, saveJob, jobPaths, newJobId,
  nextStep, setSelection, setJobStatus, cancelJob as markCancelled,
  JobError,
} from '../render/job.mjs';
import { loadCatalog } from '../catalog/catalog.mjs';
import { CONSENT_TEXT, recordConsent } from '../safety/consent.mjs';
import { LIMITS } from '../intake/photo.mjs';
import { runFfprobe } from '../ffmpeg/run.mjs';

/** The repo root, for the two assets served off disk. Derived from this module's
 *  own location rather than from cwd, so `npm run web` from anywhere finds them. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..').split(path.sep).join('/');

import { matchRoute } from './router.mjs';
import { boundaryFromContentType, parseMultipart, fileSink, MultipartError } from './multipart.mjs';
import { sendCss, sendFile } from './static.mjs';
import { uploadPage, statusPage, selectPage, resultPage, errorPage } from './views.mjs';

/** Anything a handler throws that has a status. Everything else becomes a 500
 *  with a generic message, because a filesystem error message contains an
 *  absolute path and this process is talking to strangers. */
export class HttpError extends Error {
  constructor(status, message, { code = 'ERROR', detail = null, closeConnection = false } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    // Set when the request body was abandoned part-way through, so the response
    // must be the last thing on this connection -- see `fail`.
    this.closeConnection = closeConnection;
  }
}

/** An HTML checkbox posts `"on"`. A JSON client posts `true`. A person who
 *  ticked nothing posts nothing at all, and `""` and `"false"` are both truthy
 *  strings -- which is why this is a set membership test and not `if (consent)`.
 *  `safety/consent.mjs` makes the same point about `granted !== true`. */
const CONSENT_YES = new Set(['yes', 'on', 'true', '1']);

/** The raw upload, before `intake` re-encodes it into `input/photo.jpg`.
 *
 *  Deliberately extension-less. The client's filename is attacker-controlled and
 *  `inspectPhoto` derives the real format from the codec rather than the name,
 *  so an extension here would be a claim nobody checks. `intake` reads this
 *  path out of the manifest and writes the stripped copy beside it. */
const UPLOAD_NAMES = Object.freeze({ photo: 'input/upload-photo', placePhoto: 'input/upload-place' });

const STILL_FILE_RE = /^still-(\d+)\.(png|jpe?g|webp)$/i;

// ---------------------------------------------------------------------------
// small response helpers
// ---------------------------------------------------------------------------

function sendJson(req, res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : text);
}

function sendHtml(req, res, status, html, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    // The pages load nothing from anywhere else -- one same-origin stylesheet,
    // one same-origin font, images and video from this app. Saying so means a
    // successful injection into the place field still cannot exfiltrate.
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; media-src 'self'; "
      + "style-src 'self'; font-src 'self'; script-src 'unsafe-inline'; "
      + "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : html);
}

function redirect(res, to, status = 303) {
  res.writeHead(status, { Location: to, 'Cache-Control': 'no-store' });
  res.end();
}

/** Which representation the caller wants. A browser posting the upload form
 *  sends `Accept: text/html` and gets a redirect it can follow; curl and the
 *  tests send nothing and get the 201 JSON that docs/interfaces.md specifies.
 *  One handler, one code path, two representations. */
function wantsHtml(req) {
  const accept = String(req.headers.accept ?? '');
  if (!accept.includes('text/html')) return false;
  // `Accept: */*` from curl contains no `text/html`; an XHR that asked for JSON
  // explicitly is honoured even if it also listed html.
  return !accept.startsWith('application/json');
}

/**
 * Read a small request body with the cap enforced as it arrives, for the two
 * endpoints that take one. Same discipline as the multipart parser and for the
 * same reason: checking the size after buffering is not a check.
 */
function readBody(req, maxBytes = 8_192) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.destroy();
        reject(new HttpError(413, 'Request body is too large.', { code: 'BODY_TOO_LARGE' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

/** JSON or `application/x-www-form-urlencoded`, because the contact sheet is a
 *  plain form and the poller is fetch(). Neither is more real than the other. */
function parseSmallBody(contentType, text) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'application/json') {
    try {
      const parsed = JSON.parse(text || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new HttpError(400, 'Body must be a JSON object.', { code: 'BAD_BODY' });
      }
      return parsed;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, 'Body is not valid JSON.', { code: 'BAD_JSON' });
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

// ---------------------------------------------------------------------------
// the server
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.root      data root; `out/jobs` and `out/queue` live under it
 * @param {object} opts.cfg       config/render.json as loaded
 * @param {object} opts.queue     a Queue from scripts/queue/queue.mjs
 * @param {number} [opts.port]    0 means "any free port", which is what tests want
 * @param {object} [opts.catalog] injected; defaults to the shipped preset menu
 * @param {string} [opts.provider] provider id recorded on every new job
 */
export function createServer({
  root,
  cfg,
  queue,
  port = 0,
  host = '127.0.0.1',
  catalog = null,
  provider = process.env.TIMESTAMP_PROVIDER || 'fixture',
  limits = LIMITS,
  consentText = CONSENT_TEXT,
  ffprobeImpl = runFfprobe,
  nowImpl = () => new Date(),
  logImpl = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('createServer needs a root');
  }
  if (!queue || typeof queue.enqueue !== 'function') {
    throw new TypeError('createServer needs a queue (scripts/queue/queue.mjs)');
  }

  // Loaded once, at construction. A preset file that fails validation should
  // stop the server coming up, not produce a 500 on the first page view.
  const menu = catalog ?? loadCatalog();
  const recommendations = {
    places: [...menu.places.values()].map((p) => ({ id: p.id, label: p.label })),
    outfits: [...menu.outfits.values()].map((o) => ({ id: o.id, label: o.label })),
  };
  /** label and id both map back to the id, so a chip click ("Allotment garden,
   *  late August") is recognised as the preset it came from rather than being
   *  treated as free text and sent through `expand` to be re-derived. */
  const presetLookup = { place: new Map(), outfit: new Map() };
  for (const p of recommendations.places) {
    presetLookup.place.set(p.id.toLowerCase(), p.id);
    presetLookup.place.set(p.label.toLowerCase(), p.id);
  }
  for (const o of recommendations.outfits) {
    presetLookup.outfit.set(o.id.toLowerCase(), o.id);
    presetLookup.outfit.set(o.label.toLowerCase(), o.id);
  }

  // -------------------------------------------------------------------------
  // job access
  // -------------------------------------------------------------------------

  /** The strict check, before anything reaches `jobPaths`. */
  function requireJobId(id) {
    if (typeof id !== 'string' || !JOB_ID_RE.test(id)) {
      throw new HttpError(400, 'That is not a job id.', { code: 'BAD_JOB_ID' });
    }
    return id;
  }

  function readJob(id) {
    requireJobId(id);
    try {
      return loadJob({ root, jobId: id, nowImpl, cfg });
    } catch (err) {
      // A job that is not there is a 404, not a 500 -- `listJobs` takes the same
      // view, for the same reason: one missing manifest must not read as the
      // server being broken. A manifest that IS there and cannot be parsed is
      // the opposite: that is our fault and it must not be reported as "no such
      // job", which would send somebody looking for a job id that is fine.
      if (err instanceof JobError) {
        if (err.code === 'NOT_FOUND') throw new HttpError(404, 'No such job.', { code: 'NO_JOB' });
        throw new HttpError(500, 'That job could not be read.', { code: err.code });
      }
      throw err;
    }
  }

  /**
   * Does a worker hold a live lease on this job right now?
   *
   * This is the question that decides whether the web process may touch a
   * manifest at all. `peek` is read-only and an expired lease is not a claim --
   * a worker that died holding one has already lost the right to write.
   */
  function isClaimed(jobId) {
    if (typeof queue.peek !== 'function') return true; // unknown means "assume yes"
    try {
      return queue.peek({ state: 'claimed' }).some((row) => row.jobId === jobId && !row.expired);
    } catch {
      return true;
    }
  }

  /** The stills on disk, numbered off the FILENAME.
   *
   *  INDICES ARE 1-BASED: `still-01.png` is index 1. The number is parsed out of
   *  the name rather than taken from this loop's position, because a gap in the
   *  sequence would silently shift every index after it -- the user clicks frame
   *  3 and frame 4 gets animated, with both numbers valid and nothing reporting
   *  a fault. */
  function stillsOf(jobId) {
    const dir = jobPaths(root, jobId).stills;
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    return names
      .map((name) => ({ name, m: STILL_FILE_RE.exec(name) }))
      .filter((e) => e.m)
      .map((e) => ({ index: Number(e.m[1]), file: `${dir}/${e.name}`, name: e.name }))
      .filter((e) => Number.isInteger(e.index) && e.index >= 1)
      .sort((a, b) => a.index - b.index);
  }

  /**
   * The `GET /api/jobs/:id` payload, and the same object the pages render from.
   * One shape means the server-rendered status page and the poller cannot drift.
   *
   * `pct` is the fraction of steps finished -- a real count of real steps, not an
   * easing curve. It can sit at the same number for four minutes, and it should:
   * that is what is actually happening.
   */
  function jobView(job) {
    const step = nextStep(job);
    const finished = job.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
    return {
      jobId: job.jobId,
      status: job.status,
      step,
      pct: Math.round((finished / job.steps.length) * 100),
      steps: job.steps.map((s) => ({
        name: s.name,
        status: s.status,
        attempts: s.attempts,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        // The message only; a provider stack trace is not the user's business
        // and `detail` can carry a request id we do not want echoed.
        error: s.error ? { code: s.error.code ?? null, message: s.error.message ?? null } : null,
      })),
      cost: job.cost,
      result: {
        ...job.result,
        videoUrl: job.result?.videoPath ? `/api/jobs/${job.jobId}/video` : null,
        posterUrl: job.result?.posterPath ? `/api/jobs/${job.jobId}/poster` : null,
      },
      error: job.error ? { code: job.error.code ?? null, message: job.error.message ?? null } : null,
      input: {
        place: job.input?.place?.value ?? null,
        placeKind: job.input?.place?.kind ?? null,
        outfit: job.input?.outfit?.value ?? null,
        outfitKind: job.input?.outfit?.kind ?? null,
        stillCount: job.input?.stillCount ?? null,
      },
      selection: job.selection,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      urls: {
        status: `/j/${job.jobId}`,
        select: `/j/${job.jobId}/select`,
        result: `/j/${job.jobId}/result`,
      },
    };
  }

  // -------------------------------------------------------------------------
  // health
  // -------------------------------------------------------------------------

  /** ffprobe is spawned at most once every 30 s. A health endpoint that shells
   *  out on every hit is a denial-of-service primitive somebody else operates. */
  let ffmpegCache = { at: 0, value: null };
  async function ffmpegHealth() {
    const now = Date.now();
    if (ffmpegCache.value && now - ffmpegCache.at < 30_000) return ffmpegCache.value;
    let value;
    try {
      const out = await ffprobeImpl(['-hide_banner', '-version']);
      const text = typeof out === 'string' ? out : (out?.stdout ?? '');
      value = { available: true, version: (String(text).split('\n')[0] ?? '').trim() || null };
    } catch (err) {
      value = { available: false, version: null, error: err?.code ?? 'not-found' };
    }
    ffmpegCache = { at: now, value };
    return value;
  }

  // -------------------------------------------------------------------------
  // handlers
  // -------------------------------------------------------------------------

  const handlers = {
    // --- pages -----------------------------------------------------------

    uploadPage(req, res) {
      sendHtml(req, res, 200, uploadPage({ ...recommendations, consentText }));
    },

    stylesheet(req, res) { sendCss(req, res); },

    font(req, res) {
      const file = `${REPO_ROOT}/assets/fonts/tape-osd.ttf`;
      if (!sendFile(req, res, { file, contentType: 'font/ttf', maxAge: 86_400 })) {
        throw new HttpError(404, 'Not found.', { code: 'NO_FONT' });
      }
    },

    favicon(req, res) { res.writeHead(204); res.end(); },

    statusPage(req, res, { params }) {
      const job = readJob(params.id);
      if (job.status === 'done') return redirect(res, `/j/${job.jobId}/result`);
      if (job.status === 'awaiting-selection') return redirect(res, `/j/${job.jobId}/select`);
      return sendHtml(req, res, 200, statusPage({ view: jobView(job) }));
    },

    selectPage(req, res, { params }) {
      const job = readJob(params.id);
      if (job.status !== 'awaiting-selection') return redirect(res, `/j/${job.jobId}`);
      const stills = stillsOf(job.jobId).map((s) => ({
        index: s.index,
        url: `/api/jobs/${job.jobId}/stills/${s.index}`,
      }));
      return sendHtml(req, res, 200, selectPage({ view: jobView(job), stills }));
    },

    resultPage(req, res, { params }) {
      const job = readJob(params.id);
      if (job.status !== 'done') return redirect(res, `/j/${job.jobId}`);
      return sendHtml(req, res, 200, resultPage({ view: jobView(job) }));
    },

    // --- API -------------------------------------------------------------

    async health(req, res) {
      const ffmpeg = await ffmpegHealth();
      let stats = null;
      try { stats = queue.stats(); } catch { stats = null; }

      // `worker.lastSeen` is the most recent live claim, which is the only
      // evidence of a worker this process has: there is no heartbeat file in
      // docs/interfaces.md 6 and inventing one here would be a second contract.
      // null therefore means "no work is in flight", NOT "no worker exists" --
      // an idle worker next to an empty queue is indistinguishable from none,
      // and saying so is more useful than a confident wrong answer.
      let lastSeen = null;
      try {
        for (const row of queue.peek({ state: 'claimed' })) {
          if (row.claimedAt && (lastSeen === null || row.claimedAt > lastSeen)) lastSeen = row.claimedAt;
        }
      } catch { /* the queue directory can be mid-write; not a health failure */ }

      sendJson(req, res, 200, {
        ok: ffmpeg.available && stats !== null,
        ffmpeg,
        queue: stats,
        worker: { lastSeen, inFlight: stats?.claimed ?? null },
        provider,
      });
    },

    /**
     * Create a job. Writes a manifest, enqueues a pointer, returns 201.
     *
     * NOTHING IS AWAITED HERE EXCEPT THE UPLOAD ITSELF. The only slow thing in
     * this handler is reading the bytes the client is already sending.
     */
    async createJob(req, res) {
      const boundary = boundaryFromContentType(req.headers['content-type']);
      if (!boundary) {
        throw new HttpError(415, 'Send the form as multipart/form-data.', { code: 'NOT_MULTIPART' });
      }
      // Cheap and advisory. Content-Length is a claim by the sender, so it is
      // worth refusing early and worth nothing as a guarantee -- the streaming
      // cap below is the real one.
      const declared = Number(req.headers['content-length'] ?? 0);
      if (Number.isFinite(declared) && declared > limits.maxBytes) {
        throw new HttpError(413, `That upload is larger than ${Math.round(limits.maxBytes / 1e6)} MB.`, {
          code: 'TOO_LARGE',
        });
      }

      // The id is minted before the body is read so the uploads can stream
      // straight into the directory they belong in. Nothing else knows about
      // this id yet, so a failed upload takes the whole directory with it.
      const jobId = newJobId({ now: nowImpl });
      const paths = jobPaths(root, jobId);
      fs.mkdirSync(`${paths.dir}/input`, { recursive: true });

      const hashes = new Map();
      const discard = { write: () => true, end: async () => ({ bytes: 0, discarded: true }), abort: async () => {} };

      try {
        const { fields, files } = await parseMultipart(req, {
          boundary,
          limits: { maxBytes: limits.maxBytes },
          sinkFor: (part) => {
            const rel = UPLOAD_NAMES[part.name];
            if (!rel) return discard;
            // Hashed while it streams. Re-reading a 12 MB file to hash it would
            // put back the whole-file buffer this parser exists to avoid.
            const hash = crypto.createHash('sha256');
            hashes.set(part.name, hash);
            const sink = fileSink(`${paths.dir}/${rel}`);
            return {
              ...sink,
              write(buf) { hash.update(buf); return sink.write(buf); },
              onDrain: sink.onDrain,
              end: () => sink.end(),
              abort: () => sink.abort(),
            };
          },
        });

        const photo = files.find((f) => f.name === 'photo' && f.bytes > 0);
        if (!photo) throw new HttpError(400, 'Choose a photo of yourself.', { code: 'NO_PHOTO' });
        const placePhoto = files.find((f) => f.name === 'placePhoto' && f.bytes > 0) ?? null;

        if (!CONSENT_YES.has(String(fields.consent ?? '').trim().toLowerCase())) {
          throw new HttpError(400, 'Please confirm the statement before uploading.', {
            code: 'CONSENT_REQUIRED',
          });
        }

        const placeText = cleanText(fields.place, 'place', { required: placePhoto === null });
        const outfitText = cleanText(fields.outfit, 'outfit', { required: true });
        const stillCount = cleanStillCount(fields.stillCount);

        const placeId = placeText ? presetLookup.place.get(placeText.toLowerCase()) ?? null : null;
        const outfitId = presetLookup.outfit.get(outfitText.toLowerCase()) ?? null;

        const input = {
          photo: {
            path: UPLOAD_NAMES.photo,
            sha256: hashes.get('photo').digest('hex'),
            width: 0,
            height: 0,
          },
          place: placePhoto
            // A photo of the place beats any description of it, so it wins the
            // `kind`; the text, if any, is kept as the caption that goes with it.
            ? { kind: 'photo', value: placeText, photoPath: UPLOAD_NAMES.placePhoto, photoSha256: hashes.get('placePhoto')?.digest('hex') ?? null }
            : { kind: placeId ? 'preset' : 'text', value: placeId ?? placeText, photoPath: null, photoSha256: null },
          outfit: { kind: outfitId ? 'preset' : 'text', value: outfitId ?? outfitText },
          stillCount,
          consent: recordConsent({ granted: true, text: consentText, nowImpl }),
        };

        // Created BEFORE it is enqueued. A pointer to a job with no manifest is
        // the one state this system cannot recover from (job.mjs says so), and
        // this ordering is what makes it impossible.
        const job = createJob({ root, jobId, input, provider, cfg, nowImpl });
        queue.enqueue(job.jobId);

        if (wantsHtml(req)) return redirect(res, `/j/${job.jobId}`);
        return sendJson(req, res, 201, {
          jobId: job.jobId,
          statusUrl: `/j/${job.jobId}`,
          apiUrl: `/api/jobs/${job.jobId}`,
        }, { Location: `/j/${job.jobId}` });
      } catch (err) {
        // A half-made directory holding a stranger's photograph and no manifest
        // is invisible to `listJobs`, invisible to purge, and never cleaned up.
        try { fs.rmSync(paths.dir, { recursive: true, force: true }); } catch { /* best effort */ }
        if (err instanceof MultipartError) {
          // The body was abandoned mid-stream, so this response has to be the
          // last thing on the connection.
          throw new HttpError(err.status, uploadFailureMessage(err), {
            code: err.code, closeConnection: true,
          });
        }
        throw err;
      }
    },

    getJob(req, res, { params }) {
      sendJson(req, res, 200, jobView(readJob(params.id)));
    },

    listStills(req, res, { params }) {
      const job = readJob(params.id);
      sendJson(req, res, 200, {
        jobId: job.jobId,
        stills: stillsOf(job.jobId).map((s) => ({
          index: s.index,
          url: `/api/jobs/${job.jobId}/stills/${s.index}`,
        })),
        selected: job.selection?.stillIndex ?? null,
      });
    },

    getStill(req, res, { params }) {
      const job = readJob(params.id);
      const wanted = Number(params.index);
      if (!Number.isInteger(wanted) || wanted < 1) {
        throw new HttpError(400, 'Still index must be a whole number from 1.', { code: 'BAD_INDEX' });
      }
      // Found by scanning the directory and comparing parsed numbers, so no part
      // of the request ever becomes a path component.
      const still = stillsOf(job.jobId).find((s) => s.index === wanted);
      if (!still || !sendFile(req, res, { file: still.file, maxAge: 3600 })) {
        throw new HttpError(404, 'No such still.', { code: 'NO_STILL' });
      }
    },

    /**
     * Record which still to animate, and put the job back on the queue.
     *
     * Legal only at `awaiting-selection` with no live lease. Those two together
     * are what make this the second and last place the web process writes a
     * manifest: a job parked for a human is not on the pending board, so nothing
     * can claim it, and the enqueue that makes it claimable happens after the
     * save. Any other status is 409 -- refusing is correct, because a selection
     * arriving mid-render would be applied to a step that has already run.
     */
    async select(req, res, { params }) {
      const job = readJob(params.id);

      // The body is drained BEFORE the refusals, even though a 409 does not need
      // it. An HTTP/1.1 response sent while the request body is still arriving
      // leaves the connection in a state the server can only resolve by closing
      // it, so the browser's next request pays for a new one -- and on this page
      // the next request is the poll two seconds later. It is 4 KB at most.
      const body = parseSmallBody(req.headers['content-type'], await readBody(req, 4_096));

      if (job.status !== 'awaiting-selection') {
        throw new HttpError(409, `This job is ${job.status}; there is nothing to choose.`, {
          code: 'NOT_AWAITING_SELECTION',
        });
      }
      if (isClaimed(job.jobId)) {
        throw new HttpError(409, 'A worker is holding this job. Try again in a moment.', {
          code: 'JOB_CLAIMED',
        });
      }

      const raw = body.stillIndex;
      const stillIndex = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
      if (!Number.isInteger(stillIndex)) {
        throw new HttpError(400, 'Pick one of the frames.', { code: 'BAD_STILL_INDEX' });
      }

      // 1-BASED, AND CHECKED AGAINST WHAT IS ACTUALLY ON DISK. Membership in the
      // real index set is strictly stronger than a 1..length range check and
      // cannot be satisfied by a number that names no file. Out of range is a
      // 400 and never a clamp: clamping animates a different frame from the one
      // the person clicked, and produces no error anywhere.
      const available = stillsOf(job.jobId).map((s) => s.index);
      if (!available.includes(stillIndex)) {
        throw new HttpError(400,
          available.length
            ? `Pick a frame between ${available[0]} and ${available[available.length - 1]}.`
            : 'There are no frames to choose from yet.',
          { code: 'STILL_OUT_OF_RANGE', detail: { available } });
      }

      setSelection(job, { stillIndex, chosenBy: 'human' });
      // `awaiting-selection` may only go to running, failed or cancelled
      // (JOB_TRANSITIONS) -- there is no route back to `queued`. `running` is
      // also what stops a double submit: the second one finds a job that is no
      // longer awaiting a selection and gets the 409 it deserves, instead of
      // enqueueing the same render twice.
      setJobStatus(job, 'running');
      saveJob(job);
      queue.enqueue(job.jobId);

      if (wantsHtml(req)) return redirect(res, `/j/${job.jobId}`);
      return sendJson(req, res, 200, { jobId: job.jobId, stillIndex, status: job.status });
    },

    getVideo(req, res, { params, query }) {
      const job = readJob(params.id);
      // `?download=1` and not Accept-sniffing: the same URL is both the <video>
      // source and the download link, and a header that differs between a media
      // element and a navigation is not something to hang a filename on.
      const asAttachment = query?.get('download') === '1';
      if (!sendFile(req, res, {
        file: jobPaths(root, job.jobId).video,
        contentType: 'video/mp4',
        maxAge: 3600,
        download: asAttachment ? `timestamp-${job.jobId}.mp4` : null,
      })) {
        throw new HttpError(404, 'This job has no video yet.', { code: 'NO_VIDEO' });
      }
    },

    getPoster(req, res, { params }) {
      const job = readJob(params.id);
      if (!sendFile(req, res, { file: jobPaths(root, job.jobId).poster, contentType: 'image/jpeg', maxAge: 3600 })) {
        throw new HttpError(404, 'This job has no poster yet.', { code: 'NO_POSTER' });
      }
    },

    /**
     * Cancel.
     *
     * THE SENTINEL IS WRITTEN FIRST AND ALWAYS, AND `cancelJob` IS CALLED ONLY
     * WHEN THE JOB IS PROVABLY UNCLAIMED. If a worker holds the lease it is the
     * manifest's only legitimate writer, and calling `cancelJob` from here would
     * mean two processes writing the same `manifest.json.tmp` -- which does not
     * fail loudly, it corrupts a job. So the web process drops
     * `cancel.requested` and answers 202: the request is recorded, the worker
     * performs the transition between steps, and the status page shows it when
     * it happens. Only when the queue says nobody holds a live lease is there no
     * other writer to race, and only then does this handler transition directly
     * and answer 200.
     *
     * The uploaded photograph is deleted on the direct path, because that is the
     * half of "cancel + purge" this process can honour safely and the consent
     * text promises deletion on request. The manifest stays: it is the cost
     * record the ledger reads, and it holds no image. Scheduled retention
     * deletion is `scripts/render/purge.mjs` and stays there.
     */
    cancelJob(req, res, { params }) {
      const job = readJob(params.id);
      const paths = jobPaths(root, job.jobId);

      // Written before the branch, so a worker that claims the job in the
      // microsecond after `isClaimed` said no still finds the sentinel.
      fs.writeFileSync(paths.cancelRequest, JSON.stringify({
        requestedAt: nowImpl().toISOString(), by: 'web',
      }));

      if (isClaimed(job.jobId)) {
        return sendJson(req, res, 202, {
          jobId: job.jobId,
          status: job.status,
          cancelRequested: true,
          note: 'A worker is rendering this job; it will stop at the next step boundary.',
        });
      }

      const terminal = job.status === 'done' || job.status === 'failed' || job.status === 'cancelled';
      if (!terminal) {
        markCancelled(job, 'cancelled by the person who uploaded it');
        saveJob(job);
      }
      const photosDeleted = purgeUploads(paths);
      return sendJson(req, res, 200, {
        jobId: job.jobId,
        status: job.status,
        cancelRequested: true,
        photosDeleted,
      });
    },
  };

  // -------------------------------------------------------------------------
  // validation helpers
  // -------------------------------------------------------------------------

  /**
   * Shape only. The real gate is `scripts/safety/moderate.mjs` running inside
   * the `moderate` step, where a refusal is a recorded step with a reason rather
   * than an HTTP error a browser eats. What is checked here is only what would
   * otherwise produce a manifest the pipeline is certain to refuse: empty, too
   * long, or a paragraph pasted into a one-line box.
   */
  function cleanText(value, kind, { required }) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text.length === 0) {
      if (!required) return null;
      throw new HttpError(400, kind === 'place'
        ? 'Say where you want to be, or upload a photo of the place.'
        : 'Say what you are wearing.', { code: 'MISSING_TEXT', detail: { kind } });
    }
    if (text.length > 200) {
      throw new HttpError(400, 'Keep it under 200 characters.', { code: 'TEXT_TOO_LONG', detail: { kind } });
    }
    return text;
  }

  /** 1..8 is the provider contract's range. A manifest asking for twelve is a
   *  bill that fails after the first eight have been generated. */
  function cleanStillCount(value) {
    if (value === undefined || value === null || String(value).trim() === '') return 3;
    const n = Number(String(value).trim());
    if (!Number.isInteger(n) || n < 1 || n > 8) {
      throw new HttpError(400, 'Choose between 1 and 8 frames.', { code: 'BAD_STILL_COUNT' });
    }
    return n;
  }

  function purgeUploads(paths) {
    let deleted = 0;
    let names;
    try { names = fs.readdirSync(paths.input); } catch { return 0; }
    for (const name of names) {
      try { fs.rmSync(`${paths.input}/${name}`, { force: true }); deleted += 1; } catch { /* best effort */ }
    }
    return deleted;
  }

  // -------------------------------------------------------------------------
  // dispatch
  // -------------------------------------------------------------------------

  /**
   * The one place a failure becomes bytes.
   *
   * `closeConnection` exists for the refusals that happen while the sender is
   * still uploading. The parser stops reading but does not destroy the socket,
   * precisely so that this function can put a status on it; the socket is then
   * torn down once the response has flushed, because the remaining megabytes are
   * never going to be wanted and keep-alive would sit and wait for them.
   */
  function fail(req, res, status, title, detail, jobId = null, { closeConnection = false } = {}) {
    if (res.headersSent) { res.end(); return; }
    if (closeConnection) {
      res.on('finish', () => { req.socket?.destroy(); });
    }
    const headers = closeConnection ? { Connection: 'close' } : {};
    if (wantsHtml(req)) {
      sendHtml(req, res, status, errorPage({ status, title, detail, jobId }), headers);
      return;
    }
    sendJson(req, res, status, { error: { status, message: title, detail } }, headers);
  }

  async function handler(req, res) {
    const matched = matchRoute(req.method, req.url ?? '/');

    if (!matched.ok) {
      if (matched.status === 405) {
        res.setHeader('Allow', matched.allow.join(', '));
        // OPTIONS is answered here rather than routed, because it is the same
        // answer for every path and a row per route would be fourteen more.
        if (String(req.method).toUpperCase() === 'OPTIONS') {
          res.writeHead(204, { Allow: matched.allow.join(', ') });
          res.end();
          return;
        }
      }
      const titles = { 400: 'That address is not valid.', 404: 'Nothing here.', 405: 'Wrong method for that address.' };
      fail(req, res, matched.status, titles[matched.status] ?? 'Cannot do that.', null);
      return;
    }

    try {
      await handlers[matched.name](req, res, matched);
    } catch (err) {
      if (err instanceof HttpError) {
        fail(req, res, err.status, err.message, null, matched.params?.id ?? null,
          { closeConnection: err.closeConnection });
        return;
      }
      if (err instanceof MultipartError) {
        fail(req, res, err.status, uploadFailureMessage(err), null, null, { closeConnection: true });
        return;
      }
      // Everything else is ours, and the message may contain an absolute path,
      // a manifest fragment or a provider request id. It goes to the log; the
      // caller gets a sentence.
      logImpl(`[web] ${req.method} ${req.url} -> 500 ${err?.stack ?? err}`);
      fail(req, res, 500, 'Something went wrong at our end.', null);
    }
  }

  const server = http.createServer(handler);
  // A stalled upload holds a socket and a file handle. Two minutes is longer
  // than any legitimate 12 MB upload and shorter than "forever".
  server.requestTimeout = 120_000;
  server.headersTimeout = 20_000;

  return {
    handler,
    server,
    get port() {
      const address = server.address();
      return address && typeof address === 'object' ? address.port : null;
    },
    get url() {
      const address = server.address();
      return address && typeof address === 'object' ? `http://${host}:${address.port}` : null;
    },
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server.address().port));
      });
    },
    close() {
      return new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}

/** Multipart failures in the words of somebody who was uploading a photo. */
function uploadFailureMessage(err) {
  switch (err.code) {
    case 'TOO_LARGE':
    case 'PART_TOO_LARGE':
      return 'That upload is too large. Photos can be up to 12 MB.';
    case 'FIELD_TOO_LARGE':
      return 'One of those fields is too long.';
    case 'TRUNCATED':
    case 'ABORTED':
      return 'The upload did not finish. Please try again.';
    default:
      return 'We could not read that upload. Please try again.';
  }
}
