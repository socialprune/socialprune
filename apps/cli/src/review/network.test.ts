import { expect, test } from 'vitest';
import { executeCli } from '../cli/adapter.ts';
import { createNodeContext } from '../cli/node-context.ts';
import { capturedContext } from '../cli/test/context.ts';
import { networkRecorder } from '../cli/test/network-recorder.ts';
import { inputs } from './test/helpers.ts';
import { ReviewDatabase } from './database.ts';
import { ReviewSession } from './session.ts';
import { Worker } from 'node:worker_threads';

test('real review launch/dry-run/refusal/opener failure have zero outbound calls; database worker is recorded too', async () => {
  const fixture = await inputs();
  const recorder = networkRecorder();
  try {
    for (const mode of [
      'dry',
      'browser',
      'terminal',
      'no-channel',
      'failed',
    ] as const) {
      const abort = new AbortController();
      const capture = capturedContext(
        createNodeContext({ write() {} }, { write() {} }).services,
      );
      const node = createNodeContext(
        capture.context.io.stdout,
        capture.context.io.stderr,
        abort.signal,
      );
      const flags =
        mode === 'dry'
          ? ['--dry-run']
          : mode === 'terminal' || mode === 'no-channel'
            ? ['--no-open']
            : [];
      const result = await executeCli(
        ['review', '--workspace', fixture.workspace, '--json', ...flags],
        {
          ...node,
          reviewAssetDirectory: fixture.assets,
          stderrIsTerminal: mode === 'terminal',
          io: {
            ...node.io,
            stderr: {
              write(text) {
                capture.stderr.push(text);
                if (mode === 'terminal') abort.abort();
              },
            },
          },
          openBrowser(url) {
            capture.opened.push(url);
            if (mode === 'failed') return Promise.reject(new Error(url));
            abort.abort();
            return Promise.resolve();
          },
        },
      );
      expect(
        result,
        JSON.stringify({ mode, calls: recorder.calls, output: capture.stderr }),
      ).toBe(mode === 'no-channel' ? 2 : mode === 'failed' ? 1 : 0);
      expect(recorder.calls).toEqual([]);
    }
    let workerCalls: unknown = null;
    const database = await ReviewDatabase.open(
      fixture.workspace + '/socialprune.sqlite',
      {
        workerUrl: new URL('./test/network-worker.ts', import.meta.url),
        createWorker(url, options) {
          const worker = new Worker(url, options);
          worker.on('message', (message: { type: string; calls?: unknown }) => {
            if (message.type === 'networkRecord') workerCalls = message.calls;
          });
          return worker;
        },
      },
    );
    try {
      const inputs = [
        { type: 'open', requestId: 'open', workspaceId: 'active' },
        { type: 'revision', requestId: 'revision' },
        {
          type: 'decide',
          requestId: 'decide',
          commandId: 'decide',
          itemIds: ['x:101'],
          value: 'delete',
          expected: { 'x:101': 'undecided' },
        },
        {
          type: 'clickListOpen',
          requestId: 'list',
          listId: 'list',
          accountKey: 'x:generated',
        },
        {
          type: 'clickListExport',
          requestId: 'export',
          listId: 'list',
          format: 'csv',
        },
        {
          type: 'query',
          requestId: 'q',
          queryId: 'q',
          generation: 1,
          accountKey: 'x:generated',
          filter: {},
          sort: [{ by: 'id', direction: 'asc' }],
          search: '',
        },
        {
          type: 'window',
          requestId: 'rows',
          queryId: 'q',
          generation: 1,
          offset: 0,
          limit: 200,
        },
        { type: 'detail', requestId: 'detail', itemId: 'x:101' },
        {
          type: 'outcome',
          requestId: 'outcome',
          commandId: 'outcome',
          itemIds: ['x:101'],
          value: 'deleted-by-user',
          expected: { 'x:101': 'unknown' },
        },
        { type: 'undo', requestId: 'undo', commandId: 'undo' },
        { type: 'redo', requestId: 'redo', commandId: 'redo' },
        { type: 'history', requestId: 'history', limit: 200 },
        {
          type: 'previewBulk',
          requestId: 'p',
          queryId: 'q',
          generation: 1,
          value: 'later',
          overwrite: ['delete'],
          pageId: 'p',
          previewId: 'p',
        },
        {
          type: 'confirmBulk',
          requestId: 'confirm',
          commandId: 'confirm',
          pageId: 'p',
          previewId: 'p',
        },
        {
          type: 'releasePreview',
          requestId: 'release',
          pageId: 'p',
          previewId: 'p',
        },
        {
          type: 'clickListWindow',
          requestId: 'window',
          listId: 'list',
          offset: 0,
          limit: 200,
        },
        { type: 'setTimeZone', requestId: 'zone', timeZone: 'UTC' },
        { type: 'shutdown', requestId: 'shutdown' },
      ] as const;
      for (const input of inputs)
        await database.run(
          structuredClone(input) as Parameters<ReviewDatabase['run']>[0],
        );
    } finally {
      await database.close();
    }
    expect(workerCalls).toEqual([]);
    expect(recorder.calls).toEqual([]);
    const session = new ReviewSession();
    expect(session.exchange(session.bootstrap)).not.toBeNull();
  } finally {
    recorder.restore();
    await fixture.dispose();
  }
}, 60_000);
