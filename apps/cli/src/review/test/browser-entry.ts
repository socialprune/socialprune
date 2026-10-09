import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeCli } from '../../cli/adapter.ts';
import { createNodeContext } from '../../cli/node-context.ts';
import { SQLiteStore } from '../../workspace/sqlite-store.ts';
import { readWorkspace } from '@socialprune/core/workspace/store';
import { channel } from 'node:diagnostics_channel';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { testIpc } from './ipc.ts';

// A test-only process owns import, the real HTTP/database worker, and cleanup.
// No normal-runtime environment flag can select this entrypoint.
const paths = process.argv.slice(2);
const directory = await mkdtemp(join(tmpdir(), 'socialprune-review-browser-'));
const workspace = join(directory, 'workspace');
const controller = new AbortController();
let readback = false;
const ipc = testIpc();
const responses = channel('http.server.response.finish');
const observe = (raw: unknown) => {
  const { request, response } = raw as {
    request: IncomingMessage;
    response: ServerResponse;
  };
  // writeHead's header object is not retained by getHeaders(). Read Node's
  // already-generated wire header at finish, without changing any response.
  const wire: unknown = Reflect.get(response, '_header');
  const headers =
    typeof wire === 'string'
      ? Object.fromEntries(
          wire
            .split('\r\n')
            .slice(1)
            .filter((line) => line.includes(':'))
            .map((line) => {
              const index = line.indexOf(':');
              return [
                line.slice(0, index).toLowerCase(),
                line.slice(index + 1).trim(),
              ];
            }),
        )
      : {};
  void ipc.send({
    type: 'httpResponse',
    method: request.method,
    path: request.url,
    status: response.statusCode,
    headers,
  });
};
responses.subscribe(observe);
process.on('message', (message: unknown) => {
  if (message === 'stop') controller.abort();
});
const sink = { write() {} };
try {
  const imported = await executeCli(
    ['import', ...paths, '--workspace', workspace, '--json'],
    createNodeContext(sink, sink),
  );
  if (imported !== 0) throw new Error('Synthetic import did not complete.');
  const initial = await SQLiteStore.open(
    join(workspace, 'socialprune.sqlite'),
    { readOnly: true },
  );
  const initialRevision = await initial.read(
    async (tx) => (await tx.runtime.get()).revision,
  );
  await initial.close();
  const context = createNodeContext(sink, sink, controller.signal);
  const result = await executeCli(['review', '--workspace', workspace], {
    ...context,
    stderrIsTerminal: false,
    openBrowser(url) {
      return ipc.send({ type: 'opened', url });
    },
  });
  if (result !== 0) throw new Error('Review did not stop normally.');
  const store = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'), {
    readOnly: true,
  });
  try {
    const snapshot = await store.read(readWorkspace);
    const revision = await store.read(
      async (tx) => (await tx.runtime.get()).revision,
    );
    await ipc.send({
      type: 'readback',
      snapshot: { ...snapshot, revision, initialRevision },
    });
    readback = true;
  } finally {
    await store.close();
  }
} finally {
  await rm(directory, { recursive: true, force: true });
  responses.unsubscribe(observe);
  try {
    await ipc.send({ type: 'cleanup', readback });
  } finally {
    await ipc.disconnect();
  }
}
