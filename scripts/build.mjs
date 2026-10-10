import { mkdir, rm, cp, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const editor = resolve(root, '.build/klecks');
try { await access(resolve(editor, 'package.json')); } catch { throw new Error('Run npm run prepare:klecks first.'); }
try { await access(resolve(editor, 'node_modules/parcel/package.json')); }
catch { execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: editor, stdio: 'inherit' }); }
for (const script of ['icon:build', 'lang:build', 'build:embed']) execFileSync('npm', ['run', script], { cwd: editor, stdio: 'inherit' });
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true }); await mkdir(dist, { recursive: true });
await cp(resolve(root, 'public'), dist, { recursive: true });
await cp(resolve(editor, 'dist'), resolve(dist, 'klecks'), { recursive: true });
await cp(resolve(editor, 'LICENSE'), resolve(dist, 'klecks/LICENSE'));
await cp(resolve(root, 'LICENSE'), resolve(dist, 'LICENSE'));
await cp(resolve(root, 'UPSTREAM_LICENSE'), resolve(dist, 'UPSTREAM_LICENSE'));
console.log('Built Live Draw and the pinned Klecks embed.');
