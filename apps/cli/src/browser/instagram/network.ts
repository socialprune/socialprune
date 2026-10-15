import type { BrowserContext, Request, Response } from 'playwright-core';
import type { BrowserRequest } from '@socialprune/core';
import { ContextStop } from './report.ts';

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
) {
  const abortedHosts: Record<string, number> = {};
  const requests: BrowserRequest[] = [];
  const pending = new Set<Promise<void>>();
  const ids = new WeakMap<Request, BrowserRequest>();
  let failure: ContextStop | undefined;
  const persist = (value: BrowserRequest) => {
    const task = record(value);
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => {
        pending.delete(task);
        failure ??= new ContextStop('CONTEXT_FAILED', 'request-journal');
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
    if (url.origin === confirmationOrigin) {
      await route.continue();
      return;
    }
    if (!policy.platform(url.href)) {
      abortHost(url);
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
      failure ??= new ContextStop('UNEXPECTED_ACTION', 'unexpected-action');
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
    if (response.status() === 429 && policy.platform(response.url()))
      failure ??= new ContextStop('PLATFORM_CHECK', 'http-429');
    const prior = ids.get(response.request());
    if (prior) {
      prior.status = response.status();
      void persist({ ...prior }).catch(() => undefined);
    }
  };
  context.on('response', onResponse);
  return {
    abortedHosts,
    requests,
    check() {
      if (failure) throw failure;
    },
    async flush() {
      await Promise.all([...pending]);
      if (failure) throw failure;
    },
    dispose() {
      context.off('response', onResponse);
    },
  };
}
