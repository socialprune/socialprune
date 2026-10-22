import assert from 'node:assert/strict';
import {
  readFile,
  mkdtemp,
  rm,
  copyFile,
  mkdir,
  writeFile,
  realpath,
  readdir,
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
import {
  windowsQuery,
  setWindowsQueryDiagnosticDirectory,
} from '../packaging/windows-query.ts';
import { runNativeQuery } from '../packaging/windows-powershell.ts';
import { pathToFileURL } from 'node:url';
import { windowsShortPath } from './short-path.ts';
import { dist } from '../packaging/paths.ts';
import { uninstallAccessDisposition } from './uninstall-access-precondition.ts';
import type { UninstallAccessPrecondition } from './uninstall-access-precondition.ts';

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
      const queryProbe =
        process.platform === 'win32'
          ? `await windowsQuery('uninstall-processes',${JSON.stringify(join(workspace, 'temp') + '|' + join(workspace, 'program/Uninstall.exe'))});`
          : '';
      await writeFile(
        entry,
        `import assert from 'node:assert/strict';import{runProof}from ${JSON.stringify(pathToFileURL(join(directory, 'e2e/proof-runtime.ts')).href)};import{windowsQuery}from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/windows-query.ts')).href)};process.exitCode=await runProof('faults',${JSON.stringify(workspace)},${JSON.stringify(entry)},async()=>{${queryProbe}assert.deepEqual({installExists:true,registrationExists:false,install:'C:/private-actual'},{installExists:false,registrationExists:false,install:'C:/private-expected'});});`,
      );
      await expect(
        runNativeQuery(process.execPath, [entry], {
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          windowsHide: true,
        }),
      ).rejects.toMatchObject({ code: 1 });
      const { collectProof } = await import('../e2e/proof-collection.ts');
      const collected = (await collectProof(workspace, output)).collected;
      expect(collected).toContain('release-child-faults.json');
      const queryReceipt = collected.find((name) =>
        name.startsWith('release-uninstall-query-'),
      );
      if (process.platform === 'win32') expect(queryReceipt).toBeDefined();
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
      if (queryReceipt) {
        const query = await readFile(join(output, queryReceipt), 'utf8');
        expect(JSON.parse(query)).toMatchObject({
          queryClass: 'native-uninstall-processes',
          queries: [{ state: 'returned' }],
        });
        expect(query).not.toContain(scratch);
      }
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
    const diagnostics = join(scratch, 'evidence');
    setWindowsQueryDiagnosticDirectory(diagnostics);
    const children: ReturnType<typeof spawn>[] = [];
    try {
      const canonical = await realpath(scratch);
      const shortLaunch = await windowsShortPath(canonical);
      expect(
        shortLaunch,
        'an actual generated 8.3 launch alias is required',
      ).not.toBe(null);
      if (!shortLaunch) throw new Error('GENERATED_SHORT_LAUNCH_REQUIRED');
      const temp = join(canonical, 'owned'),
        installed = join(canonical, 'program', 'Uninstall.exe');
      const paths = [
        join(shortLaunch, 'owned', '~nsu77000A.tmp', 'Un.exe'),
        join(shortLaunch, 'program', 'Uninstall.exe'),
        join(shortLaunch, 'owned-neighbor', '~nsu770002.tmp', 'Un.exe'),
        join(shortLaunch, 'owned', '~nsuNOTHEX.tmp', 'Un.exe'),
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
      const before = JSON.parse(
        await windowsQuery(
          'identities',
          children.map((child) => child.pid!).join(','),
        ),
      ) as { pid: number; born: string }[];
      const first = await read(temp + '|' + installed);
      const after: unknown = JSON.parse(
        await windowsQuery(
          'identities',
          children.map((child) => child.pid!).join(','),
        ),
      );
      process.stdout.write(
        'UNINSTALL_GENERATED_LIFECYCLE ' +
          JSON.stringify({
            launchPathClass: 'generated-short-name-temp',
            scopePathClasses: [
              'generated-long-name-temp',
              'generated-short-name-temp',
              'generated-uppercase-scope',
            ],
            candidates: children.map((child, index) => ({
              pid: child.pid,
              born: before.find((row) => row.pid === child.pid)?.born,
              expectedClass: [
                'run-owned-nsis-copy',
                'owned-installed-uninstaller',
                'outside-uninstall-scope',
                'run-owned-temp-other',
              ][index],
              alive: child.exitCode === null && child.signalCode === null,
            })),
            before,
            after,
          }) +
          '\n',
      );
      expect(
        children.every(
          (child) => child.exitCode === null && child.signalCode === null,
        ),
      ).toBe(true);
      expect(before).toHaveLength(paths.length);
      expect(after).toEqual(before);
      expect(first.map((row) => row.pid).sort()).toEqual(
        children
          .slice(0, 2)
          .map((child) => child.pid!)
          .sort(),
      );
      expect(first.every((row) => /^\d+$/.test(row.born))).toBe(true);
      for (const row of first)
        expect(row.born).toBe(
          before.find((value) => value.pid === row.pid)?.born,
        );
      expect(new Set(first.map((row) => row.imageClass))).toEqual(
        new Set(['owned-installed-uninstaller', 'run-owned-nsis-copy']),
      );
      expect(
        await read(
          join(shortLaunch, 'owned') +
            '|' +
            join(shortLaunch, 'program', 'Uninstall.exe'),
        ),
      ).toEqual(first);
      expect(
        await read(temp.toUpperCase() + '|' + installed.toUpperCase()),
      ).toEqual(first);
      const files = await readdir(diagnostics);
      expect(files).toHaveLength(2);
      expect(
        files.filter((file) => file.startsWith('release-process-query-')),
      ).toHaveLength(1);
      const uninstallFiles = files.filter((file) =>
        file.startsWith('release-uninstall-query-'),
      );
      expect(uninstallFiles).toHaveLength(1);
      const retained = await readFile(
        join(diagnostics, uninstallFiles[0]!),
        'utf8',
      );
      const record = JSON.parse(retained) as {
        queries: {
          candidates: {
            pid: number;
            filter: string;
            pathClass: string;
            canonicalized: boolean;
            rawMatched: boolean;
          }[];
        }[];
      };
      for (const child of children.slice(0, 2))
        expect(
          record.queries[0]?.candidates.find((row) => row.pid === child.pid),
        ).toMatchObject({
          filter: 'accepted',
          canonicalized: true,
          rawMatched: false,
        });
      expect(
        record.queries[0]?.candidates.find(
          (row) => row.pid === children[2]!.pid,
        ),
      ).toMatchObject({
        filter: 'scope-mismatch',
        pathClass: 'outside-uninstall-scope',
      });
      expect(
        record.queries[0]?.candidates.find(
          (row) => row.pid === children[3]!.pid,
        ),
      ).toMatchObject({
        filter: 'nsis-shape-mismatch',
        pathClass: 'run-owned-temp-other',
      });
      expect(retained).not.toContain(canonical);
      expect(retained).not.toContain(shortLaunch);
      await mkdir(dist, { recursive: true });
      await writeFile(join(dist, 'release-uninstall-generated.json'), retained);
      for (const child of children.slice(0, 2)) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
      expect(await read(temp + '|' + installed)).toEqual([]);
      expect(
        children
          .slice(2)
          .every(
            (child) => child.exitCode === null && child.signalCode === null,
          ),
      ).toBe(true);
    } finally {
      setWindowsQueryDiagnosticDirectory(dist);
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

test.skipIf(process.platform !== 'win32')(
  'an access-limited generated uninstaller query remains fatal and records the exact denied filter, not false absence',
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'socialprune-query-denied-'));
    const image = join(scratch, 'Uninstall.exe');
    const audit = join(scratch, 'access-audit.exe');
    const diagnostics = join(scratch, 'evidence');
    let child: ReturnType<typeof spawn> | undefined;
    setWindowsQueryDiagnosticDirectory(diagnostics);
    try {
      for (const [source, output] of [
        ['test/uninstall-access-fixture.cs', image],
        ['test/uninstall-access-audit.cs', audit],
      ])
        await runPowerShell(
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Add-Type -Path '${join(directory, source!).replaceAll("'", "''")}' -OutputAssembly '${output!.replaceAll("'", "''")}' -OutputType ConsoleApplication`,
          ],
          { timeout: WINDOWS_QUERY_TIMEOUT_MS, windowsHide: true },
        );
      child = spawn(image, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: false,
      });
      await once(child.stdout!, 'data');
      const childPid = child.pid;
      const precondition = JSON.parse(
        (
          await runNativeQuery(audit, [String(childPid), String(process.pid)], {
            timeout: WINDOWS_QUERY_TIMEOUT_MS,
            windowsHide: true,
          })
        ).stdout,
      ) as UninstallAccessPrecondition;
      const disposition = uninstallAccessDisposition(precondition);
      let failure: unknown;
      let result:
        { pid: number; born: string; imageClass: string }[] | undefined;
      try {
        result = JSON.parse(
          await windowsQuery('uninstall-processes', scratch + '|' + image),
        ) as typeof result;
      } catch (error) {
        failure = error;
      }
      const receipt = {
        ...precondition,
        disposition,
        state: disposition === 'record-only' ? 'record-only' : 'mechanism-run',
        reason:
          disposition === 'record-only'
            ? 'caller-open-not-denied'
            : 'observed-access-denied',
        mechanismRun: disposition === 'assert-denied',
        queryReturned: failure === undefined,
        queryAcceptedOwnedImage:
          result?.some(
            (row) =>
              row.pid === childPid &&
              row.imageClass === 'owned-installed-uninstaller',
          ) ?? false,
      };
      process.stdout.write(
        'UNINSTALL_ACCESS_PRECONDITION ' + JSON.stringify(receipt) + '\n',
      );
      await mkdir(dist, { recursive: true });
      await writeFile(
        join(dist, 'release-uninstall-access-precondition.json'),
        JSON.stringify(receipt, null, 2),
      );
      if (disposition === 'record-only') {
        expect(failure).toBeUndefined();
        expect(result).toEqual([
          {
            pid: childPid,
            born: precondition.born,
            imageClass: 'owned-installed-uninstaller',
          },
        ]);
        return;
      }
      expect(failure).toMatchObject({ code: 1 });
      expect(
        failure instanceof Error && 'stderr' in failure ? failure.stderr : '',
      ).toContain('PROCESS_OPEN_FAILED');
      expect(child.exitCode).toBe(null);
      const files = await readdir(diagnostics);
      expect(files).toHaveLength(2);
      expect(
        files.filter((file) => file.startsWith('release-process-query-')),
      ).toHaveLength(1);
      const uninstallFiles = files.filter((file) =>
        file.startsWith('release-uninstall-query-'),
      );
      expect(uninstallFiles).toHaveLength(1);
      const retained = await readFile(
        join(diagnostics, uninstallFiles[0]!),
        'utf8',
      );
      const record = JSON.parse(retained) as {
        queries: { state: string; candidates: unknown[] }[];
      };
      expect(record.queries.at(-1)).toMatchObject({ state: 'failed' });
      const candidate: unknown = expect.objectContaining({
        pid: childPid,
        filter: 'process-open-failed',
        pathClass: 'unreadable',
        win32Error: 5,
      });
      expect(record.queries.at(-1)?.candidates).toContainEqual(candidate);
      expect(retained).not.toContain(scratch);
      process.stdout.write(
        'UNINSTALL_ACCESS_DENIED_PROOF ' + retained.replaceAll('\n', '') + '\n',
      );
    } finally {
      setWindowsQueryDiagnosticDirectory(dist);
      if (child && child.exitCode === null && child.signalCode === null) {
        const ended = once(child, 'exit');
        child.stdin!.end('done\n');
        await ended;
      }
      await rm(scratch, { recursive: true, force: true });
    }
  },
  // Two fixture compiles, token/open audit, cold native compile and native query.
  WINDOWS_QUERY_TIMEOUT_MS * 5 + 100,
);
