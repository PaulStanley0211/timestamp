import test from 'node:test';
import assert from 'node:assert/strict';
import { ffFontPath, ffEscapeText, deriveStamp, burnInFilters, burnInProbeRegion } from '../scripts/tapedeck/burn-in.mjs';

test('a relative font path needs no escaping at all', () => {
  // This is why every caller spawns ffmpeg with cwd set to the repo root: no
  // drive letter means no colon, and drawtext treats a colon as the end of the
  // option value.
  assert.equal(ffFontPath('assets/fonts/tape-osd.ttf'), "'assets/fonts/tape-osd.ttf'");
  assert.equal(ffFontPath('assets\\fonts\\tape-osd.ttf'), "'assets/fonts/tape-osd.ttf'");
});

test('a Windows absolute font path has its drive-letter colon escaped', () => {
  // The unescaped and backslash forms both fail; this is the one that works.
  assert.equal(ffFontPath('C:\\Windows\\Fonts\\consola.ttf'), "'C\\:/Windows/Fonts/consola.ttf'");
  assert.equal(ffFontPath('C:/Windows/Fonts/consola.ttf'), "'C\\:/Windows/Fonts/consola.ttf'");
});

test('a POSIX absolute path is left alone', () => {
  assert.equal(ffFontPath('/usr/share/fonts/x.ttf'), "'/usr/share/fonts/x.ttf'");
});

test('colons in the time are escaped so drawtext does not truncate the option', () => {
  assert.equal(ffEscapeText('20:42'), '20\\:42');
  assert.equal(ffEscapeText('100%'), '100\\%');
  assert.equal(ffEscapeText('a\\b'), 'a\\\\b');
});

test('the same seed always derives the same stamp', () => {
  const a = deriveStamp(20030714);
  const b = deriveStamp(20030714);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, deriveStamp(20030715));
});

test('derived stamps land in the camcorder era and are well formed', () => {
  for (const seed of [0, 1, 42, 999, 20030714, 88888888]) {
    const { dateText, timeText } = deriveStamp(seed);
    assert.match(dateText, /^\d{2} [A-Z]{3} (1999|200[0-5])$/, `bad date for seed ${seed}: ${dateText}`);
    assert.match(timeText, /^\d{2}:\d{2}$/, `bad time for seed ${seed}: ${timeText}`);
    const [h, m] = timeText.split(':').map(Number);
    assert.ok(h >= 13 && h <= 21, `home video is not shot at ${h}:00`);
    assert.ok(m >= 0 && m <= 59);
  }
});

test('a disabled OSD emits no filters', () => {
  assert.deepEqual(burnInFilters({ enabled: false }, {}), []);
  assert.deepEqual(burnInFilters(undefined, {}), []);
});

test('an enabled OSD emits two shadowed drawtext lines', () => {
  const filters = burnInFilters({
    enabled: true, fontRelPath: 'assets/fonts/tape-osd.ttf',
    dateText: '14 JUL 2003', timeText: '20:42',
    color: '0xF6EAC8', size: 20, marginX: 30, marginY: 28, lineGap: 24,
  }, {});

  assert.equal(filters.length, 2);
  for (const f of filters) {
    assert.match(f, /^drawtext=/);
    assert.match(f, /fontfile='assets\/fonts\/tape-osd\.ttf'/);
    // Without the shadow the glyphs turn to mush once the tape stage has
    // decimated the chroma, grained them and upscaled them 1.5x.
    assert.match(f, /shadowx=1:shadowy=1/);
    assert.match(f, /x=w-tw-30/);
  }
  assert.match(filters[0], /text='14 JUL 2003'/);
  assert.match(filters[1], /text='20\\:42'/);
  // The date sits above the time.
  assert.match(filters[0], /y=h-th-52/);
  assert.match(filters[1], /y=h-th-28/);
});

test('the probe region sits inside the tape image, bottom right', () => {
  const delivery = { offsetX: 0, offsetY: 555, tapeDisplayWidth: 1080, tapeDisplayHeight: 810 };
  const region = burnInProbeRegion({ enabled: true }, delivery, { width: 720, height: 576 });
  assert.ok(region.x > delivery.tapeDisplayWidth / 2, 'must be in the right half');
  assert.ok(region.y > delivery.offsetY + delivery.tapeDisplayHeight / 2, 'must be in the bottom half');
  assert.ok(region.x + region.w <= delivery.offsetX + delivery.tapeDisplayWidth);
  assert.ok(region.y + region.h <= delivery.offsetY + delivery.tapeDisplayHeight);
});
