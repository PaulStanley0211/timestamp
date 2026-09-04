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
  creditMeter, homePage, landingPage, statusPage, selectPage, resultPage, videosPage, errorPage,
  privacyPage, termsPage, impressumPage,
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
    // Both states, because the empty one is what a new account meets and a
    // page missing from this list is invisible to every sweep below.
    ['videos', videosPage({
      account: { email: 'a@b.com' }, retentionDays: 30,
      tapes: [{
        jobId: '20260824-120000-abcdef', status: 'done', place: 'a beach', aspect: '4:3',
        posterUrl: '/api/jobs/20260824-120000-abcdef/poster',
        videoUrl: '/api/jobs/20260824-120000-abcdef/video',
        href: '/j/20260824-120000-abcdef/result',
      }],
    })],
    ['videos-empty', videosPage({ account: { email: 'a@b.com' }, retentionDays: 30, tapes: [] })],
    ['error', errorPage({ status: 404, title: 'Not found' })],
    ['auth-unavailable', authUnavailablePage()],
    ['identity-unavailable', identityUnavailablePage()],
    // Both entity states, because the placeholder page is the one that ships
    // first and a page missing from this list is invisible to every sweep.
    ['privacy', privacyPage({ entity: null, retention: { photoDays: 7, jobDays: 30 } })],
    ['terms', termsPage({ entity: null })],
    ['impressum', impressumPage({
      entity: { name: 'Example UG', addressLines: ['Musterstrasse 1', '12345 Berlin'], email: 'support@example.com', vatId: null },
    })],
  ];
}

test('no page sells this product as German -- only the two that state a legal fact', () => {
  // THE PRODUCT IS THE ERA AND THE MEDIUM, NOT THE COUNTRY. Paul restated this
  // on 2026-08-29 and again on 2026-08-31: "It's not about the country ...
  // people can make videos, like, in 2003 setup, like, in a camcorder."
  // Section 42F de-nationalised the eight place labels and the three prompts
  // that carried literal German words, and MISSED the one sentence a signed-in
  // customer reads first -- the lede said the tape came off a camcorder "in a
  // German suburb". A person in Manila or Lagos was being told, on the page
  // where they choose their own photograph, that the product is about somewhere
  // else.
  //
  // TWO PAGES ARE EXEMPT AND BOTH STATE A FACT RATHER THAN A FRAME. The
  // Impressum exists because the operator is resident in Germany -- that is the
  // whole reason a DDG notice is owed at all -- and the privacy page names the
  // country the servers are in, which is the data-residency claim the same
  // notice rests on. Removing either would not de-nationalise the product, it
  // would make a legal page untrue. Everything else fails here.
  const allowed = new Set(['privacy', 'impressum']);
  const offenders = [];

  for (const [name, html] of renderedPages()) {
    if (allowed.has(name)) continue;
    // Comments ship in the source and are the register these files are written
    // in, but they are reasoning for whoever edits them rather than a claim to
    // a reader -- and one of them measures a German buyer's VAT, which is a
    // measurement rather than a frame. Strip them; assert on what renders.
    const visible = html.replace(/<!--[\s\S]*?-->/g, '');
    const hit = visible.match(/German\w*/i);
    if (hit) {
      const from = Math.max(0, hit.index - 70);
      offenders.push(`${name}: ...${visible.slice(from, hit.index + 70)}...`);
    }
  }

  assert.deepEqual(offenders, [],
    `these pages tell a worldwide customer the product is German:\n${offenders.join('\n')}`);
});

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

test('no page promises the still-approval gate that direct mode deleted', () => {
  // THE LANDING PAGE SOLD A REFUND THAT DOES NOT EXIST. Its closing paragraph
  // read "You approve a still before any video is made, so a likeness you do
  // not recognise costs you nothing." That was true of the still path and
  // stopped being true when the web app went direct: `server.mjs` sets
  // `direct: PAID_PROVIDER_IDS.includes(provider)`, the still-count control is
  // gone from views.mjs entirely, and §18 records the trade in as many words --
  // the still WAS the cheap rejection gate at $0.04, and direct mode removed
  // it, so a likeness that misses now costs a whole tape.
  //
  // It is the §37 signup defect on the page that sells: a product claim the
  // copy kept making after the code stopped honouring it. This is the guard
  // that stops it coming back, and it sweeps EVERY page rather than the
  // landing, because the sentence is the kind of reassurance that gets pasted
  // onto a pricing or signup page next.
  //
  // The legitimate sentence is asserted PRESENT first, on purpose. A test that
  // only asserts an absence passes vacuously the day somebody deletes the whole
  // paragraph, or renames the page out of renderedPages() -- §35E, which this
  // repo has already been caught by once.
  const pages = renderedPages();
  const landing = pages.find(([name]) => name === 'landing');
  assert.ok(landing, 'the landing is missing from renderedPages(), so this sweep proves nothing');
  assert.ok(/run through a real tape chain/.test(landing[1]),
    'the landing no longer explains the tape chain -- this test is asserting an absence against the wrong page');

  // Any claim that the customer sees or approves something BEFORE the video is
  // billed. Kept to the shape of the promise rather than its exact wording, so
  // a paraphrase does not slip through.
  const PRE_APPROVAL = [
    /approve[sd]? a still/i,
    /approve[sd]? .{0,24}before any video/i,
    /costs you nothing/i,
    /choose from .{0,20}looks? before/i,
  ];
  for (const [name, html] of pages) {
    for (const claim of PRE_APPROVAL) {
      assert.ok(!claim.test(html),
        `${name} still promises a pre-approval gate (${claim}); the paid path is direct and approves nothing`);
    }
  }
});

