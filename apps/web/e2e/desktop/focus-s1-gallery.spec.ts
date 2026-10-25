import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { fakeBridge } from './fake-bridge.ts';

const folder =
  // eslint-disable-next-line no-restricted-properties -- Explicit generated-data gallery destination.
  process.env['SP_H_SCREEN_DIR'];
for (const lang of ['de', 'en'])
  for (const theme of ['light', 'dark'] as const)
    for (const width of [390, 1280])
      test(`S1 preserves desktop update label ${lang} ${theme} ${width}`, async ({
        page,
      }) => {
        test.skip(!folder, 'Gallery output is opt-in.');
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 800,
        });
        await page.emulateMedia({ colorScheme: theme });
        const bridge = await fakeBridge(page, lang, undefined, 'direct');
        try {
          await page.goto('/desktop.html');
          await page
            .getByRole('button', {
              name: lang === 'de' ? 'Daten und Backups' : 'Data and backups',
              exact: true,
            })
            .click();
          const control = page.getByRole('button', {
            name: lang === 'de' ? 'Nach Updates suchen' : 'Check for updates',
            exact: true,
          });
          await expect(control).toBeVisible();
          await control.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: join(folder!, `settings-${lang}-${theme}-${width}.png`),
          });
          expect(
            bridge.requests.filter((request) => request.type === 'openLink'),
          ).toEqual([]);
        } finally {
          await bridge.close();
        }
      });
