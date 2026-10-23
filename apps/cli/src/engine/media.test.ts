import {
  mkdtemp,
  rm,
  writeFile,
  link,
  symlink,
  rename,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { mediaFixture } from './media-fixture.test-helper.ts';
import { openEngine } from './index.ts';
import type { EngineMediaRequest } from './media.ts';
import { MEDIA_CHUNK_BYTES } from './media.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { EngineMedia } from './media.ts';
import { instagramContextDirectory } from '../workspace/context-files.ts';
import {
  INSTAGRAM_IMAGE_MAX_BYTES,
  INSTAGRAM_SCREENSHOT_MAX_BYTES,
} from '../workspace/context-files.ts';

test('desktop engine reads record-listed original and confirmed context bytes, same types HEAD and ranges as HTTP', async () => {
  const data = await mkdtemp(join(tmpdir(), 'sp-engine-media-'));
  const fixture = await mediaFixture(data),
    engine = await openEngine({ dataFolder: data });
  const original = {
    kind: 'original' as const,
    id: fixture.original.id,
    file: '1.png',
  };
  try {
    for (const input of [
      { type: 'open', target: original, method: 'GET' },
      {
        type: 'open',
        target: {
          kind: 'instagram',
          id: fixture.context.post.code,
          file: 'image.png',
        },
        method: 'GET',
        range: 'bytes=1-2',
      },
    ] satisfies EngineMediaRequest[]) {
      const result = await engine.media(input);
      expect(result).toMatchObject({
        type: 'opened',
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': String(fixture.png.length),
        },
      });
      if (result.type !== 'opened' || !result.token)
        throw new Error('MEDIA_TOKEN');
      expect(await engine.media({ type: 'read', token: result.token })).toEqual(
        { type: 'chunk', bytes: new Uint8Array(fixture.png), done: true },
      );
      expect(await engine.media({ type: 'read', token: result.token })).toEqual(
        { type: 'failed' },
      );
    }
    for (const [range, status, expected] of [
      ['bytes=1-4', 206, fixture.png.subarray(1, 5)],
      ['bytes=-3', 206, fixture.png.subarray(-3)],
      ['bytes=999999-', 416, null],
      ['bytes=-0', 416, null],
      ['bytes=5-2', 200, fixture.png],
      ['bytes=1-2,4-5', 200, fixture.png],
      ['bytes=-', 200, fixture.png],
    ] as const) {
      const result = await engine.media({
        type: 'open',
        target: original,
        method: 'GET',
        range,
      });
      expect(result).toMatchObject({ type: 'opened', status });
      if (result.type === 'opened' && result.token)
        expect(
          await engine.media({ type: 'read', token: result.token }),
        ).toEqual({
          type: 'chunk',
          bytes: new Uint8Array(expected!),
          done: true,
        });
    }
    expect(
      await engine.media({
        type: 'open',
        target: original,
        method: 'HEAD',
        range: 'bytes=1-2',
      }),
    ).toMatchObject({
      status: 200,
      token: null,
      headers: { 'Content-Length': String(fixture.png.length) },
    });
    const all = await engine.media({
      type: 'open',
      target: original,
      method: 'GET',
      range: 'bytes=1-2',
      ifRange: true,
    });
    expect(all).toMatchObject({ status: 200 });
    if (all.type === 'opened' && all.token)
      await engine.media({ type: 'close', token: all.token });
    expect(
      await engine.media({
        type: 'open',
        target: {
          kind: 'instagram',
          id: fixture.context.post.code,
          file: 'shot.jpg',
        },
        method: 'HEAD',
      }),
    ).toMatchObject({
      status: 200,
      token: null,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    expect(MEDIA_CHUNK_BYTES).toBe(262144);
  } finally {
    await engine.close();
    await rm(data, { recursive: true, force: true });
  }
}, 60_000);

test('media boundary rejects renderer paths, unlisted files, wrong magic and linked files; close invalidates a token', async () => {
  const data = await mkdtemp(join(tmpdir(), 'sp-engine-media-reject-'));
  const fixture = await mediaFixture(data),
    engine = await openEngine({ dataFolder: data });
  const target = {
    kind: 'original' as const,
    id: fixture.original.id,
    file: '1.png',
  };
  const request = { type: 'open' as const, target, method: 'GET' as const };
  const file = join(fixture.workspace, 'originals', target.id, target.file);
  try {
    for (const invalid of [
      { ...request, path: data },
      { ...request, target: { ...target, id: '..' } },
      { ...request, target: { ...target, file: '../socialprune.sqlite' } },
      { ...request, target: { ...target, file: '1.svg' } },
    ])
      expect(await engine.media(invalid as EngineMediaRequest)).toEqual({
        type: 'failed',
      });
    for (const other of [
      { ...target, file: '2.png' },
      { ...target, id: '999999999' },
      { kind: 'instagram' as const, id: 'Absent', file: 'image.png' as const },
    ])
      expect(await engine.media({ ...request, target: other })).toMatchObject({
        status: 404,
        token: null,
      });
    const opened = await engine.media(request);
    if (opened.type !== 'opened' || !opened.token)
      throw new Error('MEDIA_TOKEN');
    await engine.media({ type: 'close', token: opened.token });
    expect(await engine.media({ type: 'read', token: opened.token })).toEqual({
      type: 'failed',
    });
    await writeFile(file, '<svg onload="generated()"/>');
    expect(await engine.media(request)).toMatchObject({ status: 404 });
    await rm(file);
    const external = join(data, 'external.png');
    await writeFile(external, fixture.png);
    await link(external, file);
    expect(await engine.media(request)).toMatchObject({ status: 404 });
    await rm(file);
    await writeFile(file, fixture.png);
    const folder = join(fixture.workspace, 'originals', target.id),
      moved = folder + '-other';
    await rename(folder, moved);
    await symlink(
      moved,
      folder,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(await engine.media(request)).toMatchObject({ status: 404 });
    await rm(folder);
    await rename(moved, folder);
    const contextFile = join(
      instagramContextDirectory(fixture.workspace, fixture.context.post.code),
      'image.png',
    );
    await writeFile(contextFile, '<svg>not raster</svg>');
    expect(
      await engine.media({
        type: 'open',
        method: 'GET',
        target: {
          kind: 'instagram',
          id: fixture.context.post.code,
          file: 'image.png',
        },
      }),
    ).toMatchObject({ status: 404 });
    const contextRequest = {
      type: 'open' as const,
      method: 'GET' as const,
      target: {
        kind: 'instagram' as const,
        id: fixture.context.post.code,
        file: 'image.png' as const,
      },
    };
    await rm(contextFile);
    await link(external, contextFile);
    expect(await engine.media(contextRequest)).toMatchObject({ status: 404 });
    await rm(contextFile);
    await writeFile(contextFile, fixture.png);
    const contextFolder = instagramContextDirectory(
        fixture.workspace,
        fixture.context.post.code,
      ),
      movedContext = contextFolder + '-other';
    await rename(contextFolder, movedContext);
    await symlink(
      movedContext,
      contextFolder,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(await engine.media(contextRequest)).toMatchObject({ status: 404 });
    await rm(contextFolder);
    await rename(movedContext, contextFolder);
    const tooLarge = Buffer.alloc(INSTAGRAM_IMAGE_MAX_BYTES + 1);
    tooLarge.set(fixture.png.subarray(0, 12));
    await writeFile(contextFile, tooLarge);
    expect(await engine.media(contextRequest)).toMatchObject({ status: 404 });
    const shot = Buffer.alloc(INSTAGRAM_SCREENSHOT_MAX_BYTES + 1);
    shot.set([255, 216, 255]);
    await writeFile(join(contextFolder, 'shot.jpg'), shot);
    expect(
      await engine.media({
        ...contextRequest,
        target: { ...contextRequest.target, file: 'shot.jpg' },
      }),
    ).toMatchObject({ status: 404 });
    await writeFile(
      join(contextFolder, 'image.webp'),
      Buffer.from('RIFF0000WEBP'),
    );
    expect(
      await engine.media({
        ...contextRequest,
        target: { ...contextRequest.target, file: 'image.webp' },
      }),
    ).toMatchObject({ status: 404 });
  } finally {
    await engine.close();
    await rm(data, { recursive: true, force: true });
  }
}, 60_000);

test('video reads stay chunk-bounded, concurrent opens are capped, truncation and shutdown invalidate streams', async () => {
  const data = await mkdtemp(join(tmpdir(), 'sp-engine-media-stream-'));
  const fixture = await mediaFixture(data);
  const store = await SQLiteStore.open(
    join(fixture.workspace, 'socialprune.sqlite'),
  );
  const reader = new EngineMedia(fixture.workspace, () =>
    Promise.resolve(store),
  );
  const target = {
    kind: 'original' as const,
    id: fixture.original.id,
    file: '2.mp4',
  };
  const bytes = Buffer.alloc(MEDIA_CHUNK_BYTES * 2 + 9, 7);
  bytes.write('ftyp', 4);
  const file = join(fixture.workspace, 'originals', target.id, target.file);
  await store.write((tx) =>
    tx.originals.put({
      ...fixture.original,
      media: [
        ...fixture.original.media,
        {
          n: 2,
          kind: 'video',
          source: 'anonymous',
          url: 'https://video.twimg.com/generated.mp4',
          file: '2.mp4',
          status: 'stored',
          poster: null,
          altText: null,
          bytes: bytes.length,
          bitrateLabel: 1,
          durationMs: null,
        },
      ],
    }),
  );
  await writeFile(file, bytes);
  try {
    const opened = await reader.request({
      type: 'open',
      target,
      method: 'GET',
    });
    if (opened.type !== 'opened' || !opened.token)
      throw new Error('VIDEO_TOKEN');
    const first = await reader.request({ type: 'read', token: opened.token });
    expect(first).toEqual({
      type: 'chunk',
      bytes: new Uint8Array(bytes.subarray(0, MEDIA_CHUNK_BYTES)),
      done: false,
    });
    await writeFile(file, bytes.subarray(0, 12));
    expect(await reader.request({ type: 'read', token: opened.token })).toEqual(
      { type: 'failed' },
    );
    await writeFile(file, bytes);
    const requests = await Promise.all(
      Array.from({ length: 17 }, () =>
        reader.request({ type: 'open', target, method: 'GET' }),
      ),
    );
    expect(requests.filter((reply) => reply.type === 'opened')).toHaveLength(
      16,
    );
    expect(requests.filter((reply) => reply.type === 'failed')).toHaveLength(1);
    const token = requests.find((reply) => reply.type === 'opened')!;
    await reader.close();
    if (token.type !== 'opened' || !token.token) throw new Error('CLOSE_TOKEN');
    expect(await reader.request({ type: 'read', token: token.token })).toEqual({
      type: 'failed',
    });
  } finally {
    await reader.close();
    await store.close();
    await rm(data, { recursive: true, force: true });
  }
}, 60_000);
