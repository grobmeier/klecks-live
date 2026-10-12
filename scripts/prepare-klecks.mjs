import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
import { fileURLToPath } from 'node:url';
const upstream = JSON.parse(await readFile(resolve(root, 'upstream.json'), 'utf8'));
const fromIndex = process.argv.indexOf('--from');
let source = fromIndex >= 0 ? resolve(process.argv[fromIndex + 1]) : resolve(root, '.build/source');
await mkdir(resolve(root, '.build'), { recursive: true });
if (fromIndex < 0) {
  await mkdir(source, { recursive: true });
  execFileSync('git', ['init', '-q', source]);
  execFileSync('git', ['fetch', '-q', '--depth', '1', upstream.repository, upstream.revision], { cwd: source, stdio: 'inherit' });
}
execFileSync('git', ['--no-replace-objects', 'cat-file', '-e', `${upstream.revision}^{commit}`], { cwd: source });
const destination = resolve(root, '.build/klecks');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
const archive = resolve(root, '.build/klecks.tar');
execFileSync('git', ['--no-replace-objects', 'archive', '--format=tar', '--output', archive, upstream.revision], { cwd: source });
execFileSync('tar', ['-xf', archive, '-C', destination]);
// Isolate git apply from any repository that contains this build directory.
execFileSync('git', ['init', '-q', destination]);
for (const patch of [upstream.patch, ...(upstream.buildPatches || [])]) {
  execFileSync('git', ['apply', '--check', resolve(root, patch)], { cwd: destination });
  execFileSync('git', ['apply', resolve(root, patch)], { cwd: destination });
}
await writeFile(resolve(root, '.build/upstream-revision'), upstream.revision + '\n');
console.log(`Prepared pinned Klecks ${upstream.revision.slice(0, 7)} with the viewport integration.`);
