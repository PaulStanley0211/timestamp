/**
 * The route table. No socket, no filesystem, no server -- every assertion here
 * is a function call, which is the whole reason `router.mjs` has no `node:http`
 * import.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROUTES, METHODS, matchRoute, splitPath, RouteError, PUBLIC_ROUTES, isPublicRoute,
} from '../scripts/web/router.mjs';
import { JOB_ID_RE } from '../scripts/render/job.mjs';

const ID = '20260820-144501-a3f19c';

test('every documented route in docs/interfaces.md 9 is in the table', () => {
  const documented = [
    ['POST', '/api/jobs'],
    ['GET', '/api/jobs/:id'],
    ['GET', '/api/jobs/:id/stills'],
    ['POST', '/api/jobs/:id/select'],
    ['GET', '/api/jobs/:id/video'],
    ['GET', '/api/jobs/:id/poster'],
    ['DELETE', '/api/jobs/:id'],
    ['GET', '/api/health'],
    ['GET', '/'],
    ['GET', '/j/:id'],
    ['GET', '/j/:id/select'],
    ['GET', '/j/:id/result'],
  ];
  for (const [method, pattern] of documented) {
    assert.ok(
      ROUTES.some((r) => r.method === method && r.pattern === pattern),
      `${method} ${pattern} is missing from ROUTES`,
    );
  }
});

test('every page in docs/interfaces-app.md B is in the table', () => {
  const documented = [
    ['GET', '/login'], ['POST', '/login'],
    ['GET', '/signup'], ['POST', '/signup'],
    ['POST', '/logout'],
    ['GET', '/pricing'],
    ['GET', '/places/:file'],
  ];
  for (const [method, pattern] of documented) {
    assert.ok(
      ROUTES.some((r) => r.method === method && r.pattern === pattern),
      `${method} ${pattern} is missing from ROUTES`,
    );
  }
});

/**
 * A LOGOUT ON GET IS A LOGOUT ANYBODY CAN TRIGGER WITH AN `<img src>`, and
 * `SameSite=Lax` sends the session cookie on a cross-site GET navigation. So the
 * verb is part of the contract, not a preference.
 */
test('logout is POST only', () => {
  assert.equal(matchRoute('POST', '/logout').name, 'logout');
  const wrong = matchRoute('GET', '/logout');
  assert.equal(wrong.ok, false);
  assert.equal(wrong.status, 405);
});

/**
 * An ALLOW-LIST, so the failure mode of adding a route without thinking about
 * auth is "signed-out users cannot reach it" rather than "anybody can read
 * anybody's job".
 */
test('the public set is an allow-list and every entry is a real route', () => {
  for (const name of PUBLIC_ROUTES) {
    assert.ok(ROUTES.some((r) => r.name === name), `${name} is public but is not a route`);
  }
  for (const name of ['homePage', 'statusPage', 'selectPage', 'resultPage', 'createJob',
    'getJob', 'cancelJob', 'listStills', 'getStill', 'select', 'getVideo', 'getPoster']) {
    assert.ok(ROUTES.some((r) => r.name === name), `${name} is not a route`);
    assert.equal(isPublicRoute(name), false, `${name} must not be public`);
  }
  // Sign-in has to be reachable without being signed in, and a load balancer
  // cannot log in.
  for (const name of ['loginPage', 'login', 'signupPage', 'signup', 'pricingPage', 'stylesheet', 'health']) {
    assert.equal(isPublicRoute(name), true, `${name} must be reachable without a session`);
  }
  assert.equal(isPublicRoute('nonsense'), false, 'an unknown name is never public');
});

test('the surface has not grown a verb by accident', () => {
  assert.deepEqual(METHODS, ['DELETE', 'GET', 'POST']);
});

test('every route name is unique', () => {
  const names = ROUTES.map((r) => r.name);
  assert.equal(new Set(names).size, names.length);
});

// ---------------------------------------------------------------------------
// matching
// ---------------------------------------------------------------------------

test('paths resolve to the right handler with the right params', () => {
  const cases = [
    ['GET', '/', 'homePage', {}],
    ['GET', '/styles.css', 'stylesheet', {}],
    ['GET', '/api/health', 'health', {}],
    ['POST', '/api/jobs', 'createJob', {}],
    ['GET', `/api/jobs/${ID}`, 'getJob', { id: ID }],
    ['DELETE', `/api/jobs/${ID}`, 'cancelJob', { id: ID }],
    ['GET', `/api/jobs/${ID}/stills`, 'listStills', { id: ID }],
    ['GET', `/api/jobs/${ID}/stills/3`, 'getStill', { id: ID, index: '3' }],
    ['POST', `/api/jobs/${ID}/select`, 'select', { id: ID }],
    ['GET', `/api/jobs/${ID}/video`, 'getVideo', { id: ID }],
    ['GET', `/api/jobs/${ID}/poster`, 'getPoster', { id: ID }],
    ['GET', `/j/${ID}`, 'statusPage', { id: ID }],
    ['GET', `/j/${ID}/select`, 'selectPage', { id: ID }],
    ['GET', `/j/${ID}/result`, 'resultPage', { id: ID }],
    ['GET', '/login', 'loginPage', {}],
    ['POST', '/login', 'login', {}],
    ['GET', '/signup', 'signupPage', {}],
    ['POST', '/signup', 'signup', {}],
    ['POST', '/logout', 'logout', {}],
    ['GET', '/pricing', 'pricingPage', {}],
    ['GET', '/places/schrebergarten-august.jpg', 'placeImage', { file: 'schrebergarten-august.jpg' }],
  ];
  for (const [method, url, name, params] of cases) {
    const m = matchRoute(method, url);
    assert.ok(m.ok, `${method} ${url} did not match`);
    assert.equal(m.name, name);
    assert.deepEqual(m.params, params);
  }
});

