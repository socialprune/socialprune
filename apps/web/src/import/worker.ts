import '@socialprune/core/browser-init';
import { xAdapter } from '@socialprune/adapter-x';
import { instagramAdapter } from '@socialprune/adapter-instagram';
import { createImportRunner } from './runner.ts';
import type { ImportMessage, ImportRequest } from './protocol.ts';
import { observePolicyViolations } from '../sw/observe-policy.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: ImportMessage) => scope.postMessage(message);
const runner = createImportRunner({
  adapters: [xAdapter, instagramAdapter],
  post,
});

observePolicyViolations(scope, (violation) => {
  post({
    type: 'policy-violation',
    violation,
  });
});
scope.addEventListener('message', (event: MessageEvent<ImportRequest>) => {
  runner.handle(event.data);
});
