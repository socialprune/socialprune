import { expect, test } from '@playwright/test';
import { call, launch } from './helpers.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

for (const locale of ['en', 'de'] as const)
  test(`native pending-decision ${locale} Wait preserves the window and drains before later close`, async () => {
    const app = await launch('probe');
    const dialogs: unknown[] = [];
    try {
      if (locale === 'de')
        await app.page.locator('header select').selectOption('de');
      await app.application.evaluate(({ dialog }) => {
        const rows: unknown[] = [];
        Reflect.set(globalThis, 'pendingQuitDialogs', rows);
        dialog.showMessageBoxSync = (...args: unknown[]) => {
          rows.push(args.at(-1));
          return 0;
        };
      });
      await app.application.evaluate(() => {
        // Test-only main entry exposes the engine; delay its reply after the
        // real review engine saved, without altering the frozen preload bridge.
        const send = (
          Reflect.get(globalThis, 'desktopProbe') as {
            engine: {
              request(value: { request: { type: string } }): Promise<unknown>;
            };
          }
        ).engine;
        const original = send.request.bind(send);
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        Reflect.set(globalThis, 'releaseDecisionReply', release);
        send.request = async (value) => {
          const reply = await original(value);
          if (value.request.type === 'decide') await held;
          return reply;
        };
      });
      await app.page
        .getByRole('tab', { name: locale === 'de' ? /^Alle,/ : /^All,/ })
        .click();
      await app.page
        .getByRole('button', { name: locale === 'de' ? /^Behalten/ : /^Keep/ })
        .first()
        .click();
      await expect(
        app.page.getByText(
          locale === 'de'
            ? /Eine Entscheidung wird noch gespeichert/
            : /One decision is still being saved/,
        ),
      ).toBeVisible();
      await app.application.evaluate(({ BrowserWindow, app }, language) => {
        if (language === 'de') app.quit();
        else BrowserWindow.getAllWindows()[0]!.close();
      }, locale);
      const boxes = await app.application.evaluate(
        () => Reflect.get(globalThis, 'pendingQuitDialogs') as unknown[],
      );
      dialogs.push(...boxes);
      expect(boxes).toEqual([
        expect.objectContaining({
          message:
            locale === 'de'
              ? 'Deine Entscheidungen werden noch gespeichert.'
              : 'Your decisions are still being saved.',
          buttons:
            locale === 'de'
              ? ['Warten', 'Trotzdem beenden']
              : ['Wait', 'Quit anyway'],
          defaultId: 0,
          cancelId: 0,
        }),
      ]);
      expect(app.process.exitCode).toBeNull();
      expect(
        await call(app, {
          type: 'open',
          requestId: 'pending-still-alive',
          workspaceId: 'local',
        }),
      ).toMatchObject({
        type: 'reviewReply',
        replies: [{ type: 'opened', summary: { decisions: { keep: 1 } } }],
      });
      await app.application.evaluate(() => {
        (Reflect.get(globalThis, 'releaseDecisionReply') as () => void)();
      });
      await app.settleDecisions();
      expect(
        await app.application.evaluate(
          () =>
            (Reflect.get(globalThis, 'pendingQuitDialogs') as unknown[]).length,
        ),
      ).toBe(1);
    } finally {
      await app.application
        .evaluate(() => {
          (
            Reflect.get(globalThis, 'releaseDecisionReply') as
              (() => void) | undefined
          )?.();
        })
        .catch(() => {});
      await app.close();
    }
    expect(dialogs).toHaveLength(1);
  });

test('app quit with a prevented unload offers Quit anyway and settles through before-quit', async () => {
  const app = await launch('probe');
  try {
    await app.page.evaluate(() => {
      window.addEventListener('beforeunload', (event) => {
        event.preventDefault();
        event.returnValue = '';
      });
    });
    await app.application.evaluate(({ app, dialog }) => {
      dialog.showMessageBoxSync = () => 1;
      app.quit();
    });
    await expect.poll(() => app.process.exitCode, { timeout: 30000 }).toBe(0);
    const log = await readFile(
      join(app.selectedData, 'logs/desktop.ndjson'),
      'utf8',
    );
    expect(log).toContain('PENDING_DECISIONS_QUIT');
    expect(log).not.toContain('ENGINE_CLOSE_FAILED');
  } finally {
    await app.close();
  }
});
