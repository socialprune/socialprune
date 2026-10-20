import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import {
  powerShellEnvironment,
  runPowerShell,
  spawnPowerShell,
  runNativeQuery,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { windowsShortPath } from './short-path.ts';
import { testEnvironment } from './process-environment.ts';
import { WINDOWS_QUERY_TEST_TIMEOUT_MS } from './windows-test-budgets.ts';

test.skipIf(process.platform !== 'win32')(
  'proof ACL loads Windows PowerShell modules despite an inherited incompatible Security module',
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'socialprune-module-path-'));
    try {
      const modules = join(scratch, 'modules');
      const module = join(modules, 'Microsoft.PowerShell.Security');
      await mkdir(module, { recursive: true });
      await writeFile(
        join(module, 'Microsoft.PowerShell.Security.psd1'),
        "@{ ModuleVersion='99.0.0'; GUID='04f2c054-a984-4d2a-b152-a5501c436b50'; RootModule='Security.psm1'; FunctionsToExport=@('Get-Acl') }",
      );
      await writeFile(
        join(module, 'Security.psm1'),
        "#requires -Version 7.0\nfunction Get-Acl { throw 'GENERATED_INCOMPATIBLE_MODULE_LOADED' }; Export-ModuleMember -Function Get-Acl",
      );
      const env = testEnvironment({
        PSModulePath: modules,
        PSModuleAnalysisCachePath: join(scratch, 'analysis-cache'),
        TEMP: scratch,
        TMP: scratch,
      });
      const args = [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        join(directory, 'e2e/proof-acl.ps1'),
        '-Action',
        'grant',
        '-Root',
        scratch,
      ];
      // Control copies the actual launcher and removes only its environment
      // boundary. No unchecked launch exists outside the shared helper in source.
      const source = await readFile(
        join(directory, 'packaging/windows-powershell.ts'),
        'utf8',
      );
      const baseline = join(scratch, 'baseline.mts');
      await writeFile(
        baseline,
        source
          .replaceAll(
            'env: powerShellEnvironment(options.env)',
            'env: options.env',
          )
          .replace(
            "from './paths.ts'",
            `from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/paths.ts')).href)}`,
          ),
      );
      const old = join(scratch, 'old.mjs');
      await writeFile(
        old,
        `import {runPowerShell} from ${JSON.stringify(pathToFileURL(baseline).href)}; await runPowerShell(${JSON.stringify(args)}, {timeout:60000});`,
      );
      const legacy = await runNativeQuery(process.execPath, [old], {
        env,
        timeout: 90_000,
        windowsHide: true,
      }).then(
        () => ({ code: 0, stderr: '' }),
        (error: unknown) => {
          if (
            !(error instanceof Error) ||
            !('code' in error) ||
            !('stderr' in error)
          )
            throw error;
          return { code: error.code, stderr: String(error.stderr) };
        },
      );
      expect(legacy.code).toBe(1);
      expect(legacy.stderr).toContain('CouldNotAutoloadMatchingModule');
      const { stdout } = await runPowerShell(args, {
        env,
        timeout: WINDOWS_QUERY_TIMEOUT_MS,
        windowsHide: true,
      });
      expect(JSON.parse(stdout)).toMatchObject({
        action: 'grant',
        paths: [{ pathClass: 'run-root', absent: false }],
      });
      const short = await windowsShortPath(scratch);
      if (short) {
        const shortArgs = [...args];
        shortArgs[shortArgs.length - 1] = short;
        expect(
          JSON.parse(
            (
              await runPowerShell(shortArgs, {
                env,
                timeout: WINDOWS_QUERY_TIMEOUT_MS,
                windowsHide: true,
              })
            ).stdout,
          ),
        ).toMatchObject({ action: 'grant' });
      }
      const restricted = join(scratch, 'restricted.mjs');
      await writeFile(
        restricted,
        `import {runPowerShell} from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/windows-powershell.ts')).href)}; import {testEnvironment} from ${JSON.stringify(pathToFileURL(join(directory, 'test/process-environment.ts')).href)}; console.log((await runPowerShell(${JSON.stringify(args)},{env:testEnvironment(${JSON.stringify({ PSModulePath: modules, PSModuleAnalysisCachePath: join(scratch, 'foreign-cache') })}),timeout:60000})).stdout);`,
      );
      const argumentsFile = join(scratch, 'arguments.json'),
        report = join(scratch, 'token.json');
      await writeFile(argumentsFile, JSON.stringify([restricted]));
      await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'e2e/limited-token.ps1'),
          '-Executable',
          process.execPath,
          '-ArgumentsFile',
          argumentsFile,
          '-TokenReport',
          report,
        ],
        { env, timeout: 180_000, windowsHide: true },
      );
      expect(
        JSON.parse((await readFile(report, 'utf8')).replace(/^\uFEFF/, '')),
      ).toMatchObject({
        childExit: 0,
        adminMember: false,
        integrity: 'medium',
        profile: { sameUserSid: true, parentHkcuMarkerRead: true },
      });
      expect(await readFile(join(module, 'Security.psm1'), 'utf8')).toContain(
        'GENERATED_INCOMPATIBLE_MODULE_LOADED',
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  300_000,
);

