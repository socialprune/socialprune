import { expect, test } from 'vitest';
import { createWorkspace } from './store.ts';
import { generatedItem, generatedLabel } from '../criteria/rules-fixture.ts';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { FeedQuery } from './feed-query.ts';
import { CompactFeed } from './feed-compact.ts';
import { projectFeed } from './feed-query.ts';
import { generatedRun } from '../criteria/rules-fixture.ts';
import { criterionHash } from '../criteria/presets.ts';

test('retained feed query never retains entry bodies or assessment explanations', async () => {
  const workspace = createWorkspace();
  workspace.settings.criteria!.selected = ['political'];
  workspace.settings.keepRules = [];
  workspace.items = [generatedItem('x:compact')];
  workspace.items[0]!.text = 'GENERATED_BODY_MUST_NOT_STAY_IN_COUNT_CACHE';
  workspace.assessments = [
    {
      ...generatedLabel('compact-label', 'political', null, 'x:compact'),
      reason: 'GENERATED_EXPLANATION_MUST_NOT_STAY_IN_COUNT_CACHE',
      evidence: 'GENERATED_QUOTE_MUST_NOT_STAY_IN_COUNT_CACHE',
    },
  ];
  workspace.counts.items = 1;
  workspace.counts.assessments = 1;
  const query = new FeedQuery(
    createMemoryStore(new MemoryStoreBacking(workspace)),
  );
  await query.counts('x:generated');
  const seen = new Set<unknown>();
  function retained(value: unknown): unknown[] {
    if (value === null || typeof value !== 'object') return [value];
    if (seen.has(value)) return [];
    seen.add(value);
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return [];
    if (value instanceof Map)
      return [...value].flatMap(([key, entry]) => [
        ...retained(key),
        ...retained(entry),
      ]);
    if (value instanceof Set) return [...value].flatMap(retained);
    return Reflect.ownKeys(value)
      .filter((key) => key !== 'store')
      .flatMap((key) => retained(Reflect.get(value, key)));
  }
  const strings = retained(query)
    .filter((value) => typeof value === 'string')
    .join('\n');
  expect(strings).not.toContain(workspace.items[0]!.text);
  expect(strings).not.toContain(workspace.assessments[0]!.reason);
  expect(strings).not.toContain(workspace.assessments[0]!.evidence);
});

test('historical category IDs do not impose a new byte-sized taxonomy limit', () => {
  const workspace = createWorkspace();
  workspace.items = [generatedItem('x:many-criteria')];
  workspace.assessments = Array.from({ length: 260 }, (_, index) => ({
    ...generatedLabel(
      `historic-${index}`,
      `historic-${index}`,
      null,
      'x:many-criteria',
    ),
    source: {
      kind: 'model' as const,
      name: `Generated source ${index}`,
      version: null,
    },
  }));
  const expected = projectFeed(workspace, 'x:generated');
  const actual = new CompactFeed(workspace).project(
    workspace.settings,
    'x:generated',
  );
  expect(actual.hits).toEqual(expected.hits);
  expect(actual.tabs).toEqual(expected.tabs);
});

test('linear projection storage including order is eight bytes per entry, apart from retained inputs', () => {
  for (const count of [10, 1000]) {
    const workspace = createWorkspace();
    workspace.items = Array.from({ length: count }, (_, index) =>
      generatedItem(`x:projection-${index}`),
    );
    const compact = new CompactFeed(workspace);
    const projection = compact.project(workspace.settings, 'x:generated');
    const order = Reflect.get(compact, 'order') as Uint32Array;
    const bytes =
      projection.membership.byteLength +
      projection.base.byteLength +
      projection.holding.byteLength +
      order.byteLength;
    expect(bytes).toBe(count * 8);
    expect(Object.keys(projection.tabs)).toHaveLength(6);
    expect(Object.keys(projection.hits)).toEqual(workspace.settings.categories);
  }
});

