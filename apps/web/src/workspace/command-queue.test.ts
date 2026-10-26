import { expect, test, vi } from 'vitest';
import { CommandQueue } from './command-queue.ts';
test('human queue preserves click order, drains after a failed write and includes unsent work', async () => {
  const queue = new CommandQueue(),
    order: number[] = [];
  let release!: () => void;
  const first = queue.enqueue(async () => {
    order.push(1);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    throw Error('not saved');
  });
  void first.catch(() => undefined);
  const second = queue.enqueue(() => {
    order.push(2);
    return Promise.resolve();
  });
  const flushed = vi.fn();
  void queue.flush().then(flushed);
  await vi.waitFor(() => expect(order).toEqual([1]));
  expect(queue.pending).toBe(2);
  expect(flushed).not.toHaveBeenCalled();
  release();
  await second;
  await queue.flush();
  expect(order).toEqual([1, 2]);
  expect(queue.pending).toBe(0);
  expect(queue.failures).toBe(1);
});
test('not-saved receipts retain a failure generation for deferred navigation barriers', async () => {
  const queue = new CommandQueue();
  const before = queue.failures;
  await queue.enqueue(() => Promise.resolve(false));
  await queue.flush();
  expect(queue.failures).toBe(before + 1);
});
