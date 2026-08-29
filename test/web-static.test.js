/**
 * The generated stylesheet, and the one rule in it that is load-bearing for
 * whether the page is usable at all.
 *
 * WHY A CSS ASSERTION IS WORTH A TEST FILE. Almost everything in
 * `static.mjs` is presentation, and asserting on presentation is how a test
 * suite becomes something people delete. This file asserts exactly one thing
 * that is not presentation: the hoisted radios must be positioned against the
 * VIEWPORT, not the document.
 *
 * THE BUG IT EXISTS TO PREVENT. `views.mjs` hoists every `.statehook` radio to
 * the top of `<body>` so that `:checked ~ .bgs` and `:checked ~ .wrap` can
 * reach the background layer and the cards -- CSS can only look forward from a
 * sibling, so the inputs have to precede everything they style. Clicking a
 * `<label for>` focuses its input, and a browser scrolls a newly focused
 * element into view. With `position: absolute` those inputs sit at document
 * offset -1, so choosing 720p at step 4 threw the page back to step 1.
 * Measured in a real browser: **1641px on the quality cards, 1062px on the
 * place carousel, 449px on the outfit cards, on every single click.** The
 * selection itself always worked, which is what made it read as a scrolling
 * bug rather than a broken control.
 *
 * `position: fixed` positions the inputs against the viewport, so they are
 * always already in view and there is nothing to scroll to. Re-measured the
 * same six targets after the change: 0px, every one.
 *
 * WHY THIS IS A STRING CHECK AND NOT A SCROLL CHECK. The failure is a browser
 * layout behaviour and `node --test` has no layout engine, so a genuine
 * reproduction needs a real browser and is not worth a dependency here. What
 * this file can do -- cheaply, in milliseconds, with no browser -- is refuse
 * the one-word edit that reintroduces it. `position: absolute` on `.statehook`
 * is never correct, and that is a fact a string can hold.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createStylesheet } from '../scripts/web/static.mjs';
import {
  creditMeter, homePage, landingPage, statusPage, selectPage, resultPage, errorPage,
} from '../scripts/web/views.mjs';
import {
  loginPage, signupPage, pricingPage, authUnavailablePage, verifyPage, identityUnavailablePage,
  resetPage, resetCompletePage, onboardingPage,
} from '../scripts/web/views-auth.mjs';

/** The `.statehook` block, from its selector to its closing brace. */
function statehookRule(css) {
  const start = css.indexOf('.statehook {');
  assert.notEqual(start, -1, 'the .statehook rule has disappeared from the stylesheet');
  const end = css.indexOf('}', start);
  assert.notEqual(end, -1, 'the .statehook rule is not closed');
  return css.slice(start, end + 1);
}

test('the hoisted radios are positioned against the viewport, not the document', () => {
  const rule = statehookRule(createStylesheet().css);

  assert.match(rule, /position:\s*fixed/,
    '.statehook must be position:fixed -- see this file\'s header. '
    + 'position:absolute puts the radios at document offset -1, and clicking any '
    + 'card then scrolls the page to the top (measured: 1641px at step 4).');

  assert.doesNotMatch(rule, /position:\s*absolute/,
    '.statehook is position:absolute again, which is the scroll-to-top bug');
});

test('the hoisted radios cannot swallow a click in the top-left corner', () => {
  const rule = statehookRule(createStylesheet().css);
  // Seventeen 1px boxes stacked at 0,0 would otherwise sit over the wordmark.
  // This does not affect keyboard focus, so the tab order the block preserves
  // on purpose is untouched.
  assert.match(rule, /pointer-events:\s*none/,
    '.statehook needs pointer-events:none, or the stacked 1px boxes intercept '
    + 'clicks at the very top-left of the page');
});

test('the radios stay focusable -- hiding them with display:none would not', () => {
  const rule = statehookRule(createStylesheet().css);
  // `display:none` and `visibility:hidden` both remove an element from the tab
  // order. The clip-path technique keeps these radios keyboard-reachable, which
  // is the only thing making the CSS-only selection accessible at all.
  assert.doesNotMatch(rule, /display:\s*none/,
    '.statehook must not use display:none -- it removes the radios from the tab order');
  assert.doesNotMatch(rule, /visibility:\s*hidden/,
    '.statehook must not use visibility:hidden -- it removes the radios from the tab order');
  assert.match(rule, /clip-path:/, '.statehook lost the clip-path that hides it visually');
});

// ---------------------------------------------------------------------------
// the credit meter
// ---------------------------------------------------------------------------

