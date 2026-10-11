import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createApplication } from '../server/app.mjs';
import { configuration } from '../server/config.mjs';

const password = 'synthetic-private-editor-password-for-tests';
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'live-draw-editor-test-'));
  await cp(new URL('../public/', import.meta.url), directory, { recursive: true });
  await mkdir(join(directory, 'klecks'));
  await writeFile(join(directory, 'klecks/embed.js'), 'synthetic editor bundle');
  await writeFile(join(directory, 'klecks/LICENSE'), 'synthetic licence notice');
  await writeFile(join(directory, 'future-editor.js'), 'synthetic future private asset');
  const app = createApplication({ port: 0, hostKey: password, staticDir: pathToFileURL(directory + '/'), ...overrides });
  try { await app.listen(); } catch (failure) { await rm(directory, { recursive: true }); throw failure; }
  t.after(async () => { await app.close(); await rm(directory, { recursive: true }); });
  return app;
}
function request(app, path, { cookie, method = 'GET', key } = {}) {
  return fetch(app.origin + path, { method, headers: { Origin: app.origin, ...(cookie ? { Cookie: cookie } : {}), ...(key ? { 'X-Host-Key': key } : {}) } });
}
async function signIn(app) {
  const response = await request(app, '/api/presenter-access', { method: 'POST', key: password });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('editor access defaults to private with a password and refuses invalid private configurations', () => {
  assert.equal(configuration({ HOST_ACCESS_KEY: password }).editorAccess, 'private');
  assert.equal(configuration({}).editorAccess, 'public');
  assert.equal(configuration({ HOST_ACCESS_KEY: password, EDITOR_ACCESS: 'public' }).editorAccess, 'public');
  assert.throws(() => configuration({ EDITOR_ACCESS: 'private' }), /requires HOST_ACCESS_KEY/);
  assert.throws(() => configuration({ EDITOR_ACCESS: 'invalid' }), /private or public/);
  assert.throws(() => configuration({ HOST_ACCESS_KEY: password, EDITOR_ACCESS: '' }), /private or public/);
  assert.throws(() => createApplication({ editorAccess: 'private' }), /requires HOST_ACCESS_KEY/);
  assert.throws(() => createApplication({ editorAccess: 'invalid' }), /private or public/);
});

test('anonymous presenter entry points load only sign-in, without an editor iframe or script', async t => {
  const app = await fixture(t);
  for (const path of ['/', '/present', '/index.html', '/%69ndex.html', '/present?unused=1']) {
    const response = await request(app, path); assert.equal(response.status, 200, path);
    const page = await response.text(); assert.ok(page.includes('id="login-form"'), path);
    assert.ok(!page.includes('<iframe'), path); assert.ok(!page.includes('/presenter.js'), path);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('private editor assets are gated even through encoded, normalized and direct HEAD requests', async t => {
  const app = await fixture(t);
  for (const path of ['/editor.html', '/editor.js', '/presenter.js', '/capture.js', '/klecks/embed.js', '/future-editor.js', '/%65ditor.html', '/klecks%2fembed.js', '/klecks%2f..%2feditor.html', '/viewer.html/../editor.html', '//editor.html']) {
    assert.equal((await request(app, path)).status, 403, path);
  }
  assert.equal((await request(app, '/klecks/embed.js', { method: 'HEAD' })).status, 403);
  // Supplying the operator password as a static-file header is not a device login.
  assert.equal((await request(app, '/klecks/embed.js', { key: password })).status, 403);
  assert.equal((await request(app, '/%2e%2e%2fpackage.json')).status, 404);
});

test('viewer and sign-in pages, their assets and licence notices stay public', async t => {
  const app = await fixture(t);
  for (const path of ['/watch/00000000-0000-0000-0000-000000000000', '/viewer.html', '/viewer.js', '/protocol.js', '/style.css', '/logo.svg', '/login.html', '/login.js', '/klecks/LICENSE']) {
    assert.equal((await request(app, path)).status, 200, path);
  }
  const config = await (await request(app, '/api/config')).json(); assert.equal(config.editorAccess, 'private');
  assert.equal((await request(app, '/api/sessions', { method: 'POST' })).status, 403);
});

test('presenter sign-in opens the actual editor pages and revocation gates the copied cookie', async t => {
  const app = await fixture(t); const cookie = await signIn(app);
  for (const path of ['/present', '/editor.html', '/editor.js', '/presenter.js', '/capture.js', '/klecks/embed.js', '/future-editor.js']) {
    assert.equal((await request(app, path, { cookie })).status, 200, path);
  }
  assert.ok((await (await request(app, '/present', { cookie })).text()).includes('<iframe'));
  assert.equal((await request(app, '/api/presenter-access', { method: 'DELETE', cookie })).status, 200);
  assert.equal((await request(app, '/editor.html', { cookie })).status, 403);
  assert.ok((await (await request(app, '/present', { cookie })).text()).includes('id="login-form"'));
});

test('expired device access cannot fetch an editor asset or presenter page', async t => {
  const app = await fixture(t, { presenterAccessLifetimeMs: 100 }); const cookie = await signIn(app);
  await delay(130);
  assert.equal((await request(app, '/klecks/embed.js', { cookie })).status, 403);
  assert.ok((await (await request(app, '/present', { cookie })).text()).includes('id="login-form"'));
});

test('a viewer capability in a link, cookie or header cannot unlock the editor', async t => {
  const app = await fixture(t);
  const session = await (await request(app, '/api/sessions', { method: 'POST', key: password })).json();
  assert.equal((await request(app, `/editor.html#${session.viewerToken}`)).status, 403);
  assert.equal((await request(app, '/editor.html', { cookie: 'live-draw-presenter=' + session.viewerToken })).status, 403);
  assert.equal((await request(app, '/editor.html', { key: session.viewerToken })).status, 403);
  assert.equal((await request(app, `/watch/${session.id}#${session.viewerToken}`)).status, 200);
});

test('explicit public mode allows local drawing but keeps broadcasting protected', async t => {
  const app = await fixture(t, { editorAccess: 'public' });
  for (const path of ['/', '/editor.html', '/presenter.js', '/klecks/embed.js']) assert.equal((await request(app, path)).status, 200, path);
  assert.ok((await (await request(app, '/')).text()).includes('<iframe'));
  assert.equal((await request(app, '/api/sessions', { method: 'POST' })).status, 403);
  assert.equal((await request(app, '/api/sessions', { method: 'POST', key: password })).status, 201);
});
