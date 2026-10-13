import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('local source preparation archives the raw pin despite replacement refs and worktree edits', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'live-draw-pin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source'), project = join(directory, 'project');
  await mkdir(source); await mkdir(join(project, 'scripts'), { recursive: true }); await mkdir(join(project, 'patches'));
  const git = args => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']); await writeFile(join(source, 'identity.txt'), 'pinned\n'); await writeFile(join(source, 'drawing.txt'), 'drawing\n');
  git(['add', '.']); git(['commit', '-qm', 'pin']); const pin = git(['rev-parse', 'HEAD']);
  await writeFile(join(source, 'identity.txt'), 'replacement\n'); git(['add', '.']); git(['commit', '-qm', 'replacement']);
  git(['replace', pin, git(['rev-parse', 'HEAD'])]); await writeFile(join(source, 'identity.txt'), 'dirty worktree\n');
  await cp(new URL('../scripts/prepare-klecks.mjs', import.meta.url), join(project, 'scripts/prepare-klecks.mjs'));
  await writeFile(join(project, 'upstream.json'), JSON.stringify({ repository: 'https://example.invalid/unused', revision: pin, patch: 'patches/viewport.patch' }));
  await writeFile(join(project, 'patches/viewport.patch'), 'diff --git a/drawing.txt b/drawing.txt\n--- a/drawing.txt\n+++ b/drawing.txt\n@@ -1 +1 @@\n-drawing\n+patched drawing\n');
  execFileSync(process.execPath, [join(project, 'scripts/prepare-klecks.mjs'), '--from', source], { stdio: 'pipe' });
  assert.equal(await readFile(join(project, '.build/klecks/identity.txt'), 'utf8'), 'pinned\n');
  assert.equal(await readFile(join(project, '.build/klecks/drawing.txt'), 'utf8'), 'patched drawing\n');
});
