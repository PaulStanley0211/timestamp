/**
 * The HTTP surface, end to end, against a real listener on port 0.
 *
 * The queue is a fake and so is `scripts/auth/`. That is not a shortcut in
 * either case. `scripts/queue/queue.mjs` and `scripts/auth/*` have their own
 * tests; what these tests are about is whether the web layer talks to them
 * *correctly* -- enqueues once, enqueues after the manifest exists, asks before
 * it writes, spends credits at enqueue and not at completion -- which fakes
 * that record calls answer better than the real things do. The auth fake also
 * exists because `scripts/auth/` was written in parallel with this file and the
 * web layer has to be provable without it.
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
import { SESSION_COOKIE } from '../scripts/web/session-middleware.mjs';
// Imported so the page's offer can be checked against the thing that would
// actually render it, rather than against a list written down twice.
import { resolveRaster } from '../scripts/render/pipeline.mjs';
import { FAL_CAPABILITIES } from '../scripts/providers/fal.mjs';
import {
  JOB_ID_RE, createJob, loadJob, saveJob, jobPaths,
  setJobStatus, completeJob, failStep, beginStep,
} from '../scripts/render/job.mjs';

const CFG = JSON.parse(fs.readFileSync(new URL('../config/render.json', import.meta.url), 'utf8'));

const BOUNDARY = 'testboundary9f2a';

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

/** Records what the web layer asks of a queue, and lets a test pretend a worker
 *  is holding a lease. */
function fakeQueue() {
  // `statted` counts what the real `stats()` would have cost: one readFileSync
  // per pending entry plus three readdirSync. It is counted separately from
  // `peeked` because they are two different reads of the same directory and a
  // cache has to stop both.
  const calls = { enqueued: [], peeked: 0, statted: 0 };
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
      calls.statted += 1;
      return { pending: calls.enqueued.length, claimed: claimed.length, done: 0, failed: 0 };
    },
  };
}

const PLANS = Object.freeze({
  free: { id: 'free', label: 'Free', monthlyUSD: 0, annualUSD: 0, creditsPerPeriod: 51 },
  shelf: { id: 'shelf', label: 'Shelf', monthlyUSD: 10, annualUSD: 100, creditsPerPeriod: 153 },
  archive: { id: 'archive', label: 'Archive', monthlyUSD: 12, annualUSD: 120, creditsPerPeriod: 204 },
});

/**
 * `CREDIT_COSTS` as `scripts/auth/credits.mjs` exports it: every row the config
 * knows about, INCLUDING the deferred one, each carrying its own `available`.
 * The deferred row is the point -- the UI has to know 1080p exists in order to
 * render it disabled, and the page must be built from this rather than from a
 * list written into the web layer. The figures are the live ones: 51 CR at
 * 480p, 152 at 720p, 341 at the deferred 1080p.
 */
const CREDIT_COSTS = Object.freeze({
  '480p': { resolution: '480p', width: 854, height: 480, available: true, creditsPerReference: 51 },
  '720p': { resolution: '720p', width: 1280, height: 720, available: true, creditsPerReference: 152 },
  '1080p': { resolution: '1080p', width: 1920, height: 1080, available: false, creditsPerReference: 341 },
});

const TIERS = Object.freeze({ standard: { multiplier: 1 } });

/** `config/credits.json`'s shape block, as this fake sees it. Read from the
 *  real file rather than retyped: the multiplier is arithmetic (4:3 is the
 *  squarest shape, a label holds the short edge, so the others are 4/3 the
 *  pixels) and a fake that invented its own number would pass while the
 *  product overcharged or undercharged. */
const REAL_CREDITS = JSON.parse(fs.readFileSync(new URL('../config/credits.json', import.meta.url), 'utf8'));
const ASPECTS = Object.freeze({
  defaultAspect: REAL_CREDITS.defaultAspect,
  aspects: REAL_CREDITS.aspects,
});

/**
 * `scripts/auth/` as documented in docs/interfaces-app.md A, in memory.
 *
 * Only the surface the web layer is specified to call. `credits` is an opening
 * balance this fake adds so a test can put an account in front of a balance it
 * cannot exhaust by accident.
 */
