import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  generatedReadPost,
  liveExpected,
  liveFeedFixture,
  restoreLiveFeed,
} from '../e2e/feed-fixture.ts';

// This test-only gallery owns generated workspaces; it never enters an app build.
const folder =
  // eslint-disable-next-line no-restricted-properties -- Explicit synthetic screenshot destination.
  process.env['SP_H_SCREEN_DIR'];
if (!folder) throw new Error('SP_H_SCREEN_DIR is required.');
for (const lang of ['de', 'en'] as const)
  for (const theme of ['light', 'dark'] as const)
    for (const width of [390, 1280])
      test(`Fokus S1 gallery ${lang} ${theme} ${width}`, async ({ page }) => {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 800,
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
        await expect(page.getByRole('feed')).toHaveAttribute(
          'aria-busy',
          'false',
        );
        await page.screenshot({
          path: join(folder, `feed-${lang}-${theme}-${width}.png`),
        });
        await page.getByRole('feed').locator('article').first().focus();
        await page.keyboard.press('k');
        await expect(
          page.getByRole('feed').locator('article').first(),
        ).toHaveAttribute('data-decision', 'keep');
        await page.screenshot({
          path: join(folder, `kept-${lang}-${theme}-${width}.png`),
        });
      });

for (const lang of ['de', 'en'] as const)
  for (const theme of ['light', 'dark'] as const)
    for (const width of [390, 1280])
      test(`Fokus S1 large Instagram fixed point ${lang} ${theme} ${width}`, async ({
        page,
      }) => {
        test.skip(
          // eslint-disable-next-line no-restricted-properties -- Test-only opt-in selects generated-media gallery, never credentials.
          !process.env['SP_H_FIXED_POINTS'],
          'Separate generated-media gallery run.',
        );
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 800,
        });
        await page.addInitScript(
          ({ lang, theme }) => {
            localStorage.setItem('sp-locale', lang);
            localStorage.setItem('sp-theme', theme);
          },
          { lang, theme },
        );
        await restoreLiveFeed(page, liveFeedFixture(), undefined, [
          generatedReadPost(),
        ]);
        await page
          .getByRole('combobox', {
            name: lang === 'de' ? 'Konto' : 'Account',
            exact: true,
          })
          .selectOption(liveExpected.instagram);
        const article = page.locator(
          `[data-item-id="${liveExpected.readComment}"]`,
        );
        const post = article.getByTestId('instagram-post');
        const image = post.locator('img');
        await expect(image).toBeVisible();
        const geometry = await post.evaluate((node) => {
          const img = node.querySelector('img')!;
          return {
            width: img.getBoundingClientRect().width,
            expected: Math.min(node.clientWidth, 470),
            image: img.getBoundingClientRect().bottom,
            caption: node
              .querySelector('[data-instagram-caption]')!
              .getBoundingClientRect().top,
          };
        });
        expect(geometry.width).toBe(geometry.expected);
        expect(geometry.width).toBeGreaterThan(width === 390 ? 300 : 460);
        expect(geometry.image).toBeLessThanOrEqual(geometry.caption);
        await article.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: join(folder, `instagram-${lang}-${theme}-${width}.png`),
        });
      });
