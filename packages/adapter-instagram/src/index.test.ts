import { expect, test } from 'vitest';
import {
  createMemoryArchive,
  importArchive,
  DEFAULT_IMPORT_LIMITS,
  stableId,
} from '@socialprune/core';
import type {
  ArchiveEntry,
  ArchiveReader,
  ImportSummary,
  Item,
} from '@socialprune/core';
import {
  listFixtureVariants,
  loadFixtureVariant,
} from '@socialprune/fixture-gen';
import {
  instagramAdapter,
  PERSONAL_MAX_BYTES,
  REELS_MAX_BYTES,
} from './index.ts';
import {
  MAP_KEY,
  OWNER_KEY,
  parseComment,
  parseLegacyComment,
  profileUsername,
  repairMojibake,
  timestampToUtc,
} from './format.ts';
import { archiveHandle, commentFile } from './paths.ts';

const name = 'instagram-synth_fern-2026-07-31-a1b2c3';
const postPath = 'your_instagram_activity/comments/post_comments_1.json';
const reelsPath = 'your_instagram_activity/comments/reels_comments.json';
const personalPath =
  'personal_information/personal_information/personal_information.json';
const seconds = 1_753_920_000;
function raw(text = 'Invented unit comment.', owner = 'synth_unit'): unknown {
  return {
    [MAP_KEY]: {
      Comment: { value: text, timestamp: 0 },
      Time: { value: '', timestamp: seconds },
      'Media Owner': { value: owner, timestamp: 0 },
    },
  };
}
function summary(summary: ImportSummary, items: Item[]) {
  return {
    status: summary.status,
    records: summary.records.map(
      ({
        platform,
        accounts,
        variant,
        exportCreatedAt,
        itemCount,
        diagnostics,
      }) => ({
        platform,
        accounts,
        variant,
        exportCreatedAt,
        itemCount,
        diagnostics,
      }),
    ),
    items,
  };
}
const variants = await listFixtureVariants('instagram');
test('fixture inventory is populated, not a vacuous parser proof', () => {
  expect(variants.length).toBeGreaterThanOrEqual(16);
  expect(variants).toContain('current-minimal');
  expect(variants).toContain('private-distractors');
});
test.each(variants)(
  'exact directory and ZIP import for %s with stable IDs on re-import',
  async (id) => {
    const modeResults = [];
    for (const mode of ['directory', 'zip'] as const) {
      const fixture = await loadFixtureVariant('instagram', id, { as: mode });
      try {
        const items: Item[] = [];
        const result = await importArchive(
          fixture.archive,
          [instagramAdapter],
          {
            onItems(batch) {
              items.push(...batch);
            },
            batchSize: 2,
            now: () => new Date('2026-08-01T00:00:00.000Z'),
          },
        );
        const observed = summary(result, items);
        expect(observed).toEqual(fixture.expected);
        modeResults.push(observed);
        const second: Item[] = [];
        const reimport = await importArchive(
          fixture.archive,
          [instagramAdapter],
          {
            onItems(batch) {
              second.push(...batch);
            },
          },
        );
        expect(summary(reimport, second)).toEqual(observed);
      } finally {
        await fixture.archive.close();
      }
    }
    expect(modeResults[0]).toEqual(modeResults[1]);
  },
  20_000,
);

