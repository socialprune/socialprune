import { createServer } from 'node:http';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { assertNoRemainingProcesses } from '../test/windows.ts';
import { launch } from './helpers.ts';

test('packaged utility starts Playwright from asar, opens and closes only disposable Chromium', async () => {
  const app = await launch('probe');
  const server = createServer((_request, response) =>
    response.end(
      '<!doctype html><title>Generated desktop browser probe</title>',
    ),
  );
  // Serial browser tests reserve 4642; bind before dispatch so a foreign
  // listener fails this test rather than being contacted or stopped.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(4642, '127.0.0.1', resolve);
  });
  const profile = join(app.data, 'browser-probe');
  try {
    const result = await app.application.evaluate(
      async (_electron, options) => {
        const state = Reflect.get(globalThis, 'desktopProbe') as {
          engine: {
            child: {
              once(event: string, listener: (message: unknown) => void): void;
              postMessage(message: unknown): void;
            };
          };
        };
        return new Promise((resolve) => {
          state.engine.child.once('message', resolve);
          state.engine.child.postMessage({ type: 'browserProbe', ...options });
        });
      },
      {
        executable: chromium.executablePath(),
        profile,
        url: 'http://127.0.0.1:4642/',
      },
    );
    expect(result).toMatchObject({
      type: 'browserProbeResult',
      title: 'Generated desktop browser probe',
      closed: true,
    });
    const pids = (result as { pids: number[] }).pids;
    expect(pids.length).toBeGreaterThanOrEqual(2);
    await assertNoRemainingProcesses(pids);
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
