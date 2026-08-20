import test from 'node:test';
import assert from 'node:assert/strict';
import { lastMeaningfulLine, normalizeExitCode } from '../scripts/ffmpeg/run.mjs';

test('the specific diagnostic wins over the generic trailer', () => {
  // Real ffmpeg 8.1 output for an unknown filter. Taking the last line -- which
  // is what the obvious implementation does -- yields "Error : Invalid argument"
  // and tells the reader nothing.
  const stderr = [
    "[AVFilterGraph @ 0000] No such filter: 'nosuchfilter'",
    'Error reinitializing filters!',
    'Error : Invalid argument',
    '',
  ].join('\n');
  assert.match(lastMeaningfulLine(stderr), /No such filter/);
});

test('a generic-only stderr still returns something', () => {
  assert.equal(lastMeaningfulLine('Error : Invalid argument\n'), 'Error : Invalid argument');
  assert.equal(lastMeaningfulLine(''), '(no stderr)');
  assert.equal(lastMeaningfulLine('   \n \n'), '(no stderr)');
});

test('an informative last line is used as-is', () => {
  assert.equal(
    lastMeaningfulLine('some progress\nassets/fonts/x.ttf: No such file or directory'),
    'assets/fonts/x.ttf: No such file or directory',
  );
});

test('Windows unsigned exit codes are reported as the negative they are', () => {
  assert.equal(normalizeExitCode(4294967274), -22);
  assert.equal(normalizeExitCode(1), 1);
  assert.equal(normalizeExitCode(0), 0);
});
