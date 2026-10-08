import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build as buildWeb } from 'vite';
import { build as bundle } from 'rolldown';
import { bundledLicenses, renderNotices } from './notices.ts';
import { filesIn, sha256, sourceInventory, trackedBytes } from './inventory.ts';
import type { PackageFile } from './inventory.ts';
import { packageDirectory, root, command } from './process.ts';
import { inspectCopy } from '../../../tools/copy-check/src/index.ts';

export async function workspaceAliases(): Promise<Record<string, string>> {
  const aliases: Record<string, string> = {};
  for (const name of ['core', 'adapter-x', 'adapter-instagram']) {
    const directory = resolve(root, `packages/${name}`);
    const metadata = JSON.parse(
      await readFile(resolve(directory, 'package.json'), 'utf8'),
    ) as { name: string; exports: Record<string, string> };
    for (const [subpath, target] of Object.entries(metadata.exports)) {
      const specifier =
        metadata.name + (subpath === '.' ? '' : subpath.slice(1));
      // The resolver's $ suffix requires an exact specifier, not a prefix.
      aliases[`${specifier}$`] = resolve(directory, target);
    }
  }
  return aliases;
}

export async function release(): Promise<void> {
  const inventory = await sourceInventory(root);
  const modules = new Set<string>();
  // Vite's real review config is reused. Only the observation plugin is added;
  // the output, policy, hashed paths and tree shaking stay owned by the web app.
  await buildWeb({
    root: resolve(root, 'apps/web'),
    configFile: resolve(root, 'apps/web/vite.config.ts'),
    mode: 'review',
    plugins: [
      {
        name: 'cli-license-inventory',
        generateBundle(_options, output) {
          for (const file of Object.values(output))
            if (file.type === 'chunk')
              for (const id of Object.keys(file.modules)) modules.add(id);
        },
      },
    ],
  });
  command(
    process.execPath,
    ['scripts/review-build-check.ts'],
    resolve(root, 'apps/web'),
  );
  await rm(resolve(root, 'apps/cli/dist'), { recursive: true, force: true });
  await mkdir(resolve(packageDirectory, 'bin'), { recursive: true });
  const records: PackageFile[] = [];
  const put = async (
    path: string,
    bytes: string | Buffer,
    origin: PackageFile['origin'],
  ) => {
    await mkdir(resolve(packageDirectory, path, '..'), { recursive: true });
    await writeFile(resolve(packageDirectory, path), bytes);
    records.push({ path, sha256: sha256(bytes), origin });
  };
  const alias = await workspaceAliases();
  for (const [entry, name] of [
    ['src/main.ts', 'socialprune'],
    ['src/review/database-worker.ts', 'database-worker'],
  ] as const) {
    const output = await bundle({
      input: resolve(root, 'apps/cli', entry),
      platform: 'node',
      resolve: { alias },
      external: (id) => id.startsWith('node:'),
      output: {
        format: 'esm',
        minify: true,
        sourcemap: true,
        codeSplitting: false,
        banner: '#!/usr/bin/env node',
        file: resolve(packageDirectory, `bin/${name}.mjs`),
      },
    });
    for (const file of output.output) {
      if (file.type === 'chunk') {
        for (const id of Object.keys(file.modules)) modules.add(id);
        if (
          file.imports.some((id) => !id.startsWith('node:')) ||
          file.dynamicImports.some((id) => !id.startsWith('node:'))
        )
          throw new Error(`Unbundled dependency in ${name}.`);
      }
      records.push({
        path: `bin/${file.fileName}`,
        sha256: sha256(
          await readFile(resolve(packageDirectory, 'bin', file.fileName)),
        ),
        origin: { kind: 'generated', producer: 'rolldown' },
      });
    }
    await chmod(resolve(packageDirectory, `bin/${name}.mjs`), 0o755);
  }
  for (const path of await filesIn(resolve(root, 'apps/web/dist-review')))
    await put(
      `web/${path}`,
      await readFile(resolve(root, 'apps/web/dist-review', path)),
      { kind: 'generated', producer: 'vite' },
    );
  for (const directory of [
    'packages/core/schemas',
    'apps/cli/schemas',
    'skills/socialprune',
  ]) {
    for (const path of await filesIn(resolve(root, directory))) {
      const target = directory.endsWith('schemas')
        ? `schemas/${path}`
        : `${directory}/${path}`;
      if (records.some((record) => record.path === target))
        throw new Error(`Duplicate release path: ${target}`);
      await put(
        target,
        await trackedBytes(root, `${directory}/${path}`, inventory),
        { kind: 'tracked', source: `${directory}/${path}` },
      );
    }
  }
  await put('LICENSE', await trackedBytes(root, 'LICENSE', inventory), {
    kind: 'tracked',
    source: 'LICENSE',
  });
  const readme = (
    await readFile(resolve(root, 'apps/cli/README.md'), 'utf8')
  ).replaceAll('\r\n', '\n');
  // Check the generated package document with its canonical source scope.
  if (inspectCopy('apps/cli/README.md', readme).length)
    throw new Error('Package README violates copy policy.');
  await put('README.md', readme, { kind: 'generated', producer: 'readme' });
  const licenses = await bundledLicenses(modules, root);
  await put('THIRD_PARTY_NOTICES', renderNotices(licenses), {
    kind: 'generated',
    producer: 'notices',
  });
  await put(
    'package.json',
    JSON.stringify(
      {
        name: 'socialprune',
        version: '0.0.0',
        license: 'Apache-2.0',
        type: 'module',
        bin: { socialprune: './bin/socialprune.mjs' },
        engines: { node: '>=24.15.0' },
        files: [
          'bin/',
          'web/',
          'schemas/',
          'skills/',
          'README.md',
          'LICENSE',
          'THIRD_PARTY_NOTICES',
        ],
        exports: { './schemas/*': './schemas/*', './skills/*': './skills/*' },
        publishConfig: { access: 'public' },
      },
      null,
      2,
    ) + '\n',
    { kind: 'generated', producer: 'manifest' },
  );
  await writeFile(
    resolve(packageDirectory, '../assembly.json'),
    JSON.stringify(records, null, 2) + '\n',
  );
  const sizes = Object.fromEntries(
    await Promise.all(
      ['socialprune', 'database-worker'].map(async (name) => {
        const bytes = await readFile(
          resolve(packageDirectory, `bin/${name}.mjs`),
        );
        return [
          name,
          { bytes: bytes.length, gzip: gzipSync(bytes).length },
        ] as const;
      }),
    ),
  );
  console.log(
    JSON.stringify({
      build: 'release',
      files: records.length,
      sizes,
      bundledPackages: licenses.map(
        (entry) => `${entry.name}@${entry.version}`,
      ),
    }),
  );
}

if (import.meta.main) await release();
