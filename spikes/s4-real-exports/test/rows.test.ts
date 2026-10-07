import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createMemoryArchive } from '../../../packages/core/src/index.ts';
import type { ArchiveReader } from '../../../packages/core/src/index.ts';
import { inspectRows } from '../rows.ts';
import { checkInputs } from '../report.ts';
import { printReport } from '../check.ts';
import { KEYS, validateReport } from '../schema.ts';
import type { Report, ShapePath } from '../schema.ts';

const commentFile = 'your_instagram_activity/comments/post_comments_1.json';
const mapKey = ['string', 'map', 'data'].join('_');
const mapPath = `$.<${mapKey}>`;
const textSecret = 'DISTINCTIVE_SYNTHETIC_REJECTED_BODY';
const handleSecret = 'invented_glowmoth';
const urlSecret = 'https://example.org/secret-synthetic-rejected-url';
const missingText = (timestamp: number) => ({
  [mapKey]: { Time: { timestamp }, 'Media Owner': { value: handleSecret } },
  invented_extra_array: [{ invented_media_key: urlSecret }],
});
const malformedRow = {
  [mapKey]: { Comment: { value: 9 }, Time: { timestamp: 1_600_000_000 } },
  invented_private_value: textSecret,
};
const validRow = {
  [mapKey]: { Comment: { value: 'Invented ordinary comment.' }, Time: { timestamp: 1_600_000_003 } },
};
const ordered = (paths: ShapePath[]) => paths.sort((a, b) => a.path < b.path ? -1 : 1);
function withStream(reader: ArchiveReader, streamText: ArchiveReader['streamText']): ArchiveReader {
  return { archives: reader.archives, rejectedEntries: reader.rejectedEntries,
    list: () => reader.list(), readText: (entry, options) => reader.readText(entry, options),
    close: () => reader.close(), streamText };
}
// The oracle is authored from the hand-built rows above, not rowShape/KEYS.
const noCommentShape: ShapePath[] = ordered([
  { path: '$', types: ['object'] },
  { path: '$.<key>', types: ['array'] },
  { path: '$.<key>[]', types: ['object'] },
  { path: '$.<key>[].<key>', types: ['string'] },
  { path: mapPath, types: ['object'] },
  { path: `${mapPath}.<Media Owner>`, types: ['object'] },
  { path: `${mapPath}.<Media Owner>.<value>`, types: ['string'] },
  { path: `${mapPath}.<Time>`, types: ['object'] },
  { path: `${mapPath}.<Time>.<timestamp>`, types: ['number'] },
]);
const malformedShape: ShapePath[] = ordered([
  { path: '$', types: ['object'] },
  { path: '$.<key>', types: ['string'] },
  { path: mapPath, types: ['object'] },
  { path: `${mapPath}.<Comment>`, types: ['object'] },
  { path: `${mapPath}.<Comment>.<value>`, types: ['number'] },
  { path: `${mapPath}.<Time>`, types: ['object'] },
  { path: `${mapPath}.<Time>.<timestamp>`, types: ['number'] },
]);
function noSecrets(value: unknown): void {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const secret of [textSecret, handleSecret, urlSecret, 'invented_extra_array', 'invented_media_key', 'invented_private_value']) assert.ok(!serialized.includes(secret.toLowerCase()));
}
test('hand-built Instagram rows use adapter null decisions and exactly two authored rejected shapes', async () => {
  const reader = createMemoryArchive('invented', { [commentFile]: JSON.stringify([missingText(1_600_000_000), missingText(1_600_000_001), malformedRow, validRow]) });
  try {
    const rows = await inspectRows(reader, 'instagram', reader.list());
    assert.deepEqual(rows, [{
      label: 'file-1', pattern: 'your_instagram_activity/comments/<post_comments_N>.json',
      rowParser: 'instagram-comment', rowsSeen: 4, rowsRejected: 3, streamError: false,
      rejectedShapes: [{ paths: noCommentShape, count: 2 }, { paths: malformedShape, count: 1 }],
    }]);
    noSecrets(rows);
  } finally { await reader.close(); }
});
test('one wrapped array is streamed, validates its tail and preserves rejected-row counts', async () => {
  const content = JSON.stringify({ comments_reels_comments: [missingText(1_600_000_000), missingText(1_600_000_001), malformedRow, validRow] });
  const path = 'your_instagram_activity/comments/reels_comments.json';
  const original = createMemoryArchive('invented', { [path]: content });
  const reader = withStream(original, () => {
    return (async function* () { for (const char of content) yield char; })();
  });
  try {
    const [rows] = await inspectRows(reader, 'instagram', reader.list());
    assert.equal(rows!.rowsSeen, 4);
    assert.equal(rows!.rowsRejected, 3);
    assert.equal(rows!.streamError, false);
    assert.deepEqual(rows!.rejectedShapes, [{ paths: noCommentShape, count: 2 }, { paths: malformedShape, count: 1 }]);
    for (const tail of [',"unexpected":1}', '']) {
      const corrupted = withStream(original, () => {
        return (async function* () { yield content.slice(0, -1) + tail; })();
      });
      const [failed] = await inspectRows(corrupted, 'instagram', corrupted.list());
      assert.equal(failed!.rowsSeen, 4);
      assert.equal(failed!.rowsRejected, 3);
      assert.equal(failed!.streamError, true);
    }
  } finally { await original.close(); }
});
test('legacy arrays delegate to parseLegacyComment instead of current comment rules', async () => {
  const reader = createMemoryArchive('invented', { 'comments.json': JSON.stringify([
    [1_600_000_000, 'Invented legacy text.', handleSecret],
    ['not-a-time', textSecret, handleSecret],
  ]) });
  try {
    const [rows] = await inspectRows(reader, 'instagram', reader.list());
    assert.equal(rows!.rowParser, 'instagram-legacy-comment');
    assert.equal(rows!.rowsSeen, 2); assert.equal(rows!.rowsRejected, 1);
    assert.deepEqual(rows!.rejectedShapes, [{ paths: [{ path: '$', types: ['array'] }, { path: '$[]', types: ['string'] }], count: 1 }]);
    noSecrets(rows);
  } finally { await reader.close(); }
});
test('mid-file thrown stream records the valid prefix and symbolic error truth only', async () => {
  const original = createMemoryArchive('invented', { [commentFile]: 'unused' });
  const reader = withStream(original, () => {
    return (async function* () {
      yield `[${JSON.stringify(missingText(1_600_000_000))},`;
      throw new Error(`${textSecret} ${handleSecret} ${urlSecret}`);
    })();
  });
  try {
    const [rows] = await inspectRows(reader, 'instagram', reader.list());
    assert.equal(rows!.rowsSeen, 1); assert.equal(rows!.rowsRejected, 1); assert.equal(rows!.streamError, true);
    assert.deepEqual(rows!.rejectedShapes, [{ paths: noCommentShape, count: 1 }]);
    noSecrets(rows);
  } finally { await original.close(); }
});
test('malformed JSON counts complete elements only and marks stream error rather than an invented row', async () => {
  const reader = createMemoryArchive('invented', { [commentFile]: `[${JSON.stringify(validRow)},invalid]` });
  try {
    const [rows] = await inspectRows(reader, 'instagram', reader.list());
    assert.equal(rows!.rowsSeen, 1); assert.equal(rows!.rowsRejected, 0); assert.equal(rows!.streamError, true);
    assert.deepEqual(rows!.rejectedShapes, []);
  } finally { await reader.close(); }
});
test('X tweets, deleted tweets and community rows call tweetItem; notes explicitly count seen only', async () => {
  const target = (name: string) => ['window', 'YTD', name, 'part0'].join('.');
  const good = { tweet: { id_str: '9999000001', full_text: 'Invented X text.', created_at: 'Wed Oct 10 20:19:24 +0000 2018' } };
  const bad = { tweet: { id_str: '9999000002', full_text: textSecret, created_at: 'broken', invented_private_key: handleSecret } };
  const reader = createMemoryArchive('invented', {
    'data/tweets.js': `${target('tweets')} = ${JSON.stringify([good, bad])};`,
    'data/deleted-tweets.js': `${target('deleted_tweets')} = ${JSON.stringify([good, bad])};`,
    'data/community-tweet.js': `${target('community_tweet')} = ${JSON.stringify([good, bad])};`,
    'data/note-tweet.js': `${target('note_tweet')} = ${JSON.stringify([{ noteTweet: { core: { text: textSecret } } }])};`,
    'data/account.js': `${target('account')} = [];`,
  });
  try {
    const rows = await inspectRows(reader, 'x', reader.list());
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.equal(row.streamError, false);
      if (row.rowParser === 'x-tweet') {
        assert.equal(row.rowsSeen, 2); assert.equal(row.rowsRejected, 1);
        assert.equal(row.rejectedShapes.length, 1);
      } else {
        assert.equal(row.rowParser, 'seen-only'); assert.equal(row.rowsSeen, 1);
        assert.equal(row.rowsRejected, null); assert.deepEqual(row.rejectedShapes, []);
      }
    }
    noSecrets(rows);
  } finally { await reader.close(); }
});
test('first ten distinct projected rejected shapes are bounded while every rejected row is counted', async () => {
  // Distinct depths rather than personal key names, which intentionally merge.
  const rows = Array.from({ length: 12 }, (_, index) => {
    let value: unknown = null;
    for (let depth = 0; depth < index; depth++) value = [value];
    return { invented_unknown: value };
  });
  rows.push(rows[0]!);
  const reader = createMemoryArchive('invented', { [commentFile]: JSON.stringify(rows) });
  try {
    const [result] = await inspectRows(reader, 'instagram', reader.list());
    assert.equal(result!.rowsSeen, 13); assert.equal(result!.rowsRejected, 13);
    assert.equal(result!.rejectedShapes.length, 10);
    assert.equal(result!.rejectedShapes[0]!.count, 2);
    assert.equal(result!.rejectedShapes.reduce((sum, shape) => sum + shape.count, 0), 11);
  } finally { await reader.close(); }
});
test('real report includes row audit and rejects raw keys, invalid counts and signature overflow', { timeout: 120_000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'socialprune-s4-round2-synthetic-'));
  const input = join(temp, 'instagram-invented_fern-2026-01-02-z8q5rs');
  const file = join(input, commentFile);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify([missingText(1_600_000_000), missingText(1_600_000_001), malformedRow, validRow]));
  try {
    const report = await checkInputs([input]);
    validateReport(report);
    assert.equal(report.import.status, 'partial');
    const rows = report.structure.parserRead[1]!.rowFiles;
    assert.equal(rows.length, 1); assert.equal(rows[0]!.rowsSeen, 4); assert.equal(rows[0]!.rowsRejected, 3);
    assert.deepEqual(rows[0]!.rejectedShapes, [{ paths: noCommentShape, count: 2 }, { paths: malformedShape, count: 1 }]);
    noSecrets(report);
    const mutations: ((report: Report) => void)[] = [
      (report) => { report.structure.parserRead[1]!.rowFiles[0]!.rejectedShapes[0]!.paths[1]!.path = '$.<invented_private_key>'; },
      (report) => { report.structure.parserRead[1]!.rowFiles[0]!.rowsRejected = 5; },
      (report) => { report.structure.parserRead[1]!.rowFiles[0]!.streamError = 'true' as never; },
      (report) => { report.structure.parserRead[1]!.rowFiles[0]!.rowParser = 'seen-only'; },
      (report) => { report.structure.parserRead[1]!.rowFiles[0]!.rejectedShapes[0]!.count = 9; },
      (report) => { report.structure.parserRead[1]!.rowFiles[0]!.rejectedShapes[0]!.paths.reverse(); },
      (report) => { report.structure.parserRead[1]!.rowFiles[0]!.rejectedShapes = Array(11).fill(report.structure.parserRead[1]!.rowFiles[0]!.rejectedShapes[0]!); },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(report);
      mutate(changed);
      const output: string[] = []; const errors: string[] = [];
      assert.equal(printReport(changed, { stdout: (text) => output.push(text), stderr: (code) => errors.push(code) }), 1);
      assert.deepEqual(output, []); assert.deepEqual(errors, ['S4_REPORT_INVALID\n']);
    }
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test('new key vocabulary remains names only and each group has a checked public citation', async () => {
  const source = await readFile(fileURLToPath(new URL('../schema.ts', import.meta.url)), 'utf8');
  for (const name of ['media_list_data', 'media_map_data', 'uri', 'creation_timestamp', 'media_metadata', 'edit_info', 'initial', 'editTweetIds', 'editableUntil', 'editsRemaining', 'isEditEligible', 'possibly_sensitive', 'userInfo', 'userName', 'displayName', 'mediaDirectory', 'sizeBytes']) assert.ok(KEYS.includes(name as never));
  for (const citation of ['https://github.com/anand-loop/picnic/blob/3dc08d728e339e80336e852d1011956532fd6799/docs/instagram-export-format.md', 'https://stackoverflow.com/questions/72731890/how-to-get-a-pandas-dataframe-from-instagram-json-data', 'https://github.com/alkihis/twitter-archive-reader/blob/a23fb890133553efa850b5c886ffbfb9a0892690/ts/types/ClassicTweets.ts', 'https://gist.github.com/bitsgalore/cfdff3ce67f1ffa85f67e87c778a9e75', 'https://github.com/alkihis/twitter-archive-reader/blob/a23fb890133553efa850b5c886ffbfb9a0892690/ts/types/GDPRManifest.ts']) assert.ok(source.includes(citation));
});
