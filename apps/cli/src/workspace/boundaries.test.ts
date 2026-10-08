import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { createWorkspace } from '@socialprune/core/workspace/store';
import { executeCli } from '../cli/adapter.ts';
import { createNodeContext } from '../cli/node-context.ts';
import { capturedContext } from '../cli/test/context.ts';
import { SQLiteStore } from './sqlite-store.ts';
import { requireWorkspaceNode } from './node-version.ts';

test('physical layout and logical schema versions independently refuse newer workspaces', async () => {
  requireWorkspaceNode(process.versions.node);
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c2-version-'));
  const file = join(directory, 'socialprune.sqlite');
  const store = await SQLiteStore.open(file, { initial: createWorkspace() });
  await store.close();
  const { DatabaseSync } = await import('node:sqlite');
  try {
    for (const mutation of [
      'PRAGMA user_version=99;',
      "PRAGMA user_version=1; UPDATE meta SET data=json_set(data, '$.schemaVersion', 99);",
    ]) {
      const raw = new DatabaseSync(file, { allowExtension: false });
      raw.exec(mutation);
      raw.close();
      const before = await readFile(file);
      const capture = capturedContext(
        createNodeContext({ write() {} }, { write() {} }).services,
      );
      expect(
        await executeCli(
          ['summary', '--workspace', directory, '--json'],
          capture.context,
        ),
      ).toBe(3);
      expect(JSON.parse(capture.stdout.join(''))).toMatchObject({
        error: { code: 'WORKSPACE_SCHEMA_UNSUPPORTED', retryable: false },
      });
      expect(await readFile(file)).toEqual(before);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('production imports and worker entry cannot reach test mutations; review is confined to its worker', async () => {
  const seen = new Set<string>();
  const walk = async (path: string): Promise<void> => {
    path = resolve(path);
    if (seen.has(path)) return;
    seen.add(path);
    expect(path.replaceAll('\\', '/')).not.toMatch(
      /\/(?:test|tests)\/|\.test\.ts$|\/workspace\/store-contract\.ts$/,
    );
    const text = await readFile(path, 'utf8');
    expect(text).not.toMatch(/process\.env.*(?:fault|mutation|test)/i);
    for (const match of text.matchAll(
      /(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g,
    )) {
      const specifier = match[1]!;
      if (specifier === '@socialprune/core/workspace/review')
        expect(path.replaceAll('\\', '/')).toMatch(
          /\/apps\/cli\/src\/review\//,
        );
      if (specifier.startsWith('node:')) continue;
      const next = specifier.startsWith('.')
        ? fileURLToPath(new URL(specifier, pathToFileURL(path)))
        : specifier.startsWith('@socialprune/')
          ? fileURLToPath(import.meta.resolve(specifier))
          : null;
      if (next?.endsWith('.ts')) await walk(next);
    }
    for (const match of text.matchAll(
      /new URL\(['"](\.\/[^'"]+\.ts)['"], import\.meta\.url\)/g,
    ))
      await walk(fileURLToPath(new URL(match[1]!, pathToFileURL(path))));
  };
  await walk(fileURLToPath(new URL('../main.ts', import.meta.url)));
  expect(seen.size).toBeGreaterThan(30);
  expect(seen).toContain(
    fileURLToPath(new URL('../review/database-worker.ts', import.meta.url)),
  );
  expect(seen).toContain(
    fileURLToPath(import.meta.resolve('@socialprune/core/workspace/review')),
  );
  const main = await readFile(
    fileURLToPath(new URL('../review/server.ts', import.meta.url)),
    'utf8',
  );
  expect(main).not.toMatch(
    /SQLiteStore|ReviewService|QueryEngine|\.\/runtime\.ts/,
  );
  // This inventory oracle would reject an explicitly planted test-only path.
  expect(() =>
    expect('/generated/workspace/test/child.ts').not.toMatch(/\/test\//),
  ).toThrow();
}, 60_000);
