import { ContextStop, errorClass } from './report.ts';
import type { PostRetry } from './report.ts';

export const POST_REOPEN_WAIT_MS = 60000;
/** Marks only an empty read after applying the comments date filter. */
export class FilteredListTimeout extends ContextStop {
  constructor() {
    super('PLATFORM_CHECK', 'list-timeout');
  }
}
/** Matches X fill's main-run, one-per-target, three-per-run retry shape. */
export class PostOpenRetries {
  private readonly targets = new Set<string>();
  private readonly entries: PostRetry[] = [];
  begin(
    error: unknown,
    targets: readonly string[],
    step: number,
    canary: boolean,
    capacity: boolean,
  ): PostRetry | null {
    if (errorClass(error) !== 'timeout') return null;
    return this.reserve(targets, step, canary, capacity, 'post-open');
  }
  beginList(
    error: unknown,
    targets: readonly string[],
    step: number,
    canary: boolean,
    capacity: boolean,
  ): PostRetry | null {
    if (!(error instanceof FilteredListTimeout)) return null;
    return this.reserve(targets, step, canary, capacity, 'list');
  }
  private reserve(
    targets: readonly string[],
    step: number,
    canary: boolean,
    capacity: boolean,
    stage: PostRetry['stage'],
  ): PostRetry | null {
    if (
      canary ||
      !capacity ||
      this.entries.length >= 3 ||
      targets.some((target) => this.targets.has(target))
    )
      return null;
    for (const target of targets) this.targets.add(target);
    const retry: PostRetry = {
      step,
      retryStep: null,
      stage,
      waitedMs: 0,
      outcome: null,
    };
    this.entries.push(retry);
    return retry;
  }
  summary() {
    return {
      used: this.entries.length,
      entries: this.entries.map((entry) => ({ ...entry })),
    };
  }
}
