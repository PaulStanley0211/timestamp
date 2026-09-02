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
import { spawn } from 'node:child_process';

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

  const app = createServer({
    root, cfg: CFG, queue: fakeQueue(), port: 0, auth, supabase,
    provider: 'fixture',
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed',
    logImpl: () => {},
  });
  const port = await app.listen();
  const base = `http://127.0.0.1:${port}`;

  const account = auth.findAccountByEmail({ email: LONG_EMAIL });
  const { sessionId } = auth.createSession({ accountId: account.accountId });
  const cookieValue = auth.signCookie(sessionId, auth.sessionSecret());

  const queued = seedJob(app, root, { status: 'queued', owner: account });
  const finished = seedJob(app, root, { status: 'done', owner: account });
  fs.writeFileSync(jobPaths(root, finished.jobId).video, Buffer.alloc(2048, 7));

  const { child, profile, cdp } = await launchBrowser();

  shared = {
    base, root, app, cdp, child, profile,
    account, queued, finished,
    async signIn() {
      await cdp.send('Network.setCookie', { name: SESSION_COOKIE, value: cookieValue, url: base });
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
  for (const dir of [shared.root, shared.profile]) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp dir */ }
  }
});

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

test('the landing page fits a phone and a laptop with nothing off screen', { skip }, async () => {
  const s = await session();
  await s.signOut();
  for (const viewport of [PHONE, LAPTOP]) {
    const page = await visit('/', viewport);
    assert.deepEqual(page.errors, [], `at ${viewport.width}px: ${page.errors.join('; ')}`);
    assert.ok(page.layout.overflowX <= 0,
      `the page scrolls sideways by ${page.layout.overflowX}px at ${viewport.width}px -- §33's guillotined rail, back again`);
    assert.ok(page.layout.title.length > 0);
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
