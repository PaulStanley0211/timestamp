/**
 * The HTTP surface, end to end, against a real listener on port 0.
 *
 * The queue is a fake. That is not a shortcut: `scripts/queue/queue.mjs` is
 * written in parallel with this file and has its own tests, and what these tests
 * are about is whether the web layer talks to a queue *correctly* -- enqueues
 * once, enqueues after the manifest exists, asks before it writes -- which a fake
 * that records calls answers better than the real thing does.
 *
 * There is no ffmpeg here either. `POST /api/jobs` does not decode the upload;
 * `intake` does, in the worker. What this file proves is that the bytes a client
 * sent are the bytes on disk, which is a sha256 comparison and needs no codec.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { createServer } from '../scripts/web/server.mjs';
import {
  JOB_ID_RE, createJob, loadJob, saveJob, jobPaths,
  setJobStatus, completeJob,
} from '../scripts/render/job.mjs';

const CFG = JSON.parse(fs.readFileSync(new URL('../config/render.json', import.meta.url), 'utf8'));

const BOUNDARY = 'testboundary9f2a';

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

/** Records what the web layer asks of a queue, and lets a test pretend a worker
 *  is holding a lease. */
function fakeQueue() {
  const calls = { enqueued: [], peeked: 0 };
  let claimed = [];
  return {
    calls,
    holdLease(jobId, { expired = false } = {}) {
      claimed = [{ jobId, workerId: 'w1', claimedAt: new Date().toISOString(), expired }];
    },
    releaseAll() { claimed = []; },
    enqueue(jobId, opts = {}) { calls.enqueued.push(jobId); return { jobId, ...opts }; },
    peek({ state = 'pending' } = {}) {
      calls.peeked += 1;
      return state === 'claimed' ? claimed : calls.enqueued.map((jobId) => ({ jobId }));
    },
    stats() {
      return { pending: calls.enqueued.length, claimed: claimed.length, done: 0, failed: 0 };
    },
  };
}

async function withServer(run, { queue = fakeQueue() } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-web-'));
  const app = createServer({
    root,
    cfg: CFG,
    queue,
    port: 0,
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed',
  });
  const port = await app.listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    await run({ base, root, queue, app });
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function multipart(parts) {
  const chunks = [];
  for (const p of parts) {
    const disposition = p.filename === undefined
      ? `form-data; name="${p.name}"`
      : `form-data; name="${p.name}"; filename="${p.filename}"`;
    chunks.push(Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: ${disposition}\r\n`
      + (p.type ? `Content-Type: ${p.type}\r\n` : '') + '\r\n', 'latin1',
    ));
    chunks.push(Buffer.isBuffer(p.body) ? p.body : Buffer.from(String(p.body), 'utf8'));
    chunks.push(Buffer.from('\r\n', 'latin1'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`, 'latin1'));
  return Buffer.concat(chunks);
}

/** A PNG header plus deterministic filler. Nothing decodes it here; it exists so
 *  the bytes that arrive can be compared with the bytes that were sent. */
function fakePhoto(bytes = 40_000, salt = 'a') {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const filler = crypto.createHash('sha512').update(salt).digest();
  const body = Buffer.alloc(bytes - head.length);
  for (let i = 0; i < body.length; i += filler.length) filler.copy(body, i);
  return Buffer.concat([head, body]);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Job directories under a root. A refusal that fires before the id is minted
 *  leaves `out/jobs` absent altogether, which is a stronger form of "nothing was
 *  written" than an empty directory, not a different one. */
function jobDirs(root) {
  try { return fs.readdirSync(path.join(root, 'out', 'jobs')); } catch { return []; }
}

function post(base, pathname, body, headers = {}, init = {}) {
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, ...headers },
    body,
    ...init,
  });
}

const goodParts = (extra = []) => ([
  { name: 'photo', filename: 'me.png', type: 'image/png', body: fakePhoto() },
  { name: 'place', body: 'my grandmother s kitchen' },
  { name: 'outfit', body: 'a green anorak' },
  { name: 'consent', body: 'yes' },
  ...extra,
]);

/** Build a job straight through the model, to put the server in front of a state
 *  a worker would have produced. */
