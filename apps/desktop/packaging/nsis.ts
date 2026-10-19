import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { directory, dist } from './paths.ts';
import {
  assertCompressor,
  installerLists,
  assertNsisStub,
  assertCompileLog,
  assertCompiledMessages,
} from './nsis-checks.ts';
import { fetchNsis } from './nsis-fetch.ts';

export async function buildNsis(
  input: string,
  output: string,
  version: string,
  dependencies: {
    source?: string;
    fetch?: typeof fetchNsis;
    history?: readonly string[];
    previous?: readonly string[];
    generated?: string;
  } = {},
) {
  const source =
    dependencies.source ?? join(directory, 'packaging/installer.nsi');
  const script = await readFile(source, 'utf8');
  assertCompressor(script);
  const historyPath = join(directory, 'packaging/shipped-files.json');
  const history =
    dependencies.history ??
    (JSON.parse(await readFile(historyPath, 'utf8')) as string[]);
  // Compare with both committed generations and the index. Full-history CI
  // preserves the preceding ledger, so staging a deletion cannot bless it.
  let previous = dependencies.previous;
  if (!previous && !dependencies.history) {
    const git = (args: string[]) =>
      promisify(execFile)('git', args, {
        cwd: directory,
        timeout: 10_000,
        windowsHide: true,
      });
    if (
      (await git(['rev-parse', '--is-shallow-repository'])).stdout.trim() !==
      'false'
    )
      throw new Error('NSIS_HISTORY_SHALLOW_REFUSED');
    previous = history;
    for (const revision of [':', 'HEAD:', 'HEAD^:']) {
      try {
        const { stdout } = await git([
          'show',
          `${revision}apps/desktop/packaging/shipped-files.json`,
        ]);
        const prior = JSON.parse(stdout) as string[];
        installerLists([], history, prior);
        if (prior.length > previous.length) previous = prior;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('stderr' in error) ||
          !/does not exist|exists on disk, but not in/.test(
            String(error.stderr),
          )
        )
          throw error;
      }
    }
  }
  const nsis = await (dependencies.fetch ?? fetchNsis)();
  assertNsisStub(
    await readFile(join(nsis.directory, 'Stubs/zlib-x86-unicode')),
    script,
  );
  const files: string[] = [];
  async function visit(relative = ''): Promise<void> {
    for (const entry of await readdir(join(input, relative), {
      withFileTypes: true,
    })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if ((await lstat(join(input, name))).isSymbolicLink())
        throw new Error('NSIS_INPUT_LINK_REFUSED');
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) files.push(name);
      else throw new Error('NSIS_INPUT_KIND_REFUSED');
    }
  }
  await visit();
  const lists = installerLists(files, history, previous ?? history);
  const generated = dependencies.generated ?? join(dist, 'nsis-generated');
  await mkdir(generated, { recursive: true });
  for (const key of ['install', 'uninstall', 'verify', 'obsolete'] as const)
    await writeFile(join(generated, `${key}.nsh`), lists[key]);
  const manifest = await Promise.all(
    lists.files.map(async (path) => ({
      path,
      sha256: createHash('sha256')
        .update(await readFile(join(input, path)))
        .digest('hex'),
    })),
  );
  await writeFile(
    join(generated, 'installed-files.json'),
    JSON.stringify(manifest, null, 2),
  );
  const args = [
    '/NOCONFIG',
    '/V3',
    '/INPUTCHARSET',
    'UTF8',
    `/DVERSION=${version}`,
    `/DINPUT=${input}`,
    `/DOUTPUT=${output}`,
    `/DMANIFEST=${join(generated, 'installed-files.json')}`,
    `/DINSTALL_LIST=${join(generated, 'install.nsh')}`,
    `/DUNINSTALL_LIST=${join(generated, 'uninstall.nsh')}`,
    `/DVERIFY_LIST=${join(generated, 'verify.nsh')}`,
    `/DOBSOLETE_LIST=${join(generated, 'obsolete.nsh')}`,
    source,
  ];
  const { stdout } = await promisify(execFile)(
    join(nsis.directory, 'makensis.exe'),
    args,
    {
      timeout: 300_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        // No NSISDIR, NSISCONFDIR or credential environment reaches makensis.
        // eslint-disable-next-line no-restricted-properties -- OS directory, not a key.
        SystemRoot: process.env.SystemRoot,
        // eslint-disable-next-line no-restricted-properties -- OS directory, not a key.
        windir: process.env.windir,
        TEMP: generated,
        TMP: generated,
      },
    },
  );
  assertCompileLog(stdout, args);
  const built = await readFile(output);
  assertNsisStub(built);
  assertCompiledMessages(built, script);
  await writeFile(join(generated, 'compile.log'), stdout);
  console.log(stdout);
  return { ...nsis, files: manifest.length };
}