test.each([
  ['Gr\u00c3\u00bc\u00c3\u009fe', 'Grüße'],
  ['\u00f0\u009f\u008c\u00bf', '🌿'],
  ['ASCII', 'ASCII'],
  ['ä', 'ä'],
  ['café', 'café'],
  ['Native emoji 🌿', 'Native emoji 🌿'],
  ['Mangled Ã¤ with native ä', 'Mangled Ã¤ with native ä'],
  ['Mangled Ã¤ with native Ω', 'Mangled Ã¤ with native Ω'],
  ['Suspicious Ã', 'Suspicious Ã'],
  ['Ã¤', 'ä'],
  ['\u00c0\u00af', '\u00c0\u00af'],
  ['\u00ed\u00a0\u0080', '\u00ed\u00a0\u0080'],
  ['\u00ef\u00bb\u00bftext', '\uFEFFtext'],
])('strict mojibake repair %j -> %j', (input, expected) => {
  expect(repairMojibake(input)).toBe(expected);
});
test('comment aliases use typed slots, not the first suspicious string', () => {
  expect(
    parseComment({
      [MAP_KEY]: {
        Medieninhaber: { value: 'synth_de' },
        Zeit: { timestamp: seconds },
        Kommentar: { value: 'ä' },
      },
    }),
  ).toEqual({
    text: 'ä',
    ownerHandle: 'synth_de',
    createdAt: '2025-07-31T00:00:00.000Z',
  });
  expect(
    parseComment({
      [MAP_KEY]: {
        'Unknown comment': { value: 'Invented.' },
        Time: { timestamp: seconds },
        'Media Owner': { value: 'synth_unit' },
      },
    }),
  ).toEqual({
    text: 'Invented.',
    ownerHandle: 'synth_unit',
    createdAt: '2025-07-31T00:00:00.000Z',
  });
  expect(
    parseComment({
      [OWNER_KEY]: 'synth_unit',
      [MAP_KEY]: {
        'Unknown comment': { value: 'Invented.' },
        'Unknown time': { value: '', timestamp: seconds },
        'Unknown owner': { value: 'synth_unit' },
      },
    }),
  ).not.toBeNull();
  for (const value of [
    {
      [MAP_KEY]: {
        one: { value: 'text' },
        two: { value: 'synth_owner' },
        Time: { timestamp: seconds },
      },
    },
    { [MAP_KEY]: { Comment: { value: 2 }, Time: { timestamp: seconds } } },
    {
      [MAP_KEY]: {
        Comment: { value: 'text' },
        Time: { timestamp: '1754006400' },
      },
    },
    {
      [MAP_KEY]: {
        Comment: { value: 'text' },
        Time: { timestamp: seconds },
        'Media Owner': { value: false },
      },
    },
    {
      [MAP_KEY]: {
        Comment: { value: 'text' },
        Kommentar: { value: 'text' },
        Time: { timestamp: seconds },
      },
    },
    {
      [OWNER_KEY]: 'synth_one',
      [MAP_KEY]: {
        Comment: { value: 'text' },
        Time: { timestamp: seconds },
        'Media Owner': { value: 'synth_two' },
      },
    },
    {
      [MAP_KEY]: {
        Comment: { value: 'text' },
        one: { timestamp: seconds },
        two: { timestamp: seconds },
      },
    },
    {
      [MAP_KEY]: {
        Comment: { value: 'text' },
        Time: { timestamp: seconds },
        one: { value: 'a' },
        two: { value: 'b' },
      },
    },
  ])
    expect(parseComment(value)).toBeNull();
  expect(
    parseComment({
      [MAP_KEY]: { Comment: { value: 'text' }, Time: { timestamp: seconds } },
    })?.ownerHandle,
  ).toBeNull();
});
test.each([
  [name, 'synth_fern'],
  [`${name}.zip`, 'synth_fern'],
  [`${name}_1.zip`, 'synth_fern'],
  [`${name}-part-2-of-3.zip`, 'synth_fern'],
  [`${name} (1).zip`, 'synth_fern'],
  ['instagram-SYNTH_FERN-2026-07-31-a1b2', 'synth_fern'],
  ['instagram-synth_fern-2026-02-30-token.zip', null],
  ['instagram-synth-fern-2026-07-31-token.zip', null],
  ['instagram-synth_fern-2026-07-31-.zip', null],
  ['not-instagram.zip', null],
])('archive account derivation %s', (input, expected) => {
  expect(archiveHandle(input)).toBe(expected);
});
test('username fallback reads named slots only and rejects conflicting metadata', () => {
  expect(
    profileUsername({
      profile_user: [
        {
          [MAP_KEY]: {
            Benutzername: { value: 'SYNTH_PROFILE' },
            Email: { value: 'synth_email@example.com' },
            Name: { value: 'synth_other' },
          },
        },
      ],
    }),
  ).toEqual({ status: 'found', handle: 'synth_profile' });
  expect(
    profileUsername({
      profile_user: [{ [MAP_KEY]: { Name: { value: 'synth_other' } } }],
    }),
  ).toEqual({ status: 'missing', handle: null });
  expect(
    profileUsername({
      profile_user: [{ [MAP_KEY]: { Username: { value: '' } } }],
    }),
  ).toEqual({ status: 'empty', handle: null });
  expect(
    profileUsername({
      profile_user: [
        {
          [MAP_KEY]: {
            Username: { value: 'synth_one' },
            Benutzername: { value: 'synth_two' },
          },
        },
      ],
    }),
  ).toEqual({ status: 'unreadable', handle: null });
});
test('whole seconds timestamp conversion is UTC and rejects unit guesses', () => {
  expect(timestampToUtc(seconds)).toBe('2025-07-31T00:00:00.000Z');
  expect(timestampToUtc(0)).toBe('1970-01-01T00:00:00.000Z');
  for (const value of [
    null,
    '1754006400',
    -1,
    1.5,
    Infinity,
    NaN,
    seconds * 1000,
    Number.MAX_SAFE_INTEGER,
  ])
    expect(timestampToUtc(value)).toBeNull();
});
test('legacy tuples require explicit timezone and a valid calendar date', () => {
  expect(
    parseLegacyComment(['2025-07-31T02:00:00+02:00', 'Invented.', 'synth_old']),
  ).toEqual({
    text: 'Invented.',
    ownerHandle: 'synth_old',
    createdAt: '2025-07-31T00:00:00.000Z',
  });
  for (const date of [
    '2025-07-31T00:00:00',
    '2025-02-30T00:00:00Z',
    '2025-07-31',
    'not a date',
  ])
    expect(parseLegacyComment([date, 'Invented.', 'synth_old'])).toBeNull();
});
test('path allowlist rejects nested private lookalikes and accepts one root prefix', () => {
  const entry = (path: string) => ({ archive: name, path, size: 0 });
  expect(commentFile(entry(postPath))?.category).toBe('post-comments');
  expect(commentFile(entry(`enclosing/${postPath}`))?.category).toBe(
    'post-comments',
  );
  for (const path of [
    `one/two/${postPath}`,
    `messages/${postPath}`,
    `security/${postPath}`,
    `contacts/${postPath}`,
    `threads/${postPath}`,
    `__MACOSX/${postPath}`,
    'your_instagram_activity/messages/inbox/synth_private/comments/post_comments_1.json',
    'your_instagram_activity/media/posts_1.json',
  ])
    expect(commentFile(entry(path))).toBeNull();
});

