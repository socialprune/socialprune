import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';
import { attachDisplayRecovery } from '../src/main/display-change.ts';
import type { Bounds } from '../src/main/methods.ts';

test('generated display events move only the exact wholly offscreen owned window, without activation', async () => {
  const events = new EventEmitter();
  let target = {
    id: 'engine-window',
    bounds: { x: 2500, y: 100, width: 700, height: 700 },
  };
  const move = vi.fn((id: string, bounds: Bounds) => {
    expect(id).toBe(target.id);
    target = { id, bounds };
    return Promise.resolve();
  });
  const owner = { current: () => Promise.resolve(target), move };
  const recovery = attachDisplayRecovery({
    events,
    areas: () => [{ x: 0, y: 0, width: 1920, height: 1040 }],
    appBounds: () => ({ x: 0, y: 0, width: 960, height: 1040 }),
    owner,
    record: vi.fn(),
  });
  events.emit('display-removed');
  await recovery.settled();
  expect(move).toHaveBeenCalledExactlyOnceWith(
    'engine-window',
    { x: 960, y: 0, width: 700, height: 700 },
    { activate: false, expected: { x: 2500, y: 100, width: 700, height: 700 } },
  );
  events.emit('display-metrics-changed');
  await recovery.settled();
  expect(move).toHaveBeenCalledTimes(1);
  target.bounds.x = -699; // One pixel remains visible; do not touch it.
  events.emit('display-removed');
  await recovery.settled();
  expect(move).toHaveBeenCalledTimes(1);
  recovery.close();
  expect(events.listenerCount('display-removed')).toBe(0);
});

test('missing owner, closed/replaced identity, invalid bounds and user movement are never moved', async () => {
  const events = new EventEmitter(),
    move = vi.fn();
  let reads = 0;
  const recovery = attachDisplayRecovery({
    events,
    areas: () => [{ x: -1920, y: -100, width: 1920, height: 1080 }],
    appBounds: () => ({ x: -1920, y: 0, width: 960, height: 900 }),
    owner: {
      current: () =>
        Promise.resolve(
          ++reads === 1
            ? { id: 'old', bounds: { x: 3000, y: 0, width: 500, height: 500 } }
            : { id: 'new', bounds: { x: -900, y: 0, width: 500, height: 500 } },
        ),
      move,
    },
    record: vi.fn(),
  });
  events.emit('display-removed');
  await recovery.settled();
  expect(move).not.toHaveBeenCalled();
  recovery.close();
  const none = attachDisplayRecovery({
    events,
    areas: () => [],
    appBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }),
    record: vi.fn(),
  });
  events.emit('display-metrics-changed');
  await none.settled();
  expect(move).not.toHaveBeenCalled();
  none.close();
});

test('nearest remaining negative-coordinate work area fits an oversized window and stale events never activate it', async () => {
  const events = new EventEmitter(),
    move = vi.fn().mockResolvedValue(undefined);
  const target = {
    id: 'engine-negative',
    bounds: { x: -5000, y: -1200, width: 2500, height: 1800 },
  };
  const areas = [
    { x: -1920, y: -100, width: 1920, height: 1040 },
    { x: 0, y: 0, width: 1280, height: 720 },
  ];
  const recovery = attachDisplayRecovery({
    events,
    areas: () => areas,
    appBounds: () => ({ x: -1920, y: -100, width: 960, height: 1040 }),
    owner: { current: () => Promise.resolve(target), move },
    record: vi.fn(),
  });
  events.emit('display-metrics-changed');
  await recovery.settled();
  expect(move).toHaveBeenCalledExactlyOnceWith(
    'engine-negative',
    { x: -1920, y: -100, width: 1920, height: 1040 },
    { activate: false, expected: target.bounds },
  );
  recovery.close();
  events.emit('display-removed');
  await recovery.settled();
  expect(move).toHaveBeenCalledTimes(1);
});

test('owner failures are recorded and do not touch an ordinary window or leak an unhandled rejection', async () => {
  const events = new EventEmitter(),
    record = vi.fn(),
    move = vi.fn();
  const recovery = attachDisplayRecovery({
    events,
    areas: () => [],
    appBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }),
    owner: {
      current: () => Promise.reject(new Error('generated owner closed')),
      move,
    },
    record,
  });
  events.emit('display-removed');
  await recovery.settled();
  expect(record).toHaveBeenCalledExactlyOnceWith('DISPLAY_RECOVERY_FAILED');
  expect(move).not.toHaveBeenCalled();
  recovery.close();
});
