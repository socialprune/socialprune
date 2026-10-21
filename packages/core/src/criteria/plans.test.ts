import { expect, test } from 'vitest';
import { createWorkspace } from '../workspace/store.ts';
import { validateWorkspace } from '../workspace/validation.ts';
import {
  createMemoryStore,
  MemoryStoreBacking,
} from '../workspace/memory-store.ts';
import { createBackup, restoreBackup } from '../workspace/backup.ts';
import { readWorkspace } from '../workspace/store.ts';
import { generatedItem } from './rules-fixture.ts';
import { ReviewPlanSchema } from './schema.ts';

const chunks = (value: unknown) =>
  (async function* () {
    await Promise.resolve();
    yield JSON.stringify(value);
  })();
test('review plans reference one human bulk delete action and round-trip append-only', async () => {
  const value = createWorkspace();
  value.items = [generatedItem()];
  value.decisionEvents = [
    {
      eventId: 'event',
      seq: 1,
      itemId: 'x:1',
      value: 'delete',
      previous: 'undecided',
      decidedAt: value.createdAt,
      source: { kind: 'human', via: 'web-review' },
      action: { id: 'bulk', kind: 'bulk', size: 1, reverts: null },
    },
  ];
  value.reviewPlans = [
    ReviewPlanSchema.parse({
      actionId: 'bulk',
      accountKey: 'x:generated',
      createdAt: value.createdAt,
      criteria: [],
      level: 2,
      keepRules: [],
      counts: { suggested: 1, held: 0, kept: 0, unclear: 0, marked: 0, all: 1 },
      sources: [],
    }),
  ];
  value.counts = {
    ...value.counts,
    items: 1,
    decisionEvents: 1,
    reviewPlans: 1,
  };
  expect(validateWorkspace(value)).toEqual(value);
  const source = createMemoryStore(new MemoryStoreBacking(value));
  const target = createMemoryStore();
  try {
    await restoreBackup(
      target,
      createBackup(source, { now: new Date(value.createdAt) }).chunks,
    );
    expect((await target.read(readWorkspace)).reviewPlans).toEqual(
      value.reviewPlans,
    );
    await expect(
      target.write((tx) => tx.reviewPlans.add(value.reviewPlans![0]!)),
    ).rejects.toThrow();
    for (const change of [
      { ...value.reviewPlans[0]!, actionId: 'missing' },
      { ...value.reviewPlans[0]!, accountKey: 'x:foreign' },
      {
        ...value.reviewPlans[0]!,
        counts: { ...value.reviewPlans[0]!.counts, suggested: 2 },
      },
    ]) {
      const invalid = { ...value, reviewPlans: [change] };
      expect(() => validateWorkspace(invalid)).toThrow();
      const store = createMemoryStore();
      try {
        await expect(restoreBackup(store, chunks(invalid))).rejects.toThrow();
      } finally {
        await store.close();
      }
    }
  } finally {
    await source.close();
    await target.close();
  }
});
