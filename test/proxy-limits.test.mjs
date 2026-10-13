import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../server/app.mjs';
const password = 'synthetic-proxy-test-password-123456789';

test('one client exhausting password attempts behind a trusted proxy does not block another login', async t => {
  const app = createApplication({ port: 0, hostKey: password, trustedProxyAddresses: ['127.0.0.1'] });
  await app.listen(); t.after(() => app.close());
  const login = (client, key) => fetch(app.origin + '/api/presenter-access', { method: 'POST', headers: { Origin: app.origin, 'X-Real-IP': client, 'X-Host-Key': key } });
  let blocked;
  for (let i = 0; i < 65; i++) blocked = await login('198.51.100.10', 'wrong');
  assert.equal(blocked.status, 429);
  assert.equal((await login('198.51.100.11', password)).status, 200);
});

test('trusted proxy failures are isolated and untrusted forwarding headers cannot evade limits', async t => {
  for (const trusted of [true, false]) {
    const app = createApplication({ port: 0, hostKey: password, trustedProxyAddresses: trusted ? ['127.0.0.1'] : [] });
    await app.listen(); t.after(() => app.close());
    let response;
    for (let i = 0; i < 65; i++) response = await fetch(app.origin + '/api/presenter-access', { method: 'POST', headers: { Origin: app.origin, 'X-Real-IP': trusted ? '198.51.100.10' : `198.51.100.${i + 1}`, 'X-Host-Key': 'wrong' } });
    assert.equal(response.status, 429);
    response = await fetch(app.origin + '/api/presenter-access', { method: 'POST', headers: { Origin: app.origin, 'X-Real-IP': '198.51.100.200', 'X-Host-Key': 'wrong' } });
    assert.equal(response.status, trusted ? 403 : 429);
  }
});

test('password failures and anonymous upgrades cannot consume authorized session or reconnect budgets', async t => {
  const { WebSocket } = await import('ws');
  const { socketProtocols } = await import('../public/protocol.js');
  const app = createApplication({ port: 0, hostKey: password });
  await app.listen(); t.after(() => app.close());
  const login = await fetch(app.origin + '/api/presenter-access', { method: 'POST', headers: { Origin: app.origin, 'X-Host-Key': password } });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  for (let i = 0; i < 65; i++) {
    await fetch(app.origin + '/api/presenter-access', { method: 'POST', headers: { Origin: app.origin, 'X-Host-Key': 'wrong' } });
    await new Promise(resolve => {
      const socket = new WebSocket(app.origin.replace(/^http/, 'ws') + '/socket', { headers: { Origin: app.origin } });
      socket.on('error', () => {});
      socket.once('unexpected-response', (_, response) => { response.resume(); socket.terminate(); resolve(); });
    });
  }
  const created = await fetch(app.origin + '/api/sessions', { method: 'POST', headers: { Origin: app.origin, Cookie: cookie } });
  assert.equal(created.status, 201); const session = await created.json();
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(app.origin.replace(/^http/, 'ws') + '/socket', socketProtocols({ id: session.id, role: 'viewer', token: session.viewerToken }), { headers: { Origin: app.origin } });
    socket.on('error', reject); socket.once('open', () => { socket.terminate(); resolve(); });
  });
  assert.equal((await fetch(app.origin + '/api/presenter-access', { method: 'DELETE', headers: { Origin: app.origin, Cookie: cookie } })).status, 200);
});

test('trusted proxy metadata must be a single IP and proxy allowlists reject hostnames', async t => {
  assert.throws(() => createApplication({ trustedProxyAddresses: ['untrusted.example'] }), /IP addresses/);
  const app = createApplication({ port: 0, hostKey: password, trustedProxyAddresses: ['127.0.0.1'] });
  await app.listen(); t.after(() => app.close());
  const response = await fetch(app.origin + '/api/presenter-access', { method: 'POST', headers: { Origin: app.origin, 'X-Real-IP': '198.51.100.1, 198.51.100.2', 'X-Host-Key': password } });
  assert.equal(response.status, 400);
});
