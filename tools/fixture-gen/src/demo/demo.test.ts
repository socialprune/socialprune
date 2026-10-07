import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { expect, test } from 'vitest';
import {
  AssessmentSchema,
  ItemSchema,
  importArchive,
  openZipArchives,
  stableId,
  describeStructure,
} from '@socialprune/core';
import type { Item } from '@socialprune/core';
import { openArchivePaths } from '@socialprune/core/node';
import { deriveState } from '@socialprune/core/workspace/state';
import { xAdapter } from '../../../../packages/adapter-x/src/index.ts';
import { instagramAdapter } from '../../../../packages/adapter-instagram/src/index.ts';
import { inspectText } from '../../../copy-check/src/index.ts';
import { FIXTURES_ROOT } from '../load.ts';
import { FIXTURE_DATE } from '../shared/zip.ts';
import { generateFixtures, readTree } from '../tree.ts';
import { variants as xVariants } from '../x/index.ts';
import { variants as instagramVariants } from '../instagram/index.ts';
import { checkDemo, createDemo, demoFiles, generateDemo } from './index.ts';

const root = join(FIXTURES_ROOT, 'demo');
async function document(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(root, path), 'utf8')) as unknown;
}
async function expectedItems(): Promise<Item[]> {
  const items: Item[] = [];
  for (const platform of ['x', 'instagram']) {
    const value = await document(`${platform}/expected.json`);
    if (!value || typeof value !== 'object' || !('items' in value))
      throw new Error('Expected items missing.');
    items.push(...ItemSchema.array().parse(value.items));
  }
  return items;
}
test('repository demo files match authored deterministic generation and all v2 references', async () => {
  const files = await demoFiles();
  const actual = await readTree(root);
  expect([...actual.keys()].sort()).toEqual([...files.keys()].sort());
  for (const [path, content] of files)
    expect(Buffer.from(actual.get(path)!)).toEqual(Buffer.from(content));
  const items = await expectedItems();
  const assessments = AssessmentSchema.array().parse(
    await document('assessments.json'),
  );
  expect(items.filter(({ platform }) => platform === 'x')).toHaveLength(300);
  expect(items.filter(({ platform }) => platform === 'instagram')).toHaveLength(
    120,
  );
  expect(new Set(items.map(({ id }) => id)).size).toBe(420);
  expect(assessments).toHaveLength(60);
  expect(
    new Set(assessments.map(({ assessmentId }) => assessmentId)).size,
  ).toBe(60);
  expect(
    assessments.filter(({ category }) => category === 'unclear').length,
  ).toBeGreaterThanOrEqual(4);
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of items) {
    for (const reference of [item.reference.replyToId, item.reference.quotedId])
      if (reference) expect(byId.has(`x:${reference}`)).toBe(true);
  }
  for (const assessment of assessments) {
    const item = byId.get(assessment.itemId);
    expect(item).toBeDefined();
    expect(assessment.source.kind).toBe('fixture');
    expect(assessment.source.name).toMatch(/^demo-examples(?:-context)?$/);
    expect(assessment.confidence).toBeNull();
    expect(assessment.submissionId).toBeNull();
    if (assessment.evidence !== null)
      expect(item!.text).toContain(assessment.evidence);
    expect(inspectText(assessment.reason)).toEqual([]);
    expect(assessment.reason).toMatch(
      /^(?:Dieses (?:zweite )?Beispiel|This example)/,
    );
  }
  const frequencies = new Map<string, number>();
  for (const { itemId } of assessments)
    frequencies.set(itemId, (frequencies.get(itemId) ?? 0) + 1);
  expect(items.filter(({ id }) => !frequencies.has(id))).toHaveLength(361);
  expect([...frequencies.values()].filter((count) => count === 2)).toHaveLength(
    1,
  );
  const state = deriveState({
    items,
    assessments,
    decisionEvents: [],
    outcomeEvents: [],
  });
  expect(
    [...state.values()].filter(({ assessments }) => assessments.length === 2),
  ).toHaveLength(1);
  expect(
    [...state.values()].every(
      ({ decision, outcome }) =>
        decision === 'undecided' && outcome === 'unknown',
    ),
  ).toBe(true);
  const manifest = (await createDemo()).manifest;
  expect(await document('manifest.json')).toEqual(manifest);
  expect(manifest.languages).toEqual({
    x: { de: 150, en: 150 },
    instagram: { de: 60, en: 60 },
  });
  for (const copy of Object.values(manifest.banner))
    expect(inspectText(copy)).toEqual([]);
}, 60_000);

