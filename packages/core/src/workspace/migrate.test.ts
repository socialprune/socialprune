import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { WorkspaceSchema as WorkspaceV1Schema } from '../model/v1.ts';
import { migrateV1 } from './migrate.ts';
import { deriveState } from './state.ts';
import { validateWorkspace, workspaceCounts } from './validation.ts';
import { WorkspaceError } from './errors.ts';

async function fixture() {
  const value: unknown = JSON.parse(
    await readFile(
      new URL(
        '../../../../fixtures/synthetic/workspace/v1.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  return WorkspaceV1Schema.parse(value);
}
test('v1 migration is deterministic, preserves sources and uses array order rather than timestamps', async () => {
  const old = await fixture();
  const original = JSON.stringify(old);
  const migrated = await migrateV1(old);
  expect(await migrateV1(old)).toEqual(migrated);
  expect(JSON.stringify(old)).toBe(original);
  expect(migrated).toMatchObject({
    format: 'socialprune-workspace',
    schemaVersion: 2,
    kind: 'personal',
    lastBackupAt: null,
    submissions: [],
    settings: { timeZone: null },
  });
  expect(migrated.id).toMatch(/^v1-[a-f0-9]{64}$/);
  expect(migrated.items.map((item) => item.mediaCount)).toEqual([null, null]);
  expect(migrated.imports.map((record) => record.status)).toEqual(['complete']);
  expect(
    migrated.decisionEvents.map((event) => [
      event.itemId,
      event.previous,
      event.value,
    ]),
  ).toEqual([
    ['x:1', 'undecided', 'delete'],
    ['x:2', 'undecided', 'later'],
    ['x:1', 'delete', 'keep'],
  ]);
  expect(
    migrated.outcomeEvents.map((event) => [
      event.previous,
      event.value,
      event.source.via,
    ]),
  ).toEqual([
    ['unknown', 'skipped', 'v1-unrecorded'],
    ['skipped', 'unknown', 'v1-unrecorded'],
  ]);
  for (const [index, event] of migrated.decisionEvents.entries())
    expect(event.source).toEqual(old.decisions[index]!.source);
  expect(migrated.assessments[0]).toMatchObject({
    ...old.assessments[0],
    submissionId: null,
  });
  expect(migrated.counts).toEqual({
    imports: 1,
    items: 2,
    assessments: 1,
    submissions: 0,
    decisionEvents: 3,
    outcomeEvents: 2,
  });
  const state = deriveState(migrated);
  // Hand-written truth table from the fixture action order, not the migration.
  expect(
    [...state].map(([id, value]) => [id, value.decision, value.outcome]),
  ).toEqual([
    ['x:1', 'keep', 'unknown'],
    ['x:2', 'later', 'unknown'],
  ]);
});
test('bad platform prefix is rejected without renaming or modifying the v1 input', async () => {
  const input = await fixture();
  input.items[0]!.id = '1';
  const snapshot = JSON.stringify(input);
  await expect(migrateV1(input)).rejects.toMatchObject({
    code: 'INVALID_ITEM_ID',
  });
  expect(JSON.stringify(input)).toBe(snapshot);
});
test('v2 logical validation checks chains, counts, references and fixture-only demo boundary', async () => {
  const valid = await migrateV1(await fixture());
  expect(validateWorkspace(valid)).toEqual(valid);
  const badChain = structuredClone(valid);
  badChain.decisionEvents[2]!.previous = 'undecided';
  expect(() => validateWorkspace(badChain)).toThrow(WorkspaceError);
  try {
    validateWorkspace(badChain);
  } catch (error) {
    expect(error).toMatchObject({ code: 'EVENT_CHAIN' });
  }
  const badCounts = { ...valid, counts: { ...valid.counts, items: 123 } };
  expect(() => validateWorkspace(badCounts)).toThrow('COUNT_MISMATCH');
  const unknownItem = structuredClone(valid);
  unknownItem.assessments[0]!.itemId = 'x:missing';
  expect(() => validateWorkspace(unknownItem)).toThrow('UNKNOWN_ITEM');
  const unknownSubmission = structuredClone(valid);
  unknownSubmission.assessments[0]!.submissionId = 'unknown';
  expect(() => validateWorkspace(unknownSubmission)).toThrow(
    'UNKNOWN_SUBMISSION',
  );
  const duplicate = structuredClone(valid);
  duplicate.items.push(duplicate.items[0]!);
  duplicate.counts = workspaceCounts(duplicate);
  expect(() => validateWorkspace(duplicate)).toThrow('DUPLICATE_ID');
  const personalFixture = structuredClone(valid);
  personalFixture.assessments[0]!.source.kind = 'fixture';
  expect(() => validateWorkspace(personalFixture)).toThrow(
    'FIXTURE_NOT_ALLOWED',
  );
  personalFixture.kind = 'demo';
  expect(validateWorkspace(personalFixture).assessments[0]?.source.kind).toBe(
    'fixture',
  );
  const forged = structuredClone(valid);
  forged.outcomeEvents[0]!.action.kind = 'single';
  expect(() => validateWorkspace(forged)).toThrow('ACTION_INVALID');
});
