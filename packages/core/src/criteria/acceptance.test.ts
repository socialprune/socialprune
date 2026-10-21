import { expect, test } from 'vitest';
import { createWorkspace } from '../workspace/store.ts';
import { feedCounts } from './feed.ts';
import { currentChecks } from './suggestions.ts';
import {
  PRESETS,
  definitionHash,
  addCustomCriterion,
  criterionRoom,
} from './presets.ts';
import { CriteriaSettingsSchema, KeepRulesSchema } from './schema.ts';
import {
  generatedItem,
  generatedLabel,
  generatedRun,
} from './rules-fixture.ts';

test('presets keep the fourteen rubric IDs and SHA-256 binds UTF-8 definitions', () => {
  expect(PRESETS.map(({ id }) => id)).toEqual([
    'toxic',
    'personal-attack',
    'political',
    'sexual',
    'drugs-illegal',
    'personal-info',
    'embarrassing',
    'empty',
    'harmless',
    'unclear',
    'racist',
    'misogynistic',
    'group-hostility',
    'politically-incorrect',
  ]);
  expect(definitionHash('abc')).toBe(
    'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  expect(
    PRESETS.every((value) => value.hash === definitionHash(value.definition)),
  ).toBe(true);
});
test('removed custom IDs never return', () => {
  const first = addCustomCriterion(createWorkspace().settings, {
    label: 'Generated',
    description: 'Generated criterion',
    createdAt: '2026-10-21T00:00:00Z',
  });
  const removed = {
    ...first,
    categories: first.categories.filter((id) => id !== 'custom-1'),
    criteria: { ...first.criteria, custom: [], selected: [] },
  };
  expect(
    addCustomCriterion(removed, {
      label: 'Next',
      description: 'Next criterion',
      createdAt: '2026-10-21T00:00:00Z',
    }).criteria.custom[0]!.id,
  ).toBe('custom-2');
});
test('room retains earlier IDs and appends only presets that fit', () => {
  const earlier = Array.from({ length: 31 }, (_, index) => `earlier-${index}`);
  expect(criterionRoom(earlier)).toEqual({
    categories: [...earlier, 'toxic'],
    unavailable: [
      'personal-attack',
      'political',
      'sexual',
      'drugs-illegal',
      'personal-info',
      'embarrassing',
      'empty',
      'harmless',
      'unclear',
      'racist',
      'misogynistic',
      'group-hostility',
      'politically-incorrect',
    ],
  });
});
test('no room refuses an own criterion without dropping earlier IDs', () => {
  const settings = {
    ...createWorkspace().settings,
    categories: Array.from({ length: 32 }, (_, index) => `earlier-${index}`),
  };
  expect(() =>
    addCustomCriterion(settings, {
      label: 'Generated',
      description: 'Generated criterion',
      createdAt: '2026-10-21T00:00:00Z',
    }),
  ).toThrow('NO_ROOM');
  expect(settings.categories).toHaveLength(32);
});
test('own criteria stop at eight and descriptions and labels keep their limits', () => {
  let settings = createWorkspace().settings;
  for (let index = 0; index < 8; index++)
    settings = addCustomCriterion(settings, {
      label: `Generated ${index}`,
      description: 'Generated criterion',
      createdAt: '2026-10-21T00:00:00Z',
    });
  expect(() =>
    addCustomCriterion(settings, {
      label: 'Ninth',
      description: 'Generated',
      createdAt: '2026-10-21T00:00:00Z',
    }),
  ).toThrow('CUSTOM_LIMIT');
  expect(() =>
    addCustomCriterion(createWorkspace().settings, {
      label: 'x'.repeat(61),
      description: 'Generated',
      createdAt: '2026-10-21T00:00:00Z',
    }),
  ).toThrow();
  expect(() =>
    addCustomCriterion(createWorkspace().settings, {
      label: 'Generated',
      description: 'x'.repeat(301),
      createdAt: '2026-10-21T00:00:00Z',
    }),
  ).toThrow();
});
test('at most sixteen unique keep rules are accepted', () => {
  const rules = Array.from({ length: 16 }, (_, index) => ({
    id: `${index}`,
    kind: 'top-liked-tenth',
    enabled: true,
  }));
  expect(KeepRulesSchema.safeParse(rules).success).toBe(true);
  expect(
    KeepRulesSchema.safeParse([...rules, { ...rules[0], id: '17' }]).success,
  ).toBe(false);
  expect(KeepRulesSchema.safeParse([rules[0], rules[0]]).success).toBe(false);
});
test('hit requires a ticked content criterion at or above the chosen level', () => {
  const value = createWorkspace();
  value.items = [generatedItem()];
  value.settings.keepRules = [];
  value.settings.criteria!.selected = ['political'];
  value.settings.criteria!.level = 2;
  value.submissions = [generatedRun('hit', ['political'])];
  value.assessments = [generatedLabel('hit', 'political', 'hit', undefined, 1)];
  expect(feedCounts(value).tabs.suggested).toBe(0);
  value.assessments[0]!.risk = 2;
  expect(feedCounts(value).tabs.suggested).toBe(1);
  value.settings.criteria!.selected = [];
  expect(feedCounts(value).tabs.suggested).toBe(0);
  for (const category of ['harmless', 'unclear']) {
    value.settings.criteria!.selected = ['political'];
    value.assessments[0]!.category = category;
    value.assessments[0]!.risk = 3;
    expect(feedCounts(value).tabs.suggested).toBe(0);
  }
  expect(
    CriteriaSettingsSchema.safeParse({
      ...value.settings.criteria,
      selected: ['harmless'],
    }).success,
  ).toBe(false);
});
test('tab order preserves decisions ahead of holds and hits and Later stays Unclear', () => {
  const value = createWorkspace();
  value.settings.criteria!.selected = ['political'];
  value.settings.keepRules = [
    {
      id: 'likes',
      kind: 'likes-at-least',
      enabled: true,
      count: 10,
      alsoWhenUnknown: false,
    },
  ];
  const cases = [
    ['marked', 'delete', 'political', 20],
    ['kept', 'keep', 'political', 20],
    ['later', 'later', 'political', 20],
    ['held', 'undecided', 'political', 20],
    ['suggested', 'undecided', 'political', 0],
    ['unclear', 'undecided', 'unclear', 0],
    ['all', 'undecided', 'harmless', 0],
  ] as const;
  for (const [index, [id, decision, category, likes]] of cases.entries()) {
    value.items.push(generatedItem(`x:${id}`, likes));
    value.assessments.push({
      ...generatedLabel(`a-${id}`, category, null, `x:${id}`),
      source: { kind: 'fixture', name: 'generated', version: null },
    });
    if (decision !== 'undecided')
      value.decisionEvents.push({
        eventId: `e-${id}`,
        seq: index + 1,
        itemId: `x:${id}`,
        previous: 'undecided',
        value: decision,
        decidedAt: value.createdAt,
        source: { kind: 'human', via: 'web-review' },
        action: { id: `action-${id}`, kind: 'single', size: 1, reverts: null },
      });
  }
  expect(Object.fromEntries(feedCounts(value).membership)).toEqual({
    'x:marked': 'marked',
    'x:kept': 'kept',
    'x:later': 'unclear',
    'x:held': 'held',
    'x:suggested': 'suggested',
    'x:unclear': 'unclear',
    'x:all': 'all',
  });
});
test('each source and criterion keeps its own latest matching-hash result', () => {
  const value = createWorkspace();
  value.items = [generatedItem()];
  value.settings.criteria!.selected = ['political', 'sexual'];
  value.settings.keepRules = [];
  value.submissions = [
    generatedRun('first', ['political', 'sexual'], 2),
    generatedRun('second', ['sexual']),
    {
      ...generatedRun('other', ['political']),
      source: { kind: 'rules', name: 'another-source', version: null },
    },
  ];
  value.assessments = [
    generatedLabel('p', 'political', 'first'),
    generatedLabel('s', 'sexual', 'first'),
    generatedLabel('clear', 'harmless', 'second', undefined, 0),
    {
      ...generatedLabel('other', 'harmless', 'other', undefined, 0),
      source: { kind: 'rules', name: 'another-source', version: null },
    },
  ];
  expect(feedCounts(value).tabs.suggested).toBe(1);
  expect(
    currentChecks(value)
      .get('x:1')!
      .filter((check) => check.criterion === 'political')
      .map((check) => [check.source.name, check.status]),
  ).toEqual([
    ['generated', 'hit'],
    ['another-source', 'clear'],
  ]);
  expect(
    currentChecks(value)
      .get('x:1')!
      .find((check) => check.criterion === 'sexual')!.status,
  ).toBe('clear');
});
test('a changed definition is unchecked until the source covers the current hash', () => {
  const value = createWorkspace();
  value.items = [generatedItem()];
  value.settings = addCustomCriterion(value.settings, {
    label: 'Generated',
    description: 'Before',
    createdAt: '2026-10-21T00:00:00Z',
  });
  value.settings.criteria!.selected = ['custom-1'];
  value.submissions = [
    {
      ...generatedRun('own', ['political']),
      criteria: [{ id: 'custom-1', hash: definitionHash('Before') }],
    },
  ];
  value.assessments = [generatedLabel('own', 'custom-1', 'own')];
  expect(feedCounts(value).tabs.suggested).toBe(1);
  value.settings.criteria!.custom[0]!.description = 'After';
  expect(feedCounts(value).tabs.suggested).toBe(0);
  expect(feedCounts(value).unchecked['custom-1']).toBe(1);
});
