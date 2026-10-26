import { expect, test } from '@playwright/test';
import { extractFile } from '@electron/asar';
import { join } from 'node:path';
import { dist, executable } from '../packaging/paths.ts';
import { assertFuses } from '../packaging/fuses.ts';
import { call, launch } from './helpers.ts';

test('packaged release has no quiet presentation or runtime selector and cannot accept the test inspector', async () => {
  const main = (variant: 'release' | 'test') =>
    extractFile(
      join(dist, variant, 'resources/app.asar'),
      'main.mjs',
    ).toString();
  expect(main('release')).not.toMatch(/showInactive|setFocusable|moveBottom/);
  expect(main('test').includes('showInactive')).toBe(true);
  expect(main('test').includes('setFocusable(false)')).toBe(true);
  await assertFuses(executable('release'), false);
  await assertFuses(executable('test'), true);
});

for (const variant of ['test', 'probe'] as const)
  test(`${variant} windows stay visible at their real bounds without activation, including another show`, async () => {
    const app = await launch(variant);
    const state = () =>
      app.application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        return {
          visible: window.isVisible(),
          minimized: window.isMinimized(),
          focused: window.isFocused(),
          focusable: window.isFocusable(),
          bounds: window.getBounds(),
        };
      });
    try {
      const before = await state();
      expect(before).toMatchObject({
        visible: true,
        minimized: false,
        focused: false,
        focusable: false,
      });
      await app.application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        // Same calls as the production single-instance handler. Only this
        // entry's presentation overrides change their behaviour.
        window.show();
        window.focus();
      });
      expect(await state()).toEqual(before);
      await app.page.getByRole('tab', { name: /^All,/ }).click();
      await app.page.getByRole('button', { name: /^Keep/ }).first().click();
      expect(
        await call(app, {
          type: 'open',
          requestId: 'quiet-window-decision',
          workspaceId: 'local',
        }),
      ).toMatchObject({
        type: 'reviewReply',
        replies: [{ type: 'opened', summary: { decisions: { keep: 1 } } }],
      });
      expect(await state()).toEqual(before);
      // Durable state and renderer acknowledgement are separate; the latter
      // disarms beforeunload before test teardown asks Electron to quit.
      await app.settleDecisions();
      await app.application.evaluate(({ dialog }) => {
        Reflect.set(globalThis, 'unexpectedPendingQuit', 0);
        dialog.showMessageBoxSync = () => {
          Reflect.set(globalThis, 'unexpectedPendingQuit', 1);
          return 1;
        };
      });
      await app.page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        if (event.defaultPrevented)
          throw new Error('DECISION_QUEUE_STILL_PENDING');
      });
    } finally {
      await app.close();
    }
  });
