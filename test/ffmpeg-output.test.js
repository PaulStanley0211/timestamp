/**
 * The tests that actually run ffmpeg.
 *
 * These are on by default rather than hidden behind a flag, because ffmpeg is
 * local and free -- there is no reason to make the one part of the pipeline that
 * touches real pixels opt-in. They generate their own source from `testsrc2`, so
 * no video file is committed to the repository and a fresh clone can run them.
 *
 * If ffmpeg is missing the suite skips honestly rather than failing, because
 * "you do not have ffmpeg" and "the look is broken" are different problems and
 * should not produce the same red line.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFfmpeg, findFfmpeg, REPO_ROOT } from '../scripts/ffmpeg/run.mjs';
import { assertDeliveryContract, assertComposite, assertTapeGrade, assertBurnIn, regionStats } from '../scripts/ffmpeg/assert.mjs';
import { deliveryGeometry, tapeGeometry } from '../scripts/tapedeck/frame.mjs';
import { loadLookProfile, buildVideoFilter } from '../scripts/tapedeck/look.mjs';
import { burnInFilters, burnInProbeRegion } from '../scripts/tapedeck/burn-in.mjs';
import { gradeArgs, frameHashArgs } from '../scripts/tapedeck/grade.mjs';
import { resolveFont } from '../scripts/preflight/doctor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/render.json'), 'utf8'));
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/look/base.json'), 'utf8'));
const delivery = deliveryGeometry(cfg);
const tape = tapeGeometry(cfg);

async function haveFfmpeg() {
  try {
    await runFfmpeg(['-hide_banner', '-version']);
    return true;
  } catch {
    return false;
  }
}

const HAVE = await haveFfmpeg();
const skip = HAVE ? false : `ffmpeg not found (${findFfmpeg().ffmpeg}) -- pixel tests skipped`;

// Everything lands under build/, which is gitignored, and uses a distinct
// prefix so a failed run leaves inspectable artifacts rather than vanishing.
//
// THE PID IS NOT DECORATION. The names below are fixed literals, so every
// `node --test` on this checkout wants the same `build/test/contract.mp4`.
// Inside ONE run that is safe: this file and `audio-output.test.js` are the
// only two writing here, their names do not overlap, and neither is imported
// by another test file the way `provider-contract.test.js` imports
// `provider-fal.test.js`. Across TWO runs it is not safe. A second `npm test`
// started while the first is still going truncates the first's mp4s mid-read,
// and what surfaces is `moov atom not found` or a torn h264 bytestream,
// reported against whichever test happened to be reading rather than against
// the run that overwrote the file. It reads exactly like load or a real
// regression and is neither, which is what makes it expensive to chase.
//
// It therefore never fires on CI, which runs one suite at a time -- only on a
// developer machine running two, which is now routine on this checkout.
// Measured before this line existed: two concurrent suites claimed all SIX
// files under build/test in common, and the SAME NINE tests failed in both
// runs -- every one of them from these two files, and nothing else in the
// other 53. Measured after, the same way: 0 files shared, and not one of
// those nine failing in either run.
//
// The pid makes the directory this process's own -- the same fix, for the
// same class of shared-path race, as `c897845` (the fal test) and the tmp
// name in `scripts/auth/accounts.mjs`. It goes on the DIRECTORY rather than
// on each filename so that a test added here later is safe without its
// author having to know any of this.
const outDir = path.join(REPO_ROOT, 'build', 'test', String(process.pid));
if (HAVE) fs.mkdirSync(outDir, { recursive: true });

const SOURCE = { lavfi: `testsrc2=size=1280x720:rate=${cfg.fps}:duration=${cfg.durationSeconds}` };

const font = resolveFont();
const osd = { ...base.osd, enabled: Boolean(font.path), fontRelPath: font.path ?? base.osd.fontRelPath };

function graph({ withOsd = true } = {}) {
  const { look } = loadLookProfile(base);
  const effectiveOsd = { ...osd, enabled: withOsd && osd.enabled };
  return buildVideoFilter({ ...look, osd: effectiveOsd }, cfg, {
    burnIn: burnInFilters(effectiveOsd, { tape, delivery }),
  });
}

/** One full-length render, shared by the contract tests below. Rendering it
 *  once rather than per-test keeps the suite around half a minute. */
let rendered = null;
async function fullRender() {
  if (rendered) return rendered;
  const output = path.join(outDir, 'contract.mp4');
  await runFfmpeg(gradeArgs({ input: SOURCE, output, filterComplex: graph(), cfg }));
  rendered = output;
  return output;
}

