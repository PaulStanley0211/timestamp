/**
 * The pages, in a real browser.
 *
 * Every UI defect this project has shipped was invisible to the markup tests
 * and found by a person looking at a screen: Sign out carried off the right
 * edge of a 375px viewport by a long email (a flex min-width default), the
 * place rail guillotining a word, an inline script silently killed by the CSP,
 * form-action cancelling a whole navigation with no error anywhere. A fetch()
 * of the HTML cannot see any of those, because they live in the layout engine
 * and the security policy enforcement -- so this file drives a real
 * Chromium through the DevTools protocol and asserts on what the engine
 * actually computed.
 *
 * ZERO npm DEPENDENCIES, like everything else here. Node 22 ships a WebSocket
 * client and Chrome speaks CDP over one; launching the browser is a spawn and
 * the protocol is JSON. No Playwright, no Puppeteer, and guards.yml stays
 * green.
 *
 * SELF-SKIPPING, same pattern as the ffmpeg tests in audio-output.test.js: no
 * Chromium-family browser on the machine means every test skips with a reason
 * rather than failing. Both CI images ship Chrome, so the suite runs there.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED: network-level noise. The landing's video
 * layer is designed to tolerate an absent or undecodable file, and the fake
 * job media here is garbage bytes on purpose, so "Failed to load resource"
 * lines are expected and meaningless. What IS collected: page exceptions,
 * console.error calls, and Content-Security-Policy refusals -- the last one
 * is the channel through which a dead inline script announces itself, and a
 * dead inline script is this product's most-repeated silent failure.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createServer } from '../scripts/web/server.mjs';
import { SESSION_COOKIE } from '../scripts/web/session-middleware.mjs';
import { createSupabaseAuth } from '../scripts/auth/supabase-auth.mjs';
import { createJob, saveJob, setJobStatus, completeJob, jobPaths } from '../scripts/render/job.mjs';

const CFG = JSON.parse(fs.readFileSync(new URL('../config/render.json', import.meta.url), 'utf8'));
const REAL_CREDITS = JSON.parse(fs.readFileSync(new URL('../config/credits.json', import.meta.url), 'utf8'));

// ---------------------------------------------------------------------------
// finding a browser
// ---------------------------------------------------------------------------

/** First Chromium-family binary that exists, or null. TIMESTAMP_BROWSER wins,
 *  so an operator with an unusual install points at it once instead of
 *  editing a test. Edge counts: it is Chromium and speaks the same protocol,
 *  and the windows-latest CI image always has it. */
function findBrowser() {
  const override = process.env.TIMESTAMP_BROWSER;
  if (override) return fs.existsSync(override) ? override : null;
  const candidates = process.platform === 'win32' ? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
  ];
  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

const BROWSER = findBrowser();
const skip = BROWSER ? false
  : 'no Chromium-family browser found -- browser smoke skipped (set TIMESTAMP_BROWSER to point at one)';

// ---------------------------------------------------------------------------
// the fakes -- copied from test/web-api.test.js per the house rule, not
// imported from it: importing a test file registers its tests in this process.
// ---------------------------------------------------------------------------

function fakeQueue() {
  const enqueued = [];
  return {
    enqueue(jobId, opts = {}) { enqueued.push(jobId); return { jobId, ...opts }; },
    peek({ state = 'pending' } = {}) { return state === 'claimed' ? [] : enqueued.map((jobId) => ({ jobId })); },
    stats() { return { pending: enqueued.length, claimed: 0, done: 0, failed: 0 }; },
  };
}

const PLANS = Object.freeze({
  free: { id: 'free', label: 'Free', monthlyUSD: 0, annualUSD: 0, creditsPerPeriod: 51 },
  shelf: { id: 'shelf', label: 'Shelf', monthlyUSD: 10, annualUSD: 100, creditsPerPeriod: 153 },
  archive: { id: 'archive', label: 'Archive', monthlyUSD: 12, annualUSD: 120, creditsPerPeriod: 204 },
});

const CREDIT_COSTS = Object.freeze({
  '480p': { resolution: '480p', width: 854, height: 480, available: true, creditsPerReference: 51 },
  '720p': { resolution: '720p', width: 1280, height: 720, available: true, creditsPerReference: 152 },
  '1080p': { resolution: '1080p', width: 1920, height: 1080, available: false, creditsPerReference: 341 },
});

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
    createAccount({ email, password, plan = 'free', credits = null }) {
      n += 1;
      const account = {
        accountId: `acct-${n}`, email, plan, password,
        credits: credits ?? PLANS[plan].creditsPerPeriod, ledger: [],
      };
      accounts.set(account.accountId, account);
      byEmail.set(String(email).toLowerCase(), account.accountId);
      return account;
    },
    findAccountByEmail({ email }) {
      const id = byEmail.get(String(email ?? '').toLowerCase());
      return id ? accounts.get(id) : null;
    },
    verifyPassword(account, password) { return account.password === password && password.length > 0; },
    loadAccount({ accountId }) {
      const account = accounts.get(accountId);
      if (!account) throw new Error(`no account ${accountId}`);
      return account;
    },
    saveAccount() {},
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
    creditCost({ resolution = '480p', seconds = 15, tier = 'standard', aspect = null } = {}) {
      const row = CREDIT_COSTS[resolution];
      if (!row || row.available === false) {
        const err = new Error(`unavailable resolution ${resolution}`);
        err.code = row ? 'RESOLUTION_UNAVAILABLE' : 'UNKNOWN_RESOLUTION';
        err.userMessage = 'That output size is not available.';
        throw err;
      }
      const shape = aspect ?? REAL_CREDITS.defaultAspect;
      const mult = shape === REAL_CREDITS.defaultAspect ? 1 : REAL_CREDITS.aspects[shape];
      if (!Number.isFinite(mult)) {
        const err = new Error(`unknown aspect ${aspect}`);
        err.code = 'UNKNOWN_ASPECT';
        err.userMessage = 'That frame shape is not available.';
        throw err;
      }
      return Math.ceil(row.creditsPerReference * (seconds / 15) * mult);
    },
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
    balanceOf(account) { return { credits: account.credits, planId: account.plan, grantedAt: null, expiresAt: null }; },
    debitCredits(account, { jobId, credits }) {
      if (account.ledger.some((e) => e.jobId === jobId && e.delta < 0)) return;
      account.credits -= credits;
      account.ledger.push({ jobId, delta: -credits });
    },
    refundCredits(account, { jobId }) {
      const spent = account.ledger.find((e) => e.jobId === jobId && e.delta < 0);
      if (!spent) return;
      account.credits += -spent.delta;
      account.ledger.push({ jobId, delta: -spent.delta });
    },
    grantCredits(account, { credits, ref }) {
      account.credits += credits;
      account.ledger.push({ ref, delta: credits });
      return { granted: true, credits: account.credits, ref };
    },
  };
}

function seedJob(app, root, { status = 'queued', owner = null } = {}) {
  const job = createJob({
    root,
    input: {
      photo: { path: 'input/upload-photo', sha256: 'x'.repeat(64) },
      place: { kind: 'text', value: 'a beach' },
      outfit: { kind: 'text', value: 'a t-shirt' },
      stillCount: 3,
      consent: { granted: true, at: new Date().toISOString(), text: 'the wording' },
    },
    provider: 'fixture',
    cfg: CFG,
  });
  if (status !== 'queued') {
    setJobStatus(job, 'running');
    if (status === 'done') completeJob(job, { videoPath: 'timestamp.mp4' });
  }
  saveJob(job);
  if (owner) app.sessions.claimJob({ accountId: owner.accountId, jobId: job.jobId });
  return job;
}

// ---------------------------------------------------------------------------
// a CDP client over node's own WebSocket -- request/response plus an event log
// ---------------------------------------------------------------------------

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.n = 0;
    this.pending = new Map();
    this.waiters = [];
    this.events = [];
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (!p) return;
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
        else p.resolve(msg.result);
        return;
      }
      this.events.push(msg);
      this.waiters = this.waiters.filter((w) => !w(msg));
    });
  }

  static async connect(url, timeoutMs = 10_000) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP connect timed out after ${timeoutMs}ms`)), timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP websocket refused')); }, { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}, timeoutMs = 15_000) {
    this.n += 1;
    const id = this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} got no answer in ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Resolves on the next event of `method` (or an already-arrived one when
   *  `sinceIndex` allows), or rejects after the timeout -- a wait that can
   *  hang is a CI job that has to be killed by hand. */
  waitFor(method, { timeoutMs = 15_000, sinceIndex = 0 } = {}) {
    const hit = this.events.slice(sinceIndex).find((e) => e.method === method);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${method} event within ${timeoutMs}ms`)), timeoutMs);
      this.waiters.push((msg) => {
        if (msg.method !== method) return false;
        clearTimeout(timer);
        resolve(msg);
        return true;
      });
    });
  }

  close() { try { this.ws.close(); } catch { /* teardown */ } }
}

// ---------------------------------------------------------------------------
// one server, one browser, shared by every test in this file
// ---------------------------------------------------------------------------

/** Over 40 characters, because the defect this guards against (§36B: Sign out
 *  carried off screen) was measured at 51px of overflow for a 33-character
 *  address at 375px -- the length is the load, not decoration. */
const LONG_EMAIL = 'a-genuinely-long-address-somebody-really-typed@example.com';
const BROKE_EMAIL = 'one-credit@example.com';

/** A real JPEG on disk, because DOM.setFileInputFiles hands the browser a
 *  PATH and the page's FileReader then reads the bytes for the preview. */
const TINY_JPG = fileURLToPath(new URL('./fixtures/showcase/tiny.jpg', import.meta.url));

let shared = null;

async function launchBrowser() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-chrome-'));
  const child = spawn(BROWSER, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--mute-audio',
    '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  // The port arrives two ways -- a stderr line and the DevToolsActivePort file
  // in the profile. Read whichever lands first; on a loaded CI machine either
  // one alone has been seen to be slow.
  const port = await new Promise((resolve, reject) => {
    let stderr = '';
    const deadline = setTimeout(() => reject(new Error(`the browser printed no DevTools port; stderr was: ${stderr.slice(0, 2000)}`)), 20_000);
    const poll = setInterval(() => {
      try {
        const file = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8');
        const p = Number(file.split(/\r?\n/)[0]);
        if (Number.isFinite(p) && p > 0) { clearTimeout(deadline); clearInterval(poll); resolve(p); }
      } catch { /* not written yet */ }
    }, 100);
    child.stderr.on('data', (d) => {
      stderr += String(d);
      const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(stderr);
      if (m) { clearTimeout(deadline); clearInterval(poll); resolve(Number(m[1])); }
    });
    child.on('exit', (code) => { clearTimeout(deadline); clearInterval(poll); reject(new Error(`the browser exited with ${code} before serving DevTools`)); });
  });

  // A page target of our own. /json/new demands PUT on current Chrome; the
  // GET spelling was removed and answers 405.
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const target = await res.json();
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  return { child, profile, cdp };
}

