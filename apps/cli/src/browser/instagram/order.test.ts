import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { readContextOrder, validateContextOrder } from './order.ts';

test('strict UTF-8, exact scope, account, date, words, size and plan guards refuse before a browser capability', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-ig-order-')),
    path = join(directory, 'order.json'),
    hash = 'a'.repeat(64);
  const valid = {
    scope: 'context-instagram',
    account: 'generated_person',
    givenAt: '2026-10-15T12:00:00.000Z',
    words: 'Read this exact generated scope.',
  };
  try {
    const bytes = JSON.stringify(valid);
    await writeFile(path, bytes);
    const order = await readContextOrder(
      path,
      valid.account.toUpperCase(),
      hash,
      hash,
    );
    expect(order.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(order.value.acceptCanary).toBe(false);
    expect(() => validateContextOrder(order, valid.account, true)).toThrow(
      'Accept a watched',
    );
    expect(() =>
      validateContextOrder(order, valid.account, false),
    ).not.toThrow();
    for (const value of [
      { ...valid, scope: 'delete-x' },
      { ...valid, scope: 'context-instagram-more' },
      { ...valid, account: 'other' },
      { ...valid, givenAt: 'yesterday' },
      { ...valid, words: ' ' },
      { ...valid, maxSteps: 201 },
      { ...valid, acceptCanary: 'true' },
      { ...valid, extra: true },
    ]) {
      await writeFile(path, JSON.stringify(value));
      await expect(
        readContextOrder(path, valid.account, hash, hash),
      ).rejects.toMatchObject({ code: 'CONTEXT_ORDER_INVALID' });
    }
    await writeFile(path, Buffer.from([0xff, 0xfe]));
    await expect(
      readContextOrder(path, valid.account, hash, hash),
    ).rejects.toMatchObject({ code: 'CONTEXT_ORDER_INVALID' });
    await writeFile(path, ' '.repeat(65537));
    await expect(
      readContextOrder(path, valid.account, hash, hash),
    ).rejects.toMatchObject({ code: 'CONTEXT_ORDER_INVALID' });
    await expect(
      readContextOrder(path, valid.account, 'b'.repeat(64), hash),
    ).rejects.toMatchObject({ code: 'STALE_PLAN' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
