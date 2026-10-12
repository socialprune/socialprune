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
    await new Promise<void>((resolve) =>
      server.listen(4236, '127.0.0.1', resolve),
    );
    try {
      const original = await new SyndicationClient({
        baseUrl: 'http://127.0.0.1:4236',
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
