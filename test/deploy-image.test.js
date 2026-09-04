/**
 * The container image, pinned the way `guards.yml` pins the other decisions
 * that are invisible when they break.
 *
 * WHY THIS FILE EXISTS. `COPY . .` is one line and it is the most dangerous
 * line in any Dockerfile in this repository, because everything it must not
 * copy is exactly what this project holds: `.env` carries FAL_KEY, three
 * Supabase keys and two Stripe secrets, and `out/` carries photographs of real
 * people's faces along with their sessions and their credit ledgers. An image
 * that bakes either one looks identical to a correct image -- it builds, it
 * boots, it serves -- right up until it is pushed to a registry, at which
 * point the secrets are published and the retention promise in the consent
 * text is a lie. That is the same failure shape `guards.yml` was written for:
 * silence.
 *
 * WHY THE ASSERTIONS ARE ABOUT OUTCOMES AND NOT ABOUT STRINGS. Checking that
 * `.dockerignore` contains the characters `.env` proves nothing -- a later
 * `!.env` on the line below reverses it, and Docker's last-match-wins rule
 * means the file cannot be read top to bottom by eye. So the ignore rules are
 * evaluated against concrete paths and the QUESTION ASKED IS "would this file
 * enter the image?". `matchesIgnore` below implements the subset of Docker's
 * documented rules this file actually uses; it was cross-checked once against
 * a real `docker build` for every path named here, and that check is recorded
 * in the commit rather than run on every suite, because `npm test` must not
 * require Docker to be installed.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED: that the image runs. That needs a daemon,
 * a network and two minutes, and it belongs in a smoke check rather than in a
 * suite that has to stay a bare `node --test`. What is asserted is every
 * property whose breakage is silent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------
// Docker's ignore rules, the subset this repository's .dockerignore uses.
// ---------------------------------------------------------------------------

/**
 * One `.dockerignore` line against one slash-separated path.
 *
 * Docker matches with Go's `filepath.Match` extended by `**`. The rules that
 * matter here: a pattern matches a path if it matches the whole path, OR if it
 * matches any leading directory of it -- which is what makes a bare `out`
 * exclude `out/jobs/x/input/photo.jpg` without a trailing wildcard.
 */
