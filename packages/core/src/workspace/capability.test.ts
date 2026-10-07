import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const review = resolve(repo, 'packages/core/src/workspace/review.ts');
async function importsReview(
  entry: string,
  readSource: (path: string) => Promise<string> = (path) =>
    readFile(path, 'utf8'),
  forbidden = review,
): Promise<boolean> {
  const seen = new Set<string>();
  const manifests = new Map<string, Record<string, string>>();
  const visit = async (path: string): Promise<boolean> => {
    if (path === forbidden) return true;
    if (seen.has(path)) return false;
    seen.add(path);
    const source = await readSource(path);
    for (const match of source.matchAll(
      /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\bfrom\s*)?(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3/g,
    )) {
      const specifier = (match[2] ?? match[4])!;
      let target: string | undefined;
      if (specifier.startsWith('.')) target = resolve(dirname(path), specifier);
      else if (specifier.startsWith('@socialprune/core')) {
        let exports = manifests.get('core');
        if (!exports) {
          const metadata: unknown = JSON.parse(
            await readFile(resolve(repo, 'packages/core/package.json'), 'utf8'),
          );
          if (
            !metadata ||
            typeof metadata !== 'object' ||
            !('exports' in metadata) ||
            !metadata.exports ||
            typeof metadata.exports !== 'object'
          )
            throw new Error('Core export map is missing.');
          exports = metadata.exports as Record<string, string>;
          manifests.set('core', exports);
        }
        const key =
          specifier === '@socialprune/core'
            ? '.'
            : `.${specifier.slice('@socialprune/core'.length)}`;
        if (key === './workspace/review' && forbidden === review) return true;
        if (exports[key]) target = resolve(repo, 'packages/core', exports[key]);
      }
      if (target && (await visit(target))) return true;
    }
    return false;
  };
  return visit(entry);
}
async function commandFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return [];
      throw error;
    },
  );
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory())
      result.push(...(await commandFiles(resolve(path, entry.name))));
    else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts')
    )
      result.push(resolve(path, entry.name));
  }
  return result;
}
test('ordinary CLI command modules cannot reach the review capability', async () => {
  for (const command of await commandFiles(
    resolve(repo, 'apps/cli/src/commands'),
  ))
    expect(await importsReview(command), command).toBe(false);
});
test.each([
  "export * from '@socialprune/core/workspace/review';",
  "import { ReviewService } from './review.ts';",
  "const review = import('@socialprune/core/workspace/review');",
])(
  'capability graph detects a planted transitive review import: %s',
  async (source) => {
    const entry = resolve(
      repo,
      'packages/core/src/workspace/synthetic-command.ts',
    );
    const bridge = resolve(
      repo,
      'packages/core/src/workspace/synthetic-bridge.ts',
    );
    const inputs = new Map([
      [entry, "export * from './synthetic-bridge.ts';"],
      [bridge, source],
    ]);
    expect(
      await importsReview(entry, (path) => {
        const input = inputs.get(path);
        if (input === undefined) throw new Error('Unknown synthetic input.');
        return Promise.resolve(input);
      }),
    ).toBe(true);
  },
);
test('test-support contract suite is unreachable from every production export', async () => {
  const metadata: unknown = JSON.parse(
    await readFile(resolve(repo, 'packages/core/package.json'), 'utf8'),
  );
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    !('exports' in metadata) ||
    !metadata.exports ||
    typeof metadata.exports !== 'object'
  )
    throw new Error('Core export map missing.');
  const contract = resolve(
    repo,
    'packages/core/src/workspace/store-contract.ts',
  );
  for (const [specifier, path] of Object.entries(metadata.exports)) {
    if (specifier === './workspace/store-contract' || typeof path !== 'string')
      continue;
    expect(
      await importsReview(
        resolve(repo, 'packages/core', path),
        undefined,
        contract,
      ),
      specifier,
    ).toBe(false);
  }
  const planted = resolve(
    repo,
    'packages/core/src/workspace/planted-production.ts',
  );
  expect(
    await importsReview(
      planted,
      () => Promise.resolve("export * from './store-contract.ts';"),
      contract,
    ),
  ).toBe(true);
});
test('LabelService has no transitive review capability or event append call', async () => {
  const path = resolve(repo, 'packages/core/src/workspace/labels.ts');
  expect(await importsReview(path)).toBe(false);
  expect(await readFile(path, 'utf8')).not.toMatch(
    /(?:decisionEvents|outcomeEvents)\s*\.\s*append/,
  );
});
test('workspace runtime and test-support subpaths resolve and have no reachable node imports', async () => {
  const subpaths = [
    'store',
    'memory-store',
    'store-contract',
    'review',
    'labels',
    'query',
    'time',
    'merge',
    'payloads',
    'backup',
  ];
  const visited = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    if (visited.has(path)) return;
    visited.add(path);
    const source = await readFile(path, 'utf8');
    for (const match of source.matchAll(
      /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\bfrom\s*)?(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3/g,
    )) {
      const specifier = (match[2] ?? match[4])!;
      expect(specifier.startsWith('node:'), `${path}: ${specifier}`).toBe(
        false,
      );
      if (specifier.startsWith('.'))
        await visit(resolve(dirname(path), specifier));
    }
  };
  for (const subpath of subpaths) {
    const target = fileURLToPath(
      import.meta.resolve(`@socialprune/core/workspace/${subpath}`),
    );
    expect(target).toBe(
      resolve(repo, `packages/core/src/workspace/${subpath}.ts`),
    );
    await visit(target);
  }
  const contract = await readFile(
    resolve(repo, 'packages/core/src/workspace/store-contract.ts'),
    'utf8',
  );
  expect(contract).not.toMatch(/(?:from|import\s*\()\s*['"](?:vitest|node:)/);
  expect(contract).not.toMatch(/\b(?:document|window|HTMLElement)\b/);
});
