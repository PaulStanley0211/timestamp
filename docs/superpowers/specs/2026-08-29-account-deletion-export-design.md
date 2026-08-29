# Account deletion and data export — design

**Status: SPEC ONLY. No plan and no code exist yet.** Written 2026-08-29,
after the launch-readiness review found the product promises deletion on
every page (`views.mjs` footer, the consent text) while no route, CLI
command, or function can delete a person — GDPR Art. 17 (erasure) and
Art. 20 (portability) are unimplementable even by the operator by hand.

## 0. Why this must exist before customers do

The footer on every page says "You can ask for either sooner." The consent
text every account holder ticks says "I can ask for either to be deleted
sooner." Today the strongest thing the operator can do about either sentence
is delete files by hand and hope they found them all. This product takes
photographs of faces, ships them to a third-party model provider, and charges
money; a deletion path is a launch precondition, not a feature.

## 1. What deletion means here

Deleting an account removes, in this order:

1. **The Supabase identity, FIRST.** `DELETE {SUPABASE_URL}/auth/v1/admin/users/{supabaseUserId}`
   with the service-role key — a new `adminDeleteUser` in
   `scripts/auth/supabase-auth.mjs`, same transport seams as everything else
   there. First because it is the external, irreversible half: if it succeeds
   and a later local step fails, the person can no longer sign in and the
   local remains are cleanable litter; the reverse order leaves a live
   upstream identity pointing at deleted local state, which is how the
   `claimAccount` rebind refusal (the `4f53dc6` failure shape) gets
   re-created. Full deletion avoids that trap entirely: a later signup with
   the same address gets a NEW Supabase id and a NEW local account, and
   nothing tries to rebind.
2. **Every job the account owns.** Walk `out/owners/<accountId>/`; for each
   job id, run the same deletion `DELETE /api/jobs/:id` performs (cancel
   sentinel for queued work, media removal), then remove the job directory.
   **A job holding a live lease refuses the whole deletion with a 409** — the
   page says "a tape is still rendering; cancel it first." That is minutes of
   delay, not a denial, and it keeps the deletion from racing a renderer that
   is writing into the directory being removed (the retention sweep's
   live-lease rule, applied here).
3. **The ownership index directory** `out/owners/<accountId>/`.
4. **Every session** for the account. `scripts/auth/session.mjs` needs a
   `destroySessionsFor({ root, accountId })` — sessions are files keyed by
   session id, so this is a scan; acceptable at this product's scale.
5. **The local account record**, last — `deleteAccount({ root, accountId })`
   in `scripts/auth/accounts.mjs`, removing the account file and the email
   index entry.

**What deletion does NOT touch, and why each is deliberate:**

- `freeTape` global state. The ceiling counts grants "across every account
  that has ever existed" — its own comment — so deletion must not decrement
  it; otherwise create-delete-create farms the free grant, which is exactly
  the drain the ceiling exists to bound.
- Stripe's records. They live at Stripe, under Stripe's own legal basis;
  nothing here can or should erase a payment record.
- `out/refunds/` reconciliation records for the account's jobs — settled ones
  are an audit trail with no photograph in them; pending ones represent money
  and must be resolved by the operator, not vanished. Deletion should list
  them in its response so the operator sees them.

**OPEN QUESTION FOR PAUL (blocks nothing else): the credit ledger.** The
account file embeds the ledger. Deleting it erases the purchase audit trail;
financial-records retention is a legitimate GDPR basis for keeping an
anonymised copy (rows have no name or address — accountId, deltas, reasons,
Stripe event refs). Options: (a) delete everything, Stripe remains the
financial record; (b) write `out/deleted-ledgers/<accountId>.json` with the
rows only. (b) is one extra write and keeps the money history auditable;
recommended, but it is a data-retention decision and therefore Paul's.

## 2. Export

`GET /api/account/export` returns one JSON document: the account record
(minus internal fields — no scrypt hash, no rev), the projected ledger
(`entriesOf` shape), and per owned job the manifest's input/output metadata
(place, outfit, resolution, aspect, status, timestamps, cost) — not the
media files themselves; the person already holds download URLs for those on
their shelf, and a multi-hundred-MB zip is a different feature.
`Content-Disposition: attachment; filename="timestamp-export.json"`.

## 3. The page

`GET /account`: a `wrap--narrow` panel page like login — the signed-in email,
the balance, an "Export your data" link, and the deletion form. The deletion
form requires the account's own email typed into a confirmation field
(`confirm`), carries the CSRF pair like every auth form, and posts to
`POST /account/delete`. Server-side the typed value must equal the session
account's email — a one-way door gets a typed confirmation, not a checkbox.
On success: destroy the requester's session cookie, 303 to `/` with nothing
identifying left. The nav gains an "Account" link beside Sign out.

## 4. Routes and gates

| Route | Gate |
|---|---|
| `GET /account` | session required |
| `GET /api/account/export` | session required |
| `POST /account/delete` | session + `sameOriginPost` + CSRF pair + typed email match |

Degradation: deletion needs Supabase configured (the admin call). With no
Supabase, `POST /account/delete` answers 503 `IDENTITY_UNAVAILABLE` like the
other identity routes — a deletion that silently skips the upstream half is
worse than one that says "not right now".

## 5. Seams and tests

- The auth seam gains `deleteAccount` and `destroySessionsFor`;
  `missingAuthFunctions` does NOT add them to `REQUIRED_AUTH` — the route
  feature-detects and 503s when absent, so existing test fakes stay valid.
- Tests, all failing first: deletion removes account + owners + jobs +
  sessions and calls the Supabase admin endpoint (fake transport asserts the
  URL and method); a live-leased job refuses with 409 and deletes nothing;
  deletion is refused without the typed email; a foreign-origin post is
  refused; export contains the ledger rows and no hash; after deletion the
  session cookie is dead and `/account` 401s; a fresh signup with the same
  address gets a NEW account untangled from the old one; freeTape state is
  unchanged by delete-recreate (the farming test, 8-thread not required).
- The purge sweep must tolerate `out/owners/<accountId>` vanishing mid-scan
  (it already tolerates missing manifests; verify, don't assume).

## 6. What this deliberately does not do

No soft-delete or grace period (a keepsake product could argue for a 7-day
undo; that is a product decision to take later, and adding it after ship is
additive). No admin-initiated deletion UI — `npm run accounts` can grow a
`delete` subcommand in the same change at near-zero cost, and should, so the
operator can honour an email request without the person's password.
