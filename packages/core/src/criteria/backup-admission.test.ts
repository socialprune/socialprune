import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { readBackup, restoreBackup } from '../workspace/backup.ts';
import { createMemoryStore } from '../workspace/memory-store.ts';
import { createWorkspace } from '../workspace/store.ts';
import type { WorkspaceV2 } from '../model/index.ts';
import { CRITERIA_SELECTED_MAX } from './schema.ts';
import { generatedRun } from './rules-fixture.ts';

const chunks = (value: unknown) =>
  (async function* () {
    await Promise.resolve();
    yield JSON.stringify(value);
  })();
const readers = ['materialized', 'streaming'] as const;
async function read(kind: (typeof readers)[number], value: unknown) {
  if (kind === 'materialized') return readBackup(chunks(value));
  const store = createMemoryStore();
  try {
    return await restoreBackup(store, chunks(value));
  } finally {
    await store.close();
  }
}
const at = '2026-10-21T00:00:00.000Z';
const invalidV7: [string, (value: WorkspaceV2) => void][] = [
  [
    'selected ID unlisted',
    (value) => {
      value.settings.criteria!.selected = ['not-listed'];
    },
  ],
  [
    'own ID outside 32 listed IDs',
    (value) => {
      value.settings.categories = Array.from(
        { length: 32 },
        (_, i) => `earlier-${i}`,
      );
      value.settings.criteria!.custom = [
        {
          id: 'custom-1',
          label: 'Generated',
          description: 'Generated',
          createdAt: at,
        },
      ];
      value.settings.criteria!.nextCustom = 2;
    },
  ],
  [
    'selected over cap',
    (value) => {
      value.settings.criteria!.selected = Array.from(
        { length: CRITERIA_SELECTED_MAX + 1 },
        (_, i) => `earlier-${i}`,
      );
    },
  ],
  [
    'harmless selected',
    (value) => {
      value.settings.criteria!.selected = ['harmless'];
    },
  ],
  [
    'unclear selected',
    (value) => {
      value.settings.criteria!.selected = ['unclear'];
    },
  ],
  [
    'own criteria over eight',
    (value) => {
      value.settings.criteria!.custom = Array.from({ length: 9 }, (_, i) => ({
        id: `custom-${i + 1}`,
        label: 'Generated',
        description: 'Generated',
        createdAt: at,
      }));
      value.settings.criteria!.nextCustom = 10;
    },
  ],
  [
    'keep rules over sixteen',
    (value) => {
      value.settings.keepRules = Array.from({ length: 17 }, (_, i) => ({
        id: `rule-${i}`,
        kind: 'top-liked-tenth',
        enabled: true,
      }));
    },
  ],
  [
    'counter behind listed earlier custom ID',
    (value) => {
      value.settings.categories.push('custom-9');
      value.settings.criteria!.nextCustom = 1;
    },
  ],
];
for (const kind of readers)
  for (const [name, mutate] of invalidV7)
    test(`${kind} refuses v7 ${name}`, async () => {
      const value = createWorkspace();
      mutate(value);
      for (const document of [
        value,
        Object.fromEntries(Object.entries(value).reverse()),
      ])
        await expect(read(kind, document)).rejects.toBeInstanceOf(Error);
    });
for (const kind of readers)
  for (const version of [1, 2, 3, 4, 5, 6])
    for (const field of [
      'criteria',
      'keepRules',
      'feed',
      'reviewPlans',
      'submissionCriteria',
    ])
      test(`${kind} refuses v${version} carrying ${field}`, async () => {
        const path =
          version === 1
            ? '../../../../fixtures/synthetic/workspace/v1.json'
            : '../../../../fixtures/synthetic/workspace/backup-v2.json';
        const value = JSON.parse(
          await readFile(new URL(path, import.meta.url), 'utf8'),
        ) as WorkspaceV2;
        value.schemaVersion = version;
        if (version >= 3) {
          value.browserRuns = [];
          value.browserAttempts = [];
          value.counts = {
            ...value.counts,
            browserRuns: 0,
            browserAttempts: 0,
          };
        }
        if (field === 'criteria')
          value.settings.criteria = createWorkspace().settings.criteria;
        if (field === 'keepRules') value.settings.keepRules = [];
        if (field === 'feed')
          value.settings.review = {
            accountKey: null,
            filter: {},
            sort: [{ by: 'createdAt', direction: 'asc' }],
            search: '',
            feed: { tab: 'all', anchors: {} },
          };
        if (field === 'reviewPlans') {
          value.reviewPlans = [];
          if (version !== 1) value.counts.reviewPlans = 0;
        }
        if (field === 'submissionCriteria') {
          value.submissions = [generatedRun('generated', ['political'], 0)];
          if (version !== 1) value.counts.submissions = 1;
        }
        for (const document of [
          value,
          Object.fromEntries(Object.entries(value).reverse()),
        ])
          await expect(read(kind, document)).rejects.toBeInstanceOf(Error);
      });
