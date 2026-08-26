/**
 * The gate that runs before anything expensive.
 *
 * The failure it exists to prevent is specific and expensive: spend real money
 * on a still, spend more on a fifteen-second animation, and then crash in the
 * final ffmpeg pass because this build has no `drawtext`, or because the font
 * moved, or because the disk is full. Every check here is cheap and local, and
 * every one of them fails in a way that costs nothing.
 *
 * Checks are reported, never thrown one at a time -- if three things are wrong
 * you want to know all three now, not to fix one and re-run to discover the
 * next. `assertReady` is the thing that throws, once, naming the first fatal.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { REPO_ROOT, findFfmpeg, availableFilters, runFfmpeg } from '../ffmpeg/run.mjs';
import { tapeGeometry, deliveryGeometry, frameCount } from '../tapedeck/frame.mjs';

/** Every filter the look chain compiles to, plus the audio ones M2 needs. They
 *  are checked together because discovering a missing audio filter at M2 is the
 *  same wasted round trip as discovering a missing video filter at M1. */
export const REQUIRED_FILTERS = [
  'geq', 'maskedmerge', 'gblur', 'avgblur', 'blend', 'curves', 'colorbalance',
  'eq', 'vignette', 'noise', 'chromashift', 'drawtext', 'overlay', 'crop',
  'scale', 'split', 'color', 'trim', 'setpts', 'setsar', 'format', 'fps',
  'select', 'hstack', 'signalstats', 'movie',
  'anoisesrc', 'sine', 'tremolo', 'amix', 'alimiter', 'highpass', 'lowpass',
  'volume', 'aformat', 'ebur128',
];

const BUNDLED_FONT = 'assets/fonts/tape-osd.ttf';

/**
 * Find a usable font for the date stamp.
 *
 * The bundled relative path is the supported route, and it is the only one that
 * makes a render reproducible across machines -- a system font is whatever that
 * machine happens to have. A fallback exists so the look can be developed today
 * rather than blocking on sourcing a typeface, but it reports `bundled: false`
 * and the CLI prints that loudly.
 */
export function resolveFont({ root = REPO_ROOT, existsImpl = fs.existsSync } = {}) {
  if (existsImpl(path.join(root, BUNDLED_FONT))) {
    return { path: BUNDLED_FONT, bundled: true };
  }
  const fallbacks = process.platform === 'win32'
    ? ['C:/Windows/Fonts/consola.ttf', 'C:/Windows/Fonts/cour.ttf', 'C:/Windows/Fonts/arial.ttf']
    : ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/Library/Fonts/Arial.ttf'];
  for (const f of fallbacks) if (existsImpl(f)) return { path: f, bundled: false };
  return { path: null, bundled: false };
}

function check(id, ok, detail, { fatal = true } = {}) {
  return { id, ok, detail, fatal };
}

