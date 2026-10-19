import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function assertNsisTemp(
  root: string,
  uninstalls: number,
  expected: string,
) {
  const names = (await readdir(root)).sort();
  if (names.some((name) => !/^~nsu[0-9A-F]*\.tmp$/i.test(name)))
    throw new Error('NSIS_TEMP_EXTRA_ENTRY');
  if (names.length > uninstalls || (uninstalls > 0 && names.length === 0))
    throw new Error('NSIS_TEMP_COUNT');
  const copies: {
    folder: string;
    name: string;
    bytes: number;
    sha256: string;
  }[] = [];
  for (const folder of names) {
    const path = join(root, folder);
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('NSIS_TEMP_KIND');
    const files = await readdir(path);
    // Official pinned NSIS win32-unicode uses this exact observed name. A new
    // toolchain must establish its own observed name rather than a wildcard.
    if (files.length !== 1 || files[0] !== 'Un.exe')
      throw new Error('NSIS_TEMP_FILES');
    const file = join(path, 'Un.exe');
    const fileInfo = await lstat(file);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink())
      throw new Error('NSIS_TEMP_KIND');
    const bytes = await readFile(file);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== expected) throw new Error('NSIS_TEMP_COPY_MISMATCH');
    copies.push({ folder, name: 'Un.exe', bytes: bytes.length, sha256 });
  }
  return copies;
}
