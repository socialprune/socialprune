import { expect, test } from 'vitest';
import { createMemoryArchive } from '@socialprune/core';
import type { ArchiveReader, Item, PlatformAdapter } from '@socialprune/core';
import { createImportRunner } from './runner.ts';
import type { ImportMessage } from './protocol.ts';

const file = new File(['generated'], 'generated.zip');
function item(index: number): Item {
  return {
    id: `invented-${index}`,
    platform: 'test',
    account: { key: 'invented', handle: null },
    kind: 'post',
    text: `Invented text ${index}.`,
    createdAt: '2000-01-01T00:00:00.000Z',
    engagement: { likes: null, reposts: null },
    reference: {
      replyToId: null,
      replyToHandle: null,
      quotedId: null,
      repostOfHandle: null,
      ownerHandle: null,
    },
    url: null,
    provenance: { archive: 'generated.zip', file: 'items.json', index },
  };
}
function adapter(count = 3): PlatformAdapter {
  return {
    platform: 'test',
    name: 'test-only',
    version: '1',
    detect: () =>
      Promise.resolve({
        result: 'match',
        variant: 'invented',
        reason: 'Test input.',
      }),
    async *parse(archive) {
      const entry = archive.list()[0];
      if (entry) await archive.readText(entry);
      for (let index = 0; index < count; index++)
        yield { type: 'item', item: item(index) };
    },
    deletionHint: () => ({ action: 'delete', url: null, group: null }),
  };
}
function archiveWithClose(close: () => Promise<void>): ArchiveReader {
  const archive = createMemoryArchive('generated.zip', { 'items.json': '[]' });
  return {
    archives: archive.archives,
    rejectedEntries: archive.rejectedEntries,
    list: () => archive.list(),
    readText: (entry, options) => archive.readText(entry, options),
    streamText: (entry, options) => archive.streamText(entry, options),
    close: async () => {
      await archive.close();
      await close();
    },
  };
}

test('streams batches and sends the summary only after releasing its archive', async () => {
  let release = () => {};
  const close = new Promise<void>((resolve) => {
    release = resolve;
  });
  const messages: ImportMessage[] = [];
  const runner = createImportRunner({
    adapters: [adapter()],
    post: (message) => messages.push(message),
    open: () => Promise.resolve(archiveWithClose(() => close)),
  });
  runner.handle({ type: 'import', id: 1, files: [file] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(messages.filter(({ type }) => type === 'items')).toHaveLength(1);
  expect(messages.some(({ type }) => type === 'summary')).toBe(false);
  release();
  await runner.settled();
  expect(messages.at(-1)).toMatchObject({
    type: 'summary',
    id: 1,
    summary: { status: 'ok', records: [{ itemCount: 3 }] },
  });
});

test('abort stops buffered parsing, closes, emits no later batch and permits another import', async () => {
  let closed = 0;
  const messages: ImportMessage[] = [];
  const runner = createImportRunner({
    adapters: [adapter(3000)],
    open: () =>
      Promise.resolve(
        archiveWithClose(() => {
          closed++;
          return Promise.resolve();
        }),
      ),
    post: (message) => {
      messages.push(message);
      if (message.type === 'items' && message.id === 1)
        runner.handle({ type: 'abort', id: 1 });
    },
  });
  runner.handle({ type: 'import', id: 1, files: [file] });
  await runner.settled();
  expect(closed).toBe(1);
  expect(messages.filter(({ type }) => type === 'items')).toHaveLength(1);
  expect(messages.at(-1)).toEqual({ type: 'aborted', id: 1 });
  runner.handle({ type: 'import', id: 2, files: [file] });
  await runner.settled();
  expect(closed).toBe(2);
  expect(messages.at(-1)).toMatchObject({
    type: 'summary',
    id: 2,
    summary: { records: [{ itemCount: 3000 }] },
  });
});

test('reports an open failure without export text and does not strand the runner', async () => {
  const messages: ImportMessage[] = [];
  const runner = createImportRunner({
    adapters: [adapter()],
    post: (message) => messages.push(message),
    open: () =>
      Promise.reject(
        new Error('An invented private leaf should not enter the UI.'),
      ),
  });
  runner.handle({ type: 'import', id: 1, files: [file] });
  await runner.settled();
  expect(messages.at(-1)).toEqual({
    type: 'error',
    id: 1,
    message: 'The archive could not be imported.',
  });
  runner.handle({ type: 'import', id: 2, files: [file] });
  await runner.settled();
  expect(messages.at(-1)).toMatchObject({ type: 'error', id: 2 });
});

test('does not accept a concurrent import or an unrelated cancellation', async () => {
  const messages: ImportMessage[] = [];
  const runner = createImportRunner({
    adapters: [adapter()],
    post: (message) => messages.push(message),
    open: () => Promise.resolve(createMemoryArchive('generated.zip', {})),
  });
  runner.handle({ type: 'import', id: 1, files: [file] });
  runner.handle({ type: 'import', id: 2, files: [file] });
  runner.handle({ type: 'abort', id: 2 });
  await runner.settled();
  expect(messages).toContainEqual({
    type: 'error',
    id: 2,
    message: 'An import is already running.',
  });
  expect(messages.at(-1)).toMatchObject({ type: 'summary', id: 1 });
});
