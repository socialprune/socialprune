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
  // FIT-1 targets web/local review; the desktop shell's geometry is unchanged.
  if (await page.locator('main[data-reading="true"]').count()) {
    const geometry = await feed.locator('article').evaluate((card) => {
      const root = document.scrollingElement!;
      return {
        overflow: root.scrollHeight - root.clientHeight,
        top: card.getBoundingClientRect().top,
        bottom: card.getBoundingClientRect().bottom,
        height: innerHeight,
        actions: ['keep', 'later', 'mark'].map((action) => {
          const box = card
            .querySelector(`[data-${action}-action]`)!
            .getBoundingClientRect();
          return { top: box.top, bottom: box.bottom };
        }),
      };
    });
    expect(geometry.overflow).toBeLessThanOrEqual(0);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
    for (const action of geometry.actions) {
      expect(action.top).toBeGreaterThanOrEqual(0);
      expect(action.bottom).toBeLessThanOrEqual(geometry.height);
    }
  }
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
  const desktopClickList = page
    .getByRole('navigation')
    .getByRole('button', { name: 'Click list', exact: true });
  if (await desktopClickList.isVisible()) await desktopClickList.click();
  else
    await page
      .getByRole('navigation', { name: 'Primary navigation', exact: true })
      .getByRole('link', { name: 'Delete', exact: true })
      .click();
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
