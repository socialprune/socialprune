import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { writeZipFile } from '@socialprune/fixture-gen';
import type { ZipFileEntry } from '@socialprune/fixture-gen';
import { largeEntries } from '../../../tools/fixture-gen/src/x/index.ts';
import { execute, root } from './measure-system.ts';

export const fourGiB = 4 * 1024 ** 3;
export const paddingBytes = 896 * 1024 ** 2;

export interface GeneratorManifest {
  platform: 'x';
  count: number;
  seed: number;
  zip64: boolean;
  generationMs: number;
  zipBytes: number;
  tweetBytes: number;
  noteBytes: number;
  averageBytesPerTweet: number;
}

export async function generate(
  path: string,
  count: number,
  signal: AbortSignal,
): Promise<GeneratorManifest> {
  const { stdout } = await execute(
    process.execPath,
    [
      join(root, 'tools/fixture-gen/src/cli.ts'),
      'large',
      '--platform',
      'x',
      '--count',
      String(count),
      '--seed',
      '1',
      '--out',
      path,
    ],
    { timeout: 120_000, signal, maxBuffer: 1024 * 1024 },
  );
  // LL-2026-10-002: the generator's manifest, not the app's progress or
  // terminal summary, supplies the expected stored count for every row.
  const result = JSON.parse(stdout) as GeneratorManifest;
  if (
    result.platform !== 'x' ||
    result.count !== count ||
    result.seed !== 1 ||
    !Number.isSafeInteger(result.count) ||
    result.zipBytes !== (await stat(path)).size ||
    result.tweetBytes <= 0 ||
    result.noteBytes <= 0
  )
    throw new Error('The generated input manifest is invalid.');
  return result;
}

function padding(seed: number): ReadableStream<Uint8Array> {
  let remaining = paddingBytes;
  let state = seed;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (!remaining) {
          controller.close();
          return;
        }
        const chunk = new Uint8Array(Math.min(1024 * 1024, remaining));
        const words = new DataView(chunk.buffer);
        for (let offset = 0; offset < chunk.byteLength; offset += 4) {
          state ^= state << 13;
          state ^= state >>> 17;
          state ^= state << 5;
          words.setUint32(offset, state >>> 0, true);
        }
        remaining -= chunk.byteLength;
        controller.enqueue(chunk);
      },
    },
    { highWaterMark: 1 },
  );
}

export async function generateZip64(
  path: string,
  manifest: GeneratorManifest,
  signal: AbortSignal,
) {
  async function* entries(): AsyncGenerator<ZipFileEntry> {
    // Same layout as the accepted S1 trial: padding precedes data so zip.js's
    // footer search does not overlap the final padding payload.
    for (let index = 0; index < 5; index++)
      yield {
        path: `data/tweets_media/invented-padding-${index}.bin`,
        content: padding(index + 1),
        level: 0,
      };
    yield* largeEntries({ count: manifest.count, seed: manifest.seed });
  }
  await writeZipFile(path, entries(), { zip64: true, signal });
}

export interface ArchiveEntry {
  name: string;
  method: number;
  crc32: number;
  compressed: number;
  uncompressed: number;
  localOffset: number;
  offsetFromZip64: boolean;
  payloadStart: number;
  payloadEnd: number;
}
export interface ArchiveHeaders {
  size: number;
  zip64: boolean;
  directoryOffset: number;
  directorySize: number;
  entries: ArchiveEntry[];
}

