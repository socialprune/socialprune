import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createPackageWithOptions,
  getRawHeader,
  listPackage,
} from '@electron/asar';
import { flipFuses } from '@electron/fuses';
import extract from '@electron-internal/extract-zip';
import { NtExecutable, NtExecutableResource, Resource } from 'resedit';
import { build } from 'rolldown';
import { DESKTOP_POLICY } from '../src/main/policy.ts';
import { fetchElectron } from './fetch-electron.ts';
import { assertFuses, fuseConfiguration } from './fuses.ts';
import { directory, dist, ELECTRON_VERSION, executable } from './paths.ts';

const hash = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
const require = createRequire(import.meta.url);

async function bundle(
  entry: string,
  target: string,
  format: 'esm' | 'cjs',
  production: boolean,
) {
  const result = await build({
    input: resolve(directory, entry),
    platform: 'node',
    external: (id) =>
      id.startsWith('node:') || id === 'electron' || id === 'playwright-core',
    output: { file: target, format, codeSplitting: false, sourcemap: false },
  });
  const modules = result.output.flatMap((file) =>
    file.type === 'chunk' ? Object.keys(file.modules) : [],
  );
  if (production && modules.some((id) => /[/\\](test|e2e)[/\\]/.test(id)))
    throw new Error('PRODUCTION_TEST_IMPORT');
  return modules;
}

async function resourceExecutable(path: string, asar: string): Promise<void> {
  const pe = NtExecutable.from(await readFile(path));
  const resources = NtExecutableResource.from(pe);
  const version = Resource.VersionInfo.fromEntries(resources.entries)[0];
  if (!version) throw new Error('VERSION_RESOURCE_MISSING');
  version.setProductVersion('0.0.0.0');
  version.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      ProductName: 'SocialPrune',
      FileDescription: 'SocialPrune',
      OriginalFilename: 'SocialPrune.exe',
      InternalName: 'SocialPrune',
    },
  );
  version.outputToResourceEntries(resources.entries);
  const integrity = JSON.stringify([
    {
      file: 'resources\\app.asar',
      alg: 'SHA256',
      value: hash(getRawHeader(asar).headerString),
    },
  ]);
  resources.entries = resources.entries.filter(
    (entry) => entry.type !== 'INTEGRITY',
  );
  resources.entries.push({
    type: 'INTEGRITY',
    id: 'ELECTRONASAR',
    lang: 1033,
    codepage: 65001,
    bin: new TextEncoder().encode(integrity).buffer,
  });
  resources.outputResource(pe);
  await writeFile(path, Buffer.from(pe.generate()));
}

export async function packageDesktop(): Promise<void> {
  const archive = await fetchElectron();
  const content = resolve(dist, 'content');
  await rm(content, { recursive: true, force: true });
  await mkdir(join(content, 'renderer'), { recursive: true });
  const modules: string[] = [];
  modules.push(
    ...(await bundle(
      'src/main/index.ts',
      join(content, 'main.mjs'),
      'esm',
      true,
    )),
  );
  modules.push(
    ...(await bundle(
      'src/preload/index.ts',
      join(content, 'preload.cjs'),
      'cjs',
      true,
    )),
  );
  modules.push(
    ...(await bundle(
      'src/engine-host/index.ts',
      join(content, 'engine.cjs'),
      'cjs',
      true,
    )),
  );
  await build({
    input: resolve(directory, 'src/renderer/index.ts'),
    platform: 'browser',
    output: {
      file: join(content, 'renderer/renderer.js'),
      format: 'iife',
      codeSplitting: false,
    },
  });
  await writeFile(
    join(content, 'renderer/index.html'),
    (
      await readFile(resolve(directory, 'src/renderer/index.html'), 'utf8')
    ).replace('__DESKTOP_POLICY__', DESKTOP_POLICY),
  );
  await cp(
    resolve(directory, 'src/renderer/style.css'),
    join(content, 'renderer/style.css'),
  );
  const playwright = dirname(
    await realpath(require.resolve('playwright-core/package.json')),
  );
  await cp(playwright, join(content, 'node_modules/playwright-core'), {
    recursive: true,
  });
  await cp(resolve(directory, '../../LICENSE'), join(content, 'LICENSE'));
  const zod = dirname(await realpath(require.resolve('zod/package.json')));
  await writeFile(
    join(content, 'THIRD_PARTY_NOTICES'),
    'zod 4.6.5\n' +
      (await readFile(join(zod, 'LICENSE'), 'utf8')) +
      '\nplaywright-core 1.63.0\n' +
      (await readFile(join(playwright, 'LICENSE'), 'utf8')) +
      '\n' +
      (await readFile(join(playwright, 'NOTICE'), 'utf8')),
  );
  await writeFile(
    join(content, 'package.json'),
    JSON.stringify({
      name: '@socialprune/desktop',
      version: '0.0.0',
      main: 'main.mjs',
      type: 'module',
    }),
  );
  for (const variant of ['release', 'test', 'probe'] as const) {
    const output = resolve(dist, variant);
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    await extract(archive.path, { dir: output });
    await rename(join(output, 'electron.exe'), executable(variant));
    await rm(join(output, 'resources/default_app.asar'), { force: true });
    if (variant === 'probe') {
      await bundle(
        'test/entries/main.ts',
        join(content, 'main.mjs'),
        'esm',
        false,
      );
      await bundle(
        'test/entries/engine.ts',
        join(content, 'engine.cjs'),
        'cjs',
        false,
      );
    }
    const asar = join(output, 'resources/app.asar');
    await createPackageWithOptions(content, asar, {});
    await resourceExecutable(executable(variant), asar);
    await flipFuses(
      executable(variant),
      fuseConfiguration(variant !== 'release'),
    );
    await assertFuses(executable(variant), variant !== 'release');
    if (
      variant !== 'probe' &&
      listPackage(asar, { isPack: false }).some((name) =>
        /[/\\](test|e2e)[/\\]/.test(name),
      )
    )
      throw new Error('PRODUCTION_TEST_FILE');
  }
  const release = await readFile(join(dist, 'release/resources/app.asar'));
  const test = await readFile(join(dist, 'test/resources/app.asar'));
  if (!release.equals(test)) throw new Error('TEST_BUILD_CONTENT_DRIFT');
  const releaseExecutable = await readFile(executable('release'));
  const testExecutable = await readFile(executable('test'));
  const fuseSentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
  const inspectOffset =
    releaseExecutable.indexOf(fuseSentinel) + fuseSentinel.length + 2 + 3;
  if (releaseExecutable.indexOf(fuseSentinel) < 0)
    throw new Error('FUSE_SENTINEL_MISSING');
  const differences: number[] = [];
  for (let index = 0; index < releaseExecutable.length; index++) {
    if (releaseExecutable[index] !== testExecutable[index]) {
      differences.push(index);
      if (differences.length > 1) break;
    }
  }
  if (
    releaseExecutable.length !== testExecutable.length ||
    differences.length !== 1 ||
    differences[0] !== inspectOffset
  )
    throw new Error('TEST_BUILD_EXECUTABLE_DRIFT');
  await writeFile(
    resolve(dist, 'assembly.json'),
    JSON.stringify(
      {
        electron: ELECTRON_VERSION,
        archiveSha256: archive.sha256,
        asarSha256: hash(release),
        productionModules: [...new Set(modules)].sort(),
        playwright: 'inside-asar',
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      type: 'desktop-packaged',
      electron: ELECTRON_VERSION,
      archiveSha256: archive.sha256,
      asarSha256: hash(release),
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await packageDesktop();
