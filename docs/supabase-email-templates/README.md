# Supabase email templates

The dashboard is the only place these live. This directory is the source of
truth for what was pasted there, because the dashboard has no history and no
export, and because **the templates that matter cannot be verified from
inside the app.**

**There are TWO, and only one has ever been applied.** Confirm signup was
pasted and proved on 2026-08-27. **Reset password has not been touched, which
means it is still Supabase's default — a magic link — and the reset flow
cannot survive one.** See its section below; it is item 4 on the owner's list.

## Paste the whole file, comments included — and why that is now safe

Both files carry a long HTML comment, and the instruction below is to paste
each one whole. **Until 2026-08-30 that instruction was unsafe**, and the
reason is worth stating because it is not obvious:

Supabase substitutes its variables by scanning the template as text. **An HTML
comment is not a hiding place from a template engine — it is just more text.**
Both comments named `ConfirmationURL` in its real `{{ }}` syntax, because they
were the comments explaining that it is forbidden. Pasted whole, that comment
would mint a **working magic link** and bury it in the source of every email:
invisible when rendered, and a live credential to anyone who reads the source
or is forwarded the message.

Both comments now name the variables **in words**, so the only real action left
in either file is the code itself. `test/email-templates.test.js` fails if any
other action appears anywhere in either file, comments included.

**CONSEQUENCE FOR THE ALREADY-APPLIED TEMPLATE: re-paste `confirm-signup.html`.**
The version sitting in the dashboard is the 2026-08-27 one with the old
comment. Whether it actually minted a link depends on which Go template package
GoTrue uses — one of the two strips HTML comments — and that is not a thing to
reason about when replacing it costs thirty seconds. To check rather than
assume, open any confirmation email you have received, use **Show original**,
and search the source for `ConfirmationURL` or for a `/auth/v1/verify` link.

## Confirm signup — `confirm-signup.html`

**Where:** Supabase dashboard → your project → Authentication → Emails →
**Confirm signup**.

**Subject:**

```
Your Timestamp confirmation code
```

The code is deliberately NOT in the subject. It would show on a lock screen
next to the name of a service that stores photographs of people's faces, and
iOS and Android read a one-time code out of the body anyway.

**Body:** paste `confirm-signup.html` whole.

**The one rule.** The body must contain `{{ .Token }}` and must not contain
`{{ .ConfirmationURL }}`, a button, or a link that signs anybody in. `/verify`
asks for six digits. Supabase's default template mails a magic link instead,
and a person who receives one is left in front of a field with nothing to type
into it — **and no request ever reaches this app to be wrong about, so nothing
here can detect it.** That is why this step is on the owner's list and cannot
be tested from the repo.

**How to know it worked:** sign up with a real address and read the mail. Six
digits and no button means it took.

## Reset password — `recovery.html`

**NOT YET APPLIED. This is the open half of the owner's item 4.**

**Where:** Supabase dashboard → your project → Authentication → Emails →
**Reset password**. (Supabase calls the underlying type `recovery`, which is
why the file is named for it; the dashboard tab says "Reset password".)

**Subject:**

```
Your Timestamp password reset code
```

Distinct from the signup subject on purpose — a person who has both mails in
their inbox must be able to tell which is which without opening either. The
code stays out of the subject for the same lock-screen reason as above.

**Body:** paste `recovery.html` whole.

**The same one rule, and the same undetectability.** The body must contain
`{{ .Token }}` and must not contain `{{ .ConfirmationURL }}`, a button, or any
link. `/auth/reset/complete` asks for six digits and a new password —
`verifyCode` sends them to Supabase as `type: 'recovery'`. Supabase's default
recovery template is a **"Reset password" link**, and a person who receives one
is stranded exactly as they would be on signup.

**What to check while you are on that screen**, because both are console state
the code cannot see:

1. The body shows six digits and no link when previewed.
2. `Email OTP length` is still **6** (Authentication → Sign In / Providers →
   Email). It applies to recovery codes as well as signup codes, and at 8 the
   form truncates and Supabase answers `otp_expired` — the same code it uses
   for a genuinely expired one, so the page blames the clock.

**How to know it worked:** ask for a reset on an account you control and read
the mail. Six digits and no button means it took. Then complete it — and
expect to be signed out of every device, because that is what completing a
reset does.

## Before any of this works: the editor is LOCKED

**Checked in the live dashboard on 2026-08-26.** On this project the template
editor is read-only: the page carries *"Set up custom SMTP to edit templates —
emails will be sent using the default templates"*, the **Source** toggle is
inert, and the body renders as a preview only. The template live right now is
Supabase's default magic link — *"Follow the link below to confirm this email
address"* over a `Confirm email address` link — which is exactly the thing the
six-digit page cannot survive.

The dashboard offers three ways to unlock it and no others:

| Route | Cost | Note |
|---|---|---|
| **Custom SMTP** | free plan | Also removes the 2-emails-per-hour project-wide ceiling. **Chosen 2026-08-26.** |
| Upgrade to Pro | $25/mo | Uses Supabase's own mailer; no third-party account |
| Send Email hook | code | Auth emails go through your own workflow instead of a template |

Custom SMTP lives at **Authentication → Emails → SMTP Settings**. Until it is
on, nothing in this directory can be applied.

### Why not just any SMTP provider

Sending **from a `gmail.com` address through a relay silently fails to Gmail
recipients** under the sender rules Gmail and Yahoo introduced in 2024 — no
bounce, no error, the mail simply does not arrive. That is the same
undiagnosable shape as the magic-link problem this template exists to fix, so
it is worth avoiding deliberately rather than discovering.

Without a sending domain (`TIMESTAMP_PUBLIC_URL` is still `localhost:3000`),
the honest option is a provider sandbox that mails **only the account owner**:
Resend's `onboarding@resend.dev` sends to the address the account was opened
with and nowhere else. That is enough to unlock the editor, apply this
template, and confirm six digits arrive — by signing up as yourself. Mailing
anybody else needs a verified domain, which this project will need anyway.

## Applied and proved — 2026-08-27

Custom SMTP went on first (Resend), the editor unlocked, and this body and
subject were pasted and saved: *"Successfully updated email template"*, with a
**Reset template** button appearing, which the dashboard only offers once a
template differs from its default.

**Proved end to end the same night.** A real signup produced a real mail: from
"Timestamp", subject *Your Timestamp confirmation code*, sent → delivered →
opened, rendering six digits in the code box and no link anywhere.

### One more console field, which this file did not know about

**Authentication → Sign In / Providers → Email → `Email OTP length` was 8.**
This app is six digits everywhere, so the form truncated the code and Supabase
rejected the fragment — reported as `otp_expired`, which is also what it returns
for a genuinely expired code, so the page blamed the clock. Set to 6.

Nothing in the app can detect a mismatch between that field and the six-digit
form, exactly as nothing can detect a template that mails a link. **Both are
console state the code cannot see. If confirmation ever breaks with no error
anywhere, check these two first.**

### Deliverability, while the sender is the sandbox

`onboarding@resend.dev` is shared, so Gmail files it under Spam or Promotions
far more often than the inbox. Search `in:anywhere from:onboarding@resend.dev`
rather than concluding nothing was sent — twice, mail that had already arrived
and been opened was believed missing. A verified domain fixes this and is owed
anyway; see the sandbox note above.
