import { test, expect } from '@playwright/test';
import {
  STORE_CONTRACT_CHECKS,
  contractWorkspace,
  writeInstagramContextContract,
} from '@socialprune/core/workspace/store-contract';
import { readFile } from 'node:fs/promises';
import type { WorkspaceV2 } from '@socialprune/core';
import {
  createWorkspace,
  readWorkspace,
} from '@socialprune/core/workspace/store';
import { createMemoryStore } from '@socialprune/core/workspace/memory-store';
import { JOURNAL_FIXTURE } from '../../../../packages/core/src/model/browser-fixture.ts';

// Each independent core contract retains its complete assertions and 30s budget.
// Bundling them under one 30s test timed out after successful checks on Windows.
for (const { name } of STORE_CONTRACT_CHECKS)
  test(`core store contract runs against real IndexedDB: ${name}`, async ({
    page,
  }) => {
    await page.goto('/socialprune/icon.svg');
    const passed = await page.evaluate(async (name) => {
      const module = (await import(
        /* @vite-ignore */ `${location.origin}/socialprune/store-contract.js`
      )) as { runBrowserStoreContract(name: string): Promise<string[]> };
      return module.runBrowserStoreContract(name);
    }, name);
    expect(passed).toEqual([name]);
  });

test('valid streaming restore preserves fixture submissions shared sequence and backup time', async ({
  page,
}) => {
  const expected = JSON.parse(
    await readFile(
      new URL(
        '../../../../fixtures/synthetic/x/current-minimal/expected.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { items: WorkspaceV2['items']; records: WorkspaceV2['imports'] };
  const fixture = createWorkspace({
    id: 'synthetic-backup-test',
    now: new Date('2026-01-01T00:00:00.000Z'),
  });
  fixture.items = expected.items;
  fixture.imports = [];
  const source = {
    kind: 'agent' as const,
    name: 'invented-backup-agent',
    version: '1',
  };
  fixture.submissions = [
    {
      submissionId: 'synthetic-submission',
      contentHash: `sha256:${'a'.repeat(64)}`,
      source,
      receivedAt: fixture.createdAt,
      labelCount: 1,
      criteria: (await import('@socialprune/core/criteria')).PRESETS.map(
        ({ id, hash }) => ({ id, hash }),
      ),
    },
  ];
  fixture.assessments = [
    {
      assessmentId: 'synthetic-assessment',
      submissionId: 'synthetic-submission',
      itemId: fixture.items[0]!.id,
      source,
      category: 'unclear',
      risk: 1,
      reason: 'Invented backup assessment.',
      evidence: null,
      confidence: null,
      createdAt: fixture.createdAt,
    },
  ];
  fixture.counts = {
    imports: fixture.imports.length,
    items: fixture.items.length,
    submissions: 1,
    assessments: 1,
    decisionEvents: 0,
    outcomeEvents: 0,
  };
  await page.goto('/socialprune/icon.svg');
  const result = (await page.evaluate(async (workspace) => {
    const module = (await import(
      /* @vite-ignore */ `${location.origin}/socialprune/store-contract.js`
    )) as { restoreFixtureWorkspace(input: WorkspaceV2): Promise<unknown> };
    return module.restoreFixtureWorkspace(workspace);
  }, fixture)) as {
    corruptRejected: boolean;
    activeUnchanged: boolean;
    restored: {
      submissions: unknown[];
      decisions: unknown[];
      outcomes: unknown[];
      meta: { lastBackupAt: string | null };
    };
  };
  expect(result.corruptRejected).toBe(true);
  expect(result.activeUnchanged).toBe(true);
  expect(result.restored.submissions).toEqual(fixture.submissions);
  expect(result.restored.decisions).toEqual(fixture.decisionEvents);
  expect(result.restored.outcomes).toEqual(fixture.outcomeEvents);
  expect(result.restored.meta.lastBackupAt).not.toBeNull();
});

test('quota failure rolls back the real transaction and versionchange closes the owned connection', async ({
  page,
}) => {
  await page.goto('/socialprune/icon.svg');
  const result = await page.evaluate(async () => {
    const module = (await import(
      /* @vite-ignore */ `${location.origin}/socialprune/store-contract.js`
    )) as {
      storageFailureControls(): Promise<{
        quotaRejected: boolean;
        rolledBack: boolean;
        lifecycle: string[];
      }>;
    };
    return module.storageFailureControls();
  });
  expect(result).toEqual({
    quotaRejected: true,
    rolledBack: true,
    lifecycle: ['versionchange'],
  });
});

for (const legacyVersion of [7, 8, 10] as const)
  test(`v${legacyVersion} to v11 real IndexedDB migration preserves ambiguous deletion receipts and context journal on reopen`, async ({
    page,
  }) => {
    const store = createMemoryStore();
    const receipts = JOURNAL_FIXTURE.attempts.map((attempt) => ({
      ...attempt,
      seq: attempt.seq + 2,
      ...(attempt.state === 'ambiguous'
        ? {
            receipt: {
              method: 'POST',
              path: '/i/api/graphql/generated/DeleteTweet',
              status: 200,
              shape: ['data', 'data.delete_tweet'],
            },
          }
        : {}),
    }));
    let current: WorkspaceV2;
    try {
      await writeInstagramContextContract(store);
      await store.write(async (tx) => {
        await tx.items.put({
          item: contractWorkspace().items[0]!,
          importId: '',
          metadataImportId: '',
        });
        await tx.browserRuns.add(JOURNAL_FIXTURE.run);
        for (const attempt of receipts) await tx.browserAttempts.add(attempt);
      });
      current = await store.read(readWorkspace);
    } finally {
      await store.close();
    }
    const legacy = structuredClone(current);
    legacy.schemaVersion = legacyVersion;
    if (legacyVersion === 7)
      for (const record of legacy.instagramContext!)
        Reflect.deleteProperty(record, 'ownerCheck');
    await page.goto('/socialprune/icon.svg');
    const result = (await page.evaluate(
      async ({ input, legacyVersion }) => {
        const module = (await import(
          /* @vite-ignore */ `${location.origin}/socialprune/store-contract.js`
        )) as {
          proveOwnerUpgrade(
            value: WorkspaceV2,
            fail: boolean,
            version: 7 | 8 | 10,
          ): Promise<unknown>;
        };
        return module.proveOwnerUpgrade(input, false, legacyVersion);
      },
      { input: legacy, legacyVersion },
    )) as {
      first: WorkspaceV2;
      second: WorkspaceV2;
      version: number;
      duplicateRejected: boolean;
      addOnly: boolean;
    };
    expect(result.version).toBe(12);
    expect(result.first).toEqual(current);
    expect(result.second).toEqual(current);
    expect(
      result.first.browserAttempts!.filter(
        (attempt) => attempt.runId === JOURNAL_FIXTURE.run.runId,
      ),
    ).toEqual(receipts);
    expect(result.duplicateRejected).toBe(true);
    expect(result.addOnly).toBe(true);
  });

for (const legacyVersion of [8, 10] as const)
  test(`v${legacyVersion} to v11 IndexedDB metadata failure rolls back the version step and retains context`, async ({
    page,
  }) => {
    const store = createMemoryStore();
    let legacy: WorkspaceV2;
    try {
      await writeInstagramContextContract(store);
      legacy = await store.read(readWorkspace);
      legacy.schemaVersion = legacyVersion;
    } finally {
      await store.close();
    }
    await page.goto('/socialprune/icon.svg');
    const result = await page.evaluate(
      async ({ input, version }) => {
        const module = (await import(
          /* @vite-ignore */ `${location.origin}/socialprune/store-contract.js`
        )) as {
          proveOwnerUpgrade(
            value: WorkspaceV2,
            fail: boolean,
            version: 8 | 10,
          ): Promise<unknown>;
        };
        return module.proveOwnerUpgrade(input, true, version);
      },
      { input: legacy, version: legacyVersion },
    );
    expect(result).toEqual({
      rejected: true,
      version: legacyVersion,
      metaVersion: legacyVersion,
      contexts: legacy.instagramContext,
    });
  });
