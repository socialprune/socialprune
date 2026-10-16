import type { WorkspaceStore } from '@socialprune/core/workspace/store';
import { ReviewDispatch } from '../review/dispatch.ts';
import { ReviewRuntime } from '../review/runtime.ts';

/** Only the desktop engine constructs review handlers inside its own process. */
export class EngineReviewDispatch extends ReviewDispatch {
  static async fromStore(store: WorkspaceStore): Promise<EngineReviewDispatch> {
    const runtime = new ReviewRuntime(store);
    let sequence = 0;
    return new EngineReviewDispatch({
      summary: await runtime.summary(),
      run(input, signal) {
        const id = ++sequence;
        const abort = () => runtime.cancel(id);
        signal?.addEventListener('abort', abort, { once: true });
        const result = runtime.run(id, input);
        if (signal?.aborted) abort();
        return result.finally(() =>
          signal?.removeEventListener('abort', abort),
        );
      },
      close: () => runtime.close(),
      terminate: () => runtime.close(),
    });
  }
}
