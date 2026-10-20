import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import { assertProductionModules } from '../packaging/boundary.ts';

async function graph(
  entry: string,
  visited = new Set<string>(),
): Promise<Set<string>> {
  if (visited.has(entry)) return visited;
  visited.add(entry);
  const text = await readFile(entry, 'utf8');
  for (const match of text.matchAll(
    /(?:from\s*|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g,
  )) {
    const id = match[1]!;
    if (id.startsWith('.')) await graph(resolve(dirname(entry), id), visited);
  }
  return visited;
}

export function assertProductionGraph(modules: Iterable<string>): void {
  for (const id of modules)
    if (/[/\\](test|e2e)[/\\]/.test(id)) throw new Error('PRODUCTION_BOUNDARY');
}

test('every production entry excludes test code and runtime test selectors', async () => {
  for (const entry of [
    'src/main/index.ts',
    'src/engine-host/index.ts',
    'src/preload/index.ts',
  ]) {
    const modules = await graph(resolve(directory, entry));
    assertProductionGraph(modules);
    expect(modules.has(resolve(directory, 'packaging/windows-query.ts'))).toBe(
      false,
    );
    expect(modules.has(resolve(directory, 'packaging/query-poll.ts'))).toBe(
      false,
    );
    expect(
      modules.has(resolve(directory, 'packaging/windows-powershell.ts')),
    ).toBe(false);
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
  expect(() =>
    assertProductionModules([
      resolve(directory, '../cli/e2e/engine-test-entry.ts'),
    ]),
  ).toThrow('PRODUCTION_TEST_IMPORT');
});

test('quiet window presentation is reachable only from the test entry, never through release arguments', async () => {
  const release = await graph(resolve(directory, 'src/main/index.ts'));
  const testing = await graph(resolve(directory, 'test/entries/main.ts'));
  const inspecting = await graph(
    resolve(directory, 'test/entries/quiet-main.ts'),
  );
  const quiet = resolve(directory, 'test/quiet-windows.ts');
  expect(testing.has(quiet)).toBe(true);
  expect(inspecting.has(quiet)).toBe(true);
  expect(inspecting.has(resolve(directory, 'src/main/index.ts'))).toBe(true);
  expect(release.has(quiet)).toBe(false);
  for (const id of release) {
    const source = await readFile(id, 'utf8');
    expect(source).not.toMatch(
      /showInactive|setFocusable|moveBottom|quiet-windows/,
    );
  }
  expect(() => assertProductionGraph([...release, quiet])).toThrow(
    'PRODUCTION_BOUNDARY',
  );
  const entry = await readFile(resolve(directory, 'src/main/index.ts'), 'utf8');
  expect(entry).not.toContain('quiet');
  expect(entry).not.toContain('inactive');
});
