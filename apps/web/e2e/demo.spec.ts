import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FIXTURES_ROOT } from '@socialprune/fixture-gen';
import type { DemoData } from '@socialprune/fixture-gen';
import type { Assessment, WorkspaceV2 } from '@socialprune/core';
import { observeImport, waitForApp } from './helpers.ts';
import { reviewFixture } from './review-fixture.ts';
import { startStaticServer } from './static-server.ts';

async function fixture() {
  const root = join(FIXTURES_ROOT, 'demo');
  const manifest = JSON.parse(
    await readFile(join(root, 'manifest.json'), 'utf8'),
  ) as DemoData['manifest'];
  const assessments = JSON.parse(
    await readFile(join(root, 'assessments.json'), 'utf8'),
  ) as Assessment[];
  const items: WorkspaceV2['items'] = [];
  for (const entry of manifest.exports) {
    const expected = JSON.parse(
      await readFile(join(root, entry.platform, 'expected.json'), 'utf8'),
    ) as { items: WorkspaceV2['items'] };
    items.push(...expected.items);
  }
  return { manifest, assessments, items };
}
async function backup(page: Page): Promise<WorkspaceV2> {
  return page.evaluate(async () => {
    let text = '';
    await window.workspace.backup(async (file) => {
      text = await file.text();
    });
    return JSON.parse(text) as WorkspaceV2;
  });
}

