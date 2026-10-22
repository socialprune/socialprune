import type {
  Browser,
  BrowserContext,
  Request,
  Response,
  Page,
} from 'playwright-core';
import type { BrowserRequest } from '@socialprune/core';
import { ContextStop, RuntimeReportSchema } from './report.ts';
import type {
  BodyClass,
  PostRequestStatus,
  ContextCauseStage,
  RuntimeReport,
} from './report.ts';
import {
  LimitSignals,
  hostClass,
  pathClass,
  postPathClass,
  rateSignal,
} from './signals.ts';

/** Passive observation of the run's explicitly owned pages, never a new guard. */
export function observeContextRuntime(
  context: BrowserContext,
  position: () => { step: number; stage: ContextCauseStage },
) {
  let browser: Browser | null = null;
  const counts = {
    pageCrashes: 0,
    browserDisconnects: 0,
    unexpectedPageCloses: 0,
    browserObserved: false,
    observationFailed: false,
  };
  const events = new Map<string, RuntimeReport['events'][number]>();
  const owned = new Map<Page, { crash: () => void; close: () => void }>();
  let closing = false,
    disposed = false,
    version = 0;
  const observationFailed = () => {
    if (!counts.observationFailed) {
      counts.observationFailed = true;
      version++;
    }
  };
  const record = (event: RuntimeReport['events'][number]['event']) => {
    if (disposed || (closing && event !== 'page-crash')) return;
    const { step, stage } = position();
    const key = `${event}|${step}|${stage}`;
    const group = events.get(key) ?? { event, step, stage, count: 0 };
    group.count++;
    events.set(key, group);
    version++;
    if (event === 'page-crash') counts.pageCrashes++;
    else if (event === 'page-close') counts.unexpectedPageCloses++;
    else counts.browserDisconnects++;
  };
  const disconnected = () => record('browser-disconnected');
  try {
    browser = context.browser();
    if (browser) {
      browser.on('disconnected', disconnected);
      counts.browserObserved = true;
    }
  } catch {
    observationFailed();
  }
  return {
    get version() {
      return version;
    },
    own(page: Page) {
      if (disposed || owned.has(page)) return;
      const listeners = {
        crash: () => record('page-crash'),
        close: () => record('page-close'),
      };
      owned.set(page, listeners);
      try {
        page.on('crash', listeners.crash);
        page.on('close', listeners.close);
      } catch {
        observationFailed();
      }
    },
    closing() {
      closing = true;
    },
    summary(): RuntimeReport {
      return RuntimeReportSchema.parse({
        ...counts,
        events: [...events.values()],
      });
    },
    dispose() {
      disposed = true;
      try {
        browser?.off('disconnected', disconnected);
      } catch {
        observationFailed();
      }
      for (const [page, listeners] of owned) {
        try {
          page.off('crash', listeners.crash);
          page.off('close', listeners.close);
        } catch {
          observationFailed();
        }
      }
      owned.clear();
    },
  };
}

