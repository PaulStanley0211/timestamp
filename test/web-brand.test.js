/**
 * The brand assets, and the one thing about them that is not decoration.
 *
 * `/favicon.ico` answered `204 No Content` from the day this server was
 * written, so every browser tab showed a blank page icon. That is not a
 * cosmetic gap: a tab with no icon is a tab a person cannot find among twenty
 * others, and it is the single most-requested url this app serves.
 *
 * WHAT IS ASSERTED HERE AND WHAT IS NOT. Nothing below measures whether the
 * mark looks good -- that is a judgement, it belongs to a person, and a test
 * that pinned it would be deleted the first time the mark was improved. What
 * these pin is that the bytes exist, arrive with a type a browser will honour,
 * and are actually referenced from the page. Each one has been wrong at least
 * once in some codebase, and each fails silently: a favicon served as
 * `application/octet-stream` is simply not painted, and no error appears
 * anywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from '../scripts/web/server.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFG = JSON.parse(fs.readFileSync(new URL('../config/render.json', import.meta.url), 'utf8'));

/** Nothing in this file reaches the queue; `createServer` only checks it is
 *  there. Kept to the three methods the constructor and the routes touch, so
 *  this stub cannot quietly drift into being a second implementation. */
function stubQueue() {
  return {
    enqueue() { return {}; },
    peek() { return []; },
    stats() { return { pending: 0, claimed: 0, done: 0, failed: 0 }; },
  };
}

/** A throwaway root: nothing here writes, but `createServer` requires one. */
async function withServer(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-brand-'));
  const app = createServer({
    root, cfg: CFG, queue: stubQueue(), port: 0, logImpl: () => {},
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed',
  });
  const port = await app.listen();
  try {
    await fn({ base: `http://127.0.0.1:${port}`, app });
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const ASSETS = [
  ['/favicon.ico', /image\/(x-icon|vnd\.microsoft\.icon)/],
  ['/icon.svg', /image\/svg\+xml/],
  ['/icon-180.png', /image\/png/],
  ['/icon-192.png', /image\/png/],
  ['/icon-512.png', /image\/png/],
];

test('every brand asset is on disk, so the routes below are not serving nothing', () => {
  for (const [url] of ASSETS) {
    const file = path.join(REPO_ROOT, 'assets', 'brand', url.replace(/^\//, ''));
    assert.ok(fs.existsSync(file), `${file} is missing -- the route will answer 404`);
    assert.ok(fs.statSync(file).size > 0, `${file} is empty`);
  }
});

test('the brand assets are served with a type a browser will honour', async () => {
  await withServer(async ({ base }) => {
    for (const [url, type] of ASSETS) {
      const res = await fetch(`${base}${url}`);
      assert.equal(res.status, 200, `${url} answered ${res.status}`);
      // The type is the whole point. `application/octet-stream` downloads or
      // is ignored; it never paints, and it never errors either.
      assert.match(res.headers.get('content-type'), type, `${url} has the wrong content-type`);
      await res.arrayBuffer();
    }
  });
});

test('favicon.ico is no longer the 204 it shipped as', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/favicon.ico`);
    assert.notEqual(res.status, 204, 'the empty answer is back, and every tab is blank again');
    const bytes = new Uint8Array(await res.arrayBuffer());
    // An ICO begins 00 00 01 00. Asserting the magic rather than the size
    // catches the case where something else entirely is served under this name.
    assert.deepEqual([...bytes.slice(0, 4)], [0, 0, 1, 0], 'not an ICO file');
  });
});

test('the brand assets revalidate rather than being refetched whole', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/icon.svg`);
    const etag = res.headers.get('etag');
    await res.arrayBuffer();
    assert.ok(etag, 'no etag, so every page load refetches the icon');
    const again = await fetch(`${base}/icon.svg`, { headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304);
    await again.arrayBuffer();
  });
});

test('the page actually points at the icon, or serving it changes nothing', async () => {
  await withServer(async ({ base }) => {
    const html = await (await fetch(`${base}/`, { headers: { accept: 'text/html' } })).text();
    assert.match(html, /<link rel="icon"[^>]*href="\/icon\.svg"/, 'no SVG icon link in the head');
    assert.match(html, /<link rel="apple-touch-icon"[^>]*href="\/icon-180\.png"/, 'no apple-touch-icon');
  });
});

test('the wordmark reads as the word, because it is the word', async () => {
  await withServer(async ({ base }) => {
    const html = await (await fetch(`${base}/`, { headers: { accept: 'text/html' } })).text();
    // It was drawn letterforms for a fortnight and needed a hidden name beside
    // it. This world sets the word in the display face, so the anchor's own
    // text is the accessible name and there is nothing to keep in step.
    assert.match(html, /class="wordmark"[^>]*>Timestamp/, 'the wordmark does not read as the word');
  });
});

/**
 * THE TAB ICON PAINTS IN THE PALETTE THE SITE ACTUALLY SPEAKS.
 *
 * It was the `Ts` knocked out of an oxide tile -- the cream album page's mark,
 * and by 2026-09-08 the last artefact of that world still shipping. The owner
 * saw a brick-orange chip beside a lime site and asked for it to move; it is a
 * lime tile with the letters in the on-lime ink now.
 *
 * THE VALUES ARE READ OUT OF THE STYLESHEET, NEVER TYPED HERE. A hex written
 * into a test is a second place the palette is decided, and the two drift the
 * first time a token moves. What this pins is the RELATION: whatever `--lime`
 * and `--on-lime` are, the mark is drawn in them.
 *
 * AND THE RASTERS ARE CHECKED, NOT ONLY THE SVG. Five files carry this mark
 * and only one of them is text: recolouring `icon.svg` and forgetting the four
 * rasters is the whole failure mode, it is completely silent, and the SVG is
 * the one file a Chrome tab does NOT reach for on Windows. So each raster is
 * decoded and its dominant opaque colour compared against the same token.
 */

/** The palette, from the sheet that ships it -- see the note above. */
function paletteInk() {
  const css = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'web', 'static.mjs'), 'utf8');
  const read = (name) => {
    const m = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css);
    assert.ok(m, `the stylesheet no longer defines --${name}`);
    const hex = m[1].toUpperCase();
    return { hex, rgb: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) };
  };
  return { lime: read('lime'), onLime: read('on-lime') };
}

