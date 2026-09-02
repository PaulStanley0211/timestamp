/**
 * Sessions, against a real filesystem.
 *
 * THE TEST THIS FILE EXISTS FOR is "a destroyed session is dead immediately".
 * Everything else here is supporting evidence for that one property, because it
 * is the property a JWT does not have and the reason this app does not use one:
 * a signed claim keeps working until it expires no matter what the server
 * thinks, and this application's result page is a video of a real person's face.
 * If that test ever goes red, or is ever "fixed" by making the cookie
 * self-validating, the logout button has become decorative.
 *
 * The secret race uses real `node:worker_threads` for the same reason
 * test/queue-race.test.js does: calling `sessionSecret` twice in one thread
 * proves nothing about two processes starting together, because the second call
 * simply observes the first one's finished work -- the one interleaving that
 * cannot fail. Two generators racing is not exotic; it is what `npm run web`
 * and `npm run worker` do on every fresh clone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  SESSION_COOKIE,
  SESSION_ID_RE,
  SESSION_TTL_MS,
  clearedSessionCookie,
  createSession,
  destroySession,
  destroySessionsForAccount,
  isSecureRequest,
  isValidSessionId,
  listSessions,
  parseCookies,
  readSession,
  readSessionFromCookie,
  sessionCookie,
  sessionPath,
  sessionSecret,
  sessionsRoot,
  signCookie,
  sweepExpiredSessions,
  verifyCookie,
} from '../scripts/auth/session.mjs';

const SESSION_URL = new URL('../scripts/auth/session.mjs', import.meta.url).href;

function makeRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-session-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir.replace(/\\/g, '/');
}

const T0 = Date.UTC(2026, 7, 20, 14, 45, 0);
const clock = (ms = T0) => () => new Date(ms);
const ACCOUNT = 'a3f19c0102030405060708090a0b0c0d';

// --------------------------------------------------------------------------
// ids and records
// --------------------------------------------------------------------------

test('a session id is 32 random bytes and nothing derived from the user', (t) => {
  const root = makeRoot(t);
  const secret = sessionSecret({ root });
  const first = createSession({ root, accountId: ACCOUNT, nowImpl: clock() });
  const second = createSession({ root, accountId: ACCOUNT, nowImpl: clock() });

  assert.match(first.sessionId, SESSION_ID_RE);
  assert.equal(Buffer.from(first.sessionId, 'hex').length, 32);
  assert.notEqual(first.sessionId, second.sessionId);
  // Nothing about the account may be recoverable from the id, and the id must
  // not be a function of the secret either.
  assert.ok(!first.sessionId.includes(ACCOUNT));
  assert.ok(!secret.includes(first.sessionId));

  assert.equal(first.expiresAt, new Date(T0 + SESSION_TTL_MS).toISOString());
  const record = readSession({ root, sessionId: first.sessionId, nowImpl: clock() });
  assert.equal(record.accountId, ACCOUNT);
  assert.deepEqual(Object.keys(record).sort(), ['accountId', 'createdAt', 'expiresAt', 'schemaVersion', 'sessionId']);
});

test('a session record stores nothing about where the person was sitting', (t) => {
  const root = makeRoot(t);
  const { sessionId } = createSession({ root, accountId: ACCOUNT, nowImpl: clock() });
  const raw = fs.readFileSync(sessionPath(root, sessionId), 'utf8').toLowerCase();
  // This service already holds a photograph of their face. An IP address and a
  // user agent alongside it would be a small convenience for support and a
  // permanent record of a named person's location.
  for (const field of ['ip', 'useragent', 'user-agent', 'address']) {
    assert.ok(!raw.includes(field), `a session record must not carry ${field}`);
  }
});

test('a session id is validated before it is ever concatenated into a path', (t) => {
  const root = makeRoot(t);
  for (const bad of ['..', '../../_secret', 'a/b', '', null, 'ZZ', 'A'.repeat(64), `${'a'.repeat(63)}g`]) {
    assert.equal(isValidSessionId(bad), false, `${JSON.stringify(bad)} is not a session id`);
    assert.equal(readSession({ root, sessionId: bad, nowImpl: clock() }), null);
    assert.equal(destroySession({ root, sessionId: bad }), false);
    assert.throws(() => sessionPath(root, bad), /BAD_SESSION_ID|unusable session id/);
  }
});

// --------------------------------------------------------------------------
// the property this file exists for
// --------------------------------------------------------------------------

test('a destroyed session is dead immediately, and its cookie is dead with it', (t) => {
  const root = makeRoot(t);
  const secret = sessionSecret({ root });
  const { sessionId } = createSession({ root, accountId: ACCOUNT, nowImpl: clock() });
  const cookie = `${SESSION_COOKIE}=${signCookie(sessionId, secret)}`;

  // Signed in.
  assert.equal(readSession({ root, sessionId, nowImpl: clock() }).accountId, ACCOUNT);
  assert.equal(readSessionFromCookie({ root, cookieHeader: cookie, secret, nowImpl: clock() }).accountId, ACCOUNT);

  assert.equal(destroySession({ root, sessionId }), true);

  // Dead. Not "dead at the next sweep", not "dead when the token expires in a
  // fortnight" -- dead on the very next read, holding the same still-perfectly-
  // signed cookie. A JWT would still be valid here, and that is the whole
  // argument for server-side records.
  assert.equal(readSession({ root, sessionId, nowImpl: clock() }), null);
  assert.equal(readSessionFromCookie({ root, cookieHeader: cookie, secret, nowImpl: clock() }), null);
  assert.equal(verifyCookie(signCookie(sessionId, secret), secret), sessionId,
    'the signature is still valid -- what changed is that the record is gone');
  assert.equal(fs.existsSync(sessionPath(root, sessionId)), false);

  // And logging out twice is not an error.
  assert.equal(destroySession({ root, sessionId }), false);
});

test('destroying every session for one account leaves the other accounts signed in', (t) => {
  const root = makeRoot(t);
  const mine = [1, 2, 3].map(() => createSession({ root, accountId: ACCOUNT, nowImpl: clock() }));
  const theirs = createSession({ root, accountId: 'ffffffffffffffffffffffffffffffff', nowImpl: clock() });

  assert.equal(destroySessionsForAccount({ root, accountId: ACCOUNT }), 3);
  for (const { sessionId } of mine) assert.equal(readSession({ root, sessionId, nowImpl: clock() }), null);
  assert.equal(readSession({ root, sessionId: theirs.sessionId, nowImpl: clock() }).accountId, theirs.accountId);
  assert.equal(listSessions({ root }).length, 1);
});

test('an expired session is already dead, and sweeping only removes the dead ones', (t) => {
  const root = makeRoot(t);
  const { sessionId, expiresAt } = createSession({ root, accountId: ACCOUNT, nowImpl: clock() });
  const expiry = Date.parse(expiresAt);

  assert.ok(readSession({ root, sessionId, nowImpl: clock(expiry - 1) }), 'valid up to the last millisecond');
  assert.equal(readSession({ root, sessionId, nowImpl: clock(expiry) }), null, 'and not at the boundary itself');
  assert.equal(readSession({ root, sessionId, nowImpl: clock(expiry + 60_000) }), null);

  const fresh = createSession({ root, accountId: ACCOUNT, ttlMs: SESSION_TTL_MS * 2, nowImpl: clock() });
  assert.equal(sweepExpiredSessions({ root, nowImpl: clock(expiry + 1) }), 1);
  assert.equal(listSessions({ root }).length, 1);
  assert.ok(readSession({ root, sessionId: fresh.sessionId, nowImpl: clock(expiry + 1) }));
});

test('a session record that is corrupt, foreign or renamed reads as signed out', (t) => {
  const root = makeRoot(t);
  const { sessionId } = createSession({ root, accountId: ACCOUNT, nowImpl: clock() });
  const file = sessionPath(root, sessionId);
  const good = JSON.parse(fs.readFileSync(file, 'utf8'));

  fs.writeFileSync(file, '{ not json');
  assert.equal(readSession({ root, sessionId, nowImpl: clock() }), null);

  fs.writeFileSync(file, JSON.stringify({ ...good, schemaVersion: 99 }));
  assert.equal(readSession({ root, sessionId, nowImpl: clock() }), null);

  // A record copied into another file's name would otherwise let one person's
  // cookie read another person's session.
  fs.writeFileSync(file, JSON.stringify({ ...good, sessionId: 'b'.repeat(64) }));
  assert.equal(readSession({ root, sessionId, nowImpl: clock() }), null);
});

// --------------------------------------------------------------------------
// the signature
// --------------------------------------------------------------------------

test('a cookie round-trips, and every tampered form of it comes back null', (t) => {
  const root = makeRoot(t);
  const secret = sessionSecret({ root });
  const other = 'f'.repeat(64);
  const value = 'a'.repeat(64);
  const signed = signCookie(value, secret);

  assert.equal(signed.split('.')[0], value, 'the value is not hidden; it is not a secret from its own holder');
  assert.equal(verifyCookie(signed, secret), value);

  for (const forged of [
    value,                                   // unsigned
    `${value}.`,                             // empty mac
    `.${signed.split('.')[1]}`,              // empty value
    `${'b'.repeat(64)}.${signed.split('.')[1]}`, // somebody else's id, our mac
    `${value}.${signed.split('.')[1].slice(0, -1)}x`, // one byte of the mac changed
    `${value}.${signed.split('.')[1]}extra`, // a longer mac
    signed.slice(0, -4),                     // a shorter one
    '', 'nonsense', null, undefined, 42,
  ]) {
    assert.equal(verifyCookie(forged, secret), null, `${JSON.stringify(forged)} must not verify`);
  }
  assert.equal(verifyCookie(signed, other), null, 'a cookie signed with another secret is not ours');
  assert.equal(verifyCookie(signed, ''), null);
});

test('the signature is checked before the filesystem is touched', (t) => {
  const root = makeRoot(t);
  const secret = sessionSecret({ root });
  const { sessionId } = createSession({ root, accountId: ACCOUNT, nowImpl: clock() });

  // The record genuinely exists. Presenting its id WITHOUT a valid signature
  // must still be a no -- which is only true if the HMAC is checked first. If
  // this ever passes, an attacker can make this process do a filesystem lookup
  // per request from a path they chose, and the signing was decoration.
  const unsigned = readSessionFromCookie({ root, cookieHeader: `${SESSION_COOKIE}=${sessionId}`, secret, nowImpl: clock() });
  assert.equal(unsigned, null);

  const wrongMac = readSessionFromCookie({
    root, cookieHeader: `${SESSION_COOKIE}=${sessionId}.${'A'.repeat(43)}`, secret, nowImpl: clock(),
  });
  assert.equal(wrongMac, null);

  // A well-formed signature over an id that has no record is also a no, and it
  // is a different code path -- this one does reach the filesystem, and must
  // come back empty-handed rather than throwing.
  assert.equal(readSessionFromCookie({
    root, cookieHeader: `${SESSION_COOKIE}=${signCookie('c'.repeat(64), secret)}`, secret, nowImpl: clock(),
  }), null);

  // The real thing still works, so the test above is not passing by accident.
  assert.equal(readSessionFromCookie({
    root, cookieHeader: `${SESSION_COOKIE}=${signCookie(sessionId, secret)}`, secret, nowImpl: clock(),
  }).accountId, ACCOUNT);
});

test('verifyCookie compares the MAC with timingSafeEqual', () => {
  // Source tripwire, same reasoning as the password one: a byte-at-a-time
  // compare of a MAC lets an attacker discover a valid signature for a value of
  // their choosing one byte at a time, and the way it gets lost is a refactor.
  const source = fs.readFileSync(new URL('../scripts/auth/session.mjs', import.meta.url), 'utf8');
  assert.match(source, /crypto\.timingSafeEqual\(presented, expected\)/);
  assert.doesNotMatch(source, /presented\s*===\s*expected|signed\s*===\s*expected/);
});

// --------------------------------------------------------------------------
// the secret
// --------------------------------------------------------------------------

test('the secret is generated once and read thereafter', (t) => {
  const root = makeRoot(t);
  const first = sessionSecret({ root });
  assert.equal(sessionSecret({ root }), first, 'a second call must not rotate it and log everybody out');
  assert.ok(first.length >= 64, 'at least 32 bytes, hex-encoded');

  const { secret: file } = sessionsRoot(root);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), first);

  // An empty or truncated secret would still "work" while being guessable, so
  // it is treated as absent and regenerated -- which invalidates the sessions
  // signed with it, and that is the correct trade.
  fs.writeFileSync(file, '   \n');
  const regenerated = sessionSecret({ root });
  assert.notEqual(regenerated, first);
  assert.ok(regenerated.length >= 64);
});

test('deleting the secret is the emergency lever, and it is not cached away', (t) => {
  const root = makeRoot(t);
  const secret = sessionSecret({ root });
  const { sessionId } = createSession({ root, accountId: ACCOUNT, nowImpl: clock() });
  const cookie = `${SESSION_COOKIE}=${signCookie(sessionId, secret)}`;
  assert.ok(readSessionFromCookie({ root, cookieHeader: cookie, nowImpl: clock() }));

  fs.rmSync(sessionsRoot(root).secret);
  const rotated = sessionSecret({ root });
  assert.notEqual(rotated, secret);
  // Every cookie signed with the old key is now unverifiable, in this same
  // process, without a restart. A module-level cache would have made this pass
  // for the wrong reason and the lever would do nothing in production.
  assert.equal(readSessionFromCookie({ root, cookieHeader: cookie, nowImpl: clock() }), null);
});

/**
 * Eight threads through one barrier, all calling `sessionSecret` on a fresh
 * install. Exactly one may generate; the other seven must adopt what it wrote.
 * The failure this catches is the "generate if missing" race, whose symptom in
 * production is users being randomly logged out with nothing in any log.
 */
