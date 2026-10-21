import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import { launchReviewApp } from '../packaging/review-app-launch.ts';
import { WINDOWS_QUERY_TIMEOUT_MS } from '../packaging/windows-powershell.ts';
import { runWindowProbe } from '../packaging/window-readiness.ts';
import { setTimeout as wait } from 'node:timers/promises';

test.skipIf(process.platform !== 'win32')(
  'explicit desktop launcher retains an early process exit and startup stderr',
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'socialprune-review-launch-'));
    try {
      const receipt = join(scratch, 'release-app-test.json');
      const app = await launchReviewApp(
        process.execPath,
        [
          '-e',
          'process.stderr.write("DESKTOP_START_FAILED\\n");process.exit(7)',
        ],
        receipt,
      );
      const code = await app.exited;
      process.stdout.write(
        `APP_LAUNCH_EXIT ${await readFile(receipt, 'utf8')}\n`,
      );
      expect(code).toBe(7);
      const state: unknown = JSON.parse(await readFile(receipt, 'utf8'));
      expect(state).toMatchObject({
        state: 'exited',
        exitCode: 7,
        explicitDesktop: true,
        environmentClass: 'app-os-allowlist',
        killOnCloseJob: true,
        log: { startupCodes: ['DESKTOP_START_FAILED'] },
        processObservation: {
          scope: 'owned-job-only',
          processes: [{ type: 'browser', alive: false, exitCode: 7 }],
        },
      });
      await app.close();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  WINDOWS_QUERY_TIMEOUT_MS + 5_000,
);

test('readiness reports process, thread desktops, owned station windows and display bounds without a focus exemption', async () => {
  const text = await readFile(
    join(directory, 'packaging/window-readiness.ps1'),
    'utf8',
  );
  expect(text).toContain('ObserveApp');
  expect(text).toContain('appObservation');
  expect(text).toContain('boundingRectangle');
  expect(text).toContain('$last.focusResult -and -not $last.offscreen');
  const controls = await readFile(
    join(directory, 'e2e/uninstall-controls.ts'),
    'utf8',
  );
  expect(controls).toContain('launchReviewApp(');
  expect(controls).not.toContain("{ stdio: 'ignore', env: installerEnv }");
});

test.skipIf(process.platform !== 'win32')(
  'owned children retain process type, birth and exit after they disappear',
  async () => {
    const scratch = await mkdtemp(
      join(tmpdir(), 'socialprune-owned-children-'),
    );
    try {
      const order = join(scratch, 'settle-order');
      const receipt = join(scratch, 'release-app-children.json');
      const source = `const{spawn}=require('node:child_process'),fs=require('node:fs');let exits=0;for(const type of ['gpu-process','renderer','utility']){spawn(process.execPath,['-e',"const fs=require('node:fs');setInterval(()=>{if(fs.existsSync(process.argv[1]))process.exit(9)},25)",process.argv[1],'--type='+type],{stdio:'ignore'}).once('exit',()=>{if(++exits===3)process.exit(0)})}`;
      const app = await launchReviewApp(
        process.execPath,
        ['-e', source, order],
        receipt,
      );
      try {
        const end = Date.now() + WINDOWS_QUERY_TIMEOUT_MS;
        let types: string[] = [];
        while (Date.now() < end) {
          const value = await app.snapshot();
          types = value.processObservation.processes.map((row) => row.type);
          if (
            ['gpu-process', 'renderer', 'utility'].every((type) =>
              types.includes(type),
            )
          )
            break;
          await wait(25);
        }
        const expected: unknown = expect.arrayContaining([
          'gpu-process',
          'renderer',
          'utility',
        ]);
        expect(types).toEqual(expected);
        await writeFile(order, 'settle');
        expect(await app.exited).toBe(0);
        const final = await app.snapshot();
        for (const row of final.processObservation.processes.filter(
          (row) => row.type !== 'browser',
        )) {
          expect(row.born).toMatch(/^\d+$/);
          expect(row.alive).toBe(false);
          expect(row.exitCode).toBe(9);
        }
      } finally {
        await app.close();
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  WINDOWS_QUERY_TIMEOUT_MS + 5_000,
);

test.skipIf(process.platform !== 'win32')(
  'an app that exits during readiness retains its exit code instead of a window timeout',
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'socialprune-app-exits-'));
    try {
      const exitOrder = join(scratch, 'exit-order');
      const app = await launchReviewApp(
        process.execPath,
        [
          '-e',
          "const fs=require('node:fs');setInterval(()=>{if(fs.existsSync(process.argv[1]))process.exit(7)},25)",
          exitOrder,
        ],
        join(scratch, 'release-app-exit.json'),
      );
      try {
        const receipt = join(scratch, 'release-window-exit.json');
        const probe = runWindowProbe(
          'packaging/release-window.ps1',
          ['-AppProcessId', String(app.pid), '-Executable', process.execPath],
          receipt,
        ).then(
          () => false,
          () => true,
        );
        const deadline = Date.now() + WINDOWS_QUERY_TIMEOUT_MS;
        let watching = false;
        while (!watching && Date.now() < deadline) {
          try {
            const observed = JSON.parse(await readFile(receipt, 'utf8')) as {
              appObservation?: { alive: boolean };
            };
            watching = observed.appObservation?.alive === true;
          } catch (error) {
            // The probe owns and rewrites this generated receipt. Only a
            // missing or in-progress write may be retried before the handoff.
            if (
              !(error instanceof SyntaxError) &&
              !(
                error instanceof Error &&
                'code' in error &&
                error.code === 'ENOENT'
              )
            )
              throw error;
          }
          if (!watching) await wait(25);
        }
        expect(watching).toBe(true);
        await writeFile(exitOrder, 'exit');
        expect(await probe).toBe(true);
        const value: unknown = JSON.parse(await readFile(receipt, 'utf8'));
        expect(value).toMatchObject({
          state: 'failed',
          appObservation: { alive: false, exitCode: 7 },
        });
        expect(await app.exited).toBe(7);
      } finally {
        await app.close();
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  WINDOWS_QUERY_TIMEOUT_MS * 2 + 100,
);
