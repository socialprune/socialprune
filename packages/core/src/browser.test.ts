import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import * as core from './index.ts';
test('main public API has no reachable Node-only source import', async () => {
  expect(core.ItemSchema).toBeDefined();
  expect(core.openZipArchives).toBeTypeOf('function');
  const visited = new Set<string>();
  const visit = async (file: string): Promise<void> => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(
      /(?:\bfrom\s*|\bimport\s*\()(['"])([^'"]+)\1/g,
    )) {
      const specifier = match[2]!;
      expect(
        specifier.startsWith('node:'),
        `${file} imports ${specifier}`,
      ).toBe(false);
      if (specifier.startsWith('.'))
        await visit(resolve(dirname(file), specifier));
    }
  };
  await visit(fileURLToPath(new URL('./index.ts', import.meta.url)));
  expect(visited.size).toBeGreaterThan(8);
  expect(
    [...visited].some((path) => path.includes(`${resolve('src/node')}`)),
  ).toBe(false);
});
