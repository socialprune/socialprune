import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Injected only by browser tests, never reachable from a production entry. */
export async function checkFastFeed(page: Page) {
  const feed = page.getByRole('feed');
  await expect(feed).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('tab', { name: /^All,/ }).click();
  const single = page.getByRole('button', {
    name: 'One at a time',
    exact: true,
  });
  await single.click();
  await expect(feed.locator('article')).toHaveCount(1);
  await page.evaluate(() => {
    const request = window.workspace.request.bind(window.workspace);
    const releases: (() => void)[] = [];
    Reflect.set(window, '__fastRelease', () => releases.shift()?.());
    Reflect.set(window, '__fastReject', false);
    window.workspace.request = async (input, transfer) => {
      if (input.type === 'decide') {
        await new Promise<void>((resolve) => releases.push(resolve));
        if (Reflect.get(window, '__fastReject'))
          return {
            type: 'failed',
            requestId: input.requestId,
            code: 'STORAGE',
          };
      }
      return request(input, transfer);
    };
  });
  const first = await feed.locator('article').getAttribute('data-card-id');
  await feed.locator('[data-keep-action]').click();
  await expect(feed.locator('article')).not.toHaveAttribute(
    'data-card-id',
    first!,
  );
  await expect(feed.locator('[data-keep-action]')).toBeEnabled();
  const second = await feed.locator('article').getAttribute('data-card-id');
  await expect(page.getByRole('status')).toContainText('still being saved');
  const leave = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(leave).toBe(true);
  await page.evaluate(() => {
    Reflect.set(window, '__fastReject', true);
    (Reflect.get(window, '__fastRelease') as () => void)();
  });
  await expect(feed.locator('article')).toHaveAttribute('data-card-id', first!);
  await expect(feed.locator('article')).toHaveAttribute(
    'data-decision',
    'undecided',
  );
  await expect(page.getByRole('status')).toContainText(
    'The decision was not saved.',
  );
  await expect(feed.locator('article')).toBeFocused();
  await page.evaluate(() => Reflect.set(window, '__fastReject', false));
  await feed.locator('[data-mark-action]').click();
  await expect(feed.locator('article')).toHaveAttribute(
    'data-card-id',
    second!,
  );
  await page.evaluate(() =>
    (Reflect.get(window, '__fastRelease') as () => void)(),
  );
  await page.evaluate(() => window.workspace.flushCommands());
  await expect(
    page.getByRole('tab', { name: /^Marked,/ }),
  ).toHaveAccessibleName('Marked, 2 entries');
}
