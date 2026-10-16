import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { directory } from '../build/paths.ts';

async function graph(
  entry: string,
  visited = new Set<string>(),
): Promise<Set<string>> {
  if (visited.has(entry)) return visited;
  visited.add(entry);
  const text = await readFile(entry, 'utf8');
  for (const match of text.matchAll(
    /(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g,
  )) {
    const id = match[1]!;
    if (id.startsWith('.')) await graph(resolve(dirname(entry), id), visited);
  }
  return visited;
}

export function assertProductionGraph(modules: Iterable<string>): void {
  for (const id of modules)
    if (/[/\\](test|e2e|cli)[/\\]/.test(id))
      throw new Error('PRODUCTION_BOUNDARY');
}

test('every production entry excludes test/CLI code and runtime test selectors', async () => {
  for (const entry of [
    'src/main/index.ts',
    'src/engine-host/index.ts',
    'src/preload/index.ts',
  ]) {
    const modules = await graph(resolve(directory, entry));
    assertProductionGraph(modules);
    for (const id of modules) {
      const source = await readFile(id, 'utf8');
      expect(source).not.toMatch(
        /process\.env|testHost|browserProbe|--probe|--test/,
      );
      if (!id.includes('engine-host'))
        expect(source).not.toMatch(
          /from ['"]node:(http|https|net|tls|dgram)['"]/,
        );
    }
  }
  // The same detector catches a planted graph edge before it is trusted.
  expect(() =>
    assertProductionGraph([resolve(directory, 'test/entries/engine.ts')]),
  ).toThrow('PRODUCTION_BOUNDARY');
});
