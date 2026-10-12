import { secureOrigin } from '../public/protocol.js';
import { randomBytes, createHash } from 'node:crypto';

const hash = token => createHash('sha256').update(token).digest('hex');
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

// Device logins deliberately share the relay's in-memory lifetime. A restart
// invalidates them, just as it invalidates live-session capabilities.
export class PresenterAccess {
  #devices = new Map();
  constructor(config, origin) { this.config = config; this.origin = origin; }
  get secure() { return new URL(this.origin()).protocol === 'https:'; }
  get supported() { return secureOrigin(this.origin()); }
  get cookieName() { return this.secure ? '__Host-live-draw-presenter' : 'live-draw-presenter'; }
  cookie(token, maxAge) {
    return `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict${this.secure ? '; Secure' : ''}${maxAge === undefined ? '' : `; Max-Age=${maxAge}`}`;
  }
  token(req) {
    const values = (req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(this.cookieName + '='));
    if (values.length !== 1) return undefined;
    const value = values[0].slice(this.cookieName.length + 1);
    return tokenPattern.test(value) ? value : undefined;
  }
  expire() {
    const now = Date.now();
    for (const [key, device] of this.#devices) if (now >= device.expiresAt) this.#devices.delete(key);
  }
  status(req) {
    if (!this.config.hostKey) return { authorized: true, remembered: false };
    const token = this.token(req);
    const device = token && this.#devices.get(hash(token));
    if (!device || Date.now() >= device.expiresAt || !this.supported) return { authorized: false };
    return { authorized: true, remembered: device.remembered, expiresAt: device.expiresAt };
  }
  grant(req, remembered) {
    this.expire();
    const previous = this.token(req);
    const previousHash = previous && hash(previous);
    if (this.#devices.size >= this.config.maxPresenterDevices && !this.#devices.has(previousHash)) return undefined;
    if (previousHash) this.#devices.delete(previousHash);
    const token = randomBytes(32).toString('base64url');
    const lifetime = remembered ? this.config.presenterRememberLifetimeMs : this.config.presenterAccessLifetimeMs;
    const device = { remembered, expiresAt: Date.now() + lifetime };
    this.#devices.set(hash(token), device);
    return { status: { authorized: true, ...device }, cookie: this.cookie(token, remembered ? Math.ceil(lifetime / 1000) : undefined) };
  }
  forget(req) {
    const token = this.token(req);
    if (token) this.#devices.delete(hash(token));
    return this.cookie('', 0);
  }
  clear() { this.#devices.clear(); }
}