async function session() {
  if (shared) return shared;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-browser-'));
  const auth = fakeAuth();
  auth.createAccount({ email: LONG_EMAIL, password: 'correct horse battery', plan: 'archive', credits: 5000 });

  // A Supabase seam that EXISTS so /signup renders its real form instead of
  // the 503 degradation page, and whose transport throws so no test here can
  // quietly become a network test.
  const supabase = createSupabaseAuth({
    url: 'https://project-ref.supabase.co',
    publishableKey: 'sb_publishable_test',
    secretKey: 'sb_secret_test',
    fetchImpl: async () => { throw new Error('the browser smoke never talks to Supabase'); },
  });

  // A SHOWCASE THAT EXISTS, because the hero tape is the one thing on the
  // landing that only a real browser can prove: the markup ships a poster and
  // a data-src and nothing else, and whether a frame ever decodes is a
  // question about a script, a codec and an autoplay policy. Two tiny fixture
  // files outside the repository, mounted the way the box mounts the real
  // ones; every other test in the suite still runs with no showcase at all.
  const showcase = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-showcase-'));
  fs.copyFileSync(new URL('./fixtures/showcase/tiny.mp4', import.meta.url), path.join(showcase, 'hero-16x9.mp4'));
  fs.copyFileSync(new URL('./fixtures/showcase/tiny.jpg', import.meta.url), path.join(showcase, 'hero-16x9.jpg'));

  const app = createServer({
    root, cfg: CFG, queue: fakeQueue(), port: 0, auth, supabase,
    provider: 'fixture',
    showcaseDir: showcase,
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed',
    logImpl: () => {},
  });
  const port = await app.listen();
  const base = `http://127.0.0.1:${port}`;

  const account = auth.findAccountByEmail({ email: LONG_EMAIL });
  const { sessionId } = auth.createSession({ accountId: account.accountId });
  const cookieValue = auth.signCookie(sessionId, auth.sessionSecret());

  // A SECOND ACCOUNT THAT CANNOT AFFORD THE CHEAPEST TAPE. The fake prices
  // 480p at 51 CR, so one credit puts the order form in its refusing state --
  // the Record button rendered disabled and the reason a plain paragraph with
  // no id. That is the state the inline script has to survive, and the
  // 5000-credit account above can never put the page in it.
  const broke = auth.createAccount({ email: BROKE_EMAIL, password: 'correct horse battery', plan: 'free', credits: 1 });
  const brokeCookie = auth.signCookie(auth.createSession({ accountId: broke.accountId }).sessionId, auth.sessionSecret());

  const queued = seedJob(app, root, { status: 'queued', owner: account });
  const finished = seedJob(app, root, { status: 'done', owner: account });
  const running = seedJob(app, root, { status: 'running', owner: account });
  fs.writeFileSync(jobPaths(root, finished.jobId).video, Buffer.alloc(2048, 7));

  const { child, profile, cdp } = await launchBrowser();

  shared = {
    base, root, app, cdp, child, profile, showcase,
    account, queued, finished, running,
    async signIn() {
      await cdp.send('Network.setCookie', { name: SESSION_COOKIE, value: cookieValue, url: base });
    },
    async signInBroke() {
      await cdp.send('Network.setCookie', { name: SESSION_COOKIE, value: brokeCookie, url: base });
    },
    async signOut() {
      await cdp.send('Network.clearBrowserCookies');
    },
  };
  return shared;
}

test.after(async () => {
  if (!shared) return;
  shared.cdp.close();
  shared.child.kill();
  // The browser holds its profile open on Windows for a beat after kill;
  // force:true rm with a retry beats an EBUSY teardown failure.
  await shared.app.close();
  for (const dir of [shared.root, shared.profile, shared.showcase]) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp dir */ }
  }
});

/**
 * Page exceptions, console.error calls and CSP refusals logged since `fence`,
 * and nothing else -- §38C says why network noise is deliberately left out.
 * Shared by `visit` and by any test that acts on a page AFTER it loaded, so
 * an exception thrown by a change handler is judged by the same rule as one
 * thrown at load.
 */
function errorsSince(cdp, fence) {
  const errors = [];
  for (const e of cdp.events.slice(fence)) {
    if (e.method === 'Runtime.exceptionThrown') {
      errors.push(`exception: ${e.params.exceptionDetails?.exception?.description ?? e.params.exceptionDetails?.text}`);
    } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
      errors.push(`console.error: ${e.params.args?.map((a) => a.value ?? a.description).join(' ')}`);
    } else if (e.method === 'Log.entryAdded' && /Content Security Policy|Refused to/.test(e.params.entry?.text ?? '')) {
      errors.push(`csp: ${e.params.entry.text}`);
    }
  }
  return errors;
}

/**
 * Choose a file through a real file input, the way a person does and the way
 * no probe can: a page cannot set `input.files` itself, so the browser has to
 * do it. DOM.setFileInputFiles takes the element by objectId and dispatches
 * the same `input` and `change` events a picker dialog would.
 */
async function pickFile(cdp, selector, file) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` });
  assert.equal(exceptionDetails, undefined, `lookup threw: ${exceptionDetails?.text}`);
  assert.ok(result.objectId, `nothing on the page matches ${selector}`);
  await cdp.send('DOM.setFileInputFiles', { objectId: result.objectId, files: [file] });
  await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
}

/**
 * Navigate and report what the engine computed.
 *
 * The report is one Runtime.evaluate returning JSON, because a chatty
 * back-and-forth per selector is what makes browser tests slow and flaky.
 * `errors` carries page exceptions, console.error calls and CSP refusals
 * gathered SINCE THIS NAVIGATION -- the event log index is fenced before
 * navigating so one page's noise cannot bleed into another's verdict.
 */
async function visit(pathname, { width = 1440, height = 900, mobile = false, settleMs = 0 } = {}) {
  const { base, cdp } = await session();
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  const fence = cdp.events.length;
  const loaded = cdp.waitFor('Page.loadEventFired', { sinceIndex: fence });
  await cdp.send('Page.navigate', { url: `${base}${pathname}` });
  await loaded;
  if (settleMs) await new Promise((r) => { setTimeout(r, settleMs); });

  const errors = errorsSince(cdp, fence);

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
    assert.equal(exceptionDetails, undefined, `probe threw: ${exceptionDetails?.text} ${exceptionDetails?.exception?.description ?? ''}`);
    return result.value;
  };

  const layout = await evaluate(`({
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyOverflowX: document.body.scrollWidth - document.body.clientWidth,
    innerWidth: window.innerWidth,
    title: document.title,
  })`);

  return { errors, evaluate, layout };
}

const PHONE = { width: 375, height: 812, mobile: true };
const LAPTOP = { width: 1440, height: 900, mobile: false };

// ---------------------------------------------------------------------------
// the smoke
// ---------------------------------------------------------------------------

/**
 * ALL SIX WIDTHS, not two. The landing gained a full-bleed band, a panel with
 * a margin, a tape that hangs off that panel and a rail that bleeds past its
 * column -- four separate ways to buy a horizontal scrollbar, and the two the
 * old version checked were the two least likely to catch any of them. These
 * are the six DESIGN.md names and the six §6c measured against.
 */
test('the landing fits every one of the six widths with nothing off screen', { skip }, async () => {
  const s = await session();
  await s.signOut();
  for (const width of [320, 375, 414, 768, 1024, 1440]) {
    const page = await visit('/', { width, height: 900, mobile: width < 768 });
    assert.deepEqual(page.errors, [], `at ${width}px: ${page.errors.join('; ')}`);
    assert.ok(page.layout.overflowX <= 0, `the landing scrolls sideways by ${page.layout.overflowX}px at ${width}px`);
    assert.ok(page.layout.title.length > 0);
  }
});

/**
 * THE TAPE IS THE PAGE'S WHOLE ARGUMENT, and whether it plays is not a
 * question any markup assertion can answer. The hero ships a poster and a
 * data-src and no src at all; a frame appears only if the script ran, the CSP
 * allowed it, the browser decoded h264 and the autoplay policy accepted a
 * muted video. Every one of those is a real browser's property.
 */
test('the hero tape plays muted once the page has loaded, when a showcase file is present', { skip }, async () => {
  const s = await session();
  await s.signOut();
  const page = await visit('/', LAPTOP, { settleMs: 1500 });
  assert.deepEqual(page.errors, [], page.errors.join('; '));
  const r = await page.evaluate(`(() => {
    const v = document.querySelector('video.tape-media--hero');
    if (!v) return { missing: true };
    return { muted: v.muted, loop: v.loop, src: v.currentSrc, paused: v.paused, ready: v.readyState };
  })()`);
  assert.ok(!r.missing, 'no hero video: the shared session mounts a showcase, so a fallback image here is a defect');
  assert.ok(r.muted && r.loop, 'the hero must be muted and looping');
  assert.match(r.src, /\/showcase\/hero-16x9\.mp4$/, `the hero is playing ${r.src}`);
  assert.ok(r.ready >= 2, `the hero never decoded a frame (readyState ${r.ready})`);
  assert.equal(r.paused, false, 'the hero is not playing');
});

/**
 * THE DEMO BAND'S CLOSING BUTTON, AND WHY A STYLESHEET TEST CANNOT SEE THE
 * BUG. `.demo-cta` inherits `.navpill, .hero-cta`'s background of --on-lime,
 * which is right for a pill sitting ON the lime hero and reads as no surface
 * at all sitting on the page's own dark ground (--ground) -- the fill and the
 * ground are close enough that the pill vanishes and the section reads as a
 * bare lime word. `.demo-cta` must paint its own surface, and it must differ
 * from the page behind it to prove the fix landed rather than merely existing
 * as a declaration nothing resolves.
 */
test("the demo band's closing button has its own lime surface, not the page's ground", { skip }, async () => {
  const s = await session();
  await s.signOut();
  const page = await visit('/', LAPTOP);
  const r = await page.evaluate(`(() => {
    const btn = document.querySelector('.demo-cta');
    const probe = document.createElement('div');
    probe.style.background = 'var(--lime)';
    document.body.appendChild(probe);
    const lime = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      found: Boolean(btn),
      button: btn ? getComputedStyle(btn).backgroundColor : null,
      ground: getComputedStyle(document.body).backgroundColor,
      lime,
    };
  })()`);
  assert.ok(r.found, 'no .demo-cta on the page');
  assert.notEqual(r.button, r.ground,
    `the demo band's button is ${r.button} on a ground of ${r.ground} -- it has no surface of its own`);
  assert.equal(r.button, r.lime,
    `the demo band's button should be a lime pill (${r.lime}), painted ${r.button}`);
});

/** The FAQ rows are native <details>: no script, and the keyboard works
 *  because the browser does it. That claim is only worth making in a browser. */
test('a FAQ row opens on click and on Enter', { skip }, async () => {
  const s = await session();
  await s.signOut();
  const page = await visit('/', LAPTOP);
  const clicks = await page.evaluate(`(() => {
    const d = document.querySelector('details.faq-row');
    const sum = d.querySelector('summary');
    const before = d.open; sum.click(); const afterClick = d.open; sum.click();
    return { before, afterClick, closedAgain: !d.open };
  })()`);
  assert.deepEqual(clicks, { before: false, afterClick: true, closedAgain: true });
  await page.evaluate(`document.querySelector('details.faq-row summary').focus()`);
  await s.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await s.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.equal(await page.evaluate(`document.querySelector('details.faq-row').open`), true, 'Enter on a focused summary does not open the row');
});

