import { describe, expect, test } from 'vitest';
import { inspectFile } from './index.ts';

const bytes = (text: string): Uint8Array => Buffer.from(text);
const xExport = (part = '0', spacing = ' '): string =>
  ['window', 'YTD', 'tweets_2026', `part${part}`].join('.') +
  `${spacing}= [{"text":"SYNTHETIC_PRIVATE"}];`;
const jsonKey = (fragments: string[], spacing = ''): string =>
  `{"${fragments.join('_')}"${spacing}: []}`;

describe('data guard content and path rules', () => {
  test.each(['archive.zip', 'archive.ZIP'])(
    'blocks ZIP extension %s',
    (path) => {
      expect(inspectFile(path, bytes('plain text'))).toEqual([
        { path, reason: 'ZIP extension' },
      ]);
    },
  );

  test.each([
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
    [0x50, 0x4b, 0x07, 0x08],
  ])('blocks a renamed ZIP with header %j', (...header) => {
    expect(inspectFile('renamed.dat', Uint8Array.from(header))).toEqual([
      { path: 'renamed.dat', reason: 'ZIP header' },
    ]);
  });

  test('requires ZIP magic at the start, not inside prose', () => {
    expect(
      inspectFile('notes.txt', Uint8Array.from([0, 0x50, 0x4b, 3, 4])),
    ).toEqual([]);
    expect(inspectFile('short.dat', Uint8Array.from([0x50, 0x4b]))).toEqual([]);
  });

  test.each([
    ['0', ''],
    ['23', ' \n\t'],
  ])('blocks X assignment part %s', (part, spacing) => {
    expect(inspectFile('tweets.js', bytes(xExport(part, spacing)))).toEqual([
      { path: 'tweets.js', reason: 'X export assignment' },
    ]);
  });

  test.each([
    ['string', 'map', 'data'],
    ['string', 'list', 'data'],
    ['media', 'owner'],
  ])('blocks Instagram JSON key %j', (...fragments) => {
    expect(inspectFile('posts.json', bytes(jsonKey(fragments, ' \n')))).toEqual(
      [{ path: 'posts.json', reason: 'Instagram export JSON key' }],
    );
  });

  test('allows synthetic fixtures with export content and ZIPs', () => {
    expect(
      inspectFile('fixtures/synthetic/x/archive.zip', bytes(xExport())),
    ).toEqual([]);
    expect(
      inspectFile(
        'fixtures/synthetic/instagram/export.dat',
        Uint8Array.from([0x50, 0x4b, 3, 4]),
      ),
    ).toEqual([]);
    expect(
      inspectFile(
        'fixtures/synthetic/instagram/posts.json',
        bytes(jsonKey(['media', 'owner'])),
      ),
    ).toEqual([]);
  });

  test('does not allow a similar prefix or the directory name itself', () => {
    expect(inspectFile('fixtures/synthetic-evil/x.zip', bytes(''))).toEqual([
      { path: 'fixtures/synthetic-evil/x.zip', reason: 'ZIP extension' },
    ]);
    expect(inspectFile('fixtures/synthetic', bytes(xExport()))).toHaveLength(1);
  });

  test('requires literal forward slashes in the allowed Git prefix', () => {
    const path = 'fixtures\\synthetic\\x.zip';
    expect(inspectFile(path, bytes(''))).toEqual([
      { path, reason: 'ZIP extension' },
    ]);
  });

  test.each([
    'fixtures/synthetic/../private/x.zip',
    '../outside.txt',
    'fixtures\\synthetic\\..\\x.zip',
  ])('rejects parent segments before allowing %s', (path) => {
    expect(inspectFile(path, bytes(''))).toEqual([
      { path, reason: 'parent path segment' },
    ]);
  });

  test.each(['/fixtures/synthetic/x.zip', 'C:\\fixtures\\synthetic\\x.zip'])(
    'rejects an absolute path %s',
    (path) => {
      expect(inspectFile(path, bytes(''))).toEqual([
        { path, reason: 'absolute path' },
      ]);
    },
  );

  test('allows prose mentions and near-miss identifiers', () => {
    const prose = [
      'Exports mention window.YTD. and string_map_data.',
      '"string_map_data" is a key name, not a JSON member here.',
      'media_owner and string_list_data are mentioned in documentation.',
      ['window', 'YTD', 'tweets', 'partx'].join('.') + ' = [];',
      jsonKey(['string', 'map', 'data', 'extra']),
    ].join('\n');
    expect(inspectFile('AGENTS.md', bytes(prose))).toEqual([]);
  });
});
