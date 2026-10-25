export interface FrameWork {
  kind: string;
  start: number;
  end: number;
  selfMs: number;
  detail: string;
  scope: 'sync-wall' | 'react-reported' | 'async-lifetime' | 'marker';
}
export function summarizeFrame(
  start: number,
  end: number,
  work: readonly FrameWork[],
) {
  const intervals = work
    .filter((event) => event.scope === 'sync-wall')
    .map(
      (event) =>
        [Math.max(start, event.start), Math.min(end, event.end)] as const,
    )
    .filter(([left, right]) => right > left)
    .sort((a, b) => a[0] - b[0]);
  let observed = 0,
    right = start;
  for (const [left, next] of intervals) {
    observed += Math.max(0, next - Math.max(left, right));
    right = Math.max(right, next);
  }
  const totals: Record<string, number> = {};
  for (const event of work)
    if (event.scope === 'sync-wall') {
      const overlap = Math.max(
        0,
        Math.min(end, event.end) - Math.max(start, event.start),
      );
      const fraction =
        event.end > event.start ? overlap / (event.end - event.start) : 0;
      totals[event.kind] =
        (totals[event.kind] ?? 0) + Math.max(0, event.selfMs) * fraction;
    }
  const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  return {
    start,
    end,
    deltaMs: end - start,
    observedSyncWallMs: observed,
    unobservedMs: Math.max(0, end - start - observed),
    exclusiveByKind: totals,
    largestMeasuredKind: ranked[0]?.[0] ?? null,
    reactReportedMs: work
      .filter((event) => event.scope === 'react-reported')
      .reduce((sum, event) => sum + event.selfMs, 0),
    boundary:
      'Callback wall time includes preemption. Cross-frame exclusive time is overlap-weighted, not a CPU sample. React actualDuration and asynchronous request lifetimes are separate evidence, not additive CPU time.',
  };
}
