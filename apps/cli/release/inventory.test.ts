import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  assertFileList,
  assertReviewAsset,
  expectedPackageFiles,
  REVIEW_FILES_MARKER,
  sha256,
} from './inventory.ts';
import type { PackageFile } from './inventory.ts';

test('web inventory follows the independent producer while non-web entries stay exact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c5-inventory-'));
  const entries = ['LICENSE', 'bin/socialprune.mjs', REVIEW_FILES_MARKER];
  try {
    await expect(
      expectedPackageFiles(entries, join(directory, 'missing')),
    ).rejects.toThrow();
    await expect(expectedPackageFiles(entries, directory)).rejects.toThrow(
      'empty',
    );
    await mkdir(join(directory, 'assets'));
    const assets = [
      'index.html',
      'assets/Review-first123.js',
      'assets/base.css',
    ];
    for (const path of assets) await writeFile(join(directory, path), path);
    const actual = [
      'LICENSE',
      'bin/socialprune.mjs',
      ...assets.map((path) => `web/${path}`),
    ];
    const expected = await expectedPackageFiles(entries, directory);
    assertFileList(actual, expected);
    expect(() =>
      assertFileList([...actual, 'web/assets/not-from-vite.js'], expected),
    ).toThrow();
    expect(() =>
      assertFileList(
        actual.filter((path) => path !== 'web/index.html'),
        expected,
      ),
    ).toThrow();
    expect(() =>
      assertFileList([...actual, 'bin/stray-private.txt'], expected),
    ).toThrow();
    expect(() =>
      assertFileList(
        actual.filter((path) => path !== 'LICENSE'),
        expected,
      ),
    ).toThrow();
    await rm(join(directory, assets[1]!));
    await writeFile(
      join(directory, 'assets/Review-second45.js'),
      'changed producer',
    );
    const changed = actual.map((path) =>
      path === 'web/assets/Review-first123.js'
        ? 'web/assets/Review-second45.js'
        : path,
    );
    const freshExpected = await expectedPackageFiles(entries, directory);
    assertFileList(changed, freshExpected);
    expect(() => assertFileList(actual, freshExpected)).toThrow();
    for (const invalid of [
      entries.slice(0, 2),
      [...entries, REVIEW_FILES_MARKER],
      [...entries, 'web/stale.js'],
    ])
      await expect(expectedPackageFiles(invalid, directory)).rejects.toThrow(
        'marker',
      );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('review bytes and Vite provenance come from the producer, not the assembly hash record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c5-provenance-'));
  const bytes = Buffer.from('Vite-produced review document');
  const record: PackageFile = {
    path: 'web/index.html',
    sha256: sha256(bytes),
    origin: { kind: 'generated', producer: 'vite' },
  };
  try {
    await writeFile(join(directory, 'index.html'), bytes);
    await assertReviewAsset(record, bytes, directory);
    const changed = Buffer.from('planted assembly bytes');
    await expect(
      assertReviewAsset(
        { ...record, sha256: sha256(changed) },
        changed,
        directory,
      ),
    ).rejects.toThrow('differs');
    await expect(
      assertReviewAsset(
        { ...record, origin: { kind: 'tracked', source: 'web/index.html' } },
        bytes,
        directory,
      ),
    ).rejects.toThrow('non-Vite');
    await expect(
      assertReviewAsset(
        { ...record, origin: { kind: 'generated', producer: 'manifest' } },
        bytes,
        directory,
      ),
    ).rejects.toThrow('non-Vite');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
