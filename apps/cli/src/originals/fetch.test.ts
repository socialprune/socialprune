import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  mkdir,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { expect, test, vi } from 'vitest';
import {
  createWorkspace,
  readWorkspace,
  records,
} from '@socialprune/core/workspace/store';
import { createMemoryStore } from '@socialprune/core/workspace/memory-store';
import {
  createBackup,
  readBackup,
  restoreBackup,
} from '@socialprune/core/workspace/backup';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { browserWorkspace } from '../workspace/test/inputs.ts';
import { fetchOriginals } from './fetch.ts';
import { SyndicationClient, syndicationToken } from './syndication.ts';
import { fakeSyndication, fixture } from './test/server.ts';
import { networkRecorder } from '../cli/test/network-recorder.ts';
import { executeCli } from '../cli/adapter.ts';
import { createNodeContext } from '../cli/node-context.ts';

async function* chunks(value: string | Uint8Array) {
  yield await Promise.resolve(value);
}
function fetchUrl(value: Parameters<typeof fetch>[0]): URL {
  return new URL(
    value instanceof Request
      ? value.url
      : value instanceof URL
        ? value.href
        : value,
  );
}

async function workspace(ids: string[] = fixture.references) {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-originals-'));
  const file = join(directory, 'socialprune.sqlite');
  const data = browserWorkspace();
  data.items = ids.map((id, index) => ({
    ...data.items[0]!,
    id: `x:${1000 + index}`,
    kind: index % 2 ? ('quote' as const) : ('reply' as const),
    reference: {
      ...data.items[0]!.reference,
      replyToId: index % 2 ? null : id,
      quotedId: index % 2 ? id : null,
    },
  }));
  data.submissions = [];
  data.assessments = [];
  data.decisionEvents = [];
  data.outcomeEvents = [];
  data.counts = {
    imports: 1,
    items: ids.length,
    submissions: 0,
    assessments: 0,
    decisionEvents: 0,
    outcomeEvents: 0,
  };
  data.imports[0]!.itemCount = ids.length;
  const store = await SQLiteStore.open(file, { initial: data });
  await store.close();
  return {
    directory,
    file,
    input: {
      workspace: directory,
      signal: new AbortController().signal,
      now: () => new Date('2026-10-11T00:00:00Z'),
    },
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
}
test('token matches a fixed pair derived once from the tagged upstream formula, not the implementation under test', () => {
  // fetch-tweet.ts has no example token. This pair was computed separately on
  // 2026-10-11 from react-tweet@3.3.1's published getToken formula.
  expect(syndicationToken(fixture.tokenPair.id)).toBe(fixture.tokenPair.token);
  expect(() => syndicationToken('../private')).toThrow();
});
test('the generated PNG photo fixture has valid chunk CRCs in strict decoders', () => {
  const bytes = Buffer.from(fixture.pngBase64, 'base64');
  for (let position = 8; position < bytes.length;) {
    const length = bytes.readUInt32BE(position);
    expect(bytes.readUInt32BE(position + 8 + length)).toBe(
      crc32(bytes.subarray(position + 4, position + 8 + length)),
    );
    position += length + 12;
  }
});

test('real local HTTP, pacing, all statuses, media, duplicate references, idempotency and validated backup roundtrip', async () => {
  const fake = await fakeSyndication();
  const data = await workspace([...fixture.references, fixture.references[0]!]);
  const nativeFetch = globalThis.fetch;
  const outbound: string[] = [];
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((url, options) => {
      const target = fetchUrl(url);
      outbound.push(target.origin);
      if (target.origin !== fake.origin) throw new Error('REAL_HOST_FORBIDDEN');
      return nativeFetch(url, options);
    });
  try {
    const result = await fetchOriginals(data.input, { baseUrl: fake.origin });
    expect(result.data).toMatchObject({
      referenced: 5,
      attempted: fixture.expectedExpandedCount,
      fetched: 4,
      notFound: 2,
      tombstone: 1,
      failed: 0,
      photosStored: 2,
      photosFailed: 0,
      videosNotStored: 1,
      remaining: 0,
    });
    const tweets = fake.requests.filter(
      ({ url }) => url.pathname === '/tweet-result',
    );
    expect(tweets.map(({ url }) => url.searchParams.get('id'))).toEqual(
      fixture.expectedRequests,
    );
    expect(tweets[0]!.url.searchParams.get('token')).toBe(
      fixture.tokenPair.token,
    );
    for (let i = 1; i < tweets.length; i++)
      expect(tweets[i]!.at - tweets[i - 1]!.at).toBeGreaterThanOrEqual(1000);
    const store = await SQLiteStore.open(data.file);
    const values = await store.read((tx) => records(tx.originals));
    expect(values.map(({ anonymous }) => anonymous?.status)).toEqual(
      fixture.expectedStatuses,
    );
    expect(values[0]).toMatchObject({
      text: fixture.fetched.text,
      authorName: fixture.fetched.user.name,
      authorHandle: fixture.fetched.user.screen_name,
      quotedId: fixture.fetched.quoted_tweet.id_str,
      parentId: fixture.fetched.parent.id_str,
      textCompleteness: 'truncated',
    });
    for (const file of ['1.png', '2.png'])
      expect(
        await readFile(
          join(data.directory, 'originals', fixture.references[0]!, file),
        ),
      ).toEqual(Buffer.from(fixture.pngBase64, 'base64'));
    const backup = createBackup(store);
    const chunks = [];
    for await (const part of backup.chunks) chunks.push(part);
    const document = await readBackup(
      (async function* () {
        yield await Promise.resolve(Buffer.concat(chunks));
      })(),
    );
    expect(document.originals).toEqual(values);
    expect(document.counts.originals).toBe(fixture.expectedExpandedCount);
    const restored = createMemoryStore();
    await restoreBackup(
      restored,
      (async function* () {
        yield await Promise.resolve(Buffer.concat(chunks));
      })(),
    );
    expect((await restored.read(readWorkspace)).originals).toEqual(values);
    await restored.close();
    await store.close();
    const before = fake.requests.length;
    expect(
      (await fetchOriginals(data.input, { baseUrl: fake.origin })).data,
    ).toMatchObject({ planned: 0, attempted: 0 });
    expect(fake.requests).toHaveLength(before);
    expect([...new Set(outbound)]).toEqual([fake.origin]);
  } finally {
    spy.mockRestore();
    await fake.stop();
    await data.dispose();
  }
}, 20_000);

test('five consecutive failures stop without retries; each failed attempt stays stored', async () => {
  const fake = await fakeSyndication('fail');
  const data = await workspace(
    Array.from({ length: 7 }, (_, i) => String(900001 + i)),
  );
  try {
    expect(
      (await fetchOriginals(data.input, { baseUrl: fake.origin })).data,
    ).toMatchObject({
      attempted: 5,
      failed: 5,
      stoppedAfterFailures: true,
      remaining: 2,
    });
    expect(fake.requests).toHaveLength(5);
    const store = await SQLiteStore.open(data.file, { readOnly: true });
    expect(
      (await store.read((tx) => records(tx.originals))).map(
        ({ anonymous }) => anonymous?.status,
      ),
    ).toEqual(Array<string>(5).fill('failed'));
    await store.close();
  } finally {
    await fake.stop();
    await data.dispose();
  }
}, 15_000);
test('a not-found response resets the failure streak', async () => {
  const fake = await fakeSyndication('reset');
  const data = await workspace(
    Array.from({ length: 9 }, (_, i) => String(900001 + i)),
  );
  try {
    expect(
      (await fetchOriginals(data.input, { baseUrl: fake.origin })).data,
    ).toMatchObject({
      attempted: 8,
      failed: 7,
      notFound: 1,
      stoppedAfterFailures: true,
      remaining: 1,
    });
    expect(fake.requests).toHaveLength(8);
  } finally {
    await fake.stop();
    await data.dispose();
  }
}, 20_000);
test('dry-run command emits one envelope with counts first, no files changed and no outbound surface', async () => {
  const data = await workspace();
  const before = await readFile(data.file);
  const recorder = networkRecorder();
  let stdout = '',
    stderr = '';
  try {
    const context = createNodeContext(
      {
        write: (text) => {
          stdout += text;
        },
      },
      {
        write: (text) => {
          stderr += text;
        },
      },
    );
    expect(
      await executeCli(
        [
          'originals',
          'fetch',
          '--workspace',
          data.directory,
          '--dry-run',
          '--json',
          '--limit',
          '2',
        ],
        context,
      ),
    ).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      command: 'originals.fetch',
      status: 'ok',
      data: {
        dryRun: true,
        referenced: 5,
        stored: 0,
        planned: 2,
        attempted: 0,
      },
    });
    expect(stderr.split('\n')[0]).toBe(
      '5 referenced originals; 0 already stored; 2 to fetch.',
    );
    expect(recorder.calls).toEqual([]);
    expect(await readFile(data.file)).toEqual(before);
    expect(await readdir(data.directory)).toEqual(['socialprune.sqlite']);
  } finally {
    recorder.restore();
    await data.dispose();
  }
});
test('the explicit live command has a single error envelope on recorded failures, never exit4 or an ok envelope', async () => {
  const fake = await fakeSyndication('fail');
  const data = await workspace(['900001']);
  let stdout = '',
    stderr = '';
  try {
    const context = createNodeContext(
      {
        write: (text) => {
          stdout += text;
        },
      },
      {
        write: (text) => {
          stderr += text;
        },
      },
    );
    const result = await executeCli(
      ['originals', 'fetch', '--workspace', data.directory, '--json'],
      {
        ...context,
        services: {
          ...context.services,
          workspace: {
            ...context.services.workspace!,
            fetchOriginals: (input) =>
              fetchOriginals(input, { baseUrl: fake.origin }),
          },
        },
      },
    );
    expect(result).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({
      command: 'originals.fetch',
      status: 'error',
      error: { code: 'ORIGINALS_FAILED', exitCode: 1 },
    });
    expect(stderr).toContain('1 originals recorded; 1 fetches');
    expect(fake.requests).toHaveLength(1);
  } finally {
    await fake.stop();
    await data.dispose();
  }
});
for (const mode of ['redirect', 'foreign-photo', 'bad-photo'] as const)
  test(`${mode} never redirects or downloads from a real host`, async () => {
    const fake = await fakeSyndication(mode);
    const data = await workspace(['900001']);
    const native = globalThis.fetch;
    const targets: string[] = [];
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((url, options) => {
        targets.push(fetchUrl(url).href);
        if (fetchUrl(url).origin !== fake.origin)
          throw new Error('REAL_HOST_FORBIDDEN');
        return native(url, options);
      });
    try {
      const result = await fetchOriginals(data.input, { baseUrl: fake.origin });
      expect(result.data).toMatchObject(
        mode === 'redirect'
          ? { failed: 1 }
          : { fetched: 3, photosFailed: 2, photosStored: 0 },
      );
      expect(targets.every((url) => new URL(url).origin === fake.origin)).toBe(
        true,
      );
      expect(await readdir(data.directory)).toEqual(['socialprune.sqlite']);
      expect(
        () => new SyndicationClient({ baseUrl: 'https://example.invalid' }),
      ).toThrow();
    } finally {
      spy.mockRestore();
      await fake.stop();
      await data.dispose();
    }
  });
