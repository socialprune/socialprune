import { expect, test } from 'vitest';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { LabelService } from './labels.ts';
import { contractWorkspace } from './store-contract.ts';
import { createWorkspace, readWorkspace } from './store.ts';
import type { WorkspaceStore } from './store.ts';
import { contentHash } from './canonical.ts';
import { validateWorkspace } from './validation.ts';

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
    expect((await service.batchNext({ shareWithAgent: true })).items).toEqual(
      [],
    );
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
  expect(createWorkspace().schemaVersion).toBe(2);
});
