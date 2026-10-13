import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { secureOrigin } from '../public/protocol.js';

const html = await readFile(new URL('../public/login.html', import.meta.url), 'utf8');
const source = (await readFile(new URL('../public/login.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const presenterHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
function login({ response = () => ({ ok: true, json: async () => ({ authorized: true }) }), cookieAccepted = true, origin = 'https://draw.example.org' } = {}) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, {
    value: '', checked: false, hidden: true, disabled: false, textContent: '', events: new Map(),
    addEventListener(type, listener) { this.events.set(type, listener); }, focus() { this.focused = true; },
  }]));
  const requests = [], navigations = [];
  runInNewContext(source, {
    document: { getElementById: id => elements.get(id) }, secureOrigin, location: { origin, replace: path => navigations.push(path) },
    fetch: async (path, options) => {
      requests.push({ path, ...options });
      return options.method === 'POST' ? response() : { ok: true, json: async () => ({ authorized: cookieAccepted }) };
    },
  });
  return { get: id => elements.get(id), requests, navigations, submit: () => elements.get('login-form').events.get('submit')({ preventDefault() {} }) };
}

test('native password form submissions cannot put credentials in a GET query when JavaScript is unavailable', () => {
  for (const page of [html, presenterHtml]) {
    const form = page.match(/<form\b[^>]*>/)?.[0];
    assert.match(form, /method="post"/); assert.match(form, /action="\/api\/presenter-access"/);
  }
});

test('private sign-in trims the password, remembers only on request, checks the cookie and opens the editor', async () => {
  const app = login(); app.get('host-key').value = ' synthetic-existing-password\n'; app.get('remember-device').checked = true;
  await app.submit();
  assert.equal(app.requests[0].headers['X-Host-Key'], 'synthetic-existing-password');
  assert.equal(app.requests[0].headers['X-Remember-Device'], 'true');
  assert.equal(app.requests[0].credentials, 'same-origin'); assert.equal(app.requests[1].cache, 'no-store');
  assert.deepEqual(app.navigations, ['/present']); assert.equal(app.get('host-key').value, '');
});

test('a wrong password stays on sign-in and can be corrected without navigation', async () => {
  let accepted = false;
  const app = login({ response: () => ({ ok: accepted, status: accepted ? 200 : 403, json: async () => accepted ? { authorized: true } : { error: 'Host access key required' } }) });
  app.get('host-key').value = 'wrong'; await app.submit();
  assert.equal(app.get('login-error').hidden, false); assert.match(app.get('login-error').textContent, /existing password/);
  assert.equal(app.get('host-key').disabled, false); assert.equal(app.navigations.length, 0);
  accepted = true; app.get('host-key').value = 'synthetic-existing-password'; await app.submit();
  assert.equal(app.requests[1].headers['X-Remember-Device'], 'false'); assert.deepEqual(app.navigations, ['/present']);
});

test('blocked cookies stop navigation with a clear explanation and clear the accepted password', async () => {
  const app = login({ cookieAccepted: false }); app.get('host-key').value = 'synthetic-existing-password'; await app.submit();
  assert.match(app.get('login-error').textContent, /Allow cookies/); assert.equal(app.navigations.length, 0);
  assert.equal(app.get('host-key').value, ''); assert.equal(app.get('submit-login').disabled, false);
});

test('pending sign-in prevents duplicate submissions and a network failure permits retry', async () => {
  let fail;
  const app = login({ response: () => new Promise((resolve, reject) => { fail = reject; }) });
  app.get('host-key').value = 'synthetic-existing-password'; const submitted = app.submit(); await app.submit();
  assert.equal(app.requests.length, 1); assert.equal(app.get('submit-login').disabled, true);
  fail(new TypeError('Failed to fetch')); await submitted;
  assert.match(app.get('login-error').textContent, /Could not reach/); assert.equal(app.get('submit-login').disabled, false);
});

test('remote HTTP sign-in refuses to transmit the presenter password', async () => {
  const app = login({ origin: 'http://draw.example.org' });
  app.get('host-key').value = 'synthetic-password'; await app.submit();
  assert.equal(app.requests.length, 0); assert.equal(app.navigations.length, 0);
  assert.match(app.get('login-error').textContent, /HTTPS/);
});
