import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { runPowerShell } from '../packaging/windows-powershell.ts';

test.skipIf(process.platform !== 'win32')(
  'a generated sleeping query exposes kill, limit, signal and duration in its thrown message',
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'socialprune-query-timeout-'));
    try {
      const script = join(scratch, 'generated-sleep.ps1');
      await writeFile(script, '[Threading.Thread]::Sleep(10000)');
      const result = await runPowerShell(
        ['-NoProfile', '-NonInteractive', '-File', script],
        { timeout: 300, windowsHide: true },
      ).then(
        () => {
          throw new Error('GENERATED_TIMEOUT_WAS_NOT_ENFORCED');
        },
        (error: unknown) => error,
      );
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain('killed=true');
      expect((result as Error).message).toContain('timeoutMs=300');
      expect((result as Error).message).toContain('signal=');
      expect((result as Error).message).toMatch(/durationMs=\d+/);
      console.log(
        'GENERATED_TIMEOUT_RECEIPT',
        (result as Error).message.split('\n')[0],
      );
      const duration: unknown = expect.any(Number);
      expect(result).toMatchObject({
        powerShell: {
          killed: true,
          timeoutMs: 300,
          durationMs: duration,
        },
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
);

test('query measurements persist only class, duration and outcome, including native failures', async () => {
  const module = await import('../packaging/windows-powershell.ts');
  expect(module).toHaveProperty('setQueryMeasurementDirectory');
  expect(module).toHaveProperty('runNativeQuery');
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-query-records-'));
  try {
    module.setQueryMeasurementDirectory(scratch);
    const result = await module.runNativeQuery(
      process.execPath,
      ['-e', 'process.stdout.write("generated private payload")'],
      { timeout: 60000, queryClass: 'generated-success' },
    );
    expect(result.stdout).toBe('generated private payload');
    await expect(
      module.runNativeQuery(
        process.execPath,
        ['-e', 'setTimeout(()=>{},10000)'],
        { timeout: 100, queryClass: 'generated-timeout' },
      ),
    ).rejects.toThrow(/killed=true.*timeoutMs=100/);
    const files = (await readdir(scratch)).filter((name) =>
      name.endsWith('.json'),
    );
    expect(files).toHaveLength(1);
    const text = await readFile(join(scratch, files[0]!), 'utf8');
    const measured = JSON.parse(text) as {
      queries: { count: number; durationsMs: number[] }[];
    };
    for (const query of measured.queries) {
      expect(query.durationsMs).toHaveLength(query.count);
      expect(
        query.durationsMs.every(
          (value) => Number.isFinite(value) && value >= 0,
        ),
      ).toBe(true);
    }
    expect(text).not.toContain('generated private payload');
    expect(text).not.toContain(scratch);
    const duration: unknown = expect.any(Number);
    const last: unknown = expect.objectContaining({
      killed: true,
      timeoutMs: 100,
      durationMs: duration,
    });
    const queries: unknown = expect.arrayContaining([
      expect.objectContaining({
        queryClass: 'generated-success',
        count: 1,
        failures: 0,
        maximumMs: duration,
      }),
      expect.objectContaining({
        queryClass: 'generated-timeout',
        count: 1,
        failures: 1,
        last,
      }),
    ]);
    expect(JSON.parse(text)).toMatchObject({
      version: 1,
      queries,
    });
  } finally {
    module.setQueryMeasurementDirectory(undefined);
    await rm(scratch, { recursive: true, force: true });
  }
});

test('a restricted proof query writes only in its explicit evidence workspace and is collectable', async () => {
  const module = await import('../packaging/windows-powershell.ts');
  const { collectProof } = await import('../e2e/proof-collection.ts');
  const scratch = await mkdtemp(
    join(tmpdir(), 'socialprune-query-collection-'),
  );
  try {
    const evidence = join(scratch, 'evidence');
    const output = join(scratch, 'parent');
    await (await import('node:fs/promises')).mkdir(output);
    module.setQueryMeasurementDirectory(evidence);
    await module.runNativeQuery(
      process.execPath,
      ['-e', 'process.exitCode=0'],
      { timeout: 60000, queryClass: 'generated-restricted' },
    );
    const result = await collectProof(scratch, output);
    expect(result.collected).toHaveLength(1);
    expect(
      JSON.parse(await readFile(join(output, result.collected[0]!), 'utf8')),
    ).toMatchObject({
      queries: [
        expect.objectContaining({
          queryClass: 'generated-restricted',
          count: 1,
          failures: 0,
        }),
      ],
    });
  } finally {
    module.setQueryMeasurementDirectory(undefined);
    await rm(scratch, { recursive: true, force: true });
  }
});

test('fixed native query execution in test and e2e cannot sidestep the receipt helper', async () => {
  const { directory } = await import('../packaging/paths.ts');
  async function visit(folder: string): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (
        entry.name.endsWith('.ts') &&
        entry.name !== 'query-timeouts.test.ts'
      ) {
        const text = await readFile(file, 'utf8');
        expect(text, file).not.toMatch(
          /import\s*\{[^}]*\bexecFile\b[^}]*\}\s*from/,
        );
      }
    }
  }
  await visit(join(directory, 'test'));
  await visit(join(directory, 'e2e'));
});
