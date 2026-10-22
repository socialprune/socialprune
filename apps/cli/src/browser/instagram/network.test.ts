import { expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { BrowserContext, Page, Request } from 'playwright-core';
import {
  allowedInstagramURL,
  allowedInstagramHost,
  mutation,
  imageHost,
  INSTAGRAM_ORIGIN,
  COMMENTS_PATH,
  guardInstagramNetwork,
  observeContextRuntime,
} from './network.ts';
import {
  keyPaths,
  stopDetails,
  ContextStop,
  ContextStepReportSchema,
} from './report.ts';
import {
  IG_FIXTURE,
  POST_NOTICE_FIXTURE,
} from '../../../e2e/fake-instagram/fixture.ts';
test('C21 runtime observation counts only owned page events and unexpected disconnects at their actual step and stage', () => {
  const browser = new EventEmitter(),
    context = { browser: () => browser } as unknown as BrowserContext;
  let step = 4;
  const runtime = observeContextRuntime(context, () => ({
    step,
    stage: 'post-read',
  }));
  const own = new EventEmitter(),
    foreign = new EventEmitter();
  runtime.own(own as unknown as Page);
  runtime.own(own as unknown as Page);
  own.emit('crash');
  foreign.emit('crash');
  own.emit('close');
  browser.emit('disconnected');
  expect(runtime.summary()).toEqual({
    pageCrashes: 1,
    unexpectedPageCloses: 1,
    browserDisconnects: 1,
    browserObserved: true,
    observationFailed: false,
    events: [
      { event: 'page-crash', step: 4, stage: 'post-read', count: 1 },
      { event: 'page-close', step: 4, stage: 'post-read', count: 1 },
      { event: 'browser-disconnected', step: 4, stage: 'post-read', count: 1 },
    ],
  });
  step = 5;
  runtime.closing();
  own.emit('close');
  browser.emit('disconnected');
  expect(runtime.summary().unexpectedPageCloses).toBe(1);
  expect(runtime.summary().browserDisconnects).toBe(1);
  runtime.dispose();
  own.emit('crash');
  expect(runtime.summary().pageCrashes).toBe(1);
  expect(
    own.listenerCount('crash') +
      own.listenerCount('close') +
      browser.listenerCount('disconnected'),
  ).toBe(0);
});
test('C21 runtime observation handles a persistent context without an exposed browser and keeps stage groups separate', () => {
  let step = 1;
  const context = { browser: () => null } as unknown as BrowserContext;
  const runtime = observeContextRuntime(context, () => ({
    step,
    stage: step === 1 ? 'post-read' : 'browser-close',
  }));
  const page = new EventEmitter();
  runtime.own(page as unknown as Page);
  page.emit('crash');
  page.emit('crash');
  step = 2;
  page.emit('crash');
  expect(runtime.summary()).toEqual({
    pageCrashes: 3,
    browserDisconnects: 0,
    unexpectedPageCloses: 0,
    browserObserved: false,
    observationFailed: false,
    events: [
      { event: 'page-crash', step: 1, stage: 'post-read', count: 2 },
      { event: 'page-crash', step: 2, stage: 'browser-close', count: 1 },
    ],
  });
  runtime.dispose();
});
test('C21 a failed diagnostic attachment records its closed failure instead of blocking run cleanup', () => {
  const runtime = observeContextRuntime({} as BrowserContext, () => ({
    step: 0,
    stage: 'browser-setup',
  }));
  runtime.own({} as Page);
  expect(runtime.summary()).toMatchObject({
    observationFailed: true,
    browserObserved: false,
  });
  expect(() => runtime.dispose()).not.toThrow();
});

async function responseHarness() {
  const context = Object.assign(new EventEmitter(), {
    route: () => Promise.resolve(),
    routeWebSocket: () => Promise.resolve(),
  });
  const page = {} as Page;
  const network = await guardInstagramNetwork(
    context as unknown as BrowserContext,
    'http://127.0.0.1:4582',
    () => Promise.resolve(),
  );
  const send = (
    options: {
      path?: string;
      status?: number;
      headers?: Record<string, string>;
      body?: () => Promise<Buffer>;
      owner?: Page;
      start?: boolean;
      defer?: boolean;
    } = {},
  ) => {
    const request = {
      url: () =>
        `https://www.instagram.com${options.path ?? POST_NOTICE_FIXTURE.cases[0].path}?${IG_FIXTURE.other.code}`,
      frame: () => ({ page: () => options.owner ?? page }),
      resourceType: () => 'fetch',
    } as unknown as Request;
    if (options.start !== false) context.emit('request', request);
    const body = vi.fn(
      options.body ??
        (() => Promise.resolve(Buffer.from(POST_NOTICE_FIXTURE.cases[0].body))),
    );
    const respond = () =>
      context.emit('response', {
        request: () => request,
        url: () => request.url(),
        status: () => options.status ?? 404,
        headers: () => options.headers ?? { 'content-type': 'text/plain' },
        body,
      });
    if (!options.defer) respond();
    return Object.assign(body, { respond });
  };
  return { page, network, send };
}
test.each(POST_NOTICE_FIXTURE.cases.filter((entry) => !('responses' in entry)))(
  'C19 $variant has one closed 4xx body class without bytes or IDs',
  async (entry) => {
    const h = await responseHarness(),
      window = h.network.beginPostRequests(h.page);
    const body = h.send({
      path: entry.path,
      headers: {
        'content-type': entry.type,
        ...('padding' in entry
          ? { 'content-length': String(entry.padding) }
          : {}),
      },
      body: () =>
        'encoding' in entry
          ? Promise.reject(new Error(IG_FIXTURE.other.text))
          : Promise.resolve(Buffer.from(entry.body)),
    });
    try {
      await h.network.flush();
      expect(window.summary()).toEqual([
        {
          path: entry.pathClass,
          status: 404,
          count: 1,
          bodyClasses: [{ class: entry.bodyClass, count: 1 }],
        },
      ]);
      expect(body).toHaveBeenCalledTimes(entry.bodyClass === 'large' ? 0 : 1);
      const report = JSON.stringify(
        ContextStepReportSchema.parse({ postRequests: window.summary() }),
      );
      for (const value of [
        POST_NOTICE_FIXTURE.mediaId,
        ...Object.values(IG_FIXTURE.other),
      ])
        expect(report).not.toContain(value);
    } finally {
      h.network.dispose();
    }
  },
);
test('C19 the per-step cap reserves 20 reads before awaiting bodies and resets in the next step', async () => {
  const h = await responseHarness(),
    first = h.network.beginPostRequests(h.page);
  const bodies = Array.from(
    { length: POST_NOTICE_FIXTURE.perStepBodies + 2 },
    () =>
      h.send({
        headers: { 'content-type': 'application/json' },
        body: () => Promise.resolve(Buffer.from('{}')),
      }),
  );
  try {
    await h.network.flush();
    expect(bodies.map((body) => body.mock.calls.length)).toEqual([
      ...Array<number>(20).fill(1),
      0,
      0,
    ]);
    expect(first.summary()).toEqual([
      {
        path: 'api-v1-media-comments',
        status: 404,
        count: 22,
        bodyClasses: [
          { class: 'json', count: 20 },
          { class: 'not-classified', count: 2 },
        ],
      },
    ]);
    first.close();
    const next = h.network.beginPostRequests(h.page),
      body = h.send();
    await h.network.flush();
    expect(body).toHaveBeenCalledTimes(1);
    expect(next.summary()[0]).toMatchObject({
      count: 1,
      bodyClasses: [{ class: 'bare-not-found', count: 1 }],
    });
  } finally {
    h.network.dispose();
  }
});
test('C19 large JSON 4xx bodies are never read by either diagnostics or the rate-signal reader', async () => {
  const h = await responseHarness(),
    window = h.network.beginPostRequests(h.page);
  const body = h.send({
    headers: {
      'content-type': 'application/json',
      'content-length': String(POST_NOTICE_FIXTURE.maximumDeclaredBytes + 1),
    },
  });
  try {
    await h.network.flush();
    expect(body).not.toHaveBeenCalled();
    expect(window.summary()[0]).toMatchObject({
      bodyClasses: [{ class: 'large', count: 1 }],
    });
  } finally {
    h.network.dispose();
  }
});
test('C19 a late response consumes the original step cap and never the next step budget', async () => {
  const h = await responseHarness(),
    first = h.network.beginPostRequests(h.page);
  const late = h.send({ defer: true });
  for (let index = 0; index < POST_NOTICE_FIXTURE.perStepBodies; index++)
    h.send();
  first.close();
  const next = h.network.beginPostRequests(h.page);
  late.respond();
  const current = h.send();
  try {
    await h.network.flush();
    expect(late).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);
    expect(first.summary()[0]).toMatchObject({
      count: 21,
      bodyClasses: [
        { class: 'bare-not-found', count: 20 },
        { class: 'not-classified', count: 1 },
      ],
    });
    expect(next.summary()[0]).toMatchObject({
      count: 1,
      bodyClasses: [{ class: 'bare-not-found', count: 1 }],
    });
  } finally {
    h.network.dispose();
  }
});
test('C19 a shared 403 JSON read preserves the existing rate signal without a second body call', async () => {
  const h = await responseHarness(),
    window = h.network.beginPostRequests(h.page);
  const body = h.send({
    status: 403,
    headers: { 'content-type': 'application/json' },
    body: () => Promise.resolve(Buffer.from('{"message":"feedback_required"}')),
  });
  try {
    await expect(h.network.flush()).rejects.toMatchObject({
      code: 'PLATFORM_CHECK',
      token: 'rate-signal',
    });
    expect(body).toHaveBeenCalledTimes(1);
    expect(window.summary()[0]).toMatchObject({
      status: 403,
      bodyClasses: [{ class: 'json', count: 1 }],
    });
  } finally {
    h.network.dispose();
  }
});
test('C19 body reading inspects only the first 512 bytes and never mistakes a prefix for a whole bare notice', async () => {
  const h = await responseHarness(),
    window = h.network.beginPostRequests(h.page);
  const body = h.send({
    body: () =>
      Promise.resolve(
        Buffer.from(
          'Not Found'.padEnd(POST_NOTICE_FIXTURE.prefixBytes) +
            IG_FIXTURE.other.text,
        ),
      ),
  });
  const beyond = h.send({
    path: '/graphql/query',
    body: () =>
      Promise.resolve(
        Buffer.from(' '.repeat(POST_NOTICE_FIXTURE.prefixBytes) + '{}'),
      ),
  });
  try {
    await h.network.flush();
    expect(body).toHaveBeenCalledTimes(1);
    expect(beyond).toHaveBeenCalledTimes(1);
    expect(
      window
        .summary()
        .every((group) => group.bodyClasses?.[0]?.class === 'other'),
    ).toBe(true);
    expect(JSON.stringify(window.summary())).not.toContain(
      IG_FIXTURE.other.text,
    );
  } finally {
    h.network.dispose();
  }
});
test('C19 content length at the exact bound missing or malformed still permits one body read', async () => {
  for (const declared of [
    String(POST_NOTICE_FIXTURE.maximumDeclaredBytes),
    undefined,
    'invalid',
  ]) {
    const h = await responseHarness(),
      window = h.network.beginPostRequests(h.page);
    const body = h.send({
      headers: {
        'content-type': 'text/plain',
        ...(declared === undefined ? {} : { 'content-length': declared }),
      },
    });
    try {
      await h.network.flush();
      expect(body).toHaveBeenCalledTimes(1);
      expect(window.summary()[0]).toMatchObject({
        bodyClasses: [{ class: 'bare-not-found', count: 1 }],
      });
    } finally {
      h.network.dispose();
    }
  }
});
test('C19 the exact whole-body bare notice remains bare after trimming beyond the format prefix', async () => {
  const h = await responseHarness(),
    window = h.network.beginPostRequests(h.page);
  h.send({
    body: () =>
      Promise.resolve(
        Buffer.from(
          ' '.repeat(POST_NOTICE_FIXTURE.prefixBytes + 1) + 'Not Found\r\n\t',
        ),
      ),
  });
  try {
    await h.network.flush();
    expect(window.summary()[0]).toMatchObject({
      bodyClasses: [{ class: 'bare-not-found', count: 1 }],
    });
  } finally {
    h.network.dispose();
  }
});
test('C19 body classes distinguish bounded JSON HTML empty and other without reading a suffix', async () => {
  for (const [text, expected] of [
    ['{}', 'json'],
    ['[1]', 'json'],
    ['null', 'json'],
    ['{"data":"' + 'x'.repeat(600), 'json'],
    ['<!doctype html><html></html>', 'html'],
    ['<HTML></HTML>', 'html'],
    ['<p>generated</p>', 'html'],
    [' \r\n\t', 'empty'],
    ['not found', 'other'],
    ['Not Found\n' + IG_FIXTURE.other.text, 'other'],
    ['{invalid', 'other'],
  ]) {
    const h = await responseHarness(),
      window = h.network.beginPostRequests(h.page);
    h.send({ body: () => Promise.resolve(Buffer.from(text!)) });
    try {
      await h.network.flush();
      expect(window.summary()[0]).toMatchObject({
        bodyClasses: [{ class: expected, count: 1 }],
      });
    } finally {
      h.network.dispose();
    }
  }
});
test('C19 an unreadable timeout is counted without delaying the original stop token beyond the read deadline', async () => {
  vi.useFakeTimers();
  const h = await responseHarness(),
    window = h.network.beginPostRequests(h.page);
  const body = h.send({ body: () => new Promise<Buffer>(() => {}) });
  try {
    h.network.stop(new ContextStop('PLATFORM_CHECK', 'notice-error'));
    const flushed = h.network.flush().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30001);
    expect(await flushed).toMatchObject({ token: 'notice-error' });
    expect(body).toHaveBeenCalledTimes(1);
    expect(window.summary()[0]).toMatchObject({
      bodyClasses: [{ class: 'unreadable', count: 1 }],
    });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    h.network.dispose();
    vi.useRealTimers();
  }
});
test('C19 only owned step 4xx bodies are inspected and diagnostic classes do not trigger a stop', async () => {
  const h = await responseHarness();
  const before = h.send({ headers: { 'content-type': 'text/plain' } });
  const window = h.network.beginPostRequests(h.page);
  const foreign = h.send({ owner: {} as Page }),
    unstarted = h.send({ start: false });
  const success = h.send({ status: 200 }),
    serverError = h.send({ status: 503 });
  const own = h.send();
  try {
    await h.network.flush();
    h.network.check();
    for (const body of [before, foreign, unstarted, success, serverError])
      expect(body).not.toHaveBeenCalled();
    expect(own).toHaveBeenCalledTimes(1);
    expect(window.summary()).toHaveLength(3);
  } finally {
    h.network.dispose();
  }
});
test('C19 the report rejects body bytes IDs header values and open body classes', () => {
  const group = {
    path: 'api-v1-media-comments',
    status: 404,
    count: 1,
    bodyClasses: [{ class: 'json', count: 1 }],
  };
  expect(
    ContextStepReportSchema.parse({ postRequests: [group] }),
  ).toMatchObject({ postRequests: [group] });
  for (const invalid of [
    { ...group, body: IG_FIXTURE.other.text },
    { ...group, length: 15 },
    { ...group, headers: { 'content-length': '15' } },
    { ...group, bodyClasses: [{ class: IG_FIXTURE.other.text, count: 1 }] },
    { ...group, bodyClasses: [{ class: 'json', count: 0 }] },
  ])
    expect(() =>
      ContextStepReportSchema.parse({ postRequests: [invalid] }),
    ).toThrow();
});

