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
 * THESE ARE OBSERVATIONS, NOT PREFERENCES. The signboards over a Tokyo
 * crossing really are that red; the sea inside an Amalfi harbour wall really
 * is that turquoise; a television in a dark living room really does throw violet.
 * The palette is vivid because the places are, which is what keeps it from
 * reading as a theme applied over the top. (The sodium-vapour car park and the
 * chlorinated pool that used to anchor this argument were retired 2026-09-04.)
 */
const PLACE_HUES = Object.freeze({
  'amalfi-afternoon': 190,         // the sea inside a harbour wall
  'kuechentisch-fruehstueck': 42,  // butter, early sun
  'new-york-times-square': 48,     // cab yellow under the billboard glow
  'schrebergarten-august': 86,     // late-summer grass
  'space-centre': 222,             // a deep blue sky behind a white rocket
  'tokyo-night': 345,              // the red of the signboards over the crossing
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
/**
 * Mean luma of each place loop, written by `scripts/tapedeck/place-loops.mjs`.
 *
 * READ ONCE, AND MISSING IS A SUPPORTED STATE. On a fresh clone with no loops
 * cut there is no manifest, every place falls back to the full-strength scrim,
 * and the page is exactly what it was before the loops existed -- the same
 * property `assets/places/` already had for the photographs.
 */
const LOOP_LUMA = (() => {
  try {
    const file = new URL('../../assets/places/loops.json', import.meta.url);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed.loops === 'object' ? parsed.loops : {};
  } catch {
    return {};
  }
})();

/** Relative luminance, per WCAG. */
function relativeLuminance([r, g, b]) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Contrast ratio between two [r,g,b] triples. */
function contrast(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * How much scrim a place needs, derived from what its loop actually measures.
 *
 * THE SCRIM WAS ONE VALUE FOR EVERY PLACE AND THAT IS WHY THE LOCATION NEVER
 * READ. Tuned at 0.74-0.92 it is correct for a picture blurred to a wash and far
 * too heavy for one meant to be recognised. But the places are not equally
 * bright: measured, `wohnzimmer-abend` averages 49 and `ostsee-strand` 165, a
 * 3.4x spread. One number cannot serve both -- set it for the beach and the
 * living room is a black rectangle; set it for the living room and the beach
 * fights the text.
 *
 * SOLVED AGAINST THE TEXT RATHER THAN BY EYE. The bone body colour must clear
 * 8:1 over the composite of scrim-on-loop, so each place gets the least scrim
 * that buys that and no more.
 *
 * WHAT THIS DELIBERATELY DOES NOT GUARANTEE, said out loud because it is the
 * limitation somebody will otherwise discover as a bug: it is derived from MEAN
 * luma, so a dark loop with a bright window in it can still strand text locally.
 * The floor exists for that, and the soft label tier is NOT in this
 * calculation -- at 4.5:1 it would drag every place back above 0.59
 * and undo the whole thing. They earn their contrast from the panel plate they
 * sit on instead, which is what `.panel` is now for.
 */
const SCRIM_FLOOR = 0.30;
const SCRIM_BONE = [0xED, 0xE7, 0xDC];
const SCRIM_COLOR = [11, 10, 9];
const SCRIM_TARGET = 8;

export function scrimOpacity(yavg) {
  if (!Number.isFinite(yavg)) return null;
  for (let step = Math.round(SCRIM_FLOOR * 100); step <= 100; step += 1) {
    const s = step / 100;
    const over = SCRIM_COLOR.map((c) => yavg * (1 - s) + c * s);
    if (contrast(SCRIM_BONE, over) >= SCRIM_TARGET) return s;
  }
  return 1;
}

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
  // stays low on purpose -- these are backgrounds behind body ink, and the
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
 * The focus indicator for one hoisted radio, drawn on the label that stands in
 * for it.
 *
 * WHY THE INDICATOR IS NOT ON THE CONTROL. Every `.statehook` radio is 1x1px
 * with `clip-path: inset(50%)` -- deliberately, because that is what keeps it
 * in the tab order -- so the global `:focus-visible` outline matches, paints,
 * and is invisible. WCAG 2.4.7 is Level A, and 19 of the signed-in page's
 * keyboard stops had no visible focus at all until this existed.
 *
 * WHY IT ALSO LIFTS THE OPACITY. Every unchosen option is a ghost at 0.5, and
 * an outline inherits its element's opacity -- so the ring alone would be drawn
 * at half strength on exactly the controls that most need it. Full opacity
 * plus the ring measures 8.4:1 against the ground, where 1.4.11 asks 3:1.
 *
 * WHY ONE HELPER RATHER THAN FOUR LITERALS. A focus indicator that differs
 * between control families is worse than one that is merely plain, and four
 * copies of the same declaration is how that difference gets introduced.
 * `outline` is the first of the two borders DESIGN.md permits, and that entry
 * says it is never to be removed.
 *
 * @param {string} slug the radio's id
 * @param {string} kind the card class it labels, e.g. 'placecard'
 */
function focusRing(slug, kind) {
  // A RING ON A GHOST IS DRAWN AT THE GHOST'S OPACITY, because opacity applies
  // to an element's outline too -- so the indicator is at half strength on
  // exactly the controls that most need it. Lifting the element is part of the
  // focus treatment, not a side effect.
  //
  // A PLACE CARD KEEPS ITS GHOST ON '.thumb', so lifting the CARD would light
  // nothing. It needs both: the ring on the card, the lift on the picture.
  const lift = kind === 'placecard'
    ? `#${slug}:focus-visible~.wrap .${kind}--${slug} .thumb{opacity:1;}`
    : '';
  // THE RING IS INK, NOT THE ACCENT. A chosen card is lime, and a lime ring on
  // a lime card is invisible -- which is exactly where focus lands after a
  // selection.
  return `#${slug}:focus-visible~.wrap .${kind}--${slug}{opacity:1;outline:2px solid var(--ink);outline-offset:2px;}${lift}`;
}

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
      // THE GROUND IS INSIDE .wrap NOW, on both pages that have one. It used to
      // be a sibling of the radios on the landing (a viewport-fixed layer in
      // preBody); the landing's photograph is a BAND partway down the page as
      // of 2026-09-06, and a band lives in the document. Reaching it through
      // .wrap costs nothing on the signed-in page, whose ground is inside .wrap
      // as well -- one selector for both, rather than one each.
      `#${slug}:checked~.wrap .bgs .bg--${slug}{opacity:1;}`,
      // THE LIGHTER SCRIM IS GATED ON THE LOOP ACTUALLY PLAYING, and that is
      // the whole reason it is safe. "is-live" is set by the script only once a
      // video has genuinely reached its first frame, so a browser with no JavaScript,
      // a reader who asked for reduced motion, a metered connection or a
      // missing file all keep the full-strength scrim over the blurred still
      // -- which is the page exactly as it shipped. Nothing here can make the
      // no-video path worse, because nothing here applies to it.
      ...(scrimOpacity(LOOP_LUMA[place.id]?.yavg) === null ? [] : [
        `#${slug}:checked~.wrap .bgs.is-live~.scrim{opacity:${scrimOpacity(LOOP_LUMA[place.id].yavg)};}`,
      ]),
      // On the landing the same radio strikes this place's name forward out of
      // the ghost rail. The date read-out that used to lead this group is gone
      // with the element it lit: the OSD was pinned to the viewport over a
      // full-bleed photograph, and the photograph is a band in the document now
      // -- an overlay fixed to the corner of a page whose picture is a third of
      // the way down is a readout for whatever happens to be behind it.
      `#${slug}:checked~.wrap .lopt--${slug}{opacity:1;color:var(--lime);}`,
      `#${slug}:checked~.wrap .lopt--${slug} .lidx{color:var(--lime);}`,
      `#${slug}:focus-visible~.wrap .lopt--${slug}{opacity:1;text-decoration:underline;text-underline-offset:6px;text-decoration-color:var(--lime);}`,
      focusRing(slug, 'placecard'),
      // STRUCK LIGHTS THE PHOTOGRAPH. The ghost lives on '.thumb' rather than on
      // the card (see the rule for why -- the caption must stay readable while
      // unlit), so the rule that undoes the ghost has to name the same element.
      `#${slug}:checked~.wrap .placecard--${slug}{transform:scale(1.03);}`,
      `#${slug}:checked~.wrap .placecard--${slug} .thumb{opacity:1;}`,
      `#${slug}:checked~.wrap .placecard--${slug} .badge{opacity:1;}`,
      `#${slug}:checked~.wrap .dot--${slug}{background:var(--accent);}`,
    );
  }
  for (const outfit of outfits) {
    if (!CSS_IDENT_RE.test(String(outfit.id))) continue;
    const slug = outfitSlug(outfit.id);
    out.push(
      `#${slug}:checked~.wrap .lookcard--${slug}{opacity:1;}`,
      // NO HALO. A glow behind a lit value was a baked-in literal that no token
      // could have re-pointed, and a glow is a texture on a card. Chosen is
      // carried by the accent and by full opacity against the ghost, which is
      // DESIGN.md's own grammar.
      `#${slug}:checked~.wrap .lookcard--${slug} .name{color:var(--accent);}`,
      `#${slug}:checked~.wrap .lookcard--${slug} .tick{opacity:1;}`,
      focusRing(slug, 'lookcard'),
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
      `#${slug}:checked~.wrap .qualitycard--${slug} .name{color:var(--accent);}`,
      `#${slug}:checked~.wrap .qualitycard--${slug} .tick{opacity:1;}`,
      focusRing(slug, 'qualitycard'),
    );
    // THE COST AND THE WARNING NEED BOTH RADIOS, because the shape is part of
    // the price: a resolution label names the SHORT edge, so 16:9 and 9:16 are
    // 4/3 the pixels and 4/3 the charge. Keyed on quality alone, the page
    // quoted the 4:3 number for every shape while the ledger took the real one.
    //
    // The selector works because the radios are hoisted siblings of `.wrap` and
    // the quality ones are emitted BEFORE the aspect ones (views.mjs), so '~'
    // reaches from the first to the second and then to the wrap.
    for (const a of aspects) {
      if (a.available === false) continue;
      // The SLUG is what has to be a css identifier, not the id -- `4:3` has a
      // colon in it and `aspectSlug` is what removes it. Testing the raw id
      // here emitted no rules at all, silently, which is the same failure the
      // rule was written to prevent one layer up.
      const aslug = aspectSlug(a.id);
      if (!CSS_IDENT_RE.test(aslug)) continue;
      out.push(
        `#${slug}:checked~#${aslug}:checked~.wrap .cost--${slug}-${aslug}{display:inline;}`,
        `#${slug}:checked~#${aslug}:checked~.wrap .why--${slug}-${aslug}{display:block;}`,
      );
    }
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
      `#${slug}:checked~.wrap .framecard--${slug} .ratio{color:var(--accent);}`,
      `#${slug}:checked~.wrap .framecard--${slug} .shape{border-color:var(--accent);}`,
      `#${slug}:checked~.wrap .framecard--${slug} .tick{opacity:1;}`,
      // The quality cards quote the chosen SHAPE. One rule per shape rather
      // than per (tier, shape) pair, because a card already knows its own tier
      // -- three rules instead of nine, and the estimate line above keeps its
      // pair-keyed rules because it is one line that has to name both.
      `#${slug}:checked~.wrap .qualitycard .cr--${slug}{display:block;}`,
      focusRing(slug, 'framecard'),
    );
  }

  // The escape hatch at the FRONT of the rail. Same mechanism, no image.
  //
  // TWO CARDS SHARE THIS SLOT AND THE RADIO PICKS ONE (2026-08-31). See the
  // comment on the rail in views.mjs. own-pick is the way back from a preset;
  // own-add is the way in to the upload, and it is the one showing in the state
  // the page opens in. The scale/thumb/badge rules below are keyed on
  // .placecard--own, which BOTH carry, so they light whichever is present
  // without either card needing its own copy of the selected styling.
  out.push(
    `#pl-own:checked~.wrap .placecard--own-pick{display:none;}`,
    `#pl-own:checked~.wrap .placecard--own-add{display:block;}`,
    `#pl-own:checked~.wrap .placecard--own{transform:scale(1.03);}`,
    `#pl-own:checked~.wrap .placecard--own .thumb{opacity:1;}`,
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
/* THE WORLD'S TWO FACES, SELF-HOSTED, SUBSET TO LATIN. Fetched once from the
   Google Fonts repository (SIL OFL 1.1, licences beside the files), instanced
   and subset with fontTools, and served from assets/fonts/ under the same
   font-src self as the tape's own face. No network font, ever: the CSP does
   not change and a page that has been handed a photograph makes no third-party
   request. Anton is the display face and is never set below 18px. */
@font-face {
  font-family: 'Anton';
  src: url('/fonts/anton.woff2') format('woff2'), url('/fonts/anton.ttf') format('truetype');
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'Inter';
  src: url('/fonts/inter-400.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'Inter';
  src: url('/fonts/inter-600.woff2') format('woff2');
  font-weight: 600;
  font-display: swap;
}

:root {
  /* THE WORLD: A LIME POSTER ON A DARK GROUND (DESIGN.md, 2026-09-06). One
     ground, one accent, one light. Every ratio is measured with the WCAG
     formula and recomputed by test/web-static.test.js from the values below,
     so the table in DESIGN.md is an output and cannot drift. */
  --ground: #161618;       /* the page, everywhere                               */
  --card: #1F1F22;         /* an outlined card on the ground        1.10:1 surface */
  --lime: #D9FF00;         /* chosen, go, display    15.71:1 ground, 14.29:1 card  */
  --lime-hover: #E9FF5C;   /* the same lime pressed, on hover                     */
  --ink: #F2F2F0;          /* body prose             16.12:1 ground, 14.67:1 card  */
  --ink-soft: #A9A9A6;     /* labels, hints, fine     7.67:1 ground,  6.98:1 card  */
  --on-lime: #141414;      /* headings, buttons, body on lime      16.01:1 on lime */
  --on-lime-soft: #3A3A3A; /* fine print on lime                    9.89:1 on lime */
  /* THE RECORD LIGHT, and nothing else is red. The spec's floor value clears
     4.5:1 on the ground and not on a card (4.15:1), and the status page's
     phase rows are cards; this value clears both -- 5.01:1 and 4.55:1. */
  --rec: #E85545;
  --line: rgba(242, 242, 240, 0.14);  /* the 1px outline on cards and fields  */

  /* TEXT ON A PHOTOGRAPH IS STILL TEXT ON A PHOTOGRAPH. Measured in the paper
     world against a pure white picture under the caption scrim; the picture
     is the same picture, so these did not move. Struck on an image is lime. */
  --on-image: #FAF7F2;
  --on-image-soft: #CFC7BC;
  --on-image-accent: var(--lime);

  /* THE ALIASES THE RULES READ, RE-POINTED ONCE. Several hundred rules name
     these; none of them had to be rewritten to change world, and none may be
     rewritten back. --lift and --ink-strong are legacy names from the paper
     page that still describe what they point at (the nearer plane is the
     card; strong ink is ink) and are retired page by page as each page is
     rebuilt. The paper and oxide names are GONE, not aliased: a rule that
     says paper on a dark ground is a rule that has not been read. */
  --accent: var(--lime);
  --accent-bright: var(--lime-hover);
  --accent-deep: var(--lime);
  --muted: var(--ink);
  --faint: var(--ink-soft);
  --alarm: var(--ink);          /* there is no alarm red: weight and words */
  --frost: var(--card);
  --frost-lit: var(--card);
  --lift: var(--card);
  --ink-strong: var(--ink);
  --hairline: var(--line);
  --hairline-firm: var(--line);

  /* SHAPE. Cards and fields 10-12px, buttons 6-8px (DESIGN.md). */
  --r: 12px;
  --r-sm: 10px;
  --r-btn: 7px;

  /* THE GHOST FLOOR ON THIS GROUND. --ink at .5 over --ground measures
     4.83:1 and over --card 4.70:1; .48 is the least that clears the card and
     .5 is the round number above it. The rule is the paper world's: a ghost
     sits at the floor and no lower, and nothing inside a ghosted control is
     written in the soft tier. */
  --ghost: 0.5;
  --ghost-hover: 0.82;

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

  /* THE TYPE SCALE, and the reason it did not exist until 2026-08-31.
     The spacing scale above was built because the page used 34 distinct rem
     values and seven of them stepped by 0.8px. Type had exactly the same
     disease and nobody measured it: the sheet carried clamp(29,4.4vw,40),
     clamp(44,7.4vw,104), clamp(20,2.4vw,29), clamp(26,3.6vw,44), then bare
     15px, 25px and 16px. No ratio, no named steps, and no relationship between
     any two of them. Ordered spacing on unordered type is why the pages read
     as tidy rather than as composed.

     A MINOR THIRD, 1.2, ON A 16px BASE. The restrained ratio on purpose: a
     major third (1.25) compounds to 31px by the third step and starts shouting
     where this world whispers. 1.2 gives more usable middle steps, which is
     what an editorial page actually needs -- the same argument the 4px spacing
     base won on.

     THE BODY MOVES 15px -> 16px AND THAT IS A FIX, NOT A PREFERENCE. §6c of
     CLAUDE.md found it, named the consequence, and deliberately left it:
     "changing it reflows every page in the product. Typography, not layout --
     not done unasked." This is the pass where typography IS the subject. It
     also removes iOS input auto-zoom, which fires on any input below 16px and
     silently breaks every form on this site.

     Small steps are fixed and large steps are fluid, because only the large
     ones have anywhere to go on a phone. */
  /* ONE SIZE FOR EVERY LABEL, AND THIS IS THE WORST OF THE FOUR FINDINGS.
     The uppercase tracked label -- the eyebrow, the step key, the flag, the
     unit, the tick, the "not yet" -- is ONE role, and the sheet was setting it
     at 9px, 10px, 11px and 12px depending on which component you landed in.
     Four values for one job, none of them a decision, and the 9px one
     (.stepno-k) was the smallest type in the product. Uppercase and tracked
     reads larger than its px size, which is why nobody noticed and why the
     answer is one honest value rather than a bigger one. */
  --t-label: 12px;                      /* every uppercase tracked label      */
  --t-1: 13px;                          /* fine print, legal, captions        */
  --t-2: 16px;                          /* body prose -- the base             */
  --t-3: 19px;                          /* lede                               */
  --t-4: 23px;                          /* h3                                 */
  --t-5: clamp(23px, 2.2vw, 28px);      /* h2                                 */
  --t-6: clamp(28px, 3.2vw, 33px);      /* h1, interior pages                 */
  --t-7: clamp(33px, 4.4vw, 40px);      /* h1, the app page                   */
  --t-8: clamp(40px, 6vw, 48px);        /* display, sub-hero                  */
  --t-hero: clamp(48px, 8vw, 96px);     /* the landing hero, ONCE per site    */

  --t-mark: clamp(64px, 18vw, 240px);   /* the footer's giant word, once per site */

  /* THE DISPLAY LADDER IS SEPARATE, AND IT HAS TO BE. VT323 reads noticeably
     smaller than the system sans at the same pixel size -- it is a terminal
     face with a small x-height -- so putting both ladders on one set of tokens
     would make every readout look timid beside the prose next to it. Same 1.2
     ratio, shifted up a step. Uppercase with open tracking, per DESIGN.md. */
  --d-1: 15px;                          /* OSD labels, step numerals, hints   */
  --d-2: 18px;                          /* readouts in prose                  */
  --d-3: clamp(22px, 2.4vw, 26px);      /* card titles                        */
  --d-4: clamp(26px, 3.6vw, 32px);      /* section headings                   */

  /* THE THREE FACES. Anton for display, never below 18px; Inter for
     everything read; VT323 only where the interface depicts the tape. */
  --sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --display: 'Anton', Impact, 'Arial Narrow', sans-serif;
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
  font-size: var(--t-2);
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

/* THE SAME PICTURE, MOVING. One element for eight places -- the script swaps
   its source -- and it sits over the still it was cut from, so a loop that
   never arrives is invisible rather than a hole.

   IT IS BARELY BLURRED, AND THAT IS THE POINT OF THE WHOLE EXERCISE. The still
   underneath carries blur(26px), which is correct for a colour wash and is
   exactly what stops anybody recognising where they are. 3px is enough to keep
   text off the detail edges while the place stays a place. It does NOT drift:
   the loop already drifts, in ffmpeg, on a sine that returns to its origin, and
   a CSS animation on top would beat against it. */
.bgv {
  position: absolute;
  inset: -6%;
  width: 112%;
  height: 112%;
  object-fit: cover;
  opacity: 0;
  filter: blur(3px) saturate(0.86);
  transition: opacity 1200ms ease;
}
.bgs.is-showing .bgv { opacity: 1; }

/* ONE LAYER, LIT BY A CLASS INSTEAD OF BY A RADIO. The landing lights whichever
   background its CSS-only place radio selects; onboarding carries the same
   ground with no menu behind it, so the single layer says so itself. Same blur,
   same drift, same scrim over it -- only the switch differs. */
.bg--lit { opacity: 1; }

/* The scrim. Heavy, and heavier at the top where the wordmark sits. */
.scrim {
  position: fixed; inset: 0; z-index: -1; pointer-events: none;
  /* Matched to the video's own fade, so the ground and the picture over it
     arrive together instead of the scrim snapping off first. */
  transition: opacity 1200ms ease;
  background:
    linear-gradient(180deg, rgba(11,10,9,0.92) 0%, rgba(11,10,9,0.74) 34%, rgba(11,10,9,0.86) 100%),
    radial-gradient(120% 70% at 50% 0%, rgba(11,10,9,0.20) 0%, rgba(11,10,9,0.80) 100%);
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

@media (prefers-reduced-motion: reduce) {
  .bg { animation: none; transition: none; transform: scale(1.08); }
  .rec { animation: none; }
}

.wrap { max-width: 44rem; margin: 0 auto; position: relative; z-index: 1; }
.wrap--narrow { max-width: 25rem; }

/* --- masthead ---------------------------------------------------------- */

.masthead {
  display: flex; align-items: center; justify-content: space-between;
  gap: 1rem; flex-wrap: wrap;
  padding: 2rem 0 2.25rem;
}

/* THE WORDMARK IS THE WORD, SET IN THE DISPLAY FACE. It lays out the word and
   the record light beside it on one baseline; the dot is sized in em so it
   tracks the word rather than needing a number of its own. */
.wordmark {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  font-family: var(--display);
  font-size: var(--t-4);
  line-height: 1;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  color: var(--ink);
  text-decoration: none;
}
.wordmark .rec { display: inline-block; width: 0.32em; height: 0.32em; border-radius: 50%; background: var(--rec); }

/* THE MONOGRAM'S TWO RULES LIVED HERE AND WENT WITH IT ON 2026-08-28.
   One lifted it 3.37px so the two marks shared a baseline rather than a tear,
   and held it to 60% opacity; the other dropped that to 45% over a photograph,
   because at 60% the mark out-shouted the record light on seven of the eight
   place loops. Both were measurements rather than taste, and both are only
   worth re-deriving if the mark ever comes back.
   THE RULE THEY PROTECTED OUTLIVES THEM AND IS NOT ABOUT THE MONOGRAM: the
   record light is the one thing in this chrome wearing red, and it is a few
   pixels across. Anything larger painted in the same value stops being a
   record light and becomes a second accent. See DESIGN.md. */

/* The record light: a small dot beside the word, and the one piece of the
   tape's idiom allowed into the chrome. Animated from here rather than from a
   style attribute or block, because style-src self drops either one wherever
   it appears, which is silent and total. */
.rec { animation: blink 1.6s steps(1, end) infinite; }

/* IT PULSES, IT DOES NOT VANISH. An earlier standalone dot bottomed out at
   .12, which is right for a record light on its own: going fully dark IS the
   idiom. This one sits inside the lockup, and at .12 the mark reads as a
   rendering fault for half of every cycle. .45 keeps the rhythm and the mark. */
@keyframes blink { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0.45; } }

/* The wordmark is a picture, so its name lives in a span no one sees. Not
   display:none, which takes it from screen readers too. */
.vh {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap;
}

/* min-width: 0 IS NEEDED ON BOTH LEVELS OR IT IS NEEDED ON NEITHER. The nav is
   itself a flex item inside .masthead, and a flex item defaults to
   min-width: auto -- so without the 0 here the nav is handed its full content
   width, .who is never squeezed, and the ellipsis it was given below never
   fires. Measured with the fix on .who alone: still 44px of page overflow at
   375px. The chain has to give way at every link. */
/* IT WRAPS, BECAUSE AT 375px THERE IS NOTHING LEFT TO SHRINK (2026-08-31).
   Adding "My videos" put the row 61px over a 375px viewport, and the measured
   parts say why no amount of tightening fixes it: with a 58-character address
   the email is ALREADY at 0px -- it is the only item allowed to give way and it
   has given way completely -- leaving credits 75.4 + My videos 76.4 + Plans
   44.2 + Account 66 + Sign out 67.1 plus five 17.6px gaps, which is about 417px
   of controls. Six items do not fit on one phone line at any sane type size.
   Wrapping is the one answer that loses nothing: no control is hidden, no type
   shrinks, and §36B's guarantee -- that Sign out is never carried off the right
   edge -- is kept by taking a second line rather than by pushing something out
   of the frame. min-width: 0 stays: it is what lets the email ellipsise before
   the row is forced to wrap at all, so wider screens still get one line. */
.nav { display: flex; align-items: center; gap: 1.1rem; min-width: 0; }

/* AND IT WRAPS ONLY ON A PHONE. flex-wrap cannot be the default here: wrapping
   is decided BEFORE shrinking, so a wrapping row lets the 58-character address
   take its full natural width and pushes the links onto a second line at 1440px
   as readily as at 375px -- measured, two rows on a laptop, which is not a fix,
   it is a different bug. Below 30rem there is genuinely no single-line answer
   (see the arithmetic above), and above it the ellipsis has always been enough.
   30rem sits between two of the six widths this layout is tested at -- 414 and
   768 -- so no tested width lands on the boundary. */
@media (max-width: 30rem) {
  .nav { flex-wrap: wrap; gap: 0.5rem 1.1rem; }
}
.nav a, .nav button {
  background: none; border: 0; padding: 0; cursor: pointer;
  font: inherit; font-size: var(--t-label); font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--faint); text-decoration: none; flex: none;
}
.nav a:hover, .nav button:hover { color: var(--ink); }
/* A FLEX ITEM THAT WRAPS A CONTROL MUST NOT BRING ITS OWN STRUT. Sign out is a
   <button> in a <form> because signing out is a POST, so the item this row
   lays out is the FORM and not the button. 'display: inline' here was
   blockified by the flex container into 'display: block' -- a block box whose
   line box carries the inherited 16px strut while the button inside it is
   12px. Measured on /pricing at 1440px: the links were 19.19px tall, this form
   25.59px, and Sign out sat 1.8px BELOW Plans and Account. Small, and plainly
   visible on 12px uppercase type at 0.14em; the owner reported it on
   2026-08-31. As a flex container the form has no strut of its own and
   collapses to the button's height, so .nav's align-items centres a box that
   is finally the same size as its neighbours. Re-measured after: 0.00px of
   spread across all three controls. A browser test asserts it, because this
   is invisible to every markup test in the suite. */
.nav-form { display: flex; align-items: center; margin: 0; flex: none; }
/* THE EMAIL IS THE ONLY ITEM IN THIS ROW WHOSE WIDTH THE CUSTOMER CHOOSES, so
   it is the only one allowed to give way. A flex item defaults to
   min-width: auto and refuses to shrink below its text, so without the 0 here
   a long address widens the whole nav past the viewport and carries Sign out
   off the right-hand edge -- measured at 375px, an ordinary 33-character
   address put the only way out of the account outside the frame. Everything
   else in the row is a control and holds its size (flex: none above). */
.nav .who {
  color: var(--muted); text-transform: none; letter-spacing: 0; font-size: var(--t-1);
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

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
  font-size: var(--t-1);
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
  stroke: var(--faint);
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
.creds-u { color: var(--faint); font-size: var(--t-label); }

/* Two of the cheapest tape or fewer: worth noticing, not yet a problem. It
   takes plain ink rather than the accent, because low credits are a fact and
   the accent in this world means chosen or go. */
.creds--low .ring-fill { stroke: var(--ink); }
.creds--low .creds-n { color: var(--ink); }

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

/* The label role: the only uppercase body text in the world, and the one
   size every label takes. Inter 600, tracked, in the soft tier. */
.eyebrow {
  font-size: var(--t-label);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--faint);
  margin: 0 0 var(--s-2);
}

/* Headings are the display face, uppercase, tight, untracked. */
.headline { font-family: var(--display); font-size: var(--t-5); line-height: 0.92; letter-spacing: 0; text-transform: uppercase; font-weight: 400; margin: 0 0 var(--s-3); }
.title { font-family: var(--display); font-size: var(--t-4); line-height: 0.95; letter-spacing: 0; text-transform: uppercase; font-weight: 400; margin: 0 0 var(--s-2); }
/* MEASURED AT 82ch ON /privacy BEFORE THIS CAP, on the longest prose in the
   product. §6c adopted the 65-75ch band from the UX guideline set and moved the
   landing lede from 62ch to 66ch to satisfy it; the rule never reached ordinary
   body copy, so the legal pages -- the one place somebody actually reads several
   hundred words in a row -- were the worst offender. A cap only ever narrows,
   so this is safe on the pages where .sub already sits in a column. */
.sub { color: var(--muted); margin: 0 0 0.75rem; max-width: 66ch; }

/* THE LEGAL PAGES ARE THE ONLY LONG-FORM DOCUMENTS IN THIS PRODUCT, AND THEY
   WERE STRUCTURED LIKE A MARKETING PANEL. Their section headings were
   <p class="eyebrow"> -- 12px uppercase tracked labels -- so /privacy shipped
   SEVEN headings that were not headings and a document outline consisting of
   one h1. For a page whose whole job is to be read and understood, that is an
   accessibility defect before it is a design one: a screen reader got no
   structure for a privacy policy.
   They are h2 now, and they stop borrowing the eyebrow's voice: a label
   announces a field, a heading opens a section, and at 23px in sentence case
   this reads as the second one. The three page kickers that sit ABOVE the h1
   stay <p class="eyebrow"> -- an h2 before the h1 would be worse structure
   than none. */
.legal-h {
  font-family: var(--display);
  font-size: var(--t-4);
  text-transform: uppercase;
  letter-spacing: 0;
  font-weight: 400;
  color: var(--ink);
  margin: var(--s-7) 0 var(--s-3);
}
.hint { color: var(--faint); font-size: var(--t-1); margin: 0 0 0.7rem; }
.lede { color: var(--muted); margin: 0 0 2rem; }

.stamp {
  font-family: var(--osd);
  color: var(--ink-soft);
  letter-spacing: 0.16em;
  font-size: var(--t-1);
  margin: 0 0 1rem;
}

/* THE TWO BANNERS LOST THEIR 2px BARS, and that is the one rule of this world
   catching up with two elements that had been quietly breaking it.
 *
 * A 'border-left: 2px solid' is a rule. It is the exact device DESIGN.md
 * forbids -- a line drawn to separate the banner from the page -- and it
 * survived every previous pass because the border sweep can only see a LITERAL
 * colour in a border declaration, and these two were written against tokens.
 * On the near-black ground they were also dim enough to overlook. On paper an
 * oxide bar down the side of a banner is the loudest thing on the page.
 *
 * WHAT CARRIES THE DISTINCTION NOW THAT NEITHER A LINE NOR A SECOND HUE CAN.
 * There is no alarm red in this world -- red is the record light and nothing
 * else -- so an error is carried by WEIGHT and by WORDS: the alert is an
 * outlined card whose text is set in the label weight, and the notice is the
 * same card in ordinary prose. That survives greyscale, which two similar
 * reds never did. */
.alert {
  background: var(--card);
  color: var(--ink);
  font-weight: 600;
  border: 1px solid var(--line);
  padding: 0.75rem 0.95rem;
  margin: 0 0 1.5rem;
  font-size: var(--t-1);
  border-radius: var(--r-sm);
}

.notice {
  background: var(--lift);
  color: var(--faint);
  padding: 0.75rem 0.95rem;
  margin: 0 0 1.5rem;
  font-size: var(--t-1);
  border-radius: var(--r-sm);
}

/* --- the signed-in page's subject -------------------------------------- */

/* The page used to open on a paragraph. See the comment in views.mjs where the
   h1 is emitted for why that was a missing subject rather than a missing style.
   The measure is bounded and the wrap is balanced as a progressive heuristic --
   text-wrap:balance is ignored by browsers that do not have it and the natural
   wrap is fine, which is the only reason it is safe to use on shipped copy. */
.app-head { margin: 0 0 2.1rem; }

.app-h1 {
  font-family: var(--display);
  font-size: var(--t-7);
  line-height: 0.92;
  letter-spacing: 0;
  text-transform: uppercase;
  font-weight: 400;
  max-inline-size: 18ch;
  text-wrap: balance;
  margin: 0 0 var(--s-3);
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
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: var(--s-5);
  margin: 0 0 var(--s-6);
}

/* THE PLATE IS GONE BECAUSE THE PHOTOGRAPH BEHIND IT IS.
   It existed for one condition: a place loop playing full-bleed behind this
   page, with body text over it. Measured then, the soft tier over the
   brightest place landed at 2.86:1 -- a real AA failure -- and 0.62 of the
   ground was the least plate that cleared 4.5:1.
 *
 * The signed-in page has no photograph behind it: its ground is flat, so there
 * is no composite left to solve against and every token measures what the
 * table in ':root' says it measures. Deleted rather than left dormant: it
 * keyed off '.bgs.is-live', which this page no longer emits, so it was a rule
 * that could never fire again and would have read to the next person as a
 * plate that was still in play. */

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
  /* Was a 34% near-black wash, there to keep body text off a backlit place
     photograph. On paper there is no photograph and no backlight; the choice
     panels are the lightest things on the page, which is what the comment above
     always said they were for, and now nothing has to be washed to achieve it. */
  background: transparent;
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

/* Two columns: the number in a gutter, everything said about the step in the
   other. The gutter is what lines the four steps up as a sequence.

   A MINIMUM, NOT A FIXED WIDTH (2026-09-04). The archive header borrows this
   grid with the word ARCHIVE where a step has STEP over a numeral, and the
   numeral is exactly 2.9rem wide while ARCHIVE at the label size and tracking
   is about 4rem -- so for four days it overflowed the gutter and printed
   through "Your tapes", and only the owner's eye caught it. max-content lets
   a header's gutter grow to its own label; the four steps stay at 2.9rem
   because nothing in them is wider than the numeral, so the sequence still
   lines up. test/browser-smoke.test.js measures the glyphs, not the box. */
.step-head {
  display: grid;
  grid-template-columns: minmax(2.9rem, max-content) minmax(0, 1fr);
  column-gap: 1rem;
  align-items: start;
  margin: 0 0 var(--s-5);
}

.step-say { min-width: 0; }

.stepno { margin: 0; text-align: right; }

.stepno-k {
  display: block;
  font-size: var(--t-label);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--faint);
  margin: 0 0 0.15rem;
}

/* The step numeral is display type in plain ink. It is a numeral, not a
   choice, so it does not take the accent: the accent means chosen or go, and
   five glowing numerals down the page would spend it on nothing. */
.stepno-n {
  display: block;
  font-family: var(--display);
  font-size: var(--t-8);
  line-height: 0.9;
  color: var(--ink);
}

.stepno-n--mark { font-size: var(--t-4); line-height: 1.4; color: var(--ink); }

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
  border: 0;
  border-radius: var(--r-sm);
  /* DEPTH, NOT A DASHED BOX. What says "drop a photo here" is the well behind
     the control, never an outline: the panel around it is a card, so dropping
     back to the ground is the recess. */
  background: var(--ground);
  text-align: center;
  padding: 1.5rem;
  cursor: pointer;
  transition: background 160ms;
}
/* Hover lifts the recess back to the card rather than drawing a line round
   it -- a hard rectangle appearing under the pointer is the wrong signal, and
   the well cannot deepen without failing the hint inside it. */
