import { spawn } from 'node:child_process';
import type {
  ChildProcessByStdio,
  ExecFileOptions,
  SpawnOptions,
} from 'node:child_process';
import type { Readable } from 'node:stream';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { dist } from './paths.ts';

// 2026-10-20, CI 39413479033 + 39442592668, retained artifact maxima (ms):
// native-query-compile 45974 (not only the 26753 first call), firewall 36981,
// NSIS fixture 33390, ACL 33055, inline 29760, identity parity 28940,
// socket parity 28782, fresh-profile 28300, short-path 27744.
// Use the maximum over BOTH artifacts, not the dispatch's selected samples.
// Native table calls remain 50-106 ms; fault-injection deadlines stay explicit.
export const WINDOWS_QUERY_TIMEOUT_MS = Math.max(60_000, 45_974 * 3) + 100;
// Outer restricted launch includes this PS start, profile verification's PS
// start and a generated child's PS start, each allowed its full query window.
export const RESTRICTED_LAUNCH_TIMEOUT_MS =
  WINDOWS_QUERY_TIMEOUT_MS * 3 + 15_000 + 100;
// Test-only native token probes receive the same target; they cannot select an
// alternate shell or discovery path outside this launcher boundary.
export const WINDOWS_POWERSHELL_EXECUTABLE = 'powershell.exe';
// Diagnostic discovery only. Existing proof launches never select this engine.
export const WINDOWS_PWSH_EXECUTABLE = 'pwsh.exe';

type QueryOptions = Omit<ExecFileOptions, 'encoding' | 'shell'> & {
  queryClass?: string;
};

// Harness only. Node 24.21.0 libuv adds CREATE_NO_WINDOW for windowsHide when
// every stdio slot is a pipe/ignore. Inherit fd 0 instead: the existing console
// stays attached, SW_HIDE remains set, and the owned kill-on-close job remains
// inherited. No detached process, breakaway, new console, or token change.
export function inheritedConsoleStdio(
  stdio: SpawnOptions['stdio'],
): SpawnOptions['stdio'] {
  if (stdio === 'inherit') return stdio;
  if (Array.isArray(stdio)) {
    if (stdio.some((slot) => slot === 'inherit' || typeof slot === 'number'))
      return stdio;
    if (stdio[0] !== 'ignore' && stdio[0] !== undefined && stdio[0] !== null)
      throw new Error('HARNESS_CONSOLE_REQUIRES_INHERITED_FD');
    return ['inherit', ...stdio.slice(1)];
  }
  return [
    'inherit',
    stdio === 'ignore' ? 'ignore' : 'pipe',
    stdio === 'ignore' ? 'ignore' : 'pipe',
  ];
}

