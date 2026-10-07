import { test, expect } from '@playwright/test';
import { restoreReview, reviewFixture } from './review-fixture.ts';
import { observeImport } from './helpers.ts';

test('keyboard decisions freeze exactly the selected entries, while select-all uses the query path', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  const workspace = await restoreReview(page, reviewFixture('personal', false));
  const grid = page.getByRole('grid');
  await grid.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(
    page.getByText('2 entries selected', { exact: false }),
  ).toBeVisible();
  const before = await page.evaluate(() =>
    window.workspace.request({
      type: 'history',
      requestId: crypto.randomUUID(),
      limit: 50,
    }),
  );
  expect(before).toMatchObject({ type: 'historyEntries', entries: [] });
  await page.keyboard.press('m');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(
    '2 of 2 selected entries are in this view. 0 are outside it and will not change.',
  );
  await expect(
    dialog.getByRole('button', {
      name: 'Mark for deletion: 2 entries',
      exact: true,
    }),
  ).toBeEnabled();
  await dialog
    .getByRole('button', {
      name: 'Mark for deletion: 2 entries',
      exact: true,
    })
    .focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    '2 entries: Marked for deletion',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  const unselected = await page.evaluate(
    (itemId) =>
      window.workspace.request({
        type: 'detail',
        requestId: crypto.randomUUID(),
        itemId,
      }),
    workspace.items[2]!.id,
  );
  expect(unselected).toMatchObject({ type: 'itemDetail', events: [] });
  const selected = await page.evaluate(
    (itemId) =>
      window.workspace.request({
        type: 'detail',
        requestId: crypto.randomUUID(),
        itemId,
      }),
    workspace.items[0]!.id,
  );
  expect(selected).toMatchObject({
    type: 'itemDetail',
    events: [{ value: 'delete', source: { kind: 'human', via: 'web-review' } }],
  });
  expect(
    selected.type === 'itemDetail'
      ? selected.events.filter((event) => 'recordedAt' in event)
      : [],
  ).toEqual([]);
  await page
    .getByRole('button', { name: 'Select all in this view', exact: true })
    .click();
  const beforeAll = await page.evaluate(() =>
    window.workspace.request({
      type: 'history',
      requestId: crypto.randomUUID(),
      limit: 50,
    }),
  );
  expect(beforeAll).toMatchObject({
    type: 'historyEntries',
    entries: [{ size: 2, value: 'delete' }],
  });
  await page
    .getByRole('toolbar', { name: 'Selected entry decisions', exact: true })
    .getByRole('button', { name: 'Keep for the selection', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Keep: 6 entries', exact: true }),
  ).toBeEnabled();
  expect(
    await dialog
      .getByText('2 of 2 selected entries are in this view.', { exact: false })
      .count(),
  ).toBe(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await audit.assert();
});

test('selection bulk from the paged list intersects current account and filter and never crosses to another account', async ({
  page,
}) => {
  const workspace = reviewFixture('personal', false);
  workspace.items.push({
    ...workspace.items[0]!,
    id: 'x:foreign-account',
    account: { key: 'other-account', handle: 'invented_other' },
    text: 'Invented other-account entry.',
  });
  workspace.counts.items++;
  await restoreReview(page, workspace);
  await page.getByRole('button', { name: 'Paged list', exact: true }).click();
  await page
    .getByRole('checkbox', { name: 'Select entry', exact: true })
    .nth(0)
    .check();
  await page
    .getByRole('checkbox', { name: 'Select entry', exact: true })
    .nth(2)
    .check();
  await page
    .getByRole('toolbar', { name: 'Selected entry decisions', exact: true })
    .getByRole('button', { name: 'Later for the selection', exact: true })
    .click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: 'Later: 2 entries', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Later: 2 entries', exact: true })
    .click();
  const foreign = await page.evaluate(() =>
    window.workspace.request({
      type: 'detail',
      requestId: crypto.randomUUID(),
      itemId: 'x:foreign-account',
    }),
  );
  expect(foreign).toMatchObject({ type: 'itemDetail', events: [] });
});
