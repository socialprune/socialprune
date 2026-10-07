import { expect, test } from 'vitest';
import { saveTextDownload } from './download.ts';

test('CSV download keeps BOM and a fixture formula-neutralized cell in the anchor path', async () => {
  let downloaded: Blob | null = null;
  await saveTextDownload(
    'invented.csv',
    'text/csv;charset=utf-8',
    async (write) => {
      await write('\uFEFF');
      await write("text\r\n'=1+1\r\n");
    },
    {
      anchor(blob) {
        downloaded = blob;
      },
    },
  );
  if (!downloaded) throw new Error('Missing download.');
  const bytes = new Uint8Array(await (downloaded as Blob).arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe(
    "\uFEFFtext\r\n'=1+1\r\n",
  );
});
test('picker sink closes only after all JSON chunks and aborts on export failure', async () => {
  const chunks: number[] = [];
  let closed = false,
    aborted = false;
  const sink = {
    write(bytes: Uint8Array<ArrayBuffer>) {
      chunks.push(...bytes);
      return Promise.resolve();
    },
    close() {
      closed = true;
      return Promise.resolve();
    },
    abort() {
      aborted = true;
      return Promise.resolve();
    },
  };
  await saveTextDownload(
    'invented.json',
    'application/json',
    async (write) => {
      await write('{"timeZone":"Europe/Berlin",');
      await write('"via":"web-review"}');
    },
    {
      pick: () => Promise.resolve(sink),
      anchor() {
        throw new Error('Unexpected fallback.');
      },
    },
  );
  expect(JSON.parse(new TextDecoder().decode(new Uint8Array(chunks)))).toEqual({
    timeZone: 'Europe/Berlin',
    via: 'web-review',
  });
  expect(closed).toBe(true);
  await expect(
    saveTextDownload(
      'invented.csv',
      'text/csv',
      () => Promise.reject(new Error('Export changed.')),
      { pick: () => Promise.resolve(sink), anchor() {} },
    ),
  ).rejects.toThrow('changed');
  expect(aborted).toBe(true);
});
