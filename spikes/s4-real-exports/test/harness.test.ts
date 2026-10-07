import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { parseJsonArrayStream } from '../../../packages/core/src/index.ts';
import { writeZipFile } from '../../../tools/fixture-gen/src/shared/zip.ts';
import { checkInputs } from '../report.ts';
import { printReport } from '../check.ts';
import { difference, pattern, sizeClass } from '../projection.ts';
import { validateReport } from '../schema.ts';
import type { Report, ShapeFile } from '../schema.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixtures = join(root, 'fixtures/synthetic');
const temporary = await mkdtemp(join(tmpdir(), 'socialprune-s4-synthetic-'));
const rootFiles = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'];
const rootBefore = await Promise.all(rootFiles.map((path) => readFile(join(root, path))));
after(async () => { await rm(temporary, { recursive: true, force: true }); });

interface ExpectedRecord {
  platform: 'x' | 'instagram'; variant: string | null;
  accounts: { key: string; handle: string | null }[]; itemCount: number;
  diagnostics: { category: string; status: string; count: number; files: string[] }[];
}
interface ExpectedItem {
  platform: 'x' | 'instagram'; id: string;
  account: { key: string; handle: string | null };
  kind: keyof Report['import']['records'][number]['kinds']; mediaCount: number | null;
  engagement: { likes: number | null; reposts: number | null };
}
interface Fixture {
  platform: 'x' | 'instagram'; id: string; paths: string[]; archives: string[];
  expected: { status: Report['import']['status']; records: ExpectedRecord[]; items: ExpectedItem[] };
}
const variants: Fixture[] = [];
for (const platform of ['x', 'instagram'] as const) {
  for (const variant of (await readdir(join(fixtures, platform), { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const path = join(fixtures, platform, variant.name);
    const metadata = JSON.parse(await readFile(join(path, 'variant.json'), 'utf8')) as { archives: string[] };
    variants.push({ platform, id: variant.name, archives: metadata.archives,
      paths: metadata.archives.map((name) => join(path, name)),
      expected: JSON.parse(await readFile(join(path, 'expected.json'), 'utf8')) as Fixture['expected'],
    });
  }
}
async function files(directory: string, prefix = ''): Promise<{ path: string; content: Uint8Array }[]> {
  const output: { path: string; content: Uint8Array }[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...await files(join(directory, entry.name), path));
    else if (entry.isFile()) output.push({ path, content: await readFile(join(directory, entry.name)) });
    else throw new Error('Synthetic input must not contain links.');
  }
  return output.sort((a, b) => a.path < b.path ? -1 : 1);
}
function leaves(value: unknown, result: Set<string>): void {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value);
    if (text.length >= 4) result.add(text);
  } else if (Array.isArray(value)) for (const entry of value as unknown[]) leaves(entry, result);
  else if (value && typeof value === 'object') for (const entry of Object.values(value)) leaves(entry, result);
}
function literals(content: string, result: Set<string>): void {
  // Lexical fallback includes readable records in deliberately malformed JS
  // and decoded literals in injection fixtures, without executing the input.
  for (const match of content.matchAll(/"(?:[^"\\\r\n]|\\.)*"/g)) {
    if (/^\s*:/.test(content.slice(match.index + match[0].length))) continue;
    try { leaves(JSON.parse(match[0]) as unknown, result); } catch { /* Not a JSON literal. */ }
  }
  for (const match of content.matchAll(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
    if (/\d|\w/.test(content[match.index - 1] ?? '') || /\d|\w/.test(content[match.index + match[0].length] ?? '')) continue;
    if (match[0].length >= 4) result.add(match[0]);
  }
}
async function inputLeaves(content: string, result: Set<string>): Promise<void> {
  try { leaves(JSON.parse(content) as unknown, result); return; } catch { /* Assigned or malformed JS. */ }
  async function* chunks() { yield content; }
  try {
    const parser = parseJsonArrayStream(chunks(), { assignment: 'allowed' });
    for await (const element of parser) leaves(element, result);
    await parser.target;
    return;
  } catch { /* The fallback still examines readable literals, never eval. */ }
  const first = content.indexOf('{');
  if (first >= 0) {
    try { leaves(JSON.parse(content.slice(first).trim().replace(/;$/, '')) as unknown, result); return; }
    catch { /* Retain malformed and injection literals below. */ }
  }
  literals(content, result);
}
async function forbidden(fixture: Fixture): Promise<Set<string>> {
  const result = new Set<string>(fixture.archives);
  for (const record of fixture.expected.records) for (const account of record.accounts) {
    result.add(account.key); if (account.handle) result.add(account.handle);
  }
  for (const item of fixture.expected.items) {
    result.add(item.account.key); if (item.account.handle) result.add(item.account.handle);
  }
  for (const name of fixture.archives) {
    const instagram = /^instagram-(.+)-\d{4}-\d{2}-\d{2}-([a-z0-9]+)(?:_\d+)?$/i.exec(name);
    if (instagram) { result.add(instagram[1]!); result.add(instagram[2]!); }
    const x = /^twitter-\d{4}-\d{2}-\d{2}-([a-z0-9]+)$/i.exec(name);
    if (x) result.add(x[1]!);
  }
  for (const directory of fixture.paths) for (const file of await files(directory)) {
    const text = Buffer.from(file.content).toString('utf8');
    if (/\.(?:json|js)$/i.test(file.path)) await inputLeaves(text, result);
    else if (/\.(?:html?|txt|csv)$/i.test(file.path)) {
      if (text.length >= 4) result.add(text);
      for (const leaf of text.split(/<[^>]*>/)) if (leaf.trim().length >= 4) result.add(leaf.trim());
    }
  }
  return result;
}
function noForbidden(text: string, values: Iterable<string>): void {
  const lower = text.toLowerCase();
  for (const value of values) assert.ok(!lower.includes(value.toLowerCase()), `Synthetic forbidden value escaped: ${JSON.stringify(value)}`);
}
function compare(report: Report, fixture: Fixture): void {
  validateReport(report);
  assert.equal(report.import.status, fixture.expected.status);
  for (const adapter of report.adapters) {
    const expected = fixture.expected.records.find(({ platform }) => platform === adapter.platform);
    if (expected) {
      assert.equal(adapter.result, 'match');
      assert.equal(adapter.variant, expected.variant);
    } else if (fixture.expected.status === 'html-export' && adapter.platform === fixture.platform) {
      assert.equal(adapter.result, 'html-export');
      assert.equal(adapter.variant, 'html');
    } else {
      assert.equal(adapter.result, 'no-match');
      assert.equal(adapter.variant, null);
    }
  }
  assert.equal(report.import.records.length, fixture.expected.records.length);
  for (const [index, record] of report.import.records.entries()) {
    const expected = fixture.expected.records[index]!;
    const items = fixture.expected.items.filter(({ platform }) => platform === expected.platform);
    assert.equal(record.platform, expected.platform);
    assert.equal(record.variant, expected.variant);
    assert.equal(record.accountCount, expected.accounts.length);
    assert.equal(record.accountsWithHandle, expected.accounts.filter(({ handle }) => handle !== null).length);
    assert.equal(record.accountsWithoutHandle, expected.accounts.filter(({ handle }) => handle === null).length);
    assert.equal(record.itemCount, expected.itemCount);
    for (const kind of Object.keys(record.kinds) as (keyof typeof record.kinds)[]) assert.equal(record.kinds[kind], items.filter((item) => item.kind === kind).length);
    assert.equal(record.withMedia, items.filter(({ mediaCount }) => mediaCount !== null && mediaCount > 0).length);
    assert.equal(record.unknownLikes, items.filter(({ engagement }) => engagement.likes === null).length);
    assert.equal(record.unknownReposts, items.filter(({ engagement }) => engagement.reposts === null).length);
    assert.equal(record.duplicates, expected.diagnostics.filter(({ category }) => category === 'duplicate-items').reduce((sum, diagnostic) => sum + diagnostic.count, 0));
    assert.equal(record.conflicts, expected.diagnostics.filter(({ category }) => category === 'conflicting-items').reduce((sum, diagnostic) => sum + diagnostic.count, 0));
    assert.deepEqual(record.diagnostics, expected.diagnostics.map(({ category, status, count, files }) => ({ category, status, count, fileCount: files.length })));
    assert.equal(report.adapters.find(({ platform }) => platform === record.platform)?.result, 'match');
  }
  for (const value of report.structure.otherFiles) assert.deepEqual(Object.keys(value).sort(), ['count', 'pattern']);
  assert.ok(report.performance.peakRssBytes > 0);
  assert.ok(report.performance.importMs >= 0);
}

