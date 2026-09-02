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

import { createServer, normaliseLegalEntity } from '../scripts/web/server.mjs';
import { privacyPage } from '../scripts/web/views.mjs';

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

// ---------------------------------------------------------------------------
// the entity from the environment, so a home address need never enter the repo
// ---------------------------------------------------------------------------

/**
 * `TIMESTAMP_LEGAL_ENTITY` is a JSON object in `.env` -- the channel compose
 * already passes into both containers, `.gitignore` already covers with
 * `.env.*`, and `.dockerignore` already keeps out of the image. It exists
 * because a sole trader's disclosure address IS a home address, and a public
 * repository's history is permanent in a way a taken-down page is not. It
 * closes the git half only; the pages still publish the address while the
 * site is live, which is the point of them.
 *
 * The validator is the other half and it guards a failure this file could not
 * previously see: `h()` renders null and undefined as the EMPTY STRING, so an
 * entity missing its email produced a legal page with a silently blank contact
 * line -- not a visible "undefined", but a page that looks deliberate and is
 * wrong. An entity that cannot render completely is refused and logged.
 */
const ENV_ENTITY = Object.freeze({
  name: 'Sole Trader & Co <test>',
  addressLines: ['Musterweg 4', '10115 Berlin', 'Germany'],
  email: 'support@timestamptapes.com',
  vatId: null,
});

