import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApplication } from '../server/app.mjs';
import { socketProtocols, encodeFrame } from '../public/protocol.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY7sAAAAASUVORK5CYII=', 'base64');

async function room(app) {
  const session = await (await fetch(app.origin + '/api/sessions', { method: 'POST', headers: { Origin: app.origin } })).json();
  const connect = async role => {
    const auth = { type: 'auth', v: 1, role, id: session.id, token: session[role === 'presenter' ? 'presenterToken' : 'viewerToken'] };
    const socket = new WebSocket(app.origin.replace(/^http/, 'ws') + '/socket', socketProtocols(auth), { headers: { Origin: app.origin } });
    socket.on('error', () => {}); await once(socket, 'open');
    const ready = once(socket, 'message'); socket.send(JSON.stringify(auth));
    return { socket, ready: JSON.parse((await ready)[0].toString()) };
  };
  const presenter = await connect('presenter'), viewer = await connect('viewer');
  return { session, presenter, viewer };
}
const frame = (epoch, seq, image = png) => encodeFrame({ epoch, seq, width: 1, height: 1, mime: 'image/png' }, image);

test('sustained presenter ingress ends only the abusive session and invalidates its capability', async t => {
  const app = createApplication({ port: 0, fps: 1 }); await app.listen(); t.after(() => app.close());
  const abusive = await room(app), healthy = await room(app);
  const ended = new Promise(resolve => abusive.viewer.socket.on('message', (data, binary) => { if (!binary && JSON.parse(data).type === 'ended') resolve(JSON.parse(data)); }));
  for (let seq = 1; seq <= 100; seq++) abusive.presenter.socket.send(frame(abusive.presenter.ready.epoch, seq));
  const result = await Promise.race([ended, new Promise(resolve => setTimeout(() => resolve(null), 100))]);
  assert.equal(result?.reason, 'abuse');
  const received = new Promise(resolve => healthy.viewer.socket.on('message', (_, binary) => { if (binary) resolve(); }));
  healthy.presenter.socket.send(frame(healthy.presenter.ready.epoch, 1));
  await Promise.race([received, new Promise((_, reject) => setTimeout(() => reject(new Error('Healthy session stalled')), 1500))]);
  assert.equal((await fetch(app.origin + '/health')).status, 200);
});

test('aggregate ingress bytes are charged before publication and cannot be evaded by dropped frames', async t => {
  const app = createApplication({ port: 0, fps: 30, maxFrameBytes: 1024, maxIngressBytesPerSecond: 1024 });
  await app.listen(); t.after(() => app.close());
  const abusive = await room(app), healthy = await room(app);
  const ended = new Promise(resolve => abusive.viewer.socket.on('message', (data, binary) => { if (!binary && JSON.parse(data).type === 'ended') resolve(JSON.parse(data)); }));
  const image = Buffer.alloc(1024); png.copy(image);
  for (let seq = 1; seq <= 3; seq++) abusive.presenter.socket.send(frame(abusive.presenter.ready.epoch, seq, image));
  assert.equal((await Promise.race([ended, new Promise(resolve => setTimeout(() => resolve(null), 150))]))?.reason, 'abuse');
  const received = new Promise(resolve => healthy.viewer.socket.on('message', (_, binary) => { if (binary) resolve(); }));
  healthy.presenter.socket.send(frame(healthy.presenter.ready.epoch, 1));
  await Promise.race([received, new Promise((_, reject) => setTimeout(() => reject(new Error('Healthy session stalled')), 1500))]);
  const expired = new WebSocket(app.origin.replace(/^http/, 'ws') + '/socket', socketProtocols({ id: abusive.session.id, role: 'presenter', token: abusive.session.presenterToken }), { headers: { Origin: app.origin } });
  expired.on('error', () => {}); await assert.rejects(() => once(expired, 'open'), /403/);
});