/**
 * The ring that empties as credits are spent.
 *
 * WHY THESE ASSERTIONS AND NOT A SCREENSHOT. `creditMeter` is a pure function
 * from a balance to a string, so the arithmetic that decides how full the ring
 * looks -- and the three states it can be in -- is checkable without a browser.
 * What cannot be checked here is whether it LOOKS right, and that is fine: the
 * failure this guards against is not an ugly ring, it is a ring that tells
 * somebody they can afford a tape when they cannot.
 */
test('the credit ring is a fraction of the plan, and clamps rather than wrapping', () => {
  const plan = { perPeriod: 48, cheapest: 16 };
  const pctOf = (credits) => Number(
    creditMeter({ credits, ...plan }).match(/stroke-dasharray="(\d+)/)[1],
  );

  assert.equal(pctOf(48), 100, 'a full period is a full ring');
  assert.equal(pctOf(24), 50);
  assert.equal(pctOf(0), 0);

  // A BALANCE CAN EXCEED A PERIOD -- a manual grant, a plan change, or credits
  // that simply rolled over, since `expiryDays` is null in config/credits.json.
  // An unclamped arc wraps past twelve o'clock and reads as NEARLY EMPTY, which
  // is the most dangerous way this component could be wrong.
  assert.equal(pctOf(153), 100, 'an over-full balance must clamp, never wrap');
  assert.equal(pctOf(-5), 0, 'a negative balance must not draw a negative arc');
});

test('the meter distinguishes low from spent, because they are different facts', () => {
  const plan = { perPeriod: 48, cheapest: 16 };
  const stateOf = (credits) => creditMeter({ credits, ...plan }).match(/creds--(\w+)/)[1];

  assert.equal(stateOf(48), 'ok');
  assert.equal(stateOf(32), 'ok', 'exactly two tapes is not yet low');
  assert.equal(stateOf(24), 'low', 'fewer than two tapes is worth noticing');
  assert.equal(stateOf(16), 'low', 'exactly one tape left');
  // The one that matters: 15 credits still draws a third of a ring, and a third
  // of a ring looks like it might be enough. It is not, and the colour says so
  // rather than letting somebody find out by being refused.
  assert.equal(stateOf(15), 'spent', 'below the cheapest tape is spent, not low');
  assert.equal(stateOf(0), 'spent');
});

test('the meter degrades to a plain number when there is no plan to measure against', () => {
  // `planAllowance` returns 0 when the plan is unknown or the auth module is
  // unavailable. A ring that is a fraction of nothing is worse than no ring.
  const html = creditMeter({ credits: 42, perPeriod: 0, cheapest: 16 });
  assert.ok(!html.includes('<svg'), 'no ring without an allowance');
  assert.ok(html.includes('42 CR'), 'the number survives');
});

test('the meter says how many tapes are left, in words that agree with themselves', () => {
  const plan = { perPeriod: 48, cheapest: 16 };
  const titleOf = (credits) => creditMeter({ credits, ...plan }).match(/title="([^"]*)"/)[1];
  assert.match(titleOf(48), /about 3 more tapes/);
  assert.match(titleOf(16), /about 1 more tape\b/, 'one tape is singular');
  assert.match(titleOf(15), /not enough for a tape/);
});

// ---------------------------------------------------------------------------
// the focus indicator on the hoisted radios
// ---------------------------------------------------------------------------

/**
 * WCAG 2.4.7 Focus Visible, Level A, on the one control family that cannot
 * satisfy it the ordinary way.
 *
 * THE BUG. `.statehook` radios are 1x1px with `clip-path: inset(50%)` -- that
 * is deliberate and is what keeps them in the tab order (see the top of this
 * file). But it also means the global `:focus-visible { outline: 2px solid }`
 * paints its outline on a clipped 1px box: the rule matches, the browser draws,
 * and nothing is visible. Tabbing the signed-in page moves focus through every
 * place, outfit, quality and frame option with no indication of where it is.
 * The visible control is the `<label>` further down the page, so the indicator
 * has to be drawn THERE, keyed on the radio's focus state.
 *
 * WHY THE ASSERTION CHECKS THE TARGET CLASS AND NOT JUST THE ID. A place radio
 * already had a `#pl-x:focus-visible ~ .wrap .lopt--pl-x` rule -- and `.lopt` is
 * the LANDING page's struck list, which does not exist on the signed-in page at
 * all. Asserting only that the id appears somewhere in a focus selector passes
 * against a rule that can never match on the page being tabbed through. So each
 * rule's target class must also be a class the page actually renders.
 *
 * WHY IT IS DERIVED FROM THE MENU. `presetCss` emits one rule per catalog
 * entry, so a hand-written list of ids would pass forever while a ninth place
 * shipped unlit. Reading the ids back out of the rendered page means the
 * assertion grows with the catalog by construction.
 *
 * The earlier audit that reported "0 violations across 12 focusables"
 * undercounted for a related reason -- it walked `.wrap`, and these radios are
 * hoisted OUTSIDE it.
 */
