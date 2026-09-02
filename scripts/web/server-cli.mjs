#!/usr/bin/env node
/**
 * `npm run web`. Starts the HTTP server and nothing else.
 *
 * WHY TWO PROCESSES IS THE DEFAULT AND THE DOCUMENTED SHAPE. The app never
 * renders and the worker never serves HTTP (docs/interfaces.md 8). That is not
 * tidiness: the entire look lives in ffmpeg, Vercel's serverless runtime has no
 * ffmpeg binary, and a design where the web process is also the render process
 * cannot be deployed anywhere the web half is supposed to go. Running them
 * together is a local convenience and it is spelled out as one.
 *
 * WHY `--with-worker` IMPORTS RATHER THAN SPAWNS. `scripts/ffmpeg/run.mjs` is
 * the only module in this repo permitted to spawn a process, and that rule does
 * not get an exception for developer convenience -- an exception is how a rule
 * with one exception becomes a rule with four. So the flag imports the worker's
 * `once()` and drives it on a timer inside this process. It is slower, it shares
 * a heap with the server, and it is honest about being a testing aid.
 *
 * WHY THIS FILE IS WHERE THE STRIPE TRANSPORT IS INJECTED, AND THE ONLY ONE.
 * `scripts/billing/stripe.mjs` has no default `fetchImpl`, for the same reason
 * `providers/fal.mjs` has none: a test that forgets to inject one must get a
 * `TypeError` rather than a bill. That guard only works if production actually
 * injects it somewhere, and `scripts/providers/transport.mjs` records what
 * happens when nobody does -- the paid path could not reach the network at all
 * and failed with the money guard's own error, which reads like a test bug and
 * was a missing wire. So the commands that can spend money carry the thing that
 * lets them: `render.mjs` and `worker-cli.mjs` for fal, and this file for
 * Stripe. `npm run web` therefore loads `.env` -- see package.json -- and
 * `npm test` still does not.
 *
 * WHY THE WORKER IMPORT IS GUARDED. `scripts/worker/worker.mjs` is being written
 * in parallel with this file. A missing module must degrade to a sentence
 * explaining what is missing, not to an unhandled rejection that takes the web
 * server down with it -- the web server is the part that works.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createQueue } from '../queue/queue.mjs';
import { createServer } from './server.mjs';
import { createBilling } from '../billing/billing.mjs';
import { createSupabaseAuth } from '../auth/supabase-auth.mjs';
import { installCrashHandlers } from '../ops/crash.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  .split(path.sep).join('/');

const USAGE = `
  npm run web -- [options]

    --port=<n>          default 3000, 0 picks a free port
    --host=<addr>       default 127.0.0.1
    --root=<dir>        where out/jobs and out/queue live (default: the repo)
    --provider=<id>     recorded on every new job (default: fixture)
    --public-url=<url>  where this app is reachable from, for the two urls
                        Stripe redirects a customer back to. Defaults to the
                        bound address, which is right locally and wrong in a
                        way you will see rather than one you will not.
    --with-worker       ALSO run the render loop in this process. Local testing
                        only; two processes is the shape this is built for.
    --worker-poll=<ms>  how often the in-process loop looks for work (default 1000)
    --help
`;

export function parseArgs(argv) {
  const opts = {
    port: 3000,
    host: '127.0.0.1',
    root: REPO_ROOT,
    provider: process.env.TIMESTAMP_PROVIDER || 'fixture',
    publicUrl: process.env.TIMESTAMP_PUBLIC_URL || null,
    withWorker: false,
    workerPollMs: 1000,
    help: false,
  };
  for (const arg of argv) {
    const [flag, ...rest] = arg.split('=');
    const value = rest.join('=');
    switch (flag) {
      case '--port': opts.port = Number(value); break;
      case '--host': opts.host = value; break;
      case '--root': opts.root = value; break;
      case '--provider': opts.provider = value; break;
      case '--public-url': opts.publicUrl = value; break;
      case '--with-worker': opts.withWorker = true; break;
      case '--worker-poll': opts.workerPollMs = Number(value); break;
      case '--help': case '-h': opts.help = true; break;
      default:
        throw new Error(`unknown option ${arg}${USAGE}`);
    }
  }
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) {
    throw new Error(`--port must be 0..65535, got ${opts.port}`);
  }
  return opts;
}

/**
 * The in-process render loop.
 *
 * `once()` claims at most one job and runs it, so a `setTimeout` chain -- not a
 * `setInterval` -- is the right driver: the next tick is scheduled when the last
 * one finished, and two renders can never overlap in a process that is also
 * answering HTTP.
 */
