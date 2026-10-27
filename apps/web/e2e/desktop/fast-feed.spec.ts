import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { fakeBridge } from './fake-bridge.ts';
import { headerFixture } from '../header-style.ts';
import { checkFastFeed } from '../fast-feed-check.ts';
import { checkHistoryRecovery } from '../fast-revision-check.ts';

for (const direction of ['back', 'forward'] as const)
  test(`F2/F5 desktop ${direction} retains the failed card`, async ({
    page,
  }) => {
    const bridge = await fakeBridge(page, 'en', headerFixture());
    try {
      await page.goto('/desktop.html');
      await page
        .getByRole('navigation')
        .getByRole('button', { name: 'Review', exact: true })
        .click();
      await checkHistoryRecovery(page, direction);
    } finally {
      await bridge.close();
    }
  });
test('FAST-1 desktop queued write recovery is immediate and never silently marks', async ({
  page,
}) => {
  const bridge = await fakeBridge(page, 'en', headerFixture());
  try {
    await page.goto('/desktop.html');
    await page
      .getByRole('navigation')
      .getByRole('button', { name: 'Review', exact: true })
      .click();
    await checkFastFeed(page);
  } finally {
    await bridge.close();
  }
});

for (const size of [
  { width: 1280, height: 720 },
  { width: 1920, height: 900 },
])
  for (const theme of ['light', 'dark'] as const)
    test(`R4 desktop single fits ${size.width} ${theme}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript(
        (theme) => localStorage.setItem('sp-theme', theme),
        theme,
      );
      const bridge = await fakeBridge(page, 'en', headerFixture());
      try {
        await page.goto('/desktop.html');
        await page
          .getByRole('navigation')
          .getByRole('button', { name: 'Review', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'One at a time', exact: true })
          .click();
        const card = page.getByRole('feed').locator('article');
        await expect(card).toHaveCount(1);
        const geometry = await card.evaluate((card) => ({
          overflow:
            document.scrollingElement!.scrollHeight -
            document.scrollingElement!.clientHeight,
          top: card.getBoundingClientRect().top,
          bottom: card.getBoundingClientRect().bottom,
          height: innerHeight,
          actions: ['keep', 'later', 'mark'].map((action) => {
            const box = card
              .querySelector(`[data-${action}-action]`)!
              .getBoundingClientRect();
            return { top: box.top, bottom: box.bottom };
          }),
        }));
        expect.soft(geometry.overflow).toBeLessThanOrEqual(0);
        for (const box of [geometry, ...geometry.actions]) {
          expect.soft(box.top).toBeGreaterThanOrEqual(0);
          expect.soft(box.bottom).toBeLessThanOrEqual(geometry.height);
        }
        // eslint-disable-next-line no-restricted-properties -- Explicit generated screenshot destination.
        const folder = process.env['SP_H_SCREEN_DIR'];
        if (folder)
          await page.screenshot({
            path: join(
              folder,
              `desktop-single-${theme}-${size.width}x${size.height}.png`,
            ),
            animations: 'disabled',
          });
      } finally {
        await bridge.close();
      }
    });
