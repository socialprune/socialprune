import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { directory } from '../build/paths.ts';

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

export async function remainingProcesses(pids: number[]): Promise<number[]> {
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
      `@(Get-Process -Id @(${pids.join(',')}) -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) | ConvertTo-Json -Compress`,
    ],
    { windowsHide: true, timeout: 20_000 },
  );
  return JSON.parse(stdout || '[]') as number[];
}

export async function assertNoRemainingProcesses(
  pids: number[],
): Promise<void> {
  assert.deepEqual(
    await remainingProcesses(pids),
    [],
    'BROWSER_PROCESS_REMAINS',
  );
}

export async function assertNoListeners(pids: number[]): Promise<void> {
  if (
    !pids.length ||
    pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)
  )
    throw new Error('INVALID_PID');
  const script = join(directory, 'build/listeners.ps1').replaceAll("'", "''");
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
