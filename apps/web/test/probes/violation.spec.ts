import { test, expect } from '@playwright/test';
import { DATA_WORKER_POLICY } from '../../src/sw/policies.ts';

test('a test-only live worker fetch is denied and the violation observer has a positive control', async ({
  page,
  context,
  request,
  browserName,
}) => {
  const live = await request.get('/socialprune/live-probe');
  expect(live.status()).toBe(200);
  expect(await live.text()).toBe('invented test response');
  const probes: string[] = [];
  context.on('request', (request) => {
    if (request.url().endsWith('/live-probe')) probes.push(request.url());
  });
  await page.addInitScript(() => {
    const policy = (
      globalThis as typeof globalThis & {
        trustedTypes: {
          createPolicy(
            name: string,
            rules: { createScriptURL(value: string): string },
          ): { createScriptURL(value: string): string };
        };
      }
    ).trustedTypes.createPolicy('socialprune-test', {
      createScriptURL(value) {
        const url = new URL(value, location.href);
        if (
          url.origin !== location.origin ||
          !url.pathname.startsWith('/socialprune/')
        )
          throw new TypeError('Test URL outside scope.');
        return url.href;
      },
    });
    Reflect.set(globalThis, '__probePolicy', policy);
    Reflect.set(globalThis, '__probeMessages', []);
  });
  // This isolated build's page policy lists a test-only policy name instead of
  // replacing production's policy. No probe file is built by normal mode.
  await page.goto('/socialprune/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.evaluate(() => {
    const policy = Reflect.get(globalThis, '__probePolicy') as {
      createScriptURL(value: string): string;
    };
    const worker = new Worker(
      policy.createScriptURL('/socialprune/probe-worker.js'),
      { type: 'module' },
    );
    Reflect.set(globalThis, '__probeWorker', worker);
    worker.onmessage = (event: MessageEvent<unknown>) =>
      (Reflect.get(globalThis, '__probeMessages') as unknown[]).push(
        event.data,
      );
    worker.postMessage({ url: `${location.origin}/socialprune/live-probe` });
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            Reflect.get(globalThis, '__probeMessages') as { type: string }[]
          ).filter(({ type }) => type === 'probe-result').length,
      ),
    )
    .toBe(1);
  const messages = await page.evaluate(
    () =>
      Reflect.get(globalThis, '__probeMessages') as {
        type: string;
        rejected?: boolean;
        violations?: number;
      }[],
  );
  expect(
    messages
      .filter(({ type }) => type === 'probe-result')
      .map(({ rejected }) => rejected),
  ).toEqual([true]);
  if (browserName !== 'webkit')
    expect(
      messages.filter(({ type }) => type === 'policy-violation'),
    ).toHaveLength(1);
  // The one live positive control is asserted before the separate cached and
  // off-origin denial branches, so its observer count cannot pass by addition.
  await page.evaluate(() => {
    const worker = Reflect.get(globalThis, '__probeWorker') as Worker;
    worker.postMessage({ url: `${location.origin}/socialprune/icon.svg` });
    worker.postMessage({ url: 'https://example.invalid/invented-probe' });
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            Reflect.get(globalThis, '__probeMessages') as { type: string }[]
          ).filter(({ type }) => type === 'probe-result').length,
      ),
    )
    .toBe(3);
  expect(
    await page.evaluate(() =>
      (
        Reflect.get(globalThis, '__probeMessages') as {
          type: string;
          rejected: boolean;
        }[]
      )
        .filter(({ type }) => type === 'probe-result')
        .map(({ rejected }) => rejected),
    ),
  ).toEqual([true, true, true]);
  // WebKit can omit the event: denial and the real response header remain
  // separate proof, never interpret the missing event as missing enforcement.
  expect(probes).toEqual([]);
  await page.evaluate(() =>
    (Reflect.get(globalThis, '__probeWorker') as Worker).terminate(),
  );
  const response = await page.goto('/socialprune/probe-worker.js');
  expect(response?.headers()['content-security-policy']).toBe(
    DATA_WORKER_POLICY,
  );
});
