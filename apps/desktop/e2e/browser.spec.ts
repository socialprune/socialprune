import { createServer } from 'node:http';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { assertNoRemainingProcesses } from '../test/windows.ts';
import { launch } from './helpers.ts';

test('packaged utility starts Playwright from asar, opens and closes only disposable Chromium', async () => {
  // This checks packaged browser capability, not archive import or review.
  const app = await launch('probe', false);
  const server = createServer((_request, response) =>
    response.end(
      '<!doctype html><title>Generated desktop browser probe</title>',
    ),
  );
  // Serial browser tests reserve 4666; bind before dispatch so a foreign
  // listener fails this test rather than being contacted or stopped.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(4666, '127.0.0.1', resolve);
  });
  const profile = join(app.data, 'browser-probe');
  try {
    const result =
      await test.step('utility launches, reads and closes Chromium', () =>
        app.application.evaluate(
          async (_electron, options) => {
            const state = Reflect.get(globalThis, 'desktopProbe') as {
              engine: {
                child: {
                  on(event: string, listener: (message: unknown) => void): void;
                  once(event: string, listener: () => void): void;
                  removeListener(
                    event: string,
                    listener: (...args: never[]) => void,
                  ): void;
                  postMessage(message: unknown): void;
                };
              };
            };
            const child = state.engine.child;
            return new Promise((resolve, reject) => {
              const clean = () => {
                clearTimeout(timer);
                child.removeListener('message', receive);
                child.removeListener('exit', exited);
              };
              const receive = (message: unknown) => {
                if (
                  !message ||
                  typeof message !== 'object' ||
                  Reflect.get(message, 'type') !== 'browserProbeResult'
                )
                  return;
                clean();
                resolve(message);
              };
              const exited = () => {
                clean();
                reject(new Error('BROWSER_PROBE_ENGINE_EXITED'));
              };
              // Match the existing Chromium launch budget instead of waiting
              // forever when the utility cannot return its probe result.
              const timer = setTimeout(() => {
                clean();
                reject(new Error('BROWSER_PROBE_TIMEOUT'));
              }, 30_000);
              child.on('message', receive);
              child.once('exit', exited);
              child.postMessage({
                type: 'browserProbe',
                ...options,
              });
            });
          },
          {
            executable: chromium.executablePath(),
            profile,
            url: 'http://127.0.0.1:4666/',
          },
        ));
    expect(result).toMatchObject({
      type: 'browserProbeResult',
      title: 'Generated desktop browser probe',
      closed: true,
    });
    const pids = (result as { pids: number[] }).pids;
    expect(pids.length).toBeGreaterThanOrEqual(2);
    await test.step('verify owned Chromium process cleanup', () =>
      assertNoRemainingProcesses(pids));
    console.log(
      JSON.stringify({
        proof: 'packaged-playwright',
        result,
        remainingOwnedBrowsers: 0,
      }),
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await app.close();
  }
});
