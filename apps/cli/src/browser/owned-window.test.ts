import { expect, test, vi } from 'vitest';
import { captureOwnedWindow } from './owned-window.ts';
import { createWindowOwner } from '../engine/window.ts';
import type { BrowserContext, Page } from 'playwright-core';

function fixture() {
  let finish!: () => void;
  const handlers = new Map<string, () => void>();
  let bounds = {
    left: 5000,
    top: 3000,
    width: 600,
    height: 400,
    windowState: 'normal',
  };
  let windowId = 71;
  const send = vi.fn((method: string) => {
    if (method === 'Browser.getWindowForTarget')
      return Promise.resolve({ windowId, bounds });
    if (method === 'Browser.getWindowBounds')
      return Promise.resolve({ bounds });
    return Promise.resolve({});
  });
  const attach = vi.fn(() =>
    Promise.resolve({ send, detach: vi.fn().mockResolvedValue(undefined) }),
  );
  const context = {
    once: (name: string, fn: () => void) => handlers.set(name, fn),
    newCDPSession: attach,
  } as unknown as BrowserContext;
  const page = {
    context: () => context,
    isClosed: () => false,
    once: (name: string, fn: () => void) => {
      finish = fn;
    },
  } as unknown as Page;
  return {
    context,
    attach,
    page,
    send,
    close: () => handlers.get('close')!(),
    pageClose: () => finish(),
    bounds: (value: typeof bounds) => {
      bounds = value;
    },
    replace: () => {
      windowId++;
    },
  };
}
test('an unowned page is refused before attaching CDP and an idle engine reports no window', async () => {
  const f = fixture();
  const foreign = fixture();
  await expect(captureOwnedWindow(f.context, foreign.page)).rejects.toThrow(
    'OWNED_WINDOW_UNAVAILABLE',
  );
  expect(f.attach).not.toHaveBeenCalled();
  expect(await createWindowOwner().request({ type: 'current' })).toEqual({
    type: 'window',
    value: null,
  });
});

test('a launched browser without a registered exact window refuses current until registration, rather than claiming absence', async () => {
  const f = fixture(),
    owner = createWindowOwner();
  let close!: () => void;
  owner.started(
    new Promise<void>((resolve) => {
      close = resolve;
    }),
  );
  expect(await owner.request({ type: 'current' })).toEqual({
    type: 'unavailable',
  });
  owner.register(await captureOwnedWindow(f.context, f.page));
  expect(await owner.request({ type: 'current' })).toMatchObject({
    type: 'window',
    value: { bounds: { x: 5000, y: 3000, width: 600, height: 400 } },
  });
  close();
  await Promise.resolve();
  expect(await owner.request({ type: 'current' })).toMatchObject({
    type: 'window',
    value: { bounds: { x: 5000 } },
  });
  f.close();
  await Promise.resolve();
  expect(await owner.request({ type: 'current' })).toEqual({
    type: 'window',
    value: null,
  });
});

test('a replacement owner during a pending bounds read prevents the old geometry write', async () => {
  const f = fixture(),
    cap = await captureOwnedWindow(f.context, f.page),
    owner = createWindowOwner();
  owner.register(cap);
  const first = await owner.request({ type: 'current' });
  if (first.type !== 'window' || !first.value) throw new Error('NO_OWNER');
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.send.mockImplementationOnce(() =>
    barrier.then(() => ({
      windowId: 71,
      bounds: {
        left: 5000,
        top: 3000,
        width: 600,
        height: 400,
        windowState: 'normal',
      },
    })),
  );
  const pending = owner.request({
    type: 'move',
    id: first.value.id,
    expected: first.value.bounds,
    bounds: { x: 1, y: 1, width: 600, height: 400 },
    activate: false,
    expiresAt: Date.now() + 5000,
  });
  const second = fixture();
  owner.register(await captureOwnedWindow(second.context, second.page));
  release();
  expect(await pending).toEqual({ type: 'unavailable' });
  expect(
    f.send.mock.calls.some(([name]) => name === 'Browser.setWindowBounds'),
  ).toBe(false);
  f.close();
  second.close();
});

