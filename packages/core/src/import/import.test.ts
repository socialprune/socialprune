import { expect, test } from 'vitest';
import { importArchive, importExitCode, stableId } from './index.ts';
import { createMemoryArchive } from '../archive/index.ts';
import type {
  Detection,
  ParseEvent,
  PlatformAdapter,
} from '../adapter/index.ts';
import type { Item } from '../model/index.ts';
import { sampleItem, timestamp } from '../testing.ts';

function fake(
  platform = 'x',
  result: Detection['result'] = 'match',
  events: ParseEvent[] = [],
): PlatformAdapter {
  return {
    platform,
    name: `fake-${platform}`,
    version: '1',
    detect: () =>
      Promise.resolve({
        result,
        variant: null,
        reason: 'Synthetic detection.',
      }),
    async *parse() {
      await Promise.resolve();
      for (const event of events) yield event;
    },
    deletionHint: () => ({ action: 'delete', url: null, group: null }),
  };
}
test('detection returns unknown format/html export and maps exit statuses', async () => {
  const archive = createMemoryArchive('test', {});
  expect((await importArchive(archive, [fake('x', 'no-match')])).status).toBe(
    'unknown-format',
  );
  expect(
    (await importArchive(archive, [fake('x', 'html-export')])).status,
  ).toBe('html-export');
  expect(
    ['ok', 'partial', 'unknown-format', 'html-export'].map((status) =>
      importExitCode(
        status as 'ok' | 'partial' | 'unknown-format' | 'html-export',
      ),
    ),
  ).toEqual([0, 4, 3, 1]);
  await archive.close();
});
test('both matching adapters import separate records with first-ID wins, batching and cumulative progress', async () => {
  const archive = createMemoryArchive('test', {});
  const batches: Item[][] = [];
  const progress: number[] = [];
  const events: ParseEvent[] = [
    { type: 'account', account: { key: 'x:account', handle: null } },
    { type: 'meta', exportCreatedAt: timestamp },
    ...[0, 1, 2].map((i): ParseEvent => ({
      type: 'item',
      item: sampleItem(`x:${i}`),
    })),
    { type: 'item', item: { ...sampleItem('x:0'), text: 'Duplicate text.' } },
  ];
  const result = await importArchive(
    archive,
    [
      fake('x', 'match', events),
      fake('new-platform', 'match', [
        { type: 'item', item: sampleItem('new-platform:1', 'new-platform') },
      ]),
    ],
    {
      now: () => new Date(timestamp),
      batchSize: 2,
      onItems(batch) {
        batches.push(batch);
      },
      onProgress({ items }) {
        progress.push(items);
      },
    },
  );
  expect(result.status).toBe('ok');
  expect(
    result.records.map(({ platform, itemCount }) => [platform, itemCount]),
  ).toEqual([
    ['x', 3],
    ['new-platform', 1],
  ]);
  expect(result.records[0]?.diagnostics).toContainEqual({
    category: 'duplicate-items',
    status: 'skipped',
    files: [],
    count: 1,
    message: 'Duplicate item IDs were omitted.',
  });
  expect(batches.map((batch) => batch.length)).toEqual([2, 1, 1]);
  expect(batches[0]?.[0]?.text).toBe('Generated text.');
  expect(progress).toEqual([2, 3, 4]);
  expect(result.records[0]?.accounts).toHaveLength(1);
  expect(result.records[0]?.exportCreatedAt).toBe(timestamp);
  await archive.close();
});
test('invalid items never reach consumers and unreadable diagnostics yield partial without values', async () => {
  const archive = createMemoryArchive('test', {});
  const invalid = {
    ...sampleItem(),
    id: 987654,
    text: 'PLANTED_INVALID_VALUE',
  } as unknown as Item;
  const accepted: Item[] = [];
  const result = await importArchive(
    archive,
    [
      fake('x', 'match', [
        { type: 'item', item: invalid },
        { type: 'item', item: sampleItem('other:1', 'other') },
        {
          type: 'diagnostic',
          diagnostic: {
            category: 'posts',
            status: 'unreadable',
            files: [],
            count: 0,
            message: null,
          },
        },
      ]),
    ],
    {
      onItems: (batch) => {
        accepted.push(...batch);
      },
    },
  );
  expect(result.status).toBe('partial');
  expect(accepted).toEqual([]);
  expect(JSON.stringify(result)).not.toContain('PLANTED_INVALID_VALUE');
  expect(JSON.stringify(result)).not.toContain('987654');
  expect(
    result.records[0]?.diagnostics.find(
      ({ category }) => category === 'invalid-items',
    )?.count,
  ).toBe(2);
  await archive.close();
});
test('adapter failure becomes partial, but cancellation stops detection/parsing/consumer dispatch', async () => {
  const archive = createMemoryArchive('test', {});
  const broken = fake();
  broken.parse = async function* () {
    await Promise.resolve();
    yield { type: 'item', item: sampleItem() };
    throw new Error('PLANTED_THROW_VALUE');
  };
  const summary = await importArchive(archive, [broken]);
  expect(summary.status).toBe('partial');
  expect(JSON.stringify(summary)).not.toContain('PLANTED_THROW_VALUE');
  const aborted = new AbortController();
  aborted.abort();
  await expect(
    importArchive(archive, [fake()], { signal: aborted.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  const controller = new AbortController();
  await expect(
    importArchive(
      archive,
      [fake('x', 'match', [{ type: 'item', item: sampleItem() }])],
      {
        batchSize: 1,
        signal: controller.signal,
        onItems() {
          controller.abort();
        },
      },
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
  await archive.close();
});
test('stable hashes are hex, deterministic, and distinguish ambiguous part joins', async () => {
  expect(await stableId(['a', 'bc'])).toMatch(/^[a-f0-9]{64}$/);
  expect(await stableId(['a', 'bc'])).toBe(await stableId(['a', 'bc']));
  expect(await stableId(['a', 'bc'])).not.toBe(await stableId(['ab', 'c']));
});

test('consumer failures propagate rather than becoming successful partial imports', async () => {
  const archive = createMemoryArchive('test', {});
  await expect(
    importArchive(
      archive,
      [fake('x', 'match', [{ type: 'item', item: sampleItem() }])],
      {
        batchSize: 1,
        onItems() {
          throw new Error('Consumer rejected the batch.');
        },
      },
    ),
  ).rejects.toThrow('Consumer rejected the batch.');
  await archive.close();
});
test('abort returns promptly when an adapter is waiting on an unrelated producer', async () => {
  const archive = createMemoryArchive('test', {});
  const controller = new AbortController();
  const adapter = fake();
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  adapter.parse = async function* () {
    await waiting;
    yield { type: 'item', item: sampleItem() };
  };
  const task = importArchive(archive, [adapter], {
    signal: controller.signal,
  });
  await Promise.resolve();
  controller.abort();
  try {
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    release();
    await archive.close();
  }
});
