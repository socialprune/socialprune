import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import {
  runNativeQuery,
  runPowerShell,
  spawnPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { pathExists } from '../packaging/file-presence.ts';
import { testEnvironment } from './process-environment.ts';
import { windowsTestBudget } from './windows-test-budgets.ts';
import { collectProof } from '../e2e/proof-collection.ts';
import { windowsShortPath } from './short-path.ts';
import { fetchNsis } from '../packaging/nsis-fetch.ts';
import { cachedHelper } from '../packaging/helper-cache.ts';
import { createHelperScratch } from '../packaging/helper-scratch.ts';

type Receipt = {
  state: string;
  failure: string | null;
  mechanism: string;
  armedBeforeLaunch: boolean;
  armedMs: number;
  launchMs: number;
  settled: boolean;
  outer: { pid: number; exitCode: number; birth: string };
  children: {
    pid: number;
    parentPid: number;
    birth: string;
    exitCode: number;
    exitTime: string;
    imageNameClass: string;
    imagePathClass: string;
  }[];
  queryErrors: string[];
  folderCount: number;
  unExeSha256: string[];
};

test.skipIf(process.platform !== 'win32')(
  'creation-bound capture retains an already-exited copy that the old late poll misses, and fails closed on no child or exit zero',
  async () => {
    const scratch = createHelperScratch('nsis-capture');
    try {
      const outer = join(scratch, 'outer.exe');
      const owned = join(scratch, 'temp');
      const copy = join(owned, '~nsu77000A.tmp', 'Un.exe');
      await mkdir(join(copy, '..'), { recursive: true });
      await copyFile(
        await cachedHelper(
          await readFile(
            join(directory, 'test/nsis-capture-fixture.cs'),
            'utf8',
          ),
        ),
        outer,
      );
      await copyFile(outer, copy);
      const ready = join(scratch, 'ready'),
        poll = join(scratch, 'poll');
      const old = spawnPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'test/uninstaller-poll-legacy.ps1'),
          '-TempRoot',
          owned,
          '-Ready',
          ready,
          '-Poll',
          poll,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          env: testEnvironment(),
        },
      );
      let errors = '';
      old.stdout.resume();
      old.stderr.on('data', (b: Buffer) => {
        errors += b.toString();
      });
      const oldExited = new Promise<number | null>((resolve, reject) => {
        old.once('error', reject);
        old.once('close', resolve);
      });
      const deadline = Date.now() + WINDOWS_QUERY_TIMEOUT_MS;
      while (!(await pathExists(ready)) && Date.now() < deadline)
        await wait(10);
      expect(await pathExists(ready)).toBe(true);
      await runNativeQuery(outer, ['outer', copy, '10'], {
        windowsHide: true,
        timeout: WINDOWS_QUERY_TIMEOUT_MS,
      });
      await writeFile(poll, 'poll');
      expect(await oldExited).toBe(1);
      expect(errors).toContain('NSIS_COPY_NOT_OBSERVED');
      console.log('NSIS_COPY_RED late-first-poll NSIS_COPY_NOT_OBSERVED');

      async function capture(
        name: string,
        args: string[],
        script = join(directory, 'packaging/uninstaller-children.ps1'),
        scope = owned,
        executable = outer,
      ) {
        const file = join(scratch, `${name}.json`),
          receipt = join(scratch, `release-${name}.json`);
        await writeFile(file, JSON.stringify(args));
        let stdout = '',
          code: unknown = 0;
        try {
          stdout = (
            await runPowerShell(
              [
                '-NoProfile',
                '-NonInteractive',
                '-File',
                script,
                '-Executable',
                executable,
                '-ArgumentsFile',
                file,
                '-TempRoot',
                scope,
                '-Receipt',
                receipt,
              ],
              {
                timeout: WINDOWS_QUERY_TIMEOUT_MS,
                windowsHide: true,
                env: testEnvironment(),
              },
            )
          ).stdout;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !('code' in error) ||
            !('stdout' in error)
          )
            throw error;
          code = error.code;
          stdout = String(error.stdout);
        }
        expect(stdout).toContain('NSIS_COPY_RECEIPT ');
        const text = await readFile(receipt, 'utf8');
        expect(text).not.toContain(scratch);
        return { code, value: JSON.parse(text) as Receipt };
      }
      const green = await capture('nsis-copy', ['outer', copy, '10']);
      console.log('NSIS_COPY_GREEN', JSON.stringify(green));
      expect(green.code).toBe(0);
      expect(green.value).toMatchObject({
        state: 'passed',
        mechanism: 'debug-process-events',
        armedBeforeLaunch: true,
        settled: true,
        queryErrors: [],
        folderCount: 1,
      });
      expect(green.value.armedMs).toBeLessThanOrEqual(green.value.launchMs);
      expect(green.value.children).toHaveLength(1);
      expect(green.value.children[0]).toMatchObject({
        parentPid: green.value.outer.pid,
        exitCode: 10,
        imageNameClass: 'un',
        imagePathClass: 'run-owned-nsis-copy',
      });
      expect(green.value.children[0]!.birth).toMatch(/^\d+$/);
      expect(green.value.children[0]!.exitTime).toMatch(/^20/);
      expect(green.value.unExeSha256).toHaveLength(1);
      const short = await windowsShortPath(owned);
      expect(short).not.toBeNull();
      const alias = await capture(
        'nsis-alias',
        ['outer', join(short!, '~nsu77000A.tmp', 'Un.exe'), '10'],
        undefined,
        short!,
      );
      expect(alias.code).toBe(0);
      expect(alias.value.children[0]).toMatchObject({
        imagePathClass: 'run-owned-nsis-copy',
        exitCode: 10,
      });
      const absent = await capture('nsis-none', ['none']);
      expect(absent.code).toBe(1);
      expect(absent.value).toMatchObject({
        state: 'failed',
        failure: 'NSIS_COPY_NOT_STARTED',
        children: [],
      });
      const wrong = await capture('nsis-zero', ['outer', copy, '0']);
      expect(wrong.code).toBe(1);
      expect(wrong.value).toMatchObject({
        state: 'failed',
        failure: 'NSIS_COPY_REFUSAL_EXIT',
        children: [{ exitCode: 0 }],
      });
      console.log('NSIS_COPY_NEGATIVES', JSON.stringify({ absent, wrong }));
      // Fault only in this scratch entrypoint, never the real helper or an env
      // switch: a lost exit code must retain the create evidence and fail.
      const mutation = join(scratch, 'mutation');
      await mkdir(mutation);
      const mutatedScript = join(mutation, 'uninstaller-children.ps1');
      await copyFile(
        join(directory, 'packaging/uninstaller-children.ps1'),
        mutatedScript,
      );
      const native = await readFile(
        join(directory, 'packaging/uninstaller-capture.cs'),
        'utf8',
      );
      expect(native).toContain('row.exitCode=ev.exitCode;');
      await writeFile(
        join(mutation, 'uninstaller-capture.cs'),
        native.replace(
          'row.exitCode=ev.exitCode;',
          'if(ev.pid==launch.pid) row.exitCode=ev.exitCode;',
        ),
      );
      const unknown = await capture(
        'nsis-unknown',
        ['outer', copy, '10'],
        mutatedScript,
      );
      expect(unknown.code).toBe(1);
      expect(unknown.value).toMatchObject({
        failure: 'NSIS_COPY_EXIT_UNKNOWN',
        children: [{ exitCode: null }],
      });
      console.log('NSIS_COPY_UNKNOWN', JSON.stringify(unknown));
      const collected = join(scratch, 'collected');
      await mkdir(collected);
      expect((await collectProof(scratch, collected)).collected).toContain(
        'release-nsis-copy.json',
      );
      expect(
        JSON.parse(
          await readFile(join(collected, 'release-nsis-zero.json'), 'utf8'),
        ),
      ).toMatchObject({ failure: 'NSIS_COPY_REFUSAL_EXIT' });

      // Real pinned NSIS argument parsing and self-copy, without installing or
      // displaying anything. Quoted "/S" is NOT NSIS's silent switch.
      const nsis = await fetchNsis(undefined, { workspace: scratch });
      const nsisSetup = join(scratch, 'setup.exe');
      const nsisUninstall = join(scratch, 'Uninstall.exe');
      const nsisSource = join(scratch, 'fixture.nsi');
      const nsisTemp = join(scratch, 'nsis-temp');
      await mkdir(nsisTemp);
      await writeFile(
        nsisSource,
        `Unicode true\nRequestExecutionLevel user\nSilentInstall silent\nSetCompressor zlib\nOutFile "${nsisSetup}"\nSection\nWriteUninstaller "${nsisUninstall}"\nSectionEnd\nSection "Uninstall"\nIfSilent +3\nSetErrorLevel 0\nQuit\nSetErrorLevel 10\nQuit\nSectionEnd\n`,
      );
      await runNativeQuery(
        join(nsis.directory, 'makensis.exe'),
        ['/NOCONFIG', '/V2', nsisSource],
        { windowsHide: true, timeout: WINDOWS_QUERY_TIMEOUT_MS },
      );
      await runNativeQuery(nsisSetup, [], {
        windowsHide: true,
        timeout: WINDOWS_QUERY_TIMEOUT_MS,
      });
      const real = await capture(
        'nsis-real',
        ['/S'],
        undefined,
        nsisTemp,
        nsisUninstall,
      );
      expect(real.code).toBe(0);
      expect(real.value.children[0]).toMatchObject({
        exitCode: 10,
        imagePathClass: 'run-owned-nsis-copy',
      });
      expect(
        await readFile(join(scratch, 'release-nsis-real.json'), 'utf8'),
      ).not.toContain('tmp');
      console.log('NSIS_COPY_PINNED', JSON.stringify(real));
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  windowsTestBudget(14),
);

test('debug capture stays in proof entrypoints and receipt collection, never the app, engine or installer', async () => {
  const proof = await readFile(
    join(directory, 'e2e/uninstall-controls.ts'),
    'utf8',
  );
  expect(proof).toContain("proofOutput('release-nsis-copy.json')");
  expect(proof).toContain('assert.deepEqual(copyExits, [10])');
  for (const file of [
    'src/main/app.ts',
    'packaging/installer.nsi',
    'packaging/package.ts',
  ]) {
    expect(await readFile(join(directory, file), 'utf8')).not.toMatch(
      /UninstallerCapture|uninstaller-capture|uninstaller-children/,
    );
  }
});
