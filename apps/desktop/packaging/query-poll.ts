import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { WINDOWS_QUERY_TIMEOUT_MS } from './windows-powershell.ts';

// CI 39442592668, 2026-10-20: actual native replacements, not CIM
// predecessors: processes 63, identities 106, TCP/UDP 79 ms maximum.
export const RUNNER_PROCESS_QUERY_MAX_MS = 106;
export const RUNNER_NETWORK_QUERY_MAX_MS = 79;
export function queryPollBudget(
  measuredMaximumMs: number,
  intervalMs: number,
  floorMs = 60_000,
) {
  return Math.max(floorMs, Math.ceil(measuredMaximumMs * 3)) + intervalMs;
}
export const PROCESS_POLL_INTERVAL_MS = 100;
export const PROCESS_POLL_TIMEOUT_MS = queryPollBudget(
  RUNNER_PROCESS_QUERY_MAX_MS,
  PROCESS_POLL_INTERVAL_MS,
);
// No runner layout measurement yet: reserve three complete PS query windows.
export const LAYOUT_POLL_TIMEOUT_MS = queryPollBudget(
  WINDOWS_QUERY_TIMEOUT_MS,
  500,
);
export const WATCH_READY_TIMEOUT_MS = queryPollBudget(
  RUNNER_NETWORK_QUERY_MAX_MS,
  50,
);
// A spawned PowerShell service may compile its native reader before ready.
// Reserve three complete query windows until its runner receipt is available.
export const POWERSHELL_READY_TIMEOUT_MS = queryPollBudget(
  WINDOWS_QUERY_TIMEOUT_MS,
  50,
);

export async function pollQuery<T>(
  query: () => Promise<T>,
  accepts: (value: T) => boolean,
  options: { timeoutMs: number; intervalMs: number; message: string },
): Promise<T> {
  const started = performance.now();
  // Await every query to settlement. Predicate expiry never aborts or races an
  // OS query; its per-query limit emits the original QUERY_FAILURE receipt.
  for (;;) {
    const value = await query();
    const elapsed = performance.now() - started;
    if (elapsed <= options.timeoutMs && accepts(value)) return value;
    assert.ok(
      elapsed < options.timeoutMs,
      `${options.message}:QUERY_POLL_TIMEOUT timeoutMs=${options.timeoutMs} durationMs=${Math.ceil(elapsed)}`,
    );
    await wait(Math.min(options.intervalMs, options.timeoutMs - elapsed));
  }
}
