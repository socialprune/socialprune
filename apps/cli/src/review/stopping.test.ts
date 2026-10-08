import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { startReviewServer } from './server.ts';
import { ReviewDatabase } from './database.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { inputs, request } from './test/helpers.ts';

test('stopping drains an in-flight human command before acknowledgment and closes worker', async () => {
  const fixture = await inputs();
  let worker!: Worker, entered!: () => void;
  const writeStarted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const server = await startReviewServer({
    workspace: fixture.workspace,
    assetDirectory: fixture.assets,
    handleSignals: false,
    openDatabase: (path) =>
      ReviewDatabase.open(path, {
        workerUrl: new URL('./test/shutdown-worker.ts', import.meta.url),
        createWorker(url, options) {
          worker = new Worker(url, options);
          worker.on('message', (message: { type: string }) => {
            if (message.type === 'pendingWrite') entered();
          });
          return worker;
        },
      }),
  });
  try {
    const url = new URL(server.launchUrl),
      origin = url.origin;
    const base = {
      Host: url.host,
      Origin: origin,
      'Content-Type': 'application/json',
    };
    const exchange = await request(origin, {
      path: '/session',
      headers: {
        ...base,
        'X-SocialPrune-Bootstrap': url.hash.slice('#bootstrap='.length),
      },
    });
    const auth = {
      ...base,
      Cookie: exchange.headers['set-cookie']![0]!.split(';')[0]!,
      'X-SocialPrune-CSRF': (exchange.data as { csrf: string }).csrf,
    };
    const decision = request(origin, {
      path: '/api/decide',
      headers: auth,
      body: JSON.stringify({
        type: 'decide',
        requestId: 'drain',
        commandId: 'drain',
        itemIds: ['x:101'],
        expected: { 'x:101': 'undecided' },
        value: 'delete',
      }),
    });
    await writeStarted;
    const exited = once(worker, 'exit');
    const stopped = server.stop();
    await expect(request(origin)).rejects.toThrow();
    worker.postMessage({ type: 'release' });
    expect((await decision).data).toMatchObject([
      { type: 'committed', changed: 1 },
    ]);
    await stopped;
    expect((await exited)[0]).toBe(0);
    const reopened = await SQLiteStore.open(
      join(fixture.workspace, 'socialprune.sqlite'),
      { readOnly: true },
    );
    try {
      expect(await reopened.read((tx) => tx.state.get('x:101'))).toMatchObject({
        decision: 'delete',
      });
    } finally {
      await reopened.close();
    }
  } finally {
    await server.stop();
    await fixture.dispose();
  }
}, 60_000);

test('five-second drain deadline terminates an unacknowledged blocked worker without committing it', async () => {
  const fixture = await inputs();
  let worker!: Worker, entered!: () => void;
  const writeStarted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const server = await startReviewServer({
    workspace: fixture.workspace,
    assetDirectory: fixture.assets,
    handleSignals: false,
    openDatabase: (path) =>
      ReviewDatabase.open(path, {
        workerUrl: new URL('./test/shutdown-worker.ts', import.meta.url),
        createWorker(url, options) {
          worker = new Worker(url, options);
          worker.on('message', (message: { type: string }) => {
            if (message.type === 'pendingWrite') entered();
          });
          return worker;
        },
      }),
  });
  try {
    const url = new URL(server.launchUrl),
      origin = url.origin;
    const base = {
      Host: url.host,
      Origin: origin,
      'Content-Type': 'application/json',
    };
    const exchange = await request(origin, {
      path: '/session',
      headers: {
        ...base,
        'X-SocialPrune-Bootstrap': url.hash.slice('#bootstrap='.length),
      },
    });
    const auth = {
      ...base,
      Cookie: exchange.headers['set-cookie']![0]!.split(';')[0]!,
      'X-SocialPrune-CSRF': (exchange.data as { csrf: string }).csrf,
    };
    const decision = request(origin, {
      path: '/api/decide',
      headers: auth,
      body: JSON.stringify({
        type: 'decide',
        requestId: 'deadline',
        commandId: 'deadline',
        itemIds: ['x:101'],
        expected: { 'x:101': 'undecided' },
        value: 'delete',
      }),
    }).catch(() => null);
    await writeStarted;
    const exited = once(worker, 'exit');
    const start = performance.now();
    await server.stop();
    expect(performance.now() - start).toBeGreaterThanOrEqual(4900);
    expect((await exited)[0]).not.toBe(0);
    expect((await decision)?.status).not.toBe(200);
    const reopened = await SQLiteStore.open(
      join(fixture.workspace, 'socialprune.sqlite'),
      { readOnly: true },
    );
    try {
      expect(await reopened.read((tx) => tx.state.get('x:101'))).toMatchObject({
        decision: 'undecided',
      });
    } finally {
      await reopened.close();
    }
  } finally {
    await server.stop();
    await fixture.dispose();
  }
}, 60_000);
