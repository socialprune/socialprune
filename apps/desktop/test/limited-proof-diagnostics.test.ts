import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { testEnvironment } from './process-environment.ts';

test('limited proof diagnostics preserve a child receipt before scratch cleanup, correlate parent/query evidence, and redact raw startup paths', async () => {
  const module = await import('../packaging/limited-proof-diagnostics.ts');
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-causal-receipt-'));
  try {
    const report = join(scratch, 'token.json'),
      output = join(scratch, 'retained');
    await writeFile(
      report,
      JSON.stringify({
        state: 'failed',
        phase: 'profile',
        failure: { code: 'PROFILE_PROOF_FAILED' },
        childPid: 0,
      }),
    );
    await writeFile(
      report + '.profile.json',
      JSON.stringify({
        state: 'failed',
        phase: 'profile-hive',
        failure: {
          code: 'ENOENT',
          invariant: 'GENERATED_FIRST_CAUSE',
          file: {
            pathClass: 'repo-relative',
            path: 'e2e/profile-hive-child.ts',
          },
          query: {
            queryClass: 'ps-profile-hive-proof.ps1',
            durationMs: 20,
            timeoutMs: 60000,
            failed: true,
          },
        },
      }),
    );
    await writeFile(
      report + '.profile.json.stderr.txt',
      `Error: GENERATED_STARTUP_FAILURE C:\\Users\\generated-person\\private\\file.mjs\n${'x'.repeat(20000)}`,
    );
    const failure = Object.assign(new Error('parent'), {
      query: {
        queryClass: 'ps-limited-token.ps1',
        durationMs: 13000,
        failed: true,
      },
    });
    const saved = await module.preserveLimitedProofFailure(
      report,
      failure,
      output,
    );
    const result = JSON.parse(await readFile(saved, 'utf8')) as {
      profile: unknown;
      startup: string[];
      parent: unknown;
    };
    expect(result.profile).toMatchObject({
      failure: { invariant: 'GENERATED_FIRST_CAUSE' },
    });
    expect(result.parent).toMatchObject({
      query: { queryClass: 'ps-limited-token.ps1', durationMs: 13000 },
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain('generated-person');
    expect(text).not.toContain(scratch);
    expect(text.length).toBeLessThan(22000);
    await rm(report + '.profile.json');
    expect(await readdir(output)).toHaveLength(1);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')(
  'a generated profile startup failure is retained with its first cause, not just PROFILE_PROOF_FAILED',
  async () => {
    const scratch = await mkdtemp(
      join(tmpdir(), 'socialprune-profile-startup-'),
    );
    try {
      await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'e2e/proof-acl.ps1'),
          '-Action',
          'grant',
          '-Root',
          scratch,
        ],
        { timeout: WINDOWS_QUERY_TIMEOUT_MS, env: testEnvironment() },
      );
      const source = await readFile(
        join(directory, 'e2e/limited-token.ps1'),
        'utf8',
      );
      const launcher = join(scratch, 'limited-token.ps1');
      const missing = join(scratch, 'generated-profile-missing.mjs');
      await writeFile(
        launcher,
        source
          .replace(
            '"$PSScriptRoot\\profile-hive-child.ts"',
            `'${missing.replaceAll("'", "''")}'`,
          )
          .replace(
            '"$PSScriptRoot\\profile-hive-proof.ps1"',
            `'${join(directory, 'e2e/profile-hive-proof.ps1').replaceAll("'", "''")}'`,
          ),
      );
      const args = join(scratch, 'args.json'),
        report = join(scratch, 'token.json');
      await writeFile(args, '[]');
      const error: unknown = await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          launcher,
          '-Executable',
          process.execPath,
          '-ArgumentsFile',
          args,
          '-TokenReport',
          report,
        ],
        { timeout: 180000, env: testEnvironment() },
      ).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('PROFILE_PROOF_FAILED');
      const stderr = await readFile(
        report + '.profile.json.stderr.txt',
        'utf8',
      );
      expect(stderr).toContain('MODULE_NOT_FOUND');
      expect(stderr).toContain('generated-profile-missing.mjs');
      expect(error).toHaveProperty('limitedProofEvidence');
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  240000,
);

test('runner-derived test budgets enclose the slow query and the restricted sequence, not the old 5/60 second test defaults', async () => {
  const budget = await import('./windows-test-budgets.ts');
  expect(budget.WINDOWS_QUERY_TEST_TIMEOUT_MS).toBeGreaterThanOrEqual(
    3 * 13689 + 100,
  );
  expect(budget.RESTRICTED_SEQUENCE_TEST_TIMEOUT_MS).toBeGreaterThanOrEqual(
    3 * (13700 + 13736 * 3 + 13445) + 100,
  );
  const data = await readFile(
    join(directory, 'test/data-directory.test.ts'),
    'utf8',
  );
  const shell = await readFile(
    join(directory, 'test/powershell.test.ts'),
    'utf8',
  );
  const nsis = await readFile(
    join(directory, 'test/nsis-access.test.ts'),
    'utf8',
  );
  expect(data).toContain('WINDOWS_QUERY_TEST_TIMEOUT_MS');
  expect(shell).toContain('WINDOWS_QUERY_TEST_TIMEOUT_MS');
  expect(nsis).toContain('RESTRICTED_SEQUENCE_TEST_TIMEOUT_MS');
});

test('profile first-cause diagnostics can load without resolving Vitest or Playwright', async () => {
  const profile = await readFile(
    join(directory, 'e2e/profile-hive-child.ts'),
    'utf8',
  );
  const diagnostics = await readFile(
    join(directory, 'packaging/limited-proof-diagnostics.ts'),
    'utf8',
  );
  const excerpt = await readFile(
    join(directory, 'packaging/diagnostic-output.ts'),
    'utf8',
  );
  for (const source of [profile, diagnostics, excerpt])
    expect(source).not.toMatch(
      /red-controls\.ts|createRequire|require\.resolve/,
    );
});
