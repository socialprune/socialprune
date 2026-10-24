import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  spawnPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';

/** Test-only deny-delete reader for one generated preference. */
export async function lockLanguageFile(path: string) {
  const temporary = await mkdtemp(join(tmpdir(), 'sp-language-lock-'));
  const release = join(temporary, 'release');
  const quote = (value: string) => value.replaceAll("'", "''");
  const source = `$file=[IO.File]::Open('${quote(path)}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); try { [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); while(-not [IO.Directory]::Exists('${quote(release)}')) { [Threading.Thread]::Sleep(10) } } finally { $file.Dispose() }`;
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
  const exited = new Promise<void>((resolve) =>
    child.once('close', () => resolve()),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('LANGUAGE_LOCK_TIMEOUT')),
        WINDOWS_QUERY_TIMEOUT_MS,
      );
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('LANGUAGE_LOCK_EXITED'));
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
    await exited;
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await mkdir(release);
    await exited;
    await rm(temporary, { recursive: true, force: true });
  };
}
