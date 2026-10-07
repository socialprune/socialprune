import { test, expect } from '@playwright/test';
import { restoreReview } from './review-fixture.ts';
import { checkAccessibility } from './accessibility.ts';
import { observeImport } from './helpers.ts';

const layouts = [
  { name: 'desktop', width: 1280, zoom: 1, reduced: false },
  { name: '320px reduced motion', width: 320, zoom: 1, reduced: true },
  { name: '200 percent zoom', width: 1280, zoom: 2, reduced: true },
] as const;
for (const locale of ['en', 'de'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const layout of layouts) {
      test(`W2 ${locale} ${theme} ${layout.name}: review, detail, dialogs and bulk have no automated AA violations`, async ({
        page,
        context,
      }) => {
        test.setTimeout(60_000);
        const audit = await observeImport(context, page);
        await restoreReview(page);
        if (locale === 'de')
          await page
            .getByRole('combobox', { name: 'Language', exact: true })
            .selectOption('de');
        await page.emulateMedia({
          reducedMotion: layout.reduced ? 'reduce' : 'no-preference',
          colorScheme: theme,
        });
        await page.setViewportSize({ width: layout.width, height: 900 });
        await page.evaluate(
          ({ zoom, theme }) => {
            document.documentElement.style.zoom = String(zoom);
            document.documentElement.dataset.theme = theme;
          },
          { zoom: layout.zoom, theme },
        );
        const assertLayout = async () =>
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
        await assertLayout();
        await expect(page.getByRole('grid')).toMatchAriaSnapshot(
          `- grid ${locale === 'de' ? '"Einträge zum Durchsehen"' : '"Entries to review"'}`,
        );
        await checkAccessibility(page, context);
        await page
          .getByText(
            locale === 'de'
              ? 'Weitere Filter und Vorlagen'
              : 'More filters and templates',
            { exact: true },
          )
          .click();
        await checkAccessibility(page, context);
        await page.getByRole('searchbox').fill('invented-no-results');
        await expect(
          page.getByText(
            locale === 'de'
              ? 'Keine Einträge passen zu diesen Filtern. Entferne sie, um die übrigen Einträge zu sehen.'
              : 'No entries match these filters. Clear them to see the rest.',
            { exact: true },
          ),
        ).toBeVisible();
        await checkAccessibility(page, context);
        await page
          .getByRole('button', {
            name: locale === 'de' ? 'Filter entfernen' : 'Clear filters',
            exact: true,
          })
          .click();
        await expect(page.getByRole('row').first()).toBeVisible();
        await page.getByRole('grid').focus();
        await page.keyboard.press('Shift+F10');
        await expect(page.getByRole('menu')).toBeVisible();
        await expect(page.getByRole('menu')).toMatchAriaSnapshot('- menu');
        await checkAccessibility(page, context);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toHaveCount(0);
        await page.getByRole('grid').focus();
        await page.keyboard.press('Enter');
        await expect(
          page.getByRole('region', {
            name: locale === 'de' ? 'Eintragsdetails' : 'Entry details',
          }),
        ).toBeVisible();
        await expect(
          page.getByRole('region', {
            name: locale === 'de' ? 'Eintragsdetails' : 'Entry details',
          }),
        ).toMatchAriaSnapshot(
          `- region ${locale === 'de' ? '"Eintragsdetails"' : '"Entry details"'}`,
        );
        await assertLayout();
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
        await expect(page.getByRole('dialog')).toMatchAriaSnapshot('- dialog');
        await checkAccessibility(page, context);
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
        await page
          .getByRole('dialog')
          .getByRole('button', {
            name: locale === 'de' ? 'Schließen' : 'Close',
            exact: true,
          })
          .click();
        await page
          .getByRole('button', {
            name:
              locale === 'de'
                ? 'Zum Löschen vormerken für alle in dieser Ansicht'
                : 'Mark for deletion for all in this view',
            exact: true,
          })
          .click();
        await expect(
          page.getByRole('dialog').getByRole('button', {
            name:
              locale === 'de'
                ? 'Zum Löschen vormerken: 8 Einträge'
                : 'Mark for deletion: 8 entries',
            exact: true,
          }),
        ).toBeEnabled();
        await expect(page.getByRole('dialog')).toMatchAriaSnapshot('- dialog');
        await assertLayout();
        await checkAccessibility(page, context);
        await page
          .getByRole('dialog')
          .getByRole('button', {
            name: locale === 'de' ? 'Abbrechen' : 'Cancel',
            exact: true,
          })
          .click();
        await page
          .getByRole('button', {
            name:
              locale === 'de'
                ? 'Behalten für alle in dieser Ansicht'
                : 'Keep for all in this view',
            exact: true,
          })
          .click();
        const confirm = page.getByRole('dialog').getByRole('button', {
          name: locale === 'de' ? 'Behalten: 8 Einträge' : 'Keep: 8 entries',
          exact: true,
        });
        await expect(confirm).toBeEnabled();
        await confirm.click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(
          page.getByText(
            locale === 'de'
              ? 'Jeder Eintrag in diesem Konto hat eine Entscheidung.'
              : 'Every entry in this account has a decision.',
            { exact: true },
          ),
        ).toBeVisible();
        await checkAccessibility(page, context);
        await page
          .getByRole('button', {
            name: locale === 'de' ? 'Liste mit Seiten' : 'Paged list',
            exact: true,
          })
          .click();
        await expect(
          page
            .getByRole('button', {
              name: locale === 'de' ? 'Details öffnen' : 'Open details',
              exact: true,
            })
            .first(),
        ).toBeVisible();
        await checkAccessibility(page, context);
        await audit.assert();
        // A narrow test-only transport rejection leaves IndexedDB intact and
        // makes the production storage-error view observable for this matrix.
        await page.evaluate(() => {
          const worker = window.workspace.worker;
          const post = worker.postMessage.bind(worker);
          worker.postMessage = (
            message: unknown,
            options?: Transferable[] | StructuredSerializeOptions,
          ) => {
            const request = message as { type?: string; requestId?: string };
            if (request.type === 'decide') {
              queueMicrotask(() =>
                worker.dispatchEvent(
                  new MessageEvent('message', {
                    data: {
                      type: 'failed',
                      requestId: request.requestId,
                      code: 'STORAGE',
                    },
                  }),
                ),
              );
            } else
              post(
                message,
                Array.isArray(options) ? options : (options?.transfer ?? []),
              );
          };
        });
        await page
          .getByRole('button', {
            name: locale === 'de' ? 'Details öffnen' : 'Open details',
            exact: true,
          })
          .first()
          .click();
        await page
          .getByRole('button', {
            name: locale === 'de' ? 'Behalten K' : 'Keep K',
            exact: true,
          })
          .click();
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(page.getByRole('alert')).toMatchAriaSnapshot('- alert');
        await checkAccessibility(page, context);
        await audit.assert();
      });
    }
  }
}

test('forced colors keep a visible focused border and decision text without depending on color', async ({
  page,
  browserName,
  context,
}) => {
  const audit = await observeImport(context, page);
  await restoreReview(page);
  if (browserName !== 'webkit')
    await page.emulateMedia({ forcedColors: 'active' });
  await page.getByRole('grid').focus();
  await page.keyboard.press('k');
  await expect(page.getByRole('row').first()).toContainText('Keep');
  const focused = page.getByRole('gridcell').first();
  expect(
    await focused.evaluate(
      (cell) => getComputedStyle(cell.parentElement!).outlineWidth,
    ),
  ).toBe('3px');
  await checkAccessibility(page, context);
  await audit.assert();
});
