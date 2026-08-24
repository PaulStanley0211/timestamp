/**
 * Sign in, create an account, and the plans.
 *
 * WHY THERE IS NO PAYMENT FORM ON THIS PAGE, AND WHY THAT IS NOT AN OMISSION.
 * `docs/interfaces-app.md` §A: nothing in this product may touch a card number,
 * a CVV or a bank detail, and the pricing page describes plans and links to a
 * hosted checkout that does not exist yet. A "mockup" card field is the same
 * risk as a real one -- it is a text input on a public page asking for a card
 * number, and whether the bytes are stored is a detail the person typing them
 * cannot see. So: three panels of prose, the current plan marked, and a link.
 * If you are reading this because you were about to add a `<input name="cvv">`,
 * the answer is a hosted checkout redirect, not a field.
 *
 * WHY THESE FORMS CARRY NO CSRF TOKEN. The session cookie is `SameSite=Lax`, so
 * a cross-site form post arrives without it and lands as "not signed in" rather
 * than as an action taken on somebody's behalf. That covers every state-changing
 * POST here. A token would be the right answer if the cookie were `SameSite=None`
 * -- it is not, and `session-middleware.mjs` says why.
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

export function loginPage({ error = null, email = '', next = '', notice = null } = {}) {
  const body = `
<main>
  <section class="panel">
    <p class="eyebrow">Sign in</p>
    <h1 class="headline">Welcome back</h1>
    <p class="sub">Your tapes are on the shelf where you left them.</p>

    ${notice ? `<p class="notice">${h(notice)}</p>` : ''}
    ${error ? `<p class="alert" role="alert">${h(error)}</p>` : ''}

    <form method="post" action="/login">
      ${nextField(next)}
      ${field({ id: 'email', name: 'email', label: 'Email', type: 'email', value: email, autocomplete: 'username' })}
      ${field({ id: 'password', name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' })}
      <button type="submit" class="record">Sign in</button>
    </form>

    <p class="actions"><a class="quiet" href="/signup">No account yet? Create one.</a></p>
  </section>
</main>
`;
  return layout({ title: 'Timestamp - sign in', body, bodyClass: 'page-login', wrapClass: 'wrap--narrow', chrome: false });
}

export function signupPage({ error = null, email = '', next = '', consentText = '' } = {}) {
  const body = `
<main>
  <section class="panel">
    <p class="eyebrow">Create an account</p>
    <h1 class="headline">Start a shelf</h1>
    <p class="sub">A free credit allowance every month. No card, and nowhere on this
    site to type one.</p>

    ${error ? `<p class="alert" role="alert">${h(error)}</p>` : ''}

    <form method="post" action="/signup">
      ${nextField(next)}
      ${field({ id: 'email', name: 'email', label: 'Email', type: 'email', value: email, autocomplete: 'username' })}
      ${field({
    id: 'password',
    name: 'password',
    label: 'Password',
    type: 'password',
    autocomplete: 'new-password',
    hint: 'At least ten characters. Stored as a scrypt hash and never in plain text.',
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
 * `/pricing`. Public, so it renders for a signed-out visitor too; `currentPlan`
 * is simply null for them and nothing is marked.
 *
 * WHY A PLAN IS DESCRIBED IN CREDITS AND THEN TRANSLATED INTO TAPES. "N tapes a
 * month" stopped being true the moment a tape had two prices: a 720p tape costs
 * 2.25x a 480p one, so the same allowance is three tapes or one depending on a
 * choice made after the plan was bought. Credits are the honest unit, and the
 * translation is shown underneath rather than instead, because "204 CR" on its
 * own tells a first-time reader nothing.
 *
 * @param {{plans: Array<{id,label,monthlyUSD,annualUSD,creditsPerPeriod}>,
 *          resolutions: Array<{id,credits,available}>,
 *          currentPlan?: string|null}} data
 */
export function pricingPage({
  plans = [], resolutions = [], currentPlan = null, account = null, balance = null,
} = {}) {
  const offered = resolutions.filter((r) => r.available && r.credits > 0);

  const cards = plans.map((plan) => {
    const current = plan.id === currentPlan;
    // "0 tapes at 720p" is arithmetically right and reads like a bug, so a plan
    // that cannot fund one says so in words. Singular and plural are spelled out
    // for the same reason: "1 tapes" is the sort of thing a reader notices
    // instead of the number.
    const tapes = offered.map((r) => {
      const n = Math.floor(plan.creditsPerPeriod / r.credits);
      const line = n === 0
        ? `not enough for a ${r.id} tape`
        : `${n} ${n === 1 ? 'tape' : 'tapes'} at ${r.id}`;
      return `<li>${h(line)}</li>`;
    }).join('');
    return `
    <section class="panel plan${current ? ' plan--current' : ''}">
      ${current ? '<span class="mark">Your plan</span>' : ''}
      <p class="eyebrow">${h(plan.label)}</p>
      <p class="price">${h(plan.monthlyUSD === 0 ? 'FREE' : `$${plan.monthlyUSD}`)}</p>
      <p class="per">${h(plan.monthlyUSD === 0 ? 'forever' : 'per month')}</p>
      <ul>
        <li>${h(`${plan.creditsPerPeriod} credits a month`)}</li>
        ${tapes}
        <li>15 seconds, 4:3, PAL, 25 fps</li>
        <li>Every tape stays on your shelf</li>
      </ul>
    </section>`;
  }).join('');

  const costs = offered.map((r) => h(`${r.id} — ~${r.credits} CR`)).join(' &middot; ');

  const body = `
<main>
  <section class="panel">
    <p class="eyebrow">Plans</p>
    <h1 class="headline">What a tape costs</h1>
    <p class="sub">A tape is fifteen seconds of generated video put through the tape deck.
    You spend credits, and how many depends on the size the video is generated at before
    the tape gets hold of it.</p>
    <p class="hint">${costs || 'Costs are unavailable right now.'}</p>
    <p class="hint">There is no payment form here and there is not one anywhere else either.
    When paid plans open, checkout is hosted by the payment provider and this application
    never sees a card number. To change a plan today, write to us.</p>
  </section>

  <div class="plans">${cards}</div>

  <section class="panel">
    <p class="hint">Every figure on this page is an estimate of provider cost until a metered
    run proves it, and it will be revisited when one does. Nothing renews automatically,
    because nothing is charged yet. Credits do not expire.</p>
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
