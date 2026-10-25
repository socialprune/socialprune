import { test } from '@playwright/test';
import { restoreLiveFeed } from './feed-fixture.ts';
import { expectHeaderStyle, headerFixture } from './header-style.ts';

for (const theme of ['light', 'dark'] as const)
  for (const width of [1280, 390])
    test(`header and flat feed tabs ${theme} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.addInitScript((theme) => {
        localStorage.setItem('sp-theme', theme);
        localStorage.setItem('sp-locale', 'en');
      }, theme);
      await restoreLiveFeed(page, headerFixture());
      try {
        await expectHeaderStyle(page, info, `web-${theme}-${width}`);
      } finally {
        await page.evaluate(async () => {
          await window.workspace.request({
            type: 'shutdown',
            requestId: crypto.randomUUID(),
          });
          window.workspace.dispose();
        });
        await page.goto('about:blank');
      }
    });
