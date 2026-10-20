import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directory } from './paths.ts';
import {
  runNativeQuery,
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from './windows-powershell.ts';

let configured: string | undefined;
let compiled: Promise<string> | undefined;
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
  const { stdout } = await runNativeQuery(
    await prepareWindowsQuery(),
    [operation, argument],
    {
      timeout: WINDOWS_QUERY_TIMEOUT_MS,
      windowsHide: true,
      signal,
      queryClass: `native-${operation}`,
    },
  );
  return stdout;
}
