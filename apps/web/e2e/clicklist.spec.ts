import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  restoreClickLists,
  expectedXIds,
  expectedBerlinDays,
} from './clicklist-fixture.ts';
import { observeImport } from './helpers.ts';

test('X list uses risk ordering and platform hints, explicit outcomes and BOM/formula-safe downloads', async ({
  page,
  context,
}) => {
  // Exercise the real anchor download branch on engines which also expose an
  // interactive file picker. The picker branch has its own sink unit tests.
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', {
      value: undefined,
      configurable: true,
    }),
  );
  const audit = await observeImport(context, page);
  await restoreClickLists(page);
  await page.goto('/socialprune/#/clicklist/x');
  await expect(
    page.getByText(
      'You marked 4 entries. Here is where the list starts. Opening it does not delete anything.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const list = page.getByRole('list', {
    name: 'Marked entries to find on the platform',
  });
  expect(
    await list
      .locator('[data-item-id]')
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('data-item-id')),
      ),
  ).toEqual(expectedXIds);
  expect(await list.locator('[data-item-id="x:105"]').count()).toBe(0);
  await expect(list.locator('[data-item-id="x:102"]')).toContainText(
    'Undo repost',
  );
  await expect(list.locator('[data-item-id="x:103"]')).toContainText(
    'Delete post',
  );
  const link = list
    .locator('[data-item-id="x:102"]')
    .getByRole('link', { name: 'Open on X', exact: true });
  await expect(link).toHaveAttribute(
    'href',
    'https://x.com/invented_x/status/102',
  );
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await list.locator('[data-item-id="x:102"]').focus();
  await page.keyboard.press('d');
  await expect(
    page.getByText('1 deleted by you, 0 skipped, 3 left.', { exact: true }),
  ).toBeVisible();
  const after = await page.evaluate(() =>
    window.workspace.request({
      type: 'detail',
      requestId: crypto.randomUUID(),
      itemId: 'x:102',
    }),
  );
  expect(after).toMatchObject({
    type: 'itemDetail',
    events: [
      { value: 'delete' },
      {
        value: 'deleted-by-user',
        source: { kind: 'human', via: 'web-review' },
      },
    ],
  });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByText('0 deleted by you, 0 skipped, 4 left.', { exact: true }),
  ).toBeVisible();
  await list
    .locator('[data-item-id="x:102"]')
    .getByRole('button', { name: 'I did it', exact: true })
    .click();
  await expect(
    page.getByText('1 deleted by you, 0 skipped, 3 left.', { exact: true }),
  ).toBeVisible();
  await list
    .locator('[data-item-id="x:102"]')
    .getByRole('button', { name: 'Correct this record', exact: true })
    .click();
  await expect(
    page.getByText('0 deleted by you, 0 skipped, 4 left.', { exact: true }),
  ).toBeVisible();
  await list.locator('[data-item-id="x:104"]').focus();
  await page.keyboard.press('s');
  await expect(
    page.getByText('0 deleted by you, 1 skipped, 3 left.', { exact: true }),
  ).toBeVisible();
  const csvDownload = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export list as CSV', exact: true })
    .click();
  const csv = await csvDownload,
    path = await csv.path();
  if (!path) throw new Error('No download path.');
  const bytes = await readFile(path);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(bytes.toString('utf8')).toContain("'=1+1");
  expect(bytes.toString('utf8')).toContain('web-review');
  const jsonDownload = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export list as JSON', exact: true })
    .click();
  const json = await jsonDownload,
    jsonPath = await json.path();
  if (!jsonPath) throw new Error('No JSON path.');
  const parsed = JSON.parse(await readFile(jsonPath, 'utf8')) as {
    timeZone: string;
    entries: { itemId: string; via: string }[];
  };
  expect(parsed.timeZone).toBe('Europe/Berlin');
  expect(parsed.entries.map(({ itemId }) => itemId)).toEqual(expectedXIds);
  expect(parsed.entries.every(({ via }) => via === 'web-review')).toBe(true);
  await audit.assert();
});

test('Instagram day grouping uses the hand-computed Berlin DST boundary and leaves platform steps unverified', async ({
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
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const list = page.getByRole('list', {
    name: 'Marked entries to find on the platform',
  });
  for (const [id, day] of Object.entries(expectedBerlinDays)) {
    const result = await page.evaluate(async (itemId) => {
      const open = await window.workspace.request({
        type: 'clickListOpen',
        requestId: crypto.randomUUID(),
        listId: 'day-oracle-check',
        accountKey: 'instagram:invented-clicklist',
      });
      if (open.type !== 'clickListOpened') throw new Error('List missing.');
      const rows = await window.workspace.request({
        type: 'clickListWindow',
        requestId: crypto.randomUUID(),
        listId: open.listId,
        offset: 0,
        limit: 100,
      });
      return rows.type === 'clickListEntries'
        ? rows.entries.find(({ itemId: id }) => id === itemId)?.day
        : null;
    }, id);
    expect(result).toBe(day);
  }
  await expect(
    list.getByRole('heading', { name: '2026-03-29', exact: true }),
  ).toHaveCount(1);
  await expect(
    list.getByRole('heading', { name: '2026-03-28', exact: true }),
  ).toHaveCount(1);
  await expect(
    list.getByText(
      'Steps not yet verified. No platform instructions are shown until the guide has been checked.',
      { exact: true },
    ),
  ).toHaveCount(2);
  expect(await list.getByRole('link').count()).toBe(0);
  await list
    .locator('[data-item-id="instagram:104"]')
    .getByRole('button', { name: 'Skip', exact: true })
    .click();
  await expect(
    page.getByText('0 deleted by you, 1 skipped, 3 left.', { exact: true }),
  ).toBeVisible();
  await audit.assert();
});
