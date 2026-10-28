import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeContextFixture } from '../../cli/src/review/test/context-fixture.ts';
import { startReviewServer } from '../../cli/src/review/server.ts';
import { reviewAssetDirectory } from '../../cli/src/review/static.ts';
import { assertPolish } from './polish-style.ts';

for (const theme of ['light', 'dark'] as const)
  for (const width of [1366, 1920])
    test(`local instagram ${theme} ${width}`, async ({ page }, info) => {
      const workspace = await mkdtemp(join(tmpdir(), 'socialprune-polish-'));
      await writeContextFixture(workspace, undefined, true);
      const server = await startReviewServer({
        workspace,
        assetDirectory: reviewAssetDirectory(),
        handleSignals: false,
        // eslint-disable-next-line no-restricted-properties -- Test-only review port.
        port: Number(process.env['SP_REVIEW_E2E_PORT'] ?? '4234'),
      });
      try {
        await page.setViewportSize({
          width,
          height: width === 1920 ? 900 : 768,
        });
        await page.addInitScript((theme) => {
          localStorage.setItem('sp-locale', 'en');
          localStorage.setItem('sp-theme', theme);
        }, theme);
        await page.goto(server.launchUrl);
        await page
          .getByRole('navigation', { name: 'Primary navigation', exact: true })
          .getByRole('link', { name: 'Review', exact: true })
          .click();
        await page.getByRole('tab', { name: /^All,/ }).click();
        await expect(
          page.getByRole('feed').locator('article').first(),
        ).toBeVisible();
        for (const single of [true, false]) {
          await page
            .getByRole('button', {
              name: single ? 'One at a time' : 'List',
              exact: true,
            })
            .click();
          await assertPolish(page, info, 'instagram');
        }
      } finally {
        await page.goto('about:blank');
        await server.stop();
        await rm(workspace, { recursive: true, force: true });
      }
    });
