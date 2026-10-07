import '@socialprune/core/browser-init';
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.postMessage({ type: 'gate-worker-ready' });
