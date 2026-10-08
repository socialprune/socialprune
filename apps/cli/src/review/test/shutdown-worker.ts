import { parentPort, workerData } from 'node:worker_threads';
import { SQLiteStore } from '../../workspace/sqlite-store.ts';
import type { WorkspaceStore } from '@socialprune/core/workspace/store';
import { ReviewRuntime } from '../runtime.ts';

const port = parentPort!;
const { path } = workerData as { path: string };
const store = await SQLiteStore.open(path);
let release!: () => void;
const waiting = new Promise<void>((resolve) => {
  release = resolve;
});
const injected: WorkspaceStore = {
  read: (operation) => store.read(operation),
  async write(operation) {
    port.postMessage({ type: 'pendingWrite' });
    await waiting;
    return store.write(operation);
  },
  close: () => store.close(),
};
const runtime = new ReviewRuntime(injected);
const tasks = new Set<Promise<unknown>>();
port.postMessage({ type: 'ready', summary: await runtime.summary() });
port.on('message', (message: { type: string; id: number; input?: unknown }) => {
  if (message.type === 'release') {
    release();
    return;
  }
  if (message.type === 'cancel') {
    runtime.cancel(message.id);
    return;
  }
  if (message.type === 'close') {
    void Promise.all([...tasks])
      .then(() => runtime.close())
      .then(() => port.close());
    return;
  }
  const task = runtime
    .run(message.id, message.input)
    .then((replies) =>
      port.postMessage({ type: 'reply', id: message.id, replies }),
    );
  tasks.add(task);
  void task.finally(() => tasks.delete(task));
});
