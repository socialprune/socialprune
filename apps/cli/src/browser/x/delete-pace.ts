import type { BrowserRun, BrowserAttempt } from '@socialprune/core';
import type { XResponseWindows } from './rate-windows.ts';

export function deletionPace(
  clean: number,
  windows: XResponseWindows,
  now: number,
) {
  if (clean < 100) return { intervalMs: 30000, perDay: 200 };
  return windows.permitsFastDeletion(now)
    ? { intervalMs: 8000, perDay: 500 }
    : { intervalMs: 15000, perDay: 300 };
}

/** Promotion survives restart only through direct confirmed journal receipts. */
export function cleanDeletions(
  journal: { runs: BrowserRun[]; attempts: BrowserAttempt[] },
  accountKey: string,
  resetAfterRun?: string,
  resetAfterAt?: string,
): number {
  let count = 0;
  const settlements = new Map(
    journal.attempts.filter((a) => a.settles).map((a) => [a.settles, a]),
  );
  const sends = new Map<string, BrowserAttempt[]>();
  for (const attempt of journal.attempts) {
    if (attempt.state !== 'sending') continue;
    const values = sends.get(attempt.runId) ?? [];
    values.push(attempt);
    sends.set(attempt.runId, values);
  }
  for (const run of journal.runs) {
    if (resetAfterAt && Date.parse(run.startedAt) < Date.parse(resetAfterAt)) {
      count = 0;
      continue;
    }
    if (run.runId === resetAfterRun) {
      count = 0;
      continue;
    }
    if (run.platform !== 'x' || run.accountKey !== accountKey) continue;
    if (run.mode !== 'delete') {
      if (run.mode === 'fill' && run.endReason === 'canary') continue;
      if (
        run.endReason &&
        !['done', 'daily-cap', 'stopped-by-person'].includes(run.endReason)
      )
        count = 0;
      continue;
    }
    for (const sending of sends.get(run.runId) ?? []) {
      const settled = settlements.get(sending.attemptId);
      if (
        settled?.runId === run.runId &&
        settled.itemId === sending.itemId &&
        settled.action === sending.action &&
        settled.state === 'deleted' &&
        settled.receipt?.status === 200
      )
        count++;
      else count = 0;
    }
    if (
      run.endReason &&
      !['done', 'daily-cap', 'stopped-by-person'].includes(run.endReason)
    )
      count = 0;
  }
  return count;
}