test("the sign-in dialog's typed text, caret and foot links take the dialog's own ink", { skip }, async () => {
  // THE OWNER'S SCREENSHOT, 2026-09-05: "Forgot password?" and "No account
  // yet? Make a tape." as ghost text at the foot of the dialog. Measured on
  // the running page: both links, the typed email, its caret and its
  // placeholder were painted in a colour meant for a different surface --
  // about 1.06:1 on the dialog's own plate. Somebody typing their address
  // into this box could not see what they typed.
  //
  // WHY IT IS ASSERTED RELATIVELY. The rule is that everything a person reads
  // or types inside the dialog takes the SAME ink as the dialog's own title,
  // whatever that ink happens to be. That survives a change of world; a
  // literal colour would not. Read from the real cascade, because a later
  // rule of equal specificity is exactly how this went wrong the first time.
  const s = await session();
  await s.signOut();
  for (const viewport of [PHONE, LAPTOP]) {
    const page = await visit('/', viewport);
    const r = await page.evaluate(`(() => {
      const d = document.getElementById('signin');
      if (!d.open) d.showModal();
      const input = d.querySelector('#signin-email');
      input.value = 'someone@example.com';
      const title = getComputedStyle(d.querySelector('.signin-t')).color;
      const plate = getComputedStyle(d.querySelector('.signin-box')).backgroundColor;
      const ics = getComputedStyle(input);
      return {
        open: d.open, plate, title,
        input: ics.color, caret: ics.caretColor,
        links: [...d.querySelectorAll('.signin-alt a')].map((a) => ({ text: a.textContent.trim(), color: getComputedStyle(a).color })),
      };
    })()`);
    assert.ok(r.open, `the dialog did not open at ${viewport.width}px`);
    assert.equal(r.input, r.title,
      `at ${viewport.width}px the typed email is ${r.input} on ${r.plate}, not the dialog's ink ${r.title}`);
    assert.equal(r.caret, r.title, `at ${viewport.width}px the caret is ${r.caret}, invisible on ${r.plate}`);
    assert.equal(r.links.length, 2, 'the dialog should end on exactly two links');
    for (const link of r.links) {
      assert.equal(link.color, r.title,
        `at ${viewport.width}px "${link.text}" is painted ${link.color} on ${r.plate}, not the dialog's ink ${r.title}`);
    }
  }
});

test('the selection mark sits at the left of its card, in every row', { skip }, async () => {
  // THE OWNER SAW THE FRAME ROW'S DOT ON THE LEFT AND THE QUALITY ROW'S ON THE
  // RIGHT (2026-09-04) and asked for one answer everywhere: the mark on the
  // left, before the name, in the outfit grid, the place rail, the frame row
  // and the quality row alike. Measured on the painted boxes, because a
  // stylesheet test cannot see where an absolutely positioned mark ends up.
  const s = await session();
  await s.signIn();
  const page = await visit('/', LAPTOP);
  assert.deepEqual(page.errors, [], page.errors.join('; '));
  const probe = await page.evaluate(`(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
    const rows = [
      ['outfit', '.looks .lookcard', '.tick', '.name'],
      ['frame', '.frames label.framecard', '.tick', '.ratio'],
      ['quality', '.quality label.qualitycard', '.tick', '.name'],
    ].map(([row, card, mark, name]) => {
      const c = document.querySelector(card);
      if (!c) return { row, found: false };
      const m = c.querySelector(mark); const n = c.querySelector(name);
      return { row, found: Boolean(m && n), mark: m && box(m), name: n && box(n) };
    });
    const place = document.querySelector('.rail label.placecard:not(.placecard--own)');
    const badge = place && place.querySelector('.badge');
    const pc = place && box(place);
    return { rows, place: place ? { found: Boolean(badge), card: pc, badge: badge && box(badge) } : { found: false } };
  })()`);
  for (const r of probe.rows) {
    assert.ok(r.found, `the ${r.row} row has no card with a mark and a name`);
    assert.ok(r.mark.width > 0, `the ${r.row} mark paints at zero width`);
    assert.ok(r.mark.right <= r.name.left + 0.5,
      `in the ${r.row} row the mark (right edge ${r.mark.right}px) is not to the left of the name (left edge ${r.name.left}px)`);
  }
  assert.ok(probe.place.found, 'the place rail has no preset card with a badge');
  assert.ok(probe.place.badge.left < probe.place.card.left + probe.place.card.width / 2,
    `the place badge (left edge ${probe.place.badge.left}px) sits on the right half of its card (${probe.place.card.left}px to ${probe.place.card.right}px)`);
});

test('the landing sections stand apart, on the pixels rather than in the sheet', { skip }, async () => {
  // THE OWNER SAW THE MANIFESTO SENTENCE TOUCHING THE TWO CARDS UNDER IT
  // (2026-09-08). The gap measured 0.0px against the 64px `.manifesto` asks
  // for, because `.page-landing .inner` is two classes and its `padding`
  // shorthand outranked every one-class section rule on the page.
  //
  // THE SHEET GUARD IN web-static CANNOT SEE THIS and that is why both exist:
  // it pins the shape of one rule, and a later rule of higher specificity
  // would sail past it exactly as this one sailed past `.manifesto`. What a
  // reader actually meets is the distance between two painted boxes.
  // BOTH ENDS ARE CONTENT, NEVER A SECTION BOX. A section's own padding lives
  // INSIDE its box, so `.how2` to `.band` reads 0px whether the rhythm is
  // there or not -- the padding is under the section's own bottom edge. The
  // cards and the sentence are what a reader actually sees the distance
  // between, so those are what is measured.
  const pairs = [
    ['the manifesto sentence', '.manifesto-line', 'the two cards below it', '.how-card'],
    ['the last of the two cards', '.how2 .how-card:last-of-type', 'the place band', '.band'],
  ];
  // SIGNED OUT, OR `/` IS THE ORDER FORM AND NONE OF THIS EXISTS. The browser
  // session is shared across this whole file, so a test that signed in earlier
  // leaves the cookie behind and `/` renders `homePage`. Passing in isolation
  // and failing in the suite is the tell, and it is what happened here.
  const s = await session();
  await s.signOut();
  for (const viewport of [LAPTOP, PHONE]) {
    const page = await visit('/', viewport);
    assert.deepEqual(page.errors, [], page.errors.join('; '));
    const probe = await page.evaluate(`(() => {
      const bottom = (sel) => { const e = document.querySelector(sel); return e && e.getBoundingClientRect().bottom; };
      const top = (sel) => { const e = document.querySelector(sel); return e && e.getBoundingClientRect().top; };
      return ${JSON.stringify(pairs)}.map(([aName, a, bName, b]) => ({
        aName, bName, found: bottom(a) !== null && top(b) !== null, gap: top(b) - bottom(a),
      }));
    })()`);
    for (const r of probe) {
      assert.ok(r.found, `${r.aName} or ${r.bName} is not on the landing page at all`);
      assert.ok(r.gap >= 32,
        `at ${viewport.width}px ${r.aName} and ${r.bName} are ${r.gap.toFixed(1)}px apart -- they read as one block`);
    }
  }
});

test('the frame row stays on one line wherever its panel is at full width', { skip }, async () => {
  // THE OWNER SAW 9:16 SITTING UNDER 4:3 AND 16:9 ON A LAPTOP (2026-09-08) and
  // asked for the three shapes in a straight line. It was not a narrow-screen
  // wrap: `.panel--commit` is capped at 640px, so the row has 590px of usable
  // width at EVERY viewport above the cap, and the three cards plus their two
  // gaps measured 601.1px -- over by 11.1px, at 375px and at 2560px alike.
  //
  // What pushed it over was one label. "The camcorder shape" is 124.6px at the
  // label size against "Widescreen" at 67.7 and "Phone" at 36, and it is also
  // the one the hint paragraph below already explains in full. The three read
  // as a parallel set of single words now, and the row has ~50px to spare.
  //
  // MEASURED ON THE PAINTED BOXES, because the wrap is arithmetic no markup
  // assertion can see: every card is present and correct in the HTML whether
  // the row is one line or three. The tops are what say which.
  const s = await session();
  await s.signIn();
  for (const viewport of [LAPTOP, { width: 1024, height: 800, mobile: false }]) {
    const page = await visit('/', viewport);
    assert.deepEqual(page.errors, [], page.errors.join('; '));
    const probe = await page.evaluate(`(() => {
      const row = document.querySelector('.frames');
      const cards = [...row.children];
      const tops = cards.map((c) => Math.round(c.getBoundingClientRect().top));
      const style = getComputedStyle(row);
      const gap = parseFloat(style.columnGap) || 0;
      const content = cards.reduce((n, c) => n + c.getBoundingClientRect().width, 0) + gap * (cards.length - 1);
      return {
        cards: cards.length,
        lines: [...new Set(tops)].length,
        available: row.getBoundingClientRect().width,
        content,
        labels: cards.map((c) => (c.querySelector('.detail') || c.querySelector('.flag') || { textContent: '' }).textContent),
      };
    })()`);
    // Anti-vacuity: a row that lost its cards has one line trivially.
    assert.ok(probe.cards >= 3, `the frame row has ${probe.cards} cards, so "one line" proves nothing`);
    assert.equal(probe.lines, 1,
      `at ${viewport.width}px the ${probe.cards} frame cards sit on ${probe.lines} lines -- `
      + `${probe.content.toFixed(1)}px of cards and gaps in ${probe.available.toFixed(1)}px of row `
      + `(labels: ${probe.labels.join(' / ')})`);
    assert.ok(probe.available - probe.content >= 24,
      `at ${viewport.width}px the row fits with only ${(probe.available - probe.content).toFixed(1)}px to spare, `
      + 'which a font fallback would swallow');
  }
});

test('the archive label sits in its gutter and never runs into the heading', { skip }, async () => {
  // THE OWNER SAW "ARCHIVE" PRINTED THROUGH "Your tapes" (2026-09-04). The
  // archive header borrows the step header's grid, whose gutter is a fixed
  // width sized for the word STEP and a two-digit numeral; ARCHIVE is seven
  // letters at the same size and tracking and overflowed the gutter into the
  // heading column. Only a layout engine can see an overflow, so it is
  // measured here: the label's right edge must stop before the heading's
  // left edge, at both widths.
  const s = await session();
  await s.signIn();
  for (const viewport of [PHONE, LAPTOP]) {
    const page = await visit('/', viewport);
    assert.deepEqual(page.errors, [], page.errors.join('; '));
    // THE GLYPHS, NOT THE BOX. The label's own rect is the gutter it was given,
    // and that never overlaps anything; the first version of this test
    // measured it and passed against the broken page. A Range over the text
    // returns the box the letters actually paint in, which is what the owner
    // saw run into the heading.
    const probe = await page.evaluate(`(() => {
      const k = document.querySelector('.panel--archive .stepno-k');
      const t = document.querySelector('.panel--archive .title');
      if (!k || !t) return { found: false };
      const range = document.createRange();
      range.selectNodeContents(k);
      const kr = range.getBoundingClientRect();
      const tr = t.getBoundingClientRect();
      return { found: true, textRight: kr.right, textWidth: kr.width, boxWidth: k.getBoundingClientRect().width,
        headingLeft: tr.left, overlap: kr.right > tr.left && kr.bottom > tr.top && kr.top < tr.bottom };
    })()`);
    assert.ok(probe.found, 'the archive header lost its label or its heading');
    assert.ok(probe.textWidth > 0, 'the label paints at zero width');
    assert.ok(probe.textWidth <= probe.boxWidth + 0.5,
      `at ${viewport.width}px the label's text (${probe.textWidth}px) is wider than the gutter it sits in (${probe.boxWidth}px)`);
    assert.ok(!probe.overlap,
      `at ${viewport.width}px the archive label (text right edge ${probe.textRight}px) runs into the heading (left edge ${probe.headingLeft}px)`);
  }
});

