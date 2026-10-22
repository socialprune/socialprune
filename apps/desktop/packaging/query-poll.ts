import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { runnerQueryCalibration } from './runner-query-calibration.ts';

export const RUNNER_PROCESS_QUERY_MAX_MS =
  runnerQueryCalibration.processIdentity.maximumMs;
export const RUNNER_NETWORK_QUERY_MAX_MS =
  runnerQueryCalibration.networkConnection.maximumMs;
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
  0,
);
export const LAYOUT_POLL_TIMEOUT_MS = queryPollBudget(
  runnerQueryCalibration.layout.maximumMs,
  500,
  0,
);
export const WATCH_READY_TIMEOUT_MS = queryPollBudget(
  runnerQueryCalibration.networkWatchLifetime.maximumMs,
  50,
  0,
);
// Retained helper lifetimes conservatively bound readiness, including compile.
// This is not an isolated startup measurement (see the calibration receipt).
export const POWERSHELL_READY_TIMEOUT_MS = queryPollBudget(
  Math.max(
    runnerQueryCalibration.nativeCompile.maximumMs,
    runnerQueryCalibration.appLaunchLifetime.maximumMs,
    runnerQueryCalibration.networkWatchLifetime.maximumMs,
  ),
  50,
  0,
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
