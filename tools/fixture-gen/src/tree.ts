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

function relativePath(path: string): string {
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes(':') ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(
      'Fixture paths must be relative and contain no dot segments.',
    );
  }
  return path;
}

export async function writeVariants(
  root: string,
  variants: readonly Variant[],
) {
  const identities = new Set<string>();
  for (const variant of variants) {
    const platform = relativePath(variant.platform);
    const id = relativePath(variant.id);
    if (id.includes('/'))
      throw new Error('Variant IDs must be single path segments.');
    const identity = `${platform}/${id}`;
    if (identities.has(identity)) throw new Error('Duplicate fixture variant.');
    identities.add(identity);
    const files: Record<string, string | Uint8Array> = {
      ...variant.files,
      'expected.json': JSON.stringify(variant.expected, null, 2) + '\n',
      'variant.json':
        JSON.stringify(
          {
            id: variant.id,
            platform: variant.platform,
            description: variant.description,
          },
          null,
          2,
        ) + '\n',
    };
    if ('expected.json' in variant.files || 'variant.json' in variant.files) {
      throw new Error('Fixture metadata filenames are reserved.');
    }
    for (const [path, content] of Object.entries(files).sort(([a], [b]) =>
      a.localeCompare(b, 'en'),
    )) {
      const target = join(root, platform, id, relativePath(path));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
  }
}

async function readTree(
  root: string,
  prefix = '',
): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  let entries;
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true });
  } catch (error) {
    if (
      prefix === '' &&
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return files;
    }
    throw error;
  }
  for (const entry of entries.sort((a, b) =>
    a.name.localeCompare(b.name, 'en'),
  )) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink())
      throw new Error('Fixture trees cannot contain links.');
    if (entry.isDirectory()) {
      for (const [key, value] of await readTree(root, path))
        files.set(key, value);
    } else if (entry.isFile()) {
      files.set(path, await readFile(join(root, path)));
    } else {
      throw new Error(
        'Fixture trees must contain ordinary files and directories.',
      );
    }
  }
  return files;
}

export async function checkFixtures(
  committedRoot: string,
  variants: readonly Variant[],
): Promise<string[]> {
  const regenerated = await mkdtemp(join(tmpdir(), 'socialprune-fixtures-'));
  try {
    await writeVariants(regenerated, variants);
    const actual = await readTree(committedRoot);
    const expected = await readTree(regenerated);
    const paths = [...new Set([...actual.keys(), ...expected.keys()])].sort();
    return paths.filter((path) => {
      const a = actual.get(path);
      const b = expected.get(path);
      return !a || !b || !a.equals(b);
    });
  } finally {
    await rm(regenerated, { recursive: true, force: true });
  }
}
