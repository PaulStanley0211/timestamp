/**
 * The menu. Loads, validates and hashes the curated preset catalog.
 *
 * WHY A CURATED MENU AT ALL, when a text box is one input element. Because a
 * text box is a promise the pipeline cannot keep. The product is a photo of you
 * somewhere specific, and "somewhere specific" only works when the place
 * fragment, the era props, the lens description, the motion hint and the look
 * override were written together by someone who had looked at the result. A
 * free-text place produces a prompt with no era props, no motion hint and the
 * base look profile, which is a materially worse video that the user will
 * nonetheless blame on the product. A menu of fourteen files is also the only
 * version of this that can be reviewed, tested and regression-checked, and it
 * is the reason `npm run compose -- --all` is a thing you can read in one
 * sitting rather than a space you can only sample.
 *
 * WHY THE HASH. A render manifest has to be able to prove, six months later,
 * which version of the menu produced a given video. Preset text WILL be edited
 * -- that is the entire point of keeping it in JSON -- and the moment it is,
 * every earlier render becomes unreproducible unless the manifest either froze
 * the resolved prompt or can name the menu it came from. It does both; this is
 * the second half. The hash covers the raw file bytes rather than the parsed
 * objects, so a change to a `_comment` counts as a change: a comment is how the
 * next author decides what a fragment means, and two catalogs that differ in
 * their documentation are not the same catalog. Line endings are normalised
 * first, because git's autocrlf would otherwise make the hash a property of the
 * machine that checked out the repo rather than of the menu.
 *
 * WHY EVERY I/O CALL IS INJECTED. `readImpl` and `listImpl` default to node:fs,
 * so the CLI passes nothing, but every test in test/catalog.test.js runs against
 * an in-memory catalog with no fixture files on disk. That matters more than it
 * looks: the alternative is a fixtures directory that has to be kept in sync
 * with a schema it is testing, which is the standard way a validation test
 * quietly stops validating anything. Paths are built with forward slashes on
 * purpose -- node:fs accepts them on Windows, and a fake keyed on
 * "root/presets/places/x.json" is legible in a test failure in a way that a
 * backslash path is not.
 *
 * WHY checkCompatibility ONLY WARNS. A padded winter jacket on a grey Baltic
 * beach in February is the obvious combination. A padded winter jacket in a
 * heated living room at night is a person who just got home, which is a better
 * video than either of the sensible options. The climate fields exist so the CLI
 * can say "this is an odd one" -- not so the catalog can refuse it. Every
 * refusal here would be a refusal to make something someone wanted.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CLIMATE_SCALE, PresetError, validateOutfit, validatePlace } from './schema.mjs';

/** Bumped when the schema shape changes. Without it, two catalogs with
 *  identical files but different validation rules hash the same, and a manifest
 *  that says "menu 4f2a9c" stops meaning one thing. */
export const CATALOG_HASH_VERSION = 1;

/**
 * The labels of places that have left the menu, as they read the day they left.
 *
 * A manifest stores the preset ID, and the page translates it through the
 * loaded catalog. A preset that is no longer in the catalog therefore falls
 * through as its id, so the day the four ordinary places became famous ones
 * (2026-09-04, section 60I) every tape anyone had made in the car park would
 * have captioned as `autobahn-raststaette` on their shelf. The tape is theirs
 * and its caption is part of it; a menu change must not rewrite it. A retired
 * id is never reused for a new place, for the same reason.
 */
export const RETIRED_PLACE_LABELS = Object.freeze({
  'autobahn-raststaette': 'The car park, at dusk',
  'balkon-waesche': 'The balcony',
  'hallenbad-nachmittag': 'The swimming pool',
  'plattenbau-treppenhaus': 'The stairwell',
  // Retired the next morning in the Amalfi coast's favour -- the owner's
  // call that one beach is enough and it should be the summer one.
  'ostsee-strand': 'The beach, out of season',
});

export const REPO_ROOT = path
  .resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  .replace(/\\/g, '/');

const KINDS = Object.freeze([
  { key: 'places', dir: 'presets/places', validate: validatePlace },
  { key: 'outfits', dir: 'presets/outfits', validate: validateOutfit },
]);

const defaultRead = (file) => fs.readFileSync(file, 'utf8');
const defaultList = (dir) => fs.readdirSync(dir);

function parseJson(text, file) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new PresetError(`${file} is not valid JSON: ${err.message}`, { file });
  }
}

/**
 * @param {object}   [opts]
 * @param {string}   [opts.root]      repo root; forward slashes, no trailing slash
 * @param {Function} [opts.readImpl]  (absolutePath) => string
 * @param {Function} [opts.listImpl]  (absoluteDir) => string[]
 * @param {object}   [opts.baseLook]  parsed config/look/base.json; read from `root` if omitted.
 *                                    Injected so a test can prove a bad lookOverride path is
 *                                    rejected without editing the real look profile.
 * @returns {{places: Map, outfits: Map, hash: string, count: object}}
 */