test('C17 post request statuses belong to the request-start window and keep no private values', async () => {
  const context = Object.assign(new EventEmitter(), {
    route: () => Promise.resolve(),
    routeWebSocket: () => Promise.resolve(),
  });
  const page = {} as Page,
    otherPage = {} as Page;
  const network = await guardInstagramNetwork(
    context as unknown as BrowserContext,
    'http://127.0.0.1:4582',
    () => Promise.resolve(),
  );
  const begin = (page: Page) => network.beginPostRequests(page);
  const request = (path: string, owner = page) =>
    ({
      url: () => `https://www.instagram.com/${path}?${IG_FIXTURE.other.text}`,
      frame: () => ({ page: () => owner }),
      resourceType: () => 'fetch',
    }) as unknown as Request;
  const response = (request: Request, status: number) =>
    context.emit('response', {
      url: () => request.url(),
      request: () => request,
      status: () => status,
      headers: () => ({ 'content-type': 'text/plain' }),
      body: () => Promise.resolve(Buffer.from('Not Found')),
    });
  const before = request('api/v1/earlier/');
  context.emit('request', before);
  const first = begin(page),
    late = request('api/v1/generated/');
  context.emit('request', late);
  const different = request('api/v1/other/', otherPage);
  context.emit('request', different);
  response(different, 503);
  response(before, 404);
  first.close();
  const next = begin(page);
  response(late, 404);
  const second = request('graphql/query');
  context.emit('request', second);
  response(second, 503);
  await network.flush();
  expect(first.summary()).toEqual([
    {
      path: 'api-v1-other',
      status: 404,
      count: 1,
      bodyClasses: [{ class: 'bare-not-found', count: 1 }],
    },
  ]);
  expect(next.summary()).toEqual([{ path: 'graphql', status: 503, count: 1 }]);
  for (const value of Object.values(IG_FIXTURE.other))
    expect(JSON.stringify(first.summary())).not.toContain(value);
  next.close();
  network.dispose();
  expect(context.listenerCount('request')).toBe(0);
});
test('C17 post request report gate allows only closed path classes status codes and counts', () => {
  const postRequests = [
    {
      path: 'api-v1-other',
      status: 404,
      count: 1,
      bodyClasses: [{ class: 'json', count: 1 }],
    },
  ];
  expect(ContextStepReportSchema.parse({ postRequests })).toMatchObject({
    postRequests,
  });
  for (const value of [
    [{ path: IG_FIXTURE.other.code, status: 404, count: 1 }],
    [{ path: 'api-v1-other', status: 99, count: 1 }],
    [{ path: 'api-v1-other', status: 600, count: 1 }],
    [{ path: 'api-v1-other', status: 404, count: -1 }],
    [
      {
        path: 'api-v1-other',
        status: 404,
        count: 1,
        url: IG_FIXTURE.other.text,
      },
    ],
  ])
    expect(() =>
      ContextStepReportSchema.parse({ postRequests: value }),
    ).toThrow();
});