test('8 threads generate the secret at once and all of them end up with the same one', async (t) => {
  const root = makeRoot(t);
  const COUNT = 8;
  const shared = new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT);
  const view = new Int32Array(shared);
  const [GUN, IN_FLIGHT, PEAK] = [0, 1, 2];

  const source = `
const { workerData, parentPort } = require('node:worker_threads');
const shared = new Int32Array(workerData.shared);
(async () => {
  const { sessionSecret } = await import(workerData.moduleUrl);
  parentPort.postMessage({ ready: true });
  Atomics.wait(shared, ${GUN}, 0);

  const depth = Atomics.add(shared, ${IN_FLIGHT}, 1) + 1;
  let peak = Atomics.load(shared, ${PEAK});
  while (depth > peak) {
    const prev = Atomics.compareExchange(shared, ${PEAK}, peak, depth);
    if (prev === peak) break;
    peak = prev;
  }
  let result;
  try {
    result = { secret: sessionSecret({ root: workerData.root }) };
  } catch (err) {
    result = { error: err.code || String(err.message) };
  } finally {
    Atomics.sub(shared, ${IN_FLIGHT}, 1);
  }
  parentPort.postMessage({ result });
})().catch((err) => parentPort.postMessage({ result: { error: String(err && err.stack || err) } }));
`;

  const results = [];
  let ready = 0;
  await new Promise((resolve, reject) => {
    const workers = [];
    for (let i = 0; i < COUNT; i += 1) {
      const worker = new Worker(source, {
        eval: true,
        workerData: { moduleUrl: SESSION_URL, root, shared },
      });
      workers.push(worker);
      worker.on('error', reject);
      worker.on('message', (msg) => {
        if (msg.ready) {
          ready += 1;
          // One gun for everybody. Threads already parked wake here; threads
          // still arriving see the flag is 1 and never park.
          if (ready === COUNT) { Atomics.store(view, GUN, 1); Atomics.notify(view, GUN); }
          return;
        }
        results.push(msg.result);
        if (results.length === COUNT) Promise.all(workers.map((w) => w.terminate())).then(resolve, reject);
      });
    }
  });

  assert.deepEqual(results.filter((r) => r.error), [], 'no contender may throw');
  const secrets = new Set(results.map((r) => r.secret));
  assert.equal(secrets.size, 1, `all ${COUNT} threads must agree on one secret, got ${secrets.size}`);
  assert.equal([...secrets][0], fs.readFileSync(sessionsRoot(root).secret, 'utf8').trim());

  // WHY THIS STANDS THE RUN DOWN RATHER THAN FAILING IT.
  //
  // Every assertion above is unconditional and has already passed: nobody
  // threw, all eight agreed on one secret, and that secret is the one on disk.
  // What this last check establishes is something weaker -- that the eight
  // threads genuinely OVERLAPPED, so that the agreement above was won against a
  // real race rather than against eight calls the scheduler happened to
  // serialise.
  //
  // On a loaded CI runner the scheduler can and does serialise them. Measured:
  // green on ubuntu node 24 at d6ec4b6 and red at cdb6fa0 minutes later with
  // `peak 1`, on a docs-only commit, while 22 consecutive local runs -- idle and
  // under eight cpu hogs -- never once failed to overlap. That is the shape this
  // file's own §4 names: a test whose margin is narrower than the machine's
  // variance is testing the machine.
  //
  // A race that did not happen proves nothing about a race that does, so there
  // is nothing here to fail. It is not a hole either: the forced-interleaving
  // test immediately below drives the exact `openSync(secret,'wx')` window
  // deterministically, every run, on every machine -- so the window is covered
  // whether or not this one overlaps. Same ruling as job-model's concurrent
  // reader, which stands itself down with its reason when its own count is zero.
  //
  // NOTE the suite then reports 3 skipped rather than the standing 2, and the
  // reason is printed beside it. That is deliberate: a run that could not
  // arrange the race should say so out loud rather than read as a clean pass.
  const peak = Atomics.load(view, PEAK);
  t.diagnostic(`peak concurrent sessionSecret() calls: ${peak} of ${COUNT}`);
  if (peak < 2) {
    t.skip(`the contenders never overlapped (peak ${peak} of ${COUNT}); the agreement above was not won against a real race, and the forced-interleaving test below covers this window deterministically`);
    return;
  }
});

