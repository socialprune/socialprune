import { test } from '@playwright/test';
import { fakeBridge } from './fake-bridge.ts';
import { sortFixture, checkFeedSort } from '../feed-sort-check.ts';
test('SORT-1 desktop bridge server ordering and persisted account/tab choices', async ({
  page,
}) => {
  const bridge = await fakeBridge(page, 'en', sortFixture());
  try {
    await page.goto('/desktop.html');
    await page
      .getByRole('navigation')
      .getByRole('button', { name: 'Review', exact: true })
      .click();
    await checkFeedSort(page, async () => {
      await page.reload();
      await page
        .getByRole('navigation')
        .getByRole('button', { name: 'Review', exact: true })
        .click();
    });
  } finally {
    await bridge.close();
  }
});
