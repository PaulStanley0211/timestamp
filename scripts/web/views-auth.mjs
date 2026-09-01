/**
 * Sign in, create an account, and the plans.
 *
 * WHY THERE IS NO PAYMENT FORM ON THIS PAGE, AND WHY THAT IS NOT AN OMISSION.
 * `docs/interfaces-app.md` §A: nothing in this product may touch a card number,
 * a CVV or a bank detail. A "mockup" card field is the same risk as a real one
 * -- it is a text input on a public page asking for a card number, and whether
 * the bytes are stored is a detail the person typing them cannot see. If you
 * are reading this because you were about to add an input named cvv, the answer
 * is a hosted checkout redirect, not a field.
 *
 * WHAT THE BUY BUTTON ACTUALLY IS, SINCE 2026-08-25. A form with ONE hidden
 * field carrying a pack id, posting to this origin. The server resolves the id
 * against config/credits.json, creates a Checkout Session on Stripe's API and
 * answers 303 to Stripe's own domain, where the card is entered. Nothing on
 * this page names a price to the server, and nothing on this page is a payment
 * field. The button is disabled until the pack has a Stripe Price, because a
 * Price is immutable and creating one is gated -- section 7 of
 * docs/superpowers/specs/2026-08-24-credit-packs-pricing-design.md.
 *
 * AND IT GRANTS NOTHING. Neither does the page Stripe returns to: the success
 * banner below is driven by a query parameter that anybody can type, so it says
 * "shortly" rather than claiming a balance it has no way to know about. The
 * credits arrive on a signature-verified webhook or they do not arrive at all.
 *
 * WHY THE SIGN-IN AND SIGN-UP FORMS CARRY A HIDDEN `csrf` FIELD. `SameSite=Lax`
 * on the session cookie stops a foreign page acting AS somebody's session,
 * which covers every state-changing POST made while signed in. What it cannot
 * stop is a foreign page CREATING a session: a login post needs no cookie, so
 * a page that auto-submits the attacker's own credentials signs the visitor in
 * as the attacker, and the next photograph they upload lands on the attacker's
 * shelf. The field is one half of a signed pair -- the other half is a cookie
 * only this origin can set -- and the server refuses these two posts without
 * both. `session-middleware.mjs` owns the pair; these templates only carry it.
 *
 * WHY THE PASSWORD FIELD HAS `autocomplete` SET EXPLICITLY. `current-password`
 * on sign-in and `new-password` on sign-up is what tells a password manager to
 * offer the saved one in the first case and to generate one in the second. It is
 * two attributes and it is the difference between a manager that works and a
 * manager that fills the wrong thing.
 */

import { h, layout } from './views.mjs';

function field({ id, name, label, type = 'text', value = '', autocomplete = 'off', required = true, hint = '' }) {
  return `<div class="field">
  <label for="${h(id)}">${h(label)}</label>
  ${hint ? `<p class="hint">${h(hint)}</p>` : ''}
  <input type="${h(type)}" id="${h(id)}" name="${h(name)}" value="${h(value)}"
         autocomplete="${h(autocomplete)}"${required ? ' required' : ''}>
</div>`;
}

/** A `next` that is not a same-origin absolute path is not a `next`. Rendered
 *  only after the server has already refused anything that is not `/...`, but
 *  written as a hidden field here so the check has a single visible consumer. */
function nextField(next) {
  return next ? `<input type="hidden" name="next" value="${h(next)}">` : '';
}

/** The hidden half of the anti-forgery pair. Rendered empty-safe so a page
 *  built without a token still parses; the server never renders it that way. */
function csrfField(csrf) {
  return csrf ? `<input type="hidden" name="csrf" value="${h(csrf)}">` : '';
}