test('the Recommended flag stays inside the card it flags, at every width', { skip }, async () => {
  // THE SAME SHAPE AS THE ARCHIVE LABEL ABOVE, one page over. `.tier-name` is a
  // flex row -- the pack's name, then the flag -- and in the three-column grid
  // the lime card is 219px wide while the name and a 126px chip need 223px. The
  // row does not shrink, so the chip ran 16px past the card's right edge and
  // `.lime`'s own `overflow: hidden` sliced it: the owner's first screenshot
  // read "RECOMMENDEI".
  //
  // MEASURED HERE BECAUSE ONLY A LAYOUT ENGINE CAN SEE IT. Every markup test in
  // the suite passes on a page whose flag is cut in half, and the widths that
  // break it are exactly the ones where the grid is three columns -- so a phone
  // check alone would have reported it fixed.
  const s = await session();
  await s.signOut();
  for (const viewport of [PHONE, { width: 1024, height: 900, mobile: false }, LAPTOP]) {
    const page = await visit('/pricing', viewport);
    assert.deepEqual(page.errors, [], page.errors.join('; '));
    const probe = await page.evaluate(`(() => {
      const card = document.querySelector('.tier--lime');
      const mark = card && card.querySelector('.mark');
      if (!card || !mark) return { found: false };
      const range = document.createRange();
      range.selectNodeContents(mark);
      const t = range.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const b = mark.getBoundingClientRect();
      return { found: true, text: mark.textContent.trim(),
        textRight: Math.round(t.right), textWidth: Math.round(t.width),
        boxRight: Math.round(b.right), cardRight: Math.round(c.right),
        cardWidth: Math.round(c.width) };
    })()`);
    assert.ok(probe.found, 'the recommended pack lost its card or its flag');
    assert.ok(probe.textWidth > 0, 'the flag paints at zero width');
    assert.ok(probe.textRight <= probe.cardRight,
      `at ${viewport.width}px the flag's text ends at ${probe.textRight}px, past the ${probe.cardWidth}px card's right edge at ${probe.cardRight}px -- it is being cut off`);
    assert.ok(probe.boxRight <= probe.cardRight + 0.5,
      `at ${viewport.width}px the flag's box ends at ${probe.boxRight}px, past the card's right edge at ${probe.cardRight}px`);
  }
});

test('a long email cannot carry Sign out off a phone screen', { skip }, async () => {
  // §36B, re-measured in the engine that found it: the fix was min-width on
  // TWO nested flex items, and a markup test can never see either of them.
  const s = await session();
  await s.signIn();
  const page = await visit('/pricing', PHONE);
  assert.deepEqual(page.errors, [], page.errors.join('; '));
  assert.ok(page.layout.bodyOverflowX <= 0,
    `the body scrolls sideways by ${page.layout.bodyOverflowX}px with a ${LONG_EMAIL.length}-char email at 375px`);
  const nav = await page.evaluate(`(() => {
    const el = [...document.querySelectorAll('a,button')].find((a) => /sign out/i.test(a.textContent));
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, right: r.right, width: r.width };
  })()`);
  assert.ok(nav.found, 'the signed-in nav must offer Sign out');
  assert.ok(nav.width > 0, 'Sign out is rendered at zero size');
  assert.ok(nav.right <= 375 + 1, `Sign out ends at x=${nav.right}, off a 375px screen`);
});

test('the signed-in nav sits on one line -- Sign out included', { skip }, async () => {
  // A LAYOUT FAULT NO MARKUP TEST CAN SEE, and the cause is one declaration.
  //
  // Sign out is a <button> inside a <form>, because signing out is a POST and
  // must not be a link a foreign page can follow. That form is what the nav
  // lays out, not the button -- and `.nav-form { display: inline }` is
  // BLOCKIFIED by the flex container into `display: block`, so the form becomes
  // a block box whose line box carries the INHERITED 16px strut while the
  // button inside it is 12px. Measured before the fix: the links were 19.19px
  // tall, the form 25.59px, and Sign out sat 1.8px BELOW Plans and Account --
  // small, and plainly visible on 12px uppercase type with 0.14em tracking,
  // which is what the owner reported on 2026-08-31.
  //
  // The assertion is on the BOX, not the baseline: every control in this row
  // shares a font-size and a line-height, so equal tops is equal baselines, and
  // a top is measurable without a font metric.
  const s = await session();
  await s.signIn();
  const page = await visit('/pricing', LAPTOP);
  assert.deepEqual(page.errors, [], page.errors.join('; '));

  const row = await page.evaluate(`(() => {
    const nav = document.querySelector('.nav');
    if (!nav) return { found: false };
    const controls = [...nav.querySelectorAll('a, button')];
    if (controls.length < 2) return { found: false };
    return {
      found: true,
      items: controls.map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent.trim(), top: r.top, height: r.height };
      }),
    };
  })()`);

  assert.ok(row.found, 'the signed-in nav must render its controls');
  const out = row.items.find((i) => /sign out/i.test(i.text));
  assert.ok(out, 'the signed-in nav must offer Sign out');

  const tops = row.items.map((i) => i.top);
  const spread = Math.max(...tops) - Math.min(...tops);
  assert.ok(spread <= 0.5,
    `the nav controls do not share a line -- ${spread.toFixed(2)}px of spread across `
    + row.items.map((i) => `${JSON.stringify(i.text)}@${i.top.toFixed(2)}`).join(', '));

  // And the form must not be taller than the control it wraps, which is the
  // mechanism rather than the symptom: a form with its own strut re-introduces
  // the offset the moment anything else is added to this row.
  const heights = row.items.map((i) => i.height);
  const hSpread = Math.max(...heights) - Math.min(...heights);
  assert.ok(hSpread <= 0.5,
    `the nav controls are not the same height -- ${hSpread.toFixed(2)}px apart`);
});

test('the app form is usable at phone width, and its consent gate is big enough to hit', { skip }, async () => {
  const s = await session();
  await s.signIn();
  const page = await visit('/', PHONE);
  assert.deepEqual(page.errors, [], page.errors.join('; '));
  assert.ok(page.layout.bodyOverflowX <= 0, `sideways scroll of ${page.layout.bodyOverflowX}px on the app form`);
  const probes = await page.evaluate(`(() => {
    const check = document.querySelector('.check input');
    const r = check ? check.getBoundingClientRect() : null;
    return {
      hasForm: Boolean(document.querySelector('form')),
      checkW: r ? r.width : 0,
      checkH: r ? r.height : 0,
    };
  })()`);
  assert.ok(probes.hasForm, 'the signed-in page must carry the order form');
  // WCAG 2.2 SC 2.5.8 asks 24x24 CSS px, and this control gates both signup
  // and spending -- §6b fixed it once; this keeps it fixed in a real engine.
  assert.ok(probes.checkW >= 24 && probes.checkH >= 24,
    `the consent checkbox measures ${probes.checkW}x${probes.checkH}, under the 24x24 target minimum`);
});

/**
 * THE ONE ASSERTION A MARKUP TEST CANNOT MAKE ABOUT THIS CHANGE.
 *
 * Step 3 leads with your own place because of TWO layers that have to compose:
 * the pl-own radio carries `checked`, and the stylesheet reveals `.ownplace`
 * through `#pl-own:checked ~ .wrap`. A fetch() test can see the attribute and
 * can see the rule, and neither tells you the block actually paints -- §36B
 * records a regression test going green while the page was still broken for
 * exactly that reason, because the fix needed two layers and the test asserted
 * one.
 *
 * So this measures pixels: width, height, and where the thing lands down the
 * document against the rail. Reading `top` in document space rather than DOM
 * order is the point -- a CSS `order` or a float could put the markup first and
 * the paint last, and the customer sees the paint.
 */
test('step 3 opens on the own-place upload and text box, painted above the presets', { skip }, async () => {
  const s = await session();
  await s.signIn();
  const page = await visit('/', PHONE);
  assert.deepEqual(page.errors, [], page.errors.join('; '));
  const probes = await page.evaluate(`(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, top: r.top + window.scrollY };
    };
    return {
      upload: box('input[name="placePhoto"]'),
      text: box('input[name="placeText"]'),
      rail: box('.rail'),
    };
  })()`);

  assert.ok(probes.upload, 'no place-photo upload on the signed-in page');
  assert.ok(probes.text, 'no place free-text box on the signed-in page');
  assert.ok(probes.rail, 'no preset rail on the signed-in page');

  assert.ok(probes.upload.w > 0 && probes.upload.h > 0,
    'the place upload is in the markup but paints at zero size -- display:none passes every fetch() test, and that is the whole failure this change is undoing');
  assert.ok(probes.text.w > 0 && probes.text.h > 0,
    'the free-text box is in the markup but paints at zero size');
  assert.ok(probes.upload.top < probes.rail.top,
    `the upload paints at ${probes.upload.top}px and the rail at ${probes.rail.top}px -- the presets are still the first thing in step 3`);
});

test('the own-place card in the rail is a live control in both states', { skip }, async () => {
  // A MARKUP TEST CANNOT SEE A DEAD CONTROL, which is how this shipped. The
  // rail's own-place card was a <label for="pl-own"> and §43 made pl-own
  // checked on load, so in the state every visitor arrives in it pointed at a
  // radio that was already selected: clicking it changed nothing and moved
  // nothing, and the owner reported exactly that -- "there is no response".
  // Every fetch() test in the suite passed the whole time, because the label
  // and its `for` were both present and both correct.
  //
  // So this asserts what a person can actually DO: exactly one own-place card
  // is painted, and the control it points at is the one that is useful in the
  // state the page is currently in. Then it clicks a preset and checks the pair
  // swaps back, because a card that only works on arrival is half a fix.
  const s = await session();
  await s.signIn();
  const page = await visit('/', PHONE);
  assert.deepEqual(page.errors, [], page.errors.join('; '));

  const read = `(() => {
    const shown = [...document.querySelectorAll('.rail .placecard--own')]
      .filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
    return {
      count: shown.length,
      cls: shown.map((el) => el.className),
      target: shown.map((el) => el.getAttribute('for')),
      targetExists: shown.map((el) => Boolean(document.getElementById(el.getAttribute('for')))),
      checked: (document.querySelector('#pl-own') || {}).checked,
    };
  })()`;

  const onArrival = await page.evaluate(read);
  assert.equal(onArrival.checked, true, 'the page no longer opens on your own place');
  assert.equal(onArrival.count, 1,
    `the rail paints ${onArrival.count} own-place cards; exactly one slot is the contract the dots count on`);
  assert.match(onArrival.cls[0], /placecard--own-add/,
    'the card showing on arrival is the one for a radio that is already checked -- clicking it does nothing');
  assert.equal(onArrival.target[0], 'placePhoto',
    `the visible own-place card points at ${JSON.stringify(onArrival.target[0])}, not the upload`);
  assert.equal(onArrival.targetExists[0], true,
    'the visible own-place card points at an id that is not on the page, so clicking it does nothing at all');

  // Now leave own place, exactly as a person does: click a preset card.
  const preset = await page.evaluate(`(() => {
    const card = document.querySelector('.rail .placecard:not(.placecard--own)');
    if (!card) return { clicked: false };
    card.click();
    return { clicked: true };
  })()`);
  assert.ok(preset.clicked, 'the rail has no preset card to leave your own place with');

  const onPreset = await page.evaluate(read);
  assert.equal(onPreset.checked, false, 'clicking a preset card did not leave your own place');
  assert.equal(onPreset.count, 1,
    `with a preset chosen the rail paints ${onPreset.count} own-place cards, not one`);
  assert.match(onPreset.cls[0], /placecard--own-pick/,
    'with a preset chosen the rail offers the upload rather than the way back, so there is no way back');
  assert.equal(onPreset.target[0], 'pl-own',
    `the way back points at ${JSON.stringify(onPreset.target[0])}, which does not reselect your own place`);
});

/**
 * A PAGE THAT REFUSES THE ORDER MUST STILL REFUSE IT AFTER A PHOTO IS CHOSEN.
 *
 * When the balance cannot afford the cheapest tape, homePage renders the
 * Record button disabled and the refusal as a plain `<p class="reason">` with
 * no id. The inline script's change handler was written for the other page:
 * it re-enabled the button and wrote into `#reason`, which is null here. A
 * person with too few credits who chose a photo therefore watched the button
 * light up -- the server still refuses, so no money moved, but the page said
 * yes and then the handler threw, and every markup test passed the whole time
 * because the button and the paragraph are both present and both correct.
 * Only a browser can dispatch the change event and see what the script does.
 */
