import { EventEmitter } from 'node:events';
import type { BrowserContext, Page } from 'playwright-core';
import { expect, test, vi } from 'vitest';
import { observeContextRuntime } from './network.ts';
import { runWaitTrace } from './automatic-run.ts';

test('C35 only the replaced reading page loses close/crash listeners; other closures still stop', () => {
  const context = new EventEmitter(),
    old = new EventEmitter(),
    current = new EventEmitter(),
    anchor = new EventEmitter();
  const runtime = observeContextRuntime(
    context as unknown as BrowserContext,
    () => ({ step: 21, stage: 'projection' }),
  );
  runtime.own(old as unknown as Page);
  runtime.own(anchor as unknown as Page);
  expect(old.listenerCount('close')).toBe(1);
  runtime.forget(old as unknown as Page);
  expect(old.listenerCount('close') + old.listenerCount('crash')).toBe(0);
  old.emit('close');
  expect(runtime.summary().unexpectedPageCloses).toBe(0);
  runtime.own(current as unknown as Page);
  current.emit('close');
  expect(runtime.summary().unexpectedPageCloses).toBe(1);
  runtime.dispose();
  expect(anchor.listenerCount('close') + current.listenerCount('close')).toBe(
    0,
  );
  expect(context.listenerCount('close')).toBe(0);
});
test('WAIT3 runtime receipt records page close before expiry and browser disconnect after watchdog close', () => {
  vi.useFakeTimers();
  try {
    const browser = new EventEmitter();
    const page = new EventEmitter();
    const trace = runWaitTrace();
    trace.phase('checkpoint');
    trace.checkpoint('profile-snapshot');
    const runtime = observeContextRuntime(
      { browser: () => browser } as unknown as BrowserContext,
      () => ({ step: 3, stage: 'checkpoint' }),
      (event) => {
        if (event !== 'page-crash') trace.event(event);
      },
    );
    runtime.own(page as unknown as Page);
    vi.advanceTimersByTime(10);
    page.emit('close');
    vi.advanceTimersByTime(20);
    trace.expire();
    trace.event('watchdog-close-request');
    browser.emit('disconnected');
    expect(trace.summary()).toMatchObject({
      expiry: {
        elapsedMs: 30,
        checkpointStep: 'profile-snapshot',
        checkpointStepStartedMs: 0,
      },
      events: [
        { event: 'page-close', elapsedMs: 10, order: 'before-expiry' },
        {
          event: 'watchdog-close-request',
          elapsedMs: 30,
          order: 'after-expiry',
        },
        { event: 'browser-disconnected', elapsedMs: 30, order: 'after-expiry' },
      ],
    });
    expect(runtime.summary()).toMatchObject({
      browserDisconnects: 1,
      unexpectedPageCloses: 1,
    });
    runtime.dispose();
    expect(
      browser.listenerCount('disconnected') + page.listenerCount('close'),
    ).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