test('demo ID oracle comes from raw export data and documented identity parts, never an adapter', async () => {
  const demo = await createDemo();
  const x = demo.exports[0]!;
  const raw = x.files['data/tweets.js']!;
  const tweets = JSON.parse(
    raw.slice(raw.indexOf('[')).trim().replace(/;$/, ''),
  ) as { tweet: { id_str: string } }[];
  expect(tweets.map(({ tweet }) => `x:${tweet.id_str}`)).toEqual(
    x.expected.items.map(({ id }) => id),
  );
  const instagram = demo.exports[1]!;
  const expectedIds: string[] = [];
  const occurrences = new Map<string, number>();
  for (const [path, content] of Object.entries(instagram.files)) {
    const parsed: unknown = JSON.parse(content);
    const rows = path.endsWith('reels_comments.json')
      ? (parsed as { comments_reels_comments: unknown[] })
          .comments_reels_comments
      : (parsed as unknown[]);
    for (const value of rows) {
      const map = (value as Record<string, unknown>)[
        ['string', 'map', 'data'].join('_')
      ] as Record<string, { value: string; timestamp: number }>;
      const parts = [
        instagram.expected.items[0]!.account.key,
        new Date(map.Time!.timestamp * 1000).toISOString(),
        map['Media Owner']!.value,
        map.Comment!.value,
      ];
      const tuple = JSON.stringify(parts);
      const ordinal = (occurrences.get(tuple) ?? 0) + 1;
      occurrences.set(tuple, ordinal);
      expectedIds.push(
        `instagram:${await stableId(ordinal === 1 ? parts : [...parts, String(ordinal)])}`,
      );
    }
  }
  expect(expectedIds).toEqual(instagram.expected.items.map(({ id }) => id));
  const items = [...x.expected.items, ...instagram.expected.items];
  const xItems = x.expected.items;
  for (const kind of ['post', 'reply', 'repost', 'quote'])
    expect(xItems.filter((item) => item.kind === kind).length).toBeGreaterThan(
      0,
    );
  expect(xItems.filter(({ text }) => text.length > 280)).toHaveLength(3);
  expect(
    xItems.filter(({ text, mediaCount }) => text === '' && mediaCount! > 0),
  ).toHaveLength(3);
  expect(
    xItems.filter(({ text, mediaCount }) => text === '' && mediaCount === 0),
  ).toHaveLength(2);
  expect(
    items.some(({ text }) => text.includes('Ignore previous instructions')),
  ).toBe(true);
  expect(items.some(({ text }) => text.includes('<b>mehr Pausen</b>'))).toBe(
    true,
  );
  for (const item of items) {
    expect(item.id.startsWith(`${item.platform}:`)).toBe(true);
    for (const email of item.text.matchAll(/[\w.-]+@([\w.-]+\.[a-z]+)/g))
      expect(['example.com', 'example.org']).toContain(email[1]);
    for (const phone of item.text.matchAll(/\b\d{3}-555-(\d{4})\b/g))
      expect(Number(phone[1])).toBeGreaterThanOrEqual(100);
    for (const phone of item.text.matchAll(/\b\d{3}-555-(\d{4})\b/g))
      expect(Number(phone[1])).toBeLessThanOrEqual(199);
    for (const phone of item.text.matchAll(/\b07700 (\d{6})\b/g))
      expect(Number(phone[1])).toBeGreaterThanOrEqual(900000);
    for (const phone of item.text.matchAll(/\b07700 (\d{6})\b/g))
      expect(Number(phone[1])).toBeLessThanOrEqual(900999);
  }
}, 60_000);

test.each(['directory', 'zip'] as const)(
  'demo exports import exactly through real adapters as %s and injection text stays inert',
  async (as) => {
    const demo = await createDemo();
    const planted = globalThis as typeof globalThis & { __pwned?: unknown };
    expect(planted.__pwned).toBeUndefined();
    for (const entry of demo.exports) {
      const directory = join(root, entry.platform, entry.archive);
      let archive;
      if (as === 'directory') archive = await openArchivePaths([directory]);
      else {
        const writer = new ZipWriter(new BlobWriter('application/zip'), {
          useWebWorkers: false,
          useCompressionStream: true,
          lastModDate: FIXTURE_DATE,
          rawLastModDate: 0x28210000,
          extendedTimestamp: false,
        });
        for (const [path, content] of await readTree(directory))
          await writer.add(path, new Uint8ArrayReader(content));
        archive = await openZipArchives([
          { name: entry.archive, blob: await writer.close() },
        ]);
      }
      try {
        const items: Item[] = [];
        const summary = await importArchive(
          archive,
          [entry.platform === 'x' ? xAdapter : instagramAdapter],
          {
            onItems(batch) {
              items.push(...batch);
            },
          },
        );
        const records = summary.records.map(
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
        );
        expect({ status: summary.status, records, items }).toEqual(
          entry.expected,
        );
      } finally {
        await archive.close();
      }
    }
    expect(planted.__pwned).toBeUndefined();
  },
  60_000,
);

