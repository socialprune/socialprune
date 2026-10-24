import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { cpus, platform, release, totalmem, tmpdir } from 'node:os';
import { join } from 'node:path';

const execute = promisify(execFile);
export const SCALE_STOP = join(tmpdir(), 'kilo', 'phase2', 'STOP');
export const SCALE_OUTPUT = join(tmpdir(), 'kilo', 'phase2', 's8');
export function scaleStop() {
  if (existsSync(SCALE_STOP))
    throw new Error('STOP exists; scale run stopped.');
}
async function powershell(command: string) {
  scaleStop();
  const result = await execute(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { timeout: 30_000, windowsHide: true },
  );
  return JSON.parse(result.stdout.trim()) as unknown;
}
export async function scaleHost() {
  if (platform() !== 'win32')
    throw new Error(
      'This measurement uses Windows physical-memory and owned-process counters.',
    );
  const state = (await powershell(
    '$os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_Processor; [pscustomobject]@{freePhysicalBytes=[long]$os.FreePhysicalMemory*1024;cpuLoadPercent=@($cpu.LoadPercentage);osBuild=$os.BuildNumber} | ConvertTo-Json -Compress',
  )) as {
    freePhysicalBytes: number;
    cpuLoadPercent: number[];
    osBuild: string;
  };
  return {
    ...state,
    observedAt: new Date().toISOString(),
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    node: process.version,
  };
}
export async function scaleOwnedMemory(rootPid: number) {
  if (!Number.isInteger(rootPid) || rootPid <= 0)
    throw new Error('Owned browser PID required.');
  const value = await powershell(
    `$all=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId); $ids=New-Object 'System.Collections.Generic.HashSet[int]'; [void]$ids.Add(${rootPid}); do { $changed=$false; foreach($p in $all) { if($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { [void]$ids.Add([int]$p.ProcessId); $changed=$true } } } while($changed); $processes=@(foreach($id in $ids) { Get-Process -Id $id -ErrorAction SilentlyContinue }); [pscustomobject]@{rootPid=${rootPid};processCount=$processes.Count;privateBytes=[long](($processes | Measure-Object PrivateMemorySize64 -Sum).Sum);workingSetBytes=[long](($processes | Measure-Object WorkingSet64 -Sum).Sum)} | ConvertTo-Json -Compress`,
  );
  return {
    ...(value as {
      rootPid: number;
      processCount: number;
      privateBytes: number;
      workingSetBytes: number;
    }),
    observedAt: new Date().toISOString(),
  };
}
export type ScaleHost = Awaited<ReturnType<typeof scaleHost>>;
