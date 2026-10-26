import { test } from '@playwright/test';
import { fakeBridge } from './fake-bridge.ts';
import { headerFixture } from '../header-style.ts';
import { checkFastFeed } from '../fast-feed-check.ts';
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
