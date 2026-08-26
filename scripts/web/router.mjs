/**
 * The route table, and nothing else.
 *
 * WHY THIS FILE HAS NO `node:http` IMPORT. Routing is the part of a web layer
 * with the most branches and the least excuse for needing a socket to check.
 * Keeping the table and the matcher pure means every claim about this app's
 * surface -- which paths exist, which methods they answer, what a bad id does
 * before it reaches the filesystem -- is a function call in a test rather than
 * a request against a server that has to be started, torn down and port-raced.
 * `test/web-router.test.js` opens no listener at all.
 *
 * WHY THE PATH IS DECODED BEFORE IT IS MATCHED, AND THEN REFUSED. A traversal
 * attempt does not arrive as `/api/jobs/../../etc/passwd`; it arrives as
 * `/api/jobs/%2e%2e%2f%2e%2e%2fetc%2fpasswd`, and a matcher that splits on `/`
 * before decoding sees one tidy segment and hands it on as a job id. So the
 * order here is: split, decode each segment, and *then* refuse `.`, `..`, any
 * separator and any control byte -- with a 400, which is honest, rather than a
 * 404, which invites the next guess. This is belt; the braces are that every
 * handler validates `:id` against `JOB_ID_RE` again before touching disk. Two
 * checks, because the cost of the second one is a regex and the cost of missing
 * the first one is arbitrary file read.
 *
 * WHY 405 IS A DISTINCT ANSWER. `POST /api/jobs/:id` returning 404 tells a
 * caller the job does not exist, which is a lie that costs somebody an
 * afternoon. If the path is known and only the method is wrong, say so and list
 * what would have worked.
 */

/** The one canonical shape of a job id, mirrored from `render/job.mjs` at the
 *  point of use rather than copied here -- see `server.mjs`. The router itself
 *  is deliberately id-agnostic: it refuses path *shapes*, not id *contents*. */

export class RouteError extends Error {
  constructor(message, { status = 400, code = 'BAD_REQUEST' } = {}) {
    super(message);
    this.name = 'RouteError';
    this.status = status;
    this.code = code;
  }
}

/**
 * method + pattern -> a handler name. Names, not functions, so that this table
 * stays a piece of data: a test can assert the whole surface of the app by
 * reading it, and `server.mjs` supplies the implementations.
 *
 * Order matters only in that a literal segment beats a parameter; `match` walks
 * the list and the literal routes are written first where the two could collide.
 */