export function loadCatalog({ root = REPO_ROOT, readImpl = defaultRead, listImpl = defaultList, baseLook } = {}) {
  const base = baseLook ?? parseJson(readImpl(`${root}/config/look/base.json`), 'config/look/base.json');

  const loaded = {};
  const digestLines = [`catalog/v${CATALOG_HASH_VERSION}`];

  for (const { key, dir, validate } of KINDS) {
    const absDir = `${root}/${dir}`;
    // Sorted, so the hash is a property of the menu and not of the order the
    // filesystem happened to enumerate it in.
    const files = listImpl(absDir).filter((f) => f.endsWith('.json')).sort();
    if (files.length === 0) {
      throw new PresetError(`no presets found in ${dir} -- the catalog cannot be empty`, { dir });
    }

    const map = new Map();
    for (const file of files) {
      const id = file.slice(0, -'.json'.length);
      const text = readImpl(`${absDir}/${file}`).replace(/\r\n/g, '\n');
      const preset = validate(parseJson(text, `${dir}/${file}`), { id, baseLook: base });
      map.set(id, preset);
      digestLines.push(`${dir}/${file}\n${text.trimEnd()}`);
    }
    loaded[key] = map;
  }

  // NUL as the field separator, written as an ESCAPE rather than as a literal
  // byte. A separator that cannot occur inside any field is what stops two
  // different menus hashing the same -- ["ab","c"] and ["a","bc"] must not agree
  // -- so the choice is right. Writing it as a raw 0x00 in the source, however,
  // makes the file report as binary rather than text, defeats most greps and
  // diff tools, and is invisible in review. Same bytes hashed, same hash, no
  // NUL in the repository.
  const hash = createHash('sha256').update(digestLines.join('\n\u0000\n'), 'utf8').digest('hex').slice(0, 16);

  return {
    places: loaded.places,
    outfits: loaded.outfits,
    hash,
    // An object rather than a bare number: a catalog has two kinds, and
    // `combinations` is the figure anyone actually asks for -- it is how long
    // `npm run compose -- --all` takes to read.
    count: {
      places: loaded.places.size,
      outfits: loaded.outfits.size,
      combinations: loaded.places.size * loaded.outfits.size,
    },
  };
}

/** A miss names every id that does exist. A CLI that says `unknown place
 *  "beach"` and stops is asking the operator to go and read a directory
 *  listing; the ids are right here and printing them costs one line. */
function pick(map, id, kind) {
  if (typeof id === 'string' && map.has(id)) return map.get(id);
  const available = [...map.keys()].sort();
  throw new PresetError(
    `no ${kind} "${id}" in the catalog. ${available.length} available: ${available.join(', ')}`,
    { kind, id, available },
  );
}

export const getPlace = (catalog, id) => pick(catalog.places, id, 'place');
export const getOutfit = (catalog, id) => pick(catalog.outfits, id, 'outfit');

/** The menu, flattened for printing. Sorted by id so `npm run presets` lists
 *  the same thing twice in a row. */
export function listCatalog(catalog) {
  const rows = (map, fields) => [...map.values()]
    .map((p) => Object.fromEntries(fields.map((f) => [f, p[f]])))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    places: rows(catalog.places, ['id', 'label', 'climate', 'timeOfDay']),
    outfits: rows(catalog.outfits, ['id', 'label', 'climate']),
  };
}

/**
 * Compare a place's climate against an outfit's, and WARN.
 *
 * One step apart is silent on purpose. A tracksuit jacket (cool/mild) on a cold
 * beach is a normal thing a person does, and a checker that says so about a
 * third of the menu is a checker everyone learns to ignore -- at which point it
 * is worse than nothing, because it also stops being read on the two
 * combinations that genuinely look wrong. Two steps apart is a summer dress in
 * February or a padded jacket in a heated kitchen: still allowed, still
 * renderable, but worth one line of output before a paid call.
 *
 * @returns {{ok: boolean, warnings: string[]}}  ok === "nothing to mention", never "refused"
 */
export function checkCompatibility(place, outfit) {
  const warnings = [];
  const target = CLIMATE_SCALE[place.climate];
  const distances = (outfit.climate ?? []).map((c) => Math.abs(CLIMATE_SCALE[c] - target));
  const nearest = distances.length ? Math.min(...distances) : 0;

  if (nearest >= 2) {
    const dressedFor = outfit.climate.join('/');
    warnings.push(
      `${outfit.label} is a ${dressedFor} outfit and ${place.label} is ${place.climate}. ` +
      'Deliberate is fine -- this is a note, not a refusal.',
    );
  }
  return { ok: warnings.length === 0, warnings };
}