test('the type scale is the only place a size is decided', () => {
  // THE SPACING SCALE'S ARGUMENT, APPLIED TO TYPE. Before 2026-08-31 the sheet
  // carried 71 hard-coded font sizes across 19 distinct values -- 9px, 10px,
  // 11px and 12px all doing the SAME uppercase-label job -- with no ratio and
  // no relationship between any two of them. §15 made exactly this case for
  // spacing and it is why the pages read as ordered; type never got the pass.
  //
  // This is the guard that stops it coming back one convenient literal at a
  // time, which is how the first 71 arrived.
  const { css } = createStylesheet(FOCUS_MENU);
  // The token block is where sizes ARE decided, so it is excluded by finding
  // where the declarations live rather than by matching their names.
  const rootEnd = css.indexOf('--d-4:');
  assert.ok(rootEnd > 0, 'the display ladder is missing from the token block');
  const rules = css.slice(rootEnd);

  const bare = [...rules.matchAll(/font-size:\s*([0-9.]+)(px|rem)/g)].map((m) => m[0]);
  assert.deepEqual(bare, [],
    `these rules set a size instead of naming one: ${bare.join(', ')}`);

  // Asserted PRESENT first so the check above cannot pass vacuously the day
  // somebody deletes every font-size in the sheet -- §35E.
  assert.ok(/font-size: var\(--t-2\)/.test(rules), 'nothing uses the body step');
  assert.ok(/font-size: var\(--t-label\)/.test(rules), 'nothing uses the label step');
});

