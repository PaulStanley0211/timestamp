/**
 * `npm run accounts -- <list|create|set-plan|grant|ledger|plans>` -- administering
 * the accounts and their credits without a database.
 *
 * WHY THIS EXISTS. There is no admin page and there should not be one yet: an
 * admin page is a login form with the power to hand out credits, reachable from
 * the internet, on an app that has not answered Phase 0. This is the same power,
 * reachable only by somebody already sitting at the machine with the files on
 * it. A shell prompt is a perfectly good access control when the operator is one
 * person.
 *
 * WHY grant AND set-plan LIVE HERE AND NOWHERE ELSE. Those two fields decide how
 * much somebody may spend, so the rule from docs/interfaces-app.md is that they
 * are set by an operator or by a future hosted-checkout webhook, never by a form
 * the user fills in. This file is the operator half of that sentence. It takes
 * no payment details of any kind, and neither does anything it calls -- there is
 * no payment code anywhere in scripts/auth/, and a test greps for the field
 * names that would mean there was.
 *
 * WHY create GENERATES THE PASSWORD BY DEFAULT. A password passed as `--password`
 * is in the shell history, in the process list, and on Windows quite possibly in
 * a transcript log. Generating one, printing it once and telling the operator to
 * hand it over is both safer and produces a better password than the one anybody
 * types at 11pm. `--password=` still works for the case where a person is
 * standing there choosing their own.
 *
 * Usage:
 *   npm run accounts -- list [--json]
 *   npm run accounts -- create --email=<addr> [--plan=free] [--password=<pw>] [--consent]
 *   npm run accounts -- set-plan --email=<addr>|--id=<accountId> --plan=<planId>
 *   npm run accounts -- grant <accountId> <credits> [--reason="..."]
 *   npm run accounts -- grant --email=<addr> --period
 *   npm run accounts -- ledger --email=<addr>|--id=<accountId> [--limit=20]
 *   npm run accounts -- plans
 *
 * Options: --json  --root=<dir>
 */

import process from 'node:process';
import crypto from 'node:crypto';

import {
  AuthError,
  DEFAULT_PLAN_ID,
  PLANS,
  PLAN_IDS,
  REPO_ROOT,
  createAccount,
  findAccountByEmail,
  listAccounts,
  loadAccount,
  setPlan,
  updateAccount,
} from './accounts.mjs';
import { CONSENT_TEXT } from '../safety/consent.mjs';
import {
  ALL_RESOLUTIONS,
  CREDIT_COSTS,
  CREDIT_DEFAULTS,
  RESOLUTIONS,
  balanceOf,
  creditCost,
  estimatedUSD,
  grantCredits,
  grantPlanPeriod,
  ledgerFor,
} from './credits.mjs';

const COMMANDS = ['list', 'create', 'set-plan', 'grant', 'ledger', 'plans'];

function parseArgs(argv) {
  const opts = { command: null, positional: [], flags: new Set(), values: {} };
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      if (rest.length === 0) opts.flags.add(key);
      else opts.values[key] = rest.join('=');
    } else if (opts.command === null) {
      opts.command = arg;
    } else {
      opts.positional.push(arg);
    }
  }
  return opts;
}

const pad = (s, w) => String(s).padEnd(w);

function table(rows, columns) {
  if (rows.length === 0) return '  (none)';
  const widths = columns.map(({ key, head }) =>
    Math.max(head.length, ...rows.map((r) => String(r[key] ?? '').length)));
  const line = (cells) => `  ${cells.map((c, i) => pad(c, widths[i])).join('  ')}`.trimEnd();
  return [
    line(columns.map((c) => c.head.toUpperCase())),
    ...rows.map((r) => line(columns.map((c) => (r[c.key] ?? '')))),
  ].join('\n');
}

/**
 * 20 characters from a 32-symbol alphabet is about 100 bits, which is far more
 * than scrypt needs to be safe and still short enough that somebody can read it
 * down a phone line. The alphabet drops the characters that get misread when
 * they are: no 0/O, no 1/l/I.
 */
