import { expect, test } from '@playwright/test';
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  symlink,
  realpath,
  lstat,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { launch } from './helpers.ts';
import { lockGeneratedFile } from '../test/file-lock.ts';
import { windowsShortPath } from '../test/short-path.ts';

test('display recovery moves only an injected wholly offscreen owner without activation and leaves a visible placement', async () => {
  const app = await launch('probe', true);
  try {
    await app.application.evaluate(({ screen }) => {
      const probe = Reflect.get(globalThis, 'desktopProbe') as {
        platformWindow: { value: unknown };
      };
      probe.platformWindow.value = {
        id: 'generated-owned-window',
        bounds: { x: 99999, y: 99999, width: 500, height: 500 },
      };
      screen.emit('display-removed');
    });
    await expect
      .poll(() =>
        app.application.evaluate(
          () =>
            (
              Reflect.get(globalThis, 'desktopProbe') as {
                platformWindow: { moves: unknown[] };
              }
            ).platformWindow.moves.length,
        ),
      )
      .toBe(1);
    expect(
      await app.application.evaluate(
        () =>
          (
            Reflect.get(globalThis, 'desktopProbe') as {
              platformWindow: { moves: unknown[] };
            }
          ).platformWindow.moves,
      ),
    ).toMatchObject([
      { id: 'generated-owned-window', flags: { activate: false } },
    ]);
    await app.application.evaluate(({ screen }) => {
      const probe = Reflect.get(globalThis, 'desktopProbe') as {
        platformWindow: { value: unknown };
      };
      const area = screen.getPrimaryDisplay().workArea;
      probe.platformWindow.value = {
        id: 'generated-owned-window',
        bounds: { x: area.x, y: area.y, width: 500, height: 500 },
      };
      screen.emit('display-metrics-changed');
    });
    await expect(
      app.page.getByRole('button', { name: 'Data and backups', exact: true }),
    ).toBeVisible();
    expect(
      await app.application.evaluate(
        () =>
          (
            Reflect.get(globalThis, 'desktopProbe') as {
              platformWindow: { moves: unknown[] };
            }
          ).platformWindow.moves,
      ),
    ).toHaveLength(1);
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('data removal confirms generated managed data and quits with partial receipt while backups, unknown files and link targets remain', async () => {
  const app = await launch(
    'probe',
    true,
    async (data) => {
      await writeFile(join(data, 'unknown.txt'), 'generated unknown');
      await writeFile(join(data, 'generated-backup.json'), 'generated backup');
      const outside = join(dirname(data), 'outside');
      await mkdir(outside);
      await writeFile(join(outside, 'keep.txt'), 'generated external');
      await symlink(outside, join(data, 'workspace', 'originals'), 'junction');
    },
    async (data) => {
      const canonical = await realpath(data);
      const selected =
        (await windowsShortPath(data)) ??
        canonical[0]!.toLowerCase() + canonical.slice(1);
      expect(selected).not.toBe(canonical);
      expect((await lstat(selected)).isSymbolicLink()).toBe(false);
      return selected;
    },
  );
  let unlock: (() => Promise<void>) | undefined;
  try {
    expect(
      await app.application.evaluate(({ app }) => app.getPath('userData')),
    ).toBe(await realpath(app.data));
    await app.application.evaluate(() => {
      (
        Reflect.get(globalThis, 'desktopProbe') as {
          platformWindow: { value: unknown };
        }
      ).platformWindow.value = {
        id: 'generated-open-window',
        bounds: { x: 0, y: 0, width: 500, height: 500 },
      };
    });
    await app.page
      .getByRole('button', { name: 'Data and backups', exact: true })
      .click();
    await app.page
      .getByRole('button', { name: 'Show what will be removed', exact: true })
      .click();
    await expect(app.page.getByRole('alert')).toContainText('Close the run');
    await app.application.evaluate(() => {
      (
        Reflect.get(globalThis, 'desktopProbe') as {
          platformWindow: { value: unknown };
        }
      ).platformWindow.value = null;
    });
    await app.page.locator('header select').selectOption('de');
    await expect
      .poll(() =>
        readFile(join(app.data, 'ui-language.json'), 'utf8').catch(() => ''),
      )
      .toBe('"de"');
    unlock = await lockGeneratedFile(join(app.data, 'ui-language.json'));
    await app.page
      .getByRole('button', { name: 'Liste zum Entfernen anzeigen' })
      .click();
    const preview = app.page.getByRole('dialog', {
      name: 'App-Daten entfernen',
    });
    await expect(preview).toContainText('generated-backup.json');
    await expect(preview).toContainText('unknown.txt');
    await expect(preview).toContainText('Verknüpfung abgelehnt');
    const confirm = preview.getByRole('button', {
      name: 'Aufgeführte Daten entfernen und beenden',
    });
    await expect(confirm).toBeDisabled();
    await preview.getByRole('textbox').fill('REMOVE');
    await preview.getByRole('checkbox').check();
    await expect(confirm).toBeDisabled();
    await preview.getByRole('textbox').fill('ENTFERNEN');
    await expect(confirm).toBeEnabled();
    await app.page.screenshot({
      path: test.info().outputPath('candidate-removal-de.png'),
      fullPage: true,
    });
    const closed = new Promise<void>((resolve) =>
      app.process.once('exit', () => resolve()),
    );
    await confirm.click();
    await closed;
    const receiptName = (await readdir(app.data)).find((name) =>
      name.startsWith('data-removal-receipt-'),
    );
    expect(receiptName).toBeDefined();
    expect(
      JSON.parse(await readFile(join(app.data, receiptName!), 'utf8')),
    ).toMatchObject({ state: 'partial', failures: ['locked'] });
    await expect(
      readFile(join(app.data, 'workspace', 'socialprune.sqlite')),
    ).rejects.toThrow();
    expect(await readFile(join(app.data, 'unknown.txt'), 'utf8')).toBe(
      'generated unknown',
    );
    expect(
      await readFile(join(app.data, 'generated-backup.json'), 'utf8'),
    ).toBe('generated backup');
    expect(
      await readFile(join(dirname(app.data), 'outside', 'keep.txt'), 'utf8'),
    ).toBe('generated external');
    expect(app.errors).toEqual([]);
  } finally {
    await unlock?.();
    await app.close();
  }
});