test('choosing a photo on a page that cannot afford a tape leaves the button disabled and throws nothing', { skip }, async () => {
  const s = await session();
  await s.signInBroke();
  const page = await visit('/', LAPTOP);
  assert.deepEqual(page.errors, [], page.errors.join('; '));

  // The precondition first, so this cannot pass on a page that was never
  // refusing: the button is disabled, the reason names the credits, and the
  // reason has NO id -- the exact shape the handler has to survive.
  const before = await page.evaluate(`(() => {
    const record = document.getElementById('record');
    return {
      hasRecord: Boolean(record),
      disabled: record ? record.disabled : null,
      reasonById: Boolean(document.getElementById('reason')),
      reasons: [...document.querySelectorAll('.reason')].map((p) => p.textContent).join(' | '),
    };
  })()`);
  assert.ok(before.hasRecord, 'the signed-in page must carry the Record button');
  assert.equal(before.disabled, true, 'a one-credit account arrived at an enabled Record button');
  assert.match(before.reasons, /Not enough credits/,
    `the page is not in its refusing state; the reasons read: ${before.reasons}`);
  assert.equal(before.reasonById, false,
    'the refusal now carries id="reason", so this test no longer exercises the null the handler met');

  const fence = s.cdp.events.length;
  await pickFile(s.cdp, '#photo', TINY_JPG);
  const after = await page.evaluate(`(() => ({
    disabled: document.getElementById('record').disabled,
    named: (document.getElementById('photo-name') || {}).textContent,
  }))()`);

  // The handler ran -- otherwise the assertion below is vacuous.
  assert.equal(after.named, path.basename(TINY_JPG),
    'the change handler never ran, so nothing below is evidence of anything');
  // One assertion over both halves, so a failure shows the re-enabled button
  // AND the exception side by side rather than whichever comes first.
  assert.deepEqual(
    { disabled: after.disabled, errors: errorsSince(s.cdp, fence) },
    { disabled: true, errors: [] },
    'choosing a photo must leave a button the page disabled for want of credits disabled, and throw nothing',
  );

  // THE OTHER ARM OF THE SAME BUG. Choosing a photo reveals Remove; pressing
  // it runs forget(), which used to write the reason back BY ID -- the same
  // null, one click later. `hidden` is the proof the handler ran: show() had
  // just revealed the preview, so a Remove that did nothing leaves it showing.
  const fence2 = s.cdp.events.length;
  await page.evaluate(`document.getElementById('photo-clear').click()`);
  const cleared = await page.evaluate(`(() => ({
    disabled: document.getElementById('record').disabled,
    named: document.getElementById('photo-name').textContent,
    hidden: document.getElementById('picked').hidden,
  }))()`);
  assert.deepEqual(
    { ...cleared, errors: errorsSince(s.cdp, fence2) },
    { disabled: true, named: '', hidden: true, errors: [] },
    'Remove must clear the photo, leave the refused button disabled, and throw nothing',
  );
});

/**
 * And the page that CAN afford a tape still opens the button on a photo --
 * the fix above must not become "disabled forever". Same event, same script,
 * the other rendered state.
 */
test('choosing a photo on a page that can afford a tape enables the button and clears the reason', { skip }, async () => {
  const s = await session();
  await s.signIn();
  const page = await visit('/', LAPTOP);
  assert.deepEqual(page.errors, [], page.errors.join('; '));

  const before = await page.evaluate(`(() => ({
    disabled: document.getElementById('record').disabled,
    reason: (document.getElementById('reason') || {}).textContent,
  }))()`);
  assert.equal(before.disabled, true, 'with scripting on, the button waits for a photo');
  assert.equal(before.reason, 'Upload a photo first');

  const fence = s.cdp.events.length;
  await pickFile(s.cdp, '#photo', TINY_JPG);
  const after = await page.evaluate(`(() => ({
    disabled: document.getElementById('record').disabled,
    reason: (document.getElementById('reason') || {}).textContent,
    named: (document.getElementById('photo-name') || {}).textContent,
  }))()`);
  assert.equal(after.named, path.basename(TINY_JPG), 'the change handler never ran');
  assert.equal(after.disabled, false, 'a paying account chose a photo and the button stayed disabled');
  assert.equal(after.reason, '', `the reason under an enabled button still reads ${JSON.stringify(after.reason)}`);
  const errors = errorsSince(s.cdp, fence);
  assert.deepEqual(errors, [], errors.join('; '));

  // And Remove takes the page back to where it started: the button waits for
  // a photo again and the reason says so.
  const fence2 = s.cdp.events.length;
  await page.evaluate(`document.getElementById('photo-clear').click()`);
  const cleared = await page.evaluate(`(() => ({
    disabled: document.getElementById('record').disabled,
    reason: (document.getElementById('reason') || {}).textContent,
    named: document.getElementById('photo-name').textContent,
    hidden: document.getElementById('picked').hidden,
  }))()`);
  assert.deepEqual(
    { ...cleared, errors: errorsSince(s.cdp, fence2) },
    { disabled: true, reason: 'Upload a photo first', named: '', hidden: true, errors: [] },
    'Remove must clear the photo, disable the button again, restore the reason, and throw nothing',
  );
});

test('after a selection, lime is on exactly one card in each option row, and it is the one chosen', { skip }, async () => {
  // Spec §8's named browser test. The stylesheet-text tests above prove the
  // generated rule exists; only a cascade can prove that exactly ONE card in a
  // row resolves to lime after a click -- a selector typo that matched every
  // card, or a later rule of equal specificity, passes every text assertion.
  const s = await session();
  await s.signIn();
  const page = await visit('/', LAPTOP);
  assert.deepEqual(page.errors, [], page.errors.join('; '));
  const r = await page.evaluate(`(() => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--lime)';
    document.body.appendChild(probe);
    const lime = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const rows = { look: '.looks label.lookcard', quality: '.quality label.qualitycard', frame: '.frames label.framecard' };
    const out = { lime };
    for (const [row, sel] of Object.entries(rows)) {
      const cards = [...document.querySelectorAll(sel)];
      const target = cards[cards.length - 1];
      target.click();
      const lit = cards.filter((c) => getComputedStyle(c).backgroundColor === lime);
      out[row] = { cards: cards.length, lit: lit.length, litIsTarget: lit.length === 1 && lit[0] === target,
        inkOnLime: getComputedStyle(target.querySelector('.name, .ratio')).color };
    }
    const places = [...document.querySelectorAll('.rail label.placecard:not(.placecard--own)')];
    places[1].click();
    const ringed = places.filter((p) => getComputedStyle(p).boxShadow.includes(lime));
    out.place = { cards: places.length, ringed: ringed.length, ringedIsTarget: ringed.length === 1 && ringed[0] === places[1],
      badge: getComputedStyle(places[1].querySelector('.badge')).backgroundColor };
    return out;
  })()`);
  for (const row of ['look', 'quality', 'frame']) {
    assert.ok(r[row].cards >= 2, `${row}: fewer than two cards to choose between`);
    assert.equal(r[row].lit, 1, `${row}: ${r[row].lit} cards are lime after one choice`);
    assert.ok(r[row].litIsTarget, `${row}: the lime card is not the one that was clicked`);
    assert.notEqual(r[row].inkOnLime, r.lime, `${row}: the chosen card's text is lime on lime`);
  }
  assert.equal(r.place.ringed, 1, `${r.place.ringed} place cards carry the lime ring after one choice`);
  assert.ok(r.place.ringedIsTarget, 'the ringed place is not the one that was clicked');
  assert.equal(r.place.badge, r.lime, 'the chosen place badge is not a lime pill');
});

test('/videos paints a real player for a finished tape, and fits a phone', { skip }, async () => {
  // WHAT ONLY A LAYOUT ENGINE CAN SAY. A markup test can see a <video> tag; it
  // cannot see whether the element has a box, whether the CSP let the media
  // through, or whether the page it sits on scrolls sideways on a phone. Every
  // one of those has shipped broken in this project before.
  const s = await session();
  await s.signIn();
  const page = await visit('/videos', PHONE);
  assert.deepEqual(page.errors, [], page.errors.join('; '));
  assert.ok(page.layout.bodyOverflowX <= 0,
    `/videos scrolls sideways by ${page.layout.bodyOverflowX}px at 375px`);

  const probe = await page.evaluate(`(() => {
    const v = document.querySelector('.shelf video');
    if (!v) return { found: false };
    const r = v.getBoundingClientRect();
    const dl = document.querySelector('.shelf a.dl');
    return {
      found: true,
      w: r.width, h: r.height,
      preload: v.getAttribute('preload'),
      controls: v.hasAttribute('controls'),
      // readyState 0 with preload="none" is the POINT: nothing has been
      // fetched, so a full shelf costs posters rather than decoders.
      readyState: v.readyState,
      dlHref: dl ? dl.getAttribute('href') : null,
      dlVisible: dl ? dl.getBoundingClientRect().width > 0 : false,
    };
  })()`);

  assert.ok(probe.found, 'no player on /videos at all');
  assert.ok(probe.w > 0 && probe.h > 0,
    'the player is in the markup but paints at zero size -- which every fetch() test would call a pass');
  assert.equal(probe.controls, true, 'the player has no controls, so nobody can start it');
  assert.equal(probe.preload, 'none', 'the player preloads');
  assert.equal(probe.readyState, 0,
    `preload="none" is set but the browser fetched anyway (readyState ${probe.readyState})`);
  assert.ok(probe.dlVisible, 'the download link paints at zero size');
  assert.match(probe.dlHref ?? '', /\/video\?download=1$/,
    `the download link points at ${probe.dlHref}, which is not the attachment URL`);
});

test('the status page runs its poller under the CSP the server really sends', { skip }, async () => {
  const s = await session();
  await s.signIn();
  // 2.6s is one full poll interval plus slack: the assertion is that a real
  // fetch()-and-paint cycle ran without an exception, not just that the
  // script was admitted at load.
  const page = await visit(`/j/${s.queued.jobId}`, { ...PHONE, settleMs: 2_600 });
  assert.deepEqual(page.errors, [],
    `a refused or throwing inline script is exactly the silent failure this test exists for: ${page.errors.join('; ')}`);
  const probes = await page.evaluate(`(() => ({
    cancel: Boolean(document.getElementById('cancel')),
    counter: (document.getElementById('counter') || {}).textContent || '',
  }))()`);
  assert.ok(probes.cancel, 'the status page must offer cancellation');
  assert.match(probes.counter, /of \d+/, 'the step counter is not painted');
});

test('the record light on the phase being filmed is red and blinking, in a real cascade', { skip }, async () => {
  const s = await session();
  await s.signIn();
  const page = await visit(`/j/${s.running.jobId}`, PHONE);
  assert.deepEqual(page.errors, [], page.errors.join('; '));
  const r = await page.evaluate(`(() => {
    const dot = document.querySelector('.reclight .dot');
    if (!dot) return { found: false };
    const probe = document.createElement('div');
    probe.style.background = 'var(--rec)';
    document.body.appendChild(probe);
    const rec = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const cs = getComputedStyle(dot);
    const phase = dot.closest('.phase');
    const pcs = getComputedStyle(phase);
    return {
      found: true, rec,
      background: cs.backgroundColor, animation: cs.animationName,
      border: pcs.borderTopWidth + ' ' + pcs.borderTopStyle,
      phases: document.querySelectorAll('.phase').length,
      lights: document.querySelectorAll('.reclight').length,
    };
  })()`);
  assert.ok(r.found, 'a running job shows no record light');
  assert.equal(r.background, r.rec, `the lamp is ${r.background}, not the record-light red ${r.rec}`);
  assert.equal(r.animation, 'tally', `the lamp is not blinking (animation "${r.animation}")`);
  assert.equal(r.border, '1px solid', `the phase row is not an outlined card (${r.border})`);
  assert.equal(r.phases, 3);
  assert.equal(r.lights, 1, 'more than one phase carries the record light');
});

