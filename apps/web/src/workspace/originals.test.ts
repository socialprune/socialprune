import { expect, test } from 'vitest';
import { IndexedDBStore } from './idb-store.ts';
import {
  WorkspaceRequestSchema,
  WorkspaceReplySchema,
} from '@socialprune/core/workspace/protocol';

test('IndexedDB originals display is explicitly empty without opening a database or network', async () => {
  expect(await IndexedDBStore.prototype.getOriginals(['900001'])).toEqual([]);
});
test('originals request and reply validate the bounded protocol on both sides', () => {
  const input = {
    type: 'getOriginals',
    requestId: 'generated',
    ids: ['900001'],
  };
  expect(WorkspaceRequestSchema.parse(input)).toEqual(input);
  expect(WorkspaceRequestSchema.safeParse({ ...input, ids: [] }).success).toBe(
    false,
  );
  expect(
    WorkspaceRequestSchema.safeParse({
      ...input,
      ids: Array<string>(51).fill('900001'),
    }).success,
  ).toBe(false);
  expect(
    WorkspaceRequestSchema.safeParse({ ...input, ids: ['../data'] }).success,
  ).toBe(false);
  expect(
    WorkspaceReplySchema.parse({
      type: 'originals',
      requestId: 'generated',
      originals: [],
    }),
  ).toEqual({ type: 'originals', requestId: 'generated', originals: [] });
});
