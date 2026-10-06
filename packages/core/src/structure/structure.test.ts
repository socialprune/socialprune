import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { createMemoryArchive } from '../archive/index.ts';
import type { ArchiveReader } from '../archive/index.ts';
import { openArchivePaths } from '../node/index.ts';
import { parseJsonArrayStream } from '../json/index.ts';
import { describeStructure, KNOWN_EXPORT_DATA_DIRECTORIES } from './index.ts';

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

function leafValues(input: unknown): string[] {
  if (typeof input === 'string') return input.length >= 3 ? [input] : [];
  if (typeof input === 'number')
    return String(input).replace(/\D/g, '').length >= 3 ? [String(input)] : [];
  if (Array.isArray(input)) return input.flatMap(leafValues);
  if (input && typeof input === 'object')
    return Object.values(input).flatMap(leafValues);
  return [];
}

function containsStringOrNumber(input: unknown): boolean {
  if (typeof input === 'string' || typeof input === 'number') return true;
  if (Array.isArray(input)) return input.some(containsStringOrNumber);
  if (input && typeof input === 'object')
    return Object.values(input).some(containsStringOrNumber);
  return false;
}

function literalLeaves(text: string): string[] {
  const leaves: string[] = [];
  for (const match of text.matchAll(/"(?:[^"\\]|\\[\s\S])*"/g)) {
    if (/^\s*:/.test(text.slice(match.index + match[0].length))) continue;
    try {
      const decoded: unknown = JSON.parse(match[0]);
      if (typeof decoded === 'string' && decoded.length >= 3)
        leaves.push(decoded);
    } catch {
      // A malformed literal contributes no decoded value; keep scanning the
      // rest of the file instead of omitting this malformed fixture entirely.
    }
  }
  return leaves;
}

async function* fixtureChunks(text: string): AsyncIterable<string> {
  yield await Promise.resolve(text);
}

const JSON_TYPE_NAMES = [
  'string',
  'number',
  'boolean',
  'null',
  'object',
  'array',
];

interface FixtureLeafEvidence {
  leaves: string[];
  parsedCleanly: boolean;
  hasStringOrNumber: boolean;
}

