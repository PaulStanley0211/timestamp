/**
 * Accounts, against a real filesystem.
 *
 * A temp directory rather than an injected fs, on the same reasoning as
 * test/job-model.test.js: every property this module actually has to hold --
 * the email index is exclusive, a duplicate signup leaves no orphan, a save
 * against a stale copy is refused, no `.tmp` survives -- is a property of the
 * filesystem underneath, and a fake fs would let all four pass while a real
 * person was locked out of their account.
 *
 * The security assertions get more space than the happy path, deliberately. A
 * broken login fails the first time anybody tries it. A login that quietly
 * answers "no such account" for one case and "wrong password" for the other
 * works perfectly and is an account-enumeration oracle for as long as it is
 * deployed, and nobody finds that by using the app.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ACCOUNT_ID_RE,
  AuthError,
  BAD_CREDENTIALS_MESSAGE,
  DEFAULT_PLAN_ID,
  PASSWORD,
  PLANS,
  PLAN_IDS,
  SCHEMA_VERSION,
  SCRYPT,
  accountPaths,
  creditConfig,
  accountsRoot,
  assertPlanId,
  authenticate,
  createAccount,
  emailHash,
  findAccountByEmail,
  hashPassword,
  listAccounts,
  loadAccount,
  newAccountId,
  normaliseEmail,
  parsePassword,
  planFor,
  saveAccount,
  setPlan,
  updateAccount,
  verifyPassword,
} from '../scripts/auth/accounts.mjs';
import { CONSENT_TEXT, consentText } from '../scripts/safety/consent.mjs';

// --------------------------------------------------------------------------
// harness
// --------------------------------------------------------------------------

const AUTH_DIR = new URL('../scripts/auth/', import.meta.url);

function makeRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-accounts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir.replace(/\\/g, '/');
}

const T0 = Date.UTC(2026, 7, 20, 14, 45, 0);
const clock = (ms = T0) => () => new Date(ms);

const PW = 'correct-horse-battery';

function signUp(root, { email = 'paul@example.com', password = PW, plan, consent, at = T0 } = {}) {
  return createAccount({ root, email, password, plan, consent, nowImpl: clock(at) });
}

/** The thrown error itself, for the cases where the assertion is about two
 *  errors being indistinguishable rather than about one error matching. */
function grab(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw and got none');
}

/** Every file under a directory, relative and forward-slashed. Used to prove
 *  that nothing temporary survives a write. */
function walk(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(`${dir}/${entry.name}`, rel));
    else out.push(rel);
  }
  return out;
}

// --------------------------------------------------------------------------
// password storage
// --------------------------------------------------------------------------

test('a stored password is scrypt$N$r$p$salt$hash and carries its own parameters', () => {
  const encoded = hashPassword(PW);
  const [scheme, N, r, p, salt, hash] = encoded.split('$');

  assert.equal(scheme, 'scrypt');
  assert.equal(Number(N), SCRYPT.N);
  assert.equal(Number(r), SCRYPT.r);
  assert.equal(Number(p), SCRYPT.p);
  assert.equal(Buffer.from(salt, 'base64').length, 16, 'the salt is 16 bytes, per the spec');
  assert.equal(Buffer.from(hash, 'base64').length, SCRYPT.keylen);

  // The plaintext must not be recoverable from, or visible in, the record.
  assert.ok(!encoded.includes(PW));
});

test('the parameters in the string are what verification uses, so the cost can be raised later', () => {
  // A record written at a deliberately lower cost -- what an account created
  // three years ago looks like after SCRYPT.N has been raised twice.
  const old = hashPassword(PW, { params: { ...SCRYPT, N: 1024 } });
  assert.equal(parsePassword(old).N, 1024);
  assert.equal(verifyPassword({ password: old }, PW), true,
    'an old record must keep working at its own cost, or raising N logs everybody out permanently');
  assert.equal(verifyPassword({ password: old }, 'wrong-password-here'), false);

  // And a record written at a different keylen verifies too, because keylen is
  // read from the stored hash rather than from today's constant. Getting this
  // wrong is not a wrong answer, it is timingSafeEqual throwing on the login
  // path for every pre-existing account at once.
  const other = hashPassword(PW, { params: { ...SCRYPT, keylen: 32 } });
  assert.equal(Buffer.from(other.split('$')[5], 'base64').length, 32);
  assert.equal(verifyPassword({ password: other }, PW), true);
});

