import { expect, test } from '@playwright/test';
import { fakeBridge } from './fake-bridge.ts';
test('native-drop result refreshes the desktop review and language selection is reflected in the document', async ({
  page,
}) => {
  const bridge = await fakeBridge(page);
  try {
    await page.goto('/desktop.html');
    await expect(
      page.getByRole('heading', { name: 'Set up SocialPrune', exact: true }),
    ).toBeVisible();
    await page.locator('header select').selectOption('de');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await page
      .getByRole('button', { name: 'Daten und Backups', exact: true })
      .click();
    const before = bridge.requests.filter(
      (request) => request.type === 'open',
    ).length;
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('socialprune:import-dropped', {
          detail: JSON.stringify({
            type: 'exportImported',
            requestId: crypto.randomUUID(),
            result: {
              status: 'imported',
              items: 300,
              duplicates: 0,
              accounts: 1,
              partial: false,
            },
          }),
        }),
      ),
    );
    await expect(page.getByTestId('review-card')).toBeVisible();
    expect(
      bridge.requests.filter((request) => request.type === 'open').length,
    ).toBeGreaterThan(before);
    expect(
      bridge.requests.some((request) => request.type === 'importExport'),
    ).toBe(false);
    expect(JSON.stringify(bridge.requests)).not.toContain('paths');
  } finally {
    await bridge.close();
  }
});
