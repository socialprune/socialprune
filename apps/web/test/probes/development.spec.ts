import { test, expect } from '@playwright/test';

test('development mode alone permits HMR and visibly denies personal imports', async ({
  page,
}) => {
  const sockets: string[] = [];
  page.on('websocket', (socket) => sockets.push(socket.url()));
  await page.goto('/socialprune/');
  await expect(
    page.getByText('Development policy', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('main[data-gate]')).toHaveAttribute(
    'data-gate',
    'unavailable',
  );
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).toContain("script-src 'self' 'unsafe-inline'");
  expect(policy).toContain('ws://127.0.0.1:*');
  expect(policy).not.toContain('unsafe-eval');
  expect(policy).not.toContain('require-trusted-types-for');
  await expect.poll(() => sockets.length).toBe(1);
  expect(new URL(sockets[0]!).hostname).toBe('127.0.0.1');
  await page.goto('/socialprune/#/import');
  expect(await page.locator('input[type="file"]').count()).toBe(0);
});
