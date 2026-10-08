import { afterEach, expect, test, vi } from 'vitest';
import type {
  WorkspaceSummary,
  WorkspaceReply,
} from '@socialprune/core/workspace/protocol';
import { WorkspaceClient } from '../workspace/client.ts';
import { HttpWorkspacePort, parseHttpReplies } from './http-port.ts';
import { ReviewSession } from './session.ts';

const summary: WorkspaceSummary = {
  workspaceId: 'input-workspace',
  schemaVersion: 2,
  kind: 'personal',
  accounts: [],
  counts: {
    imports: 0,
    items: 0,
    assessments: 0,
    submissions: 0,
    decisionEvents: 0,
    outcomeEvents: 0,
  },
  decisions: { keep: 0, delete: 0, later: 0, undecided: 0 },
  outcomes: { 'deleted-by-user': 0, skipped: 0, unknown: 0 },
  lastBackupAt: null,
  timeZone: null,
  revision: 7,
};
const ports: HttpWorkspacePort[] = [];
function requestBody(init?: RequestInit) {
  if (typeof init?.body !== 'string')
    throw new Error('Request body must be JSON text.');
  return JSON.parse(init.body) as {
    requestId: string;
    pageId?: string;
    generation: number;
    queryId: string;
    type: string;
    workspaceId?: string;
  };
}
afterEach(() => {
  for (const port of ports.splice(0)) port.terminate();
  vi.useRealTimers();
});
function fixture() {
  const visibility: { visibilityState: DocumentVisibilityState } = {
    visibilityState: 'visible',
  };
  const doc = Object.assign(new EventTarget(), visibility);
  const ended = vi.fn();
  const fetcher = vi.fn<typeof fetch>((_input, init) => {
    const request = requestBody(init);
    return Promise.resolve(
      Response.json([
        { type: 'opened', requestId: request.requestId, summary },
      ]),
    );
  });
  const port = new HttpWorkspacePort({
    csrf: 'C'.repeat(43),
    origin: 'http://127.0.0.1:45678',
    pageId: 'load-page',
    document: doc,
    ended,
    fetch: fetcher,
  });
  ports.push(port);
  return { port, client: new WorkspaceClient(port), doc, ended, fetcher };
}

test('existing WorkspaceClient opens active over exact POST type path with CSRF and browser cookie credentials', async () => {
  const { client, fetcher } = fixture();
  const reply = await client.open();
  expect(reply.type).toBe('opened');
  expect(reply.requestId).toEqual(expect.any(String));
  if (reply.type === 'opened') expect(reply.summary).toEqual(summary);
  const path: unknown = fetcher.mock.calls[0]![0];
  const init = fetcher.mock.calls[0]![1];
  expect(path).toBe('/api/open');
  expect(init).toMatchObject({
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: {
      Origin: 'http://127.0.0.1:45678',
      'Content-Type': 'application/json',
      'X-SocialPrune-CSRF': 'C'.repeat(43),
    },
  });
  const body = requestBody(init);
  expect(body.type).toBe('open');
  expect(body.workspaceId).toBe('active');
  expect(body.requestId).toEqual(expect.any(String));
});

test('all preview operations bind the same page-load identity, not a component remount identity', async () => {
  const { client, fetcher } = fixture();
  fetcher.mockImplementation((_input, init) => {
    const request = requestBody(init);
    return Promise.resolve(
      Response.json([{ type: 'released', requestId: request.requestId }]),
    );
  });
  for (const input of [
    {
      type: 'previewBulk' as const,
      previewId: 'p',
      queryId: 'q',
      generation: 1,
      value: 'keep' as const,
      overwrite: ['undecided' as const],
    },
    { type: 'confirmBulk' as const, commandId: 'c', previewId: 'p' },
    { type: 'releasePreview' as const, previewId: 'p' },
  ])
    await client.request({
      ...input,
      pageId: 'component-page',
      requestId: input.type,
    });
  expect(
    fetcher.mock.calls.map((call) => [
      call[0] as unknown,
      requestBody(call[1]).pageId,
    ]),
  ).toEqual([
    ['/api/previewBulk', 'load-page'],
    ['/api/confirmBulk', 'load-page'],
    ['/api/releasePreview', 'load-page'],
  ]);
});

