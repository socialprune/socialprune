import type { Budgets } from './release-checks.ts';

// Runner calibration is intentionally absent until the first workflow_dispatch
// measure run on windows-latest. Workstation values are not runner budgets.
// Replace null only from that run's five medians, each multiplied by 1.2.
export const releaseBudgets: Budgets | null = null;