test('the result page shows the tape and says it is AI-generated', { skip }, async () => {
  const s = await session();
  await s.signIn();
  const page = await visit(`/j/${s.finished.jobId}/result`, PHONE);
  assert.deepEqual(page.errors, [], page.errors.join('; '));
  const probes = await page.evaluate(`(() => {
    const video = document.querySelector('video');
    const disclosure = [...document.querySelectorAll('p')].find((p) => p.textContent.includes('Made with AI'));
    const r = disclosure ? disclosure.getBoundingClientRect() : null;
    const download = [...document.querySelectorAll('a')].find((a) => /download/i.test(a.textContent));
    return {
      video: Boolean(video),
      disclosureVisible: Boolean(r && r.height > 0 && r.width > 0),
      download: Boolean(download),
    };
  })()`);
  assert.ok(probes.video, 'no player on the result page');
  assert.ok(probes.disclosureVisible,
    'the AI disclosure must be VISIBLE, not merely present in the markup -- display:none would pass every fetch() test');
  assert.ok(probes.download, 'no download link on the result page');
});

test('the signup page renders its real form on a phone', { skip }, async () => {
  const s = await session();
  await s.signOut();
  const page = await visit('/signup', PHONE);
  assert.deepEqual(page.errors, [], page.errors.join('; '));
  assert.ok(page.layout.bodyOverflowX <= 0, `sideways scroll of ${page.layout.bodyOverflowX}px on signup`);
  const probes = await page.evaluate(`(() => {
    const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return {
      email: vis(document.querySelector('input[name="email"]')),
      password: vis(document.querySelector('input[name="password"]')),
      submit: vis(document.querySelector('button[type="submit"], input[type="submit"]')),
    };
  })()`);
  assert.ok(probes.email, 'no visible email field -- if this is the 503 degradation page, the fake Supabase seam is not reaching the server');
  assert.ok(probes.password, 'no visible password field');
  assert.ok(probes.submit, 'no visible submit control');
});

/**
 * THE ONE ASSERTION IN THIS REPOSITORY THAT CAN SEE THE WIPE ACTUALLY MOVE.
 *
 * `clip-path` DOES NOT CHANGE LAYOUT. A clipped element's
 * `getBoundingClientRect()` is its unclipped box, so every rect-reading probe
 * returns the same numbers whether the wipe is at 5% or 95% -- section 60F's
 * trap, where a layout test passed over an overflow that was plain on the
 * screen. What moves is the resolved `clip-path`, so that is what is read,
 * out of the real cascade in a real browser under the real CSP.
 *
 * WHICH MAKES THIS THE CSP CHANNEL TOO. The control is script-created; if the
 * fifth hash were missing from `INLINE_SCRIPT_HASHES`, Chrome would refuse the
 * script, the range input would never exist, and this goes red at the first
 * assertion rather than shipping a landing page whose demonstration is frozen.
 */
test('the landing before/after wipe is draggable, and its two halves are aligned', { skip }, async () => {
  const s = await session();
  await s.signOut();
  for (const viewport of [PHONE, LAPTOP]) {
    const page = await visit('/', viewport);
    assert.deepEqual(page.errors, [], `at ${viewport.width}px: ${page.errors.join('; ')}`);

    const r = await page.evaluate(`(() => {
      const fig = document.querySelector('figure.wipe');
      if (!fig) return { missing: 'figure.wipe' };
      const range = fig.querySelector('input[type="range"]');
      if (!range) return { missing: 'the script-created range input' };
      const clipped = fig.querySelector('.wipe-clip');
      if (!clipped) return { missing: '.wipe-clip' };

      const nums = () => (getComputedStyle(clipped).clipPath.match(/[0-9.]+/g) || []).map(Number);
      const at = (v) => {
        range.value = String(v);
        range.dispatchEvent(new Event('input', { bubbles: true }));
        return nums();
      };

      const imgs = [...fig.querySelectorAll('img')].map((i) => ({
        w: i.naturalWidth, h: i.naturalHeight, src: i.getAttribute('src'),
      }));

      const box = fig.getBoundingClientRect();
      const grip = fig.querySelector('.wipe-grip');
      const gripShown = grip ? getComputedStyle(grip).display !== 'none' : false;
      fig.classList.remove('wipe--live');
      const gripWhenDead = grip ? getComputedStyle(grip).display !== 'none' : false;
      fig.classList.add('wipe--live');

      return { low: at(20), high: at(80), imgs, width: box.width, height: box.height, gripShown, gripWhenDead };
    })()`);

    assert.ok(!r.missing, `at ${viewport.width}px the wipe is missing ${r.missing}`);

    // THE WIPE MOVES. Not "the custom property changed" -- the clip the browser
    // actually paints with.
    assert.ok(r.low.length > 0 && r.high.length > 0,
      `at ${viewport.width}px the clipped layer resolves no clip-path at all`);
    assert.notDeepEqual(r.low, r.high,
      `at ${viewport.width}px the clip-path is identical at 20% and 80% -- the control moves and the picture does not`);

    // DIRECTION, ELEMENT-WISE. Comparing maxima cannot discriminate here: the
    // polygon carries a literal 100% for the bottom edge, so the largest number
    // is 100 whatever the wipe is doing. Every coordinate that MOVES must move
    // the same way -- rightwards -- and at least one must move.
    assert.equal(r.low.length, r.high.length, 'the clip-path changed shape, not just position');
    const moved = r.low.map((v, i) => r.high[i] - v).filter((d) => d !== 0);
    assert.ok(moved.length > 0, `at ${viewport.width}px nothing in the clip moved`);
    assert.ok(moved.every((d) => d > 0),
      `at ${viewport.width}px the wipe runs backwards: deltas ${JSON.stringify(moved)}`);

    // BOTH HALVES ARE THE SAME PICTURE, CROPPED IDENTICALLY. The shipped place
    // loop drifts on a sine with a 1.7 phase offset on Y, so no frame of it is
    // ever centre-cropped; a pair cut from one would misregister and the wipe
    // would look like a fault rather than a grade. Same pixel dimensions is the
    // cheap half of that guarantee and the half a test can hold.
    assert.equal(r.imgs.length, 2, `at ${viewport.width}px expected two halves, found ${r.imgs.length}`);
    assert.ok(r.imgs[0].w > 0 && r.imgs[1].w > 0,
      `at ${viewport.width}px a half failed to load: ${JSON.stringify(r.imgs)}`);
    assert.equal(r.imgs[0].w, r.imgs[1].w, `the two halves differ in width: ${JSON.stringify(r.imgs)}`);
    assert.equal(r.imgs[0].h, r.imgs[1].h, `the two halves differ in height: ${JSON.stringify(r.imgs)}`);

    assert.ok(r.width > 0 && r.height > 0, `at ${viewport.width}px the figure paints nothing`);

    // THE GRIP IS DRAWN ONLY WHERE IT CAN BE DRAGGED. WIPE_SCRIPT adds
    // `wipe--live`; without it the figure is a static split, and a round handle
    // sitting on that split is a control that looks draggable and is not --
    // §49D's dead own-place card, which passed every markup test it had.
    assert.ok(r.gripShown, `at ${viewport.width}px the grip is missing from a live wipe`);
    assert.ok(!r.gripWhenDead,
      `at ${viewport.width}px the grip is still drawn with wipe--live removed -- a handle nobody can drag`);
  }
});

/**
 * ONBOARDING HAS NO GROUND (2026-09-07), AND THIS IS THE FLAT-GROUND VERSION OF
 * THE TEST THAT USED TO CATCH A PHOTOGRAPH GOING DARK-ON-DARK.
 *
 * §63 put the landing's photograph behind this page so the cream world did not
 * begin until the work started; there is no cream now (spec §6), so the page
 * sits on the flat ground like every other page and this file's job narrows to
 * the ordinary contrast sweep -- the same probe run everywhere else in this
 * file, and the same arithmetic the palette test already runs on the tokens.
 * The three negative assertions below are what is left of the ground check:
 * proof the photograph, the scrim and the ground class are actually gone, not
 * merely unused.
 */
test('every word on the onboarding page clears the floor on the flat ground, and no photograph is behind it', { skip }, async () => {
  const s = await session();
  await s.signIn();
  for (const viewport of [PHONE, LAPTOP]) {
    const page = await visit('/onboarding', viewport);
    assert.deepEqual(page.errors, [], `at ${viewport.width}px: ${page.errors.join('; ')}`);

    const r = await page.evaluate(`(() => {
      const parse = (c) => {
        const m = (c || '').match(/[0-9.]+/g);
        if (!m) return null;
        return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 };
      };
      // Composite a background chain down onto WHITE -- the brightest a
      // photograph under the scrim can ever be.
      const groundOf = (el) => {
        const stack = [];
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          const bg = parse(getComputedStyle(n).backgroundColor);
          if (bg && bg.a > 0) { stack.push(bg); if (bg.a === 1) break; }
        }
        let out = { r: 255, g: 255, b: 255 };
        for (let i = stack.length - 1; i >= 0; i -= 1) {
          const c = stack[i];
          out = {
            r: c.r * c.a + out.r * (1 - c.a),
            g: c.g * c.a + out.g * (1 - c.a),
            b: c.b * c.a + out.b * (1 - c.a),
          };
        }
        return out;
      };
      const lum = (c) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      };
      const ratio = (a, b) => {
        const [hi, lo] = lum(a) >= lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
        return (hi + 0.05) / (lo + 0.05);
      };

      // THE WHOLE PAGE, NOT main. The first version of this scanned 'main *'
      // and passed while the FOOTER sat unreadable on the photograph -- §31
      // measured --l-dim at 2.86:1 over a bright loop and names the footer as
      // one of the three places this product ships it. A contrast probe that
      // stops at the content well is a probe that cannot see the chrome.
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own) continue;
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
        const fg = parse(cs.color);
        if (!fg) { out.push({ text: el.textContent.trim().slice(0, 40), cls: el.className || el.tagName, ratio: 0, need: 4.5, unparsed: cs.color }); continue; }
        const bg = groundOf(el);
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        out.push({
          text: el.textContent.trim().slice(0, 40),
          cls: el.className || el.tagName,
          ratio: Math.round(ratio(fg, bg) * 100) / 100,
          need: large ? 3 : 4.5,
        });
      }
      return {
        hasGround: document.body.classList.contains('has-ground'),
        ground: Boolean(document.querySelector('.bgs')),
        scrim: Boolean(document.querySelector('.scrim')),
        items: out,
      };
    })()`);

    assert.ok(!r.hasGround, `at ${viewport.width}px onboarding still carries the ground class`);
    assert.ok(!r.ground, `at ${viewport.width}px a photograph is back behind the onboarding page`);
    assert.ok(!r.scrim, `at ${viewport.width}px a scrim is back on the onboarding page`);
    assert.ok(r.items.length >= 4, `at ${viewport.width}px only ${r.items.length} text elements found -- the probe is not reading the page`);

    const failed = r.items.filter((i) => i.ratio < i.need);
    assert.deepEqual(failed, [],
      `at ${viewport.width}px these fail against the brightest ground a photograph can make: `
      + failed.map((f) => `"${f.text}" (${f.cls}) ${f.ratio}:1 needs ${f.need}:1`).join(' | '));
  }
});

