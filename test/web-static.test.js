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
import { creditMeter, homePage } from '../scripts/web/views.mjs';

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
