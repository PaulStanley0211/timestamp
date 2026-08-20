/**
 * The multipart parser.
 *
 * The two properties under test here are the two that a parser passing casual
 * unit tests still gets wrong:
 *
 *   1. A boundary spanning a chunk edge must not be written into the file. It
 *      only happens with real files at real sizes, and it presents as "the last
 *      few bytes of the photo are corrupted". So the sweep below splits one body
 *      at EVERY byte offset and demands the payload back intact each time.
 *   2. An oversized body must be refused without being read. The test asserts on
 *      how many bytes the source was ever asked to produce, not merely that the
 *      promise rejected -- rejecting after buffering 4 GB is the bug.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MultipartParser,
  MultipartError,
  parseMultipart,
  boundaryFromContentType,
  safeFilename,
  memorySink,
  fileSink,
} from '../scripts/web/multipart.mjs';

const B = 'ABoundaryString--1234567890';

// ---------------------------------------------------------------------------
// body construction
// ---------------------------------------------------------------------------

/** @param {Array<{name, filename?, type?, body: Buffer|string}>} parts */
function buildBody(parts, boundary = B) {
  const chunks = [];
  for (const part of parts) {
    const disposition = part.filename === undefined
      ? `form-data; name="${part.name}"`
      : `form-data; name="${part.name}"; filename="${part.filename}"`;
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: ${disposition}\r\n`
      + (part.type ? `Content-Type: ${part.type}\r\n` : '')
      + '\r\n', 'latin1',
    ));
    chunks.push(Buffer.isBuffer(part.body) ? part.body : Buffer.from(part.body, 'utf8'));
    chunks.push(Buffer.from('\r\n', 'latin1'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'latin1'));
  return Buffer.concat(chunks);
}

/** Drive the parser synchronously with a given chunking, and collect the parts. */
function parseSync(body, chunkAt) {
  const parts = [];
  let current = null;
  const parser = new MultipartParser(B, {
    onPartBegin(part) { current = { ...part, chunks: [] }; },
    onPartData(buf) { current.chunks.push(Buffer.from(buf)); return true; },
    onPartEnd() {
      parts.push({ ...current, body: Buffer.concat(current.chunks) });
      current = null;
    },
  });
  for (const chunk of chunkAt(body)) parser.push(chunk);
  parser.end();
  return parts;
}

const singleChunk = (body) => [body];
const splitAt = (n) => (body) => [body.subarray(0, n), body.subarray(n)];
const byteByByte = (body) => Array.from({ length: body.length }, (_, i) => body.subarray(i, i + 1));

// ---------------------------------------------------------------------------
// the header
// ---------------------------------------------------------------------------

test('boundaryFromContentType', () => {
  assert.equal(boundaryFromContentType('multipart/form-data; boundary=abc123'), 'abc123');
  assert.equal(boundaryFromContentType('multipart/form-data; boundary="abc 123"'), 'abc 123');
  assert.equal(boundaryFromContentType('MULTIPART/FORM-DATA; BOUNDARY=abc'), 'abc');
  assert.equal(boundaryFromContentType('multipart/form-data; charset=utf-8; boundary=xyz'), 'xyz');

  assert.equal(boundaryFromContentType('application/json'), null, 'not multipart');
  assert.equal(boundaryFromContentType('multipart/form-data'), null, 'no boundary');
  assert.equal(boundaryFromContentType(undefined), null);
  assert.equal(boundaryFromContentType(`multipart/form-data; boundary=${'x'.repeat(71)}`), null,
    'RFC 2046 caps the boundary at 70 characters');
});

test('safeFilename keeps the basename and nothing else', () => {
  assert.equal(safeFilename('holiday.jpg'), 'holiday.jpg');
  assert.equal(safeFilename('../../etc/passwd'), 'passwd');
  assert.equal(safeFilename('C:\\Users\\pauls\\photo.png'), 'photo.png');
  assert.equal(safeFilename('..'), null);
  assert.equal(safeFilename(''), null);
  assert.equal(safeFilename(undefined), null);
});

// ---------------------------------------------------------------------------
// basics
// ---------------------------------------------------------------------------

test('fields and files come out of one body', () => {
  const body = buildBody([
    { name: 'place', body: 'a beach' },
    { name: 'photo', filename: 'me.jpg', type: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) },
    { name: 'consent', body: 'yes' },
  ]);
  const parts = parseSync(body, singleChunk);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].name, 'place');
  assert.equal(parts[0].filename, null);
  assert.equal(parts[0].body.toString(), 'a beach');
  assert.equal(parts[1].filename, 'me.jpg');
  assert.equal(parts[1].contentType, 'image/jpeg');
  assert.deepEqual([...parts[1].body], [0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(parts[2].body.toString(), 'yes');
});

test('an empty part is a part with no bytes, not a missing part', () => {
  const parts = parseSync(buildBody([{ name: 'place', body: '' }]), singleChunk);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].body.length, 0);
});

test('an untouched file input posts filename="" and is not a file', () => {
  const parts = parseSync(buildBody([{ name: 'placePhoto', filename: '', body: '' }]), singleChunk);
  assert.equal(parts[0].hasFile, true, 'the header did carry a filename parameter');
  assert.equal(parts[0].filename, null, 'but there is no usable name, so there is no file');
});

test('transport padding between the boundary and the CRLF is legal', () => {
  const raw = Buffer.from(
    `--${B}  \r\nContent-Disposition: form-data; name="a"\r\n\r\nvalue\r\n--${B}--\r\n`, 'latin1',
  );
  const parts = parseSync(raw, singleChunk);
  assert.equal(parts[0].body.toString(), 'value');
});

test('a quoted filename with escapes, and the RFC 5987 extended form', () => {
  const raw = Buffer.from(
    `--${B}\r\nContent-Disposition: form-data; name="f"; filename="a\\"b.jpg"\r\n\r\nx\r\n`
    + `--${B}\r\nContent-Disposition: form-data; name="g"; filename="fallback.jpg"; filename*=UTF-8''caf%C3%A9.jpg\r\n\r\ny\r\n`
    + `--${B}--\r\n`, 'latin1',
  );
  const parts = parseSync(raw, singleChunk);
  assert.equal(parts[0].filename, 'a"b.jpg');
  assert.equal(parts[1].filename, 'cafe\u0301.jpg'.normalize('NFC'));
});

