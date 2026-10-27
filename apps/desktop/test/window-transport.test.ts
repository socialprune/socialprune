import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';
import { HostCommandSchema, HostEventSchema } from '../src/host-protocol.ts';
import { DesktopRequestSchema } from '../src/protocol.ts';
import { createWindowOwner } from '../../cli/src/engine/window.ts';

const mocks = vi.hoisted((): { child: unknown; port: unknown } => ({
  child: null,
  port: null,
}));
vi.mock('electron', () => ({
  utilityProcess: { fork: () => mocks.child },
  MessageChannelMain: class {
    port1 = mocks.port;
    port2 = {};
  },
}));
const { launchEngine } = await import('../src/main/engine.ts');

test('a one-millisecond main/utility clock difference cannot reject a fresh owned-window move', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
  const f = fixture();
  f.reply({ type: 'ready' });
  const owner = createWindowOwner();
  const bounds = { x: 5000, y: 5000, width: 600, height: 400 };
  const id = crypto.randomUUID();
  const move = vi.fn(() => Promise.resolve());
  owner.register({
    closed: new Promise(() => {}),
    current: () => Promise.resolve({ id, bounds }),
    move,
  });
  try {
    const moved = f.engine.platformWindow.move(
      id,
      { ...bounds, x: 10 },
      { activate: false, expected: bounds },
    );
    const sent = f.port.postMessage.mock.calls.at(-1)![0] as {
      id: string;
      message: Parameters<typeof owner.request>[0];
    };
    clock.mockReturnValue(9999);
    const reply = await owner.request(sent.message);
    f.reply({ type: 'window', id: sent.id, reply });
    await expect(moved).resolves.toBeUndefined();
    expect(move).toHaveBeenCalledExactlyOnceWith(
      id,
      bounds,
      { ...bounds, x: 10 },
      expect.any(Function),
    );
    if (sent.message.type !== 'move') throw new Error('MOVE_EXPECTED');
    clock.mockReturnValue(sent.message.expiresAt);
    expect(await owner.request(sent.message)).toEqual({ type: 'unavailable' });
    expect(move).toHaveBeenCalledTimes(1);
  } finally {
    f.child.emit('exit', 0);
    await f.engine.close();
    clock.mockRestore();
  }
});
function fixture() {
  const child = Object.assign(new EventEmitter(), {
    stdout: { resume: vi.fn() },
    stderr: { resume: vi.fn() },
    postMessage: vi.fn(),
    kill: vi.fn(),
  });
  const port = Object.assign(new EventEmitter(), {
    postMessage: vi.fn(),
    start: vi.fn(),
    close: vi.fn(),
  });
  mocks.child = child;
  mocks.port = port;
  const record = vi.fn();
  const engine = launchEngine(
    'generated',
    { dataFolder: process.cwd() },
    record,
  );
  const reply = (value: unknown) => port.emit('message', { data: value });
  return { child, port, record, engine, reply };
}
test('closed private window channel rejects renderer commands, activation, URLs, titles and extra fields', () => {
  const id = crypto.randomUUID();
  expect(
    DesktopRequestSchema.safeParse({
      type: 'window',
      requestId: id,
      message: { type: 'current' },
    }).success,
  ).toBe(false);
  for (const message of [
    { type: 'current', url: 'generated' },
    {
      type: 'move',
      id,
      expected: { x: 0, y: 0, width: 100, height: 100 },
      bounds: { x: 1, y: 1, width: 100, height: 100 },
      activate: true,
      expiresAt: Date.now() + 5000,
    },
  ])
    expect(
      HostCommandSchema.safeParse({ type: 'window', id, message }).success,
    ).toBe(false);
  expect(
    HostEventSchema.safeParse({
      type: 'window',
      id,
      reply: {
        type: 'window',
        value: {
          id,
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          title: 'generated',
        },
      },
    }).success,
  ).toBe(false);
});
test('unavailable differs from no owner; current queues until ready, wrong IDs do not settle; exit rejects pending', async () => {
  const f = fixture();
  try {
    const waiting = f.engine.platformWindow.current();
    expect(
      f.port.postMessage.mock.calls.filter(
        ([v]) => (v as { type: string }).type === 'window',
      ),
    ).toEqual([]);
    f.reply({ type: 'ready' });
    const sent = f.port.postMessage.mock.calls.at(-1)![0] as { id: string };
    f.reply({
      type: 'window',
      id: crypto.randomUUID(),
      reply: { type: 'window', value: null },
    });
    f.reply({
      type: 'window',
      id: sent.id,
      reply: { type: 'window', value: null },
    });
    expect(await waiting).toBeNull();
    const pending = f.engine.platformWindow.current();
    f.child.emit('exit', 1);
    await expect(pending).rejects.toThrow('OWNED_WINDOW_UNAVAILABLE');
    await expect(f.engine.platformWindow.current()).rejects.toThrow(
      'OWNED_WINDOW_UNAVAILABLE',
    );
  } finally {
    await f.engine.close();
  }
});
test('move carries the last observed bounds; timeout/late replies cannot turn unknown into closed', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.reply({ type: 'ready' });
  try {
    const id = crypto.randomUUID(),
      bounds = { x: 5000, y: 5000, width: 600, height: 400 };
    const current = f.engine.platformWindow.current();
    let sent = f.port.postMessage.mock.calls.at(-1)![0] as { id: string };
    f.reply({
      type: 'window',
      id: sent.id,
      reply: { type: 'window', value: { id, bounds } },
    });
    await current;
    const moved = f.engine.platformWindow.move(
      id,
      { x: 10, y: 10, width: 600, height: 400 },
      { activate: false, expected: bounds },
    );
    sent = f.port.postMessage.mock.calls.at(-1)![0] as { id: string };
    expect(f.port.postMessage.mock.calls.at(-1)![0]).toMatchObject({
      message: { type: 'move', id, expected: bounds, activate: false },
    });
    f.reply({ type: 'window', id: sent.id, reply: { type: 'moved' } });
    await moved;
    const timed = f.engine.platformWindow.current();
    const rejection = expect(timed).rejects.toThrow('OWNED_WINDOW_UNAVAILABLE');
    sent = f.port.postMessage.mock.calls.at(-1)![0] as { id: string };
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    f.reply({
      type: 'window',
      id: sent.id,
      reply: { type: 'window', value: null },
    });
    expect(f.record).toHaveBeenCalledWith('ENGINE_WINDOW_TIMEOUT');
    f.child.emit('exit', 0);
  } finally {
    await f.engine.close();
    vi.useRealTimers();
  }
});