export function loginPage({ error = null, email = '', next = '', notice = null, csrf = '' } = {}) {
  const body = `
<main>
  <section class="panel">
    <p class="eyebrow">Sign in</p>
    <h1 class="headline">Welcome back</h1>
    <p class="sub">Your tapes are on the shelf where you left them.</p>

    ${notice ? `<p class="notice">${h(notice)}</p>` : ''}
    ${error ? `<p class="alert" role="alert">${h(error)}</p>` : ''}

    <form method="post" action="/auth/google">
      ${nextField(next)}
      ${csrfField(csrf)}
      <button type="submit" class="record">Sign in with Google</button>
    </form>

    <p class="hint">or sign in with a password</p>

    <form method="post" action="/login">
      ${nextField(next)}
      ${csrfField(csrf)}
      ${field({ id: 'email', name: 'email', label: 'Email', type: 'email', value: email, autocomplete: 'username' })}
      ${field({ id: 'password', name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' })}
      <button type="submit" class="record">Sign in</button>
    </form>

    <p class="actions">
      <a class="quiet" href="/auth/reset">Forgot password?</a>
      <a class="quiet" href="/signup">No account yet? Create one.</a>
    </p>
  </section>
</main>
`;
  return layout({ title: 'Timestamp - sign in', body, bodyClass: 'page-login', wrapClass: 'wrap--narrow', chrome: false });
}

export function signupPage({ error = null, email = '', next = '', consentText = '', csrf = '' } = {}) {
  const body = `
<main>
  <section class="panel">
    <p class="eyebrow">Create an account</p>
    <h1 class="headline">Start a shelf</h1>
    <p class="sub">A free credit allowance to start, granted once when the account
    opens. No card, and nowhere on this site to type one.</p>

    ${error ? `<p class="alert" role="alert">${h(error)}</p>` : ''}

    <form method="post" action="/auth/google">
      ${nextField(next)}
      ${csrfField(csrf)}
      <button type="submit" class="record">Sign in with Google</button>
    </form>

    <p class="hint">or create an account with a password</p>

    <form method="post" action="/signup">
      ${nextField(next)}
      ${csrfField(csrf)}
      ${field({ id: 'email', name: 'email', label: 'Email', type: 'email', value: email, autocomplete: 'username' })}
      ${field({
    id: 'password',
    name: 'password',
    label: 'Password',
    type: 'password',
    autocomplete: 'new-password',
    hint: 'At least ten characters. Sent over HTTPS to our identity provider to verify; this server never stores your password or a hash of it.',
  })}

      <label class="check">
        <input type="checkbox" id="consent" name="consent" value="yes" required>
        <span class="consent-text">${
  String(consentText).split('\n').map((para) => `<span>${h(para)}</span>`).join('')
}</span>
      </label>

      <button type="submit" class="record">Create the account</button>
    </form>

    <p class="actions"><a class="quiet" href="/login">Already have one? Sign in.</a></p>
  </section>
</main>
`;
  return layout({ title: 'Timestamp - create an account', body, bodyClass: 'page-signup', wrapClass: 'wrap--narrow', chrome: false });
}

/**
 * `/verify` -- where a mailbox is proved with a six-digit code.
 *
 * WHY THE ADDRESS IS ON THE PAGE. The code went to a mailbox and the person
 * has to know which one, because the commonest reason this flow strands
 * somebody is a typo they cannot see. It arrives as a query parameter and is
 * escaped like everything else; the parameter is not a credential and holding
 * the URL proves nothing, which is the whole reason this page is reachable
 * without a session.
 *
 * WHY THE FIELD CARRIES `inputmode`, `autocomplete` AND `maxlength`.
 * `inputmode="numeric"` is a numeric keypad on a phone rather than a full
 * keyboard; `autocomplete="one-time-code"` is what lets iOS and Android offer
 * the code straight off the notification, which is the difference between
 * typing six digits and switching apps to read them; `maxlength="6"` stops a
 * paste with a trailing space or a stray digit from being sent as a wrong
 * answer that spends one of five. `pattern` and `required` keep an empty
 * submit from costing an attempt at all.
 *
 * WHY THE RESEND CONTROL STATES THE RULE INSTEAD OF FAILING SILENTLY. Supabase
 * permits one code request per address per sixty seconds and a code lasts an
 * hour. A button that quietly does nothing for a minute is indistinguishable
 * from a broken button, and the person's next move is to click it eight more
 * times. The rule is stated so the wait reads as the rule rather than as a
 * fault. It also says the password is not needed: `/verify/resend` asks
 * Supabase directly and returns to this page, and somebody already waiting on
 * a code needs to know the button does not mean starting over.
 */
