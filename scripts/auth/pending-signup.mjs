/**
 * Where consent waits while a person goes to fetch their confirmation code.
 *
 * WHY THIS EXISTS AT ALL. With email confirmation on, `createAccount` -- and
 * the consent write it performs -- does not run at signup. It runs when the
 * six-digit code is typed, which may be minutes or days later. The consent
 * box was ticked on the signup form, at the start of that gap, so something
 * has to carry the agreement forward to the moment the account is actually
 * created. This is that something.
 *
 * CONSENT NEVER GOES TO SUPABASE. It is a record of an agreement with THIS
 * SERVICE -- what the photo will be used for, how long it is kept -- and has
 * nothing to do with proving who owns a mailbox. It stays in this service's
 * own files, exactly as `accounts.mjs` already stores it once the account
 * exists.
 *
 * WHY A FILE AND NOT A COOKIE. Same argument as oauth-store.mjs: a row can be
 * deleted after one use; a cookie cannot be made single-use, and a replayable
 * consent record would let a second confirmation of the same code -- or a
 * guessed one -- collect a second "yes" that was never actually given twice.
 *
 * WHY THE KEY IS THE EMAIL HASH AND NOT THE ADDRESS ITSELF. `accounts.mjs`
 * already keys its account index by `emailHash` rather than a directory of
 * plaintext addresses, for the same reason: this directory would otherwise be
 * a list of everybody currently mid-signup, readable by filename alone.
 */
import fs from 'node:fs';
import path from 'node:path';

import { emailHash } from './accounts.mjs';

export const PENDING_DIR = 'out/pending-signups';
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const HASH_RE = /^[0-9a-f]{64}$/;
const defaultNow = () => new Date();

function dirFor(root) {
  const dir = path.join(root, PENDING_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Refuses a hash that could escape the directory. The regex is the guard.
 *  `emailHash` always returns 64 lowercase hex characters, so this should
 *  never actually fire; it exists for the same reason oauth-store's does --
 *  a filename built from anything other than a validated shape is a path a
 *  future caller could feed something unexpected into. */
function fileFor(root, hash) {
  if (!HASH_RE.test(String(hash ?? ''))) return null;
  return path.join(dirFor(root), `${hash}.json`);
}

/**
 * `email` is hashed here, not by the caller -- `emailHash` normalises
 * internally (trims, lowercases, validates), so a caller passing the address
 * exactly as typed on the signup form gets the same key `takePending` will
 * look up later, whatever casing or stray whitespace the person used.
 */
export function putPending({ root, email, consent, ttlMs = PENDING_TTL_MS, nowImpl = defaultNow }) {
  const hash = emailHash(email);
  const file = fileFor(root, hash);
  if (!file) throw new TypeError('putPending needs a well-formed email hash');
  const expiresAt = new Date(nowImpl().getTime() + ttlMs).toISOString();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ consent, expiresAt }), 'utf8');
  fs.renameSync(tmp, file);
}

/** Reads and DELETES. The delete happens whether or not the row was still
 *  valid, so a code that is confirmed twice -- or guessed after the real
 *  owner already confirmed -- cannot collect consent a second time, and an
 *  expired row cannot be retried once it is noticed to be stale. Returns
 *  `null` on expiry rather than the stale block, so the caller can fall back
 *  to asking the person once at first login instead of silently proceeding
 *  with no consent on file. */
export function takePending({ root, email, nowImpl = defaultNow }) {
  const hash = emailHash(email);
  const file = fileFor(root, hash);
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
  if (!row || typeof row !== 'object' || row.consent === null || typeof row.consent !== 'object') return null;
  if (new Date(row.expiresAt).getTime() <= nowImpl().getTime()) return null;
  return { consent: row.consent };
}

export function sweepPending({ root, nowImpl = defaultNow }) {
  const dir = dirFor(root);
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    try {
      const row = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (new Date(row.expiresAt).getTime() <= nowImpl().getTime()) {
        try {
          fs.unlinkSync(file);
          removed += 1;
        } catch { /* already gone -- someone else's sweep or a manual delete won the race */ }
      }
    } catch {
      try {
        fs.unlinkSync(file);
        removed += 1;
      } catch { /* already gone */ }
    }
  }
  return removed;
}
