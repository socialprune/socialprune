import { expect, test } from 'vitest';
import { BrowserAttemptSchema } from '../model/browser.ts';
import { RunJournalCodeSchema } from './desktop-tokens.ts';
import { InstagramContextWriter } from './instagram-context-writer.ts';
import { createMemoryStore } from './memory-store.ts';
import { instagramContractItem } from './store-contract.ts';
import { readWorkspace } from './store.ts';
import { createBackup, restoreBackup } from './backup.ts';

test('IG-18 list-image-only is closed and belongs only to a manual not-listed comment attempt', () => {
  const attempt = {
    seq: 2,
    attemptId: 'generated-image-only',
    runId: 'generated-run',
    itemId: 'instagram:generated',
    action: 'confirm-comment',
    state: 'not-listed',
    settles: 'generated-send',
    at: '2026-10-25T00:00:00.000Z',
    code: 'list-image-only',
  };
  expect(BrowserAttemptSchema.safeParse(attempt).success).toBe(true);
  expect(RunJournalCodeSchema.safeParse('list-image-only').success).toBe(true);
  for (const state of ['confirmed', 'unconfirmed', 'sending'])
    expect(BrowserAttemptSchema.safeParse({ ...attempt, state }).success).toBe(
      false,
    );
  expect(
    BrowserAttemptSchema.safeParse({
      ...attempt,
      code: 'list-image-only-content',
    }).success,
  ).toBe(false);
});

test('IG-18 manual settlement survives portable restore but cannot later confirm the comment', async () => {
  const store = createMemoryStore(),
    target = createMemoryStore(),
    writer = new InstagramContextWriter(store);
  const item = instagramContractItem(),
    at = '2026-10-25T00:00:00.000Z';
  try {
    await store.write((tx) =>
      tx.items.put({ item, importId: '', metadataImportId: '' }),
    );
    await writer.startRun({
      runId: 'generated-image-run',
      accountKey: item.account.key,
      startedAt: at,
      planHash: 'e'.repeat(64),
    });
    await writer.sending({
      runId: 'generated-image-run',
      attemptId: 'generated-image-send',
      itemId: item.id,
      at,
    });
    await writer.settle({
      attemptId: 'generated-image-send',
      state: 'not-listed',
      at,
      code: 'list-image-only',
    });
    await restoreBackup(target, createBackup(store).chunks);
    const value = await target.read(readWorkspace);
    expect(value.instagramContext).toBeUndefined();
    expect(value.browserAttempts!.at(-1)).toMatchObject({
      state: 'not-listed',
      code: 'list-image-only',
    });
    await expect(
      writer.settle({
        attemptId: 'generated-image-send',
        state: 'unconfirmed',
        at,
        code: 'text',
      }),
    ).rejects.toThrow();
  } finally {
    await store.close();
    await target.close();
  }
});
