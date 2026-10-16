import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { root } from '../build/paths.ts';

export async function generatedWorkspace(data: string): Promise<number> {
  const workspace = join(data, 'workspace');
  await mkdir(workspace, { recursive: true });
  await promisify(execFile)(
    process.execPath,
    [
      join(root, 'apps/cli/src/main.ts'),
      'import',
      join(root, 'fixtures/synthetic/demo/x/twitter-2026-10-01-demox'),
      '--workspace',
      workspace,
      '--json',
    ],
    { timeout: 60_000, windowsHide: true },
  );
  const manifest = JSON.parse(
    await readFile(join(root, 'fixtures/synthetic/demo/manifest.json'), 'utf8'),
  ) as {
    exports: { platform: string; itemCount: number }[];
  };
  const count = manifest.exports.find(
    (entry) => entry.platform === 'x',
  )?.itemCount;
  if (count === undefined) throw new Error('FIXTURE_COUNT_MISSING');
  return count;
}
