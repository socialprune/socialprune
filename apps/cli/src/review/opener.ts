import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { CliError } from '../cli/errors.ts';

type Spawn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;
export const OPENER_SCRIPT =
  '$u = [Console]::In.ReadLine(); Start-Process -FilePath $u';

export function openReviewBrowser(
  url: string,
  platform: string = process.platform,
  start: Spawn = spawn,
): Promise<void> {
  // Only the app-built loopback URL is accepted, never a caller's path or text.
  if (
    !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/#bootstrap=[A-Za-z0-9_-]{43}$/.test(
      url,
    )
  )
    return Promise.reject(new CliError('BROWSER_OPEN_FAILED'));
  const command =
    platform === 'win32'
      ? 'powershell.exe'
      : platform === 'darwin'
        ? 'open'
        : 'xdg-open';
  const args =
    platform === 'win32'
      ? ['-NoProfile', '-NonInteractive', '-Command', OPENER_SCRIPT]
      : [url];
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = start(command, args, {
        shell: false,
        stdio: platform === 'win32' ? ['pipe', 'ignore', 'ignore'] : 'ignore',
        windowsHide: true,
      });
    } catch {
      reject(new CliError('BROWSER_OPEN_FAILED'));
      return;
    }
    const fail = () => reject(new CliError('BROWSER_OPEN_FAILED'));
    child.once('error', fail);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new CliError('BROWSER_OPEN_FAILED')),
    );
    if (platform === 'win32') {
      if (!child.stdin) {
        fail();
        return;
      }
      child.stdin.once('error', fail);
      try {
        child.stdin.write(`${url}\n`);
        child.stdin.end();
      } catch {
        fail();
      }
    }
  });
}