/**
 * Shown on `/verify` when this server's own mail delivery has failed recently,
 * FOR EVERY VISITOR AND EVERY ADDRESS -- see `test/web-auth-mailer-down.test.js`
 * for why it cannot be scoped to the address that caused it without turning the
 * signup form into the membership oracle spec §4.4 exists to prevent.
 *
 * It names no address and admits no fact about one. It says our mailer is
 * broken, which is ours to own, and it replaces a sentence that would otherwise
 * send the reader to search a spam folder for a message that was never sent.
 */
export const MAILER_DOWN_MESSAGE = 'Email is not being delivered right now. '
  + 'That is a fault on our side, not a problem with your address. '
  + 'Please try again in a few minutes.';

export function verifyPage({ email = '', error = null, notice = null, csrf = '', mailerDown = false } = {}) {
  const body = `
<main>
  <section class="panel">
    <p class="eyebrow">Check your email</p>
    <h1 class="headline">Type the six digits</h1>
    <p class="sub">${mailerDown
      ? `We could not send a code to <strong>${h(email)}</strong> just now.`
      : `We sent a six-digit code to <strong>${h(email)}</strong>. It lasts an hour.`}
    Nobody is signed in until it is typed.</p>

    ${mailerDown ? `<p class="alert" role="alert">${h(MAILER_DOWN_MESSAGE)}</p>` : ''}
    ${notice ? `<p class="notice">${h(notice)}</p>` : ''}
    ${error ? `<p class="alert" role="alert">${h(error)}</p>` : ''}

    <form method="post" action="/verify">
      ${csrfField(csrf)}
      <input type="hidden" name="email" value="${h(email)}">
      <div class="field">
        <label for="code">Confirmation code</label>
        <input type="text" id="code" name="code" value=""
               inputmode="numeric" autocomplete="one-time-code" maxlength="6"
               pattern="[0-9]{6}" spellcheck="false" required>
      </div>
      <button type="submit" class="record">Confirm</button>
    </form>

    <form method="post" action="/verify/resend">
      ${csrfField(csrf)}
      <input type="hidden" name="email" value="${h(email)}">
      <p class="hint">No code? One can be sent per address every 60 seconds. Your password
      is not needed and you will stay on this page.</p>
      <button type="submit" class="quiet">Send a new code</button>
    </form>

    <p class="actions"><a class="quiet" href="/login">Already confirmed? Sign in.</a></p>
  </section>
</main>
`;
  return layout({ title: 'Timestamp - confirm your email', body, bodyClass: 'page-verify', wrapClass: 'wrap--narrow', chrome: false });
}

/**
 * `/auth/reset` -- "forgot password?", start of spec §5's recovery half.
 *
 * WHY THIS PAGE NEVER SAYS WHETHER THE ADDRESS HAS AN ACCOUNT. The server
 * answers this form identically whatever was typed -- `sendRecovery` always
 * resolves `{ok: true}` -- so the copy here is written to be true either way:
 * "if that address has an account" rather than "we have sent your code".
 *
 * WHY THERE IS NO `next` FIELD. Unlike `/login` and `/signup`, this flow does
 * not end at a destination the person was trying to reach -- it ends at
 * `/login`, because a completed reset signs every device out and the honest
 * next step is signing in again with the new password.
 */
export function resetPage({ error = null, email = '', csrf = '' } = {}) {
  const body = `
<main>
  <section class="panel">
    <p class="eyebrow">Forgot password</p>
    <h1 class="headline">Get back in</h1>
    <p class="sub">Enter the address you signed up with. If it has an account, a six-digit
    code — the same kind used to confirm a new signup — is on its way.</p>

    ${error ? `<p class="alert" role="alert">${h(error)}</p>` : ''}

    <form method="post" action="/auth/reset">
      ${csrfField(csrf)}
      ${field({ id: 'email', name: 'email', label: 'Email', type: 'email', value: email, autocomplete: 'username' })}
      <button type="submit" class="record">Send a reset code</button>
    </form>

    <p class="actions"><a class="quiet" href="/login">Remembered it? Sign in.</a></p>
  </section>
</main>
`;
  return layout({ title: 'Timestamp - reset your password', body, bodyClass: 'page-reset', wrapClass: 'wrap--narrow', chrome: false });
}