const FOCUS_MENU = Object.freeze({
  places: [
    { id: 'schrebergarten-august', label: 'Schrebergarten', timeOfDay: 'August afternoon' },
    { id: 'ostsee-strand', label: 'Ostsee', timeOfDay: 'Late morning' },
  ],
  outfits: [
    { id: 'trainingsjacke', label: 'Trainingsjacke', wardrobe: 'a zipped track top, collar up' },
    { id: 'sommerkleid', label: 'Sommerkleid', wardrobe: 'a cotton summer dress' },
  ],
  resolutions: [
    { id: '480p', width: 640, height: 480, available: true },
    { id: '720p', width: 960, height: 720, available: true },
  ],
  aspects: [
    { id: '4:3', label: 'Tape', available: true },
    { id: '16:9', label: 'Wide', available: true },
    { id: '9:16', label: 'Tall', available: true },
  ],
});

/** Every id the signed-in page makes keyboard-focusable via a hoisted radio. */
function hoistedRadioIds(html) {
  const ids = [...html.matchAll(/<input class="statehook"[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 0, 'the signed-in page emits no .statehook radios at all');
  return ids;
}

/**
 * Does the sheet draw something visible on `html` when `#id` is focused?
 *
 * A rule counts only if it targets a class the page renders -- `.wrap` itself
 * is excluded because every one of these selectors passes through it, so
 * matching on it would make the check vacuous again in a different way.
 */
function marksItsLabel(css, id, html) {
  const selectors = [...css.matchAll(new RegExp(`#${id}:focus-visible([^{]*)\{`, 'g'))];
  return selectors.some(([, rest]) => [...rest.matchAll(/\.([\w-]+)/g)]
    .some(([, cls]) => cls !== 'wrap' && html.includes(cls)));
}

/**
 * Every page this app can put in front of a person, rendered.
 *
 * Written as a list rather than as a loop over an export map on purpose: a page
 * added to views.mjs and not added here is invisible to these checks, and the
 * whole reason they exist is that five pages were invisible to the last one.
 * The arguments are the thinnest thing each page will accept -- these tests are
 * about the world the page is drawn in, not about its content.
 */
function renderedPages() {
  const view = {
    jobId: '20260824-120000-abcdef',
    status: 'running',
    step: 'animate',
    pct: 50,
    steps: [{ name: 'intake', status: 'done', attempts: 1, startedAt: null, endedAt: null, error: null }],
    cost: { estimated: 2.08, actual: null, currency: 'USD' },
    result: { videoPath: null, posterPath: null, videoUrl: null, posterUrl: null, durationSeconds: null, frames: null, lufs: null },
    error: null,
    input: { place: 'schrebergarten-august', placeKind: 'preset', outfit: 'trainingsjacke', outfitKind: 'preset', stillCount: 0 },
  };
  const plans = [{ id: 'free', label: 'Free', monthlyUSD: 0, annualUSD: 0, creditsPerPeriod: 20 }];
  const resolutions = [{ id: '480p', credits: 21, available: true }];

  return [
    ['landing', landingPage({ places: [], account: null })],
    ['home', homePage({ ...FOCUS_MENU, consentText: 'I agree' })],
    ['login', loginPage({})],
    ['signup', signupPage({ consentText: 'I am in this photo.' })],
    ['verify', verifyPage({ email: 'a@b.com' })],
    ['reset', resetPage({})],
    ['reset-complete', resetCompletePage({ email: 'a@b.com' })],
    ['pricing', pricingPage({ plans, resolutions, currentPlan: null })],
    ['onboarding', onboardingPage({ account: { email: 'a@b.com', consent: { granted: true } } })],
    ['onboarding-consent', onboardingPage({
      account: { email: 'a@b.com', consent: null }, consentText: 'I agree.', csrf: 'x',
    })],
    ['status', statusPage({ view })],
    ['select', selectPage({ view, stills: [] })],
    ['result', resultPage({ view })],
    ['error', errorPage({ status: 404, title: 'Not found' })],
    ['auth-unavailable', authUnavailablePage()],
    ['identity-unavailable', identityUnavailablePage()],
  ];
}

test('no page the app can render wears a texture of its own', () => {
  // DESIGN.md, "Texture belongs to the tape, and to nothing else": the interface
  // carries NO grain, scanlines, noise or vignette, and every trace of texture
  // on any page lives inside a tape frame.
  //
  // THIS TEST USED TO REQUIRE THE GAUZE ON EVERY PAGE, and that is why it is
  // worth reading rather than skimming. The Struck palette named the anode mesh
  // "fixed, over everything", so the mesh was made structural here -- while the
  // rule four sections above it in the same file forbade scanlines on the
  // interface. A 1px-on-4px repeating gradient across the viewport is
  // scanlines. Both could not hold, the texture rule is the stronger one, and
  // the mesh was deleted from the sheet on 2026-08-28 when the pages moved to
  // paper. The assertion is not relaxed by that -- it is the same rule with the
  // exception taken out, and it now covers the gauze as well as the grain.
  for (const [name, html] of renderedPages()) {
    assert.ok(!/class="[^"]*\bgauze\b/.test(html),
      `${name} still renders the anode gauze, which is scanlines over the interface`);
    assert.ok(!/class="[^"]*\bgrain\b/.test(html),
      `${name} still renders the grain plate, which DESIGN.md forbids on the interface`);
  }
});

