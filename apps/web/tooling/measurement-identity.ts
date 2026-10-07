import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function measurementIdentity(): Promise<string> {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const hash = createHash('sha256');
  async function scan(path: string) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (entry.isSymbolicLink()) continue;
      const file = resolve(path, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (!entry.name.endsWith('.test.ts')) {
        hash.update(file.slice(root.length));
        hash.update(await readFile(file));
      }
    }
  }
  for (const path of [
    'apps/web/src',
    'packages/core/src',
    'packages/adapter-x/src',
    'packages/adapter-instagram/src',
    'tools/fixture-gen/src/x',
  ])
    await scan(resolve(root, path));
  for (const path of [
    'pnpm-lock.yaml',
    'apps/web/vite.config.ts',
    'apps/web/tooling/manifest.ts',
    'apps/web/test/probes/storage-measure.ts',
    'apps/web/e2e/measurement.workspace.ts',
  ])
    hash.update(await readFile(resolve(root, path)));
  return hash.digest('hex');
}
