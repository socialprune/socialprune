import { expect, test } from 'vitest';
import { createWorkspace, readWorkspace, records } from './store.ts';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { QueryEngine } from './query.ts';
import { ReviewService } from './review.ts';
import { SettingsService } from './settings.ts';
import { generatedItem, generatedLabel } from '../criteria/rules-fixture.ts';
import { criterionHash } from '../criteria/presets.ts';

function feedFixture() {
  const workspace = createWorkspace({ timeZone: 'UTC' });
  workspace.items = [
    generatedItem('x:hit'),
    generatedItem('x:held', 10),
    generatedItem('x:later'),
    generatedItem('x:kept'),
    generatedItem('x:marked'),
    generatedItem('x:clear'),
    generatedItem('x:unclear'),
  ];
  workspace.items[0]!.text = 'Generated full text. '.repeat(30);
  workspace.assessments = workspace.items
    .filter((item) => item.id !== 'x:clear')
    .map((item, index) =>
      generatedLabel(
        `label-${index}`,
        item.id === 'x:unclear' ? 'unclear' : 'political',
        null,
        item.id,
      ),
    );
  workspace.settings.criteria!.selected = ['political'];
  workspace.settings.keepRules = [
    {
      id: 'likes',
      enabled: true,
      kind: 'likes-at-least',
      count: 10,
      alsoWhenUnknown: false,
    },
  ];
  workspace.counts.items = workspace.items.length;
  workspace.counts.assessments = workspace.assessments.length;
  return workspace;
}

test('feed counts and windows partition every state and keep full text and holding reasons', async () => {
  const store = createMemoryStore(new MemoryStoreBacking(feedFixture()));
  const query = new QueryEngine(store);
  const review = new ReviewService(store, { query, via: 'web-review' });
  for (const [id, value] of [
    ['x:later', 'later'],
    ['x:kept', 'keep'],
    ['x:marked', 'delete'],
  ] as const)
    await review.decide({
      commandId: id,
      itemIds: [id],
      value,
      expected: { [id]: 'undecided' },
    });
  const counts = await query.planCounts('x:generated');
  expect(counts).toEqual({
    tabs: { suggested: 1, held: 1, kept: 1, marked: 1, unclear: 2, all: 7 },
    hits: Object.fromEntries(
      feedFixture().settings.categories.map((id) => [
        id,
        id === 'political' ? 5 : 0,
      ]),
    ),
    held: { likes: 1 },
    unchecked: { political: 1 },
    popularThreshold: 10,
  });
  const window = await query.feedWindow({
    accountKey: 'x:generated',
    tab: 'all',
    offset: 0,
    limit: 50,
  });
  expect(window.total).toBe(7);
  expect(window.cards.find((card) => card.item.id === 'x:hit')?.item.text).toBe(
    feedFixture().items[0]!.text,
  );
  expect(
    window.cards.find((card) => card.item.id === 'x:held')?.holdingRules,
  ).toEqual(['likes']);
  expect(
    window.cards.find((card) => card.item.id === 'x:kept')?.decisionEvent,
  ).toMatchObject({ source: { kind: 'human', via: 'web-review' } });
  const anchor = await query.feedWindow({
    accountKey: 'x:generated',
    tab: 'all',
    anchor: 'x:later',
    limit: 1,
  });
  expect(anchor.cards.map((card) => card.item.id)).toEqual(['x:later']);
  expect(anchor.anchorIndex).toBe(
    window.cards.findIndex((card) => card.item.id === 'x:later'),
  );
  expect(
    (
      await query.feedWindow({
        accountKey: 'x:generated',
        tab: 'all',
        anchor: 'missing',
        limit: 1,
      })
    ).anchorIndex,
  ).toBeNull();
  await expect(
    query.feedWindow({
      accountKey: 'x:generated',
      tab: 'all',
      offset: 0,
      limit: 51,
    }),
  ).rejects.toThrow('INVALID_QUERY');
  expect((await query.planCounts('x:other')).tabs.all).toBe(0);
});

