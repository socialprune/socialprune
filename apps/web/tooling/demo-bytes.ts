import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURES_ROOT, writeZipFile } from '@socialprune/fixture-gen';
import type { DemoData, ZipFileEntry } from '@socialprune/fixture-gen';
import type { Plugin } from 'vite';

const root = join(FIXTURES_ROOT, 'demo');
const archivesId = 'virtual:sp-demo-archives';
const assessmentsId = 'virtual:sp-demo-assessments';
async function* entries(
  folder: string,
  prefix = '',
): AsyncGenerator<ZipFileEntry> {
  for (const entry of (await readdir(folder, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (entry.isSymbolicLink())
      throw new Error('Demo symlinks are not allowed.');
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      yield* entries(join(folder, entry.name), `${path}/`);
    else yield { path, content: await readFile(join(folder, entry.name)) };
  }
}
export async function demoArchives() {
  const manifest = JSON.parse(
    await readFile(join(root, 'manifest.json'), 'utf8'),
  ) as DemoData['manifest'];
  const temp = await mkdtemp(join(tmpdir(), 'socialprune-demo-'));
  try {
    return await Promise.all(
      manifest.exports.map(async (entry) => {
        const path = join(temp, entry.archive);
        await writeZipFile(path, entries(join(root, entry.directory)));
        const bytes = await readFile(path);
        const digest = createHash('sha256')
          .update(bytes)
          .digest('hex')
          .slice(0, 16);
        return {
          name: entry.archive,
          bytes,
          asset: `assets/demo-${digest}/${entry.archive}`,
        };
      }),
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
const byteModule = (bytes: Uint8Array) =>
  `Uint8Array.from(atob(${JSON.stringify(Buffer.from(bytes).toString('base64'))}),c=>c.charCodeAt(0))`;

/** Script loading is allowed by the page CSP; fetch is not. The ZIP assets and
 * their lazy byte module both join the shell plugin's verified precache. */
export function demoBytes(): Plugin {
  return {
    name: 'socialprune-demo-bytes',
    resolveId(id) {
      if (id === archivesId || id === assessmentsId) return `\0${id}`;
    },
    async load(id) {
      if (id === `\0${archivesId}`) {
        const archives = await demoArchives();
        for (const archive of archives) {
          this.addWatchFile(join(root, 'manifest.json'));
          if (this.environment.config.command === 'build')
            this.emitFile({
              type: 'asset',
              fileName: archive.asset,
              source: archive.bytes,
            });
        }
        return `export const archives=[${archives
          .map(
            ({ name, bytes }) =>
              `{name:${JSON.stringify(name)},bytes:${byteModule(bytes)}}`,
          )
          .join(',')}];`;
      }
      if (id === `\0${assessmentsId}`) {
        const file = join(root, 'assessments.json');
        this.addWatchFile(file);
        return `export const bytes=${byteModule(await readFile(file))};`;
      }
    },
  };
}
