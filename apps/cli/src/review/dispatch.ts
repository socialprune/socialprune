import { HttpReviewRequestSchema } from '@socialprune/core/workspace/protocol';
import type {
  WorkspaceReply,
  WorkspaceSummary,
} from '@socialprune/core/workspace/protocol';
import type { WorkspaceStore } from '@socialprune/core/workspace/store';
import { ReviewRuntime } from './runtime.ts';
import type { ReviewDatabase } from './database.ts';

/** The same review handlers, independent of HTTP, cookies and listener ports. */
export class ReviewDispatch {
  private readonly execute: (
    input: unknown,
    signal?: AbortSignal,
  ) => Promise<WorkspaceReply[]>;
  private readonly shutdown: () => Promise<void>;
  private readonly forceClose: () => Promise<void>;
  readonly summary: WorkspaceSummary;

  constructor(
    database: Pick<ReviewDatabase, 'run' | 'summary' | 'close' | 'terminate'>,
  ) {
    this.summary = database.summary;
    this.execute = (raw, signal) =>
      database.run(HttpReviewRequestSchema.parse(raw), signal);
    this.shutdown = () => database.close();
    this.forceClose = () => database.terminate();
  }

  static async fromStore(store: WorkspaceStore): Promise<ReviewDispatch> {
    const runtime = new ReviewRuntime(store);
    let sequence = 0;
    return new ReviewDispatch({
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

  run(input: unknown, signal?: AbortSignal): Promise<WorkspaceReply[]> {
    return this.execute(input, signal);
  }
  close(): Promise<void> {
    return this.shutdown();
  }
  terminate(): Promise<void> {
    return this.forceClose();
  }
}