test("the footer's giant word fits its own column, on every page and at every width", { skip }, async () => {
  // THE OWNER'S REVIEW OF /pricing (2026-09-06, later): --t-mark sized itself
  // off the VIEWPORT (18vw), so it read the wide landing correctly and
  // clipped on every page with a narrower column -- "TIMESTAMP." cut to
  // "TIMESTA" mid-glyph on /pricing at 1440px, because that page's content
  // sits in a 44rem column while the viewport kept growing underneath the
  // vw-based size. Sized off its own column now, so it cannot outgrow it.
  //
  // MEASURED AGAINST THE WORD'S OWN BOX, NOT THE VIEWPORT OR AN ANCESTOR.
  // `.foot-mark` sets `overflow: hidden` and `white-space: nowrap` -- that box
  // IS the thing that was doing the clipping, and a Range over its contents
  // returns the glyphs' real paint rect, the same technique the archive-label
  // and Recommended-flag tests above use. Comparing against `.foot`'s own
  // rect would count its padding as room for the word; comparing against the
  // element's own box is the honest, stricter reference.
  const s = await session();
  await s.signOut();
  for (const pathname of ['/', '/pricing']) {
    for (const width of [320, 375, 414, 768, 1024, 1440]) {
      const page = await visit(pathname, { width, height: 900, mobile: width < 768 });
      assert.deepEqual(page.errors, [], `${pathname} at ${width}px: ${page.errors.join('; ')}`);
      const r = await page.evaluate(`(() => {
        const mark = document.querySelector('.foot-mark');
        if (!mark) return { found: false };
        const range = document.createRange();
        range.selectNodeContents(mark);
        const word = range.getBoundingClientRect();
        const box = mark.getBoundingClientRect();
        return {
          found: true,
          wordLeft: word.left, wordRight: word.right, wordWidth: word.width,
          boxLeft: box.left, boxRight: box.right, boxWidth: box.width,
          fontSize: parseFloat(getComputedStyle(mark).fontSize),
        };
      })()`);
      assert.ok(r.found, `${pathname} at ${width}px: no .foot-mark on the page`);
      assert.ok(r.wordWidth > 0, `${pathname} at ${width}px: the giant word paints at zero width`);
      assert.ok(r.wordRight <= r.boxRight + 1,
        `${pathname} at ${width}px: the word's glyphs (right edge ${r.wordRight.toFixed(1)}px, font-size `
        + `${r.fontSize}px) run past its own box (right edge ${r.boxRight.toFixed(1)}px) -- it is being clipped`);
      assert.ok(r.wordLeft >= r.boxLeft - 1,
        `${pathname} at ${width}px: the word's glyphs (left edge ${r.wordLeft.toFixed(1)}px) start before its own box (left edge ${r.boxLeft.toFixed(1)}px)`);
      if (pathname === '/' && width === 1440) {
        assert.ok(Math.abs(r.fontSize - 240) <= 4,
          `the landing at 1440px used to render the giant word at 240px; it is now ${r.fontSize}px`);
      }
    }
  }
});

test("the wordmark's record light is painted and does not blink, in a real cascade", { skip }, async () => {
  // THE STYLESHEET-TEXT GUARD IN web-static CANNOT SEE A LATER RULE WINNING.
  // §60K's lesson: a rule of equal specificity that comes later restores the
  // behaviour while every text assertion stays green. This reads what the
  // browser resolved. Both public pages, both widths, because the wordmark is
  // one function and the masthead is the one thing every page shares.
  const s = await session();
  await s.signOut();
  for (const pathname of ['/', '/pricing']) {
    for (const vp of [PHONE, LAPTOP]) {
      const page = await visit(pathname, vp);
      assert.deepEqual(page.errors, [], `${pathname} at ${vp.width}px: ${page.errors.join('; ')}`);
      const r = await page.evaluate(`(() => {
        const dot = document.querySelector('.wordmark .rec');
        if (!dot) return { found: false };
        const cs = getComputedStyle(dot);
        const box = dot.getBoundingClientRect();
        const probe = document.createElement('div');
        probe.style.background = 'var(--rec)';
        document.body.appendChild(probe);
        const rec = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          found: true,
          width: box.width, height: box.height,
          animation: cs.animationName,
          opacity: cs.opacity,
          background: cs.backgroundColor,
          rec,
        };
      })()`);
      assert.ok(r.found, `${pathname} at ${vp.width}px: the wordmark has lost its record light`);
      assert.ok(r.width > 0 && r.height > 0,
        `${pathname} at ${vp.width}px: the record light paints at ${r.width}x${r.height}`);
      assert.equal(r.background, r.rec,
        `${pathname} at ${vp.width}px: the dot is ${r.background}, not the record-light red ${r.rec}`);
      assert.equal(r.animation, 'none',
        `${pathname} at ${vp.width}px: the wordmark's record light still blinks (animation "${r.animation}")`);
      assert.equal(r.opacity, '1',
        `${pathname} at ${vp.width}px: the dot sits at opacity ${r.opacity}, a leftover of the pulse`);
    }
  }
});

// ---------------------------------------------------------------------------
// reading pixels
// ---------------------------------------------------------------------------

/**
 * A PNG decoder over node:zlib, because a screenshot is the only witness to
 * what the compositor painted.
 *
 * CLAUDE.md §63C records four attempts to SIMULATE the band's composite --
 * two stacked gradients multiplied by a layer opacity over a blurred, moving
 * photograph -- and four wrong numbers. The alternative to modelling the
 * paint is reading it: Page.captureScreenshot hands back a PNG, and a PNG is
 * a chunk walk, one inflate and five scanline filters. Chrome writes 8-bit
 * RGBA, non-interlaced; anything else is refused by name rather than decoded
 * wrongly. No npm dependency, which is the house rule this file already keeps
 * by driving the browser over a bare WebSocket.
 */
function decodePng(buf) {
  assert.equal(buf.toString('latin1', 1, 4), 'PNG', 'the screenshot is not a PNG');
  let pos = 8;
  let width = 0; let height = 0; let depth = 0; let type = 0; let interlace = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; type = data[9]; interlace = data[12];
    } else if (kind === 'IDAT') {
      idat.push(data);
    } else if (kind === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  assert.equal(depth, 8, `PNG bit depth ${depth}: this decoder reads 8-bit only`);
  assert.ok(type === 6 || type === 2, `PNG colour type ${type}: this decoder reads RGB and RGBA only`);
  assert.equal(interlace, 0, 'an interlaced PNG is not what Chrome writes');
  const bpp = type === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  assert.equal(raw.length, height * (stride + 1), 'the inflated PNG is not the size its header promises');
  const px = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (filter !== 0) {
        throw new Error(`PNG scanline filter ${filter} at row ${y}`);
      }
      cur[i] = v & 0xFF;
    }
    prev = cur;
  }
  return {
    width,
    height,
    at(x, y) { const o = y * stride + x * bpp; return [px[o], px[o + 1], px[o + 2]]; },
  };
}

/** WCAG relative luminance and contrast, on [r,g,b] triples. */
function luminance([r, g, b]) {
  const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastOf(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The worst contrast a run of text meets, read off two renders of the same
 * pixels: `mask` has the glyphs in a sentinel magenta with no shadow, `ground`
 * has them in transparent ink with the shadow still painted. A pixel is
 * ground-touching-a-stroke when it is not a glyph pixel and one of its eight
 * neighbours is; the lightest of those, with the word's colour folded through
 * its ancestors' opacity, is the ratio WCAG 1.4.3 asks about -- and it is what
 * a halo does its work on, which is why the halo has to be in the picture.
 */
function worstContrast({ mask, ground, rect, color, opacity }) {
  const x0 = Math.max(0, Math.floor(rect.left) - 2);
  const y0 = Math.max(0, Math.floor(rect.top) - 2);
  const x1 = Math.min(mask.width - 1, Math.ceil(rect.right) + 2);
  const y1 = Math.min(mask.height - 1, Math.ceil(rect.bottom) + 2);
  const glyph = (x, y) => {
    if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
    const [r, g, b] = mask.at(x, y);
    return r > 128 && b > 128 && g < 80;
  };
  let glyphs = 0; let worst = Infinity; let where = null;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (glyph(x, y)) { glyphs += 1; continue; }
      let touching = false;
      for (let dy = -1; dy <= 1 && !touching; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if ((dx || dy) && glyph(x + dx, y + dy)) { touching = true; break; }
        }
      }
      if (!touching) continue;
      const under = ground.at(x, y);
      const ink = color.map((c, i) => c * opacity + under[i] * (1 - opacity));
      const ratio = contrastOf(ink, under);
      if (ratio < worst) { worst = ratio; where = { x, y, under }; }
    }
  }
  return { glyphs, worst, where };
}

/**
 * Every word in the landing band, against the pixels painted behind it.
 *
 * THE SCRIM IS NOT WHAT THE SOLVER SAYS IT IS, AND A RATIO CANNOT SEE A HALO.
 * Measured on 2026-09-07 (DESIGN.md, Text on a photograph): the band's scrim
 * is two gradients multiplied by a layer opacity, so the alpha that lands is
 * always less than the solved number; the rail's options were ghosts at a
 * floor solved on the flat ground; and every word carries a text-shadow that
 * a screenshot with the text hidden cannot see. So this test hides nothing.
 * It renders the band twice per place -- once with every word in sentinel
 * magenta and no shadow, to learn where the strokes are; once with every word
 * in transparent ink and its shadow intact, to learn what the eye meets
 * beside them -- and holds the lightest pixel touching a stroke to the floor.
 *
 * BOTH STATES A VISITOR CAN GET. With reduced motion asked for, BG_SCRIPT
 * leaves the blurred still under the scrim; otherwise the loop plays. The two
 * grounds differ in blur and in mean luma, and the guards on both are the
 * same words at the same floor.
 *
 * COVERAGE. All seven places, each chosen in turn and centred in the rail, so
 * every option is measured chosen and -- as a neighbour of the next -- unchosen,
 * at both widths, in both states. A word inside the rail's fade (the mask that
 * dissolves its right edge, §33) or scrolled past its left edge is not painted
 * and is not measured. The loop is one frame per capture; its drift returns to
 * its origin and its grain is fresh each frame, so a single frame is the
 * ground within a few levels, and a floor with any margin at all absorbs that.
 *
 * TIMESTAMP_BAND_EVIDENCE=<file> writes every measured run of text as JSON --
 * the whole distribution, not the failures -- which is what sizing a floor
 * needs. The 2026-09-07 decision was taken off that file.
 */
