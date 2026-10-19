import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { runPowerShell } from '../packaging/windows-powershell.ts';

/** Read the actual Windows alias of a generated directory, not a made-up one. */
export async function windowsShortPath(
  directory: string,
): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  const { stdout } = await runPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${directory.replaceAll("'", "''")}').ShortPath`,
    ],
    { windowsHide: true, timeout: 20_000 },
  );
  const short = stdout.trim();
  if (
    !isAbsolute(short) ||
    (await realpath(short)) !== (await realpath(directory))
  )
    throw new Error('SHORT_PATH_PROBE_INVALID');
  return short === (await realpath(directory)) ? null : short;
}
