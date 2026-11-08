import { expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { BrowserContext, Page } from 'playwright-core';
import { backgroundPage, contextPages, ContextPagesSchema } from './pages.ts';

test.each([false, true])(
  'PLACEMENT target creation is background and same-window mismatch %s fails closed',
  async (foreignWindow) => {
    const anchor = { isClosed: () => false };
    const page = {
      isClosed: () => false,
      close: vi.fn().mockResolvedValue(undefined),
    };
    const send = vi
      .fn()
      .mockImplementation((method: string, args?: { targetId?: string }) => {
        if (method === 'Target.getTargetInfo')
          return Promise.resolve({
            targetInfo: {
              targetId: 'anchor',
              browserContextId: 'generated-context',
            },
          });
        if (method === 'Browser.getWindowForTarget')
          return Promise.resolve({
            windowId: args?.targetId && foreignWindow ? 2 : 1,
          });
        if (method === 'Target.createTarget')
          return Promise.resolve({ targetId: 'created' });
        throw new Error('UNEXPECTED_CDP_METHOD');
      });
    const context = {
      pages: () => [anchor],
      newCDPSession: (value: unknown) =>
        Promise.resolve({
          send:
            value === anchor
              ? send
              : () => Promise.resolve({ targetInfo: { targetId: 'created' } }),
          detach: () => Promise.resolve(),
        }),
      waitForEvent: async (
        _name: string,
        options: { predicate: (page: unknown) => Promise<boolean> },
      ) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(await options.predicate(page)).toBe(true);
        return page;
      },
    } as unknown as BrowserContext;
    if (foreignWindow) {
      await expect(backgroundPage(context)).rejects.toMatchObject({
        token: 'unexpected-page',
      });
      expect(page.close).toHaveBeenCalledOnce();
    } else expect(await backgroundPage(context)).toBe(page);
    expect(send).toHaveBeenCalledWith('Target.createTarget', {
      url: 'about:blank',
      background: false,
      focus: false,
      newWindow: false,
      browserContextId: 'generated-context',
    });
    expect(
      send.mock.calls.some(
        ([method]) =>
          method === 'Target.activateTarget' || method === 'Page.bringToFront',
      ),
    ).toBe(false);
  },
);

test('PLACEMENT page report refuses fabricated or over-limit counts', () => {
  const counts = {
    startupClosed: 0,
    unexpectedOpened: 0,
    pageLimit: 3,
    ownedOpen: 2,
    ownedPeak: 2,
    backgroundCreated: 3,
    replaced: 1,
    rendererResets: 0,
  };
  expect(ContextPagesSchema.safeParse(counts).success).toBe(true);
  expect(
    ContextPagesSchema.safeParse({ ...counts, ownedPeak: 4 }).success,
  ).toBe(false);
  expect(
    ContextPagesSchema.safeParse({
      ...counts,
      title: 'Generated private title',
    }).success,
  ).toBe(false);
});

