import { test, expect } from '@playwright/test';
import { waitForApp, observeImport } from './helpers.ts';
import { method9Zip, encryptedZip } from './archive-method9.ts';

for (const locale of ['en', 'de'] as const) {
  test(`${locale} method-9 and encrypted ZIP diagnostics explain the unreadable entry without a password prompt`, async ({
    page,
    context,
  }) => {
    const audit = await observeImport(context, page);
    await waitForApp(page);
    if (locale === 'de')
      await page
        .getByRole('combobox', { name: 'Language', exact: true })
        .selectOption('de');
    for (const [buffer, expected] of [
      [method9Zip(), 'Deflate64'],
      [
        encryptedZip(),
        locale === 'de'
          ? 'SocialPrune fragt nicht nach Passwörtern'
          : 'SocialPrune does not ask for passwords',
      ],
    ] as const) {
      await page.getByTestId('archives').setInputFiles({
        name: 'invented-diagnostic.zip',
        mimeType: 'application/zip',
        buffer,
      });
      await page.getByTestId('import-button').click();
      await expect(page.getByTestId('import-state')).toHaveAttribute(
        'data-phase',
        'complete',
      );
      await expect(
        page.locator('main li').filter({ hasText: expected }),
      ).toBeVisible();
      expect(await page.locator('input[type="password"]').count()).toBe(0);
      expect(
        await page.evaluate(() => window.socialprune.getImportSnapshot().items),
      ).toEqual([]);
    }
    await audit.assert();
  });
}
