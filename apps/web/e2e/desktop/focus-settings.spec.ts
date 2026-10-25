import { expect, test } from '@playwright/test';
import { fakeBridge } from './fake-bridge.ts';
import { liveFeedFixture } from '../feed-fixture.ts';
import { checkAccessibility } from '../accessibility.ts';
import de from '../../src/i18n/de.json' with { type: 'json' };
import en from '../../src/i18n/en.json' with { type: 'json' };

for (const lang of ['de', 'en'] as const)
  for (const width of [390, 1280])
    test(`S2 desktop criteria/rules/preview ${lang} ${width} stay human and local`, async ({
      page,
      context,
    }) => {
      const messages = lang === 'de' ? de : en;
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const bridge = await fakeBridge(page, lang, liveFeedFixture());
      const requests: string[] = [];
      page.on('request', (request) => requests.push(request.url()));
      try {
        await page.goto('/desktop.html');
        const origin = new URL(page.url()).origin;
        await page
          .getByRole('button', {
            name: messages['reviewFeed.changeShort'],
            exact: true,
          })
          .click();
        const footer = page.locator('[data-criteria-footer]');
        await expect(footer).toBeVisible();
        await expect(footer).toContainText(
          lang === 'de' ? '3 Einträge' : '3 entries',
        );
        const start = (await footer.boundingBox())!.y;
        await page
          .getByRole('textbox', {
            name: messages['criteriaPicker.label'],
            exact: true,
          })
          .fill(lang === 'de' ? 'Erfundene Kisten' : 'Invented crates');
        await page
          .getByRole('textbox', {
            name: messages['criteriaPicker.description'],
            exact: true,
          })
          .fill('Only mentions an invented crate.');
        await page
          .getByRole('button', {
            name: messages['criteriaPicker.add'],
            exact: true,
          })
          .click();
        await expect(
          page.getByRole('button', {
            name:
              lang === 'de'
                ? 'Erfundene Kisten bearbeiten'
                : 'Edit Invented crates',
            exact: true,
          }),
        ).toBeAttached();
        expect(
          Math.abs((await footer.boundingBox())!.y - start),
        ).toBeLessThanOrEqual(1);
        await expect(footer.getByRole('status')).toContainText(
          messages['criteriaPicker.saved'],
        );
        await checkAccessibility(page, context);
        await footer.getByRole('button').click();
        await expect(footer).toBeHidden();
        await expect(page.getByRole('tab', { selected: true })).toBeFocused();
        await page.locator('footer button').focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(
          lang === 'de' ? '3 Einträge' : '3 entries',
        );
        await checkAccessibility(page, context);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        const snapshot = await bridge.snapshot();
        expect(snapshot.decisionEvents.length).toBe(
          liveFeedFixture().decisionEvents.length,
        );
        expect(
          requests.filter((url) => new URL(url).origin !== origin),
        ).toEqual([]);
      } finally {
        await bridge.close();
      }
    });
