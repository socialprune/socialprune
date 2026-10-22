import type { Budgets } from './release-checks.ts';

// 2026-10-22, green desktop jobs only. Highest per-run median + 20%, ceil
// to 1 ms or 1 byte. Installer observations repeat within a run: three builds,
// not fifteen independent installer samples. No workstation inputs.
export const releaseBudgetCalibration = {
  measuredOn: '2026-10-22',
  multiplier: 1.2,
  provisional: false,
  sources: [
    {
      runId: '39778315087',
      attempt: 2,
      artifactId: '12429705236',
      sha: '5b41ae11eb6e8baca9c5a2967774d000938c9d26',
      samples: 5,
      medians: {
        startupMs: 2231,
        workingSetBytes: 455528448,
        installerBytes: 161928410,
      },
    },
    {
      runId: '39674257780',
      attempt: 1,
      artifactId: '12381247597',
      sha: 'd26e9e4816e372bc5b5930dbf5bc337421632e24',
      samples: 5,
      medians: {
        startupMs: 1895,
        workingSetBytes: 463589376,
        installerBytes: 161927879,
      },
    },
    {
      runId: '39678810054',
      attempt: 1,
      artifactId: '12383469302',
      sha: 'e532e4fff5bc659871eb72d4b37d888e0832ad66',
      samples: 5,
      medians: {
        startupMs: 1590,
        workingSetBytes: 459366400,
        installerBytes: 161928382,
      },
    },
  ],
  metrics: {
    startupMs: {
      unit: 'ms',
      roundUpTo: 1,
      samples: 15,
      independentRuns: 3,
      provisional: false,
    },
    workingSetBytes: {
      unit: 'byte',
      roundUpTo: 1,
      samples: 15,
      independentRuns: 3,
      provisional: false,
    },
    installerBytes: {
      unit: 'byte',
      roundUpTo: 1,
      samples: 3,
      observations: 15,
      independentRuns: 3,
      provisional: false,
    },
  },
} as const;

export const releaseBudgets: Budgets = {
  startupMs: 2678,
  workingSetBytes: 556307252,
  installerBytes: 194314092,
};