function fakeAuth() {
  const accounts = new Map();
  const byEmail = new Map();
  const sessions = new Map();
  const SECRET = 'a-secret-that-is-not-a-real-secret';
  let n = 0;

  const sign = (value, secret) => `${value}.${crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 16)}`;

  return {
    PLANS,
    CREDIT_COSTS,
    accounts,
    sessions,

    createAccount({ email, password, plan = 'free', credits = null }) {
      const key = String(email).toLowerCase();
      if (byEmail.has(key)) {
        const err = new Error('email already registered');
        err.code = 'EMAIL_TAKEN';
        err.userMessage = 'That email already has an account.';
        throw err;
      }
      n += 1;
      const account = {
        accountId: `acct-${n}`,
        root: '/fake',
        email,
        plan,
        password,
        credits: credits ?? PLANS[plan].creditsPerPeriod,
        ledger: [],
      };
      accounts.set(account.accountId, account);
      byEmail.set(key, account.accountId);
      return account;
    },
    findAccountByEmail({ email }) {
      const id = byEmail.get(String(email ?? '').toLowerCase());
      return id ? accounts.get(id) : null;
    },
    verifyPassword(account, password) {
      return typeof password === 'string' && password.length > 0 && account.password === password;
    },
    loadAccount({ accountId }) {
      const account = accounts.get(accountId);
      if (!account) throw new Error(`no account ${accountId}`);
      return account;
    },
    saveAccount() {},
    setPlan(account, planId) { account.plan = planId; },

    createSession({ accountId }) {
      n += 1;
      const sessionId = `sess-${n}`;
      sessions.set(sessionId, { sessionId, accountId });
      return { sessionId, expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
    },
    readSession({ sessionId }) { return sessions.get(sessionId) ?? null; },
    destroySession({ sessionId }) { sessions.delete(sessionId); },
    signCookie: sign,
    verifyCookie(signed, secret) {
      const cut = String(signed ?? '').lastIndexOf('.');
      if (cut < 1) return null;
      const value = signed.slice(0, cut);
      return sign(value, secret) === signed ? value : null;
    },
    sessionSecret() { return SECRET; },

    // THROWS ON A DEFERRED RESOLUTION, exactly as the real module does, so that
    // nothing can bill for one size and render another. That is why the quality
    // row is built from CREDIT_COSTS and this is called only for the one the
    // person actually picked.
    // `aspect` is modelled here for the same reason `resolution` is: this fake
    // is what the web layer is tested against, so a dimension it ignores is a
    // dimension the web layer can silently fail to hand on. That is exactly the
    // pass-through defect that put a 4:3 price on a wide tape.
    creditCost({ resolution = '480p', seconds = 15, tier = 'standard', aspect = null } = {}) {
      const row = CREDIT_COSTS[resolution];
      if (!row) {
        const err = new Error(`unknown resolution ${resolution}`);
        err.code = 'UNKNOWN_RESOLUTION';
        err.userMessage = 'That output size is not available.';
        throw err;
      }
      if (row.available === false) {
        const err = new Error(`${resolution} is deferred`);
        err.code = 'RESOLUTION_UNAVAILABLE';
        err.userMessage = 'That output size is not available yet.';
        throw err;
      }
      const multiplier = TIERS[tier]?.multiplier;
      if (multiplier === undefined) {
        const err = new Error(`unknown tier ${tier}`);
        err.code = 'UNKNOWN_TIER';
        throw err;
      }
      const shape = aspect ?? ASPECTS.defaultAspect;
      const aspectMultiplier = shape === ASPECTS.defaultAspect ? 1 : ASPECTS.aspects[shape];
      if (!Number.isFinite(aspectMultiplier)) {
        const err = new Error(`unknown aspect ${aspect}`);
        err.code = 'UNKNOWN_ASPECT';
        err.userMessage = 'That frame shape is not available.';
        throw err;
      }
      return Math.ceil((row.creditsPerReference * (seconds / 15)) * multiplier * aspectMultiplier);
    },
    /** One error, one sentence, one duration for both failures. */
    authenticate({ email, password }) {
      const id = byEmail.get(String(email ?? '').toLowerCase());
      const account = id ? accounts.get(id) : null;
      if (!account || account.password !== password || !password) {
        const err = new Error('email not found or password did not verify');
        err.code = 'BAD_CREDENTIALS';
        err.userMessage = 'That email and password do not match an account.';
        throw err;
      }
      return account;
    },
    balanceOf(account) {
      return { credits: account.credits, planId: account.plan, grantedAt: null, expiresAt: null };
    },
    debitCredits(account, { jobId, credits }) {
      // Idempotent by jobId, the way the real module is: a re-enqueue of a job
      // that has already been charged is the same render, not a new one.
      if (account.ledger.some((e) => e.jobId === jobId && e.delta < 0)) return;
      if (account.credits < credits) {
        const err = new Error('insufficient credits');
        err.code = 'INSUFFICIENT_CREDITS';
        err.userMessage = 'Not enough credits for that tape.';
        throw err;
      }
      account.credits -= credits;
      account.ledger.push({ jobId, delta: -credits, at: new Date().toISOString() });
    },
    refundCredits(account, { jobId }) {
      const spent = account.ledger.find((e) => e.jobId === jobId && e.delta < 0);
      if (!spent || account.ledger.some((e) => e.jobId === jobId && e.delta > 0)) return;
      account.credits += -spent.delta;
      account.ledger.push({ jobId, delta: -spent.delta, at: new Date().toISOString() });
    },
  };
}

/**
 * Mint a session directly against the fake local `scripts/auth/` surface,
 * rather than posting to `/login`.
 *
 * TASK 9 CHANGED WHAT `/login` DOES: it now asks Supabase and resolves the
 * identity through the REAL `scripts/auth/identity.mjs` + `accounts.mjs`,
 * regardless of the fake `auth` this file builds -- and this file's
 * `createServer` call passes no `supabase`, so `POST /login` now answers 503.
 * This file's subject is the job API, not login mechanics (those are covered
 * in `test/web-auth-code.test.js` and `test/web-auth.test.js`), so a session
 * is minted the same way `startSession` would have minted one.
 */
function signIn(auth, { email, password }) {
  const account = auth.findAccountByEmail({ email });
  assert.ok(account && auth.verifyPassword(account, password), `sign-in for ${email} failed`);
  const { sessionId } = auth.createSession({ accountId: account.accountId });
  return `${SESSION_COOKIE}=${auth.signCookie(sessionId, auth.sessionSecret())}`;
}

async function withServer(run, { queue = fakeQueue(), credits = 5_000, provider = 'fixture' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-web-'));
  const auth = fakeAuth();
  auth.createAccount({ email: 'a@example.com', password: 'correct horse battery', plan: 'archive', credits });
  auth.createAccount({ email: 'b@example.com', password: 'a different password', plan: 'archive', credits });

  const app = createServer({
    root,
    cfg: CFG,
    queue,
    port: 0,
    auth,
    provider,
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed',
  });
  const port = await app.listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    const cookieA = signIn(auth, { email: 'a@example.com', password: 'correct horse battery' });
    const cookieB = signIn(auth, { email: 'b@example.com', password: 'a different password' });
    const accountA = auth.findAccountByEmail({ email: 'a@example.com' });
    const accountB = auth.findAccountByEmail({ email: 'b@example.com' });
    await run({ base, root, queue, app, auth, cookieA, cookieB, accountA, accountB });
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

function get(base, pathname, cookie, headers = {}, init = {}) {
  return fetch(`${base}${pathname}`, { headers: { cookie, ...headers }, ...init });
}

function post(base, pathname, body, cookie, headers = {}, init = {}) {
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, cookie, ...headers },
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
 *  a worker would have produced, and hand it to an account. */
function seedJob(app, root, { status = 'queued', place = 'a beach', outfit = 'a t-shirt', result = null, owner = null, aspect = null, resolution = null } = {}) {
  const job = createJob({
    root,
    input: {
      photo: { path: 'input/upload-photo', sha256: 'x'.repeat(64) },
      place: { kind: 'text', value: place },
      outfit: { kind: 'text', value: outfit },
      ...(aspect ? { aspect } : {}),
      ...(resolution ? { resolution } : {}),
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
  if (owner) app.sessions.claimJob({ accountId: owner.accountId, jobId: job.jobId });
  return job;
}

// ---------------------------------------------------------------------------
// the home page -- the redesign
// ---------------------------------------------------------------------------

test('GET / renders the fourteen presets as cards, from the preset files', async () => {
  await withServer(async ({ base, cookieA, app }) => {
    const res = await get(base, '/', cookieA);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();

    // DE-NATIONALISED 2026-08-29. The places were named for German landmarks
    // -- Ostsee, Autobahn, Schrebergarten -- on a product that is not for
    // Germany. The photographs and the ids are unchanged; only what a person
    // reads moved, to plain names that describe a memory rather than a country.
    // FOUR BECAME FAMOUS PLACES 2026-09-04, the owner's call: the stairwell,
    // the car park, the swimming pool and the balcony went, and Times Square,
    // Tokyo, the Amalfi coast and a space centre came. The next morning the
    // out-of-season beach went too, in Amalfi's favour: three ordinary places
    // stay beside the four famous ones, seven in all.
    assert.ok(!html.includes('The beach, out of season'), 'the retired beach is still on the menu');
    for (const label of [
      'The garden, in summer', 'Times Square, at night', 'Tokyo, at night',
      'The Amalfi coast, afternoon', 'The kitchen table',
      'The space centre', 'The living room, evening',
      'Half-zip fleece', 'Checked shirt and jeans', 'Cotton summer dress',
      'Knitted cardigan', 'Tracksuit jacket', 'Padded winter jacket',
    ]) {
      assert.ok(html.includes(label), `${label} is missing from the page`);
    }

    // Rendered FROM the catalog, not from a second copy of the menu: every id
    // the server loaded has a radio, and the count matches.
    assert.equal(app.cards.places.length, 7);
    assert.equal(app.cards.outfits.length, 6);
    for (const p of app.cards.places) {
      assert.ok(html.includes(`id="pl-${p.id}"`), `no card for place ${p.id}`);
    }
    for (const o of app.cards.outfits) {
      assert.ok(html.includes(`id="of-${o.id}"`), `no card for outfit ${o.id}`);
    }

    assert.ok(html.includes('enctype="multipart/form-data"'));
    assert.ok(html.includes('name="place"') && html.includes('name="outfit"'));
    assert.ok(html.includes('name="placePhoto"'), 'the optional place photo is offered');
    assert.ok(html.includes('name="consent"'));
    assert.ok(!/<select[^>]*name="place"/.test(html), 'place is a card rail, never a dropdown');
  });
});

test('the step flow is three numbered steps, one decision each', async () => {
  await withServer(async ({ base, cookieA }) => {
    const html = await (await get(base, '/', cookieA)).text();
    // The word STEP and the number are separate elements since the step header
    // was rebuilt -- the number is a 44px OSD numeral in the header's gutter
    // and the kicker rides above it, so "STEP 01" is no longer one contiguous
    // string in the markup. See stepHead() in views.mjs. Assert what this test
    // is named for -- that the steps are numbered, and in order -- rather than
    // the exact string one layout happened to produce.
    const numbered = [...html.matchAll(/class="stepno-n[^"]*"\s*>([^<]+)</g)].map((m) => m[1]);
    assert.deepEqual(numbered.slice(0, 3), ['01', '02', '03'], 'the steps are numbered, in order');
    assert.ok(html.includes('class="stepno-k">STEP<'), 'and each number is still announced as a step');
    assert.ok(html.includes('Your photo'));
    assert.ok(html.includes('The look'));
    assert.ok(html.includes('The place'));
    assert.ok(html.includes('+ Add photo'));
    assert.ok(html.includes('Uploaded once, kept in your library'));
    assert.ok(html.includes('Use my own place'), 'the escape hatch is on the page');
  });
});

/**
 * STEP 3 LEADS WITH YOUR OWN PLACE (2026-08-30). The product's stated core
 * since the 2026-08-20 scope change is "anyone uploads any photo, gives a
 * location" -- and "your actual childhood garden beats any description of one"
 * is the page's own copy. Both of the controls that deliver that were behind
 * the menu: the upload was revealed only by a card at the far end of a
 * horizontally scrolling rail (§33 measured six of eight cards already
 * off-screen at 736px, and the own card is the ninth), and the free text was
 * inside a collapsed <details>. So the eight presets read as THE MENU and the
 * headline capability read as a footnote.
 *
 * These tests pin the inversion: the own-place block comes FIRST, it is not
 * behind a disclosure, and the presets follow it as examples.
 */

/** Step 3 alone. Both step 2 and step 3 are `panel--choice`, so scoping by
 *  class would silently include the outfit step's own <details> -- which is
 *  staying, and which would make the disclosure assertion below pass or fail
 *  for the wrong reason. Slice by the two headings instead; the test above
 *  asserts both are present. */
function placePanel(html) {
  const start = html.indexOf('The place');
  const end = html.indexOf('The tape');
  assert.ok(start > 0 && end > start, 'could not locate step 3 in the page');
  return html.slice(start, end);
}

test('step 3 leads with your own place -- the upload and the free text come before the rail', async () => {
  await withServer(async ({ base, cookieA }) => {
    const panel = placePanel(await (await get(base, '/', cookieA)).text());

    // PRESENT FIRST, THEN ORDERED. An indexOf comparison between two -1s is
    // `false < false`, which is not an ordering claim at all -- and §35E
    // records this exact class of vacuous pass costing a session.
    const upload = panel.indexOf('name="placePhoto"');
    const text = panel.indexOf('name="placeText"');
    const rail = panel.indexOf('class="rail"');
    assert.ok(upload >= 0, 'step 3 offers no place photo upload');
    assert.ok(text >= 0, 'step 3 offers no free-text box');
    assert.ok(rail >= 0, 'step 3 has no preset rail');

    assert.ok(upload < rail, 'the place photo upload still sits after the rail of presets');
    assert.ok(text < rail, 'the free-text box still sits after the rail of presets');
  });
});

test('the free text is not behind a disclosure any more', async () => {
  await withServer(async ({ base, cookieA }) => {
    const html = await (await get(base, '/', cookieA)).text();
    // STRUCTURE IS ASKED OF A COMMENT-STRIPPED COPY, which is the precedent
    // test/email-templates.test.js set on 2026-08-30 in the other direction: a
    // template ACTION inside a comment is still live text and must be caught,
    // while an ELEMENT named inside a comment is prose and must not be. This is
    // the second kind -- views.mjs explains the old layout by naming the
    // element it used, and a raw substring match reads that explanation as
    // structure. A real disclosure is not in a comment, so nothing is lost.
    const panel = placePanel(html).replace(/<!--[\s\S]*?-->/g, '');

    assert.ok(panel.includes('name="placeText"'), 'step 3 offers no free-text box');
    assert.ok(!panel.includes('<details'), 'the place free text is still inside a collapsed disclosure');

    // And the outfit step keeps ITS disclosure -- this change is about the
    // place step only, so an assertion that passed by deleting every <details>
    // on the page would be measuring the wrong thing.
    assert.ok(html.includes('Or describe what you are wearing'),
      'the outfit step lost its own aside, which was not the ask');
  });
});

test('the page opens on "your own place", so the presets are examples rather than the menu', async () => {
  await withServer(async ({ base, cookieA, app }) => {
    const html = await (await get(base, '/', cookieA)).text();

    assert.match(html, /id="pl-own"[^>]*\bchecked\b/,
      'the escape hatch is not selected on load, so the page still opens on the menu');

    // Exactly one place is chosen, and it is not a preset. A second `checked`
    // in the group would make the default whichever the browser saw last.
    for (const p of app.cards.places) {
      assert.doesNotMatch(html, new RegExp(`id="pl-${p.id}"[^>]*\\bchecked\\b`),
        `preset ${p.id} is checked on load`);
    }
  });
});

test('the own-place card is the first thing in the rail, not the last', async () => {
  await withServer(async ({ base, cookieA }) => {
    const panel = placePanel(await (await get(base, '/', cookieA)).text());

    const own = panel.indexOf('placecard--own');
    const firstPreset = panel.indexOf('placecard--pl-');
    assert.ok(own >= 0, 'the own-place card is gone from the rail -- it is the way back from a preset');
    assert.ok(firstPreset >= 0, 'the rail has no preset cards');
    assert.ok(own < firstPreset, 'the own-place card is still behind the presets in the rail');
  });
});

test('both own-place controls have an accessible name of their own', async () => {
  await withServer(async ({ base, cookieA }) => {
    const panel = placePanel(await (await get(base, '/', cookieA)).text());

    // These leaned on the prose beside them, which was survivable while they
    // were hidden behind a card at the end of a rail and is not now that they
    // are the first controls in the step. A file input with no accessible name
    // is announced as "button" and nothing else. The visible prose stays where
    // it is -- it is too long to be a label and does other work -- so the name
    // is carried explicitly.
    const upload = /<input[^>]*name="placePhoto"[^>]*>/.exec(panel);
    const text = /<input[^>]*name="placeText"[^>]*>/.exec(panel);
    assert.ok(upload, 'no place-photo input in step 3');
    assert.ok(text, 'no place free-text input in step 3');

    assert.match(upload[0], /aria-label="[^"]+"/, 'the place-photo upload has no accessible name');
    assert.match(text[0], /aria-label="[^"]+"/, 'the place free-text box has no accessible name');
  });
});

test('the own-place card offers the upload once own place is already chosen', async () => {
  await withServer(async ({ base, cookieA }) => {
    const panel = placePanel(await (await get(base, '/', cookieA)).text());

    // WHAT THIS EXISTS TO STOP, reported by the owner on 2026-08-31: "if you
    // click on their own place on the card, they should have the ability to
    // upload their own place ... there is no response."
    //
    // He is right and the cause is section 43's own design. `pl-own` is CHECKED
    // ON LOAD, so the one card in the rail that speaks for your own place is a
    // <label> for a radio that is ALREADY SELECTED -- and clicking a checked
    // radio changes nothing, fires nothing, and moves nothing on screen. The
    // upload it is supposed to lead to sits at the TOP of the step, above the
    // prose and above the rail, so by the time the rail is in view the control
    // is off-screen behind you. The card was a dead control for the whole of
    // the default state, which is the state every visitor arrives in.
    //
    // THE FIX IS TWO CARDS IN ONE SLOT, SWAPPED BY THE RADIO THAT IS ALREADY
    // THERE -- no JavaScript, and no second reveal mechanism, which the
    // stylesheet's own comment forbids. One card is the way BACK from a preset
    // (a label for pl-own); the other is the way IN to the upload (a label for
    // the file input). Exactly one is in the rail at a time, so the rail still
    // has one own-place card and the dots still count right.
    const pick = /<label class="placecard placecard--own placecard--own-pick" for="pl-own">/.exec(panel);
    const add = /<label class="placecard placecard--own placecard--own-add" for="placePhoto">/.exec(panel);

    assert.ok(pick, 'the rail lost the card that returns to your own place from a preset');
    assert.ok(add, 'the own-place card still cannot reach the upload -- it is a label for a radio '
      + 'that is already checked, so clicking it does nothing at all');

    // The upload card leads: it is the one showing in the state the page opens
    // in, so it is the one a person meets first in the rail.
    assert.ok(panel.indexOf(add[0]) < panel.indexOf('placecard--pl-'),
      'the upload card is behind the presets in the rail');

    // It must point at the real input, not a copy of it -- one input, two
    // labels, so whichever is clicked opens the same picker and the chosen file
    // lands in the same field the server reads.
    assert.equal((panel.match(/name="placePhoto"/g) ?? []).length, 1,
      'there is more than one place-photo input, so which one carries the file is a coin toss');
  });
});

test('the carousel dots run in the same order as the cards they indicate', async () => {
  await withServer(async ({ base, cookieA, app }) => {
    const panel = placePanel(await (await get(base, '/', cookieA)).text());

    // The dots are a position indicator for the rail. If the two orders
    // disagree the indicator lights the wrong position -- invisible in a
    // markup test that only counts them, which is why this compares sequences.
    //
    // POSITIONS, NOT ELEMENTS (2026-08-31). The own-place slot is now two
    // <label>s of which the stylesheet shows exactly one -- own-pick when a
    // preset is selected, own-add otherwise -- so the rail has nine cards in
    // the markup and eight in the frame, and there are still eight dots. The
    // pair collapses to the one position it occupies, which is what the dot
    // beside it indicates. This is the assertion getting MORE specific, not
    // less: it now says what a dot is a dot FOR.
    const dots = [...panel.matchAll(/class="dot dot--([a-z0-9-]+)"/g)].map((m) => m[1]);
    const cards = [...panel.matchAll(/class="placecard placecard--([a-z0-9-]+)/g)]
      .map((m) => m[1])
      .filter((id, i, all) => !(id === 'own' && all[i - 1] === 'own'));

    // Both halves of the pair are present, or one of the two states has no card
    // at all and the dedupe above is hiding it.
    for (const half of ['own-pick', 'own-add']) {
      assert.ok(panel.includes(`placecard--${half}`), `the own-place slot has lost its ${half} card`);
    }

    assert.equal(cards.length, app.cards.places.length + 1, 'the rail is not the eight presets plus the escape hatch');
    assert.deepEqual(dots, cards, 'the dots and the cards are in different orders');
  });
});

/**
 * THE CONFLICT THE INVERSION MAKES REACHABLE.
 *
 * A `display:none` file input still submits. So even before this change you
 * could pick "Use my own place", choose a place photo, change your mind, click
 * a preset card, and post both -- the server took `placePhoto` as authoritative
 * for `kind` while reading the caption from `firstFilled(fields.place,
 * fields.placeText)`, so the manifest came out `{kind:'photo', value:
 * 'ostsee-strand'}`: your garden photograph captioned with the beach. No test
 * covered that combination.
 *
 * Putting the upload at the front of the step makes it one click away instead
 * of five, so it is refused by name. That follows this endpoint's own rule for
 * an unavailable resolution or shape -- refuse rather than quietly render
 * something the person did not ask for -- and the message has to name BOTH
 * halves, or it reads as "your upload was rejected".
 */
test('a preset card and an uploaded place photo contradict each other, and are refused', async () => {
  await withServer(async ({ base, root, cookieA }) => {
    const res = await post(base, '/api/jobs', multipart([
      { name: 'photo', filename: 'me.png', type: 'image/png', body: fakePhoto() },
      { name: 'placePhoto', filename: 'garden.png', type: 'image/png', body: fakePhoto(20_000, 'g') },
      { name: 'place', body: 'amalfi-afternoon' },
      { name: 'outfit', body: 'winterjacke' },
      { name: 'consent', body: 'yes' },
    ]), cookieA);

    assert.equal(res.status, 400, 'a preset card plus a place photo was accepted');
    const { error } = await res.json();
    assert.equal(error.code, 'PLACE_CONFLICT');
    assert.match(error.message, /photo/i, 'the refusal does not mention the photograph');
    assert.match(error.message, /place/i, 'the refusal does not mention the chosen place');

    // Refused means nothing was written -- not a job whose credits were spent
    // and whose directory has to be swept.
    assert.deepEqual(jobDirs(root), []);
  });
});

test('a place photo with a typed caption is still accepted -- only a CARD conflicts', async () => {
  await withServer(async ({ base, root, cookieA }) => {
    const res = await post(base, '/api/jobs', multipart([
      { name: 'photo', filename: 'me.png', type: 'image/png', body: fakePhoto() },
      { name: 'placePhoto', filename: 'garden.png', type: 'image/png', body: fakePhoto(20_000, 'g') },
      // "Use my own place" posts an empty `place`; the caption rides alongside.
      { name: 'place', body: '' },
      { name: 'placeText', body: 'the garden behind the house' },
      { name: 'outfit', body: 'winterjacke' },
      { name: 'consent', body: 'yes' },
    ]), cookieA);

    assert.equal(res.status, 201, 'the ordinary own-place order was refused as a conflict');
    const job = loadJob({ root, jobId: (await res.json()).jobId });
    assert.equal(job.input.place.kind, 'photo');
    assert.equal(job.input.place.value, 'the garden behind the house');
  });
});

/**
 * THE PILL ROW IS FACTS, NOT CHOICES. Decided with Paul on 2026-08-20 and
 * written into docs/interfaces-app.md: a camcorder tape is 4:3, and the
 * 375-frame contract is asserted by roughly two hundred tests. If a future edit
 * puts the toggles back, this is the test that says no.
 */
/**
 * The FRAME row states facts, and must not LOOK like it states choices.
 *
 * REWRITTEN 2026-08-21. It used to render four chips -- 4:3, PAL, 25 fps,
 * 15.000s -- and this test asserted they were `<span>`s rather than controls,
 * which was true and which entirely missed the problem. The chips sat directly
 * above the quality cards, which are real controls and look almost identical,
 * so the panel showed four unclickable things next to three clickable ones.
 * Paul reported it as "I can't click the frame to select". The markup was
 * correct and the page was still lying.
 *
 * So the assertions changed shape: instead of "the chip is a span", they are
 * now "the jargon is gone" and "nothing that cannot be rendered is named".
 */
test('the FRAME row states the two facts a customer needs, and no jargon', async () => {
  await withServer(async ({ base, cookieA }) => {
    const html = await (await get(base, '/', cookieA)).text();

    // What a person actually needs to know about the frame and the length.
    assert.ok(html.includes('4:3'), 'the frame shape is not stated');
    assert.ok(html.includes('fifteen seconds'), 'the length is not stated in words');
    assert.ok(html.includes('15 SEC'), 'the facts list still carries the length');

    // Broadcast-engineering vocabulary a customer has no use for. These are
    // facts the RENDERER needs; they live in CLAUDE.md's output contract and in
    // ~200 assertions, and they do not belong on the page.
    assert.ok(!html.includes('PAL'), 'PAL is renderer vocabulary, not customer vocabulary');
    assert.ok(!html.includes('25 fps'), 'the frame rate is not a customer-facing fact');
    assert.ok(!/<span class="pill">/.test(html), 'the unclickable chips are gone');

    // CHANGED 2026-08-23, DELIBERATELY. This used to assert that 16:9 and 9:16
    // appeared NOWHERE on the page. The aspect selector has now landed as far
    // as the raster work goes, and the two unbuilt shapes are shown -- dimmed,
    // as <span>s with no radio behind them, exactly the way the deferred 1080p
    // quality card has always been shown.
    //
    // The rule this test exists to protect did NOT change: nothing may offer an
    // aspect the renderer cannot fill. What changed is that "offer" now means
    // "is postable", not "is visible", because a dimmed shape with no control
    // behind it sells nothing. That stronger claim -- exactly one postable
    // shape -- is asserted in its own test below, which is where it belongs;
    // duplicating it here would leave two tests to update in lockstep.
    assert.ok(!/name="fps"/.test(html), 'the frame rate is never a form field');
  });
});

/**
 * The QUALITY row is the one thing in this panel that is a real choice, and it
 * is built out of `CREDIT_COSTS` -- including the row that is switched off, so
 * that turning 1080p on is a config field and not an edit here.
 */
test('the QUALITY row is a real choice, rendered from the credit config', async () => {
  await withServer(async ({ base, cookieA }) => {
    const html = await (await get(base, '/', cookieA)).text();

    assert.ok(html.includes('id="q-480p"'), '480p has a radio');
    assert.ok(html.includes('id="q-720p"'), '720p has a radio');
    assert.ok(html.includes('name="resolution"'), 'the choice posts with the job');

    // 720p is the native fit -- the first size that covers the tape's raster --
    // so it is what starts selected.
    assert.ok(/id="q-720p"[^>]*checked/.test(html), '720p is the default');
    assert.ok(!/id="q-480p"[^>]*checked/.test(html), 'only one option starts checked');
    assert.ok(/qualitycard--q-720p[\s\S]{0,400}Recommended/.test(html), '720p is the recommended one');

    // The deferred one renders, and has no control behind it at all.
    assert.ok(html.includes('1080p'), 'the deferred option is still shown');
    assert.ok(html.includes('Coming soon'));
    assert.ok(!html.includes('id="q-1080p"'), 'a deferred option must have no radio to post');
    assert.ok(!/value="1080p"/.test(html), 'and nothing that names it as a value');

    // The live figures.
    assert.ok(html.includes('~51 CR'), '480p costs 51 CR');
    assert.ok(html.includes('~152 CR'), '720p costs 152 CR');
    assert.ok(html.includes('Estimated cost'));
    assert.ok(html.includes('Credits'));
  });
});

/**
 * WE MEASURED THIS. After the tape pass a 720p-sourced and a 1080p-sourced
 * delivery are indistinguishable (SSIM 0.958), because grain is applied at
 * 720x576 before the upscale and everything above the raster is discarded. So
 * the copy must not sell a difference we know the size of.
 */
test('the quality copy does not sell an upgrade we measured and know is invisible', async () => {
  await withServer(async ({ base, cookieA }) => {
    const html = await (await get(base, '/', cookieA)).text();
    for (const oversell of [/\bHD\b/, /high definition/i, /better quality/i, /higher quality/i,
      /lower quality/i, /premium/i, /crisper/i, /sharper/i]) {
      assert.ok(!oversell.test(html), `the quality row oversells: ${oversell}`);
    }
    // And it says the true thing instead.
    assert.ok(html.includes('The native fit'), '720p is described as the native fit');
    assert.ok(html.includes('Slightly softer'), '480p says plainly what it costs you');
    // CHANGED BY /qa, 2026-08-29, and worth saying out loud because it pinned a
    // claim that has since become false. It asserted `html.includes('1080')`
    // for "the delivered file is 1080x1920 either way" -- true while 4:3 was
    // the only shape, false since the frame menu opened: a 16:9 order delivers
    // 1920x1080, measured on the file. It also could not fail, because "1080"
    // matches the 1080p card name three lines above the sentence it was about.
    //
    // The claim the copy actually has to make is the anti-upsell one: the TIER
    // does not change the file. That is still true in every shape, so it is
    // what is asserted now.
    assert.ok(/same file/.test(html),
      'the quality row must still say the tier does not change the file');
  });
});

/**
 * A SHAPE-SPECIFIC NUMBER IN A ROW THAT IS NOT ABOUT SHAPE.
 *
 * The hint under the quality cards read "Every option delivers the same
 * 1080x1920 file ... the tape works at 720x576". Both numbers are the 4:3
 * contract. Since the frame menu opened, 16:9 delivers 1920x1080 from a
 * 1024x576 tape and 9:16 delivers 1080x1920 from 576x1024 -- so the sentence
 * was wrong for two of the three shapes a customer can pick, in the panel
 * directly below the picker that chooses between them.
 *
 * WHAT SURVIVES IS THE SHORT EDGE. config/render.json holds it at 576 in every
 * shape on purpose -- that single constraint is why one set of filtergraph
 * tuning constants is correct in all three -- so "576 lines on its short edge"
 * is true whatever is chosen, and the discard-above-the-raster argument the
 * sentence exists to make is unchanged.
 */
test('the quality copy states no raster that only one frame shape has', async () => {
  await withServer(async ({ base, cookieA }) => {
    const html = await (await get(base, '/', cookieA)).text();

    // PRESENT FIRST. A negative assertion against a page that failed to render
    // the panel at all would pass while proving nothing.
    assert.ok(html.includes('<div class="quality">'), 'the quality panel is not on the page');
    assert.ok(/576/.test(html), 'the copy no longer names the short edge it argues from');

    assert.ok(!/1080\s*(?:&times;|&#215;|x|×)\s*1920/i.test(html),
      'the quality copy names a 4:3 delivery raster -- a 16:9 order delivers 1920x1080');
    assert.ok(!/720\s*(?:&times;|&#215;|x|×)\s*576/i.test(html),
      'the quality copy names a 4:3 tape raster -- 16:9 works at 1024x576, 9:16 at 576x1024');
  });
});

test('the Record button shows the real balance and a plain reason', async () => {
  await withServer(async ({ base, cookieA }) => {
    const html = await (await get(base, '/', cookieA)).text();
    assert.ok(html.includes('5000 CR'), 'the real balance, not a placeholder');
    assert.ok(html.includes('Record the tape'));
    assert.ok(html.includes('Upload a photo first'), 'the reason is rendered server-side');
    assert.ok(!html.includes('Not enough credits'), 'this account can afford a tape');
  }, { credits: 5000 });
});

test('with no credits the button is disabled server-side and says why', async () => {
  await withServer(async ({ base, cookieA }) => {
    const html = await (await get(base, '/', cookieA)).text();
    assert.ok(/<button[^>]*class="record"[^>]*disabled/.test(html), 'the button is genuinely disabled');
    assert.ok(html.includes('Not enough credits'));
    assert.ok(html.includes('~51 CR'), 'and it names the price of the cheapest tape');
    assert.ok(html.includes('/pricing'), 'and there is a way to do something about it');
  }, { credits: 0 });
});

/**
 * A balance that covers 480p but not 720p is the interesting case: the button
 * stays live, and the reason that appears is the one for whichever option is
 * selected -- switched by the same CSS rule that styles the card, so it is right
 * with scripting off.
 */
test('a balance between the two prices warns about the dear one only', async () => {
  await withServer(async ({ base, cookieA }) => {
    const html = await (await get(base, '/', cookieA)).text();
    assert.ok(!/<button[^>]*class="record"[^>]*disabled/.test(html),
      '480p is still affordable, so the button must not be dead');
    assert.ok(html.includes('why--q-720p-a-4x3'), 'the 720p 4:3 warning is rendered');
    assert.ok(!html.includes('why--q-480p-a-4x3'), 'and the 480p 4:3 one is not, because it is affordable');
    assert.ok(html.includes('a 720p 4:3 tape costs ~152 CR and you have 100 CR'));
    // AND THE WARNING FOLLOWS THE SHAPE. 480p at 4:3 costs 51 and is affordable
    // at 100 CR; the same tier at 9:16 costs 68 and is also affordable -- but
    // 720p at 9:16 costs 203, so the warning has to exist for a pair that the
    // un-shaped number would have called safe.
    assert.ok(html.includes('why--q-720p-a-9x16'), 'the wide 720p warning must exist too');
    assert.ok(!html.includes('why--q-480p-a-9x16'), '480p 9:16 is 68 CR and affordable at 100');
  }, { credits: 100 });
});

test('the shelf is empty until there is something on it, and then it is not', async () => {
  await withServer(async ({ base, cookieA, app, root, accountA }) => {
    const empty = await (await get(base, '/', cookieA)).text();
    // THE WINDOW, NOT A PROMISE OF FOREVER. This used to assert "Every
    // recording stays on the shelf." while `retention.jobDays` deleted the
    // video after 30 days -- the page and the purge disagreed, and the page was
    // the one a customer read. The number is threaded from config/render.json,
    // so this asserts the sentence carries a window rather than a fixed count.
    assert.match(empty, /Every recording stays on the shelf for \d+ days\./);
    assert.ok(empty.includes('The shelf is empty'));
    assert.ok(empty.includes('your first tape lands here'));

    const job = seedJob(app, root, { status: 'done', place: 'a beach', owner: accountA });
    const filled = await (await get(base, '/', cookieA)).text();
    assert.ok(!filled.includes('The shelf is empty'), 'a tape is on the shelf now');
    assert.ok(filled.includes(`/j/${job.jobId}/result`), 'and it links to the finished tape');
  });
});

test('the wordmark is the drawn mark, named, and carries no style of its own', async () => {
  await withServer(async ({ base, cookieA }) => {
    const html = await (await get(base, '/', cookieA)).text();
    assert.ok(html.includes('class="wordmark"'));

    // THE OLD RULE HERE WAS THE OPPOSITE, AND IT WAS DELIBERATELY REVERSED
    // (2026-08-27). This asserted `!wordmark.includes('<svg')` -- "the wordmark
    // itself must be lettering, not a drawn logo" -- which was the right rule
    // while the mark was the word TIMESTAMP set in the tape's own OSD face.
    // The identity now uses Cormorant Garamond Italic with a head-switch tear
    // through it, and neither the face nor the tear can be expressed as live
    // text: the face is not shipped, and the tear is a clipped displacement.
    // See DESIGN.md, "The brand identity". The rule below is what replaces it.
    const from = html.indexOf('class="wordmark"');
    const wordmark = html.slice(from, html.indexOf('</a>', from));
    assert.ok(wordmark.includes('<svg'), 'sliced the wrong element, or the mark is gone');

    // A PICTURE HAS NO TEXT, so something must say what it is. It used to be
    // the literal word; a screen reader now finds nothing without this.
    assert.ok(/<span class="vh">Timestamp<\/span>/.test(wordmark)
      || /aria-label="Timestamp"/.test(wordmark),
      'the wordmark is a picture with no accessible name');

    // AND THE ONE THAT FAILS SILENTLY IN PRODUCTION AND NOWHERE ELSE. This
    // server sends `style-src 'self'`, which blocks an inline <style> wherever
    // it appears -- inside an inlined SVG included. A generated mark that
    // carries its own <style> renders fine in every test that reads the markup
    // and loses its animation in every real browser, with no error anywhere.
    // The record light is animated from the stylesheet by its class instead.
    assert.ok(!wordmark.includes('<style'),
      'the inlined mark carries a <style> the CSP will silently drop');
    assert.ok(wordmark.includes('class="rec"'), 'the record light lost the class the stylesheet animates');
  });
});

/**
 * THE MASTHEAD CARRIES THE WORD AND NOTHING ELSE, since 2026-08-28.
 *
 * This test used to assert the opposite -- that a `Ts` monogram sat ahead of
 * the wordmark inside the same anchor. Paul removed it on sight: it spelled the
 * first two letters of the word standing next to it, so the lockup said one
 * thing twice, and the small mark read as the plainer half.
 *
 * INVERTED RATHER THAN DELETED, because "we took it out" is a claim worth
 * holding. The monogram was reachable from one line of `views.mjs` and its CSS
 * is three lines; a later edit reinstating either would put the doubled mark
 * back with nothing to say so.
 */
test('the masthead draws the word alone -- no monogram beside it', async () => {
  await withServer(async ({ base, cookieA }) => {
    const html = await (await get(base, '/', cookieA)).text();
    const from = html.indexOf('class="wordmark');
    const lockup = html.slice(from, html.indexOf('</a>', from));

    assert.ok(!lockup.includes('class="mg"'), 'the monogram is back in the lockup');
    assert.ok(!/id="ts-mg-/.test(html), 'the monogram is inlined somewhere on the page');
    assert.ok(lockup.includes('id="ts-wm-'), 'the wordmark itself went missing with it');

    // ONE LINK, ONE NAME. The drawn letters carry no text, so the accessible
    // name is the visually-hidden span -- which must survive the mark going.
    assert.ok(/<span class="vh">Timestamp<\/span>/.test(lockup),
      'the lockup lost the only thing that gives it an accessible name');

    // Ids stay unique. With one mark a collision is no longer possible between
    // marks, but the assertion costs nothing and the page may inline more SVG.
    const ids = [...html.matchAll(/\sid="(ts-[a-z]{2}-[a-z0-9-]+)"/g)].map((m) => m[1]);
    assert.deepStrictEqual(ids.length, new Set(ids).size, `duplicate mark ids on one page: ${ids.join(', ')}`);

    const css = await (await fetch(`${base}/styles.css`)).text();

    // THE DEAD RULES ARE GONE TOO, and the negative margin is the one that
    // matters. `margin-left: -5.5px` cancelled padding baked into the
    // MONOGRAM's tile; left behind with the monogram removed it hauls the
    // wordmark off the page edge and misaligns the masthead against every panel
    // below it -- a few pixels, so it is easy to ship and hard to notice.
    assert.ok(!/\.wordmark\s+\.mg\s*\{/.test(css), 'a rule still styles the removed monogram');
    const wordmarkRule = /\.wordmark\s*\{([^}]*)\}/.exec(css);
    assert.ok(wordmarkRule, 'no rule lays out the wordmark at all');
    assert.ok(!/margin-left/.test(wordmarkRule[1]),
      'the monogram tile\'s negative margin outlived the tile');
    assert.ok(!/\bgap\b/.test(wordmarkRule[1]),
      'the lockup still spaces two children and there is only one');
  });
});

// ---------------------------------------------------------------------------
// the stylesheet and the place imagery
// ---------------------------------------------------------------------------

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

/**
 * The place photographs do not exist and must not block the build. The card's
 * `background-image` lists the photograph first and a warm gradient derived from
 * the place id second, so a missing file is a layer the browser does not paint
 * rather than a broken image icon -- and the page is finished on a fresh clone.
 */
test('every place has an image URL and a gradient underneath it in one declaration', async () => {
  await withServer(async ({ base, app }) => {
    const css = await (await fetch(`${base}/styles.css`)).text();
    for (const p of app.cards.places) {
      const rule = new RegExp(`\\.thumb--pl-${p.id}\\{background-image:url\\('/places/${p.id}\\.jpg'\\), linear-gradient\\(`);
      assert.ok(rule.test(css), `no image+gradient rule for ${p.id}`);
      assert.ok(css.includes(`.bg--pl-${p.id}{background-image:`), `no background layer for ${p.id}`);
      assert.ok(css.includes(`#pl-${p.id}:checked~.bgs .bg--pl-${p.id}{opacity:1;}`),
        `${p.id} does not cross-fade the background when selected`);
    }
    // The cost line switches on BOTH radios, with no script involved -- the
    // shape is part of the price, so a rule keyed on quality alone would quote
    // the 4:3 number for a 9:16 order that is charged 4/3 of it.
    assert.ok(css.includes('#q-720p:checked~#a-4x3:checked~.wrap .cost--q-720p-a-4x3{display:inline;}'),
      'the estimated cost must follow BOTH the tier and the shape, without JavaScript');
    assert.ok(css.includes('#q-720p:checked~#a-9x16:checked~.wrap .cost--q-720p-a-9x16{display:inline;}'),
      'the wide shapes need their own cost rule, or they show the 4:3 price');
    // And no rule may key the cost on the tier alone, which is the shape of the
    // bug: it would match whatever the frame row says and quote one number.
    assert.ok(!/\.cost--q-\d+p\{/.test(css),
      'a cost rule keyed on the tier alone quotes one price for every shape');
    // CHANGED 2026-08-24 with the STRUCK world. This asserted the selected card
    // gained `border-color:var(--accent)`. DESIGN.md forbids borders outright --
    // grouping is depth and gauze density, never a line -- so selection is now
    // expressed as a strike: the ghost comes to full opacity and its name burns
    // cathode orange. The rule this test protects did not move: the selection is
    // still carried entirely by CSS with no script involved.
    assert.ok(css.includes('#q-480p:checked~.wrap .qualitycard--q-480p{opacity:1;}'),
      'the selected quality card must be struck by CSS alone');
    assert.ok(css.includes('#q-480p:checked~.wrap .qualitycard--q-480p .name{color:var(--accent);'),
      'and the strike must be visible as colour, not only as opacity');
    assert.ok(!css.includes('#q-1080p:checked'), 'a deferred resolution gets no selection rule');

    // The cross-fade is a CSS transition, not a script -- which is why it works
    // with scripting off and why one media query is enough to switch it off.
    assert.ok(/\.bg \{[^}]*transition: opacity/.test(css), 'the cross-fade is not a transition');
    assert.ok(/\.bg \{[^}]*animation: drift/.test(css), 'the background drift');

    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css);
    assert.ok(reduced, 'there is no prefers-reduced-motion block');
    assert.match(reduced[1], /\.bg \{[^}]*animation: none/, 'reduced motion must stop the drift');
    assert.match(reduced[1], /\.bg \{[^}]*transition: none/, 'reduced motion must stop the cross-fade');
    assert.match(reduced[1], /\.rec \{[^}]*animation: none/, 'reduced motion must stop the blinking dot');
  });
});

test('a missing place photograph is a 404 and never a path the client chose', async () => {
  // THE EMPTY DIRECTORY IS NOW BUILT, NOT BORROWED. This used to point at the
  // repo's own `assets/places/` and assert 404 on a real catalog id, with the
  // comment "no file on disk yet: the designed state". That state ended on
  // 2026-08-23 when the eight place photographs landed, and the test went red
  // for the best possible reason -- the missing asset it was documenting had
  // been supplied. The behaviour it MEANT to pin is unchanged and still worth
  // pinning: a place that is in the catalog but has no file 404s, and a path
  // the client invented is refused before the filesystem is touched at all.
  // So the empty assets root is created here rather than assumed of the repo.
  const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-noassets-'));
  fs.mkdirSync(`${assets}/places`, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-web-'));
  const app = createServer({ root, cfg: CFG, queue: fakeQueue(), port: 0, auth: fakeAuth(), assetsRoot: assets });
  const port = await app.listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    // In the catalog, but no file on disk: the designed state, now constructed.
    assert.equal((await fetch(`${base}/places/schrebergarten-august.jpg`)).status, 404);
    // Not in the catalog: refused before the filesystem is consulted at all.
    for (const target of ['/places/nope.jpg', '/places/..%2f..%2fpackage.json', '/places/manifest.json']) {
      const res = await fetch(`${base}${target}`);
      assert.ok(res.status === 400 || res.status === 404, `${target} -> ${res.status}`);
      assert.ok(!(await res.text()).includes('"name": "timestamp"'), 'a repo file was served');
    }
  } finally {
    await app.close();
  }
});

test('a real place photograph is served when it is there', async () => {
  const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-assets-'));
  fs.mkdirSync(`${assets}/places`, { recursive: true });
  fs.writeFileSync(`${assets}/places/amalfi-afternoon.jpg`, Buffer.from('not really a jpeg'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-web-'));
  const app = createServer({ root, cfg: CFG, queue: fakeQueue(), port: 0, auth: fakeAuth(), assetsRoot: assets });
  const port = await app.listen();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/places/amalfi-afternoon.jpg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.equal(await res.text(), 'not really a jpeg');
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(assets, { recursive: true, force: true });
  }
});

test('a place LOOP is served, and only for an id the catalog knows', async () => {
  const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-assets-'));
  fs.mkdirSync(`${assets}/places`, { recursive: true });
  fs.writeFileSync(`${assets}/places/amalfi-afternoon.mp4`, Buffer.from('not really an mp4'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-web-'));
  const app = createServer({ root, cfg: CFG, queue: fakeQueue(), port: 0, auth: fakeAuth(), assetsRoot: assets });
  const port = await app.listen();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/places/amalfi-afternoon.mp4`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'video/mp4');

    // THE EXTENSION WIDENED; THE MEMBERSHIP CHECK DID NOT. The id is still
    // resolved against the loaded catalog, so no byte of the request is ever
    // concatenated into a path -- which is the property that made the .jpg
    // route safe and is the one most easily lost while adding a second suffix.
    // These reach the handler and are refused there, by name.
    for (const target of [
      '/places/nope.mp4',            // not in the catalog
      '/places/amalfi-afternoon.mp4.mp4', // a second suffix cannot join the id
      '/places/amalfi-afternoon.webm',  // an extension this route does not serve
    ]) {
      assert.equal((await fetch(`http://127.0.0.1:${port}${target}`)).status, 404, target);
    }

    // This one never reaches the handler at all -- the router refuses a
    // traversal with a 400 first. Asserted as "not served" rather than as a
    // specific code, because WHICH layer says no is an implementation detail
    // and the property worth pinning is that neither layer serves it.
    const traversal = await fetch(`http://127.0.0.1:${port}/places/..%2f..%2fpackage.json.mp4`);
    assert.ok(traversal.status >= 400, `a traversal was answered ${traversal.status}`);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(assets, { recursive: true, force: true });
  }
});

test('the moving background is one element, and the page is finished without it', async () => {
  await withServer(async ({ base, cookieA }) => {
    // THE SUBJECT OF THIS TEST MOVED ON 2026-08-28 AND THE PROPERTIES DID NOT.
    // The full-bleed place loop used to run behind BOTH the landing and the
    // signed-in page. The signed-in page moved to paper -- it is somebody's
    // workspace, and text over a moving photograph competes with the work --
    // so the ground lives on the landing alone, which is `/` when signed out.
    // Every assertion below is the one that was here before; only the page it
    // is made against changed. The signed-in half is asserted at the bottom.
    const html = await (await get(base, '/')).text();
    const bgs = html.slice(html.indexOf('<div class="bgs"'), html.indexOf('</div>', html.indexOf('class="scrim"')));

    // ONE <video>, NOT EIGHT. Eight elements all decoding at once is eight
    // decoders for one visible picture, and on a laptop it is audible.
    assert.equal((html.match(/<video/g) ?? []).length, 1, 'there should be exactly one video element');

    // AND IT IS INERT IN THE MARKUP. No src and no autoplay means a browser
    // with JavaScript off, or reduced motion asked for, or a video codec it
    // will not touch, fetches NOTHING and simply shows the still underneath --
    // which is the layer that was already there and is still there.
    const video = bgs.slice(bgs.indexOf('<video'), bgs.indexOf('>', bgs.indexOf('<video')) + 1);
    assert.ok(!/\ssrc=/.test(video), 'the video names a source in the markup, so it loads for everyone');
    assert.ok(!/\sautoplay/.test(video), 'autoplay in the markup defeats the reduced-motion check');
    assert.ok(/\smuted/.test(video) && /\splaysinline/.test(video),
      'without muted+playsinline a mobile browser refuses to play it at all');
    assert.ok(/\sloop/.test(video), 'the loop is six seconds long and is meant to repeat');

    // The still layers are the fallback and must survive. One per place.
    assert.ok(/class="bg bg--pl-amalfi-afternoon"/.test(bgs), 'the still fallback layer is gone');

    // TWO STATES, AND COLLAPSING THEM INTO ONE IS A REGRESSION WITH A LOOK.
    // The ground -- the per-place scrim and the plate under the panels -- keys
    // off "is-live", which stays true once video has worked here. Only the
    // video's own opacity keys off "is-showing", which drops for the moment
    // between choosing a place and its loop decoding. Drive both from one
    // class and every click throws the scrim back to full strength and changes
    // each panel's corner radius until the next file loads. Measured in a
    // browser before this split existed; it flinched once per click.
    const css = await (await fetch(`${base}/styles.css`)).text();
    assert.ok(/\.bgs\.is-showing\s+\.bgv\s*\{[^}]*opacity/.test(css),
      'the video should reveal on is-showing');
    assert.ok(/:checked~\.bgs\.is-live~\.scrim\{opacity:/.test(css),
      'the per-place scrim should hold on is-live, not blink with each swap');
    assert.ok(!/is-playing/.test(css), 'the old single-state class is still in the sheet');

    // THE PLATE UNDER THE PANELS WAS THE THIRD THING is-live HELD, and its
    // SUBJECT is gone rather than its rule being relaxed. It tinted `.panel`
    // while a photograph played behind it; the only page with panels is the
    // signed-in one and it has no photograph behind it any more. So the
    // property is asserted where it now lives -- as the absence of the whole
    // configuration, which is stronger than tinting it correctly.
    assert.ok(!/\.bgs\.is-live\s*~\s*\.wrap\s+\.panel/.test(css),
      'a plate rule survives for a photograph no page puts behind a panel');

    // THE SIGNED-IN PAGE IS PAPER, AND CARRIES NONE OF IT. Not "does not
    // autoplay" -- there is no element, no still layer and no scrim, so there
    // is nothing for a future change to switch back on by accident.
    const home = await (await get(base, '/', cookieA)).text();
    assert.equal((home.match(/<video/g) ?? []).length, 0,
      'the signed-in page still carries a background video');
    assert.ok(!/class="bgs"/.test(home), 'the signed-in page still carries the full-bleed ground');
    assert.ok(!/class="scrim"/.test(home), 'the signed-in page still carries the scrim');
  });
});

// ---------------------------------------------------------------------------
// POST /api/jobs
// ---------------------------------------------------------------------------

test('POST /api/jobs is 201 immediately, and the bytes land intact', async () => {
  await withServer(async ({ base, root, queue, cookieA }) => {
    const photo = fakePhoto(120_000, 'landing');
    const sent = sha256(photo);

    const started = Date.now();
    const res = await post(base, '/api/jobs', multipart([
      { name: 'photo', filename: 'me.png', type: 'image/png', body: photo },
      { name: 'place', body: 'my grandmother s kitchen' },
      { name: 'outfit', body: 'a green anorak' },
      { name: 'consent', body: 'yes' },
    ]), cookieA);
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

test('a card posts its preset id and the describe-it box posts free text', async () => {
  await withServer(async ({ base, root, cookieA }) => {
    const free = await post(base, '/api/jobs', multipart([
      { name: 'photo', filename: 'me.png', type: 'image/png', body: fakePhoto() },
      { name: 'place', body: '' },
      { name: 'placeText', body: 'my grandmother s kitchen' },
      { name: 'outfitText', body: 'a green anorak' },
      { name: 'consent', body: 'yes' },
    ]), cookieA);
    assert.equal(free.status, 201);
    const freeJob = loadJob({ root, jobId: (await free.json()).jobId });
    assert.equal(freeJob.input.place.kind, 'text');
    assert.equal(freeJob.input.place.value, 'my grandmother s kitchen');
    assert.equal(freeJob.input.outfit.kind, 'text');

    // A card posts the preset id.
    const carded = await post(base, '/api/jobs', multipart([
      { name: 'photo', filename: 'me.png', type: 'image/png', body: fakePhoto() },
      { name: 'place', body: 'schrebergarten-august' },
      { name: 'outfit', body: 'trainingsjacke' },
      { name: 'consent', body: 'on' },
    ]), cookieA);
    const cardJob = loadJob({ root, jobId: (await carded.json()).jobId });
    assert.equal(cardJob.input.place.kind, 'preset');
    assert.equal(cardJob.input.place.value, 'schrebergarten-august');
    assert.equal(cardJob.input.outfit.kind, 'preset');
    assert.equal(cardJob.input.outfit.value, 'trainingsjacke');

    // And the label still resolves, so an older client does not break.
    const labelled = await post(base, '/api/jobs', multipart([
      { name: 'photo', filename: 'me.png', type: 'image/png', body: fakePhoto() },
      { name: 'place', body: 'The garden, in summer' },
      { name: 'outfit', body: 'Tracksuit jacket' },
      { name: 'consent', body: 'yes' },
    ]), cookieA);
    const labelJob = loadJob({ root, jobId: (await labelled.json()).jobId });
    assert.equal(labelJob.input.place.value, 'schrebergarten-august');
  });
});

test('the chosen resolution posts with the job, is priced, and is charged', async () => {
  await withServer(async ({ base, cookieA, accountA, app, auth }) => {
    const before = auth.balanceOf(accountA).credits;
    const res = await post(base, '/api/jobs', multipart([
      ...goodParts(),
      { name: 'resolution', body: '720p' },
    ]), cookieA);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.resolution, '720p');
    assert.equal(body.credits, 152);
    assert.equal(auth.balanceOf(accountA).credits, before - 152, 'the debit is the quoted price');

    // The web layer records what was chosen and what it cost, because the job
    // manifest cannot carry it -- `normalizeInput` drops fields it does not know.
    const claim = app.sessions.claimOf({ accountId: accountA.accountId, jobId: body.jobId });
    assert.equal(claim.resolution, '720p');
    assert.equal(claim.credits, 152);
  });
});

test('no resolution posted means the default one, and a deferred one is refused', async () => {
  await withServer(async ({ base, cookieA }) => {
    const silent = await post(base, '/api/jobs', multipart(goodParts()), cookieA);
    assert.equal(silent.status, 201);
    assert.equal((await silent.json()).resolution, '720p');

    for (const resolution of ['1080p', '4k', '', '../../etc']) {
      const parts = [...goodParts(), { name: 'resolution', body: resolution }];
      const res = await post(base, '/api/jobs', multipart(parts), cookieA);
      if (resolution === '') {
        // An empty field is "did not choose", which is the default, not an error.
        assert.equal(res.status, 201);
        continue;
      }
      assert.equal(res.status, 400, `${resolution} was accepted`);
      assert.equal((await res.json()).error.status, 400);
    }
  });
});

/**
 * A PART NAMED AFTER AN Object.prototype MEMBER WRITES NO FILE.
 *
 * `UPLOAD_NAMES` is frozen, which seals it without taking Object.prototype off
 * its chain -- so `UPLOAD_NAMES[part.name]` was satisfied by inherited members
 * and the `if (!rel)` guard passed on a function. `part.name` is attacker-chosen
 * text straight out of Content-Disposition.
 *
 * Measured before the fix: a part named `constructor` streamed its bytes to a
 * file called `function Object() { [native code] }` inside the job directory.
 * `__proto__`, `toString`, `valueOf` and `hasOwnProperty` all worked too.
 *
 * Bounded, and worth saying so: no reachable prototype value stringifies to
 * anything containing `/`, `\` or `..`, so this was never traversal and could
 * not leave the job directory. What it leaves is a file the retention purge
 * does not know by name -- and it is the SECOND appearance of this pattern,
 * after the billing page, which is the reason to close the class rather than
 * the instance.
 */
test('an upload part named after a prototype member is discarded, not written', async () => {
  await withServer(async ({ base, root, cookieA }) => {
    const stray = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'];
    const res = await post(base, '/api/jobs', multipart([
      ...goodParts(),
      ...stray.map((name) => ({ name, filename: 'x.png', type: 'image/png', body: fakePhoto() })),
    ]), cookieA);
    assert.equal(res.status, 201, 'the ordinary parts are still accepted');

    const { jobId } = await res.json();
    const jobDir = path.join(root, 'out', 'jobs', jobId);

    // LOOK IN THE JOB DIRECTORY ROOT, NOT IN input/. The legitimate values in
    // UPLOAD_NAMES already carry the `input/` prefix -- `input/upload-photo` --
    // and the sink joins them onto the job directory. A stringified prototype
    // member has no prefix, so it lands one level UP, beside the manifest. The
    // first draft of this test looked in input/, found nothing, and passed
    // against a deliberately sabotaged guard.
    const inInput = fs.existsSync(path.join(jobDir, 'input'))
      ? fs.readdirSync(path.join(jobDir, 'input')) : [];
    assert.ok(inInput.some((f) => /upload-photo/.test(f)),
      `the legitimate photo was not written, so this test proves nothing. input/ held: ${JSON.stringify(inInput)}`);

    const atRoot = fs.readdirSync(jobDir);
    for (const name of atRoot) {
      assert.ok(!/native code|object Object/.test(name),
        `a prototype member became a filename: ${JSON.stringify(name)}`);
    }
    // Only the directories and the manifest the pipeline itself creates.
    assert.deepEqual(
      atRoot.filter((f) => !/^(manifest\.json|input|intent|stills|segments|review|logs)$/.test(f)),
      [],
      `unexpected entries in the job directory: ${JSON.stringify(atRoot)}`);
  });
});

/**
 * THE NUMBER ON THE BUTTON MUST BE THE NUMBER ON THE LEDGER.
 *
 * The cost line was keyed on the QUALITY radio alone and its number came from
 * `CREDIT_COSTS`, which is computed with an aspect multiplier of 1. The charge
 * at enqueue is `costOf(resolution, aspect)`, which applies 4/3 for 16:9 and
 * 9:16. So the page said ~21 CR and the ledger took 28 (46 and 61 at 720p).
 *
 * Two harms, and the second is the nastier one. A funded customer is debited a
 * third more than the quote. A customer holding between the two numbers sees no
 * warning, uploads a photograph, and is refused with a 402 -- which is exactly
 * what the cheap pre-check exists to prevent.
 *
 * The page is deliberately zero-JavaScript, so it cannot recompute on
 * selection; the cross product has to be rendered and switched in CSS.
 *
 * `session-middleware.mjs` names this hazard in its own words: "a quote
 * computed differently from the charge is a quote that will one day differ from
 * the charge." It did.
 */
test('the quoted price matches the charge for every shape, not just 4:3', async () => {
  await withServer(async ({ base, cookieA, app }) => {
    const html = await (await get(base, '/', cookieA)).text();

    // Ask the same seam the charge uses, so this compares against the real
    // number rather than one written down in the test.
    for (const resolution of ['480p', '720p']) {
      for (const aspect of ['4:3', '16:9', '9:16']) {
        const charged = await app.sessions.cost({ resolution, seconds: 15, aspect });
        assert.match(html, new RegExp(`~${charged}\\s*CR`),
          `the page never shows ~${charged} CR, which is what ${resolution} ${aspect} actually costs`);
      }
    }

    // And the wide price must be genuinely different from the 4:3 one, so the
    // assertion above cannot pass because every shape quotes the same number.
    const square = await app.sessions.cost({ resolution: '480p', seconds: 15, aspect: '4:3' });
    const wide = await app.sessions.cost({ resolution: '480p', seconds: 15, aspect: '9:16' });
    assert.notEqual(square, wide, 'a wide shape costs 4/3 and must quote differently');
  });
});

/**
 * `stillCount` MULTIPLIED BILLED PROVIDER CALLS AND CONTRIBUTED NOTHING TO THE
 * PRICE -- and then the choice left the page altogether, 2026-08-29.
 *
 * The product is four choices and a tape (PRODUCT.md): the customer never
 * meets a still, so the form offers no count and the API accepts none. The
 * predecessor of this test bound the accepted set to the offered set {1,3,5};
 * the offered set is now empty, and the rule is unchanged -- a value the page
 * cannot produce is a request for unpriced provider spend and is refused by
 * name. An empty or absent field says nothing, and the server writes the only
 * count it uses: one, which the compose step zeroes on a direct job.
 */
test('a posted stillCount is refused: the page offers no such choice any more', async () => {
  await withServer(async ({ base, root, cookieA }) => {
    // 3 was the old default and 1/5 were on the old menu; all three must be
    // refused now, or a cached page quietly orders unpriced generations.
    for (const n of ['1', '3', '5', '8', '0', '-1', '3.5', 'three']) {
      const res = await post(base, '/api/jobs', multipart([...goodParts(), { name: 'stillCount', body: n }]), cookieA);
      assert.equal(res.status, 400, `stillCount=${JSON.stringify(n)} was accepted, and the page cannot produce one`);
      assert.equal((await res.json()).error.code, 'BAD_STILL_COUNT');
    }

    // An empty field says nothing, exactly like an absent one.
    const empty = await post(base, '/api/jobs', multipart([...goodParts(), { name: 'stillCount', body: '' }]), cookieA);
    assert.equal(empty.status, 201, 'an empty field is "did not choose"');

    // PRESENT FIRST: the manifest exists and carries the server's own count --
    // an absence assertion alone would pass against a job that never wrote one.
    const { jobId } = await empty.json();
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'out', 'jobs', jobId, 'manifest.json'), 'utf8'));
    assert.equal(manifest.input.stillCount, 1,
      'the web writes one still, chosen by nobody: the customer never meets the count');
  });
});

/** And the page must offer nothing, so the control cannot quietly return. */
test('the page offers no still-count control at all', async () => {
  await withServer(async ({ base, cookieA }) => {
    const html = await (await get(base, '/', cookieA)).text();
    assert.ok(html.includes('Record the tape'), 'the form is still there to be checked');
    assert.ok(!/stillCount/.test(html), 'the still-count control is back on the page');
    assert.ok(!/How many looks/.test(html), 'the superseded still-picker copy is back on the page');
  });
});

/** A failed job on disk, the way a worker leaves one: a real failStep record,
 *  optionally with the authored user-facing wording the pipeline attaches. */
function seedFailedJob(app, root, { owner, error, userMessage = null } = {}) {
  const job = createJob({
    root,
    input: {
      photo: { path: 'input/upload-photo', sha256: 'x'.repeat(64) },
      place: { kind: 'text', value: 'a beach' },
      outfit: { kind: 'text', value: 'a t-shirt' },
      stillCount: 1,
      consent: { granted: true, at: new Date().toISOString(), text: 'the wording' },
    },
    provider: 'fixture',
    cfg: CFG,
  });
  setJobStatus(job, 'running');
  beginStep(job, 'animate');
  failStep(job, 'animate', error);
  if (userMessage) job.error.userMessage = userMessage;
  saveJob(job);
  if (owner) app.sessions.claimJob({ accountId: owner.accountId, jobId: job.jobId });
  return job;
}

test('a failed render shows authored or generic copy, never the exception text', async () => {
  // pipeline.mjs stores the raw error.message for the operator and, when the
  // thrown error carried one, the authored `userMessage` for the customer.
  // jobView shipped the raw message and dropped the authored one -- so a
  // provider HTTP body, an ffmpeg stderr line or a guard name like
  // DIRECT_NEEDS_ONE_CALL was rendered into the status page's alert, verbatim,
  // to a person who paid.
  await withServer(async ({ base, root, app, cookieA, accountA }) => {
    const raw = seedFailedJob(app, root, {
      owner: accountA,
      error: Object.assign(new Error('ECONNRESET at fal.mjs:123 (request 9f3a)'), { code: 'empty_download' }),
    });
    const page = await (await get(base, `/j/${raw.jobId}`, cookieA)).text();
    // PRESENT FIRST: the alert renders, or the absence below proves nothing.
    assert.match(page, /role="alert"/, 'a failed job must show an alert at all');
    assert.match(page, /Something went wrong while making this tape\./,
      'an error nobody wrote customer copy for gets the generic sentence');
    assert.ok(!page.includes('ECONNRESET'), 'raw exception text reached a customer');
    assert.ok(!page.includes('fal.mjs'), 'an internal filename reached a customer');

    const api = await (await get(base, `/api/jobs/${raw.jobId}`, cookieA)).json();
    assert.ok(!String(api.error.message).includes('ECONNRESET'),
      'the API feeds the status poller the same page and must be as clean');
    assert.equal(api.error.code, 'empty_download', 'the code stays: it is how support finds the manifest');

    const authored = seedFailedJob(app, root, {
      owner: accountA,
      error: Object.assign(new Error('face gate: confidence below floor'), { code: 'NO_FACE' }),
      userMessage: 'That photo does not look like a photo of a person. Please choose one where a face is clearly visible.',
    });
    const page2 = await (await get(base, `/j/${authored.jobId}`, cookieA)).text();
    assert.match(page2, /choose one where a face is clearly visible/,
      'wording somebody wrote for the customer must win over the generic sentence');
    assert.ok(!page2.includes('confidence below floor'), 'the operator wording must not ride along');
  });
});

test('a failed tape says where the credits went, from the ledger and never from hope', async () => {
  // The refund is real (worker-side, section 28 item 6) and no page ever said
  // so; worse, saying "your credits came back" unconditionally would lie
  // whenever a paid step had already started, which is exactly when a customer
  // most wants the truth. The sentence is computed from the account's own
  // ledger rows for this job -- the same arithmetic refundCredits uses.
  await withServer(async ({ base, root, app, cookieA, accountA }) => {
    const err = () => Object.assign(new Error('boom'), { code: 'ERROR' });
    const at = new Date().toISOString();

    const refunded = seedFailedJob(app, root, { owner: accountA, error: err() });
    accountA.ledger.push({ at, delta: -21, jobId: refunded.jobId, reason: 'debit:job' });
    accountA.ledger.push({ at, delta: 21, jobId: refunded.jobId, reason: 'refund:failed-before-provider' });
    const refundedPage = await (await get(base, `/j/${refunded.jobId}`, cookieA)).text();
    assert.match(refundedPage, /21 credits for this tape went back to your balance/,
      'a refunded job must say so, with the number');

    const spent = seedFailedJob(app, root, { owner: accountA, error: err() });
    accountA.ledger.push({ at, delta: -28, jobId: spent.jobId, reason: 'debit:job' });
    const spentPage = await (await get(base, `/j/${spent.jobId}`, cookieA)).text();
    assert.ok(!/went back to your balance/.test(spentPage),
      'a job whose money is gone must not claim a refund');
    assert.match(spentPage, /credits for this tape were already spent/,
      'the spent case is stated plainly rather than left blank');

    const uncharged = seedFailedJob(app, root, { owner: accountA, error: err() });
    const unchargedPage = await (await get(base, `/j/${uncharged.jobId}`, cookieA)).text();
    assert.ok(!/went back to your balance|already spent/.test(unchargedPage),
      'a job the ledger never saw gets no money sentence at all');
  });
});

test('the status page keeps its alert and credit-note surfaces for the poller', async () => {
  // The poller repaints the headline and the steps but the SSR page rendered
  // the alert only when an error already existed -- so a job that failed
  // MID-POLL never showed its failure copy or its refund line until a manual
  // reload. The two surfaces now always exist, hidden while empty, and the
  // poller fills them from the same view the server rendered.
  await withServer(async ({ base, root, app, cookieA, accountA }) => {
    const job = seedJob(app, root, { status: 'running', owner: accountA });
    const page = await (await get(base, `/j/${job.jobId}`, cookieA)).text();
    assert.match(page, /id="alert"[^>]*hidden/, 'the alert surface must exist, hidden, on a healthy job');
    assert.match(page, /id="creditnote"[^>]*hidden/, 'the credit-note surface must exist, hidden, on a healthy job');
  });
});

test('the result page lists the shelf\'s other finished tapes, and not the one on screen', async () => {
  await withServer(async ({ base, root, app, cookieA, accountA }) => {
    const shown = seedJob(app, root, { status: 'done', owner: accountA, place: 'the garden' });
    const other = seedJob(app, root, { status: 'done', owner: accountA, place: 'the car park' });
    const html = await (await get(base, `/j/${shown.jobId}/result`, cookieA)).text();

    assert.ok(html.includes('Earlier tapes'), 'the rest of the shelf is missing');
    const earlier = html.slice(html.indexOf('Earlier tapes'));
    assert.ok(earlier.includes('the car park'), 'the other tape is not on the shelf below');
    assert.ok(earlier.includes(`/j/${other.jobId}/result`), 'and it does not link through');
    assert.ok(!earlier.includes(`/j/${shown.jobId}/result`), 'the tape on screen is listed under itself');

    // The window the words promise is the one the purge enforces, read from
    // the same config -- 30 days in config/render.json.
    assert.match(html, /stays on the shelf for 30 days/, 'the retention window did not reach the page');
  });
});

test('a tape made in a retired place keeps its old label on the shelf, not its id', async () => {
  // Four presets were replaced on 2026-09-04 (section 60I). A manifest stores
  // the preset ID, `labelsOf` translates it through the loaded catalog, and a
  // preset that is no longer in the catalog fell through as itself -- so a
  // tape somebody made in the car park last week would have captioned as
  // `autobahn-raststaette` the day the menu changed. The retired labels stay
  // known, exactly as they read when the tape was made.
  await withServer(async ({ base, root, app, cookieA, accountA }) => {
    seedJob(app, root, { status: 'done', owner: accountA, place: 'autobahn-raststaette' });
    seedJob(app, root, { status: 'done', owner: accountA, place: 'plattenbau-treppenhaus' });
    seedJob(app, root, { status: 'done', owner: accountA, place: 'ostsee-strand' });
    const html = await (await get(base, '/videos', cookieA)).text();
    assert.ok(html.includes('<span class="what">The car park, at dusk</span>'), 'the retired car park is not captioned by its old label');
    assert.ok(html.includes('<span class="what">The stairwell</span>'), 'the retired stairwell is not captioned by its old label');
    assert.ok(html.includes('<span class="what">The beach, out of season</span>'), 'the retired beach is not captioned by its old label');
    assert.ok(!html.includes('<span class="what">autobahn-raststaette</span>'), 'the id leaked onto the shelf as a caption');
  });
});

test('the job view carries the frame it was ordered in, shape and size', async () => {
  // The status page lists the order as where / wearing / frame, and the frame
  // is the shape AND the size. The view exposed the shape already; the size
  // was on the manifest and never projected, so the page could not say
  // "9:16, 480p" without reading the manifest itself.
  await withServer(async ({ base, root, app, cookieA, accountA }) => {
    const job = seedJob(app, root, { status: 'running', owner: accountA, aspect: '9:16', resolution: '480p' });
    const res = await fetch(`${base}/api/jobs/${job.jobId}`, { headers: { cookie: cookieA, accept: 'application/json' } });
    assert.equal(res.status, 200);
    const view = await res.json();
    assert.equal(view.input.aspect, '9:16');
    assert.equal(view.input.resolution, '480p');

    // A job that froze no size says null, not a default the page would print.
    const bare = seedJob(app, root, { status: 'running', owner: accountA });
    const bareView = await (await fetch(`${base}/api/jobs/${bare.jobId}`, { headers: { cookie: cookieA, accept: 'application/json' } })).json();
    assert.equal(bareView.input.resolution, null);
  });
});

test('a web job is direct exactly when its provider spends money', async () => {
  // Four choices and a tape: on the paid provider the still stage does not
  // exist, so the job must say `direct` in the only channel the worker reads
  // -- the manifest. The fixture keeps the still path, deliberately: its 8s
  // clip cap IS the segment-chaining guard, so a direct fixture job would be
  // refused at compose (DIRECT_NEEDS_ONE_CALL) and the dev loop would die.
  await withServer(async ({ base, root, cookieA }) => {
    const res = await post(base, '/api/jobs', multipart(goodParts()), cookieA);
    assert.equal(res.status, 201);
    const { jobId } = await res.json();
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'out', 'jobs', jobId, 'manifest.json'), 'utf8'));
    assert.equal(manifest.input.direct, false, 'a fixture job keeps the still path the dev loop renders');
  });

  await withServer(async ({ base, root, cookieA }) => {
    const res = await post(base, '/api/jobs', multipart(goodParts()), cookieA);
    assert.equal(res.status, 201);
    const { jobId } = await res.json();
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'out', 'jobs', jobId, 'manifest.json'), 'utf8'));
    assert.equal(manifest.input.direct, true, 'a fal job is the product: photograph in, tape out, no still');
  }, { provider: 'fal' });
});

test('a job post naming a foreign origin is refused before any money moves', async () => {
  // POST /api/jobs debits the account, and it was the only credit-spending
  // route without the same-origin gate every auth route carries. The refusal
  // fires on the headers, before the body is parsed -- and therefore before
  // a photograph lands or a credit moves.
  await withServer(async ({ base, root, cookieA, accountA }) => {
    const before = accountA.credits;
    const forged = await post(base, '/api/jobs', multipart(goodParts()), cookieA,
      { origin: 'https://evil.example', accept: 'application/json' });
    assert.equal(forged.status, 403, 'a cross-site job post must be refused');
    assert.equal((await forged.json()).error.code, 'NOT_FROM_THIS_SITE');
    assert.equal(accountA.credits, before, 'a refused forgery must not touch the balance');
    assert.deepEqual(jobDirs(root), [], 'a refused forgery must leave nothing on disk');

    const genuine = await post(base, '/api/jobs', multipart(goodParts()), cookieA,
      { 'sec-fetch-site': 'same-origin', accept: 'application/json' });
    assert.equal(genuine.status, 201, 'the browser submission this gate exists to keep working');
  });
});

test('a card beats the describe-it box when somebody fills in both', async () => {
  await withServer(async ({ base, root, cookieA }) => {
    const res = await post(base, '/api/jobs', multipart([
      { name: 'photo', filename: 'me.png', type: 'image/png', body: fakePhoto() },
      { name: 'place', body: 'amalfi-afternoon' },
      { name: 'placeText', body: 'somewhere else entirely' },
      { name: 'outfit', body: 'fleecepulli' },
      { name: 'consent', body: 'yes' },
    ]), cookieA);
    const job = loadJob({ root, jobId: (await res.json()).jobId });
    assert.equal(job.input.place.value, 'amalfi-afternoon', 'the card the person clicked wins');
  });
});

test('a photo of the place is a second reference, and both files land', async () => {
  await withServer(async ({ base, root, cookieA }) => {
    const face = fakePhoto(30_000, 'face');
    const place = fakePhoto(50_000, 'place');
    const res = await post(base, '/api/jobs', multipart([
      { name: 'photo', filename: 'me.png', type: 'image/png', body: face },
      { name: 'placePhoto', filename: 'garden.png', type: 'image/png', body: place },
      // "Use my own place" posts an empty `place`; the caption is optional.
      { name: 'place', body: '' },
      { name: 'placeText', body: 'the garden behind the house' },
      { name: 'outfit', body: 'a fleece' },
      { name: 'consent', body: 'yes' },
    ]), cookieA);
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

test('a place photo with no caption at all is still accepted', async () => {
  await withServer(async ({ base, root, cookieA }) => {
    const res = await post(base, '/api/jobs', multipart([
      { name: 'photo', filename: 'me.png', type: 'image/png', body: fakePhoto() },
      { name: 'placePhoto', filename: 'garden.png', type: 'image/png', body: fakePhoto(20_000, 'g') },
      { name: 'place', body: '' },
      { name: 'outfit', body: 'winterjacke' },
      { name: 'consent', body: 'yes' },
    ]), cookieA);
    assert.equal(res.status, 201);
    const job = loadJob({ root, jobId: (await res.json()).jobId });
    assert.equal(job.input.place.kind, 'photo');
    assert.equal(job.input.place.value, null);
  });
});

test('every manifest path is relative -- saveJob throws PATH_NOT_RELATIVE otherwise', async () => {
  await withServer(async ({ base, root, cookieA }) => {
    const { jobId } = await (await post(base, '/api/jobs', multipart(goodParts()), cookieA)).json();
    const raw = JSON.parse(fs.readFileSync(jobPaths(root, jobId).manifest, 'utf8'));
    for (const p of [raw.input.photo.path, raw.input.place.photoPath].filter(Boolean)) {
      assert.ok(!path.isAbsolute(p) && !p.includes('\\') && !/^[A-Za-z]:/.test(p), `${p} is not relative`);
    }
  });
});

test('consent is a gate, and a refused upload leaves nothing on disk', async () => {
  await withServer(async ({ base, root, queue, cookieA }) => {
    for (const consent of [undefined, 'false', '', 'no', 'off']) {
      const parts = goodParts().filter((p) => p.name !== 'consent');
      if (consent !== undefined) parts.push({ name: 'consent', body: consent });
      const res = await post(base, '/api/jobs', multipart(parts), cookieA);
      assert.equal(res.status, 400, `consent=${JSON.stringify(consent)} was accepted`);
      assert.equal((await res.json()).error.status, 400);
    }
    // Not one directory, not one photograph.
    assert.deepEqual(jobDirs(root), []);
    assert.deepEqual(queue.calls.enqueued, []);
  });
});

test('a missing photo, missing text and over-long text are each a 400', async () => {
  await withServer(async ({ base, root, cookieA }) => {
    const cases = [
      goodParts().filter((p) => p.name !== 'photo'),
      goodParts().filter((p) => p.name !== 'outfit'),
      goodParts().map((p) => (p.name === 'place' ? { name: 'place', body: 'x'.repeat(300) } : p)),
      goodParts().map((p) => (p.name === 'photo' ? { ...p, body: Buffer.alloc(0) } : p)),
    ];
    for (const parts of cases) {
      assert.equal((await post(base, '/api/jobs', multipart(parts), cookieA)).status, 400);
    }
    assert.deepEqual(jobDirs(root), []);
  });
});

test('an upload over the cap is 413 and a non-multipart post is 415', async () => {
  await withServer(async ({ base, root, cookieA }) => {
    const huge = await post(base, '/api/jobs', multipart([
      { name: 'photo', filename: 'big.png', type: 'image/png', body: fakePhoto(13_000_000, 'big') },
      { name: 'place', body: 'a beach' },
      { name: 'outfit', body: 'a shirt' },
      { name: 'consent', body: 'yes' },
    ]), cookieA);
    assert.equal(huge.status, 413);

    const wrongType = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ place: 'a beach' }),
    });
    assert.equal(wrongType.status, 415);

    assert.deepEqual(jobDirs(root), []);
  });
});

test('a browser form post is redirected; an API client gets the 201', async () => {
  await withServer(async ({ base, cookieA }) => {
    // `redirect: 'manual'` because the point under test IS the redirect; fetch
    // would otherwise follow it and report the 200 from the status page.
    const res = await post(base, '/api/jobs', multipart(goodParts()), cookieA, {
      accept: 'text/html,application/xhtml+xml',
    }, { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /^\/j\/\d{8}-\d{6}-[0-9a-f]{6}$/);
  });
});

// ---------------------------------------------------------------------------
// GET /api/jobs/:id
// ---------------------------------------------------------------------------

test('GET /api/jobs/:id has the documented shape', async () => {
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { owner: accountA });
    const res = await get(base, `/api/jobs/${job.jobId}`, cookieA);
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
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { owner: accountA });
    job.steps[0].status = 'done';
    job.steps[1].status = 'skipped';
    saveJob(job);
    const view = await (await get(base, `/api/jobs/${job.jobId}`, cookieA)).json();
    assert.equal(view.pct, Math.round((2 / 11) * 100));
    assert.equal(view.step, 'expand');
  });
});

test('a bad id is 400 before the filesystem, and an unknown id is 404', async () => {
  await withServer(async ({ base, cookieA }) => {
    for (const id of ['not-an-id', '2026-08-20', '20260820-144501-A3F19C', 'x'.repeat(80)]) {
      const res = await get(base, `/api/jobs/${encodeURIComponent(id)}`, cookieA);
      assert.equal(res.status, 400, `${id} was not refused`);
    }
    // Right shape, no such job.
    assert.equal((await get(base, '/api/jobs/20260820-144501-a3f19c', cookieA)).status, 404);
  });
});

test('traversal in the path never reaches the filesystem', async () => {
  await withServer(async ({ base, cookieA }) => {
    for (const target of [
      '/api/jobs/%2e%2e%2f%2e%2e%2fconfig%2frender.json',
      '/api/jobs/..%2f..%2fpackage.json/video',
      '/j/%2e%2e%2f%2e%2e',
    ]) {
      const res = await get(base, target, cookieA);
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
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const nasty = '<img src=x onerror=alert(1)>"\'&';
    const job = seedJob(app, root, {
      place: nasty, outfit: `</script><script>alert(2)</script>`, owner: accountA,
    });

    const page = await (await get(base, `/j/${job.jobId}`, cookieA)).text();
    assert.ok(!page.includes('<img src=x'), 'the place field rendered as markup');
    assert.ok(!page.includes('<script>alert(2)'), 'the outfit field closed the script element');
    assert.ok(page.includes('&lt;img src=x onerror=alert(1)&gt;'), 'and it is visible as text');

    // The shelf echoes the same value in a different template.
    const home = await (await get(base, '/', cookieA)).text();
    assert.ok(!home.includes('<img src=x onerror'), 'the shelf rendered the place as markup');
    assert.ok(home.includes('&lt;img src=x onerror=alert(1)&gt;'), 'and shows it as text');

    // The JSON payload the poller reads carries it raw, which is correct -- JSON
    // is not HTML -- and the page must be the thing that escapes it.
    const view = await (await get(base, `/api/jobs/${job.jobId}`, cookieA)).json();
    assert.equal(view.input.place, nasty);
  });
});

test('pages declare a content security policy and refuse to be sniffed', async () => {
  await withServer(async ({ base, cookieA }) => {
    const res = await get(base, '/', cookieA);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    // The per-place gradients are generated into /styles.css precisely so that
    // this can stay as it is. If somebody adds `style="..."` to a card, this
    // fails before the CSP has to be loosened for it.
    assert.match(res.headers.get('content-security-policy'), /style-src 'self';/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('vary') ?? '', /Cookie/);

    const html = await res.text();
    assert.ok(!/ style="/.test(html), 'an inline style attribute would be blocked by this CSP');
  });
});

/**
 * `script-src 'unsafe-inline'` names no scripts at all: it admits every inline
 * script, including one an injection just wrote, which is to say it admits the
 * exact thing a script policy exists to refuse. The pages ship a known, fixed
 * set of inline scripts, so the policy can name each one by its hash -- the
 * shipped scripts run, and nothing else does. Asserted from the OUTSIDE: every
 * script actually present in the page must be named by the header on the same
 * response, so an edited script that forgets its hash fails here rather than
 * silently going dead in the browser.
 */
test('the only scripts a page may run are the ones it ships, named by hash', async () => {
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { owner: accountA });
    for (const target of ['/', `/j/${job.jobId}`]) {
      const res = await get(base, target, cookieA);
      const csp = res.headers.get('content-security-policy') ?? '';
      assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp),
        `${target} admits every inline script, including an injected one`);
      const html = await res.text();
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      assert.ok(scripts.length > 0, `${target} lost its script; this test needs a page that ships one`);
      for (const body of scripts) {
        const digest = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
        assert.ok(csp.includes(`'sha256-${digest}'`),
          `${target} ships a script its own policy does not name`);
      }
    }
  });
});

/**
 * The file path serves what a user uploaded, re-encoded. `sendJson` and
 * `sendHtml` have always said "do not sniff me"; the one path serving
 * user-influenced bytes did not, and a browser that second-guesses a
 * Content-Type is a browser that can be talked into executing a "video".
 */
test('a served file refuses sniffing and carries a policy of its own', async () => {
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { status: 'awaiting-selection', owner: accountA });
    writeStills(root, job.jobId, [1]);
    const res = await get(base, `/api/jobs/${job.jobId}/stills/1`, cookieA);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/,
      'a served file is data and must say so, in case it is ever opened as a document');
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  });
});

