import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import {
  AccountSchema,
  AssessmentSchema,
  CategoryIdSchema,
  DecisionSchema,
  DiagnosticSchema,
  evidenceIsVerbatim,
  ImportRecordSchema,
  ItemKindSchema,
  ItemSchema,
  OutcomeSchema,
  PlatformIdSchema,
  WorkspaceSchema,
} from './index.ts';
import { generateJsonSchemas } from '../node/schemas.ts';
import { sampleItem, timestamp } from '../testing.ts';

const assessment = {
  itemId: 'x:123',
  source: { kind: 'rules', name: 'test', version: null },
  category: 'unclear',
  risk: 1,
  reason: 'Review this sentence.',
  evidence: 'Generated',
  confidence: null,
  createdAt: timestamp,
};
const decision = {
  itemId: 'x:123',
  value: 'later',
  decidedAt: timestamp,
  source: { kind: 'human', via: 'web-review' },
};
const outcome = { itemId: 'x:123', value: 'unknown', recordedAt: timestamp };
const workspace = {
  schemaVersion: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  settings: { categories: ['unclear'] },
  imports: [],
  items: [sampleItem()],
  assessments: [assessment],
  decisions: [decision],
  outcomes: [outcome],
};
test('strict models accept valid values and extensible platform/category IDs', () => {
  expect(PlatformIdSchema.parse('another-platform')).toBe('another-platform');
  expect(CategoryIdSchema.parse('custom-category')).toBe('custom-category');
  expect(ItemSchema.parse(sampleItem())).toEqual(sampleItem());
  expect(WorkspaceSchema.parse(workspace)).toEqual(workspace);
  expect(OutcomeSchema.parse(outcome)).toEqual(outcome);
  expect(ItemKindSchema.options).toEqual([
    'post',
    'reply',
    'quote',
    'repost',
    'comment',
  ]);
  expect(
    AccountSchema.parse({ key: 'x:account', handle: null }).handle,
  ).toBeNull();
  for (const status of ['missing', 'empty', 'unreadable'])
    expect(
      DiagnosticSchema.parse({
        category: 'posts',
        status,
        files: [],
        count: 0,
        message: null,
      }).status,
    ).toBe(status);
  expect(
    ImportRecordSchema.parse({
      id: 'import',
      platform: 'x',
      importedAt: timestamp,
      archives: ['demo'],
      exportCreatedAt: null,
      accounts: [],
      adapter: { name: 'fake', version: '1' },
      variant: null,
      diagnostics: [],
      itemCount: 0,
    }).itemCount,
  ).toBe(0);
});
test('models reject number IDs, unknown keys, invalid risks, timestamps and nonhuman decisions', () => {
  expect(ItemSchema.safeParse({ ...sampleItem(), id: 123 }).success).toBe(
    false,
  );
  expect(
    ItemSchema.safeParse({ ...sampleItem(), unexpected: true }).success,
  ).toBe(false);
  expect(
    ItemSchema.safeParse({
      ...sampleItem(),
      engagement: { likes: -1, reposts: null },
    }).success,
  ).toBe(false);
  expect(
    ItemSchema.safeParse({
      ...sampleItem(),
      createdAt: '2026-01-01T00:00:00+01:00',
    }).success,
  ).toBe(false);
  expect(AssessmentSchema.safeParse({ ...assessment, risk: 4 }).success).toBe(
    false,
  );
  expect(
    AssessmentSchema.safeParse({
      ...assessment,
      reason: 'First sentence. Second sentence.',
    }).success,
  ).toBe(false);
  expect(
    DecisionSchema.safeParse({
      ...decision,
      source: { kind: 'agent', via: 'web-review' },
    }).success,
  ).toBe(false);
});
test('verbatim evidence requires an exact case-sensitive substring', () => {
  const parsed = AssessmentSchema.parse(assessment);
  expect(evidenceIsVerbatim(sampleItem(), parsed)).toBe(true);
  expect(evidenceIsVerbatim(sampleItem(), { ...parsed, evidence: null })).toBe(
    true,
  );
  expect(
    evidenceIsVerbatim(sampleItem(), { ...parsed, evidence: 'generated' }),
  ).toBe(false);
});
test('five committed JSON schemas match zod and encode required strict object shapes', async () => {
  const schemas = await generateJsonSchemas();
  const samples = {
    item: sampleItem(),
    assessment,
    decision,
    outcome,
    workspace,
  };
  for (const [name, sample] of Object.entries(samples)) {
    const path = new URL(`../../schemas/${name}.schema.json`, import.meta.url);
    const content = await readFile(path, 'utf8');
    expect(content).toBe(schemas[`${name}.schema.json`]);
    const schema: unknown = JSON.parse(content);
    expect(schema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `https://socialprune.github.io/socialprune/schemas/${name}.schema.json`,
      type: 'object',
      additionalProperties: false,
    });
    expect(schema).toHaveProperty('required');
    const parsed = schema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    for (const key of parsed.required) expect(sample).toHaveProperty(key);
    expect(Object.keys(parsed.properties).sort()).toEqual(
      Object.keys(sample).sort(),
    );
  }
});
