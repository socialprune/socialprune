import { parentPort, workerData } from 'node:worker_threads';
import { SQLiteStore } from '../../workspace/sqlite-store.ts';
import { ReviewRuntime } from '../runtime.ts';

const input = workerData as { path: string };
const port = parentPort!;
const store = await SQLiteStore.open(input.path);
const releases = new Set<() => void>();
function release() {
  for (const resolve of releases) resolve();
  releases.clear();
}
const runtime = new ReviewRuntime(store, {
  yieldChunk: () =>
    new Promise<void>((resolve) => {
      releases.add(resolve);
      port.postMessage({ type: 'chunk' });
    }),
});
port.postMessage({ type: 'ready', summary: await runtime.summary() });
port.on('message', (message: { type: string; id: number; input?: unknown }) => {
  if (message.type === 'cancel') {
    runtime.cancel(message.id);
    release();
    return;
  }
  if (message.type === 'release') {
    release();
    return;
  }
  if (message.type === 'close') {
    void runtime.close().then(() => port.close());
    return;
  }
  void runtime
    .run(message.id, message.input)
    .then((replies) =>
      port.postMessage({ type: 'reply', id: message.id, replies }),
    );
});
