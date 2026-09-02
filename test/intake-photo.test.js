/**
 * Photo intake, and in particular the one property in this file that is not a
 * convenience: **the copy we keep carries no metadata**.
 *
 * A stripper without a test is a claim. `ingestPhoto` says `stripped: true` in
 * its return value, which is a string in an object and would go on saying it
 * long after an ffmpeg upgrade or a changed argument list stopped making it
 * true. So the assertions below read the output back through ffprobe and look
 * for metadata in all four places it can hide -- container format tags, stream
 * tags, frame tags and frame side data -- and then grep the raw bytes for the
 * GPS coordinates that were definitely in the input. That is what turns
 * "we pass -map_metadata -1" into a property.
 *
 * HOW THE FIXTURES WERE MADE, since regenerating them should not require
 * archaeology. All five are ffmpeg `lavfi` sources, one frame, committed at
 * about 12 KB each:
 *
 *   portrait.jpg          testsrc2=size=480x640          a plausible upload
 *   tiny.jpg              testsrc2=size=64x64            under LIMITS.minEdge
 *   oversized.jpg         color=size=8200x512            over LIMITS.maxEdge, but
 *                                                        flat colour so the FILE is small
 *   disguised.jpg         color=size=320x320 -f gif      a GIF wearing a .jpg name
 *   exif-orientation.jpg  portrait.jpg + a hand-built APP1 segment carrying
 *                         Orientation=6 and GPS 52°31'12.34"N 13°24'56.78"E
 *
 * The EXIF fixture is spliced rather than written by ffmpeg because ffmpeg has
 * no encoder option that writes an EXIF orientation tag -- it only reads them.
 * The segment is a standard big-endian TIFF block inserted after the APP0/JFIF
 * marker: IFD0 with Orientation plus a GPS IFD pointer, and a GPS IFD with
 * latitude and longitude as three rationals each.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runFfmpeg, runFfprobe, findFfmpeg } from '../scripts/ffmpeg/run.mjs';
import {
  IntakeError, LIMITS, PERMISSIVE_FACE_GATE, faceGate, ingestPhoto, inspectPhoto,
} from '../scripts/intake/photo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'test', 'fixtures', 'photo');
const fixture = (name) => path.join(FIX, name);

async function haveFfmpeg() {
  try {
    await runFfmpeg(['-hide_banner', '-version']);
    return true;
  } catch {
    return false;
  }
}
const HAVE = await haveFfmpeg();
const skip = HAVE ? false : `ffmpeg not found (${findFfmpeg().ffmpeg}) -- intake tests skipped`;

// build/ is gitignored, and a distinct prefix means a failed run leaves the
// offending file behind to be looked at rather than vanishing.
//
// The pid goes on the DIRECTORY, not on each filename -- same fix as `c897845`
// and `accounts.mjs`, and deliberately at this level so a test added below is
// safe without its author having to know any of this. Two suites running at
// once on one checkout is routine here; without the pid both processes claimed
// all six of these paths, and the second run truncates the first mid-read.
const outDir = path.join(ROOT, 'build', 'test-intake', String(process.pid));
if (HAVE) fs.mkdirSync(outDir, { recursive: true });
const out = (name) => path.join(outDir, name);

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Every place ffprobe will admit to metadata living. `format_tags:stream_tags`
 *  is the pair named in docs/interfaces.md; the frame section is added because
 *  measurement showed that a JPEG's EXIF lands there and NOT in either of the
 *  other two -- an assertion on the documented pair alone passes against an
 *  untouched input file, which would make it a test of nothing. */
async function metadataOf(file) {
  const tags = JSON.parse((await runFfprobe([
    '-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', file,
  ])).stdout);
  const frames = JSON.parse((await runFfprobe([
    '-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+#1',
    '-show_frames', '-of', 'json', file,
  ])).stdout);
  const frame = (frames.frames ?? frames.packets_and_frames ?? [])
    .find((f) => (f.type ?? 'frame') === 'frame') ?? {};
  return {
    formatTags: tags.format?.tags ?? {},
    streamTags: tags.streams?.[0]?.tags ?? {},
    frameTags: frame.tags ?? {},
    sideData: (frame.side_data_list ?? []).map((s) => s.side_data_type),
  };
}

// ---------------------------------------------------------------------------
// inspection
// ---------------------------------------------------------------------------

test('inspectPhoto reports the facts about a clean upload', { skip }, async () => {
  const info = await inspectPhoto(fixture('portrait.jpg'));
  assert.equal(info.width, 480);
  assert.equal(info.height, 640);
  assert.equal(info.format, 'image/jpeg');
  assert.equal(info.bytes, fs.statSync(fixture('portrait.jpg')).size);
  assert.equal(info.sha256, sha256(fixture('portrait.jpg')));
  assert.equal(info.hasExif, false);
  assert.equal(info.orientation, 1);
});

