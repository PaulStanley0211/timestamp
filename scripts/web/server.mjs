/**
 * The HTTP layer. The step page, the plans, sign-in, and the JSON API over the
 * job model and the queue.
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
 * WHY EVERY `:id` IS CHECKED TWICE, AND NOW THREE TIMES. `router.mjs` refuses
 * traversal shapes in the path; this file then checks the surviving string
 * against `JOB_ID_RE` -- the strict one exported by `job.mjs`, not the laxer
 * internal `SAFE_ID_RE` -- before any of it reaches `jobPaths`; and then it asks
 * the ownership index whether the signed-in account may see that job at all.
 * Path traversal is not theoretical when strangers can hit this endpoint, and
 * neither is one stranger reading another's job: this application stores
 * photographs of people's faces, so a job route that only checks the id is a
 * route that hands anybody anybody's face for the price of guessing a
 * timestamp.
 *
 * WHY A JOB SOMEBODY ELSE OWNS IS A 404 AND NOT A 403. A 403 confirms the job
 * exists, which is exactly the fact an enumerator is fishing for. Not-yours and
 * not-there are the same answer here on purpose.
 *
 * WHY CREDITS ARE SPENT AT ENQUEUE. The reason is a race: charging when a render
 * finishes lets somebody start twelve jobs in parallel, each of which checks a
 * balance none of them has spent yet. So the order in `createJob` is create ->
 * claim ownership -> debit -> enqueue, and anything that throws part-way unwinds
 * everything before it: the job directory is removed, the ownership entry is
 * released, and the debit is refunded -- which is legitimate here precisely
 * because the job never reached the queue, so no provider was ever called.
 *
 * WHY THE RESOLUTION IS CHECKED AGAINST CONFIG AND NOT AGAINST A LIST. 480p and
 * 720p are on offer and 1080p is not, and all three of those facts live in
 * `config/credits.json` with the measurement attached. Turning 1080p on is one
 * field there and no change here.
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
import { purgeJobMedia } from '../render/purge.mjs';
import { loadCatalog } from '../catalog/catalog.mjs';
import { CONSENT_TEXT, recordConsent } from '../safety/consent.mjs';
import { LIMITS } from '../intake/photo.mjs';
import { runFfprobe } from '../ffmpeg/run.mjs';

/** The repo root, for the assets served off disk. Derived from this module's
 *  own location rather than from cwd, so `npm run web` from anywhere finds them. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..').split(path.sep).join('/');

import { matchRoute, isPublicRoute } from './router.mjs';
import { boundaryFromContentType, parseMultipart, fileSink, MultipartError } from './multipart.mjs';
import { createStylesheet, sendFile } from './static.mjs';
import { aspectIds } from '../tapedeck/frame.mjs';
import { homePage, landingPage, statusPage, selectPage, resultPage, errorPage } from './views.mjs';
import { loginPage, signupPage, pricingPage, authUnavailablePage } from './views-auth.mjs';
import { createSessions, AuthUnavailableError } from './session-middleware.mjs';
import { createRateLimiter } from './rate-limit.mjs';
import { createBilling } from '../billing/billing.mjs';

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

/**
 * The raw upload, before `intake` re-encodes it into `input/photo.jpg`.
 *
 *  Deliberately extension-less. The client's filename is attacker-controlled and
 *  `inspectPhoto` derives the real format from the codec rather than the name,
 *  so an extension here would be a claim nobody checks. `intake` reads this
 *  path out of the manifest and writes the stripped copy beside it. */
const UPLOAD_NAMES = Object.freeze({ photo: 'input/upload-photo', placePhoto: 'input/upload-place' });

const STILL_FILE_RE = /^still-(\d+)\.(png|jpe?g|webp)$/i;

/** `<id>.jpg` under `assets/places/`. The id is matched against the catalog, so
 *  no part of a request ever becomes a path component. */
const PLACE_IMAGE_RE = /^([A-Za-z0-9-]{1,64})\.jpg$/;

/** Routes that never look at a session: two static files, an icon, a card image
 *  and the health check. Keeping them out of the auth path means a missing
 *  `scripts/auth/` still serves the stylesheet, and a load balancer still gets
 *  an answer. */
const NO_SESSION_ROUTES = new Set([
  'stylesheet', 'font', 'favicon', 'placeImage', 'health',
  // STRIPE SENDS NO COOKIE, so resolving a session for it is work that can only
  // fail. Keeping it out of the session path also means a webhook is answered
  // while the sign-in half of the app is degraded -- which matters, because the
  // alternative to answering is Stripe retrying a payment that already
  // happened.
  'stripeWebhook',
]);

/** Routes that look at a session when there is one but must still render when
 *  `scripts/auth/` is unavailable. Exactly one, and it is the plans page: it is
 *  public prose, and 503-ing a marketing page because an unrelated module will
 *  not load is a worse answer than showing it signed-out. `/login` deliberately
 *  is NOT here -- a sign-in form that cannot possibly work should say so before
 *  somebody types a password into it, not after. */
const AUTH_OPTIONAL_ROUTES = new Set(['pricingPage', 'homePage']);

/**
 * How often one address may knock on the two public credential routes.
 *
 * Login is bounded per minute: a person mistypes a password three or four
 * times; only a script needs eleven tries in sixty seconds, and every try
 * costs this process a deliberate ~30ms derivation. Signup is bounded per
 * hour, because accounts are what the free signup grant is spent on and a
 * loop that opens them is spending a budget that never refills.
 *
 * Exported so the tests exercise the same numbers the server enforces rather
 * than a copy that can drift.
 */
export const AUTH_RATE_LIMITS = Object.freeze({
  login: Object.freeze({ max: 10, windowMs: 60_000 }),
  signup: Object.freeze({ max: 10, windowMs: 3_600_000 }),
});

/** How many tapes the shelf renders. A shelf is a page, not an archive dump. */
const SHELF_LIMIT = 60;

/** The tape is exactly fifteen seconds -- 375 frames at 25fps, asserted by
 *  roughly two hundred tests. It is passed to `creditCost` explicitly rather
 *  than left to the config default, so the quote is priced against the contract
 *  and not against whatever the estimator happens to default to. */
const TAPE_SECONDS = 15;

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
    // Every page differs by who is signed in. `no-store` already forbids a
    // shared cache from keeping it, and saying `Vary: Cookie` as well is what
    // stops a proxy that ignores the first header from serving one person's
    // shelf to another.
    Vary: 'Cookie',
    'X-Content-Type-Options': 'nosniff',
    // The pages load nothing from anywhere else -- one same-origin stylesheet,
    // one same-origin font, images and video from this app. Saying so means a
    // successful injection into the place field still cannot exfiltrate.
    // `style-src 'self'` with no `'unsafe-inline'` is why the per-place card
    // gradients are generated into /styles.css instead of onto style attributes.
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; media-src 'self'; "
      + "style-src 'self'; font-src 'self'; script-src 'unsafe-inline'; "
      // `form-action` LISTS STRIPE BECAUSE OF A REDIRECT, NOT A FORM. The buy
      // button posts to this origin; the handler answers 303 to the hosted
      // checkout page, and Chrome checks the redirect target of a form
      // submission against this directive. Without the origin below the browser
      // blocks the navigation and the button silently does nothing. It is one
      // https origin, it is Stripe's own checkout host, and no page here posts
      // to it directly.
      + "form-action 'self' https://checkout.stripe.com; base-uri 'none'; frame-ancestors 'none'",
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : html);
}

