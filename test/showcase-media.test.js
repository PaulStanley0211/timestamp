/**
 * The showcase producer: a job directory in, web-sized tapes and stills out,
 * and a refusal to write a file that lost its Art. 50 tags on the way.
 * Self-skipping without ffmpeg, like the audio tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runFfmpeg, runFfprobe, findFfmpeg } from '../scripts/ffmpeg/run.mjs';
import { produceShowcase } from '../scripts/tapedeck/showcase.mjs';

async function haveFfmpeg() { try { await runFfmpeg(['-hide_banner', '-version']); return true; } catch { return false; } }
const HAVE = await haveFfmpeg();
const skip = HAVE ? false : `ffmpeg not found (${findFfmpeg().ffmpeg}) -- showcase producer tests skipped`;

const TAGS = [
  '-metadata', 'comment=AI-generated video. Made with Timestamp (https://timestamptapes.com): a generative AI model built this scene from a photograph. The events shown did not happen.',
  '-metadata', 'description=digitalsourcetype=trainedAlgorithmicMedia (http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia); generator=Timestamp',
];

/** A fake delivered tape: the delivery raster, 1 second, the provenance tags. */
async function fakeJob(dir, { width, height, tagged = true }) {
  fs.mkdirSync(dir, { recursive: true });
  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}:d=1:r=25`,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '35', '-c:a', 'aac', '-movflags', '+faststart',
    ...(tagged ? TAGS : []), path.join(dir, 'timestamp.mp4'),
  ]);
  return dir;
}

async function probeOf(file) {
  const out = await runFfprobe(['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format_tags=comment,description', '-of', 'json', file]);
  return JSON.parse(out.stdout ?? out);
}

test('the three slots come out at the web rasters, muted, tagged, with a poster each', { skip }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-showcase-src-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-showcase-out-'));
  try {
    const wide = await fakeJob(path.join(tmp, 'wide'), { width: 1920, height: 1080 });
    const tall = await fakeJob(path.join(tmp, 'tall'), { width: 1080, height: 1920 });
    for (const [slot, jobDir, w, hgt] of [['hero-16x9', wide, 1280, 720], ['tape-9x16', tall, 540, 960], ['tape-4x3', tall, 960, 720]]) {
      const written = await produceShowcase({ jobDir, slot, outDir: out });
      assert.deepEqual(written.map((p) => path.basename(p)).sort(), [`${slot}.jpg`, `${slot}.mp4`]);
      const p = await probeOf(path.join(out, `${slot}.mp4`));
      const v = p.streams.find((s) => s.codec_type === 'video');
      assert.equal(`${v.width}x${v.height}`, `${w}x${hgt}`, `${slot} raster`);
      assert.ok(!p.streams.some((s) => s.codec_type === 'audio'), `${slot} still carries an audio stream; the showcase is muted`);
      assert.match(p.format.tags.comment ?? '', /AI-generated/, `${slot} lost the Art. 50 sentence`);
      assert.match(p.format.tags.description ?? '', /trainedAlgorithmicMedia/, `${slot} lost the IPTC marker`);
      assert.ok(fs.statSync(path.join(out, `${slot}.jpg`)).size > 0, `${slot} has no poster`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('a source without the provenance tags is refused, and nothing is left behind', { skip }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-showcase-src-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-showcase-out-'));
  try {
    const bare = await fakeJob(path.join(tmp, 'bare'), { width: 1920, height: 1080, tagged: false });
    await assert.rejects(() => produceShowcase({ jobDir: bare, slot: 'hero-16x9', outDir: out }), /provenance/i);
    assert.deepEqual(fs.readdirSync(out), [], 'a refused encode left files in the output directory');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('a sticker is one frame at 480 wide, from the slot it names', { skip }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-showcase-src-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-showcase-out-'));
  try {
    const wide = await fakeJob(path.join(tmp, 'wide'), { width: 1920, height: 1080 });
    const [file] = await produceShowcase({ jobDir: wide, slot: 'hero-16x9', outDir: out, sticker: 1, stickerAt: 0.5 });
    assert.equal(path.basename(file), 'sticker-1.jpg');
    const p = await probeOf(file);
    assert.equal(p.streams[0].width, 480);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});
