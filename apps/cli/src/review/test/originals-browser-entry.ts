import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace } from '@socialprune/core/workspace/store';
import { SQLiteStore } from '../../workspace/sqlite-store.ts';
import { browserWorkspace } from '../../workspace/test/inputs.ts';
import { fixture } from '../../originals/test/server.ts';
import { startReviewServer } from '../server.ts';
import { reviewAssetDirectory } from '../static.ts';
import { testIpc } from './ipc.ts';
import { migrateOriginal } from '@socialprune/core';
import { generatedVideo } from '../../originals/test/video.ts';

// An isolated synthetic test entrypoint, never selected by the normal CLI.
const directory = await mkdtemp(
  join(tmpdir(), 'socialprune-originals-browser-'),
);
const ipc = testIpc();
const controller = new AbortController();
process.on('message', (message: unknown) => {
  if (message === 'stop') controller.abort();
});
try {
  const data = createWorkspace({ id: 'generated-originals' });
  const base = browserWorkspace().items[0]!;
  data.items = [
    {
      ...base,
      kind: 'reply',
      text: 'Generated reply to the paper boat.',
      reference: { ...base.reference, replyToId: fixture.references[0]! },
    },
  ];
  data.imports = [{ ...browserWorkspace().imports[0]!, itemCount: 1 }];
  data.counts = { ...data.counts, items: 1, imports: 1, originals: 1 };
  data.originals = [
    migrateOriginal({
      id: fixture.references[0]!,
      status: 'fetched',
      fetchedAt: '2026-10-11T00:00:00Z',
      text: fixture.fetched.text,
      authorName: fixture.fetched.user.name,
      authorHandle: fixture.fetched.user.screen_name,
      photos: [
        {
          url: 'https://pbs.twimg.com/generated.png',
          file: '1.png',
          status: 'stored',
        },
      ],
      quotedId: null,
      parentId: null,
      raw: null,
      textCompleteness: 'truncated',
      video: null,
    }),
  ];
  data.originals[0]!.media.push({
    n: 2,
    kind: 'video',
    source: 'anonymous',
    url: 'https://video.twimg.com/generated.mp4',
    file: '2.mp4',
    poster: '2-poster.png',
    status: 'stored',
    bytes: 200,
    durationMs: 1200,
    bitrateLabel: 832000,
    altText: null,
  });
  data.originals[0]!.parentId = '900009';
  data.originals.push(
    migrateOriginal({
      id: '900009',
      status: 'fetched',
      fetchedAt: '2026-10-11T00:00:00Z',
      text: 'Generated first post in the conversation above.',
      authorName: 'Generated Root',
      authorHandle: 'generated_root',
      photos: [],
      quotedId: null,
      parentId: null,
      raw: null,
      textCompleteness: 'unknown',
      video: null,
    }),
  );
  data.counts.originals = 2;
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: data,
  });
  await store.close();
  await mkdir(join(directory, 'originals', fixture.references[0]!), {
    recursive: true,
  });
  await writeFile(
    join(directory, 'originals', fixture.references[0]!, '1.png'),
    Buffer.from(fixture.pngBase64, 'base64'),
  );
  await writeFile(
    join(directory, 'originals', fixture.references[0]!, '2.mp4'),
    generatedVideo,
  );
  await writeFile(
    join(directory, 'originals', fixture.references[0]!, '2-poster.png'),
    Buffer.from(fixture.pngBase64, 'base64'),
  );
  const server = await startReviewServer({
    workspace: directory,
    assetDirectory: reviewAssetDirectory(),
    signal: controller.signal,
    handleSignals: false,
    port: 4234,
  });
  await ipc.send({ type: 'opened', url: server.launchUrl });
  await server.closed;
} finally {
  await rm(directory, { recursive: true, force: true });
  await ipc.send({ type: 'cleanup' });
  await ipc.disconnect();
}
