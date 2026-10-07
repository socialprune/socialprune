import { test, expect } from '@playwright/test';
import { restoreReview } from './review-fixture.ts';
import { checkAccessibility } from './accessibility.ts';

for (const locale of ['en', 'de'] as const) {
  test(`W2a ${locale} review and keyboard dialog have no automated WCAG 2.2 AA violations`, async ({
    page,
    context,
  }) => {
    await restoreReview(page);
    if (locale === 'de')
      await page.getByRole('combobox', { name: 'Language' }).selectOption('de');
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.setViewportSize({ width: 320, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await checkAccessibility(page, context);
    await page.getByRole('grid').focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('region', {
        name: locale === 'de' ? 'Eintragsdetails' : 'Entry details',
      }),
    ).toBeVisible();
    await checkAccessibility(page, context);
    await page
      .getByRole('button', {
        name: locale === 'de' ? 'Zurück zur Liste' : 'Back to list',
        exact: true,
      })
      .click();
    await page
      .getByRole('button', {
        name: locale === 'de' ? 'Tastatur' : 'Keyboard',
        exact: true,
      })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await checkAccessibility(page, context);
    await expect(page.getByRole('dialog')).toMatchAriaSnapshot(`
      - dialog:
        - heading ${locale === 'de' ? '"Tastatur"' : '"Keyboard"'} [level=2]
    `);
    await page
      .getByRole('dialog')
      .getByRole('button', {
        name: locale === 'de' ? 'Schließen' : 'Close',
        exact: true,
      })
      .click();
    await page
      .getByRole('button', {
        name: locale === 'de' ? 'Verlauf' : 'History',
        exact: true,
      })
      .click();
    await checkAccessibility(page, context);
  });
}
