import { expect, test, vi } from 'vitest';
import { focusWhenReady } from './focus.ts';

function harness() {
  const frames = new Map<number, () => void>();
  let next = 0;
  let active: Element | null = null;
  let mounted = false;
  let focusable = false;
  const target = {
    isConnected: true,
    focus: vi.fn(() => {
      if (focusable) active = target as unknown as Element;
    }),
  };
  const complete = vi.fn(),
    scroll = vi.fn();
  const cancel = focusWhenReady({
    find: () => (mounted ? (target as unknown as HTMLElement) : undefined),
    active: () => active,
    scroll,
    frame: (callback) => {
      frames.set(++next, callback);
      return next;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
    complete,
  });
  const tick = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback();
  };
  return {
    target,
    frames,
    complete,
    scroll,
    cancel,
    tick,
    mount: () => {
      mounted = true;
    },
    allowFocus: () => {
      focusable = true;
    },
    detach: () => {
      target.isConnected = false;
      active = null;
    },
  };
}

test('waits for virtual mounting and retries a focus call ignored during layout', () => {
  const h = harness();
  expect(h.complete).not.toHaveBeenCalled();
  h.mount();
  h.tick();
  expect(h.target.focus).toHaveBeenCalledOnce();
  expect(h.complete).not.toHaveBeenCalled();
  h.allowFocus();
  h.tick();
  expect(h.complete).not.toHaveBeenCalled();
  h.tick();
  expect(h.complete).toHaveBeenCalledOnce();
  expect(h.frames.size).toBe(0);
});
test('a detached node never acknowledges completion and a newer request cancels retries', () => {
  const h = harness();
  h.mount();
  h.allowFocus();
  h.tick();
  h.detach();
  h.tick();
  expect(h.complete).not.toHaveBeenCalled();
  h.cancel();
  h.tick();
  expect(h.frames.size).toBe(0);
  expect(h.complete).not.toHaveBeenCalled();
});

test('focus is not complete while a layout shift leaves its target outside the panel', () => {
  const frames: (() => void)[] = [];
  const complete = vi.fn();
  let visible = false;
  const target = {
    isConnected: true,
    focus: vi.fn(),
    getBoundingClientRect: () => ({
      top: visible ? 10 : 1000,
      bottom: visible ? 100 : 1100,
    }),
  } as unknown as HTMLElement;
  const panel = {
    getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
  } as HTMLElement;
  const cancel = focusWhenReady({
    find: () => target,
    active: () => target,
    scroll: () => {},
    frame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelFrame: () => {},
    complete,
    panel: () => panel,
  });
  frames.shift()!();
  expect(complete).not.toHaveBeenCalled();
  visible = true;
  frames.shift()!();
  expect(complete).toHaveBeenCalledOnce();
  cancel();
});