async function withEnvLegalServer({ legalEntityJson = null, legal = null, indexable = undefined }, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-legal-env-'));
  const logged = [];
  const app = createServer({
    root, cfg: CFG, queue: fakeQueue(), port: 0, auth: fakeAuth(),
    legal, legalEntityJson, ...(indexable === undefined ? {} : { indexable }),
    logImpl: (line) => logged.push(String(line)),
    ffprobeImpl: async () => 'ffprobe version 7.1 stubbed',
  });
  const port = await app.listen();
  try {
    await run({ base: `http://127.0.0.1:${port}`, logged });
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('the entity can come from the environment, and never touch the repo', async () => {
  await withEnvLegalServer({ legalEntityJson: JSON.stringify(ENV_ENTITY) }, async ({ base }) => {
    for (const p of ['/privacy', '/terms', '/impressum']) {
      const html = await (await fetch(`${base}${p}`)).text();
      assert.match(html, /Sole Trader &amp; Co &lt;test&gt;/, `${p} does not carry the escaped entity name`);
      assert.ok(!html.includes('Sole Trader & Co <test>'), `${p} rendered the entity name unescaped`);
      assert.ok(!/will be published/i.test(html), `${p} still shows the operator placeholder`);
    }
    const impressum = await (await fetch(`${base}/impressum`)).text();
    for (const line of ENV_ENTITY.addressLines) {
      assert.match(impressum, new RegExp(line), `impressum is missing the address line "${line}"`);
    }
  });
});

test('the committed config stays null while the environment carries the truth', () => {
  // The whole point of the route: this assertion fails the day somebody pastes
  // a home address into the tracked file, which is the irreversible move.
  const onDisk = JSON.parse(fs.readFileSync(new URL('../config/legal.json', import.meta.url), 'utf8'));
  assert.equal(onDisk.entity, null,
    'config/legal.json carries an entity -- if that is a real address it is now permanent in git history');
});

test('a malformed environment entity degrades to the placeholder and NAMES the variable', async () => {
  await withEnvLegalServer({ legalEntityJson: '{"name": "half a json' }, async ({ base, logged }) => {
    const impressum = await (await fetch(`${base}/impressum`)).text();
    assert.match(impressum, /will be published/i,
      'a malformed entity must fall back to the honest placeholder, never a half-rendered page');
    assert.ok(logged.some((l) => l.includes('TIMESTAMP_LEGAL_ENTITY')),
      'nothing in the log names the variable the operator got wrong');
  });
});

test('an entity missing a field it renders is refused, not published half-blank', async () => {
  // h() renders undefined as '', so this page would otherwise ship a contact
  // block with an empty line where the address must legally be.
  const partial = { name: 'Someone', addressLines: ['1 Example Road'] };
  await withEnvLegalServer({ legalEntityJson: JSON.stringify(partial) }, async ({ base, logged }) => {
    const impressum = await (await fetch(`${base}/impressum`)).text();
    assert.match(impressum, /will be published/i,
      'an entity with no contact address was published anyway');
    assert.ok(!impressum.includes('Someone'), 'a refused entity still reached the page');
    assert.ok(logged.some((l) => l.includes('email')),
      'the log does not say which field was missing');
  });
});

test('the legal option still beats the environment, so tests keep control', async () => {
  await withEnvLegalServer({
    legal: { entity: null },
    legalEntityJson: JSON.stringify(ENV_ENTITY),
  }, async ({ base }) => {
    const impressum = await (await fetch(`${base}/impressum`)).text();
    assert.match(impressum, /will be published/i,
      'the environment overrode an explicitly pinned legal option');
  });
});

test('the impressum cites the DDG, and never the statute it replaced', async () => {
  // The owner is RESIDENT IN GERMANY (established 2026-08-29 -- India is
  // citizenship, Germany is residence, and it is residence that decides this).
  // So § 5 DDG genuinely binds this service and the page is a legal duty, not
  // a courtesy to German buyers.
  //
  // What it must never carry again is § 5 TMG. That statute was REPEALED in
  // May 2024 and replaced by the DDG, so the heading this page shipped with
  // named a law that no longer exists -- wrong for every operator, not just
  // this one.
  await withEnvLegalServer({ legalEntityJson: JSON.stringify(ENV_ENTITY) }, async ({ base }) => {
    const impressum = await (await fetch(`${base}/impressum`)).text();
    assert.ok(!/\bTMG\b/.test(impressum), 'the impressum cites the repealed TMG');
    assert.match(impressum, /\bDDG\b/, 'the impressum no longer cites the statute that requires it');
    assert.match(impressum, /Impressum/, 'the page lost the word German buyers look for');
    assert.match(impressum, /Sole Trader &amp; Co &lt;test&gt;/, 'the impressum no longer names the seller');
    assert.match(impressum, /support@timestamptapes\.com/, 'the impressum no longer carries a contact');
  });
});

test('the cookie claim matches the cookies this app actually sets', async () => {
  // It said "the only cookie is the one that keeps you signed in" and there
  // are THREE. All strictly necessary, so the consent position is unchanged --
  // but a privacy notice that misstates what it sets is the wrong thing to
  // publish. Pinned against the real constants rather than a literal, so a
  // fourth cookie fails here and forces the prose to be reviewed, exactly as
  // the retention numbers are pinned to config.
  const middleware = await import('../scripts/web/session-middleware.mjs');
  const cookies = [middleware.SESSION_COOKIE, middleware.CSRF_COOKIE, middleware.OAUTH_STATE_COOKIE];
  assert.equal(new Set(cookies).size, 3, 'the cookie constants moved -- review the privacy page prose');

  await withEnvLegalServer({ legalEntityJson: JSON.stringify(ENV_ENTITY) }, async ({ base }) => {
    const privacy = await (await fetch(`${base}/privacy`)).text();
    assert.ok(!/only cookie is/i.test(privacy),
      'the privacy page still claims a single cookie');
    assert.match(privacy, /strictly necessary/i,
      'the privacy page does not say why there is no cookie banner');
    assert.match(privacy, /no analytics/i, 'the no-tracking claim was lost');
  });
});

// ---------------------------------------------------------------------------
// keeping the disclosure address out of a search index
// ---------------------------------------------------------------------------

/**
 * These live beside the legal tests because the thing they protect is the
 * IMPRESSUM ADDRESS. § 5 DDG wants an address at which documents can be
 * served, so for a sole trader it is a home address; `.env` keeps it out of
 * git, and this keeps it out of Google until the owner is ready to be public.
 *
 * "Just do not share the URL" is not the protection it sounds like: Caddy
 * issues a certificate on first boot, and a certificate puts the hostname in
 * public Certificate Transparency logs that crawlers watch. The site is
 * discoverable from the first TLS handshake, linked or not.
 *
 * THE DEFAULT IS noindex, AND THE ASYMMETRY IS THE WHOLE ARGUMENT. Forgetting
 * to turn indexing ON costs traffic, which is visible and fixable any day.
 * Forgetting to turn it OFF costs an indexed and archived home address, which
 * cannot be taken back. The recoverable failure is the one that gets to be the
 * default.
 */
test('by default nothing may be indexed, on every kind of response', async () => {
  await withEnvLegalServer({ legalEntityJson: JSON.stringify(ENV_ENTITY) }, async ({ base }) => {
    for (const p of ['/impressum', '/privacy', '/terms', '/', '/nothing-here']) {
      const res = await fetch(`${base}${p}`);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow',
        `${p} did not refuse indexing (it answered ${res.status})`);
    }
    // A JSON route too -- the header is set before routing, so a response this
    // test does not know about is covered by construction rather than by
    // somebody remembering.
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.headers.get('x-robots-tag'), 'noindex, nofollow');
  });
});

