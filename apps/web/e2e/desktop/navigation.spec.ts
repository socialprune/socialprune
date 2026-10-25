import { expect, test } from '@playwright/test';
import { fakeBridge } from './fake-bridge.ts';
import { expectDesktopNavigation } from './navigation.ts';

for (const locale of ['de', 'en'] as const)
  test(`desktop navigation follows the person's path in ${locale}`, async ({
    page,
  }) => {
    const bridge = await fakeBridge(page, locale);
    try {
      await page.goto('/desktop.html');
      await expectDesktopNavigation(page, locale);
      const buttons = page
        .getByRole('navigation', { name: 'SocialPrune' })
        .getByRole('button');
      await buttons.first().focus();
      for (const button of await buttons.all()) {
        await expect(button).toBeFocused();
        await page.keyboard.press('Tab');
      }
      await buttons.first().click();
      await expect(page.getByTestId('desktop-setup')).toBeVisible();
    } finally {
      await bridge.close();
    }
  });
