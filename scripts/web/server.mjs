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
import {
  homePage, landingPage, statusPage, selectPage, resultPage, videosPage, errorPage, INLINE_SCRIPT_HASHES,
  privacyPage, termsPage, impressumPage,
} from './views.mjs';
// The ONE fact the web layer takes from the provider layer: whether a provider
// spends money. `contract.mjs` is a leaf -- no transport, no credential -- and
// a graph test in provider-contract.test.js pins that this import pulls in
// nothing more. A paid provider means DIRECT MODE: the customer's four choices
// become one reference-to-video call, and the still stage does not exist.
import { PAID_PROVIDER_IDS } from '../providers/contract.mjs';
import {
  loginPage, signupPage, pricingPage, authUnavailablePage, verifyPage, identityUnavailablePage,
  resetPage, resetCompletePage, onboardingPage, accountPage,
} from './views-auth.mjs';
import { deleteAccountEverywhere, DeletionError } from '../auth/deletion.mjs';
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
/** `<id>.jpg` or `<id>.mp4` under `assets/places/`. The id charset excludes a
 *  dot on purpose, so a second suffix cannot be smuggled through the capture
 *  and the extension is always exactly one of the two named here. */
const PLACE_MEDIA_RE = /^([A-Za-z0-9-]{1,64})\.(jpg|mp4)$/;

/** Routes that never look at a session: two static files, an icon, a card image
 *  and the health check. Keeping them out of the auth path means a missing
 *  `scripts/auth/` still serves the stylesheet, and a load balancer still gets
 *  an answer. */
const NO_SESSION_ROUTES = new Set([
  'stylesheet', 'font', 'favicon', 'placeImage', 'robots',
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
const AUTH_OPTIONAL_ROUTES = new Set([
  'pricingPage', 'homePage',
  // Public prose, but the nav should still say who is signed in.
  'privacyPage', 'termsPage', 'impressumPage',
  // Public for the uptime monitor, which sends no cookie and gets `ok` and
  // `degraded`; the full report goes to a session. It used to sit in
  // NO_SESSION_ROUTES so a degraded accounts module could not take health
  // down with it -- optional keeps that property (the route answers with
  // `account: null`) while letting an operator's cookie unlock the detail.
  'health',
]);

/**
 * How often one address may knock on the public credential routes.
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
  // `/auth/google` is the one unauthenticated route in this file that writes
  // to disk on every hit -- a verifier and a state, under `out/oauth/`, which
  // nothing sweeps yet (task 2's `sweepOAuth` is wired later). The CSRF pair
  // that gates it is a stateless, unexpiring double-submit value, so one
  // `GET /login` buys an unbounded number of these posts without it. Same
  // shape and same number as `login`: both are per-connection, credential-
  // adjacent routes.
  google: Object.freeze({ max: 10, windowMs: 60_000 }),
  // Spec §4.5. Per IP; the per-code and per-address bounds are separate and
  // stricter, because an IP is cheap and a code must die at five. This one
  // exists to stop somebody cycling ADDRESSES -- which the per-address bound
  // cannot see, because each address is on its first attempt.
  verify: Object.freeze({ max: 20, windowMs: 3_600_000 }),
  reset: Object.freeze({ max: 5, windowMs: 3_600_000 }),
});

/**
 * Wrong answers before a code is dead rather than throttled. Spec §4.5.
 *
 * A six-digit code is one million values with an hour to live, and a script
 * making a few hundred guesses a second walks that space inside the window.
 * Nothing else about the code flow is a control; this number is the whole of
 * it, which is why it is a named export the tests read rather than a literal
 * five somewhere in a handler.
 */
export const CODE_MAX_ATTEMPTS = 5;

/**
 * How long a dead code's address stays dead. Spec §4.5's per-address bound.
 *
 * Equal to the code's own life, so a person who exhausts their guesses waits
 * exactly as long as the code they were guessing at would have lasted, and an
 * attacker gets five guesses per code rather than five per code plus five more
 * for every resend they can trigger.
 */
export const CODE_COOLOFF_MS = 60 * 60 * 1000;

/** Where the per-address attempt counters live, under the data root. */
export const VERIFY_ATTEMPTS_DIR = 'out/verify-attempts';

/**
 * The one sentence a refused code gets, whatever actually happened.
 *
 * A CONSTANT, NEVER DERIVED FROM THE ERROR, and that is the entire point.
 * Supabase distinguishes a wrong code, an expired code and an address that
 * never signed up; rendering any of those tells a stranger whether the address
 * they typed is real, on a service that stores photographs of people's faces.
 * Spec §4.3 and §4.5. `SupabaseAuthError.userMessage` carries the same
 * guarantee but says "email and password", which is the wrong sentence in
 * front of a six-digit field -- so this is its sibling for this page and not a
 * second policy.
 */
export const CODE_REFUSED_MESSAGE = 'That code is not right, or it has expired. Ask for a new one below.';

/**
 * What the page says after a resend, whatever actually happened upstream.
 *
 * "If" is doing real work in that first word, and it is not hedging. Supabase
 * answers a resend for an unknown address, an already-confirmed address, and
 * one asked for twice inside its own sixty-second window all differently, and
 * rendering any of those tells a stranger which addresses have accounts here.
 * The conditional is what lets one honest sentence cover every case: it never
 * claims a mail was sent, and it never denies it either.
 */
export const RESEND_SENT_MESSAGE = 'If that address is waiting to be confirmed, a new code is on its way. It can take a minute to arrive.';

/** What a dead code says. Distinct from the refusal above and free to be,
 *  because it discloses nothing a caller does not already know: they made the
 *  attempts themselves, and an address that never signed up reaches this
 *  message on exactly the same schedule as one that did. */
export const CODE_EXHAUSTED_MESSAGE = 'Too many attempts on that code. Ask for a new one in an hour.';

/** Shown on `/login` after `/auth/reset/complete` succeeds. Reached only via
 *  this server's own redirect, never from user input, so it is safe to state
 *  plainly rather than defensively. */
export const RESET_DONE_NOTICE = 'Your password has been changed. Every device was signed out — sign in again with your new password.';

/**
 * The one sentence every failure of the Google round trip gets, whatever
 * actually happened -- a `state` this server never issued, one already
 * spent, an exchange Supabase refused, or a resolution that could not
 * complete. A FIXED CONSTANT, never derived from the error, for the same
 * reason `CODE_REFUSED_MESSAGE` is: `SupabaseAuthError` carries `.code`,
 * `.status` and `.message`, and account errors can carry `.accountId` --
 * none of it may reach a response or a page.
 */
export const OAUTH_FAILED_MESSAGE = 'That sign-in did not complete. Please try signing in with Google again.';

/** One shape check for an address, used by every route that takes one, so the
 *  two cannot drift into disagreeing about what an address is. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isAddressShaped = (email) => EMAIL_SHAPE.test(email) && email.length <= 254;

/**
 * The attempt counter, keyed on the hash of the address.
 *
 * WHY A FILE AND NOT A MAP. The counter must survive the restart an attacker
 * can provoke, and it is the only thing standing between a six-digit secret
 * and a script. `rate-limit.mjs` is in memory on purpose -- forgetting its
 * counters costs one window of patience -- and forgetting these would hand
 * back the entire guess budget.
 *
 * WHY KEYED ON `emailHash` AND NOT THE ADDRESS. The same reason `accounts.mjs`
 * and `pending-signup.mjs` hash theirs: a directory named after the addresses
 * currently mid-signup is a list of them, readable by filename alone. It also
 * closes the casing bypass for free, because `emailHash` normalises before it
 * hashes, so `A@B.com` and ` a@b.COM ` spend the same five guesses.
 */
function attemptFile(root, hash) {
  // `emailHash` always returns 64 lowercase hex characters. The regex is here
  // for the same reason `pending-signup.mjs` has one: a filename built from
  // anything other than a validated shape is a path a future caller could feed
  // something unexpected into.
  if (!/^[0-9a-f]{64}$/.test(String(hash ?? ''))) return null;
  return path.join(root, VERIFY_ATTEMPTS_DIR, `${hash}.json`);
}

/**
 * Spend one of the five, and say whether there was one to spend.
 *
 * COUNTED BEFORE THE UPSTREAM CALL, NEVER AFTER. Counting on the way back
 * means a crash, a timeout or a killed process resets the count, and an
 * attacker who can provoke any of those has an unlimited retry budget. It also
 * means a dead code costs no upstream request, so this endpoint cannot be used
 * as a free relay against Supabase's own limiter.
 *
 * THE READ-MODIFY-WRITE IS SYNCHRONOUS ON PURPOSE. There is no `await` between
 * the read and the write, so two concurrent requests in this process cannot
 * interleave and both see four. Across two processes sharing one root it is
 * not atomic; that is named in the task report rather than pretended away, and
 * the per-IP limiter in front bounds what such a race could be worth.
 *
 * @returns {{allowed: boolean, attempts: number}}
 */
export function chargeCodeAttempt({ root, hash, nowImpl = () => new Date() }) {
  const file = attemptFile(root, hash);
  // An unusable key cannot be counted against, so it is refused rather than
  // waved through: the alternative is an uncounted lane.
  if (!file) return { allowed: false, attempts: CODE_MAX_ATTEMPTS };

  const nowMs = nowImpl().getTime();
  let row = null;
  let corrupt = false;
  try {
    row = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    // ENOENT is "nobody has tried yet" and is the ordinary first attempt.
    // Anything else is a file that exists and cannot be read, and a counter
    // that cannot be read must FAIL CLOSED -- a torn write that reads back as
    // zero attempts is five free guesses. It is rewritten as exhausted so the
    // cool-off applies and the address heals itself in an hour rather than
    // being locked out of the flow permanently.
    if (err?.code !== 'ENOENT') corrupt = true;
    row = null;
  }

  const firstMs = Date.parse(row?.firstAt ?? '');
  const live = Number.isFinite(firstMs) && nowMs - firstMs < CODE_COOLOFF_MS;
  // The window is anchored at the FIRST attempt and is never extended by a
  // refusal. Extending it would let anybody keep a stranger's address locked
  // out forever simply by continuing to knock.
  const firstAt = live ? row.firstAt : new Date(nowMs).toISOString();
  const attempts = corrupt
    ? CODE_MAX_ATTEMPTS
    : (live && Number.isInteger(row.attempts) ? row.attempts : 0);

  if (attempts >= CODE_MAX_ATTEMPTS) {
    if (corrupt) writeAttempts(file, { attempts: CODE_MAX_ATTEMPTS, firstAt });
    return { allowed: false, attempts };
  }
  writeAttempts(file, { attempts: attempts + 1, firstAt });
  return { allowed: true, attempts: attempts + 1 };
}

/** Temp-then-rename, so a process that dies mid-write leaves the old count
 *  rather than a truncated file. `pending-signup.mjs` writes the same way. */
function writeAttempts(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(row), 'utf8');
  fs.renameSync(tmp, file);
}

/** Forget the attempts against one address. Called ONLY on a confirmed code:
 *  a resend must not clear this, or five guesses plus a resend is ten. */
export function clearCodeAttempts({ root, hash }) {
  const file = attemptFile(root, hash);
  if (!file) return;
  try { fs.unlinkSync(file); } catch { /* nothing to clear */ }
}

/**
 * Drop counters whose cool-off has passed.
 *
 * A counter is meaningless once its window has expired -- `chargeCodeAttempt`
 * already ignores it -- so what is left is litter, one small file per address
 * anybody ever typed here. Written to the same shape as `sweepPending` and
 * `sweepOAuth`: returns how many it removed, survives a row disappearing
 * underneath it, and treats an unreadable row as removable rather than as a
 * reason to stop. Like both of those it is not yet called from anywhere; the
 * three want wiring together, beside `sweepExpiredSessions`.
 */
export function sweepVerifyAttempts({ root, nowImpl = () => new Date() } = {}) {
  const dir = path.join(root, VERIFY_ATTEMPTS_DIR);
  let names;
  try { names = fs.readdirSync(dir); } catch { return 0; }
  const nowMs = nowImpl().getTime();
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    let expired = true;
    try {
      const row = JSON.parse(fs.readFileSync(file, 'utf8'));
      const firstMs = Date.parse(row?.firstAt ?? '');
      expired = !Number.isFinite(firstMs) || nowMs - firstMs >= CODE_COOLOFF_MS;
    } catch (err) {
      // A row that cannot be read cannot be trusted to bound anything, and
      // `chargeCodeAttempt` rewrites it as exhausted on the next attempt, so
      // removing it here loses nothing a caller was relying on.
      if (err?.code === 'ENOENT') continue;
    }
    if (!expired) continue;
    try {
      fs.unlinkSync(file);
      removed += 1;
    } catch { /* somebody else's sweep, or a confirmation, got there first */ }
  }
  return removed;
}

/**
 * How often the identity litter gets swept -- one file per `POST
 * /auth/google` (`out/oauth`), one per started signup awaiting its code
 * (`out/pending-signups`), and one per address that has ever guessed at a
 * verification code (`out/verify-attempts`). All three write to the SAME
 * volume that holds job media and rendered tapes, and none of the three sweep
 * functions -- `sweepOAuth`, `sweepPending`, `sweepVerifyAttempts` -- had ever
 * been called from anywhere before this.
 *
 * SAME CADENCE AS THE WORKER'S OWN RETENTION SWEEP
 * (`DEFAULT_RETENTION_SWEEP_MS` in `scripts/worker/worker.mjs`), on purpose --
 * that number is already this codebase's answer to "how often does a
 * long-lived process re-check its own litter", and picking a second one here
 * would be a second answer to a question already settled. Exported so a test
 * can pin the two constants to each other rather than to a duplicated
 * literal.
 */
export const IDENTITY_SWEEP_MS = 3_600_000;

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

/**
 * The headers every response carries, whatever its type.
 *
 * `Referrer-Policy: no-referrer` is the load-bearing one today: a job url is
 * `/j/<id>` and the id is the only thing keeping a face's status page out of
 * a stranger's hands, so it must never ride out in `Referer` when somebody
 * follows a link off a page. The HSTS header is ignored over plain HTTP by
 * specification, so sending it unconditionally costs local development
 * nothing and is already right on the day there is TLS -- deployment must not
 * depend on somebody remembering to add it.
 */
const BASE_SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000',
});

/**
 * The script policy names the two scripts this product ships, each by the
 * hash of its exact bytes, and admits nothing else. 'unsafe-inline' named no
 * scripts and therefore admitted all of them -- including one an injection
 * just wrote -- which made the directive decorative. The hashes come from
 * views.mjs, where the scripts live as constants, so an edited script
 * re-hashes itself and a forgotten one fails the test that hashes what the
 * page actually shipped.
 */
const SCRIPT_SRC = INLINE_SCRIPT_HASHES.map((hash) => `'sha256-${hash}'`).join(' ');

