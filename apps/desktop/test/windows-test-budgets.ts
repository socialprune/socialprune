import { WINDOWS_QUERY_TIMEOUT_MS } from '../packaging/windows-powershell.ts';

// CI 39413479033, 2026-10-20: short-path 12587 ms, inline policy
// 13689 ms, NSIS fixture 13700 ms, ACL max 13736 ms, restricted launch
// 13445 ms. A 5 s test cannot enclose even one completed OS query.
export const WINDOWS_QUERY_TEST_TIMEOUT_MS =
  Math.max(WINDOWS_QUERY_TIMEOUT_MS, 3 * 13_689) + 100;
// Fixture + grant + deny + restricted launch + restore are sequential.
// The first-cause profile failures are not timeouts; this only prevents the
// enclosing test killing the sequence before it can emit its own receipt.
export const RESTRICTED_SEQUENCE_TEST_TIMEOUT_MS =
  Math.max(WINDOWS_QUERY_TIMEOUT_MS * 3, 3 * (13_700 + 13_736 * 3 + 13_445)) +
  100;