// ---------------------------------------------------------------------------
// THE CHUNK EDGE
// ---------------------------------------------------------------------------

/**
 * The exhaustive version. One body, split at every single byte offset, and the
 * payload must come back identical every time. A parser with the classic bug
 * fails on the ~30 offsets that land inside a delimiter, and passes everywhere
 * else -- which is exactly why a handful of hand-picked chunkings misses it.
 */
test('a boundary split across a chunk edge -- at EVERY offset', () => {
  const payload = crypto.createHash('sha256').update('deterministic payload').digest();
  const expected = Buffer.concat([payload, Buffer.from(`\r\n--${B}xx not really\r\n`), payload]);
  const body = buildBody([
    { name: 'before', body: 'x' },
    { name: 'photo', filename: 'p.bin', body: expected },
    { name: 'after', body: 'y' },
  ]);

  for (let cut = 1; cut < body.length; cut += 1) {
    const parts = parseSync(body, splitAt(cut));
    assert.equal(parts.length, 3, `cut at ${cut}: wrong part count`);
    assert.equal(parts[0].body.toString(), 'x', `cut at ${cut}`);
    assert.equal(parts[2].body.toString(), 'y', `cut at ${cut}`);
    assert.ok(parts[1].body.equals(expected),
      `cut at ${cut}: payload differs (${parts[1].body.length} vs ${expected.length} bytes)`);
  }
});

test('one byte at a time is the worst case and must still be exact', () => {
  const payload = crypto.randomBytes(1500);
  const body = buildBody([{ name: 'photo', filename: 'p.bin', body: payload }]);
  const parts = parseSync(body, byteByByte);
  assert.equal(parts.length, 1);
  assert.ok(parts[0].body.equals(payload));
});