test('the shared boundary removes discovery state case-insensitively without relaxing policy or changing caller env', () => {
  const source = {
    PSModulePath: 'poison',
    psmodulepath: 'poison2',
    PSModuleAnalysisCachePath: 'foreign-cache',
    PSDisableModuleAnalysisCacheCleanup: '1',
    PSExecutionPolicyPreference: 'Restricted',
    __PSLockdownPolicy: '4',
    POWERSHELL_TELEMETRY_OPTOUT: '1',
    TEMP: 'generated',
    KEEP: 'unchanged',
  };
  expect(powerShellEnvironment(source)).toEqual({
    PSExecutionPolicyPreference: 'Restricted',
    __PSLockdownPolicy: '4',
    POWERSHELL_TELEMETRY_OPTOUT: '1',
    TEMP: 'generated',
    KEEP: 'unchanged',
  });
  expect(source.PSModulePath).toBe('poison');
});

test('explicit Windows caller values replace every inherited case variant before spawn', () => {
  const source = {
    PSEXECUTIONPOLICYPREFERENCE: 'Bypass',
    PSExecutionPolicyPreference: 'Restricted',
    __PSLOCKDOWNPOLICY: '4',
    __PSLockdownPolicy: '4',
    TEMP: 'parent-owned',
    Temp: 'generated-child',
  };
  const result = powerShellEnvironment(source);
  for (const [name, expected] of [
    ['PSEXECUTIONPOLICYPREFERENCE', 'Restricted'],
    ['__PSLOCKDOWNPOLICY', '4'],
    ['TEMP', 'generated-child'],
  ] as const) {
    expect(
      Object.entries(result).filter(([key]) => key.toUpperCase() === name),
    ).toHaveLength(1);
    expect(
      Object.entries(result).find(([key]) => key.toUpperCase() === name)?.[1],
    ).toBe(expected);
  }
  expect(source.PSEXECUTIONPOLICYPREFERENCE).toBe('Bypass');
});

test('fixture environments admit OS settings only and never inherit PowerShell policy/discovery overrides', () => {
  const env = testEnvironment({
    TEMP: 'generated-child',
    Temp: 'generated-final',
    PSExecutionPolicyPreference: 'Restricted',
  });
  expect(
    Object.entries(env).filter(([name]) => name.toUpperCase() === 'TEMP'),
  ).toEqual([['Temp', 'generated-final']]);
  expect(
    Object.entries(env).filter(
      ([name]) => name.toUpperCase() === 'PSEXECUTIONPOLICYPREFERENCE',
    ),
  ).toEqual([['PSExecutionPolicyPreference', 'Restricted']]);
  const clean = testEnvironment();
  expect(
    Object.keys(clean).filter((name) => /^(?:PS|POWERSHELL_|__PS)/i.test(name)),
  ).toEqual([]);
});