function redirect(res, to, status = 303, headers = {}) {
  res.writeHead(status, { Location: to, 'Cache-Control': 'no-store', ...headers });
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
 * Read a small request body with the cap enforced as it arrives, for the
 * endpoints that take one. Same discipline as the multipart parser and for the
 * same reason: checking the size after buffering is not a check.
 */
function readRawBody(req, maxBytes = 8_192) {
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
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * The same read, decoded.
 *
 * EVERY CALLER BUT ONE WANTS THIS, and the one that does not is the Stripe
 * webhook. Stripe signs the exact bytes it sent, so a handler that verifies a
 * signature has to hash what arrived on the socket -- `toString('utf8')` is
 * the identity on well-formed utf8 and quietly is not on anything else, and
 * "quietly is not" over somebody's payment is not a risk worth taking for a
 * convenience. `readRawBody` is therefore the primitive and this is the
 * wrapper, rather than the other way round.
 */
async function readBody(req, maxBytes = 8_192) {
  return (await readRawBody(req, maxBytes)).toString('utf8');
}

/** JSON or `application/x-www-form-urlencoded`, because the contact sheet and
 *  the sign-in form are plain forms. Neither is more real than the other. */
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

/**
 * Where to send somebody after they sign in.
 *
 * ONLY A SAME-ORIGIN ABSOLUTE PATH. `next=https://evil.example` on a login page
 * is the textbook open redirect: the link is genuinely ours, the login is
 * genuinely ours, and the landing page is not. `//evil.example` is the same
 * attack spelled protocol-relative, which is why the second character is
 * checked as well as the first, and a backslash is checked because some clients
 * normalise `/\evil.example` into `//evil.example`.
 */
export function safeNext(value) {
  const next = String(value ?? '');
  if (!next.startsWith('/')) return '';
  if (next.length > 512) return '';
  if (next[1] === '/' || next[1] === '\\') return '';
  if (next.includes('\\') || /[\x00-\x1f]/.test(next)) return '';
  return next;
}

/** The first of several form fields that actually has text in it. The step cards
 *  post a preset id; the "or describe it" box posts free text; a person who does
 *  both meant the card they clicked. */
function firstFilled(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

// ---------------------------------------------------------------------------
// the server
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.root      data root; `out/jobs`, `out/queue`, `out/accounts` live under it
 * @param {object} opts.cfg       config/render.json as loaded
 * @param {object} opts.queue     a Queue from scripts/queue/queue.mjs
 * @param {number} [opts.port]    0 means "any free port", which is what tests want
 * @param {object} [opts.catalog] injected; defaults to the shipped preset menu
 * @param {string} [opts.provider] provider id recorded on every new job
 * @param {object} [opts.auth]    injected `scripts/auth/` surface; omit to import it lazily
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
  auth = null,
  sessions = null,
  /**
   * The Stripe seam. Defaulted to a billing object WITH NO TRANSPORT AND NO
   * CREDENTIALS, which is guard 4: a server built by a test can read the pack
   * table out of config -- so the pricing page is the real page -- and cannot
   * spend, because `createCheckoutSession` would raise a `TypeError` before it
   * reached a socket. `server-cli.mjs` is the one caller that hands over a
   * real transport.
   */
  billing = createBilling(),
  /**
   * Where this app is reachable from, for the two urls Stripe redirects a
   * customer back to.
   *
   * NOT DERIVED FROM THE `Host` HEADER, and that is the point of the option.
   * A success url built out of a request header is a success url an attacker
   * can choose, and it is handed to Stripe to navigate a browser to. Absent, it
   * falls back to this server's own bound address, which is right for local
   * development and wrong in a way that is visible in deployment rather than
   * exploitable.
   */
  publicUrl = process.env.TIMESTAMP_PUBLIC_URL || null,
  assetsRoot = `${REPO_ROOT}/assets`,
  nowImpl = () => new Date(),
  logImpl = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('createServer needs a root');
  }
  if (!queue || typeof queue.enqueue !== 'function') {
    throw new TypeError('createServer needs a queue (scripts/queue/queue.mjs)');
  }

  const auths = sessions ?? createSessions({ root, auth });

  /**
   * One limiter per credential route, keyed by the SOCKET address and never by
   * a header. `x-forwarded-for` is whatever the client typed, so keying on it
   * hands every script its own unlimited lane. Behind a proxy the socket
   * address collapses every visitor into one key, which throttles everybody
   * together -- the failure direction that costs patience rather than the
   * giveaway budget, until a proxy is actually part of the deployment.
   */
  const limiters = {
    login: createRateLimiter({ ...AUTH_RATE_LIMITS.login, nowImpl }),
    signup: createRateLimiter({ ...AUTH_RATE_LIMITS.signup, nowImpl }),
  };

  /**
   * A post that says where it came from must say here. Browsers put the
   * posting page's origin on every form submission; a value naming another
   * site is a cross-site post whatever else it carries. ABSENCE PASSES --
   * non-browser clients name nothing, and the anti-forgery token below still
   * gates them -- so this is the cheap early layer, not the proof.
   */
  function sameOriginPost(req) {
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    try {
      return new URL(origin).host === String(req.headers.host ?? '');
    } catch {
      // 'null' and anything else unparseable: an opaque origin is not this one.
      return false;
    }
  }

  /**
   * The 403 for a credential post that did not prove it came from this site's
   * own form. The HTML answer is the form again, carrying a fresh pair, so the
   * person a stale tab belongs to is one submit away from signed in -- the
   * forger gets the same page and can do nothing with it.
   */
  async function refuseForgery(req, res, which, extras = {}) {
    const message = 'We could not confirm that came from this site. Please try again below.';
    const { token, setCookie } = await auths.csrfIssue(req);
    const headers = setCookie ? { 'Set-Cookie': setCookie } : {};
    if (wantsHtml(req)) {
      const page = which === 'login'
        ? loginPage({ error: message, csrf: token, ...extras })
        : signupPage({ error: message, csrf: token, consentText, ...extras });
      return sendHtml(req, res, 403, page, headers);
    }
    return sendJson(req, res, 403, { error: { status: 403, message, code: 'NOT_FROM_THIS_SITE' } }, headers);
  }

  /** True when the 429 has been sent and the handler must stop. Decided before
   *  the body is read: the refusal must not depend on -- or reveal -- anything
   *  about what was being attempted. */
  function refuseOverLimit(req, res, which, page) {
    const key = req.socket?.remoteAddress ?? 'unknown';
    const { allowed, retryAfterS } = limiters[which].check(key);
    if (allowed) return false;
    const message = which === 'login'
      ? 'Too many sign-in attempts from your connection. Please wait a minute and try again.'
      : 'Too many new accounts from your connection. Please try again later.';
    const headers = { 'Retry-After': String(retryAfterS) };
    if (wantsHtml(req)) sendHtml(req, res, 429, page({ error: message }), headers);
    else sendJson(req, res, 429, { error: { status: 429, message } }, headers);
    return true;
  }

  // A DEFAULT PARAMETER ONLY FIRES ON `undefined`, and every other injectable
  // seam in this signature is spelled `= null` -- so somebody passing
  // `billing: null` by analogy would get a `TypeError` from inside a handler
  // rather than a working server with no checkout. One line, and it makes the
  // two spellings mean the same thing.
  const sales = billing ?? createBilling();

  // Loaded once, at construction. A preset file that fails validation should
  // stop the server coming up, not produce a 500 on the first page view.
  const menu = catalog ?? loadCatalog();

  /**
   * The cards are rendered FROM the preset files. There is deliberately no
   * second copy of the menu in this repo: adding a place is adding a JSON file,
   * and the carousel, the background layer, the generated CSS and the preset
   * lookup all pick it up from the same load.
   */
  const cards = {
    places: [...menu.places.values()].map((p) => ({ id: p.id, label: p.label, timeOfDay: p.timeOfDay })),
    outfits: [...menu.outfits.values()].map((o) => ({ id: o.id, label: o.label, wardrobe: o.wardrobe })),
  };
  const placeIds = new Set(cards.places.map((p) => p.id));

  /**
   * The stylesheet carries a rule per preset AND per resolution -- the card
   * image with its warm gradient underneath, the full-bleed background layer,
   * the `:checked` styling, and the cost line that follows the quality
   * selection. Generated rather than inlined onto elements so `style-src 'self'`
   * can stay exactly as strict as it was.
   *
   * BUILT ON FIRST REQUEST, NOT AT CONSTRUCTION, because the resolution rows
   * come from `scripts/auth/` and reading them is async. Only a successful build
   * is cached: if the credits module is unavailable the sheet is still served,
   * without the quality rules, and the next request tries again -- a stylesheet
   * that 500s takes every page down with it, including the sign-in page that
   * would explain what is wrong.
   */
  let sheetCache = null;
  async function stylesheet() {
    if (sheetCache) return sheetCache;
    let resolutions = [];
    let complete = false;
    try {
      resolutions = await resolutionRows();
      complete = true;
    } catch (err) {
      logImpl(`[web] stylesheet built without the quality rules: ${err?.message ?? err}`);
    }
    const built = createStylesheet({ ...cards, resolutions, aspects: aspectRows() });
    if (complete) sheetCache = built;
    return built;
  }

  /** label and id both map back to the id, so a card ("Allotment garden, late
   *  August") is recognised as the preset it came from rather than being
   *  treated as free text and sent through `expand` to be re-derived. */
  const presetLookup = { place: new Map(), outfit: new Map() };
  for (const p of cards.places) {
    presetLookup.place.set(p.id.toLowerCase(), p.id);
    presetLookup.place.set(p.label.toLowerCase(), p.id);
  }
  for (const o of cards.outfits) {
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
   * The only way a handler gets a job.
   *
   * Shape, then ownership, then disk -- in that order, so a guessed id that
   * belongs to somebody else never causes a read. The answer for a job this
   * account does not own is byte-for-byte the answer for a job that does not
   * exist.
   */
  function ownedJob(account, id) {
    requireJobId(id);
    if (!account || !auths.ownsJob({ accountId: account.accountId, jobId: id })) {
      throw new HttpError(404, 'No such job.', { code: 'NO_JOB' });
    }
    return readJob(id);
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

  /** A preset id is not a label. The manifest stores the id, which is what the
   *  pipeline needs; the page shows what the person actually picked. Free text
   *  has no entry and falls through as itself. */
  function labelsOf(job) {
    const place = job.input?.place?.value ?? null;
    const outfit = job.input?.outfit?.value ?? null;
    return {
      place: cards.places.find((p) => p.id === place)?.label ?? place,
      outfit: cards.outfits.find((o) => o.id === outfit)?.label ?? outfit,
    };
  }

  /**
   * The shelf.
   *
   * Read from the ownership index rather than by scanning `out/jobs`, so it is
   * one `readdir` plus a manifest read per tape this account actually owns. A
   * manifest that will not parse is skipped: one broken job must not empty
   * somebody's shelf.
   */
  function shelfFor(account) {
    if (!account) return [];
    const out = [];
    for (const jobId of auths.jobIdsFor(account.accountId).slice(0, SHELF_LIMIT)) {
      let job;
      try {
        job = loadJob({ root, jobId, nowImpl, cfg });
      } catch {
        continue;
      }
      out.push({
        jobId,
        status: job.status,
        place: labelsOf(job).place ?? '',
        posterUrl: job.result?.posterPath ? `/api/jobs/${jobId}/poster` : null,
        href: job.status === 'done' ? `/j/${jobId}/result` : `/j/${jobId}`,
      });
    }
    return out;
  }

  /** `{credits, planId}`, or a zeroed stand-in. Never throws into a page render:
   *  a shelf that will not display because a balance lookup failed is a worse
   *  failure than a shelf that displays with a conservative number -- and zero is
   *  the conservative direction, because it disables the button rather than
   *  enabling a render nobody can pay for. */
  async function balanceOf(account) {
    try {
      const b = await auths.balance(account);
      const planId = b?.planId ?? account?.plan ?? 'free';
      return {
        credits: Number(b?.credits ?? 0),
        planId,
        expiresAt: b?.expiresAt ?? null,
        // What a full period looks like for this plan, so the meter has
        // something to be a fraction OF. A bare credit count answers "how many"
        // and never "how far through", which is the question a person actually
        // has. Resolved through the auth module rather than read from config
        // here, for the reason the quality row is: one copy of the plan table.
        perPeriod: await planAllowance(planId),
        // The cheapest thing that can currently be ordered. Below this the
        // balance is not low, it is spent -- nothing can be rendered at all --
        // and the meter says so in a different colour rather than showing a
        // sliver that looks like it might be enough.
        cheapest: await cheapestOffer(),
      };
    } catch (err) {
      if (err instanceof AuthUnavailableError) throw err;
      logImpl(`[web] balance lookup failed: ${err?.message ?? err}`);
      return {
        credits: 0, planId: account?.plan ?? 'free', expiresAt: null,
        perPeriod: 0, cheapest: 0,
      };
    }
  }

  /** The plan's period grant, or 0 when the plan is unknown. Never throws: the
   *  meter degrades to "no ring, just a number" rather than taking the page. */
  async function planAllowance(planId) {
    try {
      const mod = await auths.api();
      return Number(mod.PLANS?.[planId]?.creditsPerPeriod ?? 0);
    } catch {
      return 0;
    }
  }

  /** The lowest credit price among the resolutions actually on offer. */
  async function cheapestOffer() {
    try {
      const offered = (await resolutionRows()).filter((r) => r.available);
      return offered.reduce((min, r) => (min === null || r.credits < min ? r.credits : min), null) ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * The quality row, straight out of `config/credits.json`.
   *
   * NOT A LIST WRITTEN DOWN HERE. 1080p is off today because that file says
   * `available: false` with the measurement attached; turning it on later is
   * that field and nothing else, and this function does not need to change for
   * it. Cached for a minute so that a page view is not three JSON reads, and
   * only for a minute so an operator editing the config sees it without a
   * restart.
   */
  let resolutionCache = { at: 0, rows: null };
  /**
   * The shapes, straight out of `config/render.json`.
   *
   * A shape is offered as a CHOICE only when the renderer can finish it, which
   * today is the default shape alone. The other two are declared `available:
   * false` in the config beside the reason, so switching one on is a config
   * change in the same commit that gives it a `delivery` block -- never an edit
   * here.
   */
  function aspectRows() {
    return aspectIds(cfg).map((id) => ({
      id,
      available: id === cfg.defaultAspect || cfg.aspects?.[id]?.available === true,
    }));
  }

  async function resolutionRows() {
    const now = Date.now();
    if (resolutionCache.rows && now - resolutionCache.at < 60_000) return resolutionCache.rows;
    const rows = await auths.resolutions();
    resolutionCache = { at: now, rows };
    return rows;
  }

  /**
   * Which option starts selected.
   *
   * 720p when it is on offer: it is the first resolution that fully covers the
   * tape's 736x588 raster, so nothing is thrown away, and 1080p buys nothing
   * above it (SSIM 0.958, measured). Falling back to the config default and then
   * to whatever is left means switching 720p off is still a config change rather
   * than a code change.
   */
  const PREFERRED_RESOLUTION = '720p';
  async function defaultResolution() {
    const offered = (await resolutionRows()).filter((r) => r.available);
    if (offered.some((r) => r.id === PREFERRED_RESOLUTION)) return PREFERRED_RESOLUTION;
    return offered[0]?.id ?? null;
  }

  /** The cost of one tape at this resolution, in credits. Fifteen seconds is not
   *  a default so much as the contract -- 375 frames at 25fps. */
  async function costOf(resolution) {
    return auths.cost({ resolution, seconds: TAPE_SECONDS });
  }

  // -------------------------------------------------------------------------
  // money
  // -------------------------------------------------------------------------

  /**
   * Where Stripe sends a customer back to.
   *
   * BUILT FROM CONFIGURATION AND FROM THIS SERVER'S OWN SOCKET, NEVER FROM THE
   * REQUEST. The `Host` header is whatever the client typed, and a success url
   * derived from it is a url an attacker chooses and Stripe navigates a browser
   * to. There is no header read anywhere in this function on purpose.
   */
  function publicBase() {
    if (publicUrl) return String(publicUrl).replace(/\/+$/, '');
    const address = server.address();
    const bound = address && typeof address === 'object' ? address.port : port;
    return `http://${host}:${bound}`;
  }

  /**
   * The packs, for the page. Degrades to nothing rather than taking the page
   * down, for the same reason the plans do: `/pricing` is public prose and a
   * module that will not load is not a reason to 503 it.
   *
   * `stripePriceId` is mapped to a boolean here and never rendered. A price id
   * is not a secret, but it is also not something a page needs, and the rule
   * that the browser never holds a price is easier to keep when there is no
   * copy of one in the HTML.
   */
  async function packRows() {
    try {
      return (await sales.packs()).map((pack) => ({
        id: pack.id,
        label: pack.label,
        priceUSD: pack.priceUSD,
        credits: pack.credits,
        available: pack.available,
        buyable: pack.available && typeof pack.stripePriceId === 'string' && pack.stripePriceId.length > 0,
      }));
    } catch (err) {
      logImpl(`[web] the packs could not be read: ${err?.message ?? err}`);
      return [];
    }
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

    /**
     * Two pages behind one path.
     *
     * Signed out, this is the landing page and it is built from the preset
     * catalog alone -- no balance is looked up, no shelf is read, no upload
     * form is rendered. That is deliberate and it is what makes the route safe
     * to have on the public allow-list: the anonymous branch cannot leak
     * account data because it never touches any.
     */
    async homePage(req, res, { account }) {
      if (!account) {
        return sendHtml(req, res, 200, landingPage({ places: cards.places }));
      }
      const [balance, resolutions, resolution] = await Promise.all([
        balanceOf(account), resolutionRows(), defaultResolution(),
      ]);
      sendHtml(req, res, 200, homePage({
        places: cards.places,
        outfits: cards.outfits,
        resolutions,
        resolution,
        aspects: aspectRows(),
        consentText,
        balance,
        account,
        tapes: shelfFor(account),
      }));
    },

    async stylesheet(req, res) { (await stylesheet()).send(req, res); },

    font(req, res) {
      const file = `${assetsRoot}/fonts/tape-osd.ttf`;
      if (!sendFile(req, res, { file, contentType: 'font/ttf', maxAge: 86_400 })) {
        throw new HttpError(404, 'Not found.', { code: 'NO_FONT' });
      }
    },

    favicon(req, res) { res.writeHead(204); res.end(); },

    /**
     * The place photographs, when they exist.
     *
     * `assets/places/` is empty today. A 404 here is the designed state, not a
     * fault: the card's `background-image` lists the photograph first and the
     * warm gradient second, so a layer that fails to load is simply not painted
     * and the gradient shows through. The page is finished on a fresh clone and
     * the real images drop in with no code change.
     *
     * The id is resolved by MEMBERSHIP in the loaded catalog, so no byte of the
     * request is ever concatenated into a path.
     */
    placeImage(req, res, { params }) {
      const m = PLACE_IMAGE_RE.exec(String(params.file ?? ''));
      const id = m ? m[1] : null;
      if (!id || !placeIds.has(id)) {
        throw new HttpError(404, 'No such place image.', { code: 'NO_PLACE_IMAGE' });
      }
      if (!sendFile(req, res, {
        file: `${assetsRoot}/places/${id}.jpg`, contentType: 'image/jpeg', maxAge: 86_400,
      })) {
        throw new HttpError(404, 'No such place image.', { code: 'NO_PLACE_IMAGE' });
      }
    },

    statusPage(req, res, { params, account }) {
      const job = ownedJob(account, params.id);
      if (job.status === 'done') return redirect(res, `/j/${job.jobId}/result`);
      if (job.status === 'awaiting-selection') return redirect(res, `/j/${job.jobId}/select`);
      return sendHtml(req, res, 200, statusPage({ view: jobView(job), account, labels: labelsOf(job) }));
    },

    selectPage(req, res, { params, account }) {
      const job = ownedJob(account, params.id);
      if (job.status !== 'awaiting-selection') return redirect(res, `/j/${job.jobId}`);
      const stills = stillsOf(job.jobId).map((s) => ({
        index: s.index,
        url: `/api/jobs/${job.jobId}/stills/${s.index}`,
      }));
      return sendHtml(req, res, 200, selectPage({ view: jobView(job), stills, account }));
    },

    resultPage(req, res, { params, account }) {
      const job = ownedJob(account, params.id);
      if (job.status !== 'done') return redirect(res, `/j/${job.jobId}`);
      return sendHtml(req, res, 200, resultPage({ view: jobView(job), account, labels: labelsOf(job) }));
    },

    // --- accounts --------------------------------------------------------

    async loginPage(req, res, { query, account }) {
      if (account) return redirect(res, safeNext(query?.get('next')) || '/');
      const { token, setCookie } = await auths.csrfIssue(req);
      return sendHtml(req, res, 200, loginPage({ next: safeNext(query?.get('next')), csrf: token }),
        setCookie ? { 'Set-Cookie': setCookie } : {});
    },

    async signupPage(req, res, { query, account }) {
      if (account) return redirect(res, safeNext(query?.get('next')) || '/');
      const { token, setCookie } = await auths.csrfIssue(req);
      return sendHtml(req, res, 200, signupPage({ next: safeNext(query?.get('next')), consentText, csrf: token }),
        setCookie ? { 'Set-Cookie': setCookie } : {});
    },

    /**
     * Sign in.
     *
     * ONE MESSAGE FOR BOTH FAILURES. "No such account" and "wrong password" are
     * different facts and the same answer, because the difference between them
     * is a free account-enumeration oracle on a site that stores photographs of
     * people's faces.
     */
    async login(req, res) {
      if (refuseOverLimit(req, res, 'login', loginPage)) return undefined;
      if (!sameOriginPost(req)) return refuseForgery(req, res, 'login');
      const body = parseSmallBody(req.headers['content-type'], await readBody(req, 4_096));
      const email = String(body.email ?? '').trim();
      const password = String(body.password ?? '');
      const next = safeNext(body.next);
      const csrf = String(body.csrf ?? '');

      // BEFORE the credentials are looked at. A post that cannot prove it came
      // from this site's own form gets no opinion on whether a password was
      // right, and no work spent finding out.
      if (!(await auths.csrfCheck(req, csrf))) return refuseForgery(req, res, 'login', { email, next });

      const mod = await auths.api();
      let account = null;
      let refusal = null;
      try {
        // `authenticate` answers an unknown email and a wrong password with the
        // same error, the same sentence and the same amount of work. Its message
        // is rendered unchanged -- an "improvement" that told them apart would
        // turn this form into an account-enumeration oracle on a site that
        // stores photographs of people's faces.
        account = await mod.authenticate({ root, email, password });
      } catch (err) {
        account = null;
        refusal = err?.userMessage ?? null;
      }
      if (!account) {
        const message = refusal ?? 'That email and password do not match an account.';
        // The token that just verified is rendered back, so the retry the
        // person is about to make still carries a valid pair.
        if (wantsHtml(req)) return sendHtml(req, res, 401, loginPage({ error: message, email, next, csrf }));
        return sendJson(req, res, 401, { error: { status: 401, message } });
      }

      const cookie = await auths.startSession(req, account.accountId);
      if (wantsHtml(req)) return redirect(res, next || '/', 303, { 'Set-Cookie': cookie });
      return sendJson(req, res, 200, { accountId: account.accountId, next: next || '/' }, { 'Set-Cookie': cookie });
    },

    async signup(req, res) {
      if (refuseOverLimit(req, res, 'signup', (opts) => signupPage({ ...opts, consentText }))) return undefined;
      if (!sameOriginPost(req)) return refuseForgery(req, res, 'signup');
      const body = parseSmallBody(req.headers['content-type'], await readBody(req, 4_096));
      const email = String(body.email ?? '').trim();
      const password = String(body.password ?? '');
      const next = safeNext(body.next);
      const csrf = String(body.csrf ?? '');

      // Same gate, same order as login: the post proves where it came from
      // before anything it says is acted on.
      if (!(await auths.csrfCheck(req, csrf))) return refuseForgery(req, res, 'signup', { email, next });

      const reject = (message) => {
        // The verified token rides along on every refusal, so the corrected
        // form still submits.
        const html = signupPage({ error: message, email, next, consentText, csrf });
        if (wantsHtml(req)) return sendHtml(req, res, 400, html);
        return sendJson(req, res, 400, { error: { status: 400, message } });
      };

      // Shape only. A real address is proved by a mail round trip, which this
      // build does not do; refusing something that is obviously not an address
      // is still worth the two lines.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return reject('That does not look like an email address.');
      }
      if (password.length < 10) {
        return reject('Please use at least ten characters.');
      }
      if (!CONSENT_YES.has(String(body.consent ?? '').trim().toLowerCase())) {
        return reject('Please confirm the statement before creating an account.');
      }

      const mod = await auths.api();
      let account;
      try {
        account = await mod.createAccount({ root, email, password });
      } catch (err) {
        // `AuthError` carries `.userMessage` by contract; anything else is ours
        // and gets a sentence rather than a stack trace.
        const message = err?.userMessage ?? 'That account could not be created.';
        logImpl(`[web] signup failed: ${err?.stack ?? err}`);
        return reject(message);
      }

      const cookie = await auths.startSession(req, account.accountId);
      if (wantsHtml(req)) return redirect(res, next || '/', 303, { 'Set-Cookie': cookie });
      return sendJson(req, res, 201, { accountId: account.accountId }, { 'Set-Cookie': cookie });
    },

    /** Destroys the server-side record as well as the cookie. That is the whole
     *  reason sessions are opaque ids rather than JWTs: a token cannot be
     *  revoked, and this app can hand somebody else's face to whoever holds one. */
    async logout(req, res) {
      const cookie = await auths.endSession(req);
      if (wantsHtml(req)) return redirect(res, '/login', 303, { 'Set-Cookie': cookie });
      return sendJson(req, res, 200, { ok: true }, { 'Set-Cookie': cookie });
    },

    /**
     * The plans.
     *
     * NO PAYMENT FORM, HERE OR ANYWHERE. `docs/interfaces-app.md` A: card
     * handling never touches this code, and when it is wired it goes through a
     * hosted checkout. `plan` is set by an operator or a future webhook.
     */
    async pricingPage(req, res, { account, query }) {
      let plans = [];
      let resolutions = [];
      try {
        const mod = await auths.api();
        plans = Object.values(mod.PLANS ?? {});
        resolutions = await resolutionRows();
      } catch (err) {
        if (!(err instanceof AuthUnavailableError)) throw err;
        // The plans are prose. A page that cannot name them is worth serving
        // empty rather than 503-ing a public marketing page.
        plans = [];
        resolutions = [];
      }
      const balance = account ? await balanceOf(account) : null;
      sendHtml(req, res, 200, pricingPage({
        plans,
        resolutions,
        packs: await packRows(),
        currentPlan: account?.plan ?? null,
        account,
        balance,
        // WHERE STRIPE SENDS SOMEBODY BACK TO, AND IT GRANTS NOTHING. This is a
        // query parameter on a public page: anybody can type it, so it may
        // change what the page SAYS and may never change what an account HAS.
        // The credits arrive on the webhook, which is a different request with
        // a signature on it.
        checkout: query?.get('checkout') ?? null,
      }));
    },

    /**
     * Buy a pack.
     *
     * THE BROWSER SENDS A PACK ID AND NOTHING ELSE. Any other field in the body
     * is read by nothing -- there is no amount, no credit count and no price in
     * this handler's vocabulary, so a tampered form has nothing to tamper with.
     * The pack is resolved against `config/credits.json` and the Price id comes
     * from there.
     *
     * IT GRANTS NOTHING, and neither does the page Stripe returns to. The only
     * thing in this application that adds credits is `stripeWebhook` below.
     */
    async checkout(req, res, { account }) {
      const body = parseSmallBody(req.headers['content-type'], await readBody(req, 4_096));

      let pack;
      try {
        pack = await sales.packFor(String(body.pack ?? ''));
      } catch (err) {
        if (err?.name !== 'PackError') throw err;
        // 400: the caller named something we do not sell. The code travels so a
        // client can tell "no such pack" from "withdrawn".
        throw new HttpError(400, err.userMessage ?? 'That is not something we sell.', { code: err.code });
      }

      let session;
      try {
        session = await sales.createCheckoutSession({
          priceId: pack.stripePriceId,
          accountId: account.accountId,
          packId: pack.id,
          credits: pack.credits,
          successUrl: `${publicBase()}/pricing?checkout=done`,
          cancelUrl: `${publicBase()}/pricing?checkout=cancelled`,
        });
      } catch (err) {
        if (err?.name !== 'StripeError') throw err;
        // A PACK WITH NO PRICE IS A 503 AND NOT A 400, because the gap is ours.
        // The customer asked for something real and the immutable object it
        // needs has not been created yet -- section 7 of the spec -- so the
        // honest answer is "not yet", not "you asked wrong".
        if (err.code === 'NO_PRICE_ID' || err.code === 'NO_API_KEY') {
          logImpl(`[web] checkout unavailable: ${err.message}`);
          throw new HttpError(503, 'Checkout is not open yet.', { code: 'CHECKOUT_NOT_OPEN' });
        }
        // Everything else is Stripe refusing us, not the customer. The detail
        // goes to the log; the caller gets a sentence and a 502, because the
        // failure is upstream of this application.
        logImpl(`[web] stripe refused a checkout session: ${err.message}`);
        throw new HttpError(502, 'We could not start checkout. Please try again.', { code: 'CHECKOUT_FAILED' });
      }

      if (wantsHtml(req)) return redirect(res, session.url);
      return sendJson(req, res, 200, { url: session.url, sessionId: session.id });
    },

    /**
     * The only thing in this application that adds credits.
     *
     * NO SESSION, AND A STRONGER GATE THAN ONE. The request is authenticated by
     * an HMAC-SHA256 over the exact bytes that arrived, keyed by a secret only
     * Stripe and this server hold, and it is rejected if the signature is
     * timestamped outside a five-minute window. Replay protection and
     * idempotency are separate concerns and both are here: the window stops a
     * captured request being sent again later, and the ledger's `ref` -- the
     * Stripe event id -- stops Stripe's own legitimate retries from paying
     * twice.
     *
     * WHAT THE STATUS CODES MEAN TO STRIPE, WHICH IS THE ONLY READER. A 2xx
     * means "handled, stop retrying". Everything else means "try again", for up
     * to three days, and then it appears on the failed-events list where a
     * person can see it. So an event this product does not care about gets a
     * 200 and an event that could not be honoured gets a 5xx -- and NEVER the
     * other way round, because a 200 on a payment we failed to credit is money
     * taken with the evidence thrown away.
     */
    async stripeWebhook(req, res) {
      // 64 KiB. Stripe's own limit on an event payload is far below this and a
      // webhook is not an upload endpoint; the cap is here because every other
      // body in this file has one.
      const raw = await readRawBody(req, 64 * 1024);

      let event;
      try {
        event = sales.constructWebhookEvent({
          payload: raw,
          header: req.headers['stripe-signature'],
          nowImpl,
        });
      } catch (err) {
        if (err?.name !== 'StripeError') throw err;
        // A MISSING SECRET IS OURS AND A BAD SIGNATURE IS THEIRS, and the two
        // must not share a status. 503 keeps the event in Stripe's retry queue
        // until the secret is configured; 400 says this request was never
        // Stripe's to begin with.
        const status = err.code === 'NO_WEBHOOK_SECRET' ? 503 : 400;
        logImpl(`[web] stripe webhook refused (${err.code}): ${err.message}`);
        return sendJson(req, res, status, {
          error: { status, message: 'That webhook could not be verified.', code: err.code },
        });
      }

      // THE MODE IS CHECKED BEFORE ANY FIELD IS ACTED ON. The signature above
      // proves Stripe sent these bytes; it does not prove money moved, because
      // a test-mode event is signed exactly as honestly as a live one and a
      // test card costs its holder nothing. Credits buy real renders at real
      // provider cost, so nothing is paid out unless the event says, itself,
      // that it is live -- and absence is not a yes: an event that does not
      // carry the field is treated like a test one. 200, because Stripe did
      // nothing wrong and must not retry.
      if (event.livemode !== true) {
        return sendJson(req, res, 200, { ok: true, granted: false, ignored: 'testmode' });
      }

      // ONE EVENT, BECAUSE THERE IS ONE PACK. Everything else is acknowledged
      // so Stripe stops retrying events this product does not act on.
      if (event.type !== 'checkout.session.completed') {
        return sendJson(req, res, 200, { ok: true, granted: false, ignored: event.type });
      }
      const session = event.data?.object ?? {};
      if (session.payment_status !== 'paid') {
        // A completed session that was not paid is a real Stripe event and not
        // a payment. Acknowledged, and nothing granted.
        return sendJson(req, res, 200, { ok: true, granted: false, ignored: 'unpaid' });
      }

      const accountId = typeof session.client_reference_id === 'string' && session.client_reference_id.length > 0
        ? session.client_reference_id
        : session.metadata?.accountId;
      if (typeof accountId !== 'string' || accountId.length === 0) {
        logImpl(`[web] STRIPE EVENT ${event.id} IS A PAID SESSION WITH NO ACCOUNT ON IT -- credit it by hand`);
        return sendJson(req, res, 500, {
          error: { status: 500, message: 'That payment names no account.', code: 'NO_ACCOUNT_ON_SESSION' },
        });
      }

      let grant;
      try {
        grant = await sales.grantForSession(session);
      } catch (err) {
        if (err?.name !== 'PackError') throw err;
        logImpl(`[web] STRIPE EVENT ${event.id} CANNOT BE PRICED (${err.code}): ${err.message} -- credit it by hand`);
        return sendJson(req, res, 500, {
          error: { status: 500, message: 'That payment could not be priced.', code: err.code },
        });
      }
      if (grant.mismatch) {
        // Not a refusal. The customer is paid what they were promised, and the
        // discrepancy is written where somebody will find it.
        logImpl(`[web] stripe event ${event.id}: pack ${grant.packId} promised ${grant.credits} CR and config says otherwise`);
      }

      const account = await auths.accountById(accountId);
      if (!account) {
        // MONEY TAKEN AND NOWHERE TO PUT IT. A 200 here would make the event
        // vanish; a 500 keeps it retrying and then leaves it on Stripe's failed
        // list, which is the only place a person would ever go looking.
        logImpl(`[web] STRIPE EVENT ${event.id} PAID FOR ACCOUNT ${accountId}, WHICH DOES NOT EXIST`);
        return sendJson(req, res, 500, {
          error: { status: 500, message: 'That payment names no account we hold.', code: 'NO_SUCH_ACCOUNT' },
        });
      }

      // THE LEDGER WRITE LANDS BEFORE THE 200. A 200 sent first would tell
      // Stripe to stop retrying the one thing that matters.
      const result = await auths.grant(account, {
        credits: grant.credits,
        reason: `grant:pack:${grant.packId ?? 'unknown'}`,
        // The Stripe event id. A redelivery finds this ref already in the
        // ledger and is a no-op rather than a second payout.
        ref: event.id,
      });

      return sendJson(req, res, 200, {
        ok: true,
        granted: result.granted === true,
        credits: grant.credits,
      });
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
     * Create a job. Writes a manifest, claims it for the account, consumes a
     * tape from the quota, enqueues a pointer, returns 201.
     *
     * NOTHING IS AWAITED HERE EXCEPT THE UPLOAD ITSELF. The only slow thing in
     * this handler is reading the bytes the client is already sending.
     */
    async createJob(req, res, { account }) {
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

      // Read before a byte is accepted, so somebody who cannot afford anything is
      // refused before they spend two minutes uploading. The authoritative debit
      // still happens at enqueue, below, against the resolution they actually
      // picked -- this is only the cheap early no.
      const rows = await resolutionRows();
      const offered = rows.filter((r) => r.available);
      const cheapest = offered.reduce((min, r) => (min === null || r.credits < min ? r.credits : min), null);
      const before = await balanceOf(account);
      if (cheapest === null || before.credits < cheapest) {
        throw new HttpError(402, 'Not enough credits for a tape.', { code: 'INSUFFICIENT_CREDITS' });
      }

      // The id is minted before the body is read so the uploads can stream
      // straight into the directory they belong in. Nothing else knows about
      // this id yet, so a failed upload takes the whole directory with it.
      const jobId = newJobId({ now: nowImpl });
      const paths = jobPaths(root, jobId);
      fs.mkdirSync(`${paths.dir}/input`, { recursive: true });

      const hashes = new Map();
      const discard = { write: () => true, end: async () => ({ bytes: 0, discarded: true }), abort: async () => {} };
      let claimed = false;
      let debited = false;
      let createdJob = null;

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

        // `place` is the card (a preset id, or empty for "use my own place");
        // `placeText` is the "or describe it" box. The card wins, because a
        // person who did both meant the one they clicked.
        const placeText = cleanText(firstFilled(fields.place, fields.placeText), 'place', {
          required: placePhoto === null,
        });
        const outfitText = cleanText(firstFilled(fields.outfit, fields.outfitText), 'outfit', { required: true });
        const stillCount = cleanStillCount(fields.stillCount);

        const placeId = placeText ? presetLookup.place.get(placeText.toLowerCase()) ?? null : null;
        const outfitId = presetLookup.outfit.get(outfitText.toLowerCase()) ?? null;

        // MEMBERSHIP IN THE AVAILABLE SET, not a shape check. An unavailable
        // resolution is refused rather than quietly downgraded: silently
        // rendering something the person did not ask for, at a price they did
        // not see, is the one failure mode on this endpoint that is worse than
        // an error.
        const resolution = firstFilled(fields.resolution) || (await defaultResolution());
        if (!offered.some((r) => r.id === resolution)) {
          throw new HttpError(400, 'That output size is not available.', {
            code: 'BAD_RESOLUTION', detail: { available: offered.map((r) => r.id) },
          });
        }
        // SAME RULE FOR THE SHAPE. Membership in the offered set, refused rather
        // than downgraded. A shape that is merely SHOWN on the page has no
        // radio, so it cannot arrive here from the form at all -- but this
        // endpoint takes hand-written POSTs too, and "it isn't in the HTML" has
        // never been a check.
        const aspect = firstFilled(fields.aspect) || cfg.defaultAspect;
        if (!aspectRows().some((a) => a.available && a.id === aspect)) {
          throw new HttpError(400, 'That frame shape is not available.', {
            code: 'BAD_ASPECT', detail: { available: aspectRows().filter((a) => a.available).map((a) => a.id) },
          });
        }

        const credits = await costOf(resolution);
        if (before.credits < credits) {
          throw new HttpError(402,
            `Not enough credits — a ${resolution} tape costs ~${credits} CR and you have ${before.credits} CR.`,
            { code: 'INSUFFICIENT_CREDITS', detail: { credits, balance: before.credits } });
        }

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
          aspect,
          // What was charged for, carried where the worker can actually read it.
          // `normalizeInput` used to drop unknown fields, which is why ownership
          // went to a side index and the resolution had nowhere to go at all --
          // the manifest is the ONLY channel between this process and the
          // renderer. It now carries both, so a user who paid 152 CR for 720p
          // gets 720p asked of the provider instead of whatever the default was.
          // That was a billing bug wearing a rendering bug's clothes.
          resolution,
          accountId: account.accountId,
          // The out/owners index stays, and stays authoritative for lookup --
          // finding "every job belonging to this account" by scanning every
          // manifest is the wrong shape. This is the durable record; that is
          // the index over it.
          consent: recordConsent({ granted: true, text: consentText, nowImpl }),
        };

        // Created BEFORE it is enqueued. A pointer to a job with no manifest is
        // the one state this system cannot recover from (job.mjs says so), and
        // this ordering is what makes it impossible.
        const job = createJob({ root, jobId, input, provider, cfg, nowImpl });
        createdJob = job;

        // Ownership BEFORE the queue, because a worker that starts instantly
        // and a user who reloads instantly both need the answer to already be
        // on disk. `job.input` cannot carry it: `normalizeInput` returns a
        // fixed shape and silently drops fields it does not know, so an
        // accountId written there would vanish on the worker's first save.
        auths.claimJob({
          accountId: account.accountId, jobId: job.jobId, at: nowImpl().toISOString(), resolution, credits,
        });
        claimed = true;

        // AT ENQUEUE, not at completion. See the header comment. `debitCredits`
        // is idempotent by jobId, so a retry of this request is the same render
        // rather than a second charge.
        await auths.debit(account, { jobId: job.jobId, credits });
        debited = true;
        queue.enqueue(job.jobId);

        if (wantsHtml(req)) return redirect(res, `/j/${job.jobId}`);
        return sendJson(req, res, 201, {
          jobId: job.jobId,
          statusUrl: `/j/${job.jobId}`,
          apiUrl: `/api/jobs/${job.jobId}`,
          resolution,
          credits,
        }, { Location: `/j/${job.jobId}` });
      } catch (err) {
        // A half-made directory holding a stranger's photograph and no manifest
        // is invisible to `listJobs`, invisible to purge, and never cleaned up.
        try { fs.rmSync(paths.dir, { recursive: true, force: true }); } catch { /* best effort */ }
        if (debited) {
          // The job never reached the queue, so no provider was ever called and
          // this is exactly the case a refund is for. `refundIfUnspent` reads the
          // manifest's steps and decides that for itself rather than taking this
          // handler's word for it; a job that failed AFTER spending is not
          // refunded, because the money is gone.
          await auths.refund(account, { jobId, job: createdJob, reason: 'refund:never-enqueued' });
        }
        if (claimed) {
          try { auths.releaseJob({ accountId: account.accountId, jobId }); } catch { /* best effort */ }
        }
        // OUR OWN REFUSALS PASS STRAIGHT THROUGH. They already carry the exact
        // sentence -- "a 720p tape costs ~152 CR and you have 100 CR" -- and the
        // code-mapping below would otherwise catch one of them by its `code` and
        // replace it with the generic version of itself.
        if (err instanceof HttpError) throw err;
        if (err instanceof MultipartError) {
          // The body was abandoned mid-stream, so this response has to be the
          // last thing on the connection.
          throw new HttpError(err.status, uploadFailureMessage(err), {
            code: err.code, closeConnection: true,
          });
        }
        // The credits module's refusal, raised by `debitCredits` at the moment of
        // enqueue. The job directory has already been removed above, so nothing
        // was created and there is nothing left to refund.
        if (err?.code === 'INSUFFICIENT_CREDITS' || err?.code === 'BAD_CREDITS') {
          throw new HttpError(402, err?.userMessage ?? 'Not enough credits for that tape.', {
            code: 'INSUFFICIENT_CREDITS',
          });
        }
        if (err?.code === 'UNKNOWN_RESOLUTION' || err?.code === 'UNKNOWN_TIER'
          || err?.code === 'RESOLUTION_UNAVAILABLE') {
          throw new HttpError(400, err?.userMessage ?? 'That output size is not available.', {
            code: 'BAD_RESOLUTION',
          });
        }
        throw err;
      }
    },

    getJob(req, res, { params, account }) {
      sendJson(req, res, 200, jobView(ownedJob(account, params.id)));
    },

    listStills(req, res, { params, account }) {
      const job = ownedJob(account, params.id);
      sendJson(req, res, 200, {
        jobId: job.jobId,
        stills: stillsOf(job.jobId).map((s) => ({
          index: s.index,
          url: `/api/jobs/${job.jobId}/stills/${s.index}`,
        })),
        selected: job.selection?.stillIndex ?? null,
      });
    },

    getStill(req, res, { params, account }) {
      const job = ownedJob(account, params.id);
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
    async select(req, res, { params, account }) {
      const job = ownedJob(account, params.id);

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

    getVideo(req, res, { params, query, account }) {
      const job = ownedJob(account, params.id);
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

    getPoster(req, res, { params, account }) {
      const job = ownedJob(account, params.id);
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
     * EVERYTHING THAT CAN HOLD A FACE is deleted on the direct path -- the
     * upload, the generated stills, the contact sheet, the segments, the source,
     * the video and the poster -- because the consent text promises deletion on
     * request and a face survives in four places besides `input/`. That gap was
     * `docs/security-review-2026-08-21.md` F2, whose one-line summary was that
     * there is no endpoint in this application that deletes a finished video.
     * The set lives in `purgeJobMedia` rather than here, so this handler and the
     * worker's claimed path cannot drift into deleting different things.
     *
     * The manifest stays: it is the cost record, and it holds no image.
     * Scheduled retention deletion is the other half of the same module.
     *
     * The ownership entry stays too. A cancelled job is still this account's
     * job, it still appears on the shelf, and removing the entry would make the
     * cost record unreachable by the only person entitled to see it.
     */
    async cancelJob(req, res, { params, account }) {
      const job = ownedJob(account, params.id);
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
        // This branch is reached precisely when the queue says nobody ever
        // held a lease, so no provider was asked for anything and the debit
        // from enqueue bought nothing. Same call the create handler's catch
        // makes: `refundIfUnspent` reads the manifest's steps and declines on
        // its own if a paid step somehow ran, so this site needs no judgement
        // -- only the decency to ask.
        await auths.refund(account, {
          jobId: job.jobId, job, reason: 'refund:cancelled-before-provider',
        });
      }
      // REPORTED, NOT ASSUMED. `purgeJobMedia` returns what it could not delete
      // -- an unlink refused while `getVideo` streams the same file is EBUSY on
      // Windows, and answering a flat 200 to that told a person their face was
      // gone when it was still on disk. The status stays 200 because the cancel
      // itself succeeded; `mediaDeleted` is the field that carries the part that
      // may not have.
      const { photosDeleted, filesDeleted, errors } = purgeJobMedia(paths);
      if (errors.length) {
        logImpl(`purge on ${job.jobId} could not remove ${errors.length} file(s): `
          + errors.map((e) => `${e.path} (${e.code ?? 'unknown'})`).join(', '));
      }
      return sendJson(req, res, 200, {
        jobId: job.jobId,
        status: job.status,
        cancelRequested: true,
        photosDeleted,
        filesDeleted,
        mediaDeleted: errors.length === 0,
        errors,
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
        ? 'Pick a place, describe one, or upload a photo of it.'
        : 'Pick a look, or describe what you are wearing.', { code: 'MISSING_TEXT', detail: { kind } });
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
  function fail(req, res, status, title, detail, jobId = null, { closeConnection = false, code = null } = {}) {
    if (res.headersSent) { res.end(); return; }
    if (closeConnection) {
      res.on('finish', () => { req.socket?.destroy(); });
    }
    const headers = closeConnection ? { Connection: 'close' } : {};
    if (wantsHtml(req)) {
      sendHtml(req, res, status, errorPage({ status, title, detail, jobId }), headers);
      return;
    }
    // THE CODE TRAVELS WHEN THERE IS ONE. A message is prose and gets reworded;
    // a code is what a caller branches on, and `unauthenticated` has always sent
    // one. Omitted rather than sent as null when a thrower did not name a code,
    // so the envelope does not grow a field that is always empty.
    sendJson(req, res, status, {
      error: { status, message: title, detail, ...(code ? { code } : {}) },
    }, headers);
  }

  /**
   * Not signed in.
   *
   * A browser is sent to `/login` carrying where it was going, so the round trip
   * ends where it started. Everything else gets a 401, because a JSON client
   * following a 303 to an HTML login form and parsing it as a job payload is a
   * worse failure than a status code it can branch on.
   */
  function unauthenticated(req, res, matched) {
    if (wantsHtml(req)) {
      const next = safeNext(matched.pathname);
      return redirect(res, next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login');
    }
    return sendJson(req, res, 401, {
      error: { status: 401, message: 'Sign in first.', code: 'NOT_SIGNED_IN' },
    });
  }

  async function handler(req, res) {
    const matched = matchRoute(req.method, req.url ?? '/');

    if (!matched.ok) {
      if (matched.status === 405) {
        res.setHeader('Allow', matched.allow.join(', '));
        // OPTIONS is answered here rather than routed, because it is the same
        // answer for every path and a row per route would be twenty more.
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

    // Who is asking. Resolved once per request, before any handler runs, so a
    // handler cannot forget to ask -- and never resolved at all for the five
    // routes that are files, which is what keeps the stylesheet serving when
    // `scripts/auth/` is not on disk.
    let account = null;
    if (!NO_SESSION_ROUTES.has(matched.name)) {
      try {
        account = await auths.currentAccount(req);
      } catch (err) {
        if (err instanceof AuthUnavailableError) {
          if (AUTH_OPTIONAL_ROUTES.has(matched.name)) {
            account = null;
          } else {
            logImpl(`[web] scripts/auth/ is not available (${err.cause?.message ?? 'no reason given'}); account routes are 503`);
            if (wantsHtml(req)) sendHtml(req, res, 503, authUnavailablePage());
            else sendJson(req, res, 503, { error: { status: 503, message: 'Accounts are not available.', code: 'AUTH_UNAVAILABLE' } });
            return;
          }
        } else {
          throw err;
        }
      }
    }

    if (!isPublicRoute(matched.name) && !account) {
      unauthenticated(req, res, matched);
      return;
    }

    try {
      await handlers[matched.name](req, res, { ...matched, account });
    } catch (err) {
      if (err instanceof HttpError) {
        fail(req, res, err.status, err.message, null, matched.params?.id ?? null,
          { closeConnection: err.closeConnection, code: err.code });
        return;
      }
      if (err instanceof AuthUnavailableError) {
        if (wantsHtml(req)) sendHtml(req, res, 503, authUnavailablePage());
        else sendJson(req, res, 503, { error: { status: 503, message: 'Accounts are not available.', code: 'AUTH_UNAVAILABLE' } });
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
    sessions: auths,
    /** The menu the cards are rendered from, so a test can assert the page is
     *  built out of `presets/` rather than out of a second copy. */
    cards,
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
