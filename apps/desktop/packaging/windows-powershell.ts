import { execFile, spawn } from 'node:child_process';
import type {
  ChildProcessByStdio,
  ExecFileOptions,
  SpawnOptions,
} from 'node:child_process';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';

// PS7 strips its module paths only for a direct WinPS child, not through Node.
// Let Windows PowerShell build its own discovery paths/cache; keep policy,
// lockdown, TEMP and all other inherited settings intact. No module path is
// hard-coded and no key value is interpreted here.
export function powerShellEnvironment(
  source?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  // eslint-disable-next-line no-restricted-properties -- Opaque subprocess inheritance only; environment values are not read as credentials.
  const env = { ...(source ?? process.env) };
  for (const name of Object.keys(env))
    if (
      [
        'PSMODULEPATH',
        'PSMODULEANALYSISCACHEPATH',
        'PSDISABLEMODULEANALYSISCACHECLEANUP',
      ].includes(name.toUpperCase())
    )
      delete env[name];
  return env;
}

export function runPowerShell(
  args: string[],
  options: Omit<ExecFileOptions, 'encoding' | 'shell'> = {},
) {
  return promisify(execFile)('powershell.exe', args, {
    ...options,
    shell: false,
    encoding: 'utf8',
    env: powerShellEnvironment(options.env),
  }).catch((error: unknown) => {
    throw powerShellFailure(error, args, options.timeout);
  });
}

function powerShellFailure(error: unknown, args: string[], timeout?: number) {
  if (!(error instanceof Error)) return error;
  const file = args.findIndex((arg) => arg.toLowerCase() === '-file');
  return Object.assign(error, {
    powerShell: {
      executable: 'WindowsPowerShell',
      script: file >= 0 ? args[file + 1] : null,
      timeoutMs: timeout ?? null,
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
  const child = spawn('powershell.exe', args, {
    ...options,
    shell: false,
    env: powerShellEnvironment(options.env),
  });
  child.prependListener('error', (error) => {
    powerShellFailure(error, args, options.timeout);
  });
  return child;
}
