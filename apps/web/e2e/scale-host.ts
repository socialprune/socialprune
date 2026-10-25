import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { cpus, freemem, platform, release, totalmem, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const execute = promisify(execFile);
export const SCALE_STOP = join(tmpdir(), 'kilo', 'phase2', 'STOP');
export const SCALE_OUTPUT =
  // eslint-disable-next-line no-restricted-properties -- Explicit measurement artifact path, never credentials.
  process.env['SP_SCALE_OUTPUT'] ?? join(tmpdir(), 'kilo', 'phase2', 's8');
// eslint-disable-next-line no-restricted-properties -- Test-only loopback port.
export const SCALE_PORT = Number(process.env['SP_SCALE_PORT'] ?? '4707');
if (!Number.isInteger(SCALE_PORT) || SCALE_PORT < 4701 || SCALE_PORT > 4720)
  throw Error('Scale port must be4701..4720.');
export function scaleStop() {
  if (existsSync(SCALE_STOP))
    throw new Error('STOP exists; scale run stopped.');
}
export function parseLinuxProcess(pid: number, status: string) {
  const parent = /^PPid:\s+(\d+)/m.exec(status),
    rss = /^VmRSS:\s+(\d+)/m.exec(status);
  if (!Number.isInteger(pid) || pid <= 0 || !parent)
    throw Error('Invalid proc status.');
  return { pid, parent: Number(parent[1]), rss: Number(rss?.[1] ?? 0) * 1024 };
}
export function linuxOwnedMemory(
  rootPid: number,
  processes: readonly { pid: number; parent: number; rss: number }[],
) {
  const ids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes)
      if (ids.has(process.parent) && !ids.has(process.pid)) {
        ids.add(process.pid);
        changed = true;
      }
  }
  return {
    processCount: ids.size,
    workingSetBytes: processes
      .filter((process) => ids.has(process.pid))
      .reduce((sum, process) => sum + process.rss, 0),
  };
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
  const before = cpus();
  if (platform() !== 'win32') await pause(100);
  const after = cpus();
  const total = after.reduce(
    (sum, cpu, index) =>
      sum +
      Object.values(cpu.times).reduce((a, b) => a + b, 0) -
      Object.values(before[index]!.times).reduce((a, b) => a + b, 0),
    0,
  );
  const idle = after.reduce(
    (sum, cpu, index) => sum + cpu.times.idle - before[index]!.times.idle,
    0,
  );
  const state =
    platform() === 'win32'
      ? ((await powershell(
          '$os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_Processor; [pscustomobject]@{freePhysicalBytes=[long]$os.FreePhysicalMemory*1024;cpuLoadPercent=@($cpu.LoadPercentage);osBuild=$os.BuildNumber} | ConvertTo-Json -Compress',
        )) as {
          freePhysicalBytes: number;
          cpuLoadPercent: number[];
          osBuild: string;
        })
      : {
          freePhysicalBytes: freemem(),
          cpuLoadPercent: [total ? 100 * (1 - idle / total) : 0],
          osBuild: release(),
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
  if (platform() === 'linux') {
    const processes: { pid: number; parent: number; rss: number }[] = [];
    for (const name of await readdir('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const status = await readFile(`/proc/${name}/status`, 'utf8');
        processes.push(parseLinuxProcess(Number(name), status));
      } catch {
        /* Process exited between enumeration and read. */
      }
    }
    return {
      rootPid,
      ...linuxOwnedMemory(rootPid, processes),
      privateBytes: null,
      boundary:
        'Linux summed VmRSS; shared pages may be counted twice; Windows private bytes unavailable.',
      observedAt: new Date().toISOString(),
    };
  }
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
