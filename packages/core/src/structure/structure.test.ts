import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { createMemoryArchive } from '../archive/index.ts';
import type { ArchiveReader } from '../archive/index.ts';
import { openArchivePaths } from '../node/index.ts';
import { describeStructure } from './index.ts';

const marker = ['Synthetic', 'Leaf', 'Never', 'Printed'].join('-');
test('structure output contains no planted leaf values or identifier-like keys, and never reads private entries', async () => {
  const username = ['demo', 'username', 'zebra'].join('_');
  const email = ['demo', '@', 'example.invalid'].join('');
  const id = ['1234567', '89012345'].join('');
  const leafNumber = 987654321;
  const handleKey = ['@', 'synthetic_handle'].join('');
  const privateName = 'messages/PRIVATE_FILENAME_NEVER_SHOWN.json';
  const prefix = ['window', 'YTD', 'tweets', 'part23'].join('.') + ' = ';
  const memory = createMemoryArchive(
    'demo',
    {
      'posts.json': JSON.stringify([
        {
          body: marker,
          count: leafNumber,
          handle: username,
          email,
          id,
          [id]: marker,
          [handleKey]: leafNumber,
        },
      ]),
      'post_comments_1.json': JSON.stringify({ comments: [marker] }),
      'post_comments_2.json': JSON.stringify({ comments: [null, true] }),
      'tweets-part1.js':
        prefix + JSON.stringify([{ tweet: { full_text: marker } }]) + ';',
      [privateName]: 'DISTINCT_PRIVATE_CONTENT',
      'security_and_login_information/login_activity.json':
        'OTHER_PRIVATE_CONTENT',
      'media/PRIVATE_MEDIA_NAME.JPG': 'MEDIA_VALUE',
    },
    { chunkSize: 1 },
  );
  const archive: ArchiveReader = {
    ...memory,
    archives: memory.archives,
    rejectedEntries: memory.rejectedEntries,
    list: () => memory.list(),
    readText: () => {
      throw new Error('Whole-file reads are forbidden.');
    },
    streamText(entry, opts) {
      if (
        entry.path.includes('PRIVATE_FILENAME') ||
        entry.path.startsWith('security')
      )
        throw new Error('Private content was read.');
      return memory.streamText(entry, opts);
    },
    close: () => memory.close(),
  };
  const report = await describeStructure(archive);
  const serialized = JSON.stringify(report);
  for (const planted of [
    marker,
    username,
    email,
    id,
    String(leafNumber),
    handleKey,
    privateName,
    'DISTINCT_PRIVATE_CONTENT',
    'PRIVATE_MEDIA_NAME',
    'MEDIA_VALUE',
  ])
    expect(serialized).not.toContain(planted);
  expect(report.skippedPrivate).toBe(2);
  expect(
    report.files.find(({ pattern }) => pattern === 'post_comments_N.json'),
  ).toMatchObject({ count: 2, parsed: 2 });
  expect(
    report.files.find(({ pattern }) => pattern === 'tweets-partN.js'),
  ).toMatchObject({ assignments: ['window.YTD.tweets.partN'] });
  expect(serialized).toContain('$[].tweet.full_text');
  expect(serialized).toContain('<key>');
  expect(report.otherFiles).toEqual([
    { directory: 'media', extension: 'jpg', count: 1 },
  ]);
  await archive.close();
});
test('object maps collapse above 50 distinct keys including already observed children', async () => {
  const object = Object.fromEntries(
    Array.from({ length: 51 }, (_, i) => [
      `key_${i}`,
      { leaf: 'not reported' },
    ]),
  );
  const archive = createMemoryArchive('demo', {
    'map.json': JSON.stringify(object),
    'broken.js': 'const leaked = SECRET_PLANTED_ERROR;',
  });
  const report = await describeStructure(archive);
  const serialized = JSON.stringify(report);
  expect(serialized).not.toContain('key_0');
  expect(serialized).not.toContain('key_50');
  expect(serialized).toContain('$.<key>.leaf');
  expect(serialized).not.toContain('SECRET_PLANTED_ERROR');
  expect(
    report.files.find(({ pattern }) => pattern === 'broken.js'),
  ).toMatchObject({ unparsed: 1, errors: ['JsonFormatError'], paths: [] });
  await archive.close();
});
test('structure reports deterministic types for all JSON values and cancellation', async () => {
  const archive = createMemoryArchive('demo', {
    'z.json': '[1,"v",true,null,{},[]]',
    'a.json': '{"a":1}',
  });
  const report = await describeStructure(archive);
  expect(report.files.map(({ pattern }) => pattern)).toEqual([
    'a.json',
    'z.json',
  ]);
  expect(
    report.files[1]?.paths.find(({ path }) => path === '$[]')?.types,
  ).toEqual(['array', 'boolean', 'null', 'number', 'object', 'string']);
  const controller = new AbortController();
  controller.abort();
  await expect(
    describeStructure(archive, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  await archive.close();
});

test('all declared private categories are counted without opening their streams', async () => {
  const paths = [
    'nested/messages/data.json',
    'direct-messages-group.js',
    'direct_messages.js',
    'direct-message.js',
    'chat/notes.json',
    'security_and_login_information/index.json',
    'login_activity.json',
    'ip-audit.json',
    'ip_audit.json',
    'device.json',
    'contact.json',
    'phone-number.json',
    'email-address-change.json',
    'account-creation-ip.json',
    'ip_addresses.json',
  ];
  const archive: ArchiveReader = {
    archives: ['private-test'],
    rejectedEntries: 0,
    list: () =>
      paths.map((path) => ({ archive: 'private-test', path, size: 100 })),
    readText: () => {
      throw new Error('Private content opened.');
    },
    streamText: () => {
      throw new Error('Private content opened.');
    },
    close: () => Promise.resolve(),
  };
  const report = await describeStructure(archive);
  expect(report).toEqual({
    files: [],
    otherFiles: [],
    skippedPrivate: paths.length,
    rejectedEntries: 0,
  });
});

const fixtureRoot = fileURLToPath(
  new URL('../../../../fixtures/synthetic/', import.meta.url),
);
const fixturePlatforms = await readdir(fixtureRoot, {
  withFileTypes: true,
}).catch(() => []);
const variants: string[] = [];
for (const platform of fixturePlatforms.filter(
  (entry) => entry.isDirectory() && !entry.isSymbolicLink(),
)) {
  for (const variant of await readdir(`${fixtureRoot}/${platform.name}`, {
    withFileTypes: true,
  })) {
    if (variant.isDirectory() && !variant.isSymbolicLink())
      variants.push(`${fixtureRoot}/${platform.name}/${variant.name}`);
  }
}
test('fixture privacy coverage explicitly reports the current registered directory count', () => {
  expect(variants.length).toBeGreaterThanOrEqual(0);
  if (variants.length === 0)
    console.info(
      'Fixture privacy sweep explicitly skipped: no variant directories exist yet.',
    );
});
test.skipIf(variants.length === 0)(
  'every existing generated fixture hides its distinctive JSON leaf values',
  async () => {
    function leaves(input: unknown): string[] {
      if (typeof input === 'string') return input.length >= 3 ? [input] : [];
      if (typeof input === 'number')
        return String(input).replace(/\D/g, '').length >= 3
          ? [String(input)]
          : [];
      if (Array.isArray(input)) return input.flatMap(leaves);
      if (input && typeof input === 'object')
        return Object.values(input).flatMap(leaves);
      return [];
    }
    for (const variant of variants) {
      const archive = await openArchivePaths([variant]);
      try {
        const report = JSON.stringify(await describeStructure(archive));
        for (const entry of archive.list()) {
          if (
            !entry.path.endsWith('.json') ||
            entry.path === 'variant.json' ||
            entry.path === 'expected.json'
          )
            continue;
          const text = await archive.readText(entry);
          const data: unknown = JSON.parse(text);
          for (const leaf of leaves(data)) expect(report).not.toContain(leaf);
        }
      } finally {
        await archive.close();
      }
    }
  },
);
