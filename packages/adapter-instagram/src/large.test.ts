import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { importArchive } from '@socialprune/core';
import type { Item } from '@socialprune/core';
import { openArchivePaths } from '@socialprune/core/node';
import { generateLarge } from '../../../tools/fixture-gen/src/instagram/index.ts';
import { instagramAdapter } from './index.ts';

test('large generator streams deterministic data, shards at 5000 and honors ZIP64', async () => {
  const base = join(tmpdir(), 'kilo', 'phase1-foundation', 'instagram');
  await mkdir(base, { recursive: true });
  const temporary = await mkdtemp(join(base, 'proof-'));
  try {
    const first = join(temporary, 'instagram-synth_load-2026-07-31-token.zip');
    const second = join(temporary, 'repeat.zip');
    const different = join(temporary, 'different.zip');
    const options = { count: 5600, seed: 17, zip64: true };
    await generateLarge({ ...options, out: first });
    await generateLarge({ ...options, out: second });
    await generateLarge({ ...options, out: different, seed: 18 });
    const bytes = await readFile(first);
    const hash = (data: Uint8Array) =>
      createHash('sha256').update(data).digest('hex');
    expect(hash(await readFile(second))).toBe(hash(bytes));
    expect(hash(await readFile(different))).not.toBe(hash(bytes));
    expect(bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(true);
    const archive = await openArchivePaths([first]);
    try {
      expect(archive.list().map((entry) => entry.path)).toEqual([
        'your_instagram_activity/comments/post_comments_1.json',
        'your_instagram_activity/comments/post_comments_2.json',
        'your_instagram_activity/comments/reels_comments.json',
      ]);
      const items: Item[] = [];
      const imported = await importArchive(archive, [instagramAdapter], {
        onItems(batch) {
          items.push(...batch);
        },
        batchSize: 97,
      });
      expect(imported.status).toBe('ok');
      expect(imported.records[0]?.itemCount).toBe(5600);
      expect(
        imported.records[0]?.diagnostics.find(
          (diagnostic) => diagnostic.category === 'post-comments',
        )?.count,
      ).toBe(5040);
      expect(
        imported.records[0]?.diagnostics.find(
          (diagnostic) => diagnostic.category === 'reels-comments',
        )?.count,
      ).toBe(560);
      expect(items).toHaveLength(5600);
      expect(new Set(items.map((item) => item.id)).size).toBe(5600);
      expect(items.every((item) => item.account.handle === 'synth_load')).toBe(
        true,
      );
      expect(items.every((item) => item.text.endsWith('Grüße 🌿'))).toBe(true);
      expect(items[0]?.provenance.index).toBe(0);
      expect(items[5000]?.provenance.index).toBe(0);
    } finally {
      await archive.close();
    }
    await expect(
      generateLarge({ ...options, out: first }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}, 60_000);
