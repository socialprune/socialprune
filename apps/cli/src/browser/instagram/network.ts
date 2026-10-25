import type {
  Browser,
  BrowserContext,
  Request,
  Response,
  Page,
  CDPSession,
} from 'playwright-core';
import type { BrowserRequest } from '@socialprune/core';
import {
  ContextStop,
  RuntimeReportSchema,
  MemorySampleSchema,
  MemoryValuesSchema,
  RunMemorySchema,
} from './report.ts';
import { interruptibleWork } from './interruptible.ts';
import type {
  BodyClass,
  PostRequestStatus,
  ContextCauseStage,
  RuntimeReport,
  MemorySample,
  MemoryValues,
} from './report.ts';
import {
  LimitSignals,
  hostClass,
  pathClass,
  postPathClass,
  rateSignal,
  restrictionSignal,
} from './signals.ts';

/** Closed Performance metrics only; never inspect page state or remote objects. */
export function memoryFromMetrics(
  metrics: readonly { name: string; value: number }[],
): MemorySample {
  try {
    const value = (name: string) => {
      const matches = metrics.filter((metric) => metric.name === name);
      if (
        matches.length !== 1 ||
        !Number.isFinite(matches[0]!.value) ||
        matches[0]!.value < 0
      )
        throw new Error('Invalid memory metric');
      return matches[0]!.value;
    };
    return MemorySampleSchema.parse({
      observed: true,
      observationFailed: false,
      jsHeapUsedMB: Math.round(value('JSHeapUsedSize') / 1024 ** 2),
      jsHeapTotalMB: Math.round(value('JSHeapTotalSize') / 1024 ** 2),
      nodes: value('Nodes'),
      documents: value('Documents'),
      jsEventListeners: value('JSEventListeners'),
      frames: value('Frames'),
    });
  } catch {
    return {
      observed: false,
      observationFailed: true,
      jsHeapUsedMB: null,
      jsHeapTotalMB: null,
      nodes: null,
      documents: null,
      jsEventListeners: null,
      frames: null,
    };
  }
}

