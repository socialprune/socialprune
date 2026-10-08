import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { expect, test } from 'vitest';
import { ReviewDatabase } from './database.ts';
import { startReviewServer } from './server.ts';
import { inputs, request } from './test/helpers.ts';

test('higher query generation and stale window cancel; closed real socket cancels at the next 5000-row chunk', async () => {
  const fixture = await inputs(5001);
  // The test-only worker pauses at the real QueryEngine chunk boundary. The
  // production worker has no clock, fault or scheduling environment hook.
  let worker: Worker;
  let chunk!: () => void;
  let chunkSeen = new Promise<void>((resolve) => {
    chunk = resolve;
  });
  const server = await startReviewServer({
    workspace: fixture.workspace,
    assetDirectory: fixture.assets,
    handleSignals: false,
    async openDatabase(path) {
      return ReviewDatabase.open(path, {
        workerUrl: new URL('./test/cancellation-worker.ts', import.meta.url),
        createWorker(url, options) {
          worker = new Worker(url, options);
          worker.on('message', (message: { type: string }) => {
            if (message.type === 'chunk') chunk();
          });
          return worker;
        },
      });
    },
  });
  try {
    const parsed = new URL(server.launchUrl),
      origin = parsed.origin;
    const base = {
      Host: parsed.host,
      Origin: origin,
      'Content-Type': 'application/json',
    };
    const session = await request(origin, {
      path: '/session',
      headers: {
        ...base,
        'X-SocialPrune-Bootstrap': parsed.hash.slice('#bootstrap='.length),
      },
    });
    const auth = {
      ...base,
      Cookie: session.headers['set-cookie']![0]!.split(';')[0]!,
      'X-SocialPrune-CSRF': (session.data as { csrf: string }).csrf,
    };
    await request(origin, {
      path: '/api/open',
      headers: auth,
      body: JSON.stringify({
        type: 'open',
        requestId: 'open',
        workspaceId: 'active',
      }),
    });
    const query = {
      type: 'query',
      queryId: 'view',
      accountKey: 'x:generated',
      filter: {},
      sort: [{ by: 'id', direction: 'asc' }],
      search: '',
    };
    const first = request(origin, {
      path: '/api/query',
      headers: auth,
      body: JSON.stringify({ ...query, requestId: 'first', generation: 1 }),
    });
    await chunkSeen;
    chunkSeen = new Promise<void>((resolve) => {
      chunk = resolve;
    });
    const second = request(origin, {
      path: '/api/query',
      headers: auth,
      body: JSON.stringify({ ...query, requestId: 'second', generation: 2 }),
    });
    const revision = await request(origin, {
      path: '/api/revision',
      headers: auth,
      body: JSON.stringify({ type: 'revision', requestId: 'barrier' }),
    });
    expect(revision.status).toBe(200); // The second request has entered the worker.
    await chunkSeen;
    worker!.postMessage({ type: 'release' });
    expect((await first).data).toEqual([
      { type: 'cancelled', requestId: 'first', queryId: 'view', generation: 1 },
    ]);
    expect((await second).data).toMatchObject([
      { type: 'queryResult', generation: 2, total: 5001 },
    ]);
    const stale = await request(origin, {
      path: '/api/window',
      headers: auth,
      body: JSON.stringify({
        type: 'window',
        requestId: 'stale',
        queryId: 'view',
        generation: 1,
        offset: 0,
        limit: 1,
      }),
    });
    expect(stale.data).toEqual([
      { type: 'cancelled', requestId: 'stale', queryId: 'view', generation: 1 },
    ]);
    chunkSeen = new Promise<void>((resolve) => {
      chunk = resolve;
    });
    const body = JSON.stringify({
      ...query,
      queryId: 'socket',
      requestId: 'socket',
      generation: 1,
    });
    const socket = http.request({
      hostname: '127.0.0.1',
      port: parsed.port,
      path: '/api/query',
      method: 'POST',
      headers: { ...auth, 'Content-Length': Buffer.byteLength(body) },
      agent: false,
    });
    socket.on('error', () => {});
    socket.end(body);
    await chunkSeen;
    const cancelled = new Promise<unknown>((resolve) => {
      const listener = (message: {
        type: string;
        replies?: { requestId: string }[];
      }) => {
        if (
          message.type === 'reply' &&
          message.replies?.[0]?.requestId === 'socket'
        ) {
          worker.removeListener('message', listener);
          resolve(message.replies);
        }
      };
      worker.on('message', listener);
    });
    const socketClosed = new Promise<void>((resolve) =>
      socket.once('close', () => resolve()),
    );
    socket.destroy();
    await socketClosed;
    expect(await cancelled).toEqual([
      {
        type: 'cancelled',
        requestId: 'socket',
        queryId: 'socket',
        generation: 1,
      },
    ]);
    const counter = await request(origin, {
      path: '/api/revision',
      headers: auth,
      body: JSON.stringify({ type: 'revision', requestId: 'unchanged' }),
    });
    expect(counter.data).toEqual([
      { type: 'revision', requestId: 'unchanged', revision: 0 },
    ]);
  } finally {
    await server.stop();
    await fixture.dispose();
  }
}, 60_000);
