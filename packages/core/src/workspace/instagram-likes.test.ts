import { expect, test } from 'vitest';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { writeInstagramContextContract } from './store-contract.ts';
import { readWorkspace } from './store.ts';
import { InstagramContextWriter } from './instagram-context-writer.ts';
import { createBackup, readBackup, restoreBackup } from './backup.ts';
import { validateWorkspace } from './validation.ts';
import { InstagramContextSchema } from '../model/index.ts';
import { QueryEngine } from './query.ts';

test('likes refresh writes once, settles its own receipt, preserves confirmation and backup evidence', async () => {
  const store = createMemoryStore();
  const prior = await writeInstagramContextContract(store);
  const writer = new InstagramContextWriter(store);
  const at = '2026-10-26T00:00:00.000Z';
  const query = new QueryEngine(store);
  try {
    await store.write(async (tx) => {
      await tx.assessments.append([
        {
          assessmentId: 'generated-likes-hit',
          submissionId: null,
          itemId: prior.itemId,
          source: { kind: 'rules', name: 'generated', version: null },
          category: 'political',
          risk: 2,
          reason: 'Generated political suggestion.',
          evidence: null,
          confidence: null,
          createdAt: at,
        },
      ]);
    });
    await store.write(async (tx) => {
      const meta = await tx.meta.get();
      await tx.meta.set({
        ...meta,
        settings: {
          ...meta.settings,
          criteria: { ...meta.settings.criteria!, selected: ['political'] },
          keepRules: [
            {
              id: 'generated-likes',
              enabled: true,
              kind: 'likes-at-least',
              count: 10,
              alsoWhenUnknown: false,
            },
          ],
        },
      });
    });
    expect(
      (await query.planCounts(prior.accountKey)).held['generated-likes'],
    ).toBe(0);
    await writer.startRun({
      runId: 'generated-refresh',
      accountKey: prior.accountKey,
      planHash: 'e'.repeat(64),
      startedAt: at,
    });
    await writer.sending({
      attemptId: 'generated-refresh-send',
      runId: 'generated-refresh',
      itemId: prior.itemId,
      at,
      refreshLikes: true,
    });
    await writer.step('generated-refresh', at, 'Europe/Berlin');
    await writer.fillLikes(
      'generated-refresh-send',
      { count: 12, source: 'answer' },
      at,
    );
    expect(
      await store.read((tx) => tx.instagramContext.get(prior.itemId)),
    ).toEqual({ ...prior, likes: { count: 12, source: 'answer' } });
    expect(
      (await query.planCounts(prior.accountKey)).held['generated-likes'],
    ).toBe(1);
    const cards = await query.feedWindow({
      accountKey: prior.accountKey,
      tab: 'all',
      offset: 0,
      limit: 10,
    });
    expect(cards.cards[0]!.item.engagement.likes).toBe(12);
    expect(cards.cards[0]!.holdingRules).toContain('generated-likes');
    await query.query({
      queryId: 'generated-likes-filter',
      generation: 1,
      accountKey: prior.accountKey,
      filter: { likes: { min: 10, max: null, unknown: 'exclude' } },
    });
    expect(
      query.window('generated-likes-filter', 1, 0, 10).map((row) => row.id),
    ).toEqual([prior.itemId]);
    await expect(
      store.write((tx) =>
        tx.instagramContext.fillLikes({
          ...prior,
          likes: { count: 13, source: 'dom' },
        }),
      ),
    ).rejects.toThrow();
    await writer.endRun({
      runId: 'generated-refresh',
      endedAt: at,
      endReason: 'done',
      bodyShapes: {},
      profileReport: {
        accountBefore: null,
        accountAfter: null,
        extensionsBefore: 0,
        extensionsAfter: 0,
        changedFiles: [],
        unexpectedRequests: [],
      },
    });
    const value = validateWorkspace(await store.read(readWorkspace));
    expect(value.schemaVersion).toBe(11);
    const text = await readBackup(createBackup(store).chunks);
    expect(text.instagramContext).toEqual(value.instagramContext);
    const target = createMemoryStore();
    try {
      await restoreBackup(target, createBackup(store).chunks);
      expect((await target.read(readWorkspace)).instagramContext).toEqual(
        value.instagramContext,
      );
    } finally {
      await target.close();
    }
    expect(() => validateWorkspace({ ...value, schemaVersion: 10 })).toThrow();
    expect(
      () => new MemoryStoreBacking({ ...value, schemaVersion: 10 }),
    ).toThrow();
    expect(
      InstagramContextSchema.safeParse({
        ...prior,
        confirmedBy: 'list',
        comment: { id: null, createdAt: null, expandClicks: 0 },
        likes: { count: 1, source: 'dom' },
      }).success,
    ).toBe(false);
  } finally {
    await store.close();
  }
});
