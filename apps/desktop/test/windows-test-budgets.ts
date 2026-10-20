import { WINDOWS_QUERY_TIMEOUT_MS } from '../packaging/windows-powershell.ts';

// 2026-10-20, CI 39413479033 + 39442592668: all observed PS classes,
// including compile max 45974 ms, feed the shared per-query floor. Enclose
// complete sequential query windows; never shorten a causal child receipt.
export const windowsTestBudget = (queryWindows: number) =>
  WINDOWS_QUERY_TIMEOUT_MS * queryWindows + 100;
export const WINDOWS_QUERY_TEST_TIMEOUT_MS = windowsTestBudget(1);
// Fixture + grant + deny + outer launch (three) + restore, all sequential.
export const RESTRICTED_SEQUENCE_TEST_TIMEOUT_MS =
  windowsTestBudget(7) + 15_000;
