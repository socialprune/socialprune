import { expect, test, vi } from 'vitest';
import { closeProbe } from './probe-cleanup.ts';
import { removeAfterExit } from '../e2e/remove-after-exit.ts';

test('probe close waits for positive process exit before returning closed', async () => {
  let exited!: () => void;
  const wait = new Promise<void>((resolve) => {
    exited = resolve;
  });
  const events: string[] = [];
  let settled = false;
  const closing = closeProbe({
    close: () => {
      events.push('context-close');
      return Promise.resolve();
    },
    wait: async () => {
      events.push('exit-wait');
      await wait;
    },
  }).then(() => {
    settled = true;
  });
  await vi.waitFor(() =>
    expect(events).toEqual(['context-close', 'exit-wait']),
  );
  expect(settled).toBe(false);
  exited();
  await closing;
  expect(settled).toBe(true);
});

test('probe close still waits after a close error and retains both failures', async () => {
  const closeError = new Error('GENERATED_CLOSE_ERROR');
  const waitError = new Error('GENERATED_EXIT_ERROR');
  const wait = vi.fn(() => Promise.reject(waitError));
  await expect(
    closeProbe({
      close: () => Promise.reject(closeError),
      wait,
    }),
  ).rejects.toMatchObject({ errors: [closeError, waitError] });
  expect(wait).toHaveBeenCalledOnce();
});

test('directory removal cannot precede exit and bounded EBUSY attempts retain a receipt', async () => {
  const events: string[] = [];
  const receipts: unknown[] = [];
  let attempts = 0;
  await removeAfterExit({
    wait: () => {
      events.push('exited');
      return Promise.resolve();
    },
    remove: () => {
      events.push('remove');
      if (++attempts < 3)
        return Promise.reject(
          Object.assign(new Error('GENERATED_LOCK'), { code: 'EBUSY' }),
        );
      return Promise.resolve();
    },
    sleep: () => {
      events.push('retry-wait');
      return Promise.resolve();
    },
    record: (receipt) => {
      receipts.push(receipt);
      return Promise.resolve();
    },
  });
  expect(events).toEqual([
    'exited',
    'remove',
    'retry-wait',
    'remove',
    'retry-wait',
    'remove',
  ]);
  expect(receipts).toEqual([
    expect.objectContaining({
      state: 'removed',
      exitConfirmed: true,
      attempts: 3,
      retryCodes: ['EBUSY', 'EBUSY'],
    }),
  ]);
});

test('failed exit refuses removal, and persistent EBUSY and unrelated errors fail with receipts', async () => {
  const remove = vi.fn(() => Promise.resolve());
  const receipts: unknown[] = [];
  const exitError = new Error('GENERATED_EXIT_TIMEOUT');
  await expect(
    removeAfterExit({
      wait: () => Promise.reject(exitError),
      remove,
      record: (receipt) => {
        receipts.push(receipt);
        return Promise.resolve();
      },
    }),
  ).rejects.toBe(exitError);
  expect(remove).not.toHaveBeenCalled();
  expect(receipts).toEqual([
    expect.objectContaining({
      state: 'failed',
      exitConfirmed: false,
      attempts: 0,
    }),
  ]);
  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    const error = Object.assign(new Error('GENERATED_REMOVE_FAILURE'), {
      code,
    });
    const remove = vi.fn(() => Promise.reject(error));
    const rows: unknown[] = [];
    await expect(
      removeAfterExit({
        wait: () => Promise.resolve(),
        remove,
        sleep: () => Promise.resolve(),
        record: (receipt) => {
          rows.push(receipt);
          return Promise.resolve();
        },
      }),
    ).rejects.toBe(error);
    expect(remove).toHaveBeenCalledTimes(code === 'EACCES' ? 1 : 4);
    expect(rows).toEqual([
      expect.objectContaining({
        state: 'failed',
        exitConfirmed: true,
        attempts: code === 'EACCES' ? 1 : 4,
        failureCode: code,
      }),
    ]);
  }
});