function spyReader(archive: ArchiveReader) {
  const calls: Array<{
    entry: ArchiveEntry;
    method: 'read' | 'stream';
    maxBytes?: number;
  }> = [];
  const reader: ArchiveReader = {
    archives: archive.archives,
    rejectedEntries: archive.rejectedEntries,
    list: () => archive.list(),
    close: () => archive.close(),
    readText(entry, options) {
      calls.push({ entry, method: 'read', maxBytes: options?.maxBytes });
      return archive.readText(entry, options);
    },
    streamText(entry, options) {
      calls.push({ entry, method: 'stream' });
      return archive.streamText(entry, options);
    },
  };
  return { reader, calls };
}
test('private fixtures are never read or reported, even when contents mimic the allowlist', async () => {
  for (const as of ['directory', 'zip'] as const) {
    const fixture = await loadFixtureVariant(
      'instagram',
      'private-distractors',
      { as },
    );
    const { reader, calls } = spyReader(fixture.archive);
    const items: Item[] = [];
    try {
      const detection = await instagramAdapter.detect(reader);
      expect(detection.result).toBe('match');
      expect(calls).toHaveLength(0);
      const result = await importArchive(reader, [instagramAdapter], {
        onItems(batch) {
          items.push(...batch);
        },
      });
      expect(calls.map((call) => call.entry.path)).toEqual([
        postPath,
        reelsPath,
      ]);
      expect(calls[0]?.method).toBe('stream');
      expect(calls[1]).toMatchObject({
        method: 'read',
        maxBytes: REELS_MAX_BYTES,
      });
      const output = JSON.stringify({ result, items, detection });
      for (const marker of [
        'ONLY_MARKER',
        'synth_private_thread',
        'messages',
        'security_and_login_information',
        'login_activity',
        'devices',
        'synth_profile_only@example.com',
        '+15555550123',
        'Synthetic Profile Only',
      ])
        expect(output).not.toContain(marker);
    } finally {
      await reader.close();
    }
  }
});
test('one bounded username read per fallback archive, zero when its name is known', async () => {
  const fallback = await loadFixtureVariant('instagram', 'personal-fallback', {
    as: 'zip',
  });
  const { reader, calls } = spyReader(fallback.archive);
  try {
    const result = await importArchive(reader, [instagramAdapter]);
    expect(result.status).toBe('ok');
    expect(calls.filter((call) => call.entry.path === personalPath)).toEqual([
      {
        entry: reader.list().find((entry) => entry.path === personalPath),
        method: 'read',
        maxBytes: PERSONAL_MAX_BYTES,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(
      'synth_profile_only@example.com',
    );
    expect(JSON.stringify(result)).not.toContain('+15555550123');
  } finally {
    await reader.close();
  }
  const known = createMemoryArchive(name, {
    [personalPath]: 'not JSON',
    [postPath]: JSON.stringify([raw()]),
  });
  const tracked = spyReader(known);
  try {
    expect(
      (await importArchive(tracked.reader, [instagramAdapter])).status,
    ).toBe('ok');
    expect(tracked.calls.every((call) => call.entry.path === postPath)).toBe(
      true,
    );
  } finally {
    await known.close();
  }
});
test('over-limit personal metadata and malformed reels are partial without stopping streamed posts', async () => {
  const archive = createMemoryArchive(
    'instagram-unknown-limit',
    {
      [personalPath]: ' '.repeat(PERSONAL_MAX_BYTES + 1),
      [postPath]: JSON.stringify([raw()]),
      [reelsPath]: '{"first": [], "second": []}',
    },
    { chunkSize: 7 },
  );
  try {
    const result = await importArchive(archive, [instagramAdapter]);
    expect(result.status).toBe('partial');
    expect(result.records[0]?.itemCount).toBe(1);
    expect(
      result.records[0]?.diagnostics
        .filter((diagnostic) => diagnostic.status === 'unreadable')
        .map((diagnostic) => diagnostic.category),
    ).toEqual(['account', 'reels-comments']);
    expect(result.records[0]?.accounts).toEqual([
      {
        key: `instagram:${await stableId(['instagram-unknown-limit'])}`,
        handle: null,
      },
    ]);
  } finally {
    await archive.close();
  }
});
test('stream element byte cap, assignment rejection, error redaction and abort paths', async () => {
  const archive = createMemoryArchive(
    name,
    {
      [postPath]: JSON.stringify([raw('Invented longer unit comment.')]),
      [reelsPath]: JSON.stringify({ comments_reels_comments: [raw()] }),
    },
    { chunkSize: 1 },
  );
  try {
    const result = await importArchive(archive, [instagramAdapter], {
      limits: { maxElementBytes: 16 },
    });
    expect(result.status).toBe('partial');
    expect(
      result.records[0]?.diagnostics.find(
        (diagnostic) => diagnostic.category === 'post-comments',
      )?.status,
    ).toBe('unreadable');
    expect(result.records[0]?.itemCount).toBe(1);
  } finally {
    await archive.close();
  }
  const planted = globalThis as typeof globalThis & {
    __instagramExecuted?: boolean;
  };
  const assigned = createMemoryArchive(name, {
    [postPath]: 'globalThis.__instagramExecuted = true; []',
  });
  try {
    const result = await importArchive(assigned, [instagramAdapter]);
    expect(result.status).toBe('partial');
    expect(planted.__instagramExecuted).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('__instagramExecuted');
  } finally {
    await assigned.close();
  }
  const canceled = new AbortController();
  const data = createMemoryArchive(name, {
    [postPath]: JSON.stringify([raw(), raw('Second invented.')]),
  });
  const iterator = instagramAdapter
    .parse(data, {
      signal: canceled.signal,
      limits: DEFAULT_IMPORT_LIMITS,
      now: () => new Date(),
    })
    [Symbol.asyncIterator]();
  try {
    const first = await iterator.next();
    expect(first.done).toBe(false);
    if (first.done) throw new Error('Expected an account event.');
    expect(first.value.type).toBe('account');
    canceled.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    await iterator.return?.();
    await data.close();
  }
});
test('HTML-only and unrelated archives do not open any entry', async () => {
  for (const id of ['html-only', 'no-match']) {
    const fixture = await loadFixtureVariant('instagram', id, { as: 'zip' });
    const { reader, calls } = spyReader(fixture.archive);
    try {
      expect((await importArchive(reader, [instagramAdapter])).status).toBe(
        id === 'html-only' ? 'html-export' : 'unknown-format',
      );
      expect(calls).toHaveLength(0);
      if (id === 'html-only')
        expect((await instagramAdapter.detect(reader)).reason).toContain(
          'JSON',
        );
    } finally {
      await reader.close();
    }
  }
});
test('both unknown accounts remain separate and never contaminate unrelated uploads', async () => {
  const first = createMemoryArchive('instagram-unknown-first', {
    [postPath]: JSON.stringify([raw()]),
  });
  const second = createMemoryArchive('instagram-unknown-second', {
    [postPath]: JSON.stringify([raw()]),
  });
  const unrelated = createMemoryArchive('unrelated-unknown', {
    'comments.json': '{"media_comments": []}',
    'notes.json': '{"note": "UNRELATED_ONLY_MARKER"}',
  });
  const readers = [unrelated, second, first];
  const owner = new Map(
    readers.flatMap((reader) =>
      reader.list().map((entry) => [entry, reader] as const),
    ),
  );
  const combined: ArchiveReader = {
    archives: readers.flatMap((reader) => [...reader.archives]),
    rejectedEntries: 0,
    list: () => [...owner.keys()].reverse(),
    readText: (entry, opts) => owner.get(entry)!.readText(entry, opts),
    streamText: (entry, opts) => owner.get(entry)!.streamText(entry, opts),
    async close() {
      await Promise.all(readers.map((reader) => reader.close()));
    },
  };
  const items: Item[] = [];
  try {
    const result = await importArchive(combined, [instagramAdapter], {
      onItems(batch) {
        items.push(...batch);
      },
    });
    expect(result.status).toBe('ok');
    expect(result.records[0]?.accounts).toEqual([
      {
        key: `instagram:${await stableId(['instagram-unknown-first'])}`,
        handle: null,
      },
      {
        key: `instagram:${await stableId(['instagram-unknown-second'])}`,
        handle: null,
      },
    ]);
    expect(result.records[0]?.itemCount).toBe(2);
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
    expect(JSON.stringify(items)).not.toContain('unrelated');
    expect(
      result.records[0]?.diagnostics.flatMap((diagnostic) => diagnostic.files),
    ).not.toContain('comments.json');
  } finally {
    await combined.close();
  }
});
test('same post and reel fingerprint is present rather than empty after deduplication', async () => {
  const first = createMemoryArchive(name, {
    [postPath]: JSON.stringify([raw()]),
  });
  const second = createMemoryArchive(`${name}_2`, {
    [reelsPath]: JSON.stringify({ comments_reels_comments: [raw()] }),
  });
  const owner = new Map(
    [first, second].flatMap((reader) =>
      reader.list().map((entry) => [entry, reader] as const),
    ),
  );
  const combined: ArchiveReader = {
    archives: [name, `${name}_2`],
    rejectedEntries: 0,
    list: () => [...owner.keys()],
    readText: (entry, opts) => owner.get(entry)!.readText(entry, opts),
    streamText: (entry, opts) => owner.get(entry)!.streamText(entry, opts),
    async close() {
      await Promise.all([first.close(), second.close()]);
    },
  };
  try {
    const result = await importArchive(combined, [instagramAdapter]);
    expect(result.records[0]?.itemCount).toBe(1);
    expect(
      result.records[0]?.diagnostics.find(
        (diagnostic) => diagnostic.category === 'reels-comments',
      ),
    ).toMatchObject({ status: 'found', count: 0 });
  } finally {
    await combined.close();
  }
});
test('deletion hint leaves day grouping to the UI and never builds a platform URL', () => {
  expect(instagramAdapter.deletionHint({} as Item)).toEqual({
    action: 'delete-comment',
    url: null,
    group: null,
  });
});
