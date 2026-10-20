import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import { collectProof } from '../e2e/proof-collection.ts';
import { failureRecord } from '../e2e/proof-failure.ts';
import assert from 'node:assert/strict';
import {
  runPowerShell,
  runNativeQuery,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { testEnvironment } from './process-environment.ts';

test('causal receipts expose only repo-relative or run-owned paths', () => {
  const repo = join(tmpdir(), 'generated-repo');
  const run = join(tmpdir(), 'generated-run');
  for (const [path, expected] of [
    [join(repo, 'apps/desktop/dist/nsis-tools'), 'repo-relative'],
    [join(run, 'temp/probe'), 'run-owned'],
    [join(tmpdir(), 'private/probe'), 'external'],
  ] as const) {
    const result = failureRecord(
      Object.assign(new Error('must not serialize this private message'), {
        code: 'EPERM',
        syscall: 'rmdir',
        path,
      }),
      repo,
      run,
      join(repo, 'apps/desktop/packaging/nsis-fetch.ts'),
    );
    expect(result).toMatchObject({
      code: 'EPERM',
      syscall: 'rmdir',
      pathClass: expected,
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain(tmpdir());
  }
  try {
    assert.equal(false, true, 'GENERATED_INVARIANT');
  } catch (error) {
    expect(failureRecord(error, repo, run)).toMatchObject({
      code: 'ERR_ASSERTION',
      invariant: 'GENERATED_INVARIANT',
      assertion: { operator: 'strictEqual', actual: false, expected: true },
    });
  }
});

test.skipIf(process.platform !== 'win32')(
  'restricted child persists its causal EPERM and parent collects partial evidence without child writes to dist',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'socialprune-proof-access-'));
    const ps = (action: string) =>
      runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'e2e/proof-acl.ps1'),
          '-Action',
          action,
          '-Root',
          root,
        ],
        {
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          windowsHide: true,
          env: testEnvironment(),
        },
      );
    let denied = false;
    try {
      for (const folder of ['parent/nsis-tools', 'child', 'output'])
        await mkdir(join(root, folder), { recursive: true });
      await writeFile(
        join(root, 'output/release-system-token-smoke.json'),
        'parent-before',
      );
      await writeFile(join(root, 'output/summary.md'), 'parent-summary');
      await ps('grant');
      await ps('deny-delete');
      denied = true;
      const entry = join(root, 'child.mjs');
      const receipt = 'release-child-smoke.json';
      await writeFile(
        entry,
        `import {appendFile,rename,writeFile} from 'node:fs/promises'; import {runProof} from ${JSON.stringify(pathToFileURL(join(directory, 'e2e/proof-runtime.ts')).href)};
process.env.GITHUB_STEP_SUMMARY=${JSON.stringify(join(root, 'output/summary.md'))};
process.exitCode=await runProof('smoke',${JSON.stringify(join(root, 'child'))},${JSON.stringify(join(directory, 'packaging/nsis-fetch.ts'))},async()=>{await writeFile(${JSON.stringify(join(root, 'child/evidence/release-system-token-smoke.json'))},'generated partial evidence');await appendFile(process.env.GITHUB_STEP_SUMMARY,'child-summary');await rename(${JSON.stringify(join(root, 'parent/nsis-tools'))},${JSON.stringify(join(root, 'parent/moved'))});});`,
      );
      const args = join(root, 'arguments.json');
      const token = join(root, 'release-token-smoke.json');
      await writeFile(args, JSON.stringify([entry]));
      await expect(
        runPowerShell(
          [
            '-NoProfile',
            '-NonInteractive',
            '-File',
            join(directory, 'e2e/limited-token.ps1'),
            '-Executable',
            process.execPath,
            '-ArgumentsFile',
            args,
            '-TokenReport',
            token,
          ],
          {
            timeout: WINDOWS_QUERY_TIMEOUT_MS,
            windowsHide: true,
            env: testEnvironment(),
          },
        ),
      ).rejects.toMatchObject({ code: 1 });
      expect(
        JSON.parse((await readFile(token, 'utf8')).replace(/^\uFEFF/, '')),
      ).toMatchObject({ childExit: 1, adminMember: false });
      const failure = JSON.parse(
        await readFile(join(root, 'child', receipt), 'utf8'),
      ) as { failure: unknown };
      expect(failure).toMatchObject({
        state: 'failed',
        mode: 'smoke',
        failure: {
          code: 'EPERM',
          syscall: 'rename',
          pathClass: 'external',
          path: null,
        },
      });
      expect(
        await readFile(
          join(root, 'output/release-system-token-smoke.json'),
          'utf8',
        ),
      ).toBe('parent-before');
      expect(await readFile(join(root, 'output/summary.md'), 'utf8')).toBe(
        'parent-summary',
      );
      const collected = await collectProof(
        join(root, 'child'),
        join(root, 'output'),
      );
      expect(collected.collected.sort()).toEqual([
        receipt,
        'release-system-token-smoke.json',
      ]);
      expect(collected.summary?.toString()).toBe('child-summary');
      expect(
        JSON.parse(await readFile(join(root, 'output', receipt), 'utf8')),
      ).toEqual(failure);
      expect(
        await readFile(
          join(root, 'output/release-system-token-smoke.json'),
          'utf8',
        ),
      ).toBe('generated partial evidence');
    } finally {
      if (denied) await ps('restore');
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);

