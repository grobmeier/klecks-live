import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { socketProtocols, secureOrigin, socketAvailable } from '../public/protocol.js';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const source = (await readFile(new URL('../public/presenter.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const session = { id: 'synthetic-session', presenterToken: 'synthetic-presenter', viewerToken: 'synthetic-viewer', expiresAt: Date.now() + 60000 };

async function presenter({ response = () => ({ ok: true, status: 200, json: async () => ({ authorized: true }) }), creation = () => ({ ok: true, status: 201, json: async () => session }), initialAccess = { authorized: false }, forget = () => ({ ok: true }), getPSD = async () => new Blob(['synthetic PSD']), storageDenied = false, earlyEditorReady = false, origin = 'https://draw.example.org', probeStatus = 200 } = {}) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, {
    value: '', checked: false, dataset: {}, style: {}, attributes: {}, hidden: false, disabled: false, open: false, textContent: '', events: new Map(),
    classList: { toggle() {} }, addEventListener(type, listener) { this.events.set(type, listener); },
    showModal() { this.open = true; }, close() { this.open = false; }, focus() { this.focused = true; }, select() {},
    contains(target) { return this === target; }, removeAttribute(name) { delete this[name]; }, setAttribute(name, value) { this.attributes[name] = value; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 768, height: 1024 }; },
  }]));
  elements.get('editor').dataset.ready = 'true';
  let layoutSubscriptions = 0, layoutDisposals = 0;
  elements.get('editor').contentWindow = { liveDrawEditor: { getPSD, subscribeViewport(listener) {
    layoutSubscriptions++;
    listener({ canvas: { getBoundingClientRect: () => ({ left: 270, top: 0, width: 498 }) } });
    return () => { layoutDisposals++; };
  } } };
  const requests = [], sockets = [], saved = new Map(), documentEvents = new Map(), windowEvents = new Map(), revoked = [];
  class ExportURL extends URL {
    static createObjectURL() { return 'blob:synthetic-drawing'; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.events = new Map(); this.sent = []; sockets.push(this); }
    addEventListener(type, listener) { this.events.set(type, listener); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() {}
  }
  const storage = operation => { if (storageDenied) throw new Error('Storage unavailable'); return operation(); };
  await runInNewContext(`(async () => { ${source}\n })()`, {
    document: { hidden: false, getElementById: id => elements.get(id), addEventListener(type, listener) { documentEvents.set(type, listener); } },
    window: { addEventListener(type, listener) { windowEvents.set(type, listener); } },
    location: { origin }, WebSocket: Socket, socketProtocols, secureOrigin, socketAvailable, VERSION: 1,
    sessionStorage: { getItem: key => storage(() => saved.get(key) || null), setItem: (key, value) => storage(() => saved.set(key, value)), removeItem: key => storage(() => saved.delete(key)) },
    fetch: async (path, options) => {
      if (path === '/api/config') {
        if (earlyEditorReady) elements.get('editor').events.get('editor-ready')();
        return { json: async () => ({ hostKeyRequired: true }) };
      }
      if (path === '/api/presenter-access' && !options.method) return { ok: true, json: async () => initialAccess };
      requests.push({ path, method: options.method, key: options.headers?.['X-Host-Key'], remembered: options.headers?.['X-Remember-Device'] });
      if (path === '/api/sessions') return creation();
      if (path === '/api/socket-access') return { status: probeStatus };
      if (options.method === 'DELETE') return forget();
      return response();
    },
    setTimeout, clearTimeout, URL: ExportURL,
  });
  return {
    get: id => elements.get(id), requests, sockets, revoked,
    get layoutSubscriptions() { return layoutSubscriptions; }, get layoutDisposals() { return layoutDisposals; },
    dispatch: (type, event) => documentEvents.get(type)(event),
    click: id => elements.get(id).events.get('click')(),
    submit: () => elements.get('key-form').events.get('submit')({ preventDefault() {} }),
    settle: () => new Promise(resolve => setImmediate(resolve)),
  };
}

