import http from 'node:http';
import https from 'node:https';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { decodeFrame, imageDimensions, HEADER_LIMIT, VERSION } from '../public/protocol.js';
import { configuration } from './config.mjs';
import { PresenterAccess } from './presenter-access.mjs';

const digest = value => createHash('sha256').update(value).digest();
const matches = (value, hash) => typeof value === 'string' && value.length <= 256 && timingSafeEqual(digest(value), hash);
const secret = () => randomBytes(32).toString('base64url');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.woff2': 'font/woff2', '.json': 'application/json' };
// Keep the viewer and sign-in surface small. All other static files require
// presenter access in private mode, including future editor bundles.
const PUBLIC_FILES = new Set(['/login.html', '/login.js', '/viewer.html', '/viewer.js', '/protocol.js', '/style.css', '/logo.svg', '/LICENSE', '/UPSTREAM_LICENSE', '/klecks/LICENSE']);

export function createApplication(overrides = {}, createServer = http.createServer) {
  const config = { ...configuration({}), ...overrides, editorAccess: overrides.editorAccess ?? (overrides.hostKey ? 'private' : 'public') };
  if (!['private', 'public'].includes(config.editorAccess)) throw new Error('EDITOR_ACCESS must be private or public');
  if (config.editorAccess === 'private' && !config.hostKey) throw new Error('Private editor access requires HOST_ACCESS_KEY');
  const sessions = new Map();
  const attempts = new Map();
  let origin = config.publicOrigin;
  const presenterAccess = new PresenterAccess(config, () => origin);
  const root = resolve(fileURLToPath(config.staticDir));
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxFrameBytes + HEADER_LIMIT + 4, perMessageDeflate: false });
  const hostHash = digest(config.hostKey);
  const headers = {
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  const json = (res, status, value, extraHeaders = {}) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json', ...extraHeaders }); res.end(JSON.stringify(value)); };
  const send = (socket, data, binary = false) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > config.maxQueuedBytes) { socket.terminate(); return; }
    socket.send(binary ? data : JSON.stringify(data), { binary });
  };
  const status = session => ({ type: 'status', v: VERSION, epoch: session.epoch, state: session.state, viewers: session.viewers.size, expiresAt: session.expiresAt });
  const broadcastStatus = session => { const message = status(session); for (const socket of session.viewers) send(socket, message); if (session.presenter) send(session.presenter, message); };
  const end = (session, reason) => {
    sessions.delete(session.id);
    session.frame = undefined;
    for (const socket of [...session.viewers, session.presenter].filter(Boolean)) {
      send(socket, { type: 'ended', reason }); socket.close(1000, 'Session ended');
    }
    session.viewers.clear(); session.presenter = undefined;
  };
  const limited = req => {
    const key = req.socket.remoteAddress;
    const now = Date.now();
    let entry = attempts.get(key);
    if (!entry && attempts.size >= 4096) return true;
    if (!entry || entry.until < now) { entry = { count: 0, until: now + 60000 }; attempts.set(key, entry); }
    return ++entry.count > 60;
  };
  const expire = () => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (now >= session.expiresAt || (!session.presenter && now - session.disconnectedAt >= config.reconnectGraceMs)) end(session, 'expired');
    }
    for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
    presenterAccess.expire();
  };
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/health' && req.method === 'GET') return json(res, 200, { status: 'ok' });
      if (req.url === '/api/config' && req.method === 'GET') return json(res, 200, { v: VERSION, hostKeyRequired: !!config.hostKey, editorAccess: config.editorAccess, fps: config.fps, maxEdge: config.maxImageEdge, maxFrameBytes: config.maxFrameBytes });
      if (req.url === '/api/presenter-access') {
        if (req.method === 'GET') return json(res, 200, presenterAccess.status(req));
        if (!['POST', 'DELETE'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
        req.resume();
        if (req.headers.origin !== origin) return json(res, 403, { error: 'Origin not allowed' });
        if (limited(req)) return json(res, 429, { error: 'Too many attempts' });
        if (req.method === 'DELETE') return json(res, 200, { authorized: !config.hostKey }, { 'Set-Cookie': presenterAccess.forget(req) });
        if (!config.hostKey) return json(res, 200, presenterAccess.status(req));
        if (!presenterAccess.supported) return json(res, 403, { error: 'Presenter sign-in requires HTTPS' });
        if (!matches(req.headers['x-host-key'], hostHash)) return json(res, 403, { error: 'Host access key required' });
        const grant = presenterAccess.grant(req, req.headers['x-remember-device'] === 'true');
        if (!grant) return json(res, 503, { error: 'Presenter device limit reached. Try again later or ask the server operator.' });
        return json(res, 200, grant.status, { 'Set-Cookie': grant.cookie });
      }
      if (req.url === '/api/sessions' && req.method === 'POST') {
        req.resume();
        if (req.headers.origin !== origin) return json(res, 403, { error: 'Origin not allowed' });
        if (limited(req)) return json(res, 429, { error: 'Too many attempts' });
        if (config.hostKey && !presenterAccess.status(req).authorized && !matches(req.headers['x-host-key'], hostHash)) return json(res, 403, { error: 'Host access key required' });
        expire();
        if (sessions.size >= config.maxSessions) return json(res, 503, { error: 'Session limit reached' });
        const presenterToken = secret(), viewerToken = secret();
        const session = { id: randomUUID(), presenterHash: digest(presenterToken), viewerHash: digest(viewerToken), epoch: randomUUID(), frame: undefined, seq: 0, presenter: undefined, viewers: new Set(), state: 'waiting', expiresAt: Date.now() + config.sessionLifetimeMs, disconnectedAt: Date.now(), lastFrameAt: 0, frameTokens: 2 };
        sessions.set(session.id, session);
        return json(res, 201, { id: session.id, presenterToken, viewerToken, expiresAt: session.expiresAt });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
      if (!req.url.startsWith('/')) return json(res, 400, { error: 'Invalid request path' });
      // Incoming request targets are paths; a leading // must not be parsed as
      // a URL authority and silently routed to the root page.
      const pathname = decodeURIComponent(new URL('http://local.invalid' + req.url).pathname);
      let mapped = pathname === '/' || pathname === '/present' ? '/index.html' : /^\/watch\/[a-f0-9-]{36}$/.test(pathname) ? '/viewer.html' : pathname;
      let path = resolve(root, '.' + mapped);
      if (!path.startsWith(root + sep)) return json(res, 404, { error: 'Not found' });
      // Gate the canonical file path, not just the URL spelling. Encoded slashes,
      // dot segments and direct file requests must follow the same access rule.
      const canonical = '/' + path.slice(root.length + 1).split(sep).join('/');
      if (config.editorAccess === 'private' && !presenterAccess.status(req).authorized && !PUBLIC_FILES.has(canonical)) {
        if (canonical !== '/index.html') return json(res, 403, { error: 'Presenter access required' });
        mapped = '/login.html'; path = resolve(root, '.' + mapped);
      }
      const fileStat = await stat(path);
      if (!fileStat.isFile() || fileStat.size > 16 * 1024 * 1024) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, { ...headers, 'Content-Type': MIME[extname(path)] || 'application/octet-stream', 'Content-Length': fileStat.size });
      res.end(req.method === 'HEAD' ? undefined : await readFile(path));
    } catch (error) {
      if (!res.headersSent) json(res, error.code === 'ENOENT' ? 404 : 400, { error: 'Request unavailable' });
      else res.end();
    }
  });
  server.maxConnections = config.maxSessions * (config.maxViewers + 1) + 50;
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/socket' || req.headers.origin !== origin || limited(req) || wss.clients.size >= config.maxSessions * (config.maxViewers + 1) + 10) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', socket => {
    let session, role;
    socket.alive = true;
    socket.on('pong', () => { socket.alive = true; });
    socket.on('error', () => {});
    const timeout = setTimeout(() => socket.close(1008, 'Authentication required'), config.authTimeoutMs);
    timeout.unref();
    socket.on('message', (data, binary) => {
      try {
        if (!session) {
          if (binary || data.length > 2048) throw new Error('Invalid authentication');
          const message = JSON.parse(data.toString());
          if (message.type !== 'auth' || message.v !== VERSION || !['presenter', 'viewer'].includes(message.role)) throw new Error('Invalid authentication');
          expire();
          const candidate = sessions.get(message.id);
          if (!candidate || !matches(message.token, message.role === 'presenter' ? candidate.presenterHash : candidate.viewerHash)) throw new Error('Session unavailable');
          role = message.role;
          if (role === 'presenter' && candidate.presenter?.readyState === WebSocket.OPEN) throw new Error('Presenter already connected');
          if (role === 'viewer' && candidate.viewers.size >= config.maxViewers) { send(socket, { type: 'unavailable', reason: 'capacity' }); socket.close(1008, 'Viewer capacity reached'); return; }
          session = candidate;
          clearTimeout(timeout);
          if (role === 'presenter') {
            session.presenter = socket; session.epoch = randomUUID(); session.seq = 0; session.frame = undefined; session.lastFrameAt = Date.now(); session.frameTokens = 2; session.state = 'waiting';
          } else session.viewers.add(socket);
          send(socket, { ...status(session), type: 'ready' });
          if (role === 'viewer' && session.frame) send(socket, session.frame, true);
          broadcastStatus(session);
          return;
        }
        if (!sessions.has(session.id)) throw new Error('Session ended');
        if (role !== 'presenter' || session.presenter !== socket) throw new Error('Viewer is read-only');
        if (Date.now() >= session.expiresAt) { end(session, 'expired'); return; }
        if (binary) {
          const { header, image } = decodeFrame(data, config.maxFrameBytes, config.maxImageEdge);
          const dimensions = imageDimensions(image, header.mime);
          if (dimensions.width !== header.width || dimensions.height !== header.height || header.epoch !== session.epoch || header.seq <= session.seq) throw new Error('Invalid frame');
          // A two-frame burst tolerates scheduling jitter; the refill bounds the sustained rate.
          const now = Date.now();
          session.frameTokens = Math.min(2, session.frameTokens + (now - session.lastFrameAt) * config.fps / 1000);
          session.lastFrameAt = now;
          if (session.frameTokens < 1) return;
          session.frameTokens--; session.seq = header.seq; session.frame = Buffer.from(data);
          const stateChanged = session.state !== 'live'; session.state = 'live';
          if (stateChanged) broadcastStatus(session);
          for (const viewer of session.viewers) send(viewer, session.frame, true);
        } else {
          if (data.length > 2048) throw new Error('Invalid command');
          const message = JSON.parse(data.toString());
          if (message.type === 'stop') end(session, 'stopped');
          else if (message.type === 'pause') { session.state = 'paused'; broadcastStatus(session); }
          else if (message.type === 'resume') { session.state = 'waiting'; session.frame = undefined; session.lastFrameAt = Date.now(); session.frameTokens = 1; broadcastStatus(session); }
          else throw new Error('Invalid command');
        }
      } catch { socket.close(1008, 'Connection rejected'); }
    });
    socket.on('close', () => {
      clearTimeout(timeout);
      if (!session || !sessions.has(session.id)) return;
      if (role === 'presenter' && session.presenter === socket) { session.presenter = undefined; session.state = 'paused'; session.disconnectedAt = Date.now(); }
      if (role === 'viewer') session.viewers.delete(socket);
      broadcastStatus(session);
    });
  });
  const sweep = setInterval(expire, 50); sweep.unref();
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.alive) { socket.terminate(); continue; }
      socket.alive = false; socket.ping();
    }
  }, 15000); heartbeat.unref();
  return {
    config, server, sessions, wss,
    get origin() { return origin; },
    async listen() {
      await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolveListen); });
      origin ||= `${server instanceof https.Server ? 'https' : 'http'}://${config.host.includes(':') ? '[' + config.host + ']' : config.host}:${server.address().port}`;
      // Some browsers require the WebSocket scheme to be listed explicitly.
      headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace("connect-src 'self'", `connect-src 'self' ${origin.replace(/^http/, 'ws')}`);
      return origin;
    },
    async close() {
      clearInterval(sweep); clearInterval(heartbeat);
      presenterAccess.clear();
      for (const session of [...sessions.values()]) end(session, 'server-stopped');
      for (const socket of wss.clients) socket.terminate();
      await new Promise(resolveClose => wss.close(resolveClose));
      await new Promise(resolveClose => server.close(resolveClose));
    },
  };
}