/**
 * The headers that only matter on the day this is deployed, sent from the
 * first day so deployment does not depend on remembering them. Referrer-Policy
 * is the load-bearing one today: a job url is `/j/<id>` and the id is the only
 * secret protecting a face's status page from anyone who never signed in as
 * its owner -- it must not ride out in `Referer` when a person follows a link
 * off a page. HSTS is ignored over plain HTTP by specification, so sending it
 * always costs nothing locally and is already right behind TLS.
 */
test('every response carries the deployment headers, pages and JSON alike', async () => {
  await withServer(async ({ base, cookieA }) => {
    const page = await get(base, '/', cookieA);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(page.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(page.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.match(page.headers.get('permissions-policy') ?? '', /camera=\(\)/,
      'a product that handles faces should say out loud that its pages never want the camera');
    assert.match(page.headers.get('strict-transport-security') ?? '', /max-age=\d+/);

    const json = await get(base, '/api/health', cookieA);
    assert.equal(json.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(json.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.match(json.headers.get('strict-transport-security') ?? '', /max-age=\d+/);
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
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { status: 'awaiting-selection', owner: accountA });
    writeStills(root, job.jobId, [1, 2, 4]);

    const body = await (await get(base, `/api/jobs/${job.jobId}/stills`, cookieA)).json();
    assert.deepEqual(body.stills.map((s) => s.index), [1, 2, 4],
      'indices must come off still-NN.png, not from the array position');
    assert.equal(body.stills[0].url, `/api/jobs/${job.jobId}/stills/1`);
    assert.equal(body.selected, null);

    // And the file behind index 4 is still-04.png, not the fourth entry.
    const png = await (await get(base, `/api/jobs/${job.jobId}/stills/4`, cookieA)).text();
    assert.equal(png, 'still 4');
    assert.equal((await get(base, `/api/jobs/${job.jobId}/stills/3`, cookieA)).status, 404);
    assert.equal((await get(base, `/api/jobs/${job.jobId}/stills/0`, cookieA)).status, 400);
  });
});

test('POST select records the 1-based index and re-enqueues', async () => {
  await withServer(async ({ base, root, queue, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { status: 'awaiting-selection', owner: accountA });
    writeStills(root, job.jobId, [1, 2, 3]);

    const res = await fetch(`${base}/api/jobs/${job.jobId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
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

test('a select naming a foreign origin is refused before the job moves', async () => {
  // `select` is the second and last place the web process writes a manifest:
  // it records the choice, flips the job to `running` and puts it back on the
  // queue. Every other state-changing POST in this app opens on the same-origin
  // gate; this one reached the write with only the ownership check. Today the
  // session cookie is `SameSite=Lax`, so a cross-site POST arrives with no
  // session and the dispatcher 303s to /login before the handler runs -- which
  // is exactly why the gap was invisible. The gate is asserted here so it does
  // not depend on a cookie attribute defined three files away.
  await withServer(async ({ base, root, queue, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { status: 'awaiting-selection', owner: accountA });
    writeStills(root, job.jobId, [1, 2, 3]);

    const forged = await fetch(`${base}/api/jobs/${job.jobId}/select`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookieA,
        origin: 'https://evil.example',
        accept: 'application/json',
      },
      body: JSON.stringify({ stillIndex: 1 }),
    });
    assert.equal(forged.status, 403, 'a cross-site select must be refused');
    assert.equal((await forged.json()).error.code, 'NOT_FROM_THIS_SITE');

    const after = loadJob({ root, jobId: job.jobId });
    assert.equal(after.status, 'awaiting-selection', 'a refused forgery must not move the job');
    assert.equal(after.selection?.stillIndex ?? null, null, 'a refused forgery must not record a choice');
    assert.deepEqual(queue.calls.enqueued, [], 'a refused forgery must not reach the queue');

    // The submission this gate exists to keep working: the contact-sheet form
    // is same-origin and carries no token, so `sameOriginPost` is the gate and
    // the full anti-forgery pair would break it.
    const genuine = await fetch(`${base}/api/jobs/${job.jobId}/select`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookieA,
        'sec-fetch-site': 'same-origin',
        accept: 'application/json',
      },
      body: JSON.stringify({ stillIndex: 1 }),
    });
    assert.equal(genuine.status, 200, 'the real contact-sheet submission must still work');
    assert.deepEqual(queue.calls.enqueued, [job.jobId], 'and it must still reach the queue');
  });
});

test('an out-of-range still index is a 400 and never a clamp', async () => {
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { status: 'awaiting-selection', owner: accountA });
    writeStills(root, job.jobId, [1, 2, 3]);

    for (const stillIndex of [0, -1, 4, 99, 1.5, 'two', null]) {
      const res = await fetch(`${base}/api/jobs/${job.jobId}/select`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieA },
        body: JSON.stringify({ stillIndex }),
      });
      assert.equal(res.status, 400, `stillIndex=${JSON.stringify(stillIndex)} was accepted`);
    }
    assert.equal(loadJob({ root, jobId: job.jobId }).selection.stillIndex, null,
      'a refused selection must not have been clamped into the manifest');
  });
});

test('select is 409 unless the job is parked, and 409 while a worker holds it', async () => {
  await withServer(async ({ base, root, queue, app, accountA, cookieA }) => {
    const running = seedJob(app, root, { status: 'running', owner: accountA });
    writeStills(root, running.jobId, [1]);
    const busy = await fetch(`${base}/api/jobs/${running.jobId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ stillIndex: 1 }),
    });
    assert.equal(busy.status, 409);

    const parked = seedJob(app, root, { status: 'awaiting-selection', owner: accountA });
    writeStills(root, parked.jobId, [1]);
    queue.holdLease(parked.jobId);
    const leased = await fetch(`${base}/api/jobs/${parked.jobId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ stillIndex: 1 }),
    });
    assert.equal(leased.status, 409, 'the web process must not write a manifest a worker holds');
    assert.deepEqual(queue.calls.enqueued, []);
  });
});

/**
 * THE ONE SCREEN THAT MUST WORK WITHOUT JAVASCRIPT. It carries a human decision
 * and it gates real spend: one submit button per frame, a plain form action, and
 * no script element on the page at all.
 */
test('the contact sheet is a plain form and carries no script', async () => {
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { status: 'awaiting-selection', owner: accountA });
    writeStills(root, job.jobId, [1, 2, 4]);
    const html = await (await get(base, `/j/${job.jobId}/select`, cookieA)).text();

    assert.ok(html.includes(`action="/api/jobs/${job.jobId}/select"`));
    assert.ok(html.includes('method="post"'));
    assert.ok(html.includes('name="stillIndex" value="1"'));
    assert.ok(html.includes('name="stillIndex" value="4"'));
    assert.ok(!html.includes('name="stillIndex" value="0"'), 'there is no frame zero');
    assert.ok(!html.includes('name="stillIndex" value="3"'), 'still-03.png does not exist');
    assert.ok(html.includes('>4</span>'), 'the number shown matches the number posted');
    assert.ok(!html.includes('<script'), 'the contact sheet must not need scripting');

    // A form post gets a redirect back to the status page.
    const res = await fetch(`${base}/api/jobs/${job.jobId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html', cookie: cookieA },
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
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const queued = seedJob(app, root, { owner: accountA });
    const page = await get(base, `/j/${queued.jobId}`, cookieA, {}, { redirect: 'manual' });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes('Reading your photo'), 'the current step is named');
    assert.ok(!/\b9[0-9]%/.test(html), 'no fake percentage');

    const parked = seedJob(app, root, { status: 'awaiting-selection', owner: accountA });
    const toSelect = await get(base, `/j/${parked.jobId}`, cookieA, {}, { redirect: 'manual' });
    assert.equal(toSelect.status, 303);
    assert.equal(toSelect.headers.get('location'), `/j/${parked.jobId}/select`);

    const finished = seedJob(app, root, { status: 'done', owner: accountA });
    const toResult = await get(base, `/j/${finished.jobId}`, cookieA, {}, { redirect: 'manual' });
    assert.equal(toResult.status, 303);
    assert.equal(toResult.headers.get('location'), `/j/${finished.jobId}/result`);

    // And the reverse: a result page for an unfinished job goes back.
    const back = await get(base, `/j/${queued.jobId}/result`, cookieA, {}, { redirect: 'manual' });
    assert.equal(back.status, 303);
    assert.equal(back.headers.get('location'), `/j/${queued.jobId}`);
  });
});

test('the result page offers the video, a download and a way to start again', async () => {
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { status: 'done', owner: accountA });
    fs.writeFileSync(jobPaths(root, job.jobId).video, Buffer.alloc(2048, 7));
    const html = await (await get(base, `/j/${job.jobId}/result`, cookieA)).text();
    assert.ok(html.includes('<video controls'));
    assert.ok(html.includes(`src="/api/jobs/${job.jobId}/video"`));
    assert.ok(html.includes('download='));
    assert.ok(html.includes('Make another'));
  });
});

