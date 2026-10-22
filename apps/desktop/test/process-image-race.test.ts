import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directory, dist } from '../packaging/paths.ts';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { windowsTestBudget } from './windows-test-budgets.ts';

// Only this test compiles the barrier and undersized-buffer mutation. The real
// helper and every production entrypoint have no injection option or env flag.
for (const operation of ['processes', 'uninstall-processes'] as const)
  for (const mode of ['exited', 'live'] as const)
    test.skipIf(process.platform !== 'win32')(
      `${operation} image read ${mode}: a generated process exiting after OpenProcess is absent; a live unreadable process fails closed`,
      async () => {
        const scratch = await mkdtemp(
          join(tmpdir(), 'socialprune-image-race-'),
        );
        const executable = join(
          scratch,
          operation === 'processes' ? 'SocialPrune.exe' : 'Uninstall.exe',
        );
        await copyFile(process.execPath, executable);
        const child = spawn(
          executable,
          [
            '-e',
            'process.stdout.write("ready\\n");process.stdin.once("data",()=>process.exit(0))',
          ],
          {
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        const childClosed = once(child, 'close');
        await once(child.stdout, 'data');
        const source = await readFile(
          join(directory, 'packaging/windows-query.cs'),
          'utf8',
        );
        const anchor =
          operation === 'processes'
            ? 'if(handle!=IntPtr.Zero) try {\n            var path=new StringBuilder(32768); uint size=32768;'
            : 'else try {\n            var path=new StringBuilder(32768);uint size=32768;';
        expect(source.split(anchor)).toHaveLength(2);
        const patched = source.replace(
          anchor,
          (operation === 'processes'
            ? 'if(handle!=IntPtr.Zero) try {\n'
            : 'else try {\n') +
            `            if(entry.pid==${child.pid!}) { Console.Error.WriteLine("IMAGE_READ_BARRIER"); Console.Error.Flush(); Console.ReadLine(); }\n` +
            `            var path=new StringBuilder(32768); uint size=${mode === 'live' ? '1' : '32768'};`,
        );
        const injected = join(scratch, 'query-test.cs');
        const helper = join(scratch, 'query-test.exe');
        await writeFile(injected, patched);
        let query: ReturnType<typeof spawn> | undefined;
        try {
          await runPowerShell(
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `Add-Type -Path '${injected.replaceAll("'", "''")}' -OutputAssembly '${helper.replaceAll("'", "''")}' -OutputType ConsoleApplication`,
            ],
            {
              timeout: WINDOWS_QUERY_TIMEOUT_MS,
              queryClass: 'test-image-race-compile',
            },
          );
          query = spawn(
            helper,
            [
              operation,
              operation === 'processes'
                ? executable
                : `${scratch}|${executable}`,
            ],
            {
              stdio: ['pipe', 'pipe', 'pipe'],
            },
          );
          const queryClosed = once(query, 'close') as Promise<[number | null]>;
          let stderr = '',
            stdout = '';
          query.stderr!.setEncoding('utf8');
          query.stdout!.setEncoding('utf8');
          query.stderr!.on('data', (data: string) => {
            stderr += data;
          });
          query.stdout!.on('data', (data: string) => {
            stdout += data;
          });
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error('IMAGE_BARRIER_NOT_REACHED')),
              15_000,
            );
            query!.stderr!.on('data', () => {
              if (stderr.includes('IMAGE_READ_BARRIER')) {
                clearTimeout(timer);
                resolve();
              }
            });
          });
          if (mode === 'exited') {
            // Both stdin writes release a read explicitly observed waiting above.
            child.stdin.end('exit\n');
            await childClosed;
          }
          query.stdin!.end('read\n');
          const [exit] = await queryClosed;
          await writeFile(
            join(dist, `release-process-image-race-${operation}-${mode}.json`),
            JSON.stringify({
              operation,
              mode,
              exit,
              stderr,
              stdout,
              childExited: child.exitCode !== null,
            }),
          );
          console.log(
            'PROCESS_IMAGE_RACE_PROOF',
            JSON.stringify({
              operation,
              mode,
              exit,
              stderr,
              stdout,
              childExited: child.exitCode !== null,
            }),
          );
          if (mode === 'exited') {
            expect(exit).toBe(0);
            expect(JSON.parse(stdout)).toEqual([]);
            expect(stderr).toMatch(/"code":"PROCESS_EXITED_DURING_IMAGE_READ"/);
            expect(stderr).toMatch(/"call":"QueryFullProcessImageNameW"/);
            expect(stderr).toMatch(/"processState":"exited"/);
          } else {
            expect(child.exitCode).toBeNull();
            expect(exit).toBe(1);
            expect(stderr).toMatch(/PROCESS_IMAGE_FAILED/);
            expect(stderr).toMatch(/"win32Error":122/);
            expect(stderr).toMatch(/"processState":"live"/);
          }
        } finally {
          if (query && query.exitCode === null) query.kill();
          if (child.exitCode === null) {
            child.stdin.end('exit\n');
            await childClosed;
          }
          await rm(scratch, { recursive: true, force: true });
        }
      },
      windowsTestBudget(1) + 30_000,
    );
