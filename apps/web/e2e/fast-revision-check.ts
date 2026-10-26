import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function checkHistoryRecovery(
  page: Page,
  direction: 'back' | 'forward',
) {
  const feed = page.getByRole('feed');
  await expect(feed).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => {
    history.replaceState(null, '', '#/review');
    if (location.hash !== '#/review') throw Error('Review history seed failed');
    const request = window.workspace.request.bind(window.workspace);
    Reflect.set(window, '__revisionRelease', null);
    Reflect.set(window, '__revisionDecides', 0);
    window.workspace.request = async (input, transfer) => {
      if (input.type === 'decide') {
        Reflect.set(
          window,
          '__revisionDecides',
          Number(Reflect.get(window, '__revisionDecides')) + 1,
        );
        await new Promise<void>((resolve) =>
          Reflect.set(window, '__revisionRelease', resolve),
        );
        return { type: 'failed', requestId: input.requestId, code: 'STORAGE' };
      }
      return request(input, transfer);
    };
  });
  await page.getByRole('tab', { name: /^All,/ }).click();
  await expect(feed).toHaveAttribute('aria-busy', 'false');
  const card = feed.locator('article[data-card-id]').first(),
    id = await card.getAttribute('data-card-id');
  await card.locator('[data-keep-action]').click();
  await expect
    .poll(() =>
      page.evaluate(() => typeof Reflect.get(window, '__revisionRelease')),
    )
    .toBe('function');
  await page.evaluate((direction) => {
    if (direction === 'back') {
      history.replaceState(null, '', '#/archive');
      history.pushState(null, '', '#/review');
      history.back();
    } else {
      history.pushState(null, '', '#/archive');
      history.back();
    }
  }, direction);
  if (direction === 'forward') {
    await expect(page).toHaveURL(/#\/review$/);
    await page.evaluate(() => history.forward());
  }
  await expect(page).toHaveURL(/#\/archive$/);
  await expect(feed).toBeVisible();
  await page.evaluate(() =>
    (Reflect.get(window, '__revisionRelease') as () => void)(),
  );
  await expect(page).toHaveURL(/#\/review$/);
  await expect(page.getByRole('status')).toContainText(
    'The decision was not saved.',
  );
  const restored = feed.locator(`article[data-card-id="${id}"]`);
  await expect(restored).toHaveAttribute('data-decision', 'undecided');
  await restored.focus();
  await page.keyboard.press('m');
  await expect(restored).toHaveAttribute('data-decision', 'undecided');
  expect(
    await page.evaluate(() => Number(Reflect.get(window, '__revisionDecides'))),
  ).toBe(1);
  await page.waitForTimeout(550);
  await page.evaluate(() => {
    window.workspace.request = (input) => {
      if (input.type === 'decide') {
        Reflect.set(
          window,
          '__revisionDecides',
          Number(Reflect.get(window, '__revisionDecides')) + 1,
        );
        return Promise.resolve({
          type: 'committed',
          requestId: input.requestId,
          commandId: input.commandId,
          actionId: null,
          revision: 0,
          changed: 0,
          skipped: 1,
        });
      }
      throw Error('Only fresh decision test');
    };
  });
  await restored.focus();
  await page.keyboard.press('m');
  await expect
    .poll(() =>
      page.evaluate(() => Number(Reflect.get(window, '__revisionDecides'))),
    )
    .toBe(2);
  await page.evaluate(() => window.workspace.flushCommands());
}