test('the result page says the tape is AI-generated', async () => {
  // EU AI Act Art. 50: the person meeting the content must be told it is
  // synthetic, on the page where they meet it -- not only in file metadata a
  // browser never shows. The file-side half lives in audio-bed/audio-output.
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { status: 'done', owner: accountA });
    fs.writeFileSync(jobPaths(root, job.jobId).video, Buffer.alloc(2048, 7));
    const html = await (await get(base, `/j/${job.jobId}/result`, cookieA)).text();
    assert.ok(html.includes('Made with AI'),
      'the result page must carry the AI disclosure line');
  });
});

// ---------------------------------------------------------------------------
// media
// ---------------------------------------------------------------------------

test('a tape, its poster and a still are never cached, because the next person at the browser may not own them', async () => {
  // `private, max-age=3600` keeps the file out of shared caches and still
  // lets the BROWSER keep it: on a shared machine the tape and the poster
  // replay from cache after sign-out, and `private` does nothing about that.
  // A face is not worth a cache hit. The place photographs and the brand
  // assets stay cacheable -- they are nobody's.
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { status: 'done', owner: accountA });
    const paths = jobPaths(root, job.jobId);
    fs.writeFileSync(paths.video, crypto.randomBytes(500));
    fs.writeFileSync(paths.poster, crypto.randomBytes(500));
    fs.mkdirSync(paths.stills, { recursive: true });
    fs.writeFileSync(path.join(paths.stills, 'still-01.png'), crypto.randomBytes(500));

    for (const url of [
      `/api/jobs/${job.jobId}/video`,
      `/api/jobs/${job.jobId}/poster`,
      `/api/jobs/${job.jobId}/stills/1`,
    ]) {
      const res = await get(base, url, cookieA);
      assert.equal(res.status, 200, `${url} -> ${res.status}`);
      assert.equal(res.headers.get('cache-control'), 'no-store', `${url} is cacheable: ${res.headers.get('cache-control')}`);
      await res.arrayBuffer();
    }
    const place = await get(base, '/places/amalfi-afternoon.jpg', cookieA);
    assert.equal(place.status, 200);
    assert.match(place.headers.get('cache-control') ?? '', /max-age=\d+/, 'a place photograph is still cacheable');
    await place.arrayBuffer();
  });
});

