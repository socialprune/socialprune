import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediaFixture } from '../../../cli/src/engine/test/media-fixture.ts';
import { SQLiteStore } from '../../../cli/src/workspace/sqlite-store.ts';
import { readWorkspace } from '@socialprune/core/workspace/store';
import { fakeBridge } from './fake-bridge.ts';

test('fake bridge feed renders stored original and confirmed Instagram media using relative local IDs', async ({
  page,
}) => {
  const data = await mkdtemp(join(tmpdir(), 'sp-desktop-render-media-'));
  await page.setContent('<p>Generated screenshot fixture</p>');
  const jpeg = await page.screenshot({ type: 'jpeg' });
  const fixture = await mediaFixture(data, jpeg);
  const store = await SQLiteStore.open(
    join(fixture.workspace, 'socialprune.sqlite'),
  );
  const seed = await store.read(readWorkspace);
  await store.close();
  const bridge = await fakeBridge(page, 'en', seed);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  // Fake-bridge transport runs over the test HTTP origin, not Electron's app:
  // scheme. Adapt img-src only in this test response; packaged proof retains
  // the exact shipped app-only CSP and proves its private byte channel.
  await page.route('**/desktop.html', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll(
      'img-src app:',
      "img-src 'self'",
    );
    await route.fulfill({
      response,
      body,
      headers: {
        ...response.headers(),
        'content-security-policy': response
          .headers()
          ['content-security-policy']!.replace(
            'img-src app:',
            "img-src 'self'",
          ),
      },
    });
  });
  const allowed = new Map([
    [
      `/originals/${fixture.original.id}/1.png`,
      { bytes: fixture.png, type: 'image/png' },
    ],
    [
      `/context/instagram/${fixture.context.post.code}/image.png`,
      { bytes: fixture.png, type: 'image/png' },
    ],
    [
      `/context/instagram/${fixture.context.post.code}/shot.jpg`,
      { bytes: jpeg, type: 'image/jpeg' },
    ],
  ]);
  await page.route(/\/(?:originals|context)\//, (route) => {
    const file = allowed.get(new URL(route.request().url()).pathname);
    return route.fulfill({
      status: file ? 200 : 404,
      body: file?.bytes,
      contentType: file?.type,
    });
  });
  try {
    await page.goto('/desktop.html');
    await page.getByRole('tab', { name: /^All,/ }).click();
    await page
      .getByLabel('Account', { exact: true })
      .selectOption(fixture.item.account.key);
    await page.getByRole('tab', { name: /^All,/ }).click();
    const card = page.locator(`article[data-item-id="${fixture.item.id}"]`);
    await expect(card).toContainText(fixture.original.text!);
    await expect
      .poll(() =>
        card
          .locator('img')
          .first()
          .evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await page
      .getByLabel('Account', { exact: true })
      .selectOption(fixture.context.accountKey);
    await page.getByRole('tab', { name: /^All,/ }).click();
    const post = page
      .locator(`article[data-item-id="${fixture.context.itemId}"]`)
      .getByTestId('instagram-post');
    await expect(post).toContainText(fixture.context.post.owner);
    await post.getByRole('button', { name: 'Show screenshot' }).click();
    await expect(post.locator('img')).toHaveCount(2);
    for (const image of await post.locator('img').all())
      await expect
        .poll(() =>
          image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
    expect(
      bridge.requests.some((request) => request.type === 'getOriginals'),
    ).toBe(true);
    expect(
      bridge.requests.some((request) => request.type === 'getInstagramContext'),
    ).toBe(true);
    expect(
      requests.every(
        (url) => new URL(url).origin === new URL(page.url()).origin,
      ),
    ).toBe(true);
  } finally {
    await bridge.close();
    await rm(data, { recursive: true, force: true });
  }
});
