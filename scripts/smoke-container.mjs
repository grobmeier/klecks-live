import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { WebSocket } from 'ws';
import { encodeFrame, decodeFrame, socketProtocols } from '../public/protocol.js';

const execute = promisify(execFile);
const image = process.argv[2] || 'klecks-live:local';
const name = `live-draw-smoke-${randomBytes(6).toString('hex')}`;
const hostKey = randomBytes(32).toString('hex');
const sockets = new Set();
const docker = (args, options = {}) => execute('docker', args, { timeout: 30000, maxBuffer: 1024 * 1024, ...options });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY7sAAAAASUVORK5CYII=', 'base64');

// Reserve a loopback port briefly. A competing bind causes docker run to fail.
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
// Exercise the private HTTP backend with the HTTPS proxy's configured origin.
const publicOrigin = 'https://draw.example.org';
const auth = (session, role) => ({ id: session.id, role, token: session[role === 'presenter' ? 'presenterToken' : 'viewerToken'] });

async function closedSocket(ws) {
  const timeout = setTimeout(() => ws.terminate(), 5000);
  try { return await once(ws, 'close'); } finally { clearTimeout(timeout); }
}

async function connect(credentials) {
  const ws = new WebSocket(origin.replace(/^http/, 'ws') + '/socket', socketProtocols(credentials || {}), { headers: { Origin: publicOrigin } });
  sockets.add(ws);
  const messages = [], waiters = [];
  ws.on('error', () => {});
  ws.on('message', (data, binary) => {
    const message = binary ? { binary: true, data } : JSON.parse(data.toString());
    const index = waiters.findIndex(waiter => waiter.predicate(message));
    if (index < 0) messages.push(message);
    else {
      const waiter = waiters.splice(index, 1)[0];
      clearTimeout(waiter.timeout); waiter.resolve(message);
    }
  });
  const timeout = setTimeout(() => ws.terminate(), 5000);
  try { await once(ws, 'open'); } finally { clearTimeout(timeout); }
  const next = (predicate = () => true) => {
    const index = messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timeout: setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(new Error('Expected container relay message not received'));
      }, 3000) };
      waiters.push(waiter);
    });
  };
  if (credentials) ws.send(JSON.stringify({ type: 'auth', v: 1, ...credentials }));
  return { ws, next };
}

async function waitHealthy() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(origin + '/health', { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* Wait for the task-owned container only. */ }
    await delay(200);
  }
  throw new Error('Container did not become available');
}

