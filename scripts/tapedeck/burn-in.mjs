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
export function deriveStamp(seed) {
  const n = Math.abs(Math.trunc(Number(seed) || 0));
  const year = 1999 + (n % 7);
  const monthIndex = Math.trunc(n / 7) % 12;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const day = 1 + (Math.trunc(n / 84) % daysInMonth);
  // Evenings and afternoons. Home video was not shot at 4am.
  const hour = 13 + (Math.trunc(n / 2400) % 9);
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

  const common = [
    `fontfile=${font}`,
    `fontcolor=${colour}`,
    `fontsize=${size}`,
    'shadowcolor=0x1A1206',
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
