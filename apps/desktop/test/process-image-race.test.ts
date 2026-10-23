import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
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
        const started = performance.now();
        let readyMs = 0,
          compileMs = 0,
          queryStarted = 0,
          barrierMs: number | null = null;
        let observedExit: number | null = null;
        let queryExitMs: number | null = null;
        let stderr = '',
          stdout = '';
        const scratch = await mkdtemp(
          join(tmpdir(), 'socialprune-image-race-'),
        );
        const executable = join(
          scratch,
          operation === 'processes' ? 'SocialPrune.exe' : 'Uninstall.exe',
        );
        await copyFile(process.execPath, executable);
        const neighborDirectory = join(scratch, 'neighbor');
        await mkdir(neighborDirectory);
        const neighborExecutable = join(
          neighborDirectory,
          operation === 'processes' ? 'SocialPrune.exe' : 'Uninstall.exe',
        );
        await copyFile(process.execPath, neighborExecutable);
        // Start the same-named, different-image neighbor first so a snapshot
        // can encounter it before the target. It must remain live and readable.
        const neighbor = spawn(
          neighborExecutable,
          [
            '-e',
            'process.stdout.write("ready\\n");process.stdin.once("data",()=>process.exit(0))',
          ],
          { stdio: ['pipe', 'pipe', 'pipe'] },
        );
        const neighborClosed = once(neighbor, 'close');
        await once(neighbor.stdout, 'data');
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
        readyMs = performance.now() - started;
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
            // A snapshot includes same-named generated neighbors from other
            // tests. Mutate only this case's PID, never their image reads.
            `            var path=new StringBuilder(32768); uint size=${mode === 'live' ? `entry.pid==${child.pid!}?1u:32768u` : '32768'};`,
        );
        const injected = join(scratch, 'query-test.cs');
        const helper = join(scratch, 'query-test.exe');
        await writeFile(injected, patched);
        let query: ReturnType<typeof spawn> | undefined;
        try {
          const compileStarted = performance.now();
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
          compileMs = performance.now() - compileStarted;
          queryStarted = performance.now();
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
          query.once('close', (code) => {
            observedExit = code;
            queryExitMs = performance.now() - queryStarted;
          });
          query.stderr!.setEncoding('utf8');
          query.stdout!.setEncoding('utf8');
          query.stderr!.on('data', (data: string) => {
            stderr += data;
          });
          query.stdout!.on('data', (data: string) => {
            stdout += data;
          });
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              clearTimeout(timer);
              query!.stderr!.off('data', ready);
              query!.off('close', closed);
              query!.off('error', failed);
            };
            const ready = () => {
              if (stderr.includes('IMAGE_READ_BARRIER')) {
                cleanup();
                resolve();
              }
            };
            const closed = (code: number | null) => {
              cleanup();
              reject(
                new Error(
                  `IMAGE_QUERY_EXITED_BEFORE_BARRIER exit=${code} stderr=${stderr}`,
                ),
              );
            };
            const failed = (error: Error) => {
              cleanup();
              reject(error);
            };
            // Compilation has already finished. Keep the original ceiling:
            // measured early exit, not slow readiness, caused the old timeout.
            // The barrier/close/error signals decide the result immediately.
            const timer = setTimeout(() => {
              cleanup();
              reject(new Error('IMAGE_BARRIER_NOT_REACHED'));
            }, 15_000);
            query!.stderr!.on('data', ready);
            query!.once('close', closed);
            query!.once('error', failed);
            ready();
          });
          barrierMs = performance.now() - queryStarted;
          if (mode === 'exited') {
            // Both stdin writes release a read explicitly observed waiting above.
            child.stdin.end('exit\n');
            await childClosed;
          }
          query.stdin!.end('read\n');
          const [exit] = await queryClosed;
          expect(neighbor.exitCode).toBeNull();
          await writeFile(
            join(dist, `release-process-image-race-${operation}-${mode}.json`),
            JSON.stringify({
              operation,
              mode,
              exit,
              stderr,
              stdout,
              childExited: child.exitCode !== null,
              neighborAlive: neighbor.exitCode === null,
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
              neighborAlive: neighbor.exitCode === null,
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
            expect(stderr).toContain(
              `"pid":${child.pid!},"code":"PROCESS_IMAGE_FAILED"`,
            );
          }
        } finally {
          const timing = {
            operation,
            mode,
            readyMs,
            compileMs,
            barrierMs,
            queryMs: queryStarted ? performance.now() - queryStarted : null,
            observedExit,
            queryExitMs,
            targetPid: child.pid,
            neighborPid: neighbor.pid,
            neighborAlive: neighbor.exitCode === null,
            stderr,
            stdout,
          };
          console.log('PROCESS_IMAGE_STAGE_TIMING', JSON.stringify(timing));
          await writeFile(
            join(
              dist,
              `release-process-image-timing-${operation}-${mode}.json`,
            ),
            JSON.stringify(timing),
          );
          if (query && query.exitCode === null && query.signalCode === null) {
            const closed = once(query, 'close');
            query.kill();
            await closed;
          }
          if (child.exitCode === null) {
            child.stdin.end('exit\n');
            await childClosed;
          }
          if (neighbor.exitCode === null) {
            neighbor.stdin.end('exit\n');
            await neighborClosed;
          }
          await rm(scratch, { recursive: true, force: true });
        }
      },
      windowsTestBudget(1) + 30_000,
    );
