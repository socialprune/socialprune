import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directory, dist } from './paths.ts';
import {
  runNativeQuery,
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from './windows-powershell.ts';

let configured: string | undefined;
let compiled: Promise<string> | undefined;
let diagnosticDirectory = dist;
const diagnosticId = randomUUID();
const uninstallQueries: unknown[] = [];
export function setWindowsQueryDiagnosticDirectory(directory: string) {
  diagnosticDirectory = directory;
  uninstallQueries.length = 0;
}
function recordUninstallQuery(stderr: string, state: 'returned' | 'failed') {
  try {
    const candidates: unknown[] = stderr
      .split(/\r?\n/)
      .filter((line) => line.startsWith('UNINSTALL_PROCESS_FILTER '))
      .map(
        (line) =>
          JSON.parse(line.slice('UNINSTALL_PROCESS_FILTER '.length)) as unknown,
      );
    const record = { sequence: uninstallQueries.length + 1, state, candidates };
    uninstallQueries.push(record);
    process.stderr.write(
      'UNINSTALL_QUERY_RECEIPT ' + JSON.stringify(record) + '\n',
    );
    mkdirSync(diagnosticDirectory, { recursive: true });
    writeFileSync(
      join(diagnosticDirectory, `release-uninstall-query-${diagnosticId}.json`),
      JSON.stringify({
        version: 1,
        queryClass: 'native-uninstall-processes',
        queries: uninstallQueries,
      }),
    );
  } catch (error) {
    console.error(
      'UNINSTALL_QUERY_RECEIPT_WRITE_FAILED',
      error instanceof Error && 'code' in error ? error.code : 'UNKNOWN',
    );
  }
}
export function setWindowsQueryExecutable(executable: string) {
  configured = executable;
}
export function prepareWindowsQuery(): Promise<string> {
  if (configured) return Promise.resolve(configured);
  // One private compiler output per harness process; never ship this helper in
  // any app variant. Probe engines receive an explicit run-owned copy.
  compiled ??= (async () => {
    const folder = await mkdtemp(join(tmpdir(), 'socialprune-native-query-'));
    const output = join(folder, 'desktop-query.exe');
    try {
      await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Add-Type -Path '${join(directory, 'packaging/windows-query.cs').replaceAll("'", "''")}' -OutputAssembly '${output.replaceAll("'", "''")}' -OutputType ConsoleApplication`,
        ],
        {
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          windowsHide: true,
          queryClass: 'native-query-compile',
        },
      );
      // Readback before using or copying an executable created by the compiler.
      if (!(await readFile(output)).subarray(0, 2).equals(Buffer.from('MZ')))
        throw new Error('QUERY_HELPER_BUILD_INVALID');
      process.once('exit', () => {
        try {
          rmSync(folder, { recursive: true, force: true });
        } catch {
          console.error('QUERY_HELPER_CLEANUP_FAILED');
        }
      });
      return output;
    } catch (error) {
      await rm(folder, { recursive: true, force: true });
      throw error;
    }
  })();
  return compiled;
}
export async function windowsQuery(
  operation:
    | 'processes'
    | 'identities'
    | 'listeners'
    | 'connections'
    | 'uninstall-processes',
  argument: string,
  signal?: AbortSignal,
) {
  let result;
  try {
    result = await runNativeQuery(
      await prepareWindowsQuery(),
      [operation, argument],
      {
        timeout: WINDOWS_QUERY_TIMEOUT_MS,
        windowsHide: true,
        signal,
        queryClass: `native-${operation}`,
      },
    );
  } catch (error) {
    if (operation === 'uninstall-processes')
      recordUninstallQuery(
        error instanceof Error &&
          'stderr' in error &&
          typeof error.stderr === 'string'
          ? error.stderr
          : '',
        'failed',
      );
    throw error;
  }
  if (operation === 'uninstall-processes')
    recordUninstallQuery(result.stderr, 'returned');
  return result.stdout;
}
