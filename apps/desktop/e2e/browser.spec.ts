import { createServer } from 'node:http';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { assertNoRemainingProcesses } from '../test/windows.ts';
import type { ProcessIdentity } from '../test/windows.ts';
import { launch } from './helpers.ts';
import { PROCESS_POLL_TIMEOUT_MS } from '../packaging/query-poll.ts';
import { BROWSER_CLEANUP_TIMEOUT_MS } from '../test/windows.ts';
import { writeFile } from 'node:fs/promises';
import { dist } from '../packaging/paths.ts';
import { randomUUID } from 'node:crypto';

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
  let browserProcesses: ProcessIdentity[] = [];
  let failure: unknown;
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
            return new Promise((resolve) => {
              let processes: ProcessIdentity[] = [];
              const clean = () => {
                clearTimeout(timer);
                child.removeListener('message', receive);
                child.removeListener('exit', exited);
              };
              const receive = (message: unknown) => {
                if (
                  message &&
                  typeof message === 'object' &&
                  Reflect.get(message, 'type') === 'browserProbeStarted'
                ) {
                  processes = Reflect.get(
                    message,
                    'processes',
                  ) as ProcessIdentity[];
                  return;
                }
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
                resolve({
                  type: 'browserProbeResult',
                  error: 'BROWSER_PROBE_ENGINE_EXITED',
                  processes,
                });
              };
              // Existing 30 s Chromium allowance plus the current measured
              // identity-query budget; cleanup has its own grace below.
              const timer = setTimeout(() => {
                clean();
                resolve({
                  type: 'browserProbeResult',
                  error: 'BROWSER_PROBE_TIMEOUT',
                  processes,
                });
              }, options.timeoutMs);
              child.on('message', receive);
              child.once('exit', exited);
              child.postMessage({
                type: 'browserProbe',
                executable: options.executable,
                profile: options.profile,
                url: options.url,
              });
            });
          },
          {
            executable: chromium.executablePath(),
            profile,
            url: 'http://127.0.0.1:4666/',
            timeoutMs:
              30_000 + PROCESS_POLL_TIMEOUT_MS + BROWSER_CLEANUP_TIMEOUT_MS,
          },
        ));
    browserProcesses =
      (result as { processes?: ProcessIdentity[] }).processes ?? [];
    await writeFile(
      join(dist, `release-browser-probe-${randomUUID()}.json`),
      JSON.stringify(result),
    );
    console.log('BROWSER_PROBE_RECEIPT', JSON.stringify(result));
    expect(result).toMatchObject({
      type: 'browserProbeResult',
      title: 'Generated desktop browser probe',
      closed: true,
    });
    const pids = (result as { pids: number[] }).pids;
    const processes = (result as { processes: ProcessIdentity[] }).processes;
    expect(pids.length).toBeGreaterThanOrEqual(2);
    expect(processes.length).toBeGreaterThanOrEqual(2);
    await test.step('verify owned Chromium process cleanup', () =>
      assertNoRemainingProcesses(processes));
    console.log(
      JSON.stringify({
        proof: 'packaged-playwright',
        result,
        remainingOwnedBrowsers: 0,
      }),
    );
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    try {
      await app.close(browserProcesses);
    } catch (error) {
      if (failure)
        throw new AggregateError(
          [failure, error],
          'BROWSER_PROBE_AND_CLEANUP_FAILED',
        );
      throw error;
    }
  }
});
