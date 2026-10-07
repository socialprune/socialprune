import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { generateJsonSchemas } from '../node/schemas.ts';
import { WorkspaceSchema as WorkspaceV1Schema } from './v1.ts';
import {
  WorkspaceV2Schema,
  DecisionEventSchema,
  OutcomeEventSchema,
  SubmissionSchema,
  ItemSchema,
} from './index.ts';

test('schema catalogue keeps exact v1 sources and seven generated v2 files', async () => {
  const files = await generateJsonSchemas();
  expect(Object.keys(files).sort()).toEqual(
    [
      'assessment.schema.json',
      'decision-event.schema.json',
      'import-record.schema.json',
      'item.schema.json',
      'outcome-event.schema.json',
      'submission.schema.json',
      'workspace.schema.json',
      'v1/assessment.schema.json',
      'v1/decision.schema.json',
      'v1/item.schema.json',
      'v1/outcome.schema.json',
      'v1/workspace.schema.json',
    ].sort(),
  );
  for (const [filename, content] of Object.entries(files)) {
    expect(
      await readFile(
        new URL(`../../schemas/${filename}`, import.meta.url),
        'utf8',
      ),
    ).toBe(content);
    const value: unknown = JSON.parse(content);
    expect(value).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `https://socialprune.github.io/socialprune/schemas/${filename}`,
    });
  }
  const v1: unknown = JSON.parse(
    await readFile(
      new URL(
        '../../../../fixtures/synthetic/workspace/v1.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  expect(WorkspaceV1Schema.safeParse(v1).success).toBe(true);
  expect(WorkspaceV2Schema.safeParse(v1).success).toBe(false);
});
test('v2 schemas reject agent events, invalid media counts and wrong submission source', () => {
  const event = {
    eventId: 'event',
    itemId: 'x:1',
    value: 'delete',
    previous: 'undecided',
    decidedAt: '2026-01-01T00:00:00Z',
    source: { kind: 'agent', via: 'web-review' },
    action: { id: 'action', kind: 'single', size: 1, reverts: null },
  };
  expect(DecisionEventSchema.safeParse(event).success).toBe(false);
  expect(
    OutcomeEventSchema.safeParse({
      ...event,
      value: 'unknown',
      previous: 'skipped',
      recordedAt: event.decidedAt,
    }).success,
  ).toBe(false);
  expect(
    SubmissionSchema.safeParse({
      submissionId: 'id',
      contentHash: `sha256:${'a'.repeat(64)}`,
      source: { kind: 'fixture', name: 'test', version: null },
      receivedAt: event.decidedAt,
      labelCount: 1,
    }).success,
  ).toBe(false);
  expect(ItemSchema.shape.mediaCount.safeParse(-1).success).toBe(false);
  expect(ItemSchema.shape.mediaCount.safeParse(1.5).success).toBe(false);
  expect(ItemSchema.shape.mediaCount.safeParse(null).success).toBe(true);
});
