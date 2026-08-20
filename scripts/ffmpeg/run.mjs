/**
 * The only module in this repository permitted to spawn a process.
 *
 * That restriction is not tidiness, it is what makes the look testable. Every
 * other module in `tapedeck/` and `audio/` returns strings and string arrays --
 * filtergraphs and argv -- which means roughly ninety percent of the look chain
 * can be asserted with golden strings, in milliseconds, with no ffmpeg involved
 * and no temp files on disk. Only the handful of tests that genuinely need
 * pixels come through here.
 *
 * Two Windows rules are baked in and both were learned the hard way:
 *
 *   1. NEVER build the command as a shell string. A filtergraph is dense with
 *      brackets, single quotes, commas and semicolons, and cmd.exe, PowerShell
 *      and bash each mangle a different subset of them. `spawn(bin, argv)` with
 *      `shell: false` hands the graph to ffmpeg as one argv element, untouched.
 *      There is no escaping scheme that survives all three shells; not using a
 *      shell is the only correct answer.
 *
 *   2. ALWAYS spawn with `cwd` set to the repo root. That is what lets the
 *      burn-in font be referenced as a relative path with forward slashes. No
 *      drive letter means no colon, and `fontfile=` treats a colon as the end
 *      of the option -- so the entire class of `fontfile` escaping bugs simply
 *      never arises. See ffFontPath() in tapedeck/burn-in.mjs for the fallback
 *      when an absolute path is unavoidable.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Thrown when ffmpeg exits non-zero. Carries the tail of stderr, because the
 *  useful line in an ffmpeg failure is almost always the last one. */
export class FfmpegError extends Error {
  constructor(message, { code, args, stderr } = {}) {
    super(message);
    this.name = 'FfmpegError';
    this.code = code;
    this.args = args;
    this.stderr = stderr;
  }
}

/**
 * Locate ffmpeg and ffprobe. Returns nulls rather than throwing so that callers
 * can report honestly -- `doctor` wants to print a diagnosis, and the pixel
 * tests want to skip rather than fail on a machine without ffmpeg.
 */
export function findFfmpeg({ env = process.env } = {}) {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const fromEnv = env.TIMESTAMP_FFMPEG_DIR;
  if (fromEnv) {
    const ffmpeg = path.join(fromEnv, `ffmpeg${exe}`);
    const ffprobe = path.join(fromEnv, `ffprobe${exe}`);
    if (fs.existsSync(ffmpeg) && fs.existsSync(ffprobe)) return { ffmpeg, ffprobe };
  }
  // Bare names resolve through PATH. Both are on PATH on this machine via the
  // gyan.dev winget package; keeping them bare means no hardcoded version path
  // to rot when the package updates.
  return { ffmpeg: `ffmpeg${exe}`, ffprobe: `ffprobe${exe}` };
}

/**
 * Run a command and collect its output.
 *
 * `spawnImpl` is injected with no default at the call sites that matter, in the
 * same spirit as Ad-Regenerator's meta-adapter taking `fetchImpl`: a test that
 * forgets to stub gets a clear failure rather than a real side effect.
 */
export function run(bin, args, { spawnImpl = spawn, cwd = REPO_ROOT, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(bin, args, { cwd, shell: false, windowsHide: true });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      onStderr?.(s);
    });

    child.on('error', (err) => {
      reject(new FfmpegError(
        `could not run "${bin}" -- is it installed and on PATH? (${err.message})`,
        { code: null, args, stderr },
      ));
    });

    child.on('close', (rawCode) => {
      if (rawCode === 0) return resolve({ code: 0, stdout, stderr });
      const code = normalizeExitCode(rawCode);
      reject(new FfmpegError(
        `${bin} exited ${code}: ${lastMeaningfulLine(stderr)}`,
        { code, args, stderr },
      ));
    });
  });
}

/**
 * Pull the useful line out of ffmpeg's stderr.
 *
 * Taking the last line is the obvious approach and it is wrong: ffmpeg's final
 * line is often a generic trailer like "Error : Invalid argument", while the
 * line that actually tells you what happened -- "No such filter: 'nosuchfilter'"
 * -- sits several lines above it. Prefer a specific diagnostic, and fall back to
 * the last line only when nothing more specific is present.
 */
const SPECIFIC = /no such|not found|unrecognized|unable to|cannot |could not|does not|invalid (?!argument$)|failed|denied|too many|unsupported/i;
const GENERIC = /^(error|conversion failed)\s*:?\s*(invalid argument)?\.?$/i;

export function lastMeaningfulLine(stderr = '') {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return '(no stderr)';
  const specific = lines.filter((l) => SPECIFIC.test(l) && !GENERIC.test(l));
  if (specific.length) return specific[specific.length - 1];
  const nonGeneric = lines.filter((l) => !GENERIC.test(l));
  return (nonGeneric.length ? nonGeneric : lines).at(-1);
}

/** Windows reports negative exit codes as their unsigned 32-bit wrap, so a plain
 *  -22 surfaces as 4294967274 and reads like nonsense in an error message. */
export function normalizeExitCode(code) {
  if (typeof code !== 'number') return code;
  return code > 0x7fffffff ? code - 0x100000000 : code;
}

export async function runFfmpeg(args, opts = {}) {
  const { ffmpeg } = findFfmpeg(opts);
  return run(ffmpeg, args, opts);
}

export async function runFfprobe(args, opts = {}) {
  const { ffprobe } = findFfmpeg(opts);
  return run(ffprobe, args, opts);
}

/**
 * Probe a media file into a plain object. Counts frames, which is slower than a
 * header read but is the only way to assert an exact frame count -- and an exact
 * frame count is the whole reason this project is PAL. See config/render.json.
 */
export async function probe(file, { countFrames = false, ...opts } = {}) {
  const args = [
    '-v', 'error',
    '-show_entries', 'stream=index,codec_type,codec_name,width,height,pix_fmt,r_frame_rate,sample_aspect_ratio,display_aspect_ratio,nb_read_frames,channels,sample_rate',
    '-show_entries', 'format=duration,size',
    '-of', 'json',
    ...(countFrames ? ['-count_frames'] : []),
    file,
  ];
  const { stdout } = await runFfprobe(args, opts);
  return JSON.parse(stdout);
}

/** Which filters this ffmpeg build actually has. Used by `doctor` to fail before
 *  a paid call rather than after one. */
export async function availableFilters(opts = {}) {
  const { stdout } = await runFfmpeg(['-hide_banner', '-filters'], opts).catch(() => ({ stdout: '' }));
  const names = new Set();
  for (const line of stdout.split(/\r?\n/)) {
    // ` TS aap               AA->A      Apply ...`
    // The flags column is TWO characters in ffmpeg 8.x (command support was
    // dropped) and three in 6.x, so match either and anchor on the -> arrow,
    // which is the one part of the row that has never moved.
    const m = /^\s+[TSC.]{2,3}\s+(\S+)\s+\S*->\S*/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}