/* THE SECOND UPLOAD IN A STEP IS NOT THE SUBJECT OF ONE. Step 1's dropzone is
   15rem because the face IS that step; the place photograph is one of two ways
   to answer step 3, sitting above a text field that answers it equally well.
   Same recess, same behaviour, a third of the height -- so it reads as a
   sibling of the field below it rather than as a competing hero. */
.drop--slim { min-height: 5.5rem; gap: var(--s-2); background: var(--lift); }
.drop--slim .plus { font-size: var(--t-2); }
/* IT LIFTS INSTEAD OF RECESSING, AND THE RULE ABOVE SAYS WHY IT MUST. Step 3
   is a choice panel, which already sits on the ground -- so a well cut into it
   is invisible, and measured on the rendered page the control read as a centred
   heading with no affordance at all. The only direction left there is nearer,
   which is what the card plane is. Same depth idea, opposite sign. */
.drop:hover { background: var(--card); }

/* THE CHOSEN PHOTO, SHOWN BACK. Step 1 named the file and showed nothing, so a
   wrong photo was invisible until the finished tape came back -- on the step
   that commits 21 credits.

   The [hidden] rule IS DECLARED EXPLICITLY AND THAT IS NOT BELT-AND-BRACES:
   the display:flex below beats a bare hidden attribute, and an empty box with
   a broken-image icon is what ships if this rule is missing. There is a test
   that reads this stylesheet for it. */
