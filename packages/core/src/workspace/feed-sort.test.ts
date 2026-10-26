import { expect, test } from 'vitest';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { createWorkspace, readWorkspace } from './store.ts';
import { generatedItem } from '../criteria/rules-fixture.ts';
import { QueryEngine } from './query.ts';
import { SettingsService } from './settings.ts';
import { ReviewService } from './review.ts';
import { generatedLabel } from '../criteria/rules-fixture.ts';
import { HttpReviewRequestSchema, WorkspaceRequestSchema } from './protocol.ts';
import { DesktopRequestSchema } from './desktop-protocol.ts';
import {
  instagramContractItem,
  writeInstagramContextContract,
} from './store-contract.ts';
import { InstagramContextWriter } from './instagram-context-writer.ts';

test('IG-LIKES SORT-1 stored comment likes enable orders and share their column with rules, counts and filters', async () => {
  const store = createMemoryStore();
  const item = {
    ...instagramContractItem(),
    engagement: { likes: null, reposts: null },
  };
  const context = await writeInstagramContextContract(store, item);
  const accountKey = item.account.key;
  const query = new QueryEngine(store);
  const request = {
    accountKey,
    tab: 'all' as const,
    sort: 'likes' as const,
    offset: 0,
    limit: 50,
  };
  try {
    expect((await query.feedWindow(request)).sortOptions).toEqual([
      'newest',
      'oldest',
    ]);
    const at = '2026-10-26T00:00:00.000Z';
    const writer = new InstagramContextWriter(store);
    await writer.startRun({
      runId: 'generated-sort-refresh',
      accountKey,
      planHash: 'a'.repeat(64),
      startedAt: at,
    });
    await writer.sending({
      attemptId: 'generated-sort-likes',
      runId: 'generated-sort-refresh',
      itemId: item.id,
      at,
      refreshLikes: true,
    });
    await writer.step('generated-sort-refresh', at);
    await writer.fillLikes(
      'generated-sort-likes',
      { count: 12, source: 'answer' },
      at,
    );
    const after = await query.feedWindow(request);
    expect(after.sortOptions).toEqual(['newest', 'oldest', 'likes']);
    expect(after.cards[0]!.item.engagement.likes).toBe(12);
    expect((await query.planCounts(accountKey)).popularThreshold).toBe(12);
    await query.query({
      queryId: 'effective-likes',
      generation: 1,
      accountKey,
      sort: [{ by: 'likes', direction: 'desc' }],
      filter: { likes: { min: 10, max: null, unknown: 'exclude' } },
    });
    expect(
      query.window('effective-likes', 1, 0, 50).map((row) => row.id),
    ).toEqual([item.id]);
    const additions = [
      ['instagram:a', '2025-08-01', 12],
      ['instagram:b', '2025-08-01', 12],
      ['instagram:zero', '2025-09-01', 0],
      ['instagram:unknown', '2026-01-01', null],
    ] as const;
    const snapshot = await store.read(readWorkspace);
    snapshot.items.push(
      ...additions.map(([id, date, likes]) => ({
        ...item,
        id,
        createdAt: date + 'T00:00:00.000Z',
        engagement: { likes, reposts: null },
      })),
    );
    snapshot.counts.items = snapshot.items.length;
    const orderedStore = createMemoryStore(new MemoryStoreBacking(snapshot));
    try {
      const ordered = new QueryEngine(orderedStore);
      const before = await ordered.planCounts(accountKey);
      expect(
        (await ordered.feedWindow(request)).cards.map((card) => card.item.id),
      ).toEqual([
        'instagram:a',
        'instagram:b',
        item.id,
        'instagram:zero',
        'instagram:unknown',
      ]);
      expect(await ordered.planCounts(accountKey)).toEqual(before);
      snapshot.items.find((entry) => entry.id === item.id)!.engagement.likes =
        3;
      const exportStore = createMemoryStore(new MemoryStoreBacking(snapshot));
      try {
        const fromExport = await new QueryEngine(exportStore).feedWindow(
          request,
        );
        expect(
          fromExport.cards.find((card) => card.item.id === item.id)!.item
            .engagement.likes,
        ).toBe(3);
      } finally {
        await exportStore.close();
      }
    } finally {
      await orderedStore.close();
    }
    expect(await store.read((tx) => tx.instagramContext.get(item.id))).toEqual({
      ...context,
      likes: { count: 12, source: 'answer' },
    });
  } finally {
    await store.close();
  }
});

function fixture() {
  const data = createWorkspace();
  data.items = [
    ['x:b', '2024-02-01', 8, 2],
    ['x:a', '2024-02-01', 8, 2],
    ['x:old', '2020-01-01', 8, 10],
    ['x:zero', '2025-01-01', 0, 0],
    ['x:unknown', '2026-01-01', null, null],
  ].map(([id, date, likes, reposts]) => ({
    ...generatedItem(id as string),
    createdAt: `${date}T00:00:00.000Z`,
    engagement: {
      likes: likes as number | null,
      reposts: reposts as number | null,
    },
  }));
  data.counts.items = data.items.length;
  return data;
}

