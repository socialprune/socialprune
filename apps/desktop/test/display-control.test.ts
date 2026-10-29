import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';
import { displayControl } from './display-control.ts';

const fixture = () =>
  Object.assign(new EventEmitter(), { postMessage: vi.fn() });

test('display control settles on child exit instead of hanging until the whole spec deadline', async () => {
  const child = fixture();
  const pending = displayControl(child, { type: 'displayClose' });
  const observed: unknown[] = [];
  void pending.then(
    (value) => observed.push(value),
    (error: unknown) => observed.push(error),
  );
  child.emit('exit', 1);
  await Promise.resolve();
  expect(observed).toHaveLength(1);
  expect(observed[0]).toMatchObject({
    message: 'DISPLAY_CONTROL_CHILD_EXITED',
  });
  expect(child.listenerCount('message')).toBe(0);
  expect(child.listenerCount('exit')).toBe(0);
});

test('display controls ignore unrelated messages and clean up success and failure', async () => {
  for (const reply of [
    { type: 'displayControl', positioned: true },
    { type: 'displayControl', failed: true },
  ]) {
    const child = fixture();
    const pending = displayControl(child, { type: 'displayClose' });
    const outcome = reply.failed
      ? expect(pending).rejects.toThrow('DISPLAY_CONTROL_FAILED')
      : expect(pending).resolves.toEqual(reply);
    child.emit('message', { type: 'windowBoundary' });
    expect(child.listenerCount('message')).toBe(1);
    child.emit('message', reply);
    await outcome;
    expect(child.listenerCount('message')).toBe(0);
    expect(child.listenerCount('exit')).toBe(0);
  }
});

test('missing control reply times out in thirty seconds and ignores late replies', async () => {
  vi.useFakeTimers();
  try {
    const child = fixture();
    const pending = displayControl(child, { type: 'displayClose' });
    const rejection = expect(pending).rejects.toThrow(
      'DISPLAY_CONTROL_TIMEOUT',
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(child.listenerCount('message')).toBe(0);
    expect(child.listenerCount('exit')).toBe(0);
    child.emit('message', { type: 'displayControl', closed: true });
  } finally {
    vi.useRealTimers();
  }
});

test('post failure cleans both control listeners', async () => {
  const child = fixture();
  child.postMessage.mockImplementation(() => {
    throw new Error('GENERATED_SEND_FAILED');
  });
  await expect(displayControl(child, { type: 'displayClose' })).rejects.toThrow(
    'GENERATED_SEND_FAILED',
  );
  expect(child.listenerCount('message')).toBe(0);
  expect(child.listenerCount('exit')).toBe(0);
});
