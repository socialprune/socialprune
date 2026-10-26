import { expect, test } from '@playwright/test';
import { restoreLiveFeed } from './feed-fixture.ts';
import { sortFixture, checkFeedSort, captureSort } from './feed-sort-check.ts';

test('SORT-1 server order, unknown counts, account/tab choices and reload', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('sp-locale', 'en'));
  await restoreLiveFeed(page, sortFixture());
  try {
    await page
      .getByRole('button', { name: 'Review options', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('menuitem', { name: 'List view', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
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
        const options = page.getByRole('button', {
          name: 'Ansichtsoptionen',
          exact: true,
        });
        if (width < 541) {
          await expect(sort).toHaveCount(0);
          await options.click();
          await page
            .getByRole('group', { name: 'Sortieren', exact: true })
            .getByRole('menuitemradio', {
              name: 'Meiste Gefällt mir',
              exact: true,
            })
            .click();
          await expect(options).toBeFocused();
        } else await sort.selectOption('likes');
        await expect(
          page.getByRole('feed').locator('article').first(),
        ).toHaveAttribute('data-card-id', 'x:feed-2');
        if (width < 541) {
          await options.click();
          await expect(
            page.getByRole('menuitemradio', {
              name: 'Meiste Gefällt mir',
              exact: true,
            }),
          ).toHaveAttribute('aria-checked', 'true');
        }
        await captureSort(page, info, `x-likes-${theme}-${width}`);
        if (width < 541) await page.keyboard.press('Escape');
        await page
          .getByRole('combobox', { name: 'Konto', exact: true })
          .selectOption('instagram:feed');
        if (width < 541) {
          await options.click();
          await expect(
            page
              .getByRole('group', { name: 'Sortieren', exact: true })
              .getByRole('menuitemradio'),
          ).toHaveText(['Neueste zuerst', 'Älteste zuerst']);
        } else {
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
        }
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

for (const lang of ['de', 'en'] as const)
  for (const width of [320, 390])
    test(`SORT-1 phone keyboard menu ${lang} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript(
        (lang) => localStorage.setItem('sp-locale', lang),
        lang,
      );
      await restoreLiveFeed(page, sortFixture());
      try {
        const account = page.getByRole('combobox', {
          name: lang === 'de' ? 'Konto' : 'Account',
          exact: true,
        });
        const options = page.getByRole('button', {
          name: lang === 'de' ? 'Ansichtsoptionen' : 'Review options',
          exact: true,
        });
        await account.focus();
        await page.keyboard.press('Tab');
        await expect(options).toBeFocused();
        await page.keyboard.press('Enter');
        const group = page.getByRole('group', {
          name: lang === 'de' ? 'Sortieren' : 'Sort',
          exact: true,
        });
        await expect(group).toBeVisible();
        await expect(group.getByRole('menuitemradio')).toHaveCount(4);
        await expect(group.getByRole('menuitemradio').first()).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(options).toBeFocused();
        await expect(
          page.getByRole('feed').locator('article').first(),
        ).toHaveAttribute('data-card-id', 'x:feed-4');
        await options.click();
        await expect(group.getByRole('menuitemradio').nth(1)).toHaveAttribute(
          'aria-checked',
          'true',
        );
        await page.keyboard.press('Escape');
        await expect(options).toBeFocused();
        await options.click();
        await page
          .getByRole('menuitem', {
            name: lang === 'de' ? 'Einzeln' : 'One at a time',
            exact: true,
          })
          .click();
        expect(
          await page
            .locator('[data-feed-toolbar]')
            .evaluate((node) => node.getBoundingClientRect().height),
        ).toBeLessThanOrEqual(60);
        await account.focus();
        await page.keyboard.press('Tab');
        await expect(
          page.getByRole('button', {
            name: lang === 'de' ? 'Nächster Beitrag' : 'Next post',
            exact: true,
          }),
        ).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(options).toBeFocused();
      } finally {
        await page.evaluate(async () => {
          await window.workspace.request({
            type: 'shutdown',
            requestId: crypto.randomUUID(),
          });
          window.workspace.dispose();
        });
        await page.goto('about:blank');
      }
    });
