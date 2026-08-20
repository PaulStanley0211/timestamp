/**
 * An RFC 7578 `multipart/form-data` parser that streams.
 *
 * WHY THIS IS HAND-WRITTEN AND NOT `multer`. Zero npm dependencies is a
 * property of this repository (docs/interfaces.md §0), and the whole of what a
 * body parser has to do is find one byte sequence in a stream. What it must
 * *not* do is the expensive part, and no dependency would have stopped us
 * getting that wrong.
 *
 * WHY IT NEVER BUFFERS THE WHOLE BODY. This endpoint takes uploads from
 * strangers. `req.on('data')` into an array of chunks, concatenate, then check
 * the size is the shape almost every hand-rolled parser has, and it means a
 * stranger with a 4 GB file can take the process down without uploading
 * anything the app would have accepted. The cap is counted on every chunk
 * BEFORE that chunk is parsed, and the overshoot is therefore bounded by one
 * chunk -- node:http's default highWaterMark, 64 KB -- rather than by whatever
 * the sender felt like sending. File parts go straight to a sink; only small
 * text fields are held in memory, and they are capped separately.
 *
 * WHY THE PARSER IS A PUSH STATE MACHINE WITH A RETAINED TAIL. The bug every
 * hand-rolled multipart parser has is the boundary that spans a chunk edge:
 * `\r\n--Bou` arrives at the end of one TCP segment and `ndary\r\n` at the
 * start of the next, `indexOf` finds nothing in either, and the delimiter is
 * written into the file as if it were image data. It only shows up with real
 * files at real sizes, and it presents as "the last few bytes of the photo are
 * corrupted", which sends you looking at ffmpeg. The fix is one invariant: when
 * the delimiter is not found, emit everything EXCEPT the last
 * `delimiter.length - 1` bytes and carry those forward. No suffix of the
 * delimiter can be longer than that, so no partial match can escape, and the
 * retained buffer is bounded at ~70 bytes regardless of file size. There is a
 * test that feeds a whole body one byte at a time, which is the worst case of
 * exactly this.
 *
 * WHY THE FIRST BOUNDARY IS FAKED. The opening delimiter has no leading CRLF;
 * every subsequent one does. Prepending a synthetic `\r\n` to the stream turns
 * that into one needle and one code path instead of a special case that gets
 * tested once and then rots.
 */

import fs from 'node:fs';

/** Carries an HTTP status, because every one of these failures has an obviously
 *  correct one and the router should not have to guess it back. */
