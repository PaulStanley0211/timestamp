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
 * WHY THE RATIONALE LIVES IN AN INTERPOLATION SLOT AND NEVER IN AN HTML COMMENT.
 * The shape is a dollar-brace interpolation containing a JS block comment and an
 * empty string literal -- written out here in words rather than in syntax,
 * because the closing sequence of a block comment cannot appear inside this one
 * without ending it. That trap is real and it fired while this note was being
 * written.
 * These files argue with themselves on purpose -- the reasoning beside a rule is
 * what stops the rule being undone by somebody who cannot see why it exists --
 * and that argument is for whoever EDITS this file, never for whoever visits the
 * site. An HTML comment inside a template literal is the same words shipped to
 * every browser: measured on the live landing page 2026-09-01, 5,060 of 26,166
 * bytes, 19.3%, and the cost was never the bytes. One of them quoted verbatim a
 * promise the product had DELETED -- "You approve a still before any video is
 * made" -- so anyone opening View Source read a guarantee this product does not
 * make. An interpolation slot holding a block comment evaluates to the empty
 * string, which keeps the note exactly where the markup it explains lives while
 * sending nothing. `test/web-static.test.js` fails on any `<!--` that reaches a
 * rendered page, and the rule is ZERO rather than a budget: a percentage ceiling
 * only invites the next author to spend up to it.
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

/**
 * The eleven pipeline steps, grouped into the three things a customer is
 * actually waiting for.
 *
 * WHY THIS EXISTS. `STEP_COPY` is the engine's vocabulary and it is good
 * writing, but eleven rows naming `compose` and `moderate` is a build log, and
 * a build log makes a wait feel longer than it is. This is the page somebody
 * sits on for a minute or more after paying. The eleven are not deleted -- they
 * are one disclosure away, because the detail genuinely reassures some people
 * and a product that renders a stranger's face should not be coy about what it
 * does to it.
 *
 * THE GROUPING IS BY WHAT IS HAPPENING TO THE PHOTOGRAPH, not by cost. `still`
 * and `animate` are the two slow paid calls and they sit in the same phase for
 * that reason -- a customer who reads "Filming" and waits two minutes has been
 * told the truth, where one who watches `select` tick past in a millisecond has
 * been shown a progress bar that lies about where the time goes.
 *
 * EVERY STEP MUST APPEAR IN EXACTLY ONE PHASE. A step missing from all three is
 * invisible to `phaseIndexOf` and lands the customer on phase 1 forever; a step
 * in two would count twice. `test/web-static.test.js` pins both.
 */
export const PHASES = Object.freeze([
  Object.freeze({
    title: 'Reading your photo',
    note: 'Straightening it, removing the location and camera data, and writing the scene.',
    steps: Object.freeze(['intake', 'moderate', 'expand', 'compose']),
  }),
  Object.freeze({
    title: 'Filming',
    note: 'The slowest part, and where the minutes go. A few of them.',
    steps: Object.freeze(['still', 'select', 'animate', 'assemble']),
  }),
  Object.freeze({
    title: 'Running it through the tape',
    note: 'Grain, chroma bleed, and the date in the corner.',
    steps: Object.freeze(['tape', 'verify', 'publish']),
  }),
]);

/** Which phase a step belongs to. An unknown step answers 0 rather than -1:
 *  a step this map has not been taught about is early work by definition,
 *  and a negative index would paint the bar as finished. */