test('photo directories cannot follow a link out of the workspace', async () => {
  const fake = await fakeSyndication();
  const data = await workspace(['900001']);
  const outside = join(data.directory, 'generated-outside');
  await mkdir(outside);
  await symlink(outside, join(data.directory, 'originals'), 'junction');
  try {
    await expect(
      fetchOriginals(data.input, { baseUrl: fake.origin }),
    ).rejects.toThrow('ORIGINAL_PATH');
    expect(await readdir(outside)).toEqual([]);
  } finally {
    await fake.stop();
    await data.dispose();
  }
});
test('layout1 read-only dryrun stays unchanged; writable migration saves the original database before DDL', async () => {
  const data = await workspace(['900001']);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(data.file);
  db.exec('DROP TABLE originals; PRAGMA user_version=1;');
  db.close();
  const bytes = await readFile(data.file);
  try {
    await fetchOriginals({ ...data.input, dryRun: true });
    expect(await readFile(data.file)).toEqual(bytes);
    expect(await readdir(data.directory)).toEqual(['socialprune.sqlite']);
    const store = await SQLiteStore.open(data.file);
    expect(await store.read((tx) => records(tx.originals))).toEqual([]);
    await store.close();
    const previous = (await readdir(data.directory)).find((file) =>
      file.endsWith('.before-migration.sqlite'),
    )!;
    expect(await readFile(join(data.directory, previous))).toEqual(bytes);
  } finally {
    await data.dispose();
  }
});
test('original backup rejects forged counts, duplicates and paths, while old v2 needs no originals', async () => {
  const initial = createWorkspace();
  expect(await readBackup(chunks(JSON.stringify(initial)))).toEqual(initial);
  const original = {
    id: '900001',
    status: 'not-found',
    fetchedAt: '2026-10-11T00:00:00Z',
    text: null,
    authorName: null,
    authorHandle: null,
    photos: [],
    quotedId: null,
    parentId: null,
    raw: null,
    textCompleteness: 'unknown',
    video: null,
  };
  for (const change of [
    { originals: [original], counts: initial.counts },
    {
      originals: [original, original],
      counts: { ...initial.counts, originals: 2 },
    },
    {
      originals: [
        {
          ...original,
          photos: [
            { url: 'generated', file: '../../private.png', status: 'stored' },
          ],
        },
      ],
      counts: { ...initial.counts, originals: 1 },
    },
  ]) {
    const text = JSON.stringify({ ...initial, ...change });
    await expect(readBackup(chunks(text))).rejects.toBeDefined();
    const stage = createMemoryStore();
    await expect(restoreBackup(stage, chunks(text))).rejects.toBeDefined();
    await stage.close();
  }
});
