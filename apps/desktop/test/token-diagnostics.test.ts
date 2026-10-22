import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import {
  diagnosticPhase,
  collectDiagnosticReceipts,
} from '../e2e/token-deadline.ts';
import { directory, root } from '../packaging/paths.ts';
import { summarize } from '../e2e/diagnose-summary.ts';
import { assertRestrictedProofLauncher } from './proof-invariants.ts';

const electron = vi.hoisted(() => ({
  app: undefined as EventEmitter | undefined,
}));
vi.mock('electron', () => electron);

test('lifecycle retains systemErrorCode and distinguishes absent from zero', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-token-events-'));
  const file = join(scratch, 'events.ndjson');
  const original = [...process.argv];
  try {
    process.argv.push(`--diagnostic-events=${file}`);
    electron.app = new EventEmitter();
    await import('./lifecycle-observer.ts');
    for (const details of [
      {
        type: 'GPU',
        reason: 'launch-failed',
        exitCode: 49,
        systemErrorCode: 5,
      },
      { type: 'GPU', reason: 'launch-failed', exitCode: 49 },
      {
        type: 'GPU',
        reason: 'launch-failed',
        exitCode: 49,
        systemErrorCode: 0,
      },
    ])
      electron.app.emit('child-process-gone', {}, details);
    const rows = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((row) => JSON.parse(row) as { systemErrorCode: number | null });
    expect(rows.slice(1).map((row) => row.systemErrorCode)).toEqual([
      5,
      null,
      0,
    ]);
  } finally {
    process.argv.splice(0, process.argv.length, ...original);
    electron.app?.removeAllListeners();
    await rm(scratch, { recursive: true, force: true });
  }
});