test('parsed host and protocol rules admit only Instagram and its media suffixes', () => {
  expect(INSTAGRAM_ORIGIN + COMMENTS_PATH).toBe(
    'https://www.instagram.com/your_activity/interactions/comments',
  );
  for (const url of [
    'https://instagram.com/',
    'https://www.instagram.com/p/x/',
    'https://a.b.instagram.com/',
    'https://a.cdninstagram.com/',
    'https://a.fbcdn.net/',
  ])
    expect(allowedInstagramURL(url), url).toBe(true);
  for (const url of [
    'http://www.instagram.com/',
    'https://instagram.com.foreign.invalid/',
    'https://evilinstagram.com/',
    'https://cdninstagram.com/',
    'https://fbcdn.net/',
    'https://instagram.com@foreign.invalid/',
    'https://foreign.invalid/instagram.com',
    'https://instagram.com:444/',
    'https://x.com/',
  ])
    expect(allowedInstagramURL(url), url).toBe(false);
  expect(allowedInstagramHost('INSTAGRAM.COM')).toBe(true);
  expect(imageHost('https://a.cdninstagram.com/image')).toBe(true);
  expect(imageHost('https://www.instagram.com/image')).toBe(false);
});
test('a Mutation without a click and every named API write segment fail closed', () => {
  expect(
    mutation('POST', INSTAGRAM_ORIGIN + '/graphql/query', 'CommentsQuery'),
  ).toBe(false);
  expect(
    mutation('GET', INSTAGRAM_ORIGIN + '/graphql/query', 'BackgroundMutation'),
  ).toBe(true);
  for (const segment of [
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
  ]) {
    expect(
      mutation('POST', INSTAGRAM_ORIGIN + '/api/v1/media/' + segment + '/'),
    ).toBe(true);
    expect(
      mutation('GET', INSTAGRAM_ORIGIN + '/api/v1/media/' + segment + '/'),
    ).toBe(false);
  }
  expect(mutation('POST', INSTAGRAM_ORIGIN + '/api/v1/media/liked_by/')).toBe(
    false,
  );
});
test('reports strip dynamic key values and errors to closed classes, never arbitrary messages', () => {
  const planted = {
    [IG_FIXTURE.other.username]: {
      [IG_FIXTURE.other.code]: IG_FIXTURE.other.text,
    },
    data: [{ taken_at: IG_FIXTURE.other.time }],
  };
  const report = JSON.stringify({
    paths: keyPaths(planted),
    stop: stopDetails(new Error(IG_FIXTURE.other.text)),
  });
  for (const value of Object.values(IG_FIXTURE.other))
    expect(report).not.toContain(value);
  expect(stopDetails(new ContextStop('PLATFORM_CHECK', 'challenge'))).toEqual({
    code: 'PLATFORM_CHECK',
    token: 'challenge',
  });
  expect(stopDetails({ code: 'EACCES', path: IG_FIXTURE.other.text })).toEqual({
    code: 'fs-EACCES',
    token: 'fs-EACCES',
  });
});