async function bufferedQuery(
  executable: string,
  args: string[],
  options: Omit<QueryOptions, 'queryClass'>,
) {
  const { maxBuffer = 1024 * 1024, ...execution } = options;
  const child = spawn(executable, args, {
    ...execution,
    shell: false,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [],
    stderr: Buffer[] = [];
  let outputBytes = 0,
    errorBytes = 0,
    failure: Error | undefined;
  const collect = (
    target: Buffer[],
    stream: 'stdout' | 'stderr',
    bytes: Buffer,
  ) => {
    if (stream === 'stdout') outputBytes += bytes.length;
    else errorBytes += bytes.length;
    if (outputBytes > maxBuffer || errorBytes > maxBuffer) {
      failure ??= Object.assign(
        new Error(stream + ' maxBuffer length exceeded'),
        { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' },
      );
      child.kill();
      return;
    }
    target.push(bytes);
  };
  child.stdout.on('data', (bytes: Buffer) => collect(stdout, 'stdout', bytes));
  child.stderr.on('data', (bytes: Buffer) => collect(stderr, 'stderr', bytes));
  child.once('error', (error) => {
    failure ??= error;
  });
  const [code, signal] = await new Promise<
    [number | null, NodeJS.Signals | null]
  >((resolve) => {
    child.once('close', (code, signal) => resolve([code, signal]));
  });
  const result = {
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
  if (failure || code !== 0 || signal !== null || child.killed) {
    const error =
      failure ??
      Object.assign(
        new Error(
          `Command failed: ${executable} ${args.join(' ')}\n${result.stderr}`,
        ),
        { code: child.killed ? null : code },
      );
    throw Object.assign(error, result, {
      killed: child.killed,
      signal:
        signal ?? (child.killed ? (options.killSignal ?? 'SIGTERM') : null),
    });
  }
  return result;
}
type QueryReceipt = {
  queryClass: string;
  durationMs: number;
  timeoutMs: number | null;
  killed: boolean;
  signal: string | null;
  failed: boolean;
};
type QuerySummary = {
  queryClass: string;
  count: number;
  failures: number;
  firstMs: number;
  minimumMs: number;
  maximumMs: number;
  totalMs: number;
  durationsMs: number[];
  last: QueryReceipt;
};
const measurementId = randomUUID();
const summaries = new Map<string, QuerySummary>();
let measurementDirectory: string | undefined;
let measurementConfigured = false;

export function setQueryMeasurementDirectory(directory: string | undefined) {
  measurementDirectory = directory;
  measurementConfigured = true;
  summaries.clear();
}

function recordQuery(receipt: QueryReceipt) {
  const previous = summaries.get(receipt.queryClass);
  summaries.set(receipt.queryClass, {
    queryClass: receipt.queryClass,
    count: (previous?.count ?? 0) + 1,
    failures: (previous?.failures ?? 0) + Number(receipt.failed),
    firstMs: previous?.firstMs ?? receipt.durationMs,
    minimumMs: Math.min(
      previous?.minimumMs ?? receipt.durationMs,
      receipt.durationMs,
    ),
    maximumMs: Math.max(previous?.maximumMs ?? 0, receipt.durationMs),
    totalMs: (previous?.totalMs ?? 0) + receipt.durationMs,
    durationsMs: [...(previous?.durationsMs ?? []), receipt.durationMs],
    last: receipt,
  });
  const destinations = measurementConfigured
    ? measurementDirectory
      ? [measurementDirectory]
      : []
    : [join(dist, 'red-controls'), dist];
  const text =
    JSON.stringify({ version: 1, queries: [...summaries.values()] }) + '\n';
  for (const destination of destinations) {
    try {
      mkdirSync(destination, { recursive: true });
      writeFileSync(
        join(destination, `release-query-${measurementId}.json`),
        text,
      );
    } catch (error) {
      // Never erase measurement failure or replace the query's original result.
      console.error(
        'QUERY_MEASUREMENT_WRITE_FAILED',
        JSON.stringify({
          queryClass: receipt.queryClass,
          code:
            error instanceof Error && 'code' in error ? error.code : 'UNKNOWN',
        }),
      );
    }
  }
}

function queryFailure(error: unknown, receipt: QueryReceipt) {
  if (!(error instanceof Error)) return error;
  const original = error.message;
  error.message = `QUERY_FAILURE queryClass=${receipt.queryClass} killed=${receipt.killed} signal=${receipt.signal} timeoutMs=${receipt.timeoutMs} durationMs=${receipt.durationMs}\n${original}`;
  return Object.assign(error, { query: receipt });
}

function receiptFor(
  queryClass: string,
  started: number,
  timeout: number | undefined,
  error?: unknown,
): QueryReceipt {
  return {
    queryClass,
    durationMs: Math.ceil(performance.now() - started),
    timeoutMs: timeout ?? null,
    killed:
      error instanceof Error && 'killed' in error && error.killed === true,
    signal:
      error instanceof Error &&
      'signal' in error &&
      typeof error.signal === 'string'
        ? error.signal
        : null,
    failed: error !== undefined,
  };
}

export async function runNativeQuery(
  executable: string,
  args: string[],
  options: QueryOptions = {},
) {
  const {
    queryClass = 'native-' +
      basename(executable).replace(/[^A-Za-z0-9.-]/g, '_'),
    ...execution
  } = options;
  const started = performance.now();
  try {
    const result = await bufferedQuery(executable, args, {
      ...execution,
    });
    recordQuery(receiptFor(queryClass, started, options.timeout));
    return result;
  } catch (error) {
    const receipt = receiptFor(queryClass, started, options.timeout, error);
    recordQuery(receipt);
    throw queryFailure(error, receipt);
  }
}

function powerShellClass(args: string[]) {
  const file = args.findIndex((arg) => arg.toLowerCase() === '-file');
  if (file >= 0)
    return (
      'ps-' +
      basename(args[file + 1] ?? 'unknown').replace(/[^A-Za-z0-9.-]/g, '_')
    );
  const command = args.join(' ');
  for (const [pattern, name] of [
    [/listeners\.ps1/i, 'listeners'],
    [/connections\.ps1/i, 'connections'],
    [/Get-CimInstance/i, 'cim-processes'],
    [/Get-Process/i, 'process-identities'],
    [/FileSystemObject/i, 'short-path'],
    [/WindowsPrincipal/i, 'token-membership'],
  ] as const)
    if (pattern.test(command)) return name;
  return 'ps-inline';
}

// PS7 strips its module paths only for a direct WinPS child, not through Node.
// Let Windows PowerShell build its own discovery paths/cache; keep policy,
// lockdown, TEMP and all other inherited settings intact. No module path is
// hard-coded and no key value is interpreted here.
export function powerShellEnvironment(
  source?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  // eslint-disable-next-line no-restricted-properties -- Opaque subprocess inheritance only; environment values are not read as credentials.
  const inherited = source ?? process.env;
  const env: NodeJS.ProcessEnv = {};
  const names = new Map<string, string>();
  for (const [name, value] of Object.entries(inherited)) {
    const identity = name.toUpperCase();
    const previous = names.get(identity);
    if (previous) delete env[previous];
    names.set(identity, name);
    if (
      [
        'PSMODULEPATH',
        'PSMODULEANALYSISCACHEPATH',
        'PSDISABLEMODULEANALYSISCACHECLEANUP',
      ].includes(identity)
    )
      continue;
    // A caller's rightmost override wins before Node sorts Windows env keys.
    // Otherwise an inherited uppercase policy/TEMP key can defeat the caller's
    // mixed-case override. Unoverridden policy and lockdown values stay intact.
    env[name] = value;
  }
  return env;
}

export async function runPowerShell(
  args: string[],
  options: QueryOptions = {},
) {
  const { queryClass = powerShellClass(args), ...execution } = options;
  const started = performance.now();
  try {
    const result = await bufferedQuery(WINDOWS_POWERSHELL_EXECUTABLE, args, {
      ...execution,
      env: powerShellEnvironment(options.env),
    });
    recordQuery(receiptFor(queryClass, started, options.timeout));
    return result;
  } catch (error) {
    const receipt = receiptFor(queryClass, started, options.timeout, error);
    recordQuery(receipt);
    queryFailure(error, receipt);
    powerShellFailure(error, args, options.timeout, receipt.durationMs);
    const file = args.findIndex((arg) => arg.toLowerCase() === '-file');
    const report = args.findIndex(
      (arg) => arg.toLowerCase() === '-tokenreport',
    );
    if (
      file >= 0 &&
      /(?:^|[\\/])limited-token\.ps1$/i.test(args[file + 1] ?? '') &&
      report >= 0 &&
      args[report + 1]
    ) {
      try {
        const { preserveLimitedProofFailure } =
          await import('./limited-proof-diagnostics.ts');
        const evidence = await preserveLimitedProofFailure(
          args[report + 1]!,
          error,
        );
        if (error instanceof Error)
          Object.assign(error, { limitedProofEvidence: evidence });
      } catch (diagnosticError) {
        console.error(
          'LIMITED_PROOF_CAUSE_WRITE_FAILED',
          diagnosticError instanceof Error && 'code' in diagnosticError
            ? diagnosticError.code
            : 'UNKNOWN',
        );
      }
    }
    throw error;
  }
}

function powerShellFailure(
  error: unknown,
  args: string[],
  timeout?: number,
  durationMs?: number,
) {
  if (!(error instanceof Error)) return error;
  const file = args.findIndex((arg) => arg.toLowerCase() === '-file');
  return Object.assign(error, {
    powerShell: {
      executable: 'WindowsPowerShell',
      script: file >= 0 ? args[file + 1] : null,
      timeoutMs: timeout ?? null,
      durationMs: durationMs ?? null,
      killed: 'killed' in error && error.killed === true,
      signal:
        'signal' in error && typeof error.signal === 'string'
          ? error.signal
          : null,
      errorId:
        'stderr' in error && typeof error.stderr === 'string'
          ? (error.stderr.match(
              /FullyQualifiedErrorId\s*:\s*([A-Za-z0-9_.]+)\b/,
            )?.[1] ?? null)
          : null,
    },
  });
}

export function spawnPowerShell(
  args: string[],
  options: SpawnOptions & { stdio: ['ignore', 'pipe', 'pipe'] },
): ChildProcessByStdio<null, Readable, Readable>;
export function spawnPowerShell(
  args: string[],
  options?: SpawnOptions,
): ReturnType<typeof spawn>;
export function spawnPowerShell(args: string[], options: SpawnOptions = {}) {
  const started = performance.now();
  const child = spawn(WINDOWS_POWERSHELL_EXECUTABLE, args, {
    ...options,
    shell: false,
    stdio: inheritedConsoleStdio(options.stdio),
    env: powerShellEnvironment(options.env),
  });
  child.prependListener('error', (error) => {
    const receipt = receiptFor(
      powerShellClass(args),
      started,
      options.timeout,
      error,
    );
    queryFailure(error, receipt);
    powerShellFailure(error, args, options.timeout, receipt.durationMs);
  });
  child.once('close', (code, signal) => {
    const receipt = {
      ...receiptFor(powerShellClass(args), started, options.timeout),
      failed: code !== 0,
      killed: child.killed,
      signal,
    };
    recordQuery(receipt);
    if (receipt.failed && receipt.killed)
      console.error(
        `QUERY_FAILURE queryClass=${receipt.queryClass} killed=${receipt.killed} signal=${receipt.signal} timeoutMs=${receipt.timeoutMs} durationMs=${receipt.durationMs}`,
      );
  });
  return child;
}