test('by default robots.txt disallows everything, and says why', async () => {
  await withEnvLegalServer({ legalEntityJson: JSON.stringify(ENV_ENTITY) }, async ({ base }) => {
    const res = await fetch(`${base}/robots.txt`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/plain/);
    const body = await res.text();
    assert.match(body, /User-agent: \*/);
    assert.match(body, /Disallow: \//);
    assert.ok(!/Allow: \//.test(body), 'the disallowing robots.txt also allows');
  });
});

test('the operator can open the site to search engines with one flag', async () => {
  await withEnvLegalServer({
    legalEntityJson: JSON.stringify(ENV_ENTITY), indexable: true,
  }, async ({ base }) => {
    const page = await fetch(`${base}/privacy`);
    assert.equal(page.headers.get('x-robots-tag'), null,
      'the noindex header survived the flag that is supposed to lift it');
    const robots = await fetch(`${base}/robots.txt`);
    const body = await robots.text();
    assert.ok(!/Disallow: \/\s*$/m.test(body), 'robots.txt still disallows everything');
  });
});

test('the media a customer paid for is never indexable, flag or not', async () => {
  // A tape is somebody's face. Opening the marketing site to crawlers must not
  // open the artefacts with it, so this one is not a function of the flag.
  await withEnvLegalServer({
    legalEntityJson: JSON.stringify(ENV_ENTITY), indexable: true,
  }, async ({ base }) => {
    const robots = await fetch(`${base}/robots.txt`);
    const body = await robots.text();
    assert.match(body, /Disallow: \/j\//, 'job pages and their media are crawlable');
  });
});

test('normaliseLegalEntity takes only what renders, and refuses the rest', () => {
  const ok = normaliseLegalEntity(ENV_ENTITY);
  assert.equal(ok.entity.name, ENV_ENTITY.name);
  assert.deepEqual(ok.entity.addressLines, ENV_ENTITY.addressLines);
  assert.equal(ok.entity.vatId, null);
  assert.equal(ok.reason, null);

  // An allow-list, like the export block in §39: the record is built field by
  // field, never spread, so a key added to the config can never ride into a
  // render nobody designed.
  const extra = normaliseLegalEntity({ ...ENV_ENTITY, secretNote: 'do not publish' });
  assert.deepEqual(Object.keys(extra.entity).sort(), ['addressLines', 'email', 'name', 'vatId']);

  for (const [label, raw] of [
    ['null', null],
    ['a string', 'Sole Trader'],
    ['no name', { ...ENV_ENTITY, name: '   ' }],
    ['no email', { ...ENV_ENTITY, email: '' }],
    ['an email with no @', { ...ENV_ENTITY, email: 'support' }],
    ['no address', { ...ENV_ENTITY, addressLines: [] }],
    ['an address that is not a list', { ...ENV_ENTITY, addressLines: 'One line' }],
    ['a blank address line', { ...ENV_ENTITY, addressLines: ['1 Example Road', ''] }],
    ['a numeric vatId', { ...ENV_ENTITY, vatId: 42 }],
  ]) {
    const out = normaliseLegalEntity(raw);
    assert.equal(out.entity, null, `${label} was accepted`);
    assert.ok(typeof out.reason === 'string' && out.reason.length > 0,
      `${label} was refused without saying why`);
  }
});

/**
 * A TAKEDOWN PROMISE WITH NO ADDRESS IS NOT A ROUTE.
 *
 * /terms has always said takedown requests are answered. Until 2026-08-30 it
 * did not say WHERE to send one -- and the person who most needs that sentence
 * is not the customer, it is a stranger who has found themselves in a video
 * they never agreed to. They have no account, no order, and no reason to know
 * that an address appears further down the page.
 *
 * Stripe's activation asks how consent for an uploaded likeness is obtained and
 * what happens when it was not; this sentence is the answer to the second half.
 */
test('the takedown promise names somewhere to send a takedown', async () => {
  await withLegalServer({ entity: null }, async ({ base }) => {
    const terms = await (await fetch(`${base}/terms`)).text();

    // BY PARAGRAPH, NOT BY SENTENCE. Splitting on full stops looks right and
    // is not: an email address contains one, so a "sentence" ending at the
    // first period truncates the very address being asserted. The paragraph is
    // the unit that actually holds the promise.
    const para = (terms.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) ?? [])
      .find((p) => /takedown/i.test(p));
    assert.ok(para, '/terms no longer promises to answer takedown requests');
    assert.match(para, /support@timestamptapes\.com/,
      'the takedown promise does not say where to send one');
  });
});

/**
 * THE PAGES ARE IN ENGLISH, INCLUDING THE IMPRESSUM (2026-08-30).
 *
 * The Impressum shipped with German labels -- "Angaben gemäß § 5 DDG",
 * "Anbieter", "Kontakt" -- on a site that is otherwise entirely in English and
 * sells worldwide. The owner asked for one language.
 *
 * WHAT STAYS GERMAN IS THE CITATION, and only the citation: "§ 5 DDG" names a
 * German statute, and a statute's name does not translate. The words AROUND it
 * are ours and they are English.
 */
test('the impressum is written in English, and still cites the statute', async () => {
  await withLegalServer({ entity: ENV_ENTITY }, async ({ base }) => {
    const html = await (await fetch(`${base}/impressum`)).text();

    assert.match(html, /\bDDG\b/, 'the citation is gone');
    for (const german of ['Angaben', 'Anbieter', 'Kontakt']) {
      assert.ok(!html.includes(german), `the impressum still reads "${german}"`);
    }
    assert.match(html, /Operator/i, 'the page does not say who the operator is');
    assert.match(html, /Contact/i, 'the page does not label the contact');
  });
});

/**
 * THE PRICE ON THE PAGE IS NOT THE PRICE AT THE TILL, and the page has to say so.
 *
 * Stripe adds VAT on top of the listed amount and remits it: a German customer
 * sees $12 here and is charged $14.28. Measured in the dashboard, not assumed.
 *
 * WHY THIS IS COPY RATHER THAN A PRICE CHANGE. Timestamp sells worldwide and
 * the rate depends on where the buyer is -- 19% in Germany, nothing in much of
 * the world. There is no single final price that is true for everyone, so the
 * honest thing is to say tax is added and let checkout compute it.
 */
test('the pricing page says tax is added at checkout', async () => {
  await withLegalServer({ entity: null }, async ({ base }) => {
    const html = await (await fetch(`${base}/pricing`)).text();
    assert.match(html, /VAT|sales tax/i, 'the pricing page never mentions tax');
    assert.match(html, /added at checkout|added at the checkout|where it applies|where applicable/i,
      'the page does not say the tax is added on top of the listed price');
  });
});

// ---------------------------------------------------------------------------
// the processor list, and the sentence that stops being true without it
// ---------------------------------------------------------------------------

/**
 * WHY THIS IS A TEST AND NOT A NOTE IN THE RUNBOOK.
 *
 * `/privacy` says the photograph goes to fal.ai "and to nobody else". That is
 * true today and it stops being true the moment image moderation is switched
 * on, because the photograph would then also go to a classifier. Section 52B
 * recorded the hazard in its own words -- "nothing in the code can notice" --
 * and left the switch off behind a paragraph of prose asking whoever flips it
 * to remember.
 *
 * A PARAGRAPH OF PROSE IS NOT A CONTROL. Two lines below that sentence, the
 * retention promise is interpolated from the very config the purge enforces,
 * so it cannot drift. The processor list was the only legally-significant claim
 * on the page still hardcoded, and it was the one most likely to be made false
 * by a deploy that never touched this file.
 *
 * THE DECLARATION IS SEPARATE FROM THE CREDENTIALS ON PURPOSE. Section 51E
 * split the environment so each container holds only the secrets its own
 * process reads -- the AWS keys are the worker's, and `/privacy` is rendered by
 * web, which never sees them. So web cannot derive the truth from the keys. It
 * reads a declaration instead, and the WORKER refuses to start when it holds
 * keys the declaration does not account for. That is the enforcement: you
 * cannot run a classifier this page has not disclosed, because the process that
 * would run it will not boot.
 */
test('with no classifier configured, the page still says fal and nobody else', () => {
  const html = privacyPage({ entity: ENTITY, retention: { photoDays: 7, jobDays: 30 } });
  assert.match(html, /fal\.ai/, 'the generation provider must always be named');
  assert.match(html, /nobody else/,
    'unconfigured, the photograph really does go to one processor and the page should say so');
});

test('a configured classifier is named, and "nobody else" stays true because the list grew', () => {
  // THE CLAIM IS NOT THE PROBLEM, THE LIST IS. "and to nobody else" is a
  // promise worth keeping and it is exactly as true with two processors as
  // with one -- provided the sentence names both. So the fix is to derive the
  // list rather than to delete the claim: a page that stopped saying "nobody
  // else" would be weaker, not safer, and would tell a reader less.
  const html = privacyPage({
    entity: ENTITY,
    retention: { photoDays: 7, jobDays: 30 },
    imageProcessor: 'Amazon Web Services (Rekognition), Frankfurt',
  });

  assert.match(html, /Amazon Web Services \(Rekognition\), Frankfurt/,
    'a configured classifier must be disclosed by name');
  assert.match(html, /fal\.ai/, 'the generation provider is still named');
  assert.match(html, /nobody else/,
    'the completeness claim should survive -- the list grew, the promise did not shrink');

  // AND IT MUST SAY WHAT THE CLASSIFIER IS FOR. Naming a company a photograph
  // is sent to, without saying why, is a disclosure that answers the wrong
  // question -- GDPR Art. 13 asks for the purpose, not just the recipient.
  assert.match(html, /illegal or abusive/i,
    'the page names a processor without saying what it does with the photograph');
});

test('the disclosed processor is escaped like every other operator-supplied value', () => {
  const html = privacyPage({
    entity: ENTITY,
    retention: { photoDays: 7, jobDays: 30 },
    imageProcessor: '<script>alert(1)</script>',
  });
  assert.ok(!/<script>alert/.test(html), 'the processor name reaches the page unescaped');
  assert.match(html, /&lt;script&gt;/, 'it should render as text');
});
