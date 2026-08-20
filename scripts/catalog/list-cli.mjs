/**
 * `npm run presets` -- print the menu.
 *
 * This costs nothing and it is the first thing anyone should run against a
 * catalog they have edited, because it is the cheapest place for a schema
 * failure to surface. A broken preset stops this command with a named error
 * before it can stop a render, and a render is the expensive one.
 *
 * The hash is printed on purpose. It is what a manifest records, so seeing it
 * here means "the menu I am about to render from is this exact menu" can be
 * checked by eye rather than by trust. Edit any preset -- including its
 * documentation -- and this number changes.
 *
 * Usage:
 *   npm run presets
 *   npm run presets -- --json
 */

import process from 'node:process';
import { listCatalog, loadCatalog } from './catalog.mjs';
import { PresetError } from './schema.mjs';

const pad = (s, w) => String(s).padEnd(w);

function table(rows, columns) {
  const widths = columns.map(({ key, head }) =>
    Math.max(head.length, ...rows.map((r) => String(r[key] ?? '').length)));
  const line = (cells) => `  ${cells.map((c, i) => pad(c, widths[i])).join('  ')}`.trimEnd();
  return [
    line(columns.map((c) => c.head.toUpperCase())),
    ...rows.map((r) => line(columns.map((c) => r[c.key] ?? ''))),
  ].join('\n');
}

function main() {
  const json = process.argv.slice(2).includes('--json');

  let catalog;
  try {
    catalog = loadCatalog();
  } catch (err) {
    if (!(err instanceof PresetError)) throw err;
    console.error(`\npreset error: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  const menu = listCatalog(catalog);

  if (json) {
    console.log(JSON.stringify({ hash: catalog.hash, count: catalog.count, ...menu }, null, 2));
    return;
  }

  const { places, outfits, combinations } = catalog.count;
  console.log(`\ntimestamp presets · catalog ${catalog.hash} · ${places} places × ${outfits} outfits = ${combinations} combinations\n`);

  console.log('PLACES');
  console.log(table(menu.places, [
    { key: 'id', head: 'id' },
    { key: 'climate', head: 'climate' },
    { key: 'timeOfDay', head: 'time' },
    { key: 'label', head: 'label' },
  ]));

  console.log('\nOUTFITS');
  console.log(table(menu.outfits.map((o) => ({ ...o, climate: o.climate.join('/') })), [
    { key: 'id', head: 'id' },
    { key: 'climate', head: 'climate' },
    { key: 'label', head: 'label' },
  ]));

  console.log('\n  npm run compose -- --place=<id> --outfit=<id>   the exact prompts for one pairing');
  console.log('  npm run compose -- --all                       every combination, for a read-through\n');
}

main();
