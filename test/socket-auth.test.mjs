import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createApplication } from '../server/app.mjs';

async function upgrade(origin, protocols) {
  return new Promise(resolve => {
    const socket = new WebSocket(origin.replace(/^http/, 'ws') + '/socket', protocols, { headers: { Origin: origin } });
    socket.on('error', () => {});
    socket.once('open', () => { socket.terminate(); resolve(101); });
    socket.once('unexpected-response', (_, response) => { response.resume(); socket.terminate(); resolve(response.statusCode); });
  });
}

test('anonymous clients cannot upgrade to a frame-capable WebSocket', async t => {
  const app = createApplication({ port: 0, maxSessions: 1, maxFrameBytes: 8 * 1024 * 1024 });
  await app.listen(); t.after(() => app.close());
  assert.equal(await upgrade(app.origin), 403);
  assert.equal((await fetch(app.origin + '/health')).status, 200);
});

test('viewer capabilities cannot unlock presenter upgrades or large inbound messages', async t => {
  const { socketProtocols } = await import('../public/protocol.js');
  const { once } = await import('node:events');
  const app = createApplication({ port: 0 });
  await app.listen(); t.after(() => app.close());
  const session = await (await fetch(app.origin + '/api/sessions', { method: 'POST', headers: { Origin: app.origin } })).json();
  assert.equal(await upgrade(app.origin, socketProtocols({ id: session.id, role: 'presenter', token: session.viewerToken })), 403);
  const auth = { type: 'auth', v: 1, id: session.id, role: 'viewer', token: session.viewerToken };
  const socket = new WebSocket(app.origin.replace(/^http/, 'ws') + '/socket', socketProtocols(auth), { headers: { Origin: app.origin } });
  socket.on('error', () => {}); await once(socket, 'open');
  const ready = once(socket, 'message'); socket.send(JSON.stringify(auth)); await ready;
  const closed = once(socket, 'close'); socket.send(Buffer.alloc(4096));
  assert.equal((await closed)[0], 1009);
});

test('a burst of anonymous upgrades leaves valid session admission available', async t => {
  const { socketProtocols } = await import('../public/protocol.js');
  const app = createApplication({ port: 0 });
  await app.listen(); t.after(() => app.close());
  assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => upgrade(app.origin))), Array(20).fill(403));
  const session = await (await fetch(app.origin + '/api/sessions', { method: 'POST', headers: { Origin: app.origin } })).json();
  assert.equal(await upgrade(app.origin, socketProtocols({ id: session.id, role: 'viewer', token: session.viewerToken })), 101);
});

test('only one presenter receive slot is reserved per session before the first message', async t => {
  const { socketProtocols } = await import('../public/protocol.js');
  const { once } = await import('node:events');
  const { setTimeout: delay } = await import('node:timers/promises');
  const app = createApplication({ port: 0 }); await app.listen(); t.after(() => app.close());
  const session = await (await fetch(app.origin + '/api/sessions', { method: 'POST', headers: { Origin: app.origin } })).json();
  const protocols = socketProtocols({ id: session.id, role: 'presenter', token: session.presenterToken });
  const socket = new WebSocket(app.origin.replace(/^http/, 'ws') + '/socket', protocols, { headers: { Origin: app.origin } });
  socket.on('error', () => {}); await once(socket, 'open');
  assert.equal(await upgrade(app.origin, protocols), 403);
  const closed = once(socket, 'close'); socket.terminate(); await closed; await delay(10);
  assert.equal(await upgrade(app.origin, protocols), 101);
});