test('bytes that look like a delimiter but are not survive verbatim', () => {
  // No leading CRLF; a trailing partial delimiter; the delimiter with one byte
  // changed. All three are ordinary file bytes and all three must come back.
  const payload = Buffer.concat([
    Buffer.from(`--${B}`, 'latin1'),
    Buffer.from(`\r\n--${B.slice(0, -1)}`, 'latin1'),
    Buffer.from(`\r\n--${B}Z`, 'latin1'),
    Buffer.from('\r\n--', 'latin1'),
  ]);
  const body = buildBody([{ name: 'photo', filename: 'p.bin', body: payload }]);
  for (const chunker of [singleChunk, byteByByte, splitAt(Math.floor(body.length / 2))]) {
    const parts = parseSync(body, chunker);
    assert.ok(parts[0].body.equals(payload), 'delimiter-lookalike bytes were altered');
  }
});

test('a body that ends before the closing boundary is refused, not accepted short', () => {
  const body = buildBody([{ name: 'photo', filename: 'p.bin', body: crypto.randomBytes(64) }]);
  const truncated = body.subarray(0, body.length - 10);
  assert.throws(() => parseSync(truncated, singleChunk), (err) => {
    assert.ok(err instanceof MultipartError);
    assert.equal(err.code, 'TRUNCATED');
    return true;
  });
});

test('the retained tail is bounded, not proportional to the file', () => {
  // The invariant that makes this parser streaming rather than buffering: at no
  // point does it hold more than one delimiter's worth of unmatched bytes.
  const parser = new MultipartParser(B, {});
  const body = buildBody([{ name: 'photo', filename: 'p.bin', body: crypto.randomBytes(200_000) }]);
  let peak = 0;
  for (let i = 0; i < body.length; i += 4096) {
    parser.push(body.subarray(i, i + 4096));
    peak = Math.max(peak, parser.pending.length);
  }
  assert.ok(peak <= B.length + 4, `retained ${peak} bytes; the delimiter is ${B.length + 4}`);
});

// ---------------------------------------------------------------------------
// THE CAP
// ---------------------------------------------------------------------------

/** A source that counts how many bytes it was ever asked to produce, so the test
 *  can assert the upload was refused rather than merely rejected afterwards. */
function meteredSource(totalBytes, chunkSize = 65_536) {
  const meter = { produced: 0 };
  let left = totalBytes;
  const stream = new Readable({
    read() {
      if (left <= 0) { this.push(null); return; }
      const n = Math.min(chunkSize, left);
      left -= n;
      meter.produced += n;
      this.push(Buffer.alloc(n, 0x41));
    },
  });
  return { stream, meter };
}

test('an oversized upload is refused WITHOUT the whole body being read', async () => {
  const maxBytes = 200_000;
  const nominal = 50_000_000; // 50 MB "sent"
  const { stream, meter } = meteredSource(nominal);

  await assert.rejects(
    parseMultipart(stream, { boundary: B, limits: { maxBytes } }),
    (err) => {
      assert.ok(err instanceof MultipartError, `got ${err?.name}`);
      assert.equal(err.status, 413);
      assert.equal(err.code, 'TOO_LARGE');
      return true;
    },
  );

  // THE REAL ASSERTION. The cap plus a little stream readahead is the design;
  // anything proportional to what the sender offered is the bug. The slack is a
  // couple of chunks because node:stream fills its own buffer ahead of the
  // 'data' handler -- that is bounded by highWaterMark, not by the upload.
  assert.ok(meter.produced <= maxBytes + 4 * 65_536,
    `read ${meter.produced} bytes before refusing, cap is ${maxBytes}`);
  assert.ok(meter.produced < nominal / 20, 'the source was drained instead of cut off');
});

test('a body just under the cap is accepted', async () => {
  const payload = crypto.randomBytes(50_000);
  const body = buildBody([{ name: 'photo', filename: 'p.bin', body: payload }]);
  const result = await parseMultipart(Readable.from([body]), {
    boundary: B,
    limits: { maxBytes: body.length },
    sinkFor: () => memorySink({ maxBytes: 1_000_000 }),
  });
  assert.equal(result.files.length, 1);
  assert.ok(result.files[0].buffer.equals(payload));
});

test('an over-long text field is refused on its own cap', async () => {
  const body = buildBody([{ name: 'place', body: 'x'.repeat(5000) }]);
  await assert.rejects(
    parseMultipart(Readable.from([body]), { boundary: B, limits: { maxFieldBytes: 100 } }),
    (err) => {
      assert.equal(err.code, 'FIELD_TOO_LARGE');
      assert.equal(err.status, 413);
      return true;
    },
  );
});