test('a rejected host key stays in the dialog and can be corrected before connecting', async () => {
  let accepted = false;
  const app = await presenter({ response: () => ({ ok: accepted, status: accepted ? 201 : 403, json: async () => accepted ? { authorized: true } : { error: 'Host access key required' } }) });
  app.click('start'); app.get('host-key').value = 'a-new-key'; await app.submit();
  assert.equal(app.get('key-dialog').open, true);
  assert.equal(app.get('key-error').hidden, false);
  assert.match(app.get('key-error').textContent, /existing password/);
  assert.equal(app.get('host-key').value, 'a-new-key');
  assert.equal(app.get('submit-key').disabled, false);
  assert.equal(app.sockets.length, 0);
  accepted = true; app.get('host-key').value = '  synthetic-existing-key\n'; await app.submit();
  assert.equal(app.requests[1].key, 'synthetic-existing-key');
  assert.equal(app.requests[1].remembered, 'false');
  assert.equal(app.requests[2].path, '/api/sessions');
  assert.equal(app.requests[2].key, undefined);
  assert.equal(app.get('key-dialog').open, false);
  assert.equal(app.get('host-key').value, '');
  assert.equal(app.get('copy').hidden, false);
  assert.equal(app.sockets.length, 1);
  assert.equal(app.sockets[0].url, 'wss://draw.example.org/socket');
});

test('unavailable browser storage does not prevent an accepted session connecting', async () => {
  const app = await presenter({ storageDenied: true, response: () => ({ ok: true, status: 201, json: async () => ({ authorized: true }) }) });
  app.click('start'); app.get('host-key').value = 'synthetic-existing-key'; await app.submit();
  assert.equal(app.get('key-dialog').open, false); assert.equal(app.sockets.length, 1);
  app.sockets[0].events.get('open')();
  assert.equal(app.sockets[0].sent[0].role, 'presenter');
  assert.equal(app.sockets[0].sent[0].token, session.presenterToken);
});

test('pending creation rejects duplicate submissions and network failure permits retry', async () => {
  let fail;
  const app = await presenter({ response: () => new Promise((resolve, reject) => { fail = reject; }) });
  app.click('start'); app.get('host-key').value = 'synthetic-existing-key';
  const submitted = app.submit(); await app.submit();
  assert.equal(app.requests.length, 1); assert.equal(app.get('submit-key').disabled, true);
  fail(new TypeError('Failed to fetch')); await submitted;
  assert.equal(app.get('key-dialog').open, true); assert.equal(app.get('submit-key').disabled, false);
  assert.match(app.get('key-error').textContent, /Could not reach the server/);
});

test('remembering sends a device choice once; later session starts skip the password dialog', async () => {
  const app = await presenter(); app.click('start');
  assert.equal(app.get('remember-device').checked, false);
  app.get('host-key').value = 'synthetic-existing-password'; app.get('remember-device').checked = true;
  await app.submit(); assert.equal(app.requests[0].remembered, 'true');
  assert.equal(app.get('host-key').value, '');
  assert.equal(app.get('forget-device').hidden, false); assert.equal(app.get('forget-device').disabled, true);
  app.sockets[0].events.get('message')({ data: JSON.stringify({ type: 'ended', reason: 'stopped' }) });
  assert.equal(app.get('forget-device').disabled, false);
  app.click('start'); await app.settle();
  assert.equal(app.get('key-dialog').open, false);
  assert.equal(app.requests.filter(r => r.path === '/api/presenter-access').length, 1);
  assert.equal(app.requests.filter(r => r.path === '/api/sessions').length, 2);
});

