import { expect, test } from '@playwright/test';
import { reviewFixture, restoreReview } from './review-fixture.ts';
import { observeImport } from './helpers.ts';
import { german } from './navigation.ts';

for (const locale of ['en', 'de'] as const) {
  test(`${locale} empty Instagram comments with zero or unknown media show No text in list, detail and click list`, async ({
    page,
    context,
  }) => {
    const audit = await observeImport(context, page);
    const fixture = reviewFixture('personal', false, 3);
    fixture.items = fixture.items.map((item, index) => ({
      ...item,
      id: `instagram:empty-${index}`,
      platform: 'instagram',
      kind: 'comment',
      account: { key: 'instagram:invented-empty', handle: 'invented_empty' },
      text: index === 0 ? 'Invented comment with text.' : '',
      mediaCount: index === 1 ? 0 : null,
      url: null,
    }));
    await restoreReview(page, fixture);
    if (locale === 'de') await german(page);
    const noText = locale === 'en' ? 'No text' : 'Kein Text';
    const grid = page.getByRole('grid');
    await expect(grid.getByText(noText, { exact: true })).toHaveCount(2);
    await grid.focus();
    for (let index = 1; index < 3; index++) {
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(
        page
          .getByRole('region', {
            name: locale === 'en' ? 'Entry details' : 'Eintragsdetails',
          })
          .getByText(noText, { exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', {
          name: locale === 'en' ? 'Back to list' : 'Zurück zur Liste',
          exact: true,
        })
        .click();
      await page.keyboard.press('m');
      await expect(
        page.getByText(
          locale === 'en'
            ? '1 decision saved. Nothing was deleted on the platform.'
            : '1 Entscheidung gespeichert. Auf der Plattform wurde nichts gelöscht.',
          { exact: true },
        ),
      ).toBeVisible();
    }
    await page.goto('/socialprune/#/clicklist/instagram');
    await expect(
      page.getByRole('heading', {
        name: locale === 'en' ? 'Click list' : 'Klickliste',
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(noText, { exact: true })).toBeVisible();
    await page
      .getByRole('main')
      .getByRole('button', {
        name: locale === 'en' ? 'Start' : 'Anfangen',
        exact: true,
      })
      .click();
    await expect(
      page.locator('li[data-item-id]').getByText(noText, { exact: true }),
    ).toHaveCount(2);
    await audit.assert();
  });
}
