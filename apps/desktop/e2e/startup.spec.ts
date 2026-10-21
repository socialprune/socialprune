import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directory, dist } from '../packaging/paths.ts';
import { launchReviewApp } from '../packaging/review-app-launch.ts';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { testEnvironment } from '../test/process-environment.ts';
import { pathToFileURL } from 'node:url';

// Test-runner selection only. Production has no fault or build selector.
const startupExecutable =
  // eslint-disable-next-line no-restricted-properties -- Select a separately packaged old-main reproducer for the failing-first replay.
  process.env.SP_STARTUP_REPRODUCER_EXE ??
  join(dist, 'startup/SocialPrune.exe');

for (const [mode, language] of [
  ['hold', 'de'],
  ['fail', 'en'],
  ['crash', 'de'],
] as const)
  test(`startup ${mode} shows one native ${language} failure and quits`, async () => {
    const data = await mkdtemp(join(tmpdir(), 'socialprune-startup-'));
    const started = performance.now();
    const app = await launchReviewApp(
      startupExecutable,
      [`--data-dir=${data}`, `--startup-case=${mode}`, `--lang=${language}`],
      join(data, 'app.json'),
    );
    try {
      await expect
        .poll(
          async () =>
            JSON.parse(
              await readFile(join(data, 'startup-dialog.json'), 'utf8').catch(
                () => '{}',
              ),
            ) as { messages?: unknown[] },
          { timeout: 25_000 },
        )
        .toMatchObject({
          messages: [
            expect.objectContaining({
              message:
                language === 'de'
                  ? 'SocialPrune konnte nicht starten'
                  : 'SocialPrune could not start',
              buttons: [language === 'de' ? 'Beenden' : 'Quit'],
            }),
          ],
        });
      expect(await app.exited).toBe(0);
      const elapsedMs = performance.now() - started;
      const records = (
        await readFile(join(data, 'logs/startup.ndjson'), 'utf8')
      )
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        boundMs: 20_000,
        trigger:
          mode === 'hold'
            ? 'TIMEOUT'
            : mode === 'fail'
              ? 'LOAD_FAILED'
              : 'RENDERER_GONE',
        exit: 'QUIT',
      });
      if (mode === 'hold')
        expect(records[0]!.elapsedMs).toBeGreaterThanOrEqual(20_000);
      else expect(elapsedMs).toBeLessThan(20_000);
      console.log(
        'STARTUP_REPRODUCER ' +
          JSON.stringify({
            mode,
            language,
            elapsedMs,
            records,
            exitCode: (await app.snapshot()).exitCode,
          }),
      );
    } finally {
      await app.close();
      await rm(data, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  });

test('normal startup never shows the failure, including after the bound', async () => {
  const data = await mkdtemp(join(tmpdir(), 'socialprune-startup-normal-'));
  const app = await electron.launch({
    executablePath: join(dist, 'startup/SocialPrune.exe'),
    args: [`--data-dir=${data}`, '--startup-case=normal'],
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole('navigation', { name: 'SocialPrune' }),
    ).toBeVisible();
    await app.evaluate(({ app }) => {
      app.emit('second-instance', {}, [], '');
    });
    await app.evaluate(
      () => new Promise<void>((resolve) => setTimeout(resolve, 20_100)),
    );
    const messages = await app.evaluate(
      () =>
        (Reflect.get(globalThis, 'startupFixture') as { messages: unknown[] })
          .messages,
    );
    expect(messages).toEqual([]);
    await expect(
      readFile(join(data, 'logs/startup.ndjson')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  } catch (error) {
    console.error(
      'STARTUP_NATIVE_LOG',
      await readFile(join(data, 'logs/startup.ndjson'), 'utf8').catch(
        () => 'absent',
      ),
    );
    throw error;
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

for (const language of ['de', 'en'])
  test(`real native ${language} startup dialog has one Quit action on an isolated desktop`, async () => {
    test.setTimeout(WINDOWS_QUERY_TIMEOUT_MS * 2);
    const data = await mkdtemp(join(tmpdir(), 'socialprune-startup-native-'));
    const entry = join(data, 'native.mjs');
    const receipt = join(data, 'native-dialog.json');
    await writeFile(
      entry,
      `import assert from 'node:assert/strict';
import{readFile}from'node:fs/promises';
import{launchReviewApp}from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/review-app-launch.ts')).href)};
import{runPowerShell,WINDOWS_QUERY_TIMEOUT_MS}from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/windows-powershell.ts')).href)};
const app=await launchReviewApp(${JSON.stringify(join(dist, 'startup/SocialPrune.exe'))},${JSON.stringify([`--data-dir=${data}`, '--startup-case=native-hold', `--lang=${language}`])},${JSON.stringify(join(data, 'app.json'))});
try{await runPowerShell(${JSON.stringify(['-NoProfile', '-NonInteractive', '-File', join(directory, 'e2e/startup-native.ps1'), '-Language', language, '-Receipt', receipt])}.concat(['-AppProcessId',String(app.pid)]),{timeout:WINDOWS_QUERY_TIMEOUT_MS,windowsHide:true});assert.equal(await app.exited,0);const row=JSON.parse(await readFile(${JSON.stringify(receipt)},'utf8'));assert.equal(row.nativeDialog,true);console.log('STARTUP_NATIVE '+JSON.stringify(row));}finally{await app.close();}`,
    );
    try {
      await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'test/window-station-fixture.ps1'),
          '-Node',
          process.execPath,
          '-Entry',
          entry,
          '-TimeoutMs',
          String(WINDOWS_QUERY_TIMEOUT_MS),
        ],
        {
          timeout: WINDOWS_QUERY_TIMEOUT_MS * 2,
          windowsHide: true,
          env: testEnvironment(),
        },
      );
      const row: unknown = JSON.parse(await readFile(receipt, 'utf8'));
      const call: unknown = JSON.parse(
        await readFile(join(data, 'startup-dialog.json'), 'utf8'),
      );
      expect(row).toMatchObject({
        nativeDialog: true,
        disposableDesktop: true,
        invoked: true,
      });
      expect(call).toMatchObject({
        messages: [
          expect.objectContaining({
            message:
              language === 'de'
                ? 'SocialPrune konnte nicht starten'
                : 'SocialPrune could not start',
            buttons: [language === 'de' ? 'Beenden' : 'Quit'],
          }),
        ],
      });
      console.log('STARTUP_NATIVE ' + JSON.stringify(row));
    } finally {
      await rm(data, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  });
