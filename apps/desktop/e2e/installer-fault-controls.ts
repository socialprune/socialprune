import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
import { buildNsis } from '../packaging/nsis.ts';
import { directory } from '../packaging/paths.ts';
import { fetchNsis } from '../packaging/nsis-fetch.ts';
import { proofOutput, proofWorkspace } from './proof-context.ts';
import { pathExists } from '../packaging/file-presence.ts';
import {
  runPowerShell,
  spawnPowerShell,
} from '../packaging/windows-powershell.ts';

// Only explicit test entrypoints manufacture altered scripts. Neither the app
// nor the production builder imports this file or reads a fault environment.
const run = promisify(execFile);
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
        { timeout: 30_000 },
      )
    ).stdout,
  ) as {
    install: string;
    installExists: boolean;
    dataExists: boolean;
    registrationExists: boolean;
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
async function invoke(file: string): Promise<number> {
  try {
    await run(file, ['/S'], { timeout: 30_000, windowsHide: true, env });
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
  if (!(await exists(uninstaller))) return;
  await run(uninstaller, ['/S'], { timeout: 30_000, env });
  const deadline = Date.now() + 15_000;
  while ((await exists(uninstaller)) && Date.now() < deadline) await wait(50);
  assert.equal((await layout()).registrationExists, false);
}
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
        assert.deepEqual(await layout(), before);
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
    const deadline = Date.now() + 15_000;
    while (!(await exists(ready)) && Date.now() < deadline) await wait(20);
    assert.equal(await exists(ready), true);
    const uninstaller = join(before.install, 'Uninstall.exe');
    const code = await run(uninstaller, ['/S', `_?=${before.install}`], {
      timeout: 30_000,
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
} finally {
  await removeOwned();
  await rm(scratch, { recursive: true, force: true });
}
