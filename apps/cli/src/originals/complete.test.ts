import { expect, test } from 'vitest';
import {
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  rm,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { fixtureWorkspace, FIXTURE } from '../../e2e/fake-x/fixture.ts';
import { fetchOriginals } from './fetch.ts';
import { SyndicationClient } from './syndication.ts';
import * as media from './media.ts';
import * as model from '@socialprune/core';
import { OriginalsFillWriter } from '@socialprune/core/workspace/store';
import { extract } from '../browser/x/fill/extract.ts';
import { storeOriginalMedia } from './store-media.ts';
import { productionMedia } from './video.ts';
import {
  gatedMediaAnswer,
  GATED_MEDIA_FIXTURE,
  DISPLAY_COMPARISON_FIXTURE,
} from '../../e2e/fake-x/fill-detail.ts';

const RAW_FIXTURE = {
  id_str: '101',
  text: 'Generated beginning',
  user: { name: 'Generated author', screen_name: 'generated_author' },
  note_tweet: {},
  quoted_tweet: { id_str: '102' },
  mediaDetails: [
    {
      type: 'video',
      media_url_https: 'https://pbs.twimg.com/generated.jpg',
      video_info: {
        duration_millis: 140000,
        variants: [
          {
            content_type: 'video/mp4',
            bitrate: 2176000,
            url: 'https://video.twimg.com/generated.mp4',
          },
        ],
      },
    },
  ],
};
test.each(['note_tweet', 'truncated'])(
  'anonymous cutoff detects %s from a generated answer',
  async (key) => {
    const raw = {
      ...RAW_FIXTURE,
      ...(key === 'truncated'
        ? { note_tweet: undefined, truncated: true }
        : {}),
    };
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(raw));
    });
    // Port 0: vitest runs test files in parallel, and a fixed port collides.
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Fake server did not listen.');
    try {
      const original = await new SyndicationClient({
        baseUrl: `http://127.0.0.1:${address.port}`,
      }).fetchOriginal(
        '101',
        '2026-10-12T00:00:00.000Z',
        new AbortController().signal,
      );
      expect(original.textCompleteness).toBe('truncated');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
test('stored raw answers rederive video variants and quotes without a tweet request', () => {
  const migrate = Reflect.get(model, 'migrateOriginal') as (value: unknown) => {
    media: { kind: string; url: string | null }[];
    quotedId: string | null;
    textCompleteness: string;
  };
  const value = migrate({
    id: '101',
    status: 'fetched',
    fetchedAt: '2026-10-12T00:00:00.000Z',
    text: RAW_FIXTURE.text,
    authorName: RAW_FIXTURE.user.name,
    authorHandle: RAW_FIXTURE.user.screen_name,
    photos: [],
    quotedId: null,
    parentId: null,
    raw: RAW_FIXTURE,
    textCompleteness: 'unknown',
    video: 'not-stored',
  });
  expect(value.media).toHaveLength(1);
  expect(value.media[0]).toMatchObject({
    kind: 'video',
    url: 'https://video.twimg.com/generated.mp4',
  });
  expect(value.quotedId).toBe('102');
  expect(value.textCompleteness).toBe('truncated');
});
test('leftover media part files are removed on the next run without changing complete files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-parts-decoy-'));
  await mkdir(join(directory, 'originals', '101'), { recursive: true });
  await writeFile(
    join(directory, 'originals', '101', '1.mp4.part'),
    'Generated partial',
  );
  await writeFile(
    join(directory, 'originals', '101', '2.png'),
    'Generated completed',
  );
  try {
    await media.cleanupParts(directory);
    expect(await readdir(join(directory, 'originals', '101'))).toEqual([
      '2.png',
    ]);
    expect(
      await readFile(join(directory, 'originals', '101', '2.png'), 'utf8'),
    ).toBe('Generated completed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test.each([2, 3])(
  'layout %i stored raw migration plans zero requests for fetched posts and one video download',
  async (version) => {
    const directory = await mkdtemp(
        join(tmpdir(), 'socialprune-raw-migration-'),
      ),
      path = join(directory, 'socialprune.sqlite');
    const data = fixtureWorkspace(['1001']);
    data.items[0]!.kind = 'reply';
    data.items[0]!.reference.replyToId = '101';
    const store = await SQLiteStore.open(path, { initial: data });
    await store.close();
    const db = new DatabaseSync(path);
    db.exec(
      'ALTER TABLE originals DROP COLUMN data;ALTER TABLE browser_attempts DROP COLUMN originalId;',
    );
    db.prepare('INSERT INTO originals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(
      '101',
      'fetched',
      FIXTURE.now,
      RAW_FIXTURE.text,
      RAW_FIXTURE.user.name,
      RAW_FIXTURE.user.screen_name,
      '[]',
      null,
      null,
      JSON.stringify({ ...RAW_FIXTURE, quoted_tweet: undefined }),
      'unknown',
      'not-stored',
    );
    db.exec(`PRAGMA user_version=${version};`);
    db.close();
    try {
      const upgraded = await SQLiteStore.open(path);
      const original = await upgraded.read((tx) => tx.originals.get('101'));
      expect(original?.textCompleteness).toBe('truncated');
      expect(original?.media[0]?.url).toBe(
        'https://video.twimg.com/generated.mp4',
      );
      await upgraded.close();
      const result = await fetchOriginals({
        workspace: directory,
        account: FIXTURE.account.key,
        dryRun: true,
        now: () => new Date(FIXTURE.now),
        signal: new AbortController().signal,
      });
      expect(result.data).toMatchObject({
        planned: 0,
        attempted: 0,
        videosPlanned: 1,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

async function preservationServer() {
  const requests: string[] = [];
  const postIds: string[] = [];
  let origin = '';
  const mediaDetails = () => [
    {
      type: 'photo' as const,
      media_url_https: origin + '/generated-photo.png',
      ext_alt_text: null,
      video_info: { duration_millis: null, variants: [] },
    },
    ...(['video', 'animated_gif'] as const).map((type) => ({
      type,
      media_url_https: origin + '/generated-poster.png',
      ext_alt_text: null,
      video_info: {
        duration_millis: 1200,
        variants: [
          {
            content_type: 'video/mp4' as const,
            url: origin + '/generated-video.mp4',
          },
        ],
      },
    })),
  ];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '', origin);
    requests.push(url.pathname);
    if (url.pathname === '/tweet-result') {
      postIds.push(url.searchParams.get('id') ?? '');
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          text: 'Generated anonymous replacement',
          user: { name: 'Generated author', screen_name: 'generated_author' },
          photos: [{ url: origin + '/generated-photo.png' }],
          mediaDetails: mediaDetails(),
        }),
      );
    } else {
      const video = url.pathname === '/generated-video.mp4';
      response.writeHead(200, {
        'Content-Type': video ? 'video/mp4' : 'image/png',
      });
      response.end(
        Buffer.from(
          video
            ? GATED_MEDIA_FIXTURE.mp4Base64
            : DISPLAY_COMPARISON_FIXTURE.pngBase64,
          'base64',
        ),
      );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Generated preservation server did not listen.');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    requests,
    postIds,
    mediaDetails,
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    deps: {
      ...productionMedia,
      origin,
      free: () => Promise.resolve(10 * 1024 ** 3),
      sleep: () => Promise.resolve(),
    },
  };
}

test.each([
  { anonymous: 'failed', signedIn: 'read', gated: true },
  { anonymous: 'fetched', signedIn: 'read', gated: true },
  { anonymous: 'not-found', signedIn: 'read', gated: true },
  { anonymous: 'tombstone', signedIn: 'read', gated: true },
  { anonymous: null, signedIn: 'read', gated: true },
  { anonymous: 'failed', signedIn: 'read', gated: false },
  { anonymous: 'failed', signedIn: 'not-found', gated: false },
  { anonymous: 'failed', signedIn: 'tombstone', gated: false },
  { anonymous: 'failed', signedIn: 'unavailable', gated: false },
] as const)(
  'anonymous fetch preserves a signed-in $signedIn record with anonymous $anonymous and gated=$gated over real sockets',
  async ({ anonymous, signedIn, gated }) => {
    const fake = await preservationServer();
    const directory = await mkdtemp(
      join(tmpdir(), 'socialprune-signed-in-preservation-'),
    );
    const path = join(directory, 'socialprune.sqlite');
    const initial = fixtureWorkspace(['1001']);
    initial.items[0]!.kind = 'reply';
    initial.items[0]!.reference.replyToId = '910';
    initial.originals = [
      model.migrateOriginal({
        id: '910',
        status: anonymous ?? 'failed',
        fetchedAt: FIXTURE.now,
        text: 'Generated earlier anonymous text',
        authorName: 'Generated earlier author',
        authorHandle: 'generated_earlier',
        photos: [],
        quotedId: null,
        parentId: null,
        raw: { error: 'Generated earlier anonymous answer' },
        textCompleteness: 'unknown',
        video: null,
      }),
    ];
    if (anonymous === null) initial.originals[0]!.anonymous = null;
    initial.counts.originals = 1;
    let store: SQLiteStore | undefined;
    try {
      store = await SQLiteStore.open(path, { initial });
      const writer = new OriginalsFillWriter(store);
      const runId = 'generated-preservation-run';
      const attemptId = 'generated-preservation-attempt';
      await writer.startRun({
        runId,
        accountKey: FIXTURE.account.key,
        planHash: 'a'.repeat(64),
        canary: true,
        startedAt: FIXTURE.now,
      });
      await writer.sending({
        runId,
        attemptId,
        originalId: '910',
        at: FIXTURE.now,
      });
      const projected = extract(gatedMediaAnswer('910'), '910', {
        instruction: null,
      });
      if (projected.kind !== 'read')
        throw new Error('Generated gated fixture was not read.');
      const candidate = gated
        ? projected.post
        : {
            ...projected.post,
            media: [
              {
                ...projected.post.media[0]!,
                url: fake.origin + '/generated-video.mp4',
              },
            ],
            signedInRecord: {
              ...projected.post.signedInRecord!,
              mediaDetails: [fake.mediaDetails()[1]!],
            },
          };
      const old = initial.originals[0]!;
      await writer.settle(
        { attemptId, state: signedIn, at: FIXTURE.now, code: null },
        [
          {
            ...(signedIn === 'read' ? candidate : old),
            anonymous: old.anonymous,
            raw: old.raw,
            signedIn: {
              status: signedIn,
              at: FIXTURE.now,
              runId,
              attemptId,
              reason: signedIn === 'read' ? null : 'Generated notice',
            },
          },
        ],
      );
      await writer.endRun({
        runId,
        endedAt: FIXTURE.now,
        endReason: 'canary',
        bodyShapes: {},
        profileReport: {
          accountBefore: FIXTURE.account.handle,
          accountAfter: FIXTURE.account.handle,
          extensionsBefore: 0,
          extensionsAfter: 0,
          changedFiles: [],
          unexpectedRequests: [],
        },
      });
      const before = await store.read((tx) => tx.originals.get('910'));
      const journal = await store.browserJournal();
      await store.close();
      store = undefined;
      const input = {
        workspace: directory,
        signal: new AbortController().signal,
        now: () => new Date(FIXTURE.now),
      };
      const dry = await fetchOriginals(
        { ...input, dryRun: true },
        { baseUrl: fake.origin, media: fake.deps },
      );
      const fetched = await fetchOriginals(input, {
        baseUrl: fake.origin,
        media: fake.deps,
      });
      const afterStore = await SQLiteStore.open(path, { readOnly: true });
      try {
        const after = await afterStore.read((tx) => tx.originals.get('910'));
        expect(after).toEqual(before);
        expect(await afterStore.browserJournal()).toEqual(journal);
        expect(dry.data).toMatchObject({
          planned: 0,
          videosPlanned: 0,
          attempted: 0,
        });
        expect(fetched.data).toMatchObject({
          planned: 0,
          attempted: 0,
          remaining: 0,
          stoppedAfterFailures: false,
        });
        expect(
          fake.requests.filter((request) => request === '/tweet-result'),
        ).toEqual([]);
        expect(
          fake.requests.filter((request) => request !== '/tweet-result'),
        ).toEqual([]);
        if (gated)
          expect(after?.media[0]).toMatchObject({
            status: 'not-stored',
            url: null,
          });
      } finally {
        await afterStore.close();
      }
      await fetchOriginals(input, { baseUrl: fake.origin, media: fake.deps });
      expect(fake.requests).toEqual([]);
    } finally {
      await store?.close();
      await fake.stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('null-URL not-stored media entries keep their honest status and ignore download metadata over real sockets', async () => {
  const fake = await preservationServer();
  const directory = await mkdtemp(
    join(tmpdir(), 'socialprune-null-media-preservation-'),
  );
  try {
    const original = model.migrateOriginal({
      id: '910',
      status: 'fetched',
      fetchedAt: FIXTURE.now,
      text: 'Generated media gate',
      authorName: 'Generated author',
      authorHandle: 'generated_author',
      photos: [],
      quotedId: null,
      parentId: null,
      raw: { mediaDetails: fake.mediaDetails() },
      textCompleteness: 'unknown',
      video: null,
    });
    original.media.forEach((entry) => {
      entry.status = 'not-stored';
      entry.url = null;
    });
    const before = structuredClone(original);
    const budget = {
      videoBytes: 1024 ** 3,
      runBytes: 20 * 1024 ** 3,
      used: 0,
      lastStart: 0,
      failures: 0,
    };
    await storeOriginalMedia(
      directory,
      original,
      new SyndicationClient({ baseUrl: fake.origin }),
      budget,
      new AbortController().signal,
      fake.deps,
    );
    expect(original).toEqual(before);
    expect(fake.requests).toEqual([]);
    expect(budget).toEqual({
      videoBytes: 1024 ** 3,
      runBytes: 20 * 1024 ** 3,
      used: 0,
      lastStart: 0,
      failures: 0,
    });
  } finally {
    await fake.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('anonymous fetch still traverses parent and quote links from a preserved signed-in result', async () => {
  const fake = await preservationServer();
  const directory = await mkdtemp(
    join(tmpdir(), 'socialprune-preserved-links-'),
  );
  const path = join(directory, 'socialprune.sqlite');
  let store: SQLiteStore | undefined;
  try {
    const initial = fixtureWorkspace(['1001']);
    initial.items[0]!.kind = 'reply';
    initial.items[0]!.reference.replyToId = '910';
    initial.originals = [
      model.migrateOriginal({
        id: '910',
        status: 'failed',
        fetchedAt: FIXTURE.now,
        text: null,
        authorName: null,
        authorHandle: null,
        photos: [],
        quotedId: null,
        parentId: null,
        raw: null,
        textCompleteness: 'unknown',
        video: null,
      }),
    ];
    initial.counts.originals = 1;
    store = await SQLiteStore.open(path, { initial });
    const writer = new OriginalsFillWriter(store);
    const runId = 'generated-linked-run',
      attemptId = 'generated-linked-attempt';
    await writer.startRun({
      runId,
      accountKey: FIXTURE.account.key,
      planHash: 'a'.repeat(64),
      canary: true,
      startedAt: FIXTURE.now,
    });
    await writer.sending({
      runId,
      attemptId,
      originalId: '910',
      at: FIXTURE.now,
    });
    const projected = extract(gatedMediaAnswer('910'), '910', {
      instruction: null,
    });
    if (projected.kind !== 'read')
      throw new Error('Generated gated fixture was not read.');
    await writer.settle(
      { attemptId, state: 'read', at: FIXTURE.now, code: null },
      [
        {
          ...projected.post,
          media: projected.post.media.map((entry) => ({
            ...entry,
            status: 'run-cap' as const,
          })),
          parentId: '911',
          quotedId: '912',
          anonymous: initial.originals[0]!.anonymous,
          signedIn: {
            status: 'read',
            at: FIXTURE.now,
            runId,
            attemptId,
            reason: null,
          },
        },
      ],
    );
    const before = await store.read((tx) => tx.originals.get('910'));
    await store.close();
    store = undefined;
    const input = {
      workspace: directory,
      signal: new AbortController().signal,
      now: () => new Date(FIXTURE.now),
    };
    expect(
      (
        await fetchOriginals(
          { ...input, dryRun: true },
          { baseUrl: fake.origin, media: fake.deps },
        )
      ).data.planned,
    ).toBe(2);
    const result = await fetchOriginals(input, {
      baseUrl: fake.origin,
      media: fake.deps,
    });
    expect(result.data).toMatchObject({ planned: 2, attempted: 2, fetched: 2 });
    expect(fake.postIds).toEqual(['911', '912']);
    store = await SQLiteStore.open(path, { readOnly: true });
    expect(await store.read((tx) => tx.originals.get('910'))).toEqual(before);
    for (const id of ['911', '912'])
      expect(
        (await store.read((tx) => tx.originals.get(id)))?.media.every(
          (entry) => entry.status === 'stored',
        ),
      ).toBe(true);
  } finally {
    await store?.close();
    await fake.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
