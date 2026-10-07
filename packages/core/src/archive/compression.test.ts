import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { expect, test } from 'vitest';
import { openZipArchives } from './zip.ts';
import { ArchiveReadError } from './errors.ts';

const payload = '["Generated deflate64 stored-block content."]';
async function method9Zip(corruptCrc = false): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter(), {
    useWebWorkers: false,
    useCompressionStream: true,
    level: 0,
    zip64: false,
    dataDescriptor: false,
  });
  await writer.add('posts.json', new TextReader(payload));
  const bytes = new Uint8Array(await (await writer.close()).arrayBuffer());
  const view = new DataView(bytes.buffer);
  let central = -1;
  for (let i = 0; i <= bytes.length - 4; i++)
    if (view.getUint32(i, true) === 0x02014b50) {
      central = i;
      break;
    }
  expect(central).toBeGreaterThan(0);
  const dataOffset = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  const length = new TextEncoder().encode(payload).length;
  const header = new Uint8Array([
    1,
    length & 255,
    length >>> 8,
    ~length & 255,
    (~length >>> 8) & 255,
  ]);
  const patched = new Uint8Array(bytes.length + header.length);
  patched.set(bytes.subarray(0, dataOffset));
  patched.set(header, dataOffset);
  patched.set(bytes.subarray(dataOffset), dataOffset + header.length);
  const changed = new DataView(patched.buffer);
  changed.setUint16(8, 9, true);
  changed.setUint32(18, length + header.length, true);
  const newCentral = central + header.length;
  changed.setUint16(newCentral + 10, 9, true);
  changed.setUint32(newCentral + 20, length + header.length, true);
  for (let i = newCentral; i <= patched.length - 22; i++)
    if (changed.getUint32(i, true) === 0x06054b50) {
      changed.setUint32(i + 16, newCentral, true);
      break;
    }
  if (corruptCrc) {
    changed.setUint32(14, 0, true);
    changed.setUint32(newCentral + 16, 0, true);
  }
  return new Blob([patched]);
}
test('Node default zip.js reads method 9 stored-block deflate with CRC checking', async () => {
  const archive = await openZipArchives([
    { name: 'test', blob: await method9Zip() },
  ]);
  try {
    expect(await archive.readText(archive.list()[0]!)).toBe(payload);
    expect(archive.diagnostics).toEqual([]);
  } finally {
    await archive.close();
  }
  const invalid = await openZipArchives([
    { name: 'bad-crc', blob: await method9Zip(true) },
  ]);
  try {
    await expect(invalid.readText(invalid.list()[0]!)).rejects.toThrow();
  } finally {
    await invalid.close();
  }
});
test('browser opt-out records unsupported compression only when an entry is read', async () => {
  const archive = await openZipArchives(
    [{ name: 'test', blob: await method9Zip() }],
    { allowDeflate64: false },
  );
  try {
    expect(archive.list()).toHaveLength(1);
    expect(archive.diagnostics).toEqual([]);
    await expect(archive.readText(archive.list()[0]!)).rejects.toMatchObject({
      code: 'unsupported-compression',
    });
    const consume = async () => {
      for await (const part of archive.streamText(archive.list()[0]!))
        void part;
    };
    await expect(consume()).rejects.toBeInstanceOf(ArchiveReadError);
    expect(archive.diagnostics).toHaveLength(1);
    expect(archive.diagnostics?.[0]).toMatchObject({
      category: 'unsupported-compression',
      status: 'unreadable',
      files: ['posts.json'],
    });
  } finally {
    await archive.close();
  }
});
test('encrypted entries always yield a named diagnostic without decoding their content', async () => {
  const writer = new ZipWriter(new BlobWriter(), {
    useWebWorkers: false,
    useCompressionStream: true,
    password: 'synthetic-password',
  });
  await writer.add(
    'encrypted.json',
    new TextReader('PLANTED_ENCRYPTED_CONTENT'),
  );
  const blob = await writer.close();
  for (const allowDeflate64 of [true, false]) {
    const archive = await openZipArchives([{ name: 'encrypted', blob }], {
      allowDeflate64,
    });
    try {
      await expect(archive.readText(archive.list()[0]!)).rejects.toMatchObject({
        code: 'encrypted-entry',
        message: 'encrypted-entry',
      });
      expect(archive.diagnostics?.[0]?.category).toBe('encrypted-entry');
      expect(JSON.stringify(archive.diagnostics)).not.toContain(
        'PLANTED_ENCRYPTED_CONTENT',
      );
    } finally {
      await archive.close();
    }
  }
});
