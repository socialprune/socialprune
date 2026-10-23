import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import {
  BatchSchema,
  LabelFileSchema,
  LabelSubmissionSchema,
  SummarySchema,
  ClickListSchema,
  ReviewReadinessSchema,
  BATCH_NOTICE,
} from './payloads.ts';
import { generateJsonSchemas } from '../node/schemas.ts';
import { LabelService } from './labels.ts';
import { createMemoryStore } from './memory-store.ts';

test('summary tab counts are an additive optional data field with unchanged output version', async () => {
  const store = createMemoryStore();
  try {
    const existing = await new LabelService(store).summary();
    expect(SummarySchema.parse(existing)).toEqual(existing);
    const tabs = {
      suggested: 1,
      held: 2,
      kept: 3,
      unclear: 4,
      marked: 5,
      all: 15,
    };
    expect(SummarySchema.parse({ ...existing, tabs })).toEqual({
      ...existing,
      tabs,
    });
    expect(existing.schemaVersion).toBe(2);
    expect(
      SummarySchema.safeParse({ ...existing, tabs: { ...tabs, held: -1 } })
        .success,
    ).toBe(false);
    expect(
      SummarySchema.safeParse({ ...existing, tabs: { ...tabs, unexpected: 1 } })
        .success,
    ).toBe(false);
  } finally {
    await store.close();
  }
});

test('neutral payload schemas preserve their exact shapes and reject decision fields in label input', () => {
  const label = {
    itemId: 'x:1',
    contentHash: `sha256:${'a'.repeat(64)}`,
    category: 'unclear',
    risk: 1,
    reason: 'Generated label needs review.',
    evidence: null,
    confidence: null,
  };
  const file = {
    schemaVersion: 1,
    submissionId: 'test-1',
    source: { kind: 'agent', name: 'test', version: null },
    labels: [label],
  };
  expect(LabelFileSchema.parse(file)).toEqual(file);
  expect(LabelFileSchema.safeParse({ ...file, decisions: [] }).success).toBe(
    false,
  );
  expect(
    LabelFileSchema.safeParse({
      ...file,
      labels: [{ ...label, decision: 'delete' }],
    }).success,
  ).toBe(false);
  expect(
    LabelFileSchema.safeParse({
      ...file,
      source: { ...file.source, kind: 'human' },
    }).success,
  ).toBe(false);
  expect(
    BatchSchema.parse({
      batchId: `sha256:${'b'.repeat(64)}`,
      categories: ['unclear'],
      criteria: [],
      items: [],
      nextCursor: null,
      hasMore: false,
      remaining: 0,
      notice: BATCH_NOTICE,
      shared: {
        count: 0,
        fields: [
          'itemId',
          'kind',
          'createdAt',
          'contentHash',
          'text',
          'criteria',
        ],
      },
    }).items,
  ).toEqual([]);
  expect(
    LabelSubmissionSchema.parse({
      submissionId: 'test-1',
      accepted: 1,
      duplicate: false,
      dryRun: false,
      droppedEvidence: 0,
      revision: 1,
    }).accepted,
  ).toBe(1);
  expect(
    ClickListSchema.parse({
      accountKey: 'generated-account',
      timeZone: 'UTC',
      timeZoneSource: 'system',
      entries: [],
    }).entries,
  ).toEqual([]);
  expect(
    ReviewReadinessSchema.parse({
      workspaceId: 'test',
      revision: 1,
      ready: true,
      completeImports: 1,
      incompleteImports: 0,
      visibleItems: 1,
    }).ready,
  ).toBe(true);
  expect(SummarySchema.safeParse({ itemText: 'PLANTED_TEXT' }).success).toBe(
    false,
  );
});
test('v2 checked criteria are hash-bound and agent-only while v1 stays strict', () => {
  const file = {
    schemaVersion: 2,
    submissionId: 'generated-v2',
    source: { kind: 'agent', name: 'generated', version: null },
    criteria: [{ id: 'racist', hash: `sha256:${'b'.repeat(64)}` }],
    labels: [
      {
        itemId: 'x:1',
        contentHash: `sha256:${'a'.repeat(64)}`,
        category: 'racist',
        risk: 2,
        reason: 'A generated suggestion for this criterion.',
        evidence: null,
        confidence: null,
      },
    ],
  };
  expect(LabelFileSchema.parse(file)).toEqual(file);
  for (const invalid of [
    { ...file, schemaVersion: 1 },
    { ...file, criteria: [{ id: 'racist', hash: 'wrong' }] },
    { ...file, criteria: [file.criteria[0], file.criteria[0]] },
    { ...file, criteria: [{ ...file.criteria[0], id: 'harmless' }] },
    { ...file, criteria: [{ ...file.criteria[0], id: 'unclear' }] },
    {
      ...file,
      criteria: [{ ...file.criteria[0], definition: 'not a hash reference' }],
    },
    { ...file, source: { ...file.source, kind: 'model' } },
    { ...file, source: { ...file.source, kind: 'rules' } },
    { ...file, decisions: [] },
  ])
    expect(LabelFileSchema.safeParse(invalid).success).toBe(false);
});
test('all neutral payload JSON files exist with the generated canonical content', async () => {
  const files = await generateJsonSchemas();
  for (const name of [
    'batch',
    'label-file',
    'label-submission',
    'summary',
    'click-list',
    'review-readiness',
  ]) {
    const content = await readFile(
      new URL(`../../schemas/${name}.schema.json`, import.meta.url),
      'utf8',
    );
    expect(content).toBe(files[`${name}.schema.json`]);
  }
});
