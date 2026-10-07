import { expect, test } from 'vitest';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { contractWorkspace } from './store-contract.ts';
import { createWorkspace, readWorkspace } from './store.ts';
import { mergeImport } from './merge.ts';
import { ReviewService } from './review.ts';
import type { ImportRecord } from '../model/index.ts';
import { LabelService } from './labels.ts';

const record = (
  id: string,
  date: string,
  status: 'complete' | 'incomplete' = 'complete',
): ImportRecord => ({
  id,
  platform: 'x',
  importedAt: date,
  exportCreatedAt: date,
  status,
  archives: ['contract'],
  accounts: [{ key: 'x:contract', handle: null }],
  adapter: { name: 'generated', version: '1' },
  variant: null,
  diagnostics: [],
  itemCount: 1,
});
test('re-import adds no duplicates, only newer metadata changes, and human decisions never change', async () => {
  const item = contractWorkspace().items[0]!;
  const store = createMemoryStore(new MemoryStoreBacking(createWorkspace()));
  const review = new ReviewService(store, {
    via: 'web-review',
    query: { selection: () => Promise.reject(new Error('Not used.')) },
  });
  try {
    expect(
      await mergeImport(store, record('first', '2026-01-01T00:00:00Z'), [item]),
    ).toMatchObject({ added: 1 });
    await review.decide({
      commandId: 'human',
      itemIds: [item.id],
      value: 'keep',
      expected: { [item.id]: 'undecided' },
    });
    const events = (await store.read(readWorkspace)).decisionEvents;
    expect(
      await mergeImport(store, record('newer', '2026-01-02T00:00:00Z'), [
        { ...item, engagement: { likes: 10, reposts: 2 } },
      ]),
    ).toMatchObject({ added: 0, updated: 1 });
    await mergeImport(store, record('older', '2025-01-01T00:00:00Z'), [
      { ...item, engagement: { likes: 99, reposts: 0 } },
    ]);
    expect((await store.read(readWorkspace)).items[0]?.engagement.likes).toBe(
      10,
    );
    expect(
      await mergeImport(store, record('conflict', '2026-01-03T00:00:00Z'), [
        { ...item, text: 'PLANTED_CONFLICT' },
      ]),
    ).toMatchObject({ added: 0, conflicts: 1 });
    const workspace = await store.read(readWorkspace);
    expect(workspace.items).toHaveLength(1);
    expect(workspace.items[0]?.text).toBe(item.text);
    expect(workspace.decisionEvents).toEqual(events);
    expect(workspace.imports.at(-1)?.diagnostics[0]?.category).toBe(
      'conflicting-items',
    );
  } finally {
    await store.close();
  }
});
test('incomplete imports stay hidden, then completing the same import exposes them', async () => {
  const store = createMemoryStore(new MemoryStoreBacking(createWorkspace()));
  try {
    const item = contractWorkspace().items[0]!;
    await mergeImport(
      store,
      record('partial', '2026-01-01T00:00:00Z', 'incomplete'),
      [item],
    );
    const labels = new LabelService(store);
    expect((await labels.batchNext({ shareWithAgent: true })).items).toEqual(
      [],
    );
    await mergeImport(store, record('partial', '2026-01-01T00:00:00Z'), [item]);
    expect(
      (await labels.batchNext({ shareWithAgent: true })).items.map(
        (value) => value.itemId,
      ),
    ).toEqual(['x:1']);
    await expect(
      mergeImport(store, record('bad', '2026-01-01T00:00:00Z'), [
        { ...item, id: '1' },
      ]),
    ).rejects.toMatchObject({ code: 'INVALID_ITEM_ID' });
    expect((await store.read(readWorkspace)).items).toHaveLength(1);
  } finally {
    await store.close();
  }
});
