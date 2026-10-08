import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertFileList,
  filesIn,
  sha256,
  sourceInventory,
  trackedBytes,
} from './inventory.ts';
import type { PackageFile } from './inventory.ts';
import { npm, packageDirectory, root } from './process.ts';

export async function checkPackage(): Promise<string[]> {
  const expected = (
    await readFile(new URL('./expected-files.txt', import.meta.url), 'utf8')
  )
    .trim()
    .split(/\r?\n/);
  const assembled = await filesIn(packageDirectory);
  assertFileList(assembled, expected);
  const packed = JSON.parse(
    npm(['pack', '--dry-run', '--json', '--ignore-scripts'], packageDirectory),
  ) as { files: { path: string }[] }[];
  assert.equal(packed.length, 1);
  const paths = packed[0]!.files.map((file) => file.path).sort();
  assertFileList(paths, expected);
  assert.deepEqual(paths, assembled);
  const records = JSON.parse(
    await readFile(resolve(packageDirectory, '../assembly.json'), 'utf8'),
  ) as PackageFile[];
  assert.deepEqual(records.map((record) => record.path).sort(), assembled);
  const inventory = await sourceInventory(root);
  for (const record of records) {
    const bytes = await readFile(resolve(packageDirectory, record.path));
    assert.equal(sha256(bytes), record.sha256, record.path);
    if (record.origin.kind === 'tracked')
      assert.deepEqual(
        bytes,
        await trackedBytes(root, record.origin.source, inventory),
      );
    else {
      const allowed = {
        rolldown: /^bin\/(?:socialprune|database-worker)\.mjs(?:\.map)?$/,
        vite: /^web\//,
        manifest: /^package\.json$/,
        readme: /^README\.md$/,
        notices: /^THIRD_PARTY_NOTICES$/,
      };
      assert.match(record.path, allowed[record.origin.producer]);
    }
  }
  const manifest = JSON.parse(
    await readFile(resolve(packageDirectory, 'package.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(manifest).sort(),
    [
      'bin',
      'engines',
      'exports',
      'files',
      'license',
      'name',
      'publishConfig',
      'type',
      'version',
    ].sort(),
  );
  assert.equal(manifest.name, 'socialprune');
  assert.equal(manifest.version, '0.0.0');
  assert.equal(manifest.license, 'Apache-2.0');
  assert.equal(manifest.type, 'module');
  assert.deepEqual(manifest.bin, { socialprune: './bin/socialprune.mjs' });
  assert.deepEqual(manifest.engines, { node: '>=24.15.0' });
  assert.deepEqual(manifest.exports, {
    './schemas/*': './schemas/*',
    './skills/*': './skills/*',
  });
  assert.deepEqual(manifest.publishConfig, { access: 'public' });
  return paths;
}

export async function packCheck(plant = false): Promise<void> {
  const paths = await checkPackage();
  if (plant) {
    const path = resolve(packageDirectory, 'bin/stray-private.txt');
    await writeFile(path, 'C5 synthetic planted defect\n', { flag: 'wx' });
    try {
      await assert.rejects(checkPackage(), /Packed file list differs/);
      console.log('Planted stray assembly file: rejected.');
    } finally {
      await rm(path);
    }
    await checkPackage();
  }
  console.log(
    JSON.stringify({ packCheck: 'pass', files: paths.length, paths }),
  );
}

if (import.meta.main) await packCheck(process.argv.includes('--plant-defect'));
