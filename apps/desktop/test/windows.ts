import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { directory } from '../packaging/paths.ts';

const run = promisify(execFile);
export interface ProcessRow {
  ProcessId: number;
  ParentProcessId: number;
  ExecutablePath: string;
}

export async function appProcesses(executable: string): Promise<ProcessRow[]> {
  const escaped = executable.replaceAll("'", "''");
  const { stdout } = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `@((Get-CimInstance Win32_Process -Filter "Name = 'SocialPrune.exe'") | Where-Object { $_.ExecutablePath -eq '${escaped}' } | Select-Object ProcessId, ParentProcessId, ExecutablePath) | ConvertTo-Json -Compress`,
    ],
    { windowsHide: true, timeout: 20_000 },
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
  const { stdout } = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `ConvertTo-Json -InputObject @(Get-Process -Id @(${pids.join(',')}) -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -Compress`,
    ],
    { windowsHide: true, timeout: 20_000, signal },
  );
  return JSON.parse(stdout || '[]') as number[];
}

export async function assertNoRemainingProcesses(
  pids: number[],
): Promise<void> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 15_000);
  let remaining = pids;
  try {
    do {
      try {
        remaining = await remainingProcesses(pids, controller.signal);
        if (!remaining.length) return;
        await wait(100, undefined, { signal: controller.signal });
      } catch (error) {
        if (!controller.signal.aborted) throw error;
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
  const { stdout } = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `& '${script}' -ProcessIds @(${pids.join(',')})`,
    ],
    { windowsHide: true, timeout: 20_000 },
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
  const { stdout } = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `& '${script}' -ProcessIds @(${pids.join(',')})`,
    ],
    { windowsHide: true, timeout: 20_000 },
  );
  assert.deepEqual(JSON.parse(stdout) as unknown, [], 'APP_CONNECTION');
}