/**
 * The same race, made deterministic.
 *
 * The eight-thread test above arranges a real race, so it catches this only
 * when the interleaving happens to occur -- measured on this machine with no
 * load at all, 5 rounds in 30. This one forces the exact interleaving.
 *
 * The window is `openSync(secret,'wx')` returning: the name exists and holds
 * nothing yet, because a create makes the NAME first and the CONTENT after. A
 * peer arriving here must WAIT for the contents. The version that instead read
 * it as empty, concluded "present but unusable" and deleted it went on to mint
 * a SECOND secret -- and in production that is every logged-in user thrown out
 * at once, with nothing in any log, because the process that started second
 * silently invalidated every cookie the first one had already signed.
 */
test('a peer that arrives mid-write adopts the secret instead of deleting it', async (t) => {
  const root = makeRoot(t);
  const { dir, secret: file } = sessionsRoot(root);
  fs.mkdirSync(dir, { recursive: true });
  const WINNER = 'a1'.repeat(32);

  // The peer is started FIRST and parked on a barrier, so that spawning it and
  // importing the module -- which under a loaded disk can take seconds --
  // happens outside the window under test rather than inside it. A newborn file
  // is only newborn for a bounded time, on purpose; a test that pays worker
  // startup out of that budget is measuring the machine, not the code.
  const gun = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const view = new Int32Array(gun);
  const worker = new Worker(
    `const { workerData, parentPort } = require('node:worker_threads');
     const gun = new Int32Array(workerData.gun);
     (async () => {
       const { sessionSecret } = await import(workerData.moduleUrl);
       parentPort.postMessage({ ready: true });
       Atomics.wait(gun, 0, 0);
       try { parentPort.postMessage({ secret: sessionSecret({ root: workerData.root }) }); }
       catch (err) { parentPort.postMessage({ error: err.code || String(err.message) }); }
     })();`,
    { eval: true, workerData: { moduleUrl: SESSION_URL, root, gun } },
  );
  t.after(() => worker.terminate());

  const ready = new Promise((resolve, reject) => {
    worker.on('error', reject);
    worker.on('message', (msg) => { if (msg.ready) resolve(); });
  });
  const settled = new Promise((resolve, reject) => {
    worker.on('error', reject);
    worker.on('message', (msg) => { if (!msg.ready) resolve(msg); });
  });
  await ready;

  // Now stand in for the winner, stopped at the instant the name exists and
  // holds nothing, and release the peer into exactly that instant.
  const fd = fs.openSync(file, 'wx', 0o600);
  t.after(() => { try { fs.closeSync(fd); } catch { /* already closed */ } });
  assert.equal(fs.statSync(file).size, 0, 'the window under test is a name with no contents');
  Atomics.store(view, 0, 1);
  Atomics.notify(view, 0);

  // Finish the winner's write a long way inside the window the peer is required
  // to tolerate, so the margin is a proportion of that window rather than a
  // wall-clock budget competing with the rest of the suite. A peer slow enough
  // to arrive after this line still passes -- it reads a complete file.
  await new Promise((r) => setTimeout(r, 150));
  fs.writeFileSync(fd, `${WINNER}\n`);
  fs.fsyncSync(fd);
  fs.closeSync(fd);

  const result = await settled;
  assert.equal(result.error, undefined, 'a peer inside the window must not fail');
  assert.equal(result.secret, WINNER, 'the peer must adopt the winner secret, not mint a second one');
  assert.equal(
    fs.readFileSync(file, 'utf8').trim(), WINNER,
    'and it must not have deleted the file the winner was writing',
  );
});

