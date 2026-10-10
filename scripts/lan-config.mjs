import { networkInterfaces } from 'node:os';
import { isIPv4 } from 'node:net';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const directory = fileURLToPath(new URL('../.local-test/', import.meta.url));
export const localAddress = address => isIPv4(address) &&
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
export const addresses = () => Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
  entries.filter(entry => entry.family === 'IPv4' && !entry.internal && localAddress(entry.address))
    .map(entry => ({ name, address: entry.address })));

export async function load() {
  const config = JSON.parse(await readFile(directory + 'config.json', 'utf8'));
  if (!localAddress(config.address) || !addresses().some(entry => entry.address === config.address)) {
    throw new Error('The prepared LAN address is no longer assigned to this Mac. Prepare a new test certificate for the current address.');
  }
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535 ||
      config.origin !== `https://${config.address}:${config.port}`) throw new Error('Invalid LAN test configuration');
  return config;
}
