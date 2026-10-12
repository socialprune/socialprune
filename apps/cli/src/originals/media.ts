import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  readdir,
  unlink,
} from 'node:fs/promises';
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
  if (!/^[1-4](?:\.(?:jpg|png|gif|webp)|-poster\.(?:jpg|png|webp))$/.test(file))
    throw new Error('ORIGINAL_PATH');
  const directory = await originalDirectory(workspace, id, true);
  if (await lstat(join(directory, file)).catch(() => null))
    throw new Error('MEDIA_EXISTS');
  const partial = join(directory, file + '.part');
  const handle = await open(partial, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(partial, join(directory, file));
}
export async function cleanupParts(workspace: string): Promise<void> {
  const root = join(await realpath(workspace), 'originals');
  const stat = await lstat(root).catch(() => null);
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('ORIGINAL_PATH');
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (
      /^\d{1,40}$/.test(entry.name) &&
      entry.isDirectory() &&
      !entry.isSymbolicLink()
    ) {
      const directory = await originalDirectory(workspace, entry.name);
      for (const file of await readdir(directory, { withFileTypes: true }))
        if (
          /^[1-4](?:\.(?:jpg|png|gif|webp|mp4)|-poster\.(?:jpg|png|webp))\.part$/.test(
            file.name,
          ) &&
          file.isFile() &&
          !file.isSymbolicLink()
        )
          await unlink(join(directory, file.name));
    }
}
