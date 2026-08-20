/**
 * `npm run smoke` -- the one command that talks to fal on purpose.
 *
 * IT DOES NOT SPEND BY DEFAULT AND THAT IS THE WHOLE DESIGN. With no flags it
 * prints what it WOULD do: the provider it built, the models it resolved, the
 * endpoint, the raster, the segment plan, and the estimate in dollars and in
 * credits. Constructing the provider reads no credential, so this half works
 * on a machine with no key at all -- which is the point, because "what would
 * this cost" is exactly the question you want answered before you have
 * committed to anything.
 *
 * Spending requires `--go`, spelled out, plus the resolution and duration
 * named explicitly. There is no default that spends and no flag that spends by
 * accident. Compare `npm run doctor`, which is a hard gate to run before
 * anything that costs money; this is the thing you run immediately after it.
 *
 * WHY THIS EXISTS SEPARATELY FROM `npm run render`. A full render is eleven
 * steps and two paid ones, and when the first live call fails you want to know
 * whether it was the endpoint, the credential, the parameter names or the
 * download -- not whether intake stripped EXIF. This is the smallest thing
 * that can be wrong, run on its own, with the raw response shapes printed.
 *
 * WHAT IT ANSWERS THAT A RECORDED FIXTURE CANNOT. Every shape under
 * `test/fixtures/fal/` was copied from documentation rather than from a
 * response somebody paid for. This is where the documentation gets checked:
 * whether a `data:` URI is accepted for `image_url`, whether `duration` really
 * is a string enum, whether `seed` is really an input (two of fal's own pages
 * disagree), and -- layer 3 of the three-layer native-audio rule -- whether
 * `generate_audio: false` really produces a file with zero audio streams.
 *
 * Usage:
 *   npm run smoke                                   free: plan and estimate
 *   npm run smoke -- --resolution=720p              free, at another raster
 *   npm run smoke -- --go --seconds=4               SPENDS: one short clip
 *   npm run smoke -- --go --image=path/to/frame.png SPENDS: from your frame
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { runFfmpeg, probe, REPO_ROOT } from '../ffmpeg/run.mjs';
import { createProvider, loadModels, defaultModels, modelEntry } from './index.mjs';
import { FAL_ID, FAL_RESOLUTIONS, falResolutionFor } from './fal.mjs';
import { fixtureStillFilter, fixtureStillArgs } from './fixture.mjs';
import { planSegments, describePlan, resolutionRaster, DEFAULT_RESOLUTION } from '../animate/plan.mjs';
import { loadPricing, estimateVideo } from './pricing.mjs';
import { creditCost } from '../auth/credits.mjs';
import { ProviderError } from './errors.mjs';

const OUT = path.join(REPO_ROOT, 'build', 'smoke');
const slash = (p) => String(p).replace(/\\/g, '/');

function parseArgs(argv) {
  const args = { go: false, resolution: DEFAULT_RESOLUTION, seconds: 4, image: null };
  for (const arg of argv) {
    if (arg === '--go') args.go = true;
    else if (arg.startsWith('--resolution=')) args.resolution = arg.slice('--resolution='.length);
    else if (arg.startsWith('--seconds=')) args.seconds = Number(arg.slice('--seconds='.length));
    else if (arg.startsWith('--image=')) args.image = path.resolve(arg.slice('--image='.length));
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return args;
}

const HELP = [
  '',
  'npm run smoke                                  free: what it would do, and what it would cost',
  'npm run smoke -- --resolution=720p             free, at the other raster',
  'npm run smoke -- --go --seconds=4              SPENDS: the shortest legal clip',
  'npm run smoke -- --go --image=frame.png        SPENDS: from a frame you supply',
  '',
  '  --go            actually call fal. Nothing spends without it.',
  '  --resolution=   480p | 720p. Always requested at 4:3.',
  '  --seconds=      4..15, in one call. Seedance 2.0 needs no segment chain.',
  '  --image=        a start frame. Without one, a local fixture frame is generated for $0.',
  '',
].join('\n');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }

  const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'render.json'), 'utf8'));
  const raster = resolutionRaster(args.resolution);
  const size = { width: raster.width, height: raster.height };
  // Belt to the braces: the provider offers exactly these two rasters, and a
  // mismatch between what plan.mjs derives and what fal offers should stop the
  // command rather than a paid call.
  const label = falResolutionFor(size);

  // NO CREDENTIAL IS READ HERE. That is why the free half of this command
  // works on a machine that has never seen a key.
  const provider = createProvider(FAL_ID, { cfg });
  const models = loadModels();
  const wanted = defaultModels(models, FAL_ID);
  const pricing = loadPricing();

  const segments = planSegments({ cfg, capabilities: provider.capabilities, size });

  console.log('');
  console.log(`timestamp smoke · provider ${provider.id} · paid: ${provider.paid}`);
  console.log('');
  console.log(`  resolution      ${args.resolution} -> ${size.width}x${size.height} (4:3, always) · fal calls it "${label}"`);
  console.log(`  clip            ${args.seconds}s at ${cfg.fps}fps`);
  console.log(`  capabilities    maxClipSeconds ${provider.capabilities.maxClipSeconds}, ` +
    `maxReferences ${provider.capabilities.maxReferences}, audio-off ${provider.capabilities.supportsNativeAudioOff}`);
  console.log(`  a full tape     ${describePlan(segments)}`);
  console.log('');

  // Resolved separately from the provider so the report distinguishes "the
  // video model is verified" from "the still model is not" -- two facts that
  // must never be read as one.
  for (const kind of ['video', 'still']) {
    const id = wanted[kind];
    try {
      const entry = modelEntry(models, id);
      console.log(`  ${kind.padEnd(6)} model   ${id}`);
      console.log(`  ${' '.repeat(6)}         endpoint ${entry.endpoint} · VERIFIED ${entry.verifiedOn ?? ''}`);
      if (entry.audioOffParam) {
        console.log(`  ${' '.repeat(6)}         audio off: ${entry.audioOffParam.name}=${JSON.stringify(entry.audioOffParam.value)} (the vendor default is TRUE)`);
      }
    } catch (err) {
      console.log(`  ${kind.padEnd(6)} model   ${id}`);
      console.log(`  ${' '.repeat(6)}         REFUSED: ${err.message.split('\n')[0]}`);
    }
  }

  const usd = estimateVideo({ pricing, model: wanted.video, seconds: args.seconds });
  const tapeCredits = creditCost({ resolution: args.resolution, seconds: cfg.durationSeconds });
  console.log('');
  console.log(`  this call       ~$${usd.toFixed(2)} ESTIMATED (config/pricing.json -- every non-zero number there is a guess)`);
  console.log(`  a whole tape    ${tapeCredits} CR at ${args.resolution} (config/credits.json)`);
  console.log('');

  if (!args.go) {
    console.log('  Nothing was called and nothing was spent. Add --go to make the request.');
    console.log('');
    return;
  }

  if (!process.env.FAL_KEY) {
    console.error('  FAL_KEY is not in the process. Put it in .env -- `npm run smoke` loads it with --env-file-if-exists.\n');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });
  let start = args.image;
  if (!start) {
    start = path.join(OUT, 'start.png');
    console.log(`  generating a start frame locally for $0: ${slash(start)}`);
    await runFfmpeg(fixtureStillArgs({
      filter: fixtureStillFilter({ seed: 20260820, index: 1, size, fontPath: null }),
      output: start,
    }));
  }
  if (!fs.existsSync(start)) {
    console.error(`  no start frame at ${slash(start)}\n`);
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('  CALLING FAL. This spends money.');
  console.log('');

  const res = await provider.generateVideo({
    prompt: 'a slow handheld drift across a quiet suburban garden in late afternoon light, the person stays where they are',
    negativePrompt: '',
    imagePath: start,
    seed: 20260820,
    seconds: args.seconds,
    size,
    // Layer 1, stated at the call site on purpose.
    nativeAudio: false,
    index: 1,
    idempotencyKey: `smoke-${Date.now()}`,
  }, {
    outDir: OUT,
    // The one line in this repo that hands a real transport to a paid
    // provider outside a test. It is here, in the file named `smoke`, behind
    // a flag spelled `--go`.
    fetchImpl: globalThis.fetch,
    onProgress: (e) => console.log(`    ${e.phase}${e.pct === undefined ? '' : ` ${e.pct}%`}${e.message ? ` — ${e.message}` : ''}`),
  });

  console.log('');
  console.log(`  clip            ${slash(res.clip.path)} (${res.clip.seconds}s claimed)`);
  console.log(`  fal request     ${res.meta.falRequestId}`);
  console.log(`  our request id  ${res.meta.requestId} (a function of the idempotency key)`);
  console.log(`  seed            sent 20260820, model reported ${res.meta.providerSeed}`);
  console.log(`  latency         ${res.meta.latencyMs}ms`);
  console.log(`  estimated       $${res.cost.estimated} · actual ${res.cost.actual === null ? 'NOT METERED YET' : `$${res.cost.actual}`}`);
  console.log('');

  // LAYER 3, by hand, on the file that actually arrived. The pipeline does
  // this in `assemble`; doing it here means a smoke run answers the question
  // without a whole render behind it.
  const info = await probe(res.clip.path, { countFrames: true });
  const streams = info.streams ?? [];
  const audio = streams.filter((s) => s.codec_type === 'audio');
  const video = streams.find((s) => s.codec_type === 'video');
  console.log(`  delivered       ${video?.width}x${video?.height} · ${video?.nb_read_frames} frames · ${video?.r_frame_rate}`);
  console.log(`  audio streams   ${audio.length}${audio.length === 0 ? '  (generate_audio: false held)' : '  *** THE MODEL GENERATED AUDIO ANYWAY ***'}`);
  if (video && video.width * 3 !== video.height * 4) {
    console.log('  *** NOT 4:3. aspect_ratio is not doing what the schema says, and a third of every frame is being paid for and thrown away.');
  }
  console.log('');
}

main().catch((err) => {
  if (err instanceof ProviderError) {
    console.error(`\n${err.name} (${err.code}, retriable: ${err.retriable}): ${err.message}\n`);
    if (err.detail) console.error(`${JSON.stringify(err.detail, null, 2)}\n`);
  } else {
    console.error(`\n${err.stack ?? err.message}\n`);
  }
  process.exitCode = 1;
});
