import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { downloadArtifact, ElectronDownloadCacheMode } from '@electron/get';
import { ARCHIVE_NAME, dist, ELECTRON_VERSION } from './paths.ts';

export function verifyArchive(bytes: Uint8Array, sums: string): string {
  const rows = sums
    .split(/\r?\n/)
    .filter(
      (row) =>
        row.endsWith(` ${ARCHIVE_NAME}`) || row.endsWith(`*${ARCHIVE_NAME}`),
    );
  const expected =
    rows.length === 1 ? rows[0]?.match(/^[a-f0-9]{64}/)?.[0] : undefined;
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (expected !== actual) throw new Error('ELECTRON_CHECKSUM_MISMATCH');
  return actual;
}

export async function fetchElectron() {
  await mkdir(dist, { recursive: true });
  const base = `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/`;
  // Supply the exact URL rather than allowing environment-selected mirrors.
  const common = {
    version: ELECTRON_VERSION,
    cacheRoot: dist + '/download-cache',
    tempDirectory: dist,
  };
  const sums = await downloadArtifact({
    ...common,
    artifactName: 'SHASUMS256.txt',
    isGeneric: true,
    cacheMode: ElectronDownloadCacheMode.Bypass,
    mirrorOptions: {
      resolveAssetURL: () => Promise.resolve(base + 'SHASUMS256.txt'),
    },
  });
  const sumText = await readFile(sums, 'utf8');
  const expected = sumText
    .split(/\r?\n/)
    .find(
      (row) =>
        row.endsWith(` ${ARCHIVE_NAME}`) || row.endsWith(`*${ARCHIVE_NAME}`),
    )
    ?.slice(0, 64);
  if (!expected || !/^[a-f0-9]{64}$/.test(expected))
    throw new Error('ELECTRON_CHECKSUM_MISSING');
  const archive = await downloadArtifact({
    ...common,
    artifactName: 'electron',
    platform: 'win32',
    arch: 'x64',
    checksums: { [ARCHIVE_NAME]: expected },
    mirrorOptions: {
      resolveAssetURL: () => Promise.resolve(base + ARCHIVE_NAME),
    },
  });
  return {
    path: archive,
    sha256: verifyArchive(await readFile(archive), sumText),
  };
}
