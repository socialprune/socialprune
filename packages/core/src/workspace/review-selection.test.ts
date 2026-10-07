import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import type { DecisionValue } from '../model/index.ts';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { contractWorkspace } from './store-contract.ts';
import { readWorkspace } from './store.ts';
import { QueryEngine } from './query.ts';
import { ReviewService } from './review.ts';
import {
  BulkPreviewSchema,
  HttpReviewRequestSchema,
  PreviewBulkRequestSchema,
  WorkspaceReplySchema,
  WorkspaceRequestSchema,
} from './protocol.ts';

function selectionWorkspace() {
  const workspace = contractWorkspace();
  const item = workspace.items[0]!;
  workspace.items = Array.from({ length: 12 }, (_, index) => ({
    ...item,
    id: `x:${index + 1}`,
    text:
      index === 9
        ? 'Filtered out generated item.'
        : `Visible generated item ${index + 1}.`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    account: { key: index < 10 ? 'x:contract' : 'x:other', handle: null },
  }));
  workspace.counts.items = workspace.items.length;
  return workspace;
}
function setup() {
  const store = createMemoryStore(new MemoryStoreBacking(selectionWorkspace()));
  const query = new QueryEngine(store);
  let id = 0;
  const review = new ReviewService(store, {
    query,
    via: 'web-review',
    now: () => new Date('2026-02-01T00:00:00.000Z'),
    uuid: () => `selection-${++id}`,
  });
  return { store, query, review };
}
function request(itemIds?: string[]) {
  return {
    requestId: 'selection-request',
    type: 'previewBulk',
    pageId: 'selection-page',
    previewId: 'selection-preview',
    queryId: 'selection-query',
    generation: 1,
    value: 'delete',
    overwrite: ['undecided', 'later'],
    ...(itemIds === undefined ? {} : { itemIds }),
  };
}
async function currentValues(
  store: ReturnType<typeof createMemoryStore>,
): Promise<[string, DecisionValue][]> {
  return store.read(async (tx) => {
    const values: [string, DecisionValue][] = [];
    for await (const state of tx.state.iterate())
      values.push([state.itemId, state.decision]);
    return values;
  });
}

test('selection of three in a ten-item account query freezes and changes exactly those three, then undo restores only them', async () => {
  const { store, query, review } = setup();
  try {
    expect(
      await query.query({
        queryId: 'selection-query',
        generation: 1,
        accountKey: 'x:contract',
      }),
    ).toMatchObject({ total: 10 });
    const selected = ['x:2', 'x:5', 'x:9'];
    const preview = await review.previewBulk({
      pageId: 'selection-page',
      previewId: 'selection-preview',
      queryId: 'selection-query',
      generation: 1,
      value: 'delete',
      overwrite: ['undecided'],
      itemIds: selected,
    });
    expect(preview).toMatchObject({
      total: 3,
      willChange: 3,
      unchanged: 0,
      selection: { requested: 3, inView: 3, notInView: 0 },
      byCurrentValue: { keep: 0, delete: 0, later: 0, undecided: 3 },
    });
    expect(preview.sample.map((row) => row.id)).toEqual(['x:9', 'x:5', 'x:2']);
    expect(BulkPreviewSchema.parse(preview)).toEqual(preview);
    expect(
      WorkspaceReplySchema.parse({
        type: 'bulkPreview',
        requestId: 'reply',
        ...preview,
      }),
    ).toMatchObject({ selection: { requested: 3, inView: 3, notInView: 0 } });
    selected.splice(0, selected.length, 'x:1');
    const result = await review.confirmBulk({
      commandId: 'selection-confirm',
      pageId: 'selection-page',
      previewId: 'selection-preview',
    });
    expect(result).toMatchObject({ type: 'committed', changed: 3 });
    expect(await currentValues(store)).toEqual([
      ['x:1', 'undecided'],
      ['x:2', 'delete'],
      ['x:3', 'undecided'],
      ['x:4', 'undecided'],
      ['x:5', 'delete'],
      ['x:6', 'undecided'],
      ['x:7', 'undecided'],
      ['x:8', 'undecided'],
      ['x:9', 'delete'],
      ['x:10', 'undecided'],
      ['x:11', 'undecided'],
      ['x:12', 'undecided'],
    ]);
    expect(
      await review.confirmBulk({
        commandId: 'selection-confirm',
        pageId: 'selection-page',
        previewId: 'selection-preview',
      }),
    ).toEqual(result);
    const events = (await store.read(readWorkspace)).decisionEvents;
    expect(events.map((event) => event.itemId)).toEqual(['x:9', 'x:5', 'x:2']);
    expect(await review.undo('selection-undo')).toMatchObject({
      changed: 3,
      skipped: 0,
    });
    expect(
      (await currentValues(store)).every(
        ([_id, value]) => value === 'undecided',
      ),
    ).toBe(true);
    expect(
      (await store.read(readWorkspace)).decisionEvents
        .slice(3)
        .map((event) => event.itemId),
    ).toEqual(['x:9', 'x:5', 'x:2']);
  } finally {
    await store.close();
  }
});

