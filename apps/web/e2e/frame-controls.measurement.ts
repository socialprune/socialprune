import { expect, test } from '@playwright/test';
import { observeFeedFrames } from './frame-diagnostics.ts';
import { restoreLiveFeed, liveFeedFixture } from './feed-fixture.ts';

test('attribution captures controlled synchronous work and real React/virtualizer producers', async ({
  page,
}) => {
  const diagnostics = await observeFeedFrames(page);
  page.on('console', (message) => {
    if (message.type() === 'error')
      console.log('CONTROL_CONSOLE_ERROR', message.text());
  });
  page.on('pageerror', (error) =>
    console.log('CONTROL_PAGE_ERROR', error.message),
  );
  page.on('requestfailed', (request) =>
    console.log(
      'CONTROL_REQUEST_FAILED',
      new URL(request.url()).pathname,
      request.failure()?.errorText,
    ),
  );
  page.on('worker', (worker) => {
    console.log('CONTROL_WORKER', new URL(worker.url()).pathname);
    worker.on('close', () =>
      console.log('CONTROL_WORKER_CLOSED', new URL(worker.url()).pathname),
    );
  });
  await restoreLiveFeed(page, liveFeedFixture(400));
  await diagnostics.start();
  await page.getByRole('tab', { name: /^All/ }).click();
  await expect(page.getByRole('feed')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('feed').locator('article').first().focus();
  await page.keyboard.press('ArrowDown');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          const probe = Reflect.get(window, '__spFrameAttribution') as {
            measure: <T>(kind: string, callback: () => T) => T;
          };
          probe.measure('generated-control', () => {
            const until = performance.now() + 65;
            while (performance.now() < until) {
              /* Deliberate generated diagnostic control. */
            }
          });
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
      ),
  );
  const result = await diagnostics.read();
  const frame = result.frames.find((frame) =>
    frame.work.some((work) => work.kind === 'generated-control'),
  );
  expect(frame).toBeDefined();
  expect(frame!.deltaMs).toBeGreaterThan(50);
  expect(frame!.exclusiveByKind['generated-control']).toBeGreaterThan(50);
  expect(result.coverage['react-commit']?.calls).toBeGreaterThan(0);
  expect(
    result.coverage['scheduler-messageport-callback']?.calls,
  ).toBeGreaterThan(0);
  expect(result.coverage['feed-count-window-update']?.calls).toBeGreaterThan(0);
  expect(result.coverage['worker-message-handler']?.calls).toBeGreaterThan(0);
  expect(
    Object.keys(result.coverage).some((kind) =>
      kind.startsWith('virtualizer-'),
    ),
  ).toBe(true);
});
