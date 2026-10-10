import assert from 'node:assert/strict';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { directory, load } from './lan-config.mjs';
import { encodeFrame, decodeFrame } from '../public/protocol.js';
import { createApplication } from '../server/app.mjs';
import { cp, mkdir } from 'node:fs/promises';

const config = await load();
const ca = await readFile(directory + 'root-ca.pem');
const hostKey = (await readFile(directory + 'host-key.txt', 'utf8')).trim();
let isolated;
if (process.argv.includes('--isolated')) {
  // Exercise new source without restarting the user's active LAN server or
  // replacing the files it currently serves. Reuse only the prepared TLS files.
  const staticDir = new URL('../.build/presenter-review/', import.meta.url);
  await mkdir(staticDir, { recursive: true });
  await cp(new URL('../dist/klecks/', import.meta.url), new URL('klecks/', staticDir), { recursive: true });
  await cp(new URL('../public/', import.meta.url), staticDir, { recursive: true });
  const key = await readFile(directory + 'server-key.pem');
  const cert = await readFile(directory + 'server.pem');
  isolated = createApplication({ host: '127.0.0.1', port: 0, hostKey, staticDir }, listener => https.createServer({ key, cert, minVersion: 'TLSv1.2' }, listener));
  config.origin = await isolated.listen();
}
const sockets = new Set();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY7sAAAAASUVORK5CYII=', 'base64');
const auth = (session, role) => ({ id: session.id, role, token: session[role === 'presenter' ? 'presenterToken' : 'viewerToken'] });

function request(path, { trusted = true, method = 'GET', key, cookie, remembered, origin = config.origin } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(config.origin + path, {
      ...(trusted ? { ca } : {}), method,
      headers: { Origin: origin, ...(key ? { 'X-Host-Key': key } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(remembered !== undefined ? { 'X-Remember-Device': String(remembered) } : {}) },
    }, res => {
      let body = '';
      res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      res.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error('HTTPS check timed out')));
    req.on('error', reject); req.end();
  });
}

async function connect(credentials, origin = config.origin) {
  const ws = new WebSocket(config.origin.replace(/^https/, 'wss') + '/socket', { ca, headers: { Origin: origin } });
  sockets.add(ws); ws.on('error', () => {});
  const messages = [], waiters = [];
  ws.on('message', (data, binary) => {
    const message = binary ? { binary: true, data } : JSON.parse(data.toString());
    const index = waiters.findIndex(waiter => waiter.predicate(message));
    if (index < 0) messages.push(message);
    else { const waiter = waiters.splice(index, 1)[0]; clearTimeout(waiter.timeout); waiter.resolve(message); }
  });
  const timeout = setTimeout(() => ws.terminate(), 5000);
  try { await once(ws, 'open'); } finally { clearTimeout(timeout); }
  const next = predicate => {
    const index = messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timeout: setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('Expected WSS relay message not received'));
      }, 3000) }; waiters.push(waiter);
    });
  };
  if (credentials) ws.send(JSON.stringify({ type: 'auth', v: 1, ...credentials }));
  return { ws, next };
}

try {
  await assert.rejects(() => request('/health', { trusted: false }), error =>
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(error.code));
  assert.equal((await request('/health')).status, 200);
  const settings = JSON.parse((await request('/api/config')).body);
  const page = await request('/'); assert.equal(page.status, 200);
  if (settings.editorAccess === 'private') {
    assert.ok(page.body.includes('This editor is private.')); assert.ok(!page.body.includes('<iframe'));
    for (const path of ['/editor.html', '/klecks/embed.js', '/klecks%2fembed.js', '/presenter.js']) assert.equal((await request(path)).status, 403);
  } else assert.ok(page.body.includes('Start live session'));
  assert.ok(page.headers['content-security-policy'].includes(config.origin.replace(/^https/, 'wss')));
  assert.ok((await request('/watch/00000000-0000-0000-0000-000000000000')).body.includes('Fullscreen'));
  console.log('PASS: verified HTTPS certificate chain and hostname; default trust rejects test CA');

  const signedIn = await request('/api/presenter-access', { method: 'POST', key: hostKey, remembered: true });
  assert.equal(signedIn.status, 200);
  assert.match(signedIn.headers['set-cookie'][0], /^__Host-live-draw-presenter=.*; Path=\/; HttpOnly; SameSite=Strict; Secure; Max-Age=2592000$/);
  const cookie = signedIn.headers['set-cookie'][0].split(';')[0];
  assert.equal(JSON.parse((await request('/api/presenter-access', { cookie })).body).authorized, true);
  const presenterPage = await request('/present', { cookie });
  assert.equal(presenterPage.status, 200); assert.ok(presenterPage.body.includes('Start live session'));
  assert.ok(presenterPage.body.includes('Remember this device')); assert.ok(presenterPage.body.includes('Forget this device'));
  assert.ok((await request('/presenter.js', { cookie })).body.includes("'/api/presenter-access'"));
  assert.ok((await request('/editor.html', { cookie })).body.includes('/klecks/embed.js'));
  assert.ok((await request('/klecks/embed.js', { cookie })).body.includes('subscribeViewport'));
  const rememberedSession = await request('/api/sessions', { method: 'POST', cookie });
  assert.equal(rememberedSession.status, 201);
  const rememberedPresenter = await connect(auth(JSON.parse(rememberedSession.body), 'presenter'));
  await rememberedPresenter.next(message => message.type === 'ready');
  rememberedPresenter.ws.send(JSON.stringify({ type: 'stop' }));
  await rememberedPresenter.next(message => message.type === 'ended');
  assert.equal((await request('/api/presenter-access', { method: 'DELETE', cookie })).status, 200);
  assert.equal((await request('/api/sessions', { method: 'POST', cookie })).status, 403);
  if (settings.editorAccess === 'private') assert.equal((await request('/klecks/embed.js', { cookie })).status, 403);
  console.log(`PASS: ${settings.editorAccess} editor access, authenticated packaged editor and public read-only viewer page`);
  console.log('PASS: remembered presenter access, protected cookie, password-free session creation and server-side revocation over HTTPS');

  assert.equal((await request('/api/sessions', { method: 'POST', key: 'wrong' })).status, 403);
  assert.equal((await request('/api/sessions', { method: 'POST', key: hostKey, origin: 'https://unrelated.example' })).status, 403);
  const created = await request('/api/sessions', { method: 'POST', key: hostKey });
  assert.equal(created.status, 201); const session = JSON.parse(created.body);
  const presenter = await connect(auth(session, 'presenter'));
  const ready = await presenter.next(message => message.type === 'ready');
  const viewer = await connect(auth(session, 'viewer'));
  await viewer.next(message => message.type === 'ready');
  presenter.ws.send(encodeFrame({ epoch: ready.epoch, seq: 1, width: 1, height: 1, mime: 'image/png' }, png));
  assert.equal(decodeFrame((await viewer.next(message => message.binary)).data).header.seq, 1);
  const late = await connect(auth(session, 'viewer')); await late.next(message => message.type === 'ready');
  assert.equal(decodeFrame((await late.next(message => message.binary)).data).header.seq, 1);
  console.log('PASS: protected session creation, WSS frame delivery and late joins');

  const closed = once(late.ws, 'close');
  late.ws.send(JSON.stringify({ type: 'stop' })); assert.equal((await closed)[0], 1008);
  presenter.ws.send(JSON.stringify({ type: 'stop' }));
  await viewer.next(message => message.type === 'ended');
  console.log('PASS: read-only viewer and explicit session shutdown over WSS');
} finally {
  for (const ws of sockets) ws.terminate();
  if (isolated) await isolated.close();
}