function seedJob(root, { status = 'queued', place = 'a beach', outfit = 'a t-shirt', result = null } = {}) {
  const job = createJob({
    root,
    input: {
      photo: { path: 'input/upload-photo', sha256: 'x'.repeat(64) },
      place: { kind: 'text', value: place },
      outfit: { kind: 'text', value: outfit },
      stillCount: 3,
      consent: { granted: true, at: new Date().toISOString(), text: 'the wording' },
    },
    provider: 'fixture',
    cfg: CFG,
  });
  if (status !== 'queued') {
    setJobStatus(job, 'running');
    if (status === 'done') completeJob(job, result ?? { videoPath: 'timestamp.mp4' });
    else if (status !== 'running') setJobStatus(job, status);
  }
  saveJob(job);
  return job;
}

// ---------------------------------------------------------------------------
// the upload page
// ---------------------------------------------------------------------------

test('GET / offers all fourteen presets as recommendations, not a menu', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();

    for (const label of [
      'Allotment garden, late August', 'Autobahn rest stop at dusk', 'Balcony, washing on the line',
      'Indoor swimming pool', 'Tiled kitchen at breakfast', 'Baltic beach, out of season',
      'Concrete stairwell', 'Living room, television on',
      'Half-zip fleece', 'Checked shirt and jeans', 'Cotton summer dress',
      'Knitted cardigan', 'Tracksuit jacket', 'Padded winter jacket',
    ]) {
      assert.ok(html.includes(label), `${label} is missing from the page`);
    }

    assert.ok(html.includes('enctype="multipart/form-data"'));
    assert.ok(html.includes('name="place"') && html.includes('name="outfit"'));
    assert.ok(html.includes('name="placePhoto"'), 'the optional place photo is offered');
    assert.ok(html.includes('name="consent"'));
    assert.ok(!/<select[^>]*name="place"/.test(html),
      'place must be free text -- a dropdown says the menu is a gate');
  });
});

