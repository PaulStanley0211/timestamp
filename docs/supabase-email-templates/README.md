# Supabase email templates

The dashboard is the only place these live. This directory is the source of
truth for what was pasted there, because the dashboard has no history and no
export, and because **the one template that matters cannot be verified from
inside the app.**

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
