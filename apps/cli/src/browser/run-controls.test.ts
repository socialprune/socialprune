import { expect, test } from 'vitest';
import { RunControls } from './run-controls.ts';
import { windowArguments } from './launch.ts';

test('pause stays pending through the whole step, then resume repeats checks before the next step', async () => {
  let now = 0,
    finish!: () => void;
  const calls: string[] = [];
  const controls = new RunControls(
    () => new Date(now),
    (phase, pending) =>
      calls.push(phase?.phase ?? (pending ? 'pending' : 'none')),
  );
  const step = (async () => {
    calls.push('step-start');
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    calls.push('step-end');
  })();
  controls.requestPause();
  expect(calls).toEqual(['step-start', 'pending']);
  finish();
  await step;
  const gate = controls.checkpoint(() => {
    calls.push('account-language-extensions');
    return Promise.resolve();
  }, new AbortController().signal);
  expect(calls).toEqual(['step-start', 'pending', 'step-end', 'paused']);
  now = 900000;
  controls.resume();
  await gate;
  calls.push('next-step');
  expect(calls).toEqual([
    'step-start',
    'pending',
    'step-end',
    'paused',
    'account-language-extensions',
    'running',
    'next-step',
  ]);
  expect(controls.pausedMs).toBe(900000);
});
test('a requested pause does not count toward an in-progress pace or batch wait', async () => {
  let now = 0;
  const durations: number[] = [];
  const published: { remaining: number; next: string }[] = [];
  const controls = new RunControls(
    () => new Date(now),
    (phase) => {
      if (phase?.phase === 'paused') {
        now += 60000;
        controls.resume();
      }
    },
  );
  const signal = new AbortController().signal;
  await controls.delay(
    30000,
    (ms, timer) => {
      durations.push(ms);
      if (durations.length === 1) {
        now += 10000;
        controls.requestPause();
        return new Promise<void>((resolve) =>
          timer.addEventListener('abort', () => resolve(), { once: true }),
        );
      }
      now += ms;
      return Promise.resolve();
    },
    () => Promise.resolve(),
    signal,
    (remaining, next) => published.push({ remaining, next }),
  );
  expect(durations).toEqual([30000, 20000]);
  expect(now).toBe(90000);
  expect(controls.pausedMs).toBe(60000);
  expect(published).toEqual([
    { remaining: 30000, next: new Date(30000).toISOString() },
    { remaining: 20000, next: new Date(90000).toISOString() },
  ]);
});
test('window placement adds only the two Chromium position and size switches', () => {
  expect(windowArguments({ x: 960, y: 0, width: 960, height: 1080 })).toEqual([
    '--window-position=960,0',
    '--window-size=960,1080',
  ]);
  expect(windowArguments()).toEqual([]);
  expect(() => windowArguments({ x: 0, y: 0, width: 0, height: 1 })).toThrow();
});

test('failed resume checks prevent the next step and Stop releases a paused boundary', async () => {
  const controls = new RunControls(
    () => new Date(0),
    () => {},
  );
  controls.requestPause();
  const denied = controls.checkpoint(
    () => Promise.reject(new Error('Generated account mismatch')),
    new AbortController().signal,
  );
  controls.resume();
  await expect(denied).rejects.toThrow('Generated account mismatch');
  const stopped = new RunControls(
    () => new Date(0),
    () => {},
  );
  stopped.requestPause();
  const waiting = stopped.checkpoint(
    () => Promise.resolve(),
    new AbortController().signal,
  );
  stopped.stop();
  await expect(waiting).rejects.toMatchObject({ code: 'CANCELLED' });
});