export async function headers(path: string): Promise<ArchiveHeaders> {
  const file = await open(path, 'r');
  const read = async (length: number, position: number) => {
    const buffer = Buffer.alloc(length);
    if ((await file.read(buffer, 0, length, position)).bytesRead !== length)
      throw new Error('Truncated generated ZIP header.');
    return buffer;
  };
  const integer64 = (buffer: Buffer, offset: number) => {
    const value = Number(buffer.readBigUInt64LE(offset));
    if (!Number.isSafeInteger(value))
      throw new Error('ZIP offset is too large.');
    return value;
  };
  try {
    const size = (await file.stat()).size;
    const tail = await read(Math.min(size, 512), Math.max(0, size - 512));
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error('Missing ZIP directory footer.');
    const zip64 = eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50;
    let directorySize = tail.readUInt32LE(eocd + 12);
    let directoryOffset = tail.readUInt32LE(eocd + 16);
    if (zip64) {
      const record = await read(56, integer64(tail, eocd - 12));
      if (record.readUInt32LE(0) !== 0x06064b50)
        throw new Error('Missing ZIP64 end record.');
      directorySize = integer64(record, 40);
      directoryOffset = integer64(record, 48);
    }
    if (directorySize > 1024 * 1024 || directoryOffset + directorySize > size)
      throw new Error('Unexpected generated ZIP directory.');
    const central = await read(directorySize, directoryOffset);
    const entries: ArchiveEntry[] = [];
    for (let offset = 0; offset < central.length;) {
      if (central.readUInt32LE(offset) !== 0x02014b50)
        throw new Error('Invalid ZIP directory entry.');
      const nameBytes = central.readUInt16LE(offset + 28);
      const extraBytes = central.readUInt16LE(offset + 30);
      const commentBytes = central.readUInt16LE(offset + 32);
      const name = central.toString(
        'utf8',
        offset + 46,
        offset + 46 + nameBytes,
      );
      let compressed = central.readUInt32LE(offset + 20);
      let uncompressed = central.readUInt32LE(offset + 24);
      let localOffset = central.readUInt32LE(offset + 42);
      const offsetFromZip64 = localOffset === 0xffffffff;
      const extraEnd = offset + 46 + nameBytes + extraBytes;
      for (let extra = offset + 46 + nameBytes; extra < extraEnd;) {
        const tag = central.readUInt16LE(extra);
        const length = central.readUInt16LE(extra + 2);
        if (tag === 1) {
          let value = extra + 4;
          if (uncompressed === 0xffffffff) {
            uncompressed = integer64(central, value);
            value += 8;
          }
          if (compressed === 0xffffffff) {
            compressed = integer64(central, value);
            value += 8;
          }
          if (offsetFromZip64) localOffset = integer64(central, value);
        }
        extra += length + 4;
      }
      const local = await read(30, localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50)
        throw new Error('Invalid local ZIP header.');
      const payloadStart =
        localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      entries.push({
        name,
        method: central.readUInt16LE(offset + 10),
        crc32: central.readUInt32LE(offset + 16),
        compressed,
        uncompressed,
        localOffset,
        offsetFromZip64,
        payloadStart,
        payloadEnd: payloadStart + compressed,
      });
      offset += 46 + nameBytes + extraBytes + commentBytes;
    }
    return { size, zip64, directoryOffset, directorySize, entries };
  } finally {
    await file.close();
  }
}

export function assertZip64(small: ArchiveHeaders, huge: ArchiveHeaders) {
  const padding = huge.entries.filter(({ name }) =>
    /^data\/tweets_media\/invented-padding-\d\.bin$/.test(name),
  );
  const data = huge.entries.filter((entry) => !padding.includes(entry));
  if (
    !huge.zip64 ||
    huge.size <= fourGiB ||
    huge.directoryOffset <= fourGiB ||
    padding.length !== 5 ||
    padding.some(
      ({ method, compressed, uncompressed }) =>
        method !== 0 ||
        compressed !== paddingBytes ||
        uncompressed !== paddingBytes,
    ) ||
    data.length !== small.entries.length ||
    data.some(({ name, crc32, uncompressed, localOffset, offsetFromZip64 }) => {
      const original = small.entries.find((entry) => entry.name === name);
      return (
        localOffset <= fourGiB ||
        !offsetFromZip64 ||
        original?.crc32 !== crc32 ||
        original.uncompressed !== uncompressed
      );
    })
  )
    throw new Error(
      'ZIP64 offsets, STORE padding or same-input headers differ.',
    );
  return padding;
}
