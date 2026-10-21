import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  diagnosticTerms,
  variants,
  DIAGNOSE_JOB_MS,
  DIAGNOSE_CHILD_SECONDS,
  type DiagnoseVariant,
} from '../packaging/diagnose-policy.ts';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { directory } from '../packaging/paths.ts';
import { collectProof } from './proof-collection.ts';
import type { DiagnoseConfig } from './diagnose-child.ts';
import { controlOutputExcerpt } from '../packaging/diagnostic-output.ts';

type Summary = Record<string, unknown> & {
  variant: DiagnoseVariant;
  state: string;
};
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const ps = (
  script: string,
  args: string[],
  timeout = WINDOWS_QUERY_TIMEOUT_MS,
) =>
  runPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, script),
      ...args,
    ],
    { timeout, windowsHide: true },
  );

export async function runDiagnostic(
  variant: DiagnoseVariant,
  bundle: string,
  results: string,
) {
  variants(variant);
  await mkdir(results, { recursive: true });
  const initial = JSON.parse(
    (await ps('packaging/install-layout.ps1', [])).stdout,
  ) as {
    installExists: boolean;
    dataExists: boolean;
    registrationExists: boolean;
    existingShortcuts: string[];
  };
  assert.equal(
    initial.installExists,
    false,
    'DIAGNOSE_EXISTING_INSTALL_REFUSED',
  );
  assert.equal(initial.dataExists, false, 'DIAGNOSE_EXISTING_DATA_REFUSED');
  assert.equal(
    initial.registrationExists,
    false,
    'DIAGNOSE_EXISTING_REGISTRATION_REFUSED',
  );
  assert.deepEqual(
    initial.existingShortcuts,
    [],
    'DIAGNOSE_EXISTING_SHORTCUT_REFUSED',
  );
  const terms = diagnosticTerms(variant);
  const build = JSON.parse(
    await readFile(join(bundle, 'diagnose-build.json'), 'utf8'),
  ) as {
    installer: string;
    installerSha256: string;
    releaseAsarSha256: string;
  };
  const setup = join(bundle, build.installer);
  assert.equal(
    hash(await readFile(setup)),
    build.installerSha256,
    'DIAGNOSE_INSTALLER_HASH',
  );
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-diagnose-'));
  const config: DiagnoseConfig = {
    variant,
    bundle,
    setup,
    data: join(scratch, 'generated'),
    results,
    source: build.releaseAsarSha256,
  };
  const configFile = join(scratch, 'config.json');
  await writeFile(configFile, JSON.stringify(config));
  let installed = false;
  const annotate = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await annotate(full);
      else if (entry.name.endsWith('.json')) {
        const row: unknown = JSON.parse(
          (await readFile(full, 'utf8')).replace(/^\uFEFF/, ''),
        );
        await writeFile(
          full,
          JSON.stringify(
            {
              ...(typeof row === 'object' && row !== null
                ? row
                : { value: row }),
              ...terms,
            },
            null,
            2,
          ),
        );
      }
    }
  };
  const launch = async (
    mode: 'install' | 'probe' | 'cleanup',
    selection:
      'restricted-owned' | 'unrestricted-owned' | 'restricted-session-desktop',
  ) => {
    const workspace = join(scratch, mode);
    await mkdir(workspace);
    const argumentFile = join(scratch, `${mode}-arguments.json`);
    await writeFile(
      argumentFile,
      JSON.stringify([
        join(directory, 'e2e/diagnose-child.ts'),
        mode,
        workspace,
        configFile,
      ]),
    );
    const tokenReport = join(workspace, 'release-diagnose-token.json');
    let returned = true;
    try {
      const output =
        selection === 'restricted-owned'
          ? await ps(
              'e2e/limited-token.ps1',
              [
                '-Executable',
                process.execPath,
                '-ArgumentsFile',
                argumentFile,
                '-TokenReport',
                tokenReport,
                '-TimeoutSeconds',
                String(DIAGNOSE_CHILD_SECONDS),
              ],
              DIAGNOSE_JOB_MS,
            )
          : await ps(
              'e2e/diagnose-launch.ps1',
              [
                '-Mode',
                selection,
                '-Executable',
                process.execPath,
                '-ArgumentsFile',
                argumentFile,
                '-TokenReport',
                tokenReport,
                '-TimeoutSeconds',
                String(DIAGNOSE_CHILD_SECONDS),
              ],
              DIAGNOSE_JOB_MS,
            );
      console.log(output.stdout);
      if (output.stderr) console.error(output.stderr);
    } catch (error) {
      returned = false;
      await writeFile(
        join(results, `release-diagnose-launch-${mode}.json`),
        JSON.stringify({
          ...terms,
          state: 'launch-failed',
          selection,
          code: error instanceof Error && 'code' in error ? error.code : null,
          message:
            error instanceof Error ? error.message.split('\n')[0] : 'unknown',
          stderr: controlOutputExcerpt(
            error instanceof Error && 'stderr' in error
              ? String(error.stderr)
              : '',
          ),
        }),
      );
    } finally {
      await mkdir(join(results, mode), { recursive: true });
      const collection = await collectProof(workspace, join(results, mode));
      await writeFile(
        join(results, `release-diagnose-collection-${mode}.json`),
        JSON.stringify({ ...terms, ...collection }),
      );
      await annotate(join(results, mode));
    }
    return returned;
  };
  try {
    await ps('e2e/proof-acl.ps1', ['-Action', 'grant', '-Root', scratch]);
    // Results live in run-owned scratch while low-token children write. Only
    // the parent copies bytes into the checkout's artifact output afterwards.
    installed = await launch('install', 'restricted-owned');
    if (!installed) throw new Error('DIAGNOSE_INSTALL_FAILED');
    const selection =
      variant === 'unrestricted-owned'
        ? 'unrestricted-owned'
        : variant === 'restricted-session-desktop'
          ? 'restricted-session-desktop'
          : 'restricted-owned';
    await launch('probe', selection);
    let summary: Summary;
    try {
      summary = JSON.parse(
        await readFile(
          join(results, 'probe/release-diagnose-summary.json'),
          'utf8',
        ),
      ) as Summary;
    } catch {
      const token: unknown = JSON.parse(
        (
          await readFile(
            join(results, 'probe/release-diagnose-token.json'),
            'utf8',
          ).catch(() => '{}')
        ).replace(/^\uFEFF/, ''),
      );
      summary = {
        ...terms,
        state: 'blocked-or-launch-failed',
        reason: 'See token/native/child receipts; no readiness inference',
        token,
      };
    }
    await writeFile(
      join(results, 'release-diagnose-summary.json'),
      JSON.stringify(summary, null, 2),
    );
    return summary;
  } finally {
    // The initial fixed layout was empty. Even an installer that failed after
    // changing it belongs to this attempt and must settle before closure.
    let cleaned = !installed;
    const after = JSON.parse(
      (await ps('packaging/install-layout.ps1', [])).stdout,
    ) as { installExists: boolean; registrationExists: boolean };
    if (installed || after.installExists || after.registrationExists)
      cleaned = await launch('cleanup', 'restricted-owned');
    // Every uploaded JSON, including reused lower-level receipts, carries the
    // variant and diagnostic-only terms. None can be mistaken for acceptance.
    await annotate(results);
    await rm(scratch, { recursive: true, force: true });
    assert.equal(cleaned, true, 'DIAGNOSE_CLEANUP_FAILED');
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const selected = variants(process.argv[2]);
  assert.equal(selected.length, 1, 'DIAGNOSE_EXACTLY_ONE_VARIANT_REQUIRED');
  const [variant] = selected;
  assert.ok(variant);
  const results = resolve(process.argv[4]!);
  try {
    await runDiagnostic(variant, resolve(process.argv[3]!), results);
  } catch (error) {
    await mkdir(results, { recursive: true });
    await writeFile(
      join(results, 'release-diagnose-orchestrator.json'),
      JSON.stringify({
        ...diagnosticTerms(variant),
        state: 'failed',
        message:
          error instanceof Error ? error.message.split('\n')[0] : 'unknown',
      }),
    );
    throw error;
  }
}