.picked[hidden] { display: none; }
.picked {
  display: flex; align-items: center; gap: var(--s-2);
  margin: var(--s-2) 0 0;
}
.picked .pickthumb {
  width: 4.5rem; height: 4.5rem;
  object-fit: cover; border-radius: var(--r-sm);
  background: var(--lift);
}
.picked .pickname {
  flex: 1 1 auto; min-width: 0;
  color: var(--faint); font-size: var(--t-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* A real <button>, stripped rather than styled: it must be a button for the
   keyboard and for a screen reader, and it must not draw a box, because
   DESIGN.md permits exactly two borders and this is neither of them. */
.picked #photo-clear {
  flex: 0 0 auto;
  background: none; border: 0; padding: 0.35rem 0;
  font: inherit; font-size: var(--t-1); cursor: pointer;
}
.drop input[type="file"] { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.drop .plus { font-size: var(--t-3); color: var(--ink); letter-spacing: 0.04em; }
.drop .say { color: var(--faint); font-size: var(--t-1); max-width: 22rem; }
.drop .chosen-name { color: var(--ink); font-size: var(--t-1); }

/* --- step 02, the look grid -------------------------------------------- */

.looks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.7rem; }

.lookcard {
  position: relative;
  display: block;
  padding: var(--s-3) 0;
  border: 0;
  border-radius: 0;
  background: none;
  opacity: var(--ghost);
  cursor: pointer;
  /* VALUES SNAP. Only the ghost's own legibility eases; the strike does not. */
  transition: opacity 160ms linear;
}
.lookcard:hover { opacity: var(--ghost-hover); }
.lookcard .name { display: block; font-size: var(--t-2); color: var(--ink); }
/* NOTHING INSIDE A GHOSTED CARD IS WRITTEN IN THE SOFT TIER. --ink-soft under
   the ghost measures 2.45:1; it would need .97 opacity to clear the floor, and
   .97 is not a ghost. The hierarchy inside a card is carried by SIZE -- 15px
   name over 13px detail -- which survives being multiplied by an opacity, and a
   colour step does not. */
.lookcard .detail { display: block; font-size: var(--t-1); color: var(--ink); margin-top: 0.15rem; }
/* The state marks carry NO TEXT IN THE MARKUP. They are hidden by opacity, and
   with the stylesheet switched off an opacity rule does nothing -- so a badge
   that spelled out "Selected" would appear on all nine cards at once and the
   page would read as though everything were chosen. The checked radio is what
   actually conveys the state to assistive technology; these two are decoration,
   so their text belongs in the decoration. */
/* THE MARK IS ON THE LEFT, BEFORE THE NAME, IN EVERY ROW (2026-09-04). The
   frame card always drew its dot in the flow ahead of the shape; this card
   pinned its own to the top-right corner, and the owner saw the two rows
   disagree. A two-column grid gives the dot a gutter of its own, the way the
   frame card's in-flow tick does: unlit it is invisible and the gutter is
   empty, struck it sits on the name's baseline. Everything that is not the
   tick lives in the second column, so the names align across the row. */
.lookcard { display: grid; grid-template-columns: 0.9rem minmax(0, 1fr); column-gap: 0.5rem; align-items: baseline; }
.lookcard > :not(.tick) { grid-column: 2; }
.lookcard .tick {
  grid-column: 1; grid-row: 1;
  color: var(--accent); font-size: var(--t-label);
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
  transition: transform 220ms cubic-bezier(.2,.9,.3,1);
}

/* THE GHOST IS ON THE PHOTOGRAPH, NOT ON THE CARD, and this is the one place
 * where the ghosting rule had to be applied to a different element rather than
 * a different number.
 *
 * A place card carries its name and date on the image, over a scrim solved for
 * FULL opacity. Ghosting the whole card multiplies that scrim as well: measured
 * against the worst ground the gradient can produce, the name lands at 4.36:1
 * and the date at 3.32:1 even at the .63 floor -- so the unlit half of the menu
 * would be the half nobody can read, on the control where reading the label IS
 * the choice.
 *
 * The world decides which PICTURE is lit. It does not dim the menu. So the
 * opacity moves to '.thumb' and the caption stays at full strength, where it
 * measures 13.94:1 and 8.90:1. The card still reads as unlit, because the
 * photograph is the thing anybody is looking at.
 *
 * The photograph itself stays untinted -- this world does not colour the
 * subject, it only decides which one is lit. */
.thumb {
  position: absolute; inset: 0;
  background-size: cover; background-position: center;
  opacity: var(--ghost);
  transition: opacity 160ms linear;
}
.placecard:hover .thumb { opacity: var(--ghost-hover); }
/* The "your own photo" card has no photograph to show, so it draws a hatch
   where one would be. The two stops are the card plane and the ground, which
   keeps it the faintest thing in a row where every other card is a picture. */
.placecard--own .thumb { background: repeating-linear-gradient(135deg, var(--card) 0 8px, var(--ground) 8px 16px); }

/* THE DEFAULT STATE OF THIS PAIR IS THE PRESET STATE, and that is the safe way
   round rather than an arbitrary one. Base CSS shows own-pick and hides
   own-add; the generated '#pl-own:checked' rules swap them. So a browser that
   somehow never applies the generated block still shows a WORKING card -- the
   label for the radio, which is what the rail had before today -- rather than
   an upload card sitting next to a preset it contradicts. The failure mode of
   the fallback is the old behaviour, not a new one. */
.placecard--own-add { display: none; }

.placecard .cap {
  position: absolute; inset: auto 0 0 0;
  padding: 2.5rem 0.75rem 0.7rem;
  background: linear-gradient(180deg, rgba(11,10,9,0) 0%, rgba(11,10,9,0.88) 62%);
}
.placecard .cap .name { display: block; font-size: var(--t-1); color: var(--on-image); line-height: 1.25; }
.placecard .cap .when { display: block; font-size: var(--t-label); letter-spacing: 0.14em; text-transform: uppercase; color: var(--on-image-soft); margin-top: 0.25rem; }

.placecard .badge {
  position: absolute; top: 0.6rem; left: 0.6rem;
  font-size: var(--t-label); letter-spacing: 0.16em; text-transform: uppercase;
  /* Struck, ON THE IMAGE -- so it takes the on-image accent rather than the
     accent used against the ground. There is no halo: on a photograph a glow
     reads as a filter. What is left is the drop shadow, which is legibility
     over an unknown picture rather than decoration. */
  color: var(--on-image-accent);
  background: none;
  border: 0;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
  padding: 0;
  opacity: 0;
  transition: opacity 160ms;
}
.placecard .badge::before { content: "● Selected"; }

.dots { display: flex; gap: 0.35rem; justify-content: center; margin: 0.2rem 0 0; }
.dot { width: 5px; height: 5px; border-radius: 50%; background: var(--hairline-firm); }

/* THE OWN-PLACE BLOCK LEADS STEP 3 (2026-08-30), and it is shown by the same
   rule it has always been shown by -- the pl-own radio is simply checked when
   the page arrives now, so the condition is true on load. Nothing here reveals
   it; do not add a second mechanism.
   It still hides when a preset card is clicked, and a hidden file input STILL
   SUBMITS -- which is why the server refuses a preset card posted together with
   a place photograph rather than silently picking one. See PLACE_CONFLICT. */
.ownplace { display: none; margin-top: 1rem; }
/* A file input, then this line, then the text box. .hint carries a bottom
   margin only, so without this the prose sits flush against the control above
   it. */
.ownplace .or-describe { margin-top: 0.9rem; }

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
.linky:hover { color: var(--ink-soft); }
/* Keyboard parity: the radio is what actually receives focus, so the visible
   ring has to be drawn on the label that stands in for it. */
#pl-own:focus-visible ~ .wrap .linky { outline: 2px solid var(--ink); outline-offset: 2px; }

/* --- the free-text escape hatch ---------------------------------------- */

/* NO SUMMARY RULES HERE ANY MORE (2026-09-05). The outfit box was the last
   disclosure on the page and it is a plain block now, so the three
   'aside summary' rules that used to sit here matched nothing at all. Deleted
   rather than left: a rule that matches nothing is how dead markup survives a
   review, which is the reasoning section 30 used when it took the 4:3 veil's
   markup and its rule out together. */
.aside { margin-top: 1.1rem; }

input[type="text"], input[type="email"], input[type="password"], select {
  width: 100%;
  background: var(--lift);
  border: 1px solid var(--hairline-firm);
  border-radius: var(--r-sm);
  color: var(--ink);
  font: inherit;
  padding: 0.7rem 0.85rem;
}
/* THE PLACEHOLDER IS TEXT, SO IT CLEARS THE FLOOR. A placeholder is the kind
   of value a theme gets away with dimming because nobody measures a hint; it
   takes the soft tier, which is the same colour every other hint uses and is
   measured against both surfaces by the palette test. */
input::placeholder { color: var(--ink-soft); }
select { width: auto; min-width: 6rem; }

input[type="file"] { color: var(--muted); font-size: var(--t-1); }
input[type="file"]::file-selector-button {
  background: var(--card);
  border: 1px solid var(--hairline-firm);
  border-radius: 999px;
  color: var(--ink);
  font: inherit; font-size: var(--t-1);
  padding: 0.4rem 0.85rem;
  margin-right: 0.8rem;
  cursor: pointer;
}

/* The ring is ink everywhere by default. A positive outline-offset draws the
   ring OUTSIDE the border box, so on a lime BUTTON it lands on the dark
   ground around it, not on the lime -- ink is the right ring there too. Only
   a control genuinely sitting ON a lime panel (a chosen card, not a button
   surrounded by dark) needs the ink-of-the-lime ring, or it would vanish
   against the lime beneath it. */
:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.lime :focus-visible { outline-color: var(--on-lime); }

.field { margin: 0 0 var(--s-5); }
.field label { display: block; font-size: var(--t-1); letter-spacing: 0; color: var(--ink); margin-bottom: var(--s-2); }

/* --- the settings panel ------------------------------------------------ */

.pills { display: flex; flex-wrap: wrap; gap: 0.45rem; margin: 0 0 0.6rem; }

/* FACTS, NOT CHOICES. Styled like the active state of a control on purpose --
   these are what the tape is -- but they are <span>s, not buttons, so there is
   nothing to click and nothing to change. A camcorder tape IS 4:3; offering
   16:9 would make this a filter instead of a tape, and the 375-frame contract
   is asserted by roughly two hundred tests. */
.pill {
  font-size: var(--t-label); letter-spacing: 0.14em;
  /* A FACT IS NOT A CHOICE, so it does not wear the accent: it is ink on the
     card plane inside the world's own outline, which is what every other
     small chip on the site is. */
  color: var(--ink);
  background: var(--card);
  border: 1px solid var(--line);
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
  opacity: var(--ghost);
  cursor: pointer;
  /* VALUES SNAP. Only the ghost's own legibility eases; the strike does not. */
  transition: opacity 160ms linear;
}
.framecard:hover { opacity: var(--ghost-hover); }
.framecard .ratio { font-size: var(--t-2); font-weight: 600; letter-spacing: 0.08em; color: var(--ink); }
.framecard .detail { font-size: var(--t-label); color: var(--ink); }
.framecard .tick { color: var(--accent); font-size: var(--t-label); opacity: 0; transition: opacity 140ms; }
.framecard .tick::before { content: "●"; }

/* The drawn shape. Height is fixed at 18px and the width carries the ratio. */
.framecard .shape { display: block; border: 1px solid var(--accent-deep); height: 18px; flex: none; }
.framecard--a-4x3 .shape { width: 24px; }
.framecard--a-16x9 .shape { width: 32px; }
.framecard--a-9x16 .shape { width: 10px; }
/* A deferred shape still DRAWS its glyph -- the exception DESIGN.md grants is
   for the rectangle that depicts an aspect ratio, and one drawn in a
   transparent colour depicts nothing. It was invisible on the dark ground for
   the same reason; ghosting it in --faint is what "unavailable" should have
   looked like all along. */
.framecard--soon .shape { border-color: var(--faint); }

/* Same rule as the deferred quality card: a <span>, no radio behind it, so
   there is nothing to select and nothing that can be posted. */
/* A DEFERRED SHAPE SITS AT THE SAME FLOOR AS EVERY OTHER UNLIT ONE. It was at
   .26, which is --ink at 1.70:1 -- text nobody can read, on the element whose
   only job is to say "not yet". Opacity cannot carry this distinction on paper
   without going under the floor, so the FLAG carries it, in words, which is
   also the only version a screen reader ever had. */
.framecard--soon { cursor: default; opacity: var(--ghost); }
.framecard--soon:hover { opacity: var(--ghost); }
.framecard--soon .flag { font-size: var(--t-label); letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink); }

