import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';

const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));
const exportContent =
  ['window', 'YTD', 'tweets', 'part0'].join('.') +
  ' = [{"text":"SYNTHETIC_PRIVATE"}];';
let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'socialprune-data-guard-'));
  git(['init', '--quiet', '--initial-branch=main']);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

function git(args: string[]): void {
  const result = spawnSync('git', args, {
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
}

function run(args: string[], cwd = repo) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

test('staged mode blocks index content, then accepts a clean staged file', async () => {
  const path = join(repo, 'post with spaces.js');
  await writeFile(path, exportContent);
  git(['add', '--', 'post with spaces.js']);
  await writeFile(path, 'clean working copy\n');

  const blocked = run(['--staged']);
  expect(blocked.status).toBe(1);
  expect(blocked.stderr).toContain('post with spaces.js');
  expect(blocked.stderr).toContain('X export assignment');
  expect(blocked.stderr).not.toContain('SYNTHETIC_PRIVATE');
  expect(blocked.stderr).not.toContain(exportContent);

  git(['add', '--', 'post with spaces.js']);
  await writeFile(path, exportContent);
  for (const mode of ['--staged', '--all']) {
    const clean = run([mode]);
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain('1 file(s) checked, no violations');
  }
  expect(run(['post with spaces.js']).status).toBe(1);
}, 60_000);

test('all mode blocks a renamed archive from the index', async () => {
  await writeFile(
    join(repo, 'renamed.dat'),
    Uint8Array.from([0x50, 0x4b, 5, 6]),
  );
  git(['add', '--', 'renamed.dat']);
  const result = run(['--all']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('ZIP header');
}, 60_000);

test('explicit files reject parent traversal without reading it', () => {
  const result = run(['fixtures/synthetic/../missing.zip']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('parent path segment');
});

test('reports usage and read failures with exit 2', async () => {
  for (const args of [
    [],
    ['--unknown'],
    ['--all', '--staged'],
    ['missing.txt'],
  ]) {
    expect(run(args).status).toBe(2);
  }
  expect(run(['--all'], tmpdir()).status).toBe(2);
  await writeFile(join(repo, 'clean.txt'), 'generated notes\n');
  expect(run(['--', 'clean.txt']).status).toBe(0);
  expect(run(['--help']).status).toBe(0);
}, 60_000);