async function fixtureLeafEvidence(
  text: string,
  format: 'json' | 'js',
): Promise<FixtureLeafEvidence> {
  let leaves: string[] = [];
  let parsedCleanly = true;
  let hasStringOrNumber = false;
  const collect = (value: unknown) => {
    leaves.push(...leafValues(value));
    hasStringOrNumber ||= containsStringOrNumber(value);
  };
  try {
    if (format === 'json') {
      const value: unknown = JSON.parse(text);
      collect(value);
    } else {
      const objectPrefix =
        /^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*=\s*(?=\{)/.exec(text);
      if (objectPrefix) {
        let payload = text.slice(objectPrefix[0].length).trim();
        if (payload.endsWith(';')) payload = payload.slice(0, -1).trimEnd();
        const value: unknown = JSON.parse(payload);
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new TypeError('Expected one assigned JSON object.');
        collect(value);
      } else {
        const stream = parseJsonArrayStream(fixtureChunks(text), {
          assignment: 'allowed',
        });
        for await (const element of stream) collect(element);
        await stream.target;
      }
    }
  } catch {
    parsedCleanly = false;
    leaves = literalLeaves(text);
  }
  // Type names belong to the report vocabulary; short digit-only values can
  // equal report counts. No other leaf values are exempt from the assertion.
  return {
    leaves: [...new Set(leaves)].filter(
      (leaf) =>
        !JSON_TYPE_NAMES.includes(leaf) &&
        (!/^\d+$/.test(leaf) || leaf.length >= 5),
    ),
    parsedCleanly,
    hasStringOrNumber,
  };
}

async function extractFixtureLeaves(
  text: string,
  format: 'json' | 'js',
): Promise<string[]> {
  return (await fixtureLeafEvidence(text, format)).leaves;
}

test('fixture leaf extraction covers assigned JS, decoded literals and exact vocabulary exclusions', async () => {
  const target = ['window', 'YTD', 'tweets', 'part0'].join('.');
  const text = `${target} = ${JSON.stringify([
    {
      text: 'Assigned JS leaf',
      number: 1234567,
      nested: [
        'Escaped "quoted" leaf',
        '00123',
        1234,
        '123',
        'string',
        'number',
        'boolean',
        'null',
        'object',
        'array',
        'strings remain leaves',
      ],
    },
  ])};`;
  expect(await extractFixtureLeaves(text, 'js')).toEqual([
    'Assigned JS leaf',
    '1234567',
    'Escaped "quoted" leaf',
    '00123',
    'strings remain leaves',
  ]);
  expect(
    await extractFixtureLeaves('{"key": "JSON leaf", "count": 12345}', 'json'),
  ).toEqual(['JSON leaf', '12345']);
});

test('malformed and trailing-code fixtures retain decoded non-key string leaves', async () => {
  const malformed =
    '{"key_only" : "Malformed leaf", "escaped_key": "Decoded\\u0020leaf", "broken_key":';
  expect(await extractFixtureLeaves(malformed, 'json')).toEqual([
    'Malformed leaf',
    'Decoded leaf',
  ]);
  const target = ['window', 'YTD', 'tweets', 'part0'].join('.');
  const injection = `${target} = (function(){return {"key_only": "Injection leaf"}})() || []`;
  expect(await extractFixtureLeaves(injection, 'js')).toEqual([
    'Injection leaf',
  ]);
  expect(
    await extractFixtureLeaves(
      `${target} = ["Array leaf"]; "Trailing code leaf"`,
      'js',
    ),
  ).toEqual(['Array leaf', 'Trailing code leaf']);
});

test('object assignments expose only masked key paths and types without object leaf values', async () => {
  const target = ['window', '__THAR_CONFIG'].join('.');
  const object = {
    archiveInfo: {
      generationDate: 'OBJECT_TIMESTAMP_PLANTED',
      count: 987654321,
    },
    dataTypes: { tweets: { files: [{ fileName: 'data/tweets.js' }] } },
    ['@private-key']: { text: 'OBJECT_TEXT_PLANTED' },
    map: Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [`key_${i}`, 'MAP_LEAF_PLANTED']),
    ),
  };
  const archive = createMemoryArchive('manifest', {
    'data/manifest.js': `\uFEFF  ${target} = ${JSON.stringify(object)}; \n`,
  });
  try {
    const report = await describeStructure(archive);
    expect(report.files[0]).toMatchObject({
      assignments: [target],
      parsed: 1,
      unparsed: 0,
      errors: [],
    });
    expect(report.files[0]?.paths).toContainEqual({
      path: '$',
      types: ['object'],
    });
    expect(report.files[0]?.paths).toContainEqual({
      path: '$.dataTypes.tweets.files[].fileName',
      types: ['string'],
    });
    const serialized = JSON.stringify(report);
    for (const leaf of leafValues(object))
      expect(serialized).not.toContain(leaf);
    expect(serialized).toContain('$.<key>.text');
    expect(serialized).toContain('$.map.<key>');
    expect(serialized).not.toContain('@private-key');
    expect(serialized).not.toContain('key_50');
  } finally {
    await archive.close();
  }
});

test('object-assignment trailing code and executable expressions stay unparsed and never execute', async () => {
  const target = ['window', '__THAR_CONFIG'].join('.');
  const planted = globalThis as typeof globalThis & { __pwned?: unknown };
  expect(planted.__pwned).toBeUndefined();
  const archive = createMemoryArchive('invalid-objects', {
    'trailing.js': `${target} = {"text":"TRAILING_OBJECT_LEAF"}; globalThis.__pwned = 1`,
    'injection.js': `${target} = (function(){globalThis.__pwned = 1;return {"text":"INJECTION_OBJECT_LEAF"}})()`,
    'two.js': `${target} = {}; second = {"text":"SECOND_OBJECT_LEAF"}`,
    'semicolon.js': `${target} = {};;`,
    'bare.js': '{"text":"BARE_OBJECT_LEAF"}',
  });
  try {
    const report = await describeStructure(archive);
    for (const file of report.files)
      expect(file).toMatchObject({
        parsed: 0,
        unparsed: 1,
        errors: ['JsonFormatError'],
        paths: [],
      });
    expect(JSON.stringify(report)).not.toContain('OBJECT_LEAF');
    expect(planted.__pwned).toBeUndefined();
  } finally {
    await archive.close();
  }
});

