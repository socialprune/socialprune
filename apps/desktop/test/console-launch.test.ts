import { expect, test } from 'vitest';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { directory, dist } from '../packaging/paths.ts';
import {
  inheritedConsoleStdio,
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
  RESTRICTED_LAUNCH_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { testEnvironment } from './process-environment.ts';
import { RESTRICTED_SEQUENCE_TEST_TIMEOUT_MS } from './windows-test-budgets.ts';

test('buffered nested proof queries inherit a standard fd so libuv cannot request CREATE_NO_WINDOW for hidden console children', async () => {
  const source = await readFile(
    join(directory, 'packaging/windows-powershell.ts'),
    'utf8',
  );
  // Node 24.21.0 deps/uv/src/win/process.c adds CREATE_NO_WINDOW for
  // windowsHide only when EVERY stdio slot is non-inherited. This is a
  // deterministic option-level red, independent of runner conhost behavior.
  expect(source).not.toContain('promisify(execFile)');
  expect(source).toContain("stdio: ['inherit', 'pipe', 'pipe']");
  expect(source).toContain('inheritedConsoleStdio(options.stdio)');
  const fixture = await readFile(
    join(directory, 'test/desktop-access-fixture.ps1'),
    'utf8',
  );
  expect(fixture).toContain("stdio:['inherit','pipe','pipe']");
});

test('streaming options preserve intentional pipes and inherited fds, add inherited stdin only when unused, and reject an unrepresentable input pipe', () => {
  expect(inheritedConsoleStdio(['ignore', 'pipe', 'pipe'])).toEqual([
    'inherit',
    'pipe',
    'pipe',
  ]);
  expect(inheritedConsoleStdio('ignore')).toEqual([
    'inherit',
    'ignore',
    'ignore',
  ]);
  expect(inheritedConsoleStdio('inherit')).toBe('inherit');
  expect(inheritedConsoleStdio(['pipe', 'pipe', 'inherit'])).toEqual([
    'pipe',
    'pipe',
    'inherit',
  ]);
  expect(() => inheritedConsoleStdio(['pipe', 'pipe', 'pipe'])).toThrow(
    'HARNESS_CONSOLE_REQUIRES_INHERITED_FD',
  );
});

test('the raw Node listener controls inherit their existing hidden console instead of requesting a new one', async () => {
  const source = await readFile(
    join(directory, 'e2e/release-controls.ts'),
    'utf8',
  );
  expect(source).not.toContain(
    "{ stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }",
  );
  expect(
    source.match(/stdio: \['pipe', 'pipe', 'pipe'\], windowsHide: false/g),
  ).toHaveLength(2);
});

test.skipIf(process.platform !== 'win32')(
  'real restricted buffered native, buffered shell and streaming shell children share their parent console and never show or foreground it',
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'socialprune-console-proof-'));
    try {
      const probe = join(scratch, 'console-state.exe');
      const escaped = (value: string) => value.replaceAll("'", "''");
      await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Add-Type -Path '${escaped(join(directory, 'test/console-state.cs'))}' -OutputAssembly '${escaped(probe)}' -OutputType ConsoleApplication`,
        ],
        {
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          windowsHide: true,
          env: testEnvironment(),
        },
      );
      expect((await readFile(probe)).subarray(0, 2).toString()).toBe('MZ');
      await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'e2e/proof-acl.ps1'),
          '-Action',
          'grant',
          '-Root',
          scratch,
        ],
        { timeout: WINDOWS_QUERY_TIMEOUT_MS, env: testEnvironment() },
      );
      const entry = join(scratch, 'child.mjs'),
        args = join(scratch, 'args.json'),
        token = join(scratch, 'token.json'),
        report = join(scratch, 'console.json');
      await writeFile(
        entry,
        `import assert from 'node:assert/strict';import {writeFile}from'node:fs/promises';import{spawn}from'node:child_process';import{runNativeQuery,runPowerShell,spawnPowerShell}from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/windows-powershell.ts')).href)};
const args=${JSON.stringify(['-NoProfile', '-NonInteractive', '-File', join(directory, 'test/console-launch-fixture.ps1'), '-Probe', probe, '-ExpectedParent'])}.concat(String(process.pid));
const native=JSON.parse((await runNativeQuery(${JSON.stringify(probe)},[String(process.pid)],{windowsHide:true,timeout:${WINDOWS_QUERY_TIMEOUT_MS}})).stdout);
const shell=JSON.parse((await runPowerShell(args,{windowsHide:true,timeout:${WINDOWS_QUERY_TIMEOUT_MS}})).stdout);
const child=spawnPowerShell(args,{windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:${WINDOWS_QUERY_TIMEOUT_MS}});let text='',errors='';child.stdout.on('data',b=>text+=b);child.stderr.on('data',b=>errors+=b);const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});assert.equal(code,0,errors);const streaming=JSON.parse(text);
const raw=spawn(${JSON.stringify(probe)},[String(process.pid)],{stdio:['pipe','pipe','pipe'],windowsHide:false});let rawText='';raw.stdout.on('data',b=>rawText+=b);raw.stderr.resume();assert.equal(await new Promise((resolve,reject)=>{raw.once('error',reject);raw.once('close',resolve);}),0);const rawListenerOptions=JSON.parse(rawText);
for(const row of[native,shell,streaming,rawListenerOptions])assert.deepEqual({...row,session:0},{expectedParentSharesConsole:true,consoleVisible:false,ownConsoleForeground:false,jobAttached:true,session:0});
await writeFile(${JSON.stringify(report)},JSON.stringify({native,shell,streaming,rawListenerOptions}));`,
      );
      await writeFile(args, JSON.stringify([entry]));
      await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'e2e/limited-token.ps1'),
          '-Executable',
          process.execPath,
          '-ArgumentsFile',
          args,
          '-TokenReport',
          token,
        ],
        {
          timeout: RESTRICTED_LAUNCH_TIMEOUT_MS,
          windowsHide: true,
          env: testEnvironment(),
        },
      );
      const observed: unknown = JSON.parse(await readFile(report, 'utf8'));
      expect(
        JSON.parse((await readFile(token, 'utf8')).replace(/^\uFEFF/, '')),
      ).toMatchObject({
        adminMember: false,
        integrity: 'medium',
        childExit: 0,
        lifecycle: 'owned-job-kill-on-close',
        profile: { parentHkcuMarkerRead: true, loadUserProfileCalled: false },
      });
      await writeFile(
        join(dist, 'release-console-inheritance.json'),
        JSON.stringify(observed),
      );
      console.log('CONSOLE_INHERITANCE_PROOF', JSON.stringify(observed));
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  RESTRICTED_SEQUENCE_TEST_TIMEOUT_MS,
);

test(
  'buffered query replacement preserves nonzero status, bounded output failures and abort causal records',
  async () => {
    const { runNativeQuery } =
      await import('../packaging/windows-powershell.ts');
    await expect(
      runNativeQuery(
        process.execPath,
        [
          '-e',
          'process.stdout.write("out");process.stderr.write("err");process.exitCode=7',
        ],
        { windowsHide: true },
      ),
    ).rejects.toMatchObject({
      code: 7,
      stdout: 'out',
      stderr: 'err',
      killed: false,
    });
    await expect(
      runNativeQuery(
        process.execPath,
        ['-e', 'process.stdout.write("x".repeat(8192))'],
        { windowsHide: true, maxBuffer: 1024 },
      ),
    ).rejects.toMatchObject({
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      killed: true,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      runNativeQuery(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], {
        windowsHide: true,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'ABORT_ERR', query: { failed: true } });
  },
  WINDOWS_QUERY_TIMEOUT_MS,
);