test('D3 reset admits only an exact owned main-frame GET and removes its route after failure', async () => {
  const events = new EventEmitter();
  const frame = {};
  let closed = false;
  let handler!: (route: unknown) => Promise<void>;
  let resetUrl = '';
  const unroute = vi.fn().mockResolvedValue(undefined);
  const page = {
    isClosed: () => closed,
    close: () => {
      closed = true;
      return Promise.resolve();
    },
    mainFrame: () => frame,
    route: (url: string, value: typeof handler) => {
      resetUrl = url;
      handler = value;
      return Promise.resolve();
    },
    unroute,
    goto: async () => {
      for (const [method, navigation, requestFrame, permitted] of [
        ['GET', true, frame, true],
        ['POST', true, frame, false],
        ['GET', false, frame, false],
        ['GET', true, {}, false],
      ] as const) {
        const proceed = vi.fn().mockResolvedValue(undefined),
          abort = vi.fn().mockResolvedValue(undefined);
        await handler({
          request: () => ({
            method: () => method,
            isNavigationRequest: () => navigation,
            frame: () => requestFrame,
          }),
          continue: proceed,
          abort,
        });
        expect(proceed).toHaveBeenCalledTimes(permitted ? 1 : 0);
        expect(abort).toHaveBeenCalledTimes(permitted ? 0 : 1);
      }
      throw new Error('Generated reset navigation failure');
    },
  } as unknown as Page;
  const initial = { isClosed: () => false, close: () => Promise.resolve() };
  const context = Object.assign(events, {
    pages: () => [initial],
  }) as unknown as BrowserContext;
  const boundary = contextPages(
    context,
    () => {},
    () => Promise.resolve(page),
  );
  try {
    await expect(boundary.resetRenderer(initial as Page, 1500)).rejects.toThrow(
      'CONTEXT_PAGE_NOT_OWNED',
    );
    await boundary.startupPage();
    await expect(boundary.resetRenderer(page, 1500)).rejects.toThrow(
      'Generated reset navigation failure',
    );
    expect(new URL(resetUrl).hostname).toBe('localhost');
    expect(new URL(resetUrl).pathname).toBe('/reader-reset');
    expect(unroute).toHaveBeenCalledWith(resetUrl, handler);
    expect(boundary.snapshot().rendererResets).toBe(0);
    await expect(fetch(resetUrl)).rejects.toThrow();
  } finally {
    boundary.dispose();
  }
});

test('startup pages close without navigation; a late page closes and fails exact ownership', async () => {
  const events = new EventEmitter(),
    failures: string[] = [];
  const make = () => {
    let closed = false;
    return {
      url: () => 'about:blank',
      isClosed: () => closed,
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    } as unknown as Page;
  };
  const local = make(),
    extra = make(),
    open = [local, extra];
  const context = Object.assign(events, {
    pages: () => open,
    newPage: () => {
      const page = make();
      events.emit('page', page);
      return Promise.resolve(page);
    },
  }) as unknown as BrowserContext;
  const boundary = contextPages(
    context,
    (error) => failures.push(error.token),
    () => context.newPage(),
  );
  const confirmation = await boundary.startupPage();
  expect(confirmation).not.toBe(local);
  expect(extra.isClosed()).toBe(true);
  expect(local.isClosed()).toBe(true);
  expect(confirmation.isClosed()).toBe(false);
  const reading = await boundary.newPage();
  expect(await boundary.allowed(reading)).toBe(true);
  const foreign = make();
  events.emit('page', foreign);
  await expect(boundary.flush()).rejects.toMatchObject({
    token: 'unexpected-page',
  });
  expect(foreign.isClosed()).toBe(true);
  expect(boundary.counts).toMatchObject({
    startupClosed: 2,
    unexpectedOpened: 1,
  });
  expect(failures).toEqual(['unexpected-page']);
  boundary.dispose();
  expect(events.listenerCount('page')).toBe(0);
});
test('page close failure is a closed stop, not a successful startup-closed count', async () => {
  const events = new EventEmitter(),
    local = {
      url: () => 'about:blank',
      isClosed: () => false,
    } as unknown as Page;
  const extra = {
    url: () => 'https://www.instagram.com/',
    isClosed: () => false,
    close: () =>
      Promise.reject(new Error('Generated private page close failure')),
  } as unknown as Page;
  const context = Object.assign(events, {
    pages: () => [extra],
    newPage: () => {
      events.emit('page', local);
      return Promise.resolve(local);
    },
  }) as unknown as BrowserContext;
  const boundary = contextPages(
    context,
    () => {},
    () => context.newPage(),
  );
  try {
    await expect(boundary.startupPage()).rejects.toThrow('Generated private');
    expect(boundary.counts.startupClosed).toBe(0);
    expect(() => boundary.check()).toThrow();
  } finally {
    boundary.dispose();
  }
});
test('a context with no blank page closes every restored page and creates its own confirmation without navigating them', async () => {
  const events = new EventEmitter(),
    closed: string[] = [];
  const restored = ['generated-restored-one', 'generated-restored-two'].map(
    (name) =>
      ({
        url: () => 'https://www.instagram.com/' + name,
        isClosed: () => false,
        close: () => {
          closed.push(name);
          return Promise.resolve();
        },
      }) as unknown as Page,
  );
  const blank = {
    url: () => 'about:blank',
    isClosed: () => false,
    close: () => Promise.resolve(),
  } as unknown as Page;
  const context = Object.assign(events, {
    pages: () => restored,
    newPage: () => {
      events.emit('page', blank);
      return Promise.resolve(blank);
    },
  }) as unknown as BrowserContext;
  const boundary = contextPages(
    context,
    () => {},
    () => context.newPage(),
  );
  try {
    expect(await boundary.startupPage()).toBe(blank);
    expect(closed).toEqual([
      'generated-restored-two',
      'generated-restored-one',
    ]);
    expect(boundary.counts).toMatchObject({
      startupClosed: 2,
      unexpectedOpened: 0,
    });
  } finally {
    boundary.dispose();
  }
});
test('an unowned page racing an authorized creation is never mistaken for the created Page identity', async () => {
  const events = new EventEmitter();
  const page = () => {
    let closed = false;
    return {
      url: () => 'about:blank',
      isClosed: () => closed,
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    } as unknown as Page;
  };
  const local = page(),
    foreign = page(),
    reading = page(),
    confirmation = page();
  let created = false;
  const context = Object.assign(events, {
    pages: () => [local],
    newPage: () => {
      if (!created) {
        created = true;
        events.emit('page', confirmation);
        return Promise.resolve(confirmation);
      }
      events.emit('page', foreign);
      events.emit('page', reading);
      return Promise.resolve(reading);
    },
  }) as unknown as BrowserContext;
  const boundary = contextPages(
    context,
    () => {},
    () => context.newPage(),
  );
  try {
    await boundary.startupPage();
    expect(await boundary.newPage()).toBe(reading);
    await expect(boundary.flush()).rejects.toMatchObject({
      token: 'unexpected-page',
    });
    expect(foreign.isClosed()).toBe(true);
    expect(reading.isClosed()).toBe(false);
  } finally {
    boundary.dispose();
  }
});

