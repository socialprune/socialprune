import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import { licenseAllowed } from '../../../tools/licenses-check/src/index.ts';

interface Metadata {
  name: string;
  version: string;
  license: string;
}
export interface BundledLicense extends Metadata {
  files: { name: string; text: string }[];
}

export async function bundledLicenses(
  moduleIds: Iterable<string>,
  root: string,
): Promise<BundledLicense[]> {
  const directories = new Set<string>();
  for (const id of moduleIds) {
    if (!id.replaceAll('\\', '/').includes('/node_modules/')) continue;
    let directory = dirname(id.split('?')[0]!);
    while (directory !== parse(directory).root) {
      if (
        await stat(join(directory, 'package.json')).then(
          (value) => value.isFile(),
          () => false,
        )
      ) {
        const metadata = JSON.parse(
          await readFile(join(directory, 'package.json'), 'utf8'),
        ) as Partial<Metadata>;
        if (metadata.name && metadata.version) {
          directories.add(directory);
          break;
        }
      }
      directory = dirname(directory);
    }
  }
  const result = new Map<string, BundledLicense>();
  for (const directory of directories) {
    const metadata = JSON.parse(
      await readFile(join(directory, 'package.json'), 'utf8'),
    ) as Metadata;
    if (
      !metadata.name ||
      !metadata.version ||
      !licenseAllowed(metadata.license)
    )
      throw new Error(
        `Bundled package has unapproved license metadata: ${metadata.name}@${metadata.version} (${metadata.license}).`,
      );
    if (metadata.name.startsWith('@socialprune/')) continue;
    const names = (await readdir(directory)).filter((name) =>
      /^(?:licen[sc]e|copying|notice)(?:[._-].*)?$/i.test(name),
    );
    const files: BundledLicense['files'] = [];
    for (const name of names.sort()) {
      if (!(await stat(join(directory, name))).isFile()) continue;
      files.push({ name, text: await readFile(join(directory, name), 'utf8') });
    }
    if (
      !files.length &&
      metadata.name === '@stricli/core' &&
      metadata.version === '1.3.0'
    ) {
      // The npm artifact omits LICENSE. ADR-002/013 record this exact tagged
      // upstream file, read again on 2026-10-08. Its text matches Apache-2.0
      // with Bloomberg's copyright line, rather than this repo's placeholder.
      files.push({
        name: 'https://raw.githubusercontent.com/bloomberg/stricli/v1.3.0/LICENSE',
        text: (await readFile(join(root, 'LICENSE'), 'utf8')).replace(
          'Copyright [yyyy] [name of copyright owner]',
          'Copyright 2024 Bloomberg Finance L.P.',
        ),
      });
    }
    if (!files.length || files.some((file) => !file.text.trim()))
      throw new Error(
        `Missing license text: ${metadata.name}@${metadata.version}`,
      );
    const key = `${metadata.name}@${metadata.version}`;
    const entry = { ...metadata, files };
    const previous = result.get(key);
    if (previous && JSON.stringify(previous.files) !== JSON.stringify(files))
      throw new Error(`Conflicting bundled license text: ${key}`);
    result.set(key, entry);
  }
  return [...result.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function renderNotices(packages: BundledLicense[]): string {
  if (!packages.length) throw new Error('Bundled license inventory is empty.');
  return (
    'Third-party software bundled in SocialPrune (CLI, database worker and local review).\n\n' +
    packages
      .map(
        (entry) =>
          `${entry.name}@${entry.version} (${entry.license})\n` +
          entry.files
            .map((file) => `Source: ${file.name}\n\n${file.text.trim()}\n`)
            .join('\n'),
      )
      .join('\n')
  );
}
