import type { WorkspaceStore } from '@socialprune/core/workspace/store';
import { expect, test } from 'vitest';
import { instagramDailyCount, contextPace, CONTEXT_PACE } from './pace.ts';
import { ContextOrderSchema } from './order.ts';

test('P1 defaults and every partial pace override are explicit in main and canary modes', () => {
  const order = (fields: Record<string, unknown>) => ({
    value: ContextOrderSchema.parse({
      scope: 'context-instagram',
      account: 'generated_person',
      givenAt: '2026-10-15T12:00:00.000Z',
      words: 'Generated pace.',
      ...fields,
    }),
    sha256: 'a'.repeat(64),
  });
  expect(contextPace()).toEqual(CONTEXT_PACE);
  expect(contextPace()).toEqual({
    intervalMs: 30000,
    batch: 20,
    pauseMs: 900000,
    perDay: 200,
    scrollMs: 2000,
    expandMs: 3000,
  });
  expect(contextPace(order({}))).toEqual(CONTEXT_PACE);
  expect(contextPace(order({ secondsPerStep: 10 }))).toEqual({
    ...CONTEXT_PACE,
    intervalMs: 10000,
  });
  expect(contextPace(order({ secondsPerStep: 10 }), true)).toEqual(
    CONTEXT_PACE,
  );
  expect(contextPace(order({ stepsPerDay: 600, batchPause: false }))).toEqual({
    ...CONTEXT_PACE,
    perDay: 600,
    pauseMs: 0,
  });
});

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
