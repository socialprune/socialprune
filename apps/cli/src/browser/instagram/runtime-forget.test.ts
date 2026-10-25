import { EventEmitter } from 'node:events';
import type { BrowserContext, Page } from 'playwright-core';
import { expect, test } from 'vitest';
import { observeContextRuntime } from './network.ts';

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
