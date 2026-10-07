import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { createMemoryArchive, importArchive } from '@socialprune/core';
import type { Item } from '@socialprune/core';
import * as format from './format.ts';
import { instagramAdapter } from './index.ts';

const MEDIA_KEY = ['media', 'list', 'data'].join('_');
const seconds = 1_753_920_000;
const createdAt = '2025-07-31T00:00:00.000Z';
const owner = 'synth_placeholder_owner';

function referenceCount(entries: readonly unknown[] | null): number | null {
  // Namespace lookup lets the test-first run report each missing-export case
  // against 3426e41, rather than failing the whole file at module loading.
  const count = Reflect.get(format, 'mediaReferenceCount') as
    ((entries: readonly unknown[] | null) => number | null) | undefined;
  expect(count).toBeTypeOf('function');
  return count!(entries);
}

test.each([
  ['HTTPS GIF', [{ uri: 'https://media.example.com/a.gif' }], 1],
  ['HTTP GIF', [{ uri: 'http://media.example.com/a.gif' }], 1],
  ['relative folder path', [{ uri: 'media/other/x.gif' }], 1],
  ['relative basename extension', [{ uri: 'synthetic.gif' }], 1],
  ['empty URI', [{ uri: '' }], 0],
  ['absolute forward-slash path', [{ uri: '/abs/x.gif' }], 0],
  ['absolute backslash path', [{ uri: '\\abs\\x.gif' }], 0],
  ['colon in URI', [{ uri: 'x:y' }], 0],
  ['opaque token', [{ uri: 'token' }], 0],
  ['path containing space', [{ uri: 'a b/c.gif' }], 0],
  ['path containing tab', [{ uri: 'media/other/x\t.gif' }], 0],
  ['path containing NUL', [{ uri: 'media/other/x\u0000.gif' }], 0],
  ['path containing DEL', [{ uri: 'media/other/x\u007f.gif' }], 0],
  ['path containing C1 control', [{ uri: 'media/other/x\u0085.gif' }], 0],
  [
    'path containing Unicode whitespace',
    [{ uri: 'media/other/x\u00a0.gif' }],
    0,
  ],
  ['non-string URI', [{ uri: 17 }], 0],
  ['missing URI', [{}], 0],
  ['non-object media entry', [null, 'media/other/x.gif', 17], 0],
  ['non-HTTP protocol', [{ uri: 'data:image/gif;base64,synthetic' }], 0],
  ['HTTP scheme without a host', [{ uri: 'https://' }], 0],
  ['absent entries', null, null],
  ['empty entries', [], 0],
  [
    'mixed entries',
    [
      { uri: 'https://media.example.com/a.gif' },
      { uri: 'media/other/x.gif' },
      { uri: 'synthetic.png' },
      { uri: '' },
      { uri: '/abs/x.gif' },
      { uri: 'x:y' },
      { uri: 'token' },
      { uri: 'a b/c.gif' },
      { uri: false },
      {},
    ],
    3,
  ],
] as const)('D37 mediaReferenceCount: %s', (_name, entries, expected) => {
  expect(referenceCount(entries)).toBe(expected);
});

function row(options: {
  text?: string;
  unknownText?: string;
  owner?: string | null;
  entries: unknown[];
}): Record<string, unknown> {
  return {
    [MEDIA_KEY]: options.entries,
    [format.MAP_KEY]: {
      ...(options.text === undefined
        ? {}
        : { Comment: { value: options.text } }),
      ...(options.unknownText === undefined
        ? {}
        : { 'Unknown comment label': { value: options.unknownText } }),
      ...(options.owner === null
        ? {}
        : { 'Media Owner': { value: options.owner ?? owner } }),
      Time: { timestamp: seconds },
    },
  };
}

test('D37 text placeholder counts zero without removing text or copying its URI', () => {
  const text = 'Invented text with an opaque placeholder.';
  for (const uri of [
    '',
    'synthetic_placeholder_token',
    '/synthetic_absolute.gif',
  ]) {
    expect(format.parseComment(row({ text, entries: [{ uri }] }))).toEqual({
      text,
      createdAt,
      ownerHandle: owner,
      mediaCount: 0,
    });
  }
});

test('D37 media-only placeholder still imports with zero usable references', () => {
  for (const ownerHandle of [owner, null]) {
    expect(
      format.parseComment(row({ owner: ownerHandle, entries: [{ uri: '' }] })),
    ).toEqual({
      text: '',
      createdAt,
      ownerHandle,
      mediaCount: 0,
    });
  }
  expect(format.parseComment(row({ entries: [] }))).toBeNull();
});

test('D37 unknown text label accepts a placeholder but rejects usable-media ambiguity', () => {
  const text = 'Invented unknown-label text with a placeholder.';
  expect(
    format.parseComment(row({ unknownText: text, entries: [{ uri: '' }] })),
  ).toEqual({
    text,
    createdAt,
    ownerHandle: owner,
    mediaCount: 0,
  });
  expect(
    format.parseComment(
      row({
        unknownText: text,
        entries: [{ uri: 'https://media.example.com/ambiguous.gif' }],
      }),
    ),
  ).toBeNull();
});

test('D37 import preserves placeholder comments, ordinal IDs and URI exclusion', async () => {
  const text = 'Invented placeholder text.';
  const unknownText = 'Invented unknown-label placeholder text.';
  const rows = [
    row({ text, entries: [{ uri: '' }] }),
    row({ entries: [{ uri: '' }] }),
    row({
      entries: [{ uri: 'https://media.example.com/synthetic_different.gif' }],
    }),
    row({ unknownText, entries: [{ uri: '' }] }),
    row({ entries: [] }),
  ];
  const archive = createMemoryArchive(
    'instagram-synth_placeholder-2026-07-31-p1a2b3',
    {
      'your_instagram_activity/comments/post_comments_1.json':
        JSON.stringify(rows),
    },
  );
  const items: Item[] = [];
  try {
    const result = await importArchive(archive, [instagramAdapter], {
      onItems(batch) {
        items.push(...batch);
      },
    });
    expect(result.status).toBe('partial');
    expect(result.records[0]?.itemCount).toBe(4);
    expect(items.map((item) => item.text)).toEqual([text, '', '', unknownText]);
    expect(items.map((item) => item.mediaCount)).toEqual([0, 0, 1, 0]);
    expect(items.map((item) => item.provenance.index)).toEqual([0, 1, 2, 3]);
    const parts = ['instagram:synth_placeholder', createdAt, owner, ''];
    const digest = (parts: string[]) =>
      'instagram:' +
      createHash('sha256').update(JSON.stringify(parts)).digest('hex');
    expect(items.slice(1, 3).map((item) => item.id)).toEqual([
      digest(parts),
      digest([...parts, '2']),
    ]);
    expect(items.every((item) => item.url === null)).toBe(true);
    expect(JSON.stringify({ result, items })).not.toContain(
      'https://media.example.com/synthetic_different.gif',
    );
  } finally {
    await archive.close();
  }
});
