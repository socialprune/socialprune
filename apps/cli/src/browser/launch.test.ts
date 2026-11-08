import { EventEmitter } from 'node:events';
import { afterEach, expect, test, vi } from 'vitest';
import type { Page } from 'playwright-core';
import {
  launchRunBrowser,
  parseWindowPlacement,
  windowArguments,
} from './launch.ts';
import { productionDriver } from './x/driver.ts';

const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('playwright-core', () => ({
  chromium: { launchPersistentContext: launch },
}));
afterEach(() => {
  vi.clearAllMocks();
});
test.each(['1940,20,1600,1000', '-1680,-20,1600,1000', '0,0,1,1'])(
  'PLACEMENT accepts explicit integer bounds %s',
  (value) => {
    const [x, y, width, height] = value.split(',').map(Number);
    expect(parseWindowPlacement(value)).toEqual({ x, y, width, height });
    expect(windowArguments(parseWindowPlacement(value))).toEqual([
      `--window-position=${x},${y}`,
      `--window-size=${width},${height}`,
    ]);
  },
);
test.each([
  '1,2,0,4',
  '1,2,-3,4',
  '1,2,3',
  '1,2,3,4,5',
  '1.5,2,3,4',
  '1, 2,3,4',
  '1e3,2,3,4',
  'NaN,2,3,4',
  '9007199254740992,2,3,4',
])('PLACEMENT rejects malformed bounds %s', (value) => {
  expect(() => parseWindowPlacement(value)).toThrow();
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
        ...(placement ? { viewport: null } : {}),
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

test('production desktop guards and request recording are installed before any fresh page or inherited-tab closure', async () => {
  const { context, inherited } = generatedContext();
  const observations: {
    routes: number;
    sockets: number;
    responseListeners: number;
  }[] = [];
  context.newPage.mockImplementation(() => {
    observations.push({
      routes: context.route.mock.calls.length,
      sockets: context.routeWebSocket.mock.calls.length,
      responseListeners: context.listenerCount('response'),
    });
    return Promise.resolve({ isClosed: () => false } as unknown as Page);
  });
  try {
    await productionDriver({
      profile: 'generated-profile',
      executablePath: 'generated-browser',
      desktop: true,
      record: () => Promise.resolve(),
    });
    expect(observations).toEqual([
      { routes: 2, sockets: 1, responseListeners: 1 },
    ]);
    for (const guardCall of [
      ...context.route.mock.invocationCallOrder,
      ...context.routeWebSocket.mock.invocationCallOrder,
    ]) {
      expect(guardCall).toBeLessThan(
        context.newPage.mock.invocationCallOrder[0]!,
      );
      expect(guardCall).toBeLessThan(
        inherited.close.mock.invocationCallOrder[0]!,
      );
    }
  } finally {
    await context.close();
  }
});

test('production CLI driver keeps the inherited confirmation page and does not create a platform page during setup', async () => {
  const { context, inherited } = generatedContext();
  try {
    await productionDriver({
      profile: 'generated-profile',
      executablePath: 'generated-browser',
      confirmationOrigin: 'http://127.0.0.1:4522',
      record: () => Promise.resolve(),
    });
    expect(context.newPage).not.toHaveBeenCalled();
    expect(inherited.close).not.toHaveBeenCalled();
    expect(context.route).toHaveBeenCalledTimes(2);
    expect(context.routeWebSocket).toHaveBeenCalledTimes(1);
    expect(context.listenerCount('response')).toBe(1);
  } finally {
    await context.close();
  }
});
