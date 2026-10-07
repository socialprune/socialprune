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
): Promise<boolean> {
  const seen = new Set<string>();
  const manifests = new Map<string, Record<string, string>>();
  const visit = async (path: string): Promise<boolean> => {
    if (path === review) return true;
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
        if (key === './workspace/review') return true;
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