test.each(['backup', 'restore', 'attachImport', 'deleteWorkspace'])(
  'worker-only %s never reaches HTTP',
  (type) => {
    const { port, fetcher } = fixture();
    const replies: unknown[] = [];
    port.addEventListener('message', (event) => replies.push(event.data));
    // Deliberately cross the untrusted port boundary, not the typed UI boundary.
    port.postMessage({ type, requestId: 'worker-only' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(replies).toEqual([
      { type: 'failed', requestId: 'worker-only', code: 'INVALID_REQUEST' },
    ]);
  },
);

test('ordered reply-array chunks run through the existing export queue before its byte receipt resolves', async () => {
  const { client, fetcher } = fixture();
  const chunks = ['\uFEFFinput,one\r\n', 'input,two\r\n'];
  fetcher.mockImplementation((_input, init) => {
    const { requestId } = requestBody(init);
    return Promise.resolve(
      Response.json([
        { type: 'progress', requestId, completed: 0, total: 2 },
        ...chunks.map((chunk, index) => ({
          type: 'clickListExportChunk',
          requestId,
          listId: 'input-list',
          revision: 4,
          format: 'csv',
          index,
          chunk,
        })),
        {
          type: 'clickListExported',
          requestId,
          listId: 'input-list',
          revision: 4,
          format: 'csv',
          entries: 2,
          bytes: new TextEncoder().encode(chunks.join('')).byteLength,
        },
      ]),
    );
  });
  const written: string[] = [];
  await client.exportClickList('input-list', 'csv', async (chunk) => {
    await Promise.resolve();
    written.push(chunk);
  });
  expect(written).toEqual(chunks);
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/clickListExport');
});

test.each(
  [
    [],
    {},
    [{ type: 'revision', requestId: 'wrong', revision: 1 }],
    [{ type: 'revision', requestId: 'id', revision: 1, extra: true }],
    [{ type: 'progress', requestId: 'id', completed: 0, total: null }],
    [
      { type: 'revision', requestId: 'id', revision: 1 },
      { type: 'revision', requestId: 'id', revision: 2 },
    ],
  ].map((input) => ({ input })),
)(
  'rejects malformed, mismatched or nonterminal reply array $input',
  ({ input }) => {
    expect(() => parseHttpReplies(input, 'id')).toThrow();
  },
);

test('a terminal followed by another terminal is rejected rather than emitted to the client', async () => {
  const { client, fetcher, ended } = fixture();
  fetcher.mockImplementation((_input, init) => {
    const { requestId } = requestBody(init);
    return Promise.resolve(
      Response.json([
        { type: 'opened', requestId, summary },
        { type: 'revision', requestId, revision: 9 },
      ]),
    );
  });
  await expect(client.open()).rejects.toThrow();
  expect(client.summary).toBeNull();
  expect(ended).toHaveBeenCalledTimes(1);
});

test.each([401, 403, 400, 500])(
  'HTTP %i ends the session, rejects pending work and prevents later requests',
  async (status) => {
    const { client, fetcher, ended } = fixture();
    fetcher.mockResolvedValue(new Response('', { status }));
    await expect(client.open()).rejects.toThrow();
    await expect(client.open()).rejects.toThrow();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

test.each([401, 403, 'network'] as const)(
  'later $0 after a successful exchange enters the actual session-ended state',
  async (failure) => {
    const doc = Object.assign(new EventTarget(), {
      visibilityState: 'visible' as const,
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ csrf: 'C'.repeat(43) }));
    if (failure === 'network')
      fetcher.mockRejectedValue(new TypeError('Disconnected.'));
    else fetcher.mockResolvedValue(new Response('', { status: failure }));
    const session = new ReviewSession({
      isTopLevel: true,
      location: {
        hash: `#bootstrap=${'B'.repeat(43)}`,
        pathname: '/',
        search: '',
        origin: 'http://127.0.0.1:45678',
      },
      history: { replaceState() {} },
      document: doc,
      fetch: fetcher,
    });
    await session.start();
    expect(session.state).toBe('ready');
    const client = new WorkspaceClient(session.port!);
    ports.push(session.port!);
    await expect(client.open()).rejects.toThrow();
    expect(session.state).toBe('ended');
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      '/session',
      '/api/open',
    ]);
  },
);

test('polling runs every two seconds only while visible, and changed revision uses the worker notification seam', async () => {
  vi.useFakeTimers();
  const { client, fetcher, doc } = fixture();
  const notices: unknown[] = [];
  client.subscribe((notice) => notices.push(notice));
  await client.open();
  fetcher.mockImplementation((_input, init) => {
    const { requestId } = requestBody(init);
    return Promise.resolve(
      Response.json([{ type: 'revision', requestId, revision: 8 }]),
    );
  });
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe('/api/revision');
  expect(notices).toEqual([
    { type: 'changed', revision: 8, itemIds: 'many', countsChanged: true },
  ]);
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(6000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(notices).toHaveLength(1);
  client.dispose();
  await vi.advanceTimersByTimeAsync(4000);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test('generation filtering stays in WorkspaceClient across concurrent HTTP replies', async () => {
  const { client, fetcher } = fixture();
  let resolveFirst: (response: Response) => void = () => {};
  fetcher.mockImplementation((_input, init) => {
    const request = requestBody(init);
    const reply: WorkspaceReply = {
      type: 'queryResult',
      requestId: request.requestId,
      queryId: request.queryId,
      generation: request.generation,
      total: 0,
      counts: { decisions: summary.decisions, outcomes: summary.outcomes },
    };
    return request.generation === 1
      ? new Promise((resolve) => {
          resolveFirst = resolve;
        })
      : Promise.resolve(Response.json([reply]));
  });
  const base = {
    type: 'query' as const,
    queryId: 'input-query',
    accountKey: 'input-account',
    filter: {},
    sort: [{ by: 'id' as const, direction: 'asc' as const }],
    search: '',
  };
  const first = client.request({ ...base, generation: 1, requestId: 'first' });
  await client.request({ ...base, generation: 2, requestId: 'second' });
  resolveFirst(
    Response.json([
      {
        type: 'queryResult',
        requestId: 'first',
        queryId: 'input-query',
        generation: 1,
        total: 0,
        counts: { decisions: summary.decisions, outcomes: summary.outcomes },
      },
    ]),
  );
  expect(await first).toEqual({
    type: 'cancelled',
    requestId: 'first',
    queryId: 'input-query',
    generation: 1,
  });
});
