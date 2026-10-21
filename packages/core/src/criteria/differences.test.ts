import { expect, test } from 'vitest';
import { generatedItem, generatedLabel } from './rules-fixture.ts';
import { migrateReviewContract } from './migration.ts';
import { feedCounts } from './feed.ts';
import { createWorkspace, readWorkspace } from '../workspace/store.ts';
import {
  createMemoryStore,
  MemoryStoreBacking,
} from '../workspace/memory-store.ts';
import { QueryEngine } from '../workspace/query.ts';
import { ReviewService } from '../workspace/review.ts';
import { PRESETS } from './presets.ts';

test('v6 first-tab membership differs from the actual legacy preview in exactly section 6 four classes', async () => {
  const legacy = createWorkspace({ kind: 'demo' });
  legacy.schemaVersion = 6;
  legacy.settings = {
    categories: PRESETS.map(({ id }) => id),
    timeZone: 'UTC',
  };
  delete legacy.reviewPlans;
  delete legacy.counts.reviewPlans;
  // Expected roles are input metadata, not copied production predicates.
  const cases = [
    ['open', 'undecided', 'political', 2, 0, 'inside'],
    ['later', 'later', 'political', 2, 0, 'inside'],
    ['harmless', 'undecided', 'harmless', 3, 0, 'inside'],
    ['unclear', 'undecided', 'unclear', 2, 0, 'inside'],
    ['keep', 'keep', 'political', 2, 0, 'inside'],
    ['marked', 'delete', 'political', 2, 0, 'inside'],
    ['outside', 'undecided', 'political', 2, 0, 'outside'],
    ['popular', 'undecided', 'political', 3, 20, 'inside'],
    ['low', 'undecided', 'political', 1, 0, 'inside'],
    ['none', 'undecided', null, 0, 0, 'inside'],
  ] as const;
  let seq = 0;
  for (const [id, decision, category, risk, likes, view] of cases) {
    legacy.items.push({ ...generatedItem(`x:${id}`, likes), text: view });
    if (category)
      legacy.assessments.push({
        ...generatedLabel(`a-${id}`, category, null, `x:${id}`, risk),
        source: { kind: 'fixture', name: 'generated', version: null },
      });
    if (decision !== 'undecided')
      legacy.decisionEvents.push({
        eventId: `event-${id}`,
        seq: ++seq,
        itemId: `x:${id}`,
        previous: 'undecided',
        value: decision,
        decidedAt: legacy.createdAt,
        source: { kind: 'human', via: 'web-review' },
        action: { id: `action-${id}`, kind: 'single', size: 1, reverts: null },
      });
  }
  legacy.counts.items = cases.length;
  legacy.counts.assessments = legacy.assessments.length;
  legacy.counts.decisionEvents = legacy.decisionEvents.length;
  const store = createMemoryStore(new MemoryStoreBacking(legacy));
  try {
    const query = new QueryEngine(store);
    const review = new ReviewService(store, { query, via: 'web-review' });
    await query.query({
      queryId: 'legacy',
      generation: 1,
      accountKey: 'x:generated',
      filter: { risk: { min: 2, max: 3, unknown: 'exclude' } },
      search: 'inside',
    });
    const old = await review.previewBulk({
      pageId: 'legacy-page',
      queryId: 'legacy',
      generation: 1,
      previewId: 'legacy-preview',
      value: 'delete',
      overwrite: ['undecided', 'later', 'keep', 'delete'],
      skipPopular: true,
    });
    expect(old.total).toBe(7);
    expect(old.willChange).toBe(5);
    expect(old.skippedPopular).toBe(1);
    const allOld = await query.selection('legacy', 1);
    expect([...allOld.ids].sort()).toEqual([
      'x:harmless',
      'x:keep',
      'x:later',
      'x:marked',
      'x:open',
      'x:popular',
      'x:unclear',
    ]);
    const feed = feedCounts(
      migrateReviewContract(await store.read(readWorkspace)),
    );
    expect(Object.fromEntries(feed.membership)).toEqual({
      'x:open': 'suggested',
      'x:later': 'unclear',
      'x:harmless': 'all',
      'x:unclear': 'unclear',
      'x:keep': 'kept',
      'x:marked': 'marked',
      'x:outside': 'suggested',
      'x:popular': 'held',
      'x:low': 'all',
      'x:none': 'all',
    });
    const oldSet = new Set([
      'x:open',
      'x:later',
      'x:harmless',
      'x:unclear',
      'x:keep',
      'x:marked',
    ]);
    const newSet = new Set(
      [...feed.membership]
        .filter(([, tab]) => tab === 'suggested')
        .map(([id]) => id),
    );
    expect([...oldSet].filter((id) => !newSet.has(id)).sort()).toEqual([
      'x:harmless',
      'x:keep',
      'x:later',
      'x:marked',
      'x:unclear',
    ]);
    expect([...newSet].filter((id) => !oldSet.has(id))).toEqual(['x:outside']);
    const removed = [...oldSet].filter((id) => !newSet.has(id));
    expect({
      later: removed.filter((id) => id === 'x:later'),
      nonHits: removed.filter((id) => ['x:harmless', 'x:unclear'].includes(id)),
      decisionsNeverOverwritten: removed.filter((id) =>
        ['x:keep', 'x:marked'].includes(id),
      ),
      noViewNarrowing: [...newSet].filter((id) => !oldSet.has(id)),
    }).toEqual({
      later: ['x:later'],
      nonHits: ['x:harmless', 'x:unclear'],
      decisionsNeverOverwritten: ['x:keep', 'x:marked'],
      noViewNarrowing: ['x:outside'],
    });
    expect(feed.tabs).toEqual({
      suggested: 2,
      held: 1,
      kept: 1,
      unclear: 2,
      marked: 1,
      all: 10,
    });
  } finally {
    await store.close();
  }
});
