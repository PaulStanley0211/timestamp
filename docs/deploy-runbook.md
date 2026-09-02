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

   **Then close the front door, before anything else is on the box.** A fresh
   Ubuntu image answers SSH password authentication to the whole internet, and
   the brute-force fleets find a new port 22 within the hour. This box will
   hold every secret this product has and every customer's face; it is the
   single highest-value target there is. Three steps, ten minutes, and **keep
   the session you are typing in open until a second key login has succeeded**
   -- a mistake here locks you out of your own server.

   ```bash
   # 1. key-only SSH. Ubuntu ships an override under sshd_config.d/ that can
   #    re-enable passwords, so the drop-in below takes precedence by name.
   cat > /etc/ssh/sshd_config.d/00-timestamp.conf <<'EOF'
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   PermitRootLogin prohibit-password
   EOF
   sshd -t && systemctl reload ssh
   # in a SECOND terminal: ssh in again with your key. Only then close this one.

   # 2. no account on the box may have a password at all
   passwd -S root            # must say L or NP, never P
   passwd -l root

   # 3. belt and braces: a ban after repeated failures
   apt-get install -y fail2ban && systemctl enable --now fail2ban
   ```

   Then **Hetzner console → Firewalls → create** one and attach it to the
   server: inbound TCP 22 from your own address only (or a VPN range), TCP 80
   and 443 and UDP 443 from anywhere, nothing else. That takes port 22 off the
   internet entirely; the sshd change above is what protects you on the day
   the firewall rule is edited wrongly.

3. Write **three** env files in `/opt/timestamp`, not one. Each container is
   given only the secrets its own process reads, so a compromise of the
   internet-facing web process does not also hand over the render budget.

   **`.env.common`** — what both processes need:

   ```
   TIMESTAMP_PROVIDER=fal
   TIMESTAMP_PUBLIC_URL=https://timestamptapes.com
   TIMESTAMP_TRUST_PROXY=1
   TIMESTAMP_LEGAL_ENTITY={"name":"...","addressLines":["..."],"email":"...","vatId":null}
   ```

   The last one is who is selling, for the three legal pages. It lives here and
   not in `config/legal.json` because the repository is public and a sole
   trader's disclosure address is a home address — these files are gitignored
   and kept out of the image. `.env.example` documents the shape; §4 step 7 is
   what proves it took.

   **`.env.web`** — the three Supabase values and the two Stripe secrets.
   **`.env.worker`** — `FAL_KEY`, and the three `AWS_*` values if and when the
   image classifier is turned on (see §52 first — it changes `/privacy`).

   **WHICH SIDE A KEY BELONGS ON WAS MEASURED, NOT ASSUMED.** A worker started
   with no secrets at all rendered a complete tape, 375 frames, and constructed
   its refund glue: `credits.mjs` carries no Supabase reference and the refund
   path is filesystem work on `out/owners`. On the other side, nothing
   reachable from `server-cli.mjs` reads `FAL_KEY` — there is a test that fails
   if a paid provider ever enters the web's import graph.

   `chmod 600 .env.common .env.web .env.worker`. The compose file never carries
   a secret; these files are the only place they live on the box.

   **MIGRATING AN EXISTING SINGLE `.env`** — the box has one from before this
   split. Do not hand-retype the keys; split it in place and keep a backup
   until the health check passes:

   ```bash
   cd /opt/timestamp && cp .env .env.backup
   grep -E '^TIMESTAMP_' .env > .env.common
   grep -E '^SUPABASE_|^STRIPE_' .env > .env.web
   grep -E '^FAL_KEY|^AWS_' .env > .env.worker
   chmod 600 .env.common .env.web .env.worker .env.backup
   wc -l .env .env.common .env.web .env.worker   # the three must sum to .env's key lines
   ```

   Then `docker compose up -d` and check `/api/health` and one sign-in before
   `shred -u .env .env.backup`. **Compose does not fail on a missing key** — a
   value that ended up in no file is simply absent, and the first symptom is a
   503 on checkout or a worker that cannot spend, so verify before deleting.