test('a legal page is a document, with a document outline', () => {
  // /privacy shipped SEVEN section headings written as <p class="eyebrow"> --
  // 12px uppercase labels -- so its outline was one h1 across thirteen
  // paragraphs. On the longest prose in the product, whose entire job is to be
  // read and understood, that is an accessibility defect before it is a design
  // one: a screen reader got no structure for a privacy policy.
  //
  // The three page KICKERS that sit above each h1 stay <p class="eyebrow"> on
  // purpose. An h2 before the h1 is worse structure than none, which is a
  // mistake this guard would otherwise encourage.
  // The minimums differ because the PAGES differ, and flattening them to one
  // number would be the test inventing structure. /privacy and /terms are
  // multi-section documents. The Impressum is a short statutory notice with
  // exactly one section -- demanding a second would push somebody to split
  // § 5 DDG information that belongs together.
  const MIN_SECTIONS = { privacy: 3, terms: 3, impressum: 1 };
  const pages = renderedPages().filter(([name]) => name in MIN_SECTIONS);
  assert.equal(pages.length, 3, 'a legal page has fallen out of renderedPages()');
  for (const [name, html] of pages) {
    const h2s = (html.match(/<h2\b/g) || []).length;
    assert.ok(h2s >= MIN_SECTIONS[name],
      `${name} has ${h2s} section headings, wanted ${MIN_SECTIONS[name]}; its outline is not a document`);
    const firstH1 = html.indexOf('<h1');
    const firstH2 = html.indexOf('<h2');
    assert.ok(firstH1 >= 0, `${name} has no h1 at all`);
    assert.ok(firstH2 > firstH1, `${name} opens with an h2 before its h1`);

    // THE COUNT ABOVE IS A FLOOR AND A FLOOR IS A WEAK GUARD -- verified: with
    // only the counts, reverting ONE heading to <p class="eyebrow"> still
    // passed, because /privacy has four and needs three. This is the assertion
    // that actually holds the line, and it states the rule exactly: past the
    // h1, a section heading may not be written as a paragraph. It is also not
    // brittle to editing the copy, which an exact count would be.
    const afterH1 = html.slice(firstH1);
    const strays = (afterH1.match(/<p class="eyebrow">/g) || []).length;
    assert.equal(strays, 0,
      `${name} writes ${strays} section heading(s) after its h1 as <p class="eyebrow">; a heading that is not a heading leaves the document with no outline`);
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

/**
 * THE RESULT PAGE TOLD EVERY TAPE IT WAS 720x576.
 *
 * The caption under the player was assembled with the raster as a literal:
 *
 *   [ seconds, frames, '720x576 PAL' ]
 *
 * That is the 4:3 contract, and it is the base rather than an entry in the
 * `aspects` map, so it stayed correct-looking while two more shapes were added
 * around it. Measured on a real 16:9 render -- job 20260829-032416-884be4 --
 * the tape raster is 1024x576 and the delivered file is 1920x1080, and the page
 * showing that very file said 720x576 PAL underneath it.
 *
 * The raster comes off the job's OWN frozen `resolved` block rather than from
 * config read at render time. A manifest that froze a shape is the only thing
 * that can say what the file on disk actually is; re-deriving it from today's
 * config would answer for a job somebody might run now, not the one being
 * looked at.
 *
 * AND PAL IS KEPT ONLY WHERE IT IS PAL. 720x576 at SAR 16/15 is the format; the
 * wide shapes are square-pixel rasters that merely share its 25fps line rate.
 * Calling 1024x576 "PAL" would be a second wrong fact replacing the first.
 */
function metaLineOf(html) {
  const m = html.match(/<p class="meta">([^<]*)<\/p>/);
  assert.ok(m, 'the result page renders no meta line at all');
  return m[1];
}

test('the result page names the raster of the shape it is showing', () => {
  const base = {
    jobId: '20260829-032416-884be4',
    status: 'done',
    result: { durationSeconds: 15, frames: 375, videoUrl: '/v', posterUrl: '/p' },
    input: { place: 'ostsee-strand', outfit: 'hemd-jeans' },
  };

  const wide = resultPage({
    view: {
      ...base,
      input: { ...base.input, aspect: '16:9' },
      result: { ...base.result, tape: { width: 1024, height: 576 } },
    },
  });
  const wideMeta = metaLineOf(wide);
  assert.match(wideMeta, /1024x576/,
    'a 16:9 tape works at 1024x576 and the page must say so');
  assert.doesNotMatch(wideMeta, /720x576/,
    'the 4:3 raster is being reported for a 16:9 tape');
  assert.doesNotMatch(wideMeta, /PAL/,
    'PAL is 720x576 at SAR 16/15 -- a square-pixel 1024x576 raster is not it');

  const tall = resultPage({
    view: {
      ...base,
      input: { ...base.input, aspect: '9:16' },
      result: { ...base.result, tape: { width: 576, height: 1024 } },
    },
  });
  assert.match(metaLineOf(tall), /576x1024/, 'a 9:16 tape works at 576x1024');
});

test('the default shape keeps the words it has always had', () => {
  // 4:3 IS THE ONE SHAPE THAT IS ACTUALLY PAL, and the product's identity rests
  // on saying so. This fix must not cost the default path its wording.
  const html = resultPage({
    view: {
      jobId: '20260829-032416-884be4',
      status: 'done',
      result: { durationSeconds: 15, frames: 375, tape: { width: 720, height: 576 } },
      input: { place: 'ostsee-strand', aspect: '4:3' },
    },
  });
  assert.match(metaLineOf(html), /720x576 PAL/, 'the 4:3 caption is unchanged');
});

test('a job that froze no raster says nothing rather than guessing one', () => {
  // A manifest with no `resolved` block cannot say what shape it is, and the
  // honest answer to that is silence. Printing the 4:3 default would be the
  // original bug with a fallback in front of it.
  const html = resultPage({
    view: {
      jobId: '20260829-032416-884be4',
      status: 'done',
      result: { durationSeconds: 15, frames: 375 },
      input: { place: 'ostsee-strand' },
    },
  });
  const meta = metaLineOf(html);
  assert.match(meta, /375 frames/, 'the facts it does have still print');
  assert.doesNotMatch(meta, /\d+x\d+/, 'no raster is invented when none was frozen');
});

/**
 * THE PAGE THAT TAKES THE MONEY COUNTED TAPES AT ONE SHAPE'S PRICE.
 *
 * Every rung listed what its credits buy -- "4 tapes at 480p" for the $12
 * Starter -- computed from the un-shaped `credits` field, which is the 4:3
 * price. A non-default shape holds the short edge and is therefore exactly 4/3
 * the pixels, so it is charged 4/3: 28 CR at 480p against 21, and 61 at 720p
 * against 46. The same 92 credits buy THREE 480p tapes in 16:9 or 9:16, not
 * four, and the free rung's 21 credits buy one 4:3 tape and none at all in the
 * phone shape it is most likely to be wanted for.
 *
 * The bullet below those counts made the same claim outright: "15 seconds, 4:3,
 * PAL, 25 fps", on a product that has offered three shapes since the frame menu
 * opened.
 *
 * WHY A PARENTHETICAL AND NOT A RANGE. This page is public and has no frame
 * picker on it, so unlike the signed-in tape form it cannot switch a number to
 * match a selection -- there is nothing selected. "3-4 tapes" would be honest
 * and would also make the reader do arithmetic to find out which; naming the
 * default and then naming the exception states both numbers outright.
 */
test('a rung counts tapes in every shape it sells, not just the default', () => {
  const plans = [{ id: 'free', label: 'Free', monthlyUSD: 0, creditsPerPeriod: 21 }];
  const resolutions = [
    { id: '480p', credits: 21, available: true,
      creditsByAspect: { '4:3': 21, '16:9': 28, '9:16': 28 } },
    { id: '720p', credits: 46, available: true,
      creditsByAspect: { '4:3': 46, '16:9': 61, '9:16': 61 } },
  ];
  const packs = [{ id: 'starter', label: 'Starter', priceUSD: 12, credits: 92, buyable: true }];

  const html = pricingPage({ plans, resolutions, packs, currentPlan: null });

  // PRESENT FIRST: a page that rendered no rungs satisfies every absence below.
  assert.match(html, /4 tapes at 480p/, 'the default-shape count is gone entirely');

  assert.match(html, /4 tapes at 480p \(3 in 16:9 or 9:16\)/,
    '92 credits buy four 4:3 tapes and three wide ones -- the page must say both');
  assert.match(html, /2 tapes at 720p \(1 in 16:9 or 9:16\)/,
    'the 720p count needs the same treatment; 92 credits buy one wide 720p tape');
  assert.match(html, /1 tape at 480p \(none in 16:9 or 9:16\)/,
    'the free rung buys no wide tape at all, which is the number most worth saying');

  assert.ok(!html.includes('15 seconds, 4:3, PAL, 25 fps'),
    'the rung still claims 4:3 is the shape, on a product selling three');
});

test('a rung with no per-shape prices states the plain count and invents nothing', () => {
  // `resolutionRows` builds creditsByAspect by asking the same function that
  // charges, and skips a pair the pricing refuses. A row that came back without
  // the map at all -- an older seam, or auth unavailable -- must degrade to the
  // count it can defend rather than guessing a multiplier.
  const html = pricingPage({
    plans: [{ id: 'free', label: 'Free', monthlyUSD: 0, creditsPerPeriod: 21 }],
    resolutions: [{ id: '480p', credits: 21, available: true }],
    currentPlan: null,
  });

  assert.match(html, /1 tape at 480p/, 'the count it can defend still prints');
  assert.ok(!/\(\s*(?:none|\d+) in 16:9 or 9:16\s*\)/.test(html),
    'a shape price that was never supplied must not be inferred');
});

/**
 * THE PLANS PAGE FROM THE DESIGN PROTOTYPE (2026-09-04): two packs side by
 * side, the larger one lifted and marked, the free grant a sentence above them
 * rather than a third card. The fixtures below are the shipped ladder -- one
 * grant, two packs, two sizes -- so a rule that reads right against them reads
 * right in production.
 */
const LADDER = Object.freeze({
  plans: [{ id: 'free', label: 'Free', monthlyUSD: 0, creditsPerPeriod: 21 }],
  resolutions: [
    { id: '480p', credits: 21, available: true,
      creditsByAspect: { '4:3': 21, '16:9': 28, '9:16': 28 } },
    { id: '720p', credits: 46, available: true,
      creditsByAspect: { '4:3': 46, '16:9': 61, '9:16': 61 } },
  ],
  packs: [
    { id: 'starter', label: 'Starter', priceUSD: 12, credits: 92, buyable: true },
    { id: 'standard', label: 'Standard', priceUSD: 19, credits: 138, buyable: true },
  ],
  currentPlan: null,
});

test('the two packs stand side by side, and the larger one is lifted and recommended', () => {
  const html = pricingPage(LADDER);
  const { css } = createStylesheet({});

  const packs = html.match(/<section class="pack[^"]*"/g) ?? [];
  assert.equal(packs.length, 2, 'one card per pack and nothing else in the row');
  assert.equal(packs.filter((p) => p.includes('pack--recommended')).length, 1,
    'exactly one pack is the recommended one');

  // THE RECOMMENDATION IS THE LARGER PACK, read off its own card: the marked
  // section must be the one carrying the 138-credit count.
  const marked = html.slice(html.indexOf('pack--recommended'));
  const nextCard = marked.indexOf('<section class="pack', 1);
  const card = nextCard === -1 ? marked : marked.slice(0, nextCard);
  assert.match(card, /Standard/, 'the recommended card is the Standard pack');
  assert.match(card, /138 credits/, 'and it is the one with more credits');
  assert.match(card, /Recommended/, 'and it says so in words');

  // Two EQUAL columns. This is the one page DESIGN.md allows an equal grid on,
  // because two purchases that differ only in size are genuinely peers.
  assert.match(css, /\.packs\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    'the packs share one two-column grid');
  assert.match(css, /\.pack--recommended\s*\{[^}]*background:\s*var\(--lift\)/,
    'the recommended pack sits on the lifted plate');
});

test('the free grant opens the page as a sentence, not as a third card with no button', () => {
  const html = pricingPage(LADDER);

  assert.match(html, /Every account starts with 21 credits/, 'the grant is stated in words');
  assert.match(html, /1 tape at 480p \(none in 16:9 or 9:16\)/,
    'and it still says exactly what those credits buy, wide shapes included');
  assert.ok(!/class="panel plan/.test(html), 'no plan card renders for the grant');
  assert.ok(!/>FREE</.test(html), 'and no card prices it at FREE');
});

test('a pack states its price in the readout face with the credit count directly beneath it', () => {
  const html = pricingPage(LADDER);
  const { css } = createStylesheet({});

  assert.match(html, /<p class="price">\$12<\/p>\s*<p class="pack-credits">92 credits<\/p>/,
    'the price and its credit count are adjacent, price first');
  assert.match(html, /<p class="price">\$19<\/p>\s*<p class="pack-credits">138 credits<\/p>/);
  assert.match(css, /\.pack \.price\s*\{[^}]*font-family:\s*var\(--osd\)/, 'the price is set in the readout face');
  assert.match(css, /\.pack \.price\s*\{[^}]*font-size:\s*var\(--t-8\)/, 'at the top of the type scale');
  assert.match(css, /\.pack \.pack-credits\s*\{[^}]*font-family:\s*var\(--osd\)/,
    'the count is a readout too, so the two read as one figure');

  // TAX SITS BESIDE EACH BUTTON, where the decision is made, not only in the
  // intro; a buyer reading one card should not have to scroll up for it.
  const cards = html.split('<section class="pack').slice(1);
  for (const card of cards) assert.match(card, /Tax is added at checkout\./, 'each pack says tax is added');
});

test('the signup page does not promise a recurring free allowance, because there is none', () => {
  // views-auth.mjs said "A free credit allowance every month" while the grant
  // is once-ever: reserveFreeTape runs inside createAccount and nothing in the
  // codebase reads grant.periodDays or grants on a period. The sentence a
  // prospective customer reads while deciding to sign up set an expectation
  // ("this renews") the product never meets -- and there was no support
  // channel to ask why the balance did not refresh.
  const html = signupPage({ consentText: 'I am in this photo.' });

  // PRESENT FIRST: the sentence about the free allowance must still exist, or
  // the absences below pass against a page that dropped the subject entirely.
  assert.match(html, /free credit allowance/i,
    'the signup page no longer mentions the free allowance at all');
  assert.match(html, /granted once/i,
    'the copy must say the grant happens once -- that is the true cadence');

  assert.ok(!/every month|per month|each month|monthly/i.test(html),
    'the signup page claims the free allowance recurs, and it never does');
});

test('no page ships its own design rationale to the browser', () => {
  // WHY THIS IS A TEST AND NOT A TIDY-UP. These files are written in a register
  // that argues with itself -- the reasoning beside a rule is what stops the
  // rule being undone by somebody who cannot see why it exists. That register
  // is right, and it belongs in a JS comment, which the reader of the SOURCE
  // sees and the browser never receives. An HTML comment inside the template
  // literal is the same words shipped to every visitor.
  //
  // Measured on the live landing page 2026-09-01: 5,060 of 26,166 bytes,
  // 19.3%, in seven comments -- and one of them quoted, verbatim, a promise
  // the product DELETED ("You approve a still before any video is made, so a
  // likeness you do not recognise costs you nothing"). Anyone who opened View
  // Source read a guarantee this product does not make. That is the real cost:
  // not the bytes, a stale claim published where nobody was looking.
  //
  // THE RULE IS ZERO, NOT A BUDGET. A percentage ceiling invites the next
  // author to spend up to it, and there is no such thing as an HTML comment
  // this product needs -- every one of them is a note to its own maintainer.
  const offenders = [];

  for (const [name, html] of renderedPages()) {
    const comments = html.match(/<!--[\s\S]*?-->/g) || [];
    if (!comments.length) continue;
    const bytes = comments.reduce((n, c) => n + Buffer.byteLength(c), 0);
    const pct = ((100 * bytes) / Buffer.byteLength(html)).toFixed(1);
    offenders.push(
      `${name}: ${comments.length} comment(s), ${bytes} bytes (${pct}% of the page)` +
      `\n    first: ${comments[0].replace(/\s+/g, ' ').slice(0, 90)}...`,
    );
  }

  assert.deepEqual(offenders, [],
    'these pages send design rationale to the browser -- move it out of the ' +
    `template literal into a JS comment, where the source keeps it and the wire does not:\n${offenders.join('\n')}`);
});

test('the finished tape carries a label, the way a cassette does', () => {
  // THE SIGNATURE MOMENT OF THE PAYOFF PAGE. What a customer waited and paid
  // for is an object, and the object this product imitates has a label on it
  // saying where and when. Place, outfit and date were previously spread over
  // an eyebrow, an <h1> and a two-row Where/Wearing table; one label carries
  // all of it and is the thing the picture sits on.
  const html = resultPage({
    view: {
      jobId: '20260901-143022-8f2a1c',
      status: 'done',
      result: { durationSeconds: 15, frames: 375, tape: { width: 720, height: 576 } },
      input: { place: 'schrebergarten-august', outfit: 'trainingsjacke', aspect: '4:3' },
    },
    labels: { place: 'The garden, in summer', outfit: 'Tracksuit jacket' },
  });

  const label = html.match(/<p class="label">([\s\S]*?)<\/p>/);
  assert.ok(label, 'the result page renders no tape label');
  const text = label[1];

  assert.match(text, /The garden, in summer/, 'the label must name the place');
  assert.match(text, /Tracksuit jacket/, 'the label must name the outfit');
  assert.match(text, /01\.09\.2026/, 'the label must carry the date, which is the product');

  // THE HUMAN LABELS, NOT THE PRESET IDS. `labels` exists precisely so a
  // customer never meets `schrebergarten-august`, and the label is the most
  // read thing on the page -- so it is the worst place to leak an id.
  assert.doesNotMatch(text, /schrebergarten|trainingsjacke/,
    'the label is showing preset ids to a customer');
});

test('the download comes before the legal line, not after it', () => {
  // IT IS THE REASON THE PAGE EXISTS. It used to sit last, beneath the Art. 50
  // sentence -- so the final thing on the payoff page was a disclaimer rather
  // than the tape. Order is the whole assertion here; both elements existed
  // before and still do.
  const html = resultPage({
    view: {
      jobId: '20260901-143022-8f2a1c',
      status: 'done',
      result: { durationSeconds: 15, frames: 375, tape: { width: 720, height: 576 } },
      input: { place: 'ostsee-strand', aspect: '4:3' },
    },
  });

  const download = html.indexOf('download="timestamp-');
  const fine = html.indexOf('Made with AI');

  assert.ok(download > -1, 'the download link is gone entirely');
  assert.ok(fine > -1, 'the Art. 50 disclosure is gone entirely -- it is not optional');
  assert.ok(download < fine,
    'the download must precede the disclosure; the page ends on a disclaimer instead of the tape');
});

test('the payoff page does not caption the tape with a heading', () => {
  // "Here it is" announced something already on the screen. A caption for a
  // visible picture is the clearest kind of filler, and deleting it lets the
  // picture open the page -- which is what the picture is for. The label two
  // elements down now carries the naming this heading was doing badly.
  const html = resultPage({
    view: {
      jobId: '20260901-143022-8f2a1c',
      status: 'done',
      result: { durationSeconds: 15, frames: 375, tape: { width: 720, height: 576 } },
      input: { place: 'ostsee-strand', aspect: '4:3' },
    },
  });

  // PRESENT FIRST, so this cannot pass against a page that lost its player.
  assert.match(html, /<video/, 'the result page renders no player at all');
  assert.ok(!/Here it is/.test(html), 'the tape is still being captioned by a heading');
});

/**
 * THE RESULT PAGE FROM THE DESIGN PROTOTYPE (2026-09-04): the tape and its
 * label in one column, the words about it in the other -- the place as the
 * heading, a sentence saying the file is theirs and how long the copy stays,
 * the download, then the file's own facts under a label -- and the rest of
 * the shelf beneath, when there is one.
 */
const FINISHED = Object.freeze({
  jobId: '20260901-143022-8f2a1c',
  status: 'done',
  result: { durationSeconds: 15, frames: 375, tape: { width: 720, height: 576 } },
  input: { place: 'schrebergarten-august', outfit: 'trainingsjacke', aspect: '4:3' },
});
const FINISHED_LABELS = Object.freeze({ place: 'The garden, in summer', outfit: 'Tracksuit jacket' });

test('the result page is the tape beside the words about it', () => {
  const html = resultPage({ view: FINISHED, labels: FINISHED_LABELS, retentionDays: 30 });
  const { css } = createStylesheet({});

  assert.match(html,
    /<div class="result-grid">\s*<div class="result-tape">[\s\S]*?<video[\s\S]*?<p class="label">[\s\S]*?<\/div>\s*<div class="result-words">/,
    'the tape column comes first and holds the player and the label');
  assert.match(html,
    /<div class="result-words">[\s\S]*?<p class="stamp">[\s\S]*?<h1 class="headline">The garden, in summer<\/h1>/,
    'the words column names the place as its heading');
  assert.match(css, /\.result-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*20rem\)\s*minmax\(0,\s*1fr\)/,
    'the two columns are the tape at 20rem and the words taking the rest');
});

test('the words say the file is theirs, and how long the copy stays', () => {
  const html = resultPage({ view: FINISHED, labels: FINISHED_LABELS, retentionDays: 30 });
  assert.match(html, /The file is yours to download and keep; this copy stays on the shelf for 30 days\./,
    'the retention window is read in, not asserted');

  // A page that was not told the window promises nothing about it.
  const unknown = resultPage({ view: FINISHED, labels: FINISHED_LABELS });
  assert.match(unknown, /The file is yours to download and keep\./);
  assert.ok(!/stays on the shelf for/.test(unknown), 'a window was invented');
});

test('the spec line is labelled as the file, and there is no share link this product does not have', () => {
  const html = resultPage({ view: FINISHED, labels: FINISHED_LABELS });
  assert.match(html, /<p class="eyebrow eyebrow--osd">The file<\/p>\s*<p class="meta">/,
    'the file facts sit under their own label');
  // The prototype offers "Copy a link" to a public tape URL. No such route
  // exists -- a tape is somebody's face behind their session -- so the page
  // must not offer it.
  assert.ok(!/Copy a link/.test(html), 'the page offers a share link that goes nowhere');
});

test('earlier tapes show under the result, and only when there are any', () => {
  const tapes = [{
    jobId: '20260814-101010-aaaaaa', status: 'done', place: 'The car park, at dusk',
    posterUrl: '/api/jobs/20260814-101010-aaaaaa/poster', href: '/j/20260814-101010-aaaaaa/result', aspect: '4:3',
  }];
  const withEarlier = resultPage({ view: FINISHED, labels: FINISHED_LABELS, tapes });
  assert.match(withEarlier, /Earlier tapes/, 'the shelf below is not labelled');
  assert.match(withEarlier, /class="shelf"/, 'the earlier tapes are not the shelf grid');
  assert.match(withEarlier, /The car park, at dusk/, 'the earlier tape is not on it');

  const alone = resultPage({ view: FINISHED, labels: FINISHED_LABELS });
  assert.ok(!/Earlier tapes/.test(alone), 'an empty shelf still gets a heading');

  // THE TAPE ON SCREEN IS NEVER LISTED UNDER ITSELF, whatever the page was
  // handed. The server filters it too; this is the page's own refusal.
  const self = { ...tapes[0], jobId: FINISHED.jobId, place: 'The garden, in summer', href: `/j/${FINISHED.jobId}/result` };
  const handedItself = resultPage({ view: FINISHED, labels: FINISHED_LABELS, tapes: [self] });
  assert.ok(!/Earlier tapes/.test(handedItself), 'the tape on screen is listed as an earlier tape');
});

test('nothing in the soft tier is also ghosted', () => {
  // SECTION 31 SOLVED THE GHOST FLOOR FOR `--ink` AND FOR NOTHING ELSE. 0.63 is
  // the least opacity at which `--ink` still clears 4.5:1 over `--paper`, and
  // it lands on 4.55:1. The soft tier starts at 4.85:1 with no opacity on it at
  // all, so multiplying it by the floor drops it straight through: measured,
  // `--faint` at `--ghost` over paper is 2.45:1, which is a real AA failure on
  // body text.
  //
  // IT FAILS QUIETLY, WHICH IS WHY IT NEEDS A TEST. A ghost is supposed to look
  // faint, so nothing looks wrong -- and this exact combination shipped in the
  // result page's spec line and survived a full 2021-test run before a contrast
  // calculation caught it. Section 31 states the rule in words ("hierarchy
  // inside a card is carried by SIZE, which survives being multiplied by an
  // opacity, and not by colour, which does not"); this is the rule with teeth.
  const sheet = createStylesheet({});
  const css = typeof sheet === 'string' ? sheet : sheet.css;

  const rules = css.match(/[^{}]+\{[^{}]*\}/g) || [];
  const offenders = rules
    .filter((r) => /opacity:\s*var\(--ghost\)/.test(r))
    .filter((r) => /color:\s*var\((--faint|--ink-soft|--l-dim)\)/.test(r))
    .map((r) => r.replace(/\s+/g, ' ').trim().slice(0, 120));

  assert.deepEqual(offenders, [],
    'these rules ghost text that is already in the soft tier -- the floor was ' +
    'solved for --ink alone, and the product is about 2.45:1. Demote by size ' +
    `or position instead:\n${offenders.join('\n')}`);
});

/** A status view mid-render, with the eleven real pipeline steps. */
function elevenStepView(current = 'animate') {
  const names = ['intake', 'moderate', 'expand', 'compose', 'still', 'select',
    'animate', 'assemble', 'tape', 'verify', 'publish'];
  const at = names.indexOf(current);
  return {
    jobId: '20260901-143022-8f2a1c',
    status: 'running',
    step: current,
    pct: 50,
    steps: names.map((name, i) => ({
      name,
      status: i < at ? 'done' : i === at ? 'running' : 'pending',
      attempts: 1, startedAt: null, endedAt: null, error: null,
    })),
    cost: { estimated: 2.08, actual: null, currency: 'USD' },
    result: {},
    error: null,
    input: { place: 'schrebergarten-august', outfit: 'trainingsjacke' },
  };
}

test('the wait is three phases, not eleven pipeline steps', () => {
  // A CUSTOMER IS NOT WATCHING A BUILD. Eleven rows naming `compose` and
  // `moderate` is a build log, and a build log makes a wait feel longer than it
  // is -- this page is the minute-plus somebody sits through after paying. The
  // eleven are the engine's own vocabulary and they stay in the detail list;
  // what leads is the three things actually happening.
  const html = statusPage({ view: elevenStepView() });

  const rows = html.match(/<li class="phase[^"]*"/g) || [];
  assert.equal(rows.length, 3,
    `the phase list has ${rows.length} rows -- it must show phases, not steps`);

  assert.match(html, /of 3/, 'the counter must count phases');
});

/**
 * THE STATUS PAGE FROM THE DESIGN PROTOTYPE (2026-09-04). The heading names
 * the place and what is happening to it; the three phases are a list that
 * says where each one stands, with the record light on the one being filmed;
 * the order sits beneath as where / wearing / frame.
 */
test('the headline names the place and what is happening to it', () => {
  const labels = { place: 'The balcony', outfit: 'Cotton summer dress' };
  const running = statusPage({ view: elevenStepView(), labels });
  assert.match(running,
    /<h1 class="headline" id="headline"><span class="where">The balcony<\/span>, <span id="headstate">being filmed<\/span><\/h1>/,
    'while the job runs the heading is the place, being filmed');

  const failed = statusPage({ view: { ...elevenStepView(), status: 'failed' }, labels });
  assert.match(failed, /<span id="headstate">stopped<\/span>/, 'a stopped job says so in the heading');

  // The phase title moved off the heading and into the list: a heading that
  // reads "Filming" is a build-log line, not the name of somebody's tape.
  assert.ok(!/<h1[^>]*>\s*Filming\s*</.test(running), 'the heading is still the phase title');
});

test('each phase says where it stands: done, recording, or not yet', () => {
  const html = statusPage({ view: elevenStepView('animate') });
  const rows = html.match(/<li class="phase[^"]*"[\s\S]*?<\/li>/g) || [];
  assert.equal(rows.length, 3, 'three phase rows');

  assert.match(rows[0], /class="phase phase-done"/, 'the first phase is done');
  assert.match(rows[0], /Done/, 'and says so');
  assert.match(rows[1], /class="phase phase-running"/, 'the second phase is the one running');
  assert.match(rows[1], /class="phase-state reclight"/, 'the record light sits on the running phase');
  assert.match(rows[1], />REC</, 'and reads REC');
  assert.match(rows[2], /class="phase phase-pending"/, 'the third phase is still to come');
  assert.match(rows[2], /Not yet/, 'and says so');

  // The title and note live in the row now, and the rows are numbered.
  assert.match(rows[1], /Filming/, 'the phase title is in its row');
  assert.match(rows[1], /where the minutes go/, 'and so is its note');
  assert.match(rows[0], />01</, 'rows are numbered');
  assert.match(rows[2], />03</, 'rows are numbered');

  // A STOPPED JOB DOES NOT RECORD. The phase it died in says so, and there is
  // no record light anywhere on the page.
  const failed = statusPage({ view: { ...elevenStepView('animate'), status: 'failed' } });
  const frows = failed.match(/<li class="phase[^"]*"[\s\S]*?<\/li>/g) || [];
  assert.match(frows[1], /class="phase phase-stopped"/, 'the phase the job died in is marked stopped');
  assert.match(frows[1], /Stopped/, 'and says so');
  // The poller's source names the class it will paint, so the check is on the
  // markup and not on the script.
  const markup = failed.replace(/<script>[\s\S]*?<\/script>/, '');
  assert.ok(!/reclight/.test(markup), 'a record light is still on a stopped job');
});

test('the order is listed under the phases: where, wearing, frame', () => {
  const base = elevenStepView();
  const view = { ...base, input: { ...base.input, aspect: '9:16', resolution: '480p' } };
  const html = statusPage({ view, labels: { place: 'The balcony', outfit: 'Cotton summer dress' } });

  const dl = html.match(/<dl class="inputs">([\s\S]*?)<\/dl>/);
  assert.ok(dl, 'the order is not a definition list');
  assert.match(dl[1], /<dt>Where<\/dt>\s*<dd>The balcony<\/dd>/, 'where');
  assert.match(dl[1], /<dt>Wearing<\/dt>\s*<dd>Cotton summer dress<\/dd>/, 'wearing');
  assert.match(dl[1], /<dt>Frame<\/dt>\s*<dd>9:16, 480p<\/dd>/, 'the frame is the shape and the size');

  // A job that froze no shape gets no Frame row rather than a guessed one.
  const bare = statusPage({ view: base, labels: { place: 'The balcony', outfit: 'x' } });
  assert.ok(!/<dt>Frame<\/dt>/.test(bare), 'a frame row was invented for a job with no shape');
});

test('the poller repaints the phase rows and the heading, not a bar that is gone', () => {
  const html = statusPage({ view: elevenStepView() });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  assert.match(script, /getElementById\('headstate'\)/, 'the poller never repaints the heading state');
  assert.match(script, /querySelectorAll\('#phases \.phase'\)/, 'the poller never repaints the phase rows');
  assert.ok(!/#bar \.seg/.test(script), 'the poller still paints the deleted bar');
});

test('every pipeline step is still reachable, one line away', () => {
  // HIDDEN, NOT DELETED. The detail genuinely reassures some people, and a
  // product that renders somebody's face should not be coy about what it is
  // doing to it. The eleven move behind a disclosure -- native <details>, so no
  // script and no fourth inline hash.
  const html = statusPage({ view: elevenStepView() });

  assert.match(html, /<details/, 'the step detail must exist behind a disclosure');
  for (const name of ['intake', 'moderate', 'expand', 'compose', 'still',
    'select', 'animate', 'assemble', 'tape', 'verify', 'publish']) {
    assert.match(html, new RegExp(`step-name-${name}|>${name}<|"${name}"`),
      `step ${name} vanished from the page entirely`);
  }
});

test('the record light is on the page it is for', () => {
  // `--rec` HAS EXISTED AS A TOKEN SINCE THE MARK LANDED and appears nowhere
  // but the chrome. A blinking REC beside the phase is the single most
  // characteristic thing a camcorder does, it costs one element, and this is
  // the one screen in the product that is literally a recording in progress.
  // IT SITS ON THE PHASE BEING FILMED (2026-09-04) rather than beside the
  // stamp: the light belongs to the thing that is recording.
  const running = statusPage({ view: elevenStepView() });
  assert.match(running, /class="phase-state reclight"/, 'the status page carries no record light');

  // AND IT MUST NOT BLINK OVER A FINISHED OR FAILED JOB. A record light on a
  // job that stopped is a lie about what the machine is doing.
  const failed = statusPage({ view: { ...elevenStepView(), status: 'failed' } });
  assert.ok(!/class="phase-state reclight"/.test(failed),
    'the record light is still blinking on a job that is not running');
});

test('the page says the tape survives a closed tab', () => {
  // THE MOST USEFUL SENTENCE ON A PAGE NOBODY WANTS TO SIT ON. The job is a
  // queue entry and a worker claims it; closing the browser changes nothing.
  // The page never said so, so the honest reading of it was "stay here".
  const html = statusPage({ view: elevenStepView() });
  assert.match(html, /close this page|leave this page|come back/i,
    'the page never tells anybody they are allowed to leave');
});

test('the photo you chose is shown back to you, and can be taken away again', () => {
  // YOU CANNOT SEE WHAT YOU ARE ABOUT TO SPEND 21 CREDITS ON. Step 1 named the
  // file and showed nothing, so a wrong photo -- the one before the one you
  // meant, a screenshot, somebody else -- was invisible until the tape came
  // back. And there was no way to change it: a file input keeps its selection,
  // so the only escape was reloading the page.
  const html = homePage({ ...FOCUS_MENU, consentText: 'I agree' });

  assert.match(html, /id="photo-thumb"/, 'no preview element for the chosen photo');
  assert.match(html, /id="photo-clear"/, 'no way to remove a photo once chosen');
});

test('the remove control is not inside the label, or it would reopen the picker', () => {
  // THE TRAP THIS EXISTS TO PIN. The dropzone is a <label for="photo">, and a
  // click anywhere inside a label activates its control -- so a Remove button
  // placed in there opens the file dialog instead of clearing the file, which
  // is the exact opposite of what it says. It reads as broken and it cannot be
  // seen in any markup assertion that only checks the button exists.
  const html = homePage({ ...FOCUS_MENU, consentText: 'I agree' });

  const label = html.match(/<label class="drop"[\s\S]*?<\/label>/);
  assert.ok(label, 'the dropzone label has gone');
  assert.ok(!/id="photo-clear"/.test(label[0]),
    'the remove button sits inside the dropzone label, so clicking it opens the file picker');
  assert.ok(!/id="photo-thumb"/.test(label[0]),
    'the preview sits inside the label, so clicking the photo reopens the picker');
});

test('the preview is hidden until there is something to preview', () => {
  // AND IT MUST BE HIDDEN BY AN ATTRIBUTE THE STYLESHEET RESPECTS. A container
  // given `display: flex` beats a bare `hidden` attribute, which is how an
  // empty box with a broken-image icon ships.
  const html = homePage({ ...FOCUS_MENU, consentText: 'I agree' });
  const picked = html.match(/<[^>]*id="picked"[^>]*>/);
  assert.ok(picked, 'no container for the chosen photo');
  assert.match(picked[0], /\shidden(\s|>)/, 'the preview container is not hidden on first render');

  const css = createStylesheet({});
  const sheet = typeof css === 'string' ? css : css.css;
  assert.match(sheet, /\.picked\[hidden\]\s*\{[^}]*display:\s*none/,
    'the stylesheet does not honour [hidden] on the preview, so display:flex will beat it');
});

test('the photo preview does not borrow a class that positions itself elsewhere', () => {
  // THIS EXACT BUG SHIPPED TWICE IN ONE DAY, both times invisible to every
  // markup assertion in this file.
  //
  //   .rec       was already the blinking dot inside the wordmark SVG, so the
  //              status page's record light and the brand mark styled each other.
  //   .thumb     is the place card's photograph layer -- `position: absolute;
  //              inset: 0` at ghost opacity -- so the upload preview escaped its
  //              row and painted over the STEP 01 heading, at half strength,
  //              while every test here passed.
  //
  // A class name is a global. Reusing one is not a naming preference, it is
  // inheriting somebody else's geometry. This pins the preview's own classes to
  // the preview: each must appear in the stylesheet ONLY inside a .picked-scoped
  // selector, so a later author cannot quietly rename it onto a shared one.
  const sheet = createStylesheet({});
  const css = typeof sheet === 'string' ? sheet : sheet.css;
  const html = homePage({ ...FOCUS_MENU, consentText: 'I agree' });

  const container = html.match(/<div class="picked"[\s\S]*?<\/div>/);
  assert.ok(container, 'the preview container has gone');

  const classes = [...container[0].matchAll(/class="([^"]+)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter((c) => c && c !== 'picked' && c !== 'quiet');
  assert.ok(classes.length, 'the preview declares no classes of its own to check');

  const offenders = [];
  for (const c of classes) {
    // Every rule whose selector mentions this class.
    const rules = (css.match(new RegExp(`(^|\\})([^{}]*\\.${c}\\b[^{}]*)\\{`, 'gm')) || [])
      .map((r) => r.replace(/^\}/, '').replace(/\{$/, '').trim());
    const unscoped = rules.filter((sel) => !sel.includes('.picked'));
    if (unscoped.length) offenders.push(`.${c} is also styled by: ${unscoped.join(' | ')}`);
  }

  assert.deepEqual(offenders, [],
    'the upload preview reuses a class that other components style -- it will '
    + `inherit their geometry, which is how .thumb put the preview over STEP 01:\n${offenders.join('\n')}`);
});