let control: Report | undefined;
test('synthetic corpus contains both platforms and all registered variants', () => {
  return Promise.all([
    import('../../../tools/fixture-gen/src/x/index.ts'),
    import('../../../tools/fixture-gen/src/instagram/index.ts'),
  ]).then(([x, instagram]) => {
    for (const [platform, registered] of [['x', x.variants], ['instagram', instagram.variants]] as const) {
      assert.ok(registered.length > 0, `${platform} must register at least one variant`);
      const corpusIds = variants.filter((variant) => variant.platform === platform).map(({ id }) => id).sort();
      assert.equal(corpusIds.length, registered.length);
      assert.deepEqual(corpusIds, registered.map(({ id }) => id).sort());
    }
  });
});
for (const fixture of variants) {
  test(`${fixture.platform}/${fixture.id}: folder and ZIP counts plus input-derived privacy`, { timeout: 120_000 }, async () => {
    const secretValues = await forbidden(fixture);
    const folder = await checkInputs(fixture.paths);
    compare(folder, fixture);
    noForbidden(JSON.stringify(folder), secretValues);
    assert.equal(folder.inputs.length, fixture.paths.length);
    const out = join(temporary, fixture.platform, fixture.id);
    await mkdir(out, { recursive: true });
    const zipPaths: string[] = [];
    for (const path of fixture.paths) {
      const zip = join(out, `${basename(path)}.zip`);
      await writeZipFile(zip, await files(path));
      zipPaths.push(zip);
    }
    const zipped = await checkInputs(zipPaths);
    compare(zipped, fixture);
    noForbidden(JSON.stringify(zipped), [...secretValues, ...zipPaths.map((path) => basename(path))]);
    assert.ok(zipped.inputs.every(({ kind }) => kind === 'zip'));
    assert.deepEqual(zipped.structure, folder.structure);
    assert.deepEqual(zipped.adapters, folder.adapters);
    if (!control && fixture.platform === 'x' && fixture.id === 'current-minimal') control = folder;
  });
}
test('duplicate download names, hostile keys, private messages and two-level nesting do not escape', { timeout: 120_000 }, async () => {
  const name = 'instagram-planted_handle-2026-01-02-q7zr9x (1)';
  const content = JSON.stringify([{
    [['media', 'owner'].join('_')]: 'planted_owner',
    [['string', 'map', 'data'].join('_')]: {
      Comment: { value: 'Distinctive invented comment payload.', timestamp: 0 },
      Time: { value: '', timestamp: 1_753_920_000 },
      'Media Owner': { value: 'planted_owner', timestamp: 0 },
    },
    planted_handle: 'SECONDARY_VALUE_NEVER_EMITTED',
    planted_friend: true,
    'someone@example.org': false,
  }]);
  const entries = [
    { path: 'your_instagram_activity/comments/post_comments_1.json', content },
    { path: 'your_instagram_activity/unknown/planted_friend.json', content: JSON.stringify({ planted_friend: true, 'someone@example.org': 'UNKNOWN_VALUE_NEVER_EMITTED' }) },
    { path: 'your_instagram_activity/messages/inbox/planted_friend/message_1.json', content: '{"messages":[{"content":"DISTINCTIVE_PRIVATE_MESSAGE_NEVER_EMITTED"}]}' },
  ];
  const zip = join(temporary, `${name}.zip`);
  await writeZipFile(zip, entries);
  const nested = join(temporary, 'nested');
  await mkdir(nested);
  const nestedEntries = entries.map(({ path, content }) => ({ path: `invented-wrapper/${name}/${path}`, content }));
  for (const { path, content } of nestedEntries) {
    const destination = join(nested, path);
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, content);
  }
  const original = fs.createReadStream;
  const opened: string[] = [];
  fs.createReadStream = (path, options) => {
    const name = String(path).replaceAll('\\', '/');
    opened.push(name);
    assert.ok(!name.includes('/messages/'), 'Private synthetic content must never be opened.');
    assert.ok(!name.includes('/unknown/'), 'Unknown synthetic content must never be opened.');
    return original(path, options);
  };
  syncBuiltinESMExports();
  try {
    for (const inputs of [[zip], [nested], [zip, nested]]) {
      const report = await checkInputs(inputs);
      validateReport(report);
      noForbidden(JSON.stringify(report), [name, 'planted_handle', 'q7zr9x', 'planted_friend', 'someone@example.org', 'DISTINCTIVE_PRIVATE_MESSAGE_NEVER_EMITTED', 'Distinctive invented comment payload.', 'SECONDARY_VALUE_NEVER_EMITTED', 'UNKNOWN_VALUE_NEVER_EMITTED']);
      assert.ok(report.inputs.every(({ privateEntriesSkipped }) => privateEntriesSkipped === 1));
      assert.ok(report.structure.otherFiles.length > 0);
    }
    // The two-level copy is unrecognized by both adapters. It is inventoried
    // without reading any file content, rather than suffix-matched as comments.
    assert.deepEqual(opened, []);
  } finally {
    fs.createReadStream = original;
    syncBuiltinESMExports();
  }
});

