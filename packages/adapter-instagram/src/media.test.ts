import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { createMemoryArchive, importArchive } from '@socialprune/core';
import type { ArchiveReader, Item } from '@socialprune/core';
import { MAP_KEY, parseComment } from './format.ts';
import { instagramAdapter } from './index.ts';

const MEDIA_KEY = ['media', 'list', 'data'].join('_');
const archiveName = 'instagram-synth_media-2026-07-31-c7d8e9';
const postPath = 'your_instagram_activity/comments/post_comments_1.json';
const seconds = 1_753_920_000;
const createdAt = '2025-07-31T00:00:00.000Z';
const owner = 'synth_media_owner';
const gif = 'media/other/synthetic_gif_01.gif';
const sticker = 'media/other/synthetic_sticker_02.webp';

function commentRow(
  options: {
    text?: string;
    owner?: string | null;
    media?: unknown;
    fields?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return {
    ...(Object.hasOwn(options, 'media') ? { [MEDIA_KEY]: options.media } : {}),
    [MAP_KEY]: {
      ...(options.text === undefined
        ? {}
        : { Comment: { value: options.text } }),
      ...(options.owner === null
        ? {}
        : { 'Media Owner': { value: options.owner ?? owner } }),
      Time: { timestamp: seconds },
      ...options.fields,
    },
  };
}

test('media-only shape A preserves owner and time without copying its URI', () => {
  expect(parseComment(commentRow({ media: [{ uri: gif }] }))).toEqual({
    text: '',
    createdAt,
    ownerHandle: owner,
    mediaCount: 1,
  });
});

test('media-only shape B has a null owner and counts every media entry', () => {
  expect(
    parseComment(
      commentRow({ owner: null, media: [{ uri: gif }, { uri: sticker }] }),
    ),
  ).toEqual({ text: '', createdAt, ownerHandle: null, mediaCount: 2 });
});

test('text comments distinguish an empty media list from an absent one', () => {
  const text = 'Invented comment without attachments.';
  expect(parseComment(commentRow({ text, media: [] }))).toEqual({
    text,
    createdAt,
    ownerHandle: owner,
    mediaCount: 0,
  });
  expect(parseComment(commentRow({ text }))).toEqual({
    text,
    createdAt,
    ownerHandle: owner,
  });
});

test('text plus media uses the typed comment slot and preserves translated aliases', () => {
  const text = 'Invented comment with a GIF.';
  expect(parseComment(commentRow({ text, media: [{ uri: gif }] }))).toEqual({
    text,
    createdAt,
    ownerHandle: owner,
    mediaCount: 1,
  });
  expect(
    parseComment({
      [MEDIA_KEY]: [{ uri: gif }, { uri: sticker }],
      [MAP_KEY]: {
        Kommentar: { value: 'Erfundener Kommentar mit Medien.' },
        Medieninhaber: { value: owner },
        Zeit: { timestamp: seconds },
      },
    }),
  ).toEqual({
    text: 'Erfundener Kommentar mit Medien.',
    createdAt,
    ownerHandle: owner,
    mediaCount: 2,
  });
});

test('missing content stays rejected and media never turns an unknown string into a comment', () => {
  for (const media of [undefined, [], null, {}, 'not an array']) {
    expect(parseComment(commentRow({ media }))).toBeNull();
    expect(parseComment(commentRow({ owner: null, media }))).toBeNull();
  }
  expect(parseComment(commentRow())).toBeNull();
  expect(
    parseComment(
      commentRow({
        media: [{ uri: gif }],
        fields: {
          'Unknown string slot': { value: 'Do not guess this comment.' },
        },
      }),
    ),
  ).toBeNull();
  expect(
    parseComment(
      commentRow({
        media: [{ uri: gif }],
        fields: { Comment: { value: 19 } },
      }),
    ),
  ).toBeNull();
  expect(
    parseComment(
      commentRow({
        media: [{ uri: gif }],
        fields: { Time: { timestamp: 'not seconds' } },
      }),
    ),
  ).toBeNull();
  expect(parseComment(commentRow({ media: [{ uri: gif }] }))).not.toBeNull();
});

function combine(readers: ArchiveReader[]): ArchiveReader {
  const owners = new Map(
    readers.flatMap((reader) =>
      reader.list().map((entry) => [entry, reader] as const),
    ),
  );
  return {
    archives: readers.flatMap((reader) => [...reader.archives]),
    rejectedEntries: 0,
    list: () => [...owners.keys()],
    readText: (entry, options) => owners.get(entry)!.readText(entry, options),
    streamText: (entry, options) =>
      owners.get(entry)!.streamText(entry, options),
    async close() {
      await Promise.all(readers.map((reader) => reader.close()));
    },
  };
}

async function imported(archive: ArchiveReader) {
  const items: Item[] = [];
  try {
    const result = await importArchive(archive, [instagramAdapter], {
      onItems(batch) {
        items.push(...batch);
      },
      batchSize: 1,
    });
    return { result, items };
  } finally {
    await archive.close();
  }
}

// The oracle comes from invented fields and Node crypto, never the adapter.
function expectedId(ownerHandle: string | null, ordinal = 1): string {
  const parts = ['instagram:synth_media', createdAt, ownerHandle ?? '', ''];
  if (ordinal > 1) parts.push(String(ordinal));
  return (
    'instagram:' +
    createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  );
}

test('import keeps readable media comments after a contentless row and never opens or reports media URIs', async () => {
  const rows = [
    commentRow({ media: [{ uri: gif }] }),
    commentRow(),
    commentRow({ owner: null, media: [{ uri: sticker }] }),
    commentRow({
      text: 'Invented text with an image.',
      media: [{ uri: 'media/other/synthetic_image_03.png' }],
    }),
    commentRow({ text: 'Invented text without media.', media: [] }),
    commentRow({ text: 'Invented text without a media key.' }),
  ];
  const archive = createMemoryArchive(
    archiveName,
    {
      [postPath]: JSON.stringify(rows),
    },
    { chunkSize: 13 },
  );
  const reads: string[] = [];
  const tracked: ArchiveReader = {
    archives: archive.archives,
    rejectedEntries: archive.rejectedEntries,
    list: () => archive.list(),
    readText(entry, options) {
      reads.push(entry.path);
      return archive.readText(entry, options);
    },
    streamText(entry, options) {
      reads.push(entry.path);
      return archive.streamText(entry, options);
    },
    close: () => archive.close(),
  };
  const { result, items } = await imported(tracked);
  expect(result.status).toBe('partial');
  expect(result.records[0]?.itemCount).toBe(5);
  expect(
    result.records[0]?.diagnostics.find(
      (diagnostic) => diagnostic.category === 'post-comments',
    ),
  ).toMatchObject({ status: 'unreadable', count: 5 });
  expect(items.map((item) => item.mediaCount)).toEqual([1, 1, 1, 0, null]);
  expect(items.map((item) => item.provenance.index)).toEqual([0, 2, 3, 4, 5]);
  expect(items[0]?.text).toBe('');
  expect(items[1]?.reference.ownerHandle).toBeNull();
  expect(items.every((item) => item.url === null)).toBe(true);
  expect(reads).toEqual([postPath]);
  for (const row of rows) {
    const media = row[MEDIA_KEY] as Array<{ uri: string }> | undefined;
    for (const { uri } of media ?? [])
      expect(JSON.stringify({ result, items })).not.toContain(uri);
  }
});

test('media-only comments keep ordinal IDs and later exports cannot change those IDs through media filenames', async () => {
  const rows = [
    commentRow({ media: [{ uri: gif }] }),
    commentRow({
      media: [{ uri: sticker }, { uri: 'media/other/synthetic_image_03.png' }],
    }),
  ];
  const first = await imported(
    createMemoryArchive(archiveName, {
      [postPath]: JSON.stringify(rows),
    }),
  );
  expect(first.result.status).toBe('ok');
  expect(first.items).toHaveLength(2);
  expect(first.items.map((item) => item.id)).toEqual([
    expectedId(owner),
    expectedId(owner, 2),
  ]);
  expect(first.items.map((item) => item.mediaCount)).toEqual([1, 2]);
  const later = await imported(
    createMemoryArchive('instagram-synth_media-2026-08-31-f1a2b3', {
      [postPath]: JSON.stringify(
        rows.map((row, index) => ({
          ...row,
          [MEDIA_KEY]: [{ uri: `media/other/synthetic_later_${index}.gif` }],
        })),
      ),
    }),
  );
  expect(later.result.status).toBe('ok');
  expect(later.items.map((item) => item.id)).toEqual(
    first.items.map((item) => item.id),
  );
  expect(later.items.map((item) => item.mediaCount)).toEqual([1, 1]);
});

test('split media-only overlap merges by maximum multiplicity despite different media URI values', async () => {
  const archive = combine([
    createMemoryArchive(`${archiveName}_1`, {
      [postPath]: JSON.stringify([
        commentRow({ media: [{ uri: gif }] }),
        commentRow({ media: [{ uri: sticker }] }),
      ]),
    }),
    createMemoryArchive(`${archiveName}_2`, {
      [postPath]: JSON.stringify([
        commentRow({
          media: [{ uri: 'media/other/synthetic_overlap_01.gif' }],
        }),
        commentRow({
          media: [{ uri: 'media/other/synthetic_overlap_02.gif' }],
        }),
        commentRow({ media: [{ uri: 'media/other/synthetic_extra_03.gif' }] }),
      ]),
    }),
  ]);
  const { result, items } = await imported(archive);
  expect(result.status).toBe('ok');
  expect(result.records[0]?.accounts).toEqual([
    { key: 'instagram:synth_media', handle: 'synth_media' },
  ]);
  expect(items).toHaveLength(3);
  expect(items.map((item) => item.id)).toEqual([
    expectedId(owner),
    expectedId(owner, 2),
    expectedId(owner, 3),
  ]);
  expect(items.map((item) => item.provenance.archive)).toEqual([
    `${archiveName}_1`,
    `${archiveName}_1`,
    `${archiveName}_2`,
  ]);
});

test('D34 unknown comment label remains text with an empty media list', () => {
  const text = 'Invented text with an unknown translated label.';
  expect(
    parseComment(
      commentRow({
        media: [],
        fields: { 'Unknown comment label': { value: text } },
      }),
    ),
  ).toEqual({ text, createdAt, ownerHandle: owner, mediaCount: 0 });
});

test('D34 unknown comment label remains text without a media key', () => {
  const text = 'Invented text with an unknown translated label.';
  expect(
    parseComment(
      commentRow({ fields: { 'Unknown comment label': { value: text } } }),
    ),
  ).toEqual({ text, createdAt, ownerHandle: owner });
});

test('D34 unknown owner with positive media is not guessed into comment text', () => {
  expect(
    parseComment(
      commentRow({
        owner: null,
        media: [{ uri: gif }],
        fields: { 'Unknown owner label': { value: owner } },
      }),
    ),
  ).toBeNull();
});

test('D34 unknown comment with a known owner and positive media is ambiguous', () => {
  expect(
    parseComment(
      commentRow({
        media: [{ uri: gif }],
        fields: {
          'Unknown comment label': { value: 'Invented ambiguous text.' },
        },
      }),
    ),
  ).toBeNull();
});