test('GET /styles.css is served, cached and revalidatable', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/styles.css`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/css/);
    const etag = res.headers.get('etag');
    assert.ok(etag);
    const again = await fetch(`${base}/styles.css`, { headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304);
  });
});

// ---------------------------------------------------------------------------
// POST /api/jobs
// ---------------------------------------------------------------------------

test('POST /api/jobs is 201 immediately, and the bytes land intact', async () => {
  await withServer(async ({ base, root, queue }) => {
    const photo = fakePhoto(120_000, 'landing');
    const sent = sha256(photo);

    const started = Date.now();
    const res = await post(base, '/api/jobs', multipart([
      { name: 'photo', filename: 'me.png', type: 'image/png', body: photo },
      { name: 'place', body: 'my grandmother s kitchen' },
      { name: 'outfit', body: 'a green anorak' },
      { name: 'consent', body: 'yes' },
    ]));
    const elapsed = Date.now() - started;

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.match(body.jobId, JOB_ID_RE);
    assert.equal(body.statusUrl, `/j/${body.jobId}`);
    assert.equal(res.headers.get('location'), `/j/${body.jobId}`);

    // NOTHING IS REQUEST/RESPONSE. This must return before any render could
    // conceivably have run, and the job must be sitting untouched at step one.
    assert.ok(elapsed < 3000, `took ${elapsed}ms -- something is being awaited`);

    const job = loadJob({ root, jobId: body.jobId });
    assert.equal(job.status, 'queued');
    assert.equal(job.steps[0].status, 'pending');
    assert.equal(job.steps[0].attempts, 0);
    assert.equal(job.result.videoPath, null);

    // The bytes.
    const stored = fs.readFileSync(`${jobPaths(root, body.jobId).dir}/${job.input.photo.path}`);
    assert.equal(sha256(stored), sent, 'stored photo differs from the uploaded photo');
    assert.equal(job.input.photo.sha256, sent, 'the manifest hash does not match the file');

    // The pointer went on the board, once, after the manifest existed.
    assert.deepEqual(queue.calls.enqueued, [body.jobId]);
  });
});

test('free text is recorded as text and a recommendation as the preset it names', async () => {
  await withServer(async ({ base, root }) => {
    const free = await post(base, '/api/jobs', multipart(goodParts()));
    const freeJob = loadJob({ root, jobId: (await free.json()).jobId });
    assert.equal(freeJob.input.place.kind, 'text');
    assert.equal(freeJob.input.place.value, 'my grandmother s kitchen');
    assert.equal(freeJob.input.outfit.kind, 'text');

    const chipped = await post(base, '/api/jobs', multipart([
      { name: 'photo', filename: 'me.png', type: 'image/png', body: fakePhoto() },
      { name: 'place', body: 'Allotment garden, late August' },
      { name: 'outfit', body: 'Tracksuit jacket' },
      { name: 'consent', body: 'on' },
    ]));
    const chipJob = loadJob({ root, jobId: (await chipped.json()).jobId });
    assert.equal(chipJob.input.place.kind, 'preset');
    assert.equal(chipJob.input.place.value, 'schrebergarten-august');
    assert.equal(chipJob.input.outfit.kind, 'preset');
    assert.equal(chipJob.input.outfit.value, 'trainingsjacke');
  });
});

test('a photo of the place is a second reference, and both files land', async () => {
  await withServer(async ({ base, root }) => {
    const face = fakePhoto(30_000, 'face');
    const place = fakePhoto(50_000, 'place');
    const res = await post(base, '/api/jobs', multipart([
      { name: 'photo', filename: 'me.png', type: 'image/png', body: face },
      { name: 'placePhoto', filename: 'garden.png', type: 'image/png', body: place },
      { name: 'place', body: 'the garden behind the house' },
      { name: 'outfit', body: 'a fleece' },
      { name: 'consent', body: 'yes' },
    ]));
    assert.equal(res.status, 201);
    const { jobId } = await res.json();
    const job = loadJob({ root, jobId });
    const dir = jobPaths(root, jobId).dir;

    assert.equal(job.input.place.kind, 'photo');
    assert.equal(job.input.place.value, 'the garden behind the house');
    assert.equal(sha256(fs.readFileSync(`${dir}/${job.input.photo.path}`)), sha256(face));
    assert.equal(sha256(fs.readFileSync(`${dir}/${job.input.place.photoPath}`)), sha256(place));
    assert.equal(job.input.place.photoSha256, sha256(place));
  });
});

test('every manifest path is relative -- saveJob throws PATH_NOT_RELATIVE otherwise', async () => {
  await withServer(async ({ base, root }) => {
    const { jobId } = await (await post(base, '/api/jobs', multipart(goodParts()))).json();
    const raw = JSON.parse(fs.readFileSync(jobPaths(root, jobId).manifest, 'utf8'));
    for (const p of [raw.input.photo.path, raw.input.place.photoPath].filter(Boolean)) {
      assert.ok(!path.isAbsolute(p) && !p.includes('\\') && !/^[A-Za-z]:/.test(p), `${p} is not relative`);
    }
  });
});

test('consent is a gate, and a refused upload leaves nothing on disk', async () => {
  await withServer(async ({ base, root, queue }) => {
    for (const consent of [undefined, 'false', '', 'no', 'off']) {
      const parts = goodParts().filter((p) => p.name !== 'consent');
      if (consent !== undefined) parts.push({ name: 'consent', body: consent });
      const res = await post(base, '/api/jobs', multipart(parts));
      assert.equal(res.status, 400, `consent=${JSON.stringify(consent)} was accepted`);
      assert.equal((await res.json()).error.status, 400);
    }
    // Not one directory, not one photograph.
    assert.deepEqual(jobDirs(root), []);
    assert.deepEqual(queue.calls.enqueued, []);
  });
});

test('a missing photo, missing text and over-long text are each a 400', async () => {
  await withServer(async ({ base, root }) => {
    const cases = [
      goodParts().filter((p) => p.name !== 'photo'),
      goodParts().filter((p) => p.name !== 'outfit'),
      goodParts().map((p) => (p.name === 'place' ? { name: 'place', body: 'x'.repeat(300) } : p)),
      goodParts().map((p) => (p.name === 'photo' ? { ...p, body: Buffer.alloc(0) } : p)),
    ];
    for (const parts of cases) {
      assert.equal((await post(base, '/api/jobs', multipart(parts))).status, 400);
    }
    assert.deepEqual(jobDirs(root), []);
  });
});

test('an upload over the cap is 413 and a non-multipart post is 415', async () => {
  await withServer(async ({ base, root }) => {
    const huge = await post(base, '/api/jobs', multipart([
      { name: 'photo', filename: 'big.png', type: 'image/png', body: fakePhoto(13_000_000, 'big') },
      { name: 'place', body: 'a beach' },
      { name: 'outfit', body: 'a shirt' },
      { name: 'consent', body: 'yes' },
    ]));
    assert.equal(huge.status, 413);

    const wrongType = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ place: 'a beach' }),
    });
    assert.equal(wrongType.status, 415);

    assert.deepEqual(jobDirs(root), []);
  });
});

test('a browser form post is redirected; an API client gets the 201', async () => {
  await withServer(async ({ base }) => {
    // `redirect: 'manual'` because the point under test IS the redirect; fetch
    // would otherwise follow it and report the 200 from the status page.
    const res = await post(base, '/api/jobs', multipart(goodParts()), {
      accept: 'text/html,application/xhtml+xml',
    }, { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /^\/j\/\d{8}-\d{6}-[0-9a-f]{6}$/);
  }, {});
});

// ---------------------------------------------------------------------------
// GET /api/jobs/:id
// ---------------------------------------------------------------------------

test('GET /api/jobs/:id has the documented shape', async () => {
  await withServer(async ({ base, root }) => {
    const job = seedJob(root);
    const res = await fetch(`${base}/api/jobs/${job.jobId}`);
    assert.equal(res.status, 200);
    const view = await res.json();

    for (const key of ['jobId', 'status', 'step', 'pct', 'steps', 'cost', 'result', 'error']) {
      assert.ok(key in view, `${key} missing from the payload`);
    }
    assert.equal(view.jobId, job.jobId);
    assert.equal(view.status, 'queued');
    assert.equal(view.step, 'intake');
    assert.equal(view.pct, 0);
    assert.equal(view.steps.length, 11);
    assert.equal(view.error, null);
    assert.equal(view.result.videoUrl, null);
  });
});

test('pct counts finished steps and never runs ahead of them', async () => {
  await withServer(async ({ base, root }) => {
    const job = seedJob(root);
    job.steps[0].status = 'done';
    job.steps[1].status = 'skipped';
    saveJob(job);
    const view = await (await fetch(`${base}/api/jobs/${job.jobId}`)).json();
    assert.equal(view.pct, Math.round((2 / 11) * 100));
    assert.equal(view.step, 'expand');
  });
});

test('a bad id is 400 before the filesystem, and an unknown id is 404', async () => {
  await withServer(async ({ base }) => {
    for (const id of ['not-an-id', '2026-08-20', '20260820-144501-A3F19C', 'x'.repeat(80)]) {
      const res = await fetch(`${base}/api/jobs/${encodeURIComponent(id)}`);
      assert.equal(res.status, 400, `${id} was not refused`);
    }
    // Right shape, no such job.
    assert.equal((await fetch(`${base}/api/jobs/20260820-144501-a3f19c`)).status, 404);
  });
});

test('traversal in the path never reaches the filesystem', async () => {
  await withServer(async ({ base }) => {
    for (const target of [
      '/api/jobs/%2e%2e%2f%2e%2e%2fconfig%2frender.json',
      '/api/jobs/..%2f..%2fpackage.json/video',
      '/j/%2e%2e%2f%2e%2e',
    ]) {
      const res = await fetch(`${base}${target}`);
      assert.ok(res.status === 400 || res.status === 404, `${target} -> ${res.status}`);
      const text = await res.text();
      assert.ok(!text.includes('durationSeconds'), 'a repo file was served');
      assert.ok(!text.includes('"name": "timestamp"'), 'package.json was served');
    }
  });
});

// ---------------------------------------------------------------------------
// escaping
// ---------------------------------------------------------------------------

test('free text is escaped everywhere it is echoed back', async () => {
  await withServer(async ({ base, root }) => {
    const nasty = '<img src=x onerror=alert(1)>"\'&';
    const job = seedJob(root, { place: nasty, outfit: `</script><script>alert(2)</script>` });

    const page = await (await fetch(`${base}/j/${job.jobId}`)).text();
    assert.ok(!page.includes('<img src=x'), 'the place field rendered as markup');
    assert.ok(!page.includes('<script>alert(2)'), 'the outfit field closed the script element');
    assert.ok(page.includes('&lt;img src=x onerror=alert(1)&gt;'), 'and it is visible as text');

    // The JSON payload the poller reads carries it raw, which is correct -- JSON
    // is not HTML -- and the page must be the thing that escapes it.
    const view = await (await fetch(`${base}/api/jobs/${job.jobId}`)).json();
    assert.equal(view.input.place, nasty);
  });
});

test('pages declare a content security policy and refuse to be sniffed', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/`);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });
});

