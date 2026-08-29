/**
 * Every page, as pure functions from data to a string.
 *
 * WHY THERE IS NO TEMPLATE ENGINE AND THEREFORE NO AUTOMATIC ESCAPING. Zero npm
 * dependencies is the rule, so the safety property has to come from discipline
 * instead of from a library, and discipline needs to be checkable. Hence: there
 * is exactly one way a value reaches the output, `h()`, and any interpolation in
 * this file that is not wrapped in it is a bug you can find with a grep. The
 * strings that matter are not hypothetical -- `place` and `outfit` are free text
 * a stranger typed, they are echoed back on the status page and on the shelf,
 * and `<img src=x onerror=...>` in the outfit box is the first thing anybody
 * tries.
 *
 * WHY THE PAGES ARE PURE STRINGS AND KNOW NOTHING ABOUT `res`. A view that takes
 * a response object can only be tested by faking one. A view that returns a
 * string can be asserted on directly, which is how `test/web-api.test.js` checks
 * that a script tag typed into the place field comes back inert.
 *
 * WHY THE SELECTION RADIOS LIVE AT THE TOP OF `<body>` AND NOT INSIDE THE FORM.
 * The full-bleed background is the selected place photograph, cross-fading when
 * the selection changes, and the selected card grows and gains a badge. All
 * three are `#id:checked ~ ...` rules, which means the inputs have to be
 * *siblings* of the background layer and of the content -- so they sit at the
 * top of the body, visually hidden, and are joined back to the form by the
 * `form="tape"` attribute. The payoff is that selection, cross-fade, the badge
 * and the reveal of "use my own place" all work with scripting switched off, and
 * `prefers-reduced-motion` turns the transition off in one CSS rule rather than
 * in a script that has to remember to check.
 *
 * WHY THE STATUS PAGE NAMES THE STEP INSTEAD OF SHOWING A PERCENTAGE. This is
 * the page somebody looks at for several minutes while paid generation calls run
 * somewhere else. A bar that eases to 90% and stops is a lie that turns a working
 * render into a support request. Eleven named steps, the current one said out
 * loud, and a bar with eleven segments -- each segment is a real step, so the bar
 * is a fact rather than an animation.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

import { STEPS } from '../render/job.mjs';

/**
 * The wordmark, read once at module load rather than on every render.
 *
 * It lives in `assets/brand/` and not in this file because the same paths are
 * rasterised into the favicon and the social card -- one source, or the tab
 * icon and the header drift apart the first time either is touched. Read
 * eagerly and deliberately unguarded: a missing wordmark is a broken build, and
 * a build that boots and serves a header with a hole in it is worse than one
 * that refuses to start.
 */
const WORDMARK_SVG = fs
  .readFileSync(new URL('../../assets/brand/wordmark-inline.svg', import.meta.url), 'utf8')
  .trim();

/**
 * THE MONOGRAM IS NOT INLINED HERE ANY MORE. Until 2026-08-28 the masthead drew
 * `Ts` beside the word, and `assets/brand/monogram-inline.svg` was read in at
 * this point. Paul removed it on sight: two marks saying the same thing, and
 * the small one reading as basic next to the drawn word.
 *
 * THE ASSET IS STILL USED, WHICH IS WHY IT IS STILL THERE. `/icon.svg` and
 * `/favicon.ico` serve it from disk, and that surface has the opposite problem
 * to this one -- a browser tab has no room for the word, so the mark is the
 * only thing that can carry the brand there. Deleting the file to tidy up would
 * blank the tab icon.
 */
import { placeSlug, outfitSlug, qualitySlug, aspectSlug } from './static.mjs';

/**
 * How many looks to choose between, and the ONLY values that exist.
 *
 * Exported because `server.mjs` validates against it. `stillCount` multiplies
 * BILLED provider calls -- fal generates one image per still -- while
 * contributing nothing to the price, so a value that is not on this page has no
 * business reaching a paid loop. The handler used to accept any integer 1..8,
 * and `/api/jobs` takes a hand-written multipart POST, so `stillCount=8` bought
 * seven extra generations at the price of one.
 *
 * One list, read by the form below and by the validator, so the two cannot
 * drift into a dead option or an accepted value nobody can pick.
 */
export const STILL_COUNTS = Object.freeze([1, 3, 5]);

/** Which one is selected when nobody chooses. */
export const STILL_COUNT_DEFAULT = 3;

// ---------------------------------------------------------------------------
// escaping
// ---------------------------------------------------------------------------

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * The only way a value gets into the output.
 *
 * Single quotes are escaped as well as double, because an unquoted or
 * single-quoted attribute is one hurried edit away and `&#39;` costs nothing.
 * `null` and `undefined` render as empty rather than as the words "null" and
 * "undefined", which is what a page shows when a field has not been filled in
 * yet and is never what anybody meant.
 */
export function h(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}

/** JSON that is safe to sit inside a `<script>` element. `</script>` inside a
 *  string literal ends the element, no matter that JSON thinks it is data. */
