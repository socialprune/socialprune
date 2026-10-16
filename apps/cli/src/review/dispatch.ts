import { HttpReviewRequestSchema } from '@socialprune/core/workspace/protocol';
import type {
  WorkspaceReply,
  WorkspaceSummary,
} from '@socialprune/core/workspace/protocol';
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