// ---------------------------------------------------------------------------
// stills and selection -- 1-BASED
// ---------------------------------------------------------------------------

/** Writes still files with a deliberate gap, so a handler that numbers by array
 *  position rather than by filename produces the wrong answer and this test says
 *  so. That is the exact bug the 1-based ruling exists to prevent. */
function writeStills(root, jobId, numbers) {
  const dir = jobPaths(root, jobId).stills;
  fs.mkdirSync(dir, { recursive: true });
  for (const n of numbers) {
    fs.writeFileSync(`${dir}/still-${String(n).padStart(2, '0')}.png`, Buffer.from(`still ${n}`));
  }
}

test('stills are numbered 1-based, off the filename and not off the loop', async () => {
  await withServer(async ({ base, root }) => {
    const job = seedJob(root, { status: 'awaiting-selection' });
    writeStills(root, job.jobId, [1, 2, 4]);

    const body = await (await fetch(`${base}/api/jobs/${job.jobId}/stills`)).json();
    assert.deepEqual(body.stills.map((s) => s.index), [1, 2, 4],
      'indices must come off still-NN.png, not from the array position');
    assert.equal(body.stills[0].url, `/api/jobs/${job.jobId}/stills/1`);
    assert.equal(body.selected, null);

    // And the file behind index 4 is still-04.png, not the fourth entry.
    const png = await (await fetch(`${base}/api/jobs/${job.jobId}/stills/4`)).text();
    assert.equal(png, 'still 4');
    assert.equal((await fetch(`${base}/api/jobs/${job.jobId}/stills/3`)).status, 404);
    assert.equal((await fetch(`${base}/api/jobs/${job.jobId}/stills/0`)).status, 400);
  });
});

