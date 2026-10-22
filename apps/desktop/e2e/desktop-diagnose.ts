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
  DIAGNOSE_WORK_MS,
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
import {
  diagnosticPhase,
  collectDiagnosticReceipts,
  copyDiagnosticBundle,
} from './token-deadline.ts';

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
  const startedAt = Date.now();
  const deadline = startedAt + DIAGNOSE_WORK_MS;
  const returnDeadline = startedAt + DIAGNOSE_JOB_MS;
  const remaining = () => {
    const ms = deadline - Date.now();
    if (ms <= 0) throw new Error('DIAGNOSE_WORK_DEADLINE');
    return ms;
  };
  variants(variant);
  await mkdir(results, { recursive: true });
  const terms = diagnosticTerms(variant);
  const build = JSON.parse(
    await readFile(join(bundle, 'diagnose-build.json'), 'utf8'),
  ) as {
    releaseAsarSha256: string;
    tokenProbe: { executable: string; sha256: string };
  };
  const tokenProbe = join(bundle, build.tokenProbe.executable);
  assert.equal(
    hash(await readFile(tokenProbe)),
    build.tokenProbe.sha256,
    'DIAGNOSE_TOKEN_HELPER_HASH',
  );
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-diagnose-'));
  const config: DiagnoseConfig = {
    variant,
    bundle: join(scratch, 'bundle'),
    data: join(scratch, 'generated'),
    results,
    source: build.releaseAsarSha256,
    deadline,
    returnDeadline,
  };
  const configFile = join(scratch, 'config.json');
  await writeFile(configFile, JSON.stringify(config));
  const annotate = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await annotate(full);
      else if (entry.name.endsWith('.json')) {
        let row: unknown;
        try {
          row = JSON.parse(
            (await readFile(full, 'utf8')).replace(/^\uFEFF/, ''),
          );
        } catch {
          // A killed writer can leave its last JSON incomplete. Keep those
          // bytes and add a causal record, never erase the native receipt.
          await writeFile(
            full + '.unparsed.json',
            JSON.stringify({
              ...terms,
              state: 'partial-receipt',
              file: entry.name,
            }),
          );
          continue;
        }
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
  const launch = async (mode: 'probe', selection: DiagnoseVariant) => {
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
    const outputDirectory = join(results, mode);
    await mkdir(outputDirectory, { recursive: true });
    const collect = () => collectDiagnosticReceipts(workspace, outputDirectory);
    let collection = Promise.resolve();
    let collectionFailures = 0;
    const collector = setInterval(() => {
      collection = collection.then(collect).catch((error: unknown) => {
        collectionFailures++;
        console.error(
          'DIAGNOSE_INCREMENTAL_COLLECTION_FAILED',
          error instanceof Error && 'code' in error ? error.code : 'unknown',
        );
      });
    }, 500);
    const phaseDeadline = deadline;
    let returned = true;
    try {
      const output = await diagnosticPhase(
        phaseDeadline,
        async (ms, signal) => {
          // Whole-second launcher bound encloses the exact phase remainder;
          // diagnosticPhase still enforces the original shared deadline.
          const nativeTimeout = Math.max(1, Math.ceil(ms / 1000));
          return await runPowerShell(
            [
              '-NoProfile',
              '-NonInteractive',
              '-File',
              join(directory, 'e2e/diagnose-launch.ps1'),
              '-Mode',
              selection,
              '-Executable',
              process.execPath,
              '-ArgumentsFile',
              argumentFile,
              '-TokenReport',
              tokenReport,
              '-TimeoutSeconds',
              String(nativeTimeout),
              ...(selection === 'restricted-session-desktop'
                ? []
                : [
                    '-TokenProbe',
                    tokenProbe,
                    '-DeadlineUnixMs',
                    String(phaseDeadline),
                  ]),
            ],
            { timeout: ms, signal, windowsHide: true },
          );
        },
        async () => {
          await collection;
          await collect();
        },
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
      clearInterval(collector);
      await collection;
      await mkdir(join(results, mode), { recursive: true });
      await collect();
      const collected = await collectProof(workspace, join(results, mode));
      await writeFile(
        join(results, `release-diagnose-collection-${mode}.json`),
        JSON.stringify({
          ...terms,
          ...collected,
          incrementalCollectionFailures: collectionFailures,
        }),
      );
      await annotate(join(results, mode));
    }
    return returned;
  };
  try {
    remaining();
    await mkdir(config.bundle);
    if (variant !== 'token-chain') {
      const name = variant === 'lifecycle-test-build' ? 'lifecycle' : 'release';
      await diagnosticPhase(
        deadline,
        (_ms, signal) =>
          copyDiagnosticBundle(
            join(bundle, name),
            join(config.bundle, name),
            signal,
          ),
        () => Promise.resolve(),
      );
    }
    await ps(
      'e2e/proof-acl.ps1',
      ['-Action', 'grant', '-Root', scratch],
      remaining(),
    );
    // Pinned release bytes run from disposable scratch, with the same baseline
    // token/desktop/job recipe. This probes no installer or fixed user layout.
    await launch('probe', variant);
    let summary: Summary;
    try {
      summary = JSON.parse(
        await readFile(
          join(results, 'probe/release-diagnose-summary.json'),
          'utf8',
        ),
      ) as Summary;
    } catch {
      const token = JSON.parse(
        (
          await readFile(
            join(results, 'probe/release-diagnose-token.json'),
            'utf8',
          ).catch(() => '{}')
        ).replace(/^\uFEFF/, ''),
      ) as { state?: string };
      summary = {
        ...terms,
        state:
          token.state === 'not-applicable'
            ? 'not-applicable'
            : variant === 'token-chain' && token.state === 'returned'
              ? 'token-probe-returned'
              : 'blocked-or-launch-failed',
        reason: 'See token/native/child receipts; no readiness inference',
        token,
      };
    }
    summary = {
      ...summary,
      workDeadline: deadline,
      returnedWithinWorkDeadline: Date.now() <= deadline,
      tokenReceipts: [
        'release-token-owner.ndjson',
        'release-token-helper.ndjson',
        'release-token-launch.ndjson',
      ],
      deployment: 'byte-checked-release-copy-not-installed',
    };
    await writeFile(
      join(results, 'release-diagnose-summary.json'),
      JSON.stringify(summary, null, 2),
    );
    return summary;
  } finally {
    // Every uploaded JSON, including reused lower-level receipts, carries the
    // variant and diagnostic-only terms. None can be mistaken for acceptance.
    await annotate(results);
    assert.ok(Date.now() < returnDeadline, 'DIAGNOSE_RETURN_DEADLINE');
    await rm(scratch, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    await writeFile(
      join(results, 'release-diagnose-deadline.json'),
      JSON.stringify({
        ...terms,
        startedAt,
        deadline,
        returnDeadline,
        returnedAt: Date.now(),
        workMs: DIAGNOSE_WORK_MS,
        cleanupReserveMs: DIAGNOSE_JOB_MS - DIAGNOSE_WORK_MS,
      }),
    );
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
