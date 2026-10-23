import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { migrateOriginal } from '@socialprune/core';
import type { Item } from '@socialprune/core';
import {
  writeContextFixture,
  contextInputs,
} from '../review/test/context-fixture.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { originalDirectory } from '../originals/media.ts';

/** Generated setup shared by focused engine and packaged-media proof only. */
export async function mediaFixture(data: string, jpeg?: Uint8Array) {
  const workspace = join(data, 'workspace');
  await mkdir(workspace, { recursive: true });
  const context = await writeContextFixture(workspace, jpeg);
  const expected = JSON.parse(
    await readFile(
      new URL(
        '../../../../fixtures/synthetic/demo/x/expected.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { items: Item[] };
  const item = expected.items.find(
    (item) => item.kind === 'reply' && item.reference.replyToId,
  )!;
  const id = item.reference.replyToId!;
  const original = migrateOriginal({
    id,
    status: 'fetched',
    fetchedAt: '2026-10-11T00:00:00Z',
    text: 'Generated stored original beside the desktop reply.',
    authorName: 'Generated Original',
    authorHandle: 'generatedoriginal',
    photos: [
      {
        url: 'https://pbs.twimg.com/generated.png',
        file: '1.png',
        status: 'stored',
      },
    ],
    quotedId: null,
    parentId: null,
    raw: null,
    textCompleteness: 'unknown',
    video: null,
  });
  const store = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'));
  try {
    await store.write(async (tx) => {
      await tx.items.put({
        item,
        importId: 'generated-x-media-import',
        metadataImportId: 'generated-x-media-import',
      });
      await tx.originals.put(original);
      const imported = await tx.imports.get('generated-context-import');
      await tx.imports.put({
        ...imported!,
        id: 'generated-x-media-import',
        platform: 'x',
        accounts: [item.account],
        archives: [item.provenance.archive],
        itemCount: 1,
      });
    });
  } finally {
    await store.close();
  }
  const folder = await originalDirectory(workspace, id, true);
  await writeFile(join(folder, '1.png'), contextInputs.png);
  return {
    workspace,
    original,
    item,
    context: context.records[0]!,
    png: contextInputs.png,
  };
}
