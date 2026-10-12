import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration } from '../server/config.mjs';
import { createApplication } from '../server/app.mjs';

test('unsafe aggregate frame configurations fail before the relay starts', () => {
  assert.throws(() => configuration({ MAX_SESSIONS: '100', MAX_FRAME_BYTES: '8388608' }), /memory|frame budget/i);
  assert.throws(() => createApplication({ maxSessions: 100, maxFrameBytes: 8388608 }), /memory|frame budget/i);
  const safe = configuration({ MAX_SESSIONS: '2', MAX_FRAME_BYTES: '524288' });
  assert.equal(safe.maxSessions, 2); assert.equal(safe.maxFrameBytes, 524288);
});

test('aggregate queued output drops an oversized delivery and remains usable afterwards', async t => {
  const { WebSocket } = await import('ws');
  const { once } = await import('node:events');
  const { setTimeout: delay } = await import('node:timers/promises');
  const { socketProtocols, encodeFrame } = await import('../public/protocol.js');
  const app = createApplication({ port: 0, fps: 30, maxTotalQueuedBytes: 1024 });
  await app.listen(); t.after(() => app.close());
  const session = await (await fetch(app.origin + '/api/sessions', { method: 'POST', headers: { Origin: app.origin } })).json();
  const connect = async role => {
    const auth = { type: 'auth', v: 1, id: session.id, role, token: session[role === 'presenter' ? 'presenterToken' : 'viewerToken'] };
    const socket = new WebSocket(app.origin.replace(/^http/, 'ws') + '/socket', socketProtocols(auth), { headers: { Origin: app.origin } });
    socket.on('error', () => {}); await once(socket, 'open');
    const ready = once(socket, 'message'); socket.send(JSON.stringify(auth));
    return { socket, ready: JSON.parse((await ready)[0].toString()) };
  };
  const presenter = await connect('presenter'), viewer = await connect('viewer');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY7sAAAAASUVORK5CYII=', 'base64');
  const image = Buffer.alloc(2048); png.copy(image);
  const closed = once(viewer.socket, 'close');
  presenter.socket.send(encodeFrame({ epoch: presenter.ready.epoch, seq: 1, width: 1, height: 1, mime: 'image/png' }, image));
  assert.equal(await Promise.race([closed.then(([code]) => code), delay(100).then(() => undefined)]), 1006);
  await delay(40);
  presenter.socket.send(encodeFrame({ epoch: presenter.ready.epoch, seq: 2, width: 1, height: 1, mime: 'image/png' }, png));
  await delay(20);
  const late = await connect('viewer');
  assert.equal((await fetch(app.origin + '/health')).status, 200);
  late.socket.terminate();
});

test('memory validation accounts for the container ceiling and connection headroom', async () => {
  const { validateMediaBudget } = await import('../server/config.mjs');
  assert.throws(() => validateMediaBudget(configuration({}), 64 * 1024 * 1024), /runtime memory limit/);
  assert.throws(() => configuration({ MAX_SESSIONS: '100', MAX_VIEWERS: '100', MAX_FRAME_BYTES: '1024' }), /runtime memory/);
});

test('fanout shares one queued image budget across viewers', async t => {
  const { WebSocket } = await import('ws');
  const { once } = await import('node:events');
  const { socketProtocols, encodeFrame, decodeFrame } = await import('../public/protocol.js');
  const app = createApplication({ port: 0, maxSessions: 1, maxTotalQueuedBytes: 4096 });
  await app.listen(); t.after(() => app.close());
  const session = await (await fetch(app.origin + '/api/sessions', { method: 'POST', headers: { Origin: app.origin } })).json();
  const connect = async role => {
    const auth = { type: 'auth', v: 1, id: session.id, role, token: session[role === 'presenter' ? 'presenterToken' : 'viewerToken'] };
    const socket = new WebSocket(app.origin.replace(/^http/, 'ws') + '/socket', socketProtocols(auth), { headers: { Origin: app.origin } });
    socket.on('error', () => {}); await once(socket, 'open');
    const ready = once(socket, 'message'); socket.send(JSON.stringify(auth));
    return { socket, ready: JSON.parse((await ready)[0].toString()) };
  };
  const presenter = await connect('presenter'), viewers = [];
  for (let i = 0; i < 9; i++) viewers.push(await connect('viewer'));
  const receipts = viewers.map(({ socket }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fanout did not deliver')), 1500);
    socket.on('message', (data, binary) => { if (binary) { clearTimeout(timer); resolve(decodeFrame(data).header.seq); } });
  }));
  const image = Buffer.alloc(2048); Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY7sAAAAASUVORK5CYII=', 'base64').copy(image);
  presenter.socket.send(encodeFrame({ epoch: presenter.ready.epoch, seq: 1, width: 1, height: 1, mime: 'image/png' }, image));
  assert.deepEqual(await Promise.all(receipts), Array(9).fill(1));
});
