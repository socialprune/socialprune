import type { BrowserRun, BrowserAttempt } from './browser.ts';

/** Hand-written synthetic oracle shared by all three technology adapters. */
export const JOURNAL_FIXTURE = {
  run: {
    runId: 'generated-run',
    platform: 'x',
    accountKey: 'x:contract',
    mode: 'delete',
    planHash: 'a'.repeat(64),
    startedAt: '2026-01-02T00:00:00.000Z',
    endedAt: '2026-01-02T00:00:31.000Z',
    endReason: 'error',
    bodyShapes: {},
    profileReport: null,
  } satisfies BrowserRun,
  attempts: [
    {
      seq: 1,
      attemptId: 'generated-send',
      runId: 'generated-run',
      itemId: 'x:1',
      action: 'delete-post',
      state: 'sending',
      settles: null,
      at: '2026-01-02T00:00:00.000Z',
      code: null,
    },
    {
      seq: 2,
      attemptId: 'generated-ambiguous',
      runId: 'generated-run',
      itemId: 'x:1',
      action: 'delete-post',
      state: 'ambiguous',
      settles: 'generated-send',
      at: '2026-01-02T00:00:31.000Z',
      code: 'RESPONSE_UNKNOWN',
    },
  ] satisfies BrowserAttempt[],
  expectedStates: ['sending', 'ambiguous'],
  expectedCounts: { browserRuns: 1, browserAttempts: 2 },
};