test('the video is range-request capable', async () => {
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { status: 'done', owner: accountA });
    const bytes = crypto.randomBytes(5000);
    fs.writeFileSync(jobPaths(root, job.jobId).video, bytes);
    const url = `/api/jobs/${job.jobId}/video`;

    const whole = await get(base, url, cookieA);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('accept-ranges'), 'bytes');
    assert.equal(whole.headers.get('content-type'), 'video/mp4');
    assert.equal(Buffer.from(await whole.arrayBuffer()).length, 5000);

    const partial = await get(base, url, cookieA, { range: 'bytes=100-199' });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 100-199/5000');
    const got = Buffer.from(await partial.arrayBuffer());
    assert.equal(got.length, 100);
    assert.ok(got.equals(bytes.subarray(100, 200)), 'the wrong bytes came back');

    const tail = await get(base, url, cookieA, { range: 'bytes=-50' });
    assert.equal(tail.status, 206);
    assert.ok(Buffer.from(await tail.arrayBuffer()).equals(bytes.subarray(4950)),
      'bytes=-50 is the LAST fifty bytes');

    const bad = await get(base, url, cookieA, { range: 'bytes=99999-' });
    assert.equal(bad.status, 416);

    const attached = await get(base, `${url}?download=1`, cookieA);
    assert.match(attached.headers.get('content-disposition'), /attachment; filename="timestamp-/);
  });
});

