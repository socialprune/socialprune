import { expect, test } from 'vitest';
import { createServer } from 'vite';
// eslint-disable-next-line no-restricted-imports -- Generated migration proof, never an application import.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createMemoryStore } from '@socialprune/core/workspace/memory-store';
import { writeInstagramContextContract } from '@socialprune/core/workspace/store-contract';
import { readWorkspace } from '@socialprune/core/workspace/store';
import type { WorkspaceV2 } from '@socialprune/core';

test.each([false, true])(
  'D10 IndexedDB version 9 to 10 failure=%s retains records and write-once evidence',
  async (fail) => {
    const store = createMemoryStore();
    await writeInstagramContextContract(store);
    const current = await store.read(readWorkspace);
    await store.close();
    const legacy = { ...structuredClone(current), schemaVersion: 9 };
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
        throw new Error('Missing generated server');
      const origin = `http://127.0.0.1:${address.port}`;
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.route(`${origin}/proof`, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>Generated migration</title>',
        }),
      );
      await page.goto(`${origin}/proof`);
      await page.addScriptTag({
        type: 'module',
        content:
          "import { proveOwnerUpgrade } from '/src/workspace/instagram-owner-migration.browser.ts'; globalThis.d10Upgrade = proveOwnerUpgrade;",
      });
      await page.waitForFunction(() => 'd10Upgrade' in globalThis);
      const result = await page.evaluate(
        async ({ legacy, fail }) =>
          (
            globalThis as unknown as {
              d10Upgrade(
                value: WorkspaceV2,
                fail: boolean,
                version: 9,
              ): Promise<unknown>;
            }
          ).d10Upgrade(legacy, fail, 9),
        { legacy, fail },
      );
      expect(result).toEqual(
        fail
          ? {
              rejected: true,
              version: 9,
              metaVersion: 9,
              contexts: legacy.instagramContext,
            }
          : {
              first: current,
              second: current,
              version: 10,
              duplicateRejected: true,
              addOnly: true,
            },
      );
    } finally {
      await browser?.close();
      await server.close();
    }
  },
  60000,
);
