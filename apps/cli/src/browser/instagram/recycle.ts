/** IG-19 candidate, measured on generated 200-navigation runs, not real Instagram. */
export const PAGE_RECYCLE_INTERVAL = 20;
export function pageRecycleDue(
  completedSteps: number,
  lastRecycleAt: number,
  canary: boolean,
  attemptInFlight: boolean,
): boolean {
  return (
    !canary &&
    !attemptInFlight &&
    completedSteps - lastRecycleAt >= PAGE_RECYCLE_INTERVAL
  );
}
