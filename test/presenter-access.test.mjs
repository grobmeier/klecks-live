import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createApplication } from '../server/app.mjs';

const key = 'synthetic-presenter-password-for-tests-only';
async function fixture(t, overrides = {}) {
  const app = createApplication({ port: 0, hostKey: key, ...overrides });
  await app.listen(); t.after(() => app.close());
  return app;
}
function request(app, path, { method = 'GET', cookie, password, remembered, origin = app.origin } = {}) {
  return fetch(`http://127.0.0.1:${app.server.address().port}${path}`, { method, headers: {
    Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(password ? { 'X-Host-Key': password } : {}),
    ...(remembered !== undefined ? { 'X-Remember-Device': String(remembered) } : {}),
  } });
}
async function login(app, options = {}) {
  const response = await request(app, '/api/presenter-access', { method: 'POST', password: key, ...options });
  const header = response.headers.get('set-cookie');
  return { response, status: await response.json(), header, cookie: header?.split(';')[0] };
}

test('remembered HTTPS access uses a separate protected cookie and starts sessions without the password', async t => {
  const app = await fixture(t, { publicOrigin: 'https://draw.example.org' });
  assert.deepEqual(await (await request(app, '/api/presenter-access')).json(), { authorized: false });
  assert.equal((await login(app, { password: 'wrong' })).response.status, 403);
  const access = await login(app, { remembered: true });
  assert.equal(access.response.status, 200); assert.equal(access.status.authorized, true);
  assert.equal(access.status.remembered, true);
  assert.match(access.header, /^__Host-live-draw-presenter=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Secure; Max-Age=2592000$/);
  assert.ok(!access.header.includes(key)); assert.ok(!access.header.includes('Domain='));
  assert.equal(access.response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(access.status).sort(), ['authorized', 'expiresAt', 'remembered']);
  assert.equal((await request(app, '/api/sessions', { method: 'POST', cookie: access.cookie })).status, 201);
  assert.equal((await (await request(app, '/api/presenter-access', { cookie: access.cookie })).json()).authorized, true);
});

test('unchecked remembering uses a browser-session cookie and loopback development remains usable', async t => {
  const app = await fixture(t);
  const access = await login(app, { remembered: false });
  assert.equal(access.status.remembered, false);
  assert.match(access.header, /^live-draw-presenter=.*; Path=\/; HttpOnly; SameSite=Strict$/);
  assert.ok(access.status.expiresAt > Date.now() + 7 * 60 * 60 * 1000);
  assert.equal((await request(app, '/api/sessions', { method: 'POST', cookie: access.cookie })).status, 201);
  const remote = await fixture(t, { publicOrigin: 'http://draw.example.org' });
  const denied = await login(remote); assert.equal(denied.response.status, 403); assert.equal(denied.header, null);
  assert.equal(denied.status.error, 'Presenter sign-in requires HTTPS');
});

test('cookie creation and revocation enforce origin and method without changing valid access', async t => {
  const app = await fixture(t); const access = await login(app);
  assert.equal((await login(app, { origin: 'https://unrelated.example' })).response.status, 403);
  assert.equal((await request(app, '/api/presenter-access', { method: 'DELETE', cookie: access.cookie, origin: 'https://unrelated.example' })).status, 403);
  assert.equal((await request(app, '/api/sessions', { method: 'POST', cookie: access.cookie, origin: 'https://unrelated.example' })).status, 403);
  assert.equal((await request(app, '/api/presenter-access', { method: 'PUT' })).status, 405);
  assert.equal((await request(app, '/api/sessions', { method: 'POST', cookie: access.cookie })).status, 201);
});

test('forget revokes a copied cookie server-side and leaves another authorized device usable', async t => {
  const app = await fixture(t); const first = await login(app), second = await login(app);
  const forgotten = await request(app, '/api/presenter-access', { method: 'DELETE', cookie: first.cookie });
  assert.equal(forgotten.status, 200); assert.match(forgotten.headers.get('set-cookie'), /Max-Age=0$/);
  assert.equal((await request(app, '/api/sessions', { method: 'POST', cookie: first.cookie })).status, 403);
  assert.equal((await request(app, '/api/sessions', { method: 'POST', cookie: second.cookie })).status, 201);
  assert.equal((await (await request(app, '/api/presenter-access', { cookie: first.cookie })).json()).authorized, false);
});

test('both session and remembered authorizations expire and expired capacity can be reused', async t => {
  const app = await fixture(t, { presenterAccessLifetimeMs: 90, presenterRememberLifetimeMs: 90, maxPresenterDevices: 2 });
  const first = await login(app), second = await login(app, { remembered: true });
  await delay(110);
  for (const access of [first, second]) {
    assert.equal((await (await request(app, '/api/presenter-access', { cookie: access.cookie })).json()).authorized, false);
    assert.equal((await request(app, '/api/sessions', { method: 'POST', cookie: access.cookie })).status, 403);
  }
  assert.equal((await login(app)).response.status, 200);
});

test('a restart with the same password invalidates old device cookies', async t => {
  const first = createApplication({ port: 0, hostKey: key }); await first.listen();
  let access;
  try { access = await login(first, { remembered: true }); } finally { await first.close(); }
  const replacement = await fixture(t);
  assert.equal((await request(replacement, '/api/sessions', { method: 'POST', cookie: access.cookie })).status, 403);
  assert.equal((await login(replacement)).response.status, 200);
});

test('device limits do not evict others; reauthorizing rotates and revokes the prior cookie', async t => {
  const app = await fixture(t, { maxPresenterDevices: 1 }); const first = await login(app);
  assert.equal((await login(app)).response.status, 503);
  assert.equal((await request(app, '/api/sessions', { method: 'POST', cookie: first.cookie })).status, 201);
  const renewed = await login(app, { cookie: first.cookie, remembered: true });
  assert.equal(renewed.response.status, 200); assert.notEqual(renewed.cookie, first.cookie);
  assert.equal((await request(app, '/api/sessions', { method: 'POST', cookie: first.cookie })).status, 403);
  assert.equal((await request(app, '/api/sessions', { method: 'POST', cookie: renewed.cookie })).status, 201);
});

test('forged, duplicated and viewer capabilities cannot act as device logins', async t => {
  const app = await fixture(t); const access = await login(app);
  const session = await (await request(app, '/api/sessions', { method: 'POST', password: key })).json();
  for (const cookie of [
    'live-draw-presenter=' + 'a'.repeat(43),
    access.cookie + '; ' + access.cookie,
    'live-draw-presenter=' + session.viewerToken,
    'live-draw-presenter=%zz',
  ]) assert.equal((await request(app, '/api/sessions', { method: 'POST', cookie })).status, 403);
});

test('presenter password attempts share the bounded request budget', async t => {
  const app = await fixture(t);
  for (let count = 0; count < 60; count++) assert.equal((await login(app, { password: 'wrong' })).response.status, 403);
  assert.equal((await login(app)).response.status, 429);
});

test('keyless loopback needs no presenter login and never issues a device cookie', async t => {
  const app = await fixture(t, { hostKey: '' });
  const access = await login(app); assert.equal(access.status.authorized, true); assert.equal(access.header, null);
  assert.equal((await request(app, '/api/sessions', { method: 'POST' })).status, 201);
});