// `<` and the two Unicode line separators are the three things that can break
// out of a string literal inside a <script> element. U+2028/U+2029 are legal in
// JSON and are line terminators in JavaScript, so JSON.stringify alone produces
// a syntax error rather than data. Built with fromCharCode so that the literals
// never appear in this file, where they would be invisible in review.
const SCRIPT_UNSAFE = new RegExp('[<' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');

export function jsonInScript(value) {
  return JSON.stringify(value).replace(SCRIPT_UNSAFE, (ch) => (
    '\\u' + ch.codePointAt(0).toString(16).padStart(4, '0')
  ));
}

// ---------------------------------------------------------------------------
// vocabulary
// ---------------------------------------------------------------------------

/**
 * What each step is doing, in words a person who did not build this would use.
 * "still" and "animate" are the two that take minutes and cost money, and their
 * copy says so, because a wait you were warned about is a different experience
 * from the same wait unexplained.
 */
export const STEP_COPY = Object.freeze({
  intake: { title: 'Reading your photo', note: 'Straightening it, and removing the location and camera data.' },
  moderate: { title: 'Checking what you typed', note: 'A quick read of the place and the outfit.' },
  expand: { title: 'Writing the scene', note: 'Turning your words into a full description.' },
  compose: { title: 'Planning the shot', note: 'Prompts, seeds, and the fifteen seconds broken into segments.' },
  still: { title: 'Generating stills', note: 'This is the slow part. A few minutes.' },
  select: { title: 'Choosing a still', note: 'Waiting on the frame the video is built from.' },
  animate: { title: 'Generating the motion', note: 'The slowest part. Several minutes.' },
  assemble: { title: 'Joining the clips', note: 'Into one continuous take.' },
  tape: { title: 'Running it through the tape', note: 'Grain, chroma bleed, the date in the corner.' },
  verify: { title: 'Checking the picture', note: '375 frames, and the sound where it should be.' },
  publish: { title: 'Finishing', note: 'Almost there.' },
});

/** What each shape is FOR, in the words somebody choosing would use. The list
 *  of shapes itself comes from config/render.json -- only the human label for
 *  one lives here, the same division the resolution rows already follow. */
const ASPECT_DETAIL = Object.freeze({
  '4:3': 'The camcorder shape',
  '16:9': 'Widescreen',
  '9:16': 'Phone',
});

const STATUS_COPY = Object.freeze({
  queued: 'Waiting for a machine',
  running: 'Working',
  'awaiting-selection': 'Waiting for you',
  done: 'Finished',
  failed: 'Stopped',
  cancelled: 'Cancelled',
});

// ---------------------------------------------------------------------------
// the inline scripts, as named constants, because the policy names them
// ---------------------------------------------------------------------------

/**
 * These are the only three scripts in the product, and the Content-Security-
 * Policy admits each BY ITS HASH rather than by 'unsafe-inline' -- a keyword
 * that names no scripts and therefore admits all of them, including one an
 * injection just wrote. Held as constants so the hash is computed from the
 * exact bytes the page ships: edit a script and its hash follows
 * automatically; add a fourth script without adding it here and the test that
 * hashes what the page ACTUALLY shipped fails loudly, instead of the script
 * dying silently in the browser.
 *
 * The count in that first sentence has been wrong before. It says three
 * because there are three -- HOME_SCRIPT, STATUS_SCRIPT, BG_SCRIPT -- and
 * INLINE_SCRIPT_HASHES below is the list that actually decides.
 */
const HOME_SCRIPT = `
// The only thing scripting adds to this page: telling you which file you chose,
// and clearing the reason under a button that is already enabled. Selection,
// the background cross-fade and the reveal of the place upload are all CSS.
(function () {
  var photo = document.getElementById('photo');
  var name = document.getElementById('photo-name');
  var reason = document.getElementById('reason');
  var record = document.getElementById('record');
  if (!photo || !record) return;
  if (!record.disabled) { record.disabled = true; }
  photo.addEventListener('change', function () {
    var file = photo.files && photo.files[0];
    name.textContent = file ? file.name : '';
    if (file) { record.disabled = false; reason.textContent = ''; }
    else { record.disabled = true; reason.textContent = 'Upload a photo first'; }
  });
}());
`;

/** The status poller. `STEP_COPY` and `STATUS_COPY` are frozen module
 *  constants, so this text -- interpolations included -- is fixed at load and
 *  its hash is as stable as the home script's. */
const STATUS_SCRIPT = `
(function () {
  var root = document.getElementById('status');
  var id = root.dataset.job;
  var copy = ${jsonInScript(STEP_COPY)};
  var words = ${jsonInScript(STATUS_COPY)};

  function paint(v) {
    var c = copy[v.step] || null;
    document.getElementById('headline').textContent = c ? c.title : (words[v.status] || v.status);
    document.getElementById('subline').textContent = c ? c.note : '';
    document.getElementById('statusword').textContent = words[v.status] || v.status;

    var done = v.steps.filter(function (s) { return s.status === 'done' || s.status === 'skipped'; }).length;
    document.getElementById('counter').firstChild.nodeValue =
      Math.min(done + 1, v.steps.length) + ' of ' + v.steps.length + ' \\u00b7 ';

    var segs = document.querySelectorAll('#bar .seg');
    var rows = document.querySelectorAll('#steps .step');
    v.steps.forEach(function (s, i) {
      if (segs[i]) segs[i].className = 'seg seg-' + s.status;
      if (rows[i]) rows[i].className = 'step step-' + s.status + (s.name === v.step ? ' step-current' : '');
    });

    if (v.status === 'awaiting-selection') location.href = '/j/' + id + '/select';
    if (v.status === 'done') location.href = '/j/' + id + '/result';
  }

  function poll() {
    fetch('/api/jobs/' + id, { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) { if (v) paint(v); })
      .catch(function () { /* a dropped poll is not an error worth showing */ });
  }
  setInterval(poll, 2000);

  document.getElementById('cancel').addEventListener('click', function () {
    if (!confirm('Cancel this one? The photo you uploaded is deleted.')) return;
    fetch('/api/jobs/' + id, { method: 'DELETE' }).then(function () { location.reload(); });
  });
}());
`;

/**
 * The moving background.
 *
 * WHY THERE IS SCRIPT HERE AT ALL, on a page whose selection mechanic is
 * deliberately CSS-only. The stills cross-fade with no JavaScript because eight
 * background-image layers cost nothing to have present at once. Eight VIDEO
 * elements do not: each is a decoder, and eight of them decoding 25fps for one
 * visible picture is a laptop fan. So there is ONE element and its source is
 * swapped, and swapping a source is the one thing a stylesheet cannot do.
 *
 * EVERY EXIT IS A RETURN TO THE PAGE THAT ALREADY WORKED. No script, reduced
 * motion, a metered connection, a browser that will not decode h264, a file
 * that 404s, a play() the browser refuses -- each leaves the still layer
 * underneath exactly as it is today. The video is never a requirement, and
 * nothing above this line has to know it exists.
 */
const BG_SCRIPT = `
(function () {
  var video = document.querySelector('.bgv');
  if (!video || !video.canPlayType || !video.canPlayType('video/mp4')) return;

  // A full-bleed moving picture is the largest animation this page could make,
  // so it is the first thing a request for reduced motion should cost.
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce && reduce.matches) return;

  // And on a metered connection a decorative 155kB is not worth spending.
  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && conn.saveData) return;

  var bgs = video.parentNode;
  var current = null;

  // TWO STATES, NOT ONE, AND THE DIFFERENCE IS A VISIBLE BUG.
  //
  // "is-live" means video works on this page. It decides the per-place scrim
  // and the plate under the panels, and once it is true it STAYS true across
  // every subsequent choice -- because those two are properties of the page's
  // ground, not of which clip happens to be decoding this second.
  //
  // "is-showing" means this particular clip has a frame to paint, and it comes
  // off for the moment between choosing a place and its loop decoding. The
  // video fades out over the still it was cut from, which is the same
  // photograph, so the swap reads as a cross-fade.
  //
  // Driving both from one class is what the first version did, and picking a
  // place threw the scrim back to full strength and changed every panel's
  // corner radius for as long as the next file took to load -- the whole
  // chrome flinching once per click.
  function show(id) {
    if (id === current) return;
    current = id;
    bgs.classList.remove('is-showing');
    // The own-place card carries an empty value: there is no loop for a place
    // nobody has described yet, so the ground comes back.
    if (!id) { video.removeAttribute('src'); video.load(); return; }
    video.src = '/places/' + encodeURIComponent(id) + '.mp4';
    var started = video.play();
    if (started && started.catch) started.catch(function () { /* autoplay refused; the still stands */ });
  }

  video.addEventListener('playing', function () {
    bgs.classList.add('is-live');
    bgs.classList.add('is-showing');
  });
  video.addEventListener('error', function () {
    bgs.classList.remove('is-showing');
    bgs.classList.remove('is-live');
  });

  // TWO NAMES, ONE MECHANIC. The signed-in page posts its choice as "place";
  // the landing names its radios "lplace" precisely so a landing choice can
  // never be submitted as a real order. Both drive the same background.
  var SELECTOR = 'input[name="place"]:checked, input[name="lplace"]:checked';

  document.addEventListener('change', function (e) {
    if (e.target && (e.target.name === 'place' || e.target.name === 'lplace')) show(e.target.value);
  });

  var checked = document.querySelector(SELECTOR);
  if (checked) show(checked.value);
}());
`;

/** base64 sha256 of each shipped script, for `script-src 'sha256-...'`. */
export const INLINE_SCRIPT_HASHES = Object.freeze(
  [HOME_SCRIPT, STATUS_SCRIPT, BG_SCRIPT].map((s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64')),
);

/**
 * The FRAME row used to render `['4:3', 'PAL', '25 fps', '15.000s']` as four
 * chips, with a comment here explaining that they were `<span>`s and not
 * controls because there was nothing to choose.
 *
 * THAT WAS TRUE AND IT STILL READ AS BROKEN. The chips sat directly above the
 * quality cards, which ARE controls and look almost identical, so the row
 * presented four things that could not be clicked next to three that could.
 * Paul's report was "I can't click the frame to select" -- not a rendering
 * fault, a fault in what the page was claiming. "PAL" made it worse: it is a
 * broadcast standard nobody outside video engineering has a reason to know, and
 * putting it on a chip implied it was an option somebody might want a different
 * value of.
 *
 * Replaced with one sentence of prose that states the two facts a person
 * actually needs -- 4:3 and fifteen seconds -- in a shape that cannot be
 * mistaken for a control. The frame rate and the broadcast standard are not
 * facts a customer needs; they are facts the RENDERER needs, they are asserted
 * by roughly two hundred tests, and the place they are written down is the
 * output contract in CLAUDE.md.
 *
 * REPLACED AGAIN 2026-08-23, and this time it IS a control. Paul: "it should
 * only contain three options. That's it." The row now draws all three shapes --
 * each with its ratio sketched as a little outline in the real proportion,
 * because "tall" and "wide" read faster than two numbers do.
 *
 * ALL THREE ARE REAL CHOICES as of the same day. They shipped dimmed for about
 * an hour first, which was the honest state while the renderer could only fill
 * the 4:3 raster; the deferred-option machinery below is kept because it is how
 * a shape gets added in future, not because anything currently uses it.
 *
 * WHY EACH SHAPE EXISTS, since it is the thing a customer is actually choosing
 * between: the file that comes out IS the shape you picked. 9:16 delivers
 * 1080x1920 full-bleed because that is what Reels and TikTok want and bands are
 * what make a reel look amateur; 16:9 delivers 1920x1080 because a landscape
 * picture matted into a portrait file is useless on YouTube; 4:3 stays matted on
 * the dark surface, unchanged, because that surround and the vignette over it
 * are what make the tape read as a photographed object rather than a filter.
 *
 * Which shapes exist comes from `config/render.json` and which are offered comes
 * from an `available` flag beside the reason in that same file, so a shape is
 * switched on by the commit that gives it a `delivery` block, never by an edit
 * here. The rule that governed the old placeholder sentence is unchanged and is
 * what gates that flag: offering a shape the renderer cannot fill would sell
 * something that cannot be delivered.
 */

/**
 * The QUALITY row's copy, and the reason it is worded the way it is.
 *
 * MEASURED, 2026-08-20 (docs/interfaces-app.md): the tape works at 736x588, and
 * grain is applied at 720x576 *before* the upscale, because grain applied at
 * 1080 reads as a modern sensor at high ISO instead of tape. So detail above the
 * raster is not degraded by the look, it is discarded by it -- SSIM between a
 * 720p-sourced and a 1080p-sourced delivery is 0.958, and a 4x zoom on a hard
 * edge shows nothing.
 *
 * THIS IS THEREFORE NOT AN UPSELL AND MUST NOT READ AS ONE. The delivered file
 * is 1080x1920 either way. Nothing here says "HD", nothing here calls 480p
 * "lower quality video", and nothing implies paying more buys a better picture,
 * because we measured how much it buys and the answer is nothing you can see.
 * What 480p actually costs you is stated plainly: it is below the raster
 * vertically, so it is upscaled and slightly softer.
 *
 * Keyed by resolution id with a total fallback, so a resolution added to
 * `config/credits.json` renders with an honest generic line rather than
 * vanishing off the page.
 */
export const RESOLUTION_COPY = Object.freeze({
  '480p': 'Cheaper. Slightly softer, because it sits just under the tape’s own resolution.',
  '720p': 'The native fit — nothing is thrown away.',
  '1080p': 'Nothing gained over 720p: the tape discards everything above its own raster.',
});

export function resolutionDetail(res) {
  return RESOLUTION_COPY[res.id]
    ?? (res.width && res.height ? `${res.width}x${res.height} before the tape.` : 'Source size before the tape.');
}

// ---------------------------------------------------------------------------
// the shell
// ---------------------------------------------------------------------------

/** `20260820-144501-a3f19c` -> `20.08.2026`. The date is already in the id, so
 *  reading a clock to render it would be both unnecessary and, on a page that
 *  can be cached, wrong. */
export function stampDate(jobId) {
  const m = /^(\d{4})(\d{2})(\d{2})-/.exec(String(jobId ?? ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

/** The wordmark: the product's own typeface, with the dot a camcorder blinks
 *  while it is recording. Not an illustration, and not an icon pack. */
function wordmark() {
  // INLINE, NOT AN <img>. The letterforms are `currentColor`, so the mark
  // takes the ground it is placed on without a second file per theme -- and
  // the record light keeps blinking, which it could not do inside an <img>
  // that the CSP would also have to allow.
  //
  // The drawn letters carry no text, so the accessible name is the `<span>`:
  // `aria-label` on the link would work too, but a visually-hidden span
  // survives a stylesheet that fails to load, which is when a person most
  // needs to know what they are looking at.
  //
  // ONE MARK, NOT TWO. A monogram drawing `Ts` used to sit ahead of the word
  // inside this same anchor. It went on 2026-08-28: it spelled the first two
  // letters of the word standing next to it, so the lockup said the same thing
  // twice, and at 30px against the drawn wordmark it read as the plainer of the
  // two. The word can carry the masthead alone; the mark still carries the
  // browser tab, where there is no room for a word.
  //
  // DO NOT REINSTATE IT WITHOUT READING THE STYLESHEET. Its old rules are gone
  // with it, and they were not decoration: `.wordmark`'s gap and negative
  // margin existed to cancel the padding baked into the monogram's tile, and it
  // was held back to 60% opacity (45% over a photograph) so that a 30px mark
  // would not out-shout the 3.2px record light, which is the one thing in this
  // chrome allowed to wear the accent. See DESIGN.md.
  return `<a class="wordmark" href="/">${WORDMARK_SVG}<span class="vh">Timestamp</span></a>`;
}

/**
 * The credit meter: a ring that empties as credits are spent.
 *
 * WHY A RING AND NOT A NUMBER. "153 CR" answers how many and never how far
 * through, and "how far through" is the question a person actually has when
 * they are deciding whether to press Record. A ring answers it at a glance and
 * without arithmetic -- which matters most for the people who need it most, the
 * ones near empty.
 *
 * WHY THE FRACTION IS AN SVG ATTRIBUTE AND NOT AN INLINE STYLE. The obvious
 * implementation is `style="--pct:0.62"`, and the CSP forbids it: `style-src
 * 'self'` carries no `'unsafe-inline'`, on purpose, and the per-place gradients
 * are generated into the stylesheet rather than inlined for exactly this
 * reason. But `stroke-dasharray` is an SVG PRESENTATION ATTRIBUTE, not CSS, so
 * CSP does not police it and a per-request value is free. `pathLength="100"`
 * then redefines the circle's own length as 100 units, so the dash array is
 * literally "percent full, percent empty" and no circumference arithmetic
 * appears anywhere. Change the radius and nothing else has to move.
 *
 * WHY IT CAPS AT FULL. A balance can exceed a period's grant -- a manual grant,
 * a plan change, or credits that simply rolled over, since `expiryDays` is
 * null. A ring drawn past 100% wraps and reads as nearly empty, which is the
 * most dangerous possible misreading, so the arc clamps and the number beside
 * it stays honest.
 *
 * THREE STATES, and the middle one is the point. Full-ish, low (fewer than two
 * of the cheapest tape), and spent (cannot afford anything at all). "Spent" is
 * a different fact from "low": a sliver of arc looks like it might be enough,
 * and finding out it is not costs somebody a click and a refusal.
 */
export function creditMeter(balance) {
  const credits = Math.max(0, Number(balance?.credits ?? 0));
  const perPeriod = Math.max(0, Number(balance?.perPeriod ?? 0));
  const cheapest = Math.max(0, Number(balance?.cheapest ?? 0));

  // No plan allowance to measure against -- degrade to the plain number rather
  // than drawing a ring that is a fraction of nothing.
  if (!perPeriod) return `<span class="who">${h(`${credits} CR`)}</span>`;

  const pct = Math.max(0, Math.min(100, Math.round((credits / perPeriod) * 100)));
  const state = cheapest && credits < cheapest ? 'spent'
    : cheapest && credits < cheapest * 2 ? 'low'
      : 'ok';

  const tapes = cheapest ? Math.floor(credits / cheapest) : null;
  const title = state === 'spent'
    ? `${credits} CR — not enough for a tape`
    : `${credits} CR — about ${tapes} more ${tapes === 1 ? 'tape' : 'tapes'}`;

  return `<span class="creds creds--${state}" title="${h(title)}">
  <svg class="ring" viewBox="0 0 24 24" role="img" aria-label="${h(title)}">
    <circle class="ring-track" cx="12" cy="12" r="9"></circle>
    <circle class="ring-fill" cx="12" cy="12" r="9" pathLength="100"
            stroke-dasharray="${pct} ${100 - pct}"></circle>
  </svg>
  <span class="creds-n">${h(String(credits))}</span><span class="creds-u">CR</span>
</span>`;
}

function nav({ account = null, balance = null } = {}) {
  if (!account) {
    return `<nav class="nav">
  <a href="/pricing">Plans</a>
  <a href="/login">Sign in</a>
</nav>`;
  }
  const left = balance ? creditMeter(balance) : '';
  // The email is chrome, not decoration: every page says WHOSE account it is,
  // so being signed into an account that is not yours -- however that happened
  // -- is visible on sight instead of discoverable only from what later lands
  // on the wrong shelf.
  return `<nav class="nav">
  <span class="who">${h(account.email ?? '')}</span>
  ${left}
  <a href="/pricing">Plans</a>
  <form method="post" action="/logout" class="nav-form"><button type="submit">Sign out</button></form>
</nav>`;
}

/**
 * `refreshSeconds` drives a `<noscript>` meta refresh, not a scripted one. The
 * status page polls a JSON endpoint when it can; when it cannot, reloading the
 * whole page every few seconds is a worse experience and a working one, and the
 * alternative is a page that sits there frozen for someone with scripting off.
 *
 * `preBody` is where the selection radios, the background layers and the scrim
 * go -- outside `.wrap`, because the CSS that fades one background into another
 * needs them to be siblings. Everything else on the page is inside `.wrap`.
 */
/**
 * WHY THREE ICON LINKS AND NOT ONE. The SVG is what a current browser paints
 * and the only one that stays sharp at every size. `/favicon.ico` is what the
 * rest request without being told -- it is served whether it is linked or not,
 * and the link only pins the size. The apple-touch-icon is the one an iOS home
 * screen uses and it is the one with NO fallback: left unlinked, iOS
 * screenshots the page and uses that instead.
 */
export function layout({
  title,
  body,
  preBody = '',
  refreshSeconds = null,
  bodyClass = '',
  wrapClass = '',
  account = null,
  balance = null,
  chrome = true,
}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${bodyClass === 'is-landing' ? 'dark' : 'light'}">
<title>${h(title)}</title>
<link rel="stylesheet" href="/styles.css">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="icon" type="image/x-icon" href="/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="/icon-180.png">
${refreshSeconds ? `<noscript><meta http-equiv="refresh" content="${Number(refreshSeconds)}"></noscript>` : ''}
</head>
<body class="${h(bodyClass)}">
${preBody}
<div class="wrap ${h(wrapClass)}">
<header class="masthead">
  ${wordmark()}
  ${chrome ? nav({ account, balance }) : ''}
</header>
${body}
<footer class="foot">
  <p>Your photo is deleted after 7 days and the video after 30. You can ask for either sooner.</p>
  <p class="fine">Date-stamp lettering is VT323 by Peter Hull, under the SIL Open Font Licence 1.1.</p>
</footer>
</div>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// the home page
// ---------------------------------------------------------------------------

/**
 * A preset's one line of detail.
 *
 * `wardrobe` is a full sentence written for a prompt ("an oversized half-zip
 * fleece pullover in marl grey, the zip pulled up to the collar, ..."), and the
 * card wants the first clause of it. Cut at a comma rather than at a character
 * count where possible, so the line ends on a phrase instead of mid-word.
 */
export function shortDetail(text, max = 58) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const comma = flat.indexOf(',');
  const clause = comma > 12 && comma <= max ? flat.slice(0, comma) : flat;
  if (clause.length <= max) return clause;
  const cut = clause.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * WHY THE NUMBER IS NOW THE BIGGEST THING IN THE HEADER, IN THE OSD FACE.
 *
 * The step number used to be an 11px amber eyebrow -- the smallest type on the
 * page -- while it was the ONLY thing distinguishing one panel from the next.
 * Four panels of identical width, identical padding and identical 20px titles,
 * told apart by the smallest word in the layout. That is the shape that reads
 * as templated: when everything is medium, nothing is the subject.
 *
 * So the number is promoted to a 44px VT323 numeral in the left gutter. It
 * costs nothing -- `assets/fonts/tape-osd.ttf` is already bundled and already
 * loaded for the date stamp -- and it is the same character generator the tape
 * itself draws with, so the sequence is spoken in the product's own voice
 * rather than in a generic step-wizard's.
 *
 * The word STEP rides above the numeral rather than being dropped, so a screen
 * reader still hears "STEP 01" before the heading and the number is never bare.
 */
function stepHead(n, name, subtitle) {
  return `<div class="step-head">
  <p class="stepno"><span class="stepno-k">STEP</span><span class="stepno-n">${
  h(String(n).padStart(2, '0'))
}</span></p>
  <div class="step-say">
    <h2 class="title">${h(name)}</h2>
    <p class="sub">${h(subtitle)}</p>
  </div>
</div>`;
}

/**
 * The one page the product lives on: four steps, the settings panel, the shelf.
 *
 * @param {object} data
 * @param {Array<{id,label,timeOfDay}>} data.places   from `presets/places/`
 * @param {Array<{id,label,wardrobe}>}  data.outfits  from `presets/outfits/`
 * @param {Array<{id,width,height,available,credits}>} data.resolutions
 *        from `config/credits.json` -- NOT a list written down in this file
 * @param {string} data.resolution    which one starts selected
 * @param {{credits:number,planId:string}} data.balance
 * @param {Array} data.tapes   the shelf, newest first
 */
/**
 * The page a stranger sees. Everything above it in this file is for somebody
 * who has already signed in.
 *
 * WHY THIS EXISTS AT ALL, AND WHY IT DID NOT BEFORE. `GET /` used to answer a
 * signed-out visitor with a 303 to `/login`, so the entire product was a
 * password box. There was nowhere to say what this is, nowhere for a headline,
 * and nothing for somebody who had never heard of it to read. An app whose
 * front door is a login form can only be used by people who already know what
 * it does, which is a strange shape for something being built to sell.
 *
 * WHY THE COLOURS ARE THE ARTWORK. `assets/places/` is empty and the place
 * photographs are the biggest missing asset in the product. Rather than leave a
 * hole or reach for stock, the shelf is built from the per-place gradients that
 * already exist -- the same `.thumb--pl-<id>` rules the carousel uses -- so the
 * page is finished on a fresh clone with no images at all, and the day the
 * photographs land they drop into the same declaration and the layout does not
 * move. That is the same trick `presetCss` already plays, used one level up.
 *
 * WHY THE HIERARCHY IS DELIBERATE. The signed-in page is four panels of
 * identical width and weight, which is the shape that reads as templated: when
 * everything is medium, nothing is the subject. Here one thing is the subject --
 * the sentence -- and it is several times the size of everything else.
 */
/**
 * The page a stranger sees, in the world DESIGN.md calls STRUCK.
 *
 * WHY THE PLACE LIST IS A REAL CONTROL AND NOT A PICTURE OF ONE. The world's
 * central idea is that every possible value is already present, unlit, and one
 * is struck forward. That is not a metaphor here: these are the same hoisted
 * `:checked` radios the signed-in page runs on, so a stranger operates the
 * actual mechanic of the product before signing up for anything. It costs no
 * JavaScript, and the technique was already in the codebase.
 *
 * THE READ-OUT SHOWS THE PLACE AND ITS TIME OF DAY, NOT A DATE. A burnt-in
 * "AUG 17 2003" under a photograph would assert that a particular tape exists.
 * The preset's own `timeOfDay` is true, and in the OSD face it reads as a
 * camcorder read-out just as well.
 */
export function landingPage({ places = [], account = null } = {}) {
  const first = places[0]?.id ?? null;

  // Hoisted so `#id:checked ~ .wrap` can reach the stack and the veils. Fixed
  // rather than absolute, for the same reason as the signed-in page: an input
  // at document offset -1 makes every click scroll the page to the top.
  const hooks = places.map((p) => (
    `<input class="lstate" type="radio" name="lplace" id="${h(placeSlug(p.id))}" value="${h(p.id)}"${p.id === first ? ' checked' : ''}>`
  )).join('\n');

  // The gauze belongs to `layout` now -- every page gets it, which is what
  // DESIGN.md means by "runs past every edge". The bloom stays: it is this
  // page's own light, not the world's mesh.
  // THE SAME GROUND AS THE SIGNED-IN PAGE, AND DELIBERATELY THE SAME IDS. The
  // stylesheet generates one set of `#pl-<id>:checked ~ ...` rules from the
  // catalog; because the landing's radios carry those same ids, every one of
  // them -- the still layer, the cross-fade, the per-place scrim -- reaches
  // this page for nothing. Only the radios' NAME differs (lplace, so a landing
  // choice cannot be posted as a real order), and the script matches on both.
  const backgrounds = places
    .map((p) => `<div class="bg bg--${h(placeSlug(p.id))}"></div>`)
    .join('\n');

  const preBody = `${hooks}
<div class="bgs" aria-hidden="true">
${backgrounds}
<video class="bgv" muted playsinline loop preload="none"></video>
</div>
<div class="scrim" aria-hidden="true"></div>
<div class="bloom" aria-hidden="true"></div>`;

  const stack = places.map((p, i) => `
      <li><label class="lopt lopt--${h(placeSlug(p.id))}" for="${h(placeSlug(p.id))}"><span class="lidx">${String(i + 1).padStart(2, '0')}</span>${h(p.label)}</label></li>`).join('');

  const osds = places.map((p) => `
      <span class="losd losd--${h(placeSlug(p.id))}" aria-hidden="true">${h(p.timeOfDay || '')}</span>`).join('');

  const body = `
<main class="landing">

  <section class="strike">
    <div class="lmenu">
      <h1 class="hero-line">One photograph.<span class="lit">Fifteen seconds</span>of 2003.</h1>
      <p class="hero-sub">Every place here is somewhere ordinary, and every one is
      already present, unlit. Strike one and it is the afternoon you are standing in.</p>

      <ul class="lrail">${stack}
      </ul>
      <p class="strike-hint">Strike one</p>

      <p class="hero-do">
        <a class="cta" href="/signup">Make a tape &rarr;</a>
        <a class="cta cta--quiet" href="/login">I have an account</a>
      </p>
    </div>
  </section>

  <!-- THE READ-OUT MOVED OUT OF THE PANEL AND ONTO THE PICTURE, which is where
       a camcorder actually put it. It used to sit in the corner of the 4:3 veil
       that framed the place; that veil is gone, because the place is now behind
       the whole page and showing the same photograph twice at two sizes and two
       crops is one picture too many. Kept inside .wrap so the generated
       "#pl-x:checked ~ .wrap .losd--x" rules still reach it. -->
  <div class="losds" aria-hidden="true">${osds}
  </div>

  <section class="how">
    <div>
      <p class="how-n">01</p>
      <h2 class="how-t">Content</h2>
      <p class="how-d">A plausible person, a plausible place, an outfit, and motion that
      goes nowhere in particular. Your photograph is the only authority on the face.</p>
    </div>
    <div>
      <p class="how-n">02</p>
      <h2 class="how-t">Texture</h2>
      <p class="how-d">Chroma bleed, grain, the head-switch band, transport jitter, the
      date burnt into the corner. All of it deterministic, none of it asked of a model.</p>
    </div>
    <div>
      <p class="how-n">03</p>
      <h2 class="how-t">Consent</h2>
      <p class="how-d">Location and camera data stripped the moment your photograph
      arrives. The photograph is deleted after seven days, the tape after thirty.</p>
    </div>
  </section>

  <section class="plain">
    <p>It is not a filter. The picture is generated, then run through a real tape chain
    in ffmpeg &mdash; the grain goes on before the upscale, the date stamp degrades with
    the image, and the frame is matted the way a camcorder frame actually sat. You
    approve a still before any video is made, so a likeness you do not recognise costs
    you nothing.</p>
  </section>

</main>
<script>${BG_SCRIPT}</script>`;

  return layout({
    title: 'Timestamp — one photo, fifteen seconds, 2003',
    body,
    preBody,
    bodyClass: 'is-landing',
    account,
    chrome: true,
  });
}

export function homePage({
  places = [],
  outfits = [],
  resolutions = [],
  resolution = null,
  aspects = [],
  consentText = '',
  balance = { credits: 0, planId: 'free' },
  account = null,
  tapes = [],
  error = null,
  values = {},
  retentionDays = null,
} = {}) {
  const offered = resolutions.filter((r) => r.available);
  const offeredAspects = aspects.filter((a) => a.available);
  const chosenAspect = offeredAspects[0]?.id ?? null;
  const chosen = offered.some((r) => r.id === resolution) ? resolution : (offered[0]?.id ?? null);
  // The radios, hoisted out of the form. `form="tape"` is what puts them back
  // into the submission; the CSS needs them here.
  const hooks = [
    ...outfits.map((o) => (
      `<input class="statehook" type="radio" form="tape" name="outfit" id="${h(outfitSlug(o.id))}" value="${h(o.id)}">`
    )),
    ...places.map((p) => (
      `<input class="statehook" type="radio" form="tape" name="place" id="${h(placeSlug(p.id))}" value="${h(p.id)}">`
    )),
    // The escape hatch posts an empty `place`, which the server reads as "there
    // is no text, so the photograph had better be there" -- exactly the rule
    // that already governs a place photo.
    `<input class="statehook" type="radio" form="tape" name="place" id="pl-own" value="">`,
    // Only the AVAILABLE resolutions get a radio. An unavailable one renders as
    // a span with no control behind it, so it is not merely disabled in the
    // browser -- there is nothing for a hand-written POST to name either.
    ...offered.map((r) => (
      `<input class="statehook" type="radio" form="tape" name="resolution" id="${h(qualitySlug(r.id))}" value="${h(r.id)}"${r.id === chosen ? ' checked' : ''}>`
    )),
    // Same rule for the frame. A shape the renderer cannot finish gets no
    // radio, so it is not merely unclickable in a browser -- there is no
    // control for a hand-written POST to name either.
    ...offeredAspects.map((a) => (
      `<input class="statehook" type="radio" form="tape" name="aspect" id="${h(aspectSlug(a.id))}" value="${h(a.id)}"${a.id === chosenAspect ? ' checked' : ''}>`
    )),
  ].join('\n');

  // THE GROUND HERE IS PAPER, NOT A PHOTOGRAPH (2026-08-28). This page used to
  // carry the same full-bleed place still, loop and scrim as the landing, so
  // that choosing a place turned the whole page into that place.
  //
  // WHY IT CAME OFF, when it is the nicest thing the app did. The identity is
  // an album page and this is the page somebody works on: they are choosing a
  // place, a look and a frame, reading prices and watching a queue, and every
  // one of those is text over a moving photograph competing with it. The demo
  // belongs on the landing, where the whole job is to show what the product
  // makes; here it was the product's own workspace wearing its own advert.
  //
  // THE HOOKS STAY, and that is the part worth being careful about. They are
  // the CSS-only selection mechanic -- hoisted radios whose `:checked` drives
  // every card on the page -- and they have nothing to do with the background;
  // the background was merely one more thing that read them. Removing the
  // ground does not cost a single interaction.
  const preBody = hooks;

  const lookCards = outfits.map((o) => `
    <label class="lookcard lookcard--${h(outfitSlug(o.id))}" for="${h(outfitSlug(o.id))}">
      <span class="tick" aria-hidden="true"></span>
      <span class="name">${h(o.label)}</span>
      <span class="detail">${h(shortDetail(o.wardrobe))}</span>
    </label>`).join('');

  const placeCards = places.map((p) => `
    <label class="placecard placecard--${h(placeSlug(p.id))}" for="${h(placeSlug(p.id))}">
      <span class="thumb thumb--${h(placeSlug(p.id))}" aria-hidden="true"></span>
      <span class="badge" aria-hidden="true"></span>
      <span class="cap">
        <span class="name">${h(p.label)}</span>
        <span class="when">${h(p.timeOfDay)}</span>
      </span>
    </label>`).join('');

  const dots = [...places.map((p) => `<span class="dot dot--${h(placeSlug(p.id))}"></span>`), '<span class="dot dot--own"></span>'].join('');

  const frameCards = aspects.map((a) => {
    const slug = aspectSlug(a.id);
    const detail = ASPECT_DETAIL[a.id] ?? '';
    if (!a.available) {
      return `
    <span class="framecard framecard--soon framecard--${h(slug)}">
      <span class="shape" aria-hidden="true"></span>
      <span class="ratio">${h(a.id)}</span>
      <span class="flag">Not yet</span>
    </span>`;
    }
    return `
    <label class="framecard framecard--${h(slug)}" for="${h(slug)}">
      <span class="tick" aria-hidden="true"></span>
      <span class="shape" aria-hidden="true"></span>
      <span class="ratio">${h(a.id)}</span>
      <span class="detail">${h(detail)}</span>
    </label>`;
  }).join('');

  const qualityCards = resolutions.map((r) => {
    const detail = h(resolutionDetail(r));
    const cr = h(`~${r.credits} CR`);
    if (!r.available) {
      return `
    <span class="qualitycard qualitycard--soon">
      <span class="name">${h(r.id)}</span>
      <span class="cr">${cr}</span>
      <span class="detail">${detail}</span>
      <span class="flag">Coming soon</span>
    </span>`;
    }
    return `
    <label class="qualitycard qualitycard--${h(qualitySlug(r.id))}" for="${h(qualitySlug(r.id))}">
      <span class="tick" aria-hidden="true"></span>
      <span class="name">${h(r.id)}</span>
      <span class="cr">${cr}</span>
      <span class="detail">${detail}</span>
      ${r.id === chosen ? '<span class="flag">Recommended</span>' : ''}
    </label>`;
  }).join('');

  // One cost per resolution, switched by the same `:checked` rule that styles
  // the card. A cost that only updated with JavaScript would be blank on the one
  // page where a number decides whether somebody spends.
  // ONE COST PER (RESOLUTION, SHAPE) PAIR, not per resolution.
  //
  // This was keyed on the quality radio alone and its number came from
  // `creditsPerReference`, computed with an aspect multiplier of 1 -- while the
  // charge at enqueue applies 4/3 for 16:9 and 9:16. The page said ~21 CR and
  // the ledger took 28. The page is deliberately zero-JavaScript, so it cannot
  // recompute on selection: the cross product is rendered and CSS switches it.
  //
  // `creditsByAspect` comes from the seam, which asks the same function that
  // charges. A pair with no quote is a pair the pricing refused, and it gets no
  // line rather than a fallback number.
  const costLines = offered.flatMap((r) => offeredAspects.map((a) => {
    const credits = r.creditsByAspect?.[a.id];
    if (!Number.isFinite(credits)) return '';
    return `<span class="cost cost--${h(qualitySlug(r.id))}-${h(aspectSlug(a.id))}">${h(`~${credits} CR`)}</span>`;
  })).join('');

  // Disabled ONLY when the balance cannot afford the cheapest thing on offer,
  // because that is the only refusal that is true whatever gets picked. Anything
  // dearer than the balance gets its own line instead, switched the same way, so
  // the reason names the actual numbers rather than a general apology.
  // The floor stays the genuinely cheapest thing on offer -- the default shape
  // at the cheapest tier -- because that is the only refusal true whatever gets
  // picked, and disabling the button on a dearer combination would refuse an
  // order somebody has not made yet.
  const cheapest = offered.reduce((min, r) => (min === null || r.credits < min ? r.credits : min), null);
  const brokeEntirely = cheapest !== null && balance.credits < cheapest;
  // THE WARNING FOLLOWS THE SHAPE TOO. Keyed on quality alone it used the
  // un-shaped number, so somebody holding 25 CR saw no warning against a
  // displayed ~21, uploaded a photograph, and met a 402 for 28 -- which is the
  // refusal-after-upload the cheap pre-check exists to prevent.
  const creditWarnings = offered.flatMap((r) => offeredAspects.map((a) => {
    const credits = r.creditsByAspect?.[a.id];
    if (!Number.isFinite(credits) || balance.credits >= credits) return '';
    return `<span class="why why--${h(qualitySlug(r.id))}-${h(aspectSlug(a.id))}">${
      h(`Not enough credits — a ${r.id} ${a.id} tape costs ~${credits} CR and you have ${balance.credits} CR.`)
    }</span>`;
  })).join('');

  const body = `
<main>
${error ? `<p class="alert" role="alert">${h(error.message)}</p>` : ''}

<!-- THE PAGE HAD NO <h1>. Not a styling oversight -- a missing subject, in the
     markup and on the screen at once. It opened on a paragraph and then four
     sibling <h2>s of equal size, so a screen reader met four headings with
     nothing above them and an eye met four boxes with nothing above them: the
     same defect, read two ways. The landing page had already solved this for
     strangers ("one thing is the subject -- the sentence -- and it is several
     times the size of everything else"); the signed-in page never got the same
     treatment. The copy is not new: it is Paul's existing lede, split at the
     full stop that was already in it. -->
<div class="app-head">
  <h1 class="app-h1">One photo, one look, one place.</h1>
  <p class="lede">Fifteen seconds that look like they came off a camcorder tape in a
  German suburb, some time around 2003.</p>
</div>

<form id="tape" method="post" action="/api/jobs" enctype="multipart/form-data">

  <section class="panel panel--anchor">
    ${stepHead(1, 'Your photo', 'Uploaded once, kept in your library — the person in every tape.')}
    <label class="drop" for="photo">
      <input type="file" id="photo" name="photo" accept="image/jpeg,image/png,image/webp" required>
      <span class="plus">+ Add photo</span>
      <span class="chosen-name" id="photo-name"></span>
      <span class="say">A clear photo of your face. JPEG, PNG or WebP, up to 12&nbsp;MB.
      The location and camera data are stripped before anything else happens.</span>
    </label>
  </section>

  <section class="panel panel--choice">
    ${stepHead(2, 'The look', 'Only what is on the body — the place carries everything else.')}
    <div class="looks">${lookCards}</div>
    <details class="aside">
      <summary>Or describe what you are wearing</summary>
      <p class="hint">Used only when no card above is chosen.</p>
      <input type="text" name="outfitText" maxlength="200" autocomplete="off" spellcheck="false"
             placeholder="a green anorak" value="${h(values.outfit)}">
    </details>
  </section>

  <section class="panel panel--choice">
    ${stepHead(3, 'The place', 'Somewhere ordinary. That is the whole idea.')}
    <div class="rail">${placeCards}
    <label class="placecard placecard--own" for="pl-own">
      <span class="thumb" aria-hidden="true"></span>
      <span class="badge" aria-hidden="true"></span>
      <span class="cap">
        <span class="name">Use my own place</span>
        <span class="when">Your photograph</span>
      </span>
    </label>
    </div>
    <div class="dots" aria-hidden="true">${dots}</div>

    <!-- THE ESCAPE HATCHES, NAMED WHERE SOMEBODY WILL SEE THEM.
         Both of these already existed and neither could be found. The upload
         lives behind a display:none rule and is revealed only by checking
         the pl-own radio -- a card sitting at the far end of a horizontally scrolling
         rail, off the edge of the viewport on a phone and on most laptops. The
         free-text box was inside a collapsed <details>. So the product's
         headline capability -- "anyone uploads any photo, gives a location" --
         was reachable only by scrolling a carousel to its end and guessing.
         Paul reported it as a missing feature. It was a missing SIGNPOST.
         The <label> is the whole trick: it targets #pl-own exactly as the card
         does, so one line of prose selects the card, reveals the upload and
         moves the carousel dot, with no JavaScript anywhere. -->
    <p class="hint escape">Somewhere else in mind?
      <label class="linky" for="pl-own">Upload a photo of it</label>
      or <label class="linky" for="pl-own">describe it below</label> &mdash;
      your actual childhood garden beats any description of one.</p>

    <div class="ownplace">
      <p class="hint">A second photograph, used as a reference alongside your face.</p>
      <input type="file" id="placePhoto" name="placePhoto" accept="image/jpeg,image/png,image/webp">
    </div>

    <details class="aside" ${values.place ? 'open' : ''}>
      <summary>Or describe the place</summary>
      <p class="hint">Used only when no card above is chosen.</p>
      <input type="text" name="placeText" maxlength="200" autocomplete="off" spellcheck="false"
             placeholder="my grandmother&#39;s kitchen" value="${h(values.place)}">
    </details>
  </section>

  <section class="panel panel--commit">
    ${stepHead(4, 'The tape', 'One of these is a choice. The rest is what a camcorder tape is.')}

    <p class="eyebrow">Frame</p>
    <div class="frames">${frameCards}</div>
    <p class="hint">Every tape is <strong>fifteen seconds</strong>. 4:3 is what a camcorder
    actually recorded; 9:16 fills a phone screen for Reels and TikTok, and 16:9 is the
    landscape shape YouTube wants.</p>

    <p class="eyebrow">Quality</p>
    <div class="quality">${qualityCards}</div>
    <p class="hint">Every option delivers the same 1080&times;1920 file. What changes is how much detail
    exists before the tape &mdash; and the tape works at 720&times;576, so above that there is
    nothing left to keep.</p>

    <dl class="facts">
      <dt>Length</dt><dd>15 SEC</dd>
      <dt>Estimated cost</dt><dd>${costLines}</dd>
      <dt>Credits</dt><dd>${h(`${balance.credits} CR`)}</dd>
    </dl>

    <div class="field">
      <label for="stillCount">How many looks to choose from</label>
      <p class="hint">We make this many photos of you in the scene first. You pick your
      favourite &mdash; only then is the video made, so a likeness you do not like
      never costs you a tape.</p>
      <select id="stillCount" name="stillCount">
        ${STILL_COUNTS.map((n) => (
    `<option value="${n}"${n === STILL_COUNT_DEFAULT ? ' selected' : ''}>${n}</option>`
  )).join('')}
      </select>
    </div>

    <label class="check">
      <input type="checkbox" id="consent" name="consent" value="yes" required>
      <span class="consent-text">${
  // The wording is stored, and shown, exactly as `safety/consent.mjs` renders
  // it: two paragraphs separated by a newline. Split on the newline rather than
  // hard-coding two blocks here, so that editing the text there cannot leave
  // this page showing a paragraph the manifest does not record consent to.
  String(consentText).split('\n').map((para) => `<span>${h(para)}</span>`).join('')
}</span>
    </label>

    <button type="submit" class="record" id="record"${brokeEntirely ? ' disabled' : ''}>&#10685; Record the tape</button>
    ${brokeEntirely
    ? `<p class="reason">${h(`Not enough credits — the cheapest tape costs ~${cheapest} CR and you have ${balance.credits} CR.`)}</p>`
    : `<p class="reason" id="reason">Upload a photo first</p>${
  creditWarnings ? `
    <p class="reason">${creditWarnings}</p>` : ''}`}
    ${creditWarnings || brokeEntirely ? `<p class="reason"><a class="quiet" href="/pricing">See the plans</a></p>` : ''}
  </section>

</form>

<section class="panel panel--archive">
  <div class="step-head">
    <p class="stepno"><span class="stepno-k">Archive</span><span class="stepno-n stepno-n--mark">&#9679;</span></p>
    <div class="step-say">
      <h2 class="title">Your tapes</h2>
      <p class="sub">${h(Number.isFinite(retentionDays) && retentionDays > 0
    ? `Every recording stays on the shelf for ${retentionDays} days.`
    : 'Every finished recording lands here.')}</p>
    </div>
  </div>
  ${tapes.length ? `<div class="shelf">${tapes.map(shelfTile).join('')}</div>` : `
  <div class="empty">
    <p class="title">The shelf is empty</p>
    <p>Pick a photo, a look, and a place above &mdash; your first tape lands here.</p>
  </div>`}
</section>
</main>

<script>${HOME_SCRIPT}</script>
`;

  return layout({
    title: 'Timestamp',
    body,
    preBody,
    bodyClass: 'page-home',
    account,
    balance,
  });
}

/** One poster on the shelf. `status` is shown for anything unfinished, because a
 *  grid of identical grey rectangles tells you nothing about which one stopped.
 *
 *  THE TILE IS TWO PARTS NOW, AND THE SPLIT IS THE POINT. `.frame` is the
 *  picture and only the picture; `.cap` sits underneath it on the paper. That is
 *  DESIGN.md's locked reference taken literally -- image, name, caption, nothing
 *  drawn around the image -- and it is what let the caption's near-black scrim
 *  go, because text on the page needs no plate to survive.
 *
 *  THE NAME COMES BEFORE THE DATE, which is the reverse of the old overlay. On
 *  the reference the product name leads and the detail follows; here the place
 *  is what somebody is looking for on a shelf of their own tapes, and the date
 *  is how they tell two of the same place apart. */
function shelfTile(tape) {
  const finished = tape.status === 'done';
  const inner = finished && tape.posterUrl
    ? `<img src="${h(tape.posterUrl)}" alt="" loading="lazy" decoding="async">`
    : '';
  return `<a class="tape" href="${h(tape.href)}">
  <span class="frame">
    ${inner}
    ${finished ? '' : `<span class="state">${h(STATUS_COPY[tape.status] ?? tape.status)}</span>`}
  </span>
  <span class="cap">
    <span class="what">${h(tape.place)}</span>
    <span class="when">${h(stampDate(tape.jobId))}</span>
  </span>
</a>`;
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function stepRow(step, isCurrent) {
  const copy = STEP_COPY[step.name] ?? { title: step.name, note: '' };
  return `<li class="step step-${h(step.status)}${isCurrent ? ' step-current' : ''}">
  <span class="step-mark" aria-hidden="true"></span>
  <span class="step-name">${h(copy.title)}</span>
  <span class="step-note">${h(step.status === 'skipped' ? 'Not needed' : copy.note)}</span>
</li>`;
}

/**
 * `/j/:id`. Server-rendered with the state as it stands right now, then kept
 * current by the poller. Rendering the current state server-side rather than
 * leaving an empty shell for the script to fill is what makes a reload during a
 * four-minute wait show something instead of a spinner.
 *
 * @param {{view: object}} data  the same object `GET /api/jobs/:id` returns
 */
/**
 * `labels` carries the human name of a preset, because the manifest stores the
 * id. "schrebergarten-august" is what the pipeline needs and "Allotment garden,
 * late August" is what the person picked; showing the first is showing them our
 * filenames. Free text has no label and falls through unchanged, which is why
 * this is a fallback rather than a lookup.
 */
export function statusPage({ view, account = null, labels = {} }) {
  const current = view.steps.find((s) => s.name === view.step);
  const copy = STEP_COPY[view.step] ?? null;
  const done = view.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;

  const body = `
<main data-job="${h(view.jobId)}" data-status="${h(view.status)}" id="status">
  <section class="panel">
  <p class="stamp">${h(view.jobId)}</p>

  <p class="eyebrow">Recording</p>
  <h1 class="headline" id="headline">${h(copy ? copy.title : STATUS_COPY[view.status] ?? view.status)}</h1>
  <p class="sub" id="subline">${h(copy ? copy.note : '')}</p>

  <ol class="bar" id="bar" aria-label="Progress">
    ${view.steps.map((s) => `<li class="seg seg-${h(s.status)}" title="${h((STEP_COPY[s.name] ?? {}).title ?? s.name)}"></li>`).join('')}
  </ol>
  <p class="counter" id="counter">${h(`${Math.min(done + 1, view.steps.length)} of ${view.steps.length}`)} &middot; <span id="statusword">${h(STATUS_COPY[view.status] ?? view.status)}</span></p>

  ${view.error ? `<p class="alert" role="alert">${h(view.error.message ?? 'Something went wrong.')}</p>` : ''}

  <ol class="steps" id="steps">
    ${view.steps.map((s) => stepRow(s, s.name === view.step)).join('')}
  </ol>

  <p class="inputs">
    <span class="k">Where</span> <span class="v">${h(labels.place ?? view.input.place)}</span><br>
    <span class="k">Wearing</span> <span class="v">${h(labels.outfit ?? view.input.outfit)}</span>
  </p>

  <p class="actions">
    <button type="button" class="quiet" id="cancel">Cancel this one</button>
    <a class="quiet" href="/">Back to the shelf</a>
  </p>
  <noscript><p class="hint">This page reloads every five seconds.</p></noscript>
  </section>
</main>

<script>${STATUS_SCRIPT}</script>
`;
  return layout({
    title: `Timestamp - ${view.status}`, body, refreshSeconds: 5, bodyClass: 'page-status', account,
  });
}

// ---------------------------------------------------------------------------
// the contact sheet
// ---------------------------------------------------------------------------

/**
 * `/j/:id/select`. A plain form with one submit button per still, so it works
 * with scripting off -- this is the one screen where a person has to make a
 * decision, it gates real spend, and it must not be the screen that needs
 * JavaScript. There is no script on this page at all.
 *
 * INDICES ARE 1-BASED AND COME OFF THE RECORD, NEVER OFF THE LOOP. `still-01.png`
 * is index 1, and `s.index` is what is posted back, displayed, and compared
 * against the existing selection. Using the map callback's position here would
 * be off by one against the provider's numbering, which means the user clicks
 * frame 3 and frame 4 gets animated -- with no error anywhere, because both
 * numbers are valid. That is the failure this convention exists to prevent, so
 * there is deliberately no `+ 1` in this function.
 */
export function selectPage({ view, stills, account = null }) {
  const body = `
<main>
  <section class="panel">
  <p class="stamp">${h(view.jobId)}</p>
  <p class="eyebrow">Your decision</p>
  <h1 class="headline">Pick a frame</h1>
  <p class="sub">The video is built out of one of these. Choose the one that looks most like you &mdash;
  sharpness matters less than likeness.</p>

  <form class="sheet" method="post" action="/api/jobs/${h(view.jobId)}/select">
    ${stills.map((s) => `
    <button type="submit" name="stillIndex" value="${h(s.index)}" class="still${view.selection && view.selection.stillIndex === s.index ? ' chosen' : ''}">
      <img src="${h(s.url)}" alt="Generated frame ${h(s.index)}" decoding="async">
      <span class="still-n">${h(s.index)}</span>
    </button>`).join('')}
  </form>

  <p class="actions"><a class="quiet" href="/j/${h(view.jobId)}">Back to progress</a></p>
  </section>
</main>
`;
  return layout({ title: 'Timestamp - pick a frame', body, bodyClass: 'page-select', account });
}

// ---------------------------------------------------------------------------
// the result
// ---------------------------------------------------------------------------

export function resultPage({ view, account = null, labels = {} }) {
  // Assembled as text and escaped once, rather than stitched out of escaped
  // fragments with raw entities between them -- that pattern is where a
  // double-escape or a missed escape hides.
  const seconds = view.result?.durationSeconds;
  const metaLine = [
    seconds ? `${Number(seconds).toFixed(3)} seconds` : null,
    view.result?.frames ? `${view.result.frames} frames` : null,
    '720x576 PAL',
  ].filter(Boolean).join(' · ');
  const body = `
<main>
  <section class="panel">
  <p class="stamp">${h(view.jobId)}</p>
  <p class="eyebrow">${h(stampDate(view.jobId))}</p>
  <h1 class="headline">Here it is</h1>

  <div class="player">
    <video controls playsinline preload="metadata"
           poster="/api/jobs/${h(view.jobId)}/poster"
           src="/api/jobs/${h(view.jobId)}/video"></video>
  </div>

  <p class="meta">${h(metaLine)}</p>

  <p class="inputs">
    <span class="k">Where</span> <span class="v">${h(labels.place ?? view.input.place)}</span><br>
    <span class="k">Wearing</span> <span class="v">${h(labels.outfit ?? view.input.outfit)}</span>
  </p>

  <p class="actions">
    <!-- Both halves on purpose: the download attribute is what a same-origin
         click uses, and ?download=1 makes the server send Content-Disposition,
         so the file still arrives named correctly when the attribute is ignored
         (right-click save-as, an in-app browser, a copied link). -->
    <a class="go" href="/api/jobs/${h(view.jobId)}/video?download=1" download="timestamp-${h(view.jobId)}.mp4">Download</a>
    <a class="quiet" href="/">Make another</a>
  </p>
  </section>
</main>
`;
  return layout({ title: 'Timestamp - finished', body, bodyClass: 'page-result', account });
}

// ---------------------------------------------------------------------------
// failures
// ---------------------------------------------------------------------------

/** One page for every 4xx and 5xx a browser can reach. `detail` is only ever a
 *  string this app wrote; provider and filesystem messages stop at the server. */
export function errorPage({ status, title, detail = null, jobId = null }) {
  const body = `
<main>
  <section class="panel">
  ${jobId ? `<p class="stamp">${h(jobId)}</p>` : ''}
  <p class="eyebrow">${h(status)}</p>
  <h1 class="headline">${h(title)}</h1>
  ${detail ? `<p class="sub">${h(detail)}</p>` : ''}
  <p class="actions"><a class="go" href="/">Start again</a></p>
  </section>
</main>
`;
  return layout({ title: `Timestamp - ${status}`, body, bodyClass: 'page-error', chrome: false });
}

/** Exported so the server and the tests agree on how many segments the bar has
 *  without either of them counting by hand. */
export const STEP_COUNT = STEPS.length;