test.skipIf(process.platform !== 'win32')(
  'buffered launches resolve duplicate-case explicit policy while preserving unoverridden policy and lockdown',
  async () => {
    for (const inherited of ['Bypass', 'Restricted']) {
      const source = {
        ...testEnvironment(),
        PSEXECUTIONPOLICYPREFERENCE: inherited,
        __PSLockdownPolicy: '0',
      };
      const command = [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "[Console]::Write((Get-ExecutionPolicy -Scope Process).ToString()+'|'+$env:__PSLockdownPolicy)",
      ];
      expect(
        (
          await runPowerShell(command, {
            env: source,
            timeout: WINDOWS_QUERY_TIMEOUT_MS,
            windowsHide: true,
          })
        ).stdout,
      ).toBe(`${inherited}|0`);
      expect(
        (
          await runPowerShell(command, {
            env: { ...source, PSExecutionPolicyPreference: 'Restricted' },
            timeout: WINDOWS_QUERY_TIMEOUT_MS,
            windowsHide: true,
          })
        ).stdout,
      ).toBe('Restricted|0');
    }
  },
  150_000,
);

function assertLaunchBoundary(source: string) {
  if (
    /powershell(?:_ise)?\.exe|\bpwsh(?:\.exe)?|['"`](?:[^'"`\r\n]*[\\/])?powershell(?:_ise)?['"`]/i.test(
      source,
    )
  )
    throw new Error('WINDOWS_POWERSHELL_LAUNCH_OUTSIDE_HELPER');
}

test('all desktop PowerShell targets, including native restricted children and generated probes, use one helper', async () => {
  for (const planted of [
    "spawn('powershell.exe', [])",
    "execFile('PowerShell', [])",
    '& pwsh.exe -File probe.ps1',
    'WindowsPowerShell\\v1.0\\powershell.exe',
  ])
    expect(() => assertLaunchBoundary(planted)).toThrow(
      'WINDOWS_POWERSHELL_LAUNCH_OUTSIDE_HELPER',
    );
  async function visit(folder: string): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (
        ['node_modules', 'dist', 'test-results', 'playwright-report'].includes(
          entry.name,
        )
      )
        continue;
      const file = join(folder, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (
        /\.(?:[cm]?[jt]sx?|cs|ps1|psm1|cmd|bat|json)$/.test(entry.name)
      ) {
        const name = relative(directory, file).replaceAll('\\', '/');
        if (
          name === 'packaging/windows-powershell.ts' ||
          name === 'test/powershell.test.ts'
        )
          continue;
        const source = await readFile(file, 'utf8');
        // Function names/comments may mention PowerShell. A launch target or
        // executable path cannot be declared by any other source file.
        expect(() => assertLaunchBoundary(source), name).not.toThrow();
      }
    }
  }
  await visit(directory);
  const native = await readFile(
    join(directory, 'e2e/limited-token.ps1'),
    'utf8',
  );
  expect(native).toContain('profile-hive-child.ts');
  expect(native).not.toContain('WindowsPowerShell');
});

test.skipIf(process.platform !== 'win32')(
  'streaming launch also rebuilds module paths and preserves a restrictive execution policy',
  async () => {
    const child = spawnPowerShell(
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "[Console]::Write(($PSVersionTable.PSVersion.Major).ToString()+'|'+(Get-ExecutionPolicy -Scope Process))",
      ],
      {
        env: testEnvironment({
          PSModulePath: 'generated-unusable',
          PSExecutionPolicyPreference: 'Restricted',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        timeout: WINDOWS_QUERY_TIMEOUT_MS,
      },
    );
    let stdout = '';
    child.stdout.on('data', (bytes: Buffer) => {
      stdout += bytes.toString();
    });
    child.stderr.resume();
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    expect(code).toBe(0);
    expect(stdout).toBe('5|Restricted');
  },
  WINDOWS_QUERY_TEST_TIMEOUT_MS,
);

test.skipIf(process.platform !== 'win32')(
  'a shared helper launch failure survives in the child evidence receipt',
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'socialprune-shell-failure-'));
    try {
      const child = join(scratch, 'child.mjs');
      await writeFile(
        child,
        `import {runProof} from ${JSON.stringify(pathToFileURL(join(directory, 'e2e/proof-runtime.ts')).href)}; import {runPowerShell} from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/windows-powershell.ts')).href)}; process.exitCode=await runProof('controls',${JSON.stringify(scratch)},${JSON.stringify(join(directory, 'packaging/windows-powershell.ts'))},()=>runPowerShell(['-NoProfile','-NonInteractive','-Command','exit 0'],{cwd:${JSON.stringify(join(scratch, 'absent'))}}));`,
      );
      await expect(
        runNativeQuery(process.execPath, [child], {
          env: testEnvironment(),
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          windowsHide: true,
        }),
      ).rejects.toMatchObject({ code: 1 });
      const receipt = JSON.parse(
        await readFile(join(scratch, 'release-child-controls.json'), 'utf8'),
      ) as {
        mode: string;
        state: string;
        failure: { code: string; syscall: string };
      };
      expect(receipt).toMatchObject({
        mode: 'controls',
        state: 'failed',
        failure: { code: 'ENOENT' },
      });
      expect(receipt.failure.syscall).toContain('spawn');
      expect(receipt).toMatchObject({
        failure: {
          powerShell: { executable: 'WindowsPowerShell', killed: false },
        },
      });
      const timed = join(scratch, 'timeout');
      await mkdir(timed);
      const waiting = join(timed, 'wait.ps1');
      await writeFile(waiting, '[Threading.Thread]::Sleep(10000)');
      await writeFile(
        child,
        `import {runProof} from ${JSON.stringify(pathToFileURL(join(directory, 'e2e/proof-runtime.ts')).href)}; import {runPowerShell} from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/windows-powershell.ts')).href)}; process.exitCode=await runProof('smoke',${JSON.stringify(timed)},${JSON.stringify(child)},()=>runPowerShell(['-NoProfile','-NonInteractive','-File',${JSON.stringify(waiting)}],{timeout:300}));`,
      );
      await expect(
        runNativeQuery(process.execPath, [child], {
          env: testEnvironment(),
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          windowsHide: true,
        }),
      ).rejects.toMatchObject({ code: 1 });
      expect(
        JSON.parse(
          await readFile(join(timed, 'release-child-smoke.json'), 'utf8'),
        ),
      ).toMatchObject({
        state: 'failed',
        failure: {
          code: 'WINDOWS_POWERSHELL_TIMEOUT',
          powerShell: {
            script: { pathClass: 'run-owned', path: 'wait.ps1' },
            timeoutMs: 300,
            killed: true,
            signal: 'SIGTERM',
          },
        },
      });
      const profileReport = join(
        scratch,
        'release-token-controls.profile.json',
      );
      await expect(
        runNativeQuery(
          process.execPath,
          [
            join(directory, 'e2e/profile-hive-child.ts'),
            join(scratch, 'absent.ps1'),
            '-Report',
            profileReport,
          ],
          {
            timeout: WINDOWS_QUERY_TIMEOUT_MS,
            windowsHide: true,
            env: testEnvironment(),
          },
        ),
      ).rejects.toMatchObject({ code: 1 });
      const profileFailure = JSON.parse(
        await readFile(profileReport, 'utf8'),
      ) as { failure: { code: unknown } };
      expect(profileFailure).toMatchObject({
        state: 'failed',
        phase: 'profile-hive',
      });
      expect(typeof profileFailure.failure.code).toBe('number');
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  60_000,
);
