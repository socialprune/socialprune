import { expect, test } from 'vitest';
import { createWorkspace, readWorkspace, records } from './store.ts';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { QueryEngine } from './query.ts';
import { ReviewService } from './review.ts';
import { SettingsService } from './settings.ts';
import { generatedItem, generatedLabel } from '../criteria/rules-fixture.ts';

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