test('inspectPhoto sees the EXIF block and reconstructs the orientation', { skip }, async () => {
  const info = await inspectPhoto(fixture('exif-orientation.jpg'));
  assert.equal(info.hasExif, true);
  // 6 is "rotate 90 clockwise to display", the way a phone held sideways writes
  // it. ffmpeg reports it as rotation -90, which alone cannot be told apart
  // from the mirrored orientations -- the display matrix can, and does.
  assert.equal(info.orientation, 6);
  assert.equal(info.width, 480);
  assert.equal(info.height, 640);
});

test('inspectPhoto refuses a file below the minimum edge, and says why in plain words', { skip }, async () => {
  const err = await inspectPhoto(fixture('tiny.jpg')).catch((e) => e);
  assert.ok(err instanceof IntakeError);
  assert.equal(err.code, 'too-small');
  assert.match(err.userMessage, /256/);
  assert.match(err.userMessage, /64 by 64/);
});

test('inspectPhoto refuses a file above the maximum edge', { skip }, async () => {
  const err = await inspectPhoto(fixture('oversized.jpg')).catch((e) => e);
  assert.ok(err instanceof IntakeError);
  assert.equal(err.code, 'too-large');
  assert.deepEqual(err.detail, { width: 8200, height: 512, maxEdge: LIMITS.maxEdge });
});

test('inspectPhoto sniffs the content, not the extension', { skip }, async () => {
  // disguised.jpg is a GIF. If intake trusted the filename this would pass, and
  // an animated GIF would reach a provider that charges per still.
  const err = await inspectPhoto(fixture('disguised.jpg')).catch((e) => e);
  assert.ok(err instanceof IntakeError);
  assert.equal(err.code, 'unsupported-format');
  assert.equal(err.detail.codec, 'gif');
  assert.match(err.userMessage, /JPEG, PNG or WebP/);
});

test('inspectPhoto refuses a missing file without spawning anything', async () => {
  const ffprobeImpl = () => { throw new Error('ffprobe must not be reached for a file that is not there'); };
  const err = await inspectPhoto(path.join(FIX, 'no-such-file.jpg'), { ffprobeImpl }).catch((e) => e);
  assert.ok(err instanceof IntakeError);
  assert.equal(err.code, 'unreadable');
});

test('the byte cap is enforced before the file is decoded', async () => {
  // The cheap check has to come first: it is the only limit that also protects
  // the machine doing the probing from a deliberately enormous upload.
  const fsImpl = { statSync: () => ({ isFile: () => true, size: LIMITS.maxBytes + 1 }) };
  const ffprobeImpl = () => { throw new Error('ffprobe was reached for an over-size file'); };
  const err = await inspectPhoto('anything.jpg', { fsImpl, ffprobeImpl }).catch((e) => e);
  assert.ok(err instanceof IntakeError);
  assert.equal(err.code, 'too-large');
  assert.equal(err.detail.bytes, LIMITS.maxBytes + 1);
});

test('the pixel cap is read off the stream header, before any frame is decoded', async () => {
  // Decoding is where an attacker-shaped file does its work -- a 9000x9000
  // declared frame is a 243 MB allocation before the cap has been consulted.
  // The header alone says how big the picture claims to be, so that is what
  // the cap reads first; a frame is asked for only from a file already inside
  // every limit.
  const calls = [];
  const ffprobeImpl = async (args) => {
    calls.push(args);
    if (args.includes('-show_frames')) throw new Error('a frame was decoded from a file over the pixel cap');
    return { stdout: JSON.stringify({ streams: [{ codec_name: 'mjpeg', width: 9000, height: 9000 }] }) };
  };
  const fsImpl = { statSync: () => ({ isFile: () => true, size: 1_000 }) };
  const err = await inspectPhoto('huge.jpg', { fsImpl, ffprobeImpl }).catch((e) => e);
  assert.ok(err instanceof IntakeError, `expected an IntakeError, got ${err?.message}`);
  assert.equal(err.code, 'too-large');
  assert.equal(err.detail.width, 9000);
  assert.ok(calls.length >= 1, 'the header was probed');
  assert.ok(calls.every((a) => !a.includes('-show_frames')), 'and no frame was ever asked for');
});

