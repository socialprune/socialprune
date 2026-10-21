import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { root, directory, dist } from '../packaging/paths.ts';
import { assertProductionModules } from '../packaging/boundary.ts';
import {
  diagnosticTerms,
  variants,
  DIAGNOSE_VARIANTS,
} from '../packaging/diagnose-policy.ts';
import { summarize } from '../e2e/diagnose-summary.ts';
import { extractFile } from '@electron/asar';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { testEnvironment } from './process-environment.ts';

type WorkflowJob = {
  steps: {
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
  }[];
};

function assertHistoryCheckouts(jobs: Record<string, WorkflowJob>): void {
  // build:release reaches nsis.ts, which compares the index, HEAD and HEAD^.
  // Keep the check command-based so moving a reader to another job cannot
  // silently inherit checkout's depth-1 default.
  const readsHistory =
    /\b(?:build:release|release:desktop)\b|\bpackaging[/\\](?:release|nsis)\.ts\b|\bgit(?:\.exe)?\s+(?:(?:--[\w-]+(?:=\S+)?|-C\s+\S+|-c\s+\S+)\s+)*(?:log|show|rev-list|rev-parse|describe|merge-base|diff|blame|shortlog|cat-file|for-each-ref|name-rev|tag)\b/;
  for (const [name, job] of Object.entries(jobs)) {
    let checkout: WorkflowJob['steps'][number] | undefined;
    for (const step of job.steps) {
      if (step.uses?.startsWith('actions/checkout@')) checkout = step;
      if (step.run && readsHistory.test(step.run))
        expect(
          checkout?.with?.['fetch-depth'],
          `${name}: Git history reader requires an earlier fetch-depth: 0 checkout`,
        ).toBe(0);
    }
  }
}

test('every diagnostic job that reads Git history checks out full history first', async () => {
  const value = parse(
    await readFile(
      join(root, '.github/workflows/desktop-diagnose.yml'),
      'utf8',
    ),
  ) as { jobs: Record<string, WorkflowJob> };
  assertHistoryCheckouts(value.jobs);
});

test('history checkout policy follows readers across jobs and rejects missing, shallow or late checkout', () => {
  const checkout = (depth?: number) => ({
    uses: 'actions/checkout@fixture',
    with: depth === undefined ? {} : { 'fetch-depth': depth },
  });
  for (const name of ['build', 'probe', 'summary'])
    for (const run of [
      'pnpm --filter @socialprune/desktop build:release',
      'pnpm release:desktop',
      'node packaging/release.ts',
      'git --no-pager show HEAD^:apps/desktop/packaging/shipped-files.json',
      'git log -1',
      'git describe --tags',
      'git -C apps/desktop cat-file -p HEAD^',
      'git tag --list',
    ]) {
      const reader = { run };
      for (const steps of [
        [reader],
        [checkout(), reader],
        [checkout(1), reader],
        [reader, checkout(0)],
      ])
        expect(() => assertHistoryCheckouts({ [name]: { steps } })).toThrow(
          `${name}: Git history reader requires an earlier fetch-depth: 0 checkout`,
        );
      expect(() =>
        assertHistoryCheckouts({ [name]: { steps: [checkout(0), reader] } }),
      ).not.toThrow();
    }
  expect(() =>
    assertHistoryCheckouts({
      probe: {
        steps: [
          checkout(),
          { run: 'node apps/desktop/e2e/desktop-diagnose.ts' },
        ],
      },
      summary: {
        steps: [
          checkout(),
          { run: 'node apps/desktop/e2e/diagnose-summary.ts' },
        ],
      },
    }),
  ).not.toThrow();
});

test('diagnostic workflow has dispatch-only read permission, immutable actions, no publish or release cache', async () => {
  const text = await readFile(
    join(root, '.github/workflows/desktop-diagnose.yml'),
    'utf8',
  );
  const value = parse(text) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: Record<
      string,
      {
        needs?: unknown;
        if?: string;
        'timeout-minutes': number;
        strategy?: { 'fail-fast': boolean; matrix: unknown };
        steps: {
          uses?: string;
          run?: string;
          with?: Record<string, unknown>;
          'timeout-minutes': number;
        }[];
      }
    >;
  };
  expect(Object.keys(value.on)).toEqual(['workflow_dispatch']);
  expect(value.permissions).toEqual({ contents: 'read' });
  expect(Object.keys(value.jobs)).toEqual(['build', 'probe', 'summary']);
  expect(value.jobs.probe?.strategy?.['fail-fast']).toBe(false);
  expect(value.jobs.summary?.if).toBe('always()');
  expect(
    value.jobs.build!['timeout-minutes'] +
      value.jobs.probe!['timeout-minutes'] +
      value.jobs.summary!['timeout-minutes'],
  ).toBeLessThan(20);
  for (const job of Object.values(value.jobs))
    for (const step of job.steps) {
      expect(step['timeout-minutes']).toBeGreaterThan(0);
      if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      expect(step.with?.cache).toBeUndefined();
    }
  expect(text).not.toMatch(
    /secrets\.|actions\/cache@|gh workflow run|gh release|attest|npm publish/,
  );
  expect(text).toContain('pnpm build:desktop');
  expect(text).toContain('fuses:check');
  expect(text).toContain('build:release');
  expect(
    await readFile(join(directory, 'packaging/manifest.ts'), 'utf8'),
  ).toContain("'.github/workflows/desktop-diagnose.yml'");
});