async function startInProcessWorker({ root, cfg, queue, provider, pollMs, log }) {
  let worker;
  try {
    const [{ createWorker }, { createProvider }] = await Promise.all([
      import('../worker/worker.mjs'),
      import('../providers/index.mjs'),
    ]);
    worker = createWorker({ root, cfg, queue, provider: createProvider(provider, { root }) });
  } catch (err) {
    log(`  --with-worker: not available yet (${err?.code ?? err?.message ?? err}).`);
    log('  The web app is running normally. Start the renderer separately:');
    log('      npm run worker -- --provider=fixture');
    return { stop: async () => {} };
  }

  let stopped = false;
  let timer = null;
  const tick = async () => {
    if (stopped) return;
    try {
      const did = await worker.once();
      // A tick that found work looks again immediately; an idle one waits. This
      // is the difference between draining a backlog and draining it at one job
      // per poll interval.
      timer = setTimeout(tick, did ? 0 : pollMs);
    } catch (err) {
      log(`  worker: ${err?.message ?? err}`);
      timer = setTimeout(tick, pollMs);
    }
    timer?.unref?.();
  };
  tick();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await worker.stop?.();
    },
  };
}

/** The three env values a real Supabase transport needs.
 *
 *  `doctor.mjs` reports on the SAME three names, but reads its own literal
 *  list rather than importing this one -- `doctor.mjs` is meant to stay a
 *  cheap, standalone preflight check, and pulling in this file's queue,
 *  billing and Stripe imports just to share three strings would be a heavier
 *  coupling than the strings are worth. `test/preflight-doctor.test.js`
 *  cross-checks the two lists against each other instead, so a rename here
 *  that doctor.mjs does not follow fails a test rather than drifting silently. */
export const SUPABASE_ENV_KEYS = Object.freeze([
  'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY',
]);

/**
 * Where the three `SUPABASE_*` values stand: none of them (`absent`, an
 * ordinary and expected shape -- a fresh checkout, a test build, `npm test`
 * which never loads `.env`), all three (`configured`), or -- named on its own
 * because it is not the same thing as `absent` -- some but not all
 * (`partial`, what a `.env` looks like when someone pasted the URL and one
 * key and forgot the third, or renamed a variable and missed a call site).
 *
 * RULING, 2026-08-26 (overturned an earlier version of this function that
 * THREW on `partial` and refused to boot at all): the blast radius was wrong.
 * A single mis-set identity variable was taking down rendering, billing, the
 * shelf, every route -- not just identity -- on a trigger as mundane as a
 * secret rotation or non-atomic env propagation leaving an instance
 * transiently holding two of three values. Fail-loud, not fail-fatal: this
 * function only ever returns a description, `supabaseFromEnv` below only
 * ever returns a client or `null`, and `main()` is the one place a `partial`
 * result gets a prominent stderr warning -- naming which values are missing,
 * never a value itself -- while the app boots and serves everything else.
 */
export function describeSupabaseConfig(env = process.env) {
  const present = SUPABASE_ENV_KEYS.filter((key) => typeof env[key] === 'string' && env[key].length > 0);
  const missing = SUPABASE_ENV_KEYS.filter((key) => !present.includes(key));
  const state = present.length === 0 ? 'absent' : missing.length === 0 ? 'configured' : 'partial';
  return { present, missing, state };
}

