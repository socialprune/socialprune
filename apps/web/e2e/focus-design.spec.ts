import { expect, test } from '@playwright/test';
import { restoreLiveFeed } from './feed-fixture.ts';
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
      await page.keyboard.press('k');
      await expect(first).toBeFocused();
      await expect(first).toHaveAttribute('data-decision', 'keep');
      await page.keyboard.press('u');
      await expect(first).toHaveAttribute('data-decision', 'undecided');
      await audit.assert();
    });
