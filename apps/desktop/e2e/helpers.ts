import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { dist, executable } from '../packaging/paths.ts';
import { generatedWorkspace } from '../test/workspace.ts';
import { appProcesses } from '../test/windows.ts';
import type { DesktopRequest, DesktopReply } from '../src/protocol.ts';
import type { EngineFileSelection } from 'socialprune/engine';
import { WINDOWS_QUERY_TIMEOUT_MS } from '../packaging/windows-powershell.ts';

export async function call(
  app: Awaited<ReturnType<typeof launch>>,
  request: DesktopRequest,
): Promise<DesktopReply> {
  return app.page.evaluate(
    (message) => window.socialprune.request(message),
    request,
  );
}
export async function select(
  app: Awaited<ReturnType<typeof launch>>,
  selection: EngineFileSelection,
) {
  await app.application.evaluate((_electron, value) => {
    const probe = Reflect.get(globalThis, 'desktopProbe') as {
      selections: EngineFileSelection[];
    };
    probe.selections.push(value);
  }, selection);
}

export async function launch(
  variant: 'test' | 'probe' = 'test',
  generated = true,
  prepare?: (data: string) => Promise<void>,
  selectDataPath?: (data: string) => Promise<string>,
) {
  // Leave room for a 60 s cold OS query to emit its own causal receipt.
  test.setTimeout(Math.max(test.info().timeout, WINDOWS_QUERY_TIMEOUT_MS * 3));
  const temporary = await mkdtemp(join(tmpdir(), 'socialprune-desktop-'));
  const data = join(temporary, 'data');
  const items = generated
    ? await test.step('prepare generated SQLite workspace', () =>
        generatedWorkspace(data))
    : undefined;
  await test.step('prepare scenario', async () => prepare?.(data));
  let selectedData: string;
  try {
    selectedData = selectDataPath ? await selectDataPath(data) : data;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  const started = performance.now();
  const application = await test.step('launch packaged Electron', () =>
    electron.launch({
      executablePath: executable(variant),
      args: [`--data-dir=${selectedData}`],
      timeout: 30_000,
    }));
  const process = application.process();
  const errors: string[] = [];
  const requests: string[] = [];
  const page = await test.step('receive first app window', () =>
    application.firstWindow());
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await test.step('wait for interactive navigation', () =>
    expect(
      page.getByRole('navigation', { name: 'SocialPrune' }),
    ).toBeVisible());
  const startupMs = performance.now() - started;
  return {
    data,
    selectedData,
    items,
    application,
    process,
    page,
    errors,
    requests,
    startupMs,
    async close() {
      if (process.exitCode === null)
        await test.step('close Electron and engine', () => application.close());
      await test.step('wait for owned Electron processes to exit', () =>
        expect
          .poll(async () => (await appProcesses(executable(variant))).length, {
            timeout: 20_000,
          })
          .toBe(0));
      const queryFolder = join(data, 'query-measurements');
      for (const file of await readdir(queryFolder).catch((error: unknown) => {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          return [];
        throw error;
      })) {
        if (!/^release-query-[a-f0-9-]+\.json$/.test(file))
          throw new Error('QUERY_EVIDENCE_NAME_REFUSED');
        await mkdir(join(dist, 'red-controls'), { recursive: true });
        await copyFile(
          join(queryFolder, file),
          join(dist, 'red-controls', file),
        );
        await copyFile(join(queryFolder, file), join(dist, file));
      }
      await test.step('remove generated data directory', () =>
        rm(temporary, { recursive: true, force: true }));
    },
  };
}
