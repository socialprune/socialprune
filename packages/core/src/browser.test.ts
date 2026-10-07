import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import * as core from './index.ts';

async function browserImports(
  entry: string,
  readSource: (file: string) => Promise<string> = (file) =>
    readFile(file, 'utf8'),
): Promise<{ visited: Set<string>; nodeImports: string[] }> {
  const visited = new Set<string>();
  const nodeImports: string[] = [];
  const visit = async (file: string): Promise<void> => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = await readSource(file);
    for (const match of source.matchAll(
      /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\bfrom\s*)?(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3/g,
    )) {
      const specifier = (match[2] ?? match[4])!;
      if (specifier.startsWith('node:'))
        nodeImports.push(`${file}: ${specifier}`);
      if (specifier.startsWith('.'))
        await visit(resolve(dirname(file), specifier));
    }
  };
  await visit(entry);
  return { visited, nodeImports };
}

test('main public API has no reachable Node-only source import', async () => {
  expect(core.ItemSchema).toBeDefined();
  expect(core.openZipArchives).toBeTypeOf('function');
  const { visited, nodeImports } = await browserImports(
    fileURLToPath(new URL('./index.ts', import.meta.url)),
  );
  expect(nodeImports).toEqual([]);
  expect(visited.size).toBeGreaterThan(8);
  expect(
    [...visited].some((path) => path.includes(`${resolve('src/node')}`)),
  ).toBe(false);
});

test.each(['browser-init', 'guide/types'])(
  '%s public subpath has no reachable Node-only source import',
  async (subpath) => {
    const { visited, nodeImports } = await browserImports(
      fileURLToPath(import.meta.resolve(`@socialprune/core/${subpath}`)),
    );
    expect(visited.size).toBeGreaterThan(0);
    expect(nodeImports).toEqual([]);
  },
);

test.each([
  "import 'node:fs';",
  "import { readFile } from 'node:fs/promises';",
  "export { Buffer } from 'node:buffer';",
  "const node = import('node:path');",
])('browser graph detects a planted Node import: %s', async (source) => {
  const entry = resolve('synthetic-browser-entry.ts');
  const nested = resolve('synthetic-browser-node.ts');
  const inputs = new Map([
    [entry, "export * from './synthetic-browser-node.ts';"],
    [nested, source],
  ]);
  const { nodeImports } = await browserImports(entry, (file) => {
    const input = inputs.get(file);
    if (input === undefined) throw new Error('Unknown synthetic source.');
    return Promise.resolve(input);
  });
  expect(nodeImports).toHaveLength(1);
  expect(nodeImports[0]).toContain('node:');
});