test('previous device access starts with one click and expiry returns to sign-in without reloading', async () => {
  const app = await presenter({ initialAccess: { authorized: true }, creation: () => ({ ok: false, status: 403, json: async () => ({ error: 'Host access key required' }) }) });
  const editor = app.get('editor'); app.click('start'); await app.settle();
  assert.equal(app.requests.length, 1); assert.equal(app.requests[0].path, '/api/sessions');
  assert.equal(app.get('key-dialog').open, true); assert.match(app.get('key-error').textContent, /expired or was removed/);
  assert.equal(app.get('forget-device').hidden, true); assert.equal(app.get('editor'), editor);
  assert.equal(app.get('host-key').disabled, false); assert.equal(app.sockets.length, 0);
});

test('blocked cookies produce an actionable retry and discard the successfully entered password', async () => {
  const app = await presenter({ creation: () => ({ ok: false, status: 403, json: async () => ({ error: 'Host access key required' }) }) });
  app.click('start'); app.get('host-key').value = 'synthetic-existing-password'; await app.submit();
  assert.equal(app.get('key-dialog').open, true); assert.match(app.get('key-error').textContent, /Allow cookies/);
  assert.equal(app.get('host-key').value, ''); assert.equal(app.get('submit-key').disabled, false);
});

test('forgetting access requires the password next time and failure keeps access retryable', async () => {
  let accepted = false;
  const app = await presenter({ initialAccess: { authorized: true }, forget: () => ({ ok: accepted }) });
  await app.click('forget-device'); assert.equal(app.get('forget-device').hidden, false);
  assert.match(app.get('notice').textContent, /Could not forget/); assert.equal(app.get('forget-device').disabled, false);
  accepted = true; await app.click('forget-device');
  assert.equal(app.get('forget-device').hidden, true);
  app.click('start'); assert.equal(app.get('key-dialog').open, true); assert.equal(app.sockets.length, 0);
});

test('editor readiness arriving before the access check does not break initialization', async () => {
  const app = await presenter({ earlyEditorReady: true, initialAccess: { authorized: true } });
  assert.equal(app.get('start').disabled, false); app.click('start'); await app.settle();
  assert.equal(app.sockets.length, 1);
});

test('routine sharing keeps the notice hidden while actionable access errors remain visible', async () => {
  const app = await presenter({ initialAccess: { authorized: true } });
  assert.equal(app.get('notice').hidden, true);
  app.click('start'); await app.settle();
  assert.equal(app.get('notice').hidden, true);
  app.sockets[0].events.get('message')({ data: JSON.stringify({ type: 'ended', reason: 'stopped' }) });
  assert.equal(app.get('notice').hidden, true);
  app.click('start'); await app.settle();
  app.sockets[1].events.get('message')({ data: JSON.stringify({ type: 'ended', reason: 'expired' }) });
  assert.equal(app.get('notice').hidden, false);
  assert.match(app.get('notice').textContent, /expired/);
});

