/**
 * The stylesheet, the deterministic place-card fallbacks, and byte-range file
 * serving for the video, the poster and the place photographs.
 *
 * WHY THE STYLESHEET IS BUILT RATHER THAN A CONSTANT. It used to be one frozen
 * string. The redesign needs a rule per place -- the card's background image,
 * the full-bleed background layer behind it, the `:checked` styling that makes
 * the selection visible -- and those rules are a function of the catalog, which
 * is loaded at server construction. The alternative is `style="..."` attributes
 * on every card, and that means putting `'unsafe-inline'` into `style-src`,
 * which is a real weakening of the CSP on a page that has just been handed a
 * photograph of somebody's face. Generating the rules into the one stylesheet
 * costs a function call at boot and keeps the CSP exactly as strict as it was.
 *
 * WHY THE PLACE IMAGE IS A BACKGROUND LAYER AND NOT AN `<img>`. `assets/places/`
 * is empty today and will fill up later. A missing `<img>` src draws a broken
 * icon; a missing background-image layer is simply not painted and the layer
 * underneath it -- the warm gradient derived from the place id -- shows through.
 * So the fallback is the same CSS declaration as the real thing, one property
 * with two layers, and the day the real photographs land nothing changes but the
 * bytes on disk.
 *
 * WHY RANGE REQUESTS ARE IMPLEMENTED AND NOT SKIPPED. `<video>` in Safari will
 * not play a source that answers a range request with 200 and the whole file;
 * iOS specifically requires 206. Since the deliverable is a portrait video meant
 * to be watched on a phone, "it works everywhere except the platform it was
 * designed for" is the failure this thirty lines prevents.
 *
 * WHY THE FONT IS SERVED FROM `assets/fonts/`. `tape-osd.ttf` is VT323 under the
 * SIL OFL 1.1 and the licence is committed beside it, which permits bundling and
 * redistribution inside a product. It is already the font the date stamp is
 * burned in with, so the page and the video are lettered the same -- and the
 * alternative, a webfont CDN, is a third-party request on a page that has just
 * been handed a photograph of somebody's face.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// the palette, written down once
// ---------------------------------------------------------------------------

/**
 * Exported so a test can assert the ground is the delivery surround colour
 * rather than trusting a hex string copied between two files.
 *
 * `#0B0A09` is not decoration. It is the colour the finished video is matted
 * onto (`config/render.json`), and it is not pure black there for a reason that
 * applies just as hard here: `#000` makes an image read as a sticker on a void,
 * and on an OLED phone the surround vanishes so the 4:3 framing looks like a
 * cropping accident rather than a choice. The page is the same object as the
 * thing it hands you.
 */
export const PALETTE = Object.freeze({
  ground: '#0B0A09',
  // FILM YELLOW, NOT ANTIQUE GOLD. Raised 2026-08-21 from `#C8A15A`, which was
  // a muted brass and the reason the page read as tasteful-but-flat: every
  // token in this object sat inside one 28-degree hue band, so there was no
  // colour contrast anywhere on the page to adjust. `#FFB700` is the yellow of
  // a Kodak box, and it is period-correct rather than a departure -- the film
  // and tape packaging of the era this product evokes was genuinely loud.
  accent: '#FFB700',
  accentBright: '#FFD152',
  accentDeep: '#B37F00',
  ink: '#F2EDE4',
  muted: '#A9A093',
  faint: '#6E655A',
  alarm: '#E03B2F',
});

// ---------------------------------------------------------------------------
// deterministic place gradients
// ---------------------------------------------------------------------------

/** FNV-1a. Small, stable across machines and versions, and -- unlike
 *  `String.prototype.hashCode` habits -- actually written down here, so the
 *  gradient a place gets today is the gradient it gets in two years. */
function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The hue band each time of day sits in. Warm throughout, because the product
 * is warm throughout -- these are stand-ins for photographs of ordinary German
 * afternoons, not for a synthwave poster.
 */
const TIME_HUES = Object.freeze({
  'early morning': 42,
  morning: 46,
  midday: 197,
  afternoon: 186,
  'late afternoon': 86,
  dusk: 24,
  evening: 290,
  night: 290,
  indoor: 36,
});

/**
 * The hue each place owns, overriding its time of day.
 *
 * WHY THIS EXISTS AT ALL. `TIME_HUES` alone used to span 16 to 44 degrees --
 * every place on the menu inside a 28-degree wedge of warm brown, with `night`
 * the single exception. That is why the page read as flat: there was no colour
 * contrast anywhere to adjust, only more or less of the same brown, and no
 * amount of tuning the accent could have fixed it.
 *
 * WHY PER PLACE AND NOT PER TIME OF DAY. Two places can share a time of day and
 * look nothing alike -- a tiled kitchen at breakfast and an allotment garden in
 * late August are both "warm daylight" and belong at opposite ends of the
 * wheel. Time of day stays as the fallback, so a place added tomorrow without an
 * entry here still gets a sensible hue rather than a hole in the page.
 *
 * WHY THE COLOUR IS TIED TO THE PLACE AND NOT SPRINKLED ON THE LAYOUT. It makes
 * colour carry information: the whole page takes the selected place's hue, so
 * the background, the card, the carousel dot and the button all move together
 * and the app is a visibly different colour for every memory somebody picks.
 * Decoration would have been eight tints of the same thing.
 *
 * THESE ARE OBSERVATIONS, NOT PREFERENCES. Sodium lamps on an Autobahn at dusk
 * really are orange; a Hallenbad really is that chlorinated cyan; a television
 * in a dark living room really does throw violet. The palette is vivid because
 * the places are, which is what keeps it from reading as a theme applied over
 * the top.
 */
const PLACE_HUES = Object.freeze({
  'autobahn-raststaette': 24,      // sodium vapour
  'balkon-waesche': 197,           // midday sky
  'hallenbad-nachmittag': 176,     // chlorinated teal
  'kuechentisch-fruehstueck': 42,  // butter, early sun
  'ostsee-strand': 212,            // cold Baltic
  'plattenbau-treppenhaus': 154,   // institutional green
  'schrebergarten-august': 86,     // late-summer grass
  'wohnzimmer-abend': 290,         // the television
});

/**
 * A warm two-stop gradient keyed off the place id and its `timeOfDay`.
 *
 * Deterministic and total: an unknown `timeOfDay` still produces a gradient
 * rather than a hole in the page, because the point of this function is that the
 * page is finished on a fresh clone with `assets/places/` empty.
 *
 * @param {{id: string, timeOfDay?: string}} place
 * @returns {{from: string, to: string}} two `hsl()` strings
 */
export function placeGradient({ id, timeOfDay = '' }) {
  const key = String(id ?? '');
  const h = hash32(key);
  // The place's own hue wins; time of day is the fallback for a place added
  // without an entry, so the menu can grow without anybody editing this file.
  const base = PLACE_HUES[key] ?? TIME_HUES[String(timeOfDay).toLowerCase()] ?? 32;
  // +-5 degrees of jitter, down from +-9. The jitter existed to keep two
  // same-time places from being the same rectangle; now that the hues are
  // assigned per place they are already distinct, and a wide wobble only risks
  // dragging a colour off the one it was chosen to be.
  const hue = (base + ((h % 11) - 5) + 360) % 360;
  // SATURATION IS THE CHANGE THAT MAKES THIS READ AS COLOUR. It was 24-36%,
  // which on a near-black ground is barely a tint. 46-62% is vivid enough to
  // carry a full-bleed background and still sit under white text. Lightness
  // stays low on purpose -- these are backgrounds behind `#F2EDE4`, and the
  // contrast has to hold at the top of the gradient, not just the average.
  // UNSIGNED SHIFTS, AND THAT IS A BUG FIX RATHER THAN A STYLE CHOICE.
  // `hash32` returns `h >>> 0`, so any hash above 2^31 is a value whose SIGNED
  // right shift is negative -- and a negative left operand makes `%` return a
  // negative remainder, which subtracts from the floor instead of adding to it.
  // Measured: `balkon-waesche` came out at 37% saturation against a floor of
  // 46%. It has been quietly darkening whichever cards happened to hash high
  // since these gradients were written, with nothing to indicate it, because
  // "slightly muddier than intended" looks exactly like a design decision.
  const dark = base >= 250 || base <= 10;
  const sat = dark ? 40 + (h >>> 5) % 10 : 46 + (h >>> 5) % 16;
  const topL = dark ? 20 + (h >>> 11) % 5 : 27 + (h >>> 11) % 8;
  const botL = dark ? 8 + (h >>> 17) % 3 : 11 + (h >>> 17) % 5;
  return {
    from: `hsl(${hue} ${sat}% ${topL}%)`,
    to: `hsl(${(hue + 348) % 360} ${Math.max(10, sat - 8)}% ${botL}%)`,
  };
}

