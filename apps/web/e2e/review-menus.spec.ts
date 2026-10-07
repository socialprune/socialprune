import { test, expect } from '@playwright/test';
import { restoreReview, reviewFixture } from './review-fixture.ts';
import { observeImport } from './helpers.ts';

test('keyboard context menu uses Base UI focus controls and closes before a real decision', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  await restoreReview(page, reviewFixture('personal', false));
  const grid = page.getByRole('grid');
  await grid.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Keep', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(
    page.getByText('1 decision saved. Nothing was deleted on the platform.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('row').first()).toContainText('Keep');
  const second = page.getByRole('row').nth(1);
  await second.click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Later', exact: true }).click();
  await expect(second).toContainText('Later');
  await expect(page.getByRole('row').first()).toContainText('Keep');
  await audit.assert();
});
