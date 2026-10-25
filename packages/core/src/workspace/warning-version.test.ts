import { expect, test } from 'vitest';
import { WORKSPACE_SCHEMA_VERSION } from '../model/index.ts';
import { JOURNAL_FIXTURE } from '../model/browser-fixture.ts';
import { createMemoryStore } from './memory-store.ts';
import { contractWorkspace } from './store-contract.ts';
import { createWorkspace, readWorkspace } from './store.ts';
import { createBackup, readBackup, restoreBackup } from './backup.ts';

const chunks = (value: unknown) =>
  (async function* () {
    await Promise.resolve();
    yield JSON.stringify(value);
  })();
test('C32 warning classification is a version 9 field, preserved by portable backup without inventing older warnings', async () => {
  expect(WORKSPACE_SCHEMA_VERSION).toBe(9);
  expect(createWorkspace().schemaVersion).toBe(9);
  const workspace = contractWorkspace();
  const run = {
    ...JOURNAL_FIXTURE.run,
    endReason: 'platform-check' as const,
    warningKind: 'http-429' as const,
  };
  workspace.browserRuns = [run];
  workspace.browserAttempts = structuredClone(JOURNAL_FIXTURE.attempts);
  workspace.counts.browserRuns = 1;
  workspace.counts.browserAttempts = 2;
  for (const reversed of [false, true]) {
    const input = reversed
      ? Object.fromEntries(Object.entries(workspace).reverse())
      : workspace;
    const target = createMemoryStore();
    try {
      await restoreBackup(target, chunks(input));
      const restored = await target.read(readWorkspace);
      expect(restored.browserRuns).toEqual([run]);
      expect(
        (await readBackup(createBackup(target).chunks)).schemaVersion,
      ).toBe(9);
    } finally {
      await target.close();
    }
    const hybrid = { ...workspace, schemaVersion: 8 };
    await expect(
      readBackup(
        chunks(
          reversed
            ? Object.fromEntries(Object.entries(hybrid).reverse())
            : hybrid,
        ),
      ),
    ).rejects.toThrow();
    const invalid = createMemoryStore();
    try {
      await expect(
        restoreBackup(
          invalid,
          chunks(
            reversed
              ? Object.fromEntries(Object.entries(hybrid).reverse())
              : hybrid,
          ),
        ),
      ).rejects.toThrow();
    } finally {
      await invalid.close();
    }
  }
  const legacy = {
    ...workspace,
    schemaVersion: 8,
    browserRuns: [JOURNAL_FIXTURE.run],
  };
  const target = createMemoryStore();
  try {
    await restoreBackup(target, chunks(legacy));
    const value = await target.read(readWorkspace);
    expect(value.schemaVersion).toBe(9);
    expect(value.browserRuns).toEqual([JOURNAL_FIXTURE.run]);
    expect(Object.hasOwn(value.browserRuns![0]!, 'warningKind')).toBe(false);
  } finally {
    await target.close();
  }
});