export function phaseIndexOf(step) {
  const i = PHASES.findIndex((p) => p.steps.includes(step));
  return i === -1 ? 0 : i;
}

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

  // The place upload is wired FIRST and on its own, deliberately. §43D left
  // step 3 as a bare native "Choose File" because a .drop styling it without
  // this half would give LESS feedback than the control it replaced -- the
  // real input is at opacity 0, so with no script nothing would ever say which
  // file was chosen. It is guarded separately from the record button so that a
  // page carrying the place upload but no Record button still names the file.
  var place = document.getElementById('placePhoto');
  var placeName = document.getElementById('place-photo-name');
  if (place && placeName) {
    place.addEventListener('change', function () {
      var picked = place.files && place.files[0];
      placeName.textContent = picked ? picked.name : '';
    });
  }

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
  var words = ${jsonInScript(STATUS_COPY)};
  var phases = ${jsonInScript(PHASES)};

  // The same grouping the server rendered, from the same constant, so the
  // first paint and every repaint after it agree. An unknown step answers 0
  // for the reason phaseIndexOf gives: early work by definition, and a
  // negative index would paint the bar as finished.
  function phaseIndexOf(step) {
    for (var i = 0; i < phases.length; i++) {
      if (phases[i].steps.indexOf(step) !== -1) return i;
    }
    return 0;
  }

  function paint(v) {
    var idx = phaseIndexOf(v.step);
    var p = phases[idx];
    document.getElementById('headline').textContent = p.title;
    document.getElementById('subline').textContent = p.note;
    document.getElementById('statusword').textContent = words[v.status] || v.status;

    document.getElementById('counter').firstChild.nodeValue =
      (idx + 1) + ' of ' + phases.length + ' \\u00b7 ';

    // THE RECORD LIGHT STOPS WITH THE JOB. It is server-rendered only while
    // running, so a job that fails mid-poll would otherwise keep blinking at
    // somebody whose tape has already died.
    var rec = document.querySelector('.reclight');
    if (rec && v.status !== 'running' && v.status !== 'pending') rec.remove();

    var segs = document.querySelectorAll('#bar .seg');
    for (var i = 0; i < segs.length; i++) {
      segs[i].className = 'seg seg-' + (i < idx ? 'done' : i === idx ? 'running' : 'pending');
    }

    var rows = document.querySelectorAll('#steps .step');
    v.steps.forEach(function (s, i) {
      if (rows[i]) rows[i].className = 'step step-' + s.status + (s.name === v.step ? ' step-current' : '');
    });

    // The failure copy and the money line, painted from the same view the
    // server rendered -- textContent only, so nothing here can become markup.
    var alertEl = document.getElementById('alert');
    if (alertEl) {
      if (v.error && v.error.message) { alertEl.hidden = false; alertEl.textContent = v.error.message; }
      else { alertEl.hidden = true; alertEl.textContent = ''; }
    }
    var noteEl = document.getElementById('creditnote');
    if (noteEl) {
      if (v.creditNote) { noteEl.hidden = false; noteEl.textContent = v.creditNote; }
      else { noteEl.hidden = true; noteEl.textContent = ''; }
    }

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
/**
 * The sign-in dialog, opened from the landing.
 *
 * WHY THIS IS A FOURTH SCRIPT RATHER THAN THE HOISTED-RADIO TRICK the rest of
 * this page runs on. A checkbox can show and hide a panel, and that is how the
 * place carousel and every selection here work -- but it cannot trap focus,
 * cannot close on Escape, and cannot make the page behind it inert. A modal
 * that a keyboard user tabs straight out of is an accessibility defect, and
 * this product measured focus behaviour carefully enough in §16 and §6b to
 * know better. `showModal()` gives all three for free.
 *
 * IT IS AN ENHANCEMENT, NOT A REQUIREMENT. The opener is a real link to
 * /login. With no JavaScript, an unsupported dialog, or a CSP that refused
 * this script, the link simply navigates and the sign-in page works exactly as
 * it does today -- which is why nothing here is guarded against being missing.
 */
const SIGNIN_SCRIPT = `
(function () {
  var dlg = document.getElementById('signin');
  if (!dlg || typeof dlg.showModal !== 'function') return;

  var openers = document.querySelectorAll('[data-signin]');
  for (var i = 0; i < openers.length; i += 1) {
    openers[i].addEventListener('click', function (e) {
      e.preventDefault();
      dlg.showModal();
    });
  }

  var shut = dlg.querySelector('[data-signin-close]');
  if (shut) shut.addEventListener('click', function () { dlg.close(); });

  // Clicking the backdrop closes it. The dialog's own box is a child, so a
  // click that lands on the element ITSELF landed outside the box.
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
}());
`;

export const INLINE_SCRIPT_HASHES = Object.freeze(
  [HOME_SCRIPT, STATUS_SCRIPT, BG_SCRIPT, SIGNIN_SCRIPT]
    .map((s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64')),
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
    // `data-signin` is an OPENER MARK, not a behaviour. On the landing the
    // sign-in script upgrades it to open the dialog in place; on every other
    // page the dialog does not exist, the script returns early, and this stays
    // an ordinary link to /login. Same markup either way, so the nav does not
    // have to know which page it is on.
    return `<nav class="nav">
  <a href="/pricing">Plans</a>
  <a href="/login" data-signin>Sign in</a>
</nav>`;
  }
  const left = balance ? creditMeter(balance) : '';
  // The email is chrome, not decoration: every page says WHOSE account it is,
  // so being signed into an account that is not yours -- however that happened
  // -- is visible on sight instead of discoverable only from what later lands
  // on the wrong shelf.
  // "My videos" leads the links because it is the one a person comes BACK for:
  // Plans and Account are visited once, the tapes are the reason to return. It
  // is signed-in only, because /videos is gated and a link to a redirect is not
  // an offer. §36B's measured overflow is the constraint on adding anything
  // here -- .who is the only item allowed to shrink, and a browser test holds
  // the whole row inside 375px with a 58-character address.
  return `<nav class="nav">
  <span class="who">${h(account.email ?? '')}</span>
  ${left}
  <a href="/videos">My videos</a>
  <a href="/pricing">Plans</a>
  <a href="/account">Account</a>
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
  <p class="fine"><a class="quiet" href="/privacy">Privacy</a> &middot; <a class="quiet" href="/terms">Terms</a> &middot; <a class="quiet" href="/impressum">Legal notice</a></p>
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
/**
 * `pricing` is optional and is `{ fromCredits, packUSD, packCredits }`.
 *
 * THE LANDING NEVER SAID WHAT A TAPE COSTS, on any version of this page, and a
 * consumer product that hides its price reads as either enterprise or evasive.
 * It is threaded in rather than written into the markup for the reason the
 * consent text is derived from the retention config: a number typed into a
 * template is a number that goes stale silently, which is precisely how the
 * still-approval claim survived direct mode. `creditCost` and `allPacks` are
 * the same functions the pricing page and the Record button already bill from,
 * so this line cannot disagree with the ledger.
 *
 * Omitted, the line is not rendered -- so a caller that cannot price (a test
 * fake, a degraded config) shows no price rather than a wrong one.
 */
export function landingPage({ places = [], account = null, pricing = null, csrf = '' } = {}) {
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

      ${/* ONE CALL TO ACTION, AND THE SECOND ONE WAS A DUPLICATE RATHER THAN A
           CHOICE. "I have an account" pointed at /login, and the signed-out
           masthead six lines up in nav() already carries a "Sign in" link to
           the same place -- so the hero was asking the visitor to choose
           between doing the thing and doing a thing the chrome already offers.
           Two calls to action of near-equal weight is the clearest slop tell
           there is: it reads as a page that could not decide what it wanted,
           and it halves the emphasis on the one that matters. Nothing is lost
           by deleting it, which is why it goes rather than getting quieter. */''}
      <p class="hero-do">
        <a class="cta" href="/signup">Make a tape &rarr;</a>
      </p>
      ${pricing ? `<p class="hero-price">From ${h(String(pricing.fromCredits))} credits a tape.
      ${h(String(pricing.packCredits))} credits is $${h(String(pricing.packUSD))}, and tax is added at checkout.
      <a class="linky" href="/pricing">What a tape costs</a></p>` : ''}
    </div>
  </section>

  ${/* THE READ-OUT MOVED OUT OF THE PANEL AND ONTO THE PICTURE, which is where
       a camcorder actually put it. It used to sit in the corner of the 4:3 veil
       that framed the place; that veil is gone, because the place is now behind
       the whole page and showing the same photograph twice at two sizes and two
       crops is one picture too many. Kept inside .wrap so the generated
       "#pl-x:checked ~ .wrap .losd--x" rules still reach it. */''}
  <div class="losds" aria-hidden="true">${osds}
  </div>

  <section class="how">
    ${/* THIS WAS THREE EQUAL COLUMNS AND IT WAS THE ONLY TEMPLATED THING ON THE
         PAGE. §33's design review named it: a three-column 1fr grid of
         number + heading + one line is the canonical AI-generated landing
         layout, and it was "the only section on that page that reads
         templated". The COPY was never the problem -- "chroma bleed, grain, the
         head-switch band, transport jitter, the date burnt into the corner" is
         the most specific writing on the site. So the words are untouched and
         the shape is gone.

         TEXTURE LEADS because it is the only one of the three that is ours.
         Content is what any generator does; consent is what any careful company
         does; the tape chain is the product. Giving all three the same weight
         said they were equally interesting, which is exactly the flatness that
         reads as machine-made.

         AND THE NUMBERS ARE GONE, which matters more than it looks. 01/02/03
         promised a SEQUENCE, and these are not steps -- they are three facts
         about one thing. Numbering them was the page pretending to be a
         process, and a false sequence is its own small dishonesty. */''}
    <div class="how-lead">
      <h2 class="how-t">Texture</h2>
      <p class="how-d">Chroma bleed, grain, the head-switch band, transport jitter, the
      date burnt into the corner. All of it deterministic, none of it asked of a model.</p>
    </div>
    <div class="how-rest">
      <div>
        <h3 class="how-t how-t--sm">Content</h3>
        <p class="how-d">A plausible person, a plausible place, an outfit, and motion that
        goes nowhere in particular. Your photograph is the only authority on the face.</p>
      </div>
      <div>
        <h3 class="how-t how-t--sm">Consent</h3>
        <p class="how-d">Location and camera data stripped the moment your photograph
        arrives. The photograph is deleted after seven days, the tape after thirty.</p>
      </div>
    </div>
  </section>

  <section class="plain">
    ${/* The sentence that used to close this paragraph promised "You approve a
         still before any video is made, so a likeness you do not recognise costs
         you nothing." It was true of the still path and false from the day the
         web app went direct (server.mjs sets direct: true for a paid provider,
         and the still-count control is gone) -- a refund-shaped promise on the
         page that sells, which the product had stopped honouring. Deleted
         rather than reworded: whether a customer gets anything back for a
         likeness they do not recognise is a REFUND POLICY, and inventing one in
         marketing copy is how the first claim got here. test/web-static.test.js
         sweeps every page for it coming back. */''}
    <p>It is not a filter. The picture is generated, then run through a real tape chain
    in ffmpeg &mdash; the grain goes on before the upscale, the date stamp degrades with
    the image, and the frame is matted the way a camcorder frame actually sat.</p>
  </section>

</main>

  ${/* SIGNING IN HAPPENS HERE, NOT ON ANOTHER PAGE. A returning visitor was
       being sent away from the only page that sells to type a password on a
       different one. The dialog is rendered on the landing and opened in
       place; /login still exists and still works, and is exactly where the
       opener link goes when this script does not run.

       ONE PROVIDER, NOT THREE. The reference this follows offers Google, Apple
       and Microsoft. This product has Google and a password, so those are the
       two doors drawn. A button for a provider that is not wired is a dead
       control, and CLAUDE.md already rules Instagram out and defers Facebook.

       Both forms carry the anti-forgery pair, exactly as /login does -- the
       token is minted by the landing route and the cookie rides with the
       response. Without a token neither form renders, so a page built without
       one cannot show a control that is guaranteed to 403. */''}
  <dialog id="signin" class="signin" aria-labelledby="signin-t">
    <div class="signin-box">
      <button type="button" class="signin-x" data-signin-close aria-label="Close">&times;</button>
      ${/* "WELCOME TO TIMESTAMP", NOT "WELCOME BACK". This dialog opens on the
           LANDING, which is the page strangers arrive on -- so a greeting that
           assumes you have been here before is wrong for most of the people who
           will read it, and it quietly tells a first-time visitor they are in
           the wrong place. The subtitle had the same fault and moved with it:
           "your shelf is where you left it" means nothing to somebody who does
           not have one yet. Both doors are named instead. */''}
      <h2 class="signin-t" id="signin-t">Welcome to Timestamp</h2>
      <p class="signin-sub">Sign in, or start a shelf.</p>

      ${csrf ? `
      <form method="post" action="/auth/google">
        <input type="hidden" name="csrf" value="${h(csrf)}">
        <button type="submit" class="signin-way">Continue with Google</button>
      </form>

      <p class="signin-or"><span>or</span></p>

      <form method="post" action="/login" class="signin-form">
        <input type="hidden" name="csrf" value="${h(csrf)}">
        <label class="signin-l" for="signin-email">Email</label>
        ${/* AUTOFOCUS BECAUSE showModal() OTHERWISE FOCUSES THE CLOSE BUTTON.
             It takes the first focusable child, which is the X -- so the first
             thing a keyboard user met on opening the dialog was "leave", ringed
             and ready to activate on Enter. Measured: activeElement came back
             as .signin-x. The email field is what somebody who just clicked
             Sign in actually wants. */''}
        <input class="signin-i" id="signin-email" name="email" type="email" autocomplete="username" autofocus required>
        <label class="signin-l" for="signin-password">Password</label>
        <input class="signin-i" id="signin-password" name="password" type="password" autocomplete="current-password" required>
        <button type="submit" class="signin-go">Sign in</button>
      </form>` : `
      <p class="signin-sub"><a class="linky" href="/login">Continue to sign in</a></p>`}

      <p class="signin-alt"><a class="linky" href="/auth/reset">Forgot password?</a>
      <a class="linky" href="/signup">No account yet? Make a tape.</a></p>
    </div>
  </dialog>

<script>${BG_SCRIPT}</script>
<script>${SIGNIN_SCRIPT}</script>`;

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
    //
    // AND IT IS CHECKED ON LOAD (2026-08-30), which is what makes the eight
    // presets read as examples rather than as the menu. Two jobs, and only one
    // of them is new:
    //  - it reveals the own-place block, through the `#pl-own:checked` rule
    //    that has always driven it, so the upload and the free text are the
    //    first things in step 3 rather than the last;
    //  - it is the ONLY way out of a radio group. A group cannot be cleared
    //    without JavaScript, so once a preset is clicked this is what "none of
    //    these" means. That job predates the default and outlives it -- do not
    //    delete `pl-own` on the grounds that the block no longer needs
    //    revealing.
    `<input class="statehook" type="radio" form="tape" name="place" id="pl-own" value="" checked>`,
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

  // The own-place dot leads, because the own-place card leads. The dots are a
  // position indicator for the rail; if the two orders disagree the indicator
  // points at the wrong card.
  const dots = ['<span class="dot dot--own"></span>', ...places.map((p) => `<span class="dot dot--${h(placeSlug(p.id))}"></span>`)].join('');

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

  // THE SHAPE IS PART OF THE PRICE ON THE CARD TOO, and not only on the
  // estimate line below it. This was the un-shaped `r.credits`, so with 9:16
  // chosen the 720p card said ~46 CR while the estimate two panels down said
  // ~61 CR and the ledger took 61 -- two prices for one tape, on one screen.
  // It is the same defect the `costLines` comment below already records; it
  // was fixed on the estimate and left behind on the card.
  //
  // KEYED ON THE SHAPE ALONE, not on the pair: a card already knows its own
  // tier, so it needs one span per shape rather than one per (tier, shape).
  // A shape the pricing refuses gets no span, exactly as it gets no cost line.
  const crSpans = (r) => offeredAspects.map((a) => {
    const credits = r.creditsByAspect?.[a.id];
    if (!Number.isFinite(credits)) return '';
    return `<span class="cr cr--${h(aspectSlug(a.id))}">${h(`~${credits} CR`)}</span>`;
  }).join('');

  const qualityCards = resolutions.map((r) => {
    const detail = h(resolutionDetail(r));
    const cr = h(`~${r.credits} CR`);
    if (!r.available) {
      // A DEFERRED TIER HAS NO PER-SHAPE QUOTE AT ALL -- `creditCost` refuses it
      // outright (RESOLUTION_UNAVAILABLE), so there is no shape-specific number
      // to switch between. It keeps the un-shaped figure, under its own class so
      // that no card anywhere still carries a bare `class="cr"`, and nothing is
      // being mispriced because nothing here can be bought.
      return `
    <span class="qualitycard qualitycard--soon">
      <span class="name">${h(r.id)}</span>
      <span class="cr cr--soon">${cr}</span>
      <span class="detail">${detail}</span>
      <span class="flag">Coming soon</span>
    </span>`;
    }
    return `
    <label class="qualitycard qualitycard--${h(qualitySlug(r.id))}" for="${h(qualitySlug(r.id))}">
      <span class="tick" aria-hidden="true"></span>
      <span class="name">${h(r.id)}</span>
      ${crSpans(r)}
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

${/* THE PAGE HAD NO <h1>. Not a styling oversight -- a missing subject, in the
     markup and on the screen at once. It opened on a paragraph and then four
     sibling <h2>s of equal size, so a screen reader met four headings with
     nothing above them and an eye met four boxes with nothing above them: the
     same defect, read two ways. The landing page had already solved this for
     strangers ("one thing is the subject -- the sentence -- and it is several
     times the size of everything else"); the signed-in page never got the same
     treatment. The copy is not new: it is Paul's existing lede, split at the
     full stop that was already in it. */''}
<div class="app-head">
  <h1 class="app-h1">One photo, one look, one place.</h1>
  ${/* "in a German suburb" came out on 2026-08-31. It was the first sentence a
       signed-in customer reads, and it told everyone who is not in Germany that
       this product is about somewhere else -- on the page where they are about
       to upload their own face and describe their own kitchen. Section 42F took
       the country out of the place menu and the prompts and left this behind.
       Nothing is added in its place: the copy is still Paul's, split at the full
       stop that was already in it, and a replacement clause would be new
       marketing rather than a de-nationalised lede. */''}
  <p class="lede">Fifteen seconds that look like they came off a camcorder tape,
  some time around 2003.</p>
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
    ${stepHead(3, 'The place', 'Your own place beats any description of one. Start there.')}

    ${/* STEP 3 LEADS WITH YOUR OWN PLACE (2026-08-30).
         The 2026-08-20 scope change calls the user's own place "the strongest
         version of this product", and both controls that deliver it used to sit
         at the BOTTOM of this panel, behind the menu: the upload was revealed
         only by a card at the far end of a horizontally scrolling rail (§33
         measured six of eight cards already off-screen at 736px, and the own
         card was the ninth), and the free text was inside a collapsed
         <details>. A prose signpost was added to point at both, which helped
         and did not fix it -- a signpost to the back of the room is still the
         back of the room.
         So the block is FIRST and the pl-own radio is checked on load. The rule
         it rides on is unchanged; what changed is that its condition is now
         true when the page arrives. No JavaScript, exactly as before. */''}
    <div class="ownplace">
      <p class="hint">A photograph of the place &mdash; your actual back garden, the kitchen
      you remember. Used as a second reference alongside your face.</p>
      ${/* §43D CLOSED. This was a bare native "Choose File" sitting directly
           across from step 1's designed dropzone, and it was left that way
           deliberately: .drop hides its real input at opacity 0 and names the
           chosen file through HOME_SCRIPT, so styling this one WITHOUT the
           script half would have given less feedback than the native control it
           replaced. The script half now exists, so the control can match.
           A slim variant rather than the 15rem original: this is the second
           upload in a step, not the subject of one. */''}
      <label class="drop drop--slim" for="placePhoto">
        <input type="file" id="placePhoto" name="placePhoto" accept="image/jpeg,image/png,image/webp"
               aria-label="A photograph of the place">
        <span class="plus">+ Add a photo of the place</span>
        <span class="chosen-name" id="place-photo-name"></span>
      </label>
      <p class="hint or-describe">Or describe it, if you have no photograph of it.</p>
      <input type="text" name="placeText" maxlength="200" autocomplete="off" spellcheck="false"
             aria-label="Describe the place"
             placeholder="my grandmother&#39;s kitchen" value="${h(values.place)}">
    </div>

    ${/* The rail is EXAMPLES now, and the prose has to say so -- §36A's lesson
         that prose is a consumer of a change like any other. The <label> is the
         same trick it always was: it targets #pl-own exactly as the card does,
         so one line of prose comes back to your own place, re-reveals the
         block and moves the carousel dot, with no JavaScript anywhere. It is
         the way BACK now rather than the way in, because a radio group cannot
         be cleared any other way. */''}
    <p class="hint escape">No photograph of it, and nothing in mind? Start from one of
      these instead &mdash; or come back to
      <label class="linky" for="pl-own">your own place</label> at any point.</p>

    ${/* TWO CARDS IN ONE SLOT, AND EXACTLY ONE OF THEM IS EVER IN THE RAIL
         (2026-08-31). Reported by the owner: clicking the own-place card did
         nothing. It was a <label for="pl-own"> and §43 made pl-own CHECKED ON
         LOAD, so in the state every visitor arrives in it pointed at a radio
         that was already selected -- and clicking a checked radio changes no
         state, fires no event and moves nothing on the screen. The upload it
         stands for is at the TOP of this step, so by the time the rail is in
         view that control is off-screen behind you. A dead control, in the
         default state, on the step whose whole point is your own place.
         So the card splits in two by what it has to DO, and the radio that is
         already there decides which one shows -- no JavaScript, and no second
         reveal mechanism, which the stylesheet's comment on .ownplace forbids:
           own-pick  a preset is selected -> the way BACK. Label for pl-own.
           own-add   own place is selected -> the way IN. Label for the file
                     input, so one click opens the picker.
         One input, two labels, which is valid and deliberate: whichever is
         clicked opens the same picker and fills the same field, so nothing
         downstream has to know which one a person used. The input keeps its own
         aria-label, so neither label renames it. */''}
    <div class="rail">
    <label class="placecard placecard--own placecard--own-pick" for="pl-own">
      <span class="thumb" aria-hidden="true"></span>
      <span class="badge" aria-hidden="true"></span>
      <span class="cap">
        <span class="name">Use my own place</span>
        <span class="when">Your photograph</span>
      </span>
    </label>
    <label class="placecard placecard--own placecard--own-add" for="placePhoto">
      <span class="thumb" aria-hidden="true"></span>
      <span class="badge" aria-hidden="true"></span>
      <span class="cap">
        <span class="name">Add a photo of your place</span>
        <span class="when">Or describe it above</span>
      </span>
    </label>${placeCards}
    </div>
    <div class="dots" aria-hidden="true">${dots}</div>
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
    <p class="hint">Every option delivers the same file &mdash; the frame above decides its size,
    not this row. What changes is how much detail exists before the tape, and the tape
    works at 576 lines on its short edge, so above that there is nothing left to keep.</p>

    <dl class="facts">
      <dt>Length</dt><dd>15 SEC</dd>
      <dt>Estimated cost</dt><dd>${costLines}</dd>
      <dt>Credits</dt><dd>${h(`${balance.credits} CR`)}</dd>
    </dl>

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
  ${''/* A STRIP, NOT THE WHOLE SHELF (2026-08-31). This panel used to print
        every tape the account had, up to sixty, at the bottom of the order
        form. That is the right place to answer "I just made one, where is it?"
        and the wrong place to keep everything you have ever made -- so the
        recent few stay here and /videos holds the rest. The link is rendered
        only when there IS a rest, because "see all" pointing at the same four
        tiles is a lie about there being more. */}
  ${tapes.length ? `<div class="shelf">${tapes.slice(0, HOME_STRIP).map(shelfTile).join('')}</div>
  ${tapes.length > HOME_STRIP
    ? `<p class="hint"><a class="linky" href="/videos">See all ${h(tapes.length)} videos</a></p>`
    : '<p class="hint"><a class="linky" href="/videos">My videos</a></p>'}` : `
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

/** How many tapes the home page's strip shows before it defers to /videos.
 *  Four is one row at every width the layout is tested at, so the strip never
 *  wraps into a second row and starts competing with the form above it. */
const HOME_STRIP = 4;

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

/**
 * One tape on `/videos`: the same tile as the shelf, with the poster swapped
 * for a player and a download beneath it.
 *
 * `preload="none"` IS THE WHOLE DESIGN AND NOT A DETAIL. It is what lets a
 * shelf of sixty tapes cost sixty POSTERS rather than sixty decoders, and it is
 * why watching a tape here needs no JavaScript at all -- the poster attribute
 * paints the frame, the native controls start it, and nothing is fetched until
 * somebody presses play. A test asserts the attribute, because losing it is
 * invisible on a page with two tapes on it and ruinous on a page with sixty.
 *
 * AN UNFINISHED TAPE GETS NO PLAYER AND NO DOWNLOAD. There is no file behind
 * either yet, so both would be controls that can only fail when used; it keeps
 * the shelf's status tile and its link through to the job.
 */
function videoTile(tape) {
  if (tape.status !== 'done' || !tape.videoUrl) return shelfTile(tape);
  return `<div class="tape tape--play">
  <span class="frame frame--${h(aspectSlug(tape.aspect ?? '4:3'))}">
    <video class="vplay" controls preload="none" playsinline${
  tape.posterUrl ? ` poster="${h(tape.posterUrl)}"` : ''}>
      <source src="${h(tape.videoUrl)}" type="video/mp4">
    </video>
  </span>
  <span class="cap">
    <span class="what">${h(tape.place)}</span>
    <span class="when">${h(stampDate(tape.jobId))}</span>
  </span>
  <a class="dl" href="${h(tape.videoUrl)}?download=1"
     download="timestamp-${h(tape.jobId)}.mp4">Download</a>
</div>`;
}

/**
 * `GET /videos`. Every tape this account has made, newest first.
 *
 * WHY IT IS ITS OWN PAGE. The shelf has always existed, at the bottom of the
 * order form -- which is the right place to answer "I just made one, where is
 * it?" and the wrong place to keep everything you have ever made. The owner
 * asked for somewhere to watch and download, on 2026-08-31, and this is it; the
 * home page keeps a short recent strip that links here.
 *
 * IT ADDS NO ISOLATION SURFACE. The tapes come from the same `shelfFor` the
 * home page uses, which reads the ownership index and nothing else, and the
 * media URLs it hands out are the existing per-job routes -- every one of them
 * already ownership-checked by `ownedJob`. There is a test that another
 * account's tape cannot appear here.
 */
export function videosPage({ account = null, balance = null, tapes = [], retentionDays = null } = {}) {
  const body = `
<main>
  <section class="panel panel--archive">
    <h1 class="app-h1">My videos</h1>
    <p class="lede">Every tape you have made. Press play to watch one here, or download it.</p>
    <p class="hint">${h(Number.isFinite(retentionDays) && retentionDays > 0
    ? `Every recording stays on the shelf for ${retentionDays} days.`
    : 'Every finished recording lands here.')}</p>

    ${tapes.length ? `<div class="shelf">${tapes.map(videoTile).join('')}</div>` : `
    <div class="empty">
      <p class="title">No videos yet</p>
      <p>Make your first tape and it lands here &mdash; <a class="linky" href="/">start one</a>.</p>
    </div>`}
  </section>
</main>
`;
  return layout({ title: 'My videos', body, bodyClass: 'page-videos', account, balance });
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
  // `current` and a done-count used to live here. Both went with the
  // step-by-step bar: the page counts phases now, and the per-step statuses
  // are read straight off `view.steps` where the detail list renders them.
  const phaseIdx = phaseIndexOf(view.step);
  const phase = PHASES[phaseIdx];

  const body = `
<main data-job="${h(view.jobId)}" data-status="${h(view.status)}" id="status">
  <section class="panel">
  <p class="stamp">${h(view.jobId)}</p>

  ${/* THE RECORD LIGHT, ON THE ONE SCREEN IN THE PRODUCT THAT IS LITERALLY A
       RECORDING IN PROGRESS. `--rec` has been a token since the mark landed
       and appeared nowhere but the chrome. It is rendered only while the job
       is actually running: a blinking REC over a finished or failed job is a
       lie about what the machine is doing, and there is a test for it. The
       blink honours prefers-reduced-motion in the stylesheet. */''}
  ${view.status === 'running' || view.status === 'pending'
    ? '<p class="reclight"><span class="dot" aria-hidden="true"></span>REC</p>'
    : `<p class="eyebrow">${h(STATUS_COPY[view.status] ?? view.status)}</p>`}
  <h1 class="headline" id="headline">${h(phase.title)}</h1>
  <p class="sub" id="subline">${h(phase.note)}</p>

  ${/* THREE SEGMENTS, ONE PER PHASE. This was one segment per pipeline step,
       which spent four of its eleven on work that finishes in milliseconds and
       two on the calls that take minutes -- a bar that moves fastest exactly
       where the waiting is not. */''}
  <ol class="bar" id="bar" aria-label="Progress">
    ${PHASES.map((p, i) => `<li class="seg seg-${i < phaseIdx ? 'done' : i === phaseIdx ? 'running' : 'pending'}" title="${h(p.title)}"></li>`).join('')}
  </ol>
  <p class="counter" id="counter">${h(`${phaseIdx + 1} of ${PHASES.length}`)} &middot; <span id="statusword">${h(STATUS_COPY[view.status] ?? view.status)}</span></p>

  ${/* THE MOST USEFUL SENTENCE ON A PAGE NOBODY WANTS TO SIT ON. The job is a
       queue entry and a worker claims it, so closing the browser changes
       nothing -- but the page never said so, and the honest reading of a live
       progress bar is "stay here". Static, so the poller never touches it. */''}
  <p class="hint">You can close this page and come back &mdash; the tape carries on without you.</p>

  ${''/* Both surfaces ALWAYS exist, hidden while empty: the poller repaints
        them, and a job that fails MID-POLL would otherwise never show its
        failure copy or its refund line until a manual reload. The message is
        already customer copy -- jobView ships the authored userMessage or one
        generic sentence, never the operator's exception text. */}
  <p class="alert" role="alert" id="alert"${view.error ? '' : ' hidden'}>${h(view.error?.message ?? '')}</p>
  <p class="hint creditnote" id="creditnote"${view.creditNote ? '' : ' hidden'}>${h(view.creditNote ?? '')}</p>

  ${/* THE ELEVEN, ONE LINE AWAY. Native <details>, so this costs no script and
       no fourth inline hash -- `script-src` names the shipped scripts by hash
       and a new one would be dead in the browser. The poller still repaints
       `#steps .step` inside here whether it is open or shut, so nothing about
       the live update changes. */''}
  <details class="stepdetail">
    <summary>Show all ${h(String(view.steps.length))} steps</summary>
    <ol class="steps" id="steps">
      ${view.steps.map((s) => stepRow(s, s.name === view.step)).join('')}
    </ol>
  </details>

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
  // THE RASTER IS THIS JOB'S, not a constant. This was the literal
  // '720x576 PAL' -- the 4:3 contract, which is the base rather than an entry
  // in the aspects map, so it kept reading correctly while two shapes were
  // added around it. A 16:9 tape works at 1024x576 and a 9:16 one at 576x1024,
  // and the page was captioning both of them 720x576.
  //
  // It comes off the job's own frozen block, so it describes the file being
  // shown rather than what today's config would produce for a new order. A job
  // that froze nothing gets no raster line at all: printing the default would
  // be the same bug with a fallback in front of it.
  //
  // PAL IS KEPT ONLY FOR THE SHAPE THAT IS PAL. 720x576 at SAR 16/15 is the
  // format; the other two are square-pixel rasters that merely share its 25fps
  // line rate, and calling them PAL replaces one wrong fact with another.
  const tape = view.result?.tape;
  const raster = Number.isFinite(tape?.width) && Number.isFinite(tape?.height)
    ? `${tape.width}x${tape.height}${(view.input?.aspect ?? '4:3') === '4:3' ? ' PAL' : ''}`
    : null;
  // THE SPEC LINE LOSES ITS DURATION AND KEEPS EVERYTHING ELSE. A frame count
  // and a raster are facts a customer has no use for on the page where they
  // meet a memory, so the line demotes below the buttons rather than captioning
  // the picture -- but it is not deleted, because it is the only place the tape
  // says what it physically is. `metaLineOf` in the tests reads `class="meta"`
  // exactly, which is why the demotion is a stylesheet change and not a second
  // class here.
  const metaLine = [
    view.result?.frames ? `${view.result.frames} frames` : null,
    raster,
  ].filter(Boolean).join(' · ');

  // The runtime moves ONTO the label, in words, because "15 seconds" is a
  // thing somebody says about a tape and "15.000 seconds" is a thing an
  // assertion says about a file. Rounded for the same reason.
  const runtime = Number.isFinite(Number(seconds)) && Number(seconds) > 0
    ? `${Math.round(Number(seconds))} seconds`
    : null;
  const labelSub = [labels.outfit ?? view.input?.outfit ?? null, runtime].filter(Boolean).join(' · ');
  const body = `
<main>
  <section class="panel">
  <p class="stamp">${h(view.jobId)}</p>

  ${/* THE PICTURE OPENS THE PAGE. There was an eyebrow and an <h1> saying
       "Here it is" above this, which captioned something already on the
       screen -- the clearest kind of filler. The naming that heading was
       doing badly is done properly by the label below, which is also where
       the date went. */''}
  <div class="player">
    <video controls playsinline preload="metadata"
           poster="/api/jobs/${h(view.jobId)}/poster"
           src="/api/jobs/${h(view.jobId)}/video"></video>
  </div>

  ${/* THE LABEL IS THE OBJECT THIS PRODUCT IMITATES. A cassette carries a
       label saying where and when, and so does this: place, then outfit and
       runtime, then the date in the accent. It replaces the old eyebrow, the
       old headline and the two-row Where/Wearing table with one element that
       carries all of it -- and it is a fill rather than a box, so DESIGN.md's
       no-borders rule is untouched. The human labels, never the preset ids:
       this is the most-read line on the page and therefore the worst place to
       leak `schrebergarten-august` at somebody. */''}
  <p class="label">
    <span class="lname">${h(labels.place ?? view.input.place)}</span>
    <span class="lsub">${h(labelSub)}</span>
    <span class="ldate">${h(stampDate(view.jobId))}</span>
  </p>

  <p class="actions">
    ${/* Both halves on purpose: the download attribute is what a same-origin
         click uses, and ?download=1 makes the server send Content-Disposition,
         so the file still arrives named correctly when the attribute is ignored
         (right-click save-as, an in-app browser, a copied link).

         IT COMES BEFORE THE FINE PRINT NOW. It is the reason the page exists
         and it used to sit last, underneath the Art. 50 sentence, so the final
         thing on the payoff page was a disclaimer rather than the tape. */''}
    <a class="go" href="/api/jobs/${h(view.jobId)}/video?download=1" download="timestamp-${h(view.jobId)}.mp4">Download</a>
    <a class="quiet" href="/">Make another</a>
  </p>

  <p class="meta">${h(metaLine)}</p>

  ${/* EU AI Act Art. 50: the disclosure lives on the page where a person
       meets the content, not only in file metadata a browser never shows.
       The file-side half is the provenance tags in scripts/audio/mix.mjs.
       It stays VISIBLE and it stays on this page -- moving the download above
       it changes the order and nothing else. */''}
  <p class="fine">Made with AI &mdash; a generative model built this scene from your photograph. It did not happen.</p>
  </section>
</main>
`;
  return layout({ title: 'Timestamp - finished', body, bodyClass: 'page-result', account });
}

// ---------------------------------------------------------------------------
// the legal pages
// ---------------------------------------------------------------------------

/**
 * Who is selling, rendered -- or the honest placeholder while nobody is.
 *
 * The entity comes from config/legal.json, where null is the DESIGNED state
 * until the owner decides the selling entity (CLAUDE.md section 37G). The
 * placeholder is what stops these pages lying in the meantime, and the deploy
 * runbook's smoke list is what stops the placeholder reaching customers.
 * Everything here is escaped like any other value; "it is only config" is how
 * a template injection arrives the day the value comes from somewhere else.
 */
function operatorBlock(entity, { heading = 'Operator' } = {}) {
  if (!entity) {
    return `
  <h2 class="eyebrow legal-h">${h(heading)}</h2>
  <p class="sub">The operator's legal details will be published here before commercial launch.</p>`;
  }
  return `
  <h2 class="eyebrow legal-h">${h(heading)}</h2>
  <p class="sub">${h(entity.name)}<br>
  ${(entity.addressLines ?? []).map((line) => h(line)).join('<br>\n  ')}<br>
  ${h(entity.email)}${entity.vatId ? `<br>\n  VAT ID: ${h(entity.vatId)}` : ''}</p>`;
}

export function privacyPage({ entity = null, retention = { photoDays: 7, jobDays: 30 }, account = null }) {
  const body = `
<main>
  <section class="panel">
  <p class="eyebrow">Privacy</p>
  <h1 class="headline">Your photo, and what happens to it</h1>

  ${operatorBlock(entity, { heading: 'Controller' })}

  <h2 class="eyebrow legal-h">What we process, and why</h2>
  <p class="sub">Your email address, to run your account. The photograph you upload and the
  place and outfit you choose, to generate your tape. Your credit balance and its history,
  to charge and refund fairly. We never see a card number and we run no analytics or
  advertising trackers. We set three cookies and no others: one keeps you signed in, one
  protects the forms you submit, and one carries a Google sign-in safely back to us. All
  three are strictly necessary to run the service, which is why you are not asked to
  consent to them and why there is no cookie banner.</p>

  <h2 class="eyebrow legal-h">Who touches the data</h2>
  <p class="sub">Your photograph is sent to fal.ai, the AI provider that generates the video,
  and to nobody else. Sign-in runs through Supabase; payments through Stripe, on Stripe's own
  pages; the six-digit sign-up codes are delivered by Resend. The application and its files
  run on Hetzner servers in Germany.</p>

  <h2 class="eyebrow legal-h">How long we keep it</h2>
  <p class="sub">Your photo is deleted after ${h(retention.photoDays)} days and the finished
  video after ${h(retention.jobDays)} days &mdash; the same promise the consent text makes,
  enforced by an automatic sweep. You can delete either sooner, along with your whole
  account, at any time.</p>

  <h2 class="eyebrow legal-h">Your rights</h2>
  <p class="sub">Everything is on <a class="linky" href="/account">your account page</a>:
  export your data as one file, or delete the account and everything it owns &mdash; the
  upstream identity, your jobs, your sessions and your record here. You also have the right
  to correct your data and to complain to a supervisory authority.</p>

  <h2 class="eyebrow legal-h">AI-generated content</h2>
  <p class="sub">Every tape this service produces is synthetic &mdash; generated by an AI
  model from your photograph. The page that delivers it says so, and the file itself carries
  machine-readable provenance metadata.</p>
  </section>
</main>
`;
  return layout({ title: 'Timestamp - privacy', body, bodyClass: 'page-legal', account });
}

export function termsPage({ entity = null, account = null }) {
  const body = `
<main>
  <section class="panel">
  <p class="eyebrow">Terms</p>
  <h1 class="headline">The deal, in plain words</h1>

  ${operatorBlock(entity, { heading: 'Who you are dealing with' })}

  <h2 class="eyebrow legal-h">The service</h2>
  <p class="sub">You upload a photo, choose a place, an outfit and a frame shape, and an AI
  model generates a fifteen-second video that looks like a 2003 camcorder tape. The result
  is synthetic media: a scene that did not happen, marked as such.</p>

  <h2 class="eyebrow legal-h">Credits</h2>
  <p class="sub">Tapes cost credits and the price is shown beside the button before you
  order. A render that fails to deliver a tape refunds its unspent credits automatically.
  Credits are not redeemable for money.</p>

  <h2 class="eyebrow legal-h">Cancelling and refunds</h2>
  <p class="sub">Credits are added to your account the moment your payment clears, which is
  why the payment page asks you to confirm you want them straight away &mdash; once they are
  there, a purchase cannot be cancelled for a refund. Credits you have not spent stay in your
  account and do not expire. If a render fails to deliver a tape, the credits it did not spend
  come back automatically; if something goes wrong that this page does not cover, write to
  <a class="linky" href="mailto:support@timestamptapes.com">support@timestamptapes.com</a> and
  we will sort it out.</p>

  <h2 class="eyebrow legal-h">Your photo, your responsibility</h2>
  <p class="sub">Upload only photographs of yourself, or of someone who has given you their
  clear permission &mdash; the consent box you tick at signup and at every order is a promise
  to us and to them. We may refuse or remove content that breaks that promise or the law,
  and we answer takedown requests from anyone who appears in a tape without consent &mdash;
  write to <a class="linky" href="mailto:support@timestamptapes.com">support@timestamptapes.com</a>
  and you do not need an account with us to do it.</p>

  <h2 class="eyebrow legal-h">What we do not promise</h2>
  <p class="sub">Generation runs on third-party AI models and results vary; a likeness is
  not guaranteed. The service is provided without warranty of uninterrupted availability.
  Nothing here limits liability that cannot lawfully be limited.</p>
  </section>
</main>
`;
  return layout({ title: 'Timestamp - terms', body, bodyClass: 'page-legal', account });
}

/**
 * A legal duty, not a courtesy: the operator is resident in Germany, so § 5
 * DDG binds this service and this page is how it is discharged.
 *
 * THE CITATION IS DDG AND NEVER TMG. This page shipped reading "Angaben
 * gemäß § 5 TMG" -- the Telemediengesetz, which was REPEALED in May 2024 and
 * replaced by the Digitale-Dienste-Gesetz. That heading named a statute that
 * no longer exists, and it would have been wrong for any operator, anywhere.
 *
 * The address must be one at which documents can be served (ladungsfähige
 * Anschrift) -- which is why the entity comes from TIMESTAMP_LEGAL_ENTITY in
 * `.env` and not from the committed config: for a sole trader that address is
 * usually a home address, and this repository is public.
 */
export function impressumPage({ entity = null, account = null }) {
  const body = `
<main>
  <section class="panel">
  <p class="eyebrow">Legal notice (Impressum)</p>
  <h1 class="headline">Information required under &sect; 5 DDG</h1>
  ${operatorBlock(entity, { heading: 'Operator' })}
  ${entity ? `<h2 class="eyebrow legal-h">Contact</h2>
  <p class="sub">${h(entity.email)}</p>` : ''}
  </section>
</main>
`;
  return layout({ title: 'Timestamp - legal notice', body, bodyClass: 'page-legal', account });
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
