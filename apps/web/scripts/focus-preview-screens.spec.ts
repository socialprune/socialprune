import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { restoreLiveFeed } from '../e2e/feed-fixture.ts';

// eslint-disable-next-line no-restricted-properties -- Explicit generated capture destination, never credentials.
const folder = process.env['SP_H_SCREEN_DIR'];
if (!folder) throw Error('SP_H_SCREEN_DIR required');

for (const lang of ['de', 'en'])
  for (const theme of ['light', 'dark'] as const)
    for (const width of [320, 390, 1280])
      test(`S2b preview ${lang} ${theme} ${width}`, async ({ page }) => {
        await page.setViewportSize({
          width,
          height: width === 1280 ? 800 : 844,
        });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: 'reduce',
        });
        await page.addInitScript(
          ({ lang, theme }) => {
            localStorage.setItem('sp-locale', lang);
            localStorage.setItem('sp-theme', theme);
          },
          { lang, theme },
        );
        await restoreLiveFeed(page);
        await page.locator('footer button').click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('heading')).toContainText(
          lang === 'de' ? '3 Einträge' : '3 entries',
        );
        await expect(dialog.getByRole('heading')).toBeFocused();
        const boxes = await dialog.evaluate((node) => {
          const heading = node.querySelector('h2')!.getBoundingClientRect();
          const popup = node.getBoundingClientRect();
          return {
            top: heading.top,
            bottom: heading.bottom,
            popupTop: popup.top,
            popupBottom: popup.bottom,
          };
        });
        expect(boxes.top).toBeGreaterThanOrEqual(boxes.popupTop);
        expect(boxes.bottom).toBeLessThanOrEqual(boxes.popupBottom);
        await page.screenshot({
          path: join(folder, `preview-${lang}-${theme}-${width}.png`),
        });
      });