test.each([
  {
    name: 'another account',
    ids: ['x:2', 'x:11', 'x:12'],
    search: '',
    expected: ['x:2'],
  },
  {
    name: 'filter and another account',
    ids: ['x:2', 'x:10', 'x:11'],
    search: 'visible',
    expected: ['x:2'],
  },
])(
  'selection excludes IDs outside $name and counts them without changing them',
  async ({ ids, search, expected }) => {
    const { store, query, review } = setup();
    try {
      await query.query({
        queryId: 'selection-query',
        generation: 1,
        accountKey: 'x:contract',
        search,
      });
      const preview = await review.previewBulk({
        pageId: 'selection-page',
        previewId: 'selection-preview',
        queryId: 'selection-query',
        generation: 1,
        value: 'delete',
        overwrite: ['undecided'],
        itemIds: ids,
      });
      expect(preview).toMatchObject({
        total: 1,
        willChange: 1,
        selection: { requested: 3, inView: 1, notInView: 2 },
      });
      expect(preview.sample.map((row) => row.id)).toEqual(expected);
      expect(
        await review.confirmBulk({
          commandId: 'exclude-confirm',
          pageId: 'selection-page',
          previewId: 'selection-preview',
        }),
      ).toMatchObject({ changed: 1 });
      expect(
        (await store.read(readWorkspace)).decisionEvents.map(
          (event) => event.itemId,
        ),
      ).toEqual(expected);
      expect(
        (await currentValues(store)).filter(([id]) =>
          ['x:10', 'x:11', 'x:12'].includes(id),
        ),
      ).toEqual([
        ['x:10', 'undecided'],
        ['x:11', 'undecided'],
        ['x:12', 'undecided'],
      ]);
    } finally {
      await store.close();
    }
  },
);

test('a selected item changed after preview rejects the entire selection with STALE_PREVIEW', async () => {
  const { store, query, review } = setup();
  try {
    await query.query({
      queryId: 'selection-query',
      generation: 1,
      accountKey: 'x:contract',
    });
    await review.previewBulk({
      pageId: 'selection-page',
      previewId: 'selection-preview',
      queryId: 'selection-query',
      generation: 1,
      value: 'delete',
      overwrite: ['undecided'],
      itemIds: ['x:2', 'x:5', 'x:9'],
    });
    await review.decide({
      commandId: 'changed-after-preview',
      itemIds: ['x:5'],
      value: 'later',
      expected: { 'x:5': 'undecided' },
    });
    const before = await store.read(readWorkspace);
    expect(
      await review.confirmBulk({
        commandId: 'stale-selection',
        pageId: 'selection-page',
        previewId: 'selection-preview',
      }),
    ).toMatchObject({ code: 'STALE_PREVIEW', changedSince: 1 });
    expect(await store.read(readWorkspace)).toEqual(before);
    expect(
      (await currentValues(store)).filter(([id]) =>
        ['x:2', 'x:5', 'x:9'].includes(id),
      ),
    ).toEqual([
      ['x:2', 'undecided'],
      ['x:5', 'later'],
      ['x:9', 'undecided'],
    ]);
  } finally {
    await store.close();
  }
});

