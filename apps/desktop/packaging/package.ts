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
  extractAll,
  extractFile,
  getRawHeader,
  listPackage,
} from '@electron/asar';
import { flipFuses } from '@electron/fuses';
import extract from '@electron-internal/extract-zip';
import { NtExecutable, NtExecutableResource, Resource } from 'resedit';
import { build } from 'rolldown';
import { build as buildWeb } from 'vite';
import { bundledLicenses } from '../../cli/release/notices.ts';
import { DESKTOP_POLICY } from '../src/main/policy.ts';
import { fetchElectron } from './fetch-electron.ts';
import { assertFuses, fuseConfiguration } from './fuses.ts';
import {
  directory,
  dist,
  root,
  ELECTRON_VERSION,
  executable,
} from './paths.ts';
import { assertProductionModules } from './boundary.ts';

const hash = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
const require = createRequire(import.meta.url);
const metadata = JSON.parse(
  await readFile(join(directory, 'package.json'), 'utf8'),
) as { version: string };
if (!/^\d+\.\d+\.\d+$/.test(metadata.version))
  throw new Error('DESKTOP_VERSION_INVALID');

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
      id.startsWith('node:') ||
      id === 'electron' ||
      id === 'playwright-core' ||
      id.startsWith('playwright-core/'),
    plugins: [
      {
        name: 'test-engine-chromium-only',
        resolveId(id) {
          if (!production && id === '@playwright/test')
            return { id: 'playwright-core', external: true };
        },
      },
    ],
    output: { file: target, format, codeSplitting: false, sourcemap: false },
  });
  const modules = result.output.flatMap((file) =>
    file.type === 'chunk' ? Object.keys(file.modules) : [],
  );
  if (production) assertProductionModules(modules);
  return modules;
}

export async function resourceExecutable(
  path: string,
  asar: string,
): Promise<void> {
  const pe = NtExecutable.from(await readFile(path));
  const resources = NtExecutableResource.from(pe);
  const version = Resource.VersionInfo.fromEntries(resources.entries)[0];
  if (!version) throw new Error('VERSION_RESOURCE_MISSING');
  version.setProductVersion(`${metadata.version}.0`);
  version.setFileVersion(`${metadata.version}.0`);
  version.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      ProductName: 'SocialPrune',
      CompanyName: 'SocialPrune',
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
  const rendererModules = new Set<string>();
  await buildWeb({
    root: resolve(root, 'apps/web'),
    configFile: resolve(root, 'apps/web/vite.config.ts'),
    mode: 'desktop',
    plugins: [
      {
        name: 'desktop-bundled-notices',
        generateBundle(_options, output) {
          for (const file of Object.values(output))
            if (file.type === 'chunk')
              for (const id of Object.keys(file.modules))
                rendererModules.add(id);
        },
      },
    ],
  });
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
  const renderer = resolve(directory, '../web/dist-desktop');
  const html = await readFile(join(renderer, 'desktop.html'), 'utf8');
  if (
    !html.includes(DESKTOP_POLICY.replaceAll("'", '&#39;')) &&
    !html.includes(DESKTOP_POLICY)
  )
    throw new Error('DESKTOP_POLICY_DRIFT');
  await cp(renderer, join(content, 'renderer'), { recursive: true });
  const playwright = dirname(
    await realpath(require.resolve('playwright-core/package.json')),
  );
  await cp(playwright, join(content, 'node_modules/playwright-core'), {
    recursive: true,
  });
  await cp(resolve(directory, '../../LICENSE'), join(content, 'LICENSE'));
  const notices = await bundledLicenses(
    [...modules, ...rendererModules, require.resolve('playwright-core')],
    root,
  );
  await writeFile(
    join(content, 'THIRD_PARTY_NOTICES'),
    'Third-party software bundled in SocialPrune desktop.\n\n' +
      notices
        .map(
          (entry) =>
            `${entry.name}@${entry.version} (${entry.license})\n` +
            entry.files
              .map((file) => `Source: ${file.name}\n\n${file.text.trim()}\n`)
              .join('\n'),
        )
        .join('\n'),
  );
  await writeFile(
    join(content, 'package.json'),
    JSON.stringify({
      name: '@socialprune/desktop',
      version: metadata.version,
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
    if (variant === 'test') {
      await bundle(
        'test/entries/quiet-main.ts',
        join(content, 'main.mjs'),
        'esm',
        false,
      );
    }
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
  const releaseAsar = join(dist, 'release/resources/app.asar');
  const testAsar = join(dist, 'test/resources/app.asar');
  const names = listPackage(releaseAsar, { isPack: false });
  if (
    JSON.stringify(names) !==
    JSON.stringify(listPackage(testAsar, { isPack: false }))
  )
    throw new Error('TEST_BUILD_FILES_DRIFT');
  const info = JSON.parse(getRawHeader(releaseAsar).headerString) as {
    files: Record<string, unknown>;
  };
  for (const name of names) {
    const path = name.replaceAll('\\', '/').replace(/^\//, '');
    let entry: unknown = info;
    for (const part of path.split('/'))
      entry = (entry as typeof info).files[part];
    if ('files' in (entry as object) || path === 'main.mjs') continue;
    const nativePath = join(...path.split('/'));
    if (
      !extractFile(releaseAsar, nativePath).equals(
        extractFile(testAsar, nativePath),
      )
    )
      throw new Error(`TEST_BUILD_CONTENT_DRIFT:${path}`);
  }
  if (
    extractFile(releaseAsar, 'main.mjs').equals(
      extractFile(testAsar, 'main.mjs'),
    ) ||
    !extractFile(testAsar, 'main.mjs').toString().includes('showInactive')
  )
    throw new Error('TEST_PRESENTATION_MISSING');
  if (
    /showInactive|setFocusable/.test(
      extractFile(releaseAsar, 'main.mjs').toString(),
    )
  )
    throw new Error('PRODUCTION_PRESENTATION_OVERRIDE');
  // Only presentation and its ASAR integrity resource differ in the inspect-only
  // test. Its real engine, preload, renderer, dependencies and fuses stay exact.
  const releasePe = NtExecutable.from(await readFile(executable('release')));
  const testPe = NtExecutable.from(await readFile(executable('test')));
  const testResources = NtExecutableResource.from(testPe);
  const releaseResources = NtExecutableResource.from(releasePe);
  const integrity = releaseResources.entries.find(
    (entry) => entry.type === 'INTEGRITY',
  );
  if (!integrity) throw new Error('RELEASE_INTEGRITY_MISSING');
  testResources.entries = testResources.entries.map((entry) =>
    entry.type === 'INTEGRITY' ? integrity : entry,
  );
  testResources.outputResource(testPe);
  releaseResources.outputResource(releasePe);
  const releaseExecutable = Buffer.from(releasePe.generate());
  const testExecutable = Buffer.from(testPe.generate());
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
  // Fault injection is a fourth, inspect-only test entry with no release selector.
  const startup = join(dist, 'startup');
  const startupContent = join(dist, 'startup-content');
  await rm(startup, { recursive: true, force: true });
  await rm(startupContent, { recursive: true, force: true });
  await cp(join(dist, 'test'), startup, { recursive: true });
  extractAll(releaseAsar, startupContent);
  await bundle(
    'test/entries/startup-main.ts',
    join(startupContent, 'main.mjs'),
    'esm',
    false,
  );
  const startupAsar = join(startup, 'resources/app.asar');
  await createPackageWithOptions(startupContent, startupAsar, {});
  await resourceExecutable(join(startup, 'SocialPrune.exe'), startupAsar);
  await assertFuses(join(startup, 'SocialPrune.exe'), true);
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
