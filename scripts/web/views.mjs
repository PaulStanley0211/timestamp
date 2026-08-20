/**
 * Every page, as pure functions from data to a string.
 *
 * WHY THERE IS NO TEMPLATE ENGINE AND THEREFORE NO AUTOMATIC ESCAPING. Zero npm
 * dependencies is the rule, so the safety property has to come from discipline
 * instead of from a library, and discipline needs to be checkable. Hence: there
 * is exactly one way a value reaches the output, `h()`, and any interpolation in
 * this file that is not wrapped in it is a bug you can find with a grep. The
 * strings that matter are not hypothetical -- `place` and `outfit` are free text
 * a stranger typed, they are echoed back on the status page, and
 * `<img src=x onerror=...>` in the outfit box is the first thing anybody tries.
 *
 * WHY THE PAGES ARE PURE STRINGS AND KNOW NOTHING ABOUT `res`. A view that takes
 * a response object can only be tested by faking one. A view that returns a
 * string can be asserted on directly, which is how `test/web-api.test.js` checks
 * that a script tag typed into the place field comes back inert.
 *
 * WHY THE STATUS PAGE NAMES THE STEP INSTEAD OF SHOWING A PERCENTAGE. This is
 * the page somebody looks at for several minutes while paid generation calls run
 * somewhere else. A bar that eases to 90% and stops is a lie that turns a working
 * render into a support request. Eleven named steps, the current one said out
 * loud, and a bar with eleven segments -- each segment is a real step, so the bar
 * is a fact rather than an animation.
 */

import { STEPS } from '../render/job.mjs';

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

const STATUS_COPY = Object.freeze({
  queued: 'Waiting for a machine',
  running: 'Working',
  'awaiting-selection': 'Waiting for you',
  done: 'Finished',
  failed: 'Stopped',
  cancelled: 'Cancelled',
});

// ---------------------------------------------------------------------------
// the shell
// ---------------------------------------------------------------------------

/**
 * `refreshSeconds` drives a `<noscript>` meta refresh, not a scripted one. The
 * status page polls a JSON endpoint when it can; when it cannot, reloading the
 * whole page every few seconds is a worse experience and a working one, and the
 * alternative is a page that sits there frozen for someone with scripting off.
 */
