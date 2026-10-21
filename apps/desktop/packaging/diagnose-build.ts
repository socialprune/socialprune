import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  createPackageWithOptions,
  extractAll,
  extractFile,
  getRawHeader,
} from '@electron/asar';
import { build } from 'rolldown';
import { resourceExecutable } from './package.ts';
import { assertFuses } from './fuses.ts';
import { dist, directory } from './paths.ts';
import { buildTokenProbe } from '../e2e/token-build.ts';

const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const releaseAsar = join(dist, 'release/resources/app.asar');
const original = hash(await readFile(releaseAsar));
const bundle = join(dist, 'diagnose-bundle');
await rm(bundle, { recursive: true, force: true });
await mkdir(bundle);
const tokenProbe = await buildTokenProbe(bundle);
await cp(join(dist, 'release'), join(bundle, 'release'), { recursive: true });
await cp(join(dist, 'release'), join(bundle, 'lifecycle'), { recursive: true });
const content = join(dist, 'diagnose-content');
await rm(content, { recursive: true, force: true });
extractAll(releaseAsar, content);
const output = await build({
  input: join(directory, 'test/entries/lifecycle-main.ts'),
  platform: 'node',
  external: (id) =>
    id === 'electron' ||
    id.startsWith('node:') ||
    id === 'playwright-core' ||
    id.startsWith('playwright-core/'),
  output: {
    file: join(content, 'main.mjs'),
    format: 'esm',
    codeSplitting: false,
    sourcemap: false,
  },
});
const modules = output.output.flatMap((file) =>
  file.type === 'chunk' ? Object.keys(file.modules) : [],
);
const lifecycleAsar = join(bundle, 'lifecycle/resources/app.asar');
await createPackageWithOptions(content, lifecycleAsar, {});
await resourceExecutable(
  join(bundle, 'lifecycle/SocialPrune.exe'),
  lifecycleAsar,
);
await assertFuses(join(bundle, 'lifecycle/SocialPrune.exe'), false);
if (hash(await readFile(releaseAsar)) !== original)
  throw new Error('DIAGNOSE_RELEASE_CHANGED');
const marker = 'diagnostic-entry';
if (
  extractFile(releaseAsar, 'main.mjs').toString().includes(marker) ||
  !extractFile(lifecycleAsar, 'main.mjs').toString().includes(marker)
)
  throw new Error('DIAGNOSE_ENTRY_BOUNDARY');
const releaseAssembly: unknown = JSON.parse(
  await readFile(join(dist, 'assembly.json'), 'utf8'),
);
await writeFile(
  join(bundle, 'diagnose-build.json'),
  JSON.stringify(
    {
      diagnosticOnly: true,
      tokenProbe: { ...tokenProbe, executable: 'token-probe.exe' },
      source:
        'same release renderer/preload/engine with test-only lifecycle main',
      releaseAsarSha256: original,
      lifecycleAsarSha256: hash(await readFile(lifecycleAsar)),
      lifecycleHeaderSha256: hash(
        Buffer.from(getRawHeader(lifecycleAsar).headerString),
      ),
      lifecycleModules: modules,
      releaseAssembly,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ diagnosticOnly: true, bundle, releaseAsarSha256: original }),
);
