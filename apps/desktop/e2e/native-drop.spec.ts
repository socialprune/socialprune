import { expect, test } from '@playwright/test';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, call } from './helpers.ts';
import { root } from '../packaging/paths.ts';
import { writeZipFile } from '../../../tools/fixture-gen/src/shared/zip.ts';

test('native ZIP drop imports through main without renderer paths; dialogs follow app language', async () => {
  const app = await launch('probe', false);
  try {
    const entries: { path: string; content: Uint8Array }[] = [],
      folder = join(root, 'fixtures/synthetic/demo/x/twitter-2026-10-01-demox');
    const collect = async (prefix = ''): Promise<void> => {
      for (const entry of await readdir(join(folder, prefix), {
        withFileTypes: true,
      })) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await collect(path);
        else if (entry.isFile())
          entries.push({ path, content: await readFile(join(folder, path)) });
      }
    };
    await collect();
    const zip = join(app.data, 'generated-drop.zip');
    await writeZipFile(zip, entries);
    await app.page.locator('header select').selectOption('de');
    await expect(app.page.locator('html')).toHaveAttribute('lang', 'de');
    await expect
      .poll(async () =>
        readFile(join(app.data, 'ui-language.json'), 'utf8').catch(() => ''),
      )
      .toBe('"de"');
    await call(app, { type: 'importExport', requestId: 'german-dialog' });
    await app.page.screenshot({
      path: test.info().outputPath('native-drop-de.png'),
      fullPage: true,
    });
    await app.page.locator('header select').selectOption('en');
    await expect
      .poll(async () =>
        readFile(join(app.data, 'ui-language.json'), 'utf8').catch(() => ''),
      )
      .toBe('"en"');
    await call(app, { type: 'backupRestore', requestId: 'english-dialog' });
    expect(
      await app.application.evaluate(
        () =>
          (
            Reflect.get(globalThis, 'desktopProbe') as {
              dialogLocales: string[];
            }
          ).dialogLocales,
      ),
    ).toEqual(['de', 'en']);
    await app.page.evaluate(() => {
      Reflect.set(window, 'dropReplies', []);
      window.addEventListener('socialprune:import-dropped', (event) => {
        (Reflect.get(window, 'dropReplies') as string[]).push(
          (event as CustomEvent<string>).detail,
        );
      });
    });
    const cdp = await app.page.context().newCDPSession(app.page);
    const drop = async (file: string) => {
      await cdp.send('Input.dispatchDragEvent', {
        type: 'dragEnter',
        x: 300,
        y: 300,
        data: { items: [], files: [file], dragOperationsMask: 1 },
      });
      await cdp.send('Input.dispatchDragEvent', {
        type: 'dragOver',
        x: 300,
        y: 300,
        data: { items: [], files: [file], dragOperationsMask: 1 },
      });
      await cdp.send('Input.dispatchDragEvent', {
        type: 'drop',
        x: 300,
        y: 300,
        data: { items: [], files: [file], dragOperationsMask: 1 },
      });
    };
    await drop(zip);
    await expect(app.page.getByTestId('review-card')).toBeVisible();
    const summary = await call(app, {
      type: 'open',
      requestId: 'after-drop',
      workspaceId: 'local',
    });
    expect(summary).toMatchObject({
      type: 'reviewReply',
      replies: [{ type: 'opened', summary: { counts: { items: 300 } } }],
    });
    const replies = await app.page.evaluate(
      () => Reflect.get(window, 'dropReplies') as string[],
    );
    expect(replies).toHaveLength(1);
    expect(JSON.parse(replies[0]!)).toMatchObject({
      type: 'exportImported',
      result: { status: 'imported', items: 300 },
    });
    expect(replies.join('')).not.toContain(app.data);
    await app.page.screenshot({
      path: test.info().outputPath('native-drop-en.png'),
      fullPage: true,
    });
    const invalid = join(app.data, 'generated-not-zip.json');
    await writeFile(invalid, '{}');
    await drop(invalid);
    await expect
      .poll(() =>
        app.page.evaluate(
          () => (Reflect.get(window, 'dropReplies') as string[]).length,
        ),
      )
      .toBe(2);
    expect(
      await app.page.evaluate(
        () =>
          JSON.parse(
            (Reflect.get(window, 'dropReplies') as string[])[1]!,
          ) as unknown,
      ),
    ).toMatchObject({ type: 'desktopFailed', code: 'INVALID_ARCHIVE_PATH' });
    await app.page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(['not native'], 'forged.zip', { type: 'application/zip' }),
      );
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer }));
    });
    expect(
      await app.page.evaluate(
        () => (Reflect.get(window, 'dropReplies') as string[]).length,
      ),
    ).toBe(2);
    await cdp.detach();
    expect(app.errors).toEqual([]);
    expect(
      app.requests.filter((url) => !url.startsWith('app://socialprune/')),
    ).toEqual([]);
  } finally {
    await app.close();
  }
});
