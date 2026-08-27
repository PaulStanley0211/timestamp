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

test('the wordmark carries an accessible name, since it is now a picture', async () => {
  await withServer(async ({ base }) => {
    const html = await (await fetch(`${base}/`, { headers: { accept: 'text/html' } })).text();
    // It used to be the literal text "TIMESTAMP", which needed no help. Drawn
    // letterforms are invisible to a screen reader unless something says so.
    assert.match(html, /class="wordmark"/, 'the wordmark link is gone');
    assert.match(html, /aria-label="Timestamp"|<span class="vh">Timestamp<\/span>/,
      'the wordmark is a picture with no accessible name');
  });
});
