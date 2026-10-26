import { expect, test } from 'vitest';
import { createServer } from 'vite';
// eslint-disable-next-line no-restricted-imports -- Explicit generated-data browser migration test, never imported by the application.
import { chromium } from '@playwright/test';
import type { WorkspaceV2 } from '@socialprune/core';
import { createMemoryStore } from '@socialprune/core/workspace/memory-store';
import {
  instagramContractItem,
  writeInstagramContextContract,
} from '@socialprune/core/workspace/store-contract';
import { readWorkspace } from '@socialprune/core/workspace/store';
import { fileURLToPath } from 'node:url';

test.each([false, true])(
  'C29 IndexedDB v7 migration failure=%s rewrites both kinds atomically and retains add-only records',
  async (fail) => {
    const store = createMemoryStore();
    await writeInstagramContextContract(store);
    const current = await store.read(readWorkspace);
    await store.close();
    const first = current.instagramContext![0]!;
    const second = {
      ...structuredClone(first),
      itemId: first.itemId + '-list',
      attemptId: first.attemptId + '-list',
      confirmedBy: 'list' as const,
      comment: { id: null, createdAt: null, expandClicks: 0 },
    };
    current.items.push({ ...instagramContractItem(), id: second.itemId });
    current.counts.items++;
    current.instagramContext!.push(second);
    current.counts.instagramContext!++;
    const [send, settled] = current.browserAttempts!;
    current.browserAttempts!.push(
      { ...send!, seq: 3, attemptId: second.attemptId, itemId: second.itemId },
      {
        ...settled!,
        seq: 4,
        attemptId: settled!.attemptId + '-list',
        settles: second.attemptId,
        itemId: second.itemId,
      },
    );
    current.counts.browserAttempts! += 2;
    const legacy = structuredClone(current);
    legacy.schemaVersion = 7;
    for (const record of legacy.instagramContext!)
      Reflect.deleteProperty(record, 'ownerCheck');
    if (fail) legacy.instagramContext![1]!.post.code = 'invalid/code';
    const server = await createServer({
      configFile: false,
      root: fileURLToPath(new URL('../../', import.meta.url)),
      server: { host: '127.0.0.1', port: 0 },
      appType: 'mpa',
      optimizeDeps: { noDiscovery: true },
    });
    let browser;
    try {
      await server.listen();
      const address = server.httpServer!.address();
      if (!address || typeof address === 'string')
        throw new Error('Test server address missing');
      const origin = `http://127.0.0.1:${address.port}`;
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.route(`${origin}/proof`, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>Generated migration proof</title>',
        }),
      );
      await page.goto(`${origin}/proof`);
      await page.addScriptTag({
        type: 'module',
        content:
          "import { proveOwnerUpgrade } from '/src/workspace/instagram-owner-migration.browser.ts'; globalThis.c29OwnerProof = proveOwnerUpgrade;",
      });
      await page.waitForFunction(() => 'c29OwnerProof' in globalThis);
      const result = await page.evaluate(
        async ({ legacy, fail }) => {
          const module = globalThis as unknown as {
            c29OwnerProof(value: WorkspaceV2, fail: boolean): Promise<unknown>;
          };
          return module.c29OwnerProof(legacy, fail);
        },
        { legacy, fail },
      );
      if (fail)
        expect(result).toEqual({
          rejected: true,
          version: 7,
          metaVersion: 7,
          contexts: legacy.instagramContext,
        });
      else
        expect(result).toEqual({
          first: current,
          second: current,
          version: 11,
          duplicateRejected: true,
          addOnly: true,
        });
    } finally {
      await browser?.close();
      await server.close();
    }
  },
  60_000,
);