test('the output honours the delivery contract exactly', { skip }, async () => {
  const file = await fullRender();
  const info = await assertDeliveryContract(file, cfg);
  const video = info.streams.find((s) => s.codec_type === 'video');
  // Stated plainly because it is the assertion the whole PAL decision bought:
  assert.equal(Number(video.nb_read_frames), 375);
  assert.equal(Number(video.nb_read_frames) / cfg.fps, 15);
});

test('the tape image is centred on a dark surround', { skip }, async () => {
  await assertComposite(await fullRender(), delivery);
});

test('blacks are milky and highlights are rolled off', { skip }, async () => {
  const stats = await assertTapeGrade(await fullRender(), delivery);
  assert.ok(stats.YMIN >= 10, `black floor lifted off zero, got ${stats.YMIN}`);
});

test('the grade desaturates relative to the source', { skip }, async () => {
  const clean = path.join(outDir, 'clean.mp4');
  await runFfmpeg([
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', SOURCE.lavfi,
    '-frames:v', '30', '-c:v', 'libx264', '-pix_fmt', cfg.encode.pixFmt, '-crf', '14', clean,
  ]);
  const before = await regionStats(clean, null);
  const after = await regionStats(await fullRender(), delivery.tapeCentre);
  assert.ok(after.SATAVG < before.SATAVG,
    `tape should fade colour: source SATAVG ${before.SATAVG}, graded ${after.SATAVG}`);
});

test('the date stamp actually rendered', { skip: skip || (!osd.enabled && 'no font available') }, async () => {
  // drawtext fails SILENTLY when fontfile cannot be resolved: it draws nothing,
  // ffmpeg exits 0, and every other assertion here still passes. This is the
  // only check that catches it.
  await assertBurnIn(await fullRender(), burnInProbeRegion(osd, delivery, tape));
});

test('the render is bit-identical across five runs (purity)', { skip }, async () => {
  // Five, not two. The gblur-on-short-frames nondeterminism passed a two-run
  // check and then failed six times out of six -- slice-threaded filters vary
  // per run when the frame is shorter than the thread count.
  const hashes = [];
  for (let i = 0; i < 5; i += 1) {
    const { stdout } = await runFfmpeg(frameHashArgs({ input: SOURCE, filterComplex: graph(), cfg }));
    hashes.push(stdout.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).join('\n'));
  }
  const unique = new Set(hashes);
  assert.equal(unique.size, 1,
    `${unique.size} distinct outputs across 5 runs -- something in the graph is nondeterministic. ` +
    'Suspect a slice-threaded filter on a short frame, an unseeded noise source, or a wall-clock read.');
});

test('output is identical regardless of filter thread count', { skip }, async () => {
  const hashes = [];
  for (const threads of ['1', '2', '4', '8']) {
    const { stdout } = await runFfmpeg(
      frameHashArgs({ input: SOURCE, filterComplex: graph(), cfg: { ...cfg, encode: { ...cfg.encode, filterComplexThreads: threads } } }),
    );
    hashes.push(stdout.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).join('\n'));
  }
  assert.equal(new Set(hashes).size, 1, 'thread count must not change the picture');
});

test('a broken filtergraph fails loudly with the ffmpeg error attached', { skip }, async () => {
  await assert.rejects(
    runFfmpeg(gradeArgs({
      input: SOURCE,
      output: path.join(os.tmpdir(), 'timestamp-should-not-exist.mp4'),
      filterComplex: '[0:v]nosuchfilter=1[vout]',
      cfg,
    })),
    (err) => {
      assert.equal(err.name, 'FfmpegError');
      // The message must name the thing that broke. ffmpeg 8.1 phrases an
      // unknown filter as a filterchain parse error rather than "No such
      // filter", so assert on the offending name rather than on the wording.
      assert.match(err.message, /nosuchfilter/);
      // The exit code is the OS's to spell, not ffmpeg's: the same EINVAL comes
      // back as -22 on Windows (through the unsigned-32 wrap normalizeExitCode
      // undoes) and as 234 on POSIX, which truncates it to 8 bits. Measured:
      // asserting -22 was one of the two Linux CI reds. Assert the property --
      // ffmpeg RAN and FAILED -- and leave the wrap itself to ffmpeg-run.test.js,
      // which asserts normalizeExitCode(4294967274) === -22 on a literal and so
      // tests it identically on both platforms. Integer, not merely non-zero:
      // a code of null is how run() reports a process that never started, and
      // that must not read as a filtergraph rejection.
      assert.ok(Number.isInteger(err.code) && err.code !== 0,
        `expected a non-zero integer exit code from a failed ffmpeg, got ${err.code}`);
      assert.ok(err.stderr.length > 0, 'the full stderr is attached for diagnosis');
      return true;
    },
  );
});