// --------------------------------------------------------------------------
// the HTTP edge
// --------------------------------------------------------------------------

test('the Set-Cookie header carries HttpOnly, SameSite=Lax and Path=/, always', (t) => {
  const root = makeRoot(t);
  const secret = sessionSecret({ root });
  const { sessionId, expiresAt } = createSession({ root, accountId: ACCOUNT, nowImpl: clock() });

  const plain = sessionCookie({ sessionId, secret, expiresAt, secure: false, nowImpl: clock() });
  assert.match(plain, new RegExp(`^${SESSION_COOKIE}=${sessionId}\\.[A-Za-z0-9_-]+;`));
  assert.match(plain, /(^|; )HttpOnly(;|$)/, 'one injected script must not be able to read every login');
  assert.match(plain, /(^|; )SameSite=Lax(;|$)/, 'another site must not be able to spend this user quota');
  assert.match(plain, /(^|; )Path=\/(;|$)/);
  assert.match(plain, /Max-Age=1209600/, 'the browser expiry is derived from the record, so they cannot disagree');
  assert.doesNotMatch(plain, /Secure/, 'Secure over plain http would make local development impossible');

  const tls = sessionCookie({ sessionId, secret, expiresAt, secure: true, nowImpl: clock() });
  assert.match(tls, /(^|; )Secure(;|$)/, 'and over TLS a login cookie must never travel in clear text');

  const cleared = clearedSessionCookie({ secure: true });
  assert.match(cleared, /Max-Age=0/);
  // The attributes have to match the ones it was set with, or the browser keeps
  // the original alongside this one and the user appears to stay signed in.
  for (const attr of [/HttpOnly/, /SameSite=Lax/, /Path=\//, /Secure/]) assert.match(cleared, attr);
});

test('Secure is set from the connection, not from a header a stranger can type', () => {
  assert.equal(isSecureRequest({ socket: { encrypted: true }, headers: {} }), true);
  assert.equal(isSecureRequest({ socket: {}, headers: {} }), false);

  // The proxy header is believed only when somebody configured a proxy. Trusting
  // it by default lets any client turn Secure on or off by asking.
  const forwarded = { socket: {}, headers: { 'x-forwarded-proto': 'https' } };
  assert.equal(isSecureRequest(forwarded), false);
  assert.equal(isSecureRequest(forwarded, { trustProxy: true }), true);
  assert.equal(isSecureRequest({ socket: {}, headers: { 'x-forwarded-proto': 'https, http' } }, { trustProxy: true }), true);
  assert.equal(isSecureRequest({ socket: {}, headers: { 'x-forwarded-proto': 'http' } }, { trustProxy: true }), false);
  assert.equal(isSecureRequest(undefined), false);
});

test('parseCookies keeps the first value for a name and ignores the rest', () => {
  // A browser sends the most specific cookie first. Letting a later one
  // overwrite it would let anybody who can set a cookie on a parent domain
  // shadow the real session by appending a second one with the same name.
  const parsed = parseCookies(`${SESSION_COOKIE}=real; ${SESSION_COOKIE}=forged; other=x`);
  assert.equal(parsed[SESSION_COOKIE], 'real');
  assert.equal(parsed.other, 'x');

  // Spread, because the result has a null prototype on purpose and
  // deepStrictEqual counts that as a difference.
  assert.deepEqual({ ...parseCookies('') }, {});
  assert.deepEqual({ ...parseCookies(undefined) }, {});
  assert.deepEqual({ ...parseCookies('novalue; =nokey; ;') }, {});
  assert.equal(parseCookies('a="quoted"').a, 'quoted');
  assert.equal(parseCookies('a=%2Fslash').a, '/slash');
  assert.equal(parseCookies('a=%zz').a, '%zz', 'a cookie we did not write keeps its bytes rather than throwing');
  // The parsed object has a null prototype, so a cookie called `__proto__`
  // cannot reach anything.
  assert.equal(Object.getPrototypeOf(parseCookies('a=b')), null);
});