/**
 * `/auth/reset/complete` -- the code, and the new password, in one form.
 *
 * WHY THE EMAIL IS TYPED HERE RATHER THAN CARRIED FROM `/auth/reset`. That
 * route's redirect target must be identical for a known and an unknown
 * address -- spec §5's whole point -- so it cannot carry the address in the
 * query the way `/verify`'s does. The person types it again, exactly as they
 * typed the password itself; this page never learns which addresses exist.
 *
 * WHY THE CODE FIELD MATCHES `/verify`'s, ATTRIBUTE FOR ATTRIBUTE. Same
 * six-digit shape, same reasons: `inputmode="numeric"` for a numeric keypad,
 * `autocomplete="one-time-code"` for the notification-to-field shortcut,
 * `maxlength="6"` so a stray paste cannot spend a guess on noise.
 */
export function resetCompletePage({ email = '', error = null, csrf = '' } = {}) {
  const body = `
<main>
  <section class="panel">
    <p class="eyebrow">Check your email</p>
    <h1 class="headline">Set a new password</h1>
    <p class="sub">If that address has an account, a six-digit code is on its way. It lasts
    an hour. Completing this signs every device out, including this one.</p>

    ${error ? `<p class="alert" role="alert">${h(error)}</p>` : ''}

    <form method="post" action="/auth/reset/complete">
      ${csrfField(csrf)}
      ${field({ id: 'email', name: 'email', label: 'Email', type: 'email', value: email, autocomplete: 'username' })}
      <div class="field">
        <label for="code">Confirmation code</label>
        <input type="text" id="code" name="code" value=""
               inputmode="numeric" autocomplete="one-time-code" maxlength="6"
               pattern="[0-9]{6}" spellcheck="false" required>
      </div>
      ${field({
    id: 'password',
    name: 'password',
    label: 'New password',
    type: 'password',
    autocomplete: 'new-password',
    hint: 'At least ten characters. Sent over HTTPS to our identity provider to verify; this server never stores your password or a hash of it.',
  })}
      <button type="submit" class="record">Set the new password</button>
    </form>

    <p class="actions"><a class="quiet" href="/auth/reset">No code yet? Ask for one.</a></p>
  </section>
</main>
`;
  return layout({ title: 'Timestamp - set a new password', body, bodyClass: 'page-reset-complete', wrapClass: 'wrap--narrow', chrome: false });
}

/**
 * `/onboarding` -- where a new account first lands, whichever door it came
 * through. Deliberately a stub: the design spec's §10 records that what this
 * page should actually DO -- collect a name, explain the free tape, show the
 * first upload -- is a product question nobody has answered yet, and
 * inventing an answer here would be inventing scope. What is here is true and
 * minimal: the account exists, a free tape is waiting on it, and the way to
 * the first upload is one link away.
 *
 * THE ONE THING THIS PAGE IS NOT ALLOWED TO SKIP. A code confirmed with
 * nothing parked -- the parked consent has a 24-hour TTL, and a person who
 * types the six digits after it has expired reaches `resolveIdentity` with
 * `consent: null` -- opens an account with no record of the agreement, and
 * the handler that does it logs a warning and proceeds anyway, correctly,
 * because refusing at that point would strand somebody who has already
 * proved their mailbox. Nothing else in this codebase ever asks again. So
 * this page checks `account.consent == null` and, when it is, renders the
 * same wording the signup page showed instead of the ordinary content --
 * not a second copy of it, the same `consentText` the server already builds
 * from `scripts/safety/consent.mjs`. An account that already has a consent
 * record never sees this branch; re-asking somebody who already agreed would
 * be asking a person to agree to a photo they have not even uploaded yet.
 */
