import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function filesIn(
  directory: string,
  prefix = '',
): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink())
      throw new Error(`Symbolic link in assembly: ${path}`);
    if (entry.isDirectory())
      paths.push(...(await filesIn(join(directory, entry.name), `${path}/`)));
    else if (entry.isFile()) paths.push(path);
    else throw new Error(`Non-regular file in assembly: ${path}`);
  }
  return paths.sort();
}

/** A git-archive proof supplies the host's hash-bound Git inventory explicitly. */
export async function sourceInventory(
  root: string,
): Promise<Map<string, string | null>> {
  if (existsSync(join(root, '.git'))) {
    const result = spawnSync('git', ['ls-files', '-z'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
      windowsHide: true,
    });
    if (result.status !== 0)
      throw new Error('Cannot read tracked source inventory.');
    return new Map(
      result.stdout
        .toString()
        .split('\0')
        .filter(Boolean)
        .map((path) => [path, null]),
    );
  }
  const snapshot: unknown = JSON.parse(
    await readFile(join(root, '.c5-source-files.json'), 'utf8'),
  );
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    !('commit' in snapshot) ||
    !('files' in snapshot) ||
    typeof snapshot.commit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(snapshot.commit) ||
    !snapshot.files ||
    typeof snapshot.files !== 'object' ||
    Array.isArray(snapshot.files)
  )
    throw new Error('Invalid git-archive source inventory.');
  const inventory = new Map<string, string | null>();
  for (const [path, hash] of Object.entries(snapshot.files)) {
    if (
      !/^[A-Za-z0-9_./-]+$/.test(path) ||
      path.split('/').includes('..') ||
      typeof hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(hash)
    )
      throw new Error('Invalid source identity.');
    inventory.set(path, hash);
  }
  return inventory;
}

export async function trackedBytes(
  root: string,
  path: string,
  inventory: Map<string, string | null>,
): Promise<Buffer> {
  if (!inventory.has(path)) throw new Error(`Untracked release input: ${path}`);
  const source = join(root, path);
  const stat = await lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`Invalid release input: ${path}`);
  const bytes = await readFile(source);
  const hash = inventory.get(path);
  if (hash && sha256(bytes) !== hash)
    throw new Error(`Source parity failed: ${path}`);
  return bytes;
}

export interface PackageFile {
  path: string;
  sha256: string;
  origin:
    | {
        kind: 'generated';
        producer: 'rolldown' | 'vite' | 'manifest' | 'readme' | 'notices';
      }
    | { kind: 'tracked'; source: string };
}

export const REVIEW_FILES_MARKER = 'web/** = dist-review';

/** The producer directory is Vite's output, not the assembled package copy. */
export async function expectedPackageFiles(
  entries: readonly string[],
  reviewDirectory: string,
): Promise<string[]> {
  if (
    entries.filter((entry) => entry === REVIEW_FILES_MARKER).length !== 1 ||
    entries.some(
      (entry) =>
        entry !== REVIEW_FILES_MARKER &&
        (entry.startsWith('web/') || entry.includes('*')),
    )
  )
    throw new Error('Expected files require exactly one dist-review marker.');
  const reviewFiles = await filesIn(reviewDirectory);
  if (!reviewFiles.length) throw new Error('dist-review is empty.');
  const expected = [
    ...entries.filter((entry) => entry !== REVIEW_FILES_MARKER),
    ...reviewFiles.map((path) => `web/${path}`),
  ].sort();
  assertFileList(expected, expected);
  return expected;
}

export async function assertReviewAsset(
  record: PackageFile,
  bytes: Buffer,
  reviewDirectory: string,
): Promise<void> {
  assert.ok(record.path.startsWith('web/'), 'Not a review asset.');
  assert.deepEqual(
    record.origin,
    { kind: 'generated', producer: 'vite' },
    `Review asset has non-Vite provenance: ${record.path}`,
  );
  assert.deepEqual(
    bytes,
    await readFile(join(reviewDirectory, record.path.slice('web/'.length))),
    `Review asset differs from dist-review: ${record.path}`,
  );
}

export function assertFileList(
  actual: readonly string[],
  expected: readonly string[],
): void {
  for (const path of actual) {
    if (
      path.startsWith('/') ||
      path.includes('\\') ||
      path.split('/').includes('..') ||
      /(?:^|\/)fixtures(?:\/|$)|\.[cm]?tsx?$|(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\./i.test(
        path,
      )
    )
      throw new Error(`Forbidden packed path: ${path}`);
  }
  const sorted = [...actual].sort();
  if (
    new Set(sorted).size !== actual.length ||
    JSON.stringify(sorted) !== JSON.stringify([...expected].sort())
  )
    throw new Error(`Packed file list differs.\nActual:\n${actual.join('\n')}`);
}
