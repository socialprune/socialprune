// Retained release-query receipts from green desktop jobs, 2026-10-22.
// 39778315087 attempt 2, 39674257780 and 39678810054. Counts include only
// these three artifacts. Historical larger compile maximum remains in
// windows-powershell.ts; do not replace it with the smaller recent maximum.
export const runnerQueryCalibration = {
  measuredOn: '2026-10-22',
  runs: ['39778315087/2', '39674257780/1', '39678810054/1'],
  layout: { maximumMs: 1498, samples: 204 },
  snapshot: { maximumMs: 13143, samples: 36 },
  processIdentity: { maximumMs: 2085, samples: 4664 },
  processList: { maximumMs: 95, samples: 117 },
  networkConnection: { maximumMs: 101, samples: 12 },
  nativeCompile: { maximumMs: 40302, samples: 39 },
  appLaunchLifetime: { maximumMs: 35033, samples: 60 },
  networkWatchLifetime: { maximumMs: 99063, samples: 18 },
  // Existing receipts measure entire helper lifetimes, not just readiness.
  // A whole lifetime bounds its startup; do not call it a readiness sample.
  readinessBasis: 'whole-helper-lifetime-upper-bound',
  readinessProvisional: true,
} as const;
