import { test, expect } from '@playwright/test';
import { restoreLiveFeed } from './feed-fixture.ts';
import { headerFixture } from './header-style.ts';
import { checkFastFeed } from './fast-feed-check.ts';
import { join } from 'node:path';

test('FAST-1 instant next, rejected write recovery and leave warning', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('sp-locale', 'en'));
  await restoreLiveFeed(page, headerFixture());
  try {
    await checkFastFeed(page);
  } finally {
    await page.evaluate(async () => {
      await window.workspace.flushCommands();
      window.workspace.dispose();
    });
    await page.goto('about:blank');
  }
});
for (const theme of ['light', 'dark'] as const)
  for (const width of [1280, 390])
    test(`FAST-1 single mode ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.addInitScript((theme) => {
        localStorage.setItem('sp-locale', 'de');
        localStorage.setItem('sp-theme', theme);
      }, theme);
      await restoreLiveFeed(page, headerFixture());
      const single = page.getByRole('button', { name: 'Einzeln', exact: true });
      if (width < 541) {
        await page
          .getByRole('button', { name: 'Ansichtsoptionen', exact: true })
          .click();
        await page
          .getByRole('menuitem', { name: 'Einzeln', exact: true })
          .click();
      } else await single.click();
      try {
        for (const [platform, account] of [
          ['x', 'x:feed'],
          ['instagram', 'instagram:feed'],
        ] as const) {
          await page
            .getByRole('combobox', { name: 'Konto', exact: true })
            .selectOption(account);
          if (platform === 'instagram') {
            if (width < 541) {
              await page
                .getByRole('button', { name: 'Ansichtsoptionen', exact: true })
                .click();
              await page
                .getByRole('menuitem', { name: 'Einzeln', exact: true })
                .click();
            } else await single.click();
          }
          await expect(page.getByRole('feed').locator('article')).toHaveCount(
            1,
          );
          await expect(
            page.getByRole('feed').locator('[data-keep-action]'),
          ).toBeVisible();
          const actionGeometry = await page
            .getByRole('feed')
            .locator('[data-keep-action]')
            .evaluate((button) => {
              const rect = button.getBoundingClientRect(),
                panel = button
                  .closest('[role="tabpanel"]')!
                  .getBoundingClientRect();
              return {
                visible: rect.top >= panel.top && rect.bottom <= panel.bottom,
                height: rect.height,
              };
            });
          expect(actionGeometry.visible).toBe(true);
          expect(actionGeometry.height).toBeGreaterThanOrEqual(52);
          // eslint-disable-next-line no-restricted-properties -- Explicit generated screenshot destination, never credentials.
          const folder = process.env['SP_H_SCREEN_DIR'];
          if (folder)
            await page.screenshot({
              path: join(folder, `${platform}-${theme}-${width}.png`),
              animations: 'disabled',
            });
        }
        await page.reload();
        await expect(page.getByRole('feed').locator('article')).toHaveCount(1);
      } finally {
        await page.evaluate(async () => {
          await window.workspace.flushCommands();
          window.workspace.dispose();
        });
        await page.goto('about:blank');
      }
    });
