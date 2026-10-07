import '@socialprune/core/browser-init';
// W0 reserves the pre-control demo lifecycle. W4 supplies generated demo
// archive bytes; this entry never accepts a File or a personal workspace.
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.addEventListener('message', (event: MessageEvent<{ type: string }>) => {
  if (event.data.type === 'demo-ready')
    scope.postMessage({ type: 'demo-ready' });
});
