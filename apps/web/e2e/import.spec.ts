import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { FIXTURES_ROOT, listFixtureVariants } from '@socialprune/fixture-gen';
import {
  comparableRecords,
  fixtureZips,
  importFiles,
  observeImport,
  waitForApp,
} from './helpers.ts';
import type { ExpectedFixture } from './helpers.ts';

const discovered = await Promise.all(
  ['x', 'instagram'].map(async (platform) => ({
    platform,
    ids: await listFixtureVariants(platform),
  })),
);
const eligible = new Map<string, number>();

test('the fixture sweep is populated for both platforms', () => {
  for (const { platform, ids } of discovered) {
    expect(ids.length, platform).toBeGreaterThan(0);
    expect(
      eligible.get(platform) ?? 0,
      `${platform} importable variants`,
    ).toBeGreaterThan(0);
  }
});

for (const { platform, ids } of discovered) {
  for (const id of ids) {
    const expected = JSON.parse(
      await readFile(
        join(FIXTURES_ROOT, platform, id, 'expected.json'),
        'utf8',
      ),
    ) as ExpectedFixture;
    if (expected.status === 'unknown-format') continue;
    eligible.set(platform, (eligible.get(platform) ?? 0) + 1);
    test(`imports ${platform}/${id} without external requests or policy violations`, async ({
      context,
      page,
    }) => {
      const audit = await observeImport(context, page);
      const fixture = await fixtureZips(platform, id);
      try {
        await waitForApp(page);
        const result = await importFiles(page, fixture.files);
        expect(result.summary?.status).toBe(expected.status);
        expect(comparableRecords(result.summary?.records ?? [])).toEqual(
          comparableRecords(expected.records),
        );
        expect(result.items.map(({ id }) => id).sort()).toEqual(
          expected.items.map(({ id }) => id).sort(),
        );
        expect(result.receivedItems).toBe(expected.items.length);
        await audit.assert();
      } finally {
        await fixture.cleanup();
      }
    });
  }
}

test('rejects executable X assignment data without executing it in the page or worker', async ({
  context,
  page,
}) => {
  const x = discovered.find(({ platform }) => platform === 'x');
  const variants = await Promise.all(
    (x?.ids ?? []).map(async (id) => ({
      id,
      metadata: JSON.parse(
        await readFile(join(FIXTURES_ROOT, 'x', id, 'variant.json'), 'utf8'),
      ) as { description: string },
    })),
  );
  const injection = variants.find(({ id, metadata }) =>
    /inject|execut|iife/i.test(`${id} ${metadata.description}`),
  );
  expect(
    injection,
    'An X assignment injection fixture must exist.',
  ).toBeDefined();
  if (!injection) throw new Error('Missing injection fixture.');
  const audit = await observeImport(context, page);
  const fixture = await fixtureZips('x', injection.id);
  try {
    await waitForApp(page);
    const result = await importFiles(page, fixture.files);
    expect(result.summary?.status).toBe('partial');
    expect(
      await page.evaluate(() => Reflect.get(globalThis, '__pwned') as unknown),
    ).toBeUndefined();
    expect(page.workers()).toHaveLength(1);
    for (const worker of page.workers()) {
      expect(
        await worker.evaluate(
          () => Reflect.get(globalThis, '__pwned') as unknown,
        ),
      ).toBeUndefined();
    }
    await audit.assert();
  } finally {
    await fixture.cleanup();
  }
});

test('aborts after real batches, releases the archive and imports again in the same worker', async ({
  context,
  page,
}) => {
  test.setTimeout(60_000);
  const audit = await observeImport(context, page, { abortOnFirstItems: true });
  const itemCount = 12_000;
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-abort-'));
  const large = join(directory, 'generated-x.zip');
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
        String(itemCount),
        '--seed',
        '42',
        '--out',
        large,
      ],
      { timeout: 30_000 },
    );
    await waitForApp(page);
    const worker = page.workers()[0];
    if (!worker) throw new Error('The import worker did not start.');
    await page.getByLabel('Export ZIP files').setInputFiles(large);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByTestId('import-state')).toHaveAttribute(
      'data-phase',
      'aborted',
    );
    expect(
      await page.evaluate(
        () =>
          Reflect.get(globalThis, '__abortTrigger') as {
            id: number;
            phaseBefore: string;
            receivedBefore: number;
          } | null,
      ),
    ).toEqual({ id: 1, phaseBefore: 'importing', receivedBefore: 0 });
    const messages = await page.evaluate(
      () =>
        Reflect.get(globalThis, '__workerMessages') as {
          type: string;
          id: number;
        }[],
    );
    const terminalIndex = messages.findIndex(({ type }) => type === 'aborted');
    expect(terminalIndex).toBeGreaterThan(0);
    const aborted = await page.evaluate(() => {
      const { batches, receivedItems, items, abortLatencyMs } =
        window.socialprune.getImportSnapshot();
      return { batches, receivedItems, count: items.length, abortLatencyMs };
    });
    expect(aborted.receivedItems).toBeGreaterThan(0);
    expect(aborted.receivedItems).toBeLessThan(itemCount);
    expect(aborted.count).toBe(0);
    expect(aborted.abortLatencyMs).toBeLessThan(3000);
    await page.waitForTimeout(200);
    expect(
      await page.evaluate(() => window.socialprune.getImportSnapshot().batches),
    ).toBe(aborted.batches);
    expect(
      await page.evaluate((index) => {
        const messages = Reflect.get(globalThis, '__workerMessages') as {
          type: string;
          id: number;
        }[];
        return messages.slice(index + 1).filter(({ type }) => type === 'items');
      }, terminalIndex),
    ).toEqual([]);
    expect(page.workers()[0]).toBe(worker);
    const id = discovered
      .find(({ platform }) => platform === 'x')
      ?.ids.find((id) => /current/.test(id));
    if (!id)
      throw new Error(
        'A current X fixture is needed for the post-abort import.',
      );
    const fixture = await fixtureZips('x', id);
    try {
      const result = await importFiles(page, fixture.files);
      expect(result.summary?.status).toBe(fixture.expected.status);
      expect(result.items.map(({ id }) => id).sort()).toEqual(
        fixture.expected.items.map(({ id }) => id).sort(),
      );
    } finally {
      await fixture.cleanup();
    }
    await audit.assert();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
