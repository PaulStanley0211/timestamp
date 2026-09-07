/**
 * The place-loop manifest, and the command that measures it.
 *
 * `assets/places/loops.json` is what the stylesheet reads to solve each
 * place's scrim, and until 2026-09-07 it carried one number per loop: the mean
 * luma. A mean cannot see a neon sign. Solved on it alone, the three night
 * places sat at the floor while a real browser read the hint at 1.57:1 over
 * Tokyo's highlights -- so the manifest carries a second number, the brightest
 * luma any frame shows after a blur (the blur stands in for the one the page
 * applies to the loop, and is what stops one grain speck being the answer).
 *
 * THE MEASUREMENT IS A COMMAND, NOT ONLY A FUNCTION. Cutting a loop is minutes
 * of ffmpeg and rewrites a committed mp4; re-measuring one is two seconds and
 * rewrites nothing but the manifest. `--measure` is the second thing, and it
 * is what an operator runs the day the solver wants a statistic the manifest
 * does not carry. Exercised here the way the operator runs it -- as a spawn
 * against a copy of one shipped loop -- so the test is of the command and not
 * of a function the command might forget to call.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { runFfmpeg, findFfmpeg } from '../scripts/ffmpeg/run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'scripts', 'tapedeck', 'place-loops.mjs');
const MANIFEST = path.join(ROOT, 'assets', 'places', 'loops.json');

async function haveFfmpeg() {
  try {
    await runFfmpeg(['-hide_banner', '-version']);
    return true;
  } catch {
    return false;
  }
}
const HAVE = await haveFfmpeg();
const skip = HAVE ? false : `ffmpeg not found (${findFfmpeg().ffmpeg}) -- loop measurement skipped`;

test('the shipped manifest carries a highlight beside the mean for every loop, and the highlight is above the mean', () => {
  // A data assertion, on purpose: the solver falls back to a white highlight
  // for a loop that has none, which is the safe direction and also the heavy
  // one -- a place shipped without the number gets a scrim solved for a
  // photograph of a white wall. The fix for that is to run the command.
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const ids = Object.keys(manifest.loops);
  assert.ok(ids.length >= 5, `loops.json describes ${ids.length} loop(s)`);
  for (const id of ids) {
    const loop = manifest.loops[id];
    assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'places', `${id}.mp4`)), `${id} is in the manifest and has no loop`);
    assert.ok(Number.isFinite(loop.yavg) && loop.yavg > 0 && loop.yavg < 255, `${id}: mean luma ${loop.yavg}`);
    assert.ok(Number.isFinite(loop.yhigh), `${id} carries no highlight luma -- run: node scripts/tapedeck/place-loops.mjs --measure`);
    assert.ok(loop.yhigh > loop.yavg && loop.yhigh <= 255, `${id}: highlight ${loop.yhigh} is not a luma above the mean ${loop.yavg}`);
  }
  assert.match(manifest._comment, /highlight/i, 'the manifest comment does not say what the second number is');
});

test('--measure rewrites a manifest from the loops on disk without cutting anything', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-loops-'));
  const id = 'amalfi-afternoon';
  const src = path.join(ROOT, 'assets', 'places', `${id}.mp4`);
  const copy = path.join(dir, `${id}.mp4`);
  fs.copyFileSync(src, copy);
  const before = fs.statSync(copy);
  // A stale manifest with a second loop in it, to prove the command merges
  // rather than overwrites -- the same rule the cutter already keeps, because a
  // manifest rebuilt from one run silently drops every other place.
  fs.writeFileSync(path.join(dir, 'loops.json'), JSON.stringify({ loops: { 'somewhere-else': { yavg: 77, yhigh: 200 } } }));

  try {
    const { stdout } = await promisify(execFile)(process.execPath, [CLI, '--measure', `--dir=${dir}`], { cwd: ROOT, timeout: 120_000 });
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'loops.json'), 'utf8'));

    // The mean is the number the shipped manifest already carries for this
    // loop -- so the command measures what the page has been reading, not a
    // new statistic with the same name.
    const shipped = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).loops[id];
    assert.equal(written.loops[id].yavg, shipped.yavg, 'the re-measured mean is not the shipped one');
    // The highlight is a bright thing: a coastal afternoon has sky in it, and a
    // "highlight" that came back anywhere near the mean would be the wrong
    // statistic wearing the right name.
    assert.ok(written.loops[id].yhigh >= 200 && written.loops[id].yhigh <= 255, `the highlight of a coastal afternoon measures ${written.loops[id].yhigh}`);
    assert.ok(written.loops[id].yhigh > written.loops[id].yavg, 'the highlight is not above the mean');

    assert.deepEqual(written.loops['somewhere-else'], { yavg: 77, yhigh: 200 }, 'the command overwrote a manifest it should have merged into');
    assert.match(written._comment ?? '', /highlight/i, 'the manifest comment does not say what the second number is');

    // Nothing was cut: the loop is byte-for-byte the copy that went in, no
    // still was needed, and no frame dump appeared.
    const after = fs.statSync(copy);
    assert.equal(after.size, before.size, 'the loop was rewritten');
    assert.ok(fs.readFileSync(copy).equals(fs.readFileSync(src)), 'the loop on disk is no longer the shipped one');
    assert.deepEqual(fs.readdirSync(dir).sort(), [`${id}.mp4`, 'loops.json'], 'the command wrote more than the manifest');
    assert.match(stdout, new RegExp(id), 'the command did not name the loop it measured');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