test('compact columns reproduce the existing projection across sources, hashes, levels, rules and accounts', () => {
  const workspace = createWorkspace({ timeZone: 'Europe/Berlin' });
  workspace.settings.criteria!.selected = ['political', 'toxic', 'empty'];
  workspace.settings.criteria!.custom = [
    {
      id: 'custom-1',
      label: 'Generated criterion',
      description: 'Generated definition.',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ];
  workspace.settings.criteria!.nextCustom = 2;
  workspace.settings.categories.push('custom-1');
  workspace.items = Array.from({ length: 48 }, (_, index) => ({
    ...generatedItem(`x:compact-${index}`, index % 5 === 0 ? null : index % 17),
    platform: index % 7 === 0 ? ('instagram' as const) : ('x' as const),
    kind:
      index % 7 === 0
        ? ('comment' as const)
        : index % 11 === 0
          ? ('repost' as const)
          : ('post' as const),
    account: { key: index % 3 === 0 ? 'x:other' : 'x:generated', handle: null },
    createdAt: new Date(Date.UTC(2024, 0, 1, index)).toISOString(),
    engagement: {
      likes: index % 5 === 0 ? null : index % 17,
      reposts: index % 4 === 0 ? null : index % 3,
    },
  }));
  workspace.assessments = workspace.items.flatMap((item, index) => [
    generatedLabel(
      `standalone-${index}`,
      ['political', 'toxic', 'unclear', 'harmless'][index % 4]!,
      null,
      item.id,
      index % 4,
    ),
    {
      ...generatedLabel(
        `run1-${index}`,
        index % 2 ? 'political' : 'empty',
        'run1',
        item.id,
        index % 4,
      ),
      source: { kind: 'agent' as const, name: 'Generated agent', version: '1' },
    },
    {
      ...generatedLabel(
        `run2-${index}`,
        index % 3 ? 'harmless' : 'unclear',
        'run2',
        item.id,
        0,
      ),
      source: { kind: 'agent' as const, name: 'Generated agent', version: '2' },
    },
    {
      ...generatedLabel(`own-${index}`, 'custom-1', 'own', item.id, 2),
      source: {
        kind: 'rules' as const,
        name: 'Generated rules',
        version: null,
      },
    },
  ]);
  workspace.submissions = [
    {
      ...generatedRun('run1', ['political', 'empty'], 48),
      source: { kind: 'agent', name: 'Generated agent', version: '1' },
    },
    {
      ...generatedRun('run2', ['political'], 48),
      source: { kind: 'agent', name: 'Generated agent', version: '2' },
    },
    {
      ...generatedRun('own', [], 48),
      source: { kind: 'rules', name: 'Generated rules', version: null },
      criteria: [
        { id: 'custom-1', hash: criterionHash('custom-1', workspace.settings) },
      ],
    },
  ];
  workspace.decisionEvents = workspace.items.slice(0, 4).map((item, index) => ({
    eventId: `event-${index}`,
    seq: index + 1,
    itemId: item.id,
    value: (['keep', 'delete', 'later', 'undecided'] as const)[index]!,
    previous: 'undecided',
    decidedAt: '2026-10-20T00:00:00.000Z',
    source: { kind: 'human', via: 'web-review' },
    action: { id: `action-${index}`, kind: 'single', size: 1, reverts: null },
  }));
  const rules = [
    { id: 'top', kind: 'top-liked-tenth' as const, enabled: true },
    {
      id: 'likes',
      kind: 'likes-at-least' as const,
      count: 4,
      alsoWhenUnknown: true,
      enabled: true,
    },
    {
      id: 'reposts',
      kind: 'reposts-at-least' as const,
      count: 2,
      alsoWhenUnknown: false,
      enabled: true,
    },
    {
      id: 'date',
      kind: 'created-from' as const,
      date: '2024-01-02',
      enabled: true,
    },
    {
      id: 'off',
      kind: 'likes-at-least' as const,
      count: 0,
      alsoWhenUnknown: true,
      enabled: false,
    },
  ];
  for (const changedDefinition of [false, true]) {
    if (changedDefinition)
      workspace.settings.criteria!.custom[0]!.description =
        'Generated changed definition.';
    const compact = new CompactFeed(workspace);
    for (const selected of [
      ['political'],
      ['political', 'toxic', 'empty', 'custom-1'],
      [],
    ])
      for (const level of [0, 1, 2] as const)
        for (const keepRules of [[], rules])
          for (const account of ['x:generated', 'x:other', 'missing']) {
            workspace.settings.criteria!.selected = selected;
            workspace.settings.criteria!.level = level;
            workspace.settings.keepRules = keepRules;
            const actual = compact.project(workspace.settings, account),
              expected = projectFeed(workspace, account);
            for (const key of [
              'tabs',
              'hits',
              'held',
              'unchecked',
              'popularThreshold',
            ] as const)
              expect(actual[key]).toEqual(expected[key]);
            for (const tab of [
              'all',
              'suggested',
              'held',
              'kept',
              'marked',
              'unclear',
            ] as const)
              expect(compact.window(actual, tab)).toEqual(
                expected.order.filter(
                  (id) => tab === 'all' || expected.membership.get(id) === tab,
                ),
              );
            for (const id of expected.order)
              expect(compact.holding(actual, id)).toEqual(
                expected.holding.get(id),
              );
          }
  }
});
