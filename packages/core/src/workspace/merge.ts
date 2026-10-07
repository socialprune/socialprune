import { ImportRecordSchema, ItemSchema } from '../model/index.ts';
import type { ImportRecord, Item } from '../model/index.ts';
import { WorkspaceError } from './errors.ts';
import type { WorkspaceStore } from './store.ts';

export async function mergeImport(
  store: WorkspaceStore,
  input: ImportRecord,
  items: readonly Item[],
) {
  const record = ImportRecordSchema.parse(input);
  const parsed = items.map((item) => ItemSchema.parse(item));
  for (const item of parsed)
    if (
      item.platform !== record.platform ||
      !item.id.startsWith(`${item.platform}:`)
    )
      throw new WorkspaceError('INVALID_ITEM_ID');
  return store.write(async (tx) => {
    const priorRecord = await tx.imports.get(record.id);
    if (priorRecord && priorRecord.status === 'complete')
      throw new WorkspaceError('DUPLICATE_ID');
    let added = 0,
      updated = 0,
      conflicts = 0;
    for (const item of parsed) {
      const previous = await tx.items.get(item.id);
      if (!previous) {
        await tx.items.put({
          item,
          importId: record.id,
          metadataImportId: record.id,
        });
        await tx.state.put({
          itemId: item.id,
          decision: 'undecided',
          outcome: 'unknown',
        });
        added++;
        continue;
      }
      if (
        previous.item.text !== item.text ||
        previous.item.kind !== item.kind ||
        previous.item.createdAt !== item.createdAt
      ) {
        conflicts++;
        continue;
      }
      const oldImport = await tx.imports.get(previous.metadataImportId);
      const priorDate =
        oldImport?.exportCreatedAt ?? oldImport?.importedAt ?? '';
      const nextDate = record.exportCreatedAt ?? record.importedAt;
      const owner = await tx.imports.get(previous.importId);
      if (nextDate >= priorDate) {
        await tx.items.put({
          item: {
            ...previous.item,
            engagement: item.engagement,
            url: item.url,
            reference: item.reference,
            provenance: item.provenance,
            mediaCount: item.mediaCount,
          },
          importId:
            owner?.status === 'incomplete' && record.status === 'complete'
              ? record.id
              : previous.importId,
          metadataImportId: record.id,
        });
        updated++;
      } else if (owner?.status === 'incomplete' && record.status === 'complete')
        await tx.items.put({ ...previous, importId: record.id });
    }
    const diagnostics = [...record.diagnostics];
    if (conflicts)
      diagnostics.push({
        category: 'conflicting-items',
        status: 'skipped',
        files: [],
        count: conflicts,
        message: 'Conflicting item IDs were omitted.',
      });
    await tx.imports.put({ ...record, diagnostics });
    const meta = await tx.meta.get(),
      runtime = await tx.runtime.get();
    await tx.meta.set({ ...meta, updatedAt: record.importedAt });
    await tx.runtime.set({ revision: runtime.revision + 1 });
    return { added, updated, conflicts, revision: runtime.revision + 1 };
  });
}