test('POST select records the 1-based index and re-enqueues', async () => {
  await withServer(async ({ base, root, queue }) => {
    const job = seedJob(root, { status: 'awaiting-selection' });
    writeStills(root, job.jobId, [1, 2, 3]);

    const res = await fetch(`${base}/api/jobs/${job.jobId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stillIndex: 1 }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { jobId: job.jobId, stillIndex: 1, status: 'running' });

    const after = loadJob({ root, jobId: job.jobId });
    assert.equal(after.selection.stillIndex, 1, 'index 1 is still-01.png, not the second frame');
    assert.equal(after.selection.chosenBy, 'human');
    assert.deepEqual(queue.calls.enqueued, [job.jobId], 'the job went back on the board');
  });
});

test('an out-of-range still index is a 400 and never a clamp', async () => {
  await withServer(async ({ base, root }) => {
    const job = seedJob(root, { status: 'awaiting-selection' });
    writeStills(root, job.jobId, [1, 2, 3]);

    for (const stillIndex of [0, -1, 4, 99, 1.5, 'two', null]) {
      const res = await fetch(`${base}/api/jobs/${job.jobId}/select`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stillIndex }),
      });
      assert.equal(res.status, 400, `stillIndex=${JSON.stringify(stillIndex)} was accepted`);
    }
    assert.equal(loadJob({ root, jobId: job.jobId }).selection.stillIndex, null,
      'a refused selection must not have been clamped into the manifest');
  });
});

test('select is 409 unless the job is parked, and 409 while a worker holds it', async () => {
  await withServer(async ({ base, root, queue }) => {
    const running = seedJob(root, { status: 'running' });
    writeStills(root, running.jobId, [1]);
    const busy = await fetch(`${base}/api/jobs/${running.jobId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stillIndex: 1 }),
    });
    assert.equal(busy.status, 409);

    const parked = seedJob(root, { status: 'awaiting-selection' });
    writeStills(root, parked.jobId, [1]);
    queue.holdLease(parked.jobId);
    const leased = await fetch(`${base}/api/jobs/${parked.jobId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stillIndex: 1 }),
    });
    assert.equal(leased.status, 409, 'the web process must not write a manifest a worker holds');
    assert.deepEqual(queue.calls.enqueued, []);
  });
});

test('the contact sheet posts the index off the record, as a plain form', async () => {
  await withServer(async ({ base, root }) => {
    const job = seedJob(root, { status: 'awaiting-selection' });
    writeStills(root, job.jobId, [1, 2, 4]);
    const html = await (await fetch(`${base}/j/${job.jobId}/select`)).text();

    assert.ok(html.includes(`action="/api/jobs/${job.jobId}/select"`));
    assert.ok(html.includes('name="stillIndex" value="1"'));
    assert.ok(html.includes('name="stillIndex" value="4"'));
    assert.ok(!html.includes('name="stillIndex" value="0"'), 'there is no frame zero');
    assert.ok(!html.includes('name="stillIndex" value="3"'), 'still-03.png does not exist');
    assert.ok(html.includes('>4</span>'), 'the number shown matches the number posted');

    // A form post gets a redirect back to the status page.
    const res = await fetch(`${base}/api/jobs/${job.jobId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
      body: 'stillIndex=4',
      redirect: 'manual',
    });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), `/j/${job.jobId}`);
    assert.equal(loadJob({ root, jobId: job.jobId }).selection.stillIndex, 4);
  });
});

