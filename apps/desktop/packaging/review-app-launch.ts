import {
  spawnPowerShell,
  RESTRICTED_LAUNCH_TIMEOUT_MS,
} from './windows-powershell.ts';
import { directory } from './paths.ts';
import { testEnvironment } from '../test/process-environment.ts';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { POWERSHELL_READY_TIMEOUT_MS } from './query-poll.ts';

type NativeLaunch = {
  state: string;
  pid: number;
  born: string | null;
  exitCode: number | null;
  explicitDesktop: boolean;
  desktopPath: string;
  desktopVerified: boolean | null;
  desktopVerifiedAtMs: number | null;
  failure: string | null;
};
const startupCodes = (text: string) => [
  ...new Set(
    text.match(
      /DESKTOP_START_FAILED|DESKTOP_LOG_WRITE_FAILED|GPU process isn't usable|gpu_process_host|sandbox_win|InitializeSandbox|FATAL|ERROR|Access is denied|0xC0000142/gi,
    ) ?? [],
  ),
];

export async function launchReviewApp(
  executable: string,
  args: string[],
  receipt: string,
  options: { dataDirectory?: string; chromiumLog?: boolean } = {},
) {
  const argumentFile = receipt + '.args';
  const nativeFile = receipt.replace(/\.json$/, '-native.json');
  const stopFile = receipt + '.stop';
  const chromiumFile = receipt + '.chromium.log';
  const launchArgs = [
    ...args,
    ...(options.chromiumLog
      ? ['--enable-logging=file', `--log-file=${chromiumFile}`]
      : []),
  ];
  await writeFile(argumentFile, JSON.stringify(launchArgs));
  // eslint-disable-next-line no-restricted-properties -- Closed harness desktop identity inherited only from the owned launcher.
  const desktopPath = process.env.SP_PROOF_DESKTOP;
  const child = spawnPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'packaging/review-app-launch.ps1'),
      '-Executable',
      executable,
      '-ArgumentsFile',
      argumentFile,
      '-Receipt',
      nativeFile,
      '-StopFile',
      stopFile,
      '-TimeoutMs',
      String(RESTRICTED_LAUNCH_TIMEOUT_MS),
      ...(desktopPath ? ['-DesktopPath', desktopPath] : []),
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: testEnvironment(),
    },
  );
  let stderr = '',
    stdout = '',
    closed = false;
  let helperExitCode: number | null = null;
  child.stdout.on('data', (bytes: Buffer) => {
    stdout = (stdout + bytes.toString()).slice(-16_384);
  });
  child.stderr.on('data', (bytes: Buffer) => {
    stderr = (stderr + bytes.toString()).slice(-16_384);
  });
  const finished = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      closed = true;
      helperExitCode = code;
      resolve(code);
    });
  });
  let launch: NativeLaunch;
  const readNative = async () =>
    JSON.parse(await readFile(nativeFile, 'utf8')) as NativeLaunch;
  const persist = async () => {
    const native = await readNative();
    const readOptional = async (path: string) =>
      readFile(path, 'utf8').catch((error: unknown) => {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          return '';
        throw error;
      });
    const chromium = (await readOptional(chromiumFile)).slice(-32_768);
    const ownLog = options.dataDirectory
      ? await readOptional(join(options.dataDirectory, 'logs/desktop.ndjson'))
      : '';
    const ownCodes = ownLog
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const row: unknown = JSON.parse(line);
        return row;
      });
    const value = {
      ...native,
      helperClosed: closed,
      helperExitCode,
      environmentClass: 'app-os-allowlist',
      log: {
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        chromiumBytes: Buffer.byteLength(chromium),
        startupCodes: startupCodes(stderr + chromium),
        appRecords: ownCodes,
        stderr,
        chromium,
      },
    };
    await writeFile(receipt, JSON.stringify(value, null, 2));
    return value;
  };
  try {
    const end = Date.now() + POWERSHELL_READY_TIMEOUT_MS;
    while (true) {
      try {
        launch = await readNative();
        break;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 'ENOENT'
        )
          throw error;
      }
      if (closed || Date.now() >= end)
        throw new Error(`REVIEW_APP_LAUNCH_MISSING:${stderr}`);
      await wait(25);
    }
    const observed = await persist();
    if (observed.state === 'failed' || observed.pid === 0)
      throw new Error(`REVIEW_APP_LAUNCH_FAILED:${observed.failure}`);
  } catch (error) {
    if (!closed) child.kill();
    await finished;
    throw error;
  }
  const exited = (async () => {
    const helperCode = await finished;
    const value = await persist();
    if (
      helperCode !== 0 ||
      value.state === 'failed' ||
      value.state === 'timeout'
    )
      throw new Error(
        `REVIEW_APP_LAUNCH_FAILED:${value.failure ?? helperCode}`,
      );
    return value.exitCode;
  })();
  // A native/collector failure is retained and rethrown to the awaited owner;
  // do not turn a pre-probe helper exit into an unhandled rejection.
  void exited.catch(() => undefined);
  return {
    pid: launch.pid,
    exited,
    snapshot: persist,
    async close() {
      if (!closed) await writeFile(stopFile, 'stop');
      await exited;
      await unlink(argumentFile).catch(() => undefined);
      await unlink(stopFile).catch(() => undefined);
    },
  };
}