4. `docker compose up -d --build` — the image build runs the preflight
   (36 filters + the font) and refuses to produce an image on a bad ffmpeg,
   so a successful build IS the preflight.

## 2. DNS (Cloudflare)

- `A  timestamptapes.com      <server IPv4>` — **DNS only (grey cloud)**.
- `A  www.timestamptapes.com  <server IPv4>` — DNS only.
- Leave the `send.timestamptapes.com` records (Resend mail) untouched.
- **Mail from this domain must be rejectable when it is forged.** Every
  customer of this service has a face on file, and "your tape is ready, sign
  in here" from `support@timestamptapes.com` is the phishing lure the brand
  hands an attacker. With DMARC at `p=none` and the apex SPF ending `~all`,
  a forged message is delivered (at worst to spam); nothing rejects it.
  - `TXT  _dmarc.timestamptapes.com` →
    `v=DMARC1; p=quarantine; sp=quarantine; adkim=r; aspf=r; rua=mailto:support@timestamptapes.com`
  - `TXT  timestamptapes.com` (the apex SPF) → change the trailing `~all` to
    `-all`. Outbound mail is From the `send.` subdomain, which has its own
    SPF and DKIM and aligns under relaxed mode, so legitimate mail passes.
  - Read the aggregate reports that arrive at `support@` for a week. If they
    show only Resend passing, move `p=quarantine` to **`p=reject`**. Checked
    2026-09-03: the record was `p=none`.

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

**THE DESTINATION MUST BE OWNED BY uid 1000 AND THIS LINE USED TO OMIT IT.**
The image runs as `USER node` (uid 1000), so a `/var/backups/timestamp` created
by root is unwritable and the backup dies on `EACCES: permission denied, mkdir`
— measured on the box 2026-09-01, running the line exactly as it was published
here. **It is §34B's fresh-volume bug in a second place**, and it would have
failed silently at 03:10 every night into a log nobody reads. `install -d` is
therefore part of the cron line itself rather than a one-time setup step, so the
job is self-healing if the directory is ever lost.

```bash
crontab -e
# 03:10 nightly; keep two weeks
10 3 * * * install -d -m 700 -o 1000 -g 1000 /var/backups/timestamp && cd /opt/timestamp && docker compose run --rm -v /var/backups/timestamp:/backups web node scripts/ops/backup-cli.mjs --root=/data --to=/backups --keep=14 >> /var/log/timestamp-backup.log 2>&1
```

**RUN IT ONCE BY HAND BEFORE TRUSTING THE SCHEDULE** — everything after
`crontab -e` in the line above is invisible until 03:10, and a backup that has
never been observed working is not a backup:

```bash
install -d -m 700 -o 1000 -g 1000 /var/backups/timestamp
cd /opt/timestamp && docker compose run --rm -v /var/backups/timestamp:/backups \
  web node scripts/ops/backup-cli.mjs --root=/data --to=/backups --keep=14
find /var/backups/timestamp -type f          # accounts/, _index/, _free-tapes.json, backup.json
```

`/var/backups/timestamp` is on the host filesystem, outside the volume —
`backup-cli` refuses a destination inside the root it protects. For offsite,
rsync that directory anywhere; it contains no media and no faces.

**`-m 700` ON THE DESTINATION AND OWNER-ONLY MODES ON EVERYTHING INSIDE IT.**
The backup holds every account's email, ledger and record on the host, where
`0755`/`0644` -- the umask defaults -- is every local user on the box.
`backup-cli` writes each directory `0700` and each file `0600` itself (a test
pins it on Linux); the `-m 700` is for the parent it cannot see.

**`--keep=14` IS A NUMBER THE PRIVACY PAGE STATES.** `/privacy` tells a person
that a deleted account can survive in a backup for up to 14 days. Change the
keep count here and that sentence in `scripts/web/views.mjs` in the same
commit, or the page promises something the cron does not do.

**IT DOES NOT COVER THE THREE `.env` FILES**, deliberately (§7 splits them and
they hold every live credential). Only Hetzner's disk-level backup in §1 would
carry those, which is most of the argument for paying for it.

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