try {
  // Pass the generated key through the child environment, never command arguments.
  await docker(['run', '--detach', '--name', name, '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--pids-limit', '64', '--init',
    '--publish', `127.0.0.1:${port}:5055`, '--env', 'PUBLIC_ORIGIN', '--env', 'HOST_ACCESS_KEY',
    '--env', 'EDITOR_ACCESS=private',
    '--health-interval', '1s', image], { env: { ...process.env, PUBLIC_ORIGIN: publicOrigin, HOST_ACCESS_KEY: hostKey } });
  await waitHealthy();

  const inspect = JSON.parse((await docker(['inspect', '--format',
    '{"user":{{json .Config.User}},"readOnly":{{json .HostConfig.ReadonlyRootfs}},"memory":{{json .HostConfig.Memory}},"swap":{{json .HostConfig.MemorySwap}},"cpu":{{json .HostConfig.NanoCpus}},"pids":{{json .HostConfig.PidsLimit}},"capDrop":{{json .HostConfig.CapDrop}},"security":{{json .HostConfig.SecurityOpt}},"init":{{json .HostConfig.Init}},"ports":{{json .NetworkSettings.Ports}}}', name])).stdout);
  assert.equal(inspect.user, '1000:1000'); assert.equal(inspect.readOnly, true);
  assert.equal(inspect.memory, 256 * 1024 * 1024); assert.equal(inspect.init, true);
  assert.equal(inspect.swap, inspect.memory); assert.equal(inspect.cpu, 1e9); assert.equal(inspect.pids, 64);
  assert.ok(inspect.capDrop.includes('ALL')); assert.ok(inspect.security.includes('no-new-privileges'));
  assert.equal(inspect.ports['5055/tcp'][0].HostIp, '127.0.0.1');
  assert.equal((await docker(['exec', name, '/nodejs/bin/node', '-e', 'console.log(process.getuid())'])).stdout.trim(), '1000');
  console.log('PASS: non-root container with read-only filesystem and resource bounds');

  const anonymous = await fetch(origin + '/');
  assert.equal(anonymous.status, 200); assert.ok((await anonymous.text()).includes('id="login-form"'));
  assert.equal((await fetch(origin + '/klecks/embed.js')).status, 403);
  const signedIn = await fetch(origin + '/api/presenter-access', { method: 'POST', headers: { Origin: publicOrigin, 'X-Host-Key': hostKey } });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.get('set-cookie').split(';')[0];

  for (const [path, expected] of [
    ['/', 'Start live session'], ['/editor.html', '/klecks/embed.js'],
    ['/watch/00000000-0000-0000-0000-000000000000', 'Fullscreen'],
    ['/klecks/embed.js', 'subscribeViewport'], ['/LICENSE', 'MIT License'],
    ['/UPSTREAM_LICENSE', 'Copyright'],
  ]) {
    const response = await fetch(origin + path, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok((await response.text()).includes(expected), path);
  }
  const configResponse = await fetch(origin + '/api/config');
  assert.equal(configResponse.status, 200);
  assert.ok(configResponse.headers.get('content-security-policy').includes(publicOrigin.replace(/^http/, 'ws')));
  console.log('PASS: built presenter, viewer, patched editor, licences and configuration');
  assert.equal((await fetch(origin + '/api/presenter-access', { method: 'DELETE', headers: { Origin: publicOrigin, Cookie: cookie } })).status, 200);
  assert.equal((await fetch(origin + '/editor.html', { headers: { Cookie: cookie } })).status, 403);

  const create = key => fetch(origin + '/api/sessions', {
    method: 'POST', headers: { Origin: publicOrigin, 'X-Host-Key': key },
  });
  assert.equal((await create('wrong')).status, 403);
  const created = await create(hostKey); assert.equal(created.status, 201);
  const session = await created.json();
  const presenter = await connect(auth(session, 'presenter'));
  const ready = await presenter.next(message => message.type === 'ready');
  const viewer = await connect(auth(session, 'viewer'));
  await viewer.next(message => message.type === 'ready');
  presenter.ws.send(encodeFrame({ epoch: ready.epoch, seq: 1, width: 1, height: 1, mime: 'image/png' }, png));
  assert.equal(decodeFrame((await viewer.next(message => message.binary)).data).header.seq, 1);
  const late = await connect(auth(session, 'viewer'));
  await late.next(message => message.type === 'ready');
  assert.equal(decodeFrame((await late.next(message => message.binary)).data).header.seq, 1);
  console.log('PASS: protected session creation, real WebSocket frame delivery and late joins');

  const closed = closedSocket(late.ws);
  late.ws.send(JSON.stringify({ type: 'stop' }));
  assert.equal((await closed)[0], 1008);
  presenter.ws.send(JSON.stringify({ type: 'stop' }));
  await viewer.next(message => message.type === 'ended');
  await assert.rejects(() => connect(auth(session, 'viewer')), /403/);
  console.log('PASS: viewer cannot stop sharing; presenter stop invalidates the session');

  for (let attempt = 0; attempt < 10; attempt++) {
    const status = (await docker(['inspect', '--format', '{{.State.Health.Status}}', name])).stdout.trim();
    if (status === 'healthy') break;
    assert.notEqual(status, 'unhealthy');
    assert.ok(attempt < 9, 'Docker health check did not become healthy');
    await delay(500);
  }
  await docker(['stop', '--time', '5', name]);
  assert.equal((await docker(['inspect', '--format', '{{.State.ExitCode}}', name])).stdout.trim(), '0');
  console.log('PASS: Docker health check and graceful shutdown');
} finally {
  for (const ws of sockets) ws.terminate();
  // Remove only the uniquely named container created by this run.
  await docker(['rm', '--force', name]).catch(error => {
    if (!error.stderr?.includes('No such container')) throw error;
  });
}