export const ROUTES = Object.freeze([
  // --- pages -------------------------------------------------------------
  { method: 'GET', pattern: '/', name: 'homePage' },
  { method: 'GET', pattern: '/styles.css', name: 'stylesheet' },
  { method: 'GET', pattern: '/tape-osd.ttf', name: 'font' },
  { method: 'GET', pattern: '/favicon.ico', name: 'favicon' },

  // --- accounts (docs/interfaces-app.md B) --------------------------------
  // The GET and the POST of each form are separate rows rather than one row
  // with two methods, because a 405 has to be able to say which verbs a path
  // answers and a route that carries a set of methods cannot.
  { method: 'GET', pattern: '/login', name: 'loginPage' },
  { method: 'POST', pattern: '/login', name: 'login' },
  { method: 'GET', pattern: '/signup', name: 'signupPage' },
  { method: 'POST', pattern: '/signup', name: 'signup' },
  // POST, not GET. A logout on GET is a logout anybody can trigger with an
  // <img src>, and `SameSite=Lax` sends the cookie on a cross-site GET.
  { method: 'POST', pattern: '/logout', name: 'logout' },
  { method: 'GET', pattern: '/pricing', name: 'pricingPage' },

  // --- confirming a mailbox with a six-digit code (spec §3, §4.5) ---------
  // NOT behind a session, and deliberately. Signup mints nobody; the account
  // does not exist until the code is typed, so a gate here would be a gate on
  // a session that cannot exist yet. What proves anything on these three
  // routes is possession of the CODE, which is why `/verify` is safe to
  // bookmark and safe to reach after the tab that started it was closed.
  { method: 'GET', pattern: '/verify', name: 'verifyPage' },
  { method: 'POST', pattern: '/verify', name: 'verifyCode' },
  { method: 'POST', pattern: '/verify/resend', name: 'verifyResend' },

  // --- money (docs/superpowers/specs/2026-08-24-credit-packs-pricing-design.md)
  // The browser posts a PACK ID and nothing else. Everything priced is resolved
  // on the server against config/credits.json; there is no route here that
  // accepts an amount, and there must not be one.
  { method: 'POST', pattern: '/api/billing/checkout', name: 'checkout' },
  // NOT authenticated by session -- authenticated by an HMAC over the raw body.
  // Stripe holds no cookie and never will.
  { method: 'POST', pattern: '/api/stripe/webhook', name: 'stripeWebhook' },

  // Place card imagery. `assets/places/<id>.jpg` does not exist yet; a 404 here
  // is the designed state, and the CSS falls through to the gradient layer.
  { method: 'GET', pattern: '/places/:file', name: 'placeImage' },

  { method: 'GET', pattern: '/j/:id', name: 'statusPage' },
  { method: 'GET', pattern: '/j/:id/select', name: 'selectPage' },
  { method: 'GET', pattern: '/j/:id/result', name: 'resultPage' },

  // --- JSON API (docs/interfaces.md §9) ----------------------------------
  { method: 'GET', pattern: '/api/health', name: 'health' },
  { method: 'POST', pattern: '/api/jobs', name: 'createJob' },
  { method: 'GET', pattern: '/api/jobs/:id', name: 'getJob' },
  { method: 'DELETE', pattern: '/api/jobs/:id', name: 'cancelJob' },
  { method: 'GET', pattern: '/api/jobs/:id/stills', name: 'listStills' },
  // Not in the table in §9. `listStills` is specified to return
  // `{stills:[{index,url}]}` and a url has to resolve to something; this is
  // that something. Flagged as an interpretation rather than smuggled in.
  { method: 'GET', pattern: '/api/jobs/:id/stills/:index', name: 'getStill' },
  { method: 'POST', pattern: '/api/jobs/:id/select', name: 'select' },
  { method: 'GET', pattern: '/api/jobs/:id/video', name: 'getVideo' },
  { method: 'GET', pattern: '/api/jobs/:id/poster', name: 'getPoster' },
]);

/**
 * The routes that answer without an account, by name.
 *
 * A DENY-LIST WOULD BE THE WRONG SHAPE. This is an allow-list, so a route added
 * to `ROUTES` without a thought about auth is gated by default -- the failure
 * mode of forgetting is "signed-out users cannot reach it", not "anybody can
 * read anybody's job". `test/web-auth.test.js` asserts that every name in
 * `ROUTES` is either in here or gated, so the list cannot silently fall behind.
 *
 * `health` is public because a load balancer cannot log in. It reports the
 * queue's counts and whether ffmpeg is present, and no job ids.
 */
export const PUBLIC_ROUTES = Object.freeze(new Set([
  'stylesheet', 'font', 'favicon', 'placeImage',
  'loginPage', 'login', 'signupPage', 'signup', 'logout',
  // The code-entry flow. See the comment beside these rows in ROUTES: the
  // account they end in does not exist until they succeed, so requiring a
  // session would make the flow unreachable rather than safe.
  'verifyPage', 'verifyCode', 'verifyResend',
  'pricingPage',
  // PUBLIC SINCE 2026-08-21, AND IT IS THE ONE ENTRY HERE THAT SERVES TWO
  // DIFFERENT PAGES. `/` used to 303 a signed-out visitor to `/login`, which
  // made the entire product a password box: there was nowhere to say what this
  // is and nobody who had not already been told could get past the door.
  //
  // The handler branches on the session. Signed in, it renders the step form
  // and the shelf exactly as before. Signed out, it renders the landing page,
  // which is built from the preset catalog and NOTHING ELSE -- no balance, no
  // shelf, no upload form, no job id. The security property that matters was
  // never "the root path is gated", it was "no account data reaches an
  // anonymous request", and that is now asserted directly in
  // test/web-auth.test.js rather than implied by a redirect.
  'homePage',
  'health',
  // PUBLIC BECAUSE STRIPE CANNOT LOG IN, and gated by something stronger than
  // a session: an HMAC-SHA256 over the exact bytes of the request, keyed by a
  // secret only Stripe and this server hold. A route in this list normally
  // means "anybody may reach it"; here it means "the gate is not the session",
  // and the gate that IS there refuses an unverified request before it can
  // touch a ledger.
  'stripeWebhook',
]));