test('every ffprobe and ffmpeg call on an upload forbids every protocol but the local file', async () => {
  // A stock ffmpeg already refuses network protocols for file-origin input;
  // stating the whitelist makes that a property of this code rather than of
  // whichever build is installed. It must precede `-i`, or it does not apply
  // to the input at all.
  const probes = [];
  const encodes = [];
  const ffprobeImpl = async (args) => { probes.push(args); return runFfprobe(args); };
  const ffmpegImpl = async (args) => { encodes.push(args); return runFfmpeg(args); };
  const src = path.join(FIX, 'portrait.jpg');
  const dest = path.join(os.tmpdir(), `ts-intake-whitelist-${process.pid}.jpg`);
  await ingestPhoto(src, dest, { ffprobeImpl, ffmpegImpl });
  fs.rmSync(dest, { force: true });

  assert.ok(probes.length >= 1 && encodes.length === 1, `${probes.length} probes, ${encodes.length} encodes`);
  for (const args of [...probes, ...encodes]) {
    const at = args.indexOf('-protocol_whitelist');
    assert.notEqual(at, -1, `no whitelist on: ${args.join(' ')}`);
    assert.equal(args[at + 1], 'file', 'the local file, and nothing else');
    // ffmpeg names its input with `-i`; ffprobe takes it as the last argument
    // -- and the ingest probes the DESTINATION too, so the last argument is
    // the honest position rather than a search for the source path.
    const input = args.indexOf('-i');
    const file = args.length - 1;
    assert.ok(at < (input === -1 ? file : input), 'the whitelist must come before the input it governs');
  }
});

test('no IntakeError leaks a filesystem path to the user', { skip }, async () => {
  const provoke = [
    () => inspectPhoto(fixture('tiny.jpg')),
    () => inspectPhoto(fixture('oversized.jpg')),
    () => inspectPhoto(fixture('disguised.jpg')),
    () => inspectPhoto(path.join(FIX, 'absent.jpg')),
  ];
  for (const fn of provoke) {
    const err = await fn().catch((e) => e);
    assert.ok(err instanceof IntakeError, 'expected an IntakeError');
    // The developer-facing message may name the file. The user-facing one may
    // not: it is rendered into a page served to a stranger.
    assert.ok(err.message.length > 0);
    assert.doesNotMatch(err.userMessage, /[\\/]|\.jpg|C:/i, `leaked a path: ${err.userMessage}`);
  }
});

// ---------------------------------------------------------------------------
// the load-bearing property
// ---------------------------------------------------------------------------

test('the fixture really does carry EXIF and GPS, or the strip test proves nothing', { skip }, async () => {
  const meta = await metadataOf(fixture('exif-orientation.jpg'));
  // What ffprobe CALLS this metadata differs by build, so naming one build's
  // spelling tests the build and not the file. Measured on both CI images:
  // ffprobe 8.1 (windows-latest) reports side_data ['3x3 displaymatrix',
  // 'EXIF metadata'] and prefixes the GPS frame tags 'GPSInfo/'; ffprobe 6.1
  // (ubuntu-latest) reports ['3x3 displaymatrix'] and names them flat, as
  // 'GPSLatitudeRef'. Assert the property the strip test mirrors instead --
  // that there IS side data and there ARE GPS-bearing tags here to remove --
  // and the EXIF marker in the bytes, which is the ground truth ffprobe is
  // only a witness to. Orientation is deliberately not asserted here: it
  // lives in side_data on 8.1 but in frame tags on 6.1, and the autorotate
  // test below already proves it behaviourally (640x480, rotated) on both.
  assert.ok(meta.sideData.length > 0, 'fixture lost its frame side data');
  assert.ok(Object.keys(meta.frameTags).some((k) => k.includes('GPS')), 'fixture lost its GPS tags');
  assert.match(fs.readFileSync(fixture('exif-orientation.jpg')).toString('latin1'), /Exif\0\0/);
});

test('ingestPhoto writes a copy with no metadata anywhere', { skip }, async () => {
  const dest = out('stripped.jpg');
  const result = await ingestPhoto(fixture('exif-orientation.jpg'), dest);

  const meta = await metadataOf(dest);
  assert.deepEqual(meta.formatTags, {}, 'container format tags survived');
  assert.deepEqual(meta.streamTags, {}, 'stream tags survived');
  assert.deepEqual(meta.frameTags, {}, 'frame tags survived -- this is where a JPEG keeps its GPS');
  assert.deepEqual(meta.sideData, [], 'frame side data survived');

  // The bytes themselves, because ffprobe reporting nothing and the file
  // containing nothing are different claims and only the second one matters.
  const bytes = fs.readFileSync(dest).toString('latin1');
  assert.doesNotMatch(bytes, /Exif/, 'an APP1 EXIF marker is still in the file');
  assert.doesNotMatch(bytes, /GPS/, 'the string GPS is still in the file');

  assert.equal(result.stripped, true);
});

test('ingestPhoto autorotates from EXIF, which is the same pass that strips it', { skip }, async () => {
  const dest = out('rotated.jpg');
  const result = await ingestPhoto(fixture('exif-orientation.jpg'), dest);
  // 480x640 with orientation 6 is a portrait file that should be displayed
  // landscape. Autorotation is on by default in ffmpeg, so the copy is upright
  // on disk and no downstream module has to know about orientation at all.
  assert.equal(result.width, 640);
  assert.equal(result.height, 480);
  assert.equal(result.rotated, true);
});