/**
 * A PNG decoder over node:zlib. Copied rather than imported: importing another
 * test file registers its tests in this process too, which is the trap
 * `provider-contract` set for `provider-fal` and this repo's standing rule.
 * 8-bit RGB/RGBA, non-interlaced -- which is what these files are.
 */
function decodePng(buf) {
  assert.equal(buf.toString('latin1', 1, 4), 'PNG', 'not a PNG');
  let at = 8;
  let width = 0; let height = 0; let depth = 0; let type = 0; let interlace = 0;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const tag = buf.toString('latin1', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (tag === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; type = body[9]; interlace = body[12];
    } else if (tag === 'IDAT') idat.push(body);
    else if (tag === 'IEND') break;
    at += len + 12;
  }
  assert.equal(depth, 8, `bit depth ${depth}: this decoder reads 8-bit only`);
  assert.ok(type === 6 || type === 2, `colour type ${type}: this decoder reads RGB and RGBA only`);
  assert.equal(interlace, 0, 'an interlaced PNG is not what these are');
  const channels = type === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  assert.equal(raw.length, height * (stride + 1), 'the inflated PNG is not the size its header promises');
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (filter !== 0) throw new Error(`PNG scanline filter ${filter} at row ${y}`);
      out[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/** The colour the most opaque pixels are painted, which for this mark is the tile. */
function dominantOpaqueColour({ width, height, channels, data }) {
  const seen = new Map();
  for (let i = 0; i < width * height; i++) {
    const at = i * channels;
    if (channels === 4 && data[at + 3] < 250) continue;
    const key = (data[at] << 16) | (data[at + 1] << 8) | data[at + 2];
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let best = -1; let bestN = 0;
  for (const [key, n] of seen) if (n > bestN) { best = key; bestN = n; }
  assert.ok(best >= 0, 'the raster has no opaque pixel at all');
  return { rgb: [(best >> 16) & 255, (best >> 8) & 255, best & 255], share: bestN / (width * height) };
}

/** The ICO's entries are 32bpp BMP DIBs, bottom-up, no compression. */
function decodeIcoEntries(buf) {
  assert.deepEqual([...buf.subarray(0, 4)], [0, 0, 1, 0], 'not an ICO file');
  const count = buf.readUInt16LE(4);
  assert.ok(count > 0, 'the ICO declares no images');
  const out = [];
  for (let i = 0; i < count; i++) {
    const dir = 6 + i * 16;
    const size = buf.readUInt32LE(dir + 8);
    const offset = buf.readUInt32LE(dir + 12);
    const body = buf.subarray(offset, offset + size);
    if (body.toString('latin1', 1, 4) === 'PNG') { out.push({ png: decodePng(body) }); continue; }
    const headerBytes = body.readUInt32LE(0);
    const width = body.readInt32LE(4);
    const height = body.readInt32LE(8) / 2; // the DIB height counts the AND mask too
    const bpp = body.readUInt16LE(14);
    assert.equal(bpp, 32, `ICO entry ${i} is ${bpp}bpp; this reader handles 32 only`);
    const stride = width * 4;
    const pixels = body.subarray(headerBytes, headerBytes + stride * height);
    // BGRA, bottom-up -> RGBA, top-down, so the shared reader above can take it.
    const data = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const src = (height - 1 - y) * stride + x * 4;
        const dst = y * stride + x * 4;
        data[dst] = pixels[src + 2]; data[dst + 1] = pixels[src + 1];
        data[dst + 2] = pixels[src]; data[dst + 3] = pixels[src + 3];
      }
    }
    out.push({ png: { width, height, channels: 4, data } });
  }
  return out;
}

test('the tab icon is drawn in the palette the site ships, and so are its rasters', () => {
  const { lime, onLime } = paletteInk();
  const brand = (name) => path.join(REPO_ROOT, 'assets', 'brand', name);

  // The vector first: the tile in lime, the letters in the on-lime ink.
  const svg = fs.readFileSync(brand('icon.svg'), 'utf8');
  const tile = /<rect[^>]*\bfill="(#[0-9A-Fa-f]{6})"/.exec(svg);
  assert.ok(tile, 'icon.svg has no filled tile at all');
  assert.equal(tile[1].toUpperCase(), lime.hex,
    `the icon tile is ${tile[1]} where the stylesheet's --lime is ${lime.hex}`);
  const letters = [...svg.matchAll(/<use[^>]*\bfill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase());
  assert.equal(letters.length, 2, 'the mark should be two clipped bands of one path');
  for (const ink of letters) {
    assert.equal(ink, onLime.hex, `the icon letters are ${ink} where --on-lime is ${onLime.hex}`);
  }

  // ANTI-VACUITY: no retired world's colour survives anywhere in the mark.
  // Without this the two assertions above pass on a file that still carries
  // the old tile somewhere else in its markup.
  //
  // THE SWEEP IS OVER WHAT THIS SERVER SERVES, taken from the ASSETS list
  // above rather than typed a second time. `wordmark.svg`, `wordmark-inline`,
  // `monogram.svg` and `monogram-inline` are all still on disk in the cream
  // world's colours -- and no route reaches any of them, because the masthead
  // became live Anton text. They are press-kit files, and what happens to
  // them is a decision rather than a defect; a guard that failed on them
  // would be asserting about bytes no browser can fetch.
  const retiredIn = (text) => ['#A8342A', '#FF8A1E', '#FAF7F2'].filter((c) => text.toUpperCase().includes(c));
  const served = ASSETS.map(([url]) => url.replace(/^\//, '')).filter((n) => n.endsWith('.svg'));
  assert.ok(served.includes('icon.svg'), 'the served-asset list no longer carries a vector to sweep');
  for (const name of served) {
    assert.deepEqual(retiredIn(fs.readFileSync(brand(name), 'utf8')), [],
      `${name} still paints in a retired world's colour`);
  }

  // Then the rasters, which are what a browser tab actually paints. An SVG
  // recoloured on its own leaves these four saying the old thing, silently.
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
  for (const name of ['icon-180.png', 'icon-192.png', 'icon-512.png']) {
    const got = dominantOpaqueColour(decodePng(fs.readFileSync(brand(name))));
    assert.ok(near(got.rgb, lime.rgb),
      `${name} is mostly rgb(${got.rgb}) where the tile should be ${lime.hex} -- the SVG was recoloured and this raster was not`);
    assert.ok(got.share > 0.5, `${name} is only ${(got.share * 100).toFixed(1)}% tile; it is not this mark`);
  }
  const entries = decodeIcoEntries(fs.readFileSync(brand('favicon.ico')));
  assert.ok(entries.length >= 3, `favicon.ico carries ${entries.length} sizes; it had 16, 32 and 48`);
  for (const [i, entry] of entries.entries()) {
    const got = dominantOpaqueColour(entry.png);
    assert.ok(near(got.rgb, lime.rgb),
      `favicon.ico entry ${i} (${entry.png.width}px) is mostly rgb(${got.rgb}), not the ${lime.hex} tile`);
  }
});
