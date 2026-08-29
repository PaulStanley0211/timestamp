/**
 * The Supabase auth email templates in docs/supabase-email-templates/.
 *
 * WHAT THIS CAN AND CANNOT DO, because the distinction is the whole reason the
 * templates are an owner task rather than a code one. These files are the
 * SOURCE OF TRUTH for what was pasted into a dashboard; they are not what the
 * dashboard is serving. Nothing in this repository can read the live template,
 * and a wrong one produces NO REQUEST to be wrong about -- the person simply
 * receives a link, has nothing to type into a six-digit field, and gives up.
 *
 * So this pins the files. If the dashboard drifts from them, only a real
 * signup and a real reset will show it, which is what the README asks for.
 *
 * Every rule below is one the templates' own headers state in prose. Prose in
 * a header is a wish; this is the version that fails.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DIR = new URL('../docs/supabase-email-templates/', import.meta.url);

/**
 * RAW, AND NEVER WITH THE COMMENTS STRIPPED. The first version of this file
 * stripped them, on the reasoning that a comment naming a forbidden variable
 * would trip its own rule. That reasoning is backwards and it hid the real
 * hazard: THE WHOLE FILE IS PASTED INTO THE DASHBOARD, and Supabase substitutes
 * its variables by scanning text. An HTML comment is not a hiding place from a
 * template engine -- it is just more text. A comment spelling ConfirmationURL
 * in its real syntax mints a working magic link and buries it in the source of
 * every email: invisible when rendered, extractable by anyone who reads the
 * source or is forwarded the message.
 *
 * So the comments now say the variable names in WORDS, and this reads the file
 * exactly as the dashboard will receive it.
 */
const body = (name) => fs.readFileSync(new URL(name, DIR), 'utf8');

/**
 * The same file with comments removed -- and the ONLY thing this is for is
 * checking rendered structure.
 *
 * The two readers exist because two different things read this file and they
 * disagree about what a comment is. SUPABASE'S TEMPLATE ENGINE sees one flat
 * string and will substitute a variable inside a comment as happily as outside
 * one, which is why every variable check above runs on `body`. A MAIL CLIENT
 * parses HTML, so a `<style>` written inside a comment is prose rather than a
 * style block -- and both of these comments say the words "<style>" and
 * "ConfirmationURL" precisely because they are explaining that neither belongs.
 * Checking structure on the raw file marks those explanations as violations.
 */
const markup = (name) => body(name).replace(/<!--[\s\S]*?-->/g, '');

const TEMPLATES = fs.readdirSync(DIR).filter((f) => f.endsWith('.html')).sort();

test('both templates exist, and a new one is covered without being listed here', () => {
  // Named explicitly so DELETING one is a failure -- a directory scan alone
  // would happily report success over an empty directory.
  assert.deepEqual(TEMPLATES, ['confirm-signup.html', 'recovery.html']);
});

test('every template asks for the code, and offers no way round typing it', () => {
  for (const name of TEMPLATES) {
    const raw = body(name);
    assert.ok(raw.includes('{{ .Token }}'), `${name} does not contain the code variable`);
    // Matched as SYNTAX, not as a word: the comments name these variables in
    // prose on purpose, and only a real action gets substituted.
    assert.ok(!/\{\{[^}]*ConfirmationURL/i.test(raw), `${name} carries a magic-link variable`);
    assert.ok(!/\{\{[^}]*TokenHash/i.test(raw), `${name} carries a token hash, which is a link in disguise`);

    // A link of any kind: the six-digit page has nothing to do with one, and a
    // person who can click is a person who will click.
    const html = markup(name);
    assert.ok(!/<a[\s>]/i.test(html), `${name} contains an anchor`);
    assert.ok(!/href\s*=/i.test(html), `${name} contains an href`);
    assert.ok(!/<button[\s>]/i.test(html), `${name} contains a button`);
  }
});

test('the code appears exactly once, so nobody can read the wrong number', () => {
  for (const name of TEMPLATES) {
    const hits = body(name).match(/\{\{ \.Token \}\}/g) ?? [];
    assert.equal(hits.length, 1, `${name} renders the code ${hits.length} times`);
  }
});

test('the ONLY template action in the file is that one code, comments included', () => {
  // The strongest form of the rule, and the one that catches a variable hiding
  // in a comment. Anything Supabase would substitute is matched here, whatever
  // it is named -- so a future edit that mentions ConfirmationURL, TokenHash,
  // SiteURL or Email in real syntax fails, wherever in the file it sits.
  for (const name of TEMPLATES) {
    const actions = body(name).match(/\{\{[^}]*\}\}/g) ?? [];
    assert.deepEqual(actions, ['{{ .Token }}'],
      `${name} carries template actions other than the code: ${JSON.stringify(actions)}`);
  }
});

test('no template depends on anything a mail client has to fetch or keep', () => {
  for (const name of TEMPLATES) {
    const html = markup(name);
    // Gmail strips parts of a <style> block, so every rule is inline. An image
    // or a web font is a request a mail client may refuse, and the six digits
    // must survive being refused.
    assert.ok(!/<style[\s>]/i.test(html), `${name} has a style block Gmail may strip`);
    assert.ok(!/<img[\s>]/i.test(html), `${name} loads an image`);
    assert.ok(!/@import|url\(/i.test(html), `${name} fetches a font or a background`);
  }
});

test('the README carries a subject line for every template', () => {
  // The subject exists ONLY in the README -- the dashboard keeps it on a
  // different field from the body, so a template shipped without one
  // documented means somebody invents a subject at paste time.
  const readme = fs.readFileSync(new URL('README.md', DIR), 'utf8');
  for (const name of TEMPLATES) {
    assert.ok(readme.includes(name), `README.md does not mention ${name}`);
  }
  for (const subject of ['Your Timestamp confirmation code', 'Your Timestamp password reset code']) {
    assert.ok(readme.includes(subject), `README.md is missing the subject "${subject}"`);
  }
});

test('the two subjects differ, so an inbox can tell them apart', () => {
  // Both mails carry six digits and look alike. A person who has asked for a
  // reset while an old confirmation code is still in the inbox must not have
  // to open both to find out which is which.
  const readme = fs.readFileSync(new URL('README.md', DIR), 'utf8');
  const subjects = [...readme.matchAll(/^Your Timestamp .+$/gm)].map((m) => m[0]);
  assert.ok(subjects.length >= 2, 'fewer than two subject lines are documented');
  assert.equal(new Set(subjects).size, subjects.length, 'two templates share a subject line');
});
