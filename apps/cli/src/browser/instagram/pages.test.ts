import { expect, test } from 'vitest';
import { EventEmitter } from 'node:events';
import type { BrowserContext, Page } from 'playwright-core';
import { contextPages } from './pages.ts';

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
  const boundary = contextPages(context, (error) => failures.push(error.token));
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
  expect(boundary.counts).toEqual({ startupClosed: 2, unexpectedOpened: 1 });
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
  const boundary = contextPages(context, () => {});
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
  const boundary = contextPages(context, () => {});
  try {
    expect(await boundary.startupPage()).toBe(blank);
    expect(closed).toEqual([
      'generated-restored-one',
      'generated-restored-two',
    ]);
    expect(boundary.counts).toEqual({ startupClosed: 2, unexpectedOpened: 0 });
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
  const boundary = contextPages(context, () => {});
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
  const boundary = contextPages(context, () => {});
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
    expect(boundary.counts).toEqual({ startupClosed: 1, unexpectedOpened: 0 });
  } finally {
    boundary.dispose();
  }
});
