/**
 * The legal pages: /privacy, /terms, /impressum.
 *
 * THE ENTITY IS A CONFIG VALUE AND null IS THE DESIGNED STATE -- the same
 * shape as `stripePriceId: null` in config/credits.json: built, wired, and
 * gated on one value only the owner can fill (the selling-entity decision,
 * CLAUDE.md §37G). With entity null the pages render everything that is true
 * today -- retention, processors, rights -- with an operator placeholder; the
 * deploy runbook's smoke list is what stops that placeholder reaching
 * customers. Filling config/legal.json is also sign-off on the page text; its
 * _comment says so.
 *
 * Everything user-typed or config-typed that reaches these pages goes through
 * h() like every other page, and the escaping is pinned here with a hostile
 * entity name, because "it is only config" is how a template injection
 * arrives the day the config value comes from somewhere else.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { createServer } from '../scripts/web/server.mjs';

const CFG = JSON.parse(fs.readFileSync(new URL('../config/render.json', import.meta.url), 'utf8'));

// -- the compact REQUIRED_AUTH fake, per the house copy-not-import rule ------

const PLANS = Object.freeze({
  free: { id: 'free', label: 'Free', monthlyUSD: 0, annualUSD: 0, creditsPerPeriod: 51 },
  archive: { id: 'archive', label: 'Archive', monthlyUSD: 12, annualUSD: 120, creditsPerPeriod: 204 },
});
const CREDIT_COSTS = Object.freeze({
  '480p': { resolution: '480p', width: 854, height: 480, available: true, creditsPerReference: 51 },
});

function fakeAuth() {
  const sessions = new Map();
  const SECRET = 'not-a-real-secret';
  const sign = (v, s) => `${v}.${crypto.createHmac('sha256', s).update(v).digest('hex').slice(0, 16)}`;
  return {
    PLANS,
    CREDIT_COSTS,
    createAccount() { throw new Error('unused'); },
    findAccountByEmail() { return null; },
    verifyPassword() { return false; },
    loadAccount() { throw new Error('unused'); },
    saveAccount() {},
    createSession({ accountId }) { const id = `s-${sessions.size}`; sessions.set(id, { sessionId: id, accountId }); return { sessionId: id }; },
    readSession({ sessionId }) { return sessions.get(sessionId) ?? null; },
    destroySession({ sessionId }) { sessions.delete(sessionId); },
    signCookie: sign,
    verifyCookie(signed, s) {
      const cut = String(signed ?? '').lastIndexOf('.');
      if (cut < 1) return null;
      const v = signed.slice(0, cut);
      return sign(v, s) === signed ? v : null;
    },
    sessionSecret() { return SECRET; },
    creditCost() { return 51; },
    authenticate() { const e = new Error('no'); e.code = 'BAD_CREDENTIALS'; throw e; },
    balanceOf() { return { credits: 0, planId: 'free', grantedAt: null, expiresAt: null }; },
    debitCredits() {},
    refundCredits() {},
    grantCredits() { return { granted: false }; },
  };
}

const fakeQueue = () => ({
  enqueue: (jobId) => ({ jobId }),
  peek: () => [],
  stats: () => ({ pending: 0, claimed: 0, done: 0, failed: 0 }),
});

async function withLegalServer(legal, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-legal-'));
  const app = createServer({
    root, cfg: CFG, queue: fakeQueue(), port: 0, auth: fakeAuth(), legal,
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed',
  });
  const port = await app.listen();
  try {
    await run({ base: `http://127.0.0.1:${port}` });
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const ENTITY = Object.freeze({
  name: 'Ganz & Gar <UG>',
  addressLines: ['Musterstrasse 1', '12345 Berlin', 'Germany'],
  email: 'support@timestamptapes.com',
  vatId: null,
});

test('the three legal pages answer 200 HTML with no session', async () => {
  await withLegalServer({ entity: null }, async ({ base }) => {
    for (const p of ['/privacy', '/terms', '/impressum']) {
      const res = await fetch(`${base}${p}`);
      assert.equal(res.status, 200, `${p} answered ${res.status}`);
      assert.match(res.headers.get('content-type'), /text\/html/);
    }
  });
});

test('with no entity the pages still tell the truth, behind an operator placeholder', async () => {
  await withLegalServer({ entity: null }, async ({ base }) => {
    const privacy = await (await fetch(`${base}/privacy`)).text();
    // The retention promise comes from config, the same numbers the consent
    // text quotes -- never a literal that can drift.
    assert.match(privacy, new RegExp(`${CFG.retention.photoDays} days`));
    assert.match(privacy, new RegExp(`${CFG.retention.jobDays} days`));
    // The processors a photograph or a payment actually reaches.
    for (const processor of ['fal', 'Supabase', 'Stripe', 'Resend', 'Hetzner']) {
      assert.match(privacy, new RegExp(processor), `privacy does not name ${processor}`);
    }
    // The doors that exercise the rights exist and are named.
    assert.match(privacy, /\/account/, 'privacy must point at the deletion and export page');

    const impressum = await (await fetch(`${base}/impressum`)).text();
    assert.match(impressum, /operator .*published here|will be published/i,
      'an unconfigured impressum must say the operator is not yet named, not render blank');
  });
});

test('a configured entity is rendered on all three pages, escaped', async () => {
  await withLegalServer({ entity: ENTITY }, async ({ base }) => {
    for (const p of ['/privacy', '/terms', '/impressum']) {
      const html = await (await fetch(`${base}${p}`)).text();
      assert.match(html, /Ganz &amp; Gar &lt;UG&gt;/, `${p} does not carry the escaped entity name`);
      assert.ok(!html.includes('Ganz & Gar <UG>'), `${p} rendered the entity name unescaped`);
      assert.match(html, /support@timestamptapes\.com/, `${p} does not carry the contact address`);
    }
    const impressum = await (await fetch(`${base}/impressum`)).text();
    for (const line of ENTITY.addressLines) {
      assert.match(impressum, new RegExp(line), `impressum is missing the address line "${line}"`);
    }
  });
});

test('every page footer links the three legal pages', async () => {
  await withLegalServer({ entity: null }, async ({ base }) => {
    for (const p of ['/', '/pricing', '/privacy']) {
      const html = await (await fetch(`${base}${p}`)).text();
      for (const href of ['/privacy', '/terms', '/impressum']) {
        assert.match(html, new RegExp(`href="${href}"`), `${p} footer does not link ${href}`);
      }
    }
  });
});

test('the pages are covered by the texture and border sweeps', () => {
  // §23's own trap: a page missing from renderedPages() is invisible to every
  // check that walks it, and being invisible is exactly how five pages stayed
  // wrong. This pins the three names into that list.
  const source = fs.readFileSync(new URL('./web-static.test.js', import.meta.url), 'utf8');
  for (const name of ['privacyPage', 'termsPage', 'impressumPage']) {
    assert.match(source, new RegExp(name), `web-static.test.js renderedPages() does not cover ${name}`);
  }
});
