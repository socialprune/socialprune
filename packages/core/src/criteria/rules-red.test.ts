import { expect, test } from 'vitest';
import { currentChecks, feedCounts } from './feed.ts';
import {
  PRESETS,
  criterionRoom,
  addCustomCriterion,
  definitionHash,
} from './presets.ts';
import {
  CriteriaSettingsSchema,
  KeepRulesSchema,
  FeedViewSchema,
} from './schema.ts';
import { createWorkspace } from '../workspace/store.ts';
import type { Assessment, Item, WorkspaceV2 } from '../model/index.ts';
import { evaluateKeepRules } from './keep-rules.ts';
import { deriveState } from '../workspace/state.ts';
import {
  generatedItem as generated,
  generatedLabel as label,
  generatedRun as run,
} from './rules-fixture.ts';
import { QueryEngine } from '../workspace/query.ts';
import {
  createMemoryStore,
  MemoryStoreBacking,
} from '../workspace/memory-store.ts';
import { popularityThreshold } from '../workspace/popular.ts';

const at = '2026-10-20T12:00:00.000Z';
const source = { kind: 'model' as const, name: 'generated', version: null };
export function generatedItem(id = 'x:1', likes: number | null = 0): Item {
  return {
    id,
    platform: 'x',
    account: { key: 'x:generated', handle: null },
    kind: 'post',
    text: 'Generated content',
    createdAt: at,
    engagement: { likes, reposts: 0 },
    reference: {
      replyToId: null,
      replyToHandle: null,
      quotedId: null,
      repostOfHandle: null,
      ownerHandle: null,
    },
    mediaCount: null,
    url: null,
    provenance: { archive: 'generated', file: 'generated.json', index: 0 },
  };
}
export function generatedLabel(
  id: string,
  category: string,
  submissionId: string | null = null,
  itemId = 'x:1',
  risk = 2,
): Assessment {
  return {
    assessmentId: id,
    submissionId,
    itemId,
    category,
    risk,
    source,
    reason: 'Generated reason.',
    evidence: null,
    confidence: null,
    createdAt: at,
  };
}
export function generatedRun(id: string, criteria: string[], labelCount = 1) {
  return {
    submissionId: id,
    contentHash: definitionHash(id),
    source,
    receivedAt: at,
    labelCount,
    criteria: criteria.map((id) => ({
      id,
      hash: PRESETS.find((preset) => preset.id === id)!.hash,
    })),
  };
}
test('newest submission append order wins even if its assessments arrive first', () => {
  const value = createWorkspace();
  value.items = [generatedItem()];
  value.submissions = [
    generatedRun('first', ['political']),
    generatedRun('second', ['political']),
  ];
  value.assessments = [
    generatedLabel('new', 'harmless', 'second'),
    generatedLabel('old', 'political', 'first'),
  ];
  expect(
    currentChecks(value)
      .get('x:1')!
      .find((check) => check.criterion === 'political')!.status,
  ).toBe('clear');
});
test('fixture assessments without submissions keep the last-per-source rule', () => {
  const value = createWorkspace({ kind: 'demo' });
  value.items = [generatedItem()];
  value.assessments = [
    generatedLabel('first', 'political'),
    generatedLabel('second', 'sexual'),
  ].map((label) => ({ ...label, source: { ...source, kind: 'fixture' } }));
  const checks = currentChecks(value).get('x:1')!;
  expect(checks).toBeDefined();
  expect(
    checks
      .filter((check) => check.status === 'hit')
      .map((check) => check.criterion),
  ).toEqual(['sexual']);
});

