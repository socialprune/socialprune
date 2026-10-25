import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import {
  liveExpected,
  liveFeedFixture,
  restoreLiveFeed,
} from '../e2e/feed-fixture.ts';

const catalogs: Record<string, Record<string, string>> = Object.fromEntries(
  await Promise.all(
    ['de', 'en'].map(
      async (lang) =>
        [
          lang,
          JSON.parse(
            await readFile(
              new URL(`../src/i18n/${lang}.json`, import.meta.url),
              'utf8',
            ),
          ) as Record<string, string>,
        ] as const,
    ),
  ),
);
// eslint-disable-next-line no-restricted-properties -- Explicit synthetic screenshot output, not credentials.
const folder = process.env['SP_H_SCREEN_DIR'];
if (!folder) throw Error('SP_H_SCREEN_DIR required');
for (const lang of ['de', 'en'])
  for (const theme of ['light', 'dark'] as const)
    for (const width of [320, 390, 1280]) {
      test(`Fokus S2 path ${lang} ${theme} ${width}`, async ({ page }) => {
        test.setTimeout(180000);
        const messages = catalogs[lang]!;
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
        const shot = async (name: string) => {
          const target = join(folder, `${name}-${lang}-${theme}-${width}.png`);
          // eslint-disable-next-line no-restricted-properties -- Reuse exact S1-before captures while filling newly added gallery views.
          const before = process.env['SP_H_BASELINE'] === 'true';
          const exists =
            before &&
            (await access(target).then(
              () => true,
              () => false,
            ));
          if (!exists) await page.screenshot({ path: target });
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width);
        };
        await restoreLiveFeed(page);
        await page
          .getByRole('tab', {
            name: new RegExp(`^${messages['reviewFeed.tab.held']},`),
          })
          .click();
        await expect(page.getByRole('feed')).toContainText(
          lang === 'de' ? '10 Gefällt mir' : '10 likes',
        );
        await shot('held');
        await page
          .getByRole('tab', {
            name: new RegExp(`^${messages['reviewFeed.tab.suggested']},`),
          })
          .click();
        await page.locator('footer button').click();
        await expect(page.getByRole('dialog')).toContainText(
          lang === 'de' ? '3 Einträge' : '3 entries',
        );
        await shot('preview');
        await page
          .getByRole('button', { name: messages['bulk.cancel'], exact: true })
          .click();
        await page
          .getByRole('button', {
            name: messages['reviewFeed.changeShort'],
            exact: true,
          })
          .click();
        await expect(
          page.getByRole('checkbox', {
            name: new RegExp(`^${messages['review.categoryPolitical']} \\d`),
          }),
        ).toBeChecked();
        await shot('picker');
        const definition = page.locator('details').filter({
          has: page.getByText(
            lang === 'de'
              ? 'Definition für Politisch'
              : 'Definition for Political',
            { exact: true },
          ),
        });
        // The incumbent shows definitions inline; S2 makes the same text a
        // named disclosure. Capture the complete definition in both versions.
        if (await definition.count()) {
          await definition.locator('summary').click();
          await shot('definition');
          await definition.locator('summary').click();
        } else await shot('definition');
        const ownName = page.getByRole('textbox', {
          name: messages['criteriaPicker.label'],
          exact: true,
        });
        await ownName.fill(
          lang === 'de' ? 'Violetter Werkzeugkasten' : 'Violet toolbox',
        );
        await page
          .getByRole('textbox', {
            name: messages['criteriaPicker.description'],
            exact: true,
          })
          .fill(
            lang === 'de'
              ? 'Erwähnt einen erfundenen violetten Werkzeugkasten.'
              : 'Mentions an invented violet toolbox.',
          );
        await ownName.scrollIntoViewIfNeeded();
        await shot('own');
        await page
          .getByRole('button', {
            name: messages['criteriaPicker.add'],
            exact: true,
          })
          .click();
        await expect(page.getByRole('status').last()).toContainText(
          messages['criteriaPicker.saved']!,
        );
        await page
          .getByRole('button', {
            name:
              lang === 'de'
                ? 'Violetter Werkzeugkasten bearbeiten'
                : 'Edit Violet toolbox',
            exact: true,
          })
          .click();
        await ownName.scrollIntoViewIfNeeded();
        await shot('own-edit');
        await page
          .getByRole('button', {
            name: messages['criteriaPicker.cancelEdit'],
            exact: true,
          })
          .click();
        await page
          .getByRole('combobox', {
            name: messages['keepRules.add'],
            exact: true,
          })
          .selectOption('reposts');
        await expect(
          page.getByRole('spinbutton', {
            name: messages['keepRules.repostsValue'],
            exact: true,
          }),
        ).toBeEnabled();
        await page
          .getByRole('heading', {
            name: messages['keepRules.title'],
            exact: true,
          })
          .scrollIntoViewIfNeeded();
        await shot('rules');
        const help = page.getByText(
          messages['keepRules.how'] ??
            (lang === 'de' ? 'So wirken deine Regeln' : 'How your rules work'),
          { exact: true },
        );
        if (await help.count()) await help.click();
        if (await help.count()) {
          await help.scrollIntoViewIfNeeded();
          await expect(
            page.getByText(messages['keepRules.combine']!, { exact: true }),
          ).toBeVisible();
          await expect(
            page.getByText(messages['keepRules.instagram']!, { exact: true }),
          ).toBeVisible();
        }
        await shot('rule-help');
        const empty = liveFeedFixture();
        empty.settings.criteria!.selected = [];
        await restoreLiveFeed(page, empty);
        await expect(
          page.getByRole('button', {
            name: messages['reviewFeed.chooseCriteria'],
            exact: true,
          }),
        ).toBeVisible();
        await shot('first-start');
      });
    }

for (const lang of ['de', 'en'])
  for (const theme of ['light', 'dark'] as const)
    for (const width of [390, 1280])
      test(`S1b feed ${lang} ${theme} ${width}`, async ({ page }) => {
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
        const first = page.getByRole('feed').locator('article').first();
        await expect(first).toContainText(
          catalogs[lang]!['reviewFeed.suggestDelete']!,
        );
        await page.screenshot({
          path: join(folder, `s1b-feed-${lang}-${theme}-${width}.png`),
        });
        if (lang === 'de' && theme === 'light' && width === 390) {
          await page
            .getByRole('combobox', { name: 'Konto', exact: true })
            .selectOption(liveExpected.instagram);
          await expect(page.getByRole('feed')).toContainText(
            'Invented comment',
          );
          await page.screenshot({
            path: join(folder, 's1b-instagram-de-light-390.png'),
          });
        }
      });
