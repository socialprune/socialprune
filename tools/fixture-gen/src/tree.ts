import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Variant } from './shared/index.ts';

export function fixtureSegment(segment: string): string {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment) ||
    segment === '.' ||
    segment === '..'
  )
    throw new TypeError('Invalid fixture path segment.');
  return segment;
}
export function fixturePath(path: string): string {
  if (
    path.includes('\\') ||
    path.includes(':') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new TypeError('Fixture paths must be relative.');
  return path;
}
export async function writeVariants(
  root: string,
  variants: readonly Variant[],
): Promise<void> {
  const ids = new Set<string>();
  for (const variant of variants) {
    const target = join(
      root,
      fixtureSegment(variant.platform),
      fixtureSegment(variant.id),
    );
    const identity = `${variant.platform}/${variant.id}`;
    if (ids.has(identity)) throw new TypeError('Duplicate fixture variant.');
    ids.add(identity);
    const archiveNames = new Set<string>();
    for (const archive of variant.archives) {
      const name = fixtureSegment(archive.name);
      if (
        archiveNames.has(name) ||
        name === 'expected.json' ||
        name === 'variant.json'
      )
        throw new TypeError('Duplicate or reserved fixture archive name.');
      archiveNames.add(name);
      await mkdir(join(target, name), { recursive: true });
      for (const [path, content] of Object.entries(archive.files).sort(
        ([a], [b]) => (a < b ? -1 : 1),
      )) {
        const file = join(target, name, fixturePath(path));
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, content);
      }
    }
    await mkdir(target, { recursive: true });
    await writeFile(
      join(target, 'expected.json'),
      JSON.stringify(variant.expected, null, 2) + '\n',
    );
    await writeFile(
      join(target, 'variant.json'),
      JSON.stringify(
        {
          id: variant.id,
          platform: variant.platform,
          description: variant.description,
          archives: [...archiveNames],
        },
        null,
        2,
      ) + '\n',
    );
  }
}
export async function readTree(
  root: string,
  prefix = '',
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const entries = await readdir(join(root, prefix), {
    withFileTypes: true,
  }).catch((error: unknown) => {
    if (
      prefix === '' &&
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return [];
    throw error;
  });
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink())
      throw new TypeError('Fixture trees cannot contain links.');
    if (entry.isDirectory())
      for (const [key, value] of await readTree(root, path))
        files.set(key, value);
    else if (entry.isFile()) files.set(path, await readFile(join(root, path)));
    else throw new TypeError('Unsupported fixture entry.');
  }
  return files;
}
export async function generateFixtures(
  root: string,
  variants: readonly Variant[],
  platforms: readonly string[],
): Promise<void> {
  for (const platform of platforms) {
    fixtureSegment(platform);
    // Only this platform belongs to the invocation. Hand-authored classify data
    // and another platform's concurrent generation are never replaced.
    await rm(join(root, platform), { recursive: true, force: true });
    await writeVariants(
      root,
      variants.filter((variant) => variant.platform === platform),
    );
  }
}
export async function checkFixtures(
  root: string,
  variants: readonly Variant[],
  platforms: readonly string[] = [
    ...new Set(variants.map(({ platform }) => platform)),
  ],
): Promise<string[]> {
  const regenerated = await mkdtemp(join(tmpdir(), 'socialprune-fixtures-'));
  try {
    await writeVariants(
      regenerated,
      variants.filter((variant) => platforms.includes(variant.platform)),
    );
    const drift: string[] = [];
    for (const platform of platforms) {
      fixtureSegment(platform);
      const actual = await readTree(join(root, platform));
      const expected = await readTree(join(regenerated, platform));
      for (const path of [
        ...new Set([...actual.keys(), ...expected.keys()]),
      ].sort()) {
        const a = actual.get(path);
        const b = expected.get(path);
        if (!a || !b || !Buffer.from(a).equals(b))
          drift.push(`${platform}/${path}`);
      }
    }
    return drift;
  } finally {
    await rm(regenerated, { recursive: true, force: true });
  }
}