/* --- the quality row: a real choice, and it must not look like the pills --- */

.quality { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: var(--s-2); margin: 0 0 var(--s-2); }

.qualitycard {
  position: relative; display: block;
  padding: var(--s-3) 0;
  border: 0;
  border-radius: 0;
  background: none;
  opacity: var(--ghost);
  cursor: pointer;
  /* VALUES SNAP. Only the ghost's own legibility eases; the strike does not. */
  transition: opacity 160ms linear;
}
.qualitycard:hover { opacity: var(--ghost-hover); }
.qualitycard .name { display: block; font-family: var(--display); font-size: var(--t-3); letter-spacing: 0; text-transform: uppercase; line-height: 1; color: var(--ink); }
/* One price per shape, hidden until the frame row says which shape. Painting
   them all at once would list three numbers on one card; painting the un-shaped
   one quotes the 4:3 price for a shape charged 4/3 of it. The deferred tier is
   the exception and says so in its own class -- it has no per-shape quote to
   switch to, because creditCost refuses it outright. */
.qualitycard .cr { display: none; font-size: var(--t-label); letter-spacing: 0.14em; color: var(--ink); margin-top: 0.1rem; }
.qualitycard .cr--soon { display: block; }
.qualitycard .detail { display: block; font-size: var(--t-1); color: var(--ink); margin-top: 0.35rem; }
.qualitycard .flag { display: inline-block; font-size: var(--t-label); letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink); margin-top: 0.4rem; }
/* The same gutter as .lookcard, for the same reason: the mark on the left,
   before the name, in every row. The deferred card has no tick, and its
   children take the second column too, so its name lines up with the rest. */
.qualitycard { display: grid; grid-template-columns: 0.9rem minmax(0, 1fr); column-gap: 0.5rem; align-items: baseline; }
.qualitycard > :not(.tick) { grid-column: 2; }
.qualitycard .tick { grid-column: 1; grid-row: 1; color: var(--accent); font-size: var(--t-label); opacity: 0; transition: opacity 140ms; }
.qualitycard .tick::before { content: "●"; }

/* Unavailable options are a <span>, not a <label>: there is no radio behind
   them, so there is nothing to select and nothing that can be posted. */
/* A refused value stays unlit rather than outlined: this world has no lines.
   AT THE FLOOR AND NOT BELOW IT -- .26 put --ink at 1.70:1. The flag says
   "coming soon" in words, which is the only version that ever reached a screen
   reader anyway, and words do not have a contrast ratio to fail. */
.qualitycard--soon { cursor: default; opacity: var(--ghost); }
.qualitycard--soon:hover { opacity: var(--ghost); }

/* One cost per resolution, all hidden until the matching radio is checked. */
.cost { display: none; }
.why { display: none; color: var(--alarm); }

/* The group boundary the ladder was missing entirely. */
.panel--commit .hint { margin-bottom: var(--s-5); }

.facts { display: grid; grid-template-columns: 1fr auto; gap: var(--s-1) var(--s-4); margin: var(--s-5) 0; }
.facts dt { font-size: var(--t-label); text-transform: uppercase; letter-spacing: 0.22em; color: var(--faint); }
.facts dd { margin: 0; font-size: var(--t-2); font-weight: 600; letter-spacing: 0.12em; color: var(--ink); text-align: right; }

.record {
  display: block; width: 100%;
  margin-top: var(--s-5);
  background: var(--accent);
  border: 0; border-radius: var(--r-btn);
  /* The label sits ON the accent, so it takes the ink solved for lime rather
     than the page's ink. The palette test measures that pair on lime and on
     its hover value, because a hovered button is still a button. */
  color: var(--on-lime);
  font-family: var(--display); font-size: var(--d-2);
  text-transform: uppercase; font-weight: 400;
  letter-spacing: 0.02em;
  padding: 0.85rem 1rem;
  cursor: pointer;
  text-align: center; text-decoration: none;
}
.record:hover { background: var(--accent-bright); }
.record:disabled { background: var(--lift); color: var(--faint); cursor: not-allowed; }

