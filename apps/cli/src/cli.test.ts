import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZipFile } from '../../../tools/fixture-gen/src/shared/zip.ts';
import { expect, test } from 'vitest';
const cli = fileURLToPath(new URL('./main.ts', import.meta.url));
const notice =
  'Key names are shown as they appear in the export. Check the report before you share it.';
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
    expect(result.stdout).not.toContain(notice);
    expect(result.stdout).not.toContain(planted);
    expect(result.stdout).not.toContain('987654321');
    const envelope = JSON.parse(result.stdout) as {
      schemaVersion: number;
      command: string;
      status: string;
      data: { files: unknown };
      warnings: unknown;
    };
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.command).toBe('structure');
    expect(envelope.status).toBe('ok');
    expect(Array.isArray(envelope.data.files)).toBe(true);
    expect(envelope.warnings).toEqual([]);
    expect(result.stdout).toContain('$[].text');
    const human = spawnSync(process.execPath, [cli, 'structure', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(human.status).toBe(0);
    expect(human.stdout).toContain('$[].text: string');
    expect(human.stdout).not.toContain(notice);
    expect(human.stderr.trim()).toBe(notice);
    const help = spawnSync(process.execPath, [cli, '--help'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain(notice);
    expect(help.stderr).toBe('');
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
}, 60_000);
