import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { importArchive } from '@socialprune/core';
import type { Item } from '@socialprune/core';
import { openArchivePaths } from '@socialprune/core/node';
import {
  generateLarge,
  largeEntries,
} from '../../../tools/fixture-gen/src/x/index.ts';
import { xAdapter } from './index.ts';

test('large ZIP is seeded, streamed, ZIP64-capable and refuses overwrite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'socialprune-x-large-'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const first = join(root, 'first.zip');
    const second = join(root, 'second.zip');
    await generateLarge({ out: first, count: 205, seed: 17, zip64: true });
    await generateLarge({ out: second, count: 205, seed: 17, zip64: true });
    expect(await readFile(second)).toEqual(await readFile(first));
    const zip = await readFile(first);
    expect(zip.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBeGreaterThan(
      0,
    );
    const reader = await openArchivePaths([first]);
    try {
      const items: Item[] = [];
      const result = await importArchive(reader, [xAdapter], {
        onItems(batch) {
          items.push(...batch);
        },
      });
      expect(result.status).toBe('ok');
      expect(items).toHaveLength(205);
      const long = items.filter((item) => item.text.length > 280);
      expect(long).toHaveLength(2);
      expect(long.every((item) => item.kind === 'post')).toBe(true);
      expect(new Set(items.map((item) => item.id)).size).toBe(205);
      const size = (await stat(first)).size;
      await expect(
        generateLarge({ out: first, count: 205, seed: 17 }),
      ).rejects.toMatchObject({ code: 'EEXIST' });
      expect((await stat(first)).size).toBe(size);
    } finally {
      await reader.close();
    }
  } finally {
    log.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test('entry streams have bounded chunks and changed seed changes tweet data', async () => {
  async function tweets(seed: number): Promise<string> {
    for await (const entry of largeEntries({ count: 100, seed })) {
      if (entry.path !== 'data/tweets.js') continue;
      expect(entry.content).toBeInstanceOf(ReadableStream);
      const chunks: Uint8Array[] = [];
      for await (const chunk of entry.content as ReadableStream<Uint8Array>) {
        expect(chunk.byteLength).toBeLessThan(128 * 1024);
        chunks.push(chunk);
      }
      const content = Buffer.concat(chunks).toString('utf8');
      const parsed: unknown = JSON.parse(
        content.slice(content.indexOf('[')).trim().replace(/;$/, ''),
      );
      expect(Array.isArray(parsed)).toBe(true);
      if (!Array.isArray(parsed)) throw new Error('Expected tweet array.');
      for (const value of parsed as unknown[]) {
        const row = value as { tweet: { full_text: string } };
        expect(typeof row.tweet.full_text).toBe('string');
        expect(row.tweet.full_text.length).toBeGreaterThanOrEqual(10);
        expect(row.tweet.full_text.length).toBeLessThanOrEqual(280);
      }
      return content;
    }
    throw new Error('Missing tweet stream.');
  }
  expect(await tweets(1)).not.toBe(await tweets(2));
}, 60_000);
