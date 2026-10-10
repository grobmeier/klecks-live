import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import { createApplication } from '../server/app.mjs';
import { configuration } from '../server/config.mjs';
import { directory, load } from './lan-config.mjs';

try {
  const config = await load();
  const cert = await readFile(directory + 'server.pem');
  if (new Date(new X509Certificate(cert).validTo) <= new Date()) throw new Error('LAN test certificate has expired. Prepare a new test setup.');
  const key = await readFile(directory + 'server-key.pem');
  const hostKey = (await readFile(directory + 'host-key.txt', 'utf8')).trim();
  const app = createApplication(configuration({
    HOST: config.address, PORT: String(config.port), PUBLIC_ORIGIN: config.origin, HOST_ACCESS_KEY: hostKey,
    ...(process.env.EDITOR_ACCESS !== undefined ? { EDITOR_ACCESS: process.env.EDITOR_ACCESS } : {}),
  }), listener => https.createServer({ key, cert, minVersion: 'TLSv1.2' }, listener));
  await app.listen();
  console.log(`Live Draw LAN test: ${app.origin}`);
  console.log('Host key: copy locally from .local-test/host-key.txt. Export drawings before stopping this process.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
} catch (error) { console.error(error.message); process.exitCode = 1; }
