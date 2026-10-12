import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { createApplication } from '../server/app.mjs';
import { configuration } from '../server/config.mjs';
import { encodeFrame, decodeFrame, socketProtocols } from '../public/protocol.js';
import https from 'node:https';
import tls from 'node:tls';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY7sAAAAASUVORK5CYII=', 'base64');

test('aborted hostile TLS upgrades cannot crash or make the relay unavailable', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'live-draw-tls-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'openssl.cnf'), '[req]\ndistinguished_name=dn\n[dn]\n[v3]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:TRUE\n');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-config', join(directory, 'openssl.cnf'), '-extensions', 'v3',
    '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem')], { stdio: 'ignore' });
  const key = await readFile(join(directory, 'key.pem')), cert = await readFile(join(directory, 'cert.pem'));
  const app = createApplication({ host: '127.0.0.1', port: 0 }, listener => https.createServer({ key, cert }, listener));
  await app.listen(); t.after(() => app.close());
  // A real TLS client deliberately abandons a rejected WebSocket upgrade.
  for (let i = 0; i < 10; i++) {
    const client = tls.connect({ host: '127.0.0.1', port: app.server.address().port, ca: cert });
    client.on('error', () => {});
    await once(client, 'secureConnect');
    const closed = once(client, 'close');
    client.on('data', () => client.destroy());
    client.write('GET /socket HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nOrigin: https://invalid.example\r\n\r\n');
    await closed;
  }
  await delay(20);
  const status = await new Promise((resolveStatus, reject) => {
    const request = https.get(app.origin + '/health', { ca: cert }, response => {
      response.resume(); resolveStatus(response.statusCode);
    });
    request.on('error', reject);
  });
  assert.equal(status, 200);
});
async function fixture(t, config = {}) {
  const app = createApplication({ port: 0, fps: 30, ...config }); await app.listen();
  t.after(() => app.close());
  return app;
}
async function createSession(app, key = '') {
  const response = await fetch(app.origin + '/api/sessions', { method: 'POST', headers: { Origin: app.origin, 'X-Host-Key': key } });
  return { response, session: await response.json() };
}
async function connection(app, auth) {
  const ws = new WebSocket(app.origin.replace(/^http/, 'ws') + '/socket', auth ? socketProtocols(auth) : [], { headers: { Origin: app.origin } });
  const messages = [], waiters = [];
  ws.on('message', (data, binary) => {
    const message = binary ? { binary: true, data } : JSON.parse(data.toString());
    const index = waiters.findIndex(waiter => waiter.predicate(message));
    if (index < 0) messages.push(message);
    else { const waiter = waiters.splice(index, 1)[0]; clearTimeout(waiter.timeout); waiter.resolve(message); }
  });
  ws.on('error', () => {});
  await once(ws, 'open');
  const next = (predicate = () => true) => {
    const index = messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timeout: setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('Expected relay message not received')); }, 1500) }; waiters.push(waiter);
    });
  };
  if (auth) ws.send(JSON.stringify({ type: 'auth', v: 1, ...auth }));
  return { ws, next, messages };
}
const auth = (session, role) => ({ id: session.id, role, token: session[role === 'presenter' ? 'presenterToken' : 'viewerToken'] });
const frame = (epoch, seq = 1, image = png, extra = {}) => encodeFrame({ epoch, seq, width: 1, height: 1, mime: 'image/png', ...extra }, image);