test('duplicate readiness never resends a move; bounded pending requests fail on engine failure and shutdown', async () => {
  const f = fixture();
  f.reply({ type: 'ready' });
  const rejection = (pending: Promise<unknown>) =>
    expect(pending).rejects.toThrow('OWNED_WINDOW_UNAVAILABLE');
  try {
    const bounds = { x: 5000, y: 5000, width: 600, height: 400 };
    const moved = f.engine.platformWindow.move(
      crypto.randomUUID(),
      { ...bounds, x: 10 },
      { activate: false, expected: bounds },
    );
    const moveRejected = rejection(moved);
    f.reply({ type: 'ready' });
    expect(
      f.port.postMessage.mock.calls.filter(
        ([value]) => (value as { type: string }).type === 'window',
      ),
    ).toHaveLength(1);
    const pending = Array.from({ length: 7 }, () =>
      rejection(f.engine.platformWindow.current()),
    );
    await rejection(f.engine.platformWindow.current());
    f.reply({ type: 'failed' });
    await Promise.all([moveRejected, ...pending]);
    await rejection(f.engine.platformWindow.current());
    expect(f.record).toHaveBeenCalledWith('ENGINE_FAILED');
  } finally {
    f.child.emit('exit', 1);
    await f.engine.close();
  }
  const closing = fixture();
  closing.reply({ type: 'ready' });
  const pending = rejection(closing.engine.platformWindow.current());
  const stopped = closing.engine.close();
  closing.child.emit('exit', 0);
  await Promise.all([pending, stopped]);
  expect(closing.port.close).toHaveBeenCalledTimes(1);
});