test('W4 bundled demo imports, reviews, bulk marks, undoes, opens both click lists and writes a backup with the network audit', async ({
  page,
  context,
}) => {
  const expected = await fixture();
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', {
      value: undefined,
      configurable: true,
    }),
  );
  const audit = await observeImport(context, page);
  const dataRequests: string[] = [];
  page.on('request', (request) => {
    if (
      ['fetch', 'xhr'].includes(request.resourceType()) &&
      new URL(request.url()).protocol !== 'blob:' &&
      !new URL(request.url()).pathname.endsWith('.js')
    )
      dataRequests.push(request.url());
  });
  await page.goto('/socialprune/#/demo');
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.locator('main[data-gate]')).toHaveAttribute(
    'data-gate',
    'ready',
  );
  const banner = page.getByTestId('demo-banner');
  await expect(banner).toContainText(expected.manifest.banner.en);
  await expect(
    page.getByRole('combobox', { name: 'Account', exact: true }),
  ).toHaveValue(expected.manifest.exports[0]!.account.key);
  const initial = await backup(page);
  expect(initial.kind).toBe('demo');
  expect(initial.id).toBe('demo');
  expect(initial.items.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
    expected.items.sort((a, b) => a.id.localeCompare(b.id)),
  );
  expect(initial.assessments).toEqual(expected.assessments);
  expect(initial.imports).toHaveLength(expected.manifest.exports.length);
  expect(
    [...new Set(initial.imports.flatMap(({ archives }) => archives))].sort(),
  ).toEqual(expected.manifest.exports.map(({ archive }) => archive).sort());
  expect(initial.imports.every(({ status }) => status === 'complete')).toBe(
    true,
  );
  expect(initial.decisionEvents).toEqual([]);
  const databases = await page.evaluate(async () =>
    (await indexedDB.databases()).map(({ name }) => name),
  );
  expect(databases).toContain('sp-ws-demo');
  const grid = page.getByRole('grid');
  await expect(
    grid.getByText('Example', { exact: true }).first(),
  ).toBeVisible();
  await grid.focus();
  await page.keyboard.press('Enter');
  const detail = page.getByRole('region', { name: 'Entry details' });
  await expect(
    detail.getByText('Example', { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to list', exact: true }).click();
  const xIds = new Set(
    expected.items
      .filter(({ platform }) => platform === 'x')
      .map(({ id }) => id),
  );
  const suggested = new Set(
    expected.assessments
      .filter(({ risk, itemId }) => risk >= 2 && xIds.has(itemId))
      .map(({ itemId }) => itemId),
  );
  await page
    .getByRole('button', { name: 'Mark suggested entries', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('button', {
      name: `Mark for deletion: ${suggested.size} entries`,
      exact: true,
    }),
  ).toBeEnabled();
  await dialog.locator('summary').click();
  await expect(
    dialog.getByText('Example', { exact: true }).first(),
  ).toBeVisible();
  await dialog
    .getByRole('button', {
      name: `Mark for deletion: ${suggested.size} entries`,
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  const marked = await backup(page);
  expect(marked.decisionEvents.map(({ itemId }) => itemId).sort()).toEqual(
    [...suggested].sort(),
  );
  expect(
    marked.decisionEvents.every(
      ({ value, source, action }) =>
        value === 'delete' &&
        source.via === 'web-review' &&
        action.kind === 'bulk',
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: `${suggested.size} entries changed.` })
      .first(),
  ).toBeVisible();
  const undone = await backup(page);
  expect(
    undone.decisionEvents
      .filter(({ action }) => action.kind === 'undo')
      .map(({ itemId }) => itemId)
      .sort(),
  ).toEqual([...suggested].sort());
  expect(
    undone.decisionEvents
      .filter(({ action }) => action.kind === 'undo')
      .every(({ value }) => value === 'undecided'),
  ).toBe(true);
  await grid.focus();
  await page.keyboard.press('m');
  await expect(
    page.getByRole('status').filter({ hasText: '1 decision saved.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'X click list', exact: true }).click();
  await expect(banner).toBeVisible();
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(page.locator('li[data-item-id]')).toHaveCount(1);
  await page
    .locator('li[data-item-id]')
    .getByRole('button', { name: 'I did it', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: '1 deleted by you' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Review', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Account', exact: true })
    .selectOption(expected.manifest.exports[1]!.account.key);
  await expect(
    grid.getByText('Example', { exact: true }).first(),
  ).toBeVisible();
  await grid.focus();
  await page.keyboard.press('m');
  await expect(
    page.getByRole('status').filter({ hasText: '1 decision saved.' }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Instagram click list', exact: true })
    .click();
  await expect(banner).toBeVisible();
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(page.locator('li[data-item-id]')).toHaveCount(1);
  await expect(
    page.locator('li[data-item-id]').getByRole('heading'),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Backup and restore', exact: true })
    .click();
  await expect(banner).toBeVisible();
  expect(await page.locator('input[type="file"]').count()).toBe(0);
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Download backup', exact: true })
    .click();
  const stream = await (await download).createReadStream();
  if (!stream) throw new Error('Demo backup was not downloaded.');
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.from(chunk as Uint8Array));
  const saved = JSON.parse(
    Buffer.concat(chunks).toString('utf8'),
  ) as WorkspaceV2;
  expect(saved.kind).toBe('demo');
  expect(saved.assessments).toEqual(expected.assessments);
  expect(saved.outcomeEvents).toHaveLength(1);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(banner).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Language', exact: true })
    .selectOption('de');
  await expect(banner).toContainText(expected.manifest.banner.de);
  await page
    .getByRole('link', { name: 'Demo ausprobieren', exact: true })
    .click();
  await expect(
    grid.getByText('Beispiel', { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Demo zurücksetzen', exact: true })
    .click();
  await expect(
    page.getByText(
      'Die Demo wurde zurückgesetzt. Deine Demo-Entscheidungen und Ergebnisvermerke wurden entfernt.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(grid).toBeVisible();
  const reset = await backup(page);
  expect(reset.createdAt).not.toBe(initial.createdAt);
  expect(reset.decisionEvents).toEqual([]);
  expect(reset.outcomeEvents).toEqual([]);
  expect(reset.assessments).toEqual(expected.assessments);
  expect(reset.items).toHaveLength(expected.items.length);
  expect(dataRequests).toEqual([]);
  await audit.assert();
});

test('W4 demo works with no service-worker control and cannot open personal data or restore files', async ({
  page,
  context,
}) => {
  const expected = await fixture();
  const audit = await observeImport(context, page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator.serviceWorker, 'register', {
      value: () => Promise.reject(new Error('Test-only blocked registration.')),
    });
  });
  await page.goto('/socialprune/#/demo');
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.locator('main[data-gate]')).toHaveAttribute(
    'data-gate',
    'unavailable',
  );
  expect(
    await page.evaluate(() => navigator.serviceWorker.controller),
  ).toBeNull();
  const current = await backup(page);
  expect(current.items).toHaveLength(expected.items.length);
  const rejected = await page.evaluate(async () => ({
    open: await window.workspace.open('active'),
    restore: await window.workspace.request({
      type: 'restore',
      requestId: crypto.randomUUID(),
      file: new File(['{}'], 'invented.json'),
    }),
  }));
  expect(rejected.open).toMatchObject({
    type: 'failed',
    code: 'INVALID_REQUEST',
  });
  expect(rejected.restore).toMatchObject({
    type: 'failed',
    code: 'INVALID_REQUEST',
  });
  await page
    .getByRole('link', { name: 'Backup and restore', exact: true })
    .click();
  expect(await page.locator('input[type="file"]').count()).toBe(0);
  await audit.assert();
});

test('W4 personal review survives demo and reset; fixture restore is refused without changing it', async ({
  page,
}) => {
  const expected = await fixture();
  await waitForApp(page);
  const personal = reviewFixture('personal', false);
  const restored = await page.evaluate(
    (text) =>
      window.workspace.request({
        type: 'restore',
        requestId: crypto.randomUUID(),
        file: new File([text], 'invented-personal.json'),
      }),
    JSON.stringify(personal),
  );
  expect(restored.type).toBe('opened');
  const invalid = {
    ...personal,
    assessments: [
      { ...expected.assessments[0]!, itemId: personal.items[0]!.id },
    ],
    counts: { ...personal.counts, assessments: 1 },
  };
  const denied = await page.evaluate(
    (text) =>
      window.workspace.request({
        type: 'restore',
        requestId: crypto.randomUUID(),
        file: new File([text], 'invented-fixture-personal.json'),
      }),
    JSON.stringify(invalid),
  );
  expect(denied).toMatchObject({ type: 'failed', code: 'FIXTURE_NOT_ALLOWED' });
  expect((await backup(page)).assessments).toEqual([]);
  await page.getByRole('link', { name: 'Try the demo', exact: true }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await expect(
    page.getByText(
      'The demo was reset. Your demo decisions and outcome records were removed.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('grid')).toBeVisible();
  expect((await backup(page)).items).toHaveLength(expected.items.length);
  const cached = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys())
        paths.push(new URL(request.url).pathname);
    return paths;
  });
  for (const { archive } of expected.manifest.exports)
    expect(cached.some((path) => path.endsWith(`/${archive}`))).toBe(true);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Start', exact: true })
    .click();
  await page.getByRole('link', { name: 'Review', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Account', exact: true }),
  ).toHaveValue(personal.items[0]!.account.key);
  await expect(page.getByRole('grid')).toBeVisible();
  expect((await backup(page)).items).toEqual(personal.items);
  expect(await page.getByTestId('demo-banner').count()).toBe(0);
});

test('W4 demo recreates from precached bytes after reload with its actual server stopped', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = Worker;
    const trace: {
      worker: string;
      direction: string;
      type: string;
      requestId?: string;
    }[] = [];
    Reflect.set(globalThis, '__demoLifecycleTrace', trace);
    globalThis.Worker = class extends Original {
      private readonly address: string;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.address = String(url);
        this.addEventListener(
          'message',
          (event: MessageEvent<{ type: string; requestId?: string }>) => {
            trace.push({
              worker: this.address,
              direction: 'reply',
              type: event.data.type,
              requestId: event.data.requestId,
            });
          },
        );
      }
      override postMessage(
        message: unknown,
        transferOrOptions: Transferable[] | StructuredSerializeOptions = [],
      ) {
        const request = message as { type: string; requestId?: string };
        trace.push({
          worker: this.address,
          direction: 'request',
          type: request.type,
          requestId: request.requestId,
        });
        if (Array.isArray(transferOrOptions))
          super.postMessage(message, transferOrOptions);
        else super.postMessage(message, transferOrOptions);
      }
    };
  });
  const expected = await fixture();
  const server = await startStaticServer(4182);
  try {
    await page.goto(`${server.origin}/socialprune/#/demo`);
    await expect(page.locator('main[data-gate]')).toHaveAttribute(
      'data-gate',
      'ready',
    );
    await expect(page.getByRole('grid')).toBeVisible();
  } finally {
    await server.close();
  }
  const response = await page.reload();
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page.locator('main[data-gate]')).toHaveAttribute(
    'data-gate',
    'ready',
  );
  await expect(page.getByRole('grid')).toBeVisible();
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  try {
    await expect(
      page.getByText(
        'The demo was reset. Your demo decisions and outcome records were removed.',
        { exact: true },
      ),
    ).toBeVisible();
  } catch (error) {
    console.log(
      await page.evaluate(() => ({
        trace: Reflect.get(globalThis, '__demoLifecycleTrace') as unknown,
        import: window.socialprune.getImportSnapshot(),
        failures: window.workspace.diagnostics,
      })),
    );
    throw error;
  }
  expect((await backup(page)).items).toHaveLength(expected.items.length);
});

test('W4 demo banner and review reflow at 320 pixels in both languages', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/socialprune/#/demo');
  await expect(page.getByRole('grid')).toBeVisible();
  for (const locale of ['en', 'de']) {
    await page.getByRole('combobox').first().selectOption(locale);
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    expect(await page.locator('h1').count()).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