test('the gauze is gone from the stylesheet, not merely unreferenced', () => {
  // The same argument as the grain plate below: markup nobody emits today is
  // one `preBody` away from being emitted tomorrow, and a rule that still
  // exists is an invitation to use it.
  const { css } = createStylesheet(FOCUS_MENU);
  assert.ok(!/\.gauze\b/.test(css), 'a .gauze rule is still in the sheet');
});

test('the grain plate is gone from the stylesheet, not merely switched off', () => {
  // Suppressing it per page is exactly what let five pages keep it. A
  // `display: none` rule is one tidy-up away from being switched back on, and
  // the plate itself is half a kilobyte of fractal noise nothing may use.
  const { css } = createStylesheet(FOCUS_MENU);
  assert.ok(!/\.grain\b/.test(css), 'a .grain rule is still in the sheet');
  assert.ok(!/feTurbulence/.test(css), 'the noise plate data-URI is still in the sheet');
});

test('no border in the sheet draws a line of its own colour', () => {
  // The one rule. Borders written against `var(--hairline)` are already
  // transparent -- that is how the two converted pages went borderless without
  // rewriting three hundred rules -- but a LITERAL colour in a border
  // declaration cannot be neutralised by a token and is always a visible line.
  // DESIGN.md's two exceptions are safe here: `outline` is not a border, and
  // `.shape` draws with a var.
  const { css } = createStylesheet(FOCUS_MENU);
  const offenders = css.split('\n')
    .map((l) => l.trim())
    .filter((l) => /border(-(top|right|bottom|left))?(-color)?:[^;]*(#[0-9a-fA-F]{3,8}|rgba?\()/.test(l));

  assert.deepEqual(offenders, [],
    'DESIGN.md forbids rules and dividers anywhere, and a border with a literal '
    + 'colour is a line no token can turn off:\n' + offenders.join('\n'));
});

test('every hoisted radio marks its visible label when it takes focus', () => {
  const { css } = createStylesheet(FOCUS_MENU);
  const html = homePage({ ...FOCUS_MENU, consentText: 'I agree' });

  const unlit = hoistedRadioIds(html).filter((id) => !marksItsLabel(css, id, html));

  assert.deepEqual(unlit, [],
    'These radios are 1x1px and clip-path-hidden, so the global :focus-visible '
    + 'outline paints nothing anyone can see. Each needs a rule marking a label '
    + 'that is actually on this page -- WCAG 2.4.7, Level A. Unlit: ' + unlit.join(', '));
});

test('nothing in the sheet takes a focus outline away again', () => {
  // DESIGN.md names exactly two permitted borders in a world that otherwise
  // forbids them, and the first is `outline` for `:focus-visible` -- "not
  // decoration, and never to be removed". A rule switching it back off is
  // therefore always a bug, however local it looks.
  const { css } = createStylesheet(FOCUS_MENU);
  const suppressors = css
    .split('\n')
    .filter((line) => line.includes(':focus-visible') && /outline:\s*none/.test(line));

  assert.deepEqual(suppressors, [],
    'A :focus-visible rule is setting outline:none. DESIGN.md: the focus '
    + 'outline is never to be removed.');
});

test('no page emits an <hr>', () => {
  // DESIGN.md states the one rule of this visual world -- "No borders, no
  // rules, no dividers. Anywhere." -- and names this element in it: the moment
  // a `border` or an `<hr>` appears to separate two things, the page becomes
  // an ordinary dark UI with orange accents.
  //
  // WHY THIS READS THE SOURCE INSTEAD OF RENDERING THE PAGES. Rendering only
  // proves the branches a fixture happens to reach, and these dividers sit in
  // conditional blocks -- an error banner, a notice, a deferred resolution --
  // that a happy-path fixture never enters. Reading the module text covers
  // every branch of every page in both files, and needs no fixture kept in
  // step with the views.
  //
  // A hidden `<hr>` still counts. `.rule { display: none }` makes it paint
  // nothing today, which is exactly what makes it dangerous: it is dead markup
  // that survives review because nothing looks wrong, until someone reads the
  // stale comment above the rule and switches the divider back on.
  const offenders = [];

  for (const name of ['views.mjs', 'views-auth.mjs']) {
    const source = fs.readFileSync(new URL(`../scripts/web/${name}`, import.meta.url), 'utf8');
    source.split('\n').forEach((line, i) => {
      if (/<hr[\s/>]/.test(line)) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
    });
  }

  assert.deepEqual(offenders, [],
    'DESIGN.md forbids rules and dividers anywhere, and hiding one in CSS is '
    + 'not removing it. Delete the markup, not just its paint:\n'
    + offenders.join('\n'));
});

// ---------------------------------------------------------------------------
// the landing page carries the same moving ground as the signed-in one
// ---------------------------------------------------------------------------

const PLACES_FIXTURE = [
  { id: 'ostsee-strand', label: 'Baltic beach', timeOfDay: 'afternoon' },
  { id: 'wohnzimmer-abend', label: 'Living room', timeOfDay: 'evening' },
];

test('the landing plays the place full-bleed instead of framing it in a panel', () => {
  const html = landingPage({ places: PLACES_FIXTURE, account: null });

  // ONE VIDEO, AND INERT IN THE MARKUP, exactly as on the signed-in page. The
  // checks that decide whether it should load at all live in the script.
  assert.equal((html.match(/<video/g) ?? []).length, 1, 'the landing should carry one video');
  const video = html.slice(html.indexOf('<video'), html.indexOf('>', html.indexOf('<video')) + 1);
  assert.ok(!/\ssrc=/.test(video) && !/\sautoplay/.test(video),
    'the landing video loads for everyone before any check has run');
  assert.ok(/\smuted/.test(video) && /\splaysinline/.test(video) && /\sloop/.test(video),
    'without muted+playsinline a mobile browser will not play it at all');

  // The full-bleed layers, keyed by the same pl- ids the stylesheet generates
  // rules for, so the landing and the signed-in page share one set.
  assert.ok(/class="bgs"/.test(html), 'the landing has no full-bleed ground');
  assert.ok(/class="bg bg--pl-ostsee-strand"/.test(html), 'the still fallback layer is missing');

  // AND THE 4:3 PANEL IS GONE. It framed the very picture that is now behind
  // the whole page; keeping both would show the same photograph twice at two
  // sizes and two crops on one screen.
  assert.ok(!/class="veils"/.test(html), 'the landing still frames the place in a 4:3 panel');
});

test('the landing list is a rail that snaps, and its menu is a plate', () => {
  const html = landingPage({ places: PLACES_FIXTURE, account: null });
  const css = createStylesheet({ places: PLACES_FIXTURE, outfits: [] }).css;

  // The options are still a LIST in the markup -- they are a set of choices and
  // a screen reader should meet them as one -- and a rail only in the styling.
  assert.ok(/<ul class="lrail">/.test(html), 'the place options are not a rail');
  assert.ok(/<li>.*lopt--pl-ostsee-strand/s.test(html), 'the rail dropped its list items');

  const rail = /\.lrail\s*\{([^}]*)\}/.exec(css);
  assert.ok(rail, 'no .lrail rule');
  assert.ok(/scroll-snap-type:\s*x mandatory/.test(rail[1]), 'the rail does not snap');
  assert.ok(/overflow-x:\s*auto/.test(rail[1]), 'the rail does not scroll');
  assert.ok(/\.lrail\s+li\s*\{[^}]*scroll-snap-align/.test(css), 'the items have no snap point');

  // The menu floats over a photograph, so it needs a ground of its own -- the
  // same argument, and the same measured value, as the signed-in page's panels.
  const menu = /\.lmenu\s*\{([^}]*)\}/.exec(css);
  assert.ok(menu, 'no .lmenu rule');
  assert.ok(/backdrop-filter:\s*blur/.test(menu[1]), 'the menu does not blur what is behind it');
  assert.ok(/background:\s*rgba\(/.test(menu[1]), 'the menu has no plate, so dim text sits on a photograph');
});


// ---------------------------------------------------------------------------
// the palette, MEASURED -- DESIGN.md § "The palette"
// ---------------------------------------------------------------------------

/** Relative luminance and contrast, per WCAG. Deliberately re-implemented here
 *  rather than imported from `static.mjs`: a test that borrows the module's own
 *  arithmetic cannot catch that arithmetic being wrong. */
function contrastOf(a, b) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = ([r, g, b2]) => {
    const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b2);
  };
  const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Read a token's literal value straight out of the served sheet, so this
 *  measures what ships rather than a copy of it kept in step by hand. */
