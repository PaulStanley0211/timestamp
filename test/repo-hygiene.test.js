/**
 * What must never reach this repository, asserted against git itself.
 *
 * THIS REPO IS PUBLIC. `test/deploy-image.test.js` already pins the same class
 * of rule for the container image, and it found the gap that motivated this
 * file: `.dockerignore` carried `.env.*`, `*.pem` and `*.key` while
 * `.gitignore` carried only the literal name `.env`. The image was better
 * protected than the public repository, which is backwards -- a registry push
 * is optional and a public repo is already published.
 *
 * MEASURED, NOT READ. These call `git check-ignore`, so they assert what git
 * will actually do with a path rather than what a pattern looks like it says.
 * A pattern can be right and still not match (leading slash, trailing slash,
 * a later negation), and that difference is the whole finding.
 *
 * The deploy that is next on the list terminates TLS with Caddy on a small VM,
 * which is precisely the workflow that produces `.env.production` and a
 * key/cert pair in a working copy.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** True when git would ignore this path. Uses check-ignore's exit code: 0 is
 *  ignored, 1 is not, anything else is a real failure worth surfacing. */
function isIgnored(relPath) {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', relPath], {
      cwd: REPO_ROOT, stdio: 'ignore',
    });
    return true;
  } catch (err) {
    if (err.status === 1) return false;
    throw err;
  }
}

/**
 * Paths that must be ignored, and why each one is a real thing that appears.
 *
 * Every entry is a file this project's own documented workflow creates. None
 * is hypothetical.
 */
const MUST_BE_IGNORED = [
  // The credential file itself. Seven secrets.
  ['.env', 'the credential file'],
  // What a deploy produces. `.env` alone does not match any of these.
  ['.env.local', 'a local override'],
  ['.env.production', 'what a deploy writes'],
  ['.env.staging', 'the same, one environment over'],
  // TLS material. Caddy on a VM is the leading deploy option and it writes
  // these; a private key in a public repo is the worst single line here.
  ['tls.pem', 'a certificate'],
  ['server.key', 'a private key'],
  ['certs/privkey.pem', 'a private key one directory down'],
  // Real people's faces, sessions, ledgers and OAuth verifiers.
  ['out/accounts/deadbeef.json', 'an account record'],
  ['out/jobs/20260824-122201-af8b0d/input/photo.jpg', "a customer's photograph"],
  // The owner's own selfie, which carries the GPS this app strips.
  ['assets/test-photos/face.jpg', 'a real face with real coordinates'],
  // An accurate list of a live system's open weaknesses is an attack roadmap.
  ['docs/security-review-2026-08-25.md', 'a security review'],
  ['docs/security-review-brief.md', 'a security review brief'],
  // Local agent state. Nothing here is tracked today and this is pre-emptive:
  // the directory already exists in the working tree, so whatever a future
  // settings file, hook, or MCP credential written under it happens to hold is
  // one broad `git add .` away from a public repository. The cost of the rule
  // is one line; the cost of not having it is paid once and cannot be taken
  // back. This repo ships no skills of its own, so nothing here wants tracking.
  ['.claude/settings.local.json', 'local agent settings'],
  ['.claude/worktrees/scratch/x', 'a scratch worktree'],
];

test('every file that must never be published is ignored by git', () => {
  const leaked = MUST_BE_IGNORED
    .filter(([p]) => !isIgnored(p))
    .map(([p, why]) => `  ${p}  (${why})`);

  assert.equal(leaked.length, 0,
    'these paths are NOT gitignored, and this repository is public:\n' + leaked.join('\n'));
});

/** The negation has to survive: `.env.*` must not swallow the one file in that
 *  family that is meant to be tracked and is the operator's only reference for
 *  what the seven variables are called. */
test('.env.example stays tracked', () => {
  assert.equal(isIgnored('.env.example'), false,
    '.env.example is the documented list of required variables and must stay in the repo');

  const tracked = execFileSync('git', ['ls-files', '.env.example'], {
    cwd: REPO_ROOT, encoding: 'utf8',
  }).trim();
  assert.equal(tracked, '.env.example', '.env.example should be a tracked file');
});

/** And the backstop that catches a file already staged. A gitignore only helps
 *  a path nobody forced; this is the check that fails when one was. */
test('nothing dangerous is actually tracked right now', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);

  const dangerous = tracked.filter((p) => (
    /(^|\/)\.env($|\.)/.test(p) && p !== '.env.example'
  ) || /\.(pem|key|p12|pfx)$/.test(p)
    || /^out\//.test(p)
    || /^assets\/test-photos\/(?!README\.md$)/.test(p)
    || /security-review/.test(p));

  assert.deepEqual(dangerous, [],
    'these are tracked and must not be:\n' + dangerous.join('\n'));
});