export function layout({ title, body, refreshSeconds = null, bodyClass = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${h(title)}</title>
<link rel="stylesheet" href="/styles.css">
${refreshSeconds ? `<noscript><meta http-equiv="refresh" content="${Number(refreshSeconds)}"></noscript>` : ''}
</head>
<body class="${h(bodyClass)}">
<div class="grain" aria-hidden="true"></div>
<div class="wrap">
<header class="masthead">
  <a class="wordmark" href="/">TIMESTAMP</a>
  <p class="tagline">One photo. Fifteen seconds. 2003.</p>
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
// the upload form
// ---------------------------------------------------------------------------

function recommendation(kind, item) {
  return `<button type="button" class="chip" data-fill="${h(kind)}" data-value="${h(item.label)}">${h(item.label)}</button>`;
}

function datalist(id, items) {
  return `<datalist id="${h(id)}">${items.map((i) => `<option value="${h(i.label)}"></option>`).join('')}</datalist>`;
}

/**
 * The upload page.
 *
 * The fourteen presets are offered as *recommendations that fill a text box*,
 * never as a select element. That is the 2026-08-20 scope decision in CLAUDE.md
 * made visible: free text is the norm and the menu is a starting point, and a
 * dropdown would say the opposite no matter what the copy underneath it claimed.
 * They are also rendered into a `<datalist>`, so the recommendations still work
 * with scripting off -- the chips are an enhancement, the datalist is the floor.
 *
 * @param {{places: Array<{id,label}>, outfits: Array<{id,label}>,
 *          consentText: string, error?: {message: string}|null,
 *          values?: {place?: string, outfit?: string}}} data
 */
export function uploadPage({ places = [], outfits = [], consentText = '', error = null, values = {} } = {}) {
  const body = `
<main>
${error ? `<p class="alert" role="alert">${h(error.message)}</p>` : ''}

<p class="lede">Upload one photo of yourself, say where you want to be and what you are wearing,
and get back fifteen seconds that look like they came off a camcorder tape.</p>

<form class="card" method="post" action="/api/jobs" enctype="multipart/form-data">

  <fieldset class="field">
    <legend>Your photo</legend>
    <p class="hint">A clear photo of your face. JPEG, PNG or WebP, up to 12&nbsp;MB.
    The location and camera data are stripped before anything else happens.</p>
    <input type="file" id="photo" name="photo" accept="image/jpeg,image/png,image/webp" required>
  </fieldset>

  <fieldset class="field">
    <legend><label for="place">Where</label></legend>
    <p class="hint">Anything you like. These are only suggestions.</p>
    <input type="text" id="place" name="place" list="place-list" maxlength="200" required
           autocomplete="off" spellcheck="false"
           placeholder="my grandmother's kitchen"
           value="${h(values.place)}">
    ${datalist('place-list', places)}
    <div class="chips">${places.map((p) => recommendation('place', p)).join('')}</div>
    <details class="aside">
      <summary>Or upload a photo of the place</summary>
      <p class="hint">A second photo, used as a reference alongside your face.
      Your actual garden beats any description of one.</p>
      <input type="file" id="placePhoto" name="placePhoto" accept="image/jpeg,image/png,image/webp">
    </details>
  </fieldset>

  <fieldset class="field">
    <legend><label for="outfit">Wearing</label></legend>
    <p class="hint">Only what is on the body &mdash; the place carries everything else.</p>
    <input type="text" id="outfit" name="outfit" list="outfit-list" maxlength="200" required
           autocomplete="off" spellcheck="false"
           placeholder="a green anorak"
           value="${h(values.outfit)}">
    ${datalist('outfit-list', outfits)}
    <div class="chips">${outfits.map((o) => recommendation('outfit', o)).join('')}</div>
  </fieldset>

  <fieldset class="field">
    <legend><label for="stillCount">Frames to choose from</label></legend>
    <p class="hint">You pick one before the video is made. More costs more and takes longer.</p>
    <select id="stillCount" name="stillCount">
      <option value="1">1</option>
      <option value="3" selected>3</option>
      <option value="5">5</option>
    </select>
  </fieldset>

  <fieldset class="field consent">
    <legend>Before you upload</legend>
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
  </fieldset>

  <button type="submit" class="go">Make the tape</button>
</form>
</main>

<script>
// Chips fill the text box; they never submit and they never replace it.
document.querySelectorAll('.chip').forEach(function (chip) {
  chip.addEventListener('click', function () {
    var input = document.getElementById(chip.dataset.fill);
    if (!input) return;
    input.value = chip.dataset.value;
    input.focus();
  });
});
</script>
`;
  return layout({ title: 'Timestamp', body, bodyClass: 'page-upload' });
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
export function statusPage({ view }) {
  const current = view.steps.find((s) => s.name === view.step);
  const copy = STEP_COPY[view.step] ?? null;
  const done = view.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;

  const body = `
<main data-job="${h(view.jobId)}" data-status="${h(view.status)}" id="status">
  <p class="stamp">${h(view.jobId)}</p>

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
    <span class="k">Where</span> <span class="v">${h(view.input.place)}</span><br>
    <span class="k">Wearing</span> <span class="v">${h(view.input.outfit)}</span>
  </p>

  <p class="actions">
    <button type="button" class="quiet" id="cancel">Cancel this one</button>
    <a class="quiet" href="/">Start another</a>
  </p>
  <noscript><p class="hint">This page reloads every five seconds.</p></noscript>
</main>

<script>
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
</script>
`;
  return layout({ title: `Timestamp - ${view.status}`, body, refreshSeconds: 5, bodyClass: 'page-status' });
}

// ---------------------------------------------------------------------------
// the contact sheet
// ---------------------------------------------------------------------------

/**
 * `/j/:id/select`. A plain form with one submit button per still, so it works
 * with scripting off -- this is the one screen where a person has to make a
 * decision, and it must not be the screen that needs JavaScript.
 *
 * INDICES ARE 1-BASED AND COME OFF THE RECORD, NEVER OFF THE LOOP. `still-01.png`
 * is index 1, and `s.index` is what is posted back, displayed, and compared
 * against the existing selection. Using the map callback's position here would
 * be off by one against the provider's numbering, which means the user clicks
 * frame 1 and frame 2 gets animated -- with no error anywhere, because both
 * numbers are valid. That is the failure this convention exists to prevent, so
 * there is deliberately no `+ 1` in this function.
 */
export function selectPage({ view, stills }) {
  const body = `
<main>
  <p class="stamp">${h(view.jobId)}</p>
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
</main>
`;
  return layout({ title: 'Timestamp - pick a frame', body, bodyClass: 'page-select' });
}

// ---------------------------------------------------------------------------
// the result
// ---------------------------------------------------------------------------

export function resultPage({ view }) {
  // Assembled as text and escaped once, rather than stitched out of escaped
  // fragments with raw entities between them -- that pattern is where a
  // double-escape or a missed escape hides.
  const seconds = view.result?.durationSeconds;
  const metaLine = [
    seconds ? `${Number(seconds).toFixed(3)} seconds` : null,
    view.result?.frames ? `${view.result.frames} frames` : null,
  ].filter(Boolean).join(' · ');
  const body = `
<main>
  <p class="stamp">${h(view.jobId)}</p>
  <h1 class="headline">Here it is</h1>

  <div class="player">
    <video controls playsinline preload="metadata"
           poster="/api/jobs/${h(view.jobId)}/poster"
           src="/api/jobs/${h(view.jobId)}/video"></video>
  </div>

  <p class="meta">${h(metaLine)}</p>

  <p class="inputs">
    <span class="k">Where</span> <span class="v">${h(view.input.place)}</span><br>
    <span class="k">Wearing</span> <span class="v">${h(view.input.outfit)}</span>
  </p>

  <p class="actions">
    <!-- Both halves on purpose: the download attribute is what a same-origin
         click uses, and ?download=1 makes the server send Content-Disposition,
         so the file still arrives named correctly when the attribute is ignored
         (right-click save-as, an in-app browser, a copied link). -->
    <a class="go" href="/api/jobs/${h(view.jobId)}/video?download=1" download="timestamp-${h(view.jobId)}.mp4">Download</a>
    <a class="quiet" href="/">Make another</a>
  </p>
</main>
`;
  return layout({ title: 'Timestamp - finished', body, bodyClass: 'page-result' });
}

// ---------------------------------------------------------------------------
// failures
// ---------------------------------------------------------------------------

/** One page for every 4xx and 5xx a browser can reach. `detail` is only ever a
 *  string this app wrote; provider and filesystem messages stop at the server. */
export function errorPage({ status, title, detail = null, jobId = null }) {
  const body = `
<main>
  ${jobId ? `<p class="stamp">${h(jobId)}</p>` : ''}
  <h1 class="headline">${h(title)}</h1>
  ${detail ? `<p class="sub">${h(detail)}</p>` : ''}
  <p class="actions"><a class="go" href="/">Start again</a></p>
</main>
`;
  return layout({ title: `Timestamp - ${status}`, body, bodyClass: 'page-error' });
}

/** Exported so the server and the tests agree on how many segments the bar has
 *  without either of them counting by hand. */
export const STEP_COUNT = STEPS.length;