function tokenValue(css, name) {
  const m = new RegExp(String.raw`${name}:\s*(#[0-9A-Fa-f]{6})`).exec(css);
  assert.ok(m, `${name} is not defined as a literal in the stylesheet`);
  return m[1];
}

test('every colour the identity ships clears its floor on the ground it sits on', () => {
  // DESIGN.md: "Measured, not asserted." The table in that file is the OUTPUT of
  // this calculation, so the two cannot drift: change a token and this recomputes
  // the ratio from the value that actually ships.
  //
  // WHY THE FLOORS DIFFER. 4.5:1 is the AA bar for body text. `--lift` is a
  // SURFACE and not text, so it is checked as a non-text contrast against the
  // ground it sits on -- it only has to be distinguishable, not readable.
  const { css } = createStylesheet(FOCUS_MENU);
  const paper = tokenValue(css, '--paper');
  const lift = tokenValue(css, '--lift');

  for (const name of ['--ink-strong', '--ink-soft', '--oxide', '--oxide-deep']) {
    const value = tokenValue(css, name);
    for (const [groundName, ground] of [['--paper', paper], ['--lift', lift]]) {
      const got = contrastOf(value, ground);
      assert.ok(got >= 4.5,
        `${name} (${value}) measures ${got.toFixed(2)}:1 on ${groundName} (${ground}), `
        + 'which is under the 4.5:1 floor for body text');
    }
  }

  // The one pairing a filled control depends on: the label sits ON the accent.
  const onAccent = contrastOf(paper, tokenValue(css, '--oxide'));
  assert.ok(onAccent >= 4.5,
    `--paper on --oxide measures ${onAccent.toFixed(2)}:1; the record button's label is unreadable`);
});

