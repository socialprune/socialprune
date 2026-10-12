import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { CliError } from '../cli/errors.ts';
import { profileInUse } from './profile.ts';

export const SETUP_URL = 'https://x.com/i/flow/login';
export function setupArguments(profile: string): string[] {
  return [
    `--user-data-dir=${resolve(profile)}`,
    '--no-first-run',
    '--no-default-browser-check',
    // A dedicated sign-in window must not keep running as a background app.
    '--disable-background-mode',
    SETUP_URL,
  ];
}

export interface SetupOptions {
  profile: string;
  executablePath: string;
  signal: AbortSignal;
  notice(text: string): void;
}
export interface SetupWait {
  pollMs: number;
  releaseTimeoutMs: number;
  appearanceTimeoutMs?: number;
}
const normalWait: Readonly<SetupWait> = Object.freeze({
  pollMs: 200,
  releaseTimeoutMs: 30_000,
  appearanceTimeoutMs: 60_000,
});

/** An ordinary browser child: no driver, debugging pipe or page access. */
export async function ordinarySetup(
  options: SetupOptions,
  wait: SetupWait = normalWait,
): Promise<void> {
  options.signal.throwIfAborted();
  if (await profileInUse(options.profile)) {
    options.notice(
      'This dedicated profile is still in use. Close its browser window before setup. No browser was started.\n',
    );
    throw new CliError('PROFILE_INVALID');
  }
  options.notice(
    'Sign in by hand in the window that opens, then close it. This is an ordinary browser window with no program attached. Your normal browser profile is not touched. Keep this dedicated profile outside the workspace and synced folders. After closing the window, you may press Enter if setup is still waiting.\n',
  );
  const child = spawn(options.executablePath, setupArguments(options.profile), {
    stdio: 'ignore',
    shell: false,
    windowsHide: false,
    // A Windows launcher may hand its window to another process. Keep that
    // process outside Node's kill-on-close job when the CLI eventually exits.
    detached: process.platform === 'win32',
  });
  let exited = false,
    exitCode: number | null = null,
    launchError: Error | undefined;
  child.once('error', (error) => {
    launchError = error;
    exited = true;
  });
  child.once('exit', (code) => {
    exitCode = code;
    exited = true;
  });
  child.unref();
  const inputWasPaused = process.stdin.isPaused();
  const terminal = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
    terminal: false,
  });
  let enter = false,
    cancelled = false,
    deadline: number | null = null,
    observedLock = false,
    confirmedReleased = false,
    stoppedOwnedChild = false;
  const appearanceDeadline =
    Date.now() + (wait.appearanceTimeoutMs ?? normalWait.appearanceTimeoutMs!);
  options.notice(
    'Waiting for the dedicated browser profile to become active, then for its window to close.\n',
  );
  terminal.on('line', () => {
    enter = true;
  });
  const cancel = () => {
    cancelled = true;
  };
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  options.signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      if (launchError) throw new CliError('BROWSER_NOT_FOUND');
      if (cancelled || options.signal.aborted) {
        options.notice(
          'Setup stopped waiting. Close the dedicated browser window yourself; no other browser process was stopped.\n',
        );
        throw new CliError('CANCELLED');
      }
      const inUse = await profileInUse(options.profile);
      if (inUse && !observedLock)
        options.notice(
          'The dedicated browser profile is active. Sign in by hand, then close its window.\n',
        );
      observedLock ||= inUse;
      if (exited && !inUse && (observedLock || confirmedReleased)) {
        if (exitCode !== 0 && !stoppedOwnedChild)
          throw new CliError('DELETE_FAILED');
        return;
      }
      if (observedLock && !inUse && !exited && deadline === null)
        deadline = Date.now() + wait.releaseTimeoutMs;
      if (enter) {
        enter = false;
        if (inUse || (!exited && !observedLock)) {
          options.notice(
            'The dedicated profile is still in use, or the window has not finished opening. Close the window before pressing Enter.\n',
          );
        } else {
          confirmedReleased = true;
          if (!exited) {
            // The person confirms closure and the observed profile lock is released.
            // Stop only the direct child we spawned, never a discovered browser.
            stoppedOwnedChild = child.kill('SIGTERM');
          }
        }
        deadline ??= Date.now() + wait.releaseTimeoutMs;
      }
      if (
        !observedLock &&
        !confirmedReleased &&
        Date.now() >= appearanceDeadline
      ) {
        options.notice(
          'The dedicated profile never became active within 60 seconds. Setup cannot confirm that a window opened. If a window is visible, sign in and close it yourself; otherwise run setup again. No browser process was stopped.\n',
        );
        throw new CliError('PROFILE_INVALID');
      }
      if (deadline !== null && Date.now() >= deadline) {
        options.notice(
          'Setup could not confirm that the browser process ended and released this profile within 30 seconds. Close the dedicated window and its background process yourself, then run setup again. No other browser was stopped.\n',
        );
        throw new CliError('PROFILE_INVALID');
      }
      await delay(wait.pollMs);
    }
  } finally {
    terminal.close();
    if (inputWasPaused) process.stdin.pause();
    options.signal.removeEventListener('abort', cancel);
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    child.unref();
  }
}
