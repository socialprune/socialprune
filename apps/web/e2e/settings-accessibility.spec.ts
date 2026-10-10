import { test, expect } from '@playwright/test';
import { restoreClickLists, clickListFixture } from './clicklist-fixture.ts';
import { checkAccessibility } from './accessibility.ts';
import { observeImport } from './helpers.ts';
import { german } from './navigation.ts';

const layouts = [
  { name: 'desktop', width: 1280, zoom: 1, reduced: false },
  { name: '320px reduced motion', width: 320, zoom: 1, reduced: true },
  { name: '200 percent zoom', width: 1280, zoom: 2, reduced: true },
] as const;
for (const locale of ['en', 'de'] as const)
  for (const theme of ['light', 'dark'] as const)
    for (const layout of layouts) {
      test(`W3 ${locale} ${theme} ${layout.name}: lists backup settings and delete dialog have no automated AA violations`, async ({
        page,
        context,
      }) => {
        test.setTimeout(90_000);
        const audit = await observeImport(context, page);
        await restoreClickLists(page);
        if (locale === 'de') await german(page);
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: layout.reduced ? 'reduce' : 'no-preference',
        });
        await page.setViewportSize({ width: layout.width, height: 900 });
        await page.evaluate(
          ({ zoom, theme }) => {
            document.documentElement.style.zoom = String(zoom);
            document.documentElement.dataset.theme = theme;
          },
          { zoom: layout.zoom, theme },
        );
        for (const platform of ['x', 'instagram']) {
          await page.goto(`/socialprune/#/clicklist/${platform}`);
          const start = page.getByRole('button', {
            name: locale === 'de' ? 'Anfangen' : 'Start',
            exact: true,
          });
          await expect(start).toBeEnabled();
          await checkAccessibility(page, context);
          await start.click();
          await expect(
            page.getByRole('list', {
              name:
                locale === 'de'
                  ? 'Vorgemerkte Einträge zum Finden auf der Plattform'
                  : 'Marked entries to find on the platform',
            }),
          ).toBeVisible();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await checkAccessibility(page, context);
          const list = page.getByRole('list', {
            name:
              locale === 'de'
                ? 'Vorgemerkte Einträge zum Finden auf der Plattform'
                : 'Marked entries to find on the platform',
          });
          await list
            .getByRole('button', {
              name: locale === 'de' ? 'Überspringen' : 'Skip',
              exact: true,
            })
            .first()
            .click();
          await expect(
            page.getByText(
              locale === 'de'
                ? '0 von dir gelöscht, 1 übersprungen, 3 übrig.'
                : '0 deleted by you, 1 skipped, 3 left.',
              { exact: true },
            ),
          ).toBeVisible();
          await checkAccessibility(page, context);
          if (platform === 'instagram') {
            await page
              .getByRole('button', {
                name: locale === 'de' ? 'Ändern' : 'Change',
                exact: true,
              })
              .click();
            await checkAccessibility(page, context);
          }
        }
        await page.goto('/socialprune/#/backup');
        await expect(
          page.getByRole('button', {
            name: locale === 'de' ? 'Backup herunterladen' : 'Download backup',
            exact: true,
          }),
        ).toBeEnabled();
        await checkAccessibility(page, context);
        const backup = clickListFixture();
        await page
          .getByLabel(
            locale === 'de'
              ? 'SocialPrune-Backup-Datei'
              : 'SocialPrune backup file',
            { exact: true },
          )
          .setInputFiles({
            name: 'invented-aa-backup.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(backup)),
          });
        await expect(
          page.getByRole('heading', {
            name:
              locale === 'de'
                ? 'Wiederherstellungsvorschau'
                : 'Restore preview',
            exact: true,
          }),
        ).toBeVisible();
        await checkAccessibility(page, context);
        await page
          .getByRole('button', {
            name: locale === 'de' ? 'Abbrechen' : 'Cancel',
            exact: true,
          })
          .click();
        await page
          .getByLabel(
            locale === 'de'
              ? 'SocialPrune-Backup-Datei'
              : 'SocialPrune backup file',
            { exact: true },
          )
          .setInputFiles({
            name: 'invented-corrupt.json',
            mimeType: 'application/json',
            buffer: Buffer.from('{"format":'),
          });
        await expect(page.getByRole('alert')).toBeVisible();
        await checkAccessibility(page, context);
        await page.goto('/socialprune/#/settings');
        await expect(
          page.getByRole('button', {
            name:
              locale === 'de'
                ? 'Diese Durchsicht aus diesem Browser löschen'
                : 'Delete this review from this browser',
            exact: true,
          }),
        ).toBeEnabled();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await checkAccessibility(page, context);
        await page
          .getByRole('button', {
            name:
              locale === 'de'
                ? 'Diese Durchsicht aus diesem Browser löschen'
                : 'Delete this review from this browser',
            exact: true,
          })
          .click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await checkAccessibility(page, context);
        await page
          .getByRole('dialog')
          .getByRole('button', {
            name: locale === 'de' ? 'Abbrechen' : 'Cancel',
            exact: true,
          })
          .click();
        await audit.assert();
      });
    }
