import type { ReviewView } from '@socialprune/core';
import type { WorkspaceSummary } from '@socialprune/core/workspace/protocol';

export const SEARCH_DEBOUNCE_MS = 150;
export function initialReviewView(
  summary: WorkspaceSummary | null,
  parse: (value: unknown) => ReviewView | undefined,
): ReviewView {
  const stored = parse(summary?.review);
  if (
    stored &&
    (stored.accountKey === null ||
      summary?.accounts.some(({ key }) => key === stored.accountKey))
  )
    return {
      ...stored,
      accountKey: stored.accountKey ?? summary?.accounts[0]?.key ?? null,
    };
  return {
    accountKey: summary?.accounts[0]?.key ?? null,
    filter: {},
    sort: [
      { by: 'risk', direction: 'desc' },
      { by: 'createdAt', direction: 'desc' },
      { by: 'id', direction: 'asc' },
    ],
    search: '',
  };
}

/** Constructing or hydrating a view never writes. Only person changes call change. */
export class ReviewViewWriter {
  private pending: ReviewView | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly write: (view: ReviewView) => void;
  constructor(write: (view: ReviewView) => void) {
    this.write = write;
  }
  change(view: ReviewView, search = false): void {
    clearTimeout(this.timer);
    this.pending = view;
    if (search) this.timer = setTimeout(() => this.flush(), SEARCH_DEBOUNCE_MS);
    else this.flush();
  }
  flush(): void {
    clearTimeout(this.timer);
    const pending = this.pending;
    this.pending = null;
    if (pending) this.write(pending);
  }
}
