import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { restoreLiveFeed } from './feed-fixture.ts';
import { observeImport } from './helpers.ts';
import { checkAccessibility } from './accessibility.ts';

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
for (const lang of ['de', 'en'])
  for (const width of [320, 390, 1280])
    test(`Fokus S2 ${lang} ${width}: stable result, definitions and full preview`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(
        (lang) => localStorage.setItem('sp-locale', lang),
        lang,
      );
      const messages = catalogs[lang]!;
      const audit = await observeImport(context, page);
      await restoreLiveFeed(page);
      await page
        .getByRole('button', {
          name: messages['reviewFeed.changeShort'],
          exact: true,
        })
        .click();
      const scroll = page.locator('[data-criteria-scroll]');
      const footer = page.locator('[data-criteria-footer]');
      await expect(footer).toBeVisible();
      const before = await footer.boundingBox();
      expect(before!.y + before!.height).toBeLessThanOrEqual(
        width === 1280 ? 800 : 844,
      );
      const political = page.getByRole('checkbox', {
        name: new RegExp(`^${messages['review.categoryPolitical']} \\d`),
      });
      await expect(political).toBeChecked();
      const definition = page.locator('details').filter({
        has: page.getByText(
          lang === 'de'
            ? 'Definition für Politisch'
            : 'Definition for Political',
          { exact: true },
        ),
      });
      await definition.locator('summary').click();
      await expect(definition).toHaveAttribute('open', '');
      await expect(definition.locator('p')).toBeVisible();
      await expect(political).toBeChecked();
      await expect(political).toHaveAccessibleDescription(
        lang === 'de'
          ? 'Vertritt eine politische Position oder ein parteiliches Argument.'
          : 'Expresses a political position or partisan argument.',
      );
      await checkAccessibility(page, context);
      await definition.locator('summary').click();
      await page
        .getByRole('textbox', {
          name: messages['criteriaPicker.label'],
          exact: true,
        })
        .scrollIntoViewIfNeeded();
      const after = await footer.boundingBox();
      expect(Math.abs(before!.y - after!.y)).toBeLessThanOrEqual(1);
      expect(await scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(
        0,
      );
      const buttons = await footer.getByRole('button').all();
      for (const button of buttons) {
        const box = await button.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await page
        .getByRole('button', {
          name: messages['reviewFeed.applyCriteria'],
          exact: true,
        })
        .click();
      await expect(footer).toBeHidden();
      // saveCriteria restores focus to the selected tab in its completion
      // frame. Wait for that existing handoff before starting a new action.
      await expect(page.getByRole('tab', { selected: true })).toBeFocused();
      const finalMark = page.locator('footer button');
      await expect(finalMark).toBeEnabled();
      // The footer after the editor replaces the clicked editor footer. Focus
      // the new control before Enter rather than reusing a pointer coordinate.
      await finalMark.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(
        lang === 'de' ? '3 Einträge' : '3 entries',
      );
      const actions = dialog.locator('[data-preview-actions]');
      const initialActions = await actions.boundingBox();
      await dialog.locator('details summary').click();
      await expect(dialog.locator('details ol')).toContainText(
        'Invented political post',
      );
      await dialog.locator('[class*="previewBody"]').evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await checkAccessibility(page, context);
      const finalActions = await actions.boundingBox();
      expect(Math.abs(initialActions!.y - finalActions!.y)).toBeLessThanOrEqual(
        1,
      );
      expect(finalActions!.y + finalActions!.height).toBeLessThanOrEqual(
        width === 1280 ? 800 : 844,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page.locator('footer button')).toBeFocused();
      await audit.assert();
    });
