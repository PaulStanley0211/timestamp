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

import {
  createStylesheet, SCRIM_INK, SCRIM_ACCENT_INK, SCRIM_PAINT, scrimBackground, scrimCover, SCRIM_COVER_MIN, scrimOpacity,
} from '../scripts/web/static.mjs';
import {
  creditMeter, homePage, landingPage, statusPage, selectPage, resultPage, videosPage, errorPage,
  privacyPage, termsPage, impressumPage, faq, siteFooter, balanceSentence,
} from '../scripts/web/views.mjs';
import {
  loginPage, signupPage, pricingPage, authUnavailablePage, verifyPage, identityUnavailablePage,
  resetPage, resetCompletePage, onboardingPage, accountPage,
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
  // The ids are real ones, because `homePage` resolves the default outfit by
  // id -- a fake menu of invented ids would exercise only the fallback and
  // never the path every visitor actually gets.
  outfits: [
    { id: 'tshirt-jeans', label: 'T-shirt and jeans', wardrobe: 'a plain cotton t-shirt and jeans' },
    { id: 'trainingsjacke', label: 'Tracksuit', wardrobe: 'a zipped track top, collar up' },
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

test('the speckle sits on lime panels only, the paper on fact cards only, and the ground carries neither', () => {
  // DESIGN.md: the dark ground and every dark card stay flat. The two textures
  // are SVG filters emitted once per page and applied from the sheet by id,
  // so "where is a texture applied" is a question the sheet can answer.
  const { css } = createStylesheet(FOCUS_MENU);
  // Comments are stripped first: a rule's text otherwise begins with whatever
  // comment preceded it, and the selector check below anchors on the start.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = bare.match(/[^{}]+\{[^{}]*\}/g) ?? [];
  const uses = rules.filter((r) => /url\(#/.test(r)).map((r) => r.replace(/\s+/g, ' ').trim());
  assert.ok(uses.some((r) => /url\(#speckle\)/.test(r)), 'the speckle is not applied anywhere');
  assert.ok(uses.some((r) => /url\(#paper\)/.test(r)), 'the paper is not applied anywhere');
  for (const r of uses) {
    assert.match(r, /^(\.lime::before|\.fact::before) \{/,
      `a texture is applied off its one permitted surface: ${r.slice(0, 100)}`);
  }
  assert.ok(uses.filter((r) => /url\(#speckle\)/.test(r)).every((r) => r.startsWith('.lime::before')), 'the speckle strayed');
  assert.ok(uses.filter((r) => /url\(#paper\)/.test(r)).every((r) => r.startsWith('.fact::before')), 'the paper strayed');

  for (const [name, html] of renderedPages()) {
    assert.ok(!/class="[^"]*\bgauze\b/.test(html), `${name} still renders the anode gauze`);
    assert.ok(!/class="[^"]*\bgrain\b/.test(html), `${name} still renders the grain plate`);
    // The defs ride once per page, whether or not the page has a lime panel:
    // a page that emits them twice has two ids and the second is ignored, a
    // page that emits none has textureless lime the day it grows a panel.
    assert.equal((html.match(/<filter id="speckle"/g) ?? []).length, 1, `${name} carries the speckle filter ${(html.match(/<filter id="speckle"/g) ?? []).length} times`);
    assert.equal((html.match(/<filter id="paper"/g) ?? []).length, 1, `${name} carries the paper filter the wrong number of times`);
  }
});

test('the FAQ is native details rows, no script, one row per question', () => {
  const html = faq([{ q: 'Is it free?', a: 'Yes <to start>.' }, { q: 'Two', a: 'B' }]);
  assert.equal((html.match(/<details class="faq-row">/g) ?? []).length, 2);
  assert.equal((html.match(/<summary>/g) ?? []).length, 2);
  assert.match(html, /Yes &lt;to start&gt;\./, 'answers are escaped like every other string');
  assert.ok(!/<script/.test(html), 'the FAQ needs no script');
  const { css } = createStylesheet({});
  assert.match(css, /\.faq-row\s*\{[^}]*border:\s*1px solid var\(--line\)/, 'a row is outlined from the token');
  assert.match(css, /details\[open\]\s*>\s*summary \.faq-glyph::before\s*\{[^}]*content/, 'the plus does not turn to a minus on open');
});

test('the footer is two link columns, the giant word once, and the legal links every page has always had', () => {
  const out = siteFooter({ account: null });
  const inn = siteFooter({ account: { email: 'a@b.com' } });
  for (const href of ['/privacy', '/terms', '/impressum', '/pricing', '/#places', 'mailto:support@timestamptapes.com']) {
    assert.match(out, new RegExp(`href="${href.replace(/[.#?]/g, '\\$&')}"`), `the footer lost ${href}`);
  }
  assert.match(out, /href="\/signup">Make a tape</, 'signed out, Make a tape leads to signup');
  assert.match(inn, /href="\/">Make a tape</, 'signed in, Make a tape leads to the order form');
  assert.doesNotMatch(out, /href="\/videos"/, 'a stranger is offered a page that turns them away');
  assert.match(inn, /href="\/videos">My videos</, 'the shelf is not in the signed-in footer');
  assert.equal((out.match(/class="foot-mark"/g) ?? []).length, 1, 'the giant word appears once');
  assert.match(out, /class="foot-mark" aria-hidden="true">Timestamp\.</, 'the giant word is decoration and says so');
  assert.equal((out.match(/<div class="foot-col">/g) ?? []).length, 2, 'two columns, Product and Legal');
  assert.match(out, /Anton and Inter/, 'the fine print no longer credits the faces it ships');
  const { css } = createStylesheet({});
  assert.match(css, /\.foot-mark\s*\{[^}]*font-family:\s*var\(--display\)/, 'the giant word is not in the display face');
  assert.match(css, /\.foot-mark\s*\{[^}]*color:\s*var\(--lime\)/, 'the giant word is not lime');
  assert.match(css, /\.foot-mark\s*\{[^}]*font-size:\s*var\(--t-mark\)/, 'the giant word sets a size instead of naming one');
});

test('the footer promises the retention config/render.json enforces, on every page', () => {
  // The old layout typed "7 days" and "30"; guards.yml checks the consent text
  // against the config and nothing checked the footer. Same rule, same source.
  const cfg = JSON.parse(fs.readFileSync(new URL('../config/render.json', import.meta.url), 'utf8')).retention;
  for (const [name, html] of renderedPages()) {
    if (!/<footer class="foot">/.test(html)) continue;
    assert.match(html, new RegExp(`deleted after ${cfg.photoDays} days and the video after ${cfg.jobDays} days`),
      `${name}'s footer promises a retention the purge does not enforce`);
  }
});

test('the balance sentence is one function, and the account page speaks it', () => {
  assert.equal(balanceSentence({ credits: 43, cheapest: { id: '480p', credits: 21 } }), '43 credits left. Enough for 2 more tapes at 480p.');
  assert.equal(balanceSentence({ credits: 21, cheapest: { id: '480p', credits: 21 } }), '21 credits left. Enough for 1 more tape at 480p.');
  assert.equal(balanceSentence({ credits: 5, cheapest: { id: '480p', credits: 21 } }), '5 credits left. Not enough for another tape at 480p.');
  assert.equal(balanceSentence({ credits: 43 }), '43 credits left.');
  assert.equal(balanceSentence({ credits: NaN }), '');
});

test('a panel and a card carry the outline, from the token, and a panel sits on the card plane', () => {
  const { css } = createStylesheet({});
  for (const sel of ['.panel', '.card']) {
    const rule = new RegExp('\\n' + sel.replace('.', '\\.') + '\\s*\\{([^}]*)\\}').exec(css);
    assert.ok(rule, `no ${sel} rule`);
    assert.match(rule[1], /border:\s*1px solid var\(--line\)/, `${sel} is not outlined`);
    assert.match(rule[1], /border-radius:\s*var\(--r\)/, `${sel} does not take the card radius`);
    assert.match(rule[1], /background:\s*var\(--card\)/, `${sel} does not sit on the card plane`);
  }
  // A frosted plate blurs whatever is behind it. Nothing is behind it any more:
  // the photograph left the signed-in page on 2026-08-28 and onboarding loses
  // its own in this plan, so a backdrop-filter is a GPU cost that paints nothing.
  assert.ok(!/backdrop-filter/.test(css), 'a frosted plate survives with nothing behind it to frost');
  // THE WEIGHT ARC, IN THIS WORLD'S VOCABULARY. The photo (step 1) and the tape
  // (step 4) are filled cards; the two menus between them are the same outline
  // with nothing behind it. Heavy, light, light, heavy -- §6a's arc, carried by
  // the fill rather than by a frost tier that no longer exists.
  const choice = /\n\.panel--choice\s*\{([^}]*)\}/.exec(css);
  assert.ok(choice, 'no .panel--choice rule');
  assert.match(choice[1], /background:\s*transparent/, 'a menu panel is not an open outline on the ground');
  assert.ok(!/border:\s*0/.test(choice[1]), 'a menu panel still takes its outline away');
  assert.ok(!/border-radius:\s*0/.test(choice[1]), 'a menu panel still squares its corners');
  const anchor = /\n\.panel--anchor\s*\{([^}]*)\}/.exec(css);
  if (anchor) assert.ok(!/background/.test(anchor[1]), 'the anchor names a plane of its own; it is a card like the commit');
  const commit = /\n\.panel--commit\s*\{([^}]*)\}/.exec(css);
  assert.ok(commit, 'no .panel--commit rule');
  assert.ok(!/background/.test(commit[1]), 'the commit names a plane of its own; it is the card');
  assert.match(css, /\.lime\s*\{[^}]*background:\s*var\(--lime\)/, 'the lime panel is not lime');
  assert.match(css, /\.lime\s*\{[^}]*color:\s*var\(--on-lime\)/, 'text on the lime panel does not take the on-lime ink');
});

test('the seven paper-world alias names are gone from the sheet, and nothing reads them', () => {
  // `--lift` and `--ink-strong` were named in CLAUDE.md §70E as debt: legacy
  // names from the paper page that still described what they pointed at. The
  // other five were the same shape -- an alias that resolves to a token every
  // rule could name directly -- and once .panel stopped reading --frost there
  // was nothing left that any of them said. A name that maps to one value is
  // a second place to decide a colour, which is how the sign-in dialog was
  // painted for the wrong ground on 2026-09-05.
  const { css } = createStylesheet(FOCUS_MENU);
  for (const name of ['--lift', '--ink-strong', '--frost', '--frost-lit', '--muted', '--hairline', '--hairline-firm']) {
    // The lookahead keeps --frost from matching --frost-lit and --hairline from
    // matching --hairline-firm, so each name is asserted on its own.
    const re = new RegExp(`${name}(?![\\w-])`);
    assert.ok(!re.test(css), `${name} is still in the sheet -- defined or read`);
  }
  // The aliases that stay, because generated rules and tests name them and
  // they carry no paper-world meaning: --accent, --faint, --alarm, --ghost-hover.
  for (const name of ['--accent', '--faint', '--alarm', '--ghost-hover']) {
    assert.ok(new RegExp(`${name}:`).test(css), `${name} was retired by accident`);
  }
});

test('a field sits on the ground inside a card, outlined from the token; a banner and a refused button are cards too', () => {
  const { css } = createStylesheet({});
  const input = /input\[type="text"\], input\[type="email"\], input\[type="password"\], select\s*\{([^}]*)\}/.exec(css);
  assert.ok(input, 'no shared input rule');
  assert.match(input[1], /background:\s*var\(--ground\)/, 'a field inside a card does not recess to the ground');
  assert.match(input[1], /border:\s*1px solid var\(--line\)/, 'a field is not outlined from the token');
  // AND THE OTHER HALF OF THE SAME SENTENCE. DESIGN.md's Surfaces rule reads
  // both ways: "A field inside a card recesses to the ground; a field on the
  // ground lifts to the card." Steps 2 and 3 are the arc's light panels --
  // transparent, so their surface IS the ground -- and each carries a free-text
  // field: "Or describe what you are wearing", "Or describe it, if you have no
  // photograph of it." Recessed there, a field is ground on ground with nothing
  // to say it is a field but a 1px line at 0.14 alpha. Its own sibling the slim
  // dropzone already lifts for exactly this reason.
  const open = /\n\.panel--choice\s*\{([^}]*)\}/.exec(css);
  assert.ok(open, 'no .panel--choice rule');
  assert.match(open[1], /background:\s*transparent/, 'an open panel is no longer the ground, so the lift below needs re-deciding');
  const lifted = /\.panel--choice input\[type="text"\]\s*\{([^}]*)\}/.exec(css);
  assert.ok(lifted, 'no rule lifts a field on an open panel; the free text on steps 2 and 3 is ground on ground');
  assert.match(lifted[1], /background:\s*var\(--card\)/, 'a field on the ground does not lift to the card');
  const slim = /\.drop--slim\s*\{([^}]*)\}/.exec(css);
  assert.ok(slim, 'no .drop--slim rule');
  assert.match(slim[1], /background:\s*var\(--card\)/, 'the field beside the dropzone lifts and the dropzone does not');
  const notice = /\n\.notice\s*\{([^}]*)\}/.exec(css);
  assert.ok(notice, 'no .notice rule');
  assert.match(notice[1], /background:\s*var\(--card\)/, 'the notice is not a card');
  assert.match(notice[1], /border:\s*1px solid var\(--line\)/, 'the notice is a fill with no outline');
  assert.match(notice[1], /color:\s*var\(--ink\)/, 'the notice is written in the soft tier on a card');
  const disabled = /\.record:disabled\s*\{([^}]*)\}/.exec(css);
  assert.ok(disabled, 'no .record:disabled rule');
  assert.match(disabled[1], /background:\s*var\(--card\)/, 'a refused Record is not the card plane');
  assert.match(disabled[1], /border:\s*1px solid var\(--line\)/, 'a refused Record on a card is invisible without its outline');
  assert.match(disabled[1], /color:\s*var\(--ink-soft\)/, 'a refused Record does not read as refused');
  assert.ok(!/var\(--(lime|accent)\)/.test(disabled[1]), 'a refused button is lime -- lime means go');
  const label = /\n\.label\s*\{([^}]*)\}/.exec(css);
  assert.ok(label, 'no .label rule');
  assert.match(label[1], /background:\s*var\(--card\)/, 'the cassette label is not on the card plane');
});

test('a shelf tile carries the card outline', () => {
  const { css } = createStylesheet({});
  const frame = /\.tape \.frame\s*\{([^}]*)\}/.exec(css);
  assert.ok(frame, 'no .tape .frame rule');
  assert.match(frame[1], /background:\s*var\(--card\)/, 'an unfinished tile has no plate');
  assert.match(frame[1], /border:\s*1px solid var\(--line\)/, 'a tile is not outlined -- spec §2.4 names shelf tiles');
  assert.match(frame[1], /border-radius:\s*var\(--r-sm\)/, 'a tile does not take the small radius');
});

test('the display face is never tracked or set loose, on any page heading', () => {
  // Anton wants 0.9-0.95 leading and no tracking (DESIGN.md, Type). Four
  // per-page .headline rules still carried the SANS-era values -- line-height
  // 1.1 and letter-spacing -0.02em -- from before the display face changed, so
  // every interior heading sat loose and squeezed in a face that is neither.
  // The one legitimate exception names the body face in the same rule (an
  // email address is data, Task 4) and is skipped by that.
  const { css } = createStylesheet({});
  const rules = [...css.matchAll(/([^{}]*\.headline[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 5, `expected the base rule and the per-page sizes, found ${rules.length}`);
  for (const [, sel, body] of rules) {
    if (/font-family:\s*var\(--sans\)/.test(body)) continue;
    const ls = /letter-spacing:\s*([^;]+);/.exec(body);
    if (ls) assert.equal(ls[1].trim(), '0', `"${sel.trim()}" tracks the display face: ${ls[1].trim()}`);
    const lh = /line-height:\s*([0-9.]+)\s*;/.exec(body);
    if (lh) assert.ok(Number(lh[1]) <= 0.95, `"${sel.trim()}" sets the display face loose at ${lh[1]}`);
  }
});

test('an option card is an outlined card, not a ghost, and the chosen one fills lime', () => {
  // WHY THE GHOST GOES FROM TEXT CARDS AND STAYS ON PHOTOGRAPHS. An unchosen
  // option used to be the same markup at half opacity, and "chosen" was full
  // opacity plus the name in the accent. Spec §6 gives every option card an
  // outline; an outline in --line (0.14 alpha) multiplied by --ghost (0.5) is
  // a 0.07-alpha line, which is invisible, so the two states would be "no card"
  // and "lime card". The outline carries "here is a choice" at full strength
  // and the fill carries "this one". A photograph is different: dimming it is
  // exactly how the world says which picture is lit (see the .thumb comment),
  // so the place card keeps its ghost and takes a ring instead of a fill.
  const { css } = createStylesheet(FOCUS_MENU);
  for (const kind of ['lookcard', 'qualitycard', 'framecard']) {
    const base = new RegExp(`\\n\\.${kind}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(base, `no .${kind} rule`);
    assert.match(base[1], /border:\s*1px solid var\(--line\)/, `.${kind} is not outlined`);
    assert.match(base[1], /border-radius:\s*var\(--r-sm\)/, `.${kind} does not take the small radius`);
    assert.ok(!/opacity:\s*var\(--ghost\)/.test(base[1]), `.${kind} is still a ghost -- its outline is invisible at half opacity`);
    const soon = new RegExp(`\\n\\.${kind}--soon\\s*\\{([^}]*)\\}`).exec(css);
    if (soon) assert.match(soon[1], /opacity:\s*var\(--ghost\)/, `a deferred .${kind} lost its ghost -- "not yet" is still an unlit value`);
  }
  // The FOCUS_MENU's own ids, so the assertion follows the fixture.
  assert.ok(css.includes('#of-tshirt-jeans:checked~.wrap .lookcard--of-tshirt-jeans{background:var(--lime);border-color:var(--lime);}'), 'the chosen outfit does not fill lime');
  assert.ok(css.includes('#of-tshirt-jeans:checked~.wrap .lookcard--of-tshirt-jeans .name{color:var(--on-lime);}'), 'the chosen outfit keeps page ink on lime');
  assert.ok(css.includes('#of-tshirt-jeans:checked~.wrap .lookcard--of-tshirt-jeans .detail{color:var(--on-lime-soft);}'), 'the chosen outfit detail keeps page ink on lime');
  assert.ok(css.includes('#q-480p:checked~.wrap .qualitycard--q-480p{background:var(--lime);border-color:var(--lime);}'), 'the chosen quality does not fill lime');
  assert.ok(css.includes('#a-4x3:checked~.wrap .framecard--a-4x3{background:var(--lime);border-color:var(--lime);}'), 'the chosen shape does not fill lime');
  assert.ok(css.includes('#a-4x3:checked~.wrap .framecard--a-4x3 .shape{border-color:var(--on-lime);}'), 'the glyph on a lime card is not drawn in the on-lime ink');
  // Lime means chosen. Nothing unchosen wears it -- not the glyph, not the mark.
  for (const m of css.matchAll(/([^{}\n]*\.shape[^{}]*)\{([^}]*)\}/g)) {
    if (/:checked/.test(m[1])) continue;
    assert.ok(!/var\(--(accent|accent-deep|lime)\)/.test(m[2]), `an unchosen shape glyph is drawn in lime: "${m[1].trim()}"`);
  }
  for (const m of css.matchAll(/\.(lookcard|qualitycard|framecard) \.tick\s*\{([^}]*)\}/g)) {
    assert.match(m[2], /color:\s*var\(--on-lime\)/, `.${m[1]} .tick only ever shows on a lime card and is not in the on-lime ink`);
  }
  // Hierarchy inside a card is colour again now that nothing multiplies it.
  const detail = /\.lookcard \.detail\s*\{([^}]*)\}/.exec(css);
  assert.match(detail[1], /color:\s*var\(--ink-soft\)/, 'an unchosen card cannot use the soft tier only while it is ghosted; it is not ghosted');
  // AND THE ONE CARD STILL GHOSTED KEEPS PAGE INK INSIDE IT. DESIGN.md's ghost
  // rule forbids the soft tier inside a ghosted control, because colour is what
  // an opacity multiplies away; the whole-sheet "nothing in the soft tier is
  // also ghosted" sweep is per-RULE, so it cannot see an ancestor's opacity
  // over a descendant's colour and this pair has to be named here. (Teaching
  // that sweep to walk ancestors would touch every rule in the sheet.)
  const soonDetail = /\.qualitycard--soon \.detail\s*\{([^}]*)\}/.exec(css);
  assert.ok(soonDetail, 'no .qualitycard--soon .detail rule -- the deferred tier is the one text card still ghosted, and its detail line needs page ink');
  assert.match(soonDetail[1], /color:\s*var\(--ink\)/, 'the deferred quality card is still a ghost and its detail is in the soft tier: --ink-soft under --ghost measures 2.83:1 on this ground, below the floor');
  // THE SAME CLASS ONE CARD OVER, AND IT IS A GLYPH RATHER THAN TEXT. A
  // deferred shape still draws its rectangle -- the exception DESIGN.md grants
  // is for the thing that depicts an aspect ratio, and one drawn in a colour
  // nobody can see depicts nothing. Drawn in the soft tier under the ghost it
  // composites to 2.85:1, below 1.4.11's 3:1 for a non-text glyph; page ink
  // under the same ghost clears it.
  const soonShape = /\.framecard--soon \.shape\s*\{([^}]*)\}/.exec(css);
  assert.ok(soonShape, 'no .framecard--soon .shape rule -- a deferred shape must still draw its glyph');
  assert.match(soonShape[1], /border-color:\s*var\(--ink\)/, 'a deferred shape glyph is drawn in the soft tier under the ghost: 2.85:1, below the 3:1 a glyph needs');
});

test('the chosen place keeps its photograph and takes a lime ring and a lime badge', () => {
  const { css } = createStylesheet(FOCUS_MENU);
  assert.ok(css.includes('#pl-ostsee-strand:checked~.wrap .placecard--pl-ostsee-strand{transform:scale(1.03);box-shadow:0 0 0 2px var(--lime);}'), 'the chosen place carries no lime ring');
  assert.ok(css.includes('#pl-ostsee-strand:checked~.wrap .placecard--pl-ostsee-strand .thumb{opacity:1;}'), 'the chosen photograph is not lit');
  assert.ok(css.includes('#pl-own:checked~.wrap .placecard--own{transform:scale(1.03);box-shadow:0 0 0 2px var(--lime);}'), 'the own-place card is chosen without the ring');
  const badge = /\.placecard \.badge\s*\{([^}]*)\}/.exec(css);
  assert.ok(badge, 'no .placecard .badge rule');
  assert.match(badge[1], /background:\s*var\(--lime\)/, 'the badge is not a lime pill');
  assert.match(badge[1], /color:\s*var\(--on-lime\)/, 'the badge text is not the on-lime ink');
  assert.match(badge[1], /border-radius:\s*999px/, 'the badge is not a pill');
  assert.ok(!/text-shadow/.test(badge[1]), 'a filled pill needs no shadow to survive a photograph');
  // The filled pill is the mark; a bullet inside it would say "chosen" twice.
  const badgeText = /\.placecard \.badge::before\s*\{\s*content:\s*"([^"]*)"/.exec(css);
  assert.ok(badgeText, 'no badge text rule');
  assert.equal(badgeText[1], 'Selected', `the badge reads "${badgeText[1]}" -- one word, no bullet (owner, 2026-09-07)`);
  const card = /\n\.placecard\s*\{([^}]*)\}/.exec(css);
  assert.ok(card, 'no .placecard rule');
  assert.match(card[1], /border-radius:\s*var\(--r-sm\)/, 'the place card is squared while every other card is rounded');
  assert.ok(!/box-shadow/.test(card[1]), 'every place card wears the ring');
  const thumb = /\n\.thumb\s*\{([^}]*)\}/.exec(css);
  assert.match(thumb[1], /opacity:\s*var\(--ghost\)/, 'the unlit photograph lost its ghost -- the ghost is what says which picture is lit');
});

test('a dropzone says so with a dashed outline, from the token', () => {
  const { css } = createStylesheet({});
  const drop = /\n\.drop\s*\{([^}]*)\}/.exec(css);
  assert.ok(drop, 'no .drop rule');
  assert.match(drop[1], /border:\s*1px dashed var\(--line\)/, 'the dropzone is not dashed -- spec §6 says a dashed --line outline');
  assert.match(drop[1], /background:\s*var\(--ground\)/, 'the photo well is not recessed to the ground inside its card');
  const hover = /\.drop:hover\s*\{([^}]*)\}/.exec(css);
  assert.ok(hover, 'no .drop:hover rule');
  assert.match(hover[1], /border-color:\s*var\(--ink-soft\)/, 'hover does not brighten the outline');
  assert.ok(!/background/.test(hover[1]), 'hover still lifts the fill, which was the recess idiom');
  const slim = /\.drop--slim\s*\{([^}]*)\}/.exec(css);
  assert.ok(slim, 'no .drop--slim rule');
  assert.match(slim[1], /background:\s*var\(--card\)/, 'the place dropzone sits on an open panel; on the ground it needs the card plane to read as a well');
});

test('the record button stands beside the price, after the consent, not under a list', () => {
  const html = homePage({ ...FOCUS_MENU, consentText: 'I agree' });
  const commit = html.slice(html.indexOf('panel--commit'), html.indexOf('panel--archive'));
  const check = commit.indexOf('<label class="check">');
  const foot = commit.indexOf('<div class="commit-foot">');
  assert.ok(check > -1, 'no consent on the commit panel');
  assert.ok(foot > check, 'the consent does not come before the price and the button');
  const inside = commit.slice(foot, commit.indexOf('</div>', foot));
  assert.match(inside, /<dl class="facts">/, 'the facts are not in the row with the button');
  assert.match(inside, /<button type="submit" class="record" id="record"/, 'the button is not in the row with the facts');
  // The three facts are still the three facts, in the same words the tests
  // elsewhere read.
  assert.match(inside, /<dt>Length<\/dt><dd>15 SEC<\/dd>/);
  assert.match(inside, /<dt>Estimated cost<\/dt>/);
  assert.match(inside, /<dt>Credits<\/dt>/);
  const { css } = createStylesheet(FOCUS_MENU);
  assert.match(css, /\.commit-foot\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/, 'the row is not facts-then-button');
  assert.match(css, /\.commit-foot \.record\s*\{[^}]*width:\s*auto/, 'the button still spans the card instead of standing beside the price');
  assert.match(css, /@media \(max-width: 30rem\)\s*\{[^}]*\.commit-foot\s*\{[^}]*grid-template-columns:\s*1fr/, 'the row does not stack on a phone');
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

test('every face the sheet declares is a file under assets/fonts with its licence beside it, and no network font exists', () => {
  // THE CSP IS font-src 'self' AND IT DOES NOT CHANGE. A face named in the
  // sheet that is not on disk is a silent fallback to the system stack in
  // every browser, with no error anywhere; a face fetched from a CDN is a
  // third-party request on a page that has just been handed somebody's
  // photograph. The licence sits beside each file because the OFL asks for it
  // and because the VT323 file has shipped that way since 2026-08-20.
  const { css } = createStylesheet({});
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const family = (face) => /font-family:\s*'([^']+)'/.exec(face)?.[1];
  assert.deepEqual(faces.map(family).sort(), ['Anton', 'Inter', 'Inter', 'TapeOSD'],
    'the sheet declares a different set of faces than the four this world ships');

  const LICENCE = { Anton: 'OFL-anton.txt', Inter: 'OFL-inter.txt', TapeOSD: 'OFL.txt' };
  const fontsDir = new URL('../assets/fonts/', import.meta.url);
  for (const face of faces) {
    const name = family(face);
    const files = [...face.matchAll(/url\('\/(?:fonts\/)?([^']+)'\)/g)].map((m) => m[1]);
    assert.ok(files.length > 0, `${name} names no file at all`);
    for (const file of files) {
      const on = new URL(file, fontsDir);
      assert.ok(fs.existsSync(on) && fs.statSync(on).size > 0, `${name} names /${file}, which is not under assets/fonts/`);
    }
    assert.ok(fs.existsSync(new URL(LICENCE[name], fontsDir)), `${name} ships without ${LICENCE[name]} beside it`);
  }

  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : e.name.endsWith('.mjs') ? [new URL(e.name, dir)] : []
  ));
  const offenders = walk(new URL('../scripts/', import.meta.url))
    .filter((f) => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => f.pathname);
  assert.deepEqual(offenders, [], 'a network font reached scripts/; font-src is self and the CSP does not change');
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

test('the legal pages are documents on the ground, not cards, and the error page is still a card', () => {
  const legal = {
    privacy: privacyPage({ entity: null, retention: { photoDays: 7, jobDays: 30 } }),
    terms: termsPage({ entity: null }),
    impressum: impressumPage({ entity: null }),
  };
  for (const [name, html] of Object.entries(legal)) {
    assert.match(html, /<main>\s*<section class="legal">/, `${name} does not open as a document section`);
    assert.ok(!/class="panel"/.test(html), `${name} is boxed in a card -- a document is read, not framed`);
    assert.match(html, /<h1 class="headline">/, `${name} lost its heading`);
    assert.match(html, /<h2 class="eyebrow legal-h">/, `${name} lost its section headings`);
  }
  for (const [name, html] of Object.entries({
    error: errorPage({ status: 404, title: 'Not found' }),
    'auth-unavailable': authUnavailablePage(),
    'identity-unavailable': identityUnavailablePage(),
  })) {
    assert.match(html, /<section class="panel">/, `${name}: a short message belongs on a card`);
  }
  assert.match(errorPage({ status: 404, title: 'Not found' }), /<a class="go" href="\/">Start again<\/a>/, 'the error page lost its way home');
  const { css } = createStylesheet({});
  const doc = /\n\.legal\s*\{([^}]*)\}/.exec(css);
  assert.ok(doc, 'no .legal rule');
  assert.match(doc[1], /max-width:\s*66ch/, 'a legal document is not at reading measure');
  assert.ok(!/border|background/.test(doc[1]), 'a legal document draws a card around itself');
  assert.match(css, /\.page-legal \.headline\s*\{[^}]*font-size:\s*var\(--t-7\)/, 'the document title is not at the page-title size');
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
  // The one rule. A border written against `var(--line)` is the token's own
  // line, so the whole world's edges move when that one value moves -- which
  // is how three hundred rules changed ground twice without being rewritten.
  // A LITERAL colour in a border declaration answers to nothing: no token can
  // lighten it, dim it or turn it off, and it is a visible line for ever.
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

test('every focus ring in the sheet is the same ring: 2px, offset 2px, and never in lime', () => {
  // Spec §2.4 and DESIGN.md give the focus outline one shape and two colours --
  // 2px at 2px offset, `--ink` on a dark surface and `--on-lime` inside a lime
  // panel. A ring drawn in the accent says "chosen" to a keyboard user who has
  // chosen nothing, and a ring at a different weight or offset reads as a
  // different affordance on the one indicator that must read the same
  // everywhere. The offset is what draws a chosen lime card's ring on the dark
  // surface outside it, so no card needs a ring of its own.
  // TWO EXCEPTIONS, BOTH NAMED, AND THE SECOND IS PINNED BELOW SO THE EXEMPTION
  // CANNOT OUTLIVE ITS SUBJECT. A rule inside a lime panel draws in --on-lime.
  // And the landing's wipe grip is itself drawn in page ink, so a page-ink ring
  // on it would be ink on ink; it takes the go colour, which is the one thing
  // guaranteed to read against the grip (the reasoning is in the sheet above
  // that rule). An exemption for a rule that has since been deleted is a hole,
  // so the grip's ring is asserted present rather than merely skipped.
  const GRIP = '.wipe-grip';
  const { css } = createStylesheet(FOCUS_MENU);
  const wrong = [];
  let sawGrip = false;
  for (const m of css.matchAll(/([^{}\n]*:focus-visible[^{}\n]*)\{([^}]*)\}/g)) {
    const sel = m[1].trim();
    const body = m[2];
    if (!/(^|;|\s)outline(-color)?:/.test(body)) continue;
    if (sel.includes(GRIP)) { sawGrip = true; continue; }
    if (/\.lime\b/.test(sel)) continue;
    const colour = /(^|;|\s)outline(-color)?:\s*([^;]+);/.exec(body);
    if (colour && /var\(--(accent|accent-deep|accent-bright|lime|lime-hover)\)/.test(colour[3])) {
      wrong.push(`${sel} -> outline ${colour[3].trim()}`);
    }
    const width = /outline:\s*([0-9.]+)px/.exec(body);
    if (width && width[1] !== '2') wrong.push(`${sel} -> ${width[1]}px ring`);
    const offset = /outline-offset:\s*([0-9.]+)px/.exec(body);
    if (offset && offset[1] !== '2') wrong.push(`${sel} -> offset ${offset[1]}px`);
  }
  assert.deepEqual(wrong, [],
    'The focus ring is one ring, 2px at 2px offset, in --ink (or --on-lime '
    + 'inside a lime panel):\n' + wrong.join('\n'));
  assert.ok(sawGrip, 'the wipe grip is exempted above and has no focus ring left to exempt');
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
// the landing page: eight sections, the tape first, the place ground in the band
// ---------------------------------------------------------------------------

const PLACES_FIXTURE = [
  { id: 'ostsee-strand', label: 'Baltic beach', timeOfDay: 'afternoon' },
  { id: 'wohnzimmer-abend', label: 'Living room', timeOfDay: 'evening' },
];

test('the landing is eight sections in order, the tape slot in the hero and the place ground in the band', () => {
  const html = landingPage({ places: PLACES_FIXTURE, account: null });
  const order = ['<header class="lime hero">', 'class="manifesto', 'class="how2', 'class="band" id="places"', 'class="facts3"', 'class="demo', 'class="faq"', '<footer class="foot">'];
  let at = -1;
  for (const marker of order) {
    const i = html.indexOf(marker, at + 1);
    assert.ok(i > at, `${marker} is missing, or out of order`);
    at = i;
  }
  // ONE loop video, inert, inside the band; the hero's tape is its own figure.
  assert.equal((html.match(/<video class="bgv"/g) ?? []).length, 1, 'the band should carry one loop video');
  const band = html.slice(html.indexOf('class="band"'), html.indexOf('class="facts3"'));
  assert.match(band, /class="bgs"/, 'the place ground is not inside the band');
  assert.match(band, /class="bg bg--pl-ostsee-strand"/, 'the still fallback layer is missing');
  assert.match(band, /class="scrim"/, 'the band has a photograph and no scrim');
  assert.match(band, /<ul class="lrail">/, 'the rail is not inside the band');
  assert.match(band, /Baltic beach/, 'the rail lost its place names');
  assert.ok(!/class="(lmenu|strike|losds|losd|bloom|veils|plain|how-lead)"/.test(html), 'a piece of the old landing survives');
  // The three "Make a tape" calls to action (nav pill, hero, demo) navigate to
  // /signup; only Sign in opens the dialog. A data-signin here hands a
  // first-time visitor a password box instead of the signup form, and kills
  // ctrl-click too. The footer carries a fourth "Make a tape" link (to /signup
  // as well, class="quiet") that never opened the dialog and is excluded here.
  const signupLinks = (html.match(/<a\b[^>]*href="\/signup"[^>]*>Make a tape<\/a>/g) ?? [])
    .filter((tag) => !/class="quiet"/.test(tag));
  assert.equal(signupLinks.length, 3, 'expected three "Make a tape" calls to action to /signup (nav pill, hero, demo)');
  for (const tag of signupLinks) {
    assert.ok(!/\bdata-signin\b/.test(tag), `a /signup "Make a tape" link opens the sign-in dialog instead of navigating: ${tag}`);
  }
  assert.match(html, /<a href="\/login" data-signin>Sign in<\/a>/, 'the Sign in link should still open the dialog');
  for (const tag of html.match(/<video[^>]*>/g) ?? []) {
    assert.ok(!/\ssrc=/.test(tag) && !/\sautoplay/.test(tag), `a video loads before any check has run: ${tag}`);
    assert.ok(/\smuted/.test(tag) && /\splaysinline/.test(tag) && /\sloop/.test(tag), `a video without muted+playsinline+loop: ${tag}`);
  }
  assert.doesNotMatch(landingPage({ places: [], account: null }), /undefined/, 'an empty catalog leaks undefined into the page');
});

test('the hero carries one action and the free-grant sentence, and the landing prices nothing in dollars', () => {
  const pricing = { fromCredits: 21, packUSD: 12, packCredits: 92, freeCredits: 21, sameInEveryShape: true };
  const html = landingPage({ places: PLACES_FIXTURE, account: null, pricing });
  const hero = /<header class="lime hero">([\s\S]*?)<\/header>/.exec(html);
  assert.ok(hero, 'no lime hero');
  assert.equal((hero[1].match(/class="hero-cta"/g) ?? []).length, 1, 'the hero carries exactly one action');
  assert.match(hero[1], /21 free credits with a new account\. One tape, no card\./, 'the free-grant line is missing or typed differently');
  assert.match(hero[1], /Upload one photo of your face, choose a place and an outfit, and get back a tape that looks like it was found in a drawer\./);
  assert.match(hero[1], /class="ruler"[\s\S]*>REC<[\s\S]*>00:15</, 'the counter ruler is missing or does not run to fifteen');
  assert.match(hero[1], /<nav class="hero-nav"[\s\S]*href="#places">Places<[\s\S]*href="\/pricing">Pricing<[\s\S]*data-signin>Sign in<[\s\S]*class="navpill"/, 'the nav is not inside the hero, or lost a link');
  assert.doesNotMatch(html, /\$\d/, 'a dollar price reached the landing; the pack prices live on the pricing page');
  assert.doesNotMatch(landingPage({ places: PLACES_FIXTURE, account: null }), /free credits with a new account/, 'a grant sentence was invented with no seam behind it');
});

test('the showcase fills the hero, the stickers and the demo when present, and each slot falls back to a place when absent', () => {
  const showcase = {
    hero: { video: '/showcase/hero-16x9.mp4', poster: '/showcase/hero-16x9.jpg', caption: 'Times Square · 2003 · 16:9 · made from one photograph' },
    tall: { video: '/showcase/tape-9x16.mp4', poster: '/showcase/tape-9x16.jpg', caption: 'Times Square · 2003 · 9:16' },
    fourThree: null,
    stickers: ['/showcase/sticker-1.jpg', '/showcase/sticker-2.jpg'],
  };
  const full = landingPage({ places: PLACES_FIXTURE, account: null, showcase });
  const heroTape = /<figure class="hero-tape">([\s\S]*?)<\/figure>/.exec(full);
  assert.ok(heroTape, 'no hero tape figure');
  assert.match(heroTape[1], /<video class="tape-media tape-media--hero" muted playsinline loop preload="none" poster="\/showcase\/hero-16x9\.jpg" data-src="\/showcase\/hero-16x9\.mp4">/);
  assert.match(heroTape[1], /<figcaption class="tape-cap">Times Square · 2003 · 16:9 · made from one photograph<\/figcaption>/);
  assert.equal((full.match(/class="sticker sticker--/g) ?? []).length, 2, 'one sticker per file present, and no more');
  const demo = /<section class="demo inner">([\s\S]*?)<\/section>/.exec(full);
  assert.ok(demo, 'no demo band');
  assert.match(demo[1], /data-src="\/showcase\/tape-9x16\.mp4"/, 'the tall tape is missing from the demo');
  assert.match(demo[1], /<img class="tape-media tape-media--four" src="\/places\/wohnzimmer-abend\.jpg"/, 'an absent 4:3 tape does not fall back to a place photograph');

  const none = landingPage({ places: PLACES_FIXTURE, account: null, showcase: null });
  assert.ok(!/\/showcase\//.test(none), 'a page with no showcase names a showcase url');
  assert.ok(!/data-src=/.test(none), 'a page with no showcase ships a video it cannot fill');
  const fallback = /<figure class="hero-tape">([\s\S]*?)<\/figure>/.exec(none);
  assert.match(fallback[1], /<img class="tape-media tape-media--hero" src="\/places\/ostsee-strand\.jpg"/, 'the hero slot does not fall back to the first place');
  assert.match(fallback[1], /<figcaption class="tape-cap">Baltic beach<\/figcaption>/, 'the fallback is captioned with the place, never with the tape');
  assert.doesNotMatch(none, /class="sticker /, 'a sticker was invented');
});

test('the landing asks six questions, states three facts as quotations, reads a date, and ends on the giant word once', () => {
  const html = landingPage({
    places: PLACES_FIXTURE, account: null,
    pricing: { fromCredits: 21, packUSD: 12, packCredits: 92, freeCredits: 21, sameInEveryShape: true },
    facts: { photoDays: 7, jobDays: 30, imageProcessor: null, qualities: ['480p', '720p'], shapes: ['4:3', '16:9', '9:16'], frames: 375, fps: 25 },
  });
  assert.equal((html.match(/<details class="faq-row">/g) ?? []).length, 6, 'six questions');
  assert.match(html, /sent to fal\.ai, the AI provider that generates the tape, and to nobody else/);
  assert.match(html, /deleted after 7 days and the finished tape after 30 days/);
  assert.match(html, /4:3, 16:9 and 9:16 at 480p and 720p/);
  assert.match(html, /a tape costs the same in every shape/);
  assert.equal((html.match(/<figure class="fact /g) ?? []).length, 3, 'three fact cards');
  assert.match(html, /<figure class="fact fact--lime"><blockquote><p>Exactly fifteen seconds\.<\/p><\/blockquote><figcaption>375 frames at 25 a second, PAL/);
  assert.match(html, /<figure class="fact fact--white"><blockquote><p>Deleted after 7 days\.<\/p>/);
  assert.match(html, /<p class="flip" aria-label="14 08 2003">/, 'the flip counter does not read the date the product is named for');
  assert.equal((html.match(/class="foot-mark"/g) ?? []).length, 1, 'the giant word appears once');
  assert.match(html, /run through a real tape chain/, 'the grade card lost the sentence the still-approval sweep anchors on');
  assert.match(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), /You, somewhere in 2003, on a tape that looks found in a drawer\./, 'the manifesto sentence is broken by its stickers');
  // With a classifier declared the FAQ names it, the way /privacy does.
  const two = landingPage({ places: PLACES_FIXTURE, account: null, facts: { imageProcessor: 'Amazon Web Services (Rekognition), Frankfurt' } });
  assert.match(two, /and to Amazon Web Services \(Rekognition\), Frankfurt, which checks it/);
});

test('the place rail snaps inside the band, over the photograph it lights', () => {
  const html = landingPage({ places: PLACES_FIXTURE, account: null });
  const css = createStylesheet({ places: PLACES_FIXTURE, outfits: [] }).css;
  assert.ok(/<ul class="lrail">/.test(html), 'the place options are not a rail');
  assert.ok(/<li>.*lopt--pl-ostsee-strand/s.test(html), 'the rail dropped its list items');
  const rail = /\.lrail\s*\{([^}]*)\}/.exec(css);
  assert.ok(rail, 'no .lrail rule');
  assert.ok(/scroll-snap-type:\s*x mandatory/.test(rail[1]), 'the rail does not snap');
  assert.ok(/overflow-x:\s*auto/.test(rail[1]), 'the rail does not scroll');
  assert.ok(/\.lrail\s+li\s*\{[^}]*scroll-snap-align/.test(css), 'the items have no snap point');
  // The generated rules reach a ground that now lives INSIDE the band.
  assert.match(css, /#pl-ostsee-strand:checked~\.wrap \.bgs \.bg--pl-ostsee-strand\{opacity:1;\}/, 'the still-layer rule cannot reach a ground inside the band');
  // No `opacity:1` in the chosen rule since 2026-09-07: there is no ghost to
  // lift the chosen option out of, so the rule says only what it means.
  assert.match(css, /#pl-ostsee-strand:checked~\.wrap \.lopt--pl-ostsee-strand\{color:var\(--lime\);\}/, 'the chosen place is not lime');
  assert.ok(!/\.lmenu\s*\{/.test(css), 'the plate rule survives its element');
  assert.match(css, /\.band \.scrim\s*\{/, 'the band has no scrim rule of its own');
  assert.doesNotMatch(css, /\.losd\b/, 'the OSD readout rule survives its element');
});

/**
 * THE LANDING'S HERO. The rail is kept, one call to action, and the price sits
 * with the claim in the closing plate rather than under the button. The face
 * moved to the display face on 2026-09-06: this world sets every heading in
 * Anton, uppercase, and the hero is the largest of them.
 */
test('the hero is set in the display face at the hero size', () => {
  const html = landingPage({ places: PLACES_FIXTURE, account: null });
  const css = createStylesheet({ places: PLACES_FIXTURE, outfits: [] }).css;
  assert.match(html, /<h1 class="hero-line">One photograph\. Fifteen seconds of 2003\.<\/h1>/,
    'the hero is one sentence in one face');
  const hero = /\.hero-line\s*\{([^}]*)\}/.exec(css);
  assert.ok(hero, 'no .hero-line rule');
  assert.match(hero[1], /font-family:\s*var\(--display\)/, 'the hero is not in the display face');
  assert.match(hero[1], /font-size:\s*var\(--t-hero\)/, 'the hero is not at the hero size');
  assert.match(hero[1], /text-transform:\s*uppercase/, 'display is always uppercase');
  assert.doesNotMatch(hero[1], /var\(--(osd|sans)\)/, 'the hero is still in a body or readout face');
});

test('no selection mark is pinned to the right of its card', () => {
  // THE OWNER ASKED FOR THE MARK ON THE LEFT, EVERYWHERE (2026-09-04). The
  // frame card drew its dot in the flow before the shape; the outfit and
  // quality cards pinned theirs to the top-right corner. The browser-smoke
  // test measures where each mark paints; this is the cheap guard that a
  // rule does not quietly send one back to the right.
  const { css } = createStylesheet(FOCUS_MENU);
  for (const sel of ['.lookcard .tick', '.qualitycard .tick', '.framecard .tick', '.placecard .badge']) {
    const rule = new RegExp(sel.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}').exec(css);
    assert.ok(rule, `no rule for ${sel}`);
    assert.doesNotMatch(rule[1], /\bright:/, `${sel} is positioned from the right edge`);
  }
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

test('every colour the world ships clears its floor on the surface it sits on', () => {
  // DESIGN.md's table is the OUTPUT of this calculation, recomputed from the
  // values that actually ship, so the two cannot drift. Text is held to the
  // 4.5:1 body floor on BOTH dark surfaces, because a card is where most of
  // the working pages set their words; the lime pair is held to the floor on
  // lime and on its hover value, because a button is text on lime and a
  // hovered button is still a button.
  const { css } = createStylesheet(FOCUS_MENU);
  const ground = tokenValue(css, '--ground');
  const card = tokenValue(css, '--card');
  const lime = tokenValue(css, '--lime');
  const limeHover = tokenValue(css, '--lime-hover');
  const check = (name, value, surfaceName, surface) => {
    const got = contrastOf(value, surface);
    assert.ok(got >= 4.5, `${name} (${value}) measures ${got.toFixed(2)}:1 on ${surfaceName} (${surface}), under the 4.5:1 floor`);
  };
  for (const name of ['--ink', '--ink-soft', '--lime', '--rec']) {
    const value = tokenValue(css, name);
    check(name, value, '--ground', ground);
    check(name, value, '--card', card);
  }
  for (const name of ['--on-lime', '--on-lime-soft']) {
    const value = tokenValue(css, name);
    check(name, value, '--lime', lime);
    check(name, value, '--lime-hover', limeHover);
  }
  // A card is a surface, not text: it only has to be tellable from the ground.
  assert.ok(contrastOf(card, ground) >= 1.08, `--card (${card}) is indistinguishable from --ground (${ground})`);
});

test('a ghost sits at the floor on the ground and on a card, and there is one ground', () => {
  // The rule is unchanged from the paper world: whatever --ghost is set to,
  // --ink composited at that opacity over the surface it sits on clears 4.5:1.
  // What changed is that there is ONE ground now -- body.is-landing and its
  // second --ghost are gone -- and two surfaces the ghost can sit on.
  const { css } = createStylesheet(FOCUS_MENU);
  const m = /:root\s*\{[\s\S]*?--ghost:\s*([\d.]+)/.exec(css);
  assert.ok(m, 'the sheet names no --ghost value');
  const alpha = Number(m[1]);
  const ink = tokenValue(css, '--ink');
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  for (const [name, surface] of [['--ground', tokenValue(css, '--ground')], ['--card', tokenValue(css, '--card')]]) {
    const mixed = '#' + rgb(ink)
      .map((c, i) => Math.round(c * alpha + rgb(surface)[i] * (1 - alpha)).toString(16).padStart(2, '0'))
      .join('');
    const got = contrastOf(mixed, surface);
    assert.ok(got >= 4.5, `a ghost at ${alpha} puts --ink at ${got.toFixed(2)}:1 over ${name}, under the floor`);
  }
  assert.ok(!/body\.is-landing/.test(css), 'a second ground is back in the sheet; this world has one');
});

test('no value of a superseded world is left in the sheet, and the tape keeps its own stamp colour', () => {
  // Two worlds were retired on 2026-09-06 -- Struck's ink-blue and cathode
  // orange, and the paper page's cream and oxide. A retired value that
  // survives in one rule is a page that half-changed, and the generated
  // per-catalog rules bake colours in at build time where no token can
  // re-point them, so the whole sheet is scanned, generated rules included.
  // Comment lines are skipped; the house style continues a comment on plain
  // indented lines, so a retired value belongs in a comment only in words.
  const { css } = createStylesheet(FOCUS_MENU);
  const dead = new RegExp([
    '--l-(ground|lift|cathode|hot|bone|dim)', 'var\\(--(paper|oxide|oxide-deep)\\)', 'is-landing',
    '#FF8A1E', '#FFB25C', 'rgba\\(\\s*255\\s*,\\s*138\\s*,\\s*30\\b', 'rgba\\(\\s*255\\s*,\\s*178\\s*,\\s*92\\b',
    '#A8342A', '#8E2A22', 'rgba\\(\\s*168\\s*,\\s*52\\s*,\\s*42\\b', '#D98B7A',
    '#F2EDE4', '#2A211B', '#7A6A5E', 'rgba\\(\\s*42\\s*,\\s*33\\s*,\\s*27\\b',
    '#070A11', '#0C111B', 'rgba\\(\\s*7\\s*,\\s*10\\s*,\\s*17\\b', 'rgba\\(\\s*12\\s*,\\s*17\\s*,\\s*27\\b',
    '#8D8880', '#EDE7DC', '#C8C2B8', '#B9B3A9', '#4E463C', '#17120A',
  ].join('|'), 'i');
  const offenders = css.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => dead.test(l) && !/^\s*(\*|\/\*|\/\/)/.test(l));
  assert.deepEqual(offenders.map(([n, l]) => `${n}: ${l.trim()}`), [],
    'a superseded world is still painting something');

  // The date stamp inside the tape is ffmpeg's and keeps the colour the look
  // was calibrated with; the interface neither imitates nor changes it.
  const look = JSON.parse(fs.readFileSync(new URL('../config/look/base.json', import.meta.url), 'utf8'));
  const osd = JSON.stringify(look).match(/"color":"(0x[0-9A-Fa-f]{6})"/);
  assert.ok(osd, 'the look config no longer names a stamp colour');
  assert.equal(osd[1].toUpperCase(), '0XF6EAC8', 'the burnt-in date stamp changed colour; the interface work must not touch the tape');
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

/**
 * AND WHEN EVERY SHAPE COSTS THE SAME, THE PARENTHETICAL GOES (2026-09-05).
 *
 * The surcharge came off the day the price caught up with Wan's per-second
 * billing, so `creditsByAspect` now holds one number three times. The suffix is
 * computed rather than written, so it does not become wrong -- it becomes
 * "4 tapes at 480p (4 in 16:9 or 9:16)", which is true, and noise. A
 * parenthetical exists to name an EXCEPTION; one that restates the number it
 * follows teaches a reader that the shapes differ, which is the opposite of
 * what it now says.
 *
 * THE TEST ABOVE IS DELIBERATELY LEFT ALONE and this one sits beside it. That
 * one drives a fixture where the shapes DO differ and proves the exception is
 * still stated; together they pin the rule -- name the difference when there is
 * one, say nothing when there is not -- rather than either of today's numbers.
 * If a future supplier bills by pixels again, the first test is what proves the
 * copy comes back on its own.
 */
test('a rung says nothing about shape when every shape costs the same', () => {
  const plans = [{ id: 'free', label: 'Free', monthlyUSD: 0, creditsPerPeriod: 21 }];
  const resolutions = [
    { id: '480p', credits: 21, available: true,
      creditsByAspect: { '4:3': 21, '16:9': 21, '9:16': 21 } },
    { id: '720p', credits: 46, available: true,
      creditsByAspect: { '4:3': 46, '16:9': 46, '9:16': 46 } },
  ];
  const packs = [{ id: 'starter', label: 'Starter', priceUSD: 12, credits: 92, buyable: true }];

  const html = pricingPage({ plans, resolutions, packs, currentPlan: null });

  // PRESENT FIRST: a page that rendered no rungs satisfies every absence below.
  assert.match(html, /4 tapes at 480p/, 'the count is gone entirely');
  assert.match(html, /2 tapes at 720p/, 'the 720p count is gone entirely');

  assert.ok(!/in 16:9 or 9:16/.test(html),
    'the page still carves out the wide shapes when they cost exactly the same');

  // The page states each quality's price ONCE, in the comparison, and it is
  // read from the same map the counts above are floored off -- so a shape
  // priced differently one day moves the count and the quoted figure together.
  assert.match(html, /<th scope="row">Credits per tape<\/th>\s*<td>21<\/td>\s*<td class="lit">46<\/td>/,
    'the comparison row does not quote the price');
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
 * THE PRICING PAGE IN THE LIME WORLD (2026-09-06): three cards signed out --
 * Free, Starter, and Standard lifted and lime -- then one table comparing the
 * two qualities and one stating what comes back, and the landing's six
 * questions. The fixtures below are the shipped ladder -- one grant, two packs,
 * two sizes -- so a rule that reads right against them reads right in
 * production.
 *
 * FREE IS A CARD AGAIN, AND THAT IS NOT A REVERSAL OF 2026-09-04. It left the
 * row then because it sat at equal width beside two purchases with no price and
 * no button, and read as a purchase the visitor had somehow failed to make. It
 * has a price now -- the credit count -- and an action, Start free, which is
 * the thing a signed-out visitor has actually come to do. Signed in it is gone
 * entirely, because by then it is neither a choice nor news.
 */
// THE ROWS CARRY THEIR RASTERS, and that is what makes the absence assertion
// below mean anything. `resolutionRows` hands the page `width` and `height`
// straight off config/credits.json (640x480 and 1280x720 today), so a fixture
// without them lets "no raster reaches the page" pass against a page printing
// `undefinedxundefined` -- an absence measured where the value could never
// have been. Same shape as CLAUDE.md's own vacuous-absence rule.
const LADDER = Object.freeze({
  plans: [{ id: 'free', label: 'Free', monthlyUSD: 0, creditsPerPeriod: 21 }],
  resolutions: [
    { id: '480p', width: 640, height: 480, credits: 21, available: true,
      creditsByAspect: { '4:3': 21, '16:9': 28, '9:16': 28 } },
    { id: '720p', width: 1280, height: 720, credits: 46, available: true,
      creditsByAspect: { '4:3': 46, '16:9': 61, '9:16': 61 } },
  ],
  packs: [
    { id: 'starter', label: 'Starter', priceUSD: 12, credits: 92, buyable: true },
    { id: 'standard', label: 'Standard', priceUSD: 19, credits: 138, buyable: true },
  ],
  currentPlan: null,
});

test('the pricing page is three cards -- Free with a sign-up action, Starter, and Standard lifted, lime and recommended', () => {
  const html = pricingPage(LADDER);
  const { css } = createStylesheet({});
  const cards = html.match(/<section class="(?:card|lime) tier[^"]*"/g) ?? [];
  assert.equal(cards.length, 3, `three cards, found ${cards.length}: ${cards.join(' ')}`);
  assert.match(cards[0], /tier--free/, 'Free leads');
  assert.match(cards[1], /class="card tier tier--paid"/, 'Starter is a dark card');
  assert.match(cards[2], /class="lime tier tier--paid tier--lime"/, 'Standard is the lime card');

  const between = (a, b) => html.slice(html.indexOf(a), b ? html.indexOf(b) : undefined);
  const free = between('tier--free', 'tier--paid');
  assert.match(free, /<p class="price">21 credits<\/p>\s*<p class="per">when you sign up<\/p>/, 'the free figure is the credit count');
  assert.match(free, /<li>1 tape at 480p \(none in 16:9 or 9:16\)<\/li><li>any shape<\/li><li>no card<\/li>/, 'the free checks');
  assert.match(free, /<a class="record" href="\/signup">Start free<\/a>/, 'signed out, Free carries the sign-up action');

  const standard = between('tier--lime');
  assert.match(standard, /Standard/); assert.match(standard, /Recommended/, 'and it says so in words');
  assert.match(standard, /<p class="price">\$19<\/p>\s*<p class="per">138 credits<\/p>/, 'price first, credits beneath');
  assert.match(standard, /<li>6 tapes at 480p \(4 in 16:9 or 9:16\), or 3 tapes at 720p \(2 in 16:9 or 9:16\)<\/li><li>any shape<\/li><li>yours to download and keep<\/li><li>photograph deleted after 7 days<\/li>/);

  assert.match(css, /\.tiers\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, 'three equal columns');
  assert.match(css, /\.tier--lime\s*\{[^}]*transform:\s*translateY\(/, 'the recommended card is not lifted');
  assert.match(css, /\.tier \.price\s*\{[^}]*font-family:\s*var\(--display\)/, 'the figure is not in the display face');
  assert.doesNotMatch(css, /\.tier \.per\s*\{[^}]*var\(--(display|osd)\)/, 'the credit count is the label beneath the figure');
  // Tax sits beside each button, where the decision is made.
  for (const paid of html.split('tier--paid').slice(1)) assert.match(paid, /Tax is added at checkout\./, 'a paid card does not say tax is added');
  // The acknowledgement stays, word for word, on every paid form.
  assert.equal((html.match(/name="withdrawal"/g) ?? []).length, 2, 'every paid form carries the acknowledgement');

  // Signed in: the Free card is absent, the band carries the balance in tapes.
  const mine = pricingPage({ ...LADDER, account: { email: 'a@b.com' }, balance: { credits: 43 } });
  assert.equal((mine.match(/<section class="(?:card|lime) tier[^"]*"/g) ?? []).length, 2, 'signed in, the Free card is absent');
  assert.doesNotMatch(mine, /tier--free|Start free/);
  assert.match(mine, /class="tiers tiers--two"/, 'two cards share a two-column row');
  assert.match(mine, /<p class="balance">43 credits left\. Enough for 2 more tapes at 480p\.<\/p>/, 'the band does not carry the balance in tapes');
  assert.doesNotMatch(html, /credits left/, 'a stranger is told a balance');
});

test('the comparison has exactly two quality columns, its numbers come from the seam, and the recommended column is lit', () => {
  const facts = { frames: 375, fps: 25, shapes: ['4:3', '16:9', '9:16'], lufs: -27, deliveryShortEdge: 1080, photoDays: 7, jobDays: 30, qualities: ['480p', '720p'] };
  const html = pricingPage({ ...LADDER, facts });
  // THE HEADING NAMES THE TWO COLUMNS IT HEADS -- derived from the rows this
  // page was actually handed, never typed, so a fixture whose ids moved would
  // move the heading with them rather than leaving it stating a pair nobody
  // offered.
  assert.match(html, new RegExp(`<h2 class="compare-t">${LADDER.resolutions[0].id} against ${LADDER.resolutions[1].id}</h2>`),
    'the comparison heading must name the two columns it heads, not a typed pair');
  const q = /<table class="compare-q">([\s\S]*?)<\/table>/.exec(html);
  assert.ok(q, 'no quality comparison table');
  assert.equal((q[1].match(/<th scope="col"/g) ?? []).length, 2, 'exactly two quality columns');
  assert.match(q[1], /<th scope="col">480p<\/th>\s*<th scope="col" class="lit">720p<\/th>/, 'the second quality is the recommended column');
  assert.match(q[1], /<th scope="row">Credits per tape<\/th>\s*<td>21<\/td>\s*<td class="lit">46<\/td>/);
  assert.match(q[1], /<th scope="row">Source detail<\/th>\s*<td>480 lines<\/td>\s*<td class="lit">720 lines<\/td>/);
  assert.match(q[1], /<th scope="row">Delivered file<\/th>\s*<td>1080 lines/, 'the delivered file is stated from config');
  assert.match(q[1], /<th scope="row">The grain<\/th>\s*<td>identical, by design<\/td>\s*<td class="lit">identical, by design<\/td>/);
  assert.match(q[1], /<th scope="row">What a pack buys<\/th>\s*<td>Starter: 4 tapes · Standard: 6 tapes<\/td>\s*<td class="lit">Starter: 2 tapes · Standard: 3 tapes<\/td>/);
  assert.ok(!/1112|752x|960x720|640x480|1280x720/.test(html), 'a raster the model is ordered at, or delivers, must not be printed');
  const f = /<table class="compare-f">([\s\S]*?)<\/table>/.exec(html);
  assert.ok(f, 'no "what comes back" table');
  assert.match(f[1], /<th scope="row">Length<\/th>\s*<td>Fifteen seconds exactly, 375 frames<\/td>/);
  assert.match(f[1], /<th scope="row">Shapes<\/th>\s*<td>Three: 4:3, 16:9 and 9:16<\/td>/);
  assert.match(f[1], /<th scope="row">Sound<\/th>\s*<td>A mono tape bed at -27 LUFS<\/td>/);
  assert.match(f[1], /<th scope="row">Disclosure<\/th>\s*<td>Marked AI-generated in the file/);
  // The lime band opens the page and the FAQ closes it.
  assert.match(html, /<section class="lime pricing-hero">\s*<h1 class="pricing-t">Credits, not subscriptions\.<\/h1>/);
  assert.equal((html.match(/<details class="faq-row">/g) ?? []).length, 6, 'the same six questions as the landing');
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

test('the five credential pages are one card each, Google first, form only; the dialog backdrop is the ground from the token', () => {
  const pages = {
    login: loginPage({ csrf: 't' }),
    signup: signupPage({ csrf: 't', consentText: 'I am in this photo.' }),
    verify: verifyPage({ email: 'a@b.com', csrf: 't' }),
    reset: resetPage({ csrf: 't' }),
    'reset-complete': resetCompletePage({ email: 'a@b.com', csrf: 't' }),
  };
  for (const [name, html] of Object.entries(pages)) {
    assert.equal((html.match(/<section class="panel">/g) ?? []).length, 1, `${name} is not exactly one card`);
    assert.match(html, /class="wrap wrap--narrow"/, `${name} is not in the narrow column`);
    assert.ok(!/class="nav"/.test(html), `${name} carries the app nav -- the auth five are form only (§48)`);
    assert.match(html, /<h1 class="headline">/, `${name} has no heading`);
    assert.match(html, /class="record"/, `${name} has no lime button`);
  }
  for (const name of ['login', 'signup']) {
    const html = pages[name];
    const google = html.indexOf('action="/auth/google"');
    const password = html.indexOf(name === 'login' ? 'action="/login"' : 'action="/signup"');
    assert.ok(google > -1, `${name}: no Google door`);
    assert.ok(password > google, `${name}: Google is not the first door`);
  }
  const { css } = createStylesheet({});
  const backdrop = /\.signin::backdrop\s*\{([^}]*)\}/.exec(css);
  assert.ok(backdrop, 'no dialog backdrop rule');
  assert.match(backdrop[1], /background:\s*color-mix\(in srgb, var\(--ground\) 72%, transparent\)/, 'the backdrop is a literal copy of the ground rather than the token');
  assert.ok(!/rgba\(/.test(backdrop[1]), 'the backdrop still carries the ground as bytes');
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

/**
 * THE SHELF PAGE FROM THE DESIGN PROTOTYPE (2026-09-04): a label, the heading
 * at page-title size, two sentences, and the tiles on the paper -- no panel.
 */
test('the shelf page leads with its label and heading on the paper, not in a panel', () => {
  const tapes = [{
    jobId: '20260814-101010-aaaaaa', status: 'done', place: 'The car park, at dusk',
    posterUrl: '/p', href: '/j/20260814-101010-aaaaaa/result',
    videoUrl: '/api/jobs/20260814-101010-aaaaaa/video', aspect: '4:3',
  }];
  const html = videosPage({ tapes, retentionDays: 30 });
  const { css } = createStylesheet({});

  assert.match(html, /<main class="videos">\s*<p class="eyebrow eyebrow--osd">The shelf<\/p>\s*<h1 class="headline">My videos<\/h1>/,
    'the page does not open on its label and heading');
  assert.match(html, /Finished tapes are kept for 30 days\. Download the ones you want to keep\./,
    'the retention window is read in, not asserted');
  assert.ok(!/panel--archive/.test(html), 'the shelf is still boxed in the home page archive panel');
  assert.match(html, /class="shelf"/, 'the tiles are gone');

  assert.match(css, /\.videos \.headline\s*\{[^}]*font-size:\s*var\(--t-7\)/, 'the heading is the page-title size');
  assert.match(css, /\.videos \.shelf\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(10rem,\s*1fr\)\)/,
    'the tiles sit on the prototype grid');

  // A page that was not told the window promises nothing about it.
  const unknown = videosPage({ tapes });
  assert.ok(!/kept for/.test(unknown), 'a window was invented');
});

/**
 * THE ACCOUNT PAGE FROM THE DESIGN PROTOTYPE (2026-09-04): the address as the
 * heading, a sentence saying what the credits are good for, the two sections
 * under readout labels, and the deletion in a narrow column.
 */
test('the account page says what the credits are good for, in tapes', () => {
  const account = { email: 'paul@example.com', accountId: 'x', plan: 'free' };
  const cheapest = { id: '480p', credits: 21 };

  const two = accountPage({ account, balance: { credits: 43, planId: 'free' }, csrf: 'c', cheapest });
  assert.match(two, /<h1 class="headline">paul@example\.com<\/h1>/, 'the heading is the address');
  assert.match(two, /43 credits left\. Enough for 2 more tapes at 480p\./, 'the count is translated into tapes');

  const one = accountPage({ account, balance: { credits: 21, planId: 'free' }, csrf: 'c', cheapest });
  assert.match(one, /21 credits left\. Enough for 1 more tape at 480p\./, 'singular');

  const none = accountPage({ account, balance: { credits: 5, planId: 'free' }, csrf: 'c', cheapest });
  assert.match(none, /5 credits left\. Not enough for another tape at 480p\./, 'and the honest zero');

  // With no price to measure against, the count stands alone rather than
  // being measured against a guess.
  const bare = accountPage({ account, balance: { credits: 43, planId: 'free' }, csrf: 'c' });
  assert.match(bare, /43 credits left\./);
  assert.ok(!/more tape/.test(bare), 'a tape count was invented with no price to derive it from');
});

test('the account page sections carry readout labels, and the deletion sits in a narrow column', () => {
  const account = { email: 'paul@example.com', accountId: 'x', plan: 'free' };
  const html = accountPage({ account, balance: { credits: 43, planId: 'free' }, csrf: 'c' });
  const { css } = createStylesheet({});

  assert.match(html, /<h2 class="subhead subhead--osd">Your data<\/h2>/, 'the data section has no readout label');
  assert.match(html, /<h2 class="subhead subhead--osd">Delete this account<\/h2>/, 'the deletion section has no readout label');
  assert.match(html, /<a class="go" href="\/api\/account\/export" download>Export your data<\/a>/,
    'the export is not the go button');
  assert.match(html, /<div class="account-danger">\s*<form method="post" action="\/account\/delete">/,
    'the deletion form is not in its own column');
  assert.match(css, /\.account-danger\s*\{[^}]*max-width:\s*22rem/, 'the column is not narrow');
  const label = /\.subhead--osd\s*\{([^}]*)\}/.exec(css);
  assert.ok(label, 'no .subhead--osd rule');
  assert.doesNotMatch(label[1], /var\(--osd\)/, 'the readout face belongs to the tape; a section label is the Inter label role');
  assert.match(label[1], /font-weight:\s*600/, 'the label role is Inter 600');
});

test('the one-way door is an outlined button in ink, and the account heading is the address in the body face', () => {
  // THE DELETE BUTTON WAS LIME. `.record--danger` was written into the markup
  // on 2026-08-29 and no rule ever named it, so the cascade gave it .record's
  // lime -- "go" -- on the one control whose whole meaning is the opposite.
  // There is no alarm red in this world (DESIGN.md rule 2), so danger is weight
  // and words: the same outlined card every other secondary control is, its
  // label in ink, and the sentence above it saying there is no undo.
  const { css } = createStylesheet({});
  const danger = /\.record--danger\s*\{([^}]*)\}/.exec(css);
  assert.ok(danger, 'no .record--danger rule -- the class is in the markup and styled by nothing, so the button is lime');
  assert.match(danger[1], /background:\s*var\(--card\)/, 'the one-way door is not on the card plane');
  assert.match(danger[1], /border:\s*1px solid var\(--line\)/, 'the one-way door is not outlined');
  assert.match(danger[1], /color:\s*var\(--ink\)/, 'the one-way door is not written in ink');
  assert.ok(!/var\(--(rec|lime|accent|accent-bright)\)/.test(danger[1]), 'the one-way door is lime or red -- it is neither go nor the record light');
  const hover = /\.record--danger:hover\s*\{([^}]*)\}/.exec(css);
  assert.ok(hover, 'no hover for the one-way door');
  assert.ok(!/var\(--(lime|accent|accent-bright)\)/.test(hover[1]), 'hovering the one-way door turns it lime');
  // The address is data.
  const head = /\.account \.headline\s*\{([^}]*)\}/.exec(css);
  assert.ok(head, 'no .account .headline rule');
  assert.match(head[1], /font-family:\s*var\(--sans\)/, 'an email address is set in the poster face');
  assert.match(head[1], /text-transform:\s*none/, 'an email address is uppercased, which makes it a different string');
  assert.match(head[1], /overflow-wrap:\s*anywhere/, 'a long address cannot break');
  // And the page still says what it said.
  const html = accountPage({ account: { email: 'paul@example.com' }, balance: { credits: 43 }, csrf: 't', cheapest: { id: '480p', credits: 21 } });
  assert.match(html, /<h1 class="headline">paul@example\.com<\/h1>/, 'the heading is no longer the address');
  assert.match(html, /<button type="submit" class="record record--danger">Delete my account<\/button>/, 'the one-way door lost its class or its words');
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
    .filter((r) => /color:\s*var\((--faint|--ink-soft|--on-lime-soft)\)/.test(r))
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

/**
 * ONBOARDING HAS NO GROUND (2026-09-07), AND THIS IS THE CHEAP HALF OF PROVING
 * IT -- THE LOAD-BEARING CHECK IS IN browser-smoke.test.js, WHICH MEASURES
 * EVERY WORD AGAINST THE FLAT GROUND WITH A REAL LAYOUT ENGINE.
 *
 * The first test is what is left of the old ground check, now that there is no
 * ground: proof the photograph, the scrim and the lit layer are gone from the
 * markup, and that the helper which used to build them is gone from the module
 * rather than left dormant. The second ties the band's scrim solver to the ink
 * the band actually paints, and refuses the PAGE's dim tier anywhere inside
 * `.band` -- the successor to the plate rule this world no longer has. Refused
 * there since 2026-09-07 is every tier but the two the solver protects:
 * `--ink-soft` and `--faint`, the page's tiers measured against a flat ground
 * and never against a picture, and `--on-image-soft` too, which sat outside
 * the solve and measured 1.57:1 over the Tokyo neon.
 */
test('the onboarding page is a card on the ground, with no photograph behind it', async () => {
  // §63 put a place photograph behind this page so the cream did not begin
  // until the work started. There is no cream now: the ground is every page's
  // ground (spec §6), and a photograph behind a four-second consent form is
  // the one photograph left behind text that is not the landing's band. The
  // band keeps the mechanism -- .bgs, .bg, .scrim, the generated layers -- and
  // this page keeps none of it.
  const html = onboardingPage({ account: { email: 'a@b.com', consent: null }, consentText: 'I confirm.', csrf: 't' });
  assert.ok(!/has-ground/.test(html), 'onboarding still claims a ground');
  assert.ok(!/class="bgs"/.test(html), 'onboarding still emits background layers');
  assert.ok(!/class="scrim"/.test(html), 'onboarding still emits a scrim');
  assert.ok(!/bg--lit/.test(html), 'onboarding still lights a layer');
  assert.ok(!/<video/.test(html), 'onboarding ships a video it has no script to drive');
  assert.match(html, /<section class="panel">/, 'the consent card is gone');
  assert.match(html, /Agree and continue/, 'the consent form is gone');
  assert.match(html, /class="wrap wrap--narrow"/, 'the narrow column is gone');
  // The helper is deleted, not left dormant: a function that emits a ground
  // nobody renders is the next person's "why is this here".
  const views = await import('../scripts/web/views.mjs');
  assert.equal(views.singlePlaceGround, undefined, 'singlePlaceGround is still exported -- delete it');
  const { css } = createStylesheet(FOCUS_MENU);
  assert.ok(!/has-ground/.test(css), 'the sheet still carries rules for a ground no page has');
  assert.ok(!/\.bg--lit/.test(css), 'the sheet still lights a layer by class; the band lights by radio');
  assert.match(css, /\.band \.bgs\s*\{/, "the band's ground is what the shared layers are still for, and it is gone");
});

test("the band's scrim is solved for the ink the band paints, and no dim tier sits over its photograph", () => {
  // THE SOLVER PROTECTED A COLOUR NOBODY PAINTS. scrimOpacity() finds, per
  // place, the least scrim that lets the body text clear 8:1 over that
  // place's loop -- and it solved for the cream world's bone, a value the
  // dead-values test forbids in the sheet and that survived only because it
  // was written as bytes in JS. The only text over a scrim is the band's, in
  // --on-image. Tying the constant to the token means the two cannot drift.
  const { css } = createStylesheet(FOCUS_MENU);
  const onImage = /--on-image:\s*#([0-9A-Fa-f]{6})/.exec(css);
  assert.ok(onImage, 'no --on-image literal in the sheet');
  const bytes = [0, 2, 4].map((i) => parseInt(onImage[1].slice(i, i + 2), 16));
  assert.deepEqual(SCRIM_INK, bytes, 'the scrim solver protects a colour the band does not paint');
  // And the chosen option is lime -- a slightly darker ink than --on-image --
  // so the solve holds for it as well; the two together are exactly the set
  // the sweep below allows inside the band.
  const lime = /--lime:\s*#([0-9A-Fa-f]{6})/.exec(css);
  assert.ok(lime, 'no --lime literal in the sheet');
  assert.deepEqual(SCRIM_ACCENT_INK, [0, 2, 4].map((i) => parseInt(lime[1].slice(i, i + 2), 16)), 'the scrim solver protects an accent the band does not paint');
  assert.match(css, /--on-image-accent:\s*var\(--lime\)/, 'struck-on-an-image is no longer lime, so the solver protects the wrong accent');
  // THE SUCCESSOR TO §63C's PLATE RULE. That rule said: on a page sitting on a
  // photograph, the dim tier does not appear without a plate under it. The
  // plate went with the cream; the band has no plate; so the rule becomes: in
  // the band, every word is the ink the solver protects -- `--on-image`, or
  // lime when it is chosen. `--ink-soft` and `--faint` are the PAGE's tiers,
  // measured against a flat ground and meaningless over a picture; and
  // `--on-image-soft` is refused too since 2026-09-07: it sat outside the solve
  // ("solving for it would drag every place above 0.59") and the pixels said
  // what that costs -- the hint measured 1.57:1 over the Tokyo neon. A tier the
  // solver does not cover is the hole, not an allowance.
  const bandRules = [...css.matchAll(/\n(\.band[^{}]*)\{([^}]*)\}/g)];
  assert.ok(bandRules.length >= 4, `the band has ${bandRules.length} rules -- the probe is not reading it`);
  for (const [, sel, body] of bandRules) {
    const color = /(^|;|\s)color:\s*([^;]+);/.exec(body);
    if (!color) continue;
    assert.match(color[2], /^var\(--on-image(-accent)?\)$/, `"${sel.trim()}" paints ${color[2].trim()} over the photograph -- only the ink the scrim is solved for goes there`);
  }
});

/** WCAG contrast on two [r,g,b] triples, unrounded, so a solve that lands
 *  exactly on its target is not pushed under it by rounding to a hex. */
function ratioOf(a, b) {
  const lum = ([r, g, b2]) => {
    const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b2);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("the band's scrim is painted from the stops the solver models, and the paint covers less than the layer says", () => {
  // THE SOLVER USED TO SOLVE FOR A FLAT ALPHA THE PAINT NEVER DELIVERED.
  // Measured 2026-09-07 (DESIGN.md, Text on a photograph): the scrim is a
  // linear gradient whose weakest stop is 0.74 stacked on a radial one whose
  // weakest is 0.20, and the layer's own opacity multiplies both -- so the
  // alpha that lands is the layer opacity times the gradients' covering
  // power, never the layer opacity itself. The stops now live in one place,
  // the sheet is built from them, and the solver reads the same constants.
  const { css } = createStylesheet(FOCUS_MENU);
  const scrim = /\n\.scrim\s*\{([^}]*)\}/.exec(css);
  assert.ok(scrim, 'no .scrim rule in the sheet');
  const painted = /background:\s*([^;]+);/.exec(scrim[1]);
  assert.ok(painted, 'the scrim paints no background');
  const squash = (s) => s.replace(/\s+/g, ' ').trim();
  assert.equal(squash(painted[1]), squash(scrimBackground()),
    'the scrim the sheet paints is not the one the solver models -- the stops have two homes again');

  // The covering power at the two named weakest stops, derived by hand from
  // the constants rather than read off the function: at the top centre the
  // linear stop is 0.92 and the radial 0.20, so 1 - 0.08 x 0.80; at 34% down
  // the linear stop is 0.74 and the radial has climbed to 0.20 + 0.60 x
  // (0.34 / 0.70), so 1 - 0.26 x (1 - 0.4914).
  assert.deepEqual(SCRIM_PAINT.color, [11, 10, 9], 'the scrim colour moved');
  assert.ok(Math.abs(scrimCover(0.5, 0) - 0.936) < 0.002, `cover at the top centre is ${scrimCover(0.5, 0)}, not 0.936`);
  assert.ok(Math.abs(scrimCover(0.5, 0.34) - 0.8678) < 0.002, `cover at the weakest linear stop is ${scrimCover(0.5, 0.34)}, not 0.868`);
  // The minimum the solver protects is the minimum of that function, and it is
  // genuinely under 1: a model that said the paint covers what the layer says
  // would be the flat solve back under another name.
  let min = 1;
  for (let i = 0; i <= 100; i += 1) for (let j = 0; j <= 100; j += 1) min = Math.min(min, scrimCover(i / 100, j / 100));
  assert.ok(Math.abs(SCRIM_COVER_MIN - min) < 0.005, `SCRIM_COVER_MIN is ${SCRIM_COVER_MIN}; the sampled minimum of scrimCover is ${min}`);
  assert.ok(SCRIM_COVER_MIN < 0.9 && SCRIM_COVER_MIN > 0.8, `SCRIM_COVER_MIN is ${SCRIM_COVER_MIN}; the gradients as shipped cover about 0.87 at their weakest`);

  // A PLACE WITH NO MEASUREMENT GETS THE WHITE-PHOTOGRAPH ANSWER. §31's rule
  // for text on a photograph is to solve against a pure white picture; the
  // band's own default used to be a typed 0.5, which for the brightest place
  // sat UNDER its solved value. Now it is the solve for a loop that is white
  // on the mean and white at its highlight.
  const band = /\n\.band \.scrim\s*\{([^}]*)\}/.exec(css);
  assert.ok(band, 'the band has no scrim rule of its own');
  const fallback = /opacity:\s*([0-9.]+)/.exec(band[1]);
  assert.ok(fallback, 'the band scrim names no fallback opacity');
  assert.equal(Number(fallback[1]), scrimOpacity({ yavg: 255, yhigh: 255 }), 'the unmeasured fallback is a typed number, not the white-photograph solve');
});

test('every measured loop clears the floor through the paint: --on-image at 8:1 on the mean and 4.5:1 on the highlight', () => {
  // THE MEAN CANNOT SEE A NEON SIGN. Solved on mean luma alone, the three night
  // places sat at the 0.30 floor while their blurred highlights measured
  // 216-238 -- the same as every other loop's -- and a real browser read the
  // hint at 1.57:1 over Tokyo and the chosen option at 2.19:1 over Times
  // Square (2026-09-07). So the manifest carries a highlight beside the mean,
  // and the solve holds both: 8:1 on the mean, which is the reading the place
  // gets on the whole, and 4.5:1 on the highlight, which is the floor for the
  // brightest thing a stroke can sit beside. Both through the modelled cover,
  // so the number in the sheet is the number the paint delivers.
  const manifest = JSON.parse(fs.readFileSync(new URL('../assets/places/loops.json', import.meta.url), 'utf8'));
  const ids = Object.keys(manifest.loops);
  assert.ok(ids.length >= 5, `loops.json describes ${ids.length} loop(s) -- the shipped manifest is not being read`);
  const { css } = createStylesheet({ places: ids.map((id) => ({ id, label: id, timeOfDay: '' })), outfits: [] });

  const blend = (y, a) => SCRIM_PAINT.color.map((c) => y * (1 - a) + c * a);
  for (const id of ids) {
    const loop = manifest.loops[id];
    assert.ok(Number.isFinite(loop.yavg), `${id} carries no mean luma`);
    assert.ok(Number.isFinite(loop.yhigh), `${id} carries no highlight luma -- regenerate the manifest with node scripts/tapedeck/place-loops.mjs --measure`);
    assert.ok(loop.yhigh >= loop.yavg && loop.yhigh <= 255, `${id}'s highlight ${loop.yhigh} is not a luma above its mean ${loop.yavg}`);

    const o = scrimOpacity(loop);
    assert.ok(o >= 0.3 && o <= 1, `${id} solved to ${o}`);
    const eff = o * SCRIM_COVER_MIN;
    for (const [name, ink] of [['--on-image', SCRIM_INK], ['lime', SCRIM_ACCENT_INK]]) {
      const onMean = ratioOf(ink, blend(loop.yavg, eff));
      const onHigh = ratioOf(ink, blend(loop.yhigh, eff));
      assert.ok(onMean >= 8, `${id}: the layer at ${o} lands ${eff.toFixed(3)} through the paint and ${name} reads ${onMean.toFixed(2)}:1 on the mean, under 8:1`);
      assert.ok(onHigh >= 4.5, `${id}: the layer at ${o} lands ${eff.toFixed(3)} through the paint and ${name} reads ${onHigh.toFixed(2)}:1 on the highlight, under 4.5:1`);
    }

    // THE RULE KEYS ON THE RADIO ALONE. It used to hold on `.bgs.is-live`, so a
    // visitor with no loop -- no JavaScript, reduced motion, a metered
    // connection -- got the typed default instead. The still under each loop
    // is darker than the loop on the mean (measured 2026-09-07: the tape grade
    // lifts the black floor) and blurred three times as hard, so the loop's
    // solve covers it; and a rule that never keys on `is-showing` cannot
    // flinch on a click, which is the property the split protected.
    assert.match(css, new RegExp(`#pl-${id}:checked~\\.wrap \\.scrim\\{opacity:${String(o).replace('.', '\\.')};\\}`),
      `${id}'s scrim rule is not keyed on the radio alone at the solved ${o}`);
    assert.doesNotMatch(css, new RegExp(`#pl-${id}:checked~\\.wrap \\.bgs\\.is-(live|showing)~\\.scrim`),
      `${id}'s scrim still waits for the loop; the no-video visitor is left on the default`);
  }
});

test('nothing in the band is a ghost: the rail paints at full opacity and hierarchy is carried by colour and size', () => {
  // THE GHOST FLOOR WAS SOLVED ON THE FLAT GROUND AND APPLIED OVER A
  // PHOTOGRAPH. DESIGN.md's floor (0.5) is the least opacity at which --ink
  // clears 4.5:1 over --ground; the rail sits on a picture, where the same 0.5
  // measured 2.1-4.4:1 (2026-09-07). §63B's precedent for words on the band's
  // photograph is full opacity plus the shadow, with hierarchy by size and --
  // here -- by colour: the chosen option is lime, the rest are --on-image.
  // DESIGN.md already says a text option is not a ghost; this is the rail
  // catching up with the option cards.
  const { css } = createStylesheet(FOCUS_MENU);
  const lopt = /\n\.lopt\s*\{([^}]*)\}/.exec(css);
  assert.ok(lopt, 'no .lopt rule');
  assert.doesNotMatch(lopt[1], /opacity:/, 'the rail option is still a ghost');
  const hover = /\n\.lopt:hover\s*\{([^}]*)\}/.exec(css);
  if (hover) assert.doesNotMatch(hover[1], /opacity:/, 'hovering an option dims it -- opacity is not the hover cue over a picture');
  // No rule that dresses a word in the band may dim it. The ground's own
  // layers (.bg, .bgv, .scrim) are the exception by construction: they ARE
  // the opacity mechanism.
  for (const [, sel, body] of css.matchAll(/\n((?:\.band|\.lopt|#pl-[^{}]*\.lopt)[^{}]*)\{([^}]*)\}/g)) {
    if (/\.bg\b|\.bgv|\.scrim|\.bgs/.test(sel)) continue;
    const op = /opacity:\s*([^;]+);/.exec(body);
    if (op) assert.equal(op[1].trim(), '1', `"${sel.trim()}" sets opacity ${op[1].trim()} on a word over the photograph`);
  }
  // The hint is the ink the solver protects, demoted by size, not by tier.
  const hint = /\n\.band-hint\s*\{([^}]*)\}/.exec(css);
  assert.ok(hint, 'no .band-hint rule');
  assert.match(hint[1], /color:\s*var\(--on-image\);/, 'the hint is not in --on-image');
  assert.match(hint[1], /font-size:\s*var\(--t-1\)/, 'the hint lost the size that carries its hierarchy');
  // The chosen option is told apart by colour, never by being the only one lit.
  assert.match(css, /#pl-ostsee-strand:checked~\.wrap \.lopt--pl-ostsee-strand\{color:var\(--lime\);\}/, 'the chosen place is not lime, or is still being lifted out of a ghost that no longer exists');
});

test('an outfit is always checked on load, even if the named default leaves the menu', () => {
  // THE FALLBACK EXISTS SO THIS CANNOT SILENTLY REGRESS (2026-09-05).
  //
  // `DEFAULT_OUTFIT_ID` names a preset file, and a preset file is one `git rm`
  // away from not existing. If the id ever misses, the honest failure is for
  // some other card to take the job -- because the alternative is an outfit
  // group with nothing checked, which is exactly the state that made step 2 a
  // required choice with no default and answered a skipped step with a 400
  // after the upload was spent.
  //
  // The condition is asserted rather than the id: what matters is that exactly
  // one card is checked, not which one wins a fallback nobody should reach.
  const checked = (html) => [...html.matchAll(/id="of-([a-z0-9-]+)"[^>]*\bchecked\b/g)].map((m) => m[1]);

  const shipped = homePage({ ...FOCUS_MENU, consentText: 'I agree' });
  assert.deepEqual(checked(shipped), ['tshirt-jeans'], 'the named default is not the one selected');

  const withoutDefault = homePage({
    ...FOCUS_MENU,
    outfits: FOCUS_MENU.outfits.filter((o) => o.id !== 'tshirt-jeans'),
    consentText: 'I agree',
  });
  assert.equal(checked(withoutDefault).length, 1,
    'with the named default gone, step 2 opens with nothing chosen again');

  // An empty menu has nothing to check and must not invent one.
  const empty = homePage({ ...FOCUS_MENU, outfits: [], consentText: 'I agree' });
  assert.deepEqual(checked(empty), [], 'an empty menu checked a card that does not exist');
});

test("the wordmark's record light is still; only the status page's light blinks", () => {
  // THE OWNER'S CALL, 2026-09-07. The dot beside the wordmark had blinked on
  // every page since 2026-08-20, and on the lime world's near-black ground in
  // the poster face it stopped reading as a camcorder lamp and started reading
  // as a glitch -- to the person who built the product, which is the evidence.
  // On the web a blinking red dot beside a name means "live" or "unread".
  //
  // The dot stays: it is the one trace of the camcorder in the chrome and the
  // palette's one light. The BLINK moves to where recording is actually
  // happening -- the status page's phase row -- and by leaving the masthead it
  // means something there again. Both halves are asserted, so this cannot pass
  // against a sheet that simply stopped blinking everything.
  const { css } = createStylesheet(FOCUS_MENU);

  // Every rule whose selector reaches the wordmark's dot. `.rec` is the span's
  // only class, so a selector ending in `.rec` is the whole set -- including a
  // reduced-motion `animation: none`, which on an element that never animates
  // is a dead rule saying the thing used to move.
  const dotRules = [...css.matchAll(/(^|[\s,}])([^{}]*\.rec)\s*\{([^}]*)\}/g)]
    .map((m) => ({ selector: m[2].trim(), body: m[3] }));
  assert.ok(dotRules.length >= 1, 'no rule in the sheet styles the wordmark\'s record light');
  for (const { selector, body } of dotRules) {
    assert.ok(!/\banimation\b/.test(body),
      `"${selector}" still animates the wordmark's record light: ${body.trim()}`);
  }
  assert.ok(!/@keyframes\s+blink\b/.test(css),
    'the masthead blink keyframes are still in the sheet with nothing left to use them');

  // The half that keeps this honest: the status page's light still blinks.
  assert.match(css, /\.reclight \.dot\s*\{[^}]*animation:\s*tally\b/,
    "the status page's record light must still blink -- that is where the blink went");
});

test('the phase rows are outlined cards, titled in the display face, and the record light is red', () => {
  // A LIME REC LIGHT IS NOT A REC LIGHT (spec §2.1). The status page's light
  // took --accent when the accent was cathode orange and kept the name when
  // the accent became lime, so the one element the palette reserves red for
  // was the one element painted in the colour that means "chosen". The
  // wordmark's dot is --rec and still; this one is --rec and blinks.
  const { css } = createStylesheet({});
  const phase = /\n\.phase\s*\{([^}]*)\}/.exec(css);
  assert.ok(phase, 'no .phase rule');
  assert.match(phase[1], /background:\s*var\(--card\)/, 'a phase row is not on the card plane');
  assert.match(phase[1], /border:\s*1px solid var\(--line\)/, 'a phase row is not outlined');
  assert.match(phase[1], /border-radius:\s*var\(--r-sm\)/, 'a phase row does not take the small radius');
  const title = /\.phase-title\s*\{([^}]*)\}/.exec(css);
  assert.ok(title, 'no .phase-title rule');
  assert.match(title[1], /font-family:\s*var\(--display\)/, 'a card title is set in the body face');
  assert.match(title[1], /font-size:\s*var\(--d-3\)/, 'a card title is not at the card-title size');
  assert.match(title[1], /text-transform:\s*uppercase/, 'the display face is not uppercase');
  const light = /\n\.reclight\s*\{([^}]*)\}/.exec(css);
  assert.ok(light, 'no .reclight rule');
  assert.match(light[1], /color:\s*var\(--rec\)/, 'REC is not red');
  const dot = /\.reclight \.dot\s*\{([^}]*)\}/.exec(css);
  assert.ok(dot, 'no .reclight .dot rule');
  assert.match(dot[1], /background:\s*var\(--rec\)/, 'the lamp is not red');
  assert.match(dot[1], /animation:\s*tally/, 'the lamp stopped blinking -- it is the one thing on the site that may');
  for (const m of css.matchAll(/(\.reclight[^{}]*)\{([^}]*)\}/g)) {
    assert.ok(!/var\(--(accent|accent-deep|lime)\)/.test(m[2]), `"${m[1].trim()}" paints the record light in the accent`);
  }
  // AND THE SWEEP BELONGS ON THE WHOLE PAGE, NOT ON THE ONE ROW THAT WEARS RED.
  // Aimed at '.reclight' alone it could not see the word "Done" painted lime,
  // the done and skipped step marks, or the cassette label's date numeral --
  // four places where colour answered "what state is this?" three rows above a
  // form where the same colour answers "what have I chosen?". Lime is never a
  // label and never a numeral (DESIGN.md, Lime means chosen); a state is a word
  // in ink, and the one state that takes a colour takes red and blinks.
  for (const m of css.matchAll(/([^{}\n]*\.(?:phase|step|label)[^{}]*)\{([^}]*)\}/g)) {
    if (/:checked/.test(m[1])) continue;
    assert.ok(!/var\(--(accent|accent-deep|lime)\)/.test(m[2]),
      `"${m[1].trim()}" paints a state or a numeral in lime: ${m[2].trim()}`);
  }
  assert.match(css, /\.status \.headline\s*\{[^}]*font-size:\s*var\(--t-7\)/, 'the status heading is not at the page-title size');
  // The states must still be told apart without it: REC is red and blinks,
  // done and stopped are ink words each with a dot, and a phase still to come
  // is ghosted. Colour is not what carries this -- weight, a dot and the ghost.
  assert.match(css, /\.phase-done \.phase-state\s*\{[^}]*color:\s*var\(--ink\)/, 'the done phase lost its ink');
  assert.match(css, /\.phase-done \.phase-state \.dot\s*\{[^}]*display:\s*inline-block/, 'the done phase lost its dot');
  assert.match(css, /\.phase-stopped \.phase-state \.dot\s*\{[^}]*display:\s*inline-block/, 'the stopped phase lost its dot');
  assert.match(css, /\.phase-pending \.phase-title\s*\{[^}]*opacity:\s*var\(--ghost\)/, 'a phase still to come is not ghosted');
  // A DECLARATION NOTHING CAN PAINT IS A DECLARATION THAT LIES. The base dot is
  // display:none until a state class shows it, and all three that do set their
  // own background, so a fill on the base rule only ever documented a colour
  // the element never takes.
  const baseDot = /\.phase-state \.dot\s*\{([^}]*)\}/.exec(css);
  assert.ok(baseDot, 'no .phase-state .dot rule');
  assert.ok(!/background:/.test(baseDot[1]),
    `the base dot still declares a fill no state can show: ${baseDot[1].trim()}`);
});

test('the payoff page frames the tape in the card outline and heads it at the page-title size', () => {
  const { css } = createStylesheet({});
  const player = /\n\.player\s*\{([^}]*)\}/.exec(css);
  assert.ok(player, 'no .player rule');
  assert.match(player[1], /border:\s*1px solid var\(--line\)/, 'the tape is not in the card outline');
  assert.match(player[1], /border-radius:\s*var\(--r\)/, 'the tape does not take the card radius');
  // The colour behind the picture is the tape's own matte, not the interface's
  // card: PALETTE.ground is what the renderer mattes a 4:3 tape onto, and it
  // must stay whatever the interface is painted.
  assert.match(player[1], /background:\s*#0B0A09/i, "the player's ground is not the tape's matte");
  assert.match(css, /\.result-words \.headline\s*\{[^}]*font-size:\s*var\(--t-7\)/, 'the result heading is not at the page-title size');
});
