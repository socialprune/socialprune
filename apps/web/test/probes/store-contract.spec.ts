import { test, expect } from '@playwright/test';
import { STORE_CONTRACT_CHECKS } from '@socialprune/core/workspace/store-contract';
import { readFile } from 'node:fs/promises';
import type { WorkspaceV2 } from '@socialprune/core';
import { createWorkspace } from '@socialprune/core/workspace/store';

test('core store contract runs against real IndexedDB in a browser page', async ({
  page,
}) => {
  await page.goto('/socialprune/icon.svg');
  const passed = await page.evaluate(async () => {
    const module = (await import(
      /* @vite-ignore */ `${location.origin}/socialprune/store-contract.js`
    )) as { runBrowserStoreContract(): Promise<string[]> };
    return module.runBrowserStoreContract();
  });
  expect(passed).toEqual(STORE_CONTRACT_CHECKS.map(({ name }) => name));
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
