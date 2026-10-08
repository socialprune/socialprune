import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeCli } from '../../cli/adapter.ts';
import { createNodeContext } from '../../cli/node-context.ts';
import { SQLiteStore } from '../../workspace/sqlite-store.ts';
import { readWorkspace } from '@socialprune/core/workspace/store';

// A test-only process owns import, the real HTTP/database worker, and cleanup.
// No normal-runtime environment flag can select this entrypoint.
const paths = process.argv.slice(2);
const directory = await mkdtemp(join(tmpdir(), 'socialprune-review-browser-'));
const workspace = join(directory, 'workspace');
const controller = new AbortController();
let readback = false;
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
  const context = createNodeContext(sink, sink, controller.signal);
  const result = await executeCli(['review', '--workspace', workspace], {
    ...context,
    stderrIsTerminal: false,
    openBrowser(url) {
      process.send?.({ type: 'opened', url });
      return Promise.resolve();
    },
  });
  if (result !== 0) throw new Error('Review did not stop normally.');
  const store = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'), {
    readOnly: true,
  });
  try {
    const snapshot = await store.read(readWorkspace);
    process.send?.({ type: 'readback', snapshot });
    readback = true;
  } finally {
    await store.close();
  }
} finally {
  await rm(directory, { recursive: true, force: true });
  process.send?.({ type: 'cleanup', readback });
  process.disconnect?.();
}
