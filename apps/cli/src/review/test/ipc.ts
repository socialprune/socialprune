import type { Serializable } from 'node:child_process';

/** Test receipts must finish writing before disconnect closes their channel. */
export function testIpc(
  transport: Pick<
    NodeJS.Process,
    'send' | 'connected' | 'disconnect'
  > = process,
) {
  const pending = new Set<Promise<void>>();
  let failure: Error | undefined;
  function send(message: Serializable): Promise<void> {
    if (!transport.send) return Promise.resolve();
    const sent = new Promise<void>((resolve, reject) => {
      transport.send!(message, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    // Diagnostics observers cannot await. Retain their failure for disconnect
    // instead of swallowing it or creating an unhandled rejection.
    const tracked = sent.then(
      () => {
        pending.delete(tracked);
      },
      (error: Error) => {
        failure ??= error;
        pending.delete(tracked);
      },
    );
    pending.add(tracked);
    return sent;
  }
  async function disconnect(): Promise<void> {
    await Promise.all([...pending]);
    if (transport.connected) transport.disconnect?.();
    if (failure) throw failure;
  }
  return { send, disconnect };
}