test('demo generation repeats byte-identically without modifying other fixture trees', async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'socialprune-demo-determinism-'),
  );
  try {
    const marker = join(temporary, 'other.txt');
    await writeFile(marker, 'leave other trees alone');
    await generateDemo(temporary);
    const first = await readTree(join(temporary, 'demo'));
    await generateDemo(temporary);
    expect(await readTree(join(temporary, 'demo'))).toEqual(first);
    expect(await readFile(marker, 'utf8')).toBe('leave other trees alone');
    expect(await checkDemo(temporary)).toEqual([]);
    const path = join(temporary, 'demo', 'assessments.json');
    const bytes = await readFile(path);
    bytes[bytes.length - 1] = 32;
    await writeFile(path, bytes);
    expect(await checkDemo(temporary)).toEqual(['demo/assessments.json']);
    await rm(join(temporary, 'demo'), { recursive: true });
    expect((await checkDemo(temporary)).length).toBe(first.size);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}, 60_000);

test('all-platform CLI check detects demo byte drift and leaves platform-only checks independent', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'socialprune-demo-cli-'));
  const loader = new URL('../load.ts', import.meta.url).href;
  const script = [
    "import { registerHooks } from 'node:module';",
    `const loader = ${JSON.stringify(loader)};`,
    'registerHooks({ load(url, context, next) {',
    'const result = next(url, context);',
    'if (url === loader) {',
    'const source = typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);',
    'const pattern = /^export const FIXTURES_ROOT = fileURLToPath\\([\\s\\S]*?\\);/m;',
    'if (!pattern.test(source)) throw new Error("Fixture binding changed.");',
    `result.source = source.replace(pattern, ${JSON.stringify(`export const FIXTURES_ROOT = ${JSON.stringify(temporary)};`)});`,
    '} return result; } });',
  ].join('\n');
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [
        '--import',
        `data:text/javascript,${encodeURIComponent(script)}`,
        fileURLToPath(new URL('../cli.ts', import.meta.url)),
        'check',
        ...args,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 },
    );
  try {
    await generateFixtures(
      temporary,
      [...xVariants, ...instagramVariants],
      ['x', 'instagram'],
    );
    await generateDemo(temporary);
    const clean = run();
    expect(clean.error).toBeUndefined();
    expect(clean.status, clean.stderr).toBe(0);
    expect(clean.stdout).toContain('Demo fixtures checked.');
    expect(clean.stdout).toContain(
      `${[...xVariants, ...instagramVariants].length} variant(s), 0 changed file(s).`,
    );
    const path = join(temporary, 'demo', 'assessments.json');
    const bytes = await readFile(path);
    bytes[bytes.length - 1] = 32;
    await writeFile(path, bytes);
    const drift = run();
    expect(drift.error).toBeUndefined();
    expect(drift.status).toBe(1);
    expect(drift.stderr).toContain('demo/assessments.json');
    expect(drift.stdout).toContain('1 changed file(s).');
    const platform = run('--platform', 'x');
    expect(platform.error).toBeUndefined();
    expect(platform.status, platform.stderr).toBe(0);
    expect(platform.stdout).not.toContain('Demo fixtures checked.');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}, 120_000);

test('demo structure preserves privacy at export, platform and whole-demo input shapes', async () => {
  const demo = await createDemo();
  const identities = demo.exports.flatMap(({ archive, expected }) => [
    archive,
    ...expected.records.flatMap(({ accounts }) =>
      accounts.flatMap(({ key, handle }) => (handle ? [key, handle] : [key])),
    ),
  ]);
  for (const path of [
    root,
    ...demo.exports.flatMap(({ platform, archive }) => [
      join(root, platform),
      join(root, platform, archive),
    ]),
  ]) {
    const archive = await openArchivePaths([path]);
    try {
      const rendered = JSON.stringify(
        await describeStructure(archive),
      ).toLowerCase();
      for (const value of identities)
        expect(rendered).not.toContain(value.toLowerCase());
      for (const value of [
        '07700 900123',
        '202-555-0123',
        'laternenbeet@example.org',
        'lanternplot@example.com',
        'ignore previous instructions',
      ])
        expect(rendered).not.toContain(value);
    } finally {
      await archive.close();
    }
  }
}, 60_000);
