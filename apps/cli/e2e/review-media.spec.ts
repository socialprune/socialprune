import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/workspace/sqlite-store.ts';
import { fixtureWorkspace } from './fake-x/fixture.ts';
import { migrateOriginal } from '@socialprune/core';
import { startReviewServer } from '../src/review/server.ts';
import { reviewAssetDirectory } from '../src/review/static.ts';
import { TEST_PORTS } from '../playwright.ports.config.ts';
test('real socket range matrix and session traversal signature/link controls for stored video', async ({
  request,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-range-')),
    data = fixtureWorkspace(['1001']);
  const original = migrateOriginal({
    id: '910',
    status: 'fetched',
    fetchedAt: '2026-10-12T00:00:00Z',
    text: 'Generated video',
    authorName: 'Generated',
    authorHandle: 'generated',
    photos: [],
    quotedId: null,
    parentId: null,
    raw: null,
    textCompleteness: 'unknown',
    video: null,
  });
  original.media = [
    {
      n: 1,
      kind: 'video',
      source: 'anonymous',
      url: 'https://video.twimg.com/generated.mp4',
      file: '1.mp4',
      poster: null,
      status: 'stored',
      bytes: 200,
      durationMs: 1200,
      bitrateLabel: 832000,
      altText: null,
    },
    {
      n: 2,
      kind: 'video',
      source: 'anonymous',
      url: null,
      file: '2.mp4',
      poster: null,
      status: 'stored',
      bytes: 200,
      durationMs: null,
      bitrateLabel: null,
      altText: null,
    },
  ];
  data.originals = [original];
  data.counts.originals = 1;
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: data,
  });
  await store.close();
  await mkdir(join(directory, 'originals', '910'), { recursive: true });
  const bytes = Buffer.alloc(200, 1);
  bytes.write('ftyp', 4);
  await writeFile(join(directory, 'originals', '910', '1.mp4'), bytes);
  await writeFile(
    join(directory, 'originals', '910', '2.mp4'),
    Buffer.alloc(200),
  );
  const server = await startReviewServer({
    workspace: directory,
    assetDirectory: reviewAssetDirectory(),
    handleSignals: false,
    port: TEST_PORTS.reviewMedia,
  });
  try {
    const origin = server.url.slice(0, -1),
      path = origin + '/originals/910/1.mp4';
    expect((await request.get(path)).status()).toBe(401);
    const token = new URL(server.launchUrl).hash.slice(11);
    const session = await request.post(origin + '/session', {
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-SocialPrune-Bootstrap': token,
      },
      data: {},
    });
    expect(session.status()).toBe(200);
    const cases: [Record<string, string>, number, number][] = [
      [{}, 200, 200],
      [{ Range: 'bytes=0-1' }, 206, 2],
      [{ Range: 'bytes=100-' }, 206, 100],
      [{ Range: 'bytes=-50' }, 206, 50],
      [{ Range: 'bytes=200-' }, 416, 0],
      [{ Range: 'bytes=0-1,10-20' }, 200, 200],
      [{ Range: 'generated-bad' }, 200, 200],
      [{ Range: 'bytes=0-1', 'If-Range': 'generated' }, 200, 200],
    ];
    for (const [headers, status, size] of cases) {
      const response = await request.get(path, { headers });
      expect(response.status()).toBe(status);
      expect((await response.body()).length).toBe(size);
      expect(response.headers()['accept-ranges']).toBe('bytes');
    }
    const head = await request.head(path);
    expect(head.status()).toBe(200);
    expect((await head.body()).length).toBe(0);
    expect(
      (
        await request.get(path, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
      ).status(),
    ).toBe(403);
    for (const file of ['2.mp4', '3.mp4', '../socialprune.sqlite'])
      expect(
        (await request.get(origin + '/originals/910/' + file)).status(),
      ).toBe(404);
    await mkdir(join(directory, 'outside'));
    await writeFile(join(directory, 'outside', '1.mp4'), bytes);
    const linked = { ...original, id: '911' };
    const reopened = await SQLiteStore.open(
      join(directory, 'socialprune.sqlite'),
    );
    await reopened.write((tx) => tx.originals.put(linked));
    await reopened.close();
    await symlink(
      join(directory, 'outside'),
      join(directory, 'originals', '911'),
      'junction',
    );
    expect((await request.get(origin + '/originals/911/1.mp4')).status()).toBe(
      404,
    );
  } finally {
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
