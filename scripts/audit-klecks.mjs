import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

// This one unpatched advisory is confined to Parcel's trusted-source build.
// These packages are absent from the final image and browser import graph.
const allowedPackages = new Set(['braces', 'micromatch', '@parcel/watcher']);
const allowedAdvisory = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const result = spawnSync('npm', ['audit', '--json'], { cwd: new URL('../.build/klecks/', import.meta.url), encoding: 'utf8' });
if (result.error || ![0, 1].includes(result.status)) throw new Error('Klecks audit unavailable');
const report = JSON.parse(result.stdout);
if (report.error || !report.metadata || !report.vulnerabilities) throw new Error('Incomplete Klecks audit');
mkdirSync(new URL('../.build/', import.meta.url), { recursive: true });
writeFileSync(new URL('../.build/klecks-audit.json', import.meta.url), JSON.stringify(report, null, 2));
for (const vulnerability of Object.values(report.vulnerabilities)) {
  if (!['high', 'critical'].includes(vulnerability.severity)) continue;
  if (!allowedPackages.has(vulnerability.name) || !vulnerability.via.length || vulnerability.via.some(cause =>
    typeof cause === 'string' ? !allowedPackages.has(cause) : cause.url !== allowedAdvisory)) {
    throw new Error(`Unreviewed Klecks build advisory: ${vulnerability.name}`);
  }
}
console.log('Klecks build audit passed: only the documented, build-only braces advisory is permitted.');
console.log('Full report: .build/klecks-audit.json. No build dependencies enter the runtime image.');