function patternMatches(pattern, filePath) {
  const rx = new RegExp('^' + pattern
    .split('/')
    .map((seg) => (seg === '**'
      ? '\u0001DOUBLE\u0001'
      : seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')))
    .join('/')
    .replace(/\u0001DOUBLE\u0001\//g, '(?:.*/)?')
    .replace(/\/?\u0001DOUBLE\u0001/g, '(?:/.*)?')
    + '$');

  if (rx.test(filePath)) return true;
  // A directory pattern excludes everything beneath it.
  const parts = filePath.split('/');
  for (let i = 1; i < parts.length; i += 1) {
    if (rx.test(parts.slice(0, i).join('/'))) return true;
  }
  return false;
}

/** Would Docker exclude this path? Last matching line wins; `!` negates. */
function matchesIgnore(lines, filePath) {
  let excluded = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    const pattern = (negated ? line.slice(1) : line).replace(/^\.\//, '').replace(/\/$/, '');
    if (!pattern) continue;
    if (patternMatches(pattern, filePath)) excluded = !negated;
  }
  return excluded;
}

const ignoreLines = () => read('.dockerignore').split(/\r?\n/);

// ---------------------------------------------------------------------------
// What must never enter the image.
// ---------------------------------------------------------------------------

/**
 * Every one of these is a real path this working copy either has or produces.
 * They are listed individually rather than as one glob so that a failure names
 * the thing that would have been published.
 */
const MUST_BE_EXCLUDED = [
  // Credentials. Seven of them in one file.
  '.env',
  '.env.local',
  // Real people's faces, their sessions, their ledgers, and the OAuth
  // verifiers. `out/` is gitignored for exactly this reason; an image is a
  // second way to publish a directory and it needs its own rule.
  'out/jobs/20260824-122201-af8b0d/input/photo.jpg',
  'out/accounts/e9eb3f5999235f3a7074b01766bdb9db.json',
  'out/sessions/_secret',
  'out/oauth/somestate.json',
  'out/blind-check/send/1.png',
  // The owner's own selfie, which carries the GPS this app strips.
  'assets/test-photos/face.jpg',
  // The security reviews. Gitignored because this repo is public; an image
  // pushed to a public registry publishes just as effectively.
  'docs/security-review-2026-08-25.md',
  'docs/security-review-brief.md',
  // Build scratch and local git state. Not dangerous, just weight -- and
  // `.git` carries every branch, which is more than a runtime needs.
  'node_modules/anything/index.js',
  'build/test/out.mp4',
  '.git/config',
];

// ---------------------------------------------------------------------------
// What the app cannot run without.
// ---------------------------------------------------------------------------

/**
 * The font is the interesting one. `resolveFont` falls back to a system face
 * when the bundled file is missing and reports `bundled: false` -- it does not
 * throw. So an image without it renders tapes with a date stamp in whatever
 * typeface the base image happens to carry, which breaks determinism silently
 * and is precisely the machine-dependence the bundled font was committed to
 * remove.
 */
const MUST_BE_INCLUDED = [
  'package.json',
  'scripts/web/server-cli.mjs',
  'scripts/worker/worker-cli.mjs',
  'scripts/preflight/doctor.mjs',
  'config/render.json',
  'config/credits.json',
  'presets/places/amalfi-afternoon.json',
  'assets/fonts/tape-osd.ttf',
  'assets/fonts/OFL.txt',
  'assets/places/amalfi-afternoon.jpg',
];

test('the image excludes every credential and every photograph of a real person', () => {
  const lines = ignoreLines();
  for (const p of MUST_BE_EXCLUDED) {
    assert.equal(matchesIgnore(lines, p), true,
      `.dockerignore would let ${p} into the image`);
  }
});

test('the image still contains everything the app needs to render', () => {
  const lines = ignoreLines();
  for (const p of MUST_BE_INCLUDED) {
    assert.equal(matchesIgnore(lines, p), false,
      `.dockerignore excludes ${p}, which the app cannot run without`);
  }
});

test('the licence travels with the font it licenses', () => {
  // OFL 1.1 permits bundling and redistribution, and it requires the licence
  // to accompany the font. An image is a redistribution.
  const lines = ignoreLines();
  assert.equal(matchesIgnore(lines, 'assets/fonts/tape-osd.ttf'), false);
  assert.equal(matchesIgnore(lines, 'assets/fonts/OFL.txt'), false);
});

// ---------------------------------------------------------------------------
// The Dockerfile itself.
// ---------------------------------------------------------------------------

test('the Dockerfile survives a checkout on a machine that wants CRLF', () => {
  // MEASURED, NOT FEARED. `core.autocrlf` is true on the machine this was
  // written on, and a fresh clone there rewrites LF to CRLF. Fed a CRLF
  // Dockerfile, BuildKit answers
  //   dockerfile parse error on line 3: unknown instruction: echo
  // because a `\` continuation followed by CR is not a continuation. There are
  // four of them in this file, all inside the layer that installs and
  // version-gates ffmpeg.
  //
  // This asserts the BYTES rather than the presence of a .gitattributes rule,
  // so it goes red on the machine where the problem actually exists rather
  // than on the one where the rule was forgotten.
  //
  // `.dockerignore` is checked too, though for the opposite reason: it was
  // tested against a real build and BuildKit DOES strip the CR there, so a
  // CRLF ignore file still excludes `.env` correctly. It is pinned anyway
  // because relying on a stripping behaviour to keep secrets out of an image
  // is a thinner guarantee than not needing it.
  for (const rel of ['Dockerfile', '.dockerignore']) {
    const bytes = fs.readFileSync(path.join(REPO_ROOT, rel));
    assert.equal(bytes.includes(0x0d), false,
      `${rel} has CRLF endings; a \\ continuation followed by CR stops being a continuation`);
  }
});

test('the base image is pinned by digest, not by a moving tag', () => {
  const df = read('Dockerfile');
  const froms = [...df.matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
  assert.ok(froms.length > 0, 'the Dockerfile has no FROM');
  for (const ref of froms) {
    assert.match(ref, /@sha256:[0-9a-f]{64}$/,
      `FROM ${ref} is a moving tag -- a rebuild would silently change the ffmpeg and node underneath`);
  }
});

test('the node in the image satisfies the engines range package.json declares', () => {
  // Two files, one fact. Raising `engines` without raising the image gives a
  // container that boots and then fails on syntax the older node cannot parse.
  const df = read('Dockerfile');
  const engines = JSON.parse(read('package.json')).engines.node;
  const required = Number(engines.match(/(\d+)/)[1]);
  const declared = df.match(/^ARG\s+NODE_MAJOR=(\d+)/m);
  assert.ok(declared, 'the Dockerfile does not declare NODE_MAJOR, so nothing can compare it');
  assert.ok(Number(declared[1]) >= required,
    `image node ${declared[1]} is below package.json engines ${engines}`);
});

test('the build fails if ffmpeg cannot do the look', () => {
  // `doctor` checks all of REQUIRED_FILTERS and the font, and exits non-zero
  // on any fatal. Running it as a build step is what turns "this base image
  // happens to have an ffmpeg without chromashift" from a render-time crash
  // that has already spent money into a build that does not produce an image.
  const df = read('Dockerfile');
  assert.match(df, /RUN[^\n]*doctor\.mjs/,
    'the Dockerfile never runs the preflight, so a broken ffmpeg ships');
});

test('the container does not run as root', () => {
  const df = read('Dockerfile');
  assert.match(df, /^USER\s+(?!root\b)\S+/m,
    'no USER directive, so the app runs as root against uploads from strangers');
});

test('the data root is a mount point, not a directory inside the image', () => {
  // `out/` holds the queue, and the queue claims jobs with `linkSync` -- so
  // web and worker must see ONE filesystem. Baking it into the image layer
  // gives each container its own copy, which loses jobs and, per the security
  // review's note on the free-tape register, silently multiplies a bound that
  // is supposed to be global.
  const df = read('Dockerfile');
  const root = df.match(/^ENV\s+TIMESTAMP_DATA_ROOT=(\S+)/m);
  assert.ok(root, 'the Dockerfile does not name a data root');
  assert.match(df, new RegExp(`^VOLUME\\s+\\[?"?${root[1]}`, 'm'),
    `${root[1]} is not declared a VOLUME, so out/ lives in the container layer`);
  assert.ok(!root[1].startsWith('/app/'),
    'the data root is inside the code directory, so a redeploy would replace it');
});

test('the data root is owned by the user that will write to it', () => {
  // FOUND BY RUNNING THE IMAGE, NOT BY READING IT. A fresh named volume takes
  // its ownership from the directory the image has at that path, and an image
  // that never creates the path gives Docker a root-owned default -- so the
  // container starts, the banner never prints, and the only symptom is
  // `EACCES: permission denied, mkdir '/data/out/queue/pending'` in a log
  // nobody reads while every probe from outside reports a refused connection.
  //
  // The chown has to happen while the build is still root and BEFORE the USER
  // switch, so the ordering is asserted, not merely the presence.
  const df = read('Dockerfile');
  const root = df.match(/^ENV\s+TIMESTAMP_DATA_ROOT=(\S+)/m)[1];
  const user = df.match(/^USER\s+(\S+)/m)[1];

  const chownAt = df.search(new RegExp(`^RUN[^\\n]*chown[^\\n]*${user}[^\\n]*${root}`, 'm'));
  assert.notEqual(chownAt, -1,
    `nothing gives ${user} ownership of ${root}, so a fresh volume mounts root-owned and every write fails`);
  assert.ok(chownAt < df.search(/^USER\s/m),
    'the chown runs after the USER switch, when the build no longer has the privilege to do it');

  // AND THE SOURCE TREE IS NOT CHOWNED, which is the other half of the same
  // question and the one nothing asserted. Nothing in the running container
  // writes to /app -- that is why /data exists and is chowned separately -- so
  // handing /app to the runtime user buys nothing and removes the last
  // containment layer between a file-write bug and code execution. This service
  // takes multipart uploads of arbitrary files from strangers through a
  // hand-written parser; if the writing process owns every .mjs the worker
  // imports, an arbitrary-write becomes RCE with four production credentials in
  // the environment.
  assert.ok(!new RegExp(`^COPY\\s+--chown[^\\n]*\\s\\.\\s+\\.\\s*$`, 'm').test(df),
    'the source tree is chowned to the runtime user, so the app can rewrite its own code');
});

test('the default command binds a reachable address and roots at the volume', () => {
  // TWO TRAPS, BOTH SILENT, BOTH ALREADY PAID FOR ONCE IN THIS REPOSITORY.
  //
  // `server-cli.mjs` defaults to `host: '127.0.0.1'`, which inside a container
  // means the loopback of the container's OWN namespace: the process starts,
  // logs its banner, answers nothing, and every probe reports a connection
  // refused with no error anywhere. That is the same shape as the Stripe CLI
  // dialling `::1` against an IPv4 bind -- section 27 -- and it cost a day.
  //
  // `--root` is a FLAG with no environment fallback (`opts.root = REPO_ROOT`),
  // so setting TIMESTAMP_DATA_ROOT alone does nothing. Without the flag the
  // queue, the accounts and the sessions land in the image's own layer and
  // vanish on redeploy, which looks exactly like a working deployment until
  // somebody signs in twice.
  const df = read('Dockerfile');
  const cmd = df.match(/^CMD\s+(.+)$/m);
  assert.ok(cmd, 'the Dockerfile declares no CMD');
  assert.match(cmd[1], /--host=0\.0\.0\.0/,
    'the default command binds loopback, so nothing outside the container can reach it');
  const root = df.match(/^ENV\s+TIMESTAMP_DATA_ROOT=(\S+)/m)[1];
  assert.ok(cmd[1].includes(`--root=${root}`),
    `the default command does not pass --root=${root}, so state lands in the image layer`);
});

test('the image bakes no secret and no build-time credential', () => {
  const df = read('Dockerfile');
  for (const name of ['FAL_KEY', 'SUPABASE_SECRET_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SUPABASE_PUBLISHABLE_KEY']) {
    assert.ok(!new RegExp(`(ENV|ARG)\\s+${name}`).test(df),
      `${name} is set at build time, which writes it into an image layer forever`);
  }
  assert.ok(!/^COPY[^\n]*\s\.env/m.test(df), 'the Dockerfile copies .env');
});
