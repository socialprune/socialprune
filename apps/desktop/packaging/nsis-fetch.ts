import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import extract from '@electron-internal/extract-zip';
import { dist } from './paths.ts';
import { verifyNsisArchive } from './nsis-checks.ts';
import { NSIS_SHA256, NSIS_URL, NSIS_VERSION } from './nsis-version.ts';

export async function fetchNsis(expected = NSIS_SHA256) {
  const cache = join(dist, `nsis-${NSIS_VERSION}.zip`);
  await mkdir(dist, { recursive: true });
  let bytes: Buffer;
  try {
    bytes = await readFile(cache);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    )
      throw error;
    const response = await fetch(NSIS_URL, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok)
      throw new Error(`NSIS_DOWNLOAD_FAILED:${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    verifyNsisArchive(bytes, expected);
    await writeFile(cache, bytes);
  }
  // Recheck cached bytes before extracting or executing anything.
  verifyNsisArchive(bytes, expected);
  const tools = join(dist, 'nsis-tools');
  await rm(tools, { recursive: true, force: true });
  await extract(cache, { dir: tools });
  return {
    directory: join(tools, `nsis-${NSIS_VERSION}`),
    sha256: NSIS_SHA256,
  };
}
