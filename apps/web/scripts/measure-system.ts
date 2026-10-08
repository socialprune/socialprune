import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, statfs } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export const web = fileURLToPath(new URL('../', import.meta.url));
export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const execute = promisify(execFile);
export const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function bytes(path: string): Promise<number> {
  const info = await stat(path).catch(() => null);
  if (!info) return 0;
  if (info.isFile()) return info.size;
  let total = 0;
  for (const child of await readdir(path, { withFileTypes: true })) {
    if (child.isSymbolicLink())
      throw new Error('Unexpected measurement symlink.');
    total += await bytes(join(path, child.name));
  }
  return total;
}

export async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => {
      reject(new Error('Owned measurement process did not stop.'));
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(deadline);
      resolve();
    });
    child.kill();
  });
}

export async function command(
  args: string[],
  signal: AbortSignal,
): Promise<void> {
  const child = spawn(process.execPath, args, {
    cwd: web,
    stdio: ['ignore', 'pipe', 'pipe'],
    signal,
  });
  child.stdout?.pipe(process.stderr, { end: false });
  child.stderr?.pipe(process.stderr, { end: false });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (code !== 0) throw new Error(`Build exited ${code}.`);
  } finally {
    await stop(child);
  }
}

export interface SourceFile {
  path: string;
  bytes: number;
  sha256: string;
}
export async function fileIdentity(path: string): Promise<SourceFile> {
  const content = await readFile(join(root, path));
  return {
    path,
    bytes: content.byteLength,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

export async function sourceIdentity(includeBuild: boolean) {
  const paths: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(join(root, directory), {
      withFileTypes: true,
    })) {
      if (entry.isSymbolicLink())
        throw new Error('Source symlink not admitted.');
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (!/\.test\.tsx?$/.test(entry.name) && entry.name !== 'testing.ts')
        paths.push(path);
    }
  }
  for (const path of [
    'apps/web/src',
    'packages/core/src',
    'packages/adapter-x/src',
    'packages/adapter-instagram/src',
    'tools/fixture-gen/src',
    'apps/web/tooling',
    ...(includeBuild ? ['apps/web/dist'] : []),
  ])
    await walk(path);
  paths.push(
    'pnpm-lock.yaml',
    'apps/web/index.html',
    'apps/web/vite.config.ts',
    'tools/fixture-gen/src/cli.ts',
    'apps/web/scripts/memory-sampler.ps1',
  );
  for (const entry of await readdir(join(web, 'scripts')))
    if (/^measure-.*\.ts$/.test(entry)) paths.push(`apps/web/scripts/${entry}`);
  const files = await Promise.all([...new Set(paths)].sort().map(fileIdentity));
  const sha256 = createHash('sha256')
    .update(JSON.stringify(files))
    .digest('hex');
  return { sha256, files, includesBuild: includeBuild };
}

export async function freeSpace(path: string) {
  const info = await statfs(path, { bigint: true });
  return {
    volumePath: path,
    freeBytes: Number(info.bsize * info.bavail),
    totalBytes: Number(info.bsize * info.blocks),
    observedAt: new Date().toISOString(),
  };
}

export interface CpuLoad {
  observedAt: string;
  intervalMs: number;
  totalCpuPercent: number;
  idleExcluded: boolean;
  processes: { name: string; cpuSeconds: number | null; cpuPercent: number }[];
}

export async function cpuLoad(signal: AbortSignal): Promise<CpuLoad> {
  // PIDs correlate two samples internally. Only process names and CPU values
  // leave PowerShell; no command lines, paths, environment or handles are read.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$before = @{}',
    'Get-Process | ForEach-Object { $before[$_.Id] = $_.CPU }',
    '$start = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()',
    'Start-Sleep -Milliseconds 1000',
    '$end = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()',
    '$seconds = ($end - $start) / 1000.0',
    `$cores = ${cpus().length}`,
    '$rows = @(Get-Process | ForEach-Object { $delta = 0.0; if ($before.ContainsKey($_.Id) -and $null -ne $_.CPU -and $null -ne $before[$_.Id]) { $delta = [Math]::Max(0.0, $_.CPU - $before[$_.Id]) }; @{ name = $_.ProcessName; cpuSeconds = $_.CPU; cpuPercent = 100.0 * $delta / $seconds / $cores } })',
    '$total = 0.0; foreach ($row in $rows) { if ($row.name -ne "Idle") { $total += $row.cpuPercent } }',
    '[Console]::WriteLine((@{ observedAt = [DateTimeOffset]::FromUnixTimeMilliseconds($end).ToString("o"); intervalMs = $end - $start; totalCpuPercent = $total; idleExcluded = $true; processes = $rows } | ConvertTo-Json -Depth 4 -Compress))',
  ].join('; ');
  const { stdout } = await execute(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: 15_000, signal, maxBuffer: 1024 * 1024 },
  );
  return JSON.parse(stdout) as CpuLoad;
}
