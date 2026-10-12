export const VERSION = 1;
export const HEADER_LIMIT = 2048;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function encodeFrame(header, image) {
  const json = encoder.encode(JSON.stringify({ v: VERSION, ...header }));
  if (json.length > HEADER_LIMIT) throw new Error('Frame header too large');
  const bytes = image instanceof Uint8Array ? image : new Uint8Array(image);
  const result = new Uint8Array(4 + json.length + bytes.length);
  new DataView(result.buffer).setUint32(0, json.length);
  result.set(json, 4);
  result.set(bytes, 4 + json.length);
  return result;
}

export function decodeFrame(input, maxBytes = 2 * 1024 * 1024, maxEdge = 4096) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 5 || bytes.length > maxBytes + HEADER_LIMIT + 4) throw new Error('Invalid frame size');
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (!n || n > HEADER_LIMIT || n + 4 >= bytes.length) throw new Error('Invalid frame header');
  const header = JSON.parse(decoder.decode(bytes.subarray(4, n + 4)));
  if (header.v !== VERSION || typeof header.epoch !== 'string' || header.epoch.length > 64 ||
      !Number.isSafeInteger(header.seq) || header.seq < 1 ||
      !Number.isInteger(header.width) || !Number.isInteger(header.height) ||
      header.width < 1 || header.height < 1 || header.width > maxEdge || header.height > maxEdge ||
      !['image/png', 'image/webp'].includes(header.mime)) throw new Error('Invalid frame metadata');
  const image = bytes.subarray(n + 4);
  if (image.length > maxBytes) throw new Error('Image too large');
  return { header, image };
}

/** Validate encoded dimensions, not just presenter-supplied dimensions. */
export function imageDimensions(bytes, mime) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (mime === 'image/png' && bytes.length >= 33 &&
      bytes[0] === 137 && ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mime === 'image/webp' && bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    if (chunk === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42)
      return { width: view.getUint16(26, true) & 16383, height: view.getUint16(28, true) & 16383 };
    if (chunk === 'VP8L' && bytes[20] === 47) {
      const bits = view.getUint32(21, true);
      return { width: (bits & 16383) + 1, height: ((bits >>> 14) & 16383) + 1 };
    }
  }
  throw new Error('Unsupported image encoding');
}

// Capabilities travel in an HTTPS upgrade header, never in the request URL.
export function socketProtocols(auth) {
  const encoded = encodeURIComponent(JSON.stringify({ type: 'auth', v: VERSION, ...auth }))
    .replace(/[!'()*]/g, character => '%' + character.charCodeAt(0).toString(16));
  return [`live-draw.v${VERSION}`, `live-draw-auth.${encoded}`];
}

export function socketAuthentication(header) {
  if (typeof header !== 'string' || header.length > 8192) throw new Error('Invalid socket authentication');
  const protocols = header.split(',').map(value => value.trim());
  if (protocols.length !== 2 || protocols[0] !== `live-draw.v${VERSION}` || !protocols[1].startsWith('live-draw-auth.')) throw new Error('Invalid socket authentication');
  const json = decodeURIComponent(protocols[1].slice('live-draw-auth.'.length));
  if (encoder.encode(json).length > 2048) throw new Error('Invalid socket authentication');
  const auth = JSON.parse(json);
  if (auth.type !== 'auth' || auth.v !== VERSION || !['presenter', 'viewer'].includes(auth.role)) throw new Error('Invalid socket authentication');
  return auth;
}
