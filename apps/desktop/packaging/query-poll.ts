import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { WINDOWS_QUERY_TIMEOUT_MS } from './windows-powershell.ts';

// CI 39395902168, 2026-10-20: process identities 22,375 ms,
// listeners 46,441 ms, TCP connections 23,570 ms. Keep these measured
// predecessors until the runner measures their native replacements.
export const RUNNER_PROCESS_QUERY_MAX_MS = 22_375;
export const RUNNER_NETWORK_QUERY_MAX_MS = 46_441;
export function queryPollBudget(
  measuredMaximumMs: number,
  intervalMs: number,
  floorMs = WINDOWS_QUERY_TIMEOUT_MS,
) {
  return Math.max(floorMs, Math.ceil(measuredMaximumMs * 3)) + intervalMs;
}
export const PROCESS_POLL_INTERVAL_MS = 100;
export const PROCESS_POLL_TIMEOUT_MS = queryPollBudget(
  RUNNER_PROCESS_QUERY_MAX_MS,
  PROCESS_POLL_INTERVAL_MS,
);
// No runner layout measurement yet: reserve three full 60 s query windows.
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