// ---------------------------------------------------------------------------
// pages that redirect
// ---------------------------------------------------------------------------

test('the status page sends you where the job actually is', async () => {
  await withServer(async ({ base, root }) => {
    const queued = seedJob(root);
    const page = await fetch(`${base}/j/${queued.jobId}`, { redirect: 'manual' });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes('Reading your photo'), 'the current step is named');
    assert.ok(!/\b9[0-9]%/.test(html), 'no fake percentage');

    const parked = seedJob(root, { status: 'awaiting-selection' });
    const toSelect = await fetch(`${base}/j/${parked.jobId}`, { redirect: 'manual' });
    assert.equal(toSelect.status, 303);
    assert.equal(toSelect.headers.get('location'), `/j/${parked.jobId}/select`);

    const finished = seedJob(root, { status: 'done' });
    const toResult = await fetch(`${base}/j/${finished.jobId}`, { redirect: 'manual' });
    assert.equal(toResult.status, 303);
    assert.equal(toResult.headers.get('location'), `/j/${finished.jobId}/result`);

    // And the reverse: a result page for an unfinished job goes back.
    const back = await fetch(`${base}/j/${queued.jobId}/result`, { redirect: 'manual' });
    assert.equal(back.status, 303);
    assert.equal(back.headers.get('location'), `/j/${queued.jobId}`);
  });
});

test('the result page offers the video, a download and a way to start again', async () => {
  await withServer(async ({ base, root }) => {
    const job = seedJob(root, { status: 'done' });
    fs.writeFileSync(jobPaths(root, job.jobId).video, Buffer.alloc(2048, 7));
    const html = await (await fetch(`${base}/j/${job.jobId}/result`)).text();
    assert.ok(html.includes('<video controls'));
    assert.ok(html.includes(`src="/api/jobs/${job.jobId}/video"`));
    assert.ok(html.includes('download='));
    assert.ok(html.includes('Make another'));
  });
});

// ---------------------------------------------------------------------------
// media
// ---------------------------------------------------------------------------

