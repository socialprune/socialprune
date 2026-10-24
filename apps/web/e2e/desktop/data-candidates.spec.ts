import { expect, test } from '@playwright/test';
import { fakeBridge } from './fake-bridge.ts';

test('display recovery stays outside the renderer bridge when no exact-window producer is attached', async ({
  page,
}) => {
  const bridge = await fakeBridge(page);
  try {
    await page.goto('/desktop.html');
    await expect(
      page.getByRole('button', { name: 'Data and backups', exact: true }),
    ).toBeVisible();
    const before = bridge.requests.length;
    const keys = await page.evaluate(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(
        new CustomEvent('socialprune:display-removed', {
          detail: {
            id: 'invented-window',
            bounds: { x: 0, y: 0, width: 500, height: 500 },
          },
        }),
      );
      return Object.keys(window.socialprune).sort();
    });
    expect(keys).toEqual(['onRunView', 'request']);
    await page
      .getByRole('button', { name: 'Data and backups', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Show what will be removed' }),
    ).toBeVisible();
    expect(
      bridge.requests
        .slice(before)
        .every((request) => !/window|display/i.test(request.type)),
    ).toBe(true);
    expect(
      bridge.requests.some((request) => request.type === 'dataFolderInfo'),
    ).toBe(true);
  } finally {
    await bridge.close();
  }
});

test('data removal requires the locale phrase and signout, preserves the preview list and sends no path', async ({
  page,
}) => {
  const bridge = await fakeBridge(page);
  try {
    await page.addInitScript(() => {
      Reflect.set(window, 'removalCalls', []);
      window.addEventListener('socialprune:data-removal-request', (event) => {
        const request = JSON.parse((event as CustomEvent<string>).detail) as {
          type: string;
          id: string;
        };
        (Reflect.get(window, 'removalCalls') as unknown[]).push(request);
        const reply =
          request.type === 'preview'
            ? {
                type: 'preview',
                id: request.id,
                token: '41fe1162-3704-46fd-a84a-19f087683ee0',
                root: 'Generated app data',
                expiresAt: '2026-10-24T01:00:00Z',
                rows: [
                  {
                    name: 'workspace/socialprune.sqlite',
                    bytes: 4096,
                    disposition: 'remove',
                    reason: 'managed',
                  },
                  {
                    name: 'backup.json',
                    bytes: 100,
                    disposition: 'retain',
                    reason: 'backup',
                  },
                ],
                groups: [
                  'workspace',
                  'profile-x',
                  'profile-instagram',
                  'logs',
                  'settings',
                ].map((kind) => ({
                  kind,
                  bytes: kind === 'workspace' ? 4096 : 0,
                })),
              }
            : {
                type: 'result',
                id: request.id,
                removed: 1,
                failures: 0,
                retained: 1,
              };
        window.dispatchEvent(
          new CustomEvent('socialprune:data-removal-reply', {
            detail: JSON.stringify(reply),
          }),
        );
      });
    });
    await page.goto('/desktop.html');
    await page
      .getByRole('button', { name: 'Data and backups', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Show what will be removed' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Remove app data' });
    await expect(dialog).toContainText('backup.json');
    const confirm = dialog.getByRole('button', {
      name: 'Remove listed data and quit',
    });
    await dialog.getByRole('textbox').fill('REMOVE');
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await expect(confirm).toBeEnabled();
    await page.screenshot({
      path: test.info().outputPath('candidate-removal-en.png'),
      fullPage: true,
    });
    await confirm.click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'The listed files were removed' }),
    ).toBeVisible();
    const calls = await page.evaluate(
      () => Reflect.get(window, 'removalCalls') as unknown[],
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      type: 'confirm',
      signedOut: true,
      phrase: 'REMOVE',
      locale: 'en',
    });
    expect(JSON.stringify(calls)).not.toContain('workspace');
    expect(JSON.stringify(calls)).not.toContain('root');
  } finally {
    await bridge.close();
  }
});
