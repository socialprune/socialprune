import { expect, test } from 'vitest';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { createWorkspace, readWorkspace } from './store.ts';
import { SettingsService } from './settings.ts';
import { QueryEngine } from './query.ts';
import { createBackup, restoreBackup } from './backup.ts';
import { HttpReviewRequestSchema } from './protocol.ts';
import { generatedItem, generatedLabel } from '../criteria/rules-fixture.ts';
import { criterionHash } from '../criteria/presets.ts';

test.each(['earlier-0', 'custom-1'])(
  'removing %s frees an active slot and keeps historical suggestions, plans and decisions through restore',
  async (removed) => {
    const value = createWorkspace({ timeZone: 'UTC' });
    value.settings.categories = Array.from(
      { length: 32 },
      (_, n) => `earlier-${n}`,
    );
    value.settings.criteria = {
      selected: [removed],
      custom:
        removed === 'custom-1'
          ? [
              {
                id: removed,
                label: 'Violet toolbox',
                description: 'Mentions an invented violet toolbox.',
                createdAt: value.createdAt,
              },
            ]
          : [],
      nextCustom: removed === 'custom-1' ? 2 : 1,
      level: 0,
    };
    value.settings.categories[0] = removed;
    const recordedHash = criterionHash(removed, value.settings);
    value.items = [generatedItem()];
    value.assessments = [
      {
        ...generatedLabel('old', removed, null, 'x:1'),
        submissionId: 'old-run',
      },
    ];
    value.submissions = [
      {
        submissionId: 'old-run',
        contentHash: `sha256:${'1'.repeat(64)}`,
        source: { kind: 'agent', name: 'generated-agent', version: '1' },
        receivedAt: value.createdAt,
        labelCount: 1,
        criteria: [{ id: removed, hash: recordedHash }],
      },
    ];
    value.assessments[0]!.source = value.submissions[0]!.source;
    value.decisionEvents = [
      {
        eventId: 'old-decision',
        seq: 1,
        itemId: 'x:1',
        value: 'delete',
        previous: 'undecided',
        decidedAt: value.createdAt,
        source: { kind: 'human', via: 'web-review' },
        action: { id: 'old-plan', kind: 'bulk', size: 1, reverts: null },
      },
    ];
    value.reviewPlans = [
      {
        actionId: 'old-plan',
        accountKey: value.items[0]!.account.key,
        createdAt: value.createdAt,
        criteria: [{ id: removed, hash: recordedHash }],
        level: 0,
        keepRules: [],
        counts: {
          suggested: 1,
          held: 0,
          kept: 0,
          unclear: 0,
          marked: 0,
          all: 1,
        },
        sources: [],
      },
    ];
    value.counts = {
      ...value.counts,
      items: 1,
      assessments: 1,
      submissions: 1,
      decisionEvents: 1,
      reviewPlans: 1,
    };
    const store = createMemoryStore(new MemoryStoreBacking(value)),
      restored = createMemoryStore();
    const service = new SettingsService(store);
    const before = await store.read(readWorkspace);
    await expect(
      service.setCriteria(value.settings.criteria, [removed]),
    ).rejects.toThrow('INVALID_REQUEST');
    await expect(
      service.setCriteria({ ...value.settings.criteria, selected: [] }, [
        removed,
        removed,
      ]),
    ).rejects.toThrow('INVALID_REQUEST');
    if (removed === 'custom-1')
      await expect(
        service.setCriteria({ ...value.settings.criteria, selected: [] }, [
          removed,
        ]),
      ).rejects.toThrow('INVALID_REQUEST');
    const changed = await service.setCriteria(
      { ...value.settings.criteria, selected: [], custom: [] },
      [removed],
    );
    expect(changed.categories).toHaveLength(32);
    expect(changed.categories).not.toContain(removed);
    expect(changed.categories).toContain('toxic');
    expect(changed.revision).toBe(0);
    const saved = await store.read(readWorkspace);
    for (const key of [
      'assessments',
      'submissions',
      'decisionEvents',
      'reviewPlans',
    ] as const)
      expect(saved[key]).toEqual(before[key]);
    const query = new QueryEngine(store);
    expect(
      (
        await query.feedWindow({
          accountKey: value.items[0]!.account.key,
          tab: 'all',
          offset: 0,
          limit: 50,
        })
      ).cards[0]?.suggestions[0]?.category,
    ).toBe(removed);
    await restoreBackup(restored, createBackup(store).chunks);
    const roundTrip = await restored.read(readWorkspace);
    for (const key of [
      'assessments',
      'submissions',
      'decisionEvents',
      'reviewPlans',
    ] as const)
      expect(roundTrip[key]).toEqual(before[key]);
    expect(roundTrip.schemaVersion).toBe(8);
    const criteria = { ...changed.criteria, selected: ['toxic'] };
    await expect(service.setCriteria(criteria, ['toxic'])).rejects.toThrow(
      'INVALID_REQUEST',
    );
    await expect(service.setCriteria(criteria, ['missing'])).rejects.toThrow(
      'INVALID_REQUEST',
    );
    expect(
      HttpReviewRequestSchema.safeParse({
        type: 'setCriteria',
        requestId: 'generated',
        criteria,
        removeCategories: ['earlier-1', 'earlier-1'],
      }).success,
    ).toBe(false);
    await store.close();
    await restored.close();
  },
);
