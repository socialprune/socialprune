import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { FIXTURES_ROOT } from '@socialprune/fixture-gen';
import type { DemoData } from '@socialprune/fixture-gen';
import { openZipArchives } from '@socialprune/core';
import { demoArchives } from './demo-bytes.ts';

test('demo ZIPs preserve manifest archive names and every source byte', async () => {
  const root = join(FIXTURES_ROOT, 'demo');
  const manifest = JSON.parse(
    await readFile(join(root, 'manifest.json'), 'utf8'),
  ) as DemoData['manifest'];
  const archives = await demoArchives();
  expect(archives.map(({ name }) => name)).toEqual(
    manifest.exports.map(({ archive }) => archive),
  );
  for (const [index, archive] of archives.entries()) {
    const source = manifest.exports[index]!;
    expect(archive.asset.endsWith(`/${source.archive}`)).toBe(true);
    const reader = await openZipArchives([
      { name: archive.name, blob: new Blob([archive.bytes]) },
    ]);
    try {
      for (const entry of reader.list())
        expect(await reader.readText(entry)).toBe(
          await readFile(join(root, source.directory, entry.path), 'utf8'),
        );
    } finally {
      await reader.close();
    }
  }
});