test('two accounts with the same password get different salts and different hashes', (t) => {
  const root = makeRoot(t);
  const a = signUp(root, { email: 'a@example.com' });
  const b = signUp(root, { email: 'b@example.com' });

  assert.notEqual(a.password, b.password, 'a shared digest means one rainbow table opens every account');
  assert.notEqual(parsePassword(a.password).salt.toString('hex'), parsePassword(b.password).salt.toString('hex'));
  assert.equal(verifyPassword(a, PW), true);
  assert.equal(verifyPassword(b, PW), true);
});

test('a malformed or hand-edited password record fails closed instead of throwing', () => {
  for (const broken of [
    undefined, null, 42, '', 'not-a-hash', 'scrypt$16384$8$1$onlyfive',
    'bcrypt$16384$8$1$AAAA$AAAA', 'scrypt$x$8$1$AAAA$AAAA', 'scrypt$16384$8$1$$AAAA',
    `${hashPassword(PW)}$extra`,
  ]) {
    assert.equal(verifyPassword({ password: broken }, PW), false, `${JSON.stringify(broken)} must be a no, not a crash`);
  }
  // A truncated hash is the one that nearly got through, and it is worth
  // spelling out: scrypt ends in a single-iteration PBKDF2, so its output at a
  // short keylen is a PREFIX of its output at a long one. Because verification
  // reads the key length from the stored hash -- which it has to -- a record
  // truncated to six bytes verified against the correct password and was
  // brute-forceable in seconds. MIN_HASH_BYTES is what refuses it.
  const truncated = hashPassword(PW).split('$').map((part, i) => (i === 5 ? part.slice(0, 8) : part)).join('$');
  assert.equal(Buffer.from(truncated.split('$')[5], 'base64').length, 6);
  assert.equal(verifyPassword({ password: truncated }, PW), false);
  assert.equal(parsePassword(truncated), null);
});

test('verifyPassword compares with timingSafeEqual and never with a string compare', () => {
  // A source tripwire, not a proof. The property -- that the comparison does not
  // return early on the first differing byte -- is not observable from outside
  // without a statistical timing rig, and the way it gets lost is somebody
  // "simplifying" the comparison during a refactor. This catches that.
  const source = fs.readFileSync(new URL('accounts.mjs', AUTH_DIR), 'utf8');
  assert.match(source, /crypto\.timingSafeEqual\(candidate, parsed\.hash\)/);
  assert.doesNotMatch(source, /===\s*parsed\.hash|parsed\.hash\s*===/);
  assert.doesNotMatch(source, /\.password\s*===\s*/);
});

test('passwords are bounded at both ends', (t) => {
  const root = makeRoot(t);
  const short = 'a'.repeat(PASSWORD.minChars - 1);
  assert.throws(() => signUp(root, { password: short }), (err) => {
    assert.equal(err.code, 'BAD_PASSWORD');
    assert.match(err.userMessage, /at least/);
    return true;
  });
  // scrypt is memory-hard by design, so an unbounded password field is a
  // denial-of-service request wearing a login form.
  assert.throws(() => signUp(root, { password: 'a'.repeat(PASSWORD.maxBytes + 1) }), /exceeds/);
  assert.equal(verifyPassword({ password: hashPassword(PW) }, 'a'.repeat(PASSWORD.maxBytes + 1)), false);
});

// --------------------------------------------------------------------------
// email
// --------------------------------------------------------------------------

test('email is normalised in exactly one place, so capitalisation cannot fork an account', (t) => {
  const root = makeRoot(t);
  assert.equal(normaliseEmail('  Paul@Example.COM '), 'paul@example.com');
  assert.equal(emailHash('  Paul@Example.COM '), emailHash('paul@example.com'));

  const account = signUp(root, { email: 'Paul@Example.com' });
  assert.equal(account.email, 'paul@example.com');

  assert.throws(() => signUp(root, { email: ' PAUL@EXAMPLE.COM ' }), (err) => {
    assert.equal(err.code, 'EMAIL_TAKEN');
    return true;
  });
  assert.equal(findAccountByEmail({ root, email: 'PAUL@example.com ' }).accountId, account.accountId);
});

