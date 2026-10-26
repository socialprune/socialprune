import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { headerFixture } from './header-style.ts';
import { join } from 'node:path';

export function sortFixture() {
  const data = headerFixture();
  data.settings.keepRules = [];
  const x = data.items.filter((item) => item.platform === 'x');
  const likes = [1, 30, 30, 0, null, 8, 4, 2];
  const reposts = [2, 0, 9, null, 1, 6, 3, 4];
  x.forEach((item, index) => {
    item.engagement = { likes: likes[index]!, reposts: reposts[index]! };
  });
  return data;
}

export async function checkFeedSort(
  page: Page,
  restart: () => Promise<unknown> = () => page.reload(),
) {
  const select = page.getByRole('combobox', { name: 'Sort', exact: true });
  const feed = page.getByRole('feed');
  const first = feed.locator('article[data-card-id]').first();
  await expect(select.locator('option')).toHaveText([
    'Newest first',
    'Oldest first',
    'Most likes',
    'Most reposts',
  ]);
  const kept = page.getByRole('tab', { name: /^Kept[, ]/ });
  const keptBefore = await kept.getAttribute('aria-label');
  await page.getByRole('tab', { name: /^All[, ]/ }).click();
  await expect(feed).toHaveAttribute('aria-busy', 'false');
  await select.selectOption('likes');
  await expect(first).toHaveAttribute('data-card-id', 'x:feed-2');
  await expect(kept).toHaveAttribute('aria-label', keptBefore!);
  const unknown = feed.locator('article[data-card-id="x:feed-5"]');
  await expect(unknown).toContainText('Likes: unknown');
  await select.selectOption('reposts');
  await expect(first).toHaveAttribute('data-card-id', 'x:feed-3');
  await page.getByRole('tab', { name: /^Suggested for deletion[, ]/ }).click();
  await expect(select).toHaveValue('newest');
  await select.selectOption('oldest');
  await expect(first).toHaveAttribute('data-card-id', 'x:feed-4');
  await page.getByRole('tab', { name: /^All[, ]/ }).click();
  await expect(select).toHaveValue('reposts');
  await expect(first).toHaveAttribute('data-card-id', 'x:feed-3');
  await page
    .getByRole('combobox', { name: 'Account', exact: true })
    .selectOption('instagram:feed');
  await expect(feed).toHaveAttribute('aria-busy', 'false');
  await expect(select.locator('option')).toHaveText([
    'Newest first',
    'Oldest first',
  ]);
  await select.selectOption('oldest');
  await page
    .getByRole('combobox', { name: 'Account', exact: true })
    .selectOption('x:feed');
  await expect(select).toHaveValue('oldest');
  await expect(first).toHaveAttribute('data-card-id', 'x:feed-4');
  await restart();
  await expect(select).toHaveValue('oldest');
  await expect(first).toHaveAttribute('data-card-id', 'x:feed-4');
}

export async function captureSort(page: Page, info: TestInfo, name: string) {
  // eslint-disable-next-line no-restricted-properties -- Explicit generated screenshot destination, never credentials.
  const folder = process.env['SP_H_SCREEN_DIR'];
  if (folder)
    await page.screenshot({
      path: join(folder, `${name}-${info.project.name}.png`),
      animations: 'disabled',
    });
}
