import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
for (const directory of ['server', 'public', 'scripts', 'test']) {
  for (const file of await readdir(directory)) if (/\.(mjs|js)$/.test(file)) execFileSync(process.execPath, ['--check', `${directory}/${file}`], { stdio: 'inherit' });
}
console.log('JavaScript syntax checks passed.');