test('one decision moves cached tab counts and undo restores them without rescanning items', async () => {
  const backing = createMemoryStore(new MemoryStoreBacking(feedFixture()));
  let reads = 0;
  const store: typeof backing = {
    ...backing,
    read: (operation) =>
      backing.read((tx) =>
        operation({
          ...tx,
          items: {
            ...tx.items,
            iterate(options) {
              reads++;
              return tx.items.iterate(options);
            },
          },
        }),
      ),
  };
  const query = new QueryEngine(store);
  const review = new ReviewService(store, { query, via: 'web-review' });
  const before = await query.planCounts('x:generated');
  const scans = reads;
  await review.decide({
    commandId: 'keep',
    itemIds: ['x:hit'],
    value: 'keep',
    expected: { 'x:hit': 'undecided' },
  });
  expect((await query.planCounts('x:generated')).tabs.suggested).toBe(
    before.tabs.suggested - 1,
  );
  expect(reads).toBe(scans);
  await review.undo('undo');
  expect(await query.planCounts('x:generated')).toEqual(before);
  expect(reads).toBe(scans);
  const settings = new SettingsService(store);
  await settings.setCriteria({
    ...feedFixture().settings.criteria!,
    selected: [],
  });
  expect((await query.planCounts('x:generated')).tabs.suggested).toBe(0);
  expect(reads).toBeGreaterThan(scans);
  expect((await backing.read(readWorkspace)).decisionEvents).toHaveLength(2);
});

test('keep then undo on an entry with no hit never changes the All total', async () => {
  const store = createMemoryStore(new MemoryStoreBacking(feedFixture()));
  const query = new QueryEngine(store);
  const review = new ReviewService(store, { query, via: 'web-review' });
  const before = await query.planCounts('x:generated');
  await review.decide({
    commandId: 'keep-clear',
    itemIds: ['x:clear'],
    value: 'keep',
    expected: { 'x:clear': 'undecided' },
  });
  await review.undo('undo-clear');
  expect(await query.planCounts('x:generated')).toEqual(before);
});

test('feed visibility follows import ownership and excludes incomplete items with assessments', async () => {
  const backing = createMemoryStore(new MemoryStoreBacking(feedFixture()));
  const stored = await backing.read((tx) => records(tx.items));
  const store: typeof backing = {
    ...backing,
    read: (operation) =>
      backing.read((tx) =>
        operation({
          ...tx,
          items: {
            ...tx.items,
            async *iterate() {
              for (const record of stored)
                yield await Promise.resolve({
                  ...record,
                  importId:
                    record.item.id === 'x:hit'
                      ? 'incomplete-owner'
                      : record.importId,
                });
            },
          },
        }),
      ),
  };
  const query = new QueryEngine(store);
  expect((await query.planCounts('x:generated')).tabs.all).toBe(6);
  expect(
    (
      await query.feedWindow({
        accountKey: 'x:generated',
        tab: 'all',
        offset: 0,
        limit: 50,
      })
    ).cards.map((card) => card.item.id),
  ).not.toContain('x:hit');
});

test('configuration-cold counts reuse revision-bound source records but recompute membership', async () => {
  const backing = createMemoryStore(new MemoryStoreBacking(feedFixture()));
  let reads = 0;
  const store: typeof backing = {
    ...backing,
    read: (operation) =>
      backing.read((tx) =>
        operation({
          ...tx,
          items: {
            ...tx.items,
            iterate(options) {
              reads++;
              return tx.items.iterate(options);
            },
          },
        }),
      ),
  };
  const query = new QueryEngine(store);
  const settings = new SettingsService(store);
  const before = await query.planCounts('x:generated');
  const scans = reads;
  await settings.setCriteria({ ...feedFixture().settings.criteria!, level: 1 });
  expect((await query.planCounts('x:generated')).tabs).toEqual(before.tabs);
  expect(reads).toBe(scans);
  await settings.setCriteria({
    ...feedFixture().settings.criteria!,
    selected: [],
  });
  expect((await query.planCounts('x:generated')).tabs.suggested).toBe(0);
  expect(reads).toBe(scans);
  await settings.setCriteria(feedFixture().settings.criteria!);
  expect(await query.planCounts('x:generated')).toEqual(before);
  expect(reads).toBe(scans);
  await backing.write(async (tx) => {
    const runtime = await tx.runtime.get();
    await tx.runtime.set({ revision: runtime.revision + 1 });
  });
  expect(await query.planCounts('x:generated')).toEqual(before);
  expect(reads).toBeGreaterThan(scans);
});

