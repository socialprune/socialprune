import { createWriteStream } from 'node:fs';
import { Writable } from 'node:stream';
import { TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';

export const FIXTURE_DATE = new Date('2000-01-01T00:00:00.000Z');
export interface ZipFileEntry {
  path: string;
  content: string | Uint8Array | ReadableStream<Uint8Array>;
  level?: number;
}
export async function writeZipFile(
  out: string,
  entries: AsyncIterable<ZipFileEntry> | Iterable<ZipFileEntry>,
  opts: { zip64?: boolean; signal?: AbortSignal } = {},
): Promise<void> {
  const file = createWriteStream(out, { flags: 'wx' });
  const writer = new ZipWriter(
    Writable.toWeb(file) as WritableStream<Uint8Array>,
    {
      useWebWorkers: false,
      useCompressionStream: true,
      bufferedWrite: false,
      dataDescriptor: true,
      zip64: opts.zip64 ?? false,
      lastModDate: FIXTURE_DATE,
      extendedTimestamp: false,
      rawLastModDate: 0x28210000,
    },
  );
  try {
    for await (const entry of entries) {
      if (
        entry.path.startsWith('/') ||
        entry.path.includes('\\') ||
        entry.path
          .split('/')
          .some((part) => !part || part === '.' || part === '..') ||
        /^[A-Za-z]:/.test(entry.path)
      )
        throw new TypeError('Invalid fixture ZIP path.');
      const reader =
        typeof entry.content === 'string'
          ? new TextReader(entry.content)
          : entry.content instanceof Uint8Array
            ? new Uint8ArrayReader(entry.content)
            : entry.content;
      await writer.add(entry.path, reader, {
        signal: opts.signal,
        ...(entry.level === undefined ? {} : { level: entry.level }),
      });
    }
    await writer.close();
  } catch (error) {
    file.destroy();
    throw error;
  }
}