.reason { text-align: center; color: var(--faint); font-size: var(--t-1); margin: var(--s-3) 0 0; }

/* --- the shelf --------------------------------------------------------- */

/* THE SHELF IS THE REFERENCE'S GRID, and DESIGN.md § "The reference" says why
   this one and not a nicer-looking one: artifactuprising.com solves OUR problem,
   not an adjacent one -- somebody's photographs go in and a keepsake comes out.
   Image, then name, then caption, sitting directly on the paper. No box around
   the image, no border, no shadow, nothing between one tile and the next except
   space. It is a grid that obeys this file's one rule already.

   THE GAP GREW FROM 0.75rem TO --s-5. Space is the only thing separating two
   tiles now, so it has to be legible as separation rather than as a seam. */
.shelf { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: var(--s-5); }

.tape {
  display: block;
  text-decoration: none;
  color: inherit;
}

/* HALF OF EVERY POSTER IS LETTERBOX, AND THE CROP IS WHAT REMOVES IT.
 *
 * The tape is delivered 9:16 with the 4:3 camcorder picture matted inside it, so
 * the poster is the picture plus two bars of the surround colour. Measured on a
 * 16-row sample of a real render, rows 1-4 and 13-16 are luma 0: the content is
 * EXACTLY the middle half.
 *
 * On a near-black page ground those bars were invisible, which is why this went
 * unnoticed for as long as it did. Uncropped they are 50% of every tile and are
 * what makes a shelf read as a wall of slabs rather than as photographs.
 *
 * 9/8 is that middle half. With the 'object-fit: cover' the tile already had,
 * one declaration crops to the picture and nothing else changes -- no new
 * markup, no reprocessing, and the burnt-in date stamp survives because it sits
 * inside the content band, not on the bar below it. */
.tape .frame {
  display: block;
  aspect-ratio: 9 / 8;
  overflow: hidden;
  position: relative;
  /* AN UNFINISHED TAPE HAS NO POSTER, AND THE TILE MUST STILL BE SOMETHING.
     On the dark ground this was a 50% near-black wash, so a rendering job read
     as a dark plate with its status on it. Dropping the wash with the rest of
     the near-black left a 151px hole in the shelf with a status pill floating
     in the middle of nothing. --lift is the plate: pale, present, and covered
     completely by the poster the moment there is one. */
  background: var(--lift);
}
.tape img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* THE CROP FOLLOWS THE TAPE'S OWN SHAPE (2026-08-31), and until today it did
   not. The 9/8 above is MEASURED and correct -- for a 4:3 tape, which is
   delivered 1080x1920 with the picture matted inside it, so 9/8 removes the
   letterbox and nothing else. Then the frame menu opened (§34D) and nothing
   taught this rule: a 9:16 order is delivered FULL-BLEED at 1080x1920, so the
   same crop threw away more than half of a real picture, and a 16:9 tape lost
   its sides. Invisible so far only because every finished tape on this machine
   is 4:3.
   The default stays 9/8 rather than 4/3 because the file really does carry a
   little surround above and below the picture; the two wide shapes carry none,
   so they take their own ratio exactly. Rows of different heights are the
   honest result -- these ARE different-shaped tapes, and pretending otherwise
   is what loses the picture. */
.tape .frame--a-16x9 { aspect-ratio: 16 / 9; }
.tape .frame--a-9x16 { aspect-ratio: 9 / 16; }

/* The player on /videos. 'object-fit: cover' matches the poster it replaces, so
   the tile does not resize the instant somebody presses play. Black behind it
   because a video element with nothing decoded yet is transparent, and on cream
   that reads as a hole rather than as a picture that has not started. */
.tape--play { display: block; }
.vplay { width: 100%; height: 100%; object-fit: cover; display: block; background: #000; }

/* The download sits under the caption rather than over the picture: it is an
   action on the tape, not part of it, and DESIGN.md keeps text off a photograph
   unless the photograph is the ground. */
.dl {
  display: inline-block; margin-top: 0.35rem;
  font-size: var(--t-label); letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink); text-decoration: none;
}
.dl:hover { color: var(--ink-soft); }

/* THE CAPTION CAME OUT OF THE PICTURE AND ONTO THE PAGE, which is the other
   half of what the reference does. It used to sit inside the tile under a 90%
   near-black gradient -- a scrim that exists to make text survive over an
   unknown photograph, and a device this world does not need once the text has
   paper to sit on. Deleting it also deletes the only dark rectangle left in
   the tile after the crop. */
.tape .cap { display: block; padding-top: var(--s-3); font-size: var(--t-label); }
.tape .what { display: block; font-size: var(--t-1); color: var(--ink); line-height: 1.3; overflow-wrap: anywhere; }
.tape .when { display: block; font-size: var(--t-label); font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: var(--faint); }

/* Unfinished tapes still say so -- AND THE BADGE IS NEVER ON AN IMAGE, which is
   the detail that decided its colours. 'shelfTile' only emits a poster when the
   tape is done, so a tile carrying this badge is always the bare card plate,
   never a photograph. The on-image tier is therefore exactly wrong here: it
   measured 1.67:1 over that plate, the one contrast failure the sweep found on
   this page. It is ink on the ground -- a small label on a card. */
.tape .state {
  position: absolute; top: 0.5rem; left: 0.5rem;
  font-size: var(--t-label); letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink); background: var(--ground);
  border-radius: 999px; padding: 0.15rem 0.5rem;
}

.empty {
  /* An outlined card, like every other card in this world. */
  border: 1px solid var(--line);
  border-radius: var(--r);
  background: var(--card);
  padding: 2.5rem 1.5rem;
  text-align: center;
  color: var(--faint);
}
.empty .title { color: var(--ink); margin-bottom: 0.3rem; }

/* --- progress ---------------------------------------------------------- */

/* THE PHASES ARE ROWS, NOT A BAR (2026-09-04, from the design prototype). A
   bar can only say how far; a row per phase says what is happening and what
   is still to come, in words, with the record light on the one being filmed.
   The counter above keeps the "2 of 3" a bar used to imply. */
.status { max-width: 44rem; }
.status .headline { font-size: var(--t-6); line-height: 1.1; letter-spacing: -0.02em; text-wrap: balance; }
.counter { font-weight: 600; color: var(--faint); letter-spacing: 0.12em; text-transform: uppercase; font-size: var(--d-1); margin: var(--s-6) 0 var(--s-3); }
.phases { list-style: none; padding: 0; margin: 0 0 var(--s-6); display: grid; gap: var(--s-4); }
.phase { display: grid; grid-template-columns: 5rem minmax(0, 1fr) auto; column-gap: var(--s-4); align-items: baseline; }
.phase-state { display: flex; align-items: center; gap: 0.5rem; font-weight: 600; font-size: var(--t-1); letter-spacing: 0.18em; text-transform: uppercase; color: var(--faint); white-space: nowrap; }
.phase-state .dot { display: none; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); }
.phase-done .phase-state { color: var(--accent-deep); }
.phase-done .phase-state .dot { display: inline-block; background: var(--accent-deep); }
.phase-stopped .phase-state { color: var(--alarm); }
.phase-stopped .phase-state .dot { display: inline-block; background: var(--alarm); }
.phase-title { display: block; font-size: var(--t-3); line-height: 1.3; font-weight: 500; color: var(--ink); }
.phase-note { display: block; font-size: var(--t-1); color: var(--faint); margin-top: var(--s-1); max-width: 48ch; }
/* A phase still to come is a ghost, at the floor and no lower. Hierarchy in
   the row is otherwise carried by size, which survives the opacity. */
.phase-pending .phase-title { opacity: var(--ghost); }
.phase-n { font-weight: 600; font-size: var(--d-1); letter-spacing: 0.12em; color: var(--faint); }
@media (max-width: 27rem) {
  .phase { grid-template-columns: minmax(0, 1fr) auto; row-gap: var(--s-1); }
  .phase-state { grid-column: 1 / -1; }
}

/* THE RECORD LIGHT. It sits on the phase being filmed and nowhere else -- see
   statusPage -- so it never blinks over a tape that has already stopped.

   NOT '.rec': that class is already the dot inside the wordmark SVG, and
   sharing it would have made the brand mark and this indicator style each
   other. Caught by a test before it shipped.

   The blink is steps() rather than a fade, because a tally light is a lamp
   being switched, not something that breathes. */
.reclight { color: var(--accent); }
.reclight .dot { display: inline-block; background: var(--accent); animation: tally 1.6s steps(1, end) infinite; }
@keyframes tally { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0.25; } }
@media (prefers-reduced-motion: reduce) { .reclight .dot { animation: none; } }

/* THE ELEVEN STEPS, ONE LINE AWAY. Native <details>, so no script -- the CSP
   names the shipped inline scripts by hash and a fourth would be dead in the
   browser. The marker is left alone rather than restyled: the disclosure
   triangle is the affordance somebody already knows, and DESIGN.md's borders
   rule means there is nothing to draw around it anyway. */
.stepdetail { margin: 0 0 1.2rem; }
.stepdetail > summary {
  cursor: pointer; color: var(--ink); opacity: var(--ghost);
  font-size: var(--t-1); padding: 0.2rem 0;
}
.stepdetail > summary:hover { opacity: 1; }
.stepdetail > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; opacity: 1; }

.steps { list-style: none; padding: 0; margin: 0 0 1.75rem; }
.step {
  display: grid;
  grid-template-columns: 1rem 1fr;
  grid-template-areas: 'mark name' '. note';
  gap: 0 0.75rem;
  /* Was a 1px top border. DESIGN.md forbids rules and dividers anywhere, and a
     literal colour is a line no token can turn transparent -- so the steps are
     separated by space instead. Tight within the group, generous between. */
  padding: 0.6rem 0;
  color: var(--faint);
}
.step-mark { grid-area: mark; width: 6px; height: 6px; margin-top: 0.6rem; border-radius: 50%; background: var(--line); }
.step-name { grid-area: name; font-size: var(--t-2); }
.step-note { grid-area: note; font-size: var(--t-1); color: var(--faint); }
.step-done { color: var(--muted); }
.step-done .step-mark { background: var(--accent-deep); }
.step-skipped .step-mark { box-shadow: inset 0 0 0 1px var(--accent-deep); background: transparent; }
.step-failed .step-mark { background: var(--alarm); }
.step-current { color: var(--ink); }
.step-current .step-mark { background: var(--accent); }
.step-current .step-note { color: var(--muted); }

/* The order, as a definition list: where, wearing, frame. */
.inputs { display: grid; grid-template-columns: 5rem minmax(0, 1fr); gap: var(--s-1) var(--s-4); margin: 0 0 var(--s-6); color: var(--muted); }
.inputs dt { font-size: var(--t-label); text-transform: uppercase; letter-spacing: 0.22em; color: var(--faint); line-height: 1.6; }
.inputs dd { margin: 0; overflow-wrap: anywhere; }

/* --- contact sheet ----------------------------------------------------- */

.sheet { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: var(--s-5); }
.still {
  position: relative; display: block; padding: 0;
  background: transparent;
  border: 0;
  border-radius: var(--r-sm);
  cursor: pointer; overflow: hidden; line-height: 0;
  /* STRUCK, NOT RINGED. Selection here was two border-colour rules -- a line
     drawn round the chosen thing, which is the device DESIGN.md's one rule
     exists to forbid, and which the border sweep could not see because both
     named tokens. It is the world's own grammar instead: every option present
     as an unlit ghost, one struck forward. A ghost sits at the floor and no
     lower; on this ground the floor is .63, and '--ghost' is where the ground
     names it. */
  opacity: var(--ghost);
  transition: opacity 160ms linear;
}
.still img { width: 100%; height: auto; display: block; }
.still:hover { opacity: var(--ghost-hover); }
.still.chosen { opacity: 1; }
.still-n {
  position: absolute; left: 0.45rem; bottom: 0.35rem;
  font-weight: 600; color: var(--on-image-soft); font-size: var(--t-2); line-height: 1;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
}
/* The index of the struck one goes to the accent-on-an-image. It is the one
   place on this grid where colour answers "which have I chosen?". */
.still.chosen .still-n { color: var(--on-image-accent); }

/* --- the video --------------------------------------------------------- */

/* THE PLAYER KEEPS THE TAPE'S OWN MATTE AND DOES NOT FOLLOW THE GROUND. It used
   to be 'var(--ground)', which was right only while the page and the surround
   happened to be the same near-black. On paper that would put a cream box behind
   a letterboxed video -- the delivered file is matted on '#0B0A09' and the
   player must not argue with it. This is PALETTE.ground, the colour the finished
   video is actually matted onto. */
.player {
  background: ${PALETTE.ground};
  border: 0;
  border-radius: var(--r-sm);
  overflow: hidden; line-height: 0;
}
.player video { width: 100%; height: auto; display: block; background: ${PALETTE.ground}; }
.meta { font-weight: 600; color: var(--faint); letter-spacing: 0.12em; font-size: var(--t-1); margin: 0.8rem 0 1.5rem; }

/* THE TAPE LABEL -- the payoff page's one signature moment.

   AN OUTLINED CARD, like every other card in this world -- the fill is the
   card plane and the outline is the one token every outline in the sheet
   names, so this introduces no colour the palette did not have.

   The date takes the accent because on this page the date IS the product --
   it is the one place the single accent means "this is the thing you chose",
   the same job it does on a struck option everywhere else. */
