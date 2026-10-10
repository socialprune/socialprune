import { expect, test } from '@playwright/test';
import { restoreReview, reviewFixture } from './review-fixture.ts';
import { observeImport } from './helpers.ts';
import { menuLink, listView } from './navigation.ts';

test('D58 personal and demo views persist independently and mounting never writes a view', async ({
  page,
  context,
}) => {
  // D40: 5.7 s in the full Windows run on 2026-10-08; 60 s floor.
  test.setTimeout(60_000);
  const audit = await observeImport(context, page);
  const input = reviewFixture('personal', false, 6);
  await restoreReview(page, input, '');
  expect(
    await page.evaluate(() => window.workspace.summary?.review),
  ).toBeUndefined();
  const status = () =>
    page.getByRole('combobox', { name: 'Decision filter', exact: true });
  await status().selectOption('later');
  await expect
    .poll(() =>
      page.evaluate(() => window.workspace.summary?.review?.filter.decisions),
    )
    .toEqual(['later']);
  const personal = await page.evaluate(() => window.workspace.summary?.review);
  await (await menuLink(page, 'Try the demo')).click();
  await listView(page);
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.workspace.summary?.kind))
    .toBe('demo');
  await expect(page.getByRole('grid')).toBeVisible();
  expect(
    await page.evaluate(() => window.workspace.summary?.review),
  ).toBeUndefined();
  await status().selectOption('keep');
  await expect
    .poll(() =>
      page.evaluate(() => window.workspace.summary?.review?.filter.decisions),
    )
    .toEqual(['keep']);
  const demo = await page.evaluate(() => window.workspace.summary?.review);
  await page.goto('/socialprune/#/import');
  await expect
    .poll(() => page.evaluate(() => window.workspace.summary?.workspaceId))
    .toBe(input.id);
  await page.getByRole('link', { name: 'Review', exact: true }).click();
  await listView(page);
  await expect(status()).toHaveValue('later');
  expect(await page.evaluate(() => window.workspace.summary?.review)).toEqual(
    personal,
  );
  await (await menuLink(page, 'Try the demo')).click();
  await listView(page);
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.workspace.summary?.kind))
    .toBe('demo');
  await expect(status()).toHaveValue('keep');
  expect(await page.evaluate(() => window.workspace.summary?.review)).toEqual(
    demo,
  );
  await audit.assert();
});
