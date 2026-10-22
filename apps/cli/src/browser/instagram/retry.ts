import { errorClass } from './report.ts';
import type { PostRetry } from './report.ts';

export const POST_REOPEN_WAIT_MS = 60000;
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
    if (
      canary ||
      !capacity ||
      errorClass(error) !== 'timeout' ||
      this.entries.length >= 3 ||
      targets.some((target) => this.targets.has(target))
    )
      return null;
    for (const target of targets) this.targets.add(target);
    const retry: PostRetry = {
      step,
      retryStep: null,
      stage: 'post-open',
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