test('object-assignment reads enforce the element byte limit rather than full-text default', async () => {
  const target = ['window', '__THAR_CONFIG'].join('.');
  const memory = createMemoryArchive('bounded-manifest', {
    'manifest.js': `${target} = {"text":"${'ä'.repeat(50)}"};`,
  });
  const byteLimits: (number | undefined)[] = [];
  const archive: ArchiveReader = {
    archives: memory.archives,
    rejectedEntries: memory.rejectedEntries,
    list: () => memory.list(),
    readText(entry, opts) {
      byteLimits.push(opts?.maxBytes);
      return memory.readText(entry, opts);
    },
    streamText: (entry, opts) => memory.streamText(entry, opts),
    close: () => memory.close(),
  };
  try {
    const report = await describeStructure(archive, {
      limits: { maxElementBytes: 64 },
    });
    expect(byteLimits).toEqual([64]);
    expect(report.files[0]).toMatchObject({
      parsed: 0,
      unparsed: 1,
      errors: ['ArchiveLimitError'],
      paths: [],
    });
  } finally {
    await archive.close();
  }
});

function archivePathLeaves(archive: ArchiveReader): Set<string> {
  return new Set(
    archive.list().flatMap(({ path }) => {
      const segments = path.split('/');
      return segments.flatMap((_, index) => {
        const suffix = segments.slice(index).join('/');
        return [suffix, suffix.replace(/\d+/g, 'N')];
      });
    }),
  );
}

test('manifest path exemptions match only same-archive paths and slash-boundary normalized suffixes', () => {
  const first = createMemoryArchive('first', { 'data/tweets-part23.js': '[]' });
  const second = createMemoryArchive('second', { 'other.json': '[]' });
  const paths = archivePathLeaves(first);
  expect(paths.has('data/tweets-part23.js')).toBe(true);
  expect(paths.has('data/tweets-partN.js')).toBe(true);
  expect(paths.has('tweets-part23.js')).toBe(true);
  expect(paths.has('tweets-partN.js')).toBe(true);
  expect(paths.has('weets-part23.js')).toBe(false);
  expect(paths.has('other.json')).toBe(false);
  expect(archivePathLeaves(second).has('data/tweets-part23.js')).toBe(false);
});

test('zero-leaf evidence requires clean parsing and no string or number of any length', async () => {
  const target = ['window', '__THAR_CONFIG'].join('.');
  for (const [text, format] of [
    ['[]', 'json'],
    ['{"comments": [], "present": true, "none": null}', 'json'],
    [`${target} = {"comments": []};`, 'js'],
  ] as const)
    expect(await fixtureLeafEvidence(text, format)).toEqual({
      leaves: [],
      parsedCleanly: true,
      hasStringOrNumber: false,
    });
  for (const input of ['["a"]', '[1]', '["number"]', '[123]']) {
    const evidence = await fixtureLeafEvidence(input, 'json');
    expect(evidence.leaves).toEqual([]);
    expect(evidence.parsedCleanly).toBe(true);
    expect(evidence.hasStringOrNumber).toBe(true);
  }
  expect((await fixtureLeafEvidence('[', 'json')).parsedCleanly).toBe(false);
  expect((await fixtureLeafEvidence('[]; code()', 'js')).parsedCleanly).toBe(
    false,
  );
});

test.each([
  ['instagram-planted_handle-2026-07-31-abc', 'planted_handle'],
  ['twitter-2026-10-01-a1b2c3deadbeef', 'a1b2c3deadbeef'],
])(
  'wrapper %s is masked for parsed files, other files and private entries',
  async (wrapper, forbidden) => {
    const archive = createMemoryArchive('SYNTHETIC_ARCHIVE_NAME', {
      [`${wrapper}/data/posts.json`]: '[{"text":"PLANTED_BODY"}]',
      [`${wrapper}/media/photo.jpg`]: 'unused media',
      [`${wrapper}/messages/private.json`]: 'NEVER_READ',
    });
    try {
      const report = await describeStructure(archive);
      expect(report.files[0]?.pattern).toBe('<root>/data/posts.json');
      expect(report.otherFiles).toEqual([
        { directory: '<root>', extension: 'jpg', count: 1 },
      ]);
      expect(report.skippedPrivate).toBe(1);
      const serialized = JSON.stringify(report).toLowerCase();
      for (const value of [
        wrapper,
        forbidden,
        'SYNTHETIC_ARCHIVE_NAME',
        'PLANTED_BODY',
      ])
        expect(serialized).not.toContain(value.toLowerCase());
    } finally {
      await archive.close();
    }
  },
);

