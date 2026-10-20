import assert from 'node:assert/strict';
import {
  readFile,
  mkdtemp,
  rm,
  copyFile,
  mkdir,
  writeFile,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { directory, root } from '../packaging/paths.ts';
import { failureRecord } from '../e2e/proof-failure.ts';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { testEnvironment } from './process-environment.ts';
import { settleOwnedUninstall } from '../e2e/owned-uninstall.ts';
import { windowsQuery } from '../packaging/windows-query.ts';
import { runNativeQuery } from '../packaging/windows-powershell.ts';
import { pathToFileURL } from 'node:url';

test('layout assertion receipts retain changed field names and both path classes without serializing either side', () => {
  const before = {
    install: 'C:\\private-before\\program',
    data: 'C:\\private-before\\data',
    installExists: false,
    dataExists: false,
    registrationExists: false,
    absent: ['uninstall-root:Registry64', 'program-folder'],
  };
  const after = {
    ...before,
    install: 'C:\\private-after\\program',
    absent: ['program-folder'],
  };
  let caught: unknown;
  try {
    assert.deepEqual(after, before);
  } catch (error) {
    caught = error;
  }
  const record = failureRecord(caught, root, join(root, 'generated-run'));
  expect(record).toMatchObject({
    layoutDifference: {
      fields: [
        {
          field: 'install',
          actual: { type: 'string', pathClass: 'program-folder' },
          expected: { type: 'string', pathClass: 'program-folder' },
        },
        {
          field: 'absent.uninstall-root:Registry64',
          actual: { type: 'absent', pathClass: 'registry-container' },
          expected: { type: 'marker', pathClass: 'registry-container' },
        },
      ],
    },
  });
  expect(JSON.stringify(record)).not.toMatch(/private-before|private-after/);
});

test('a refused fault run compares the full layout immediately before that attempt, not before a successful red install initialized shared parent containers', async () => {
  const source = await readFile(
    join(directory, 'e2e/installer-fault-controls.ts'),
    'utf8',
  );
  expect(source).toContain('const attemptBefore = await layout();');
  expect(source).toContain('assert.deepEqual(actual, attemptBefore)');
  expect(source).not.toContain('assert.deepEqual(await layout(), before)');
});

test('owned cleanup settles its own NSIS child processes and product layout with the derived polling budget, not the outer exit or a 15-second file-only loop', async () => {
  const source = await readFile(
    join(directory, 'e2e/installer-fault-controls.ts'),
    'utf8',
  );
  expect(source).toContain('await settleOwnedUninstall(');
  expect(source).not.toContain('Date.now() + 15_000');
});

test.skipIf(process.platform !== 'win32')(
  'a fresh registry container changes the old suite baseline permanently even with every product entry removed and no uninstaller child',
  async () => {
    const scratch = await mkdtemp(
      join(tmpdir(), 'socialprune-layout-baseline-'),
    );
    try {
      const { stdout } = await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'test/layout-baseline-fixture.ps1'),
          '-Scratch',
          scratch,
        ],
        {
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          windowsHide: true,
          env: testEnvironment(),
        },
      );
      const result = JSON.parse(stdout) as {
        before: { absent: string[] };
        settled: { absent: string[] };
        again: unknown;
        noChildProcessesStarted: boolean;
        ownedProductAbsent: boolean;
      };
      expect(result.noChildProcessesStarted).toBe(true);
      expect(result.ownedProductAbsent).toBe(true);
      expect(result.before.absent).toContain('uninstall-root:Registry64');
      expect(result.settled.absent).not.toContain('uninstall-root:Registry64');
      expect(result.again).toEqual(result.settled);
      expect(result.settled).not.toEqual(result.before);
      console.log(
        'LAYOUT_BASELINE_REPRO',
        JSON.stringify({
          changedFields: [
            'absent.uninstall-root:Registry64',
            'absent.uninstall-root:Registry32',
          ],
          ownedProductAbsent: true,
          noChildProcessesStarted: true,
          persistentAfterReread: true,
        }),
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  WINDOWS_QUERY_TIMEOUT_MS + 100,
);

test(
  'layout assertion metadata survives child failure, partial evidence collection and scratch cleanup',
  async () => {
    const scratch = await mkdtemp(
      join(tmpdir(), 'socialprune-layout-receipt-'),
    );
    try {
      const entry = join(scratch, 'child.mjs'),
        workspace = join(scratch, 'work'),
        output = join(scratch, 'collected');
      await mkdir(workspace);
      await mkdir(output);
      await writeFile(
        entry,
        `import assert from 'node:assert/strict';import{runProof}from ${JSON.stringify(pathToFileURL(join(directory, 'e2e/proof-runtime.ts')).href)};process.exitCode=await runProof('faults',${JSON.stringify(workspace)},${JSON.stringify(entry)},async()=>{assert.deepEqual({installExists:true,registrationExists:false,install:'C:/private-actual'},{installExists:false,registrationExists:false,install:'C:/private-expected'});});`,
      );
      await expect(
        runNativeQuery(process.execPath, [entry], {
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          windowsHide: true,
        }),
      ).rejects.toMatchObject({ code: 1 });
      const { collectProof } = await import('../e2e/proof-collection.ts');
      expect((await collectProof(workspace, output)).collected).toContain(
        'release-child-faults.json',
      );
      await rm(workspace, { recursive: true });
      const retained = await readFile(
        join(output, 'release-child-faults.json'),
        'utf8',
      );
      const changedFields: unknown = expect.arrayContaining([
        expect.objectContaining({ field: 'installExists' }),
      ]);
      expect(JSON.parse(retained)).toMatchObject({
        state: 'failed',
        phase: 'execute',
        failure: {
          layoutDifference: {
            fields: changedFields,
          },
        },
      });
      expect(retained).not.toMatch(/private-actual|private-expected/);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  WINDOWS_QUERY_TIMEOUT_MS + 100,
);

test('cleanup waits for both owned image settlement and the full product layout, not the first disappearance of Uninstall.exe', async () => {
  const clear = {
    installExists: false,
    dataExists: false,
    registrationExists: false,
    updateExists: false,
    existingShortcuts: [],
    registrations: [],
  };
  let queries = 0;
  const seen: { processes: number; productLayoutAbsent: boolean }[] = [];
  await settleOwnedUninstall(
    () =>
      Promise.resolve(queries < 3 ? { ...clear, installExists: true } : clear),
    () => {
      queries++;
      return Promise.resolve(
        queries === 1
          ? [{ pid: 770001, born: '1', imageClass: 'run-owned-nsis-copy' }]
          : [],
      );
    },
    (value) => {
      seen.push({
        processes: value.processes,
        productLayoutAbsent: value.productLayoutAbsent,
      });
      return Promise.resolve();
    },
    2000,
  );
  expect(queries).toBe(3);
  expect(seen).toEqual([
    { processes: 1, productLayoutAbsent: false },
    { processes: 0, productLayoutAbsent: false },
    { processes: 0, productLayoutAbsent: true },
  ]);
  await expect(
    settleOwnedUninstall(
      () => Promise.resolve(clear),
      () => Promise.reject(new Error('GENERATED_OWNED_QUERY_DENIED')),
      () => Promise.resolve(),
      2000,
    ),
  ).rejects.toThrow('GENERATED_OWNED_QUERY_DENIED');
  await expect(
    settleOwnedUninstall(
      () => Promise.resolve(clear),
      () =>
        Promise.resolve([
          { pid: 770001, born: '1', imageClass: 'run-owned-nsis-copy' },
        ]),
      () => Promise.resolve(),
      0,
    ),
  ).rejects.toThrow('OWNED_UNINSTALL_NOT_SETTLED:QUERY_POLL_TIMEOUT');
});

test('refusal comparison keeps every layout field and new diagnostic type-only output cannot conceal a product mutation', () => {
  const before = {
    install: 'C:\\generated\\Programs\\SocialPrune',
    data: 'C:\\generated\\SocialPrune Data',
    installExists: false,
    dataExists: false,
    registrationExists: false,
    updateExists: false,
    existingShortcuts: [],
    registrations: [],
    absent: ['program-folder'],
  };
  for (const change of [
    { installExists: true },
    { dataExists: true },
    { registrationExists: true },
    { updateExists: true },
    { existingShortcuts: ['C:\\private-shortcut'] },
    { registrations: ['private-registry-value'] },
  ]) {
    let error: unknown;
    try {
      assert.deepEqual({ ...before, ...change }, before);
    } catch (caught) {
      error = caught;
    }
    const record = failureRecord(error, root, join(root, 'generated-run'));
    expect(record.layoutDifference?.fields).toHaveLength(1);
    expect(JSON.stringify(record)).not.toMatch(
      /private-shortcut|private-registry-value/,
    );
  }
});

test.skipIf(process.platform !== 'win32')(
  'native uninstall query admits only exact generated installed or run-owned NSIS images, binds PID and birth, and excludes a generated neighbor',
  async () => {
    const scratch = await mkdtemp(
      join(tmpdir(), 'socialprune-owned-uninstall-'),
    );
    const children: ReturnType<typeof spawn>[] = [];
    try {
      const temp = join(scratch, 'owned'),
        installed = join(scratch, 'program', 'Uninstall.exe');
      const paths = [
        join(temp, '~nsu77000A.tmp', 'Un.exe'),
        installed,
        join(scratch, 'neighbor', '~nsu770002.tmp', 'Un.exe'),
      ];
      for (const path of paths) {
        await mkdir(join(path, '..'), { recursive: true });
        await copyFile(process.execPath, path);
        const child = spawn(
          path,
          ['-e', 'process.stdout.write("ready\\n");setInterval(()=>{},1000)'],
          { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false },
        );
        children.push(child);
        await once(child.stdout, 'data');
      }
      const read = async (scope: string) =>
        JSON.parse(await windowsQuery('uninstall-processes', scope)) as {
          pid: number;
          born: string;
          imageClass: string;
        }[];
      const first = await read(temp + '|' + installed);
      expect(first.map((row) => row.pid).sort()).toEqual(
        children
          .slice(0, 2)
          .map((child) => child.pid!)
          .sort(),
      );
      expect(first.every((row) => /^\d+$/.test(row.born))).toBe(true);
      expect(new Set(first.map((row) => row.imageClass))).toEqual(
        new Set(['owned-installed-uninstaller', 'run-owned-nsis-copy']),
      );
      const escaped = scratch.replaceAll("'", "''");
      const short = (
        await runPowerShell(
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$f=New-Object -ComObject Scripting.FileSystemObject; try { $f.GetFolder('${escaped}').ShortPath } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($f) }`,
          ],
          {
            timeout: WINDOWS_QUERY_TIMEOUT_MS,
            windowsHide: true,
            env: testEnvironment(),
          },
        )
      ).stdout.trim();
      expect(
        await read(
          join(short, 'owned') + '|' + join(short, 'program', 'Uninstall.exe'),
        ),
      ).toEqual(first);
      for (const child of children.slice(0, 2)) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
      expect(await read(temp + '|' + installed)).toEqual([]);
      expect(children[2]!.exitCode).toBe(null);
    } finally {
      for (const child of children)
        if (child.exitCode === null && !child.killed) {
          const exited = once(child, 'exit');
          child.kill();
          await exited;
        }
      await rm(scratch, { recursive: true, force: true });
    }
  },
  WINDOWS_QUERY_TIMEOUT_MS * 3 + 100,
);