test('legacy duplicate labels in a run use the last category result for every consumer', () => {
  const value = createWorkspace();
  value.items = [generatedItem()];
  value.settings.criteria!.selected = ['political'];
  value.submissions = [generatedRun('legacy', ['political', 'unclear'], 2)];
  value.assessments = [
    generatedLabel('old', 'unclear', 'legacy', undefined, 3),
    generatedLabel('new', 'unclear', 'legacy', undefined, 1),
  ];
  expect(
    deriveState(value)
      .get('x:1')!
      .assessments.map((value) => value.assessmentId),
  ).toEqual(['new']);
});
test('latest run at an obsolete definition cannot restore an older current-hash result', () => {
  const value = createWorkspace();
  value.items = [generatedItem()];
  value.settings = addCustomCriterion(value.settings, {
    label: 'Own',
    description: 'Now',
    createdAt: at,
  });
  value.settings.criteria!.selected = ['custom-1'];
  value.submissions = [
    {
      ...generatedRun('own', ['political']),
      criteria: [{ id: 'custom-1', hash: definitionHash('Before') }],
    },
  ];
  value.assessments = [generatedLabel('own', 'custom-1', 'own')];
  expect(feedCounts(value).unchecked['custom-1']).toBe(1);
});
test('earlier custom-n IDs are never allocated again after migration', async () => {
  const { migrateReviewContract } = await import('./migration.ts');
  const value = {
    ...createWorkspace(),
    schemaVersion: 6,
    settings: { categories: ['custom-9'], timeZone: null },
  } as WorkspaceV2;
  const next = addCustomCriterion(migrateReviewContract(value).settings, {
    label: 'New',
    description: 'New criterion',
    createdAt: at,
  });
  expect(next.criteria.custom[0]!.id).toBe('custom-10');
});
test.each([
  ['zero', 0, false],
  ['known threshold', 10, true],
  ['unknown excluded', null, false],
] as const)(
  'likes rule %s has explicit applicability',
  async (_name, likes, expected) => {
    const { evaluateKeepRules } = await import('./keep-rules.ts');
    expect(
      evaluateKeepRules(
        generatedItem('x:1', likes),
        [
          {
            id: 'likes',
            kind: 'likes-at-least',
            enabled: true,
            count: 10,
            alsoWhenUnknown: false,
          },
        ],
        'UTC',
        null,
      ).length > 0,
    ).toBe(expected);
  },
);
test('preset room never silently drops old IDs or exceeds 32 and own text limits apply', () => {
  const old = Array.from({ length: 31 }, (_, index) => `earlier-${index}`);
  const room = criterionRoom(old);
  expect(room.categories.slice(0, 31)).toEqual(old);
  expect(room.categories).toHaveLength(32);
  expect(room.unavailable).toHaveLength(13);
  expect(() =>
    addCustomCriterion(createWorkspace().settings, {
      label: 'x'.repeat(61),
      description: 'Generated',
      createdAt: at,
    }),
  ).toThrow();
  expect(() =>
    addCustomCriterion(createWorkspace().settings, {
      label: 'Generated',
      description: 'x'.repeat(301),
      createdAt: at,
    }),
  ).toThrow();
});
test('criteria max, duplicate IDs, rule max, and feed anchors are checked', () => {
  expect(
    CriteriaSettingsSchema.safeParse({
      selected: Array.from({ length: 33 }, (_, index) => `earlier-${index}`),
      custom: [],
      nextCustom: 1,
      level: 0,
    }).success,
  ).toBe(false);
  expect(
    CriteriaSettingsSchema.safeParse({
      selected: ['political', 'political'],
      custom: [],
      nextCustom: 1,
      level: 0,
    }).success,
  ).toBe(false);
  expect(
    KeepRulesSchema.safeParse(
      Array.from({ length: 17 }, (_, index) => ({
        id: `${index}`,
        enabled: true,
        kind: 'top-liked-tenth',
      })),
    ).success,
  ).toBe(false);
  expect(
    FeedViewSchema.parse({ tab: 'unclear', anchors: { unclear: 'x:1' } }),
  ).toEqual({ tab: 'unclear', anchors: { unclear: 'x:1' } });
  expect(
    FeedViewSchema.safeParse({ tab: 'unclear', anchors: { absent: 'x:1' } })
      .success,
  ).toBe(false);
});

test('query rebuild and sparse refresh consume the same per-criterion suggestions as deriveState', async () => {
  const value = createWorkspace();
  value.items = [generated()];
  value.submissions = [
    run('first', ['political', 'sexual'], 2),
    run('second', ['sexual']),
  ];
  value.assessments = [
    label('p', 'political', 'first'),
    label('s', 'sexual', 'first'),
    label('clear', 'harmless', 'second', undefined, 0),
  ];
  value.counts.items = 1;
  value.counts.submissions = 2;
  value.counts.assessments = 3;
  const store = createMemoryStore(new MemoryStoreBacking(value));
  const query = new QueryEngine(store);
  try {
    await query.query({
      queryId: 'q',
      generation: 1,
      accountKey: 'x:generated',
    });
    expect(query.window('q', 1, 0, 1)[0]!.categories).toContain('political');
    expect(query.window('q', 1, 0, 1)[0]!.categories).not.toContain('sexual');
    expect(
      deriveState(value)
        .get('x:1')!
        .assessments.some((value) => value.category === 'political'),
    ).toBe(true);
    await store.write(async (tx) => {
      await tx.runtime.set({ revision: 1 });
    });
    await query.noteChanged({ revision: 1, itemIds: ['x:1'] });
    await query.query({
      queryId: 'q',
      generation: 2,
      accountKey: 'x:generated',
    });
    expect(query.window('q', 2, 0, 1)[0]!.categories).toContain('political');
  } finally {
    await store.close();
  }
});

