import type { WorkspaceStore } from '@socialprune/core/workspace/store';
import { dateInZone } from '../pace.ts';
import type { ContextOrder } from './order.ts';

export const CONTEXT_PACE = Object.freeze({
  intervalMs: 30_000,
  batch: 20,
  pauseMs: 900_000,
  perDay: 200,
  scrollMs: 2_000,
  expandMs: 3_000,
});
export type ContextPace = { [K in keyof typeof CONTEXT_PACE]: number };
export function contextPace(
  order?: ContextOrder,
  canary = false,
  base = CONTEXT_PACE as ContextPace,
): ContextPace {
  return {
    ...base,
    intervalMs: canary
      ? CONTEXT_PACE.intervalMs
      : order?.value.secondsPerStep === undefined
        ? base.intervalMs
        : order.value.secondsPerStep * 1000,
    perDay: order?.value.stepsPerDay ?? CONTEXT_PACE.perDay,
    pauseMs: order?.value.batchPause === false ? 0 : base.pauseMs,
  };
}
export function paceSummary(pace: ContextPace) {
  return {
    secondsPerStep: pace.intervalMs / 1000,
    stepsPerDay: pace.perDay,
    batchSize: pace.batch,
    batchPause: pace.pauseMs !== 0,
    batchPauseSeconds: pace.pauseMs / 1000,
  };
}
export function paceText(pace: ContextPace, lang: 'en' | 'de'): string {
  return lang === 'de'
    ? `Tempo: mindestens ${pace.intervalMs / 1000} Sekunden zwischen Schrittstarts; höchstens ${pace.perDay} Schritte pro Instagram-Tag; ${pace.pauseMs ? `${pace.pauseMs / 60000} Minuten Pause nach je ${pace.batch} Schritten` : 'keine feste Stapelpause'}.`
    : `Pace: at least ${pace.intervalMs / 1000} seconds between step starts; at most ${pace.perDay} steps per Instagram day; ${pace.pauseMs ? `${pace.pauseMs / 60000} minutes paused after each ${pace.batch} steps` : 'no fixed batch pause'}.`;
}
export function contextEstimate(count: number, pace: ContextPace): number {
  return (
    Math.max(0, count - 1) * pace.intervalMs +
    Math.floor(Math.max(0, count - 1) / pace.batch) * pace.pauseMs
  );
}
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
