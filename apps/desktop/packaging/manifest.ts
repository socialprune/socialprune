import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
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
assert.equal(
  git(['ls-files', '--others', '--exclude-standard']).toString(),
  '',
  'UNTRACKED_TASK_CHANGES',
);
const paths = git(['diff', '--cached', '--no-renames', '--name-only', '-z'])
  .toString()
  .split('\0')
  .filter(Boolean)
  .sort();
const integration = new Set([
  '.github/workflows/desktop-diagnose.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/release-desktop.yml',
  'package.json',
  'pnpm-lock.yaml',
]);
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const rows: string[] = [];
for (const path of paths) {
  assert.ok(
    (path.startsWith('apps/desktop/') &&
      path !== 'apps/desktop/e2e/migration.spec.ts') ||
      integration.has(path) ||
      path.startsWith('tools/licenses-check/'),
    'WRITE_SET_MISMATCH',
  );
  if (
    git([
      'diff',
      '--cached',
      '--no-renames',
      '--name-only',
      '--diff-filter=D',
      '--',
      path,
    ])
      .toString()
      .trim()
  ) {
    rows.push(`DELETED ${path}`);
    continue;
  }
  const staged = git(['show', ':' + path]);
  // .gitattributes checks PowerShell scripts out with CRLF but stores LF.
  // Compare Git-filtered identities and hash the actual staged bytes.
  assert.equal(
    git(['hash-object', '--path=' + path, path])
      .toString()
      .trim(),
    git(['rev-parse', ':' + path])
      .toString()
      .trim(),
    `STAGED_BYTES_DIFFER: ${path}`,
  );
  rows.push(`${hash(staged)} ${path}`);
}
const stagedTree = git(['write-tree']).toString().trim();
await writeFile(
  output,
  `base ${git(['rev-parse', 'HEAD']).toString().trim()}\nstagedTree ${stagedTree}\n` +
    rows.join('\n') +
    '\n',
);
console.log(
  JSON.stringify({
    path: output,
    files: paths.length,
    stagedTree,
    sha256: hash(await readFile(output)),
    base: git(['rev-parse', 'HEAD']).toString().trim(),
  }),
);
