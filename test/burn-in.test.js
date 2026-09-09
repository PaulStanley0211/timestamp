import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('the stamp clock follows the time of day the place is set in', () => {
  // A DATE STAMP THAT CONTRADICTS THE PICTURE UNDOES THE PICTURE. Until
  // 2026-09-09 the hour came from the seed alone -- "afternoons and evenings",
  // 13 to 21, for every place in the catalogue. So the Amalfi tape the owner
  // made on a sunlit afternoon was stamped 20:33, and the kitchen preset, whose
  // whole subject is breakfast, could be stamped at five in the afternoon.
  const cases = [
    ['early morning', 6, 9],
    ['midday', 11, 14],
    ['afternoon', 13, 17],
    ['late afternoon', 15, 18],
    ['night', 19, 23],
  ];
  for (const [timeOfDay, lo, hi] of cases) {
    for (const seed of [0, 1, 42, 999, 20030714, 88888888]) {
      const { timeText } = deriveStamp(seed, { timeOfDay });
      const hour = Number(timeText.split(':')[0]);
      assert.ok(hour >= lo && hour <= hi,
        `a ${timeOfDay} scene stamped ${timeText} (seed ${seed}) -- wanted ${lo}..${hi}`);
    }
  }
});

test('the stamp month follows the season the place is set in', () => {
  // Same argument one axis over: the Amalfi coast is a warm place and was
  // stamped 02 JAN. An indoor place constrains nothing, because a kitchen
  // table looks the same in March as in October.
  const cases = [
    ['warm', ['MAY', 'JUN', 'JUL', 'AUG', 'SEP']],
    ['mild', ['APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT']],
    ['cool', ['MAR', 'APR', 'MAY', 'SEP', 'OCT', 'NOV']],
    ['cold', ['NOV', 'DEC', 'JAN', 'FEB', 'MAR']],
  ];
  for (const [climate, allowed] of cases) {
    const seen = new Set();
    for (const seed of [0, 1, 42, 999, 20030714, 88888888, 3, 77, 512, 4096]) {
      const month = deriveStamp(seed, { climate }).dateText.split(' ')[1];
      assert.ok(allowed.includes(month),
        `a ${climate} scene stamped ${month} -- wanted one of ${allowed.join(', ')}`);
      seen.add(month);
    }
    // Not pinned to one month either, or the stamp stops being a detail and
    // becomes a signature every tape of that place shares.
    assert.ok(seen.size > 1, `every ${climate} seed gave the same month, ${[...seen][0]}`);
  }

  const indoorMonths = new Set([0, 1, 42, 999, 20030714, 88888888, 3, 77, 512, 4096]
    .map((s) => deriveStamp(s, { climate: 'indoor' }).dateText.split(' ')[1]));
  assert.ok(indoorMonths.size > 5, 'an indoor place should not be pinned to a season');
});

test('a scene changes the stamp without making it unrepeatable', () => {
  const scene = { timeOfDay: 'afternoon', climate: 'warm' };
  assert.deepEqual(deriveStamp(20030714, scene), deriveStamp(20030714, scene));
  assert.notDeepEqual(deriveStamp(20030714, scene), deriveStamp(20030714));

  // AND NO SCENE MUST STILL WORK, unchanged: `npm run look` grades an arbitrary
  // clip with no place behind it at all, and the CLI has no place to pass.
  const bare = deriveStamp(20030714);
  assert.match(bare.dateText, /^\d{2} [A-Z]{3} (1999|200[0-5])$/);
  const hour = Number(bare.timeText.split(':')[0]);
  assert.ok(hour >= 13 && hour <= 21, `bare stamp gave ${bare.timeText}`);
});

test('the pipeline hands the place to the stamp', () => {
  // A UNIT TEST OF deriveStamp CANNOT SEE A CALL SITE THAT FORGOT TO PASS THE
  // PLACE, and that shape -- a value that exists, is correct, and is simply not
  // handed on -- is the one this project has shipped most often. So the check
  // is on the call itself. The look CLI is deliberately NOT covered: it grades
  // an arbitrary clip and has no place to give.
  // COMMENT-STRIPPED, because pipeline.mjs's own header explains the stamp by
  // writing `deriveStamp(seed)` in prose, and a structural test that matches
  // its own documentation is not testing the code.
  const source = fs.readFileSync(new URL('../scripts/render/pipeline.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const call = source.match(/deriveStamp\([^)]*\)/g) ?? [];
  assert.ok(call.length > 0, 'the pipeline no longer stamps anything');
  for (const c of call) {
    assert.match(c, /deriveStamp\(\s*[^,)]+,\s*[^)]+\)/,
      `the pipeline derives a stamp with no scene behind it: ${c}`);
    assert.match(c, /place/, `the scene handed to the stamp is not the place: ${c}`);
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
