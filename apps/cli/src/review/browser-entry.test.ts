import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';

test('browser recorder entry and all e2e controls are unreachable from production and the database worker', async () => {
  const entry = fileURLToPath(
    new URL('./test/browser-entry.ts', import.meta.url),
  );
  async function closure(start: string) {
    const seen = new Set<string>();
    async function walk(path: string): Promise<void> {
      path = resolve(path);
      if (seen.has(path)) return;
      seen.add(path);
      const source = await readFile(path, 'utf8');
      for (const match of source.matchAll(
        /(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g,
      )) {
        const specifier = match[1]!;
        const target = specifier.startsWith('.')
          ? fileURLToPath(new URL(specifier, pathToFileURL(path)))
          : specifier.startsWith('@socialprune/')
            ? fileURLToPath(import.meta.resolve(specifier))
            : null;
        if (target?.endsWith('.ts')) await walk(target);
      }
      for (const match of source.matchAll(
        /new URL\(['"](\.\/[^'"]+\.ts)['"], import\.meta\.url\)/g,
      ))
        await walk(fileURLToPath(new URL(match[1]!, pathToFileURL(path))));
    }
    await walk(start);
    return seen;
  }
  function assertProduction(paths: Set<string>) {
    expect(paths).not.toContain(entry);
    for (const path of paths)
      expect(path.replaceAll('\\', '/')).not.toMatch(
        /\/(?:test|e2e)\/|\.test\.ts$/,
      );
  }
  for (const root of ['../main.ts', './database-worker.ts']) {
    const paths = await closure(fileURLToPath(new URL(root, import.meta.url)));
    expect(paths.size).toBeGreaterThan(10);
    assertProduction(paths);
    expect(() => assertProduction(new Set([...paths, entry]))).toThrow();
  }
  const source = await readFile(entry, 'utf8');
  expect(source).toContain('executeCli');
  expect(source).not.toContain('process.env');
});
