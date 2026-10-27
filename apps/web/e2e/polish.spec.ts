import { test } from '@playwright/test';
import { headerFixture } from './header-style.ts';
import { generatedReadPost, restoreLiveFeed } from './feed-fixture.ts';
import { generatedOriginal } from './original-text-fixture.ts';
import { assertPolish } from './polish-style.ts';
import { toolbarIsOneRow } from './toolbar-geometry.ts';
import { expect } from '@playwright/test';

for (const theme of ['light', 'dark'] as const)
  for (const width of [1280, 1366, 1920])
    for (const platform of ['x', 'instagram'] as const)
      test(`web ${platform} ${theme} ${width}`, async ({ page }, info) => {
        await page.setViewportSize({
          width,
          height: width === 1920 ? 900 : 768,
        });
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript((theme) => {
          localStorage.setItem('sp-locale', 'en');
          localStorage.setItem('sp-theme', theme);
        }, theme);
        const data = headerFixture();
        data.settings.review!.accountKey =
          platform === 'instagram' ? 'instagram:feed' : 'x:feed';
        data.settings.review!.feed!.tab = 'all';
        if (platform === 'x') {
          const item = data.items.find((item) => item.id === 'x:feed-1')!;
          item.createdAt = '2025-02-01T00:00:00.000Z';
          item.kind = 'reply';
          item.reference.replyToId = '81001';
          item.reference.replyToHandle = 'generated_author';
        }
        await restoreLiveFeed(
          page,
          data,
          undefined,
          platform === 'instagram' ? [generatedReadPost()] : [],
        );
        if (platform === 'x') {
          await page.evaluate((original) => {
            window.workspace.getOriginals = () => Promise.resolve([original]);
          }, generatedOriginal());
          await page
            .getByRole('tab', { name: /^Suggested for deletion,/ })
            .click();
          await page.getByRole('tab', { name: /^All,/ }).click();
        }
        for (const single of [true, false]) {
          await page
            .getByRole('button', {
              name: single ? 'One at a time' : 'List',
              exact: true,
            })
            .click();
          await assertPolish(page, info, platform);
        }
      });

test('toolbar guard accepts native height and rejects actual second rows', async ({
  page,
}) => {
  await restoreLiveFeed(page, headerFixture(), undefined, [
    generatedReadPost(),
  ]);
  await expect.poll(() => toolbarIsOneRow(page)).toBe(true);
  const toolbar = page.locator('[data-feed-toolbar]');
  await toolbar.evaluate((node) => {
    (node as HTMLElement).style.height = '90px';
  });
  expect(await toolbarIsOneRow(page)).toBe(true);
  await toolbar.evaluate((node) => {
    (node as HTMLElement).style.flexDirection = 'column';
  });
  expect(await toolbarIsOneRow(page)).toBe(false);
});