test('an uncaught callback writes a causal receipt before Node exits without swallowing the error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'socialprune-uncaught-proof-'));
  try {
    const entry = join(root, 'child.mjs');
    await writeFile(
      entry,
      `import {runProof} from ${JSON.stringify(pathToFileURL(join(directory, 'e2e/proof-runtime.ts')).href)};
await runProof('controls',${JSON.stringify(root)},${JSON.stringify(entry)},()=>new Promise(()=>{setImmediate(()=>{throw Object.assign(new Error('generated failure'),{code:'EPERM',syscall:'rmdir',path:${JSON.stringify(join(root, 'temp/probe'))}});});}));`,
    );
    await expect(
      runNativeQuery(process.execPath, [entry], {
        timeout: WINDOWS_QUERY_TIMEOUT_MS,
        windowsHide: true,
        env: testEnvironment(),
      }),
    ).rejects.toMatchObject({ code: 1 });
    expect(
      JSON.parse(
        await readFile(join(root, 'release-child-controls.json'), 'utf8'),
      ),
    ).toMatchObject({
      mode: 'controls',
      state: 'failed',
      failure: {
        code: 'EPERM',
        syscall: 'rmdir',
        pathClass: 'run-owned',
        path: 'temp/probe',
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test('all installed modes use one child entry and build inputs remain read-only', async () => {
  const launcher = await readFile(
    join(directory, 'e2e/installed-proof.ts'),
    'utf8',
  );
  expect(launcher).toContain("'e2e/installed-child.ts'");
  expect(launcher).toContain('collectProof(scratch, dist)');
  for (const file of [
    'e2e/installer-fault-controls.ts',
    'e2e/uninstall-controls.ts',
    'e2e/system-proof.ts',
    'packaging/release-smoke.ts',
  ]) {
    const source = await readFile(join(directory, file), 'utf8');
    expect(source).not.toMatch(/(?:writeFile|rm)\(\s*join\(dist/);
    expect(source).toContain('proofOutput(');
  }
  const controls = await readFile(
    join(directory, 'e2e/uninstall-controls.ts'),
    'utf8',
  );
  expect(controls).toMatch(
    /finally \{\s+try \{\s+await network\.stop\(\);\s+\} finally \{\s+await rm\(scratch/,
  );
  expect(controls).toContain("proofOutput('release-controls-failure.json')");
  expect(controls).toContain(
    "proofOutput('release-controls-cleanup-failure.json')",
  );
  for (const file of [
    'src/main/index.ts',
    'packaging/release.ts',
    'packaging/nsis.ts',
    'packaging/nsis-fetch.ts',
  ]) {
    const source = await readFile(join(directory, file), 'utf8');
    expect(source).not.toContain('proof-context');
    expect(source).not.toContain('proof-runtime');
    expect(source).not.toContain('PROOF_WORKSPACE');
  }
});
