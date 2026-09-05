/**
 * `npm run compose` -- print the exact text that would be sent to a model.
 *
 * The point of this command is that NOTHING between here and the provider
 * rewrites the prompt. What it prints is what gets sent, character for
 * character, which is what makes reading it a real review rather than a
 * reassuring one. Prompt bugs are otherwise close to invisible: a fragment that
 * fights another fragment does not throw, it produces a slightly worse video,
 * and "slightly worse" is indistinguishable from "the model had a bad day" at a
 * sample size of one.
 *
 * `--all` exists for the same reason `--sweep` exists in `npm run look`.
 * Judging one prompt in isolation is nearly impossible; forty-eight of them
 * side by side make a fragment that reads oddly in half the menu obvious in
 * about a minute. Do this after editing any preset and before spending
 * anything.
 *
 * Nothing here can cost money. It is pure string assembly against local JSON.
 *
 * Usage:
 *   npm run compose -- --place=schrebergarten-august --outfit=tshirt-jeans
 *   npm run compose -- --place=... --outfit=... --count=5 --segments=3 --job=demo
 *   npm run compose -- --all
 *   npm run compose -- --all --json
 */

import process from 'node:process';
import { checkCompatibility, getOutfit, getPlace, listCatalog, loadCatalog } from '../catalog/catalog.mjs';
import { PresetError } from '../catalog/schema.mjs';
import { composeMotionPrompt, composeStillPrompt, DEFAULT_ERA } from './prompt.mjs';
import { deriveSeed } from './seed.mjs';

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

function positiveInt(value, fallback, name) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new PresetError(`--${name} must be a positive integer, got "${value}"`);
  return n;
}

function section(title, body) {
  return `${title}\n${body.split('\n').map((l) => `    ${l}`).join('\n')}`;
}

function describe({ place, outfit, era, count, segments, jobId }) {
  const still = composeStillPrompt({ place, outfit, era, count });
  const { ok, warnings } = checkCompatibility(place, outfit);
  const out = [];

  out.push(`\n${'─'.repeat(78)}`);
  out.push(`${place.id} + ${outfit.id}`);
  out.push(`  ${place.label} · ${place.climate} · ${place.timeOfDay}   /   ${outfit.label} · ${outfit.climate.join('/')}`);
  if (!ok) for (const w of warnings) out.push(`  note: ${w}`);
  out.push('');
  out.push(section(`  STILL PROMPT  (${count} still${count === 1 ? '' : 's'}, one prompt -- variation comes from the seed)`, still.prompt));
  out.push('');
  out.push(section('  STILL NEGATIVE', still.negativePrompt));

  for (let segment = 1; segment <= segments; segment += 1) {
    const motion = composeMotionPrompt({ place, outfit, segment, totalSegments: segments });
    out.push('');
    out.push(section(`  MOTION PROMPT  segment ${segment}/${segments}`, motion.prompt));
    if (segment === 1) {
      out.push('');
      out.push(section('  MOTION NEGATIVE', motion.negativePrompt));
    }
  }

  if (jobId) {
    const stills = Array.from({ length: count }, (_, i) => deriveSeed(jobId, 'still', i));
    const motions = Array.from({ length: segments }, (_, i) => deriveSeed(jobId, 'motion', i));
    out.push('');
    out.push(`  SEEDS  job "${jobId}"   still: ${stills.join(', ')}   motion: ${motions.join(', ')}`);
  }

  return out.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let catalog;
  try {
    catalog = loadCatalog();
  } catch (err) {
    if (!(err instanceof PresetError)) throw err;
    console.error(`\npreset error: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const era = args.era ?? DEFAULT_ERA;
    const count = positiveInt(args.count, 1, 'count');
    const segments = positiveInt(args.segments, 1, 'segments');
    const jobId = args.job ?? null;

    const all = args.flags.has('all');
    const pairs = [];

    if (all) {
      for (const place of catalog.places.values()) {
        for (const outfit of catalog.outfits.values()) pairs.push({ place, outfit });
      }
    } else {
      if (!args.place || !args.outfit) {
        const menu = listCatalog(catalog);
        console.error('\nusage: npm run compose -- --place=<id> --outfit=<id>   (or --all)\n');
        console.error(`  places:  ${menu.places.map((p) => p.id).join(', ')}`);
        console.error(`  outfits: ${menu.outfits.map((o) => o.id).join(', ')}\n`);
        process.exitCode = 1;
        return;
      }
      pairs.push({ place: getPlace(catalog, args.place), outfit: getOutfit(catalog, args.outfit) });
    }

    if (args.flags.has('json')) {
      const payload = pairs.map(({ place, outfit }) => ({
        placeId: place.id,
        outfitId: outfit.id,
        compatibility: checkCompatibility(place, outfit),
        still: composeStillPrompt({ place, outfit, era, count }),
        motion: Array.from({ length: segments }, (_, i) =>
          composeMotionPrompt({ place, outfit, segment: i + 1, totalSegments: segments })),
        ...(jobId ? { seeds: { still: Array.from({ length: count }, (_, i) => deriveSeed(jobId, 'still', i)) } } : {}),
      }));
      console.log(JSON.stringify({ hash: catalog.hash, era, count, segments, pairs: payload }, null, 2));
      return;
    }

    console.log(`\ntimestamp compose · catalog ${catalog.hash} · era "${era}" · ${pairs.length} combination(s)`);
    console.log('  nothing here contacts a provider or costs anything');
    for (const pair of pairs) console.log(describe({ ...pair, era, count, segments, jobId }));

    const odd = pairs.filter(({ place, outfit }) => !checkCompatibility(place, outfit).ok).length;
    console.log(`\n${'─'.repeat(78)}`);
    console.log(`  ${pairs.length} combination(s), ${odd} with a climate note. A note is not a refusal.\n`);
  } catch (err) {
    if (!(err instanceof PresetError)) throw err;
    console.error(`\n${err.message}\n`);
    process.exitCode = 1;
  }
}

main();