export function onboardingPage({ account = null, consentText = '', csrf = '', error = null } = {}) {
  const body = `
<main>
  <section class="panel">
    <p class="eyebrow">One more thing</p>
    <h1 class="headline">Confirm before you continue</h1>
    <p class="sub">Your account is open, but this service still needs the same agreement
    everyone gives before their first photo -- and yours was not on file.</p>

    ${error ? `<p class="alert" role="alert">${h(error)}</p>` : ''}

    <form method="post" action="/onboarding">
      ${csrfField(csrf)}
      <label class="check">
        <input type="checkbox" id="consent" name="consent" value="yes" required>
        <span class="consent-text">${
  String(consentText).split('\n').map((para) => `<span>${h(para)}</span>`).join('')
}</span>
      </label>
      <button type="submit" class="record">Agree and continue</button>
    </form>
  </section>
</main>
`;

  return layout({
    title: 'Timestamp - onboarding',
    body,
    bodyClass: 'page-onboarding',
    wrapClass: 'wrap--narrow',
    account,
  });
}

/**
 * `/account` -- the page where a person reads what this service holds about
 * them, takes a copy, or ends the whole thing. Deletion spec §3.
 *
 * THE DELETION FORM DEMANDS THE ADDRESS TYPED BACK. A checkbox is a click; a
 * click happens by accident, and this door only opens one way. The server
 * compares the typed value against the session account's own email, so the
 * form works with no JavaScript -- the same rule as the contact sheet, and for
 * the same reason: the screens with a human decision on them are the ones that
 * must not need a script.
 *
 * WHAT THE COPY PROMISES IS EXACTLY WHAT `deleteAccountEverywhere` PERFORMS:
 * photo, tapes, credit history, sign-in -- gone together; nothing about
 * payment records, because those live at Stripe under Stripe's own legal
 * basis and pretending otherwise would be a promise this code cannot keep.
 */
export function accountPage({ account, balance = null, csrf = '', error = null } = {}) {
  const body = `
<main>
  <section class="panel">
    <p class="eyebrow">Your account</p>
    <h1 class="headline">${h(account?.email ?? '')}</h1>
    <p class="sub">${balance ? `${h(String(balance.credits))} credits on the ${h(String(balance.planId ?? account?.plan ?? ''))} plan.` : ''}</p>

    ${error ? `<p class="alert" role="alert">${h(error)}</p>` : ''}

    <h2 class="subhead">Your data</h2>
    <p class="sub">One JSON document: your account record, your credit history, and the
    order details of every tape on your shelf. The tapes themselves are on the shelf --
    download any of them there.</p>
    <p><a class="button" href="/api/account/export" download>Export your data</a></p>

    <h2 class="subhead">Delete this account</h2>
    <p class="sub">Your photo, your tapes, your credit history and your sign-in are deleted
    together, immediately, everywhere this service keeps them. There is no undo and nothing
    to restore from. If a tape is still rendering, cancel it first.</p>

    <form method="post" action="/account/delete">
      ${csrfField(csrf)}
      ${field({
    id: 'confirm', name: 'confirm', label: 'Type your email address to confirm',
    type: 'email', autocomplete: 'off', required: true,
  })}
      <button type="submit" class="record record--danger">Delete my account</button>
    </form>
  </section>
</main>
`;

  return layout({
    title: 'Timestamp - your account',
    body,
    bodyClass: 'page-account',
    wrapClass: 'wrap--narrow',
    account,
    balance,
  });
}

/**
 * Shown when this build has no Supabase configuration.
 *
 * SEPARATE FROM `authUnavailablePage` BECAUSE THE CAUSE IS DIFFERENT AND SO IS
 * THE FIX. That one means `scripts/auth/` is not on disk; this one means the
 * three `SUPABASE_*` values are not in the environment, and the app is
 * otherwise perfectly healthy -- the shelf, the stylesheet and the plans all
 * still serve. One sentence, and the name of the thing that is missing, so
 * whoever hits it is not reading server logs for an afternoon.
 */
export function identityUnavailablePage() {
  const body = `
<main>
  <section class="panel">
    <p class="eyebrow">503</p>
    <h1 class="headline">Sign-in is not available right now</h1>
    <p class="sub">This build has no identity provider configured, so there is nothing to
    confirm a code or a password against. An operator sets <code>SUPABASE_URL</code>,
    <code>SUPABASE_PUBLISHABLE_KEY</code> and <code>SUPABASE_SECRET_KEY</code>; everything
    else on the site keeps working.</p>
  </section>
</main>
`;
  return layout({ title: 'Timestamp - 503', body, bodyClass: 'page-error', chrome: false });
}