.label {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  column-gap: 1rem;
  background: var(--lift);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 0.75rem 0.9rem 0.8rem;
  margin: 0.6rem 0 0;
}
.label .lname { font-weight: 600; letter-spacing: -0.01em; }
.label .lsub {
  grid-column: 1; grid-row: 2;
  color: var(--faint); font-size: var(--t-label);
}
.label .ldate {
  grid-column: 2; grid-row: 1 / span 2;
  font-family: var(--osd); font-size: var(--t-2);
  color: var(--accent); letter-spacing: 0.06em; white-space: nowrap;
}

/* ON A PHONE THE DATE TAKES ITS OWN LINE. The date column is fixed-width and
   never wraps, so on a narrow screen it squeezes the place name into a ragged
   two-line wrap beside it -- measured at 375px, the commonest phone width and
   one of the six this project tests: 'The garden, in / summer'. Stacked, the
   date reads as the top line of the label, which is where a real cassette
   label carries it. The DOM order is unchanged, so a screen reader still hears
   the place first; only the painting order moves. */
@media (max-width: 27rem) {
  .label { grid-template-columns: 1fr; }
  .label .ldate { grid-column: 1; grid-row: 1; }
  .label .lname { grid-column: 1; grid-row: 2; }
  .label .lsub { grid-column: 1; grid-row: 3; }
}

/* --- the result: the tape beside the words (2026-09-04) ---------------- */

/* Two columns: the tape at a fixed 20rem with its label beneath, the words
   taking the rest. On a phone they stack and the tape still comes first. */
.result-grid { display: grid; grid-template-columns: minmax(0, 20rem) minmax(0, 1fr); gap: var(--s-7); align-items: start; margin: 0 0 var(--s-8); }
@media (max-width: 48rem) { .result-grid { grid-template-columns: 1fr; gap: var(--s-6); } }
.result-words { padding-top: var(--s-2); }
.result-words .headline { font-size: var(--t-6); line-height: 1.1; letter-spacing: -0.02em; text-wrap: balance; max-inline-size: 18ch; }
.result-words .sub { max-width: 44ch; }
/* A label in the readout face, for a section whose content is a readout --
   "The file", "Earlier tapes". The same size and tracking as the status
   page's counter. */
.eyebrow--osd { font-weight: 600; font-size: var(--d-1); letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint); margin: 0 0 var(--s-2); }
/* THE SPEC LINE IS A LABELLED READOUT ON THE PAYOFF PAGE, under "The file",
   rather than a caption on the picture: a frame count and a raster are what
   the tape physically is, and beneath their own label they read as a fact
   about the file rather than as a description of a memory. It is a
   stylesheet change rather than a second class because the tests read
   'class="meta"' exactly -- and because where a fact sits in the hierarchy is
   a design decision, not a markup one. */
.page-result .meta { font-weight: 600; font-size: var(--d-2); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink); margin: 0 0 var(--s-5); }
.earlier .shelf { margin-top: var(--s-4); }

/* --- the shelf page and the account page (2026-09-04) ------------------ */

/* The shelf is the page: label, heading at page-title size, two sentences,
   tiles on the paper. The tiles keep the prototype's grid rather than the
   home strip's, because here they are the content and not an aside. */
.videos .headline { font-size: var(--t-7); line-height: 1.1; letter-spacing: -0.02em; max-inline-size: 18ch; margin: 0 0 var(--s-3); }
.videos .sub { margin: 0 0 var(--s-2); }
.videos > .hint { margin: 0 0 var(--s-7); }
.videos .shelf { grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: var(--s-6) var(--s-5); }

/* The account: the address as the heading (it can be long, so it may break
   anywhere), the sections under readout labels, the one-way door in a narrow
   column so the field and the button read as one control. */
.account { max-width: 44rem; }
.account .headline { font-size: var(--t-6); line-height: 1.1; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.subhead--osd { font-weight: 600; font-size: var(--d-1); letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint); margin: var(--s-7) 0 var(--s-2); }
.account-danger { max-width: 22rem; }
.account-danger .record { margin-top: var(--s-4); }

/* --- buttons and links ------------------------------------------------- */

.go {
  display: inline-block;
  background: var(--accent); border: 0; border-radius: var(--r-btn);
  color: var(--on-lime);
  font-family: var(--display); font-size: var(--d-2);
  text-transform: uppercase; font-weight: 400; letter-spacing: 0.02em;
  padding: 0.7rem 1.4rem; cursor: pointer; text-align: center; text-decoration: none;
}
.go:hover { background: var(--accent-bright); }

.actions { margin-top: 1.75rem; display: flex; gap: 1.25rem; align-items: center; flex-wrap: wrap; }

.quiet {
  background: none; border: 0; color: var(--faint);
  font: inherit; font-size: var(--t-1); padding: 0; cursor: pointer;
  text-decoration: underline; text-underline-offset: 3px;
  text-decoration-color: var(--hairline-firm);
}
.quiet:hover { color: var(--ink); }

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
.consent-text span { display: block; color: var(--muted); font-size: var(--t-1); }
.consent-text span + span { margin-top: 0.5rem; }
/* The immediate-supply acknowledgement, which sits between the plan and its Buy
   button rather than at the end of a long form the way the consent gate does.
   It needs air on both sides: flush against the button it reads as part of the
   button, and flush against the price it reads as part of the price. */
/* THE ACKNOWLEDGEMENT IS LAW, SO IT STAYS -- BUT IT WAS SHOUTING. §45D recorded
   it and let it go: the sentence renders once per PAID rung, so it appears
   twice on /pricing, and in a narrow column it wrapped to about eight ragged
   lines each. Two identical eight-line legal blobs were the heaviest thing on
   the page, above the price and above the button.
   It cannot be hoisted into one shared line -- that needs one form to own a
   field the other posts, which the checkout guard forbids by design. So it is
   made QUIET instead of shared: label size, tighter leading, and a measure wide
   enough that it sets as a short paragraph rather than a ragged column. The
   words are unchanged; consent copy is not something to trim for looks. */
.check--buy { margin: var(--s-4) 0 var(--s-5); text-align: left; gap: var(--s-2); }
.check--buy .lbl,
.check--buy span { font-size: var(--t-label); line-height: 1.45; color: var(--ink-soft); }

/* --- the sign-in dialog ------------------------------------------------- */

/* THE DIALOG IS A PIECE OF THE APPLICATION, not a piece of the landing: it is
   the same two doors the /login page renders, so it is a card on the ground
   like every other card, and a person meets one sign-in whichever door they
   came through. There is one world now, so it restates no tokens of its own --
   the block that used to sit here existed only because a second ground did.
   A browser test reads the cascade for the typed text, the caret and the two
   foot links, which is the layer that caught them painted for the wrong
   surface once already. */
.signin { border: 0; padding: 0; background: transparent; max-width: min(26rem, calc(100vw - 2rem)); }
.signin::backdrop { background: rgba(22, 22, 24, 0.72); }
.signin-box {
  position: relative;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: var(--s-8) var(--s-6) var(--s-6);
  text-align: center;
}
/* The close control is a real 44px target rather than a decorative glyph --
   SC 2.5.8 asks 24x24 and §6b already had to fix this product's consent box
   for exactly that reason. */
.signin-x {
  position: absolute; top: var(--s-3); right: var(--s-3);
  width: 44px; height: 44px; line-height: 1;
  border: 0; background: transparent; cursor: pointer;
  font-size: var(--t-4); color: var(--ink-soft);
}
.signin-x:hover { color: var(--ink-strong); }
.signin-t { font-family: var(--display); font-size: var(--d-4); text-transform: uppercase; letter-spacing: 0; line-height: 0.92; color: var(--ink); margin: 0 0 var(--s-2); font-weight: 400; }
.signin-sub { color: var(--ink-soft); font-size: var(--t-1); margin: 0 0 var(--s-6); }
/* One door per row, full width, in the order the reference sets: the provider
   first, then the password. Stacked rather than side by side so neither reads
   as the lesser option. */
.signin-way, .signin-go {
  display: block; width: 100%;
  font: inherit; font-size: var(--t-2);
  padding: var(--s-3) var(--s-4);
  border: 0; border-radius: var(--r-sm);
  cursor: pointer;
}
.signin-way { background: var(--ground); color: var(--ink); border: 1px solid var(--line); border-radius: var(--r-btn); }
.signin-way:hover { background: var(--card); }
.signin-go { background: var(--lime); color: var(--on-lime); border-radius: var(--r-btn); margin-top: var(--s-4); }
.signin-go:hover { background: var(--lime-hover); }
/* The rule through the "or" is a 1px fill rather than a border, so it takes
   the outline token like every other line in the sheet. */
.signin-or {
  margin: var(--s-5) 0;
  font-size: var(--t-label); letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink-soft);
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: var(--s-3);
}
.signin-or::before, .signin-or::after {
  content: ''; height: 1px;
  background: var(--line);
}
.signin-form { text-align: left; margin: 0; }
.signin-l { display: block; font-size: var(--t-label); letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-soft); margin: var(--s-4) 0 var(--s-1); }
.signin-i {
  display: block; width: 100%; box-sizing: border-box;
  font: inherit; font-size: var(--t-2);
  padding: var(--s-3);
  border: 1px solid var(--line); border-radius: var(--r-sm);
  background: var(--ground); color: var(--ink);
}
.signin-alt { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--s-4); margin: var(--s-6) 0 0; font-size: var(--t-label); }

/* --- pricing ----------------------------------------------------------- */

/* EQUAL COLUMNS HERE ARE CORRECT, AND THE OLD LANDING'S THREE-COLUMN BLOCK IS
   WHY THAT HAD TO BE SAID. A pricing table is a COMPARISON: the
   reader is holding two purchasable things side by side and asking which, and
   parallel things shown at parallel size is what makes that possible. Forcing
   an uneven grid here would be the rule applied without judgment, which is its
   own kind of slop.
   What IS uneven is Free, because Free is not a third option -- it is what an
   account already has, and it has no button. Sitting at equal width it read as
   a purchase the visitor had somehow failed to make. It is narrower now, so
   the row shows two choices and one piece of context. */
.plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--s-5); margin: 0 0 var(--s-6); }
@media (max-width: 48rem) { .plans { grid-template-columns: 1fr; gap: var(--s-6); } }

/* THE PACKS, FROM THE DESIGN PROTOTYPE (2026-09-04). The grant left the row:
   it has no price and no button, and at equal width beside two purchases it
   read as one the visitor had somehow failed to make. It is the sentence under
   the heading now, and the row holds the two things that can actually be
   bought -- which is the one equal grid DESIGN.md allows, because two packs
   that differ only in size are genuine peers. The recommended pack sits on the
   lifted plate and the other on bare paper: depth does the grouping, per the
   one rule, and no line is drawn. */
.pricing-head { max-width: 40rem; margin: var(--s-5) auto var(--s-7); text-align: center; }
.pricing-head .headline { margin-bottom: var(--s-3); }
.pricing-head .sub { margin: 0 auto; }
.packs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-5); align-items: start; margin: 0 0 var(--s-7); }
@media (max-width: 48rem) { .packs { grid-template-columns: 1fr; gap: var(--s-6); } }
.pack { padding: var(--s-6); }
.pack--recommended { background: var(--lift); }
.pack .pack-name { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
/* A FLAG IS NOT A CHOICE, so it does not wear the accent: it is a small
   outlined chip on the card plane, the same shape as .plan .mark, inline
   because it sits in the label row rather than on a corner. */
.pack .mark { font-size: var(--t-label); letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 0.15rem 0.6rem; }
/* The figure is display type; the count beneath it is the label role, so the
   eye reads "$12" as the figure and "92 credits" as what it buys. */
.pack .price { font-family: var(--display); font-size: var(--t-8); line-height: 0.9; letter-spacing: 0; text-transform: uppercase; color: var(--ink); margin: var(--s-3) 0 var(--s-1); }
.pack .pack-credits { font-weight: 600; font-size: var(--d-2); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); margin: 0; }
.pack ul { list-style: none; padding: 0; margin: var(--s-5) 0 0; color: var(--muted); font-size: var(--t-1); }
.pack li { padding: 0.42rem 0; }
/* The plainer pack takes the lifted button (the design system's "way"), so the
   oxide button appears once on the page, on the pack the page recommends. */
.record--way { background: var(--card); color: var(--ink); border: 1px solid var(--line); }
.record--way:hover { background: var(--card); color: var(--ink); }
.pack > .hint { margin: var(--s-3) 0 0; text-align: center; }
.pricing-foot { max-width: 44rem; margin: 0 auto; }
/* EVERY VALUE PRESENT, ONE STRUCK -- the world's central mechanic, finally on
   the page that most needs it. DESIGN.md § 23 recorded the failure in its own
   words: the page that answers "which plan am I on?" was the one page not using
   the grammar, and the current plan was marked with a bordered pill instead.
   Ghosts sit at .5, which is the floor this world fixes and does not go below. */
.plan { position: relative; transition: opacity 160ms linear; }
/* GATED ON SOMETHING ACTUALLY BEING STRUCK. An unconditional ghost would dim
   every plan for a visitor who has no plan yet -- which is most of the people
   this page exists for, and it would read as the whole page being disabled.
   Ghosting is only meaningful against something lit, so ':has' asks whether
   there is anything lit before anything is dimmed. */
.plans:has(.plan--current) .plan { opacity: var(--ghost); }
.plans:has(.plan--current) .plan--current { opacity: 1; }
.plan .price { font-family: var(--display); font-size: var(--t-6); line-height: 0.9; letter-spacing: 0; text-transform: uppercase; color: var(--ink); margin: 0.3rem 0 0.1rem; }
.plan .per { color: var(--faint); font-size: var(--t-label); letter-spacing: 0.14em; text-transform: uppercase; }
.plan ul { list-style: none; padding: 0; margin: 1rem 0 0; color: var(--muted); font-size: var(--t-1); }
/* Fifteen of these were the only visible lines left in the product. Space does
   the grouping now, per DESIGN.md's one rule. */
