import type { WorkspaceStore } from '@socialprune/core/workspace/store';
import { dateInZone } from '../pace.ts';

export const CONTEXT_PACE = Object.freeze({
  intervalMs: 30_000,
  batch: 20,
  pauseMs: 900_000,
  perDay: 200,
  scrollMs: 2_000,
  expandMs: 3_000,
});
export async function instagramDailyCount(
  store: WorkspaceStore,
  account: string,
  now: Date,
  zone: string,
): Promise<{ used: number; last: number }> {
  const day = dateInZone(now, zone);
  return store.read(async (tx) => {
    let used = 0,
      last = 0;
    for await (const run of tx.browserRuns.iterate())
      if (run.platform === 'instagram' && run.accountKey === account) {
        if (dateInZone(run.startedAt, zone) === day) used += run.pageOpens ?? 0;
        if (run.lastPageOpenedAt)
          last = Math.max(last, Date.parse(run.lastPageOpenedAt));
      }
    return { used, last };
  });
}