test('SORT-1 server windows order counts, date/id ties, zeros and unknowns without changing counts', async () => {
  const store = createMemoryStore(new MemoryStoreBacking(fixture()));
  const query = new QueryEngine(store);
  const before = await query.planCounts('x:generated');
  for (const [sort, expected] of [
    ['newest', ['x:unknown', 'x:zero', 'x:a', 'x:b', 'x:old']],
    ['oldest', ['x:old', 'x:a', 'x:b', 'x:zero', 'x:unknown']],
    ['likes', ['x:a', 'x:b', 'x:old', 'x:zero', 'x:unknown']],
    ['reposts', ['x:old', 'x:a', 'x:b', 'x:zero', 'x:unknown']],
  ] as const) {
    const window = await query.feedWindow({
      accountKey: 'x:generated',
      tab: 'all',
      sort,
      offset: 0,
      limit: 50,
    });
    expect(window.cards.map((card) => card.item.id)).toEqual(expected);
    expect(window.sortOptions).toEqual([
      'newest',
      'oldest',
      'likes',
      'reposts',
    ]);
    const anchor = await query.feedWindow({
      accountKey: 'x:generated',
      tab: 'all',
      sort,
      anchor: expected[2],
      limit: 1,
    });
    expect(anchor.anchorIndex).toBe(2);
    expect(anchor.cards[0]?.item.id).toBe(expected[2]);
  }
  expect(await query.planCounts('x:generated')).toEqual(before);
  expect((await store.read(readWorkspace)).decisionEvents).toHaveLength(0);
});

test('SORT-1 an account with unknown engagement offers date sorts only; known zero is known', async () => {
  const data = fixture();
  for (const item of data.items) {
    item.platform = 'instagram';
    item.id = item.id.replace('x:', 'instagram:');
    item.engagement = { likes: null, reposts: null };
  }
  const query = new QueryEngine(
    createMemoryStore(new MemoryStoreBacking(data)),
  );
  expect(
    (
      await query.feedWindow({
        accountKey: 'x:generated',
        tab: 'all',
        offset: 0,
        limit: 1,
      })
    ).sortOptions,
  ).toEqual(['newest', 'oldest']);
  data.items[0]!.engagement.likes = 0;
  const zero = new QueryEngine(createMemoryStore(new MemoryStoreBacking(data)));
  expect(
    (
      await zero.feedWindow({
        accountKey: 'x:generated',
        tab: 'all',
        offset: 0,
        limit: 1,
      })
    ).sortOptions,
  ).toEqual(['newest', 'oldest', 'likes']);
});

test('SORT-1 strict worker/HTTP/desktop requests carry sort and reject unknown values', () => {
  const request = {
    type: 'feedWindow',
    requestId: 'sort',
    accountKey: 'x:generated',
    tab: 'all',
    offset: 0,
    limit: 50,
    sort: 'reposts',
  };
  for (const schema of [
    WorkspaceRequestSchema,
    HttpReviewRequestSchema,
    DesktopRequestSchema,
  ]) {
    expect(schema.parse(request)).toEqual(request);
    expect(schema.safeParse({ ...request, sort: 'random' }).success).toBe(
      false,
    );
  }
});

test('SORT-1 per-account/tab sort and anchor survive store reopen without a decision', async () => {
  const backing = new MemoryStoreBacking(fixture());
  const store = createMemoryStore(backing);
  const view = {
    accountKey: 'x:generated',
    filter: {},
    search: '',
    sort: [{ by: 'createdAt' as const, direction: 'desc' as const }],
    feed: {
      tab: 'all' as const,
      anchors: {},
      views: {
        'x:generated': {
          all: { sort: 'likes' as const },
          kept: { sort: 'oldest' as const, anchor: 'x:old' },
        },
        'instagram:other': { all: { sort: 'oldest' as const } },
      },
    },
  };
  await new SettingsService(store).setReviewView(view);
  await store.close();
  const reopened = createMemoryStore(backing);
  expect((await reopened.read(readWorkspace)).settings.review).toEqual(view);
  expect((await reopened.read(readWorkspace)).decisionEvents).toHaveLength(0);
});

test('SORT-1 final-mark membership and counts stay independent of every display order', async () => {
  const data = fixture();
  data.settings.criteria!.selected = ['political'];
  data.settings.keepRules = [];
  data.assessments = data.items.map((item, index) =>
    generatedLabel(`sort-label-${index}`, 'political', null, item.id),
  );
  data.counts.assessments = data.assessments.length;
  const store = createMemoryStore(new MemoryStoreBacking(data));
  const query = new QueryEngine(store),
    review = new ReviewService(store, { query, via: 'local-review' });
  let baseline: unknown;
  for (const sort of ['newest', 'oldest', 'likes', 'reposts'] as const) {
    await query.feedWindow({
      accountKey: 'x:generated',
      tab: 'suggested',
      sort,
      offset: 0,
      limit: 50,
    });
    const preview = await review.previewPlan({
      accountKey: 'x:generated',
      pageId: 'sort',
      previewId: `sort-${sort}`,
    });
    const observed = {
      total: preview.total,
      willChange: preview.willChange,
      counts: preview.plan!.counts,
      sample: preview.sample.map((row) => row.id),
    };
    if (baseline === undefined) baseline = observed;
    expect(observed).toEqual(baseline);
    expect(preview.willChange).toBe(5);
  }
});

test('SORT-1 list engagement order also uses newest/id ties and never treats unknown as zero', async () => {
  const query = new QueryEngine(
    createMemoryStore(new MemoryStoreBacking(fixture())),
  );
  for (const [by, direction, expected] of [
    ['reposts', 'desc', ['x:old', 'x:a', 'x:b', 'x:zero', 'x:unknown']],
    ['likes', 'asc', ['x:zero', 'x:a', 'x:b', 'x:old', 'x:unknown']],
  ] as const) {
    const result = await query.query({
      queryId: `${by}-${direction}`,
      generation: 1,
      accountKey: 'x:generated',
      sort: [{ by, direction }],
    });
    const rows = query.window(`${by}-${direction}`, 1, 0, 50);
    expect(result.total).toBe(5);
    expect(rows.map((row) => row.id)).toEqual(expected);
  }
});
