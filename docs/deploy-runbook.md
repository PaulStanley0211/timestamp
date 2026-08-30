# Deploy runbook — Hetzner CX23, docker compose, Caddy

The topology is `compose.yaml`: one image, two processes (web + worker) over
one `data` volume, behind Caddy terminating TLS. The host was chosen on
2026-08-29 (CLAUDE.md §34A has the comparison): **Hetzner CX23** — 2 vCPU,
4 GB, 40 GB NVMe, the exact machine shape the image was proven on (full
fixture render in 97 s).

**Why this document exists:** every Google sign-in failure this project has
had was dashboard-shaped and invisible to the test suite (CLAUDE.md §A).
Going live repeats that risk across five consoles at once. Work through this
top to bottom; nothing here is optional.

---

## 1. The server, once

1. Hetzner console → new server: **CX23**, Ubuntu 24.04, Falkenstein, your
   SSH key. Enable **Backups** on the server (the 20%-of-price toggle) — that
   is the whole-disk safety net under the app-level backup in §5.
2. On the box:

   ```bash
   apt-get update && apt-get install -y docker.io docker-compose-v2 git
   git clone -b supabase-identity-slice \
     https://github.com/PaulStanley0211/timestamp /opt/timestamp
   cd /opt/timestamp
   ```

   **THE BRANCH IS NOT OPTIONAL AND A PLAIN `git clone` CANNOT WORK.** Checked
   2026-08-30: `origin/main` is `b6f64a3`, **201 commits behind**, and it has
   **no `Dockerfile`, no `compose.yaml`, no `Caddyfile` and not this file
   either** — every one of them landed on `supabase-identity-slice`. A default
   clone therefore gets a tree where step 4 dies on "no configuration file
   provided", which reads like a broken runbook rather than the wrong branch.
   **When PR #1 is merged, drop the `-b` and delete this paragraph**; until
   then the branch is the deployable ref.

3. Write `/opt/timestamp/.env`. Start from `.env.example`; every key it
   documents, plus the three production lines it explains:

   ```
   TIMESTAMP_PROVIDER=fal
   TIMESTAMP_PUBLIC_URL=https://timestamptapes.com
   TIMESTAMP_TRUST_PROXY=1
   TIMESTAMP_LEGAL_ENTITY={"name":"...","addressLines":["..."],"email":"...","vatId":null}
   ```

   The last one is who is selling, for the three legal pages. It lives here and
   not in `config/legal.json` because the repository is public and a sole
   trader's disclosure address is a home address — this file is gitignored and
   kept out of the image. `.env.example` documents the shape; §4 step 7 is what
   proves it took.

   `chmod 600 .env`. The compose file never carries a secret; this file is
   the only place they live on the box.

4. `docker compose up -d --build` — the image build runs the preflight
   (36 filters + the font) and refuses to produce an image on a bad ffmpeg,
   so a successful build IS the preflight.

## 2. DNS (Cloudflare)

- `A  timestamptapes.com      <server IPv4>` — **DNS only (grey cloud)**.
- `A  www.timestamptapes.com  <server IPv4>` — DNS only.
- Leave the `send.timestamptapes.com` records (Resend mail) untouched.

Grey cloud matters at first boot: Caddy proves domain control over port 80 to
issue its certificates, and the proxy in front complicates that on day one.
The Cloudflare proxy/CDN can be revisited later; it is an optimisation, not a
prerequisite.

## 3. The five consoles

| Console | Change |
|---|---|
| **Supabase** (Auth → URL Configuration) | Site URL → `https://timestamptapes.com`; add `https://timestamptapes.com/**` to Redirect URLs. KEEP the `http://localhost:3000/**` entry — local dev still signs in. |
| **Google** Cloud Console | Verify only, change nothing: the authorized redirect URI is Supabase's callback (`https://<ref>.supabase.co/auth/v1/callback`), and in this architecture Google never sees our URL at all. |
| **Stripe** | New webhook endpoint `https://timestamptapes.com/api/stripe/webhook` (event: `checkout.session.completed`); paste its signing secret into the server `.env` as `STRIPE_WEBHOOK_SECRET`. **This first deploy stays in TEST mode and that is the plan** — smoke step 5 proves the whole path without a penny moving. Going live is a separate exercise on a separate account: see "Going live on Stripe" below. |
| **TIMESTAMP_PUBLIC_URL** | `https://timestamptapes.com` in the server `.env` — it is where Stripe sends the buyer back and what the OAuth state cookie lives on; the bound address is wrong here in ways that only fail at the callback. |
| **DNS** | §2 above. Nothing else: `support@timestamptapes.com` already receives, through Cloudflare Email Routing to the owner's Gmail (2026-08-30, §42A — MX and SPF verified from the authoritative nameserver and from public resolvers, and a real message logged as Forwarded). Catch-all is deliberately OFF, so mail to a mistyped address bounces to its sender rather than vanishing. |

## 4. Smoke, in order, before anyone is told the URL

1. `https://timestamptapes.com/api/health` → `"ok":true`, `disk.low:false`.
2. Sign up with a real address → the six-digit code arrives → account opens.
3. Google sign-in round trip.
4. Order one 480p 4:3 tape (~21 CR, ~$2 of fal) and watch it to the result
   page. This is also the §38E direct-path proof if it has not run yet.
