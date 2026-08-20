/**
 * `npm run look` -- grade any clip, look at the result, change a number, repeat.
 *
 * This command is the reason the architecture splits content from texture. The
 * look is the product's entire differentiator and it has no dependency on the
 * generation pipeline whatsoever, so it can be built and tuned to completion
 * before a single dollar is spent. Everything here runs against a local file
 * and a local ffmpeg. Nothing it does can cost money.
 *
 * Usage:
 *   npm run look                                        # synthesises its own source
 *   npm run look -- --in=assets/stock/porch.mp4 --name=porch
 *   npm run look -- --in=... --name=grain --sweep=tape.grainStrength=4,9,14,20
 *   npm run look -- --in=... --seed=19990824 --no-osd
 *   npm run look -- --name=audio-check --with-audio       # picture and bed, one pass
 *
 * --with-audio is off by default and that is deliberate rather than timid. Most
 * of the tuning this command exists for is visual, the bed costs a second of
 * render and an AAC stream nobody is looking at, and -- most usefully -- leaving
 * it off proves the negative the delivery contract cares about: without the flag
 * the output must contain NO audio stream at all, not a silent one.
 *
 * The --sweep form is the one that matters. Judging a single graded clip is
 * nearly impossible because the eye adapts within seconds and everything starts
 * to look normal; four renders differing in exactly one value, viewed together,
 * turn guessing into comparing.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { REPO_ROOT, runFfmpeg } from '../ffmpeg/run.mjs';
import { assertDeliveryContract, assertComposite, assertTapeGrade, assertBurnIn, ContractError } from '../ffmpeg/assert.mjs';
import { resolveFont } from '../preflight/doctor.mjs';
import { tapeGeometry, deliveryGeometry, frameCount } from './frame.mjs';
import { loadLookProfile, buildVideoFilter, get, set } from './look.mjs';
import { burnInFilters, burnInProbeRegion, deriveStamp } from './burn-in.mjs';
import { beforeAfterArgs, framesArgs } from './grade.mjs';
import { buildAudioFilter, clampAudio } from '../audio/bed.mjs';
import { muxedArgs, joinGraphs, fileLoudnessArgs, parseIntegratedLufs, lufsVerdict } from '../audio/mix.mjs';

function parseArgs(argv) {
  const args = { flags: new Set() };
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const [key, ...rest] = raw.slice(2).split('=');
    if (rest.length === 0) args.flags.add(key);
    else args[key] = rest.join('=');
  }
  return args;
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/** A synthetic source so the command works on a fresh clone with no assets.
 *  testsrc2 has hard edges, saturated primaries and a moving element, which
 *  between them exercise chroma smear, grain and the transport jitter. */