test('a duplicate signup leaves no orphan account directory behind', (t) => {
  const root = makeRoot(t);
  const first = signUp(root);
  const before = fs.readdirSync(accountsRoot(root).dir).filter((n) => ACCOUNT_ID_RE.test(n));

  assert.throws(() => signUp(root, { password: 'a-different-password' }), /EMAIL_TAKEN|already exists/);

  const after = fs.readdirSync(accountsRoot(root).dir).filter((n) => ACCOUNT_ID_RE.test(n));
  assert.deepEqual(after, before, 'the losing signup must clean up the record it wrote');
  assert.deepEqual(after, [first.accountId]);
  // And the surviving account still belongs to whoever registered first.
  assert.equal(verifyPassword(loadAccount({ root, accountId: first.accountId }), PW), true);
});

test('the index directory is a list of hashes, not a list of everybody email address', (t) => {
  const root = makeRoot(t);
  signUp(root, { email: 'paul@example.com' });
  signUp(root, { email: 'someone.else@example.org' });

  const { index } = accountsRoot(root);
  const names = fs.readdirSync(index);
  assert.equal(names.length, 2);
  for (const name of names) {
    assert.match(name, /^[0-9a-f]{64}\.json$/);
    const body = fs.readFileSync(`${index}/${name}`, 'utf8');
    assert.ok(!body.includes('@'), 'the index entry points at an account and says nothing else');
    assert.deepEqual(Object.keys(JSON.parse(body)), ['accountId']);
  }
});

test('an unusable email is refused before anything is written', (t) => {
  const root = makeRoot(t);
  for (const bad of ['', '   ', 'nope', 'no@domain', 'two@@at.com', 'with space@example.com', `${'a'.repeat(250)}@example.com`, null, 7]) {
    assert.throws(() => signUp(root, { email: bad }), (err) => {
      assert.equal(err.code, 'BAD_EMAIL');
      assert.match(err.userMessage, /email address/);
      return true;
    }, `${JSON.stringify(bad)} must be refused`);
  }
  assert.deepEqual(listAccounts({ root }), []);
});

// --------------------------------------------------------------------------
// records
// --------------------------------------------------------------------------

test('an account round-trips through disk with exactly the fields it was written with', (t) => {
  const root = makeRoot(t);
  const account = signUp(root);
  const loaded = loadAccount({ root, accountId: account.accountId, nowImpl: clock() });

  assert.deepEqual(JSON.parse(JSON.stringify(loaded)), JSON.parse(JSON.stringify(account)));
  assert.deepEqual(Object.keys(loaded).sort(), [
    'accountId', 'consent', 'createdAt', 'email', 'emailHash', 'ledger',
    'password', 'plan', 'rev', 'schemaVersion', 'updatedAt',
  ]);
  assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
  assert.equal(loaded.plan, DEFAULT_PLAN_ID);
  // An account that exists with no ledger line is an account whose balance is
  // zero for a reason nothing recorded.
  assert.deepEqual(loaded.ledger, [{
    at: new Date(T0).toISOString(),
    delta: PLANS.free.creditsPerPeriod,
    jobId: null,
    reason: 'grant:signup',
  }]);
  assert.equal(loaded.createdAt, new Date(T0).toISOString());
  assert.match(loaded.accountId, ACCOUNT_ID_RE);

  // root/paths/nowImpl are attached non-enumerably, so the object IS the record.
  assert.equal(loaded.root, path.resolve(root).replace(/\\/g, '/'));
  assert.equal(loaded.paths.record, accountPaths(root, account.accountId).record);
});

test('no temporary file survives a create or a save', (t) => {
  const root = makeRoot(t);
  const account = signUp(root);
  setPlan(account, 'shelf');
  saveAccount(account);

  const leftovers = walk(accountsRoot(root).dir).filter((f) => f.includes('.tmp'));
  assert.deepEqual(leftovers, [], 'tmp + rename means the tmp is gone; a stray one is a half-written account');
});

test('saving against a copy that has gone stale is refused rather than silently winning', (t) => {
  const root = makeRoot(t);
  const account = signUp(root);

  // Two readers of the same account. This is the web process and the operator
  // CLI, or two requests, and without the rev check the second save silently
  // erases whatever the first one did -- most likely a quota consumption.
  const a = loadAccount({ root, accountId: account.accountId, nowImpl: clock() });
  const b = loadAccount({ root, accountId: account.accountId, nowImpl: clock() });

  setPlan(a, 'shelf');
  saveAccount(a);
  assert.equal(a.rev, 1);

  setPlan(b, 'archive');
  assert.throws(() => saveAccount(b), (err) => {
    assert.equal(err.code, 'STALE_WRITE');
    assert.ok(!err.userMessage.includes(root));
    return true;
  });
  assert.equal(loadAccount({ root, accountId: account.accountId }).plan, 'shelf', 'the first write stands');
});

