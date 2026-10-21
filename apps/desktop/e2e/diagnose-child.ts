import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runProof } from './proof-runtime.ts';
import { proofOutput } from './proof-context.ts';
import { directory } from '../packaging/paths.ts';
import {
  runPowerShell,
  runNativeQuery,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { launchReviewApp } from '../packaging/review-app-launch.ts';
import { runWindowProbe } from '../packaging/window-readiness.ts';
import {
  diagnosticTerms,
  variants,
  type DiagnoseVariant,
} from '../packaging/diagnose-policy.ts';
import { generatedWorkspace } from '../test/workspace.ts';
import {
  settleOwnedUninstall,
  type ProductLayout,
  type OwnedUninstaller,
} from './owned-uninstall.ts';
import {
  prepareWindowsQuery,
  windowsQuery,
} from '../packaging/windows-query.ts';
import { assertFuses } from '../packaging/fuses.ts';
import {
  systemSnapshot,
  compareSystemSnapshots,
} from '../packaging/system-check.ts';
import { watchNetwork } from '../packaging/network-check.ts';

export type DiagnoseConfig = {
  variant: DiagnoseVariant;
  bundle: string;
  setup: string;
  data: string;
  results: string;
  source: string;
};
const mode = process.argv[2]!;
const workspace = process.argv[3]!;
const config = JSON.parse(
  await readFile(process.argv[4]!, 'utf8'),
) as DiagnoseConfig;
variants(config.variant);
assert.ok(['install', 'probe', 'cleanup'].includes(mode));
const ps = async () =>
  JSON.parse(
    (
      await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'packaging/install-layout.ps1'),
        ],
        { timeout: WINDOWS_QUERY_TIMEOUT_MS, windowsHide: true },
      )
    ).stdout,
  ) as ProductLayout & { install: string };

