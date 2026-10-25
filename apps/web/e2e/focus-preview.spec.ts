import { expect, test } from '@playwright/test';
import { restoreLiveFeed } from './feed-fixture.ts';

for (const lang of ['de', 'en'])
  for (const theme of ['light', 'dark'] as const)
    test(`S2b full preview heading ${lang} ${theme} 320`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 844 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.addInitScript(
        ({ lang, theme }) => {
          localStorage.setItem('sp-locale', lang);
          localStorage.setItem('sp-theme', theme);
        },
        { lang, theme },
      );
      await restoreLiveFeed(page);
      const trigger = page.locator('footer button');
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading')).toContainText(
        lang === 'de' ? '3 Einträge' : '3 entries',
      );
      await expect
        .poll(() =>
          dialog.evaluate((node) => node.contains(document.activeElement)),
        )
        .toBe(true);
      const geometry = () =>
        dialog.evaluate((node) => {
          const title = node.querySelector('h2')!.getBoundingClientRect();
          const popup = node.getBoundingClientRect();
          const body = node.querySelector<HTMLElement>(
            '[class*="previewBody"]',
          )!;
          return {
            top: title.top,
            bottom: title.bottom,
            popupTop: popup.top,
            popupBottom: popup.bottom,
            bodyScroll: body.scrollTop,
            popupScroll: node.scrollTop,
          };
        });
      const opening = await geometry();
      console.log('S2B_OPENING', JSON.stringify({ lang, theme, ...opening }));
      expect(opening.top).toBeGreaterThanOrEqual(opening.popupTop);
      expect(opening.bottom).toBeLessThanOrEqual(opening.popupBottom);
      await dialog.locator('[class*="previewBody"]').evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      const scrolled = await geometry();
      expect(scrolled.top).toBeGreaterThanOrEqual(scrolled.popupTop);
      expect(scrolled.bottom).toBeLessThanOrEqual(scrolled.popupBottom);
      await expect(dialog.locator('summary')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    });
