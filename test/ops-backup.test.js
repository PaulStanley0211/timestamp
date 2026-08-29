/**
 * The backup: the three directories that cannot be regenerated, copied out.
 *
 * WHAT IS BACKED UP AND WHY ONLY THIS. `out/accounts` holds every balance and
 * ledger row -- the money. `out/owners` is the index that says whose tape is
 * whose -- lose it and every job is orphaned from its payer. `out/refunds`
 * is money the operator still owes or has settled. None of the three can be
 * rebuilt from anything else. What is deliberately NOT copied: `out/jobs`
 * (media, large, and the retention sweep deletes it on a schedule the backup
 * would fight), `out/queue` (transient by design -- a restore should re-enqueue,
 * not resurrect stale leases), sessions and oauth verifiers (a re-login beats
 * restoring a stolen-cookie window).
 *
 * Restore is documented in docs/deploy-runbook.md rather than automated:
 * an automated restore that can run against a LIVE root is a foot-gun the
 * size of the product.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runBackup, parseArgs, BACKUP_DIRS, BACKUP_NAME_RE } from '../scripts/ops/backup.mjs';

function seededRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-backup-src-'));
  fs.mkdirSync(path.join(root, 'out', 'accounts', 'ab'), { recursive: true });
  fs.writeFileSync(path.join(root, 'out', 'accounts', 'ab', 'abc123.json'), '{"credits":42}');
  fs.mkdirSync(path.join(root, 'out', 'owners', 'abc123'), { recursive: true });
  fs.writeFileSync(path.join(root, 'out', 'owners', 'abc123', 'job-1'), '');
  fs.mkdirSync(path.join(root, 'out', 'refunds'), { recursive: true });
  fs.writeFileSync(path.join(root, 'out', 'refunds', 'job-1.json'), '{"held":21}');
  // The things that must NOT travel.
  fs.mkdirSync(path.join(root, 'out', 'jobs', 'job-1', 'input'), { recursive: true });
  fs.writeFileSync(path.join(root, 'out', 'jobs', 'job-1', 'input', 'upload-photo'), 'a face');
  fs.mkdirSync(path.join(root, 'out', 'queue', 'pending'), { recursive: true });
  fs.writeFileSync(path.join(root, 'out', 'queue', 'pending', '1-job-1.json'), '{}');
  return root;
}

const destFor = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ts-backup-dst-'));
const AT = new Date('2026-08-29T21:00:00Z');

test('a backup carries the money and the ownership, byte for byte', () => {
  const root = seededRoot();
  const to = destFor();
  const { dir, counts } = runBackup({ root, to, nowImpl: () => AT, logImpl: () => {} });

  // Present FIRST, absence second -- an empty readdir satisfies every
  // negative assertion you can write (CLAUDE.md, 2026-08-29).
  assert.equal(fs.readFileSync(path.join(dir, 'accounts', 'ab', 'abc123.json'), 'utf8'), '{"credits":42}');
  assert.ok(fs.existsSync(path.join(dir, 'owners', 'abc123', 'job-1')));
  assert.equal(fs.readFileSync(path.join(dir, 'refunds', 'job-1.json'), 'utf8'), '{"held":21}');
  assert.deepEqual(counts, { accounts: 1, owners: 1, refunds: 1 });

  // The photograph and the queue stay home.
  assert.ok(!fs.existsSync(path.join(dir, 'jobs')), 'a backup must not carry photographs of faces');
  assert.ok(!fs.existsSync(path.join(dir, 'queue')), 'stale leases must not be restorable');

  // The manifest says when, from where, and how much -- the question a
  // restore starts with.
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'backup.json'), 'utf8'));
  assert.equal(manifest.at, AT.toISOString());
  assert.deepEqual(manifest.counts, counts);
  assert.match(path.basename(dir), BACKUP_NAME_RE);
});

test('a fresh install with nothing to back up still produces a truthful backup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-backup-src-'));
  const to = destFor();
  const { dir, counts } = runBackup({ root, to, nowImpl: () => AT, logImpl: () => {} });
  assert.deepEqual(counts, { accounts: 0, owners: 0, refunds: 0 });
  assert.ok(fs.existsSync(path.join(dir, 'backup.json')));
});

test('a destination inside the root is refused -- a backup on the disk it protects is not a backup', () => {
  const root = seededRoot();
  assert.throws(
    () => runBackup({ root, to: path.join(root, 'out', 'backups'), nowImpl: () => AT, logImpl: () => {} }),
    /inside the root/,
  );
});

test('--keep prunes only backup-shaped directories, oldest first, and never a stranger', () => {
  const root = seededRoot();
  const to = destFor();
  // Three earlier backups and one directory that merely lives nearby. The
  // near-miss is the dangerous shape -- the purge CLI's own lesson.
  for (const stamp of ['20260826T210000Z', '20260827T210000Z', '20260828T210000Z']) {
    fs.mkdirSync(path.join(to, `timestamp-backup-${stamp}`), { recursive: true });
  }
  fs.mkdirSync(path.join(to, 'my-own-notes'), { recursive: true });
  fs.writeFileSync(path.join(to, 'my-own-notes', 'precious.txt'), 'do not touch');

  const { pruned } = runBackup({ root, to, keep: 2, nowImpl: () => AT, logImpl: () => {} });

  const left = fs.readdirSync(to).sort();
  assert.ok(left.includes('my-own-notes'), 'a directory that is not a backup was deleted');
  assert.equal(fs.readFileSync(path.join(to, 'my-own-notes', 'precious.txt'), 'utf8'), 'do not touch');
  const backups = left.filter((n) => BACKUP_NAME_RE.test(n));
  assert.equal(backups.length, 2, `keep=2 left ${backups.length}: ${backups.join(', ')}`);
  assert.ok(backups.includes('timestamp-backup-20260829T210000Z'), 'the newest backup is the one just written');
  assert.deepEqual(pruned, ['timestamp-backup-20260826T210000Z', 'timestamp-backup-20260827T210000Z']);
});

test('without --keep nothing is ever pruned', () => {
  const root = seededRoot();
  const to = destFor();
  fs.mkdirSync(path.join(to, 'timestamp-backup-20260801T000000Z'), { recursive: true });
  const { pruned } = runBackup({ root, to, nowImpl: () => AT, logImpl: () => {} });
  assert.deepEqual(pruned, []);
  assert.ok(fs.existsSync(path.join(to, 'timestamp-backup-20260801T000000Z')));
});

test('the CLI arguments are a whitelist, exactly like the purge CLI', () => {
  // `--to` is required; an unknown or near-miss flag is a refusal with nothing
  // touched, because `--kep=3` silently ignored is a cron job that fills the
  // disk it was meant to protect. `--root` is explicit like every other CLI
  // here -- the Dockerfile's own comment records why an env fallback is the
  // wrong shape ("--root is a FLAG with no environment fallback").
  assert.deepEqual(parseArgs(['--to=/backups']), { to: '/backups', keep: null, root: null, help: false });
  assert.deepEqual(parseArgs(['--to=/backups', '--keep=14', '--root=/data']),
    { to: '/backups', keep: 14, root: '/data', help: false });
  assert.deepEqual(parseArgs(['--help']), { to: null, keep: null, root: null, help: true });
  assert.throws(() => parseArgs(['--to=/backups', '--kep=3']), /unknown option/);
  assert.throws(() => parseArgs([]), /--to/);
  assert.throws(() => parseArgs(['--to=/backups', '--keep=0']), /--keep/);
  assert.throws(() => parseArgs(['--to=/backups', '--keep=x']), /--keep/);
});

test('package.json wires npm run backup to the CLI', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.backup ?? '', /ops\/backup-cli\.mjs/);
});