/**
 * `/pricing`. Public, so it renders for a signed-out visitor too; `currentPlan`
 * is simply null for them and nothing is marked.
 *
 * ONE LADDER, NOT TWO. Until 2026-08-27 this page rendered two competing price
 * lists: three subscription plans that could not be bought, above a separate
 * one-off pack that could. They collided -- `$10` appeared twice on the page
 * meaning two different products -- and the only thing carrying a Buy button
 * was the one nobody had come to read about. Now every card on the page is a
 * rung of the same ladder: the free grant first, then the bundles, cheapest to
 * dearest, each one buyable.
 *
 * WHY A RUNG IS DESCRIBED IN CREDITS AND THEN TRANSLATED INTO TAPES. "N tapes"
 * stopped being true the moment a tape had two prices: a 720p tape costs 2.19x
 * a 480p one, so the same pool is four tapes or two depending on a choice made
 * after the money is spent. Credits are the honest unit, and the translation is
 * shown underneath rather than instead, because "92 CR" on its own tells a
 * first-time reader nothing.
 *
 * THE TWO TAPE COUNTS ARE NOT INDEPENDENTLY SETTABLE, which is the thing most
 * likely to be forgotten by whoever next edits `config/credits.json`. Both are
 * floored off ONE pool, so a rung that funds two 720p tapes necessarily funds
 * four 480p tapes -- "three at 480p and two at 720p" is not a rung anyone can
 * write, at any price. Move the credits and both numbers move together.
 *
 * @param {{plans: Array<{id,label,monthlyUSD,annualUSD,creditsPerPeriod}>,
 *          resolutions: Array<{id,credits,available}>,
 *          packs: Array<{id,label,priceUSD,credits,buyable}>,
 *          retentionDays?: number|null,
 *          currentPlan?: string|null}} data
 */
