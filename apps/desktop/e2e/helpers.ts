import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect } from '@playwright/test';
import { executable } from '../build/paths.ts';
import { generatedWorkspace } from '../test/workspace.ts';
import { appProcesses } from '../test/windows.ts';

export async function launch(
  variant: 'test' | 'probe' = 'test',
  generated = true,
) {
  const temporary = await mkdtemp(join(tmpdir(), 'socialprune-desktop-'));
  const data = join(temporary, 'data');
  const items = generated ? await generatedWorkspace(data) : undefined;
  const started = performance.now();
  const application = await electron.launch({
    executablePath: executable(variant),
    args: [`--data-dir=${data}`],
    timeout: 30_000,
  });
  const errors: string[] = [];
  const requests: string[] = [];
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await expect(page.locator('[data-ready="true"]')).toBeVisible();
  const startupMs = performance.now() - started;
  return {
    data,
    items,
    application,
    page,
    errors,
    requests,
    startupMs,
    async close() {
      await application.close();
      await expect
        .poll(async () => (await appProcesses(executable(variant))).length, {
          timeout: 20_000,
        })
        .toBe(0);
      await rm(temporary, { recursive: true, force: true });
    },
  };
}