test('updateAccount reloads inside the lock, so it cannot lose the other writer edit', (t) => {
  const root = makeRoot(t);
  const account = signUp(root);
  const stale = loadAccount({ root, accountId: account.accountId, nowImpl: clock() });

  updateAccount({ root, accountId: account.accountId, nowImpl: clock() }, (record) => {
    record.ledger = [...record.ledger,
      { at: new Date(T0).toISOString(), delta: -68, jobId: '20260820-144501-a3f19c', reason: 'render' }];
  });

  // `stale` still thinks the ledger has one line. An update through the lock
  // does not care what it thinks.
  assert.equal(stale.ledger.length, 1);
  const { account: after } = updateAccount({ root, accountId: account.accountId, nowImpl: clock() }, (record) => {
    setPlan(record, 'archive');
  });
  assert.equal(after.plan, 'archive');
  assert.equal(after.ledger.length, 2, 'the plan change must not have erased the debit');
});

test('an account id is validated before it is concatenated into a path', (t) => {
  const root = makeRoot(t);
  for (const bad of ['..', '../../etc/passwd', 'a/b', 'CON', '', null, 'ZZZZ', 'abc']) {
    assert.throws(() => loadAccount({ root, accountId: bad }), (err) => {
      assert.equal(err.code, 'BAD_ACCOUNT_ID');
      return true;
    }, `${JSON.stringify(bad)} must never become a path`);
  }
  assert.throws(() => loadAccount({ root, accountId: newAccountId() }), (err) => {
    assert.equal(err.code, 'NO_ACCOUNT');
    assert.equal(err.userMessage, 'We could not find that account.');
    return true;
  });
});

test('a record whose schemaVersion is unknown is refused instead of guessed at', (t) => {
  const root = makeRoot(t);
  const account = signUp(root);
  const file = accountPaths(root, account.accountId).record;
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), schemaVersion: 99 }));

  assert.throws(() => loadAccount({ root, accountId: account.accountId }), (err) => {
    assert.equal(err.code, 'SCHEMA_VERSION');
    return true;
  });
  // And a corrupt account must not hide the healthy ones from the operator.
  signUp(root, { email: 'other@example.com' });
  assert.equal(listAccounts({ root }).length, 1);
});

// --------------------------------------------------------------------------
// plans and consent
// --------------------------------------------------------------------------

test('PLANS is frozen, has a monthly and an annual rate, and comes from config', () => {
  assert.deepEqual(PLAN_IDS, ['free', 'shelf', 'archive']);
  assert.ok(Object.isFrozen(PLANS) && Object.isFrozen(PLANS.free));

  for (const id of PLAN_IDS) {
    assert.deepEqual(Object.keys(PLANS[id]).sort(),
      ['annualUSD', 'creditsPerPeriod', 'id', 'label', 'monthlyUSD']);
    assert.equal(PLANS[id].id, id);
    assert.ok(Number.isInteger(PLANS[id].creditsPerPeriod) && PLANS[id].creditsPerPeriod > 0);
    // An annual rate that is not cheaper than twelve monthlies is not an annual
    // rate, it is a worse deal with a longer commitment.
    assert.ok(PLANS[id].annualUSD <= PLANS[id].monthlyUSD * 12, `${id} annual must not exceed 12 months`);
  }
  assert.equal(PLANS.free.monthlyUSD, 0);
  assert.equal(PLANS.shelf.monthlyUSD, 10);
  assert.equal(PLANS.archive.monthlyUSD, 12);

  // NOT HARDCODED. Every number is read from config/credits.json so that one
  // metered run can correct all of them in one edit -- the discipline
  // config/pricing.json already establishes.
  const cfg = creditConfig();
  for (const id of PLAN_IDS) {
    assert.equal(PLANS[id].creditsPerPeriod, cfg.plans[id].creditsPerPeriod);
    assert.equal(PLANS[id].monthlyUSD, cfg.plans[id].monthlyUSD);
    assert.equal(PLANS[id].annualUSD, cfg.plans[id].annualUSD);
    assert.match(cfg.plans[id]._comment, /ESTIMATE|cannot drift/,
      'every entry in the money path has to say whether it is an estimate');
  }
});