test('every word in the landing band clears the floor against the pixels painted behind it, halo included', { skip }, async () => {
  const s = await session();
  await s.signOut();
  const { cdp } = s;

  const run = async (expression) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(exceptionDetails, undefined, `probe threw: ${exceptionDetails?.text} ${exceptionDetails?.exception?.description ?? ''}`);
    return result.value;
  };
  // Painting the band with an extra rule, through the CSSOM of the page's own
  // sheet: style-src 'self' refuses an inline <style> element outright and a
  // hash cannot rescue one, but insertRule is not an inline style. Two frames
  // are awaited so the compositor has painted before the capture is asked for.
  //
  // THE CAPTURE IS CLIPPED TO THE BAND, AND THAT IS A BUDGET RATHER THAN A
  // TIDY-UP. The band is about a third of the viewport at both widths, so a
  // full-viewport capture spends two thirds of its pixels on ground this sweep
  // never reads -- measured 2026-09-08, 56 captures come to 24.5 MB of base64
  // and 16.3 s of the test's wall clock on an IDLE machine. Under full-suite
  // load one of them exceeded the 15 s CDP budget and failed the run, and so
  // did the deleteRule probe behind it, because the renderer is still
  // rasterising when the next call arrives. CLAUDE.md §4: a margin narrower
  // than machine variance measures the machine, and the answer is to take work
  // OUT of the window rather than widen it. Clipped, the same 56 captures are
  // 11.9 MB and 11.3 s, and every pixel this sweep reads is byte-identical.
  //
  // §73F LEFT `clip`'s TWO COORDINATE STORIES ALONE; THIS RESOLVES THEM BY
  // MEASUREMENT. The story is the DOCUMENT's: a clip at the band's VIEWPORT y
  // returns a flat rectangle of the page's top (1,260 bytes, which is what the
  // screenshot script for the owner hit), while one at y + scrollY matched the
  // region of a full capture it replaces on every sampled pixel, all 56 times.
  // So the clip's origin is the band's viewport origin plus the scroll, and
  // the two assertions below plus "painted no glyph" are what catch a browser
  // that ever tells the other story.
  const capture = async (rule, clip) => {
    const idx = await run(`(async () => {
      const sh = [...document.styleSheets].find((x) => x.href && x.href.endsWith('/styles.css'));
      const i = sh.insertRule(${JSON.stringify(rule)}, sh.cssRules.length);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return i;
    })()`);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
    await run(`(() => {
      const sh = [...document.styleSheets].find((x) => x.href && x.href.endsWith('/styles.css'));
      sh.deleteRule(${idx});
    })()`);
    return decodePng(Buffer.from(data, 'base64'));
  };
  const SENTINEL = '.band-in, .band-in * { color: #FF00FF !important; text-shadow: none !important; opacity: 1 !important; text-decoration: none !important; }';
  // The ground capture holds the ground and the halo and nothing else. A
  // transparent colour does not hide a decoration whose colour is set on its
  // own (the chosen option's focus underline is lime), and a stroke of it
  // beside a glyph would be read as the ground at about 1:1 -- a false red
  // that reads as a contrast regression. Measured 2026-09-07: the shipped
  // 6px-offset underline skips the descenders and never touches a stroke, but
  // one that did failed 60 of 254 runs until this declaration.
  const KNOCKOUT = '.band-in, .band-in * { color: transparent !important; text-decoration: none !important; }';

  const measured = [];
  let placeCount = 0;
  try {
    for (const viewport of [PHONE, LAPTOP]) {
      for (const state of ['still', 'live']) {
        await cdp.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: state === 'still' ? 'reduce' : 'no-preference' }],
        });
        const page = await visit('/', viewport);
        assert.deepEqual(page.errors, [], `at ${viewport.width}px (${state}): ${page.errors.join('; ')}`);

        const places = await run(`(() => {
          const sh = [...document.styleSheets].find((x) => x.href && x.href.endsWith('/styles.css'));
          sh.insertRule('.band .bg, .band .bgv, .band .scrim, .band .lopt, .band .lopt * { transition: none !important; }', sh.cssRules.length);
          return [...document.querySelectorAll('input[name="lplace"]')].map((i) => i.id);
        })()`);
        assert.ok(places.length >= 2, `the landing offers ${places.length} places -- the probe is not reading the rail`);
        placeCount = places.length;

        for (const slug of places) {
          const ready = await run(`(async () => {
            document.querySelector('.lopt--${slug}').click();
            const bgs = document.querySelector('.band .bgs');
            const v = bgs.querySelector('.bgv');
            if (${JSON.stringify(state)} === 'still') {
              await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
              return { live: bgs.classList.contains('is-live'), src: v.getAttribute('src') };
            }
            const until = Date.now() + 10000;
            while (Date.now() < until) {
              if (bgs.classList.contains('is-showing') && v.readyState >= 2 && (v.currentSrc || '').indexOf('/places/') >= 0) {
                v.pause();
                await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
                return { live: true, src: v.currentSrc };
              }
              await new Promise((r) => setTimeout(r, 50));
            }
            return { live: false, src: v.currentSrc, timedOut: true };
          })()`);
          if (state === 'still') {
            assert.ok(!ready.live && !ready.src, `at ${viewport.width}px with reduced motion the loop still started (${ready.src})`);
          } else {
            assert.ok(ready.live, `at ${viewport.width}px the loop for ${slug} never reached a frame (${ready.src})`);
            assert.ok(ready.src.includes(encodeURIComponent(slug.replace(/^pl-/, ''))), `the loop playing is ${ready.src}, not ${slug}'s`);
          }

          const g = await run(`(() => {
            const band = document.querySelector('.band');
            window.scrollTo(0, band.getBoundingClientRect().top + window.scrollY);
            const rail = band.querySelector('.lrail');
            const li = band.querySelector('.lopt--${slug}').closest('li');
            rail.scrollLeft = li.offsetLeft + li.offsetWidth / 2 - rail.clientWidth / 2;
            const b = band.getBoundingClientRect();
            const rr = rail.getBoundingClientRect();
            const fade = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s-6')) || 32;
            const parse = (c) => { const m = (c || '').match(/[0-9.]+/g); return m ? [+m[0], +m[1], +m[2]] : null; };
            const opacityOf = (el) => { let o = 1; for (let n = el; n && n !== band.parentElement; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
            const words = [];
            for (const el of band.querySelectorAll('.band-in, .band-in *')) {
              const nodes = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
              if (!nodes.length) continue;
              const cs = getComputedStyle(el);
              if (cs.visibility === 'hidden' || cs.display === 'none') continue;
              const rects = [];
              for (const n of nodes) {
                const r = document.createRange(); r.selectNodeContents(n);
                for (const q of r.getClientRects()) {
                  if (q.width > 0 && q.height > 0) rects.push({ left: q.left - b.left, top: q.top - b.top, right: q.right - b.left, bottom: q.bottom - b.top });
                }
              }
              words.push({
                text: nodes.map((n) => n.textContent.trim()).join(' ').slice(0, 40),
                cls: el.className || el.tagName,
                rects, color: parse(cs.color), opacity: opacityOf(el),
                size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) || 400,
                inRail: Boolean(el.closest('.lrail')),
              });
            }
            return {
              // scrollX/scrollY turn the band's viewport origin into the
              // document origin a clip is measured in; nothing else uses them.
              band: { left: b.left, top: b.top, width: b.width, height: b.height, scrollX: window.scrollX, scrollY: window.scrollY, fits: b.top >= -0.5 && b.bottom <= innerHeight + 0.5 },
              rail: { left: rr.left - b.left, fadeAt: rr.right - fade - b.left },
              words,
            };
          })()`);
          assert.ok(g.band.fits, `at ${viewport.width}px the band (${g.band.height}px tall at y=${g.band.top}) does not fit the viewport, so a viewport capture cannot hold it`);

          // The clip's origin is the band's rounded VIEWPORT origin carried
          // into document space by the scroll, so PNG (0,0) is band (0,0) and
          // a word's band-relative rect is already its rect in the capture.
          const ox = Math.round(g.band.left); const oy = Math.round(g.band.top);
          const clip = {
            x: ox + g.band.scrollX,
            y: oy + g.band.scrollY,
            width: Math.round(g.band.width),
            height: Math.round(g.band.height),
            scale: 1,
          };
          const mask = await capture(SENTINEL, clip);
          const ground = await capture(KNOCKOUT, clip);
          // THE CAPTURE IS MEASURED AGAINST THE BAND, NOT AGAINST THE CLIP.
          // Comparing it to the clip is tautological -- a clip 40px too narrow
          // still yields a capture that matches it, and the sabotage that
          // proved that passed in silence. Against the band's own rounded box
          // both faults are caught: a clip that does not cover the band, and a
          // device scale factor other than 1 (which doubles both numbers).
          // CSS px and PNG px agree because visit() emulates at scale 1 and
          // the clip asks for scale 1.
          const bw = Math.round(g.band.width); const bh = Math.round(g.band.height);
          for (const [name, shot] of [['sentinel', mask], ['ground', ground]]) {
            assert.equal(shot.width, bw, `at ${viewport.width}px the ${name} capture is ${shot.width}px wide against a band ${bw}px wide -- the clip does not cover the band, or the device scale factor is not 1`);
            assert.equal(shot.height, bh, `at ${viewport.width}px the ${name} capture is ${shot.height}px tall against a band ${bh}px tall -- the clip does not cover the band, or the device scale factor is not 1`);
          }
          for (const w of g.words) {
            assert.ok(w.color, `"${w.text}" (${w.cls}) has an unparseable colour`);
            // 4.5:1 for every word. The title alone takes WCAG's large-text
            // line, and only because it IS large at every width -- asserted,
            // so the allowance cannot outlive the size. The rail's options are
            // 26px on a laptop and 22px on a phone; a floor that changed with
            // the viewport would let the laptop ship what the phone refuses.
            const title = w.cls === 'band-t';
            if (title) assert.ok(w.size >= 24, `the band's title is ${w.size}px, under the 24px that makes 3:1 a legitimate floor for it`);
            for (const r of w.rects) {
              // Inside the rail only the painted, unfaded run counts: a word
              // scrolled past the left edge is not on screen, and the last
              // place's tail sits under the fade by construction (its padding
              // is narrower than the mask), so the rect is clipped to the
              // region the mask leaves alone rather than the word dropped.
              const left = w.inRail ? Math.max(r.left, g.rail.left) : r.left;
              const right = w.inRail ? Math.min(r.right, g.rail.fadeAt) : r.right;
              if (right - left < 8) continue;
              // Band-relative already: the capture starts at the band's origin.
              const rect = { left, top: r.top, right, bottom: r.bottom };
              const { glyphs, worst, where } = worstContrast({ mask, ground, rect, color: w.color, opacity: w.opacity });
              assert.ok(glyphs > 0, `at ${viewport.width}px (${state}, ${slug}): the sentinel render painted no glyph for "${w.text}" (${w.cls}) -- the probe is blind`);
              // Infinity < need is false, so a rect with strokes and nothing
              // touching them would pass in silence; say so instead.
              assert.ok(Number.isFinite(worst), `at ${viewport.width}px (${state}, ${slug}): no pixel beside "${w.text}" (${w.cls}) was read -- strokes were found and nothing touching them`);
              measured.push({
                width: viewport.width, state, place: slug.replace(/^pl-/, ''),
                text: w.text, cls: w.cls, ratio: Math.round(worst * 100) / 100, need: title ? 3 : 4.5,
                size: w.size, opacity: w.opacity, under: where?.under,
              });
            }
          }
        }
      }
    }
  } finally {
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  }

  // The whole measurement, for whoever has to re-decide a floor: every run of
  // text, not only the ones that failed.
  if (process.env.TIMESTAMP_BAND_EVIDENCE) {
    fs.writeFileSync(process.env.TIMESTAMP_BAND_EVIDENCE, `${JSON.stringify(measured, null, 1)}\n`);
  }

  assert.ok(measured.length >= 100, `only ${measured.length} runs of text were measured across both widths, both states and every place -- the probe is not reading the band`);
  for (const viewport of [PHONE, LAPTOP]) {
    for (const state of ['still', 'live']) {
      const own = measured.filter((m) => m.width === viewport.width && m.state === state && m.cls.includes(`lopt--pl-${m.place}`));
      // Every place the rail offered, whatever that count is today -- a place
      // retired tomorrow must not turn this into a probe bug.
      assert.ok(placeCount >= 2 && own.length >= placeCount, `at ${viewport.width}px (${state}) only ${own.length} of the ${placeCount} places had their own option measured`);
    }
  }

  const failed = measured.filter((m) => m.ratio < m.need).sort((a, b) => (a.ratio / a.need) - (b.ratio / b.need));
  const line = (m) => `at ${m.width}px, ${m.state}, ${m.place}: "${m.text}" (${m.cls}, ${m.size}px, opacity ${m.opacity}) ${m.ratio}:1 needs ${m.need}:1, lightest pixel touching it rgb(${m.under?.join(',')})`;
  assert.deepEqual(failed, [],
    `${failed.length} of ${measured.length} runs of text in the band fail against the pixels painted behind them; the worst first:\n`
    + failed.slice(0, 12).map(line).join('\n'));
});