export function pricingPage({
  plans = [], resolutions = [], packs = [], currentPlan = null, account = null,
  balance = null, checkout = null, retentionDays = null,
} = {}) {
  const offered = resolutions.filter((r) => r.available && r.credits > 0);

  /**
   * What one pool of credits buys, per size that is actually on sale.
   *
   * "0 tapes at 720p" is arithmetically right and reads like a bug, so a rung
   * that cannot fund one says so in words. Singular and plural are spelled out
   * for the same reason: "1 tapes" is the sort of thing a reader notices
   * instead of the number.
   */
  const tapeLines = (credits) => offered.map((r) => {
    // THE SHAPE IS PART OF THE PRICE AND THIS COUNTED AT ONE SHAPE'S. `credits`
    // is the un-shaped figure, i.e. the 4:3 one. A non-default shape holds the
    // short edge and is exactly 4/3 the pixels, so it is charged 4/3 -- 28 CR
    // at 480p against 21, 61 at 720p against 46. The same 92 credits buy three
    // 480p tapes in 16:9 or 9:16 and not four, and the free rung buys none at
    // all in the phone shape it is most likely to be wanted for.
    //
    // A PARENTHETICAL RATHER THAN A RANGE, because this page is public and has
    // no frame picker: unlike the tape form it cannot switch a number to match
    // a selection, since nothing is selected. "3-4 tapes" would be honest and
    // would also make the reader work out which is which.
    const base = r.creditsByAspect?.['4:3'] ?? r.credits;
    const n = Math.floor(credits / base);
    const line = n === 0
      ? `not enough for a ${r.id} tape`
      : `${n} ${n === 1 ? 'tape' : 'tapes'} at ${r.id}`;

    // Both wide shapes cost the same 4/3, but the number is READ rather than
    // assumed: a shape the pricing refuses has no entry, and a shape priced
    // differently one day would be reported as it is rather than as 4/3.
    const wide = ['16:9', '9:16']
      .map((a) => r.creditsByAspect?.[a])
      .filter((c) => Number.isFinite(c) && c > 0);
    const suffix = wide.length && n > 0
      ? ` (${(() => {
        const m = Math.floor(credits / Math.max(...wide));
        return m === 0 ? 'none' : String(m);
      })()} in 16:9 or 9:16)`
      : '';
    return `<li>${h(line + suffix)}</li>`;
  }).join('');

  /**
   * HOW LONG A TAPE ACTUALLY SURVIVES, read from the retention config rather
   * than asserted here.
   *
   * Every card on this page used to say "Every tape stays on your shelf". That
   * was FALSE the whole time it was shipped: `config/render.json` sets
   * `retention.jobDays` to 30 and `scripts/render/purge-cli.mjs` deletes the
   * video when it expires. A promise the purge contradicts is the one kind of
   * copy this page must never carry, because the person reading it is deciding
   * whether to pay on the strength of it. It is threaded in rather than written
   * here so that changing the window is one edit to `config/render.json`.
   */
  const shelfLine = Number.isFinite(retentionDays) && retentionDays > 0
    ? `Kept on your shelf for ${retentionDays} days`
    : null;

  /**
   * THE LADDER, IN ORDER. The grant is first because it is where a reader
   * starts, not because it is a product -- it has no price and no button, and
   * `plans` holds exactly one row since the stale subscription tiers were
   * deleted on 2026-08-27.
   */
  const rungs = [
    ...plans.map((plan) => ({
      id: plan.id,
      label: plan.label,
      priceUSD: plan.monthlyUSD,
      credits: plan.creditsPerPeriod,
      grant: true,
      buyable: false,
      current: plan.id === currentPlan,
    })),
    ...packs.map((pack) => ({
      id: pack.id,
      label: pack.label,
      priceUSD: pack.priceUSD,
      credits: pack.credits,
      grant: false,
      buyable: pack.buyable,
      current: false,
    })),
  ];

  const cards = rungs.map((rung) => {
    /**
     * THE BROWSER SENDS A RUNG ID AND NOTHING ELSE -- no amount, no credit
     * count, no price. A tampered form has nothing to tamper with, and
     * test/web-auth.test.js asserts exactly this: one input, hidden, named
     * `pack`. Adding a second field to this form fails that test, which is what
     * the test is for.
     */
    const buy = rung.grant ? '' : `
      <form method="post" action="/api/billing/checkout">
        <input type="hidden" name="pack" value="${h(rung.id)}">
        <label class="check check--buy">
          <input type="checkbox" name="withdrawal" value="yes" required>
          <span class="consent-text"><span>I want my credits straight away. I understand they are
          added to my account the moment I pay, and that I cannot then cancel them for a
          refund.</span></span>
        </label>
        <button type="submit" class="record"${rung.buyable ? '' : ' disabled'}>
          ${h(rung.buyable ? `Buy ${rung.label}` : 'Not open yet')}
        </button>
      </form>
      ${rung.buyable ? '' : '<p class="hint">Checkout opens once the price is set. Nothing is charged here.</p>'}`;

    return `
    <section class="panel plan${rung.current ? ' plan--current' : ''}">
      ${rung.current ? '<span class="mark">Your plan</span>' : ''}
      <p class="eyebrow">${h(rung.label)}</p>
      <p class="price">${h(rung.priceUSD === 0 ? 'FREE' : `$${rung.priceUSD}`)}</p>
      <p class="per">${h(rung.grant ? 'on sign-up' : 'one payment')}</p>
      <ul>
        <li>${h(`${rung.credits} credits`)}</li>
        ${tapeLines(rung.credits)}
        <li>15 seconds, 25 fps, in 4:3, 16:9 or 9:16</li>
        ${shelfLine ? `<li>${h(shelfLine)}</li>` : ''}
      </ul>
      ${buy}
    </section>`;
  }).join('');

  // A RANGE HERE, a parenthetical in the rungs, and for a reason. This line is
  // a summary of what sizes cost; the rungs are a count of what a reader gets,
  // and a range there would leave them working out which end applies to them.
  // Both ends are read from the same map the charge is computed from, so a
  // shape priced differently one day widens this by itself.
  const costs = offered.map((r) => {
    const quotes = Object.values(r.creditsByAspect ?? {}).filter((c) => Number.isFinite(c) && c > 0);
    const low = quotes.length ? Math.min(...quotes) : r.credits;
    const high = quotes.length ? Math.max(...quotes) : r.credits;
    return h(low === high ? `${r.id} — ~${low} CR` : `${r.id} — ~${low}-${high} CR`);
  }).join(' &middot; ');

  /**
   * Coming back from Stripe.
   *
   * ANYBODY CAN VISIT EITHER OF THESE. The wording is chosen on that basis: it
   * thanks, and it does not assert that a balance has moved, because this page
   * has no way to know and the webhook that does may not have arrived yet.
   * Saying "your credits are ready" here would be a claim the server cannot
   * back, on a url a stranger can type.
   *
   * `Object.hasOwn` IS THE LOAD-BEARING PART, not the `?? null` beside it.
   * `checkout` is a query parameter, so a stranger picks the key; a bare
   * lookup finds `constructor`, `toString`, `valueOf` and `hasOwnProperty` on
   * the prototype and renders their source into the notice element. `?? null`
   * cannot catch that, because a function is not nullish. `null` prototype
   * would work too and reads as a trick; this says what it means.
   */
  const RETURNED = Object.freeze({
    done: 'Thank you. Your credits will appear on your balance shortly, once the payment clears.',
    cancelled: 'Nothing was charged. The bundle is still here whenever you want it.',
  });
  const key = String(checkout ?? '');
  const returned = Object.hasOwn(RETURNED, key) ? RETURNED[key] : null;

  const body = `
<main>
  <section class="panel">
    <p class="eyebrow">Credits</p>
    <h1 class="headline">What a tape costs</h1>
    <p class="sub">A tape is fifteen seconds of generated video put through the tape deck.
    You spend credits, and how many depends on the size the video is generated at before
    the tape gets hold of it, and on the frame you choose.</p>
    <p class="hint">${costs || 'Costs are unavailable right now.'}</p>
    ${/* THE LISTED PRICE IS BEFORE TAX, AND THE PAGE HAS TO SAY SO (2026-08-31).
         Measured in the Stripe dashboard rather than assumed: a $12 pack shows a
         German buyer a $14.28 total, VAT added on top and remitted for us.
         It is stated here rather than folded into the price because this is sold
         worldwide and the rate follows the BUYER -- 19% in Germany, nothing in
         much of the world. There is no single final price that would be true for
         everyone, so a number printed here would be a lie somewhere. */''}
    <p class="hint">Prices are before tax. VAT or sales tax is added at checkout where it
    applies, at the rate for the country you are in, and the total is shown to you before
    you pay.</p>
    <p class="hint">There is no payment form here and there is not one anywhere else either.
    Checkout is hosted by the payment provider on their own domain, and this application
    never sees a card number.</p>
    ${returned ? `<p class="notice">${h(returned)}</p>` : ''}
  </section>

  <div class="plans">${cards}</div>

  <section class="panel">
    <p class="hint">Nothing here renews and nothing is a subscription. Credits do not expire,
    and when you want more tapes you buy another bundle — including a second one the same
    size. Every figure on this page is an estimate of provider cost until a metered run
    proves it, and it will be revisited when one does.</p>
    <p class="actions"><a class="quiet" href="/">Back to the shelf</a></p>
  </section>
</main>
`;
  return layout({ title: 'Timestamp - plans', body, bodyClass: 'page-pricing', account, balance });
}

/**
 * Shown when `scripts/auth/` is not on disk yet.
 *
 * A blank 500 would send whoever hits it into the server logs looking for a bug
 * in the web layer. Naming the missing module and the file that specifies it is
 * the difference between a five-minute answer and an afternoon.
 */
export function authUnavailablePage() {
  const body = `
<main>
  <section class="panel">
    <p class="eyebrow">503</p>
    <h1 class="headline">Accounts are not wired up yet</h1>
    <p class="sub">This build has no <code>scripts/auth/</code> module, so there is nothing to
    sign in to. It is specified in <code>docs/interfaces-app.md</code> section A.</p>
  </section>
</main>
`;
  return layout({ title: 'Timestamp - 503', body, bodyClass: 'page-error', chrome: false });
}
