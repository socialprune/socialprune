import {
  spawnPowerShell,
  RESTRICTED_LAUNCH_TIMEOUT_MS,
} from './windows-powershell.ts';
import { directory } from './paths.ts';
import { testEnvironment } from '../test/process-environment.ts';
import { readFile, writeFile, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { POWERSHELL_READY_TIMEOUT_MS } from './query-poll.ts';
import { StartupLog } from './startup-log.ts';
import { createReadStream } from 'node:fs';

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
  processObservation: {
    scope: 'owned-job-only';
    pollIntervalMs: number;
    shortLivedProcessesMayBeMissed: boolean;
    failures: string[];
    processes: {
      pid: number;
      born: string;
      type: string;
      alive: boolean;
      exitCode: number | null;
      observedExitedBeforeCleanup: boolean;
      failure: string | null;
      nativeError: number | null;
    }[];
  };
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
  const cacheAtLaunch: Record<string, boolean> = {};
  if (options.dataDirectory)
    for (const name of [
      'GPUPersistentCache',
      'GPUCache',
      'DawnGraphiteCache',
      'DawnWebGPUCache',
    ]) {
      try {
        await lstat(join(options.dataDirectory, name));
        cacheAtLaunch[name] = true;
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw error;
        cacheAtLaunch[name] = false;
      }
    }
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
  const stderrLog = new StartupLog();
  let stderr = '',
    stdout = '',
    closed = false;
  let helperExitCode: number | null = null;
  child.stdout.on('data', (bytes: Buffer) => {
    stdout = (stdout + bytes.toString()).slice(-16_384);
  });
  child.stderr.on('data', (bytes: Buffer) => {
    stderrLog.append(bytes);
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
  let observationReadRetries = 0;
  const readNative = async () => {
    // File.Replace can briefly hold the same owned receipt during a read.
    // Retry only that measured sharing conflict; retain its count and bound.
    for (let attempt = 0; ; attempt++) {
      try {
        return JSON.parse(await readFile(nativeFile, 'utf8')) as NativeLaunch;
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            error.code === 'EBUSY'
          ) ||
          attempt === 20
        )
          throw error;
        observationReadRetries++;
        await wait(25);
      }
    }
  };
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
    const chromiumLog = new StartupLog(32_768);
    try {
      for await (const bytes of createReadStream(chromiumFile))
        chromiumLog.append(bytes as Buffer);
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ))
        throw error;
    }
    const chromiumEvidence = chromiumLog.snapshot();
    const stderrEvidence = stderrLog.snapshot();
    const chromium = chromiumEvidence.tail;
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
      observationReadRetries,
      cacheAtLaunch,
      environmentClass: 'app-os-allowlist',
      log: {
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: stderrEvidence.bytes,
        chromiumBytes: chromiumEvidence.bytes,
        stderrEvidence,
        chromiumEvidence,
        startupCodes: startupCodes(
          stderrEvidence.lines.map((line) => line.message).join('\n') +
            chromiumEvidence.lines.map((line) => line.message).join('\n'),
        ),
        productEvents: {
          readyToShow: 'not-exposed-by-release',
          firstShow: 'not-exposed-by-release',
          sourceShowGate: 'loadURL-resolved',
        },
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
