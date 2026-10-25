import type { WorkspaceStore } from '@socialprune/core/workspace/store';
import type { BrowserRun, BrowserAttempt } from '@socialprune/core';
function dateInZone(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export const INSTAGRAM_DELETE_PACE = Object.freeze({
  intervalMs: 30000,
  batch: 10,
  pauseMs: 900000,
  perDay: 50,
});
export function instagramDeletionState(
  attempts: readonly BrowserAttempt[],
  now: Date,
  zone: string,
) {
  const starts = attempts
    .filter((a) => a.state === 'sending' && a.action === 'delete-comment')
    .sort((a, b) => a.at.localeCompare(b.at));
  let batch = 0,
    last = 0,
    lastEnded = 0;
  for (const start of starts) {
    const at = Date.parse(start.at);
    if (at - lastEnded >= INSTAGRAM_DELETE_PACE.pauseMs) batch = 0;
    batch++;
    last = at;
    const terminal = attempts.find(
      (a) =>
        a.settles === start.attemptId &&
        ['deleted', 'ambiguous', 'failed'].includes(a.state),
    );
    lastEnded = Math.max(at, terminal ? Date.parse(terminal.at) : at);
  }
  const used = starts.filter(
    (a) => dateInZone(new Date(a.at), zone) === dateInZone(now, zone),
  ).length;
  const deadline = Math.max(
    last + INSTAGRAM_DELETE_PACE.intervalMs,
    batch >= INSTAGRAM_DELETE_PACE.batch
      ? lastEnded + INSTAGRAM_DELETE_PACE.pauseMs
      : 0,
  );
  return { used, batch, last, wait: Math.max(0, deadline - now.getTime()) };
}
export async function instagramDeleteBudget(
  store: WorkspaceStore,
  account: string,
  now: Date,
  zone: string,
) {
  return store.read(async (tx) => {
    const runs = new Map<string, BrowserRun>();
    for await (const run of tx.browserRuns.iterate())
      if (run.platform === 'instagram' && run.accountKey === account)
        runs.set(run.runId, run);
    const attempts: BrowserAttempt[] = [];
    for await (const a of tx.browserAttempts.iterate())
      if (a.action === 'delete-comment' && runs.get(a.runId)?.mode === 'delete')
        attempts.push(a);
    return instagramDeletionState(attempts, now, zone);
  });
}
