import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { root } from './paths.ts';

const output = process.argv[2];
if (!output || !isAbsolute(output))
  throw new Error('ABSOLUTE_MANIFEST_PATH_REQUIRED');
const git = (args: string[]) =>
  execFileSync('git', ['--no-pager', ...args], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
assert.equal(
  git(['diff', '--name-only']).toString(),
  '',
  'UNSTAGED_TASK_CHANGES',
);
const paths = git(['diff', '--cached', '--name-only', '-z'])
  .toString()
  .split('\0')
  .filter(Boolean)
  .sort();
const integration = new Set([
  '.github/workflows/ci.yml',
  '.gitignore',
  '.prettierignore',
  'eslint.config.js',
  'package.json',
  'pnpm-lock.yaml',
]);
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const rows: string[] = [];
for (const path of paths) {
  assert.ok(
    path.startsWith('apps/desktop/') || integration.has(path),
    'WRITE_SET_MISMATCH',
  );
  const bytes = await readFile(resolve(root, path));
  const staged = git(['show', ':' + path]);
  assert.equal(hash(bytes), hash(staged), `STAGED_BYTES_DIFFER: ${path}`);
  rows.push(`${hash(bytes)}  ${path}`);
}
await writeFile(output, rows.join('\n') + '\n');
console.log(
  JSON.stringify({
    path: output,
    files: paths.length,
    sha256: hash(await readFile(output)),
    base: git(['rev-parse', 'HEAD']).toString().trim(),
  }),
);
