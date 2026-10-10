import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function menuLink(page: Page, name: string) {
  await page.getByRole('button', { name: /^(Menu|Menü)$/ }).click();
  return page.getByTestId('app-menu').getByRole('link', { name, exact: true });
}
export async function listView(page: Page) {
  if (await page.evaluate(() => location.hash === '#/demo')) {
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.workspace.summary?.kind))
      .toBe('demo');
  }
  await page.evaluate(() => {
    location.hash = '#/review/list';
  });
}
export async function german(page: Page) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .getByTestId('app-menu')
    .getByRole('combobox', { name: 'Language', exact: true })
    .selectOption('de');
  await page.keyboard.press('Escape');
}