/** `schrebergarten-august` -> `pl-schrebergarten-august`. One function so the
 *  markup and the generated CSS cannot drift, which is the only way a generated
 *  stylesheet stays trustworthy. */
export const placeSlug = (id) => `pl-${id}`;
export const outfitSlug = (id) => `of-${id}`;
/** `480p` -> `q-480p`. The prefix is not decoration: `#480p` is not a valid CSS
 *  selector, because an identifier may not start with a digit. */
export const qualitySlug = (id) => `q-${id}`;
/** `4:3` is not a CSS identifier -- the colon would start a pseudo-class. */
export const aspectSlug = (id) => `a-${String(id).replace(':', 'x')}`;

/** A CSS identifier is not an HTML-escaping problem, it is a *syntax* problem:
 *  a `}` in a preset id would end the rule and everything after it is attacker
 *  markup inside a stylesheet. Preset ids come off filenames and are already
 *  constrained, so this is a belt on a brace -- and it is one line. */
const CSS_IDENT_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;

/**
 * The per-preset rules: the card image, the full-bleed background layer, and
 * everything `:checked` changes.
 *
 * @param {{places: Array<{id,timeOfDay}>, outfits: Array<{id}>}} menu
 */
export function presetCss({ places = [], outfits = [], resolutions = [], aspects = [] } = {}) {
  const out = [];
  for (const place of places) {
    if (!CSS_IDENT_RE.test(String(place.id))) continue;
    const slug = placeSlug(place.id);
    const { from, to } = placeGradient(place);
    // TWO LAYERS, IMAGE FIRST. When `/places/<id>.jpg` 404s the browser drops
    // that layer and paints the gradient; when it exists it covers it. Same
    // declaration, both futures.
    const layers = `url('/places/${place.id}.jpg'), linear-gradient(158deg, ${from} 0%, ${to} 100%)`;
    out.push(
      `.thumb--${slug}{background-image:${layers};}`,
      `.bg--${slug}{background-image:${layers};}`,
      `#${slug}:checked~.bgs .bg--${slug}{opacity:1;}`,
      // STRUCK, on the landing page: the same radio lights this place's veil,
      // its date read-out, and strikes its name forward out of the ghost stack.
      `#${slug}:checked~.wrap .veil--${slug}{opacity:1;filter:none;}`,
      `#${slug}:checked~.wrap .losd--${slug}{opacity:1;}`,
      `#${slug}:checked~.wrap .lopt--${slug}{opacity:1;color:var(--l-cathode);text-shadow:0 0 26px rgba(255,138,30,0.5);}`,
      `#${slug}:checked~.wrap .lopt--${slug} .lidx{color:var(--l-hot);}`,
      `#${slug}:focus-visible~.wrap .lopt--${slug}{opacity:1;text-decoration:underline;text-underline-offset:6px;text-decoration-color:var(--l-cathode);}`,
      `#${slug}:checked~.wrap .placecard--${slug}{opacity:1;transform:scale(1.03);}`,
      `#${slug}:checked~.wrap .placecard--${slug} .badge{opacity:1;}`,
      `#${slug}:checked~.wrap .dot--${slug}{background:var(--accent);}`,
    );
  }
  for (const outfit of outfits) {
    if (!CSS_IDENT_RE.test(String(outfit.id))) continue;
    const slug = outfitSlug(outfit.id);
    out.push(
      `#${slug}:checked~.wrap .lookcard--${slug}{opacity:1;}`,
      `#${slug}:checked~.wrap .lookcard--${slug} .name{color:var(--accent);text-shadow:0 0 22px rgba(255,138,30,0.45);}`,
      `#${slug}:checked~.wrap .lookcard--${slug} .tick{opacity:1;}`,
    );
  }
  // The quality row. A REAL choice, unlike the frame row above it -- so it gets
  // the same `:checked` treatment as a place card, and the estimated cost and
  // the "not enough credits" line switch with it, with no script involved.
  for (const res of resolutions) {
    if (!CSS_IDENT_RE.test(String(res.id))) continue;
    // A deferred resolution has no radio, so a `:checked` rule for it could
    // never match anything -- and emitting one would suggest it could.
    if (res.available === false) continue;
    const slug = qualitySlug(res.id);
    out.push(
      `#${slug}:checked~.wrap .qualitycard--${slug}{opacity:1;}`,
      `#${slug}:checked~.wrap .qualitycard--${slug} .name{color:var(--accent);text-shadow:0 0 22px rgba(255,138,30,0.45);}`,
      `#${slug}:checked~.wrap .qualitycard--${slug} .tick{opacity:1;}`,
      `#${slug}:checked~.wrap .cost--${slug}{display:inline;}`,
      `#${slug}:checked~.wrap .why--${slug}{display:block;}`,
    );
  }

  // The frame row. Same mechanism again -- and same rule about unavailable
  // options: a shape with no radio can have no `:checked` rule, because a rule
  // that can never match is a claim that it could.
  for (const a of aspects) {
    if (a.available === false) continue;
    const slug = aspectSlug(a.id);
    if (!CSS_IDENT_RE.test(slug)) continue;
    out.push(
      `#${slug}:checked~.wrap .framecard--${slug}{opacity:1;}`,
      `#${slug}:checked~.wrap .framecard--${slug} .ratio{color:var(--accent);text-shadow:0 0 22px rgba(255,138,30,0.45);}`,
      `#${slug}:checked~.wrap .framecard--${slug} .shape{border-color:var(--accent);}`,
      `#${slug}:checked~.wrap .framecard--${slug} .tick{opacity:1;}`,
    );
  }

  // The escape hatch at the end of the rail. Same mechanism, no image.
  out.push(
    `#pl-own:checked~.wrap .placecard--own{opacity:1;transform:scale(1.03);}`,
    `#pl-own:checked~.wrap .placecard--own .badge{opacity:1;}`,
    `#pl-own:checked~.wrap .ownplace{display:block;}`,
    `#pl-own:checked~.wrap .dot--own{background:var(--accent);}`,
  );
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// the stylesheet
// ---------------------------------------------------------------------------

/**
 * The base sheet. Everything that is not a function of the catalog.
 *
 * Type scale, written down so it can be argued with rather than guessed at:
 * step kicker 9px/0.20em uppercase, eyebrow 11px/0.22em uppercase, meta
 * 12px/0.14em, hint 13px, body 15px, section title 20px, wordmark 26px OSD,
 * headline 28px, page h1 clamp(29-40px), step numeral 44px OSD.
 *
 * The two OSD entries are the only large type on the signed-in page, and that
 * is deliberate: the numeral and the wordmark are the tape's own character
 * generator, so the biggest things on the page are spoken in the product's
 * voice. Amber is the eyebrow, the 24px rule, a selected border, and the step
 * numeral at accent-DEEP -- and nothing else. The product's thesis is that
 * ordinary and quiet is the point; a page that glows argues with it.
 */
export const BASE_CSS = `
@font-face {
  font-family: 'TapeOSD';
  src: url('/tape-osd.ttf') format('truetype');
  font-display: swap;
}

:root {
  /* ONE WORLD, ONE SOURCE OF TRUTH. The names below are the old frost-and-amber
     world's; their VALUES are now STRUCK (DESIGN.md). Kept as aliases rather
     than renamed across 300 rules, so there is exactly one place a colour is
     decided and no rule can drift back to the superseded palette. */
  --ground: var(--l-ground);
  --accent: var(--l-cathode);
  --accent-bright: var(--l-hot);
  --accent-deep: #B35F0B;
  --ink: var(--l-bone);
  --muted: #B9B3A9;
  --faint: var(--l-dim);
  --alarm: ${PALETTE.alarm};

  /* THE BOXES ARE GONE. This world forbids borders, rules and dividers; these
     four tokens existed only to draw them. --frost-lit survives as DEPTH -- the
     plane sitting nearer -- which is how grouping is carried now. */
  --frost: transparent;
  --frost-lit: rgba(12, 17, 27, 0.66);
  --hairline: transparent;
  --hairline-firm: transparent;
  --r: 20px;
  --r-sm: 12px;

  /* THE SPACING SCALE. Before this existed the signed-in page used 34 distinct
     rem values for margin, padding and gap -- 18 of them inside a 14.4px span,
     and seven stepping by 0.8px, which is neither perceptible nor a decision.
     Structural rhythm now comes from these eight steps and nothing else.
     A 4px base, not 8: the useful middle steps (12, 24) are exactly the ones an
     8-only scale misses, and this page needs both a tight interval and a
     generous one to tell a group boundary from a within-group one. */
  --s-1: 4px;
  --s-2: 8px;
  --s-3: 12px;
  --s-4: 16px;
  --s-5: 24px;
  --s-6: 32px;
  --s-7: 48px;
  --s-8: 64px;

  /* STRUCK -- the landing page's world. Two hues and their roles, nothing else
     gets a colour. Orange means exactly one thing: struck. See DESIGN.md. */
  --l-ground: #070A11;
  --l-lift: #0C111B;
  --l-cathode: #FF8A1E;
  --l-hot: #FFB25C;
  --l-bone: #EDE7DC;
  --l-dim: #8D8880;

  --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --osd: 'TapeOSD', ui-monospace, 'Courier New', monospace;
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  min-height: 100dvh;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.6;
  padding: 0 1.15rem 5rem;
}

/* --- the full-bleed background ----------------------------------------- */

/* Before a place is picked this is the warm near-black on its own. Each place
   layer sits on top at opacity 0 and is faded in by its own ":checked" rule, so
   the cross-fade is a CSS transition between two layers rather than a swap. */
.bgs { position: fixed; inset: 0; z-index: -2; background: var(--ground); overflow: hidden; }

.bg {
  position: absolute;
  inset: -6%;
  opacity: 0;
  background-size: cover;
  background-position: center;
  filter: blur(26px) saturate(0.72);
  transform: scale(1.08);
  transition: opacity 900ms ease;
  animation: drift 46s ease-in-out infinite alternate;
}

@keyframes drift {
  from { transform: scale(1.08) translate3d(-1.2%, -0.8%, 0); }
  to   { transform: scale(1.13) translate3d(1.2%, 0.9%, 0); }
}

/* The scrim. Heavy, and heavier at the top where the wordmark sits. */
.scrim {
  position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background:
    linear-gradient(180deg, rgba(11,10,9,0.92) 0%, rgba(11,10,9,0.74) 34%, rgba(11,10,9,0.86) 100%),
    radial-gradient(120% 70% at 50% 0%, rgba(11,10,9,0.20) 0%, rgba(11,10,9,0.80) 100%);
}

/* One static grain plate over everything, very low. The product is about
   texture; a flat page under it would be a different product's page. */
.grain {
  position: fixed; inset: 0; pointer-events: none; z-index: 9;
  opacity: 0.05;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* The radios live at the top of <body> so that ":checked ~ .bgs" and
   ":checked ~ .wrap" can reach the background and the cards. They are still
   part of the form, via the "form" attribute on each input. Hidden without
   "display:none", which would take them out of the tab order entirely.

   POSITION IS "fixed" AND THAT IS THE WHOLE BUG FIX, so do not "tidy" it back
   to "absolute". Clicking a <label for> focuses its input, and a browser
   scrolls a newly focused element into view. With "absolute" these inputs sit
   at the top of the DOCUMENT -- offset -1 -- so choosing 720p at step 4 threw
   the page back up to step 1, measured at 1641px, every single time. "fixed"
   positions them against the VIEWPORT instead, so they are always already in
   view and there is nothing to scroll to. Verified by measuring scrollY across
   a real click; see test/web-static.test.js.

   pointer-events:none keeps the 1px boxes from swallowing a click at the very
   top-left corner of the page. It does not affect keyboard focus, so the tab
   order this block exists to preserve is untouched. */
.statehook {
  position: fixed;
  top: 0; left: 0;
  pointer-events: none;
  width: 1px; height: 1px;
  margin: -1px; padding: 0; border: 0;
  clip-path: inset(50%);
  overflow: hidden;
  white-space: nowrap;
}
.statehook:focus-visible + .wrap .placecard,
.statehook:focus-visible ~ .wrap .placecard { outline: none; }

@media (prefers-reduced-motion: reduce) {
  .bg { animation: none; transition: none; transform: scale(1.08); }
  .rec { animation: none; }
  .seg-running { animation: none; }
}

.wrap { max-width: 44rem; margin: 0 auto; position: relative; z-index: 1; }
.wrap--narrow { max-width: 25rem; }

/* --- masthead ---------------------------------------------------------- */

.masthead {
  display: flex; align-items: center; justify-content: space-between;
  gap: 1rem; flex-wrap: wrap;
  padding: 2rem 0 2.25rem;
}

.wordmark {
  display: inline-flex; align-items: baseline; gap: 0.5rem;
  font-family: var(--osd);
  font-size: 26px;
  letter-spacing: 0.3em;
  color: var(--ink);
  text-decoration: none;
}

/* The way a camcorder tells you it is recording. It is the product's own
   typeface and its own idiom, which is a better logo than anything drawn. */
.rec {
  font-size: 0.62em;
  color: var(--alarm);
  animation: blink 1.6s steps(1, end) infinite;
  transform: translateY(-0.12em);
}

@keyframes blink { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0.12; } }

.nav { display: flex; align-items: center; gap: 1.1rem; }
.nav a, .nav button {
  background: none; border: 0; padding: 0; cursor: pointer;
  font: inherit; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--faint); text-decoration: none;
}
.nav a:hover, .nav button:hover { color: var(--accent); }
.nav-form { display: inline; margin: 0; }
.nav .who { color: var(--muted); text-transform: none; letter-spacing: 0; font-size: 13px; }

/* --- the credit meter -------------------------------------------------- */
/* A ring that empties as credits are spent. The FRACTION is carried on the
   <circle> as stroke-dasharray, a presentation attribute rather than an inline
   style, because style-src 'self' has no 'unsafe-inline' and must not gain
   one for a progress ring. See creditMeter() in views.mjs.

   Only the COLOURS live here; nothing in this block knows the percentage. */
.creds {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  text-transform: none;
  letter-spacing: 0;
  font-size: 13px;
  color: var(--muted);
}
.ring { width: 20px; height: 20px; flex: none; overflow: visible; }
.ring-track {
  fill: none;
  stroke: var(--hairline-firm);
  stroke-width: 2.5;
}
.ring-fill {
  fill: none;
  stroke: var(--l-dim);
  stroke-width: 2.5;
  stroke-linecap: round;
  /* Start the arc at twelve o'clock instead of three, so it drains the way a
     dial does. Rotating the geometry rather than the <svg> box keeps the
     element's layout square and its focus ring where it belongs. */
  transform: rotate(-90deg);
  transform-origin: 50% 50%;
  transition: stroke-dasharray 420ms cubic-bezier(0.4, 0, 0.2, 1);
}
.creds-n { font-variant-numeric: tabular-nums; color: var(--ink); }
.creds-u { color: var(--faint); font-size: 11px; }

/* Two of the cheapest tape or fewer: worth noticing, not yet a problem. */
.creds--low .ring-fill { stroke: var(--accent-bright); }
.creds--low .creds-n { color: var(--accent-bright); }

/* Cannot afford anything at all. A different fact from "low", and it gets a
   different colour, because a thin arc reads as "probably enough" and finding
   out otherwise costs a click and a refusal. */
.creds--spent .ring-fill { stroke: var(--alarm); }
.creds--spent .creds-n { color: var(--alarm); }
.creds--spent .ring-track { stroke: color-mix(in srgb, var(--alarm) 25%, transparent); }

@media (prefers-reduced-motion: reduce) {
  .ring-fill { transition: none; }
}

/* --- type -------------------------------------------------------------- */

.eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--l-dim);
  margin: 0 0 var(--s-2);
}

.headline { font-size: 28px; line-height: 1.15; letter-spacing: -0.015em; font-weight: 500; margin: 0 0 0.5rem; }
.title { font-size: 20px; line-height: 1.3; font-weight: 500; margin: 0 0 0.4rem; }
.sub { color: var(--muted); margin: 0 0 0.75rem; }
.hint { color: var(--faint); font-size: 13px; margin: 0 0 0.7rem; }
.lede { color: var(--muted); margin: 0 0 2rem; }

/* The 24px amber rule under a subtitle. Short on purpose -- it is punctuation,
   not a divider. */
.rule { display: none; }

.stamp {
  font-family: var(--osd);
  color: var(--accent-deep);
  letter-spacing: 0.16em;
  font-size: 14px;
  margin: 0 0 1rem;
}

.alert {
  border-left: 2px solid var(--alarm);
  background: rgba(194, 96, 63, 0.09);
  color: #E8BCAC;
  padding: 0.75rem 0.95rem;
  margin: 0 0 1.5rem;
  font-size: 14px;
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
}

.notice {
  border-left: 2px solid var(--accent-deep);
  background: rgba(200, 161, 90, 0.07);
  color: var(--muted);
  padding: 0.75rem 0.95rem;
  margin: 0 0 1.5rem;
  font-size: 14px;
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
}

/* --- the signed-in page's subject -------------------------------------- */

/* The page used to open on a paragraph. See the comment in views.mjs where the
   h1 is emitted for why that was a missing subject rather than a missing style.
   The measure is bounded and the wrap is balanced as a progressive heuristic --
   text-wrap:balance is ignored by browsers that do not have it and the natural
   wrap is fine, which is the only reason it is safe to use on shipped copy. */
.app-head { margin: 0 0 2.1rem; }

.app-h1 {
  font-size: clamp(29px, 4.4vw, 40px);
  line-height: 1.1;
  letter-spacing: -0.02em;
  font-weight: 500;
  max-inline-size: 18ch;
  text-wrap: balance;
  margin: 0 0 0.55rem;
}

/* 65-75 characters is the readable measure. The lede used to run the full
   44rem of the wrap. */
.app-head .lede { max-width: 66ch; margin: 0; }

/* --- frosted cards ----------------------------------------------------- */

/* THE WEIGHT ARC, AND WHY THERE IS ONE.
   Every panel used to be the same object: same frost, same 1px hairline, same
   20px radius, same 1.5rem padding, same width. Five slabs down the page with
   nothing to say which mattered. Now a panel's treatment states its job:

     --anchor   step 01, the photograph. The identity anchor; nothing on the
                page works without it. Firmest border, brightest surface, and
                on a wide screen it is a NARROWER column that stays in view
                while the choices scroll past it.
     --choice   steps 02 and 03. Menus of options. Deliberately the lightest
                things on the page -- no border box at all, just a hairline
                above -- so they read as a continuous flow of choosing rather
                than as two more cards competing with the anchor.
     --commit   step 04. Where credits are actually spent. Firm again, because
                the last panel before money leaves should not look like the
                two browsing panels above it.
     --archive  outside the form, and the full width of the wrap, so the
                boundary between "making one" and "the ones you made" is a
                change of shape and not just more vertical space.

   The choice panels keep a faint background rather than none: the place
   backdrop fades in behind this page, and body text sitting straight on a
   backlit gradient is a contrast bug waiting for the first bright place
   photograph to land in assets/places/. */
/* SEPARATION IS margin-bottom ONLY, never margin-top. Below 64rem the panels
   are block siblings and their margins COLLAPSE; at 64rem they become grid
   items and grid margins do not collapse. With margins on both sides the same
   declarations produced 25.6px of separation on a phone and 32px on a laptop,
   and 35.2 / 53.6 at the archive -- a rhythm change nobody chose. One
   direction makes the two cases arithmetically identical. */
.panel {
  background: var(--frost);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
  border: 0;
  border-radius: 0;
  padding: var(--s-5);
  margin: 0 0 var(--s-6);
}

.panel--anchor {
  /* DEPTH, NOT A BOX. The plane sits nearer here; there is no line around it. */
  background: var(--frost-lit);
}

/* THE OPEN PANEL, AND WHY ITS BORDER IS TRANSPARENT RATHER THAN ZERO. The
   boxed panels put their content at 1px + 24px = 25px from the panel edge;
   this one used border:0 with no horizontal padding and put its content at 0. So
   the four step numerals -- the element whose whole job is to read as one
   sequence -- sat at 71.4 / 46.4 / 46.4 / 71.4px, an in/out/out/in pattern,
   under a comment claiming the gutter lined them up. Keeping the 1px as
   TRANSPARENT rather than removing it makes both box models identical to the
   pixel while leaving this panel visually open. */
.panel--choice {
  background: rgba(26, 22, 19, 0.34);
  border: 0;
  border-radius: 0;
  padding: var(--s-5) var(--s-5) var(--s-2);
  margin: 0 0 var(--s-6);
}

/* THE COMMIT IS NOT THE ANCHOR. These two were byte-identical -- same frost
   tier, same border -- so the documented four-tier weight arc actually emitted
   three, and the panel holding six decisions and the money looked exactly like
   the one holding a single file input. The difference is density, which is the
   honest axis: this panel earns more room because it contains more. */
.panel--commit {
  background: var(--frost-lit);
  padding: var(--s-6) var(--s-5);
  /* The archive break is carried HERE, on the bottom edge, for the same reason
     every other separation is: a margin-top on the archive collapsed to 48px
     between block siblings and summed to 80px between grid items, which is the
     breakpoint rhythm shift this pass exists to remove. Measured both ways. */
  margin-bottom: var(--s-7);
}

/* The archive is not a fifth step, and the air that says so is on the commit's
   bottom edge -- see above. Nothing here. */
.panel--archive { margin-top: 0; }

/* --- the step header --------------------------------------------------- */

/* Two columns: the number in a fixed gutter, everything said about the step in
   the other. The gutter is what lines the four steps up as a sequence. */
.step-head {
  display: grid;
  grid-template-columns: 2.9rem minmax(0, 1fr);
  column-gap: 1rem;
  align-items: start;
  margin: 0 0 var(--s-5);
}

.step-say { min-width: 0; }

.stepno { margin: 0; text-align: right; }

.stepno-k {
  display: block;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--faint);
  margin: 0 0 0.15rem;
}

/* VT323, the same character generator the tape's own date stamp is drawn with.
   accent-deep rather than accent: the sheet's rule is that amber is the
   eyebrow, the rule and a selected border -- a 44px numeral in full #FFB700,
   five times down the page, would be the page glowing at somebody, which is
   the opposite of what this product is about. */
.stepno-n {
  display: block;
  font-family: var(--osd);
  font-size: 44px;
  line-height: 0.82;
  color: var(--accent-deep);
}

.stepno-n--mark { font-size: 26px; line-height: 1.4; color: var(--accent-deep); }

/* The subtitle is prose and takes the readable measure with it. */
.step-say .sub { max-width: 56ch; }

/* --- the signed-in page's layout --------------------------------------- */

/* WHY TWO COLUMNS, AND WHY ONLY HERE.
   The four panels were not merely styled alike, they were the same WIDTH --
   one 44rem column in a 1280px viewport, which is a phone layout centred on a
   desktop and is most of why the page read as templated. Above 64rem the form
   becomes a grid: the photograph on the left in a narrow sticky column, the
   three panels that follow it stacked in a wider one.

   Sticky is the point rather than a flourish. The photograph is the identity
   anchor for every choice made to the right of it, and it is the one input a
   visitor must supply; keeping it in view while they scroll the look and the
   place is the layout saying so.

   No JavaScript is involved in any of this, and none is added: it is CSS grid
   plus position:sticky. Below 64rem every panel is full width and the order in
   the DOM is already the order to read them in, so the whole block simply does
   not apply and nothing needs unwinding.

   64rem IS 1024px AND THAT IS THE WHOLE REASON IT IS 64 AND NOT 62. The first
   version broke at 62rem/992px, which is on nobody's device list and on no
   standard breakpoint scale -- it was picked because it was a bit wider than
   the content needed, which is how a codebase ends up with five breakpoints
   that each disagree with the others by twenty pixels. 1024 is a real tablet
   landscape width and a real testing stop. Verified at 320 / 375 / 414 / 768 /
   1024 / 1440: no horizontal overflow at any of them, single column below the
   break, two columns at and above it. If this needs to move, move it to
   another number on that list, not to whatever the content happens to want. */
@media (min-width: 64rem) {
  .page-home .wrap { max-width: 62rem; }

  .page-home #tape {
    display: grid;
    grid-template-columns: 20rem minmax(0, 1fr);
    column-gap: 2rem;
    align-items: start;
  }

  .page-home .panel--anchor {
    grid-column: 1;
    grid-row: 1 / span 3;
    position: sticky;
    top: 1.25rem;
  }

  .page-home .panel--choice,
  .page-home .panel--commit { grid-column: 2; }

  /* NOTE, so nobody "fixes" this later: step 02 keeps its top hairline, and it
     is load-bearing. It lands on exactly the same y as the anchor panel's top
     border, and because both boxes carry the same 1.5rem of padding under it,
     "Your photo" and "The look" sit on the same baseline across the gutter.
     That shared line is what makes two columns of different widths read as one
     layout. An earlier version of this block cancelled that border and padding
     on a ".panel--choice:first-of-type" selector, which never matched anything
     -- the first section of its type inside the form is the ANCHOR, not a
     choice -- and had it matched, it would have broken the very alignment it
     was written to create. */

  /* The dropzone no longer needs to be 15rem of empty box: in a 20rem column
     it is already the tallest single thing on the page. */
  .page-home .panel--anchor .drop { min-height: 11rem; }
}

/* A sticky element inside a scroll container taller than the viewport is fine,
   but if the anchor ever grows past the viewport height it must be able to
   scroll itself rather than trapping its own bottom edge off-screen. */
@media (min-width: 64rem) and (max-height: 40rem) {
  .page-home .panel--anchor { position: static; }
}

/* --- step 01, the dropzone --------------------------------------------- */

.drop {
  position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 0.5rem;
  min-height: 15rem;
  border: 1px dashed var(--hairline-firm);
  border-radius: var(--r-sm);
  background: rgba(11, 10, 9, 0.35);
  text-align: center;
  padding: 1.5rem;
  cursor: pointer;
  transition: border-color 160ms, background 160ms;
}
.drop:hover { border-color: var(--accent-deep); background: rgba(11, 10, 9, 0.5); }
.drop input[type="file"] { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.drop .plus { font-size: 20px; color: var(--ink); letter-spacing: 0.04em; }
.drop .say { color: var(--faint); font-size: 13px; max-width: 22rem; }
.drop .chosen-name { color: var(--ink); font-size: 13px; }

/* --- step 02, the look grid -------------------------------------------- */

.looks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.7rem; }

.lookcard {
  position: relative;
  display: block;
  padding: var(--s-3) 0;
  border: 0;
  border-radius: 0;
  background: none;
  opacity: 0.5;
  cursor: pointer;
  /* VALUES SNAP. Only the ghost's own legibility eases; the strike does not. */
  transition: opacity 160ms linear;
}
.lookcard:hover { opacity: 0.82; }
.lookcard .name { display: block; font-size: 15px; color: var(--ink); }
.lookcard .detail { display: block; font-size: 13px; color: var(--faint); margin-top: 0.15rem; }
/* The state marks carry NO TEXT IN THE MARKUP. They are hidden by opacity, and
   with the stylesheet switched off an opacity rule does nothing -- so a badge
   that spelled out "Selected" would appear on all nine cards at once and the
   page would read as though everything were chosen. The checked radio is what
   actually conveys the state to assistive technology; these two are decoration,
   so their text belongs in the decoration. */
.lookcard .tick {
  position: absolute; top: 0.7rem; right: 0.8rem;
  color: var(--accent); font-size: 11px; letter-spacing: 0.12em;
  opacity: 0; transition: opacity 140ms;
}
.lookcard .tick::before { content: "●"; }

@media (max-width: 30rem) { .looks { grid-template-columns: 1fr; } }

/* --- step 03, the place rail ------------------------------------------- */

.rail {
  display: flex; gap: var(--s-3);
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding: var(--s-1) var(--s-5) var(--s-4);
  margin: 0 calc(-1 * var(--s-5));
  scrollbar-width: thin;
}

/* LANDSCAPE, AND THE REASON IS THAT ONE FILE DOES TWO JOBS.
   "assets/places/<id>.jpg" is BOTH this card's thumbnail AND the full-bleed
   ".bg--<id>" layer behind the whole page, and both use "cover". The card was
   11x14rem -- portrait, roughly 4:5 -- against 16:9 source photographs, so
   "cover" threw away about two thirds of the width and centred on whatever
   happened to be in the middle. Measured on the real images: the Autobahn card
   lost its striped kiosk entirely and kept an empty picnic table, and the
   balcony lost the washing line that is the whole subject.
   16:9 cards show the photograph the place actually is, and the same file then
   fills a 16:9-ish viewport as a background with no crop fighting either. If
   these ever become portrait again, the images have to be re-shot to match --
   do not just change the numbers back. */
.placecard {
  position: relative;
  flex: 0 0 auto;
  width: 17rem; height: 9.5rem;
  scroll-snap-align: center;
  border: 0;
  border-radius: 0;
  overflow: hidden;
  cursor: pointer;
  /* A place card is a photograph, so it ghosts the way every other value does:
     unlit until struck. The photograph itself stays untinted -- this world does
     not colour the subject, it only decides which one is lit. */
  opacity: 0.5;
  transition: opacity 160ms linear, transform 220ms cubic-bezier(.2,.9,.3,1);
}
.placecard:hover { opacity: 0.82; }

.thumb { position: absolute; inset: 0; background-size: cover; background-position: center; }
.placecard--own .thumb { background: repeating-linear-gradient(135deg, #17130F 0 8px, #120F0C 8px 16px); }

.placecard .cap {
  position: absolute; inset: auto 0 0 0;
  padding: 2.5rem 0.75rem 0.7rem;
  background: linear-gradient(180deg, rgba(11,10,9,0) 0%, rgba(11,10,9,0.88) 62%);
}
.placecard .cap .name { display: block; font-size: 14px; color: var(--ink); line-height: 1.25; }
.placecard .cap .when { display: block; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--faint); margin-top: 0.25rem; }

.placecard .badge {
  position: absolute; top: 0.6rem; left: 0.6rem;
  font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--accent);
  background: none;
  border: 0;
  text-shadow: 0 0 14px rgba(255, 138, 30, 0.9), 0 1px 3px rgba(0, 0, 0, 0.9);
  padding: 0;
  opacity: 0;
  transition: opacity 160ms;
}
.placecard .badge::before { content: "● Selected"; }

.dots { display: flex; gap: 0.35rem; justify-content: center; margin: 0.2rem 0 0; }
.dot { width: 5px; height: 5px; border-radius: 50%; background: var(--hairline-firm); }

.ownplace { display: none; margin-top: 1rem; }

/* The signpost to the two escape hatches. See the comment in views.mjs: both
   the upload and the free-text box already existed and neither could be found,
   because one was behind a card at the far end of a scrolling rail and the
   other was inside a collapsed <details>.

   .linky is a <label for="pl-own"> dressed as a link. It has to LOOK
   clickable, because the whole failure being fixed here is a control nobody
   could tell was a control -- the same mistake the PAL chips made in the other
   direction, where something unclickable looked clickable. Underlined, in the
   accent colour, with a pointer cursor: three signals, because one is what the
   place cards had and it was not enough. */
.escape { margin: 0.9rem 0 0; text-align: center; }
.linky {
  color: var(--ink);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.linky:hover { color: var(--accent-bright); }
/* Keyboard parity: the radio is what actually receives focus, so the visible
   ring has to be drawn on the label that stands in for it. */
#pl-own:focus-visible ~ .wrap .linky { outline: 2px solid var(--accent); outline-offset: 2px; }

/* --- the free-text escape hatch ---------------------------------------- */

.aside { margin-top: 1.1rem; }
.aside summary { color: var(--faint); font-size: 13px; cursor: pointer; }
.aside summary:hover { color: var(--accent); }
.aside[open] summary { margin-bottom: 0.7rem; }

input[type="text"], input[type="email"], input[type="password"], select {
  width: 100%;
  background: rgba(11, 10, 9, 0.55);
  border: 1px solid var(--hairline-firm);
  border-radius: var(--r-sm);
  color: var(--ink);
  font: inherit;
  padding: 0.7rem 0.85rem;
}
input::placeholder { color: #4E463C; }
select { width: auto; min-width: 6rem; }

input[type="file"] { color: var(--muted); font-size: 13px; }
input[type="file"]::file-selector-button {
  background: rgba(40, 34, 27, 0.7);
  border: 1px solid var(--hairline-firm);
  border-radius: 999px;
  color: var(--ink);
  font: inherit; font-size: 13px;
  padding: 0.4rem 0.85rem;
  margin-right: 0.8rem;
  cursor: pointer;
}

:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.statehook:focus-visible ~ .wrap .placecard { outline: none; }

.field { margin: 0 0 var(--s-5); }
.field label { display: block; font-size: 13px; letter-spacing: 0; color: var(--ink); margin-bottom: var(--s-2); }

/* --- the settings panel ------------------------------------------------ */

.pills { display: flex; flex-wrap: wrap; gap: 0.45rem; margin: 0 0 0.6rem; }

/* FACTS, NOT CHOICES. Styled like the active state of a control on purpose --
   these are what the tape is -- but they are <span>s, not buttons, so there is
   nothing to click and nothing to change. A camcorder tape IS 4:3; offering
   16:9 would make this a filter instead of a tape, and the 375-frame contract
   is asserted by roughly two hundred tests. */
.pill {
  font-size: 12px; letter-spacing: 0.14em;
  color: var(--accent);
  background: rgba(200, 161, 90, 0.10);
  border: 1px solid var(--accent-deep);
  border-radius: 999px;
  padding: 0.3rem 0.8rem;
}

/* --- the frame row -------------------------------------------------------
   Three shapes, and the aspect ratio is drawn rather than only named: a little
   outline in the real proportion says "tall" or "wide" faster than the numbers
   do, and it costs one empty span. The 4:3 box is the reference the other two
   are read against, so all three are scaled to the same HEIGHT budget and only
   the width varies -- which is also, not coincidentally, exactly what the
   renderer does. */

.frames { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: 0 0 var(--s-2); }

.framecard {
  position: relative; display: flex; align-items: center; gap: 0.6rem;
  padding: var(--s-2) 0;
  border: 0;
  border-radius: 0;
  background: none;
  opacity: 0.5;
  cursor: pointer;
  /* VALUES SNAP. Only the ghost's own legibility eases; the strike does not. */
  transition: opacity 160ms linear;
}
.framecard:hover { opacity: 0.82; }
.framecard .ratio { font-family: var(--osd); font-size: 16px; letter-spacing: 0.08em; color: var(--ink); }
.framecard .detail { font-size: 12px; color: var(--faint); }
.framecard .tick { color: var(--accent); font-size: 11px; opacity: 0; transition: opacity 140ms; }
.framecard .tick::before { content: "●"; }

/* The drawn shape. Height is fixed at 18px and the width carries the ratio. */
.framecard .shape { display: block; border: 1px solid var(--accent-deep); height: 18px; flex: none; }
.framecard--a-4x3 .shape { width: 24px; }
.framecard--a-16x9 .shape { width: 32px; }
.framecard--a-9x16 .shape { width: 10px; }
.framecard--soon .shape { border-color: var(--hairline-firm); }

/* Same rule as the deferred quality card: a <span>, no radio behind it, so
   there is nothing to select and nothing that can be posted. */
.framecard--soon { cursor: default; opacity: 0.26; }
.framecard--soon:hover { opacity: 0.26; }
.framecard--soon .flag { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--l-dim); }

/* --- the quality row: a real choice, and it must not look like the pills --- */

.quality { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: var(--s-2); margin: 0 0 var(--s-2); }

.qualitycard {
  position: relative; display: block;
  padding: var(--s-3) 0;
  border: 0;
  border-radius: 0;
  background: none;
  opacity: 0.5;
  cursor: pointer;
  /* VALUES SNAP. Only the ghost's own legibility eases; the strike does not. */
  transition: opacity 160ms linear;
}
.qualitycard:hover { opacity: 0.82; }
.qualitycard .name { display: block; font-family: var(--osd); font-size: 17px; letter-spacing: 0.1em; color: var(--ink); }
.qualitycard .cr { display: block; font-size: 12px; letter-spacing: 0.14em; color: var(--l-dim); margin-top: 0.1rem; }
.qualitycard .detail { display: block; font-size: 13px; color: var(--faint); margin-top: 0.35rem; }
.qualitycard .flag { display: inline-block; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--l-dim); margin-top: 0.4rem; }
.qualitycard .tick { position: absolute; top: 0.7rem; right: 0.8rem; color: var(--accent); font-size: 11px; opacity: 0; transition: opacity 140ms; }
.qualitycard .tick::before { content: "●"; }

/* Unavailable options are a <span>, not a <label>: there is no radio behind
   them, so there is nothing to select and nothing that can be posted. */
/* A refused value stays dark rather than outlined: this world has no lines. */
.qualitycard--soon { cursor: default; opacity: 0.26; }
.qualitycard--soon:hover { opacity: 0.26; }

/* One cost per resolution, all hidden until the matching radio is checked. */
.cost { display: none; }
.why { display: none; color: var(--alarm); }

/* The group boundary the ladder was missing entirely. */
.panel--commit .hint { margin-bottom: var(--s-5); }

.facts { display: grid; grid-template-columns: 1fr auto; gap: var(--s-1) var(--s-4); margin: var(--s-5) 0; }
.facts dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.22em; color: var(--faint); }
.facts dd { margin: 0; font-family: var(--osd); font-size: 15px; letter-spacing: 0.12em; color: var(--ink); text-align: right; }

.record {
  display: block; width: 100%;
  margin-top: var(--s-5);
  background: var(--accent);
  border: 0; border-radius: 999px;
  color: #17120A;
  font: inherit; font-weight: 600; font-size: 15px;
  letter-spacing: 0.04em;
  padding: 0.85rem 1rem;
  cursor: pointer;
  text-align: center; text-decoration: none;
}
.record:hover { background: var(--accent-bright); }
.record:disabled { background: rgba(200, 161, 90, 0.18); color: var(--faint); cursor: not-allowed; }

.reason { text-align: center; color: var(--faint); font-size: 13px; margin: var(--s-3) 0 0; }

/* --- the shelf --------------------------------------------------------- */

.shelf { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 0.75rem; }

.tape {
  position: relative;
  display: block;
  aspect-ratio: 9 / 16;
  border: 1px solid var(--hairline);
  border-radius: var(--r-sm);
  overflow: hidden;
  background: rgba(11, 10, 9, 0.5);
  text-decoration: none;
  color: var(--ink);
}
.tape img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tape .cap {
  position: absolute; inset: auto 0 0 0;
  padding: 2rem 0.6rem 0.55rem;
  background: linear-gradient(180deg, rgba(11,10,9,0) 0%, rgba(11,10,9,0.9) 60%);
  font-size: 12px;
}
.tape .when { font-family: var(--osd); letter-spacing: 0.1em; color: var(--accent-deep); display: block; }
.tape .what { color: var(--muted); display: block; overflow-wrap: anywhere; }
.tape .state { position: absolute; top: 0.5rem; left: 0.5rem; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--faint); background: rgba(11,10,9,0.7); border-radius: 999px; padding: 0.15rem 0.5rem; }

.empty {
  border: 1px dashed var(--hairline-firm);
  border-radius: var(--r-sm);
  padding: 2.5rem 1.5rem;
  text-align: center;
  color: var(--faint);
}
.empty .title { color: var(--muted); margin-bottom: 0.3rem; }

/* --- progress ---------------------------------------------------------- */

.bar { display: flex; gap: 3px; list-style: none; padding: 0; margin: 0 0 0.6rem; }
.seg { flex: 1; height: 4px; border-radius: 1px; background: rgba(242,237,228,0.08); }
.seg-done { background: var(--accent-deep); }
.seg-skipped { background: transparent; box-shadow: inset 0 0 0 1px var(--accent-deep); }
.seg-running { background: var(--accent); animation: breathe 1.9s ease-in-out infinite; }
.seg-failed { background: var(--alarm); }

@keyframes breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

.counter { font-family: var(--osd); color: var(--faint); letter-spacing: 0.12em; font-size: 14px; margin: 0 0 1.75rem; }

.steps { list-style: none; padding: 0; margin: 0 0 1.75rem; }
.step {
  display: grid;
  grid-template-columns: 1rem 1fr;
  grid-template-areas: 'mark name' '. note';
  gap: 0 0.75rem;
  padding: 0.5rem 0;
  border-top: 1px solid rgba(242,237,228,0.06);
  color: var(--faint);
}
.step-mark { grid-area: mark; width: 6px; height: 6px; margin-top: 0.6rem; border-radius: 50%; background: rgba(242,237,228,0.12); }
.step-name { grid-area: name; font-size: 15px; }
.step-note { grid-area: note; font-size: 13px; color: #4E463C; }
.step-done { color: var(--muted); }
.step-done .step-mark { background: var(--accent-deep); }
.step-skipped .step-mark { box-shadow: inset 0 0 0 1px var(--accent-deep); background: transparent; }
.step-failed .step-mark { background: var(--alarm); }
.step-current { color: var(--ink); }
.step-current .step-mark { background: var(--accent); }
.step-current .step-note { color: var(--muted); }

.inputs { font-size: 14px; color: var(--muted); line-height: 1.9; }
.inputs .k { display: inline-block; min-width: 5rem; color: var(--faint); font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; }
.inputs .v { overflow-wrap: anywhere; }

/* --- contact sheet ----------------------------------------------------- */

.sheet { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.7rem; }
.still {
  position: relative; display: block; padding: 0;
  background: rgba(11,10,9,0.5);
  border: 1px solid var(--hairline);
  border-radius: var(--r-sm);
  cursor: pointer; overflow: hidden; line-height: 0;
}
.still img { width: 100%; height: auto; display: block; }
.still:hover { border-color: var(--accent-deep); }
.still.chosen { border-color: var(--accent); }
.still-n {
  position: absolute; left: 0.45rem; bottom: 0.35rem;
  font-family: var(--osd); color: var(--accent); font-size: 16px; line-height: 1;
  text-shadow: 0 1px 3px #000;
}

/* --- the video --------------------------------------------------------- */

.player {
  background: var(--ground);
  border: 1px solid var(--hairline);
  border-radius: var(--r-sm);
  overflow: hidden; line-height: 0;
}
.player video { width: 100%; height: auto; display: block; background: var(--ground); }
.meta { font-family: var(--osd); color: var(--faint); letter-spacing: 0.12em; font-size: 14px; margin: 0.8rem 0 1.5rem; }

/* --- buttons and links ------------------------------------------------- */

.go {
  display: inline-block;
  background: var(--accent); border: 0; border-radius: 999px;
  color: #17120A; font: inherit; font-weight: 600;
  padding: 0.7rem 1.4rem; cursor: pointer; text-align: center; text-decoration: none;
}
.go:hover { background: var(--accent-bright); }

.actions { margin-top: 1.75rem; display: flex; gap: 1.25rem; align-items: center; flex-wrap: wrap; }

.quiet {
  background: none; border: 0; color: var(--faint);
  font: inherit; font-size: 14px; padding: 0; cursor: pointer;
  text-decoration: underline; text-underline-offset: 3px;
  text-decoration-color: var(--hairline-firm);
}
.quiet:hover { color: var(--accent); }

/* --- consent ----------------------------------------------------------- */

/* 24x24 IS A FLOOR, NOT A PREFERENCE. WCAG 2.2 AA (target size, minimum) asks
   for 24x24 CSS px on a pointer target, and this box was 16x16 -- the smallest
   hit area in the product, on the one control that gates both signing up and
   spending credits, and the only element on the page that failed an AA
   criterion. The two ".linky" labels nearby are smaller still and are fine:
   they sit inline inside a sentence, which the criterion exempts. This does
   not, so it does not get the exemption.

   "align-items: flex-start" on the row plus a near-zero top margin is what
   keeps the taller box optically level with the first line of 13px consent
   text; the old 0.35rem was compensating for a box 8px shorter than this one,
   so it has to come down as the box goes up, or the tick floats below the
   sentence it belongs to. */
.check { display: flex; gap: 0.8rem; align-items: flex-start; cursor: pointer; }
.check input {
  margin-top: 0;
  accent-color: var(--accent);
  flex: 0 0 auto;
  width: 1.5rem;
  height: 1.5rem;
}
.consent-text span { display: block; color: var(--muted); font-size: 13px; }
.consent-text span + span { margin-top: 0.5rem; }

/* --- pricing ----------------------------------------------------------- */

.plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 0.9rem; }
.plan { position: relative; }
.plan--current { border-color: var(--accent); }
.plan .price { font-family: var(--osd); font-size: 30px; letter-spacing: 0.06em; color: var(--ink); margin: 0.3rem 0 0.1rem; }
.plan .per { color: var(--faint); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; }
.plan ul { list-style: none; padding: 0; margin: 1rem 0 0; color: var(--muted); font-size: 14px; }
.plan li { padding: 0.3rem 0; border-top: 1px solid rgba(242,237,228,0.06); }
.plan .mark {
  position: absolute; top: -0.65rem; left: 1.4rem;
  font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent);
  background: #14110E; border: 1px solid var(--accent-deep); border-radius: 999px; padding: 0.15rem 0.6rem;
}

/* --- foot -------------------------------------------------------------- */

/* --- the landing page: STRUCK ------------------------------------------ */
/* DESIGN.md owns this world. ITS ONE RULE: no borders, no rules, no dividers,
   anywhere inside the page. Grouping is depth, gauze density and space. The
   moment a line appears to separate two things, this stops being a cathode
   readout and becomes an ordinary dark UI with orange accents.
   The one permitted outline is :focus-visible, which is not decoration. */

.is-landing,
.page-home { background: var(--l-ground); }

/* TEXTURE BELONGS TO THE TAPE AND TO NOTHING ELSE. The page-wide grain plate is
   precisely the "AI tool with a filter over it" impression this product exists
   to avoid, so the landing page switches it off. */
.is-landing .grain,
.page-home .grain { display: none; }

.is-landing .wrap { max-width: 76rem; position: relative; z-index: 6; }

/* the anode gauze and its bloom, fixed, running past every edge */
.gauze {
  position: fixed; inset: 0; z-index: 5; pointer-events: none; opacity: 0.5;
  background-image:
    repeating-linear-gradient(0deg, rgba(190, 140, 80, 0.16) 0 1px, transparent 1px 4px),
    repeating-linear-gradient(90deg, rgba(190, 140, 80, 0.13) 0 1px, transparent 1px 4px);
}
.bloom {
  position: fixed; inset: 0; z-index: 4; pointer-events: none;
  background: radial-gradient(58% 42% at 50% 28%, rgba(255, 138, 30, 0.10), transparent 70%);
}

/* the hoisted landing state, same technique as the signed-in page: fixed, so
   focusing one can never scroll the document. */
.lstate { position: fixed; top: 0; left: 0; width: 1px; height: 1px; opacity: 0; margin: 0; pointer-events: none; }

.is-landing .masthead { padding: 2.5rem 0 0; }

.strike { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 4rem; align-items: center; padding: 3.5rem 0 6rem; }
@media (max-width: 60rem) { .strike { grid-template-columns: 1fr; gap: 2.5rem; padding: 2rem 0 3.5rem; } }

.hero-line {
  font-family: var(--osd);
  font-size: clamp(44px, 7.4vw, 104px);
  line-height: 0.94; letter-spacing: 0.01em; text-transform: uppercase;
  color: var(--l-bone); margin: 0 0 var(--s-5); max-inline-size: 14ch;
}
.hero-line .lit { color: var(--l-cathode); text-shadow: 0 0 24px rgba(255, 138, 30, 0.42); display: block; }
.hero-sub { color: #C8C2B8; margin: 0 0 var(--s-6); max-width: 42ch; font-size: 17px; line-height: 1.6; }

/* the ghost stack: every place present at once, one struck */
.stack { list-style: none; margin: 0 0 var(--s-5); padding: 0; display: flex; flex-direction: column; gap: var(--s-1); }
.stack li { margin: 0; min-width: 0; }
.lopt {
  display: block; cursor: pointer;
  font-family: var(--osd); font-size: clamp(20px, 2.4vw, 29px); line-height: 1.24;
  text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--l-bone); opacity: 0.5; padding: var(--s-1) 0;
}
/* GHOSTS SIT AT .5, NOT LOWER. The catalogued grammar for this world puts unlit
   options far dimmer; measured, that is about 1.4:1 and a control nobody can
   read. At .5 a ghost measures 4.55:1 and the unlit/struck distinction is
   carried by colour and halo instead of by illegibility. See DESIGN.md. */
.lopt .lidx { font-size: 0.5em; letter-spacing: 0.22em; color: var(--l-dim); margin-right: var(--s-3); vertical-align: 0.3em; }
.lopt:hover { opacity: 0.82; }
.strike-hint { font-family: var(--osd); font-size: 15px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--l-dim); margin: 0 0 var(--s-6); }

/* the veil stack: all photographs present, only the struck one lit */
.veils { position: relative; aspect-ratio: 4 / 3; background: var(--l-lift); }
.veil { position: absolute; inset: 0; opacity: 0; filter: blur(9px); transition: opacity 420ms linear, filter 420ms linear; }
.veil-img { position: absolute; inset: 0; background-size: cover; background-position: center; }
/* the gauze reaches across the photograph too -- it is one plane */
.veil::after { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(190, 140, 80, 0.2) 0 1px, transparent 1px 4px); }
.losd { position: absolute; right: 1rem; bottom: 0.9rem; z-index: 3; opacity: 0; font-family: var(--osd); font-size: 16px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--l-cathode); text-shadow: 0 0 12px rgba(255, 138, 30, 0.7); }

/* the act */
.hero-do { display: flex; gap: var(--s-6); align-items: baseline; flex-wrap: wrap; margin: 0; }
.is-landing .cta {
  display: inline-block; text-decoration: none;
  font-family: var(--osd); font-size: clamp(26px, 3.6vw, 44px); letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--l-cathode); text-shadow: 0 0 26px rgba(255, 138, 30, 0.34);
  background: none; border: 0; padding: 0; border-radius: 0;
}
.is-landing .cta:hover { color: var(--l-hot); text-shadow: 0 0 40px rgba(255, 178, 92, 0.6); }
.is-landing .cta--quiet { font-size: 15px; letter-spacing: 0.24em; color: var(--l-dim); text-shadow: none; }
.is-landing .cta--quiet:hover { color: var(--l-bone); text-shadow: none; }

/* the claim, deeper in the plane. three columns, no lines between them. */
.how { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4rem; padding: 0 0 6rem; }
@media (max-width: 60rem) { .how { grid-template-columns: 1fr; gap: 2rem; padding-bottom: 3.5rem; } }
.how-n { font-family: var(--osd); font-size: 15px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--l-cathode); margin: 0 0 var(--s-3); }
.how-t { font-family: var(--osd); font-size: 25px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--l-bone); margin: 0 0 var(--s-3); font-weight: 400; }
.how-d { font-size: 16px; line-height: 1.62; color: #B9B3A9; margin: 0; max-width: 34ch; }

.plain { padding: 0 0 5rem; }
.plain p { margin: 0; font-size: 17px; line-height: 1.68; color: #B9B3A9; max-width: 62ch; }

.is-landing .foot { border-top: 0; margin-top: 0; color: var(--l-dim); }
.is-landing .fine { color: var(--l-dim); font-size: 12px; }

.foot { margin-top: var(--s-8); padding-top: 0; border-top: 0; color: var(--l-dim); font-size: 13px; }
.foot p { margin: 0 0 0.4rem; }
.fine { color: #453E36; }

/* --- when there is no CSS at all --------------------------------------- */
/* (nothing to do here; the markup is ordered so the page reads top to bottom
   as headings, labels and controls with no CSS applied at all) */
`.trim();

/**
 * Build the served stylesheet and its ETag.
 *
 * The ETag is a hash of the content, so a redeploy that changed nothing does not
 * bust anybody's cache and one that changed a colour does -- the opposite of
 * what a version-number ETag gets you. It now covers the generated rules too,
 * which means adding a preset invalidates the sheet automatically.
 *
 * @param {{places?: Array, outfits?: Array}} [menu]
 */
export function createStylesheet(menu = {}) {
  const css = `${BASE_CSS}\n\n/* --- generated from the catalog --- */\n${presetCss(menu)}\n`;
  const etag = `"${createHash('sha256').update(css).digest('hex').slice(0, 16)}"`;
  return {
    css,
    etag,
    send(req, res) {
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag });
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES['.css'],
        'Content-Length': Buffer.byteLength(css),
        ETag: etag,
        'Cache-Control': 'public, max-age=300',
      });
      res.end(req.method === 'HEAD' ? undefined : css);
    },
  };
}

