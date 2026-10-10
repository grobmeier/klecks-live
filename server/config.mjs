function integer(env, name, fallback, min, max) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
export function configuration(env = process.env) {
  const host = env.HOST || '127.0.0.1';
  const publicOrigin = env.PUBLIC_ORIGIN || '';
  const hostKey = env.HOST_ACCESS_KEY || '';
  const editorAccess = env.EDITOR_ACCESS ?? (hostKey ? 'private' : 'public');
  if (!['private', 'public'].includes(editorAccess)) throw new Error('EDITOR_ACCESS must be private or public');
  if (editorAccess === 'private' && !hostKey) throw new Error('Private editor access requires HOST_ACCESS_KEY');
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(host);
  if (!loopback && (!publicOrigin || hostKey.length < 32)) throw new Error('Network binding requires PUBLIC_ORIGIN and a HOST_ACCESS_KEY of at least 32 characters');
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== publicOrigin) throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin without a trailing slash');
  }
  return {
    host, publicOrigin, hostKey, editorAccess,
    port: integer(env, 'PORT', 5055, 0, 65535),
    maxSessions: integer(env, 'MAX_SESSIONS', 10, 1, 100),
    maxViewers: integer(env, 'MAX_VIEWERS', 25, 1, 100),
    maxFrameBytes: integer(env, 'MAX_FRAME_BYTES', 2097152, 1024, 8388608),
    maxImageEdge: integer(env, 'MAX_IMAGE_EDGE', 1600, 128, 4096),
    fps: integer(env, 'FRAME_RATE', 10, 1, 30),
    sessionLifetimeMs: integer(env, 'SESSION_LIFETIME_MS', 14400000, 100, 86400000),
    reconnectGraceMs: integer(env, 'RECONNECT_GRACE_MS', 120000, 50, 600000),
    presenterAccessLifetimeMs: 8 * 60 * 60 * 1000,
    presenterRememberLifetimeMs: 30 * 24 * 60 * 60 * 1000,
    maxPresenterDevices: 128,
    authTimeoutMs: 5000,
    maxQueuedBytes: 3145728,
    staticDir: new URL('../dist/', import.meta.url),
  };
}
