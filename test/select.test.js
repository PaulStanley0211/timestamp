/**
 * Choosing a still, and the page a human chooses it on.
 *
 * THE TEST THIS FILE EXISTS FOR is the numbering one. `stills[].index` is
 * 1-based and agrees with `still-01.png`; array positions are 0-based. If those
 * two ever meet, the pipeline animates the wrong face, the manifest agrees with
 * itself, the contact sheet agrees with itself, and NOTHING reports a fault --
 * you simply pay video prices for a person the user did not pick. There is no
 * assertion that catches it afterwards, so it is pinned here and again in
 * test/pipeline.test.js against the path actually handed to `generateVideo`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  firstScorer, stillAt, chooseStill, SelectionError,
  contactSheetHtml, writeContactSheet, escapeHtml,
} from '../scripts/select/select.mjs';

const stills = [
  { index: 1, path: 'stills/still-01.png', seed: 1000 },
  { index: 2, path: 'stills/still-02.png', seed: 1001 },
  { index: 3, path: 'stills/still-03.png', seed: 1002 },
];

const job = {
  jobId: '20260820-144501-a3f19c',
  provider: 'fixture',
  input: { place: { value: 'schrebergarten-august' }, outfit: { value: 'trainingsjacke' } },
  resolved: { place: { label: 'A Schrebergarten in August' }, outfit: { label: 'A tracksuit jacket' } },
  selection: { stillIndex: null, chosenBy: null },
  steps: [{ name: 'still', output: { stills } }],
};

const roots = [];
function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-select-')).replace(/\\/g, '/');
  roots.push(root);
  return root;
}
test.after(() => {
  for (const root of roots) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* the OS will get it */ }
  }
});

// ---------------------------------------------------------------------------
// the numbering
// ---------------------------------------------------------------------------

test('firstScorer returns a 1-based still index, not an array position', () => {
  assert.equal(firstScorer(stills), 1);
});

test('firstScorer reads the index the provider assigned rather than assuming it', () => {
  assert.equal(firstScorer([{ index: 4, path: 'stills/still-04.png', seed: 7 }]), 4);
});

test('firstScorer refuses an empty set instead of returning undefined', () => {
  assert.throws(() => firstScorer([]), (err) => {
    assert.equal(err.code, 'NO_STILLS');
    return true;
  });
});

test('THE ONE THAT MATTERS: still 2 is still-02.png, never the second array entry of a shifted list', () => {
  assert.equal(stillAt(stills, 2).path, 'stills/still-02.png');
  // A provider that numbered from 2 would make position and index disagree.
  // Looking up by index is what keeps the answer right; looking up by position
  // would silently return still-03 here and nothing downstream would notice.
  const shifted = [
    { index: 2, path: 'stills/still-02.png', seed: 1 },
    { index: 3, path: 'stills/still-03.png', seed: 2 },
  ];
  assert.equal(stillAt(shifted, 2).path, 'stills/still-02.png');
  assert.equal(stillAt(shifted, 3).path, 'stills/still-03.png');
});

test('a still number nobody generated is refused, and the message names what exists', () => {
  assert.throws(() => stillAt(stills, 0), (err) => {
    assert.ok(err instanceof SelectionError);
    assert.equal(err.code, 'NO_SUCH_STILL');
    assert.match(err.message, /Available: 1, 2, 3/);
    return true;
  });
  assert.throws(() => stillAt(stills, 4), /no still numbered 4/);
  assert.throws(() => stillAt(stills, '2'), /must be an integer/);
});

test('chooseStill records WHO chose, because that is the only way to know anyone looked', () => {
  const auto = chooseStill({ stills });
  assert.deepEqual({ i: auto.stillIndex, by: auto.chosenBy, p: auto.still.path },
    { i: 1, by: 'auto', p: 'stills/still-01.png' });

  const human = chooseStill({ stills, requested: 2 });
  assert.deepEqual({ i: human.stillIndex, by: human.chosenBy, p: human.still.path },
    { i: 2, by: 'human', p: 'stills/still-02.png' });
});

test('the scorer is a seam and firstScorer is the only implementation shipped', () => {
  const chosen = chooseStill({ stills, scorer: (list) => list.at(-1).index });
  assert.equal(chosen.stillIndex, 3);
  assert.equal(chosen.chosenBy, 'auto');
});

// ---------------------------------------------------------------------------
// the contact sheet
// ---------------------------------------------------------------------------

test('the contact sheet is self-contained: no network, no external asset', () => {
  const html = contactSheetHtml(job, stills);
  assert.ok(!/https?:\/\//.test(html), 'a URL in the page means a blank panel on a machine with no network');
  assert.ok(!/<link\b/i.test(html), 'an external stylesheet cannot be opened off a USB stick');
  assert.ok(!/<script\b/i.test(html), 'the review page needs no scripting and should not ask for any');
  assert.match(html, /<style>/);
});

test('images are referenced relative to the page, so the file works off disk', () => {
  const html = contactSheetHtml(job, stills);
  assert.match(html, /src="\.\.\/stills\/still-01\.png"/);
  assert.ok(!/src="[A-Za-z]:/.test(html), 'an absolute path makes the sheet unreadable on any other machine');
  assert.ok(!html.includes('\\'), 'a backslash in a src is a path, not a URL');
});

test('every card carries its 1-based number and the exact command that resumes with it', () => {
  const html = contactSheetHtml(job, stills);
  for (const n of [1, 2, 3]) {
    assert.ok(html.includes(`still ${n}<`) || html.includes(`>still ${n}`), `card ${n} is not numbered`);
    assert.ok(html.includes(`--resume=${job.jobId} --still=${n}`), `card ${n} does not print its resume command`);
  }
  // The 0-based array position must never appear as a still number.
  assert.ok(!html.includes('--still=0'), 'a 0 on this page is an off-by-one waiting to be typed');
});

test('the auto-pick is marked, so nobody mistakes a default for a decision', () => {
  assert.match(contactSheetHtml(job, stills), /auto-pick/);
  const chosen = contactSheetHtml({ ...job, selection: { stillIndex: 2, chosenBy: 'human' } }, stills);
  assert.match(chosen, /chosen/);
});

test('user text is escaped -- a place is free text typed by a stranger', () => {
  const nasty = {
    ...job,
    resolved: undefined,
    input: { place: { value: '<img src=x onerror=alert(1)>' }, outfit: { value: '"quoted" & \'odd\'' } },
  };
  const html = contactSheetHtml(nasty, stills);
  assert.ok(!html.includes('<img src=x'), 'unescaped markup reached the review page');
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /&quot;quoted&quot; &amp; &#39;odd&#39;/);
});

test('escapeHtml covers the five characters that matter in text and in an attribute', () => {
  assert.equal(escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
  assert.equal(escapeHtml(null), '');
});

test('writeContactSheet writes review/stills.html and hands back where it put it', () => {
  const root = tmpRoot();
  const paths = { review: `${root}/review` };
  const file = writeContactSheet(job, paths, { stills });
  assert.equal(file, `${root}/review/stills.html`);
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /<!doctype html>/);
  assert.match(html, /still-02\.png/);
});

test('writeContactSheet falls back to the still step output when no list is passed', () => {
  const root = tmpRoot();
  const html = fs.readFileSync(writeContactSheet(job, { review: `${root}/review` }), 'utf8');
  assert.match(html, /still-03\.png/);
});
