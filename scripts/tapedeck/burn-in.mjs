/**
 * The camcorder date stamp. Pure string building -- this module never touches
 * the filesystem, so it cannot tell you whether the font it names actually
 * exists. Resolving that is the caller's job (see doctor.mjs and look-cli.mjs),
 * which is what keeps this file unit-testable against golden strings.
 *
 * Two things here are load-bearing.
 *
 * WHERE THE STAMP SITS IN THE CHAIN. A real camcorder's character generator
 * wrote the date into the signal before it reached the tape. The stamp was
 * therefore recorded, and it suffered chroma bleed, softness, grain and
 * head-switching exactly like the rest of the image -- but it never picked up
 * lens artifacts, because it was added after the glass. So drawtext belongs
 * after the grade and before the tape stage. This is not a compromise, it is
 * the physically correct placement, and it also happens to be the difference
 * between "found footage" and "someone put a VHS filter on a 4K video": a crisp
 * modern-resolution date floating over a degraded image is the single most
 * common tell of a fake.
 *
 * WHAT THE TEXT IS ALLOWED TO BE. Never `%{localtime}`, never
 * `expansion=strftime` -- the first reads the wall clock and destroys
 * reproducibility outright, and the second is deprecated in this ffmpeg build
 * anyway. The string is computed in Node, from the seed, and passed as a
 * literal.
 */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const ALL_MONTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/**
 * WHY THE STAMP TAKES THE SCENE AND NOT ONLY THE SEED.
 *
 * A date stamp that contradicts the picture undoes the picture, and it does it
 * in the one place a viewer is most likely to look for proof. The Amalfi tape
 * the owner made on 2026-09-09 was a sunlit afternoon on a warm coast, stamped
 * `02 JAN 1999  20:33` -- January, after dark. Every element of that stamp was
 * correct by its own rules and the result was a small lie in the corner of a
 * product whose entire claim is that the tape looks real.
 *
 * These tables are deliberately RANGES rather than fixed values. Pinning the
 * hour would make every tape of a place share a signature, which is its own
 * tell; the seed still chooses, it just chooses inside the scene's own day.
 *
 * A place with neither field constrains nothing and falls back to what this
 * function has always done, which is what `npm run look` gets -- it grades an
 * arbitrary clip with no place behind it at all.
 */
const HOURS_BY_TIME_OF_DAY = Object.freeze({
  'early morning': [6, 9],
  morning: [8, 11],
  midday: [11, 14],
  afternoon: [13, 17],
  'late afternoon': [15, 18],
  evening: [18, 21],
  dusk: [18, 21],
  night: [19, 23],
});

/** Afternoons and evenings, which is when home video was actually shot. */
const DEFAULT_HOURS = [13, 21];

const MONTHS_BY_CLIMATE = Object.freeze({
  warm: [4, 5, 6, 7, 8],              // May to September
  mild: [3, 4, 5, 6, 7, 8, 9],        // April to October
  cool: [2, 3, 4, 8, 9, 10],          // the shoulders: March to May, September to November
  cold: [10, 11, 0, 1, 2],            // November to March
  // `indoor` is deliberately absent. A kitchen table looks the same in March
  // as in October, so constraining it would invent a fact the picture does not
  // carry -- and it would throw away eleven twelfths of the variety for nothing.
});

/**
 * Turn a font path into something `fontfile=` will accept.
 *
 * A relative path with forward slashes is the supported route and needs no
 * escaping at all: no drive letter means no colon, and drawtext treats a colon
 * as the end of the option. Callers spawn ffmpeg with `cwd` set to the repo
 * root precisely so this stays possible.
 *
 * The absolute fallback exists for the case where no font is bundled yet. On
 * Windows the drive-letter colon must be backslash-escaped and the separators
 * flipped -- `C\:/Windows/Fonts/consola.ttf` -- and the whole thing quoted.
 * Verified working; the unescaped and backslash forms both fail.
 */
export function ffFontPath(fontPath) {
  const forward = String(fontPath).replace(/\\/g, '/');
  const isAbsolute = /^[A-Za-z]:\//.test(forward) || forward.startsWith('/');
  if (!isAbsolute) return `'${forward}'`;
  return `'${forward.replace(/^([A-Za-z]):/, '$1\\:')}'`;
}

/** Escape a literal for a quoted drawtext `text=` value. Order matters:
 *  backslashes first, or you double-escape what you just inserted. */
export function ffEscapeText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\\\\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');
}

