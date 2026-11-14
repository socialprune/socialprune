import type { Page, Request, Response } from 'playwright-core';
import {
  errorClass,
  NAV_NET_ERRORS,
  NavigationFailureSchema,
} from './report.ts';
import type {
  NavigationFailure,
  NavMessageClass,
  NavPathClass,
} from './report.ts';
import { hostClass } from './signals.ts';

/**
 * NAV-DIAG-1: observe a comments-list navigation and classify its failure
 * into closed, count-only fields. No URL, query, ID, handle or message text
 * leaves this module.
 */
/** The request guard marks every request it aborts. */
export const guardAbortedRequests = new WeakSet<Request>();

const netClass = (name: string) =>
  `net-err-${name.toLowerCase().replaceAll('_', '-')}` as NavMessageClass;
/** Closed message class; the message itself is read here and dropped. */
export function navMessageClass(error: unknown): NavMessageClass {
  const message = error instanceof Error ? error.message.slice(0, 4096) : '';
  if (/interrupted by another navigation/u.test(message))
    return 'interrupted-by-navigation';
  const net = /net::ERR_([A-Z0-9_]{1,64})/u.exec(message)?.[1];
  if (net)
    return NAV_NET_ERRORS.some((name) => name === net)
      ? netClass(net)
      : 'other';
  if (/Timeout \d+ms exceeded/u.test(message)) return 'timeout-exceeded';
  return 'other';
}
/** Path class relative to the run's own platform origin. */
export function navPathClass(input: string, origin: string): NavPathClass {
  if (input === 'about:blank') return 'about-blank';
  let url: URL, base: URL;
  try {
    url = new URL(input);
    base = new URL(origin);
  } catch {
    return 'unknown';
  }
  if (url.origin !== base.origin) return 'other-host';
  const path = url.pathname.replace(/\/$/u, '');
  if (path === '/your_activity/interactions/comments') return 'comments-list';
  if (path.startsWith('/accounts/login')) return 'login';
  if (path.startsWith('/challenge') || path.startsWith('/checkpoint'))
    return 'challenge';
  return 'other-instagram';
}
/**
 * Observe one `page.goto` of the comments list from its start. `failure`
 * classifies the error the goto rejected with; `dispose` removes listeners.
 */
export function observeListNavigation(page: Page, origin: string) {
  const started = performance.now();
  const target = new URL('/your_activity/interactions/comments', origin).href;
  let documentResponse = false,
    documentStatus: number | null = null,
    otherTarget: string | null = null,
    aborted: Request | null = null;
  const main = (request: Request) => {
    try {
      return (
        request.isNavigationRequest() && request.frame() === page.mainFrame()
      );
    } catch {
      return false;
    }
  };
  let live: NavigationFailure | undefined;
  const onRequest = (request: Request) => {
    if (
      main(request) &&
      request.url() !== target &&
      !request.redirectedFrom()
    ) {
      otherTarget ??= request.url();
      // The replacing navigation's request event can arrive just after the
      // aborted goto rejected; the run does not wait for it.
      if (live && live.messageClass === 'net-err-aborted') {
        live.messageClass = 'interrupted-by-navigation';
        live.targetPathClass = navPathClass(otherTarget, origin);
      }
    }
  };
  const onResponse = (response: Response) => {
    if (!main(response.request())) return;
    documentResponse = true;
    documentStatus = response.status();
  };
  const onFailed = (request: Request) => {
    if (main(request) && guardAbortedRequests.has(request)) aborted = request;
  };
  // A diagnostic never changes the run: a page without listeners only loses
  // the response, target and guard fields.
  const listen = (on: boolean) => {
    try {
      if (typeof page.on !== 'function' || typeof page.off !== 'function')
        return;
      if (on) {
        page.on('request', onRequest);
        page.on('response', onResponse);
        page.on('requestfailed', onFailed);
      } else {
        page.off('request', onRequest);
        page.off('response', onResponse);
        page.off('requestfailed', onFailed);
      }
    } catch {
      // Inert observer.
    }
  };
  listen(true);
  const remove = () => listen(false);
  return {
    /** After a failure the request listener stays 2 s for a late event. */
    dispose() {
      if (!live) {
        remove();
        return;
      }
      setTimeout(remove, LATE_EVENT_MS).unref();
    },
    failure(error: unknown): NavigationFailure {
      // Chromium reports a navigation replaced before it committed as
      // net::ERR_ABORTED; with another main-frame navigation observed during
      // this goto it is classed as interrupted.
      const raw = navMessageClass(error);
      const messageClass: NavMessageClass =
        raw === 'net-err-aborted' && otherTarget !== null
          ? 'interrupted-by-navigation'
          : raw;
      let pageUrl = 'unknown';
      try {
        pageUrl = page.url();
      } catch {
        pageUrl = 'unknown';
      }
      const guarded = aborted,
        other = otherTarget,
        status = documentStatus;
      let guardHostClass: NavigationFailure['guardHostClass'] = null;
      if (guarded)
        try {
          guardHostClass = hostClass(guarded.url());
        } catch {
          guardHostClass = 'other';
        }
      live = NavigationFailureSchema.parse({
        errorClass: errorClass(error),
        messageClass,
        elapsedMs: Math.max(0, Math.round(performance.now() - started)),
        documentResponse,
        documentStatus:
          status !== null && status >= 100 && status <= 599 ? status : null,
        pagePathClass: navPathClass(pageUrl, origin),
        targetPathClass:
          messageClass === 'interrupted-by-navigation'
            ? other
              ? navPathClass(other, origin)
              : 'unknown'
            : null,
        guardAborted: guarded !== null,
        guardHostClass,
      });
      return live;
    },
  };
}
const LATE_EVENT_MS = 2000;
