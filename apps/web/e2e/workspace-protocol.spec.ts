import { test, expect } from '@playwright/test';
import { WorkspaceRequestSchema } from '@socialprune/core/workspace/protocol';
import {
  assertUnknownRequestReply,
  assertCanonicalWorkerPosts,
} from './protocol-assertions.ts';
import { waitForApp, fixtureZips, importFiles } from './helpers.ts';
import { reviewFixture } from './review-fixture.ts';

test('an unknown workspace request type is rejected by the shared protocol', async ({
  page,
}) => {
  await waitForApp(page);
  const input = {
    type: 'rowSources',
    requestId: 'unknown-row-side-channel',
    itemIds: [],
  };
  expect(WorkspaceRequestSchema.safeParse(input).success).toBe(false);
  const response = await page.evaluate(
    (message) =>
      new Promise<unknown>((resolve) => {
        const worker = window.workspace.worker;
        const receive = (event: MessageEvent<{ requestId?: string }>) => {
          if (event.data.requestId !== message.requestId) return;
          worker.removeEventListener('message', receive);
          resolve(event.data);
        };
        worker.addEventListener('message', receive);
        worker.postMessage(message);
      }),
    input,
  );
  assertUnknownRequestReply(response, input.requestId);
});

test('every observed workspace worker post is a shared reply or notification', async ({
  page,
}) => {
  const messages: unknown[] = [];
  await page.exposeFunction('__recordWorkspacePost', (message: unknown) =>
    messages.push(message),
  );
  await page.addInitScript(() => {
    const Original = Worker;
    globalThis.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes('workspace-worker')) return;
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          void (
            Reflect.get(globalThis, '__recordWorkspacePost') as (
              message: unknown,
            ) => Promise<void>
          )(event.data);
        });
      }
    };
  });
  const fixture = await fixtureZips('x', 'current-minimal');
  try {
    await waitForApp(page);
    await importFiles(page, fixture.files);
    const workspace = reviewFixture();
    await page.evaluate(
      (text) =>
        window.workspace.request({
          type: 'restore',
          requestId: 'valid-restore',
          file: new File([text], 'invented.json'),
        }),
      JSON.stringify(workspace),
    );
    await page.goto('/socialprune/#/review/list');
    await expect(page.getByRole('row').first()).toContainText(
      'Agent: Synthetic reviewer',
    );
    await page.getByRole('grid').focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('region', { name: 'Entry details' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Keep K', exact: true }).click();
    await expect(
      page.getByText('1 decision saved. Nothing was deleted on the platform.', {
        exact: true,
      }),
    ).toBeVisible();
    // This exact unknown request produced a raw rowSources post in 6e882f7.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const worker = window.workspace.worker;
          const receive = (event: MessageEvent<{ requestId?: string }>) => {
            if (event.data.requestId !== 'membership-probe') return;
            worker.removeEventListener('message', receive);
            resolve();
          };
          worker.addEventListener('message', receive);
          worker.postMessage({
            type: 'rowSources',
            requestId: 'membership-probe',
            itemIds: [],
          });
        }),
    );
    await expect
      .poll(
        () =>
          messages.filter(
            (message) =>
              (message as { requestId?: string }).requestId ===
              'membership-probe',
          ).length,
      )
      .toBe(1);
    expect(messages.length).toBeGreaterThan(10);
    assertCanonicalWorkerPosts(messages);
  } finally {
    await fixture.cleanup();
  }
});
