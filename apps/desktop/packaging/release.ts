import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { buildNsis } from './nsis.ts';
import { NSIS_VERSION } from './nsis-version.ts';
import { assertFuses } from './fuses.ts';
import { directory, dist, executable } from './paths.ts';

export const artifacts = join(dist, 'artifacts');
export async function releaseVersion(): Promise<string> {
  const metadata = JSON.parse(
    await readFile(join(directory, 'package.json'), 'utf8'),
  ) as { version: string };
  if (!/^\d+\.\d+\.\d+$/.test(metadata.version))
    throw new Error('RELEASE_VERSION_INVALID');
  return metadata.version;
}
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

export async function checksums(): Promise<void> {
  const names = (await readdir(artifacts))
    .filter((name) => name !== 'SHA256SUMS.txt')
    .sort();
  const lines: string[] = [];
  for (const name of names)
    lines.push(`${hash(await readFile(join(artifacts, name)))}  ${name}`);
  await writeFile(join(artifacts, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
}

export async function buildRelease(requireMsix = true): Promise<void> {
  if (process.platform !== 'win32') throw new Error('WINDOWS_RELEASE_REQUIRED');
  const version = await releaseVersion();
  await assertFuses(executable('release'), false);
  await rm(artifacts, { recursive: true, force: true });
  await mkdir(artifacts, { recursive: true });
  const input = join(dist, 'nsis-input');
  await rm(input, { recursive: true, force: true });
  await cp(join(dist, 'release'), input, { recursive: true });
  const nsis = await buildNsis(
    input,
    join(artifacts, `SocialPrune-Setup-${version}.exe`),
    version,
  );
  const nsisLicense = await readFile(join(nsis.directory, 'COPYING'), 'utf8');
  await writeFile(
    join(artifacts, 'NSIS-NOTICE.txt'),
    `NSIS ${NSIS_VERSION}; zlib compressor only. ADR-002 rule 6, ADR-031 DIST-1.\n\n` +
      nsisLicense,
  );
  if (
    !(await readFile(join(artifacts, 'NSIS-NOTICE.txt'), 'utf8')).endsWith(
      nsisLicense,
    )
  )
    throw new Error('NSIS_COPYING_MISSING');
  const staging = join(dist, 'msix-input');
  await rm(staging, { recursive: true, force: true });
  await cp(join(dist, 'release'), staging, { recursive: true });
  const manifest = (
    await readFile(join(directory, 'packaging/AppxManifest.xml'), 'utf8')
  ).replace('{{VERSION}}', version);
  await writeFile(join(staging, 'AppxManifest.xml'), manifest);
  const { stdout } = await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'packaging/msix-tools.ps1'),
      '-OutputDirectory',
      join(staging, 'Assets'),
    ],
    { timeout: 30_000, windowsHide: true },
  );
  const sdk = JSON.parse(stdout) as {
    path: string | null;
    version: string | null;
  };
  if (sdk.path) {
    await promisify(execFile)(
      sdk.path,
      [
        'pack',
        '/d',
        staging,
        '/p',
        join(artifacts, `SocialPrune-${version}-x64.msix`),
        '/o',
      ],
      { timeout: 300_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    );
  } else if (requireMsix) throw new Error('MAKEAPPX_NOT_INSTALLED');
  const assembly = JSON.parse(
    await readFile(join(dist, 'assembly.json'), 'utf8'),
  ) as {
    electron: string;
    archiveSha256: string;
    asarSha256: string;
  };
  await writeFile(
    join(artifacts, 'BUILD.json'),
    JSON.stringify(
      {
        version,
        unsigned: true,
        sdkVersion: sdk.version,
        nsis: {
          version: NSIS_VERSION,
          sha256: nsis.sha256,
          compressor: 'zlib',
          files: nsis.files,
        },
        assembly: {
          electron: assembly.electron,
          archiveSha256: assembly.archiveSha256,
          asarSha256: assembly.asarSha256,
        },
      },
      null,
      2,
    ),
  );
  for (const lang of ['en', 'de'])
    await copyFile(
      join(directory, `packaging/download-notice.${lang}.md`),
      join(artifacts, `download-notice.${lang}.md`),
    );
  await checksums();
  console.log(
    JSON.stringify({
      proof: 'desktop-release-built',
      version,
      msix: Boolean(sdk.path),
      sdkVersion: sdk.version,
      files: (await readdir(artifacts)).sort(),
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await buildRelease(!process.argv.includes('--allow-missing-sdk'));
