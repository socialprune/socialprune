import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createMemoryArchive } from '../../../packages/core/src/index.ts';
import type { ArchiveReader } from '../../../packages/core/src/index.ts';
import { inspectRowsWithMedia } from '../rows.ts';
import { mediaPattern } from '../media.ts';
import { checkInputs } from '../report.ts';
import { printReport } from '../check.ts';
import { MEDIA_DIRECTORIES, validPattern, validateReport } from '../schema.ts';
import type { MediaStats, Report, RowFile } from '../schema.ts';

const file = 'your_instagram_activity/comments/post_comments_1.json';
const mapKey = ['string', 'map', 'data'].join('_');
const mediaKey = ['media', 'list', 'data'].join('_');
const secretFilename = 'DISTINCTIVE_INVENTED_MEDIA_BLOSSOM_9123456789012345.jpg';
const secretDirectory = 'invented_owner_orbit';
const secretHost = 'never-output-invented-host.example.org';
const uri = `media/posts/${secretDirectory}/${secretFilename}`;
const remote = `https://${secretHost}/private/${secretFilename}?id=9123456789012345`;
const commentSeconds = 1_600_000_000;
function textRow(text: unknown, media?: unknown): Record<string, unknown> {
  return { [mapKey]: { Comment: { value: text }, Time: { timestamp: commentSeconds } }, ...(media === undefined ? {} : { [mediaKey]: media }) };
}
const rowData = [
  textRow('Invented text on an older post.', [{ uri, creation_timestamp: commentSeconds - 100 }]),
  { [mapKey]: { Time: { timestamp: commentSeconds } }, [mediaKey]: [{ uri: 'media/other/DISTINCTIVE_INVENTED_MEDIA_ONLY.gif', creation_timestamp: commentSeconds }] },
  textRow('Invented URL-bearing text row.', [{ uri: remote, creation_timestamp: commentSeconds + 50 }]),
  textRow('Invented row with an empty list.', []),
  textRow(7, [{ uri: 'media/posts/SECRET_REJECTED_MEDIA.png', creation_timestamp: commentSeconds - 10 }]),
  textRow('Invented row with no list.'),
  textRow('Invented row with two URI forms.', [
    { uri: 'data:image/png;base64,DISTINCTIVE_INVENTED_DATA_BODY', creation_timestamp: commentSeconds },
    { uri: 'opaque:SECRET_INVENTED_OTHER_FORM' },
  ]),
  textRow('Invented row with a carousel.', [
    { uri: 'media/posts/SECRET_CAROUSEL_ONE.jpg', creation_timestamp: commentSeconds - 1 },
    { uri: 'media/posts/SECRET_CAROUSEL_TWO.jpg', creation_timestamp: commentSeconds },
    { uri: 'media/posts/SECRET_CAROUSEL_THREE.jpg', creation_timestamp: commentSeconds + 1 },
  ]),
];
// This oracle is written from rowData, not from production histogram helpers.
const expected: MediaStats = {
  lengths: {
    text: { absent: 1, '0': 1, '1': 2, '2': 1, '3+': 1 },
    mediaOnly: { absent: 0, '0': 0, '1': 1, '2': 0, '3+': 0 },
    rejected: { absent: 0, '0': 0, '1': 1, '2': 0, '3+': 0 },
  },
  uriForms: {
    text: {
      'relative-path': { count: 4, patterns: [{ pattern: 'media/posts/<file>.jpg', count: 3 }, { pattern: 'media/posts/<segment>/<file>.jpg', count: 1 }] },
      'http-url': 1, 'data-url': 1, other: 1,
    },
    mediaOnly: { 'relative-path': { count: 1, patterns: [{ pattern: 'media/other/<file>.gif', count: 1 }] }, 'http-url': 0, 'data-url': 0, other: 0 },
    rejected: { 'relative-path': { count: 1, patterns: [{ pattern: 'media/posts/<file>.png', count: 1 }] }, 'http-url': 0, 'data-url': 0, other: 0 },
  },
  creationTimestamp: {
    text: { present: 4, comparable: 4, equal: 2, earlier: 2, later: 2 },
    mediaOnly: { present: 1, comparable: 1, equal: 1, earlier: 0, later: 0 },
    rejected: { present: 1, comparable: 1, equal: 0, earlier: 1, later: 0 },
  },
};
function noLeaks(value: unknown): void {
  const output = JSON.stringify(value).toLowerCase();
  for (const secret of [secretFilename, secretDirectory, secretHost, '9123456789012345', remote, uri, 'SECRET_REJECTED_MEDIA', 'SECRET_CAROUSEL', 'DISTINCTIVE_INVENTED_DATA_BODY', 'SECRET_INVENTED_OTHER_FORM', 'DISTINCTIVE_INVENTED_MEDIA_ONLY']) assert.ok(!output.includes(secret.toLowerCase()), 'An invented URI component escaped.');
}
function mediaRow(report: Report): RowFile {
  return report.structure.parserRead[1]!.rowFiles[0]!;
}
test('hand-written text, media-only, URL, empty-list and rejected rows have exact media aggregates', async () => {
  const reader = createMemoryArchive('invented', { [file]: JSON.stringify(rowData) });
  try {
    const [rows] = await inspectRowsWithMedia(reader, 'instagram', reader.list());
    assert.equal(rows!.rowsSeen, 8);
    assert.equal(rows!.rowsRejected, 1);
    assert.equal(rows!.streamError, false);
    assert.deepEqual(rows!.mediaStats, expected);
    noLeaks(rows);
  } finally { await reader.close(); }
});
test('legacy accepted empty text is classified as mediaOnly without claiming an attachment exists', async () => {
  const reader = createMemoryArchive('invented', { 'comments.json': JSON.stringify([
    [commentSeconds, 'Invented legacy text.', 'invented_owner'],
    [commentSeconds, '', 'invented_owner'],
    ['invalid-time', 'Invented rejected legacy text.', 'invented_owner'],
  ]) });
  try {
    const [rows] = await inspectRowsWithMedia(reader, 'instagram', reader.list());
    assert.equal(rows!.rowsSeen, 3); assert.equal(rows!.rowsRejected, 1);
    assert.deepEqual(rows!.mediaStats, {
      lengths: {
        text: { absent: 1, '0': 0, '1': 0, '2': 0, '3+': 0 },
        mediaOnly: { absent: 1, '0': 0, '1': 0, '2': 0, '3+': 0 },
        rejected: { absent: 1, '0': 0, '1': 0, '2': 0, '3+': 0 },
      },
      uriForms: {
        text: { 'relative-path': { count: 0, patterns: [] }, 'http-url': 0, 'data-url': 0, other: 0 },
        mediaOnly: { 'relative-path': { count: 0, patterns: [] }, 'http-url': 0, 'data-url': 0, other: 0 },
        rejected: { 'relative-path': { count: 0, patterns: [] }, 'http-url': 0, 'data-url': 0, other: 0 },
      },
      creationTimestamp: {
        text: { present: 0, comparable: 0, equal: 0, earlier: 0, later: 0 },
        mediaOnly: { present: 0, comparable: 0, equal: 0, earlier: 0, later: 0 },
        rejected: { present: 0, comparable: 0, equal: 0, earlier: 0, later: 0 },
      },
    });
  } finally { await reader.close(); }
});
test('relative URI projection admits verified directories only and always removes basenames', () => {
  assert.equal(mediaPattern(uri), 'media/posts/<segment>/<file>.jpg');
  assert.equal(mediaPattern('media/profile/SECRET_NAME.jpg'), 'media/<segment>/<file>.jpg');
  assert.equal(mediaPattern('media/archived_posts/SECRET_NAME.jpg'), 'media/<segment>/<file>.jpg');
  assert.equal(mediaPattern('media/recently_deleted/SECRET_NAME.gif'), 'media/<segment>/<file>.gif');
  assert.equal(mediaPattern('media/reels/9123456789012345/SECRET_NAME.mp4'), 'media/reels/<segment>/<file>.mp4');
  assert.equal(mediaPattern('media/stories/SECRET_NAME.unusual'), 'media/stories/<file>.<extension>');
  assert.equal(mediaPattern('media\\other\\SECRET_NAME.GIF'), 'media/other/<file>.gif');
  assert.equal(mediaPattern('tweets.js'), '<file>.js');
  assert.equal(validPattern('media/posts/<segment>/<file>.jpg', 'media'), true);
  assert.equal(validPattern('media/invented_raw_directory/<file>.jpg', 'media'), false);
  assert.equal(validPattern('data/<file>.jpg', 'media'), false);
});
test('creation timestamps count rows once per relationship and expose missing comparison data', async () => {
  const reader = createMemoryArchive('invented', { [file]: JSON.stringify([
    textRow('Invented row with invalid media timestamp.', [{ uri, creation_timestamp: 'not-a-number' }]),
    { [mapKey]: { Comment: { value: 'Invented translated time label.' }, Zeit: { timestamp: commentSeconds } }, [mediaKey]: [{ uri, creation_timestamp: commentSeconds }] },
    textRow('Invented repeated same relationship.', [{ creation_timestamp: commentSeconds - 1 }, { creation_timestamp: commentSeconds - 2 }]),
    textRow('Invented media entry without creation time.', [{ uri }]),
  ]) });
  try {
    const [rows] = await inspectRowsWithMedia(reader, 'instagram', reader.list());
    assert.equal(rows!.rowsRejected, 0);
    assert.deepEqual(rows!.mediaStats!.creationTimestamp.text, { present: 3, comparable: 1, equal: 0, earlier: 1, later: 0 });
    assert.deepEqual(rows!.mediaStats!.lengths.text, { absent: 0, '0': 0, '1': 3, '2': 1, '3+': 0 });
    noLeaks(rows);
  } finally { await reader.close(); }
});
test('ten retained relative patterns keep complete form totals and repeated known counts', async () => {
  const data = Array.from({ length: 12 }, (_, index) => textRow('Invented pattern case.', [{ uri: `media/posts/${'private/'.repeat(index)}SECRET_ITEM.jpg` }]));
  data.push(data[0]!);
  const reader = createMemoryArchive('invented', { [file]: JSON.stringify(data) });
  try {
    const [rows] = await inspectRowsWithMedia(reader, 'instagram', reader.list());
    const relative = rows!.mediaStats!.uriForms.text['relative-path'];
    assert.equal(rows!.rowsSeen, 13); assert.equal(rows!.rowsRejected, 0);
    assert.equal(relative.count, 13); assert.equal(relative.patterns.length, 10);
    assert.equal(relative.patterns.reduce((sum, entry) => sum + entry.count, 0), 11);
    assert.equal(relative.patterns.find(({ pattern }) => pattern === 'media/posts/<file>.jpg')!.count, 2);
    assert.ok(!JSON.stringify(rows).includes('SECRET_ITEM'));
  } finally { await reader.close(); }
});
test('media counters survive a mid-file failure only for the complete prefix row', async () => {
  const original = createMemoryArchive('invented', { [file]: 'unused' });
  const reader: ArchiveReader = { archives: original.archives, rejectedEntries: original.rejectedEntries,
    list: () => original.list(), readText: (entry, options) => original.readText(entry, options), close: () => original.close(),
    streamText() { return (async function* () { yield `[${JSON.stringify(rowData[0])},`; throw new Error(remote); })(); },
  };
  try {
    const [rows] = await inspectRowsWithMedia(reader, 'instagram', reader.list());
    assert.equal(rows!.rowsSeen, 1); assert.equal(rows!.rowsRejected, 0); assert.equal(rows!.streamError, true);
    assert.deepEqual(rows!.mediaStats!.lengths.text, { absent: 0, '0': 0, '1': 1, '2': 0, '3+': 0 });
    assert.deepEqual(rows!.mediaStats!.creationTimestamp.text, { present: 1, comparable: 1, equal: 0, earlier: 1, later: 0 });
    noLeaks(rows);
  } finally { await original.close(); }
});
test('actual report includes strict mediaStats and rejects raw directories or inconsistent sums', { timeout: 120_000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'socialprune-s4-media-synthetic-'));
  const input = join(temporary, 'instagram-invented_fern-2026-01-02-q8r7zs');
  const destination = join(input, file);
  await mkdir(join(destination, '..'), { recursive: true });
  await writeFile(destination, JSON.stringify(rowData));
  try {
    const report = await checkInputs([input]);
    validateReport(report);
    assert.deepEqual(mediaRow(report).mediaStats, expected);
    noLeaks(report);
    const mutations: ((report: Report) => void)[] = [
      (report) => { mediaRow(report).mediaStats!.uriForms.text['relative-path'].patterns[0]!.pattern = 'media/invented_raw_directory/<file>.jpg'; },
      (report) => { mediaRow(report).mediaStats!.lengths.text['1']++; },
      (report) => { mediaRow(report).mediaStats!.lengths.rejected['1'] = 0; mediaRow(report).mediaStats!.lengths.text['1']++; },
      (report) => { mediaRow(report).mediaStats!.uriForms.text['http-url'] = -1; },
      (report) => { mediaRow(report).mediaStats!.creationTimestamp.text.present = 7; },
      (report) => { mediaRow(report).mediaStats!.creationTimestamp.text.equal = 6; },
      (report) => { mediaRow(report).mediaStats!.creationTimestamp.text.comparable = 0; },
      (report) => { mediaRow(report).mediaStats!.uriForms.text['relative-path'].patterns = Array(11).fill({ pattern: 'media/posts/<file>.jpg', count: 1 }); },
      (report) => { (mediaRow(report).mediaStats!.lengths as unknown as Record<string, unknown>).inventedClass = {}; },
    ];
    for (const mutate of mutations) {
      const candidate = structuredClone(report);
      mutate(candidate);
      const stdout: string[] = []; const stderr: string[] = [];
      assert.equal(printReport(candidate, { stdout: (text) => stdout.push(text), stderr: (code) => stderr.push(code) }), 1);
      assert.deepEqual(stdout, []); assert.deepEqual(stderr, ['S4_REPORT_INVALID\n']);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
test('media directory allowlist cites the publicly verified folder tree, not inferred file names', async () => {
  assert.deepEqual([...MEDIA_DIRECTORIES], ['media', 'posts', 'stories', 'reels', 'igtv', 'other']);
  const schema = await readFile(fileURLToPath(new URL('../schema.ts', import.meta.url)), 'utf8');
  assert.ok(schema.includes('https://github.com/anand-loop/picnic/blob/3dc08d728e339e80336e852d1011956532fd6799/docs/instagram-export-format.md'));
  for (const name of ['profile', 'archived_posts', 'recently_deleted']) assert.ok(!MEDIA_DIRECTORIES.includes(name as never));
});