function sendJson(req, res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...BASE_SECURITY_HEADERS,
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
    ...BASE_SECURITY_HEADERS,
    // A document that never wants the camera, the microphone or the location
    // should say so; a page on a face-video service asking for the camera is
    // exactly the shape a phishing overlay takes. And this app is one origin
    // talking to itself, so nothing may open it into a shared browsing group
    // -- COOP costs nothing here and closes the window-handle channel.
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // The pages load nothing from anywhere else -- one same-origin stylesheet,
    // one same-origin font, images and video from this app. Saying so means a
    // successful injection into the place field still cannot exfiltrate.
    // `style-src 'self'` with no `'unsafe-inline'` is why the per-place card
    // gradients are generated into /styles.css instead of onto style attributes,
    // and `script-src` names the two shipped scripts by hash for the same
    // reason -- see SCRIPT_SRC above.
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; media-src 'self'; "
      + `style-src 'self'; font-src 'self'; script-src ${SCRIPT_SRC}; `
      // `form-action` LISTS STRIPE AND SUPABASE BECAUSE OF A REDIRECT, NOT A
      // FORM. The buy button posts to this origin; the handler answers 303 to
      // the hosted checkout page, and Chrome checks the redirect target of a
      // form submission against this directive. Without the origin below the
      // browser blocks the navigation and the button silently does nothing.
      // `POST /auth/google` is the same shape: it posts here and 303s to
      // Supabase's own `/auth/v1/authorize`, on whatever project this
      // deployment is configured against -- `https://*.supabase.co` covers
      // that without this file needing to know the project ref. Neither
      // origin is ever posted to directly.
      // AND THE CHAIN DOES NOT STOP AT SUPABASE -- THIS IS THE HOP THAT WAS
      // MISSING, AND IT COST A DAY. Supabase's `/auth/v1/authorize` does not
      // render the consent screen itself; it answers 302 to Google's. Chrome
      // checks EVERY target in the chain, so leaving `accounts.google.com` out
      // blocked the submission before any request left the browser -- the
      // button did nothing at all, no entry in the network panel, nothing in
      // the server log. Node enforces no CSP, so every probe from Node saw a
      // healthy `302 -> accounts.google.com` and the failure was attributed to
      // a 503 from Supabase that this endpoint never sent. Verified from a
      // real browser on 2026-08-27, which is the only place this is visible.
      + "form-action 'self' https://checkout.stripe.com https://*.supabase.co https://accounts.google.com; "
      + "base-uri 'none'; frame-ancestors 'none'",
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
        // PAUSE, NOT DESTROY, and it is the same ruling `multipart.mjs` writes
        // out at length: a destroyed socket cannot carry an HTTP status, so
        // destroying here meant the catch that writes this refusal was writing
        // onto a socket that no longer existed. The sender saw a connection
        // reset instead of "that body is too large", and a refusal nobody can
        // read is indistinguishable from a broken server -- for Stripe, from
        // an endpoint that is simply down.
        //
        // The socket still has to close, because the rest of the body is never
        // going to be wanted and keep-alive would sit waiting for it. That is
        // `closeConnection`'s job, once the response has flushed.
        req.pause();
        reject(new HttpError(413, 'Request body is too large.', {
          code: 'BODY_TOO_LARGE', closeConnection: true,
        }));
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

/**
 * The path part of a Referer, for working out where a gated POST came FROM.
 *
 * A REFERER IS A HEADER A CLIENT CHOOSES, so nothing here trusts it: the return
 * value goes straight through `safeNext`, which admits only a same-origin
 * absolute path, so the worst a forged Referer buys is a redirect to another
 * page of this application. The query and hash are dropped rather than
 * preserved -- a return path is a destination, and carrying somebody's old
 * query string into a fresh page is how a `?checkout=done` ends up on a url it
 * was never issued for.
 *
 * Absent, cross-origin and unparseable all answer '', which `safeNext` turns
 * into the plain `/login` that the caller already handles.
 */
function refererPath(referer, host) {
  const raw = String(referer ?? '');
  if (raw === '') return '';
  // SENTINEL, NOT A REAL BASE. A relative Referer resolves against it and keeps
  // this host; an absolute one replaces it. So "did the host survive?" is
  // exactly the question "was this Referer same-origin or relative?", and it is
  // asked below rather than assumed.
  const SENTINEL = 'http://referer.invalid';
  let url;
  try {
    url = new URL(raw, SENTINEL);
  } catch {
    return '';
  }
  const ours = String(host ?? '');
  const sameOrigin = url.host === new URL(SENTINEL).host || (ours !== '' && url.host === ours);
  return sameOrigin ? url.pathname : '';
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

/**
 * Who is selling, reduced to exactly the four fields the pages render -- or
 * `null` with a reason, which is the operator placeholder.
 *
 * IT IS AN ALLOW-LIST AND NEVER A SPREAD, for the reason the account export in
 * the deletion work is one: a key added to the entity config must not be able
 * to ride into a render nobody designed. Four fields go in, four come out.
 *
 * AND IT REFUSES A PARTIAL ENTITY, which guards a failure that was previously
 * invisible: `h()` renders null and undefined as the EMPTY STRING, so an entity
 * with no `email` did not print "undefined" on the Impressum -- it printed
 * nothing at all, leaving a contact block that looks deliberate and is missing
 * the one thing a disclosure page exists to carry. Half-configured is refused
 * so the placeholder (which is honest) shows instead, and the reason is
 * returned so the caller can name the field in a log.
 *
 * The email test is deliberately only "has an @": this value is typed by the
 * operator into their own `.env`, it is escaped like everything else, and a
 * stricter pattern here would refuse valid addresses for no gain.
 */
export function normaliseLegalEntity(raw) {
  const refuse = (reason) => ({ entity: null, reason });
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return refuse('it is not a JSON object');
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name === '') return refuse('name is missing or blank');

  const email = typeof raw.email === 'string' ? raw.email.trim() : '';
  if (email === '') return refuse('email is missing or blank');
  if (!email.includes('@')) return refuse('email does not look like an address');

  if (!Array.isArray(raw.addressLines) || raw.addressLines.length === 0) {
    return refuse('addressLines is missing or empty');
  }
  const addressLines = raw.addressLines.map((line) => (typeof line === 'string' ? line.trim() : ''));
  if (addressLines.some((line) => line === '')) {
    return refuse('addressLines contains a blank or non-string line');
  }

  const vatId = raw.vatId ?? null;
  if (vatId !== null && (typeof vatId !== 'string' || vatId.trim() === '')) {
    return refuse('vatId must be a non-empty string or null');
  }

  return { entity: { name, addressLines, email, vatId: vatId === null ? null : vatId.trim() }, reason: null };
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
  /** How the health endpoint reads free space under `root`. A seam for the
   *  same reason `ffprobeImpl` is one: the test that proves "low disk pages"
   *  must not need a full disk to run. */
  statfsImpl = fs.statfsSync,
  /** Who is selling, for the legal pages. Defaults to config/legal.json,
   *  whose `entity: null` is the designed state until the owner decides the
   *  selling entity -- the pages render an operator placeholder rather than
   *  the routes not existing, because a privacy policy is owed before the
   *  entity question is settled. A seam so tests can pin both states. */
  legal = null,
  /**
   * The same entity as a one-line JSON object, out of `.env` -- and the route
   * an operator should prefer, because a sole trader's disclosure address IS
   * their home address and a public repository's history is permanent in a way
   * a taken-down page is not.
   *
   * `.env` and not a config file because that channel already exists end to
   * end: `.gitignore` covers it (`.env.*`), `.dockerignore` keeps it out of the
   * image, compose passes it into both containers with `env_file`, and the
   * runbook already has the operator writing it `chmod 600`. A new
   * `config/legal.local.json` would need a bind mount that none of that has.
   *
   * It closes the GIT half only. The pages still publish the address while the
   * site is live, which is what they are for.
   */
  legalEntityJson = process.env.TIMESTAMP_LEGAL_ENTITY || null,
  // The image classifier a photograph passes through, as it should read on
  // /privacy. Declared rather than derived because §51E gives the AWS
  // credentials to the WORKER and this process never sees them -- so the
  // worker refuses to start when it holds keys this declaration does not
  // account for (scripts/safety/image-moderate-aws.mjs). Null is off, and
  // off is the shipped state.
  imageProcessor = process.env.TIMESTAMP_IMAGE_PROCESSOR || null,
  /**
   * Whether search engines may index this site. DEFAULT FALSE, and the default
   * is the whole point.
   *
   * The Impressum carries an address at which documents can be served, so for
   * a sole trader it is a home address. `.env` keeps that out of the public
   * repository; this keeps it out of Google until the operator chooses to be
   * public. "Do not share the URL" is not a substitute: Caddy issues a
   * certificate on first boot and a certificate puts the hostname into public
   * Certificate Transparency logs that crawlers watch, so the site is
   * discoverable from the first TLS handshake whether or not anybody linked it.
   *
   * FORGETTING THIS IN EITHER DIRECTION HAS VERY DIFFERENT COSTS, which is why
   * the safe value is the default rather than the documented one. Left off by
   * mistake, the site gets no search traffic -- visible, and fixable any day.
   * Left ON by mistake, a home address is indexed and archived, and that cannot
   * be withdrawn. The recoverable failure is the one that gets to be the
   * default.
   */
  indexable = process.env.TIMESTAMP_INDEXABLE === '1',
  auth = null,
  sessions = null,
  /**
   * The Supabase Auth client -- `createSupabaseAuth` from
   * `scripts/auth/supabase-auth.mjs`, already holding its transport.
   *
   * `null` BY DEFAULT, AND THE APP STILL BOOTS. The three `SUPABASE_*` values
   * live in `.env`, which `npm test` deliberately does not load, so a server
   * built by a test has no identity provider and must not need one. When it is
   * absent the code-entry routes answer 503 with one sentence and every other
   * route -- the landing page, the stylesheet, the shelf, the plans -- carries
   * on exactly as before. That is the same shape as the `auth = null`
   * degradation below and for the same reason: a missing configuration should
   * cost the feature it configures and nothing else.
   *
   * `scripts/web/server-cli.mjs` is the one caller that builds a real one, for
   * the reason CLAUDE.md's Bug 1 records -- a transport guard only guards if
   * production actually injects somewhere.
   */
  supabase = null,
  /**
   * Whether `x-forwarded-proto` decides the Secure attribute on cookies.
   *
   * OFF unless the operator says otherwise, because the header is whatever
   * the client typed unless a proxy this deployment actually has rewrote it.
   * Set TIMESTAMP_TRUST_PROXY=1 in the environment the day this runs behind
   * a TLS-terminating proxy, and not before -- Paul's call, 2026-08-26.
   */
  trustProxy = process.env.TIMESTAMP_TRUST_PROXY === '1',
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
  /**
   * How often the identity sweeps repeat, and the two functions that schedule
   * and cancel that repeat. Named and defaulted exactly as
   * `scripts/worker/worker.mjs` names its own `retentionSweepMs` /
   * `setIntervalImpl` / `clearIntervalImpl` -- the same shape for the same
   * reason: a timer a test cannot control is a timer a test cannot prove ran,
   * and one this codebase already had to solve once.
   */
  identitySweepMs = IDENTITY_SWEEP_MS,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('createServer needs a root');
  }
  if (!queue || typeof queue.enqueue !== 'function') {
    throw new TypeError('createServer needs a queue (scripts/queue/queue.mjs)');
  }

  const auths = sessions ?? createSessions({ root, auth, trustProxy });

  /**
   * Whose request this is.
   *
   * THE SOCKET ADDRESS, AND A HEADER ONLY WHERE ONE IS ACTUALLY REWRITTEN.
   * Exactly the argument `isSecureRequest` in `session.mjs` already makes
   * about `x-forwarded-proto`: a header is whatever the client typed unless a
   * proxy this deployment really has overwrote it. The value matters here
   * because it travels to Supabase as `Sb-Forwarded-For`, which is what
   * Supabase rate-limits a person on -- so believing the header by default
   * would let any caller choose which bucket to spend, including somebody
   * else's. `TIMESTAMP_TRUST_PROXY=1` is the same single switch, set by the
   * operator on the day a TLS-terminating proxy exists and not before.
   *
   * THE LEFTMOST ENTRY IS THE CLIENT. `x-forwarded-for` grows to the right as
   * each hop appends itself, so the first value is the original caller -- and
   * behind a trusted proxy it is also the only one that proxy did not write.
   *
   * Tasks 8-11 call this for the same header on their own routes; it is one
   * function so the trust decision cannot be made twice and differently.
   */
  function clientIpOf(req) {
    const socketIp = req?.socket?.remoteAddress ?? null;
    if (!trustProxy) return socketIp;
    const header = req?.headers?.['x-forwarded-for'];
    const first = String(Array.isArray(header) ? header[0] : header ?? '').split(',')[0].trim();
    return first || socketIp;
  }

  /**
   * One limiter per credential route, keyed on the same trust decision as
   * everything else: the socket address, unless the operator has said a proxy
   * rewrites the forwarded header.
   *
   * Without `TIMESTAMP_TRUST_PROXY=1`, `x-forwarded-for` is whatever the
   * client typed, so keying on it would hand every script its own unlimited
   * lane -- the socket it arrived on is the only honest key. WITH the switch,
   * every connection arrives on the proxy's own socket, and a socket-keyed
   * limiter collapses the whole internet into ONE bucket: ten sign-ins a
   * minute for everybody, and any single visitor locks out every other one --
   * a security control flipped into a trivially-triggered outage on day one.
   *
   * The earlier version of this comment argued the limiter must never use
   * `clientIpOf` because a header is client-influenced. That is true exactly
   * until the operator asserts otherwise, and `TIMESTAMP_TRUST_PROXY=1` IS
   * that assertion -- the same one `x-forwarded-proto` and the Supabase
   * `Sb-Forwarded-For` attribution already rest on. One switch, one trust
   * decision, made once in `clientIpOf` so it cannot be made twice and
   * differently. The deployment runbook's side of the bargain: the proxy must
   * overwrite inbound `x-forwarded-for` (Caddy's default for untrusted
   * peers), or the leftmost entry is client-typed on every route that reads it.
   */
  /**
   * WHEN THIS SERVER LAST FAILED TO GET A MAIL OUT, or null if it never has.
   *
   * Set only from a 5xx -- the shape Supabase uses when its SMTP relay refuses
   * (`unexpected_failure` / "Error sending confirmation email"), not the 4xx
   * shapes that describe the ADDRESS (`user_already_exists`, a rate limit).
   * That split is the whole safety argument: a 5xx is a fact about our
   * delivery and a 4xx is a fact about the person, and only the first may ever
   * be shown. `test/web-auth-mailer-down.test.js` carries the full reasoning.
   *
   * Per-server and in memory on purpose. It is a "recently broken" hint for a
   * page, not an audit record, and a restart clearing it is correct: the next
   * failure re-arms it within one signup.
   */
  let mailerFailedAt = null;
  const MAILER_DOWN_WINDOW_MS = 10 * 60_000;
  const noteMailFailure = (err) => {
    if (Number(err?.status) >= 500) mailerFailedAt = nowImpl().getTime();
  };
  const mailerLooksDown = () => mailerFailedAt !== null
    && nowImpl().getTime() - mailerFailedAt < MAILER_DOWN_WINDOW_MS;

  const limiters = {
    login: createRateLimiter({ ...AUTH_RATE_LIMITS.login, nowImpl }),
    signup: createRateLimiter({ ...AUTH_RATE_LIMITS.signup, nowImpl }),
    verify: createRateLimiter({ ...AUTH_RATE_LIMITS.verify, nowImpl }),
    google: createRateLimiter({ ...AUTH_RATE_LIMITS.google, nowImpl }),
    // `/auth/reset` -- the route that sends the recovery mail. Supabase's own
    // mailer sends two recovery emails an hour, project-wide, so this bound
    // exists to stop one connection from spending that budget on its own.
    // `/auth/reset/complete` reuses the `verify` limiter below: it is the same
    // six-digit code shape and the same per-IP address-cycling risk `/verify`
    // already guards against, not a new one.
    reset: createRateLimiter({ ...AUTH_RATE_LIMITS.reset, nowImpl }),
  };

  /** The Supabase client, or null. Named short because every identity handler
   *  opens by asking whether it is there. */
  const sb = supabase;

  /**
   * The identity modules, imported the same lazy way `scripts/auth/` is.
   *
   * A static import here would make the whole server fail to start when those
   * files are absent, which is precisely the degradation `session-middleware`
   * was built to avoid: a missing module should cost the routes that need it
   * and leave the landing page, the stylesheet and the shelf serving.
   */
  let identityMods = null;
  async function identityApi() {
    if (!identityMods) {
      const [identity, pending, accounts] = await Promise.all([
        import('../auth/identity.mjs'),
        import('../auth/pending-signup.mjs'),
        import('../auth/accounts.mjs'),
      ]);
      identityMods = {
        resolveIdentity: identity.resolveIdentity,
        takePending: pending.takePending,
        putPending: pending.putPending,
        emailHash: accounts.emailHash,
        // The one sentence `login` (task 9) may render on any failure --
        // imported here rather than retyped, so the page and the module that
        // owns the wording cannot drift apart.
        BAD_CREDENTIALS_MESSAGE: accounts.BAD_CREDENTIALS_MESSAGE,
        // `/onboarding` (task 12) is the one place a `consent: null` account
        // gets repaired, and this is the only sanctioned way to write a field
        // onto an account record -- load, mutate, save, under the account's
        // own lock. See `handlers.onboardingConsent`.
        updateAccount: accounts.updateAccount,
        // `login` (below) reads this back to decide whether the account it
        // just resolved needs to be routed through `/onboarding` at all --
        // see the comment at its redirect.
        loadAccount: accounts.loadAccount,
        // The litter sweep for `out/pending-signups`. Never called before
        // this file wired it in -- see `sweepIdentityLitter`.
        sweepPending: pending.sweepPending,
      };
    }
    return identityMods;
  }

  /**
   * PKCE and the verifier store, imported the same lazy way `identityApi` is
   * and for the same reason: a missing `scripts/auth/` must only cost the
   * routes that need it.
   */
  let oauthMods = null;
  async function oauthApi() {
    if (!oauthMods) {
      const [pkce, store] = await Promise.all([
        import('../auth/pkce.mjs'),
        import('../auth/oauth-store.mjs'),
      ]);
      oauthMods = {
        newVerifier: pkce.newVerifier,
        challengeFor: pkce.challengeFor,
        newState: pkce.newState,
        putVerifier: store.putVerifier,
        takeVerifier: store.takeVerifier,
        OAUTH_TTL_MS: store.OAUTH_TTL_MS,
        // The litter sweep for `out/oauth`. Never called before this file
        // wired it in -- see `sweepIdentityLitter`.
        sweepOAuth: store.sweepOAuth,
      };
    }
    return oauthMods;
  }

  /**
   * `logImpl` is caller-supplied, and every call to it below sits inside a
   * catch block reporting a sweep that already failed -- with nothing above
   * it to catch a SECOND throw. Review finding, 2026-08-26: a `logImpl` that
   * itself throws while reporting a caught failure escaped
   * `sweepIdentityLitter` uncaught, which is exactly the crash that
   * function's own contract exists to rule out. Reproduced by the reviewer
   * both as a rejected `listen()` and as an escaping rejection on a later
   * timer tick, with no `unhandledRejection` handler anywhere in this
   * codebase to catch the second one -- that one takes the whole process
   * down, not just the sweep. Every `logImpl` call in `sweepIdentityLitter`
   * goes through this instead of calling it directly.
   */
  function safeLog(line) {
    try { logImpl(line); } catch { /* a broken logger must not be able to crash the sweep it is reporting on */ }
  }

  /**
   * Sweep the three identity litter directories once. Called at `listen()`
   * and then on `identitySweepMs`, same shape as `worker.mjs`'s
   * `sweepRetention` -- once at startup, then unref'd and hourly, never the
   * reason a shutdown hangs.
   *
   * EACH OF THE THREE IS ITS OWN try/catch, NOT ONE AROUND ALL THREE. A
   * directory that cannot even be created (a full disk, a `root` that turned
   * out to be read-only) must not stop the other two from running, and a
   * failure here of any kind must never reach the caller -- `listen()` awaits
   * this once and a bug in a sweep must not be a bug in booting the server.
   * `sweepVerifyAttempts` already swallows its own read failures; the other
   * two are wrapped here because `oauth-store.mjs` and `pending-signup.mjs`
   * are out of scope for this task and their own directory-creation step
   * (`dirFor`) is not guarded internally.
   *
   * THIS FUNCTION NEVER THROWS -- not "should not", DOES NOT: every
   * statement capable of throwing (the three sweeps, and every line
   * reporting on them) is inside a try/catch, or is `safeLog`. Both call
   * sites below ALSO guard the call, deliberately -- belt and braces, because
   * this is the one function in the slice whose entire contract is that it
   * cannot take anything down, and trusting a single layer of that is how
   * the bug above happened the first time.
   */
  async function sweepIdentityLitter() {
    let oauthRemoved = null;
    let pendingRemoved = null;
    let verifyRemoved = null;
    try {
      const oauth = await oauthApi();
      oauthRemoved = oauth.sweepOAuth({ root, nowImpl });
    } catch (err) {
      safeLog(`[web] sweepOAuth failed, out/oauth left unswept this pass: ${err?.message ?? err}`);
    }
    try {
      const identity = await identityApi();
      pendingRemoved = identity.sweepPending({ root, nowImpl });
    } catch (err) {
      safeLog(`[web] sweepPending failed, out/pending-signups left unswept this pass: ${err?.message ?? err}`);
    }
    try {
      verifyRemoved = sweepVerifyAttempts({ root, nowImpl });
    } catch (err) {
      safeLog(`[web] sweepVerifyAttempts failed, out/verify-attempts left unswept this pass: ${err?.message ?? err}`);
    }
    // Only when something happened -- an hourly "removed nothing" line is
    // exactly how the worker's own retention sweep decided to stay quiet, and
    // for the same reason: a line nobody reads stops being read.
    if (oauthRemoved || pendingRemoved || verifyRemoved) {
      safeLog(`[web] identity sweep: oauth=${oauthRemoved ?? 0} pending=${pendingRemoved ?? 0} verify=${verifyRemoved ?? 0}`);
    }
  }

  /**
   * The 503 for a build with no identity provider configured.
   *
   * LOGGED ONCE, not once per request: an unconfigured deployment would
   * otherwise fill a log with the same line, which is how the line stops being
   * read. Same shape as the `scripts/auth/` degradation further down.
   */
  let identityGapLogged = false;
  function identityUnavailable(req, res) {
    if (!identityGapLogged) {
      identityGapLogged = true;
      logImpl('[web] no identity provider is configured (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / '
        + 'SUPABASE_SECRET_KEY); the code-entry routes answer 503 and the rest of the app serves');
    }
    const message = 'Sign-in is not available right now.';
    if (wantsHtml(req)) return sendHtml(req, res, 503, identityUnavailablePage());
    return sendJson(req, res, 503, {
      error: { status: 503, message, code: 'IDENTITY_UNAVAILABLE' },
    });
  }

  /**
   * Did this post come from one of our own pages?
   *
   * `Sec-Fetch-Site` IS ASKED FIRST, AND IT HAS TO BE. Every page this server
   * sends carries `Referrer-Policy: no-referrer` -- a deliberate choice, so a
   * `/j/<id>` url can never ride out in a `Referer`. Chrome answers that policy
   * by sending `Origin: null` on a form POST, INCLUDING A SAME-ORIGIN ONE.
   * Measured 2026-08-27 against a two-page probe differing in that one header:
   * with it, `origin="null" sec-fetch-site=same-origin`; without it,
   * `origin="http://localhost:3100"`. `new URL('null')` throws, so reading
   * `Origin` alone meant this server called its OWN pages forgeries and
   * REFUSED EVERY FORM IT SERVES -- signup, sign-in, verify, resend, reset and
   * the Google button. The suite was green throughout, because it only ever
   * sent the two values a browser does not send here: absent, and a foreign
   * origin.
   *
   * `Sec-Fetch-Site` is the browser's own account of where the request came
   * from. It is a FORBIDDEN HEADER NAME, so page script cannot set or forge
   * it, which makes it a better witness than an `Origin` the referrer policy
   * is entitled to blank. Only `same-origin` passes: `same-site` is a
   * different origin under the same registrable domain -- a subdomain someone
   * else controls -- and `cross-site` and `none` are not us either.
   *
   * WHEN IT IS ABSENT the old `Origin` reasoning stands unchanged, for curl,
   * for server-to-server callers, and for every test written before this. A
   * post that names another site is cross-site whatever else it carries.
   * ABSENCE PASSES -- non-browser clients name nothing, and the anti-forgery
   * token below still gates them -- so this is the cheap early layer, not the
   * proof.
   */
  function sameOriginPost(req) {
    const site = req.headers['sec-fetch-site'];
    if (typeof site === 'string' && site !== '') return site === 'same-origin';
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    try {
      return new URL(origin).host === String(req.headers.host ?? '');
    } catch {
      // An opaque origin from a client too old to tell us what it is.
      return false;
    }
  }

  /**
   * The 403 for a money post that did not prove it came from this site. The
   * auth routes answer a forgery with their own form re-armed
   * (`refuseForgery`); the two credit-spending API routes have no form of
   * their own to re-arm, so the answer is the refusal itself. Decided on the
   * HEADERS, before any body is read -- a forged upload must not land bytes,
   * and a forged checkout must not reach the pack table.
   */
  function refuseCrossSite(req, res) {
    const message = 'We could not confirm that came from this site. Please go back and try again.';
    if (wantsHtml(req)) return sendHtml(req, res, 403, errorPage({ status: 403, title: 'Not from this site' }));
    return sendJson(req, res, 403, { error: { status: 403, message, code: 'NOT_FROM_THIS_SITE' } });
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
      let page;
      if (which === 'login') page = loginPage({ error: message, csrf: token, ...extras });
      else if (which === 'verify') page = verifyPage({ error: message, csrf: token, ...extras });
      else if (which === 'reset') page = resetPage({ error: message, csrf: token, ...extras });
      else if (which === 'resetComplete') page = resetCompletePage({ error: message, csrf: token, ...extras });
      else page = signupPage({ error: message, csrf: token, consentText, ...extras });
      return sendHtml(req, res, 403, page, headers);
    }
    return sendJson(req, res, 403, { error: { status: 403, message, code: 'NOT_FROM_THIS_SITE' } }, headers);
  }

  /** One sentence per limited route. A map rather than a chain of ternaries,
   *  because the next route to join them should be a row and not a branch. */
  const OVER_LIMIT_MESSAGES = Object.freeze({
    login: 'Too many sign-in attempts from your connection. Please wait a minute and try again.',
    signup: 'Too many new accounts from your connection. Please try again later.',
    verify: 'Too many code attempts from your connection. Please try again later.',
    google: 'Too many attempts to sign in with Google from your connection. Please wait a minute and try again.',
    reset: 'Too many reset requests from your connection. Please try again later.',
  });

  /** True when the 429 has been sent and the handler must stop. Decided before
   *  the body is read: the refusal must not depend on -- or reveal -- anything
   *  about what was being attempted. */
  function refuseOverLimit(req, res, which, page) {
    const key = (trustProxy ? clientIpOf(req) : req.socket?.remoteAddress) ?? 'unknown';
    const { allowed, retryAfterS } = limiters[which].check(key);
    if (allowed) return false;
    const message = OVER_LIMIT_MESSAGES[which] ?? OVER_LIMIT_MESSAGES.login;
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
  /**
   * The tape raster this job froze, or null if it never froze one.
   *
   * 4:3 IS THE BASE AND DELIBERATELY NOT AN ENTRY IN `cfg.aspects` -- that is
   * what makes it structurally impossible for the default path to drift while
   * a shape is added -- so the default reads `cfg.tape` and a chosen shape
   * reads its own block. Both are inside the frozen `resolved`, which is
   * written exactly once by compose.
   */
  function frozenTape(job) {
    const cfg = job.resolved?.cfg;
    if (!cfg) return null;
    const aspect = job.input?.aspect ?? null;
    const t = (aspect && aspect !== (cfg.defaultAspect ?? '4:3')
      ? cfg.aspects?.[aspect]?.tape
      : cfg.tape) ?? null;
    return Number.isFinite(t?.width) && Number.isFinite(t?.height)
      ? { width: t.width, height: t.height }
      : null;
  }

  /**
   * The failure sentence a customer sees. The raw `error.message` is written
   * for the operator -- a provider HTTP body, an ffmpeg stderr line, a guard
   * name -- and it stays in the manifest; what ships to a page or the status
   * poller is the authored `userMessage` when the thrown error carried one
   * (pipeline.mjs stores it on job.error for exactly this reader), and one
   * generic sentence otherwise. The CODE ships either way: it is how a
   * support conversation finds the manifest without the customer reading
   * internals.
   */
  const GENERIC_FAILURE = 'Something went wrong while making this tape.';
  function customerError(error, userMessage) {
    if (!error) return null;
    return { code: error.code ?? null, message: userMessage ?? GENERIC_FAILURE };
  }

  /**
   * Where this tape's credits went, computed from the account's own ledger
   * rows for the job -- the same arithmetic `refundCredits` uses -- and never
   * asserted from hope. Rows summing to zero with a positive row means the
   * refund landed; a negative sum means a paid step had already started and
   * the money is genuinely gone; no rows means this job was never charged
   * through the web (a CLI render) and no money sentence belongs on it.
   * Null says nothing, which is the only honest default.
   */
  function creditNoteFor(account, job) {
    if (job.status !== 'failed' && job.status !== 'cancelled') return null;
    const rows = Array.isArray(account?.ledger)
      ? account.ledger.filter((e) => e?.jobId === job.jobId)
      : [];
    if (rows.length === 0) return null;
    const net = rows.reduce((n, e) => n + (Number(e?.delta) || 0), 0);
    if (net === 0) {
      const returned = rows.reduce((n, e) => n + Math.max(0, Number(e?.delta) || 0), 0);
      return returned > 0 ? `The ${returned} credits for this tape went back to your balance.` : null;
    }
    if (net < 0) return `The ${-net} credits for this tape were already spent with the video provider when it stopped.`;
    return null;
  }

  function jobView(job, { account = null } = {}) {
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
        // The code only; the raw message is operator wording (a provider
        // stack line, a request id) and lives in the manifest, not here.
        error: s.error ? customerError(s.error, null) : null,
      })),
      cost: job.cost,
      result: {
        ...job.result,
        // The tape raster this job FROZE, so the result page can caption the
        // file it is showing instead of a constant. Read from `resolved`
        // because that block is the only thing that can answer for a job that
        // already ran; today's config answers for a job somebody might start
        // now. Null when nothing was frozen, and the page then says nothing.
        tape: frozenTape(job),
        videoUrl: job.result?.videoPath ? `/api/jobs/${job.jobId}/video` : null,
        posterUrl: job.result?.posterPath ? `/api/jobs/${job.jobId}/poster` : null,
      },
      error: customerError(job.error, job.error?.userMessage ?? null),
      // A composed sentence or null, never a flag the page words itself --
      // one author for money copy, and the poller paints the same text.
      creditNote: account ? creditNoteFor(account, job) : null,
      input: {
        place: job.input?.place?.value ?? null,
        placeKind: job.input?.place?.kind ?? null,
        outfit: job.input?.outfit?.value ?? null,
        outfitKind: job.input?.outfit?.kind ?? null,
        stillCount: job.input?.stillCount ?? null,
        // The shape is what decides whether the raster above is PAL or merely
        // shares its line rate, so the page needs it alongside the numbers.
        aspect: job.input?.aspect ?? null,
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
        // `/videos` plays the tape in place, so it needs the media URL and the
        // SHAPE. The shape is not decoration: the tile crops what it shows, and
        // a 9:16 tape cropped to a 4:3 tile loses more than half its picture.
        // Null for anything unfinished -- there is no file behind it yet, and a
        // player pointed at nothing is a control that can only fail.
        videoUrl: job.status === 'done' && job.result?.videoPath ? `/api/jobs/${jobId}/video` : null,
        aspect: job.input?.aspect ?? '4:3',
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
    // THE CONFIG SAYS WHAT THE PRODUCT OFFERS; THE RENDERER DECIDES WHAT CAN
    // ACTUALLY BE MADE, AND THE PAGE HAS TO AGREE WITH THE SECOND.
    //
    // `resolveRaster` refuses any non-default shape on a paid provider, because
    // `fal.mjs` sends a hardcoded `aspect_ratio` and a 9:16 tape built around a
    // 4:3 source delivers something other than what was ordered -- with every
    // check downstream agreeing, since they all read the same resolved config.
    // A page that offers those shapes anyway is selling a compose failure that
    // happens AFTER the credits are debited.
    //
    // Asked by NAME, never by loading a provider: `providers/index.mjs`
    // statically imports `fal.mjs`, and keeping that out of the web process is
    // what three of the four money guards are for. `PAID_PROVIDER_IDS` is a
    // leaf constant and a contract test keeps it honest.
    //
    // BOTH CONDITIONS ARE CLOSED NOW, so the gate is gone. `falAspectFor` puts
    // the ordered shape on the wire, and `creditCost` charges 4/3 for it --
    // holding the short edge, a 16:9 or 9:16 source is 4/3 the pixels of 4:3 at
    // the same tier and fal bills tokens as pixels x seconds. The page can
    // offer what the renderer will build and the ledger will charge for.
    return aspectIds(cfg).map((id) => ({
      id,
      available: id === cfg.defaultAspect || cfg.aspects?.[id]?.available === true,
    }));
  }

  async function resolutionRows() {
    const now = Date.now();
    if (resolutionCache.rows && now - resolutionCache.at < 60_000) return resolutionCache.rows;
    // The shapes and the tape length travel with the request, so the seam can
    // quote each (resolution, shape) pair by asking the same function that will
    // charge for it. There is no second copy of the arithmetic anywhere.
    const rows = await auths.resolutions(aspectIds(cfg), TAPE_SECONDS);
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

  /** The cost of one tape at this resolution AND SHAPE, in credits. Fifteen
   *  seconds is not a default so much as the contract -- 375 frames at 25fps.
   *
   *  THE SHAPE IS A PARAMETER AND NOT AN OPTION. A label holds the short edge,
   *  so 16:9 and 9:16 are 4/3 the pixels of 4:3 at the same tier and fal bills
   *  tokens as pixels x seconds. Quoting without it charges every wide tape the
   *  4:3 price -- and 9:16 is the phone format, so that is the modal order, not
   *  an edge case. It is the same pass-through shape as the three defects in
   *  section 26: a value that is present, correct, and simply not handed on. */
  async function costOf(resolution, aspect = null) {
    return auths.cost({ resolution, seconds: TAPE_SECONDS, aspect });
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

  /**
   * What the landing says a tape costs.
   *
   * The landing never carried a price, and a consumer product that hides its
   * price reads as enterprise or evasive. This derives it from the two seams
   * that already bill -- the same `resolutions` the Record button quotes from
   * and the same `packs` the pricing page sells -- so the sentence on the
   * public page cannot drift from the ledger. Nothing here is typed by hand;
   * that is what went wrong with the still-approval claim.
   *
   * FLOOR, NOT AVERAGE. `fromCredits` is the CHEAPEST offered combination, and
   * the copy says "from", because 21 credits is 480p at 4:3 while the phone
   * shape is 28 and 720p is 46 or 61. Quoting the cheapest as if it were the
   * price would be the §36A defect again -- a card advertising a third under
   * what the ledger takes.
   *
   * Returns null whenever it cannot answer honestly -- no rows, no buyable
   * pack, or a seam that threw. The page then shows no price rather than a
   * wrong one, which is the `stripePriceId: null` discipline applied to copy.
   */
  async function landingPricing() {
    try {
      const [rows, packs] = await Promise.all([resolutionRows(), packRows()]);
      const offered = (rows ?? []).filter((r) => r.available && Number.isFinite(r.credits));
      const buyable = (packs ?? []).filter((p) => p.buyable && Number.isFinite(p.priceUSD));
      if (offered.length === 0 || buyable.length === 0) return null;
      const cheapestTape = Math.min(...offered.map((r) => r.credits));
      const pack = buyable.reduce((a, b) => (a.priceUSD <= b.priceUSD ? a : b));
      return { fromCredits: cheapestTape, packUSD: pack.priceUSD, packCredits: pack.credits };
    } catch (err) {
      logImpl(`[web] the landing price could not be derived: ${err?.message ?? err}`);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // who is selling (the legal pages)
  // -------------------------------------------------------------------------

  // Resolved once at construction, in one order: the `legal` option (tests
  // pin both states with it, so it wins over everything), then
  // TIMESTAMP_LEGAL_ENTITY, then the committed file. The environment beats the
  // file because the file's `entity: null` is the DESIGNED published state --
  // an operator who set the variable has said what the truth is, and the repo
  // is not where a home address should have to live to be published.
  //
  // Every route ends at `normaliseLegalEntity`, so a half-configured entity
  // from ANY of the three is refused identically. Nothing here fails the boot:
  // a legal page is owed, and the honest placeholder is a better answer to a
  // broken config than a dead web server -- the same manners as the packs. The
  // runbook's smoke list is what stops a placeholder reaching customers.
  let legalEntity = null;
  if (legal !== null) {
    legalEntity = legal.entity ?? null;
  } else if (legalEntityJson !== null) {
    let parsed = null;
    try {
      parsed = JSON.parse(legalEntityJson);
    } catch (err) {
      logImpl(`[web] TIMESTAMP_LEGAL_ENTITY is not valid JSON (${err?.message}); the legal pages show the operator placeholder`);
    }
    if (parsed !== null) {
      const { entity, reason } = normaliseLegalEntity(parsed);
      if (entity === null) {
        logImpl(`[web] TIMESTAMP_LEGAL_ENTITY was refused: ${reason}; the legal pages show the operator placeholder`);
      }
      legalEntity = entity;
    }
  } else {
    try {
      const fromFile = JSON.parse(
        fs.readFileSync(new URL('../../config/legal.json', import.meta.url), 'utf8'),
      ).entity ?? null;
      if (fromFile !== null) {
        const { entity, reason } = normaliseLegalEntity(fromFile);
        if (entity === null) {
          logImpl(`[web] config/legal.json's entity was refused: ${reason}; the legal pages show the operator placeholder`);
        }
        legalEntity = entity;
      }
    } catch (err) {
      logImpl(`[web] config/legal.json could not be read (${err?.code ?? err?.message}); the legal pages show the operator placeholder`);
      legalEntity = null;
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

  /** The queue half of the same endpoint, on the same 30 s timer and for the
   *  same reason.
   *
   *  BOTH READS ARE SYNCHRONOUS AND BOTH GROW WITHOUT BOUND. `stats()` does
   *  one `readFileSync` per pending entry plus three `readdirSync`, and
   *  `out/queue/done` and `failed` accumulate one file per job for the life of
   *  the deployment -- so the per-hit cost of an unauthenticated endpoint
   *  rises monotonically and never comes back down. Nothing else in the
   *  process is scheduled while they run.
   *
   *  30 SECONDS IS NOT A COMPROMISE HERE. What this endpoint answers is "is
   *  there a worker and is it keeping up", and neither question changes
   *  meaningfully inside half a minute; a render takes minutes. It is a cache
   *  and not a freeze -- past the window the next caller pays for a fresh read
   *  -- which is asserted in both directions rather than left to the comment.
   *
   *  It takes `nowImpl` rather than `Date.now` so a test can move the clock
   *  instead of sleeping through the window. */
  let queueCache = { at: -Infinity, value: null };
  function queueHealth() {
    const now = nowImpl().getTime();
    if (queueCache.value && now - queueCache.at < 30_000) return queueCache.value;

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

    const value = { stats, lastSeen };
    queueCache = { at: now, value };
    return value;
  }

  /**
   * The disk, on the same 30 s window as everything beside it. This root holds
   * the accounts, the ledger, the queue and every photograph -- a full disk is
   * the one infrastructure failure this deployment can see COMING, and the
   * uptime monitor on this endpoint is the only thing that will be looking.
   *
   * THE FLOOR IS 1 GiB, not a percentage. A render writes ~65 MB and a ledger
   * append must never meet ENOSPC, so the question is "how many more orders
   * fit", which is absolute -- 2% of a 4 TB volume is plenty and 10% of a
   * 10 GB one is not.
   *
   * An UNREADABLE figure is reported and is neither low nor healthy:
   * "I cannot see the disk" is a different claim from "the disk is full", and
   * paging on it would have health crying wolf on any platform quirk.
   */
  const DISK_FLOOR_BYTES = 1_073_741_824;
  let diskCache = { at: -Infinity, value: null };
  function diskHealth() {
    const now = nowImpl().getTime();
    if (diskCache.value && now - diskCache.at < 30_000) return diskCache.value;
    let value;
    try {
      const s = statfsImpl(root);
      const availableBytes = Number(s.bavail) * Number(s.bsize);
      const totalBytes = Number(s.blocks) * Number(s.bsize);
      value = { availableBytes, totalBytes, low: availableBytes < DISK_FLOOR_BYTES };
    } catch (err) {
      value = { availableBytes: null, totalBytes: null, low: null, error: err?.code ?? 'unreadable' };
    }
    diskCache = { at: now, value };
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
        // Still no balance, no shelf, no account read -- `landingPricing`
        // asks the catalogue and the pack list, both of which are public
        // facts, so the anonymous branch stays unable to leak account data.
        // THE LANDING MINTS AN ANTI-FORGERY TOKEN NOW, because the sign-in
        // dialog lives on it. Same call and same cookie the /login page has
        // always made -- the pair is per-visitor, not per-page, so nothing new
        // is trusted and `/login` keeps working unchanged for anyone whose
        // browser never runs the dialog script.
        //
        // IT IS GUARDED BECAUSE THE LANDING MUST NOT LEARN TO NEED AUTH. This
        // route's own comment above is the contract: the anonymous branch
        // "cannot leak account data because it never touches any", and it had
        // never called into scripts/auth at all. Wiring csrfIssue in
        // unconditionally broke the degraded mode outright -- with the auth
        // module missing, the 503 test went red, because the page that is
        // supposed to still work stopped working.
        //
        // No token means no forms: the dialog renders a plain link to /login
        // instead, which is the same discipline as `stripePriceId: null`
        // rendering a disabled button. A control that is guaranteed to 403 is
        // worse than a link.
        let token = '';
        let setCookie = null;
        try {
          ({ token, setCookie } = await auths.csrfIssue(req));
        } catch (err) {
          logImpl(`[web] the landing could not mint an anti-forgery token: ${err?.message ?? err}`);
        }
        return sendHtml(req, res, 200, landingPage({
          places: cards.places,
          pricing: await landingPricing(),
          csrf: token,
        }), setCookie ? { 'Set-Cookie': setCookie } : {});
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
        // Same window, same source as /pricing -- see the note on that route.
        retentionDays: cfg?.retention?.jobDays ?? null,
      }));
    },

    async stylesheet(req, res) { (await stylesheet()).send(req, res); },

    font(req, res) {
      const file = `${assetsRoot}/fonts/tape-osd.ttf`;
      if (!sendFile(req, res, { file, contentType: 'font/ttf', maxAge: 86_400 })) {
        throw new HttpError(404, 'Not found.', { code: 'NO_FONT' });
      }
    },

    /**
     * The brand marks.
     *
     * `/favicon.ico` answered `204 No Content` until now, which is a legal
     * answer and a bad one: it is the most-requested url this server has, and
     * an empty answer means every tab carries the browser's blank-page glyph.
     *
     * A DAY, NOT A YEAR, AND THE REASON IS THE URL. A year is the standard
     * advice for static assets and it is correct only when the filename carries
     * a content hash, so a new file means a new url. These are fixed names.
     * Cached for a year, a browser that has seen the old mark does not ask
     * again for a year -- the change never reaches a returning visitor, and no
     * amount of reloading fixes it, because the request is never made.
     *
     * Measured the hard way: a year was set here first, the icon was replaced,
     * and it did not appear in the tab. The bytes were correct on the wire the
     * whole time.
     *
     * A day, with the ETag `sendFile` derives from size and mtime, means the
     * revalidation costs one 304 and a change is visible tomorrow at worst.
     * Same number the font uses, for the same reason.
     */
    ...Object.fromEntries(Object.entries({
      favicon: 'favicon.ico',
      iconSvg: 'icon.svg',
      icon180: 'icon-180.png',
      icon192: 'icon-192.png',
      icon512: 'icon-512.png',
    }).map(([name, file]) => [name, (req, res) => {
      if (!sendFile(req, res, { file: `${assetsRoot}/brand/${file}`, maxAge: 86_400 })) {
        throw new HttpError(404, 'Not found.', { code: 'NO_BRAND_ASSET' });
      }
    }])),

    /**
     * The place photographs, when they exist.
     *
     * TWO SUFFIXES, ONE ROUTE, AND A FALLBACK CHAIN BEHIND BOTH. `<id>.jpg` is
     * the still -- the card thumbnail and the background layer -- and `<id>.mp4`
     * is the six-second graded loop the background plays over it. A 404 on
     * either is a designed state rather than a fault: the card's
     * `background-image` lists the photograph first and the warm gradient
     * second, so a missing still paints the gradient, and a missing loop leaves
     * the still. The page is finished on a fresh clone with this directory
     * empty, and each asset drops in with no code change.
     *
     * The id is resolved by MEMBERSHIP in the loaded catalog, so no byte of the
     * request is ever concatenated into a path.
     */
    placeImage(req, res, { params }) {
      const m = PLACE_MEDIA_RE.exec(String(params.file ?? ''));
      const id = m ? m[1] : null;
      const ext = m ? m[2] : null;
      if (!id || !placeIds.has(id)) {
        throw new HttpError(404, 'No such place image.', { code: 'NO_PLACE_IMAGE' });
      }
      if (!sendFile(req, res, {
        file: `${assetsRoot}/places/${id}.${ext}`,
        contentType: ext === 'mp4' ? 'video/mp4' : 'image/jpeg',
        maxAge: 86_400,
      })) {
        throw new HttpError(404, 'No such place image.', { code: 'NO_PLACE_IMAGE' });
      }
    },

    statusPage(req, res, { params, account }) {
      const job = ownedJob(account, params.id);
      if (job.status === 'done') return redirect(res, `/j/${job.jobId}/result`);
      if (job.status === 'awaiting-selection') return redirect(res, `/j/${job.jobId}/select`);
      return sendHtml(req, res, 200, statusPage({ view: jobView(job, { account }), account, labels: labelsOf(job) }));
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
      // `?reset=done` is NOT proof of anything -- anyone can type
      // `https://…/login?reset=done` directly and see the identical notice.
      // An earlier version of this comment claimed the query param "arrives
      // only from this server's own redirect" and that was wrong; nothing
      // here checks where the request came from. It is harmless only because
      // `RESET_DONE_NOTICE` is a fixed constant with no caller-supplied
      // content -- there is nothing to inject -- so a forged link can show a
      // stranger a "your password was changed" message but cannot carry any
      // attacker-chosen text or data through it. That is a ready-made
      // phishing premise, not a proven-safe redirect marker; do not extend
      // this pattern to a notice whose content or behaviour matters more.
      const notice = query?.get('reset') === 'done' ? RESET_DONE_NOTICE : null;
      return sendHtml(req, res, 200, loginPage({ next: safeNext(query?.get('next')), csrf: token, notice }),
        setCookie ? { 'Set-Cookie': setCookie } : {});
    },

    async signupPage(req, res, { query, account }) {
      if (account) return redirect(res, safeNext(query?.get('next')) || '/');
      const { token, setCookie } = await auths.csrfIssue(req);
      // `?email=` is a convenience and nothing more -- `/verify/resend` sends
      // somebody back here to ask for a new code, and retyping the address
      // they just failed to confirm is how a typo gets made twice. It is a
      // prefilled field, not a claim about who anybody is.
      const prefill = String(query?.get('email') ?? '').trim().slice(0, 254);
      return sendHtml(req, res, 200, signupPage({
        next: safeNext(query?.get('next')),
        email: isAddressShaped(prefill) ? prefill : '',
        consentText,
        csrf: token,
      }), setCookie ? { 'Set-Cookie': setCookie } : {});
    },

    // --- confirming a mailbox with a six-digit code (spec §3, §4.5) --------

    /**
     * The code-entry page.
     *
     * NO SESSION REQUIRED AND NONE POSSIBLE. The account does not exist until
     * the code is confirmed, so there is nobody to be signed in as. The address
     * arrives in the query because the page has to say where the code went;
     * holding this URL proves nothing, and possession of the CODE is the only
     * thing that does.
     */
    async verifyPage(req, res, { query }) {
      if (!sb) return identityUnavailable(req, res);
      // Whole-branch review finding 4: `signupPage` twenty lines above guards
      // its own `?email=` prefill with `isAddressShaped(prefill) ? prefill :
      // ''` -- this route did not, so `/verify?email=<anything up to 254
      // chars>` rendered that text on the page, escaped so it is not markup,
      // but still attacker-chosen text shown in bold on this app's own
      // origin, under our own branding, on a page that already says "check
      // your email". Applying the sibling's guard closes that.
      const raw = String(query?.get('email') ?? '').trim().slice(0, 254);
      const email = isAddressShaped(raw) ? raw : '';
      const { token, setCookie } = await auths.csrfIssue(req);
      return sendHtml(req, res, 200, verifyPage({ email, csrf: token, mailerDown: mailerLooksDown() }),
        setCookie ? { 'Set-Cookie': setCookie } : {});
    },

    /**
     * Confirm the six digits.
     *
     * THE ATTEMPT LIMIT IS THE FEATURE, NOT A GARNISH ON IT. Spec §4.5: six
     * digits is one million values with an hour to live, and a script making a
     * few hundred guesses a second walks that space inside the window. Three
     * bounds stand between the two, and all three are ours:
     *
     *   - per IP, `AUTH_RATE_LIMITS.verify`, checked first and before the body
     *     is read, so the refusal cannot depend on what was being attempted;
     *   - per address, `chargeCodeAttempt`, spent BEFORE the upstream call so
     *     that a crash cannot hand the budget back;
     *   - per code, which is the same counter: five wrong answers and the code
     *     is DEAD rather than throttled. The sixth attempt fails even carrying
     *     the correct code, and that is the assertion which proves the limit is
     *     a limit and not a message.
     *
     * AND EVERY FAILURE LOOKS THE SAME. A wrong code, an expired code and a
     * code for an address that never signed up leave here with one status, one
     * sentence and one set of headers. "That code has expired" tells a stranger
     * the address is real, which is a disclosure about a person on a service
     * that stores photographs of faces. Nothing from `SupabaseAuthError` --
     * not `.code`, not `.status`, not `.message` -- is ever rendered.
     */
    async verifyCode(req, res) {
      if (!sb) return identityUnavailable(req, res);
      // ORIGIN BEFORE THE LIMITER, on this and on every credential post. A
      // post that cannot prove it came from this site costs the server
      // nothing and must not cost the visitor anything either: counted first,
      // a foreign page could auto-submit a handful of hidden forms from the
      // visitor's own browser and spend their budget for them -- refused 403
      // every time, counted every time, and their own next attempt a 429.
      if (!sameOriginPost(req)) return refuseForgery(req, res, 'verify');
      if (refuseOverLimit(req, res, 'verify', verifyPage)) return undefined;
      const body = parseSmallBody(req.headers['content-type'], await readBody(req, 4_096));
      const email = String(body.email ?? '').trim();
      const code = String(body.code ?? '').trim();
      const csrf = String(body.csrf ?? '');

      // BEFORE the code is looked at, and before an attempt is spent. Same
      // order and same reason as `login`: a post that cannot prove it came
      // from this site's own form gets no opinion on whether a code was right,
      // and cannot burn somebody else's five guesses on their behalf.
      if (!(await auths.csrfCheck(req, csrf))) return refuseForgery(req, res, 'verify', { email });

      const refuse = (message) => {
        // The token that just verified rides back out, so the retry the person
        // is about to make still carries a valid pair.
        if (wantsHtml(req)) return sendHtml(req, res, 401, verifyPage({ error: message, email, csrf }));
        return sendJson(req, res, 401, { error: { status: 401, message } });
      };

      // An address that is not an address has no code and no counter to spend,
      // so it gets the same answer as a wrong code rather than a different one.
      //
      // BOTH CHECKS, AND THEY ARE NOT THE SAME CHECK. `isAddressShaped` is
      // this file's cheap shape test; `emailHash` runs `normaliseEmail`, which
      // is STRICTER (`a@b..com` passes the first and fails the second) and
      // throws when it refuses. Without the catch that throw becomes a 500 --
      // a different answer for a different input, which is the oracle this
      // handler exists to close, arriving through a crash instead of a message.
      if (!isAddressShaped(email)) return refuse(CODE_REFUSED_MESSAGE);

      const ident = await identityApi();
      let hash;
      try {
        hash = ident.emailHash(email);
      } catch {
        return refuse(CODE_REFUSED_MESSAGE);
      }
      const { allowed } = chargeCodeAttempt({ root, hash, nowImpl });
      if (!allowed) return refuse(CODE_EXHAUSTED_MESSAGE);

      let identity;
      try {
        ({ identity } = await sb.verifyCode({
          email, token: code, type: 'signup', clientIp: clientIpOf(req),
        }));
      } catch (err) {
        // The upstream words go to the log and the page gets the constant.
        // `over_request_rate_limit` in particular must be diagnosable without
        // being visible -- spec §4.3.
        logImpl(`[web] verify refused: ${err?.message ?? err}`);
        return refuse(CODE_REFUSED_MESSAGE);
      }

      // The agreement was given on the signup form, minutes or days ago, and
      // has been waiting in a file since. `takePending` DELETES as it reads, so
      // a second confirmation cannot collect a second "yes".
      const parked = ident.takePending({ root, email, nowImpl });
      if (!parked) {
        logImpl('[web] a code confirmed with no parked consent on file; onboarding must ask again');
      }

      let accountId;
      try {
        ({ accountId } = await ident.resolveIdentity({
          root, identity, consent: parked?.consent ?? null, nowImpl,
        }));
      } catch (err) {
        // FAIL CLOSED. No session, nothing part-created, and the SAME sentence
        // as a wrong code -- a 500 here would tell an attacker that the code
        // they just guessed was CORRECT and only the account write failed,
        // which is the one fact this whole handler exists to withhold.
        logImpl(`[web] verify could not resolve an identity: ${err?.stack ?? err}`);
        // And the consent goes back, because `takePending` already removed it
        // and a retry that succeeds must not open an account with no record of
        // the agreement. Re-parking extends its TTL, which is the cheaper of
        // the two mistakes available here.
        if (parked) {
          try { ident.putPending({ root, email, consent: parked.consent, nowImpl }); } catch { /* logged above */ }
        }
        return refuse(CODE_REFUSED_MESSAGE);
      }

      // The code was right, so the five are given back. ONLY here: a resend
      // must never reach this line, or five guesses plus a resend is ten.
      clearCodeAttempts({ root, hash });

      const cookie = await auths.startSession(req, accountId);
      // Revoke at the door. After this the only live credential for this
      // person is ours, which is the whole reason this app mints its own
      // session instead of carrying Supabase's JWT -- a JWT cannot be revoked
      // and this service holds their face. `revoke` swallows its own failures
      // by contract; a logout that fails must not undo a confirmed signup.
      if (identity?.accessToken) await sb.revoke({ accessToken: identity.accessToken });

      if (wantsHtml(req)) return redirect(res, '/onboarding', 303, { 'Set-Cookie': cookie });
      return sendJson(req, res, 200, { next: '/onboarding' }, { 'Set-Cookie': cookie });
    },

    /**
     * "Send me a new code."
     *
     * THIS ASKS SUPABASE FOR A CODE. IT USED TO SEND THE PERSON BACK TO THE
     * SIGNUP FORM, and the difference is the one gap in this slice that could
     * strand somebody. The old route reasoned that a new code needs the
     * password -- true of the signup call, which is how Supabase re-issues one
     * -- and this service deliberately keeps the password nowhere. So it 303'd
     * to `/signup?email=`, which only ever works if repeating a signup makes
     * Supabase re-send the confirmation to an unconfirmed address. THAT WAS
     * NEVER OBSERVED AGAINST THE LIVE PROJECT. If it does not hold, somebody
     * whose first code never arrived loops /verify -> /signup -> /verify with
     * no way out at all. `POST /auth/v1/resend` is the documented endpoint for
     * exactly this, needs no password, and removes the dependency.
     *
     * ONE SENTENCE, WHATEVER HAPPENED. `resendSignupCode` swallows its own
     * failures by contract: an unknown address, an address already confirmed,
     * and a second ask inside Supabase's own sixty-second window all leave
     * here as `RESEND_SENT_MESSAGE` over a 200. Rendering the difference would
     * be the account-enumeration oracle `/verify` two handlers up exists to
     * close, reopened on the page next door.
     *
     * IT DOES NOT TOUCH THE ATTEMPT COUNTER, and that is the bypass this route
     * would otherwise be. If asking for a new code returned the five guesses,
     * the limit would be five per resend rather than five per code, and a
     * script can resend as easily as it can guess.
     *
     * It is a POST and it is gated exactly as the confirm is -- limiter,
     * same-origin, anti-forgery pair -- so it cannot be aimed at somebody from
     * another site, and it answers identically whatever address it is given.
     */
    async verifyResend(req, res) {
      if (!sb) return identityUnavailable(req, res);
      // Origin first, then the limiter -- see verifyCode for why.
      if (!sameOriginPost(req)) return refuseForgery(req, res, 'verify');
      if (refuseOverLimit(req, res, 'verify', verifyPage)) return undefined;
      const body = parseSmallBody(req.headers['content-type'], await readBody(req, 4_096));
      const email = String(body.email ?? '').trim();
      const csrf = String(body.csrf ?? '');
      if (!(await auths.csrfCheck(req, csrf))) return refuseForgery(req, res, 'verify', { email });

      // Only an address-shaped value goes upstream or back onto the page --
      // the same guard `verifyPage` applies to `?email=`, for the same reason.
      // Anything else is answered identically without a pointless round trip.
      const shaped = isAddressShaped(email) ? email : '';
      if (shaped) {
        const sent = await sb.resendSignupCode({ email: shaped, clientIp: clientIpOf(req) });
        if (sent?.mailerBroken) mailerFailedAt = nowImpl().getTime();
      }

      // The token that just verified rides back out, so the person still holds
      // a valid pair for the code they are now waiting for.
      if (wantsHtml(req)) {
        // A promise of a code is withheld when this server's own mail is
        // failing -- "on its way" is the sentence that sent the reader to a
        // spam folder last time. Withheld for EVERY address, never only the
        // one that failed, so the answer stays uniform.
        const down = mailerLooksDown();
        return sendHtml(req, res, 200, verifyPage({
          email: shaped, notice: down ? null : RESEND_SENT_MESSAGE, csrf, mailerDown: down,
        }));
      }
      return sendJson(req, res, 200, { ok: true });
    },

    /**
     * Sign in.
     *
     * SUPABASE PROVES THE PASSWORD; THIS SERVER MINTS ITS OWN SESSION. Spec §5's
     * order is load-bearing and followed exactly: EXCHANGE (`signInWithPassword`)
     * -> RESOLVE (`resolveIdentity`, turning the Supabase identity into a local
     * accountId) -> USE (`startSession`, our own cookie) -> REVOKE
     * (`sb.revoke`, best-effort). After the revoke, the only live credential for
     * this person is ours -- the whole reason this app does not simply carry
     * Supabase's JWT: a JWT cannot be revoked and this service holds their face.
     *
     * ONE MESSAGE FOR EVERY FAILURE. Supabase answers an unknown email, a wrong
     * password and a rate limit DISTINGUISHABLY --
     * `invalid_credentials` / `email_not_confirmed` / `over_request_rate_limit`
     * -- and none of that, nor anything `resolveIdentity` throws, may reach the
     * page: `email_not_confirmed` alone would tell a stranger that the address
     * they typed has an account on a service that stores photographs of
     * people's faces. So every branch below renders the SAME imported constant
     * and the upstream detail goes only to the log.
     */
    async login(req, res) {
      if (!sb) return identityUnavailable(req, res);
      // Origin first, then the limiter -- see verifyCode for why.
      if (!sameOriginPost(req)) return refuseForgery(req, res, 'login');
      if (refuseOverLimit(req, res, 'login', loginPage)) return undefined;
      const body = parseSmallBody(req.headers['content-type'], await readBody(req, 4_096));
      const email = String(body.email ?? '').trim();
      const password = String(body.password ?? '');
      const next = safeNext(body.next);
      const csrf = String(body.csrf ?? '');

      // BEFORE the credentials are looked at. A post that cannot prove it came
      // from this site's own form gets no opinion on whether a password was
      // right, and no work spent finding out.
      if (!(await auths.csrfCheck(req, csrf))) return refuseForgery(req, res, 'login', { email, next });

      const ident = await identityApi();
      const refuse = (message) => {
        // The token that just verified is rendered back, so the retry the
        // person is about to make still carries a valid pair.
        if (wantsHtml(req)) return sendHtml(req, res, 401, loginPage({ error: message, email, next, csrf }));
        return sendJson(req, res, 401, { error: { status: 401, message } });
      };

      // 1. EXCHANGE.
      let identity;
      try {
        ({ identity } = await sb.signInWithPassword({ email, password, clientIp: clientIpOf(req) }));
      } catch (err) {
        logImpl(`[web] login refused: ${err?.message ?? err}`);
        return refuse(ident.BAD_CREDENTIALS_MESSAGE);
      }

      // 2. RESOLVE. Spec §6: the consent parked at signup is consumed on
      // FIRST CONFIRMED LOGIN, not only at `/verify`. Today that is not a
      // hypothetical -- the `{{ .Token }}` Supabase email template edit is
      // not done, so Supabase mails a confirmation LINK rather than a code,
      // and a person who signs up here (consent parked), clicks that link,
      // then signs in with their password reaches `resolveIdentity`'s create
      // branch for the first time right here, not at `/verify`. Passing
      // `consent: null` unconditionally would create their account with no
      // record of the agreement while the parked file expires unread --
      // silently, since `resolveIdentity` only reads what it is given. Same
      // shape as `verifyCode`'s take-then-resolve, because it is the same
      // one-time consumption reached through a different door. Unlike
      // `verifyCode`, no warning is logged when nothing is parked: there
      // every request is mid-signup and a miss is anomalous, but here a miss
      // is the ordinary case -- most logins resolve an EXISTING account
      // (`findAccountBySupabaseId` / `findAccountByEmail`, neither of which
      // reads `consent` at all), and logging on every one of those would
      // drown the one case worth seeing.
      const parked = ident.takePending({ root, email, nowImpl });

      let accountId;
      try {
        ({ accountId } = await ident.resolveIdentity({
          root, identity, consent: parked?.consent ?? null, nowImpl,
        }));
      } catch (err) {
        // FAIL CLOSED, same reasoning as `verifyCode`: a 500 here would tell an
        // attacker that Supabase accepted the password and only the local
        // resolution failed, which is exactly the fact this handler exists to
        // withhold. And the consent goes back, because `takePending` already
        // removed it and a retry that succeeds must not open an account with
        // no record of the agreement.
        logImpl(`[web] login could not resolve an identity: ${err?.stack ?? err}`);
        if (parked) {
          try { ident.putPending({ root, email, consent: parked.consent, nowImpl }); } catch { /* logged above */ }
        }
        return refuse(ident.BAD_CREDENTIALS_MESSAGE);
      }

      // 3. USE.
      const cookie = await auths.startSession(req, accountId);

      // 4. REVOKE, best-effort. `sb.revoke` (the real `createSupabaseAuth`)
      // already swallows its own errors by contract, but `sb` here is
      // whatever was injected, and this line must not trust every possible
      // implementation of that contract to hold. The person already has a
      // live session and a cookie is already computed; a throw from here
      // reaching the caller would turn a completed sign-in into a 500 with
      // the session live on disk and the cookie never delivered -- strictly
      // worse than a revoke that silently did nothing. So it is caught here
      // too, and only logged.
      if (identity?.accessToken) {
        try {
          await sb.revoke({ accessToken: identity.accessToken });
        } catch (err) {
          logImpl(`[web] login: revoke at the door failed, continuing signed in: ${err?.message ?? err}`);
        }
      }

      // 5. WHERE THIS LANDS -- task 12's obligation, and the one this route
      // was missing. `verifyCode` always lands a resolved identity on
      // `/onboarding` unconditionally -- every call it handles is a brand-new
      // signup, so there is no returning-user case to protect. The Google
      // callback (whole-branch review finding 1) now follows THIS route's own
      // rule below rather than `verifyCode`'s, because it resolves both cases:
      // this route landed on `next || '/'` unconditionally instead, which is
      // right for the ORDINARY login --
      // most logins resolve an EXISTING account with consent already on file,
      // per the comment at RESOLVE above, and diverting a returning
      // sign-in through a page it has no reason to see would be a
      // regression nobody asked for. But `consent: null` can be true of the
      // account `accountId` now names for TWO reasons, not one: this call's
      // own RESOLVE step just created it with nothing parked, or an EARLIER
      // login already did that before `/onboarding` (task 12) existed to
      // repair it. Keying on `resolveIdentity`'s `created` flag would only
      // catch the first -- an account already sitting with `consent: null`
      // from before this fix would carry the gap forever, on exactly the
      // route the review found it unreachable from. So the account's OWN
      // record is read back rather than trusted from `created`, and its
      // `consent` field -- the same field `/onboarding` itself checks -- is
      // what decides the destination. `next` is deliberately NOT honoured
      // when consent is missing: the whole point is that this account passes
      // through the one repair point, and a `next` that skipped it would
      // reopen the gap this fix exists to close.
      let needsOnboarding = false;
      try {
        needsOnboarding = ident.loadAccount({ root, accountId })?.consent == null;
      } catch (err) {
        // Same reasoning as REVOKE above: the session is already live and the
        // cookie already computed, so a throw here must not turn a completed
        // sign-in into a 500. Falling back to today's destination is the safe
        // direction -- this account still reaches `/onboarding` the next time
        // anything sends it there, or the next time this read succeeds.
        logImpl(`[web] login: could not re-read the resolved account to check consent, continuing to ${next || '/'}: ${err?.message ?? err}`);
      }
      const destination = needsOnboarding ? '/onboarding' : (next || '/');

      if (wantsHtml(req)) return redirect(res, destination, 303, { 'Set-Cookie': cookie });
      return sendJson(req, res, 200, { accountId, next: destination }, { 'Set-Cookie': cookie });
    },

    // --- "forgot password?" (spec §5, task 11) ----------------------------

    /**
     * The request form.
     *
     * NO SESSION REQUIRED AND NONE ASSUMED. A person reaching this page has,
     * by definition, no working credential -- that is the whole reason they
     * are here -- so unlike `loginPage` this does not redirect an already
     * signed-in visitor away. Their own session (if any) is untouched by
     * anything on this page; it is `resetComplete`, not this one, that ends
     * every session on the account.
     */
    async resetPage(req, res) {
      if (!sb) return identityUnavailable(req, res);
      const { token, setCookie } = await auths.csrfIssue(req);
      return sendHtml(req, res, 200, resetPage({ csrf: token }),
        setCookie ? { 'Set-Cookie': setCookie } : {});
    },

    /**
     * Send the recovery mail.
     *
     * MUST ANSWER IDENTICALLY FOR A KNOWN AND AN UNKNOWN ADDRESS -- status,
     * body AND headers -- or this becomes an account-enumeration oracle on a
     * service that stores photographs of people's faces. `sb.sendRecovery`
     * already swallows its own upstream failure and always resolves
     * `{ok: true}` for exactly this reason; this handler adds no branch that
     * could undo that guarantee. Every exit is the SAME fixed redirect,
     * whatever was typed and whatever `sendRecovery` did upstream -- and
     * that redirect names no path component or query value derived from the
     * address, because a location that echoed it back would let two
     * requests for two different addresses be told apart by comparing
     * `Location` headers, which is the same oracle wearing a different hat.
     *
     * NO RESEND ON FAILURE, AND RATE-LIMITED PER CONNECTION. Supabase's own
     * mailer sends two recovery emails an hour, project-wide; a silent retry
     * here would spend that budget on somebody else's behalf, which is why
     * this is bounded by `AUTH_RATE_LIMITS.reset` rather than retried.
     */
    async reset(req, res) {
      if (!sb) return identityUnavailable(req, res);
      // Origin first, then the limiter -- see verifyCode for why.
      if (!sameOriginPost(req)) return refuseForgery(req, res, 'reset');
      if (refuseOverLimit(req, res, 'reset', resetPage)) return undefined;
      const body = parseSmallBody(req.headers['content-type'], await readBody(req, 4_096));
      const email = String(body.email ?? '').trim();
      const csrf = String(body.csrf ?? '');

      // Same order, same reason as every other credential-adjacent post in
      // this file: proven origin before anything it says is acted on.
      if (!(await auths.csrfCheck(req, csrf))) return refuseForgery(req, res, 'reset', { email });

      // Only a shaped address is worth sending upstream at all. Skipping the
      // call for an unshaped one costs nothing here -- `sendRecovery` never
      // varies its own answer on what it was given, so the response below is
      // identical either way.
      if (isAddressShaped(email)) {
        await sb.sendRecovery({ email, clientIp: clientIpOf(req) });
      }

      const to = '/auth/reset/complete';
      if (wantsHtml(req)) return redirect(res, to, 303);
      return sendJson(req, res, 200, { next: to });
    },

    /**
     * The code-and-new-password page.
     *
     * THE ADDRESS IS NEVER PREFILLED FROM `reset`'S REDIRECT, because that
     * redirect's whole point is to carry nothing that could distinguish a
     * known address from an unknown one. The person types it again here,
     * exactly as `/verify` would have them retype nothing at all -- except
     * here there is no signup moment to have echoed it back from.
     */
    async resetCompletePage(req, res) {
      if (!sb) return identityUnavailable(req, res);
      const { token, setCookie } = await auths.csrfIssue(req);
      return sendHtml(req, res, 200, resetCompletePage({ csrf: token }),
        setCookie ? { 'Set-Cookie': setCookie } : {});
    },

    /**
     * Confirm the code, and set the new password.
     *
     * THE SAME SIX DIGITS, THE SAME FIVE GUESSES, THE SAME COUNTER. `type:
     * 'recovery'` is the only difference from `verifyCode` in what is asked
     * of Supabase; every attempt-limiting rule from spec §4.5 applies
     * unchanged, and it is enforced with the SAME `chargeCodeAttempt` /
     * `clearCodeAttempts` pair keyed on the same address hash -- not a
     * second counter, or a script could double its guess budget by choosing
     * which of the two routes to spend it against for the same code.
     *
     * ORDER, PER SPEC §5, WITH ONE INSERTION FOR THIS TASK. EXCHANGE
     * (`sb.verifyCode`) -> RESOLVE (`resolveIdentity`) -> USE
     * (`updatePassword`, which needs the access token the exchange just
     * produced and therefore must run WHILE IT IS STILL ALIVE, i.e. before
     * anything revokes it) -> destroy every session on the account -> REVOKE
     * (best-effort, wrapped exactly as `login` wraps it: the reset is
     * already complete by then, so a throw here must never turn it into a
     * failure).
     *
     * WHY EVERY DEVICE IS SIGNED OUT. A password reset happens because
     * somebody else may have had the old one. Supabase revoking its own
     * tokens does nothing to this app's sessions -- ours are the ones that
     * actually work here -- so the reset is not complete until
     * `destroySessionsForAccount` has run, and that call is unconditional:
     * it is not skipped for the account whose session, if any, made this
     * very request.
     *
     * CONSENT, HANDLED EXACTLY AS `login` HANDLES IT, NOT REINVENTED.
     * `resolveIdentity` can create an account for an identity it has never
     * resolved before; the consent parked at signup is consumed via
     * `takePending` and, if `resolveIdentity` throws, RE-PARKED so a retry
     * that later succeeds does not open an account with no record of the
     * agreement.
     *
     * NOTHING FROM `SupabaseAuthError` OR AN ACCOUNT ERROR MAY REACH THIS
     * PAGE. A wrong code, an expired code, an address with no account, and
     * an internal resolve-or-update failure all render the same imported
     * constant; the upstream detail goes only to the log.
     */
    async resetComplete(req, res) {
      if (!sb) return identityUnavailable(req, res);
      // Origin first, then the limiter -- see verifyCode for why.
      if (!sameOriginPost(req)) return refuseForgery(req, res, 'resetComplete');
      if (refuseOverLimit(req, res, 'verify', resetCompletePage)) return undefined;
      const body = parseSmallBody(req.headers['content-type'], await readBody(req, 4_096));
      const email = String(body.email ?? '').trim();
      const code = String(body.code ?? '').trim();
      const password = String(body.password ?? '');
      const csrf = String(body.csrf ?? '');

      // BEFORE the code or the password are looked at. Same order, same
      // reason as every other credential-bearing post in this file.
      if (!(await auths.csrfCheck(req, csrf))) return refuseForgery(req, res, 'resetComplete', { email });

      const refuse = (message, status = 401) => {
        // The token that just verified rides back out, so the retry the
        // person is about to make still carries a valid pair.
        if (wantsHtml(req)) return sendHtml(req, res, status, resetCompletePage({ error: message, email, csrf }));
        return sendJson(req, res, status, { error: { status, message } });
      };

      // Validation of the person's OWN new password. This is independent of
      // whether the address has an account -- a form-quality question, not
      // an existence question -- so checking it before anything is charged
      // does not open the branch the identical-response rule at `reset`
      // forbids; it is the same reasoning `signup` already applies to this
      // exact field.
      if (password.length < 10) return refuse('Please use at least ten characters.', 400);

      // An address that is not an address has no code and no counter to
      // spend, so it gets the same answer as a wrong code rather than a
      // different one -- same reasoning as `verifyCode`.
      if (!isAddressShaped(email)) return refuse(CODE_REFUSED_MESSAGE);

      const ident = await identityApi();
      let hash;
      try {
        hash = ident.emailHash(email);
      } catch {
        return refuse(CODE_REFUSED_MESSAGE);
      }
      const { allowed } = chargeCodeAttempt({ root, hash, nowImpl });
      if (!allowed) return refuse(CODE_EXHAUSTED_MESSAGE);

      // 1. EXCHANGE.
      let identity;
      try {
        ({ identity } = await sb.verifyCode({
          email, token: code, type: 'recovery', clientIp: clientIpOf(req),
        }));
      } catch (err) {
        logImpl(`[web] reset refused: ${err?.message ?? err}`);
        return refuse(CODE_REFUSED_MESSAGE);
      }

      // 2. RESOLVE, exactly as `login` does it.
      const parked = ident.takePending({ root, email, nowImpl });

      let accountId;
      try {
        ({ accountId } = await ident.resolveIdentity({
          root, identity, consent: parked?.consent ?? null, nowImpl,
        }));
      } catch (err) {
        // FAIL CLOSED, same reasoning as `login` and `verifyCode`: a 500 here
        // would tell an attacker the code was right and only our own
        // resolution failed, which is exactly the fact this handler exists
        // to withhold. The consent goes back for the same reason `login`
        // puts it back.
        logImpl(`[web] reset could not resolve an identity: ${err?.stack ?? err}`);
        if (parked) {
          try { ident.putPending({ root, email, consent: parked.consent, nowImpl }); } catch { /* logged above */ }
        }
        return refuse(CODE_REFUSED_MESSAGE);
      }

      // 3. USE -- while the access token from step 1 is still alive.
      try {
        await sb.updatePassword({ accessToken: identity.accessToken, password });
      } catch (err) {
        logImpl(`[web] reset could not set the new password: ${err?.message ?? err}`);
        return refuse(CODE_REFUSED_MESSAGE);
      }

      // The code and the new password both held, so the five guesses are
      // given back -- same rule as `verifyCode`: cleared only on complete
      // success, never on the way to it.
      clearCodeAttempts({ root, hash });

      // Every session belonging to this account, destroyed -- unconditionally,
      // and before the best-effort revoke below. This is the reset: somebody
      // changed a password because somebody else may have had it, and every
      // device signed out is the correct, noticeable behaviour.
      (await auths.api()).destroySessionsForAccount({ root, accountId });

      // 4. REVOKE, best-effort, wrapped exactly as `login` wraps it: the
      // reset already completed above, so a throw from here reaching the
      // caller would turn a completed reset into a 500 with the password
      // already changed and every session already gone -- strictly worse
      // than a revoke that silently did nothing.
      if (identity?.accessToken) {
        try {
          await sb.revoke({ accessToken: identity.accessToken });
        } catch (err) {
          logImpl(`[web] reset: revoke at the door failed: ${err?.message ?? err}`);
        }
      }

      const to = '/login?reset=done';
      if (wantsHtml(req)) return redirect(res, to, 303);
      return sendJson(req, res, 200, { next: to });
    },

    /**
     * "Sign in with Google" -- the first hop. A plain form, not a link: this
     * app ships no client JavaScript, and the button changes state -- it
     * writes a verifier to disk -- so it is a POST like every other
     * state-changing action here, carrying the same CSRF pair `loginPage` and
     * `signupPage` already render.
     *
     * ONLY THE CHALLENGE EVER LEAVES THIS MACHINE. `newVerifier` is 32 random
     * bytes that never appear in a URL, a header Google sees, or a log line.
     * `challengeFor` -- its SHA-256 -- is what travels to Supabase's
     * `/authorize`. `putVerifier` writes the verifier to a file keyed by
     * `state`; `takeVerifier` deletes that row the moment `/auth/callback`
     * reads it, whatever the outcome.
     *
     * WHY `state` RIDES INSIDE `redirectTo`. `authorizeUrl` takes no `state`
     * parameter of its own -- Supabase's authorize endpoint has nothing to
     * pass one back through. So this server's `state` is embedded in the
     * query string of the `redirect_to` URL it hands Supabase; Supabase
     * appends its own `code` to that same URL when it sends the browser back,
     * which is what `GET /auth/callback?code=&state=` arrives holding.
     *
     * A SECOND, BROWSER-BOUND COOKIE RIDES ALONGSIDE THE FILE. The file alone
     * answers "was this state ever issued, and has it been spent" -- it says
     * nothing about WHO is presenting it. Review finding, 2026-08-26: without
     * this cookie, an attacker completes their own round trip, captures
     * Supabase's redirect instead of following it, and hands that
     * `/auth/callback?state=&code=` URL to a victim as an ordinary link --
     * the victim's browser redeems a state the attacker minted and is signed
     * into the ATTACKER'S account. See `OAUTH_STATE_COOKIE` in
     * `session-middleware.mjs` for the full ruling.
     */
    async authGoogle(req, res) {
      if (!sb) return identityUnavailable(req, res);
      // Origin first, then the limiter -- see verifyCode for why.
      if (!sameOriginPost(req)) return refuseForgery(req, res, 'login');
      if (refuseOverLimit(req, res, 'google', loginPage)) return undefined;
      const body = parseSmallBody(req.headers['content-type'], await readBody(req, 4_096));
      const next = safeNext(body.next);
      const csrf = String(body.csrf ?? '');

      // BEFORE anything is written to disk. Same order, same reason, as every
      // other credential-bearing post in this file.
      if (!(await auths.csrfCheck(req, csrf))) return refuseForgery(req, res, 'login', { next });

      const oauth = await oauthApi();
      const verifier = oauth.newVerifier();
      const codeChallenge = oauth.challengeFor(verifier);
      const state = oauth.newState();
      oauth.putVerifier({ root, state, verifier, next, nowImpl });
      const stateCookie = await auths.oauthStateIssue(req, state, {
        maxAgeS: Math.floor(oauth.OAUTH_TTL_MS / 1000),
      });

      const redirectTo = `${publicBase()}/auth/callback?state=${encodeURIComponent(state)}`;
      return redirect(res, sb.authorizeUrl({ codeChallenge, redirectTo }), 303, { 'Set-Cookie': stateCookie });
    },

    /**
     * The second hop. Supabase -- having already talked to Google -- sends
     * the browser here holding a `code` and the `state` this server minted.
     *
     * `state` IS NOT DECORATIVE, AND NEITHER IS THE COOKIE. Spec §4.2: a
     * `code` arriving with no `state` this server issued -- or with one
     * already spent -- is refused before Supabase is ever asked about it.
     * That alone is not enough -- see `authGoogle`'s comment and
     * `OAUTH_STATE_COOKIE` -- so this handler ALSO demands that the request
     * carry a cookie this server signed, binding it to the exact `state`
     * being redeemed, checked in constant time and BEFORE `takeVerifier`: a
     * mismatch must never consume a legitimate pending row on somebody
     * else's behalf. `takeVerifier` deletes the row on read on every exit
     * path -- including the expired one -- which is what makes the verifier
     * single-use BY CONSTRUCTION rather than by this handler remembering to
     * enforce it.
     *
     * EXCHANGE -> RESOLVE -> USE -> REVOKE, the same order and the same
     * reasoning as `login`: this server mints its own session rather than
     * carrying Supabase's token, so the revoke happens only after our cookie
     * is live, and its failure is swallowed rather than allowed to undo a
     * completed sign-in.
     *
     * GOOGLE GETS NO CODE. `identityFrom` in `supabase-auth.mjs` reads
     * `email_confirmed_at` off Google's own reply, which arrives already
     * true, so routing this identity through the six-digit flow would ask
     * somebody to re-prove a mailbox Google already vouched for. This handler
     * goes straight from a resolved identity to a session.
     *
     * ONE SENTENCE FOR EVERY FAILURE, whatever actually happened -- a state
     * this browser was never bound to, one already spent, an exchange
     * Supabase refused, or a resolution that could not complete.
     * `SupabaseAuthError`'s `.code`, `.status` and `.message`, and an account
     * error's `.accountId`, are logged and never rendered. Rendered directly
     * (not thrown as an `HttpError`) so every exit -- success or failure --
     * can carry the `Set-Cookie` that clears the binding cookie; the shared
     * `fail()` path has no seam for extra headers.
     */
    async authCallback(req, res, { query }) {
      if (!sb) return identityUnavailable(req, res);
      const state = String(query?.get('state') ?? '');
      const code = String(query?.get('code') ?? '');
      const clearStateCookie = auths.oauthStateClear(req);

      const refuseOAuth = () => {
        if (wantsHtml(req)) {
          return sendHtml(req, res, 400, errorPage({ status: 400, title: OAUTH_FAILED_MESSAGE, detail: null }),
            { 'Set-Cookie': clearStateCookie });
        }
        return sendJson(req, res, 400,
          { error: { status: 400, message: OAUTH_FAILED_MESSAGE, code: 'OAUTH_FAILED' } },
          { 'Set-Cookie': clearStateCookie });
      };

      // BEFORE `takeVerifier`. A state this browser was not bound to must
      // never consume a legitimate pending row -- see the ruling above.
      if (!(await auths.oauthStateCheck(req, state))) return refuseOAuth();

      const oauth = await oauthApi();
      const taken = oauth.takeVerifier({ root, state, nowImpl });
      if (!taken) return refuseOAuth();

      // 1. EXCHANGE.
      let identity;
      try {
        ({ identity } = await sb.exchangeCode({
          authCode: code, codeVerifier: taken.verifier, clientIp: clientIpOf(req),
        }));
      } catch (err) {
        logImpl(`[web] google callback exchange refused: ${err?.message ?? err}`);
        return refuseOAuth();
      }

      // 2. RESOLVE. Spec §6, the same obligation `login` carries: a person
      // who started an email/password signup (parking consent under this
      // address) and then finished with Google before ever typing a code
      // must not open an account with no record of the agreement. Keyed on
      // the identity's OWN email -- already lower-cased and trimmed by
      // `identityFrom` -- rather than anything from the query string, which
      // carries no email at all.
      const ident = await identityApi();
      const parked = ident.takePending({ root, email: identity.email, nowImpl });

      let accountId;
      try {
        ({ accountId } = await ident.resolveIdentity({
          root, identity, consent: parked?.consent ?? null, nowImpl,
        }));
      } catch (err) {
        // FAIL CLOSED, same reasoning as `login` and `verifyCode`: a 500 here
        // would tell an attacker that the exchange succeeded and only local
        // resolution failed, which is exactly the fact this handler exists to
        // withhold. And the consent goes back, because `takePending` already
        // removed it and a retry that succeeds must not open an account with
        // no record of the agreement.
        logImpl(`[web] google callback could not resolve an identity: ${err?.stack ?? err}`);
        if (parked) {
          try { ident.putPending({ root, email: identity.email, consent: parked.consent, nowImpl }); } catch { /* logged above */ }
        }
        return refuseOAuth();
      }

      // 3. USE.
      const cookie = await auths.startSession(req, accountId);

      // 4. REVOKE, best-effort -- same reasoning as `login`: the person
      // already has a live session and a cookie is already computed, so a
      // throw from here reaching the caller would turn a completed sign-in
      // into a 500 with the session live on disk and the cookie never
      // delivered. Caught here too, and only logged.
      if (identity?.accessToken) {
        try {
          await sb.revoke({ accessToken: identity.accessToken });
        } catch (err) {
          logImpl(`[web] google callback: revoke at the door failed, continuing signed in: ${err?.message ?? err}`);
        }
      }

      // 5. WHERE THIS LANDS -- whole-branch review finding 1: this handler
      // used to honour `taken.next` unconditionally, which is the opposite of
      // `login`'s own rule a few hundred lines above (see the comment at
      // `login`'s REVOKE-adjacent redirect). `authCallback` is the OTHER route
      // that can open an account with no consent on file -- a signed-out
      // visitor hitting a gated page is sent to `/login?next=...`, and a
      // brand-new Google account with nothing parked must pass through the
      // one repair point exactly as a brand-new password account does, or
      // `next` reopens the gap `/onboarding` (task 12) exists to close.
      // Copied from `login`'s shape rather than reinvented: the account's OWN
      // record is read back rather than trusted from `resolveIdentity`'s
      // `created` flag, for the identical reason -- an account already
      // sitting with `consent: null` from before either fix existed must
      // still be caught, not only one this exact call just created.
      let needsOnboarding = false;
      try {
        needsOnboarding = ident.loadAccount({ root, accountId })?.consent == null;
      } catch (err) {
        // Same reasoning as REVOKE above: the session is already live and the
        // cookie already computed, so a throw here must not turn a completed
        // sign-in into a 500. Falling back to today's destination is the safe
        // direction -- this account still reaches `/onboarding` the next time
        // anything sends it there, or the next time this read succeeds.
        logImpl(`[web] google callback: could not re-read the resolved account to check consent, continuing to ${safeNext(taken.next) || '/'}: ${err?.message ?? err}`);
      }
      const destination = needsOnboarding ? '/onboarding' : (safeNext(taken.next) || '/');

      return redirect(res, destination, 303, {
        'Set-Cookie': [cookie, clearStateCookie],
      });
    },

    async signup(req, res) {
      if (!sb) return identityUnavailable(req, res);
      // Origin first, then the limiter -- see verifyCode for why.
      if (!sameOriginPost(req)) return refuseForgery(req, res, 'signup');
      if (refuseOverLimit(req, res, 'signup', (opts) => signupPage({ ...opts, consentText }))) return undefined;
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

      // Shape only. A real address is proved by a mail round trip, which the
      // code flow now does; refusing something that is obviously not an address
      // is still worth the one line. `isAddressShaped` is shared with the
      // code-entry routes so the two cannot drift into disagreeing about what
      // an address is.
      if (!isAddressShaped(email)) {
        return reject('That does not look like an email address.');
      }
      if (password.length < 10) {
        return reject('Please use at least ten characters.');
      }
      if (!CONSENT_YES.has(String(body.consent ?? '').trim().toLowerCase())) {
        return reject('Please confirm the statement before creating an account.');
      }

      // BOTH CHECKS, AND THEY ARE NOT THE SAME CHECK -- whole-branch review
      // finding 2, same reasoning `verifyCode` and `resetComplete` already
      // carry next to their own `emailHash` calls. `isAddressShaped` above is
      // this file's cheap shape test; `emailHash` runs `normaliseEmail`,
      // which is STRICTER (`a@b..com` passes the first and throws on the
      // second). `putPending` below calls `emailHash` internally and would
      // throw UNCAUGHT -- a third response shape (a 500) on the one route
      // whose §4.4 contract just above is "two outcomes, one page". Checked
      // here, before the upstream call, so a shape Supabase would also refuse
      // never spends one.
      const ident = await identityApi();
      try {
        ident.emailHash(email);
      } catch {
        return reject('That does not look like an email address.');
      }

      // FROM HERE THE TWO OUTCOMES -- A FRESH ADDRESS AND ONE THAT ALREADY HAS
      // AN ACCOUNT -- MUST RENDER THE SAME PAGE. Supabase answers a taken
      // address with `user_already_exists` / 422 unless BOTH email and phone
      // confirmation are on, and this project has phone confirmation OFF
      // (verified against the live project 2026-08-26), so it takes the
      // leaking path. Closing that by adopting SMS would mean paying Twilio to
      // hide a string Supabase already tells us not to repeat. So the upstream
      // answer is asked for, logged, and THROWN AWAY -- deliberately, and this
      // comment is why: whatever Supabase said, signup below still parks the
      // consent and sends the person to `/verify`, which is the only place
      // that finds out which branch actually happened. Spec §4.4.
      try {
        await sb.signUp({ email, password, clientIp: clientIpOf(req) });
      } catch (err) {
        // `SupabaseAuthError` carries `.code` (the raw `error_code`), `.status`
        // and `.message` -- none of the three may reach the response, or the
        // "same page either way" guarantee above is just a comment. The log
        // is the only place any of it goes.
        logImpl(`[web] signup upstream: ${err?.message ?? err}`);
        // The answer is still thrown away for the RESPONSE -- §4.4 is
        // untouched. All that is kept is whether OUR mailer worked.
        noteMailFailure(err);
      }

      // Parked BEFORE the redirect, so a code typed a moment later finds it:
      // `/verify` reads this same file via `takePending`. Consent never goes
      // to Supabase -- it is an agreement with this service, not proof of a
      // mailbox -- so it is recorded here regardless of what Supabase said.
      // `emailHash` was already proved to succeed on this exact string above
      // (pure and deterministic -- no side effect that a second call could
      // disagree with), so this cannot throw the way it used to.
      ident.putPending({
        root, email, consent: recordConsent({ granted: true, text: consentText, nowImpl }), nowImpl,
      });

      const to = `/verify?email=${encodeURIComponent(email)}`;
      if (wantsHtml(req)) return redirect(res, to, 303);
      return sendJson(req, res, 202, { next: to });
    },

    /** Destroys the server-side record as well as the cookie. That is the whole
     *  reason sessions are opaque ids rather than JWTs: a token cannot be
     *  revoked, and this app can hand somebody else's face to whoever holds one. */
    async logout(req, res) {
      // A FOREIGN PAGE CANNOT SIGN SOMEBODY OUT.
      //
      // This was the one state-changing route with neither gate, and it is not
      // a session-integrity break: SameSite=Lax withholds the cookie on a
      // cross-site POST, so `endSession` finds nothing and no record dies. But
      // the response still carried the Max-Age=0 clearing cookie, which a
      // browser applies on a top-level navigation to this origin -- so a
      // foreign page could sign the victim out at a moment of its choosing.
      // Mid-upload, or as a phishing premise, which is worse here because
      // `/login` already renders an unauthenticated notice a forged link can
      // trigger.
      //
      // The same-origin check alone, not the full CSRF pair: the nav form has
      // no token to give, threading one into every page render is a much larger
      // change, and this attack has to come from a browser to work -- every
      // browser that can mount it sends `Sec-Fetch-Site`.
      if (!sameOriginPost(req)) {
        return sendJson(req, res, 403,
          { error: { code: 'NOT_FROM_THIS_SITE', message: 'We could not confirm that came from this site.', status: 403 } });
      }
      const cookie = await auths.endSession(req);
      // THE LANDING, NOT /login. Answering "I am leaving" with a password field
      // reads as "sign back in", and /login also renders an unauthenticated
      // notice -- so somebody who signed out on purpose could be met by what
      // looks like a failure. The landing is where a signed-out person belongs,
      // and its masthead already carries a Sign in link for anybody who was
      // actually swapping accounts.
      if (wantsHtml(req)) return redirect(res, '/', 303, { 'Set-Cookie': cookie });
      return sendJson(req, res, 200, { ok: true }, { 'Set-Cookie': cookie });
    },

    // --- where a new account first lands (spec §10, task 12) --------------

    /**
     * `/onboarding`. Gated by the top-level session check exactly like every
     * other signed-in page -- it is not in `PUBLIC_ROUTES`, so a signed-out
     * request never reaches this function at all; `handler` above already 303s
     * it to `/login`. Nothing here re-implements that.
     *
     * WHY THIS IS WHERE `consent: null` GETS REPAIRED. A code confirmed after
     * its parked consent expired, or a login that created the account with
     * nothing parked, opens an account with no record of the agreement --
     * `login` and `verifyCode` both log it and proceed rather than stranding
     * someone who has already proved their mailbox. Every route that can open
     * an account redirects here, so this is the one place guaranteed to see
     * every such account before it does anything else. The ordinary content
     * below is deliberately thin -- see the header of `onboardingPage` in
     * views-auth.mjs for why more than this would be inventing scope.
     */
    async onboardingPage(req, res, { account }) {
      if (account.consent == null) {
        const { token, setCookie } = await auths.csrfIssue(req);
        return sendHtml(req, res, 200, onboardingPage({ account, consentText, csrf: token }),
          setCookie ? { 'Set-Cookie': setCookie } : {});
      }
      // NOTHING TO ASK MEANS NOTHING TO RENDER. This used to answer with a
      // headline, one sentence and a link to `/` -- no form and no decision --
      // which put a click between a person and the shelf on the one route
      // every newly-opened account is deliberately funnelled through. The
      // repair above is this page's entire reason to exist; once it is done
      // there is no page, only a destination.
      if (wantsHtml(req)) return redirect(res, '/', 303);
      return sendJson(req, res, 200, { next: '/' });
    },

    /**
     * The consent this account was missing, given now.
     *
     * SAME GATE AS EVERY OTHER STATE-CHANGING FORM ON THE SITE: same-origin
     * check first, then the signed anti-forgery pair, both before the tick box
     * is even looked at. This route is reachable whatever `account.consent`
     * already holds -- a repost of a stale tab, say -- and the mutator below
     * only ever writes the field when it is still `null`, so replaying this
     * post is a no-op rather than a second, different consent record
     * overwriting the first.
     *
     * WRITTEN THROUGH `updateAccount`, THE ONLY SANCTIONED WAY. `accounts.mjs`
     * loads the account fresh, hands it to the mutator, and saves it back
     * under that account's own lock -- the same primitive `credits.mjs` uses
     * to debit a balance, and for the same reason: this process is not the
     * only writer of this file, and a plain read-mutate-write here could lose
     * a concurrent update to the same account.
     */
    async onboardingConsent(req, res, { account }) {
      const reject = async (status, message, code) => {
        const { token, setCookie } = await auths.csrfIssue(req);
        const headers = setCookie ? { 'Set-Cookie': setCookie } : {};
        if (wantsHtml(req)) {
          return sendHtml(req, res, status,
            onboardingPage({ account, consentText, csrf: token, error: message }), headers);
        }
        return sendJson(req, res, status, { error: { status, message, ...(code ? { code } : {}) } }, headers);
      };

      // Same order as every other credential-adjacent form on this site: proof
      // of origin before the body is even read.
      if (!sameOriginPost(req)) {
        return reject(403, 'We could not confirm that came from this site. Please try again below.', 'NOT_FROM_THIS_SITE');
      }
      const body = parseSmallBody(req.headers['content-type'], await readBody(req, 4_096));
      const csrf = String(body.csrf ?? '');
      if (!(await auths.csrfCheck(req, csrf))) {
        return reject(403, 'We could not confirm that came from this site. Please try again below.', 'NOT_FROM_THIS_SITE');
      }
      if (!CONSENT_YES.has(String(body.consent ?? '').trim().toLowerCase())) {
        return reject(400, 'Please confirm the statement before continuing.');
      }

      const ident = await identityApi();
      ident.updateAccount({ root, accountId: account.accountId, nowImpl }, (record) => {
        if (record.consent == null) {
          record.consent = recordConsent({ granted: true, text: consentText, nowImpl });
        }
      });

      // The shelf, not back here. Post/Redirect/Get is what makes the reload
      // safe, and `/` satisfies it exactly as well as `/onboarding` did -- the
      // difference is that this one is where the person was going.
      if (wantsHtml(req)) return redirect(res, '/', 303);
      return sendJson(req, res, 200, { next: '/' });
    },

    // --- the account itself (deletion spec 2026-08-29) ---------------------

    /**
     * `/account`. Gated by the top-level session check like `/onboarding`;
     * works without Supabase on purpose -- reading what the service holds
     * about you and taking a copy must not depend on the identity provider
     * being up. Only the deletion POST below needs the upstream half.
     */
    /** `GET /videos` -- every tape this account has made, playable and
     *  downloadable in place. The tapes come from the same `shelfFor` the home
     *  page uses, so this adds no new path to anybody else's media. */
    async videosPage(req, res, { account }) {
      return sendHtml(req, res, 200, videosPage({
        account,
        balance: await balanceOf(account),
        tapes: shelfFor(account),
        retentionDays: cfg.retention?.jobDays ?? null,
      }));
    },

    async accountPage(req, res, { account }) {
      const [{ token, setCookie }, balance] = await Promise.all([
        auths.csrfIssue(req), balanceOf(account),
      ]);
      return sendHtml(req, res, 200, accountPage({ account, balance, csrf: token }),
        setCookie ? { 'Set-Cookie': setCookie } : {});
    },

    /**
     * `GET /api/account/export` -- one JSON document: the account record, the
     * projected ledger, and per owned job the order metadata. Spec §2.
     *
     * THE ACCOUNT BLOCK IS AN ALLOW-LIST, NEVER A SPREAD. `account` non-
     * enumerably hides `root` and `paths`, but its ENUMERABLE fields include
     * `password` (the scrypt hash), `rev` and `emailHash` -- a spread-and-
     * delete here would be one forgotten field away from mailing a person
     * their own hash, and a rename away from doing it silently. Naming what
     * ships is the only shape that fails safe.
     *
     * NOT THE MEDIA FILES. The person already holds download URLs for every
     * tape on their shelf; a multi-hundred-MB zip is a different feature.
     */
    async accountExport(req, res, { account }) {
      const mod = await auths.api();
      // Feature-detected, not REQUIRED_AUTH (spec §5): a fake without the
      // ledger projection makes this route say so, not the whole app fall.
      if (typeof mod.ledgerFor !== 'function') {
        throw new HttpError(503, 'The export is not available right now.', { code: 'AUTH_UNAVAILABLE' });
      }

      const jobs = [];
      for (const jobId of auths.jobIdsFor(account.accountId)) {
        const receipt = auths.claimOf({ accountId: account.accountId, jobId });
        const row = {
          jobId,
          orderedAt: receipt?.at ?? null,
          resolution: receipt?.resolution ?? null,
          credits: receipt?.credits ?? null,
        };
        try {
          const job = readJob(jobId);
          jobs.push({
            ...row,
            status: job.status,
            createdAt: job.createdAt ?? null,
            updatedAt: job.updatedAt ?? null,
            place: job.input?.place?.value ?? null,
            outfit: job.input?.outfit?.value ?? null,
            aspect: job.input?.aspect ?? null,
            resolution: row.resolution ?? job.input?.resolution ?? null,
          });
        } catch {
          // The tape is already purged; the ownership receipt is what remains,
          // and it is still the person's data.
          jobs.push({ ...row, status: 'deleted' });
        }
      }

      return sendJson(req, res, 200, {
        exportedAt: nowImpl().toISOString(),
        account: {
          accountId: account.accountId,
          email: account.email,
          plan: account.plan,
          supabaseUserId: account.supabaseUserId,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
          consent: account.consent,
        },
        ledger: mod.ledgerFor(account),
        jobs,
      }, { 'Content-Disposition': 'attachment; filename="timestamp-export.json"' });
    },

    /**
     * `POST /account/delete` -- the one-way door. Spec §1 and §4.
     *
     * GATE ORDER, and every refusal must leave everything standing: Supabase
     * configured (the admin call is step one of the deletion, so without it
     * this answers 503 like the other identity routes), then proof of origin
     * BEFORE the body is read, then the anti-forgery pair, then the typed
     * address -- compared normalised, because ME@EXAMPLE.COM is the same
     * address `normaliseEmail` already says it is. Only then does
     * `deleteAccountEverywhere` run the order it owns.
     */
    async accountDelete(req, res, { account }) {
      const reject = async (status, message, code) => {
        const [{ token, setCookie }, balance] = await Promise.all([
          auths.csrfIssue(req), balanceOf(account),
        ]);
        const headers = setCookie ? { 'Set-Cookie': setCookie } : {};
        if (wantsHtml(req)) {
          return sendHtml(req, res, status,
            accountPage({ account, balance, csrf: token, error: message }), headers);
        }
        return sendJson(req, res, status, { error: { status, message, code } }, headers);
      };

      if (!sb) return identityUnavailable(req, res);
      if (!sameOriginPost(req)) {
        return reject(403, 'We could not confirm that came from this site. Please try again below.', 'NOT_FROM_THIS_SITE');
      }
      const body = parseSmallBody(req.headers['content-type'], await readBody(req, 4_096));
      if (!(await auths.csrfCheck(req, String(body.csrf ?? '')))) {
        return reject(403, 'We could not confirm that came from this site. Please try again below.', 'NOT_FROM_THIS_SITE');
      }
      const typed = String(body.confirm ?? '').trim().toLowerCase();
      if (typed === '' || typed !== account.email) {
        return reject(400, 'Type your account’s email address exactly to confirm the deletion.', 'CONFIRM_MISMATCH');
      }

      const mod = await auths.api();
      // Feature-detected, not REQUIRED_AUTH (spec §5) -- an auth module
      // without the deletion half makes this route unavailable, not the app.
      if (typeof mod.deleteAccount !== 'function' || typeof mod.destroySessionsForAccount !== 'function') {
        return reject(503, 'Account deletion is not available right now.', 'AUTH_UNAVAILABLE');
      }

      let result;
      try {
        result = await deleteAccountEverywhere({
          root, accountId: account.accountId, api: mod, supabase: sb, isClaimed, nowImpl,
        });
      } catch (err) {
        if (err instanceof DeletionError && err.code === 'JOB_CLAIMED') {
          return reject(409, 'A tape is still rendering. Cancel it first, then delete the account.', 'JOB_CLAIMED');
        }
        if (err instanceof DeletionError && err.code === 'IDENTITY_UNAVAILABLE') {
          return identityUnavailable(req, res);
        }
        throw err;
      }

      // The operator's lines. The person is gone and the page must say
      // nothing more than "done" -- but a pending refund is money, and a file
      // that would not delete is the F2 shape, so both are announced where
      // the operator reads.
      logImpl(`[web] account ${result.accountId} deleted: supabase ${JSON.stringify(result.supabase)}, `
        + `${result.jobsDeleted} job(s), ${result.sessionsDestroyed} session(s)`);
      for (const held of result.pendingRefunds) {
        logImpl(`[web] REFUND HELD outlives deleted account ${result.accountId}: job ${held.jobId}, `
          + `${held.credits ?? '?'} CR -- npm run refunds`);
      }
      for (const failure of result.errors) {
        logImpl(`[web] deletion of account ${result.accountId} could not remove ${failure.path ?? failure.jobId}: `
          + `${failure.code ?? ''} ${failure.message}`);
      }

      const cookie = await auths.endSession(req);
      if (wantsHtml(req)) return redirect(res, '/', 303, { 'Set-Cookie': cookie });
      return sendJson(req, res, 200, { deleted: true }, { 'Set-Cookie': cookie });
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
        // WITHDRAWN PLANS ARE NOT OFFERED, filtered here for the same reason a
        // 1080p row never reaches the page: the config decides what is on sale,
        // and the view renders what it is handed. `shelf` and `archive` are
        // still legal ids an account may hold -- they are simply not choices.
        plans = Object.values(mod.PLANS ?? {}).filter((p) => p.available !== false);
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
        // HOW LONG A TAPE SURVIVES, TAKEN FROM THE THING THAT DELETES IT. The
        // page used to promise "Every tape stays on your shelf" on every card
        // while `npm run purge` removed the video after `retention.jobDays`.
        // Reading the window from the same config the purge reads means the
        // promise and the deletion cannot drift apart in a later edit.
        retentionDays: cfg?.retention?.jobDays ?? null,
        // WHERE STRIPE SENDS SOMEBODY BACK TO, AND IT GRANTS NOTHING. This is a
        // query parameter on a public page: anybody can type it, so it may
        // change what the page SAYS and may never change what an account HAS.
        // The credits arrive on the webhook, which is a different request with
        // a signature on it.
        checkout: query?.get('checkout') ?? null,
      }));
    },

    // --- the legal pages ---------------------------------------------------
    // Static prose over one config value. The retention numbers on /privacy
    // come from the same config the purge sweep reads, for the same reason the
    // pricing page reads its retention line from it: a promise and its
    // enforcement must not be able to drift apart in a later edit.

    async privacyPage(req, res, { account }) {
      sendHtml(req, res, 200, privacyPage({
        entity: legalEntity,
        retention: cfg?.retention ?? {},
        imageProcessor,
        account: account ?? null,
      }));
    },

    async termsPage(req, res, { account }) {
      sendHtml(req, res, 200, termsPage({ entity: legalEntity, account: account ?? null }));
    },

    async impressumPage(req, res, { account }) {
      sendHtml(req, res, 200, impressumPage({ entity: legalEntity, account: account ?? null }));
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
      // Section 28 item 4's gate, on the route that opens a payment. The
      // double-submit token is deliberately not required here: this is an
      // API route with SameSite=Lax on the session cookie, and the browser's
      // own Sec-Fetch-Site/Origin account is checked instead -- absence
      // passes for non-browser clients, a foreign origin never does.
      if (!sameOriginPost(req)) return refuseCrossSite(req, res);
      const body = parseSmallBody(req.headers['content-type'], await readBody(req, 4_096));

      // THE ONE THING THIS FORM CARRIES BESIDES THE PACK ID, and it is not a
      // preference -- it is what makes "credits are not redeemable for money"
      // on /terms a true sentence rather than a wish.
      //
      // Credits are supplied the instant the payment lands. A customer who
      // never expressly asked for that, and was never told what asking costs
      // them, keeps a cancellation right the terms were quietly denying. The
      // obligation travels with the SELLER rather than the buyer's address, so
      // this is the same rule on every sale, to anyone, anywhere -- there is no
      // region branch here and there must not be one.
      //
      // CHECKED HERE AND NOT ONLY IN THE MARKUP, because `required` on a
      // checkbox is a suggestion to anything that is not a browser. Set
      // membership rather than truthiness, the same rule and the same reason as
      // CONSENT_YES at signup: "false" and "0" are non-empty strings.
      //
      // It carries no amount, no credit count and no price, so the property the
      // checkout form was built around is intact -- nothing a browser sends can
      // change what is charged.
      if (!CONSENT_YES.has(String(body.withdrawal ?? '').trim().toLowerCase())) {
        throw new HttpError(400,
          'Please confirm you want your credits straight away before paying.',
          { code: 'WITHDRAWAL_NOT_ACCEPTED' });
      }

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
        // a payment. Acknowledged, and nothing granted -- and SAID, because a
        // 200 is the one answer Stripe never retries and never lists. The
        // checkout body names cards only, so this branch should never run; if
        // it does, a method that settles later has been enabled somewhere and
        // the money will arrive on an event nobody is subscribed to. The line
        // names the event and the session so both can be found in the
        // Dashboard and the credits granted by hand.
        logImpl(`[web] stripe event ${event.id}: session ${session.id ?? 'unknown'} completed UNPAID `
          + `(payment_status ${JSON.stringify(session.payment_status ?? null)}) -- nothing granted; `
          + 'if this pays later it must be credited by hand');
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

    /**
     * The crawler-facing half of `indexable`; the `X-Robots-Tag` header on
     * every response is the other, and either alone would be enough for a
     * well-behaved bot. Both exist because they fail differently: the header
     * covers a URL nobody thought to list, and this file is what an operator
     * (and a crawler that never requests a page) can read directly.
     *
     * THE JOB ROUTES ARE DISALLOWED IN BOTH MODES. Opening the marketing site
     * to search engines must not open the artefacts with it -- a tape is
     * somebody's face, and `/j/<id>` urls are unguessable rather than secret.
     */
    async robots(req, res) {
      const body = indexable
        ? 'User-agent: *\nDisallow: /j/\nDisallow: /api/\nDisallow: /account\n'
        : 'User-agent: *\nDisallow: /\n';
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        ...BASE_SECURITY_HEADERS,
      });
      res.end(body);
    },

    // --- API -------------------------------------------------------------

    async health(req, res, { account = null } = {}) {
      const ffmpeg = await ffmpegHealth();
      const { stats, lastSeen } = queueHealth();
      const disk = diskHealth();

      // `disk.low !== true` and not `!disk.low`, deliberately: an unreadable
      // figure (low: null) must not take ok down while orders still land.
      const degraded = [
        ...(ffmpeg.available ? [] : ['ffmpeg']),
        ...(stats !== null ? [] : ['queue']),
        ...(disk.low === true ? ['disk'] : []),
      ];
      const ok = degraded.length === 0;

      // TWO ANSWERS FROM ONE ENDPOINT. The route is public because the uptime
      // monitor has no session, and it keys on the literal `"ok":true` and
      // nothing more -- so `ok` is the first key and `degraded` names the
      // failing part, which is what an alert needs and all it needs. The rest
      // -- the exact ffprobe build, disk bytes, queue counts, which provider
      // is wired -- is an operator's report, and a build string is also the
      // first thing anyone targeting the upload decoder would ask for. It is
      // answered to a session and to nobody else.
      if (!account) {
        return sendJson(req, res, 200, { ok, degraded });
      }
      return sendJson(req, res, 200, {
        ok,
        degraded,
        ffmpeg,
        queue: stats,
        worker: { lastSeen, inFlight: stats?.claimed ?? null },
        disk,
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
      // The same gate as checkout, on the route that debits credits --
      // decided before the multipart body streams, so a forged post lands no
      // photograph and moves no money.
      if (!sameOriginPost(req)) return refuseCrossSite(req, res);
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
            // `Object.hasOwn` IS THE LOAD-BEARING PART, exactly as it is on the
            // billing page. `part.name` is attacker-chosen text out of
            // Content-Disposition, and `Object.freeze` seals the object without
            // removing Object.prototype from its chain -- so a part named
            // `constructor`, `__proto__`, `toString`, `valueOf` or
            // `hasOwnProperty` returned a truthy inherited member, sailed past
            // the `if (!rel)` guard, and got stringified into a destination
            // path. Measured: a part named `constructor` wrote a file called
            // `function Object() { [native code] }` into the job directory.
            //
            // Bounded -- no reachable prototype value stringifies to anything
            // containing a separator, so it was never traversal -- but it is a
            // file the retention purge does not know by name, and this is the
            // second place the same pattern has appeared.
            const rel = Object.hasOwn(UPLOAD_NAMES, part.name) ? UPLOAD_NAMES[part.name] : null;
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

        // A CARD AND A PHOTOGRAPH ARE TWO ANSWERS TO ONE QUESTION, AND THIS
        // REFUSES RATHER THAN PICKING ONE (2026-08-30).
        //
        // A `display:none` file input still submits. So the own-place upload,
        // once filled, rides along even after the block is hidden by clicking a
        // preset -- and this handler used to take `placePhoto` as authoritative
        // for `kind` while reading the caption from `firstFilled(fields.place,
        // ...)`, which produced `{kind:'photo', value:'ostsee-strand'}`: the
        // customer's own garden photograph captioned with the beach preset.
        // Nothing downstream could tell that had happened.
        //
        // It was reachable before and it is one click away now that the upload
        // leads step 3, so it is named. Same rule as the unavailable resolution
        // and the unavailable shape below: refuse, rather than quietly render
        // something the person did not ask for. The message has to name BOTH
        // halves or it reads as "your upload was rejected".
        //
        // The test is a NON-EMPTY `place`, not a resolvable preset id. That
        // field is the card channel and the form can only ever put a preset id
        // or an empty string in it, so anything else in it came from a
        // hand-written POST and is ambiguous by construction.
        if (placePhoto && String(fields.place ?? '').trim()) {
          throw new HttpError(400,
            'You chose a place from the row and also uploaded a photo of a place. Pick one — either remove the photo, or choose "Use my own place".',
            { code: 'PLACE_CONFLICT' });
        }

        // `place` is the card (a preset id, or empty for "use my own place");
        // `placeText` is the "or describe it" box. The card wins, because a
        // person who did both meant the one they clicked.
        const placeText = cleanText(firstFilled(fields.place, fields.placeText), 'place', {
          required: placePhoto === null,
        });
        const outfitText = cleanText(firstFilled(fields.outfit, fields.outfitText), 'outfit', { required: true });
        refuseStillCount(fields.stillCount);

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

        const credits = await costOf(resolution, aspect);
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
          // ONE, CHOSEN BY NOBODY. The count left the page on 2026-08-29 --
          // the product is four choices and a tape, and the customer never
          // meets a still (PRODUCT.md). On the still path (the fixture, i.e.
          // the dev loop) one still auto-selects and the render continues; on
          // the direct path compose zeroes it, because no still is bought.
          stillCount: 1,
          // THE MODE RIDES THE MANIFEST, because the manifest is the only
          // channel between this process and the renderer. Paid provider =
          // direct: the four choices become ONE reference-to-video call, and
          // the still stage -- which on fal is deliberately gated behind an
          // unverified model -- never runs. The fixture keeps the still path:
          // its 8s clip cap is the segment-chaining guard, so a direct fixture
          // job would refuse at compose (DIRECT_NEEDS_ONE_CALL) and the dev
          // loop would render nothing.
          direct: PAID_PROVIDER_IDS.includes(provider),
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
      sendJson(req, res, 200, jobView(ownedJob(account, params.id), { account }));
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
      // `noStore`: a generated face, never kept by the browser past this view.
      if (!still || !sendFile(req, res, { file: still.file, noStore: true })) {
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
      // Same gate as `createJob` and `checkout`, and for the same reason: this
      // is a state-changing POST that commits work. It records the choice,
      // flips the job to `running` and re-enqueues it. The header check comes
      // first, before the ownership lookup and before the body is drained, so
      // a forgery costs a header comparison and nothing else.
      //
      // `sameOriginPost` and not the full anti-forgery pair: the contact sheet
      // is a plain form carrying no token, exactly as at `checkout` -- see the
      // reasoning there. `SameSite=Lax` on the session cookie already stops the
      // browser case, but that is a cookie attribute defined in another file
      // and this route should not depend on it silently.
      if (!sameOriginPost(req)) return refuseCrossSite(req, res);
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
        // A person's own tape, never kept by the browser past this view -- on
        // a shared machine `private, max-age` replays it after sign-out.
        noStore: true,
        download: asAttachment ? `timestamp-${job.jobId}.mp4` : null,
      })) {
        throw new HttpError(404, 'This job has no video yet.', { code: 'NO_VIDEO' });
      }
    },

    getPoster(req, res, { params, account }) {
      const job = ownedJob(account, params.id);
      if (!sendFile(req, res, { file: jobPaths(root, job.jobId).poster, contentType: 'image/jpeg', noStore: true })) {
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

  /**
   * The still count is not a choice any more, so a posted one is refused.
   *
   * The page stopped offering "How many looks" on 2026-08-29 -- the product is
   * four choices and a tape, and the customer never meets a still. The rule
   * that governed the old validator is unchanged: `fal.mjs` generates one
   * BILLED image per still while `costOf` takes only (resolution, aspect), so
   * a count in a hand-written POST is a request for unpriced provider spend.
   * The accepted set is the offered set, and the offered set is now empty.
   *
   * An empty or absent field says nothing and passes -- the input block writes
   * the only count this server uses.
   */
  function refuseStillCount(value) {
    if (value === undefined || value === null || String(value).trim() === '') return;
    throw new HttpError(400, 'How many stills to make is not a choice on this product.', { code: 'BAD_STILL_COUNT' });
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
   *
   * THE TEARDOWN IS A FIN AND NOT AN RST, AND THAT DISTINCTION IS THE WHOLE
   * POINT OF THIS BRANCH. `destroy()` on a socket that still has unread inbound
   * data sends a reset, and a reset discards the response that was just written
   * -- so the refusal this function exists to deliver never arrived whenever
   * the sender was still mid-upload, which is precisely when `closeConnection`
   * is set. Measured: a body four times the cap got `ECONNRESET` and no status
   * at all. `end()` sends FIN, the already-flushed response survives, and the
   * caller can read why it was refused.
   *
   * The grace timer is what keeps the original guarantee. FIN asks the peer to
   * stop; a client that ignores it could otherwise hold the socket open, which
   * is the very thing the abrupt close was there to prevent. `unref` so a
   * pending timer never keeps the process alive.
   */
  function fail(req, res, status, title, detail, jobId = null, { closeConnection = false, code = null } = {}) {
    if (res.headersSent) { res.end(); return; }
    if (closeConnection) {
      res.on('finish', () => {
        const socket = req.socket;
        if (!socket) return;
        socket.end();
        setTimeout(() => socket.destroy(), 1000).unref?.();
      });
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
      // A `next` HAS TO BE SOMEWHERE A BROWSER CAN GET. Carrying the pathname
      // of a POST does not end the round trip where it started, it ends it on a
      // 405: a signed-out visitor pressing Buy on /pricing was sent to
      // /login?next=/api/billing/checkout, signed in, and landed on Method Not
      // Allowed. The checkout form cannot carry its own return field --
      // test/web-auth.test.js holds it to exactly one input, the pack id -- so
      // the referring page is the only thing that knows where to go back to,
      // and `safeNext` keeps it to a same-origin absolute path.
      const from = req.method === 'GET'
        ? matched.pathname
        : refererPath(req.headers.referer, req.headers.host);
      const next = safeNext(from);
      return redirect(res, next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login');
    }
    return sendJson(req, res, 401, {
      error: { status: 401, message: 'Sign in first.', code: 'NOT_SIGNED_IN' },
    });
  }

  async function handler(req, res) {
    // BEFORE ROUTING, so it reaches every response this server can produce --
    // pages, JSON, files, media, and the 404 for a path no route claims. Set
    // here rather than in the header constants because those are frozen at
    // module scope and this is a per-server decision; `writeHead` merges with
    // headers already set, and nothing below sends this name, so it survives.
    // A route added later is covered without its author knowing this exists.
    if (!indexable) res.setHeader('X-Robots-Tag', 'noindex, nofollow');

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
      //
      // THE PATHNAME, NEVER THE QUERY STRING. `/verify?email=` carries an
      // address and `/auth/callback?code=&state=` a live sign-in code, and
      // this is the one place a request is logged in full -- on the failure
      // nobody planned for, which is exactly when the line gets read by
      // somebody who should not be holding either.
      logImpl(`[web] ${req.method} ${String(req.url ?? '').split('?')[0]} -> 500 ${err?.stack ?? err}`);
      fail(req, res, 500, 'Something went wrong at our end.', null);
    }
  }

  const server = http.createServer(handler);
  // A stalled upload holds a socket and a file handle. Two minutes is longer
  // than any legitimate 12 MB upload and shorter than "forever".
  server.requestTimeout = 120_000;
  server.headersTimeout = 20_000;

  /** The identity-sweep interval handle, set in `listen()` and cleared in
   *  `close()`. `null` until the server has actually started. */
  let sweepTimer = null;

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
    async listen() {
      const boundPort = await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server.address().port));
      });
      // Once now, so a fresh process starts clean and a test can assert on
      // the result of `listen()` without waiting an hour. Then unref'd and
      // hourly -- see `IDENTITY_SWEEP_MS` -- so the timer is never the reason
      // `close()` hangs or a clean shutdown does not exit.
      //
      // BOTH GUARDED HERE TOO, even though `sweepIdentityLitter` cannot throw
      // on its own terms (see its doc comment) -- belt and braces on the one
      // function whose entire job is not taking anything down with it.
      // Review finding, 2026-08-26: the first version guarded only the sweep
      // TARGETS and left the reporting path bare, so `listen()` itself
      // rejected (the port never bound) and, worse, an escaping rejection on
      // a later tick had nothing to catch it -- this codebase installs no
      // `process.on('unhandledRejection')` anywhere, so that crashes the
      // process outright rather than merely failing a sweep.
      try {
        await sweepIdentityLitter();
      } catch { /* see sweepIdentityLitter's own doc comment: never fatal */ }
      sweepTimer = setIntervalImpl(() => {
        sweepIdentityLitter().catch(() => {});
      }, identitySweepMs);
      if (typeof sweepTimer?.unref === 'function') sweepTimer.unref();
      return boundPort;
    },
    close() {
      return new Promise((resolve) => {
        if (sweepTimer) { clearIntervalImpl(sweepTimer); sweepTimer = null; }
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