test('asking for a video or poster that does not exist yet is 404, not 500', async () => {
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { owner: accountA });
    assert.equal((await get(base, `/api/jobs/${job.jobId}/video`, cookieA)).status, 404);
    assert.equal((await get(base, `/api/jobs/${job.jobId}/poster`, cookieA)).status, 404);
  });
});

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

test('DELETE on an unclaimed job cancels it and deletes the photograph', async () => {
  await withServer(async ({ base, root, cookieA }) => {
    const { jobId } = await (await post(base, '/api/jobs', multipart(goodParts()), cookieA)).json();
    const paths = jobPaths(root, jobId);
    assert.ok(fs.existsSync(`${paths.dir}/input/upload-photo`));

    const res = await get(base, `/api/jobs/${jobId}`, cookieA, {}, { method: 'DELETE' });
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
  await withServer(async ({ base, root, queue, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { status: 'running', owner: accountA });
    const before = fs.readFileSync(jobPaths(root, job.jobId).manifest, 'utf8');
    queue.holdLease(job.jobId);

    const res = await get(base, `/api/jobs/${job.jobId}`, cookieA, {}, { method: 'DELETE' });
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

test('DELETE on a finished job deletes the video, the stills and the poster, not just the upload', async () => {
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { status: 'done', owner: accountA });
    const paths = jobPaths(root, job.jobId);
    // A face ends up in four places, and before this test only the first was
    // ever deleted. `docs/security-review-2026-08-21.md` F2: "there is no
    // endpoint in this application that deletes a finished video".
    fs.writeFileSync(`${paths.input}/upload-photo`, Buffer.from('the uploaded face'));
    fs.writeFileSync(`${paths.stills}/still-01.png`, Buffer.from('a generated face'));
    fs.writeFileSync(`${paths.review}/contact-sheet.png`, Buffer.from('every face at once'));
    fs.writeFileSync(paths.video, Buffer.from('the finished tape'));
    fs.writeFileSync(paths.poster, Buffer.from('a frame of the tape'));

    const res = await get(base, `/api/jobs/${job.jobId}`, cookieA, {}, { method: 'DELETE' });

    assert.equal(res.status, 200);
    assert.deepEqual(fs.readdirSync(paths.input), [], 'the upload');
    assert.deepEqual(fs.readdirSync(paths.stills), [], 'the generated stills are faces too');
    assert.deepEqual(fs.readdirSync(paths.review), [], 'the contact sheet is every face at once');
    assert.equal(fs.existsSync(paths.video), false, 'the finished video');
    assert.equal(fs.existsSync(paths.poster), false, 'the poster is a frame of the video');
    assert.ok(fs.existsSync(paths.manifest), 'the manifest holds no image and is the cost record');
  });
});

test('a finished job that was deleted stays deleted and reports it, rather than 500ing on a second DELETE', async () => {
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { status: 'done', owner: accountA });
    fs.writeFileSync(jobPaths(root, job.jobId).video, Buffer.from('the finished tape'));

    const first = await get(base, `/api/jobs/${job.jobId}`, cookieA, {}, { method: 'DELETE' });
    const second = await get(base, `/api/jobs/${job.jobId}`, cookieA, {}, { method: 'DELETE' });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200, 'deletion is idempotent; a double-click is not an error');
    assert.equal((await second.json()).filesDeleted, 0, 'and the second one honestly reports removing nothing');
  });
});

