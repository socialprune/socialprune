import { expect, test } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory =
  // eslint-disable-next-line no-restricted-properties -- Test-only output directory explicitly chosen by the operator, never a credential.
  process.env['SP_FEED_DESIGN_DIR'] ??
  join(tmpdir(), 'socialprune-feed-design');
const folder = join(directory, 'screens');

test('capture current connected feed, All and archive from the generated demo', async ({
  page,
}) => {
  page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('CONSOLE', message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('sp-locale', 'de');
    localStorage.setItem('sp-theme', 'light');
  });
  await page.goto('/socialprune/#/demo');
  await expect(
    page.getByTestId('review-card').locator('article').first(),
  ).toBeVisible();
  await page.screenshot({
    path: `${folder}/current-feed-de-light-1280.png`,
  });
  await page.getByRole('tab', { name: /^Alle,/ }).click();
  await expect(page.getByTestId('feed-card').first()).toBeVisible();
  await page.screenshot({ path: `${folder}/current-all-de-light-1280.png` });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({ path: `${folder}/current-all-de-light-320.png` });
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto('/socialprune/#/archive');
  await expect(page.getByTestId('recap')).toBeVisible();
  await expect(page.locator('article').first()).toBeVisible();
  await page.screenshot({
    path: `${folder}/current-archive-de-light-1280.png`,
  });
});