function bodyClass(bytes: Buffer): BodyClass {
  // The bare-not-found exception requires whole-body equality after trimming;
  // every other format check uses only the bounded prefix below.
  if (bytes.toString('utf8').trim() === 'Not Found') return 'bare-not-found';
  const prefix = bytes.subarray(0, 512).toString('utf8').trim();
  const complete = bytes.length <= 512;
  // A prefix alone cannot prove the whole body is empty.
  if (complete && !prefix) return 'empty';
  if (!prefix) return 'other';
  try {
    JSON.parse(prefix);
    return 'json';
  } catch {
    /* Try the bounded shape. */
  }
  if (!complete && /^[\[{]/.test(prefix)) return 'json';
  if (/^<(?:!doctype\s+html\b|[a-z][a-z0-9:-]*(?:\s|>|\/))/i.test(prefix))
    return 'html';
  return 'other';
}

export const INSTAGRAM_ORIGIN = 'https://www.instagram.com';
export const COMMENTS_PATH = '/your_activity/interactions/comments';
export function allowedInstagramHost(host: string): boolean {
  const value = host.toLowerCase();
  return (
    value === 'instagram.com' ||
    ['.instagram.com', '.cdninstagram.com', '.fbcdn.net'].some((suffix) =>
      value.endsWith(suffix),
    )
  );
}
export function allowedInstagramURL(input: string): boolean {
  try {
    const url = new URL(input);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      allowedInstagramHost(url.hostname)
    );
  } catch {
    return false;
  }
}
export function imageHost(input: string): boolean {
  try {
    const url = new URL(input);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ['.cdninstagram.com', '.fbcdn.net'].some((suffix) =>
        url.hostname.endsWith(suffix),
      )
    );
  } catch {
    return false;
  }
}
export function mutation(
  method: string,
  input: string,
  operation?: string | null,
): boolean {
  if (operation?.endsWith('Mutation')) return true;
  const path = new URL(input).pathname;
  return (
    method !== 'GET' &&
    path.startsWith('/api/v1/') &&
    path
      .split('/')
      .some((segment) =>
        [
          'like',
          'unlike',
          'follow',
          'unfollow',
          'delete',
          'add',
          'create',
          'save',
          'unsave',
          'block',
          'mute',
          'report',
        ].includes(segment),
      )
  );
}
export interface NetworkPolicy {
  platform(input: string): boolean;
  image(input: string): boolean;
}
export const productionPolicy: NetworkPolicy = {
  platform: allowedInstagramURL,
  image: imageHost,
};
export async function guardInstagramNetwork(
  context: BrowserContext,
  confirmationOrigin: string,
  record: (value: BrowserRequest) => Promise<void>,
  policy: NetworkPolicy = productionPolicy,
  limitSignals = new LimitSignals(),
  onStop: (error: ContextStop) => void = () => {},
  pageAllowed: (page: Page) => Promise<boolean> = () => Promise.resolve(true),
) {
  const abortedHosts: Record<string, number> = {};
  const requests: BrowserRequest[] = [];
  const pending = new Set<Promise<void>>();
  const ids = new WeakMap<Request, BrowserRequest>();
  type PostWindow = {
    page: Page;
    groups: Map<string, PostRequestStatus>;
    classified: number;
  };
  let postWindow: PostWindow | undefined;
  const postWindows = new WeakMap<Request, PostWindow>();
  const onRequest = (request: Request) => {
    if (!postWindow || disposed || !policy.platform(request.url())) return;
    try {
      if (request.frame().page() === postWindow.page)
        postWindows.set(request, postWindow);
    } catch {
      // Requests without an owned page cannot supply a post-step response.
    }
  };
  let failure: ContextStop | undefined;
  let disposed = false;
  let signalFailure!: () => void;
  const failed = new Promise<void>((resolve) => {
    signalFailure = resolve;
  });
  const fail = (error: ContextStop) => {
    if (!failure) {
      failure = error;
      signalFailure();
      onStop(error);
    }
  };
  const inspections = new Set<Promise<void>>();
  const bodyInspections = new Set<Promise<void>>();
  const bodyCancels = new Set<() => void>();
  const persist = (value: BrowserRequest) => {
    const task = record(value);
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => {
        pending.delete(task);
        fail(new ContextStop('CONTEXT_FAILED', 'request-journal'));
      },
    );
    return task;
  };
  const abortHost = (url: URL) => {
    abortedHosts[url.host] = (abortedHosts[url.host] ?? 0) + 1;
  };
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    let page: Page;
    try {
      page = request.frame().page();
    } catch {
      fail(new ContextStop('PLATFORM_CHECK', 'unexpected-page'));
      await route.abort();
      return;
    }
    if (!(await pageAllowed(page))) {
      await route.abort();
      return;
    }
    if (url.origin === confirmationOrigin) {
      await route.continue();
      return;
    }
    if (!policy.platform(url.href)) {
      abortHost(url);
      await route.abort();
      return;
    }
    if (failure) {
      await route.abort();
      return;
    }
    const name = request.headers()['x-fb-friendly-name'];
    const operation = name && /^[A-Za-z0-9_]{1,256}$/.test(name) ? name : null;
    if (request.method() !== 'GET') {
      const value: BrowserRequest = {
        requestId: crypto.randomUUID(),
        method: request.method(),
        host: url.hostname,
        path: url.pathname,
        status: null,
        operation,
      };
      requests.push(value);
      ids.set(request, value);
      try {
        await persist(value);
      } catch {
        await route.abort();
        return;
      }
    }
    if (mutation(request.method(), url.href, name)) {
      fail(new ContextStop('UNEXPECTED_ACTION', 'unexpected-action'));
      await route.abort();
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket('**/*', async (socket) => {
    abortHost(new URL(socket.url()));
    await socket.close();
  });
  const onResponse = (response: Response) => {
    if (disposed || !policy.platform(response.url())) return;
    const ownWindow = postWindows.get(response.request());
    const status = response.status();
    const headers = response.headers();
    const inspectRate = (bytes: Buffer) => {
      if (disposed || bytes.length > 5 * 1024 ** 2) return;
      try {
        if (
          rateSignal(
            JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
          )
        )
          fail(new ContextStop('PLATFORM_CHECK', 'rate-signal'));
      } catch {
        /* Invalid or absent JSON is not an enumerated limit signal. */
      }
    };
    const isJson =
      headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() ===
      'application/json';
    if (ownWindow) {
      const path = postPathClass(
        response.url(),
        policy.image(response.url()) ||
          ['image', 'media'].includes(response.request().resourceType()),
      );
      const key = `${path}|${status}`;
      const group = ownWindow.groups.get(key) ?? { path, status, count: 0 };
      group.count++;
      ownWindow.groups.set(key, group);
      if (status >= 400 && status <= 499) {
        const addBody = (value: BodyClass) => {
          const counts = (group.bodyClasses ??= []);
          const prior = counts.find((body) => body.class === value);
          if (prior) prior.count++;
          else counts.push({ class: value, count: 1 });
          counts.sort((a, b) => a.class.localeCompare(b.class));
        };
        if (ownWindow.classified >= 20) addBody('not-classified');
        else {
          // Reserve the slot synchronously so concurrent responses share the cap.
          ownWindow.classified++;
          if (Number(headers['content-length']) > 1048576) addBody('large');
          else {
            const inspection = (async () => {
              let timer: ReturnType<typeof setTimeout> | undefined;
              let cancel: (() => void) | undefined;
              try {
                const bytes = await Promise.race([
                  response.body(),
                  new Promise<null>((resolve) => {
                    timer = setTimeout(() => resolve(null), 30000);
                  }),
                  new Promise<null>((resolve) => {
                    cancel = () => resolve(null);
                    bodyCancels.add(cancel);
                  }),
                ]);
                addBody(bytes === null ? 'unreadable' : bodyClass(bytes));
                // Share this one read with the existing limit-signal observer.
                if (bytes && isJson) inspectRate(bytes);
              } catch {
                addBody('unreadable');
              } finally {
                if (timer) clearTimeout(timer);
                if (cancel) bodyCancels.delete(cancel);
              }
            })();
            bodyInspections.add(inspection);
            void inspection.then(() => bodyInspections.delete(inspection));
          }
        }
      }
    }
    limitSignals.response(
      hostClass(response.url()),
      pathClass(
        response.url(),
        policy.image(response.url()) ||
          response.request().resourceType() === 'image' ||
          response.request().resourceType() === 'media',
      ),
      response.status(),
      headers,
    );
    if (response.status() === 429)
      fail(new ContextStop('PLATFORM_CHECK', 'http-429'));
    if (
      !(ownWindow && status >= 400 && status <= 499) &&
      isJson &&
      Number(headers['content-length'] ?? 0) <= 5 * 1024 ** 2
    ) {
      const inspection = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const bytes = await Promise.race([
            response.body(),
            new Promise<null>((resolve) => {
              timer = setTimeout(() => resolve(null), 30000);
            }),
            failed.then(() => null),
          ]);
          if (bytes) inspectRate(bytes);
        } catch {
          /* Invalid or absent JSON is not an enumerated limit signal. */
        } finally {
          if (timer) clearTimeout(timer);
        }
      })();
      inspections.add(inspection);
      void inspection.finally(() => inspections.delete(inspection));
    }
    const prior = ids.get(response.request());
    if (prior) {
      prior.status = response.status();
      void persist({ ...prior }).catch(() => undefined);
    }
  };
  context.on('request', onRequest);
  context.on('response', onResponse);
  const check = () => {
    if (failure) throw failure;
  };
  return {
    beginPostRequests(page: Page) {
      const window: PostWindow = { page, groups: new Map(), classified: 0 };
      postWindow = window;
      return {
        summary: () =>
          [...window.groups.values()]
            .sort((a, b) => a.path.localeCompare(b.path) || a.status - b.status)
            .map((group) => ({
              ...group,
              ...(group.bodyClasses
                ? {
                    bodyClasses: group.bodyClasses.map((body) => ({ ...body })),
                  }
                : {}),
            })),
        close: () => {
          if (postWindow === window) postWindow = undefined;
        },
      };
    },
    abortedHosts,
    requests,
    stop: fail,
    check,
    async flush() {
      // Stopping the run does not erase the diagnostic for its failing response.
      await Promise.all([...bodyInspections]);
      check();
      await Promise.race([Promise.all([...inspections]), failed]);
      check();
      await Promise.race([Promise.all([...pending]), failed]);
      check();
    },
    dispose() {
      disposed = true;
      for (const cancel of bodyCancels) cancel();
      bodyCancels.clear();
      postWindow = undefined;
      context.off('request', onRequest);
      context.off('response', onResponse);
    },
  };
}