5. Test-mode Stripe purchase end to end; confirm the grant in the ledger.
6. `docker compose logs web worker` — no `FATAL` lines.
7. `https://timestamptapes.com/impressum` → **your details, not the operator
   placeholder.** This is the only check that catches a malformed
   `TIMESTAMP_LEGAL_ENTITY`: the pages degrade to the placeholder rather than
   failing the boot, so a rejected value looks exactly like the unconfigured
   state. If you see the placeholder, `docker compose logs web | grep
   TIMESTAMP_LEGAL_ENTITY` says which field was refused.
8. `https://timestamptapes.com/robots.txt` → `Disallow: /` while you are still
   testing, and every page answering `X-Robots-Tag: noindex, nofollow`. That is
   the default and it is what keeps the Impressum address out of a search index
   during a friends-only launch. **Do not skip this on the assumption that an
   unlinked site is unfindable** — the TLS certificate publishes the hostname
   to Certificate Transparency logs the moment Caddy issues it.

### Going live on Stripe

**Decided 2026-08-30: Timestamp sells from its OWN live Stripe account, not the
one ClearCost uses.** Read off the API that day, the account the test Prices
live in is a sandbox belonging to another product — `business_profile.name` is
literally `ClearCost sandbox`, with `details_submitted: false`,
`charges_enabled: false` and no capabilities. **A sandbox cannot be verified**;
activation happens on a live account, and Checkout prints the ACCOUNT's business
name with no per-Price override, which is why one account cannot serve two
product names.

Consequences, in the order they bite:

1. **The website comes first, which is why this deploy moved ahead of
   activation.** Stripe's activation asks for a business website, and a
   consumer product with no URL invites a manual review. Do §§1-4 above, then
   file.
2. **Activation needs things this repo deliberately does not hold** — legal
   name, home address, date of birth, tax ID, IBAN, an ID document. None of
   that belongs in git; §42D is why. The same legal name and address then go
   into `TIMESTAMP_LEGAL_ENTITY`, and **they must match what Stripe shows on
   checkout**.
3. **The two Price ids in `config/credits.json` are TEST objects and cannot be
   promoted.** A Price is immutable and lives in one mode on one account, so
   going live means creating both rungs again on the new account and pasting
   the new ids. Both entries say `MUST NOT GO LIVE` in their own `source`
   field; that is what it means.
4. **Set the business name and statement descriptor deliberately during
   activation.** The first is what a customer reads on the payment page; the
   second is what they read on their card statement weeks later, and an
   unrecognised descriptor is what a chargeback is made of.

### Going public

One line, one restart, and it is the last step rather than part of the deploy:

```bash
echo 'TIMESTAMP_INDEXABLE=1' >> .env && docker compose up -d
```

Do it when the legal pages are right, the support mailbox receives, and you
have decided whether the published address is your home or a business address —
because indexing is the step that makes those choices hard to reverse.

## 5. Backups

Hetzner's server backups (enabled in §1) are the disk-level net. The
app-level backup copies the three directories that cannot be regenerated —
accounts, owners, refunds — and deliberately nothing else (no photographs
travel; see `scripts/ops/backup.mjs`). Nightly, on the host:

```bash
crontab -e
# 03:10 nightly; keep two weeks
10 3 * * * cd /opt/timestamp && docker compose run --rm -v /var/backups/timestamp:/backups web node scripts/ops/backup-cli.mjs --root=/data --to=/backups --keep=14 >> /var/log/timestamp-backup.log 2>&1
```

`/var/backups/timestamp` is on the host filesystem, outside the volume —
`backup-cli` refuses a destination inside the root it protects. For offsite,
rsync that directory anywhere; it contains no media and no faces.

### Restore

There is deliberately no restore command — a restore that can run against a
live root is a foot-gun. The procedure:

1. `docker compose stop web worker`
2. Copy the chosen `timestamp-backup-<stamp>/{accounts,owners,refunds}` back
   over `out/` inside the volume:

   ```bash
   docker compose run --rm -v /var/backups/timestamp:/backups web \
     sh -c 'cp -a /backups/timestamp-backup-<stamp>/accounts /backups/timestamp-backup-<stamp>/owners /backups/timestamp-backup-<stamp>/refunds /data/out/'
   ```

3. `docker compose start web worker`, then check `/api/health` and one
   account's balance against the backup's `backup.json` date.

## 6. Updating the app

```bash
cd /opt/timestamp && git pull && docker compose up -d --build
```

State lives on the volume; the image is disposable. A failed build leaves the
old containers running.

`git pull` follows whatever branch §1 cloned, so this is correct as it stands —
but if the checkout is ever moved onto `main`, move it deliberately
(`git fetch && git checkout main && git pull`) rather than discovering the
switch during an update. See the branch note in §1.

## 7. Watching it

- Point an uptime monitor (UptimeRobot or similar, free tier) at
  `https://timestamptapes.com/api/health`, alerting when the body stops
  containing `"ok":true`. Low disk flips `ok` on purpose — that page is the
  disk alarm.
- Crashes: the CLIs print one `[web] FATAL …` / `[worker] FATAL …` line and
  exit 1; `restart: unless-stopped` brings them back. A crash LOOP is
  `docker compose ps` showing restarts climbing — read the last FATAL line,
  that is what it is for.
- `docker compose logs --tail=200 -f web worker` is the day-to-day view.