/**
 * Derive a plausible tape date from the seed.
 *
 * Same seed, same date, forever -- which is what makes a render reproducible.
 * The window is 1999-2005 because that is the consumer camcorder era this is
 * imitating; a stamp reading 2011 would quietly undermine every other choice in
 * the chain.
 */
export function deriveStamp(seed, scene = {}) {
  const n = Math.abs(Math.trunc(Number(seed) || 0));
  const year = 1999 + (n % 7);

  const months = MONTHS_BY_CLIMATE[String(scene.climate ?? '').toLowerCase()] ?? ALL_MONTHS;
  const monthIndex = months[Math.trunc(n / 7) % months.length];

  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const day = 1 + (Math.trunc(n / 84) % daysInMonth);

  const [from, to] = HOURS_BY_TIME_OF_DAY[String(scene.timeOfDay ?? '').toLowerCase()] ?? DEFAULT_HOURS;
  const hour = from + (Math.trunc(n / 2400) % (to - from + 1));
  const minute = Math.trunc(n / 17) % 60;

  return {
    dateText: `${String(day).padStart(2, '0')} ${MONTHS[monthIndex]} ${year}`,
    timeText: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

/**
 * Build the drawtext fragments for the stamp, as an array of filter strings to
 * be joined into the chain with commas.
 *
 * The one-pixel shadow is not decoration. By the time the tape stage has had
 * its way -- chroma decimated, smeared, grained and dragged through a 1.5x
 * anamorphic upscale -- unshadowed glyphs at this size lose their edges and
 * turn to mush. The shadow is what keeps the date legible after it has been
 * correctly ruined.
 */
export function burnInFilters(osd, geometry) {
  if (!osd?.enabled) return [];

  const font = ffFontPath(osd.fontRelPath);
  const colour = osd.color ?? '0xF6EAC8';
  const size = osd.size ?? 20;
  const marginX = osd.marginX ?? 30;
  const marginY = osd.marginY ?? 28;
  const lineGap = osd.lineGap ?? 24;

  const edge = osd.edgeColor ?? '0x1A1206';
  const borderWidth = osd.borderWidth ?? 1;

  const common = [
    `fontfile=${font}`,
    `fontcolor=${colour}`,
    `fontsize=${size}`,
    // THE BORDER IS WHAT MAKES THE STAMP READABLE OVER A BRIGHT SCENE, and it
    // is not the same job as the shadow below it. A one-sided shadow separates
    // the glyph from the ground on ONE side, which is enough on a dark street
    // and not enough on pale stone: measured on a real Amalfi tape 2026-09-09,
    // cream glyphs on sunlit limestone left 3.0 of ink out of 255 and the owner
    // could not find the date at all. A closed dark edge means the glyph is
    // read against its own outline whatever is behind it. Real character
    // generators did exactly this, for exactly this reason.
    `bordercolor=${edge}`,
    `borderw=${borderWidth}`,
    // The shadow stays and still earns its place: it gives the stamp a
    // direction and a little depth, which a flat outline alone does not.
    `shadowcolor=${edge}`,
    'shadowx=1',
    'shadowy=1',
  ];

  // Bottom-right, date above time -- the layout most consumer camcorders of the
  // era used, and the corner least likely to sit over a face.
  return [
    ['drawtext', [
      `text='${ffEscapeText(osd.dateText)}'`,
      `x=w-tw-${marginX}`,
      `y=h-th-${marginY + lineGap}`,
      ...common,
    ].join(':')].join('='),
    ['drawtext', [
      `text='${ffEscapeText(osd.timeText)}'`,
      `x=w-tw-${marginX}`,
      `y=h-th-${marginY}`,
      ...common,
    ].join(':')].join('='),
  ];
}

/**
 * Where the stamp lands in the finished 1080x1920 frame, so a test can assert
 * that glyphs are actually present. This catches the classic silent failure:
 * `fontfile` fails to resolve, drawtext renders nothing at all, ffmpeg exits 0,
 * and you ship a hundred videos with no date on them.
 */
export function burnInProbeRegion(osd, delivery, tape) {
  const scale = delivery.tapeDisplayWidth / tape.width;
  const boxW = Math.round(320 * scale);
  const boxH = Math.round(110 * scale);
  return {
    x: delivery.offsetX + delivery.tapeDisplayWidth - boxW - Math.round(8 * scale),
    y: delivery.offsetY + delivery.tapeDisplayHeight - boxH - Math.round(8 * scale),
    w: boxW,
    h: boxH,
  };
}
