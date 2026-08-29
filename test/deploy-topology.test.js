/**
 * The topology: two processes over one volume, behind one TLS terminator.
 *
 * These are text-level assertions in the mould of test/deploy-image.test.js:
 * the compose file was ALSO validated against a real `docker compose config`
 * by hand (recorded in the commit that added it), and what the tests pin is
 * every decision that would break silently if an edit undid it -- the shared
 * volume, the restart policy, the unpublished app ports, the fal worker, and
 * the line endings a Windows clone would otherwise rewrite.
 *
 * WHY web AND worker MUST NOT PUBLISH HOST PORTS. Caddy is the only doorway:
 * it is what terminates TLS, sets X-Forwarded-* honestly (which
 * TIMESTAMP_TRUST_PROXY=1 vouches for), and rate limiters key on the address
 * it reports. A `ports:` line on web would let the internet reach :3000
 * directly with a client-typed X-Forwarded-For -- the exact spoof the trust
 * flag warns about -- and bypass TLS entirely.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const bytes = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url));

test('compose runs both processes from one image over one volume', () => {
  const compose = read('compose.yaml');

  // The worker is the same image with the command replaced -- the Dockerfile's
  // own contract, quoted in its final comment.
  assert.match(compose, /scripts\/worker\/worker-cli\.mjs/, 'no worker service');
  assert.match(compose, /--root=\/data/, 'the worker must render into the shared volume');
  assert.match(compose, /--provider=fal/, 'a production worker on the fixture renders nothing sellable');

  // One volume, mounted twice: the linkSync constraint. Anchored to the list
  // entry, because caddy's own `caddy_data:/data` mount CONTAINS the bare
  // substring and a loose match counts it -- caught when this assertion first
  // ran against the real file.
  const mounts = compose.match(/^\s*- data:\/data$/gm) ?? [];
  assert.equal(mounts.length, 2, `the data volume must be mounted in web AND worker, found ${mounts.length} mounts`);

  // The crash handlers exit 1 on purpose; this is the other half of that
  // contract.
  const restarts = compose.match(/restart: unless-stopped/g) ?? [];
  assert.equal(restarts.length, 3, 'all three services restart on crash');

  // Secrets arrive through the env file, never inline in a tracked file.
  const envFiles = compose.match(/env_file:/g) ?? [];
  assert.equal(envFiles.length, 2, 'web and worker both read .env');
  assert.ok(!/sk_live|sk_test|FAL_KEY\s*[:=]\s*\S/.test(compose), 'compose.yaml must never carry a credential');
});

test('caddy is the only doorway', () => {
  const compose = read('compose.yaml');
  // Exactly one service publishes host ports, and it is caddy: 80, 443, and
  // 443/udp for HTTP/3.
  const portBlocks = compose.match(/^\s*ports:/gm) ?? [];
  assert.equal(portBlocks.length, 1, `expected one ports: block (caddy), found ${portBlocks.length}`);
  assert.match(compose, /"443:443"/);
  assert.match(compose, /"80:80"/);
  assert.ok(!/["']?3000:3000["']?/.test(compose), 'web:3000 must not be published to the host');

  const caddyfile = read('Caddyfile');
  assert.match(caddyfile, /timestamptapes\.com/, 'the site address is the domain, which is what makes TLS automatic');
  assert.match(caddyfile, /reverse_proxy web:3000/, 'caddy must proxy to the web service by its compose name');
});

test('the deploy files survive a Windows clone', () => {
  // Same trap as the Dockerfile, same fix: core.autocrlf is true here and a
  // fresh clone rewrites LF to CRLF. YAML tolerates CRLF; pinning it anyway
  // costs one line and removes the class.
  const attributes = read('.gitattributes');
  for (const file of ['compose.yaml', 'Caddyfile']) {
    assert.match(attributes, new RegExp(`^${file.replace('.', '\\.')}\\s+text eol=lf`, 'm'),
      `${file} is not pinned to LF in .gitattributes`);
    assert.ok(!bytes(file).includes(0x0d), `${file} carries CRLF bytes in the working copy`);
  }
  // YAML forbids tabs in indentation; an editor default is all it takes.
  assert.ok(!/^\t/m.test(read('compose.yaml')), 'compose.yaml is indented with a tab, which YAML refuses');
});

test('the runbook exists and covers the five consoles and the restore', () => {
  // Every Google sign-in failure this project has had was dashboard-shaped
  // and invisible to the suite (CLAUDE.md section A). Going live repeats that
  // risk across five consoles at once; the runbook is the mitigation, and
  // this test only pins that it keeps naming them.
  const runbook = read('docs/deploy-runbook.md');
  for (const console of ['Supabase', 'Google', 'Stripe', 'TIMESTAMP_PUBLIC_URL', 'DNS']) {
    assert.match(runbook, new RegExp(console), `the runbook no longer covers ${console}`);
  }
  assert.match(runbook, /backup-cli\.mjs --root=\/data --to=/, 'the cron backup line fell out of the runbook');
  assert.match(runbook, /[Rr]estore/, 'a backup nobody can restore is a ritual, not a backup');
});
