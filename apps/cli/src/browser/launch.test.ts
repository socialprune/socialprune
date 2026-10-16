import { EventEmitter } from 'node:events';
import { afterEach, expect, test, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { launchRunBrowser } from './launch.ts';
import { productionDriver } from './x/driver.ts';

const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('playwright-core', () => ({
  chromium: { launchPersistentContext: launch },
}));
afterEach(() => {
  vi.clearAllMocks();
});

function generatedContext() {
  const events = new EventEmitter();
  const inherited = {
    isClosed: () => false,
    close: vi.fn(() => Promise.resolve()),
  };
  const created = {
    isClosed: () => false,
    close: vi.fn(() => Promise.resolve()),
  };
  let open = true;
  const context = Object.assign(events, {
    pages: () => (open ? [inherited as unknown as Page] : []),
    newPage: vi.fn(() => Promise.resolve(created as unknown as Page)),
    route: vi.fn(() => Promise.resolve()),
    routeWebSocket: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => {
      open = false;
      events.emit('close');
      return Promise.resolve();
    }),
  });
  launch.mockResolvedValue(context);
  return { context, inherited, created };
}
test('installed-browser launch options are exact with and without placement and offline', async () => {
  const { context } = generatedContext();
  for (const offline of [false, true])
    for (const placement of [
      undefined,
      { x: 900, y: 0, width: 900, height: 1000 },
    ]) {
      expect(
        await launchRunBrowser(
          'generated-profile',
          'generated-browser',
          placement,
          offline,
        ),
      ).toBe(context);
      expect(launch).toHaveBeenLastCalledWith('generated-profile', {
        executablePath: 'generated-browser',
        headless: false,
        chromiumSandbox: true,
        ...(offline ? { offline: true } : {}),
        args: [
          '--enable-automation',
          ...(placement
            ? ['--window-position=900,0', '--window-size=900,1000']
            : []),
        ],
        serviceWorkers: 'block',
        ignoreDefaultArgs: ['--disable-infobars'],
      });
    }
});
test('production desktop driver retains the platform window until the person closes it', async () => {
  const { context } = generatedContext();
  const driver = await productionDriver({
    profile: 'generated-profile',
    executablePath: 'generated-browser',
    desktop: true,
    confirmationOrigin: '',
    record: () => Promise.resolve(),
  });
  let settled = false;
  const waiting = driver.close().then(() => {
    settled = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  try {
    expect(context.close).not.toHaveBeenCalled();
    expect(settled).toBe(false);
  } finally {
    await context.close();
    await waiting;
  }
  expect(settled).toBe(true);
});
test('production desktop driver creates its own page before closing inherited launch tabs', async () => {
  const { context, inherited } = generatedContext();
  await productionDriver({
    profile: 'generated-profile',
    executablePath: 'generated-browser',
    desktop: true,
    confirmationOrigin: '',
    record: () => Promise.resolve(),
  });
  expect(context.newPage).toHaveBeenCalledTimes(1);
  expect(inherited.close).toHaveBeenCalledWith({ runBeforeUnload: false });
  expect(context.newPage.mock.invocationCallOrder[0]!).toBeLessThan(
    inherited.close.mock.invocationCallOrder[0]!,
  );
  await context.close();
});
