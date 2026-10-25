import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { restoreLiveFeed } from '../e2e/feed-fixture.ts';
import en from '../src/i18n/en.json' with { type: 'json' };
import de from '../src/i18n/de.json' with { type: 'json' };
const catalogs = { en, de };
// eslint-disable-next-line no-restricted-properties -- Explicit generated gallery path.
const folder = process.env['SP_H_SCREEN_DIR'];
if (!folder) throw Error('SP_H_SCREEN_DIR required');
for (const lang of ['de', 'en'] as const)
  for (const theme of ['light', 'dark'] as const)
    for (const width of [320, 390, 1280])
      test(`S4 web ${lang} ${theme} ${width}`, async ({ page }) => {
        test.setTimeout(120000);
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
        const shot = async (name: string) => {
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width);
          await page.screenshot({
            path: join(folder, `${name}-${lang}-${theme}-${width}.png`),
          });
        };
        for (const [state, route] of [
          ['archive', 'archive'],
          ['clicklist', 'clicklist/x'],
          ['delete', 'clicklist/x/go'],
          ['backup', 'backup'],
          ['settings', 'settings'],
          ['guide', 'guide/x'],
          ['setup', 'import'],
          ['start', ''],
        ] as const) {
          await page.goto('/socialprune/#/' + route);
          await expect(page.locator('main h1')).toBeVisible();
          if (state === 'archive')
            await expect(
              page.getByTestId('archive').locator('article').first(),
            ).toBeVisible();
          if (state === 'delete')
            await expect(page.getByTestId('delete-card')).toBeVisible();
          if (state === 'backup')
            await expect(
              page.getByRole('button', {
                name: catalogs[lang]['workspace.backup'],
                exact: true,
              }),
            ).toBeVisible();
          if (state === 'settings')
            await expect(page.getByRole('combobox').first()).toBeVisible();
          if (state === 'setup')
            await expect(page.getByTestId('archives')).toBeVisible();
          if (state === 'guide')
            await expect(page.locator('main ol').first()).toBeVisible();
          if (state === 'clicklist')
            await expect(page.locator('main input').first()).toBeVisible();
          await shot(state);
        }
        await page.goto('/socialprune/#/demo');
        await expect(page.getByRole('feed')).toBeVisible();
        await shot('demo');
      });
