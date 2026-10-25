// Explicit test entrypoint. Uses only bundled headless Chromium and generated data.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyReviewFixture } from '../../../../../packages/core/src/criteria/test-fixture.ts';
import { migrateReviewContract } from '@socialprune/core/criteria';
import {
  createWorkspace,
  readWorkspace,
} from '@socialprune/core/workspace/store';
import {
  createBackup,
  restoreBackup,
} from '@socialprune/core/workspace/backup';
import { SQLiteStore } from '../sqlite-store.ts';
import type { WorkspaceV2 } from '@socialprune/core';
import type { Workspace as WorkspaceV1 } from '@socialprune/core/model/v1';

interface BrowserProof {
  proveV6Upgrade(value: WorkspaceV2): Promise<{
    first: WorkspaceV2;
    second: WorkspaceV2;
    physical: { version: number; plans: boolean };
    contextDuplicateRejected: boolean;
  }>;
  browserRoundTrip(
    value: string,
  ): Promise<{ workspace: WorkspaceV2; output: string }>;
}
const chunks = (text: string) =>
  (async function* () {
    await Promise.resolve();
    yield text;
  })();

export async function runBrowserMigrationProof(origin: string | undefined) {
  assert(
    origin && /^http:\/\/127\.0\.0\.1:47(?:7[1-9]|8[0-9]|90)$/.test(origin),
    'Use an assigned lane-K port',
  );
  const { bundledTestBrowser } = await import('./review-browser-launch.ts');
  const browser = await bundledTestBrowser(chromium);
  const directory = await mkdtemp(
    join(tmpdir(), 'socialprune-review-browser-'),
  );
  const page = await browser.newPage();
  try {
    await page.route(`${origin}/socialprune/proof`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Generated migration proof</title>',
      }),
    );
    await page.goto(`${origin}/socialprune/proof`);
    const legacy = await legacyReviewFixture();
    const result = await page.evaluate(async (value) => {
      const url = '/socialprune/src/workspace/review-migration.browser.ts';
      const module = (await import(url)) as BrowserProof;
      return module.proveV6Upgrade(value);
    }, legacy);
    assert.deepEqual(result.first, {
      ...migrateReviewContract(legacy),
      schemaVersion: 10,
    });
    assert.deepEqual(result.second, result.first);
    assert.deepEqual(result.physical, { version: 10, plans: true });
    assert.equal(result.contextDuplicateRejected, true);
    console.log(
      'PASS IndexedDB v6 to v10: post/list context, add-only context, reviewPlans, idempotent reopen',
    );
    const cli = await SQLiteStore.open(join(directory, 'source.sqlite'), {
      initial: migrateReviewContract(legacy),
    });
    let text = '';
    for await (const chunk of createBackup(cli, {
      now: new Date('2026-10-21T00:00:00.000Z'),
    }).chunks)
      text += new TextDecoder().decode(chunk);
    await cli.close();
    const roundTrip = async (text: string) =>
      page.evaluate(async (value) => {
        const url = '/socialprune/src/workspace/review-migration.browser.ts';
        const module = (await import(url)) as BrowserProof;
        return module.browserRoundTrip(value);
      }, text);
    const browserCopy = await roundTrip(text);
    const restored = await SQLiteStore.open(join(directory, 'target.sqlite'), {
      initial: createWorkspace(),
    });
    try {
      await restoreBackup(restored, chunks(browserCopy.output));
      assert.deepEqual(
        await restored.read(readWorkspace),
        browserCopy.workspace,
      );
    } finally {
      await restored.close();
    }
    console.log(
      'PASS v10 backup SQLite -> Chromium IndexedDB -> SQLite retains context, hashes, selections and journal',
    );
    const v1 = JSON.parse(
      await readFile(
        new URL(
          '../../../../../fixtures/synthetic/workspace/v1.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as WorkspaceV1;
    const v2 = JSON.parse(
      await readFile(
        new URL(
          '../../../../../fixtures/synthetic/workspace/backup-v2.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as WorkspaceV2;
    for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const document =
        version === 1
          ? v1
          : version >= 5
            ? structuredClone(
                version >= 7 ? migrateReviewContract(legacy) : legacy,
              )
            : {
                ...v2,
                schemaVersion: version,
                ...(version >= 3
                  ? {
                      browserRuns: [],
                      browserAttempts: [],
                      counts: {
                        ...v2.counts,
                        browserRuns: 0,
                        browserAttempts: 0,
                      },
                    }
                  : {}),
              };
      document.schemaVersion = version;
      if (version >= 5 && version < 8)
        for (const value of (document as WorkspaceV2).instagramContext ?? [])
          Reflect.deleteProperty(value, 'ownerCheck');
      if (version === 5) {
        const old = document as WorkspaceV2;
        old.instagramContext = old.instagramContext!.filter(
          (value) => value.confirmedBy === 'post',
        );
        document.items = document.items.filter(
          (value: { id: string }) => !value.id.endsWith('-list'),
        );
        old.browserAttempts = old.browserAttempts!.slice(0, 2);
        old.counts = {
          ...old.counts,
          items: document.items.length,
          instagramContext: 1,
          browserAttempts: 2,
        };
        for (const value of old.instagramContext)
          Reflect.deleteProperty(value, 'confirmedBy');
      }
      const copy = await roundTrip(JSON.stringify(document));
      assert.equal(copy.workspace.schemaVersion, 10);
      assert.equal(copy.workspace.items.length, document.items.length);
      const sqlite = await SQLiteStore.open(
        join(directory, `v${version}.sqlite`),
        { initial: createWorkspace() },
      );
      try {
        await restoreBackup(sqlite, chunks(JSON.stringify(document)));
        assert.deepEqual(
          (await sqlite.read(readWorkspace)).items,
          copy.workspace.items,
        );
      } finally {
        await sqlite.close();
      }
      console.log(
        `PASS backup v${version} restores into schema 9 in SQLite and Chromium IndexedDB`,
      );
    }
  } finally {
    await page.close();
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
}
await runBrowserMigrationProof(process.argv[2]);
