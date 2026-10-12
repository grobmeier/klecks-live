import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { encodeFrame, decodeFrame, socketProtocols } from '../public/protocol.js';

const origin = process.env.PUBLIC_ORIGIN;
if (!origin || new URL(origin).origin !== origin || !origin.startsWith('https://')) throw new Error('An exact HTTPS PUBLIC_ORIGIN is required');
const key = process.env.HOST_ACCESS_KEY;
const anonymousOnly = process.argv.includes('--anonymous-only');
if (!anonymousOnly && !key) throw new Error('Run authenticated smoke checks inside the operator-managed container');
const sockets = new Set();
let cookie, presenter;
const request = (path, options = {}) => fetch(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(10000), ...options });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY7sAAAAASUVORK5CYII=', 'base64');
const auth = (session, role) => ({ type: 'auth', v: 1, id: session.id, role, token: session[role === 'presenter' ? 'presenterToken' : 'viewerToken'] });

async function connect(credentials, suppliedOrigin = origin) {
  const ws = new WebSocket(origin.replace(/^https:/, 'wss:') + '/socket', socketProtocols(credentials || {}), { headers: { Origin: suppliedOrigin } });
  sockets.add(ws); ws.on('error', () => {});
  const messages = [], waiters = [];
  ws.on('message', (bytes, binary) => {
    const message = binary ? { binary: true, bytes } : JSON.parse(bytes.toString());
    const i = waiters.findIndex(waiter => waiter.predicate(message));
    if (i < 0) messages.push(message);
    else { const waiter = waiters.splice(i, 1)[0]; clearTimeout(waiter.timer); waiter.resolve(message); }
  });
  const timeout = setTimeout(() => ws.terminate(), 10000);
  try { await once(ws, 'open'); } finally { clearTimeout(timeout); }
  const next = predicate => {
    const i = messages.findIndex(predicate);
    if (i >= 0) return Promise.resolve(messages.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('Online relay message timed out')); }, 10000) };
      waiters.push(waiter);
    });
  };
  ws.send(JSON.stringify(credentials));
  return { ws, next };
}

async function closedSocket(ws) {
  const timer = setTimeout(() => ws.terminate(), 10000);
  try { return await once(ws, 'close'); } finally { clearTimeout(timer); }
}

try {
  const health = await request('/health'); assert.equal(health.status, 200);
  const page = await request('/'); assert.equal(page.status, 200);
  const html = await page.text(); assert.ok(html.includes('id="login-form"') && !html.includes('<iframe'));
  assert.equal((await request('/editor.html')).status, 403);
  assert.equal((await request('/klecks%2fembed.js')).status, 403);
  assert.equal((await request('/klecks/embed.js', { method: 'HEAD' })).status, 403);
  const settings = await (await request('/api/config')).json(); assert.equal(settings.editorAccess, 'private');
  assert.equal((await request('/api/sessions', { method: 'POST', headers: { Origin: origin } })).status, 403);
  assert.equal((await request('/api/presenter-access', { method: 'POST', headers: { Origin: 'https://invalid.example' } })).status, 403);
  await assert.rejects(() => connect({ type: 'auth', v: 1, role: 'viewer', id: 'invalid', token: 'invalid' }, 'https://invalid.example'));
  console.log('PASS: trusted HTTPS, private editor, protected assets and session creation');
  if (!anonymousOnly) {
    const login = await request('/api/presenter-access', { method: 'POST', headers: { Origin: origin, 'X-Host-Key': key } });
    assert.equal(login.status, 200);
    const issued = login.headers.get('set-cookie'); assert.ok(issued?.startsWith('__Host-live-draw-presenter='));
    for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(issued.includes(attribute));
    cookie = issued.split(';')[0];
    const editor = await request('/klecks/embed.js', { headers: { Cookie: cookie } });
    assert.equal(editor.status, 200); assert.ok((await editor.text()).includes('subscribeViewport'));
    const created = await request('/api/sessions', { method: 'POST', headers: { Origin: origin, Cookie: cookie } });
    assert.equal(created.status, 201); const session = await created.json();
    presenter = await connect(auth(session, 'presenter')); const ready = await presenter.next(message => message.type === 'ready');
    const viewer = await connect(auth(session, 'viewer')); await viewer.next(message => message.type === 'ready');
    presenter.ws.send(encodeFrame({ epoch: ready.epoch, seq: 1, width: 1, height: 1, mime: 'image/png' }, png));
    assert.equal(decodeFrame((await viewer.next(message => message.binary)).bytes).header.seq, 1);
    const late = await connect(auth(session, 'viewer')); await late.next(message => message.type === 'ready');
    assert.equal(decodeFrame((await late.next(message => message.binary)).bytes).header.seq, 1);
    const closed = closedSocket(late.ws); late.ws.send(JSON.stringify({ type: 'stop' })); assert.equal((await closed)[0], 1008);
    presenter.ws.send(JSON.stringify({ type: 'stop' })); await viewer.next(message => message.type === 'ended');
    console.log('PASS: protected cookies, actual editor, WSS pixels, late joins, viewer isolation and stop');
    await request('/api/presenter-access', { method: 'DELETE', headers: { Origin: origin, Cookie: cookie } });
    assert.equal((await request('/editor.html', { headers: { Cookie: cookie } })).status, 403);
    cookie = undefined;
    console.log('PASS: revoked device access is denied');
  }
} finally {
  if (presenter?.ws.readyState === WebSocket.OPEN) presenter.ws.send(JSON.stringify({ type: 'stop' }));
  for (const socket of sockets) socket.terminate();
  if (cookie) await request('/api/presenter-access', { method: 'DELETE', headers: { Origin: origin, Cookie: cookie } }).catch(() => {});
}
