import { expect, test } from '@playwright/test';
import { fakeBridge } from './fake-bridge.ts';
import { liveFeedFixture } from '../feed-fixture.ts';
import { expectHeaderStyle } from '../header-style.ts';

for (const theme of ['light', 'dark'] as const)
  for (const width of [1280, 390])
    test(`header and flat feed tabs ${theme} ${width}`, async ({
      page,
    }, info) => {
      const bridge = await fakeBridge(page, 'en', liveFeedFixture());
      try {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: 'reduce',
        });
        await page.addInitScript(
          (theme) => localStorage.setItem('sp-theme', theme),
          theme,
        );
        await page.goto('/desktop.html');
        await page
          .getByRole('navigation')
          .getByRole('button', { name: 'Review', exact: true })
          .click();
        await expect(page.getByRole('feed')).toHaveAttribute(
          'aria-busy',
          'false',
        );
        await expectHeaderStyle(page, info, `desktop-${theme}-${width}`);
      } finally {
        await bridge.close();
      }
    });
