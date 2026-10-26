import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { expect, test, vi } from 'vitest';
import {
  attachPendingQuit,
  pendingQuitMessage,
} from '../src/main/pending-quit.ts';

test.each(['de', 'en'] as const)(
  'pending decisions dialog uses %s and defaults and cancels to Wait',
  (locale) => {
    expect(pendingQuitMessage(locale)).toMatchObject({
      type: 'warning',
      title: 'SocialPrune',
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      buttons:
        locale === 'de'
          ? ['Warten', 'Trotzdem beenden']
          : ['Wait', 'Quit anyway'],
    });
    expect(pendingQuitMessage(locale).message).toBe(
      locale === 'de'
        ? 'Deine Entscheidungen werden noch gespeichert.'
        : 'Your decisions are still being saved.',
    );
  },
);

test('Wait keeps unload prevented and resets active-run approval; a later drained close needs no dialog', () => {
  const contents = new EventEmitter();
  const message = vi.fn(() => 0),
    wait = vi.fn(),
    record = vi.fn(),
    preventDefault = vi.fn();
  attachPendingQuit({
    contents: contents as unknown as WebContents,
    locale: () => 'de',
    message,
    wait,
    record,
  });
  contents.emit('will-prevent-unload', { preventDefault });
  expect(message).toHaveBeenCalledExactlyOnceWith(pendingQuitMessage('de'));
  expect(preventDefault).not.toHaveBeenCalled();
  expect(wait).toHaveBeenCalledOnce();
  expect(record).toHaveBeenCalledWith('PENDING_DECISIONS_WAIT');
  // Electron emits no will-prevent-unload event once beforeunload no longer cancels.
  contents.emit('destroyed');
  expect(message).toHaveBeenCalledOnce();
});

test('Quit anyway overrides only this prevented unload and leaves settlement to normal window close', () => {
  const contents = new EventEmitter();
  const message = vi.fn(() => 1),
    wait = vi.fn(),
    record = vi.fn(),
    preventDefault = vi.fn();
  attachPendingQuit({
    contents: contents as unknown as WebContents,
    locale: () => 'en',
    message,
    wait,
    record,
  });
  contents.emit('will-prevent-unload', { preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(wait).not.toHaveBeenCalled();
  expect(record).toHaveBeenCalledWith('PENDING_DECISIONS_QUIT');
});

test('dialog failure or unrecognized response keeps the window open and records a closed cause', () => {
  for (const response of [-1, 2, 'throw'] as const) {
    const contents = new EventEmitter(),
      preventDefault = vi.fn(),
      wait = vi.fn(),
      record = vi.fn();
    attachPendingQuit({
      contents: contents as unknown as WebContents,
      locale: () => 'en',
      message: () => {
        if (response === 'throw') throw new Error('generated');
        return response;
      },
      wait,
      record,
    });
    contents.emit('will-prevent-unload', { preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(wait).toHaveBeenCalledOnce();
    if (response === 'throw')
      expect(record).toHaveBeenCalledWith('PENDING_DECISIONS_DIALOG_FAILED');
  }
});
