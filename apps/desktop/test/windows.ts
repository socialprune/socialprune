import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { directory } from '../packaging/paths.ts';
import { testEnvironment } from './process-environment.ts';

export interface ProcessRow {
  ProcessId: number;
  ParentProcessId: number;
  ExecutablePath: string;
}

export interface ProcessIdentity {
  pid: number;
  born: string;
}

export async function processIdentities(
  pids: number[],
  signal?: AbortSignal,
): Promise<ProcessIdentity[]> {
  if (pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0))
    throw new Error('INVALID_PID');
  if (!pids.length) return [];
  const { stdout } = await runPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `ConvertTo-Json -InputObject @(Get-Process -Id @(${pids.join(',')}) -ErrorAction SilentlyContinue | ForEach-Object { @{pid=$_.Id;born=$_.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()} }) -Compress`,
    ],
    {
      windowsHide: true,
      timeout: WINDOWS_QUERY_TIMEOUT_MS,
      signal,
      env: testEnvironment(),
    },
  );
  return JSON.parse(stdout || '[]') as ProcessIdentity[];
}

export function matchingProcessIdentities(
  expected: ProcessIdentity[],
  observed: ProcessIdentity[],
): ProcessIdentity[] {
  return expected.filter((entry) =>
    observed.some((row) => row.pid === entry.pid && row.born === entry.born),
  );
}

export async function appProcesses(executable: string): Promise<ProcessRow[]> {
  const escaped = executable.replaceAll("'", "''");
  const { stdout } = await runPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `@((Get-CimInstance Win32_Process -Filter "Name = 'SocialPrune.exe'") | Where-Object { $_.ExecutablePath -eq '${escaped}' } | Select-Object ProcessId, ParentProcessId, ExecutablePath) | ConvertTo-Json -Compress`,
    ],
    {
      windowsHide: true,
      timeout: WINDOWS_QUERY_TIMEOUT_MS,
      env: testEnvironment(),
    },
  );
  return JSON.parse(stdout || '[]') as ProcessRow[];
}

export async function remainingProcesses(
  pids: number[],
  signal?: AbortSignal,
): Promise<number[]> {
  if (pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0))
    throw new Error('INVALID_PID');
  if (!pids.length) return [];
  // CDP supplied these exact disposable-browser PIDs. No other browser's
  // process, command line, profile or metadata is inspected.
  const { stdout } = await runPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `ConvertTo-Json -InputObject @(Get-Process -Id @(${pids.join(',')}) -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -Compress`,
    ],
    {
      windowsHide: true,
      timeout: WINDOWS_QUERY_TIMEOUT_MS,
      signal,
      env: testEnvironment(),
    },
  );
  return JSON.parse(stdout || '[]') as number[];
}

export async function assertNoRemainingProcesses(
  processes: number[] | ProcessIdentity[],
): Promise<void> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 15_000);
  let remaining: number[] | ProcessIdentity[] = processes;
  try {
    do {
      try {
        if (typeof processes[0] === 'object') {
          const identities = processes as ProcessIdentity[];
          remaining = matchingProcessIdentities(
            identities,
            await processIdentities(
              identities.map((entry) => entry.pid),
              controller.signal,
            ),
          );
        } else {
          remaining = await remainingProcesses(
            processes as number[],
            controller.signal,
          );
        }
        if (!remaining.length) return;
        await wait(100, undefined, { signal: controller.signal });
      } catch (error) {
        if (!controller.signal.aborted) throw error;
        if (error instanceof Error && 'query' in error)
          console.error('PROCESS_QUERY_ABORTED', error.message);
      }
    } while (!controller.signal.aborted);
  } finally {
    clearTimeout(deadline);
  }
  assert.deepEqual(remaining, [], 'BROWSER_PROCESS_REMAINS');
}

export async function assertNoListeners(pids: number[]): Promise<void> {
  if (
    !pids.length ||
    pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)
  )
    throw new Error('INVALID_PID');
  const script = join(directory, 'packaging/listeners.ps1').replaceAll(
    "'",
    "''",
  );
  const { stdout } = await runPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `& '${script}' -ProcessIds @(${pids.join(',')})`,
    ],
    {
      windowsHide: true,
      timeout: WINDOWS_QUERY_TIMEOUT_MS,
      env: testEnvironment(),
    },
  );
  const counts = JSON.parse(stdout) as { tcp: number; udp: number };
  assert.deepEqual(counts, { tcp: 0, udp: 0 }, 'APP_LISTENER');
}

export async function assertNoConnections(pids: number[]): Promise<void> {
  if (
    !pids.length ||
    pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)
  )
    throw new Error('INVALID_PID');
  const script = join(directory, 'packaging/connections.ps1').replaceAll(
    "'",
    "''",
  );
  const { stdout } = await runPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `& '${script}' -ProcessIds @(${pids.join(',')})`,
    ],
    {
      windowsHide: true,
      timeout: WINDOWS_QUERY_TIMEOUT_MS,
      env: testEnvironment(),
    },
  );
  assert.deepEqual(JSON.parse(stdout) as unknown, [], 'APP_CONNECTION');
}