test('C35 IG19 replaces only an explicitly owned page and forgets its old page identity', async () => {
  const events = new EventEmitter();
  const make = () => {
    let closed = false;
    return {
      isClosed: () => closed,
      close: async () => {
        await Promise.resolve();
        closed = true;
      },
    } as unknown as Page;
  };
  const initial = make(),
    created: Page[] = [];
  const context = Object.assign(events, {
    pages: () => [initial],
    newPage: async () => {
      await Promise.resolve();
      const page = make();
      created.push(page);
      events.emit('page', page);
      return page;
    },
  }) as unknown as BrowserContext;
  const boundary = contextPages(
    context,
    () => {},
    () => context.newPage(),
  );
  try {
    const anchor = await boundary.startupPage();
    const reading = await boundary.newPage();
    const replacement = await boundary.replace(reading);
    expect(reading.isClosed()).toBe(true);
    expect(replacement.isClosed()).toBe(false);
    expect(anchor.isClosed()).toBe(false);
    expect(created).toHaveLength(3);
    expect(await boundary.allowed(replacement)).toBe(true);
    await expect(boundary.replace(make())).rejects.toThrow(
      'CONTEXT_PAGE_NOT_OWNED',
    );
    expect(boundary.snapshot()).toEqual({
      startupClosed: 1,
      unexpectedOpened: 0,
      pageLimit: 3,
      ownedOpen: 2,
      ownedPeak: 3,
      backgroundCreated: 3,
      replaced: 1,
      rendererResets: 0,
    });
  } finally {
    boundary.dispose();
  }
});
