import { lstat } from 'node:fs/promises';
import { extname } from 'node:path';
import { EngineFileSelectionSchema } from 'socialprune/engine';
import type { EngineFileSelection } from 'socialprune/engine';

/** Native dialog and native File drop share metadata admission. The engine,
 * not main or the renderer, reads and parses the selected archive contents. */
export async function importSelection(
  paths: unknown,
): Promise<Extract<EngineFileSelection, { type: 'importExport' }>> {
  const selection = EngineFileSelectionSchema.parse({
    type: 'importExport',
    paths,
  });
  if (selection.type !== 'importExport')
    throw new Error('IMPORT_SELECTION_INVALID');
  if (selection.paths)
    for (const path of selection.paths) {
      if (path.startsWith('\\\\') || path.startsWith('//'))
        throw new Error('IMPORT_SELECTION_INVALID');
      if (extname(path).toLowerCase() !== '.zip')
        throw new Error('IMPORT_SELECTION_INVALID');
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error('IMPORT_SELECTION_INVALID');
    }
  return selection;
}