/** The catalog-free sheet, for callers that have no menu (the error page can be
 *  rendered before `loadCatalog` has run). */
const DEFAULT_SHEET = createStylesheet();

/** Back-compatible shim: `sendCss(req, res)` with no sheet serves the base one.
 *  The server passes its own built sheet. */
export function sendCss(req, res, sheet = DEFAULT_SHEET) {
  sheet.send(req, res);
}

export const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.ttf': 'font/ttf',
});

export function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Parse a `Range` header for a resource of `size` bytes.
 *
 * Deliberately single-range only. Multipart/byteranges is a spec corner no
 * browser's media element uses, and implementing it half-heartedly is worse than
 * declining it: returning 200 with the whole body is a legal answer to a range
 * request and every client copes.
 *
 * @returns {{start:number,end:number}|null|'unsatisfiable'}
 */
export function parseRange(header, size) {
  if (typeof header !== 'string') return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;

  let start;
  let end;
  if (rawStart === '') {
    // `bytes=-500` is the LAST 500 bytes, not the first. Getting this backwards
    // serves a valid 206 containing the wrong bytes, which no client reports.
    const wanted = Number(rawEnd);
    if (wanted === 0) return 'unsatisfiable';
    start = Math.max(0, size - wanted);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

/**
 * Stream a file, honouring `Range`.
 *
 * @param {object} opts
 * @param {string} opts.file        absolute path, already validated by the caller
 * @param {number} [opts.maxAge]    seconds; job output is immutable once written
 */
export function sendFile(req, res, { file, contentType, maxAge = 0, download = null, fsImpl = fs } = {}) {
  let stat;
  try {
    stat = fsImpl.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const type = contentType ?? contentTypeFor(file);
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': maxAge > 0 ? `private, max-age=${maxAge}` : 'no-cache',
  };
  if (download) headers['Content-Disposition'] = `attachment; filename="${download.replace(/["\\]/g, '')}"`;

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return true;
  }

  const range = parseRange(req.headers.range, stat.size);
  if (range === 'unsatisfiable') {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, 'Accept-Ranges': 'bytes' });
    res.end();
    return true;
  }

  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
      'Content-Length': length,
    });
    if (req.method === 'HEAD') { res.end(); return true; }
    fsImpl.createReadStream(file, { start: range.start, end: range.end }).pipe(res);
    return true;
  }

  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') { res.end(); return true; }
  fsImpl.createReadStream(file).pipe(res);
  return true;
}