.plan li { padding: 0.42rem 0; }
.plan .mark {
  position: absolute; top: -0.65rem; left: 1.4rem;
  font-size: var(--t-label); letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink);
  /* A flag says which plan you are on. It is a fact, not a choice, so it is a
     small outlined chip on the card plane rather than the accent. */
  background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 0.15rem 0.6rem;
}

/* --- the world's primitives (2026-09-06) --------------------------------- */

.vh-svg { position: absolute; width: 0; height: 0; overflow: hidden; }

/* A LIME PANEL. The speckle is a white layer under multiply, so it darkens the
   lime by a hair where the noise is dark and leaves it alone elsewhere: ink on
   paper, not video noise. Children sit above the layer. */
.lime { position: relative; overflow: hidden; background: var(--lime); color: var(--on-lime); border-radius: var(--r); }
.lime > * { position: relative; z-index: 1; }
.lime::before { content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none; background: #FFFFFF; filter: url(#speckle); mix-blend-mode: multiply; opacity: 0.32; }

/* AN OUTLINED CARD ON THE GROUND. Flat: no texture, ever. */
.card { background: var(--card); border: 1px solid var(--line); border-radius: var(--r); }

/* THE FACT CARDS: crumpled paper, and only here. */
.fact { position: relative; overflow: hidden; margin: 0; border-radius: var(--r); padding: var(--s-6) var(--s-5); min-height: 14rem; }
.fact > * { position: relative; z-index: 1; }
.fact::before { content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none; background: #FFFFFF; filter: url(#paper); mix-blend-mode: multiply; opacity: 0.55; }
.fact--lime { background: var(--lime); color: var(--on-lime); }
.fact--white { background: #FFFFFF; color: var(--on-lime); }
.fact blockquote { margin: 0; }
.fact blockquote p { margin: 0; font-family: var(--display); text-transform: uppercase; font-size: var(--d-4); line-height: 0.92; letter-spacing: 0; }
.fact figcaption { margin: var(--s-4) 0 0; font-size: var(--t-1); color: var(--on-lime-soft); }

/* THE FAQ: native rows, outlined, the glyph switched by [open]. */
.faq { max-width: 52rem; margin: 0 auto var(--s-8); }
.faq-t { font-family: var(--display); text-transform: uppercase; font-size: var(--d-4); line-height: 0.92; letter-spacing: 0; font-weight: 400; margin: 0 0 var(--s-5); }
.faq-row { border: 1px solid var(--line); border-radius: var(--r-sm); margin: 0 0 var(--s-3); padding: 0 var(--s-5); }
.faq-row > summary { display: flex; justify-content: space-between; align-items: center; gap: var(--s-4); cursor: pointer; list-style: none; padding: var(--s-4) 0; font-weight: 600; }
.faq-row > summary::-webkit-details-marker { display: none; }
.faq-glyph::before { content: '+'; font-family: var(--display); font-size: var(--t-4); line-height: 1; color: var(--ink-soft); }
details[open] > summary .faq-glyph::before { content: '−'; }
.faq-row > p { margin: 0 0 var(--s-5); color: var(--ink-soft); max-width: 66ch; }

/* THE FOOTER: two columns, the giant word, the fine print. */
.foot-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-6); max-width: 32rem; margin: 0 0 var(--s-7); }
.foot-h { font-size: var(--t-label); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); margin: 0 0 var(--s-3); }
.foot-col ul { list-style: none; margin: 0; padding: 0; }
.foot-col li { margin: 0 0 var(--s-2); }
.foot-col .quiet { text-decoration: none; color: var(--ink); font-size: var(--t-2); }
.foot-col .quiet:hover { color: var(--lime); }
.foot-mark { font-family: var(--display); text-transform: uppercase; font-size: var(--t-mark); line-height: 0.9; letter-spacing: 0; color: var(--lime); margin: 0 0 var(--s-5); white-space: nowrap; overflow: hidden; }
@media (max-width: 30rem) { .foot-cols { grid-template-columns: 1fr; } }

/* --- foot -------------------------------------------------------------- */

/* --- the landing (2026-09-06): the lime poster, the tape first ------------ */

/* THE PRIMARY BUTTON NEEDS NO RESTATEMENT HERE ANY MORE. It used to, because
   the landing had a ground of its own and the button's label had been solved
   against a different accent. One world, one accent, one answer: the label is
   the ink solved for lime, wherever the button is drawn.

   DESIGN.md owns this world. Borders are ALLOWED now and are always the
   outline token; what is still forbidden is a rule drawn BETWEEN two things,
   and any texture on the ground or on a dark card. */

/* TEXTURE BELONGS TO THE TAPE AND TO NOTHING ELSE, and as of 2026-08-24 that is
   structural rather than remembered. This used to be a "display: none" naming
   the two converted pages, so login, signup, pricing, status and result all
   kept wearing the page-wide grain plate -- precisely the "AI tool with a
   filter over it" impression the product exists to avoid. The plate is deleted,
   not switched off: a suppression rule is one tidy-up away from being undone,
   and a list of exceptions is a list somebody forgets to add to. */

/* The page owns its own gutters: the hero is a panel with a margin, the band
   runs edge to edge, and everything else sits in a 76rem column. No 100vw
   anywhere -- a viewport unit includes the scrollbar and is how a full-bleed
   band buys a horizontal scrollbar. */
body.page-landing { padding: 0 0 var(--s-8); }
.page-landing .wrap { max-width: none; }
.page-landing .inner { max-width: 76rem; margin: 0 auto; padding: 0 1.15rem; }
.page-landing .foot { max-width: 76rem; margin: var(--s-8) auto 0; padding: 0 1.15rem; }

/* THE ANODE GAUZE IS DELETED, and it resolved a contradiction DESIGN.md had
   been carrying rather than merely retiring a texture.
 *
 * The Struck palette listed '--gauze' as "the anode mesh, 1px on 4px, fixed,
 * over everything". Four sections earlier the same file says the interface
 * carries "no grain, scanlines, noise or vignette" and that "every trace of
 * texture on any page exists inside a tape frame". A 1px-on-4px repeating
 * gradient across the whole viewport is scanlines; the two rules could not both
 * be followed, and the mesh was only ever invisible enough to hide that.
 *
 * The texture rule is the stronger of the two -- it is the one that keeps the
 * chrome from competing with the artifact, which is the product's whole thesis
 * -- so the mesh goes and the rule stands. Deleted rather than suppressed, for
 * the reason the grain plate was: a 'display: none' naming today's pages is one
 * tidy-up away from being switched back on.
 *
 * THE BLOOM WENT WITH IT ON 2026-09-06. It was a soft radial glow tinted with
 * the accent of a world that no longer exists, laid over the whole viewport --
 * which is a texture on the ground by any other name, and this world's ground
 * and cards are flat. */

/* the hoisted landing state, same technique as the signed-in page: fixed, so
   focusing one can never scroll the document. */
.lstate { position: fixed; top: 0; left: 0; width: 1px; height: 1px; opacity: 0; margin: 0; pointer-events: none; }

/* ONBOARDING IS THE ONE PAGE LEFT WITH A PHOTOGRAPH BEHIND ITS WHOLE SELF, and
   these three rules are what it kept when the landing's ground became a band.

   The landing halves went with the full-bleed ground rather than with a taste
   change: its footer, its nav and its prose now sit on the flat dark ground,
   where the soft tier measures 7.67:1 and needs no lift at all. Onboarding
   still puts dim text over a blurred place, so it still needs the body ink and
   the shadow under it -- the measurement that put them here (2.86:1 over the
   brightest loop) is a property of text on a picture, and that is exactly the
   page that still has one. Size carries the hierarchy there, not colour,
   because colour is what compositing takes away. */
.has-ground .foot, .has-ground .foot .fine, .has-ground .foot .quiet {
  color: var(--ink);
  text-shadow: 0 1px 14px rgba(22, 22, 24, 0.7);
}
.has-ground .foot .quiet:hover { color: var(--lime); }

/* The still is not blurred to the wash a form wants behind it: 26px is right
   behind a form and wrong behind a picture whose whole argument is "this is
   somewhere you recognise". The band below takes the same value, and the loop
   when it plays is softer still -- see .bgv. */
.has-ground .bg { filter: blur(10px) saturate(0.8); }
/* When a loop is playing the generated per-place rules take this over with a
   value derived from that loop's own measured luma. */
.has-ground .scrim { opacity: 0.5; }

/* THE HERO. A lime panel with room at the foot for the tape to break out of. */
.hero { margin: var(--s-4) var(--s-4) 0; padding: 0 0 12rem; }
.hero-nav { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); flex-wrap: wrap; padding: var(--s-5) var(--s-6) 0; }
.hero-nav .wordmark { color: var(--on-lime); }
.hero-links { display: flex; gap: var(--s-5); }
.hero-links a { font-size: var(--t-label); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-lime); text-decoration: none; }
.hero-links a:hover { text-decoration: underline; text-underline-offset: 4px; }
.navpill, .hero-cta { display: inline-block; font-family: var(--display); text-transform: uppercase; letter-spacing: 0.02em; background: var(--on-lime); color: var(--lime); border-radius: var(--r-btn); text-decoration: none; }
.navpill { font-size: var(--d-2); padding: 0.5rem 0.9rem; }
.hero-cta { font-size: var(--d-2); padding: 0.8rem 1.6rem; }
.navpill:hover, .hero-cta:hover { color: var(--lime-hover); }
.hero-body { text-align: center; max-width: 48rem; margin: 0 auto; padding: var(--s-8) var(--s-5) var(--s-6); }
/* THE HERO IN THE DISPLAY FACE. It is the largest heading in the product and
   the one place --t-hero is used; uppercase, untracked, set tight at 0.9 so
   two lines read as one block, and held to twelve characters a line. The one
   thing that moved on 2026-09-06 is its colour: the hero sits on lime now. */
.hero-line { font-family: var(--display); font-size: var(--t-hero); line-height: 0.9; letter-spacing: 0; text-transform: uppercase; font-weight: 400; color: var(--on-lime); margin: 0 auto var(--s-5); max-inline-size: 12ch; text-wrap: balance; }
.hero-sub { color: var(--on-lime-soft); font-size: var(--t-3); line-height: 1.5; max-width: 46ch; margin: 0 auto var(--s-5); }
.hero-fine { font-size: var(--t-1); color: var(--on-lime-soft); margin: var(--s-3) 0 0; }
/* THE COUNTER RULER: tick marks along the panel's foot, the readout in the
   label role. A repeating gradient is a fill, not a border. */
.ruler { display: flex; justify-content: space-between; align-items: flex-end; height: 1.75rem; margin-top: var(--s-6); padding: 0 var(--s-6); font-size: var(--t-label); font-weight: 600; letter-spacing: 0.08em; color: var(--on-lime-soft); background-image: repeating-linear-gradient(to right, var(--on-lime) 0 1px, transparent 1px 12px); background-size: 100% 8px; background-repeat: no-repeat; background-position: 0 100%; }
.ruler span { background: var(--lime); padding: 0 3px; }
/* THE TAPE BREAKS OUT OF THE PANEL onto the dark ground -- the reference's
   move, and what makes the tape the largest thing on the first screen. */
.hero-tape { position: relative; z-index: 2; width: 82%; max-width: 76rem; margin: -10rem auto 0; }
.tape-media { display: block; width: 100%; aspect-ratio: 16 / 9; background: var(--card); border-radius: 8px; object-fit: cover; }
.tape-media--tall { aspect-ratio: 9 / 16; }
.tape-media--four { aspect-ratio: 4 / 3; }
.tape-cap { font-size: var(--t-label); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft); margin: var(--s-3) 0 0; }
.hero-tape .tape-cap, .demo-tape .tape-cap { text-align: left; }
@media (max-width: 48rem) {
  .hero { margin: var(--s-3) var(--s-3) 0; padding-bottom: 5rem; }
  .hero-nav { padding: var(--s-4) var(--s-4) 0; }
  .hero-links { order: 3; width: 100%; }
  .hero-body { padding: var(--s-7) var(--s-3) var(--s-5); }
  .hero-tape { width: calc(100% - 2.3rem); margin-top: -3.5rem; }
}

/* THE MANIFESTO: the giant sentence, lime and ink alternating by phrase, the
   stickers inline and tilted. */
.manifesto { padding: var(--s-8) 1.15rem; text-align: center; }
.manifesto-line { font-family: var(--display); text-transform: uppercase; font-size: var(--t-8); line-height: 1.05; letter-spacing: 0; margin: 0; color: var(--ink); text-wrap: balance; }
.manifesto-line .lit { color: var(--lime); }
.sticker { display: inline-block; height: 1em; width: auto; vertical-align: -0.15em; border-radius: 4px; margin: 0 0.1em; transform: rotate(-4deg); }
.sticker--2 { transform: rotate(3deg); }
.sticker--3 { transform: rotate(-2deg); }
.sticker--4 { transform: rotate(5deg); }

/* THE TWO CARDS. */
.how2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-5); padding-bottom: var(--s-8); }
.how-card { padding: var(--s-5); }
.card-t { font-family: var(--display); text-transform: uppercase; font-size: var(--d-3); line-height: 0.92; letter-spacing: 0; font-weight: 400; margin: 0 0 var(--s-4); color: var(--ink); }
.card-d { color: var(--ink-soft); margin: var(--s-4) 0 0; max-width: 46ch; }
.own-pair { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-2); }
.own-pair img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; }
@media (max-width: 48rem) { .how2 { grid-template-columns: 1fr; } }

