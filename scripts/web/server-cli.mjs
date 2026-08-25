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

export async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) { log(USAGE); return 0; }

  const cfg = JSON.parse(fs.readFileSync(`${REPO_ROOT}/config/render.json`, 'utf8'));
  const queue = createQueue({ root: opts.root });
  const app = createServer({
    root: opts.root,
    cfg,
    queue,
    port: opts.port,
    host: opts.host,
    provider: opts.provider,
    publicUrl: opts.publicUrl,
    // THE ONE PLACE A REAL TRANSPORT IS HANDED TO STRIPE. Bound, because a
    // detached `fetch` throws "Illegal invocation" in some runtimes and the
    // symptom would surface inside a checkout rather than here.
    billing: createBilling({ fetchImpl: globalThis.fetch?.bind(globalThis) ?? null }),
  });

  const bound = await app.listen();
  log('');
  log(`  Timestamp  http://${opts.host}:${bound}`);
  log(`  root       ${opts.root}`);
  log(`  provider   ${opts.provider}`);
  // Said out loud at startup, because "the button does nothing" is the symptom
  // of every one of these being absent and none of them is visible from a page.
  log(`  checkout   ${process.env.STRIPE_SECRET_KEY ? 'stripe key set' : 'NO STRIPE_SECRET_KEY -- /pricing will 503 on buy'}`);
  log(`  webhook    ${process.env.STRIPE_WEBHOOK_SECRET ? 'signing secret set' : 'NO STRIPE_WEBHOOK_SECRET -- deliveries will 503'}`);

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
// listener on somebody's port 3000.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    process.stderr.write(`${err?.message ?? err}\n`);
    process.exit(1);
  });
}