test('a literal segment beats a parameter', () => {
  // `/api/jobs/:id` and `/api/health` are the same length; health must win.
  assert.equal(matchRoute('GET', '/api/health').name, 'health');
});

test('query strings are parsed and never part of the match', () => {
  const m = matchRoute('GET', `/api/jobs/${ID}/video?download=1&x=2`);
  assert.ok(m.ok);
  assert.equal(m.params.id, ID);
  assert.equal(m.query.get('download'), '1');
  assert.equal(m.pathname, `/api/jobs/${ID}/video`);
});

test('a fragment is not part of the path', () => {
  const m = matchRoute('GET', `/j/${ID}#top`);
  assert.ok(m.ok);
  assert.equal(m.params.id, ID);
});

test('a trailing slash is tolerated', () => {
  assert.equal(matchRoute('GET', '/api/health/').name, 'health');
  assert.equal(matchRoute('GET', '/').name, 'homePage');
});

test('HEAD routes as GET, and OPTIONS does not', () => {
  const head = matchRoute('HEAD', `/api/jobs/${ID}`);
  assert.ok(head.ok);
  assert.equal(head.name, 'getJob');
  assert.equal(head.method, 'HEAD');

  const options = matchRoute('OPTIONS', `/api/jobs/${ID}`);
  assert.equal(options.ok, false);
  assert.equal(options.status, 405);
});

// ---------------------------------------------------------------------------
// refusals
// ---------------------------------------------------------------------------

test('an unknown path is 404 and a known path with the wrong method is 405', () => {
  const missing = matchRoute('GET', '/nope');
  assert.equal(missing.status, 404);

  const wrong = matchRoute('POST', `/api/jobs/${ID}/video`);
  assert.equal(wrong.status, 405);
  assert.deepEqual(wrong.allow, ['GET', 'HEAD', 'OPTIONS']);

  const wrongJobs = matchRoute('PUT', '/api/jobs');
  assert.equal(wrongJobs.status, 405);
  assert.ok(wrongJobs.allow.includes('POST'));
  assert.ok(!wrongJobs.allow.includes('GET'), 'GET /api/jobs is not a route');
});

test('405 lists every method the path answers', () => {
  const m = matchRoute('PATCH', `/api/jobs/${ID}`);
  assert.equal(m.status, 405);
  assert.deepEqual(m.allow, ['DELETE', 'GET', 'HEAD', 'OPTIONS']);
});

/**
 * THE ONE THAT MATTERS. A traversal attempt does not arrive spelled out; it
 * arrives percent-encoded, and a matcher that splits before it decodes sees one
 * tidy segment and hands `../../config/render.json` on as a job id.
 */
test('percent-encoded traversal is refused with 400, not matched as an id', () => {
  const attempts = [
    '/api/jobs/%2e%2e%2f%2e%2e%2fconfig%2frender.json',
    '/api/jobs/..%2f..%2fetc%2fpasswd',
    '/api/jobs/%2E%2E/%2E%2E/secrets',
    '/j/..%5C..%5Cwindows%5Csystem32',
    '/api/jobs/%2e%2e',
    '/api/jobs/a%00b',
  ];
  for (const url of attempts) {
    const m = matchRoute('GET', url);
    assert.equal(m.ok, false, `${url} matched a route`);
    assert.equal(m.status, 400, `${url} should be 400, got ${m.status}`);
  }
});

test('literal dot segments are refused too', () => {
  assert.equal(matchRoute('GET', '/api/jobs/../health').status, 400);
  assert.equal(matchRoute('GET', '/api/./health').status, 400);
});

test('a malformed escape is 400 rather than a guess', () => {
  assert.equal(matchRoute('GET', '/api/jobs/%zz').status, 400);
  assert.equal(matchRoute('GET', '/api/jobs/%').status, 400);
});

test('a request target that is not a path is 400', () => {
  assert.equal(matchRoute('GET', 'http://evil.example/api/health').status, 400);
  assert.equal(matchRoute('GET', '').status, 400);
});

test('splitPath throws RouteError rather than returning a shape', () => {
  assert.throws(() => splitPath('/a/../b'), RouteError);
  assert.throws(() => splitPath('not-a-path'), RouteError);
  assert.deepEqual(splitPath('/a/b/').segments, ['a', 'b']);
});

/**
 * The router only refuses path *shapes*. Rejecting an id that is the right shape
 * but not a job id is the handler's job, against the strict `JOB_ID_RE` -- and
 * this test is here so that the division of labour is written down rather than
 * assumed by whoever reads one of the two files.
 */
test('the router passes through ids it has no opinion about', () => {
  const m = matchRoute('GET', '/api/jobs/not-a-job-id');
  assert.ok(m.ok, 'the router matched, as designed');
  assert.equal(m.params.id, 'not-a-job-id');
  assert.equal(JOB_ID_RE.test(m.params.id), false, 'and the handler is the one that refuses it');
});

test('a decoded id keeps its exact bytes', () => {
  const m = matchRoute('GET', `/api/jobs/${ID.replace(/-/g, '%2D')}`);
  assert.ok(m.ok);
  assert.equal(m.params.id, ID);
  assert.ok(JOB_ID_RE.test(m.params.id));
});