export async function doctor({ cfg, env = process.env, root = REPO_ROOT } = {}) {
  const checks = [];

  // --- ffmpeg -------------------------------------------------------------
  const bins = findFfmpeg({ env });
  let version = null;
  try {
    const { stderr, stdout } = await runFfmpeg(['-hide_banner', '-version'], { env });
    version = (stdout || stderr).split(/\r?\n/)[0] ?? null;
    checks.push(check('ffmpeg', true, version));
  } catch (err) {
    checks.push(check('ffmpeg', false, `${bins.ffmpeg} not runnable: ${err.message}`));
  }

  // --- filters ------------------------------------------------------------
  if (version) {
    const have = await availableFilters({ env });
    const missing = REQUIRED_FILTERS.filter((f) => !have.has(f));
    checks.push(check(
      'filters',
      missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : `all ${REQUIRED_FILTERS.length} required filters present`,
    ));
  }

  // --- the render contract ------------------------------------------------
  try {
    frameCount(cfg);
    const tape = tapeGeometry(cfg);
    const delivery = deliveryGeometry(cfg);
    checks.push(check(
      'contract',
      true,
      `${cfg.totalFrames} frames @ ${cfg.fps}fps = ${cfg.durationSeconds}.000s · ` +
      `tape ${tape.width}x${tape.height} SAR ${tape.sar} · ` +
      `delivery ${delivery.width}x${delivery.height}, image at y=${delivery.offsetY}`,
    ));
  } catch (err) {
    checks.push(check('contract', false, err.message));
  }

  // --- font ---------------------------------------------------------------
  const font = resolveFont({ root });
  if (!font.path) {
    checks.push(check('font', false, 'no usable font found. The date stamp cannot render.'));
  } else if (font.bundled) {
    checks.push(check('font', true, `${font.path} (bundled)`));
  } else {
    checks.push(check(
      'font',
      true,
      `falling back to the system font ${font.path}. Renders will NOT reproduce on another machine. ` +
      `Drop an OFL camcorder/VCR face at ${BUNDLED_FONT} to fix.`,
      { fatal: false },
    ));
  }

  // --- disk ---------------------------------------------------------------
  try {
    const stat = fs.statfsSync(root);
    const freeGb = (stat.bsize * stat.bavail) / 1e9;
    checks.push(check('disk', freeGb > 2, `${freeGb.toFixed(1)} GB free`, { fatal: freeGb <= 0.5 }));
  } catch {
    checks.push(check('disk', true, 'could not determine free space', { fatal: false }));
  }

  // --- provider credentials ----------------------------------------------
  // Not fatal at M1: the entire look chain runs without a provider, and that is
  // the point of building it first.
  checks.push(check(
    'FAL_KEY',
    Boolean(env.FAL_KEY),
    env.FAL_KEY ? 'present' : 'not set -- fine for `npm run look`, required before `npm run render --provider=fal`',
    { fatal: false },
  ));

  // --- identity provider ---------------------------------------------------
  // Not fatal: `scripts/web/server-cli.mjs`'s `supabaseFromEnv` already
  // degrades a fully-absent configuration to `null`, and the app boots with
  // the identity routes answering 503. This is reporting, not gating -- and
  // it reports presence only. NEVER the value: a URL, a publishable key and
  // especially the secret key are exactly the kind of thing this command
  // must not put in a terminal's scrollback or a CI log.
  //
  // KNOWN GAP, recorded in CLAUDE.md rather than fixed here: this script has
  // no `--env-file-if-exists`, unlike `render` and `worker`, so it reports
  // "not set" for a correctly configured `.env` unless run as
  // `node --env-file-if-exists=.env scripts/preflight/doctor.mjs`. That gap
  // was offered to the owner once and not taken up; this task does not
  // silently fix it.
  for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) {
    checks.push(check(
      key,
      Boolean(env[key]),
      env[key] ? 'present' : 'not set -- identity routes will 503 with one sentence until all three are set',
      { fatal: false },
    ));
  }

  return { ok: checks.every((c) => c.ok || !c.fatal), checks, font, version };
}

export function assertReady(report) {
  const fatal = report.checks.find((c) => !c.ok && c.fatal);
  if (fatal) throw new Error(`preflight failed at "${fatal.id}": ${fatal.detail}`);
  return report;
}

export function formatReport(report) {
  const lines = report.checks.map((c) => {
    const mark = c.ok ? 'ok  ' : (c.fatal ? 'FAIL' : 'warn');
    return `  [${mark}] ${c.id.padEnd(9)} ${c.detail}`;
  });
  return [
    'timestamp doctor',
    ...lines,
    '',
    report.ok ? 'Ready.' : 'NOT ready -- fix the FAIL lines above.',
  ].join('\n');
}

// --- CLI -------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('doctor.mjs')) {
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'render.json'), 'utf8'));
  const report = await doctor({ cfg });
  console.log(formatReport(report));
  process.exitCode = report.ok ? 0 : 1;
}
