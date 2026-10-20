import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { buildNsis } from '../packaging/nsis.ts';
import { directory } from '../packaging/paths.ts';
import { fetchNsis } from '../packaging/nsis-fetch.ts';
import { proofOutput, proofWorkspace } from './proof-context.ts';
import { pathExists } from '../packaging/file-presence.ts';
import { POWERSHELL_READY_TIMEOUT_MS } from '../packaging/query-poll.ts';
import {
  prepareWindowsQuery,
  windowsQuery,
} from '../packaging/windows-query.ts';
import { settleOwnedUninstall } from './owned-uninstall.ts';
import type { OwnedUninstaller } from './owned-uninstall.ts';
import { layoutDifference } from './layout-difference.ts';
import { failureRecord } from './proof-failure.ts';
import { root } from '../packaging/paths.ts';
import {
  runPowerShell,
  spawnPowerShell,
  runNativeQuery,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';

// Only explicit test entrypoints manufacture altered scripts. Neither the app
// nor the production builder imports this file or reads a fault environment.
const run = runNativeQuery;
const exists = pathExists;
const layout = async () =>
  JSON.parse(
    (
      await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'packaging/install-layout.ps1'),
        ],
        { timeout: WINDOWS_QUERY_TIMEOUT_MS },
      )
    ).stdout,
  ) as {
    install: string;
    installExists: boolean;
    dataExists: boolean;
    registrationExists: boolean;
    updateExists: boolean;
    existingShortcuts: string[];
    registrations: string[];
  };
