import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { openZipArchives } from '@socialprune/core';
import type { ArchiveReader } from '@socialprune/core';
import { openArchivePaths } from '@socialprune/core/node';
import { FIXTURE_DATE } from './shared/zip.ts';
import { fixtureSegment, readTree } from './tree.ts';

export const FIXTURES_ROOT = fileURLToPath(
  new URL('../../../fixtures/synthetic/', import.meta.url),
);
export interface FixtureMetadata {
  id: string;
  platform: string;
  description: string;
  archives: string[];
}
export interface LoadedFixture {
  variant: FixtureMetadata;
  expected: unknown;
  archive: ArchiveReader;
}
export async function listFixtureVariants(
  platform: string,
  opts: { root?: string } = {},
): Promise<string[]> {
  const path = join(opts.root ?? FIXTURES_ROOT, fixtureSegment(platform));
  const entries = await readdir(path, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return [];
      throw error;
    },
  );
  const variants: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    try {
      await readFile(join(path, entry.name, 'variant.json'));
      variants.push(entry.name);
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ))
        throw error;
    }
  }
  return variants.sort();
}
export async function loadFixtureVariant(
  platform: string,
  id: string,
  opts: { as: 'directory' | 'zip'; root?: string },
): Promise<LoadedFixture> {
  const root = join(
    opts.root ?? FIXTURES_ROOT,
    fixtureSegment(platform),
    fixtureSegment(id),
  );
  const metadata: unknown = JSON.parse(
    await readFile(join(root, 'variant.json'), 'utf8'),
  );
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    !('id' in metadata) ||
    metadata.id !== id ||
    !('platform' in metadata) ||
    metadata.platform !== platform ||
    !('description' in metadata) ||
    typeof metadata.description !== 'string' ||
    !('archives' in metadata) ||
    !Array.isArray(metadata.archives) ||
    !metadata.archives.every((name: unknown) => typeof name === 'string')
  )
    throw new TypeError('Invalid fixture metadata.');
  const variant: FixtureMetadata = {
    id,
    platform,
    description: metadata.description,
    archives: metadata.archives,
  };
  for (const name of variant.archives) fixtureSegment(name);
  const expected: unknown = JSON.parse(
    await readFile(join(root, 'expected.json'), 'utf8'),
  );
  let archive: ArchiveReader;
  if (opts.as === 'directory')
    archive = await openArchivePaths(
      variant.archives.map((name) => join(root, name)),
    );
  else {
    const sources = [];
    for (const name of variant.archives) {
      const writer = new ZipWriter(new BlobWriter('application/zip'), {
        useWebWorkers: false,
        useCompressionStream: true,
        lastModDate: FIXTURE_DATE,
        rawLastModDate: 0x28210000,
        extendedTimestamp: false,
      });
      for (const [path, bytes] of await readTree(join(root, name)))
        await writer.add(path, new Uint8ArrayReader(bytes));
      sources.push({ name, blob: await writer.close() });
    }
    archive = await openZipArchives(sources);
  }
  return { variant, expected, archive };
}