async function synthesiseSource(cfg, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await runFfmpeg([
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=${cfg.fps}:duration=${cfg.durationSeconds}`,
    '-frames:v', String(cfg.totalFrames),
    '-c:v', cfg.encode.videoCodec, '-pix_fmt', cfg.encode.pixFmt, '-crf', '14',
    '-preset', 'veryfast',
    outFile,
  ]);
  return outFile;
}

async function renderOne({ input, outDir, label, look, cfg, font, withOsd, withAudio, tape, delivery }) {
  fs.mkdirSync(outDir, { recursive: true });

  const osd = withOsd
    ? { ...look.osd, enabled: true, fontRelPath: font.path }
    : { ...look.osd, enabled: false };
  const burnIn = burnInFilters(osd, { tape, delivery });
  const videoFilter = buildVideoFilter({ ...look, osd }, cfg, { burnIn });
  // The bed joins the picture inside the SAME -filter_complex. Rendering the
  // tape and then muxing a separate wav would be two passes, and the second one
  // is a re-encode of a look whose entire subject is generation loss.
  const audioFilter = withAudio ? buildAudioFilter(look, cfg) : '';
  const filterComplex = joinGraphs(videoFilter, audioFilter);

  const tapeFile = path.join(outDir, 'tape.mp4');
  const started = Date.now();
  await runFfmpeg(muxedArgs({ input, output: tapeFile, videoFilter, audioFilter, cfg }));
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  // The resolved profile and the exact graph, saved next to the render. When
  // one render out of twenty is the good one, this is what makes it repeatable.
  fs.writeFileSync(path.join(outDir, 'look.json'), JSON.stringify({ ...look, osd }, null, 2));
  fs.writeFileSync(path.join(outDir, 'filtergraph.txt'), filterComplex.split(';').join(';\n'));

  return { label, tapeFile, outDir, elapsed, osd, look, filterComplex };
}

/**
 * The bed is at the level the profile claims.
 *
 * Measured, never reached for: there is no loudnorm in the render path, so this
 * is an assertion about a number decided in base.json rather than a correction
 * applied to one. See audio/bed.mjs for why that distinction is the whole design.
 */
async function assertQuiet(primary) {
  const { stderr } = await runFfmpeg(fileLoudnessArgs({ input: primary.tapeFile }));
  const verdict = lufsVerdict(parseIntegratedLufs(stderr), primary.look.audio);
  if (!verdict.ok) throw new ContractError(`the bed is not quiet: ${verdict.message}`);
  return verdict.message;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = readJson(path.join(REPO_ROOT, 'config', 'render.json'));
  const base = readJson(path.join(REPO_ROOT, 'config', 'look', 'base.json'));

  frameCount(cfg);
  const tape = tapeGeometry(cfg);
  const delivery = deliveryGeometry(cfg);

  const font = resolveFont();
  const withOsd = !args.flags.has('no-osd') && Boolean(font.path);
  const withAudio = args.flags.has('with-audio');
  if (withOsd && !font.bundled) {
    console.log(`  note: using system font ${font.path}; renders will not reproduce on another machine.`);
  }

  // --- source ---------------------------------------------------------------
  let input = args.in ? path.resolve(REPO_ROOT, args.in) : null;
  if (input && !fs.existsSync(input)) {
    console.error(`no such clip: ${input}`);
    process.exitCode = 1;
    return;
  }
  if (!input) {
    input = path.join(REPO_ROOT, 'build', '_testsrc.mp4');
    if (!fs.existsSync(input)) {
      console.log('  no --in given, synthesising a source from testsrc2...');
      await synthesiseSource(cfg, input);
    }
  }

  const name = args.name ?? path.basename(input, path.extname(input));
  const seedOverride = args.seed ? { seed: Number(args.seed) } : {};

  // --- variants -------------------------------------------------------------
  const variants = [];
  if (args.sweep) {
    const [dotted, list] = args.sweep.split('=');
    if (!list) throw new Error('--sweep needs the form --sweep=path.to.value=1,2,3');
    for (const raw of list.split(',')) {
      const value = Number.isNaN(Number(raw)) ? raw : Number(raw);
      const override = set(structuredClone(seedOverride), dotted, value);
      variants.push({ label: `${dotted.split('.').pop()}-${raw}`, override });
    }
  } else {
    variants.push({ label: name, override: seedOverride });
  }

  console.log(`\ntimestamp look · ${path.relative(REPO_ROOT, input)} · ${variants.length} render(s)\n`);

  const results = [];
  for (const variant of variants) {
    const { look, clamped } = loadLookProfile(base, variant.override);
    // The audio block has its own clamp table, in audio/bed.mjs next to the code
    // that emits the filters. Reported through the same line so an operator sees
    // one list rather than two.
    const { clamped: audioClamped } = clampAudio(look);
    for (const c of [...clamped, ...audioClamped]) {
      console.log(`  clamped ${c.path}: ${c.from} -> ${c.to} (allowed ${c.min}..${c.max})`);
    }
    // A seed with no explicit stamp derives its own date, so changing the seed
    // changes the tape's date too -- which is what a different tape would do.
    if (args.seed && !args.flags.has('keep-stamp')) Object.assign(look.osd, deriveStamp(look.seed));

    const outDir = path.join(REPO_ROOT, 'review', 'look', name, variants.length > 1 ? variant.label : '.');
    const result = await renderOne({ input, outDir, label: variant.label, look, cfg, font, withOsd, withAudio, tape, delivery });
    console.log(`  rendered ${variant.label} in ${result.elapsed}s -> ${path.relative(REPO_ROOT, result.tapeFile)}`);
    results.push(result);
  }

  // --- review artifacts for the first (or only) render ----------------------
  const primary = results[0];
  await runFfmpeg(beforeAfterArgs({
    original: input,
    graded: primary.tapeFile,
    output: path.join(primary.outDir, 'before-after.mp4'),
    cfg,
  }));
  const framesDir = path.join(primary.outDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  await runFfmpeg(framesArgs({
    input: primary.tapeFile,
    outputPattern: path.join(framesDir, 'f%02d.png'),
    cfg,
  }));

  // --- assertions -----------------------------------------------------------
  console.log('\n  contract:');
  const report = [];
  for (const [label, fn] of [
    // expectAudio cuts both ways: with the flag an audio stream is required, and
    // WITHOUT it the absence of one is asserted. A silent AAC track sneaking in
    // would otherwise pass unnoticed forever.
    ['delivery', () => assertDeliveryContract(primary.tapeFile, cfg, { expectAudio: withAudio })],
    ['composite', () => assertComposite(primary.tapeFile, delivery)],
    ['grade', () => assertTapeGrade(primary.tapeFile, delivery)],
    ...(withOsd ? [['burn-in', () => assertBurnIn(primary.tapeFile, burnInProbeRegion(primary.osd, delivery, tape))]] : []),
    ...(withAudio ? [['bed', () => assertQuiet(primary)]] : []),
  ]) {
    try {
      const detail = await fn();
      console.log(`    [ok  ] ${label}${typeof detail === 'string' ? ` · ${detail}` : ''}`);
    } catch (err) {
      report.push(err);
      const message = err instanceof ContractError ? err.message : String(err);
      console.log(`    [FAIL] ${label}: ${message.split('\n')[0]}`);
      if (err.detail?.failures) for (const f of err.detail.failures) console.log(`           ${f}`);
    }
  }

  console.log(`\n  open ${path.relative(REPO_ROOT, primary.outDir)}\\before-after.mp4  <- judge the grade here`);
  console.log(`       ${path.relative(REPO_ROOT, framesDir)}\\                        <- eight stills\n`);
  process.exitCode = report.length ? 1 : 0;
}

await main();