test('More dismisses on Escape and outside interaction without creating a session', async () => {
  const app = await presenter();
  app.get('more').open = true;
  app.dispatch('pointerdown', { target: app.get('more') });
  assert.equal(app.get('more').open, true);
  let prevented = false;
  app.dispatch('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(app.get('more').open, false);
  assert.equal(app.get('more-toggle').focused, true);
  assert.equal(prevented, true);
  app.get('more').open = true;
  app.dispatch('pointerdown', { target: app.get('start') });
  assert.equal(app.get('more').open, false);
  assert.equal(app.requests.length, 0);
});

test('PSD export from More prevents duplicate encoding and cleans up its download', async () => {
  let resolve, calls = 0;
  const app = await presenter({ getPSD: () => { calls++; return new Promise(done => { resolve = done; }); } });
  app.get('more').open = true;
  app.click('export-psd'); app.click('export-psd');
  assert.equal(calls, 1);
  assert.equal(app.get('more').open, false);
  assert.equal(app.get('export-psd').disabled, true);
  resolve(new Blob(['synthetic PSD'])); await app.settle();
  assert.equal(app.get('export-dialog').open, true);
  assert.equal(app.get('download').download, 'drawing.psd');
  assert.equal(app.get('export-psd').disabled, false);
  app.click('close-export');
  assert.equal(app.get('export-dialog').open, false);
  assert.deepEqual(app.revoked, ['blob:synthetic-drawing']);
  assert.equal(app.requests.length, 0);
});

test('a failed PSD export is visible and can be retried', async () => {
  let fail = true;
  const app = await presenter({ getPSD: async () => { if (fail) throw new Error('Synthetic encoding failure'); return new Blob(['synthetic PSD']); } });
  app.click('export-psd'); await app.settle();
  assert.equal(app.get('notice').hidden, false);
  assert.match(app.get('notice').textContent, /Could not export PSD/);
  assert.equal(app.get('export-psd').disabled, false);
  fail = false; app.click('export-psd'); await app.settle();
  assert.equal(app.get('export-dialog').open, true);
});

test('hide and restore preserve the editor without starting a session and release geometry observation', async () => {
  const app = await presenter();
  const editor = app.get('editor');
  app.click('hide-controls'); app.click('hide-controls');
  assert.equal(app.get('presenter-controls').hidden, true);
  assert.equal(app.get('show-controls').hidden, false);
  assert.equal(app.get('show-controls').focused, true);
  assert.equal(app.get('show-controls').attributes['aria-expanded'], 'false');
  assert.equal(app.get('show-controls').style.left, '519px');
  assert.equal(app.layoutSubscriptions, 1);
  app.click('show-controls');
  assert.equal(app.get('presenter-controls').hidden, false);
  assert.equal(app.get('show-controls').hidden, true);
  assert.equal(app.get('hide-controls').focused, true);
  assert.equal(app.get('hide-controls').attributes['aria-expanded'], 'true');
  assert.equal(app.layoutDisposals, 1);
  assert.equal(app.get('editor'), editor);
  assert.equal(app.requests.length, 0);
});

test('hidden controls keep sharing state and viewers current and restore access to stop', async () => {
  const app = await presenter({ initialAccess: { authorized: true } });
  app.click('start'); await app.settle();
  const connection = app.sockets[0];
  connection.readyState = 1;
  app.click('hide-controls');
  connection.events.get('message')({ data: JSON.stringify({ type: 'status', state: 'live', viewers: 2 }) });
  assert.equal(app.get('compact-status').textContent, 'Live');
  assert.equal(app.get('compact-count').textContent, '2 viewers');
  assert.equal(app.get('compact-count').hidden, false);
  connection.events.get('message')({ data: JSON.stringify({ type: 'status', state: 'paused', viewers: 1 }) });
  assert.equal(app.get('compact-status').textContent, 'Sharing paused');
  assert.equal(app.get('compact-count').textContent, '1 viewer');
  app.click('show-controls'); app.click('stop');
  assert.equal(connection.sent.at(-1).type, 'stop');
  connection.events.get('message')({ data: JSON.stringify({ type: 'ended', reason: 'expired' }) });
  assert.equal(app.get('compact-status').textContent, 'Sharing is off');
  assert.equal(app.get('compact-count').hidden, true);
  assert.equal(app.get('notice').hidden, false);
  assert.equal(app.sockets.length, 1);
});

test('remote HTTP presenting refuses password and session transmission', async () => {
  const app = await presenter({ origin: 'http://draw.example.org' });
  app.click('start'); app.get('host-key').value = 'synthetic-password'; await app.submit();
  assert.equal(app.requests.length, 0); assert.equal(app.sockets.length, 0);
  assert.match(app.get('key-error').textContent, /HTTPS/);
});

test('a denied reconnect ends sharing without replacing the drawing editor', async () => {
  const app = await presenter({ initialAccess: { authorized: true }, probeStatus: 403 });
  const editor = app.get('editor'); app.click('start'); await app.settle();
  await app.sockets[0].events.get('close')({ code: 1006 });
  assert.equal(app.get('status').textContent, 'Sharing is off');
  assert.match(app.get('notice').textContent, /Session unavailable/);
  assert.equal(app.get('editor'), editor);
});
