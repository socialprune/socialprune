import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  restoreLiveFeed,
  liveFeedFixture,
  liveExpected,
  generatedReadPost,
} from '../e2e/feed-fixture.ts';
import { checkAccessibility } from '../e2e/accessibility.ts';
import { readFile } from 'node:fs/promises';

const folder =
  // eslint-disable-next-line no-restricted-properties -- Operator-selected synthetic screenshot directory, never a credential.
  process.env['SP_FEED_SCREEN_DIR'] ??
  join(tmpdir(), 'socialprune-feed-w3b', 'prototype');
const tabs = ['suggested', 'held', 'kept', 'unclear', 'marked', 'all'] as const;
for (const lang of ['de', 'en'] as const)
  for (const theme of ['light', 'dark'] as const)
    for (const width of [320, 390, 1280]) {
      test(`connected feed ${lang} ${theme} ${width}: both accounts, all tabs and human plan`, async ({
        page,
        context,
      }) => {
        await page.setViewportSize({
          width,
          height: width === 320 ? 844 : 800,
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
        const messages = JSON.parse(
          await readFile(
            new URL(`../src/i18n/${lang}.json`, import.meta.url),
            'utf8',
          ),
        ) as Record<string, string>;
        await page.goto('/socialprune/');
        await restoreLiveFeed(page, liveFeedFixture(), undefined, [
          generatedReadPost(),
        ]);
        for (const [platform, account] of [
          ['x', liveExpected.account],
          ['instagram', liveExpected.instagram],
        ] as const) {
          await page
            .getByRole('combobox', {
              name: messages['review.account'],
              exact: true,
            })
            .selectOption(account);
          for (const tab of tabs) {
            const label = messages[`reviewFeed.tab.${tab}`];
            await page
              .getByRole('tab', { name: new RegExp(`^${label},`) })
              .click();
            await expect(page.getByRole('feed')).toHaveAttribute(
              'aria-busy',
              'false',
            );
            if (platform === 'instagram' && tab === 'suggested') {
              await expect(page.getByTestId('instagram-post')).toContainText(
                liveExpected.caption,
              );
              await expect(
                page.getByTestId('instagram-post').locator('img'),
              ).toBeVisible();
              for (const [state, id] of [
                ['read', liveExpected.readComment],
                ['missing', 'instagram:feed-comment'],
              ]) {
                await page
                  .locator(`article[data-item-id="${id}"]`)
                  .evaluate((element) =>
                    element.scrollIntoView({ block: 'start' }),
                  );
                await page.screenshot({
                  path: join(
                    folder,
                    `feed-instagram-${state}-${lang}-${theme}-${width}.png`,
                  ),
                });
              }
              await page.getByRole('tabpanel').evaluate((element) => {
                element.scrollTop = 0;
              });
            }
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeLessThanOrEqual(width);
            await page.screenshot({
              path: join(
                folder,
                `feed-${platform}-${tab}-${lang}-${theme}-${width}.png`,
              ),
            });
          }
        }
        await page
          .getByRole('combobox', {
            name: messages['review.account'],
            exact: true,
          })
          .selectOption(liveExpected.account);
        await page
          .getByRole('tab', {
            name: new RegExp(`^${messages['reviewFeed.tab.suggested']},`),
          })
          .click();
        await expect(page.getByRole('feed')).toHaveAttribute(
          'aria-busy',
          'false',
        );
        const first = page.getByRole('feed').locator('article').first();
        await first.focus();
        await page.keyboard.press('k');
        await expect(first).toHaveAttribute('data-decision', 'keep');
        await expect(first).toBeFocused();
        const mark = page.locator('footer button');
        await expect(mark).toBeEnabled();
        await mark.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.screenshot({
          path: join(folder, `preview-${lang}-${theme}-${width}.png`),
        });
        await checkAccessibility(page, context);
        await dialog
          .getByRole('button', { name: messages['bulk.cancel'], exact: true })
          .click();
        const empty = liveFeedFixture();
        empty.settings.criteria!.selected = [];
        await page.goto('/socialprune/');
        await restoreLiveFeed(page, empty);
        await expect(
          page.getByRole('heading', {
            name: messages['reviewFeed.noCriteria'],
          }),
        ).toBeVisible();
        await page.screenshot({
          path: join(folder, `first-start-${lang}-${theme}-${width}.png`),
        });
        await checkAccessibility(page, context);
      });
    }
