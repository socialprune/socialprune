import { xAdapter } from '@socialprune/adapter-x';
import { instagramAdapter } from '@socialprune/adapter-instagram';
import { createImportRunner } from './runner.ts';
import type { ImportMessage, ImportRequest } from './protocol.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: ImportMessage) => scope.postMessage(message);
const runner = createImportRunner({
  adapters: [xAdapter, instagramAdapter],
  post,
});

scope.addEventListener('securitypolicyviolation', (event) => {
  const violation = event as SecurityPolicyViolationEvent;
  post({
    type: 'policy-violation',
    violation: {
      directive: violation.effectiveDirective,
      blockedURI: violation.blockedURI,
    },
  });
});
scope.addEventListener('message', (event: MessageEvent<ImportRequest>) => {
  runner.handle(event.data);
});