function generatePassword() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  return [...crypto.randomBytes(20)].map((b) => alphabet[b % alphabet.length]).join('');
}

/** `--email=`, `--id=`, or the first positional. All resolve to a loaded
 *  account, and none is allowed to guess: an operator who mistypes an address
 *  must be told, not handed the nearest account. */
function resolveAccount({ root, values, positional }) {
  const id = values.id ?? positional[0];
  if (values.email) {
    const account = findAccountByEmail({ root, email: values.email });
    if (account === null) {
      throw new AuthError(`no account for ${values.email}`, {
        code: 'NO_ACCOUNT', userMessage: 'We could not find that account.',
      });
    }
    return account;
  }
  if (id) return loadAccount({ root, accountId: id });
  throw new AuthError('need --email=<addr>, --id=<accountId>, or an account id argument', { code: 'BAD_ARGS' });
}

/** What a plan's period grant actually buys, which is the only honest way to
 *  read a credit number. Live resolutions only -- offering somebody a count of
 *  tapes they cannot order is worse than saying nothing. */
function buys(credits) {
  return RESOLUTIONS
    .map((r) => `${Math.floor(credits / CREDIT_COSTS[r].creditsPerReference)}x ${r}`)
    .join(', ');
}

function usage() {
  console.log(`\nusage: npm run accounts -- <${COMMANDS.join('|')}> [options]\n`);
  console.log('  list                                       every account, with its plan and its balance');
  console.log('  create --email=<addr> [--plan=free]         make an account; prints a generated password');
  console.log('  set-plan --email=<addr> --plan=<planId>     change which plan somebody is on');
  console.log('  grant <accountId> <credits> --reason=..     add credits (negative corrects a mistake)');
  console.log('  grant --email=<addr> --period               grant one period of the account current plan');
  console.log('  ledger --email=<addr> [--limit=20]          every credit in and out, with a running balance');
  console.log('  plans                                       the plans, and what each grant buys\n');
  console.log('  --id=<accountId> works anywhere --email= does.');
  console.log('  --json  --root=<dir>\n');
  console.log('  create also takes --password=<pw> (visible in shell history) and --consent,');
  console.log('  which records agreement to the wording in scripts/safety/consent.mjs.\n');
  console.log('  Nothing here takes a payment. Credits are granted by an operator or, later,');
  console.log('  by a webhook from a hosted checkout that this process never sees.\n');
}