test('too many parts is refused', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ name: `f${i}`, body: 'x' }));
  await assert.rejects(
    parseMultipart(Readable.from([buildBody(many)]), { boundary: B, limits: { maxParts: 5 } }),
    (err) => { assert.equal(err.code, 'TOO_MANY_PARTS'); return true; },
  );
});

test('a header block with no end is refused rather than accumulated', async () => {
  const endless = Buffer.concat([
    Buffer.from(`--${B}\r\n`, 'latin1'),
    Buffer.from(`X-Pad: ${'p'.repeat(20_000)}\r\n`, 'latin1'),
  ]);
  await assert.rejects(
    parseMultipart(Readable.from([endless]), { boundary: B, limits: { maxHeaderBytes: 1024 } }),
    (err) => { assert.equal(err.code, 'HEADERS_TOO_LARGE'); return true; },
  );
});

// ---------------------------------------------------------------------------
// sinks
// ---------------------------------------------------------------------------

test('a file sink writes the exact bytes to disk, and sha256 agrees', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-multipart-'));
  try {
    const payload = crypto.randomBytes(300_000);
    const sent = crypto.createHash('sha256').update(payload).digest('hex');
    const body = buildBody([
      { name: 'place', body: 'the balcony' },
      { name: 'photo', filename: 'p.bin', body: payload },
    ]);
    const dest = path.join(dir, 'landed.bin');

    // Chunked small on purpose, so the delimiter lands mid-chunk repeatedly.
    const chunks = [];
    for (let i = 0; i < body.length; i += 997) chunks.push(body.subarray(i, i + 997));

    const result = await parseMultipart(Readable.from(chunks), {
      boundary: B,
      sinkFor: (part) => (part.name === 'photo' ? fileSink(dest) : null),
    });

    assert.equal(result.fields.place, 'the balcony');
    assert.equal(result.files[0].bytes, payload.length);
    const stored = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
    assert.equal(stored, sent, 'stored bytes differ from sent bytes');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * THE DEADLOCK. A sink whose last write asks for backpressure, in a body that
 * arrives as a single chunk: the part ends, the sink is closed, and a closed
 * Writable emits `finish` rather than `drain` -- so the resume that the pause
 * was waiting for never arrives, the source is never read to completion, and
 * `end` is never delivered. It presents as small uploads hanging while large
 * ones work, which reads as a network problem and is not one.
 */
test('a part that ends while its sink is backed up does not hang', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-multipart-'));
  try {
    // One chunk, and a payload comfortably past a WriteStream's highWaterMark so
    // the final write is guaranteed to return false.
    const body = buildBody([
      { name: 'photo', filename: 'p.bin', body: crypto.randomBytes(64_000) },
      { name: 'consent', body: 'yes' },
    ]);
    const dest = path.join(dir, 'one-chunk.bin');

    const parsed = await Promise.race([
      parseMultipart(Readable.from([body]), { boundary: B, sinkFor: () => fileSink(dest) }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('parseMultipart hung')), 5000).unref()),
    ]);
    assert.equal(parsed.files[0].bytes, 64_000);
    assert.equal(parsed.fields.consent, 'yes');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed upload leaves no half-written file behind', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-multipart-'));
  const dest = path.join(dir, 'aborted.bin');
  try {
    const body = buildBody([{ name: 'photo', filename: 'p.bin', body: crypto.randomBytes(20_000) }]);
    await assert.rejects(parseMultipart(Readable.from([body]), {
      boundary: B,
      limits: { maxBytes: 5_000 },
      sinkFor: () => fileSink(dest),
    }));
    assert.equal(fs.existsSync(dest), false, 'a stranger\'s partial photo was left on disk');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a stream error rejects rather than hanging', async () => {
  const stream = new Readable({ read() { this.destroy(new Error('socket went away')); } });
  await assert.rejects(parseMultipart(stream, { boundary: B }), /socket went away/);
});

test('parseMultipart with no boundary is a 415, not a crash', () => {
  assert.throws(() => new MultipartParser('', {}), (err) => {
    assert.equal(err.status, 415);
    return true;
  });
});