test('ingestPhoto leaves an already-upright photo alone', { skip }, async () => {
  const dest = out('plain.jpg');
  const result = await ingestPhoto(fixture('portrait.jpg'), dest);
  assert.equal(result.width, 480);
  assert.equal(result.height, 640);
  assert.equal(result.rotated, false);
  assert.equal(result.path, dest);
});

test('the recorded sha256 is of the stripped copy, not the upload', { skip }, async () => {
  const dest = out('hashed.jpg');
  const result = await ingestPhoto(fixture('exif-orientation.jpg'), dest);
  assert.equal(result.sha256, sha256(dest));
  assert.notEqual(result.sha256, sha256(fixture('exif-orientation.jpg')));
  // A manifest that recorded the upload's hash would name a file the job
  // directory cannot produce, which is worse than recording no hash at all.
});

test('the output encoder is pinned, so a .png destination still gets a stripped JPEG', { skip }, async () => {
  // Measured on ffmpeg 8.1.1: -map_metadata -1 does not touch frame side data,
  // and the PNG encoder writes an eXIf chunk straight back out of it. Letting
  // the destination extension choose the encoder would make this module's whole
  // reason for existing depend on a filename.
  const dest = out('pinned.png');
  await ingestPhoto(fixture('exif-orientation.jpg'), dest);
  const meta = await metadataOf(dest);
  assert.deepEqual(meta.frameTags, {});
  assert.deepEqual(meta.sideData, []);
  assert.doesNotMatch(fs.readFileSync(dest).toString('latin1'), /GPS/);
  const probed = JSON.parse((await runFfprobe([
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'json', dest,
  ])).stdout);
  assert.equal(probed.streams[0].codec_name, 'mjpeg');
});

test('ingestPhoto creates the destination directory rather than failing on it', { skip }, async () => {
  const dest = out(path.join('nested', 'deeper', 'photo.jpg'));
  fs.rmSync(out('nested'), { recursive: true, force: true });
  const result = await ingestPhoto(fixture('portrait.jpg'), dest);
  assert.ok(fs.existsSync(result.path));
});

test('ingestPhoto refuses before it encodes, so a bad upload never lands in a job directory', { skip }, async () => {
  const dest = out('never-written.jpg');
  fs.rmSync(dest, { force: true });
  const ffmpegImpl = () => { throw new Error('ffmpeg was reached for a photo that should have been refused'); };
  const err = await ingestPhoto(fixture('tiny.jpg'), dest, { ffmpegImpl }).catch((e) => e);
  assert.ok(err instanceof IntakeError);
  assert.equal(err.code, 'too-small');
  assert.equal(fs.existsSync(dest), false);
});

// ---------------------------------------------------------------------------
// the face gate, which is a seam
// ---------------------------------------------------------------------------

test('the default face gate passes a plausible photo and admits it verified nothing', { skip }, async () => {
  const gate = await faceGate(fixture('portrait.jpg'));
  assert.equal(gate.ok, true);
  assert.equal(gate.reason, null);
  // The whole value of this seam. A number here would be indistinguishable, in
  // a manifest read a year from now, from a number a real detector produced.
  assert.equal(gate.confidence, 'unverified');
  assert.equal(gate.impl, PERMISSIVE_FACE_GATE);
});

test('the default face gate rejects what is cheaply and honestly rejectable', { skip }, async () => {
  const wide = await faceGate(fixture('oversized.jpg'), { limits: { ...LIMITS, maxEdge: 20000 } });
  assert.equal(wide.ok, false);
  assert.equal(wide.reason, 'implausible-aspect');
  assert.equal(wide.confidence, 'unverified');

  const missing = await faceGate(path.join(FIX, 'absent.jpg'));
  assert.equal(missing.ok, false);
  assert.equal(missing.confidence, 'unverified');
});

test('an injected detector owns the verdict, and the manifest records which one ran', { skip }, async () => {
  const detectImpl = async (file, info) => {
    assert.equal(info.width, 480);
    return { ok: true, reason: null, confidence: 0.94 };
  };
  detectImpl.implId = 'retinaface-2027';
  const gate = await faceGate(fixture('portrait.jpg'), { detectImpl });
  assert.equal(gate.impl, 'retinaface-2027');
  // Not averaged, not clamped, not overwritten with 'unverified'. This module
  // does not blend its own guess into somebody else's measurement.
  assert.equal(gate.confidence, 0.94);
  assert.equal(gate.ok, true);
});

test('LIMITS is frozen, because a limit something can reassign is not a limit', () => {
  assert.throws(() => { LIMITS.maxBytes = 1; }, TypeError);
  assert.throws(() => { LIMITS.accept.push('image/gif'); }, TypeError);
});
