import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directory, dist, root } from '../packaging/paths.ts';
import {
  runPowerShell,
  WINDOWS_POWERSHELL_EXECUTABLE,
  WINDOWS_PWSH_EXECUTABLE,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { testEnvironment } from './process-environment.ts';
import { failureRecord } from '../e2e/proof-failure.ts';
import { controlOutputExcerpt } from '../packaging/diagnostic-output.ts';

export const matrixRowIds = [
  'a-cmd-ver',
  'c-shell-command',
  'f-no-window',
  'f-detached',
  'f-new-console',
] as const;

// Each process receives the same measured query ceiling. Compilation and outer
// startup have their own query windows. No shortened fault-injection deadline.
export const MATRIX_TIMEOUT_MS =
  WINDOWS_QUERY_TIMEOUT_MS * (matrixRowIds.length + 2);

export function peImports(bytes: Buffer) {
  if (bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('MATRIX_NOT_PE');
  const header = bytes.readUInt32LE(0x3c);
  if (bytes.readUInt32LE(header) !== 0x4550)
    throw new Error('MATRIX_PE_HEADER');
  const optional = header + 24;
  const plus = bytes.readUInt16LE(optional) === 0x20b;
  const directories = optional + (plus ? 112 : 96);
  const sectionCount = bytes.readUInt16LE(header + 6);
  const sections = optional + bytes.readUInt16LE(header + 20);
  function offset(rva: number) {
    for (let i = 0; i < sectionCount; i++) {
      const section = sections + i * 40;
      const start = bytes.readUInt32LE(section + 12);
      const size = Math.max(
        bytes.readUInt32LE(section + 8),
        bytes.readUInt32LE(section + 16),
      );
      if (rva >= start && rva < start + size)
        return rva - start + bytes.readUInt32LE(section + 20);
    }
    throw new Error('MATRIX_PE_RVA');
  }
  function string(rva: number) {
    const start = offset(rva);
    const end = bytes.indexOf(0, start);
    if (end < start || end - start > 256) throw new Error('MATRIX_PE_NAME');
    return bytes.toString('ascii', start, end);
  }
  function table(index: number, stride: number, nameOffset: number) {
    const rva = bytes.readUInt32LE(directories + index * 8);
    if (!rva) return [];
    const start = offset(rva);
    const result: string[] = [];
    for (let i = 0; i < 1024; i++) {
      const entry = start + i * stride;
      if (bytes.subarray(entry, entry + stride).every((byte) => byte === 0))
        return result;
      // Modern delay descriptors use RVAs, never silently read legacy VAs.
      if (index === 13 && !(bytes.readUInt32LE(entry) & 1))
        throw new Error('MATRIX_PE_LEGACY_DELAY_VA');
      result.push(string(bytes.readUInt32LE(entry + nameOffset)));
    }
    throw new Error('MATRIX_PE_IMPORT_BOUND');
  }
  return {
    direct: table(1, 20, 12),
    delayed: table(13, 32, 4),
    transitiveImportsChecked: false,
    // No user32-free claim follows from a direct-import inspection alone.
    user32FreeClaim: false,
  };
}

type MatrixRow = {
  id: string;
  state: string;
  diagnosticOnly: boolean;
  replacesRestrictedProof: boolean;
  weakerDiagnostic?: boolean;
  exitCode?: number | null;
  durationMs?: number;
  stderr?: string;
};

function errorCode(error: unknown) {
  return error instanceof Error && 'code' in error
    ? String(error.code)
    : error instanceof Error
      ? error.name
      : 'UNKNOWN';
}

// Best effort by contract, with a persistent per-row trace. A collector error
// is recorded here, never converted into a success of the restricted proof.
export async function collectLimitedProofMatrix() {
  const output = join(
    dist,
    `release-limited-proof-matrix-${randomUUID()}.json`,
  );
  const startedAt = new Date().toISOString();
  let scratch: string | undefined;
  let rows: MatrixRow[] = [];
  let launchFailure: string | null = null;
  let launchEvidence: unknown = null;
  let imports: unknown = null;
  try {
    await mkdir(dist, { recursive: true });
    scratch = await mkdtemp(join(tmpdir(), 'socialprune-proof-matrix-'));
    const node = await readFile(process.execPath);
    imports = {
      sha256: createHash('sha256').update(node).digest('hex'),
      ...peImports(node),
    };
    const configuration = join(scratch, 'matrix.json');
    await writeFile(
      configuration,
      JSON.stringify({
        shell: WINDOWS_POWERSHELL_EXECUTABLE,
        alternateShell: WINDOWS_PWSH_EXECUTABLE,
        rowTimeoutMs: WINDOWS_QUERY_TIMEOUT_MS,
        nodeImports: imports,
      }),
    );
    await writeFile(
      output,
      JSON.stringify({
        version: 1,
        diagnosticOnly: true,
        replacesRestrictedProof: false,
        startedAt,
        nodeImports: imports,
        rows: [],
      }),
    );
    try {
      await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'e2e/limited-token.ps1'),
          '-Executable',
          process.execPath,
          '-ArgumentsFile',
          configuration,
          '-TokenReport',
          output,
          '-DiagnosticVariant',
          'runner-matrix',
        ],
        {
          timeout: MATRIX_TIMEOUT_MS,
          env: testEnvironment(),
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        },
      );
    } catch (error) {
      launchFailure = errorCode(error);
      launchEvidence = {
        failure: failureRecord(error, root, scratch),
        stderr: controlOutputExcerpt(
          error instanceof Error && 'stderr' in error
            ? String(error.stderr).slice(0, 8192)
            : '',
        ),
        stdout: controlOutputExcerpt(
          error instanceof Error && 'stdout' in error
            ? String(error.stdout).slice(0, 8192)
            : '',
        ),
      };
    }
    const retained: unknown = JSON.parse(
      (await readFile(output, 'utf8')).replace(/^\uFEFF/, ''),
    );
    if (
      typeof retained === 'object' &&
      retained !== null &&
      'rows' in retained &&
      Array.isArray(retained.rows)
    )
      rows = retained.rows as MatrixRow[];
  } catch (error) {
    launchFailure = errorCode(error);
  } finally {
    if (scratch) {
      try {
        await rm(scratch, { recursive: true, force: true });
      } catch (error) {
        launchFailure ??= 'CLEANUP_' + errorCode(error);
      }
    }
  }
  const observed = new Set(rows.map(({ id }) => id));
  for (const id of matrixRowIds)
    if (!observed.has(id))
      rows.push({
        id,
        state: 'unobserved',
        diagnosticOnly: true,
        replacesRestrictedProof: false,
      });
  try {
    await mkdir(dist, { recursive: true });
    await writeFile(
      output,
      JSON.stringify(
        {
          version: 1,
          diagnosticOnly: true,
          replacesRestrictedProof: false,
          startedAt,
          nodeImports: imports,
          launchFailure,
          launchEvidence,
          rows,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error('LIMITED_PROOF_MATRIX_WRITE_FAILED', errorCode(error));
  }
  for (const row of rows)
    process.stdout.write(
      'LIMITED_PROOF_MATRIX ' +
        JSON.stringify({
          id: row.id,
          state: row.state,
          exitCode: row.exitCode ?? null,
          durationMs: row.durationMs ?? null,
          weakerDiagnostic: row.weakerDiagnostic ?? null,
          diagnosticOnly: true,
        }) +
        '\n',
    );
  process.stdout.write(
    'LIMITED_PROOF_MATRIX_RECEIPT ' +
      JSON.stringify({ output, launchFailure }) +
      '\n',
  );
  return output;
}
