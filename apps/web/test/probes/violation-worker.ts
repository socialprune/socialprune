import '@socialprune/core/browser-init';
import { observePolicyViolations } from '../../src/sw/observe-policy.ts';
// Test-only entry. The production manifest/URL policy never includes it.
const scope = self as unknown as DedicatedWorkerGlobalScope;
let violations = 0;
observePolicyViolations(scope, (violation) => {
  if (violation.directive === 'connect-src') violations++;
  scope.postMessage({
    type: 'policy-violation',
    violation,
  });
});
scope.addEventListener('message', (event: MessageEvent<{ url: string }>) => {
  void (async () => {
    let rejected = false;
    try {
      await fetch(event.data.url);
    } catch {
      rejected = true;
    }
    setTimeout(
      () =>
        scope.postMessage({
          type: 'probe-result',
          url: event.data.url,
          rejected,
          violations,
        }),
      100,
    );
  })();
});
