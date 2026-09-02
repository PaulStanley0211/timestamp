/**
 * The backup: the three directories that cannot be regenerated, copied out.
 *
 * `out/accounts` is every balance and ledger row. `out/owners` is the index
 * that says whose tape is whose. `out/refunds` is money the operator still
 * owes or has settled. None of the three can be rebuilt from anything else,
 * which is the whole admission test -- everything else under `out/` is either
 * transient by design (queue, sessions, oauth verifiers), or media the
 * retention sweep deletes on a schedule a backup would fight (`out/jobs`,
 * which also holds photographs of faces that must not multiply across disks).
 *
 * COPY, NOT TAR. Every file in these directories is written atomically
 * (tmp + rename), so a plain copy taken mid-traffic contains only complete
 * files -- some from just before the copy, some from just after, each one
 * internally consistent, which is what an append-only ledger needs. A tar
 * pipeline would buy compression at the price of a dependency on an external
 * binary, and this repo's rule is that ffmpeg is the only one.
 *
 * RESTORE IS A RUNBOOK ENTRY, NOT A COMMAND -- docs/deploy-runbook.md. An
 * automated restore that can run against a live root is a foot-gun the size
 * of the product.
 *
 * Pruning (`--keep`) matches `BACKUP_NAME_RE` and nothing else, for the
 * reason the purge CLI whitelists its flags: the near miss is the dangerous
 * shape, and a stranger's directory in the backup destination must be
 * untouchable by construction.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Relative to `<root>/out/`. Order is presentation only; each is optional on
 *  a fresh install. */
export const BACKUP_DIRS = Object.freeze(['accounts', 'owners', 'refunds']);

export const BACKUP_NAME_RE = /^timestamp-backup-\d{8}T\d{6}Z$/;

const USAGE = `
  npm run backup -- --to=<dir> [--keep=<n>] [--root=<dir>]

    --to=<dir>    where the backup directory is written. Must be OUTSIDE the
                  data root -- a backup on the disk it protects is not a backup.
    --keep=<n>    after writing, keep only the newest <n> backups in --to.
                  Only directories named timestamp-backup-<stamp> are ever
                  considered; anything else in --to is invisible to pruning.
    --root=<dir>  the data root holding out/ (default: the repo). In the
                  container this is /data, passed explicitly like every other
                  CLI here.
    --help
`;

export function parseArgs(argv) {
  const opts = { to: null, keep: null, root: null, help: false };
  for (const arg of argv) {
    const [flag, ...rest] = arg.split('=');
    const value = rest.join('=');
    switch (flag) {
      case '--to': opts.to = value; break;
      case '--keep': opts.keep = Number(value); break;
      case '--root': opts.root = value; break;
      case '--help': case '-h': opts.help = true; break;
      default:
        throw new Error(`unknown option ${arg}${USAGE}`);
    }
  }
  if (opts.help) return opts;
  if (!opts.to) throw new Error(`--to is required.${USAGE}`);
  if (opts.keep !== null && (!Number.isInteger(opts.keep) || opts.keep < 1)) {
    throw new Error(`--keep must be a whole number of backups to retain, at least 1.${USAGE}`);
  }
  return opts;
}

/**
 * OWNER-ONLY, EVERY DIRECTORY AND EVERY FILE. The backup lands on the host
 * filesystem, outside the volume, and holds every account's email, ledger
 * and record. `mkdirSync` and `copyFileSync` take the process umask, which
 * on a stock host is 022 -- readable by every local user. The records inside
 * the volume are not world-readable and their copies must not become so on
 * the way out. `chmod` after the create rather than a mode on it, because a
 * mode is masked by the umask and an explicit chmod is not; on Windows both
 * are no-ops and the test that pins this skips there.
 */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

function ownerOnlyDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  fs.chmodSync(dir, DIR_MODE);
}

function copyTree(from, into) {
  let files = 0;
  const walk = (src, dst) => {
    ownerOnlyDir(dst);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      if (entry.isDirectory()) walk(s, d);
      else if (entry.isFile()) { fs.copyFileSync(s, d); fs.chmodSync(d, FILE_MODE); files += 1; }
      // Symlinks and specials are skipped: nothing here writes them, so one
      // appearing is somebody else's artefact, not data to preserve.
    }
  };
  if (fs.existsSync(from)) walk(from, into);
  return files;
}

const stampOf = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * @returns {{dir: string, counts: object, pruned: string[]}}
 */
export function runBackup({
  root,
  to,
  keep = null,
  nowImpl = () => new Date(),
  logImpl = (line) => process.stdout.write(`${line}\n`),
}) {
  const absRoot = path.resolve(root);
  const absTo = path.resolve(to);
  const rel = path.relative(absRoot, absTo);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new Error(
      `the destination ${absTo} is inside the root ${absRoot} -- `
      + 'a backup on the disk it protects is not a backup. Point --to somewhere else.',
    );
  }

  const at = nowImpl();
  const dir = path.join(absTo, `timestamp-backup-${stampOf(at)}`);
  ownerOnlyDir(dir);

  const counts = {};
  for (const name of BACKUP_DIRS) {
    counts[name] = copyTree(path.join(absRoot, 'out', name), path.join(dir, name));
    logImpl(`  ${name.padEnd(9)} ${counts[name]} file(s)`);
  }

  const manifest = path.join(dir, 'backup.json');
  fs.writeFileSync(manifest, `${JSON.stringify({
    at: at.toISOString(),
    root: absRoot,
    dirs: BACKUP_DIRS,
    counts,
  }, null, 2)}\n`, { encoding: 'utf8', mode: FILE_MODE });
  fs.chmodSync(manifest, FILE_MODE);

  const pruned = [];
  if (keep !== null) {
    const backups = fs.readdirSync(absTo, { withFileTypes: true })
      .filter((e) => e.isDirectory() && BACKUP_NAME_RE.test(e.name))
      .map((e) => e.name)
      .sort(); // the stamp sorts chronologically by construction
    for (const name of backups.slice(0, Math.max(0, backups.length - keep))) {
      fs.rmSync(path.join(absTo, name), { recursive: true, force: true });
      pruned.push(name);
      logImpl(`  pruned    ${name}`);
    }
  }

  logImpl(`  backup    ${dir}`);
  return { dir, counts, pruned };
}
