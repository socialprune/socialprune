import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZipFile } from '../../../tools/fixture-gen/src/shared/zip.ts';
import { expect, test } from 'vitest';
const cli = fileURLToPath(new URL('./main.ts', import.meta.url));
test('CLI structure inspects a generated ZIP and reports no planted leaf values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-cli-'));
  const planted = 'PLANTED_CLI_VALUE_NEVER_SHOWN';
  try {
    const file = join(directory, 'synthetic.zip');
    await writeZipFile(file, [
      {
        path: 'posts.json',
        content: JSON.stringify([{ text: planted, number: 987654321 }]),
      },
    ]);
    const result = spawnSync(
      process.execPath,
      [cli, 'structure', file, '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain(planted);
    expect(result.stdout).not.toContain('987654321');
    const report: unknown = JSON.parse(result.stdout);
    expect(report).toHaveProperty('files');
    expect(result.stdout).toContain('$[].text');
    const human = spawnSync(process.execPath, [cli, 'structure', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(human.status).toBe(0);
    expect(human.stdout).toContain('$[].text: string');
    for (const args of [
      ['structure'],
      ['structure', join(directory, 'missing.zip')],
      ['structure', file, '--unknown'],
    ]) {
      const usage = spawnSync(process.execPath, [cli, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(usage.status).toBe(2);
      expect(usage.stdout).toBe('');
      expect(usage.stderr).not.toContain(planted);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
