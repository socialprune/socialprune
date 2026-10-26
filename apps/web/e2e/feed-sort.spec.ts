import { expect, test } from '@playwright/test';
import { restoreLiveFeed } from './feed-fixture.ts';
import { sortFixture, checkFeedSort, captureSort } from './feed-sort-check.ts';

test('SORT-1 server order, unknown counts, account/tab choices and reload', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('sp-locale', 'en'));
  await restoreLiveFeed(page, sortFixture());
  try {
    await checkFeedSort(page);
  } finally {
    await page.evaluate(() =>
      window.workspace.request({
        type: 'shutdown',
        requestId: crypto.randomUUID(),
      }),
    );
    await page.evaluate(() => window.workspace.dispose());
    await page.goto('about:blank');
  }
});

for (const theme of ['light', 'dark'] as const)
  for (const width of [1280, 390])
    test(`SORT-1 visible choices ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.addInitScript((theme) => {
        localStorage.setItem('sp-locale', 'de');
        localStorage.setItem('sp-theme', theme);
      }, theme);
      await restoreLiveFeed(page, sortFixture());
      try {
        const sort = page.getByRole('combobox', {
          name: 'Sortieren',
          exact: true,
        });
        await sort.selectOption('likes');
        await expect(
          page.getByRole('feed').locator('article').first(),
        ).toHaveAttribute('data-card-id', 'x:feed-2');
        await captureSort(page, info, `x-likes-${theme}-${width}`);
        await page
          .getByRole('combobox', { name: 'Konto', exact: true })
          .selectOption('instagram:feed');
        await expect(sort.locator('option')).toHaveText([
          'Neueste zuerst',
          'Älteste zuerst',
        ]);
        const optionColors = await sort
          .locator('option')
          .evaluateAll((options) =>
            options.map((option) => ({
              color: getComputedStyle(option).color,
              background: getComputedStyle(option).backgroundColor,
            })),
          );
        expect(
          optionColors.every(
            (option) =>
              option.background !== 'rgba(0, 0, 0, 0)' &&
              option.color !== option.background,
          ),
        ).toBe(true);
        await sort.click();
        await captureSort(page, info, `instagram-dates-${theme}-${width}`);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('feed')).toHaveAttribute(
          'aria-busy',
          'false',
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      } finally {
        await page.evaluate(() =>
          window.workspace.request({
            type: 'shutdown',
            requestId: crypto.randomUUID(),
          }),
        );
        await page.evaluate(() => window.workspace.dispose());
        await page.goto('about:blank');
      }
    });
