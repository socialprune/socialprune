import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { waitForApp } from './helpers.ts';
import { measurementIdentity } from '../tooling/measurement-identity.ts';

test('100k real import and literal substring query latency', async ({
  page,
  browserName,
}) => {
  test.setTimeout(600_000);
  const sourceHash = await measurementIdentity();
  const directory = await mkdtemp(join(tmpdir(), 'sp-w1-large-'));
  const zip = join(directory, 'generated-x.zip');
  try {
    await promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(
          new URL('../../../tools/fixture-gen/src/cli.ts', import.meta.url),
        ),
        'large',
        '--platform',
        'x',
        '--count',
        '100000',
        '--seed',
        '1',
        '--out',
        zip,
      ],
      { timeout: 60_000 },
    );
    await waitForApp(page);
    await page.getByTestId('archives').setInputFiles(zip);
    await page.getByTestId('import-button').click();
    await expect(page.getByTestId('import-state')).toHaveAttribute(
      'data-phase',
      'complete',
      { timeout: 300_000 },
    );
    const result = await page.evaluate(async () => {
      const snapshot = window.socialprune.getImportSnapshot();
      const opened = await window.workspace.open();
      if (opened.type !== 'opened' || opened.summary.counts.items !== 100_000)
        throw new Error('Real import did not store 100k items.');
      const accountKey = opened.summary.accounts[0]!.key;
      const samples: number[] = [];
      const totals: number[] = [];
      for (let generation = 1; generation <= 20; generation++) {
        const start = performance.now();
        const response = await window.workspace.request({
          type: 'query',
          requestId: crypto.randomUUID(),
          queryId: 'measured-query',
          generation,
          accountKey,
          filter: {},
          sort: [{ by: 'createdAt', direction: 'desc' }],
          search: generation % 2 ? 'synthetic' : 'invented',
        });
        samples.push(performance.now() - start);
        if (response.type !== 'queryResult')
          throw new Error('Query did not return.');
        totals.push(response.total);
      }
      const sorted = [...samples].sort((a, b) => a - b);
      return {
        stored: opened.summary.counts.items,
        importMs: snapshot.durationMs,
        batches: snapshot.batches,
        pageItems: snapshot.items.length,
        pageRows: window.workspace.rows.length,
        substringMs: samples,
        substringP50: sorted[9],
        substringP95: sorted[18],
        totals,
      };
    });
    expect(result.stored).toBe(100_000);
    expect(result.pageItems).toBe(0);
    expect(result.pageRows).toBeLessThanOrEqual(200);
    console.log(
      JSON.stringify({
        engine: browserName,
        sourceHash,
        workspaceMeasurement: result,
      }),
    );
    expect(await measurementIdentity()).toBe(sourceHash);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