test('system error codes appear in the summary table without inventing zero', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-token-summary-'));
  try {
    await writeFile(
      join(scratch, 'release-diagnose-summary.json'),
      JSON.stringify({
        variant: 'lifecycle-test-build',
        state: 'observed-failure',
        systemErrorCode: [5, null, 0],
      }),
    );
    const table = await summarize(scratch, join(scratch, 'output'));
    expect(table).toContain('systemErrorCode');
    expect(table).toContain('[5,null,0]');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('incremental native receipts survive collection before a phase returns', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-token-copy-'));
  try {
    const file = join(scratch, 'release-token-helper.ndjson');
    await writeFile(file, '{"event":"OpenProcessToken","error":5}\n');
    await writeFile(
      join(scratch, 'lifecycle.ndjson'),
      '{"event":"child-process-gone","systemErrorCode":5}\n',
    );
    const output = join(scratch, 'output');
    await collectDiagnosticReceipts(scratch, output);
    expect(
      await readFile(join(output, 'release-token-helper.ndjson'), 'utf8'),
    ).toBe('{"event":"OpenProcessToken","error":5}\n');
    expect(
      await readFile(join(output, 'release-lifecycle-events.ndjson'), 'utf8'),
    ).toBe('{"event":"child-process-gone","systemErrorCode":5}\n');
    await writeFile(
      file,
      '{"event":"OpenProcessToken","error":5}\n{"event":"end"}\n',
    );
    await collectDiagnosticReceipts(scratch, output);
    expect(
      (await readFile(join(output, 'release-token-helper.ndjson'), 'utf8'))
        .trim()
        .split('\n'),
    ).toHaveLength(2);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('diagnostic token changes are unreachable from production and release-proof callers', async () => {
  const forbidden =
    /token-launch|token-probe|token-[BCDE]-|TokenProbe|DeadlineUnixMs/;
  const walk = async (folder: string): Promise<string[]> => {
    const paths: string[] = [];
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) paths.push(...(await walk(file)));
      else if (/\.(?:ts|ps1|cs)$/.test(entry.name)) paths.push(file);
    }
    return paths;
  };
  for (const folder of ['src', 'packaging'])
    for (const path of await walk(join(directory, folder))) {
      if (
        path.endsWith('diagnose-build.ts') ||
        path.endsWith('diagnose-policy.ts')
      )
        continue;
      expect(await readFile(path, 'utf8'), path).not.toMatch(forbidden);
    }
  for (const path of await walk(join(directory, 'e2e'))) {
    if (
      /[/\\](?:token-[^/\\]+|desktop-diagnose\.ts|diagnose-[^/\\]+)$/.test(path)
    )
      continue;
    expect(await readFile(path, 'utf8'), path).not.toMatch(forbidden);
  }
  for (const file of ['ci.yml', 'release-desktop.yml'])
    expect(
      await readFile(join(root, '.github/workflows', file), 'utf8'),
    ).not.toMatch(forbidden);
  const token = await readFile(
    join(directory, 'e2e/limited-token.ps1'),
    'utf8',
  );
  expect(() => assertRestrictedProofLauncher(token)).not.toThrow();
});

test('token helper uses closed fields and a Windows subsystem without UI or COM entrypoints', async () => {
  const source = await readFile(join(directory, 'e2e/token-probe.cpp'), 'utf8');
  const build = await readFile(join(directory, 'e2e/token-build.ts'), 'utf8');
  expect(build).toContain('/SUBSYSTEM:WINDOWS');
  expect(source).not.toMatch(
    /CreateWindow|MessageBox|CoInitialize|AllocConsole|AttachConsole|LookupAccount|std::cout|printf\(/,
  );
  for (const field of [
    'TokenUser',
    'TokenOwner',
    'TokenPrimaryGroup',
    'TokenGroups',
    'TokenPrivileges',
    'TokenIntegrityLevel',
    'TokenMandatoryPolicy',
    'TokenRestrictedSids',
    'TokenElevationType',
    'TokenDefaultDacl',
    'ObjectOwner',
    'ObjectDacl',
    'ObjectMandatoryLabel',
  ])
    expect(source).toContain(field);
  expect(source).toContain('GetLastError()');
  expect(source).toContain('FlushFileBuffers');
  expect(source).toContain('exactChromiumExecution');
});

test('one 240 second deadline cuts a longer phase and returns its prior receipts', async () => {
  vi.useFakeTimers();
  const receipts: string[] = [];
  let collected: string[] = [];
  const started = Date.now();
  try {
    const result = diagnosticPhase(
      started + 240_000,
      async (remaining, signal) => {
        expect(remaining).toBe(240_000);
        receipts.push('native-token-read');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 300_000);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
        if (!signal.aborted) receipts.push('late-phase');
      },
      () => {
        collected = [...receipts];
        return Promise.resolve();
      },
    ).then(
      () => 'returned',
      (error: unknown) => (error instanceof Error ? error.message : 'unknown'),
    );
    await vi.advanceTimersByTimeAsync(240_001);
    expect(collected).toEqual(['native-token-read']);
    expect(await result).toBe('DIAGNOSE_WORK_DEADLINE');
    expect(Date.now() - started).toBe(240_001);
  } finally {
    vi.useRealTimers();
  }
});

test('a diagnostic timer firing before its deadline clock waits for the remainder before aborting', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let now = 1000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  let aborted = false;
  const result = diagnosticPhase(
    now + 100,
    (_remaining, signal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            resolve();
          },
          { once: true },
        );
      }),
    () => Promise.resolve(),
  ).catch((error: unknown) =>
    error instanceof Error ? error.message : 'unknown',
  );
  try {
    now = 1099;
    await vi.advanceTimersByTimeAsync(100);
    expect(aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    now = 1100;
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe('DIAGNOSE_WORK_DEADLINE');
    expect(aborted).toBe(true);
  } finally {
    now = 1100;
    await vi.runOnlyPendingTimersAsync();
    await result;
    clock.mockRestore();
    vi.useRealTimers();
  }
});

test('later phases receive only the original deadline remainder and expired work never starts', async () => {
  vi.useFakeTimers();
  const started = Date.now();
  const deadline = started + 240_000;
  let collected = 0;
  const collect = () => {
    collected++;
    return Promise.resolve();
  };
  try {
    const first = diagnosticPhase(
      deadline,
      async (remaining) => {
        expect(remaining).toBe(240_000);
        await new Promise<void>((resolve) => setTimeout(resolve, 180_000));
      },
      collect,
    );
    await vi.advanceTimersByTimeAsync(180_000);
    await first;
    const second = diagnosticPhase(
      deadline,
      async (remaining, signal) => {
        expect(remaining).toBe(60_000);
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        );
      },
      collect,
    ).catch((error: unknown) =>
      error instanceof Error ? error.message : 'unknown',
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await second).toBe('DIAGNOSE_WORK_DEADLINE');
    const never = vi.fn(() => Promise.resolve());
    await expect(diagnosticPhase(deadline, never, collect)).rejects.toThrow(
      'DIAGNOSE_WORK_DEADLINE',
    );
    expect(never).not.toHaveBeenCalled();
    expect(collected).toBe(3);
  } finally {
    vi.useRealTimers();
  }
});
