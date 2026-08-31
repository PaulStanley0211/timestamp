# Timestamp

One photo, one place, one outfit — fifteen seconds that look like a camcorder tape from 2003.
Warm, grainy, quiet.

**Engine:** `C:\Users\pauls\Timestamp` · **Stack:** Node 22+, ESM, `node --test`, npm · **Conventions:** mirrored from `C:\Users\pauls\Ad-Regenerator`

---

## START HERE (2026-08-31) — IT IS DEPLOYED AND STRIPE IS ACTIVATED. READ §46, THEN §45, §44, §43, §42, §41, §40, §39, §38, §37. (§47 is CI only — read it if CI is red.)

# THE PRODUCT IS LIVE AT https://timestamptapes.com AND IT CAN TAKE MONEY.

**Both of the things this file called blockers for a fortnight are closed.**
A Hetzner box runs the app behind Caddy with a real certificate; Timestamp's
OWN Stripe account is verified — `charges_enabled: true`,
`payouts_enabled: true` — with both live Prices created and the webhook
verifying signatures. **§46 is the record and it supersedes every "nobody can
pay" and "no host chosen" line below.**

**WHAT HAS NOT HAPPENED: NO CARD HAS EVER BEEN CHARGED, AND NO WEB ORDER HAS
EVER REACHED REAL FAL.** `worker.lastSeen` is `null` — the worker has never
rendered a job on that box. Every piece is verified individually and the chain
has never been run end to end with money in it. **Those two runs are the top of
the list and they are the owner's, because they spend.** §46C.

**THE SERVER COSTS €23.79/mo, NOT €5.** §34A's price table is stale by 5x: the
CX line it quotes is "temporarily not available" everywhere, so the box is a
**CPX22**. Backups are deliberately OFF until real money moves. §46A.

**THE SITE IS `noindex` ON PURPOSE** and lifting it is a deliberate step, not
a tidy-up — the Impressum publishes a home address. §46F, §42E.

**1964 tests / 1962 pass / 0 fail / 2 skipped** (§46; on a machine with no
Chromium-family browser the seven browser tests self-skip too). The two
standing skips are the `*-smoke.test.js` money guards, which self-skip without
`TIMESTAMP_LIVE=1`. **PR #1's CI is GREEN on all five checks at `d6ec4b6`** —
guards plus node 22/24 x ubuntu/windows, 1964/1962/0/2 on every leg.

**IT WAS RED IN BETWEEN, AND NOT BECAUSE OF ANYTHING IN THE TREE.** Both Windows
legs failed at `6bf5b1a` — a commit that changed only this file — when
`community.chocolatey.org` answered 504 and `choco install` reported
`installed 0/0 packages` **while exiting 0**, so the install step went green and
the job died at the next one saying `'ffmpeg' is not recognized`. **§47** is the
fix and the reasoning: probe for the binary, retry, and fall back to the same
gyan.dev build chocolatey itself ships. **Read §47F before reading any future
matrix failure as a code defect — two legs failing at the same second is an
upstream outage, and the clock says so faster than the diff does.**

**§37G'S SEVEN OWNER ITEMS ARE NOW TWO, AND BOTH ARE PAID RUNS.** The support
mailbox and the password-reset template closed on 2026-08-30 (§42A); the
selling entity, the deploy host, the deploy itself and Stripe verification all
closed on 2026-08-30/31 (§46). **What is left of that list is the blind check —
folded into the friends test by §41 — plus the two runs in §46C.**

**THE SELLING ENTITY IS FILLED IN AND IT LIVES ONLY IN `.env` ON THE BOX**, per
§42D — a sole trader's § 5 DDG address is a home address and this repository is
public. The street is **Keplerstraße**; this file and the live site both carried
"Kaplerstraße" for an hour because it was guessed and then confirmed by a
leading question. §46F.

~~**THE ONE THING WITH A CLOCK ON IT IS STRIPE BUSINESS VERIFICATION.**~~
**FILED AND APPROVED 2026-08-31 — §46B.** The account charges and pays out.

**AND THE PRODUCT IS NOT ABOUT GERMANY.** The owner restated this on
2026-08-29; the eight place labels are plain now (§42F). ~~The bigger half is
still undone~~ — **THE BIGGER HALF LANDED 2026-08-30, §43.** Step 3 leads with
the own-place upload and free text, `pl-own` is checked on load, and the eight
presets follow as examples. **What is left of it is one design call and it is
the owner's: the place upload is still a bare native `Choose File` control**
sitting across from step 1's designed dropzone — §43D says why doing it
properly is a script change and not a restyle.

**PR #1 IS OPEN AND ITS FIRST CI RUN WAS GREEN.** Paul opened it at 12:23 UTC
on 2026-08-29 and all five checks passed — guards plus node 22/24 x
ubuntu/windows, the full 1754-test suite of that moment on every leg. Every
line below saying "no PR is open" or "CI has never run on this branch" is
history as of that click; it is kept because the sections it lives in are
records. §37 landed six fix commits SINCE that run; the branch is pushed, so
the PR re-runs CI on them.

**THE REVIEW'S VERDICT: NOT READY FOR CUSTOMERS — roughly 55% of the launch
work is done.** Seven parallel auditors and an adversarial critic, §37A. The
engine is the strong half. The envelope — legal pages, support channel, image
moderation, live Stripe, deploy, ops — is the missing half, and most of it is
Paul's decisions rather than code. The full report is a private artifact
delivered to Paul in-session; its verdict and every repo-relevant correction
are in §37, and nothing from the gitignored security reviews is restated in
either place.

**WHAT JUST HAPPENED IS SECTION 36, AND IT IS PUSHED.** The first `/qa` and a
fresh `/review`: twelve findings, eleven fixed across **eleven commits,
`39e08d1..278bd12`**, every one test-first and sabotage-verified.
`origin/supabase-identity-slice` is current. **`origin/main` is still `b6f64a3`
and there is still NO PR** — that is the only thing left between this branch
and its first CI run, and it is Paul's line to cross.

**THE THEME IS ONE SENTENCE: §34D THREADED THE SHAPE THROUGH THE CODE AND NOT
THROUGH THE PROSE.** Four user-facing sentences still described a 4:3-only
product, and one of them put two prices for one tape on one screen — the tier
card said ~46 CR while the estimate below it said ~61 CR, and the ledger takes
the second. Measured: an account went 153 → 125 on a 16:9 order while the card
beside the button said 21. **The free rung told people it buys one 480p tape;
in the phone shape it buys none.** §36A.

**AND SIGN OUT WAS OFF THE SCREEN AT 375px FOR ANY EMAIL OVER ~30 CHARACTERS,
INCLUDING PAUL'S OWN.** §36B.

**WHAT JUST BEFORE THAT WAS SECTION 35.** A full gstack `/cso` audit, five
parallel auditors, then eighteen findings closed across **seventeen commits,
`4d08ff6..42b3745`**, every one test-first and sabotage-verified. **Read §35
before working anything**, because it corrects this file in three places — and
§36E corrects it in three more, including this banner's own claim about what
`origin` holds.

**TWO OF THEM WERE CRITICAL AND BOTH WERE ON THE SHIPPED PAID PATH.** Every
16:9 and 9:16 tape was cropped to 4:3 and stretched — a 9:16 tape discarded 58%
of the frame and came out a circle two and a half times taller than wide. And a
direct render PAID FAL, DOWNLOADED THE MP4, AND THEN THREW, so no tape shipped
and a resume could not adopt the download. **The documented paid command in
this file would have failed that way.** Neither was visible to 1712 passing
tests. §35A.

**~~EVERYTHING IS COMMITTED LOCALLY AND NOTHING IS PUSHED~~ — THAT WAS NEVER
TRUE, AND AS OF §36 IT IS NOT EVEN STALE, IT IS BACKWARDS.**
`origin/supabase-identity-slice` is **CURRENT** — it was 45 commits behind and
was pushed at the end of §36. `origin/ui-redesign-signed-in-page` is still at
`5c3267e`. **`origin/main` is still `b6f64a3` and nothing is merged.** Verified
with `git ls-remote`. §35D, §36E.

**THE ONE DECISION BLOCKING THE MOST WORK: PAUL HAS NOT PICKED A DEPLOY HOST.**
The Dockerfile is built, tested and proven; the topology file after it is
shaped by the answer, so nothing further is worth building until he chooses.
The options with real prices measured on 2026-08-29 are in §34A. **It is a
thirty-second decision.**

**AND THE FREE TEN MINUTES THAT GATES EVERYTHING IS STILL THE BLIND CHECK.**
Packet built and unsent at `out/blind-check/`. It has been the top item for
three sessions. Yesterday's work and today's both rest on it.

**WHAT IS LEFT IS SECTION 32**, still, with §35F as the current read on it.
**Re-verify any item before working it: four items across three sessions turned
out to be already done, one turned out to be a live defect rather than the
decision the list called it, and one was understated by two orders of
magnitude.**

### The three sentences that matter

**THE PAGES FOLLOWED THE IDENTITY ONTO `--paper` (2026-08-28).** Every page is
cream except the LANDING, which keeps Struck on purpose. This supersedes the
freeze below and closes the DESIGN.md documentation debt section 30 recorded.
Section 31 is what shipped and why.

**~~NOBODY CAN RECEIVE A SIX-DIGIT CODE~~ ANYBODY CAN, AS OF 2026-08-28
EVENING.** `timestamptapes.com` was bought at Cloudflare Registrar, verified in
Resend as `send.timestamptapes.com` (DKIM, MX and SPF all green), and the
Supabase SMTP sender was moved off Resend's shared sandbox address onto it.
**Proved by a real signup to an address that is NOT the owner's: the six-digit
code arrived.** Section B below is now a HISTORICAL record of why it was
blocked, not a live blocker. **This was the top of the list for two days and it
is closed.**

**GOOGLE SIGN-IN IS FIXED AND PROVED — a real person signed in through it.** It
took three separate causes, none of them in the OAuth code, and the day before
had been spent blaming a 503 that Supabase never sent. Section A below.

### The freeze, and why it was lifted

On the evening of 2026-08-27 Paul looked at the running app and said *"It looks
very good ... just keep it as it is."* **That freeze is spent.** On 2026-08-28
he directed the move onto the cream ground himself, in detail, naming
DESIGN.md's palette and the locked reference. The pages that were frozen were
the DARK ones; what is frozen now is nothing, and section 31 is the record.

**The sign-in page is still deliberately NOT Claude's to design** -- Paul is
bringing a Dribbble reference himself. It moved onto the cream ground with the
rest, which is a palette change and not a design; its layout is untouched.

### A — Google sign-in, three causes, all closed

Each was invisible to the suite and to the server log, and each hid the next.

1. **`form-action` listed one hop of a two-hop redirect** (`99a68e4`). Chrome
   checks that directive against EVERY target in a form submission's chain.
   `POST /auth/google` goes here, 303s to Supabase, and Supabase 302s to
   Google's consent screen -- so with `accounts.google.com` absent the whole
   navigation was cancelled before a byte left the browser. No network entry,
   no log line, a button that appeared dead.
   **WHY IT COST A DAY: node enforces no CSP.** Every probe was run from node,
   saw a healthy `302 -> accounts.google.com`, and the blame went to Supabase.
   Re-measured from a real browser: hop 1 is 303, hop 2 is 302, and Chrome
   names `form-action` in the console. **Supabase never sent a 503.**
2. **The Supabase callback URI was not registered on the Google OAuth client** —
   Google answered `redirect_uri_mismatch`. Paul added
   `https://wtwldjflvmpwoxblqect.supabase.co/auth/v1/callback` to the client
   (`108140308419-...`) in Google Cloud Console. Dashboard state, not code.
3. **Supabase's Redirect URLs allowed `127.0.0.1` and the app sends
   `localhost`.** Supabase matches those as text, not by resolving them, so it
   silently fell back to the Site URL -- the landing page -- and OUR CALLBACK
   NEVER RAN, which is why nothing was ever logged. Proved before touching
   anything: every attempt had left an unconsumed verifier row in `out/oauth/`,
   and a callback that runs deletes it. Paul added `http://localhost:3000/**`.

**All three are dashboard-or-CSP shaped. None is testable from `node --test`.**

### B — Email: the exact reason nobody can sign up

Measured today against the live project, not reasoned about:

- `paulstanleyganganapalli@gmail.com` → **200**. Every other address → **500,
  `unexpected_failure`, "Error sending confirmation email"**. Resend's free
  sandbox delivers only to the address that owns the Resend account.
- **Plus-addressing does not dodge it**: `...+ts1@gmail.com` also 500s. The
  sandbox matches the exact address.
- **And the one address that DOES receive mail already has a confirmed Supabase
  user**, so signup returns Supabase's masked "already exists" 200 and sends
  nothing at all.

**Therefore no address exists that can both receive mail and sign up, and the
six-digit flow cannot be exercised end to end by anybody today.**

**DO NOT DELETE THAT SUPABASE USER TO FREE THE ADDRESS.** Local account
`45dbeb2e` holds its `supabaseUserId`; a fresh signup gets a new id and
`claimAccount` refuses the rebind. That is the same failure shape as `4f53dc6`
and it would break the Google sign-in that now works.

**The fix is a verified sending domain in Resend** — which is also
`TIMESTAMP_PUBLIC_URL`, the blind check, and deployment. One purchase clears
four blockers. A Gmail App Password or a Brevo account would unblock local
testing sooner and gets thrown away later; Paul was shown both and has not
chosen.

`plstnly06@gmail.com` **was removed today at Paul's request** — it was a stale
LOCAL record only; Supabase never held a user for it, because every
confirmation mail failed and the signup rolled back each time.

### C — What was built today, beyond the fixes

- **The app stops claiming it sent a code it knows it did not** (`c4713d9`).
  Both doors: signup, and the resend button a person presses BECAUSE no code
  arrived. `/verify` now says so instead of "It lasts an hour". The signal is
  service-wide and never per-address, and there is a test proving the signup
  response is unchanged either way.
- **`/onboarding` stopped answering an already-agreed account with a page whose
  only content was a link away from it** (`30b4f1e`). Sign in now lands on `/`.
- **Timestamp has a mark, and the tab is no longer blank** (`bcb009c`,
  `5716cab`). Cormorant Garamond Italic 600, outlined -- the font does not
  ship. One head-switch tear. The icon is `Ts`, capital and lowercase locked
  into one path, in an oxide rounded square. `DESIGN.md` carries the palette
  with every contrast ratio measured and the reasoning. `assets/brand/README.md`
  is how to regenerate any of it.
- **Two test bugs that were nobody's feature** (`a51ed39`, `d9ad2ef`): two files
  sharing `build/test` across concurrent runs, and the purge CLI tests freezing
  a clock the spawned CLI cannot read -- the second had a six-day fuse and went
  off this morning.

### D — Three things that will bite the next reader

- **A cache header can hide a correct file.** `maxAge` on the brand assets was
  set to a year; a year is only right for a content-hashed url and these are
  fixed names, so a replaced icon never arrived and no request was ever made to
  show it. Now a day (`aeb4a3a`). Anyone who loaded the page during that hour
  keeps the old icon until the year elapses. **This is the shape of the whole
  day: correct bytes, invisible failure.**
- **Backticks inside a template literal.** `views.mjs` and `static.mjs` build
  HTML and CSS as template literals; a comment containing a backtick ends the
  string. It happened twice and the second one only surfaced as a server that
  would not boot.
- **`style-src 'self'` drops an inline `<style>` wherever it appears**,
  including inside an inlined SVG. A generated mark that styles itself renders
  in every markup test and loses its animation in every real browser, silently.

### E — Where this leaves the branch

Branch `supabase-identity-slice`, **still not pushed**; `origin/main` is still
`b6f64a3`, nothing merged. Opening a PR is Paul's call, not a prerequisite.

**Seventeen commits today, `a51ed39..90093b1`** — the morning on Google sign-in,
email and the mark, the evening on the pages and three defects they surfaced
(section 30). This paragraph said "eight" and appeared twice; the duplicate is
gone with the stale number.

**NO CI HAS RUN ON THIS BRANCH AND NONE WILL.** Both workflows trigger on
`push: branches: [main]` and `pull_request` only, so a feature-branch push
runs nothing. **The first CI run happens the moment a PR opens** — and Linux
will be red on the two pre-existing tests in section 4 (one asserts how a
particular ffprobe build spells `EXIF metadata` in side data, the other
asserts ffmpeg's error wording). Neither is a product defect and neither
comes from the security work; they are worth fixing BEFORE opening a PR
rather than explaining afterwards.

**ALL SEVEN ITEMS OF THE REVIEW'S FIX ORDER ARE CLOSED (2026-08-25/26),**
one commit each, strict test-first, on this branch — see section 28. What
remains open is in the review on this machine and nowhere else. **THE
`config/models.json` WARNING STILL STANDS**: one finding that arms on that
edit was NOT in the fix order and is still open — whoever fills in the still
model reads the review's section 3 first.

**This block is a HANDOFF, not a diary.** Everything struck through has moved
into a numbered section. **SECTION 27 IS CLOSED** — the test-mode card payment
was finished at midday with no second payment: the redeliverable event landed
the grant, and resending that same event a second time proved the idempotency
guard against genuine Stripe redelivery, not a synthetic fixture. **What is
next is Paul's — items 1-3 below.** Section 26 is the measured price list; 25
is the checkout; 27 is the closed payment demo.

### The one thing to know

**A model can put Paul in a place recognisably, from one photograph, and hold it
through fifteen seconds of video with no intermediate image at all.** That was
the only question that decided whether this is a product. It is answered — by
`seedream/v4.5/edit` on the still and `seedance-2.0/reference-to-video` on the
tape. **What is NOT answered is whether it holds for anyone who is not Paul.**

**AND IT HOLDS AT 720p, ON PAUL'S OWN VERDICT (2026-08-25).** His words on the
first 720p tape: *"it looks great ... especially the face ... it looks like it
was real ... it doesn't look like AI."* That is the half of the blind check only
he can give, on the tier the product will actually sell. The stranger half is
still owed — item 2 below.

### What the product IS

**Four choices and a tape: photo, outfit, place, frame shape.** No still, no
gate, nothing to approve — section 18. **Fifteen seconds is a SHOT LIST**, six
beats — section 19. **The bed knows where it is** — section 20.

```bash
node --env-file-if-exists=.env scripts/render/render.mjs --photo=assets/test-photos/face.jpg --place=ostsee-strand --outfit=hemd-jeans --consent --provider=fal --direct --video-model=bytedance/seedance-2.0/reference-to-video
```

`--dry-run` prices it for free. `--stop-after=compose` runs every free step and
stops before the money. `--resolution=480p|720p` orders a tier — new today,
section 24.

---

### PICK UP HERE

> **READ SECTION 46 FIRST (2026-08-31). THE APP IS DEPLOYED AND STRIPE IS
> ACTIVATED — https://timestamptapes.com takes payments. §46 is the server, the
> account, the live Prices, and the two things that are still unproven because
> they cost money. It supersedes every "nobody can pay", "no host chosen" and
> "deploy at the end" line in this file, and it corrects §34A's server price by
> a factor of five.**
>
> **THE FIRST THING WORTH DOING NEEDS NOBODY BUT THE OWNER AND SPENDS ABOUT
> $16 IN TOTAL:** buy a Starter pack and refund it (~$14.28), and put one 480p
> order through the site (~$2). Every part of both paths is verified in
> isolation; neither has ever been run with real money in it. §46C.
>
> **THEN SECTION 45 (2026-08-30). The deploy came BEFORE Stripe
> activation, Timestamp gets its own live Stripe account, and buying credits
> asks the customer for them. §45B is a correction to the deploy runbook you
> are about to follow; §45D says why a price on a browser-smoke screenshot is
> not the price this product charges.**
>
> **THEN SECTION 44 (2026-08-30). The judder is fixed — §32 item 13,
> open since 2026-08-25, decided by Paul and shipped. Read §44B before touching
> the expression: two things there were corrected BY MEASUREMENT after being
> reasoned wrong, one of which broke the 375-frame delivery contract.**
>
> **THEN SECTION 43 (2026-08-30). It closes §42H item 1 — the place step
> leads with your own place now, and the presets are examples. It leaves ONE
> thing undone on purpose and that thing is the owner's: the place upload is
> still a bare native `Choose File` control, and §43D says why making it match
> step 1's dropzone is a script change rather than a restyle.**
>
> **THEN SECTION 42 (2026-08-30, earlier). It closes two of §37G's seven owner
> items, de-nationalises the place menu, and corrects this file's own claim
> that Resend's DNS records were missing — they never were; they sit at
> `send.send.timestamptapes.com`, a double `send`, and were queried under the
> wrong name. §42H is the current what-is-left.**
>
> **THEN SECTION 41 (2026-08-29, third tranche), THEN 40, 39, 38, 37.**
> §41 records THREE DECISIONS PAUL TOOK — the deploy host is HETZNER (box
> not yet created, on purpose), TESTING IS PARKED TO THE END behind his
> friends-test plan (the blind-check texts fold into it), and Vercel is
> ruled out — plus the ops minimum, the compose/Caddy topology, the deploy
> runbook, and the legal pages gated on `config/legal.json`'s `entity`.
> **Nothing agent-buildable is left ungated.** §40 is the queue double-claim
> race, FIXED. §39 is deletion/export, LANDED.
>
> **READ SECTION 38 NEXT (2026-08-29, second tranche), THEN 37, THEN 36.**
> §38 closed two more of §37G's agent items — the Art. 50 disclosure (file
> metadata + result-page line) and real-browser smoke tests — and records that
> **account deletion/export LANDED the same day (§39, built in the §38A
> session's worktree)** — the item is DONE. §38E is the paste-ready
> paid-order runbook.
>
> **READ SECTION 37 NEXT (2026-08-29, later that night), THEN 36, THEN 35.**
> §37 is the launch-readiness review and the first tranche of its fix list —
> seven commits, all test-first — plus four corrections to this file's own
> record, one of them being that **the PR this block kept asking for is OPEN
> and its first CI run was GREEN.** That item is done and it was Paul's click.
>
> **PAUL'S LIST IS NOW SEVEN ITEMS AND NONE IS CODE** (§37G): send the blind
> check; decide the selling entity (one decision that gates the Impressum,
> the GDPR controller, Stripe verification and VAT at once); file Stripe
> business verification; pick the deploy host; provision a support mailbox
> (the domain has NO MX record — mail to it bounces today) and choose an
> image-moderation vendor; check the Supabase Recovery email template (two
> minutes — it may still mail a magic link into a six-digit-code field); and
> paste one paid web order (~$2) to prove the newly wired direct web path
> against real fal, because no web order has ever reached the paid provider.
>
> **ONE — THE BLIND CHECK (item 5).** Free, ten minutes, packet built and
> unsent at `out/blind-check/`. Still the only thing on the critical path that
> needs nobody but Paul, and it still decides whether any of the rest matters:
> he has proved the tape looks good TO PAUL, and nothing has yet proved a
> stranger recognises him. It now gates more work than it did a day ago.
>
> **TWO — PICK A DEPLOY HOST (item 3).** The Dockerfile is built, proven by
> building and running it, and names no host on purpose. The next artefact —
> compose file or fly.toml plus a supervisor — is shaped entirely by the
> answer, so **the whole rest of the deploy is blocked on one choice.** Real
> prices, measured 2026-08-29, are in §34A: Hetzner CX23 ~€5/mo is cheapest by
> four times; Fly is dearest AND needs both processes in one Machine, because
> its volumes are strictly single-attach.
>
> **CLAUDE'S HALF OF ITEMS 3, 9 AND 11 IS DONE**, twelve commits, test-first,
> every assertion sabotage-verified. **Nothing is pushed.** What is left that
> needs nobody: the deploy runbook (once a host exists), the three tape-quality
> items in §34G, and the last three security items — all of which are Paul's
> decisions or LOW.
>
> **BEFORE WORKING ANY ITEM ON §32, RE-VERIFY IT.** Across the last two
> sessions THREE items were already done and ONE — item 11 — was not the
> decision the list called it but a live defect that would have failed every
> wide render the day a real provider was configured. A stale list costs an
> afternoon; checking costs a minute.

~~**PICK UP AT SECTION 27: ONE COMMAND FINISHES THE PAYMENT DEMO.**~~ **DONE
2026-08-25** — the payment path is proven end to end: checkout, webhook
signature, grant, and idempotent replay against a genuine Stripe redelivery.
**Read §27's banner before re-running it**: a test-mode event grants nothing
now, on purpose.

~~**THEN: THE SECURITY REVIEW'S FIX ORDER.**~~ **DONE 2026-08-25/26 — §28.**
All seven items, one commit each, test-first, pushed. **Nothing in the fix
order is left.**

**SO WHAT IS ACTUALLY NEXT (rewritten 2026-08-27), in the order it is worth
doing:**

0. **BUY A DOMAIN. It is the only thing blocking four separate items** and it
   is the whole reason nobody but Paul can sign up. It unblocks: mail to any
   address (verify it in Resend), `TIMESTAMP_PUBLIC_URL`, deployment, and the
   blind check packet. Everything else on this list is smaller. **Nothing in
   the codebase is waiting on code for this.**
   *If the domain is weeks away*: a Gmail App Password or a Brevo account makes
   the six-digit flow testable within ten minutes and is thrown away later.
   Paul has seen both routes and has not picked one.
1. ~~**The UI direction that unblocks rewriting DESIGN.md.**~~ **CLOSED
   2026-08-28 — section 31.** The pages are on `--paper` and DESIGN.md is
   reconciled with them rather than trailing them. The full-bleed place loop
   survives on the LANDING only, which is the one page whose whole mechanic is
   that photograph. **The cathode orange still cannot come to a light ground**
   (2.21:1) and did not: it keeps the burnt-in date stamp inside the tape and
   has left the chrome, with a test that fails if it comes back.
   **The blind check is still Paul's and still not done** — packet unsent at
   `out/blind-check/`.
2. **The two Linux CI failures (§4), BEFORE a PR is opened** — they are
   assertions about one ffmpeg/ffprobe build's wording, not product defects,
   and they will be the first thing anybody sees on the PR. ~~Plus the flaky
   tests, which are a third source of red on that same first run.~~ **THE
   FLAKES ARE DONE 2026-08-26 — all three, §4.** What is left on that first CI
   run is these two.
3. **The rest of the review**, which is local only: what the fix order did not
   cover is still open, and **one of it arms on the next `config/models.json`
   edit**. Read the review's §3 before that edit, not after.
4. ~~**The Supabase plan**, then code.~~ **DONE 2026-08-26 — the identity
   slice is BUILT AND WIRED.** All 14 tasks in
   `docs/superpowers/plans/2026-08-26-supabase-identity-slice.md` are
   complete: Google sign-in, the six-digit email confirmation code, and
   password reset all exist, are wired into `server.mjs`, and are tested.
   **Two things are still outstanding, and both are the owner's, not
   code's:** the Supabase dashboard's Confirm-signup email template still
   needs `{{ .Token }}` put into its body (spec §9 step 6 — without it
   Supabase mails a magic link to a person this app is asking for a code,
   and nothing here can detect that the template is wrong), and **no real
   Google round trip has ever been run** — the spec's own words are "the
   only evidence that settles the OAuth round trip is one real round trip,"
   and that cannot happen from this machine.

   **THE TEMPLATE EDIT IS BLOCKED, AND THAT IS NEW — 2026-08-26.** The
   dashboard was opened and the editor is LOCKED on this project: "Set up
   custom SMTP to edit templates", the Source toggle inert, the body
   read-only. **The live template today is Supabase's default magic link**
   — "Follow the link below to confirm this email address" over a `Confirm
   email address` link — which is precisely the thing the six-digit page
   cannot survive. Three ways out and no others: **custom SMTP** (free
   plan, spec step 9, and needed anyway for the 2-emails-per-hour ceiling),
   **upgrade to Pro**, or **a Send Email hook**. So spec step 9 is a hard
   prerequisite of step 6, not the later scaling concern it was written as.
   **The body and subject to paste, once the editor unlocks, are ready in
   `docs/supabase-email-templates/`.** Which of the three routes to take is
   Paul's call: two cost money and one costs a provider account.

   ~~**A THIRD THING, and it is the one most likely to strand a real person.**
   `POST /verify/resend` does not resend.~~ **CLOSED 2026-08-26 — §29.** It
   resends now, through Supabase's documented `POST /auth/v1/resend`, which
   needs no password. **The assumption was removed rather than tested**: the
   app no longer depends on whether a repeated signup re-sends to an
   unconfirmed address, so that behaviour never has to be observed. The four
   upstream outcomes are indistinguishable on the page, the five-guess counter
   is still untouched by a resend, and the hint that promised a password
   prompt is gone with the route that needed it.

**What is left is Paul's, and only Paul's.** ~~Record fal's actual cost for the
720p run (item 1's remaining number)~~ — **THAT NUMBER WAS ALREADY RECORDED and
this line was stale; checked 2026-08-26.** Job `20260824-225641-f34b4f` carries
`cost.actual = $4.577258` on its video step, and the estimator now quotes
**$4.5646** for the same order — 0.3% apart, so config and invoice agree and
§26's price list stands. (`npm run ledger` still prints `+120.2% OVER` on that
job: that is measured against the estimate FROZEN INTO THE MANIFEST at render
time, $2.079, which is the pre-fix number the run itself existed to correct.
It is a historical artefact, not a live pricing gap.) What genuinely remains is
**the blind check (item 2)** and **the UI direction so DESIGN.md can be
rewritten (item 3)**. Neither is blocked on code.

**The Stripe checkout and webhook are BUILT — section 25.** `POST
/api/billing/checkout` creates a hosted Checkout Session and 303s to Stripe;
`POST /api/stripe/webhook` verifies an HMAC over the raw body and is the only
thing in this application that grants credits. 59 tests, no npm dependency, no
card field anywhere.

**What is left is not code. It is a Stripe Price, and a Price is immutable**, so
§7 of `docs/superpowers/specs/2026-08-24-credit-packs-pricing-design.md` gates
creating one on three things and two of them are Paul's (items 1 and 2 below).
`config/credits.json` carries `stripePriceId: null`; the button renders disabled
and the route answers 503 until it is filled in. **Nothing can be bought today
and that is the designed state, not a gap.**

**PAUL'S, and nobody else can do them:**

1. ~~**METER THE PARKED 720p JOB.**~~ **DONE 2026-08-25 — section 26. THE TIER
   IS REAL.** 960x720 ordered came back **1112x834**, which is 2.20x the pixels
   of the 752x560 both 480p jobs returned. They are not the same product and
   they can be priced separately and honestly. **What is still owed is one
   number:** read fal's usage page for what that run actually cost and record it
   — `npm run ledger -- record 20260824-225641-f34b4f --actual=<usd>`. The
   formula predicts **$4.5646**; confirming it at a second tier is what makes
   the whole price list measured rather than half-measured.
2. **THE BLIND CHECK, still not done.** The packet is built and unsent at
   `out/blind-check/` — five images in `send/`, plus `BRIEF.md` with the exact
   wording, the protocol and the decode key. Two people, separate chats,
   "Who is this?" and nothing else. **Not the friend he primed.** Claude will
   not send these: it is a deception of third parties about Paul's own face.
3. ~~**THE UI IS GOING TO CHANGE AND DESIGN.md DOES NOT KNOW YET.**~~ **CLOSED
   2026-08-27 — section 30.** "Engaging" turned out to mean the place itself:
   full-bleed, moving, with the interface floating on glass over it. Paul saw it
   running and froze it. **DESIGN.md still describes STRUCK and has not been
   rewritten** — that is now a documentation debt rather than an open design
   question, and the pages are the authority until somebody reconciles them.
   **The one page still to do is the SIGN-IN page, and it is Paul's:** *"We will
   use an inspiration for that by going into Dribbble or something like that."*
   Wait for the reference. Do not extend the landing's treatment onto it on the
   assumption that consistency is wanted.
4. **Seedance 2.5 exists and is DELIBERATELY NOT PURSUED.** Paul is building a
   skill for it and will bring it himself. Do not wire it, do not price it, do
   not raise it.

**CLAUDE'S, ready to go:**

5. ~~**Build the checkout redirect and the webhook.**~~ **DONE 2026-08-25,
   section 25.** What is left of it is Paul's: create the Price in Stripe once
   the gates are clear, paste the id into `config/credits.json`, and put
   `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env` (see
   `.env.example`). **Verify with `stripe listen` before anything is live** —
   the Stripe CLI is already on this machine and delivers genuinely-signed
   events to localhost, so the whole path can be proven with no public url.
6. ~~**The estimator cannot tell 480p from 720p.**~~ **DONE 2026-08-25 —
   section 26.** `--dry-run` now quotes **$2.0727 at 480p and $4.5646 at 720p**,
   both the measured invoice to four decimals. It was TWO defects, not one: the
   pricing table had no raster dimension, and `render.mjs` never handed the
   `--resolution` flag to `dryRun()` at all. **§7's second gate is closed.**
7. ~~**The pricing page**: the "YOUR PLAN" pill is a bordered box, and the
   three plans do not use the struck/ghost grammar.~~ **DONE 2026-08-28 —
   section 31.** The pill is a wash and a colour with no ring; the plans ghost
   at the floor with the current one struck, gated on `:has(.plan--current)` so
   a visitor with no plan does not meet a page that is entirely dimmed.
8. ~~**The Supabase spec**, then a plan, then code.~~ **THE SPEC EXISTS AS OF
   2026-08-25** — three documents, written after Paul settled four decisions:
   full migration (accounts, credits AND sessions), Google + email/password
   first, and the shape where **Supabase proves identity but THIS SERVER MINTS
   ITS OWN SESSION**, because a JWT cannot be revoked and this service holds
   their face. `docs/superpowers/specs/2026-08-25-supabase-identity-money-design.md`
   plus its schema and test-runtime companions. **11 open questions are Paul's
   to close, and no plan and no code exist yet.** INSTAGRAM LOGIN IS IMPOSSIBLE
   — not a Supabase provider, and Meta forbids using its Instagram APIs to
   authenticate app users; Facebook is deferred behind App Review and Business
   Verification. **NOTE: a credit PACK does not need any of it** — revenue is
   not blocked behind that migration.
9. ~~**THE FREE TAPE IS STILL THE OLD ONE**~~ **BUILT 2026-08-25.** The
   GLOBAL CEILING §3 calls "the single most important line in this section"
   now exists: `freeTape.globalCeiling` in `config/credits.json`, **default
   100**, a lifetime count across every account ever, enforced inside a global
   file lock in `createAccount`, with `0` supported as a kill switch and an
   8-thread barrier test. Reaching it does NOT fail signup — the account opens
   at zero with an auditable withheld row, because a visible balance the button
   then refuses is what forced free off 16 credits in the first place. The
   free plan is once-ever now, not per period. **THE SIGNUP GRANT IS 21, NOT
   42** — §3's own number, Paul's call the same evening — so the exposure is
   $2.07 a signup and about $207 against the ceiling. **The grant and the
   ceiling do not move together; editing one silently re-prices the other.**
   What the ceiling does NOT bound is availability — see F21.

### THE SECURITY REVIEW'S FIX ORDER IS WORKED — section 28 for what shipped

**`docs/security-review-2026-08-25.md`, on this machine only.** A second review,
three independent auditors, every HIGH re-verified by hand. **IT IS GITIGNORED
AND MUST STAY THAT WAY** -- this repo is PUBLIC and an accurate list of a live
system's open weaknesses is an attack roadmap. That is `.gitignore:16` and its
reasoning is right. **Do not summarise its findings here, in a commit message,
or in a PR description.** Read the file.

**What is safe to say in public, because it is all good news:** `.env` has never
been committed, no secret reaches a log, a manifest, a page or disk, there are
still zero npm dependencies, no cross-tenant path to another user's face exists,
no XSS was found, and four webhook forgeries were all refused.

**All seven items of the review's own fix order were closed 2026-08-25/26** --
the CRITICAL first, then every HIGH, the two customers'-money defects, and the
deployment headers -- each as its own commit with the failing test written
first. Section 28 records what each commit DOES; the review records what each
closed. **What is still open lives only in the review**: a handful of MEDIUMs
and LOWs outside the fix order, including one that **still arms on the next
edit to `config/models.json`** -- whoever fills in the still model reads the
review's section 3 FIRST, same rule as before.

### One cheap win left — the other two were already taken

- ~~**A fluorescent buzz and a kitchen clock tick.**~~ **BOTH DONE, and this
  entry was stale for an unknown number of sessions — checked 2026-08-30,
  §44E.** The tick is in `kuechentisch-fruehstueck.json` and the buzz in
  `plattenbau-treppenhaus.json`, both with full derivations. Section 20's "NOT
  DONE" paragraph is history.
- **The camera zooming is still a negative**, confirmed at
  `scripts/compose/prompt.mjs:171`. A punch-in zoom is the most characteristic
  home-recording move there is. Left alone so the vlog run measured one change.
  Section 19. **Buildable, but judging it needs a paid render**, which is parked
  behind the friends test.

### Things that will bite you

- **A TEST THAT ASSERTS AN ABSENCE PASSES VACUOUSLY IF IT LOOKS IN THE WRONG
  PLACE** (2026-08-29). `[].every()` is true, and an empty `readdir` satisfies
  every negative assertion you can write. One test here looked in `input/` for
  files that land in the job directory ROOT — the legitimate sink values already
  carry the `input/` prefix — found nothing, and passed against a deliberately
  sabotaged guard. **Assert the legitimate artefact is PRESENT first, then
  assert the absence.** Pair with the uncaught-sabotage rule below: both fired
  in the same session and only the second caught the first.
- **THE SHAPE MUST REACH FOUR PLACES, NOT ONE** (2026-08-29). `aspect` is now
  threaded through `resolveRaster`, `falAspectFor`, `creditCost`/`costOf`,
  `dryRun`, the tape crop and the compose log. Three of those were found missing
  it AFTER the feature shipped, in one audit. **Grep every consumer when adding
  a dimension; a unit test of the receiver cannot see the call site that forgot
  to pass it.**
- **A GUARD CAN CHECK THE WRONG LAYER AND READ GREEN FOREVER** (2026-08-29).
  Three did: a path check that could not see a commit message, a grep aimed at a
  file that does not hold the guard, and an ignore rule matching a filename
  rather than a family. **When auditing a control, RUN it and confirm it can
  fail** — presence in the file is not enforcement.
- **THE FRAME SHAPE IS PART OF THE PRICE NOW** (2026-08-29). `creditCost` takes
  an `aspect`, and a non-default shape costs 4/3 — 28 CR at 480p, 61 at 720p.
  **A call site that forgets to hand it on charges the 4:3 price and sells a
  third below cost, silently**, which is the §26 pass-through shape and the
  exact bug that had to be fixed to open the menu. `costOf`, the session seam
  and `creditCost` all take it; grep before adding a fourth. An UNPRICED shape
  is refused rather than defaulted — a 1:1 tape would be 0.75x, not 4/3, so the
  multiplier is per shape and not one constant for "not the default".
- **THE DOCKERFILE AND `.dockerignore` MUST STAY LF.** `core.autocrlf` is true
  here, and a CRLF Dockerfile does not parse — a `\` continuation followed by
  CR stops being a continuation, and there are four in the ffmpeg layer.
  `.gitattributes` pins both; a test asserts the bytes so it goes red on the
  machine where the problem exists. Measured: a CRLF `.dockerignore` still
  works because BuildKit strips the CR, but it is pinned anyway.
- **`MSYS_NO_PATHCONV=1` before any `docker run` that passes `/data`.** Git
  Bash rewrites it to `C:/Program Files/Git/data`, and the resulting `EACCES`
  looks exactly like a volume-permissions bug. The Dockerfile's own `CMD` is a
  JSON array and is unaffected.
- **A JS `String.replace` hits the FIRST match, which in these files is
  usually a COMMENT.** A sabotage sweep reported a working guard as broken
  because the harness had only edited prose. Anchor mutations to the real line,
  and **treat an uncaught sabotage as suspect until you have proved the
  mutation changed the code** — and note `\n` will not match a tracked file's
  CRLF, so use `\s*`.
- **THE PASSWORD FUNCTIONS ARE ASYNC NOW** (2026-08-26). `hashPassword`,
  `verifyPassword`, `authenticate` and `createAccount` all return Promises. A
  forgotten `await` does not throw — it yields a truthy Promise where a boolean
  was expected, which reads as **"every password is correct"**, or an Account
  with no fields. Grep those four names before trusting a call site. §28.
- **`authenticate` is dead in the web layer and mandatory anyway.** Nothing in
  `scripts/web/` calls it any more — `/login` asks Supabase
  (`sb.signInWithPassword`) instead — but `session-middleware.mjs`'s
  `REQUIRED_AUTH` still lists it, so every test fake handed to the server
  still has to supply a function that nothing calls, or `missingAuthFunctions`
  fails the whole thing closed. Not tidied away on purpose; narrowing the
  contract is a separate decision from shipping the Supabase slice.
- **The equal-time-refusal guard (§28 item 3) no longer protects `/login`.**
  It was built deliberately and it still has a passing test, but `/login` asks
  Supabase for the password check now, not the local `authenticate` the guard
  times. The wall-clock symmetry of a refusal is Supabase's property today,
  not one this codebase can measure or fix from here — spec §4.3 and §10 name
  it and leave it open rather than pretending the old guarantee still reaches
  the route it was built for. Known, accepted limitation, not a regression to
  chase.
- **`npm run accounts -- create` no longer mints a password anyone can sign in
  with.** Supabase, not the local scrypt hash, decides whether a password is
  accepted, so a password this command generates or accepts via `--password=`
  is never checked by anything a browser can reach. Its future — an inspector,
  an `invite` command, or removal — is an open question (parent spec's open
  question 5, restated in `2026-08-26-supabase-identity-slice-design.md` §7
  and §10.4) and stays open; this is only the record that today's behaviour no
  longer does what its own `--help` text says.
- **A test that posts `/login` or `/signup` must fetch the form FIRST.** Both
  routes need the anti-forgery pair — the `timestamp_csrf` cookie off the GET
  plus the hidden field out of the HTML — or they answer 403 and set no
  session. Every web test file has a `csrfPair`/`signIn` helper; copy it rather
  than posting bare. §28.
- **A FOURTH inline `<script>` will not run.** `script-src` names the shipped
  scripts by hash and nothing else. This bullet said "third" until 2026-08-27,
  when `BG_SCRIPT` became the third and was added properly (§30) — the COUNT is
  not the rule, `INLINE_SCRIPT_HASHES` in `views.mjs` is. A script added
  anywhere else is dead in the browser, silently. §28.
- **A test-mode Stripe event grants nothing**, deliberately, so the §27 replay
  demo no longer moves credits. Not a regression.
- **Read the prompt before blaming the model.** Twice the model was doing
  exactly what it was told: `Nothing dramatic happens` produced a tape with
  nothing happening, and `deep focus ... all the way to the shed` produced the
  edge-to-edge sharpness that reads as AI.
- **Backticks in a comment inside a template literal** break `static.mjs` and
  `views.mjs`. **The most repeated mistake in this codebase — it happened again
  on 2026-08-24.** `node --check` after every edit to those files.
- **A fixed shape that projects fields will drop yours.** `entriesOf` in
  `credits.mjs` returns a literal object, so a field written to disk and not
  named there reads back `undefined` forever. Cost an hour today. Section 5.
- **`job-model` fails under full parallel load on Windows** and passes in
  isolation. Section 12, not a regression. Re-run the file alone. **`queue-race`
  no longer belongs on this line: its load failure was a REAL double-claim
  race, found by Linux CI and fixed 2026-08-29 — section 40.** A queue-race
  failure now is a regression until proven otherwise.
- **CLAUDE CANNOT RUN PAID COMMANDS.** Paste them and paste the output back.
- **Every price in this repo was a guess until 2026-08-24, and three still are.**
  `image-to-video` has never been called; 720p has never been run.

```bash
npm run web                              # terminal 1
npm run worker -- --provider=fixture     # terminal 2
```
**`dev@example.com / timestamp-dev-password` NO LONGER WORKS, and nothing
replaces it with another fixed credential.** Its domain is not real, so
Supabase can never mail it a confirmation code and the account can never be
claimed (spec §7 of
`docs/superpowers/specs/2026-08-26-supabase-identity-slice-design.md`). **Sign
in with a real address you control** through `/signup` or `/login` (or
Google) — `plstnly06@gmail.com` already exists as an account here and claims
cleanly. A documented credential that does not work is worse than no
documented credential, so none is offered in its place; the owner was offered
a gated local bypass and declined it.

`paul@example.com` -- this line's older reasoning, "no reset endpoint," is
now out of date on its own terms: `/auth/reset` exists as of this slice. This
report did not verify that specific account's current state (no matching
account was found under this checkout's local `out/accounts/`, which is
gitignored and machine-specific), so whether it can now be reached through
`/auth/reset` is not asserted either way here.

**The repo is PUBLIC: https://github.com/PaulStanley0211/timestamp**
`out/`, `.env` and `assets/test-photos/` are gitignored. Both security-review
docs stay gitignored on purpose — section 2.

---

### 1. WHERE THE THREE BLOCKERS ACTUALLY STAND (two are CLEARED)

1. ~~**`FAL_KEY` in `.env`**~~ **DONE 2026-08-23.** Paul pasted it himself.
   Verified: correct `uuid:hex32` shape, no quotes, no stray whitespace, LF
   endings; **invisible to `npm test`** (bare `node --test`, checked); **never
   staged or committed** (`git log --all -- .env` is empty).
   **`npm run doctor` DOES NOT LOAD `.env`** - the script has no
   `--env-file-if-exists`, unlike `render` and `worker`, so it prints "not set"
   even when the key is right. **The earlier claim in this file that doctor
   confirms the key was WRONG.** Use:
   `node --env-file-if-exists=.env scripts/preflight/doctor.mjs` -> prints
   `present`, never the key. A one-word fix to `package.json` was offered and
   Paul has not answered; do not apply it unasked.
2. ~~**A photo at `assets/test-photos/face.jpg`**~~ **DONE 2026-08-23.** Paul's
   own phone selfie, 3712x1712 with EXIF orientation 8. Verified through the
   REAL intake path: autorotates to 1712x3712, `stripped: true`, and a raw byte
   grep confirms the stored copy carries **zero** Exif/GPS/XMP where the source
   had all three. That is the first time the privacy claim was tested against a
   file that actually had coordinates in it.
3. **The still model is STILL unchosen, and now there is EVIDENCE.** See
   section 8 - `fal-ai/uso` was run for real and FAILED on identity. Two
   candidates remain untested. This is the only blocker left and it is the one
   that decides whether this is a product.

**Phase 0 is part-run.** One still, one model. The blind check has not happened
and does not need two people in a room: **Paul lives alone, and the check is a
text message** - send the generated image to two people who know his face with
the words "Who is this?" and NOTHING else. He primed a friend on the real photo
by saying "it is not AI generated"; **that must not happen on the real check**,
and ideally a different person is used, because that one is now primed.

### 2. DECISIONS TAKEN 2026-08-21/22 - do not re-litigate

- **Retention is 7 days for the photo, 30 for the finished video** - exactly what
  the consent text already promised. Implemented; see section 3.
- **THE ANSWER IS SUPABASE, AND THE REASON IS GOOGLE SIGN-IN.** Paul first chose
  a single VPS with `node:sqlite`, then switched. Asked to justify it, he gave
  the deciding fact: **he wants "sign in with Google" the way other apps have it,
  plus password login, plus password reset.** That is three identity features,
  not a database preference.

  **DO NOT RE-OPEN THIS AS A DATABASE QUESTION.** It was already argued the other
  way and lost on identity, not on data. SQLite was the better *database* answer
  -- smaller change, keeps 45 tested auth tests and the isolation proof, and
  `ledger_once` fixes the lock-file ledger completely. What it cannot do is rent
  identity. Hand-building Google OAuth means the redirect round-trip, a `state`
  parameter against CSRF, verifying Google's ID token against cached JWKS
  (`iss`/`aud`/`exp`/`nonce`), and an account-linking decision where getting it
  wrong is account takeover -- and it still would not provide password reset.

  **Costs accepted deliberately:** 45 tests and the tenant-isolation proof get
  deleted and rewritten against RLS. ~~**Deployment moves earlier**, because
  Google OAuth needs registered redirect URLs, so a real domain and TLS -- the
  sign-in flow cannot be fully tested on localhost.~~ **THAT CLAIM WAS WRONG,
  TWICE OVER -- corrected 2026-08-26. It does NOT reopen the choice of Supabase;
  it removes one stated cost of a decision already taken.** See
  `docs/superpowers/specs/2026-08-26-supabase-identity-slice-design.md` §0.1.
  First, Google's own documentation exempts localhost from the HTTPS rule:
  *"Redirect URIs must use the HTTPS scheme, not plain HTTP. Localhost URIs
  (including localhost IP address URIs) are exempt from this rule."*
  (`developers.google.com/identity/protocols/oauth2/web-server`). Second, and
  more decisively, **in this architecture Google never sees our URL at all** --
  the Authorized redirect URI registered in the Google console is *Supabase's*
  callback, and Supabase's own redirect allow-list explicitly supports
  `http://localhost:3000/**` for local development. The full Google round trip
  is testable against `127.0.0.1:3000`; deployment does not move earlier.
  Current position:
  - **Supabase Auth REPLACES login entirely** - `accounts.mjs` and `session.mjs`
    get deleted, users live in `auth.users`, sessions become JWTs, isolation
    becomes RLS. **This costs 45 tests and rewrites the tenant-isolation proof.**
  - **PostgREST over `fetch` + Postgres functions**, NOT `@supabase/supabase-js`.
    This is what keeps **zero npm dependencies** alive. Atomicity comes from SQL
    functions (`debit_credits(...)` as one RPC is atomic by definition).
  - **The service-role key bypasses RLS.** If the Node server holds it and uses
    it for everything, RLS is decorative and isolation is back in app code. For
    RLS to be load-bearing the server must forward the USER's JWT on user-scoped
    reads and reserve service-role for the Stripe webhook, which acts with no
    user present.
- **Stripe: subscriptions on the existing plans**, credits granted only on
  `invoice.paid`, **unused credits expire each period as an explicit negative
  ledger row**. Checkout is hosted, so "card details never touch this codebase"
  stays literally true.
- **The security review and its brief are gitignored** (`docs/security-review-*.md`).
  This repo is public and an accurate list of open weaknesses is a roadmap. Both
  files are on Paul's disk. `docs/security-review-brief.md` was already committed
  in `9bc24ea`, so that commit was amended to drop it. **The vuln list was also
  redacted out of this file** - do not copy it back in.

### 3. WHAT SHIPPED THIS SESSION

**F1/F2 retention - the promise the consent text makes is now performed.**
`scripts/render/purge.mjs` (`planPurge` / `executePurge`, **`dryRun: true` by
default**, plus `purgeJobMedia` and the canonical `sweepRetention`),
`purge-cli.mjs` so `npm run purge` runs and refuses to delete without `--apply`,
a worker sweep at startup and hourly, and `DELETE /api/jobs/:id` now removing the
video, stills, contact sheet, segments, source and poster rather than `input/`
alone. The `202` path is honoured - the worker purges at the cancel sentinel.

**Three rulings from that work worth not rediscovering:**
- **Age is measured from `createdAt`, never `updatedAt`.** `updatedAt` is
  restamped by every `saveJob`, so a retried job would defer its own deletion
  forever.
- **A live lease beats age.** A long-pending job claimed for the *first* time
  today was having its directory deleted out from under its own render.
  Deferred, not spared.
- **Everything that deletes reports what it could not delete.** The first version
  swallowed a refused unlink with `catch { continue }` - an `EBUSY` while
  `getVideo` streams the same file - and answered a flat 200. **That was F2
  recurring inside the fix for F2**, found by a code review, proved with an
  injected `fs` before being fixed.

**CI exists - `.github/workflows/test.yml` and `guards.yml`.** 991 tests on
ubuntu + windows, node 22 + 24. `guards.yml` enforces decisions that are
invisible when they break: the test script must stay a bare `node --test`,
`fal.mjs` must keep having no default `fetchImpl`, no security review may be
tracked, no `.env` or `out/`, and the consent text must still quote the retention
config.

### 4. ~~CI IS RED ON LINUX~~ **BOTH LINUX REDS ARE FIXED (2026-08-28, `096ba76`) - and there were THREE**

> **THIS SECTION IS NOW HISTORY.** The table below is why they were red and how
> they were diagnosed; it is no longer a list of open failures. §33 records the
> fix and the third red that was hiding behind the first. **The shared-path
> race at the bottom of this section is also closed** (`5be6c1f`, all four
> directories). What is left of CI red on a first PR run is: nothing known.

**Windows 991/991 green. Linux 989/991.** The matrix paid for itself on its first
run by catching a Windows-only assumption in the purge CLI tests (a `file:` URL
pathname with its leading slash stripped - valid on Windows, *relative* on
Linux). Fixed in `d15f71c`.

| Test | What is actually wrong |
|---|---|
| `the fixture really does carry EXIF and GPS...` | Asserts `meta.sideData.includes('EXIF metadata')` - a claim about how one **ffprobe build names side_data**, not about the file. **The real strip test passes on Linux, byte-grep and all**, so EXIF stripping genuinely works. Fix: assert the bytes, or accept either spelling. |
| `a broken filtergraph fails loudly...` | Asserts ffmpeg's error *wording*, which differs between the gyan.dev Windows build and Debian's. Fix: assert the failure and that stderr is non-empty, not the text. |

~~**Plus two pre-existing FLAKY tests**~~ **THE FLAKES ARE FIXED - FIVE of
them, three on 2026-08-26 and two on 2026-08-27, one commit each, and not one
by widening a margin.** The first four fired only when `node --test` ran files
in parallel, and every one turned out to be a test measuring the machine rather
than the code - which is why passing in isolation never cleared them. **The
fifth is a different animal and worth reading as one:** it cannot fire on CI at
all, and there is no timing margin in it anywhere. It needs TWO suites running
on one checkout at once - which is now routine here, with several sessions
sharing this working copy.

| Test | What was actually wrong | Fix |
|---|---|---|
| `[fal] a 720p request downloads a 960x720 clip...` (`empty_download`, ~3 in 8) | **`provider-contract.test.js` imports `falContractCase`, so node registers and runs the WHOLE fal file in that process too** - two processes at once, both starting `dirSeq` at zero, both walking the same `build/provider-fal/<label>-<n>`, and `mkdirSync` with `recursive` never complains. Logged over one full run: 92 claims from 2 processes, **44 names claimed by both**, `media-44` among them. Two ffmpegs on one path; a read between the truncate and the first byte gets zero bytes. | `c897845` - the pid goes in the directory name, exactly as it already does in `accounts.mjs`. Re-measured the same way after: **0 names shared**, the two now writing `media-30700-44` and `media-32764-44`. |
| `a concurrent reader never sees a truncated or invalid manifest` (~2 in 8) | Starting the reader thread on a loaded machine ate the writer's 10s budget while the writer spun through `saveJob` competing with the very thread it was waiting for. `parsed > 0` then failed having proved nothing - **the exact trap this test's own comment describes being fixed once already**, one layer down. | `aba30a1` - the reader raises a flag on its first read and the writer `Atomics.wait`s for it, which hands the core over instead of contending for it. The guard is also stronger: it now counts reads taken **while** the manifest was being rewritten (19431 in an isolated run, against the 5 the writer waits for), and stands the run down as *skipped, with its reason*, when that count is zero. The `invalid` assertion is made first and always. |
| `an oversized password takes the same work as a normal one, on both branches` (~2 in 5 - **this one was never listed here**) | Wall-clock medians of scrypt across four cells. Under load the four burn the same cpu to within a millisecond while their clocks spread 3.8x; in one measured run the cell reading **slowest** on the clock (539ms) was the one that had burned the **least** cpu (62ms). | `1dd8e02` - the comparison is made on `process.cpuUsage()`: work done, not time waited. **The 4x margin is unchanged**, and it was verified still to catch the early return by putting it back on both branches. The wall clock is still asserted - cpu time cannot see an `await` added to one branch only, which is what arrives with Supabase - but only when the run shows the machine was free enough for the number to mean anything. |
| `the simulated latency goes through ctx.sleepImpl` (1 in 4 under 8 extra cpu hogs, 0 in ~10 unstressed) | The budget was 15000ms, half the nominal latency -- but **the window it timed had a real ffmpeg render inside it**, and on the first run of the file the `reference()` build as well, because `await reference()` sat in the argument list, evaluated AFTER the clock started. ffmpeg took 16.1s under load, so the test failed reading `injected sleepImpl was bypassed` while sleepImpl had in fact been called exactly right. **This assertion had already been widened once** - 1000ms/900ms to 30000ms/15000ms - and its own comment records that widening. The second one was the same mistake as the first. | **this commit** - **the budget went DOWN, 15000ms to 1000ms**, by taking ffmpeg out of the window instead of making room for it. `runFfmpegImpl` is a seam `createFixtureProvider` already exposed and no test had ever used; stubbed, the measured call is one mkdir, one stat and three awaits, and the pixels stay covered by the eight other ffmpeg-backed tests in the file. Both margins measured rather than guessed: 180 samples under eight cpu hogs ran **0.32ms median, 2.15ms worst** (~465x under budget), and a real timer leaked on only the *smallest* phase was caught at **6137ms** (6x over). Verified by breaking the provider three ways on purpose - ignore the injected impl, await a real timer alongside it, await one on the 0.2 phase alone - and all three fail. |
| `the output honours the delivery contract exactly` **and eight more - nine in all, every time two runs overlap** | `test/audio-output.test.js` and `test/ffmpeg-output.test.js` both wrote into `REPO_ROOT/build/test` **with no pid**, under fixed filenames. Inside one run that is safe, which is exactly why it hid: the two files use different names, and neither is imported by another test file the way `provider-contract.test.js` imports `provider-fal.test.js` - **so it cannot fire on CI, which runs one suite**. Across two runs all six mp4s are the same path, and the second run truncates the first mid-read: `moov atom not found`, `Invalid NAL unit size (-209167041)`, a spray of audio-decode failures, single tests taking up to 170s. **It reads as load or a real regression and is neither**, which is the expensive part - one session spent a full diagnosis pass on it before another spotted the shared directory. Measured by logging every ffmpeg path claim across two concurrent suites: **6 of 6 files under `build/test` claimed by both runs**, and **the same nine tests failed in both**, all nine from these two files and nothing else in the other 53. | **this commit** - the pid goes in the directory, exactly as in `c897845` and `accounts.mjs`, and on the **directory** rather than on each filename so a test added here later is safe without its author knowing any of this. Re-measured the same way after: **0 files shared** - distinct paths went 50 to 56, the six shared names splitting into twelve - and **not one of the nine failed in either run**. No timeout widened and no retry added; the race is gone rather than tolerated. |

**Two sources of red left, and both are the Linux ones above.** None of the
five was papered over with a retry, a `continue-on-error` or a wider timeout:
**a test whose timing margin is narrower than machine variance tests the
machine**, and that ruling is what picked the first four fixes. The fourth went
further and made its budget **15x tighter**, which is what happens once the
window has nothing in it but the thing being measured. The fifth had no margin
to widen in the first place - the answer to a shared path is to stop sharing
it.

**Still open, same class as the fifth, and measured rather than suspected.**
`build/provider-fixture` (22 paths claimed by both runs), `build/provider-contract`
and `build/test-intake` still build their directories without a pid, so two
overlapping suites share those too. While the fifth fix was being verified,
`the progress bar actually grows -- it is not a stripe` failed out of
`build/provider-fixture/bar/` in exactly that way. Nobody has lost a diagnosis
pass to these yet; when someone does, the fix is the one line above.

### 5. SPECS WRITTEN - one needs rewriting before any code

`docs/superpowers/specs/`:
- **`2026-08-21-sqlite-identity-money-design.md` - SUPERSEDED.** Kept because
  most of its reasoning survives Postgres: the repository-seam approach and its
  **191-test acceptance gate** (counted, not estimated), `ledger_once` as a
  partial unique index, balance derived by `SUM(delta)` and never stored, expiry
  as an explicit negative row, the never-delete-anything migration with a
  per-account parity check, and jobs/queue staying on files.
- **`2026-08-21-stripe-subscriptions-design.md` - SUPERSEDED 2026-08-24** by
  `2026-08-24-credit-packs-pricing-design.md`. Most of it survives and must be
  read before any Stripe code: two guards against double payout, the raw-body
  signature trap (`server.mjs` already parses bodies - a reserialise breaks
  every signature), replay window vs idempotency as separate concerns. What is
  superseded is the OBJECT BEING SOLD.
- **`2026-08-24-credit-packs-pricing-design.md` - current, approved, not
  started.** **$10 for 40 credits, ONE-OFF, one Price.** A credit is $0.10 of
  provider COST, so a 480p tape is **21 CR and not 16** -- the old number was
  set by feel against a cost 27% too low. Credits sell at **$0.25**, which is
  60% gross and is chosen to absorb the FREE RETRIES that direct mode made
  inevitable. **A pack ships on the existing file ledger and does NOT need
  Supabase.** One free tape ever, not monthly, with a global ceiling.
  ~~**AND THE PRECONDITION NOBODY WOULD GUESS: `grantCredits` has no
  idempotency key**~~ **CLOSED 2026-08-24.** Grants take a `ref`, deduped inside
  the existing per-account lock, returning `{granted, credits, ref}` so a
  webhook can tell a payment from a redelivery. **Two traps:** `entriesOf`
  projects a fixed shape and silently dropped the `ref` on read, which is
  idempotent in memory and not idempotent across a reload; and a sequential
  test is not enough, because Stripe retries overlap -- there is an 8-thread
  barrier test.
- **NOT WRITTEN: the Supabase design.** Sub-project 1 needs a fresh spec for
  "Supabase Auth replaces login + PostgREST over fetch". That is the next
  writing task, and **no code should be written before it exists.**

**Still needs Paul before Stripe Prices are created:** `annualUSD: 100` is
flagged in `config/credits.json` as *"ten months for twelve - an interpretation
of Paul's words, NEEDS PAUL"*. **A Stripe Price amount is immutable once
created**, so changing it later means a new Price and migrating subscribers.

### 6. THE UI REDESIGN - DONE, committed to a branch (6a-6c)

Paul installed a third-party skill pack at `~/.claude/skills/` (user-level, NOT
in this repo): `ui-ux-pro-max`, `ui-styling`, `design-system`, `brand`, `design`,
`slides`, `banner-design`. Reviewed before installing - MIT, no injection
patterns, no hidden network calls. **`design` collides in name with a built-in
skill.** **`ui-styling` is Tailwind + shadcn and is incompatible with this
project's zero-dependency, zero-JavaScript rules - do not follow it here.**

**The first `--design-system` query MISROUTED** and was correctly rejected rather
than applied: it returned an ops-telemetry landing pattern, indigo-on-near-white
(this product is Kodak yellow `#FFB700` on `#0B0A09`), Google Fonts over CDN
(the CSP has no external sources and VT323 is bundled for determinism), and a
GSAP snippet (there is no JavaScript). **The skill's own contract says to verify
fit and retry once with a narrower query.**

### 6a. THE REDESIGN IS DONE - 2026-08-22, commit ca2b912, 991/989/0

**The retry happened, and `--design-system` was NOT re-run** - the contract's
narrower path was taken instead, two explicit `--domain ux` queries. Both came
back mostly generic web guidance. **Three results were genuinely applicable and
all three are used**: heading hierarchy, line length 65-75ch, heading line
balance. Everything else in the redesign is reasoning from this repo's own
existing decisions, and it is labelled that way rather than dressed up as a
database match. **Do not re-run `--design-system` on this product hoping for a
better roll** - it has now misrouted once and been declined once on contract.

**The diagnosis was one defect readable two ways.** The page had **no `<h1>` at
all**: it opened on a paragraph and then four sibling `<h2>`s of equal size, so
a screen reader met four headings with nothing above them and an eye met four
boxes with nothing above them. The landing page had already solved exactly this
("one thing is the subject"); the signed-in page never got the same treatment.

**What shipped, in `views.mjs` and `static.mjs`:**
- **A real `<h1>`.** The copy is NOT new - it is the existing lede split at the
  full stop that was already in it. Do not "improve" it into new marketing.
- **A weight arc replacing one `.panel` rule**: `--anchor` (step 01, the photo),
  `--choice` (steps 02/03, borderless and lightest), `--commit` (step 04, firm
  again because that is where credits are spent), `--archive` (full width,
  outside the form). A panel's treatment now states its job.
- **Two columns above 62rem**, `#tape` as a grid: a 320px sticky anchor column
  and a 640px flow column - **measured, exactly 1:2**, where all five panels
  used to be one 44rem width. Sticky is the argument, not a flourish: the
  photograph is the identity anchor for every choice made to the right of it.
- **The step number is now a 44px VT323 numeral** in the header gutter, at
  `accent-deep`, replacing an 11px eyebrow that was the smallest type on the
  page while being the only thing distinguishing one panel from the next.
- **Prose capped at 56-62ch** and headings given a bounded measure.

**Zero JavaScript was added and zero npm dependencies.** But note, because a
stale claim is worse than none: **this page is NOT zero-JavaScript and was not
before.** There is an existing inline `<script>` doing two progressive-
enhancement jobs (chosen filename, clearing the reason under an enabled button).
It was not touched.

**UPDATED 2026-08-26 — the CSP no longer says `'unsafe-inline'` at all.** That
keyword named no scripts and therefore admitted every one of them, including
anything an injection might write. `script-src` now names this product's two
inline scripts BY HASH. **Both live as constants in `views.mjs` beside
`INLINE_SCRIPT_HASHES`** — edit one and its hash follows automatically; add a
third `<script>` anywhere else and the browser refuses to run it, with a test
that hashes what pages actually ship failing first so the refusal is loud
rather than a silently dead feature. See §28.

**Measured, not asserted:** at `scrollY 1200` the anchor's top edge sits at 20px
(its `1.25rem` offset); the 44px numeral contrasts **4.96:1** against its panel,
clearing the 3:1 large-text bar and the 4.5:1 body bar; at 390px wide
`scrollWidth == clientWidth` with the anchor computed back to `static`.

**ONE TEST WAS CHANGED AND THAT IS WORTH SAYING OUT LOUD.**
`test/web-api.test.js` asserted the literal substring `STEP 01`. The steps are
still numbered and still in order, but the word and the number are now separate
elements, so the substring is gone. The assertion was rewritten to check what
the test is *named* for - numbered, in order - via the `.stepno-n` elements. It
compares against `['01','02','03']`, so **it cannot pass vacuously** if the
numbering disappears entirely.

**Two traps this work re-confirmed the hard way, both already in this file:**
backticks inside a comment inside a template literal broke `static.mjs` parsing
(use plain quotes - it cost a restart), and a `&&` chain that short-circuited on
a failed `node --check` left the OLD server holding port 3300 and serving stale
CSS, which is the "editing CSS and expecting to see it" trap wearing a
different hat. **Kill by PID and verify the port is free before restarting.**

**Dead CSS caught in review:** a `.panel--choice:first-of-type` rule never
matched anything, because the first `section` of its type inside the form is the
ANCHOR, not a choice - and had it matched it would have broken the very
alignment it was written to create. Removed, with the reason left in place.

### 6b. THE CONSENT CHECKBOX WAS 16x16 AND IS NOW 24x24

Found by reading the skill's `references/quick-reference.md` §1, which the first
pass had skipped. **WCAG 2.2 AA (SC 2.5.8, target size minimum) asks 24x24 CSS
px**, and `.check input` was `1rem` - the smallest hit area in the product, on
the control that gates **both signing up and spending credits**, and the only
element on the page failing an AA criterion. Now `1.5rem`, with `margin-top`
dropped from `0.35rem` to `0` because that margin was compensating for a box 8px
shorter; measured, the box centre now sits **2px** from the first consent line's
centre. **One rule fixes both gates** - `views.mjs` and `views-auth.mjs` share
`.check`.

**The page now has ZERO SC 2.5.8 failures, verified rather than assumed.** Six
targets are still under 24px and all six pass legitimately: two `.linky` labels
are inline in a sentence (the criterion's inline exemption), and the rest clear
the **spacing exception** - nearest centre-to-centre distance measured at
**63px** against the 24px the criterion requires. Do not "fix" those six.

**Also verified, because the redesign introduced a sticky element:**
`focus-not-obscured` (SC 2.4.11 AA) - sticky UI must not hide the keyboard-
focused control. **0 violations across 12 focusables.** The anchor is its own
grid track, so it cannot overlap the flow column; that is geometry, not luck,
but it had been assumed rather than measured until now.

### 6c. THE LAYOUT, RE-DERIVED FROM THE SKILL ALONE - and what that proved

Paul asked for the layout to be designed using **only** `ui-ux-pro-max`. Doing
that properly meant stopping guessing at queries and reading the dataset.

**THE MISROUTE IS THE DATASET, NOT THE QUERY. `--design-system` was re-run with
a completely different query ("consumer creative video tool") and returned the
IDENTICAL wrong answer as last session:** Real-Time / Operations Landing pattern,
indigo `#6366F1`, Inter / Playfair Display, Google Fonts CDN. **Two unrelated
queries, one output. Stop re-rolling it.**

**The root cause, found by enumerating the data rather than guessing:**
- `data/landing.csv` - **34 patterns, every one a marketing LANDING page**
  (Hero + Features + CTA, Pricing Page, Waitlist, Bento Grid...). There is **no
  application-screen pattern in the file at all.** The signed-in page is a
  multi-step creation form behind a login, so the nearest match is always wrong.
- `data/app-interface.csv` - **32 rows, every one `iOS/Android/React Native`**,
  and it has no layout category. Its own header says it is not for web.

**So the skill has no layout PATTERN for this page and cannot have one.** That
is structural, not a bad search. What it does have is `ux-guidelines.csv`:
**9 Layout rules + 8 Responsive rules**, stack-agnostic and genuinely applicable.
The layout was audited against all 17. **Three real divergences, all fixed:**

| Rule | Was | Now |
|---|---|---|
| **Breakpoint Testing** ("test at 320 375 414 768 1024 1440") | broke at `62rem`/992px - on no device list and no scale | **`64rem` = exactly 1024** |
| **Viewport Units** ("use dvh, not 100vh") | `body { min-height: 100vh }` | **`100dvh`** (pre-existing bug) |
| **Container Width** ("65-75ch for text") | lede at `62ch`, just under the band | **`66ch`** |

**Verified at all six of the rule's own widths** - 320 / 375 / 414 / 768 / 1024 /
1440: **no horizontal overflow at any**, single column below the break, two
columns at and above. The 1:2 column ratio is exact at 1440 and **1:1.94 at
1024**, where the wrap is viewport-constrained rather than at its 62rem max.

**Two rules deliberately NOT actioned, both needing Paul:**
- **Readable Font Size** wants **16px minimum body on mobile; this app is 15px.**
  Real (it is also what triggers iOS input auto-zoom), but changing it reflows
  every page in the product. **Typography, not layout - not done unasked.**
- **Z-Index Management** wants a defined scale (10/20/30/50); the repo uses
  `-2/-1/1/9`. Those four values are load-bearing for the background layer, the
  scrim and the grain plate. **Rewriting them to satisfy a style rule risks the
  full-bleed background for no user-visible gain.** Left alone on purpose.

**A ruling about this repo's own trap, now confirmed twice in one session:**
backticks inside a CSS comment inside `BASE_CSS` break parsing. It is already in
the Common Mistakes list and it still caught two edits. **Run `node --check
scripts/web/static.mjs` after every edit to that file** - and never chain it as
`node --check X && kill-the-server`, because a failed check short-circuits the
kill and leaves the OLD server serving stale CSS, which then looks like the edit
did nothing.

### 7. NEXT, in the order it is worth doing

1. **Finish the bake-off.** Two commands, ~10 cents, section 8a. This is the only
   question that decides whether the product exists.
2. ~~**The UI redesign**~~ **DONE 2026-08-22, committed to a branch - section 6a.**
3. ~~**The eight place photographs**~~ **DONE 2026-08-23 - section 10.**
4. ~~**Commit and push.**~~ **PUSHED 2026-08-26.** The licence question that was
   holding it was answered on 2026-08-24 (section 10). `origin/main` is still
   `b6f64a3` and nothing is merged; **opening a PR remains Paul's call.**
5. **The Supabase spec**, then a plan, then code. Not before.
6. **The four sources of CI red** (section 4).
7. **Three aspect ratios** - `docs/aspect-ratios-plan.md`. **Paul restated this
   on 2026-08-23 as a USER-FACING CHOICE**, see section 9.
8. **The rest of the security report** - local file only.

### 8. THE PAID PATH RAN, 2026-08-23 - four bugs and one real result

**Nothing had ever called fal. The first attempt found a bug in about a minute,
and each fix uncovered the next.** All four are recorded because every one would
have cost the next person the same hour.

**BUG 1 - the transport was NEVER injected in production.** `requireFetchImpl`
gives a paid provider **no default** for `fetchImpl` (money guard 1 of 4), so a
test that forgets it gets a TypeError instead of a bill. That guard worked
perfectly. What nothing did was inject a transport **on the real path** - so
`--provider=fal` could not reach the network AT ALL and died at step 5 of 11 with
the money guard's own TypeError, which reads exactly like a test bug.
Fixed by `paidTransport(provider)` in `render.mjs`, injecting
`globalThis.fetch.bind(globalThis)` **only when `provider.paid`**. All four
guards survive: fal.mjs still has no default, `npm test` never runs `main()`, the
bare `node --test` still keeps FAL_KEY out of the process.
~~**THE WORKER HAS THE SAME HOLE AND IT IS NOT FIXED**~~ **FIXED 2026-08-24,
and the shape of the fix is the lesson.** `worker.mjs` always accepted
`providerCtx`; `worker-cli.mjs` passed none, so the web app's renderer could not
spend either. It stayed broken for a day **because the fix lived inside the file
that no longer had the bug** - a private function in `render.mjs`. It is now
`scripts/providers/transport.mjs`, imported by both commands that can spend, and
`worker-cli.mjs` takes it through the SAME lazy import as `createProvider` so
this file's own rule about not loading a provider to test `renderEvent` still
holds. All four money guards are untouched: fal.mjs still has no default,
`npm test` still never runs either `main()`, the bare `node --test` still keeps
FAL_KEY out of the process, and `guards.yml` still greps fal.mjs.

**A UNIT TEST OF `paidTransport` WOULD NOT HAVE CAUGHT THIS AND DID NOT NEED TO.**
The bug was a missing wire, so `provider-contract.test.js` now reads both CLIs'
source and fails if any `providerCtx:` call site is handed anything other than
`paidTransport(provider)` - including one nobody has written yet. Verified by
deleting the line and watching it go red, then putting it back.

**THE BROWSER STILL CANNOT FINISH A PAID RENDER, and the reason is now a
decision rather than a defect.** `npm run worker -- --provider=fal` loads `.env`
and reaches the network, but a web job takes the fal STILL default, which is
`fal/UNVERIFIED-identity-still` and refuses at compose exactly as designed. The
web form sets no `direct` and carries no model override, so it cannot take the
direct path either. **Those are section 9's questions, not this one's.**

**BUG 2 - the model is resolved in TWO places.** Threading `--still-model` into
the pipeline made compose use the right model while step 5 still used the
default, because `fal.mjs` has its own `resolveModel` reading `opts.stillModel`
from **provider construction**. The failure moved from step 4 to step 5 and
looked identical. Both are now fed:
`createProvider(id, { cfg, stillModel, allowUnverifiedModel })`.

**BUG 3 - the reference field name is NOT the same on every candidate.**
`falStillBody` sent `image_urls`, the fal image-edit convention. `fal-ai/uso`
answered **HTTP 422, loc body/input_image_urls, "Field required"**. Recorded per
model as `stillParams.references` in `config/models.json` rather than renamed
globally - **seedream and nano-banana-pro have not been called and their field
name is still unknown.** Expect another 422 from each; that is data, not a
setback, and a 422 is not billed.

**BUG 4 - and this one would have hit EVERY REAL USER.** fal refused the
reference with `image_too_large`: **max 2048x2048**. The photo was 1712x3712, and
every phone shoots 3000-4000px on the long edge. Fixed at intake:
`LIMITS.maxReferenceEdge = 2048` with an ffmpeg `scale` that fits inside the box
and **never upscales**. Measured on the real file: **1712x3712 to 944x2048,
6.4MB to 341KB**. The size matters as much as the refusal - references travel as
base64, which inflates by a third, so the request went from ~8.5MB to under a
megabyte on **every** call. Written as a FILTER, not computed in Node, because
iw/ih inside the graph are post-autorotation and the file's own comment forbids
reimplementing the orientation table.

**THE RESULT: `fal-ai/uso` FAILED, and Paul confirmed it unprompted.**
Job `20260823-190639-21c4cd`, one still, ~$0.05.

- **Scene adherence EXCELLENT** - hedge, folding table, patterned cloth, four
  white chairs, watering can, coiled hose, bicycle on the fence, raking light,
  exactly one person. **That validates `composeStillPrompt` and the expand
  stage**, not the model.
- **Identity FAILED.** The beard and the tight curls - the subject's two most
  distinctive features - were BOTH dropped, skin tone lighter, face shape wrong.
  Paul's own words: "it doesn't give any kind of face resemblance".
- **Raster FAILED separately.** Ordered 640x480 with `aspect_ratio: '4:3'` sent;
  got **640x512, which is 5:4**. A 5:4 still pillarboxed into a 4:3 tape is a
  visible mistake, so this disqualifies the candidate at this raster **even if
  identity had held**.
- This is the candidate whose **advertised purpose** is identity preservation,
  which makes the result more informative, not less.

### 8a. THE BAKE-OFF SEAM, and why it is two flags

`--still-model=<id>` names a model; `--allow-unverified-model` is a SEPARATE
opt-in that lowers the verified gate. Two, not one, so an unverified endpoint can
never be reached by a caller who only meant to pick a model. **Both defaults are
the refusal that existed before.** The alternative was editing
`config/models.json` to claim `verified: true` - and in this repo that word means
somebody opened the schema page. Faking it to run an experiment would poison the
one signal that stops blind spending.

The two remaining commands, unchanged from the one that worked:

```
node --env-file-if-exists=.env scripts/render/render.mjs --photo=assets/test-photos/face.jpg --place=schrebergarten-august --outfit=trainingsjacke --consent --provider=fal --still-model=fal-ai/bytedance/seedream/v4.5/edit --allow-unverified-model --stills=1 --stop-after=select
node --env-file-if-exists=.env scripts/render/render.mjs --photo=assets/test-photos/face.jpg --place=schrebergarten-august --outfit=trainingsjacke --consent --provider=fal --still-model=fal-ai/nano-banana-pro/edit --allow-unverified-model --stills=1 --stop-after=select
```

**CLAUDE CANNOT RUN THESE.** The auto-mode classifier blocks commands that spend
money - it let exactly one through and refused every attempt after. **Do not try
to work around it.** Ask Paul to paste them and paste the output back; Claude can
then read `out/jobs/` and the manifests directly.

**Do not run five stills on any model before all three have been tried once.**

`config/pricing.json` now carries all three candidates. Only seedream has any
published figure (~$0.04/edit, **a marketing page, never invoiced**); the other
two are labelled as placeholders with no vendor quote read. **Every `_comment` in
that file must contain the literal word ESTIMATE** - `provider-contract.test.js`
enforces it, and it caught these three entries on the first try.

### 9. PAUL'S PRODUCT DIRECTION, restated 2026-08-23 - THE STILL IS INTERNAL

Paul described the flow he wants, and it is not what the app does today:

> **upload a photo, choose an outfit, choose a location (a scrollable list of
> defaults OR describe your own), choose the frame (4:3 / 9:16 / 16:9), get the
> tape.**

**No still picker. Four choices, then a video.** His words: *"I don't understand
why are you generating the pictures"* - the still is plumbing and the user should
never meet it.

**THE STILL CANNOT BE DELETED, ONLY HIDDEN.** Seedance 2.0 is image-to-video: it
animates a starting frame and cannot take "a face plus the word garden". What is
a genuine choice is whether the user ever sees it.

**What to change once identity is solved, and NOT before:** the app page's
*"How many looks to choose from - 1/3/5"* control (`stillCount`) comes out,
stills is forced to 1, and select auto-continues.

**The cost of hiding it, stated once so the decision is informed:** a bad
likeness currently costs **$0.05** and the user sees it before paying. Hidden,
the same failure ships a finished tape at **$1.51** (480p) or **$4.54** (720p),
and that customer wants a refund. **This is not an argument against Paul's design
- simplicity IS the product and he has been consistent about that from the start.
It is the reason the likeness must be reliable BEFORE the gate is hidden.**
Order matters: solve identity, then hide everything.

If all three candidates fail there is a real alternative:
`bytedance/seedance-2.0/reference-to-video` (verified, **not wired in**) takes up
to 9 references and could take the face directly, deleting the still stage
outright. Its own entry warns **a yes is not automatically good news** - it also
deletes the cheap rejection gate.

### 10. THE EIGHT PLACE PHOTOGRAPHS - DONE 2026-08-23

`assets/places/` is **no longer empty** and the eight 404s are gone. Paul
generated all eight in **Higgsfield Soul Cinema** (his choice - tested, and free
to him); Claude wrote the prompts from each preset's own scene/light/eraProps
fields. Period-accurate, **no people**, and deliberately **no VHS/grain
/"nostalgic"** in the prompts - era comes from named props and the tape look is
ffmpeg's job.

**THE LICENCE QUESTION IS ANSWERED, 2026-08-24, and the old ruling was right
about a different thing.** Section 10 asked whether eight static assets, shipped
in a commercial product and committed to a public repo, are covered. Read on
Higgsfield's own pages -- the Terms of Use Agreement and the help-centre article
"Who Owns Your Higgsfield Generations", last updated 3 August 2026:

- Higgsfield **"does not claim ownership of any of your Inputs or Outputs"**
  and **"nor does it restrict your commercial use of Outputs"**.
- **"The Terms of Use do not tie commercial use rights to a specific plan"**,
  and there is **"no separate commercial license to purchase"**. That retires
  the "consumer creator subscription" half of the old ruling outright.
- **"You may transfer or sublicense your rights in Outputs to your clients or
  other third parties"**, and those rights **"survive cancellation of your
  subscription or deletion or termination of your Account"**.

**WHAT IS FORBIDDEN IS THE SERVICE, NOT THE OUTPUT**, and that is the line the
old ruling was reaching for without the words: you may not "license, resell,
rent, transfer, assign, reproduce, distribute, host, or otherwise commercially
exploit the Service", and you may not "act as a pass-through or service bureau".
**That is per-user generation to a description -- a customer types a place and
Higgsfield renders it -- and it stays forbidden.** It is why the provider is
fal.ai and that decision does not move. Eight photographs Paul generated once
and committed are Outputs, and Outputs are his.

**CHECKED IN THE CODE RATHER THAN ASSUMED: the shipped place photographs never
reach a model.** `assets/places/<id>.jpg` is served by `server.mjs` as the
placecard thumbnail and the background layer and nothing else; the `placePhoto`
that becomes @Image2 in a reference prompt is always the USER's upload
(`input/upload-place`). That matters because the terms also forbid using
outputs "to train, fine-tune, or improve any AI or machine-learning model" --
inference is not training, but the question does not even arise here.

**WHAT IS STILL PAUL'S CALL, and it is not a licence question.** A public repo
means anyone can take the eight files. That is a business decision about giving
away assets, not a permission problem. **And the ruling rests on a document
that changes** -- Higgsfield updated these terms recently -- so the sensible
hygiene is to keep a dated note of what they said when the decision was made,
which is what the quotes above are. **None of this is legal advice; it is what
the published terms say, read on 2026-08-24.**

**THE CARDS ARE NOW 16:9 AND THAT IS LOAD-BEARING.** One file is BOTH the
`.placecard` thumbnail AND the full-bleed `.bg--<id>` layer, both `cover`. The
card was 11x14rem - portrait - against 16:9 photographs, so it threw away about
**two thirds of the width**: measured, the Autobahn card lost its striped kiosk
entirely and kept an empty picnic table, and the balcony lost the washing line
that is the whole subject. Now `17rem x 9.5rem`, i.e. 272x152 against a 2048x1152
source - **a 0.6% crop instead of 65%**. **If these ever go portrait again the
photographs must be re-shot to match - do not just change the numbers back.**

Checked and NOT a problem: the darker images carry no baked-in letterboxing. Edge
luma measures 17-19, not 0 - that is the Soul Cinema vignette, not a black bar.

### 11. THREE TESTS WERE CHANGED, and all three for a good reason

Saying this out loud rather than burying it. **None was weakened; all three were
pinning an incidental fact rather than a contract.**

- `web-api.test.js` "the step flow is three numbered steps" asserted the literal
  string `STEP 01`, which the redesign split into two elements. It now asserts
  numbering and order via `.stepno-n`, comparing against a three-element array,
  so it **cannot pass vacuously**.
- `web-api.test.js` "a missing place photograph is a 404" borrowed the repo's
  empty `assets/places/`. It now **builds its own empty `assetsRoot`** in a temp
  dir, so the same behaviour is pinned without depending on an asset being
  absent.
- `web-auth.test.js` "the assets still serve" asserted `404`; its real point is
  that the place route is **not gated behind the accounts module**. It now
  asserts **not-503** and accepts 200 or 404. A 200 proves the point better than
  the 404 ever did.

The last two went red **because the eight photographs landed** - the missing
asset they documented had been supplied.

### 12. KNOWN FLAKE, not a regression

`job-model.test.js` "a concurrent reader never sees a truncated or invalid
manifest" fails intermittently under **full-suite parallel load** on Windows with
`EPERM` from `atomicWriteJson`. **Verified 2026-08-23: passes 3/3 in isolation**,
fails perhaps 1 run in 4 under load. Nothing in the 2026-08-23 changes touches
`job.mjs`. This is the class this file already warns about - a test whose timing
margin is narrower than the machine's variance. If it goes red, re-run that file
alone before believing it.

### 13. THREE FRAME SHAPES SHIP - 4:3, 16:9, 9:16 (2026-08-24)

**The design is one constraint: every shape holds its SHORT EDGE at 576 and
varies only the long edge.** That is what keeps ONE set of filtergraph tuning
constants correct in all three -- a 14px head-switch band is 14px of a 576-high
picture whichever shape it is in -- and the short edge always scales 576 -> 1080,
so the grain is not merely similar across shapes, it is arithmetically identical.

| Shape | Tape raster | SAR | Delivery |
|---|---|---|---|
| 4:3 | 720x576 | 16/15 | 1080x1920, **matted, UNCHANGED** |
| 16:9 | 1024x576 | 1:1 | 1920x1080 full-bleed |
| 9:16 | 576x1024 | 1:1 | 1080x1920 full-bleed |

**THE FILE IS THE SHAPE YOU CHOSE.** Paul's reasoning, and it decided the
delivery question: a 16:9 picture matted into a portrait file is useless on
YouTube, and bands are what make a reel look amateur. **4:3 is untouched** --
still matted on the dark surface, because that surround and the vignette over it
are what make the tape read as a photographed object rather than a filter.

**4:3 stays the BASE, not an entry in the `aspects` map**, so the PAL contract
cannot move while somebody adds a shape. Verified by rendering all three and
probing the files: edge luma 79-84 on the new shapes (picture) against 24 on
4:3 (surround).

~~**THE PAID PATH REFUSES THE NEW SHAPES, DELIBERATELY.**~~ **LIFTED
2026-08-29 -- SECTION 34D. THE PAID PATH DOES ALL THREE.** The refusal was
right while `fal.mjs` sent a hardcoded `aspect_ratio`: a paid 9:16 render would
have fetched a 4:3 source and built a 9:16 frame around it, with every check
downstream agreeing because they all read the same resolved config.
`falAspectFor` reads the shape off the requested raster now, so that is fixed
at the source, and what guards it is the RASTER check -- derived from
(resolution, aspect) and matched against the provider's own offers, which asks
"can you render THIS order" rather than "do you do shapes at all".

**AND THE PRICING NOTE THAT USED TO SIT HERE WAS WRONG.** It said 16:9 at
1024x576 is FEWER pixels than 4:3 at 720p -- that compares the TAPE raster
against the SOURCE raster ordered from fal, which are different things, and fal
bills the second. A label holds the SHORT edge, so a non-4:3 shape is exactly
**4/3** the pixels at the same tier and costs 4/3 as much: **28 CR at 480p, 61
at 720p**, which `creditCost` now charges.

### 14. THE MOTION PROMPT WAS REWRITTEN (2026-08-24)

Adapted from a Seedance prompt-engineering skill Paul supplied, with most of its
technical-style vocabulary REFUSED.

**The biggest win cost nothing to find: every place preset already carried a
`lens` and a `framing` clause and `composeMotionPrompt` DISCARDED BOTH.** The
still and the video were being shot on different lenses from the same preset.

- **Positive phrasing only.** "No zoom, no cut" was in the prompt text while
  ALSO in `negativePrompt` -- the same instruction on two channels, one of them
  in the form a model handles worst. Prohibitions stay on the negatives channel.
- **A collision the negatives had all along:** `MOTION_NEGATIVES` contained the
  bare word `zoom` while every lens clause describes a consumer ZOOM lens. The
  forbidden thing was always the MOVE; it now reads `the camera zooming`.
- **`CAMCORDER_MOVES` is a whitelist of five** -- drift, reframe, walk, rest,
  follow. The source library has 46; the other 41 are excluded in a comment
  saying why. Credit to https://aicameramovements.com/ is in the file.
- **63 degrees** is the 28-35mm "observational" step from the skill's own anchor
  table, which is where a consumer camcorder sat. White balance in Kelvin off
  the preset's `climate`, with a `whiteBalanceK` override.

**A TEST NOW FAILS if 8K, photoreal, film grain, cinematic, filmic, Kodak, bokeh
or anamorphic reaches the motion prompt.** Asking for those lands model grain at
1080 on top of ffmpeg grain at 576 -- two grain structures at different scales,
which is the texture people read as AI. This is the split at the top of this
file, finally enforced rather than remembered.

### 15. THE VISUAL WORLD WAS REPLACED - it is called STRUCK (2026-08-24)

**`DESIGN.md` and `PRODUCT.md` are new, in the repo, and authoritative. Read
them before touching any UI.** The frost-and-amber world is SUPERSEDED, not
polished.

**ITS ONE RULE: no borders, no rules, no dividers, anywhere.** Grouping is
depth, gauze density and space. Verified mechanically on both pages: zero
elements with a visible border. **Two exceptions are NAMED in DESIGN.md so they
cannot become drift** -- focus outlines, and the small rectangle depicting each
aspect ratio, which is a glyph and not a device for separating two things.

**ORANGE MEANS EXACTLY ONE THING: STRUCK.** It was previously labels, prices,
links, flags, the credit ring, an eyebrow and a 24px divider -- ten jobs at six
sizes, which is precisely why colour could not answer "what have I chosen?".
The old tokens now POINT AT the new values rather than being renamed across 300
rules, so there is one place a colour is decided.

Every option sits unlit at **0.5 opacity**; the chosen one burns cathode orange
and haloes. **Ghosts do NOT go dimmer than 0.5** -- the catalogued grammar wanted
far darker and that measures ~1.4:1, a control nobody can read. At 0.5 it is
4.55:1. That adaptation is permanent and is written into DESIGN.md.

**A spacing scale landed first and made the rest possible.** The page used 34
distinct rem values, 18 inside a 14.4px span, seven stepping by 0.8px. Panel
gaps ran 26/32/54 on a laptop and 18/26/26/35 on a phone; both now measure
32/32/32/48. Separation is `margin-bottom` ONLY, because margins collapse
between block siblings and do not between grid items -- the same declarations
were producing different rhythm either side of the breakpoint.

**VT323 is the display face** -- already committed and licensed, behaves like a
cathode readout when it glows, and means no network font, which the CSP and the
zero-dependency rule both require.

~~**Only the landing and app pages are converted.**~~ **SUPERSEDED 2026-08-28 —
section 31.** Every page is on `--paper` now except the landing, which is the
only page still speaking STRUCK. Login, signup, status, result and pricing came
across with the rest.

### 16. THE KEYBOARD FOCUS INDICATOR (2026-08-24)

**WCAG 2.4.7 Focus Visible is Level A and the signed-in page was failing it on
19 of its 20 hoisted radios.** `.statehook` is 1x1px with
`clip-path: inset(50%)` -- deliberate, and what keeps the CSS-only selection in
the tab order -- so the global `:focus-visible` outline matched, painted, and
was invisible. The visible control is the `<label>` further down the page, so
the indicator had to be drawn there. `presetCss` now emits one `focusRing()`
rule per catalog entry for **placecard, lookcard, qualitycard and framecard**.
`pl-own` already had one on `.linky` and was the twentieth.

**TWO RULES WERE DELETED, AND THEY WERE THE WRONG INSTINCT WRITTEN DOWN TWICE:**
`.statehook:focus-visible ~ .wrap .placecard { outline: none }` appeared at two
places in the sheet. DESIGN.md names `outline` for `:focus-visible` as the
first of exactly two permitted borders and says it is **never to be removed**.

**THE FIRST VERSION OF THE TEST PASSED WHILE THE PAGE WAS STILL BROKEN, and
that is the part worth remembering.** Asserting only that `#pl-x:focus-visible`
appeared somewhere in a focus selector went green off the LANDING page's
`.lopt--pl-x` rule -- a class that does not exist on the signed-in page at all.
The assertion now requires the rule's target class to be one the page actually
renders. **A focus test that does not tie the rule to the page it is tabbing
through is not testing anything.**

**Measured in a real browser, not asserted** -- a `focusin` probe over a real
Tab sweep of the whole signed-in page:

| | Before | After |
|---|---|---|
| Keyboard stops | 37 | 37 |
| Stops with no visible indicator | 19 | **0** |
| Ring against the ground | -- | **8.4:1** (1.4.11 asks 3:1) |

**The ring also lifts the ghost to full opacity**, because `opacity` applies to
an element's outline too -- a ring on a 0.5 ghost is drawn at half strength on
exactly the controls that most need it.

**A TRAP THIS COST TIME ON: the Browser pane reports `visibilityState: hidden`,
and a hidden tab does not tick CSS transitions.** `.lookcard` has
`transition: opacity 160ms`, so `getComputedStyle` kept returning the 0.5 the
transition started from and the fix looked broken for three rounds of
measurement. Setting `transition: none` on the element before reading resolves
the cascade instead of the animation. **Screenshots need the pane displayed;
measurement does not.**

**Also checked while in there, and it holds:** the only visibly-bordered
elements inside `.wrap` are the three `.shape` glyphs, which is DESIGN.md's
second named exception. The ten `<hr class="rule">` that used to sit in
`views.mjs` and `views-auth.mjs` are **gone**, along with the `.rule` block
that hid them. They were `display: none`, so the mechanical border check
always passed -- which is precisely what let dead markup from the superseded
world survive review, one stale comment away from being switched back on.
`test/web-static.test.js` now fails if an `<hr>` reappears in either file, and
it reads the module source rather than a rendered page so that dividers hiding
in error and notice branches are covered too.

### 17. THE AI-SLOP FIX (2026-08-24) - and where the slop actually lived

**Paul said the still looked like him AND still read as AI generated. Those are
two different problems and only one of them was ffmpeg's.**

**THE DIAGNOSIS COST NOTHING AND SHOULD ALWAYS BE RUN FIRST.** The still was
looped to 375 frames and pushed through the real tape chain with `npm run look`
-- no new generation, no money. Every TEXTURE tell died in the grade: waxy skin,
hyper-detail on the hose reel and the chain-link, lifted shadows, clinical
sharpness. **That half of the architecture works.** What came out the other side
was: dead-centre symmetry, a posed stance with nothing happening, golden-hour
hero light through the hedge, and a too-clean tableau.

**ALL FOUR ARE COMPOSITION, AND COMPOSITION IS CONTENT.** Grain does not move a
subject off the centre line. So the fix is the prompt, and the prompt was asking
for three of the four by name.

| Change | Where | Why |
|---|---|---|
| Framing moved to **third** | `composeStillPrompt` | It sat FIFTH and seedream ignored it outright. `composeMotionPrompt` already carried this exact ruling in a comment. Second time paid for. |
| **`Moment:` clause**, optional per place | `prompt.mjs` + schema + all 8 presets | A brief with no action is a portrait brief, and the model answers it with a portrait. `DEFAULT_MOMENT` is the floor; a place may author its own. |
| **Snapshot rule** rides with framing | `prompt.mjs` | "Set off centre, not quite level." Centring is the tell no amount of grain removes. |
| **`STILL_NEGATIVES`** | `prompt.mjs` | centred / symmetrical / posed portrait / staged tableau / stock photo. BASE_NEGATIVES guarded the period and the anatomy and said nothing about staging. |
| **"deep focus" deleted everywhere** | 2 presets, `_template`, both `local.mjs` fallbacks | **The single biggest AI-image tell, and it was house vocabulary.** A frame where the near table and the far shed are equally sharp is not a photograph. |

**THE CATALOG ALREADY KNEW BETTER IN THREE PLACES** -- "the far balconies
falling slightly out of focus", "the counter behind going soft",
`LENS_OVERRIDES.close`. The fix made that the only phrasing rather than
inventing a new one. Note `soft focus`, `blurry` and `bokeh` are all BANNED look
vocabulary, so falloff has to be described without naming it.

**A COINCIDENCE WORTH KNOWING: `schrebergarten-august` was one of the two worst
presets in the catalog on this axis** -- it had "deep focus ... all the way to
the shed" AND a framing clause with no action in it. `balkon-waesche` and
`kuechentisch-fruehstueck` already had candid framing. **Some of what Paul saw
is preset-specific, not systemic**, so do not read the re-run as a verdict on
all eight.

**NOT CHANGED, DELIBERATELY: the light.** The golden-hour hero light is
per-preset prose across eight files and it is third-order next to framing and
focus. Rewriting the catalog's lighting on a hunch, in the same change as four
other levers, would make the re-run unreadable. **If slop survives this fix, the
light is the next lever.**

**THE RE-RUN IS NOT SEED-MATCHED.** `deriveSeed(jobId, ...)` takes the job id, so
a new job is a new seed and there is no `--seed` flag. Same model, same place,
same outfit, different noise. **It is a prompt comparison, not a controlled
single-variable test**, and a difference could be the seed.

```
node --env-file-if-exists=.env scripts/render/render.mjs --photo=assets/test-photos/face.jpg --place=schrebergarten-august --outfit=trainingsjacke --consent --provider=fal --still-model=fal-ai/bytedance/seedream/v4.5/edit --allow-unverified-model --stills=1 --stop-after=select
```

### 18. DIRECT MODE -- THE STILL IS GONE, NOT HIDDEN (2026-08-24)

**Paul, for the third time and then a fourth: "I don't understand why are you
generating the pictures."** Upload a photo, pick an outfit, a place and a frame
shape, get a tape. Section 9 recorded this as "the still cannot be deleted, only
hidden" and that was WRONG -- it was true of `image-to-video` and of nothing
else. `bytedance/seedance-2.0/reference-to-video` was **verified on 2026-08-20,
recorded in config/models.json, and never wired in.** It takes the photographs.

```bash
node --env-file-if-exists=.env scripts/render/render.mjs --photo=assets/test-photos/face.jpg --place=schrebergarten-august --outfit=trainingsjacke --consent --provider=fal --direct --video-model=bytedance/seedance-2.0/reference-to-video
```

**`--dry-run` on that command works today and charges nothing.**

| Piece | Where |
|---|---|
| `falReferenceVideoBody` | `image_urls`, never `image_url`; `referencesParam` per model, same lesson as BUG 3 |
| `composeReferencePrompt` | @Image1 = face, @Image2 = uploaded place. Carries every ruling the other two prompts paid for |
| `assertVideoRequest` | **exactly one** of `imagePath` / `references`, never both |
| `SKIP_CHECKS.still` / `.select` | `skipped`, which is not `done` -- the ledger can tell the difference |
| `input.direct` | on the INPUT, because the manifest is the only channel to the worker |
| `estimateJob` | no still line at `stillCount: 0`, so a direct render is not over-quoted |

**DIRECT MODE IS ONE CALL OR IT IS REFUSED, and that guard is the point rather
than a detail.** On the still path a chain is continuous -- segment N+1 starts on
segment N's last frame. On this path there is no frame to continue from, so a
second segment would be an INDEPENDENT generation from the same photographs,
joined by a jump cut between takes that never shared a frame. That is exactly
what Paul described not wanting. `stepCompose` throws `DIRECT_NEEDS_ONE_CALL`
naming both numbers.

**A CONSEQUENCE WORTH KNOWING: `--provider=fixture --direct` REFUSES.** The
fixture caps at 8s deliberately -- its own comment says a fixture claiming 15
would let the pipeline skip segment chaining -- so 15s needs two calls and the
guard fires. **Direct mode cannot be smoke-tested for free through the fixture.**
It is covered end to end by `test/pipeline.test.js` against a 15s fake, and the
first real proof has to be a paid call. Do not "fix" this by raising the
fixture's cap; that trades a real guard for a convenience.

**IT RAN, END TO END, 2026-08-24. Job `20260824-122201-af8b0d`, ~$4.54
estimated, not metered.** Photograph in, finished tape out, and the still stage
never happened: steps 5 and 6 both printed `skipped`. **375 frames, 15s,
-27.4 LUFS, every contract assertion green.** The direct path is real.

**@Image1 DOES CARRY A FACE.** The open question in `config/models.json` since
2026-08-20 has an answer: the beard, the curls and the features arrive, and the
person in the clip is recognisably the person in the earlier seedream still. The
Moment clause landed too -- he reaches across for the bottle, then turns back.
**Paul's own verdict on THIS clip is still owed; the observation above is about
the image, not a judgement of resemblance, and only he can make that call.**

**WHAT THE MODEL ACTUALLY RETURNED: 752x560 at 24fps, 361 frames, 15.04s.**
- The **raster is not honoured**, exactly as on the still endpoint: 640x480 was
  ordered. 752x560 is also 47:35, marginally wider than 4:3. Harmless -- the
  tape stage scales -- but the price may be quoted for a different size.
- **24fps, where the whole contract is 25.** ffmpeg retimes it; nothing is lost.

**A FALSE WARNING THAT WAS WORTH FIXING PROPERLY.** `assemble` compared frame
COUNT against 375 and announced *"the tape stage will loop the source to reach
15s and the repeat may be visible"*. **Untrue here**: 15.04s is MORE than fifteen
seconds of material, and the delivered tape ends on the last frame of the action
-- checked frame by frame on the file, not assumed. The check now asks whether
there is enough TIME to fill the contract (`assembleFrameWarnings`, exported and
tested), so a frame-rate difference is silent while a genuinely short source
still warns about the loop by name. **A warning that cries wolf is how the real
one stops being read**, and the real one matters because `-stream_loop -1` does
repeat a short source visibly.

**TWO BUGS PAUL'S FIRST REAL RUN FOUND, both at compose, neither billed:**

1. **`stepCompose` held the STILL model to `verified: true` unconditionally**,
   so a direct job died naming `fal/UNVERIFIED-identity-still` -- an entry that
   is unverified ON PURPOSE so an unconfigured fal render stops before it
   spends. The gate is right; it was being asked about a stage that no longer
   runs. **The test suite missed it because the harness maps `defaults.fake` to
   the FIXTURE defaults, whose still model IS verified.** There is now a test
   that points it at the real unverified entry, and a second one asserting the
   ordinary path still refuses -- the fix must not become a hole in the guard.
2. **`videoModelOverride` was never threaded into `runPipeline`.** The provider
   was built with the override and the manifest froze the DEFAULT, so it would
   have recorded image-to-video while calling reference-to-video. Same reasoning
   the still override already carried; the video half simply never got it.

**`--stop-after=compose` PROVES THE WHOLE FREE HALF FOR $0** and is the right
check before any direct run: it writes a manifest showing `direct: true`, the
frozen video model, `1 segment = 15s`, an estimate carrying only an `animate`
line, `stillPrompt: null` and a `referencePrompt`. Verified 2026-08-24.

**WHAT THIS COSTS, AND IT IS THE WHOLE RISK.** The still was also the cheap
rejection gate: a likeness that missed cost **$0.04** and the user saw it before
paying. Here the same miss costs a whole video -- **~$4.54 estimated at the flat
per-second rate**, which is itself derived from a 720p figure nobody has ever
been invoiced for. The trade was put to Paul four times and taken four times.
**It is a product decision, not an oversight, and section 9's cost analysis
still stands: solve identity first, then hide everything.** Identity IS solved
as of this morning -- seedream held the likeness -- but on the STILL endpoint,
and `config/models.json` still carries the open question in its own words:

> "Does @Image1 hold a FACE as well as image-to-video holds a start frame? ...
> a yes is not automatically good news."

**That question is unanswered and only a paid call answers it.** The old path is
untouched and still the default precisely because of that.

~~**ASPECT RATIOS: THE ENDPOINT SAYS YES, WE STILL SAY NO (checked
2026-08-24).**~~ **WE SAY YES TOO, AS OF 2026-08-29 — SECTION 34D.** Both of
fal's pages give the same enum for `aspect_ratio` — `auto, 21:9, 16:9, 4:3,
1:1, 3:4, 9:16` — on reference-to-video and on image-to-video, so 16:9 and 9:16
are ORDERED natively rather than cropped. `config/models.json` now records all
three, because that field says what the PRODUCT offers and the product offers
three.

**What it actually cost, since this paragraph used to warn nobody should start
it thinking it was a config edit — it was not, and it was FIVE places rather
than the four listed here.** `animate/plan.mjs` gained the shape dimension
(a label names the SHORT edge); `fal.mjs` derives the cross product and
`falAspectFor` puts the ordered shape on the wire; `resolveRaster` stopped
refusing and checks the derived raster instead; `creditCost` charges for the
shape; and **the fifth, which this list missed: `contract.mjs` ASSERTED 4:3 on
every offered raster**, on a premise that died when section 13 gave each shape
its own tape frame.

**AND THE PRICING CLAIM HERE WAS WRONG IN THE DANGEROUS DIRECTION.** It said
16:9 at 1024x576 is fewer pixels than 4:3 at 720p; that compares the TAPE
raster against the SOURCE raster ordered from fal, which are different things,
and fal bills the second. Holding the short edge, a non-4:3 shape is **exactly
4/3 the pixels** and costs 4/3 as much — so lifting this without pricing it
would have sold every wide tape a third below cost, which is the 480p mistake
repeating. **28 CR at 480p and 61 at 720p**, Paul's call.

**The harder half is not the enum, and as of 2026-08-24 it has a price.** This
endpoint ordered at 640x480 and returned **752x560** — a size nobody asked for,
**and fal bills the size it sends**: 37.5% more than the 480p tier implies, on
every direct render. Section 22. `resolveRaster` refuses a
non-default shape on a paid provider precisely because a render that delivers
something other than what was ordered is invisible to the customer AND the
ledger; a model that picks its own raster is that failure already, and whoever
lifts the guard has to say what the tape stage does with it.

### 19. THE VLOG REWRITE (2026-08-24) -- the direct tape has beats now

**Paul watched the first direct tape and diagnosed it exactly:** *"there is no
engagement, no enthusiasm ... the character is placing the bottle on the table,
it is taking around five to six seconds ... it should be like a vlog. If I am on
a beach it has to be running toward the streets, the beach view, and everything.
It should have some content."*

**THE PROMPT WAS ASKING FOR PRECISELY WHAT HE DID NOT WANT.** In its own words:
`It drifts a few centimetres and settles, the operator standing in one place and
breathing`, and `Nothing dramatic happens ... it simply continues for the whole
15 seconds`. The model obeyed both perfectly. **Read the prompt before blaming
the model** -- that is now the second time on this project.

**`composeReferencePrompt` IS NOW A NUMBERED SHOT LIST**, six beats for 15s off
the `seedance-prompt` skill's own 2-2.5s-per-shot table (`shotCountFor`). The
arc is the order a home recording actually goes: **arrive, look around, notice a
thing, do the thing, react, settle.** Shot 2 pans the whole place and shot 3
pushes in on a named prop -- that is "the beach view, and everything", the half
Paul said was missing. A shorter runtime drops the middle and keeps the ends.

**CUTS ARE NOW ALLOWED ON THIS PATH AND STILL FORBIDDEN ON THE OTHER**, which is
why `MOTION_NEGATIVES` was split into `CUT_NEGATIVES` + `PACE_NEGATIVES`:
- A motion SEGMENT must not cut -- it gets joined to others, and footage that
  cuts inside itself cannot be used at all.
- A direct tape is BUILT on cuts. Seedance does multi-shot inside ONE
  generation, so nothing is stitched by the pipeline and
  `DIRECT_NEEDS_ONE_CALL` is untouched. **In-camera cuts are also period-honest:
  a 2003 tape is full of them because you pressed record and stopped again.**
- Everything that was never about stillness -- slow motion, speed ramps, time
  lapse, morphing, location and wardrobe changes -- stays refused on both.

**A TEST WAS DELETED AND ANOTHER CHANGED SHAPE, both deliberately.** "the
reference prompt is one continuous take" asserted the design Paul replaced. "the
reference prompt keeps the anti-slop work" asserted a standalone `Framing:` line
before `Light:` -- correct for a single-take prompt, meaningless for a shot list
where every shot states its own size; it now asserts what it was ever really
guarding, that the frame is uncomposed and something is happening.

**TWO FALSE POSITIVES IN THE NEW TESTS, both mine, both worth knowing:** a bare
`/ARRI/` matches **carriageway** and **barrier**, which the autobahn place says
twice -- word-boundary it. And asserting a prop appears verbatim broke the
moment the shot list capitalised it to open a sentence.

**NOT CHANGED, AND THE OBVIOUS NEXT LEVER: `the camera zooming` is still a
negative.** A punch-in zoom is the most characteristic home-recording move there
is and it would add real energy. It was left alone so this run measures one
change, not two.

**THE PRODUCT IDENTITY MOVED, AND IT WAS SAID OUT LOUD BEFORE BUILDING.**
PRODUCT.md opens on "Warm, grainy, quiet" and the entire look was designed
around stillness. **A vlog is the opposite of quiet.** Paul chose it knowingly;
if the docs are not updated to match, the next person will read a product
description that no longer describes the product.

### 20. PLACE AMBIENCE (2026-08-24) -- the bed now knows where it is

**The bed was the sound of the MACHINE and nothing of the PLACE**, so a Baltic
beach and a concrete stairwell came out sounding identical: hiss plus capstan,
every time. Paul asked for sound "according to the video".

**`audio.ambience` is a fourth layer, SILENT BY DEFAULT.** `amplitude: 0` emits
no chain at all, so a job with no place override is bit-identical to the bed
before this existed -- which is what keeps the still path and every existing
calibration untouched. All eight places set their own in
`lookOverride.audio.ambience`.

**One vocabulary covers the whole catalog: filtered noise, optionally swelling,
optionally in a room.** Surf and wind are a slow swell over brown noise; traffic
is the same without the swell; a swimming hall or a stairwell is the same again
with `aecho` on it. **Synthesised, for the reasons the module header already
gives for the hiss** -- no sample means no licence and no normalisation pass,
because a generator's loudness is known before it renders.

**MEASURED, NOT ASSUMED. Every place, ebur128, integrated:**

| | LUFS | | LUFS |
|---|---|---|---|
| (no place, before) | -27.2 | Autobahn | **-26.4** |
| Beach | -26.7 | Living room | -26.9 |
| Balcony / pool / stairwell | -27.0 | Kitchen / allotment | -27.1 |

Target -27, tolerance 2. **The loudest place moves the bed 0.8 dB.** The place
is felt rather than heard, which is the level Paul chose.

**THE SEED IS `audioSeed + 1`, AND THAT IS NOT COSMETIC.** Two `anoisesrc` on
one seed emit IDENTICAL noise; summing that is not two layers, it is one layer
6 dB louder and perfectly correlated. It would sound exactly like the hiss being
turned up, and nothing in the graph would look wrong. There is a test.

**A REAL BUG THIS EXPOSED, one level down from where anyone was looking.**
`withoutDocs` in `expand/local.mjs` strips a borrowed preset's `_comment` so a
manifest cannot quote an argument about a different scene -- **and it filtered
the TOP LEVEL ONLY.** That was sufficient while every lookOverride was two deep
(`grade.saturation`); ambience is three (`audio.ambience._comment`), so a typed
place could have carried "motorway rumble from behind the kiosk" into a scene
with no kiosk in it. Now recursive, with a test that walks every depth. **The
same two-level assumption was in `test/pipeline.test.js`'s frozen-look check**,
where it compared an object against an object by identity and failed for the
wrong reason.

**NOT DONE, and both want a TONE rather than noise:** the fluorescent buzz the
stairwell preset names, and the kitchen clock tick. This layer only makes noise;
the capstan already proves tones work, so it is a small extension rather than a
new idea. **Also not done: audible cuts.** Now the vlog has six shots, a real
recording's sound would JUMP at each one -- the strongest remaining authenticity
detail, and it needs shot-boundary detection on the finished clip.

### 21. `npm run ledger` EXISTS (2026-08-24) -- and what was missing was not the report

`package.json` has pointed a `ledger` script at `scripts/render/ledger-cli.mjs`
since before there was a file there, so the command failed with
MODULE_NOT_FOUND. `pricing.mjs` already carried `divergence`, `diverges` and the
15% limit, and the doc comment on `diverges` said in as many words *"true when
`npm run ledger` should name this one"*. All of it was written against a command
nobody had built.

**THE READ-ONLY HALF WOULD HAVE BEEN USELESS ON ITS OWN.** `cost.actual` is
`null` on every job ever run, because nothing writes it -- fal's queue response
carries no price, and `fal.mjs` says so: *"actual: null means NOT METERED YET"*.
A report over that prints "not metered" once per job forever. So the command has
two halves and `record` is the one that matters:

```bash
npm run ledger                                                  # the report
npm run ledger -- record 20260824-122201-af8b0d --actual=1.51   # the invoice
```

**Today it prints five jobs, $9.2110 estimated, nothing metered.** Record one
number and the next run says, for that model, the implied per-unit rate against
the configured one -- e.g. `$0.1007/second against $0.3027/second` -- and names
the `config/pricing.json` line to change.

**IT DOES NOT EDIT `config/pricing.json`, DELIBERATELY.** Every entry there
carries a `_comment` saying where the number came from and the literal word
ESTIMATE, which `provider-contract.test.js` enforces. A script rewriting those
would erase the provenance that makes the file worth reading, and could turn an
ESTIMATE into an unmarked fact. It prints the edit; a human makes it.

**THREE REFUSALS, EACH FOR A REASON THIS REPO ALREADY HELD:**
- **`--actual=0` is refused** unless `--actually-zero` is passed. `null` means
  not metered and `0` means free; `contract.mjs` already refuses a zero-by-
  accident for the same reason. A mistyped empty argument must not prove that
  fal gives videos away.
- **A job billed for more than one step demands `--step=`.** Guessing would put
  a video's price on a still, and the per-model rollup -- the entire point --
  would be wrong in a way no total could reveal.
- **An already-recorded number needs `--force`**, and both numbers are printed.
  A metered figure is evidence somebody paid to obtain it.

**`meterStep(job, name, actual)` IS NEW IN `job.mjs` AND IT DOES NOT MOVE THE
STEP.** `finishStep` is the only other way to price a step and it is a
`running -> done` transition; metering happens days later on a step that is
already `done`. Routing it through `finishStep` would have meant relaxing the
transition table for a bookkeeping entry, and that table is what stops a resume
becoming a second bill. It refuses `pending` and `skipped` -- a skipped step
produced nothing and cost nothing -- and allows `failed`, because a request that
went out and never came back is billable, which is why `recordIntent` exists.

**A BUG THE TESTS MISSED AND RUNNING IT FOUND IN ONE LOOK.** The first version
selected rows by "has an actual recorded". The fixture provider returns
`actual: 0` honestly -- a local ffmpeg call IS free -- so the first real run
printed **twelve fixture jobs above the five that cost money and announced "12
metered"** when nobody had metered anything. The rule is now "a non-zero
estimate, or a non-zero charge", which still keeps the most interesting line the
report could print: $4.54 expected, $0 actually billed. **There is a test for
each half.** Run the thing you built against real data before believing the
green.

### 22. THE FIRST METERED RUN (2026-08-24) -- fal bills tokens, and it bills what it SENDS

**Read off fal's own usage page, recorded with `npm run ledger -- record`, and
the ledger totals $4.3369 against fal's $4.34.** Five jobs, three endpoints.

| Endpoint | fal charged | Estimate said | Verdict |
|---|---|---|---|
| `bytedance/seedance-2.0/reference-to-video` | **$4.156908** / 296.92k tokens (2 jobs) | $9.081 | **2.18x too high** |
| `fal-ai/uso` | **$0.10** / 1.00 Megapixel | $0.05 | **half the real price** |
| `fal-ai/bytedance/seedream/v4.5/edit` | **$0.08** / 2.00 Images | $0.08 | **exactly right** |

**THE FORMULA WAS NEVER WRONG. THE FLATTENING OF IT WAS.** `config/credits.json`
already recorded fal's token formula -- `tokens = w * h * seconds * 24 / 1024`
at `$0.014` per 1000 -- and it reproduces the invoice to **seven figures**:
two clips at 752x560 x 15.04s come to 296.92k tokens and **$4.156915** against
fal's **$4.156908**. What was wrong is that `config/pricing.json` has no token
dimension, so somebody wrote the 720p per-second rate into it. **A 15-second
video costs $2.08, not $4.54.**

**AND THE RASTER IS NOT COSMETIC ANY MORE.** Section 18 recorded that the model
returns 752x560 when 640x480 is ordered and called it harmless because the tape
stage rescales. **It is not harmless: fal bills the raster it RETURNS.**

- ordered 640x480 x 15s = 108000 tokens = **$1.5120**
- delivered 752x560 x 15.04s = 148461 tokens = **$2.0785**
- **a 37.5% surcharge, on every direct render, for pixels nobody asked for**

That answers the open question `config/credits.json`'s 720p entry has carried
since it was written -- *"whether the provider bills the raster it returns"* --
and it makes the aspect-ratio work in item 4 worth money rather than just
worth tidiness.

**`config/credits.json` WAS NOT REPRICED, DELIBERATELY.** `estimatedUSDPer15s`
feeds `creditCost`, so changing it changes what a customer pays, and that is
Paul's decision. It is annotated instead: the 480p figure of $1.51 is now KNOWN
to understate real cost by about a third, which is the direction that file's own
header calls unsafe. **Either the raster gets honoured or that number goes up.**

**A GUARD LEARNED A THIRD STATE, and it had been asking for it in its own error
message.** `assertPricingTable` refused every non-zero `estimate: false` with the
words *"until a --meter run proves it"*. A run has now proved two, and an entry
forced to keep calling an invoiced number an ESTIMATE is a lie in the other
direction. The rule was never "everything is a guess", it was **"a number may
not claim to be a fact without saying why"** -- so a measured price may now set
`estimate: false` **if and only if** it carries `meteredOn` (an ISO date) and
`meteredFrom` (where it was read). Half the evidence is refused, and a date that
is not a date is refused.

**STILL UNMETERED, and do not assume these follow:** `image-to-video` has
**never been called** and keeps the suspect $0.3027/s -- probably wrong the same
way, deliberately NOT copied across, because guessing one endpoint's price from
another's invoice is how the bad number arrived. **720p has never been run at
all.** And `fal-ai/uso` bills per MEGAPIXEL with an apparent 1MP floor: the
640x480 this repo orders is ~0.31MP and was billed as 1.00.

**One receipt, $12.00 of credits bought on 2026-08-23, $4.34 spent, $7.66 left.**

### 23. THE FIVE UNCONVERTED PAGES (2026-08-24) -- measured, and the plan was half wrong

**"They clash" is not a defect anybody can fix.** The pages were rendered and
probed in a real browser instead, and the difference turned out to be mechanical:

| | landing / app (converted) | login, signup, pricing, status, result |
|---|---|---|
| `.grain` -- fractal noise, fixed, over the whole viewport | `display: none` | **live** |
| `.gauze` -- the anode mesh | present | **absent** |
| visible borders | 0 | 0, except **15 on pricing** |

**The five wore the one texture DESIGN.md bans and lacked the one it requires**,
and in both cases because the thing was a page-by-page opt-in. `.gauze` was
emitted through `preBody` by exactly two callers; `.grain` was switched off by a
rule naming exactly two pages. **Every page nobody remembered to add to those
lists came out wrong** -- a structure problem wearing a taste problem's clothes.

Both are structural now: **the grain plate is DELETED** rather than suppressed,
and **the gauze lives in `layout()`** so a new page cannot forget it. The two
literal-colour borders -- `.step` on the status page and `.plan li` on pricing,
fifteen of them -- are gone, and the lists group on space.

**THREE TESTS KEEP IT THAT WAY, and they read the RENDERED pages**: every page
the app can produce carries the gauze and none carries grain; `.grain` appears
nowhere in the sheet; and no border declaration anywhere uses a literal colour.
That last shape is the useful one -- borders written against `var(--hairline)`
are already transparent, which is how the two converted pages went borderless
without rewriting 300 rules, but a literal colour is a line no token can turn
off. `renderedPages()` is a hand-written LIST rather than a loop over exports,
because a page missing from it is invisible to all three checks, and being
invisible to the last check is exactly how five pages stayed wrong.

**TWO ITEMS OF THE PLAN WERE WITHDRAWN AFTER MEASURING, recorded so nobody
re-proposes them.** The plan said headings on those pages should take the
display face and `.eyebrow` should retire. Both came from comparing against the
LANDING page, whose `h1` is TapeOSD at 94px -- the wrong neighbour. The
signed-in app page is the one these sit beside, its own `.app-h1` is system sans
at clamp(29-40px), and it uses `.eyebrow` too. Forcing the display face onto
interior headings would have matched the hero and clashed with the neighbour,
and DESIGN.md's own rule is that **body is never uppercase**. The remaining
heading difference is 28px against 29-40px, which is not a clash.

**WHAT IS STILL WRONG, AND IT IS THE INTERESTING PART.** On `/pricing` the
current plan is marked with a **bordered pill** -- `border: 1px solid
var(--accent-deep)` on `.plan .mark`. DESIGN.md permits exactly two borders,
names both, and says any new one "must argue itself into this list or it does
not ship". This one never argued. Worse, the three plans are otherwise
**identical**: no ghost, no strike, no halo. The world's whole mechanic is
"every value present as an unlit ghost, one struck forward in glowing orange",
and the page that answers "which plan am I on?" is the one page not using it.
**That is precisely the failure the palette rule was written against** -- colour
losing the ability to answer "what have I chosen?". The fix is to strike the
current plan, ghost the others at `.5`, and delete the pill.

### 24. ONLY 480p HAD EVER BEEN ORDERED, AND NOW A TIER CAN BE (2026-08-24)

**`render.mjs` had no `--resolution` flag.** `job.input.resolution` has been
honoured by the whole pipeline since `resolveRaster` was written, the web app's
quality picker sets it, and **nothing could set it from a command line** -- so
every CLI render silently took the provider's cheapest offer. That is why the
first metered run could not answer the question that decides the price list:
**a 720p job could not be made.** The web app can order one and the web app
cannot spend (section 8).

`--resolution=480p|720p` now exists, validated against `AVAILABLE_RESOLUTIONS`
so a typo costs a line rather than a render. It is left `null` when omitted
rather than defaulted to 480p, because null already means something here -- "no
order behind this render" -- and `resolveRaster` prints a different line for it.

**A JOB IS PARKED AND UNPAID AT `20260824-225641-f34b4f`.** Every free step ran;
`--stop-after=compose` stopped it before the money. It froze
`720p -> 960x720 (4:3)`, one 15s segment, reference-to-video. Resume it and the
only remaining step is the paid one:

```bash
npm run render -- --resume=20260824-225641-f34b4f
```

**WHAT THAT RUN ANSWERS, and it is the whole price list.** Both metered jobs
ordered 480p and were delivered 752x560. If a 720p order also comes back
752x560, then **480p and 720p are the same product** and a customer paying 46 CR
receives the identical file as one paying 16 CR. The forecast if the raster IS
honoured is 243000 tokens, **$3.40**. The 480p order delivered 148461 tokens,
$2.08. Those two numbers being equal is the finding.

**A DEFECT THE DRY RUN EXPOSED AND THIS DID NOT FIX.** `--dry-run` quotes the
**identical $2.079 at both tiers**. Section 22 corrected the RATE in
config/pricing.json; it did not give that table a resolution dimension, and
`estimateVideo` still prices per second and nothing else. So the command whose
entire job is authorising a spend cannot tell a 480p order from a 720p one --
and by the formula those differ by 2.25x. **The real fix is to price video by
the token formula rather than per second**, since fal bills tokens and
config/credits.json already carries the formula and it is confirmed correct to
seven figures. Not done; it changes `estimateVideo`'s signature and every
caller.

---

### 25. THE CHECKOUT AND THE WEBHOOK (2026-08-25) — money can be taken, and is not

**§5 and §6 of the credit-packs spec are built.** Four new files, two new routes,
59 new tests, and **zero npm dependencies** — Stripe's API is form-encoded HTTPS
and its signatures are HMAC-SHA256, so `fetch` and `node:crypto` are the whole
client.

```
scripts/billing/stripe.mjs   the protocol: one POST, one signature verifier
scripts/billing/packs.mjs    what is for sale, resolved from config/credits.json
scripts/billing/billing.mjs  the seam: where the transport and the secrets go in
config/credits.json          a new `packs` block -- $10, 40 CR, stripePriceId null
```

**NOTHING CAN BE BOUGHT TODAY AND THAT IS DELIBERATE.** `stripePriceId` is
`null`, so the button on `/pricing` renders disabled and `POST
/api/billing/checkout` answers **503 CHECKOUT_NOT_OPEN** without attempting a
call. A Stripe Price is immutable — creating the wrong one costs a new Price —
so it is the last thing to exist, gated on §7: meter the parked 720p job, fix the
estimator, run the blind check.

#### The five properties worth not breaking

1. **The browser sends a pack id and nothing else.** No amount, no currency, no
   credit count, and no `price_data` in the request to Stripe — the Price
   object is the only thing that sets what is charged. A test posts
   `credits=99999&amount=1&priceUSD=0.01` and asserts none of it reaches Stripe.
2. **The webhook reads RAW BYTES.** `server.mjs` now has `readRawBody` as the
   primitive and `readBody` as a `toString('utf8')` wrapper over it, rather
   than the other way round. **The test that matters signs one byte sequence and
   sends a different one that parses to the same object**; it passes only
   because the handler hashed what arrived on the socket.
3. **The event id is the ledger's `ref`.** A redelivery finds it and is a no-op.
   Asserted against the REAL on-disk ledger — a fake that dedupes correctly
   would only prove the fake dedupes correctly — on the row count as well as the
   balance, because a compensating pair of rows leaves a balance right and an
   audit log lying.
4. **The status code is a message to Stripe and to nobody else.** 2xx means
   "stop retrying". So an event this product ignores gets a **200**, and a
   payment that could not be credited — no such account, no way to price it —
   gets a **5xx**, which keeps it in the retry queue and then on the
   failed-events list where a person can find it. A 200 on a payment we failed
   to credit is money taken with the evidence thrown away.
5. **The secret key goes to `api.stripe.com` and there is no parameter that
   moves it.** That is finding F3 of the security review — `FAL_KEY` going to
   every host on an allow-list — fixed in advance rather than repeated. A test
   passes `baseUrl` and `apiBase` anyway and asserts they do nothing.

#### Three things that will bite

- **`form-action 'self'` blocks the redirect, not the form.** The buy button
  posts same-origin and the handler 303s to `checkout.stripe.com`; Chrome
  checks a form submission's REDIRECT target against `form-action`, so without
  `https://checkout.stripe.com` in the directive the button silently does
  nothing and there is no error anywhere. It is in the CSP in `sendHtml`.
- **A new account is not empty.** `createAccount` grants the free plan's period
  credits at signup, so any test asserting an absolute balance after a webhook
  is really asserting the signup grant. Assert the DELTA, and filter the ledger
  to rows carrying a `ref` — payments have one and the signup grant does not.
- **`npm run web` now loads `.env`.** It has to, because that is where the two
  Stripe secrets live. `npm test` is still a bare `node --test` and still does
  not, which is guard 3 — and the server's billing seam is defaulted to one with
  **no transport and no credentials**, so a test that somehow reached checkout
  gets a `TypeError` rather than a bill. That is a fifth guard and it is
  structural.

#### What was deliberately NOT changed, and why each is a decision

- **The tape price.** §2.1 wants 21 CR at 480p against today's 16; editing
  `estimatedUSDPer15s` changes what a customer is charged and the config file
  says in its own words that this is Paul's call. So **40 CR buys two 480p tapes
  today and the spec sizes it at one** — safe, because nothing can be sold, and
  written into the pack's `_comment` because the two numbers have to move in the
  same edit.
- **`grant.expiryDays` is still `null`.** §2.4 recommends 365 and §9 lists it as
  open. Setting it today would show customers an expiry date that **no code
  enforces** — nothing writes the negative ledger row that would realise it —
  and a date the system does not honour is worse than no date.
- **The free tape.** §3 in full, ceiling included. Not touched; item 9 above.
- **The pricing page's visual grammar.** Item 3 of PICK UP HERE says DESIGN.md
  gets rewritten first and the pages follow. The pack card reuses the existing
  `.panel`/`.plan`/`.record` classes and adds no CSS, so it moves with whatever
  replaces STRUCK instead of having to be undone.

#### Proving it without a public url

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
stripe trigger checkout.session.completed
```

The Stripe CLI (v1.50.0, already installed) delivers genuinely-signed events to
a local server, so **the entire payment path can be proven before any public URL
exists.** Only going live needs the deployed endpoint. Note that a `stripe
trigger` event carries no `client_reference_id`, so it will land as a 500
`NO_ACCOUNT_ON_SESSION` — which is the correct behaviour and is what that test
asserts; a real purchase carries one.

---

### 26. THE 720p TIER IS REAL, AND THREE THINGS WERE NOT HANDED ON (2026-08-25)

**The parked job ran. 960x720 ordered, 1112x834 delivered.** That was the
question that decided the price list and the answer is the good one.

| tier | ordered | delivered | tokens | cost | CR @ $0.10 |
|---|---|---|---|---|---|
| 480p (x2 jobs) | 640x480 | **752x560** | 148,050 | **$2.0727** | 21 |
| 720p | 960x720 | **1112x834** | 326,042 | **$4.5646** | 46 |
| 1080p | — | never run | — | ~$10.27? | ~103? |

**720p IS 2.20x THE PIXELS OF 480p.** Had it come back 752x560 there would have
been one product and not two, and selling a tier would have been a claim on a
public page that is not true. It can be sold. **Paul watched it and the likeness
held** — see The one thing to know.

#### Four findings from one measurement

1. **480p WAS BEING SOLD BELOW COST.** $1.51 was the formula applied to the
   raster we ASK for, and fal has never once delivered the raster it was asked
   for. Real cost $2.0727, so **16 CR -> 21 CR**. Every 480p tape sold before
   this lost 5 CR of cost basis.
2. **720p WAS RIGHT BY ACCIDENT.** $4.54 came from 1280x720 — a 16:9 frame this
   product never orders and fal has never sent — and landed within three cents
   of the truth because two errors cancelled. **The spec's §2.1 wanted to LOWER
   it to 35 CR** against a $3.40 forecast that assumed the raster was honoured.
   Following the spec would have sold every 720p tape below cost. The gate held.
3. **THE RATIO WAS WRONG, NOT JUST THE PRICE.** 480p was assumed to be about a
   THIRD of 720p, on the stated theory that fal's fast tier is priced
   differently. Measured, it is **0.454 — the pixel ratio to three decimals.**
   fal bills tokens, tokens are pixels x seconds, and there is no separate tier
   rate. The theory was reasoned and the invoice disagrees.
4. **THE FREE PLAN HAD TO MOVE OR IT WOULD HAVE SILENTLY BROKEN.** 16 CR was
   exactly one 480p tape and now buys nothing — an account could sign up, see a
   balance and be refused at the button. It is **42: two 480p tapes**, at Paul's
   direction, and still short of a 720p one. That is **$4.15 of provider spend
   per signup** against no revenue, and **the global ceiling §3 asks for still
   does not exist.**

**AND THE $10 PACK CANNOT BUY A 720p TAPE.** 40 CR against 46. A customer buying
one pack gets 480p only. That may be the ladder Paul wants; it is a product
decision that only became visible once the tiers were measured.

#### THREE PASS-THROUGH DEFECTS IN ONE MORNING, and they are one bug wearing three hats

Every one is **a value that exists, is correct, and is simply not handed on** —
and no unit test of the function that RECEIVES it can see the call site that
forgot to pass it.

| What was dropped | Where | What it did |
|---|---|---|
| `provider` | `--resume` | Resumed a `fal` job against `fixture`; the capability error was recorded as a real step failure, so **a job parked for a metered run was marked `failed` by a command meant to cost nothing** |
| `--video-model` | `--resume` | Built a reference-to-video BODY (`image_urls`) and posted it to the image-to-video ENDPOINT (`image_url`). **fal answered 422** |
| `--resolution` | `--dry-run` | Priced **every tier as 480p**. `dryRun()` had read `input.resolution` correctly the whole time |

**NOTHING WAS CHARGED, BY LUCK.** The 422 happened because the two shapes were
incompatible. **Had they agreed, the resume would have rendered with a model the
manifest does not name, billed for it, and left the frozen block lying** — which
is exactly the reproducibility that block exists to guarantee.

**AND A FOURTH, WHICH IS THE ONE THAT NEARLY COST MONEY: `--dry-run` WAS
IGNORED ENTIRELY ON A RESUME.** The `--resume` branch returns before the dry-run
branch is ever reached, so the flag whose whole promise is *charges nothing* ran
the job for real. It was caught only because the provider had ALSO defaulted
wrong and died on a capability check first. **With `--provider=fal` typed on
that same line — which is the correct command for the job — it would have been a
paid call made by somebody who believed they were pricing it.**

**THE FIX: the manifest wins, and a command line that CONTRADICTS it is refused
by name.** `scripts/render/resume.mjs`, nine tests. Agreeing stays legal — naming
the model a job already froze is how the metered run was finally made. A job that
froze nothing falls back to the CLI and then to `fixture`, **never to a paid
provider.**

```
20260824-225641-f34b4f froze video model "…/reference-to-video" and the command
line asks for "…/image-to-video". A resumed render must be the render the
manifest describes, or the frozen block stops meaning anything. Run it again
without the flag to use what the job froze, or start a new job if you meant a
different video model.
```

#### The estimator now prices by tokens

`unit: "token"` on reference-to-video, and `delivered` is a measured **LOOKUP
keyed by the ordered raster, not a coefficient** — the two upscales are not the
same number (1.175 x 1.167 at 480p, 1.1583 on both axes at 720p) and a single
factor cannot reproduce both. An unmetered raster is priced through
`deliveredUpscaleFallback`, the LARGEST upscale seen, because **overstating cost
understates margin and that is the safe direction.** A token-billed model
**refuses to quote without a raster** rather than falling back to a per-second
guess — that fallback is precisely the flattening being removed.

**config/pricing.json and config/credits.json now have a cross-file test.** One
prices what a render costs us, the other what a customer is charged; they are two
files answering two questions from ONE measurement, so a future metering that
corrects one and not the other goes red rather than leaving the estimator and the
invoice quietly disagreeing.

#### A defect in the tape that Paul found by watching it

**A frozen frame once per second, every second, in every tape ever made.** fal
delivers **24fps** and the contract is **25** — 361 source frames stretched to
375 duplicates 15 of them, and `ffmpeg`'s `fps` filter places them at frames 12,
37, 62, 87 … **exactly one every 25.** Periodic judder is the most visible kind,
because the eye locks onto the rhythm.

**Measured, not inferred:** `ffmpeg -vf fps=25 -f framehash` on the raw segment,
counting consecutive identical hashes. It is separate from the DELIBERATE tape
stutter at `droppedFrames: [201, 202]` — 8.04 seconds in — which is working
exactly as designed.

**fal's `duration` caps at 15**, so we cannot buy 15.625s of 24fps footage to
fill 375 frames. The three ways out are: interpolate to 25fps and let the
tapedeck add stutter where it WANTS it (the content/texture split this repo is
built on); scatter the duplicates pseudo-randomly from the job seed so the
metronome becomes tape unsteadiness; or leave it. **PAUL'S CALL, NOT TAKEN YET.**

#### Two things fal's schema told us that this repo did not know

- **The endpoint's `resolution` enum is `480p, 720p, 1080p, 4k`.** Config has
  1080p off and no 4k at all.
- **1080p's deferral is now SUSPECT.** "It buys nothing over 720p" rested on SSIM
  0.958 against a **720p source measured back when nothing could actually ORDER
  720p** — every render silently took the provider default. An ordered 720p just
  turned out to be a genuine step up. One metered 1080p run settles it, and Paul
  has said he wants to sell the tier.

---

### 27. A CARD WAS CHARGED — ~~AND THE CREDITS HAVE NOT LANDED~~ **THEY HAVE. CLOSED 2026-08-25, MIDDAY.**

**A real test-mode payment succeeded end to end on Stripe's side.** `4242` card,
`$10.00`, on the test Price created the same day. **The webhook could not
reach this machine at first**, so nothing was granted — a two-word
configuration fault, not a defect in any code this repo owns. **It is fixed
and the demo is finished; see below.**

#### ~~FINISH IT WITH THIS — DO NOT PAY AGAIN~~ **FINISHED, NO SECOND PAYMENT**

> **THIS RECORD IS HISTORY AND THE COMMANDS NO LONGER BEHAVE THIS WAY.**
> Since 2026-08-26 the webhook grants credits only on an event that says it is
> live, and `evt_1U8IWT0WJAHtsKz6p8dOUVen` is a **test-mode** event — so
> replaying it today is answered `200` with `granted: false, ignored:
> 'testmode'` and moves nothing. **That is correct and deliberate**, not a
> regression: a test card costs its holder nothing while the credits it minted
> would buy real fal renders at real cost. The path below was genuinely proven
> when it ran; what proves it now is the test suite. See §28.

Three terminals, exactly as prescribed:

```bash
stripe listen --forward-to 127.0.0.1:3000/api/stripe/webhook   # terminal 1
npm run web                                                     # terminal 2
stripe events resend evt_1U8IWT0WJAHtsKz6p8dOUVen                # terminal 3
```

The startup banner printed the correct IPv4 forward command, exactly as the
fix below intended, and `.env`'s `STRIPE_WEBHOOK_SECRET` was hash-compared
against `stripe listen --print-secret` before starting anything: match.

**First delivery: the listener logged `[200]`.** `ps6475961@gmail.com`
(`e9eb3f5999235f3a7074b01766bdb9db`) went **42 → 82 credits**, with a new
ledger row `grant:pack:starter`, `ref: evt_1U8IWT0WJAHtsKz6p8dOUVen`.
Signature verification passed against a genuinely Stripe-signed delivery —
**the inbound half this section once called unproven is now proven.**

**Second resend of the SAME event: `[200]` again, and nothing moved** — no
new row, no credit change, balance held at 82, still 2 rows. **Idempotency is
proven against real Stripe redelivery**, not a synthetic fixture, which is
the one thing the test suite could not do for itself — the guard is at
`scripts/auth/credits.mjs:515`, inside the per-account lock.

**One thing worth a sentence so nobody misreads it later:** a replay still
REWRITES the account record. `updateAccount` (`scripts/auth/accounts.mjs:936`)
bumps `rev`/`updatedAt` unconditionally even when the ledger does not change,
so the file's hash changes on a no-op resend. Harmless today — recorded so a
changed hash is never mistaken for a double grant.

```bash
npm run accounts -- ledger e9eb3f5999235f3a7074b01766bdb9db
```

#### THE BUG: this server binds IPv4 and the Stripe CLI dials IPv6

```
--> checkout.session.completed [evt_1U8IWT0WJAHtsKz6p8dOUVen]
    [ERROR] Failed to POST: dial tcp [::1]:3000: connectex:
            No connection could be made because the target machine actively refused it.
```

`server-cli.mjs` defaults to `host: '127.0.0.1'`, so `server.listen` binds **IPv4
only**. On Windows the Stripe CLI resolves `localhost` to **`::1`** and does not
fall back to IPv4. **A browser on the same machine reaches the identical URL
perfectly**, which is what makes this so confusing: the checkout page worked, the
payment worked, and only the callback silently could not connect.

**Fixed by making it impossible to guess:** when a webhook secret is configured,
the startup banner now prints the exact command using the address the process
actually bound to.

```
  forward webhooks here (IPv4, NOT localhost -- the CLI resolves that to ::1):
    stripe listen --forward-to 127.0.0.1:3000/api/stripe/webhook
```

**`TIMESTAMP_PUBLIC_URL` stays `http://localhost:3000`** and that is not a
contradiction. It is where STRIPE SENDS THE BROWSER BACK TO, and the browser must
return to the same host it signed in on or the session cookie does not travel --
`localhost` and `127.0.0.1` are different hosts to a cookie jar. So: the browser
uses `localhost`, the CLI forwards to `127.0.0.1`, and both are right.

#### WHAT THE PAYMENT PROVED, and now it is the whole path

Everything this repo puts on a Checkout Session arrived at Stripe correctly.
Read back off the live event with `stripe events retrieve`:

| field | value |
|---|---|
| `payment_status` | **paid** |
| `amount_total` | `1000` USD |
| `mode` | `payment` — one-off, not a subscription |
| `client_reference_id` | `e9eb3f5999235f3a7074b01766bdb9db` |
| `metadata` | `{accountId, credits: "40", pack: "starter"}` |
| `livemode` | **false** |

So the outbound half is proven against the real API: the key authenticates, the
Price resolves, the account id rides on `client_reference_id`, and the credit
count the customer was promised is on the session where the webhook expects it.
**The inbound half is proven too, now** -- signature verification against a
genuinely Stripe-signed delivery, and the grant landing, both confirmed by the
resend above. Checkout, webhook signature, grant, and idempotent replay: the
whole path is proven end to end.

#### Two things noticed in passing

- **`adaptive_pricing: { enabled: true }`** is on the session. That is Stripe
  showing international customers a local currency, which means `amount_total`
  is not always USD and the ledger's credit count must never be derived from it.
  It is not: the count comes from `metadata.credits`. Worth knowing before
  anybody "improves" that.
- **The free grant of 42 credits is landing.** Both accounts created today --
  `plstnly06@gmail.com` and `ps6475961@gmail.com` -- opened on exactly 42, which
  is two 480p tapes at the measured price. Signup works.

#### The setup, for whoever does this next

`.env` needs three values and **none of them has to be typed by hand.** The
Stripe CLI already holds a `sk_test_` key from `stripe login`, and
`stripe listen --print-secret` yields the signing secret, so a script can move
both into `.env` without either ever appearing on a screen. One was written to
the scratchpad on 2026-08-25; **the resolver detail worth keeping is that on
Windows the CLI is an npm shim** -- `stripe.cmd`, no `.exe` -- so
`execFileSync('stripe')` fails with `ENOENT` on a machine where typing `stripe`
works. Resolve the real file and pass `shell: true` for a `.cmd`.

~~**The test Price is `price_1U8I1t0WJAHtsKz673YZyToR` on
`prod_V8ZAgOINl0TIkL`, `livemode: false`. It must not go live** -- section 25.~~
**SUPERSEDED 2026-08-27.** That Price sold 40 credits for $10 and no rung is 40
credits any more. **The live pair, both `livemode: false`:**

| Rung | Price | Stripe Price id |
|---|---|---|
| Starter | $12 / 92 CR | `price_1U9BtZ0WJAHtsKz66FvdVNW2` |
| Standard | $19 / 138 CR | `price_1U9Bta0WJAHtsKz6vBWjZyMG` |

Both are one-time, NOT recurring: `createCheckoutSession` opens in
`mode: payment`, and a recurring Price there is refused by Stripe at the moment
a customer clicks Buy -- in front of them, not at deploy. The 40-credit object
is harmless where it is; do not reuse it, because a Price is immutable and it
names the wrong number of credits.

**THE STRIPE SANDBOX IS NOT TIMESTAMP'S OWN, AND IT MUST BE BEFORE LAUNCH.**
The account these Prices live in is shared with another product, and has been
since the first Price on 2026-08-25. This is not cosmetic and it is not a
detail: **Stripe puts the ACCOUNT's business name on the hosted checkout page**,
so the page a Timestamp customer would pay on is branded as something else
entirely. Verified by rendering it, not by reading about it.

Splitting it was attempted on 2026-08-27 and is BLOCKED upstream -- Stripe will
not create a second sandbox until the business behind the account is verified,
which is a paperwork step only the owner can do. Decision taken with the
checkout page on screen: **leave it**. It is test mode, no customer sees that
page, and verification is required before going live regardless.

**THE TRIGGER TO REVISIT IS THE FIRST REAL CUSTOMER**, and the split at that
point is bigger than it looks: a LIVE Stripe account is per-business, so it is a
separate ACCOUNT rather than merely a separate sandbox, and new live Prices have
to be created alongside it because a Price is immutable. Doing it now, in test
mode, costs minutes; doing it after launch costs a migration.

**OPEN `TIMESTAMP_PUBLIC_URL`, NOT THE BOUND ADDRESS, OR GOOGLE SIGN-IN 400s.**
`.env` sets `http://localhost:3000` while the server binds `127.0.0.1`. The
state cookie is set on whichever host the browser is on, `redirectTo` is built
from the public url, and **`localhost` and `127.0.0.1` are separate cookie
jars** -- so signing in from the bound address lands the callback with no
cookie. `oauthStateCheck` then refuses BEFORE `takeVerifier`, which means it
**logs nothing and consumes nothing**: the only trace is verifier rows piling up
in `out/oauth/`. Same two hostnames as the 2026-08-27 morning bug, opposite half
of the loop. The startup banner now prints the public url and says so.

---

## Where things stand (2026-08-20, later the same day)

**The application is built end to end and it runs.** M1 the tape look, M2 the audio bed, M3 the preset catalog, and now the whole pipeline, the queue, the worker and the web app. ~500 tests. A photograph uploaded in a browser comes back as a finished 15-second tape without anything being typed at a terminal.

Verified by running it, not by reading it: **375 frames, 15.000000s, 1080x1920, yuv420p, mono AAC, -27.4 LUFS**, and the stored copy of the photograph contains zero EXIF/GPS bytes.

```bash
npm run web                              # terminal 1
npm run worker -- --provider=fixture     # terminal 2
```

`docs/running-the-app.md` is the operator guide; `docs/interfaces.md` is the module contract everything was built against and is the file to read before changing a signature.

**What is real and what is not.** The queue, the manifest, resume, moderation, intake, expansion, the look, the contract assertions and the web app are all real. `--provider=fixture` renders genuine stills and clips through ffmpeg for $0, so the *plumbing* is proven. **It says nothing about whether a model can put a specific person in a specific place recognisably from one photograph.** That is Phase 0, it is still unanswered, and it is the only question that decides whether this is a product. Keep the two claims apart.

**Since then (commits `cbc47c2`, `95c9227`): accounts, credits, the redesign, and the fal adapter.** 932 tests. Login, an append-only credit ledger, and a front end rebuilt to Paul's own portfolio layout — numbered steps, a place-photo carousel, an archive shelf, live cost, and **zero JavaScript** (CSS-only selection and background cross-fade). Seedance 2.0 is wired and verified off fal's schema pages; `generate_audio: false` is always sent, and **15 seconds arrives in ONE call**, so the last-frame seam that phase-0 criterion 5 worried about does not exist for this model.

~~**Next: the security review.**~~ **DONE 2026-08-21** — see START HERE at the top of this file, and the findings in `docs/security-review-2026-08-21.md`. The brief it was run against is still in `docs/security-review-brief.md` and is worth reading for its scope notes: there is no database, no SQL, no payment code, no npm dependencies and no client bundle, so several standard headings needed translating rather than answering.

**Then:** the still model (`fal/UNVERIFIED-identity-still` is deliberately the default so an unconfigured fal render stops at compose), place photographs, deployment, payments.

**Phase 0 remains the only thing that decides whether this is a product**, and it is still unrun.

**Two things that must be designed in from the first line or they become a rewrite:**
- **Nothing is request/response.** A 15s render is ~30s of ffmpeg *after* generation calls that take minutes. Job queue with durable state, status polling, result page — from the start. (RELIO §11.3 calls this the single most likely reason a 6-week build becomes 14.)
- **ffmpeg needs a real machine.** Vercel's serverless runtime has no ffmpeg binary and the entire look lives in ffmpeg. App and renderer are two processes talking through the queue, on day one.

**Still open, needs Paul:**
- **Phase 0 has not been run.** One still generated so far (scene adherence good — 15 of 17 elements). Needs five at rung 3 plus the two-person blind identity check. See `docs/phase-0-validation.md`.
- **Criterion 4** — Claude flagged twice that "model generates its own audio → disqualified" is too strict for Timestamp (we build our own bed and never map model audio). **Not changed without Paul's word.**
- ~~**No bundled font.**~~ **RESOLVED 2026-08-20.** Paul approved the download. `assets/fonts/tape-osd.ttf` is **VT323** (Peter Hull, SIL OFL 1.1, licence committed alongside at `assets/fonts/OFL.txt`). OFL permits bundling and redistribution inside a commercial product, so this is clean for a public app. `doctor` is green and renders reproduce across machines. Verified visually: the stamp draws and degrades *with* the image, which is the point.

---

## The split that is the whole architecture

"Looks like a tape" is two problems, and they are solved in two different places.

| Problem | Solved by | Why there |
|---|---|---|
| **Content** — a plausible person, place, outfit, motion | the generation provider | Models are good at this. |
| **Texture** — chroma bleed, grain, head-switch band, date stamp | `scripts/tapedeck/`, in ffmpeg | Models are *not* good at this. Ask one for "VHS 2003" and you get clean footage with a nostalgic mood, not tape artifacts. |

**Never ask the model for the look.** Every era cue in a prompt describes *content* — the cut of a jacket, a CRT in the corner, a car in the driveway. The moment a prompt says "grainy", "VHS", "old footage" or "film grain", it is doing `tapedeck`'s job badly and non-deterministically.

The payoff: **the look can be built and tuned for zero dollars**, against any clip, before a single paid call. That is why M1 comes before M5.

---

## Workflow

```bash
npm run doctor
npm run look -- --in=assets/stock/porch.mp4 --name=porch
npm run look -- --in=assets/stock/porch.mp4 --name=grain --sweep=tape.grainStrength=4,9,14,20
npm test
```

`npm run doctor` is a hard gate — run it before anything that spends. `npm run look` costs nothing and works on any clip.

---

## Money discipline

**`npm test` cannot spend money, and that is enforced four independent ways.** One guard is not enough, because the failure mode is a bill rather than a red test.

1. `providers/fal.mjs` has **no default** for `fetchImpl`. A test that forgets to inject one gets a `TypeError`, not a charge.
2. A test asserts the credential error is raised *before* any request is attempted. The failure **order** is itself under test.
3. `"test": "node --test"` is bare — it does **not** load `.env`. `FAL_KEY` is not in the process during a test run.
4. The only file permitted to spend is named `*-smoke.test.js` and self-skips unless `TIMESTAMP_LIVE=1`. One naming convention, one grep to audit.

**Never spend on a still you have not looked at.** The still is the identity anchor *and* the rejection gate. `--stop-after=select` exists so a human sees the contact sheet before video prices apply.

---

## Rulings that cost real time to establish

Each of these was measured, not assumed. Re-deriving one is pure waste.

**Higgsfield cannot serve a public Timestamp -- and the reason is narrower than this ruling first said.** The terms were read on 2026-08-24 (section 10). What they forbid is acting as a "pass-through or service bureau" and commercially exploiting **the Service**: one account rendering on behalf of many customers, with concurrency caps that are per-account rather than per-user. That is the generation BACKEND, and it is why the provider is fal.ai. What the same terms explicitly permit is **commercial use of Outputs, on any plan, sublicensable onward** -- so "personal experiments and nothing else" was too broad, and section 10 records the quotes. **The backend is closed; assets Paul generates himself are open.** Original reasoning: RELIO §11.6 (`C:\Users\pauls\RELIO\Reelio_Master_Document_v2.md`).

**Set the video model's native audio OFF.** Modern video models emit their own audio by default and it will fight the designed bed. Enforced in three layers — a required `nativeAudio: false` field, a provider-shape assertion, and an `ffprobe` check that the returned file has zero audio streams. Three layers for one boolean looks paranoid until a model version bump quietly re-enables it and you ship a week of videos with two ambiences arguing.

**The grade runs in RGB and the tape stage runs in YUV, and the boundary between them must be stated.** `curves` and `colorbalance` are RGB filters, so ffmpeg silently auto-inserts a conversion and *everything downstream of the grade inherits `rgb24`* unless you pin it. That is wrong twice over. The tape stage is defined in terms of chroma — `gblur=planes=6` means "planes 1 and 2", which in RGB are **blue and red**, so the signature chroma smear was quietly blurring colour channels instead of chroma and `chromashift` was a no-op. Then each transport `overlay` round-tripped through overlay's own `yuv420` working format and the accumulated range mismatch **crushed mean luma from 133 to 26** — a five-fold darkening, with no error and no warning. The single `format=yuv420p` after `eq` is what makes the graph say what it means instead of depending on negotiation. There is a test that asserts its position; do not remove it.

**On Windows, `openSync(path,'wx')` is the ONLY exclusive filesystem primitive. `unlink` and `rename` are not, and they look like they are.** Measured on this machine, 16 threads released through one barrier onto one file: exclusive create produced exactly one winner in **120 of 120** rounds; `unlinkSync` produced the wrong number in **120 of 120**, usually with *all sixteen* reporting success; `renameSync` in **60 of 60**, with all 960 calls returning success. libuv implements both as open-then-act, and setting a delete disposition — or renaming through a handle you already hold — is not an error just because someone else did it first. Any "who won?" decision must be an exclusive create of the destination. The queue's `claim()` was always right; `reapExpired()` was not, and picking its winner by whose `unlink` returned true reported one job twice **and lost another entirely** — the loser deleted the pending entry it had written as a "duplicate" when it was the only one, and the job vanished from pending, claimed, done and failed at once while every count still looked plausible. `reapExpired()` runs on every worker startup, so this is not an exotic path.

**A test whose timing margin is narrower than the machine's variance tests the machine, not the code.** `npm test` runs test *files* in parallel, so any ffmpeg inside a test competes with every other ffmpeg in the suite. Two tests were written with fixed wall-clock budgets and both failed under full load while passing in isolation — one measured 1008ms against a 900ms budget, then 9.78s against a widened 6s one. Fixes that hold: assert a **proportion** of the nominal value rather than an absolute (`elapsed < latencyMs/2`), and where a test needs a background thread to have done work, have that thread **publish its progress** so the foreground can wait for it instead of assuming it was scheduled. Related failure shape: a concurrent-reader test reported `reads: 0` — the reader was never scheduled at all, so its real assertion could not fail, and the run looked like a defect when it proved nothing.

**`vignette` is far stronger than its angle suggests, and it is applied twice.** Measured against a mid-grey source: `PI/4.3` costs **45%** of mean luma, `PI/12` costs 20%, and even `PI/20` still costs 18% — there is no "subtle" setting. It runs once as lens falloff and once over the whole canvas as the unifier, so the losses compound. `grade.curveMaster` carries the compensation. **Re-measure before raising either angle**, or the picture goes muddy and the grade gets blamed.

**`gblur` is nondeterministic on short frames.** Measured on this machine: applied to a 12-row strip it produced 6 different outputs in 6 runs. It is slice-threaded, and when frame height approaches the core count the IIR state at slice boundaries varies per run. Use **`avgblur`** on the head-switch band, and pass **`-filter_complex_threads 1`** globally. Full-frame `gblur` is safe and thread-count independent. A 2-run purity check would have passed this bug — **the purity test runs 5 times minimum.**

**Bloom happens in `gbrp`, never `yuv420p`.** `blend=all_mode=screen` in YUV screens the chroma planes too; neutral 128 becomes 191, so saturation goes **up** 16% — backwards, since real halation *desaturates* blown highlights. Measured `SATAVG`: 142.0 in YUV, 126.9 in RGB, identical luma.

**The date stamp must degrade with the image.** A real camcorder's character generator wrote the date into the signal *before* the tape, so the stamp suffered chroma bleed, grain and softness like everything else — but never lens artifacts, because it was added after the glass. `drawtext` therefore goes **after** the grade and **before** the tape stage. A crisp 1080p date over a degraded image is the single most common tell of a fake VHS filter.

**Grain before the upscale, never after.** Grain at 720x576 then scaled to 1080 gives coarse clumps larger than a pixel — tape. The same filter with the same parameters applied at 1080 gives fine per-pixel noise — a modern sensor at high ISO, the wrong decade entirely.

**No per-pixel `blend` expressions.** A radial `blend=all_expr=` cost 18.0s of a 22s render — 82% of the time in one filter. Precompute the mask as one static frame with `geq` + `maskedmerge`: 23x faster, same result. Do **not** use `loop` to repeat the mask; it floods `non monotonically increasing dts`. Emit one frame and let framesync `repeatlast` hold it.

---

## Determinism is a property, not an intention

**Same inputs must produce the same bytes.** Everything below breaks that, silently.

| Trap | Reality |
|---|---|
| `%{localtime}` / `expansion=strftime` in `drawtext` | Reads the wall clock. Also deprecated in this ffmpeg build. Compute the string in Node from the seed and pass a literal. |
| `anoisesrc` without `seed=` | Defaults to `-1`, which is random. Must always be set. |
| `gradients` filter | Every colour defaults to `random`. One reason the surround is a flat `color=c=0x0B0A09`. |
| `amix` without `normalize=0` | Default `1` divides by input count and silently scales away every level you set. |
| `loudnorm` at render time | Single-pass applies *dynamic*, content-dependent gain. The bed is synthesised, so its level is known a priori — use fixed gains and let `ebur128` **assert** the target rather than reach it. |
| A system font path | Machine-dependent. The bundled `assets/fonts/tape-osd.ttf` is what makes purity hold across machines. |

Verify with the real test, not by eye — and note it runs **five times, not two**:

```bash
npm test -- --test-name-pattern=purity
```

---

## ffmpeg rules

**Never build the command as a shell string.** Filtergraphs contain brackets, quotes, commas and semicolons — every one mangled differently by cmd.exe and PowerShell. Always `spawn(bin, argsArray)`. `scripts/ffmpeg/run.mjs` is the **only** module in this repo permitted to spawn a process.

**Spawn with `cwd` set to the repo root and keep the font path relative** with forward slashes. No drive letter means no colon means no `fontfile=` escaping problem at all. `ffFontPath()` handles the absolute-path fallback, but the bundled relative path is the supported route.

**`tapedeck/` and `audio/` are pure builders.** They return filtergraph strings and argv arrays and they never touch the filesystem or spawn anything. This is the highest-leverage boundary in the codebase: it makes ~90% of the look unit-testable with golden strings and no ffmpeg at all, and it lets video and audio join in **one** invocation instead of two. Two passes means a double encode — real generation loss on top of a look that is already about degradation.

---

## The output contract

PAL, because a 2003 camcorder tape in Germany was PAL, and because the arithmetic is honest.

| Property | Value | Why |
|---|---|---|
| Tape raster | 720x576, SAR 16/15 → DAR 4:3 | What the format actually was |
| Frame rate | 25 fps | 25 x 15 = **exactly 375 frames**. At 29.97 it is 449.55 — not an integer, so "15.000s" would be a rounding argument instead of an assertion. |
| Duration | exactly 15.000 s / 375 frames | Asserted, not hoped |
| Delivery | 1080x1920, tape image 1080x810 centred on `#0B0A09` | Honest 4:3 optics, native for phones. **Paul asked on 2026-08-21 for 4:3, 9:16 and 16:9 with the picture FILLING the frame, which deletes the surround. Planned, not built: `docs/aspect-ratios-plan.md`.** |
| Audio | mono, 190 Hz - 8 kHz, **-27 LUFS** | Deliberately far below the -14 platforms normalise to. This bed is texture, not dialogue. "Quiet" is a literal spec. |

**Not pure black for the surround.** `#000000` makes the tape look like a sticker on a void, and on an OLED phone it vanishes entirely so the 4:3 framing reads as a cropping accident rather than a choice. `#0B0A09` reads as a dark surface the image sits on. The final `vignette` over the *whole* 1080x1920 canvas is what fuses tape and surround into one photographed object instead of two layers.

---

## Prompt rules

**A prompt must never describe the person.** The photo is the identity anchor. Every adjective about face, build, hair or age is a competing description the model blends toward, and blending is exactly the failure mode — "it looks like my cousin". `composeStillPrompt` takes no subject description at all; it says "the person in the reference image" once and then talks only about place, wardrobe, light, lens and era.

**Outfits describe only what is on the body. Places describe everything else** — scene, light, lens, era props, weather. Without that split the two fragments fight and you get a parka on a beach lit like a beach. The schema enforces it; a preset that breaks it fails CI, not a render.

### Scope change, 2026-08-20 — the menu is no longer a gate

Paul's stated vision: **anyone uploads any photo, gives a location and an outfit, and gets a video.** The simplicity is the product. That supersedes the earlier "curated presets only" decision, and it changes three things:

- **The 8 places and 6 outfits become recommendations**, not the whole menu. Free input is the norm; we refuse as rarely as possible.
- **Users may upload a photo of the place** as a second reference image alongside their face — not just type it. "Your actual childhood garden" is the strongest version of this product and no preset-menu competitor can match it.
- **M3's hand-written fragments are not wasted.** They become the recommendations *and* the quality template that free text is expanded into. A new `expand` stage turns "a beach" into the same eight-line shape — scene, light, lens, framing, props, era — that a hand-written place has. The three prompt rules above survive intact and apply to expanded text exactly as they do to a shipped preset; that is what keeps this tractable.

**Consequently these stop being deferrable:** input moderation (free text plus a place photo, producing an image of a real person's face, is this product's highest-risk surface — including prompt injection, since user text lands inside our prompt), the face gate at intake, a consent gate, retention limits, and a takedown path.

**EXIF/GPS stripping moves from hygiene to load-bearing.** A photo of a place carries its exact coordinates. Someone uploading their childhood garden is handing over its location.

---

## Common mistakes

- **Editing a preset and expecting old renders to still reproduce.** They will not, unless the manifest's frozen `resolved` block is intact. That block is why "reproducible" is a property rather than a word. Never strip it to tidy up a manifest.
- **Adding a still scorer.** Ranking without a face-similarity metric optimises for the wrong thing — a sharp, well-lit stranger beats a soft likeness on every heuristic computable locally. The `scorer` seam exists; `firstScorer` is the only shipped implementation until there is a real embedding model behind it.
- **Retrying a generation without an idempotency key.** The `intent` record is written *before* the HTTP request for exactly this reason. It is four lines and it is the whole difference between "we might have double-charged, who knows" and a named step with a timestamp.
- **Treating `config/pricing.json` as fact.** Every entry is an ESTIMATE until a real invoice proves it. If actual diverges from estimated by more than 15%, `npm run ledger` says so by name — and as of 2026-08-24 **that command exists and works** (section 21). What it cannot do is invent the number: `cost.actual` is still `null` on every job ever run, because fal's queue response carries no price. Somebody has to read the billing page and type it in.
- **Reaching for `sharp` or a face detector.** ffmpeg is already a hard dependency and autorotates from EXIF by default. This repo ships with essentially zero native dependencies and that is worth protecting.
- **Reading ffmpeg's failure from the last line of stderr.** The last line is usually a generic trailer (`Error : Invalid argument`); the line that says what actually happened sits several lines above it. `lastMeaningfulLine()` prefers the specific one. Related: Windows reports negative exit codes as their unsigned wrap, so `-22` arrives as `4294967274` — `normalizeExitCode()` undoes that.
- **Substring-matching filter names.** `"avgblur"` contains `"gblur"`. A test asserting `!/gblur=/` on the head-switch chain fails against the very `avgblur` that fixes the determinism bug. Anchor filter-name checks to a boundary: `/(^|,)gblur=/`.
- **`-map_metadata -1` does not strip EXIF from a PNG.** It clears container metadata but not frame side data, and the PNG encoder writes an `eXIf` chunk straight back out of it — measured: a "stripped" PNG came back out of `ffprobe` still carrying `GPSLatitude`. `intake/photo.mjs` pins `-c:v mjpeg` rather than letting the destination extension pick the encoder. Related: **a JPEG's EXIF is not in `format_tags` or `stream_tags`**, so asserting on those two sections passes against a completely untouched file. Check frame tags and side data too, plus a raw byte-grep for `Exif`/`GPS`.
- **Assuming the same word list should have the same consequence everywhere.** `BANNED` is shared between presets and user text on purpose, but a hit means different things: a preset *is* prompt text, so a hit is an authoring bug and CI should fail; user free text is an *input to expansion* that never reaches the model verbatim, so a hit is a warning and the words get stripped. Refusing on user text rejected "my old school playground" and "jumpers for goalposts" — 3% of a realistic corpus, concentrated entirely on the memories the product exists to serve.
- **Piping `npm test` into `tail` or `head` reports the pipe's exit code, not the runner's.** A suite with a failing test exits `0` and the summary lines still say what you hoped. Redirect to a file and check `$?`.
- **Reading a job's chosen still from `intent/animate.json`.** That is the *last* segment's receipt, and every segment after the first starts from the previous clip's final frame, so it never names a still. The chosen still is in the rotated receipt for segment 1 — `intent/animate.1.json`.
- **Editing CSS and expecting to see it.** The stylesheet is memoised in `sheetCache` at `server.mjs` AND served `Cache-Control: public, max-age=300`. A CSS change needs a **server restart and a hard refresh**; without both you will be looking at the old bytes and debugging the wrong thing. Cost 20 minutes on 2026-08-21.
- **`taskkill /F /IM node.exe` to stop the server.** Claude Code is a node process. Kill by PID: `netstat -ano | grep ":3000.*LISTENING"`. Related: stopping an `npm run web` background task kills the npm wrapper and **leaves the node child holding the port**, so the restart fails `EADDRINUSE` and the old code keeps serving.
- **Backticks inside a comment that sits inside a JS template literal.** `static.mjs`'s `BASE_CSS` and the HTML blocks in `views.mjs` are template literals, so a comment mentioning `` `style-src 'self'` `` terminates the string and the file stops parsing — or worse, parses as a tagged template and throws `X is not a function` from a line nowhere near the edit. Cost two rounds on 2026-08-21 and **THREE MORE on 2026-08-23** — it is the single most repeated mistake in this codebase. Use plain quotes inside those comments, and **run `node --check scripts/web/static.mjs` after every edit to that file**. Never chain it as "check && kill-the-server": a failed check short-circuits the kill, the OLD server keeps the port and keeps serving stale CSS, and the next thing you measure will be the old bytes. That compounds with the cache trap two bullets down — a CSS change needs a server restart AND a browser hard refresh, and on 2026-08-23 the measured card size was still the old one for exactly that reason.
- **A signed shift on a hash.** `hash32` returns `h >>> 0`, so any value above 2^31 makes `h >> 5` **negative**, and a negative left operand makes `%` return a negative remainder — which subtracts from a floor instead of adding to it. It had been quietly desaturating whichever place cards happened to hash high, invisibly, because "muddier than intended" looks exactly like a design decision. Always `>>>` on a hash.

---

### 28. THE FIX ORDER, WORKED 2026-08-25/26 — eight commits, what each DOES

The review's own section 3 order, one commit each, strict test-first: every
change began as a failing test that failed for the stated reason. This section
says what the code now does; the WHY of each lives in the review, on this
machine, and is not restated here. **The findings the fix order did not cover
are still open — including one that arms on the next `config/models.json`
edit.**

**PUSHED 2026-08-26 to `origin/ui-redesign-signed-in-page`** (`6efb0e6..2464b35`,
plus `2464b35..HEAD` for the documentation pass). Before the push: all five
`guards.yml` checks were run locally and pass, and every outgoing commit
message and added line was grepped for finding identifiers — zero hits, because
a fix is described here by what it does and never by the hole it closed. **The
push is the irreversible line on a public repo; run those checks before the
next one.**

1. **`2305e81` — only a live-mode Stripe event grants credits.** The webhook
   checks the event's own mode immediately after signature verification;
   absence counts as not-live. A test-mode event is answered 200,
   `ignored: 'testmode'`, and grants nothing — which means **local `stripe
   listen` demos no longer land credits**; the grant path is proven by the
   test suite instead.
2. **`7245279` — password work is async, and knocking is metered.** Every
   scrypt derivation now runs on the threadpool: `hashPassword`,
   `verifyPassword`, `authenticate`, `createAccount` are **async — await
   them**. And `/login` and `/signup` are limited per client address (10
   attempts/minute and 10 accounts/hour — `AUTH_RATE_LIMITS`, exported from
   `server.mjs`; the limiter is `scripts/web/rate-limit.mjs`), keyed on the
   socket address and never a header, answered 429 + `Retry-After`.
3. **`5dae6d5` — every password costs the same time to refuse**, whatever its
   length, on both the known- and unknown-address branches. The four-cell
   matrix test in `auth-accounts.test.js` pins it as a proportion with
   interleaved samples.
4. **`51aafa5` — signing in takes this site's own form.** `POST /login` and
   `/signup` demand a signed double-submit pair (cookie `timestamp_csrf` +
   hidden `csrf` field, minted in `session-middleware.mjs`), refuse posts
   naming a foreign `Origin`, and the nav names the signed-in email on every
   page. **ANY TEST THAT POSTS CREDENTIALS MUST FETCH THE FORM FIRST** — every
   web test file has a `csrfPair`/`signIn` helper that does the GET-then-POST
   dance; copy it, do not post bare.
5. **`4e80fe8` — the fal credential is scoped to the queue host, enforced.**
   An authorized request whose target is any other allow-listed host is
   refused before a socket opens, whatever a response body's `status_url`
   said.
6. **`a1fc67f` — a job that ends without a tape gives back what it never
   spent.** The worker consults a refund seam on the attempt that makes a
   failure final and on cancellation; the glue (`createOwnerRefunds`,
   `session-middleware.mjs`) walks `out/owners` back to the payer and
   `refundIfUnspent` decides from the manifest's steps. The web cancel
   handler's direct path refunds the same way. A missed refund prints
   `REFUND MISSED ... credit it by hand` in the worker terminal. The CLI
   wiring is pinned by a source-reading test.
7. **`9e52e14` — the deployment headers.** `script-src` names the two shipped
   inline scripts BY HASH — they live as constants in `views.mjs` next to
   `INLINE_SCRIPT_HASHES`, so **a third `<script>` added anywhere else is
   killed by the CSP and by the test that hashes what pages actually ship**.
   `sendFile` (the path serving user-influenced bytes) sends nosniff +
   `default-src 'none'`. Everything sends `Referrer-Policy: no-referrer`
   (a `/j/<id>` url must never ride out in a Referer), same-origin CORP, and
   HSTS; pages add COOP and a Permissions-Policy that renounces the camera.
8. **`becb112` — `x-forwarded-proto` is believed only when the operator says
   so.** `TIMESTAMP_TRUST_PROXY=1` (documented in `.env.example`) is Paul's
   chosen design (2026-08-26): default never, opt in the day a
   TLS-terminating proxy actually exists. One test was changed deliberately
   with his sign-off — it pinned the old header-trusting behaviour by name.

---

### 29. `/verify/resend` ACTUALLY RESENDS — 2026-08-26, the loop that could strand somebody

**The gap.** `POST /verify/resend` did not resend. It answered 303 to
`/signup?email=`, because `supabase-auth.mjs` had no way to ask for a code and
a fresh signup call needs the password this service deliberately keeps nowhere.
That route only works if Supabase re-sends the confirmation when signup is
repeated for an unconfirmed address — **behaviour never once observed against
the live project.** If it does not hold, somebody whose first code never
arrived loops `/verify` → `/signup` → `/verify` with no way out, and nothing in
the app can tell that it is happening.

**What it does now.** `resendSignupCode({ email, clientIp })` posts
`{ type: 'signup', email }` to Supabase's documented `POST /auth/v1/resend`,
which needs no password. The handler calls it and re-renders the code page with
a notice; the person never leaves the field they are waiting to fill.
**The assumption is gone rather than tested** — that was the choice, because
confirming the repeat-signup behaviour would have cost a live round trip and
left the app resting on undocumented behaviour either way.

**Three properties are pinned by tests, not by intention:**

1. **One sentence, whatever happened.** `resendSignupCode` swallows and logs
   its own failures exactly as `sendRecovery` does. An unknown address, an
   address already confirmed, a second ask inside Supabase's own sixty-second
   window, and a transport that never answers all leave as
   `RESEND_SENT_MESSAGE` over a 200 — compared byte for byte across all four,
   headers included. Rendering the difference would reopen on this page the
   enumeration oracle `/verify` exists to close. **That test was checked
   against a deliberately-leaking build before being trusted**: remove the
   swallow and it fails.
2. **The attempt counter is still untouched.** Five guesses per code, not five
   per resend. The pre-existing bypass test covers it unchanged.
3. **A malformed address never reaches Supabase** and is answered identically
   anyway — the same `isAddressShaped` guard `verifyPage` applies to `?email=`.

**The page copy changed with it.** The hint promised "you will be asked for
your password again", which described the old 303 and is now false — and false
in the direction that stops somebody pressing the button. It states the
sixty-second rule and says the password is not needed.

**+7 tests** (3 in `test/auth-supabase.test.js`, 4 in
`test/web-auth-code.test.js`), each written failing first. The suite is
**1570 / 1568 pass / 0 fail / 2 skipped**. The web four register three times
apiece in a whole-suite run, because sibling files import that file's shared
harness — that is why the total moved by 15 and not by 7.

**This closes the third of the three things the handoff named. The other two
are still Paul's:** the `{{ .Token }}` template edit, and one real Google round
trip.

---

---

### 30. THE PAGES BECAME THE TAPE (2026-08-27) — and Paul froze them on sight

**Eight commits, `ffd3b3e..90093b1`, on `supabase-identity-slice`. Suite 1671 /
1669 / 0 fail / 2 skipped.** Paul asked for four things: the app to look like a
real camcorder video with the location full-screen behind it, a blurry glass
menu floating on top, the list turned into a swipeable carousel, and the sporty
outfit fixed. All four shipped. **He then looked at it running and said keep it
as it is — see START HERE. Do not improve these pages.**

#### The loops cost nothing, and that was the whole design

`scripts/tapedeck/place-loops.mjs` cuts one six-second clip per place from the
photographs already in `assets/places/`, grading them through
**`buildVideoFilter` — the same function the renderer calls, on the same
profile**. So the backgrounds inherit a look change for free, and a
provider would have charged per place per revision to produce ones that drift.
**1240 kB for all eight; only one loads at a time.**

- **1024x576, not 960x540.** Section 13 holds every shape's short edge at 576 so
  one set of filtergraph constants stays correct in all of them. A "friendlier"
  web number would have scaled the head-switch band and the grain by 0.94 and
  made these the only pictures in the product whose tape is a different tape.
- **The drift is one full period of a sine**, so the window returns to its
  origin and the wrap has no jump. Measured: 0.747 SSIM at the loop point
  against 0.505 at the opposite phase. It is not 1.0 because the grain is fresh
  every frame, which is correct — real grain does not repeat.
- `loops.json` beside them carries each clip's **mean luma over every frame**.
  The page needs it and nothing else can recover it: by the time a stylesheet is
  built the mp4 is a byte range on a disk.

#### One video element, and every exit returns to the page that already worked

Eight elements would be eight decoders for one visible picture. There is one,
and `BG_SCRIPT` swaps its source — **the third inline script, hashed into the
CSP** (see the note about a third script elsewhere in this file; it is now three
and a fourth still dies silently unless added to `INLINE_SCRIPT_HASHES`).

It ships with **no `src` and no `autoplay`**, so no JavaScript, reduced motion,
`saveData`, an unplayable codec, a 404 or a refused `play()` each leave the
still layer exactly as it was. The still is not a fallback that was added; it is
the layer that was already there.

**TWO STATE CLASSES, AND COLLAPSING THEM IS A REGRESSION WITH A LOOK.**
`is-live` means video works here and holds across every subsequent choice — it
drives the scrim and the panel plate, which are properties of the ground.
`is-showing` drops for the moment between choosing a place and its loop
decoding, and drives only the video's own opacity. Driven from one class, every
click threw the scrim back to full strength and changed each panel's corner
radius until the next file loaded: the whole chrome flinching once per click.
**Caught in a browser, not by a test**, and now pinned by one.

#### The scrim is per place, and the plate is what let it come down

One scrim value tuned at 0.74–0.92 is right for a picture blurred to a wash and
far too heavy for one meant to be recognised. **The places are not equally
bright: `wohnzimmer-abend` averages 49 and `ostsee-strand` 165, a 3.4x spread.**
Set it for the beach and the living room is a black rectangle. `scrimOpacity()`
in `static.mjs` gives each place the least scrim that keeps the bone body colour
at 8:1 over its own loop — **0.30 to 0.64**.

**IT COULD NOT HAVE COME DOWN AT ALL WITHOUT THE PLATE, and that is why the
glass is structural rather than decorative.** Derive the same scrim against
`--l-dim` (`#8D8880`) instead and every place is dragged back above 0.59, which
undoes the whole thing — that colour only works on a near-black ground, and over
the brightest place it measures **2.86:1**, a real AA failure on text this
product ships in `.fine`, `.who` and the footer. So the dim tokens earn their
contrast from a local plate: **`rgba(7, 10, 17, 0.62)`, the least that clears
4.5:1.** The `backdrop-filter` was already declared on `.panel` and had been
doing nothing for want of anything to tint.

**DESIGN.md's "the boxes are gone" survives this intact.** That rule was written
for a ground with nothing behind the text, and it still governs it: with no loop
playing, `--frost` is transparent and the panels are as borderless as they have
always been. The plate exists only while there is a photograph to separate text
from — the one condition the original rule never had to consider.

#### The landing stopped framing the place and stood inside it

The 4:3 veil is **gone — markup, generated rule and stylesheet block together**,
because the place is behind the whole page now and keeping both would show one
photograph twice at two sizes and two crops. A rule that matches nothing is how
dead markup survives a review, and this file has been caught by that before.

- `.strike` went from a two-column grid to one column.
- `<ul class="stack">` became `<ul class="lrail">` — **still a list in the
  markup**, horizontal only in the styling, on the same scroll-snap mechanic the
  place cards already used. Two screens answering a swipe the same way.
- The OSD read-out moved out of the panel and onto the viewport, which is where
  a camcorder put it.
- **Almost nothing new was built for the background.** The landing's radios
  already carry the same `pl-<id>` ids, so every generated rule reached the page
  the moment it had a `.bgs`. Only the NAME differs — `lplace`, so a landing
  choice can never be posted as a real order — and the script matches both.

**Measured at 320 / 375 / 414 / 768 / 1024 / 1440: no horizontal overflow at
any**, rail scrollable at every one.

**THE SIGNED-IN PAGE WAS NOT REDESIGNED and should not be described as though it
was.** It got the video, the scrim, the plate and the monogram. Its structure —
the two-column `#tape` grid, the numbered steps, every card, all copy — is
untouched.

#### The monogram joined the wordmark, and it has two opacities

`assets/brand/monogram-inline.svg`, inside the wordmark's own anchor so there is
one tab stop, and `aria-hidden` because it draws the letters the word beside it
already spells.

**THE LOCKUP ALIGNS BASELINES AND CANNOT ALSO ALIGN THE TEARS.** `seam 0.72` is
a fraction of INK height; `Timestamp` carries the descender of `p` and `Ts`
carries none, so the same parameter lands **below** the wordmark's baseline —
through the feet, where a head switch falls — and **well above** the monogram's.
That is the generator being right: put the monogram's tear on its own baseline
and there is nothing beneath the cut to displace, so the tear vanishes and the
mark becomes the plain serif `Ts` it exists not to be. Aligning tears instead
costs **5.47px** of baseline break. Cap heights already agree at 19.58 vs 20.06.

**IT SEPARATES BY WEIGHT BECAUSE COLOUR IS SPOKEN FOR.** The record light is the
only thing in the chrome wearing `--rec` and it is **3.2px** wide; a 30px mark in
the same value is nine times the area of the thing the colour exists for.

**AND THE HOLD-BACK IS TWO NUMBERS, BECAUSE ONE GROUND BECAME TWO.** 60% keeps
the mark under the record light on `#070A11` — 6.11:1 against 7.47:1. Over a
photograph the comparison inverts: bone composites lighter as the ground lifts
and holds its contrast, while the accent is a mid-tone salmon whose ratio
collapses. Measured over all eight loops, **60% out-shouts the record light on
seven of the eight**, so a live background switches the mark to **45%**.

#### Three defects surfaced on the way, each its own commit

1. **`purge` accepted a flag that does not exist** (`7354214`). `npm run purge --
   --job=<id> --apply` was typed on this machine. There is no `--job`. It was
   accepted in silence and **the full retention sweep ran** — six uploads across
   twenty-six jobs, while the operator believed they were clearing one. Nothing
   was lost that was not already past its window, and that is luck rather than
   design. It is now a whitelist: an unknown or near-miss argument is exit 2 with
   nothing touched. **The near miss is the dangerous shape** — `--photodays=999`
   reads like `--photo-days` and would have swept on the configured window.
2. **The unverified-model refusal hid its own escape hatch** (`6f67a46`). A
   resume restores the provider, video model and still model but NOT
   `--allow-unverified-model` — defensible, since a permission a manifest carries
   for ever is not a permission. What was wrong is that the message said "verify
   it, edit the entry", pointing at the one edit that poisons the signal the gate
   exists to protect. It now names the flag and says a resume does not carry it.
3. **Three stripes are somebody's trademark** — below, and it is the most
   expensive lesson of the day.

#### THE MODEL HONOURS PRESENCE AND IGNORES COUNT — four renders, $0.16

`trainingsjacke` asked for **two** white stripes. `seedream v4.5 edit` drew
**three** every time — three renders, counted on enlarged crops, including with
the count written as "exactly two", the pair named again on the leg, and two
negatives aimed squarely at three. **Three stripes on a navy tracksuit is
adidas's registered trade dress**, `large brand logo` never caught it because it
is not a logo applied to the garment — it IS the garment — and every place in
this catalog is set in Germany.

Every *presence* instruction in the same rewrite landed first time: the chest
crest came off, the jacket zipped, the stand collar arrived, the trousers
arrived. **So the garment lost its number.** One broad stripe is a thing to draw
or not draw, and `20260827-161556-cfe684` confirms it drawn as one on both
sleeve and leg.

**Do not "restore" two stripes.** It has been tried three times, it costs $0.04
a go, and it does not work. `test/catalog.test.js` pins the absence of a count.

#### Things that will bite

- **Backticks inside a comment inside `BASE_CSS` broke the build again** during
  this work, exactly as this file warns. `node --check scripts/web/static.mjs`
  after every edit, and use plain quotes in those comments.
- **A hidden browser tab will not start video playback and does not tick CSS
  transitions.** Measuring the swap needed `transition: none` injected first and
  the `playing` event fired by hand. Screenshots need the pane displayed;
  measurement does not — same trap as section 16.
- **`assets/places/` is +1.3 MB of mp4 in a PUBLIC repo.** Deliberate, and worth
  knowing before anybody wonders where the weight came from.
- ~~**`DESIGN.md` still describes STRUCK** and does not know about any of this.~~
  **RECONCILED 2026-08-28 — section 31**, and in the other direction: the pages
  followed DESIGN.md onto cream rather than DESIGN.md being rewritten to match
  the pages. DESIGN.md is the authority again.

---

### 31. THE PAGES MOVED ONTO THE CREAM GROUND (2026-08-28) — and DESIGN.md's "later" is spent

**Suite 1678 / 1676 pass / 0 fail / 2 skipped, from a 1674 / 1672 baseline.** (Committed the same day as `fbbb09a`; the suite is 1679 / 1677 as of §33.)
Five modified files, nothing untracked: `DESIGN.md`, `scripts/web/static.mjs`,
`scripts/web/views.mjs`, `test/web-api.test.js`, `test/web-static.test.js`.

DESIGN.md had specified the cream palette since 2026-08-27 and said so itself --
"the identity is built for a light ground; the pages still implement Struck and
follow later". This was later.

#### It was a DECOUPLING, not a repaint, and that is the whole shape of it

**The `--l-*` layer was always named for the LANDING** -- its own comment reads
"STRUCK -- the landing page's world". What made the pages dark was not those
tokens but the eleven aliases above them pointing AT them. So `:root` now holds
the identity on paper and `body.is-landing` re-points the same eleven back:

```
:root            --ground/--ink/--accent/... -> --paper/--ink-strong/--oxide/...
body.is-landing  the same eleven             -> --l-ground/--l-bone/--l-cathode/...
```

**Every declaration in that block is a TOKEN and never a rule.** The landing gets
no stylesheet and no components of its own; add a rule scoped to it and the two
worlds start diverging in layout as well as colour, which is exactly what one
source of truth exists to prevent.

**THE LANDING KEPT STRUCK ON PURPOSE, and it is not an exception that drifted.**
Its central mechanic is that choosing a place turns the whole page into that
place -- a full-bleed photograph scrimmed until bone prose clears 8:1 over it.
That scrim is what makes the ground dark, and **a light scrim over a dark 2003
interior does not exist**. Moving it to paper would not have been a recolour, it
would have deleted the demo. The app is an album page; the landing is the thing
the album is full of.

#### THE "NOTHING ELSE HAS TO CHANGE" NOTE WAS WRONG, and it is worth knowing why

`static.mjs` carried a comment promising that when the pages followed the
identity onto cream, `--rec` "becomes #A8342A and nothing else has to change".
That was true of `--rec` alone. Measured before trusting it:

- **50 dark-ground colour literals outside `:root`** -- `rgba(11,10,9,.92)`
  scrims, `rgba(255,138,30,…)` glows, `#17120A` button ink, `#4E463C`
  placeholders. None reachable from a token.
- **4 more baked into the GENERATED per-catalog rules**, where a build-time
  literal cannot be re-pointed by any token at all.
- **`.gauze`, `.bgs` and `.scrim` on EVERY page** via `layout()`.
- **`<meta name="color-scheme" content="dark">`** on every document.
- **Nine visible borders drawn through `var(--accent-deep)` / `var(--alarm)`**,
  which the border sweep cannot see because it only catches LITERAL colours.

**An alias layer is a place where a colour is DECIDED. It is not evidence that
every colour was decided there.** The comment is now replaced by that finding.

#### THE ONE NUMBER THE MOVE BROKE, and it failed silently

**The ghost floor.** DESIGN.md fixed ghosts at `opacity: .5` and recorded
4.55:1 -- measured with bone on `#070A11`. On cream, `--ink` at `.5` measures
**3.11:1**: a real AA failure on every unlit option in the product. It fails
QUIETLY, which is what makes it dangerous -- a ghost is supposed to look faint,
so nothing looks wrong.

Re-solved against paper, **`.63` is the least opacity that clears 4.5:1, and it
lands on 4.55:1** -- the same number DESIGN.md recorded for the dark ground. The
RULE was always "a ghost sits at the floor and no lower"; only the value the
floor takes is a property of the ground. So it is a token, `--ghost`, and each
ground names its own, exactly as it names `--rec`.

**WHAT WILL NOT FIT UNDER A GHOST ON PAPER:** `--ink-soft` needs `.97` and
`--oxide` needs `.84`. Neither is a ghost. So **nothing inside a ghosted control
is written in the soft tier any more** -- hierarchy inside a card is carried by
SIZE, which survives being multiplied by an opacity, and not by colour, which
does not.

**AND THE GHOST MOVED OFF THE PLACE CARD ONTO ITS PHOTOGRAPH.** A place card
carries its name and date ON the image, over a scrim solved for FULL opacity;
ghosting the whole card multiplies that scrim too, and even at the floor the name
lands at 4.36:1 and the date at 3.32:1. The unlit half of the menu would have
been the half nobody can read, on the control where reading the label IS the
choice. The opacity now sits on `.thumb` and the caption stays lit. **The
generated `:checked` and focus rules had to follow it** -- lifting `.placecard`
now lights nothing.

#### HALF OF EVERY TAPE POSTER IS LETTERBOX, and on cream that was the dark rectangle

Measured on a 16-row sample of a real render: **rows 1-4 and 13-16 are luma 0.**
The delivered 9:16 file is the 4:3 picture matted inside it, so exactly half the
poster is surround. On `#070A11` those bars WERE the ground and nobody could see
them -- which is why this survived until the pages moved. On paper they were 50%
of every tile and they were what made the shelf read as a wall of black slabs.

Paul was shown three options rendered against real posters -- a paper mat, the
tape's own black bled to the tile edge, or a warm tint -- and chose **the bleed**.
The tint was refused on DESIGN.md's own terms: photographs stay untinted, and the
chrome does neither content nor texture.

**The crop is `aspect-ratio: 9 / 8` against the `object-fit: cover` the tile
already had.** One declaration, no new markup, no image reprocessing, and the
burnt-in date stamp survives because it sits inside the content band.

**The shelf is the reference's grid now** (`artifactuprising.com`, locked in
DESIGN.md): image, then name, then caption, straight on the paper, nothing drawn
around the image, only space between tiles. The caption came OUT of the picture,
which also deleted the 90% near-black gradient it used to need.

#### THREE TOKENS FOR TEXT ON A PHOTOGRAPH, because it is not text on the ground

`--ink` over the caption scrim measures **1.06:1**. A place card's caption and a
tape's status never touched `--paper` and never will, so they must not follow it.
`--on-image` (13.94:1), `--on-image-soft` (8.90:1) and `--on-image-accent`
(5.62:1) belong to the photograph, and `.is-landing` deliberately does NOT
override them -- the image is the same image on either ground. Measured against
the worst case the scrim can produce, a pure WHITE photograph under it.

#### Closed on the way, each because the move exposed it

- **The gauze is deleted.** DESIGN.md's Struck palette called it "the anode mesh
  ... over everything" while the same file, four sections earlier, forbids
  "grain, scanlines, noise or vignette" on the interface. A 1px-on-4px repeating
  gradient across the viewport IS scanlines. The two could not both be followed;
  the texture rule is the stronger one. Deleted, not suppressed.
- **Nine borders drawn through tokens are gone** -- the two banners' 2px bars,
  the pill's ring, the dropzone's hover box, the selection rings on the contact
  sheet, the plan pill. `.framecard .shape` stays: it is the named exception.
- **`.plan` finally uses the struck/ghost grammar** section 23 asked for, gated
  on `:has(.plan--current)` so a signed-out visitor does not meet a page where
  every plan is dimmed.
- **`.lopt .lidx` was a PRE-EXISTING 2.21:1 failure on the landing**, unchanged
  by this work and found only by re-measuring. Fixed with the same ruling as the
  paper cards: it takes the option's own colour and is distinguished by size.
- **The `--soon` states were at `.26`**, which is `--ink` at 1.70:1. They sit at
  the floor now and the flag carries "not yet" in words -- the only version a
  screen reader ever had.

#### The signed-in page lost its moving ground, deliberately

`homePage` used to carry the same full-bleed place still, loop and scrim as the
landing. It is the page somebody WORKS on -- choosing, reading prices, watching a
queue -- and every one of those is text over a moving photograph competing with
it. The demo belongs on the landing; here it was the product's workspace wearing
its own advert. **The hoisted radios stay** -- they are the CSS-only selection
mechanic and had nothing to do with the background; the background merely read
them. Removing it cost no interaction. `BG_SCRIPT` is no longer emitted here, so
it is a landing-only script now (still hashed; `INLINE_SCRIPT_HASHES` unchanged).

#### Verified in a browser, not just asserted

- **The mechanical border check DESIGN.md actually specifies**: 260 elements
  inside `.wrap`, **12 border edges, all twelve on `.shape`** (3 glyphs x 4
  sides). Zero others.
- **A live contrast sweep of every visible text element**: 87 on the ground on
  the signed-in page, **0 failures**, tightest exactly **4.55:1** -- the ghost
  floor, by design. Status, result, select, pricing, error, the empty shelf,
  login and signup all sweep clean.
- The sweep found **one real defect**: the `WORKING` badge at 1.67:1. An
  unfinished tile never has a poster, so the badge always sits on the pale
  plate and the on-image tier was exactly wrong for it.

#### Two tests changed, and neither was weakened

- **"every page carries the gauze"** became **"no page wears a texture of its
  own"**. Same rule with the exception taken out; it now covers the gauze as
  well as the grain, plus a new test that the rule is gone from the sheet.
- **"the moving background is one element"** followed its subject to the landing
  and GAINED assertions: the signed-in page must carry no video, no `.bgs` and
  no `.scrim`. The one assertion it lost -- the plate under the panels -- had its
  SUBJECT deleted, and its replacement asserts that the configuration is now
  impossible, which is stronger than tinting it correctly.

**Three new tests, each sabotage-verified to go red**: the palette clears its
floor on the ground it sits on (recomputed from the values that actually ship, so
DESIGN.md's table cannot drift from the sheet); a ghost clears the floor at
whatever `--ghost` is set to, on both grounds; and the cathode orange appears
nowhere on the paper side, including in the generated rules.

#### Things that will bite

- **Backticks inside a comment inside `BASE_CSS` broke the build twice again**,
  exactly as this file has warned since 2026-08-21. It is still the most
  repeated mistake in this codebase. `node --check scripts/web/static.mjs` after
  every edit to that file.
- **The Bash heredoc on this machine eats backslashes.** `\\s` written into a
  test file arrived as `\s`, which inside a JS template literal is just `s`, and
  a regex silently matched nothing. Use the Write/Edit tools for any file
  containing regex escapes rather than `cat <<'EOF'`.
- **A page served from a different port cannot load this app's images.** The
  asset routes send same-origin CORP, so a review harness on :3100 gets the
  stylesheet and is refused every place photograph it references. Inline the
  sheet and copy the images if you build one.
- **`263db24` is not on this branch** -- an unreachable duplicate of `d1f56e1`
  carrying the same message. Work from `d1f56e1`.
- **A stale `npm run web` holds port 3000 and serves stale CSS**, which is this
  file's own oldest trap. Kill by PID (`netstat -ano | grep ":3000.*LISTENING"`),
  never `taskkill /F /IM node.exe`.

---

### 32. THE PENDING LIST (2026-08-28) — everything left, verified against the repo

**This is the inventory. It was built by CHECKING, not by reading this file**,
which is why two items other sections still call open are struck below. Twenty
items, grouped by who can actually do them. Numbers are stable — say "do 6 and
12" and they mean these.

**MAINTAINED THROUGH 2026-08-29 EVENING.** Struck: 1, 2, 6, 10, 11, 12.
Rewritten because the entry was wrong or half-done: **3** (image built, host
not chosen), **9**, **14**, **19**, **20**. **§34 and §35 are the record.**

**WHAT §35 DID TO THIS LIST:**
- **9 — the security review.** The three items §34C left are now closed, along
  with fifteen more from a fresh audit. **What remains open is ONE item and it
  is a product decision, not a defect** — see §35F. The `config/models.json`
  still-model warning **STILL STANDS**.
- **14 — the free-tape exposure.** Rewritten AGAIN, in the other direction.
  §34E said it was not an attack surface because the grant needs a confirmed
  identity. The premise is true and the conclusion does not follow. **STILL
  OPEN, so the mechanism is in the gitignored review and not in this file.**
  §35D item 3.
- **19 — the equal-time refusal guard.** Unchanged and still accepted, but note
  `/logout` gained a same-origin check this session (`adff90d`), so the list of
  state-changing routes with no forgery gate is now zero rather than one.
- **20 — the commit message.** THREE commits, not one, and all three are on
  pushed branches. A CI guard now catches the next one; the three are named as
  known exceptions. §35D item 2.
- **7 — open the PR.** Still Paul's. Worth knowing before he does: this is the
  first CI run the branch has ever had, and it now runs SEVEN guards.
- **13, 15, 16, 17** — untouched, all still Paul's decisions.

**THE ORDER THAT MATTERS IS NOT THE IMPORTANCE ORDER.** Item 5 is still the
most important thing in the project. **Item 3 is the one to start**, because
picking a host is a thirty-second decision that unblocks every remaining piece
of the deploy — and 5 costs Paul ten minutes and needs nobody. Both are his,
neither blocks the other, and doing both takes one coffee.

**AND THE LESSON THIS LIST KEEPS TEACHING: RE-VERIFY BEFORE WORKING AN ITEM.**
Three entries across two sessions were already done, and item 11 was not the
open decision it claimed but a live defect that would have failed every wide
render the day a real provider was configured.

#### A — Blocked on Paul or on an outside party. The critical path.

1. ~~**BUY A DOMAIN.**~~ **DONE 2026-08-28 — `timestamptapes.com`**, $10.46/yr
   at Cloudflare Registrar. Nameservers were delegated instantly
   (`maisie`/`duke.ns.cloudflare.com`), so the propagation wait this item was
   ranked first for never happened.
2. ~~**Verify that domain in Resend.**~~ **DONE 2026-08-28 — AND IT CLOSED THE
   PROJECT'S OLDEST BLOCKER.** Added as the SUBDOMAIN `send.timestamptapes.com`
   (eu-west-1), records entered by hand in Cloudflare rather than granting
   Resend DNS write access; DKIM, MX and SPF all verified.
   **The sender then had to move.** Custom SMTP and the `{{ .Token }}` template
   were already done on 2026-08-27 — what was still wrong is that Resend was in
   SANDBOX, so the sender was the shared `onboarding@resend.dev`, which delivers
   only to the account owner and lands in Gmail's Spam. Supabase's SMTP sender
   is now on the verified domain. **Proved end to end: a real signup to an
   address that is not the owner's received its six digits.**
   **A trap that returns silently:** Authentication → Sign In / Providers →
   Email → `Email OTP length` must stay **6**. At 8 the form truncates the code
   and Supabase answers an invalid token with `otp_expired`, the same code it
   uses for a genuinely expired one — so the page blames the clock. Nothing in
   the app can detect it.
3. **Deploy. THE IMAGE HALF IS DONE (2026-08-29, §34A); THE HOST IS NOT
   CHOSEN AND IT BLOCKS EVERYTHING AFTER IT.** `Dockerfile`, `.dockerignore`,
   `.gitattributes` and 13 tests exist, and the image was built, run, and
   proved: two containers on one volume, `ln` exclusive across them, no `.env`
   or key anywhere in its filesystem, preflight green at build time. **A full
   fixture render on 2 vCPU / 4 GB is 97 seconds**, so a ~€5/mo box is enough.
   §34A has four hosts with prices read on 2026-08-29 — and the note that Fly
   volumes are single-attach, so it alone needs both processes in one Machine
   behind a supervisor this Dockerfile does not have.
   **Still to do after the host is picked:** the topology file, TLS (which is
   also what makes `TIMESTAMP_TRUST_PROXY=1` correct and unlocks the `__Host-`
   cookie prefix), and a runbook for the five consoles — Supabase, Google
   OAuth, Stripe webhook, `TIMESTAMP_PUBLIC_URL`, DNS. **None of that is
   testable from `node --test`, and every Google sign-in failure this project
   has had was dashboard-shaped.**
   `TIMESTAMP_PUBLIC_URL` is still commented out in `.env.example`.
   **Consequence worth stating plainly: this app has never been reachable by
   anyone not sitting at this machine.**
4. **Stripe: get off the shared sandbox.** The account is shared with another
   product, so Stripe puts the WRONG BUSINESS NAME on the hosted checkout page
   -- verified by rendering it. Going live needs business verification, which is
   paperwork only Paul can file and takes days. Both test Price IDs are filled
   in and the whole path is proven; §27 has the detail.
5. **THE BLIND CHECK. The most important item in this file.** Packet built and
   unsent at `out/blind-check/` -- five images plus `BRIEF.md` with the exact
   wording and the decode key. Two people, separate chats, "Who is this?" and
   NOTHING else. **Not the friend who was primed.** It is the only evidence that
   a STRANGER recognises Paul rather than Paul recognising himself, and it is
   free and takes ten minutes. **Claude will not send these** -- it is a
   deception of third parties about Paul's own face.

#### B — Claude's, self-contained, none of it needs Paul

6. ~~**The two Linux CI reds.**~~ **DONE 2026-08-28 — `096ba76`. THERE WERE
   THREE, NOT TWO.** Line 182 threw, so the GPS assertion below it never ran on
   Linux; fixing only the reported failure would have turned that one red on the
   next CI run. Measured on both CI images rather than reasoned about — ffprobe
   8.1 and 6.1 disagree on the NAMES (`EXIF metadata` side_data and a `GPSInfo/`
   tag prefix exist on 8.1 only). The exit-code red was `234 !== -22`: the same
   EINVAL, truncated to 8 bits by POSIX, so it was a per-OS claim rather than
   wording. **Verified green on the real CI image** (ubuntu:24.04 + apt ffmpeg
   6.1.1 + node 24, in Docker) — see §33 for how to re-run that.
7. **Open the PR. NOW UNBLOCKED — item 6 was the gate.** 127 commits ahead of
   `origin/main`, nothing merged, no PR. The first CI run happens the moment a
   PR opens. **The push is Paul's line, not Claude's.**
   **`/review` HAS RUN CLEAN ON THIS BRANCH AND `/ship` CAN SEE IT** — logged
   against `b199919`, status clean, tree not dirty. (It could not be logged at
   first: gstack's persistence needs `bun`, which was missing. Installed
   2026-08-28, `bun 1.4.0`, via `npm install -g bun` — global, so the repo's
   zero-dependency guard is untouched.)
8. ~~**Commit the cream work.**~~ **DONE 2026-08-28** -- see §31. Committed
   locally, NOT pushed.
9. **The rest of the security review — PARTLY WORKED 2026-08-28.** Both files
   local and gitignored, as they must stay.
   **Closed:** the duplicate cookie parser (`382cbb5`) — the one on the request
   path took the LAST value for a repeated cookie name while the careful one in
   `session.mjs:606` took the first. Test-first, sabotage-verified, and one
   existing assertion was TIGHTENED rather than added to.
   **Verified already closed, so the review is stale on both:** the signup
   limiter exists (10/hour per IP), and `/auth/reset` + `/auth/reset/complete`
   exist with their own limiter, so a leaked credential CAN be revoked.
   **FIVE MORE CLOSED 2026-08-29 — §34C**, one commit each, test-first, every
   assertion sabotage-verified: the billing page's prototype reflection
   (`7d267ae`), the uncached public health endpoint whose per-hit cost grew
   without bound (`9cefcae`), redirects followed without re-checking the
   allow-list — which reached the cloud metadata address (`8a325fd`), an
   over-cap body answering `ECONNRESET` instead of a readable 413 (`ea806e9`),
   and an account error carrying the submitted address into the logs
   (`f487b4d`). Every one was re-verified against current code before being
   worked, and one item the review still lists as open was already closed.
   **THREE ARE LEFT AND ALL THREE ARE DELIBERATE:** the multipart
   write-amplification item (LOW, bounded by `maxBytes`, needs an authenticated
   account with credits); the structural half of the cookie finding (there are
   still two parsers; deleting the duplicate is a dependency-shape decision,
   since `session-middleware.mjs` imports only node builtins today); and
   `stillCount`, which is client-chosen and unpriced. **THE ONE THAT ARMS ON
   THE NEXT `config/models.json` STILL-MODEL EDIT IS STILL OPEN** — whoever
   fills in the still model reads §3 of the review FIRST. **The 2026-08-29
   `aspectRatios` edit to that same file did NOT arm it**, because the still
   model is untouched and the web path still refuses at compose.
10. ~~**The shared-path test race.**~~ **DONE 2026-08-28 — `5be6c1f`. FOUR
    DIRECTORIES, NOT THREE.** This list named `test-intake`,
    `provider-contract` and `fal-smoke`; §4 named `provider-fixture` instead of
    `fal-smoke`. Both lists were right and both were incomplete. Measured before
    and after the same way §4 measured the previous fix: `build/test-intake`
    went from 6 paths all shared to 12 across two pid directories with none
    shared; `build/provider-fixture` from 22 leaf names claimed by both — the
    exact number §4 recorded — to 44 disjoint paths.
11. ~~**16:9 and 9:16 refuse on the paid path.**~~ **DONE 2026-08-29 — §34D,
    five commits.** And it was NOT the decision this entry called it: the page
    was OFFERING both shapes while the pipeline refused them, so every wide
    order would have failed at compose the day a real provider was configured,
    after the credits were debited. Invisible locally because the web app
    defaults to the fixture. **All three shapes now render on the paid path and
    are priced at what they cost: 28 CR at 480p and 61 at 720p**, because
    holding the short edge makes a non-4:3 shape exactly 4/3 the pixels and fal
    bills tokens as pixels x seconds. Proved end to end by rendering a 9:16
    tape and measuring edge luma — a matted 4:3 and a full-bleed 9:16 are both
    1080x1920, so dimensions alone prove nothing.
12. ~~**`npm run doctor` does not load `.env`.**~~ **DONE 2026-08-28 —
    `493989b`.** `npm run doctor` now prints `all three present` against the
    real `.env`. The test is BEHAVIOURAL, not a string match on the manifest: it
    executes the command `package.json` declares, in a scratch cwd with its own
    `.env`, so dropping the flag turns it red. **Note what it does not do:** the
    flag is on the npm SCRIPT, so `node scripts/preflight/doctor.mjs` directly
    still sees only the parent environment.

#### C — Decisions only Paul can make

13. ~~**The judder, and it is in every tape ever made.**~~ **DECIDED AND DONE
    2026-08-30 — §44, commit `e5aa898`.** Paul chose the second of §26's three
    ways out: scatter the duplicates from the job seed. Spacing went from a flat
    25 to a 22-29 wobble with the count unchanged at 15. **The fifteen
    duplicated frames are still there** — this stops them being metronomic, it
    does not remove them.
14. **The free-tape exposure — SMALLER THAN THIS ENTRY SAID; corrected
    2026-08-29 by checking (§34E).** 21 CR at signup is **$2.07 of real
    provider spend per account**, ~$207 against the global ceiling of 100.
    **What is NOT true is that a script can drain it.** The grant happens only
    inside `createAccount`, reached solely through `resolveIdentity` — so it
    costs a confirmed six-digit code, a password login against a confirmed
    account, or a real Google round trip. An attacker needs 100 confirmable
    mailboxes, not 100 POSTs. **It is a pricing question for Paul, not an
    attack surface**, and the security review's note to the contrary predates
    the identity slice.
15. **The pack ladder, before real money touches it.** A Stripe Price is
    IMMUTABLE. Starter $12/92 CR and Standard $19/138 CR are live in test mode;
    changing a rung later means a new Price object.
16. **1080p.** Never run, still `available: false`. Its deferral rests on an
    SSIM measured back when nothing could actually ORDER 720p, so **the
    reasoning is suspect** -- and an ordered 720p turned out to be a genuine step
    up. One metered run settles it. Paul has said he wants to sell the tier.
17. **Supabase: the rest of the migration.** Accounts, credits and sessions are
    still files. The identity slice is built and wired; the full migration was
    decided on 2026-08-25 and never started.

#### D — Smaller debt, real but not blocking

18. `npm run accounts -- create` mints a password nothing checks any more --
    Supabase decides. **THE `--help` HALF OF THIS IS STALE and was already
    fixed on 2026-08-26 in `7083519`** -- checked 2026-08-28, the help now
    prints "(that password cannot sign anyone in -- /login asks Supabase now,
    not this file)" directly beneath the create line. What genuinely remains is
    the DESIGN call: inspector, `invite`, or removal; open question 5 of the
    parent spec. Paul's, not Claude's.
19. The equal-time refusal guard no longer protects `/login`; that timing is
    Supabase's property now. **Known and accepted, not a regression to chase.**
20. `18352f4`'s commit MESSAGE on the remote still carries security detail.
    Rewriting published history is Paul's call and he has not made it.

#### Struck from this list after checking — do not re-open

- ~~PRODUCT.md still says "warm, grainy, quiet" and the vlog rewrite made it
  untrue.~~ **PRODUCT.md already records the change** and distinguishes the
  PICTURE (no longer quiet, cuts six times) from the TEXTURE (still warm,
  grainy, quiet). Nothing to do.
- ~~TODOs left in shipped code.~~ **Zero** `TODO`/`FIXME`/`XXX` in `scripts/`.

---

### 33. THE DOMAIN LANDED AND CLAUDE'S HALF OF THE LIST CLOSED (2026-08-28, evening)

**Suite 1679 / 1677 pass / 0 fail / 2 skipped**, from a 1678 / 1676 baseline —
the +1 is a new behavioural test on `npm run doctor`. **Six commits,
`096ba76..e7d2486`, NONE PUSHED.** `origin/main` is still `b6f64a3`, 127 commits
behind, no PR. Tree clean.

#### THE ONE THAT MATTERS: email reaches anybody now

`timestamptapes.com`, $10.46/yr, Cloudflare Registrar. **Nameservers delegated
instantly**, so the DNS propagation wait that made item 1 "the only item with a
WAIT attached" never happened — the whole day did not have to queue behind it.

Verified in Resend as the SUBDOMAIN `send.timestamptapes.com` (eu-west-1). DKIM,
MX and SPF all green. **The four records went in BY HAND rather than through
Resend's auto-configure**, which wanted ongoing write access to the zone: DNS is
the root of trust for mail AND for TLS issuance, and four one-time records are
not worth a standing third-party grant.

**THE HANDOFF HAD THE BLOCKER SLIGHTLY WRONG, and the correction is worth
keeping.** Custom SMTP and the `{{ .Token }}` six-digit template were already
done on 2026-08-27 (spec steps 9 and 6). What was still wrong is that Resend was
in **SANDBOX**, so the sender was the shared `onboarding@resend.dev` — which
delivers only to the Resend account owner and lands in Gmail's Spam. Moving
Supabase's SMTP sender onto the verified domain is the edit that opened it.
**Proved by the only evidence that counts: a real signup to an address that is
not the owner's received its six digits.**

#### The three self-contained items, each its own commit, all test-first

| Commit | What it does |
|---|---|
| `096ba76` | Both Linux CI reds — and a THIRD that was hiding behind the first |
| `493989b` | `npm run doctor` reads `.env` |
| `5be6c1f` | The pid goes in the directory for the last FOUR shared test paths |
| `382cbb5` | The request path's cookie parser keeps the FIRST value |
| `c0bb4ce` | The place rail fades instead of cutting a word in half |
| `e7d2486` | This file, corrected |

**A THIRD CI RED WAS HIDING BEHIND THE FIRST.** `intake-photo.test.js:182` threw
on Linux, so the GPS assertion below it NEVER RAN there. Fixing only the
reported failure would have turned that one red on the next CI run. Measured on
both images rather than reasoned about: ffprobe 8.1 (windows-latest) reports an
`EXIF metadata` side_data and prefixes GPS frame tags `GPSInfo/`; ffprobe 6.1
(ubuntu-latest) reports neither and names them flat, `GPSLatitudeRef`.

**AND THE SECOND RED WAS NOT WORDING, WHICH IS WHAT THE LIST SAID IT WAS.** It
was `234 !== -22` — the same EINVAL, truncated to 8 bits by POSIX. A per-OS
claim, not a per-build one. The unsigned-32 wrap stays tested in
`ffmpeg-run.test.js` against a literal, identically on both platforms, which is
why dropping it from the integration test is not a weakening.

**HOW TO RE-RUN THE LINUX CHECK FROM THIS WINDOWS MACHINE.** Docker Desktop is
installed and this works:

```bash
docker run --rm -v "/c/Users/pauls/Timestamp:/src:ro" ubuntu:24.04 bash -lc \
  "apt-get update -qq && apt-get install -y -qq ffmpeg curl xz-utils && ..."
```

Copy `scripts test config presets assets package.json` out of the read-only
mount into `/repo` and run there. **Omitting `presets/` produces bogus ENOENT
failures in `provider-contract`** that look like real breakage and are not.

#### Two findings that were the LIST being wrong, not the code

- **Item 18's `--help` complaint is stale.** It was fixed on 2026-08-26 in
  `7083519`. §32 claimed to have been built by checking; this one slipped.
- **Two of the three security findings re-checked were already closed.** The
  signup limiter exists, and `/auth/reset` exists — so "a leaked credential
  cannot be revoked" is no longer true.

**THE LESSON, since it has now happened twice in one session: a pending list
ages badly, and re-verifying an item costs minutes while acting on a stale one
costs an afternoon.** Check before you work an item.

#### A design review ran, and two of its three flags were the TOOL being wrong

`/design-review` against the live app. **One real finding, fixed** (`c0bb4ce`):
the landing's place rail had `scrollWidth 3066` against a `736` client — SIX of
the eight places outside the frame, and the first one outside it a word cut in
half. At 390px it was one of eight. A guillotined word reads as broken rather
than scrollable, and the place list is the landing's whole argument.

**The two dropped flags are the useful part:**

- The tool flagged `-apple-system…` as the "I gave up on typography" signal.
  **DESIGN.md answers it**: *"Body prose: the system sans stack. Prose is not
  the voice of this world; the readout is."* A second expressive body face would
  fight VT323 and the serif wordmark. Not a defect — a documented decision.
- The tool flagged the nav links as undersized touch targets (19px). **Measured
  67px centre-to-centre**, which clears SC 2.5.8's spacing exception exactly as
  §6b already recorded.

**What was NOT fixed and is a taste call:** the `CONTENT / TEXTURE / CONSENT`
block is a three-column symmetric grid, which is the canonical AI-generated
landing layout. Yours is a restrained instance of it and it is the only section
on that page that reads templated.

#### Things that will bite the next reader

- **`bun` WAS MISSING AND GSTACK SILENTLY DEPENDS ON IT — now installed.**
  `gstack-review-log`, `gstack-learnings-log` and the browse sidebar agent all
  failed with `bun: command not found`, so a clean `/review` left no record.
  Fixed with `npm install -g bun` (1.4.0). **Global on purpose:** a local
  install would put a dependency in `package.json`, which `guards.yml` fails
  the build over. Verified after: `dependencies {}`, no `node_modules`.
- **gstack's learnings logger rejects imperative text.** An insight phrased
  "Do NOT flag X" is refused as `suspicious instruction-like content` — an
  injection guard doing its job. Write learnings as description, not as
  instructions to a future agent.
- **`browse connect` needs port 34567 free AND no other daemon running.** A
  headless daemon from an earlier command holds it; `browse disconnect` then
  kill whatever holds 34567, then `connect`. A plain `browse <cmd>` will
  silently start a NEW headless daemon and drop your headed session.
- **The gstack browser is a SEPARATE Chromium with its own profile.** It does
  not carry your real Chrome's logins. Signing into Cloudflare or Resend there
  is a fresh login, and Claude must not type the credentials.
- **PowerShell here-strings (`@'...'@`) do not work in the Bash tool.** Use
  `git commit -F <file>` for multi-line messages — it also dodges the heredoc
  backslash-eating trap this file already warns about.

#### What is left, in the order it is worth doing

> **SUPERSEDED BY §34G — this list is the state on the evening of 2026-08-28
> and two of its four entries have moved. Item 3's Dockerfile now exists, and
> item 14 turned out not to be the exposure this entry describes.** Kept as the
> record of what the day handed on; act on §34G.

1. **THE BLIND CHECK (§32 item 5).** Free, ten minutes, still unsent at
   `out/blind-check/`. **It is now the only thing on the critical path that
   needs nobody but Paul**, and it still decides whether any of the rest
   matters. *(Still true, and still the most important item.)*
2. **The free-tape ceiling (§32 item 14).** 21 CR at signup is $2.07 of real fal
   spend per account, ~$207 against a ceiling of 100. **Strangers can create
   accounts as of tonight**, so this stopped being theoretical. *(Half wrong —
   the grant needs a CONFIRMED identity, so a script cannot drain it. §34E.)*
3. **Deploy (§32 item 3).** Newly possible — there is a domain. **No host
   chosen and no config exists.** The binding constraint is that the queue
   claims jobs with `linkSync`, so web and worker need ONE shared block
   filesystem: that rules out Render and Railway (a disk attaches to one
   service) and every serverless runtime. One small VM, or one Fly machine with
   both processes in it. A Dockerfile is host-agnostic and was offered but not
   written. *(Written and proved 2026-08-29 — §34A. The constraint above is
   confirmed by measurement, and Fly's volumes are single-attach, so it needs
   both processes in ONE Machine. The host is still unchosen.)*
4. **Open the PR (§32 item 7).** Item 6 was the gate and it is closed.


---

### 34. THE APP CAN BE CONTAINERISED, AND THREE FRAME SHAPES ARE REAL (2026-08-29)

**Suite 1712 / 1710 pass / 0 fail / 2 skipped**, from a 1679 / 1677 baseline —
the +33 are all new tests, nothing was dropped or weakened. **Twelve commits,
`4f49ee4..9c4f16d`, NONE PUSHED.** `origin/main` is still `b6f64a3`, now **141
commits behind**, no PR. Tree clean. All five `guards.yml` checks pass locally,
`dependencies` is still `{}`, and no commit message or added line names a
security finding.

Two items were worked: **§32 item 3** (deploy — the Dockerfile half) and **§32
item 9** (the rest of the security review). The frame-shape work came out of
re-verifying item 11 and finding it was a live defect rather than a decision.

#### A — THE IMAGE EXISTS. THE HOST IS STILL PAUL'S CALL AND IS THE ONE THING BLOCKING DEPLOY.

`Dockerfile`, `.dockerignore`, `.gitattributes`, `test/deploy-image.test.js`
(13 tests). It names **no host on purpose** — what it encodes is the constraint
that picks one: the queue claims with `linkSync`, so `/data` is a VOLUME and
the two commands are one image with different arguments.

**PROVEN BY BUILDING AND RUNNING IT, not by reading it.** The image builds; the
preflight gates it at build time with all 36 filters green; **nothing named
`.env` or `*.pem` exists anywhere in its filesystem**; web and worker
containers on one volume see one filesystem, both run as uid 1000, and `ln` —
the exact primitive `queue.mjs` claims jobs with — is genuinely exclusive
across them, the second attempt refused.

**Three things are pinned and each for its own reason.** The base image **by
digest** (`node:22-bookworm-slim@sha256:83f487e0…`), because a tag moves and
"rebuild it" has to mean the same thing twice. ffmpeg **by MAJOR version**
rather than an exact apt pin — pinning the patch would refuse security updates
to the thing that parses strangers' uploads, while a major bump is what would
silently change filter behaviour. And **the preflight runs AT BUILD TIME**, so
an ffmpeg without `chromashift` produces no image instead of a container that
fails after the provider has been paid.

**MEASURED, FOR SIZING A HOST:** a full fixture render on **2 vCPU / 4 GB took
97 seconds** (conservative — the fixture generates the source clip locally,
which fal does remotely). Image is **989 MB**, mostly ffmpeg's codec libraries.
A job directory is **44–65 MB**; `out/` here is 954 MB for ~26 jobs.

**THE HOST OPTIONS, WITH REAL PRICES READ ON 2026-08-29** (not from memory):

| | spec | cost | notes |
|---|---|---|---|
| Hetzner CX23 | 2 vCPU x86, 4 GB, 40 GB, 20 TB | **€4.49–5.49/mo** | Cheapest by ~4x. Two containers, one volume — the shape that was proved. Needs Caddy for TLS. Two sources disagree ~€1 over IPv4/VAT. |
| Hetzner CAX11 | 2 vCPU ARM, 4 GB, 40 GB | **€4.99–5.99/mo** | Same shape. Debian has arm64 ffmpeg and the digest is a manifest list, so it should work — **verified on amd64 ONLY.** |
| DigitalOcean | 2 vCPU, 4 GB, 80 GB | **$24/mo** | Same topology, ~4x the price; you pay for docs and tooling, not machine. |
| Fly.io | shared-cpu-2x, 4 GB | **~$21.6/mo + $6 volume** | TLS is automatic. **But volumes are STRICTLY single-attach** — "a volume can be attached to only one Machine" — so web and worker must share ONE Machine behind a supervisor this Dockerfile does not have. |

**Paul was asked and did not pick. Nothing else in the deploy is worth building
until he does**, because the topology file (compose vs fly.toml + supervisor)
is the next artefact and it is shaped by the answer.

**WHAT ELSE THE DEPLOY STILL NEEDS, and none of it is testable from
`node --test`:** TLS termination (which is also what finally makes
`TIMESTAMP_TRUST_PROXY=1` correct, and unlocks the `__Host-` cookie prefix),
plus a runbook for the five consoles — Supabase redirect URLs and Site URL, the
Google OAuth authorized redirect, a new Stripe webhook endpoint and signing
secret, `TIMESTAMP_PUBLIC_URL`, DNS. **Every one of the three Google sign-in
failures was dashboard-shaped and invisible to the suite (§A of START HERE).
Going live repeats that risk across five consoles at once.**

#### B — TWO BUGS THAT ONLY RUNNING THE IMAGE COULD FIND

1. **A fresh named volume is root-owned.** Docker takes the volume's ownership
   from whatever the image has at that path; with nothing there, `USER node`
   could not write. The container started, printed nothing but
   `EACCES: permission denied, mkdir '/data/out/queue/pending'`, and refused
   every connection from outside. The mkdir and chown now run **while the build
   is still root**, and the test asserts the ORDERING — after the USER switch
   it would no longer have the privilege.
2. **A FRESH CLONE ON THIS MACHINE COULD NOT HAVE BUILT THE IMAGE.**
   `core.autocrlf` is true here, so a clone rewrites LF to CRLF, and a CRLF
   Dockerfile does not parse: `dockerfile parse error on line 3: unknown
   instruction: echo`, because a `\` continuation followed by CR is not a
   continuation. Four of them, all in the ffmpeg layer. Fixed with
   `.gitattributes`; **verified with a real clone at `autocrlf=true` that then
   built**, with `CLAUDE.md` (unpinned) still showing CR as the control.

**AND THE TWO FILES BEHAVE DIFFERENTLY, WHICH IS WHY ONLY ONE IS A BUG.**
Measured against real builds: a CRLF **Dockerfile** fails to parse; a CRLF
**`.dockerignore`** still works, because BuildKit strips the CR — a probe image
built with `.env\r\n` in it genuinely excluded `.env`. That second result is
also what makes the test's ignore matcher honest, since it `.trim()`s each
line; had BuildKit behaved the other way that would have been a hole big enough
to ship seven secrets through. `.dockerignore` is pinned to LF anyway.

#### C — THE SECURITY REVIEW: FIVE CLOSED, THREE LEFT AND ALL THREE ARE PAUL'S OR LOW

**`docs/security-review-2026-08-25.md` is still local and still gitignored, and
must stay both.** What each commit DOES is below; what it CLOSED is in the
review and is not restated here, in a commit message, or in a PR description.

Each was **re-verified against current code before being worked** — and one
item the review still lists as open (the signup limiter) was already closed.

| Commit | What it does |
|---|---|
| `7d267ae` | The billing page can only render the two notices this app wrote — `?checkout=constructor` used to print `function Object() { [native code] }` into a `<p class="notice">`. Not XSS (`h()` escapes it, checked); a money page that can be made to say something else at all. |
| `9cefcae` | `GET /api/health` stops doing two synchronous filesystem walks per hit. Cost grew **without bound** — `out/queue/done` and `failed` accumulate one file per job forever. Now on the same 30 s timer as the ffmpeg check beside it, which had been cached since it was written for exactly this reason. |
| `8a325fd` | The provider allow-list gates **every hop**, not just the first. Node's fetch follows up to 20 redirects, so an allowlisted host answering `302 → 169.254.169.254` was followed — the cloud metadata service, which this project is about to have one of. |
| `ea806e9` | An over-cap body gets a readable **413** instead of `ECONNRESET`. |
| `f487b4d` | An account error names the code, never the address a person typed. |

**TWO THINGS WORTH KEEPING FROM THOSE FIVE:**

- **The 413 took TWO changes and the second is the interesting one.** Pausing
  instead of destroying was not enough: `fail`'s own teardown then called
  `socket.destroy()`, and a destroy with unread inbound data sends a RESET,
  which discards the response just written. So the branch that exists to
  deliver a refusal mid-upload was destroying that refusal whenever it ran. It
  is a FIN now plus an unref'd 1 s grace timer — the timer keeps the original
  guarantee, because FIN only *asks* the peer to stop. **The existing 13 MB
  upload 413 test still passes**; that path had been getting away with the same
  latent race because its sender finishes writing first.
- **The PII fix went in at the SOURCE, not at the five log sites.** A log site
  is added by whoever adds the next route and careful handling does not travel
  with it. An error that never carries the address cannot leak it through a
  call site nobody has written yet.

**STILL OPEN, and all three are deliberately left:** the multipart
write-amplification item (LOW, bounded by `maxBytes`, needs an authenticated
account with credits); `stillCount` client-chosen and unpriced (**still arms on
the `config/models.json` still-model edit** — that warning stands, and the
aspect edit below did NOT arm it); and the second cookie parser, whose deletion
is a dependency-shape decision for Paul since `session-middleware.mjs` imports
only node builtins.

#### D — THE FRAME-SHAPE MENU WAS A LIVE DEFECT, AND NOW IT IS A FEATURE

**Found by re-verifying §32 item 11 rather than trusting it.**
`config/render.json` marked 16:9 and 9:16 available and the form rendered all
three, while `resolveRaster` refused every non-default shape on a **paid**
provider. Invisible locally because the web app defaults to the fixture — and a
guaranteed compose failure, after the credits are debited, the moment a real
provider is configured. **Which is what deploying means.**

`03b1f13` made the menu honest first (no pricing decision needed). Then four
commits made it real, at **Paul's direction on the price**:

| Commit | What it does |
|---|---|
| `8390672` | A resolution label names the **short edge**, so a shape changes the long one — §13's tape rule one layer down. |
| `760d968` | The price follows the shape: **28 CR at 480p, 61 at 720p** for 16:9 and 9:16, against 21 and 46 for 4:3. |
| `81d3e6e` | The ordered shape goes on the wire; the contract's stale 4:3 rule becomes a list. |
| `9c4f16d` | The refusal lifts, the menu opens, and the shape reaches the charge. |

**THE PRICE IS 4/3 AND THE DERIVATION IS THE JUSTIFICATION.** 4:3 is the
squarest shape shipped and a label holds the short edge, so 16:9 and 9:16 are
**exactly 4/3 the pixels** at the same tier — 854x480 against 640x480, 1280x720
against 960x720. fal bills tokens as pixels x seconds. **Paul chose to charge
it rather than flat-price**, on the argument that 9:16 is the phone format on a
product that delivers to phones, so a flat price would subsidise the *modal*
order at ~47% gross instead of 60% — and that 60% is already spent, since the
credit-packs spec sets it to absorb the free retries direct mode made
inevitable when it deleted the cheap rejection gate.

**61 AND NOT 62.** The multiplier applies to the DOLLAR figure with the ceiling
taken once: $4.5646 x 4/3 / $0.10 = 60.86 → 61. Multiplying the already-rounded
46 CR gives 62, which charges a credit for a rounding step. **A number quoted
as 62 mid-session was double-rounded arithmetic, not the code.**

**THE MULTIPLIER IS PER SHAPE, NOT ONE NUMBER FOR "NOT THE DEFAULT."** Holding
the short edge makes a **1:1 tape 0.75x** the pixels of 4:3, not 4/3 — so a
single constant would be wrong the day somebody adds a square shape, and wrong
in the direction that overcharges. An unpriced shape is REFUSED, and there is a
test that `1:1` specifically is.

**THE MONEY WIRING WAS THE DANGEROUS PART AND HAD THREE PLACES TO GO WRONG.**
The handler read `aspect`, validated it, then computed credits from the
resolution alone — the exact pass-through shape §26 records three times in one
morning. Opening the menu without fixing that would have sold every wide tape a
third below cost, invisibly, exactly as 480p was for weeks. `costOf`, the
session seam and `creditCost` all take the shape now, with a sabotage for each.

**PROVEN END TO END.** A 9:16 tape through the fixture: 375 frames, 15s,
-26.9 LUFS. The file is 1080x1920 — **but so is a MATTED 4:3, so dimensions
prove nothing alone.** Edge luma does: top 68.3, bottom 83.6, centre 109.4, all
picture, against ~24 for a 4:3 surround. Genuinely full-bleed portrait.

**A CLAIM THAT WAS WRONG AND IS CORRECTED IN THREE PLACES** (`fal.mjs`'s
header, `config/models.json`, and §18's closing paragraph): "16:9 at 1024x576
is FEWER pixels than 4:3 at 720p" compared the **TAPE** raster against the
**SOURCE** raster ordered from fal. Those are different things and fal bills
the second. Wide shapes cost **more**, not less, which is why the pricing had
to land before the menu opened.

**STILL UNMEASURED, and it is the one number that could move:** no non-4:3
shape has ever been ORDERED from fal, and the endpoint picks its own delivered
raster — 752x560 for an ordered 640x480. If that upscale differs by SHAPE
rather than by tier, the 4/3 multiplier moves. One metered wide render settles
it and `npm run ledger` will name the gap.

#### E — A CORRECTION TO §32 ITEM 14, FOUND BY CHECKING

**The free-tape exposure is smaller than that item says.** The grant happens
only inside `createAccount`, which is reached solely through `resolveIdentity`
— i.e. after a confirmed six-digit code, a password login against a confirmed
account, or a real Google round trip. So "100 scripted signups exhaust the
lifetime budget" is **not reachable**; an attacker needs 100 confirmable
mailboxes. It remains a real pricing question ($2.07 a signup, ~$207 against
the ceiling) but it is **not an attack surface**, and it moves out of the
urgent column into Paul's.

#### F — THINGS THAT WILL BITE THE NEXT READER

- **The Bash tool eats backslashes and it bit again.** A `node -e` one-liner
  with `\\/` in a regex became a syntax error. This file has warned about it
  since §31; the rule is unchanged — **use Write/Edit for anything containing
  regex escapes**, never a shell heredoc or a `-e` string.
- **Git Bash mangles `/data` into `C:/Program Files/Git/data`** when passed as
  a docker argument. It cost one confusing `EACCES` that looked like the volume
  bug and was not. `MSYS_NO_PATHCONV=1` before `docker run`. The Dockerfile's
  own `CMD` is a JSON array and is unaffected — only command-line overrides.
- **A JS `String.replace` hits the FIRST occurrence**, and in these files the
  first occurrence is usually in a comment. One sabotage sweep reported a
  guard as broken when the harness had merely edited prose. Anchor mutations to
  the real line (`/^CMD .*$/m`), and **treat an uncaught sabotage as suspect
  until you have proved the mutation actually changed the code.**
- **`core.autocrlf` is true, so a `String.replace` with `\n` in a multi-line
  match silently fails on tracked files.** Use a regex with `\s*`.
- **Three sabotages escaped their first sweep this session and every one
  revealed a MISSING TEST rather than working code**: a malformed aspect
  falling back to 4:3, the contract's shape refusal disabled outright, and the
  loopback bind. Two of the three were things where the *positive* case was
  asserted and the *refusal* never was. **Sabotage every assertion, and when
  one escapes, the test is the thing to fix.**
- **`npm test` now reaches `contract.mjs` from the web layer**, and that is
  fine and guarded: a new test walks `server.mjs`'s static import graph and
  fails if a paid provider appears in it. It deliberately does not follow
  `import()`, because the dynamic import is the sanctioned escape hatch. It
  names the two provider modules that ARE allowed, so a third is a decision.

#### G — WHAT IS LEFT, in the order it is worth doing

1. **THE BLIND CHECK (§32 item 5).** Free, ten minutes, still unsent at
   `out/blind-check/`. Still the only thing on the critical path that needs
   nobody but Paul, and it now decides the fate of noticeably more work than it
   did a day ago.
2. **PICK A HOST (§A above).** It is the single gate on the whole remaining
   deploy, and it is a thirty-second decision with the table above.
3. **Then the deploy**, in this order: topology file, TLS + `__Host-` +
   `TIMESTAMP_TRUST_PROXY`, then the five-console runbook.
4. **Open the PR (§32 item 7).** Its gate closed on 2026-08-28.

**NOT PROPOSED NEXT, deliberately:** the rest of the Supabase migration
(accounts, credits and sessions are still files — that migration was decided
*for identity*, which is done, and files are fine on one VM with one volume),
and the three tape-quality items (punch-in zoom, ambience tones, audible cuts
at shot boundaries). The tape items feed the blind check and are worth doing —
but judging them needs Paul's paid runs.

---

### 35. THE AUDIT, AND THE TWO CRITICALS IT FOUND ON THE PAID PATH (2026-08-29, evening)

**1712 / 1710 → 1739 / 1737, 0 fail throughout. Seventeen commits,
`4d08ff6..42b3745`. Tree clean. NOTHING PUSHED THIS SESSION.** All seven
`guards.yml` checks run green locally, including two new ones.

A full gstack `/cso` audit: five auditors in parallel over auth, money, the web
request surface, infra/supply-chain, and render correctness, plus live probing
against the running app. Eighteen findings closed, each test-first, each
sabotage-verified where a guard was involved.

**THE FINDINGS THEMSELVES ARE IN `docs/security-review-2026-08-29.md`, WHICH IS
GITIGNORED AND MUST STAY THAT WAY.** This section says what the code now DOES.
It does not say what each fix closed, and neither does any commit message —
that rule is the whole subject of §35D. Read the file.

#### A — The two CRITICALs, both on the shipped paid path, both invisible to 1712 passing tests

**EVERY 16:9 AND 9:16 TAPE WAS CROPPED TO 4:3 AND STRETCHED** (`4d08ff6`). The
source crop was a hardcoded `4/3` sitting one line above a `scale` target that
reads `cfg.tape`, so the ratio did not follow the shape. Measured on rendered
frames, not reasoned about:

```
4:3    497x497   roundness 1.000   unaffected -- it was always the default
16:9   878x662   roundness 1.326   stretched horizontally
9:16   667x1551  roundness 0.430   stretched 2.33x vertically
```

A 9:16 tape threw away 58% of the frame and delivered a circle two and a half
times taller than wide, on the shape the customer pays a 4/3 premium for. It is
the DISPLAY aspect and not `width/height`, because the source has square pixels
and the 4:3 tape does not (SAR 16/15) — reduced, 4:3 comes out as exactly `4/3`,
so the default shape's graph is byte-identical and the golden test never moved.

**A DIRECT RENDER PAID FAL AND THEN THREW** (`059e3fd`). `generateVideo`
resolved `size` and did not hand it to `estimateVideo`. Harmless on a
per-SECOND model, fatal on the per-TOKEN one — which is the only video model the
direct path uses. Submit succeeded, poll completed, **the mp4 landed on disk**,
then the cost line threw: `completeIntent` never ran, no tape shipped, and on
resume `decideIntent` could not adopt the clip because `clip.path` was never
written, so the job either hard-stopped or paid again. The last good direct run
predates the token-pricing change that introduced the requirement, which is why
nobody had met it.

#### B — What else shipped, and the shape most of it shares

Six of the eighteen are the same shape: **a value that exists, is correct, and
is not handed on** — the class §26 records three of. `aspect` was the new
dimension and it was dropped in three more places.

| Commit | What it does |
|---|---|
| `944501e` | `--dry-run` gets the shape, so a quote matches the bill: 720p 9:16 went from quoting $4.5646 to $6.2625, which is what it bills |
| `72193a4` | A shape with no tier is refused rather than silently fetching a 4:3 source |
| `5c2804b` | Three guards check the layer they actually bind at, and `.gitignore` covers the file FAMILY |
| `18f154b` | `--stop-after` the worker does not recognise is a refusal, not a silent spend |
| `5f6dfc0` | Only a human supersedes an open intent, so an automatic revive cannot re-buy a paid call |
| `e0c0d77` | The still count the API accepts is the one the page offers |
| `5643f03` | The number on the button is the number on the ledger, for every shape |
| `f5866d7` | The app cannot rewrite its own code |
| `544d475` | The upload sink is looked up by own property, not by inheritance |
| `506604e` | A per-unit rate is rounded by significant figures, not decimal places |
| `adff90d` | A foreign page cannot sign somebody out |
| `7d783bc` | A job reaped to death gets its credits back, and says which directory it went to |
| `58a17c1` | A manifest the purge cannot read is reported, not invisible |
| `6c4f6ef` | The compose log names the shape that was actually frozen |
| `42b3745` | Geometry is asserted on pixels |

**THE GUARD THAT HAD BEEN PASSING VACUOUSLY IS WORTH ITS OWN LINE.**
`guards.yml`'s "the fal adapter has no default fetch" greps `fal.mjs` — but
`requireFetchImpl` lives in `contract.mjs` and `fal.mjs` only CALLS it. The
regex matched nothing, so the check could not fail, and four independent money
guards were quietly three. It is asserted behaviourally now, by running it.

**AND `.gitignore` MATCHED A NAME, NOT A FAMILY.** `git check-ignore` reported
NOT-IGNORED for `.env.local`, `.env.production`, `tls.pem` and `server.key`,
while `.dockerignore` already covered all four — the image was better protected
than the PUBLIC repo. The deploy that is next terminates TLS on a small VM,
which is exactly the workflow that writes those files.
`test/repo-hygiene.test.js` asserts it against `git check-ignore` rather than
against the text of a pattern, because a pattern can be right and still not
match.

#### C — Video QA, and the blind spot it closed in this session's own work

The crop fix was verified by arithmetic and by reading the emitted filtergraph.
**Neither looks at a frame**, which is the same blind spot as the end-to-end
9:16 check that shipped the feature: it measured frames, duration, LUFS and edge
luma, and a tape cropped to the wrong shape has exactly the right value for all
four.

`test/tapedeck-geometry.test.js` renders one frame through the real graph in
each shape and **measures a circle**. A circle is the probe because its
distortion is unambiguous: squeeze either axis and the bounding box stops being
square, and the ratio IS the distortion factor. The numbers in §35A are that
test run against the pre-fix code. 2.5 seconds, and it is the only assertion in
this repository that can see a geometric error.

**The source rasters are what fal RETURNS, not what is ordered.** The endpoint
upscales and picks its own size and the crop operates on what arrives, so
testing at the ordered raster would miss the entire defect.

#### D — Three corrections to this file

1. **"NOTHING IS PUSHED" was never true.** `origin/supabase-identity-slice`
   exists at `d1f56e1` and `origin/ui-redesign-signed-in-page` at `5c3267e`.
2. **§32 item 20 names one commit; there are THREE**, and all three are
   reachable from those pushed branches: `18352f4`, `190a9ec`, `6efb0e6`. A new
   guard scans commit messages — the path check at `guards.yml:56` was never
   able to see a message, which is why it stayed green. **The three are named as
   known exceptions in the workflow so CI is green on new work while the history
   decision is Paul's.** Rewriting published history is his call; note GitHub
   serves unreachable commits by SHA indefinitely, so closing the disclosed
   items is the durable answer either way.
3. **§34E's conclusion about the free-tape exposure does not hold.** It reasons
   that the grant is safe because it needs a confirmed identity. The premise is
   true and the conclusion does not follow. **THIS ONE IS STILL OPEN, so the
   mechanism is NOT written here** — it is in
   `docs/security-review-2026-08-29.md`, which is gitignored, and this file is
   committed to a public repo. Same rule as `.gitignore:16` and the same rule
   §35D item 2 exists because somebody broke. **Read the review before touching
   `normaliseEmail` or `reserveFreeTape`.** What is safe to say here: it is a
   product decision rather than a defect fix, and §35F says why.

#### E — Two things that will bite the next reader

- **A test that asserts something was NOT written passes vacuously when it reads
  the wrong directory.** `[].every()` is true. My first upload-sink test looked
  in `input/` — but the legitimate sink values already carry that prefix, so a
  stray filename lands in the job directory ROOT — found nothing, and passed
  against a deliberately sabotaged guard. **Assert the legitimate artefact is
  PRESENT first, then assert the absence.** This is CLAUDE.md's own
  uncaught-sabotage rule earning its place twice in one session.
- **The Bash heredoc ate backslashes again**, twice, exactly as §31 warns. A
  `\n` inside a Python-in-heredoc replacement arrived as a real newline and
  broke `views.mjs`. **Use Write/Edit for anything containing an escape.**

#### F — What is left

**PAUL'S, and both are short:**

1. **THE BLIND CHECK.** Free, ten minutes, unsent at `out/blind-check/`. Top
   item for three sessions. More work depends on it now than did yesterday.
2. **PICK A DEPLOY HOST.** §34A. Thirty seconds, and it gates the whole
   remaining deploy.

**ONE FINDING LEFT OPEN ON PURPOSE**, and it is §35D item 3. It touches how an
address is normalised before it becomes an account, which changes WHO CAN SIGN
UP and carries migration risk against existing account records — so it is a
product decision rather than a defect fix, and it is Paul's.

**The mechanism and the numbers are in the gitignored review, not here.** What
belongs in a public file is the shape of the decision and the implementation
note that goes with it: **if it is taken, the narrow form only.** The broader
form is provider-specific, riskier, and getting address canonicalisation wrong
in auth means two people colliding on one account.

~~**NOT RUN THIS SESSION:** `/qa`, `/design-review`, `/devex-review`,
`/health`.~~ **`/qa` AND `/review` HAVE NOW RUN — SECTION 36.** And this line
was wrong about `/design-review`: it ran on 2026-08-28 and §33 records what it
found. What is genuinely never-run is `/devex-review` and `/health`.

**STILL UNMEASURED, and one paid render settles three questions at once:** no
non-4:3 shape has ever been ORDERED from fal. A single 720p 9:16 render would
confirm whether the delivered upscale differs by SHAPE (which would move the
4/3 multiplier), whether the vlog shot list composes in portrait, and — with the
same file — feed the blind check.

---

### 36. THE FIRST /qa, THEN /review — AND FOUR SENTENCES THAT NEVER LEARNED ABOUT THE FRAME MENU (2026-08-29, night)

**1739 / 1737 → 1754 / 1752, 0 fail throughout, 2 skipped.** The +15 are all new
tests. **Eleven commits, `39e08d1..278bd12`. Tree clean. PUSHED — see §36E,
which corrects this file about what `origin` holds.**

Two passes the audit had left owed. `/qa` drove the running app in a real
browser; `/review` read the 47-file delta since the last clean review at
`b199919`. Six defects each, eleven fixed in total, every one test-first and
sabotage-verified.

#### A — THE THEME: THE SHAPE REACHED THE CODE AND NOT THE COPY

§34D threaded `aspect` through the raster, the provider request, the charge,
the dry run, the crop and the compose log. It did not reach the PROSE, and four
separate user-facing sentences still described a 4:3-only product:

| Where | Said | True |
|---|---|---|
| Quality tier card | 480p ~21 CR · 720p ~46 CR | 28 and 61 in 16:9 or 9:16 |
| Quality hint | "the same 1080x1920 file ... the tape works at 720x576" | 16:9 delivers 1920x1080 from 1024x576 |
| Result page caption | "720x576 PAL", on every tape ever made | 1024x576 for 16:9, 576x1024 for 9:16 |
| Pricing rungs | "4 tapes at 480p", "1 tape at 480p" | 3, and NONE, in the wide shapes |

**THE FIRST ONE PUT TWO PRICES FOR ONE TAPE ON ONE SCREEN.** With 9:16 chosen
the card said ~46 CR while the estimate two panels below said ~61 CR, and the
ledger takes the second — measured end to end, an account went 153 → 125 on a
16:9 480p order while the card beside the button said 21. Nobody was
overcharged; the card advertised a third under the charge, which is how a
customer arrives believing they were.

**AND IT WAS ALREADY FIXED FIVE LINES AWAY.** The comment above `costLines` in
`views.mjs` records this exact defect — "The page said ~21 CR and the ledger
took 28" — fixed on the estimate line and left behind on the card above it.

**THE FREE RUNG IS THE ONE THAT MATTERS.** 21 credits buy one 4:3 tape and
nothing at all in 9:16, which is the phone shape most people are here for.
Somebody could sign up, read "1 tape at 480p", pick the phone frame and be
refused at the button.

**PROSE IS A CONSUMER OF A NEW DIMENSION TOO.** This file already warns that a
shape must reach four places and not one. Add a fifth: grep the rendered
strings and the hardcoded literals, not only the functions that take the value.

#### B — SIGN OUT WAS OFF THE SCREEN, ON THE OWNER'S OWN ACCOUNT

`.nav` is a flex row and the email is the only item in it whose width the
customer chooses. A flex item defaults to `min-width: auto` and will not shrink
below its text, so a long address widened the nav past the viewport and carried
`Sign out` off the right edge with nothing on screen to say it was there.

Measured on `/pricing`, signed in, `scrollWidth − clientWidth`:

| viewport | dev@example.com (15) | 33-char Gmail | 40-char Gmail |
|---|---|---|---|
| 320px | 5px | 106px | 155px |
| 375px | 0px | **51px** | **100px** |
| 414px | 0px | 12px | 61px |

**375px is the commonest phone width and one of the six this project tests at,
and two of the six accounts in this app's own store are over 32 characters —
including Paul's.** The account that shipped this could not reach its own
sign-out button on a phone.

**THE FIRST FIX WENT GREEN WHILE THE PAGE WAS STILL BROKEN, and that is why
there are two tests rather than three assertions.** `min-width: 0` on `.who` is
necessary and not sufficient: the nav is ITSELF a flex item inside `.masthead`
and carries the same default, so it was still handed its full content width and
`.who` was never squeezed. Re-measured with only `.who` fixed: still 44px at
375px, unchanged. **The chain gives way at every link or at none.**

#### C — /review: THE GUARD §35 ADDED COULD NOT SEE A SINGLE COMMIT

**`actions/checkout` defaults to `fetch-depth: 1`.** In a depth-1 clone
`origin/main` does not exist at all, so the commit-message guard's
`git rev-list origin/main..HEAD` fails and its fallback `git rev-list -n 50
HEAD` returns exactly ONE commit — and on a `pull_request` that one commit is
GitHub's own generated merge commit, whose message is "Merge <sha> into <sha>".

**So the guard written to read every commit message would have read none of
them, on every PR, and reported green.** Measured rather than reasoned about:
cloned at `--depth 1` and ran the guard's loop verbatim — 1 commit. With full
history, 165, all clean. Fixed with `fetch-depth: 0` (`e31a13f`).

**THIS IS §35's OWN LESSON ONE LAYER OVER.** The path check could not see a
commit message; its replacement could not see the commits. **When auditing a
control, run it and confirm it can fail** — and for anything that walks history,
that means checking what CI actually hands it.

#### D — The other five from /review

| Commit | What it does |
|---|---|
| `f064f6b` | The aspects comment names 61, which is what the code charges — 62 was the double-rounded figure §34D already corrects |
| `09202f8` | `isPaidProviderId` was exported and referenced nowhere; the list and its test stay |
| `6f12d85` | Six raw NUL sentinels made a 320-line test file BINARY to git — `Bin 0 -> 15383 bytes`, invisible in every diff and PR, on the file that guards the deploy artefact |
| `8a317bc` | A bare `catch {}` in the quote map could not tell a designed refusal from a bug; it rethrows anything that is not `UNKNOWN_ASPECT` or `RESOLUTION_UNAVAILABLE` |
| `278bd12` | The redirect loop's hop cap and its redirect-path credential check had no tests at all |

**THE BINARY TEST FILE IS WORTH ITS OWN SENTENCE.** It parsed, and twelve of
twelve tests passed, the whole time — which is exactly why nobody noticed that
the file could not be reviewed. Git calls a blob binary on a NUL in the first
8000 bytes, so any other control character is an identical sentinel and none can
appear in a path. Verified with `git diff --no-index`: old content reports
`Bin` for a two-line change, new content reports `2 insertions(+)`.

#### E — THREE CORRECTIONS TO THIS FILE

1. **"NOTHING IS PUSHED" IS NO LONGER TRUE, and this section is the push.**
   `origin/supabase-identity-slice` was 45 commits behind local; it is current
   as of §36. `origin/main` is still `b6f64a3` and **no PR is open** — that is
   still Paul's line, and it is now the only thing between this branch and its
   first CI run.
2. **§35F said `/design-review` had never run. It ran on 2026-08-28** and §33
   records what it found. What is genuinely never-run is `/devex-review` and
   `/health`.
3. **The landing background is fine and an annotated screenshot will tell you it
   is not.** `.bgs` is `position: fixed`, so a full-page screenshot paints it
   only over the viewport and the rest of the canvas comes out flat. Measured
   before believing it: 1280x800 fixed, z-index −2, video playing,
   `readyState 4`. Two of this session's own measurements were wrong before they
   were right — that one, and a contrast probe that flagged 18 failures by
   ignoring gradient backgrounds and comparing white caption text against an
   assumed white ground. **Neither became a finding, because both were checked.**

#### F — Things that will bite

- **A CSS FIX READS AS INEFFECTIVE UNTIL THE BROWSER IS RESTARTED.**
  `/styles.css` is served `max-age=300`, so after editing `static.mjs` a page
  reload keeps the OLD stylesheet even with the node server restarted. Confirmed
  by fetching `/styles.css` directly (new rule present) while `getComputedStyle`
  still returned the old value. Restart the browser, not just the server — and
  note that drops any injected cookie, so set it again after.
- **A REGRESSION TEST CAN GO GREEN WHILE THE PAGE IS STILL BROKEN.** §36B. If a
  fix needs two layers and the test asserts one, it passes and the bug ships.
  When a fix does not work, check whether the test would have noticed.
- **THE `_` FILTER IS NOT EVERYWHERE.** `aspectIds()` in `tapedeck/frame.mjs`
  filters `_`-prefixed config keys; `creditCost` in `auth/credits.mjs` builds
  its `known` list without filtering. Harmless today because credits.json's
  `aspects` map carries no `_comment` — but render.json's sibling map does, so
  it is one config edit away from listing `_comment` as a known shape.
- **The Bash heredoc ate a control character and the tool refused the command.**
  Third session running. **Use Write/Edit for any file containing an escape.**

#### G — What is left

**PAUL'S, unchanged and still short:**

1. **THE BLIND CHECK.** Free, ten minutes, unsent at `out/blind-check/`. Top
   item for four sessions. Nothing in §36 touched it.
2. **PICK A DEPLOY HOST.** §34A. Thirty seconds, gates the whole deploy.
3. **OPEN THE PR.** Newly the only thing between this branch and CI. The push
   in §36E does not open one.

**NOT RUN, and honestly:** the adversarial half of `/review` did not happen.
Codex is not installed, and the Claude subagent was not dispatched, so the four
specialist checklists (testing, maintainability, security, performance) were
applied INLINE by the same context that did the structured pass rather than by
independent reviewers. Same checklists, weaker independence. `/devex-review`
and `/health` have still never run.

### 37. THE LAUNCH-READINESS REVIEW, AND THE FIRST TRANCHE OF ITS FIX LIST (2026-08-29, later that night)

**1754 / 1752 → 1786 / 1784, 0 fail throughout, 2 skipped.** Seven code
commits, `474722f..5413199`, plus this documentation pass — every one
test-first, every guard sabotage-verified, full suite run before each commit.
**PUSHED**, so PR #1 re-runs CI on them.

#### A — The review, and the verdict

Paul asked for the whole project to be reviewed for customer readiness by an
orchestrated team. Seven dimension auditors ran in parallel (product, deploy,
security/legal, money, quality, UX, operations — Opus on the judgment-heavy
three, Sonnet on the rest) plus an adversarial completeness critic: 8 agents,
~1.7M tokens, 330 tool calls, every load-bearing claim verified in code, by
DNS, or against GitHub rather than read from this file. **Verdict: NOT READY
— 0 of 7 dimensions passed, roughly 55% of the launch work done.** Dimension
scores 18–58 of 100. The consistent shape: the ENGINE is top-decile (this
file's own record holds up), and the ENVELOPE barely exists — no legal pages
among 41 routes, no support channel, no image moderation behind the checkbox,
no account deletion, test-mode-only Stripe, no host, no backups, no alerting.
The full report is Paul's private artifact; the security reviews stayed
counted-not-quoted throughout.

#### B — Four corrections to this file's record, each verified before repeating

1. **PR #1 exists and its first CI run was GREEN.** Opened 2026-08-29
   12:23:48Z by Paul; guards 10s, all four test legs 2m40s–3m22s, SUCCESS.
   The banner's "no PR / no CI ever" was true when written and stale within
   hours — item 7 of §32 is DONE.
2. **`timestamptapes.com` has NO MX RECORD.** Verified by DNS query, not
   inference. Five independent auditors prescribed "add a support email" as a
   one-line footer fix; mail to any address at the domain bounces today. The
   real fix is a mailbox provider plus DNS records FIRST, then the footer.
3. **The signup page stated a false product fact** — "A free credit allowance
   every month" — and the root cause was the config still speaking periodic
   vocabulary (`grant.periodDays` is read by NOTHING; verified by grep).
   Fixed, `474722f`, comment and copy together.
4. **The spent-refund decline was SILENT, which is worse than §35 recorded.**
   `refundIfUnspent` returns false on a paid attempt (never throws), and the
   worker emitted only on success or on a throw — so the one outcome where a
   customer is charged for nothing produced no line, no record, nothing.
   Fixed, `5413199`, below.

#### C — What landed, one commit each

| Commit | What it does |
|---|---|
| `474722f` | The signup page stops promising a monthly allowance nobody grants; the money config stops speaking periodic vocabulary; the plans comment stops claiming rows were deleted that its own file still holds |
| `476d47d` | `defaults.<provider>.videoDirect` exists, and THREE consumers derive the direct video model from the same fact: fal's `generateVideo` resolves the endpoint by the request's shape, `stepCompose` freezes the direct default, `dryRun` quotes it. A reference body can no longer be posted to the image-to-video endpoint — the §26 split, closed at the layer the worker actually uses |
| `01f9ddd` | The web app orders the product: `direct: true` on the job input exactly when the provider spends money (`PAID_PROVIDER_IDS`, the leaf constant). The still-count control and its API acceptance are GONE — the accepted set is the offered set, and the offered set is empty. The fixture keeps the still path on purpose: its 8s cap IS the chaining guard, and a direct fixture job refuses at compose |
| `85e2a7d` | A failed tape speaks to the customer: the authored `userMessage` (which jobView had been DROPPING) or one generic sentence, never raw exception text; and `creditNoteFor` says where the money went, computed from the account's own ledger rows — refunded, spent, or nothing, never hope. Both surfaces always exist on the status page and the poller paints them |
| `aa72b49` | The auth limiters key on `clientIpOf` when `TIMESTAMP_TRUST_PROXY=1` (one bucket per visitor behind the proxy, not one for the internet) and stay socket-keyed otherwise, with a test that a typed header buys nobody a fresh bucket. `POST /api/billing/checkout` and `POST /api/jobs` join the same-origin gate every auth route has carried since §28 |
| `5413199` | A missed refund is a durable record (`out/refunds/<jobId>.json`) and an operator command (`npm run refunds`: list, settle), never only a stdout line. The decline is announced (`REFUND HELD`) on both the failure and reap paths. Settle goes through `refundCredits` — ledger-derived amount, idempotent per job, no number in a shell history |

Plus: `TIMESTAMP_PROVIDER` documented in `.env.example` (it now decides direct
mode, see D), and the account-deletion/export SPEC at
`docs/superpowers/specs/2026-08-29-account-deletion-export-design.md`.

#### D — The direct-mode design, in the four sentences the next reader needs

The request's SHAPE picks the endpoint: references mean
`defaults.<provider>.videoDirect` (reference-to-video on fal), a start frame
means `video`, and an explicit `--video-model` still beats both — body and
endpoint now derive from the same fact, which is what makes the §26 422
structurally impossible rather than merely guarded. The WEB decides the mode
per job: `direct: PAID_PROVIDER_IDS.includes(provider)` rides the manifest,
the only channel the worker reads — so **`TIMESTAMP_PROVIDER=fal` in the web
process is LOAD-BEARING in production** (unset means fixture means still-path
means the unverified-model refusal at compose: loud, refunded, wrong).
The fixture deliberately keeps the still path — stills forced to 1, select
auto-continues — so the dev loop still renders; `/j/:id/select` is now an
OPERATOR surface, reachable only under `--stop-after=select`, and no
customer meets a still or a count anywhere. **A provider with no
`videoDirect` default is refused by name (`NO_DIRECT_DEFAULT`), never
downgraded to a model that cannot take references.**

#### E — Deliberately NOT done, each with its reason

- **Narrowing `providerWasCalled` (the review asked for it).** Unsafe as
  asked: `beginStep` increments attempts before the request leaves, and
  nothing on disk can distinguish a pre-flight crash from an in-flight loss —
  a departed-marker would race process death in the wrong direction, refunding
  money fal actually billed. The conservative rule stays; the reconciliation
  ledger (`5413199`) is the honest fix, because the operator reading fal's
  dashboard is the one party who can resolve a maybe.
- **Account deletion/export code.** It touches identity, money, and jobs at
  once — the class this repo specs first. The spec exists and names the one
  open question (ledger retention basis) as Paul's; the build is a fresh
  session against it.
- **Legal pages.** The text needs the selling-entity decision (§37G) — a
  page naming no controller is not a privacy notice.
- **Ops minimum (backups, alerting, crash handlers, disk watch).** Shaped by
  the host choice; building it against an unchosen topology is the §34A
  lesson again.

#### F — Things that will bite

- **`git checkout -- <file>` during a sabotage check DESTROYS UNCOMMITTED
  GREEN WORK.** It happened this session: the sabotage was proven, the
  restore reverted to HEAD, and the just-written fix vanished with it —
  caught only because the next test run went red again. Restore a sabotage
  from a backup COPY (`cp` first), never from git, until the fix is
  committed.
- **`out/refunds/` exists now and nothing sweeps it.** Pending records are
  money and must persist; settled ones are audit trail and accumulate at one
  tiny JSON per failed job — fine for years, but whoever builds the ops
  runbook should know the directory is append-mostly and deliberate.
- **A PAID WEB ORDER HAS STILL NEVER BEEN PLACED.** The wiring is new,
  test-first, and unproven against real fal. One ~$2 480p order through the
  browser with `TIMESTAMP_PROVIDER=fal` and a fal worker is the proof, and
  only Paul can paste it.
- **`STATUS_SCRIPT` changed, so its CSP hash changed.** Automatic —
  `INLINE_SCRIPT_HASHES` computes from the constants — but anyone diffing
  CSP headers across deploys will see a new hash and should not read it as
  an injection.
- **The e0c0d77 rule inverted, deliberately.** "The still count the API
  accepts is the one the page offers" survives; the offered set is now
  EMPTY, so any posted `stillCount` is a 400. A cached pre-§37 page's form
  cannot hit this (the control is gone from the markup it would have
  cached), but a hand-written client that sent `stillCount=3` breaks — and
  should.

#### G — What is left, and whose it is

**PAUL'S SEVEN, none of them code** — the blind check (unsent, four sessions
running, still gates everything); the selling entity (one decision, four
doors: Impressum, GDPR controller, Stripe verification, VAT); Stripe business
verification (file it, let the clock run); the deploy host (§34A, thirty
seconds); a support mailbox + an image-moderation vendor (accounts and
money); the Supabase Recovery template check (two minutes in the dashboard);
and one paid web order to prove the direct path.

**AGENT-BUILDABLE NEXT, in order:** ~~account deletion/export from its spec~~
**(DONE — §39)**;
the legal page shells the moment the entity text exists; the ops minimum the
moment a host exists (backups of the volume holding every balance, an uptime
check on `/api/health`, `unhandledRejection` handlers, a disk-space line in
health); AI-generation disclosure (metadata provenance + a result-page line —
EU AI Act Art. 50 has applied since 2 August 2026); browser/e2e smoke tests,
which every UI bug this project has found by hand argues for.

### 38. THE TAPE SAYS WHAT IT IS, AND THE PAGES MET A REAL BROWSER (2026-08-29, second tranche)

**1786 / 1784 → 1795 / 1793 pass / 0 fail, 2 skipped** — +3 disclosure tests,
+6 browser tests. **Two code commits, `b798c2f` and `7112981`, plus this
documentation pass, pushed as they landed; PR #1 re-ran CI on `b798c2f` and
all five checks are green.** Worked from §37G's agent-buildable list, in its
order, with two items skipped because their gates are still closed (§38D) and
the first item delegated (§38A).

#### A — TWO SESSIONS, ONE BRANCH, NO COLLISION — read this before assuming the checkout is yours

**Account deletion/export (§37G's first agent item) is being built RIGHT NOW
by a SEPARATE session** — `determined-knuth-805b98-a9`, working strictly from
the spec, in a git worktree at `.claude/worktrees/determined-knuth-805b98` on
branch `claude/determined-knuth-805b98`, so the main checkout never saw its
edits. Division agreed over session messaging: that session owns
`scripts/auth/*`, `scripts/web/router.mjs`, `server.mjs`, the nav region of
`views.mjs`, `views-auth.mjs` and its own new test files; this session touched
none of them except ONE region of `views.mjs` (resultPage), coordinated
explicitly. **It will rebase onto `origin/supabase-identity-slice` before
merging back, and it may append its own section here — a trivial conflict in
this file is the expected shape.** **IT LANDED: the branch rebased onto this
section's commits and merged back the same day — deletion/export is DONE,
recorded as §39.**

#### B — EU AI Act Art. 50: the disclosure, both halves (`b798c2f`)

The delivered mp4 now carries two metadata tags — `comment` with the
human-readable sentence, `description` with the IPTC digital-source-type
vocabulary (`trainedAlgorithmicMedia` plus its cv.iptc.org URI, so a scanner
grepping the standard term finds it cold). And the result page says it in
type: one `.fine` line beside the tape.

Four decisions worth not re-litigating:

- **The tags ride `muxedArgs`, NOT `gradeArgs`.** muxedArgs produces exactly
  the delivered artifact; `npm run look` runs gradeArgs against any clip in
  `assets/stock` — REAL footage — and a false "AI-generated" claim baked into
  a real recording is worse than no tag. gradeArgs gained a `metadataArgs`
  seam (the audioArgs precedent) defaulting to none, with a test pinning that
  bare gradeArgs stays untagged.
- **Known mp4 keys only.** An arbitrary key needs `-movflags
  use_metadata_tags`, which moves where the muxer stores ALL metadata;
  gambling every player's ability to read a compliance marking for a nicer
  key name is the wrong trade.
- **Nothing clock-shaped may ever join them** — a creation date would make two
  renders of one job differ, and there is an assertion that nothing matching
  a date rides the metadata args.
- **Sending a tag is not shipping it.** The mov muxer silently drops keys it
  does not map, so beside the argv test there is a behavioral one that
  ffprobes the finished file. Its RED run recorded what the file used to
  carry: `major_brand`, `minor_version`, `compatible_brands`, `encoder` —
  nothing else.

#### C — The pages are tested in a real browser now (`test/browser-smoke.test.js`)

Six tests drive real headless Chromium over the DevTools protocol — **node
22's own WebSocket client and a spawn; no Playwright, no Puppeteer,
`dependencies` still `{}`**. The file self-skips with a reason when no
Chromium-family browser exists (`TIMESTAMP_BROWSER` overrides discovery);
both CI images ship Chrome, so it runs on every CI leg. ~4s wall clock.

Every asserted class is one this product actually shipped, and **every
assertion was sabotage-verified — the defect reintroduced, the right test
watched going red, the sabotage reverted from a backup copy** (never `git
checkout` while green work is uncommitted — §37F's own rule):

| Guarded class | Sabotage that proved it |
|---|---|
| Sideways scroll at 375px/1440px, four pages | one `min-width: 0` removed → 224px overflow named — §36B reproduced |
| Sign out on screen under a 58-char email | same sabotage, same red |
| Consent checkbox ≥ 24×24 in the ENGINE (SC 2.5.8, §6b) | shrunk to 1rem → "16x16, under the 24x24 target minimum" |
| Inline scripts execute under the CSP the server REALLY sends | a fourth unhashed script added → Chrome's refusal quoted verbatim |
| The status poller runs a full fetch-and-paint cycle | covered by the CSP channel plus a 2.6s settle |
| The AI disclosure is VISIBLE, not merely present | `hidden` added → red here while every fetch() test stayed green |

**That last row is the point of the whole file:** a `hidden` attribute passes
every markup test in the suite and fails only in a layout engine.

Things that will bite:

- **Network-level noise is deliberately NOT collected.** The landing's video
  layer tolerates an absent or undecodable file by design, and the fake job
  media is garbage bytes on purpose — so the error collector takes page
  exceptions, `console.error` calls and CSP refusals, and nothing else. Do
  not "strengthen" it to all Log entries; it will flake on resource loads.
- **The fakes are COPIED from web-api.test.js, not imported** — importing a
  test file registers its tests in the importing process (§4's
  provider-contract lesson). Copy is the house rule; this file follows it.
- **Chrome holds its Windows profile open for a beat after kill** — teardown
  uses `rmSync` with retries; an EBUSY there is the browser, not a bug.
- **`/json/new` demands PUT on current Chrome** — the GET spelling was
  removed and answers 405; the session cookie goes in through CDP's
  `Network.setCookie` against the server's base URL.

#### D — Skipped on their gates, exactly as instructed

- **Legal page shells** — still gated on the SELLING-ENTITY decision (§37G):
  a privacy page naming no controller is not a privacy notice. No code.
- **Ops minimum** — still gated on the DEPLOY HOST (§34A): backups, the
  health disk line and crash handlers are all shaped by the topology. No
  code.

#### E — The paid web order: the exact steps, ready to paste

The direct web path is wired, test-first, and **still unproven against real
fal** — no web order has ever reached the paid provider. The proof is one
~$2.10 480p 4:3 order (21 CR), and only the owner can run it:

1. Add `TIMESTAMP_PROVIDER=fal` to `.env` (uncomment the documented line).
2. Terminal 1: `npm run web` · Terminal 2: `npm run worker -- --provider=fal`
3. Browser at `http://localhost:3000` (NOT 127.0.0.1 — the §27 cookie-jar
   trap), sign in, order: photo, outfit, place, **4:3**, **480p**, consent.
   The button should say ~21 CR.
4. Watch `/j/<id>` to the tape. Then verify: balance moved by exactly 21;
   `out/jobs/<id>/manifest.json` says `"direct": true` and freezes
   `...reference-to-video`; the still and select steps print `skipped`.
5. Read fal's usage page and record the invoice:
   `npm run ledger -- record <jobId> --actual=<usd>`.
6. **Remove `TIMESTAMP_PROVIDER=fal` from `.env` afterwards** — with it set,
   every local web job is labelled for the paid provider, and the fixture
   worker refuses direct jobs at compose by design.
   If the order fails instead: the credits refund automatically, and a
   refund the worker could not settle lands in `out/refunds/` for
   `npm run refunds`.

#### F — What is left

**PAUL'S SEVEN (§37G), UNCHANGED** — blind check, selling entity, Stripe
verification, deploy host, support mailbox + moderation vendor, Recovery
template check, and the paid order above (§38E has the steps). **AGENT-
BUILDABLE:** whatever the deletion session leaves unfinished, then the legal
shells and the ops minimum the moment their gates open.

---

### 39. ACCOUNT DELETION AND DATA EXPORT — BUILT FROM ITS SPEC (2026-08-29, the §38A session, landed)

**1876 pass / 0 fail / 2 skipped (1878 total).** Built EXACTLY to
`docs/superpowers/specs/2026-08-29-account-deletion-export-design.md`,
test-first throughout (every new test watched failing before its code
existed), and **seven sabotages each turned a test red and were restored from
a backup copy** (§37F's rule, followed): local-before-upstream order, lease
check removed, register decrement on delete, hash in the export, origin gate
removed, owners-vanish tolerance removed, publishable key on the admin call.

#### What exists now

- **`adminDeleteUser` in `scripts/auth/supabase-auth.mjs`** — `DELETE
  /auth/v1/admin/users/:id`, secret key on both headers (`call()` gained an
  `admin` flag), id validated against `SUPABASE_ID_RE` (now exported from
  `accounts.mjs`) before anything reaches the wire. **A 404 is success with
  `missing: true`** — a deletion that crashed between the upstream call and
  the local cleanup must be retryable. Every other refusal throws.
- **`deleteAccount` in `accounts.mjs`** — record first INSIDE the account
  lock (a concurrent `updateAccount` fails `NO_ACCOUNT` instead of
  resurrecting the file), then both index entries (each removed only if it
  points at this account), directory after the lock (the lock file lives
  inside it). Both lookups already tolerate a dangling index entry, so even a
  crash mid-delete cannot recreate the `4f53dc6` rebind trap.
- **`scripts/auth/deletion.mjs` — `deleteAccountEverywhere`, the ONE place
  that knows the order**: lease check → Supabase identity FIRST → per job
  (cancel sentinel, `purgeJobMedia`, directory) → owners dir → sessions →
  account. `isClaimed` is injected and **defaults to "yes"** — a caller that
  cannot answer gets a refusal, the careless call being the safe one. Web
  route and CLI both call this; the order lives nowhere else.
- **Three routes** (`router.mjs`, gated by default): `GET /account` (page:
  email, balance, export link, deletion form), `GET /api/account/export`
  (attachment; account block is an ALLOW-LIST — never a spread, the
  enumerable record includes the scrypt hash), `POST /account/delete`
  (`identityUnavailable` without Supabase → `sameOriginPost` before the body
  → CSRF pair → typed email compared normalised → 409 `JOB_CLAIMED` while a
  tape renders). Nav gained the Account link (signed-in branch only).
- **`npm run accounts -- delete --email=<addr> [--yes]`** — spec §6. Without
  `--yes` it prints the plan and refuses, exit 1. The npm script now loads
  `.env` (`--env-file-if-exists`) like web/worker/doctor, so the operator's
  delete can reach Supabase; **`npm test` stays bare and unaffected**.
- **`destroySessionsFor` was NOT added** — it already existed as
  `destroySessionsForAccount` (`session.mjs:544`). The spec's name would have
  been a duplicate; the existing one is used. `REQUIRED_AUTH` was NOT
  extended (spec §5): the routes feature-detect `deleteAccount` /
  `destroySessionsForAccount` / `ledgerFor` and 503 when absent, so every
  existing test fake stays valid.

#### Rulings this session, worth not rediscovering

- **The ledger open question went to option (a) delete-everything** — Paul
  had not answered, the task said default to (a). The (b) hook (anonymised
  rows to `out/deleted-ledgers/<accountId>.json`) is one extra write, noted
  in `deletion.mjs`'s header where it would go.
- **Pending refund records survive deletion and are announced** — they ARE
  money; the web handler logs `REFUND HELD` per record and the CLI prints
  them. Settled ones stay as audit trail. Nothing in `out/refunds/` is
  deleted.
- **`test/web-auth-code.test.js`'s harness gained an optional `queue`
  param** (additive; siblings unchanged) so `web-account.test.js` — its
  fourth importer — can hold a lease with the web-api-style fake.
- **A worktree session note:** this session's worktree branched from stale
  `main`; the work lives on `supabase-identity-slice`. Fast-forwarding the
  worktree branch onto `origin/supabase-identity-slice` before starting is
  what made the spec (and everything it names) exist at all.

#### The post-landing review pass, and the two real holes it found

A code review of the landed diff (the house discipline that keeps finding F2
shapes inside fixes for F2) confirmed the gates and the export allow-list and
found **two verified durability holes in `deleteAccount`, both fixed
test-first the same day:**

- **Record-first removal wedged the address on partial failure.** An EBUSY on
  the email-index rm after the record was gone left a dangling entry no code
  path could ever clear: sign-in resolved null, signup read bare entry
  existence as taken, and the retry died at `loadAccount` → `NO_ACCOUNT`.
  Now the INDEX ENTRIES GO FIRST AND THE RECORD LAST -- the record is the
  retry's only entry point -- and an entry that will not parse is removed
  (it points at nobody and blocks signup exactly like a real one).
  `deleteAccount` gained an `fsImpl` seam so the refused-rm retry is a test.
- **The pre-lock snapshot could miss a mid-flight Google claim.** The account
  is now loaded INSIDE `withAccountLock` (the `updateAccount` pattern): a
  concurrent `claimAccount` either finished first and is seen, or arrives
  second and finds `NO_ACCOUNT` -- never a dangling `_index-supabase/` entry
  that makes the identity permanently unable to open an account.

Plus one honesty fix (an unreadable pending-refund record reaches the
deletion report as `{ jobId, unreadable: true }` instead of vanishing) and
two trade-offs now STATED in `deletion.mjs` instead of discovered: the
lease-to-removal window spans the upstream await (sentinels-after was chosen
because a deletion refused upstream must change nothing), and a
deleted-while-queued job mints one spurious `failed/` queue entry (the worker
handles it loudly; accepted noise). After the pass: **1888 / 1890, 0 fail.**

---

### 40. THE QUEUE COULD DOUBLE-CLAIM UNDER MULTI-WORKER CONTENTION — DIAGNOSED, REPRODUCED, AND FIXED (2026-08-29)

**CI went red twice today on `test/queue-race.test.js:334` — "24 workers start
at once -- reap then claim -- and nothing is lost or doubled" — with seven
`won` reports over six jobs: one job claimed by two workers.** Once on node 22
ubuntu, once on node 24 ubuntu, never on Windows; a rerun of the same commit
went green. **The test is RIGHT to fail. Do not weaken, retry, or skip it** —
it caught a real race, which is the whole reason that file exists.

#### The mechanism, traced and then reproduced

1. `dropLockIfUnchanged` (queue.mjs:649) is **check-then-act**: `readLock`,
   fingerprint compare, `unlinkIfPresent`. Its own comment says the
   fingerprint check catches a slow reaper deleting a live worker's lock — it
   NARROWS that window; nothing closes it, because no unlink on any platform
   here is conditional-exclusive.
2. A reaper descheduled between the read and the unlink wakes to delete
   **the successor's live lock at the same path** — in the window, another
   reaper dropped the dead lock and a worker claimed the job.
3. With the live lock gone, a third stale reaper's exclusive-create of the
   pending entry SURVIVES, because the undo guard at queue.mjs:1081
   deliberately keeps the entry when `readLock` returns null ("may be its
   only home" — correct for the reaper-crashed case, wrong here and
   indistinguishable from it by state alone).
4. A second worker claims the resurrected entry. One job, two claims, reaps
   still reported exactly once, every count plausible. On the paid path that
   is one render billed twice.

**Reproduced on Linux at 1 failure in 40 rounds** (0 in 12 three-way-parallel
runs on this Windows machine — the window needs Linux scheduling under
oversubscription, which is what a 4-vCPU CI runner under full-suite load is):

```bash
MSYS_NO_PATHCONV=1 docker run --rm --cpus=2 -v "/c/Users/pauls/Timestamp:/src:ro" node:22-bookworm-slim bash -c 'mkdir -p /repo && cd /repo && cp -r /src/scripts /src/test /src/package.json /repo/ && for i in $(seq 1 40); do node --test test/queue-race.test.js >/tmp/qr.log 2>&1 || { echo FAIL $i; grep -A12 "not ok" /tmp/qr.log; }; done; echo done'
```

#### Two fixes analyzed and REFUSED — do not ship either

- **Undo-on-null** (extend queue.mjs:1081 to also undo when the lock is
  absent): loses the job outright in the reaper-crashed-mid-repair case that
  branch exists to protect, because entry-with-no-lock is ALSO the normal
  state of a freshly reaped job.
- **Rename-the-lock-away, verify, restore**: the rename creates exactly the
  transient no-lock moment that admits the spurious entry, and the restore
  can clobber a claim that landed in the window. It widens the hole.

#### The fix that landed (2026-08-29, later the same day)

**One caller per lease may unlink the lock, and it is the reap-mark holder.**
`acquireDropSanction` in queue.mjs: taking the lease's `.reaped` mark — already
the exclusive per-lease artifact — is now also the licence to run
`dropLockIfUnchanged`. A caller that finds the mark taken may inherit the drop
only once the mark's `reapedAt` is a full `leaseMs` old, the same backstop
workers themselves get, so a mark holder that dies mid-drop cannot strand the
job. **`enqueue()`'s expired-lease clearing goes through the same sanction** —
it was a third unserialized unlink of the same name, reachable by a re-enqueue
racing a reaper, found in review of the first fix. Why this closes the trace
above: a successor lock can only exist at `claimed/<jobId>.lock` after the one
sanctioned unlink for the previous lease has returned, so a stale unlink never
has a live lock to hit, and step 3's resurrection never finds the lock absent.
Everyone may still write the pending entry — exclusive create is
multi-caller-safe; only the unlink needed one owner.

Evidence, in the repo's discipline: the interleaving is replayed
**deterministically** in `test/queue-race.test.js` (the two "parked over"
tests) — the actor thread's own **thread-local** `fs.unlinkSync` (worker
threads get private copies of builtins) parks between the check and the
unlink, a rival reaps and claims in the gap, and releasing the park fires the
exact stale unlink. Barriers cannot force a thread to park between two
adjacent syscalls; this can. RED pre-fix on Windows AND Linux every run,
GREEN post-fix; sabotage-verified in both directions (everyone-drops restored
→ reaper test red; enqueue sanction removed → enqueue test red; swapping only
the drop primitive while keeping the mark acquisition stays green, which
proves the protection is the mark, not the fingerprint re-check). Reproducer
above, pre-fix baseline: 4 failures in 60 rounds; post-fix: clean over 200.
The accepted residual: a mark holder parked longer than a FULL LEASE between
two adjacent syscalls (VM-pause scale) — the same class of residual the lease
design already accepts for workers, and now stated in the code.

#### Optional hardening, no longer the required direction

**Generation-scoped lock files** (`claimed/<jobId>.<generation>.lock` —
claiming creates the NEXT generation, `readLock` reads the highest, deleting
an old generation races nothing because a higher one proves it dead) would
close the remaining zombie windows the landed fix deliberately leaves:
`complete()`/`fail()`/`release()` unlink their own lock and `heartbeat()`
rename-replaces it after a token check that can go stale if the lease expired
and was reaped-and-reclaimed in the same microsecond — `LEASE_LOST` catches
the aftermath today. That is a lock-LIFECYCLE redesign (claim, readLock,
requireHolder, heartbeat, enqueue, stats all touch it) and needs the
120-round barrier discipline for any new primitive. Worth doing only if
multi-worker scale-out makes those windows real.

#### What bounded the urgency

**The shipped single-worker topology could not hit this.** One worker
process, synchronous fs calls, no concurrent reaper — the race needed two or
more worker processes reaping and claiming at once. Its only symptom was
intermittent CI red on loaded ubuntu legs (~2 of 3 full-suite runs on
2026-08-29); a re-run went green. The fix session spun off that night
delivered the fix above.

---

### 41. THE HOST IS CHOSEN, THE OPS MINIMUM AND THE LEGAL SHELLS EXIST (2026-08-29, third tranche)

**1893 / 1891 → 1919 / 1917 pass / 0 fail, 2 skipped.** Two commits,
`e324f50` (ops + topology) and `bb1c459` (legal pages), both test-first, both
pushed. This closes every §37G agent item that had a gate, because Paul
opened the gates:

**PAUL'S DECISIONS THIS SESSION, binding:**

1. **The deploy host is HETZNER (CX23, Falkenstein)** — chosen after a fresh
   research pass re-confirmed §34A's measured table (4x cheaper than the
   field at the proven machine shape; German datacenter = the EU-residency
   line the privacy policy now relies on). **The server is NOT created yet,
   deliberately** — "we will deploy at the end." Everything buildable
   without the box exists as of this section; the day it spins up is
   docs/deploy-runbook.md, top to bottom.
2. **TESTING IS PARKED TO THE END, including the blind check.** The plan he
   chose: build everything, then give the finished app to two or three
   friends who upload THEIR OWN photos, with one "who is this?" text per
   resulting tape to a third person who knows that friend — which folds the
   blind check into the end-test and adds the question it could never ask:
   does identity generalize past Paul. The `out/blind-check/` packet stays
   built and unsent. **Re-litigating this ordering is done; the record is
   here so nobody re-argues it.**
3. **Vercel was asked about and ruled out for the standing reasons** (no
   ffmpeg, no shared persistent filesystem, no daemon worker) — the answer
   is in compose.yaml's own header; do not re-open.

#### A — The ops minimum (`e324f50`)

- **Crash handlers** (`scripts/ops/crash.mjs`): both CLIs print one
  attributed `[web]/[worker] FATAL` line and exit 1 on unhandledRejection /
  uncaughtException — installed at the direct-invocation entry only, so
  importing parseArgs/renderEvent in a test gains no process-wide handlers.
  One exit however many events cascade; a stackless reason still prints; a
  throwing log sink cannot block the exit. compose's `restart:
  unless-stopped` is the other half of the contract. A source-reading test
  pins both call sites (the paidTransport precedent).
- **`/api/health` reports the disk**, cached on the same 30 s window as its
  neighbours through a `statfsImpl` seam. `disk.low` (absolute floor:
  1 GiB — "how many more orders fit" is not a percentage) flips `ok`, which
  makes the uptime monitor the disk alarm; an UNREADABLE figure reports and
  flips nothing, because "I cannot see the disk" is not "the disk is full"
  and paging on it is how real pages get ignored.
- **`npm run backup`** (`scripts/ops/backup.mjs`) copies the three
  directories that cannot be regenerated — accounts, owners, refunds — and
  deliberately nothing else: jobs media is retention-swept and holds faces
  that must not multiply across disks. Plain per-file copy (everything
  there is written atomically, so a mid-traffic copy holds only complete
  files). A destination inside the root is refused; `--keep` prunes only
  `timestamp-backup-<stamp>` names and never a stranger's directory; flags
  are a whitelist with the purge CLI's exit-2 manners. **Restore is a
  runbook procedure, deliberately not a command.**

#### B — The topology (`compose.yaml`, `Caddyfile`, `docs/deploy-runbook.md`)

Two processes from one image over one `data` volume — the Dockerfile's own
contract — behind **Caddy as the ONLY doorway**: TLS from the site address,
and the X-Forwarded-* honesty `TIMESTAMP_TRUST_PROXY=1` vouches for.
`test/deploy-topology.test.js` fails if a `ports:` block grows anywhere but
caddy — web:3000 published to the host would reopen the header spoof, skip
TLS, and merge every limiter bucket. Log rotation on all three services,
because unbounded json-file logs fill the disk that holds every balance.
Validated against a real `docker compose config` (VALID), and both files are
LF-pinned in .gitattributes for the Dockerfile's reason. The runbook carries
the five consoles, the smoke order, the cron backup line and the restore.

**Sabotage record:** publishing web:3000 → doorway test red; deleting one
CLI's installCrashHandlers → source test red; and the volume-mount count
assertion was itself caught over-matching `caddy_data:/data` on its first
real run and anchored — the §36 lesson that a test can go green while wrong.

#### C — The legal pages, gated like the Stripe button (`bb1c459`)

`/privacy`, `/terms`, `/impressum` — public routes ("a privacy policy behind
a login is not a privacy policy"), linked from every footer. **The entity is
`config/legal.json`, and `entity: null` is the designed state** — the
`stripePriceId: null` shape: unconfigured, the pages render everything true
today (retention read from the config the purge enforces, the real
processor list, the rights and the /account door) behind an operator
placeholder, and the runbook's smoke list stops the placeholder reaching
customers. **Filling the config is also sign-off on the page text — its
_comment says so.** Escaping is pinned with a hostile entity name. The three
pages joined `renderedPages()` in both entity states so the texture and
border sweeps can see them — §23's own lesson, with a test pinning they
stay listed.

#### D — What is left

**PAUL'S, rewritten after this session's decisions:** the selling entity
(now literally a paste into `config/legal.json`); Stripe business
verification; the support mailbox (no MX yet); the Supabase Recovery
template check; then AT THE END, in his chosen order: create the Hetzner
box and walk the runbook, the ~$2 direct-path order (§38E), and the
friends test with the blind-check texts folded in.

**AGENT-BUILDABLE: nothing is left ungated.** The next code work is
whatever the friends test or the paid order surfaces.

---

### 42. TWO OWNER ITEMS CLOSED, AND THE PLACES STOPPED BEING GERMAN (2026-08-29/30)

**1919 / 1917 → 1938 / 1936 pass / 0 fail, 2 skipped.** Three commits,
`e3573c1..4965c2a`, pushed, and **PR #1's CI is GREEN on all five checks** —
guards plus node 22/24 x ubuntu/windows. Every change test-first, every guard
sabotage-verified, all seven `guards.yml` checks run locally verbatim before
the push.

#### A — §37G items 3 and 4 are DONE, and both are PROVEN rather than assumed

**THE SUPPORT MAILBOX EXISTS.** Cloudflare Email Routing, `support@` →
the owner's Gmail. Verified three ways: the apex MX and SPF records read back
from the authoritative nameserver AND from Google/Cloudflare/Quad9 resolvers,
and Cloudflare's own Activity Log showing a real message **Forwarded**.
**This closes §37B: the domain had NO MX RECORD AT ALL and mail to it bounced.**
`support@timestamptapes.com` is printed on all three legal pages, so that
address had been a promise the DNS could not keep since the domain was bought.

**CLOUDFLARE MOVED EMAIL ROUTING AND THE OLD PATH IS GONE.** It is no longer
under a domain's Email tab (which now holds only Email Security and DMARC
Management). It is **account-level: Compute → Email Service → Email Routing**,
then Onboard Domain → Destination Addresses → Routing Rules as three separate
phases. Cloudflare launched "Email Service" in April 2026 and folded Routing
under it. Destination addresses are ACCOUNT-scoped, so one already verified on
another domain shows `Verified` immediately.

**Catch-all is deliberately left DISABLED.** Unmatched mail is then rejected
and the sender gets a bounce; enabling it as "Drop" would make mail to a
typo'd address vanish silently, which is the worse failure.

**THE RESET-PASSWORD TEMPLATE NEVER EXISTED**, so item 4 was not the
two-minute check it was filed as. `docs/supabase-email-templates/` held only
`confirm-signup.html`, which means the dashboard was still serving Supabase's
DEFAULT recovery template — a magic link, the one thing a six-digit page
cannot survive. `recovery.html` now exists, is applied, and was proved by a
real reset: six digits, no button. `Email OTP length` confirmed 6 and expiry
confirmed 1 hour.

#### B — A MAGIC LINK CAN HIDE IN AN HTML COMMENT

Both email templates carried a header comment naming `{{ .ConfirmationURL }}`
**in real syntax**, because it was the comment explaining that the variable is
forbidden. The README says to paste each file WHOLE.

**A template engine substitutes by scanning text. An HTML comment is not a
hiding place — it is just more text.** Pasted whole, that comment would mint a
working magic link and bury it in the source of every email: invisible when
rendered, and a live credential to anyone who reads the source or is forwarded
the message. Both comments now name their variables in words.

Whether the live template ever did this depends on which Go template package
GoTrue uses — one of the two strips HTML comments — and that was not worth
reasoning about when replacing it costs thirty seconds.

**OWED, AND THE ONLY ITEM 4 LEFTOVER: re-paste `confirm-signup.html`.** The
version in the dashboard is the 2026-08-27 one with the old comment. To check
rather than assume, open a received confirmation email, use Show original, and
search for `ConfirmationURL` or a `/auth/v1/verify` link.

**`test/email-templates.test.js` reads each file exactly as the dashboard
receives it, comments included**, and fails if any template action other than
the code appears anywhere. Its first version stripped comments — which is the
same reasoning that created the hazard. Structural checks (style/img/anchor)
still use the stripped copy, because a `<style>` written inside a comment is
prose to a mail client.

#### C — A CORRECTION: THE RESEND RECORDS WERE NEVER MISSING

Earlier in this session it was reported here and to the owner that
`send.timestamptapes.com` had lost its MX and SPF records. **That was wrong.**
They are at **`send.send.timestamptapes.com`** — a DOUBLE `send` — because the
domain registered in Resend is `send.timestamptapes.com` and Resend places its
MAIL FROM records one level below whatever is registered. DKIM sits at
`resend._domainkey.send.timestamptapes.com`, which is why only that one was
found.

```
send.send.timestamptapes.com  MX   feedback-smtp.eu-west-1.amazonses.com
send.send.timestamptapes.com  TXT  v=spf1 include:amazonses.com ~all
```

**Nothing was broken and nothing needed fixing.** The lesson is the one this
file keeps recording in other forms: a query against the wrong name returns
the same empty answer as a real absence.

The new apex SPF (`v=spf1 include:_spf.mx.cloudflare.net ~all`) does not touch
this — outbound mail is From the `send.` subdomain, so it is that subdomain's
SPF that is consulted. **It WOULD matter if the Supabase SMTP sender were ever
moved to the bare apex.**

#### D — THE DISCLOSURE ADDRESS, AND TWO PAGES THAT WERE LYING

**`TIMESTAMP_LEGAL_ENTITY`** carries the entity as one line of JSON in `.env`
and beats `config/legal.json` when set. That channel already existed end to
end — gitignored, out of the image, passed into both containers by compose's
`env_file` — and it exists because **a sole trader's § 5 DDG address is a home
address while this repository is public.** `config/legal.json` stays
`entity: null` permanently and a test fails if anybody pastes an address into
it. It closes the GIT half only; the pages publish the address while the site
is live, which is what they are for.

**Both routes end at `normaliseLegalEntity`**, an allow-list of the four fields
that render, which REFUSES a partial entity. `h()` renders undefined as the
EMPTY STRING, so an entity missing its email did not print "undefined" on the
Impressum — it printed nothing, leaving a contact block that looks deliberate
and is missing the one thing the page exists to carry.

**TWO FACTUAL ERRORS CAME OUT OF THE PAGES:**

1. **The Impressum cited § 5 TMG.** That statute was REPEALED in May 2024 and
   replaced by the DDG, so the heading named a law that no longer exists for
   anybody. It is `§ 5 DDG` now, and a test refuses both TMG and no citation
   at all.
2. **The privacy page claimed "the only cookie is the one that keeps you
   signed in" and this app sets THREE** — session, anti-forgery, OAuth state.
   All strictly necessary, so the no-banner position is unchanged, but a
   privacy notice that misstates what it sets is the wrong thing to publish.
   The count is pinned against `session-middleware.mjs`'s own constants, so a
   fourth cookie fails the test and forces the prose to be reviewed.

#### E — NOTHING IS INDEXABLE BY DEFAULT

`TIMESTAMP_INDEXABLE=1` opens the site to search engines. **Unset means no**,
and the default is the whole point: forgetting to switch indexing ON costs
search traffic, which is visible and fixable any day; forgetting to switch it
OFF costs an indexed and archived home address, which cannot be withdrawn.
**The recoverable failure gets to be the default.**

`robots.txt` disallows everything, and `X-Robots-Tag: noindex, nofollow` is set
**before routing**, so a route added later is covered by construction rather
than by somebody remembering. `/j/` stays disallowed even when indexing is
opened — a tape is somebody's face, and those urls are unguessable rather than
secret.

**"Do not share the URL" is NOT a substitute**, and this is why the flag
exists: Caddy issues a certificate on first boot and that publishes the
hostname to Certificate Transparency logs, which crawlers watch. The site is
discoverable from the first TLS handshake, linked or not. Runbook §4 step 8
checks it and a "Going public" section says how to lift it.

#### F — THE PLACES ARE NAMED FOR MEMORIES, NOT FOR GERMANY

**The owner restated the product direction and it is worth quoting**, because
it was misread twice as "add more countries":

> "It's not about the country... people can make videos, like, in 2003 setup,
> like, in a camcorder... It has to be plain, like, simple location names."

The product is the ERA and the MEDIUM. The menu said otherwise:

| was | is |
|---|---|
| Baltic beach, out of season | **The beach, out of season** |
| Autobahn rest stop at dusk | **The car park, at dusk** |
| Allotment garden, late August | **The garden, in summer** |
| Balcony, washing on the line | **The balcony** |
| Tiled kitchen at breakfast | **The kitchen table** |
| Living room, television on | **The living room, evening** |
| Concrete stairwell | **The stairwell** |
| Indoor swimming pool | **The swimming pool** |

**THE SPECIFICITY DID NOT GO, IT MOVED — from country to era.** A padlocked
kiosk and a chained bin say out-of-season on any coastline; a thermos, a paper
map and a disposable camera say 2003 anywhere. Making the presets VAGUER
instead would have brought back exactly the AI-slop problem §17 was written
against.

**Only THREE prompts carried literal German words** and prompt text reaches the
customer's TAPE rather than only the card, which is why those went while the
photographs stayed: `an Autobahn rest stop`, `a small German kitchen`, `a small
German allotment garden behind a clipped privet hedge`, `an Opel estate`.

**IDS AND ASSET FILENAMES ARE DELIBERATELY UNCHANGED.** Nobody sees an id, and
renaming them would touch 37 files for no visible gain. So `The beach` is still
`ostsee-strand` on disk; that is intentional, not debt anybody forgot.

**ALL EIGHT PHOTOGRAPHS WERE LOOKED AT, and six read as universal already** — a
CRT with a crocheted antimacassar, a balcony with a red plastic basin, a
municipal pool, a green-dado stairwell. **Only the beach shows an
unmistakably German object** (four wicker Strandkörbe are the whole
composition), so **the beach card and its prompt now disagree** and one
Higgsfield generation fixes it whenever the owner wants. The car park is
mildly European (90s estates, long plates) and illegible at card size.

**The car park was kept rather than deleted** — `expand/local.mjs` maps free
text onto the nearest preset, so it is the template every typed roadside scene
borrows its light and lens from.

#### G — Things that will bite

- **A TEST CAN GO VACUOUS BECAUSE OF A CHANGE ELSEWHERE.** `expand-local`
  asserted `wicker|groyne|marram` never leak into a warm expansion — and §42F
  deleted those words from the repository, so it could no longer fail for any
  reason. It now names dressing the preset actually carries, **proved present
  in the winter expansion before being asserted absent from the warm one.**
  Third instance of this class in three sessions.
- **DO NOT APPROXIMATE A GUARD WHEN CHECKING IT.** Two hand-written
  re-implementations of `guards.yml` steps reported failures that did not
  exist — the real fal guard is BEHAVIOURAL (runs `requireFetchImpl` and
  checks it throws) and the consent guard imports `consentText()`. Run the
  guard's own lines.
- **`sed`/`perl` mutations silently fail on this checkout more often than they
  land.** Three sabotages this session reported "not caught" and every one was
  a mutation that never applied — CRLF, or escaping. **Print the mutated line
  and confirm it changed before believing a guard is blind.**
- **A place preset may not use wardrobe vocabulary.** `a disposable camera in
  its cardboard sleeve` failed the schema on the word **sleeve**. The
  separation is enforced, which is the design working.

#### H — What is left

**PAUL'S:** Stripe business verification (the only item with a clock, and
nobody can pay until it is done); the `confirm-signup.html` re-paste (§42B);
then at the end, in his chosen order — the Hetzner box and the runbook, the
~$2 paid web order (§38E), and the friends test with the blind check folded in.

**AGENT-BUILDABLE, and the first one is the product's own stated core:**

1. ~~**MOVE FREE TEXT AND PHOTO-UPLOAD TO THE FRONT OF THE PLACE STEP.**~~
   **DONE 2026-08-30 — §43, commit `67ce0e0`.** Step 3 leads with the
   own-place block, `pl-own` is checked on load, and the presets follow as
   examples. **One thing was deliberately NOT done and it is a design call:
   the place upload is still a bare native `Choose File` control** sitting
   directly across from step 1's designed `.drop` panel — invisible while it
   was hidden, conspicuous now that it leads the step. §43D.
2. The tape-quality items (§34G). ~~The judder~~ **is DONE — §44.** What is
   left of that group is the **punch-in zoom** (still a negative at
   `scripts/compose/prompt.mjs:171`; buildable, but judging it needs a paid
   render) and **audible cuts at shot boundaries**, which needs shot-boundary
   detection on the finished clip. ~~The fluorescent buzz and the kitchen clock
   tick~~ **were already done** — §44E.

---

### 43. THE PLACE STEP LEADS WITH YOUR OWN PLACE (2026-08-30)

**1938 / 1936 → 1947 / 1945 pass / 0 fail, 2 skipped.** +9 tests, nothing
dropped or weakened. **One commit, `67ce0e0`**, test-first throughout — every
assertion watched failing first and every one sabotage-verified. All seven
`guards.yml` checks run verbatim and green (the commit-message guard scanned
195 commits). This closes §42H item 1, the first agent-buildable item.

#### A — What changed, and what deliberately did not

Step 3 now reads: the own-place block (a photograph of the place, then "or
describe it"), then the prose introducing the rail, then the rail with the
own-place card at its FRONT, then the dots.

**THE REVEAL MECHANIC IS UNCHANGED, AND THAT IS THE WHOLE POINT.** `.ownplace`
is still shown by `#pl-own:checked ~ .wrap`, the rule that has always driven
it. What changed is that `pl-own` carries `checked`, so the condition is true
when the page arrives. No JavaScript, no second mechanism, no new CSS beyond
one margin. **Do not add a second way to reveal that block.**

**`pl-own` HAS TWO JOBS AND ONLY ONE OF THEM IS NEW.** It reveals the block,
and it is **the only way out of a radio group** — a group cannot be cleared
without JavaScript, so once a preset is clicked that card is what "none of
these" means. It is the way BACK now rather than the way in. Do not delete it
on the grounds that the block no longer needs revealing.

**The dots follow the cards.** They are a position indicator; if the two
orders disagree the indicator lights the wrong position, which no test that
merely counts them can see. There is one that compares the sequences.

#### B — A CARD AND A PHOTOGRAPH ARE TWO ANSWERS TO ONE QUESTION

**A `display:none` file input still submits.** So the own-place upload, once
filled, rode along even after the block was hidden by clicking a preset — and
`POST /api/jobs` took `placePhoto` as authoritative for `kind` while reading
the caption from `firstFilled(fields.place, ...)`. The manifest came out
`{kind:'photo', value:'ostsee-strand'}`: **the customer's own garden
photograph captioned with the beach preset**, and nothing downstream could
tell that had happened. No test covered the combination.

It was reachable before this change and it is one click away now, so it is
refused by name — `PLACE_CONFLICT`, a 400 naming both halves. That is this
endpoint's own existing rule for an unavailable resolution or shape: refuse
rather than quietly render something the person did not ask for. **Paul chose
refuse over silently picking a winner**, with the two silent options on the
table.

**The test is a non-empty `place`, not a resolvable preset id.** That field is
the card channel and the form can only ever put a preset id or an empty string
in it, so anything else came from a hand-written POST and is ambiguous by
construction.

#### C — The one assertion a markup test cannot make about this

The reveal is **two layers** — an attribute and a stylesheet rule — and §36B
records a regression test going green while the page was still broken for
exactly that reason. So `test/browser-smoke.test.js` measures painted pixels:
non-zero width and height, and document position against the rail. Proved by
flipping **paint order alone** (a `position: relative; top`, leaving DOM order
untouched) and watching it fail at 2675px against 1976px.

Both own-place controls also carry an `aria-label` now. They leaned on the
prose beside them, which was survivable while they were hidden and is not once
they are the first controls in the step.

#### D — NOT DONE, AND IT IS THE OWNER'S CALL

**The place upload is still a bare native `Choose File | No file chosen`.**
Step 1's photo upload is a designed `.drop` panel ("+ Add photo", a recess, a
hint); step 3's is the browser's default control — and it now sits directly
across from step 1 as the lead control of its own step. Screenshotted at
375px and 1440px to confirm. It reads as an afterthought, which is the exact
impression this change exists to remove.

**It was left alone on purpose, because doing it properly is not a restyle.**
`.drop` hides its input at `opacity: 0` and shows the chosen filename through
`HOME_SCRIPT`; reusing it for a second input means extending that inline
script and adding a slimmer variant of a 15rem-tall component. Without the
script half, a `.drop` place upload would give **less** feedback than the
native control it replaced. That is a design decision with a script change
attached, and design on this page is Paul's.

#### E — Things that will bite

- **THE BACKTICK TRAP FIRED AGAIN**, on the first edit to `views.mjs`, exactly
  as this file has warned since 2026-08-21 — a backtick inside an HTML comment
  inside a template literal. It was caught immediately by the `node --check`
  this file prescribes, which is the only reason it cost seconds. **Run it
  after every edit to `views.mjs` and `static.mjs`.**
- **A STRUCTURAL TEST CAN MATCH ITS OWN DOCUMENTATION.** The assertion that
  the free text is no longer inside a disclosure failed against correct code,
  because the comment explaining the OLD layout names the element it used.
  Structure is now asked of a comment-stripped copy — the precedent
  `test/email-templates.test.js` set on 2026-08-30 in the other direction: a
  template ACTION inside a comment is live text and must be caught, an ELEMENT
  named inside a comment is prose and must not be. **Verified it still catches
  a real disclosure before trusting it.**
- **A screenshot is worth taking on a layout change.** Every assertion passed
  before anyone looked at the page, and §43D — the thing most worth telling
  the owner — was visible only in the laptop screenshot.

---

### 44. THE JUDDER STOPS ARRIVING ON A METRONOME (2026-08-30)

**1947 / 1945 → 1957 / 1955 pass / 0 fail, 2 skipped.** +10 tests. **One
commit, `e5aa898`**, test-first, every assertion sabotage-verified. All guards
green. This closes **§32 item 13**, open since 2026-08-25.

#### A — What it does, and what it does not

fal delivers 24fps against a 25fps contract, so `fps=fps=25` holds one frame in
every 25 for two. **Measured, and it reproduces §26 exactly: positions 12, 37,
62, 87 … every gap 25.** Periodic judder is the most visible kind because the
eye locks onto the rhythm, and it was in every tape this product ever made.

Of §26's three ways out, **Paul chose the second: keep the duplicates and
scatter them.** Each source frame's presentation time is nudged by a fraction
of a frame BEFORE the retiming, so the fps filter decides hold-or-advance on a
slightly uneven grid. Measured on the shipped seed, the spacing goes from a flat
25 to **22 24 28 25 22 24 28 25 22 24 29 26 22 25** — count unchanged at 15.

**FIFTEEN FRAMES ARE STILL REPEATED. This moves them; it does not remove them.**
Removing them was the interpolation option, which invents pixels that were never
delivered. **And the result is not white noise** — the faster cosine has a
period of about 96 frames, so the gaps carry a residual four-duplicate cycle. It
is a wobble around 25 rather than a flat 25, which is enough to stop the eye
locking on; it is not perfect irregularity, and nobody should describe it as
such.

`transport.judderScatter` in `config/look/base.json`, shipped at **0.25**.
**0 restores the metronome exactly**, which is the way to A/B it.

#### B — TWO CORRECTIONS THE MEASUREMENTS MADE, and neither was reasoning

1. **THE RATES HAVE TO BE SLOW.** The first attempt borrowed `jitterX`'s 2.399
   and 7.13 radians per frame — the house idiom, and correct for SPATIAL
   wobble. For TIMING it is wrong: a fast wobble changes the spacing BETWEEN
   adjacent frames, so two land in one output slot and leave a gap in the next.
   **Duplicates went from 15 to 42** — dropping real frames and repeating
   others, which is worse than the defect. Slow rates move neighbours together,
   so spacing survives and only the phase against the output grid moves.
2. **`-frames:v` IS A CEILING, NOT A FLOOR**, and this was asserted to Paul as a
   guarantee before it was checked. It stops ffmpeg after 375 frames; it cannot
   invent a 375th the graph never produced. A nudge that pulls the LAST frame
   earlier shortens the span by a slot, and a source with no slack — a 15.000s
   lavfi clip, which is what the output-contract tests render — came out at
   **374 frames and 14.96s**. The fix is a nudge that is **zero at N=0 and never
   negative**: the span can then only grow, and the ceiling trims the surplus.
   **That is why the seed varies the RATES and not a phase** — a phase offset is
   precisely what displaces frame zero.

Raised cosines, never `random()`, which is not reproducible across ffmpeg
builds. `CLAMPS['transport.judderScatter']` caps at **0.45**: at half a frame a
nudged frame can overtake its neighbour, which is a non-monotonic dts and a
graph ffmpeg refuses. Clamped rather than refused, following the rule the rest
of that table already states.

#### C — Two things about the test that are the point of it

- **IT MEASURES THE RAW RETIMING, NOT A FINISHED TAPE.** The tape chain adds
  per-frame temporal grain (`noise=allf=t+u`), so two output frames are never
  byte-identical even when one is a duplicate of the other. **A framehash of the
  delivered mp4 reports zero duplicates on a tape that is full of them.** §26
  measured the raw segment for this reason and so does this file.
- **IT ASSERTS THE DEFECT BEFORE IT ASSERTS THE FIX** — a flat 25-frame cadence,
  from a source whose every frame is unique — so it cannot pass vacuously.
- **A 25fps source is proved untouched, not argued to be.** `buildVideoFilter`
  also serves `npm run look` over the REAL footage in `assets/stock`, where
  there is no judder to fix and inventing one would be damage.

#### D — Things that will bite

- **THE FULL SUITE FOUND THE 374-FRAME BUG, NOT THE NEW TEST FILE**, 56 seconds
  into `ffmpeg-output.test.js`. There is now an invariant test in the judder file
  that trips on the same mistake in under a millisecond, but the lesson is the
  older one: **a new feature's own tests measure what its author thought of.**
- **The golden spine in `tapedeck-look.test.js` did NOT move**, correctly — it
  builds from the FIXTURE profile, which sets no `judderScatter`, and
  `judderExpr` returns null for an absent amplitude. So the shipped source chain
  is not covered by that golden string. Worth knowing before trusting it.

#### E — A correction to this file, found by checking

**"Two cheap wins nobody has taken" in the START HERE block is stale — both were
taken.** The kitchen clock tick is in `kuechentisch-fruehstueck.json` (a 2400 Hz
partial gated 20ms in every 1000ms, so the integrated loudness contribution
stays tiny) and the fluorescent buzz in `plattenbau-treppenhaus.json` (100 Hz
ballast hum plus a 300 Hz third harmonic). Both carry full derivations.
**Also: §37G reads as though image moderation still needs code. It does not** —
`imageModerateImpl` is already a null seam in `safety/moderate.mjs`, honest
about being one, recording `image-unclassified` warnings in the manifest. Only
the vendor choice is left, and that is the owner's.

---

### 45. THE STRIPE GROUNDWORK, AND WHAT THE ACCOUNT ACTUALLY SAYS (2026-08-30)

Paul said "we will do the stripe verification now". **Verification itself was
not done and could not be**, and the reason is the finding: read off the live
API, the account the test Prices live in is a **sandbox belonging to another
product**, and a sandbox cannot be verified.

```
id                   acct_1U4JIj0WJAHtsKz6
business_profile     name: "ClearCost sandbox", url: null, support_email: null
country / currency   DE / eur
business_type        null
details_submitted    false      charges_enabled false      payouts_enabled false
capabilities         {}         statement_descriptor null
```

**§27's warning is confirmed at the source rather than by rendering a page.**
Checkout prints the ACCOUNT's business name and there is no per-Price override,
which is why one account cannot serve two product names.

#### A — TWO DECISIONS PAUL TOOK, both binding

1. **Timestamp sells from its OWN live Stripe account.** Consequences, all in
   `docs/deploy-runbook.md` under "Going live on Stripe": activation happens
   twice, and **both Price ids in `config/credits.json` are TEST objects that
   cannot be promoted** — a Price is immutable and lives in one mode on one
   account, so both rungs get created again and the ids pasted.
2. **THE DEPLOY MOVES AHEAD OF ACTIVATION, reversing §41's "deploy at the
   end".** Stripe's activation asks for a business website; `url` is null and
   nothing is reachable. A consumer AI product with no site invites a manual
   review. So: Hetzner box, runbook §§1-4, then file.

#### B — A CORRECTION TO THE RUNBOOK, found before it cost an evening

Its DNS row still said mail to the apex bounces and `support@` needs Email
Routing before it can go in a footer. **§42A closed that the same morning** —
the mailbox forwards and was proved forwarding. Following the runbook tonight
would have meant re-doing finished work. Fixed, with what §42A actually
established (including that catch-all is deliberately OFF).

#### C — Buying credits now asks for the credits (`0a95067`)

`/terms` said *"Credits are not redeemable for money"* and **nothing anywhere
asked the customer to agree to it.** Credits are supplied the instant a payment
lands, so a buyer who never expressly asked for immediate supply — and was
never told what asking costs them — keeps a cancellation right that sentence
was denying.

**THE OBLIGATION TRAVELS WITH THE SELLER, NOT THE BUYER'S ADDRESS.** The
operator is a trader established in Germany, so it is the same rule on every
sale, to anyone, anywhere. **This was first described here as being about "EU
customers" and Paul corrected it**: the product is worldwide and the copy must
not read as though it is European. **There is no region branch in any of this
and there must not be one** — a patchwork of regional clauses satisfies fewer
regimes than one clear promise, and there is a test that fails if a region name
appears in the terms.

Three parts: a required checkbox on the buy form in plain words; a server
refusal by **set membership, not truthiness** (the CONSENT_YES rule — "false"
and "0" are non-empty strings) placed **before the pack is resolved**, so
nothing reaches Stripe; and a **Cancelling and refunds** section on `/terms`,
which doubles as the refund policy activation asks a business to state.

**THE ONE-INPUT GUARD WAS RE-EXPRESSED RATHER THAN DELETED, and it is stronger
now.** It asserted the checkout form carries exactly ONE field — a proxy for
the property that matters, which is that nothing in the form can change what is
charged. A count cannot say that: it would have passed a second hidden field
that replaced the first. It is now a field-name allow-list plus an explicit
refusal of anything named like an amount, a credit count or a price. **Seven
existing checkout tests were updated to send what a browser now sends** — the
contract changing deliberately, not tests being relaxed.

#### D — Things that will bite

- **A `perl -0pi -e` sabotage silently did nothing** because the pattern
  contained `${h(rung.id)}` and perl tried to interpolate it. The grep said 0
  and the guard looked blind. **Same family as §42G: print the mutated line and
  confirm it changed** — it was redone with the Edit tool and caught
  immediately. The heredoc also ate `\b` escapes in a test edit, third session
  running. **Use Write/Edit for anything with an escape.**
- **THE PRICES ON A BROWSER-SMOKE SCREENSHOT ARE FIXTURE VALUES.** A screenshot
  of `/pricing` shows 480p at ~51 CR and 720p at ~152 CR, which look like a
  live pricing bug against the 21/28/46/61 this file documents. They are not:
  `test/browser-smoke.test.js` fakes `creditCost` in its own harness. Verified
  against the real `creditCost` before reporting anything — **21/28/46/61 is
  correct and this file is not stale.**
- **The acknowledgement renders once per PAID rung**, so the same sentence
  appears twice on `/pricing`, and in a three-column grid it wraps to about
  eight short lines. It reads fine and it is not pretty; a shared line above
  both buttons would need one form to own a field the other posts, which is
  exactly what the guard above forbids.

#### E — What is left

**PAUL'S, in his chosen order:** create the Hetzner box and walk the runbook;
then Stripe activation on a NEW account, with the business name and statement
descriptor chosen deliberately (both reach customers and both are awkward to
change); then the ~$2 paid web order (§38E) and the friends test.

**AGENT-BUILDABLE:** nothing is ungated again. The punch-in zoom (§34G) is
buildable but only a paid render can judge it.

---

### 46. IT IS DEPLOYED, AND STRIPE IS ACTIVATED (2026-08-30/31)

**The two things this file has called blockers for a fortnight are both done.**
Timestamp is live at **https://timestamptapes.com**, and its own Stripe account
is verified and able to charge cards. Everything below was read off the live
API or the live site, never assumed.

**Nothing was committed for the deploy itself** — it is a server and a `.env`,
not code. The commits from that session are §§43-45 plus the four small changes
in §46E. Local, `origin/supabase-identity-slice` and the box are all at
`711603b`; the tree is clean.

#### A — The box, and the price this file had wrong

| | |
|---|---|
| Host | Hetzner **CPX22**, `178.105.77.16`, Falkenstein |
| Spec | 2 vCPU / 3.8 GB / 75 GB free — the shape the image was proven on |
| OS | **Ubuntu 26.04 LTS**, not the 24.04 the runbook names |
| Cost | **€23.79/mo**, and backups are OFF |

**§34A's €5 IS STALE AND THE GAP IS 5x.** The CX line it priced —
CX23 at €4.49-5.49 — is **"temporarily not available"** in every location
offered, tied to the "Limited availability of cloud instances" notice Hetzner
has had open since June 2026. CPX22 is the cheapest thing that fits. Re-price
before quoting that table again.

**UBUNTU 26.04 RATHER THAN 24.04 WAS A CHECK, NOT A SHRUG.** The image change
did not take at creation, and rather than rebuild, `docker.io`,
`docker-compose-v2` and `git` were confirmed present in 26.04's archive first.
They are. The app runs in a pinned `node:22-bookworm-slim` container anyway, so
the host distribution reaches very little.

**BACKUPS ARE DELIBERATELY OFF** and this is a decision with a trigger on it.
At €5/mo they were an easy yes; at €28/mo with **no customer data on the disk
yet** they are not. `npm run backup` covers the irreplaceable half (accounts,
owners, refunds) and needs no Hetzner feature. **Turn them on the day before
real money moves** — that is the point where losing the disk stops being an
inconvenience and starts being somebody's paid credits.

#### B — Stripe: activated, on its own account

```
acct_1UAGgQPFjb61BCp6      country DE, default currency EUR
charges_enabled    true
payouts_enabled    true
details_submitted  true
```

**It is a SEPARATE account from ClearCost**, per §45A — created through the
switcher's "Create a separate account", so it shares no data, team or reporting
with the other product. §27's warning about the business name on the checkout
page is now closed at the root rather than worked around.

**MANAGED PAYMENTS IS ON, AND IT IS A 3.5% DECISION.** Stripe is the merchant
of record: they are liable for global sales tax and VAT and they handle
disputes. It costs **3.5% on top of the usual ~2.9% + 30c**, which is about 15%
of the gross margin on a $12 pack. Taken knowingly, because the alternative is
the owner registering for OSS and filing returns in a business that has not yet
made a sale. **Revisit when revenue is real** — the screen says it can be
changed.

| | |
|---|---|
| Fraud | **Radar Lite** (free). Standard was preselected at €0.05/txn and refused — Managed Payments already covers fraud, and Lite explicitly covers card testing, which is the actual threat to a new account. |
| Climate | Off. Revisit when the business supports it. |
| Statement descriptor | `TIMESTAMPTAPES` |
| Category | Digital Audio Visual Works — downloaded with **permanent** rights and streamed, non-subscription |

**THE LIVE PRICES, verified through the API rather than the dashboard:**

| Rung | Price id | Checked |
|---|---|---|
| Starter $12 / 92 CR | `price_1UAIGtPFjb61BCp6zlUEqIuZ` | `livemode: true`, `type: one_time`, `recurring: null`, `usd`, active |
| Standard $19 / 138 CR | `price_1UAIIXPFjb61BCp68LnLnwc3` | same |

`recurring: null` is the one worth checking on any future Price: the create form
**defaults to Recurring**, and a recurring Price in `mode: payment` is refused by
Stripe in front of the customer at the moment they click Buy.

**TAX IS EXCLUSIVE AND THE PAGE NOW SAYS SO.** Measured in the dashboard: a $12
pack shows a German buyer **$14.28**, VAT added on top and remitted by Stripe.
That is the better direction — VAT *inside* $12 would have left ~$9.01 against
a $9.20 provider cost, i.e. **a loss on every EU sale**. `/pricing` carries a
line saying tax is added at checkout, and it names no region on purpose: the
rate follows the buyer, so no single printed total is true everywhere.

**Webhook:** `https://timestamptapes.com/api/stripe/webhook`,
`checkout.session.completed` only, **Snapshot** payload (the "thin" style sends
a stub this code does not fetch), scope "Your account".

#### C — What is proven, and what is still not

**PROVEN, by doing it:**

- The site answers over HTTPS with a Let's Encrypt certificate Caddy got itself.
- **A real signup worked on the live domain** — the owner's own test; the
  six-digit code arrived and the account opened.
- The three legal pages carry the real entity and cite § 5 DDG.
- An **unsigned** POST to the webhook is refused **400**. That refusal is the
  only thing between a forged event and credits appearing from nowhere.
- `/pricing` shows Buy buttons rather than "Not open yet".
- The image build ran the 36-filter ffmpeg preflight and passed, so the video
  chain works on this machine.

**NOT PROVEN, and both cost real money:**

1. **No card has ever been charged.** The whole payment path is wired and
   verified piece by piece; nobody has run a pound through it. Buy a Starter
   pack (~$14.28), confirm 92 credits land, refund from the dashboard.
2. **No web order has ever reached real fal.** `worker.lastSeen` is `null` —
   the worker has never rendered a job on this box. §38E is the runbook.

#### D — THE KEY ROTATION, AND THE PASTE THAT FAILED TWICE

The first live secret key was pasted into the chat and therefore had to be
rolled. It was, and Stripe answered `Expired API Key` on the old one — the
exposure is closed.

**GETTING THE REPLACEMENT ONTO THE BOX FAILED TWICE, AND NOT ON THE SERVER.**
A `read -rs -p ... K` one-liner was pasted into the terminal; both times the
clipboard still held **the command text itself**, so the command was fed into
its own prompt and `.env` came out holding
`STRIPE_SECRET_KEY=read -rs -p "Paste new key...`. `docker compose` then warned
`The "K" variable is not set` — the literal `$K` had been written into the file.

**Two lessons, both cheap:**

- **`read -s` hides the input, so a failed paste looks identical to a
  successful one.** Confirm the clipboard first — paste into Notepad and look.
- **The fix that worked was `nano` into an EMPTY file** (`newkey.txt`), then a
  script to merge, `shred`, and restart. One paste, visible, nothing to
  mis-quote. Use that shape for any secret going onto a box.

**An extraction attempt in between made it worse and is worth recording:**
pulling `sk_live_[A-Za-z0-9]+` out of the mangled line returned a key with two
stray characters on the end, because `_` is not in that class and two
concatenated keys merge into one match. It verified as invalid. **Do not
reconstruct a secret with a regex; get it again from the source.**

#### E — What changed in the code

| Commit | What it does |
|---|---|
| `9351e49` | A takedown request has somewhere to go; the runbook's `git clone` names the branch (a default clone gets `main`, 201 commits behind, with no Dockerfile) |
| `9afb34a` | The legal notice is in English — the statute stays German because a statute's name does not translate, and the word "Impressum" stays because German visitors scan for it |
| `ee62e31` | `/pricing` says the listed price is before tax |
| `711603b` | Both rungs point at the live Prices |

Plus `docs/stripe-activation.md` — what activation asks, which answers this
project already holds, and which are the owner's and deliberately absent from a
public repository.

#### F — Things that will bite

- **THE SITE IS `noindex` AND THAT IS CORRECT.** `TIMESTAMP_INDEXABLE` is unset,
  so `robots.txt` disallows everything and every response carries
  `X-Robots-Tag: noindex`. Do not lift it casually — §42E: the Impressum
  publishes a home address, and Certificate Transparency already published the
  hostname the moment Caddy issued the certificate, so "nobody has the link" was
  never the protection.
- **`.env` ON THE BOX IS THE ONLY COPY OF FOUR SECRETS** — the fal key, three
  Supabase keys, and the two Stripe secrets — and it is `chmod 600`, gitignored,
  and out of the image. `npm run backup` does NOT include it. Losing the server
  means re-fetching every one of them from its own console.
- **`TIMESTAMP_LEGAL_ENTITY` lives only in that `.env`**, by design (§42D). The
  street is **Keplerstraße**, not Kaplerstraße — this file and the live site
  both carried the wrong spelling for about an hour because it was guessed from
  a transcription and confirmed by a leading question. Stripe's copy is what
  caught it.
- **A price on a browser-smoke screenshot is a fixture value** — §45D, and it
  came up again while reviewing the live pricing page. Real costs are
  21/28/46/61.

---

### 47. A THIRD PARTY WENT DOWN AND THE INSTALL STEP LIED ABOUT IT (2026-08-31)

**PR #1 went red on both Windows legs at `6bf5b1a` — a commit that changed THIS
FILE and nothing else.** Ubuntu stayed green. One commit, `d6ec4b6`, workflow
only; **CI is green again on all four legs, 1964 / 1962 pass / 0 fail / 2
skipped on every one.**

#### A — The outage, and how to tell it was one

`choco install ffmpeg` spent **105 seconds** collecting a **504 Gateway
Timeout** from `community.chocolatey.org`, installed `0/0 packages`, and the job
died at the NEXT step with `'ffmpeg' is not recognized`.

**BOTH WINDOWS LEGS FAILED AT THE SAME SECOND (13:18:45 and 13:18:46), AND THAT
IS THE TELL.** Two independent runners hitting the identical failure in the same
tick is one upstream event, not two code paths. Ubuntu was green because `apt` is
a different CDN. **Check the timestamps across legs before reading a matrix
failure as a code defect** — it is the cheapest available discriminator.

It was **still down hours later** (503 on the same query, measured, not assumed)
and recovered around 13:35. So "re-run it" would have failed again, and the
window in which a re-run was the right answer was never open.

#### B — THE PART THAT WAS OURS: A FAILED INSTALL REPORTED SUCCESS

**`choco install` EXITED 0 having installed nothing.** So the step that actually
broke was marked `success`, and the failure surfaced one step later wearing a
PATH error's clothes — which is what the emailed annotation showed and where the
diagnosis would naturally have gone first.

**A PACKAGE MANAGER'S EXIT CODE IS NOT EVIDENCE THAT A BINARY EXISTS.** The step
now probes for the binary and ignores what choco returns. Three rulings, one per
part:

1. **Probe, do not trust the exit code.**
2. **Retry with backoff** — a 504 is usually a blip.
3. **Fall back** — this one was not a blip, and retry alone would have stayed red
   for hours.

#### C — The fallback installs the SAME build, and that is now measured twice

`ffmpeg-release-essentials.zip` from gyan.dev. It was chosen on the inference
that the chocolatey package wraps gyan's builds — choco asked for `9.0.1` and
gyan's own `release-version` file said `9.0.1` — and **the green run then proved
it outright: the ffmpeg choco installed on the runner identifies itself as
`9.0.1-essentials_build-www.gyan.dev`.** The fallback is the same artifact, not a
substitute. That matters because §4 records two CI reds that were really one
ffmpeg build's wording.

**Verified on that build before trusting it, by downloading and running it:
all 36 filters `doctor` requires are present, `libfreetype` included** — which is
what `drawtext` needs and precisely the omission `doctor`'s own header names as
the failure it exists to prevent. "Essentials" sounds like it might be short of a
filter; measured, it is not.

**`Expand-Archive` ships inside PowerShell, so this adds no tool, no marketplace
action and no dependency** — `test.yml`'s own no-third-party-action ruling
survives intact. `ffmpeg-release-full.zip` does not exist (404); only `full.7z`
and `essentials.zip` do, which is why the zip is the essentials one.

#### D — A BUG IN THE FIX, CAUGHT BY RUNNING THE FIX

The verification line was first written as
`& $found -version 2>&1 | Select-Object -First 1` followed by a
`$LASTEXITCODE -ne 0` check. **Measured: that left `$LASTEXITCODE` at `-1` on a
run where ffmpeg had plainly printed its version — so the step would have failed
the build ON THE HAPPY PATH.** Reading `$LASTEXITCODE` after a pipeline that can
stop early is unreliable. Captured, then checked, then printed.

**It was found by executing the step locally, not by reading it.** An isolated
repro without the `2>&1` returns 0, so this does not reproduce from the obvious
one-liner — which is the argument for running the thing rather than reasoning
about it.

#### E — What is proven and what is not

Both directions were exercised locally before the push, in this repo's sabotage
discipline: **both sources unreachable → exit 1 with a named error; ffmpeg
present → exit 0 and the network never touched.**

**THE FALLBACK HAS NEVER RUN ON A REAL RUNNER.** Chocolatey recovered before the
verifying run, so the green above took the PRIMARY path (`attempt 1 of 3`, 23
seconds). The fallback's first live outing will be the next chocolatey wobble.
Stated plainly so nobody reads that green tick as coverage it is not.

#### F — Things that will bite

- **A matrix failure that lands on two legs at the same second is upstream.**
  Look at the clock across legs before reading the diff.
- **A docs-only commit can be red and be innocent.** `6bf5b1a` touched only
  `CLAUDE.md`. Check what the commit actually changed before believing it.
- **`gh run view --job <id> --log` echoes the whole `run:` block**, so grepping
  for `::error::` matches the SCRIPT TEXT as well as any real emission. The
  echoed lines carry ANSI colour codes and the executed ones do not; tell them
  apart by that, or by the timestamp ordering.
- **This step must stay `shell: pwsh`.** The default Windows shell for a bare
  `run:` is also pwsh here, but the script uses `$env:GITHUB_PATH` appends and
  `Get-Command`, and it should not silently become `cmd` if a default ever moves.
- **`test.yml` is NOT pinned in `.gitattributes` and does not need to be**,
  unlike the Dockerfile (§34B): YAML block scalars normalise line breaks, so a
  CRLF checkout cannot break the embedded script the way a CRLF `\` continuation
  breaks a Dockerfile.

---

## Not in scope

~~**Billing.** Accounts, credits, Stripe, rate limits.~~ **ALL FOUR ARE BUILT
and this line is kept only so nobody cites it.** Accounts and the credit ledger
shipped 2026-08-20, Stripe checkout and the webhook 2026-08-25 (§25, §27), and
per-address rate limiting on the two credential routes 2026-08-26 (§28). What
is still true is the spirit: **nothing here takes a card number**, and checkout
is hosted on the provider's own domain.

~~The web app~~ — **no longer out of scope.** Paul reordered on 2026-08-20: build the app end to end with generation stubbed, *then* uploads, *then* real video APIs. See "Where things stand" at the top.

~~Face detection at intake~~ — **no longer deferrable.** It was deferred for a CLI Paul ran on his own photos. The product takes uploads from strangers, so it is required, along with the consent gate, retention limits and takedown path.

**A second paid provider.** `fixtureProvider` is a genuinely different implementation exercised by the same conformance test, which is what makes the interface an abstraction rather than a wrapper with optimism. Replicate would buy vendor-risk insurance, not interface validation.
