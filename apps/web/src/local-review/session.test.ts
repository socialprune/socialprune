import { expect, test, vi } from 'vitest';
import { ReviewSession, takeBootstrap } from './session.ts';

const token = 'A'.repeat(42) + '_';
function setup(hash = `#bootstrap=${token}`, isTopLevel = true) {
  const location = {
    hash,
    pathname: '/',
    search: '?lang=en',
    origin: 'http://127.0.0.1:54321',
  };
  const order: string[] = [];
  const history = {
    replaceState: vi.fn(
      (_data: unknown, _title: string, path?: string | URL | null) => {
        order.push('removed');
        location.hash = '';
        expect(path).toBe('/?lang=en');
      },
    ),
  };
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as const,
  });
  const fetcher = vi.fn<typeof fetch>(() => {
    order.push('session');
    return Promise.resolve(new Response('', { status: 401 }));
  });
  const session = new ReviewSession({
    isTopLevel,
    location,
    history,
    document: doc,
    fetch: fetcher,
  });
  return { session, location, history, doc, fetcher, order };
}

test('valid bootstrap is read and removed synchronously before the router can read location', async () => {
  const input = setup();
  const started = input.session.start();
  input.order.push(`router:${input.location.hash}`);
  expect(input.order).toEqual(['removed', 'session', 'router:']);
  await started;
  expect(input.session.state).toBe('ended');
  expect(input.fetcher).toHaveBeenCalledWith(
    '/session',
    expect.objectContaining({
      method: 'POST',
      body: '{}',
      headers: {
        Origin: input.location.origin,
        'Content-Type': 'application/json',
        'X-SocialPrune-Bootstrap': token,
      },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    }),
  );
});

test.each([
  '',
  '#/',
  '#/review',
  '#bootstrap=',
  `#bootstrap=${'a'.repeat(42)}`,
  `#bootstrap=${'a'.repeat(44)}`,
  `#bootstrap=${'a'.repeat(42)}=`,
  `#bootstrap=${token}&extra=x`,
  `#bootstrap=${token}\n`,
])(
  'missing or invalid fragment %j sends no session or workspace request',
  async (hash) => {
    const input = setup(hash);
    await input.session.start();
    expect(input.session.state).toBe('ended');
    expect(input.session.port).toBeNull();
    expect(input.fetcher).not.toHaveBeenCalled();
    expect(input.history.replaceState).not.toHaveBeenCalled();
  },
);

test('framing check wins before location is read or any request is sent', async () => {
  const input = setup(undefined, false);
  Object.defineProperty(input.location, 'hash', {
    get() {
      throw new Error('Fragment read before framing check.');
    },
  });
  await input.session.start();
  expect(input.session.state).toBe('framed');
  expect(input.fetcher).not.toHaveBeenCalled();
});

test.each([201, 400, 401, 403, 500])(
  'non-200 exchange %i cannot release the gate',
  async (status) => {
    const input = setup();
    input.fetcher.mockResolvedValue(new Response('{}', { status }));
    await input.session.start();
    expect(input.session.state).toBe('ended');
    expect(input.session.port).toBeNull();
    expect(input.fetcher.mock.calls.map(([path]) => path)).toEqual([
      '/session',
    ]);
  },
);

test.each([{ csrf: 'short' }, { csrf: token, extra: true }, null])(
  'malformed exchange body cannot release the gate',
  async (body) => {
    const input = setup();
    input.fetcher.mockResolvedValue(Response.json(body));
    await input.session.start();
    expect(input.session.state).toBe('ended');
    expect(input.session.port).toBeNull();
  },
);

test('network error ends the session without an API request', async () => {
  const input = setup();
  input.fetcher.mockRejectedValue(new TypeError('Network unavailable.'));
  await input.session.start();
  expect(input.session.state).toBe('ended');
  expect(input.session.port).toBeNull();
});

test('only a 200 exchange creates the HTTP port, with a page-load random identity', async () => {
  const input = setup();
  input.fetcher.mockResolvedValue(Response.json({ csrf: token }));
  await input.session.start();
  expect(input.session.state).toBe('ready');
  expect(input.session.pageId).toMatch(/^[\da-f-]{36}$/);
  expect(setup().session.pageId).not.toBe(input.session.pageId);
  expect(input.fetcher.mock.calls.map(([path]) => path)).toEqual(['/session']);
  input.session.end();
});

test('fragment parser accepts every allowed character and removes no other fragment', () => {
  const input = setup('#bootstrap=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn_-0');
  expect(takeBootstrap(input.location, input.history)).toBe(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn_-0',
  );
});
