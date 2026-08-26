/**
 * Where the PKCE verifier waits while the person is at Google.
 *
 * WHY A FILE AND NOT A COOKIE. A row can be deleted after one use; a cookie
 * cannot be made single-use, and a replayable verifier is a replayable login.
 * Same argument as sessions, spec §4.2.
 *
 * WHY THE STATE IS THE FILENAME. The callback arrives holding a state and
 * nothing else we trust. Looking it up by name means an unknown state costs one
 * failed stat rather than a directory scan.
 */
import fs from 'node:fs';
import path from 'node:path';

export const OAUTH_DIR = 'out/oauth';
export const OAUTH_TTL_MS = 10 * 60 * 1000;
const STATE_RE = /^[A-Za-z0-9_-]{1,128}$/;
const defaultNow = () => new Date();

function dirFor(root) {
  const dir = path.join(root, OAUTH_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Refuses a state that could escape the directory. The regex is the guard. */
function fileFor(root, state) {
  if (!STATE_RE.test(String(state ?? ''))) return null;
  return path.join(dirFor(root), `${state}.json`);
}

export function putVerifier({ root, state, verifier, next = '', ttlMs = OAUTH_TTL_MS, nowImpl = defaultNow }) {
  const file = fileFor(root, state);
  if (!file) throw new TypeError('putVerifier needs a well-formed state');
  const expiresAt = new Date(nowImpl().getTime() + ttlMs).toISOString();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ verifier, next, expiresAt }), 'utf8');
  fs.renameSync(tmp, file);
}

/** Reads and DELETES. The delete happens whether or not the row was still
 *  valid, so an expired state cannot be retried until it is guessed right. */
export function takeVerifier({ root, state, nowImpl = defaultNow }) {
  const file = fileFor(root, state);
  if (!file) return null;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try { fs.unlinkSync(file); } catch { /* already gone; the read is what counts */ }
  let row;
  try { row = JSON.parse(raw); } catch { return null; }
  if (!row || typeof row.verifier !== 'string') return null;
  if (new Date(row.expiresAt).getTime() <= nowImpl().getTime()) return null;
  return { verifier: row.verifier, next: typeof row.next === 'string' ? row.next : '' };
}

export function sweepOAuth({ root, nowImpl = defaultNow }) {
  const dir = dirFor(root);
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    try {
      const row = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (new Date(row.expiresAt).getTime() <= nowImpl().getTime()) {
        fs.unlinkSync(file);
        removed += 1;
      }
    } catch {
      fs.unlinkSync(file);
      removed += 1;
    }
  }
  return removed;
}
