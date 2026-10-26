import type { ItemKind } from '@socialprune/core';
import { FAILURE_DETAILS } from './normalize.ts';
import type { FailureDetail } from './normalize.ts';
import { emptyUsage } from './source.ts';
import type { FailureCode, Usage } from './source.ts';

export const failureCounts = (): Record<FailureCode, number> => ({
  MISSING_ID: 0,
  DUPLICATE_ID: 0,
  INVALID_LABEL: 0,
  MISSING_QUOTE: 0,
});
const kindCounts = () => ({ entries: 0, failures: failureCounts() });
function pass() {
  return {
    answers: 0,
    entryChecks: 0,
    failures: failureCounts(),
    details: Object.fromEntries(
      FAILURE_DETAILS.map((code) => [code, 0]),
    ) as Record<FailureDetail, number>,
    byKind: {
      post: kindCounts(),
      reply: kindCounts(),
      quote: kindCounts(),
      repost: kindCounts(),
      comment: kindCounts(),
    } satisfies Record<ItemKind, ReturnType<typeof kindCounts>>,
    unknownIds: 0,
    truncatedAnswers: 0,
    failuresInTruncatedAnswers: failureCounts(),
    invalidJsonAnswers: 0,
    invalidEnvelopeAnswers: 0,
    recoveredEntries: 0,
    fallbackEntries: 0,
    maxCompletionTokens: null as number | null,
    completionTokensReported: 0,
    completionTokenBuckets: {
      under1024: 0,
      from1024To4095: 0,
      from4096To8191: 0,
      from8192To16383: 0,
      atLeast16384: 0,
    },
    // The request sends no explicit output cap. An endpoint's implicit limit
    // cannot be inferred from token totals or a successful answer.
    requestedCompletionLimit: null,
    tokens: emptyUsage(),
  };
}
export const emptyDiagnostics = () => ({
  schemaVersion: 1 as const,
  counting: 'unique-entry-checks-per-pass' as const,
  firstPass: pass(),
  secondPass: pass(),
});
export type ScanDiagnostics = ReturnType<typeof emptyDiagnostics>;
export function addDiagnosticUsage(target: Usage, value: Usage) {
  for (const key of [
    'promptTokens',
    'cachedPromptTokens',
    'completionTokens',
  ] as const)
    if (value[key] !== null) target[key] = (target[key] ?? 0) + value[key];
}
