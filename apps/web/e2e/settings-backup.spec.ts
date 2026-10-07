import { test, expect } from '@playwright/test';
import { observeImport, workspaceIds } from './helpers.ts';
import {
  restoreClickLists,
  expectedUtcDays,
  clickListFixture,
} from './clicklist-fixture.ts';

test('time zone changes regroup hand-computed days and clearing the setting uses the browser zone', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  await restoreClickLists(page);
  await page.goto('/socialprune/#/clicklist/instagram');
  await expect(
    page.getByText('Days in Europe/Berlin, from your workspace setting.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page
    .getByRole('searchbox', { name: 'Search time zones', exact: true })
    .fill('UTC');
  await page
    .getByRole('combobox', { name: 'Time zone', exact: true })
    .selectOption('UTC');
  await page
    .getByRole('button', { name: 'Use this time zone', exact: true })
    .click();
  await expect(
    page.getByText('Days in UTC, from your workspace setting.', {
      exact: true,
    }),
  ).toBeVisible();
  const actual = await page.evaluate(async () => {
    const open = await window.workspace.request({
      type: 'clickListOpen',
      requestId: crypto.randomUUID(),
      listId: 'timezone-window',
      accountKey: 'instagram:invented-clicklist',
      systemTimeZone: 'UTC',
    });
    if (open.type !== 'clickListOpened') throw new Error('Click list missing.');
    const rows = await window.workspace.request({
      type: 'clickListWindow',
      requestId: crypto.randomUUID(),
      listId: open.listId,
      offset: 0,
      limit: 100,
    });
    return rows.type === 'clickListEntries'
      ? Object.fromEntries(rows.entries.map(({ itemId, day }) => [itemId, day]))
      : null;
  });
  expect(actual).toEqual(expectedUtcDays);
  await page.goto('/socialprune/#/settings');
  await expect(
    page.getByRole('button', {
      name: "Use my browser's time zone",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: "Use my browser's time zone", exact: true })
    .click();
  await expect(
    page.getByText(
      'The time zone was saved. Day groups and date filters now use it.',
      { exact: true },
    ),
  ).toBeVisible();
  const zone = await page.evaluate(async () => {
    const opened = await window.workspace.open();
    return opened.type === 'opened' ? opened.summary.timeZone : 'unexpected';
  });
  expect(zone).toBeNull();
  await audit.assert();
});

test('settings persistence requires a click and deleting the wrong workspace is refused before backup-offered removal', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    Reflect.set(globalThis, '__persistCalls', 0);
    Object.defineProperty(
      Object.getPrototypeOf(navigator.storage) as object,
      'persist',
      {
        value: () => {
          Reflect.set(
            globalThis,
            '__persistCalls',
            (Reflect.get(globalThis, '__persistCalls') as number) + 1,
          );
          return Promise.resolve(false);
        },
        configurable: true,
      },
    );
  });
  const audit = await observeImport(context, page);
  const fixture = await restoreClickLists(page);
  await page.goto('/socialprune/#/settings');
  await expect(
    page.getByText('Browser storage', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => Reflect.get(globalThis, '__persistCalls') as number,
    ),
  ).toBe(0);
  await page
    .getByRole('button', {
      name: 'Keep data when storage runs low',
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      'The browser did not grant persistent storage. You can continue; keep a downloaded backup.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => Reflect.get(globalThis, '__persistCalls') as number,
    ),
  ).toBe(1);
  await page
    .getByRole('combobox', { name: 'List density', exact: true })
    .selectOption('compact');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await page
    .getByRole('combobox', { name: 'Single-key shortcuts', exact: true })
    .selectOption('off');
  const refused = await page.evaluate(() =>
    window.workspace.request({
      type: 'deleteWorkspace',
      requestId: 'wrong-workspace-delete',
      workspaceId: 'not-the-open-workspace',
    }),
  );
  expect(refused).toEqual({
    type: 'failed',
    requestId: 'wrong-workspace-delete',
    code: 'INVALID_REQUEST',
  });
  expect(await workspaceIds(page)).toEqual(
    fixture.items.map(({ id }) => id).sort(),
  );
  await page
    .getByRole('button', {
      name: 'Delete this review from this browser',
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: 'Download a backup first', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  expect(await workspaceIds(page)).toEqual(
    fixture.items.map(({ id }) => id).sort(),
  );
  await page
    .getByRole('button', {
      name: 'Delete this review from this browser',
      exact: true,
    })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete this browser review', exact: true })
    .click();
  await expect(page).toHaveURL(/#\/$/);
  expect(await page.evaluate(() => window.workspace.summary)).toBeNull();
  const registry = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const open = indexedDB.open('sp-registry');
      open.onsuccess = () => resolve(open.result);
    });
    const pointer = await new Promise<unknown>((resolve) => {
      const request = db
        .transaction('pointers')
        .objectStore('pointers')
        .get('active');
      request.onsuccess = () => resolve(request.result as unknown);
    });
    db.close();
    return pointer;
  });
  expect(registry).toBeUndefined();
  await audit.assert();
});

