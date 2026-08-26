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
  SUPABASE_INDEX_DIR,
  accountPaths,
  creditConfig,
  accountsRoot,
  assertPlanId,
  authenticate,
  claimAccount,
  createAccount,
  emailHash,
  findAccountByEmail,
  findAccountBySupabaseId,
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
async function grab(fn) {
  try {
    await fn();
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

test('a stored password is scrypt$N$r$p$salt$hash and carries its own parameters', async () => {
  const encoded = await hashPassword(PW);
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

test('the parameters in the string are what verification uses, so the cost can be raised later', async () => {
  // A record written at a deliberately lower cost -- what an account created
  // three years ago looks like after SCRYPT.N has been raised twice.
  const old = await hashPassword(PW, { params: { ...SCRYPT, N: 1024 } });
  assert.equal(parsePassword(old).N, 1024);
  assert.equal(await verifyPassword({ password: old }, PW), true,
    'an old record must keep working at its own cost, or raising N logs everybody out permanently');
  assert.equal(await verifyPassword({ password: old }, 'wrong-password-here'), false);

  // And a record written at a different keylen verifies too, because keylen is
  // read from the stored hash rather than from today's constant. Getting this
  // wrong is not a wrong answer, it is timingSafeEqual throwing on the login
  // path for every pre-existing account at once.
  const other = await hashPassword(PW, { params: { ...SCRYPT, keylen: 32 } });
  assert.equal(Buffer.from(other.split('$')[5], 'base64').length, 32);
  assert.equal(await verifyPassword({ password: other }, PW), true);
});

test('two accounts with the same password get different salts and different hashes', async (t) => {
  const root = makeRoot(t);
  const a = await signUp(root, { email: 'a@example.com' });
  const b = await signUp(root, { email: 'b@example.com' });

  assert.notEqual(a.password, b.password, 'a shared digest means one rainbow table opens every account');
  assert.notEqual(parsePassword(a.password).salt.toString('hex'), parsePassword(b.password).salt.toString('hex'));
  assert.equal(await verifyPassword(a, PW), true);
  assert.equal(await verifyPassword(b, PW), true);
});

test('a malformed or hand-edited password record fails closed instead of throwing', async () => {
  for (const broken of [
    undefined, null, 42, '', 'not-a-hash', 'scrypt$16384$8$1$onlyfive',
    'bcrypt$16384$8$1$AAAA$AAAA', 'scrypt$x$8$1$AAAA$AAAA', 'scrypt$16384$8$1$$AAAA',
    `${await hashPassword(PW)}$extra`,
  ]) {
    assert.equal(await verifyPassword({ password: broken }, PW), false, `${JSON.stringify(broken)} must be a no, not a crash`);
  }
  // A truncated hash is the one that nearly got through, and it is worth
  // spelling out: scrypt ends in a single-iteration PBKDF2, so its output at a
  // short keylen is a PREFIX of its output at a long one. Because verification
  // reads the key length from the stored hash -- which it has to -- a record
  // truncated to six bytes verified against the correct password and was
  // brute-forceable in seconds. MIN_HASH_BYTES is what refuses it.
  const truncated = (await hashPassword(PW)).split('$').map((part, i) => (i === 5 ? part.slice(0, 8) : part)).join('$');
  assert.equal(Buffer.from(truncated.split('$')[5], 'base64').length, 6);
  assert.equal(await verifyPassword({ password: truncated }, PW), false);
  assert.equal(parsePassword(truncated), null);
});

test('verifyPassword compares with timingSafeEqual and never with a string compare', async () => {
  // A source tripwire, not a proof. The property -- that the comparison does not
  // return early on the first differing byte -- is not observable from outside
  // without a statistical timing rig, and the way it gets lost is somebody
  // "simplifying" the comparison during a refactor. This catches that.
  const source = fs.readFileSync(new URL('accounts.mjs', AUTH_DIR), 'utf8');
  assert.match(source, /crypto\.timingSafeEqual\(candidate, parsed\.hash\)/);
  assert.doesNotMatch(source, /===\s*parsed\.hash|parsed\.hash\s*===/);
  assert.doesNotMatch(source, /\.password\s*===\s*/);
});

test('passwords are bounded at both ends', async (t) => {
  const root = makeRoot(t);
  const short = 'a'.repeat(PASSWORD.minChars - 1);
  await assert.rejects(() => signUp(root, { password: short }), (err) => {
    assert.equal(err.code, 'BAD_PASSWORD');
    assert.match(err.userMessage, /at least/);
    return true;
  });
  // scrypt is memory-hard by design, so an unbounded password field is a
  // denial-of-service request wearing a login form.
  await assert.rejects(() => signUp(root, { password: 'a'.repeat(PASSWORD.maxBytes + 1) }), /exceeds/);
  assert.equal(await verifyPassword({ password: await hashPassword(PW) }, 'a'.repeat(PASSWORD.maxBytes + 1)), false);
});

// --------------------------------------------------------------------------
// email
// --------------------------------------------------------------------------

test('email is normalised in exactly one place, so capitalisation cannot fork an account', async (t) => {
  const root = makeRoot(t);
  assert.equal(normaliseEmail('  Paul@Example.COM '), 'paul@example.com');
  assert.equal(emailHash('  Paul@Example.COM '), emailHash('paul@example.com'));

  const account = await signUp(root, { email: 'Paul@Example.com' });
  assert.equal(account.email, 'paul@example.com');

  await assert.rejects(() => signUp(root, { email: ' PAUL@EXAMPLE.COM ' }), (err) => {
    assert.equal(err.code, 'EMAIL_TAKEN');
    return true;
  });
  assert.equal(findAccountByEmail({ root, email: 'PAUL@example.com ' }).accountId, account.accountId);
});

test('a duplicate signup leaves no orphan account directory behind', async (t) => {
  const root = makeRoot(t);
  const first = await signUp(root);
  const before = fs.readdirSync(accountsRoot(root).dir).filter((n) => ACCOUNT_ID_RE.test(n));

  await assert.rejects(() => signUp(root, { password: 'a-different-password' }), /EMAIL_TAKEN|already exists/);

  const after = fs.readdirSync(accountsRoot(root).dir).filter((n) => ACCOUNT_ID_RE.test(n));
  assert.deepEqual(after, before, 'the losing signup must clean up the record it wrote');
  assert.deepEqual(after, [first.accountId]);
  // And the surviving account still belongs to whoever registered first.
  assert.equal(await verifyPassword(loadAccount({ root, accountId: first.accountId }), PW), true);
});

test('the index directory is a list of hashes, not a list of everybody email address', async (t) => {
  const root = makeRoot(t);
  await signUp(root, { email: 'paul@example.com' });
  await signUp(root, { email: 'someone.else@example.org' });

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

test('an unusable email is refused before anything is written', async (t) => {
  const root = makeRoot(t);
  for (const bad of ['', '   ', 'nope', 'no@domain', 'two@@at.com', 'with space@example.com', `${'a'.repeat(250)}@example.com`, null, 7]) {
    await assert.rejects(() => signUp(root, { email: bad }), (err) => {
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

test('an account round-trips through disk with exactly the fields it was written with', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  const loaded = loadAccount({ root, accountId: account.accountId, nowImpl: clock() });

  assert.deepEqual(JSON.parse(JSON.stringify(loaded)), JSON.parse(JSON.stringify(account)));
  assert.deepEqual(Object.keys(loaded).sort(), [
    'accountId', 'consent', 'createdAt', 'email', 'emailHash', 'ledger',
    'password', 'plan', 'rev', 'schemaVersion', 'supabaseUserId', 'updatedAt',
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

test('no temporary file survives a create or a save', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  setPlan(account, 'shelf');
  saveAccount(account);

  const leftovers = walk(accountsRoot(root).dir).filter((f) => f.includes('.tmp'));
  assert.deepEqual(leftovers, [], 'tmp + rename means the tmp is gone; a stray one is a half-written account');
});

test('saving against a copy that has gone stale is refused rather than silently winning', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);

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

test('updateAccount reloads inside the lock, so it cannot lose the other writer edit', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
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

test('an account id is validated before it is concatenated into a path', async (t) => {
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

test('a record whose schemaVersion is unknown is refused instead of guessed at', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  const file = accountPaths(root, account.accountId).record;
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), schemaVersion: 99 }));

  assert.throws(() => loadAccount({ root, accountId: account.accountId }), (err) => {
    assert.equal(err.code, 'SCHEMA_VERSION');
    return true;
  });
  // And a corrupt account must not hide the healthy ones from the operator.
  await signUp(root, { email: 'other@example.com' });
  assert.equal(listAccounts({ root }).length, 1);
});

// --------------------------------------------------------------------------
// plans and consent
// --------------------------------------------------------------------------

test('PLANS is frozen, has a monthly and an annual rate, and comes from config', async () => {
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

test('setPlan takes a known plan id and nothing else', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { plan: 'shelf' });
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
  await assert.rejects(() => signUp(root, { email: 'x@example.com', plan: 'enterprise' }), /BAD_PLAN|unknown plan/);
  assert.equal(assertPlanId('free'), 'free');
});

test('a record with an unrecognisable plan falls back downward, to the cheapest', async () => {
  // Falling back to `archive` would hand out four free renders a month to
  // anything with a typo in it. Falling back to `free` costs a support email.
  assert.equal(planFor({ plan: 'gold' }).id, 'free');
  assert.equal(planFor({}).id, 'free');
  assert.equal(planFor(null).id, 'free');
  assert.equal(planFor({ plan: 'shelf' }).creditsPerPeriod, PLANS.shelf.creditsPerPeriod);
});

test('signup records the exact consent wording, and refuses a box that was not ticked', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { consent: { granted: true, text: CONSENT_TEXT } });

  assert.equal(account.consent.granted, true);
  assert.equal(account.consent.text, CONSENT_TEXT, 'the wording is stored verbatim, not a version number');
  assert.equal(account.consent.at, new Date(T0).toISOString());
  assert.equal(loadAccount({ root, accountId: account.accountId }).consent.text, CONSENT_TEXT);

  // Reused from scripts/safety/consent.mjs rather than reimplemented: the same
  // gate, so the same two wire encodings of "no" are still refused.
  for (const granted of [false, 'on', 'false', undefined, 1]) {
    await assert.rejects(() => signUp(root, { email: 'n@example.com', consent: { granted, text: CONSENT_TEXT } }),
      (err) => {
        assert.equal(err.name, 'ConsentError');
        return true;
      }, `granted=${JSON.stringify(granted)} must not be recorded as consent`);
  }
  assert.equal(listAccounts({ root }).length, 1);
});

test('an already-recorded consent block is accepted as-is, and a broken one is not', async (t) => {
  const root = makeRoot(t);
  const older = consentText({ photoDays: 3, jobDays: 10 });
  const account = await signUp(root, { consent: { granted: true, at: new Date(T0 - 60_000).toISOString(), text: older } });

  assert.equal(account.consent.text, older, 'consent to the wording that was shown, not to today\'s');
  assert.equal(account.consent.at, new Date(T0 - 60_000).toISOString());

  await assert.rejects(() => signUp(root, { email: 'z@example.com', consent: { granted: true, at: 'not-a-date', text: older } }),
    (err) => {
      assert.equal(err.name, 'ConsentError');
      return true;
    });
});

test('consent is optional in the signature, and absent means absent rather than assumed', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  assert.equal(account.consent, null, 'a missing consent block must never be recorded as a granted one');
});

// --------------------------------------------------------------------------
// login
// --------------------------------------------------------------------------

test('authenticate returns the account for the right password', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  const got = await authenticate({ root, email: ' PAUL@example.com ', password: PW });
  assert.equal(got.accountId, account.accountId);
  assert.equal(got.email, 'paul@example.com');
});

test('a wrong password and an unknown email are the same error with the same message', async (t) => {
  const root = makeRoot(t);
  await signUp(root);

  const wrong = await grab(() => authenticate({ root, email: 'paul@example.com', password: 'not-the-password' }));
  const unknown = await grab(() => authenticate({ root, email: 'nobody@example.com', password: PW }));
  const malformed = await grab(() => authenticate({ root, email: 'not-an-email', password: PW }));

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

test('an unknown email costs the same work as a wrong password, so the timing is not an oracle', async (t) => {
  const root = makeRoot(t);
  await signUp(root);

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
    try { await authenticate({ root, email: 'paul@example.com', password: 'not-the-password' }); } catch { /* expected */ }
    known.push(Number(process.hrtime.bigint() - at));

    at = process.hrtime.bigint();
    try { await authenticate({ root, email: `nobody-${i}@example.com`, password: 'not-the-password' }); } catch { /* expected */ }
    unknown.push(Number(process.hrtime.bigint() - at));
  }
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const knownMs = median(known) / 1e6;
  const unknownMs = median(unknown) / 1e6;

  t.diagnostic(`wrong password: ${knownMs.toFixed(1)}ms · unknown email: ${unknownMs.toFixed(1)}ms`);
  assert.ok(unknownMs > knownMs / 4,
    `an unknown email answered in ${unknownMs.toFixed(1)}ms against ${knownMs.toFixed(1)}ms for a wrong password -- that gap is an enumeration oracle`);
});

/**
 * FOUR CELLS, NOT TWO. The test above pins known-vs-unknown for a normal
 * password. But "the same amount of work" has to hold for every password a
 * stranger can type, and an oversized one -- over PASSWORD.maxBytes, which any
 * client can send -- takes a DIFFERENT code path on each branch: the unknown
 * side burns equal work with a substitute, and the known side must not answer
 * early, or the wall clock says which addresses hold an account here. For
 * this product that disclosure is that a named person uploaded their face.
 *
 * Same discipline as above: a proportion with interleaved samples, never a
 * wall-clock budget. The defect this guards against is an early return that
 * skips the derivation entirely -- two orders of magnitude against a 4x
 * margin.
 */
test('an oversized password takes the same work as a normal one, on both branches', async (t) => {
  const root = makeRoot(t);
  await signUp(root);
  const oversized = 'a'.repeat(PASSWORD.maxBytes + 76);

  const cells = {
    'known-normal': { email: 'paul@example.com', password: 'not-the-password' },
    'unknown-normal': { email: 'nobody@example.com', password: 'not-the-password' },
    'known-oversized': { email: 'paul@example.com', password: oversized },
    'unknown-oversized': { email: 'nobody@example.com', password: oversized },
  };
  const samples = Object.fromEntries(Object.keys(cells).map((k) => [k, []]));
  for (let i = 0; i < 5; i += 1) {
    for (const [name, { email, password }] of Object.entries(cells)) {
      const at = process.hrtime.bigint();
      try { await authenticate({ root, email, password }); } catch { /* expected */ }
      samples[name].push(Number(process.hrtime.bigint() - at));
    }
  }
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const medians = Object.fromEntries(Object.entries(samples).map(([k, xs]) => [k, median(xs) / 1e6]));
  t.diagnostic(Object.entries(medians).map(([k, ms]) => `${k}: ${ms.toFixed(1)}ms`).join(' · '));

  const values = Object.values(medians);
  const fastest = Math.min(...values);
  const slowest = Math.max(...values);
  assert.ok(fastest > slowest / 4,
    `the fastest cell answered in ${fastest.toFixed(1)}ms against ${slowest.toFixed(1)}ms -- that gap is an enumeration oracle`);
});

/**
 * Whether anything else got to run while `work` was deriving. `setImmediate`
 * fires on the next turn of the event loop, so if the derivation holds the
 * loop for its whole ~30ms, the flag is still false at the moment the work
 * settles -- and one busy login has frozen every other request in the
 * process, including the Stripe webhook holding somebody's money.
 */
async function loopTurnedDuring(work) {
  let turned = false;
  setImmediate(() => { turned = true; });
  let turnedAtSettle = null;
  await Promise.resolve()
    .then(work)
    .catch(() => { /* a refusal is fine -- the assertion is about the loop */ })
    .finally(() => { turnedAtSettle = turned; });
  return turnedAtSettle;
}

test('the event loop keeps turning while a login attempt derives, on both branches', async (t) => {
  const root = makeRoot(t);
  await signUp(root);

  assert.equal(
    await loopTurnedDuring(() => authenticate({ root, email: 'paul@example.com', password: 'not-the-password' })),
    true,
    'a wrong-password check held the event loop for its whole derivation',
  );
  assert.equal(
    await loopTurnedDuring(() => authenticate({ root, email: 'nobody@example.com', password: 'not-the-password' })),
    true,
    'an unknown-email burn held the event loop for its whole derivation',
  );
});

test('the event loop keeps turning while a signup derives its hash', async (t) => {
  const root = makeRoot(t);
  assert.equal(
    await loopTurnedDuring(() => signUp(root, { email: 'busy@example.com' })),
    true,
    'a signup held the event loop for its whole derivation',
  );
});

test('a dangling index entry reads as "no account", not as a crash on the login form', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root);
  // The shape a signup that died between writing the record and claiming the
  // index would leave, inverted: index present, record gone.
  fs.rmSync(accountPaths(root, account.accountId).dir, { recursive: true, force: true });

  assert.equal(findAccountByEmail({ root, email: 'paul@example.com' }), null);
  await assert.rejects(() => authenticate({ root, email: 'paul@example.com', password: PW }), (err) => {
    assert.equal(err.code, 'BAD_CREDENTIALS');
    return true;
  });
});

// --------------------------------------------------------------------------
// money safety
// --------------------------------------------------------------------------

test('there is no payment code anywhere in scripts/auth', async () => {
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

test('an account record holds no field that could ever carry a payment instrument', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { plan: 'archive', consent: { granted: true, text: CONSENT_TEXT } });
  const onDisk = JSON.parse(fs.readFileSync(accountPaths(root, account.accountId).record, 'utf8'));

  assert.deepEqual(Object.keys(onDisk).sort(), [
    'accountId', 'consent', 'createdAt', 'email', 'emailHash', 'ledger',
    'password', 'plan', 'rev', 'schemaVersion', 'supabaseUserId', 'updatedAt',
  ], 'the record shape is closed: a new field here is a decision, not an accident');
  // `plan` is an id, not a price and not a subscription. Nothing here can be
  // charged.
  assert.equal(typeof onDisk.plan, 'string');
  assert.ok(Object.hasOwn(PLANS, onDisk.plan));
});

// --------------------------------------------------------------------------
// supabase identity
// --------------------------------------------------------------------------

test('an account can be claimed by a supabase id, and the password dies with the claim', async (t) => {
  const root = makeRoot(t);
  const made = await signUp(root, { email: 'claim@example.com' });
  assert.ok(made.password, 'precondition: a local hash exists');

  const claimed = await claimAccount({ root, accountId: made.accountId, supabaseUserId: 'uuid-claim' });
  assert.equal(claimed.supabaseUserId, 'uuid-claim');
  assert.equal(claimed.password, null, 'a hash that gates nothing is a liability');

  const found = findAccountBySupabaseId({ root, supabaseUserId: 'uuid-claim' });
  assert.equal(found.accountId, made.accountId);
});

test('claiming preserves the ledger exactly', async (t) => {
  const root = makeRoot(t);
  const made = await signUp(root, { email: 'ledger@example.com' });
  const before = JSON.stringify(made.ledger);
  const claimed = await claimAccount({ root, accountId: made.accountId, supabaseUserId: 'uuid-led' });
  assert.equal(JSON.stringify(claimed.ledger), before, 'a claim is not a new account');
  assert.equal(claimed.plan, made.plan);
});

test('an unknown supabase id is null, not a throw', async (t) => {
  const root = makeRoot(t);
  assert.equal(findAccountBySupabaseId({ root, supabaseUserId: 'nope' }), null);
});

// RULING R1: createAccount owns the passwordless-create path too, because
// Task 5's resolveIdentity calls `createAccount({ password: null, supabaseUserId })`
// directly on a genuinely new identity, and that call must land an account
// that is immediately findable -- not just a claim grafted onto an existing one.

test('createAccount refuses a passwordless signup with no supabase identity to take its place', async (t) => {
  const root = makeRoot(t);
  // This is the relaxation's guard rail: `password: null` alone must never be
  // enough. Without this test, a typo that drops `supabaseUserId` from a call
  // site would silently create an account nobody -- not a password, not a
  // Supabase login -- can ever sign in to again.
  await assert.rejects(
    () => createAccount({ root, email: 'no-identity@example.com', password: null, nowImpl: clock() }),
    (err) => {
      assert.equal(err.code, 'BAD_PASSWORD');
      return true;
    },
    'a null password with no supabaseUserId must still be refused',
  );
  assert.deepEqual(listAccounts({ root }), []);
});

test('createAccount stores and indexes a supabaseUserId at creation, immediately findable', async (t) => {
  const root = makeRoot(t);
  const supabaseUserId = 'uuid-create';
  const account = await createAccount({
    root, email: 'passwordless@example.com', password: null, supabaseUserId, nowImpl: clock(),
  });

  assert.equal(account.password, null);
  assert.equal(account.supabaseUserId, supabaseUserId);

  const found = findAccountBySupabaseId({ root, supabaseUserId });
  assert.equal(found.accountId, account.accountId);
  assert.equal(found.password, null);
  assert.ok(fs.existsSync(`${accountsRoot(root).dir}/${SUPABASE_INDEX_DIR}/${supabaseUserId}`));
});

test('an ordinary signup carries supabaseUserId: null and is not reachable through the supabase index', async (t) => {
  const root = makeRoot(t);
  const account = await signUp(root, { email: 'ordinary@example.com' });
  assert.equal(account.supabaseUserId, null);
  assert.equal(loadAccount({ root, accountId: account.accountId }).supabaseUserId, null);
});

test('a supabase id already claimed by a different account is refused, and the loser is left untouched', async (t) => {
  const root = makeRoot(t);
  const supabaseUserId = 'uuid-conflict';
  const first = await createAccount({
    root, email: 'first@example.com', password: null, supabaseUserId, nowImpl: clock(),
  });
  const second = await signUp(root, { email: 'second@example.com' });

  await assert.rejects(
    () => claimAccount({ root, accountId: second.accountId, supabaseUserId }),
    (err) => {
      assert.equal(err.code, 'SUPABASE_ID_TAKEN');
      return true;
    },
  );

  const reloaded = loadAccount({ root, accountId: second.accountId });
  assert.notEqual(reloaded.password, null, 'a rejected claim must not have thrown the password away');
  assert.equal(reloaded.supabaseUserId, null);
  assert.equal(findAccountBySupabaseId({ root, supabaseUserId }).accountId, first.accountId,
    'the winning claim must still stand');
});

test('createAccount refuses a supabaseUserId already claimed by another account, and cleans up after itself', async (t) => {
  const root = makeRoot(t);
  const supabaseUserId = 'uuid-double-create';
  const first = await createAccount({
    root, email: 'holder@example.com', password: null, supabaseUserId, nowImpl: clock(),
  });

  await assert.rejects(
    () => createAccount({
      root, email: 'newcomer@example.com', password: null, supabaseUserId, nowImpl: clock(),
    }),
    (err) => {
      assert.equal(err.code, 'SUPABASE_ID_TAKEN');
      return true;
    },
  );

  // The loser's email must be free again and its account directory gone --
  // the same orphan-free guarantee an email collision already gets.
  assert.equal(findAccountByEmail({ root, email: 'newcomer@example.com' }), null);
  assert.equal(findAccountBySupabaseId({ root, supabaseUserId }).accountId, first.accountId);
});

test('claiming the same account with the same supabase id twice is a no-op, not a conflict', async (t) => {
  const root = makeRoot(t);
  const supabaseUserId = 'uuid-retry';
  const made = await signUp(root, { email: 'retry@example.com' });

  await claimAccount({ root, accountId: made.accountId, supabaseUserId });
  const again = await claimAccount({ root, accountId: made.accountId, supabaseUserId });
  assert.equal(again.supabaseUserId, supabaseUserId);
  assert.equal(findAccountBySupabaseId({ root, supabaseUserId }).accountId, made.accountId);
});

test('claimAccount and createAccount both refuse a malformed supabaseUserId rather than writing an unfindable claim', async (t) => {
  const root = makeRoot(t);
  const made = await signUp(root, { email: 'malformed@example.com' });

  // A slash would otherwise become a path segment in the supabase index --
  // exactly the kind of string this module's account-id validation already
  // refuses to let anywhere near a path.
  await assert.rejects(
    () => claimAccount({ root, accountId: made.accountId, supabaseUserId: 'path/traversal' }),
    (err) => err instanceof TypeError,
  );
  await assert.rejects(
    () => createAccount({
      root, email: 'malformed2@example.com', password: null, supabaseUserId: 'path/traversal', nowImpl: clock(),
    }),
    (err) => err instanceof TypeError,
  );
  assert.equal(findAccountByEmail({ root, email: 'malformed2@example.com' }), null);
});

// -- review round 2: the index-before-existence bug, and the silent rebind --

test('a claim against a nonexistent accountId leaves no index entry behind and the id is still usable afterwards', async (t) => {
  const root = makeRoot(t);
  const ghost = newAccountId(); // well-formed, but nothing was ever created at it
  const supabaseUserId = 'uuid-ghost';

  await assert.rejects(
    () => claimAccount({ root, accountId: ghost, supabaseUserId }),
    (err) => {
      assert.equal(err.code, 'NO_ACCOUNT');
      return true;
    },
    'the account must be confirmed to exist before the index is touched at all',
  );

  const indexFile = `${accountsRoot(root).dir}/${SUPABASE_INDEX_DIR}/${supabaseUserId}`;
  assert.equal(fs.existsSync(indexFile), false,
    'a claim against an account that does not exist must not leave an index entry pointing at nothing');
  assert.equal(findAccountBySupabaseId({ root, supabaseUserId }), null);

  // And the id must still be usable by whoever actually owns it -- the whole
  // point of not writing the orphan in the first place.
  const real = await signUp(root, { email: 'ghost-recovery@example.com' });
  const claimed = await claimAccount({ root, accountId: real.accountId, supabaseUserId });
  assert.equal(claimed.supabaseUserId, supabaseUserId);
  assert.equal(findAccountBySupabaseId({ root, supabaseUserId }).accountId, real.accountId);
});

test('a second claim with a different id is refused, and the first index entry still resolves correctly', async (t) => {
  const root = makeRoot(t);
  const made = await signUp(root, { email: 'rebind@example.com' });

  await claimAccount({ root, accountId: made.accountId, supabaseUserId: 'uuid-first' });

  await assert.rejects(
    () => claimAccount({ root, accountId: made.accountId, supabaseUserId: 'uuid-second' }),
    (err) => {
      assert.equal(err.code, 'SUPABASE_ID_TAKEN');
      return true;
    },
    'a rebind is a decision an operator makes on purpose, never a side effect of a claim',
  );

  // The account must still say it belongs to the FIRST id, and the first
  // index entry must not have been disturbed by the refused second claim.
  assert.equal(loadAccount({ root, accountId: made.accountId }).supabaseUserId, 'uuid-first');
  assert.equal(findAccountBySupabaseId({ root, supabaseUserId: 'uuid-first' }).accountId, made.accountId);
  assert.equal(findAccountBySupabaseId({ root, supabaseUserId: 'uuid-second' }), null,
    'nothing must have been written for the id the rebind was refused for');
});

test('a second claim with the same id succeeds and repairs a missing index entry', async (t) => {
  const root = makeRoot(t);
  const supabaseUserId = 'uuid-repair';
  // The exact gap createAccount's own two-index-write ordering can leave
  // behind a crash in: the account record already carries the id (createAccount
  // sets it at creation), but its index entry is simulated missing here.
  const account = await createAccount({
    root, email: 'repair@example.com', password: null, supabaseUserId, nowImpl: clock(),
  });
  fs.rmSync(`${accountsRoot(root).dir}/${SUPABASE_INDEX_DIR}/${supabaseUserId}`, { force: true });
  assert.equal(findAccountBySupabaseId({ root, supabaseUserId }), null, 'precondition: the index is gone');

  const repaired = await claimAccount({ root, accountId: account.accountId, supabaseUserId });
  assert.equal(repaired.accountId, account.accountId);
  assert.equal(repaired.supabaseUserId, supabaseUserId);
  assert.equal(findAccountBySupabaseId({ root, supabaseUserId }).accountId, account.accountId,
    'a claim with the SAME id the account already carries must repair the missing index rather than refuse');
});
