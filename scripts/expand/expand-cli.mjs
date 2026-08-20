/**
 * `node scripts/expand/expand-cli.mjs --place="a beach" --outfit="an old hoodie"`
 *
 * Not wired to an npm script yet: adding `"expand"` to package.json belongs to
 * whoever owns that file, and this module was asked not to touch it.
 *
 * Prints what the expander WOULD produce, so a human can read it before a
 * render uses it. That is the entire purpose: expansion is the one stage where
 * the user's words become our prompt, and the failure mode is not a crash, it
 * is a perfectly valid place fragment that describes the wrong beach. The only
 * check for that is somebody reading the thing, and the only way somebody reads
 * it is if reading it costs nothing.
 *
 * So this prints three layers, in the order you want them when something looks
 * wrong: what was dropped and why, which skeleton was borrowed from and what
 * matched it, and then the finished fragments and the composed prompt exactly
 * as the provider would receive them.
 *
 * Costs nothing, spawns nothing, spends nothing.
 *
 * Usage:
 *   node scripts/expand/expand-cli.mjs --place="a beach"
 *   node scripts/expand/expand-cli.mjs --place="a beach" --outfit="an old hoodie"
 *   node scripts/expand/expand-cli.mjs --photo=input/place.jpg --outfit="a wedding suit"
 *   node scripts/expand/expand-cli.mjs --place="a beach" --seed=7 --json
 *   node scripts/expand/expand-cli.mjs --place="a beach" --prompt
 */

import process from 'node:process';
import { checkCompatibility, loadCatalog } from '../catalog/catalog.mjs';
import { composeMotionPrompt, composeStillPrompt } from '../compose/prompt.mjs';
import { ExpandError, buildExpandPrompt, expandOutfit, expandPlace, placeFromPhoto } from './expand.mjs';
import { canonicalId, localExpander } from './local.mjs';

function parseArgs(argv) {
  const args = { seed: 0, json: false, prompt: false };
  for (const arg of argv) {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    const value = rest.join('=');
    if (key === 'json') args.json = true;
    else if (key === 'prompt') args.prompt = true;
    else if (key === 'seed') args.seed = Number.parseInt(value, 10);
    else if (['place', 'outfit', 'photo'].includes(key)) args[key] = value;
    else if (arg.startsWith('--')) throw new Error(`unknown flag "${arg}"`);
  }
  if (!Number.isInteger(args.seed) || args.seed < 0) throw new Error('--seed must be a non-negative integer');
  return args;
}

const indent = (text, pad = '    ') => String(text).split('\n').map((l) => pad + l).join('\n');

/** The reasoning, printed before the result. A wrong expansion is nearly always
 *  a wrong skeleton or a dropped clause, and both are visible here. */
function reportSource(source) {
  if (!source) return;
  const lines = [];
  if (source.skeleton) {
    lines.push(`  skeleton     ${source.skeleton}` +
      `${source.strongMatch ? '' : '  (nothing matched -- neutral set dressing)'}` +
      `${source.lexicalScore ? `  score ${source.lexicalScore}` : ''}` +
      `${source.tiedCandidates > 1 ? `  ${source.tiedCandidates} tied, broken by seed` : ''}`);
    if (source.matchedOn?.length) lines.push(`  matched on   ${source.matchedOn.join(', ')}`);
  }
  for (const [label, key] of [['climate', 'climateFrom'], ['time', 'timeFrom'], ['light', 'lightFrom'],
    ['lens', 'lensFrom'], ['dressing', 'dressingFrom'], ['look', 'lookOverrideFrom'],
    ['garment class', 'garmentClassFrom'], ['wardrobe', 'wardrobeFrom']]) {
    if (source[key]) lines.push(`  ${label.padEnd(12)} ${source[key]}`);
  }
  for (const drop of source.dropped ?? []) {
    const verb = drop.action === 'stripped' ? 'STRIPPED   ' : 'DROPPED    ';
    lines.push(`  ${verb}  "${drop.text}"  -- ${drop.rule} rule, on "${drop.match ?? drop.term}"`);
  }
  console.log(lines.join('\n'));
}