test('DELETE tells the truth about whether the media actually went', async () => {
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { status: 'done', owner: accountA });
    const paths = jobPaths(root, job.jobId);
    fs.writeFileSync(paths.video, Buffer.from('the finished tape'));

    const body = await (await get(base, `/api/jobs/${job.jobId}`, cookieA, {}, { method: 'DELETE' })).json();

    // The handler must report what purge actually achieved rather than assume
    // it succeeded. A refused unlink -- EBUSY while the browser streams the
    // video -- used to be swallowed, and the person was told a face was deleted
    // that was still on disk.
    assert.equal(body.mediaDeleted, true, 'a clean delete says so explicitly');
    assert.deepEqual(body.errors, [], 'and carries the field that would name a failure');
    assert.equal(fs.existsSync(paths.video), false);
  });
});

test('an expired lease is not a claim', async () => {
  await withServer(async ({ base, root, queue, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { status: 'running', owner: accountA });
    queue.holdLease(job.jobId, { expired: true });
    const res = await get(base, `/api/jobs/${job.jobId}`, cookieA, {}, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(loadJob({ root, jobId: job.jobId }).status, 'cancelled');
  });
});

// ---------------------------------------------------------------------------
// health and the edges
// ---------------------------------------------------------------------------

test('GET /api/health answers ok and what is degraded without a session, and nothing else', async () => {
  // The endpoint is public because the uptime monitor has no session, and it
  // keys on `"ok":true` and nothing more. The rest of the report -- the exact
  // ffprobe build, disk bytes, queue counts, which provider is wired -- is
  // useful to an operator and to somebody targeting the upload decoder, so it
  // is answered to a session and to nobody else. `ok` stays the first key,
  // because that is the literal string the monitor searches for.
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.startsWith('{"ok":true'), `the monitor keys on the leading "ok": ${text.slice(0, 40)}`);
    const body = JSON.parse(text);
    assert.deepEqual(Object.keys(body).sort(), ['degraded', 'ok']);
    assert.deepEqual(body.degraded, []);
  });
});

test('GET /api/health reports ffmpeg, the queue, the worker and the disk to a signed-in caller', async () => {
  await withServer(async ({ base, cookieA }) => {
    const res = await get(base, '/api/health', cookieA);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.degraded, []);
    assert.equal(body.ffmpeg.available, true);
    assert.deepEqual(Object.keys(body.queue).sort(), ['claimed', 'done', 'failed', 'pending']);
    assert.ok('lastSeen' in body.worker);
    assert.ok('low' in body.disk);
  });
});

test('GET /api/health names what is degraded without a session, so the monitor alert says why', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-web-'));
  const app = createServer({
    root, cfg: CFG, queue: fakeQueue(), port: 0, auth: fakeAuth(),
    ffprobeImpl: async () => { throw Object.assign(new Error('spawn ffprobe ENOENT'), { code: 'ENOENT' }); },
  });
  const port = await app.listen();
  try {
    const body = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.json());
    assert.equal(body.ok, false);
    assert.deepEqual(body.degraded, ['ffmpeg']);
    assert.equal('ffmpeg' in body, false, 'the failure is named, the build and the error code are not');
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a job ordered at a wide shape is charged the wide price', async () => {
  // THE PASS-THROUGH DEFECT THIS EXISTS TO PREVENT, and it is the shape section
  // 26 records three times in one morning: a value that is present, correct,
  // and simply not handed on. The handler reads `aspect` and validates it, then
  // computed credits from the resolution alone -- so opening the menu without
  // this would have charged every wide tape the 4:3 price and sold it a third
  // below cost, invisibly, exactly as 480p was for weeks.
  //
  // Asserted on the DEBIT, not on the quote: a quote computed one way and a
  // charge computed another is the failure the seam's own comment warns about.
  await withServer(async ({ base, cookieA, auth, accountA }) => {
    const order = async (aspect) => {
      const before = auth.balanceOf(auth.loadAccount({ accountId: accountA.accountId })).credits;
      const res = await post(base, '/api/jobs', multipart([
        { name: 'photo', filename: 'p.png', type: 'image/png', body: fakePhoto(4_000, aspect) },
        { name: 'place', body: 'a beach' },
        { name: 'outfit', body: 'a shirt' },
        { name: 'consent', body: 'yes' },
        { name: 'resolution', body: '480p' },
        { name: 'aspect', body: aspect },
      ]), cookieA);
      const body = await res.json();
      assert.equal(res.status, 201, `ordering ${aspect} failed: ${JSON.stringify(body)}`);
      const after = auth.balanceOf(auth.loadAccount({ accountId: accountA.accountId })).credits;
      return { quoted: body.credits, charged: before - after };
    };

    // Asserted as a RATIO against the 4:3 order rather than as absolute credit
    // figures, because this harness prices from its own fixture table. The
    // ratio is the thing that must hold: it is arithmetic, and it is what goes
    // wrong when the shape is not handed on.
    const expected = REAL_CREDITS.aspects['16:9'];

    const flat = await order('4:3');
    assert.equal(flat.charged, flat.quoted, 'the 4:3 tape was not charged what it was quoted');

    for (const aspect of ['16:9', '9:16']) {
      const wide = await order(aspect);
      assert.equal(wide.charged, wide.quoted, `the ${aspect} tape was not charged what it was quoted`);
      assert.equal(wide.quoted, Math.ceil(flat.quoted * expected),
        `a ${aspect} tape was quoted ${wide.quoted} against a 4:3 price of ${flat.quoted} -- the shape was not handed on`);
    }
  }, { provider: 'fixture' });
});

test('the frame-shape menu never offers a shape the configured renderer will refuse', async () => {
  // THE PAGE AND THE PIPELINE DISAGREED, AND THE PAGE WAS THE OPTIMISTIC ONE.
  // `config/render.json` marks 16:9 and 9:16 available, so the form rendered
  // all three as selectable -- while `resolveRaster` refuses any non-default
  // shape on a PAID provider, because fal is sent a hardcoded aspect_ratio and
  // a 9:16 tape built around a 4:3 source is a render that silently delivers
  // something other than what was ordered.
  //
  // Invisible today only because the web app defaults to the fixture, which
  // renders all three. The moment a real provider is configured -- which is
  // what deploying means -- two thirds of the menu becomes a guaranteed
  // failure at compose, after the credits have already been debited.
  //
  // The radio inputs are what is asserted rather than the cards, because the
  // radio is what makes a shape submittable. A shape with no input cannot be
  // ordered even by a hand-written POST.
  const offered = (html) => [...html.matchAll(/name="aspect"[^>]*value="([^"]+)"/g)].map((m) => m[1]).sort();
  const page = async (base, cookie) => (await fetch(base, { headers: { cookie, accept: 'text/html' } })).text();

  // THIS ASSERTION CHANGED SHAPE AND GOT STRONGER, which is worth writing down.
  // It used to say "under a paid renderer the page offers only 4:3", which was
  // the right answer while `resolveRaster` refused every other shape. The paid
  // path orders shapes now, so that expectation would pin the old defect in
  // place -- the page would be hiding a feature that works.
  //
  // What it asserts instead is the INVARIANT the old version was an instance
  // of: every shape on the page is one the pipeline would actually accept.
  // That is tied to `resolveRaster` directly rather than to a hardcoded list,
  // so it stays true whichever way the answer moves next.
  const paidLike = {
    id: 'fal', paid: true,
    capabilities: { stillSizes: FAL_CAPABILITIES.stillSizes },
  };

  await withServer(async ({ base, cookieA }) => {
    const shapes = offered(await page(base, cookieA));
    assert.ok(shapes.length > 0, 'the page offers no frame shape at all');
    for (const aspect of shapes) {
      assert.doesNotThrow(
        () => resolveRaster({ resolution: '480p', provider: paidLike, aspect, defaultAspect: CFG.defaultAspect }),
        `the page offers ${aspect} and a paid render of it is refused at compose`,
      );
    }
    // And it is not passing by offering only the default: the shapes that
    // config marks available are all there.
    assert.deepEqual(shapes, ['16:9', '4:3', '9:16']);
  }, { provider: 'fal' });
});

