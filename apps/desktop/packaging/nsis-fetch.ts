import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import extract from '@electron-internal/extract-zip';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import { dist } from './paths.ts';
import { NSIS_SHA256, NSIS_VERSION } from './nsis-version.ts';
import { loadNsisArchive } from './nsis-download.ts';

const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

async function archiveFiles(bytes: Buffer) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    useWebWorkers: false,
  });
  const files = new Map<string, string>();
  try {
    for (const entry of await reader.getEntries()) {
      if (entry.directory) continue;
      if (
        !entry.filename.startsWith(`nsis-${NSIS_VERSION}/`) ||
        entry.filename.split('/').some((part) => part === '..' || part === '.')
      )
        throw new Error('NSIS_ARCHIVE_PATH_REFUSED');
      files.set(
        entry.filename,
        hash(await entry.getData(new Uint8ArrayWriter())),
      );
    }
    for (const name of ['makensis.exe', 'Stubs/zlib-x86-unicode'])
      if (!files.has(`nsis-${NSIS_VERSION}/${name}`))
        throw new Error('NSIS_ARCHIVE_ENTRY_MISSING');
    return files;
  } finally {
    await reader.close();
  }
}

async function verifiedTools(
  tools: string,
  files: ReadonlyMap<string, string>,
) {
  let count = 0;
  async function visit(path: string, relative = ''): Promise<boolean> {
    if ((await lstat(path)).isSymbolicLink()) return false;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const target = join(path, entry.name);
      if (entry.isSymbolicLink()) return false;
      if (entry.isDirectory()) {
        if (!(await visit(target, name))) return false;
      } else if (
        !entry.isFile() ||
        files.get(name) !== hash(await readFile(target))
      )
        return false;
      else count++;
    }
    return true;
  }
  try {
    return (await visit(tools)) && count === files.size;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return false;
    throw error;
  }
}

export async function fetchNsis(
  expected = NSIS_SHA256,
  options: { workspace?: string } = {},
) {
  const workspace = options.workspace ?? dist;
  const { path: cache, bytes } = await loadNsisArchive(expected, {
    cacheDirectory: dist,
    workspace,
  });
  const files = await archiveFiles(bytes);
  // Parent-created tools are read-only inputs. Never delete or repair them.
  const candidates = [join(dist, 'nsis-tools')];
  for (const root of new Set([workspace, dist])) {
    try {
      for (const entry of await readdir(root, { withFileTypes: true }))
        if (entry.isDirectory() && entry.name.startsWith('nsis-tools-'))
          candidates.push(join(root, entry.name));
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error;
    }
  }
  for (const tools of candidates)
    if (await verifiedTools(tools, files))
      return {
        directory: join(tools, `nsis-${NSIS_VERSION}`),
        sha256: expected,
      };
  await mkdir(workspace, { recursive: true });
  const tools = await mkdtemp(join(workspace, 'nsis-tools-'));
  try {
    await extract(cache, { dir: tools });
    if (!(await verifiedTools(tools, files)))
      throw new Error('NSIS_EXTRACTED_CHECKSUM_MISMATCH');
  } catch (error) {
    await rm(tools, { recursive: true, force: true });
    throw error;
  }
  return {
    directory: join(tools, `nsis-${NSIS_VERSION}`),
    sha256: expected,
  };
}
