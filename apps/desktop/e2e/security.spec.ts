import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch } from './helpers.ts';
import {
  assertPolicyEvents,
  assertRenderer,
  observePolicy,
  rendererState,
} from '../test/controls.ts';

test('renderer has exact bridge, no Node, strict header/meta policy and no network', async () => {
  const app = await launch('probe');
  try {
    const events = await observePolicy(app.page);
    const headers: string[] = [];
    app.page.on('response', (response) => {
      const policy = response.headers()['content-security-policy'];
      if (policy) headers.push(policy);
    });
    await app.page.reload();
    await expect(
      app.page.getByRole('navigation', { name: 'SocialPrune' }),
    ).toBeVisible();
    assertRenderer(await rendererState(app.page));
    const expected =
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src app:; media-src app:; connect-src 'none'; worker-src 'none'; font-src 'none'; manifest-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types socialprune";
    expect(headers.length).toBeGreaterThanOrEqual(2);
    expect(headers.every((policy) => policy === expected)).toBe(true);
    expect(
      await app.page
        .locator('meta[http-equiv="Content-Security-Policy"]')
        .getAttribute('content'),
    ).toBe(expected);
    const sessionRequests = await app.application.evaluate(
      () =>
        (Reflect.get(globalThis, 'desktopProbe') as { requests: string[] })
          .requests,
    );
    expect(sessionRequests.length).toBeGreaterThanOrEqual(3);
    assertPolicyEvents(await events(), sessionRequests);
    const preferences = await app.application.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]!
        .webContents as unknown as {
        getLastWebPreferences(): Record<string, unknown>;
      };
      return contents.getLastWebPreferences();
    });
    expect(preferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    });
    expect(
      await app.page.evaluate(() => {
        try {
          return window.socialprune
            .request({ type: 'arbitrary' } as never)
            .then(
              () => false,
              () => true,
            );
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    expect(
      await app.page.evaluate(() => {
        const unsubscribe = window.socialprune.onRunView(() => undefined);
        return { type: typeof unsubscribe, result: typeof unsubscribe() };
      }),
    ).toEqual({ type: 'function', result: 'undefined' });
  } finally {
    await app.close();
  }
});

test('navigation, popups and permissions do not grant a second surface', async () => {
  const app = await launch();
  try {
    await app.page.evaluate(() => {
      window.open('app://socialprune/desktop.html');
      location.href = 'app://socialprune/missing';
    });
    await expect.poll(() => app.application.windows().length).toBe(1);
    expect(app.page.url()).toMatch(/^app:\/\/socialprune\/desktop.html/);
    expect(
      await app.application.evaluate(({ session }) =>
        session.fromPartition('socialprune').getPreloads(),
      ),
    ).toEqual([]);
    expect(
      await app.page.evaluate(async () => {
        try {
          await navigator.mediaDevices.getUserMedia({ audio: true });
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
  } finally {
    await app.close();
  }
});

test('actual second webContents and navigated app page cannot use IPC', async () => {
  const app = await launch('probe');
  try {
    const ownerId = await app.application.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.id,
    );
    await app.application.evaluate(
      async ({ BrowserWindow, app: electronApp, session }) => {
        const other = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            session: session.fromPartition('socialprune'),
            preload: electronApp.getAppPath() + '/preload.cjs',
          },
        });
        await other.loadURL('app://socialprune/desktop.html');
      },
    );
    await expect
      .poll(async () => {
        try {
          return (
            await readFile(join(app.data, 'logs/desktop.ndjson'), 'utf8')
          ).includes('SENDER_REJECTED');
        } catch {
          return false;
        }
      })
      .toBe(true);
    const other = app.application
      .windows()
      .find((window) => window !== app.page)!;
    await expect(
      other.evaluate(() =>
        window.socialprune.request({
          type: 'runView',
          requestId: crypto.randomUUID(),
        }),
      ),
    ).rejects.toThrow('BRIDGE_REJECTED');
    await app.application.evaluate(async ({ BrowserWindow }, id) => {
      await BrowserWindow.fromId(id)!.loadURL('about:blank');
    }, ownerId);
    await expect(
      app.page.evaluate(() =>
        window.socialprune.request({
          type: 'runView',
          requestId: '00000000-0000-4000-8000-000000000001',
        }),
      ),
    ).rejects.toThrow('BRIDGE_REJECTED');
    const log = await readFile(join(app.data, 'logs/desktop.ndjson'), 'utf8');
    expect(log).not.toMatch(/requestId|about:|app:|foundationRead/);
  } finally {
    await app.close();
  }
});

test('an empty data folder opens a real workspace without crashing', async () => {
  const app = await launch('test', false);
  try {
    for (let index = 0; index < 2; index++)
      expect(
        await app.page.evaluate(() =>
          window.socialprune.request({
            type: 'open',
            workspaceId: 'local',
            requestId: crypto.randomUUID(),
          }),
        ),
      ).toMatchObject({
        type: 'reviewReply',
        replies: [{ type: 'opened', summary: { counts: { items: 0 } } }],
      });
    expect(app.application.process().exitCode).toBeNull();
  } finally {
    await app.close();
  }
});

test('terminated utility returns ENGINE_UNAVAILABLE and parent still quits', async () => {
  const app = await launch('probe');
  try {
    await app.application.evaluate(async () => {
      const state = Reflect.get(globalThis, 'desktopProbe') as {
        engine: {
          child: {
            kill(): boolean;
            once(event: string, listener: () => void): void;
          };
        };
      };
      await new Promise<void>((resolve) => {
        state.engine.child.once('exit', resolve);
        state.engine.child.kill();
      });
    });
    expect(
      await app.page.evaluate(() =>
        window.socialprune.request({
          type: 'runView',
          requestId: crypto.randomUUID(),
        }),
      ),
    ).toMatchObject({ type: 'desktopFailed', code: 'ENGINE_UNAVAILABLE' });
    await expect
      .poll(async () => {
        try {
          return (
            await readFile(join(app.data, 'logs/desktop.ndjson'), 'utf8')
          ).includes('ENGINE_EXITED');
        } catch (error) {
          // record() queues appendFile; its first append may not exist yet.
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          )
            return false;
          throw error;
        }
      })
      .toBe(true);
  } finally {
    await app.close();
  }
});