test('setPlan takes a known plan id and nothing else', (t) => {
  const root = makeRoot(t);
  const account = signUp(root, { plan: 'shelf' });
  assert.equal(account.plan, 'shelf');

  setPlan(account, 'archive');
  assert.equal(account.plan, 'archive');
  for (const bad of ['enterprise', '', null, 'FREE', undefined]) {
    assert.throws(() => setPlan(account, bad), (err) => {
      assert.equal(err.code, 'BAD_PLAN');
      return true;
    });
  }
  assert.equal(account.plan, 'archive', 'a rejected plan must not have been half-applied');
  assert.throws(() => signUp(root, { email: 'x@example.com', plan: 'enterprise' }), /BAD_PLAN|unknown plan/);
  assert.equal(assertPlanId('free'), 'free');
});

test('a record with an unrecognisable plan falls back downward, to the cheapest', () => {
  // Falling back to `archive` would hand out four free renders a month to
  // anything with a typo in it. Falling back to `free` costs a support email.
  assert.equal(planFor({ plan: 'gold' }).id, 'free');
  assert.equal(planFor({}).id, 'free');
  assert.equal(planFor(null).id, 'free');
  assert.equal(planFor({ plan: 'shelf' }).creditsPerPeriod, PLANS.shelf.creditsPerPeriod);
});

test('signup records the exact consent wording, and refuses a box that was not ticked', (t) => {
  const root = makeRoot(t);
  const account = signUp(root, { consent: { granted: true, text: CONSENT_TEXT } });

  assert.equal(account.consent.granted, true);
  assert.equal(account.consent.text, CONSENT_TEXT, 'the wording is stored verbatim, not a version number');
  assert.equal(account.consent.at, new Date(T0).toISOString());
  assert.equal(loadAccount({ root, accountId: account.accountId }).consent.text, CONSENT_TEXT);

  // Reused from scripts/safety/consent.mjs rather than reimplemented: the same
  // gate, so the same two wire encodings of "no" are still refused.
  for (const granted of [false, 'on', 'false', undefined, 1]) {
    assert.throws(() => signUp(root, { email: 'n@example.com', consent: { granted, text: CONSENT_TEXT } }),
      (err) => {
        assert.equal(err.name, 'ConsentError');
        return true;
      }, `granted=${JSON.stringify(granted)} must not be recorded as consent`);
  }
  assert.equal(listAccounts({ root }).length, 1);
});

test('an already-recorded consent block is accepted as-is, and a broken one is not', (t) => {
  const root = makeRoot(t);
  const older = consentText({ photoDays: 3, jobDays: 10 });
  const account = signUp(root, { consent: { granted: true, at: new Date(T0 - 60_000).toISOString(), text: older } });

  assert.equal(account.consent.text, older, 'consent to the wording that was shown, not to today\'s');
  assert.equal(account.consent.at, new Date(T0 - 60_000).toISOString());

  assert.throws(() => signUp(root, { email: 'z@example.com', consent: { granted: true, at: 'not-a-date', text: older } }),
    (err) => {
      assert.equal(err.name, 'ConsentError');
      return true;
    });
});

test('consent is optional in the signature, and absent means absent rather than assumed', (t) => {
  const root = makeRoot(t);
  const account = signUp(root);
  assert.equal(account.consent, null, 'a missing consent block must never be recorded as a granted one');
});

// --------------------------------------------------------------------------
// login
// --------------------------------------------------------------------------

test('authenticate returns the account for the right password', (t) => {
  const root = makeRoot(t);
  const account = signUp(root);
  const got = authenticate({ root, email: ' PAUL@example.com ', password: PW });
  assert.equal(got.accountId, account.accountId);
  assert.equal(got.email, 'paul@example.com');
});

test('a wrong password and an unknown email are the same error with the same message', (t) => {
  const root = makeRoot(t);
  signUp(root);

  const wrong = grab(() => authenticate({ root, email: 'paul@example.com', password: 'not-the-password' }));
  const unknown = grab(() => authenticate({ root, email: 'nobody@example.com', password: PW }));
  const malformed = grab(() => authenticate({ root, email: 'not-an-email', password: PW }));

  for (const err of [wrong, unknown, malformed]) {
    assert.ok(err instanceof AuthError);
    assert.equal(err.code, 'BAD_CREDENTIALS');
    assert.equal(err.userMessage, BAD_CREDENTIALS_MESSAGE);
    // The message a stranger sees must not name the address, the account, or
    // anything about the filesystem.
    assert.ok(!err.userMessage.includes('paul@example.com'));
    assert.ok(!err.userMessage.includes('nobody@example.com'));
    assert.ok(!err.userMessage.toLowerCase().includes('exist'));
  }
  assert.equal(wrong.userMessage, unknown.userMessage);
});

