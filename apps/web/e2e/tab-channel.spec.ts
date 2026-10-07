import { test, expect } from '@playwright/test';
import { restoreReview, reviewFixture } from './review-fixture.ts';

test('F22 malformed and foreign-workspace tab messages silently produce no refresh, reply or state change', async ({
  page,
}) => {
  const fixture = await restoreReview(page, reviewFixture('personal', false));
  const before = await page.evaluate(async () => {
    const revision = await window.workspace.request({
      type: 'revision',
      requestId: 'before-tab-noise',
    });
    Reflect.set(globalThis, '__tabPosts', []);
    window.workspace.worker.addEventListener(
      'message',
      (event: MessageEvent<unknown>) =>
        (Reflect.get(globalThis, '__tabPosts') as unknown[]).push(event.data),
    );
    const registry = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('sp-registry');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () =>
        reject(open.error ?? new Error('Registry read failed.'));
    });
    const workspaceId = await new Promise<string>((resolve, reject) => {
      const request = registry
        .transaction('pointers')
        .objectStore('pointers')
        .get('active');
      request.onsuccess = () => resolve(request.result as string);
      request.onerror = () =>
        reject(request.error ?? new Error('Pointer read failed.'));
    });
    registry.close();
    return { revision, workspaceId };
  });
  const generation = await page
    .getByTestId('review')
    .getAttribute('data-generation');
  await page.evaluate((workspaceId) => {
    const channel = new BroadcastChannel('sp-workspace');
    channel.postMessage({
      workspaceId,
      revision: 'not-a-revision',
      itemIds: 'many',
    });
    channel.postMessage({
      workspaceId: 'another-invented-workspace',
      revision: 999,
      itemIds: ['x:review-0000'],
    });
    channel.close();
  }, before.workspaceId);
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(
      () => Reflect.get(globalThis, '__tabPosts') as unknown[],
    ),
  ).toEqual([]);
  await expect(page.getByTestId('review')).toHaveAttribute(
    'data-generation',
    generation!,
  );
  const after = await page.evaluate(() =>
    window.workspace.request({
      type: 'revision',
      requestId: 'after-tab-noise',
    }),
  );
  expect(after).toMatchObject({
    ...before.revision,
    requestId: 'after-tab-noise',
  });
  const detail = await page.evaluate(
    (itemId) =>
      window.workspace.request({
        type: 'detail',
        requestId: 'unchanged-item',
        itemId,
      }),
    fixture.items[0]!.id,
  );
  expect(detail).toMatchObject({ type: 'itemDetail', events: [] });
});