test('overwrite current values apply only within the frozen selection', async () => {
  const { store, query, review } = setup();
  try {
    await review.decide({
      commandId: 'kept',
      itemIds: ['x:2', 'x:4'],
      value: 'keep',
      expected: { 'x:2': 'undecided', 'x:4': 'undecided' },
    });
    await query.query({
      queryId: 'selection-query',
      generation: 1,
      accountKey: 'x:contract',
    });
    const preview = await review.previewBulk({
      pageId: 'selection-page',
      previewId: 'selection-preview',
      queryId: 'selection-query',
      generation: 1,
      value: 'delete',
      overwrite: ['undecided'],
      itemIds: ['x:2', 'x:5'],
    });
    expect(preview).toMatchObject({
      total: 2,
      willChange: 1,
      unchanged: 1,
      byCurrentValue: { keep: 1, delete: 0, later: 0, undecided: 1 },
    });
    expect(
      await review.confirmBulk({
        commandId: 'protected-selection',
        pageId: 'selection-page',
        previewId: 'selection-preview',
      }),
    ).toMatchObject({ changed: 1 });
    expect(
      (await currentValues(store)).filter(([id]) =>
        ['x:2', 'x:4', 'x:5'].includes(id),
      ),
    ).toEqual([
      ['x:2', 'keep'],
      ['x:4', 'keep'],
      ['x:5', 'delete'],
    ]);
    await query.query({
      queryId: 'selection-query',
      generation: 2,
      accountKey: 'x:contract',
    });
    await review.previewBulk({
      pageId: 'selection-page',
      previewId: 'overwrite-preview',
      queryId: 'selection-query',
      generation: 2,
      value: 'delete',
      overwrite: ['keep'],
      itemIds: ['x:2'],
    });
    expect(
      await review.confirmBulk({
        commandId: 'explicit-overwrite',
        pageId: 'selection-page',
        previewId: 'overwrite-preview',
      }),
    ).toMatchObject({ changed: 1 });
    expect(
      (await currentValues(store)).filter(([id]) =>
        ['x:2', 'x:4'].includes(id),
      ),
    ).toEqual([
      ['x:2', 'delete'],
      ['x:4', 'keep'],
    ]);
  } finally {
    await store.close();
  }
});

test('10,001 IDs, duplicate IDs and empty selections reject at both worker and HTTP schemas', () => {
  const valid = request(['x:1', 'x:2']);
  const bound = request(
    Array.from({ length: 10_000 }, (_, index) => `x:${index}`),
  );
  for (const schema of [WorkspaceRequestSchema, HttpReviewRequestSchema]) {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse(bound).success).toBe(true);
    expect(schema.safeParse(request()).success).toBe(true);
    for (const ids of [
      [],
      ['x:1', 'x:1'],
      Array.from({ length: 10_001 }, (_, index) => `x:${index}`),
    ])
      expect(schema.safeParse(request(ids)).success).toBe(false);
  }
  expect(PreviewBulkRequestSchema.safeParse(valid).success).toBe(true);
});

test('selection metadata is optional and strict; no-in-view IDs produce a zero-change preview', async () => {
  const { store, query, review } = setup();
  try {
    await query.query({
      queryId: 'selection-query',
      generation: 1,
      accountKey: 'x:contract',
    });
    const preview = await review.previewBulk({
      pageId: 'selection-page',
      previewId: 'empty-intersection',
      queryId: 'selection-query',
      generation: 1,
      value: 'delete',
      overwrite: ['undecided'],
      itemIds: ['x:11', 'x:missing'],
    });
    expect(preview).toMatchObject({
      total: 0,
      willChange: 0,
      unchanged: 0,
      sample: [],
      selection: { requested: 2, inView: 0, notInView: 2 },
    });
    expect(
      await review.confirmBulk({
        commandId: 'empty-intersection-confirm',
        pageId: 'selection-page',
        previewId: 'empty-intersection',
      }),
    ).toMatchObject({ type: 'committed', changed: 0, actionId: null });
    expect((await store.read(readWorkspace)).decisionEvents).toEqual([]);
    expect(
      BulkPreviewSchema.safeParse({
        ...preview,
        selection: { requested: -1, inView: 0, notInView: 0 },
      }).success,
    ).toBe(false);
    expect(
      BulkPreviewSchema.safeParse({
        ...preview,
        selection: { requested: 2, inView: 0, notInView: 2, extra: true },
      }).success,
    ).toBe(false);
  } finally {
    await store.close();
  }
});