function main() {
  const { command, positional, flags, values } = parseArgs(process.argv.slice(2));
  const json = flags.has('json');
  const root = values.root ?? REPO_ROOT;

  if (command === null || flags.has('help') || flags.has('h')) {
    usage();
    process.exitCode = command === null ? 1 : 0;
    return;
  }
  if (!COMMANDS.includes(command)) {
    console.error(`\nunknown command ${JSON.stringify(command)}; expected one of ${COMMANDS.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  if (command === 'plans') {
    const rows = PLAN_IDS.map((id) => ({
      id,
      label: PLANS[id].label,
      monthly: `$${PLANS[id].monthlyUSD}`,
      annual: `$${PLANS[id].annualUSD}`,
      credits: PLANS[id].creditsPerPeriod,
      buys: buys(PLANS[id].creditsPerPeriod),
    }));
    if (json) {
      console.log(JSON.stringify({ plans: PLANS, costs: CREDIT_COSTS, defaults: CREDIT_DEFAULTS }, null, 2));
      return;
    }
    console.log('\ntimestamp plans\n');
    console.log(table(rows, [
      { key: 'id', head: 'plan' }, { key: 'label', head: 'label' },
      { key: 'monthly', head: 'monthly' }, { key: 'annual', head: 'annual/yr' },
      { key: 'credits', head: 'credits' }, { key: 'buys', head: 'which buys' },
    ]));
    console.log('\ncost of one 15-second tape\n');
    console.log(table(ALL_RESOLUTIONS.map((r) => ({
      r, size: `${CREDIT_COSTS[r].width}x${CREDIT_COSTS[r].height}`,
      cr: CREDIT_COSTS[r].creditsPerReference,
      usd: `~$${CREDIT_COSTS[r].estimatedUSDPer15s.toFixed(2)}`,
      state: CREDIT_COSTS[r].available ? 'live' : 'DEFERRED',
    })), [
      { key: 'r', head: 'resolution' }, { key: 'size', head: 'pixels' },
      { key: 'cr', head: 'credits' }, { key: 'usd', head: 'est. cost' },
      { key: 'state', head: 'state' },
    ]));
    console.log('\n  Every number above is an ESTIMATE until a --meter run proves it; the reasoning');
    console.log('  for each one is in config/credits.json -- including why 1080p is deferred and');
    console.log('  why 480p, which sits below the tape raster, is not a free lunch.');
    console.log('  Prices describe plans. Nothing here takes a payment.\n');
    return;
  }

  if (command === 'list') {
    const accounts = listAccounts({ root });
    const rows = accounts.map((account) => {
      let balance;
      try {
        balance = balanceOf(account);
      } catch (err) {
        // One unreadable ledger must not hide the other two hundred accounts.
        balance = { credits: `ERR:${err.code}`, planId: account.plan };
      }
      return {
        id: account.accountId,
        email: account.email,
        plan: account.plan,
        credits: balance.credits,
        consent: account.consent?.granted === true ? 'yes' : 'no',
        created: account.createdAt.slice(0, 10),
      };
    });
    if (json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    console.log(`\ntimestamp accounts · ${accounts.length} account(s) · ${root}/out/accounts\n`);
    console.log(table(rows, [
      { key: 'id', head: 'accountId' }, { key: 'email', head: 'email' },
      { key: 'plan', head: 'plan' }, { key: 'credits', head: 'credits' },
      { key: 'consent', head: 'consent' }, { key: 'created', head: 'created' },
    ]));
    console.log('');
    return;
  }

  if (command === 'create') {
    if (!values.email) {
      console.error('\ncreate needs --email=<addr>\n');
      process.exitCode = 1;
      return;
    }
    const password = values.password ?? generatePassword();
    const generated = !values.password;
    const account = createAccount({
      root,
      email: values.email,
      password,
      plan: values.plan ?? DEFAULT_PLAN_ID,
      // An operator creating an account on somebody's behalf has not shown them
      // the wording, so consent is only recorded when it is explicitly
      // asserted. Defaulting it to true here would write a sentence claiming a
      // person agreed to something nobody showed them.
      consent: flags.has('consent') ? { granted: true, text: CONSENT_TEXT } : null,
    });
    const balance = balanceOf(account);

    if (json) {
      console.log(JSON.stringify({
        accountId: account.accountId, email: account.email, plan: account.plan,
        balance, password: generated ? password : undefined,
      }, null, 2));
      return;
    }
    console.log(`\ncreated ${account.email}\n`);
    console.log(`  accountId  ${account.accountId}`);
    console.log(`  plan       ${account.plan}`);
    console.log(`  credits    ${balance.credits} (${buys(balance.credits)})`);
    console.log(`  consent    ${account.consent ? `recorded ${account.consent.at}` : 'not recorded'}`);
    if (generated) {
      console.log(`\n  password   ${password}`);
      console.log('\n  That is the only time this is printed -- it is stored as a scrypt hash and');
      console.log('  cannot be read back. Hand it over out of band and have them change it.\n');
    } else {
      console.log('\n  Password taken from --password, which is now in your shell history.\n');
    }
    return;
  }

  if (command === 'set-plan') {
    const planId = values.plan ?? positional[1];
    if (!planId) {
      console.error(`\nset-plan needs --plan=<${PLAN_IDS.join('|')}>\n`);
      process.exitCode = 1;
      return;
    }
    const found = resolveAccount({ root, values, positional });
    const before = found.plan;
    // Through updateAccount, so an operator changing a plan while the web
    // process is debiting credits cannot silently write back a stale ledger and
    // hand out a free render.
    const { account } = updateAccount({ root, accountId: found.accountId }, (record) => {
      setPlan(record, planId);
    });
    const balance = balanceOf(account);

    if (json) {
      console.log(JSON.stringify({
        accountId: account.accountId, email: account.email, from: before, to: account.plan, balance,
      }, null, 2));
      return;
    }
    console.log(`\n${account.email}: ${before} -> ${account.plan}\n`);
    console.log(`  balance is unchanged at ${balance.credits} credits.`);
    console.log(`  ${PLANS[account.plan].label} grants ${PLANS[account.plan].creditsPerPeriod} credits per period --`);
    console.log('  run `grant --period` when the period actually starts.');
    console.log('\n  No money moved. This changes which plan a record says, not a subscription.\n');
    return;
  }

  if (command === 'grant') {
    const account = resolveAccount({ root, values, positional });
    let credits;
    let reason;
    if (flags.has('period')) {
      credits = PLANS[account.plan].creditsPerPeriod;
      reason = values.reason ?? `grant:period:${account.plan}`;
      grantPlanPeriod(account, { planId: account.plan });
    } else {
      credits = Number(values.credits ?? positional[1]);
      if (!Number.isInteger(credits) || credits === 0) {
        console.error('\ngrant needs a non-zero whole number of credits: `grant <accountId> 204`, or --period\n');
        process.exitCode = 1;
        return;
      }
      // A reason is required on a manual grant and defaulted on a period grant,
      // because a manual one is the entry somebody will be reading back in six
      // months asking what it was for.
      reason = values.reason ?? (credits > 0 ? 'grant:manual' : 'correction:manual');
      grantCredits(account, { credits, reason });
    }
    const balance = balanceOf(account);

    if (json) {
      console.log(JSON.stringify({ accountId: account.accountId, email: account.email, credits, reason, balance }, null, 2));
      return;
    }
    console.log(`\n${account.email}: ${credits > 0 ? '+' : ''}${credits} credits (${reason})\n`);
    console.log(`  balance    ${balance.credits} (${buys(balance.credits)})`);
    console.log(`  est. cost  ~$${estimatedUSD(balance.credits).toFixed(2)} of provider spend if it is all used at 480p`);
    console.log('\n  Recorded as one more line on the ledger. Nothing was edited and nothing was');
    console.log('  taken; `ledger` shows how the balance got to where it is.\n');
    return;
  }

  // ledger
  const account = resolveAccount({ root, values, positional });
  const all = ledgerFor(account);
  const limit = values.limit ? Number(values.limit) : 20;
  const shown = all.slice(-limit);

  if (json) {
    console.log(JSON.stringify({ accountId: account.accountId, email: account.email, ledger: all }, null, 2));
    return;
  }
  console.log(`\n${account.email} · ${all.length} entr${all.length === 1 ? 'y' : 'ies'}, showing the last ${shown.length}\n`);
  console.log(table(shown.map((entry) => ({
    at: entry.at.replace('T', ' ').slice(0, 19),
    delta: `${entry.delta > 0 ? '+' : ''}${entry.delta}`,
    balance: entry.balance,
    job: entry.jobId ?? '-',
    reason: entry.reason,
  })), [
    { key: 'at', head: 'when (UTC)' }, { key: 'delta', head: 'delta' },
    { key: 'balance', head: 'balance' }, { key: 'job', head: 'job' },
    { key: 'reason', head: 'reason' },
  ]));
  console.log(`\n  balance ${balanceOf(account).credits} credits. The ledger is append-only: the balance is the`);
  console.log('  sum of the deltas above and is never stored as a number that could disagree.\n');
}

try {
  main();
} catch (err) {
  if (err instanceof AuthError) {
    // `.message` here rather than `.userMessage`: the operator is the one person
    // who should see the specific reason, and hiding it from them is how a
    // five-second typo becomes a twenty-minute investigation.
    console.error(`\n${err.code}: ${err.message}\n`);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