/** One persistent CDP session per owned reading page, reused and detached once. */
export function observePageMemory(page: Page) {
  let client: CDPSession | undefined,
    disposed = false,
    failed = false,
    attached = false;
  let samples = 0,
    failedSamples = 0,
    peak: MemoryValues | null = null;
  const bounded = async <T>(action: () => Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        action(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Memory observation expired')),
            1000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const detach = async (session: CDPSession) => {
    try {
      await bounded(() => session.detach());
    } catch {
      failed = true;
    }
  };
  const ready = bounded(async () => {
    const session = await page.context().newCDPSession(page);
    if (disposed) {
      await detach(session);
      return;
    }
    client = session;
    await session.send('Performance.enable');
    if (!disposed) attached = true;
  }).catch(async () => {
    failed = true;
    const session = client;
    client = undefined;
    disposed = true;
    if (session) await detach(session);
  });
  return {
    async sample(): Promise<MemorySample> {
      samples++;
      let result = memoryFromMetrics([]);
      try {
        await ready;
        if (disposed || !client || !attached)
          throw new Error('Memory observation unavailable');
        result = memoryFromMetrics(
          (await bounded(() => client!.send('Performance.getMetrics'))).metrics,
        );
      } catch {
        failed = true;
      }
      if (result.observed) {
        const values = MemoryValuesSchema.parse({
          jsHeapUsedMB: result.jsHeapUsedMB,
          jsHeapTotalMB: result.jsHeapTotalMB,
          nodes: result.nodes,
          documents: result.documents,
          jsEventListeners: result.jsEventListeners,
          frames: result.frames,
        });
        peak = peak
          ? MemoryValuesSchema.parse(
              Object.fromEntries(
                Object.entries(values).map(([key, value]) => [
                  key,
                  Math.max(value, peak![key as keyof MemoryValues]),
                ]),
              ),
            )
          : values;
      } else {
        failedSamples++;
        failed = true;
      }
      return result;
    },
    summary() {
      return RunMemorySchema.parse({
        samples,
        failedSamples,
        sessionAttached: attached,
        observationFailed: failed,
        peak,
      });
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await ready;
      const session = client;
      client = undefined;
      if (session) await detach(session);
    },
  };
}

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
    forget(page: Page) {
      const listeners = owned.get(page);
      if (!listeners) return;
      page.off('crash', listeners.crash);
      page.off('close', listeners.close);
      owned.delete(page);
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
  deletion?: import('./delete-permission.ts').InstagramDeletePermission,
  deletionMode = false,
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
  let warning: 'http-429' | 'limit-notice' | 'warning-notice' | undefined;
  let disposed = false;
  const work = interruptibleWork();
  const fail = (error: ContextStop) => {
    if (error.token === 'http-429') warning = 'http-429';
    else if (!warning && error.warningKind) warning = error.warningKind;
    if (!failure) {
      failure = error;
      work.interrupt();
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
    if (
      deletionMode &&
      !policy.platform(url.href) &&
      policy.image(url.href) &&
      request.method() === 'GET' &&
      !request.isNavigationRequest() &&
      ['image', 'media'].includes(request.resourceType())
    ) {
      if (failure) await route.abort();
      else await route.continue();
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
    if (deletionMode && !['GET', 'HEAD'].includes(request.method())) {
      const form = new URLSearchParams(request.postData() ?? '');
      const namedQuery =
        operation?.endsWith('Query') &&
        form.get('fb_api_req_friendly_name') === operation &&
        /^\d{1,40}$/.test(form.get('doc_id') ?? '') &&
        (() => {
          try {
            const variables: unknown = JSON.parse(form.get('variables') ?? '');
            return Boolean(
              variables &&
              typeof variables === 'object' &&
              !Array.isArray(variables) &&
              !JSON.stringify(variables).toLowerCase().includes('mutation'),
            );
          } catch {
            return false;
          }
        })();
      const knownRead =
        (url.pathname === '/graphql/query' ||
          url.pathname === '/graphql/query/' ||
          url.pathname === '/api/graphql') &&
        namedQuery;
      const expectedDelete =
        /^(?:\/api\/v1)?\/web\/comments\/\d{1,40}\/delete\/\d{1,40}\/$/.test(
          url.pathname,
        );
      if (!knownRead && !expectedDelete) {
        const record: BrowserRequest = {
          requestId: crypto.randomUUID(),
          method: request.method(),
          host: url.hostname,
          path: url.pathname,
          status: null,
          operation,
        };
        requests.push(record);
        try {
          await persist(record);
        } catch {
          /* persist records the closed journal failure and this request remains aborted. */
        }
        fail(new ContextStop('UNEXPECTED_ACTION', 'unexpected-action'));
        await route.abort();
        return;
      }
    }
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
    if (
      mutation(request.method(), url.href, name) ||
      /\/web\/comments\/[^/]+\/delete\//.test(url.pathname)
    ) {
      if (deletion?.admit(request)) {
        try {
          await deletion.beforeRequest();
        } catch {
          fail(new ContextStop('PLATFORM_CHECK', 'account-changed'));
          await route.abort();
          return;
        }
        await route.continue();
        return;
      }
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
    if (
      disposed ||
      (!policy.platform(response.url()) && !policy.image(response.url()))
    )
      return;
    const ownWindow = postWindows.get(response.request());
    const status = response.status();
    const headers = response.headers();
    if (deletion) {
      const inspection = deletion.response(response).catch(() => {
        fail(new ContextStop('PLATFORM_CHECK', 'post-structure'));
      });
      inspections.add(inspection);
      void inspection.finally(() => inspections.delete(inspection));
    }
    const inspectRate = (bytes: Buffer) => {
      if (disposed || bytes.length > 5 * 1024 ** 2) return;
      try {
        const body: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        );
        if (rateSignal(body)) {
          const stop = new ContextStop('PLATFORM_CHECK', 'rate-signal');
          if (restrictionSignal(body)) stop.warningKind = 'warning-notice';
          fail(stop);
        }
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
          const bytes = await work.until(
            Promise.race([
              response.body(),
              new Promise<null>((resolve) => {
                timer = setTimeout(() => resolve(null), 30000);
              }),
            ]),
          );
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
    get warning() {
      return warning;
    },
    stop: fail,
    check,
    async flush() {
      // Stopping the run does not erase the diagnostic for its failing response.
      await Promise.all([...bodyInspections]);
      check();
      await work.until(Promise.all([...inspections]));
      check();
      await work.until(Promise.all([...pending]));
      check();
    },
    dispose() {
      disposed = true;
      work.interrupt();
      for (const cancel of bodyCancels) cancel();
      bodyCancels.clear();
      postWindow = undefined;
      context.off('request', onRequest);
      context.off('response', onResponse);
    },
  };
}