test('negative output control and strict validator suppress every extra or malformed field', () => {
  assert.ok(control);
  const broken = { ...structuredClone(control), archives: ['twitter-planted-control-name'] };
  assert.throws(() => noForbidden(JSON.stringify(broken), ['twitter-planted-control-name']));
  assert.throws(() => validateReport(broken));
  const mutations: ((report: Report) => void)[] = [
    (report) => { report.inputs[0]!.label = 'planted_handle'; },
    (report) => { report.adapters[0]!.variant = 'planted_handle'; },
    (report) => { report.import.records[0]!.diagnostics[0]!.category = 'planted_handle' as never; },
    (report) => { report.structure.parserRead[0]!.files[0]!.pattern = 'data/planted_handle.js'; },
    (report) => { report.structure.parserRead[0]!.files[0]!.paths[0]!.path = '$.planted_handle'; },
    (report) => { report.performance.importMs = NaN; },
    (report) => { report.import.records[0]!.accountCount++; },
  ];
  for (const mutation of mutations) {
    const output: string[] = [];
    const errors: string[] = [];
    const candidate: Report = structuredClone(control);
    mutation(candidate);
    assert.equal(printReport(candidate, { stdout: (text) => output.push(text), stderr: (code) => errors.push(code) }), 1);
    assert.deepEqual(output, []);
    assert.deepEqual(errors, ['S4_REPORT_INVALID\n']);
  }
  const stdout: string[] = [];
  const stderr: string[] = [];
  assert.equal(printReport(broken, { stdout: (text) => stdout.push(text), stderr: (code) => stderr.push(code) }), 1);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ['S4_REPORT_INVALID\n']);
  const accessor = structuredClone(control);
  Object.defineProperty(accessor.inputs, 'toJSON', { value: () => ({ planted: 'never-serialize-this' }) });
  assert.throws(() => validateReport(accessor));
});
test('structure differences distinguish new paths and new types, with bounded normalization', () => {
  const left: ShapeFile[] = [{ pattern: 'data/<tweets>.js', count: 1, paths: [{ path: '$[].<tweet>.<text>', types: ['string', 'null'] }] }];
  const right: ShapeFile[] = [{ pattern: 'data/<tweets>.js', count: 1, paths: [{ path: '$[].<tweet>.<text>', types: ['string'] }] }];
  assert.deepEqual(difference(left, right), [{ pattern: 'data/<tweets>.js', path: '$[].<tweet>.<text>', types: ['null'] }]);
  assert.deepEqual(difference(right, left), []);
  assert.equal(pattern('invented/planted_handle/data/tweets.js'), '<root>/data/<tweets>.js');
  assert.equal(pattern('planted_handle.json'), '<file>.json');
  assert.deepEqual([0, 9_999_999, 10_000_000, 100_000_000, 1_000_000_000, 4_000_000_000].map(sizeClass), ['under-10-mb', 'under-10-mb', 'under-100-mb', 'under-1-gb', 'under-4-gb', 'larger']);
});
test('real CLI prints exactly one valid report and failures print symbolic stderr only', { timeout: 120_000 }, () => {
  const fixture = variants.find(({ platform, id }) => platform === 'x' && id === 'current-minimal')!;
  const executable = fileURLToPath(new URL('../check.ts', import.meta.url));
  const clean = spawnSync(process.execPath, [executable, ...fixture.paths], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
  assert.equal(clean.status, 0);
  assert.equal(clean.stderr, '');
  assert.equal(clean.stdout.trim().split('\n').length, 1);
  validateReport(JSON.parse(clean.stdout) as unknown);
  const usage = spawnSync(process.execPath, [executable], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(usage.status, 1); assert.equal(usage.stdout, ''); assert.equal(usage.stderr, 'S4_USAGE\n');
  const failure = spawnSync(process.execPath, [executable, join(temporary, 'absent-private-looking-input')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(failure.status, 1); assert.equal(failure.stdout, ''); assert.equal(failure.stderr, 'S4_CHECK_FAILED\n');
});
test('dependency-free spike leaves root package, workspace and lock bytes unchanged', async () => {
  const current = await Promise.all(rootFiles.map((path) => readFile(join(root, path))));
  assert.deepEqual(current, rootBefore);
  const packageJson = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as Record<string, unknown>;
  assert.equal(packageJson.dependencies, undefined); assert.equal(packageJson.devDependencies, undefined);
});
test('one mixed-platform import counts both adapters without retaining exported identities', { timeout: 120_000 }, async () => {
  const x = variants.find(({ platform, id }) => platform === 'x' && id === 'current-minimal')!;
  const instagram = variants.find(({ platform, id }) => platform === 'instagram' && id === 'current-minimal')!;
  const combined: Fixture = { platform: 'x', id: 'joint', paths: [...x.paths, ...instagram.paths], archives: [...x.archives, ...instagram.archives], expected: {
    status: 'ok', records: [...x.expected.records, ...instagram.expected.records], items: [...x.expected.items, ...instagram.expected.items],
  } };
  const report = await checkInputs(combined.paths);
  compare(report, combined);
  assert.ok(report.adapters.every(({ result }) => result === 'match'));
  noForbidden(JSON.stringify(report), await forbidden(combined));
});