const before = await layout();
assert.equal(before.installExists, false);
assert.equal(before.dataExists, false);
assert.equal(before.registrationExists, false);
const scratch = await mkdtemp(join(tmpdir(), 'socialprune-installer-faults-'));
const input = join(scratch, 'input');
await mkdir(input);
await writeFile(join(input, 'probe.txt'), 'generated file');
const source = await readFile(
  join(directory, 'packaging/installer.nsi'),
  'utf8',
);
const env = {
  // eslint-disable-next-line no-restricted-properties -- OS directory only, no keys.
  SystemRoot: process.env.SystemRoot,
  TEMP: scratch,
  TMP: scratch,
};
const results: { name: string; redExit: number; greenExit: number }[] = [];
const lifecycle: {
  phase: string;
  difference: ReturnType<typeof layoutDifference>;
  processes?: number;
  productLayoutAbsent?: boolean;
  queries?: number;
  maximumOwnedProcesses?: number;
}[] = [];
async function recordLayout(
  phase: string,
  actual: Awaited<ReturnType<typeof layout>>,
  expected = before,
  state?: { processes: number; productLayoutAbsent: boolean },
) {
  const previous =
    lifecycle.at(-1)?.phase === phase ? lifecycle.at(-1) : undefined;
  const record = {
    phase,
    difference: layoutDifference(actual, expected),
    ...state,
    ...(state
      ? {
          queries: (previous?.queries ?? 0) + 1,
          maximumOwnedProcesses: Math.max(
            previous?.maximumOwnedProcesses ?? 0,
            state.processes,
          ),
        }
      : {}),
  };
  // One current cleanup sample per phase bounds output during a stuck child.
  if (lifecycle.at(-1)?.phase === phase)
    lifecycle[lifecycle.length - 1] = record;
  else lifecycle.push(record);
  await writeFile(
    proofOutput('release-installer-faults-lifecycle.json'),
    JSON.stringify(
      {
        version: 1,
        baseline: 'immediate-before-each-attempt',
        events: lifecycle,
      },
      null,
      2,
    ),
  );
}
async function invoke(file: string): Promise<number> {
  try {
    await run(file, ['/S'], {
      timeout: WINDOWS_QUERY_TIMEOUT_MS,
      windowsHide: true,
      env,
    });
    return 0;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      typeof error.code !== 'number'
    )
      throw error;
    return error.code;
  }
}
async function removeOwned() {
  const uninstaller = join(before.install, 'Uninstall.exe');
  await prepareWindowsQuery();
  if (await exists(uninstaller))
    await run(uninstaller, ['/S'], { timeout: WINDOWS_QUERY_TIMEOUT_MS, env });
  await settleOwnedUninstall(
    layout,
    async () =>
      JSON.parse(
        await windowsQuery('uninstall-processes', scratch + '|' + uninstaller),
      ) as OwnedUninstaller[],
    async ({ processes, productLayoutAbsent, layout: current }) =>
      recordLayout('owned-cleanup', current, before, {
        processes,
        productLayoutAbsent,
      }),
  );
}
let primaryFailure: unknown;
try {
  for (const [name, needle, injected, badBranch] of [
    [
      'first-process',
      "  System::Call 'kernel32::Process32FirstW(p r0, p r1) i .r2'",
      '  StrCpy $2 0',
      ['IntCmp $2 0 processFailureFree', 'IntCmp $2 0 processDone'],
    ],
    [
      'elevated',
      "  System::Call 'shell32::IsUserAnAdmin() i .r4'",
      '  StrCpy $4 1',
      ['IntCmp $4 0 +4', 'Goto +4'],
    ],
    [
      'attribute-read',
      '  System::Call \'kernel32::GetFileAttributesW(w "$ScanPath") i .r4 ?e\'\n  Pop $5',
      '  StrCpy $4 -1\n  StrCpy $5 5',
      ['StrCpy $CheckResult 2', 'Goto pathParent'],
    ],
  ] as const) {
    assert.ok(source.includes(needle));
    for (const red of [true, false]) {
      let script = source.replace(needle, injected);
      if (red) script = script.replace(badBranch[0], badBranch[1]);
      const path = join(scratch, `${name}-${red}.nsi`);
      await writeFile(path, script);
      const setup = join(scratch, `${name}-${red}.exe`);
      await buildNsis(input, setup, '0.0.0', {
        fetch: () => fetchNsis(undefined, { workspace: proofWorkspace() }),
        source: path,
        history: ['probe.txt'],
        generated: join(scratch, `${name}-${red}`),
      });
      const attemptBefore = await layout();
      await recordLayout(
        `${name}-${red ? 'red' : 'green'}-before`,
        attemptBefore,
      );
      const code = await invoke(setup);
      if (red) {
        assert.equal(code, 0, `RED_NOT_REACHED:${name}`);
        assert.equal((await layout()).registrationExists, true);
        console.log(
          `RED_RUN: ${name} old fail-open branch admitted injected failure, exit 0`,
        );
        results.push({ name, redExit: code, greenExit: -1 });
        await removeOwned();
      } else {
        assert.equal(code, 10, `FAULT_NOT_REFUSED:${name}`);
        const actual = await layout();
        await recordLayout(`${name}-green-after`, actual, attemptBefore);
        assert.deepEqual(actual, attemptBefore);
        results.at(-1)!.greenExit = code;
        console.log(
          `GREEN_RUN: ${name} exact refusing branch exits 10; layout unchanged`,
        );
      }
    }
  }
  // The real lock proof must distinguish list failure from a clean uninstall.
  // Erase only the failure accumulator in a disposable test script, never the
  // production installer, and observe the old wrong success/registration loss.
  const partialPath = join(scratch, 'partial.nsi');
  const partialSource = source.replace(
    '  StrCpy $RemovalFailed 1',
    '  StrCpy $RemovalFailed 0',
  );
  const partialSetup = join(scratch, 'partial.exe');
  await writeFile(partialPath, partialSource);
  await buildNsis(input, partialSetup, '0.0.0', {
    fetch: () => fetchNsis(undefined, { workspace: proofWorkspace() }),
    source: partialPath,
    history: ['probe.txt'],
    generated: join(scratch, 'partial'),
  });
  assert.equal(await invoke(partialSetup), 0);
  const ready = join(scratch, 'lock.ready'),
    stop = join(scratch, 'lock.stop');
  const lock = spawnPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'e2e/locked-file.ps1'),
      '-Path',
      join(before.install, 'probe.txt'),
      '-Ready',
      ready,
      '-Stop',
      stop,
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  const lockExited = new Promise<number | null>((resolve, reject) => {
    lock.once('error', reject);
    lock.once('exit', resolve);
  });
  try {
    const deadline = Date.now() + POWERSHELL_READY_TIMEOUT_MS;
    while (!(await exists(ready)) && Date.now() < deadline) await wait(20);
    assert.equal(await exists(ready), true);
    const uninstaller = join(before.install, 'Uninstall.exe');
    const code = await run(uninstaller, ['/S', `_?=${before.install}`], {
      timeout: WINDOWS_QUERY_TIMEOUT_MS,
      env,
    }).then(
      () => 0,
      (error: unknown) => {
        if (
          error instanceof Error &&
          'code' in error &&
          typeof error.code === 'number'
        )
          return error.code;
        throw error;
      },
    );
    assert.equal(code, 0, 'PARTIAL_RED_NOT_REACHED');
    assert.equal((await layout()).registrationExists, false);
    assert.equal(await exists(join(before.install, 'probe.txt')), true);
    console.log(
      'RED_RUN: erased removal-failure accumulator returned 0 and removed registration while locked listed file remained',
    );
  } finally {
    await writeFile(stop, 'stop');
    await lockExited;
    // Reinstall the canonical small script to restore its removal route.
    const canonicalPath = join(scratch, 'canonical.nsi');
    await writeFile(canonicalPath, source);
    const canonicalSetup = join(scratch, 'canonical.exe');
    await buildNsis(input, canonicalSetup, '0.0.0', {
      fetch: () => fetchNsis(undefined, { workspace: proofWorkspace() }),
      source: canonicalPath,
      history: ['probe.txt'],
      generated: join(scratch, 'canonical'),
    });
    assert.equal(await invoke(canonicalSetup), 0);
    await removeOwned();
  }
  await writeFile(
    proofOutput('release-installer-faults.json'),
    JSON.stringify(results, null, 2),
  );
} catch (error) {
  primaryFailure = error;
  throw error;
} finally {
  try {
    await removeOwned();
    await rm(scratch, { recursive: true, force: true });
  } catch (cleanup) {
    await writeFile(
      proofOutput('release-installer-faults-cleanup.json'),
      JSON.stringify(
        {
          primary: primaryFailure
            ? failureRecord(primaryFailure, root, proofWorkspace())
            : null,
          cleanup: failureRecord(cleanup, root, proofWorkspace()),
        },
        null,
        2,
      ),
    );
    if (!primaryFailure) throw cleanup;
  }
}
