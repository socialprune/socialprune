import { expect, test } from '@playwright/test';
import { liveExpected, restoreLiveFeed } from './feed-fixture.ts';
import { observeImport } from './helpers.ts';

for (const width of [320, 390, 1280])
  for (const theme of ['light', 'dark'] as const)
    test(`Fokus foundation ${width} ${theme}: reading surface, chrome and decision grammar`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 800 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      const audit = await observeImport(context, page);
      await restoreLiveFeed(page);
      const first = page.getByRole('feed').locator('article').first();
      const geometry = await first.evaluate((article) => {
        const review = article.closest('section')!;
        const header = document.querySelector('header')!;
        const keep = article.querySelector('[data-keep-action]')!;
        const mark = article.querySelector('[data-mark-action]')!;
        const bounds = review.getBoundingClientRect();
        const canvas = getComputedStyle(document.body).backgroundColor;
        return {
          sideSummaries: document.querySelectorAll(
            '[data-testid="review-card"] > aside',
          ).length,
          width: bounds.width,
          center: (bounds.left + bounds.right) / 2,
          viewport: innerWidth,
          headerColor: getComputedStyle(header).backgroundColor,
          canvas,
          typeSize: Number.parseFloat(
            getComputedStyle(article.querySelector('p[dir="auto"]')!).fontSize,
          ),
          keepRadius: getComputedStyle(keep).borderTopLeftRadius,
          markRadius: getComputedStyle(mark).borderTopLeftRadius,
          firstDecisionBottom: mark.getBoundingClientRect().bottom,
          panelBottom: article
            .closest('[role="tabpanel"]')!
            .getBoundingClientRect().bottom,
          footerBottom: document
            .querySelector('footer button')!
            .getBoundingClientRect().bottom,
          height: innerHeight,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(geometry.sideSummaries).toBe(0);
      expect(geometry.width).toBeLessThanOrEqual(760);
      expect(
        Math.abs(geometry.center - geometry.viewport / 2),
      ).toBeLessThanOrEqual(1);
      expect(geometry.headerColor).toBe(
        theme === 'dark' ? 'rgb(20, 40, 51)' : 'rgb(33, 59, 75)',
      );
      expect(geometry.headerColor).not.toBe(geometry.canvas);
      expect(geometry.keepRadius).toBe('12px');
      expect(geometry.markRadius).toBe('12px');
      expect(geometry.typeSize).toBeGreaterThanOrEqual(16);
      expect(geometry.firstDecisionBottom).toBeLessThanOrEqual(
        geometry.panelBottom,
      );
      expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.height);
      expect(geometry.overflow).toBe(false);
      await first.focus();
      const decidedId = await first.getAttribute('data-card-id');
      await page.keyboard.press('k');
      await expect(
        page.getByRole('feed').locator('article').nth(1),
      ).toBeFocused();
      await expect(
        page.locator(`article[data-card-id="${decidedId}"]`),
      ).toHaveAttribute('data-decision', 'keep');
      await page.keyboard.press('Control+z');
      await page.evaluate(() => window.workspace.flushCommands());
      await expect(
        page.locator(`article[data-card-id="${decidedId}"]`),
      ).toHaveAttribute('data-decision', 'undecided');
      await page.locator(`article[data-card-id="${decidedId}"]`).focus();
      await page.keyboard.press('u');
      await expect(first).toHaveAttribute('data-decision', 'undecided');
      await audit.assert();
    });

for (const lang of ['de', 'en'])
  for (const theme of ['light', 'dark'] as const)
    test(`S1b suggestion mark ${lang} ${theme}: X and Instagram across every tab`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.addInitScript(
        (lang) => localStorage.setItem('sp-locale', lang),
        lang,
      );
      await restoreLiveFeed(page);
      for (const account of [liveExpected.account, liveExpected.instagram]) {
        await page
          .getByRole('combobox', {
            name: lang === 'de' ? 'Konto' : 'Account',
            exact: true,
          })
          .selectOption(account);
        for (const tab of await page.getByRole('tab').all()) {
          await tab.click();
          await expect(page.getByRole('feed')).toHaveAttribute(
            'aria-busy',
            'false',
          );
          const lines = page
            .getByRole('feed')
            .locator('[class*="suggestionLine"]');
          for (const line of await lines.all()) {
            const mark = line.locator(':scope > svg.lucide-wand-sparkles');
            await expect(mark).toHaveCount(1);
            await expect(mark).toHaveAttribute('aria-hidden', 'true');
            const shape = await mark.evaluate((svg) => {
              const label = svg.nextElementSibling!.querySelector('strong')!;
              const iconBox = svg.getBoundingClientRect(),
                labelBox = label.getBoundingClientRect();
              return {
                width: iconBox.width,
                height: iconBox.height,
                color: getComputedStyle(svg).color,
                labelColor: getComputedStyle(label).color,
                labelTag: label.tagName,
                before: iconBox.right <= labelBox.left,
                aligned: Math.abs(iconBox.top - labelBox.top) <= 4,
              };
            });
            expect(shape).toMatchObject({
              width: 16,
              height: 16,
              labelTag: 'STRONG',
              before: true,
              aligned: true,
            });
            expect(shape.color).toBe(shape.labelColor);
          }
        }
      }
    });