/* the ghost stack: every place present at once, one struck */
/* THE OPTIONS ARE STILL A LIST IN THE MARKUP AND A RAIL ONLY HERE. They are a
   set of choices and a screen reader should meet them as one; horizontal is a
   presentation of that, not a different thing. Same scroll-snap mechanic as the
   place cards on the signed-in page, so the two screens answer a swipe the same
   way rather than inventing a second pattern.

   The gutters are negative margins against the menu's own padding, so the rail
   bleeds to the plate's edges: a row that stops short of them looks clipped,
   and a row that reaches them reads as continuing past the frame -- which it
   does. */
.lrail {
  list-style: none;
  display: flex; gap: var(--s-5);
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  margin: 0 calc(-1 * var(--s-5)) var(--s-4);
  padding: var(--s-1) var(--s-5) var(--s-3);
  scrollbar-width: thin;
  overscroll-behavior-x: contain;
  /* The bleed above is reaching for "this continues past the frame". Measured
     on the landing at 1280 it was not arriving: scrollWidth 3066 against a 736
     client, so SIX of the eight places sit outside the frame and the first
     thing outside it is a word cut in half. A guillotined word reads as broken
     rather than as scrollable, and the place list is the whole appeal -- a
     visitor who sees one and a half of them concludes there are two.
     The mask dissolves that edge instead of cutting it, which is the signal
     the bleed already wanted. It is not a border and not a divider: it is the
     absence of paint, which is the thing DESIGN.md's no-rules rule protects.
     Kept narrow so the last place is still legible once it is scrolled to. */
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - var(--s-6)), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - var(--s-6)), transparent);
}
.lrail li { margin: 0; flex: 0 0 auto; scroll-snap-align: center; }
.lrail .lopt { white-space: nowrap; }
.lopt {
  display: block; cursor: pointer;
  font-family: var(--display); font-size: var(--d-3); line-height: 1;
  text-transform: uppercase; letter-spacing: 0;
  color: var(--ink); opacity: var(--ghost); padding: var(--s-1) 0;
}
/* GHOSTS SIT AT THE FLOOR AND NO LOWER. A far dimmer unlit state measures
   about 1.4:1 and is a control nobody can read; at the floor a ghost still
   clears 4.5:1 and the unlit/struck distinction is carried by colour rather
   than by illegibility. The ghost test recomputes it. See DESIGN.md. */
/* THE INDEX TAKES THE OPTION'S OWN COLOUR. The rail's options are ghosted, and
   a colour step inside a ghosted control gets multiplied by the ghost while a
   size step does not -- so the index is distinguished at 0.5em and takes the
   same ink as the word beside it. The soft tier under this ghost measures
   2.21:1; the body ink clears the floor. */
.lopt .lidx { font-size: 0.5em; letter-spacing: 0.22em; color: var(--ink); margin-right: var(--s-3); vertical-align: 0.3em; }
.lopt:hover { opacity: 0.82; }

/* THE BAND: the place photograph across the whole width, the rail over it.
   The ground and the scrim are positioned inside the band rather than fixed
   to the viewport, which is the only change to a mechanism that is otherwise
   the 2026-08-27 landing's: the same hoisted radios, the same generated
   layers, the same script swapping the loop, the same per-place scrim. */
.band { position: relative; overflow: hidden; padding: var(--s-8) 0; color: var(--on-image); }
.band .bgs { position: absolute; inset: 0; z-index: 0; }
.band .bg { position: absolute; inset: -6%; filter: blur(10px) saturate(0.8); }
.band .scrim { position: absolute; inset: 0; z-index: 1; opacity: 0.5; }
.band-in { position: relative; z-index: 2; }
.band-t { font-family: var(--display); text-transform: uppercase; font-size: var(--d-4); line-height: 0.92; letter-spacing: 0; font-weight: 400; margin: 0 0 var(--s-5); color: var(--on-image); text-shadow: 0 1px 14px rgba(22, 22, 24, 0.7); }
.band .lopt { color: var(--on-image); text-shadow: 0 1px 14px rgba(22, 22, 24, 0.7); }
.band .lopt .lidx { color: var(--on-image); }
.band-hint { font-size: var(--t-1); color: var(--on-image-soft); margin: var(--s-3) 0 0; text-shadow: 0 1px 10px rgba(22, 22, 24, 0.85); }

/* THE BEFORE/AFTER WIPE.
   One custom property drives everything: the clip on the top half, where the
   divider sits, and nothing else. WIPE_SCRIPT sets it from a range input; the
   inline style on the figure is the no-script value, so the default state is a
   real 50/50 composite rather than an empty frame.

   NO BORDER ANYWHERE IN HERE. The divider is a filled 2px element, not a rule
   on a box, and the grip is a filled disc -- an outline round either would be
   a line drawn between two halves of one picture. */
  /* The no-script value, and it lives HERE rather than on a style attribute:
     style-src self refuses an inline style attribute outright, and a hash
     cannot rescue one -- that needs unsafe-hashes. Caught by the browser test,
     invisible to every markup assertion. */
.wipe { --wipe: 50%; }
.wipe {
  position: relative; margin: 0; aspect-ratio: 16 / 9; overflow: hidden;
  border-radius: 2px; background: var(--ground);
}
.wipe img { display: block; width: 100%; height: 100%; object-fit: cover; }
.wipe-under { position: absolute; inset: 0; }
/* The clipped half. 'clip-path' does not affect layout, which is why the
   browser test reads the resolved clip rather than a bounding rect. */
.wipe-clip {
  position: absolute; inset: 0;
  clip-path: polygon(0 0, var(--wipe) 0, var(--wipe) 100%, 0 100%);
}
.wipe-line {
  position: absolute; top: 0; bottom: 0; left: var(--wipe);
  width: 2px; margin-left: -1px; background: var(--ink);
  box-shadow: 0 0 12px rgba(22, 22, 24, 0.55);
}
/* THE GRIP IS DRAWN ONLY WHERE IT CAN BE DRAGGED. WIPE_SCRIPT adds
   'wipe--live'; with no script the figure is an honest static split, and a
   round handle sitting on that split would be a control that looks draggable
   and is not -- section 49D's dead own-place card, which passed every markup
   test it had because presence was never the thing that was wrong. */
.wipe-grip { display: none; }
.wipe--live .wipe-grip {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 2.75rem; height: 2.75rem; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--ink); color: var(--ground);
  box-shadow: 0 2px 18px rgba(22, 22, 24, 0.5);
}
.wipe-cap {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; justify-content: space-between;
  padding: var(--s-3) var(--s-4);
  font-size: var(--d-1); font-weight: 600; letter-spacing: 0.24em;
  text-transform: uppercase; color: var(--on-image); pointer-events: none;
  text-shadow: 0 1px 10px rgba(22, 22, 24, 0.85);
}
/* The control: a real range stretched over the picture, invisible because the
   divider and grip above ARE its thumb as far as a viewer is concerned.
   Pointer-down anywhere on the picture jumps it and begins a drag. */
.wipe-range {
  position: absolute; inset: 0; width: 100%; height: 100%;
  margin: 0; padding: 0; opacity: 0; cursor: ew-resize;
  -webkit-appearance: none; appearance: none; background: transparent;
}
.wipe-range::-webkit-slider-thumb { -webkit-appearance: none; width: 3rem; height: 100%; }
.wipe-range::-moz-range-thumb { width: 3rem; height: 100%; border: 0; opacity: 0; }
/* The ring has to be drawn on something visible, and the range itself is not.
   §16's ruling: the indicator belongs on the control a person can actually see.
   The combinator is ':has()' and not '~' on purpose: WIPE_SCRIPT appends the
   range LAST, so the divider it needs to reach is an EARLIER sibling and a
   general-sibling selector would match nothing at all -- silently, which is how
   a focus indicator goes missing for a year.
   The grip is drawn in ink, so its ring cannot be: it takes the go colour,
   which is the one thing on the page guaranteed to read against it. */
.wipe--live:has(.wipe-range:focus-visible) .wipe-grip {
  outline: 3px solid var(--lime); outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) { .wipe-grip { transition: none; } }

/* THE FACTS: three cards; Task 3 owns .fact. */
.facts3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-5); padding: var(--s-8) 0; }
@media (max-width: 48rem) { .facts3 { grid-template-columns: 1fr; } }

/* THE DEMO: the two other shapes standing on the ground, the button, and the
   flip counter in the tape's own readout face -- one of the three places it
   is allowed in the chrome. Static digits; nothing animates. */
.demo { text-align: center; padding: 0 1.15rem var(--s-8); }
.demo-t { font-family: var(--display); text-transform: uppercase; font-size: var(--t-8); line-height: 0.92; letter-spacing: 0; font-weight: 400; margin: 0 0 var(--s-6); color: var(--ink); }
.demo-tapes { display: grid; grid-template-columns: minmax(0, 9fr) minmax(0, 16fr); gap: var(--s-5); align-items: end; max-width: 56rem; margin: 0 auto var(--s-6); text-align: left; }
.demo-tape { margin: 0; }
/* BLOCK, OR THE AUTO MARGINS ARE A DECLARATION THAT DOES NOTHING. The shared
   button rule makes this inline-block, and auto side margins on an inline box
   centres nothing -- so the button and the counter below it stayed on ONE
   line, the button hard against the counter's first digit. Measured on the
   running page: the button at 179-321 and the counter starting at 325, twelve
   pixels apart vertically. Block-level with a max-content width keeps the pill
   hugging its label and puts the counter on its own line, where the section's
   own text-align centres it.

   AND IT NEEDS ITS OWN SURFACE. The shared rule paints this pill's background
   dark, which is right for a pill sitting ON the lime hero and wrong here,
   where the page behind it is dark too -- the fill and the ground read as one
   colour and the pill disappears, label and all. Lime means go, so this one
   inverts: a lime surface with a dark label, and the hover lifts the surface
   rather than recolouring the label to something that would fail against it. */
.demo-cta { display: block; width: max-content; margin: 0 auto; background: var(--lime); color: var(--on-lime); }
.demo-cta:hover { color: var(--on-lime); filter: brightness(1.06); }
.flip { display: inline-flex; gap: 0.3em; font-family: var(--osd); font-size: var(--t-8); color: var(--ink); margin: var(--s-6) auto 0; letter-spacing: 0.04em; }
.flip span { display: inline-block; background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 0.1em 0.3em; min-width: 1.1em; line-height: 1.1; }
.flip .gap { background: none; border: 0; min-width: 0.3em; padding: 0; }
/* THE COUNTER IS TEN FIXED BOXES IN A ROW THAT CANNOT WRAP, so its width is
   arithmetic rather than taste: eight digits at 1.1em plus eleven gaps of
   0.3em is 12.1em, whatever the em happens to be. At the display size that is
   484px, and the smallest width this product tests at is 320. Measured on the
   running page before this rule existed: 182px of horizontal scroll, and it
   was the ONLY thing on the landing escaping its clip. Wrapping was the other
   way out and is worse -- a date broken across two lines reads as damage --
   so the em comes down instead.

   AND IT COMES DOWN TWO STEPS RATHER THAN ONE, which is the measurement worth
   keeping. One step lands the row at 283px inside 283px of column: it fits,
   and it fits with nothing to spare, so the moment the readout face is not
   the one paint uses -- the swap before a self-hosted font arrives, or a
   machine that refuses it -- the digits widen and the page scrolls sideways
   again. A margin of zero is not a margin. Two steps leaves about a fifth of
   the column free, which is enough to absorb the fallback metrics. */
@media (max-width: 48rem) {
  .demo-tapes { grid-template-columns: 1fr; }
  .flip { font-size: var(--t-3); }
}

.foot { margin-top: var(--s-8); padding-top: 0; border-top: 0; color: var(--faint); font-size: var(--t-1); }
.foot p { margin: 0 0 0.4rem; }
.fine { color: var(--faint); }

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
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  // `image/x-icon` rather than the registered `image/vnd.microsoft.icon`: it is
  // what every browser has always sent and accepted for this file, and the
  // registered name is the one some of them do not paint.
  '.ico': 'image/x-icon',
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
 * @param {boolean} [opts.noStore]  a person's own media: never kept by any
 *   cache, the browser's included. `private, max-age=N` keeps a file out of
 *   SHARED caches and still lets the browser hold it, so on a shared machine a
 *   tape and its poster replay from cache after sign-out. A face is not worth
 *   a cache hit; the place photographs and the brand assets are nobody's and
 *   keep their `maxAge`.
 * @param {boolean} [opts.publicCache] `private` is the default, because most
 *   files served here are somebody's. The showcase is the one caller that
 *   says otherwise: those tapes and stills are the owner's own, chosen to be
 *   shown, and a shared cache (a CDN, a corporate proxy) is exactly where a
 *   landing-page hero benefits from sitting.
 */
export function sendFile(req, res, {
  file, contentType, maxAge = 0, noStore = false, download = null, fsImpl = fs, publicCache = false,
} = {}) {
  let stat;
  try {
    stat = fsImpl.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const type = contentType ?? contentTypeFor(file);
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const cacheControl = noStore ? 'no-store'
    : (maxAge > 0 ? `${publicCache ? 'public' : 'private'}, max-age=${maxAge}` : 'no-cache');
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': cacheControl,
    // This is the one path that serves bytes a user influenced -- their
    // photograph re-encoded, their tape. The declared type is final: a browser
    // invited to sniff is a browser that can be talked into treating a "video"
    // as something that executes. The policy says a file opened as a document
    // loads nothing at all, the resource stays on this origin, and no url of
    // ours rides out in a Referer. Mirrors the page and JSON paths, which have
    // always said most of this; the file path saying none of it was the gap.
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000',
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