test('direct callers reject malformed selections without replacing the page preview', async () => {
  const { store, query, review } = setup();
  const input = {
    pageId: 'selection-page',
    previewId: 'selection-preview',
    queryId: 'selection-query',
    generation: 1,
    value: 'delete' as const,
    overwrite: ['undecided' as const],
  };
  try {
    await query.query({
      queryId: 'selection-query',
      generation: 1,
      accountKey: 'x:contract',
    });
    await review.previewBulk({ ...input, itemIds: ['x:2'] });
    for (const itemIds of [
      [],
      ['x:2', 'x:2'],
      Array.from({ length: 10_001 }, (_, index) => `x:${index}`),
    ])
      await expect(
        review.previewBulk({
          ...input,
          previewId: 'invalid-selection',
          itemIds,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(
      await review.confirmBulk({
        commandId: 'valid-after-invalid',
        pageId: 'selection-page',
        previewId: 'selection-preview',
      }),
    ).toMatchObject({ changed: 1 });
    expect(
      (await store.read(readWorkspace)).decisionEvents.map(
        (event) => event.itemId,
      ),
    ).toEqual(['x:2']);
  } finally {
    await store.close();
  }
});

test('changes outside the selected intersection do not invalidate it, and release and expiry still reject it', async () => {
  const { store, query, review } = setup();
  try {
    await query.query({
      queryId: 'selection-query',
      generation: 1,
      accountKey: 'x:contract',
    });
    await review.previewBulk({
      pageId: 'selection-page',
      previewId: 'selection-preview',
      queryId: 'selection-query',
      generation: 1,
      value: 'delete',
      overwrite: ['undecided'],
      itemIds: ['x:2', 'x:5', 'x:9'],
    });
    await review.decide({
      commandId: 'outside-selection',
      itemIds: ['x:4'],
      value: 'keep',
      expected: { 'x:4': 'undecided' },
    });
    expect(
      await review.confirmBulk({
        commandId: 'inside-selection',
        pageId: 'selection-page',
        previewId: 'selection-preview',
      }),
    ).toMatchObject({ changed: 3 });
    expect(
      (await currentValues(store)).filter(([id]) =>
        ['x:2', 'x:4', 'x:5', 'x:9'].includes(id),
      ),
    ).toEqual([
      ['x:2', 'delete'],
      ['x:4', 'keep'],
      ['x:5', 'delete'],
      ['x:9', 'delete'],
    ]);
    await query.query({
      queryId: 'selection-query',
      generation: 2,
      accountKey: 'x:contract',
    });
    await review.previewBulk({
      pageId: 'selection-page',
      previewId: 'released-selection',
      queryId: 'selection-query',
      generation: 2,
      value: 'delete',
      overwrite: ['undecided'],
      itemIds: ['x:1'],
    });
    review.releasePreview('selection-page', 'released-selection');
    expect(
      await review.confirmBulk({
        commandId: 'released-selection-confirm',
        pageId: 'selection-page',
        previewId: 'released-selection',
      }),
    ).toMatchObject({ code: 'PREVIEW_EXPIRED' });
    let clock = new Date('2026-02-01T00:00:00.000Z');
    const expired = new ReviewService(store, {
      query,
      via: 'web-review',
      now: () => clock,
    });
    await expired.previewBulk({
      pageId: 'expires-page',
      previewId: 'expires-selection',
      queryId: 'selection-query',
      generation: 2,
      value: 'delete',
      overwrite: ['undecided'],
      itemIds: ['x:1'],
    });
    clock = new Date('2026-02-01T00:10:00.000Z');
    expect(
      await expired.confirmBulk({
        commandId: 'expired-selection-confirm',
        pageId: 'expires-page',
        previewId: 'expires-selection',
      }),
    ).toMatchObject({ code: 'PREVIEW_EXPIRED' });
  } finally {
    await store.close();
  }
});

test('whole-query preview bytes match the exact 42c8340 ReviewService for the same input', async () => {
  // Captured on 2026-10-07 by running the exact historical ReviewService on
  // selectionWorkspace(), with this fixed clock, then hashing JSON.stringify.
  // Historical source SHA256: c1071e3ec49b3ca0e773895815476bb031d1adec4ebaa6306e16e46d038d03b3.
  // Keep the captured bytes' hash rather than requiring Git history in shallow CI.
  const historicalReplyHash =
    '8afa4a4a49418c6f3a15a5437201472f49b4cdfb43046c14358af330546fd9a5';
  const { store, query, review } = setup();
  try {
    await query.query({
      queryId: 'selection-query',
      generation: 1,
      accountKey: 'x:contract',
    });
    const current = await review.previewBulk({
      pageId: 'selection-page',
      previewId: 'selection-preview',
      queryId: 'selection-query',
      generation: 1,
      value: 'delete',
      overwrite: ['undecided'],
    });
    expect(
      createHash('sha256').update(JSON.stringify(current)).digest('hex'),
    ).toBe(historicalReplyHash);
    expect(Object.hasOwn(current, 'selection')).toBe(false);
    expect(BulkPreviewSchema.parse(current)).toEqual(current);
  } finally {
    await store.close();
  }
}, 15_000);
