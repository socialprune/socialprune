import '@socialprune/core/browser-init';
import { xAdapter } from '@socialprune/adapter-x';
import { instagramAdapter } from '@socialprune/adapter-instagram';
import { createImportRunner } from './runner.ts';
import type { ImportMessage, ImportRequest } from './protocol.ts';
import { observePolicyViolations } from '../sw/observe-policy.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let port: MessagePort | null = null;
let token = 0;
let ready = Promise.resolve();
const receipts = new Map<
  number,
  { resolve: () => void; reject: (error: Error) => void }
>();
function deliver(message: Record<string, unknown>): Promise<void> {
  if (!port) return Promise.reject(new Error('Workspace import port missing.'));
  const id = ++token;
  return ready.then(
    () =>
      new Promise<void>((resolve, reject) => {
        receipts.set(id, { resolve, reject });
        port!.postMessage({ ...message, token: id });
      }),
  );
}
const post = (message: ImportMessage) => {
  if (message.type === 'summary' || message.type === 'aborted') {
    void deliver({
      type: message.type,
      ...(message.type === 'summary' ? { summary: message.summary } : {}),
    })
      .then(() => scope.postMessage(message))
      .catch(() =>
        scope.postMessage({
          type: 'error',
          id: message.id,
          message: 'Workspace storage did not accept the import.',
        }),
      );
  } else scope.postMessage(message);
};
const runner = createImportRunner({
  adapters: [xAdapter, instagramAdapter],
  post,
  onItems: (items) => deliver({ type: 'batch', items }),
});

observePolicyViolations(scope, (violation) => {
  post({
    type: 'policy-violation',
    violation,
  });
});
scope.addEventListener('message', (event: MessageEvent<ImportRequest>) => {
  if (event.data.type === 'attach') {
    port?.close();
    port = event.data.port;
    let announce = () => {};
    ready = new Promise<void>((resolve) => {
      announce = resolve;
    });
    port.onmessage = (event: MessageEvent<{ type: string; token: number }>) => {
      if (event.data.type === 'ready') {
        announce();
        return;
      }
      const receipt = receipts.get(event.data.token);
      if (!receipt) return;
      receipts.delete(event.data.token);
      if (event.data.type === 'storage-failed')
        receipt.reject(new Error('Workspace transaction failed.'));
      else receipt.resolve();
    };
    port.start();
    return;
  }
  runner.handle(event.data);
});
