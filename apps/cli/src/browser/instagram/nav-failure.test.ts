import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';
import type { Page, Request } from 'playwright-core';
import {
  guardAbortedRequests,
  navMessageClass,
  navPathClass,
  observeListNavigation,
} from './nav-failure.ts';
import {
  ContextStop,
  NAV_MESSAGE_CLASSES,
  NavigationFailureSchema,
  stopDetails,
  stopDetailText,
} from './report.ts';

const origin = 'https://www.instagram.com';
const planted = 'generated_secret_handle';

test('NAV-DIAG-1 message classes are closed and never keep the text', () => {
  const timeout = Object.assign(
    new Error(`page.goto: Timeout 5000ms exceeded. ${origin}/${planted}`),
    { name: 'TimeoutError' },
  );
  expect(navMessageClass(timeout)).toBe('timeout-exceeded');
  for (const [name, expected] of [
    ['CONNECTION_RESET', 'net-err-connection-reset'],
    ['TIMED_OUT', 'net-err-timed-out'],
    ['HTTP2_PROTOCOL_ERROR', 'net-err-http2-protocol-error'],
    ['ABORTED', 'net-err-aborted'],
    ['BLOCKED_BY_CLIENT', 'net-err-blocked-by-client'],
  ])
    expect(
      navMessageClass(new Error(`page.goto: net::ERR_${name} at ${planted}`)),
    ).toBe(expected);
  expect(navMessageClass(new Error('net::ERR_GENERATED_UNKNOWN'))).toBe(
    'other',
  );
  expect(
    navMessageClass(
      new Error(
        `Navigation to "${origin}/a" is interrupted by another navigation to "${origin}/${planted}"`,
      ),
    ),
  ).toBe('interrupted-by-navigation');
  expect(navMessageClass(new Error(planted))).toBe('other');
  expect(navMessageClass('not an error')).toBe('other');
  for (const value of NAV_MESSAGE_CLASSES)
    expect(value).toMatch(/^[a-z0-9-]+$/u);
});
test('NAV-DIAG-1 path classes are relative to the run origin', () => {
  expect(
    navPathClass(`${origin}/your_activity/interactions/comments/`, origin),
  ).toBe('comments-list');
  expect(
    navPathClass(`${origin}/accounts/login/?next=${planted}`, origin),
  ).toBe('login');
  expect(navPathClass(`${origin}/challenge/${planted}/`, origin)).toBe(
    'challenge',
  );
  expect(navPathClass(`${origin}/${planted}/`, origin)).toBe('other-instagram');
  expect(navPathClass(`https://generated.example/${planted}`, origin)).toBe(
    'other-host',
  );
  expect(navPathClass('about:blank', origin)).toBe('about-blank');
  expect(navPathClass('not a url', origin)).toBe('unknown');
});
function generatedPage(url: string) {
  const events = new EventEmitter();
  const frame = {};
  const page = Object.assign(events, {
    url: () => url,
    mainFrame: () => frame,
    off: events.off.bind(events),
  }) as unknown as Page;
  const request = (address: string) =>
    ({
      url: () => address,
      isNavigationRequest: () => true,
      frame: () => frame,
      redirectedFrom: () => null,
    }) as unknown as Request;
  return { page, events, request };
}
test('NAV-DIAG-1 the observer records response, guard abort and a late replacing navigation', () => {
  const list = `${origin}/your_activity/interactions/comments`;
  const { page, events, request } = generatedPage(list);
  const observed = observeListNavigation(page, origin);
  const document = request(list);
  guardAbortedRequests.add(document);
  events.emit('requestfailed', document);
  const failure = observed.failure(
    new Error(`page.goto: net::ERR_ABORTED at ${list}`),
  );
  expect(failure).toMatchObject({
    errorClass: 'other',
    messageClass: 'net-err-aborted',
    documentResponse: false,
    documentStatus: null,
    pagePathClass: 'comments-list',
    targetPathClass: null,
    guardAborted: true,
    guardHostClass: 'instagram',
  });
  observed.dispose();
  // The replacing navigation's request arrives after the rejection.
  events.emit('request', request(`${origin}/accounts/login/?next=${planted}`));
  expect(failure).toMatchObject({
    messageClass: 'interrupted-by-navigation',
    targetPathClass: 'login',
  });
  expect(JSON.stringify(failure)).not.toContain(planted);
  expect(NavigationFailureSchema.parse(failure)).toEqual(failure);
});
test('NAV-DIAG-1 a navigation stop carries the fields into stop details and the Stop detail line only', () => {
  const failure = NavigationFailureSchema.parse({
    errorClass: 'timeout',
    messageClass: 'timeout-exceeded',
    elapsedMs: 15003,
    documentResponse: false,
    documentStatus: null,
    pagePathClass: 'comments-list',
    targetPathClass: null,
    guardAborted: false,
    guardHostClass: null,
  });
  const stop = new ContextStop('PLATFORM_CHECK', 'navigation');
  expect(stopDetails(stop)).toEqual({
    code: 'PLATFORM_CHECK',
    token: 'navigation',
  });
  expect(stopDetailText(stop)).toBe('navigation');
  stop.navigationFailure = failure;
  expect(stopDetails(stop)).toEqual({
    code: 'PLATFORM_CHECK',
    token: 'navigation',
    navigationFailure: failure,
  });
  expect(stopDetailText(stop)).toBe(
    'navigation; navErrorClass=timeout; navMessageClass=timeout-exceeded; navElapsedMs=15003; navDocumentResponse=false; navDocumentStatus=none; navPagePath=comments-list; navTargetPath=none; navGuardAborted=false; navGuardHost=none',
  );
  const other = new ContextStop('PLATFORM_CHECK', 'login');
  other.navigationFailure = failure;
  expect(stopDetails(other)).toEqual({
    code: 'PLATFORM_CHECK',
    token: 'login',
  });
  expect(() =>
    NavigationFailureSchema.parse({ ...failure, messageClass: planted }),
  ).toThrow();
  expect(() =>
    NavigationFailureSchema.parse({ ...failure, url: planted }),
  ).toThrow();
});
