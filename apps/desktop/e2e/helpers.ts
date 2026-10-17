import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect } from '@playwright/test';
import { executable } from '../packaging/paths.ts';
import { generatedWorkspace } from '../test/workspace.ts';
import { appProcesses } from '../test/windows.ts';
import type { DesktopRequest, DesktopReply } from '../src/protocol.ts';
import type { EngineFileSelection } from 'socialprune/engine';

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
  const temporary = await mkdtemp(join(tmpdir(), 'socialprune-desktop-'));
  const data = join(temporary, 'data');
  const items = generated ? await generatedWorkspace(data) : undefined;
  await prepare?.(data);
  let selectedData: string;
  try {
    selectedData = selectDataPath ? await selectDataPath(data) : data;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  const started = performance.now();
  const application = await electron.launch({
    executablePath: executable(variant),
    args: [`--data-dir=${selectedData}`],
    timeout: 30_000,
  });
  const process = application.process();
  const errors: string[] = [];
  const requests: string[] = [];
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await expect(
    page.getByRole('navigation', { name: 'SocialPrune' }),
  ).toBeVisible();
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
      if (process.exitCode === null) await application.close();
      await expect
        .poll(async () => (await appProcesses(executable(variant))).length, {
          timeout: 20_000,
        })
        .toBe(0);
      await rm(temporary, { recursive: true, force: true });
    },
  };
}