test('known export directories are not wrappers and identifier-like path segments are masked', async () => {
  const archive = createMemoryArchive('paths', {
    'data/posts.json': '[]',
    'data/@planted_handle/posts.json': '[]',
    'data/http-secret/posts.json': '[]',
    [`data/${'long_name_'.repeat(9)}/posts.json`]: '[]',
    'data/123456789.json': '[]',
  });
  try {
    const report = await describeStructure(archive);
    expect(report.files.map(({ pattern }) => pattern)).toEqual([
      'data/<segment>/posts.json',
      'data/N.json',
      'data/posts.json',
    ]);
    expect(
      report.files.find(({ pattern }) => pattern.includes('<segment>'))?.count,
    ).toBe(3);
    expect(JSON.stringify(report)).not.toContain('planted_handle');
    expect(JSON.stringify(report)).not.toContain('123456789');
  } finally {
    await archive.close();
  }
});

test('wrapper detection considers other and skipped entries, not only parsed data', async () => {
  const archive = createMemoryArchive('mixed', {
    'wrapper/data/posts.json': '[]',
    'media/photo.jpg': 'unused',
    'messages/private.json': 'NEVER_READ',
  });
  try {
    const report = await describeStructure(archive);
    expect(report.files[0]?.pattern).toBe('wrapper/data/posts.json');
    expect(report.otherFiles[0]?.directory).toBe('media');
    expect(report.skippedPrivate).toBe(1);
  } finally {
    await archive.close();
  }
});

function wrapperSegment(archive: ArchiveReader): string | null {
  const entries = archive.list();
  const segment = entries[0]?.path.split('/')[0];
  return segment &&
    !KNOWN_EXPORT_DATA_DIRECTORIES.includes(segment.toLowerCase()) &&
    entries.every((entry) => entry.path.split('/')[0] === segment) &&
    entries.some((entry) => entry.path.includes('/'))
    ? segment
    : null;
}

function expectedAccountIdentities(expected: unknown): {
  handles: string[];
  keys: string[];
} {
  const handles: string[] = [];
  const keys: string[] = [];
  const collect = (account: unknown) => {
    if (!account || typeof account !== 'object') return;
    if (
      'handle' in account &&
      typeof account.handle === 'string' &&
      account.handle.length >= 3
    )
      handles.push(account.handle);
    if ('key' in account && typeof account.key === 'string')
      keys.push(account.key);
  };
  if (expected && typeof expected === 'object') {
    if ('records' in expected && Array.isArray(expected.records))
      for (const record of expected.records as unknown[])
        if (
          record &&
          typeof record === 'object' &&
          'accounts' in record &&
          Array.isArray(record.accounts)
        )
          for (const account of record.accounts as unknown[]) collect(account);
    if ('items' in expected && Array.isArray(expected.items))
      for (const item of expected.items as unknown[])
        if (item && typeof item === 'object' && 'account' in item)
          collect(item.account);
  }
  return { handles: [...new Set(handles)], keys: [...new Set(keys)] };
}

// Only real export-name patterns carry identity tokens. Other names are
// fixture labels, not personal data. Archive names never reach StructureReport
// by construction; the distinctive-name test below proves that boundary.
function identifyingArchiveTokens(name: string): string[] {
  const instagram =
    /^instagram-(.+)-(\d{4}-\d{2}-\d{2})-([A-Za-z0-9]+)(?:_\d+)?$/.exec(name);
  if (instagram) return [instagram[1]!, instagram[3]!];
  const twitter = /^twitter-(\d{4}-\d{2}-\d{2})-([A-Za-z0-9]+)$/.exec(name);
  return twitter ? [twitter[2]!] : [];
}

