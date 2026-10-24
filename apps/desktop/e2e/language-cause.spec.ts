import { expect, test } from '@playwright/test';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { launch } from './helpers.ts';
import { LOCALE_CHANNEL } from '../src/protocol.ts';
import { lockLanguageFile } from '../test/language-lock.ts';

test('language boundary without a dialog retains the last of repeated renderer choices', async () => {
  const app = await launch('probe', false);
  try {
    await app.application.evaluate(({ ipcMain }, channel) => {
      const values: string[] = [];
      Reflect.set(globalThis, 'languageEvidence', values);
      ipcMain.on(channel, (_event, value: unknown) => {
        if (value === 'de' || value === 'en') values.push(value);
      });
    }, LOCALE_CHANNEL);
    for (let step = 0; step < 30; step++) {
      const locale = step % 2 ? 'en' : 'de';
      await app.page.locator('header select').selectOption(locale);
      await expect(app.page.locator('html')).toHaveAttribute('lang', locale);
      await expect
        .poll(() =>
          readFile(join(app.data, 'ui-language.json'), 'utf8').catch(() => ''),
        )
        .toBe(JSON.stringify(locale));
    }
    expect(
      await app.application.evaluate(() =>
        (Reflect.get(globalThis, 'languageEvidence') as string[]).at(-1),
      ),
    ).toBe('en');
    expect(
      await app.page.evaluate(() => localStorage.getItem('sp-locale')),
    ).toBe('en');
    expect(
      await app.application.evaluate(({ app }) => app.getPath('userData')),
    ).toBe(await realpath(app.data));
    expect(
      await app.application.evaluate(
        () =>
          (
            Reflect.get(globalThis, 'desktopProbe') as {
              counts: Record<string, number>;
            }
          ).counts.LANGUAGE_WRITE_FAILED ?? 0,
      ),
    ).toBe(0);
    await test.info().attach('boundary', {
      body: JSON.stringify({
        messages: await app.application.evaluate(
          () => Reflect.get(globalThis, 'languageEvidence') as string[],
        ),
        html: await app.page.locator('html').getAttribute('lang'),
        saved: await readFile(join(app.data, 'ui-language.json'), 'utf8'),
        dialogs: [],
      }),
      contentType: 'application/json',
    });
  } finally {
    await app.close();
  }
});

test('a transient Windows reader cannot lose an English preference after German was saved', async () => {
  const app = await launch('probe', false);
  let unlock: (() => Promise<void>) | undefined;
  try {
    await app.page.locator('header select').selectOption('de');
    await expect
      .poll(() =>
        readFile(join(app.data, 'ui-language.json'), 'utf8').catch(() => ''),
      )
      .toBe('"de"');
    await app.application.evaluate(({ ipcMain }, channel) => {
      const values: string[] = [];
      Reflect.set(globalThis, 'languageEvidence', values);
      ipcMain.on(channel, (_event, value: unknown) => {
        if (value === 'de' || value === 'en') values.push(value);
      });
    }, LOCALE_CHANNEL);
    unlock = await lockLanguageFile(join(app.data, 'ui-language.json'));
    await app.page.locator('header select').selectOption('en');
    await expect(app.page.locator('html')).toHaveAttribute('lang', 'en');
    await expect
      .poll(() =>
        app.application.evaluate(() =>
          (Reflect.get(globalThis, 'languageEvidence') as string[]).includes(
            'en',
          ),
        ),
      )
      .toBe(true);
    // Hold through the same native rename's existing Windows sharing retry,
    // then release before testing eventual persistence. No second en message.
    await app.page.waitForTimeout(250);
    await unlock();
    const evidence = {
      messages: await app.application.evaluate(
        () => Reflect.get(globalThis, 'languageEvidence') as string[],
      ),
      html: await app.page.locator('html').getAttribute('lang'),
      storage: await app.page.evaluate(() => localStorage.getItem('sp-locale')),
      saved: await readFile(join(app.data, 'ui-language.json'), 'utf8'),
      counts: await app.application.evaluate(
        () =>
          (
            Reflect.get(globalThis, 'desktopProbe') as {
              counts: Record<string, number>;
            }
          ).counts,
      ),
      log: await readFile(
        join(app.data, 'logs', 'desktop.ndjson'),
        'utf8',
      ).catch(() => ''),
    };
    console.log('LANGUAGE_CAUSAL_EVIDENCE', JSON.stringify(evidence));
    await test.info().attach('causal-boundary', {
      body: JSON.stringify(evidence),
      contentType: 'application/json',
    });
    await expect
      .poll(() =>
        readFile(join(app.data, 'ui-language.json'), 'utf8').catch(() => ''),
      )
      .toBe('"en"');
    const settled = {
      saved: await readFile(join(app.data, 'ui-language.json'), 'utf8'),
      counts: await app.application.evaluate(
        () =>
          (
            Reflect.get(globalThis, 'desktopProbe') as {
              counts: Record<string, number>;
            }
          ).counts,
      ),
      log: await readFile(join(app.data, 'logs', 'desktop.ndjson'), 'utf8'),
    };
    console.log('LANGUAGE_CAUSAL_SETTLED', JSON.stringify(settled));
    expect(settled.counts.LANGUAGE_WRITE_FAILED ?? 0).toBe(0);
    expect(settled.log).toContain('LANGUAGE_WRITE_COMMITTED');
  } finally {
    await unlock?.();
    await app.close();
  }
});
