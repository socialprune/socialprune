import { expect, test } from 'vitest';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { readWorkspace, records } from './store.ts';
import type { WorkspaceStore } from './store.ts';
import { QueryEngine } from './query.ts';
import { ReviewService } from './review.ts';
import { SettingsService } from './settings.ts';
import {
  generatedItem,
  generatedLabel,
  generatedRun,
} from '../criteria/rules-fixture.ts';
import { createWorkspace } from './store.ts';
function feedFixture() {
  const workspace = createWorkspace({ timeZone: 'UTC' });
  workspace.items = [
    generatedItem('x:hit'),
    generatedItem('x:held', 10),
    generatedItem('x:later'),
    generatedItem('x:kept'),
    generatedItem('x:marked'),
    generatedItem('x:unclear'),
  ];
  workspace.assessments = workspace.items.map((item, index) =>
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

test('a final mark ignores list filters, Later, Keep, Marked and held hits, snapshots its plan and undoes once', async () => {
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
  await query.query({
    queryId: 'filtered',
    generation: 1,
    accountKey: 'x:generated',
    search: 'no match',
  });
  const preview = await review.previewPlan({
    pageId: 'page',
    previewId: 'plan',
    accountKey: 'x:generated',
  });
  expect(preview.willChange).toBe(1);
  expect(preview.sample.map((row) => row.id)).toEqual(['x:hit']);
  expect(preview.plan).toMatchObject({
    criteria: [{ id: 'political' }],
    counts: { suggested: 1, held: 1, unclear: 2, kept: 1, marked: 1 },
    sources: [{ kind: 'model', name: 'generated', count: 1 }],
  });
  const input = { commandId: 'final', pageId: 'page', previewId: 'plan' };
  const result = await review.confirmBulk(input);
  expect(result).toMatchObject({
    type: 'committed',
    changed: preview.willChange,
  });
  expect(await review.confirmBulk(input)).toEqual(result);
  const saved = await store.read(readWorkspace);
  expect(saved.reviewPlans).toHaveLength(1);
  expect(saved.reviewPlans![0]).toMatchObject({
    accountKey: 'x:generated',
    counts: preview.plan!.counts,
    criteria: preview.plan!.criteria,
    keepRules: preview.plan!.keepRules,
  });
  const cards = await query.feedWindow({
    accountKey: 'x:generated',
    tab: 'marked',
    offset: 0,
    limit: 50,
  });
  expect(
    cards.cards.find((card) => card.item.id === 'x:hit')?.plan?.actionId,
  ).toBe(saved.reviewPlans![0]!.actionId);
  await review.undo('undo-final');
  expect((await query.planCounts('x:generated')).tabs.suggested).toBe(1);
  expect(await store.read((tx) => records(tx.reviewPlans))).toHaveLength(1);
  await review.redo('redo-final');
  expect(await store.read((tx) => records(tx.reviewPlans))).toHaveLength(1);
  const redone = await query.feedWindow({
    accountKey: 'x:generated',
    tab: 'marked',
    offset: 0,
    limit: 50,
  });
  expect(
    redone.cards.find((card) => card.item.id === 'x:hit')?.plan,
  ).toMatchObject({
    actionId: saved.reviewPlans![0]!.actionId,
    criteria: preview.plan!.criteria,
  });
});

for (const mutation of [
  'submission',
  'rule',
  'level',
  'decision',
  'definition',
] as const)
  test(`plan preview becomes stale after ${mutation} and returns a fresh page-bound preview`, async () => {
    const store = createMemoryStore(new MemoryStoreBacking(feedFixture()));
    const query = new QueryEngine(store);
    const review = new ReviewService(store, { query, via: 'web-review' });
    const settings = new SettingsService(store);
    if (mutation === 'definition')
      await settings.setCriteria({
        ...feedFixture().settings.criteria!,
        custom: [
          {
            id: 'custom-1',
            label: 'Generated',
            description: 'Before',
            createdAt: '2026-10-20T12:00:00.000Z',
          },
        ],
        nextCustom: 2,
        selected: ['custom-1'],
      });
    await review.previewPlan({
      pageId: 'page',
      previewId: 'plan',
      accountKey: 'x:generated',
    });
    if (mutation === 'rule') await settings.setKeepRules([]);
    if (mutation === 'level')
      await settings.setCriteria({
        ...feedFixture().settings.criteria!,
        level: 1,
      });
    if (mutation === 'decision')
      await review.decide({
        commandId: 'later',
        itemIds: ['x:hit'],
        value: 'later',
        expected: { 'x:hit': 'undecided' },
      });
    if (mutation === 'submission')
      await store.write(async (tx) => {
        await tx.submissions.add(generatedRun('new', ['political']));
        await tx.assessments.append([
          generatedLabel('new', 'harmless', 'new', 'x:hit'),
        ]);
        const runtime = await tx.runtime.get();
        await tx.runtime.set({ revision: runtime.revision + 1 });
      });
    if (mutation === 'definition') {
      const criteria = (await store.read((tx) => tx.meta.get())).settings
        .criteria!;
      await settings.setCriteria({
        ...criteria,
        custom: criteria.custom.map((own) => ({
          ...own,
          description: 'After',
        })),
      });
    }
    const result = await review.confirmBulk({
      commandId: 'confirm',
      pageId: 'page',
      previewId: 'plan',
    });
    expect(result).toMatchObject({
      type: 'rejected',
      code: 'STALE_PREVIEW',
      preview: { pageId: 'page', plan: { accountKey: 'x:generated' } },
    });
    expect(result.type === 'rejected' && result.preview?.previewId).not.toBe(
      'plan',
    );
    expect(
      await review.confirmBulk({
        commandId: 'confirm',
        pageId: 'page',
        previewId: 'plan',
      }),
    ).toEqual(result);
    expect(await store.read((tx) => records(tx.reviewPlans))).toEqual([]);
  });

test('settings edits keep revision and events unchanged, reject unknown selections and never reuse removed own IDs', async () => {
  const store = createMemoryStore(new MemoryStoreBacking(feedFixture()));
  const settings = new SettingsService(store);
  const own = {
    id: 'custom-1',
    label: 'Generated',
    description: 'Generated content criterion',
    createdAt: '2026-10-20T12:00:00.000Z',
  };
  const criteria = {
    ...feedFixture().settings.criteria!,
    custom: [own],
    selected: ['custom-1'],
    nextCustom: 2,
  };
  expect(await settings.setCriteria(criteria)).toMatchObject({
    revision: 0,
    criteria,
  });
  await settings.setKeepRules([]);
  await settings.setCriteria({ ...criteria, custom: [], selected: [] });
  await expect(settings.setCriteria(criteria)).rejects.toThrow(
    'INVALID_REQUEST',
  );
  await expect(
    settings.setCriteria({ ...criteria, custom: [], selected: ['missing'] }),
  ).rejects.toThrow('UNKNOWN_CATEGORY');
  await expect(
    settings.setCriteria({ ...criteria, custom: [], selected: ['harmless'] }),
  ).rejects.toThrow('INVALID_REQUEST');
  expect(await store.read((tx) => tx.runtime.get())).toMatchObject({
    revision: 0,
  });
  expect(await store.read((tx) => records(tx.decisionEvents))).toEqual([]);
});

test('wrong page, released and expired plan previews never write decisions', async () => {
  const store = createMemoryStore(new MemoryStoreBacking(feedFixture()));
  let now = 0;
  const review = new ReviewService(store, {
    query: new QueryEngine(store),
    via: 'web-review',
    now: () => new Date(now),
  });
  await review.previewPlan({
    pageId: 'page',
    previewId: 'plan',
    accountKey: 'x:generated',
  });
  expect(
    await review.confirmBulk({
      commandId: 'wrong',
      pageId: 'foreign',
      previewId: 'plan',
    }),
  ).toMatchObject({ code: 'PREVIEW_EXPIRED' });
  review.releasePreview('foreign', 'plan');
  now += 10 * 60_000;
  expect(
    await review.confirmBulk({
      commandId: 'expired',
      pageId: 'page',
      previewId: 'plan',
    }),
  ).toMatchObject({ code: 'PREVIEW_EXPIRED' });
  await review.previewPlan({
    pageId: 'page',
    previewId: 'release',
    accountKey: 'x:generated',
  });
  review.releasePreview('page', 'release');
  expect(
    await review.confirmBulk({
      commandId: 'released',
      pageId: 'page',
      previewId: 'release',
    }),
  ).toMatchObject({ code: 'PREVIEW_EXPIRED' });
  expect(await store.read((tx) => records(tx.decisionEvents))).toEqual([]);
});

test('plan storage failure rolls back decisions, runtime and receipt together', async () => {
  const backing = createMemoryStore(new MemoryStoreBacking(feedFixture()));
  const store: WorkspaceStore = {
    ...backing,
    write: (operation) =>
      backing.write((tx) =>
        operation({
          ...tx,
          reviewPlans: {
            ...tx.reviewPlans,
            add: () =>
              Promise.reject(new Error('Generated injected write failure')),
          },
        }),
      ),
  };
  const review = new ReviewService(store, {
    query: new QueryEngine(store),
    via: 'web-review',
  });
  await review.previewPlan({
    pageId: 'page',
    previewId: 'plan',
    accountKey: 'x:generated',
  });
  expect(
    await review.confirmBulk({
      commandId: 'rollback',
      pageId: 'page',
      previewId: 'plan',
    }),
  ).toMatchObject({ type: 'rejected', code: 'STORAGE' });
  expect(await backing.read((tx) => records(tx.decisionEvents))).toEqual([]);
  expect(await backing.read((tx) => tx.runtime.get())).toMatchObject({
    revision: 0,
  });
  expect(
    await backing.read((tx) => tx.commands.get('rollback')),
  ).toBeUndefined();
});
