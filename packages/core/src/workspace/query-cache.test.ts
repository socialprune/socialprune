import { expect, test, vi } from 'vitest';
import { contractWorkspace } from './store-contract.ts';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { QueryEngine } from './query.ts';
import type { QueryFilter, QuerySort } from './protocol.ts';
import { ReviewService } from './review.ts';
import { LabelService } from './labels.ts';
import { mergeImport } from './merge.ts';
import type { ImportRecord, WorkspaceV2 } from '../model/index.ts';
import type { WorkspaceStore } from './store.ts';
import { contentHash } from './canonical.ts';

function initial(): WorkspaceV2 {
  const workspace = contractWorkspace();
  const template = workspace.items[0]!;
  workspace.items = [
    {
      ...template,
      id: 'x:1',
      text: 'Hand-written café first',
      engagement: { likes: null, reposts: null },
    },
    {
      ...template,
      id: 'x:2',
      text: 'Hand-written second',
      createdAt: '2026-01-02T00:00:00Z',
      engagement: { likes: 0, reposts: 1 },
    },
  ];
  workspace.counts.items = 2;
  return workspace;
}
function trackedStore(store: WorkspaceStore) {
  let itemScans = 0;
  const wrapper: WorkspaceStore = {
    read: (operation) =>
      store.read((tx) =>
        operation({
          ...tx,
          items: {
            ...tx.items,
            iterate(options) {
              itemScans++;
              return tx.items.iterate(options);
            },
          },
        }),
      ),
    write: (operation) => store.write(operation),
    close: () => store.close(),
  };
  return { store: wrapper, scans: () => itemScans };
}
async function ids(
  engine: QueryEngine,
  generation: number,
  options: { filter?: QueryFilter; search?: string; sort?: QuerySort } = {},
) {
  const response = await engine.query({
    queryId: 'hand-query',
    generation,
    accountKey: 'x:contract',
    ...options,
  });
  return {
    response,
    ids: (await engine.selection('hand-query', generation)).ids,
  };
}
test.each([false, true])(
  'second ReviewService commit appears in the next cached query; notification=%s',
  async (notify) => {
    const base = createMemoryStore(new MemoryStoreBacking(initial()));
    const { store, scans } = trackedStore(base);
    const engine = new QueryEngine(store);
    try {
      expect(
        (await ids(engine, 1, { filter: { decisions: ['delete'] } })).ids,
      ).toEqual([]);
      const other = new ReviewService(store, {
        via: 'local-review',
        query: { selection: (...args) => engine.selection(...args) },
      });
      const result = await other.decide({
        commandId: 'other-review',
        itemIds: ['x:1'],
        value: 'delete',
        expected: { 'x:1': 'undecided' },
      });
      expect(result).toMatchObject({ type: 'committed', revision: 1 });
      if (notify && result.type === 'committed')
        await engine.noteChanged({
          revision: result.revision,
          itemIds: ['x:1'],
        });
      const value = await ids(engine, 2, { filter: { decisions: ['delete'] } });
      expect(value.ids).toEqual(['x:1']);
      expect(value.response.counts.decisions).toEqual({
        keep: 0,
        delete: 1,
        later: 0,
        undecided: 0,
      });
      expect(scans()).toBe(notify ? 1 : 2);
    } finally {
      await base.close();
    }
  },
);
test.each([false, true])(
  'LabelService current assessment appears in the next cached query; notification=%s',
  async (notify) => {
    const base = createMemoryStore(new MemoryStoreBacking(initial()));
    const { store, scans } = trackedStore(base);
    const engine = new QueryEngine(store);
    try {
      expect(
        (await ids(engine, 1, { filter: { categories: ['unclear'] } })).ids,
      ).toEqual([]);
      await new LabelService(store).appendAssessment({
        assessmentId: 'generated-risk',
        submissionId: null,
        itemId: 'x:1',
        source: { kind: 'rules', name: 'hand-rules', version: null },
        category: 'unclear',
        risk: 2,
        reason: 'This generated sentence needs review.',
        evidence: null,
        confidence: null,
        createdAt: '2026-01-03T00:00:00Z',
      });
      if (notify) await engine.noteChanged({ revision: 1, itemIds: ['x:1'] });
      const value = await ids(engine, 2, {
        filter: {
          categories: ['unclear'],
          sources: ['rules'],
          risk: { min: 2, max: 3, unknown: 'exclude' },
        },
      });
      expect(value.ids).toEqual(['x:1']);
      expect(engine.window('hand-query', 2, 0, 200)[0]).toMatchObject({
        highestRisk: 2,
        categories: ['unclear'],
      });
      expect(scans()).toBe(notify ? 1 : 2);
    } finally {
      await base.close();
    }
  },
);
test.each([false, true])(
  'mergeImport adds and updates cached projection fields; notification=%s',
  async (notify) => {
    const workspace = initial();
    const base = createMemoryStore(new MemoryStoreBacking(workspace));
    const { store, scans } = trackedStore(base);
    const engine = new QueryEngine(store);
    try {
      expect((await ids(engine, 1, { search: 'added' })).ids).toEqual([]);
      const item = {
        ...workspace.items[0]!,
        id: 'x:3',
        text: 'Hand-written added item',
        createdAt: '2026-01-03T00:00:00Z',
      };
      const record: ImportRecord = {
        id: 'import-added',
        platform: 'x',
        importedAt: item.createdAt,
        exportCreatedAt: item.createdAt,
        status: 'complete',
        archives: ['contract'],
        accounts: [item.account],
        adapter: { name: 'generated', version: '1' },
        variant: null,
        diagnostics: [],
        itemCount: 2,
      };
      const merged = await mergeImport(store, record, [
        item,
        { ...workspace.items[1]!, engagement: { likes: 20, reposts: 5 } },
      ]);
      if (notify)
        await engine.noteChanged({
          revision: merged.revision,
          itemIds: ['x:2', 'x:3'],
        });
      expect((await ids(engine, 2, { search: 'added' })).ids).toEqual(['x:3']);
      expect(
        (
          await ids(engine, 3, {
            filter: { likes: { min: 20, max: null, unknown: 'exclude' } },
          })
        ).ids,
      ).toEqual(['x:2']);
      expect(scans()).toBe(notify ? 1 : 2);
    } finally {
      await base.close();
    }
  },
);
test.each([false, true])(
  'direct item write with raised runtime revision cannot leave cached text stale; notification=%s',
  async (notify) => {
    const base = createMemoryStore(new MemoryStoreBacking(initial()));
    const { store, scans } = trackedStore(base);
    const engine = new QueryEngine(store);
    try {
      expect(
        (await ids(engine, 1, { search: 'direct replacement' })).ids,
      ).toEqual([]);
      await store.write(async (tx) => {
        const item = await tx.items.get('x:1');
        expect(item).toBeDefined();
        await tx.items.put({
          ...item!,
          item: { ...item!.item, text: 'Direct replacement text' },
        });
        await tx.runtime.set({ revision: 1 });
      });
      if (notify) await engine.noteChanged({ revision: 1, itemIds: ['x:1'] });
      expect(
        (await ids(engine, 2, { search: 'direct replacement' })).ids,
      ).toEqual(['x:1']);
      expect(scans()).toBe(notify ? 1 : 2);
    } finally {
      await base.close();
    }
  },
);
test('revision gap and many notification force a rebuild rather than certifying partial updates', async () => {
  const base = createMemoryStore(new MemoryStoreBacking(initial()));
  const { store, scans } = trackedStore(base);
  const engine = new QueryEngine(store);
  try {
    await ids(engine, 1);
    await store.write(async (tx) => {
      await tx.runtime.set({ revision: 2 });
    });
    await engine.noteChanged({ revision: 2, itemIds: ['x:1'] });
    await ids(engine, 2);
    expect(scans()).toBe(2);
    await store.write(async (tx) => {
      await tx.runtime.set({ revision: 3 });
    });
    await engine.noteChanged({ revision: 3, itemIds: 'many' });
    await ids(engine, 3);
    expect(scans()).toBe(3);
  } finally {
    await base.close();
  }
});
test('hand-written revision oracle catches a cached engine whose runtime check is skipped', async () => {
  const base = createMemoryStore(new MemoryStoreBacking(initial()));
  let skipRevision = false;
  const broken: WorkspaceStore = {
    read: (operation) =>
      base.read((tx) =>
        operation({
          ...tx,
          runtime: {
            get: async () => {
              const value = await tx.runtime.get();
              return skipRevision ? { ...value, revision: 0 } : value;
            },
          },
        }),
      ),
    write: (operation) => base.write(operation),
    close: () => base.close(),
  };
  const engine = new QueryEngine(broken);
  try {
    const oracle = async (generation: number) => {
      expect(
        (await ids(engine, generation, { search: 'direct replacement' })).ids,
      ).toEqual(['x:1']);
    };
    await ids(engine, 1);
    await base.write(async (tx) => {
      const item = await tx.items.get('x:1');
      await tx.items.put({
        ...item!,
        item: { ...item!.item, text: 'Direct replacement text' },
      });
      await tx.runtime.set({ revision: 1 });
    });
    skipRevision = true;
    await expect(oracle(2)).rejects.toThrow();
    skipRevision = false;
    await oracle(3);
  } finally {
    await base.close();
  }
});
test('same-engine review commits patch only affected state entries with no extra item scan', async () => {
  const base = createMemoryStore(new MemoryStoreBacking(initial()));
  const { store, scans } = trackedStore(base);
  const engine = new QueryEngine(store);
  const review = new ReviewService(store, { query: engine, via: 'web-review' });
  try {
    await ids(engine, 1);
    const frozen = (await engine.selection('hand-query', 1)).ids;
    await review.decide({
      commandId: 'own',
      itemIds: ['x:1'],
      value: 'delete',
      expected: { 'x:1': 'undecided' },
    });
    expect(
      (await ids(engine, 2, { filter: { decisions: ['delete'] } })).ids,
    ).toEqual(['x:1']);
    await review.outcome({
      commandId: 'own-outcome',
      itemIds: ['x:1'],
      value: 'skipped',
      expected: { 'x:1': 'unknown' },
    });
    expect(
      (await ids(engine, 3, { filter: { outcomes: ['skipped'] } })).ids,
    ).toEqual(['x:1']);
    await review.undo('own-undo');
    expect(
      (await ids(engine, 4, { filter: { outcomes: ['skipped'] } })).ids,
    ).toEqual([]);
    await review.redo('own-redo');
    expect(
      (await ids(engine, 5, { filter: { outcomes: ['skipped'] } })).ids,
    ).toEqual(['x:1']);
    expect(scans()).toBe(1);
    expect(frozen).toEqual(['x:2', 'x:1']);
  } finally {
    await base.close();
  }
});
test('cached and fresh engines agree after decide, 1000-item bulk, undo and redo', async () => {
  const workspace = initial();
  const template = workspace.items[0]!;
  workspace.items = Array.from({ length: 1000 }, (_, index) => ({
    ...template,
    id: `x:${index}`,
    text: `${index % 3 === 0 ? 'CAFÉ' : 'Cafe'} differential ${index % 7}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    engagement: {
      likes: index % 2 === 0 ? null : index % 13,
      reposts: index % 5,
    },
  }));
  workspace.counts.items = workspace.items.length;
  const base = createMemoryStore(new MemoryStoreBacking(workspace));
  const { store, scans } = trackedStore(base);
  const cached = new QueryEngine(store);
  const review = new ReviewService(store, { query: cached, via: 'web-review' });
  const queries: { filter?: QueryFilter; search?: string; sort?: QuerySort }[] =
    [
      {},
      { filter: { decisions: ['delete'] } },
      { search: 'cafe\u0301' },
      {
        search: 'differential 2',
        filter: { likes: { min: 1, max: 10, unknown: 'include' } },
        sort: [
          { by: 'likes', direction: 'asc' },
          { by: 'id', direction: 'desc' },
        ],
      },
    ];
  let generation = 0;
  const compare = async () => {
    for (const query of queries) {
      const got = await ids(cached, ++generation, query);
      const fresh = await ids(new QueryEngine(base), 1, query);
      expect(got.ids).toEqual(fresh.ids);
      expect(got.response.counts).toEqual(fresh.response.counts);
    }
  };
  try {
    await compare();
    await review.decide({
      commandId: 'diff-one',
      itemIds: ['x:0'],
      value: 'keep',
      expected: { 'x:0': 'undecided' },
    });
    await compare();
    await cached.query({
      queryId: 'bulk',
      generation: 1,
      accountKey: 'x:contract',
    });
    const preview = await review.previewBulk({
      pageId: 'diff-page',
      previewId: 'diff-preview',
      queryId: 'bulk',
      generation: 1,
      value: 'delete',
      overwrite: ['undecided', 'keep'],
    });
    expect(preview.willChange).toBe(1000);
    expect(
      await review.confirmBulk({
        commandId: 'diff-bulk',
        pageId: 'diff-page',
        previewId: 'diff-preview',
      }),
    ).toMatchObject({ changed: 1000 });
    await compare();
    await review.undo('diff-undo');
    await compare();
    await review.redo('diff-redo');
    await compare();
    expect(scans()).toBe(1);
  } finally {
    await base.close();
  }
});
test('commit during a yielded query forces a fresh revision instead of publishing mixed counts', async () => {
  const workspace = initial();
  workspace.items = Array.from({ length: 5001 }, (_, index) => ({
    ...workspace.items[0]!,
    id: `x:${index}`,
  }));
  workspace.counts.items = workspace.items.length;
  const store = createMemoryStore(new MemoryStoreBacking(workspace));
  let mutate: (() => Promise<void>) | undefined;
  const engine = new QueryEngine(store, {
    yieldChunk: async () => {
      const action = mutate;
      mutate = undefined;
      await action?.();
    },
  });
  const review = new ReviewService(store, { query: engine, via: 'web-review' });
  try {
    await ids(engine, 1);
    mutate = async () => {
      await review.decide({
        commandId: 'during-scan',
        itemIds: ['x:5000'],
        value: 'delete',
        expected: { 'x:5000': 'undecided' },
      });
    };
    const result = await ids(engine, 2, { filter: { decisions: ['delete'] } });
    expect(result.ids).toEqual(['x:5000']);
    expect((await engine.selection('hand-query', 2)).revision).toBe(1);
  } finally {
    await store.close();
  }
});
test('32nd category bit and multiple current source kinds match without changing row category order', async () => {
  const workspace = initial();
  workspace.settings.categories = Array.from(
    { length: 32 },
    (_, index) => `category-${index}`,
  );
  workspace.assessments = [
    {
      assessmentId: 'a1',
      submissionId: null,
      itemId: 'x:1',
      source: { kind: 'rules', name: 'rules', version: null },
      category: 'category-31',
      risk: 1,
      reason: 'Generated reason first.',
      evidence: null,
      confidence: null,
      createdAt: workspace.createdAt,
    },
    {
      assessmentId: 'a2',
      submissionId: null,
      itemId: 'x:1',
      source: { kind: 'model', name: 'model', version: null },
      category: 'category-0',
      risk: 2,
      reason: 'Generated reason second.',
      evidence: null,
      confidence: null,
      createdAt: workspace.createdAt,
    },
  ];
  workspace.counts.assessments = 2;
  const store = createMemoryStore(new MemoryStoreBacking(workspace));
  try {
    const engine = new QueryEngine(store);
    expect(
      (
        await ids(engine, 1, {
          filter: { categories: ['category-31'], sources: ['model'] },
        })
      ).ids,
    ).toEqual(['x:1']);
    expect(engine.window('hand-query', 1, 0, 200)[0]?.categories).toEqual([
      'category-31',
      'category-0',
    ]);
  } finally {
    await store.close();
  }
});
test('failed optional projection hook cannot report a successfully saved command as STORAGE', async () => {
  const store = createMemoryStore(new MemoryStoreBacking(initial()));
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const review = new ReviewService(store, {
      via: 'web-review',
      query: {
        selection: () => Promise.reject(new Error('Not used.')),
        noteReviewCommitted: () => {
          throw new Error('Synthetic update failure.');
        },
      },
    });
    expect(
      await review.decide({
        commandId: 'saved',
        itemIds: ['x:1'],
        value: 'delete',
        expected: { 'x:1': 'undecided' },
      }),
    ).toMatchObject({ type: 'committed', changed: 1 });
    expect(warning).toHaveBeenCalledWith(
      'QUERY_PROJECTION_UPDATE_FAILED',
      expect.any(String),
    );
    expect(
      (await store.read(async (tx) => tx.state.get('x:1')))?.decision,
    ).toBe('delete');
  } finally {
    warning.mockRestore();
    await store.close();
  }
});
test('label submission revision fallback includes agent source and current risk', async () => {
  const workspace = initial();
  const store = createMemoryStore(new MemoryStoreBacking(workspace));
  const engine = new QueryEngine(store);
  try {
    expect(
      (await ids(engine, 1, { filter: { sources: ['agent'] } })).ids,
    ).toEqual([]);
    await new LabelService(store).submitLabels({
      schemaVersion: 1,
      submissionId: 'cache-label-file',
      source: { kind: 'agent', name: 'hand-agent', version: null },
      labels: [
        {
          itemId: 'x:2',
          contentHash: await contentHash(workspace.items[1]!.text),
          category: 'harmless',
          risk: 3,
          reason: 'Generated agent label for review.',
          evidence: null,
          confidence: null,
        },
      ],
    });
    expect(
      (
        await ids(engine, 2, {
          filter: {
            sources: ['agent'],
            risk: { min: 3, max: 3, unknown: 'exclude' },
          },
        })
      ).ids,
    ).toEqual(['x:2']);
    expect(engine.window('hand-query', 2, 0, 200)[0]?.highestRisk).toBe(3);
  } finally {
    await store.close();
  }
});
test('open-time preparation does not create a query vector and unchanged revisits never rescan items', async () => {
  const base = createMemoryStore(new MemoryStoreBacking(initial()));
  const { store, scans } = trackedStore(base);
  const engine = new QueryEngine(store);
  try {
    await engine.prepareProjection();
    expect(scans()).toBe(1);
    await expect(engine.selection('hand-query', 1)).rejects.toMatchObject({
      code: 'QUERY_EXPIRED',
    });
    expect((await ids(engine, 1)).ids).toEqual(['x:2', 'x:1']);
    await ids(engine, 2, { search: 'café' });
    await engine.prepareProjection();
    expect(scans()).toBe(1);
  } finally {
    await base.close();
  }
});
test('direct event-log commit is canonical even when a notification precedes a derived-state update', async () => {
  const base = createMemoryStore(new MemoryStoreBacking(initial()));
  const engine = new QueryEngine(base);
  try {
    await ids(engine, 1);
    await base.write(async (tx) => {
      await tx.decisionEvents.append([
        {
          eventId: 'direct-event',
          seq: 1,
          itemId: 'x:1',
          previous: 'undecided',
          value: 'delete',
          decidedAt: '2026-01-03T00:00:00Z',
          source: { kind: 'human', via: 'local-review' },
          action: {
            id: 'direct-action',
            kind: 'single',
            size: 1,
            reverts: null,
          },
        },
      ]);
      await tx.runtime.set({ revision: 1 });
    });
    await engine.noteChanged({ revision: 1, itemIds: ['x:1'] });
    expect(
      (await ids(engine, 2, { filter: { decisions: ['delete'] } })).ids,
    ).toEqual(['x:1']);
  } finally {
    await base.close();
  }
});