function reportPlace(place) {
  console.log(`\n  id           ${place.id}`);
  console.log(`  label        ${place.label}`);
  console.log(`  climate      ${place.climate}        timeOfDay  ${place.timeOfDay}`);
  for (const key of ['scene', 'light', 'lens', 'framing', 'eraProps']) {
    console.log(`\n  ${key}\n${indent(place.prompt[key])}`);
  }
  console.log(`\n  negatives    ${place.negatives.join(', ')}`);
  console.log(`  motionHint   ${place.motionHint}`);
  console.log(`  lookOverride ${JSON.stringify(place.lookOverride)}`);
}

function reportOutfit(outfit) {
  console.log(`\n  id           ${outfit.id}`);
  console.log(`  label        ${outfit.label}`);
  console.log(`  climate      ${outfit.climate.join('/')}`);
  console.log(`\n  wardrobe\n${indent(outfit.wardrobe)}`);
  console.log(`\n  negatives    ${outfit.negatives.join(', ')}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.place && !args.outfit && !args.photo) {
    console.log('\n  node scripts/expand/expand-cli.mjs --place="a beach" --outfit="an old hoodie"');
    console.log('  --photo=<path>   the place is a reference image instead of text');
    console.log('  --seed=<n>       breaks ties between equally near skeletons');
    console.log('  --prompt         print the prompt a Claude impl would be sent, and stop');
    console.log('  --json           machine-readable\n');
    return;
  }

  const catalog = loadCatalog();

  if (args.prompt) {
    const kind = args.photo ? 'place-from-photo' : (args.place ? 'place' : 'outfit');
    const text = args.place ?? args.outfit ?? '';
    console.log(buildExpandPrompt({ kind, text, photoPath: args.photo, catalog, id: canonicalId(kind, text) }));
    return;
  }

  const opts = { catalog, seed: args.seed };
  let place = null;
  let outfit = null;

  console.log(`\ntimestamp expand · catalog ${catalog.hash} · seed ${args.seed}`);

  if (args.photo) {
    console.log(`\nPLACE  <- photograph ${args.photo}${args.place ? `  + "${args.place}"` : ''}`);
    place = await placeFromPhoto(args.photo, { ...opts, text: args.place ?? '' });
    reportSource(localExpander({ kind: 'place-from-photo', text: args.place ?? '', photoPath: args.photo, seed: args.seed, catalog }).draft._source);
    reportPlace(place);
  } else if (args.place) {
    console.log(`\nPLACE  <- "${args.place}"`);
    place = await expandPlace(args.place, opts);
    reportSource(localExpander({ kind: 'place', text: args.place.trim(), seed: args.seed, catalog }).draft?._source);
    reportPlace(place);
  }

  if (args.outfit) {
    console.log(`\nOUTFIT <- "${args.outfit}"`);
    outfit = await expandOutfit(args.outfit, opts);
    reportSource(localExpander({ kind: 'outfit', text: args.outfit.trim(), seed: args.seed, catalog }).draft?._source);
    reportOutfit(outfit);
  }

  if (place && outfit) {
    // The eight lines, exactly as the provider would receive them. This is the
    // artefact worth reading: a fragment can look fine on its own and read
    // badly once it is concatenated with the other one.
    const { warnings } = checkCompatibility(place, outfit);
    for (const warning of warnings) console.log(`\n  note: ${warning}`);

    const still = composeStillPrompt({ place, outfit });
    console.log(`\nSTILL PROMPT\n${indent(still.prompt)}`);
    console.log(`\n  negative\n${indent(still.negativePrompt)}`);

    const motion = composeMotionPrompt({ place, outfit, segment: 1, totalSegments: 2 });
    console.log(`\nMOTION PROMPT (take 1)\n${indent(motion.prompt)}`);
  }

  if (args.json) {
    console.log(`\n${JSON.stringify({ place, outfit }, null, 2)}`);
  }
  console.log('');
}

main().catch((err) => {
  if (err instanceof ExpandError) {
    console.error(`\nrefused (${err.code})\n\n  ${err.userMessage}\n`);
    process.exitCode = 1;
    return;
  }
  console.error(`\n${err.message}\n`);
  process.exitCode = 1;
});
