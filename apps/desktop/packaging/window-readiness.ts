import { join } from 'node:path';
import { directory } from './paths.ts';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from './windows-powershell.ts';

// 2026-10-21, CI 39533867125: successful ps-smoke-window.ps1 4472 ms,
// including UIA discovery and its 3 s observation. The release-window failures
// at 45426/45977 ms were censored by a bad root lookup, not ready measurements.
// Add-Type initialization precedes this clock and retains its own query budget.
export const WINDOW_READINESS_TIMEOUT_MS = 4_472 * 3 + 50;
export const WINDOW_PROBE_TIMEOUT_MS =
  WINDOW_READINESS_TIMEOUT_MS + WINDOWS_QUERY_TIMEOUT_MS + 3_000;

export function runWindowProbe(
  script:
    | 'packaging/release-window.ps1'
    | 'packaging/smoke-window.ps1'
    | 'e2e/inactive-window-probe.ps1',
  args: string[],
  receipt: string,
) {
  return runPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, script),
      ...args,
      '-ReadinessTimeoutMs',
      String(WINDOW_READINESS_TIMEOUT_MS),
      '-Receipt',
      receipt,
    ],
    { timeout: WINDOW_PROBE_TIMEOUT_MS, windowsHide: true },
  );
}
