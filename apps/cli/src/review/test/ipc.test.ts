import { expect, test, vi } from 'vitest';
import { testIpc } from './ipc.ts';

test('disconnect waits for every queued write callback, including fire-and-forget diagnostic receipts', async () => {
  const callbacks: ((error: Error | null) => void)[] = [];
  const disconnect = vi.fn();
  const ipc = testIpc({
    connected: true,
    disconnect,
    send: ((_message, callback: (error: Error | null) => void) => {
      callbacks.push(callback);
      return false; // Backpressure means queued, not a failed write.
    }) as NonNullable<NodeJS.Process['send']>,
  });
  void ipc.send({ type: 'diagnostic' });
  const readback = ipc.send({
    type: 'readback',
    payload: 'x'.repeat(1024 * 1024),
  });
  const cleanup = ipc.send({ type: 'cleanup' });
  const stopped = ipc.disconnect();
  await Promise.resolve();
  expect(disconnect).not.toHaveBeenCalled();
  callbacks[1]!(null);
  await readback;
  callbacks[2]!(null);
  await cleanup;
  expect(disconnect).not.toHaveBeenCalled();
  callbacks[0]!(null);
  await stopped;
  expect(disconnect).toHaveBeenCalledOnce();
});

test('callback failures survive a non-awaiting observer and fail disconnect instead of disappearing', async () => {
  let callback!: (error: Error | null) => void;
  const disconnect = vi.fn();
  const ipc = testIpc({
    connected: true,
    disconnect,
    send: ((_message, sent: (error: Error | null) => void) => {
      callback = sent;
      return true;
    }) as NonNullable<NodeJS.Process['send']>,
  });
  void ipc.send({ type: 'diagnostic' });
  const stopped = ipc.disconnect();
  const error = new Error('IPC write failed');
  callback(error);
  await expect(stopped).rejects.toBe(error);
  expect(disconnect).toHaveBeenCalledOnce();
});
