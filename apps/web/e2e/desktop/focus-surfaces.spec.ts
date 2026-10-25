import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { fakeBridge } from './fake-bridge.ts';
import { expectDesktopNavigation } from './navigation.ts';
import { runView } from './views.ts';
import en from '../../src/i18n/en.json' with { type: 'json' };
import de from '../../src/i18n/de.json' with { type: 'json' };
const catalogs = { en, de };
import { checkAccessibility } from '../accessibility.ts';
// eslint-disable-next-line no-restricted-properties -- Optional generated screenshot destination.
const folder = process.env['SP_H_SCREEN_DIR'];
for (const lang of ['de', 'en'] as const)
  for (const theme of ['light', 'dark'] as const)
    for (const width of [320, 390, 1280])
      test(`S4 desktop surfaces ${lang} ${theme} ${width}`, async ({
        page,
        context,
      }) => {
        test.setTimeout(120000);
        const bridge = await fakeBridge(page, lang, undefined, 'direct');
        try {
          await page.setViewportSize({
            width,
            height: width === 1280 ? 800 : 844,
          });
          await page.emulateMedia({
            colorScheme: theme,
            reducedMotion: 'reduce',
          });
          await page.addInitScript(
            (theme) => localStorage.setItem('sp-theme', theme),
            theme,
          );
          const requests: string[] = [];
          page.on('request', (r) => requests.push(r.url()));
          await page.goto('/desktop.html');
          await expectDesktopNavigation(page, lang);
          const origin = new URL(page.url()).origin;
          const shot = async (name: string) => {
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeLessThanOrEqual(width);
            if (folder)
              await page.screenshot({
                path: join(
                  folder,
                  `desktop-${name}-${lang}-${theme}-${width}.png`,
                ),
              });
          };
          const nav = async (key: keyof typeof catalogs.en) => {
            await page
              .getByRole('navigation')
              .getByRole('button', { name: catalogs[lang][key], exact: true })
              .click();
          };
          await nav('desktop.setup');
          await expect(page.getByTestId('desktop-setup')).toBeVisible();
          await shot('setup');
          await nav('desktop.monitor');
          await bridge.push(runView('running', 20));
          await expect(page.getByTestId('desktop-monitor')).toHaveAttribute(
            'data-phase',
            'running',
          );
          await shot('monitor');
          await bridge.push(runView('idle', 21));
          await nav('desktop.data');
          await expect(page.getByTestId('data-folder')).toBeVisible();
          await expect(
            page.getByTestId('desktop-updates').getByRole('button', {
              name: catalogs[lang]['desktop.updates.check'],
              exact: true,
            }),
          ).toBeVisible();
          await shot('settings');
          await page.evaluate(() => {
            window.addEventListener(
              'socialprune:data-removal-request',
              (event) => {
                const request = JSON.parse(
                  (event as CustomEvent<string>).detail,
                ) as { id: string; type: string };
                if (request.type === 'preview')
                  window.dispatchEvent(
                    new CustomEvent('socialprune:data-removal-reply', {
                      detail: JSON.stringify({
                        type: 'preview',
                        id: request.id,
                        token: '41fe1162-3704-46fd-a84a-19f087683ee0',
                        root: 'Generated app data',
                        expiresAt: '2026-10-25T23:00:00Z',
                        rows: [
                          {
                            name: 'workspace/socialprune.sqlite',
                            bytes: 4096,
                            disposition: 'remove',
                            reason: 'managed',
                          },
                          {
                            name: 'backup.json',
                            bytes: 100,
                            disposition: 'retain',
                            reason: 'backup',
                          },
                        ],
                        groups: [
                          'workspace',
                          'profile-x',
                          'profile-instagram',
                          'logs',
                          'settings',
                        ].map((kind) => ({
                          kind,
                          bytes: kind === 'workspace' ? 4096 : 0,
                        })),
                      }),
                    }),
                  );
              },
            );
          });
          await page
            .getByRole('button', {
              name: catalogs[lang]['desktop.removal.preview'],
              exact: true,
            })
            .click();
          const removal = page.getByRole('dialog', {
            name: catalogs[lang]['desktop.removal.title'],
            exact: true,
          });
          await expect(removal).toContainText('backup.json');
          await removal.evaluate(async (node) => {
            window.scrollBy(
              0,
              node.parentElement!.querySelector('h2')!.getBoundingClientRect()
                .top - 16,
            );
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            );
          });
          const title = await removal
            .locator('..')
            .getByRole('heading')
            .boundingBox();
          expect(title!.y).toBeGreaterThanOrEqual(0);
          expect(title!.y + title!.height).toBeLessThanOrEqual(
            width === 1280 ? 800 : 844,
          );
          await shot('removal');
          await expect(
            removal.getByRole('button', {
              name: catalogs[lang]['desktop.removal.confirm'],
              exact: true,
            }),
          ).toBeDisabled();
          await removal.getByRole('textbox').scrollIntoViewIfNeeded();
          await shot('removal-confirm');
          await checkAccessibility(page, context);
          expect(
            requests.filter((url) => new URL(url).origin !== origin),
          ).toEqual([]);
        } finally {
          await bridge.close();
        }
      });
