import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  spawnPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';

/** Windows-only generated-file lock. Child lifetime stays inside its owning
 * test and its tracked test process, never a real app or browser process. */
export async function lockGeneratedFile(path: string) {
  const temporary = await mkdtemp(join(tmpdir(), 'sp-generated-lock-')),
    release = join(temporary, 'release');
  const source = `$file=[IO.File]::Open('${path.replaceAll("'", "''")}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); try { [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); while (-not [IO.Directory]::Exists('${release.replaceAll("'", "''")}')) { [Threading.Thread]::Sleep(25) } } finally { $file.Dispose() }`;
  const child = spawnPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(source, 'utf16le').toString('base64'),
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: WINDOWS_QUERY_TIMEOUT_MS,
    },
  );
  child.stderr.resume();
  const exit = new Promise<void>((resolve) =>
    child.once('close', () => resolve()),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('GENERATED_LOCK_TIMEOUT')),
        WINDOWS_QUERY_TIMEOUT_MS,
      );
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('GENERATED_LOCK_EXITED'));
      });
      child.stdout.on('data', (bytes: Buffer) => {
        if (bytes.toString('utf8').includes('LOCKED')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  } catch (error) {
    child.kill();
    await exit;
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return async () => {
    if (!(await lstat(release).catch(() => null))) await mkdir(release);
    await exit;
    await rm(temporary, { recursive: true, force: true });
  };
}