process.exitCode = await runProof(
  `diagnose-${mode}`,
  workspace,
  import.meta.filename,
  async () => {
    const terms = diagnosticTerms(config.variant);
    const before = await ps();
    const nativeReceipt = proofOutput('release-diagnose-process-window.json');
    if (mode === 'install') {
      assert.equal(
        before.installExists,
        false,
        'DIAGNOSE_EXISTING_INSTALL_REFUSED',
      );
      assert.equal(before.dataExists, false, 'DIAGNOSE_EXISTING_DATA_REFUSED');
      assert.equal(
        before.registrationExists,
        false,
        'DIAGNOSE_EXISTING_REGISTRATION_REFUSED',
      );
      const result = await runNativeQuery(config.setup, ['/S'], {
        timeout: WINDOWS_QUERY_TIMEOUT_MS,
        windowsHide: true,
      });
      const after = await ps();
      assert.equal(after.installExists, true);
      assert.equal(after.registrationExists, true);
      await writeFile(
        proofOutput('release-diagnose-install.json'),
        JSON.stringify({
          ...terms,
          state: 'installed',
          exitCode: 0,
          stdoutBytes: result.stdout.length,
          source: config.source,
        }),
      );
      return;
    }
    if (mode === 'cleanup') {
      if (before.installExists) {
        const uninstaller = join(before.install, 'Uninstall.exe');
        await prepareWindowsQuery();
        await runNativeQuery(uninstaller, ['/S'], {
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          windowsHide: true,
        });
        await settleOwnedUninstall(
          ps,
          async () =>
            JSON.parse(
              await windowsQuery(
                'uninstall-processes',
                `${join(workspace, 'temp')}|${uninstaller}`,
              ),
            ) as OwnedUninstaller[],
          async () => {
            await Promise.resolve();
          },
        );
      }
      const after = await ps();
      assert.equal(after.installExists, false);
      assert.equal(after.registrationExists, false);
      await writeFile(
        proofOutput('release-diagnose-cleanup.json'),
        JSON.stringify({ ...terms, state: 'removed', layoutAbsent: true }),
      );
      return;
    }
    assert.equal(before.installExists, true, 'DIAGNOSE_INSTALL_REQUIRED');
    await mkdir(config.data, { recursive: true });
    await generatedWorkspace(config.data);
    const executable =
      config.variant === 'lifecycle-test-build'
        ? join(config.bundle, 'lifecycle/SocialPrune.exe')
        : join(before.install, 'SocialPrune.exe');
    if (config.variant !== 'lifecycle-test-build') {
      const { createHash } = await import('node:crypto');
      assert.equal(
        createHash('sha256')
          .update(await readFile(join(before.install, 'resources/app.asar')))
          .digest('hex'),
        config.source,
        'DIAGNOSE_INSTALLED_ASAR_HASH',
      );
    }
    const fuse = await assertFuses(executable, false);
    await writeFile(
      proofOutput('release-diagnose-fuses.json'),
      JSON.stringify({
        ...terms,
        wire: fuse,
        rendererSandboxSwitchFuse: 'not-defined-by-Electron-V1',
        appEnableSandbox: true,
        requestedRendererSandboxOff: config.variant === 'no-renderer-sandbox',
        fuseForbidsRendererSwitch: false,
        switchEffect:
          config.variant === 'no-renderer-sandbox'
            ? 'requested-not-assumed-effective'
            : 'unchanged',
      }),
    );
    const events = join(workspace, 'evidence/lifecycle.ndjson');
    const args = [
      `--data-dir=${config.data}`,
      '--force-renderer-accessibility',
    ];
    if (config.variant === 'lifecycle-test-build')
      args.push(`--diagnostic-events=${events}`);
    if (config.variant === 'chromium-verbose')
      args.push(
        '--v=1',
        '--enable-logging',
        '--vmodule=gpu*=2,child_process_launcher*=2,render_process_host*=2',
      );
    if (config.variant === 'software-rendering') args.push('--disable-gpu');
    if (config.variant === 'no-renderer-sandbox') args.push('--no-sandbox');
    const systemBefore = await systemSnapshot();
    await writeFile(
      proofOutput('release-diagnose-system-before.json'),
      JSON.stringify({ ...terms, snapshot: systemBefore }),
    );
    const network = await watchNetwork(
      before.install,
      proofOutput('release-diagnose-network.json'),
    );
    let app: Awaited<ReturnType<typeof launchReviewApp>>;
    try {
      app = await launchReviewApp(
        executable,
        args,
        proofOutput('release-app-diagnose.json'),
        { dataDirectory: config.data, chromiumLog: true },
      );
    } catch (error) {
      await network.stop();
      throw error;
    }
    const windowReceipt = proofOutput('release-window-diagnose.json');
    let readinessReached = false;
    let failure: string | null = null;
    let during: Awaited<ReturnType<typeof app.snapshot>> | undefined;
    try {
      await runWindowProbe(
        'packaging/release-window.ps1',
        ['-AppProcessId', String(app.pid), '-Executable', executable],
        windowReceipt,
      );
      readinessReached = true;
    } catch (error) {
      failure =
        error instanceof Error ? error.message.split('\n')[0]! : 'unknown';
    } finally {
      during = await app.snapshot();
      // Read current native visibility, not the readiness poll's earlier sample.
      let nativeWindow: { windows?: { visible: boolean }[] } = {};
      try {
        const script =
          ". '" +
          join(directory, 'packaging/window-readiness.ps1').replaceAll(
            "'",
            "''",
          ) +
          "';$watch=[ReadinessWindows]::WatchApp(" +
          app.pid +
          ',$env:SP_PROOF_DESKTOP);try{$watch.ObserveApp()|ConvertTo-Json -Depth 9 -Compress}finally{$watch.Dispose()}';
        const observed = await runPowerShell(
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { timeout: WINDOWS_QUERY_TIMEOUT_MS, windowsHide: true },
        );
        nativeWindow = JSON.parse(observed.stdout) as typeof nativeWindow;
        await writeFile(
          nativeReceipt,
          JSON.stringify({ ...terms, ...nativeWindow }),
        );
      } catch (error) {
        await writeFile(
          nativeReceipt,
          JSON.stringify({
            ...terms,
            state: 'unavailable',
            code: error instanceof Error && 'code' in error ? error.code : null,
          }),
        );
      }
      if (during.state === 'running')
        await runWindowProbe(
          'packaging/release-window.ps1',
          [
            '-AppProcessId',
            String(app.pid),
            '-Executable',
            executable,
            '-CloseOnly',
          ],
          proofOutput('release-window-diagnose-close.json'),
        ).catch(() => undefined);
      await app.close();
      const final = await app.snapshot();
      const networkObservation = await network.stop();
      const systemAfter = await systemSnapshot();
      await writeFile(
        proofOutput('release-diagnose-system-after.json'),
        JSON.stringify({
          ...terms,
          snapshot: systemAfter,
          comparison: compareSystemSnapshots(systemBefore, systemAfter),
        }),
      );
      const window = JSON.parse(await readFile(windowReceipt, 'utf8')) as {
        state: string;
        branch: string;
        firstOwnedWindowMs: number | null;
        appObservation?: { windows: { visible: boolean }[] };
        last?: { windowFound: boolean };
      };
      const closing = JSON.parse(
        await readFile(
          proofOutput('release-window-diagnose-close.json'),
          'utf8',
        ).catch(() => '{}'),
      ) as typeof window;
      let lifecycle: {
        event: string;
        elapsedMs: number;
        [key: string]: unknown;
      }[] = [];
      if (config.variant === 'lifecycle-test-build') {
        lifecycle = (await readFile(events, 'utf8').catch(() => ''))
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as (typeof lifecycle)[number]);
        await writeFile(
          proofOutput('release-lifecycle-diagnose.json'),
          JSON.stringify({ ...terms, events: lifecycle }),
        );
      }
      const gpu = during.processObservation.processes.filter(
        (row) => row.type === 'gpu-process',
      );
      const renderer = during.processObservation.processes.filter(
        (row) => row.type === 'renderer',
      );
      const summary = {
        ...terms,
        state: readinessReached ? 'ready' : 'observed-failure',
        source: config.source,
        question: config.variant,
        windowCreated: Boolean(
          window.firstOwnedWindowMs != null ||
          window.appObservation?.windows.length,
        ),
        windowVisible:
          (
            nativeWindow.windows ??
            closing.appObservation?.windows ??
            window.appObservation?.windows
          )?.some((row) => row.visible) ?? null,
        windowVisibilitySource:
          'IsWindowVisible-on-owned-HWND; separate from lifecycle-show-event',
        loadURL: lifecycle.some((row) => row.event === 'loadURL-rejected')
          ? 'rejected'
          : lifecycle.some((row) => row.event === 'loadURL-settled')
            ? 'settled'
            : config.variant === 'lifecycle-test-build'
              ? 'pending-or-not-called'
              : 'not-observable-in-release',
        rendererAlive: renderer.length
          ? renderer.some((row) => row.alive)
          : null,
        gpuState: gpu.length
          ? gpu.map((row) => ({
              pid: row.pid,
              born: row.born,
              alive: row.alive,
              exitCode: row.exitCode,
            }))
          : 'not-observed',
        appExit: final.exitCode,
        appState: final.state,
        appExitBeforeCleanup: during.exitCode,
        appStateBeforeCleanup: during.state,
        readinessReached,
        branch: window.branch,
        failure,
        lifecycleReadyToShow: lifecycle.some(
          (row) => row.event === 'ready-to-show',
        ),
        lifecycleShow: lifecycle.some((row) => row.event === 'show'),
        sandboxObserved: final.log.chromiumEvidence.lines.filter((row) =>
          /sandbox/i.test(row.message),
        ),
        gpuLaunchFailures: final.log.chromiumEvidence.lines.filter((row) =>
          /GPU process launch failed/.test(row.message),
        ),
        networkViolations: networkObservation.violations,
      };
      await writeFile(
        proofOutput('release-diagnose-summary.json'),
        JSON.stringify(summary, null, 2),
      );
      console.log('DESKTOP_DIAGNOSE_VARIANT ' + JSON.stringify(summary));
    }
  },
);
