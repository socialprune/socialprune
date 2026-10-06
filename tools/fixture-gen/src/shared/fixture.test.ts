import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { expect, test } from 'vitest';
import { openArchivePaths } from '@socialprune/core/node';
import { generateFixtures, checkFixtures, writeVariants } from '../tree.ts';
import { listFixtureVariants, loadFixtureVariant } from '../load.ts';
import type { Variant } from './index.ts';
import { writeZipFile } from './zip.ts';

const variant: Variant = {
  id: 'two-archives',
  platform: 'x',
  description: 'Generated split export.',
  expected: { items: 2 },
  archives: [
    { name: 'first', files: { 'posts.json': '["first generated"]' } },
    { name: 'second', files: { 'posts.json': '["second generated"]' } },
  ],
};
test('platform generation replaces only selected data and checks only registered platforms', async () => {
  const root = await mkdtemp(join(tmpdir(), 'socialprune-fixture-platform-'));
  try {
    await mkdir(join(root, 'classify'));
    await writeFile(
      join(root, 'classify/hand-authored.json'),
      '["leave alone"]',
    );
    await mkdir(join(root, 'instagram'));
    await writeFile(join(root, 'instagram/concurrent.txt'), 'leave alone');
    await generateFixtures(root, [variant], ['x']);
    expect(
      await readFile(join(root, 'classify/hand-authored.json'), 'utf8'),
    ).toBe('["leave alone"]');
    expect(await readFile(join(root, 'instagram/concurrent.txt'), 'utf8')).toBe(
      'leave alone',
    );
    expect(await checkFixtures(root, [variant], ['x'])).toEqual([]);
    expect(await listFixtureVariants('x', { root })).toEqual(['two-archives']);
    await writeFile(join(root, 'x/stale.txt'), 'stale');
    expect(await checkFixtures(root, [variant], ['x'])).toEqual([
      'x/stale.txt',
    ]);
    await generateFixtures(root, [variant], ['x']);
    expect(await checkFixtures(root, [variant], ['x'])).toEqual([]);
    await expect(generateFixtures(root, [], ['../outside'])).rejects.toThrow(
      'Invalid fixture',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test.each(['directory', 'zip'] as const)(
  'fixture loader preserves archive identity through %s access',
  async (as) => {
    const root = await mkdtemp(join(tmpdir(), 'socialprune-fixture-load-'));
    try {
      await writeVariants(root, [variant]);
      const loaded = await loadFixtureVariant('x', variant.id, { as, root });
      try {
        expect(loaded.expected).toEqual({ items: 2 });
        expect(loaded.variant.archives).toEqual(['first', 'second']);
        expect(loaded.archive.archives).toEqual(['first', 'second']);
        expect(loaded.archive.list()).toHaveLength(2);
        expect(await loaded.archive.readText(loaded.archive.list()[1]!)).toBe(
          '["second generated"]',
        );
      } finally {
        await loaded.archive.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test('file ZIP writer streams iterable entries, is deterministic, and supports ZIP64', async () => {
  const root = await mkdtemp(join(tmpdir(), 'socialprune-stream-zip-'));
  try {
    const entries = () => [
      {
        path: 'stream.json',
        content: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('[1,'));
            controller.enqueue(new TextEncoder().encode('2]'));
            controller.close();
          },
        }),
      },
    ];
    const first = join(root, 'first.zip');
    const second = join(root, 'second.zip');
    await writeZipFile(first, entries(), { zip64: true });
    await writeZipFile(second, entries(), { zip64: true });
    expect(await readFile(first)).toEqual(await readFile(second));
    const archive = await openArchivePaths([first]);
    try {
      expect(await archive.readText(archive.list()[0]!)).toBe('[1,2]');
    } finally {
      await archive.close();
    }
    await expect(writeZipFile(first, entries())).rejects.toMatchObject({
      code: 'EEXIST',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('undefined per-entry level preserves omitted-level bytes and hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'socialprune-zip-level-default-'));
  try {
    const entries = [
      {
        path: 'data.json',
        content: '[{"text":"Generated default ZIP content."}]',
      },
      { path: 'notes.txt', content: new Uint8Array([1, 2, 3, 4, 5]) },
    ];
    const omitted = join(root, 'omitted.zip');
    const undefinedLevel = join(root, 'undefined.zip');
    await writeZipFile(omitted, entries);
    await writeZipFile(
      undefinedLevel,
      entries.map((entry) => ({ ...entry, level: undefined })),
    );
    const first = await readFile(omitted);
    const second = await readFile(undefinedLevel);
    const hash = (bytes: Uint8Array) =>
      createHash('sha256').update(bytes).digest('hex');
    expect(first).toEqual(second);
    expect(hash(first)).toBe(hash(second));
    expect(hash(first)).toBe(
      '0afda5c744dd9b9c023d84e06a24f64a525705988d50919395d8289ff6b128b8',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('per-entry level zero writes a STORE entry with equal central-directory sizes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'socialprune-zip-level-store-'));
  try {
    const path = join(root, 'store.zip');
    const padding = new Uint8Array(64 * 1024);
    await writeZipFile(
      path,
      [
        { path: 'padding.bin', content: padding, level: 0 },
        { path: 'compressed.bin', content: padding },
      ],
      { zip64: true },
    );
    const reader = new ZipReader(new BlobReader(await openAsBlob(path)), {
      useWebWorkers: false,
      useCompressionStream: true,
    });
    try {
      const entries = await reader.getEntries();
      const stored = entries.find(({ filename }) => filename === 'padding.bin');
      const compressed = entries.find(
        ({ filename }) => filename === 'compressed.bin',
      );
      expect(stored?.compressionMethod).toBe(0);
      expect(stored?.uncompressedSize).toBe(padding.byteLength);
      expect(stored?.compressedSize).toBe(stored?.uncompressedSize);
      expect(compressed?.compressionMethod).toBe(8);
      expect(compressed?.compressedSize).toBeLessThan(padding.byteLength);
    } finally {
      await reader.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
