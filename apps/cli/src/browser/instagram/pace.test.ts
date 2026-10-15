import type { WorkspaceStore } from '@socialprune/core/workspace/store';
import { expect, test } from 'vitest';
import { instagramDailyCount } from './pace.ts';

test('the daily counter filters the platform even when a foreign journal carries the same account key', async () => {
  // Deliberately hostile journal input, not a valid core workspace fixture.
  const runs = [
    {
      platform: 'x',
      accountKey: 'instagram:generated',
      startedAt: '2026-10-15T23:30:00.000Z',
      pageOpens: 200,
      lastPageOpenedAt: '2026-10-15T23:30:00.000Z',
    },
    {
      platform: 'instagram',
      accountKey: 'instagram:generated',
      startedAt: '2026-10-15T23:30:00.000Z',
      pageOpens: 2,
      lastPageOpenedAt: '2026-10-15T23:30:00.000Z',
    },
  ];
  const store = {
    read: (read: (tx: unknown) => Promise<unknown>) =>
      read({
        browserRuns: {
          iterate: async function* () {
            await Promise.resolve();
            yield* runs;
          },
        },
      }),
  } as unknown as WorkspaceStore;
  expect(
    (
      await instagramDailyCount(
        store,
        'instagram:generated',
        new Date('2026-10-16T00:30:00.000Z'),
        'Europe/Berlin',
      )
    ).used,
  ).toBe(2);
  expect(
    (
      await instagramDailyCount(
        store,
        'instagram:generated',
        new Date('2026-10-15T00:30:00.000Z'),
        'Europe/Berlin',
      )
    ).used,
  ).toBe(0);
});