test('backup screen previews a real restore and refuses corrupt input without replacing the current workspace', async ({
  page,
  context,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', {
      value: undefined,
      configurable: true,
    }),
  );
  const audit = await observeImport(context, page);
  const fixture = await restoreClickLists(page);
  await page.goto('/socialprune/#/backup');
  await expect(
    page.getByText(
      'This file contains your entries and decisions. Keep it somewhere only you can access.',
      { exact: true },
    ),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Download backup', exact: true })
    .click();
  await download;
  await expect(
    page.getByText('The backup file was saved.', { exact: true }),
  ).toBeVisible();
  const input = page.getByLabel('SocialPrune backup file', { exact: true });
  await input.setInputFiles({
    name: 'invented-corrupt.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":'),
  });
  await expect(page.getByRole('alert')).toContainText(
    'The backup could not be read or saved. Your current review has not been replaced.',
  );
  expect(await workspaceIds(page)).toEqual(
    fixture.items.map(({ id }) => id).sort(),
  );
  const replacement = clickListFixture();
  replacement.items = replacement.items.slice(0, 1);
  replacement.decisionEvents = replacement.decisionEvents.slice(0, 1);
  replacement.assessments = [];
  replacement.counts = {
    ...replacement.counts,
    items: 1,
    decisionEvents: 1,
    assessments: 0,
  };
  await input.setInputFiles({
    name: 'invented-valid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(replacement)),
  });
  await expect(
    page.getByRole('heading', { name: 'Restore preview', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      '1 entry, 1 decision, 0 outcome records, 0 suggestions, 1 account.',
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Restore this backup', exact: true })
    .click();
  await expect(
    page.getByText(
      'The backup was restored. This browser now uses that review.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(await workspaceIds(page)).toEqual(['x:101']);
  await audit.assert();
});

test('persist allowed and picker backup-first save are both explicit user actions', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Reflect.set(globalThis, '__pickerFiles', []);
    Object.defineProperty(
      Object.getPrototypeOf(navigator.storage) as object,
      'persist',
      { value: () => Promise.resolve(true), configurable: true },
    );
    Object.defineProperty(window, 'showSaveFilePicker', {
      value: (options: { suggestedName: string }) =>
        Promise.resolve({
          createWritable: () =>
            Promise.resolve(
              new WritableStream<Uint8Array>({
                write(chunk) {
                  (
                    Reflect.get(globalThis, '__pickerFiles') as {
                      name: string;
                      bytes: number;
                    }[]
                  ).push({
                    name: options.suggestedName,
                    bytes: chunk.byteLength,
                  });
                },
              }),
            ),
        }),
      configurable: true,
    });
  });
  const fixture = await restoreClickLists(page);
  await page.goto('/socialprune/#/settings');
  await page
    .getByRole('button', {
      name: 'Keep data when storage runs low',
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      'The browser granted persistent storage. Keep a backup as well.',
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Delete this review from this browser',
      exact: true,
    })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Download a backup first', exact: true })
    .click();
  await expect(
    page
      .getByRole('dialog')
      .getByText('The backup file was saved.', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (Reflect.get(globalThis, '__pickerFiles') as { bytes: number }[]).reduce(
        (count, chunk) => count + chunk.bytes,
        0,
      ),
    ),
  ).toBeGreaterThan(1000);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  const opened = await page.evaluate(() => window.workspace.open());
  expect(opened).toMatchObject({
    type: 'opened',
    summary: { counts: { items: fixture.items.length } },
  });
});
