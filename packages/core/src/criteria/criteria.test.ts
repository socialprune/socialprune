import { expect, test } from 'vitest';
import {
  PRESETS,
  definitionHash,
  criterionRoom,
  addCustomCriterion,
} from './presets.ts';
import { evaluateKeepRules } from './keep-rules.ts';
import { feedCounts, currentChecks } from './feed.ts';
import { migrateReviewContract } from './migration.ts';
import { CriteriaSettingsSchema } from './schema.ts';
import { WorkspaceV2Schema } from '../model/index.ts';
import { createWorkspace } from '../workspace/store.ts';
import type { Item, WorkspaceV2 } from '../model/index.ts';

const at = '2026-10-20T12:00:00.000Z';
function item(id: string, likes: number | null = 0): Item {
  return {
    id: `x:${id}`,
    platform: 'x',
    account: { key: 'x:generated', handle: null },
    kind: 'post',
    text: 'Generated text',
    createdAt: at,
    engagement: { likes, reposts: 0 },
    reference: {
      replyToId: null,
      replyToHandle: null,
      quotedId: null,
      repostOfHandle: null,
      ownerHandle: null,
    },
    url: null,
    provenance: { archive: 'generated', file: 'generated.json', index: 0 },
    mediaCount: null,
  };
}
function assessment(
  id: string,
  category: string,
  submissionId: string | null = null,
  risk = 2,
) {
  return {
    assessmentId: id,
    itemId: 'x:1',
    submissionId,
    category,
    risk,
    source: { kind: 'model' as const, name: 'generated', version: null },
    reason: 'Generated reason',
    evidence: null,
    confidence: null,
    createdAt: at,
  };
}