test('the video is range-request capable', async () => {
  await withServer(async ({ base, root }) => {
    const job = seedJob(root, { status: 'done' });
    const bytes = crypto.randomBytes(5000);
    fs.writeFileSync(jobPaths(root, job.jobId).video, bytes);
    const url = `${base}/api/jobs/${job.jobId}/video`;

    const whole = await fetch(url);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('accept-ranges'), 'bytes');
    assert.equal(whole.headers.get('content-type'), 'video/mp4');
    assert.equal(Buffer.from(await whole.arrayBuffer()).length, 5000);

    const partial = await fetch(url, { headers: { range: 'bytes=100-199' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 100-199/5000');
    const got = Buffer.from(await partial.arrayBuffer());
    assert.equal(got.length, 100);
    assert.ok(got.equals(bytes.subarray(100, 200)), 'the wrong bytes came back');

    const tail = await fetch(url, { headers: { range: 'bytes=-50' } });
    assert.equal(tail.status, 206);
    assert.ok(Buffer.from(await tail.arrayBuffer()).equals(bytes.subarray(4950)),
      'bytes=-50 is the LAST fifty bytes');

    const bad = await fetch(url, { headers: { range: 'bytes=99999-' } });
    assert.equal(bad.status, 416);

    const attached = await fetch(`${url}?download=1`);
    assert.match(attached.headers.get('content-disposition'), /attachment; filename="timestamp-/);
  });
});

test('asking for a video or poster that does not exist yet is 404, not 500', async () => {
  await withServer(async ({ base, root }) => {
    const job = seedJob(root);
    assert.equal((await fetch(`${base}/api/jobs/${job.jobId}/video`)).status, 404);
    assert.equal((await fetch(`${base}/api/jobs/${job.jobId}/poster`)).status, 404);
  });
});

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

test('DELETE on an unclaimed job cancels it and deletes the photograph', async () => {
  await withServer(async ({ base, root }) => {
    const { jobId } = await (await post(base, '/api/jobs', multipart(goodParts()))).json();
    const paths = jobPaths(root, jobId);
    assert.ok(fs.existsSync(`${paths.dir}/input/upload-photo`));

    const res = await fetch(`${base}/api/jobs/${jobId}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'cancelled');
    assert.ok(body.photosDeleted >= 1);

    assert.equal(loadJob({ root, jobId }).status, 'cancelled');
    assert.deepEqual(fs.readdirSync(paths.input), [], 'the uploaded photo is gone');
    assert.ok(fs.existsSync(paths.cancelRequest), 'the sentinel is written either way');
  });
});

test('DELETE on a job a worker holds is 202 and does NOT touch the manifest', async () => {
  await withServer(async ({ base, root, queue }) => {
    const job = seedJob(root, { status: 'running' });
    const before = fs.readFileSync(jobPaths(root, job.jobId).manifest, 'utf8');
    queue.holdLease(job.jobId);

    const res = await fetch(`${base}/api/jobs/${job.jobId}`, { method: 'DELETE' });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.cancelRequested, true);
    assert.equal(body.status, 'running');

    assert.equal(fs.readFileSync(jobPaths(root, job.jobId).manifest, 'utf8'), before,
      'the web process wrote a manifest a worker holds the lease on');
    assert.ok(fs.existsSync(jobPaths(root, job.jobId).cancelRequest),
      'the worker needs the sentinel to make the transition itself');
  });
});

test('an expired lease is not a claim', async () => {
  await withServer(async ({ base, root, queue }) => {
    const job = seedJob(root, { status: 'running' });
    queue.holdLease(job.jobId, { expired: true });
    const res = await fetch(`${base}/api/jobs/${job.jobId}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(loadJob({ root, jobId: job.jobId }).status, 'cancelled');
  });
});

// ---------------------------------------------------------------------------
// health and the edges
// ---------------------------------------------------------------------------

test('GET /api/health reports ffmpeg, the queue and the worker', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.ffmpeg.available, true);
    assert.deepEqual(Object.keys(body.queue).sort(), ['claimed', 'done', 'failed', 'pending']);
    assert.ok('lastSeen' in body.worker);
  });
});

test('health says so honestly when ffmpeg is missing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-web-'));
  const app = createServer({
    root,
    cfg: CFG,
    queue: fakeQueue(),
    port: 0,
    ffprobeImpl: async () => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; },
  });
  const port = await app.listen();
  try {
    const body = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal(body.ok, false);
    assert.equal(body.ffmpeg.available, false);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the wrong method on a real path is 405 with Allow, not 404', async () => {
  await withServer(async ({ base, root }) => {
    const job = seedJob(root);
    const res = await fetch(`${base}/api/jobs/${job.jobId}/video`, { method: 'POST' });
    assert.equal(res.status, 405);
    assert.match(res.headers.get('allow'), /GET/);

    const opts = await fetch(`${base}/api/jobs/${job.jobId}`, { method: 'OPTIONS' });
    assert.equal(opts.status, 204);
    assert.match(opts.headers.get('allow'), /DELETE/);
  });
});

test('an unknown path is an HTML 404 for a browser and JSON for a client', async () => {
  await withServer(async ({ base }) => {
    const api = await fetch(`${base}/api/nope`);
    assert.equal(api.status, 404);
    assert.match(api.headers.get('content-type'), /application\/json/);

    const browser = await fetch(`${base}/nope`, { headers: { accept: 'text/html' } });
    assert.equal(browser.status, 404);
    assert.match(browser.headers.get('content-type'), /text\/html/);
    assert.ok((await browser.text()).includes('Start again'));
  });
});

test('HEAD works wherever GET does and sends no body', async () => {
  await withServer(async ({ base, root }) => {
    const job = seedJob(root);
    const res = await fetch(`${base}/api/jobs/${job.jobId}`, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal((await res.text()).length, 0);
  });
});
