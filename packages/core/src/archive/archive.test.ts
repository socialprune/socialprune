import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { expect, test } from 'vitest';
import {
  ArchiveLimitError,
  createMemoryArchive,
  openZipArchives,
} from './index.ts';
import { ByteArchiveReader } from './reader.ts';
import { openArchivePaths } from '../node/index.ts';

async function zip(zip64 = false): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter(), {
    useWebWorkers: false,
    useCompressionStream: true,
    zip64,
  });
  await writer.add('posts.json', new TextReader('\uFEFF["ä😺"]'));
  await writer.add('folder/', undefined, { directory: true });
  return writer.close();
}
test.each([false, true])(
  'ZIP round trip, multiple archives, BOM and ZIP64=%s',
  async (zip64) => {
    const reader = await openZipArchives([
      { name: 'one', blob: await zip(zip64) },
      { name: 'two', blob: await zip(zip64) },
    ]);
    try {
      expect(reader.archives).toEqual(['one', 'two']);
      expect(reader.list().map((entry) => [entry.archive, entry.path])).toEqual(
        [
          ['one', 'posts.json'],
          ['two', 'posts.json'],
        ],
      );
      expect(await reader.readText(reader.list()[0]!)).toBe('["ä😺"]');
      const chunks = [];
      for await (const chunk of reader.streamText(reader.list()[1]!))
        chunks.push(chunk);
      expect(chunks.join('')).toBe('["ä😺"]');
    } finally {
      await reader.close();
    }
  },
);
test('UTF-8 decoding crosses single-byte chunks and rejects traversal/absolute entries', async () => {
  const reader = createMemoryArchive(
    'test',
    {
      './good.json': '\uFEFFä😺é',
      'a\\b.json': 'hello',
      '../bad': '',
      '/bad': '',
      'C:/bad': '',
      './D:/bad': '',
      'folder/': '',
    },
    { chunkSize: 1 },
  );
  expect(reader.rejectedEntries).toBe(4);
  expect(reader.list().map(({ path }) => path)).toEqual([
    'good.json',
    'a/b.json',
  ]);
  expect(await reader.readText(reader.list()[0]!)).toBe('ä😺é');
  await reader.close();
});
test('byte limits enforce actual output rather than declared entry size', async () => {
  const entry = { archive: 'test', path: 'declared.json', size: 3 * 1024 ** 3 };
  let canceled = false;
  const reader = new ByteArchiveReader(
    ['test'],
    [
      {
        entry,
        open: () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(4));
              controller.enqueue(new Uint8Array(4));
            },
            cancel() {
              canceled = true;
            },
          }),
      },
    ],
    0,
    { limits: { maxStreamBytes: 6 } },
  );
  await expect(reader.readText(entry, { maxBytes: 3 })).rejects.toBeInstanceOf(
    ArchiveLimitError,
  );
  canceled = false;
  const consume = async () => {
    for await (const chunk of reader.streamText(entry)) void chunk;
  };
  await expect(consume()).rejects.toMatchObject({ limit: 'maxStreamBytes' });
  expect(canceled).toBe(true);
  await reader.close();
  expect(() =>
    createMemoryArchive(
      'test',
      { a: '', b: '' },
      { limits: { maxEntries: 1 } },
    ),
  ).toThrow(ArchiveLimitError);
});
test('cancellation works before a read and during a pending byte source', async () => {
  const controller = new AbortController();
  controller.abort();
  const memory = createMemoryArchive('test', { 'a.json': '[]' });
  await expect(
    memory.readText(memory.list()[0]!, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  const pending = new AbortController();
  const entry = { archive: 'test', path: 'pending', size: 0 };
  const reader = new ByteArchiveReader(
    ['test'],
    [{ entry, open: () => new ReadableStream() }],
    0,
  );
  const task = reader.readText(entry, { signal: pending.signal });
  pending.abort();
  await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  await reader.close();
  await memory.close();
});
test('close cancels a stream paused at a yielded chunk and prevents later reads', async () => {
  const reader = createMemoryArchive('test', { a: 'abcdef' }, { chunkSize: 1 });
  const iterator = reader.streamText(reader.list()[0]!)[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toBe('a');
  await reader.close();
  await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
  await expect(reader.readText(reader.list()[0]!)).rejects.toMatchObject({
    name: 'AbortError',
  });
});
test('ZIP entry traversal/absolute paths are dropped and byte caps stop decompression', async () => {
  const writer = new ZipWriter(new BlobWriter(), {
    useWebWorkers: false,
    useCompressionStream: true,
  });
  for (const path of ['../bad.json', '/absolute.json', 'C:/drive.json'])
    await writer.add(path, new TextReader('[]'));
  await writer.add('valid.json', new TextReader('ä'.repeat(100)));
  const reader = await openZipArchives(
    [{ name: 'test', blob: await writer.close() }],
    { limits: { maxStreamBytes: 10 } },
  );
  try {
    expect(reader.rejectedEntries).toBe(3);
    expect(reader.list().map(({ path }) => path)).toEqual(['valid.json']);
    await expect(
      reader.readText(reader.list()[0]!, { maxBytes: 10 }),
    ).rejects.toBeInstanceOf(ArchiveLimitError);
    const consume = async () => {
      for await (const chunk of reader.streamText(reader.list()[0]!))
        void chunk;
    };
    await expect(consume()).rejects.toMatchObject({
      limit: 'maxStreamBytes',
    });
  } finally {
    await reader.close();
  }
});
test('encrypted ZIP read failure rejects rather than leaving the stream open', async () => {
  const writer = new ZipWriter(new BlobWriter(), {
    useWebWorkers: false,
    useCompressionStream: true,
    password: 'synthetic-test-password',
  });
  await writer.add('encrypted.json', new TextReader('[1]'));
  const reader = await openZipArchives([
    { name: 'encrypted', blob: await writer.close() },
  ]);
  try {
    await expect(reader.readText(reader.list()[0]!)).rejects.toThrow();
  } finally {
    await reader.close();
  }
});
test('Node directory and ZIP paths compose, with directory symlinks skipped', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'socialprune-archive-'));
  try {
    const directory = join(temp, 'directory');
    await mkdir(directory);
    await writeFile(join(directory, 'posts.json'), '[1]');
    await symlink(directory, join(directory, 'link'), 'junction');
    const file = join(temp, 'synthetic.zip');
    await writeFile(file, new Uint8Array(await (await zip()).arrayBuffer()));
    const reader = await openArchivePaths([directory, file]);
    try {
      expect(reader.archives).toEqual(['directory', 'synthetic.zip']);
      expect(reader.rejectedEntries).toBe(1);
      expect(reader.list()).toHaveLength(2);
      expect(await reader.readText(reader.list()[0]!)).toBe('[1]');
    } finally {
      await reader.close();
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
