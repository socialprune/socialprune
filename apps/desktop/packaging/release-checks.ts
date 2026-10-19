export interface Measurement {
  startupMs: number;
  workingSetBytes: number;
  installerBytes: number;
}

export type Budgets = Record<keyof Measurement, number>;
export type Summary = {
  runs: number;
} & Record<keyof Measurement, { median: number; maximum: number }>;

export function checkRelease(
  summary: Summary,
  budgets: Budgets | null,
  requireCalibration = false,
): 'measure' | 'enforce' {
  if (budgets) {
    assertBudgets(summary, budgets);
    return 'enforce';
  }
  if (requireCalibration) throw new Error('RUNNER_BUDGETS_NOT_CALIBRATED');
  return 'measure';
}

export function summarize(samples: readonly Measurement[]): Summary {
  if (samples.length < 5 || samples.length % 2 !== 1)
    throw new Error('FIVE_RUNS_REQUIRED');
  const metric = (key: keyof Measurement) => {
    const sorted = samples.map((sample) => sample[key]).sort((a, b) => a - b);
    if (sorted.some((value) => !Number.isFinite(value) || value <= 0))
      throw new Error('INVALID_MEASUREMENT');
    return {
      median: sorted[Math.floor(sorted.length / 2)]!,
      maximum: sorted.at(-1)!,
    };
  };
  return {
    runs: samples.length,
    startupMs: metric('startupMs'),
    workingSetBytes: metric('workingSetBytes'),
    installerBytes: metric('installerBytes'),
  };
}

export function assertBudgets(summary: Summary, budgets: Budgets): void {
  for (const key of [
    'startupMs',
    'workingSetBytes',
    'installerBytes',
  ] as const) {
    if (!Number.isFinite(budgets[key]) || budgets[key] <= 0)
      throw new Error(`INVALID_BUDGET:${key}`);
    if (summary[key].median > budgets[key])
      throw new Error(
        `BUDGET_EXCEEDED:${key}:${summary[key].median}>${budgets[key]}`,
      );
  }
}