test.each([
  ['instagram-planted_handle-2026-07-31-q7zr9x', ['planted_handle', 'q7zr9x']],
  ['twitter-2026-10-01-x8zq7r', ['x8zq7r']],
])(
  'identifying tokens of %s never appear in a memory archive structure report',
  async (name, tokens) => {
    const archive = createMemoryArchive(name, {
      'data/posts.json': '[{"text":"GENERATED_ARCHIVE_LEAF"}]',
    });
    try {
      const serialized = JSON.stringify(await describeStructure(archive));
      for (const token of tokens) expect(serialized).not.toContain(token);
      expect(identifyingArchiveTokens(name)).toEqual(tokens);
      expect(
        identifyingArchiveTokens(
          'instagram-planted_handle-2026-07-31-q7zr9x_2',
        ),
      ).toEqual(['planted_handle', 'q7zr9x']);
      for (const label of ['instagram-profile-fallback', 'archive'])
        expect(identifyingArchiveTokens(label)).toEqual([]);
    } finally {
      await archive.close();
    }
  },
);

test('expected account identities cover records and items without dropping long colliding handles', () => {
  expect(
    expectedAccountIdentities({
      records: [{ accounts: [{ key: 'platform:record-key', handle: 'data' }] }],
      items: [{ account: { key: 'platform:item-key', handle: 'Handle_Case' } }],
    }),
  ).toEqual({
    handles: ['data', 'Handle_Case'],
    keys: ['platform:record-key', 'platform:item-key'],
  });
  expect(
    expectedAccountIdentities({
      items: [{ account: { key: 'platform:short', handle: 'ab' } }],
    }),
  ).toEqual({ handles: [], keys: ['platform:short'] });
});

test('path masking also applies to other-file directory names', async () => {
  const archive = createMemoryArchive('mixed-paths', {
    'data/posts.json': '[]',
    '@private_handle/photo.jpg': 'unused',
    'https-secret/photo.jpg': 'unused',
  });
  try {
    const report = await describeStructure(archive);
    expect(report.otherFiles).toEqual([
      { directory: '<segment>', extension: 'jpg', count: 2 },
    ]);
    expect(JSON.stringify(report)).not.toContain('private_handle');
    expect(JSON.stringify(report)).not.toContain('https-secret');
  } finally {
    await archive.close();
  }
});