test.each([
  [
    'likes known',
    generated('x:1', 10),
    [
      {
        id: 'l',
        kind: 'likes-at-least',
        count: 10,
        alsoWhenUnknown: false,
        enabled: true,
      },
    ],
    'UTC',
    null,
    ['l'],
  ],
  [
    'likes unknown opt-in',
    generated('x:1', null),
    [
      {
        id: 'l',
        kind: 'likes-at-least',
        count: 10,
        alsoWhenUnknown: true,
        enabled: true,
      },
    ],
    'UTC',
    null,
    ['l'],
  ],
  [
    'reposts known',
    { ...generated(), engagement: { likes: 0, reposts: 5 } },
    [
      {
        id: 'r',
        kind: 'reposts-at-least',
        count: 5,
        alsoWhenUnknown: false,
        enabled: true,
      },
    ],
    'UTC',
    null,
    ['r'],
  ],
  [
    'reposts unknown opt-in',
    { ...generated(), engagement: { likes: 0, reposts: null } },
    [
      {
        id: 'r',
        kind: 'reposts-at-least',
        count: 5,
        alsoWhenUnknown: true,
        enabled: true,
      },
    ],
    'UTC',
    null,
    ['r'],
  ],
  [
    'repost inapplicable',
    { ...generated('x:1', null), kind: 'repost' },
    [
      {
        id: 'l',
        kind: 'likes-at-least',
        count: 0,
        alsoWhenUnknown: true,
        enabled: true,
      },
    ],
    'UTC',
    null,
    [],
  ],
  [
    'Instagram inapplicable',
    {
      ...generated('instagram:1', null),
      platform: 'instagram',
      kind: 'comment',
    },
    [
      {
        id: 'r',
        kind: 'reposts-at-least',
        count: 0,
        alsoWhenUnknown: true,
        enabled: true,
      },
    ],
    'UTC',
    null,
    [],
  ],
  [
    'date at local midnight',
    { ...generated(), createdAt: '2026-10-20T22:00:00.000Z' },
    [{ id: 'd', kind: 'created-from', date: '2026-10-21', enabled: true }],
    'Europe/Berlin',
    null,
    ['d'],
  ],
  [
    'date before local midnight',
    { ...generated(), createdAt: '2026-10-20T21:59:59.999Z' },
    [{ id: 'd', kind: 'created-from', date: '2026-10-21', enabled: true }],
    'Europe/Berlin',
    null,
    [],
  ],
  [
    'disabled',
    generated('x:1', 10),
    [
      {
        id: 'l',
        kind: 'likes-at-least',
        count: 0,
        alsoWhenUnknown: true,
        enabled: false,
      },
    ],
    'UTC',
    null,
    [],
  ],
  [
    'OR keeps every reason',
    { ...generated('x:1', 10), engagement: { likes: 10, reposts: 5 } },
    [
      {
        id: 'l',
        kind: 'likes-at-least',
        count: 10,
        alsoWhenUnknown: false,
        enabled: true,
      },
      {
        id: 'r',
        kind: 'reposts-at-least',
        count: 5,
        alsoWhenUnknown: false,
        enabled: true,
      },
    ],
    'UTC',
    null,
    ['l', 'r'],
  ],
  [
    'top tenth tie',
    generated('x:1', 7),
    [{ id: 't', kind: 'top-liked-tenth', enabled: true }],
    'UTC',
    7,
    ['t'],
  ],
] satisfies [
  string,
  Item,
  import('./schema.ts').KeepRule[],
  string,
  number | null,
  string[],
][])('keep-rule %s', (_name, item, rules, zone, threshold, expected) => {
  expect(evaluateKeepRules(item, rules, zone, threshold)).toEqual(expected);
});
test('top tenth uses ceil rank, all ties, per account and the three-like floor', () => {
  const items = Array.from({ length: 11 }, (_, index) =>
    generated(`x:${index}`, index < 3 ? 7 : 0),
  );
  expect(popularityThreshold(items, 'x:generated')).toBe(7);
  expect(
    items
      .filter(
        (item) =>
          evaluateKeepRules(
            item,
            [{ id: 'top', kind: 'top-liked-tenth', enabled: true }],
            'UTC',
            7,
          ).length,
      )
      .map((item) => item.id),
  ).toEqual(['x:0', 'x:1', 'x:2']);
  expect(
    popularityThreshold(
      [generated('x:1', 0), generated('x:2', 2)],
      'x:generated',
    ),
  ).toBe(3);
  expect(popularityThreshold(items, 'x:other')).toBeNull();
});