test('a ghost sits at its ground’s floor, and --ink is what has to survive it', () => {
  // THE ONE NUMBER THE MOVE TO PAPER BROKE. DESIGN.md fixed ghosts at .5 and
  // recorded 4.55:1 -- measured with bone on #070A11. On cream, --ink at .5 is
  // 3.11:1, a real AA failure on every unlit option in the product, and one that
  // fails silently because a ghost is SUPPOSED to look faint.
  //
  // This asserts the property rather than the number: whatever `--ghost` is set
  // to, --ink composited at that opacity over its own ground must still clear
  // the floor. Lowering the token to make something look better fails here.
  const { css } = createStylesheet(FOCUS_MENU);
  const grounds = [
    ['--paper', /:root\s*\{[\s\S]*?--ghost:\s*([\d.]+)/, '--ink-strong', '--paper'],
    ['the landing', /body\.is-landing\s*\{[\s\S]*?--ghost:\s*([\d.]+)/, '--l-bone', '--l-ground'],
  ];

  for (const [label, re, inkToken, groundToken] of grounds) {
    const m = re.exec(css);
    assert.ok(m, `${label} does not name a --ghost value`);
    const alpha = Number(m[1]);
    const ink = tokenValue(css, inkToken);
    const ground = tokenValue(css, groundToken);

    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const mixed = '#' + rgb(ink)
      .map((c, i) => Math.round(c * alpha + rgb(ground)[i] * (1 - alpha)).toString(16).padStart(2, '0'))
      .join('');
    const got = contrastOf(mixed, ground);

    assert.ok(got >= 4.5,
      `on ${label} a ghost at opacity ${alpha} puts ${inkToken} at ${got.toFixed(2)}:1 over `
      + `${groundToken}, under the 4.5:1 floor. DESIGN.md: a ghost sits at the floor and no lower.`);
  }
});

test('the cathode orange has left the chrome and kept the date stamp', () => {
  // DESIGN.md: "#FF8A1E measures 1.95-2.21:1 on every candidate light ground and
  // fails at every size. It is not deleted, it is relocated." So it may appear in
  // the landing's own world and nowhere else -- and crucially not in the
  // GENERATED per-catalog rules, which bake colours in at build time where no
  // token can re-point them.
  const { css } = createStylesheet(FOCUS_MENU);

  // Everything before the landing's section is the paper world.
  const landingAt = css.indexOf('the landing page: STRUCK');
  assert.ok(landingAt > 0, 'the landing section marker is gone from the sheet');
  const paperSide = css.slice(0, landingAt);

  // NO `g` FLAG. A global regex carries `lastIndex` between `.test()` calls, so
  // it would match every other offending line and silently pass on the rest.
  const cathode = /#FF8A1E|rgba\(\s*255\s*,\s*138\s*,\s*30\b|#FFB25C|rgba\(\s*255\s*,\s*178\s*,\s*92\b/i;
  const offenders = paperSide.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => cathode.test(l) && !/^\s*(\*|\/\*|\/\/)/.test(l) && !/--l-(cathode|hot):/.test(l));

  assert.deepEqual(offenders.map(([n, l]) => `${n}: ${l.trim()}`), [],
    'the cathode orange is still painting something on the paper pages');
});

/** The `.nav .who` block, from its selector to its closing brace. */
function navWhoRule(css) {
  const start = css.indexOf('.nav .who {');
  assert.notEqual(start, -1, 'the .nav .who rule has disappeared from the stylesheet');
  const end = css.indexOf('}', start);
  assert.notEqual(end, -1, 'the .nav .who rule is not closed');
  return css.slice(start, end + 1);
}

/**
 * THE SIGN-OUT CONTROL WENT OFF THE SCREEN, and the cause was an email address.
 *
 * `.nav` is a flex row -- email, credit ring, Plans, Sign out -- and a flex
 * item's default `min-width: auto` refuses to shrink below its content. The
 * email is the only item in that row whose width is chosen by the customer,
 * so a long address does not wrap or truncate: it widens the whole nav past
 * the viewport and pushes everything after it out of the frame.
 *
 * MEASURED IN A REAL BROWSER, on `/pricing`, signed in, document scrollWidth
 * minus clientWidth:
 *
 *   viewport   dev@example.com (15)   ...@gmail.com (33)   ...@gmail.com (40)
 *   320px               5px                  106px                155px
 *   375px               0px                   51px                100px
 *   414px               0px                   12px                 61px
 *
 * At 375px -- the commonest phone width, and one of the six this project tests
 * at -- an ordinary 33-character Gmail address put `Sign out` past the right
 * edge with nothing on screen to say it was there. Two of the six accounts in
 * this application's own store are over 32 characters.
 *
 * WHY A STRING CHECK AND NOT A LAYOUT CHECK. Same reasoning as the `.statehook`
 * block at the top of this file: `node --test` has no layout engine, and the
 * failure is a flexbox behaviour. What a string CAN hold is that the one item
 * in the row with customer-controlled width is allowed to shrink and told what
 * to do when it does. Without `min-width: 0` the ellipsis never fires, because
 * the box never gets smaller than its text.
 */
test('a long email truncates instead of pushing the nav off the screen', () => {
  const rule = navWhoRule(createStylesheet().css);

  assert.match(rule, /min-width:\s*0/,
    '.nav .who needs min-width:0 or the flex item will not shrink below its '
    + 'text, and a 33-character address pushes Sign out off a 375px screen');

  assert.match(rule, /text-overflow:\s*ellipsis/,
    '.nav .who needs text-overflow:ellipsis -- once it can shrink, the address '
    + 'must say it has been cut rather than simply stopping');

  assert.match(rule, /overflow:\s*hidden/,
    '.nav .who needs overflow:hidden, or text-overflow has nothing to clip');

  assert.match(rule, /white-space:\s*nowrap/,
    '.nav .who must stay on one line -- wrapping the address grows the nav '
    + 'downward through the wordmark instead of sideways off the screen');
});

/**
 * THE TEST ABOVE WENT GREEN WHILE THE PAGE WAS STILL BROKEN, and that is the
 * reason this second one exists rather than a third assertion in the first.
 *
 * min-width: 0 on .who is necessary and not sufficient. The nav is ITSELF a
 * flex item, inside .masthead, and it carries the same min-width: auto default
 * -- so with the fix on .who alone the nav is still handed its full content
 * width, .who is never squeezed, and the ellipsis never fires. Re-measured in
 * a real browser with only .who fixed: 44px of page overflow at 375px, sign-out
 * still off the frame. Unchanged. The chain gives way at every link or at none.
 *
 * So this asserts the OUTER link. A future edit that keeps the ellipsis and
 * drops this one restores the bug in full while leaving the first test green,
 * which is exactly what happened once already.
 */
test('the nav itself can shrink, or the ellipsis below it never fires', () => {
  const { css } = createStylesheet();

  const start = css.indexOf('.nav {');
  assert.notEqual(start, -1, 'the .nav rule has disappeared from the stylesheet');
  const rule = css.slice(start, css.indexOf('}', start) + 1);

  assert.match(rule, /min-width:\s*0/,
    '.nav needs min-width:0 as well as .nav .who -- it is a flex item in '
    + '.masthead and defaults to min-width:auto, so without this the nav takes '
    + 'its full content width and .who is never asked to give way');
});

test('the controls beside the email keep their full width', () => {
  // The email is the only thing in the nav that may shrink. Plans and Sign out
  // are controls and Sign out is the only way out of the account, so shrinking
  // THEM to fit a long address would trade a scrollbar for an unreadable
  // button. The ring already carries `flex: none` for the same reason.
  const { css } = createStylesheet();

  const navItems = css.slice(css.indexOf('.nav a, .nav button'));
  assert.match(navItems.slice(0, 400), /flex:\s*none/,
    '.nav a and .nav button must not shrink -- only .who gives way');
});

/**
 * TWO PRICES FOR ONE TAPE, ON ONE SCREEN, 25% APART.
 *
 * The estimated-cost line was already fixed for exactly this: it renders one
 * number per (resolution, shape) pair and CSS switches it, because the charge
 * at enqueue applies 4/3 for 16:9 and 9:16. The comment above `costLines` in
 * views.mjs still describes that fix -- "The page said ~21 CR and the ledger
 * took 28."
 *
 * The quality card five lines above it kept the un-shaped number. So with 9:16
 * chosen the page showed, in one viewport:
 *
 *   QUALITY   480p ~21 CR   720p ~46 CR   1080p ~103 CR
 *   ESTIMATED COST                              ~61 CR
 *
 * and the ledger took 28 for the 480p order -- measured, an account went
 * 153 -> 125 on a 16:9 480p tape while the card beside the button said 21.
 * Nobody is overcharged; the tier card simply advertises a price a third under
 * what the button will take, on the control being looked at while choosing.
 *
 * THE CARD'S PRICE SWITCHES ON THE SHAPE ALONE, not on the pair. Each card
 * already knows its own tier, so it needs one span per shape and one rule per
 * shape -- three rules rather than nine. The estimate keeps its pair-keyed
 * rules because it is a single line that must name both.
 */
test('a quality card quotes the shape that is actually selected', () => {
  const menu = {
    ...FOCUS_MENU,
    resolutions: [
      { id: '480p', width: 640, height: 480, available: true, credits: 21,
        creditsByAspect: { '4:3': 21, '16:9': 28, '9:16': 28 } },
      { id: '720p', width: 960, height: 720, available: true, credits: 46,
        creditsByAspect: { '4:3': 46, '16:9': 61, '9:16': 61 } },
    ],
  };
  const html = homePage({ ...menu, consentText: 'I agree' });

  // PRESENT FIRST, then absent. An empty match set satisfies every negative
  // assertion that follows, so the positive one has to establish that the
  // markup this test is about was rendered at all.
  const crSpans = [...html.matchAll(/<span class="cr cr--([a-z0-9-]+)">~(\d+) CR<\/span>/g)]
    .map((m) => `${m[1]}:${m[2]}`);
  assert.ok(crSpans.length > 0, 'the quality cards render no per-shape price at all');

  for (const want of ['a-4x3:21', 'a-16x9:28', 'a-9x16:28',
    'a-4x3:46', 'a-16x9:61', 'a-9x16:61']) {
    assert.ok(crSpans.includes(want),
      `the quality cards are missing ${want} -- every offered shape needs its own `
      + 'quote or the card shows the 4:3 price for a shape charged 4/3 of it');
  }

  // The un-shaped span is the bug. A card that still emits `class="cr"` alone
  // is quoting one number whatever the frame row says.
  assert.doesNotMatch(html, /<span class="cr">/,
    'a quality card still carries a single un-shaped price');
});

test('the quality card price is hidden until a shape is chosen for it', () => {
  const { css } = createStylesheet(FOCUS_MENU);

  const start = css.indexOf('.qualitycard .cr {');
  assert.notEqual(start, -1, 'the .qualitycard .cr rule has disappeared');
  const rule = css.slice(start, css.indexOf('}', start) + 1);
  assert.match(rule, /display:\s*none/,
    '.qualitycard .cr must default to display:none -- otherwise every shape\'s '
    + 'price is painted at once and the card lists three numbers');

  for (const slug of ['a-4x3', 'a-16x9', 'a-9x16']) {
    assert.ok(css.includes(`#${slug}:checked~.wrap .qualitycard .cr--${slug}{display:block;}`),
      `no rule reveals the quality card price for ${slug}`);
  }
});