/**
 * The one place a real Supabase transport is built, for the same reason this
 * file is the one place Stripe's is: `scripts/auth/supabase-auth.mjs` has no
 * default `fetchImpl`, so a caller that forgets to inject one gets a
 * `TypeError` rather than a silently-broken identity provider. That guard
 * only holds if production actually injects somewhere -- CLAUDE.md's Bug 1 is
 * the fal transport making exactly this mistake, and this export is what
 * keeps `createServer({ supabase })` from repeating it.
 *
 * `null` UNLESS ALL THREE VALUES ARE PRESENT, AND THE APP STILL BOOTS EITHER
 * WAY -- `absent` and `partial` both return `null` here; see
 * `describeSupabaseConfig` for why they used to be treated differently and
 * are not any more. `createServer`'s own default for `supabase` is already
 * `null`, and the code-entry routes degrade to one 503 sentence rather than
 * the process refusing to start. This function never throws.
 */
export function supabaseFromEnv(env = process.env) {
  const { state } = describeSupabaseConfig(env);
  if (state !== 'configured') return null;
  return createSupabaseAuth({
    url: env.SUPABASE_URL,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    secretKey: env.SUPABASE_SECRET_KEY,
    // THE ONE PLACE A REAL TRANSPORT IS HANDED TO SUPABASE. Bound, for the
    // same "Illegal invocation" reason the Stripe transport above is bound.
    fetchImpl: globalThis.fetch.bind(globalThis),
  });
}

/**
 * The startup banner's Supabase lines, as an array `main()` just logs one by
 * one -- pulled out to a pure function so a test can pin exactly what gets
 * printed for all three states without spawning the CLI (`main()`'s own
 * shutdown path calls `process.exit`, which a test must never trigger on the
 * process running it).
 *
 * `absent` and `configured` are each one line, matching the shape every
 * other config gap in this banner already uses (`checkout`, `webhook`).
 * `partial` gets a second, prominent block ABOVE the one-line summary --
 * ruling, 2026-08-26: this is the one state where "the button does nothing"
 * is not the whole story, because the deployment looks configured otherwise.
 * NEVER a value, on any line, in any state -- only the env var NAMES that are
 * present or missing.
 */
export function supabaseBannerLines({ state, present, missing }) {
  const line = `  supabase   ${
    state === 'configured' ? 'identity configured'
      : state === 'partial' ? `MISCONFIGURED, missing ${missing.join(', ')} -- identity disabled`
        : 'NO SUPABASE_* -- /login, /signup and /auth/google will 503'
  }`;
  if (state !== 'partial') return [line];
  return [
    '',
    '  *** SUPABASE MISCONFIGURED -- IDENTITY IS DISABLED ***',
    `  present: ${present.join(', ') || '(none)'}`,
    `  missing: ${missing.join(', ')}`,
    '  Set all three of SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY,',
    '  or none at all, in .env. /login, /signup and /auth/google will 503 until then.',
    '',
    line,
  ];
}