const fixtureRoot = fileURLToPath(
  new URL('../../../../fixtures/synthetic/', import.meta.url),
);
const fixturePlatforms = await readdir(fixtureRoot, {
  withFileTypes: true,
}).catch(() => []);
const variants: { path: string; label: string }[] = [];
for (const platform of fixturePlatforms.filter(
  (entry) => entry.isDirectory() && !entry.isSymbolicLink(),
)) {
  for (const variant of await readdir(`${fixtureRoot}/${platform.name}`, {
    withFileTypes: true,
  })) {
    if (variant.isDirectory() && !variant.isSymbolicLink())
      variants.push({
        path: join(fixtureRoot, platform.name, variant.name),
        label: `${platform.name}/${variant.name}`,
      });
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
    // verification-before-completion Law 32: fixture-wide proof must cover
    // every eligible syntax and malformed input. Zero leaves require proof of
    // clean parsing with no string or number, not merely an empty collector.
    // Inspect actual export roots, not fixture metadata. A manifest's exact
    // same-archive paths, slash-boundary suffixes and their digit-normalized
    // forms disclose only the file list, including nested export-root paths.
    // No other substring or value is exempt from the negative assertion.
    const failures: string[] = [];
    const leafBearing = new Map<string, number>();
    // classify is the hand-authored JSONL measurement set, not a platform
    // archive directory. Every export platform present still needs a sample.
    for (const platform of fixturePlatforms)
      if (
        platform.isDirectory() &&
        !platform.isSymbolicLink() &&
        platform.name !== 'classify'
      )
        leafBearing.set(platform.name, 0);
    const noScalarVariants: string[] = [];
    for (const variant of variants) {
      const platform = variant.label.split('/')[0]!;
      leafBearing.set(platform, leafBearing.get(platform) ?? 0);
      const metadata: unknown = JSON.parse(
        await readFile(join(variant.path, 'variant.json'), 'utf8'),
      );
      if (
        !metadata ||
        typeof metadata !== 'object' ||
        !('archives' in metadata) ||
        !Array.isArray(metadata.archives)
      )
        throw new TypeError('Invalid fixture archive names.');
      const archiveNames: string[] = [];
      for (const name of metadata.archives as unknown[]) {
        if (
          typeof name !== 'string' ||
          !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)
        )
          throw new TypeError('Invalid fixture archive name.');
        archiveNames.push(name);
      }
      const expected: unknown = JSON.parse(
        await readFile(join(variant.path, 'expected.json'), 'utf8'),
      );
      const identities = expectedAccountIdentities(expected);
      let dataFileCount = 0;
      let leafCount = 0;
      let cleanWithoutScalars = true;
      const variantFailures: string[] = [];
      for (const name of archiveNames) {
        const archive = await openArchivePaths([join(variant.path, name)]);
        try {
          const report = JSON.stringify(await describeStructure(archive));
          const lowercaseReport = report.toLowerCase();
          const wrapper = wrapperSegment(archive);
          const requiredAbsent = [
            ...archiveNames.flatMap((archiveName) =>
              identifyingArchiveTokens(archiveName).map((value) => ({
                kind: 'archive identifying token',
                value,
              })),
            ),
            ...identities.keys.map((value) => ({ kind: 'account key', value })),
            ...identities.handles.map((value) => ({
              kind: 'account handle',
              value,
            })),
            ...(wrapper ? [{ kind: 'wrapper', value: wrapper }] : []),
          ];
          for (const { kind, value } of requiredAbsent) {
            if (
              kind === 'account handle' &&
              [...JSON_TYPE_NAMES, ...KNOWN_EXPORT_DATA_DIRECTORIES].includes(
                value.toLowerCase(),
              )
            )
              variantFailures.push(
                `${variant.label}/${name}: handle collides with report vocabulary or structural name ${JSON.stringify(value)}`,
              );
            else if (lowercaseReport.includes(value.toLowerCase()))
              variantFailures.push(
                `${variant.label}/${name}: required-absent ${kind} ${JSON.stringify(value)}`,
              );
          }
          const pathLeaves = archivePathLeaves(archive);
          const dataFiles = archive
            .list()
            .filter((entry) => /\.(?:json|js)$/i.test(entry.path));
          dataFileCount += dataFiles.length;
          for (const entry of dataFiles) {
            const text = await archive.readText(entry);
            const evidence = await fixtureLeafEvidence(
              text,
              /\.js$/i.test(entry.path) ? 'js' : 'json',
            );
            leafCount += evidence.leaves.length;
            cleanWithoutScalars &&=
              evidence.parsedCleanly && !evidence.hasStringOrNumber;
            for (const leaf of evidence.leaves)
              if (!pathLeaves.has(leaf) && report.includes(leaf))
                variantFailures.push(
                  `${variant.label}/${name}: ${JSON.stringify(leaf)}`,
                );
          }
        } finally {
          await archive.close();
        }
      }
      if (leafCount > 0)
        leafBearing.set(platform, leafBearing.get(platform)! + 1);
      else if (dataFileCount > 0) {
        if (cleanWithoutScalars) noScalarVariants.push(variant.label);
        else
          variantFailures.push(
            `${variant.label}: zero leaves without clean no-scalar evidence`,
          );
      }
      if (variantFailures.length > 0)
        console.error(`Fixture privacy FAIL ${variantFailures.join('; ')}`);
      else
        console.info(
          `Fixture privacy PASS ${variant.label} (${dataFileCount} data files, ${leafCount} leaves${dataFileCount > 0 && leafCount === 0 ? ', clean no-scalar variant' : ''})`,
        );
      failures.push(...variantFailures);
    }
    console.info(
      `Clean no-scalar variants: ${noScalarVariants.length} (${noScalarVariants.join(', ')})`,
    );
    for (const [platform, count] of leafBearing)
      if (count < 1) failures.push(`${platform}: no leaf-bearing variants`);
    expect(failures).toEqual([]);
  },
);
