import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  fixtureZips,
  importFiles,
  observeImport,
  waitForApp,
} from './helpers.ts';

interface HeldReply {
  armed: boolean;
  held: boolean;
  release: (() => void) | null;
}

/** Test-entry-only delivery delay. Production modules contain no delay hook. */
async function holdReply(page: Page, type: 'historyEntries' | 'storageState') {
  await page.addInitScript((replyType) => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      value: undefined,
      configurable: true,
    });
    const state: HeldReply = {
      armed: replyType === 'storageState',
      held: false,
      release: null,
    };
    Reflect.set(window, '__backupLayoutTest', state);
    const original = Reflect.get(Worker.prototype, 'addEventListener');
    Object.defineProperty(Worker.prototype, 'addEventListener', {
      configurable: true,
      value(
        this: Worker,
        name: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (name !== 'message' || typeof listener !== 'function') {
          Reflect.apply(original, this, [name, listener, options]);
          return;
        }
        const deliver = (event: MessageEvent<unknown>) => {
          const data = event.data as { type?: string } | null;
          if (state.armed && data?.type === replyType) {
            state.held = true;
            state.release = () => {
              state.armed = false;
              state.held = false;
              state.release = null;
              Reflect.apply(listener, this, [event]);
            };
            return;
          }
          Reflect.apply(listener, this, [event]);
        };
        Reflect.apply(original, this, [name, deliver, options]);
      },
    });
    if (replyType === 'storageState') {
      Reflect.set(window, '__layoutPersistCalls', 0);
      Object.defineProperty(
        Object.getPrototypeOf(navigator.storage) as object,
        'persist',
        {
          configurable: true,
          value: () => {
            const prior = Reflect.get(window, '__layoutPersistCalls') as number;
            Reflect.set(window, '__layoutPersistCalls', prior + 1);
            return Promise.resolve(false);
          },
        },
      );
    }
  }, type);
}

async function releaseReply(page: Page) {
  await page.evaluate(() => {
    const state = Reflect.get(window, '__backupLayoutTest') as HeldReply;
    if (!state.release)
      throw new Error('The expected real worker reply was not held.');
    state.release();
  });
}

test('normal production page and workers expose no layout-test delay controls', async ({
  page,
}) => {
  await waitForApp(page);
  expect(
    await page.evaluate(
      () =>
        Reflect.has(window, '__backupLayoutTest') ||
        Reflect.has(window, '__layoutPersistCalls'),
    ),
  ).toBe(false);
  for (const worker of page.workers())
    expect(
      await worker.evaluate(
        () =>
          Reflect.has(globalThis, '__backupLayoutTest') ||
          Reflect.has(globalThis, '__layoutPersistCalls'),
      ),
    ).toBe(false);
});

test('backup action stays under the pointer when history arrives, downloads once and reports saved only after the file', async ({
  page,
  context,
  browserName,
}) => {
  await holdReply(page, 'historyEntries');
  const fixture = await fixtureZips('x', 'current-minimal');
  const audit = await observeImport(context, page);
  const downloads: import('@playwright/test').Download[] = [];
  page.on('download', (download) => downloads.push(download));
  try {
    await waitForApp(page);
    await importFiles(page, fixture.files);
    await page.evaluate(async (itemId) => {
      await window.workspace.request({
        type: 'decide',
        requestId: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        itemIds: [itemId],
        value: 'delete',
        expected: { [itemId]: 'undecided' },
      });
      (Reflect.get(window, '__backupLayoutTest') as HeldReply).armed = true;
      location.hash = '#/backup';
    }, fixture.expected.items[0]!.id);
    const button = page.getByRole('button', {
      name: 'Download backup',
      exact: true,
    });
    await expect(button).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => (Reflect.get(window, '__backupLayoutTest') as HeldReply).held,
        ),
      )
      .toBe(true);
    await expect(
      page.getByText('The backup file was saved.', { exact: true }),
    ).toHaveCount(0);
    const before = await button.boundingBox();
    if (!before) throw new Error('Backup action is missing.');
    const screens = join(tmpdir(), 'socialprune-screens');
    await mkdir(screens, { recursive: true });
    if (browserName === 'chromium')
      await page.screenshot({
        path: join(screens, `backup-${browserName}-before-history.png`),
        fullPage: true,
        caret: 'initial',
      });
    await page.mouse.move(
      before.x + before.width / 2,
      before.y + before.height / 2,
    );
    await page.mouse.down();
    await releaseReply(page);
    await expect(
      page.getByText(
        /At least 1 action has been recorded since the last backup/,
      ),
    ).toBeVisible();
    const after = await button.boundingBox();
    if (browserName === 'chromium')
      await page.screenshot({
        path: join(screens, `backup-${browserName}-after-history.png`),
        fullPage: true,
        caret: 'initial',
      });
    expect(downloads).toHaveLength(0);
    await expect(
      page.getByText('The backup file was saved.', { exact: true }),
    ).toHaveCount(0);
    await page.mouse.up();
    expect(after).toEqual(before);
    await expect.poll(() => downloads.length).toBe(1);
    const file = await downloads[0]!.path();
    if (!file) throw new Error('The backup download produced no file.');
    const document = JSON.parse(await readFile(file, 'utf8')) as {
      items: { id: string }[];
      lastBackupAt: string;
    };
    expect(document.items.map((item) => item.id).sort()).toEqual(
      fixture.expected.items.map((item) => item.id).sort(),
    );
    await expect(
      page.getByText('The backup file was saved.', { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(async () => {
        const opened = await window.workspace.open();
        return opened.type === 'opened' ? opened.summary.lastBackupAt : null;
      }),
    ).toBe(document.lastBackupAt);
    expect(downloads).toHaveLength(1);
    await audit.assert();
  } finally {
    await page.mouse.up();
    await fixture.cleanup();
  }
});

test('settings persistence action keeps its position when asynchronous storage status arrives', async ({
  page,
  context,
}) => {
  await holdReply(page, 'storageState');
  const fixture = await fixtureZips('x', 'current-minimal');
  const audit = await observeImport(context, page);
  try {
    await waitForApp(page);
    await importFiles(page, fixture.files);
    await page.evaluate(() => {
      location.hash = '#/settings';
    });
    await expect(
      page.getByRole('combobox', { name: 'Time zone', exact: true }),
    ).toBeVisible();
    const button = page.getByRole('button', {
      name: 'Keep data when storage runs low',
      exact: true,
    });
    await expect(button).toBeEnabled();
    await button.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        page.evaluate(
          () => (Reflect.get(window, '__backupLayoutTest') as HeldReply).held,
        ),
      )
      .toBe(true);
    const before = await button.boundingBox();
    if (!before) throw new Error('Persistence action is missing.');
    await page.mouse.move(
      before.x + before.width / 2,
      before.y + before.height / 2,
    );
    await page.mouse.down();
    await releaseReply(page);
    await expect(
      page.getByText(
        'Persistent storage has not been granted. Keep a downloaded backup.',
        { exact: true },
      ),
    ).toBeVisible();
    const after = await button.boundingBox();
    await page.mouse.up();
    expect(after).toEqual(before);
    await expect
      .poll(() =>
        page.evaluate(
          () => Reflect.get(window, '__layoutPersistCalls') as number,
        ),
      )
      .toBe(1);
    await expect(
      page.getByText(
        'The browser did not grant persistent storage. You can continue; keep a downloaded backup.',
        { exact: true },
      ),
    ).toBeVisible();
    await audit.assert();
  } finally {
    await page.mouse.up();
    await fixture.cleanup();
  }
});