test('cached count basis follows custom definition hashes and current keep rules', async () => {
  const workspace = feedFixture();
  workspace.settings.categories.push('custom-1');
  workspace.settings.criteria!.custom = [
    {
      id: 'custom-1',
      label: 'Generated own',
      description: 'Generated original definition.',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ];
  workspace.settings.criteria!.nextCustom = 2;
  workspace.settings.criteria!.selected = ['custom-1'];
  workspace.assessments.push(
    generatedLabel('own-check', 'custom-1', 'own-run', 'x:clear'),
  );
  workspace.submissions.push({
    submissionId: 'own-run',
    contentHash: `sha256:${'c'.repeat(64)}`,
    source: { kind: 'model', name: 'generated', version: null },
    receivedAt: '2026-10-01T00:00:00.000Z',
    labelCount: 1,
    criteria: [
      { id: 'custom-1', hash: criterionHash('custom-1', workspace.settings) },
    ],
  });
  workspace.counts.assessments++;
  workspace.counts.submissions++;
  const store = createMemoryStore(new MemoryStoreBacking(workspace));
  const settings = new SettingsService(store);
  const query = new QueryEngine(store);
  expect((await query.planCounts('x:generated')).tabs.suggested).toBe(1);
  // Definition changes at the same data revision invalidate checked hashes.
  const criteria = {
    ...workspace.settings.criteria!,
    custom: workspace.settings.criteria!.custom.map((own) => ({
      ...own,
      description: 'Generated changed definition.',
    })),
  };
  await settings.setCriteria(criteria);
  const counts = await query.planCounts('x:generated');
  expect(counts.unchecked['custom-1']).toBe(7);
  expect(counts.tabs.suggested).toBe(0);
  await settings.setCriteria({ ...criteria, selected: ['political'] });
  expect((await query.planCounts('x:generated')).tabs.held).toBe(1);
  await settings.setKeepRules([]);
  expect((await query.planCounts('x:generated')).tabs).toMatchObject({
    held: 0,
    suggested: 5,
  });
});

test('a later configuration after a cached decision uses committed event state', async () => {
  const store = createMemoryStore(new MemoryStoreBacking(feedFixture()));
  const query = new QueryEngine(store);
  const settings = new SettingsService(store);
  const review = new ReviewService(store, { query, via: 'web-review' });
  await query.planCounts('x:generated');
  await review.decide({
    commandId: 'cached-keep',
    itemIds: ['x:hit'],
    value: 'keep',
    expected: { 'x:hit': 'undecided' },
  });
  await settings.setCriteria({ ...feedFixture().settings.criteria!, level: 1 });
  expect((await query.planCounts('x:generated')).tabs).toMatchObject({
    kept: 1,
    suggested: 3,
    held: 1,
  });
});

test('cold configurations preserve every risk threshold while reusing one source revision', async () => {
  const workspace = feedFixture();
  workspace.settings.keepRules = [];
  workspace.assessments = [0, 1, 2].map((risk, index) =>
    generatedLabel(
      `risk-${risk}`,
      'political',
      null,
      workspace.items[index]!.id,
      risk,
    ),
  );
  workspace.counts.assessments = 3;
  const store = createMemoryStore(new MemoryStoreBacking(workspace));
  const query = new QueryEngine(store),
    settings = new SettingsService(store);
  for (const [level, suggested] of [
    [0, 3],
    [1, 2],
    [2, 1],
    [0, 3],
  ] as const) {
    await settings.setCriteria({ ...workspace.settings.criteria!, level });
    const counts = await query.planCounts('x:generated');
    expect(counts.tabs.suggested).toBe(suggested);
    expect(counts.hits.political).toBe(suggested);
    expect(counts.unchecked.political).toBe(4);
  }
});
