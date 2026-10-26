import { expect, test } from 'vitest';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { writeInstagramContextContract } from './store-contract.ts';
import { readWorkspace } from './store.ts';
import { InstagramContextWriter } from './instagram-context-writer.ts';
import { createBackup, readBackup, restoreBackup } from './backup.ts';
import { validateWorkspace } from './validation.ts';
import { InstagramContextSchema } from '../model/index.ts';

test('likes refresh writes once, settles its own receipt, preserves confirmation and backup evidence', async () => {
  const store = createMemoryStore();
  const prior = await writeInstagramContextContract(store);
  const writer = new InstagramContextWriter(store);
  const at = '2026-10-26T00:00:00.000Z';
  try {
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