test('presets retain the ten IDs and add four content definitions with stable hashes', () => {
  expect(PRESETS.map((preset) => preset.id)).toEqual([
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
    new Set(PRESETS.map((preset) => definitionHash(preset.definition))).size,
  ).toBe(14);
});
test('32 IDs preserve earlier categories, report no room, and removed custom IDs never return', () => {
  const categories = Array.from(
    { length: 32 },
    (_, index) => `earlier-${index}`,
  );
  expect(criterionRoom(categories).unavailable).toEqual(
    PRESETS.map((preset) => preset.id),
  );
  expect(criterionRoom(categories).categories).toEqual(categories);
  const settings = createWorkspace().settings;
  const first = addCustomCriterion(settings, {
    label: 'Generated',
    description: 'Generated criterion',
    createdAt: at,
  });
  expect(first.criteria.custom[0]?.id).toBe('custom-1');
  const removed = {
    ...first,
    categories: first.categories.filter((id) => id !== 'custom-1'),
    criteria: { ...first.criteria, custom: [], selected: [] },
  };
  expect(
    addCustomCriterion(removed, {
      label: 'Next',
      description: 'Next criterion',
      createdAt: at,
    }).criteria.custom[0]?.id,
  ).toBe('custom-2');
  expect(() =>
    addCustomCriterion(
      { ...first, categories },
      { label: 'Next', description: 'Next', createdAt: at },
    ),
  ).toThrow('NO_ROOM');
});
test('keep rules distinguish zero, unknown and inapplicable counts, combine with OR, and use local dates', () => {
  const likes = {
    id: 'likes',
    enabled: true,
    kind: 'likes-at-least' as const,
    count: 10,
    alsoWhenUnknown: true,
  };
  const reposts = {
    id: 'reposts',
    enabled: true,
    kind: 'reposts-at-least' as const,
    count: 5,
    alsoWhenUnknown: false,
  };
  expect(
    evaluateKeepRules(item('1', 0), [likes], 'Europe/Berlin', null),
  ).toEqual([]);
  expect(
    evaluateKeepRules(item('1', null), [likes], 'Europe/Berlin', null),
  ).toEqual(['likes']);
  expect(
    evaluateKeepRules(
      { ...item('1', null), kind: 'repost' },
      [likes],
      'UTC',
      null,
    ),
  ).toEqual([]);
  expect(
    evaluateKeepRules(
      { ...item('1', null), platform: 'instagram', kind: 'comment' },
      [likes],
      'UTC',
      null,
    ),
  ).toEqual(['likes']);
  expect(
    evaluateKeepRules(
      { ...item('1'), engagement: { likes: 10, reposts: 5 } },
      [likes, reposts],
      'UTC',
      null,
    ),
  ).toEqual(['likes', 'reposts']);
  const date = {
    id: 'date',
    enabled: true,
    kind: 'created-from' as const,
    date: '2026-10-21',
  };
  expect(
    evaluateKeepRules(
      { ...item('1'), createdAt: '2026-10-20T22:00:00.000Z' },
      [date],
      'Europe/Berlin',
      null,
    ),
  ).toEqual(['date']);
  expect(
    evaluateKeepRules(
      { ...item('1'), createdAt: '2026-10-20T21:59:59.999Z' },
      [date],
      'Europe/Berlin',
      null,
    ),
  ).toEqual([]);
});
test('partial reruns leave other criteria standing and edited definitions become unchecked', () => {
  const workspace = createWorkspace();
  workspace.items = [item('1')];
  workspace.settings.criteria!.selected = ['political', 'sexual'];
  const political = PRESETS.find((value) => value.id === 'political')!;
  const sexual = PRESETS.find((value) => value.id === 'sexual')!;
  workspace.submissions = [
    {
      submissionId: 'old',
      contentHash: definitionHash('old'),
      source: assessment('a', 'political').source,
      receivedAt: at,
      labelCount: 2,
      criteria: [political, sexual].map((value) => ({
        id: value.id,
        hash: definitionHash(value.definition),
      })),
    },
    {
      submissionId: 'new',
      contentHash: definitionHash('new'),
      source: assessment('a', 'political').source,
      receivedAt: at,
      labelCount: 1,
      criteria: [{ id: 'sexual', hash: definitionHash(sexual.definition) }],
    },
  ];
  workspace.assessments = [
    assessment('a', 'political', 'old'),
    assessment('b', 'sexual', 'old'),
    assessment('c', 'harmless', 'new', 0),
  ];
  const checks = currentChecks(workspace).get('x:1')!;
  expect(
    checks
      .filter((check) => check.assessment?.category === 'political')
      .map((check) => check.criterion),
  ).toEqual(['political']);
  expect(checks.find((check) => check.criterion === 'sexual')?.status).toBe(
    'clear',
  );
  const own = addCustomCriterion(workspace.settings, {
    label: 'Own',
    description: 'Before',
    createdAt: at,
  });
  workspace.settings = own;
  workspace.settings.criteria!.selected = ['custom-1'];
  workspace.submissions.push({
    ...workspace.submissions[0]!,
    submissionId: 'own',
    labelCount: 1,
    criteria: [{ id: 'custom-1', hash: definitionHash('Before') }],
  });
  workspace.assessments.push(assessment('own', 'custom-1', 'own'));
  expect(feedCounts(workspace).tabs.suggested).toBe(1);
  workspace.settings.criteria!.custom[0]!.description = 'After';
  expect(feedCounts(workspace).unchecked['custom-1']).toBe(1);
  expect(feedCounts(workspace).tabs.suggested).toBe(0);
});
test('migration preserves prior criteria and submissions, is idempotent, and defaults differ from new workspaces', () => {
  const old = {
    ...createWorkspace(),
    schemaVersion: 6,
    settings: {
      categories: ['political', 'earlier', 'harmless', 'unclear'],
      timeZone: 'UTC',
    },
  } as WorkspaceV2;
  old.items = [item('1')];
  old.assessments = [assessment('a', 'earlier')];
  const migrated = migrateReviewContract(old);
  expect(migrated.settings.criteria!.selected).toEqual([
    'political',
    'earlier',
  ]);
  expect(migrated.settings.criteria!.level).toBe(2);
  expect(migrated.settings.keepRules).toEqual([
    { id: 'top-liked-tenth', kind: 'top-liked-tenth', enabled: true },
  ]);
  expect(migrateReviewContract(migrated)).toEqual(migrated);
  expect(createWorkspace().settings.criteria!.selected).toEqual([]);
  expect(createWorkspace().settings.criteria!.level).toBe(0);
});

test('accepted migration of 32 earlier categories must keep all ticked and satisfy the selected-ID cap', () => {
  const {
    reviewPlans: omittedPlans,
    counts: currentCounts,
    ...header
  } = createWorkspace();
  const { reviewPlans: omittedCount, ...counts } = currentCounts;
  void omittedPlans;
  void omittedCount;
  const legacy = {
    ...header,
    counts,
    schemaVersion: 6,
    settings: {
      categories: Array.from({ length: 32 }, (_, index) => `earlier-${index}`),
      timeZone: 'UTC',
    },
  };
  // This is a valid old workspace. No harmless or unclear IDs occupy its slots.
  expect(WorkspaceV2Schema.safeParse(legacy).success).toBe(true);
  const migrated = migrateReviewContract(legacy);
  expect(migrated.settings.categories).toEqual(legacy.settings.categories);
  expect(migrated.settings.criteria!.selected).toEqual(
    legacy.settings.categories,
  );
  // ADR-034, accepted on 2026-10-21, keeps all earlier selections
  // within the 32-ID mask.
  expect(
    CriteriaSettingsSchema.safeParse(migrated.settings.criteria).success,
  ).toBe(true);
});
