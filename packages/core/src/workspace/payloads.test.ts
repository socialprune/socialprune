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
      items: [],
      nextCursor: null,
      hasMore: false,
      remaining: 0,
      notice: BATCH_NOTICE,
      shared: {
        count: 0,
        fields: ['itemId', 'kind', 'createdAt', 'contentHash', 'text'],
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