export async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) { log(USAGE); return 0; }

  const cfg = JSON.parse(fs.readFileSync(`${REPO_ROOT}/config/render.json`, 'utf8'));
  const queue = createQueue({ root: opts.root });
  // THE ONE PLACE A REAL TRANSPORT IS HANDED TO SUPABASE. Never throws --
  // see `describeSupabaseConfig`'s own comment on why `partial` boots loudly
  // rather than refusing to start.
  const supabaseConfig = describeSupabaseConfig();
  const supabase = supabaseFromEnv();
  const app = createServer({
    root: opts.root,
    cfg,
    queue,
    port: opts.port,
    host: opts.host,
    provider: opts.provider,
    publicUrl: opts.publicUrl,
    supabase,
    // THE ONE PLACE A REAL TRANSPORT IS HANDED TO STRIPE. Bound, because a
    // detached `fetch` throws "Illegal invocation" in some runtimes and the
    // symptom would surface inside a checkout rather than here.
    billing: createBilling({ fetchImpl: globalThis.fetch?.bind(globalThis) ?? null }),
  });

  const bound = await app.listen();
  log('');
  /**
   * OPEN THE PUBLIC URL, NOT THE BOUND ONE, WHEN THEY DISAGREE.
   *
   * This line used to print the bound address unconditionally, and following it
   * BREAKS GOOGLE SIGN-IN when `TIMESTAMP_PUBLIC_URL` names a different host.
   * The state cookie is set on whichever host the browser is on, `redirectTo`
   * is built from the public url, and `localhost` and `127.0.0.1` are separate
   * cookie jars -- so the callback lands with no cookie, `oauthStateCheck`
   * refuses BEFORE `takeVerifier`, and the person gets a bare 400.
   *
   * IT IS THE QUIETEST FAILURE IN THE APPLICATION. That refusal logs nothing,
   * on purpose, and because it refuses before consuming anything the pending
   * row stays on disk -- so the only visible trace is verifier rows piling up
   * in `out/oauth/`. It cost a debugging session on 2026-08-27, entered from
   * this very banner. Printing the url that actually works is one line.
   */
  const publicUrl = opts.publicUrl ? String(opts.publicUrl).replace(/\/+$/, '') : null;
  const boundUrl = `http://${opts.host}:${bound}`;
  log(`  Timestamp  ${publicUrl ?? boundUrl}`);
  if (publicUrl && publicUrl !== boundUrl) {
    log(`             ^ TIMESTAMP_PUBLIC_URL -- open THIS one. Signing in on`);
    log(`               ${boundUrl} sets the state cookie on the wrong host and 400s.`);
  }
  log(`  root       ${opts.root}`);
  log(`  provider   ${opts.provider}`);
  for (const line of supabaseBannerLines(supabaseConfig)) log(line);
  log(`  checkout   ${process.env.STRIPE_SECRET_KEY ? 'stripe key set' : 'NO STRIPE_SECRET_KEY -- /pricing will 503 on buy'}`);
  log(`  webhook    ${process.env.STRIPE_WEBHOOK_SECRET ? 'signing secret set' : 'NO STRIPE_WEBHOOK_SECRET -- deliveries will 503'}`);
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    // THE HOST IS SPELLED OUT, AND THAT IS THE WHOLE POINT OF THIS LINE.
    // This server binds IPv4 only. The Stripe CLI resolves `localhost` to IPv6
    // `::1` on Windows and does NOT fall back, so `--forward-to localhost:3000`
    // fails every delivery with "connectex: No connection could be made" while
    // a browser on the same machine reaches the identical URL perfectly -- and
    // the payment succeeds at Stripe with nothing to show for it locally. That
    // cost a completed test checkout on 2026-08-25. Printing the address this
    // process actually bound to is one line and it removes the guess.
    log('');
    log(`  forward webhooks here (IPv4, NOT localhost -- the CLI resolves that to ::1):`);
    log(`    stripe listen --forward-to ${opts.host}:${bound}/api/stripe/webhook`);
  }

  let inProcess = { stop: async () => {} };
  if (opts.withWorker) {
    log('');
    log('  --with-worker: rendering in THIS process. Local testing only.');
    inProcess = await startInProcessWorker({
      root: opts.root, cfg, queue, provider: opts.provider, pollMs: opts.workerPollMs, log,
    });
  } else {
    log('  renderer   separate process -- npm run worker -- --provider=fixture');
  }
  log('');

  const shutdown = async () => {
    await inProcess.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return 0;
}

// Only when run directly, so a test can import `parseArgs` without starting a
// listener on somebody's port 3000. The crash handlers live HERE and not in
// main() for the same reason: a test that drives main() must not have real
// process-wide handlers installed under it.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  installCrashHandlers({ name: 'web' });
  main().catch((err) => {
    process.stderr.write(`${err?.message ?? err}\n`);
    process.exit(1);
  });
}