test('valid owner moves only its bound ID, refuses activation/extra fields, and stale close cannot erase a newer owner', async () => {
  const f = fixture(),
    cap = await captureOwnedWindow(f.context, f.page),
    owner = createWindowOwner();
  owner.register(cap);
  const before = await owner.request({ type: 'current' });
  if (before.type !== 'window' || !before.value) throw new Error('NO_OWNER');
  const move = {
    type: 'move' as const,
    id: before.value.id,
    expected: before.value.bounds,
    bounds: { x: 10, y: 20, width: 600, height: 400 },
    activate: false as const,
    expiresAt: Date.now() + 5000,
  };
  expect(
    await owner.request({ ...move, activate: true } as unknown as typeof move),
  ).toEqual({ type: 'unavailable' });
  expect(
    await owner.request({ ...move, url: 'generated' } as typeof move),
  ).toEqual({ type: 'unavailable' });
  expect(await owner.request(move)).toEqual({ type: 'moved' });
  expect(
    f.send.mock.calls.filter(([name]) => name === 'Browser.setWindowBounds'),
  ).toHaveLength(1);
  const other = fixture(),
    second = await captureOwnedWindow(other.context, other.page);
  owner.register(second);
  f.close();
  await Promise.resolve();
  const next = await owner.request({ type: 'current' });
  if (next.type !== 'window' || !next.value) throw new Error('NO_NEW_OWNER');
  expect(next.value.id).not.toBe(before.value.id);
  other.close();
  await Promise.resolve();
  expect(await owner.request({ type: 'current' })).toEqual({
    type: 'window',
    value: null,
  });
});
test('ownership outlives run completion and ends only on actual context close, not page replacement', async () => {
  const f = fixture(),
    cap = await captureOwnedWindow(f.context, f.page),
    owner = createWindowOwner();
  owner.register(cap);
  const before = await owner.request({ type: 'current' });
  expect(before).toMatchObject({
    type: 'window',
    value: { bounds: { x: 5000, y: 3000 } },
  });
  // Engine task/view settlement has no ownership-clearing operation.
  expect(await owner.request({ type: 'current' })).toEqual(before);
  f.pageClose();
  expect(await owner.request({ type: 'current' })).toEqual({
    type: 'unavailable',
  });
  f.close();
  await Promise.resolve();
  expect(await owner.request({ type: 'current' })).toEqual({
    type: 'window',
    value: null,
  });
});
test('a different window ID, visible/user-moved bounds, nonnormal state and forged identity never move', async () => {
  for (const change of ['identity', 'bounds', 'state', 'id'] as const) {
    const f = fixture(),
      cap = await captureOwnedWindow(f.context, f.page),
      owner = createWindowOwner();
    owner.register(cap);
    const before = await owner.request({ type: 'current' });
    if (before.type !== 'window' || !before.value)
      throw new Error('NO_GENERATED_OWNER');
    if (change === 'identity') f.replace();
    if (change === 'bounds')
      f.bounds({
        left: 0,
        top: 0,
        width: 600,
        height: 400,
        windowState: 'normal',
      });
    if (change === 'state')
      f.bounds({
        left: 5000,
        top: 3000,
        width: 600,
        height: 400,
        windowState: 'minimized',
      });
    expect(
      await owner.request({
        type: 'move',
        id: change === 'id' ? crypto.randomUUID() : before.value.id,
        expected: before.value.bounds,
        bounds: { x: 100, y: 100, width: 600, height: 400 },
        activate: false,
        expiresAt: Date.now() + 5000,
      }),
    ).toEqual({ type: 'unavailable' });
    expect(
      f.send.mock.calls.some(
        ([method]) => method === 'Browser.setWindowBounds',
      ),
    ).toBe(false);
    f.close();
  }
});

test('expired or overlong move authority and expiry during a pending read never write geometry', async () => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    const owner = createWindowOwner();
    owner.register(await captureOwnedWindow(f.context, f.page));
    const before = await owner.request({ type: 'current' });
    if (before.type !== 'window' || !before.value) throw new Error('NO_OWNER');
    const move = {
      type: 'move' as const,
      id: before.value.id,
      expected: before.value.bounds,
      bounds: { x: 1, y: 1, width: 600, height: 400 },
      activate: false as const,
      expiresAt: Date.now(),
    };
    expect(await owner.request(move)).toEqual({ type: 'unavailable' });
    expect(
      await owner.request({ ...move, expiresAt: Date.now() + 5001 }),
    ).toEqual({ type: 'unavailable' });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.send.mockImplementationOnce(() =>
      barrier.then(() => ({
        windowId: 71,
        bounds: {
          left: 5000,
          top: 3000,
          width: 600,
          height: 400,
          windowState: 'normal',
        },
      })),
    );
    const pending = owner.request({ ...move, expiresAt: Date.now() + 100 });
    await vi.advanceTimersByTimeAsync(100);
    release();
    expect(await pending).toEqual({ type: 'unavailable' });
    expect(
      f.send.mock.calls.some(([name]) => name === 'Browser.setWindowBounds'),
    ).toBe(false);
  } finally {
    f.close();
    vi.useRealTimers();
  }
});
