/**
 * `doctor()`'s reporting of the three Supabase config values -- task 13.
 *
 * Nothing before this task exercised `doctor()` itself: the two existing
 * imports from this module (`test/audio-output.test.js`,
 * `test/ffmpeg-output.test.js`) only use `resolveFont`. This file is the
 * first coverage of the checks list, and it is scoped to what this task
 * changed -- present/not-set reporting for `SUPABASE_URL`,
 * `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` individually, plus the
 * combined `SUPABASE_CONFIG` check that flags a PARTIAL configuration (some
 * but not all three) as a distinct problem -- never the values, never fatal
 * (an identity-less OR misconfigured build must still be able to render).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

import { doctor } from '../scripts/preflight/doctor.mjs';
import { findFfmpeg } from '../scripts/ffmpeg/run.mjs';
import { SUPABASE_ENV_KEYS } from '../scripts/web/server-cli.mjs';

const CFG = JSON.parse(fs.readFileSync(new URL('../config/render.json', import.meta.url), 'utf8'));

// Same shape as `test/audio-output.test.js`: `doctor()` calls real ffmpeg for
// its own checks, and "you do not have ffmpeg" and "the Supabase reporting is
// broken" must not produce the same red line.
function haveFfmpeg() {
  try {
    execFileSync(findFfmpeg().ffmpeg, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const HAVE = haveFfmpeg();
const skip = HAVE ? false : `ffmpeg not found (${findFfmpeg().ffmpeg}) -- doctor tests skipped`;

function findCheck(report, id) {
  const found = report.checks.find((c) => c.id === id);
  assert.ok(found, `doctor() reported no check named "${id}" -- did SUPABASE_ENV_KEYS drift from doctor.mjs?`);
  return found;
}

test('doctor reports all three Supabase values present/not-set, never fatal, and never a value', { skip }, async () => {
  const secretValue = 'sb_secret_do-not-print-this-anywhere';

  const withNone = await doctor({ cfg: CFG, env: {} });
  const withSome = await doctor({
    cfg: CFG,
    env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: secretValue },
  });
  const withAll = await doctor({
    cfg: CFG,
    env: {
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
      SUPABASE_SECRET_KEY: secretValue,
    },
  });

  // Doctor's own list of what it checks must be the same three names
  // `supabaseFromEnv` actually reads -- a check ID that drifted from that
  // list would report on the wrong thing without a single test noticing.
  for (const key of SUPABASE_ENV_KEYS) {
    assert.equal(findCheck(withNone, key).ok, false, `${key} absent must report not-ok`);
    assert.equal(findCheck(withNone, key).fatal, false, `${key} must never gate the whole report -- identity is optional`);
    assert.equal(findCheck(withAll, key).ok, true, `${key} present must report ok`);
  }

  // A partial configuration is still reported per-value here -- doctor is
  // reporting, not gating, so it says what it sees for each of the three
  // independently.
  assert.equal(findCheck(withSome, 'SUPABASE_URL').ok, true);
  assert.equal(findCheck(withSome, 'SUPABASE_PUBLISHABLE_KEY').ok, false);
  assert.equal(findCheck(withSome, 'SUPABASE_SECRET_KEY').ok, true);

  // `SUPABASE_CONFIG` is the combined check, and it is the one that flags a
  // PARTIAL configuration as a problem worth noticing rather than something
  // the operator has to derive by reading three separate present/not-set
  // lines and doing the arithmetic themselves. Never fatal -- coordinator
  // ruling, 2026-08-26: `supabaseFromEnv` boots and degrades on a partial
  // config exactly like an absent one; `main()`'s startup banner
  // (`supabaseBannerLines`, tested in `test/auth-supabase.test.js`) is the
  // loud half of that decision, not this gate.
  assert.equal(findCheck(withNone, 'SUPABASE_CONFIG').ok, true, 'all three absent is not a problem');
  assert.equal(findCheck(withAll, 'SUPABASE_CONFIG').ok, true, 'all three present is not a problem');
  assert.equal(findCheck(withSome, 'SUPABASE_CONFIG').ok, false, 'two of three present must be flagged as a problem');
  assert.equal(findCheck(withSome, 'SUPABASE_CONFIG').fatal, false, 'still not fatal -- the app boots on it regardless');
  assert.match(findCheck(withSome, 'SUPABASE_CONFIG').detail, /SUPABASE_PUBLISHABLE_KEY/,
    'the missing variable must be named in the combined check too');

  // NEVER THE VALUE. Every check's own detail string, across every report --
  // a leak in any one of them, including one unrelated to Supabase, is the
  // finding this assertion exists to catch.
  for (const report of [withNone, withSome, withAll]) {
    for (const c of report.checks) {
      assert.ok(!String(c.detail).includes(secretValue), `check "${c.id}" printed the secret key value`);
    }
  }

  // `ok` is the report's own top-level fatal/not-fatal summary -- absent
  // identity config alone must not flip it, since nothing here is fatal.
  assert.equal(withNone.checks.filter((c) => !c.ok && c.fatal).length, 0,
    'no Supabase check may be fatal');
});
