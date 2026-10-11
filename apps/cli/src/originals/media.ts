import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileError } from '../workspace/files.ts';

export async function originalDirectory(
  workspace: string,
  id: string,
  create = false,
): Promise<string> {
  if (!/^[0-9]{1,40}$/.test(id)) throw new Error('ORIGINAL_PATH');
  const root = await realpath(workspace);
  let directory = root;
  for (const part of ['originals', id]) {
    directory = join(directory, part);
    if (create)
      await mkdir(directory).catch((error: unknown) => {
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'EEXIST'
        )
          throw fileError(error);
      });
    const stat = await lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      resolve(await realpath(directory)) !== resolve(directory)
    )
      throw new Error('ORIGINAL_PATH');
  }
  return directory;
}
export async function storePhoto(
  workspace: string,
  id: string,
  file: string,
  bytes: Uint8Array,
): Promise<void> {
  if (!/^[1-4]\.(?:jpg|png|gif|webp)$/.test(file))
    throw new Error('ORIGINAL_PATH');
  const directory = await originalDirectory(workspace, id, true);
  const handle = await open(join(directory, file), 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