/** True when this route may be served to somebody with no session. */
export function isPublicRoute(name) {
  return PUBLIC_ROUTES.has(name);
}

/** `HEAD` is `GET` without a body, and node:http will drop the body for us.
 *  Routing it as GET is one line and the alternative is fourteen more rows. */
const METHOD_ALIASES = Object.freeze({ HEAD: 'GET' });

function compile(pattern) {
  if (pattern === '/') return [];
  return pattern.slice(1).split('/').map((segment) => (
    segment.startsWith(':') ? { param: segment.slice(1) } : { literal: segment }
  ));
}

const COMPILED = ROUTES.map((route) => ({ ...route, segments: compile(route.pattern) }));

/**
 * Split a request target into decoded, validated path segments.
 *
 * @returns {{segments: string[], query: URLSearchParams, pathname: string}}
 * @throws {RouteError} 400 for anything that is not a plain, non-traversing path
 */
export function splitPath(target) {
  if (typeof target !== 'string' || !target.startsWith('/')) {
    throw new RouteError('request target must be an absolute path', { code: 'BAD_TARGET' });
  }
  const cut = target.search(/[?#]/);
  const rawPath = cut === -1 ? target : target.slice(0, cut);
  const rawQuery = cut === -1 || target[cut] !== '?' ? '' : target.slice(cut + 1).split('#')[0];

  const segments = [];
  for (const raw of rawPath.split('/')) {
    if (raw === '') continue; // leading slash, and a tolerated trailing one
    let decoded;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      // `%zz`. A malformed escape is not a path we should be guessing at.
      throw new RouteError(`malformed percent-encoding in ${JSON.stringify(raw)}`, { code: 'BAD_ESCAPE' });
    }
    if (decoded === '.' || decoded === '..') {
      throw new RouteError('path traversal is not a path', { code: 'TRAVERSAL' });
    }
    // Post-decode separators are the whole point of decoding first.
    if (/[/\\]/.test(decoded) || [...decoded].some((ch) => ch.codePointAt(0) < 0x20)) {
      throw new RouteError('path segment contains a separator or control character', { code: 'BAD_SEGMENT' });
    }
    segments.push(decoded);
  }

  return {
    segments,
    query: new URLSearchParams(rawQuery),
    pathname: `/${segments.join('/')}`,
  };
}

/**
 * Resolve a request to a route.
 *
 * @param {string} method
 * @param {string} target  `req.url` -- path plus query
 * @returns {{ok: true, name, params, query, pathname, method}
 *          | {ok: false, status: 400|404|405, code, allow?: string[]}}
 */
export function matchRoute(method, target) {
  let parsed;
  try {
    parsed = splitPath(target);
  } catch (err) {
    if (err instanceof RouteError) return { ok: false, status: err.status, code: err.code };
    throw err;
  }

  const wanted = METHOD_ALIASES[String(method).toUpperCase()] ?? String(method).toUpperCase();
  const allow = new Set();
  let matchedPath = false;

  for (const route of COMPILED) {
    if (route.segments.length !== parsed.segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < route.segments.length; i += 1) {
      const seg = route.segments[i];
      if (seg.literal !== undefined) {
        if (seg.literal !== parsed.segments[i]) { ok = false; break; }
      } else {
        params[seg.param] = parsed.segments[i];
      }
    }
    if (!ok) continue;

    matchedPath = true;
    allow.add(route.method);
    if (route.method === wanted) {
      return {
        ok: true,
        name: route.name,
        params,
        query: parsed.query,
        pathname: parsed.pathname,
        method: String(method).toUpperCase(),
      };
    }
  }

  if (matchedPath) {
    // HEAD is always permitted wherever GET is, and OPTIONS is answered by the
    // server itself; both belong in Allow or a conformant client will not try.
    if (allow.has('GET')) allow.add('HEAD');
    allow.add('OPTIONS');
    return { ok: false, status: 405, code: 'METHOD_NOT_ALLOWED', allow: [...allow].sort() };
  }
  return { ok: false, status: 404, code: 'NOT_FOUND' };
}

/** Every method any route answers, for the `OPTIONS *` reply and for tests that
 *  want to assert the surface has not grown by accident. */
export const METHODS = Object.freeze([...new Set(ROUTES.map((r) => r.method))].sort());
