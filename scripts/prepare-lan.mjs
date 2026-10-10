import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { directory, addresses, localAddress } from './lan-config.mjs';

process.umask(0o077);
const available = addresses();
const address = process.argv[2] || available.find(entry => entry.name === 'en0')?.address ||
  (available.length === 1 ? available[0].address : undefined);
const port = Number(process.argv[3] || 8443);
if (!localAddress(address) || !available.some(entry => entry.address === address)) {
  throw new Error('Choose an assigned private IPv4 address: npm run prepare:lan -- ADDRESS [PORT]');
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port between 1024 and 65535');
await mkdir(directory, { mode: 0o700 }); // Refuse to replace certificates already installed on a device.
const id = randomUUID();
const displayName = `Live Draw iPad Test ${id.slice(0, 8)}`;
const openssl = args => execFileSync('openssl', args, { cwd: directory, stdio: 'pipe' });
const xml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));

try {
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-noenc', '-days', '7', '-sha256',
    '-keyout', 'ca-key.pem', '-out', 'root-ca.pem', '-subj', `/CN=${displayName}`,
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  openssl(['req', '-new', '-newkey', 'rsa:2048', '-noenc', '-sha256',
    '-keyout', 'server-key.pem', '-out', 'server.csr', '-subj', '/CN=Live Draw LAN Test']);
  await writeFile(directory + 'server.ext', [
    'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth', `subjectAltName=IP:${address},IP:127.0.0.1,DNS:localhost`,
    'subjectKeyIdentifier=hash', 'authorityKeyIdentifier=keyid,issuer', '',
  ].join('\n'));
  openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'root-ca.pem', '-CAkey', 'ca-key.pem',
    '-CAcreateserial', '-out', 'server.pem', '-days', '7', '-sha256', '-extfile', 'server.ext']);
  openssl(['verify', '-purpose', 'sslserver', '-verify_ip', address, '-CAfile', 'root-ca.pem', 'server.pem']);
  openssl(['x509', '-in', 'root-ca.pem', '-outform', 'DER', '-out', 'live-draw-test-ca.cer']);
  const root = new X509Certificate(await readFile(directory + 'root-ca.pem'));
  const cert = new X509Certificate(await readFile(directory + 'server.pem'));
  const origin = `https://${address}:${port}`;
  await writeFile(directory + 'host-key.txt', randomBytes(32).toString('hex') + '\n');
  await writeFile(directory + 'config.json', JSON.stringify({ address, port, origin, displayName, fingerprint: root.fingerprint256, expiresAt: cert.validTo }, null, 2) + '\n');
  await writeFile(directory + 'live-draw-test.mobileconfig', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadType</key><string>Configuration</string>
<key>PayloadVersion</key><integer>1</integer>
<key>PayloadIdentifier</key><string>org.livedraw.test.${id}</string>
<key>PayloadUUID</key><string>${id}</string>
<key>PayloadDisplayName</key><string>${xml(displayName)}</string>
<key>PayloadDescription</key><string>Seven-day certificate for a local Live Draw test. Remove this profile after testing.</string>
<key>PayloadContent</key><array><dict>
<key>PayloadType</key><string>com.apple.security.root</string>
<key>PayloadVersion</key><integer>1</integer>
<key>PayloadIdentifier</key><string>org.livedraw.test.${id}.root</string>
<key>PayloadUUID</key><string>${randomUUID()}</string>
<key>PayloadDisplayName</key><string>${xml(displayName)}</string>
<key>PayloadCertificateFileName</key><string>live-draw-test-ca.cer</string>
<key>PayloadContent</key><data>${root.raw.toString('base64')}</data>
</dict></array></dict></plist>
`);
  await writeFile(directory + 'START_HERE.md', `# Live Draw iPad test\n\n` +
    `Test URL: [${origin}](${origin})\n\n` +
    `Certificate: **${displayName}**. Expires ${cert.validTo}.\n\n` +
    `1. Transfer [this public certificate profile](${directory}live-draw-test.mobileconfig) to your own iPad and install it in Settings → General → VPN & Device Management.\n` +
    `2. Enable its full trust in Settings → General → About → Certificate Trust Settings.\n` +
    `3. Open the test URL in Safari on the same Wi-Fi. It should open without a certificate warning.\n` +
    `4. Start a live session and copy the access key locally from [host-key.txt](${directory}host-key.txt). Share only the viewer link.\n\n` +
    `For a Mac viewer, import [the public CA certificate](${directory}live-draw-test-ca.cer) with Keychain Access and enable its SSL trust.\n\n` +
    `Follow [the full test and cleanup guide](${directory}../docs/IPAD_TEST.md). Remove the test profile/certificate after testing.\n\n` +
    `CA SHA-256 fingerprint: ${root.fingerprint256}\n`);
  console.log(`Prepared LAN test at ${origin}`);
  console.log(`Certificate: ${displayName}; expires ${cert.validTo}`);
  console.log('Install .local-test/live-draw-test.mobileconfig on the iPad, then enable its SSL trust.');
  console.log('Copy the host key locally from .local-test/host-key.txt. It is never printed by these scripts.');
} finally {
  // The CA signing key is no longer needed; retain only the leaf's server key.
  for (const name of ['ca-key.pem', 'server.csr', 'server.ext', 'root-ca.srl']) await rm(directory + name, { force: true });
}
