import { expect, test } from 'vitest';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { LabelService } from './labels.ts';
import { contractWorkspace } from './store-contract.ts';
import { createWorkspace, readWorkspace } from './store.ts';
import type { WorkspaceStore } from './store.ts';
import { contentHash } from './canonical.ts';
import { validateWorkspace } from './validation.ts';
import { addCustomCriterion, criterionHash } from '../criteria/presets.ts';
import { currentChecks } from '../criteria/suggestions.ts';
import type { LabelFile, SourceLabelFile } from './payloads.ts';

function workspace() {
  const value = contractWorkspace();
  value.items.push({
    ...value.items[0]!,
    account: { ...value.items[0]!.account },
    id: 'x:2',
    text: 'Generated second text.',
    createdAt: '2026-01-02T00:00:00Z',
  });
  value.counts.items = 2;
  return value;
}
async function file() {
  const value = workspace();
  return {
    schemaVersion: 1,
    submissionId: 'generated-labels',
    source: { kind: 'agent' as const, name: 'agent', version: null },
    labels: await Promise.all(
      value.items.map(async (item) => ({
        itemId: item.id,
        contentHash: await contentHash(item.text),
        category: 'harmless',
        risk: 0,
        reason: 'This generated text is a plain statement.',
        evidence: null as string | null,
        confidence: null,
      })),
    ),
  };
}
test('submission is all-or-nothing, stores record and evidence warnings, and never appends human events', async () => {
  const store = createMemoryStore(new MemoryStoreBacking(workspace()));
  const service = new LabelService(store);
  try {
    const valid = await file();
    const bad = structuredClone(valid);
    bad.labels[1]!.category = 'unknown-category';
    const before = await store.read(readWorkspace);
    await expect(service.submitLabels(bad)).rejects.toMatchObject({
      code: 'INVALID_LABELS',
      failures: [{ index: 1, code: 'UNKNOWN_CATEGORY' }],
    });
    expect(await store.read(readWorkspace)).toEqual(before);
    valid.labels[0]!.evidence = 'NOT_A_VERBATIM_SUBSTRING';
    expect(await service.submitLabels(valid, { dryRun: true })).toMatchObject({
      accepted: 2,
      dryRun: true,
      droppedEvidence: 1,
    });
    expect(await store.read(readWorkspace)).toEqual(before);
    expect(await service.submitLabels(valid)).toMatchObject({
      accepted: 2,
      duplicate: false,
      droppedEvidence: 1,
    });
    const after = await store.read(readWorkspace);
    expect(after.submissions).toHaveLength(1);
    expect(after.assessments).toHaveLength(2);
    expect(after.assessments[0]?.evidence).toBeNull();
    expect(after.decisionEvents).toEqual([]);
    expect(after.outcomeEvents).toEqual([]);
    expect(validateWorkspace(after)).toEqual(after);
    expect(await service.submitLabels(valid)).toMatchObject({
      duplicate: true,
      accepted: 2,
    });
    const conflict = structuredClone(valid);
    conflict.labels[0]!.reason = 'Changed generated statement.';
    await expect(service.submitLabels(conflict)).rejects.toMatchObject({
      code: 'SUBMISSION_CONFLICT',
    });
    expect((await store.read(readWorkspace)).assessments).toHaveLength(2);
    const restored = createMemoryStore(new MemoryStoreBacking(after));
    try {
      const serviceAfterSnapshotReopen = new LabelService(restored);
      expect(
        await serviceAfterSnapshotReopen.submitLabels(valid),
      ).toMatchObject({ duplicate: true });
      await expect(
        serviceAfterSnapshotReopen.submitLabels(conflict),
      ).rejects.toMatchObject({ code: 'SUBMISSION_CONFLICT' });
    } finally {
      await restored.close();
    }
  } finally {
    await store.close();
  }
});
test('content changes, wrong source, duplicate IDs, invalid reasons and forged decisions reject before writes', async () => {
  const store = createMemoryStore(new MemoryStoreBacking(workspace()));
  const service = new LabelService(store);
  try {
    const valid = await file();
    for (const invalid of [
      { ...valid, source: { ...valid.source, kind: 'fixture' } },
      { ...valid, labels: [valid.labels[0], valid.labels[0]] },
      {
        ...valid,
        labels: [
          { ...valid.labels[0], contentHash: `sha256:${'0'.repeat(64)}` },
        ],
      },
      {
        ...valid,
        labels: [
          { ...valid.labels[0], reason: 'First sentence. Another sentence.' },
        ],
      },
      { ...valid, labels: [{ ...valid.labels[0], itemId: 'x:missing' }] },
      { ...valid, labels: [{ ...valid.labels[0], decision: 'delete' }] },
    ]) {
      await expect(service.submitLabels(invalid)).rejects.toThrow();
      expect((await store.read(readWorkspace)).assessments).toEqual([]);
      expect((await store.read(readWorkspace)).submissions).toEqual([]);
      expect((await store.read(readWorkspace)).decisionEvents).toEqual([]);
    }
  } finally {
    await store.close();
  }
});
test('label storage failure rolls back both submission and assessments', async () => {
  const store = createMemoryStore(new MemoryStoreBacking(workspace()));
  const broken: WorkspaceStore = {
    read: (operation) => store.read(operation),
    close: () => store.close(),
    write: (operation) =>
      store.write(async (tx) => {
        await operation(tx);
        throw new Error('Synthetic rejected commit.');
      }),
  };
  try {
    await expect(
      new LabelService(broken).submitLabels(await file()),
    ).rejects.toThrow();
    const value = await store.read(readWorkspace);
    expect(value.submissions).toEqual([]);
    expect(value.assessments).toEqual([]);
    expect(await store.read(async (tx) => tx.runtime.get())).toEqual({
      revision: 0,
      lastEventSeq: 0,
    });
  } finally {
    await store.close();
  }
});
test('fixture assessment service accepts only demo and cannot invent agent submissions', async () => {
  const initial = workspace();
  const personal = createMemoryStore(new MemoryStoreBacking(initial));
  initial.kind = 'demo';
  const demo = createMemoryStore(new MemoryStoreBacking(initial));
  const assessment = {
    assessmentId: 'fixture-1',
    submissionId: null,
    itemId: 'x:1',
    source: { kind: 'fixture' as const, name: 'generated-demo', version: null },
    category: 'unclear',
    risk: 1,
    reason: 'This generated demo needs review.',
    evidence: null,
    confidence: null,
    createdAt: initial.createdAt,
  };
  try {
    await expect(
      new LabelService(personal).appendAssessment(assessment),
    ).rejects.toMatchObject({ code: 'FIXTURE_NOT_ALLOWED' });
    expect((await personal.read(readWorkspace)).assessments).toEqual([]);
    await new LabelService(demo).appendAssessment(assessment);
    expect((await demo.read(readWorkspace)).assessments).toEqual([assessment]);
    await expect(
      new LabelService(demo).appendAssessment({
        ...assessment,
        assessmentId: 'agent-1',
        source: { ...assessment.source, kind: 'agent' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_LABEL' });
  } finally {
    await personal.close();
    await demo.close();
  }
});
test('batch sharing is explicit, privacy-minimal, keyset-bounded and cursor-scoped', async () => {
  const store = createMemoryStore(new MemoryStoreBacking(workspace()));
  const service = new LabelService(store);
  try {
    await expect(
      service.batchNext({ shareWithAgent: false }),
    ).rejects.toMatchObject({ code: 'SHARING_NOT_CONFIRMED' });
    const first = await service.batchNext({ shareWithAgent: true, size: 1 });
    expect(first.items.map((item) => item.itemId)).toEqual(['x:1']);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    const second = await service.batchNext({
      shareWithAgent: true,
      size: 1,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((item) => item.itemId)).toEqual(['x:2']);
    expect(second.hasMore).toBe(false);
    const serialized = JSON.stringify(first.items);
    for (const forbidden of [
      'x:contract',
      'posts.json',
      'engagement',
      'reference',
      'handle',
    ])
      expect(serialized).not.toContain(forbidden);
    await expect(
      service.batchNext({
        shareWithAgent: true,
        cursor: first.nextCursor!,
        sourceName: 'different',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(
      service.batchNext({ shareWithAgent: true, size: 201 }),
    ).rejects.toThrow();
    await service.submitLabels(await file());
    // V1 checks eight legacy defaults, not the four new presets.
    expect(
      (await service.batchNext({ shareWithAgent: true })).items,
    ).toHaveLength(2);
    const summary = await service.summary();
    expect(summary).toMatchObject({
      withoutAgentAssessment: 0,
      decisions: { undecided: 2 },
      kinds: { post: 2 },
      counts: { items: 2, assessments: 2, submissions: 1 },
    });
    expect(JSON.stringify(summary)).not.toContain('Generated contract input.');
  } finally {
    await store.close();
  }
});

function withOwnCriteria() {
  const value = workspace();
  value.settings = addCustomCriterion(value.settings, {
    label: 'Old workshop',
    description: 'Mentions the old lantern workshop.',
    createdAt: value.createdAt,
  });
  value.settings = addCustomCriterion(value.settings, {
    label: 'Unticked own',
    description: 'Mentions a violet toolbox.',
    createdAt: value.createdAt,
  });
  value.settings.criteria!.selected = ['custom-1'];
  return value;
}
async function v2File(
  value = withOwnCriteria(),
  submissionId = 'generated-v2',
): Promise<Extract<LabelFile, { schemaVersion: 2 }>> {
  const original = await file();
  return {
    ...original,
    schemaVersion: 2,
    submissionId,
    criteria: ['political', 'racist', 'custom-1'].map((id) => ({
      id,
      hash: criterionHash(id, value.settings),
    })),
    labels: [
      { ...original.labels[0]!, category: 'political', risk: 0 },
      { ...original.labels[0]!, category: 'racist', risk: 2 },
      { ...original.labels[1]!, category: 'harmless', risk: 0 },
    ],
  };
}
test('batch carries every available preset plus selected own definitions without rules, including when nothing is ticked', async () => {
  const initial = withOwnCriteria();
  initial.settings.categories.push('earlier-restored');
  initial.settings.criteria!.selected.push('earlier-restored');
  const store = createMemoryStore(new MemoryStoreBacking(initial));
  try {
    const batch = await new LabelService(store).batchNext({
      shareWithAgent: true,
    });
    expect(batch.criteria.map((value) => value.id)).toEqual([
      'toxic',
      'personal-attack',
      'political',
      'sexual',
      'drugs-illegal',
      'personal-info',
      'embarrassing',
      'empty',
      'racist',
      'misogynistic',
      'group-hostility',
      'politically-incorrect',
      'custom-1',
    ]);
    expect(batch.criteria.at(-1)).toEqual({
      id: 'custom-1',
      label: 'Old workshop',
      definition: 'Mentions the old lantern workshop.',
      hash: criterionHash('custom-1', initial.settings),
    });
    expect(batch.categories).toContain('earlier-restored');
    expect(JSON.stringify(batch)).not.toContain('violet toolbox');
    expect(JSON.stringify(batch)).not.toContain('top-liked-tenth');
    const hash = batch.batchId;
    await store.write(async (tx) => {
      const meta = await tx.meta.get();
      meta.settings.criteria!.selected = [];
      await tx.meta.set(meta);
    });
    const unticked = await new LabelService(store).batchNext({
      shareWithAgent: true,
    });
    expect(unticked.criteria).toHaveLength(12);
    expect(unticked.items).toHaveLength(2);
    expect(unticked.batchId).not.toBe(hash);
  } finally {
    await store.close();
  }
});
test('v2 stores several per-criterion suggestions, hash checks and source without decisions; partial reruns preserve other checks', async () => {
  const initial = withOwnCriteria(),
    store = createMemoryStore(new MemoryStoreBacking(initial));
  try {
    const service = new LabelService(store),
      input = await v2File(initial);
    const before = await store.read(readWorkspace);
    expect(await service.submitLabels(input, { dryRun: true })).toMatchObject({
      accepted: 3,
      dryRun: true,
    });
    expect(await store.read(readWorkspace)).toEqual(before);
    await service.submitLabels(input);
    let saved = await store.read(readWorkspace);
    expect(saved.submissions[0]!.criteria).toEqual(input.criteria);
    expect(
      saved.assessments.map((value) => [
        value.itemId,
        value.category,
        value.risk,
        value.source,
      ]),
    ).toEqual(
      input.labels.map((label) => [
        label.itemId,
        label.category,
        label.risk,
        input.source,
      ]),
    );
    expect(validateWorkspace(saved)).toEqual(saved);
    const partial = {
      ...input,
      submissionId: 'generated-own-only',
      source: { ...input.source, version: '2' },
      criteria: input.criteria.filter((value) => value.id === 'custom-1'),
      labels: [{ ...input.labels[0]!, category: 'unclear', risk: 1 }],
    };
    await service.submitLabels(partial);
    saved = await store.read(readWorkspace);
    const checks = currentChecks(saved).get(initial.items[0]!.id)!;
    expect(
      checks.find((value) => value.criterion === 'political'),
    ).toMatchObject({ status: 'hit', source: { version: null } });
    expect(checks.find((value) => value.criterion === 'racist')).toMatchObject({
      status: 'hit',
      source: { version: null },
    });
    expect(
      checks.find((value) => value.criterion === 'custom-1'),
    ).toMatchObject({ status: 'unclear', source: { version: '2' } });
    expect(saved.decisionEvents).toEqual([]);
    expect(saved.outcomeEvents).toEqual([]);
    expect(saved.reviewPlans).toEqual([]);
    expect(await service.submitLabels(input)).toMatchObject({
      duplicate: true,
    });
    expect(await store.read(readWorkspace)).toEqual(saved);
    await store.write(async (tx) => {
      const meta = await tx.meta.get();
      meta.settings.criteria!.custom[0]!.description =
        'Mentions the old violet workshop.';
      await tx.meta.set(meta);
    });
    const afterEdit = await store.read(readWorkspace);
    expect(
      currentChecks(afterEdit)
        .get(initial.items[0]!.id)!
        .some((value) => value.criterion === 'custom-1'),
    ).toBe(false);
    expect(
      (await service.batchNext({ shareWithAgent: true })).items,
    ).toHaveLength(2);
  } finally {
    await store.close();
  }
});
test('v2 rejects stale, unchecked, duplicate and mixed exclusive labels before any write', async () => {
  const initial = withOwnCriteria(),
    store = createMemoryStore(new MemoryStoreBacking(initial));
  try {
    const input = await v2File(initial),
      before = await store.read(readWorkspace),
      service = new LabelService(store);
    const first = input.labels[0]!;
    for (const [value, failure] of [
      [
        {
          ...input,
          criteria: [{ id: 'custom-1', hash: `sha256:${'0'.repeat(64)}` }],
          labels: [{ ...first, category: 'custom-1' }],
        },
        { index: -1, code: 'CRITERION_CHANGED' },
      ],
      [
        { ...input, criteria: [], labels: [first] },
        { index: 0, code: 'CATEGORY_NOT_CHECKED' },
      ],
      [
        { ...input, labels: [first, first] },
        { index: 1, code: 'INVALID_LABEL' },
      ],
      [
        { ...input, labels: [first, { ...first, category: 'harmless' }] },
        { index: 1, code: 'INVALID_LABEL' },
      ],
      [
        { ...input, labels: [{ ...first, category: 'unclear' }, first] },
        { index: 1, code: 'INVALID_LABEL' },
      ],
      [
        {
          ...input,
          labels: [
            { ...first, category: 'harmless' },
            { ...first, category: 'unclear' },
          ],
        },
        { index: 1, code: 'INVALID_LABEL' },
      ],
    ] as const) {
      await expect(service.submitLabels(value)).rejects.toMatchObject({
        code: 'INVALID_LABELS',
        failures: [failure],
      });
      expect(await store.read(readWorkspace)).toEqual(before);
    }
  } finally {
    await store.close();
  }
});
test('v1 records only the eight legacy defaults, never new presets, own or earlier categories', async () => {
  const initial = withOwnCriteria();
  initial.settings.categories.push('earlier-restored');
  const store = createMemoryStore(new MemoryStoreBacking(initial));
  try {
    const service = new LabelService(store),
      input = await file();
    await service.submitLabels(input);
    const saved = await store.read(readWorkspace);
    expect(saved.submissions[0]!.criteria?.map((value) => value.id)).toEqual([
      'toxic',
      'personal-attack',
      'political',
      'sexual',
      'drugs-illegal',
      'personal-info',
      'embarrassing',
      'empty',
    ]);
    expect(currentChecks(saved).get(initial.items[0]!.id)).toHaveLength(8);
    for (const category of ['racist', 'custom-1', 'earlier-restored']) {
      await expect(
        service.submitLabels({
          ...input,
          submissionId: `v1-${category}`,
          labels: [{ ...input.labels[0]!, category }],
        }),
      ).rejects.toMatchObject({
        failures: [{ index: 0, code: 'CATEGORY_NOT_CHECKED' }],
      });
    }
    expect(validateWorkspace(saved)).toEqual(saved);
  } finally {
    await store.close();
  }
});
test('same-source coverage controls batches independently of other sources and edited hashes', async () => {
  const initial = withOwnCriteria(),
    store = createMemoryStore(new MemoryStoreBacking(initial));
  try {
    const service = new LabelService(store),
      input = await v2File(initial);
    const offered = (
      await service.batchNext({ shareWithAgent: true })
    ).criteria.map(({ id, hash }) => ({ id, hash }));
    await service.submitLabels({ ...input, criteria: offered });
    expect((await service.batchNext({ shareWithAgent: true })).items).toEqual(
      [],
    );
    expect(
      (
        await service.batchNext({
          shareWithAgent: true,
          sourceName: 'different',
        })
      ).items,
    ).toHaveLength(2);
    await store.write(async (tx) => {
      const meta = await tx.meta.get();
      meta.settings.criteria!.custom[0]!.description =
        'Another generated description.';
      await tx.meta.set(meta);
    });
    expect(
      (await service.batchNext({ shareWithAgent: true })).items,
    ).toHaveLength(2);
    const fresh = (
      await service.batchNext({ shareWithAgent: true })
    ).criteria.find((value) => value.id === 'custom-1')!;
    await service.submitLabels({
      ...input,
      submissionId: 'own-rerun',
      criteria: [{ id: fresh.id, hash: fresh.hash }],
      labels: input.labels
        .filter((value) => value.category !== 'racist')
        .map((value) => ({ ...value, category: 'harmless' })),
    });
    expect((await service.batchNext({ shareWithAgent: true })).items).toEqual(
      [],
    );
  } finally {
    await store.close();
  }
});
test('criteria changed between validation and the transaction reject atomically', async () => {
  const initial = withOwnCriteria(),
    store = createMemoryStore(new MemoryStoreBacking(initial));
  const racing: WorkspaceStore = {
    read: (fn) => store.read(fn),
    close: () => store.close(),
    write: async (fn) => {
      await store.write(async (tx) => {
        const meta = await tx.meta.get();
        meta.settings.criteria!.custom[0]!.description =
          'Changed before commit.';
        await tx.meta.set(meta);
      });
      return store.write(fn);
    },
  };
  try {
    await expect(
      new LabelService(racing).submitLabels(await v2File(initial)),
    ).rejects.toMatchObject({
      failures: [{ index: -1, code: 'CRITERION_CHANGED' }],
    });
    const saved = await store.read(readWorkspace);
    expect(saved.submissions).toEqual([]);
    expect(saved.assessments).toEqual([]);
    expect(saved.decisionEvents).toEqual([]);
  } finally {
    await store.close();
  }
});
test('batch permits one oversized item without truncation and requires an account for multiple accounts', async () => {
  const initial = workspace();
  initial.items[0]!.text = 'ä'.repeat(140_000);
  initial.items[1]!.account.key = 'x:second-account';
  const store = createMemoryStore(new MemoryStoreBacking(initial));
  try {
    const service = new LabelService(store);
    await expect(
      service.batchNext({ shareWithAgent: true }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_REQUIRED' });
    const batch = await service.batchNext({
      shareWithAgent: true,
      account: 'x:contract',
    });
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0]?.content.text).toHaveLength(140_000);
  } finally {
    await store.close();
  }
  expect(createWorkspace().schemaVersion).toBe(9);
});
async function sourceFile(
  initial = withOwnCriteria(),
  kind: 'model' | 'rules' = 'model',
): Promise<SourceLabelFile> {
  const agent = await v2File(initial);
  return {
    ...agent,
    submissionId: `generated-${kind}`,
    source: {
      kind,
      name: 'generated-source',
      version: 'generated-model rubric 123456789abc',
    },
  };
}
test.each(['model', 'rules'] as const)(
  '%s source persists suggestions atomically, replays after reopen and cannot enter agent submission',
  async (kind) => {
    const initial = withOwnCriteria();
    const store = createMemoryStore(new MemoryStoreBacking(initial));
    try {
      const service = new LabelService(store);
      const input = await sourceFile(initial, kind);
      const before = await store.read(readWorkspace);
      await expect(service.submitLabels(input)).rejects.toMatchObject({
        code: 'INVALID_LABELS',
      });
      await expect(
        service.submitSourceLabels(await v2File(initial)),
      ).rejects.toMatchObject({ code: 'INVALID_LABELS' });
      expect(
        await service.submitSourceLabels(input, { dryRun: true }),
      ).toMatchObject({ accepted: 3, dryRun: true });
      expect(await store.read(readWorkspace)).toEqual(before);
      expect(await service.submitSourceLabels(input)).toMatchObject({
        accepted: 3,
        duplicate: false,
        revision: 1,
      });
      const saved = await store.read(readWorkspace);
      expect(saved.assessments.every((a) => a.source.kind === kind)).toBe(true);
      expect(saved.submissions[0]?.criteria).toEqual(input.criteria);
      expect(saved.decisionEvents).toEqual([]);
      expect(saved.outcomeEvents).toEqual([]);
      expect(saved.reviewPlans).toEqual([]);
      expect(validateWorkspace(saved)).toEqual(saved);
      const reopened = createMemoryStore(new MemoryStoreBacking(saved));
      try {
        const again = new LabelService(reopened);
        expect(await again.submitSourceLabels(input)).toMatchObject({
          accepted: 3,
          duplicate: true,
          revision: 0,
        });
        await expect(
          again.submitSourceLabels({
            ...input,
            labels: [
              { ...input.labels[0], reason: 'Changed generated reason.' },
            ],
          }),
        ).rejects.toMatchObject({ code: 'SUBMISSION_CONFLICT' });
        expect(await reopened.read(readWorkspace)).toEqual(saved);
      } finally {
        await reopened.close();
      }
    } finally {
      await store.close();
    }
  },
);
test('source batch selection is scoped to kind, name, version and current selected criterion hashes; cursor cannot cross those identities', async () => {
  const initial = withOwnCriteria();
  initial.settings.criteria!.selected = ['political', 'custom-1'];
  const store = createMemoryStore(new MemoryStoreBacking(initial));
  const service = new LabelService(store);
  const options = {
    shareWithAgent: true,
    sourceKind: 'model' as const,
    sourceName: 'generated-source',
    sourceVersion: 'generated-model rubric 123456789abc',
  };
  try {
    const offered = await service.batchNext({ ...options, size: 1 });
    expect(offered.criteria.map((c) => c.id)).toEqual([
      'political',
      'custom-1',
    ]);
    const input = await sourceFile(initial);
    input.criteria = offered.criteria.map(({ id, hash }) => ({ id, hash }));
    input.labels = input.labels.filter((l) => l.category !== 'racist');
    await service.submitSourceLabels(input);
    expect((await service.batchNext(options)).items).toEqual([]);
    for (const changed of [
      { sourceKind: 'rules' as const },
      { sourceName: 'other' },
      { sourceVersion: 'another-model rubric 123456789abc' },
    ]) {
      expect(
        (await service.batchNext({ ...options, ...changed })).items,
      ).toHaveLength(2);
      await expect(
        service.batchNext({
          ...options,
          ...changed,
          cursor: offered.nextCursor!,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    }
    expect(
      (
        await service.batchNext({
          shareWithAgent: true,
          sourceName: options.sourceName,
        })
      ).items,
    ).toHaveLength(2);
    await store.write(async (tx) => {
      const meta = await tx.meta.get();
      meta.settings.criteria!.custom[0]!.description =
        'Changed generated definition.';
      await tx.meta.set(meta);
    });
    expect((await service.batchNext(options)).items).toHaveLength(2);
    const prior = await store.read(readWorkspace);
    await expect(
      service.submitSourceLabels({ ...input, submissionId: 'stale-source' }),
    ).rejects.toMatchObject({
      failures: [{ index: -1, code: 'CRITERION_CHANGED' }],
    });
    expect(await store.read(readWorkspace)).toEqual(prior);
  } finally {
    await store.close();
  }
});
test('source submission rolls back on storage failure and rechecks criterion and content races', async () => {
  for (const mode of ['storage', 'criterion', 'content'] as const) {
    const initial = withOwnCriteria();
    const store = createMemoryStore(new MemoryStoreBacking(initial));
    const altered: WorkspaceStore = {
      read: (fn) => store.read(fn),
      close: () => store.close(),
      write: async (fn) => {
        if (mode !== 'storage')
          await store.write(async (tx) => {
            if (mode === 'criterion') {
              const meta = await tx.meta.get();
              meta.settings.criteria!.custom[0]!.description =
                'Changed before source commit.';
              await tx.meta.set(meta);
            } else {
              const stored = await tx.items.get('x:1');
              await tx.items.put({
                ...stored!,
                item: {
                  ...stored!.item,
                  text: 'Changed before source commit.',
                },
              });
            }
          });
        return store.write(async (tx) => {
          const result = await fn(tx);
          if (mode === 'storage') throw new Error('Generated rollback.');
          return result;
        });
      },
    };
    try {
      await expect(
        new LabelService(altered).submitSourceLabels(await sourceFile(initial)),
      ).rejects.toThrow();
      const saved = await store.read(readWorkspace);
      expect(saved.assessments).toEqual([]);
      expect(saved.submissions).toEqual([]);
      expect(saved.decisionEvents).toEqual([]);
      expect((await store.read((tx) => tx.runtime.get())).revision).toBe(0);
    } finally {
      await store.close();
    }
  }
});
test('concurrent identical source submissions append exactly one receipt and assessment set', async () => {
  const initial = withOwnCriteria();
  const store = createMemoryStore(new MemoryStoreBacking(initial));
  try {
    const input = await sourceFile(initial);
    const service = new LabelService(store);
    const receipts = await Promise.all([
      service.submitSourceLabels(input),
      service.submitSourceLabels(input),
    ]);
    expect(receipts.map((receipt) => receipt.duplicate).sort()).toEqual([
      false,
      true,
    ]);
    const saved = await store.read(readWorkspace);
    expect(saved.submissions).toHaveLength(1);
    expect(saved.assessments).toHaveLength(3);
    expect((await store.read((tx) => tx.runtime.get())).revision).toBe(1);
    expect(saved.decisionEvents).toEqual([]);
  } finally {
    await store.close();
  }
});
