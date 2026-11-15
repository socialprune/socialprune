import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';
import type { Page, Request } from 'playwright-core';
import { PostNotReady, postOpenPathClass, watchPostOpen } from './post-open.ts';
import { PostOpenRetries } from './retry.ts';
import {
  ContextStop,
  PostOpenDiagnosticSchema,
  stopDetails,
} from './report.ts';

const origin = 'https://www.instagram.com';
const planted = 'generated_secret_handle';

test('POST-READY-1 path classes are closed and relative to the run origin', () => {
  expect(postOpenPathClass(`${origin}/p/GeneratedCode/`, origin)).toBe('post');
  expect(postOpenPathClass(`${origin}/p/GeneratedCode/c/123/`, origin)).toBe(
    'post',
  );
  expect(postOpenPathClass(`${origin}/reel/GeneratedCode`, origin)).toBe(
    'reel',
  );
  expect(
    postOpenPathClass(`${origin}/your_activity/interactions/comments`, origin),
  ).toBe('comments-list');
  expect(postOpenPathClass(`${origin}/${planted}/`, origin)).toBe(
    'other-instagram',
  );
  expect(postOpenPathClass(`https://generated.example/p/X`, origin)).toBe(
    'other-host',
  );
  expect(postOpenPathClass('about:blank', origin)).toBe('about-blank');
  expect(postOpenPathClass('not a url', origin)).toBe('unknown');
});
test('POST-READY-1 the watch counts only main-frame navigation after the press and keeps no address', () => {
  const events = new EventEmitter();
  const frame = {};
  let url = `${origin}/your_activity/interactions/comments`;
  const page = Object.assign(events, {
    url: () => url,
    mainFrame: () => frame,
  }) as unknown as Page;
  const request = {
    url: () => `${origin}/p/${planted}`,
    isNavigationRequest: () => true,
    frame: () => frame,
  } as unknown as Request;
  const watch = watchPostOpen(page, origin);
  // Before the press nothing counts.
  events.emit('request', request);
  expect(watch.navigationStarted()).toBe(false);
  watch.pressed();
  expect(watch.summary()).toEqual({
    navigationStarted: false,
    navigationMs: null,
    documentResponse: false,
    documentStatus: null,
    pagePathClass: 'comments-list',
  });
  events.emit('request', request);
  const response = { request: () => request, status: () => 200 };
  events.emit('response', response);
  url = `${origin}/p/${planted}/`;
  const summary = watch.summary({ position: 'left', hoverPassed: true });
  expect(typeof summary.navigationMs).toBe('number');
  expect(summary).toMatchObject({
    navigationStarted: true,
    documentResponse: true,
    documentStatus: 200,
    pagePathClass: 'post',
    pressPosition: 'left',
    hoverPassed: true,
  });
  expect(JSON.stringify(summary)).not.toContain(planted);
  expect(() =>
    PostOpenDiagnosticSchema.parse({ ...summary, url: planted }),
  ).toThrow();
  watch.dispose();
  expect(events.listenerCount('request')).toBe(0);
});
test('POST-READY-1 a not-ready post keeps the old stop and reopens once only in main row-click opens', () => {
  const stop = new PostNotReady(true, false);
  expect(stopDetails(stop)).toEqual({
    code: 'INSTAGRAM_SHAPE_CHANGED',
    token: 'post-structure',
  });
  const retries = new PostOpenRetries();
  // Canary, no capacity, diagnostic run: never.
  expect(retries.beginNotReady(stop, ['a'], 1, true, true, false)).toBeNull();
  expect(retries.beginNotReady(stop, ['a'], 1, false, false, false)).toBeNull();
  expect(
    retries.beginNotReady(stop, ['a'], 1, false, true, false, true),
  ).toBeNull();
  // A reopen of a known target is not a row click.
  expect(
    retries.beginNotReady(
      new PostNotReady(false, true),
      ['a'],
      1,
      false,
      true,
      true,
    ),
  ).toBeNull();
  // A navigation without a validated target stops.
  expect(
    retries.beginNotReady(
      new PostNotReady(true, true),
      ['a'],
      1,
      false,
      true,
      false,
    ),
  ).toBeNull();
  // Other stops never qualify.
  expect(
    retries.beginNotReady(
      new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure'),
      ['a'],
      1,
      false,
      true,
      false,
    ),
  ).toBeNull();
  expect(retries.beginNotReady(stop, ['a'], 1, false, true, false)).toEqual({
    step: 1,
    retryStep: null,
    stage: 'post-not-ready',
    waitedMs: 0,
    outcome: null,
  });
  expect(retries.beginNotReady(stop, ['a'], 2, false, true, false)).toBeNull();
  expect(
    retries.beginNotReady(
      new PostNotReady(true, true),
      ['b', 't'],
      3,
      false,
      true,
      true,
    ),
  ).toMatchObject({ stage: 'post-not-ready' });
  expect(
    retries.beginNotReady(stop, ['c'], 5, false, true, false),
  ).toMatchObject({ stage: 'post-not-ready' });
  expect(retries.beginNotReady(stop, ['d'], 7, false, true, false)).toBeNull();
  expect(retries.summary().used).toBe(3);
});