export class MultipartError extends Error {
  constructor(message, { code = 'MULTIPART', status = 400, detail = null } = {}) {
    super(message);
    this.name = 'MultipartError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Defaults sized for what this app actually accepts. `maxBytes` mirrors
 * `intake/photo.mjs` LIMITS.maxBytes rather than being a second opinion about
 * it -- the caller passes the real one in; this is only the fallback for a
 * direct unit test.
 */
export const MULTIPART_DEFAULTS = Object.freeze({
  maxBytes: 12_000_000,
  /** One text field. 200 chars is the moderation limit; 8 KB is room for a
   *  browser's own encoding overhead and nothing like room for a payload. */
  maxFieldBytes: 8_192,
  /** A form with 200 parts is not this form. */
  maxParts: 24,
  /** One part's header block. Headers are held in memory to be parsed, so they
   *  need their own cap or they are the buffering hole the body cap closed. */
  maxHeaderBytes: 8_192,
});

const CRLF = Buffer.from('\r\n');
const CRLFCRLF = Buffer.from('\r\n\r\n');
const DASHDASH = Buffer.from('--');

/** Transport padding after a delimiter. Legal, effectively never used, and
 *  capped so that a run of spaces cannot become an unbounded `pending` buffer. */
const MAX_PADDING = 64;

/**
 * Pull the boundary out of a Content-Type header.
 *
 * Returns null rather than throwing for anything that is not multipart, because
 * "this request is not a form post" is a 415 the caller words, not a parse
 * error. RFC 2046 allows the boundary to be quoted and caps it at 70 chars;
 * anything longer or containing bytes outside the bcharsnospace set is refused,
 * since a boundary is about to be used as a search needle over user bytes.
 */
export function boundaryFromContentType(value) {
  if (typeof value !== 'string') return null;
  const [type, ...params] = value.split(';');
  if (type.trim().toLowerCase() !== 'multipart/form-data') return null;
  for (const param of params) {
    const eq = param.indexOf('=');
    if (eq === -1) continue;
    if (param.slice(0, eq).trim().toLowerCase() !== 'boundary') continue;
    let raw = param.slice(eq + 1).trim();
    if (raw.startsWith('"')) raw = raw.slice(1, raw.indexOf('"', 1) === -1 ? undefined : raw.indexOf('"', 1));
    if (raw.length === 0 || raw.length > 70) return null;
    // RFC 2046 bcharsnospace plus the space. CR and LF are deliberately NOT in
    // this set: the delimiter is `\r\n--<boundary>`, and a boundary containing
    // its own CRLF would put a second delimiter start inside the needle, which
    // is the one assumption the false-positive rescan in `push` relies on.
    if (!/^[0-9A-Za-z'()+_,\-./:=? ]+$/.test(raw)) return null;
    return raw.replace(/ +$/, '');
  }
  return null;
}

/** RFC 5987 / RFC 2231 `filename*=UTF-8''%e2%80%a6`. Browsers emit it for
 *  non-ASCII filenames, and a parser that ignores it silently loses the name. */
function decodeExtendedValue(raw) {
  const parts = String(raw).split("'");
  if (parts.length < 3) return null;
  const charset = parts[0].toLowerCase();
  if (charset !== 'utf-8' && charset !== 'iso-8859-1' && charset !== '') return null;
  try {
    return decodeURIComponent(parts.slice(2).join("'"));
  } catch {
    return null;
  }
}

/** One parameter out of a Content-Disposition value. Quoted-string with
 *  backslash escapes, or a bare token. */
function dispositionParam(header, name) {
  const extended = new RegExp(`;\\s*${name}\\*\\s*=\\s*([^;]+)`, 'i').exec(header);
  if (extended) {
    const decoded = decodeExtendedValue(extended[1].trim());
    if (decoded !== null) return decoded;
  }
  const quoted = new RegExp(`;\\s*${name}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(header);
  if (quoted) return quoted[1].replace(/\\(.)/g, '$1');
  const token = new RegExp(`;\\s*${name}\\s*=\\s*([^;\\s]+)`, 'i').exec(header);
  return token ? token[1] : null;
}

/**
 * A client filename is attacker-controlled text. Nothing in this app builds a
 * path from it -- upload destinations are fixed names inside the job directory
 * -- but it does reach the manifest and the page, so the traversal shape is
 * stripped here rather than trusted to stay unused.
 */
export function safeFilename(name) {
  if (typeof name !== 'string') return null;
  const base = name.split(/[/\\]/).pop() ?? '';
  // Control characters out: a filename carrying a CR could otherwise forge a
  // header line anywhere this string is echoed back.
  const cleaned = [...base].filter((ch) => ch.codePointAt(0) >= 0x20 && ch.codePointAt(0) !== 0x7f).join('').trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return null;
  return cleaned.slice(0, 200);
}

function parseHeaderBlock(raw) {
  const headers = {};
  for (const line of raw.toString('latin1').split('\r\n')) {
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon === -1) {
      throw new MultipartError(`malformed part header ${JSON.stringify(line.slice(0, 60))}`, {
        code: 'BAD_PART_HEADER',
      });
    }
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}

// ---------------------------------------------------------------------------
// the state machine
// ---------------------------------------------------------------------------

const PREAMBLE = 0;
const HEADERS = 1;
const BODY = 2;
const DONE = 3;

/**
 * Fed bytes, calls back with parts. Synchronous and socket-free on purpose:
 * everything interesting about this file is testable by handing it a Buffer,
 * and `test/web-multipart.test.js` does exactly that.
 */
export class MultipartParser {
  constructor(boundary, { onPartBegin, onPartData, onPartEnd, limits = MULTIPART_DEFAULTS } = {}) {
    if (typeof boundary !== 'string' || boundary.length === 0) {
      throw new MultipartError('multipart boundary is missing', { code: 'NO_BOUNDARY', status: 415 });
    }
    this.delimiter = Buffer.from(`\r\n--${boundary}`, 'latin1');
    this.limits = { ...MULTIPART_DEFAULTS, ...limits };
    this.onPartBegin = onPartBegin ?? (() => {});
    this.onPartData = onPartData ?? (() => true);
    this.onPartEnd = onPartEnd ?? (() => {});
    this.state = PREAMBLE;
    // The synthetic leading CRLF that makes the opening delimiter look like
    // every other one. See the header note.
    this.pending = CRLF;
    this.parts = 0;
    this.inPart = false;
    this.closed = false;
    /** Set false by a sink asking for backpressure; the driver reads it. */
    this.wantsMore = true;
  }

  push(chunk) {
    if (this.state === DONE) return; // epilogue after the closing delimiter
    let buf = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    this.pending = Buffer.alloc(0);

    for (;;) {
      if (this.state === HEADERS) {
        const end = buf.indexOf(CRLFCRLF);
        if (end === -1) {
          if (buf.length > this.limits.maxHeaderBytes) {
            throw new MultipartError('part headers exceed the limit', {
              code: 'HEADERS_TOO_LARGE', status: 431,
            });
          }
          this.pending = buf;
          return;
        }
        this.#beginPart(parseHeaderBlock(buf.subarray(0, end)));
        buf = buf.subarray(end + CRLFCRLF.length);
        this.state = BODY;
        continue;
      }

      // PREAMBLE and BODY differ only in whether the bytes are kept.
      const at = buf.indexOf(this.delimiter);

      if (at === -1) {
        // THE CHUNK-EDGE INVARIANT. Anything shorter than the delimiter could
        // still be its prefix, so it is carried forward instead of emitted.
        const keep = Math.min(buf.length, this.delimiter.length - 1);
        const flush = buf.subarray(0, buf.length - keep);
        if (flush.length > 0) this.#data(flush);
        this.pending = buf.subarray(buf.length - keep);
        return;
      }

      if (at > 0) this.#data(buf.subarray(0, at));

      // Two more bytes decide whether this is the last delimiter (`--`) or the
      // start of another part (CRLF, possibly after transport padding). Not
      // having them yet is not an error; it is a chunk edge in a different place.
      const tailStart = at + this.delimiter.length;
      if (buf.length < tailStart + 2) {
        this.pending = buf.subarray(at);
        return;
      }

      const tail = buf.subarray(tailStart);
      if (tail.subarray(0, 2).equals(DASHDASH)) {
        this.#endPart();
        this.closed = true;
        this.state = DONE;
        return;
      }

      // RFC 2046 permits linear whitespace ("transport padding") between the
      // delimiter and the CRLF. Rare, legal, and cheap to accept -- but capped,
      // because an unbounded run of spaces after a delimiter would otherwise be
      // held in `pending` forever waiting for a CRLF that is never coming.
      let skip = 0;
      while (skip < tail.length && skip <= MAX_PADDING && (tail[skip] === 0x20 || tail[skip] === 0x09)) skip += 1;
      if (skip <= MAX_PADDING && tail.length < skip + 2) {
        this.pending = buf.subarray(at);
        return;
      }

      if (skip > MAX_PADDING || !tail.subarray(skip, skip + 2).equals(CRLF)) {
        // NOT A DELIMITER, AND NOT AN ERROR. `\r\n--<boundary>` followed by
        // anything other than `--` or CRLF is ordinary body content that merely
        // looks like a delimiter -- and a JPEG containing those bytes by chance
        // is not a malformed request, it is a photograph. Refusing it here would
        // reject a small fraction of real uploads with a parse error nobody
        // could reproduce. So: emit one byte, resume the search from the next
        // one, and let the real delimiter be found wherever it actually is.
        // Advancing by a single byte rather than by the whole false match is
        // what makes that provably lossless.
        this.#data(buf.subarray(at, at + 1));
        buf = buf.subarray(at + 1);
        continue;
      }

      this.#endPart();
      buf = buf.subarray(tailStart + skip + 2);
      this.state = HEADERS;
    }
  }

  /** Called once the source stream is exhausted. A body that stops before the
   *  closing `--boundary--` is a truncated upload, and writing a truncated JPEG
   *  into a job as though it were the photo is worse than refusing it. */
  end() {
    if (!this.closed) {
      throw new MultipartError('request body ended before the closing boundary', {
        code: 'TRUNCATED', status: 400,
      });
    }
  }

  #beginPart(headers) {
    this.parts += 1;
    if (this.parts > this.limits.maxParts) {
      throw new MultipartError(`more than ${this.limits.maxParts} parts`, {
        code: 'TOO_MANY_PARTS', status: 413,
      });
    }
    const disposition = headers['content-disposition'] ?? '';
    const name = dispositionParam(disposition, 'name');
    if (!name) {
      throw new MultipartError('part has no Content-Disposition name', { code: 'PART_UNNAMED' });
    }
    const rawFilename = dispositionParam(disposition, 'filename');
    this.inPart = true;
    this.onPartBegin({
      name,
      // `filename` present but empty is how a browser posts an untouched file
      // input. It is a part with no file, not a file called "".
      filename: rawFilename === null ? null : safeFilename(rawFilename),
      hasFile: rawFilename !== null,
      contentType: headers['content-type'] ?? null,
      headers,
    });
  }

  #data(buf) {
    if (this.state === PREAMBLE || !this.inPart) return;
    if (this.onPartData(buf) === false) this.wantsMore = false;
  }

  #endPart() {
    if (!this.inPart) return;
    this.inPart = false;
    this.onPartEnd();
  }
}

// ---------------------------------------------------------------------------
// sinks
// ---------------------------------------------------------------------------

/**
 * Where a file part's bytes go. Injected, with a real default, per the house
 * rules: the server hands back a disk sink, and a unit test that passes nothing
 * gets a capped memory sink and never touches the filesystem.
 *
 * `write` returns false to ask the driver to pause the request. That is the
 * whole of backpressure here, and without it a fast uploader onto a slow disk
 * puts the difference in the process's heap -- which is the buffering this file
 * exists to avoid, arriving by a side door.
 */
export function memorySink({ maxBytes = MULTIPART_DEFAULTS.maxFieldBytes } = {}) {
  const chunks = [];
  let bytes = 0;
  return {
    kind: 'memory',
    write(buf) {
      bytes += buf.length;
      if (bytes > maxBytes) {
        throw new MultipartError(`file part exceeds ${maxBytes} bytes`, {
          code: 'PART_TOO_LARGE', status: 413,
        });
      }
      chunks.push(Buffer.from(buf));
      return true;
    },
    async end() {
      return { bytes, buffer: Buffer.concat(chunks) };
    },
    async abort() {
      chunks.length = 0;
    },
  };
}

/**
 * A file part written straight to disk.
 *
 * `abort()` unlinks. A failed upload that leaves a stranger's half-written
 * photograph on the disk is the file nobody ever goes back for, and this system
 * has an explicit retention promise it would be quietly breaking.
 */
export function fileSink(destPath, { fsImpl = fs } = {}) {
  const out = fsImpl.createWriteStream(destPath);
  let bytes = 0;
  let failure = null;
  out.on('error', (err) => { failure = err; });
  return {
    kind: 'file',
    path: destPath,
    write(buf) {
      bytes += buf.length;
      return out.write(buf);
    },
    onDrain(fn) { out.on('drain', fn); },
    end() {
      return new Promise((resolve, reject) => {
        out.end(() => (failure ? reject(failure) : resolve({ bytes, path: destPath })));
      });
    },
    async abort() {
      await new Promise((resolve) => out.close(resolve));
      try { fsImpl.rmSync(destPath, { force: true }); } catch { /* best effort */ }
    },
  };
}

// ---------------------------------------------------------------------------
// the driver
// ---------------------------------------------------------------------------

/**
 * Parse a request body into `{ fields, files }`.
 *
 * @param {import('node:stream').Readable} stream
 * @param {object} opts
 * @param {string} opts.boundary
 * @param {(part: {name, filename, contentType}) => object} [opts.sinkFor]
 *        returns a sink for a file part, or null to discard it
 * @returns {Promise<{fields: Record<string,string>, files: object[], bytesRead: number}>}
 */
export function parseMultipart(stream, {
  boundary,
  limits = MULTIPART_DEFAULTS,
  sinkFor = () => memorySink(),
} = {}) {
  const lim = { ...MULTIPART_DEFAULTS, ...limits };

  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];
    const openSinks = new Set();
    let bytesRead = 0;
    let current = null;
    let settled = false;

    const abortAll = async () => {
      for (const sink of openSinks) {
        try { await sink.abort(); } catch { /* best effort */ }
      }
      openSinks.clear();
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      // Stop reading. Not merely polite: pausing applies TCP backpressure, and
      // that is what turns "we rejected a 4 GB upload" into "we never received
      // a 4 GB upload".
      //
      // Deliberately `pause()` and NOT `destroy()`. A destroyed socket cannot
      // carry an HTTP status, so destroying here means the sender's client
      // reports a connection reset instead of "that upload is larger than
      // 12 MB" -- a refusal nobody can read is indistinguishable from a broken
      // server. The socket still has to be closed, because the rest of the body
      // is never going to be wanted; that is the caller's job, once it has
      // answered. See `closeConnection` in server.mjs.
      stream.pause?.();
      abortAll().then(() => reject(err));
    };

    /** File sinks close asynchronously; the parser does not. Each part's close
     *  promise is parked here and awaited once, in order, at the end. */
    const pendingCloses = [];

    const parser = new MultipartParser(boundary, {
      limits: lim,
      onPartBegin(part) {
        const isFile = part.hasFile && part.filename !== null;
        if (isFile) {
          const sink = sinkFor(part) ?? memorySink({ maxBytes: 0 });
          openSinks.add(sink);
          current = { ...part, isFile, sink };
          sink.onDrain?.(() => { parser.wantsMore = true; stream.resume?.(); });
        } else {
          current = { ...part, isFile, chunks: [], bytes: 0 };
        }
      },
      onPartData(buf) {
        if (!current) return true;
        if (current.isFile) return current.sink.write(buf);
        current.bytes += buf.length;
        if (current.bytes > lim.maxFieldBytes) {
          throw new MultipartError(`field "${current.name}" exceeds ${lim.maxFieldBytes} bytes`, {
            code: 'FIELD_TOO_LARGE', status: 413,
          });
        }
        current.chunks.push(Buffer.from(buf));
        return true;
      },
      onPartEnd() {
        if (!current) return;
        const part = current;
        current = null;
        if (!part.isFile) {
          fields[part.name] = Buffer.concat(part.chunks).toString('utf8');
          return;
        }
        // THE BACKPRESSURE RELEASE, AND IT IS LOAD-BEARING. A sink that has been
        // ended can never emit `drain` again -- a Writable that is closing emits
        // `finish`, not `drain` -- so if this part's last write asked us to
        // pause, the resume would never come and the request stream would sit
        // paused forever with its `end` event undelivered. That is a hang, not
        // an error, and it happens exactly when the whole body arrives in one
        // chunk: small uploads deadlock while large ones, which get a drain
        // between chunks, sail through. Clearing the flag here is what makes the
        // small case work, and `!parser.closed` below is the second half.
        parser.wantsMore = true;
        stream.resume?.();

        // Closing a file sink is async and the parser is not. The promise is
        // parked on the part and awaited once at the end, in order, so a slow
        // fsync cannot reorder itself against the next part's bytes.
        part.closing = part.sink.end().then((result) => {
          openSinks.delete(part.sink);
          files.push({
            name: part.name,
            filename: part.filename,
            contentType: part.contentType,
            ...result,
          });
        });
        pendingCloses.push(part.closing);
      },
    });

    stream.on('data', (chunk) => {
      if (settled) return;
      // COUNTED BEFORE PARSED. The overshoot is one chunk, not one upload.
      bytesRead += chunk.length;
      if (bytesRead > lim.maxBytes) {
        fail(new MultipartError(`upload exceeds ${lim.maxBytes} bytes`, {
          code: 'TOO_LARGE', status: 413, detail: { maxBytes: lim.maxBytes, bytesRead },
        }));
        return;
      }
      try {
        parser.push(chunk);
      } catch (err) {
        fail(err);
        return;
      }
      // Never pause a stream the parser is finished with: the closing boundary
      // has been seen, nothing more will be written to a sink, and pausing here
      // would withhold the `end` event that resolves this promise.
      if (!parser.wantsMore && !parser.closed) stream.pause?.();
    });

    stream.on('error', (err) => fail(err));

    stream.on('aborted', () => fail(new MultipartError('client aborted the upload', {
      code: 'ABORTED', status: 400,
    })));

    stream.on('end', () => {
      if (settled) return;
      try {
        parser.end();
      } catch (err) {
        fail(err);
        return;
      }
      settled = true;
      Promise.all(pendingCloses)
        .then(() => resolve({ fields, files, bytesRead }))
        .catch((err) => { abortAll().then(() => reject(err)); });
    });
  });
}
