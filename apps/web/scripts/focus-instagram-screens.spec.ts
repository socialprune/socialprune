import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { liveExpected, restoreLiveFeed } from '../e2e/feed-fixture.ts';
import {
  focusInstagramFixture,
  instagramStates,
} from '../e2e/focus-instagram-fixture.ts';

// eslint-disable-next-line no-restricted-properties -- Explicit generated gallery output, no credentials.
const folder = process.env['SP_H_SCREEN_DIR'];
const states =
  // eslint-disable-next-line no-restricted-properties -- S3b leaves the unaffected missing-post images intact.
  process.env['SP_H_SKIP_MISSING_POST'] === 'true'
    ? instagramStates.filter((state) => state !== 'missing-post')
    : instagramStates;
if (!folder) throw Error('SP_H_SCREEN_DIR required');
for (const lang of ['de', 'en'])
  for (const theme of ['light', 'dark'] as const)
    for (const width of [320, 390, 1280])
      test(`S3 Instagram gallery ${lang} ${theme} ${width}`, async ({
        page,
      }) => {
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
        for (const state of states) {
          const { data, records } = focusInstagramFixture(state);
          await restoreLiveFeed(page, data, undefined, records);
          await page
            .getByRole('combobox', {
              name: lang === 'de' ? 'Konto' : 'Account',
              exact: true,
            })
            .selectOption(liveExpected.instagram);
          const article = page.getByRole('feed').locator('article').first();
          await expect(article).toContainText('Invented comment about the');
          if (records.length) {
            const image = article
              .getByTestId('instagram-post')
              .locator('img')
              .first();
            await expect(image).toBeVisible();
            await expect
              .poll(() =>
                image.evaluate(
                  (node) => (node as HTMLImageElement).naturalWidth,
                ),
              )
              .toBeGreaterThan(0);
          } else {
            await expect(article.getByTestId('instagram-post')).toHaveCount(0);
            await expect(article).toContainText(
              lang === 'de'
                ? 'Instagram liefert den Beitrag nicht mit.'
                : 'Instagram does not include the post.',
            );
          }
          await page.getByRole('tabpanel').evaluate((node) => {
            node.scrollTop = 0;
          });
          await page.screenshot({
            path: join(folder, `${state}-${lang}-${theme}-${width}.png`),
          });
          if (state === 'post') {
            await article
              .locator('[data-instagram-comment] > [class*="comment"] p')
              .first()
              .evaluate(async (node) => {
                const panel = node.closest('[role="tabpanel"]')!;
                panel.scrollTop +=
                  node.getBoundingClientRect().top -
                  panel.getBoundingClientRect().top -
                  12;
                await new Promise<void>((resolve) =>
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve()),
                  ),
                );
              });
            await page.screenshot({
              path: join(folder, `decisions-${lang}-${theme}-${width}.png`),
            });
          }
        }
      });