test('a burst on the public health endpoint reads the queue once, and reads it again later', async () => {
  // `/api/health` is unauthenticated and on the public allow-list, and both
  // queue reads are SYNCHRONOUS on the event loop: `stats()` does one
  // readFileSync per pending entry plus three readdirSync, and `peek` walks
  // the claimed directory. `out/queue/done` and `failed` accumulate one file
  // per job forever, so the cost per hit grows monotonically for the life of
  // the deployment and never comes back down.
  //
  // `ffmpegHealth` immediately above it is already cached for exactly this
  // reason, and says so in its own comment -- a health endpoint that shells
  // out on every hit is a denial-of-service primitive somebody else operates.
  // The queue reads sitting beside it got no such cache.
  //
  // BOTH HALVES ARE ASSERTED, and the second is what stops the fix being
  // wrong in the other direction: a value cached forever is not a health
  // endpoint, it is a fossil. So the clock is moved past the window and the
  // read must happen again.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-web-'));
  const queue = fakeQueue();
  let now = new Date('2026-08-28T12:00:00Z');
  const app = createServer({
    root, cfg: CFG, queue, port: 0, auth: fakeAuth(), nowImpl: () => now,
  });
  const port = await app.listen();
  try {
    const hit = () => fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.json());

    const first = await hit();
    assert.deepEqual(Object.keys(first).sort(), ['degraded', 'ok'],
      'the cached payload must still be the real (anonymous) shape');

    for (let i = 0; i < 9; i += 1) await hit();
    assert.equal(queue.calls.statted, 1,
      `ten hits caused ${queue.calls.statted} queue.stats() reads; one client can drive this endlessly`);
    assert.equal(queue.calls.peeked, 1,
      `ten hits caused ${queue.calls.peeked} queue.peek() reads`);

    // Past the window: it is a cache, not a freeze.
    now = new Date(now.getTime() + 31_000);
    await hit();
    assert.equal(queue.calls.statted, 2, 'the queue block never refreshes, so health is permanently stale');
    assert.equal(queue.calls.peeked, 2, 'the claimed block never refreshes');
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** A signed-in cookie on a fake auth the test built itself: the full health
 *  report is answered to a session, and these tests read the full report. */
function operatorCookie(auth) {
  auth.createAccount({ email: 'ops@example.com', password: 'an operator password', plan: 'archive', credits: 0 });
  return signIn(auth, { email: 'ops@example.com', password: 'an operator password' });
}

test('health says so honestly when ffmpeg is missing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-web-'));
  const auth = fakeAuth();
  const app = createServer({
    root,
    cfg: CFG,
    queue: fakeQueue(),
    port: 0,
    auth,
    ffprobeImpl: async () => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; },
  });
  const port = await app.listen();
  try {
    const cookie = operatorCookie(auth);
    const body = await (await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { cookie } })).json();
    assert.equal(body.ok, false);
    assert.deepEqual(body.degraded, ['ffmpeg']);
    assert.equal(body.ffmpeg.available, false);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('health reports the disk, because the disk is where every balance lives', async () => {
  // The queue, the accounts, the ledger and every photograph are files under
  // one root; a full disk is the one infrastructure failure this deployment
  // can see coming, and the uptime monitor watching /api/health is the only
  // thing that will be looking.
  await withServer(async ({ base, cookieA }) => {
    const body = await (await get(base, '/api/health', cookieA)).json();
    assert.ok(Number.isFinite(body.disk?.availableBytes) && body.disk.availableBytes > 0,
      `health carries no usable disk figure: ${JSON.stringify(body.disk)}`);
    assert.ok(Number.isFinite(body.disk?.totalBytes) && body.disk.totalBytes >= body.disk.availableBytes);
    assert.equal(body.disk.low, false, 'a dev machine with free space must not read as low');
  });
});

test('low disk flips ok, and the disk is read on the cache window, not per hit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-web-'));
  let statted = 0;
  let now = new Date('2026-08-28T12:00:00Z');
  const auth = fakeAuth();
  const app = createServer({
    root,
    cfg: CFG,
    queue: fakeQueue(),
    port: 0,
    auth,
    nowImpl: () => now,
    // 512 MiB free of 40 GB: under any sane floor -- a single render writes
    // ~65 MB and the accounts must never hit ENOSPC mid-ledger-append.
    statfsImpl: () => { statted += 1; return { bavail: 131_072, blocks: 9_765_625, bsize: 4096 }; },
  });
  const port = await app.listen();
  try {
    const cookie = operatorCookie(auth);
    const hit = () => fetch(`http://127.0.0.1:${port}/api/health`, { headers: { cookie } }).then((r) => r.json());
    const body = await hit();
    assert.equal(body.disk.low, true, `512 MiB free must read as low: ${JSON.stringify(body.disk)}`);
    assert.equal(body.ok, false, 'low disk must page the uptime monitor -- ok stays true only while orders can land');
    assert.deepEqual(body.degraded, ['disk'], 'and the anonymous half of the answer names the disk');
    assert.equal(body.disk.availableBytes, 131_072 * 4096);

    // Same rule as ffmpeg and the queue beside it: an unauthenticated
    // endpoint must not do per-hit filesystem work somebody else schedules.
    for (let i = 0; i < 9; i += 1) await hit();
    assert.equal(statted, 1, `ten hits read the disk ${statted} times`);
    now = new Date(now.getTime() + 31_000);
    await hit();
    assert.equal(statted, 2, 'a cache that never refreshes is a fossil, not a health check');
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unreadable disk figure is reported, not fatal and not low', async () => {
  // statfs failing is "I cannot see the disk", which is not the same claim as
  // "the disk is full" -- paging on it would make health cry wolf on any
  // platform quirk, and the boy who cried wolf is how real pages get ignored.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-web-'));
  const auth = fakeAuth();
  const app = createServer({
    root,
    cfg: CFG,
    queue: fakeQueue(),
    port: 0,
    auth,
    statfsImpl: () => { const e = new Error('nope'); e.code = 'ENOSYS'; throw e; },
  });
  const port = await app.listen();
  try {
    const cookie = operatorCookie(auth);
    const body = await (await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { cookie } })).json();
    assert.equal(body.disk.low, null);
    assert.equal(body.disk.error, 'ENOSYS');
    assert.equal(body.ok, true, 'an unreadable statfs must not take ok down while everything else works');
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the wrong method on a real path is 405 with Allow, not 404', async () => {
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { owner: accountA });
    const res = await get(base, `/api/jobs/${job.jobId}/video`, cookieA, {}, { method: 'POST' });
    assert.equal(res.status, 405);
    assert.match(res.headers.get('allow'), /GET/);

    const opts = await get(base, `/api/jobs/${job.jobId}`, cookieA, {}, { method: 'OPTIONS' });
    assert.equal(opts.status, 204);
    assert.match(opts.headers.get('allow'), /DELETE/);
  });
});

test('an unknown path is an HTML 404 for a browser and JSON for a client', async () => {
  await withServer(async ({ base, cookieA }) => {
    const api = await get(base, '/api/nope', cookieA);
    assert.equal(api.status, 404);
    assert.match(api.headers.get('content-type'), /application\/json/);

    const browser = await get(base, '/nope', cookieA, { accept: 'text/html' });
    assert.equal(browser.status, 404);
    assert.match(browser.headers.get('content-type'), /text\/html/);
    assert.ok((await browser.text()).includes('Start again'));
  });
});

test('HEAD works wherever GET does and sends no body', async () => {
  await withServer(async ({ base, root, app, accountA, cookieA }) => {
    const job = seedJob(app, root, { owner: accountA });
    const res = await get(base, `/api/jobs/${job.jobId}`, cookieA, {}, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal((await res.text()).length, 0);
  });
});

test('the frame row offers three shapes and all three are real choices', async () => {
  await withServer(async ({ base, cookieA }) => {
    const html = await (await get(base, '/', cookieA)).text();

    // Paul, 2026-08-23: "it should only contain three options. That's it."
    for (const shape of ['4:3', '9:16', '16:9']) {
      assert.ok(html.includes(`>${shape}<`), `${shape} is offered`);
    }
    assert.ok(!html.includes('Nothing to choose here yet'), 'the placeholder sentence is gone');
    assert.ok(!html.includes('Not yet'), 'nothing is deferred any more');

    // WIDENED 2026-08-23. This asserted exactly ONE postable shape while the
    // renderer could only fill the 4:3 raster. All three now have a delivery
    // frame and the aspect is threaded from the form to the filtergraph, so
    // all three are postable. The rule underneath did not move: the number of
    // postable shapes must equal the number the renderer can actually finish,
    // and that is what this counts.
    const radios = [...html.matchAll(/<input[^>]*name="aspect"[^>]*>/g)].map((m) => m[0]);
    assert.equal(radios.length, 3, 'every offered shape is postable');
    const checked = radios.filter((r) => /checked/.test(r));
    assert.equal(checked.length, 1, 'exactly one starts selected');
    assert.match(checked[0], /value="4:3"/, 'and it is the camcorder shape -- the product premise');
  });
});

// ---------------------------------------------------------------------------
// /videos -- the tapes get a place of their own
// ---------------------------------------------------------------------------

test('GET /videos lists this account tapes and never another account tapes', async () => {
  await withServer(async ({ base, root, app, cookieA, cookieB, accountA, accountB }) => {
    const mine = seedJob(app, root, { status: 'done', place: 'my own garden', owner: accountA });
    const theirs = seedJob(app, root, { status: 'done', place: 'somebody else garden', owner: accountB });

    const res = await get(base, '/videos', cookieA);
    assert.equal(res.status, 200, 'there is no /videos page');
    const html = await res.text();

    assert.ok(html.includes(mine.jobId), 'my own finished tape is missing from my videos');
    assert.ok(!html.includes(theirs.jobId),
      'another account tape is on this page -- the shelf must be built from the ownership index');
    assert.ok(html.includes('my own garden'), 'the tape is listed without saying where it is');
  });
});

test('GET /videos is refused to somebody who is not signed in', async () => {
  await withServer(async ({ base }) => {
    // BOTH DOORS, because this app answers them differently on purpose and a
    // page listing somebody's tapes must be shut to both: a browser is sent to
    // the sign-in page, an API caller is told NOT_SIGNED_IN. Asking with the
    // wrong Accept header tests one door and reports on the other.
    const page = await get(base, '/videos', null,
      { accept: 'text/html' }, { redirect: 'manual' });
    assert.equal(page.status, 303, `a signed-out browser got ${page.status} from /videos`);
    assert.match(page.headers.get('location') ?? '', /^\/login/,
      'a signed-out browser is not sent to the sign-in page');

    const api = await get(base, '/videos', null, { accept: 'application/json' });
    assert.equal(api.status, 401, 'a signed-out API caller is not refused');
    assert.equal((await api.json()).error.code, 'NOT_SIGNED_IN');
  });
});

test('a finished tape on /videos plays in place and offers its own download', async () => {
  await withServer(async ({ base, root, app, cookieA, accountA }) => {
    // A finished tape has a poster as well as a video -- seed both, or the
    // poster assertion below measures the fixture rather than the page.
    const job = seedJob(app, root, {
      status: 'done',
      place: 'a beach',
      owner: accountA,
      result: { videoPath: 'timestamp.mp4', posterPath: 'poster.jpg' },
    });
    const html = await (await get(base, '/videos', cookieA)).text();

    // The player, and the reason preload="none" is asserted rather than assumed:
    // it is what keeps a shelf of sixty tapes costing sixty POSTERS instead of
    // sixty decoders, and it is the whole reason this can be done with no
    // JavaScript and no CSP change.
    const player = new RegExp(`<video[^>]*poster="/api/jobs/${job.jobId}/poster"[^>]*>`).exec(html);
    assert.ok(player, 'the finished tape has no player on /videos');
    assert.match(player[0], /\bcontrols\b/, 'the player has no controls, so nobody can start it');
    assert.match(player[0], /preload="none"/,
      'the player preloads, so a full shelf spins up a decoder per tape before anybody presses play');

    assert.ok(html.includes(`/api/jobs/${job.jobId}/video?download=1`),
      'the tape cannot be downloaded from the page that exists to offer it');
  });
});

test('an unfinished tape on /videos says so instead of pretending to be playable', async () => {
  await withServer(async ({ base, root, app, cookieA, accountA }) => {
    const job = seedJob(app, root, { status: 'running', place: 'a beach', owner: accountA });
    const html = await (await get(base, '/videos', cookieA)).text();

    assert.ok(html.includes(job.jobId), 'the unfinished tape is missing entirely');
    assert.ok(!new RegExp(`<video[^>]*${job.jobId}`).test(html),
      'a tape with no video yet is given a player, which can only fail when pressed');
    assert.ok(!html.includes(`/api/jobs/${job.jobId}/video?download=1`),
      'a tape with no video yet offers a download that cannot work');
  });
});

test('the signed-in nav offers My videos, and the signed-out one does not', async () => {
  await withServer(async ({ base, cookieA }) => {
    const signedIn = await (await get(base, '/pricing', cookieA)).text();
    const nav = /<nav class="nav">[\s\S]*?<\/nav>/.exec(signedIn);
    assert.ok(nav, 'the signed-in page has no nav');
    assert.match(nav[0], /href="\/videos"/, 'the nav does not reach the videos page');
    assert.match(nav[0], />My videos</, 'the nav link is not named for what it holds');

    // Signed out there is nothing behind it -- the route is gated, so a link
    // would be an invitation to a redirect.
    const signedOut = await (await get(base, '/pricing', null)).text();
    const anonNav = /<nav class="nav">[\s\S]*?<\/nav>/.exec(signedOut);
    assert.ok(anonNav, 'the signed-out page has no nav');
    assert.doesNotMatch(anonNav[0], /href="\/videos"/,
      'a signed-out visitor is offered a page that will only turn them away');
  });
});

test('the home page keeps a short strip of recent tapes and sends the rest to /videos', async () => {
  await withServer(async ({ base, root, app, cookieA, accountA }) => {
    // Six finished tapes: more than the strip should show.
    for (let i = 0; i < 6; i += 1) {
      seedJob(app, root, {
        status: 'done', place: `place ${i}`, owner: accountA,
        result: { videoPath: 'timestamp.mp4', posterPath: 'poster.jpg' },
      });
    }
    const html = await (await get(base, '/', cookieA)).text();
    const panel = /<section class="panel panel--archive">[\s\S]*?<\/section>/.exec(html);
    assert.ok(panel, 'the home page lost its archive panel');

    const tiles = [...panel[0].matchAll(/class="tape\b/g)].length;
    assert.ok(tiles > 0, 'the home page shows no recent tapes at all');
    assert.ok(tiles < 6,
      `the home page still shows all ${tiles} tapes; the strip is meant to be the recent few`);
    assert.match(panel[0], /href="\/videos"/,
      'the home strip does not offer a way to the rest of them');
  });
});

test('a tile is cropped to its own tape shape, not to the shape 4:3 tapes happen to be', async () => {
  await withServer(async ({ base, root, app, cookieA, accountA }) => {
    // THE BUG THIS CLOSES, found while mocking up /videos on 2026-08-31.
    //
    // The shelf tile is a fixed `aspect-ratio: 9 / 8` with `object-fit: cover`.
    // That number was MEASURED and is right -- for a 4:3 tape. Section 31
    // derived it from a real render: a 4:3 order is delivered 1080x1920 with
    // the picture matted inside, so rows 1-4 and 13-16 of a 16-row sample are
    // luma 0 and the content is exactly the middle half. Cropping to 9/8
    // removes the letterbox and nothing else.
    //
    // Then section 34D opened the frame menu, and nothing taught the tile. A
    // 9:16 order is delivered FULL-BLEED at 1080x1920 -- there is no letterbox
    // to remove -- so the same crop throws away more than half of a real
    // picture, and a 16:9 tape loses its sides. It is invisible today only
    // because every finished tape on this machine is 4:3.
    const wide = seedJob(app, root, {
      status: 'done', place: 'a wide one', owner: accountA, aspect: '16:9',
      result: { videoPath: 'timestamp.mp4', posterPath: 'poster.jpg' },
    });
    const tall = seedJob(app, root, {
      status: 'done', place: 'a tall one', owner: accountA, aspect: '9:16',
      result: { videoPath: 'timestamp.mp4', posterPath: 'poster.jpg' },
    });
    const html = await (await get(base, '/videos', cookieA)).text();

    const frameClassNear = (jobId) => {
      const at = html.indexOf(jobId);
      assert.ok(at > 0, `${jobId} is not on the page at all`);
      const before = html.slice(Math.max(0, at - 600), at);
      const m = [...before.matchAll(/class="frame frame--([a-z0-9-]+)"/g)].pop();
      return m ? m[1] : null;
    };

    const wideClass = frameClassNear(wide.jobId);
    const tallClass = frameClassNear(tall.jobId);
    assert.ok(wideClass, 'a 16:9 tape tile carries no shape at all');
    assert.ok(tallClass, 'a 9:16 tape tile carries no shape at all');
    assert.notEqual(wideClass, tallClass,
      `a landscape and a portrait tape are cropped identically (both "${wideClass}") -- `
      + 'one of them is losing picture');

    // AND THE CLASS MUST DO SOMETHING. A distinct class name that no rule
    // matches is the shape reaching the markup and stopping there, which reads
    // green forever while every tile is still cropped identically. Assert the
    // STYLESHEET, from the server, the way a browser gets it.
    const css = await (await get(base, '/styles.css', cookieA)).text();
    const aspectOf = (cls) => {
      const m = new RegExp(`\\.frame--${cls}\\s*\\{[^}]*aspect-ratio:\\s*([^;}]+)`).exec(css);
      return m ? m[1].trim() : null;
    };
    const wideRatio = aspectOf(wideClass);
    const tallRatio = aspectOf(tallClass);
    assert.ok(wideRatio, `the stylesheet gives .frame--${wideClass} no aspect-ratio, so the class is decorative`);
    assert.ok(tallRatio, `the stylesheet gives .frame--${tallClass} no aspect-ratio, so the class is decorative`);
    assert.notEqual(wideRatio, tallRatio,
      `landscape and portrait tiles are both ${wideRatio} -- the shape reached the markup and not the crop`);
  });
});