test('all seven diagnostic terms and input validation reject workflow injection', () => {
  expect(variants()).toEqual([...DIAGNOSE_VARIANTS]);
  expect(variants('baseline,lifecycle-test-build')).toEqual([
    'baseline',
    'lifecycle-test-build',
  ]);
  for (const invalid of [
    'baseline,baseline',
    'baseline;whoami',
    '../baseline',
    'software-rendering,',
  ])
    expect(() => variants(invalid)).toThrow('DIAGNOSE_VARIANTS_INVALID');
  for (const variant of DIAGNOSE_VARIANTS)
    expect(diagnosticTerms(variant)).toMatchObject({
      diagnosticOnly: true,
      acceptance: false,
    });
  for (const variant of [
    'chromium-verbose',
    'software-rendering',
    'no-renderer-sandbox',
  ] as const)
    expect(diagnosticTerms(variant).commandLineChanged).toBe(true);
});

test('lifecycle diagnostic entry cannot enter production and preserves production behaviour', async () => {
  expect(() =>
    assertProductionModules([
      join(directory, 'test/entries/lifecycle-main.ts'),
    ]),
  ).toThrow('PRODUCTION_TEST_IMPORT');
  const entry = await readFile(
    join(directory, 'test/entries/lifecycle-main.ts'),
    'utf8',
  );
  expect(entry).toContain("import '../../src/main/index.ts'");
  const observer = await readFile(
    join(directory, 'test/lifecycle-observer.ts'),
    'utf8',
  );
  for (const event of [
    'did-start-loading',
    'did-finish-load',
    'did-fail-load',
    'render-process-gone',
    'unresponsive',
    'ready-to-show',
    'show',
    'loadURL-settled',
    'loadURL-rejected',
  ])
    expect(observer).toContain(event);
  expect(observer).not.toMatch(
    /disable-gpu|no-sandbox|showInactive|setFocusable|window\.show\s*=/,
  );
  if (process.platform === 'win32') {
    const release = extractFile(
      join(dist, 'release/resources/app.asar'),
      'main.mjs',
    ).toString();
    expect(release).not.toContain('diagnostic-entry');
    expect(release).not.toContain('diagnostic-events=');
  }
  const builder = await readFile(
    join(directory, 'packaging/diagnose-build.ts'),
    'utf8',
  );
  expect(builder).toContain('DIAGNOSE_RELEASE_CHANGED');
  expect(builder).toContain('assertFuses');
});

test('summary is complete even when variants are missing and does not call diagnostics acceptance', async () => {
  const scratch = await mkdtemp(
    join(tmpdir(), 'socialprune-diagnose-summary-'),
  );
  try {
    const input = join(scratch, 'input');
    await mkdir(input);
    await writeFile(
      join(input, 'release-diagnose-summary.json'),
      JSON.stringify({
        variant: 'baseline',
        state: 'observed-failure',
        readinessReached: false,
        gpuState: 'not-observed',
        branch: 'none',
      }),
    );
    const table = await summarize(input, join(scratch, 'output'));
    for (const variant of DIAGNOSE_VARIANTS) expect(table).toContain(variant);
    expect(table).toContain('loadURL');
    expect(table).toContain('no-artifact-or-not-selected');
    expect(table).toContain('None replaces CI release acceptance');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')(
  'session desktop comparison either runs the restricted child or retains its native access blocker',
  async () => {
    const scratch = await mkdtemp(
      join(tmpdir(), 'socialprune-diagnose-session-'),
    );
    try {
      const args = join(scratch, 'args.json');
      const token = join(scratch, 'release-token.json');
      const marker = join(scratch, 'child.txt');
      await writeFile(
        args,
        JSON.stringify([
          '-e',
          "require('node:fs').writeFileSync(process.argv[1],'session-child')",
          marker,
        ]),
      );
      const result = await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'e2e/diagnose-launch.ps1'),
          '-Mode',
          'restricted-session-desktop',
          '-Executable',
          process.execPath,
          '-ArgumentsFile',
          args,
          '-TokenReport',
          token,
          '-TimeoutSeconds',
          '30',
        ],
        {
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          windowsHide: true,
          env: testEnvironment(),
        },
      ).then(
        () => 0,
        (error: unknown) =>
          error instanceof Error && 'code' in error ? Number(error.code) : -1,
      );
      const observed = JSON.parse(
        (await readFile(token, 'utf8')).replace(/^\uFEFF/, ''),
      ) as {
        state: string;
        reason?: string;
        childExit?: number;
        tokenSelection?: string;
        diagnosticOnly: boolean;
      };
      expect(observed.diagnosticOnly).toBe(true);
      if (result === 0) {
        expect(observed.tokenSelection).toBe('LUA-medium-admin-deny-only');
        expect(observed.childExit).toBe(0);
        expect(await readFile(marker, 'utf8')).toBe('session-child');
      } else {
        expect(result).toBe(2);
        expect(observed.state).toBe('blocked');
        expect(observed.reason).toMatch(
          /DIAGNOSE_LAUNCH:(OpenSessionDesktop|ImpersonateSessionCheck|CreateOwnedChild):\d+/,
        );
      }
      process.stdout.write(
        'DIAGNOSE_SESSION_DESKTOP ' + JSON.stringify(observed) + '\n',
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  WINDOWS_QUERY_TIMEOUT_MS + 5_000,
);
