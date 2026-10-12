import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { socketProtocols, secureOrigin } from '../public/protocol.js';
import { decodeFrame, encodeFrame, VERSION } from '../public/protocol.js';

const html = await readFile(new URL('../public/viewer.html', import.meta.url), 'utf8');
const source = (await readFile(new URL('../public/viewer.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY7sAAAAASUVORK5CYII=', 'base64');
const settle = () => new Promise(resolve => setImmediate(resolve));

async function viewer(t, origin = 'https://draw.example.org') {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, {
    dataset: {}, hidden: id === 'drawing', textContent: '', events: new Map(),
    classList: { toggle() {} }, addEventListener(type, listener) { this.events.set(type, listener); },
  }]));
  const completions = [], painted = [], revoked = [], sockets = [], windowEvents = new Map();
  elements.get('drawing').getContext = () => ({ drawImage(image) { painted.push(image.src); } });
  class Socket {
    constructor() { this.events = new Map(); sockets.push(this); }
    addEventListener(type, listener) { this.events.set(type, listener); }
    close() {}
  }
  class FrameImage { decode() { return new Promise(resolve => completions.push(resolve)); } }
  class FrameURL extends URL {
    static createObjectURL() { return `blob:fixture-${completions.length + 1}`; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  await runInNewContext(`(async () => { ${source}\n })()`, {
    document: { getElementById: id => elements.get(id) },
    window: { addEventListener(type, listener) { windowEvents.set(type, listener); } },
    location: { origin, pathname: '/view/fixture', hash: '#synthetic-viewer' },
    fetch: async () => ({ json: async () => ({ maxFrameBytes: 2048, maxEdge: 1600 }) }),
    WebSocket: Socket, socketProtocols, secureOrigin, Image: FrameImage, URL: FrameURL, Blob, decodeFrame, VERSION, setTimeout, clearTimeout,
  });
  t.after(() => windowEvents.get('pagehide')());
  const message = data => sockets[0].events.get('message')({ data: JSON.stringify(data) });
  if (sockets.length) message({ type: 'ready', epoch: 'test', state: 'live' });
  return {
    get: id => elements.get(id), sockets, completions, painted, revoked, message,
    frame: (seq, epoch = 'test') => sockets[0].events.get('message')({ data: encodeFrame({ epoch, seq, width: 1, height: 1, mime: 'image/png' }, png) }),
  };
}

test('viewer paints completed frames while keeping only the latest pending decode', async t => {
  const app = await viewer(t);
  app.frame(1); app.frame(2); app.frame(3);
  assert.equal(app.completions.length, 1);
  app.completions[0](); await settle();
  assert.equal(app.get('drawing').dataset.sequence, '1');
  assert.equal(app.get('drawing').hidden, false);
  assert.equal(app.get('status').textContent, 'Live');
  assert.equal(app.completions.length, 2);
  app.frame(4);
  app.completions[1](); await settle();
  assert.equal(app.get('drawing').dataset.sequence, '3');
  app.completions[2](); await settle();
  assert.equal(app.get('drawing').dataset.sequence, '4');
  assert.equal(app.painted.length, 3);
  assert.deepEqual(app.revoked, app.painted);
});

test('session end discards in-flight and pending viewer images', async t => {
  const app = await viewer(t);
  app.frame(1); app.frame(2);
  app.message({ type: 'ended' });
  app.completions[0](); await settle();
  assert.equal(app.get('drawing').hidden, true);
  assert.equal(app.get('drawing').width, 1);
  assert.equal(app.get('status').textContent, 'Session ended');
  assert.equal(app.completions.length, 1);
  assert.equal(app.painted.length, 0);
  assert.equal(app.revoked.length, 1);
});

test('a new presenter epoch invalidates the old decode and displays only fresh pixels', async t => {
  const app = await viewer(t);
  app.frame(1);
  app.message({ type: 'status', epoch: 'next', state: 'live' });
  app.frame(1, 'next');
  app.completions[0](); await settle();
  assert.equal(app.painted.length, 0);
  assert.equal(app.get('status').textContent, 'Waiting for the presenter');
  app.completions[1](); await settle();
  assert.equal(app.painted.length, 1);
  assert.equal(app.get('status').textContent, 'Live');
  assert.equal(app.revoked.length, 2);
});

test('remote HTTP viewers refuse to transmit their capability', async t => {
  const app = await viewer(t, 'http://draw.example.org');
  assert.equal(app.sockets.length, 0); assert.equal(app.get('drawing').hidden, true);
  assert.match(app.get('status').textContent, /HTTPS/);
});
