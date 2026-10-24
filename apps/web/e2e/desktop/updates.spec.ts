import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import { fakeBridge } from './fake-bridge.ts';

test('updates open only after a click; Store has no button; settings in both languages and themes', async ({
  browser,
}) => {
  const screenshots = join(tmpdir(), 'socialprune-upd1');
  await mkdir(screenshots, { recursive: true });
  for (const locale of ['en', 'de']) {
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: { width: 1100, height: 1000 },
        colorScheme,
      });
      const page = await context.newPage();
      const bridge = await fakeBridge(page, locale, undefined, 'direct');
      const remote: string[] = [];
      page.on('request', (request) => {
        if (
          new URL(request.url()).origin !==
          new URL(test.info().project.use.baseURL!).origin
        )
          remote.push(request.url());
      });
      try {
        await page.goto('/desktop.html');
        await page
          .getByRole('button', {
            name: locale === 'en' ? 'Data and backups' : 'Daten und Backups',
            exact: true,
          })
          .click();
        const updates = page.getByTestId('desktop-updates');
        await expect(updates).toContainText(
          locale === 'en'
            ? 'Installed version: 1.2.3'
            : 'Installierte Version: 1.2.3',
        );
        await expect(updates).toContainText('SHA-256');
        expect(
          bridge.requests.filter((request) => request.type === 'openLink'),
        ).toEqual([]);
        await page.getByTestId('desktop-settings').screenshot({
          path: join(screenshots, `settings-${locale}-${colorScheme}.png`),
        });
        await updates
          .getByRole('button', {
            name: locale === 'en' ? 'Check for updates' : 'Nach Updates suchen',
            exact: true,
          })
          .click();
        expect(
          bridge.requests.filter((request) => request.type === 'openLink'),
        ).toMatchObject([
          {
            type: 'openLink',
            link: {
              kind: 'app-releases',
              url: 'https://github.com/socialprune/socialprune/releases',
            },
          },
        ]);
        expect(remote).toEqual([]);
      } finally {
        await bridge.close();
        await context.close();
      }
    }
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  const store = await fakeBridge(page, 'en', undefined, 'store');
  try {
    await page.goto('/desktop.html');
    await page
      .getByRole('button', { name: 'Data and backups', exact: true })
      .click();
    await expect(page.getByTestId('desktop-updates')).toContainText(
      'The Microsoft Store updates this app.',
    );
    await expect(
      page.getByTestId('desktop-updates').getByRole('button'),
    ).toHaveCount(0);
    expect(
      store.requests.filter((request) => request.type === 'openLink'),
    ).toEqual([]);
  } finally {
    await store.close();
    await context.close();
  }
});