test('an unknown email costs the same work as a wrong password, so the timing is not an oracle', (t) => {
  const root = makeRoot(t);
  signUp(root);

  // A PROPORTION, not a wall-clock budget. `npm test` runs files in parallel,
  // so an absolute margin here would be measuring the machine's load rather
  // than the code -- the trap named in CLAUDE.md. The defect this guards
  // against is an early return on the unknown-email path, which drops it from
  // ~60ms of scrypt to under a millisecond: two orders of magnitude against a
  // 4x margin. The samples are interleaved so that a burst of load lands on
  // both arms equally.
  const known = [];
  const unknown = [];
  for (let i = 0; i < 5; i += 1) {
    let at = process.hrtime.bigint();
    try { authenticate({ root, email: 'paul@example.com', password: 'not-the-password' }); } catch { /* expected */ }
    known.push(Number(process.hrtime.bigint() - at));

    at = process.hrtime.bigint();
    try { authenticate({ root, email: `nobody-${i}@example.com`, password: 'not-the-password' }); } catch { /* expected */ }
    unknown.push(Number(process.hrtime.bigint() - at));
  }
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const knownMs = median(known) / 1e6;
  const unknownMs = median(unknown) / 1e6;

  t.diagnostic(`wrong password: ${knownMs.toFixed(1)}ms · unknown email: ${unknownMs.toFixed(1)}ms`);
  assert.ok(unknownMs > knownMs / 4,
    `an unknown email answered in ${unknownMs.toFixed(1)}ms against ${knownMs.toFixed(1)}ms for a wrong password -- that gap is an enumeration oracle`);
});

test('a dangling index entry reads as "no account", not as a crash on the login form', (t) => {
  const root = makeRoot(t);
  const account = signUp(root);
  // The shape a signup that died between writing the record and claiming the
  // index would leave, inverted: index present, record gone.
  fs.rmSync(accountPaths(root, account.accountId).dir, { recursive: true, force: true });

  assert.equal(findAccountByEmail({ root, email: 'paul@example.com' }), null);
  assert.throws(() => authenticate({ root, email: 'paul@example.com', password: PW }), (err) => {
    assert.equal(err.code, 'BAD_CREDENTIALS');
    return true;
  });
});

// --------------------------------------------------------------------------
// money safety
// --------------------------------------------------------------------------

test('there is no payment code anywhere in scripts/auth', () => {
  // The rule from docs/interfaces-app.md: nothing in this module may touch a
  // card number, a CVV or a bank detail. A tripwire rather than a review habit,
  // because the way this rule gets broken is one well-meant field added during
  // a hurry, and after that it is a field somebody feels obliged to populate.
  const forbidden = /\b(cardNumber|cardnumber|card_number|cvv|cvc|iban|routingNumber|sortCode|accountNumber|pan|stripeToken|paymentMethod)\b/i;
  for (const name of fs.readdirSync(AUTH_DIR)) {
    if (!name.endsWith('.mjs')) continue;
    const source = fs.readFileSync(new URL(name, AUTH_DIR), 'utf8');
    const hit = source.match(forbidden);
    assert.equal(hit, null, `scripts/auth/${name} mentions ${hit?.[0]} -- payment handling is out of scope and stays out`);
  }
});

test('an account record holds no field that could ever carry a payment instrument', (t) => {
  const root = makeRoot(t);
  const account = signUp(root, { plan: 'archive', consent: { granted: true, text: CONSENT_TEXT } });
  const onDisk = JSON.parse(fs.readFileSync(accountPaths(root, account.accountId).record, 'utf8'));

  assert.deepEqual(Object.keys(onDisk).sort(), [
    'accountId', 'consent', 'createdAt', 'email', 'emailHash', 'ledger',
    'password', 'plan', 'rev', 'schemaVersion', 'updatedAt',
  ], 'the record shape is closed: a new field here is a decision, not an accident');
  // `plan` is an id, not a price and not a subscription. Nothing here can be
  // charged.
  assert.equal(typeof onDisk.plan, 'string');
  assert.ok(Object.hasOwn(PLANS, onDisk.plan));
});
