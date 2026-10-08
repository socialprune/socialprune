import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { CliError } from '../cli/errors.ts';
import { ReviewRuntime } from './runtime.ts';

if (!isMainThread && parentPort) {
  const port = parentPort;
  const input: unknown = workerData;
  if (
    !input ||
    typeof input !== 'object' ||
    !('path' in input) ||
    typeof input.path !== 'string'
  )
    throw new CliError('WORKSPACE_INVALID');
  try {
    const store = await SQLiteStore.open(input.path);
    const runtime = new ReviewRuntime(store);
    const summary = await runtime.summary();
    port.postMessage({ type: 'ready', summary });
    const pending = new Set<Promise<unknown>>();
    port.on(
      'message',
      (message: { type: string; id: number; input?: unknown }) => {
        if (message.type === 'cancel') {
          runtime.cancel(message.id);
          return;
        }
        const task =
          message.type === 'close'
            ? Promise.all([...pending])
                .then(() => runtime.close())
                .then(() => {
                  port.postMessage({ type: 'closed' });
                  port.close();
                })
            : runtime
                .run(message.id, message.input)
                .then((replies) =>
                  port.postMessage({ type: 'reply', id: message.id, replies }),
                );
        pending.add(task);
        void task
          .catch(() => port.postMessage({ type: 'failure', id: message.id }))
          .finally(() => pending.delete(task));
      },
    );
  } catch (error) {
    port.postMessage({
      type: 'startupError',
      code: error instanceof CliError ? error.code : 'WORKSPACE_INVALID',
    });
    port.close();
  }
}
