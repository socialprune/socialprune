import { expect, test } from 'vitest';
import { waitForegroundReady } from '../e2e/foreground-watch.ts';

test('readiness requires a matching positive receipt, not file existence or process completion', async () => {
  let read = 0;
  const value = {
    version: 1,
    state: 'ready',
    handle: '123',
    sampleIntervalMs: 5,
    maximumWatchMs: 10000,
  };
  await expect(
    waitForegroundReady({
      read: () => Promise.resolve(++read < 3 ? '' : JSON.stringify(value)),
      completed: new Promise(() => {}),
      timeoutMs: 100,
      intervalMs: 1,
    }),
  ).resolves.toEqual(value);
  expect(read).toBe(3);
  for (const text of [
    'ready',
    '{}',
    JSON.stringify({ ...value, state: 'finished' }),
    JSON.stringify({ ...value, sampleIntervalMs: 0 }),
  ])
    await expect(
      waitForegroundReady({
        read: () => Promise.resolve(text),
        completed: new Promise(() => {}),
        timeoutMs: 10,
        intervalMs: 1,
      }),
    ).rejects.toThrow('FOREGROUND_READY_INVALID');
});

test('a failed or already exited native watcher reports its cause without waiting for a readiness timeout', async () => {
  const failure = new Error('GENERATED_WATCH_FAILURE');
  await expect(
    waitForegroundReady({
      read: () => Promise.resolve(null),
      completed: Promise.reject(failure),
      timeoutMs: 10000,
      intervalMs: 1,
    }),
  ).rejects.toBe(failure);
  await expect(
    waitForegroundReady({
      read: () => Promise.resolve(null),
      completed: Promise.resolve({ stdout: '{}', stderr: '' }),
      timeoutMs: 10000,
      intervalMs: 1,
    }),
  ).rejects.toThrow('FOREGROUND_EXITED_BEFORE_READY');
  await expect(
    waitForegroundReady({
      read: () =>
        Promise.resolve(
          JSON.stringify({
            version: 1,
            state: 'ready',
            handle: '123',
            sampleIntervalMs: 5,
            maximumWatchMs: 10000,
          }),
        ),
      completed: Promise.resolve({ stdout: '{}', stderr: '' }),
      timeoutMs: 10000,
      intervalMs: 1,
    }),
  ).rejects.toThrow('FOREGROUND_EXITED_BEFORE_READY');
  await expect(
    waitForegroundReady({
      read: () => Promise.resolve(null),
      completed: new Promise(() => {}),
      timeoutMs: 10,
      intervalMs: 1,
    }),
  ).rejects.toThrow('FOREGROUND_READY_TIMEOUT');
});
