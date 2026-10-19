import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createWorkspace,
  readWorkspace,
} from '@socialprune/core/workspace/store';
import { InstagramContextWriter } from '@socialprune/core/workspace/instagram-context-writer';
import type { InstagramContext, Item } from '@socialprune/core';
import { SQLiteStore } from '../../workspace/sqlite-store.ts';
import { instagramContextDirectory } from '../../workspace/context-files.ts';

const fixtureRoot = new URL(
  '../../../../../fixtures/synthetic/',
  import.meta.url,
);
const demo = JSON.parse(
  await readFile(new URL('demo/instagram/expected.json', fixtureRoot), 'utf8'),
) as { items: Item[] };
const accounts = JSON.parse(
  await readFile(
    new URL('instagram/two-accounts/expected.json', fixtureRoot),
    'utf8',
  ),
) as { items: Item[] };
const raster = JSON.parse(
  await readFile(
    new URL('../../originals/test/syndication.json', import.meta.url),
    'utf8',
  ),
) as { pngBase64: string };

export const contextInputs = {
  items: demo.items.slice(0, 4).toReversed(),
  foreign: accounts.items[1]!,
  confirmedAt: '2026-10-15T12:00:00.000Z',
  captionMarkup:
    '<img src="https://generated.invalid/caption" onerror="globalThis.contextExecuted=true">',
  codes: [
    'Generated_Aa-1',
    'Generated_Aa-2',
    'Generated_Aa-3',
    'Generated_Aa-4',
    'Generated_Foreign',
  ],
  png: Buffer.from(raster.pngBase64, 'base64'),
};

/** The only writer here is a test setup capability, never imported by the CLI. */
export async function writeContextFixture(
  workspace: string,
  jpeg: Uint8Array = Buffer.from([255, 216, 255, 217]),
  listConfirmed = false,
) {
  const data = createWorkspace({
    id: 'generated-context-review',
    timeZone: 'UTC',
  });
  data.items = [...contextInputs.items, contextInputs.foreign];
  data.imports = [
    {
      id: 'generated-context-import',
      platform: 'instagram',
      importedAt: contextInputs.confirmedAt,
      archives: [...new Set(data.items.map((item) => item.provenance.archive))],
      exportCreatedAt: null,
      accounts: [
        contextInputs.items[0]!.account,
        contextInputs.foreign.account,
      ],
      adapter: { name: 'generated', version: '1' },
      variant: null,
      diagnostics: [],
      itemCount: data.items.length,
      status: 'complete',
    },
  ];
  data.counts = { ...data.counts, imports: 1, items: data.items.length };
  const store = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'), {
    initial: data,
  });
  const records: InstagramContext[] = [];
  try {
    const writer = new InstagramContextWriter(store);
    for (const [index, item] of data.items.entries()) {
      // Fourth own comment deliberately has no confirmed context.
      if (index === 3) continue;
      const runId = `generated-context-${index}`,
        attemptId = `generated-send-${index}`;
      const record: InstagramContext = {
        ...(listConfirmed
          ? {
              confirmedBy: 'list' as const,
              comment: { id: null, createdAt: null, expandClicks: 1 },
            }
          : {
              confirmedBy: 'post' as const,
              comment: {
                id: String(910001 + index),
                createdAt: item.createdAt,
                expandClicks: 1,
              },
            }),
        itemId: item.id,
        accountKey: item.account.key,
        post: {
          kind: index === 1 ? 'reel' : 'p',
          code: contextInputs.codes[index]!,
          owner: item.reference.ownerHandle!,
          ownerCount: 1,
          createdAt: item.createdAt,
          caption:
            item.text + (index === 0 ? '\n' + contextInputs.captionMarkup : ''),
          captionComplete: index !== 0,
        },
        image:
          index === 1
            ? { status: 'not-captured', file: null, host: null }
            : {
                status: 'stored',
                file: 'image.png',
                host: 'generated.cdninstagram.com',
              },
        screenshot: { status: 'stored', file: 'shot.jpg', bytes: jpeg.length },
        confirmedAt: contextInputs.confirmedAt,
        runId,
        attemptId,
      };
      await writer.startRun({
        runId,
        accountKey: item.account.key,
        planHash: 'c'.repeat(64),
        startedAt: record.confirmedAt,
      });
      await writer.sending({
        attemptId,
        runId,
        itemId: item.id,
        at: record.confirmedAt,
      });
      await writer.step(runId, record.confirmedAt);
      await writer.confirm(record);
      await writer.endRun({
        runId,
        endedAt: record.confirmedAt,
        endReason: 'done',
        bodyShapes: {},
        profileReport: {
          accountBefore: item.account.handle,
          accountAfter: item.account.handle,
          extensionsBefore: 0,
          extensionsAfter: 0,
          changedFiles: [],
          unexpectedRequests: [],
        },
      });
      records.push(record);
      // Third own record models a copied workspace without its media folder.
      if (index === 2) continue;
      const folder = instagramContextDirectory(workspace, record.post.code);
      await mkdir(folder, { recursive: true });
      if (record.image.file)
        await writeFile(join(folder, record.image.file), contextInputs.png);
      await writeFile(join(folder, 'shot.jpg'), jpeg);
    }
    return { data: await store.read(readWorkspace), records };
  } finally {
    await store.close();
  }
}

// This module doubles as a disposable browser-test entrypoint. Imports have no
// listener side effects; only an explicit invocation starts the real server.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { startReviewServer } = await import('../server.ts');
  const { reviewAssetDirectory } = await import('../static.ts');
  const { testIpc } = await import('./ipc.ts');
  const workspace = await mkdtemp(
    join(tmpdir(), 'socialprune-context-foundation-'),
  );
  const ipc = testIpc(),
    controller = new AbortController();
  process.on('message', (message: unknown) => {
    if (message === 'stop') controller.abort();
  });
  try {
    await writeContextFixture(workspace);
    const server = await startReviewServer({
      workspace,
      assetDirectory: reviewAssetDirectory(),
      signal: controller.signal,
      handleSignals: false,
    });
    await ipc.send({ type: 'opened', url: server.launchUrl });
    await server.closed;
    await ipc.send({ type: 'stopped' });
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await ipc.send({ type: 'cleanup' });
    await ipc.disconnect();
  }
}