// These tests use real HTTP and WebSocket connections with synthetic pixels.
test('session creation enforces origin, host key, limits and no-cache headers', async t => {
  const key = 'synthetic-host-key-for-tests-only-12345678';
  const app = await fixture(t, { hostKey: key, maxSessions: 1 });
  assert.equal((await fetch(app.origin + '/api/sessions', { method: 'POST' })).status, 403);
  assert.equal((await createSession(app, 'wrong')).response.status, 403);
  const { response, session } = await createSession(app, key);
  assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.notEqual(session.presenterToken, session.viewerToken); assert.ok(session.viewerToken.length >= 32);
  assert.equal((await createSession(app, key)).response.status, 503);
});
test('configuration refuses accidental network exposure', () => {
  assert.throws(() => configuration({ HOST: '0.0.0.0' }), /Network binding/);
  assert.throws(() => configuration({ FRAME_RATE: 'not-a-number' }), /Invalid/);
  assert.throws(() => configuration({ PUBLIC_ORIGIN: 'https://draw.example.org/' }), /origin/);
  assert.equal(configuration({}).host, '127.0.0.1');
});
test('HTTPS proxy configuration explicitly allows its matching WSS origin', async t => {
  const app = await fixture(t, { publicOrigin: 'https://draw.example.org' });
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/health`);
  assert.ok(response.headers.get('content-security-policy').includes("connect-src 'self' wss://draw.example.org;"));
});
test('built presenter, viewer and iframe assets are served with the intended content types', async t => {
  const app = await fixture(t);
  for (const [path, type, text] of [
    ['/', 'text/html', 'Start live session'],
    ['/watch/00000000-0000-0000-0000-000000000000', 'text/html', 'Fullscreen'],
    ['/editor.html', 'text/html', '/klecks/embed.js'],
    ['/klecks/embed.js', 'text/javascript', 'subscribeViewport'],
  ]) {
    const response = await fetch(app.origin + path);
    assert.equal(response.status, 200, path); assert.ok(response.headers.get('content-type').startsWith(type));
    assert.ok((await response.text()).includes(text), path);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  }
  assert.equal((await fetch(app.origin + '/%2e%2e%2fpackage.json')).status, 404);
});
test('real frames reach viewers and late joins receive only the latest frame', async t => {
  const app = await fixture(t); const { session } = await createSession(app);
  const presenter = await connection(app, auth(session, 'presenter')); const ready = await presenter.next(m => m.type === 'ready');
  const viewer = await connection(app, auth(session, 'viewer')); await viewer.next(m => m.type === 'ready');
  presenter.ws.send(frame(ready.epoch)); assert.equal(decodeFrame((await viewer.next(m => m.binary)).data).header.seq, 1);
  await delay(25); presenter.ws.send(frame(ready.epoch, 2)); await viewer.next(m => m.binary);
  const late = await connection(app, auth(session, 'viewer')); await late.next(m => m.type === 'ready');
  assert.equal(decodeFrame((await late.next(m => m.binary)).data).header.seq, 2);
  assert.equal(app.sessions.get(session.id).seq, 2);
});
test('viewer cannot publish or stop a session', async t => {
  const app = await fixture(t); const { session } = await createSession(app);
  const presenter = await connection(app, auth(session, 'presenter')); await presenter.next(m => m.type === 'ready');
  const viewer = await connection(app, auth(session, 'viewer')); await viewer.next(m => m.type === 'ready');
  const closed = once(viewer.ws, 'close'); viewer.ws.send(JSON.stringify({ type: 'stop' }));
  assert.equal((await closed)[0], 1008); assert.ok(app.sessions.has(session.id));
});
test('wrong capability and duplicate presenter are rejected', async t => {
  const app = await fixture(t); const { session } = await createSession(app);
  const first = await connection(app, auth(session, 'presenter')); await first.next(m => m.type === 'ready');
  await assert.rejects(() => connection(app, auth(session, 'presenter')), /403/);
  await assert.rejects(() => connection(app, { ...auth(session, 'presenter'), token: session.viewerToken }), /403/);
});
test('viewer capacity is enforced and freed on disconnect', async t => {
  const app = await fixture(t, { maxViewers: 1 }); const { session } = await createSession(app);
  const viewer = await connection(app, auth(session, 'viewer')); await viewer.next(m => m.type === 'ready');
  const extra = await connection(app, auth(session, 'viewer')); assert.equal((await extra.next(m => m.type === 'unavailable')).reason, 'capacity');
  viewer.ws.close(); await once(viewer.ws, 'close'); await delay(10);
  const replacement = await connection(app, auth(session, 'viewer')); await replacement.next(m => m.type === 'ready');
});
test('reconnecting presenter creates a new epoch and requires fresh pixels', async t => {
  const app = await fixture(t); const { session } = await createSession(app);
  const presenter = await connection(app, auth(session, 'presenter')); const ready = await presenter.next(m => m.type === 'ready');
  const viewer = await connection(app, auth(session, 'viewer')); await viewer.next(m => m.type === 'ready');
  presenter.ws.send(frame(ready.epoch)); await viewer.next(m => m.binary);
  presenter.ws.close(); await once(presenter.ws, 'close'); await viewer.next(m => m.state === 'paused');
  const replacement = await connection(app, auth(session, 'presenter')); const rejoined = await replacement.next(m => m.type === 'ready');
  assert.notEqual(rejoined.epoch, ready.epoch); assert.equal(rejoined.state, 'waiting'); assert.equal(app.sessions.get(session.id).frame, undefined);
  replacement.ws.send(frame(rejoined.epoch)); assert.equal(decodeFrame((await viewer.next(m => m.binary)).data).header.epoch, rejoined.epoch);
});
test('malformed dimensions and replayed frame sequences are rejected', async t => {
  const app = await fixture(t); const { session } = await createSession(app);
  const presenter = await connection(app, auth(session, 'presenter')); const ready = await presenter.next(m => m.type === 'ready');
  const closed = once(presenter.ws, 'close'); presenter.ws.send(frame(ready.epoch, 1, png, { width: 100 })); assert.equal((await closed)[0], 1008);
  const replacement = await connection(app, auth(session, 'presenter')); const fresh = await replacement.next(m => m.type === 'ready');
  replacement.ws.send(frame(fresh.epoch)); await delay(30);
  const replayClosed = once(replacement.ws, 'close'); replacement.ws.send(frame(fresh.epoch)); assert.equal((await replayClosed)[0], 1008);
});
test('explicit stop clears pixels, closes viewers and invalidates capabilities', async t => {
  const app = await fixture(t); const { session } = await createSession(app);
  const presenter = await connection(app, auth(session, 'presenter')); const ready = await presenter.next(m => m.type === 'ready');
  const viewer = await connection(app, auth(session, 'viewer')); await viewer.next(m => m.type === 'ready');
  presenter.ws.send(frame(ready.epoch)); await viewer.next(m => m.binary);
  const retained = app.sessions.get(session.id); presenter.ws.send(JSON.stringify({ type: 'stop' }));
  await viewer.next(m => m.type === 'ended'); assert.equal(retained.frame, undefined); assert.equal(app.sessions.size, 0);
  await assert.rejects(() => connection(app, auth(session, 'viewer')), /403/);
});
test('pause and immediate resume require a fresh, monotonic frame', async t => {
  const app = await fixture(t, { fps: 1 }); const { session } = await createSession(app);
  const presenter = await connection(app, auth(session, 'presenter')); const ready = await presenter.next(m => m.type === 'ready');
  const viewer = await connection(app, auth(session, 'viewer')); await viewer.next(m => m.type === 'ready');
  presenter.ws.send(frame(ready.epoch)); await viewer.next(m => m.binary);
  viewer.messages.length = 0;
  presenter.ws.send(JSON.stringify({ type: 'pause' })); await viewer.next(m => m.state === 'paused');
  presenter.ws.send(JSON.stringify({ type: 'resume' })); await viewer.next(m => m.state === 'waiting');
  assert.equal(app.sessions.get(session.id).frame, undefined);
  presenter.ws.send(frame(ready.epoch, 2));
  assert.equal(decodeFrame((await viewer.next(m => m.binary)).data).header.seq, 2);
});
test('absolute lifetime expires even with an active presenter', async t => {
  const app = await fixture(t, { sessionLifetimeMs: 100 }); const { session } = await createSession(app);
  const presenter = await connection(app, auth(session, 'presenter')); await presenter.next(m => m.type === 'ready');
  assert.equal((await presenter.next(m => m.type === 'ended')).reason, 'expired'); assert.equal(app.sessions.size, 0);
});
test('a burst is bounded and sustained excess frames cannot replace the retained view', async t => {
  const app = await fixture(t, { fps: 1 }); const { session } = await createSession(app);
  const presenter = await connection(app, auth(session, 'presenter')); const ready = await presenter.next(m => m.type === 'ready');
  const viewer = await connection(app, auth(session, 'viewer')); await viewer.next(m => m.type === 'ready');
  for (let seq = 1; seq <= 100; seq++) presenter.ws.send(frame(ready.epoch, seq));
  await viewer.next(m => m.binary); await delay(30);
  assert.equal(app.sessions.get(session.id).seq, 2);
});
test('oversized payload and unauthenticated connections are closed', async t => {
  const app = await fixture(t, { maxFrameBytes: 1024, authTimeoutMs: 50 }); const { session } = await createSession(app);
  const presenter = await connection(app, auth(session, 'presenter')); await presenter.next(m => m.type === 'ready');
  const closed = once(presenter.ws, 'close'); presenter.ws.send(Buffer.alloc(4096)); assert.equal((await closed)[0], 1009);
  await assert.rejects(() => connection(app), /403/);
});
test('server restart invalidates the old session', async t => {
  const first = createApplication({ port: 0 }); await first.listen(); const { session } = await createSession(first);
  await first.close();
  const replacement = await fixture(t);
  await assert.rejects(() => connection(replacement, auth(session, 'viewer')), /403/);
});
test('session lifetime and presenter grace expire independently of viewers', async t => {
  const app = await fixture(t, { reconnectGraceMs: 70 }); const { session } = await createSession(app);
  const viewer = await connection(app, auth(session, 'viewer')); await viewer.next(m => m.type === 'ready');
  assert.equal((await viewer.next(m => m.type === 'ended')).reason, 'expired'); assert.equal(app.sessions.size, 0);
});
test('synthetic viewer group respects the configured limit', async t => {
  const app = await fixture(t); const { session } = await createSession(app);
  const presenter = await connection(app, auth(session, 'presenter')); const ready = await presenter.next(m => m.type === 'ready');
  const viewers = await Promise.all(Array.from({ length: 25 }, async () => { const viewer = await connection(app, auth(session, 'viewer')); await viewer.next(m => m.type === 'ready'); return viewer; }));
  presenter.ws.send(frame(ready.epoch)); await Promise.all(viewers.map(viewer => viewer.next(m => m.binary)));
  assert.equal(app.sessions.get(session.id).viewers.size, 25);
});
test('slow reader is disconnected before unbounded queue growth', async t => {
  const app = await fixture(t, { maxQueuedBytes: 32768 }); const { session } = await createSession(app);
  const presenter = await connection(app, auth(session, 'presenter')); const ready = await presenter.next(m => m.type === 'ready');
  const viewer = await connection(app, auth(session, 'viewer')); await viewer.next(m => m.type === 'ready');
  viewer.ws._socket.pause();
  const image = Buffer.alloc(1024 * 1024); png.copy(image);
  for (let seq = 1; seq <= 40 && app.sessions.get(session.id).viewers.size; seq++) { presenter.ws.send(frame(ready.epoch, seq, image)); await delay(22); }
  viewer.ws._socket.resume(); await delay(30);
  assert.equal(app.sessions.get(session.id).viewers.size, 0);
  assert.ok(app.sessions.get(session.id).frame.length < app.config.maxFrameBytes + 2048);
});
test('unexpected WebSocket origins are rejected before authentication', async t => {
  const app = await fixture(t);
  const socket = new WebSocket(app.origin.replace(/^http/, 'ws') + '/socket', { headers: { Origin: 'https://unrelated.example' } });
  socket.on('error', () => {});
  const [, response] = await once(socket, 'unexpected-response'); assert.equal(response.statusCode, 403); response.resume(); socket.terminate();
});
